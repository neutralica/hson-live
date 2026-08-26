import type { HsonNode } from "../src/core/types.js";
import { serialize_hson } from "../src/api/transform/serializers/serialize-hson.js";
import { hsonTransform } from "../src/api/transform/transform.facade.js";
import { hson } from "../src/hson.js";
import type {
  HsonString,
  TransformSerialize,
} from "../src/api/transform/transform.types.js";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;
type Expect<Value extends true> = Value;

declare const node: HsonNode;
declare const arbitrary: string;
declare const dynamicSerializer: TransformSerialize;

const direct: HsonString = serialize_hson(node);
const normalized = hson.transform.string(arbitrary);
const directlyNormalized: HsonString = hson(arbitrary);
const directlyTagged: HsonString = hson`<main/>`;
const taggedNumber: HsonString = hson`${42}`;
const taggedString: HsonString = hson`${"42"}`;
const taggedBoolean: HsonString = hson`${true}`;
const taggedNull: HsonString = hson`${null}`;
const branded: HsonString = normalized;
const repeated: HsonString = hson.transform.string(branded);
const directlyRepeated: HsonString = hson(directlyNormalized);
const bareString: HsonString = hson(`"value"`);
const bareNumber: HsonString = hson("42");
const bareBoolean: HsonString = hson("true");
const bareNull: HsonString = hson("null");
const fluent: HsonString = hsonTransform.fromNode(node).toHson().serialize();
const readable: HsonString = hsonTransform.fromNode(node).toHson().serialize();
const compact: HsonString = hsonTransform.fromNode(node).toHson().noBreak().serialize();
const withoutQuids: HsonString = hsonTransform.fromNode(node).toHson().noQuid().serialize();
const html = hsonTransform.fromNode(node).toHtml().serialize();
const json = hsonTransform.fromNode(node).toJson().serialize();
const hsonHash: Promise<string> = hsonTransform.fromNode(node).toHson().sha256();
const htmlHash: Promise<string> = hsonTransform.fromNode(node).toHtml().sha256();
const jsonHash: Promise<string> = hsonTransform.fromNode(node).toJson().sha256();
const dynamicHash: Promise<string> = dynamicSerializer.sha256();

// @ts-expect-error Canonical graph terminals do not represent emitted bytes.
hsonTransform.fromNode(node).toNode().sha256();
const ordinary: string = direct;

// @ts-expect-error Arrays are not ordinary HSON string inputs.
hson(["<main/>"]);
// @ts-expect-error Template-like objects are not ordinary HSON string inputs.
hson({ raw: ["<main/>"] });
// @ts-expect-error Ordinary calls admit source strings only.
hson(42);
// @ts-expect-error Ordinary calls admit source strings only.
hson(true);
// @ts-expect-error Ordinary calls admit source strings only.
hson(null);
// @ts-expect-error Ordinary calls admit source strings only.
hson({});
// @ts-expect-error Tagged substitutions exclude undefined.
hson`${undefined}`;
// @ts-expect-error Tagged substitutions exclude bigint.
hson`${1n}`;
// @ts-expect-error Tagged substitutions exclude symbols.
hson`${Symbol()}`;
// @ts-expect-error Tagged substitutions exclude objects.
hson`${{}}`;
// @ts-expect-error Tagged substitutions exclude arrays.
hson`${[]}`;
// @ts-expect-error Tagged substitutions exclude functions.
hson`${() => {}}`;
// @ts-expect-error Facade aliases retain the same input boundary.
hson.transform.string(["<main/>"]);
// @ts-expect-error Transform leaves remain ordinary source-call APIs.
hson.transform.string`<main/>`;
// @ts-expect-error Transform leaves remain ordinary source-call APIs.
hsonTransform.string`<main/>`;

// @ts-expect-error Ordinary strings have no official-serializer provenance.
const invalid: HsonString = arbitrary;
// @ts-expect-error HTML serialization does not carry HSON provenance.
const invalidHtml: HsonString = html;
// @ts-expect-error JSON serialization does not carry HSON provenance.
const invalidJson: HsonString = json;

function acceptsString(value: string): void {
  void value;
}

acceptsString(direct);
hsonTransform.fromHson(direct).toNode();
hsonTransform.fromHson(arbitrary).toNode();

type HsonStringProducerReturnsExactlyHsonString = Expect<
  Equal<typeof normalized, HsonString>
>;
type HsonStringProducerAcceptsOrdinaryString = Expect<
  Equal<Parameters<typeof hson.transform.string>[0], string>
>;
type CallableHsonReturnsExactlyHsonString = Expect<
  Equal<ReturnType<typeof hson>, HsonString>
>;
type CallableHsonTaggedValuesArePrimitive = Expect<
  Equal<Parameters<typeof hson>[1], string | number | boolean | null>
>;
type NoUnsafeHsonCast = Expect<
  Equal<"asHsonString" extends keyof typeof hson ? true : false, false>
>;
type NoUnsafeHsonBrandHelper = Expect<
  Equal<"brandHson" extends keyof typeof hson ? true : false, false>
>;
type NoUnsafeHsonStringHelper = Expect<
  Equal<"unsafeHsonString" extends keyof typeof hson ? true : false, false>
>;

type HtmlRemainsString = Expect<Equal<typeof html, string>>;
type JsonRemainsString = Expect<Equal<typeof json, string>>;
type DynamicRemainsString = Expect<
  Equal<ReturnType<typeof dynamicSerializer.serialize>, string>
>;
type ParserInputRemainsString = Expect<
  Equal<Parameters<typeof hsonTransform.fromHson>[0], string>
>;

void fluent;
void repeated;
void directlyRepeated;
void directlyTagged;
void taggedNumber;
void taggedString;
void taggedBoolean;
void taggedNull;
void bareString;
void bareNumber;
void bareBoolean;
void bareNull;
void readable;
void compact;
void withoutQuids;
void invalidHtml;
void invalidJson;
void ordinary;
void hsonHash;
void htmlHash;
void jsonHash;
void dynamicHash;
