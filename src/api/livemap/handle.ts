// map-handle.ts

import type { JsonValue } from "../../core/types.js";
import type {
  LiveMapCore, LiveMapPathHandle, LivePath
} from "./livemap.types.js";
import { path_is_prefix } from "./path.js";
import {
  array_index_error,
  must_json_value,
  must_live_path,
  must_object_key,
  must_set_many_values,
  path_kind_error,
} from "./guard.js";


type LiveMapPathHandleCore = Pick<LiveMapCore, "snap" | "set" | "setMany" | "delete" | "feed">;

function isObjectValue(value: JsonValue | undefined): value is Readonly<Record<string, JsonValue>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mustObjectValue(value: JsonValue | undefined, path: LivePath): Readonly<Record<string, JsonValue>> {
  if (!isObjectValue(value)) {
    throw path_kind_error(path, "object");
  }

  return value;
}
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
  const handlePath = must_live_path(path);

  return {
    path: () => [...handlePath],
    snap: () => core.snap(handlePath),
    set: (value) => core.set(handlePath, must_json_value(value, handlePath)),
    setMany: (values) => core.setMany(handlePath, must_set_many_values(values, handlePath)),
    delete: () => core.delete(handlePath),
    update: (updater) => core.set(handlePath, must_json_value(updater(core.snap(handlePath)), handlePath)),
    array: {
      is: () => Array.isArray(core.snap(handlePath)),
      length: () => mustArrayValue(core.snap(handlePath), handlePath).length,
      at: (index) => {
        const arrayValue = mustArrayValue(core.snap(handlePath), handlePath);
        return arrayValue[arrayIndex(arrayValue, handlePath, index)];
      },
      push: (value) => {
        const arrayValue = mustArrayValue(core.snap(handlePath), handlePath);
        return core.set(handlePath, arrayInsert(arrayValue, handlePath, arrayValue.length, must_json_value(value, [...handlePath, arrayValue.length])));
      },
      unshift: (value) => core.set(handlePath, arrayInsert(core.snap(handlePath), handlePath, 0, must_json_value(value, [...handlePath, 0]))),
      pop: () => {
        const arrayValue = mustArrayValue(core.snap(handlePath), handlePath);
        return core.set(handlePath, arrayRemove(arrayValue, handlePath, arrayValue.length - 1));
      },
      shift: () => core.set(handlePath, arrayRemove(core.snap(handlePath), handlePath, 0)),
      clear: () => {
        mustArrayValue(core.snap(handlePath), handlePath);
        return core.set(handlePath, []);
      },
      insert: (index, value) => core.set(handlePath, arrayInsert(core.snap(handlePath), handlePath, index, must_json_value(value, [...handlePath, index]))),
      remove: (index) => core.set(handlePath, arrayRemove(core.snap(handlePath), handlePath, index)),
      replace: (index, value) => core.set(handlePath, arrayReplace(core.snap(handlePath), handlePath, index, must_json_value(value, [...handlePath, index]))),
      move: (fromIndex, toIndex) => core.set(handlePath, arrayMove(core.snap(handlePath), handlePath, fromIndex, toIndex)),
    },
    object: {
      is: () => isObjectValue(core.snap(handlePath)),
      hasKey: (key) => {
        const objectKey = must_object_key(key, handlePath);
        return objectKey in mustObjectValue(core.snap(handlePath), handlePath);
      },
      getKey: (key) => {
        const objectKey = must_object_key(key, handlePath);
        return mustObjectValue(core.snap(handlePath), handlePath)[objectKey];
      },
      keys: () => Object.keys(mustObjectValue(core.snap(handlePath), handlePath)),
      values: () => Object.values(mustObjectValue(core.snap(handlePath), handlePath)),
      entries: () => Object.entries(mustObjectValue(core.snap(handlePath), handlePath)),
      setKey: (key, value) => {
        const objectKey = must_object_key(key, handlePath);
        mustObjectValue(core.snap(handlePath), handlePath);
        return core.set([...handlePath, objectKey], must_json_value(value, [...handlePath, objectKey]));
      },
      setMany: (values) => {
        mustObjectValue(core.snap(handlePath), handlePath);
        return core.setMany(handlePath, must_set_many_values(values, handlePath));
      },
      clear: () => {
        mustObjectValue(core.snap(handlePath), handlePath);
        return core.set(handlePath, {});
      },
      deleteKey: (key) => {
        const objectKey = must_object_key(key, handlePath);
        mustObjectValue(core.snap(handlePath), handlePath);
        return core.delete([...handlePath, objectKey]);
      },
      renameKey: (fromKey, toKey) => core.set(handlePath, objectRenameKey(core.snap(handlePath), handlePath, must_object_key(fromKey, handlePath), must_object_key(toKey, handlePath))),
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


function mustArrayValue(value: JsonValue | undefined, path: LivePath): JsonValue[] {
  if (!Array.isArray(value)) {
    throw path_kind_error(path, "array");
  }

  return [...value];
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
    throw array_index_error(path, index);
  }

  return index;
}

function arrayInsertIndex(value: readonly JsonValue[], path: LivePath, index: number): number {
  if (!Number.isInteger(index) || index < 0 || index > value.length) {
    throw array_index_error(path, index);
  }

  return index;
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