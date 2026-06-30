// livemap-core.ts

import type { HsonNode, JsonValue } from "../../core/types.js";
import type { LiveMapCommit, LiveMapCore, LiveMapFeedListener, LivePath } from "./livemap.types.js";
import { set_live_path, snap_live_path } from "./livemap-editor.js";
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
 */
function commit_set(root: HsonNode, path: LivePath, value: JsonValue): LiveMapCommit {
  const edit = set_live_path(root, path, value);

  return {
    changed: edit.changed,
    ops: edit.changed
      ? [
          {
            kind: "set",
            path,
            prev: edit.prev,
            next: edit.next,
          },
        ]
      : [],
  };
}