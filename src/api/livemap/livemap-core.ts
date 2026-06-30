// livemap-core.ts

import type { HsonNode, JsonValue } from "../../core/types.js";
import type { LiveMapCommit, LiveMapCore, LiveMapFeedListener, LiveMapSetManyValues, LivePath } from "./livemap.types.js";
import { delete_live_path, set_live_path, snap_live_path } from "./livemap-editor.js";
import { make_livemap_feed_hub } from "./livemap-feed.js";
import { make_livemap_path_handle } from "./map-handle.js";

/**
 * Create the first Core facade for a LiveMap graph.
 *
 * Core owns the root HSON node and exposes graph-level operations in projected
 * JSON path terms. It is the layer that will coordinate editor mutations, commit
 * generation, feeds, links, batching, and later transport-compatible behavior.
 */
export function make_livemap_core(root: HsonNode): LiveMapCore {
  const feedHub = make_livemap_feed_hub();

  const core: LiveMapCore = {
    /** Return the live root node owned by this map core. */
    root: () => root,

    /** Read the current projected JSON value at a path, or the whole graph. */
    snap: (path = []) => snap_live_path(root, path),

    /** Create an ergonomic handle scoped to one projected path. */
    at: (path) => make_livemap_path_handle(core, path),

    /** Mutate a projected path, emit the resulting commit, and return it. */
    set: (path, value) => {
      const commit = commit_set(root, path, value);
      feedHub.emit(commit, (feedPath) => snap_live_path(root, feedPath));
      return commit;
    },

    /** Mutate multiple object properties under one projected path as one commit. */
    setMany: (path, values) => {
      const commit = commit_set_many(root, path, values);
      feedHub.emit(commit, (feedPath) => snap_live_path(root, feedPath));
      return commit;
    },

    /** Delete a projected object-property path, emit the resulting commit, and return it. */
    delete: (path) => {
      const commit = commit_delete(root, path);
      feedHub.emit(commit, (feedPath) => snap_live_path(root, feedPath));
      return commit;
    },

    /** Subscribe to commits whose op paths overlap the requested path. */
    feed: (path, listener) => feed_core_path(feedHub, path, listener),
  };

  return core;
}

/**
 * Register a Core-level feed listener.
 *
 * This small wrapper keeps the public Core method phrased in LiveMap terms
 * while the FeedHub owns the subscription registry and path matching behavior.
 */
function feed_core_path(
  feedHub: ReturnType<typeof make_livemap_feed_hub>,
  path: LivePath,
  listener: LiveMapFeedListener,
) {
  return feedHub.add(path, listener);
}

/**
 * Apply a set mutation through the editor and wrap the result as a commit.
 *
 * The editor knows how to perform the graph surgery. Core is responsible for
 * turning that local edit result into a stable op record that feeds and future
 * sync/transport layers can consume.
 *
 * Commit ops copy the requested path so later caller-side array mutation cannot
 * rewrite already-returned history.
 */
function commit_set(root: HsonNode, path: LivePath, value: JsonValue): LiveMapCommit {
  const edit = set_live_path(root, path, value);
  const opPath = [...path];

  return {
    changed: edit.changed,
    ops: edit.changed
      ? [
          {
            kind: "set",
            path: opPath,
            prev: edit.prev,
            next: edit.next,
          },
        ]
      : [],
  };
}

/**
 * Apply several object-property set mutations and wrap changed edits as one commit.
 *
 * Each value is written at `path + key`. Unchanged edits are omitted from the op
 * list. Feed still receives one commit containing all changed ops.
 */
function commit_set_many(root: HsonNode, path: LivePath, values: LiveMapSetManyValues): LiveMapCommit {
  const ops = Object.entries(values).flatMap(([key, value]) => {
    const opPath: LivePath = [...path, key];
    const edit = set_live_path(root, opPath, value);

    return edit.changed
      ? [
          {
            kind: "set" as const,
            path: opPath,
            prev: edit.prev,
            next: edit.next,
          },
        ]
      : [];
  });

  return {
    changed: ops.length > 0,
    ops,
  };
}

/**
 * Apply a delete mutation through the editor and wrap the result as a commit.
 *
 * Delete is a distinct op kind rather than `set(undefined)` because undefined is
 * not a JSON value and should not become part of the set-value surface.
 */
function commit_delete(root: HsonNode, path: LivePath): LiveMapCommit {
  const edit = delete_live_path(root, path);
  const opPath = [...path];

  return {
    changed: edit.changed,
    ops: edit.changed
      ? [
          {
            kind: "delete",
            path: opPath,
            prev: edit.prev,
            next: undefined,
          },
        ]
      : [],
  };
}