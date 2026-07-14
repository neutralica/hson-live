// livehost/protocol.ts

import type {
  LiveHostClientActionMessage,
  LiveHostClientHelloMessage,
  LiveHostClientMessage,
  LiveHostClientSubscribeMessage,
  LiveHostClientUnsubscribeMessage,
  LiveHostError,
  LiveHostResult,
  LiveHostServerMessage,
  LiveHostServerEventMessage,
  LiveHostActionPayloads,
} from "../../types/livehost.types.js";
import type { JsonValue, LivePath } from "../../types/index.js";

function ok<T>(value: T): LiveHostResult<T> {
  return { ok: true, value };
}

function fail(message: string, extra?: Omit<LiveHostError, "message">): LiveHostResult<never> {
  return { ok: false, error: { message, ...extra } };
}

function is_record(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function has_exact_keys(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

export function is_livehost_json_value(value: unknown): value is JsonValue {
  if (value === null) return true;
  const kind = typeof value;
  if (kind === "string" || kind === "boolean") return true;
  if (kind === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(is_livehost_json_value);
  if (!is_record(value)) return false;
  return Object.values(value).every(is_livehost_json_value);
}

function is_live_path(value: unknown): value is LivePath {
  return Array.isArray(value)
    && value.every((part) => typeof part === "string" || typeof part === "number");
}

function optional_string(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optional_seq(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function decode_hello_message(value: Readonly<Record<string, unknown>>): LiveHostResult<LiveHostClientHelloMessage> {
  const clientId = optional_string(value.clientId);
  const hostId = optional_string(value.hostId);
  const lastSeq = optional_seq(value.lastSeq);

  return ok({
    type: "hello",
    ...(clientId ? { clientId } : {}),
    ...(hostId ? { hostId } : {}),
    ...(lastSeq !== undefined ? { lastSeq } : {}),
  });
}

function decode_action_message<TActions extends LiveHostActionPayloads>(value: Readonly<Record<string, unknown>>): LiveHostResult<LiveHostClientActionMessage<TActions>> {
  const id = optional_string(value.id);
  if (!id) return fail("LiveHost action message requires string id.");

  const name = optional_string(value.name);
  if (!name) return fail("LiveHost action message requires string name.");

  const payload = value.payload;
  if (payload !== undefined && !is_livehost_json_value(payload)) {
    return fail("LiveHost action payload must be JSON-serializable.");
  }

  const message = {
    type: "action",
    id,
    name,
    ...(payload !== undefined ? { payload } : {}),
  } as LiveHostClientActionMessage<TActions>;

  return ok(message);
}

function decode_subscribe_message(value: Readonly<Record<string, unknown>>): LiveHostResult<LiveHostClientSubscribeMessage> {
  if (!is_live_path(value.path)) return fail("LiveHost subscribe message requires path.");
  return ok({ type: "subscribe", path: value.path });
}

function decode_unsubscribe_message(value: Readonly<Record<string, unknown>>): LiveHostResult<LiveHostClientUnsubscribeMessage> {
  if (!is_live_path(value.path)) return fail("LiveHost unsubscribe message requires path.");
  return ok({ type: "unsubscribe", path: value.path });
}

export function encode_livehost_message(message: LiveHostServerMessage): string {
  if (message.type === "event") {
    if (!message.event) throw new Error("LiveHost event message requires non-empty event.");
    if (!is_livehost_json_value(message.payload)) {
      throw new Error("LiveHost event payload must be JSON-serializable.");
    }
  }
  return JSON.stringify(message);
}

function decode_server_event_message(value: Readonly<Record<string, unknown>>): LiveHostResult<LiveHostServerEventMessage> {
  if (!has_exact_keys(value, ["type", "event", "payload"])) {
    return fail("LiveHost event message requires exactly type, event, and payload.");
  }
  if (typeof value.event !== "string" || value.event.length === 0) {
    return fail("LiveHost event message requires non-empty event.");
  }
  if (!Object.prototype.hasOwnProperty.call(value, "payload") || !is_livehost_json_value(value.payload)) {
    return fail("LiveHost event payload must be JSON-serializable.");
  }
  return ok({ type: "event", event: value.event, payload: value.payload });
}

export function decode_livehost_server_message(message: string): LiveHostResult<LiveHostServerMessage> {
  try {
    const value = JSON.parse(message) as unknown;
    if (!is_record(value)) return fail("LiveHost server message must be an object.");
    if (value.type === "event") return decode_server_event_message(value);
    if (
      value.type === "hello"
      || value.type === "patch"
      || value.type === "sync"
      || value.type === "ack"
      || value.type === "error"
    ) {
      return ok(value as LiveHostServerMessage);
    }
    return fail("Unknown LiveHost server message type.");
  } catch (cause) {
    return fail("Invalid LiveHost server message JSON.", { cause });
  }
}

export function decode_livehost_message<TActions extends LiveHostActionPayloads = LiveHostActionPayloads>(message: string): LiveHostResult<LiveHostClientMessage<TActions>> {
  try {
    const value = JSON.parse(message) as unknown;
    if (!is_record(value)) return fail("LiveHost message must be an object.");

    const type = value.type;
    if (type === "hello") return decode_hello_message(value);
    if (type === "action") return decode_action_message<TActions>(value);
    if (type === "subscribe") return decode_subscribe_message(value);
    if (type === "unsubscribe") return decode_unsubscribe_message(value);

    return fail("Unknown LiveHost message type.");
  } catch (cause) {
    return fail("Invalid LiveHost message JSON.", { cause });
  }
}
