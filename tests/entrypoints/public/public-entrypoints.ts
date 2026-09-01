import {
  Hson,
  hson,
  hsonTransform,
  hsonLiveMap,
  hsonLiveTree,
  hsonInspect,
  hsonCalc,
  type HsonSchema,
  type HsonNumber,
} from "hson-live";
import {
  TransformError,
  hsonTransform as transformSubpath,
  is_transform_error,
  read_transform_error_details,
  type HsonCanonical,
  type HsonNumber as TransformHsonNumber,
  type BinaryDecodeOptions,
  type TransformErrorDetails,
  type TransformErrorRelated,
  type TransformErrorSource,
  type TransformOutputRenderFormat,
  type TransformRender,
  type TransformSerialize,
  type TransformBinarySerialize,
} from "hson-live/transform";
import {
  TransformError as HsonSubpathTransformError,
  Hson as HsonSubpath,
  type HsonCanonical as AuthoringCanonical,
} from "hson-live/hson";
import type { HsonNode, HsonSemanticPrimitive, JsonValue, Primitive } from "hson-live/types";
// D1 tooling is private, including its capability-origin and lifecycle helpers.
// @ts-expect-error Standalone helper is not a public export.
import { validate } from "hson-live";
// @ts-expect-error Shared graph authority stays private.
import { validate_schema_hson_graph } from "hson-live/livemap";
// @ts-expect-error Direct-source associations are private tooling.
import type { TrustedSchemaDirectSource } from "hson-live/types";
declare const standaloneSchema: HsonSchema;
const standaloneCanonical: HsonCanonical = Hson.certify(standaloneSchema, Hson`37`);
// @ts-expect-error Hson.validate was hard-removed in favor of Hson.certify.
Hson.validate(standaloneSchema, Hson`37`);
// @ts-expect-error The narrow authoring subpath also exposes certify, not validate.
const narrowStandaloneCanonical: HsonCanonical = HsonSubpath.validate(standaloneSchema, standaloneCanonical);
// @ts-expect-error Arbitrary strings are not branded HsonCanonical.
hson.liveMap.schema.validate(standaloneSchema, "37");
// @ts-expect-error No aliases are approved.
hson.liveMap.schema.check(standaloneSchema, standaloneCanonical);
void narrowStandaloneCanonical;
// @ts-expect-error The D1 wire protocol is not a public value.
import { TRUSTED_SCHEMA_DIAGNOSTICS_PROTOCOL_VERSION } from "hson-live";
// @ts-expect-error The runtime host is not a public API.
import { TrustedSchemaDiagnosticRuntime } from "hson-live/hson";
// @ts-expect-error Process supervision is not a library facade.
import { TrustedSchemaNodeSupervisor } from "hson-live/diagnostics";
// @ts-expect-error The development registry remains private.
import { register_trusted_schema_for_development } from "hson-live/livemap";
// @ts-expect-error Capability ownership checks are not public Schema APIs.
import { is_owned_projected_schema } from "hson-live/livemap";
// @ts-expect-error Authored lifecycle capture is not a public tag.
import { capture_trusted_schema_template } from "hson-live/transform";
// @ts-expect-error Protocol requests are not public types.
import type { TrustedSchemaRequest } from "hson-live/types";
// @ts-expect-error Association handles/evidence are private.
import type { TrustedSchemaAssociationEvidence } from "hson-live/types";
// @ts-expect-error Diagnostic sidecars are private.
import type { TrustedSchemaDiagnostic } from "hson-live/types";
// @ts-expect-error Schema registrations and their origin evidence are private.
import type { TrustedSchemaDevRegistration } from "hson-live/types";
// @ts-expect-error Direct map/application captures are private.
import type { TrustedSchemaApplication } from "hson-live/types";
// @ts-expect-error No D1 package subpath exists.
import type { TrustedSchemaResponse } from "hson-live/internal/trusted-schema-diagnostics/protocol";
// @ts-expect-error Canonical-node debug handles are no longer public types.
type RemovedLiveMapDebugApi = import("hson-live/types").LiveMapDebugApi;
// @ts-expect-error Canonical-node handles are no longer public types.
type RemovedLiveMapNodeHandle = import("hson-live/livemap").LiveMapNodeHandle;
// @ts-expect-error The canonical-owner reader is an in-package implementation seam only.
type PrivateInternalLiveMapRoot = typeof import("hson-live/livemap").internal_livemap_root;
import {
  hsonCalc as narrowHsonCalc,
  type HsonNumber as NarrowHsonNumber,
} from "hson-live/number";
// @ts-expect-error Direct numeric admission was consolidated under hsonCalc.
import { hsonNumber as removedRootHsonNumber } from "hson-live";
// @ts-expect-error The numeric subpath exposes hsonCalc only.
import { hsonNumber as removedNarrowHsonNumber } from "hson-live/number";
// @ts-expect-error The private brand symbol is not a Transform export.
import type { HSON_CANONICAL_BRAND } from "hson-live/transform";
// @ts-expect-error The private number brand symbol is not exported.
import type { HSON_NUMBER_BRAND } from "hson-live/transform";
// @ts-expect-error HsonCanonical is intentionally not exported from the package root.
import type { HsonCanonical as RootHsonCanonical } from "hson-live";
import {
  ContentManager,
  LIVETREE_LINKED_IDENTITY_REQUIRED_ERROR_CODE,
  LIVETREE_QUID_REUSE_ERROR_CODE,
  LiveTreeLinkedIdentityRequiredError,
  LiveTreeQuidReuseError,
  TreeSelector,
  hsonLiveTree as treeSubpath,
  LiveTree,
  type AttrHandle,
  type CanvasApi,
  type ClassApi,
  type ContentMarkupApi,
  type DataApi,
  type FindMany,
  type FlagHandle,
  type GraftConstructor,
  type IdApi,
  type ListenerBuilder,
  type LiveTreeBindApi,
  type LiveTreeLifecycleResult,
  type PropertyManager,
  type PropertyRegistration,
  type TreeEvents,
} from "hson-live/livetree";
// @ts-expect-error The obsolete construction engine is not a public export.
import { construct_tree } from "hson-live/livetree";
import {
  LiveMapProjectedTransportError,
  LiveMapProjectedValueError,
  LiveMapReplayError,
  LiveMapReplayInputError,
  LiveMapRevError,
  hsonLiveMap as mapSubpath,
  make_livemap_core,
  type LiveMap,
  type LiveMapCommit,
  type LiveMapDocumentIdentityHandle,
  type DocumentLiveMap,
  type LiveMapPathHandle,
  type LivePath,
  type ProjectedValueAdmissionCode,
  type ProjectedValuePath,
} from "hson-live/livemap";
// @ts-expect-error Refinement vocabulary was hard-replaced by constraint vocabulary.
import type { LiveMapSchemaRefinement } from "hson-live/livemap";
// @ts-expect-error Named schema definition aliases were hard-removed.
import { define_livemap_schema } from "hson-live/livemap";
// @ts-expect-error Raw schema construction was hard-removed.
import { make_livemap_schema } from "hson-live/livemap";
// @ts-expect-error The persistent raw schema toolkit was hard-removed.
import { LIVEMAP_SCHEMA } from "hson-live/livemap";
// @ts-expect-error Raw callback toolkit types are internal implementation details.
import type { LiveMapSchemaBuilder as RemovedLiveMapSchemaBuilder } from "hson-live/livemap";
// @ts-expect-error Raw schema-expression input types are not a public authoring boundary.
import type { LiveMapSchemaInput as RemovedLiveMapSchemaInput } from "hson-live/livemap";
// @ts-expect-error Token-specific inference was replaced by general defined-schema inference.
import type { InferLiveMapSchemaToken as RemovedInferLiveMapSchemaToken } from "hson-live/livemap";
// @ts-expect-error The types subpath also hides raw schema toolkit types.
import type { LiveMapSchemaBuilder as RemovedTypesSchemaBuilder } from "hson-live/types";
// @ts-expect-error The types subpath also hides raw schema input types.
import type { LiveMapSchemaInput as RemovedTypesSchemaInput } from "hson-live/types";
// @ts-expect-error The types subpath exposes only general defined-schema inference.
import type { InferLiveMapSchemaToken as RemovedTypesSchemaTokenInference } from "hson-live/types";
// @ts-expect-error BindingSource is intentionally not a public export.
import type { BindingSource } from "hson-live/livetree";
// @ts-expect-error DocumentBindingSource is intentionally not a public export.
import type { DocumentBindingSource } from "hson-live/livetree";
import {
  LocusAuthorityError,
  hsonLocus as hostSubpath,
  type Locus,
  type LocusClientId,
  type LocusClientMessage,
  type LocusAuthorityErrorCode,
  type LocusReadonlyMap,
  type LocusMultiLibrary,
  type LocusMultiLibraryActionContext,
  type LocusSyncManager,
  type LocusSyncSend,
  type LocusSyncSession,
} from "hson-live/locus";
void (0 as unknown as LocusClientId);
void (0 as unknown as LocusClientMessage);
declare const multiLocus: LocusMultiLibrary;
declare const multiActionContext: LocusMultiLibraryActionContext;
void multiLocus.dispatchAction;
void multiActionContext.emitEvent("event", null);
// @ts-expect-error Removed snake_case multi-library method has no alias.
void multiLocus.dispatch_action;
// @ts-expect-error Removed snake_case multi-library context method has no alias.
void multiActionContext.emit_event;
// @ts-expect-error Echo construction belongs to hson-live/echo.
import { create_echo as leakedCreateEcho } from "hson-live/locus";
// @ts-expect-error Architectural endpoint types do not leak through Locus.
import type { Echo as LeakedEcho } from "hson-live/locus";
// @ts-expect-error Endpoint action handles do not leak through Locus.
import type { EchoActionPromise as LeakedEchoActionPromise } from "hson-live/locus";
void leakedCreateEcho;
void (0 as unknown as LeakedEcho);
void (0 as unknown as LeakedEchoActionPromise);
// @ts-expect-error The historical one-map constructor is removed from the root.
import { create_livehost } from "hson-live";
// @ts-expect-error The historical one-map facade is removed from the root.
import { hsonLiveHost } from "hson-live";
// @ts-expect-error The Locus surface exposes no historical LiveHost type aliases.
import type { LiveHost as RemovedLocusLiveHost } from "hson-live/locus";
import type {
  LiveHost,
  LiveHostApplication,
  LiveHostApplicationContext,
  LiveHostConnection,
  LiveHostConnectionRoute,
  LiveHostLocusAcquisition,
  LiveHostLocusEvictionResult,
  LiveHostLocusRegistry,
  LiveHostLocusRegistryOptions,
  LiveHostLocusRegistryResult,
  LiveHostPrincipal,
  LiveHostRequestRoute,
} from "hson-live/livehost";
import {
  hsonReflect as reflectSubpath,
  type CollectionReflect,
  type DocumentReflect,
  type Reflect as ReflectFacade,
} from "hson-live/reflect";
// @ts-expect-error LiveMap path-handle pseudo-QUID helpers were removed.
import { get_livemap_quid } from "hson-live";
// @ts-expect-error LiveMap path-handle pseudo-QUID helpers were removed.
import { ensure_livemap_quid } from "hson-live/livemap";
// @ts-expect-error Document schema values are inferred; no named annotation type is exported.
import type { LiveMapDocumentSchema } from "hson-live/livemap";
// @ts-expect-error Document logical path resolution remains an internal declaration detail.
import type { LiveMapDocumentPathValue } from "hson-live/livemap";
// @ts-expect-error Document locations remain structural return types, not named exports.
import type { DocumentLocation } from "hson-live/livemap";
// @ts-expect-error Document evidence remains internal to schema-bound map declarations.
import type { DocumentEvidence } from "hson-live/livemap";

void hson;
void transformSubpath;
void mapSubpath;
void treeSubpath;
void hostSubpath;
void reflectSubpath;
void LiveTree;
void TreeSelector;
void ContentManager;
void TransformError;
void HsonSubpathTransformError;
void is_transform_error;
void read_transform_error_details;
void LiveTreeQuidReuseError;
void LiveTreeLinkedIdentityRequiredError;
void LIVETREE_QUID_REUSE_ERROR_CODE;
void LIVETREE_LINKED_IDENTITY_REQUIRED_ERROR_CODE;
void LiveMapProjectedTransportError;
void LiveMapProjectedValueError;
void LiveMapReplayError;
void LiveMapReplayInputError;
void LiveMapRevError;
void LocusAuthorityError;
void create_livehost;
void hsonLiveHost;
void (0 as unknown as RemovedLocusLiveHost);
void (0 as unknown as LiveHost);
void (0 as unknown as LiveHostApplication);
void (0 as unknown as LiveHostApplicationContext);
void (0 as unknown as LiveHostConnection);
void (0 as unknown as LiveHostConnectionRoute);
void (0 as unknown as LiveHostLocusAcquisition);
void (0 as unknown as LiveHostLocusEvictionResult);
void (0 as unknown as LiveHostLocusRegistry);
void (0 as unknown as LiveHostLocusRegistryOptions);
void (0 as unknown as LiveHostLocusRegistryResult<unknown>);
void (0 as unknown as LiveHostPrincipal);
void (0 as unknown as LiveHostRequestRoute);

declare const managedLocus: Locus;
const publicRegistryOptions: LiveHostLocusRegistryOptions = {
  maxLoci: 2,
  idleMs: 100,
  create: () => managedLocus,
};
const manuallySweptRegistryOptions: LiveHostLocusRegistryOptions = {
  ...publicRegistryOptions,
  automaticSweep: false,
};
void manuallySweptRegistryOptions;
const privateClockRegistryOptions: LiveHostLocusRegistryOptions = {
  ...publicRegistryOptions,
  // @ts-expect-error Deterministic clocks are an internal runtime/testing seam.
  now: () => 0,
};
const bodylessRequestRoute: LiveHostRequestRoute = {
  method: "GET",
  path: "/",
  handle: () => new Response(),
  // @ts-expect-error Body suppression is a Node ingress rule, not an application route contract.
  bodyless: true,
};
const binaryConnection: LiveHostConnection = {
  send: (_data: string | Uint8Array) => {},
  close: () => {},
  onMessage: (_listener: (data: string | Uint8Array) => void) => () => {},
  onClose: () => () => {},
};
void publicRegistryOptions;
void privateClockRegistryOptions;
void bodylessRequestRoute;
void binaryConnection;
void make_livemap_core;
void get_livemap_quid;
void ensure_livemap_quid;
void construct_tree;
void (0 as unknown as LiveMapDocumentSchema);

// @ts-expect-error LiveMap exposes governance through each map, not a second authoring facade.
hson.liveMap.schema;
declare const publicElementSchema: HsonSchema;
const publicElementCandidate = hson.liveMap.fromHson(`<button "Save"/>`);
if (publicElementCandidate.mode === "document") {
  const schemaBound = publicElementCandidate.schema.use(publicElementSchema);
  const sameSchema = schemaBound.schema.get();
  const exactSchema: HsonSchema | undefined = sameSchema;
  // @ts-expect-error Schema detachment is not a governance operation.
  schemaBound.schema.use(undefined);
  // @ts-expect-error LiveMap governance accepts only HsonSchema.
  schemaBound.schema.use({});
  void exactSchema;
  void sameSchema;
}

const reflectFacade: ReflectFacade = reflectSubpath;
const umbrellaReflect: ReflectFacade = hson.reflect;
declare const documentReflect: DocumentReflect;
declare const collectionReflect: CollectionReflect;
void reflectFacade;
void umbrellaReflect;
void documentReflect;
void collectionReflect;

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;
type Expect<Value extends true> = Value;

type ProjectedPathTruth = Readonly<{
  required: Readonly<{ leaf: string }>;
  optional?: Readonly<{ name: string }>;
  nullable: Readonly<{ name: string }> | null;
  optionalNullable?: Readonly<{ name: string }> | null;
  tuple: readonly [string, number?];
  array: readonly Readonly<{ name?: string }>[];
  nestedTuple: readonly [Readonly<{ child?: Readonly<{ value: string }> }>, Readonly<{ leaf: number }>?];
  unionAll: Readonly<{ shared: number }> | Readonly<{ shared: string }>;
  unionSome: Readonly<{ only: boolean }> | Readonly<{ other: number }>;
  unionNone: Readonly<{ left: number }> | Readonly<{ right: string }>;
  dictionary: Readonly<Record<string, Readonly<{ value: number }>>>;
  primitive: number;
  literal: "ready";
  readonlyTuple: readonly [Readonly<{ code: "fixed" }>, 2];
  deep?: Readonly<{
    branch: Readonly<{
      rows: readonly [Readonly<{ value: "tuple" }>] | readonly Readonly<{ value: "array" }>[];
    }>;
  }>;
}>;

declare const projectedPathMap: LiveMap<ProjectedPathTruth>;
declare const bindingTree: LiveTree;

declare const mixedBindingMap: LiveMap<Readonly<{ count: number }>>;
declare const readonlyBindingMap: LocusReadonlyMap<LiveMap<ProjectedPathTruth>>;
declare const dynamicPath: LivePath;
declare const dynamicObjectKey: string;
declare const dynamicTupleIndex: number;
declare const dynamicArrayIndex: number;

const requiredObjectLeaf = projectedPathMap.at(["required", "leaf"]).snap();
const optionalObjectEndpoint = projectedPathMap.at(["optional"]).snap();
const optionalObjectLeaf = projectedPathMap.at(["optional", "name"]).snap();
const nullableObjectEndpoint = projectedPathMap.at(["nullable"]).snap();
const nullableObjectLeaf = projectedPathMap.at(["nullable", "name"]).snap();
const optionalNullableEndpoint = projectedPathMap.at(["optionalNullable"]).snap();
const optionalNullableLeaf = projectedPathMap.at(["optionalNullable", "name"]).snap();
const requiredTuplePosition = projectedPathMap.at(["tuple", 0]).snap();
const optionalTuplePosition = projectedPathMap.at(["tuple", 1]).snap();
const dynamicTuplePosition = projectedPathMap.at(["tuple", dynamicTupleIndex]).snap();
const literalArrayPosition = projectedPathMap.at(["array", 0]).snap();
const dynamicArrayPosition = projectedPathMap.at(["array", dynamicArrayIndex]).snap();
const nestedArrayOptionalLeaf = projectedPathMap.at(["array", 0, "name"]).snap();
const nestedTupleOptionalLeaf = projectedPathMap.at(["nestedTuple", 0, "child", "value"]).snap();
const optionalNestedTuplePosition = projectedPathMap.at(["nestedTuple", 1, "leaf"]).snap();
const allUnionBranches = projectedPathMap.at(["unionAll", "shared"]).snap();
const someUnionBranches = projectedPathMap.at(["unionSome", "only"]).snap();
const broadDynamicPath = projectedPathMap.at(dynamicPath).snap();
const indexedObjectLiteralKey = projectedPathMap.at(["dictionary", "entry"]).snap();
const broadDynamicObjectKey = projectedPathMap.at(["dictionary", dynamicObjectKey]).snap();
const preservedLiteral = projectedPathMap.at(["literal"]).snap();
const preservedReadonlyTuple = projectedPathMap.at(["readonlyTuple"]).snap();
const deepRepresentativePath = projectedPathMap.at(["deep", "branch", "rows", 0, "value"]).snap();
const relativeRequiredLeaf = projectedPathMap.at(["required"]).at(["leaf"]).snap();
projectedPathMap.at(["required", "leaf"]).watch((next) => {
  type ProjectedWatchValue = Expect<Equal<typeof next, string>>;
  return undefined;
});
projectedPathMap.proxy().required.leaf.$_.watch((next) => {
  type ProjectedProxyWatchValue = Expect<Equal<typeof next, string>>;
  return undefined;
});
projectedPathMap.sub.path(["required"], (next, prev) => {
  type RequiredPathSubscriberNext = Expect<Equal<typeof next, Readonly<{ leaf: string }>>>;
  type RequiredPathSubscriberPrev = Expect<Equal<typeof prev, Readonly<{ leaf: string }>>>;
  return undefined;
});
projectedPathMap.sub.path(["dictionary"], (next, prev) => {
  type IndexedPathSubscriberNext = Expect<Equal<
    typeof next,
    Readonly<Record<string, Readonly<{ value: number }>>>
  >>;
  type IndexedPathSubscriberPrev = Expect<Equal<
    typeof prev,
    Readonly<Record<string, Readonly<{ value: number }>>>
  >>;
  return undefined;
});

type RequiredObjectLeaf = Expect<Equal<typeof requiredObjectLeaf, string>>;
type OptionalObjectEndpoint = Expect<Equal<typeof optionalObjectEndpoint, Readonly<{ name: string }> | undefined>>;
type OptionalObjectLeaf = Expect<Equal<typeof optionalObjectLeaf, string | undefined>>;
type NullableObjectEndpoint = Expect<Equal<typeof nullableObjectEndpoint, Readonly<{ name: string }> | null>>;
type NullableObjectLeaf = Expect<Equal<typeof nullableObjectLeaf, string | undefined>>;
type OptionalNullableEndpoint = Expect<Equal<
  typeof optionalNullableEndpoint,
  Readonly<{ name: string }> | null | undefined
>>;
type OptionalNullableLeaf = Expect<Equal<typeof optionalNullableLeaf, string | undefined>>;
type RequiredTuplePosition = Expect<Equal<typeof requiredTuplePosition, string>>;
type OptionalTuplePosition = Expect<Equal<typeof optionalTuplePosition, number | undefined>>;
type DynamicTuplePosition = Expect<Equal<typeof dynamicTuplePosition, string | number | undefined>>;
type LiteralArrayPosition = Expect<Equal<
  typeof literalArrayPosition,
  Readonly<{ name?: string }> | undefined
>>;
type DynamicArrayPosition = Expect<Equal<
  typeof dynamicArrayPosition,
  Readonly<{ name?: string }> | undefined
>>;
type NestedArrayOptionalLeaf = Expect<Equal<typeof nestedArrayOptionalLeaf, string | undefined>>;
type NestedTupleOptionalLeaf = Expect<Equal<typeof nestedTupleOptionalLeaf, string | undefined>>;
type OptionalNestedTuplePosition = Expect<Equal<typeof optionalNestedTuplePosition, number | undefined>>;
type AllUnionBranches = Expect<Equal<typeof allUnionBranches, string | number>>;
type SomeUnionBranches = Expect<Equal<typeof someUnionBranches, boolean | undefined>>;
type BroadDynamicPath = Expect<Equal<typeof broadDynamicPath, JsonValue | undefined>>;
type IndexedObjectLiteralKey = Expect<Equal<
  typeof indexedObjectLiteralKey,
  Readonly<{ value: number }> | undefined
>>;
type BroadDynamicObjectKey = Expect<Equal<typeof broadDynamicObjectKey, JsonValue | undefined>>;
type PreservedLiteral = Expect<Equal<typeof preservedLiteral, "ready">>;
type PreservedReadonlyTuple = Expect<Equal<
  typeof preservedReadonlyTuple,
  readonly [Readonly<{ code: "fixed" }>, 2]
>>;
type DeepRepresentativePath = Expect<Equal<typeof deepRepresentativePath, "tuple" | "array" | undefined>>;
type RelativeRequiredLeaf = Expect<Equal<typeof relativeRequiredLeaf, string>>;

bindingTree.bind.path(projectedPathMap.at(["required", "leaf"]), (_tree, value, previous) => {
  type RequiredBindingValue = Expect<Equal<typeof value, string>>;
  type RequiredBindingPrevious = Expect<Equal<typeof previous, string | undefined>>;
  return undefined;
});
bindingTree.bind.text(projectedPathMap.at(["optional", "name"]), (value, previous) => {
  type OptionalBindingValue = Expect<Equal<typeof value, string | undefined>>;
  type OptionalBindingPrevious = Expect<Equal<typeof previous, string | undefined>>;
  return String(value ?? previous ?? "");
});
bindingTree.bind.attrs(projectedPathMap.at(["nullable"]), (value) => {
  type NullableBindingValue = Expect<Equal<typeof value, Readonly<{ name: string }> | null>>;
  return { "data-null": value === null };
});
bindingTree.bind.attr(projectedPathMap.at(["literal"]), "data-state", (value) => {
  type LiteralBindingValue = Expect<Equal<typeof value, "ready">>;
  return value;
});
bindingTree.bind.path(projectedPathMap.at(["array", 0]), (_tree, value) => {
  type ArrayBindingValue = Expect<Equal<typeof value, Readonly<{ name?: string }> | undefined>>;
  return undefined;
});
bindingTree.bind.path(projectedPathMap.at(["tuple", 1]), (_tree, value) => {
  type TupleBindingValue = Expect<Equal<typeof value, number | undefined>>;
  return undefined;
});
bindingTree.bind.path(projectedPathMap.at(["readonlyTuple"]), (_tree, value) => {
  type ReadonlyTupleBindingValue = Expect<Equal<
    typeof value,
    readonly [Readonly<{ code: "fixed" }>, 2]
  >>;
  return undefined;
});
bindingTree.bind.paths([
  projectedPathMap.at(["required", "leaf"]),
  projectedPathMap.at(["optional", "name"]),
  projectedPathMap.at(["nullable"]),
  mixedBindingMap.at(["count"]),
], (_tree, values, previous) => {
  type MultiBindingValues = Expect<Equal<
    typeof values,
    readonly [string, string | undefined, Readonly<{ name: string }> | null, number]
  >>;
  type MultiBindingPrevious = Expect<Equal<
    typeof previous,
    readonly [string, string | undefined, Readonly<{ name: string }> | null, number] | undefined
  >>;
  return undefined;
});
bindingTree.bind.text(readonlyBindingMap.at(["required", "leaf"]), (value) => {
  type ReadonlyBindingValue = Expect<Equal<typeof value, string>>;
  return value;
});
const readonlyBindingLocation = readonlyBindingMap.at(["required", "leaf"]);
readonlyBindingLocation.watch((next) => {
  type ReadonlyWatchValue = Expect<Equal<typeof next, string>>;
  return undefined;
});
// @ts-expect-error Forward binding does not add mutation to a readonly Host location.
readonlyBindingLocation.set("changed");
// @ts-expect-error LiveTree.bind hard-replaced the old map-plus-path source form.
bindingTree.bind.text(projectedPathMap, ["required", "leaf"]);
// @ts-expect-error Multi-source binding no longer accepts one map plus path arrays.
bindingTree.bind.paths(projectedPathMap, [["required", "leaf"]], () => undefined);

// @ts-expect-error Exact object keys outside every branch are statically impossible.
projectedPathMap.at(["required", "missing"]);
// @ts-expect-error Exact primitive endpoints cannot be traversed further.
projectedPathMap.at(["primitive", "missing"]);
// @ts-expect-error Position two is outside the known tuple shape.
projectedPathMap.at(["tuple", 2]);
// @ts-expect-error No union member contains the requested key.
projectedPathMap.at(["unionNone", "missing"]);
// @ts-expect-error A missing read branch does not admit undefined as canonical state.
projectedPathMap.at(["optional", "name"]).set(undefined);
// @ts-expect-error Exact replacement also excludes missing-read undefined.
projectedPathMap.at(["array", 0]).replace(undefined);
// @ts-expect-error Updaters cannot turn missing reachability into an undefined write.
projectedPathMap.at(["optional", "name"]).update(() => undefined);

type PublicTransformClosure =
  | TransformErrorDetails
  | TransformErrorRelated
  | TransformErrorSource
  | TransformOutputRenderFormat
  | TransformRender<"json">;
type PublicLiveTreeClosure =
  | AttrHandle<LiveTree>
  | CanvasApi<LiveTree>
  | ClassApi<LiveTree>
  | ContentMarkupApi
  | DataApi<LiveTree>
  | FindMany
  | FlagHandle<LiveTree>
  | GraftConstructor
  | IdApi<LiveTree>
  | ListenerBuilder
  | LiveTreeBindApi<LiveTree>
  | PropertyManager
  | PropertyRegistration
  | TreeEvents;
type PublicLiveMapClosure =
  | ProjectedValueAdmissionCode
  | ProjectedValuePath;
type PublicLocusClosure =
  | LocusAuthorityErrorCode
  | LocusSyncManager
  | LocusSyncSend
  | LocusSyncSession;
declare const publicDeclarationClosure:
  | PublicTransformClosure
  | PublicLiveTreeClosure
  | PublicLiveMapClosure
  | PublicLocusClosure;
void publicDeclarationClosure;

declare const governanceSchema: HsonSchema;
const schemaBoundMap = mapSubpath.fromJson({}).schema.use(governanceSchema);
// @ts-expect-error LiveMap exposes no public live canonical-node debug escape.
schemaBoundMap.debug.node([]);
// @ts-expect-error Schema detachment through undefined is not part of the owner contract.
schemaBoundMap.schema.use(undefined);
// @ts-expect-error Schema owner contracts expose no reset operation.
schemaBoundMap.schema.reset();
const attachedSchema: HsonSchema | undefined = schemaBoundMap.schema.get();
void attachedSchema;

declare const node: HsonNode;
declare const arbitrary: string;
declare const arbitraryNumber: number;
declare const genericSerializer: TransformSerialize;
declare const binaryDecodeOptions: BinaryDecodeOptions;

const inferredHsonText = transformSubpath.fromNode(node).toHson().serialize();
const inferredNormalizedHson = hson.transform.fromHson(arbitrary).toHson().serialize();
const inferredRootTaggedHson: HsonCanonical = Hson`<main/>`;
const inferredHsonSubpathTaggedHson: HsonCanonical = HsonSubpath`<main/>`;
const inferredTaggedNumber: HsonCanonical = Hson`${37}`;
const inferredTaggedString: HsonCanonical = Hson`${"37"}`;
const inferredTaggedBoolean: HsonCanonical = Hson`${true}`;
const inferredTaggedNull: HsonCanonical = Hson`${null}`;
// @ts-expect-error Ordinary source-string calls are unsupported.
hson("<foo/>");
// @ts-expect-error Ordinary source-string calls are unsupported.
hson("37");
// @ts-expect-error Ordinary calls are unsupported.
hson(37);
// @ts-expect-error Ordinary calls are unsupported.
hson(true);
// @ts-expect-error Ordinary calls are unsupported.
hson(null);
// @ts-expect-error Ordinary calls are unsupported.
hson({});
// @ts-expect-error Tagged substitutions exclude undefined.
Hson`${undefined}`;
// @ts-expect-error Tagged substitutions exclude bigint.
Hson`${1n}`;
// @ts-expect-error Tagged substitutions exclude symbol.
Hson`${Symbol()}`;
// @ts-expect-error Tagged substitutions exclude objects.
Hson`${{}}`;
// @ts-expect-error Tagged substitutions exclude arrays.
Hson`${[]}`;
// @ts-expect-error Tagged substitutions exclude functions.
Hson`${() => {}}`;
// @ts-expect-error Transform textual admission has no .string surface.
hson.transform.string;
// @ts-expect-error Transform textual admission has no .string surface.
transformSubpath.string;
// @ts-expect-error The authoring facade exposes no Transform subsystem.
HsonSubpath.transform;
// @ts-expect-error Hson finalizers serialize; they do not stringify.
transformSubpath.fromNode(node).toHson().string();
const inferredHtmlText = transformSubpath.fromNode(node).toHtml().serialize();
const inferredJsonText = transformSubpath.fromNode(node).toJson().serialize();
const inferredHsonHash: Promise<string> = transformSubpath.fromNode(node).toHson().sha256();
const inferredHtmlHash: Promise<string> = transformSubpath.fromNode(node).toHtml().sha256();
const inferredJsonHash: Promise<string> = transformSubpath.fromNode(node).toJson().sha256();
const inferredBinary: TransformBinarySerialize = transformSubpath.fromNode(node).toBinary();
const inferredBinaryBytes: Uint8Array = inferredBinary.serialize();
const inferredBinaryHash: Promise<string> = inferredBinary.sha256();
transformSubpath.fromBinary(inferredBinaryBytes, binaryDecodeOptions).toNode();
hson.fromBinary(inferredBinaryBytes, { maxBytes: 1, maxGraphDepth: 1, maxGraphNodes: 1 }).toNode();
// @ts-expect-error Binary Hson admits Uint8Array only, not ArrayBuffer.
transformSubpath.fromBinary(new ArrayBuffer(0));
// @ts-expect-error Binary decode options require numeric limits.
transformSubpath.fromBinary(inferredBinaryBytes, { maxBytes: "1" });
const inferredDynamicHash: Promise<string> = genericSerializer.sha256();
// @ts-expect-error Canonical graph terminals do not represent emitted bytes.
transformSubpath.fromNode(node).toNode().sha256();
const hsonText: HsonCanonical = inferredHsonText;
const normalizedHson: HsonCanonical = inferredNormalizedHson;
const repeatedNormalizedHson: HsonCanonical = hson.fromHson(normalizedHson).toHson().serialize();
const readableHson: HsonCanonical = transformSubpath.fromNode(node).toHson().serialize();
const compactHson: HsonCanonical =
  transformSubpath.fromNode(node).toHson().noBreak().serialize();
const noQuidHson: HsonCanonical =
  transformSubpath.fromNode(node).toHson().noQuid().serialize();
const ordinaryText: string = hsonText;
const inferredNamespaceNumber = hson.transform.calc(arbitraryNumber);
const inferredNamedNumber = hsonCalc(arbitraryNumber);
const inferredNamespaceCalc = hson.transform.calc(() => arbitraryNumber);
const inferredNamedCalc = hsonCalc(() => arbitraryNumber);
const admittedNumber: HsonNumber = inferredNamedNumber;
const transformAdmittedNumber: TransformHsonNumber = admittedNumber;
const ordinaryNumber: number = admittedNumber;
const repeatedAdmittedNumber: HsonNumber = hsonCalc(admittedNumber);
const admittedSemanticNumber: HsonSemanticPrimitive = admittedNumber;
void inferredHsonHash;
void inferredHtmlHash;
void inferredJsonHash;
void inferredBinaryHash;
void inferredDynamicHash;

// @ts-expect-error Admitted semantic numeric positions require HsonNumber proof.
const invalidSemanticNumber: HsonSemanticPrimitive = arbitraryNumber;
const narrowAdmittedNumber: NarrowHsonNumber = narrowHsonCalc(arbitraryNumber);
const narrowCalculatedNumber: NarrowHsonNumber = narrowHsonCalc(() => arbitraryNumber);
const candidateNode: HsonNode = { $_tag: "_hson_val", $_content: [arbitraryNumber] };
hson.fromJson(arbitraryNumber);
hson.fromNode(candidateNode);

declare const operationalCommit: LiveMapCommit;
const operationalRevision: number = operationalCommit.rev;
// @ts-expect-error Operational revisions are not semantic HsonNumber values.
const invalidOperationalNumber: HsonNumber = operationalCommit.rev;

// @ts-expect-error Ordinary numbers require runtime admission before branding.
const invalidAdmittedNumber: HsonNumber = arbitraryNumber;

// @ts-expect-error Ordinary strings are not official Hson serializer output.
const invalidHson: HsonCanonical = arbitrary;
// @ts-expect-error HTML output remains a plain string.
const invalidHtmlHson: HsonCanonical = inferredHtmlText;
// @ts-expect-error JSON output remains a plain string.
const invalidJsonHson: HsonCanonical = inferredJsonText;

transformSubpath.fromHson(arbitrary).toNode();
transformSubpath.fromHson(hsonText).toNode();

type HsonFinalizerReturnsHsonCanonical = Expect<
  Equal<typeof inferredHsonText, HsonCanonical>
>;
type HsonCanonicalMethodReturnsHsonCanonical = Expect<
  Equal<typeof inferredNormalizedHson, HsonCanonical>
>;
type RootHasNoUnsafeHsonConstructor = Expect<
  Equal<
    "asHsonCanonical" | "brandHson" | "unsafeHsonCanonical" extends keyof typeof hson
      ? true
      : false,
    false
  >
>;
type RootHasNoTransformAdmissionMethods = Expect<
  Equal<Extract<"string" | "number" | "calc", keyof typeof hson>, never>
>;
type TransformHasNoNumberMethod = Expect<
  Equal<Extract<"number", keyof typeof hson.transform>, never>
>;
type HtmlFinalizerReturnsString = Expect<
  Equal<typeof inferredHtmlText, string>
>;
type JsonFinalizerReturnsString = Expect<
  Equal<typeof inferredJsonText, string>
>;
type GenericSerializerReturnsString = Expect<
  Equal<ReturnType<typeof genericSerializer.serialize>, string>
>;
type ParserAcceptsString = Expect<
  Equal<Parameters<typeof transformSubpath.fromHson>[0], string>
>;
type NamespaceNumberReturnsHsonNumber = Expect<
  Equal<typeof inferredNamespaceNumber, HsonNumber>
>;
type NamedNumberReturnsHsonNumber = Expect<
  Equal<typeof inferredNamedNumber, HsonNumber>
>;
type NamespaceCalcReturnsHsonNumber = Expect<
  Equal<typeof inferredNamespaceCalc, HsonNumber>
>;
type NamedCalcReturnsHsonNumber = Expect<
  Equal<typeof inferredNamedCalc, HsonNumber>
>;
type NumberCandidateIsWelcoming = Expect<
  Equal<Parameters<typeof hson.transform.calc>[0], number | (() => number)>
>;
type CalcCallbackIsFriendly = Expect<
  Equal<Parameters<typeof hsonCalc>[0], number | (() => number)>
>;

void readableHson;
void compactHson;
void noQuidHson;
void ordinaryText;
void ordinaryNumber;
void transformAdmittedNumber;
void repeatedAdmittedNumber;
void admittedSemanticNumber;
void invalidSemanticNumber;
void narrowAdmittedNumber;
void narrowCalculatedNumber;
void operationalRevision;
void invalidOperationalNumber;
void invalidAdmittedNumber;
void repeatedNormalizedHson;
void inferredRootTaggedHson;
void inferredHsonSubpathTaggedHson;
void invalidHson;
void invalidHtmlHson;
void invalidJsonHson;
void removedRootHsonNumber;
void removedNarrowHsonNumber;
declare const rootHsonCanonical: RootHsonCanonical;
void rootHsonCanonical;

type PublicTypes = LiveTreeLifecycleResult | LiveMapCommit | LiveMapPathHandle | LiveMapDocumentIdentityHandle;
declare const publicTypes: PublicTypes;
void publicTypes;

declare const pathHandle: LiveMapPathHandle;
// @ts-expect-error LiveMap path handles have no public QUID identity.
void pathHandle.quid;

const publicDocumentMap = mapSubpath.fromHson(`<main/>`);
if (publicDocumentMap.mode === "document") {
  // @ts-expect-error Document LiveMaps expose no public live canonical-node debug escape.
  publicDocumentMap.debug.node([]);
  const documentAcquisitionIsPublic: "ensureIdentity" extends keyof typeof publicDocumentMap.document ? true : false = false;
  bindingTree.bind.path(publicDocumentMap.at([]), (_tree, value, previous) => {
    type DocumentBindingValue = Expect<Equal<typeof value, HsonNode | Primitive | undefined>>;
    type DocumentBindingPrevious = Expect<typeof previous extends HsonNode | Primitive | undefined ? true : false>;
    return undefined;
  });
  bindingTree.bind.paths([publicDocumentMap.at([]), projectedPathMap.at(["required", "leaf"])], (_tree, values) => {
    type DocumentProjectedTuple = Expect<Equal<
      typeof values,
      readonly [HsonNode | Primitive | undefined, string]
    >>;
    return undefined;
  });
  bindingTree.bind.paths([projectedPathMap.at(["literal"]), publicDocumentMap.at([])], (_tree, values) => {
    type ProjectedDocumentTuple = Expect<Equal<
      typeof values,
      readonly ["ready", HsonNode | Primitive | undefined]
    >>;
    return undefined;
  });
  bindingTree.bind.text(publicDocumentMap.at([]), (value) => String(value ?? ""));
  bindingTree.bind.textPaths([publicDocumentMap.at([])], (values) => String(values[0] ?? ""));
  bindingTree.bind.attr(publicDocumentMap.at([]), "data-document", (value) => String(value ?? ""));
  bindingTree.bind.attrs(publicDocumentMap.at([]), (value) => ({ "data-document": value !== undefined }));
  bindingTree.bind.attrsPaths([publicDocumentMap.at([])], (values) => ({ "data-document": values[0] !== undefined }));
  bindingTree.bind.css(publicDocumentMap.at([]), (value) => ({ opacity: value === undefined ? 0 : 1 }));
  bindingTree.bind.cssPaths([publicDocumentMap.at([])], (values) => ({ opacity: values[0] === undefined ? 0 : 1 }));
  // @ts-expect-error Broad document locations can contain Hson and require a text formatter.
  bindingTree.bind.text(publicDocumentMap.at([]));
  // @ts-expect-error Broad document locations can contain Hson and require an attribute formatter.
  bindingTree.bind.attr(publicDocumentMap.at([]), "data-document");
  void documentAcquisitionIsPublic;
}

const projectedHsonLookalike = mapSubpath.fromJson({ value: { $_tag: "projected", $_content: [] } });
bindingTree.bind.text(projectedHsonLookalike.at(["value"]));
bindingTree.bind.attr(projectedHsonLookalike.at(["value"]), "data-projected");

type PublicDocumentLocation = ReturnType<DocumentLiveMap["at"]>;
type PrimitiveDocumentLocation = Omit<PublicDocumentLocation, "snap" | "watch"> & Readonly<{
  snap: () => string | undefined;
  watch: (listener: (next: string | undefined) => void) => () => void;
}>;
declare const futurePrimitiveDocumentLocation: PrimitiveDocumentLocation;
bindingTree.bind.text(futurePrimitiveDocumentLocation);
bindingTree.bind.attr(futurePrimitiveDocumentLocation, "data-future");

declare const readonlyDocumentMap: LocusReadonlyMap<DocumentLiveMap>;
// @ts-expect-error Readonly Host document locations are not part of the Host surface.
readonlyDocumentMap.at([]);

declare const structurallyFabricatedProjectedLocation: Pick<LiveMapPathHandle<string>, "snap" | "watch" | "feed">;
// TypeScript remains structural here; runtime authenticity rejects this unsupported fabrication.
bindingTree.bind.path(structurallyFabricatedProjectedLocation, () => undefined);

// Uppercase authoring is the only callable facade; /hson is a narrow boundary.
// @ts-expect-error Retired lowercase tag has no compatibility call signature.
hson`<retired/>`;
// @ts-expect-error The narrow authoring entrypoint does not export the aggregate.
import { hson as retiredSubpathAggregate } from "hson-live/hson";
// @ts-expect-error Subsystems use their own entrypoints or the package root.
import { hsonLiveMap as retiredAuthoringMap } from "hson-live/hson";
// @ts-expect-error Canonical input is required at every validation entrance.
Hson.certify(standaloneSchema, "37");
const authoredTypeIdentity: AuthoringCanonical = standaloneCanonical;
const originalTypeIdentity: HsonCanonical = authoredTypeIdentity;
const sameRootMapType: typeof mapSubpath = hsonLiveMap;
const sameRootTreeType: typeof treeSubpath = hsonLiveTree;
const sameRootTransformType: typeof transformSubpath = hsonTransform;
const sameRootInspectType: typeof hson.inspect = hsonInspect;
void [originalTypeIdentity, sameRootMapType, sameRootTreeType, sameRootTransformType, sameRootInspectType];
