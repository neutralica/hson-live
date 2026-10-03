import { Hson } from "hson-live";

export const AnyDataSchema = Hson.schema`<type "data">`;

export const UserSchema = Hson.schema`
  <type "data" content <
    name "string"
    nickname <optional "string">
    score "number"
    age <number <int true min 0 under 130>>
    percent <number <min 0 max 100>>
    code <string <len 4 prefix "ID" contains "-" suffix "7">>
    key <string <len 3 alphabet "abc">>
    status <exact "ready">
    phase <union [
      <exact "lobby">,
      <exact "ready">,
      <exact "playing">,
      <exact "finished">
    ]>
    turn <union [<exact "player1">, <exact "player2">, "null"]>
    zero <exact 0>
    negativeZero <exact -0>
    signedZeroChoice <union [<exact 0>, <exact -0>]>
    flags <array <content "boolean" unique true minlen 1 maxlen 3>>
    pair <tuple ["string", "number"]>
    account <union [
      <content <kind <exact "user"> handle "string">>,
      <content <kind <exact "admin"> level "number">>
    ]>
  >>
`;

export const BlockSchema = Hson.schema`<type "data" defs <
  Paragraph <content <kind <exact "paragraph"> text "string">>
  Heading <content <kind <exact "heading"> text "string">>
  Code <content <kind <exact "code"> language <optional "string"> source "string">>
  List <content <kind <exact "list"> items <array "string">>>
  Block <union [<ref "Paragraph">, <ref "Heading">, <ref "Code">, <ref "List">]>
> content <content <blocks <array <ref "Block">>>>>`;

export const TreeSchema = Hson.schema`
  <
    type "data"
    defs <
      Age <number <int true min 0>>
      Tree <content <value "string" age <ref "Age"> children <array <ref "Tree">>>>
    >
    content <ref "Tree">
  >
`;

export const ReuseSchema = Hson.schema`
  <
    type "data"
    defs <Left <content <value "string">> Right <content <value "string">>>
    content <content <left <ref "Left"> right <ref "Right"> again <ref "Left">>>
  >
`;

export const InteractionFieldsSchema = Hson.schema`
  <type "data" content <args "any" payload "any">>
`;

export const RelationalUniqueSchema = Hson.schema`
  <type "data" content <cells <array <
    content <content <position "string" body "string">>
    unique <by "position" cases [
      ["top-left", ["TL"]],
      ["top-right", ["TR"]],
      ["top-half", ["TL", "TR"]]
    ]>
  >>>>
`;

export const SameShapeOneSchema = Hson.schema`<type "data" content <name "string">>`;
export const SameShapeTwoSchema = Hson.schema`<type "data" content <name "string">>`;
