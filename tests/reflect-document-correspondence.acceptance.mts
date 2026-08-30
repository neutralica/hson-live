// @hson-live-external-test
import assert from "node:assert/strict";
import {
  element,
  mount,
  path,
  projected_element,
  raw_node,
} from "./helpers/reflect-unit6.mts";
import {
  _create_livetree_for_runtime_test,
  _create_livetree_runtime_test_handle,
  _reflect_document_for_runtime_test,
} from "../src/diagnostics/index.ts";
import {
  DOCUMENT_REFLECT_QUID_COLLISION_ERROR_CODE,
  DOCUMENT_REFLECT_STRUCTURAL_UPDATE_FAILED_ERROR_CODE,
} from "../src/api/reflect/reflect.document.error.ts";
import type {
  LiveMapAnyOp,
  LiveMapCommitObservation,
  LiveMapGraphOp,
} from "../src/types/livemap.types.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

let checks = 0;
function check(name: string, run: () => void): void {
  run();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function reflected(map: ReturnType<typeof element>) {
  const runtime = _create_livetree_runtime_test_handle();
  return Object.freeze({ runtime, binding: _reflect_document_for_runtime_test(runtime, map) });
}

function replay(map: ReturnType<typeof element>, operations: readonly LiveMapGraphOp[]): void {
  map.replay(Object.freeze({
    changed: true,
    prevRev: map.rev,
    rev: map.rev + 1,
    ops: Object.freeze([...operations]),
  }));
}

function is_graph_operation(operation: LiveMapAnyOp): operation is LiveMapGraphOp {
  return "domain" in operation && operation.domain === "graph";
}

const Q1 = "000000721";
const Q2 = "000000722";
const Q3 = "000000723";
const Q4 = "000000724";
const COLLISION = "000000791";
const documentRuntime = _create_livetree_runtime_test_handle();

check("insert incrementally shifts later projected correspondence", () => {
  const map = element(`<main <a/> <b/>/>`);
  const { runtime, binding } = reflected(map);
  const shifted = raw_node(binding.tree.node, [0, 1]);
  map.document.content.insert(path(0), 0, projected_element(`<i/>`));
  const handle = _create_livetree_for_runtime_test(runtime, shifted).adoptRoots(binding.tree.hostRootNode());
  handle.attrs.set("shifted", true);
  assert.equal(map.document.attrs.get(path(0, 2), "shifted"), true);
  binding.dispose();
});

check("remove incrementally shifts surviving projected correspondence", () => {
  const map = element(`<main <a/> <b/> <c/>/>`);
  const { runtime, binding } = reflected(map);
  const shifted = raw_node(binding.tree.node, [0, 2]);
  map.document.content.remove(path(0), 0);
  const handle = _create_livetree_for_runtime_test(runtime, shifted).adoptRoots(binding.tree.hostRootNode());
  handle.attrs.set("shifted", true);
  assert.equal(map.document.attrs.get(path(0, 1), "shifted"), true);
  binding.dispose();
});

check("forward move publishes the moved projected path", () => {
  const map = element(`<main <a/> <b/> <c/>/>`);
  const { runtime, binding } = reflected(map);
  const moved = raw_node(binding.tree.node, [0, 0]);
  map.document.content.move(path(0), 0, 2);
  const handle = _create_livetree_for_runtime_test(runtime, moved).adoptRoots(binding.tree.hostRootNode());
  handle.attrs.set("moved", "forward");
  assert.equal(map.document.attrs.get(path(0, 2), "moved"), "forward");
  binding.dispose();
});

check("backward move publishes the moved projected path", () => {
  const map = element(`<main <a/> <b/> <c/>/>`);
  const { runtime, binding } = reflected(map);
  const moved = raw_node(binding.tree.node, [0, 2]);
  map.document.content.move(path(0), 2, 0);
  const handle = _create_livetree_for_runtime_test(runtime, moved).adoptRoots(binding.tree.hostRootNode());
  handle.attrs.set("moved", "backward");
  assert.equal(map.document.attrs.get(path(0, 0), "moved"), "backward");
  binding.dispose();
});

check("replacement publishes correspondence for the replacement subtree", () => {
  const map = element(`<main <a/> <b/>/>`);
  const { runtime, binding } = reflected(map);
  map.document.content.replace(path(0), 0, projected_element(`<i/>`));
  const replacement = raw_node(binding.tree.node, [0, 0]);
  const handle = _create_livetree_for_runtime_test(runtime, replacement).adoptRoots(binding.tree.hostRootNode());
  handle.attrs.set("replacement", true);
  assert.equal(map.document.attrs.get(path(0, 0), "replacement"), true);
  binding.dispose();
});

check("staged multi-operation replay publishes only final correspondence", () => {
  const map = element(`<main <a @${Q1}/> <b @${Q2}/>/` + `>`);
  const { runtime, binding } = reflected(map);
  const a = raw_node(binding.tree.node, [0, 0]);
  replay(map, [
    { domain: "graph", op: "insert-content", target: path(0), index: 1, content: projected_element(`<i @${Q3}/>`), },
    { domain: "graph", op: "move-content", target: path(0), from: 0, to: 2 },
    { domain: "graph", op: "set-attr", target: path(0, 2), name: "final", value: true },
  ]);
  const handle = _create_livetree_for_runtime_test(runtime, a).adoptRoots(binding.tree.hostRootNode());
  handle.attrs.set("delegated", true);
  assert.equal(map.document.attrs.get(path(0, 2), "delegated"), true);
  assert.equal(binding.diagnostics().incrementalCorrespondenceUpdates, 1);
  binding.dispose();
});

check("failed planning leaves mounted DOM untouched", () => {
  const runtime = _create_livetree_runtime_test_handle();
  _create_livetree_for_runtime_test(runtime, projected_element(`<aside @${COLLISION}/>`));
  const map = element(`<main <a/>/>`);
  const binding = _reflect_document_for_runtime_test(runtime, map);
  const before = structuredClone(binding.tree.node);
  map.document.content.insert(path(0), 1, projected_element(`<b @${COLLISION}/>`));
  assert.equal(binding.failure?.code, DOCUMENT_REFLECT_QUID_COLLISION_ERROR_CODE);
  assert.deepEqual(binding.tree.node, before);
  binding.dispose();
});

check("failed planning publishes no completed correspondence revision", () => {
  const runtime = _create_livetree_runtime_test_handle();
  _create_livetree_for_runtime_test(runtime, projected_element(`<aside @${COLLISION}/>`));
  const map = element(`<main <a/>/>`);
  const binding = _reflect_document_for_runtime_test(runtime, map);
  const before = binding.diagnostics();
  map.document.content.insert(path(0), 1, projected_element(`<b @${COLLISION}/>`));
  const after = binding.diagnostics();
  assert.equal(binding.sourceRevision, 0);
  assert.equal(after.incrementalCorrespondenceUpdates, before.incrementalCorrespondenceUpdates);
  binding.dispose();
});

check("post-commit DOM application failure has a distinct code", () => {
  const map = element(`<main <a/>/>`);
  const binding = _reflect_document_for_runtime_test(documentRuntime, map);
  const rootDom = mount(binding.tree.node);
  rootDom.failReplace = true;
  map.document.content.insert(path(0), 1, projected_element(`<b/>`));
  assert.equal(binding.failure?.code, DOCUMENT_REFLECT_STRUCTURAL_UPDATE_FAILED_ERROR_CODE);
  binding.dispose();
});

check("DOM projection failure does not roll back the canonical commit", () => {
  const map = element(`<main <a/>/>`);
  const binding = _reflect_document_for_runtime_test(documentRuntime, map);
  const rootDom = mount(binding.tree.node);
  rootDom.failReplace = true;
  const commit = map.document.content.insert(path(0), 1, projected_element(`<b/>`));
  assert.equal(commit.changed, true);
  assert.equal(map.rev, 1);
  assert.equal(raw_node(map.root(), [0]).$_content.length, 2);
  binding.dispose();
});

check("a fresh binding rebuilds correspondence from canonical recovery state", () => {
  const map = element(`<main <a/>/>`);
  const failed = _reflect_document_for_runtime_test(documentRuntime, map);
  const rootDom = mount(failed.tree.node);
  rootDom.failReplace = true;
  map.document.content.insert(path(0), 1, projected_element(`<b/>`));
  failed.dispose();
  const recovered = _reflect_document_for_runtime_test(documentRuntime, map);
  assert.equal(raw_node(recovered.tree.node, [0, 1]).$_tag, "b");
  assert.equal(recovered.diagnostics().wholeCorrespondenceBuilds, 1);
  recovered.dispose();
});

check("attribute projection leaves whole-build accounting unchanged", () => {
  const map = element(`<main @${Q1}/>`);
  const { binding } = reflected(map);
  const before = binding.diagnostics().wholeCorrespondenceBuilds;
  map.document.attrs.set(path(), "x", 1);
  assert.equal(binding.diagnostics().wholeCorrespondenceBuilds, before);
  binding.dispose();
});

check("insert leaves whole-build accounting unchanged", () => {
  const map = element(`<main <a/>/>`);
  const { binding } = reflected(map);
  const before = binding.diagnostics().wholeCorrespondenceBuilds;
  map.document.content.insert(path(0), 1, projected_element(`<b/>`));
  assert.equal(binding.diagnostics().wholeCorrespondenceBuilds, before);
  binding.dispose();
});

check("remove leaves whole-build accounting unchanged", () => {
  const map = element(`<main <a/> <b/>/>`);
  const { binding } = reflected(map);
  const before = binding.diagnostics().wholeCorrespondenceBuilds;
  map.document.content.remove(path(0), 0);
  assert.equal(binding.diagnostics().wholeCorrespondenceBuilds, before);
  binding.dispose();
});

check("move leaves whole-build accounting unchanged", () => {
  const map = element(`<main <a/> <b/>/>`);
  const { binding } = reflected(map);
  const before = binding.diagnostics().wholeCorrespondenceBuilds;
  map.document.content.move(path(0), 0, 1);
  assert.equal(binding.diagnostics().wholeCorrespondenceBuilds, before);
  binding.dispose();
});

check("replacement leaves whole-build accounting unchanged", () => {
  const map = element(`<main <a/>/>`);
  const { binding } = reflected(map);
  const before = binding.diagnostics().wholeCorrespondenceBuilds;
  map.document.content.replace(path(0), 0, projected_element(`<b/>`));
  assert.equal(binding.diagnostics().wholeCorrespondenceBuilds, before);
  binding.dispose();
});

check("root replacement performs the permitted whole build", () => {
  const map = element(`<main @${Q1} <a @${Q2}/>/` + `>`);
  const { binding } = reflected(map);
  const before = binding.diagnostics().wholeCorrespondenceBuilds;
  map.install(element(`<main @${Q1} <b @${Q3}/>/` + `>`).capture());
  assert.equal(binding.diagnostics().wholeCorrespondenceBuilds, before + 1);
  binding.dispose();
});

check("ordinary mutation and replay yield equivalent projection", () => {
  const left = element(`<main <a @${Q1}/> <b @${Q2}/>/` + `>`);
  const right = element(`<main <a @${Q1}/> <b @${Q2}/>/` + `>`);
  const leftBinding = reflected(left).binding;
  const rightBinding = reflected(right).binding;
  const commit = left.document.content.move(path(0), 0, 1);
  right.replay(commit);
  assert.equal(rightBinding.tree.node.$_tag, leftBinding.tree.node.$_tag);
  assert.deepEqual(rightBinding.tree.node.$_content, leftBinding.tree.node.$_content);
  leftBinding.dispose();
  rightBinding.dispose();
});

check("legacy QUID input is translated before Reflection observes it", () => {
  const map = element(`<main @${Q1}/>`);
  const { binding } = reflected(map);
  const observations: LiveMapCommitObservation[] = [];
  map.commits.observe((observation) => observations.push(observation));
  map.document.attrs.set({ kind: "quid", quid: Q1 }, "legacy", true);
  const observation = observations.at(-1);
  if (observation?.kind !== "commit") throw new Error("Expected commit");
  const operation = observation.commit.ops[0];
  assert.ok(operation !== undefined && is_graph_operation(operation) && operation.op !== "replace-root");
  assert.equal(operation.target.kind, "path");
  assert.equal(raw_node(binding.tree.node, []).$_attrs?.legacy, true);
  binding.dispose();
});

check("identity effects and correspondence changes have deterministic counts", () => {
  const map = element(`<main @${Q1} <a @${Q2}/> <b @${Q3}/>/` + `>`);
  const { binding } = reflected(map);
  map.document.content.move(path(0), 0, 1);
  const diagnostics = binding.diagnostics();
  assert.equal(diagnostics.identityEffectsConsumed, 2);
  assert.equal(diagnostics.correspondenceEntriesChanged, 2);
  assert.equal(diagnostics.incrementalCorrespondenceUpdates, 1);
  binding.dispose();
});

check("QUID-free repeated local operations remain incrementally routable", () => {
  const map = element(`<main <a/> <b/>/>`);
  const { binding } = reflected(map);
  map.document.content.move(path(0), 0, 1);
  map.document.content.move(path(0), 1, 0);
  map.document.attrs.set(path(0, 0), "done", true);
  const diagnostics = binding.diagnostics();
  assert.equal(diagnostics.wholeCorrespondenceBuilds, 1);
  assert.equal(diagnostics.incrementalCorrespondenceUpdates, 2);
  assert.equal(diagnostics.identityEffectsConsumed, 0);
  binding.dispose();
});

process.stdout.write(`# ${checks} Unit 6 correspondence and failure checks passed\n`);
emit_hson_live_test_completion("reflect.document-correspondence", checks, checks, 0);
