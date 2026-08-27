import assert from "node:assert/strict";
import { hson } from "../../src/hson.ts";
import { is_owned_projected_schema } from "../../src/api/livemap/livemap.schema.ts";
export { hson };
// A second evaluated module has its own genuine private capability registry.
const foreign = await import(new URL("../../src/api/livemap/livemap.schema.ts?d1-foreign", import.meta.url).href);
const schema = foreign.define_livemap_schema((s: import("../../src/api/livemap/livemap.schema.ts").LiveMapSchemaBuilder) => s.number);
assert.equal(foreign.is_owned_projected_schema(schema), true);
assert.equal(is_owned_projected_schema(schema), false);
export const trustedSchemas = { foreign: schema };
