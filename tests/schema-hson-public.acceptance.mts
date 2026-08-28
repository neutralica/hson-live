import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as root from "hson-live";
import * as narrow from "hson-live/hson";
import * as map from "hson-live/livemap";
import * as transform from "hson-live/transform";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
let checks = 0;
function check(name: string, run: () => void) { run(); console.log(`ok ${++checks} - ${name}`); }
const facades = [root.hson.liveMap, narrow.hson.liveMap, narrow.hsonLiveMap, map.hsonLiveMap];
for (const [index, facade] of facades.entries()) check(`public facade path ${index + 1} has the same validate boundary`, () => {
  assert.equal(facade.schema.validate, root.hson.liveMap.schema.validate);
  const schema = facade.schema.define(s => s.number);
  const canonical = root.hson`37`;
  assert.equal(facade.schema.validate(schema, canonical), canonical);
});
check("facade namespace has only approved define and validate", () => assert.deepEqual(Object.keys(root.hson.liveMap.schema).sort(), ["define", "validate"]));
check("no standalone validate helper leaked from public modules", () => { for (const module of [root, narrow, map, transform]) assert.equal(Object.hasOwn(module, "validate"), false); });
check("compiled declaration retains branded canonical input and output", () => { const declaration = readFileSync(new URL("../dist/api/livemap/livemap.facade.d.ts", import.meta.url), "utf8"); assert.match(declaration, /validate: \(schema: LiveMapSchema, canonical: HsonCanonical\) => HsonCanonical/); assert.doesNotMatch(declaration, /TrustedSchema|validate_schema_hson_graph|Provenance/); });
check("tag stays primitive and String prototype stays untouched", () => { assert.equal(typeof root.hson`37`, "string"); assert.equal(Object.hasOwn(String.prototype, "validate"), false); });
check("Schema identity is not mutated by validation", () => { const schema = root.hson.liveMap.schema.define(s => s.number); const descriptors = Object.getOwnPropertyDescriptors(schema); root.hson.liveMap.schema.validate(schema, root.hson`37`); assert.deepEqual(Object.getOwnPropertyDescriptors(schema), descriptors); });
check("structural Schema copy cannot impersonate an owned object", () => { const schema = root.hson.liveMap.schema.define(s => s.number); assert.throws(() => root.hson.liveMap.schema.validate({ ...schema }, root.hson`37`), (error: unknown) => error instanceof map.LiveMapSchemaError && error.issues[0]?.code === "INVALID_SCHEMA"); });
for (const [name, canonical] of [["boolean", root.hson`true`], ["null", root.hson`null`], ["string", root.hson`"text"`], ["number", root.hson`3.5`]] as const) check(`projected ${name} is admitted without a map`, () => {
  const schema = root.hson.liveMap.schema.define(s => s.unknown.nullable);
  assert.equal(root.hson.liveMap.schema.validate(schema, canonical), canonical);
});
check("element cannot use projected-only capability", () => assert.throws(() => root.hson.liveMap.schema.validate(root.hson.liveMap.schema.define(s => s.number), root.hson`<button/>`), map.LiveMapSchemaError));
check("projected object cannot use element-only capability", () => assert.throws(() => root.hson.liveMap.schema.validate(root.hson.liveMap.schema.define(s => s.button()), root.hson`<age 37>`), map.LiveMapSchemaError));
check("fragment cannot coerce to element", () => assert.throws(() => root.hson.liveMap.schema.validate(root.hson.liveMap.schema.define(s => s.button()), root.hson`<button/> <button/>`), map.LiveMapSchemaError));
check("combined tuple capability validates projected array", () => { const schema = root.hson.liveMap.schema.define(s => s.tuple(s.string, s.string)); const canonical = root.hson`["a", "b"]`; assert.equal(root.hson.liveMap.schema.validate(schema, canonical), canonical); });
check("combined tuple capability validates actual element fragment", () => { const schema = root.hson.liveMap.schema.define(s => s.tuple(s.unknown, s.unknown)); const canonical = root.hson`<a/> <b/>`; assert.equal(root.hson.liveMap.schema.validate(schema, canonical), canonical); });
check("document-item-only expression fails INVALID_SCHEMA", () => { const schema = root.hson.liveMap.schema.define(s => s.pick(s.a(), s.b())); assert.throws(() => root.hson.liveMap.schema.validate(schema, root.hson`<a/>`), (error: unknown) => error instanceof map.LiveMapSchemaError && error.issues[0]?.code === "INVALID_SCHEMA"); });
check("document attr constraint throw retains authoritative mismatch semantics", () => { const schema = root.hson.liveMap.schema.define(s => s.button(s.attrs({ title: s.string.constrain(() => { throw new Error("attr sentinel"); }) }))); assert.throws(() => root.hson.liveMap.schema.validate(schema, root.hson`<button title="x"/>`), (error: unknown) => error instanceof map.LiveMapSchemaError && error.issues[0]?.code === "TYPE_MISMATCH"); });
emit_hson_live_test_completion("schema-hson-public", checks, checks, 0);
