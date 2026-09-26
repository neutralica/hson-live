/// <reference path="./support/ambient.d.ts" />
import { Hson, hsonLiveMap, type HsonData, type HsonDocument, type HsonSchema, type HsonSchemaMutationCandidate, type SchemaType } from "hson-live";
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
type Candidate<T> = T extends HsonSchemaMutationCandidate<infer C> ? C : never;
type NotAny<T> = 0 extends (1 & T) ? false : true;
type ValueIsPrecise = Assert<NotAny<SchemaType<typeof RecordSchema>>>;
type PlainValue = Assert<Equal<SchemaType<typeof PlainA>, JsonValue>>;
type Mode = Assert<typeof slideSchema extends HsonSchema<unknown, "document"> ? true : false>;
type CrossModuleIdentity = Assert<Equal<Identity<typeof slideSchema>, Identity<typeof sameSlide>>>;
type DistinctDocumentIdentity = Assert<Equal<Identity<typeof slideSchema>, Identity<typeof twinSchema>> extends false ? true : false>;
type DistinctPlainIdentity = Assert<Equal<Identity<typeof PlainA>, Identity<typeof PlainB>> extends false ? true : false>;
type CandidateAge = Assert<Equal<Candidate<SchemaType<typeof RecordSchema>["age"]>, number>>;
type CandidateFlags = Assert<Equal<Candidate<SchemaType<typeof RecordSchema>["flags"]>, boolean[]>>;

declare const document: HsonDocument<typeof slideSchema>;
const sameDocument: HsonDocument<typeof sameSlide> = document;
// @ts-expect-error Document mode cannot be admitted as data mode.
type WrongMode = HsonData<typeof slideSchema>;
// @ts-expect-error Identical document text does not make two declarations interchangeable.
const otherDocument: HsonDocument<typeof twinSchema> = document;
declare const plain: HsonData<typeof PlainA>;
// @ts-expect-error Value types are both JsonValue; their Schema identities still differ.
const otherPlain: HsonData<typeof PlainB> = plain;

declare const value: SchemaType<typeof RecordSchema>;
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
// @ts-expect-error Arithmetic loses nominal refinement proof.
const unprovedAge: typeof value.age = value.age + 1;
// @ts-expect-error Array reconstruction loses the uniqueness/collection proof.
const unprovedFlags: typeof value.flags = [...value.flags];
// @ts-expect-error Object reconstruction loses its private proof.
const unprovedObject: typeof value = { ...value };
declare const tree: SchemaType<typeof TreeSchema>;
const child: SchemaType<typeof TreeSchema> | undefined = tree.children[0];
declare const page: SchemaType<typeof PageSchema>;
const mainTag: "main" = page.$_content[0].$_tag;
const sectionTag: "section" = page.$_content[0].$_content[0].$_content[0].$_tag;
const hidden: "hidden" | undefined = page.$_content[0].$_attrs.hidden;

const map = hsonLiveMap.fromLibraries({ state: { schema: RecordSchema, data: { name: "Ada", age: 3, status: "ready", choice: "left", flags: [true], pair: ["x", 1] } } });
map.lib("state").at(["age"]).set(4);
map.lib("state").at(["flags"]).replace([false, true]);
// @ts-expect-error Mutation candidates retain member types.
map.lib("state").at(["age"]).set("four");
// @ts-expect-error Mutation candidates retain literal types.
map.lib("state").at(["status"]).set("waiting");

// Existing static-literal validation is reused for generated inputs as well.
const authored: HsonData<typeof RecordSchema> = Hson.data`<name "Ada" age 3 status "ready" choice "left" flags [true] pair ["x", 1]>`;
const authoredDocument: HsonDocument<typeof slideSchema> = Hson.document`<main/>`;
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
