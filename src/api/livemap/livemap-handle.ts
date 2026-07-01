// map-handle.ts

import type { JsonValue } from "../../core/types.js";
import type {
  LiveMapCore, LiveMapPathHandle, LivePath
} from "./livemap.types.js";
import { path_is_prefix } from "./livemap-path.js";

type LiveMapPathHandleCore = Pick<LiveMapCore, "snap" | "set" | "setMany" | "delete" | "feed">;
type LiveMapPathKind = "array" | "object";

/**
 * Create a small ergonomic handle for one projected LiveMap path.
 *
 * The handle copies the path once at creation time. That keeps the handle stable
 * even if a caller passed a mutable array and later changes it at runtime.
 *
 * `update` is deliberately just read/compute/write. It does not introduce
 * derived state, async lifecycle, patch semantics, or batching.
 *
 * `setMany` is object-property batching only. It does not imply array append,
 * array insert, deep merge, or patch semantics.
 *
 * `delete` delegates to Core delete for this handle path. Delete is distinct
 * from setting undefined because undefined is not a JSON value.
 *
 * `linkTo` is one-way and live-only. It does not perform initial sync, loop
 * protection, transforms, or conflict resolution. Delete propagation follows the
 * handle scope: deleting the exact handle path deletes the target handle, while
 * deleting below the handle path writes the updated source handle value.
 */
export function make_livemap_path_handle(core: LiveMapPathHandleCore, path: LivePath): LiveMapPathHandle {
  const handlePath = mustLivePath(path);

  return {
    path: () => [...handlePath],
    snap: () => core.snap(handlePath),
    set: (value) => core.set(handlePath, mustJsonValue(value, handlePath)),
    setMany: (values) => core.setMany(handlePath, mustSetManyValues(values, handlePath)),
    delete: () => core.delete(handlePath),
    update: (updater) => core.set(handlePath, mustJsonValue(updater(core.snap(handlePath)), handlePath)),
    array: {
      insert: (index, value) => core.set(handlePath, arrayInsert(core.snap(handlePath), handlePath, index, mustJsonValue(value, [...handlePath, index]))),
      remove: (index) => core.set(handlePath, arrayRemove(core.snap(handlePath), handlePath, index)),
      replace: (index, value) => core.set(handlePath, arrayReplace(core.snap(handlePath), handlePath, index, mustJsonValue(value, [...handlePath, index]))),
      move: (fromIndex, toIndex) => core.set(handlePath, arrayMove(core.snap(handlePath), handlePath, fromIndex, toIndex)),
    },
    object: {
      setKey: (key, value) => {
        const objectKey = mustObjectKey(key, handlePath);
        mustObjectValue(core.snap(handlePath), handlePath);
        return core.set([...handlePath, objectKey], mustJsonValue(value, [...handlePath, objectKey]));
      },
      deleteKey: (key) => {
        const objectKey = mustObjectKey(key, handlePath);
        mustObjectValue(core.snap(handlePath), handlePath);
        return core.delete([...handlePath, objectKey]);
      },
      renameKey: (fromKey, toKey) => core.set(handlePath, objectRenameKey(core.snap(handlePath), handlePath, mustObjectKey(fromKey, handlePath), mustObjectKey(toKey, handlePath))),
    },
    feed: (listener) => core.feed(handlePath, listener),
    linkTo: (target) => core.feed(handlePath, (event) => {
      if (event.op.kind === "delete") {
        propagate_delete_link(handlePath, event.op.path, event.value, target);
        return;
      }

      if (event.value === undefined) return;
      target.set(event.value);
    }),
  };
}


function mustLivePath(path: unknown): LivePath {
  if (!Array.isArray(path)) {
    throw new Error("LiveMap path is not an array");
  }

  return path.map((part, index) => mustLivePathPart(part, index));
}

function mustLivePathPart(part: unknown, index: number): string | number {
  if (typeof part === "string") return part;
  if (typeof part === "number" && Number.isInteger(part) && part >= 0) return part;

  throw new Error(`LiveMap path part is not valid at index ${index}`);
}

function mustSetManyValues(value: unknown, path: LivePath): Readonly<Record<string, JsonValue>> {
  if (!isPlainJsonObjectValue(value)) {
    throw new Error(`LiveMap setMany value is not an object at ${formatHandlePath(path)}`);
  }

  const values: Record<string, JsonValue> = {};

  for (const [key, item] of Object.entries(value)) {
    values[key] = mustJsonValue(item, [...path, key]);
  }

  return values;
}


function mustJsonValue(value: unknown, path: LivePath): JsonValue {
  if (isJsonValue(value)) return value;

  throw new Error(`LiveMap value is not JSON at ${formatHandlePath(path)}`);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;

  switch (typeof value) {
    case "string":
    case "boolean":
      return true;
    case "number":
      return Number.isFinite(value);
    case "object":
      return Array.isArray(value)
        ? value.every(isJsonValue)
        : isPlainJsonObjectValue(value) && Object.values(value).every(isJsonValue);
    default:
      return false;
  }
}

function isPlainJsonObjectValue(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function mustObjectKey(key: unknown, path: LivePath): string {
  if (typeof key === "string") return key;

  throw new Error(`LiveMap object key is not a string at ${formatHandlePath(path)}`);
}


function mustArrayValue(value: JsonValue | undefined, path: LivePath): JsonValue[] {
  if (!Array.isArray(value)) {
    throw pathKindError(path, "array");
  }

  return [...value];
}

function mustObjectValue(value: JsonValue | undefined, path: LivePath): Readonly<Record<string, JsonValue>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw pathKindError(path, "object");
  }

  return value;
}

function objectRenameKey(value: JsonValue | undefined, path: LivePath, fromKey: string, toKey: string): JsonValue {
  const objectValue = mustObjectValue(value, path);
  if (fromKey === toKey || !(fromKey in objectValue)) return { ...objectValue };

  const next: Record<string, JsonValue> = {};

  for (const [key, item] of Object.entries(objectValue)) {
    if (key === fromKey) {
      next[toKey] = item;
      continue;
    }

    if (key !== toKey) next[key] = item;
  }

  return next;
}

function arrayInsert(value: JsonValue | undefined, path: LivePath, index: number, item: JsonValue): JsonValue {
  const next = mustArrayValue(value, path);
  const insertIndex = arrayInsertIndex(next, path, index);
  next.splice(insertIndex, 0, item);
  return next;
}

function arrayRemove(value: JsonValue | undefined, path: LivePath, index: number): JsonValue {
  const next = mustArrayValue(value, path);
  const removeIndex = arrayIndex(next, path, index);
  next.splice(removeIndex, 1);
  return next;
}

function arrayReplace(value: JsonValue | undefined, path: LivePath, index: number, item: JsonValue): JsonValue {
  const next = mustArrayValue(value, path);
  const replaceIndex = arrayIndex(next, path, index);
  next.splice(replaceIndex, 1, item);
  return next;
}

function arrayMove(value: JsonValue | undefined, path: LivePath, fromIndex: number, toIndex: number): JsonValue {
  const next = mustArrayValue(value, path);
  const from = arrayIndex(next, path, fromIndex);
  const [item] = next.splice(from, 1);
  const to = arrayInsertIndex(next, path, toIndex);
  next.splice(to, 0, item as JsonValue);
  return next;
}

function arrayIndex(value: readonly JsonValue[], path: LivePath, index: number): number {
  if (!Number.isInteger(index) || index < 0 || index >= value.length) {
    throw arrayIndexError(path, index);
  }

  return index;
}

function arrayInsertIndex(value: readonly JsonValue[], path: LivePath, index: number): number {
  if (!Number.isInteger(index) || index < 0 || index > value.length) {
    throw arrayIndexError(path, index);
  }

  return index;
}

function arrayIndexError(path: LivePath, index: number): Error {
  return new Error(`LiveMap array index does not resolve: ${formatHandlePath(path)}[${index}]`);
}

function pathKindError(path: LivePath, kind: LiveMapPathKind): Error {
  return new Error(`LiveMap path is not an ${kind}: ${formatHandlePath(path)}`);
}

function formatHandlePath(path: LivePath): string {
  return `[${path.map((part) => JSON.stringify(part)).join(", ")}]`;
}

/**
 * Propagate a delete observed by a source handle to its target handle.
 *
 * If the delete removes the source handle itself, or one of its ancestors, the
 * target handle is deleted. If the delete happens below the source handle, the
 * target receives the updated source handle value instead.
 */
function propagate_delete_link(
  sourcePath: LivePath,
  deletePath: LivePath,
  sourceValue: JsonValue | undefined,
  target: LiveMapPathHandle,
): void {
  if (path_is_prefix(deletePath, sourcePath)) {
    target.delete();
    return;
  }

  if (path_is_prefix(sourcePath, deletePath) && sourceValue !== undefined) {
    target.set(sourceValue);
  }
}