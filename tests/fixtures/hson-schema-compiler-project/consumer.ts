/// <reference path="./support/ambient.d.ts" />
import { ANY_DATA, ANY_DOCUMENT, Hson, hsonLiveMap, type HsonData, type HsonDocument, type HsonSchema, type JsonFromSchema } from "hson-live";
import type { JsonValue } from "hson-live/hson";
import { slideSchema, twinSchema, RecordSchema, TreeSchema, PageSchema, PlainA, PlainB, annotatedSchema } from "./schema.js";
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

const map = hsonLiveMap.fromLibraries({ state: { schema: RecordSchema, data: { name: "Ada", age: 3, status: "ready", choice: "left", flags: [true], pair: ["x", 1] } } });
map.data.must("state").at(["age"]).set(4);
map.data.must("state").at(["flags"]).replace([false, true]);
// @ts-expect-error Mutation candidates retain member types.
map.data.must("state").at(["age"]).set("four");
// @ts-expect-error Mutation candidates retain literal types.
map.data.must("state").at(["status"]).set("waiting");

const attachedDocument = hsonLiveMap.fromLibraries({ home: { document: '<main id="hero" <section "body"/>/>' } });
// @ts-expect-error Before attachment the getter is only family-correct.
const broadDocumentGetter: typeof PageSchema = attachedDocument.doc.must("home").schema.get();
attachedDocument.doc.must("home").schema.use(PageSchema);
const exactDocumentGetter: typeof PageSchema = attachedDocument.doc.must("home").schema.get();
const attachedText: string = attachedDocument.doc.must("home").at([0, 0]).snap();
attachedDocument.doc.must("home").at([]).attrs.set("id", "next");
// @ts-expect-error Attached document paths retain tuple bounds.
attachedDocument.doc.must("home").at([1]);
// @ts-expect-error Attached text endpoints do not expose element attributes.
attachedDocument.doc.must("home").at([0, 0]).attrs;

const explicitAnyDocument = hsonLiveMap.fromLibraries({ home: { document: '<main id="hero" <section "body"/>/>', schema: ANY_DOCUMENT } });
explicitAnyDocument.doc.must("home").schema.use(PageSchema);
const explicitDocumentGetter: typeof PageSchema = explicitAnyDocument.doc.must("home").schema.get();

const attachedData = hsonLiveMap.fromLibraries({ record: { data: { name: "Ada", age: 3, status: "ready", choice: "left", flags: [true], pair: ["x", 1] } } });
attachedData.data.must("record").schema.use(RecordSchema);
const exactDataGetter: typeof RecordSchema = attachedData.data.must("record").schema.get();
attachedData.data.must("record").at(["age"]).set(4);
// @ts-expect-error Attached data mutation candidates retain member types.
attachedData.data.must("record").at(["age"]).set("four");
// @ts-expect-error Attached data paths reject undeclared members.
attachedData.data.must("record").at(["missing"]);

const explicitAnyData = hsonLiveMap.fromLibraries({ record: { data: { name: "Ada", age: 3, status: "ready", choice: "left", flags: [true], pair: ["x", 1] }, schema: ANY_DATA } });
explicitAnyData.data.must("record").schema.use(RecordSchema);
const explicitDataGetter: typeof RecordSchema = explicitAnyData.data.must("record").schema.get();

const sequential = hsonLiveMap.fromLibraries({
  home: { document: '<main id="hero" <section "body"/>/>' },
  record: { data: { name: "Ada", age: 3, status: "ready", choice: "left", flags: [true], pair: ["x", 1] } },
});
sequential.doc.must("home").schema.use(PageSchema);
sequential.data.must("record").schema.use(RecordSchema);
const sequentialDocument: typeof PageSchema = sequential.doc.must("home").schema.get();
const sequentialData: typeof RecordSchema = sequential.data.must("record").schema.get();

const conditional = hsonLiveMap.fromLibraries({ home: { document: '<main id="hero" <section "body"/>/>' } });
if (checking) {
  conditional.doc.must("home").schema.use(PageSchema);
  const branchSchema: typeof PageSchema = conditional.doc.must("home").schema.get();
  void branchSchema;
}
// @ts-expect-error A one-branch attachment is broad after the join.
const afterConditional: typeof PageSchema = conditional.doc.must("home").schema.get();

const bothBranches = hsonLiveMap.fromLibraries({ home: { document: '<main id="hero" <section "body"/>/>' } });
if (checking) {
  bothBranches.doc.must("home").schema.use(PageSchema);
} else {
  bothBranches.doc.must("home").schema.use(PageSchema);
}
const afterBothBranches: typeof PageSchema = bothBranches.doc.must("home").schema.get();

let reassigned = hsonLiveMap.fromLibraries({ home: { document: '<main id="hero" <section "body"/>/>' } });
reassigned.doc.must("home").schema.use(PageSchema);
const beforeReassignment: typeof PageSchema = reassigned.doc.must("home").schema.get();
reassigned = hsonLiveMap.fromLibraries({ home: { document: '<main id="hero" <section "body"/>/>' } });
// @ts-expect-error Assignment drops the proof attached to the prior map value.
const afterReassignment: typeof PageSchema = reassigned.doc.must("home").schema.get();

const caught = hsonLiveMap.fromLibraries({ home: { document: '<main id="hero" <section "body"/>/>' } });
try { caught.doc.must("home").schema.use(PageSchema); } catch {}
// @ts-expect-error A swallowed attachment failure cannot refine after catch.
const afterCatch: typeof PageSchema = caught.doc.must("home").schema.get();

declare const dynamicLibrary: string;
const dynamicAttachment = hsonLiveMap.fromLibraries({ home: { document: '<main id="hero" <section "body"/>/>' } });
dynamicAttachment.doc.must(dynamicLibrary).schema.use(PageSchema);
// @ts-expect-error Dynamic names do not receive targeted refinement.
const afterDynamic: typeof PageSchema = dynamicAttachment.doc.must("home").schema.get();

const broadPageSchema: HsonSchema<unknown, "document"> = PageSchema;
const broadAttachment = hsonLiveMap.fromLibraries({ home: { document: '<main id="hero" <section "body"/>/>' } });
broadAttachment.doc.must("home").schema.use(broadPageSchema);
// @ts-expect-error Broad Schema variables do not receive exact refinement.
const afterBroad: typeof PageSchema = broadAttachment.doc.must("home").schema.get();

const alreadySpecific = hsonLiveMap.fromLibraries({ home: { document: '<main id="hero" <section "body"/>/>', schema: PageSchema } });
// @ts-expect-error A statically specific governing Schema cannot change nominal contracts.
alreadySpecific.doc.must("home").schema.use(twinSchema);

export function refinedHomeLibrary() {
  const refined = hsonLiveMap.fromLibraries({ home: { document: '<main id="hero" <section "body"/>/>' } });
  refined.doc.must("home").schema.use(PageSchema);
  return refined.doc.must("home");
}

const publicRefined = hsonLiveMap.fromLibraries({
  home: { document: '<main id="hero" <section "body"/>/>' },
  second: { document: '<main id="hero" <section "other"/>/>' },
});
publicRefined.doc.must("home").schema.use(PageSchema);
publicRefined.doc.must("second").schema.use(PageSchema);
export const refinedHome = publicRefined.doc.must("home");
export const refinedSecond = publicRefined.doc.must("second");
export const refinedTitle = publicRefined.doc.must("home").at([0, 0]);
export function getRefinedTitle() {
  publicRefined.doc.must("home").schema.use(PageSchema);
  return publicRefined.doc.must("home").at([0, 0]);
}

// Existing static-literal validation is reused for generated inputs as well.
const authored: HsonData<typeof RecordSchema> = Hson.data`<name "Ada" age 3 status "ready" choice "left" flags [true] pair ["x", 1]>`;
const authoredDocument: HsonDocument<typeof slideSchema> = slideSchema.certify(Hson.document`<main/>`);
const broadData: HsonData<typeof annotatedSchema> = annotatedSchema.certify(Hson.data`42`);

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
void broadDocumentGetter; void exactDocumentGetter; void attachedText; void explicitDocumentGetter;
void exactDataGetter; void explicitDataGetter; void sequentialDocument; void sequentialData;
void afterConditional; void afterBothBranches; void beforeReassignment; void afterReassignment;
void afterCatch; void afterDynamic; void afterBroad;

type DocumentSchemaGraph<S extends import("hson-live").HsonSchema<unknown, "document">> = S extends import("hson-live").HsonSchema<infer TGraph, "document"> ? TGraph : never;
