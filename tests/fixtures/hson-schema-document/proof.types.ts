import type { FragmentSchemaType, ListSchemaType, PageSchemaType } from "./producer.js";

declare const page: PageSchemaType;
const tag: "main" = page.$_tag;
const id: string = page.$_attrs.id;
const hidden: "hidden" | undefined = page.$_attrs.hidden;
const section = page.$_content[0].$_content[0];
const sectionTag: "section" = section.$_tag;
const text: string = section.$_content[0].$_content[0].$_content[0];
void tag; void id; void hidden; void sectionTag; void text;

// @ts-expect-error ordinary structural nodes lack hidden semantic proof
const fabricated: PageSchemaType = { $_tag: "main", $_attrs: { id: "hero" }, $_content: [] };
// @ts-expect-error reconstruction/spread loses hidden semantic proof
const reconstructed: PageSchemaType = { ...page };
void fabricated; void reconstructed;

declare const list: ListSchemaType;
const first = list.$_content[0].$_content[0];
const second = list.$_content[0].$_content[1];
const itemTag: "item" = first.$_tag;
const code: string = second.$_attrs.code;
void itemTag; void code;
// @ts-expect-error an ordinary tuple lacks the repeated-content proof
const fabricatedItems: ListSchemaType["$_content"][0]["$_content"] = [first, second];
// @ts-expect-error spreading repeated content erases its composite proof
const reconstructedItems: ListSchemaType["$_content"][0]["$_content"] = [...list.$_content[0].$_content];
void fabricatedItems; void reconstructedItems;

declare const fragment: FragmentSchemaType;
const fragmentRootTag: "_hson_root" = fragment.$_tag;
const fragmentItemTag: "item" = fragment.$_content[0].$_content[0].$_tag;
void fragmentRootTag; void fragmentItemTag;
