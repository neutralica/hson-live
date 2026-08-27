import assert from "node:assert/strict";
import { hson } from "../../src/hson.ts";
import { require_document_root_schema } from "../../src/api/livemap/livemap.document.schema.ts";
export { hson };
const foreign = await import(new URL("../../src/api/livemap/livemap.document.schema.ts?d1-foreign", import.meta.url).href);
const schema = foreign.make_document_element_schema("button", []);
assert.equal(foreign.require_document_root_schema(schema).value, schema);
assert.throws(() => require_document_root_schema(schema));
export const trustedSchemas = { foreign: schema };
