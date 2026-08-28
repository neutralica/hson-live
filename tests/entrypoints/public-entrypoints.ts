import {
  hson,
  hsonCalc,
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
  hson as hsonSubpath,
  hsonTransform as hsonSubpathTransform,
} from "hson-live/hson";
import type { HsonNode, HsonSemanticPrimitive, JsonValue, Primitive } from "hson-live/types";
// D1 tooling is private, including its capability-origin and lifecycle helpers.
// @ts-expect-error Standalone helper is not a public export.
import { validate } from "hson-live";
// @ts-expect-error Shared graph authority stays private.
import { validate_schema_hson_graph } from "hson-live/livemap";
// @ts-expect-error Direct-source associations are private tooling.
import type { TrustedSchemaDirectSource } from "hson-live/types";
const standaloneSchema = hson.liveMap.schema.define(s => s.number);
const standaloneCanonical: HsonCanonical = hson.liveMap.schema.validate(standaloneSchema, hson`37`);
const narrowStandaloneCanonical: HsonCanonical = hsonSubpath.liveMap.schema.validate(standaloneSchema, standaloneCanonical);
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
  type InferLiveMapSchema,
  type LiveMap,
  type LiveMapCommit,
  type LiveMapDocumentIdentityHandle,
  type ElementLiveMap,
  type LiveMapPathHandle,
  type LiveMapSchemaConstraint,
  type LiveMapSchemaResolution,
  type LiveMapSchemaValue,
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
  type LocusAuthorityErrorCode,
  type LocusReadonlyMap,
  type LocusSyncManager,
  type LocusSyncSend,
  type LocusSyncSession,
} from "hson-live/locus";
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

// @ts-expect-error The separate document authoring namespace was hard-removed.
hson.liveMap.schema.document;
const publicElementSchema = hson.liveMap.schema.define((s) => s.button(s.string));
const publicButtonAttrs = hson.liveMap.schema.define((s) => s.attrs.exact({
  id: s.string,
  selected: s.flag.optional,
  style: s.unknown.optional,
}));
const publicAttributedElementSchema = hson.liveMap.schema.define((s) =>
  s.button(publicButtonAttrs, s.string),
);
const publicCustomElementSchema = hson.liveMap.schema.define((s) => s.tag["my-widget"](s.string));
declare const publicDynamicTagName: string;
const publicDynamicElementSchema = hson.liveMap.schema.define((s) => s.tag[publicDynamicTagName](s.string));
const publicFragmentSchema = hson.liveMap.schema.define((s) => s.repeat(
  s.pick(s.string, s.tag()),
));
const publicEmptySchema = hson.liveMap.schema.define((s) => s.empty);
const publicCountedSchema = hson.liveMap.schema.define((s) => s.repeat(3, s.string));
declare const publicDynamicRepeatCount: number;
const publicDynamicCountedSchema = hson.liveMap.schema.define((s) => s.repeat(publicDynamicRepeatCount, s.string));
const publicConstrainedSchema = hson.liveMap.schema.define((s) =>
  s.number.constrain((value) => Number.isFinite(value)),
);
const publicStringConstrainedSchema = hson.liveMap.schema.define((s) =>
  s.string.constrain((value) => value.startsWith("sys_id_no_")),
);
const publicBroadArraySchema = hson.liveMap.schema.define((s) => s.array());
const publicExactObjectSchema = hson.liveMap.schema.define((s) => s.object.exact({ id: s.string }));
// @ts-expect-error Exact projected objects are exposed only through the object family.
hson.liveMap.schema.define((s) => s.exact({ id: s.string }));
// @ts-expect-error Array exactness is not a public family member.
hson.liveMap.schema.define((s) => s.array.exact(s.string));
// @ts-expect-error Tuple exactness is not a public family member.
hson.liveMap.schema.define((s) => s.tuple.exact(s.string));
// @ts-expect-error Record exactness is not a public family member.
hson.liveMap.schema.define((s) => s.record.exact(s.string));
const publicDefinedConstraint = hson.liveMap.schema.define(() =>
  publicConstrainedSchema.constrain("positive", (value) => value > 0),
);
// @ts-expect-error constrain is a schema-value modifier, not a toolkit constructor.
hson.liveMap.schema.define((s) => s.constrain(s.number, "positive", (value: number) => value > 0));
// @ts-expect-error The old predicate-narrowing operator is hard-removed.
hson.liveMap.schema.define((s) => s.refine(s.number, "positive", (value: number) => value > 0));
// @ts-expect-error The old recursive-reference operator is hard-removed.
hson.liveMap.schema.define((s) => s.lazy(() => s.string));
// @ts-expect-error Exact arbitrary tags use the tag-family property grammar.
hson.liveMap.schema.define((s) => s.tag("legacy-widget"));
// @ts-expect-error Callable tag(...) already covers any-element schemas.
hson.liveMap.schema.define((s) => s.element());
void publicCustomElementSchema;
void publicStringConstrainedSchema;
void publicBroadArraySchema;
void publicExactObjectSchema;
void publicAttributedElementSchema;
void publicDynamicElementSchema;
void publicEmptySchema;
void publicCountedSchema;
void publicDynamicCountedSchema;
void publicDefinedConstraint;
const publicElementCandidate = hson.liveMap.fromHson(`<button "Save"/>`);
if (publicElementCandidate.mode === "element") {
  const schemaBound = publicElementCandidate.schema.use(publicElementSchema);
  const sameSchema = schemaBound.schema.get();
  const typedDocumentText = schemaBound.at([0]).snap();
  type PublicTypedDocumentText = Expect<Equal<typeof typedDocumentText, string>>;
  schemaBound.at([0]).replace("Open");
  // @ts-expect-error Schema-proven document text rejects structured authoring.
  schemaBound.at([0]).replace(publicElementCandidate.element.node());
  // @ts-expect-error Missing-read undefined is not a document authoring value.
  schemaBound.at([0]).replace(undefined);
  // @ts-expect-error The one-item closed document schema has no coordinate 1.
  schemaBound.at([1]);
  void sameSchema;
}
const publicAttributedCandidate = hson.liveMap.fromHson(`<button id="save" selected "Save"/>`);
if (publicAttributedCandidate.mode === "element") {
  const schemaBound = publicAttributedCandidate.schema.use(publicAttributedElementSchema);
  const root = schemaBound.at([]);
  const id = root.attrs.get("id");
  const selected = root.attrs.get("selected");
  type PublicRequiredAttr = Expect<Equal<typeof id, string>>;
  type PublicOptionalFlagAttr = Expect<Equal<typeof selected, "selected" | undefined>>;
  root.flags.has("selected");
  root.flags.set("selected");
  root.flags.clear("selected");
  schemaBound.document.flags.has({ kind: "path", path: [] }, "selected");
  schemaBound.document.flags.set({ kind: "path", path: [] }, "selected");
  schemaBound.document.flags.clear({ kind: "path", path: [] }, "selected");
}
const publicFragmentCandidate = mapSubpath.fromHson(`"before" <em/>`);
if (publicFragmentCandidate.mode === "fragment") {
  const schemaBound = publicFragmentCandidate.schema.use(publicFragmentSchema);
  schemaBound.at([]).insert(0, "text");
  schemaBound.at([]).insert(0, hson.liveMap.fromHson(`<strong/>`).root());
  // @ts-expect-error Schema-aware document insertion excludes legacy numeric content.
  schemaBound.at([]).insert(0, 1);
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

const typedRelativeDocumentCandidate = mapSubpath.fromHson(`<main <label "Save"/>/>`);
if (typedRelativeDocumentCandidate.mode === "element") {
  const typedRelativeSchema = mapSubpath.schema.define((s) => s.tag(s.label(s.string)));
  const typedRelativeDocument = typedRelativeDocumentCandidate.schema.use(
    typedRelativeSchema,
  );
  const relativeLabel = typedRelativeDocument.at([]).at([0]).at([0]);
  const proxiedLabel = typedRelativeDocument.proxy()[0][0].$_;
  const relativeLabelValue = relativeLabel.snap();
  const proxiedLabelValue = proxiedLabel.snap();
  type PublicRelativeDocumentText = Expect<Equal<typeof relativeLabelValue, string>>;
  type PublicProxyDocumentText = Expect<Equal<typeof proxiedLabelValue, string>>;
  type PublicDirectRelativeProxyText = Expect<Equal<
    typeof proxiedLabelValue,
    ReturnType<ReturnType<typeof typedRelativeDocument.at<[0, 0]>>["snap"]>
  >>;
  relativeLabel.replace("Open");
  proxiedLabel.replace("Save");
  bindingTree.bind.text(relativeLabel);
  bindingTree.bind.text(proxiedLabel);
  // @ts-expect-error Relative schema-proven text rejects structured authoring.
  relativeLabel.replace(typedRelativeDocumentCandidate.element.node());
  // @ts-expect-error Proxied schema-proven text rejects structured authoring.
  proxiedLabel.replace(typedRelativeDocumentCandidate.element.node());
  // @ts-expect-error The nested label element has no coordinate 1.
  typedRelativeDocument.at([0]).at([1]);
}

const typedBindingDocumentCandidate = mapSubpath.fromHson(`<button "Save"/>`);
if (typedBindingDocumentCandidate.mode === "element") {
  const typedBindingDocument = typedBindingDocumentCandidate.schema.use(publicElementSchema);
  bindingTree.bind.text(typedBindingDocument.at([0]));
  // @ts-expect-error The structured document root still requires explicit conversion.
  bindingTree.bind.text(typedBindingDocument.at([]));
}
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
  | LiveMapSchemaResolution
  | LiveMapSchemaConstraint
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

const declarationTruthSchema = mapSubpath.schema.define((schema) => schema.object.exact({
  optionalObject: schema.number.optional,
  optionalBranch: schema.object({ name: schema.string }).optional,
  nullableBranch: schema.object({ name: schema.string }).nullable,
  optionalNullableBranch: schema.object({ name: schema.string }).nullable.optional,
  array: schema.array(schema.number.optional),
  arrayToken: schema.array(schema.number.optional),
  tupleTrailing: schema.tuple(schema.string, schema.number.optional),
  tupleNonTrailing: schema.tuple(schema.number.optional, schema.string),
  nested: schema.array(schema.tuple(schema.number, schema.string.optional)),
  nullable: schema.string.nullable,
  literal: schema.literal("draft", "ready"),
  mutableValue: schema.number,
  record: schema.record(schema.number.optional),
  picked: schema.pick(schema.number.optional, "auto"),
  recursive: schema.recurse(() => schema.number.optional),
  constrained: schema.number.optional.constrain("finite", Number.isFinite),
  constrainedString: schema.string.constrain((value) => value.length >= 3),
  deep: schema.deepPartial(schema.object.exact({
    child: schema.object.exact({ count: schema.number }),
    tuple: schema.tuple(schema.string, schema.number),
    list: schema.array(schema.object.exact({ id: schema.number })),
  })),
}));

type DeclarationTruth = InferLiveMapSchema<typeof declarationTruthSchema>;
type OptionalObjectIsOptional = Expect<
  Equal<{} extends Pick<DeclarationTruth, "optionalObject"> ? true : false, true>
>;
type OptionalObjectPresentValue = Expect<
  Equal<Exclude<DeclarationTruth["optionalObject"], undefined>, number>
>;
type ArrayPresentItem = Expect<Equal<DeclarationTruth["array"][number], number>>;
type ArrayTokenPresentItem = Expect<Equal<DeclarationTruth["arrayToken"][number], number>>;
type TrailingOptionalTuple = Expect<
  Equal<DeclarationTruth["tupleTrailing"], readonly [string, number?]>
>;
type NonTrailingOptionalTuple = Expect<
  Equal<DeclarationTruth["tupleNonTrailing"], readonly [number, string]>
>;
type NestedArrayTuple = Expect<
  Equal<DeclarationTruth["nested"][number], readonly [number, string?]>
>;
type NullableRemainsDistinct = Expect<Equal<DeclarationTruth["nullable"], string | null>>;
type LiteralUnionPreserved = Expect<Equal<DeclarationTruth["literal"], "draft" | "ready">>;
type MutableValue = Expect<Equal<DeclarationTruth["mutableValue"], number>>;
type RecordPresentValue = Expect<Equal<DeclarationTruth["record"][string], number>>;
type PickPresentValue = Expect<Equal<DeclarationTruth["picked"], number | "auto">>;
type RecursivePresentValue = Expect<Equal<DeclarationTruth["recursive"], number>>;
type ConstrainedPresentValue = Expect<Equal<DeclarationTruth["constrained"], number>>;
type ConstrainedStringValue = Expect<Equal<DeclarationTruth["constrainedString"], string>>;
type DeepPartialTuple = Expect<
  Equal<NonNullable<DeclarationTruth["deep"]["tuple"]>, readonly [string?, number?]>
>;
type DeepPartialArrayItem = Expect<
  Equal<NonNullable<DeclarationTruth["deep"]["list"]>[number], { id?: number }>
>;
type RootExcludesUndefined = Expect<Equal<undefined extends DeclarationTruth ? true : false, false>>;
type SchemaValueAliasAgrees = Expect<
  Equal<LiveMapSchemaValue<typeof declarationTruthSchema>, DeclarationTruth>
>;

const schemaBoundMap = mapSubpath.fromJson({}).schema.use(declarationTruthSchema);
// @ts-expect-error LiveMap exposes no public live canonical-node debug escape.
schemaBoundMap.debug.node([]);
// @ts-expect-error Schema detachment through undefined is not part of the owner contract.
schemaBoundMap.schema.use(undefined);
// @ts-expect-error Schema owner contracts expose no reset operation.
schemaBoundMap.schema.reset();
const typedTupleItem = schemaBoundMap.at(["tupleTrailing", 0]).snap();
const typedOptionalTupleItem = schemaBoundMap.at(["tupleTrailing", 1]).snap();
const typedArrayItem = schemaBoundMap.at(["array", 0]).snap();
const typedOptionalBranch = schemaBoundMap.at(["optionalBranch", "name"]).snap();
const typedNullableBranch = schemaBoundMap.at(["nullableBranch", "name"]).snap();
const typedOptionalNullableBranch = schemaBoundMap.at(["optionalNullableBranch", "name"]).snap();
const typedSchemaLiteral = schemaBoundMap.at(["literal"]).snap();
bindingTree.bind.text(schemaBoundMap.at(["literal"]), (value) => {
  type SchemaLiteralBinding = Expect<Equal<typeof value, "draft" | "ready">>;
  return value;
});
schemaBoundMap.at(["mutableValue"]).set(1);
type LiteralTuplePathRemainsExact = Expect<Equal<typeof typedTupleItem, string>>;
type OptionalTuplePathRemainsExact = Expect<Equal<typeof typedOptionalTupleItem, number | undefined>>;
type ArrayPathIncludesRuntimeAbsence = Expect<Equal<typeof typedArrayItem, number | undefined>>;
type SchemaOptionalBranchReachability = Expect<Equal<typeof typedOptionalBranch, string | undefined>>;
type SchemaNullableBranchReachability = Expect<Equal<typeof typedNullableBranch, string | undefined>>;
type SchemaOptionalNullableBranchReachability = Expect<Equal<typeof typedOptionalNullableBranch, string | undefined>>;
type SchemaLiteralPathRemainsExact = Expect<Equal<typeof typedSchemaLiteral, "draft" | "ready">>;
// @ts-expect-error Schema evidence rejects keys absent from the exact inferred shape.
schemaBoundMap.at(["missingSchemaKey"]);

const validOptionalObject: Pick<DeclarationTruth, "optionalObject"> = {};
const validOptionalTuple: DeclarationTruth["tupleTrailing"] = ["ready"];
const validNullable: DeclarationTruth["nullable"] = null;
// @ts-expect-error Explicit undefined is not an admitted present optional object value.
const invalidOptionalObject: Pick<DeclarationTruth, "optionalObject"> = { optionalObject: undefined };
// @ts-expect-error Explicit undefined is not an admitted present array item.
const invalidArrayItem: DeclarationTruth["array"] = [1, undefined];
// @ts-expect-error Explicit undefined is not an admitted present optional tuple item.
const invalidTupleItem: DeclarationTruth["tupleTrailing"] = ["ready", undefined];
// @ts-expect-error Nullability does not imply optionality or admit undefined.
const invalidNullable: DeclarationTruth["nullable"] = undefined;
// @ts-expect-error The public schema facade rejects a non-schema input.
mapSubpath.schema.make(42);
// @ts-expect-error The public schema facade requires its factory to return a schema input.
mapSubpath.schema.define(() => 42);
void validOptionalObject;
void validOptionalTuple;
void validNullable;
void invalidOptionalObject;
void invalidArrayItem;
void invalidTupleItem;
void invalidNullable;

declare const node: HsonNode;
declare const arbitrary: string;
declare const arbitraryNumber: number;
declare const genericSerializer: TransformSerialize;
declare const binaryDecodeOptions: BinaryDecodeOptions;

const inferredHsonText = transformSubpath.fromNode(node).toHson().serialize();
const inferredNormalizedHson = hson.transform.fromHson(arbitrary).toHson().serialize();
const inferredRootTaggedHson: HsonCanonical = hson`<main/>`;
const inferredHsonSubpathTaggedHson: HsonCanonical = hsonSubpath`<main/>`;
const inferredTaggedNumber: HsonCanonical = hson`${37}`;
const inferredTaggedString: HsonCanonical = hson`${"37"}`;
const inferredTaggedBoolean: HsonCanonical = hson`${true}`;
const inferredTaggedNull: HsonCanonical = hson`${null}`;
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
hson`${undefined}`;
// @ts-expect-error Tagged substitutions exclude bigint.
hson`${1n}`;
// @ts-expect-error Tagged substitutions exclude symbol.
hson`${Symbol()}`;
// @ts-expect-error Tagged substitutions exclude objects.
hson`${{}}`;
// @ts-expect-error Tagged substitutions exclude arrays.
hson`${[]}`;
// @ts-expect-error Tagged substitutions exclude functions.
hson`${() => {}}`;
// @ts-expect-error Transform textual admission has no .string surface.
hson.transform.string;
// @ts-expect-error Transform textual admission has no .string surface.
transformSubpath.string;
// @ts-expect-error Transform textual admission has no .string surface.
hsonSubpathTransform.string;
// @ts-expect-error HSON finalizers serialize; they do not stringify.
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
// @ts-expect-error Binary HSON admits Uint8Array only, not ArrayBuffer.
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

// @ts-expect-error Ordinary strings are not official HSON serializer output.
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
if (publicDocumentMap.mode === "element") {
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
  // @ts-expect-error Broad document locations can contain HSON and require a text formatter.
  bindingTree.bind.text(publicDocumentMap.at([]));
  // @ts-expect-error Broad document locations can contain HSON and require an attribute formatter.
  bindingTree.bind.attr(publicDocumentMap.at([]), "data-document");
  void documentAcquisitionIsPublic;
}

const projectedHsonLookalike = mapSubpath.fromJson({ value: { $_tag: "projected", $_content: [] } });
bindingTree.bind.text(projectedHsonLookalike.at(["value"]));
bindingTree.bind.attr(projectedHsonLookalike.at(["value"]), "data-projected");

type PublicDocumentLocation = ReturnType<ElementLiveMap["at"]>;
type PrimitiveDocumentLocation = Omit<PublicDocumentLocation, "snap" | "watch"> & Readonly<{
  snap: () => string | undefined;
  watch: (listener: (next: string | undefined) => void) => () => void;
}>;
declare const futurePrimitiveDocumentLocation: PrimitiveDocumentLocation;
bindingTree.bind.text(futurePrimitiveDocumentLocation);
bindingTree.bind.attr(futurePrimitiveDocumentLocation, "data-future");

declare const readonlyDocumentMap: LocusReadonlyMap<ElementLiveMap>;
// @ts-expect-error Readonly Host document locations are not part of the Host surface.
readonlyDocumentMap.at([]);

declare const structurallyFabricatedProjectedLocation: Pick<LiveMapPathHandle<string>, "snap" | "watch" | "feed">;
// TypeScript remains structural here; runtime authenticity rejects this unsupported fabrication.
bindingTree.bind.path(structurallyFabricatedProjectedLocation, () => undefined);
