/// <reference path="./support/ambient.d.ts" />
import { ANY_DATA, ANY_DOCUMENT, Hson, hsonLiveMap, type HsonData, type HsonDocument, type HsonSchema, type JsonFromSchema } from "hson-live";
import type { JsonValue } from "hson-live/hson";
import { slideSchema, twinSchema, RecordSchema, TreeSchema, PageSchema, CompletedPageSchema, PlainA, PlainB, annotatedSchema } from "./schema.js";
import { slideSchema as sameSlide } from "./schema.js";
import { Same as TsSchema } from "./names/foo.js";
import { Same as MtsSchema } from "./names/foo.mjs";
import { Same as CtsSchema } from "./names/foo.cjs";
import { Same as ElsewhereSchema } from "./elsewhere/foo.js";
import { checking } from "#config";
import type { CompilerOptions } from "typescript";

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Identity<S> = S extends HsonSchema<unknown, "data" | "document", infer I> ? I : never;
type NotAny<T> = 0 extends (1 & T) ? false : true;
type ValueIsPrecise = Assert<NotAny<JsonFromSchema<typeof RecordSchema>>>;
type PlainValue = Assert<Equal<JsonFromSchema<typeof PlainA>, JsonValue>>;
type Mode = Assert<typeof slideSchema extends HsonSchema<unknown, "document"> ? true : false>;
type CrossModuleIdentity = Assert<Equal<Identity<typeof slideSchema>, Identity<typeof sameSlide>>>;
type DistinctDocumentIdentity = Assert<Equal<Identity<typeof slideSchema>, Identity<typeof twinSchema>> extends false ? true : false>;
type DistinctPlainIdentity = Assert<Equal<Identity<typeof PlainA>, Identity<typeof PlainB>> extends false ? true : false>;
type StructuralAge = Assert<Equal<JsonFromSchema<typeof RecordSchema>["age"], number>>;
type StructuralFlags = Assert<Equal<JsonFromSchema<typeof RecordSchema>["flags"], readonly boolean[]>>;

declare const document: HsonDocument<typeof slideSchema>;
const sameDocument: HsonDocument<typeof sameSlide> = document;
// @ts-expect-error Document mode cannot be admitted as data mode.
type WrongMode = HsonData<typeof slideSchema>;
// @ts-expect-error Identical document text does not make two declarations interchangeable.
const otherDocument: HsonDocument<typeof twinSchema> = document;
declare const plain: HsonData<typeof PlainA>;
// @ts-expect-error Value types are both JsonValue; their Schema identities still differ.
const otherPlain: HsonData<typeof PlainB> = plain;

declare const value: JsonFromSchema<typeof RecordSchema>;
const status: "ready" = value.status;
const choice: "left" | "right" = value.choice;
const nickname: string | undefined = value.nickname;
const pair: readonly [string, number] = value.pair;
// @ts-expect-error Optional members remain optional.
const requiredNickname: string = value.nickname;
// @ts-expect-error Literal precision is not widened.
const wrongStatus: "waiting" = value.status;
// @ts-expect-error Readonly evidence is retained.
value.name = "changed";
const unprovedAge: typeof value.age = value.age + 1;
const unprovedFlags: typeof value.flags = [...value.flags];
const unprovedObject: typeof value = { ...value };
declare const tree: JsonFromSchema<typeof TreeSchema>;
const child: JsonFromSchema<typeof TreeSchema> | undefined = tree.children[0];
declare const page: DocumentSchemaGraph<typeof PageSchema>;
const mainTag: "main" = page.$_content[0].$_tag;
const sectionTag: "section" = page.$_content[0].$_content[0].$_content[0].$_tag;
const hidden: "hidden" | undefined = page.$_content[0].$_attrs.hidden;

const map = hsonLiveMap.fromLibraries({ state: { schema: RecordSchema, json: { name: "Ada", age: 3, status: "ready", choice: "left", flags: [true], pair: ["x", 1] } } });
map.data.must("state").at(["age"]).set(4);
map.data.must("state").at(["flags"]).replace([false, true]);
// @ts-expect-error Mutation candidates retain member types.
map.data.must("state").at(["age"]).set("four");
// @ts-expect-error Mutation candidates retain literal types.
map.data.must("state").at(["status"]).set("waiting");

// Admission fixes the governing proof, including through later equal no-op use.
const admittedDocument = hsonLiveMap.fromLibraries({ home: { document: '<html <head/> <body <main id="hero" <section "body"/>/>/>/>', schema: CompletedPageSchema } });
admittedDocument.doc.must("home").schema.use(CompletedPageSchema);
const exactDocumentGetter: typeof CompletedPageSchema = admittedDocument.doc.must("home").schema.get();
const admittedText: string = admittedDocument.doc.must("home").at([1, 0, 0, 0]).snap();
// @ts-expect-error Admitted document paths retain tuple bounds.
admittedDocument.doc.must("home").at([2]);
// @ts-expect-error Admitted text endpoints do not expose element attributes.
admittedDocument.doc.must("home").at([1, 0, 0, 0]).attrs;
const admittedData = hsonLiveMap.fromLibraries({ record: { json: { name: "Ada", age: 3, status: "ready", choice: "left", flags: [true], pair: ["x", 1] }, schema: RecordSchema } });
const exactDataGetter: typeof RecordSchema = admittedData.data.must("record").schema.get();
admittedData.data.must("record").schema.use(RecordSchema);
// @ts-expect-error Admitted Data mutations retain member types.
admittedData.data.must("record").at(["age"]).set("four");
// @ts-expect-error Admitted Data paths reject undeclared members.
admittedData.data.must("record").at(["missing"]);

const broad = hsonLiveMap.fromLibraries({ home: { document: '<main/>', schema: ANY_DOCUMENT }, record: { json: { name: "Ada" }, schema: ANY_DATA } });
broad.doc.must("home").schema.use(CompletedPageSchema);
broad.data.must("record").schema.use(RecordSchema);
// @ts-expect-error Prohibited post-admission use cannot prove a different governing Schema.
const afterUse: typeof CompletedPageSchema = broad.doc.must("home").schema.get();
// @ts-expect-error Data family tops remain family tops after use.
const afterDataUse: typeof RecordSchema = broad.data.must("record").schema.get();
if (checking) broad.doc.must("home").schema.use(CompletedPageSchema);
else broad.doc.must("home").schema.use(CompletedPageSchema);
// @ts-expect-error Even matching control-flow branches cannot mint replacement proof.
const afterBranches: typeof CompletedPageSchema = broad.doc.must("home").schema.get();
try { broad.data.must("record").schema.use(RecordSchema); } catch {}
// @ts-expect-error Swallowed failure cannot refine a binding.
const afterCatch: typeof RecordSchema = broad.data.must("record").schema.get();
// @ts-expect-error A fixed Schema cannot change nominal contracts.
admittedDocument.doc.must("home").schema.use(twinSchema);

export function refinedHomeLibrary() { return admittedDocument.doc.must("home"); }
const publicRefined = hsonLiveMap.fromLibraries({
  home: { document: '<html <head/> <body <main id="hero" <section "body"/>/>/>/>', schema: CompletedPageSchema },
  second: { document: '<html <head/> <body <main id="hero" <section "other"/>/>/>/>', schema: CompletedPageSchema },
});
export const refinedHome = publicRefined.doc.must("home");
export const refinedSecond = publicRefined.doc.must("second");
export const refinedTitle = publicRefined.doc.must("home").at([1, 0, 0, 0]);
export function getRefinedTitle() { return publicRefined.doc.must("home").at([1, 0, 0, 0]); }

// Existing static-literal validation is reused for generated inputs as well.
const authored: HsonData<typeof RecordSchema> = Hson.data`<name "Ada" age 3 status "ready" choice "left" flags [true] pair ["x", 1]>`;
const authoredDocument: HsonDocument<typeof slideSchema> = slideSchema.certify(Hson.document`<main/>`);
const broadData: import("hson-live").HsonDataValue<typeof annotatedSchema> = annotatedSchema.certify(Hson.data.parse`42`);

declare const tsSchema: typeof TsSchema;
// @ts-expect-error Same stem and export name, distinct .mts declaration.
const wrongMts: typeof MtsSchema = tsSchema;
// @ts-expect-error Same stem and export name, distinct .cts declaration.
const wrongCts: typeof CtsSchema = tsSchema;
// @ts-expect-error Same stem and export name, distinct containing folder.
const wrongFolder: typeof ElsewhereSchema = tsSchema;
const options: CompilerOptions = checking;
const ambient: HsonCompilerProjectFixture = { preserved: true };
void sameDocument; void otherDocument; void otherPlain; void status; void choice; void nickname; void pair;
void requiredNickname; void wrongStatus; void unprovedAge; void unprovedFlags; void unprovedObject;
void child; void mainTag; void sectionTag; void hidden; void authored; void authoredDocument; void broadData;
void wrongMts; void wrongCts; void wrongFolder; void options; void ambient;
void exactDocumentGetter; void admittedText; void exactDataGetter;
void afterUse; void afterDataUse; void afterBranches; void afterCatch;

type DocumentSchemaGraph<S extends import("hson-live").HsonSchema<unknown, "document">> = S extends import("hson-live").HsonSchema<infer TGraph, "document"> ? TGraph : never;
