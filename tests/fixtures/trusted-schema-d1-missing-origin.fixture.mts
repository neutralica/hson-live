import { hson } from "../../src/hson.ts";
// Intentionally no exported hson: Schema shape alone is not origin evidence.
export const trustedSchemas = { missing: hson.liveMap.schema.define(s => s.number) };
