// handle.ts

import type { JsonValue } from "../../core/types.js";
import type { LiveMapCore, LiveMapPathHandle, LivePath } from "./livemap.types.js";
import { must_json_value, must_live_path, must_set_many_values } from "./guard.js";
import { make_livemap_array_api } from "./handle-array.js";
import { make_livemap_object_api } from "./handle-object.js";
import { path_is_prefix } from "./path.js";

type LiveMapPathHandleCore = Pick<LiveMapCore<JsonValue | undefined>, "snap" | "set" | "replace" | "setMany" | "delete" | "feed">;

/**
 * Create a small ergonomic handle for one projected LiveMap path.
 *
 * The handle copies the path once at creation time. That keeps the handle stable
 * even if a caller passed a mutable array and later changes it at runtime.
 *
 * `update` is deliberately just read/compute/set. It does not introduce
 * derived state, async lifecycle, patch/merge semantics, or batching.
 *
 * `set` requires the handle path to resolve and assigns primitives, arrays,
 * and null exactly; plain objects are shallow child writes that preserve
 * unspecified siblings. `replace` is exact replacement at the handle path with
 * replace-shaped commit ops. `setMany`
 * writes object properties below the handle path without removing unspecified
 * siblings. None of these imply array append, array insert, or deep merge.
 *
 * `delete` delegates to Core delete for this handle path. Delete is distinct
 * from setting undefined because undefined is not a JSON value.
 *
 * `linkTo` is one-way and live-only. It does not perform initial sync, loop
 * protection, transforms, or conflict resolution. Delete propagation follows the
 * handle scope: deleting the exact handle path deletes the target handle, while
 * deleting below the handle path writes the updated source handle value.
 */
export function make_livemap_path_handle<TValue = JsonValue | undefined>(core: LiveMapPathHandleCore, path: LivePath): LiveMapPathHandle<TValue> {
  const handlePath = must_live_path(path);

  return {
    path: () => [...handlePath],
    snap: () => core.snap(handlePath) as TValue,
    set: (value) => core.set(handlePath, must_json_value(value, handlePath)),
    replace: (value) => core.replace(handlePath, must_json_value(value, handlePath)),
    setMany: (values) => core.setMany(handlePath, must_set_many_values(values, handlePath)),
    delete: () => core.delete(handlePath),
    update: (updater) => core.set(handlePath, must_json_value(updater(core.snap(handlePath) as TValue), handlePath)),
    array: make_livemap_array_api(core, handlePath),
    object: make_livemap_object_api<TValue>(core, handlePath),
    feed: (listener) => core.feed(handlePath, listener),
    linkTo: (target) => core.feed(handlePath, (event) => {
      if (event.op.kind === "delete") {
        propagate_delete_link(handlePath, event.op.path, event.value, target);
        return;
      }

      if (event.value === undefined) return;
      if (event.op.kind === "replace") {
        target.replace(event.value);
        return;
      }

      target.set(event.value);
    }),
  };
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
    target.replace(sourceValue);
  }
}
