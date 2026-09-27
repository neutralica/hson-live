import { Hson } from "hson-live";

export const UserSchema = Hson.schema`<type "data" defs <Age "number" User <content <age <ref "Age">>>> content <user <ref "User">>>`;
