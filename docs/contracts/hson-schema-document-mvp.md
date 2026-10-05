# Document Schema authoring and proof

Document Schemas use the same Hson authoring, generator, and proof path as data Schemas, with document mode fixed in the generated evidence.

```ts
import { Hson, type HsonFromSchema } from "hson-live";

export const PageSchema = Hson.schema`
  <type "document" tag "main"
    attrs <props <id "string" hidden <optional "flag">> closed true>
    content <sequence [<tag "section" content "string">]>>
`;

export type PageHson = HsonFromSchema<typeof PageSchema>;
const page: PageHson = Hson.document`<main id=hero <section "body"/>/>`;
```

`HsonFromSchema<typeof PageSchema>` selects the lower-level `HsonDocument<typeof PageSchema>`, which is a canonical primitive string with a Schema-specific proof. The authoritative Schema analyzer checks direct authored assignments and grants proof only for valid, substitution-free source. Dynamic certification uses `PageSchema.certify(candidate)` and validates in document context. Data candidates reject statically where their mode is known, and wrong-mode input always rejects at runtime.

`JsonFromSchema` accepts data Schemas only. Document Schema inference retains private structural graph evidence for LiveMap paths and endpoint capabilities; this evidence is not a JSON, HTML, or DOM representation and has no ordinary Schema-preserving runtime projection API. The document vocabulary supports exact tag, optional and required attributes, closed or open attrs, empty/string content, sequences, repeated children, local definitions and references, and the implemented refinements. `Hson.document` separately admits notation-closed documents, including empty and multi-root content. Document admission alone does not claim Schema conformance.
