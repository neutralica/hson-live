import assert from "node:assert/strict";
import { hson } from "../src/index.ts";
import { is_Node } from "../src/core/node-guards.ts";
import type { HsonNode } from "../src/core/types.ts";
import type { ElementLiveMap } from "../src/types/livemap.types.ts";
import { bind_document_livetree } from "../src/api/liveproject/liveproject.document.ts";
import {
  DOCUMENT_BINDING_QUID_COLLISION_ERROR_CODE,
  DOCUMENT_BINDING_DELEGATION_UNSUPPORTED_ERROR_CODE,
  DOCUMENT_BINDING_ROOT_KIND_MISMATCH_ERROR_CODE,
  DOCUMENT_BINDING_STRUCTURAL_PROJECTION_FAILED_ERROR_CODE,
  DOCUMENT_BINDING_UNSUPPORTED_OPERATION_ERROR_CODE,
  DocumentLiveTreeBindingError,
} from "../src/api/liveproject/liveproject.document.error.ts";
import { create_livetree } from "../src/api/livetree/creation/create-livetree.ts";
import { project_livetree } from "../src/api/livetree/creation/project-live-tree.ts";
import { get_el_for_node } from "../src/api/livetree/utils/node-map-helpers.ts";
import { FakeElement, FakeText, install_fake_document } from "./helpers/fake-document.mts";

let checks = 0;
function check(name: string, fn: () => void): void {
  fn();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

install_fake_document();

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

check("nested raw insertion projects elements, QUID-less nodes, wrappers, and text", () => {
  const map = element(`<main data-_quid="0000000000000401" <a data-_quid="0000000000000402"/> <b/> "tail"/>`);
  const binding = bind_document_livetree(map);
  const rootDom = mount(binding.tree.node);
  map.document.content.insert(path(0), 1, projected_element(`<c data-_quid="0000000000000403" "inside"/>`));
  map.document.content.insert(path(0), 2, projected_element(`<d/>`));
  map.document.content.insert(path(0), 3, "middle");
  const wrapper = raw_node(binding.tree.node, [0]);
  assert.deepEqual(wrapper.$_content.map((item) => is_Node(item) ? item.$_tag : item), ["a", "c", "d", "_hson_str", "b", "_hson_str"]);
  assert.deepEqual([...rootDom.childNodes].map((node) => node instanceof FakeElement ? node.tagName : (node as FakeText).data), ["a", "c", "d", "middle", "b", "tail"]);
  const cDom = rootDom.childNodes[1];
  assert.ok(cDom instanceof FakeElement);
  assert.equal((cDom.childNodes[0] as FakeText).data, "inside");
  const insertedQless = raw_node(binding.tree.node, [0, 2]);
  create_livetree(insertedQless).adoptRoots(binding.tree.hostRootNode()).attrs.set("bound", "yes");
  assert.equal(map.document.attrs.get(path(0, 2), "bound"), "yes");
  assert.equal(binding.sourceRevision, 4);
  assert.equal(binding.diagnostics().projectionTransactions, 4);
  binding.dispose();
});

check("remove unregisters deleted content and reindexes shifted QUID-less paths", () => {
  const map = element(`<main data-_quid="0000000000000404" <a/> <b/> <c/>/>`);
  const binding = bind_document_livetree(map);
  mount(binding.tree.node);
  const removed = raw_node(binding.tree.node, [0, 1]);
  const shifted = raw_node(binding.tree.node, [0, 2]);
  map.document.content.remove(path(0), 1);
  assert.equal(raw_node(binding.tree.node, [0, 1]), shifted);
  assert.notEqual(raw_node(binding.tree.node, [0, 1]), removed);
  const shiftedTree = create_livetree(shifted).adoptRoots(binding.tree.hostRootNode());
  shiftedTree.attrs.set("after", "remove");
  assert.equal(map.document.attrs.get(path(0, 1), "after"), "remove");
  binding.dispose();
});

check("forward and backward moves preserve projected node, DOM, and local identity", () => {
  const map = element(`<main data-_quid="0000000000000405" <a/> <b data-_quid="0000000000000406"/> <c/>/>`);
  const binding = bind_document_livetree(map);
  mount(binding.tree.node);
  const moved = raw_node(binding.tree.node, [0, 1]);
  const movedDom = get_el_for_node(moved) as unknown as FakeElement;
  const marker = Symbol("listener");
  Reflect.set(movedDom, marker, { listener: "retained" });
  map.document.content.move(path(0), 1, 2);
  assert.equal(raw_node(binding.tree.node, [0, 2]), moved);
  assert.equal(get_el_for_node(moved), movedDom as unknown as Element);
  assert.deepEqual(Reflect.get(movedDom, marker), { listener: "retained" });
  map.document.content.move(path(0), 2, 0);
  assert.equal(raw_node(binding.tree.node, [0, 0]), moved);
  const movedTree = create_livetree(moved).adoptRoots(binding.tree.hostRootNode());
  movedTree.attrs.set("position", "first");
  assert.equal(map.document.attrs.get(path(0, 0), "position"), "first");
  binding.dispose();
});

check("replace preserves compatible same-QUID roots and replaces incompatible roots", () => {
  const map = element(`<main data-_quid="0000000000000407" <b data-_quid="0000000000000408" "old"/>/>`);
  const binding = bind_document_livetree(map);
  mount(binding.tree.node);
  const original = raw_node(binding.tree.node, [0, 0]);
  const originalDom = get_el_for_node(original);
  map.document.content.replace(path(0), 0, projected_element(`<b data-_quid="0000000000000408" title="new" "next"/>`));
  assert.equal(raw_node(binding.tree.node, [0, 0]), original);
  assert.equal(get_el_for_node(original), originalDom);
  assert.equal(original.$_attrs?.title, "new");

  map.document.content.replace(path(0), 0, projected_element(`<em data-_quid="0000000000000408"/>`));
  const incompatible = raw_node(binding.tree.node, [0, 0]);
  assert.notEqual(incompatible, original);
  assert.notEqual(get_el_for_node(incompatible), originalDom);
  assert.equal(incompatible.$_tag, "em");
  binding.dispose();
});

check("replace projects text-wrapper/node transitions and primitive leaves at exact raw slots", () => {
  const map = element(`<main data-_quid="0000000000000413" "old"/>`);
  const binding = bind_document_livetree(map);
  const rootDom = mount(binding.tree.node);
  map.document.content.replace(path(0), 0, projected_element(`<span/>`));
  assert.equal(raw_node(binding.tree.node, [0, 0]).$_tag, "span");
  assert.ok(rootDom.childNodes[0] instanceof FakeElement);
  map.document.content.replace(path(0), 0, { $_tag: "_hson_str", $_content: ["plain"] });
  map.document.content.replace(path(0, 0), 0, "next");
  assert.equal(raw_node(binding.tree.node, [0, 0]).$_content[0], "next");
  const plainDom = rootDom.childNodes[0];
  assert.ok(plainDom instanceof FakeText);
  assert.equal(plainDom.data, "next");
  binding.dispose();
});

check("foreign global QUID ownership rejects insertion before projected mutation", () => {
  create_livetree(projected_element(`<aside data-_quid="0000000000000414"/>`));
  const map = element(`<main data-_quid="0000000000000415" <a/>/>`);
  const binding = bind_document_livetree(map);
  const before = structuredClone(binding.tree.node);
  map.document.content.insert(path(0), 1, projected_element(`<aside data-_quid="0000000000000414"/>`));
  assert.equal(binding.status, "failed");
  assert.equal(binding.failure?.code, DOCUMENT_BINDING_QUID_COLLISION_ERROR_CODE);
  assert.deepEqual(binding.tree.node, before);
  assert.equal(binding.sourceRevision, 0);
  binding.dispose();
});

check("mixed sequential replay projects structural and attrs operations once", () => {
  const map = element(`<main data-_quid="0000000000000409" <a/>/>`);
  const binding = bind_document_livetree(map);
  mount(binding.tree.node);
  const observations: unknown[] = [];
  map.commits.observe((event) => observations.push(event));
  map.replay({
    changed: true,
    prevRev: 0,
    rev: 1,
    ops: [
      { domain: "graph", op: "insert-content", target: path(0), index: 1, content: projected_element(`<b/>`) },
      { domain: "graph", op: "set-attr", target: path(0, 1), name: "mixed", value: 1 },
      { domain: "graph", op: "move-content", target: path(0), from: 1, to: 0 },
    ],
  });
  const inserted = raw_node(binding.tree.node, [0, 0]);
  assert.equal(inserted.$_tag, "b");
  assert.equal(inserted.$_attrs?.mixed, 1);
  assert.equal(binding.sourceRevision, 1);
  assert.equal(binding.diagnostics().projectionTransactions, 1);
  assert.equal(observations.length, 1);
  binding.dispose();
});

check("bound public structural and text APIs reject until disposal", () => {
  const map = element(`<main data-_quid="0000000000000410" <a/>/>`);
  const binding = bind_document_livetree(map);
  const branch = create_livetree(projected_element(`<b/>`));
  const before = structuredClone(binding.tree.node);
  for (const mutation of [
    () => binding.tree.append(branch),
    () => binding.tree.create.div(),
    () => binding.tree.detachContents(),
    () => binding.tree.removeChildren(),
    () => binding.tree.text.overwrite("blocked"),
  ]) {
    assert.throws(mutation, (cause) => cause instanceof DocumentLiveTreeBindingError
      && (cause.code === DOCUMENT_BINDING_UNSUPPORTED_OPERATION_ERROR_CODE
        || cause.code === DOCUMENT_BINDING_DELEGATION_UNSUPPORTED_ERROR_CODE));
  }
  assert.deepEqual(binding.tree.node, before);
  binding.dispose();
  binding.tree.text.set("local");
  assert.equal(binding.tree.text.get(), "local");
});

check("structural DOM failure preserves canonical commit and fails observer-side", () => {
  const map = element(`<main data-_quid="0000000000000411" <a/>/>`);
  const binding = bind_document_livetree(map);
  const rootDom = mount(binding.tree.node);
  rootDom.failReplace = true;
  const commit = map.document.content.insert(path(0), 1, projected_element(`<b/>`));
  assert.equal(commit.changed, true);
  assert.equal(map.rev, 1);
  assert.equal(binding.status, "failed");
  assert.equal(binding.failure?.code, DOCUMENT_BINDING_STRUCTURAL_PROJECTION_FAILED_ERROR_CODE);
  assert.equal(binding.sourceRevision, 0);
  assert.throws(() => binding.tree.empty(), DocumentLiveTreeBindingError);
  binding.dispose();
});

check("incompatible snapshot restore remains observer-isolated", () => {
  const map = element(`<main data-_quid="0000000000000416"/>`);
  const binding = bind_document_livetree(map);
  const replacement = element(`<article data-_quid="0000000000000417"/>`);
  map.restore(replacement.capture());
  assert.equal(map.element.node().$_tag, "article");
  assert.equal(binding.tree.node.$_tag, "main");
  assert.equal(binding.status, "failed");
  assert.equal(binding.failure?.code, DOCUMENT_BINDING_ROOT_KIND_MISMATCH_ERROR_CODE);
  assert.equal(binding.sourceRevision, 0);
  binding.dispose();
});

check("disposal stops projection and restores unbound structural behavior", () => {
  const map = element(`<main data-_quid="0000000000000412" <a/>/>`);
  const binding = bind_document_livetree(map);
  const retained = binding.tree.node;
  binding.dispose();
  map.document.content.insert(path(0), 1, projected_element(`<b/>`));
  assert.equal(raw_node(retained, [0]).$_content.length, 1);
  binding.tree.empty();
  assert.equal(binding.tree.node.$_content.length, 0);
  const local = binding.tree.create.div();
  local.text.set("unbound");
  assert.equal(binding.tree.content.count(), 1);
  assert.equal(local.text.get(), "unbound");
  assert.equal(map.element.node().$_content.length, 1);
});

process.stdout.write(`# ${checks} document LiveTree structural binding checks passed\n`);
