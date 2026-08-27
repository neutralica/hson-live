import { hson } from "../../src/hson.ts";
import { register_trusted_schema_for_development } from "../../src/internal/trusted-schema-diagnostics/dev-registration.ts";
register_trusted_schema_for_development("missing", hson.liveMap.schema.define(s => s.number), undefined);
