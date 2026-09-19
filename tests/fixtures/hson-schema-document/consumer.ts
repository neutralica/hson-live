import { DocumentSequenceSchema, ListSchema, PageSchema } from "./producer.js";
import { type SchemaType, HsonDocument, Hson, hsonLiveMap } from "hson-live";

export const authored: HsonDocument<typeof PageSchema> = Hson.document`<main id=hero data-extension=yes <section "body"/>/>`;

declare const dynamic: import("hson-live/hson").HsonCanonical;
export const certified: HsonDocument<typeof PageSchema> = PageSchema.certify(dynamic);

export const repeated: HsonDocument<typeof ListSchema> = Hson.document`<list <item code=ok-one/> <item code=ok-two/>/>`;
export const repeatedCertified: HsonDocument<typeof ListSchema> = ListSchema.certify(dynamic);
export const documentSequence: HsonDocument<typeof DocumentSequenceSchema> = Hson.document`<item/><item/>`;
export const documentSequenceCertified: HsonDocument<typeof DocumentSequenceSchema> = DocumentSequenceSchema.certify(dynamic);

const libraries = hsonLiveMap.fromLibraries({
  page: { document: "<main id=hero <section \"body\"/>>", schema: PageSchema },
  sequence: { document: "<item/><item/>", schema: DocumentSequenceSchema },
});
const pageMode: "document" = libraries.lib("page").mode;
const selectedPageRoot = libraries.lib("page").document.root();
// @ts-expect-error The selected Page document has exactly one top-level main node.
libraries.lib("page").at([1]);

void pageMode;
void selectedPageRoot;
