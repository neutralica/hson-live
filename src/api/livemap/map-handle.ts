// map-handle.ts

import type { JsonValue } from "../../core/types.js";
import type {
  LiveMapCommit,
  LiveMapCore,
  LiveMapDisposer,
  LiveMapFeedListener,
  LiveMapSetManyValues,
  LivePath,
} from "./livemap.types.js";
import { path_is_prefix } from "./livemap-path.js";

export type LiveMapPathHandle = Readonly<{
  path: () => LivePath;
  snap: () => JsonValue | undefined;
  set: (value: JsonValue) => LiveMapCommit;
  setMany: (values: LiveMapSetManyValues) => LiveMapCommit;
  delete: () => LiveMapCommit;
  update: (updater: (value: JsonValue | undefined) => JsonValue) => LiveMapCommit;
  feed: (listener: LiveMapFeedListener) => LiveMapDisposer;
  linkTo: (target: LiveMapPathHandle) => LiveMapDisposer;
}>;

type LiveMapPathHandleCore = Pick<LiveMapCore, "snap" | "set" | "setMany" | "delete" | "feed">;

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
  const handlePath = [...path];

  return {
    path: () => [...handlePath],
    snap: () => core.snap(handlePath),
    set: (value) => core.set(handlePath, value),
    setMany: (values) => core.setMany(handlePath, values),
    delete: () => core.delete(handlePath),
    update: (updater) => core.set(handlePath, updater(core.snap(handlePath))),
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