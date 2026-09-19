import { Hson } from "hson-live";

export const UserSchema: __HsonSchema<__UserSchemaEvidence["value"], __UserSchemaEvidence["mode"], __UserSchemaEvidence["identity"]> = (Hson.schema`<type "data" defs <Age "number" User <content <age <ref "Age">>>> content <user <ref "User">>>` as unknown as __HsonSchema<__UserSchemaEvidence["value"], __UserSchemaEvidence["mode"], __UserSchemaEvidence["identity"]>);

// @hson-schema generated type exports
import type { HsonSchema as __HsonSchema } from "hson-live";
import type { Evidence as __UserSchemaEvidence } from "./schema.UserSchema.hson-schema.generated.js";
// @hson-schema end generated type exports
