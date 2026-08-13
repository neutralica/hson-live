// @hson-live-external-test
import assert from "node:assert/strict";
import { hson } from "../src/index.ts";
import type { LiveTree } from "../src/api/livetree/livetree.ts";
import type { ElementLiveMap } from "../src/types/livemap.types.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

let checks = 0;
function check(name: string, run: () => void): void {
  run();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function owners(source = `<main a="one" b="two" selected/>`): { tree: LiveTree; map: ElementLiveMap } {
  const tree = hson.liveTree.fromHson(source);
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "element") throw new Error("Expected ElementLiveMap");
  return { tree, map };
}

function assertAttrsEqual(tree: LiveTree, map: ElementLiveMap): void {
  assert.deepEqual(tree.node.$_attrs, map.element.node().$_attrs);
  assert.deepEqual(tree.attrs.keys(), map.at([]).attrs.keys());
}

check("attrs.set converges", () => {
  const { tree, map } = owners();
  tree.attrs.set("a", false);
  map.at([]).attrs.set("a", false);
  assertAttrsEqual(tree, map);
});

check("attrs.setMany converges as a complete-bag PATCH", () => {
  const { tree, map } = owners();
  tree.attrs.setMany({ a: "next", count: 2 });
  map.at([]).attrs.setMany({ a: "next", count: 2 });
  assertAttrsEqual(tree, map);
  assert.equal(tree.attrs.get("b"), "two");
  assert.equal(tree.flags.has("selected"), true);
});

check("attrs.drop removes flag-form values under both owners", () => {
  const { tree, map } = owners();
  tree.attrs.drop("selected");
  map.at([]).attrs.drop("selected");
  assertAttrsEqual(tree, map);
});

check("attrs.dropMany converges atomically", () => {
  const { tree, map } = owners();
  tree.attrs.dropMany(["a", "selected", "missing", "a"]);
  map.at([]).attrs.dropMany(["a", "selected", "missing", "a"]);
  assertAttrsEqual(tree, map);
});

check("attrs.replace converges as exact complete-bag replacement", () => {
  const { tree, map } = owners();
  tree.attrs.replace({ only: null, style: { color: "red" } });
  map.at([]).attrs.replace({ only: null, style: { color: "red" } });
  assertAttrsEqual(tree, map);
});

check("attrs.clear converges on canonical absence", () => {
  const { tree, map } = owners();
  tree.attrs.clear();
  map.at([]).attrs.clear();
  assertAttrsEqual(tree, map);
  assert.equal(tree.node.$_attrs, undefined);
});

check("flags.set converges and overwrites ordinary values", () => {
  const { tree, map } = owners(`<main selected="other"/>`);
  tree.flags.set("selected", "active", "selected");
  map.at([]).flags.set("selected", "active", "selected");
  assertAttrsEqual(tree, map);
  assert.equal(tree.flags.has("selected"), map.at([]).flags.has("selected"));
});

check("flags.clear converges and preserves nonflag values", () => {
  const { tree, map } = owners(`<main selected ordinary="value"/>`);
  tree.flags.clear("selected", "ordinary", "missing");
  map.at([]).flags.clear("selected", "ordinary", "missing");
  assertAttrsEqual(tree, map);
  assert.equal(tree.attrs.get("ordinary"), "value");
});

check("same-name attrs and flags have identical reconstructed semantics", () => {
  const { tree, map } = owners(`<main/>`);
  tree.attrs.set("selected", "selected");
  map.at([]).flags.set("selected");
  assertAttrsEqual(tree, map);
  const reconstructed = hson.liveTree.fromNode(structuredClone(map.element.node()));
  assert.equal(reconstructed.flags.has("selected"), true);
  assert.equal(reconstructed.attrs.get("selected"), "selected");
});

process.stdout.write(`# ${checks} LiveTree/LiveMap attrs and flags convergence checks passed\n`);
emit_hson_live_test_completion("livetree-livemap.attrs-convergence", checks, checks, 0);
