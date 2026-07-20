import assert from "node:assert/strict";
import { hson } from "../src/index.ts";
import type { HsonNode } from "../src/core/types.ts";
import type { ElementLiveMap, LiveMapCommitObservation } from "../src/types/livemap.types.ts";
import { is_Node } from "../src/core/node-guards.ts";
import { create_livetree } from "../src/api/livetree/creation/create-livetree.ts";
import { link_node_to_el } from "../src/api/livetree/utils/node-map-helpers.ts";
import { unlinkNode } from "../src/api/livetree/utils/node-map-helpers.ts";
import {
  bind_document_livetree,
} from "../src/api/liveproject/liveproject.document.ts";
import {
  DOCUMENT_BINDING_ALREADY_BOUND_ERROR_CODE,
  DOCUMENT_BINDING_DISPOSED_ERROR_CODE,
  DOCUMENT_BINDING_PROJECTION_FAILED_ERROR_CODE,
  DOCUMENT_BINDING_QUID_MISMATCH_ERROR_CODE,
  DOCUMENT_BINDING_ROOT_KIND_MISMATCH_ERROR_CODE,
  DOCUMENT_BINDING_TARGET_MISSING_ERROR_CODE,
  DOCUMENT_BINDING_UNSUPPORTED_OPERATION_ERROR_CODE,
  DocumentLiveTreeBindingError,
} from "../src/api/liveproject/liveproject.document.error.ts";

let checks = 0;
function check(name: string, fn: () => void): void {
  fn();
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

function element(source: string): ElementLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "element") throw new Error("Expected ElementLiveMap");
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
  const quid = node.$_meta?.["data-_quid"];
  if (quid !== undefined) projected.values.set("data-_quid", quid);
  for (const [name, value] of Object.entries(node.$_attrs ?? {})) {
    if (value === false || value === null) continue;
    projected.values.set(name, value === true ? "" : String(value));
  }
  link_node_to_el(node, projected as unknown as Element);
  return projected;
}

function path(...segments: number[]) {
  return { kind: "path" as const, path: segments };
}

check("initial binding owns a detached graph and indexes raw canonical paths", () => {
  const map = element(`<main id="root" data-_quid="0000000000000301" <section data-_quid="0000000000000302" <span/>/>/>`);
  const canonicalRead = map.element.node();
  const binding = bind_document_livetree(map);
  assert.notEqual(binding.tree.node, canonicalRead);
  assert.deepEqual(binding.tree.node, canonicalRead);
  assert.equal(binding.status, "active");
  assert.equal(binding.sourceRevision, map.rev);
  assert.equal(binding.diagnostics().registeredElements, 3);
  binding.dispose();
});

check("canonical attrs project by raw path and QUID into graph and mounted DOM", () => {
  const map = element(`<main id="root" data-_quid="0000000000000303" <section data-_quid="0000000000000304" <span/>/>/>`);
  const binding = bind_document_livetree(map);
  const rootDom = mount(binding.tree.node);
  const sectionNode = raw_node(binding.tree.node, [0, 0]);
  const spanNode = raw_node(binding.tree.node, [0, 0, 0, 0]);
  const sectionDom = mount(sectionNode);
  const spanDom = mount(spanNode);

  map.document.attrs.set(path(), "count", 0);
  map.document.attrs.set({ kind: "quid", quid: "0000000000000304" }, "hidden", false);
  map.document.attrs.replace(path(0, 0, 0, 0), { empty: "", nullable: null, enabled: true });
  assert.equal(binding.tree.attrs.get("count"), 0);
  assert.equal(rootDom.getAttribute("count"), "0");
  assert.equal(sectionNode.$_attrs?.hidden, false);
  assert.equal(sectionDom.getAttribute("hidden"), null);
  assert.deepEqual(spanNode.$_attrs, { empty: "", enabled: true, nullable: null });
  assert.equal(spanDom.getAttribute("empty"), "");
  assert.equal(spanDom.getAttribute("enabled"), "");
  assert.equal(spanDom.getAttribute("nullable"), null);
  assert.equal(binding.sourceRevision, map.rev);
  assert.equal(binding.diagnostics().projectionTransactions, 3);
  const spanTree = create_livetree(spanNode).adoptRoots(binding.tree.hostRootNode());
  spanTree.attrs.set("delegated", "by-path");
  assert.equal(map.document.attrs.get(path(0, 0, 0, 0), "delegated"), "by-path");
  assert.equal(spanDom.getAttribute("delegated"), "by-path");
  binding.dispose();
});

check("bound attrs and convenience managers delegate without feedback", () => {
  const map = element(`<main data-_quid="0000000000000305"/>`);
  const binding = bind_document_livetree(map);
  const dom = mount(binding.tree.node);
  const observations: LiveMapCommitObservation[] = [];
  map.commits.observe((event) => observations.push(event));

  assert.equal(binding.tree.attrs.set("title", "one"), binding.tree);
  binding.tree.attrs.setMany({ count: 0, nullable: null });
  binding.tree.attrs.dropMany(["nullable"]);
  binding.tree.id.set("main");
  binding.tree.classlist.add("ready");
  binding.tree.data.set("userId", "42");
  assert.equal(map.document.attrs.get(path(), "title"), "one");
  assert.equal(map.document.attrs.get(path(), "count"), 0);
  assert.equal(map.document.attrs.get(path(), "id"), "main");
  assert.equal(map.document.attrs.get(path(), "class"), "ready");
  assert.equal(map.document.attrs.get(path(), "data-user-id"), "42");
  assert.equal(dom.getAttribute("data-user-id"), "42");
  assert.equal(observations.length, 6);
  assert.equal(binding.diagnostics().projectionTransactions, 6);

  const revision = map.rev;
  const transactions = binding.diagnostics().projectionTransactions;
  const writes = dom.writes;
  binding.tree.attrs.set("title", "one");
  assert.equal(map.rev, revision);
  assert.equal(binding.diagnostics().projectionTransactions, transactions);
  assert.equal(dom.writes, writes);

  binding.tree.attrs.clear();
  assert.deepEqual(map.document.attrs.keys(path()), []);
  binding.tree.attrs.replace({ value: "final" });
  assert.deepEqual(map.document.attrs.keys(path()), ["value"]);
  binding.tree.attrs.drop("value");
  assert.deepEqual(map.document.attrs.keys(path()), []);
  binding.dispose();
});

check("multi-operation attrs replay is one projection transaction", () => {
  const map = element(`<main data-_quid="0000000000000306"/>`);
  const binding = bind_document_livetree(map);
  mount(binding.tree.node);
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
  assert.deepEqual(binding.tree.node.$_attrs, { a: 1, b: 2 });
  assert.equal(binding.diagnostics().projectionTransactions, 1);
  binding.dispose();
});

check("unsupported root replacement fails closed without escaping canonical mutation", () => {
  const map = element(`<main data-_quid="0000000000000307" "before"/>`);
  const binding = bind_document_livetree(map);
  const before = structuredClone(binding.tree.node);
  const replacement = element(`<article data-_quid="0000000000000316"/>`);
  const commit = map.install(replacement.capture());
  assert.equal(commit.changed, true);
  assert.equal(map.element.node().$_tag, "article");
  assert.deepEqual(binding.tree.node, before);
  assert.equal(binding.status, "failed");
  assert.equal(binding.failure?.code, DOCUMENT_BINDING_ROOT_KIND_MISMATCH_ERROR_CODE);
  assert.throws(
    () => binding.tree.attrs.set("id", "blocked"),
    (cause) => cause instanceof DocumentLiveTreeBindingError
      && cause.code === DOCUMENT_BINDING_ROOT_KIND_MISMATCH_ERROR_CODE,
  );
  map.document.attrs.set(path(), "title", "canonical-only");
  assert.equal(binding.tree.attrs.get("title"), undefined);
  binding.dispose();
});

check("projection failure is isolated from the committed map mutation", () => {
  const map = element(`<main data-_quid="0000000000000308"/>`);
  const binding = bind_document_livetree(map);
  const dom = mount(binding.tree.node);
  dom.failOn = "boom";
  const commit = map.document.attrs.set(path(), "boom", "canonical");
  assert.equal(commit.changed, true);
  assert.equal(map.document.attrs.get(path(), "boom"), "canonical");
  assert.equal(binding.status, "failed");
  assert.equal(binding.failure?.code, DOCUMENT_BINDING_PROJECTION_FAILED_ERROR_CODE);
  assert.equal(binding.sourceRevision, 0);
  binding.dispose();
});

check("a previously mounted node losing its DOM mapping fails closed", () => {
  const map = element(`<main data-_quid="0000000000000312"/>`);
  const binding = bind_document_livetree(map);
  mount(binding.tree.node);
  map.document.attrs.set(path(), "first", "projected");
  unlinkNode(binding.tree.node);
  const commit = map.document.attrs.set(path(), "second", "canonical");
  assert.equal(commit.changed, true);
  assert.equal(binding.status, "failed");
  assert.equal(binding.failure?.code, "DOCUMENT_BINDING_DOM_MAPPING_MISMATCH");
  binding.dispose();
});

check("projected path and persisted-QUID divergence fail closed", () => {
  const quidMap = element(`<main data-_quid="0000000000000313"/>`);
  const quidBinding = bind_document_livetree(quidMap);
  if (quidBinding.tree.node.$_meta === undefined) throw new Error("Expected projected metadata");
  quidBinding.tree.node.$_meta["data-_quid"] = "0000000000000314";
  quidMap.document.attrs.set(path(), "canonical", "retained");
  assert.equal(quidBinding.status, "failed");
  assert.equal(quidBinding.failure?.code, DOCUMENT_BINDING_QUID_MISMATCH_ERROR_CODE);
  quidBinding.dispose();

  const pathMap = element(`<main data-_quid="0000000000000315" <span/>/>`);
  const pathBinding = bind_document_livetree(pathMap);
  pathBinding.tree.node.$_content.length = 0;
  pathMap.document.attrs.set(path(0, 0), "canonical", "retained");
  assert.equal(pathBinding.status, "failed");
  assert.equal(pathBinding.failure?.code, DOCUMENT_BINDING_TARGET_MISSING_ERROR_CODE);
  pathBinding.dispose();
});

check("cardinality and disposal preserve authority boundaries", () => {
  const map = element(`<main data-_quid="0000000000000309"/>`);
  const binding = bind_document_livetree(map);
  const dom = mount(binding.tree.node);
  assert.throws(
    () => bind_document_livetree(map),
    (cause) => cause instanceof DocumentLiveTreeBindingError
      && cause.code === DOCUMENT_BINDING_ALREADY_BOUND_ERROR_CODE,
  );
  binding.dispose();
  binding.dispose();
  assert.equal(binding.status, "disposed");
  assert.throws(
    () => binding.diagnostics(),
    (cause) => cause instanceof DocumentLiveTreeBindingError
      && cause.code === DOCUMENT_BINDING_DISPOSED_ERROR_CODE,
  );
  map.document.attrs.set(path(), "canonical", "map-only");
  assert.equal(binding.tree.attrs.get("canonical"), undefined);
  const mapRevision = map.rev;
  binding.tree.attrs.set("local", "tree-only");
  assert.equal(binding.tree.attrs.get("local"), "tree-only");
  assert.equal(dom.getAttribute("local"), "tree-only");
  assert.equal(map.rev, mapRevision);
  assert.equal(map.document.attrs.get(path(), "local"), undefined);
});

check("different maps keep binding revision and failure state isolated", () => {
  const left = element(`<main data-_quid="0000000000000310"/>`);
  const right = element(`<main data-_quid="0000000000000311"/>`);
  const leftBinding = bind_document_livetree(left);
  const rightBinding = bind_document_livetree(right);
  left.document.attrs.set(path(), "side", "left");
  assert.equal(leftBinding.sourceRevision, 1);
  assert.equal(rightBinding.sourceRevision, 0);
  assert.equal(rightBinding.tree.attrs.get("side"), undefined);
  leftBinding.dispose();
  rightBinding.dispose();
});

process.stdout.write(`# ${checks} document LiveTree attrs binding checks passed\n`);
