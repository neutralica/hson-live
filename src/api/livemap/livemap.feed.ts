// livemap-feed.ts

import type { JsonValue } from "../../core/types.js";
import type { OrderedProjectedValue } from "../../core/ordered-projected-value.js";
import { materialize_projected_value } from "../../core/projected-value-materialization.js";
import type { LiveMapCommit, LiveMapDisposer, LiveMapFeedEvent, LiveMapFeedListener, LivePath } from "../../types/livemap.types.js";
import { paths_overlap } from "./livemap.path.js";
import type { LiveMapProjectedFeedEvent } from "./livemap.projected-propagation.js";
import {
  decode_livemap_replay_payload,
  materialize_livemap_projected_op,
  type LiveMapProjectedDataOp,
} from "./livemap.transport.js";

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
 * `path` is the subscriber's data value path, not a raw Hson node path.
 * `listener` is called when an emitted op overlaps that path.
 */
type FeedEntry = Readonly<{
  path: LivePath;
  listener: LiveMapFeedListener;
}>;

type ProjectedFeedEntry = Readonly<{
  path: LivePath;
  listener: (event: LiveMapProjectedFeedEvent) => void;
}>;


/**
 * Create an in-memory feed registry for one LiveMap core instance.
 *
 * The hub stores path/listener pairs, accepts normalized commits from Core, and
 * emits listener events for any subscription whose path overlaps a commit op.
 * It is deliberately graph-agnostic: it never mutates nodes and never resolves
 * Hson wrappers directly.
 */
export function make_livemap_feed_hub(): LiveMapFeedHub {
  /**
   * Mutable registry of active subscriptions.
   *
   * This is intentionally local closure state rather than graph state. Feed
   * subscriptions are runtime observers, not part of the Hson data graph.
   */
  const entries: FeedEntry[] = [];
  const projectedEntries: ProjectedFeedEntry[] = [];

  return {
    /**
     * Register a listener at a data path and return a disposer.
     *
     * The path is copied on entry so later caller-side array mutation cannot
     * silently move the subscription.
     */
    add: (path, listener) => {
      const entry: FeedEntry = { path: Object.freeze([...path]), listener };
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

    addProjected: (path, listener) => {
      const entry: ProjectedFeedEntry = { path: Object.freeze([...path]), listener };
      projectedEntries.push(entry);
      return () => {
        const index = projectedEntries.indexOf(entry);
        if (index !== -1) projectedEntries.splice(index, 1);
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
          commit,
          op,
          ops,
          path: entry.path,
          value: snap(entry.path),
        };

        entry.listener(event);
      }
    },

    emitProjected: (commit, read) => {
      if (!commit.changed) return;
      if (typeof commit.payload !== "string") {
        throw new Error("LiveMap data feed requires an exact commit payload.");
      }
      const projectedOps = decode_livemap_replay_payload(commit.payload);

      for (const entry of [...projectedEntries]) {
        const ops = projectedOps.filter((op) => paths_overlap(entry.path, op.path));
        if (ops.length === 0) continue;
        entry.listener(Object.freeze({
          commit,
          path: entry.path,
          value: read(entry.path),
          ops: Object.freeze(ops),
        }));
      }

      for (const entry of [...entries]) {
        const publicCommit = detached_public_commit(commit, projectedOps);
        const ops = publicCommit.ops.filter((op) => paths_overlap(entry.path, op.path));
        const op = ops[0];
        if (op === undefined) continue;
        const projected = read(entry.path);
        entry.listener({
          commit: publicCommit,
          op,
          ops,
          path: entry.path,
          value: projected === undefined ? undefined : materialize_projected_value(projected),
        });
      }
    },
  };
}

function detached_public_commit(
  commit: LiveMapCommit,
  ops: readonly LiveMapProjectedDataOp[],
): LiveMapCommit {
  return Object.freeze({
    changed: commit.changed,
    prevRev: commit.prevRev,
    rev: commit.rev,
    ops: Object.freeze(ops.map(materialize_livemap_projected_op)),
    format: commit.format,
    payload: commit.payload,
  });
}

/**
 * Runtime feed registry used by LiveMap Core.
 *
 * `add()` subscribes a listener at a data path.
 * `emit()` fans a normalized commit out to matching listeners.
 */
export type LiveMapFeedHub = Readonly<{
  add: (path: LivePath, listener: LiveMapFeedListener) => LiveMapDisposer;
  addProjected: (
    path: LivePath,
    listener: (event: LiveMapProjectedFeedEvent) => void,
  ) => LiveMapDisposer;
  emit: (commit: LiveMapCommit, snap: LiveMapSnapFn) => void;
  emitProjected: (
    commit: LiveMapCommit,
    read: (path: LivePath) => OrderedProjectedValue | undefined,
  ) => void;
}>;
