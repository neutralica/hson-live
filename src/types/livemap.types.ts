// livemap.types.ts

import type { HsonNode, JsonValue, NodeContent, Primitive } from "../core/types.js";
import type { CssMap } from "../core/style.types.js";
import type {
  LiveMapSchema,
  LiveMapSchemaResolution,
  LiveMapSchemaRule,
  LiveMapSchemaValue,
} from "../api/livemap/livemap.schema.js";
import type { LiveMapQuid } from "../api/livemap/livemap.quid.js";


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

/** Canonical root shape owned by one LiveMap instance. */
export type LiveMapRootMode = DataLiveMapMode | DocumentLiveMapMode;
export type DataLiveMapMode = "data-object" | "data-array";
export type DocumentLiveMapMode = "element" | "fragment";

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


/** Property bag accepted by object-shaped `set(...)` and `setMany(...)` calls. */
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

/** Endpoint replacement intent collected before editor application. */
export type LiveMapReplaceWriteOp = Readonly<{
  kind: "replace";
  path: LivePath;
  value: JsonValue;
}>;

/** Internal mutation intent consumed by the Core commit pipeline. */
export type LiveMapWriteOp = LiveMapSetWriteOp | LiveMapDeleteWriteOp | LiveMapReplaceWriteOp | LiveMapSpliceWriteOp;

export type LiveMapSortDirection = "asc" | "desc";

/** Overloaded snapshot reader: root with no args, projected value with a path. */
export type LiveMapCoreSnap<TValue = JsonValue | undefined> = {
  (path: LivePath): JsonValue | undefined;
  (): TValue;
};

/**
 * Static value projection for a LivePath.
 *
 * Known object keys and array indexes narrow through `TValue`; unknown or
 * impossible paths fall back to `JsonValue | undefined` so dynamic path usage
 * remains possible without pretending the value is statically known.
 */
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

/** Remove `undefined` from write positions while preserving JSON value shape. */
export type LiveMapWriteValue<TValue> = [Exclude<TValue, undefined>] extends [JsonValue]
  ? Exclude<TValue, undefined>
  : JsonValue;

export type LiveMapPathWriteValue<TValue, TPath extends LivePath> = LiveMapWriteValue<LiveMapPathValue<TValue, TPath>>;
/**
 * Value accepted by `set` at one path.
 *
 * Arrays and primitives are written as endpoint values. Object paths accept a
 * shallow object patch shape because runtime `set` preserves unspecified object
 * siblings. Use `replace` for exact object replacement.
 */
export type LiveMapSetValue<TValue> = NonNullable<TValue> extends readonly unknown[]
  ? LiveMapWriteValue<TValue>
  : NonNullable<TValue> extends object
  ? LiveMapObjectSetManyValues<TValue>
  : LiveMapWriteValue<TValue>;
export type LiveMapPathSetValue<TValue, TPath extends LivePath> = LiveMapSetValue<LiveMapPathValue<TValue, TPath>>;
/** Object patch shape accepted by `setMany` at a projected path. */
export type LiveMapPathSetManyValues<TValue, TPath extends LivePath> =
  LiveMapObjectSetManyValues<LiveMapPathValue<TValue, TPath>>;

export type LiveMapReplaceFn<TValue = JsonValue | undefined> = {
  (value: NoInfer<LiveMapWriteValue<TValue>>): LiveMapCommit;
  <const TPath extends LivePath>(
    path: TPath,
    value: NoInfer<LiveMapPathWriteValue<TValue, TPath>>,
  ): LiveMapCommit;
};

export type LiveMapBatchReplaceFn<TValue = JsonValue | undefined> = {
  (value: NoInfer<LiveMapWriteValue<TValue>>): LiveMapBatchTx<TValue>;
  <const TPath extends LivePath>(
    path: TPath,
    value: NoInfer<LiveMapPathWriteValue<TValue, TPath>>,
  ): LiveMapBatchTx<TValue>;
};

/**
 * Synchronous transaction handle passed to `map.batch(...)`.
 *
 * Batch is an explicit grouping envelope, not automatic notification
 * coalescing. The transaction mirrors Core semantics: `replace` performs exact
 * endpoint replacement, while object-valued `set` and `setMany` perform shallow
 * sibling-preserving object writes.
 */
export type LiveMapBatchTx<TValue = JsonValue | undefined> = Readonly<{
  /** Set a resolved projected path; plain objects expand into shallow child sets. */
  set: <const TPath extends LivePath>(
    path: TPath,
    value: NoInfer<LiveMapPathSetValue<TValue, TPath>>,
  ) => LiveMapBatchTx<TValue>;
  /** Exact root replacement, or exact endpoint replacement at a projected path. */
  replace: LiveMapBatchReplaceFn<TValue>;
  /** Shallow object set that expands values into child-path sets and preserves unspecified siblings. */
  setMany: <const TPath extends LivePath>(
    path: TPath,
    values: NoInfer<LiveMapPathSetManyValues<TValue, TPath>>,
  ) => LiveMapBatchTx<TValue>;
  splice: (path: LivePath, start: number, deleteCount: number, ...items: readonly JsonValue[]) => LiveMapBatchTx<TValue>;
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
/** Throwing inspection surface for the schema attached to a LiveMap Core. */
export type LiveMapCoreSchemaMustApi = Readonly<{
  resolve: (path: LivePath) => LiveMapSchemaResolution;
}>;

export type LiveMapCoreSchemaApi<TValue = JsonValue | undefined> = Readonly<{
  get: () => LiveMapSchema | undefined;
  use: <TSchema extends LiveMapSchema>(
    schema: TSchema,
  ) => LiveMap<LiveMapSchemaValue<TSchema>>;
  /** Return the public schema rule matching one concrete path, if attached. */
  match: (path: LivePath) => LiveMapSchemaRule | undefined;
  /** Resolve one concrete path through the attached schema, if present. */
  resolve: (path: LivePath) => LiveMapSchemaResolution | undefined;
  /** Return whether the attached schema resolves one concrete path. */
  has: (path: LivePath) => boolean;
  /** Throwing attached-schema inspection surface. */
  must: LiveMapCoreSchemaMustApi;
}>;

/** Explicitly unsafe access to the live HSON graph owned by a LiveMap. */
export type LiveMapDebugApi = Readonly<{
  node: (path: LivePath) => LiveMapNodeHandle;
}>;

export type LiveMapCore<
  TValue = JsonValue | undefined,
  TMode extends LiveMapRootMode = LiveMapRootMode,
> = Readonly<{
  /** Canonical capability selected from the validated graph at construction. */
  readonly mode: TMode;
  /** Return a detached structural clone of the complete canonical root graph. */
  root: () => HsonNode;
  snap: LiveMapCoreSnap<TValue>;
  schema: LiveMapCoreSchemaApi<TValue>;
  withSchema: <TSchema extends LiveMapSchema>(schema: TSchema) => LiveMap<LiveMapSchemaValue<TSchema>>;
  at: <const TPath extends LivePath>(path: TPath) => LiveMapPathHandle<LiveMapPathValue<TValue, TPath>>;
  proxy: <const TPath extends LivePath = []>(path?: TPath) => LiveMapProxy<TValue, TPath>;
  /** Set a resolved projected path; plain objects expand into shallow child sets. */
  set: <const TPath extends LivePath>(path: TPath, value: NoInfer<LiveMapPathSetValue<TValue, TPath>>) => LiveMapCommit;
  /** Shallow object set that expands values into child-path sets and preserves unspecified siblings. */
  setMany: <const TPath extends LivePath>(
    path: TPath,
    values: NoInfer<LiveMapPathSetManyValues<TValue, TPath>>,
  ) => LiveMapCommit;
  splice: (path: LivePath, start: number, deleteCount: number, ...items: readonly JsonValue[]) => LiveMapCommit;
  /** Exact root replacement, or exact endpoint replacement at a projected path; `set([])` remains invalid. */
  replace: LiveMapReplaceFn<TValue>;
  delete: (path: LivePath) => LiveMapCommit;
  /** Explicit synchronous transaction grouping for one commit. */
  batch: (fn: (tx: LiveMapBatchTx<TValue>) => void) => LiveMapCommit;
  feed: (path: LivePath, listener: LiveMapFeedListener) => LiveMapDisposer;
  commits: LiveMapCommitObserverApi;
  sub: LiveMapSubApi<TValue>;
  debug: LiveMapDebugApi;
  readonly rev: number;
  capture: () => LiveMapCapture<TValue>;
  /** Atomically restore projected state and its exact captured revision. */
  restore: (capture: LiveMapCapture<TValue>) => void;
  apply: (input: LiveMapApply<TValue>) => LiveMapCommit;
  replay: (input: LiveMapReplay) => LiveMapCommit;
}>;

/**
 * Public LiveMap surface.
 *
 * `TValue` is the current projected root value type. A map created without a
 * schema starts as `LiveMap<JsonValue | undefined>`. After attaching an inferred
 * schema with `map.schema.use(schema)` or `map.withSchema(schema)`, the returned
 * map view becomes `LiveMap<LiveMapSchemaValue<typeof schema>>`.
 */
export type LiveMap<TValue = JsonValue | undefined> = Readonly<
  Omit<LiveMapCore<TValue, LiveMapRootMode>, "mode"> & {
    readonly mode: DataLiveMapMode;
  }
>;

/** Detached, revision-coupled canonical capture for a document LiveMap. */
export type DocumentLiveMapCapture<
  TMode extends DocumentLiveMapMode = DocumentLiveMapMode,
> = Readonly<{
  kind: "hson-document";
  version: 1;
  mode: TMode;
  rev: number;
  root: HsonNode;
}>;

/** Optimistic target-local revision guard for canonical document installation. */
export type DocumentLiveMapInstallOptions = Readonly<{
  expectedRev?: number;
}>;

/** Numeric traversal through canonical document `$_content` arrays. */
export type LiveMapDocumentPath = readonly number[];

/** One unambiguous canonical-document addressing mode. */
export type LiveMapDocumentTarget =
  | Readonly<{ kind: "path"; path: LiveMapDocumentPath }>
  | Readonly<{ kind: "quid"; quid: string }>;

/** Existing canonical HSON attribute value model; style remains structured. */
export type LiveMapDocumentAttributeValue = Primitive | CssMap;

/** Detached canonical final-state bag for public ordinary document attributes. */
export type LiveMapDocumentAttrs = Readonly<Record<string, LiveMapDocumentAttributeValue>>;

/** One legal candidate value for a canonical HSON `$_content` slot. */
export type LiveMapDocumentContent = NodeContent[number];

/** Canonical ordinary-attribute mutation namespace. */
export type DocumentLiveMapAttrsApi = Readonly<{
  set: (
    target: LiveMapDocumentTarget,
    name: string,
    value: LiveMapDocumentAttributeValue,
  ) => LiveMapGraphCommit<LiveMapGraphSetAttrOp>;
  drop: (
    target: LiveMapDocumentTarget,
    name: string,
  ) => LiveMapGraphCommit<LiveMapGraphRemoveAttrOp>;
  setMany: (
    target: LiveMapDocumentTarget,
    values: LiveMapDocumentAttrs,
  ) => LiveMapGraphCommit<LiveMapGraphReplaceAttrsOp>;
  dropMany: (
    target: LiveMapDocumentTarget,
    names: readonly string[],
  ) => LiveMapGraphCommit<LiveMapGraphReplaceAttrsOp>;
  clear: (
    target: LiveMapDocumentTarget,
  ) => LiveMapGraphCommit<LiveMapGraphReplaceAttrsOp>;
  replace: (
    target: LiveMapDocumentTarget,
    values: LiveMapDocumentAttrs,
  ) => LiveMapGraphCommit<LiveMapGraphReplaceAttrsOp>;
}>;

/** Detached content reader plus atomic single-slot structural mutations. */
export type DocumentLiveMapContentApi = (() => readonly NodeContent[number][]) & Readonly<{
  replace: (
    target: LiveMapDocumentTarget,
    index: number,
    replacement: LiveMapDocumentContent,
  ) => LiveMapGraphCommit<LiveMapGraphReplaceContentOp>;
  insert: (
    target: LiveMapDocumentTarget,
    index: number,
    content: LiveMapDocumentContent,
  ) => LiveMapGraphCommit<LiveMapGraphInsertContentOp>;
  remove: (
    target: LiveMapDocumentTarget,
    index: number,
  ) => LiveMapGraphCommit<LiveMapGraphRemoveContentOp>;
  move: (
    target: LiveMapDocumentTarget,
    from: number,
    to: number,
  ) => LiveMapGraphCommit<LiveMapGraphMoveContentOp>;
}>;

/** Shared detached canonical reads for element and fragment capabilities. */
export type LiveMapDocumentApi = Readonly<{
  /** Return a detached clone of the complete canonical root. */
  root: () => HsonNode;
  /** Return detached top-level document content in canonical order. */
  content: DocumentLiveMapContentApi;
  /** Resolve persisted document identity to a detached element clone. */
  byQuid: (quid: string) => HsonNode | undefined;
  /** Canonical ordinary-attribute mutation namespace. */
  attrs: DocumentLiveMapAttrsApi;
}>;

type DocumentLiveMapShared<TMode extends DocumentLiveMapMode> = Readonly<{
  readonly mode: TMode;
  readonly rev: number;
  root: () => HsonNode;
  capture: () => DocumentLiveMapCapture<TMode>;
  /** Atomically replace this document with a canonical same-mode capture. */
  install: (
    capture: DocumentLiveMapCapture,
    options?: DocumentLiveMapInstallOptions,
  ) => LiveMapGraphCommit<LiveMapGraphReplaceRootOp>;
  /** Restore one same-mode canonical snapshot at its exact captured revision. */
  restore: (
    capture: DocumentLiveMapCapture,
    options?: DocumentLiveMapInstallOptions,
  ) => void;
  /** Atomically replay one validated canonical graph commit. */
  replay: (commit: LiveMapGraphCommit) => LiveMapGraphCommit;
  /** Observe successful canonical graph commits without projected path coercion. */
  commits: LiveMapCommitObserverApi;
  /** Explicitly unsafe live graph access; mutations bypass all normal guarantees. */
  debug: LiveMapDebugApi;
}>;

export type ElementLiveMap = DocumentLiveMapShared<"element"> & Readonly<{
  readonly document: LiveMapDocumentApi;
  /** Return a detached clone of the single top-level ordinary element. */
  element: Readonly<{ node: () => HsonNode }>;
}>;

export type FragmentLiveMap = DocumentLiveMapShared<"fragment"> & Readonly<{
  readonly document: LiveMapDocumentApi;
}>;

/** Shape-specific document façade with detached reads and atomic capture install. */
export type DocumentLiveMap = ElementLiveMap | FragmentLiveMap;

/** Mode-neutral authority boundary shared by schema-narrowed data and document maps. */
export type LiveMapAuthority = Readonly<{
  readonly mode: LiveMapRootMode;
  readonly rev: number;
  root: () => HsonNode;
  /** Mode-specific captures share an atomic authoritative revision. */
  capture: () => Readonly<{ rev: number }>;
  commits: LiveMapCommitObserverApi;
}>;

/** Result of HSON/node construction after canonical root classification. */
export type ClassifiedLiveMap = LiveMap | DocumentLiveMap;

/**
 * Normalized set operation emitted by a LiveMap mutation.
 *
 * Ops are intentionally data-shaped and replayable. Primitive/array/null
 * `set(...)`, shallow child writes from object-valued `set(...)` and
 * `setMany(...)`, array helper rewrites, and `update(fn)` commits report `set`
 * ops at the projected paths they changed.
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
 * Normalized endpoint replacement operation emitted by a LiveMap mutation.
 *
 * Root replacement is intentionally distinct from `set([])`: projected child
 * path writes still reject empty paths, while `replace(...)` makes exact
 * root/endpoint overwrite explicit. The runtime overwrites the existing root
 * node in place for root replacement so existing handles stay attached.
 */
export type LiveMapReplaceOp = Readonly<{
  kind: "replace";
  path: LivePath;
  prev: JsonValue | undefined;
  next: JsonValue | undefined;
}>;

/** Normalized operation emitted by a LiveMap mutation. */
export type LiveMapDataOp = LiveMapSetOp | LiveMapDeleteOp | LiveMapReplaceOp | LiveMapSpliceOp;

/** Complete canonical document-root replacement; deliberately not a data op. */
export type LiveMapGraphReplaceRootOp = Readonly<{
  domain: "graph";
  op: "replace-root";
  mode: DocumentLiveMapMode;
  root: HsonNode;
}>;

export type LiveMapGraphSetAttrOp = Readonly<{
  domain: "graph";
  op: "set-attr";
  target: LiveMapDocumentTarget;
  name: string;
  value: LiveMapDocumentAttributeValue;
}>;

export type LiveMapGraphRemoveAttrOp = Readonly<{
  domain: "graph";
  op: "remove-attr";
  target: LiveMapDocumentTarget;
  name: string;
}>;

/** Atomic final-state replacement of one element's complete ordinary attribute bag. */
export type LiveMapGraphReplaceAttrsOp = Readonly<{
  domain: "graph";
  op: "replace-attrs";
  target: LiveMapDocumentTarget;
  attrs: LiveMapDocumentAttrs;
}>;

export type LiveMapGraphReplaceContentOp = Readonly<{
  domain: "graph";
  op: "replace-content";
  target: LiveMapDocumentTarget;
  index: number;
  replacement: LiveMapDocumentContent;
}>;

export type LiveMapGraphInsertContentOp = Readonly<{
  domain: "graph";
  op: "insert-content";
  target: LiveMapDocumentTarget;
  index: number;
  content: LiveMapDocumentContent;
}>;

export type LiveMapGraphRemoveContentOp = Readonly<{
  domain: "graph";
  op: "remove-content";
  target: LiveMapDocumentTarget;
  index: number;
}>;

export type LiveMapGraphMoveContentOp = Readonly<{
  domain: "graph";
  op: "move-content";
  target: LiveMapDocumentTarget;
  from: number;
  to: number;
}>;

/** Canonical graph-domain operations; distinct from projected JSON writes. */
export type LiveMapGraphOp =
  | LiveMapGraphReplaceRootOp
  | LiveMapGraphSetAttrOp
  | LiveMapGraphRemoveAttrOp
  | LiveMapGraphReplaceAttrsOp
  | LiveMapGraphReplaceContentOp
  | LiveMapGraphInsertContentOp
  | LiveMapGraphRemoveContentOp
  | LiveMapGraphMoveContentOp;

/** Select a LiveMap operation domain; bare use preserves the existing data domain. */
export type LiveMapOp<TDomain extends "data" | "graph" = "data"> =
  TDomain extends "graph" ? LiveMapGraphOp : LiveMapDataOp;

/** Full shared operation family used by the generic commit envelope. */
export type LiveMapAnyOp = LiveMapOp<"data" | "graph">;

/**
 * Normalized mutation record returned by Core.
 *
 * A commit can contain zero, one, or many ops. Empty commits represent unchanged
 * writes/deletes. Multi-op commits are used by `setMany(...)`, object-valued
 * `set(...)`, and explicit `batch(...)` calls.
 */
export type LiveMapCommit<TOp extends LiveMapAnyOp = LiveMapDataOp> = Readonly<{
  changed: boolean;
  rev: number;
  prevRev: number;
  ops: readonly TOp[];
}>;

/** Existing commit envelope specialized to graph-domain operations. */
export type LiveMapGraphCommit<TOp extends LiveMapGraphOp = LiveMapGraphOp> = LiveMapCommit<TOp>;

/** Why a canonical commit became visible on one LiveMap instance. */
export type LiveMapCommitOrigin = "authoritative" | "replay";

/** Shared commit observation event across projected and canonical graph modes. */
export type LiveMapCommitObservation<TOp extends LiveMapAnyOp = LiveMapAnyOp> =
  | Readonly<{
    kind: "commit";
    commit: LiveMapCommit<TOp>;
    origin: "authoritative" | "replay";
  }>
  | Readonly<{
    kind: "snapshot";
    origin: "snapshot";
    revision: number;
  }>;

export type LiveMapCommitObserver<TOp extends LiveMapAnyOp = LiveMapAnyOp> = (
  observation: LiveMapCommitObservation<TOp>,
) => void;

export type LiveMapCommitObserverApi<TOp extends LiveMapAnyOp = LiveMapAnyOp> = Readonly<{
  observe: (observer: LiveMapCommitObserver<TOp>) => LiveMapDisposer;
}>;

/**
 * Event delivered to a feed listener.
 *
 * `op` is the first matching op for compatibility. `ops` contains all matching
 * ops from the commit. `path` is the subscriber's path. `value` is the current
 * projected value at the subscriber's path after the commit has been applied.
 */
export type LiveMapFeedEvent = Readonly<{
  op: LiveMapDataOp;
  path: LivePath;
  value: JsonValue | undefined;
  ops: readonly LiveMapDataOp[];
  commit: LiveMapCommit;
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

/**
 * Unsafe live canonical-node handle, exposed only through `map.debug.node(...)`.
 *
 * Mutations through this handle edit the owned HSON graph directly. They bypass
 * projected writes, schema validation, commits, revisions, feeds,
 * subscriptions, and ordinary LiveMap state guarantees. Avoid this surface in
 * normal application state code.
 */
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
export type LiveMapObjectSetValue<TValue, TKey extends LiveMapObjectKey<TValue>> = LiveMapSetValue<LiveMapObjectShape<TValue>[TKey]>;

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
  readonly quid: LiveMapQuid;
  /** Current revision of the owning LiveMap. */
  readonly rev: number;
  path: () => LivePath;
  snap: () => TValue;
  /** Create a child handle relative to this handle's projected path. */
  at: <const TPath extends LivePath>(path: TPath) => LiveMapPathHandle<LiveMapPathValue<TValue, TPath>>;
  /** Set this resolved handle path; plain objects expand into shallow child sets. */
  set: (value: LiveMapSetValue<TValue>) => LiveMapCommit;
  /** Exact replacement at this handle path using replace-shaped commit ops. */
  replace: (value: LiveMapWriteValue<TValue>) => LiveMapCommit;
  /** Shallow object set below this handle path, preserving unspecified siblings. */
  setMany: (values: NoInfer<LiveMapObjectSetManyValues<TValue>>) => LiveMapCommit;
  /** Delete this handle path. */
  delete: () => LiveMapCommit;
  update: (updater: (value: TValue) => LiveMapSetValue<TValue>) => LiveMapCommit;
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
  /** Set one child key under this object path, creating that key if needed. */
  setKey: <const TKey extends LiveMapObjectKey<TValue>>(key: TKey, value: NoInfer<LiveMapObjectSetValue<TValue, TKey>>) => LiveMapCommit;
  /** Shallow child-key writes under this object path, preserving unspecified siblings. */
  setMany: (values: NoInfer<LiveMapObjectSetManyValues<TValue>>) => LiveMapCommit,
  clear: () => LiveMapCommit;
  deleteKey: (key: string) => LiveMapCommit;
  deleteMany: (keys: readonly string[]) => LiveMapCommit;
  renameKey: (fromKey: string, toKey: string) => LiveMapCommit;
}>;
/**
 * Array-scoped helper API.
 *
 * Helpers read the current array at the handle path, build a complete next
 * array, then write it through `set` at the array endpoint. That means array
 * helpers require the array path itself to resolve.
 */
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

export type LiveMapSchemaIssueCode =
  | "TYPE_MISMATCH"
  | "MISSING_REQUIRED"
  | "UNKNOWN_PATH"
  | "UNKNOWN_KEY"
  | "INVALID_LITERAL"
  | "INVALID_REFINEMENT"
  | "INVALID_SCHEMA"
  | "TUPLE_INDEX_OUT_OF_RANGE";

export type LiveMapSpliceWriteOp = Readonly<{
  kind: "splice";
  path: LivePath;
  start: number;
  deleteCount: number;
  items: readonly JsonValue[];
}>;

export type LiveMapSpliceOp = Readonly<{
  kind: "splice";
  path: LivePath;
  start: number;
  removed: readonly JsonValue[];
  inserted: readonly JsonValue[];
  prev: JsonValue;
  next: JsonValue;
}>;

export type LiveMapCapture<TValue = JsonValue | undefined> = Readonly<{
  rev: number;
  value: TValue;
}>;

export type LiveMapApply<TValue = JsonValue | undefined> = Readonly<{
  prevRev: number;
  value: TValue;
}>;

export type LiveMapReplay = Readonly<{
  prevRev: number;
  ops: readonly LiveMapDataOp[];
}>;
