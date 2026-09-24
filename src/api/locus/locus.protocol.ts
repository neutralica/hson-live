// locus/protocol.ts

import type {
  LocusClientActionMessage,
  LocusClientActionStatusMessage,
  LocusClientMessage,
  LocusClientSessionAttachMessage,
  LocusClientSessionCreateMessage,
  LocusClientSessionGoodbyeMessage,
  LocusError,
  LocusResult,
  LocusActionPayloads,
} from "../../types/locus.types.js";
import type { CssMap } from "../../core/style.types.js";
import type { JsonValue, Primitive } from "../../core/types.js";
import {
  decode_document_attrs,
  is_public_document_attr_name,
} from "../livemap/livemap.document.attrs.js";
import type {
  LiveMapDocumentAttributeValue,
  LiveMapDocumentAttrs,
  LiveMapDocumentRequestTarget,
} from "../../types/livemap.types.js";
import { validate_document_path } from "../livemap/livemap.document.path.js";
import {
  decode_hson_data_internal,
  encode_hson_data_internal,
  admit_hson_data_input,
  hson_data_text,
} from "../data/hson-data.js";
function ok<T>(value: T): LocusResult<T> {
  return { ok: true, value };
}

function fail(message: string, extra?: Omit<LocusError, "message">): LocusResult<never> {
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

export function is_locus_json_value(value: unknown): value is JsonValue {
  if (value === null) return true;
  const kind = typeof value;
  if (kind === "string" || kind === "boolean") return true;
  if (kind === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(is_locus_json_value);
  if (!is_record(value)) return false;
  return Object.values(value).every(is_locus_json_value);
}

function required_string(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function is_finite_primitive(value: unknown): value is Primitive {
  return value === null || typeof value === "string" || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value));
}

function decode_style_map(value: unknown): CssMap | undefined {
  if (!is_record(value)) return undefined;
  const decoded: Record<string, Primitive | CssMap | undefined> = {};
  for (const [key, item] of Object.entries(value)) {
    let decodedItem: Primitive | CssMap | undefined;
    if (item === undefined || is_finite_primitive(item)) decodedItem = item;
    else {
      const nested = decode_style_map(item);
      if (nested === undefined) return undefined;
      decodedItem = nested;
    }
    Object.defineProperty(decoded, key, {
      value: decodedItem,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return Object.freeze(decoded);
}

function decode_document_target(value: unknown): LiveMapDocumentRequestTarget | undefined {
  if (!is_record(value)) return undefined;
  if (value.kind === "path" && has_exact_keys(value, ["kind", "path"])) {
    try {
      return Object.freeze({ kind: "path", path: validate_document_path(value.path) });
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function decode_attribute_name(value: unknown): string | undefined {
  return is_public_document_attr_name(value) ? value : undefined;
}

function decode_attribute_value(name: string, value: unknown): LiveMapDocumentAttributeValue | undefined {
  if (is_finite_primitive(value)) return value;
  return name === "style" ? decode_style_map(value) : undefined;
}

/** Shared strict payload decoders used by graph commits and hosted document actions. */
export function decode_locus_document_target(value: unknown): LiveMapDocumentRequestTarget | undefined {
  return decode_document_target(value);
}

export function decode_locus_document_attribute_name(value: unknown): string | undefined {
  return decode_attribute_name(value);
}

export function decode_locus_document_attribute_value(
  name: string,
  value: unknown,
): LiveMapDocumentAttributeValue | undefined {
  return decode_attribute_value(name, value);
}

export function decode_locus_document_attrs(value: unknown): LiveMapDocumentAttrs | undefined {
  return decode_document_attrs(value);
}

function optional_string(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function decode_action_message<TActions extends LocusActionPayloads>(value: Readonly<Record<string, unknown>>): LocusResult<LocusClientActionMessage<TActions>> {
  const id = optional_string(value.id);
  if (!id) return fail("Locus action message requires string id.");

  const name = optional_string(value.name);
  if (!name) return fail("Locus action message requires string name.");

  const payloadPresent = Object.hasOwn(value, "payloadData");
  let payload;
  if (payloadPresent) {
    if (typeof value.payloadData !== "string") return fail("Locus action exact data must be a string.");
    try {
      payload = hson_data_text(decode_hson_data_internal(value.payloadData));
    } catch (cause) {
      return fail("Locus action exact data is malformed or noncanonical.", { cause });
    }
  }

  const requestId = optional_string(value.requestId);
  const attemptId = optional_string(value.attemptId);
  const clientId = optional_string(value.clientId);
  const hasStableIdentity = requestId !== undefined || clientId !== undefined || attemptId !== undefined || value.retry !== undefined;
  if (hasStableIdentity) {
    if (requestId === undefined) return fail("Locus action request requires requestId.", { code: "LOCUS_ACTION_REQUEST_ID_MISSING" });
    if (clientId === undefined) return fail("Locus action request requires clientId.", { code: "LOCUS_ACTION_REQUEST_ID_MISSING" });
    if (requestId.length === 0 || clientId.length === 0 || requestId.length > 256 || clientId.length > 256 || (attemptId !== undefined && (attemptId.length === 0 || attemptId.length > 256))) {
      return fail("Locus action request identity is malformed.", { code: "LOCUS_ACTION_REQUEST_ID_MALFORMED" });
    }
    if (value.retry !== undefined && value.retry !== true) {
      return fail("Locus action retry marker is malformed.", { code: "LOCUS_ACTION_REQUEST_ID_MALFORMED" });
    }
  }

  const expectedKeys = [
    "type", "id", "name",
    ...(payloadPresent ? ["payloadData"] : []),
    ...(requestId !== undefined ? ["requestId"] : []),
    ...(attemptId !== undefined ? ["attemptId"] : []),
    ...(clientId !== undefined ? ["clientId"] : []),
    ...(value.retry === true ? ["retry"] : []),
  ];
  if (!has_exact_keys(value, expectedKeys)) return fail("Locus action message has unknown or legacy fields.");

  const message = {
    type: "action",
    id,
    name,
    ...(payload !== undefined ? { payload } : {}),
    ...(requestId !== undefined ? { requestId } : {}),
    ...(attemptId !== undefined ? { attemptId } : {}),
    ...(clientId !== undefined ? { clientId } : {}),
    ...(value.retry === true ? { retry: true as const } : {}),
  } as LocusClientActionMessage<TActions>;

  return ok(message);
}

/** Encode the hard-cut exact-data client protocol. */
export function encode_locus_client_message(message: LocusClientMessage): string {
  if (message.type !== "action") return JSON.stringify(message);
  const { payload, ...rest } = message;
  return JSON.stringify({
    ...rest,
    ...(payload === undefined ? {} : { payloadData: encode_hson_data_internal(admit_hson_data_input(payload)) }),
  });
}

function decode_action_status_message(value: Readonly<Record<string, unknown>>): LocusResult<LocusClientActionStatusMessage> {
  const id = required_string(value.id);
  const clientId = required_string(value.clientId);
  const requestId = required_string(value.requestId);
  if (!id || !clientId || !requestId || clientId.length > 256 || requestId.length > 256 || !has_exact_keys(value, ["type", "id", "clientId", "requestId"])) {
    return fail("Malformed Locus action-status request.", { code: "LOCUS_ACTION_REQUEST_ID_MALFORMED" });
  }
  return ok({ type: "action-status", id, clientId, requestId });
}

function decode_session_create_message(value: Readonly<Record<string, unknown>>): LocusResult<LocusClientSessionCreateMessage> {
  const id = required_string(value.id);
  const hasProjection = Object.prototype.hasOwnProperty.call(value, "projection");
  if (!id || !has_exact_keys(value, hasProjection ? ["type", "id", "projection"] : ["type", "id"])) return fail("Malformed Locus session-create message.");
  if (!hasProjection) return ok({ type: "session-create", id });
  const input = value.projection;
  if (!is_record(input) || !Array.isArray(input.libraries)
    || input.libraries.some((name) => typeof name !== "string" || name.length === 0)
    || (input.htmlDocument !== undefined && (typeof input.htmlDocument !== "string" || input.htmlDocument.length === 0))
    || (input.systemFeatures !== undefined && (!Array.isArray(input.systemFeatures)
      || input.systemFeatures.some((feature) => feature !== "interactions")))
    || !has_exact_keys(input, ["libraries", ...(input.htmlDocument === undefined ? [] : ["htmlDocument"]),
      ...(input.systemFeatures === undefined ? [] : ["systemFeatures"])])) return fail("Malformed Locus session-create message.");
  return ok({ type: "session-create", id, projection: {
    libraries: input.libraries,
    ...(input.htmlDocument === undefined ? {} : { htmlDocument: input.htmlDocument }),
    ...(input.systemFeatures === undefined ? {} : { systemFeatures: input.systemFeatures }),
  } });
}

function decode_session_attach_message(value: Readonly<Record<string, unknown>>): LocusResult<LocusClientSessionAttachMessage> {
  const id = required_string(value.id);
  if (!id) return fail("Locus session-attach message requires non-empty id.");
  if (!has_exact_keys(value, ["type", "id", "credential"]) && !has_exact_keys(value, ["type", "id"])) {
    return fail("Malformed Locus session-attach message.");
  }
  return ok({ type: "session-attach", id, ...(Object.prototype.hasOwnProperty.call(value, "credential") ? { credential: value.credential } : {}) });
}

function decode_session_goodbye_message(value: Readonly<Record<string, unknown>>): LocusResult<LocusClientSessionGoodbyeMessage> {
  const id = required_string(value.id);
  if (!id || !has_exact_keys(value, ["type", "id"])) return fail("Malformed Locus session-goodbye message.");
  return ok({ type: "session-goodbye", id });
}

export function decode_locus_message<TActions extends LocusActionPayloads = LocusActionPayloads>(message: string): LocusResult<LocusClientMessage<TActions>> {
  try {
    const value = JSON.parse(message) as unknown;
    if (!is_record(value)) return fail("Locus message must be an object.");

    const type = value.type;
    if (type === "action") return decode_action_message<TActions>(value);
    if (type === "action-status") return decode_action_status_message(value);
    if (type === "session-create") return decode_session_create_message(value);
    if (type === "session-attach") return decode_session_attach_message(value);
    if (type === "session-goodbye") return decode_session_goodbye_message(value);

    return fail("Unknown Locus message type.");
  } catch (cause) {
    return fail("Invalid Locus message JSON.", { cause });
  }
}
