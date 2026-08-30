import assert from "node:assert/strict";
import { Hson, hsonLiveMap, type HsonSchema } from "../src/index.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

let checks = 0;
const check = (name: string, run: () => void): void => { run(); console.log(`ok ${++checks} - ${name}`); };

const PersonSchema: HsonSchema = Hson`<type "data" content <name "string" age "number">>`;
const OtherSchema: HsonSchema = Hson`<type "data" content <name "string">>`;

check("HsonSchema governs a data LiveMap and use returns the identical map", () => {
  const map = hsonLiveMap.fromJson({ name: "Ada", age: 37 });
  const governed = map.schema.use(PersonSchema);
  assert.equal(governed, map);
  assert.equal(map.schema.get(), PersonSchema);
  assert.equal(map.schema.use(PersonSchema), map);
});

check("HsonSchema rejects invalid mutation before changing state", () => {
  const map = hsonLiveMap.fromJson({ name: "Ada", age: 37 }).schema.use(PersonSchema);
  assert.throws(() => map.set(["age"], "wrong"));
  assert.deepEqual(map.snap(), { name: "Ada", age: 37 });
});

check("primitive union branches govern null values", () => {
  const schema: HsonSchema = Hson`<type "data" content <value <union ["string", "null"]>>>`;
  const map = hsonLiveMap.fromJson({ value: null }).schema.use(schema);
  assert.deepEqual(map.snap(), { value: null });
  map.set(["value"], "ready");
  assert.throws(() => map.set(["value"], 1));
});

check("one owner cannot switch Schema while independent owners can reuse it", () => {
  const first = hsonLiveMap.fromJson({ name: "Ada", age: 37 });
  const second = hsonLiveMap.fromJson({ name: "Grace", age: 40 });
  first.schema.use(PersonSchema);
  assert.throws(() => first.schema.use(OtherSchema), /already attached/);
  assert.equal(second.schema.use(PersonSchema), second);
});

check("document LiveMap governance consumes HsonSchema", () => {
  const schema: HsonSchema = Hson`<type "document" tag "main" content <sequence [<tag "section" content "string">]>>`;
  const map = hsonLiveMap.fromHson('<main <section "body"/>/>');
  assert.equal(map.mode, "element");
  if (map.mode !== "element") throw new Error("expected element map");
  assert.equal(map.schema.use(schema), map);
  assert.equal(map.schema.get(), schema);
  const invalid = hsonLiveMap.fromHson("<aside/>");
  assert.equal(invalid.mode, "element");
  if (invalid.mode !== "element") throw new Error("expected element map");
  assert.throws(() => invalid.schema.use(schema));
});

check("duplicate LiveMap namespace certification is retired", () => {
  assert.equal("schema" in hsonLiveMap, false);
});

emit_hson_live_test_completion("hson-schema-livemap-convergence", checks, checks, 0);
