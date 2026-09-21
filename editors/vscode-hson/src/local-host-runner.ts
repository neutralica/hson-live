import { pathToFileURL } from "node:url";

import { LOCAL_HOST_PROTOCOL_VERSION, parse_local_host_stop_request, type LocalHostChildMessage } from "./local-host-protocol.js";

type RunnerConfig = Readonly<{
  projectId: string;
  workspaceFolder: string;
  applicationEntry: string;
  applicationExport: string;
  hsonLiveNodeEntry: string;
  hsonLiveVersion: string;
  port: number;
}>;

type Application = Readonly<{ name: string; dispose(): void | Promise<void> }>;
type ApplicationFactory = () => Application | readonly Application[] | Promise<Application | readonly Application[]>;
type NodeApplicationHost = Readonly<{ httpUrl: string; port: number; dispose(): void | Promise<void> }>;
type LiveHostNodeModule = Readonly<{
  assert_supported_livehost_node_runtime(): void;
  start_node_application_host(options: Readonly<{ host: string; port: number; applications: readonly Application[] }>): Promise<NodeApplicationHost>;
}>;

let config: RunnerConfig;
let host: NodeApplicationHost | undefined;
let applications: readonly Application[] | undefined;
let applicationOwnership: "none" | "runner" | "host" = "none";
let stopping = false;
let finished = false;
let startupSettled: Promise<void>;
let settleStartup: () => void;
let shutdownPromise: Promise<void> | undefined;

{
  let settle: (() => void) | undefined;
  startupSettled = new Promise(resolve => { settle = resolve; });
  settleStartup = () => settle?.();
}

function send(message: LocalHostChildMessage): void {
  if (typeof process.send === "function" && process.connected) process.send(message);
}

function fail(phase: Extract<LocalHostChildMessage, { type: "failure" }>["phase"], error: unknown): void {
  if (finished) return;
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  send({ protocolVersion: LOCAL_HOST_PROTOCOL_VERSION, type: "failure", projectId: config?.projectId ?? "unknown", phase, message });
  process.exitCode = 1;
}

function request_stop(): void {
  if (finished) return;
  stopping = true;
  void shutdown();
}

function shutdown(): Promise<void> {
  return shutdownPromise ??= (async () => {
    await startupSettled;
    try {
      if (host !== undefined) {
        const ownedHost = host;
        host = undefined;
        await ownedHost.dispose();
      } else if (applicationOwnership === "runner" && applications !== undefined) {
        applicationOwnership = "none";
        await dispose_applications(applications);
      }
    } catch (error) {
      fail("shutdown", error);
    } finally {
      finished = true;
      if (config !== undefined) send({ protocolVersion: LOCAL_HOST_PROTOCOL_VERSION, type: "stopped", projectId: config.projectId });
      if (process.connected) process.disconnect?.();
      setImmediate(() => process.exit(process.exitCode ?? 0));
    }
  })();
}

process.on("message", value => {
  if (parse_local_host_stop_request(value) !== undefined) request_stop();
});
process.once("SIGTERM", request_stop);
process.once("SIGINT", request_stop);
process.once("disconnect", request_stop);
process.once("uncaughtException", error => { fail("runtime", error); request_stop(); });
process.once("unhandledRejection", error => { fail("runtime", error); request_stop(); });

async function main(): Promise<void> {
  config = parse_config(process.argv[2]);
  send({ protocolVersion: LOCAL_HOST_PROTOCOL_VERSION, type: "starting", projectId: config.projectId, applicationEntry: config.applicationEntry, nodeVersion: process.versions.node });

  let liveHostNode: LiveHostNodeModule;
  try {
    const imported: unknown = await import(pathToFileURL(config.hsonLiveNodeEntry).href);
    if (!is_livehost_node_module(imported)) throw new Error("The workspace hson-live/livehost/node entry does not provide the required runtime API.");
    liveHostNode = imported;
    liveHostNode.assert_supported_livehost_node_runtime();
  } catch (error) {
    fail("runtime", error);
    request_stop();
    return;
  }
  if (stopping) return;

  try {
    if (stopping) return;
    const imported: unknown = await import(pathToFileURL(config.applicationEntry).href);
    if (stopping) return;
    if (!is_record(imported)) throw new Error("The configured application entry did not load as a module.");
    const applicationModule = imported;
    const applicationValue = applicationModule[config.applicationExport];
    if (stopping) return;
    const resolved = is_application_factory(applicationValue) ? await applicationValue() : applicationValue;
    applications = normalize_applications(resolved);
    applicationOwnership = "runner";
    if (stopping) return;
  } catch (error) {
    fail("application", error);
    request_stop();
    return;
  }

  send({ protocolVersion: LOCAL_HOST_PROTOCOL_VERSION, type: "hello", projectId: config.projectId, applicationNames: applications.map(application => application.name), hsonLiveVersion: config.hsonLiveVersion, nodeVersion: process.versions.node });
  if (stopping) return;
  try {
    applicationOwnership = "host";
    host = await liveHostNode.start_node_application_host({ host: "127.0.0.1", port: config.port, applications });
    if (stopping) return;
    send({ protocolVersion: LOCAL_HOST_PROTOCOL_VERSION, type: "ready", projectId: config.projectId, httpUrl: host.httpUrl, port: host.port });
  } catch (error) {
    applicationOwnership = "none";
    fail("hosting", is_record(error) && error.code === "EADDRINUSE"
      ? new Error(`Local App port ${config.port} is already in use. Change hson.localHost.port or stop the other process.`)
      : error);
    request_stop();
  }
}

async function dispose_applications(owned: readonly Application[]): Promise<void> {
  const disposed = new Set<Application>();
  const failures: unknown[] = [];
  for (const application of owned) {
    if (disposed.has(application)) continue;
    disposed.add(application);
    try {
      await application.dispose();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length !== 0) throw new AggregateError(failures, "One or more local-host applications failed to dispose.");
}

function parse_config(text: string | undefined): RunnerConfig {
  if (text === undefined) throw new Error("Missing local-host runner configuration.");
  const value: unknown = JSON.parse(text);
  if (!is_record(value)) throw new Error("Invalid local-host runner configuration.");
  if (!Number.isInteger(value.port) || Number(value.port) < 0 || Number(value.port) > 65_535) throw new Error("Invalid local-host runner port.");
  return Object.freeze({
    projectId: config_string(value, "projectId"),
    workspaceFolder: config_string(value, "workspaceFolder"),
    applicationEntry: config_string(value, "applicationEntry"),
    applicationExport: config_string(value, "applicationExport"),
    hsonLiveNodeEntry: config_string(value, "hsonLiveNodeEntry"),
    hsonLiveVersion: config_string(value, "hsonLiveVersion"),
    port: Number(value.port),
  });
}

function config_string(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== "string" || field.length === 0) throw new Error(`Invalid local-host runner configuration field ${key}.`);
  return field;
}

function normalize_applications(value: unknown): readonly Application[] {
  const applications = Array.isArray(value) ? value : [value];
  if (applications.length === 0 || !applications.every(is_application)) {
    throw new Error(`Export '${config.applicationExport}' must be a LiveHostApplication, an array of applications, or a zero-argument factory returning either.`);
  }
  return Object.freeze([...applications]);
}

function is_application(value: unknown): value is Application {
  return is_record(value) && typeof value.name === "string" && value.name.length > 0 && typeof value.dispose === "function";
}

function is_application_factory(value: unknown): value is ApplicationFactory {
  return typeof value === "function";
}

function is_livehost_node_module(value: unknown): value is LiveHostNodeModule {
  return is_record(value)
    && typeof value.assert_supported_livehost_node_runtime === "function"
    && typeof value.start_node_application_host === "function";
}

function is_record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

void main().catch(error => {
  fail("configuration", error);
  request_stop();
}).finally(() => {
  settleStartup();
  if (stopping) void shutdown();
});
