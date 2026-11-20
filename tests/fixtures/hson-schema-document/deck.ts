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
      object <
        kind <exact "paragraph">
        content "string"
      >
    >

    Heading <
      object <
        kind <exact "heading">
        content "string"
      >
    >

    Code <
      object <
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
      object <
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
      object <
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
  root <object <
    slides <array <ref "Slide">>
  >>
>
`;


export type Deck = HsonFromSchema<typeof DeckSchema>
