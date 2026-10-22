import { ANY_DATA, ANY_DOCUMENT, Hson, type HsonData, type HsonDocument, type HsonCanonical, type HsonSchema } from "hson-live/hson";
import type { HsonCanonical as TransformCanonical } from "hson-live/transform";
import type { HsonAuthored as TransformAuthored } from "hson-live/transform";
import type { HsonAuthored } from "hson-live/hson";

declare const schema: HsonSchema;
const authored: HsonCanonical = Hson.canonical`<age 37>`;
const sameBrand: TransformCanonical = authored;
const checked: HsonCanonical = schema.certify(sameBrand);
const exact: HsonData = Hson.data.fromHson(authored);
const document: HsonDocument = Hson.document.fromHson(Hson.canonical`<main/>`);
// @ts-expect-error Runtime text must first cross an explicit HsonCanonical boundary.
Hson.document.fromHson("<main/>");
const materialized = Hson.data.materialize(exact);
// @ts-expect-error Canonical authoring does not expose aggregate subsystems.
Hson.liveTree;
// @ts-expect-error Arbitrary source text is not canonical input.
schema.certify("<age 37>");
void checked;
void materialized;
void Hson.document.toNode(document);

const plain = Hson.document`<main/>`;
const named = Hson.document`<main @:main/>`;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
type AuthoringTypes = [Expect<Equal<typeof plain, HsonAuthored>>, Expect<Equal<typeof named, HsonAuthored>>,
  Expect<Equal<TransformAuthored, HsonAuthored>>];
const primitive: string = named;
const canonicalDocument: HsonCanonical = document;
// @ts-expect-error Authored source never claims canonical qualification, even without QUADs.
const falseCanonical: HsonCanonical = plain;
// @ts-expect-error Authored source is not a canonical document.
const falseDocument: HsonDocument = named;
// @ts-expect-error Canonical-only helper requires qualification first.
Hson.document.toNode(plain);
// @ts-expect-error Canonical-only helper cannot consume authored declarations.
Hson.document.fromHson(named);
// @ts-expect-error The authored brand is distinct in both directions.
const falseAuthored: HsonAuthored = document;
void primitive; void canonicalDocument;

const certifiedAuthored: HsonDocument = ANY_DOCUMENT.certify(plain);
const partial: HsonAuthored = Hson.document`<a href="/slides/${2}" title="Slide ${2} of ${3}"/>`;
const partialData: HsonData = Hson.data`<label "Slide ${2} of ${3}">`;
const partialCanonical: HsonCanonical = Hson.canonical`"${true}:${null}:${-0}"`;
// @ts-expect-error Partial interpolation still produces authored Document source.
const partialUncertified: HsonDocument = partial;
void ANY_DOCUMENT.certify(partial); void partialData; void partialCanonical;
// @ts-expect-error Data certification does not accept authored documents.
ANY_DATA.certify(plain);
void certifiedAuthored;
