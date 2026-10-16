import { runtime_for_tree } from "../src/api/livetree/runtime/livetree-runtime.ts";
import type { HsonNode } from "../src/core/types.ts";
import { retained_subject, retained_historic_root } from "./helpers/retained-livetree-subject.mts";
// @hson-live-external-test
import assert from "node:assert/strict";
import { create_test_event_emitter } from "./test-events.mjs";
import { document_from_node, element, mount, path, projected_element, raw_node, commit_document_operations, registry_for_document_library } from "./helpers/mirror-unit6.mts";
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
  const dom = mount(retained_subject(binding.tree));
  page.document.content.insert(path(0), 1, projected_element(`<a title="second"/>`));
  const inserted = raw_node(retained_subject(binding.tree), [0, 1]);
  assert.equal((dom.childNodes[1] as FakeElement).tagName, "a");
  create_livetree(inserted).adoptRoots(retained_historic_root(binding.tree)).attrs.set("bound", "yes");
  assert.equal(page.document.attrs.get(path(0, 1), "bound"), "yes");
  assert.equal(binding.sourceRevision, 2);
  binding.dispose();
});

check("remove reindexes surviving projected correspondence", () => {
  const page = element(`<main <a title="first"/> <a title="second"/>/>`);
  const binding = hsonMirror(page);
  const shifted = raw_node(retained_subject(binding.tree), [0, 1]);
  page.document.content.remove(path(0), 0);
  assert.equal(raw_node(retained_subject(binding.tree), [0, 0]), shifted);
  create_livetree(shifted).adoptRoots(retained_historic_root(binding.tree)).attrs.set("after", true);
  assert.equal(page.document.attrs.get(path(0, 0), "after"), true);
  binding.dispose();
});

check("moves preserve the projected node and mounted DOM", () => {
  const page = element(`<main <a title="first"/> <a title="second"/>/>`);
  const binding = hsonMirror(page);
  mount(retained_subject(binding.tree));
  const moved = raw_node(retained_subject(binding.tree), [0, 0]);
  const dom = get_el_for_node(moved);
  page.document.content.move(path(0), 0, 1);
  assert.equal(raw_node(retained_subject(binding.tree), [0, 1]), moved);
  assert.equal(get_el_for_node(moved), dom);
  page.document.content.move(path(0), 1, 0);
  assert.equal(raw_node(retained_subject(binding.tree), [0, 0]), moved);
  binding.dispose();
});

check("attribute update retains the exact projected root", () => {
  const page = element(`<main <a @000000408 title="old"/>/>`);
  const binding = hsonMirror(page);
  const original = raw_node(retained_subject(binding.tree), [0, 0]);
  page.document.attrs.set(path(0, 0), "title", "new");
  assert.equal(raw_node(retained_subject(binding.tree), [0, 0]), original);
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
  assert.equal(raw_node(retained_subject(binding.tree), [0, 0]).$_attrs?.mixed, 1);
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
  const root = create_livetree(raw_node(retained_subject(binding.tree), [])).adoptRoots(retained_historic_root(binding.tree));
  assert.throws(() => root.detachContents(), (error) => error instanceof DocumentMirrorError && error.code === DOCUMENT_MIRROR_UNSUPPORTED_OPERATION_ERROR_CODE);
  binding.dispose();
  root.detachContents();
});

check("DOM application failure leaves the accepted registry commit intact", () => {
  const page = element(`<main <a/>/>`);
  const binding = hsonMirror(page);
  const dom = mount(retained_subject(binding.tree));
  const before = binding.tree.node, child = raw_node(retained_subject(binding.tree), [0, 0]), native = dom.childNodes[0];
  const runtime = runtime_for_tree(binding.tree), claims = [...runtime.quidToNode], issued = [...runtime.issuedQuids];
  dom.failReplace = true;
  const commit = page.document.content.insert(path(0), 1, projected_element(`<a/>`));
  assert.equal(commit.changed, true);
  assert.equal(page.rev, 1);
  assert.equal(binding.status, "failed");
  assert.equal(binding.failure?.code, DOCUMENT_MIRROR_STRUCTURAL_UPDATE_FAILED_ERROR_CODE);
  assert.deepEqual(binding.tree.node, before); assert.equal(dom.childNodes[0], native);
  assert.equal(raw_node(retained_subject(binding.tree), [0, 0]), child);
  assert.deepEqual([...runtime.quidToNode], claims); assert.deepEqual([...runtime.issuedQuids], issued);
  dom.failReplace = false;
  binding.dispose();
});

check("fresh inserted and replaced values materialize shared occurrences independently", () => {
  const n = (tag: string, ...content: HsonNode[]): HsonNode => ({ $_tag: tag, $_content: content });
  const incoming = (): HsonNode => { const p = n("p"); return n("section", n("_hson_elem", p, p)); };
  const page = document_from_node(n("_hson_root", n("main", n("_hson_elem", incoming()))));
  const binding = hsonMirror(page), dom = mount(retained_subject(binding.tree));
  try {
    page.document.content.insert(path(0), 1, incoming());
    let section = raw_node(retained_subject(binding.tree), [0, 1]), a = raw_node(section, [0, 0]), b = raw_node(section, [0, 1]);
    assert.notEqual(a, b); assert.notEqual(get_el_for_node(a), get_el_for_node(b));
    assert.equal((dom.childNodes[1] as FakeElement).childNodes.length, 2);
    create_livetree(a).adoptRoots(retained_historic_root(binding.tree)).attrs.set("title", "first only");
    assert.equal(b.$_attrs?.title, undefined); assert.equal(binding.status, "active");
    page.document.content.replace(path(0), 1, incoming());
    section = raw_node(retained_subject(binding.tree), [0, 1]); a = raw_node(section, [0, 0]); b = raw_node(section, [0, 1]);
    assert.notEqual(a, b); assert.notEqual(get_el_for_node(a), get_el_for_node(b));
    page.document.content.replace(path(0, 1), 0, incoming().$_content[0] as HsonNode);
    section = raw_node(retained_subject(binding.tree), [0, 1]);
    assert.notEqual(raw_node(section, [0, 0]), raw_node(section, [0, 1]));
    assert.equal((dom.childNodes[1] as FakeElement).childNodes.length, 2);
  } finally { binding.dispose(); }
});

check("registry snapshot restore rebuilds the reflected document", () => {
  const page = element(`<main <a title="old"/>/>`);
  const binding = hsonMirror(page);
  const replacement = element(`<main <a title="new"/>/>`);
  registry_for_document_library(page).restore(registry_for_document_library(replacement).capture());
  assert.equal(raw_node(retained_subject(binding.tree), [0, 0]).$_attrs?.title, "new");
  assert.equal(binding.status, "active");
  binding.dispose();
});

process.stdout.write(`Mirror document structure acceptance: ${checks}/${checks}\n`);
testEvents.terminal("pass");
