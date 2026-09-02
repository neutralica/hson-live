import { create_test_event_emitter } from "./test-events.mjs";
import assert from "node:assert/strict";
import { hson, validate_document_path } from "../src/index.ts";
import type { HsonNode } from "../src/core/types.ts";
import type { DocumentLiveMap, LiveMapCommitObservation } from "../src/types/livemap.types.ts";
import { is_Node } from "../src/core/node-guards.ts";
import { create_livetree } from "../src/api/livetree/creation/create-livetree.ts";
import { link_node_to_el } from "../src/api/livetree/utils/node-map-helpers.ts";
import { unlinkNode } from "../src/api/livetree/utils/node-map-helpers.ts";
import {
  hsonReflect,
} from "../src/api/reflect/reflect.facade.ts";
import {
  DOCUMENT_REFLECT_ALREADY_BOUND_ERROR_CODE,
  DOCUMENT_REFLECT_DISPOSED_ERROR_CODE,
  DOCUMENT_REFLECT_UPDATE_FAILED_ERROR_CODE,
  DOCUMENT_REFLECT_QUID_MISMATCH_ERROR_CODE,
  DOCUMENT_REFLECT_TARGET_MISSING_ERROR_CODE,
  DOCUMENT_REFLECT_UNSUPPORTED_OPERATION_ERROR_CODE,
  DocumentReflectError,
} from "../src/api/reflect/reflect.document.error.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "reflect.document-attrs",
  title: "Document Reflect attributes",
  category: "Reflect",
  runtime: "node-synthetic-dom",
  tags: Object.freeze(["document", "binding", "attributes"]),
});

const testEvents = create_test_event_emitter("reflect.document-attrs");
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

class AttributeProjection {
  readonly values = new Map<string, string>();
  writes = 0;
  failOn: string | undefined;

  setAttribute(name: string, value: string): void {
    if (this.failOn === name) throw new Error("forced projected DOM failure");
    this.writes += 1;
    this.values.set(name, value);
  }

  removeAttribute(name: string): void {
    if (this.failOn === name) throw new Error("forced projected DOM failure");
    this.writes += 1;
    this.values.delete(name);
  }

  getAttribute(name: string): string | null {
    return this.values.get(name) ?? null;
  }

  getAttributeNames(): string[] {
    return [...this.values.keys()];
  }
}

function element(source: string): DocumentLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "document") throw new Error("Expected DocumentLiveMap");
  return map;
}

function raw_node(root: HsonNode, path: readonly number[]): HsonNode {
  let current: HsonNode = root;
  for (const segment of path) {
    const child = current.$_content[segment];
    if (!is_Node(child)) throw new Error(`Expected node at raw path ${path.join("/")}`);
    current = child;
  }
  return current;
}

function mount(node: HsonNode): AttributeProjection {
  const projected = new AttributeProjection();
  const quid = node.$_meta?.["quid"];
  if (quid !== undefined) projected.values.set("hson:quid", quid);
  for (const [name, value] of Object.entries(node.$_attrs ?? {})) {
    projected.values.set(name, String(value));
  }
  link_node_to_el(node, projected as unknown as Element);
  return projected;
}

function path(...segments: number[]) {
  return { kind: "path" as const, path: validate_document_path([0, ...segments]) };
}

function document_element(root: HsonNode): HsonNode {
  return raw_node(root, [0]);
}

function document_element_tree(binding: ReturnType<typeof hsonReflect>) {
  return create_livetree(document_element(binding.tree.node)).adoptRoots(binding.tree.hostRootNode());
}

check("initial binding owns a detached graph and indexes raw canonical paths", () => {
  const map = element(`<main id="root" @000000301 <section @000000302 <span/>/>/>`);
  const canonicalRead = map.root();
  const binding = hsonReflect(map);
  assert.notEqual(binding.tree.node, canonicalRead);
  assert.deepEqual(binding.tree.node, canonicalRead);
  assert.equal(binding.status, "active");
  assert.equal(binding.sourceRevision, map.rev);
  assert.equal(binding.diagnostics().registeredElements, 3);
  binding.dispose();
});

check("canonical attrs project by raw path and QUID into graph and mounted DOM", () => {
  const map = element(`<main id="root" @000000303 <section @000000304 <span/>/>/>`);
  const binding = hsonReflect(map);
  const mainTree = document_element_tree(binding);
  const rootDom = mount(mainTree.node);
  const sectionNode = raw_node(binding.tree.node, [0, 0, 0]);
  const spanNode = raw_node(binding.tree.node, [0, 0, 0, 0, 0]);
  const sectionDom = mount(sectionNode);
  const spanDom = mount(spanNode);

  map.document.attrs.set(path(), "count", 0);
  map.document.attrs.set({ kind: "quid", quid: "000000304" }, "hidden", false);
  map.document.attrs.replace(path(0, 0, 0, 0), { empty: "", nullable: null, enabled: true });
  assert.equal(mainTree.attrs.get("count"), 0);
  assert.equal(rootDom.getAttribute("count"), "0");
  assert.equal(sectionNode.$_attrs?.hidden, false);
  assert.equal(sectionDom.getAttribute("hidden"), "false");
  assert.deepEqual(spanNode.$_attrs, { empty: "", enabled: true, nullable: null });
  assert.equal(spanDom.getAttribute("empty"), "");
  assert.equal(spanDom.getAttribute("enabled"), "true");
  assert.equal(spanDom.getAttribute("nullable"), "null");
  assert.equal(binding.sourceRevision, map.rev);
  assert.equal(binding.diagnostics().updatesApplied, 3);
  const spanTree = create_livetree(spanNode).adoptRoots(binding.tree.hostRootNode());
  spanTree.attrs.set("delegated", "by-path");
  assert.equal(map.document.attrs.get(path(0, 0, 0, 0), "delegated"), "by-path");
  assert.equal(spanDom.getAttribute("delegated"), "by-path");
  binding.dispose();
});

check("bound attrs and convenience managers delegate without feedback", () => {
  const map = element(`<main @000000305/>`);
  const binding = hsonReflect(map);
  const mainTree = document_element_tree(binding);
  const dom = mount(mainTree.node);
  const observations: LiveMapCommitObservation[] = [];
  map.commits.observe((event) => observations.push(event));

  assert.equal(mainTree.attrs.set("title", "one"), mainTree);
  mainTree.attrs.setMany({ count: 0, nullable: null });
  mainTree.attrs.dropMany(["nullable"]);
  mainTree.id.set("main");
  mainTree.classlist.add("ready");
  mainTree.data.set("userId", "42");
  assert.equal(map.document.attrs.get(path(), "title"), "one");
  assert.equal(map.document.attrs.get(path(), "count"), 0);
  assert.equal(map.document.attrs.get(path(), "id"), "main");
  assert.equal(map.document.attrs.get(path(), "class"), "ready");
  assert.equal(map.document.attrs.get(path(), "data-user-id"), "42");
  assert.equal(dom.getAttribute("data-user-id"), "42");
  assert.equal(observations.length, 6);
  assert.equal(binding.diagnostics().updatesApplied, 6);

  const revision = map.rev;
  const transactions = binding.diagnostics().updatesApplied;
  const writes = dom.writes;
  mainTree.attrs.set("title", "one");
  assert.equal(map.rev, revision);
  assert.equal(binding.diagnostics().updatesApplied, transactions);
  assert.equal(dom.writes, writes);

  mainTree.attrs.clear();
  assert.deepEqual(map.document.attrs.keys(path()), []);
  mainTree.attrs.replace({ value: "final" });
  assert.deepEqual(map.document.attrs.keys(path()), ["value"]);
  mainTree.attrs.drop("value");
  assert.deepEqual(map.document.attrs.keys(path()), []);
  binding.dispose();
});

check("bound style edits preserve unrelated structured canonical declarations", () => {
  const map = element(`<main @000000317/>`);
  map.document.attrs.set(path(), "style", {
    color: "red",
    opacity: 0.5,
    width: { value: 2, unit: "px" },
  });
  const binding = hsonReflect(map);
  const mainTree = document_element_tree(binding);
  mainTree.style.set.backgroundColor("black");
  assert.deepEqual(map.document.attrs.get(path(), "style"), {
    backgroundColor: "black",
    color: "red",
    opacity: 0.5,
    width: { value: 2, unit: "px" },
  });
  mainTree.style.remove("color");
  assert.deepEqual(map.document.attrs.get(path(), "style"), {
    backgroundColor: "black",
    opacity: 0.5,
    width: { value: 2, unit: "px" },
  });
  binding.dispose();
});

check("multi-operation attrs replay is one projection transaction", () => {
  const map = element(`<main @000000306/>`);
  const binding = hsonReflect(map);
  mount(document_element(binding.tree.node));
  const replayed = map.replay({
    changed: true,
    prevRev: 0,
    rev: 1,
    ops: [
      { domain: "graph", op: "set-attr", target: path(), name: "a", value: 1 },
      { domain: "graph", op: "set-attr", target: path(), name: "b", value: 2 },
    ],
  });
  assert.equal(replayed.rev, 1);
  assert.deepEqual(document_element(binding.tree.node).$_attrs, { a: 1, b: 2 });
  assert.equal(binding.diagnostics().updatesApplied, 1);
  binding.dispose();
});

check("new-epoch root replacement reconstructs and remains canonically delegated", () => {
  const map = element(`<main @000000307 "before"/>`);
  const binding = hsonReflect(map);
  const before = binding.tree;
  const replacement = element(`<article @000000316/>`);
  const commit = map.install(replacement.capture());
  assert.equal(commit.changed, true);
  assert.equal(document_element(map.root()).$_tag, "article");
  assert.notEqual(binding.tree, before);
  assert.equal(before.isDisposed, true);
  assert.equal(document_element(binding.tree.node).$_tag, "article");
  assert.equal(binding.status, "active");
  const articleTree = document_element_tree(binding);
  articleTree.attrs.set("id", "delegated");
  assert.equal(map.document.attrs.get(path(), "id"), "delegated");
  map.document.attrs.set(path(), "title", "canonical-only");
  assert.equal(articleTree.attrs.get("title"), "canonical-only");
  binding.dispose();
});

check("projection failure is isolated from the committed map mutation", () => {
  const map = element(`<main @000000308/>`);
  const binding = hsonReflect(map);
  const dom = mount(document_element(binding.tree.node));
  dom.failOn = "boom";
  const commit = map.document.attrs.set(path(), "boom", "canonical");
  assert.equal(commit.changed, true);
  assert.equal(map.document.attrs.get(path(), "boom"), "canonical");
  assert.equal(binding.status, "failed");
  assert.equal(binding.failure?.code, DOCUMENT_REFLECT_UPDATE_FAILED_ERROR_CODE);
  assert.equal(binding.sourceRevision, 0);
  binding.dispose();
});

check("a previously mounted node losing its DOM mapping fails closed", () => {
  const map = element(`<main @000000312/>`);
  const binding = hsonReflect(map);
  const mainNode = document_element(binding.tree.node);
  mount(mainNode);
  map.document.attrs.set(path(), "first", "projected");
  unlinkNode(mainNode);
  const commit = map.document.attrs.set(path(), "second", "canonical");
  assert.equal(commit.changed, true);
  assert.equal(binding.status, "failed");
  assert.equal(binding.failure?.code, "DOCUMENT_REFLECT_DOM_MAPPING_MISMATCH");
  binding.dispose();
});

check("projected path and persisted-QUID divergence fail closed", () => {
  const quidMap = element(`<main @000000313/>`);
  const quidBinding = hsonReflect(quidMap);
  const quidMain = document_element(quidBinding.tree.node);
  if (quidMain.$_meta === undefined) throw new Error("Expected projected metadata");
  quidMain.$_meta["quid"] = "000000314";
  quidMap.document.attrs.set(path(), "canonical", "retained");
  assert.equal(quidBinding.status, "failed");
  assert.equal(quidBinding.failure?.code, DOCUMENT_REFLECT_QUID_MISMATCH_ERROR_CODE);
  quidBinding.dispose();

  const pathMap = element(`<main @000000315 <span/>/>`);
  const pathBinding = hsonReflect(pathMap);
  document_element(pathBinding.tree.node).$_content.length = 0;
  pathMap.document.attrs.set(path(0, 0), "canonical", "retained");
  assert.equal(pathBinding.status, "failed");
  assert.equal(pathBinding.failure?.code, DOCUMENT_REFLECT_TARGET_MISSING_ERROR_CODE);
  pathBinding.dispose();
});

check("cardinality and disposal preserve authority boundaries", () => {
  const map = element(`<main @000000309/>`);
  const binding = hsonReflect(map);
  const mainTree = document_element_tree(binding);
  const dom = mount(mainTree.node);
  assert.throws(
    () => hsonReflect(map),
    (cause) => cause instanceof DocumentReflectError
      && cause.code === DOCUMENT_REFLECT_ALREADY_BOUND_ERROR_CODE,
  );
  binding.dispose();
  binding.dispose();
  assert.equal(binding.status, "disposed");
  assert.throws(
    () => binding.diagnostics(),
    (cause) => cause instanceof DocumentReflectError
      && cause.code === DOCUMENT_REFLECT_DISPOSED_ERROR_CODE,
  );
  map.document.attrs.set(path(), "canonical", "map-only");
  assert.equal(mainTree.attrs.get("canonical"), undefined);
  const mapRevision = map.rev;
  mainTree.attrs.set("local", "tree-only");
  assert.equal(mainTree.attrs.get("local"), "tree-only");
  assert.equal(dom.getAttribute("local"), "tree-only");
  assert.equal(map.rev, mapRevision);
  assert.equal(map.document.attrs.get(path(), "local"), undefined);
});

check("different maps keep binding revision and failure state isolated", () => {
  const left = element(`<main @000000310/>`);
  const right = element(`<main @000000311/>`);
  const leftBinding = hsonReflect(left);
  const rightBinding = hsonReflect(right);
  left.document.attrs.set(path(), "side", "left");
  assert.equal(leftBinding.sourceRevision, 1);
  assert.equal(rightBinding.sourceRevision, 0);
  assert.equal(document_element_tree(rightBinding).attrs.get("side"), undefined);
  leftBinding.dispose();
  rightBinding.dispose();
});

process.stdout.write(`# ${checks} document LiveTree attrs binding checks passed\n`);
testEvents.terminal("pass");
