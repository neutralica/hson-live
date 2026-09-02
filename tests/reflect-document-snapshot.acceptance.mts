import { create_test_event_emitter } from "./test-events.mjs";
import assert from "node:assert/strict";
import { hson } from "../src/index.ts";
import { is_Node } from "../src/core/node-guards.ts";
import type { HsonNode } from "../src/core/types.ts";
import type { DocumentLiveMapCapture, DocumentLiveMap } from "../src/types/livemap.types.ts";
import { hsonReflect } from "../src/api/reflect/reflect.facade.ts";
import { create_livetree } from "../src/api/livetree/creation/create-livetree.ts";
import { project_livetree } from "../src/api/livetree/creation/project-live-tree.ts";
import { get_el_for_node } from "../src/api/livetree/utils/node-map-helpers.ts";
import { FakeElement, FakeText, install_fake_document } from "./helpers/fake-document.mts";

install_fake_document();

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "reflect.document-snapshot",
  title: "Document Reflect snapshot update",
  category: "Reflect",
  runtime: "node-synthetic-dom",
  tags: Object.freeze(["document", "binding", "snapshot"]),
});

const testEvents = create_test_event_emitter("reflect.document-snapshot");
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

function path(...segments: number[]) {
  return { kind: "path" as const, path: [0, ...segments] };
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

function mount(root: HsonNode): FakeElement {
  return project_livetree(root.$_tag === "_hson_root" ? raw_node(root, []) : root) as unknown as FakeElement;
}

function with_capture(
  map: DocumentLiveMap,
  capture: () => DocumentLiveMapCapture<"document">,
): DocumentLiveMap {
  return {
    mode: "document",
    get rev() { return map.rev; },
    root: map.root,
    at: map.at,
    proxy: map.proxy,
    capture,
    install: map.install,
    restore: map.restore,
    replay: map.replay,
    commits: map.commits,
    schema: map.schema,
    document: map.document,
  };
}

check("mounted snapshot constructs a fresh tree and descendant identity epoch", () => {
  const map = element(`<main @000000601 class="old" <p @000000602 "old"/> <i/>/>`);
  const binding = hsonReflect(map);
  const tree = binding.tree;
  const root = raw_node(tree.node, []);
  const rootDom = mount(root);
  const paragraph = raw_node(root, [0, 0]);
  const paragraphDom = get_el_for_node(paragraph);
  const restored = element(`<main @000000601 class="restored" <p @000000602 "next"/> <strong/>/>`);
  restored.document.attrs.set(path(), "revision-one", true);
  restored.document.attrs.set(path(), "revision-two", true);

  map.restore(restored.capture());

  assert.equal(binding.status, "active");
  const nextTree = binding.tree;
  const nextRoot = raw_node(nextTree.node, []);
  const nextParagraph = raw_node(nextRoot, [0, 0]);
  const nextRootDom = get_el_for_node(nextRoot) as FakeElement | undefined;
  assert.notEqual(nextTree, tree);
  assert.notEqual(nextRoot, root);
  assert.notEqual(nextParagraph, paragraph);
  assert.notEqual(nextRootDom, rootDom);
  assert.notEqual(get_el_for_node(nextParagraph), paragraphDom);
  assert.equal(tree.isDisposed, true);
  assert.equal(get_el_for_node(root), undefined);
  assert.equal(nextRoot.$_attrs?.class, "restored");
  assert.equal(((nextRootDom?.childNodes[0] as FakeElement).childNodes[0] as FakeText).data, "next");
  assert.equal(binding.sourceRevision, 2);
  assert.equal(binding.diagnostics().updatesApplied, 1);

  create_livetree(nextParagraph).adoptRoots(nextRoot).attrs.set("after", "snapshot");
  assert.equal(map.document.attrs.get(path(0, 0), "after"), "snapshot");
  const inserted = raw_node(nextRoot, [0, 1]);
  create_livetree(inserted).adoptRoots(nextRoot).remove();
  assert.equal(raw_node(map.root(), [0]).$_content.length, 1);
  binding.dispose();
});

check("detached QUID-less snapshot is fresh and preserves canonical identity absence", () => {
  const map = element(`<main class="old"/>`);
  const binding = hsonReflect(map);
  const root = raw_node(binding.tree.node, []);
  assert.equal(root.$_meta?.["quid"], undefined);
  const restored = element(`<main class="restored" "detached"/>`);
  restored.document.attrs.set(path(), "rev", 1);
  map.restore(restored.capture());
  assert.notEqual(raw_node(binding.tree.node, []), root);
  assert.equal(get_el_for_node(raw_node(binding.tree.node, [])), undefined);
  assert.equal(raw_node(binding.tree.node, []).$_meta?.["quid"], undefined);
  assert.equal(raw_node(map.root(), []).$_meta?.["quid"], undefined);
  assert.equal(binding.sourceRevision, 1);
  binding.dispose();
});

check("restore followed by commit projects from the exact restored revision", () => {
  const map = element(`<main @000000603/>`);
  const binding = hsonReflect(map);
  const restored = element(`<main @000000603 title="snapshot"/>`);
  restored.document.attrs.set(path(), "snapshot-rev", 1);
  restored.document.attrs.set(path(), "snapshot-rev", 2);
  map.restore(restored.capture());
  const commit = map.document.attrs.set(path(), "after", "commit");
  assert.equal(commit.prevRev, 2);
  assert.equal(commit.rev, 3);
  assert.equal(binding.sourceRevision, 3);
  assert.equal(raw_node(binding.tree.node, []).$_attrs?.after, "commit");
  assert.equal(binding.diagnostics().updatesApplied, 2);
  binding.dispose();
});

check("snapshot publication consumes private accepted evidence without public recapture", () => {
  const map = element(`<main @000000604 class="old"/>`);
  let captures = 0;
  const wrapped = with_capture(map, () => {
    captures += 1;
    const capture = map.capture();
    return Object.freeze({ ...capture, rev: capture.rev + 1 });
  });
  const binding = hsonReflect(wrapped);
  const before = binding.tree;
  map.restore(element(`<main @000000604 class="canonical"/>`).capture());
  assert.equal(captures, 0);
  assert.equal(raw_node(map.root(), []).$_attrs?.class, "canonical");
  assert.notEqual(binding.tree, before);
  assert.equal(before.isDisposed, true);
  assert.equal(raw_node(binding.tree.node, []).$_attrs?.class, "canonical");
  assert.equal(binding.status, "active");
  assert.equal(binding.sourceRevision, 0);
  binding.dispose();
});

check("repeated snapshots independently reconstruct from accepted evidence", () => {
  const map = element(`<main @000000605/>`);
  let captures = 0;
  const wrapped = with_capture(map, () => {
    captures += 1;
    return map.capture();
  });
  const binding = hsonReflect(wrapped);
  const initialTree = binding.tree;
  const first = element(`<main @000000605 state="first"/>`);
  first.document.attrs.set(path(), "rev", 1);
  const second = element(`<main @000000605 state="second"/>`);
  second.document.attrs.set(path(), "rev", 1);
  second.document.attrs.set(path(), "rev", 2);
  map.restore(first.capture());
  const firstTree = binding.tree;
  map.restore(second.capture());
  assert.equal(captures, 0);
  assert.equal(initialTree.isDisposed, true);
  assert.equal(firstTree.isDisposed, true);
  assert.notEqual(binding.tree, firstTree);
  assert.equal(binding.status, "active");
  assert.equal(binding.sourceRevision, 2);
  assert.equal(raw_node(binding.tree.node, []).$_attrs?.state, "second");
  assert.equal(binding.diagnostics().updatesApplied, 2);
  binding.dispose();
});

check("new snapshot epochs admit fresh tag and root QUID transitions", () => {
  const tagMap = element(`<main @000000606/>`);
  const tagBinding = hsonReflect(tagMap);
  const tagTree = tagBinding.tree;
  tagMap.restore(element(`<article @000000606/>`).capture());
  assert.equal(tagBinding.status, "active");
  assert.notEqual(tagBinding.tree, tagTree);
  assert.equal(tagTree.isDisposed, true);
  assert.equal(raw_node(tagBinding.tree.node, []).$_tag, "article");
  tagBinding.dispose();

  const quidMap = element(`<main @000000607/>`);
  const quidBinding = hsonReflect(quidMap);
  const quidRoot = quidBinding.tree.node;
  quidMap.restore(element(`<main @000000608/>`).capture());
  assert.equal(quidBinding.status, "active");
  assert.notEqual(quidBinding.tree.node, quidRoot);
  assert.equal(raw_node(quidBinding.tree.node, []).$_meta?.quid, "000000608");
  quidBinding.dispose();
});

check("public capture failure is outside private snapshot publication evidence", () => {
  const map = element(`<main @000000609/>`);
  let captures = 0;
  const wrapped = with_capture(map, () => {
    captures += 1;
    throw new Error("forced capture failure");
  });
  const binding = hsonReflect(wrapped);
  map.restore(element(`<main @000000609 title="canonical"/>`).capture());
  assert.equal(captures, 0);
  assert.equal(map.document.attrs.get(path(), "title"), "canonical");
  assert.equal(binding.status, "active");
  assert.equal(raw_node(binding.tree.node, []).$_attrs?.title, "canonical");
  assert.equal(binding.sourceRevision, 0);
  binding.dispose();
  assert.equal(binding.status, "disposed");
});

check("new snapshot epochs do not reuse stale DOM convergence hooks", () => {
  const failedMap = element(`<main @000000610 <a/>/>`);
  const failedBinding = hsonReflect(failedMap);
  const failedTree = failedBinding.tree;
  const failedDom = mount(failedBinding.tree.node);
  failedDom.failReplace = true;
  failedMap.restore(element(`<main @000000610 <b/>/>`).capture());
  assert.equal(failedBinding.status, "active");
  assert.notEqual(failedBinding.tree, failedTree);
  assert.equal(failedTree.isDisposed, true);
  assert.equal(failedBinding.sourceRevision, 0);
  failedBinding.dispose();

  const reentrantMap = element(`<main @000000611 <a/>/>`);
  const reentrantBinding = hsonReflect(reentrantMap);
  const reentrantDom = mount(reentrantBinding.tree.node);
  let invoked = 0;
  reentrantDom.beforeReplace = () => {
    invoked += 1;
    reentrantMap.document.attrs.set(path(), "reentrant", true);
  };
  reentrantMap.restore(element(`<main @000000611 <b/>/>`).capture());
  assert.equal(invoked, 0);
  assert.equal(reentrantBinding.status, "active");
  assert.equal(reentrantBinding.sourceRevision, 0);
  assert.equal(reentrantMap.document.attrs.get(path(), "reentrant"), undefined);
  reentrantBinding.dispose();
});

check("stale snapshot convergence hooks cannot dispose the fresh binding", () => {
  const map = element(`<main @000000612 <a/>/>`);
  const binding = hsonReflect(map);
  const rootDom = mount(binding.tree.node);
  const oldTree = binding.tree;
  let invoked = 0;
  rootDom.beforeReplace = () => {
    invoked += 1;
    binding.dispose();
  };
  map.restore(element(`<main @000000612 <b/>/>`).capture());
  assert.equal(invoked, 0);
  assert.equal(binding.status, "active");
  assert.notEqual(binding.tree, oldTree);
  assert.equal(oldTree.isDisposed, true);
  assert.equal(binding.sourceRevision, 0);
  assert.equal(raw_node(map.root(), []).$_tag, "main");
  create_livetree(raw_node(binding.tree.node, [])).adoptRoots(binding.tree.hostRootNode()).attrs.set("local", true);
  assert.equal(map.document.attrs.get(path(), "local"), true);
  binding.dispose();
});

process.stdout.write(`# ${checks} compatible document snapshot convergence checks passed\n`);
testEvents.terminal("pass");
