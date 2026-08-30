import type { DocumentSequenceSchemaType, ListSchemaType, PageSchemaType } from "./producer.js";

declare const page: PageSchemaType;
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
const fabricated: PageSchemaType = { $_tag: "main", $_attrs: { id: "hero" }, $_content: [] };
// @ts-expect-error reconstruction/spread loses hidden semantic proof
const reconstructed: PageSchemaType = { ...page };
void fabricated; void reconstructed;

declare const list: ListSchemaType;
const listElement = list.$_content[0];
const first = listElement.$_content[0].$_content[0];
const second = listElement.$_content[0].$_content[1];
const itemTag: "item" = first.$_tag;
const code: string = second.$_attrs.code;
void itemTag; void code;
// @ts-expect-error an ordinary tuple lacks the repeated-content proof
const fabricatedItems: ListSchemaType["$_content"][0]["$_content"][0]["$_content"] = [first, second];
// @ts-expect-error spreading repeated content erases its composite proof
const reconstructedItems: ListSchemaType["$_content"][0]["$_content"][0]["$_content"] = [...listElement.$_content[0].$_content];
void fabricatedItems; void reconstructedItems;

declare const documentSequence: DocumentSequenceSchemaType;
const sequenceRootTag: "_hson_root" = documentSequence.$_tag;
const sequenceItemTag: "item" = documentSequence.$_content[0].$_tag;
void sequenceRootTag; void sequenceItemTag;
