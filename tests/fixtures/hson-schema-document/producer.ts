import { Hson } from "hson-live";

export const AnyDocumentSchema = Hson.schema`<type "document">`;
export const MainDocumentSchema = Hson.schema`<type "document" tag "main">`;

export const PageSchema = Hson.schema`
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

export const ListSchema = Hson.schema`
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

export const DocumentSequenceSchema = Hson.schema`
  <
    type "document"
    defs <Item <tag "item" content "empty">>
    content <repeat <ref "Item"> count 2>
  >
`;
