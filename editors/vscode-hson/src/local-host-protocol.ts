export type LocalHostStopRequest = Readonly<{
  type: "stop";
}>;

export type LocalHostChildMessage =
  | Readonly<{
      type: "starting";
      projectId: string;
      applicationEntry: string;
      nodeVersion: string;
    }>
  | Readonly<{
      type: "hello";
      projectId: string;
      applicationNames: readonly string[];
      hsonLiveVersion: string;
      nodeVersion: string;
    }>
  | Readonly<{
      type: "ready";
      projectId: string;
      httpUrl: string;
      port: number;
    }>
  | Readonly<{
      type: "failure";
      projectId: string;
      phase: "configuration" | "runtime" | "application" | "hosting" | "shutdown";
      error: LocalHostErrorEvidence;
    }>
  | Readonly<{
      type: "stopped";
      projectId: string;
    }>;

export function local_host_stop_request(): LocalHostStopRequest {
  return Object.freeze({ type: "stop" });
}

export function parse_local_host_stop_request(value: unknown): LocalHostStopRequest | undefined {
  if (!is_record(value) || !exact_keys(value, ["type"]) || value.type !== "stop") return undefined;
  return local_host_stop_request();
}

export function parse_local_host_child_message(value: unknown): LocalHostChildMessage | undefined {
  if (!is_record(value) || typeof value.type !== "string") return undefined;
  if (value.type === "starting") {
    if (!exact_keys(value, ["type", "projectId", "applicationEntry", "nodeVersion"]) || !has_strings(value, "projectId", "applicationEntry", "nodeVersion")) return undefined;
    return Object.freeze({ type: "starting", projectId: value.projectId, applicationEntry: value.applicationEntry, nodeVersion: value.nodeVersion });
  }
  if (value.type === "hello") {
    if (!exact_keys(value, ["type", "projectId", "applicationNames", "hsonLiveVersion", "nodeVersion"]) || !has_strings(value, "projectId", "hsonLiveVersion", "nodeVersion") || !is_string_array(value.applicationNames)) return undefined;
    return Object.freeze({ type: "hello", projectId: value.projectId, applicationNames: Object.freeze([...value.applicationNames]), hsonLiveVersion: value.hsonLiveVersion, nodeVersion: value.nodeVersion });
  }
  if (value.type === "ready") {
    if (!exact_keys(value, ["type", "projectId", "httpUrl", "port"]) || !has_strings(value, "projectId", "httpUrl") || !is_port(value.port) || !is_loopback_local_host_url(value.httpUrl, value.port)) return undefined;
    return Object.freeze({ type: "ready", projectId: value.projectId, httpUrl: value.httpUrl, port: value.port });
  }
  if (value.type === "failure") {
    if (!exact_keys(value, ["type", "projectId", "phase", "error"]) || !has_strings(value, "projectId") || !is_failure_phase(value.phase) || !is_error_evidence(value.error)) return undefined;
    return Object.freeze({ type: "failure", projectId: value.projectId, phase: value.phase, error: value.error });
  }
  if (value.type === "stopped") {
    if (!exact_keys(value, ["type", "projectId"]) || !has_strings(value, "projectId")) return undefined;
    return Object.freeze({ type: "stopped", projectId: value.projectId });
  }
  return undefined;
}

function is_record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function exact_keys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every(key => expected.includes(key));
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

// Local Host IPC evidence only. Limits apply to the whole record, including
// Schema issues and grouped causes; no stack parsing or source-map guessing.
export type LocalHostFailureValue = null | boolean | number | string | readonly LocalHostFailureValue[] | { readonly [key: string]: LocalHostFailureValue };
export type LocalHostErrorEvidence = Readonly<{
  message: string;
  name?: string;
  code?: string | number;
  stack?: string;
  cause?: LocalHostErrorEvidence;
  errors?: readonly LocalHostErrorEvidence[];
  issues?: LocalHostFailureValue;
  details?: LocalHostFailureValue;
}>;

const detailKeys = ["source", "fileName", "file", "url", "range", "path", "operation", "stage", "related", "address", "port", "syscall"];
const evidenceKeys = ["message", "name", "code", "stack", "cause", "errors", "issues", "details"];
const omitted = "[Local Host evidence truncated or circular]";

// Transport text is counted in UTF-16 code units (including object keys),
// not encoded bytes. Multibyte records therefore still require IPC draining.
const evidenceLimits = { nodes: 16_384, characters: 128_000, depth: 20, collection: 33, causes: 9 };
function evidence_budget() {
  let nodes = evidenceLimits.nodes, characters = evidenceLimits.characters;
  return (size = 0): boolean => --nodes >= 0 && (characters -= size) >= 0;
}

export function capture_local_host_error(thrown: unknown): LocalHostErrorEvidence {
  const seen = new Set<unknown>(), budget = evidence_budget();
  let exhausted = false;
  const take = (size = 0): boolean => { const accepted = budget(size); exhausted ||= !accepted; return accepted; };
  // Reserve a root truncation notice even when the final optional field fails.
  take(omitted.length);
  let visits = 512;
  const read = (value: unknown, key: string): unknown => {
    try { return value !== null && (typeof value === "object" || typeof value === "function") ? Reflect.get(value, key) : undefined; }
    catch { return "[Unreadable property]"; }
  };
  // Reserve the complete string, including its marker, before publishing it.
  const text = (value: string): string | undefined => {
    const clipped = value.length > 16_000 ? value.slice(0, 16_000 - omitted.length) + omitted : value;
    return take(clipped.length) ? clipped : undefined;
  };
  const field = (key: string): boolean => take(key.length);
  const json = (value: unknown, depth: number): LocalHostFailureValue | undefined => {
    if (--visits < 0 || depth > 8 || seen.has(value)) return text(omitted);
    if (typeof value === "string") return text(value);
    if (value === null || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return take() ? value : undefined;
    if (typeof value !== "object") { try { return text(String(value)); } catch { return text("[Unprintable thrown value]"); } }
    if (!take()) return undefined;
    seen.add(value);
    try {
      if (Array.isArray(value)) {
        const result: LocalHostFailureValue[] = [];
        for (let i = 0; i < Math.min(value.length, 32); i++) {
          const item = json(read(value, String(i)), depth + 1);
          if (item === undefined) break;
          result.push(item);
        }
        if (value.length > result.length) { const marker = text(omitted); if (marker !== undefined) result.push(marker); }
        return result;
      }
      const result: Record<string, LocalHostFailureValue> = Object.create(null);
      const keys = Object.keys(value);
      for (const key of keys.slice(0, 32)) {
        // Key clipping must use the same accounting as string values.
        const name = text(key); if (name === undefined) break;
        const item = json(read(value, key), depth + 1); if (item === undefined) break;
        result[name] = item;
      }
      if (keys.length > Object.keys(result).length && field("[truncated]")) { const marker = text(omitted); if (marker !== undefined) result["[truncated]"] = marker; }
      return result;
    } catch { return text("[Unreadable thrown value]"); }
    finally { seen.delete(value); }
  };
  const capture = (value: unknown, depth: number): LocalHostErrorEvidence | undefined => {
    if (!take() || !field("message")) return undefined;
    const truncated = --visits < 0 || depth > 8 || seen.has(value);
    const message = truncated ? omitted : read(value, "message");
    const description = typeof message === "string" ? message : typeof value === "string" ? value : JSON.stringify(json(value, depth)) ?? "Unknown Local Host failure";
    const captured = text(description || "Unknown Local Host failure");
    if (captured === undefined) return undefined;
    const result: { -readonly [K in keyof LocalHostErrorEvidence]: LocalHostErrorEvidence[K] } = { message: captured };
    if (truncated) return result;
    seen.add(value);
    for (const key of ["name", "stack"] as const) { const item = read(value, key); if (typeof item === "string" && field(key)) result[key] = text(item); }
    const code = read(value, "code");
    if ((typeof code === "string" || typeof code === "number" && Number.isFinite(code)) && field("code")) result.code = typeof code === "string" ? text(code) : take() ? code : undefined;
    const cause = read(value, "cause"), errors = read(value, "errors"), issues = read(value, "issues");
    if (cause !== undefined && field("cause")) result.cause = capture(cause, depth + 1);
    try {
      if (Array.isArray(errors) && field("errors") && take()) {
        const members: LocalHostErrorEvidence[] = [];
        for (let i = 0; i < Math.min(errors.length, 32); i++) { const item = capture(read(errors, String(i)), depth + 1); if (item === undefined) break; members.push(item); }
        if (errors.length > members.length) { const marker = capture(omitted, 9); if (marker !== undefined) members.push(marker); }
        result.errors = members;
      }
    } catch { if (field("errors") && take()) { const marker = capture("[Unreadable aggregate members]", depth + 1); if (marker !== undefined) result.errors = [marker]; } }
    if (issues !== undefined && field("issues")) result.issues = json(issues, depth + 1);
    if (field("details") && take()) {
      const details: Record<string, LocalHostFailureValue> = Object.create(null);
      for (const key of detailKeys) { const item = read(value, key); if (item !== undefined && field(key)) { const captured = json(item, depth + 1); if (captured !== undefined) details[key] = captured; } }
      if (Object.keys(details).length > 0) result.details = details;
    }
    seen.delete(value);
    return result;
  };
  const result = capture(thrown, 0) ?? { message: omitted };
  return exhausted ? { ...result, message: result.message + omitted } : result;
}

function is_error_evidence(value: unknown): value is LocalHostErrorEvidence {
  const take = evidence_budget();
  const json = (item: unknown, depth: number): boolean => {
    if (depth > evidenceLimits.depth) return false;
    if (!take(typeof item === "string" ? item.length : 0)) return false;
    if (typeof item === "string") return true;
    if (item === null || typeof item === "boolean" || typeof item === "number" && Number.isFinite(item)) return true;
    if (Array.isArray(item)) return item.length <= evidenceLimits.collection && item.every(entry => json(entry, depth + 1));
    return is_record(item) && Object.keys(item).length <= evidenceLimits.collection && Object.entries(item).every(([key, entry]) => entry === undefined || json(key, depth + 1) && json(entry, depth + 1));
  };
  const evidence = (item: unknown, depth: number): boolean => {
    if (depth > evidenceLimits.causes || !is_record(item) || typeof item.message !== "string" || item.message.length === 0 || !Object.keys(item).every(key => evidenceKeys.includes(key))) return false;
    if (["name", "stack"].some(key => item[key] !== undefined && typeof item[key] !== "string")) return false;
    if (item.code !== undefined && typeof item.code !== "string" && typeof item.code !== "number") return false;
    return (item.cause === undefined || evidence(item.cause, depth + 1))
      && (item.errors === undefined || Array.isArray(item.errors) && item.errors.length <= evidenceLimits.collection && item.errors.every(entry => evidence(entry, depth + 1)));
  };
  return json(value, 0) && evidence(value, 0);
}

export function local_host_error_summary(error: LocalHostErrorEvidence): string {
  // Transform messages contain a wrapper followed by the actual explanation.
  const message = error.message.replace(/^\[ERR: transform = [^\n]+\]:\s*->\s*/, "").replace(/\s+/g, " ").trim();
  // Binding translation is already actionable; its system cause stays in Output.
  if (error.code === "EADDRINUSE" && error.cause?.code === "EADDRINUSE") return message.slice(0, 240);
  const issue = Array.isArray(error.issues) ? error.issues.find(item => is_record(item) && typeof item.message === "string") : undefined;
  const causes = error.cause === undefined ? error.errors ?? [] : [error.cause];
  const explanation = causes.map(local_host_error_summary).filter(text => !text.startsWith("[Local Host evidence"))[0]
    ?? (is_record(issue) && typeof issue.message === "string" ? issue.message.replace(/\s+/g, " ").trim() : undefined);
  const summary = explanation !== undefined && !message.includes(explanation) ? `${explanation} (${message})` : message;
  return summary.length > 240 ? `${summary.slice(0, 239)}…` : summary;
}

export function local_host_error_details(error: LocalHostErrorEvidence): string {
  const { stack, cause, errors, ...fields } = error;
  return [JSON.stringify(fields, null, 2), stack,
    cause === undefined ? undefined : `Caused by:\n${local_host_error_details(cause)}`,
    ...(errors ?? []).map((member, index) => `Aggregate member ${index + 1}:\n${local_host_error_details(member)}`),
  ].filter(part => part !== undefined).join("\n");
}
