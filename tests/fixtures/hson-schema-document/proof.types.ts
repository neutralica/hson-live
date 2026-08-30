import type { PageSchemaValue } from "./producer.js";

declare const page: PageSchemaValue;
const tag: "main" = page.$_tag;
const id: string = page.$_attrs.id;
const hidden: "hidden" | undefined = page.$_attrs.hidden;
const section = page.$_content[0].$_content[0];
const sectionTag: "section" = section.$_tag;
const text: string = section.$_content[0].$_content[0].$_content[0];
void tag; void id; void hidden; void sectionTag; void text;

// @ts-expect-error ordinary structural nodes lack hidden semantic proof
const fabricated: PageSchemaValue = { $_tag: "main", $_attrs: { id: "hero" }, $_content: [] };
// @ts-expect-error reconstruction/spread loses hidden semantic proof
const reconstructed: PageSchemaValue = { ...page };
void fabricated; void reconstructed;
