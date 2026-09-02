import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import { create_test_event_emitter } from "./test-events.mjs";
import assert from "node:assert/strict";
import { hson } from "../src/index.ts";
import type { HsonNode } from "../src/core/types.ts";
import type { DocumentLiveMap } from "../src/types/livemap.types.ts";
import { is_Node } from "../src/core/node-guards.ts";
import { hsonReflect } from "../src/api/reflect/reflect.facade.ts";
import {
  DOCUMENT_REFLECT_QUID_COLLISION_ERROR_CODE,
} from "../src/api/reflect/reflect.document.error.ts";
import { create_livetree } from "../src/api/livetree/creation/create-livetree.ts";
import { project_livetree } from "../src/api/livetree/creation/project-live-tree.ts";
import { get_el_for_node } from "../src/api/livetree/utils/node-map-helpers.ts";
import { FakeElement, FakeText, install_fake_document } from "./helpers/fake-document.mts";

install_fake_document();

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "reflect.document-root",
  title: "Document Reflect root update",
  category: "Reflect",
  runtime: "node-synthetic-dom",
  tags: Object.freeze(["document", "binding", "root"]),
});

const testEvents = create_test_event_emitter("reflect.document-root");
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

function element(source: string): DocumentLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "document") throw new Error("Expected DocumentLiveMap");
  return map;
}

function raw_node(root: HsonNode, path: readonly number[]): HsonNode {
  let current = root;
  if (current.$_tag === "_hson_root") {
    const only = current.$_content[0];
    if (!is_Node(only)) throw new Error("Expected one document element");
    current = only;
  }
  for (const segment of path) {
    const child = current.$_content[segment];
    if (!is_Node(child)) throw new Error(`Expected node at ${path.join("/")}`);
    current = child;
  }
  return current;
}

function path(...segments: number[]) {
  return { kind: "path" as const, path: [0, ...segments] };
}

function mount(root: HsonNode): FakeElement {
  return project_livetree(root.$_tag === "_hson_root" ? raw_node(root, []) : root) as unknown as FakeElement;
}

check("durable install constructs a fresh tree, DOM, and descendant identity epoch", () => {
  const map = element(`<main @000000501 class="old" <p @000000502 "old"/> <i/>/>`);
  const binding = hsonReflect(map);
  const tree = binding.tree;
  const root = raw_node(tree.node, []);
  const rootDom = mount(root);
  const paragraph = raw_node(root, [0, 0]);
  const paragraphDom = get_el_for_node(paragraph);
  const marker = { retained: true };
  Reflect.set(rootDom, "marker", marker);
  const replacement = element(`<main @000000501 class="new" <p @000000502 "next"/> <strong/>/>`);

  const commit = map.install(replacement.capture());

  assert.equal(commit.changed, true);
  assert.equal(binding.status, "active");
  const nextTree = binding.tree;
  const nextRoot = raw_node(nextTree.node, []);
  const nextRootDom = get_el_for_node(nextRoot) as FakeElement | undefined;
  const nextParagraph = raw_node(nextRoot, [0, 0]);
  assert.notEqual(nextTree, tree);
  assert.notEqual(nextRoot, root);
  assert.notEqual(nextRootDom, rootDom);
  assert.equal(tree.isDisposed, true);
  assert.equal(get_el_for_node(root), undefined);
  assert.equal(get_el_for_node(paragraph), undefined);
  assert.equal(get_el_for_node(nextParagraph) === paragraphDom, false);
  assert.equal(Reflect.get(nextRootDom ?? {}, "marker"), undefined);
  assert.equal(nextRoot.$_attrs?.class, "new");
  assert.equal((nextRootDom?.childNodes[0] as FakeElement).childNodes[0] instanceof FakeText, true);
  assert.equal(((nextRootDom?.childNodes[0] as FakeElement).childNodes[0] as FakeText).data, "next");
  assert.equal(binding.sourceRevision, commit.rev);
  assert.equal(binding.diagnostics().updatesApplied, 1);

  create_livetree(nextParagraph).adoptRoots(nextRoot).attrs.set("after", "replace");
  assert.equal(map.document.attrs.get(path(0, 0), "after"), "replace");
  binding.dispose();
});

check("QUID-less durable install is fresh while preserving canonical identity absence", () => {
  const map = element(`<main class="old"/>`);
  const binding = hsonReflect(map);
  const root = raw_node(binding.tree.node, []);
  assert.equal(root.$_meta?.["quid"], undefined);
  const replacement = element(`<main class="next" "text"/>`);
  map.install(replacement.capture());
  assert.equal(binding.status, "active");
  assert.notEqual(raw_node(binding.tree.node, []), root);
  assert.equal(raw_node(binding.tree.node, []).$_meta?.["quid"], undefined);
  assert.equal(raw_node(binding.tree.node, []).$_attrs?.class, "next");
  const canonicalRoot = map.at([]).snap();
  assert.equal(is_Node(canonicalRoot) ? canonicalRoot.$_meta?.["quid"] : undefined, undefined);
  binding.dispose();
});

check("replayed replace-root constructs one fresh projection transaction", () => {
  const source = element(`<main @000000503/>`);
  const target = element(`<main @000000503/>`);
  const binding = hsonReflect(target);
  const root = raw_node(binding.tree.node, []);
  const replacement = element(`<main @000000503 title="replayed" <b/>/>`);
  const commit = source.install(replacement.capture());
  target.replay(commit);
  const replayedRoot = raw_node(binding.tree.node, []);
  assert.notEqual(replayedRoot, root);
  assert.equal(replayedRoot.$_tag, "main");
  assert.equal(create_livetree(replayedRoot).adoptRoots(binding.tree.hostRootNode()).attrs.get("title"), "replayed");
  assert.equal(binding.sourceRevision, 1);
  assert.equal(binding.diagnostics().updatesApplied, 1);
  binding.dispose();
});

check("canonical-equivalent install performs no convergence", () => {
  const map = element(`<main @000000504 class="same"/>`);
  const binding = hsonReflect(map);
  const root = binding.tree.node;
  const commit = map.install(map.capture());
  assert.equal(commit.changed, false);
  assert.equal(binding.tree.node, root);
  assert.equal(binding.sourceRevision, 0);
  assert.equal(binding.diagnostics().updatesApplied, 0);
  binding.dispose();
});

check("new epochs admit fresh tag and persisted root-QUID transitions", () => {
  const tagMap = element(`<main @000000505/>`);
  const tagBinding = hsonReflect(tagMap);
  const tagRoot = tagBinding.tree.node;
  tagMap.install(element(`<article @000000505/>`).capture());
  assert.equal(tagBinding.status, "active");
  assert.notEqual(tagBinding.tree.node, tagRoot);
  assert.equal(raw_node(tagBinding.tree.node, []).$_tag, "article");
  tagBinding.dispose();

  const quidMap = element(`<main @000000506/>`);
  const quidBinding = hsonReflect(quidMap);
  const quidRoot = quidBinding.tree.node;
  quidMap.install(element(`<main @000000507/>`).capture());
  assert.equal(quidBinding.status, "active");
  assert.notEqual(quidBinding.tree.node, quidRoot);
  assert.equal(raw_node(quidBinding.tree.node, []).$_meta?.quid, "000000507");
  quidBinding.dispose();
});

check("descendant QUID collision fails before projected mutation", () => {
  const collisionRoot = element(`<aside @000000508/>`).at([]).snap();
  if (!is_Node(collisionRoot)) throw new Error("Expected collision element");
  create_livetree(collisionRoot);
  const map = element(`<main @000000509 <a/>/>`);
  const binding = hsonReflect(map);
  const before = structuredClone(binding.tree.node);
  map.install(element(`<main @000000509 <aside @000000508/>/>`).capture());
  assert.equal(binding.status, "failed");
  assert.equal(binding.failure?.code, DOCUMENT_REFLECT_QUID_COLLISION_ERROR_CODE);
  assert.deepEqual(binding.tree.node, before);
  assert.equal(binding.sourceRevision, 0);
  binding.dispose();
});

check("new-epoch mounted install does not reuse the old DOM convergence path", () => {
  const map = element(`<main @000000510 <a/>/>`);
  const binding = hsonReflect(map);
  const oldTree = binding.tree;
  const rootDom = mount(oldTree.node);
  rootDom.failReplace = true;
  const commit = map.install(element(`<main @000000510 title="canonical" <b/>/>`).capture());
  assert.equal(commit.changed, true);
  assert.equal(map.document.attrs.get(path(), "title"), "canonical");
  assert.equal(binding.status, "active");
  assert.equal(binding.sourceRevision, 1);
  assert.notEqual(binding.tree, oldTree);
  assert.equal(oldTree.isDisposed, true);
  assert.equal(get_el_for_node(raw_node(binding.tree.node, []))?.getAttribute("title"), "canonical");
  binding.dispose();
});

check("new-epoch reconstruction never invokes stale DOM convergence hooks", () => {
  const map = element(`<main @000000511 <a/>/>`);
  const binding = hsonReflect(map);
  const rootDom = mount(binding.tree.node);
  let invoked = 0;
  rootDom.beforeReplace = () => {
    invoked += 1;
    map.document.attrs.set(path(), "reentrant", true);
  };
  const commit = map.install(element(`<main @000000511 <b/>/>`).capture());
  assert.equal(commit.changed, true);
  assert.equal(invoked, 0);
  assert.equal(map.rev, 1);
  assert.equal(map.document.attrs.get(path(), "reentrant"), undefined);
  assert.equal(binding.status, "active");
  assert.equal(binding.sourceRevision, 1);
  assert.equal(binding.diagnostics().updatesApplied, 1);
  binding.dispose();
});

process.stdout.write(`# ${checks} compatible document root convergence checks passed\n`);
testEvents.terminal("pass");
emit_hson_live_test_completion("reflect.document-root", checks, checks, 0);
