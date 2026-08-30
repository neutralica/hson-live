import { Hson, type HsonSchema } from "hson-live";

export const UserSchema: HsonSchema = Hson`
  <type "data" content <
    name "string"
    nickname <optional "string">
    score "number"
    status <exact "ready">
    zero <exact 0>
    negativeZero <exact -0>
    flags <array "boolean">
    pair <tuple ["string", "number"]>
    account <union [
      <content <kind <exact "user"> handle "string">>,
      <content <kind <exact "admin"> level "number">>
    ]>
  >>
`;

// @hson-schema generated type exports
export type { UserSchemaType, UserSchemaHson } from "./producer.UserSchema.hson-schema.generated.js";
