import type { ExactDataCarrier } from "../data/hson-data.js";
import { encode_hson_data_internal } from "../data/hson-data.js";
import { decode_locus_message } from "./locus.protocol.js";
import { LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT } from "./locus.aggregate.protocol.js";
import type { LocusFiniteOperationRequest } from "./locus.transport.internal.js";
import type { LocusHostedAggregateSynchronizationRequest } from "./locus.aggregate.transport.internal.js";

type HostedRequest = LocusFiniteOperationRequest | LocusHostedAggregateSynchronizationRequest;
const MAX_RECOVERY_REQUEST_ID_BYTES = 1_024;

export function encode_downstream_message(message: unknown, limit: number): string {
  const semantic = exact_record(message, "Hosted aggregate semantic output");
  let framed: Readonly<Record<string, unknown>>;
  if (semantic.type === "synchronization-failure" && is_record(semantic.error)) {
    const cause = is_record(semantic.error.cause) ? semantic.error.cause : undefined;
    framed = Object.freeze({
      type: "error",
      format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT,
      ...(typeof cause?.id === "string" ? { id: cause.id } : {}),
      code: typeof semantic.error.code === "string" ? semantic.error.code : "LOCUS_SYNC_FAILED",
      message: semantic.error.message,
    });
  } else if (semantic.type === "ack" && Object.hasOwn(semantic, "result")) {
    const { result, ...rest } = semantic;
    framed = Object.freeze({
      ...rest,
      format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT,
      ...(result === undefined ? {} : { resultData: encode_hson_data_internal(result as ExactDataCarrier) }),
    });
  } else if (semantic.type === "action-status" && is_record(semantic.outcome)
    && semantic.outcome.state === "succeeded" && Object.hasOwn(semantic.outcome, "result")) {
    const { result, ...outcome } = semantic.outcome;
    framed = Object.freeze({
      ...semantic,
      format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT,
      outcome: Object.freeze({
        ...outcome,
        ...(result === undefined ? {} : { resultData: encode_hson_data_internal(result as ExactDataCarrier) }),
      }),
    });
  } else {
    framed = Object.freeze({ ...semantic, format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT });
  }
  const raw = JSON.stringify(framed);
  if (utf8_bytes(raw) > limit) throw new Error("Hosted aggregate socket message exceeds its configured byte limit.");
  return raw;
}

function is_record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}


export function decode_request(raw: string, maxWireBytes: number): HostedRequest {
  if (typeof raw !== "string" || utf8_bytes(raw) > maxWireBytes) throw new Error("Hosted aggregate request is malformed or exceeds its byte limit.");
  const value = exact_record(JSON.parse(raw), "Hosted aggregate request");
  if (value.type === "recover") {
    const hasCursor = Object.hasOwn(value, "incarnationId") || Object.hasOwn(value, "registryDigest")
      || Object.hasOwn(value, "projectionDigest") || Object.hasOwn(value, "projectionSequence")
      || Object.hasOwn(value, "lastAppliedRev") || Object.hasOwn(value, "initialStateFingerprint")
      || Object.hasOwn(value, "initialInitializerDigest") || Object.hasOwn(value, "initialSessionBinding");
    exact_keys(value, hasCursor
      ? ["type", "id", "logicalMapId", "incarnationId", "registryDigest", "projectionDigest", "projectionSequence", "lastAppliedRev",
        ...(Object.hasOwn(value, "initialStateFingerprint") ? ["initialStateFingerprint"] : []),
        ...(Object.hasOwn(value, "initialInitializerDigest") ? ["initialInitializerDigest"] : []),
        ...(Object.hasOwn(value, "initialSessionBinding") ? ["initialSessionBinding"] : [])]
      : ["type", "id", "logicalMapId"], "Hosted recovery request");
    const id = required_string(value.id);
    const logicalMapId = required_string(value.logicalMapId);
    if (id === undefined || logicalMapId === undefined) throw new Error("Hosted recovery request requires non-empty id and logicalMapId.");
    if (utf8_bytes(id) > MAX_RECOVERY_REQUEST_ID_BYTES) throw new Error("Hosted recovery request ID exceeds its byte limit.");
    if (!hasCursor) return Object.freeze({ type: "recover", id, logicalMapId });
    const incarnationId = required_string(value.incarnationId);
    const registryDigest = required_digest(value.registryDigest);
    const projectionDigest = required_digest(value.projectionDigest);
    const projectionSequence = required_revision(value.projectionSequence);
    const lastAppliedRev = required_revision(value.lastAppliedRev);
    const initialStateFingerprint = Object.hasOwn(value, "initialStateFingerprint")
      ? required_digest(value.initialStateFingerprint) : undefined;
    const initialInitializerDigest = Object.hasOwn(value, "initialInitializerDigest")
      ? required_digest(value.initialInitializerDigest) : undefined;
    const initialSessionBinding = Object.hasOwn(value, "initialSessionBinding")
      ? required_string(value.initialSessionBinding) : undefined;
    if (incarnationId === undefined || registryDigest === undefined || projectionDigest === undefined
      || projectionSequence === undefined || lastAppliedRev === undefined
      || (Object.hasOwn(value, "initialStateFingerprint") && initialStateFingerprint === undefined)
      || (Object.hasOwn(value, "initialInitializerDigest") && initialInitializerDigest === undefined)
      || (Object.hasOwn(value, "initialSessionBinding")
        && (initialSessionBinding === undefined || !/^[a-f0-9]{32}$/u.test(initialSessionBinding)))) throw new Error("Hosted recovery cursor is malformed.");
    return Object.freeze({ type: "recover", id, logicalMapId,
      cursor: Object.freeze({ incarnationId, registryDigest, projectionDigest, projectionSequence, lastAppliedRev,
        ...(initialStateFingerprint === undefined ? {} : { initialStateFingerprint }),
        ...(initialInitializerDigest === undefined ? {} : { initialInitializerDigest }),
        ...(initialSessionBinding === undefined ? {} : { initialSessionBinding }) }) });
  }
  if (value.type === "session-create" || value.type === "session-goodbye" || value.type === "session-detach") {
    const decoded = decode_locus_message(raw);
    if (!decoded.ok || (decoded.value.type !== "session-create" && decoded.value.type !== "session-goodbye"
      && decoded.value.type !== "session-detach")) throw new Error(decoded.ok ? "Hosted session request is malformed." : decoded.error.message);
    return decoded.value;
  }
  if (value.type === "session-attach") {
    const decoded = decode_locus_message(raw);
    if (!decoded.ok || decoded.value.type !== "session-attach") throw new Error(decoded.ok ? "Hosted session-attach request is malformed." : decoded.error.message);
    return decoded.value;
  }
  if (value.type === "action-status") {
    const decoded = decode_locus_message(raw);
    if (!decoded.ok || decoded.value.type !== "action-status") throw new Error(decoded.ok ? "Hosted action-status request is malformed." : decoded.error.message);
    return decoded.value;
  }
  if (value.type === "action") {
    const decoded = decode_locus_message(raw);
    if (!decoded.ok || decoded.value.type !== "action") throw new Error(decoded.ok ? "Hosted action request is malformed." : decoded.error.message);
    return decoded.value;
  }
  throw new Error("Hosted aggregate request type is unknown.");
}

function utf8_bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
function exact_record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new Error(`${label} is malformed.`);
  }
  return value as Record<string, unknown>;
}
function exact_keys(value: Readonly<Record<string, unknown>>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value);
  if (actual.length !== expected.length || !expected.every((key) => Object.hasOwn(value, key))) {
    throw new Error(`${label} contains missing or unexpected fields.`);
  }
}

function required_string(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
function required_digest(value: unknown): string | undefined {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value) ? value : undefined;
}

function required_revision(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
