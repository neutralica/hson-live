import { Hson } from "hson-live";

export const UserSchema = Hson.schema`<type "data" defs <Age "number" User <object <age <ref "Age">>>> root <object <user <ref "User">>>>`;
