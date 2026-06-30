// map-handle.ts

import type { JsonValue } from "../../core/types.js";
import type {
  LiveMapCommit,
  LiveMapCore,
  LiveMapDisposer,
  LiveMapFeedListener,
  LivePath,
} from "./livemap.types.js";

export type LiveMapPathHandle = Readonly<{
  path: () => LivePath;
  snap: () => JsonValue | undefined;
  set: (value: JsonValue) => LiveMapCommit;
  update: (updater: (value: JsonValue | undefined) => JsonValue) => LiveMapCommit;
  feed: (listener: LiveMapFeedListener) => LiveMapDisposer;
}>;

type LiveMapPathHandleCore = Pick<LiveMapCore, "snap" | "set" | "feed">;

/**
 * Create a small ergonomic handle for one projected LiveMap path.
 *
 * The handle copies the path once at creation time. That keeps the handle stable
 * even if a caller passed a mutable array and later changes it at runtime.
 *
 * `update` is deliberately just read/compute/write. It does not introduce
 * derived state, async lifecycle, patch semantics, or batching.
 */
export function make_livemap_path_handle(core: LiveMapPathHandleCore, path: LivePath): LiveMapPathHandle {
  const handlePath = [...path];

  return {
    path: () => [...handlePath],
    snap: () => core.snap(handlePath),
    set: (value) => core.set(handlePath, value),
    update: (updater) => core.set(handlePath, updater(core.snap(handlePath))),
    feed: (listener) => core.feed(handlePath, listener),
  };
}
