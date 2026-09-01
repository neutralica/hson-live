import { Hson, type HsonSchema } from "hson-live";

export const UserSchema: HsonSchema<UserSchemaType, "data"> = Hson`<type "data" content <user <content <age "number">>>>`;

// @hson-schema generated type exports
import type { UserSchemaType, UserSchemaHson } from "./schema.UserSchema.hson-schema.generated.js";
export type { UserSchemaType, UserSchemaHson };
// @hson-schema end generated type exports
