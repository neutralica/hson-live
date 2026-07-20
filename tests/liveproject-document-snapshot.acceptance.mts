import assert from "node:assert/strict";
import { hson } from "../src/index.ts";
import { is_Node } from "../src/core/node-guards.ts";
import type { HsonNode } from "../src/core/types.ts";
import type { DocumentLiveMapCapture, ElementLiveMap } from "../src/types/livemap.types.ts";
import { bind_document_livetree } from "../src/api/liveproject/liveproject.document.ts";
import {
  DOCUMENT_BINDING_ROOT_KIND_MISMATCH_ERROR_CODE,
  DOCUMENT_BINDING_ROOT_QUID_CONFLICT_ERROR_CODE,
  DOCUMENT_BINDING_ROOT_REPLACEMENT_FAILED_ERROR_CODE,
  DOCUMENT_BINDING_SNAPSHOT_CAPTURE_FAILED_ERROR_CODE,
  DOCUMENT_BINDING_SNAPSHOT_REVISION_MISMATCH_ERROR_CODE,
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

function mount(root: HsonNode): FakeElement {
  return project_livetree(root) as unknown as FakeElement;
}

function with_capture(
  map: ElementLiveMap,
  capture: () => DocumentLiveMapCapture<"element">,
): ElementLiveMap {
  return {
    mode: "element",
    get rev() { return map.rev; },
    root: map.root,
    capture,
    install: map.install,
    restore: map.restore,
    replay: map.replay,
    commits: map.commits,
    debug: map.debug,
    document: map.document,
    element: map.element,
  };
}

check("compatible mounted snapshot retains root and bounded descendant identity", () => {
  const map = element(`<main data-_quid="0000000000000601" class="old" <p data-_quid="0000000000000602" "old"/> <i/>/>`);
  const binding = bind_document_livetree(map);
  const tree = binding.tree;
  const root = tree.node;
  const rootDom = mount(root);
  const paragraph = raw_node(root, [0, 0]);
  const paragraphDom = get_el_for_node(paragraph);
  const restored = element(`<main data-_quid="0000000000000601" class="restored" <p data-_quid="0000000000000602" "next"/> <strong/>/>`);
  restored.document.attrs.set(path(), "revision-one", true);
  restored.document.attrs.set(path(), "revision-two", true);

  map.restore(restored.capture());

  assert.equal(binding.status, "active");
  assert.equal(binding.tree, tree);
  assert.equal(binding.tree.node, root);
  assert.equal(get_el_for_node(root), rootDom as unknown as Element);
  assert.equal(raw_node(root, [0, 0]), paragraph);
  assert.equal(get_el_for_node(paragraph), paragraphDom);
  assert.equal(root.$_attrs?.class, "restored");
  assert.equal(((rootDom.childNodes[0] as FakeElement).childNodes[0] as FakeText).data, "next");
  assert.equal(binding.sourceRevision, 2);
  assert.equal(binding.diagnostics().projectionTransactions, 1);

  create_livetree(paragraph).adoptRoots(root).attrs.set("after", "snapshot");
  assert.equal(map.document.attrs.get(path(0, 0), "after"), "snapshot");
  const inserted = raw_node(root, [0, 1]);
  create_livetree(inserted).adoptRoots(root).remove();
  assert.equal(raw_node(map.element.node(), [0]).$_content.length, 1);
  binding.dispose();
});

check("detached QUID-less snapshot retains projection-local root identity", () => {
  const map = element(`<main class="old"/>`);
  const binding = bind_document_livetree(map);
  const root = binding.tree.node;
  const projectionQuid = root.$_meta?.["data-_quid"];
  const restored = element(`<main class="restored" "detached"/>`);
  restored.document.attrs.set(path(), "rev", 1);
  map.restore(restored.capture());
  assert.equal(binding.tree.node, root);
  assert.equal(get_el_for_node(root), undefined);
  assert.equal(root.$_meta?.["data-_quid"], projectionQuid);
  assert.equal(map.element.node().$_meta?.["data-_quid"], undefined);
  assert.equal(binding.sourceRevision, 1);
  binding.dispose();
});

check("restore followed by commit projects from the exact restored revision", () => {
  const map = element(`<main data-_quid="0000000000000603"/>`);
  const binding = bind_document_livetree(map);
  const restored = element(`<main data-_quid="0000000000000603" title="snapshot"/>`);
  restored.document.attrs.set(path(), "snapshot-rev", 1);
  restored.document.attrs.set(path(), "snapshot-rev", 2);
  map.restore(restored.capture());
  const commit = map.document.attrs.set(path(), "after", "commit");
  assert.equal(commit.prevRev, 2);
  assert.equal(commit.rev, 3);
  assert.equal(binding.sourceRevision, 3);
  assert.equal(binding.tree.attrs.get("after"), "commit");
  assert.equal(binding.diagnostics().projectionTransactions, 2);
  binding.dispose();
});

check("snapshot capture revision mismatch fails without latest-state convergence", () => {
  const map = element(`<main data-_quid="0000000000000604" class="old"/>`);
  let captures = 0;
  const wrapped = with_capture(map, () => {
    captures += 1;
    const capture = map.capture();
    return Object.freeze({ ...capture, rev: capture.rev + 1 });
  });
  const binding = bind_document_livetree(wrapped);
  const before = structuredClone(binding.tree.node);
  map.restore(element(`<main data-_quid="0000000000000604" class="canonical"/>`).capture());
  assert.equal(captures, 1);
  assert.equal(map.element.node().$_attrs?.class, "canonical");
  assert.deepEqual(binding.tree.node, before);
  assert.equal(binding.status, "failed");
  assert.equal(binding.failure?.code, DOCUMENT_BINDING_SNAPSHOT_REVISION_MISMATCH_ERROR_CODE);
  assert.equal(binding.sourceRevision, 0);
  binding.dispose();
});

check("repeated snapshots independently recapture and converge", () => {
  const map = element(`<main data-_quid="0000000000000605"/>`);
  let captures = 0;
  const wrapped = with_capture(map, () => {
    captures += 1;
    return map.capture();
  });
  const binding = bind_document_livetree(wrapped);
  const first = element(`<main data-_quid="0000000000000605" state="first"/>`);
  first.document.attrs.set(path(), "rev", 1);
  const second = element(`<main data-_quid="0000000000000605" state="second"/>`);
  second.document.attrs.set(path(), "rev", 1);
  second.document.attrs.set(path(), "rev", 2);
  map.restore(first.capture());
  map.restore(second.capture());
  assert.equal(captures, 2);
  assert.equal(binding.status, "active");
  assert.equal(binding.sourceRevision, 2);
  assert.equal(binding.tree.attrs.get("state"), "second");
  assert.equal(binding.diagnostics().projectionTransactions, 2);
  binding.dispose();
});

check("incompatible snapshot tag and root QUID transitions fail closed", () => {
  const tagMap = element(`<main data-_quid="0000000000000606"/>`);
  const tagBinding = bind_document_livetree(tagMap);
  const tagTree = tagBinding.tree;
  tagMap.restore(element(`<article data-_quid="0000000000000606"/>`).capture());
  assert.equal(tagBinding.status, "failed");
  assert.equal(tagBinding.failure?.code, DOCUMENT_BINDING_ROOT_KIND_MISMATCH_ERROR_CODE);
  assert.equal(tagBinding.tree, tagTree);
  tagBinding.dispose();

  const quidMap = element(`<main data-_quid="0000000000000607"/>`);
  const quidBinding = bind_document_livetree(quidMap);
  const quidRoot = quidBinding.tree.node;
  quidMap.restore(element(`<main data-_quid="0000000000000608"/>`).capture());
  assert.equal(quidBinding.status, "failed");
  assert.equal(quidBinding.failure?.code, DOCUMENT_BINDING_ROOT_QUID_CONFLICT_ERROR_CODE);
  assert.equal(quidBinding.tree.node, quidRoot);
  quidBinding.dispose();
});

check("capture failure remains observer-isolated and disposable", () => {
  const map = element(`<main data-_quid="0000000000000609"/>`);
  let captures = 0;
  const wrapped = with_capture(map, () => {
    captures += 1;
    throw new Error("forced capture failure");
  });
  const binding = bind_document_livetree(wrapped);
  map.restore(element(`<main data-_quid="0000000000000609" title="canonical"/>`).capture());
  assert.equal(captures, 1);
  assert.equal(map.document.attrs.get(path(), "title"), "canonical");
  assert.equal(binding.status, "failed");
  assert.equal(binding.failure?.code, DOCUMENT_BINDING_SNAPSHOT_CAPTURE_FAILED_ERROR_CODE);
  assert.equal(binding.sourceRevision, 0);
  binding.dispose();
  assert.equal(binding.status, "disposed");
});

check("snapshot DOM failure and reentrant observation follow root failure isolation", () => {
  const failedMap = element(`<main data-_quid="0000000000000610" <a/>/>`);
  const failedBinding = bind_document_livetree(failedMap);
  const failedDom = mount(failedBinding.tree.node);
  failedDom.failReplace = true;
  failedMap.restore(element(`<main data-_quid="0000000000000610" <b/>/>`).capture());
  assert.equal(failedBinding.status, "failed");
  assert.equal(failedBinding.failure?.code, DOCUMENT_BINDING_ROOT_REPLACEMENT_FAILED_ERROR_CODE);
  assert.equal(failedBinding.sourceRevision, 0);
  failedBinding.dispose();

  const reentrantMap = element(`<main data-_quid="0000000000000611" <a/>/>`);
  const reentrantBinding = bind_document_livetree(reentrantMap);
  const reentrantDom = mount(reentrantBinding.tree.node);
  reentrantDom.beforeReplace = () => {
    reentrantDom.beforeReplace = undefined;
    reentrantMap.document.attrs.set(path(), "reentrant", true);
  };
  reentrantMap.restore(element(`<main data-_quid="0000000000000611" <b/>/>`).capture());
  assert.equal(reentrantBinding.status, "failed");
  assert.equal(reentrantBinding.failure?.code, DOCUMENT_BINDING_ROOT_REPLACEMENT_FAILED_ERROR_CODE);
  assert.equal(reentrantBinding.sourceRevision, 0);
  assert.throws(() => reentrantBinding.tree.attrs.set("blocked", true), DocumentLiveTreeBindingError);
  reentrantBinding.dispose();
});

check("disposal during snapshot convergence wins over transaction completion", () => {
  const map = element(`<main data-_quid="0000000000000612" <a/>/>`);
  const binding = bind_document_livetree(map);
  const rootDom = mount(binding.tree.node);
  rootDom.beforeReplace = () => {
    rootDom.beforeReplace = undefined;
    binding.dispose();
  };
  map.restore(element(`<main data-_quid="0000000000000612" <b/>/>`).capture());
  assert.equal(binding.status, "disposed");
  assert.equal(binding.sourceRevision, 0);
  assert.equal(map.element.node().$_tag, "main");
  binding.tree.attrs.set("local", true);
  assert.equal(map.document.attrs.get(path(), "local"), undefined);
});

process.stdout.write(`# ${checks} compatible document snapshot convergence checks passed\n`);
