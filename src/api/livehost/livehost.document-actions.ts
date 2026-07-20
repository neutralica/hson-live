import type {
  DocumentLiveMap,
  DocumentLiveMapReadApi,
  JsonValue,
  LiveMapAuthority,
} from "../../types/index.js";
import type {
  LiveHostDocumentActionName,
} from "../../types/livehost.types.js";
import {
  decode_livehost_document_attribute_name,
  decode_livehost_document_attribute_value,
  decode_livehost_document_content,
  decode_livehost_document_target,
} from "./livehost.protocol.js";

export type LiveHostDocumentActionResolution =
  | Readonly<{ kind: "not-document-action" }>
  | Readonly<{ kind: "unavailable"; message: string }>
  | Readonly<{ kind: "invalid"; message: string }>
  | Readonly<{ kind: "ready"; payload: JsonValue; execute: () => void }>;

const DOCUMENT_ACTION_NAMES: ReadonlySet<string> = new Set<LiveHostDocumentActionName>([
  "document.attrs.set",
  "document.attrs.drop",
  "document.content.replace",
  "document.content.insert",
  "document.content.remove",
  "document.content.move",
]);

/** Resolve one reserved built-in without mutating. Execution remains in the normal action pipeline. */
export function resolve_livehost_document_action(
  map: LiveMapAuthority,
  name: string,
  payload: JsonValue | undefined,
): LiveHostDocumentActionResolution {
  if (!is_document_action_name(name)) return Object.freeze({ kind: "not-document-action" });
  if (!is_document_live_map(map)) {
    return Object.freeze({
      kind: "unavailable",
      message: `LiveHost action ${name} is unavailable for projected authorities.`,
    });
  }
  if (!is_record(payload)) {
    return Object.freeze({ kind: "invalid", message: `LiveHost action ${name} requires an object payload.` });
  }

  const api = document_api(map);
  const target = decode_livehost_document_target(payload.target);
  if (target === undefined) {
    return Object.freeze({ kind: "invalid", message: `LiveHost action ${name} target is malformed.` });
  }

  if (name === "document.attrs.set") {
    if (!has_exact_keys(payload, ["target", "name", "value"])) return invalid_fields(name);
    const attributeName = decode_livehost_document_attribute_name(payload.name);
    if (attributeName === undefined) {
      return Object.freeze({ kind: "invalid", message: `LiveHost action ${name} attribute name is invalid.` });
    }
    const value = decode_livehost_document_attribute_value(attributeName, payload.value);
    if (value === undefined) {
      return Object.freeze({ kind: "invalid", message: `LiveHost action ${name} attribute value is invalid.` });
    }
    return Object.freeze({
      kind: "ready",
      payload,
      execute: () => { void api.attrs.set(target, attributeName, value); },
    });
  }

  if (name === "document.attrs.drop") {
    if (!has_exact_keys(payload, ["target", "name"])) return invalid_fields(name);
    const attributeName = decode_livehost_document_attribute_name(payload.name);
    if (attributeName === undefined) {
      return Object.freeze({ kind: "invalid", message: `LiveHost action ${name} attribute name is invalid.` });
    }
    return Object.freeze({
      kind: "ready",
      payload,
      execute: () => { void api.attrs.drop(target, attributeName); },
    });
  }

  if (name === "document.content.replace") {
    if (!has_exact_keys(payload, ["target", "index", "replacement"])) return invalid_fields(name);
    const index = non_negative_integer(payload.index);
    if (index === undefined) return invalid_index(name);
    const replacement = decode_livehost_document_content(payload.replacement);
    if (replacement === undefined) {
      return Object.freeze({ kind: "invalid", message: `LiveHost action ${name} replacement is invalid.` });
    }
    return Object.freeze({
      kind: "ready",
      payload,
      execute: () => { void api.content.replace(target, index, replacement); },
    });
  }

  if (name === "document.content.insert") {
    if (!has_exact_keys(payload, ["target", "index", "content"])) return invalid_fields(name);
    const index = non_negative_integer(payload.index);
    if (index === undefined) return invalid_index(name);
    const content = decode_livehost_document_content(payload.content);
    if (content === undefined) {
      return Object.freeze({ kind: "invalid", message: `LiveHost action ${name} content is invalid.` });
    }
    return Object.freeze({
      kind: "ready",
      payload,
      execute: () => { void api.content.insert(target, index, content); },
    });
  }

  if (name === "document.content.remove") {
    if (!has_exact_keys(payload, ["target", "index"])) return invalid_fields(name);
    const index = non_negative_integer(payload.index);
    if (index === undefined) return invalid_index(name);
    return Object.freeze({
      kind: "ready",
      payload,
      execute: () => { void api.content.remove(target, index); },
    });
  }

  if (!has_exact_keys(payload, ["target", "from", "to"])) return invalid_fields(name);
  const from = non_negative_integer(payload.from);
  const to = non_negative_integer(payload.to);
  if (from === undefined || to === undefined) return invalid_index(name);
  return Object.freeze({
    kind: "ready",
    payload,
    execute: () => { void api.content.move(target, from, to); },
  });
}

function is_document_action_name(name: string): name is LiveHostDocumentActionName {
  return DOCUMENT_ACTION_NAMES.has(name);
}

function invalid_fields(name: LiveHostDocumentActionName): LiveHostDocumentActionResolution {
  return Object.freeze({ kind: "invalid", message: `LiveHost action ${name} payload fields are malformed.` });
}

function invalid_index(name: LiveHostDocumentActionName): LiveHostDocumentActionResolution {
  return Object.freeze({ kind: "invalid", message: `LiveHost action ${name} content index is invalid.` });
}

function non_negative_integer(value: JsonValue | undefined): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function is_document_live_map(map: LiveMapAuthority): map is DocumentLiveMap {
  return (map.mode === "element" && "element" in map)
    || (map.mode === "fragment" && "fragment" in map);
}

function document_api(map: DocumentLiveMap): DocumentLiveMapReadApi {
  return map.mode === "element" ? map.element : map.fragment;
}

function is_record(value: unknown): value is Readonly<Record<string, JsonValue>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function has_exact_keys(
  value: Readonly<Record<string, JsonValue>>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}
