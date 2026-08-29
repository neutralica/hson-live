// @hson-live-external-test
import assert from "node:assert/strict";
import { hson, LiveMapDocumentMutationError, LiveMapSchemaError } from "../src/index.ts";
import type { ElementLiveMap } from "../src/types/livemap.types.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

let checks = 0;
function check(name: string, run: () => void): void {
  run();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}
function element(source = `<button/>`): ElementLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "element") throw new Error(`Expected element, observed ${map.mode}`);
  return map;
}
const root = Object.freeze({ kind: "path" as const, path: Object.freeze([]) });

check("public flag vocabulary is plural, frozen, and contains only has/set/clear", () => {
  const map = element();
  const location = map.at([]) as unknown as Record<string, unknown>;
  assert.equal(Object.isFrozen(location.flags), true);
  assert.equal(Object.isFrozen(map.document.flags), true);
  assert.deepEqual(Object.keys(location.flags as object).sort(), ["clear", "has", "set"]);
  assert.deepEqual(Object.keys(map.document.flags).sort(), ["clear", "has", "set"]);
  assert.equal("flag" in location, false);
  assert.equal("style" in location, false);
  assert.equal("flag" in map.document, false);
  assert.equal("style" in map.document, false);
});

check("location flags expose presence over the complete canonical attrs bag", () => {
  const map = element();
  const location = map.at([]);
  assert.equal(location.flags.has("selected"), false);
  const commit = location.flags.set("selected");
  assert.equal(commit.changed, true);
  assert.equal(commit.ops.length, 1);
  assert.equal(commit.ops[0]?.op, "replace-attrs");
  assert.equal(location.flags.has("selected"), true);
  assert.equal(location.attrs.get("selected"), "selected");
  assert.equal(location.attrs.has("selected"), true);
  assert.deepEqual(location.attrs.keys(), ["selected"]);
});

check("attrs.set(name, name) creates exactly the same semantic flag state", () => {
  const map = element();
  map.at([]).attrs.set("selected", "selected");
  assert.equal(map.at([]).flags.has("selected"), true);
  assert.deepEqual(map.element.node().$_attrs, { selected: "selected" });
});

check("multi-set is atomic, overwrites ordinary values, and repeats are harmless", () => {
  const map = element(`<button selected="other"/>`);
  const before = map.rev;
  const commit = map.at([]).flags.set("selected", "active", "selected");
  assert.equal(map.rev, before + 1);
  assert.equal(commit.ops.length, 1);
  assert.equal(map.at([]).attrs.get("selected"), "selected");
  assert.equal(map.at([]).attrs.get("active"), "active");
  const noOp = map.at([]).flags.set("active", "selected");
  assert.equal(noOp.changed, false);
  assert.equal(map.rev, before + 1);
});

check("multi-set validates every name before mutation", () => {
  const map = element();
  const before = map.capture();
  assert.throws(() => map.at([]).flags.set("good", "bad name"), LiveMapDocumentMutationError);
  assert.equal(map.rev, before.rev);
  assert.deepEqual(map.capture().root, before.root);
});

check("clear removes exact flags and preserves ordinary values", () => {
  const map = element(`<button selected ordinary="value"/>`);
  map.at([]).flags.clear("selected", "ordinary", "missing", "selected");
  assert.equal(map.at([]).attrs.has("selected"), false);
  assert.equal(map.at([]).attrs.get("ordinary"), "value");
  const rev = map.rev;
  assert.equal(map.at([]).flags.clear("ordinary", "missing").changed, false);
  assert.equal(map.rev, rev);
});

check("ordinary attr mutation can create, change, and remove flag form", () => {
  const map = element();
  map.at([]).attrs.set("x", "x");
  assert.equal(map.at([]).flags.has("x"), true);
  map.at([]).attrs.set("x", "other");
  assert.equal(map.at([]).flags.has("x"), false);
  map.at([]).flags.clear("x");
  assert.equal(map.at([]).attrs.get("x"), "other");
  map.at([]).attrs.drop("x");
  assert.equal(map.at([]).attrs.has("x"), false);
});

check("explicit-target document flags share location semantics", () => {
  const map = element();
  map.document.flags.set(root, "selected", "active");
  assert.equal(map.document.flags.has(root, "selected"), true);
  map.document.flags.clear(root, "selected");
  assert.equal(map.document.flags.has(root, "selected"), false);
  assert.equal(map.document.flags.has(root, "active"), true);
});

check("style rejects atomically on location and explicit-target surfaces", () => {
  for (const invoke of [
    (map: ElementLiveMap) => map.at([]).flags.set("style"),
    (map: ElementLiveMap) => map.document.flags.set(root, "style"),
  ]) {
    const map = element();
    map.at([]).attrs.set("style", { color: "red" });
    const before = map.capture();
    assert.throws(() => invoke(map), LiveMapDocumentMutationError);
    assert.equal(map.rev, before.rev);
    assert.deepEqual(map.capture().root, before.root);
  }
});

check("flag transitions obey attached schemas without publishing invalid candidates", () => {
  const Schema = hson.liveMap.schema.define((s) => s.button(s.attrs.exact({
    selected: s.flag,
    optional: s.flag.optional,
    text: s.string.optional,
    count: s.number.optional,
  })));
  const map = element(`<button selected/>`).schema.use(Schema);
  const before = map.rev;
  assert.throws(() => map.at([]).flags.clear("selected"), LiveMapSchemaError);
  assert.throws(
    () => Reflect.apply(map.at([]).flags.set, map.at([]).flags, ["count"]),
    LiveMapSchemaError,
  );
  assert.equal(map.rev, before);
  map.at([]).flags.set("optional");
  assert.equal(map.at([]).flags.has("optional"), true);
});

check("flag commits use path authority without minting QUIDs", () => {
  const map = element();
  assert.equal(map.element.node().$_meta, undefined);
  map.at([]).flags.set("selected");
  assert.equal(map.element.node().$_meta, undefined);
  map.at([]).flags.clear("selected");
  assert.equal(map.element.node().$_meta, undefined);
});

check("capture and reconstruction preserve flag semantics without metadata", () => {
  const map = element();
  map.at([]).flags.set("selected");
  const reconstructed = hson.liveMap.fromNode(map.capture().root);
  if (reconstructed.mode !== "element") throw new Error("Expected reconstructed element");
  assert.equal(reconstructed.at([]).flags.has("selected"), true);
  assert.equal(reconstructed.element.node().$_meta, undefined);
});

check("canonical flag state uses existing Hson and HTML serializers", () => {
  const map = element();
  map.at([]).flags.set("selected");
  const node = map.element.node();
  assert.equal(hson.fromNode(node).toHson().serialize().includes("selected"), true);
  assert.equal(hson.fromNode(node).toHtml().serialize().includes("selected"), true);
  assert.deepEqual(node.$_attrs, { selected: "selected" });
});

process.stdout.write(`# ${checks} LiveMap flag checks passed\n`);
emit_hson_live_test_completion("livemap.document-flags", checks, checks, 0);
