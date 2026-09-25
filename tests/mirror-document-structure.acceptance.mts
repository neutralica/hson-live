// @hson-live-external-test
import assert from "node:assert/strict";
import { create_test_event_emitter } from "./test-events.mjs";
import { element, mount, path, projected_element, raw_node, commit_document_operations, registry_for_document_library } from "./helpers/mirror-unit6.mts";
import { hsonMirror } from "../src/api/mirror/mirror.facade.ts";
import { validate_document_path } from "../src/api/livemap/index.ts";
import { create_livetree } from "../src/api/livetree/creation/create-livetree.ts";
import { get_el_for_node } from "../src/api/livetree/utils/node-map-helpers.ts";
import { DocumentMirrorError, DOCUMENT_MIRROR_STRUCTURAL_UPDATE_FAILED_ERROR_CODE, DOCUMENT_MIRROR_UNSUPPORTED_OPERATION_ERROR_CODE } from "../src/api/mirror/mirror.document.error.ts";
import { FakeElement } from "./helpers/fake-document.mts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "mirror.document-structure",
  title: "Document Mirror structure",
  category: "Mirror",
  runtime: "node-synthetic-dom",
  tags: Object.freeze(["document", "binding", "structure"]),
});
const testEvents = create_test_event_emitter("mirror.document-structure");
let checks = 0;
function check(name: string, run: () => void): void {
  testEvents.case_begin(name, name);
  try {
    run();
    testEvents.case_end(name, "pass");
  } catch (error) {
    testEvents.diagnostic(name, "assertion", error instanceof Error ? error.message.slice(0, 1000) : "Check failed");
    testEvents.case_end(name, "fail");
    testEvents.terminal("fail");
    throw error;
  }
  process.stdout.write(`ok ${++checks} - ${name}\n`);
}

check("insert projects a Schema-valid child and routes its linked attributes", () => {
  const page = element(`<main <a title="first"/>/>`);
  const binding = hsonMirror(page);
  const dom = mount(binding.tree.node);
  page.document.content.insert(path(0), 1, projected_element(`<a title="second"/>`));
  const inserted = raw_node(binding.tree.node, [0, 1]);
  assert.equal((dom.childNodes[1] as FakeElement).tagName, "a");
  create_livetree(inserted).adoptRoots(binding.tree.hostRootNode()).attrs.set("bound", "yes");
  assert.equal(page.document.attrs.get(path(0, 1), "bound"), "yes");
  assert.equal(binding.sourceRevision, 2);
  binding.dispose();
});

check("remove reindexes surviving projected correspondence", () => {
  const page = element(`<main <a title="first"/> <a title="second"/>/>`);
  const binding = hsonMirror(page);
  const shifted = raw_node(binding.tree.node, [0, 1]);
  page.document.content.remove(path(0), 0);
  assert.equal(raw_node(binding.tree.node, [0, 0]), shifted);
  create_livetree(shifted).adoptRoots(binding.tree.hostRootNode()).attrs.set("after", true);
  assert.equal(page.document.attrs.get(path(0, 0), "after"), true);
  binding.dispose();
});

check("moves preserve the projected node and mounted DOM", () => {
  const page = element(`<main <a title="first"/> <a title="second"/>/>`);
  const binding = hsonMirror(page);
  mount(binding.tree.node);
  const moved = raw_node(binding.tree.node, [0, 0]);
  const dom = get_el_for_node(moved);
  page.document.content.move(path(0), 0, 1);
  assert.equal(raw_node(binding.tree.node, [0, 1]), moved);
  assert.equal(get_el_for_node(moved), dom);
  page.document.content.move(path(0), 1, 0);
  assert.equal(raw_node(binding.tree.node, [0, 0]), moved);
  binding.dispose();
});

check("compatible replacement lineage retains the exact projected root", () => {
  const page = element(`<main <a @000000408 title="old"/>/>`);
  const binding = hsonMirror(page);
  const original = raw_node(binding.tree.node, [0, 0]);
  page.document.content.replace(path(0), 0, projected_element(`<a title="new"/>`), [{ source: validate_document_path([]), destination: validate_document_path([]) }]);
  assert.equal(raw_node(binding.tree.node, [0, 0]), original);
  assert.equal(original.$_attrs?.title, "new");
  binding.dispose();
});

check("one registry aggregate stages structural and attribute operations together", () => {
  const page = element(`<main <a title="first"/>/>`);
  const binding = hsonMirror(page);
  commit_document_operations(page, [
    { domain: "graph", op: "insert-content", target: path(0), index: 1, content: projected_element(`<a title="second"/>`) },
    { domain: "graph", op: "set-attr", target: path(0, 1), name: "mixed", value: 1 },
    { domain: "graph", op: "move-content", target: path(0), from: 1, to: 0 },
  ]);
  assert.equal(raw_node(binding.tree.node, [0, 0]).$_attrs?.mixed, 1);
  assert.equal(binding.sourceRevision, 1);
  assert.equal(binding.diagnostics().updatesApplied, 1);
  binding.dispose();
});

check("foreign generated QUID insertion rejects before projection", () => {
  const page = element(`<main <a/>/>`);
  const binding = hsonMirror(page);
  const before = structuredClone(binding.tree.node);
  assert.throws(() => page.document.content.insert(path(0), 1, projected_element(`<a @000000414/>`)), /QUID|identity|portable/i);
  assert.deepEqual(binding.tree.node, before);
  assert.equal(page.rev, 0);
  binding.dispose();
});

check("bound structural mutation is rejected until Mirror disposal", () => {
  const page = element(`<main <a/>/>`);
  const binding = hsonMirror(page);
  const root = create_livetree(raw_node(binding.tree.node, [])).adoptRoots(binding.tree.hostRootNode());
  assert.throws(() => root.detachContents(), (error) => error instanceof DocumentMirrorError && error.code === DOCUMENT_MIRROR_UNSUPPORTED_OPERATION_ERROR_CODE);
  binding.dispose();
  root.detachContents();
});

check("DOM application failure leaves the accepted registry commit intact", () => {
  const page = element(`<main <a/>/>`);
  const binding = hsonMirror(page);
  const dom = mount(binding.tree.node);
  dom.failReplace = true;
  const commit = page.document.content.insert(path(0), 1, projected_element(`<a/>`));
  assert.equal(commit.changed, true);
  assert.equal(page.rev, 1);
  assert.equal(binding.status, "failed");
  assert.equal(binding.failure?.code, DOCUMENT_MIRROR_STRUCTURAL_UPDATE_FAILED_ERROR_CODE);
  binding.dispose();
});

check("registry snapshot restore rebuilds the reflected document", () => {
  const page = element(`<main <a title="old"/>/>`);
  const binding = hsonMirror(page);
  const replacement = element(`<main <a title="new"/>/>`);
  registry_for_document_library(page).restore(registry_for_document_library(replacement).capture());
  assert.equal(raw_node(binding.tree.node, [0, 0]).$_attrs?.title, "new");
  assert.equal(binding.status, "active");
  binding.dispose();
});

process.stdout.write(`Mirror document structure acceptance: ${checks}/${checks}\n`);
testEvents.terminal("pass");
