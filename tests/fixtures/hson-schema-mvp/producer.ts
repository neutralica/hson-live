import { Hson, type HsonSchema } from "hson-live";

export const UserSchema: HsonSchema = Hson`
  <type "data" content <
    name "string"
    nickname <optional "string">
    score "number"
    age <number <int true min 0 under 130>>
    percent <number <min 0 max 100>>
    code <string <len 4 prefix "ID" contains "-" suffix "7">>
    status <exact "ready">
    zero <exact 0>
    negativeZero <exact -0>
    flags <array <content "boolean" unique true minlen 1 maxlen 3>>
    pair <tuple ["string", "number"]>
    account <union [
      <content <kind <exact "user"> handle "string">>,
      <content <kind <exact "admin"> level "number">>
    ]>
  >>
`;

// @hson-schema generated type exports
export type { UserSchemaType, UserSchemaHson } from "./producer.UserSchema.hson-schema.generated.js";
