import {
  hson,
  hsonCalc,
  hsonNumber,
  hsonString,
  type HsonNumber,
} from "hson-live";
import {
  TransformError,
  hsonString as transformHsonString,
  hsonTransform as transformSubpath,
  is_transform_error,
  read_transform_error_details,
  type HsonString,
  type HsonNumber as TransformHsonNumber,
  type TransformErrorDetails,
  type TransformErrorRelated,
  type TransformErrorSource,
  type TransformOutputRenderFormat,
  type TransformRender,
  type TransformSerialize,
} from "hson-live/transform";
import {
  TransformError as HsonSubpathTransformError,
  hson as hsonSubpath,
  hsonString as hsonSubpathString,
  hsonTransform as hsonSubpathTransform,
} from "hson-live/hson";
import type { HsonNode, HsonSemanticPrimitive, JsonValue } from "hson-live/types";
import {
  hsonCalc as narrowHsonCalc,
  hsonNumber as narrowHsonNumber,
  type HsonNumber as NarrowHsonNumber,
} from "hson-live/number";
// @ts-expect-error string is a Transform namespace method, not a bare package export.
import { string as bareHsonString } from "hson-live";
// @ts-expect-error The private brand symbol is not a Transform export.
import type { HSON_STRING_BRAND } from "hson-live/transform";
// @ts-expect-error The private number brand symbol is not exported.
import type { HSON_NUMBER_BRAND } from "hson-live/transform";
// @ts-expect-error HsonString is intentionally not exported from the package root.
import type { HsonString as RootHsonString } from "hson-live";
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
  define_livemap_schema,
  hsonLiveMap as mapSubpath,
  make_livemap_core,
  make_livemap_schema,
  type InferLiveMapSchema,
  type LiveMap,
  type LiveMapCommit,
  type LiveMapDocumentIdentityHandle,
  type LiveMapPathHandle,
  type LiveMapSchemaResolution,
  type LiveMapSchemaValue,
  type LivePath,
  type ProjectedValueAdmissionCode,
  type ProjectedValuePath,
} from "hson-live/livemap";
import {
  LiveHostAuthorityError,
  hsonLiveHost as hostSubpath,
  type LiveHostAuthorityErrorCode,
  type LiveHostReadonlyMap,
  type LiveHostSyncManager,
  type LiveHostSyncSend,
  type LiveHostSyncSession,
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
void LiveHostAuthorityError;
void make_livemap_core;
void get_livemap_quid;
void ensure_livemap_quid;
void construct_tree;
void bareHsonString;

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
declare const readonlyBindingMap: LiveHostReadonlyMap<LiveMap<ProjectedPathTruth>>;
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
  | ProjectedValueAdmissionCode
  | ProjectedValuePath;
type PublicLiveHostClosure =
  | LiveHostAuthorityErrorCode
  | LiveHostSyncManager
  | LiveHostSyncSend
  | LiveHostSyncSession;
declare const publicDeclarationClosure:
  | PublicTransformClosure
  | PublicLiveTreeClosure
  | PublicLiveMapClosure
  | PublicLiveHostClosure;
void publicDeclarationClosure;

const declarationTruthSchema = define_livemap_schema((schema) => ({
  optionalObject: schema.number.optional,
  optionalBranch: schema.object({ name: schema.string }).optional,
  nullableBranch: schema.object({ name: schema.string }).nullable,
  optionalNullableBranch: schema.object({ name: schema.string }).nullable.optional,
  array: schema.array(schema.number.optional),
  arrayToken: schema.number.optional.array,
  tupleTrailing: schema.tuple(schema.string, schema.number.optional),
  tupleNonTrailing: schema.tuple(schema.number.optional, schema.string),
  nested: schema.array(schema.tuple(schema.number, schema.string.optional)),
  nullable: schema.string.nullable,
  literal: schema.literal("draft", "ready"),
  readonlyValue: schema.number.readonly,
  record: schema.record(schema.number.optional),
  picked: schema.pick(schema.number.optional, "auto"),
  lazy: schema.lazy(() => schema.number.optional),
  refined: schema.refine(schema.number.optional, "finite", Number.isFinite),
  deep: schema.deepPartial({
    child: { count: schema.number },
    tuple: schema.tuple(schema.string, schema.number),
    list: schema.array(schema.object({ id: schema.number })),
  }),
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
type ReadonlyMetadataDoesNotChangeValue = Expect<Equal<DeclarationTruth["readonlyValue"], number>>;
type RecordPresentValue = Expect<Equal<DeclarationTruth["record"][string], number>>;
type PickPresentValue = Expect<Equal<DeclarationTruth["picked"], number | "auto">>;
type LazyPresentValue = Expect<Equal<DeclarationTruth["lazy"], number>>;
type RefinedPresentValue = Expect<Equal<DeclarationTruth["refined"], number>>;
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
schemaBoundMap.at(["readonlyValue"]).set(1);
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
// @ts-expect-error A schema root must be an existing LiveMap schema input.
make_livemap_schema(42);
// @ts-expect-error A schema shape cannot contain explicit undefined.
make_livemap_schema({ value: undefined });
// @ts-expect-error A schema factory must return an existing LiveMap schema input.
define_livemap_schema(() => undefined);
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

const inferredHsonText = transformSubpath.fromNode(node).toHson().serialize();
const inferredNormalizedHson = hson.transform.string(arbitrary);
const inferredNamedHson = hsonString(arbitrary);
const inferredTransformNamedHson = transformHsonString(arbitrary);
const inferredRootTaggedHson: HsonString = hsonString`<main/>`;
const inferredTransformNamedTaggedHson: HsonString = transformHsonString`<main/>`;
const inferredHsonSubpathTaggedHson: HsonString = hsonSubpathString`<main/>`;
// @ts-expect-error Tagged admission is not part of the root Transform facade API.
hson.transform.string`<main/>`;
// @ts-expect-error Tagged admission is not part of the Transform subpath facade API.
transformSubpath.string`<main/>`;
// @ts-expect-error Tagged admission is not part of the hson subpath facade API.
hsonSubpath.transform.string`<main/>`;
// @ts-expect-error Tagged admission is not part of the named Transform facade API.
hsonSubpathTransform.string`<main/>`;
const inferredHtmlText = transformSubpath.fromNode(node).toHtml().serialize();
const inferredJsonText = transformSubpath.fromNode(node).toJson().serialize();
const hsonText: HsonString = inferredHsonText;
const normalizedHson: HsonString = inferredNormalizedHson;
const namedNormalizedHson: HsonString = inferredNamedHson;
const transformNamedNormalizedHson: HsonString = inferredTransformNamedHson;
const repeatedNormalizedHson: HsonString = hson.transform.string(normalizedHson);
const repeatedNamedNormalizedHson: HsonString = hsonString(namedNormalizedHson);
const readableHson: HsonString = transformSubpath.fromNode(node).toHson().serialize();
const compactHson: HsonString =
  transformSubpath.fromNode(node).toHson().noBreak().serialize();
const noQuidHson: HsonString =
  transformSubpath.fromNode(node).toHson().noQuid().serialize();
const ordinaryText: string = hsonText;
const inferredNamespaceNumber = hson.transform.number(arbitraryNumber);
const inferredNamedNumber = hsonNumber(arbitraryNumber);
const inferredNamespaceCalc = hson.transform.calc(() => arbitraryNumber);
const inferredNamedCalc = hsonCalc(() => arbitraryNumber);
const admittedNumber: HsonNumber = inferredNamedNumber;
const transformAdmittedNumber: TransformHsonNumber = admittedNumber;
const ordinaryNumber: number = admittedNumber;
const repeatedAdmittedNumber: HsonNumber = hsonNumber(admittedNumber);
const admittedSemanticNumber: HsonSemanticPrimitive = admittedNumber;

// @ts-expect-error Admitted semantic numeric positions require HsonNumber proof.
const invalidSemanticNumber: HsonSemanticPrimitive = arbitraryNumber;
const narrowAdmittedNumber: NarrowHsonNumber = narrowHsonNumber(arbitraryNumber);
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
const invalidHson: HsonString = arbitrary;
// @ts-expect-error HTML output remains a plain string.
const invalidHtmlHson: HsonString = inferredHtmlText;
// @ts-expect-error JSON output remains a plain string.
const invalidJsonHson: HsonString = inferredJsonText;

transformSubpath.fromHson(arbitrary).toNode();
transformSubpath.fromHson(hsonText).toNode();

type HsonFinalizerReturnsHsonString = Expect<
  Equal<typeof inferredHsonText, HsonString>
>;
type HsonStringMethodReturnsHsonString = Expect<
  Equal<typeof inferredNormalizedHson, HsonString>
>;
type HsonStringMethodAcceptsString = Expect<
  Equal<Parameters<typeof hson.transform.string>[0], string>
>;
type NamedHsonStringReturnsHsonString = Expect<
  Equal<typeof inferredNamedHson, HsonString>
>;
type TransformNamedHsonStringReturnsHsonString = Expect<
  Equal<typeof inferredTransformNamedHson, HsonString>
>;
type NamedHsonStringAcceptsString = Expect<
  Equal<Parameters<typeof hsonString>[0], string>
>;
type RootHasNoUnsafeHsonConstructor = Expect<
  Equal<
    "asHsonString" | "brandHson" | "unsafeHsonString" extends keyof typeof hson
      ? true
      : false,
    false
  >
>;
type RootHasNoTransformAdmissionMethods = Expect<
  Equal<Extract<"string" | "number" | "calc", keyof typeof hson>, never>
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
  Equal<Parameters<typeof hson.transform.number>[0], unknown>
>;
type CalcCallbackIsFriendly = Expect<
  Equal<Parameters<typeof hsonCalc>[0], () => unknown>
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
void inferredTransformNamedTaggedHson;
void inferredHsonSubpathTaggedHson;
void transformNamedNormalizedHson;
void repeatedNamedNormalizedHson;
void invalidHson;
void invalidHtmlHson;
void invalidJsonHson;
declare const rootHsonString: RootHsonString;
void rootHsonString;

type PublicTypes = LiveTreeLifecycleResult | LiveMapCommit | LiveMapPathHandle | LiveMapDocumentIdentityHandle;
declare const publicTypes: PublicTypes;
void publicTypes;

declare const pathHandle: LiveMapPathHandle;
// @ts-expect-error LiveMap path handles have no public QUID identity.
void pathHandle.quid;

const publicDocumentMap = mapSubpath.fromHson(`<main/>`);
if (publicDocumentMap.mode === "element") {
  const documentAcquisitionIsPublic: "ensureIdentity" extends keyof typeof publicDocumentMap.document ? true : false = false;
  // @ts-expect-error Document locations have no approved projected binding observation capability.
  bindingTree.bind.text(publicDocumentMap.at([]));
  void documentAcquisitionIsPublic;
}
