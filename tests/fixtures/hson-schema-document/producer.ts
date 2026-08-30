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

// @hson-schema generated type exports
export type { PageSchemaType, PageSchemaHson } from "./producer.PageSchema.hson-schema.generated.js";
