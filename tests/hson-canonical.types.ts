import type { HsonNode } from "../src/core/types.js";
import { serialize_hson } from "../src/api/transform/serializers/serialize-hson.js";
import { hsonTransform } from "../src/api/transform/transform.facade.js";
import { hson } from "../src/hson.js";
import { HSON } from "../src/hson-authoring.js";
import type {
  HsonCanonical,
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

const direct: HsonCanonical = serialize_hson(node);
const normalized: HsonCanonical = hsonTransform.fromHson(arbitrary).toHson().serialize();
const directlyTagged: HsonCanonical = HSON`<main/>`;
const taggedNumber: HsonCanonical = HSON`${42}`;
const taggedString: HsonCanonical = HSON`${"42"}`;
const taggedBoolean: HsonCanonical = HSON`${true}`;
const taggedNull: HsonCanonical = HSON`${null}`;
const branded: HsonCanonical = normalized;
const repeated: HsonCanonical = hsonTransform.fromHson(branded).toHson().serialize();
const fluent: HsonCanonical = hsonTransform.fromNode(node).toHson().serialize();
const readable: HsonCanonical = hsonTransform.fromNode(node).toHson().serialize();
const compact: HsonCanonical = hsonTransform.fromNode(node).toHson().noBreak().serialize();
const withoutQuids: HsonCanonical = hsonTransform.fromNode(node).toHson().noQuid().serialize();
const html = hsonTransform.fromNode(node).toHtml().serialize();
const json = hsonTransform.fromNode(node).toJson().serialize();
const hsonHash: Promise<string> = hsonTransform.fromNode(node).toHson().sha256();
const htmlHash: Promise<string> = hsonTransform.fromNode(node).toHtml().sha256();
const jsonHash: Promise<string> = hsonTransform.fromNode(node).toJson().sha256();
const dynamicHash: Promise<string> = dynamicSerializer.sha256();

// @ts-expect-error Canonical graph terminals do not represent emitted bytes.
hsonTransform.fromNode(node).toNode().sha256();
const ordinary: string = direct;

// @ts-expect-error Ordinary calls are unsupported, including source arrays.
HSON(["<main/>"]);
// @ts-expect-error Template-like objects are not genuine tagged-template input.
HSON({ raw: ["<main/>"] });
// @ts-expect-error Ordinary source-string calls are unsupported.
HSON("<main/>");
// @ts-expect-error Ordinary source-string calls are unsupported.
HSON("37");
// @ts-expect-error Ordinary calls are unsupported.
HSON(42);
// @ts-expect-error Ordinary calls are unsupported.
HSON(true);
// @ts-expect-error Ordinary calls are unsupported.
HSON(null);
// @ts-expect-error Ordinary calls are unsupported.
HSON({});
// @ts-expect-error Tagged substitutions exclude undefined.
HSON`${undefined}`;
// @ts-expect-error Tagged substitutions exclude bigint.
HSON`${1n}`;
// @ts-expect-error Tagged substitutions exclude symbols.
HSON`${Symbol()}`;
// @ts-expect-error Tagged substitutions exclude objects.
HSON`${{}}`;
// @ts-expect-error Tagged substitutions exclude arrays.
HSON`${[]}`;
// @ts-expect-error Tagged substitutions exclude functions.
HSON`${() => {}}`;
// @ts-expect-error The Transform source-admission .string surface is removed.
hson.transform.string;
// @ts-expect-error The named Transform source-admission .string surface is removed.
hsonTransform.string;
// @ts-expect-error HSON finalizers serialize; they do not stringify.
hsonTransform.fromNode(node).toHson().string();

// @ts-expect-error Ordinary strings have no official-serializer provenance.
const invalid: HsonCanonical = arbitrary;
// @ts-expect-error HTML serialization does not carry HSON provenance.
const invalidHtml: HsonCanonical = html;
// @ts-expect-error JSON serialization does not carry HSON provenance.
const invalidJson: HsonCanonical = json;

function acceptsString(value: string): void {
  void value;
}

acceptsString(direct);
hsonTransform.fromHson(direct).toNode();
hsonTransform.fromHson(arbitrary).toNode();

type HsonCanonicalProducerReturnsExactlyHsonCanonical = Expect<
  Equal<typeof normalized, HsonCanonical>
>;
type CallableHsonReturnsExactlyHsonCanonical = Expect<
  Equal<ReturnType<typeof HSON>, HsonCanonical>
>;
type CallableHsonTaggedValuesArePrimitive = Expect<
  Equal<Parameters<typeof HSON>[1], string | number | boolean | null>
>;
type NoUnsafeHsonCast = Expect<
  Equal<"asHsonCanonical" extends keyof typeof hson ? true : false, false>
>;
type NoUnsafeHsonBrandHelper = Expect<
  Equal<"brandHson" extends keyof typeof hson ? true : false, false>
>;
type NoUnsafeHsonCanonicalHelper = Expect<
  Equal<"unsafeHsonCanonical" extends keyof typeof hson ? true : false, false>
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
void directlyTagged;
void taggedNumber;
void taggedString;
void taggedBoolean;
void taggedNull;
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
