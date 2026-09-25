import { Hson } from "hson-live";

export const AnyDocumentSchema: __HsonSchema<__AnyDocumentSchemaEvidence["value"], __AnyDocumentSchemaEvidence["mode"], __AnyDocumentSchemaEvidence["identity"]> = (Hson.schema`<type "document">` as unknown as __HsonSchema<__AnyDocumentSchemaEvidence["value"], __AnyDocumentSchemaEvidence["mode"], __AnyDocumentSchemaEvidence["identity"]>);
export const MainDocumentSchema: __HsonSchema<__MainDocumentSchemaEvidence["value"], __MainDocumentSchemaEvidence["mode"], __MainDocumentSchemaEvidence["identity"]> = (Hson.schema`<type "document" tag "main">` as unknown as __HsonSchema<__MainDocumentSchemaEvidence["value"], __MainDocumentSchemaEvidence["mode"], __MainDocumentSchemaEvidence["identity"]>);

export const PageSchema: __HsonSchema<__PageSchemaEvidence["value"], __PageSchemaEvidence["mode"], __PageSchemaEvidence["identity"]> = (Hson.schema`
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
` as unknown as __HsonSchema<__PageSchemaEvidence["value"], __PageSchemaEvidence["mode"], __PageSchemaEvidence["identity"]>);

export const ListSchema: __HsonSchema<__ListSchemaEvidence["value"], __ListSchemaEvidence["mode"], __ListSchemaEvidence["identity"]> = (Hson.schema`
  <
    type "document"
    defs <
      Code <string <prefix "ok-">>
      Item <tag "item" attrs <props <code <ref "Code">>> content "empty">
    >
    tag "list"
    content <repeat <ref "Item"> count 2>
  >
` as unknown as __HsonSchema<__ListSchemaEvidence["value"], __ListSchemaEvidence["mode"], __ListSchemaEvidence["identity"]>);

export const DocumentSequenceSchema: __HsonSchema<__DocumentSequenceSchemaEvidence["value"], __DocumentSequenceSchemaEvidence["mode"], __DocumentSequenceSchemaEvidence["identity"]> = (Hson.schema`
  <
    type "document"
    defs <Item <tag "item" content "empty">>
    content <repeat <ref "Item"> count 2>
  >
` as unknown as __HsonSchema<__DocumentSequenceSchemaEvidence["value"], __DocumentSequenceSchemaEvidence["mode"], __DocumentSequenceSchemaEvidence["identity"]>);

// @hson-schema generated type exports
import type { HsonSchema as __HsonSchema } from "hson-live";
import type { Evidence as __AnyDocumentSchemaEvidence } from "./producer.AnyDocumentSchema.hson-schema.generated.js";
import type { Evidence as __DocumentSequenceSchemaEvidence } from "./producer.DocumentSequenceSchema.hson-schema.generated.js";
import type { Evidence as __ListSchemaEvidence } from "./producer.ListSchema.hson-schema.generated.js";
import type { Evidence as __MainDocumentSchemaEvidence } from "./producer.MainDocumentSchema.hson-schema.generated.js";
import type { Evidence as __PageSchemaEvidence } from "./producer.PageSchema.hson-schema.generated.js";
// @hson-schema end generated type exports
