import { spawn, type ChildProcess } from "node:child_process";

import { LOCAL_HOST_PROTOCOL_VERSION, local_host_stop_request, parse_local_host_child_message, type LocalHostChildMessage } from "./local-host-protocol.js";
import type { ResolvedLocalHostProject } from "./local-host-project.js";

export type LocalHostState = "stopped" | "starting" | "running" | "stopping" | "failed";

export type LocalHostSnapshot = Readonly<{
  state: LocalHostState;
  projectId: string;
  httpUrl?: string;
  port?: number;
  nodeVersion?: string;
  hsonLiveVersion?: string;
  applicationNames?: readonly string[];
  failure?: string;
}>;

type Timer = ReturnType<typeof setTimeout>;
type LocalHostHandshakePhase = "launched" | "starting" | "hello" | "ready";

export type LocalHostControllerOptions = Readonly<{
  runnerPath: string;
  startupTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  forceExitTimeoutMs?: number;
  launch?: (project: ResolvedLocalHostProject, runnerPath: string) => ChildProcess;
  setTimer?: (callback: () => void, delay: number) => Timer;
  clearTimer?: (timer: Timer) => void;
  output?: (channel: "lifecycle" | "stdout" | "stderr", text: string) => void;
  onState?: (snapshot: LocalHostSnapshot) => void;
}>;

export class LocalHostController {
  readonly projectId: string;
  #options: Required<Pick<LocalHostControllerOptions, "startupTimeoutMs" | "shutdownTimeoutMs" | "forceExitTimeoutMs" | "launch" | "setTimer" | "clearTimer" | "output" | "onState">> & Pick<LocalHostControllerOptions, "runnerPath">;
  #snapshot: LocalHostSnapshot;
  #child: ChildProcess | undefined;
  #generation = 0;
  #handshakePhase: LocalHostHandshakePhase = "launched";
  #startPromise: Promise<LocalHostSnapshot> | undefined;
  #stopPromise: Promise<void> | undefined;

  constructor(projectId: string, options: LocalHostControllerOptions) {
    this.projectId = projectId;
    this.#options = {
      runnerPath: options.runnerPath,
      startupTimeoutMs: options.startupTimeoutMs ?? 20_000,
      shutdownTimeoutMs: options.shutdownTimeoutMs ?? 5_000,
      forceExitTimeoutMs: options.forceExitTimeoutMs ?? 1_000,
      launch: options.launch ?? launch_local_host_child,
      setTimer: options.setTimer ?? setTimeout,
      clearTimer: options.clearTimer ?? clearTimeout,
      output: options.output ?? (() => undefined),
      onState: options.onState ?? (() => undefined),
    };
    this.#snapshot = Object.freeze({ state: "stopped", projectId });
  }

  get snapshot(): LocalHostSnapshot {
    return this.#snapshot;
  }

  start(project: ResolvedLocalHostProject): Promise<LocalHostSnapshot> {
    if (project.projectId !== this.projectId) return Promise.reject(new Error(`Local-host controller ${this.projectId} cannot start project ${project.projectId}.`));
    if (this.#snapshot.state === "running") return Promise.resolve(this.#snapshot);
    if (this.#snapshot.state === "starting" && this.#startPromise !== undefined) return this.#startPromise;
    if (this.#snapshot.state === "stopping") return (this.#stopPromise ?? Promise.resolve()).then(() => this.start(project));
    if (this.#snapshot.state === "failed" && this.#child !== undefined
      && this.#child.exitCode === null && this.#child.signalCode === null) {
      return this.stop().then(() => this.start(project));
    }

    const generation = ++this.#generation;
    this.#handshakePhase = "launched";
    this.#setSnapshot({ state: "starting", projectId: this.projectId });
    this.#options.output("lifecycle", `Starting ${this.projectId} with ${project.nodeExecutable}.\n`);
    let child: ChildProcess;
    try {
      child = this.#options.launch(project, this.#options.runnerPath);
    } catch (error) {
      const message = error_message(error);
      this.#setSnapshot({ state: "failed", projectId: this.projectId, failure: message });
      return Promise.reject(new Error(message));
    }
    this.#child = child;
    this.#routeOutput(child);

    this.#startPromise = new Promise<LocalHostSnapshot>((resolveStart, rejectStart) => {
      let settled = false;
      const settleFailure = (message: string): void => {
        if (settled) return;
        settled = true;
        this.#options.clearTimer(startupTimer);
        rejectStart(new Error(message));
      };
      const startupTimer = this.#options.setTimer(() => {
        if (!this.#isCurrent(child, generation) || this.#snapshot.state !== "starting") return;
        const message = `Local host startup exceeded ${this.#options.startupTimeoutMs}ms.`;
        this.#options.output("lifecycle", `${message}\n`);
        this.#setSnapshot({ state: "failed", projectId: this.projectId, failure: message });
        settleFailure(message);
        void this.#terminateCurrent(child, generation);
      }, this.#options.startupTimeoutMs);

      child.on("message", value => {
        if (!this.#isCurrent(child, generation)) return;
        const message = parse_local_host_child_message(value);
        if (message === undefined) {
          const suppliedVersion = is_record(value) ? value.protocolVersion : undefined;
          const detail = suppliedVersion !== undefined && suppliedVersion !== LOCAL_HOST_PROTOCOL_VERSION
            ? `Incompatible Hson local-host protocol ${String(suppliedVersion)}; expected ${LOCAL_HOST_PROTOCOL_VERSION}.`
            : "Rejected an invalid Hson local-host child message.";
          this.#options.output("lifecycle", `${detail}\n`);
          if (suppliedVersion !== undefined && suppliedVersion !== LOCAL_HOST_PROTOCOL_VERSION) {
            this.#setSnapshot({ state: "failed", projectId: this.projectId, failure: detail });
            settleFailure(detail);
            void this.#terminateCurrent(child, generation);
          }
          return;
        }
        if (message.projectId !== this.projectId) {
          this.#options.output("lifecycle", `Rejected a local-host message for unexpected project ${message.projectId}.\n`);
          return;
        }
        const accepted = this.#acceptMessage(message, child, generation);
        if (accepted === "ready") {
          if (!settled) {
            settled = true;
            this.#options.clearTimer(startupTimer);
            resolveStart(this.#snapshot);
          }
        } else if (accepted === "failure" && message.type === "failure") {
          settleFailure(message.message);
        }
      });
      child.once("error", error => {
        if (!this.#isCurrent(child, generation)) return;
        const message = `Local host process failed: ${error.message}`;
        this.#options.output("lifecycle", `${message}\n`);
        this.#setSnapshot({ state: "failed", projectId: this.projectId, failure: message });
        settleFailure(message);
      });
      child.once("disconnect", () => {
        if (!this.#isCurrent(child, generation)) return;
        if (this.#snapshot.state === "stopping" || this.#snapshot.state === "stopped" || this.#snapshot.state === "failed") return;
        const message = "Local host IPC disconnected unexpectedly.";
        this.#options.output("lifecycle", `${message}\n`);
        this.#setSnapshot({ ...this.#snapshot, state: "failed", failure: message });
        settleFailure(message);
      });
      child.once("close", (code, signal) => {
        if (!this.#isCurrent(child, generation)) return;
        this.#child = undefined;
        const wasStopping = this.#snapshot.state === "stopping";
        if (wasStopping) {
          this.#setSnapshot({ state: "stopped", projectId: this.projectId });
          settleFailure("Local host startup was stopped before readiness.");
        } else if (this.#snapshot.state !== "failed") {
          const message = `Local host exited unexpectedly (${signal === null ? `code ${code ?? "unknown"}` : `signal ${signal}`}).`;
          this.#setSnapshot({ ...this.#snapshot, state: "failed", failure: message });
          this.#options.output("lifecycle", `${message}\n`);
          settleFailure(message);
        }
      });
    }).finally(() => {
      if (generation === this.#generation) this.#startPromise = undefined;
    });
    return this.#startPromise;
  }

  stop(): Promise<void> {
    if (this.#snapshot.state === "stopped") return Promise.resolve();
    if (this.#snapshot.state === "stopping" && this.#stopPromise !== undefined) return this.#stopPromise;
    const child = this.#child;
    const generation = this.#generation;
    if (child === undefined || child.exitCode !== null || child.signalCode !== null) {
      this.#child = undefined;
      this.#setSnapshot({ state: "stopped", projectId: this.projectId });
      return Promise.resolve();
    }
    this.#setSnapshot({ ...this.#snapshot, state: "stopping" });
    this.#options.output("lifecycle", `Stopping ${this.projectId}.\n`);
    this.#stopPromise = this.#terminateCurrent(child, generation).finally(() => {
      if (generation === this.#generation) {
        this.#child = undefined;
        this.#setSnapshot({ state: "stopped", projectId: this.projectId });
        this.#stopPromise = undefined;
      }
    });
    return this.#stopPromise;
  }

  async restart(project: ResolvedLocalHostProject): Promise<LocalHostSnapshot> {
    await this.stop();
    return this.start(project);
  }

  dispose(): Promise<void> {
    return this.stop();
  }

  #acceptMessage(message: LocalHostChildMessage, child: ChildProcess, generation: number): "ready" | "failure" | "accepted" | "rejected" {
    if (!this.#isCurrent(child, generation)) return "rejected";
    if (message.type === "starting") {
      if (this.#snapshot.state !== "starting" || this.#handshakePhase !== "launched") return this.#rejectSequence(message.type);
      this.#handshakePhase = "starting";
      this.#options.output("lifecycle", `Child starting on Node ${message.nodeVersion}; entry ${message.applicationEntry}.\n`);
    } else if (message.type === "hello") {
      if (this.#snapshot.state !== "starting" || this.#handshakePhase !== "starting") return this.#rejectSequence(message.type);
      this.#handshakePhase = "hello";
      this.#setSnapshot({ ...this.#snapshot, nodeVersion: message.nodeVersion, hsonLiveVersion: message.hsonLiveVersion, applicationNames: message.applicationNames });
      this.#options.output("lifecycle", `Handshake: protocol ${message.protocolVersion}; hson-live ${message.hsonLiveVersion}; applications ${message.applicationNames.join(", ")}.\n`);
    } else if (message.type === "ready") {
      if (this.#snapshot.state !== "starting" || this.#handshakePhase !== "hello") return this.#rejectSequence(message.type);
      this.#handshakePhase = "ready";
      this.#setSnapshot({ ...this.#snapshot, state: "running", httpUrl: message.httpUrl, port: message.port, failure: undefined });
      this.#options.output("lifecycle", `Ready at ${message.httpUrl}.\n`);
      return "ready";
    } else if (message.type === "failure") {
      if (this.#snapshot.state === "stopping" || this.#snapshot.state === "stopped") {
        this.#options.output("lifecycle", `Failure during ${message.phase} while stopping: ${message.message}\n`);
        return "failure";
      }
      if (this.#snapshot.state === "failed") return this.#rejectSequence(message.type);
      this.#setSnapshot({ ...this.#snapshot, state: "failed", failure: `${message.phase}: ${message.message}` });
      this.#options.output("lifecycle", `Failure during ${message.phase}: ${message.message}\n`);
      return "failure";
    } else {
      this.#options.output("lifecycle", `Child reported stopped for ${this.projectId}.\n`);
    }
    return "accepted";
  }

  #rejectSequence(type: LocalHostChildMessage["type"]): "rejected" {
    this.#options.output("lifecycle", `Rejected out-of-order local-host '${type}' message while ${this.#snapshot.state}/${this.#handshakePhase}.\n`);
    return "rejected";
  }

  #routeOutput(child: ChildProcess): void {
    child.stdout?.on("data", chunk => this.#options.output("stdout", String(chunk)));
    child.stderr?.on("data", chunk => this.#options.output("stderr", String(chunk)));
  }

  #terminateCurrent(child: ChildProcess, generation: number): Promise<void> {
    return new Promise(resolveStop => {
      if (!this.#isCurrent(child, generation) || child.exitCode !== null || child.signalCode !== null) return resolveStop();
      let settled = false;
      let forceTimer: Timer | undefined;
      let finalTimer: Timer | undefined;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        if (forceTimer !== undefined) this.#options.clearTimer(forceTimer);
        if (finalTimer !== undefined) this.#options.clearTimer(finalTimer);
        resolveStop();
      };
      child.once("close", finish);
      try {
        child.send?.(local_host_stop_request(), error => {
          if (error !== null) this.#options.output("lifecycle", `Could not send graceful stop: ${error.message}\n`);
        });
      } catch (error) {
        this.#options.output("lifecycle", `Could not send graceful stop: ${error_message(error)}\n`);
      }
      forceTimer = this.#options.setTimer(() => {
        if (child.exitCode !== null || child.signalCode !== null) return finish();
        this.#options.output("lifecycle", `Graceful shutdown exceeded ${this.#options.shutdownTimeoutMs}ms; forcing termination.\n`);
        child.kill("SIGKILL");
        finalTimer = this.#options.setTimer(finish, this.#options.forceExitTimeoutMs);
      }, this.#options.shutdownTimeoutMs);
    });
  }

  #isCurrent(child: ChildProcess, generation: number): boolean {
    return this.#child === child && this.#generation === generation;
  }

  #setSnapshot(snapshot: LocalHostSnapshot): void {
    this.#snapshot = Object.freeze(snapshot);
    this.#options.onState(this.#snapshot);
  }
}

export function launch_local_host_child(project: ResolvedLocalHostProject, runnerPath: string): ChildProcess {
  const config = JSON.stringify({
    projectId: project.projectId,
    workspaceFolder: project.workspaceFolder,
    applicationEntry: project.entry,
    applicationExport: project.applicationExport,
    hsonLiveNodeEntry: project.hsonLiveNodeEntry,
    hsonLiveVersion: project.hsonLiveVersion,
    port: project.port,
  });
  return spawn(project.nodeExecutable, [runnerPath, config], {
    cwd: project.workspaceFolder,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true,
  });
}

function error_message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function is_record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
