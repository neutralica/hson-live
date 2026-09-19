import { Hson, type HsonData } from "hson-live";
import { UserSchema } from "./schema.js";

export const user: HsonData<typeof UserSchema> = Hson.data`<user <age "37">>`;
