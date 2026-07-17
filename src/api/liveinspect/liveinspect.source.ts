import type { JsonValue } from "../../core/types.js";
import type {
  LiveMap,
  LiveMapFeedListener,
  LiveMapPathHandle,
  LivePath,
} from "../../types/livemap.types.js";
import { LiveInspectorError, LIVE_INSPECTOR_UNSUPPORTED_SOURCE_ERROR_CODE } from "./liveinspect.error.js";
import { record_livetree_materialization } from "../livetree/debug/materialization-profile.js";
import { LiveInspectorMapSource } from "../../types/liveinspect.types.js";

export type LiveInspectorSourceOrigin = "livemap" | "handle" | "json" | "hson";

export type NormalizedInspectorSource = Readonly<{
  handle: LiveMapPathHandle;
  map: LiveInspectorMapSource | undefined;
  origin: LiveInspectorSourceOrigin;
}>;

type CollectionHandle = Pick<LiveMapPathHandle<readonly JsonValue[]>, "rev" | "path" | "snap" | "at" | "feed">;
const PASS_VALUES = new WeakMap<object, JsonValue>();

export function consume_inspector_pass_value(source: LiveMapPathHandle): JsonValue | undefined {
  const value = PASS_VALUES.get(source as object);
  PASS_VALUES.delete(source as object);
  return value;
}

export function normalize_inspector_source(
  source: unknown,
  origin?: LiveInspectorSourceOrigin,
): NormalizedInspectorSource {
  if (is_livemap(source)) {
    const handle = source.at([]) as LiveMapPathHandle;
    must_supported_json(handle.snap());
    return Object.freeze({ handle, map: source, origin: origin ?? "livemap" });
  }
  if (is_path_handle(source)) {
    must_supported_json(source.snap());
    return Object.freeze({ handle: source, map: undefined, origin: origin ?? "handle" });
  }
  throw new LiveInspectorError(
    LIVE_INSPECTOR_UNSUPPORTED_SOURCE_ERROR_CODE,
    "Live inspector source must be a LiveMap or LiveMapPathHandle.",
  );
}

export function make_singleton_collection_handle(
  source: LiveMapPathHandle,
  subscribe: boolean,
): LiveMapPathHandle<readonly JsonValue[]> {
  const adapter: CollectionHandle = {
    get rev() { return source.rev; },
    path: () => source.path(),
    snap: () => {
      record_livetree_materialization("sourceSnapReads");
      const value = source.snap();
      must_supported_json(value);
      return Object.freeze([value]);
    },
    at: ((path: LivePath) => {
      record_livetree_materialization("sourceAtCalls");
      if (path.length !== 1 || path[0] !== 0) {
        throw new LiveInspectorError(
          LIVE_INSPECTOR_UNSUPPORTED_SOURCE_ERROR_CODE,
          `Inspector singleton adapter path does not resolve: ${JSON.stringify(path)}.`,
        );
      }
      return source;
    }) as LiveMapPathHandle<readonly JsonValue[]>["at"],
    feed: (listener: LiveMapFeedListener) => subscribe ? source.feed(listener) : () => undefined,
  };
  return adapter as LiveMapPathHandle<readonly JsonValue[]>;
}

export function make_array_collection_handle(
  source: LiveMapPathHandle,
): LiveMapPathHandle<readonly JsonValue[]> {
  let passValues: readonly JsonValue[] | undefined;
  const adapter: CollectionHandle = {
    get rev() { return source.rev; },
    path: () => source.path(),
    snap: () => {
      record_livetree_materialization("sourceSnapReads");
      const value = source.snap();
      if (!Array.isArray(value)) throw unsupported_shape("array", source.path());
      passValues = value;
      return value;
    },
    at: ((path: LivePath) => {
      record_livetree_materialization("sourceAtCalls");
      const ordinal = path[0];
      if (path.length !== 1 || typeof ordinal !== "number") throw unsupported_shape("array-item ordinal", source.path());
      const values = passValues;
      const initial = values?.[ordinal];
      if (values !== undefined && ordinal === values.length - 1) passValues = undefined;
      return initial === undefined
        ? source.at(path)
        : first_snap_handle(source.at(path), initial);
    }) as LiveMapPathHandle<readonly JsonValue[]>["at"],
    feed: () => () => undefined,
  };
  return adapter as LiveMapPathHandle<readonly JsonValue[]>;
}

export function make_object_collection_handle(
  source: LiveMapPathHandle,
): LiveMapPathHandle<readonly JsonValue[]> {
  let passKeys: readonly string[] | undefined;
  let passValues: readonly JsonValue[] | undefined;
  const adapter: CollectionHandle = {
    get rev() { return source.rev; },
    path: () => source.path(),
    snap: () => {
      record_livetree_materialization("sourceSnapReads");
      const value = source.snap();
      if (!is_json_object(value)) throw unsupported_shape("object", source.path());
      passKeys = Object.keys(value);
      passValues = Object.values(value);
      record_livetree_materialization("objectKeyEnumerations");
      return passValues;
    },
    at: ((path: LivePath) => {
      record_livetree_materialization("sourceAtCalls");
      const ordinal = path[0];
      if (path.length !== 1 || typeof ordinal !== "number") {
        throw unsupported_shape("object-property ordinal", source.path());
      }
      if (passKeys === undefined || passValues === undefined) {
        const value = source.snap();
        if (!is_json_object(value)) throw unsupported_shape("object", source.path());
        passKeys = Object.keys(value);
        passValues = Object.values(value);
        record_livetree_materialization("objectKeyEnumerations");
      }
      const keys = passKeys;
      const values = passValues;
      const key = keys[ordinal];
      const initial = values[ordinal];
      if (key === undefined) throw unsupported_shape(`object property ${ordinal}`, source.path());
      if (ordinal === keys.length - 1) {
        passKeys = undefined;
        passValues = undefined;
      }
      const handle = source.at([key]);
      return initial === undefined ? handle : first_snap_handle(handle, initial);
    }) as LiveMapPathHandle<readonly JsonValue[]>["at"],
    feed: () => () => undefined,
  };
  return adapter as LiveMapPathHandle<readonly JsonValue[]>;
}

/**
 * Patch 7A reads each item immediately after `at`. Consume the collection-pass
 * value once, then delegate every later read to the canonical source handle.
 * This is transient read-through state, not a retained mirror or identity map.
 */
function first_snap_handle(source: LiveMapPathHandle, initial: JsonValue): LiveMapPathHandle {
  let available = true;
  const handle = new Proxy(source, {
    get(target, property, receiver) {
      if (property !== "snap") return Reflect.get(target, property, receiver) as unknown;
      return () => {
        if (available) {
          available = false;
          return initial;
        }
        return target.snap();
      };
    },
  });
  PASS_VALUES.set(handle, initial);
  return handle;
}

export function must_supported_json(value: unknown): asserts value is JsonValue {
  const visiting = new Set<object>();
  const visit = (item: unknown): void => {
    if (item === null || typeof item === "string" || typeof item === "boolean") return;
    if (typeof item === "number" && Number.isFinite(item)) return;
    if (typeof item !== "object") throw unsupported_value(item);
    if (typeof Node !== "undefined" && item instanceof Node) throw unsupported_value(item);
    if (visiting.has(item)) throw unsupported_value(item, "cyclic");
    visiting.add(item);
    if (Array.isArray(item)) {
      for (const child of item) visit(child);
    } else {
      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) throw unsupported_value(item, "class instance");
      for (const child of Object.values(item)) visit(child);
    }
    visiting.delete(item);
  };
  visit(value);
}

export function is_json_object(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function is_livemap(value: unknown): value is LiveInspectorMapSource {
  if (typeof value !== "object" || value === null) return false;

  const candidate = value as Partial<LiveInspectorMapSource>;

  return typeof candidate.root === "function"
    && typeof candidate.at === "function"
    && typeof candidate.snap === "function"
    && typeof candidate.feed === "function";
}

function is_path_handle(value: unknown): value is LiveMapPathHandle {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<LiveMapPathHandle>;
  return typeof candidate.path === "function"
    && typeof candidate.snap === "function"
    && typeof candidate.at === "function"
    && typeof candidate.feed === "function"
    && typeof candidate.rev === "number";
}

function unsupported_value(value: unknown, reason?: string): LiveInspectorError {
  const kind = value === null ? "null" : typeof value;
  return new LiveInspectorError(
    LIVE_INSPECTOR_UNSUPPORTED_SOURCE_ERROR_CODE,
    `Live inspector source contains an unsupported ${reason ?? kind} value.`,
  );
}

function unsupported_shape(expected: string, path: LivePath): LiveInspectorError {
  return new LiveInspectorError(
    LIVE_INSPECTOR_UNSUPPORTED_SOURCE_ERROR_CODE,
    `Live inspector expected ${expected} at ${JSON.stringify(path)}.`,
  );
}
