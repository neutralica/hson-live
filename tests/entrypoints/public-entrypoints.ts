import {
  hson,
  hsonCalc,
  hsonNumber,
  hsonString,
  type HsonNumber,
} from "hson-live";
import {
  hsonString as transformHsonString,
  hsonTransform as transformSubpath,
  type HsonString,
  type HsonNumber as TransformHsonNumber,
  type TransformSerialize,
} from "hson-live/transform";
import type { HsonNode, HsonSemanticPrimitive } from "hson-live/types";
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
  hsonLiveTree as treeSubpath,
  LiveTree,
  type LiveTreeLifecycleResult,
} from "hson-live/livetree";
// @ts-expect-error The obsolete construction engine is not a public export.
import { construct_tree } from "hson-live/livetree";
import {
  hsonLiveMap as mapSubpath,
  make_livemap_core,
  type LiveMapCommit,
  type LiveMapPathHandle,
} from "hson-live/livemap";
import { hsonLiveHost as hostSubpath } from "hson-live/livehost";
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

declare const node: HsonNode;
declare const arbitrary: string;
declare const arbitraryNumber: number;
declare const genericSerializer: TransformSerialize;

const inferredHsonText = transformSubpath.fromNode(node).toHson().serialize();
const inferredNormalizedHson = hson.transform.string(arbitrary);
const inferredNamedHson = hsonString(arbitrary);
const inferredTransformNamedHson = transformHsonString(arbitrary);
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
void transformNamedNormalizedHson;
void repeatedNamedNormalizedHson;
void invalidHson;
void invalidHtmlHson;
void invalidJsonHson;
// @ts-expect-error Candidate normalization belongs to hson.transform.
void hson.string;
// @ts-expect-error Numeric admission belongs to hson.transform.
void hson.number;
// @ts-expect-error Calculation admission belongs to hson.transform.
void hson.calc;
declare const rootHsonString: RootHsonString;
void rootHsonString;

type PublicTypes = LiveTreeLifecycleResult | LiveMapCommit | LiveMapPathHandle;
declare const publicTypes: PublicTypes;
void publicTypes;

declare const pathHandle: LiveMapPathHandle;
// @ts-expect-error LiveMap path handles have no public QUID identity.
void pathHandle.quid;
