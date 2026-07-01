// livemap-core.ts

import type { HsonNode, JsonValue } from "../../core/types.js";
import type { LiveMapCommit, LiveMapCore, LiveMapFeedListener, LiveMapSetManyValues, LivePath } from "./livemap.types.js";
import { delete_live_path, set_live_path, snap_live_path } from "./livemap-editor.js";
import { make_livemap_feed_hub } from "./livemap-feed.js";
import { make_livemap_node_handle } from "./livemap-node.js";
import { make_livemap_path_handle } from "./livemap-handle.js";

/**
 * Create the first Core facade for a LiveMap graph.
 *
 * Core owns the root HSON node and exposes graph-level operations in projected
 * JSON path terms. It is the layer that coordinates editor mutations, commit
 * generation, feeds, links, batching, and later transport-compatible behavior.
 *
 * `at(path)` is the projected data handle. `node(path)` is the lower-level HSON
 * graph handle used to build and test the machinery underneath later public data
 * APIs. Keep projected JSON behavior in Core/editor/handles, and keep physical
 * node surgery isolated to the node handle.
 */
export function make_livemap_core(root: HsonNode): LiveMapCore {
  const feedHub = make_livemap_feed_hub();

  const core: LiveMapCore = {
    /** Return the live root node owned by this map core. */
    root: () => root,

    /** Read the current projected JSON value at a path, or the whole graph. */
    snap: (path = []) => snap_live_path(root, mustLivePath(path)),

    /** Create an ergonomic handle scoped to one projected path. */
    at: (path) => make_livemap_path_handle(core, mustLivePath(path)),

    /** Create a low-level HSON-node-facing handle scoped to one projected path. */
    node: (path) => make_livemap_node_handle(root, mustLivePath(path)),

    /** Mutate a projected path, emit the resulting commit, and return it. */
    set: (path, value) => {
      const livePath = mustLivePath(path);
      const jsonValue = mustJsonValue(value, livePath);
      const commit = commit_set(root, livePath, jsonValue);
      feedHub.emit(commit, (feedPath) => snap_live_path(root, feedPath));
      return commit;
    },

    /** Mutate multiple object properties under one projected path as one commit. */
    setMany: (path, values) => {
      const livePath = mustLivePath(path);
      const jsonValues = mustSetManyValues(values, livePath);
      const commit = commit_set_many(root, livePath, jsonValues);
      feedHub.emit(commit, (feedPath) => snap_live_path(root, feedPath));
      return commit;
    },

    /** Delete a projected object-property path, emit the resulting commit, and return it. */
    delete: (path) => {
      const livePath = mustLivePath(path);
      const commit = commit_delete(root, livePath);
      feedHub.emit(commit, (feedPath) => snap_live_path(root, feedPath));
      return commit;
    },

    /** Subscribe to commits whose op paths overlap the requested path. */
    feed: (path, listener) => feed_core_path(feedHub, mustLivePath(path), mustFeedListener(listener)),
  };

  return core;
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

function mustJsonValue(value: unknown, path: LivePath): JsonValue {
  if (isJsonValue(value)) return value;

  throw new Error(`LiveMap value is not JSON at ${formatLivePath(path)}`);
}

function mustSetManyValues(value: unknown, path: LivePath): LiveMapSetManyValues {
  if (!isPlainJsonObjectValue(value)) {
    throw new Error(`LiveMap setMany value is not an object at ${formatLivePath(path)}`);
  }

  const values: Record<string, JsonValue> = {};

  for (const [key, item] of Object.entries(value)) {
    values[key] = mustJsonValue(item, [...path, key]);
  }

  return values;
}

function mustFeedListener(listener: unknown): LiveMapFeedListener {
  if (typeof listener === "function") return listener as LiveMapFeedListener;

  throw new Error("LiveMap feed listener is not a function");
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

function formatLivePath(path: LivePath): string {
  return `[${path.map((part) => JSON.stringify(part)).join(", ")}]`;
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