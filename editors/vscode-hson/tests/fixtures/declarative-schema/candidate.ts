import { Hson } from "hson-live";
import type { UserSchemaHson } from "./schema.js";

export const user: UserSchemaHson = Hson`<user <age "37">>`;
