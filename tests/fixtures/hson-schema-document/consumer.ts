import { Hson } from "hson-live";
import { PageSchema, type PageSchemaHson } from "./producer.js";

export const authored: PageSchemaHson = Hson`<main id=hero data-extension=yes <section "body"/>/>`;

declare const dynamic: import("hson-live/hson").HsonCanonical;
export const certified: PageSchemaHson = Hson.certify(PageSchema, dynamic);
