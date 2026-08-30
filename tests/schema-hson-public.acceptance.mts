import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as root from "hson-live";
import * as narrow from "hson-live/hson";
import * as map from "hson-live/livemap";
import * as transform from "hson-live/transform";
import { hsonLiveTree } from "hson-live/livetree";
import { hsonLocus } from "hson-live/locus";
import { hsonReflect } from "hson-live/reflect";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
let checks = 0;
function check(name: string, run: () => void) { run(); console.log(`ok ${++checks} - ${name}`); }
const facades = [root.hson.liveMap, root.hsonLiveMap, map.hsonLiveMap];
for (const [index, facade] of facades.entries()) check(`public facade path ${index + 1} has the same validate boundary`, () => {
  assert.equal(facade.schema.validate, root.Hson.certify);
  const schema = facade.schema.define(s => s.number);
  const canonical = root.Hson`37`;
  assert.equal(facade.schema.validate(schema, canonical), canonical);
});
check("facade namespace exposes callback-free constructors plus migration define and validate", () => {
  const keys = Object.keys(root.hson.liveMap.schema);
  for (const key of ["define", "validate", "string", "object", "optional", "minimum", "reference", "declarations", "main", "attrs"]) assert.equal(keys.includes(key), true);
  assert.equal(keys.includes("recurse"), false);
});
check("public Hson validation accepts graph-backed direct Schema", () => { const schema = root.hson.liveMap.schema.object.exact({ age: root.hson.liveMap.schema.minimum(root.hson.liveMap.schema.number, 0) }); const canonical = root.Hson`<age 37>`; assert.equal(root.Hson.certify(schema, canonical), canonical); });
check("no standalone validate helper leaked from public modules", () => { for (const module of [root, narrow, map, transform]) assert.equal(Object.hasOwn(module, "validate"), false); });
check("compiled declaration retains branded canonical input and output", () => { const declaration = readFileSync(new URL("../dist/api/livemap/livemap.facade.d.ts", import.meta.url), "utf8"); assert.match(declaration, /validate: \(schema: LiveMapSchema, canonical: HsonCanonical\) => HsonCanonical/); assert.doesNotMatch(declaration, /TrustedSchema|validate_schema_hson_graph|Provenance/); });
check("tag stays primitive and String prototype stays untouched", () => { assert.equal(typeof root.Hson`37`, "string"); assert.equal(Object.hasOwn(String.prototype, "validate"), false); });
check("Schema identity is not mutated by validation", () => { const schema = root.hson.liveMap.schema.define(s => s.number); const descriptors = Object.getOwnPropertyDescriptors(schema); root.Hson.certify(schema, root.Hson`37`); assert.deepEqual(Object.getOwnPropertyDescriptors(schema), descriptors); });
check("structural Schema copy cannot impersonate an owned object", () => { const schema = root.hson.liveMap.schema.define(s => s.number); assert.throws(() => root.Hson.certify({ ...schema }, root.Hson`37`), (error: unknown) => error instanceof map.LiveMapSchemaError && error.issues[0]?.code === "INVALID_SCHEMA"); });
for (const [name, canonical] of [["boolean", root.Hson`true`], ["null", root.Hson`null`], ["string", root.Hson`"text"`], ["number", root.Hson`3.5`]] as const) check(`projected ${name} is admitted without a map`, () => {
  const schema = root.hson.liveMap.schema.define(s => s.unknown.nullable);
  assert.equal(root.Hson.certify(schema, canonical), canonical);
});
check("element cannot use projected-only capability", () => assert.throws(() => root.Hson.certify(root.hson.liveMap.schema.define(s => s.number), root.Hson`<button/>`), map.LiveMapSchemaError));
check("data object cannot use element-only capability", () => assert.throws(() => root.Hson.certify(root.hson.liveMap.schema.define(s => s.button()), root.Hson`<age 37>`), map.LiveMapSchemaError));
check("fragment cannot coerce to element", () => assert.throws(() => root.Hson.certify(root.hson.liveMap.schema.define(s => s.button()), root.Hson`<button/> <button/>`), map.LiveMapSchemaError));
check("combined tuple capability validates data array", () => { const schema = root.hson.liveMap.schema.define(s => s.tuple(s.string, s.string)); const canonical = root.Hson`["a", "b"]`; assert.equal(root.Hson.certify(schema, canonical), canonical); });
check("combined tuple capability validates actual element fragment", () => { const schema = root.hson.liveMap.schema.define(s => s.tuple(s.unknown, s.unknown)); const canonical = root.Hson`<a/> <b/>`; assert.equal(root.Hson.certify(schema, canonical), canonical); });
check("document-item-only expression fails INVALID_SCHEMA", () => { const schema = root.hson.liveMap.schema.define(s => s.pick(s.a(), s.b())); assert.throws(() => root.Hson.certify(schema, root.Hson`<a/>`), (error: unknown) => error instanceof map.LiveMapSchemaError && error.issues[0]?.code === "INVALID_SCHEMA"); });
check("document attr constraint throw retains authoritative mismatch semantics", () => { const schema = root.hson.liveMap.schema.define(s => s.button(s.attrs({ title: s.string.constrain(() => { throw new Error("attr sentinel"); }) }))); assert.throws(() => root.Hson.certify(schema, root.Hson`<button title="x"/>`), (error: unknown) => error instanceof map.LiveMapSchemaError && error.issues[0]?.code === "TYPE_MISMATCH"); });
check("root and narrow authoring expose certify without the retired validate alias", () => {
  assert.equal(root.Hson, narrow.Hson);
  assert.equal(Object.isFrozen(narrow.Hson), true);
  assert.deepEqual(Object.keys(narrow.Hson), ["certify"]);
  assert.equal(Object.hasOwn(narrow.Hson, "validate"), false);
});
check("all canonical validation entrances share exact function identity", () => { assert.equal(narrow.Hson.certify, map.hsonLiveMap.schema.validate); assert.equal(root.Hson.certify, root.hson.liveMap.schema.validate); });
check("lowercase aggregate is frozen and noncallable", () => { assert.equal(typeof root.hson, "object"); assert.equal(Object.isFrozen(root.hson), true); assert.throws(() => {
  // @ts-expect-error The retired aggregate tag must also reject at runtime.
  root.hson`<retired/>`;
}, TypeError); });
check("narrow authoring exports no aggregate or subsystem facade", () => { assert.deepEqual(Object.keys(narrow).sort(), ["Hson", "TransformError", "is_transform_error", "read_transform_error_details"]); });
check("root facade exports preserve subsystem identities", () => { assert.equal(root.hsonTransform, transform.hsonTransform); assert.equal(root.hsonLiveMap, map.hsonLiveMap); assert.equal(root.hsonLiveTree, root.hson.liveTree); assert.equal(root.hsonLiveTree, hsonLiveTree); assert.equal(root.hsonLocus, root.hson.locus); assert.equal(root.hsonLocus, hsonLocus); assert.equal(root.hsonReflect, root.hson.reflect); assert.equal(root.hsonReflect, hsonReflect); assert.equal(root.hsonInspect, root.hson.inspect); assert.equal(root.hsonCalc, root.hson.transform.calc); });
emit_hson_live_test_completion("schema-hson-public", checks, checks, 0);
