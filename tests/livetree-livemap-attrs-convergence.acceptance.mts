// @hson-live-external-test
import assert from "node:assert/strict";
import { hson } from "../src/index.ts";
import { is_Node } from "../src/core/node-guards.ts";
import type { LiveTree } from "../src/api/livetree/livetree.ts";
import type { DocumentLiveMap } from "../src/types/livemap.types.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livetree-livemap.attrs-convergence",
  title: "LiveTree and LiveMap attrs/flags convergence",
  category: "LiveTree",
  runtime: "node",
  tags: Object.freeze(["attributes", "flags", "document", "canonical-graph", "externally-discoverable"]),
});

const testEvents = create_test_event_emitter("livetree-livemap.attrs-convergence");
let checks = 0;
function check(name: string, run: () => void): void {

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
  }
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function owners(source = `<main a="one" b="two" selected/>`): { tree: LiveTree; map: DocumentLiveMap } {
  const tree = hson.liveTree.fromHson(source);
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "document") throw new Error("Expected DocumentLiveMap");
  return { tree, map };
}

function assertAttrsEqual(tree: LiveTree, map: DocumentLiveMap): void {
  const ordinaryRoot = map.root().$_content[0];
  if (!is_Node(ordinaryRoot)) throw new Error("Expected one ordinary document root element");
  assert.deepEqual(tree.node.$_attrs, ordinaryRoot.$_attrs);
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
  const ordinaryRoot = map.root().$_content[0];
  if (!is_Node(ordinaryRoot)) throw new Error("Expected one ordinary document root element");
  const reconstructed = hson.liveTree.fromNode(structuredClone(ordinaryRoot));
  assert.equal(reconstructed.flags.has("selected"), true);
  assert.equal(reconstructed.attrs.get("selected"), "selected");
});

process.stdout.write(`# ${checks} LiveTree/LiveMap attrs and flags convergence checks passed\n`);
testEvents.terminal("pass");
