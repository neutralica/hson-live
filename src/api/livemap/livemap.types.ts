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

export type LiveMapSortDirection = "asc" | "desc";

/**
 * First public core surface for one LiveMap graph.
 *
 * Core owns the root node, delegates projected JSON edits to the editor, and
 * returns normalized commits for mutations. Feed hangs directly off this layer;
 * link/proxy/future projected-data APIs should also talk to Core rather than
 * the editor.
 *
 * `node(path)` is intentionally lower level than `at(path)`: it exposes direct
 * HSON graph inspection and surgery so LiveMap internals can be built and tested
 * without prematurely freezing the public projected-data API.
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
  /** Return all children as HsonNodes. */
  children: () => readonly HsonNode[];
  childrenByTag: (tag: string) => readonly HsonNode[];
  child: (tag: string) => HsonNode | undefined;
  mustChild: (tag: string) => HsonNode;
  /** Append a direct HSON child node to the current underlying node. */
  append: (child: HsonNode) => LiveMapNodeHandle;

  /** Low-level direct HSON child removal helpers. */
  remove: LiveMapNodeRemoveApi;

  /** Low-level direct HSON child replacement helpers. */
  replace: LiveMapNodeReplaceApi;

  /** Low-level direct HSON child insertion helpers. */
  insert: LiveMapNodeInsertApi;

  /** Low-level direct HSON child movement helpers. */
  move: LiveMapNodeMoveApi;
}>;
export type LiveMapPathHandle = Readonly<{
  path: () => LivePath;
  snap: () => JsonValue | undefined;
  set: (value: JsonValue) => LiveMapCommit;
  setMany: (values: LiveMapSetManyValues) => LiveMapCommit;
  delete: () => LiveMapCommit;
  update: (updater: (value: JsonValue | undefined) => JsonValue) => LiveMapCommit;
  array: LiveMapPathArrayApi;
  object: LiveMapPathObjectApi;
  feed: (listener: LiveMapFeedListener) => LiveMapDisposer;
  linkTo: (target: LiveMapPathHandle) => LiveMapDisposer;
}>;
export type LiveMapPathObjectApi = Readonly<{
  is: () => boolean;
  toObject: () => Readonly<Record<string, JsonValue>>;
  pick: (keys: readonly string[]) => Readonly<Record<string, JsonValue>>;
  omit: (keys: readonly string[]) => Readonly<Record<string, JsonValue>>;
  hasKey: (key: string) => boolean;
  getKey: (key: string) => JsonValue | undefined;
  keys: () => readonly string[];
  isEmpty: () => boolean;
  size: () => number;
  values: () => readonly JsonValue[];
  entries: () => readonly (readonly [string, JsonValue])[];
  setKey: (key: string, value: JsonValue) => LiveMapCommit;
  setMany: (values: LiveMapSetManyValues) => LiveMapCommit;
  clear: () => LiveMapCommit;
  deleteKey: (key: string) => LiveMapCommit;
  deleteMany: (keys: readonly string[]) => LiveMapCommit;
  renameKey: (fromKey: string, toKey: string) => LiveMapCommit;
}>;
export type LiveMapPathArrayApi = Readonly<{
  is: () => boolean;
  toArray: () => readonly JsonValue[];
  slice: (start?: number, end?: number) => readonly JsonValue[];
  take: (count: number) => readonly JsonValue[];
  drop: (count: number) => readonly JsonValue[];
  takeLast: (count: number) => readonly JsonValue[];
  dropLast: (count: number) => readonly JsonValue[];
  length: () => number;
  isEmpty: () => boolean;
  at: (index: number) => JsonValue;
  first: () => JsonValue;
  last: () => JsonValue;
  includes: (value: JsonValue) => boolean;
  indexOf: (value: JsonValue) => number;
  push: (value: JsonValue) => LiveMapCommit;
  pushMany: (values: readonly JsonValue[]) => LiveMapCommit;
  unshift: (value: JsonValue) => LiveMapCommit;
  unshiftMany: (values: readonly JsonValue[]) => LiveMapCommit;
  pop: () => LiveMapCommit;
  shift: () => LiveMapCommit;
  clear: () => LiveMapCommit;
  reverse: () => LiveMapCommit;
  sortNumbers: (direction?: LiveMapSortDirection) => LiveMapCommit;
  sortStrings: (direction?: LiveMapSortDirection) => LiveMapCommit;
  splice: (...args: [start: number] | [start: number, deleteCount: number, ...items: JsonValue[]]) => LiveMapCommit;
  insert: (index: number, value: JsonValue) => LiveMapCommit;
  remove: (index: number) => LiveMapCommit;
  replace: (index: number, value: JsonValue) => LiveMapCommit;
  move: (fromIndex: number, toIndex: number) => LiveMapCommit;
  unique: () => LiveMapCommit;
  removeValue: (value: JsonValue) => LiveMapCommit;
  removeAll: (value: JsonValue) => LiveMapCommit;
}>;

/** Low-level physical child removal. Indexes count direct HsonNode children, not raw $_content slots. */
export type LiveMapNodeRemoveApi = Readonly<{
  children: () => LiveMapNodeHandle;
  child: (index: number) => LiveMapNodeHandle;
}>;

/** Low-level physical child replacement. Indexes count direct HsonNode children, not raw $_content slots. */
export type LiveMapNodeReplaceApi = Readonly<{
  children: (children: readonly HsonNode[]) => LiveMapNodeHandle;
  child: (index: number, child: HsonNode) => LiveMapNodeHandle;
}>;

/** Low-level physical child insertion. Indexes count direct HsonNode children, not raw $_content slots. */
export type LiveMapNodeInsertApi = Readonly<{
  child: (index: number, child: HsonNode) => LiveMapNodeHandle;
}>;

/**
 * Low-level physical child movement.
 *
 * Indexes count direct HsonNode children, not raw $_content slots. `toIndex` is
 * resolved after the source child is removed, so moving child 0 to index 2 in a
 * three-child list moves it to the end.
 */
export type LiveMapNodeMoveApi = Readonly<{
  child: (fromIndex: number, toIndex: number) => LiveMapNodeHandle;
}>;
