// livemap.types.ts

import type { HsonNode, JsonValue } from "../../core/types.js";
import type { LiveMapSchema, LiveMapSchemaValue } from "./schema.js";


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
 * Runtime Proxy surface for ergonomic projected-path access.
 *
 * Normal property access extends the path. `$_` exits the Proxy surface and
 * returns the existing path handle for the current projected path.
 *
 * Schema-aware maps expose known object keys and array indexes as typed child
 * proxies. Unknown property names remain allowed as `unknown` so loose dynamic
 * proxy usage is still possible without widening known schema paths.
 */
export type LiveMapProxy<TValue = JsonValue | undefined, TPath extends LivePath = []> = Readonly<{
  readonly $_: LiveMapPathHandle<LiveMapPathValue<TValue, TPath>>;
}> & LiveMapProxyObjectChildren<TValue, TPath> & LiveMapProxyArrayChildren<TValue, TPath>;

export type LiveMapProxyObjectChildren<TValue, TPath extends LivePath> = NonNullable<LiveMapPathValue<TValue, TPath>> extends readonly unknown[]
  ? Readonly<Record<never, never>>
  : NonNullable<LiveMapPathValue<TValue, TPath>> extends object
  ? Readonly<{
    [TKey in Extract<keyof NonNullable<LiveMapPathValue<TValue, TPath>>, string>]: LiveMapProxy<TValue, [...TPath, TKey]>;
  }>
  : Readonly<Record<never, never>>;

export type LiveMapProxyArrayChildren<TValue, TPath extends LivePath> = NonNullable<LiveMapPathValue<TValue, TPath>> extends readonly unknown[]
  ? Readonly<{
    [index: number]: LiveMapProxy<TValue, [...TPath, number]>;
  }>
  : Readonly<Record<never, never>>;

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


/** Property bag accepted by object-shaped `setMany(...)` and `write(...)` calls. */
export type LiveMapSetManyValues = Readonly<Record<string, JsonValue>>;

/** Write intent collected before editor application. */
export type LiveMapSetWriteOp = Readonly<{
  kind: "set";
  path: LivePath;
  value: JsonValue;
}>;

/** Delete intent collected before editor application. */
export type LiveMapDeleteWriteOp = Readonly<{
  kind: "delete";
  path: LivePath;
}>;

/** Root replacement intent collected before editor application. */
export type LiveMapReplaceWriteOp = Readonly<{
  kind: "replace";
  value: JsonValue;
}>;

/** Internal write intent consumed by the Core commit pipeline. */
export type LiveMapWriteOp = LiveMapSetWriteOp | LiveMapDeleteWriteOp | LiveMapReplaceWriteOp;

export type LiveMapSortDirection = "asc" | "desc";

export type LiveMapCoreSnap<TValue = JsonValue | undefined> = {
  (path: LivePath): JsonValue | undefined;
  (): TValue;
};

export type LiveMapPathValue<TValue, TPath extends LivePath> =
  TPath extends readonly []
  ? TValue
  : TPath extends readonly [infer THead, ...infer TRest]
  ? THead extends keyof NonNullable<TValue>
  ? LiveMapPathValue<NonNullable<TValue>[THead], Extract<TRest, LivePath>>
  : THead extends number
  ? NonNullable<TValue> extends readonly (infer TItem)[]
  ? LiveMapPathValue<TItem, Extract<TRest, LivePath>>
  : JsonValue | undefined
  : JsonValue | undefined
  : JsonValue | undefined;

export type LiveMapWriteValue<TValue> = [Exclude<TValue, undefined>] extends [JsonValue]
  ? Exclude<TValue, undefined>
  : JsonValue;

export type LiveMapPathWriteValue<TValue, TPath extends LivePath> = LiveMapWriteValue<LiveMapPathValue<TValue, TPath>>;
export type LiveMapPathSetManyValues<TValue, TPath extends LivePath> =
  LiveMapObjectSetManyValues<LiveMapPathValue<TValue, TPath>>;

/**
 * Synchronous transaction handle passed to `map.batch(...)`.
 *
 * Batch is an explicit grouping envelope, not automatic notification
 * coalescing. The transaction mirrors Core write semantics: `setMany` replaces
 * the projected object from a property bag, while `write` performs a shallow
 * sibling-preserving object write.
 */
export type LiveMapBatchTx<TValue = JsonValue | undefined> = Readonly<{
  /** Exact replacement at the projected path. */
  set: <const TPath extends LivePath>(
    path: TPath,
    value: NoInfer<LiveMapPathWriteValue<TValue, TPath>>,
  ) => LiveMapBatchTx<TValue>;
  /** Exact object replacement from a property bag. Use `write` to preserve unspecified siblings. */
  setMany: <const TPath extends LivePath>(
    path: TPath,
    values: NoInfer<LiveMapPathSetManyValues<TValue, TPath>>,
  ) => LiveMapBatchTx<TValue>;
  /** Shallow object write that expands values into child-path sets and preserves unspecified siblings. */
  write: <const TPath extends LivePath>(
    path: TPath,
    values: NoInfer<LiveMapPathSetManyValues<TValue, TPath>>,
  ) => LiveMapBatchTx<TValue>;
  /** Delete the projected path. */
  delete: (path: LivePath) => LiveMapBatchTx<TValue>;
}>;

/**
 * Schema attachment surface for a LiveMap.
 *
 * `schema.use(schema)` returns the same runtime map object as a schema-bound
 * TypeScript view. The static value type is preserved only when the schema value
 * still carries its generic, usually by allowing `hson.liveMap.schema.define(...)`
 * to infer the schema variable type.
 *
 * Avoid widening schemas to bare `LiveMapSchema` before passing them to `use`.
 * A bare `LiveMapSchema` means `LiveMapSchema<unknown>`, so the resulting map is
 * correctly typed as `LiveMap<unknown>`.
 */
export type LiveMapCoreSchemaApi<TValue = JsonValue | undefined> = Readonly<{
  (): LiveMapSchema | undefined;
  get: () => LiveMapSchema | undefined;
  use: <TSchema extends LiveMapSchema>(schema: TSchema) => LiveMap<LiveMapSchemaValue<TSchema>>;
}>;

export type LiveMapCore<TValue = JsonValue | undefined> = Readonly<{
  root: () => HsonNode;
  snap: LiveMapCoreSnap<TValue>;
  schema: LiveMapCoreSchemaApi<TValue>;
  withSchema: <TSchema extends LiveMapSchema>(schema: TSchema) => LiveMap<LiveMapSchemaValue<TSchema>>;
  at: <const TPath extends LivePath>(path: TPath) => LiveMapPathHandle<LiveMapPathValue<TValue, TPath>>;
  proxy: <const TPath extends LivePath = []>(path?: TPath) => LiveMapProxy<TValue, TPath>;
  /** Exact replacement at the projected path. */
  set: <const TPath extends LivePath>(path: TPath, value: NoInfer<LiveMapPathWriteValue<TValue, TPath>>) => LiveMapCommit;
  /** Exact object replacement from a property bag. Use `write` to preserve unspecified siblings. */
  setMany: <const TPath extends LivePath>(
    path: TPath,
    values: NoInfer<LiveMapPathSetManyValues<TValue, TPath>>,
  ) => LiveMapCommit;
  /** Shallow object write that expands values into child-path sets and preserves unspecified siblings. */
  write: <const TPath extends LivePath>(
    path: TPath,
    values: NoInfer<LiveMapPathSetManyValues<TValue, TPath>>,
  ) => LiveMapCommit;
  /** Exact replacement of the projected root value; `set([])` remains invalid. */
  replace: (value: NoInfer<LiveMapWriteValue<TValue>>) => LiveMapCommit;
  delete: (path: LivePath) => LiveMapCommit;
  /** Explicit synchronous transaction grouping for one commit. */
  batch: (fn: (tx: LiveMapBatchTx<TValue>) => void) => LiveMapCommit;
  feed: (path: LivePath, listener: LiveMapFeedListener) => LiveMapDisposer;
  sub: LiveMapSubApi<TValue>;
  node: (path: LivePath) => LiveMapNodeHandle;
}>;

/**
 * Public LiveMap surface.
 *
 * `TValue` is the current projected root value type. A map created without a
 * schema starts as `LiveMap<JsonValue | undefined>`. After attaching an inferred
 * schema with `map.schema.use(schema)` or `map.withSchema(schema)`, the returned
 * map view becomes `LiveMap<LiveMapSchemaValue<typeof schema>>`.
 */
export interface LiveMap<TValue = JsonValue | undefined> extends LiveMapCore<TValue> { }

/**
 * Normalized set operation emitted by a LiveMap mutation.
 *
 * Ops are intentionally data-shaped and replayable. Exact `set(...)`,
 * replacement `setMany(...)`, and `update(fn)` commits all report a `set` op
 * at the projected replacement path.
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

/**
 * Normalized root replacement operation emitted by a LiveMap mutation.
 *
 * Root replacement is intentionally distinct from `set([])`: projected child
 * path writes still reject empty paths, while `replace(...)` makes whole-root
 * overwrite explicit. The runtime overwrites the existing root node in place so
 * existing handles stay attached.
 */
export type LiveMapReplaceOp = Readonly<{
  kind: "replace";
  path: [];
  prev: JsonValue | undefined;
  next: JsonValue | undefined;
}>;

/** Normalized operation emitted by a LiveMap mutation. */
export type LiveMapOp = LiveMapSetOp | LiveMapDeleteOp | LiveMapReplaceOp;

/**
 * Normalized mutation record returned by Core.
 *
 * A commit can contain zero, one, or many ops. Empty commits represent unchanged
 * writes/deletes. Multi-op commits are used by `write(...)` and explicit
 * `batch(...)` calls.
 */
export type LiveMapCommit = Readonly<{
  changed: boolean;
  ops: readonly LiveMapOp[];
}>;

/**
 * Event delivered to a feed listener.
 *
 * `op` is the first matching op for compatibility. `ops` contains all matching
 * ops from the commit. `path` is the subscriber's path. `value` is the current
 * projected value at the subscriber's path after the commit has been applied.
 */
export type LiveMapFeedEvent = Readonly<{
  op: LiveMapOp;
  path: LivePath;
  value: JsonValue | undefined;
  ops: readonly LiveMapOp[];
}>;

/** Listener called when a feed receives an overlapping operation. */
export type LiveMapFeedListener = (event: LiveMapFeedEvent) => void;

/** Idempotent cleanup function returned by subscriptions and future bindings. */
export type LiveMapDisposer = () => void;

export type LiveMapStoreEqual<TValue> = (next: TValue, prev: TValue) => boolean;

export type LiveMapStoreSubscribeOptions<TValue> = Readonly<{
  equal?: LiveMapStoreEqual<TValue>;
}>;

export type LiveMapStoreListener<TValue> = (next: TValue) => void;
export type LiveMapStoreDiffListener<TValue> = (next: TValue, prev: TValue) => void;
export type LiveMapStoreSelectedListener<TSelected, TValue> = (next: TSelected, prev: TSelected, state: TValue) => void;
export type LiveMapStorePathListener<TValue, TPath extends LivePath> = (
  next: NoInfer<LiveMapPathValue<TValue, TPath>>,
  prev: NoInfer<LiveMapPathValue<TValue, TPath>>,
  event: LiveMapFeedEvent,
) => void;

export type LiveMapStoreApi<TValue = JsonValue | undefined> = Readonly<{
  snapshot: () => TValue;
  subscribe: (listener: LiveMapStoreListener<TValue>) => LiveMapDisposer;
  subscribeDiff: (listener: LiveMapStoreDiffListener<TValue>) => LiveMapDisposer;
  subscribeSel: <TSelected>(
    selector: (state: TValue) => TSelected,
    listener: LiveMapStoreSelectedListener<TSelected, TValue>,
    options?: LiveMapStoreSubscribeOptions<TSelected>,
  ) => LiveMapDisposer;
  subscribePath: <const TPath extends LivePath>(
    path: TPath,
    listener: LiveMapStorePathListener<TValue, TPath>,
    options?: LiveMapStoreSubscribeOptions<NoInfer<LiveMapPathValue<TValue, TPath>>>,
  ) => LiveMapDisposer;
}>;

export type LiveMapSubApi<TValue = JsonValue | undefined> = LiveMapStoreApi<TValue>["subscribe"] & Readonly<{
  diff: LiveMapStoreApi<TValue>["subscribeDiff"];
  sel: LiveMapStoreApi<TValue>["subscribeSel"];
  path: LiveMapStoreApi<TValue>["subscribePath"];
}>;
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
export type LiveMapObjectShape<TValue> = NonNullable<TValue> extends readonly unknown[]
  ? Readonly<Record<string, JsonValue>>
  : NonNullable<TValue> extends object
  ? NonNullable<TValue>
  : Readonly<Record<string, JsonValue>>;

export type LiveMapObjectKey<TValue> = Extract<keyof LiveMapObjectShape<TValue>, string>;


export type LiveMapObjectValue<TValue, TKey extends string> = TKey extends keyof LiveMapObjectShape<TValue>
  ? LiveMapObjectShape<TValue>[TKey]
  : JsonValue | undefined;

export type LiveMapObjectWriteValue<TValue, TKey extends LiveMapObjectKey<TValue>> = LiveMapWriteValue<LiveMapObjectShape<TValue>[TKey]>;

export type LiveMapObjectSetManyValues<TValue> = string extends LiveMapObjectKey<TValue>
  ? LiveMapSetManyValues
  : Readonly<{
    [TKey in LiveMapObjectKey<TValue>]?: LiveMapWriteValue<LiveMapObjectShape<TValue>[TKey]>;
  }>;

export type LiveMapObjectEntry<TValue> = {
  [TKey in LiveMapObjectKey<TValue>]: readonly [TKey, LiveMapObjectValue<TValue, TKey>];
}[LiveMapObjectKey<TValue>];

export type LiveMapArrayShape<TValue> = NonNullable<TValue> extends readonly unknown[]
  ? NonNullable<TValue>
  : readonly JsonValue[];

export type LiveMapArrayItem<TValue> = LiveMapArrayShape<TValue> extends readonly (infer TItem)[]
  ? TItem
  : JsonValue;

export type LiveMapArrayWriteItem<TValue> = LiveMapWriteValue<LiveMapArrayItem<TValue>>;

export type LiveMapPathHandle<TValue = JsonValue | undefined> = Readonly<{
  path: () => LivePath;
  snap: () => TValue;
  /** Exact replacement at this handle path. */
  set: (value: LiveMapWriteValue<TValue>) => LiveMapCommit;
  /** Exact object replacement at this handle path from a property bag. */
  setMany: (values: NoInfer<LiveMapObjectSetManyValues<TValue>>) => LiveMapCommit;
  /** Shallow object write below this handle path, preserving unspecified siblings. */
  write: (values: NoInfer<LiveMapObjectSetManyValues<TValue>>) => LiveMapCommit;
  /** Delete this handle path. */
  delete: () => LiveMapCommit;
  update: (updater: (value: TValue) => LiveMapWriteValue<TValue>) => LiveMapCommit;
  array: LiveMapPathArrayApi<TValue>;
  object: LiveMapPathObjectApi<TValue>;
  feed: (listener: LiveMapFeedListener) => LiveMapDisposer;
  linkTo: (target: LiveMapPathHandle) => LiveMapDisposer;
}>;

export type LiveMapPathObjectApi<TValue = JsonValue | undefined> = Readonly<{
  is: () => boolean;
  toObject: () => LiveMapObjectShape<TValue>;
  pick: <const TKeys extends readonly string[]>(keys: TKeys) => Pick<LiveMapObjectShape<TValue>, Extract<TKeys[number], keyof LiveMapObjectShape<TValue>>>;
  omit: <const TKeys extends readonly string[]>(keys: TKeys) => Omit<LiveMapObjectShape<TValue>, Extract<TKeys[number], keyof LiveMapObjectShape<TValue>>>;
  hasKey: <const TKey extends string>(key: TKey) => boolean;
  getKey: <const TKey extends string>(key: TKey) => LiveMapObjectValue<TValue, TKey>;
  keys: () => readonly LiveMapObjectKey<TValue>[];
  isEmpty: () => boolean;
  size: () => number;
  values: () => readonly LiveMapObjectShape<TValue>[LiveMapObjectKey<TValue>][];
  entries: () => readonly LiveMapObjectEntry<TValue>[];
  /** Exact replacement of one child key. */
  setKey: <const TKey extends LiveMapObjectKey<TValue>>(key: TKey, value: NoInfer<LiveMapObjectWriteValue<TValue, TKey>>) => LiveMapCommit;
  /** Exact object replacement at the handle path from a property bag. */
  setMany: (values: NoInfer<LiveMapObjectSetManyValues<TValue>>) => LiveMapCommit,
  /** Shallow object write at the handle path, preserving unspecified siblings. */
  write: (values: NoInfer<LiveMapObjectSetManyValues<TValue>>) => LiveMapCommit,
  clear: () => LiveMapCommit;
  deleteKey: (key: string) => LiveMapCommit;
  deleteMany: (keys: readonly string[]) => LiveMapCommit;
  renameKey: (fromKey: string, toKey: string) => LiveMapCommit;
}>;
export type LiveMapPathArrayApi<TValue = JsonValue | undefined> = Readonly<{
  is: () => boolean;
  toArray: () => LiveMapArrayShape<TValue>;
  slice: (start?: number, end?: number) => LiveMapArrayShape<TValue>;
  take: (count: number) => LiveMapArrayShape<TValue>;
  drop: (count: number) => LiveMapArrayShape<TValue>;
  takeLast: (count: number) => LiveMapArrayShape<TValue>;
  dropLast: (count: number) => LiveMapArrayShape<TValue>;
  length: () => number;
  isEmpty: () => boolean;
  at: (index: number) => LiveMapArrayItem<TValue>;
  first: () => LiveMapArrayItem<TValue>;
  last: () => LiveMapArrayItem<TValue>;
  includes: (value: JsonValue) => boolean;
  indexOf: (value: JsonValue) => number;
  push: (value: NoInfer<LiveMapArrayWriteItem<TValue>>) => LiveMapCommit;
  pushMany: (values: readonly NoInfer<LiveMapArrayWriteItem<TValue>>[]) => LiveMapCommit;
  unshift: (value: NoInfer<LiveMapArrayWriteItem<TValue>>) => LiveMapCommit;
  unshiftMany: (values: readonly NoInfer<LiveMapArrayWriteItem<TValue>>[]) => LiveMapCommit;
  pop: () => LiveMapCommit;
  shift: () => LiveMapCommit;
  clear: () => LiveMapCommit;
  reverse: () => LiveMapCommit;
  sortNumbers: (direction?: LiveMapSortDirection) => LiveMapCommit;
  sortStrings: (direction?: LiveMapSortDirection) => LiveMapCommit;
  splice: (...args: [start: number] | [start: number, deleteCount: number, ...items: NoInfer<LiveMapArrayWriteItem<TValue>>[]]) => LiveMapCommit;
  insert: (index: number, value: NoInfer<LiveMapArrayWriteItem<TValue>>) => LiveMapCommit;
  remove: (index: number) => LiveMapCommit;
  replace: (index: number, value: NoInfer<LiveMapArrayWriteItem<TValue>>) => LiveMapCommit;
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
