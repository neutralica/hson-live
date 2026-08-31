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

check("published map.schema governance accepts HsonSchema", () => {
  const declaration = readFileSync(new URL("../dist/types/livemap.types.d.ts", import.meta.url), "utf8");
  assert.match(declaration, /use: <TGoverned = TValue>\(schema: HsonSchema\) => LiveMap<TGoverned>;/);
  assert.match(declaration, /get: \(\) => HsonSchema \| undefined/);
});

check("Hson certify is the sole generic certification operation", () => {
  const schema: root.HsonSchema = root.Hson`<type "data" content <age "number">>`;
  const canonical = root.Hson`<age 37>`;
  assert.equal(root.Hson.certify(schema, canonical), canonical);
  assert.throws(() => root.Hson.certify(schema, root.Hson`<age "37">`));
  for (const module of [root, narrow, map, transform]) assert.equal(Object.hasOwn(module, "validate"), false);
});

check("tag result stays primitive while callable owns certify", () => {
  const declaration = readFileSync(new URL("../dist/hson-authoring.d.ts", import.meta.url), "utf8");
  assert.match(declaration, /const Hson: typeof admit_hson &/);
  assert.equal(typeof root.Hson`37`, "string");
  assert.equal(Object.hasOwn(String.prototype, "certify"), false);
});

check("root and narrow authoring expose the identical frozen certify object", () => {
  assert.equal(root.Hson, narrow.Hson);
  assert.equal(Object.isFrozen(narrow.Hson), true);
  assert.deepEqual(Object.keys(narrow.Hson), ["certify"]);
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
  assert.equal(root.hsonReflect, root.hson.reflect);
  assert.equal(root.hsonReflect, hsonReflect);
});

emit_hson_live_test_completion("schema-hson-public", checks, checks, 0);
