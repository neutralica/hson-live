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
  "document.attr.set",
  "document.attr.drop",
  "document.content.replace",
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

  if (name === "document.attr.set") {
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

  if (name === "document.attr.drop") {
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

  if (!has_exact_keys(payload, ["target", "index", "replacement"])) return invalid_fields(name);
  const index = payload.index;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
    return Object.freeze({ kind: "invalid", message: `LiveHost action ${name} content index is invalid.` });
  }
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

function is_document_action_name(name: string): name is LiveHostDocumentActionName {
  return DOCUMENT_ACTION_NAMES.has(name);
}

function invalid_fields(name: LiveHostDocumentActionName): LiveHostDocumentActionResolution {
  return Object.freeze({ kind: "invalid", message: `LiveHost action ${name} payload fields are malformed.` });
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
