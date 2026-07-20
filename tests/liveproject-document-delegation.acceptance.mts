import assert from "node:assert/strict";
import { hson } from "../src/index.ts";
import { is_Node } from "../src/core/node-guards.ts";
import type { HsonNode } from "../src/core/types.ts";
import type { ElementLiveMap, LiveMapCommitObservation } from "../src/types/livemap.types.ts";
import { bind_document_livetree } from "../src/api/liveproject/liveproject.document.ts";
import {
  DOCUMENT_BINDING_DELEGATION_ROOT_FORBIDDEN_ERROR_CODE,
  DOCUMENT_BINDING_DELEGATION_UNSUPPORTED_ERROR_CODE,
  DOCUMENT_BINDING_STRUCTURAL_PROJECTION_FAILED_ERROR_CODE,
  DocumentLiveTreeBindingError,
} from "../src/api/liveproject/liveproject.document.error.ts";
import { create_livetree } from "../src/api/livetree/creation/create-livetree.ts";
import { project_livetree } from "../src/api/livetree/creation/project-live-tree.ts";
import { get_el_for_node } from "../src/api/livetree/utils/node-map-helpers.ts";
import { FakeElement, FakeText, install_fake_document } from "./helpers/fake-document.mts";

install_fake_document();

let checks = 0;
function check(name: string, fn: () => void): void {
  fn();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function element(source: string): ElementLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "element") throw new Error("Expected ElementLiveMap");
  return map;
}

function path(...segments: number[]) {
  return { kind: "path" as const, path: segments };
}

function raw_node(root: HsonNode, rawPath: readonly number[]): HsonNode {
  let current = root;
  for (const segment of rawPath) {
    const child = current.$_content[segment];
    if (!is_Node(child)) throw new Error(`Expected node at ${rawPath.join("/")}`);
    current = child;
  }
  return current;
}

function projected_element(source: string): HsonNode {
  return element(source).element.node();
}

function mount(root: HsonNode): FakeElement {
  return project_livetree(root) as unknown as FakeElement;
}

check("bound text.set delegates one replacement while preserving element content", () => {
  const map = element(`<main data-_quid="0000000000000501" "old" <b data-_quid="0000000000000502"/>/>`);
  const binding = bind_document_livetree(map);
  const rootDom = mount(binding.tree.node);
  const preserved = raw_node(binding.tree.node, [0, 1]);
  const preservedDom = get_el_for_node(preserved);
  const observations: LiveMapCommitObservation[] = [];
  map.commits.observe((event) => observations.push(event));

  for (const value of ["next", 0, false, null] as const) {
    assert.equal(binding.tree.text.set(value), binding.tree);
  }
  const revision = map.rev;
  const transactions = binding.diagnostics().projectionTransactions;
  const writes = rootDom.replaceWrites;
  binding.tree.text.set("");
  assert.equal(map.rev, revision);
  assert.equal(binding.diagnostics().projectionTransactions, transactions);
  assert.equal(rootDom.replaceWrites, writes);
  assert.equal(observations.length, 4);
  assert.equal(transactions, 4);
  assert.equal(raw_node(map.element.node(), [0, 0]).$_content[0], "");
  assert.equal(raw_node(binding.tree.node, [0, 1]), preserved);
  assert.equal(get_el_for_node(preserved), preservedDom);
  assert.ok(rootDom.childNodes[0] instanceof FakeText);
  assert.equal((rootDom.childNodes[0] as FakeText).data, "");
  binding.dispose();
});

check("text.set inserts one canonical text slot when the bucket has no text", () => {
  const map = element(`<main data-_quid="0000000000000503" <b/>/>`);
  const binding = bind_document_livetree(map);
  mount(binding.tree.node);
  binding.tree.text.set("first");
  const bucket = raw_node(map.element.node(), [0]);
  assert.equal(raw_node(map.element.node(), [0, 0]).$_content[0], "first");
  assert.equal((bucket.$_content[1] as HsonNode).$_tag, "b");
  assert.equal(binding.diagnostics().projectionTransactions, 1);
  binding.dispose();
});

check("text.add and text.insert map to exact raw _hson_elem insertion slots", () => {
  const map = element(`<main data-_quid="0000000000000504" "a" <b/>/>`);
  const binding = bind_document_livetree(map);
  const rootDom = mount(binding.tree.node);
  const observations: LiveMapCommitObservation[] = [];
  map.commits.observe((event) => observations.push(event));
  assert.equal(binding.tree.text.add(0), binding.tree);
  assert.equal(binding.tree.text.insert(1, false), binding.tree);
  const canonicalBucket = raw_node(map.element.node(), [0]);
  assert.deepEqual(canonicalBucket.$_content.map((item) => is_Node(item)
    ? item.$_tag === "_hson_str" ? `${item.$_tag}:${String(item.$_content[0] ?? "")}` : item.$_tag
    : item), [
    "_hson_str:a", "_hson_str:false", "b", "_hson_str:0",
  ]);
  assert.deepEqual([...rootDom.childNodes].map((item) => item instanceof FakeText ? item.data : (item as FakeElement).tagName), ["a", "false", "b", "0"]);
  assert.equal(observations.length, 2);
  assert.equal(binding.diagnostics().projectionTransactions, 2);
  binding.dispose();

  const empty = element(`<main data-_quid="0000000000000505"/>`);
  const emptyBinding = bind_document_livetree(empty);
  emptyBinding.tree.text.add(null);
  assert.equal(raw_node(empty.element.node(), [0, 0]).$_content[0], "");
  assert.equal(emptyBinding.diagnostics().projectionTransactions, 1);
  emptyBinding.dispose();
});

check("empty delegates only zero-or-one physical content slots", () => {
  const map = element(`<main data-_quid="0000000000000506" <section data-_quid="0000000000000507" "inside"/>/>`);
  const binding = bind_document_livetree(map);
  mount(binding.tree.node);
  const sectionNode = raw_node(binding.tree.node, [0, 0]);
  const sectionTree = create_livetree(sectionNode).adoptRoots(binding.tree.hostRootNode());
  const sectionDom = get_el_for_node(sectionNode) as unknown as FakeElement;
  const observations: LiveMapCommitObservation[] = [];
  map.commits.observe((event) => observations.push(event));
  assert.equal(sectionTree.empty(), sectionTree);
  assert.equal(raw_node(map.element.node(), [0, 0]).$_content.length, 0);
  assert.equal(sectionDom.childNodes.length, 0);
  const revision = map.rev;
  const transactions = binding.diagnostics().projectionTransactions;
  const writes = sectionDom.replaceWrites;
  sectionTree.empty();
  assert.equal(map.rev, revision);
  assert.equal(binding.diagnostics().projectionTransactions, transactions);
  assert.equal(sectionDom.replaceWrites, writes);
  assert.equal(observations.length, 1);
  assert.equal(binding.tree.empty(), binding.tree);
  assert.equal(map.element.node().$_content.length, 0);
  assert.equal((get_el_for_node(binding.tree.node) as unknown as FakeElement).childNodes.length, 0);
  assert.equal(observations.length, 2);
  assert.equal(binding.diagnostics().projectionTransactions, 2);
  binding.dispose();
});

check("nested remove and removeSelf delegate one raw parent-slot removal", () => {
  const map = element(`<main data-_quid="0000000000000508" <a data-_quid="0000000000000509"/> <b/> <c/>/>`);
  const binding = bind_document_livetree(map);
  mount(binding.tree.node);
  const aNode = raw_node(binding.tree.node, [0, 0]);
  const bNode = raw_node(binding.tree.node, [0, 1]);
  const cNode = raw_node(binding.tree.node, [0, 2]);
  const aTree = create_livetree(aNode).adoptRoots(binding.tree.hostRootNode());
  const bTree = create_livetree(bNode).adoptRoots(binding.tree.hostRootNode());
  const observations: LiveMapCommitObservation[] = [];
  map.commits.observe((event) => observations.push(event));
  assert.equal(bTree.remove(), 1);
  assert.equal(raw_node(binding.tree.node, [0, 1]), cNode);
  create_livetree(cNode).adoptRoots(binding.tree.hostRootNode()).attrs.set("shifted", "yes");
  assert.equal(map.document.attrs.get(path(0, 1), "shifted"), "yes");
  assert.equal(aTree.removeSelf(), 1);
  assert.equal(raw_node(map.element.node(), [0, 0]).$_tag, "c");
  assert.equal(observations.length, 3);
  assert.equal(binding.diagnostics().projectionTransactions, 3);
  assert.throws(() => binding.tree.remove(), (cause) => cause instanceof DocumentLiveTreeBindingError
    && cause.code === DOCUMENT_BINDING_DELEGATION_ROOT_FORBIDDEN_ERROR_CODE);
  assert.equal(binding.status, "active");
  binding.dispose();
});

check("replayed path changes are used by later text delegation", () => {
  const map = element(`<main data-_quid="0000000000000510" <a "left"/> <b "right"/>/>`);
  const binding = bind_document_livetree(map);
  const bNode = raw_node(binding.tree.node, [0, 1]);
  const bTree = create_livetree(bNode).adoptRoots(binding.tree.hostRootNode());
  map.replay({
    changed: true,
    prevRev: 0,
    rev: 1,
    ops: [{ domain: "graph", op: "move-content", target: path(0), from: 1, to: 0 }],
  });
  bTree.text.set("moved");
  assert.equal(raw_node(map.element.node(), [0, 0, 0, 0]).$_content[0], "moved");
  assert.equal(binding.sourceRevision, 2);
  assert.equal(binding.diagnostics().projectionTransactions, 2);
  binding.dispose();
});

check("ambiguous and lifecycle-incompatible APIs remain rejected", () => {
  const map = element(`<main data-_quid="0000000000000511" "one" "two"/>`);
  map.document.content.insert(path(), 1, projected_element(`<aside/>`));
  const binding = bind_document_livetree(map);
  const branch = create_livetree(projected_element(`<aside/>`));
  const before = structuredClone(binding.tree.node);
  for (const mutation of [
    () => binding.tree.text.set("collapsed"),
    () => binding.tree.text.overwrite("all"),
    () => binding.tree.empty(),
    () => binding.tree.append(branch),
    () => binding.tree.create.div(),
    () => binding.tree.detach(),
    () => binding.tree.detachContents(),
    () => binding.tree.removeChildren(),
  ]) {
    assert.throws(mutation, (cause) => cause instanceof DocumentLiveTreeBindingError
      && (cause.code === DOCUMENT_BINDING_DELEGATION_UNSUPPORTED_ERROR_CODE
        || cause.code === "DOCUMENT_BINDING_UNSUPPORTED_OPERATION"));
  }
  assert.deepEqual(binding.tree.node, before);
  assert.equal(map.rev, 1);
  assert.equal(binding.status, "active");
  binding.dispose();
});

check("projection failure after delegated canonical success fails without escaping", () => {
  const map = element(`<main data-_quid="0000000000000512"/>`);
  const binding = bind_document_livetree(map);
  const rootDom = mount(binding.tree.node);
  rootDom.failReplace = true;
  assert.equal(binding.tree.text.add("canonical"), binding.tree);
  assert.equal(map.rev, 1);
  assert.equal(binding.status, "failed");
  assert.equal(binding.failure?.code, DOCUMENT_BINDING_STRUCTURAL_PROJECTION_FAILED_ERROR_CODE);
  assert.equal(binding.sourceRevision, 0);
  assert.throws(() => binding.tree.text.set("blocked"), DocumentLiveTreeBindingError);
  binding.dispose();
  binding.tree.text.overwrite("unbound");
  assert.equal(binding.tree.text.get(), "unbound");
});

process.stdout.write(`# ${checks} bound document mutation delegation checks passed\n`);
