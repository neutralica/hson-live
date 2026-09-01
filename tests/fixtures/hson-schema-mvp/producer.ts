import { Hson, type HsonSchema } from "hson-live";

export const UserSchema: HsonSchema<UserSchemaType, "data"> = Hson`
  <type "data" content <
    name "string"
    nickname <optional "string">
    score "number"
    age <number <int true min 0 under 130>>
    percent <number <min 0 max 100>>
    code <string <len 4 prefix "ID" contains "-" suffix "7">>
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
`;

export const TreeSchema: HsonSchema<TreeSchemaType, "data"> = Hson`
  <
    type "data"
    defs <
      Age <number <int true min 0>>
      Tree <content <value "string" age <ref "Age"> children <array <ref "Tree">>>>
    >
    content <ref "Tree">
  >
`;

export const ReuseSchema: HsonSchema<ReuseSchemaType, "data"> = Hson`
  <
    type "data"
    defs <Left <content <value "string">> Right <content <value "string">>>
    content <content <left <ref "Left"> right <ref "Right"> again <ref "Left">>>
  >
`;

// @hson-schema generated type exports
import type { ReuseSchemaType, ReuseSchemaHson } from "./producer.ReuseSchema.hson-schema.generated.js";
export type { ReuseSchemaType, ReuseSchemaHson };
import type { TreeSchemaType, TreeSchemaHson } from "./producer.TreeSchema.hson-schema.generated.js";
export type { TreeSchemaType, TreeSchemaHson };
import type { UserSchemaType, UserSchemaHson } from "./producer.UserSchema.hson-schema.generated.js";
export type { UserSchemaType, UserSchemaHson };
// @hson-schema end generated type exports
