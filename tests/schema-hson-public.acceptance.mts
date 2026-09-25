import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as root from "hson-live";
import * as narrow from "hson-live/hson";
import * as map from "hson-live/livemap";
import * as transform from "hson-live/transform";
import { hsonLiveTree } from "hson-live/livetree";
import { hsonLocus } from "hson-live/locus";
import { hsonMirror } from "hson-live/mirror";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "schema-hson-public",
  title: "Hson Schema public facade boundaries",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["schema", "public-boundary"]),
});

const testEvents = create_test_event_emitter("schema-hson-public");
let checks = 0;
function check(name: string, run: () => void) {
  testEvents.case_begin(name, name);
  try {
    run();
    testEvents.case_end(name, "pass");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Check failed.";
    testEvents.diagnostic(name, "assertion", message.slice(0, 1_000));
    testEvents.case_end(name, "fail");
    testEvents.terminal("fail");
    throw error;
  } console.log(`ok ${++checks} - ${name}`); }

check("HsonSchema is the only exported Schema authority", () => {
  const rootDeclaration = readFileSync(new URL("../dist/index.d.ts", import.meta.url), "utf8");
  const mapDeclaration = readFileSync(new URL("../dist/api/livemap/index.d.ts", import.meta.url), "utf8");
  assert.match(rootDeclaration, /HsonSchema/);
  assert.doesNotMatch(rootDeclaration, /export type \{[^}]*LiveMapSchema/);
  assert.doesNotMatch(mapDeclaration, /export type \{[^}]*LiveMapSchema/);
});

check("published LiveMap facade has no builder or duplicate validation namespace", () => {
  const declaration = readFileSync(new URL("../dist/api/livemap/livemap.facade.d.ts", import.meta.url), "utf8");
  assert.doesNotMatch(declaration, /schema:/);
  assert.doesNotMatch(declaration, /validate:/);
  assert.doesNotMatch(declaration, /LiveMapSchema/);
});

check("named library Schemas are fixed at construction and retain type evidence", () => {
  const declaration = readFileSync(new URL("../dist/types/livemap.types.d.ts", import.meta.url), "utf8");
  assert.match(declaration, /export type LiveMapDataLibraryInput<.*schema: TSchema;/s);
  assert.match(declaration, /export type LiveMapDocumentLibraryInput<.*schema: TSchema;/s);
  assert.match(declaration, /schema: Readonly<\{\s*get: \(\) => TSchema;\s*\}>;/);
  const schema = root.Hson.schema`<type "data" content <age "number">>`;
  const registry = root.hsonLiveMap.fromLibraries({ state: { data: { age: 37 }, schema } });
  assert.equal(registry.lib("state").schema.get(), schema);
  assert.equal("use" in registry.lib("state").schema, false);
});

check("Schema object owns certification and portable Schema data", () => {
  const schema: root.HsonSchema = root.Hson.schema`<type "data" content <age "number">>`;
  const canonical = root.Hson.canonical`<age 37>`;
  assert.equal(schema.certify(canonical), canonical);
  assert.throws(() => schema.certify(root.Hson.canonical`<age "37">`));
  assert.equal(typeof schema, "object");
  assert.equal(Object.isFrozen(schema), true);
  assert.equal(typeof schema.toHson(), "string");
  const restored = root.Hson.schema.fromHson(schema.toHson());
  assert.notEqual(restored, schema);
  assert.equal(restored.toHson(), schema.toHson());
  assert.equal(restored.certify(canonical), canonical);
  assert.throws(() => root.Hson.schema.fromHson(` ${schema.toHson()}` as root.HsonSchemaData), /canonical/);
  assert.throws(() => schema.certify(` <age 37>` as root.HsonCanonical), /canonical/);
  for (const module of [root, narrow, map, transform]) assert.equal(Object.hasOwn(module, "validate"), false);
});

check("semantic values stay primitive while Hson is a noncallable namespace", () => {
  const declaration = readFileSync(new URL("../dist/hson-authoring.d.ts", import.meta.url), "utf8");
  assert.match(declaration, /export declare const Hson: Readonly/);
  assert.equal(typeof root.Hson.canonical`37`, "string");
  assert.equal(typeof root.Hson.data`37`, "string");
  assert.equal(typeof root.Hson.document`<main/>`, "string");
  assert.throws(() => (root.Hson as unknown as Function)(), TypeError);
  assert.equal(Object.hasOwn(String.prototype, "certify"), false);
});

check("root and narrow authoring expose the identical frozen namespace", () => {
  assert.equal(root.Hson, narrow.Hson);
  assert.equal(Object.isFrozen(narrow.Hson), true);
  assert.deepEqual(Object.keys(narrow.Hson), ["canonical", "data", "document", "schema"]);
  assert.equal(Object.hasOwn(narrow.Hson, "validate"), false);
});

check("lowercase aggregate remains frozen and noncallable", () => {
  assert.equal(typeof root.hson, "object");
  assert.equal(Object.isFrozen(root.hson), true);
  assert.throws(() => {
    // @ts-expect-error The aggregate is not a tag.
    root.hson`<retired/>`;
  }, TypeError);
});

check("narrow authoring exports no aggregate or subsystem facade", () => {
  assert.deepEqual(Object.keys(narrow).sort(), ["Hson", "TransformError", "is_transform_error", "read_transform_error_details"]);
});

check("root facade exports preserve subsystem identities", () => {
  assert.equal(root.hsonTransform, transform.hsonTransform);
  assert.equal(root.hsonLiveMap, map.hsonLiveMap);
  assert.equal(root.hsonLiveTree, root.hson.liveTree);
  assert.equal(root.hsonLiveTree, hsonLiveTree);
  assert.equal(root.hsonLocus, root.hson.locus);
  assert.equal(root.hsonLocus, hsonLocus);
  assert.equal(root.hsonMirror, root.hson.mirror);
  assert.equal(root.hsonMirror, hsonMirror);
});

testEvents.terminal("pass");
