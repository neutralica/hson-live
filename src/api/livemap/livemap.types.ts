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

/** Object-shaped values accepted by object-property batch setters. */
export type LiveMapSetManyValues = Readonly<Record<string, JsonValue>>;

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
  at: (path: LivePath) => LiveMapPathHandle;
  set: (path: LivePath, value: JsonValue) => LiveMapCommit;
  setMany: (path: LivePath, values: LiveMapSetManyValues) => LiveMapCommit;
  delete: (path: LivePath) => LiveMapCommit;
  feed: (path: LivePath, listener: LiveMapFeedListener) => LiveMapDisposer;
  node: (path: LivePath) => LiveMapNodeHandle;
}>;

/**
 * Normalized set operation emitted by a LiveMap mutation.
 *
 * Ops are intentionally data-shaped and replayable. `update(fn)` emits a `set`
 * op too, because functions are not serializable across feeds, logs, or future
 * transport.
 */
export type LiveMapSetOp = Readonly<{
  kind: "set";
  path: LivePath;
  prev: JsonValue | undefined;
  next: JsonValue | undefined;
}>;

/**
 * Normalized delete operation emitted by a LiveMap mutation.
 *
 * Delete is distinct from `set(undefined)` because undefined is not a JSON value
 * and should not become part of the set-value surface.
 */
export type LiveMapDeleteOp = Readonly<{
  kind: "delete";
  path: LivePath;
  prev: JsonValue | undefined;
  next: undefined;
}>;

/** Normalized operation emitted by a LiveMap mutation. */
export type LiveMapOp = LiveMapSetOp | LiveMapDeleteOp;

/**
 * Normalized mutation record returned by Core.
 *
 * A commit can contain zero, one, or many ops. Empty commits represent unchanged
 * writes/deletes. Multi-op commits are used by object-property batch writes.
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
/**
 * Options for one-way LiveMap links.
 *
 * `{ path }` is the same-path shorthand: source ops overlapping `path` are
 * replayed at their original op path on the target.
 *
 * `{ from, to }` maps a source path prefix to a target path prefix. For example,
 * an op at `["draft", "name"]` with `{ from: ["draft"], to: ["user"] }`
 * replays to `["user", "name"]`.
 */
export type LiveMapLinkOptions = LiveMapSamePathLinkOptions | LiveMapMappedLinkOptions;

/** One-way link where source and target use the same projected path. */
export type LiveMapSamePathLinkOptions = Readonly<{
  path: LivePath;
}>;

/** One-way link where source ops are translated from one path prefix to another. */
export type LiveMapMappedLinkOptions = Readonly<{
  from: LivePath;
  to: LivePath;
}>;


export type LiveMapNodeAttrs = NonNullable<HsonNode["$_attrs"]>;
export type LiveMapNodeAttrValue = LiveMapNodeAttrs[string];

export type LiveMapNodeHandle = Readonly<{
  /** Return a defensive copy of the projected path this node handle points at. */
  path: () => LivePath;

  /** Resolve the projected path to the current underlying HSON node, if present. */
  get: () => HsonNode | undefined;

  /** Resolve the projected path to a current HSON node, or throw with path context. */
  must: () => HsonNode;

  /** Read the current underlying HSON node tag, if present. */
  tag: () => string | undefined;

  /** Read a defensive copy of the current underlying HSON node attrs, if present. */
  attrs: () => LiveMapNodeAttrs | undefined;

  /** Read one current underlying HSON node attr, if present. */
  attr: (name: string) => LiveMapNodeAttrValue | undefined;

  /** Set one attr on the current underlying HSON node. */
  setAttr: (name: string, value: LiveMapNodeAttrValue) => LiveMapNodeHandle;

  /** Set many attrs on the current underlying HSON node. */
  setAttrs: (attrs: Readonly<Record<string, LiveMapNodeAttrValue>>) => LiveMapNodeHandle;

  /** Remove one attr from the current underlying HSON node. */
  removeAttr: (name: string) => LiveMapNodeHandle;

  /** Remove all attrs from the current underlying HSON node. */
  clearAttrs: () => LiveMapNodeHandle;

  /** Read the current underlying HSON node meta object, if present. System-owned. */
  meta: () => HsonNode["$_meta"] | undefined;

  /** Read the current underlying HSON node content array, if present. */
  content: () => HsonNode["$_content"] | undefined;
  children: () => readonly HsonNode[];
  childrenByTag: (tag: string) => readonly HsonNode[];
  child: (tag: string) => HsonNode | undefined;
  mustChild: (tag: string) => HsonNode;
}>;

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
