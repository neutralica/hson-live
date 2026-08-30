import { Hson } from "hson-live";
import { DocumentSequenceSchema, ListSchema, PageSchema, type DocumentSequenceSchemaHson, type ListSchemaHson, type PageSchemaHson } from "./producer.js";

export const authored: PageSchemaHson = Hson`<main id=hero data-extension=yes <section "body"/>/>`;

declare const dynamic: import("hson-live/hson").HsonCanonical;
export const certified: PageSchemaHson = Hson.certify(PageSchema, dynamic);

export const repeated: ListSchemaHson = Hson`<list <item code=ok-one/> <item code=ok-two/>/>`;
export const repeatedCertified: ListSchemaHson = Hson.certify(ListSchema, dynamic);
export const documentSequence: DocumentSequenceSchemaHson = Hson`<item/><item/>`;
export const documentSequenceCertified: DocumentSequenceSchemaHson = Hson.certify(DocumentSequenceSchema, dynamic);
