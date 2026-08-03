import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import assert from "node:assert/strict";
import { hson } from "../src/index.ts";
import type { HsonNode } from "../src/core/types.ts";
import type { ElementLiveMap } from "../src/types/livemap.types.ts";
import { is_Node } from "../src/core/node-guards.ts";
import { hsonReflect } from "../src/api/reflect/reflect.facade.ts";
import {
  DOCUMENT_REFLECT_QUID_COLLISION_ERROR_CODE,
  DOCUMENT_REFLECT_ROOT_KIND_MISMATCH_ERROR_CODE,
  DOCUMENT_REFLECT_ROOT_QUID_CONFLICT_ERROR_CODE,
  DOCUMENT_REFLECT_ROOT_REPLACEMENT_FAILED_ERROR_CODE,
  DocumentReflectError,
} from "../src/api/reflect/reflect.document.error.ts";
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
  const map = element(`<main @0000000000000501 class="old" <p @0000000000000502 "old"/> <i/>/>`);
  const binding = hsonReflect(map);
  const tree = binding.tree;
  const root = tree.node;
  const rootDom = mount(root);
  const paragraph = raw_node(root, [0, 0]);
  const paragraphDom = get_el_for_node(paragraph);
  const marker = { retained: true };
  Reflect.set(rootDom, "marker", marker);
  const replacement = element(`<main @0000000000000501 class="new" <p @0000000000000502 "next"/> <strong/>/>`);

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
  assert.equal(binding.diagnostics().updatesApplied, 1);

  create_livetree(paragraph).adoptRoots(root).attrs.set("after", "replace");
  assert.equal(map.document.attrs.get(path(0, 0), "after"), "replace");
  binding.dispose();
});

check("QUID-less compatible root preserves canonical identity absence", () => {
  const map = element(`<main class="old"/>`);
  const binding = hsonReflect(map);
  const root = binding.tree.node;
  assert.equal(root.$_meta?.["quid"], undefined);
  const replacement = element(`<main class="next" "text"/>`);
  map.install(replacement.capture());
  assert.equal(binding.status, "active");
  assert.equal(binding.tree.node, root);
  assert.equal(root.$_meta?.["quid"], undefined);
  assert.equal(map.element.node().$_meta?.["quid"], undefined);
  binding.dispose();
});

check("replayed compatible replace-root uses one convergence transaction", () => {
  const source = element(`<main @0000000000000503/>`);
  const target = element(`<main @0000000000000503/>`);
  const binding = hsonReflect(target);
  const root = binding.tree.node;
  const replacement = element(`<main @0000000000000503 title="replayed" <b/>/>`);
  const commit = source.install(replacement.capture());
  target.replay(commit);
  assert.equal(binding.tree.node, root);
  assert.equal(binding.tree.attrs.get("title"), "replayed");
  assert.equal(binding.sourceRevision, 1);
  assert.equal(binding.diagnostics().updatesApplied, 1);
  binding.dispose();
});

check("canonical-equivalent install performs no convergence", () => {
  const map = element(`<main @0000000000000504 class="same"/>`);
  const binding = hsonReflect(map);
  const root = binding.tree.node;
  const commit = map.install(map.capture());
  assert.equal(commit.changed, false);
  assert.equal(binding.tree.node, root);
  assert.equal(binding.sourceRevision, 0);
  assert.equal(binding.diagnostics().updatesApplied, 0);
  binding.dispose();
});

check("tag and persisted root-QUID transitions fail closed", () => {
  const tagMap = element(`<main @0000000000000505/>`);
  const tagBinding = hsonReflect(tagMap);
  const tagRoot = structuredClone(tagBinding.tree.node);
  tagMap.install(element(`<article @0000000000000505/>`).capture());
  assert.equal(tagBinding.failure?.code, DOCUMENT_REFLECT_ROOT_KIND_MISMATCH_ERROR_CODE);
  assert.deepEqual(tagBinding.tree.node, tagRoot);
  tagBinding.dispose();

  const quidMap = element(`<main @0000000000000506/>`);
  const quidBinding = hsonReflect(quidMap);
  const quidRoot = structuredClone(quidBinding.tree.node);
  quidMap.install(element(`<main @0000000000000507/>`).capture());
  assert.equal(quidBinding.failure?.code, DOCUMENT_REFLECT_ROOT_QUID_CONFLICT_ERROR_CODE);
  assert.deepEqual(quidBinding.tree.node, quidRoot);
  quidBinding.dispose();
});

check("descendant QUID collision fails before projected mutation", () => {
  create_livetree(element(`<aside @0000000000000508/>`).element.node());
  const map = element(`<main @0000000000000509 <a/>/>`);
  const binding = hsonReflect(map);
  const before = structuredClone(binding.tree.node);
  map.install(element(`<main @0000000000000509 <aside @0000000000000508/>/>`).capture());
  assert.equal(binding.status, "failed");
  assert.equal(binding.failure?.code, DOCUMENT_REFLECT_QUID_COLLISION_ERROR_CODE);
  assert.deepEqual(binding.tree.node, before);
  assert.equal(binding.sourceRevision, 0);
  binding.dispose();
});

check("mounted root DOM failure preserves canonical install and fails observer-side", () => {
  const map = element(`<main @0000000000000510 <a/>/>`);
  const binding = hsonReflect(map);
  const rootDom = mount(binding.tree.node);
  rootDom.failReplace = true;
  const commit = map.install(element(`<main @0000000000000510 title="canonical" <b/>/>`).capture());
  assert.equal(commit.changed, true);
  assert.equal(map.document.attrs.get(path(), "title"), "canonical");
  assert.equal(binding.status, "failed");
  assert.equal(binding.failure?.code, DOCUMENT_REFLECT_ROOT_REPLACEMENT_FAILED_ERROR_CODE);
  assert.equal(binding.sourceRevision, 0);
  assert.throws(() => binding.tree.attrs.set("blocked", true), DocumentReflectError);
  binding.dispose();
});

check("reentrant observation during root DOM convergence fails closed", () => {
  const map = element(`<main @0000000000000511 <a/>/>`);
  const binding = hsonReflect(map);
  const rootDom = mount(binding.tree.node);
  rootDom.beforeReplace = () => {
    rootDom.beforeReplace = undefined;
    map.document.attrs.set(path(), "reentrant", true);
  };
  const commit = map.install(element(`<main @0000000000000511 <b/>/>`).capture());
  assert.equal(commit.changed, true);
  assert.equal(map.rev, 2);
  assert.equal(map.document.attrs.get(path(), "reentrant"), true);
  assert.equal(binding.status, "failed");
  assert.equal(binding.failure?.code, DOCUMENT_REFLECT_ROOT_REPLACEMENT_FAILED_ERROR_CODE);
  assert.equal(binding.sourceRevision, 0);
  assert.equal(binding.diagnostics().updatesApplied, 0);
  binding.dispose();
});

process.stdout.write(`# ${checks} compatible document root convergence checks passed\n`);
emit_hson_live_test_completion("reflect.document-root", checks, checks, 0);
