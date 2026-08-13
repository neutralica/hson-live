// @hson-live-external-test
import assert from "node:assert/strict";
import { hson } from "../src/index.ts";
import { internal_livemap_root } from "../src/api/livemap/livemap.internal.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

let checks = 0;
function check(name: string, run: () => void): void {
  run();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

check("projected maps expose no public canonical debug namespace", () => {
  const map = hson.liveMap.fromJson({ value: 0 });
  assert.equal("debug" in map, false);
  assert.equal("node" in map, false);
});

check("document maps expose no public canonical debug namespace", () => {
  const map = hson.liveMap.fromHson(`<main/>`);
  assert.equal("debug" in map, false);
  assert.equal("node" in map, false);
});

check("schema-less maps retain ordinary governed mutation APIs", () => {
  const map = hson.liveMap.fromJson({ value: 0, items: [1] });
  map.set(["value"], 1);
  map.at(["items"]).array.push(2);
  assert.deepEqual(map.snap(), { value: 1, items: [1, 2] });
});

check("caller-owned JSON input is detached at construction", () => {
  const input = { nested: { value: 1 }, items: [1] };
  const map = hson.liveMap.fromJson(input);
  input.nested.value = 9;
  input.items.push(2);
  assert.deepEqual(map.snap(), { nested: { value: 1 }, items: [1] });
});

check("caller-owned HSON input is detached at construction", () => {
  const input = hson.fromJson({ value: 1 }).toNode();
  const map = hson.liveMap.fromNode(input);
  if (map.mode !== "data-object") throw new Error(`expected data-object, observed ${map.mode}`);
  input.$_content.length = 0;
  assert.deepEqual(map.snap(), { value: 1 });
});

check("snap returns detached projected values", () => {
  const map = hson.liveMap.fromJson({ nested: { value: 1 } });
  const value = map.snap() as { nested: { value: number } };
  value.nested.value = 9;
  assert.deepEqual(map.snap(), { nested: { value: 1 } });
});

check("root returns a detached canonical graph", () => {
  const map = hson.liveMap.fromJson({ value: 1 });
  const root = map.root();
  root.$_content.length = 0;
  assert.deepEqual(map.snap(), { value: 1 });
});

check("watch payload mutation cannot alter canonical state", () => {
  const map = hson.liveMap.fromJson({ nested: { value: 1 } });
  map.at([]).watch((next) => {
    (next as { nested: { value: number } }).nested.value = 99;
  });
  map.set(["nested", "value"], 2);
  assert.deepEqual(map.snap(), { nested: { value: 2 } });
});

check("feed payload mutation cannot alter canonical state", () => {
  const map = hson.liveMap.fromJson({ nested: { value: 1 } });
  map.feed([], (event) => {
    (event.value as { nested: { value: number } }).nested.value = 99;
  });
  map.set(["nested", "value"], 2);
  assert.deepEqual(map.snap(), { nested: { value: 2 } });
});

check("locations expose detached reads and mediated writes only", () => {
  const map = hson.liveMap.fromJson({ nested: { value: 1 } });
  const location = map.at(["nested"]);
  assert.equal("node" in location, false);
  assert.equal("debug" in location, false);
  const value = location.snap() as { value: number };
  value.value = 9;
  assert.deepEqual(location.snap(), { value: 1 });
});

check("proxies expose mediated locations rather than raw nodes", () => {
  const map = hson.liveMap.fromJson({ nested: { value: 1 } });
  const proxy = map.proxy(["nested", "value"]);
  assert.equal("node" in proxy, false);
  assert.equal("debug" in proxy, false);
  proxy.$_.set(2);
  assert.deepEqual(map.snap(), { nested: { value: 2 } });
});

check("schema queries expose immutable owner-independent evidence", () => {
  const schema = hson.liveMap.schema.define((s) => s.object.exact({ value: s.number }));
  const map = hson.liveMap.fromJson({ value: 1 }).schema.use(schema);
  const rule = map.schema.match(["value"]);
  assert.equal(map.schema.get(), schema);
  assert.equal(Object.isFrozen(schema), true);
  assert.equal(Object.isFrozen(rule), true);
  assert.equal("root" in (rule ?? {}), false);
});

check("capture values are detached from canonical ownership", () => {
  const map = hson.liveMap.fromJson({ nested: { value: 1 } });
  const capture = map.capture();
  if (!("value" in capture)) throw new Error("expected projected capture");
  (capture.value as { nested: { value: number } }).nested.value = 9;
  assert.deepEqual(map.snap(), { nested: { value: 1 } });
});

check("schema attachment validates and records without swapping canonical ownership", () => {
  const map = hson.liveMap.fromJson({ value: 1 });
  const schema = hson.liveMap.schema.define((s) => s.object.exact({ value: s.number }));
  const before = internal_livemap_root(map);
  map.schema.use(schema);
  assert.equal(internal_livemap_root(map), before);
});

check("document observations are equally detached", () => {
  const map = hson.liveMap.fromHson(`<main title="owned" "x"/>`);
  if (map.mode !== "element") throw new Error(`expected element, observed ${map.mode}`);
  const root = map.root();
  const capture = map.capture();
  root.$_content.length = 0;
  capture.root.$_content.length = 0;
  assert.equal(map.document.attrs.get({ kind: "path", path: [] }, "title"), "owned");
  assert.equal(map.at([0]).snap(), "x");
});

process.stdout.write(`# ${checks} canonical ownership checks passed\n`);
emit_hson_live_test_completion("livemap.canonical-ownership", checks, checks, 0);
