import { Hson } from "hson-live";

export const AnyDataSchema = Hson.schema`<type "data" root "any">`;

export const UserSchema = Hson.schema`
  <type "data" root <object <
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
      <object <kind <exact "user"> handle "string">>,
      <object <kind <exact "admin"> level "number">>
    ]>
  >>>
`;

export const BlockSchema = Hson.schema`<type "data" defs <
  Paragraph <object <kind <exact "paragraph"> text "string">>
  Heading <object <kind <exact "heading"> text "string">>
  Code <object <kind <exact "code"> language <optional "string"> source "string">>
  List <object <kind <exact "list"> items <array "string">>>
  Block <union [<ref "Paragraph">, <ref "Heading">, <ref "Code">, <ref "List">]>
> root <object <blocks <array <ref "Block">>>>>`;

export const TreeSchema = Hson.schema`
  <
    type "data"
    defs <
      Age <number <int true min 0>>
      Tree <object <value "string" age <ref "Age"> children <array <ref "Tree">>>>
    >
    root <ref "Tree">
  >
`;

export const ReuseSchema = Hson.schema`
  <
    type "data"
    defs <Left <object <value "string">> Right <object <value "string">>>
    root <object <left <ref "Left"> right <ref "Right"> again <ref "Left">>>
  >
`;

export const InteractionFieldsSchema = Hson.schema`
  <type "data" root <object <args "any" payload "any">>>
`;

export const RelationalUniqueSchema = Hson.schema`
  <type "data" root <object <cells <array <
    content <object <position "string" body "string">>
    unique <by "position" cases [
      ["top-left", ["TL"]],
      ["top-right", ["TR"]],
      ["top-half", ["TL", "TR"]]
    ]>
  >>>>>
`;

export const SameShapeOneSchema = Hson.schema`<type "data" root <object <name "string">>>`;
export const SameShapeTwoSchema = Hson.schema`<type "data" root <object <name "string">>>`;
