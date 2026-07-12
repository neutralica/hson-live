// livemap-feed.ts

import type { JsonValue } from "../../core/types.js";
import type { LiveMapCommit, LiveMapDisposer, LiveMapFeedEvent, LiveMapFeedListener, LivePath } from "../../types/livemap.types.js";
import { path_is_prefix, paths_overlap } from "./livemap.path.js";

/**
 * Reads the current projected JSON value at a LiveMap path.
 *
 * Feed does not own graph traversal. Instead, Core passes a snap function into
 * `emit()`, so Feed can report the current value at the subscribed path without
 * importing or knowing about the editor.
 */
export type LiveMapSnapFn = (path: LivePath) => JsonValue | undefined;

/**
 * One registered feed subscription.
 *
 * `path` is the subscriber's projected value path, not a raw HSON node path.
 * `listener` is called when an emitted op overlaps that path.
 */
type FeedEntry = Readonly<{
  path: LivePath;
  listener: LiveMapFeedListener;
}>;


/**
 * Create an in-memory feed registry for one LiveMap core instance.
 *
 * The hub stores path/listener pairs, accepts normalized commits from Core, and
 * emits listener events for any subscription whose path overlaps a commit op.
 * It is deliberately graph-agnostic: it never mutates nodes and never resolves
 * HSON wrappers directly.
 */
export function make_livemap_feed_hub(): LiveMapFeedHub {
  /**
   * Mutable registry of active subscriptions.
   *
   * This is intentionally local closure state rather than graph state. Feed
   * subscriptions are runtime observers, not part of the HSON data graph.
   */
  const entries: FeedEntry[] = [];

  return {
    /**
     * Register a listener at a projected path and return a disposer.
     *
     * The path is copied on entry so later caller-side array mutation cannot
     * silently move the subscription.
     */
    add: (path, listener) => {
      const entry: FeedEntry = { path: [...path], listener };
      entries.push(entry);

      /**
       * Remove this exact subscription if it is still active.
       *
       * Calling the disposer more than once is harmless.
       */
      return () => {
        const index = entries.indexOf(entry);
        if (index !== -1) entries.splice(index, 1);
      };
    },

    /**
     * Emit a commit to all overlapping subscriptions.
     *
     * Feed emits at most once per subscriber per commit. `event.op` is the first
     * matching op for compatibility; `event.ops` contains every matching op.
     *
     * The event value is the current value at the subscriber's path, not
     * necessarily the op's `next` value. That distinction matters for parent
     * feeds: a feed on `["user"]` should receive the full current user object
     * when `["user", "name"]` changes.
     */
    emit: (commit, snap) => {
      if (!commit.changed) return;

      /**
       * Copy the registry before iterating so listeners may safely dispose or
       * add subscriptions during emission without corrupting this pass.
       */
      for (const entry of [...entries]) {
        const ops = commit.ops.filter((op) => paths_overlap(entry.path, op.path));
        const op = ops[0];
        if (op === undefined) continue;

        const event: LiveMapFeedEvent = {
          op,
          ops,
          path: entry.path,
          value: snap(entry.path),
        };

        entry.listener(event);
      }
    },
  };
}

/**
 * Runtime feed registry used by LiveMap Core.
 *
 * `add()` subscribes a listener at a projected path.
 * `emit()` fans a normalized commit out to matching listeners.
 */
export type LiveMapFeedHub = Readonly<{
  add: (path: LivePath, listener: LiveMapFeedListener) => LiveMapDisposer;
  emit: (commit: LiveMapCommit, snap: LiveMapSnapFn) => void;
}>;
