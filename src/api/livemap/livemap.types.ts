// livemap.types.ts

import type { HsonNode, JsonValue } from "../../core/types.js";

/**
 * One segment of a projected LiveMap path.
 *
 * Strings address object properties. Numbers address array indexes. This is the
 * canonical internal path representation beneath later ergonomic surfaces such
 * as Proxy access.
 */
export type LivePathPart = string | number;

/**
 * Canonical projected path into a LiveMap graph.
 *
 * A LivePath is not a raw HSON node path. It addresses the JSON-facing value
 * projection, so `["user", "name"]` means the `name` value under `user`, not
 * the physical wrapper/content path inside the HSON graph.
 */
export type LivePath = readonly LivePathPart[];

/**
 * Raw result returned by the editor after a graph mutation.
 *
 * The editor reports the local before/after value at one path. Core turns this
 * into a normalized commit/op record for feeds, links, batching, and later
 * transport.
 */
export type LiveMapEditResult = Readonly<{
  changed: boolean;
  prev: JsonValue | undefined;
  next: JsonValue | undefined;
}>;

/**
 * First public core surface for one LiveMap graph.
 *
 * Core owns the root node, delegates low-level graph edits to the editor, and
 * returns normalized commits for mutations. Feed now hangs directly off this
 * layer; link/proxy surfaces should also talk to Core rather than the editor.
 */
export type LiveMapCore = Readonly<{
  root: () => HsonNode;
  snap: (path?: LivePath) => JsonValue | undefined;
  set: (path: LivePath, value: JsonValue) => LiveMapCommit;
  feed: (path: LivePath, listener: LiveMapFeedListener) => LiveMapDisposer;
}>;

/**
 * Normalized operation emitted by a LiveMap mutation.
 *
 * Ops are intentionally data-shaped and replayable. `update(fn)` should later
 * emit a `set` op too, because functions are not serializable across feeds,
 * logs, or future transport.
 */
export type LiveMapOp = Readonly<{
  kind: "set";
  path: LivePath;
  prev: JsonValue | undefined;
  next: JsonValue | undefined;
}>;

/**
 * Normalized mutation record returned by Core.
 *
 * A commit can contain one or more ops. The current slice only emits zero or one
 * `set` op, but the shape is already ready for batch/multi-op commits.
 */
export type LiveMapCommit = Readonly<{
  changed: boolean;
  ops: readonly LiveMapOp[];
}>;

/**
 * Event delivered to a feed listener.
 *
 * `op` is the actual mutation. `path` is the subscriber's path. `value` is the
 * current projected value at the subscriber's path after the op has been applied.
 */
export type LiveMapFeedEvent = Readonly<{
  op: LiveMapOp;
  path: LivePath;
  value: JsonValue | undefined;
}>;

/** Listener called when a feed receives an overlapping operation. */
export type LiveMapFeedListener = (event: LiveMapFeedEvent) => void;

/** Idempotent cleanup function returned by subscriptions and future bindings. */
export type LiveMapDisposer = () => void;