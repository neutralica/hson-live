import { create_test_event_emitter } from "./test-events.mjs";
import assert from "node:assert/strict";
import { hson, validate_document_path } from "../src/index.ts";
import { is_Node } from "../src/core/node-guards.ts";
import type { HsonNode } from "../src/core/types.ts";
import type { DocumentLiveMap } from "../src/types/livemap.types.ts";
import { hsonReflect } from "../src/api/reflect/reflect.facade.ts";
import {
  DOCUMENT_REFLECT_QUID_COLLISION_ERROR_CODE,
  DOCUMENT_REFLECT_DELEGATION_UNSUPPORTED_ERROR_CODE,
  DOCUMENT_REFLECT_STRUCTURAL_UPDATE_FAILED_ERROR_CODE,
  DOCUMENT_REFLECT_UNSUPPORTED_OPERATION_ERROR_CODE,
  DocumentReflectError,
} from "../src/api/reflect/reflect.document.error.ts";
import { create_livetree } from "../src/api/livetree/creation/create-livetree.ts";
import { project_livetree } from "../src/api/livetree/creation/project-live-tree.ts";
import { get_el_for_node } from "../src/api/livetree/utils/node-map-helpers.ts";
import { FakeElement, FakeText, install_fake_document } from "./helpers/fake-document.mts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "reflect.document-structure",
  title: "Document Reflect structure",
  category: "Reflect",
  runtime: "node-synthetic-dom",
  tags: Object.freeze(["document", "binding", "structure"]),
});

const testEvents = create_test_event_emitter("reflect.document-structure");
let checks = 0;
function check(name: string, fn: () => void): void {

  testEvents.case_begin(name, name);
  try {
    fn();
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

install_fake_document();

function element(source: string): DocumentLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "document") throw new Error("Expected DocumentLiveMap");
  return map;
}

function path(...segments: number[]) {
  return { kind: "path" as const, path: validate_document_path([0, ...segments]) };
}

function raw_node(root: HsonNode, rawPath: readonly number[]): HsonNode {
  let current = root;
  if (current.$_tag === "_hson_root") {
    const only = current.$_content[0];
    if (!is_Node(only)) throw new Error("Expected one document element");
    current = only;
  }
  for (const segment of rawPath) {
    const child = current.$_content[segment];
    if (!is_Node(child)) throw new Error(`Expected node at ${rawPath.join("/")}`);
    current = child;
  }
  return current;
}

function projected_element(source: string): HsonNode {
  const projected = element(source).at([]).snap();
  if (!is_Node(projected)) throw new Error("Expected projected document element");
  return projected;
}

function mount(root: HsonNode): FakeElement {
  const projectedRoot = root.$_tag === "_hson_root" ? raw_node(root, []) : root;
  return project_livetree(projectedRoot) as unknown as FakeElement;
}

check("nested raw insertion projects elements, QUID-less nodes, wrappers, and text", () => {
  const map = element(`<main @000000401 <a @000000402/> <b/> "tail"/>`);
  const binding = hsonReflect(map);
  const rootDom = mount(binding.tree.node);
  map.document.content.insert(path(0), 1, projected_element(`<c @000000403 "inside"/>`));
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
  assert.equal(binding.diagnostics().updatesApplied, 4);
  binding.dispose();
});

check("remove unregisters deleted content and reindexes shifted QUID-less paths", () => {
  const map = element(`<main @000000404 <a/> <b/> <c/>/>`);
  const binding = hsonReflect(map);
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
  const map = element(`<main @000000405 <a/> <b @000000406/> <c/>/>`);
  const binding = hsonReflect(map);
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
  const map = element(`<main @000000407 <b @000000408 "old"/>/>`);
  const binding = hsonReflect(map);
  mount(binding.tree.node);
  const original = raw_node(binding.tree.node, [0, 0]);
  const originalDom = get_el_for_node(original);
  map.document.content.replace(path(0), 0, projected_element(`<b @000000408 title="new" "next"/>`));
  assert.equal(raw_node(binding.tree.node, [0, 0]), original);
  assert.equal(get_el_for_node(original), originalDom);
  assert.equal(original.$_attrs?.title, "new");

  map.document.content.replace(path(0), 0, projected_element(`<em @000000408/>`));
  const incompatible = raw_node(binding.tree.node, [0, 0]);
  assert.notEqual(incompatible, original);
  assert.notEqual(get_el_for_node(incompatible), originalDom);
  assert.equal(incompatible.$_tag, "em");
  binding.dispose();
});

check("replace projects text-wrapper/node transitions and primitive leaves at exact raw slots", () => {
  const map = element(`<main @000000413 "old"/>`);
  const binding = hsonReflect(map);
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
  create_livetree(projected_element(`<aside @000000414/>`));
  const map = element(`<main @000000415 <a/>/>`);
  const binding = hsonReflect(map);
  const before = structuredClone(binding.tree.node);
  map.document.content.insert(path(0), 1, projected_element(`<aside @000000414/>`));
  assert.equal(binding.status, "failed");
  assert.equal(binding.failure?.code, DOCUMENT_REFLECT_QUID_COLLISION_ERROR_CODE);
  assert.deepEqual(binding.tree.node, before);
  assert.equal(binding.sourceRevision, 0);
  binding.dispose();
});

check("mixed sequential replay projects structural and attrs operations once", () => {
  const map = element(`<main @000000409 <a/>/>`);
  const binding = hsonReflect(map);
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
  assert.equal(binding.diagnostics().updatesApplied, 1);
  assert.equal(observations.length, 1);
  binding.dispose();
});

check("bound public structural and text APIs reject until disposal", () => {
  const map = element(`<main @000000410 <a/>/>`);
  const binding = hsonReflect(map);
  const bound = create_livetree(raw_node(binding.tree.node, [])).adoptRoots(binding.tree.hostRootNode());
  const branch = create_livetree(projected_element(`<b/>`));
  const before = structuredClone(binding.tree.node);
  for (const mutation of [
    () => bound.append(branch),
    () => bound.create.div(),
    () => bound.detachContents(),
    () => bound.text.overwrite("blocked"),
  ]) {
    assert.throws(mutation, (cause) => cause instanceof DocumentReflectError
      && (cause.code === DOCUMENT_REFLECT_UNSUPPORTED_OPERATION_ERROR_CODE
        || cause.code === DOCUMENT_REFLECT_DELEGATION_UNSUPPORTED_ERROR_CODE));
  }
  assert.deepEqual(binding.tree.node, before);
  binding.dispose();
  bound.text.set("local");
  assert.equal(bound.text.get(), "local");
});

check("structural DOM failure preserves canonical commit and fails observer-side", () => {
  const map = element(`<main @000000411 <a/>/>`);
  const binding = hsonReflect(map);
  const rootDom = mount(binding.tree.node);
  rootDom.failReplace = true;
  const commit = map.document.content.insert(path(0), 1, projected_element(`<b/>`));
  assert.equal(commit.changed, true);
  assert.equal(map.rev, 1);
  assert.equal(binding.status, "failed");
  assert.equal(binding.failure?.code, DOCUMENT_REFLECT_STRUCTURAL_UPDATE_FAILED_ERROR_CODE);
  assert.equal(binding.sourceRevision, 0);
  const reachableIncoming = raw_node(binding.tree.node, [0, 1]);
  const incomingTree = create_livetree(reachableIncoming).adoptRoots(binding.tree.hostRootNode());
  assert.throws(() => incomingTree.attrs.set("bypass", "blocked"), DocumentReflectError);
  assert.equal(reachableIncoming.$_attrs?.bypass, undefined);
  assert.equal(map.document.attrs.get(path(0, 1), "bypass"), undefined);
  const rootElementTree = create_livetree(raw_node(binding.tree.node, [])).adoptRoots(binding.tree.hostRootNode());
  assert.throws(() => rootElementTree.empty(), DocumentReflectError);
  binding.dispose();
});

check("failed structural replacement disposes the disconnected old owned subtree", () => {
  const map = element(`<main @000000418 <a @000000419/>/>`);
  const binding = hsonReflect(map);
  const rootDom = mount(binding.tree.node);
  const displaced = raw_node(binding.tree.node, [0, 0]);
  const displacedTree = create_livetree(displaced).adoptRoots(binding.tree.hostRootNode());
  rootDom.failReplace = true;

  const commit = map.document.content.replace(path(0), 0, projected_element(`<b @000000420/>`));
  assert.equal(commit.changed, true);
  assert.equal(map.rev, 1);
  assert.equal(raw_node(projected_element_from_map(map), [0, 0]).$_tag, "b");
  assert.equal(binding.status, "failed");
  assert.equal(displacedTree.isDisposed, true);
  displacedTree.remove();
  binding.dispose();
  binding.dispose();
  binding.tree.remove();
  binding.tree.remove();
});

check("initial and later structured style realization use one serializer", () => {
  const value = create_livetree({
    $_tag: "main",
    $_attrs: { style: { opacity: 0.5, width: { value: 2, unit: "px" } } },
    $_content: [],
  });
  const dom = project_livetree(value.node) as unknown as FakeElement;
  assert.equal(dom.style.cssText, "opacity: 0.5; width: 2px");
  value.attrs.set("style", { opacity: 0.75, width: { value: 3, unit: "em" } });
  assert.equal(dom.style.cssText, "opacity: 0.75; width: 3em");
  value.remove();
});

check("new-epoch snapshot restore reconstructs an incompatible exact root", () => {
  const map = element(`<main @000000416/>`);
  const binding = hsonReflect(map);
  const replacement = element(`<article @000000417/>`);
  map.restore(replacement.capture());
  assert.equal(projected_element_from_map(map).$_tag, "article");
  assert.equal(raw_node(binding.tree.node, []).$_tag, "article");
  assert.equal(binding.status, "active");
  assert.equal(binding.sourceRevision, 0);
  binding.dispose();
});

check("multi-node documents move top-level identity under one reflected root", () => {
  const map = element(`<header @000000421/> <main @000000422/> <footer/>`);
  const binding = hsonReflect(map);
  const moved = binding.tree.node.$_content[0];
  if (!is_Node(moved)) throw new Error("Expected top-level reflected element");

  map.document.content.move(
    { kind: "path", path: validate_document_path([]) },
    0,
    2,
  );

  assert.equal(binding.tree.node.$_tag, "_hson_root");
  assert.equal(binding.tree.node.$_content[2], moved);
  assert.equal(binding.tree.find.byQuid("000000421")?.node, moved);
  assert.equal(map.document.byQuid("000000421")?.$_tag, "header");
  const projected = project_livetree(binding.tree.node) as unknown as {
    childNodes: readonly FakeElement[];
  };
  assert.deepEqual([...projected.childNodes].map((node) => node.tagName), ["main", "footer", "header"]);
  assert.equal(binding.sourceRevision, 1);
  binding.dispose();
  binding.tree.remove();
});

check("disposal stops projection and restores unbound structural behavior", () => {
  const map = element(`<main @000000412 <a/>/>`);
  const binding = hsonReflect(map);
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
  assert.equal(projected_element_from_map(map).$_content.length, 1);
});

function projected_element_from_map(map: DocumentLiveMap): HsonNode {
  const projected = map.at([]).snap();
  if (!is_Node(projected)) throw new Error("Expected projected document element");
  return projected;
}

process.stdout.write(`# ${checks} document LiveTree structural binding checks passed\n`);
testEvents.terminal("pass");
