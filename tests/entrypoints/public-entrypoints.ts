import { hson, hsonString } from "hson-live";
import {
  hsonString as transformHsonString,
  hsonTransform as transformSubpath,
  type HsonString,
  type TransformSerialize,
} from "hson-live/transform";
import type { HsonNode } from "hson-live/types";
// @ts-expect-error hson.string is a facade method, not a bare package export.
import { string as bareHsonString } from "hson-live";
// @ts-expect-error The private brand symbol is not a Transform export.
import type { HSON_STRING_BRAND } from "hson-live/transform";
// @ts-expect-error HsonString is intentionally not exported from the package root.
import type { HsonString as RootHsonString } from "hson-live";
import {
  hsonLiveTree as treeSubpath,
  LiveTree,
  type LiveTreeLifecycleResult,
} from "hson-live/livetree";
import {
  hsonLiveMap as mapSubpath,
  make_livemap_core,
  type LiveMapCommit,
  type LiveMapPathHandle,
} from "hson-live/livemap";
import { hsonLiveHost as hostSubpath } from "hson-live/livehost";
// @ts-expect-error LiveMap path-handle pseudo-QUID helpers were removed.
import { get_livemap_quid } from "hson-live";
// @ts-expect-error LiveMap path-handle pseudo-QUID helpers were removed.
import { ensure_livemap_quid } from "hson-live/livemap";

void hson;
void transformSubpath;
void mapSubpath;
void treeSubpath;
void hostSubpath;
void LiveTree;
void make_livemap_core;
void get_livemap_quid;
void ensure_livemap_quid;
void bareHsonString;

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;
type Expect<Value extends true> = Value;

declare const node: HsonNode;
declare const arbitrary: string;
declare const genericSerializer: TransformSerialize;

const inferredHsonText = transformSubpath.fromNode(node).toHson().serialize();
const inferredNormalizedHson = hson.string(arbitrary);
const inferredNamedHson = hsonString(arbitrary);
const inferredTransformNamedHson = transformHsonString(arbitrary);
const inferredHtmlText = transformSubpath.fromNode(node).toHtml().serialize();
const inferredJsonText = transformSubpath.fromNode(node).toJson().serialize();
const hsonText: HsonString = inferredHsonText;
const normalizedHson: HsonString = inferredNormalizedHson;
const namedNormalizedHson: HsonString = inferredNamedHson;
const transformNamedNormalizedHson: HsonString = inferredTransformNamedHson;
const repeatedNormalizedHson: HsonString = hson.string(normalizedHson);
const repeatedNamedNormalizedHson: HsonString = hsonString(namedNormalizedHson);
const readableHson: HsonString = transformSubpath.fromNode(node).toHson().serialize();
const compactHson: HsonString =
  transformSubpath.fromNode(node).toHson().noBreak().serialize();
const noQuidHson: HsonString =
  transformSubpath.fromNode(node).toHson().noQuid().serialize();
const ordinaryText: string = hsonText;

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
  Equal<Parameters<typeof hson.string>[0], string>
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

void readableHson;
void compactHson;
void noQuidHson;
void ordinaryText;
void repeatedNormalizedHson;
void transformNamedNormalizedHson;
void repeatedNamedNormalizedHson;
void invalidHson;
void invalidHtmlHson;
void invalidJsonHson;
declare const rootHsonString: RootHsonString;
void rootHsonString;

type PublicTypes = LiveTreeLifecycleResult | LiveMapCommit | LiveMapPathHandle;
declare const publicTypes: PublicTypes;
void publicTypes;

declare const pathHandle: LiveMapPathHandle;
// @ts-expect-error LiveMap path handles have no public QUID identity.
void pathHandle.quid;
