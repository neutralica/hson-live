export const LOCAL_HOST_PROTOCOL_VERSION = 1 as const;

export type LocalHostStopRequest = Readonly<{
  protocolVersion: typeof LOCAL_HOST_PROTOCOL_VERSION;
  type: "stop";
}>;

export type LocalHostChildMessage =
  | Readonly<{
      protocolVersion: typeof LOCAL_HOST_PROTOCOL_VERSION;
      type: "starting";
      projectId: string;
      applicationEntry: string;
      nodeVersion: string;
    }>
  | Readonly<{
      protocolVersion: typeof LOCAL_HOST_PROTOCOL_VERSION;
      type: "hello";
      projectId: string;
      applicationNames: readonly string[];
      hsonLiveVersion: string;
      nodeVersion: string;
    }>
  | Readonly<{
      protocolVersion: typeof LOCAL_HOST_PROTOCOL_VERSION;
      type: "ready";
      projectId: string;
      httpUrl: string;
      port: number;
    }>
  | Readonly<{
      protocolVersion: typeof LOCAL_HOST_PROTOCOL_VERSION;
      type: "failure";
      projectId: string;
      phase: "configuration" | "runtime" | "application" | "hosting" | "shutdown";
      message: string;
    }>
  | Readonly<{
      protocolVersion: typeof LOCAL_HOST_PROTOCOL_VERSION;
      type: "stopped";
      projectId: string;
    }>;

export function local_host_stop_request(): LocalHostStopRequest {
  return Object.freeze({ protocolVersion: LOCAL_HOST_PROTOCOL_VERSION, type: "stop" });
}

export function parse_local_host_stop_request(value: unknown): LocalHostStopRequest | undefined {
  if (!is_record(value) || value.protocolVersion !== LOCAL_HOST_PROTOCOL_VERSION || value.type !== "stop") return undefined;
  return local_host_stop_request();
}

export function parse_local_host_child_message(value: unknown): LocalHostChildMessage | undefined {
  if (!is_record(value) || value.protocolVersion !== LOCAL_HOST_PROTOCOL_VERSION || typeof value.type !== "string") return undefined;
  if (value.type === "starting") {
    if (!has_strings(value, "projectId", "applicationEntry", "nodeVersion")) return undefined;
    return Object.freeze({ protocolVersion: LOCAL_HOST_PROTOCOL_VERSION, type: "starting", projectId: value.projectId, applicationEntry: value.applicationEntry, nodeVersion: value.nodeVersion });
  }
  if (value.type === "hello") {
    if (!has_strings(value, "projectId", "hsonLiveVersion", "nodeVersion") || !is_string_array(value.applicationNames)) return undefined;
    return Object.freeze({ protocolVersion: LOCAL_HOST_PROTOCOL_VERSION, type: "hello", projectId: value.projectId, applicationNames: Object.freeze([...value.applicationNames]), hsonLiveVersion: value.hsonLiveVersion, nodeVersion: value.nodeVersion });
  }
  if (value.type === "ready") {
    if (!has_strings(value, "projectId", "httpUrl") || !is_port(value.port) || !is_loopback_local_host_url(value.httpUrl, value.port)) return undefined;
    return Object.freeze({ protocolVersion: LOCAL_HOST_PROTOCOL_VERSION, type: "ready", projectId: value.projectId, httpUrl: value.httpUrl, port: value.port });
  }
  if (value.type === "failure") {
    if (!has_strings(value, "projectId", "message") || !is_failure_phase(value.phase)) return undefined;
    return Object.freeze({ protocolVersion: LOCAL_HOST_PROTOCOL_VERSION, type: "failure", projectId: value.projectId, phase: value.phase, message: value.message });
  }
  if (value.type === "stopped") {
    if (!has_strings(value, "projectId")) return undefined;
    return Object.freeze({ protocolVersion: LOCAL_HOST_PROTOCOL_VERSION, type: "stopped", projectId: value.projectId });
  }
  return undefined;
}

function is_record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function has_strings<Value extends Record<string, unknown>, Keys extends readonly string[]>(value: Value, ...keys: Keys): value is Value & { [Key in Keys[number]]: string } {
  return keys.every(key => typeof value[key] === "string" && value[key].length > 0);
}

function is_string_array(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(item => typeof item === "string" && item.length > 0);
}

function is_port(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 65_535;
}

function is_failure_phase(value: unknown): value is Extract<LocalHostChildMessage, { type: "failure" }>["phase"] {
  return value === "configuration" || value === "runtime" || value === "application" || value === "hosting" || value === "shutdown";
}

export function is_loopback_local_host_url(value: string, port: number): boolean {
  try {
    const url = new URL(value);
    const effectivePort = url.port === "" ? url.protocol === "http:" ? 80 : url.protocol === "https:" ? 443 : 0 : Number(url.port);
    return (url.protocol === "http:" || url.protocol === "https:")
      && url.hostname === "127.0.0.1"
      && effectivePort === port
      && url.username === ""
      && url.password === "";
  } catch {
    return false;
  }
}
