import { Hson } from "hson-live";

export const UserSchema: __HsonSchema<__UserSchemaEvidence["value"], __UserSchemaEvidence["mode"], __UserSchemaEvidence["identity"]> = (Hson.schema`
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
      <union [<exact "ready">, <union [<exact "playing">, <exact "finished">]>]>
    ]>
    turn <union [<exact "player1">, <union [<exact "player2">, "null"]>]>
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
` as unknown as __HsonSchema<__UserSchemaEvidence["value"], __UserSchemaEvidence["mode"], __UserSchemaEvidence["identity"]>);

export const TreeSchema: __HsonSchema<__TreeSchemaEvidence["value"], __TreeSchemaEvidence["mode"], __TreeSchemaEvidence["identity"]> = (Hson.schema`
  <
    type "data"
    defs <
      Age <number <int true min 0>>
      Tree <content <value "string" age <ref "Age"> children <array <ref "Tree">>>>
    >
    content <ref "Tree">
  >
` as unknown as __HsonSchema<__TreeSchemaEvidence["value"], __TreeSchemaEvidence["mode"], __TreeSchemaEvidence["identity"]>);

export const ReuseSchema: __HsonSchema<__ReuseSchemaEvidence["value"], __ReuseSchemaEvidence["mode"], __ReuseSchemaEvidence["identity"]> = (Hson.schema`
  <
    type "data"
    defs <Left <content <value "string">> Right <content <value "string">>>
    content <content <left <ref "Left"> right <ref "Right"> again <ref "Left">>>
  >
` as unknown as __HsonSchema<__ReuseSchemaEvidence["value"], __ReuseSchemaEvidence["mode"], __ReuseSchemaEvidence["identity"]>);

export const InteractionFieldsSchema: __HsonSchema<__InteractionFieldsSchemaEvidence["value"], __InteractionFieldsSchemaEvidence["mode"], __InteractionFieldsSchemaEvidence["identity"]> = (Hson.schema`
  <type "data" content <args "any" payload "any">>
` as unknown as __HsonSchema<__InteractionFieldsSchemaEvidence["value"], __InteractionFieldsSchemaEvidence["mode"], __InteractionFieldsSchemaEvidence["identity"]>);

export const RelationalUniqueSchema: __HsonSchema<__RelationalUniqueSchemaEvidence["value"], __RelationalUniqueSchemaEvidence["mode"], __RelationalUniqueSchemaEvidence["identity"]> = (Hson.schema`
  <type "data" content <cells <array <
    content <content <position "string" body "string">>
    unique <by "position" cases [
      ["top-left", ["TL"]],
      ["top-right", ["TR"]],
      ["top-half", ["TL", "TR"]]
    ]>
  >>>>
` as unknown as __HsonSchema<__RelationalUniqueSchemaEvidence["value"], __RelationalUniqueSchemaEvidence["mode"], __RelationalUniqueSchemaEvidence["identity"]>);

export const SameShapeOneSchema: __HsonSchema<__SameShapeOneSchemaEvidence["value"], __SameShapeOneSchemaEvidence["mode"], __SameShapeOneSchemaEvidence["identity"]> = (Hson.schema`<type "data" content <name "string">>` as unknown as __HsonSchema<__SameShapeOneSchemaEvidence["value"], __SameShapeOneSchemaEvidence["mode"], __SameShapeOneSchemaEvidence["identity"]>);
export const SameShapeTwoSchema: __HsonSchema<__SameShapeTwoSchemaEvidence["value"], __SameShapeTwoSchemaEvidence["mode"], __SameShapeTwoSchemaEvidence["identity"]> = (Hson.schema`<type "data" content <name "string">>` as unknown as __HsonSchema<__SameShapeTwoSchemaEvidence["value"], __SameShapeTwoSchemaEvidence["mode"], __SameShapeTwoSchemaEvidence["identity"]>);

// @hson-schema generated type exports
import type { HsonSchema as __HsonSchema } from "hson-live";
import type { Evidence as __InteractionFieldsSchemaEvidence } from "./producer.InteractionFieldsSchema.hson-schema.generated.js";
import type { Evidence as __RelationalUniqueSchemaEvidence } from "./producer.RelationalUniqueSchema.hson-schema.generated.js";
import type { Evidence as __ReuseSchemaEvidence } from "./producer.ReuseSchema.hson-schema.generated.js";
import type { Evidence as __SameShapeOneSchemaEvidence } from "./producer.SameShapeOneSchema.hson-schema.generated.js";
import type { Evidence as __SameShapeTwoSchemaEvidence } from "./producer.SameShapeTwoSchema.hson-schema.generated.js";
import type { Evidence as __TreeSchemaEvidence } from "./producer.TreeSchema.hson-schema.generated.js";
import type { Evidence as __UserSchemaEvidence } from "./producer.UserSchema.hson-schema.generated.js";
// @hson-schema end generated type exports
