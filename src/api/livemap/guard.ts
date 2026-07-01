// guard.ts

// livemap-guards.ts

import type { JsonValue } from "../../core/types.js";
import type { LiveMapFeedListener, LiveMapSetManyValues, LivePath } from "./livemap.types.js";

export type LiveMapPathKind = "array" | "object";

export function must_live_path(path: unknown): LivePath {
  if (!Array.isArray(path)) {
    throw new Error("LiveMap path is not an array");
  }

  return path.map((part, index) => must_live_path_part(part, index));
}

export function must_json_value(value: unknown, path: LivePath): JsonValue {
  if (is_json_value(value)) return value;

  throw new Error(`LiveMap value is not JSON at ${format_live_path(path)}`);
}

export function must_set_many_values(value: unknown, path: LivePath): LiveMapSetManyValues {
  if (!is_plain_json_object_value(value)) {
    throw new Error(`LiveMap setMany value is not an object at ${format_live_path(path)}`);
  }

  const values: Record<string, JsonValue> = {};

  for (const [key, item] of Object.entries(value)) {
    values[key] = must_json_value(item, [...path, key]);
  }

  return values;
}

export function must_feed_listener(listener: unknown): LiveMapFeedListener {
  if (typeof listener === "function") return listener as LiveMapFeedListener;

  throw new Error("LiveMap feed listener is not a function");
}

export function must_object_key(key: unknown, path: LivePath): string {
  if (typeof key === "string") return key;

  throw new Error(`LiveMap object key is not a string at ${format_live_path(path)}`);
}

export function path_kind_error(path: LivePath, kind: LiveMapPathKind): Error {
  return new Error(`LiveMap path is not an ${kind}: ${format_live_path(path)}`);
}

export function array_index_error(path: LivePath, index: number): Error {
  return new Error(`LiveMap array index does not resolve: ${format_live_path(path)}[${index}]`);
}

export function format_live_path(path: LivePath): string {
  return `[${path.map((part) => JSON.stringify(part)).join(", ")}]`;
}

function must_live_path_part(part: unknown, index: number): string | number {
  if (typeof part === "string") return part;
  if (typeof part === "number" && Number.isInteger(part) && part >= 0) return part;

  throw new Error(`LiveMap path part is not valid at index ${index}`);
}

function is_json_value(value: unknown): value is JsonValue {
  if (value === null) return true;

  switch (typeof value) {
    case "string":
    case "boolean":
      return true;
    case "number":
      return Number.isFinite(value);
    case "object":
      return Array.isArray(value)
        ? value.every(is_json_value)
        : is_plain_json_object_value(value) && Object.values(value).every(is_json_value);
    default:
      return false;
  }
}

function is_plain_json_object_value(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}