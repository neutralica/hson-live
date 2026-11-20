// schema.ts — user comment, deliberately spaced

import { Hson, type HsonSchema } from "hson-live";
import { untouched } from "@support/config.js";


// spacing deliberately retained
export const slideSchema = Hson.schema`
<type "document">
`;
export const twinSchema = Hson.schema`
<type "document">
`;

export const RecordSchema = Hson.schema`
<type "data" root <object <
  name "string"
  nickname <optional "string">
  age <number <int true min 0>>
  status <exact "ready">
  choice <union [<exact "left">, <exact "right">]>
  flags <array <content "boolean" unique true>>
  pair <tuple ["string", "number"]>
>>>
`;

export const TreeSchema = Hson.schema`
<type "data" defs <Tree <object <value "string" children <array <ref "Tree">>>>> root <ref "Tree">>
`;

export const PageSchema = Hson.schema`
<type "document" tag "main" attrs <props <id "string" hidden <optional "flag">>> content <sequence [<tag "section" content "string">]>>
`;

export const CompletedPageSchema = Hson.schema`
<type "document" tag "html" content <sequence [<tag "head" content "empty">, <tag "body" content <sequence [<tag "main" attrs <props <id "string" hidden <optional "flag">>> content <sequence [<tag "section" content "string">]>>]>>]>>
`;

// These have no value-level refinement classes; only Schema identity distinguishes them.
export const PlainA = Hson.schema`<type "data" root "any">`;
export const PlainB = Hson.schema`<type "data" root "any">`;

export const annotatedSchema: HsonSchema = Hson.schema`<type "data" root "any">`;
const unrelated: "leave me alone" = untouched;
// Deliberately collide with the legacy generator's preferred local import names.
const __HsonSchema = 1;
const __slideSchemaEvidence = 2;
void unrelated; void __HsonSchema; void __slideSchemaEvidence;
throw new Error("Schema generation must never execute this authored module.");
