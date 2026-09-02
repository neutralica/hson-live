// @hson-live-external-test
import assert from "node:assert/strict";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import {
  element,
  mount,
  path,
  projected_element,
  raw_node,
} from "./helpers/reflect-unit6.mts";
import { acquire_document_identity } from "./helpers/livemap-identity-internal.mts";
import {
  _create_livetree_for_runtime_test,
  _create_livetree_runtime_test_handle,
  _livetree_runtime_test_resource_counts,
  _lookup_livetree_runtime_test_node,
  _own_livetree_runtime_test_disposable,
  _reflect_document_for_runtime_test,
} from "../src/diagnostics/index.ts";
import { create_livetree } from "../src/api/livetree/creation/create-livetree.ts";
import {
  livemap_document_identity_effects_for,
  livemap_document_identity_overlay_for,
} from "../src/api/livemap/livemap.document.identity.ts";
import { livemap_identity_epoch_accounting } from "../src/api/livemap/livemap.identity-epoch.ts";
import { get_el_for_node } from "../src/api/livetree/utils/node-map-helpers.ts";
import type { HsonNode } from "../src/core/types.ts";

let checks = 0;
function check(name: string, run: () => void): void {
  run();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

const target = (...segments: number[]) => Object.freeze({
  kind: "path" as const,
  path: Object.freeze([0, ...segments]),
});
const mountedRuntime = _create_livetree_runtime_test_handle();

function effects(commit: object): readonly string[] {
  return livemap_document_identity_effects_for(commit as never)?.map((effect) => effect.kind) ?? [];
}

check("A to absent retires the active mapping but retains the issued ledger entry", () => {
  const A = "000008201";
  const map = element(`<main <a @${A}/>/` + `>`);
  const handle = acquire_document_identity(map.document, target(0, 0));
  const commit = map.document.content.replace(path(0), 0, projected_element(`<b/>`));
  assert.deepEqual(effects(commit), ["retired"]);
  assert.equal(livemap_document_identity_overlay_for(map.document).pathForQuid(A), undefined);
  assert.deepEqual(livemap_identity_epoch_accounting(map.document), { epoch: 0, issued: 1 });
  assert.equal(handle.active, false);
});

check("A to B retires A, introduces B, and grows the monotonic issued ledger", () => {
  const A = "000008202";
  const B = "000008203";
  const map = element(`<main <a @${A}/>/` + `>`);
  const oldHandle = acquire_document_identity(map.document, target(0, 0));
  const commit = map.document.content.replace(path(0), 0, projected_element(`<b @${B}/>`));
  assert.deepEqual(effects(commit), ["retired", "introduced"]);
  assert.equal(map.document.byQuid(A), undefined);
  assert.equal(map.document.byQuid(B)?.$_tag, "b");
  assert.deepEqual(livemap_identity_epoch_accounting(map.document), { epoch: 0, issued: 2 });
  assert.equal(oldHandle.active, false);
});

check("A to A same-tag replacement keeps one canonical active subject", () => {
  const A = "000008204";
  const map = element(`<main <a @${A} title="old"/>/>`);
  const handle = acquire_document_identity(map.document, target(0, 0));
  const commit = map.document.content.replace(path(0), 0, projected_element(`<a @${A} title="new"/>`));
  assert.deepEqual(effects(commit), ["retired", "introduced"]);
  assert.deepEqual(livemap_document_identity_overlay_for(map.document).pathForQuid(A), [0, 0, 0]);
  assert.deepEqual(livemap_identity_epoch_accounting(map.document), { epoch: 0, issued: 1 });
  assert.equal(handle.active, true);
  assert.equal(handle.snap()?.$_attrs?.title, "new");
});

check("A to A same-tag replacement preserves exact objects and converges DOM attrs", () => {
  const A = "000008205";
  const runtime = mountedRuntime;
  const map = element(`<main <a @${A}/>/` + `>`);
  const binding = _reflect_document_for_runtime_test(runtime, map);
  mount(binding.tree.node);
  const oldNode = raw_node(binding.tree.node, [0, 0]);
  const oldDom = get_el_for_node(oldNode);
  map.document.content.replace(path(0), 0, projected_element(`<a @${A} title="new"/>`));
  assert.equal(binding.status, "active");
  assert.equal(raw_node(binding.tree.node, [0, 0]), oldNode);
  assert.equal(get_el_for_node(oldNode), oldDom);
  assert.equal(oldNode.$_attrs?.title, "new");
  assert.equal(oldDom?.getAttribute("title"), "new");
  binding.dispose();
});

check("A to A same-tag replacement preserves runtime claim and root-owned resources", () => {
  const A = "000008206";
  const runtime = _create_livetree_runtime_test_handle();
  const map = element(`<main <a @${A}/>/` + `>`);
  const binding = _reflect_document_for_runtime_test(runtime, map);
  const oldNode = raw_node(binding.tree.node, [0, 0]);
  let disposed = 0;
  _own_livetree_runtime_test_disposable(runtime, A, () => { disposed += 1; }, "listener");
  map.document.content.replace(path(0), 0, projected_element(`<a @${A} title="new"/>`));
  assert.equal(_lookup_livetree_runtime_test_node(runtime, A), oldNode);
  assert.equal(_livetree_runtime_test_resource_counts(runtime, A).listener, 1);
  assert.equal(disposed, 0);
  binding.dispose();
});

check("A to A different-tag replacement still preserves canonical subject continuity", () => {
  const A = "000008207";
  const map = element(`<main <a @${A}/>/` + `>`);
  const handle = acquire_document_identity(map.document, target(0, 0));
  const commit = map.document.content.replace(path(0), 0, projected_element(`<i @${A}/>`));
  assert.deepEqual(effects(commit), ["retired", "introduced"]);
  assert.equal(map.document.byQuid(A)?.$_tag, "i");
  assert.equal(handle.active, true);
  assert.equal(handle.snap()?.$_tag, "i");
  assert.deepEqual(livemap_identity_epoch_accounting(map.document), { epoch: 0, issued: 1 });
});

check("A to A different-tag replacement transfers the active runtime lineage", () => {
  const A = "000008208";
  const runtime = _create_livetree_runtime_test_handle();
  const map = element(`<main <a @${A}/>/` + `>`);
  const binding = _reflect_document_for_runtime_test(runtime, map);
  const oldNode = raw_node(binding.tree.node, [0, 0]);
  const oldHandle = create_livetree(oldNode).adoptRoots(binding.tree.hostRootNode());
  let disposed = 0;
  _own_livetree_runtime_test_disposable(runtime, A, () => { disposed += 1; }, "other");
  map.document.content.replace(path(0), 0, projected_element(`<i @${A}/>`));
  const replacement = raw_node(binding.tree.node, [0, 0]);
  assert.equal(map.rev, 1);
  assert.equal(binding.status, "active");
  assert.equal(binding.sourceRevision, 1);
  assert.notEqual(replacement, oldNode);
  assert.equal(replacement.$_tag, "i");
  assert.equal(_lookup_livetree_runtime_test_node(runtime, A), replacement);
  assert.equal(oldHandle.isDisposed, true);
  assert.equal(disposed, 1);
  binding.dispose();
});

check("absent to A introduces one canonical and runtime identity", () => {
  const A = "000008209";
  const runtime = _create_livetree_runtime_test_handle();
  const map = element(`<main <a/>/>`);
  const binding = _reflect_document_for_runtime_test(runtime, map);
  const commit = map.document.content.replace(path(0), 0, projected_element(`<b @${A}/>`));
  const projected = raw_node(binding.tree.node, [0, 0]);
  assert.deepEqual(effects(commit), ["introduced"]);
  assert.deepEqual(livemap_identity_epoch_accounting(map.document), { epoch: 0, issued: 1 });
  assert.equal(map.document.byQuid(A)?.$_tag, "b");
  assert.equal(_lookup_livetree_runtime_test_node(runtime, A), projected);
  assert.equal(binding.status, "active");
  binding.dispose();
});

check("absent to absent replacement creates neither canonical nor runtime identity", () => {
  const runtime = _create_livetree_runtime_test_handle();
  const map = element(`<main <a/>/>`);
  const binding = _reflect_document_for_runtime_test(runtime, map);
  const commit = map.document.content.replace(path(0), 0, projected_element(`<b/>`));
  assert.deepEqual(effects(commit), []);
  assert.deepEqual(livemap_identity_epoch_accounting(map.document), { epoch: 0, issued: 0 });
  assert.equal(raw_node(binding.tree.node, [0, 0]).$_meta?.quid, undefined);
  assert.equal(binding.status, "active");
  binding.dispose();
});

check("compatible A replacement keeps the root but terminally replaces QUID-free descendants", () => {
  const A = "00000820a";
  const runtime = _create_livetree_runtime_test_handle();
  const map = element(`<main <section @${A} <i/>/>/>`);
  const binding = _reflect_document_for_runtime_test(runtime, map);
  const oldRoot = raw_node(binding.tree.node, [0, 0]);
  const oldChild = raw_node(binding.tree.node, [0, 0, 0, 0]);
  const oldChildHandle = create_livetree(oldChild).adoptRoots(binding.tree.hostRootNode());
  map.document.content.replace(path(0), 0, projected_element(`<section @${A} <b/>/>`));
  assert.equal(raw_node(binding.tree.node, [0, 0]), oldRoot);
  assert.notEqual(raw_node(binding.tree.node, [0, 0, 0, 0]), oldChild);
  assert.equal(oldChildHandle.isDisposed, true);
  assert.equal(binding.status, "active");
  binding.dispose();
});

check("deep A and B equal-byte replacement preserves both canonical handles", () => {
  const A = "00000820b";
  const B = "00000820c";
  const map = element(`<main <section @${A} <i @${B}/>/` + `>/` + `>`);
  const rootHandle = acquire_document_identity(map.document, target(0, 0));
  const childHandle = acquire_document_identity(map.document, target(0, 0, 0, 0));
  map.document.content.replace(
    path(0),
    0,
    projected_element(`<section @${A} <i @${B} title="new"/>/>`),
  );
  assert.equal(rootHandle.active, true);
  assert.equal(childHandle.active, true);
  assert.equal(childHandle.snap()?.$_attrs?.title, "new");
  assert.deepEqual(livemap_identity_epoch_accounting(map.document), { epoch: 0, issued: 2 });
});

check("deep A and B equal-byte replacement preserves recursive runtime continuity", () => {
  const A = "00000820d";
  const B = "00000820e";
  const runtime = _create_livetree_runtime_test_handle();
  const map = element(`<main <section @${A} <i @${B}/>/` + `>/` + `>`);
  const binding = _reflect_document_for_runtime_test(runtime, map);
  const oldRoot = raw_node(binding.tree.node, [0, 0]);
  const oldChild = raw_node(binding.tree.node, [0, 0, 0, 0]);
  let disposed = 0;
  _own_livetree_runtime_test_disposable(runtime, B, () => { disposed += 1; }, "listener");
  map.document.content.replace(
    path(0),
    0,
    projected_element(`<section @${A} <i @${B} title="new"/>/>`),
  );
  assert.equal(binding.status, "active");
  assert.equal(binding.sourceRevision, 1);
  assert.equal(raw_node(binding.tree.node, [0, 0]), oldRoot);
  assert.equal(raw_node(binding.tree.node, [0, 0, 0, 0]), oldChild);
  assert.equal(oldChild.$_attrs?.title, "new");
  assert.equal(_lookup_livetree_runtime_test_node(runtime, A), oldRoot);
  assert.equal(_lookup_livetree_runtime_test_node(runtime, B), oldChild);
  assert.equal(_livetree_runtime_test_resource_counts(runtime, B).listener, 1);
  assert.equal(disposed, 0);
  binding.dispose();
});

check("incompatible A transfer preserves a compatible active B descendant", () => {
  const A = "000008220";
  const B = "000008221";
  const runtime = mountedRuntime;
  const map = element(`<main <section @${A} <i @${B}/>/` + `>/` + `>`);
  const binding = _reflect_document_for_runtime_test(runtime, map);
  mount(binding.tree.node);
  const oldA = raw_node(binding.tree.node, [0, 0]);
  const oldB = raw_node(binding.tree.node, [0, 0, 0, 0]);
  const oldBDom = get_el_for_node(oldB);
  const oldAHandle = create_livetree(oldA).adoptRoots(binding.tree.hostRootNode());
  let disposedA = 0;
  let disposedB = 0;
  _own_livetree_runtime_test_disposable(runtime, A, () => { disposedA += 1; }, "other");
  _own_livetree_runtime_test_disposable(runtime, B, () => { disposedB += 1; }, "listener");
  map.document.content.replace(
    path(0),
    0,
    projected_element(`<article @${A} <i @${B} title="kept"/>/>`),
  );
  const newA = raw_node(binding.tree.node, [0, 0]);
  const retainedB = raw_node(binding.tree.node, [0, 0, 0, 0]);
  assert.equal(binding.status, "active");
  assert.equal(binding.sourceRevision, 1);
  assert.notEqual(newA, oldA);
  assert.equal(newA.$_tag, "article");
  assert.equal(retainedB, oldB);
  assert.equal(get_el_for_node(retainedB), oldBDom);
  assert.equal(retainedB.$_attrs?.title, "kept");
  assert.equal(_lookup_livetree_runtime_test_node(runtime, A), newA);
  assert.equal(_lookup_livetree_runtime_test_node(runtime, B), retainedB);
  assert.equal(oldAHandle.isDisposed, true);
  assert.equal(disposedA, 1);
  assert.equal(disposedB, 0);
  assert.equal(_livetree_runtime_test_resource_counts(runtime, B).listener, 1);
  binding.dispose();
});

check("attrs-only A replacement preserves exact DOM identity and fully converges its attrs", () => {
  const A = "00000820f";
  const runtime = mountedRuntime;
  const map = element(`<main <a @${A} title="old" stale="remove"/>/>`);
  const binding = _reflect_document_for_runtime_test(runtime, map);
  mount(binding.tree.node);
  const oldNode = raw_node(binding.tree.node, [0, 0]);
  const oldDom = get_el_for_node(oldNode);
  map.document.content.replace(path(0), 0, projected_element(`<a @${A} title="new" class="kept"/>`));
  assert.equal(raw_node(binding.tree.node, [0, 0]), oldNode);
  assert.equal(get_el_for_node(oldNode), oldDom);
  assert.equal(oldNode.$_attrs?.title, "new");
  assert.equal(oldDom?.getAttribute("title"), "new");
  assert.equal(oldDom?.getAttribute("class"), "kept");
  assert.equal(oldDom?.getAttribute("stale"), null);
  binding.dispose();
});

check("replay preserves the receiver's active A lineage, not the source exact object", () => {
  const A = "00000820g";
  const sourceRuntime = _create_livetree_runtime_test_handle();
  const source = element(`<main <a @${A} title="old"/>/>`);
  const sourceBinding = _reflect_document_for_runtime_test(sourceRuntime, source);
  const sourceObject = raw_node(sourceBinding.tree.node, [0, 0]);
  const commit = source.document.content.replace(path(0), 0, projected_element(`<a @${A} title="new"/>`));

  const receiverRuntime = _create_livetree_runtime_test_handle();
  const receiver = element(`<main <a @${A} title="old"/>/>`);
  const receiverBinding = _reflect_document_for_runtime_test(receiverRuntime, receiver);
  const receiverObject = raw_node(receiverBinding.tree.node, [0, 0]);
  receiver.replay(commit);
  assert.deepEqual(receiver.capture(), source.capture());
  assert.equal(raw_node(receiverBinding.tree.node, [0, 0]), receiverObject);
  assert.notEqual(receiverObject, sourceObject);
  assert.equal(receiverBinding.sourceRevision, 1);
  sourceBinding.dispose();
  receiverBinding.dispose();
});

check("fresh reconstruction from equal canonical bytes creates a different exact projection", () => {
  const A = "00000820h";
  const firstRuntime = _create_livetree_runtime_test_handle();
  const firstMap = element(`<main <a @${A} title="new"/>/>`);
  const first = _reflect_document_for_runtime_test(firstRuntime, firstMap);
  const firstObject = raw_node(first.tree.node, [0, 0]);

  const freshRuntime = _create_livetree_runtime_test_handle();
  const freshMap = element(`<main <a @${A} title="new"/>/>`);
  const fresh = _reflect_document_for_runtime_test(freshRuntime, freshMap);
  const freshObject = raw_node(fresh.tree.node, [0, 0]);
  assert.deepEqual(freshMap.capture(), firstMap.capture());
  assert.notEqual(freshObject, firstObject);
  assert.equal(_lookup_livetree_runtime_test_node(freshRuntime, A), freshObject);
  assert.equal(_lookup_livetree_runtime_test_node(firstRuntime, A), firstObject);
  first.dispose();
  fresh.dispose();
});

check("durable new-epoch root install replaces exact runtime and DOM identity", () => {
  const A = "00000820v";
  const runtime = mountedRuntime;
  const map = element(`<main @${A} title="old"/>`);
  const binding = _reflect_document_for_runtime_test(runtime, map);
  const oldTree = binding.tree;
  mount(binding.tree.node);
  const oldRoot = raw_node(binding.tree.node, []);
  const oldDom = get_el_for_node(oldRoot);
  const oldHandle = acquire_document_identity(map.document, target());
  let disposed = 0;
  _own_livetree_runtime_test_disposable(runtime, A, () => { disposed += 1; }, "listener");
  map.install(element(`<main @${A} title="new"/>`).capture());
  assert.deepEqual(livemap_identity_epoch_accounting(map.document), { epoch: 1, issued: 1 });
  assert.equal(oldHandle.active, false);
  assert.equal(binding.status, "active");
  const newRoot = raw_node(binding.tree.node, []);
  const newDom = get_el_for_node(newRoot);
  assert.notEqual(binding.tree, oldTree);
  assert.notEqual(newRoot, oldRoot);
  assert.notEqual(newDom, oldDom);
  assert.equal(oldTree.isDisposed, true);
  assert.equal(get_el_for_node(oldRoot), undefined);
  assert.equal(newDom?.getAttribute("title"), "new");
  assert.equal(_lookup_livetree_runtime_test_node(runtime, A), newRoot);
  assert.equal(_livetree_runtime_test_resource_counts(runtime, A).listener, 0);
  assert.equal(disposed, 1);
  binding.dispose();
});

check("explicit binding disposal during old-epoch resource drain wins", () => {
  const A = "000008222";
  const runtime = _create_livetree_runtime_test_handle();
  const map = element(`<main @${A} title="old"/>`);
  const binding = _reflect_document_for_runtime_test(runtime, map);
  const oldTree = binding.tree;
  _own_livetree_runtime_test_disposable(runtime, A, () => binding.dispose(), "other");
  map.install(element(`<main @${A} title="new"/>`).capture());
  assert.equal(map.document.attrs.get(path(), "title"), "new");
  assert.equal(binding.status, "disposed");
  assert.equal(binding.sourceRevision, 0);
  assert.equal(oldTree.isDisposed, true);
  assert.equal(_lookup_livetree_runtime_test_node(runtime, A), undefined);
});

check("exact same-epoch root admission preserves both canonical and runtime continuity", () => {
  const A = "00000820j";
  const runtime = _create_livetree_runtime_test_handle();
  const map = element(`<main @${A} title="captured"/>`);
  const binding = _reflect_document_for_runtime_test(runtime, map);
  const oldRoot = raw_node(binding.tree.node, []);
  const handle = acquire_document_identity(map.document, target());
  const capture = map.capture({ identity: "same-epoch" });
  map.document.attrs.set(path(), "title", "changed");
  map.install(capture, { identity: "same-epoch" });
  assert.deepEqual(livemap_identity_epoch_accounting(map.document), { epoch: 0, issued: 1 });
  assert.equal(handle.active, true);
  assert.equal(raw_node(binding.tree.node, []), oldRoot);
  assert.equal(oldRoot.$_attrs?.title, "captured");
  binding.dispose();
});

check("copied same-epoch capture has no continuity authority", () => {
  const A = "00000820k";
  const map = element(`<main @${A}/>`);
  const binding = _reflect_document_for_runtime_test(_create_livetree_runtime_test_handle(), map);
  const exact = map.capture({ identity: "same-epoch" });
  const copy = Object.freeze({ ...exact });
  assert.throws(() => map.install(copy, { identity: "same-epoch" }), /exact live capture capability/);
  assert.equal(map.rev, 0);
  assert.equal(binding.status, "active");
  assert.equal(binding.sourceRevision, 0);
  binding.dispose();
});

check("serialized A replacement bytes update the currently active A rather than admit a new subject", () => {
  const A = "00000820m";
  const runtime = _create_livetree_runtime_test_handle();
  const map = element(`<main <a @${A} title="old"/>/>`);
  const binding = _reflect_document_for_runtime_test(runtime, map);
  const oldNode = raw_node(binding.tree.node, [0, 0]);
  const handle = acquire_document_identity(map.document, target(0, 0));
  const serialized = JSON.stringify(projected_element(`<a @${A} title="serialized"/>`));
  const replacement = JSON.parse(serialized) as HsonNode;
  map.document.content.replace(path(0), 0, replacement);
  assert.equal(handle.active, true);
  assert.equal(raw_node(binding.tree.node, [0, 0]), oldNode);
  assert.equal(oldNode.$_attrs?.title, "serialized");
  assert.equal(_lookup_livetree_runtime_test_node(runtime, A), oldNode);
  binding.dispose();
});

check("terminal canonical retirement rejects later equal A bytes atomically", () => {
  const A = "00000820n";
  const map = element(`<main <a @${A}/> <tail/>/>`);
  const handle = acquire_document_identity(map.document, target(0, 0));
  map.document.content.remove(path(0), 0);
  const before = map.capture();
  assert.throws(
    () => map.document.content.insert(path(0), 0, projected_element(`<b @${A}/>`)),
    /retired QUID cannot identify unrelated content/,
  );
  assert.deepEqual(map.capture(), before);
  assert.equal(map.rev, 1);
  assert.equal(handle.active, false);
  assert.deepEqual(livemap_identity_epoch_accounting(map.document), { epoch: 0, issued: 1 });
});

check("terminal runtime retirement rejects equal A bytes in the same runtime", () => {
  const A = "00000820p";
  const runtime = _create_livetree_runtime_test_handle();
  const map = element(`<main <a @${A}/> <tail/>/>`);
  const binding = _reflect_document_for_runtime_test(runtime, map);
  const oldNode = raw_node(binding.tree.node, [0, 0]);
  map.document.content.remove(path(0), 0);
  assert.equal(_lookup_livetree_runtime_test_node(runtime, A), undefined);
  assert.throws(
    () => _create_livetree_for_runtime_test(runtime, projected_element(`<a @${A}/>`)),
    (cause: unknown) => Reflect.get(cause as object, "code") === "LIVETREE_QUID_REUSE",
  );
  assert.notEqual(_lookup_livetree_runtime_test_node(runtime, A), oldNode);
  binding.dispose();
});

check("fresh runtime may admit equal A bytes without reconstructing the old exact object", () => {
  const A = "00000820q";
  const oldRuntime = _create_livetree_runtime_test_handle();
  const oldTree = _create_livetree_for_runtime_test(oldRuntime, projected_element(`<a @${A}/>`));
  const oldNode = oldTree.node;
  oldTree.remove();
  const freshRuntime = _create_livetree_runtime_test_handle();
  const freshTree = _create_livetree_for_runtime_test(freshRuntime, projected_element(`<a @${A}/>`));
  assert.equal(freshTree.quid, A);
  assert.notEqual(freshTree.node, oldNode);
  assert.equal(_lookup_livetree_runtime_test_node(freshRuntime, A), freshTree.node);
});

check("independently active runtime A blocks Reflection before data mutation", () => {
  const A = "00000820r";
  const runtime = _create_livetree_runtime_test_handle();
  const foreign = _create_livetree_for_runtime_test(runtime, projected_element(`<aside @${A}/>`));
  const map = element(`<main <a/>/>`);
  const binding = _reflect_document_for_runtime_test(runtime, map);
  const oldProjected = raw_node(binding.tree.node, [0, 0]);
  map.document.content.replace(path(0), 0, projected_element(`<b @${A}/>`));
  assert.equal(map.document.byQuid(A)?.$_tag, "b");
  assert.equal(binding.status, "failed");
  assert.equal(binding.sourceRevision, 0);
  assert.equal(raw_node(binding.tree.node, [0, 0]), oldProjected);
  assert.equal(_lookup_livetree_runtime_test_node(runtime, A), foreign.node);
  binding.dispose();
});

check("duplicate incoming A rejects during canonical planning before publication", () => {
  const A = "00000820s";
  const map = element(`<main <a @${A}/> <b/>/>`);
  const binding = _reflect_document_for_runtime_test(_create_livetree_runtime_test_handle(), map);
  const before = map.capture();
  assert.throws(
    () => map.document.content.replace(path(0), 1, projected_element(`<b @${A}/>`)),
    /duplicate quid/i,
  );
  assert.deepEqual(map.capture(), before);
  assert.equal(map.rev, 0);
  assert.equal(binding.status, "active");
  assert.equal(binding.sourceRevision, 0);
  binding.dispose();
});

check("throwing resource cleanup is isolated while A to B runtime transfer completes", () => {
  const A = "00000820t";
  const B = "00000820w";
  const runtime = _create_livetree_runtime_test_handle();
  const map = element(`<main <a @${A}/>/` + `>`);
  const binding = _reflect_document_for_runtime_test(runtime, map);
  const warnings: unknown[][] = [];
  const priorWarn = console.warn;
  console.warn = (...values: unknown[]) => { warnings.push(values); };
  try {
    _own_livetree_runtime_test_disposable(runtime, A, () => { throw new Error("cleanup failure"); }, "other");
    map.document.content.replace(path(0), 0, projected_element(`<b @${B}/>`));
  } finally {
    console.warn = priorWarn;
  }
  const next = raw_node(binding.tree.node, [0, 0]);
  assert.equal(warnings.length, 1);
  assert.equal(binding.status, "active");
  assert.equal(binding.sourceRevision, 1);
  assert.equal(_lookup_livetree_runtime_test_node(runtime, A), undefined);
  assert.equal(_lookup_livetree_runtime_test_node(runtime, B), next);
  assert.equal(_livetree_runtime_test_resource_counts(runtime, A).total, 0);
  binding.dispose();
});

assert.equal(checks, 27);
process.stdout.write(`1..${checks}\n`);
emit_hson_live_test_completion("reflect.document-same-quid-replacement-continuity", checks, checks, 0);
