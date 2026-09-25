// @hson-live-external-test
import assert from "node:assert/strict";
import { create_test_event_emitter } from "./test-events.mjs";
import { element, registry_for_document_library, raw_node } from "./helpers/mirror-unit6.mts";
import { hsonMirror } from "../src/api/mirror/mirror.facade.ts";
import { create_livetree } from "../src/api/livetree/creation/create-livetree.ts";
import { get_el_for_node } from "../src/api/livetree/utils/node-map-helpers.ts";
import { project_livetree } from "../src/api/livetree/creation/project-live-tree.ts";
import { FakeElement } from "./helpers/fake-document.mts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "mirror.document-root",
  title: "Document Mirror registry root restoration",
  category: "Mirror",
  runtime: "node-synthetic-dom",
  tags: Object.freeze(["document", "binding", "root"]),
});

const events = create_test_event_emitter("mirror.document-root");
let checks = 0;
function check(name: string, run: () => void): void {
  events.case_begin(name, name);
  try { run(); events.case_end(name, "pass"); }
  catch (error) {
    events.diagnostic(name, "assertion", error instanceof Error ? error.message : String(error));
    events.case_end(name, "fail"); events.terminal("fail"); throw error;
  }
  process.stdout.write(`ok ${++checks} - ${name}\n`);
}

function restore(target: ReturnType<typeof element>, source: ReturnType<typeof element>): void {
  registry_for_document_library(target).restore(registry_for_document_library(source).capture());
}

check("registry restoration constructs a fresh reflected root and DOM", () => {
  const map = element(`<main @000000501 class="old" <p "old"/>/>`);
  const binding = hsonMirror(map);
  const originalTree = binding.tree;
  const originalRoot = raw_node(originalTree.node, []);
  const originalDom = project_livetree(originalRoot) as unknown as FakeElement;
  const source = element(`<main @000000501 class="new" <p "next"/>/>`);
  source.document.attrs.set({ kind: "path", path: [0] }, "revision", 1);
  restore(map, source);
  const nextRoot = raw_node(binding.tree.node, []);
  assert.equal(binding.status, "active");
  assert.notEqual(binding.tree, originalTree);
  assert.notEqual(nextRoot, originalRoot);
  assert.notEqual(get_el_for_node(nextRoot), originalDom);
  assert.equal(originalTree.isDisposed, true);
  assert.equal(nextRoot.$_attrs?.class, "new");
  assert.equal(binding.sourceRevision, 1);
  create_livetree(raw_node(nextRoot, [0, 0])).adoptRoots(nextRoot).attrs.set("after", "restore");
  assert.equal(map.document.attrs.get({ kind: "path", path: [0, 0, 0] }, "after"), "restore");
  binding.dispose();
});

check("portable restoration leaves foreign QUIDs out of the new projection", () => {
  const map = element(`<main @000000506/>`);
  const binding = hsonMirror(map);
  const oldRoot = binding.tree.node;
  restore(map, element(`<main @000000507/>`));
  assert.notEqual(binding.tree.node, oldRoot);
  assert.equal(raw_node(binding.tree.node, []).$_meta?.quid, undefined);
  assert.equal(binding.status, "active");
  binding.dispose();
});

check("identical registry restoration creates a fresh Mirror epoch", () => {
  const map = element(`<main class="same"/>`);
  const binding = hsonMirror(map);
  const originalTree = binding.tree;
  restore(map, element(`<main class="same"/>`));
  assert.notEqual(binding.tree, originalTree);
  assert.equal(binding.diagnostics().updatesApplied, 1);
  binding.dispose();
});

check("restoration avoids stale DOM convergence hooks", () => {
  const map = element(`<main <a/>/>`);
  const binding = hsonMirror(map);
  const oldTree = binding.tree;
  const oldDom = project_livetree(oldTree.node) as unknown as FakeElement;
  let calls = 0;
  oldDom.beforeReplace = () => { calls += 1; };
  restore(map, element(`<main <a title="new"/>/>`));
  assert.equal(calls, 0);
  assert.notEqual(binding.tree, oldTree);
  assert.equal(oldTree.isDisposed, true);
  binding.dispose();
});

events.terminal("pass");
process.stdout.write(`# ${checks} registry document root checks passed\n`);
