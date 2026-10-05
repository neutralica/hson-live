import { DocumentSequenceSchema, ListSchema, PageSchema } from "./producer.js";
import type { HsonDocument } from "hson-live";

declare const page: DocumentSchemaGraph<typeof PageSchema>;
const rootTag: "_hson_root" = page.$_tag;
const main = page.$_content[0];
const tag: "main" = main.$_tag;
const id: string = main.$_attrs.id;
const hidden: "hidden" | undefined = main.$_attrs.hidden;
const section = main.$_content[0].$_content[0];
const sectionTag: "section" = section.$_tag;
const text: string = section.$_content[0].$_content[0].$_content[0];
void rootTag; void tag; void id; void hidden; void sectionTag; void text;

// @ts-expect-error ordinary structural nodes lack hidden semantic proof
const fabricated: DocumentSchemaGraph<typeof PageSchema> = { $_tag: "main", $_attrs: { id: "hero" }, $_content: [] };
// @ts-expect-error reconstruction/spread loses hidden semantic proof
const reconstructed: DocumentSchemaGraph<typeof PageSchema> = { ...page };
void fabricated; void reconstructed;

declare const list: DocumentSchemaGraph<typeof ListSchema>;
const listElement = list.$_content[0];
const first = listElement.$_content[0].$_content[0];
const second = listElement.$_content[0].$_content[1];
const itemTag: "item" = first.$_tag;
const code: string = second.$_attrs.code;
void itemTag; void code;
// @ts-expect-error an ordinary tuple lacks the repeated-content proof
const fabricatedItems: DocumentSchemaGraph<typeof ListSchema>["$_content"][0]["$_content"][0]["$_content"] = [first, second];
// @ts-expect-error spreading repeated content erases its composite proof
const reconstructedItems: DocumentSchemaGraph<typeof ListSchema>["$_content"][0]["$_content"][0]["$_content"] = [...listElement.$_content[0].$_content];
void fabricatedItems; void reconstructedItems;

declare const documentSequence: DocumentSchemaGraph<typeof DocumentSequenceSchema>;
const sequenceRootTag: "_hson_root" = documentSequence.$_tag;
const sequenceItemTag: "item" = documentSequence.$_content[0].$_tag;
void sequenceRootTag; void sequenceItemTag;

type DocumentSchemaGraph<S extends import("hson-live").HsonSchema<unknown, "document">> = S extends import("hson-live").HsonSchema<infer TGraph, "document"> ? TGraph : never;
