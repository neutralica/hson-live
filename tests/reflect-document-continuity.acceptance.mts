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
  _livetree_runtime_test_resource_counts,
  _lookup_livetree_runtime_test_node,
  _own_livetree_runtime_test_disposable,
  _reflect_document_for_runtime_test,
} from "../src/diagnostics/index.ts";
import { create_livetree } from "../src/api/livetree/creation/create-livetree.ts";
import { get_el_for_node } from "../src/api/livetree/utils/node-map-helpers.ts";
import {
  DOCUMENT_REFLECT_QUID_COLLISION_ERROR_CODE,
  DOCUMENT_REFLECT_UNSUPPORTED_OPERATION_ERROR_CODE,
  DocumentReflectError,
} from "../src/api/reflect/reflect.document.error.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

let checks = 0;
function check(name: string, run: () => void): void {
  run();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

const documentRuntime = _create_livetree_runtime_test_handle();

function reflected(
  map: ReturnType<typeof element>,
  runtime = _create_livetree_runtime_test_handle(),
) {
  return Object.freeze({ runtime, binding: _reflect_document_for_runtime_test(runtime, map) });
}

const Q1 = "0000000000000711";
const Q2 = "0000000000000712";
const Q3 = "0000000000000713";
const Q4 = "0000000000000714";

check("move preserves the exact projected element node", () => {
  const map = element(`<main <a @${Q1}/> <b @${Q2}/>/` + `>`);
  const { binding } = reflected(map);
  const moved = raw_node(binding.tree.node, [0, 0]);
  map.document.content.move(path(0), 0, 1);
  assert.equal(raw_node(binding.tree.node, [0, 1]), moved);
  binding.dispose();
});

check("move preserves exact descendant identities", () => {
  const map = element(`<main <section @${Q1} <i @${Q2}/>/` + `> <b/>/>`);
  const { binding } = reflected(map);
  const section = raw_node(binding.tree.node, [0, 0]);
  const descendant = raw_node(binding.tree.node, [0, 0, 0, 0]);
  map.document.content.move(path(0), 0, 1);
  assert.equal(raw_node(binding.tree.node, [0, 1]), section);
  assert.equal(raw_node(binding.tree.node, [0, 1, 0, 0]), descendant);
  binding.dispose();
});

check("move preserves the mounted DOM subtree", () => {
  const map = element(`<main <a @${Q4}/> <b/>/>`);
  const { binding } = reflected(map, documentRuntime);
  mount(binding.tree.node);
  const moved = raw_node(binding.tree.node, [0, 0]);
  const dom = get_el_for_node(moved);
  map.document.content.move(path(0), 0, 1);
  assert.equal(get_el_for_node(moved), dom);
  binding.dispose();
});

check("move preserves CSS ownership on the exact handle", () => {
  const map = element(`<main <a @${Q1}/> <b/>/>`);
  const { binding } = reflected(map, documentRuntime);
  const moved = raw_node(binding.tree.node, [0, 0]);
  const handle = create_livetree(moved).adoptRoots(binding.tree.hostRootNode());
  Reflect.set(globalThis, "requestAnimationFrame", () => 1);
  handle.css.set.color("red");
  map.document.content.move(path(0), 0, 1);
  assert.equal(handle.css.get.color(), "red");
  Reflect.deleteProperty(globalThis, "requestAnimationFrame");
  binding.dispose();
});

check("move preserves listener resource ownership", () => {
  const map = element(`<main <a @${Q1}/> <b/>/>`);
  const { runtime, binding } = reflected(map);
  let disposed = 0;
  _own_livetree_runtime_test_disposable(runtime, Q1, () => { disposed += 1; }, "listener");
  map.document.content.move(path(0), 0, 1);
  assert.equal(_livetree_runtime_test_resource_counts(runtime, Q1).listener, 1);
  assert.equal(disposed, 0);
  binding.dispose();
});

check("move preserves tree-event and other resource ownership", () => {
  const map = element(`<main <a @${Q1}/> <b/>/>`);
  const { runtime, binding } = reflected(map);
  _own_livetree_runtime_test_disposable(runtime, Q1, () => {}, "tree-event");
  _own_livetree_runtime_test_disposable(runtime, Q1, () => {}, "other");
  map.document.content.move(path(0), 0, 1);
  const counts = _livetree_runtime_test_resource_counts(runtime, Q1);
  assert.equal(counts.treeEvent, 1);
  assert.equal(counts.other, 1);
  binding.dispose();
});

check("compatible same-QUID replacement preserves the exact root node", () => {
  const map = element(`<main <a @${Q1} "old"/>/>`);
  const { binding } = reflected(map);
  const original = raw_node(binding.tree.node, [0, 0]);
  map.document.content.replace(path(0), 0, projected_element(`<a @${Q1} title="new"/>`));
  assert.equal(raw_node(binding.tree.node, [0, 0]), original);
  assert.equal(original.$_attrs?.title, "new");
  binding.dispose();
});

check("compatible same-QUID replacement preserves root DOM identity", () => {
  const map = element(`<main <a @${Q3}/>/` + `>`);
  const { binding } = reflected(map, documentRuntime);
  mount(binding.tree.node);
  const original = raw_node(binding.tree.node, [0, 0]);
  const dom = get_el_for_node(original);
  map.document.content.replace(path(0), 0, projected_element(`<a @${Q3} title="new"/>`));
  assert.equal(get_el_for_node(original), dom);
  binding.dispose();
});

check("differing-QUID replacement allocates a new projected node", () => {
  const map = element(`<main <a @${Q1}/>/` + `>`);
  const { binding } = reflected(map);
  const original = raw_node(binding.tree.node, [0, 0]);
  map.document.content.replace(path(0), 0, projected_element(`<a @${Q2}/>`));
  assert.notEqual(raw_node(binding.tree.node, [0, 0]), original);
  binding.dispose();
});

check("differing-QUID replacement terminally drains old resources", () => {
  const map = element(`<main <a @${Q1}/>/` + `>`);
  const { runtime, binding } = reflected(map);
  let disposed = 0;
  _own_livetree_runtime_test_disposable(runtime, Q1, () => { disposed += 1; }, "other");
  map.document.content.replace(path(0), 0, projected_element(`<a @${Q2}/>`));
  assert.equal(disposed, 1);
  assert.equal(_lookup_livetree_runtime_test_node(runtime, Q1), undefined);
  binding.dispose();
});

check("same-QUID replacement with a different tag does not reuse", () => {
  const map = element(`<main <a @${Q1}/>/` + `>`);
  const { binding } = reflected(map);
  const original = raw_node(binding.tree.node, [0, 0]);
  map.document.content.replace(path(0), 0, projected_element(`<i @${Q1}/>`));
  assert.notEqual(raw_node(binding.tree.node, [0, 0]), original);
  binding.dispose();
});

check("insertion admits the exact fresh projected subtree", () => {
  const map = element(`<main "tail"/>`);
  const { binding } = reflected(map, documentRuntime);
  map.document.content.insert(path(0), 0, projected_element(`<a @${Q2}/>`));
  const inserted = raw_node(binding.tree.node, [0, 0]);
  mount(binding.tree.node);
  assert.equal(_lookup_livetree_runtime_test_node(documentRuntime, Q2), inserted);
  assert.equal(get_el_for_node(inserted)?.getAttribute("hson:quid"), Q2);
  binding.dispose();
});

check("insertion preserves runtime collision-aware admission", () => {
  const map = element(`<main "tail"/>`);
  const runtime = _create_livetree_runtime_test_handle();
  _create_livetree_for_runtime_test(runtime, projected_element(`<aside @${Q1}/>`));
  const binding = _reflect_document_for_runtime_test(runtime, map);
  map.document.content.insert(path(0), 0, projected_element(`<a @${Q1}/>`));
  assert.equal(binding.status, "failed");
  assert.equal(binding.failure?.code, DOCUMENT_REFLECT_QUID_COLLISION_ERROR_CODE);
  binding.dispose();
});

check("deletion performs terminal resource cleanup", () => {
  const map = element(`<main <a @${Q1}/> <b/>/>`);
  const { runtime, binding } = reflected(map);
  let disposed = 0;
  _own_livetree_runtime_test_disposable(runtime, Q1, () => { disposed += 1; }, "other");
  map.document.content.remove(path(0), 0);
  assert.equal(disposed, 1);
  binding.dispose();
});

check("deletion retires runtime QUID correspondence", () => {
  const map = element(`<main <a @${Q1}/> <b/>/>`);
  const { runtime, binding } = reflected(map);
  map.document.content.remove(path(0), 0);
  assert.equal(_lookup_livetree_runtime_test_node(runtime, Q1), undefined);
  binding.dispose();
});

check("same-position move preserves identity without churn", () => {
  const map = element(`<main <a @${Q1}/>/` + `>`);
  const { binding } = reflected(map);
  const original = raw_node(binding.tree.node, [0, 0]);
  const before = binding.diagnostics();
  map.document.content.move(path(0), 0, 0);
  assert.equal(raw_node(binding.tree.node, [0, 0]), original);
  assert.equal(binding.diagnostics().correspondenceEntriesChanged, before.correspondenceEntriesChanged);
  binding.dispose();
});

check("compatible root replacement preserves the projected root object", () => {
  const map = element(`<main @${Q1} <a @${Q2}/>/` + `>`);
  const { binding } = reflected(map);
  const root = binding.tree.node;
  const replacement = element(`<main @${Q1} <b @${Q3}/>/` + `>`);
  map.install(replacement.capture());
  assert.equal(binding.tree.node, root);
  assert.equal(raw_node(root, [0, 0]).$_tag, "b");
  binding.dispose();
});

check("root replacement is an admitted whole-correspondence rebuild boundary", () => {
  const map = element(`<main @${Q1} <a @${Q2}/>/` + `>`);
  const { binding } = reflected(map);
  const before = binding.diagnostics().wholeCorrespondenceBuilds;
  const replacement = element(`<main @${Q1} <b @${Q3}/>/` + `>`);
  map.install(replacement.capture());
  assert.equal(binding.diagnostics().wholeCorrespondenceBuilds, before + 1);
  binding.dispose();
});

check("bound direct structural mutation is rejected before drift", () => {
  const map = element(`<main @${Q1} <a/>/>`);
  const { binding } = reflected(map);
  const before = structuredClone(binding.tree.node);
  assert.throws(
    () => binding.tree.detachContents(),
    (cause) => cause instanceof DocumentReflectError
      && cause.code === DOCUMENT_REFLECT_UNSUPPORTED_OPERATION_ERROR_CODE,
  );
  assert.deepEqual(binding.tree.node, before);
  binding.dispose();
});

check("unbound detach and reinsert semantics remain unchanged after disposal", () => {
  const map = element(`<main @${Q1} <a @${Q2}/>/` + `>`);
  const { runtime, binding } = reflected(map);
  const childNode = raw_node(binding.tree.node, [0, 0]);
  const child = _create_livetree_for_runtime_test(runtime, childNode).adoptRoots(binding.tree.hostRootNode());
  binding.dispose();
  assert.equal(child.detach(), 1);
  assert.equal(binding.tree.append(child), binding.tree);
  assert.equal(raw_node(binding.tree.node, [0, 0]), childNode);
});

process.stdout.write(`# ${checks} Unit 6 continuity and lifecycle checks passed\n`);
emit_hson_live_test_completion("reflect.document-continuity", checks, checks, 0);
