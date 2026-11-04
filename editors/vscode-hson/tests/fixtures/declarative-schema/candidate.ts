import { Hson, type HsonDataValue } from "hson-live";
import { UserSchema } from "./schema.js";

export const user: HsonDataValue<typeof UserSchema> = Hson.data`<user <age "37">>`;
