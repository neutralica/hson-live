// Copied from hson-deck/src/schema/schema.ts for permanent public capability acceptance.
import { Hson, type HsonFromSchema } from "hson-live";

export const firstSchema = Hson.schema`
<
  type "document"
  tag "html"
  content <
    sequence «
      <tag "head">,
      <tag "body">
    »
  >
>
`;

export const DeckSchema = Hson.schema`
<
  type "data"
  defs <

    Paragraph <
      content <
        kind <exact "paragraph">
        content "string"
      >
    >

    Heading <
      content <
        kind <exact "heading">
        content "string"
      >
    >

    Code <
      content <
        kind <exact "code">
        language <
          optional <
            union «
              <exact "json">,
              <exact "html">,
              <exact "hson">
            »
          >
        >
        content "string"
      >
    >

    List <
      content <
        kind <exact "list">
        language <optional "string">
        content "string"
      >
    >

    Block <
      union «
        <ref "Paragraph">,
        <ref "Heading">,
        <ref "Code">,
        <ref "List">,
      »
    >

    Column <
      array <ref "Block">
    >
    Slide <
      content <
        id "string"
        title <optional "string">
        subtitle <optional "string">

        column1 <ref "Column">
        column2 <optional <ref "Column">>
        column3 <optional <ref "Column">>

        footer <optional "string">
      >
    >

  >
  content <
    slides <array <ref "Slide">>
  >
>
`;


export type Deck = HsonFromSchema<typeof DeckSchema>
