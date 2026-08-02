// guard.ts

import type { JsonValue } from "../../core/types.js";
import type { LiveMapFeedListener, LiveMapSetManyValues, LivePath } from "../../types/livemap.types.js";
import { format_live_path } from "./livemap.path.js";
import {
  admit_projected_value,
  ProjectedValueAdmissionError,
} from "../../core/projected-value-admission.js";
import { materialize_projected_value } from "../../core/projected-value-materialization.js";
import {
  is_ordered_projected_object,
  type OrderedProjectedObject,
  type OrderedProjectedValue,
} from "../../core/ordered-projected-value.js";
import { LiveMapProjectedValueError } from "./livemap.error.js";

export type LiveMapPathKind = "array" | "object";

/**
 * Validate a public LiveMap path.
 *
 * LiveMap paths are arrays of string keys and non-negative integer array
 * indexes. The returned path is a normalized copy, so callers do not retain a
 * mutable user-supplied path reference.
 */
export function must_live_path(path: unknown): LivePath {
  if (!Array.isArray(path)) {
    throw new Error("LiveMap path is not an array");
  }

  return path.map((part, index) => must_live_path_part(part, index));
}

/** Validate a value as JSON before it enters LiveMap mutation surfaces. */
export function must_json_value(value: unknown, path: LivePath): JsonValue {
  return materialize_projected_value(must_ordered_projected_value(value, path));
}

/** Admit one public JavaScript value into LiveMap's immutable semantic carrier. */
export function must_ordered_projected_value(value: unknown, path: LivePath): OrderedProjectedValue {
  try {
    return admit_projected_value(value, path);
  } catch (error) {
    if (error instanceof ProjectedValueAdmissionError) {
      throw new LiveMapProjectedValueError(error);
    }
    throw error;
  }
}

/**
 * Validate `setMany` input as a plain JSON object.
 *
 * `setMany` is intentionally object-only: each own enumerable key becomes a
 * child write under `path`, and each child value must be valid JSON.
 */
export function must_set_many_values(value: unknown, path: LivePath): LiveMapSetManyValues {
  return materialize_projected_value(must_ordered_projected_object(value, path)) as LiveMapSetManyValues;
}

/** Admit the ordered object bag accepted by `setMany` without materializing it. */
export function must_ordered_projected_object(value: unknown, path: LivePath): OrderedProjectedObject {
  const admitted = must_ordered_projected_value(value, path);
  if (is_ordered_projected_object(admitted)) return admitted;
  throw new Error(`LiveMap setMany value is not an object at ${format_live_path(path)}`);
}

/** Validate feed listener input from public subscription surfaces. */
export function must_feed_listener(listener: unknown): LiveMapFeedListener {
  if (typeof listener === "function") return listener as LiveMapFeedListener;

  throw new Error("LiveMap feed listener is not a function");
}

/** Validate a user-supplied object key for object helper APIs. */
export function must_object_key(key: unknown, path: LivePath): string {
  if (typeof key === "string") return key;

  throw new Error(`LiveMap object key is not a string at ${format_live_path(path)}`);
}

/** Build the standard object/array kind error for path-scoped helpers. */
export function path_kind_error(path: LivePath, kind: LiveMapPathKind): Error {
  return new Error(`LiveMap path is not an ${kind}: ${format_live_path(path)}`);
}

/** Build the standard array-index resolution error. */
export function array_index_error(path: LivePath, index: number): Error {
  return new Error(`LiveMap array index does not resolve: ${format_live_path(path)}[${index}]`);
}

function must_live_path_part(part: unknown, index: number): string | number {
  if (typeof part === "string") return part;
  if (typeof part === "number" && Number.isInteger(part) && part >= 0) return part;

  throw new Error(`LiveMap path part is not valid at index ${index}`);
}

/** True for plain object records accepted by LiveMap JSON object guards. */
export function is_plain_json_object_value(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
