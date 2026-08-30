import { Hson, type HsonSchema } from "hson-live";

export const PageSchema: HsonSchema = Hson`
  <
    type "document"
    tag "main"
    attrs <props <
      id "string"
      hidden <optional "flag">
    >>
    content <sequence [
      <tag "section" content "string">
    ]>
  >
`;

export const ListSchema: HsonSchema = Hson`
  <
    type "document"
    defs <
      Code <string <prefix "ok-">>
      Item <tag "item" attrs <props <code <ref "Code">>> content "empty">
    >
    tag "list"
    content <repeat <ref "Item"> count 2>
  >
`;

export const DocumentSequenceSchema: HsonSchema = Hson`
  <
    type "document"
    defs <Item <tag "item" content "empty">>
    content <repeat <ref "Item"> count 2>
  >
`;

// @hson-schema generated type exports
import type { DocumentSequenceSchemaType, DocumentSequenceSchemaHson } from "./producer.DocumentSequenceSchema.hson-schema.generated.js";
export type { DocumentSequenceSchemaType, DocumentSequenceSchemaHson };
import type { ListSchemaType, ListSchemaHson } from "./producer.ListSchema.hson-schema.generated.js";
export type { ListSchemaType, ListSchemaHson };
import type { PageSchemaType, PageSchemaHson } from "./producer.PageSchema.hson-schema.generated.js";
export type { PageSchemaType, PageSchemaHson };
// @hson-schema end generated type exports
