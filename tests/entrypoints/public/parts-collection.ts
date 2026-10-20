import { ANY_DATA, Hson, type HsonAuthored, type HsonSchema } from "hson-live/hson";
import { hsonLiveMap, type LiveMapPartCollection, type LiveMapDocumentPart,
  type LiveMapPartsLibraryInput, type LiveMapLibraryDefinition } from "hson-live/livemap";
import type { LocusLibraryDefinition } from "hson-live/locus";

const document: HsonAuthored = Hson.document`<h1 "%{title}"/>`;
const parts = { header: { kind: "document", document, css: "h1{color:red}" } } satisfies LiveMapPartCollection;
const definition = { parts } satisfies LiveMapLibraryDefinition;
const catalog = { ...definition } as const satisfies LocusLibraryDefinition;
const map = hsonLiveMap.fromLibraries({ parts: definition });
const part: LiveMapDocumentPart | undefined = map.parts.must("parts").at(["header"]).snap();
const text: string | undefined = map.parts.must("parts").at(["header", "document"]).snap();
const kind: "document" | undefined = map.parts.must("parts").at(["header", "kind"]).snap();
const css: string | undefined = map.parts.must("parts").at(["header", "css"]).snap();
map.parts.must("parts").at(["new"]).set({ kind: "document", document: "<p/>" });
map.batch(writer => { writer.parts.must("parts").at(["header", "document"]).set("<h2/>"); });
map.cut({ data: ["parts"] });
// @ts-expect-error Parts are data Libraries, not document Libraries.
map.cut({ documents: ["parts"] });
// @ts-expect-error Data Libraries have no document QUAD lookup.
map.parts.must("parts").q("header");
// @ts-expect-error The contract's kind is fixed.
map.parts.must("parts").at(["header", "kind"]).set("data");
// @ts-expect-error Part documents must be strings.
map.parts.must("parts").at(["header", "document"]).set(1);
// @ts-expect-error Staged writes retain Part field types.
map.batch(writer => { writer.parts.must("parts").at(["header", "document"]).set(1); });
const locus = hsonLiveMap.locus.create({ parts: catalog });
const locusText: string | undefined = locus.parts.must("parts").at(["header", "document"]).snap();
void locus.parts.must("parts").at(["header", "document"]).set("<h3/>");
void locus.stage(writer => { writer.parts.must("parts").at(["header", "document"]).set("<h4/>"); });
// @ts-expect-error Locus retains the Part contract's fixed kind.
void locus.parts.must("parts").at(["header", "kind"]).set("data");
void locus.admit({ "later": { ...definition, access: "shared" } });
hsonLiveMap.create().addLibraries({ later: definition });

declare const schema: HsonSchema<{ header: { kind: "document"; document: string } }, "data">;
const explicit: LiveMapPartsLibraryInput = { parts };
const governed = hsonLiveMap.fromLibraries({ parts: explicit });
const schemaValue: LiveMapPartCollection = governed.parts.must("parts").snap();
const schemaHandle: HsonSchema<unknown, "data"> = governed.parts.must("parts").schema.get();
const typedLocus = hsonLiveMap.locus.create({ "parts": { ...explicit, access: "private" } });
const locusValue: LiveMapPartCollection = typedLocus.parts.must("parts").snap();
// @ts-expect-error A definition cannot select two families.
const mixed: LiveMapLibraryDefinition = { parts, data: {} };
// @ts-expect-error A document definition cannot also select Parts.
const mixedDocument: LiveMapLibraryDefinition = { parts, document: "<p/>" };
// @ts-expect-error Unsupported Part kind.
const invalidKind: LiveMapPartCollection = { bad: { kind: "data", document: "<p/>" } };
// @ts-expect-error Part CSS is raw text.
const invalidCss: LiveMapDocumentPart = { kind: "document", document, css: {} };
// @ts-expect-error A Part member does not admit Schema.
const memberSchema: LiveMapDocumentPart = { kind: "document", document, schema };
// @ts-expect-error The internal validation marker is not public admission syntax.
const marker: LiveMapLibraryDefinition = { data: parts, validation: "hson-part-collection-v1" };
void [part, text, kind, css, locusText, schemaValue, schemaHandle, locusValue,
  mixed, mixedDocument, invalidKind, invalidCss, memberSchema, marker];

// These checks also run through the Worker entrypoint's import of this fixture.
// Exercise inference directly: a fresh standalone Part annotation is insufficient.
// @ts-expect-error Part members cannot select a Schema through constructor inference.
hsonLiveMap.fromLibraries({ parts: { parts: { p: { kind: "document", document: "<p/>", schema: {} } } } });
// @ts-expect-error Initial Locus inference must reject the same member-level field.
hsonLiveMap.locus.create({ "parts": { parts: { p: { kind: "document", document: "<p/>", schema: {} } }, access: "private" } });

const validPart = { kind: "document", document, css: "" } as const;
const invalidPart = { ...validPart, schema: {} };
const invalidParts = { header: invalidPart };
const copiedInvalidParts = { ...invalidParts };
// @ts-expect-error Reused inferred members must not bypass Part admission.
hsonLiveMap.fromLibraries({ parts: { parts: invalidParts } });
// @ts-expect-error Spreading a collection must preserve the forbidden field.
hsonLiveMap.fromLibraries({ parts: { parts: copiedInvalidParts } });
// @ts-expect-error Reused values must also reject through initial Locus admission.
hsonLiveMap.locus.create({ "parts": { parts: invalidParts, access: "private" } });
// @ts-expect-error Explicit collection annotations must reject reused members.
const invalidCollection: LiveMapPartCollection = invalidParts;
// @ts-expect-error Explicit Part annotations must reject reused members.
const invalidDefinition: LiveMapDocumentPart = invalidPart;
// @ts-expect-error Dynamic admission retains the public Part contract.
map.addLibraries({ later: { parts: invalidParts } });
// @ts-expect-error Dynamic Locus admission retains the public Part contract.
void locus.admit({ "later": { parts: invalidParts, access: "private" } });

const validCollection: LiveMapPartCollection = { header: validPart, plain: { kind: "document", document }, schema: validPart };
hsonLiveMap.fromLibraries({ parts: { parts: validCollection } });
hsonLiveMap.locus.create({ "parts": { parts: validCollection, access: "private" } });
map.parts.must("parts").at(["header"]).set(validPart);
map.parts.must("parts").at(["header"]).replace(validPart);
map.parts.must("parts").at([]).replace(validCollection);
map.parts.must("parts").at([]).asObject()?.object.setKey("header", validPart);
map.batch(writer => { writer.parts.must("parts").at(["header"]).set(validPart); });
void locus.parts.must("parts").at(["header"]).replace(validPart);
void locus.stage(writer => { writer.parts.must("parts").at(["header"]).replace(validPart); });
// @ts-expect-error Direct member patches retain the forbidden field through write projection.
map.parts.must("parts").at(["header"]).set(invalidPart);
// @ts-expect-error Direct member replacement retains the forbidden field.
map.parts.must("parts").at(["header"]).replace(invalidPart);
// @ts-expect-error Complete collection replacement cannot hide an invalid member.
map.parts.must("parts").at([]).replace(invalidParts);
// Indexed collection-root patches retain the existing generic JSON proposal type;
// member writes and complete replacements retain the Part definition type.
// @ts-expect-error Collection object helpers retain Part member write types.
map.parts.must("parts").at([]).asObject()?.object.setKey("header", invalidPart);
// @ts-expect-error Staged member patches retain the forbidden field.
map.batch(writer => { writer.parts.must("parts").at(["header"]).set(invalidPart); });
// @ts-expect-error Staged collection replacement retains the forbidden field.
map.batch(writer => { writer.parts.must("parts").at([]).replace(invalidParts); });
// @ts-expect-error Direct governed Locus writes reject reused invalid members.
void locus.parts.must("parts").at(["header"]).set(invalidPart);
// @ts-expect-error Staged governed Locus writes reject reused invalid members.
void locus.stage(writer => { writer.parts.must("parts").at(["header"]).replace(invalidPart); });

const detachedParts = map.parts.must("parts").snap();
const copiedParts: LiveMapPartCollection = { ...detachedParts };
hsonLiveMap.fromLibraries({ parts: { parts: copiedParts } });
const invalidSnapshotParts = { ...detachedParts, header: invalidPart };
// @ts-expect-error Detached collection snapshots retain the member prohibition.
hsonLiveMap.fromLibraries({ parts: { parts: invalidSnapshotParts } });
// @ts-expect-error Copied typed collections retain the member prohibition.
const invalidCopy: LiveMapPartCollection = { ...copiedParts, header: invalidPart };

// Intrinsic Parts writes and ordinary data fields named schema remain supported.
const schemaPart = { kind: "document", document } as const;
governed.parts.must("parts").at(["header"]).set(schemaPart);
governed.batch(writer => { writer.parts.must("parts").at(["header"]).replace(schemaPart); });
void typedLocus.parts.must("parts").at(["header"]).set(schemaPart);
void typedLocus.stage(writer => { writer.parts.must("parts").at(["header"]).replace(schemaPart); });
const ordinary = hsonLiveMap.fromLibraries({ data: { data: invalidParts } });
ordinary.data.must("data").at([]).set(invalidParts);
ordinary.batch(writer => { writer.data.must("data").at([]).replace(invalidParts); });
void [invalidCollection, invalidDefinition, invalidCopy];

// Former supplemental-Schema positives are now explicit admission negatives.
// These execute as type checks in both exact-optional public and non-exact Worker configurations.
const supplemental = { parts, schema };
const topSupplemental = { parts, schema: ANY_DATA };
// @ts-expect-error Parts-specific definitions prohibit supplemental Schema.
const rejectedInput: LiveMapPartsLibraryInput = supplemental;
// @ts-expect-error Reused definitions cannot hide supplemental Schema.
const rejectedDefinition: LiveMapLibraryDefinition = supplemental;
// @ts-expect-error Constructor inference must reject even the family-top Schema.
hsonLiveMap.fromLibraries({ parts: { parts, schema: ANY_DATA } });
// @ts-expect-error Reused family-top evidence is also unsupported.
hsonLiveMap.fromLibraries({ parts: topSupplemental });
// @ts-expect-error Locus initial inference must reject supplemental Schema.
hsonLiveMap.locus.create({ "parts": { ...supplemental, access: "private" } });
// @ts-expect-error Shared Locus admission has the same contract.
hsonLiveMap.locus.create({ "parts": { ...topSupplemental, access: "shared" } });
// @ts-expect-error Dynamic LiveMap admission cannot bypass the prohibition.
map.addLibraries({ later: supplemental });
// @ts-expect-error Dynamic Locus admission cannot bypass the prohibition.
void locus.admit({ "later": { ...topSupplemental, access: "private" } });
void [rejectedInput, rejectedDefinition];

// @ts-expect-error Supplemental Parts Schema is unsupported regardless of its evidence shape.
hsonLiveMap.fromLibraries({ parts: { parts, schema: schema } });
declare const narrowSchema: HsonSchema<{ header: {
  kind: "document"; document: string; css?: "h1{color:red}";
} }, "data">;
// @ts-expect-error Supplemental Parts Schema is unsupported regardless of its evidence shape.
hsonLiveMap.fromLibraries({ parts: { parts, schema: narrowSchema } });
declare const conflictingSchema: HsonSchema<{ header: { kind: "data"; document: string } }, "data">;
// @ts-expect-error Supplemental Parts Schema is unsupported regardless of its evidence shape.
hsonLiveMap.fromLibraries({ parts: { parts, schema: conflictingSchema } });
declare const scalarSchema: HsonSchema<number, "data">;
// @ts-expect-error Supplemental Parts Schema is unsupported regardless of its evidence shape.
hsonLiveMap.fromLibraries({ parts: { parts, schema: scalarSchema } });
declare const arraySchema: HsonSchema<readonly LiveMapDocumentPart[], "data">;
// @ts-expect-error Supplemental Parts Schema is unsupported regardless of its evidence shape.
hsonLiveMap.fromLibraries({ parts: { parts, schema: arraySchema } });
declare const emptyEvidenceSchema: HsonSchema<{}, "data">;
// @ts-expect-error Supplemental Parts Schema is unsupported regardless of its evidence shape.
hsonLiveMap.fromLibraries({ parts: { parts, schema: emptyEvidenceSchema } });
declare const arrayMemberSchema: HsonSchema<{ p: string[] }, "data">;
// @ts-expect-error Supplemental Parts Schema is unsupported regardless of its evidence shape.
hsonLiveMap.fromLibraries({ parts: { parts, schema: arrayMemberSchema } });
declare const impossibleMemberSchema: HsonSchema<{
  scalar: number;
  tuple: readonly [string];
  document: { document: number };
  extra: { extra: string };
  schema: { schema: {} };
  callable: () => void;
}, "data">;
// @ts-expect-error Supplemental Parts Schema is unsupported regardless of its evidence shape.
hsonLiveMap.fromLibraries({ parts: { parts, schema: impossibleMemberSchema } });
declare const optionalSchema: HsonSchema<{
  readonly p?: { readonly document?: string; readonly css?: "h1{color:red}"; extra?: string };
}, "data">;
// @ts-expect-error Supplemental Parts Schema is unsupported regardless of its evidence shape.
hsonLiveMap.fromLibraries({ parts: { parts, schema: optionalSchema } });
declare const indexedSchema: HsonSchema<Readonly<Record<string, { document: string; css?: "h1{color:red}" }>>, "data">;
// @ts-expect-error Supplemental Parts Schema is unsupported regardless of its evidence shape.
hsonLiveMap.fromLibraries({ parts: { parts, schema: indexedSchema } });
declare const numericSchema: HsonSchema<Readonly<Record<number, LiveMapDocumentPart>>, "data">;
// @ts-expect-error Supplemental Parts Schema is unsupported regardless of its evidence shape.
hsonLiveMap.fromLibraries({ parts: { parts, schema: numericSchema } });
declare const numericNameSchema: HsonSchema<{ readonly 0: { document: string } }, "data">;
// @ts-expect-error Supplemental Parts Schema is unsupported regardless of its evidence shape.
hsonLiveMap.fromLibraries({ parts: { parts, schema: numericNameSchema } });
declare const unionSchema: HsonSchema<{
  p: { document: string; css?: "h1{color:red}" } | number | string[] | readonly [string];
} | number | readonly string[], "data">;
// @ts-expect-error Supplemental Parts Schema is unsupported regardless of its evidence shape.
hsonLiveMap.fromLibraries({ parts: { parts, schema: unionSchema } });
declare const unknownSchema: HsonSchema<unknown, "data">;
// @ts-expect-error Supplemental Parts Schema is unsupported regardless of its evidence shape.
hsonLiveMap.fromLibraries({ parts: { parts, schema: unknownSchema } });
declare const neverSchema: HsonSchema<never, "data">;
// @ts-expect-error Supplemental Parts Schema is unsupported regardless of its evidence shape.
hsonLiveMap.fromLibraries({ parts: { parts, schema: neverSchema } });
declare const memberIndexSchema: HsonSchema<{ p: Readonly<Record<string, string>> }, "data">;
// @ts-expect-error Supplemental Parts Schema is unsupported regardless of its evidence shape.
hsonLiveMap.fromLibraries({ parts: { parts, schema: memberIndexSchema } });
declare const impossibleIndexSchema: HsonSchema<{ p: Record<string, number> }, "data">;
// @ts-expect-error Supplemental Parts Schema is unsupported regardless of its evidence shape.
hsonLiveMap.fromLibraries({ parts: { parts, schema: impossibleIndexSchema } });
declare const optionalImpossibleSchema: HsonSchema<{ readonly p?: string[] | number }, "data">;
// @ts-expect-error Supplemental Parts Schema is unsupported regardless of its evidence shape.
hsonLiveMap.fromLibraries({ parts: { parts, schema: optionalImpossibleSchema } });
declare const optionalFieldSchema: HsonSchema<{
  badDocument: { document?: number };
  cssAbsent: { css?: number };
}, "data">;
// @ts-expect-error Supplemental Parts Schema is unsupported regardless of its evidence shape.
hsonLiveMap.fromLibraries({ parts: { parts, schema: optionalFieldSchema } });
declare const partialIndexSchema: HsonSchema<Readonly<Partial<Record<string, { document: string }>>>, "data">;
// @ts-expect-error Supplemental Parts Schema is unsupported regardless of its evidence shape.
hsonLiveMap.fromLibraries({ parts: { parts, schema: partialIndexSchema } });
declare const mixedIndexSchema: HsonSchema<{
  readonly [name: string]: { document: string };
  readonly header: { document: string; css: "h1{color:red}" };
}, "data">;
// @ts-expect-error Supplemental Parts Schema is unsupported regardless of its evidence shape.
hsonLiveMap.fromLibraries({ parts: { parts, schema: mixedIndexSchema } });
declare const memberIndexConflictSchema: HsonSchema<{ p: {
  [field: string]: unknown;
  extra: string;
} }, "data">;
// @ts-expect-error Supplemental Parts Schema is unsupported regardless of its evidence shape.
hsonLiveMap.fromLibraries({ parts: { parts, schema: memberIndexConflictSchema } });

// Intrinsic collection writes need no Schema evidence or initial named members.
const emptyMap = hsonLiveMap.fromLibraries({ parts: { parts: {} } });
const emptyLocus = hsonLiveMap.locus.create({ "parts": { parts: {}, access: "private" } });
const complete = { header: validPart, plain: schemaPart };
const badKind = { ...validPart, kind: "data" } as const;
const badDocument = { ...validPart, document: 1 };
const badCss = { ...validPart, css: 1 };
const additionalInvalidMember = { ...complete, extra: badDocument };
const arrayRoot = [validPart];

// Direct LiveMap writes preserve the intrinsic contract.
emptyMap.parts.must("parts").at([]).replace({});
emptyMap.parts.must("parts").at([]).replace(complete);
emptyMap.parts.must("parts").at([]).replace(validCollection);
emptyMap.parts.must("parts").at([]).replace(detachedParts);
// @ts-expect-error Complete replacement requires only valid Part members in a string-keyed collection.
emptyMap.parts.must("parts").at([]).replace(1);
// @ts-expect-error Complete replacement requires only valid Part members in a string-keyed collection.
emptyMap.parts.must("parts").at([]).replace(arrayRoot);
// @ts-expect-error Complete replacement requires only valid Part members in a string-keyed collection.
emptyMap.parts.must("parts").at([]).replace(additionalInvalidMember);
// @ts-expect-error Complete replacement requires only valid Part members in a string-keyed collection.
emptyMap.parts.must("parts").at([]).replace(invalidParts);
emptyMap.parts.must("parts").at(["header"]).replace(validPart);
// @ts-expect-error Member writes retain forbidden Schema and intrinsic field constraints.
emptyMap.parts.must("parts").at(["header"]).replace(invalidPart);
// @ts-expect-error Member writes retain forbidden Schema and intrinsic field constraints.
emptyMap.parts.must("parts").at(["header"]).replace(badKind);
// @ts-expect-error Member writes retain forbidden Schema and intrinsic field constraints.
emptyMap.parts.must("parts").at(["header"]).replace(badDocument);
// @ts-expect-error Member writes retain forbidden Schema and intrinsic field constraints.
emptyMap.parts.must("parts").at(["header"]).replace(badCss);
emptyMap.parts.must("parts").at(["header"]).set(validPart);
// @ts-expect-error Member writes retain forbidden Schema and intrinsic field constraints.
emptyMap.parts.must("parts").at(["header"]).set(invalidPart);
// @ts-expect-error Member writes retain forbidden Schema and intrinsic field constraints.
emptyMap.parts.must("parts").at(["header"]).set(badKind);
// @ts-expect-error Member writes retain forbidden Schema and intrinsic field constraints.
emptyMap.parts.must("parts").at(["header"]).set(badDocument);
// @ts-expect-error Member writes retain forbidden Schema and intrinsic field constraints.
emptyMap.parts.must("parts").at(["header"]).set(badCss);
emptyMap.parts.must("parts").at(["header"]).set({ css: "p{color:blue}" });

// emptyMap.batch writes preserve the intrinsic contract.
emptyMap.batch(writer => { writer.parts.must("parts").at([]).replace({}); });
emptyMap.batch(writer => { writer.parts.must("parts").at([]).replace(complete); });
emptyMap.batch(writer => { writer.parts.must("parts").at([]).replace(validCollection); });
emptyMap.batch(writer => { writer.parts.must("parts").at([]).replace(detachedParts); });
// @ts-expect-error Complete replacement requires only valid Part members in a string-keyed collection.
emptyMap.batch(writer => { writer.parts.must("parts").at([]).replace(1); });
// @ts-expect-error Complete replacement requires only valid Part members in a string-keyed collection.
emptyMap.batch(writer => { writer.parts.must("parts").at([]).replace(arrayRoot); });
// @ts-expect-error Complete replacement requires only valid Part members in a string-keyed collection.
emptyMap.batch(writer => { writer.parts.must("parts").at([]).replace(additionalInvalidMember); });
// @ts-expect-error Complete replacement requires only valid Part members in a string-keyed collection.
emptyMap.batch(writer => { writer.parts.must("parts").at([]).replace(invalidParts); });
emptyMap.batch(writer => { writer.parts.must("parts").at(["header"]).replace(validPart); });
// @ts-expect-error Member writes retain forbidden Schema and intrinsic field constraints.
emptyMap.batch(writer => { writer.parts.must("parts").at(["header"]).replace(invalidPart); });
// @ts-expect-error Member writes retain forbidden Schema and intrinsic field constraints.
emptyMap.batch(writer => { writer.parts.must("parts").at(["header"]).replace(badKind); });
// @ts-expect-error Member writes retain forbidden Schema and intrinsic field constraints.
emptyMap.batch(writer => { writer.parts.must("parts").at(["header"]).replace(badDocument); });
// @ts-expect-error Member writes retain forbidden Schema and intrinsic field constraints.
emptyMap.batch(writer => { writer.parts.must("parts").at(["header"]).replace(badCss); });
emptyMap.batch(writer => { writer.parts.must("parts").at(["header"]).set(validPart); });
// @ts-expect-error Member writes retain forbidden Schema and intrinsic field constraints.
emptyMap.batch(writer => { writer.parts.must("parts").at(["header"]).set(invalidPart); });
// @ts-expect-error Member writes retain forbidden Schema and intrinsic field constraints.
emptyMap.batch(writer => { writer.parts.must("parts").at(["header"]).set(badKind); });
// @ts-expect-error Member writes retain forbidden Schema and intrinsic field constraints.
emptyMap.batch(writer => { writer.parts.must("parts").at(["header"]).set(badDocument); });
// @ts-expect-error Member writes retain forbidden Schema and intrinsic field constraints.
emptyMap.batch(writer => { writer.parts.must("parts").at(["header"]).set(badCss); });
emptyMap.batch(writer => { writer.parts.must("parts").at(["header"]).set({ css: "p{color:blue}" }); });

// directLocus writes preserve the intrinsic contract.
void emptyLocus.parts.must("parts").at([]).replace({});
void emptyLocus.parts.must("parts").at([]).replace(complete);
void emptyLocus.parts.must("parts").at([]).replace(validCollection);
void emptyLocus.parts.must("parts").at([]).replace(detachedParts);
// @ts-expect-error Complete replacement requires only valid Part members in a string-keyed collection.
void emptyLocus.parts.must("parts").at([]).replace(1);
// @ts-expect-error Complete replacement requires only valid Part members in a string-keyed collection.
void emptyLocus.parts.must("parts").at([]).replace(arrayRoot);
// @ts-expect-error Complete replacement requires only valid Part members in a string-keyed collection.
void emptyLocus.parts.must("parts").at([]).replace(additionalInvalidMember);
// @ts-expect-error Complete replacement requires only valid Part members in a string-keyed collection.
void emptyLocus.parts.must("parts").at([]).replace(invalidParts);
void emptyLocus.parts.must("parts").at(["header"]).replace(validPart);
// @ts-expect-error Member writes retain forbidden Schema and intrinsic field constraints.
void emptyLocus.parts.must("parts").at(["header"]).replace(invalidPart);
// @ts-expect-error Member writes retain forbidden Schema and intrinsic field constraints.
void emptyLocus.parts.must("parts").at(["header"]).replace(badKind);
// @ts-expect-error Member writes retain forbidden Schema and intrinsic field constraints.
void emptyLocus.parts.must("parts").at(["header"]).replace(badDocument);
// @ts-expect-error Member writes retain forbidden Schema and intrinsic field constraints.
void emptyLocus.parts.must("parts").at(["header"]).replace(badCss);
void emptyLocus.parts.must("parts").at(["header"]).set(validPart);
// @ts-expect-error Member writes retain forbidden Schema and intrinsic field constraints.
void emptyLocus.parts.must("parts").at(["header"]).set(invalidPart);
// @ts-expect-error Member writes retain forbidden Schema and intrinsic field constraints.
void emptyLocus.parts.must("parts").at(["header"]).set(badKind);
// @ts-expect-error Member writes retain forbidden Schema and intrinsic field constraints.
void emptyLocus.parts.must("parts").at(["header"]).set(badDocument);
// @ts-expect-error Member writes retain forbidden Schema and intrinsic field constraints.
void emptyLocus.parts.must("parts").at(["header"]).set(badCss);
void emptyLocus.parts.must("parts").at(["header"]).set({ css: "p{color:blue}" });

// emptyLocus.stage writes preserve the intrinsic contract.
void emptyLocus.stage(writer => { writer.parts.must("parts").at([]).replace({}); });
void emptyLocus.stage(writer => { writer.parts.must("parts").at([]).replace(complete); });
void emptyLocus.stage(writer => { writer.parts.must("parts").at([]).replace(validCollection); });
void emptyLocus.stage(writer => { writer.parts.must("parts").at([]).replace(detachedParts); });
// @ts-expect-error Complete replacement requires only valid Part members in a string-keyed collection.
void emptyLocus.stage(writer => { writer.parts.must("parts").at([]).replace(1); });
// @ts-expect-error Complete replacement requires only valid Part members in a string-keyed collection.
void emptyLocus.stage(writer => { writer.parts.must("parts").at([]).replace(arrayRoot); });
// @ts-expect-error Complete replacement requires only valid Part members in a string-keyed collection.
void emptyLocus.stage(writer => { writer.parts.must("parts").at([]).replace(additionalInvalidMember); });
// @ts-expect-error Complete replacement requires only valid Part members in a string-keyed collection.
void emptyLocus.stage(writer => { writer.parts.must("parts").at([]).replace(invalidParts); });
void emptyLocus.stage(writer => { writer.parts.must("parts").at(["header"]).replace(validPart); });
// @ts-expect-error Member writes retain forbidden Schema and intrinsic field constraints.
void emptyLocus.stage(writer => { writer.parts.must("parts").at(["header"]).replace(invalidPart); });
// @ts-expect-error Member writes retain forbidden Schema and intrinsic field constraints.
void emptyLocus.stage(writer => { writer.parts.must("parts").at(["header"]).replace(badKind); });
// @ts-expect-error Member writes retain forbidden Schema and intrinsic field constraints.
void emptyLocus.stage(writer => { writer.parts.must("parts").at(["header"]).replace(badDocument); });
// @ts-expect-error Member writes retain forbidden Schema and intrinsic field constraints.
void emptyLocus.stage(writer => { writer.parts.must("parts").at(["header"]).replace(badCss); });
void emptyLocus.stage(writer => { writer.parts.must("parts").at(["header"]).set(validPart); });
// @ts-expect-error Member writes retain forbidden Schema and intrinsic field constraints.
void emptyLocus.stage(writer => { writer.parts.must("parts").at(["header"]).set(invalidPart); });
// @ts-expect-error Member writes retain forbidden Schema and intrinsic field constraints.
void emptyLocus.stage(writer => { writer.parts.must("parts").at(["header"]).set(badKind); });
// @ts-expect-error Member writes retain forbidden Schema and intrinsic field constraints.
void emptyLocus.stage(writer => { writer.parts.must("parts").at(["header"]).set(badDocument); });
// @ts-expect-error Member writes retain forbidden Schema and intrinsic field constraints.
void emptyLocus.stage(writer => { writer.parts.must("parts").at(["header"]).set(badCss); });
void emptyLocus.stage(writer => { writer.parts.must("parts").at(["header"]).set({ css: "p{color:blue}" }); });

// Ordinary data Libraries retain custom Schema projections, including staged Locus writes.
const ordinaryGoverned = hsonLiveMap.fromLibraries({ data: { data: invalidParts, schema } });
const ordinaryLocus = hsonLiveMap.locus.create({ "data": { data: invalidParts, schema, access: "private" } });
const ordinaryValue: { header: { kind: "document"; document: string } } = ordinaryGoverned.data.must("data").snap();
const ordinarySchema: typeof schema = ordinaryGoverned.data.must("data").schema.get();
ordinaryGoverned.data.must("data").at(["header"]).replace(schemaPart);
ordinaryGoverned.batch(writer => { writer.data.must("data").at(["header"]).set(schemaPart); });
void ordinaryLocus.data.must("data").at(["header"]).replace(schemaPart);
void ordinaryLocus.stage(writer => { writer.data.must("data").at(["header"]).set(schemaPart); });
// @ts-expect-error Ordinary Schema field types remain enforced.
ordinaryGoverned.data.must("data").at(["header", "document"]).set(1);
// @ts-expect-error Ordinary staged Schema field types remain enforced.
ordinaryGoverned.batch(writer => { writer.data.must("data").at(["header", "document"]).set(1); });
// @ts-expect-error Ordinary governed Schema field types remain enforced.
void ordinaryLocus.data.must("data").at(["header", "document"]).set(1);
// @ts-expect-error Ordinary governed staged Schema field types remain enforced.
void ordinaryLocus.stage(writer => { writer.data.must("data").at(["header", "document"]).set(1); });
void [ordinaryValue, ordinarySchema];

// Required inferred keys must fail in both exact-optional compiler modes.
const undefinedLibrarySchema = { parts, schema: undefined };
const undefinedMemberSchema = { ...validPart, schema: undefined };
const undefinedMembers = { header: undefinedMemberSchema };
const undefinedDefinition = { parts: undefinedMembers };
const reusedUndefinedLibraries = { later: undefinedLibrarySchema };
const reusedUndefinedCatalog = [{ "later": { ...undefinedDefinition, access: "private" } }, {  }] as const;
// @ts-expect-error Known Parts facades expose only Schema inspection.
map.parts.must("parts").schema.use(ANY_DATA);
// @ts-expect-error Governor Parts facades expose only Schema inspection.
locus.parts.must("parts").schema.use(ANY_DATA);
// @ts-expect-error Staged writers cannot attach a supplemental Schema.
map.batch(writer => { writer.parts.must("parts").schema.use(ANY_DATA); });
// @ts-expect-error Staged governors cannot attach a supplemental Schema.
void locus.stage(writer => { writer.parts.must("parts").schema.use(ANY_DATA); });
// @ts-expect-error Presence of undefined is not absence at Library admission.
hsonLiveMap.fromLibraries({ parts: { parts, schema: undefined } });
// @ts-expect-error Reusing an inferred Library cannot erase key presence.
hsonLiveMap.fromLibraries(reusedUndefinedLibraries);
// @ts-expect-error Presence of undefined is not absence at member admission.
hsonLiveMap.fromLibraries({ parts: { parts: { header: { ...validPart, schema: undefined } } } });
// @ts-expect-error Reusing inferred members cannot erase key presence.
hsonLiveMap.fromLibraries({ parts: undefinedDefinition });
// @ts-expect-error Dynamic admission preserves inferred Library keys.
map.addLibraries(reusedUndefinedLibraries);
// @ts-expect-error Dynamic admission preserves inferred member keys.
map.addLibraries({ later: undefinedDefinition });
// @ts-expect-error Private admission rejects present Library schema: undefined.
hsonLiveMap.locus.create({ "parts": { ...undefinedLibrarySchema, access: "private" } });
// @ts-expect-error Shared admission rejects present member schema: undefined.
hsonLiveMap.locus.create({ "parts": { ...undefinedDefinition, access: "shared" } });
// @ts-expect-error Local initializers have the same admission contract.
hsonLiveMap.locus.create({  }, { local: [{ name: "parts", initializer: undefinedLibrarySchema }] });
// @ts-expect-error Local member admission also preserves inferred keys.
hsonLiveMap.locus.create({  }, { local: [{ name: "parts", initializer: undefinedDefinition }] });
// @ts-expect-error Dynamic Locus admission rejects Library key presence.
void locus.admit({ "later": { ...undefinedLibrarySchema, access: "shared" } });
// @ts-expect-error Reused grouped input retains member key presence.
void locus.admit(reusedUndefinedCatalog[0]);
// @ts-expect-error Direct member patches retain inferred schema: undefined.
map.parts.must("parts").at(["header"]).set(undefinedMemberSchema);
// @ts-expect-error Direct member replacements retain inferred schema: undefined.
map.parts.must("parts").at(["header"]).replace(undefinedMemberSchema);
// @ts-expect-error Direct collection replacements check every inferred member.
map.parts.must("parts").at([]).replace(undefinedMembers);
// @ts-expect-error Staged member patches retain inferred schema: undefined.
map.batch(writer => { writer.parts.must("parts").at(["header"]).set(undefinedMemberSchema); });
// @ts-expect-error Staged collection replacements check every inferred member.
map.batch(writer => { writer.parts.must("parts").at([]).replace(undefinedMembers); });
// @ts-expect-error Governor member patches retain inferred schema: undefined.
void locus.parts.must("parts").at(["header"]).set(undefinedMemberSchema);
// @ts-expect-error Governor member replacements retain inferred schema: undefined.
void locus.parts.must("parts").at(["header"]).replace(undefinedMemberSchema);
// @ts-expect-error Governor collection replacements check every inferred member.
void locus.parts.must("parts").at([]).replace(undefinedMembers);
// @ts-expect-error Staged governor patches retain inferred schema: undefined.
void locus.stage(writer => { writer.parts.must("parts").at(["header"]).set(undefinedMemberSchema); });
// @ts-expect-error Staged governor replacements check every inferred member.
void locus.stage(writer => { writer.parts.must("parts").at([]).replace(undefinedMembers); });
// The acknowledged generic collection-root patch proposal boundary stays unchanged.
map.parts.must("parts").at([]).set(invalidParts);
map.batch(writer => { writer.parts.must("parts").at([]).set(invalidParts); });
void locus.parts.must("parts").at([]).set(invalidParts);
void locus.stage(writer => { writer.parts.must("parts").at([]).set(invalidParts); });
const ordinaryUndefined = hsonLiveMap.fromLibraries({ data: { data: 1 } });
ordinaryUndefined.data.must("data").schema.use(ANY_DATA);
hsonLiveMap.fromLibraries({ data: { data: 1, schema: ANY_DATA } });
hsonLiveMap.fromLibraries({ parts: { parts: {} } });
hsonLiveMap.locus.create({ "parts": { parts: {}, access: "private" } });

// @ts-expect-error Object helpers must retain key-presence evidence for new members.
map.parts.must("parts").at([]).asObject()?.object.setKey("header", undefinedMemberSchema);
map.parts.must("parts").at(["header"]).asObject()?.object.setMany({ document: "<header/>" });
// @ts-expect-error Part object patch helpers reject schema even when undefined.
map.parts.must("parts").at(["header"]).asObject()?.object.setMany({ schema: undefined });
declare const maybeUndefinedMember: typeof validPart | typeof undefinedMemberSchema;
// @ts-expect-error Collection admission also checks member unions.
hsonLiveMap.fromLibraries({ parts: { parts: { header: maybeUndefinedMember } } });

// @ts-expect-error Member updater inference retains required forbidden keys.
map.parts.must("parts").at(["header"]).update(() => undefinedMemberSchema);
map.parts.must("parts").at(["header"]).update(() => ({ css: "p{color:blue}" }));
declare const persistence: import("hson-live/locus").LocusPersistenceAdapter;
// @ts-expect-error Durable construction uses the same Library key checks.
void hsonLiveMap.locus.resume({ "parts": { ...undefinedLibrarySchema, access: "private" } }, { logicalMapId: "parts-types", persistence });
// @ts-expect-error Durable construction uses the same member key checks.
void hsonLiveMap.locus.resume({ "parts": { ...undefinedDefinition, access: "shared" } }, { logicalMapId: "parts-types", persistence });
