import { ANY_DATA, ANY_DOCUMENT, Hson, HsonDataValue, hsonLiveMap, type HsonData, type HsonFromSchema, type HsonSchema, type JsonFromSchema } from "../src/index.js";
import type { HsonDataValue as NarrowValue } from "../src/hson-authoring.js";

declare const identityA: unique symbol;
declare const identityB: unique symbol;
declare const A: HsonSchema<{ readonly count: number }, "data", typeof identityA>;
declare const B: HsonSchema<{ readonly count: number }, "data", typeof identityB>;
const certified: HsonDataValue<typeof A> = A.certify({ count: 1 });
const retained: HsonDataValue<typeof A> = Hson.data.from(certified);
const narrow: NarrowValue<typeof A> = retained;
const projected: JsonFromSchema<typeof A> = certified.materialize();
const encoded: HsonData<typeof A> = certified.toHson();
const inferred: HsonFromSchema<typeof A> = encoded;
const source: HsonData = Hson.data`<count 1>`;
const parsed: HsonDataValue = Hson.data.parse(source);
const taggedParsed: HsonDataValue = Hson.data.parse`<count ${1}>`;
// @ts-expect-error Exact parsing requires HSON text, never native objects.
Hson.data.parse({ count: 1 });
// @ts-expect-error Source parsing does not authenticate an erased Schema assertion.
const parsedProof: HsonDataValue<typeof A> = Hson.data.parse(encoded);
const sourceMap = hsonLiveMap.fromLibraries({ state: { hson: source, schema: A } });
sourceMap.data.state.snap() satisfies JsonFromSchema<typeof A>;
// @ts-expect-error Recognizable HSON source selects the hson channel, not semantic json.
hsonLiveMap.fromLibraries({ state: { json: source } });
// @ts-expect-error Branded variables retain the representation restriction.
sourceMap.addLibraries({ next: { json: encoded } });
// @ts-expect-error Authored document source is also HSON text.
hsonLiveMap.fromLibraries({ state: { json: Hson.document`<p/>` } });
// Native records retain semantic member values, including authored text strings.
hsonLiveMap.fromLibraries({ state: { json: { source } } });
hsonLiveMap.fromLibraries({ state: { json: [source] } });
// @ts-expect-error Hosted construction shares the representation restriction.
hsonLiveMap.locus.create({ state: { json: source } });
// @ts-expect-error Durable construction shares the representation restriction.
hsonLiveMap.locus.resume({ state: { json: source } }, { logicalMapId: "representation", persistence: {} as never });
// @ts-expect-error Client-local initializers share the representation restriction.
hsonLiveMap.locus.create({}, { local: [{ name: "seed", initializer: { json: source } }] });
const brandedLocus = hsonLiveMap.locus.create({ state: { hson: source } });
// @ts-expect-error Asynchronous admission shares the representation restriction.
brandedLocus.admit({ next: { json: source } });
const widenedSource: string = source;
hsonLiveMap.fromLibraries({ state: { json: widenedSource } }); // Erased evidence is not a universal static guarantee.
hsonLiveMap.fromLibraries({ state: { json: "<count 1>" } });
// @ts-expect-error Both channels are forbidden, including present undefined in either optional-property mode.
hsonLiveMap.fromLibraries({ state: { json: true, hson: undefined } });
// @ts-expect-error Both channels are forbidden, including present undefined in either optional-property mode.
hsonLiveMap.fromLibraries({ state: { json: undefined, hson: "true" } });
// @ts-expect-error A Data definition must select a channel.
hsonLiveMap.fromLibraries({ state: { schema: A } });
// @ts-expect-error The former Library data field is not a compatibility alias.
hsonLiveMap.fromLibraries({ state: { data: { count: 1 }, schema: A } });
// @ts-expect-error Identical shapes do not erase Schema definition identity.
const wrong: HsonDataValue<typeof B> = certified;
// @ts-expect-error An uncertified nominal value cannot fabricate Schema proof.
const unproven: HsonDataValue<typeof A> = Hson.data.from({ count: 1 });
// @ts-expect-error Serialized Hson is text, not an authenticated Data value.
const textIsValue: HsonDataValue = encoded;
// @ts-expect-error A structural copy has no nominal authority.
const forged: HsonDataValue = { ...certified };
// @ts-expect-error Construction is private.
new HsonDataValue();
// @ts-expect-error The obsolete Data admission member is removed.
Hson.data.fromHson(encoded);
// @ts-expect-error Carrier objects are excluded from primitive template substitution.
Hson.data`${certified}`;
// @ts-expect-error Document certification remains source-oriented.
ANY_DOCUMENT.certify(certified);
Hson.data`${certified.toHson()}`;
ANY_DATA.certify("42"); Hson.data.fromSource('{"count":1}');
// @ts-expect-error Unsupported JavaScript instances are not a broad object alternative.
Hson.data.from(new Date());
// @ts-expect-error Functions are not Data values.
Hson.data.from(() => 1);
// @ts-expect-error Undefined is not Data.
Hson.data.from(undefined);
// @ts-expect-error Nested carriers require explicit materialization.
Hson.data.from({ nested: certified });
const map = hsonLiveMap.fromLibraries({ state: { json: certified, schema: A }, parts: { parts: { p: { kind: "document", document: '<p hson:part data:x="%{x}" "^{x}"/>' } } } });
map.data.state.at([]).replace(certified);
map.parts.parts.p.write({ x: certified });
// @ts-expect-error Part inputs do not accept arbitrary object instances.
map.parts.parts.p.write({ x: new Date() });
// @ts-expect-error Library inputs do not accept arbitrary object instances.
hsonLiveMap.fromLibraries({ state: { json: new Date() } });
const locus = hsonLiveMap.locus.create({}, { actions: { forward(_context, payload, message) {
  const input: HsonDataValue | undefined = payload;
  const request: HsonDataValue | undefined = message.payload;
  return request ?? input;
} } });
const acknowledgment = await locus.dispatchAction({ type: "action", id: "value", name: "forward", payload: certified });
if (acknowledgment.type === "ack") { const output: HsonDataValue | undefined = acknowledgment.result; void output; }
void projected; void encoded; void narrow; void inferred; void wrong; void unproven; void textIsValue; void forged;

// Carrier evidence is semantic, never the physical wrapper's object shape.
import { Hson as DedicatedHson, ANY_DATA as DedicatedAny } from "../src/hson-authoring.js";
import type { JsonValue } from "../src/core/types.js";
type EqualData<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type CheckData<T extends true> = T;
const unknownRoots = hsonLiveMap.fromLibraries({
  nil: { json: Hson.data.from(null) }, text: { json: DedicatedHson.data.from("42") },
  number: { json: Hson.data.from(42) }, boolean: { json: Hson.data.from(true) },
  array: { json: Hson.data.from([1]) }, object: { json: Hson.data.from({ x: 1 }) },
});
const unknownSnapshot = unknownRoots.data.nil.snap();
type UnknownRoot = CheckData<EqualData<typeof unknownSnapshot, JsonValue>>;
// @ts-expect-error An unqualified carrier cannot establish object-root certainty.
const objectRoot: Readonly<Record<string, JsonValue>> = unknownRoots.data.nil.snap();
declare const typedNull: HsonDataValue<HsonSchema<null, "data">>;
declare const typedArray: HsonDataValue<HsonSchema<readonly number[], "data">>;
const knownRoots = hsonLiveMap.fromLibraries({ nil: { json: typedNull }, array: { json: typedArray }, governed: { json: certified, schema: A } });
knownRoots.data.nil.snap() satisfies JsonValue;
knownRoots.data.array.snap() satisfies readonly JsonValue[];
knownRoots.data.governed.snap() satisfies { readonly count: number };
const opaque: object = new Date();
// @ts-expect-error Opaque object supplies no structural Data evidence.
Hson.data.from(opaque);
// @ts-expect-error Dedicated factory has the same constraint.
DedicatedHson.data.from(opaque);
// @ts-expect-error Certification cannot validate an opaque static shape.
ANY_DATA.certify(opaque);
// @ts-expect-error Dedicated certification has the same constraint.
DedicatedAny.certify(opaque);
// @ts-expect-error Part Data arguments require structural evidence.
map.parts.parts.p.write({ x: opaque });
interface SupportedData { readonly count: number; readonly optional?: string; }
declare const supported: SupportedData;
declare const supportedUnion: SupportedData | readonly SupportedData[] | string | null;
Hson.data.from(supported); DedicatedHson.data.from(supportedUnion);
ANY_DATA.certify(supportedUnion); DedicatedAny.certify(supported);
map.parts.parts.p.write({ x: supportedUnion });

declare const typedString: HsonDataValue<HsonSchema<string, "data">>;
declare const typedNumber: HsonDataValue<HsonSchema<number, "data">>;
declare const typedBoolean: HsonDataValue<HsonSchema<boolean, "data">>;
declare const typedObject: HsonDataValue<HsonSchema<{ readonly x: number }, "data">>;
const semanticRoots = hsonLiveMap.fromLibraries({ text: { json: typedString }, num: { json: typedNumber }, bool: { json: typedBoolean }, obj: { json: typedObject } });
semanticRoots.data.text.snap() satisfies JsonValue;
semanticRoots.data.num.snap() satisfies JsonValue;
semanticRoots.data.bool.snap() satisfies JsonValue;
semanticRoots.data.obj.snap() satisfies Readonly<Record<string, JsonValue>>;
// @ts-expect-error A seed certificate does not install a governing Schema.
semanticRoots.data.obj.snap() satisfies { readonly x: number };
