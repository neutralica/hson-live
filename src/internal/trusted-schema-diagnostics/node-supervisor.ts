import { fork, type ForkOptions } from "node:child_process";
import type { EventEmitter } from "node:events";
import type { Readable } from "node:stream";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { TRUSTED_SCHEMA_DIAGNOSTICS_PROTOCOL_VERSION, type TrustedSchemaRequest, type TrustedSchemaResponse } from "./protocol.js";

export type TrustedSchemaTrustGate = Readonly<{ workspaceTrusted: boolean; enabled: boolean }>;
/** Private process boundary, injectable for deterministic execution/stale-delivery proofs. */
export type TrustedSchemaRuntimeProcess = EventEmitter & {
  connected: boolean;
  killed: boolean;
  stdout?: Readable | null;
  stderr?: Readable | null;
  send: (request: TrustedSchemaRequest, callback: (error: Error | null) => void) => unknown;
  kill: (signal: "SIGKILL") => unknown;
};
export type TrustedSchemaSupervisorOptions = Readonly<{
  trust: TrustedSchemaTrustGate;
  startupDeadlineMs?: number;
  validationDeadlineMs?: number;
  maxRestarts?: number;
  runtimeEntry?: string;
  execArgv?: readonly string[];
  spawnRuntime?: (entry: string, options: ForkOptions) => TrustedSchemaRuntimeProcess;
}>;
type RequestInput<T = TrustedSchemaRequest> = T extends TrustedSchemaRequest
  ? Omit<T, "protocolVersion" | "requestId" | "runtimeGeneration"> : never;

export class TrustedSchemaInfrastructureError extends Error {
  constructor(readonly code: "TRUST_REQUIRED" | "REQUEST_TIMEOUT" | "RUNTIME_RETIRED" | "RUNTIME_DISCONNECTED" | "RESTART_BUDGET_EXHAUSTED" | "DISPOSED", message: string) {
    super(message);
    this.name = "TrustedSchemaInfrastructureError";
  }
}

/**
 * One initial launch plus maxRestarts replacement attempts per supervisor lifetime.
 * A replacement consumes budget BEFORE spawn, including failed startup attempts.
 * Successful handshakes/validation do not reset it. Exhaustion never spawns.
 * terminate retires all pending work immediately; dispose permanently closes the owner.
 */
export class TrustedSchemaNodeSupervisor {
  readonly #options: TrustedSchemaSupervisorOptions & Required<Pick<TrustedSchemaSupervisorOptions, "startupDeadlineMs" | "validationDeadlineMs" | "maxRestarts">>;
  readonly #pending = new Set<(error: Error) => void>();
  #child: TrustedSchemaRuntimeProcess | undefined;
  #starting: Promise<void> | undefined;
  #generation = 0;
  #sequence = 0;
  #restarts = 0;
  #disposed = false;
  #stderr = "";
  #stdout = "";

  constructor(options: TrustedSchemaSupervisorOptions) {
    if (options.maxRestarts !== undefined && (!Number.isSafeInteger(options.maxRestarts) || options.maxRestarts < 0)) throw new RangeError("maxRestarts must be a nonnegative safe integer.");
    this.#options = {
      ...options, trust: Object.freeze({ ...options.trust }),
      startupDeadlineMs: options.startupDeadlineMs ?? 2_000,
      validationDeadlineMs: options.validationDeadlineMs ?? 1_000,
      maxRestarts: options.maxRestarts ?? 1,
    };
  }
  get generation(): number { return this.#generation; }
  get activeGeneration(): number | undefined { return this.running ? this.#generation : undefined; }
  get restarts(): number { return this.#restarts; }
  get running(): boolean { return this.#child?.connected === true; }
  get output(): Readonly<{ stdout: string; stderr: string }> { return Object.freeze({ stdout: this.#stdout, stderr: this.#stderr }); }

  async start(): Promise<void> {
    this.require_trust();
    if (this.#starting !== undefined) return this.#starting;
    if (this.running) return;
    const starting = this.launch();
    this.#starting = starting;
    try { await starting; }
    finally { if (this.#starting === starting) this.#starting = undefined; }
  }

  private async launch(): Promise<void> {
    if (this.#generation > 0) {
      if (this.#restarts >= this.#options.maxRestarts) throw new TrustedSchemaInfrastructureError("RESTART_BUDGET_EXHAUSTED", "Trusted Schema runtime restart budget exhausted; create a new owner to retry.");
      this.#restarts += 1;
    }
    this.#generation += 1;
    const entry = this.#options.runtimeEntry ?? fileURLToPath(new URL("./node-runtime-entry.js", import.meta.url));
    const spawn = this.#options.spawnRuntime ?? ((path, options) => fork(path, [], options));
    const child = spawn(entry, { silent: true, execArgv: [...(this.#options.execArgv ?? [])], env: { ...process.env, HSON_TRUSTED_SCHEMA_GENERATION: String(this.#generation) } });
    this.#child = child;
    child.stdout?.on("data", (chunk: Buffer) => { this.#stdout = (this.#stdout + String(chunk)).slice(-16_384); });
    child.stderr?.on("data", (chunk: Buffer) => { this.#stderr = (this.#stderr + String(chunk)).slice(-16_384); });
    const disconnected = (): void => {
      if (this.#child === child) this.terminate(new TrustedSchemaInfrastructureError("RUNTIME_DISCONNECTED", "Trusted Schema runtime disconnected."));
    };
    child.once("exit", disconnected);
    child.once("disconnect", disconnected);
    child.once("error", disconnected);
    try {
      const started = await this.dispatch({ type: "handshake" }, this.#options.startupDeadlineMs);
      if (started.type !== "ready") throw new Error(started.message ?? "Trusted Schema runtime did not start.");
    } catch (cause) {
      if (this.#child === child) this.terminate();
      throw cause;
    }
  }

  async request(request: RequestInput, deadlineMs = this.#options.validationDeadlineMs): Promise<TrustedSchemaResponse> {
    this.require_trust();
    await this.start();
    return this.dispatch(request, deadlineMs);
  }

  private dispatch(request: RequestInput, deadlineMs: number): Promise<TrustedSchemaResponse> {
    const child = this.#child;
    if (child === undefined) return Promise.reject(new TrustedSchemaInfrastructureError("RUNTIME_RETIRED", "Trusted Schema runtime is unavailable."));
    const generation = this.#generation;
    const requestId = `${generation}:${++this.#sequence}`;
    const payload: TrustedSchemaRequest = { ...request, protocolVersion: TRUSTED_SCHEMA_DIAGNOSTICS_PROTOCOL_VERSION, requestId, runtimeGeneration: generation };
    const started = performance.now();
    return new Promise<TrustedSchemaResponse>((resolve, reject) => {
      const clean = (): void => { clearTimeout(timer); child.off("message", onMessage); this.#pending.delete(fail); };
      const fail = (error: Error): void => { clean(); reject(error); };
      const onMessage = (message: TrustedSchemaResponse): void => {
        if (this.#child !== child || !this.running || generation !== this.#generation || message?.runtimeGeneration !== generation || message.requestId !== requestId || message.protocolVersion !== TRUSTED_SCHEMA_DIAGNOSTICS_PROTOCOL_VERSION) return;
        clean(); resolve(message);
      };
      const timer = setTimeout(() => {
        const error = new TrustedSchemaInfrastructureError("REQUEST_TIMEOUT", `Trusted Schema request timed out after ${Math.round(performance.now() - started)}ms.`);
        if (this.#child === child) this.terminate(error);
        else fail(error);
      }, deadlineMs);
      this.#pending.add(fail);
      child.on("message", onMessage);
      try { child.send(payload, (error) => { if (error) fail(error); }); }
      catch (cause) { fail(cause instanceof Error ? cause : new Error("Trusted Schema IPC send failed.")); }
    });
  }

  terminate(reason: Error = new TrustedSchemaInfrastructureError("RUNTIME_RETIRED", "Trusted Schema runtime retired.")): void {
    const child = this.#child;
    this.#child = undefined;
    for (const fail of [...this.#pending]) fail(reason);
    if (child !== undefined && !child.killed) child.kill("SIGKILL");
  }
  dispose(): void { this.#disposed = true; this.terminate(); }
  private require_trust(): void {
    if (this.#disposed) throw new TrustedSchemaInfrastructureError("DISPOSED", "Trusted Schema supervisor is disposed.");
    if (!this.#options.trust.workspaceTrusted || !this.#options.trust.enabled) throw new TrustedSchemaInfrastructureError("TRUST_REQUIRED", "Trusted Schema diagnostics require Workspace Trust and explicit enablement.");
  }
}
