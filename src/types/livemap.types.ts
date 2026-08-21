// livemap.types.ts

import type { CanonicalPublicAttrs, CanonicalPublicAttrValue, HsonNode, JsonValue, NodeContent, Primitive } from "../core/types.js";
import type {
  LiveMapSchema,
  LiveMapProjectedSchema,
  LiveMapSchemaResolution,
  LiveMapSchemaRule,
  LiveMapSchemaValue,
} from "../api/livemap/livemap.schema.js";
import type {
  InternalDocumentRootSchemaForMode,
  InternalDocumentSchemaEvidence,
  DocumentAttrsEvidence,
  DocumentAttrValueEvidence,
} from "../api/livemap/livemap.document.schema.js";


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

export type LiveMapCaptureIdentity = "same-epoch" | "preserve-metadata" | "strip";
export type LiveMapCaptureOptions = Readonly<{ identity: LiveMapCaptureIdentity }>;
export type LiveMapRestoreOptions = Readonly<{ identity?: LiveMapCaptureIdentity | "reject" }>;

export type LiveMapCoreReplay = {
  (input: LiveMapGraphCommit<LiveMapProjectedGraphEnsureQuidOp>): LiveMapGraphCommit<LiveMapProjectedGraphEnsureQuidOp>;
  (input: LiveMapReplay): LiveMapCommit<LiveMapDataOp>;
};

declare const LIVEMAP_INVALID_STATIC_PATH: unique symbol;
type LiveMapInvalidStaticPath = Readonly<{ [LIVEMAP_INVALID_STATIC_PATH]: true }>;

type LiveMapTupleSegment<TValue extends readonly unknown[], THead extends number> =
  number extends THead
  ? TValue[number] | undefined
  : `${THead}` extends keyof TValue
  ? TValue[THead & keyof TValue]
  : LiveMapInvalidStaticPath;

type LiveMapArraySegment<TValue extends readonly unknown[], THead extends number> =
  number extends TValue["length"]
  ? TValue[number] | undefined
  : LiveMapTupleSegment<TValue, THead>;

type LiveMapObjectSegment<TValue extends object, THead> =
  THead extends string
  ? string extends THead
  ? JsonValue | undefined
  : THead extends keyof TValue
  ? TValue[THead] | (string extends keyof TValue ? undefined : never)
  : LiveMapInvalidStaticPath
  : LiveMapInvalidStaticPath;

type LiveMapPathSegmentBranch<TValue, THead> =
  unknown extends TValue
  ? JsonValue | undefined
  : TValue extends null | undefined
  ? LiveMapInvalidStaticPath
  : TValue extends readonly unknown[]
  ? THead extends number
  ? LiveMapArraySegment<TValue, THead>
  : LiveMapInvalidStaticPath
  : TValue extends object
  ? LiveMapObjectSegment<TValue, THead>
  : LiveMapInvalidStaticPath;

type LiveMapPathSegmentBranches<TValue, THead> =
  TValue extends unknown ? LiveMapPathSegmentBranch<TValue, THead> : never;

type LiveMapReachablePathSegment<TValue, THead> = Exclude<
  LiveMapPathSegmentBranches<TValue, THead>,
  LiveMapInvalidStaticPath
>;

type LiveMapPathSegmentValue<TValue, THead> =
  [LiveMapReachablePathSegment<TValue, THead>] extends [never]
  ? LiveMapInvalidStaticPath
  : LiveMapReachablePathSegment<TValue, THead>
    | ([Extract<LiveMapPathSegmentBranches<TValue, THead>, LiveMapInvalidStaticPath>] extends [never]
      ? never
      : undefined);

type ResolveLiveMapPathValue<TValue, TPath extends LivePath> =
  number extends TPath["length"]
  ? JsonValue | undefined
  : TPath extends readonly []
  ? TValue
  : TPath extends readonly [infer THead, ...infer TRest]
  ? ResolveLiveMapPathValue<
    LiveMapPathSegmentValue<TValue, THead>,
    Extract<TRest, LivePath>
  >
  : JsonValue | undefined;

/**
 * Static value projection for a LivePath.
 *
 * Exact literal paths narrow recursively. Branches that cannot continue below
 * an optional, nullable, union, or indexed ancestor contribute `undefined`.
 * A literal path that cannot traverse any branch resolves to `never`, while a
 * broad runtime `LivePath` retains the validated `JsonValue | undefined` route.
 */
type PublicLiveMapPathValue<TResult> =
  [TResult] extends [LiveMapInvalidStaticPath]
  ? never
  : TResult;

export type LiveMapPathValue<TValue, TPath extends LivePath> = PublicLiveMapPathValue<
  ResolveLiveMapPathValue<TValue, TPath>
>;

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
  (value: NoInfer<LiveMapWriteValue<TValue>>): LiveMapCommit<LiveMapDataOp>;
  <const TPath extends LivePath>(
    path: TPath,
    value: NoInfer<LiveMapPathWriteValue<TValue, TPath>>,
  ): LiveMapCommit<LiveMapDataOp>;
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
 *
 * The first successful attachment permanently governs that owner. Reusing the
 * same schema object is idempotent; any distinct schema object rejects.
 */
/** Throwing inspection surface for the schema attached to a LiveMap Core. */
export type LiveMapCoreSchemaMustApi = Readonly<{
  resolve: (path: LivePath) => LiveMapSchemaResolution;
}>;

export type LiveMapCoreSchemaApi<TValue = JsonValue | undefined> = Readonly<{
  get: () => LiveMapProjectedSchema | undefined;
  use: <TSchema extends LiveMapProjectedSchema>(
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
  at: <const TPath extends LivePath>(
    path: TPath & ([LiveMapPathValue<TValue, TPath>] extends [never] ? never : unknown),
  ) => LiveMapPathHandle<LiveMapPathValue<TValue, TPath>>;
  proxy: <const TPath extends LivePath = []>(path?: TPath) => LiveMapProxy<TValue, TPath>;
  /** Set a resolved projected path; plain objects expand into shallow child sets. */
  set: <const TPath extends LivePath>(path: TPath, value: NoInfer<LiveMapPathSetValue<TValue, TPath>>) => LiveMapCommit<LiveMapDataOp>;
  /** Shallow object set that expands values into child-path sets and preserves unspecified siblings. */
  setMany: <const TPath extends LivePath>(
    path: TPath,
    values: NoInfer<LiveMapPathSetManyValues<TValue, TPath>>,
  ) => LiveMapCommit<LiveMapDataOp>;
  splice: (path: LivePath, start: number, deleteCount: number, ...items: readonly JsonValue[]) => LiveMapCommit<LiveMapDataOp>;
  /** Exact root replacement, or exact endpoint replacement at a projected path; `set([])` remains invalid. */
  replace: LiveMapReplaceFn<TValue>;
  delete: (path: LivePath) => LiveMapCommit<LiveMapDataOp>;
  /** Explicit synchronous transaction grouping for one commit. */
  batch: (fn: (tx: LiveMapBatchTx<TValue>) => void) => LiveMapCommit<LiveMapDataOp>;
  feed: (path: LivePath, listener: LiveMapFeedListener) => LiveMapDisposer;
  commits: LiveMapCommitObserverApi;
  sub: LiveMapSubApi<TValue>;
  readonly rev: number;
  /** Emit the canonical structural-JSON capture with detached graph metadata. */
  capture: {
    (): LiveMapCapture;
    (options: LiveMapCaptureOptions): LiveMapCapture;
  };
  /** Atomically restore one canonical structural-JSON capture. */
  restore: (capture: LiveMapCapture, options?: LiveMapRestoreOptions) => void;
  /** Apply canonical structural-JSON state at one base revision. */
  apply: (input: LiveMapApply) => LiveMapCommit<LiveMapDataOp>;
  /** Replay one canonical structural-JSON operation envelope. */
  replay: LiveMapCoreReplay;
}>;

/**
 * Public LiveMap surface.
 *
 * `TValue` is the current projected root value type. A map created without a
 * schema starts as `LiveMap<JsonValue | undefined>`. After attaching an inferred
 * schema with `map.schema.use(schema)`, the returned
 * map view becomes `LiveMap<LiveMapSchemaValue<typeof schema>>`.
 */
export type LiveMap<TValue = JsonValue | undefined> = Readonly<
  Omit<LiveMapCore<TValue, LiveMapRootMode>, "mode"> & {
    readonly mode: DataLiveMapMode;
  }
>;

/** Detached exact canonical capture, including admitted QUID metadata. */
export type DocumentLiveMapCapture<
  TMode extends DocumentLiveMapMode = DocumentLiveMapMode,
> = Readonly<{
  kind: "hson-document";
  mode: TMode;
  rev: number;
  root: HsonNode;
}>;

/** Explicit identity treatment for one detached document capture. */
export type DocumentLiveMapCaptureIdentity =
  | "same-epoch"
  | "preserve-metadata"
  | "strip";

/** Capture policy. Omission preserves durable exact metadata. */
export type DocumentLiveMapCaptureOptions = Readonly<{
  identity: DocumentLiveMapCaptureIdentity;
}>;

/** Explicit identity treatment at a complete document admission boundary. */
export type DocumentLiveMapInstallIdentity =
  | DocumentLiveMapCaptureIdentity
  | "reject";

/** Callable capture surface with an additive identity-category selector. */
export type DocumentLiveMapCaptureApi<
  TMode extends DocumentLiveMapMode = DocumentLiveMapMode,
> = {
  (): DocumentLiveMapCapture<TMode>;
  (options: DocumentLiveMapCaptureOptions): DocumentLiveMapCapture<TMode>;
};

/** Optimistic revision guard plus explicit complete-root identity admission policy. */
export type DocumentLiveMapInstallOptions = Readonly<{
  expectedRev?: number;
  identity?: DocumentLiveMapInstallIdentity;
}>;

declare const LIVEMAP_DOCUMENT_PATH_BRAND: unique symbol;

/**
 * Validated, detached numeric traversal through canonical document
 * `$_content` arrays. Runtime values remain frozen ordinary arrays.
 */
export type LiveMapDocumentPath = readonly number[] & Readonly<{
  [LIVEMAP_DOCUMENT_PATH_BRAND]: true;
}>;

/** Untrusted caller representation accepted at the live request boundary. */
export type LiveMapDocumentPathInput = readonly number[];

/** Current live request target; QUID lookup is compatibility-only and epoch-scoped. */
export type LiveMapDocumentRequestTarget =
  | Readonly<{ kind: "path"; path: LiveMapDocumentPathInput }>
  | Readonly<{ kind: "quid"; quid: string }>;

/**
 * Opaque active-epoch capability for one explicitly identified document node.
 *
 * The handle does not expose its canonical QUID. It resolves through the
 * owning map's current sparse overlay and cannot be reconstructed from raw
 * metadata bytes.
 */
export type LiveMapDocumentIdentityHandle = Readonly<{
  /** Whether the exact owner epoch still contains this live identity. */
  readonly active: boolean;
  /** Resolve the identity's current frozen canonical content path. */
  path: () => LiveMapDocumentPath | undefined;
  /** Return a detached clone of the current canonical node. */
  snap: () => HsonNode | undefined;
  /** Release this handle without removing canonical QUID metadata. */
  dispose: () => void;
}>;

/** Opaque active-epoch capability for one projected object or array value. */
export type LiveMapProjectedIdentityHandle<TValue extends JsonValue = JsonValue> = Readonly<{
  readonly active: boolean;
  path: () => LivePath | undefined;
  snap: () => TValue | undefined;
  dispose: () => void;
}>;

/** Optional same-epoch diagnostic evidence; never a routing address. */
export type LiveMapDocumentTargetWitness = Readonly<{ quid: string }>;

/** Path-authoritative target stored by canonical graph operations. */
export type LiveMapDocumentCommitTarget = Readonly<{
  kind: "path";
  path: LiveMapDocumentPath;
  witness?: LiveMapDocumentTargetWitness;
}>;

/** Projected-path target stored only by canonical identity registration. */
export type LiveMapProjectedIdentityCommitTarget = Readonly<{
  kind: "path";
  path: LivePath;
  projected: true;
}>;

/** @deprecated Compatibility name for the live request-target union. */
export type LiveMapDocumentTarget = LiveMapDocumentRequestTarget;

/** Existing canonical HSON attribute value model; style remains structured. */
export type LiveMapDocumentAttributeValue = CanonicalPublicAttrValue;

/** Detached canonical final-state bag for public ordinary document attributes. */
export type LiveMapDocumentAttrs = CanonicalPublicAttrs;

/** One legal candidate value for a canonical HSON `$_content` slot. */
export type LiveMapDocumentContent = NodeContent[number];

export type DocumentLiveMapAttrsMustApi = Readonly<{
  get: (
    target: LiveMapDocumentRequestTarget,
    name: string,
  ) => LiveMapDocumentAttributeValue;
}>;

export type DocumentLiveMapAttrsReadApi = Readonly<{
  get: (
    target: LiveMapDocumentRequestTarget,
    name: string,
  ) => LiveMapDocumentAttributeValue | undefined;
  has: (
    target: LiveMapDocumentRequestTarget,
    name: string,
  ) => boolean;
  keys: (
    target: LiveMapDocumentRequestTarget,
  ) => readonly string[];
  must: DocumentLiveMapAttrsMustApi;
}>;

export type DocumentLiveMapAttrsMutationApi = Readonly<{
  set: (
    target: LiveMapDocumentRequestTarget,
    name: string,
    value: LiveMapDocumentAttributeValue,
  ) => LiveMapGraphCommit<LiveMapGraphSetAttrOp>;
  drop: (
    target: LiveMapDocumentRequestTarget,
    name: string,
  ) => LiveMapGraphCommit<LiveMapGraphRemoveAttrOp>;
  setMany: (
    target: LiveMapDocumentRequestTarget,
    values: LiveMapDocumentAttrs,
  ) => LiveMapGraphCommit<LiveMapGraphReplaceAttrsOp>;
  dropMany: (
    target: LiveMapDocumentRequestTarget,
    names: readonly string[],
  ) => LiveMapGraphCommit<LiveMapGraphReplaceAttrsOp>;
  clear: (
    target: LiveMapDocumentRequestTarget,
  ) => LiveMapGraphCommit<LiveMapGraphReplaceAttrsOp>;
  replace: (
    target: LiveMapDocumentRequestTarget,
    values: LiveMapDocumentAttrs,
  ) => LiveMapGraphCommit<LiveMapGraphReplaceAttrsOp>;
}>;

/** Canonical ordinary-attribute read and mutation namespace. */
export type DocumentLiveMapAttrsApi = DocumentLiveMapAttrsReadApi & DocumentLiveMapAttrsMutationApi;

/** Presence-oriented reads over same-name canonical flag-form attributes. */
export type DocumentLiveMapFlagsReadApi = Readonly<{
  has: (
    target: LiveMapDocumentRequestTarget,
    name: string,
  ) => boolean;
}>;

/** Atomic semantic flag transitions over the complete canonical attrs bag. */
export type DocumentLiveMapFlagsMutationApi = Readonly<{
  set: (
    target: LiveMapDocumentRequestTarget,
    ...names: string[]
  ) => LiveMapGraphCommit<LiveMapGraphReplaceAttrsOp>;
  clear: (
    target: LiveMapDocumentRequestTarget,
    ...names: string[]
  ) => LiveMapGraphCommit<LiveMapGraphReplaceAttrsOp>;
}>;

export type DocumentLiveMapFlagsApi = DocumentLiveMapFlagsReadApi & DocumentLiveMapFlagsMutationApi;

/** Detached content reader plus atomic single-slot structural mutations. */
export type DocumentLiveMapContentApi = (() => readonly NodeContent[number][]) & Readonly<{
  replace: (
    target: LiveMapDocumentRequestTarget,
    index: number,
    replacement: LiveMapDocumentContent,
  ) => LiveMapGraphCommit<LiveMapGraphReplaceContentOp>;
  insert: (
    target: LiveMapDocumentRequestTarget,
    index: number,
    content: LiveMapDocumentContent,
  ) => LiveMapGraphCommit<LiveMapGraphInsertContentOp>;
  remove: (
    target: LiveMapDocumentRequestTarget,
    index: number,
  ) => LiveMapGraphCommit<LiveMapGraphRemoveContentOp>;
  move: (
    target: LiveMapDocumentRequestTarget,
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
  /** Resolve a QUID in the current owned graph to a detached element clone. */
  byQuid: (quid: string) => HsonNode | undefined;
  /** Canonical ordinary-attribute mutation namespace. */
  attrs: DocumentLiveMapAttrsApi;
  /** Semantic same-name flag operations over canonical attrs. */
  flags: DocumentLiveMapFlagsApi;
}>;

type DocumentLiveMapForEvidence<
  TMode extends DocumentLiveMapMode,
  TEvidence,
> = TMode extends "element"
  ? ElementLiveMap<TEvidence>
  : FragmentLiveMap<TEvidence>;

type DocumentLiveMapSchemaApi<
  TMode extends DocumentLiveMapMode,
> = Readonly<{
  get: () => InternalDocumentRootSchemaForMode<TMode> | undefined;
  use: <TSchema extends InternalDocumentRootSchemaForMode<TMode>>(
    schema: TSchema,
  ) => DocumentLiveMapForEvidence<TMode, InternalDocumentSchemaEvidence<TSchema>>;
}>;

declare const LIVEMAP_DOCUMENT_INVALID_STATIC_PATH: unique symbol;
type InternalDocumentInvalidStaticPath = Readonly<{
  [LIVEMAP_DOCUMENT_INVALID_STATIC_PATH]: true;
}>;

declare const LIVEMAP_DOCUMENT_MISSING_COORDINATE: unique symbol;
type InternalDocumentMissingCoordinate = Readonly<{
  [LIVEMAP_DOCUMENT_MISSING_COORDINATE]: true;
}>;

declare const LIVEMAP_DOCUMENT_BROAD_SUBTREE: unique symbol;
type InternalDocumentBroadSubtree = Readonly<{
  [LIVEMAP_DOCUMENT_BROAD_SUBTREE]: true;
}>;

declare const LIVEMAP_DOCUMENT_UNSCHEMATIZED: unique symbol;
type InternalDocumentUnschematized = Readonly<{
  [LIVEMAP_DOCUMENT_UNSCHEMATIZED]: true;
}>;

declare const LIVEMAP_DOCUMENT_ROOT_DESCRIPTOR: unique symbol;
type InternalDocumentRootDescriptor<TEvidence> = Readonly<{
  [LIVEMAP_DOCUMENT_ROOT_DESCRIPTOR]: TEvidence;
}>;

type InternalDocumentSchemaEndpoint = string | HsonNode | undefined;
type InternalDocumentLegacyEndpoint = HsonNode | Primitive | undefined;

type InternalDocumentNormalizeBranches<TResult> = [Exclude<
  TResult,
  InternalDocumentInvalidStaticPath
>] extends [never]
  ? InternalDocumentInvalidStaticPath
  : Exclude<TResult, InternalDocumentInvalidStaticPath>
    | ([Extract<TResult, InternalDocumentInvalidStaticPath>] extends [never]
      ? never
      : InternalDocumentMissingCoordinate);

type InternalDocumentSequenceCoordinate<
  TItems extends readonly unknown[],
  TIndex extends number,
> = number extends TIndex
  ? TItems[number] | InternalDocumentMissingCoordinate
  : `${TIndex}` extends keyof TItems
    ? TItems[TIndex & keyof TItems]
    : InternalDocumentInvalidStaticPath;

type InternalDocumentIndexWithinCount<
  TIndex extends number,
  TCount extends number,
  TCursor extends readonly unknown[] = readonly [],
> = TCursor["length"] extends TIndex
  ? TCursor["length"] extends TCount ? false : true
  : TCursor["length"] extends TCount
    ? false
    : InternalDocumentIndexWithinCount<TIndex, TCount, readonly [...TCursor, unknown]>;

type InternalDocumentCountedCoordinateBranch<
  TCount extends number,
  TItem,
  TIndex extends number,
> = InternalDocumentIndexWithinCount<TIndex, TCount> extends true
  ? TItem
  : InternalDocumentInvalidStaticPath;

type InternalDocumentCountedCoordinateBranches<
  TCount extends number,
  TItem,
  TIndex extends number,
> = TCount extends unknown
  ? InternalDocumentCountedCoordinateBranch<TCount, TItem, TIndex>
  : never;

type InternalDocumentCountedCoordinate<
  TCount extends number,
  TItem,
  TIndex extends number,
> = number extends TCount
  ? TItem | InternalDocumentMissingCoordinate
  : number extends TIndex
    ? TItem | InternalDocumentMissingCoordinate
    : InternalDocumentNormalizeBranches<
      InternalDocumentCountedCoordinateBranches<TCount, TItem, TIndex>
    >;

type InternalDocumentContentCoordinateBranch<
  TContent,
  TIndex extends number,
> = TContent extends Readonly<{
  kind: "sequence";
  items: infer TItems extends readonly unknown[];
}>
  ? InternalDocumentSequenceCoordinate<TItems, TIndex>
  : TContent extends Readonly<{
    kind: "repeat";
    item: infer TItem;
  }>
    ? TItem | InternalDocumentMissingCoordinate
    : TContent extends Readonly<{
      kind: "counted-repeat";
      count: infer TCount extends number;
      item: infer TItem;
    }>
      ? InternalDocumentCountedCoordinate<TCount, TItem, TIndex>
    : TContent extends Readonly<{
      kind: "pick";
      choices: infer TChoices extends readonly unknown[];
    }>
      ? InternalDocumentNormalizeBranches<
        InternalDocumentContentCoordinateBranches<TChoices[number], TIndex>
      >
      : InternalDocumentInvalidStaticPath;

type InternalDocumentContentCoordinateBranches<
  TContent,
  TIndex extends number,
> = TContent extends unknown
  ? InternalDocumentContentCoordinateBranch<TContent, TIndex>
  : never;

type InternalDocumentContentCoordinate<
  TContent,
  TIndex extends number,
> = InternalDocumentNormalizeBranches<
  InternalDocumentContentCoordinateBranches<TContent, TIndex>
>;

type InternalDocumentDescendItemBranch<
  TItem,
  TPath extends readonly number[],
> = TItem extends InternalDocumentBroadSubtree
  ? InternalDocumentBroadSubtree
  : TItem extends InternalDocumentMissingCoordinate
    ? InternalDocumentInvalidStaticPath
    : TItem extends Readonly<{ kind: "text" }>
      ? InternalDocumentInvalidStaticPath
      : TItem extends Readonly<{
        kind: "element";
        content: infer TContent;
      }>
        ? TContent extends "broad"
          ? InternalDocumentBroadSubtree
          : InternalDocumentResolveContentPath<TContent, TPath>
        : TItem extends Readonly<{
          kind: "pick";
          choices: infer TChoices extends readonly unknown[];
        }>
          ? InternalDocumentNormalizeBranches<
            InternalDocumentDescendItemBranches<TChoices[number], TPath>
          >
          : InternalDocumentInvalidStaticPath;

type InternalDocumentDescendItemBranches<
  TItem,
  TPath extends readonly number[],
> = TItem extends unknown
  ? InternalDocumentDescendItemBranch<TItem, TPath>
  : never;

type InternalDocumentDescendItem<
  TItem,
  TPath extends readonly number[],
> = InternalDocumentNormalizeBranches<
  InternalDocumentDescendItemBranches<TItem, TPath>
>;

type InternalDocumentResolveContentPath<
  TContent,
  TPath extends readonly number[],
> = TPath extends readonly [
  infer THead extends number,
  ...infer TRest extends readonly number[],
]
  ? InternalDocumentContentCoordinate<TContent, THead> extends infer TCoordinate
    ? TRest extends readonly []
      ? TCoordinate
      : InternalDocumentDescendItem<TCoordinate, TRest>
    : never
  : InternalDocumentInvalidStaticPath;

type InternalDocumentResolveRootBranch<
  TEvidence,
  TPath extends readonly number[],
> = TEvidence extends Readonly<{
  kind: "element";
  content: infer TContent;
}>
  ? TContent extends "broad"
    ? InternalDocumentBroadSubtree
    : InternalDocumentResolveContentPath<TContent, TPath>
  : TEvidence extends Readonly<{
    kind: "fragment";
    content: infer TContent;
  }>
    ? InternalDocumentResolveContentPath<TContent, TPath>
    : InternalDocumentInvalidStaticPath;

type InternalDocumentResolveRootBranches<
  TEvidence,
  TPath extends readonly number[],
> = TEvidence extends unknown
  ? InternalDocumentResolveRootBranch<TEvidence, TPath>
  : never;

type InternalDocumentLogicalPathDescriptor<
  TEvidence,
  TPath extends readonly number[],
> = unknown extends TEvidence
  ? InternalDocumentUnschematized
  : number extends TPath["length"]
    ? InternalDocumentBroadSubtree
    : TPath extends readonly []
      ? InternalDocumentRootDescriptor<TEvidence>
      : InternalDocumentNormalizeBranches<
        InternalDocumentResolveRootBranches<TEvidence, TPath>
      >;

type InternalDocumentDescriptorEndpoint<TDescriptor> =
  TDescriptor extends InternalDocumentInvalidStaticPath
    ? never
    : TDescriptor extends InternalDocumentMissingCoordinate
      ? undefined
      : TDescriptor extends InternalDocumentUnschematized
        ? InternalDocumentLegacyEndpoint
        : TDescriptor extends InternalDocumentRootDescriptor<unknown>
          ? HsonNode
          : TDescriptor extends InternalDocumentBroadSubtree
            ? InternalDocumentSchemaEndpoint
            : TDescriptor extends Readonly<{ kind: "text" }>
              ? string
              : TDescriptor extends Readonly<{ kind: "element" }>
                ? HsonNode
                : TDescriptor extends Readonly<{
                  kind: "pick";
                  choices: infer TChoices extends readonly unknown[];
                }>
                  ? InternalDocumentDescriptorEndpoint<TChoices[number]>
                  : never;

type InternalDocumentLogicalPathEndpoint<
  TEvidence,
  TPath extends readonly number[],
> = unknown extends TEvidence
  ? InternalDocumentLegacyEndpoint
  : number extends TPath["length"]
    ? InternalDocumentSchemaEndpoint
    : TPath extends readonly []
      ? HsonNode
      : InternalDocumentDescriptorEndpoint<
        InternalDocumentLogicalPathDescriptor<TEvidence, TPath>
      >;

type InternalDocumentResolveDescriptorPath<
  TDescriptor,
  TPath extends readonly number[],
> = unknown extends TDescriptor
  ? InternalDocumentUnschematized
  : [TDescriptor] extends [InternalDocumentUnschematized]
    ? InternalDocumentUnschematized
    : number extends TPath["length"]
      ? InternalDocumentBroadSubtree
      : TPath extends readonly []
        ? TDescriptor
        : [TDescriptor] extends [InternalDocumentRootDescriptor<infer TEvidence>]
          ? InternalDocumentNormalizeBranches<
            InternalDocumentResolveRootBranches<TEvidence, TPath>
          >
          : InternalDocumentDescendItem<TDescriptor, TPath>;

type InternalDocumentWritableItemBranch<TDescriptor> =
  TDescriptor extends InternalDocumentMissingCoordinate
    ? never
    : TDescriptor extends InternalDocumentInvalidStaticPath
      ? never
      : TDescriptor extends InternalDocumentBroadSubtree
        ? string | HsonNode
        : TDescriptor extends Readonly<{ kind: "text" }>
          ? string
          : TDescriptor extends Readonly<{ kind: "element" }>
            ? HsonNode
            : TDescriptor extends Readonly<{
              kind: "pick";
              choices: infer TChoices extends readonly unknown[];
            }>
              ? InternalDocumentWritableItemBranches<TChoices[number]>
              : never;

type InternalDocumentWritableItemBranches<TDescriptor> =
  TDescriptor extends unknown
    ? InternalDocumentWritableItemBranch<TDescriptor>
    : never;

type InternalDocumentWritableItem<TDescriptor> =
  unknown extends TDescriptor
    ? LiveMapDocumentContent
    : TDescriptor extends InternalDocumentUnschematized
      ? LiveMapDocumentContent
      : TDescriptor extends InternalDocumentRootDescriptor<unknown>
        ? LiveMapDocumentContent
        : InternalDocumentWritableItemBranches<TDescriptor>;

type InternalDocumentContentWritableItems<TContent> =
  TContent extends Readonly<{
    kind: "sequence";
    items: infer TItems extends readonly unknown[];
  }>
    ? InternalDocumentWritableItemBranches<TItems[number]>
    : TContent extends Readonly<{
      kind: "repeat";
      item: infer TItem;
    }>
      ? InternalDocumentWritableItemBranches<TItem>
      : TContent extends Readonly<{
        kind: "counted-repeat";
        item: infer TItem;
      }>
        ? InternalDocumentWritableItemBranches<TItem>
      : TContent extends Readonly<{
        kind: "pick";
        choices: infer TChoices extends readonly unknown[];
      }>
        ? InternalDocumentContentWritableItems<TChoices[number]>
        : never;

declare const LIVEMAP_DOCUMENT_CONTENT_OWNER: unique symbol;
type InternalDocumentContentOwner<TItem> = Readonly<{
  [LIVEMAP_DOCUMENT_CONTENT_OWNER]: TItem;
}>;

declare const LIVEMAP_DOCUMENT_NOT_CONTENT_OWNER: unique symbol;
type InternalDocumentNotContentOwner = Readonly<{
  [LIVEMAP_DOCUMENT_NOT_CONTENT_OWNER]: true;
}>;

type InternalDocumentRootInsertOwner<TEvidence> =
  TEvidence extends Readonly<{
    kind: "element";
    content: infer TContent;
  }>
    ? InternalDocumentContentOwner<
      TContent extends "broad"
        ? string | HsonNode
        : InternalDocumentContentWritableItems<TContent>
    >
    : TEvidence extends Readonly<{
      kind: "fragment";
      content: infer TContent;
    }>
      ? InternalDocumentContentOwner<InternalDocumentContentWritableItems<TContent>>
      : InternalDocumentNotContentOwner;

type InternalDocumentInsertOwnerBranch<TDescriptor> =
  TDescriptor extends InternalDocumentBroadSubtree
    ? InternalDocumentContentOwner<string | HsonNode>
    : TDescriptor extends InternalDocumentRootDescriptor<infer TEvidence>
      ? InternalDocumentRootInsertOwner<TEvidence>
      : TDescriptor extends Readonly<{
        kind: "element";
        content: infer TContent;
      }>
        ? InternalDocumentContentOwner<
          TContent extends "broad"
            ? string | HsonNode
            : InternalDocumentContentWritableItems<TContent>
        >
        : TDescriptor extends Readonly<{
          kind: "pick";
          choices: infer TChoices extends readonly unknown[];
        }>
          ? InternalDocumentInsertOwnerBranches<TChoices[number]>
          : InternalDocumentNotContentOwner;

type InternalDocumentInsertOwnerBranches<TDescriptor> =
  TDescriptor extends unknown
    ? InternalDocumentInsertOwnerBranch<TDescriptor>
    : never;

type InternalDocumentInsertOwnerDomain<TOwners> =
  TOwners extends InternalDocumentContentOwner<infer TItem>
    ? TItem
    : never;

type InternalDocumentInsertItem<TDescriptor> =
  unknown extends TDescriptor
    ? LiveMapDocumentContent
    : TDescriptor extends InternalDocumentUnschematized
      ? LiveMapDocumentContent
      : InternalDocumentInsertOwnerBranches<TDescriptor> extends infer TOwners
        ? [Extract<TOwners, InternalDocumentContentOwner<unknown>>] extends [never]
          ? LiveMapDocumentContent
          : InternalDocumentInsertOwnerDomain<TOwners>
        : LiveMapDocumentContent;

type InternalDocumentAttrsEvidenceBranch<TDescriptor> =
  TDescriptor extends InternalDocumentUnschematized | InternalDocumentBroadSubtree
    ? "broad"
    : TDescriptor extends InternalDocumentRootDescriptor<infer TEvidence>
      ? InternalDocumentAttrsEvidenceBranch<TEvidence>
      : TDescriptor extends Readonly<{
          kind: "element";
          attrs: infer TAttrs;
        }>
        ? TAttrs
        : TDescriptor extends Readonly<{
            kind: "pick";
            choices: infer TChoices extends readonly unknown[];
          }>
          ? InternalDocumentAttrsEvidenceBranches<TChoices[number]>
          : "broad";

type InternalDocumentAttrsEvidenceBranches<TDescriptor> =
  TDescriptor extends unknown ? InternalDocumentAttrsEvidenceBranch<TDescriptor> : never;

type InternalDocumentLocationAttrsEvidence<TDescriptor> =
  unknown extends TDescriptor ? "broad" : InternalDocumentAttrsEvidenceBranches<TDescriptor>;

type InternalAttrsDeclaredKeys<TAttrs> =
  TAttrs extends DocumentAttrsEvidence<infer TShape, boolean> ? keyof TShape & string : never;

type InternalAttrsHasOpenBranch<TAttrs> =
  TAttrs extends unknown
    ? TAttrs extends "broad"
      ? true
      : TAttrs extends DocumentAttrsEvidence<unknown, infer TExact>
        ? TExact extends false ? true : false
        : true
    : never;

type InternalAttrsName<TAttrs> =
  true extends InternalAttrsHasOpenBranch<TAttrs>
    ? string
    : InternalAttrsDeclaredKeys<TAttrs>;

type InternalAttrRuleAt<TAttrs, TName extends string> =
  TAttrs extends DocumentAttrsEvidence<infer TShape, infer TExact>
    ? TName extends keyof TShape
      ? TShape[TName]
      : TExact extends false
        ? DocumentAttrValueEvidence<LiveMapDocumentAttributeValue, true, false>
        : DocumentAttrValueEvidence<never, true, false>
    : TAttrs extends "broad"
      ? DocumentAttrValueEvidence<LiveMapDocumentAttributeValue, true, false>
      : never;

type InternalAttrReadBranch<TRule> =
  TRule extends DocumentAttrValueEvidence<infer TValue, infer TOptional, boolean>
    ? TValue | (TOptional extends true ? undefined : never)
    : undefined;

type InternalAttrRead<TAttrs, TName extends string> =
  TAttrs extends unknown ? InternalAttrReadBranch<InternalAttrRuleAt<TAttrs, TName>> : never;

type InternalAttrWriteValue<TAttrs, TName extends string> =
  TAttrs extends unknown
    ? InternalAttrRuleAt<TAttrs, TName> extends DocumentAttrValueEvidence<infer TValue, boolean, boolean>
      ? TValue
      : never
    : never;

type InternalAttrsRequiredKeys<TShape> = {
  [TKey in keyof TShape]: TShape[TKey] extends DocumentAttrValueEvidence<unknown, false, boolean> ? TKey : never;
}[keyof TShape];

type InternalAttrsOptionalKeys<TShape> = Exclude<keyof TShape, InternalAttrsRequiredKeys<TShape>>;

type InternalAttrsCompleteShape<TShape> = Readonly<
  { [TKey in InternalAttrsRequiredKeys<TShape>]:
      TShape[TKey] extends DocumentAttrValueEvidence<infer TValue, boolean, boolean> ? TValue : never }
  & { [TKey in InternalAttrsOptionalKeys<TShape>]?:
      TShape[TKey] extends DocumentAttrValueEvidence<infer TValue, boolean, boolean> ? TValue : never }
>;

type InternalAttrsPatchShape<TShape> = Readonly<{
  [TKey in keyof TShape]?: TShape[TKey] extends DocumentAttrValueEvidence<infer TValue, boolean, boolean>
    ? TValue
    : never;
}>;

type InternalAttrsSetManyInput<TAttrs> =
  TAttrs extends "broad"
    ? LiveMapDocumentAttrs
    : TAttrs extends DocumentAttrsEvidence<infer TShape, infer TExact>
      ? TExact extends true
        ? InternalAttrsPatchShape<TShape>
        : InternalAttrsPatchShape<TShape> & Readonly<Record<string, LiveMapDocumentAttributeValue>>
      : LiveMapDocumentAttrs;

type InternalAttrsReplaceInput<TAttrs> =
  TAttrs extends "broad"
    ? LiveMapDocumentAttrs
    : TAttrs extends DocumentAttrsEvidence<infer TShape, infer TExact>
      ? TExact extends true
        ? InternalAttrsCompleteShape<TShape>
        : InternalAttrsCompleteShape<TShape> & Readonly<Record<string, LiveMapDocumentAttributeValue>>
      : LiveMapDocumentAttrs;

type InternalAttrsKeys<TAttrs> =
  true extends InternalAttrsHasOpenBranch<TAttrs>
    ? string
    : InternalAttrsDeclaredKeys<TAttrs>;

type InternalFlagNameBranch<TAttrs> =
  TAttrs extends "broad"
    ? string
    : TAttrs extends DocumentAttrsEvidence<infer TShape, infer TExact>
      ? {
          [TKey in keyof TShape & string]: TShape[TKey] extends DocumentAttrValueEvidence<infer TValue, boolean, boolean>
            ? TKey extends TValue ? TKey : never
            : never;
        }[keyof TShape & string] | (TExact extends false ? string : never)
      : string;

type InternalFlagName<TAttrs> = TAttrs extends unknown ? InternalFlagNameBranch<TAttrs> : never;

type InternalFlagNameAllowedBranch<TAttrs, TName extends string> =
  TAttrs extends "broad"
    ? TName
    : TAttrs extends DocumentAttrsEvidence<infer TShape, infer TExact>
      ? TName extends keyof TShape
        ? TShape[TName] extends DocumentAttrValueEvidence<infer TValue, boolean, boolean>
          ? TName extends TValue ? TName : never
          : never
        : TExact extends false ? TName : never
      : TName;

type InternalFlagNameAllowed<TAttrs, TName extends string> =
  TAttrs extends unknown ? InternalFlagNameAllowedBranch<TAttrs, TName> : never;

type InternalLocationAttrsApi<TDescriptor> =
  InternalDocumentLocationAttrsEvidence<TDescriptor> extends infer TAttrs
    ? Readonly<{
        get: <const TName extends InternalAttrsName<TAttrs>>(name: TName) => InternalAttrRead<TAttrs, TName>;
        has: <const TName extends InternalAttrsName<TAttrs>>(name: TName) => boolean;
        keys: () => readonly InternalAttrsKeys<TAttrs>[];
        must: Readonly<{
          get: <const TName extends InternalAttrsName<TAttrs>>(name: TName) => Exclude<InternalAttrRead<TAttrs, TName>, undefined>;
        }>;
        set: <const TName extends InternalAttrsName<TAttrs>>(
          name: TName,
          value: NoInfer<InternalAttrWriteValue<TAttrs, TName>>,
        ) => LiveMapGraphCommit<LiveMapGraphSetAttrOp>;
        drop: <const TName extends InternalAttrsName<TAttrs>>(name: TName) => LiveMapGraphCommit<LiveMapGraphRemoveAttrOp>;
        setMany: (values: InternalAttrsSetManyInput<TAttrs>) => LiveMapGraphCommit<LiveMapGraphReplaceAttrsOp>;
        dropMany: (names: readonly InternalAttrsName<TAttrs>[]) => LiveMapGraphCommit<LiveMapGraphReplaceAttrsOp>;
        clear: () => LiveMapGraphCommit<LiveMapGraphReplaceAttrsOp>;
        replace: (values: InternalAttrsReplaceInput<TAttrs>) => LiveMapGraphCommit<LiveMapGraphReplaceAttrsOp>;
      }>
    : never;

type InternalLocationFlagsApi<TDescriptor> =
  InternalDocumentLocationAttrsEvidence<TDescriptor> extends infer TAttrs
    ? Readonly<{
        has: <const TName extends string>(name: TName & InternalFlagNameAllowed<TAttrs, TName>) => boolean;
        set: <const TNames extends string[]>(...names: TNames & {
          [TIndex in keyof TNames]: TNames[TIndex] extends string
            ? InternalFlagNameAllowed<TAttrs, TNames[TIndex]>
            : never;
        }) => LiveMapGraphCommit<LiveMapGraphReplaceAttrsOp>;
        clear: <const TNames extends string[]>(...names: TNames & {
          [TIndex in keyof TNames]: TNames[TIndex] extends string
            ? InternalFlagNameAllowed<TAttrs, TNames[TIndex]>
            : never;
        }) => LiveMapGraphCommit<LiveMapGraphReplaceAttrsOp>;
      }>
    : never;

type DocumentLiveMapShared<
  TMode extends DocumentLiveMapMode,
  TEvidence = unknown,
> = Readonly<{
  readonly mode: TMode;
  readonly rev: number;
  root: () => HsonNode;
  /** Create a passive location at one logical ordered-content coordinate. */
  at<const TPath extends readonly number[]>(
    path: TPath & ([InternalDocumentLogicalPathEndpoint<TEvidence, TPath>] extends [never]
      ? never
      : unknown),
  ): LiveMapDocumentLocation<
    InternalDocumentLogicalPathEndpoint<TEvidence, TPath>,
    InternalDocumentLogicalPathDescriptor<TEvidence, TPath>
  >;
  /** Create a passive numeric proxy over logical ordered document content. */
  proxy: <const TPath extends readonly number[] = []>(
    path?: TPath & ([InternalDocumentLogicalPathEndpoint<TEvidence, TPath>] extends [never]
      ? never
      : unknown),
  ) => LiveMapDocumentProxy<
    InternalDocumentLogicalPathDescriptor<TEvidence, TPath>
  >;
  capture: DocumentLiveMapCaptureApi<TMode>;
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
  /** Permanent owner-level document schema attachment. */
  schema: DocumentLiveMapSchemaApi<TMode>;
}>;

/** Structural return type for document `at(...)`; intentionally not exported. */
type LiveMapDocumentLocation<
  TValue = InternalDocumentLegacyEndpoint,
  TDescriptor = unknown,
> = Readonly<{
  /** Current revision of the owning document map. */
  readonly rev: number;
  /** Return a detached copy of this logical authoring coordinate. */
  path: () => readonly number[];
  /** Read the detached current occupant, or `undefined` when absent. */
  snap: () => TValue;
  /** Observe future canonical value changes and explicit snapshot replacement. */
  watch: (
    listener: (next: TValue) => void,
  ) => LiveMapDisposer;
  /** Create a child location relative to this logical coordinate. */
  at<const TPath extends readonly number[]>(
    path: TPath & ([InternalDocumentDescriptorEndpoint<
      InternalDocumentResolveDescriptorPath<TDescriptor, TPath>
    >] extends [never]
      ? never
      : unknown),
  ): LiveMapDocumentLocation<
    InternalDocumentDescriptorEndpoint<
      InternalDocumentResolveDescriptorPath<TDescriptor, TPath>
    >,
    InternalDocumentResolveDescriptorPath<TDescriptor, TPath>
  >;
  /** Discover the first exact canonical ID match in this logical subtree. */
  id: (value: string) => LiveMapDocumentLocation | undefined;
  /** Replace the current logical content item through canonical document mutation. */
  replace(
    value: InternalDocumentWritableItem<TDescriptor>,
  ): LiveMapGraphCommit<LiveMapGraphReplaceContentOp>;
  /** Remove the current logical content item through canonical document mutation. */
  delete: () => LiveMapGraphCommit<LiveMapGraphRemoveContentOp>;
  /** Insert authored content into the ordered content owned by this location. */
  insert(
    index: number,
    value: InternalDocumentInsertItem<TDescriptor>,
  ): LiveMapGraphCommit<LiveMapGraphInsertContentOp>;
  /** Move one owned content item to its final index. */
  move: (from: number, to: number) => LiveMapGraphCommit<LiveMapGraphMoveContentOp>;
  /** Ordinary-attribute operations for the element currently at this location. */
  attrs: InternalLocationAttrsApi<TDescriptor>;
  /** Semantic same-name flag operations for this element location. */
  flags: InternalLocationFlagsApi<TDescriptor>;
}>;

type InternalDocumentTupleNumericKey<TKey> =
  TKey extends `${infer TIndex extends number}` ? TIndex : never;

type InternalDocumentCountedStaticKeys<
  TCount extends number,
  TCursor extends readonly unknown[] = readonly [],
  TKeys extends number = never,
> = number extends TCount
  ? never
  : TCursor["length"] extends TCount
    ? TKeys
    : InternalDocumentCountedStaticKeys<
      TCount,
      readonly [...TCursor, unknown],
      TKeys | TCursor["length"]
    >;

type InternalDocumentCountedStaticKeyBranches<TCount extends number> =
  TCount extends unknown ? InternalDocumentCountedStaticKeys<TCount> : never;

type InternalDocumentProxyContentStaticKeys<TContent> =
  TContent extends Readonly<{
    kind: "sequence";
    items: infer TItems extends readonly unknown[];
  }>
    ? InternalDocumentTupleNumericKey<keyof TItems>
    : TContent extends Readonly<{
      kind: "counted-repeat";
      count: infer TCount extends number;
    }>
      ? InternalDocumentCountedStaticKeyBranches<TCount>
    : TContent extends Readonly<{
      kind: "pick";
      choices: infer TChoices extends readonly unknown[];
    }>
      ? InternalDocumentProxyContentStaticKeys<TChoices[number]>
      : never;

type InternalDocumentProxyRootStaticKeys<TEvidence> =
  TEvidence extends Readonly<{
    kind: "element" | "fragment";
    content: infer TContent;
  }>
    ? InternalDocumentProxyContentStaticKeys<TContent>
    : never;

type InternalDocumentProxyStaticKeys<TDescriptor> =
  TDescriptor extends InternalDocumentRootDescriptor<infer TEvidence>
    ? InternalDocumentProxyRootStaticKeys<TEvidence>
    : TDescriptor extends Readonly<{
      kind: "element";
      content: infer TContent;
    }>
      ? TContent extends "broad"
        ? never
        : InternalDocumentProxyContentStaticKeys<TContent>
      : TDescriptor extends Readonly<{
        kind: "pick";
        choices: infer TChoices extends readonly unknown[];
      }>
        ? InternalDocumentProxyStaticKeys<TChoices[number]>
        : never;

type InternalDocumentProxyExactChildren<TDescriptor> = Readonly<{
  [TIndex in InternalDocumentProxyStaticKeys<TDescriptor>]:
    LiveMapDocumentProxy<
      InternalDocumentResolveDescriptorPath<TDescriptor, readonly [TIndex]>
    >;
}>;

type InternalDocumentProxyDynamicChildren<TDescriptor> =
  [InternalDocumentDescriptorEndpoint<
    InternalDocumentResolveDescriptorPath<TDescriptor, readonly [number]>
  >] extends [never]
    ? Readonly<Record<never, never>>
    : Readonly<{
      readonly [index: number]: LiveMapDocumentProxy<
        InternalDocumentResolveDescriptorPath<TDescriptor, readonly [number]>
      >;
    }>;

/** Structural document proxy return type; intentionally not exported. */
type LiveMapDocumentProxy<
  TDescriptor = InternalDocumentUnschematized,
> = Readonly<{
  readonly $_: LiveMapDocumentLocation<
    InternalDocumentDescriptorEndpoint<TDescriptor>,
    TDescriptor
  >;
}> & InternalDocumentProxyExactChildren<TDescriptor>
  & InternalDocumentProxyDynamicChildren<TDescriptor>;

export type ElementLiveMap<TEvidence = unknown> = DocumentLiveMapShared<"element", TEvidence> & Readonly<{
  readonly document: LiveMapDocumentApi;
  /** Return a detached clone of the single top-level ordinary element. */
  element: Readonly<{ node: () => HsonNode }>;
}>;

export type FragmentLiveMap<TEvidence = unknown> = DocumentLiveMapShared<"fragment", TEvidence> & Readonly<{
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

/** Identity-preserving movement of one own object entry to a new key. */
export type LiveMapRenameOp = Readonly<{
  kind: "rename";
  path: LivePath;
  from: string;
  to: string;
  prev: JsonValue;
  next: JsonValue;
}>;

/** Identity-preserving movement of one array item to its final index. */
export type LiveMapMoveOp = Readonly<{
  kind: "move";
  path: LivePath;
  from: number;
  to: number;
  prev: JsonValue;
  next: JsonValue;
}>;

/** Normalized operation emitted by a LiveMap mutation. */
export type LiveMapDataOp =
  | LiveMapSetOp
  | LiveMapDeleteOp
  | LiveMapReplaceOp
  | LiveMapSpliceOp
  | LiveMapRenameOp
  | LiveMapMoveOp;

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
  target: LiveMapDocumentCommitTarget;
  name: string;
  value: LiveMapDocumentAttributeValue;
}>;

export type LiveMapGraphRemoveAttrOp = Readonly<{
  domain: "graph";
  op: "remove-attr";
  target: LiveMapDocumentCommitTarget;
  name: string;
}>;

/** Atomic final-state replacement of one element's complete ordinary attribute bag. */
export type LiveMapGraphReplaceAttrsOp = Readonly<{
  domain: "graph";
  op: "replace-attrs";
  target: LiveMapDocumentCommitTarget;
  attrs: LiveMapDocumentAttrs;
}>;

export type LiveMapGraphReplaceContentOp = Readonly<{
  domain: "graph";
  op: "replace-content";
  target: LiveMapDocumentCommitTarget;
  index: number;
  replacement: LiveMapDocumentContent;
}>;

export type LiveMapGraphInsertContentOp = Readonly<{
  domain: "graph";
  op: "insert-content";
  target: LiveMapDocumentCommitTarget;
  index: number;
  content: LiveMapDocumentContent;
}>;

export type LiveMapGraphRemoveContentOp = Readonly<{
  domain: "graph";
  op: "remove-content";
  target: LiveMapDocumentCommitTarget;
  index: number;
}>;

export type LiveMapGraphMoveContentOp = Readonly<{
  domain: "graph";
  op: "move-content";
  target: LiveMapDocumentCommitTarget;
  from: number;
  to: number;
}>;

/** Internal-authority registration of one supplied system QUID at a canonical path. */
export type LiveMapGraphEnsureQuidOp<
  TTarget extends LiveMapDocumentCommitTarget | LiveMapProjectedIdentityCommitTarget = LiveMapDocumentCommitTarget,
> = Readonly<{
  domain: "graph";
  op: "ensure-quid";
  target: TTarget;
  quid: string;
}>;

export type LiveMapProjectedGraphEnsureQuidOp = LiveMapGraphEnsureQuidOp<LiveMapProjectedIdentityCommitTarget>;

/** Canonical graph-domain operations; distinct from projected JSON writes. */
export type LiveMapGraphOp =
  | LiveMapGraphReplaceRootOp
  | LiveMapGraphSetAttrOp
  | LiveMapGraphRemoveAttrOp
  | LiveMapGraphReplaceAttrsOp
  | LiveMapGraphReplaceContentOp
  | LiveMapGraphInsertContentOp
  | LiveMapGraphRemoveContentOp
  | LiveMapGraphMoveContentOp
  | LiveMapGraphEnsureQuidOp;

/** Select a LiveMap operation domain; bare use preserves the existing data domain. */
export type LiveMapOp<TDomain extends "data" | "graph" = "data"> =
  TDomain extends "graph" ? LiveMapGraphOp : LiveMapDataOp;

/** Full shared operation family used by the generic commit envelope. */
export type LiveMapAnyOp = LiveMapOp<"data" | "graph"> | LiveMapProjectedGraphEnsureQuidOp;

/**
 * Normalized mutation record returned by Core.
 *
 * A commit can contain zero, one, or many ops. Empty commits represent unchanged
 * writes/deletes. Multi-op commits are used by `setMany(...)`, object-valued
 * `set(...)`, and explicit `batch(...)` calls. Data-mode runtime commits also
 * carry the structural-JSON envelope used by exact replay. The fields remain
 * optional on this shared type because document graph commits do not use it.
 */
export type LiveMapStructuralJsonEnvelope = Readonly<{
  format: "structural-json";
  payload: string;
}>;

type LiveMapCommitFields<TOp extends LiveMapAnyOp> = Readonly<{
  changed: boolean;
  rev: number;
  prevRev: number;
  ops: readonly TOp[];
}>;

export type LiveMapCommit<TOp extends LiveMapAnyOp = LiveMapDataOp> = LiveMapCommitFields<TOp> & ([TOp] extends [LiveMapDataOp]
  ? LiveMapStructuralJsonEnvelope
  : Partial<LiveMapStructuralJsonEnvelope>);

/** Existing commit envelope specialized to graph-domain operations. */
export type LiveMapGraphCommit<TOp extends LiveMapGraphOp | LiveMapProjectedGraphEnsureQuidOp = LiveMapGraphOp> =
  LiveMapCommitFields<TOp> & Partial<LiveMapStructuralJsonEnvelope>;

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
  commit: LiveMapCommit<LiveMapDataOp>;
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
  /** Current revision of the owning LiveMap. */
  readonly rev: number;
  path: () => LivePath;
  snap: () => TValue;
  /** Create a child handle relative to this handle's projected path. */
  at: <const TPath extends LivePath>(
    path: TPath & ([LiveMapPathValue<TValue, TPath>] extends [never] ? never : unknown),
  ) => LiveMapPathHandle<LiveMapPathValue<TValue, TPath>>;
  /** Set this resolved handle path; plain objects expand into shallow child sets. */
  set: (value: LiveMapSetValue<TValue>) => LiveMapCommit<LiveMapDataOp>;
  /** Exact replacement at this handle path using replace-shaped commit ops. */
  replace: (value: LiveMapWriteValue<TValue>) => LiveMapCommit<LiveMapDataOp>;
  /** Shallow object set below this handle path, preserving unspecified siblings. */
  setMany: (values: NoInfer<LiveMapObjectSetManyValues<TValue>>) => LiveMapCommit<LiveMapDataOp>;
  /** Delete this handle path. */
  delete: () => LiveMapCommit<LiveMapDataOp>;
  update: (updater: (value: TValue) => LiveMapSetValue<TValue>) => LiveMapCommit<LiveMapDataOp>;
  array: LiveMapPathArrayApi<TValue>;
  object: LiveMapPathObjectApi<TValue>;
  feed: (listener: LiveMapFeedListener) => LiveMapDisposer;
  /** Observe future canonical value changes and explicit snapshot replacement. */
  watch: (listener: (next: TValue) => void) => LiveMapDisposer;
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
  setKey: <const TKey extends LiveMapObjectKey<TValue>>(key: TKey, value: NoInfer<LiveMapObjectSetValue<TValue, TKey>>) => LiveMapCommit<LiveMapDataOp>;
  /** Shallow child-key writes under this object path, preserving unspecified siblings. */
  setMany: (values: NoInfer<LiveMapObjectSetManyValues<TValue>>) => LiveMapCommit<LiveMapDataOp>,
  clear: () => LiveMapCommit<LiveMapDataOp>;
  deleteKey: (key: string) => LiveMapCommit<LiveMapDataOp>;
  deleteMany: (keys: readonly string[]) => LiveMapCommit<LiveMapDataOp>;
  renameKey: (fromKey: string, toKey: string) => LiveMapCommit<LiveMapDataOp>;
}>;
/**
 * Array-scoped helper API.
 *
 * Helpers require the array path itself to resolve. Array move retains semantic
 * movement intent; other whole-array transformations may use endpoint writes.
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
  push: (value: NoInfer<LiveMapArrayWriteItem<TValue>>) => LiveMapCommit<LiveMapDataOp>;
  pushMany: (values: readonly NoInfer<LiveMapArrayWriteItem<TValue>>[]) => LiveMapCommit<LiveMapDataOp>;
  unshift: (value: NoInfer<LiveMapArrayWriteItem<TValue>>) => LiveMapCommit<LiveMapDataOp>;
  unshiftMany: (values: readonly NoInfer<LiveMapArrayWriteItem<TValue>>[]) => LiveMapCommit<LiveMapDataOp>;
  pop: () => LiveMapCommit<LiveMapDataOp>;
  shift: () => LiveMapCommit<LiveMapDataOp>;
  clear: () => LiveMapCommit<LiveMapDataOp>;
  reverse: () => LiveMapCommit<LiveMapDataOp>;
  sortNumbers: (direction?: LiveMapSortDirection) => LiveMapCommit<LiveMapDataOp>;
  sortStrings: (direction?: LiveMapSortDirection) => LiveMapCommit<LiveMapDataOp>;
  splice: (...args: [start: number] | [start: number, deleteCount: number, ...items: NoInfer<LiveMapArrayWriteItem<TValue>>[]]) => LiveMapCommit<LiveMapDataOp>;
  insert: (index: number, value: NoInfer<LiveMapArrayWriteItem<TValue>>) => LiveMapCommit<LiveMapDataOp>;
  remove: (index: number) => LiveMapCommit<LiveMapDataOp>;
  replace: (index: number, value: NoInfer<LiveMapArrayWriteItem<TValue>>) => LiveMapCommit<LiveMapDataOp>;
  move: (fromIndex: number, toIndex: number) => LiveMapCommit<LiveMapDataOp>;
  unique: () => LiveMapCommit<LiveMapDataOp>;
  removeValue: (value: JsonValue) => LiveMapCommit<LiveMapDataOp>;
  removeAll: (value: JsonValue) => LiveMapCommit<LiveMapDataOp>;
}>;

export type LiveMapSchemaIssueCode =
  | "TYPE_MISMATCH"
  | "MISSING_REQUIRED"
  | "UNKNOWN_PATH"
  | "UNKNOWN_KEY"
  | "INVALID_LITERAL"
  | "INVALID_CONSTRAINT"
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

/** Canonical projected-state capture with detached exact graph metadata. */
export type LiveMapCapture = Readonly<{
  rev: number;
  root: HsonNode;
}> & LiveMapStructuralJsonEnvelope;

export type LiveMapApply = Readonly<{
  prevRev: number;
}> & LiveMapStructuralJsonEnvelope;

export type LiveMapReplay = Readonly<{
  prevRev: number;
}> & LiveMapStructuralJsonEnvelope;
