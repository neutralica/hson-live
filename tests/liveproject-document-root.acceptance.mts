import assert from "node:assert/strict";
import { hson } from "../src/index.ts";
import type { HsonNode } from "../src/core/types.ts";
import type { ElementLiveMap } from "../src/types/livemap.types.ts";
import { is_Node } from "../src/core/node-guards.ts";
import { bind_document_livetree } from "../src/api/liveproject/liveproject.document.ts";
import {
  DOCUMENT_BINDING_QUID_COLLISION_ERROR_CODE,
  DOCUMENT_BINDING_ROOT_KIND_MISMATCH_ERROR_CODE,
  DOCUMENT_BINDING_ROOT_QUID_CONFLICT_ERROR_CODE,
  DOCUMENT_BINDING_ROOT_REPLACEMENT_FAILED_ERROR_CODE,
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

function raw_node(root: HsonNode, path: readonly number[]): HsonNode {
  let current = root;
  for (const segment of path) {
    const child = current.$_content[segment];
    if (!is_Node(child)) throw new Error(`Expected node at ${path.join("/")}`);
    current = child;
  }
  return current;
}

function path(...segments: number[]) {
  return { kind: "path" as const, path: segments };
}

function mount(root: HsonNode): FakeElement {
  return project_livetree(root) as unknown as FakeElement;
}

check("compatible install retains tree, root, DOM, and bounded descendant identity", () => {
  const map = element(`<main data-_quid="0000000000000501" class="old" <p data-_quid="0000000000000502" "old"/> <i/>/>`);
  const binding = bind_document_livetree(map);
  const tree = binding.tree;
  const root = tree.node;
  const rootDom = mount(root);
  const paragraph = raw_node(root, [0, 0]);
  const paragraphDom = get_el_for_node(paragraph);
  const marker = { retained: true };
  Reflect.set(rootDom, "marker", marker);
  const replacement = element(`<main data-_quid="0000000000000501" class="new" <p data-_quid="0000000000000502" "next"/> <strong/>/>`);

  const commit = map.install(replacement.capture());

  assert.equal(commit.changed, true);
  assert.equal(binding.status, "active");
  assert.equal(binding.tree, tree);
  assert.equal(binding.tree.node, root);
  assert.equal(get_el_for_node(root), rootDom as unknown as Element);
  assert.equal(Reflect.get(rootDom, "marker"), marker);
  assert.equal(raw_node(root, [0, 0]), paragraph);
  assert.equal(get_el_for_node(paragraph), paragraphDom);
  assert.equal(root.$_attrs?.class, "new");
  assert.equal((rootDom.childNodes[0] as FakeElement).childNodes[0] instanceof FakeText, true);
  assert.equal(((rootDom.childNodes[0] as FakeElement).childNodes[0] as FakeText).data, "next");
  assert.equal(binding.sourceRevision, commit.rev);
  assert.equal(binding.diagnostics().projectionTransactions, 1);

  create_livetree(paragraph).adoptRoots(root).attrs.set("after", "replace");
  assert.equal(map.document.attrs.get(path(0, 0), "after"), "replace");
  binding.dispose();
});

check("QUID-less compatible root retains projection-local identity without mutating canonical state", () => {
  const map = element(`<main class="old"/>`);
  const binding = bind_document_livetree(map);
  const root = binding.tree.node;
  const projectionQuid = root.$_meta?.["data-_quid"];
  assert.equal(typeof projectionQuid, "string");
  const replacement = element(`<main class="next" "text"/>`);
  map.install(replacement.capture());
  assert.equal(binding.status, "active");
  assert.equal(binding.tree.node, root);
  assert.equal(root.$_meta?.["data-_quid"], projectionQuid);
  assert.equal(map.element.node().$_meta?.["data-_quid"], undefined);
  binding.dispose();
});

check("replayed compatible replace-root uses one convergence transaction", () => {
  const source = element(`<main data-_quid="0000000000000503"/>`);
  const target = element(`<main data-_quid="0000000000000503"/>`);
  const binding = bind_document_livetree(target);
  const root = binding.tree.node;
  const replacement = element(`<main data-_quid="0000000000000503" title="replayed" <b/>/>`);
  const commit = source.install(replacement.capture());
  target.replay(commit);
  assert.equal(binding.tree.node, root);
  assert.equal(binding.tree.attrs.get("title"), "replayed");
  assert.equal(binding.sourceRevision, 1);
  assert.equal(binding.diagnostics().projectionTransactions, 1);
  binding.dispose();
});

check("canonical-equivalent install performs no convergence", () => {
  const map = element(`<main data-_quid="0000000000000504" class="same"/>`);
  const binding = bind_document_livetree(map);
  const root = binding.tree.node;
  const commit = map.install(map.capture());
  assert.equal(commit.changed, false);
  assert.equal(binding.tree.node, root);
  assert.equal(binding.sourceRevision, 0);
  assert.equal(binding.diagnostics().projectionTransactions, 0);
  binding.dispose();
});

check("tag and persisted root-QUID transitions fail closed", () => {
  const tagMap = element(`<main data-_quid="0000000000000505"/>`);
  const tagBinding = bind_document_livetree(tagMap);
  const tagRoot = structuredClone(tagBinding.tree.node);
  tagMap.install(element(`<article data-_quid="0000000000000505"/>`).capture());
  assert.equal(tagBinding.failure?.code, DOCUMENT_BINDING_ROOT_KIND_MISMATCH_ERROR_CODE);
  assert.deepEqual(tagBinding.tree.node, tagRoot);
  tagBinding.dispose();

  const quidMap = element(`<main data-_quid="0000000000000506"/>`);
  const quidBinding = bind_document_livetree(quidMap);
  const quidRoot = structuredClone(quidBinding.tree.node);
  quidMap.install(element(`<main data-_quid="0000000000000507"/>`).capture());
  assert.equal(quidBinding.failure?.code, DOCUMENT_BINDING_ROOT_QUID_CONFLICT_ERROR_CODE);
  assert.deepEqual(quidBinding.tree.node, quidRoot);
  quidBinding.dispose();
});

check("descendant QUID collision fails before projected mutation", () => {
  create_livetree(element(`<aside data-_quid="0000000000000508"/>`).element.node());
  const map = element(`<main data-_quid="0000000000000509" <a/>/>`);
  const binding = bind_document_livetree(map);
  const before = structuredClone(binding.tree.node);
  map.install(element(`<main data-_quid="0000000000000509" <aside data-_quid="0000000000000508"/>/>`).capture());
  assert.equal(binding.status, "failed");
  assert.equal(binding.failure?.code, DOCUMENT_BINDING_QUID_COLLISION_ERROR_CODE);
  assert.deepEqual(binding.tree.node, before);
  assert.equal(binding.sourceRevision, 0);
  binding.dispose();
});

check("mounted root DOM failure preserves canonical install and fails observer-side", () => {
  const map = element(`<main data-_quid="0000000000000510" <a/>/>`);
  const binding = bind_document_livetree(map);
  const rootDom = mount(binding.tree.node);
  rootDom.failReplace = true;
  const commit = map.install(element(`<main data-_quid="0000000000000510" title="canonical" <b/>/>`).capture());
  assert.equal(commit.changed, true);
  assert.equal(map.document.attrs.get(path(), "title"), "canonical");
  assert.equal(binding.status, "failed");
  assert.equal(binding.failure?.code, DOCUMENT_BINDING_ROOT_REPLACEMENT_FAILED_ERROR_CODE);
  assert.equal(binding.sourceRevision, 0);
  assert.throws(() => binding.tree.attrs.set("blocked", true), DocumentLiveTreeBindingError);
  binding.dispose();
});

check("reentrant observation during root DOM convergence fails closed", () => {
  const map = element(`<main data-_quid="0000000000000511" <a/>/>`);
  const binding = bind_document_livetree(map);
  const rootDom = mount(binding.tree.node);
  rootDom.beforeReplace = () => {
    rootDom.beforeReplace = undefined;
    map.document.attrs.set(path(), "reentrant", true);
  };
  const commit = map.install(element(`<main data-_quid="0000000000000511" <b/>/>`).capture());
  assert.equal(commit.changed, true);
  assert.equal(map.rev, 2);
  assert.equal(map.document.attrs.get(path(), "reentrant"), true);
  assert.equal(binding.status, "failed");
  assert.equal(binding.failure?.code, DOCUMENT_BINDING_ROOT_REPLACEMENT_FAILED_ERROR_CODE);
  assert.equal(binding.sourceRevision, 0);
  assert.equal(binding.diagnostics().projectionTransactions, 0);
  binding.dispose();
});

process.stdout.write(`# ${checks} compatible document root convergence checks passed\n`);
