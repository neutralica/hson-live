import type { LocusClientMessage, LocusServerMessage } from "../../types/locus.types.js";
import type { EchoSynchronizationRequest } from "../../types/echo.transport.types.js";
import { decode_hson_data_internal, encode_hson_data_internal, admit_hson_data_input, hson_data_text } from "../data/hson-data.js";
import { DEFAULT_LOCUS_HOSTED_AGGREGATE_MAX_WIRE_BYTES } from "../locus/locus.aggregate.protocol.js";

export type EchoWebSocketControlMessage = Extract<LocusServerMessage, { type: "session-fenced" }> | import("../../types/echo.transport.types.js").EchoFiniteOperationOutcome;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRevision(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value >= 0;
}

function isLivePath(value: unknown): value is readonly (string | number)[] {
  return Array.isArray(value) && value.every((part) => typeof part === "string"
    || (typeof part === "number" && Number.isSafeInteger(part) && part >= 0));
}

function hasExactKeys(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

export function encodeEndpointMessage(message: LocusClientMessage | EchoSynchronizationRequest): string {
  if (message.type !== "action") return JSON.stringify(message);
  const { payload, ...rest } = message;
  return JSON.stringify({
    ...rest,
    ...(payload === undefined ? {} : { payloadData: encode_hson_data_internal(admit_hson_data_input(payload)) }),
  });
}

/** @internal Endpoint-only wire admission without importing replica protocol machinery. */
export function decodeEndpointMessage(raw: string, format?: string): EchoWebSocketControlMessage | undefined {
  if (new TextEncoder().encode(raw).byteLength > DEFAULT_LOCUS_HOSTED_AGGREGATE_MAX_WIRE_BYTES) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(value) || !isNonemptyString(value.type)) return undefined;
  const exactKeys = (keys: readonly string[]): boolean => hasExactKeys(value, format === undefined ? keys : [...keys, "format"])
    && (format === undefined || value.format === format);
  if (value.type === "ack") {
    const resultPresent = Object.hasOwn(value, "resultData");
    const requestIdPresent = Object.hasOwn(value, "requestId");
    const attemptIdPresent = Object.hasOwn(value, "attemptId");
    const completionRevPresent = Object.hasOwn(value, "completionRev");
    const deliveryPresent = Object.hasOwn(value, "delivery");
    if (!exactKeys([
      "type", "id", "ok", "seq",
      ...(resultPresent ? ["resultData"] : []),
      ...(requestIdPresent ? ["requestId"] : []),
      ...(attemptIdPresent ? ["attemptId"] : []),
      ...(completionRevPresent ? ["completionRev"] : []),
      ...(deliveryPresent ? ["delivery"] : []),
    ]) || !isNonemptyString(value.id) || value.ok !== true || !isRevision(value.seq)
      || (requestIdPresent && !isNonemptyString(value.requestId))
      || (attemptIdPresent && !isNonemptyString(value.attemptId))
      || (completionRevPresent && !isRevision(value.completionRev))
      || (deliveryPresent && value.delivery !== "executed" && value.delivery !== "joined" && value.delivery !== "cached" && value.delivery !== "rejected")
      || (resultPresent && typeof value.resultData !== "string")) return undefined;
    try {
      const result = resultPresent ? hson_data_text(decode_hson_data_internal(value.resultData as string)) : undefined;
      return Object.freeze({
        type: "ack",
        id: value.id,
        ok: true,
        seq: value.seq,
        ...(requestIdPresent ? { requestId: value.requestId } : {}),
        ...(attemptIdPresent ? { attemptId: value.attemptId } : {}),
        ...(completionRevPresent ? { completionRev: value.completionRev } : {}),
        ...(deliveryPresent ? { delivery: value.delivery } : {}),
        ...(result === undefined ? {} : { result }),
      }) as EchoWebSocketControlMessage;
    } catch {
      return undefined;
    }
  }
  if (value.type === "action-status") {
    if (!isNonemptyString(value.id) || !isNonemptyString(value.requestId)
      || (value.state !== "pending" && value.state !== "succeeded" && value.state !== "failed" && value.state !== "unknown" && value.state !== "expired")) return undefined;
    if (value.state === "pending" || value.state === "unknown" || value.state === "expired") {
      return exactKeys(["type", "id", "requestId", "state"])
        ? value as EchoWebSocketControlMessage
        : undefined;
    }
    if (!exactKeys(["type", "id", "requestId", "state", "outcome"]) || !isRecord(value.outcome)
      || value.outcome.state !== value.state || !isRevision(value.outcome.seq) || !isRevision(value.outcome.completionRev)) return undefined;
    if (value.state === "succeeded") {
      const resultPresent = Object.hasOwn(value.outcome, "resultData");
      if (!hasExactKeys(value.outcome, ["state", "seq", "completionRev", ...(resultPresent ? ["resultData"] : [])])
        || (resultPresent && typeof value.outcome.resultData !== "string")) return undefined;
      try {
        const result = resultPresent ? hson_data_text(decode_hson_data_internal(value.outcome.resultData as string)) : undefined;
        return Object.freeze({
          type: "action-status",
          id: value.id,
          requestId: value.requestId,
          state: value.state,
          outcome: Object.freeze({
            state: value.state,
            seq: value.outcome.seq,
            completionRev: value.outcome.completionRev,
            ...(result === undefined ? {} : { result }),
          }),
        }) as EchoWebSocketControlMessage;
      } catch {
        return undefined;
      }
    }
    if (!hasExactKeys(value.outcome, ["state", "seq", "completionRev", "error"])
      || !isRecord(value.outcome.error) || !isNonemptyString(value.outcome.error.message)
      || (Object.hasOwn(value.outcome.error, "code") && typeof value.outcome.error.code !== "string")) return undefined;
    return value as EchoWebSocketControlMessage;
  }
  if (value.type === "error") {
    if (!isRecord(value.error)) return undefined;
    const error = value.error;
    const optional = ["id", "ok", "requestId", "attemptId", "completionRev", "delivery"]
      .filter((key) => Object.hasOwn(value, key));
    if (!exactKeys(["type", "seq", "error", ...optional])
      || !isNonemptyString(error.message)
      || !hasExactKeys(error, ["message", ...["code", "path", "cause"]
        .filter((key) => Object.hasOwn(error, key))])
      || !isRevision(value.seq)
      || (Object.hasOwn(value, "id") && !isNonemptyString(value.id))
      || (Object.hasOwn(value, "ok") && value.ok !== false)
      || (Object.hasOwn(value, "requestId") && !isNonemptyString(value.requestId))
      || (Object.hasOwn(value, "attemptId") && !isNonemptyString(value.attemptId))
      || (Object.hasOwn(value, "completionRev") && !isRevision(value.completionRev))
      || (Object.hasOwn(value, "delivery") && value.delivery !== "executed" && value.delivery !== "joined"
        && value.delivery !== "cached" && value.delivery !== "rejected")
      || (Object.hasOwn(error, "code") && !isNonemptyString(error.code))
      || (Object.hasOwn(error, "path") && !isLivePath(error.path))) return undefined;
    return value as EchoWebSocketControlMessage;
  }
  if (value.type === "session-fenced") {
    if (!exactKeys(["type", "sessionId", "epoch", "code"])
      || !isNonemptyString(value.sessionId)
      || !isRevision(value.epoch)
      || value.code !== "LOCUS_SESSION_ATTACHMENT_FENCED") return undefined;
    return value as EchoWebSocketControlMessage;
  }
  if (value.type === "session-created") {
    if (!exactKeys(["type", "id", "sessionId", "credential", "epoch", "logicalMapId", "incarnationId"])
      || !isNonemptyString(value.id)
      || !isNonemptyString(value.sessionId)
      || !isNonemptyString(value.credential)
      || !isRevision(value.epoch)
      || !isNonemptyString(value.logicalMapId)
      || !isNonemptyString(value.incarnationId)) return undefined;
    return value as EchoWebSocketControlMessage;
  }
  if (value.type === "session-attached") {
    if (!exactKeys(["type", "id", "sessionId", "epoch", "logicalMapId", "incarnationId"])
      || !isNonemptyString(value.id)
      || !isNonemptyString(value.sessionId)
      || !isRevision(value.epoch)
      || !isNonemptyString(value.logicalMapId)
      || !isNonemptyString(value.incarnationId)) return undefined;
    return value as EchoWebSocketControlMessage;
  }
  if (value.type === "session-rejected") {
    if (!exactKeys(["type", "id", "code", "message"])
      || !isNonemptyString(value.id)
      || !isNonemptyString(value.code)
      || !isNonemptyString(value.message)) return undefined;
    return value as EchoWebSocketControlMessage;
  }
  if (value.type === "session-ended") {
    if (!exactKeys(["type", "id", "sessionId", "epoch"])
      || !isNonemptyString(value.id)
      || !isNonemptyString(value.sessionId)
      || !isRevision(value.epoch)) return undefined;
    return value as EchoWebSocketControlMessage;
  }
  if (value.type === "session-detached") {
    if (!exactKeys(["type", "id", "sessionId", "epoch"])
      || !isNonemptyString(value.id)
      || !isNonemptyString(value.sessionId)
      || !isRevision(value.epoch)) return undefined;
    return value as EchoWebSocketControlMessage;
  }
  return undefined;
}
