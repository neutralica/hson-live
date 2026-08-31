import { Hson, hsonLiveMap } from "hson-live";
import { DocumentSequenceSchema, ListSchema, PageSchema, type DocumentSequenceSchemaHson, type ListSchemaHson, type PageSchemaHson } from "./producer.js";

export const authored: PageSchemaHson = Hson`<main id=hero data-extension=yes <section "body"/>/>`;

declare const dynamic: import("hson-live/hson").HsonCanonical;
export const certified: PageSchemaHson = Hson.certify(PageSchema, dynamic);

export const repeated: ListSchemaHson = Hson`<list <item code=ok-one/> <item code=ok-two/>/>`;
export const repeatedCertified: ListSchemaHson = Hson.certify(ListSchema, dynamic);
export const documentSequence: DocumentSequenceSchemaHson = Hson`<item/><item/>`;
export const documentSequenceCertified: DocumentSequenceSchemaHson = Hson.certify(DocumentSequenceSchema, dynamic);

const libraries = hsonLiveMap.fromLibraries({
  page: { document: "<main id=hero <section \"body\"/>>", schema: PageSchema },
  sequence: { document: "<item/><item/>", schema: DocumentSequenceSchema },
});
const pageMode: "document" = libraries.lib("page").mode;
// @ts-expect-error A selected document Library has no deprecated Fragment or document controller facade.
libraries.lib("page").document;

void pageMode;
