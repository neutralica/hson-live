// @hson-live-external-test
import assert from "node:assert/strict";
import {
  element,
  path,
  projected_element,
  raw_node,
  witnessed_path,
} from "./helpers/reflect-unit6.mts";
import {
  _create_livetree_runtime_test_handle,
  _reflect_document_for_runtime_test,
} from "../src/diagnostics/index.ts";
import { LiveMapDocumentStagingError } from "../src/api/livemap/livemap.error.ts";
import type {
  LiveMapCommitObservation,
  LiveMapAnyOp,
  LiveMapGraphCommit,
  LiveMapGraphOp,
} from "../src/types/livemap.types.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

let checks = 0;
const hsonReflect = (map: ReturnType<typeof element>) =>
  _reflect_document_for_runtime_test(_create_livetree_runtime_test_handle(), map);

function check(name: string, run: () => void): void {
  run();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function replay(map: ReturnType<typeof element>, ops: readonly LiveMapGraphOp[]): void {
  map.replay(Object.freeze({
    changed: true,
    prevRev: map.rev,
    rev: map.rev + 1,
    ops: Object.freeze([...ops]),
  }));
}

function is_graph_operation(operation: LiveMapAnyOp): operation is LiveMapGraphOp {
  return "domain" in operation && operation.domain === "graph";
}

function observed_commit(events: readonly LiveMapCommitObservation[]): LiveMapGraphCommit {
  const event = events.at(-1);
  if (event?.kind !== "commit") throw new Error("Expected commit observation");
  if (!event.commit.ops.every(is_graph_operation)) throw new Error("Expected graph commit observation");
  return Object.freeze({
    changed: event.commit.changed,
    prevRev: event.commit.prevRev,
    rev: event.commit.rev,
    ops: Object.freeze([...event.commit.ops]),
  });
}

const Q1 = "000000701";
const Q2 = "000000702";
const Q3 = "000000703";

check("attribute operations route to the projected path", () => {
  const map = element(`<main <a/> <b/>/>`);
  const binding = hsonReflect(map);
  map.document.attrs.set(path(0, 1), "route", "path");
  assert.equal(raw_node(binding.tree.node, [0, 1]).$_attrs?.route, "path");
  binding.dispose();
});

check("content insertion routes to the projected parent path", () => {
  const map = element(`<main <a/>/>`);
  const binding = hsonReflect(map);
  map.document.content.insert(path(0), 0, projected_element(`<b/>`));
  assert.equal(raw_node(binding.tree.node, [0, 0]).$_tag, "b");
  binding.dispose();
});

check("content replacement routes to the projected slot path", () => {
  const map = element(`<main <a/>/>`);
  const binding = hsonReflect(map);
  map.document.content.replace(path(0), 0, projected_element(`<b/>`));
  assert.equal(raw_node(binding.tree.node, [0, 0]).$_tag, "b");
  binding.dispose();
});

check("content removal routes to the projected slot path", () => {
  const map = element(`<main <a/> <b/>/>`);
  const binding = hsonReflect(map);
  map.document.content.remove(path(0), 0);
  assert.equal(raw_node(binding.tree.node, [0, 0]).$_tag, "b");
  binding.dispose();
});

check("forward movement routes by canonical parent path", () => {
  const map = element(`<main <a/> <b/>/>`);
  const binding = hsonReflect(map);
  const a = raw_node(binding.tree.node, [0, 0]);
  map.document.content.move(path(0), 0, 1);
  assert.equal(raw_node(binding.tree.node, [0, 1]), a);
  binding.dispose();
});

check("backward movement routes by canonical parent path", () => {
  const map = element(`<main <a/> <b/>/>`);
  const binding = hsonReflect(map);
  const b = raw_node(binding.tree.node, [0, 1]);
  map.document.content.move(path(0), 1, 0);
  assert.equal(raw_node(binding.tree.node, [0, 0]), b);
  binding.dispose();
});

check("carrier paths address fragment-style content below the element root", () => {
  const map = element(`<main "tail"/>`);
  const binding = hsonReflect(map);
  map.document.content.insert(path(0), 0, projected_element(`<span/>`));
  assert.equal(raw_node(binding.tree.node, [0, 0]).$_tag, "span");
  binding.dispose();
});

check("QUID-free attribute reflection remains path-routed", () => {
  const map = element(`<main <a/>/>`);
  const binding = hsonReflect(map);
  map.document.attrs.set(path(0, 0), "free", true);
  assert.equal(raw_node(binding.tree.node, [0, 0]).$_attrs?.free, true);
  binding.dispose();
});

check("QUID-free structural reflection remains path-routed", () => {
  const map = element(`<main <a/>/>`);
  const binding = hsonReflect(map);
  map.document.content.insert(path(0), 1, projected_element(`<b/>`));
  assert.equal(raw_node(binding.tree.node, [0, 1]).$_tag, "b");
  binding.dispose();
});

check("a matching witness validates after path resolution", () => {
  const map = element(`<main <a @${Q1}/>/` + `>`);
  const binding = hsonReflect(map);
  replay(map, [{ domain: "graph", op: "set-attr", target: witnessed_path(Q1, 0, 0), name: "ok", value: 1 }]);
  assert.equal(raw_node(binding.tree.node, [0, 0]).$_attrs?.ok, 1);
  binding.dispose();
});

check("an absent witness leaves path routing unchanged", () => {
  const map = element(`<main <a @${Q1}/>/` + `>`);
  const binding = hsonReflect(map);
  replay(map, [{ domain: "graph", op: "set-attr", target: path(0, 0), name: "ok", value: 2 }]);
  assert.equal(raw_node(binding.tree.node, [0, 0]).$_attrs?.ok, 2);
  binding.dispose();
});

check("a conflicting witness is rejected before reflection publication", () => {
  const map = element(`<main <a @${Q1}/> <b @${Q2}/>/` + `>`);
  const binding = hsonReflect(map);
  assert.throws(() => replay(map, [
    { domain: "graph", op: "set-attr", target: witnessed_path(Q2, 0, 0), name: "bad", value: 1 },
  ]), LiveMapDocumentStagingError);
  assert.equal(binding.sourceRevision, 0);
  assert.equal(binding.status, "active");
  binding.dispose();
});

check("a matching QUID elsewhere cannot reroute an invalid path", () => {
  const map = element(`<main <a @${Q1}/> <b @${Q2}/>/` + `>`);
  const binding = hsonReflect(map);
  assert.throws(() => replay(map, [
    { domain: "graph", op: "set-attr", target: witnessed_path(Q1, 0, 1), name: "bad", value: 1 },
  ]), LiveMapDocumentStagingError);
  assert.equal(raw_node(binding.tree.node, [0, 0]).$_attrs?.bad, undefined);
  binding.dispose();
});

check("current path requests emit no QUID-only canonical target", () => {
  const map = element(`<main @${Q1}/>`);
  const events: LiveMapCommitObservation[] = [];
  map.commits.observe((event) => events.push(event));
  map.document.attrs.set(path(), "a", 1);
  const operation = observed_commit(events).ops[0];
  assert.ok(operation !== undefined && operation.op !== "replace-root");
  assert.equal(operation.target.kind, "path");
});

check("compatibility QUID requests lower before reflection", () => {
  const map = element(`<main @${Q1}/>`);
  const binding = hsonReflect(map);
  const events: LiveMapCommitObservation[] = [];
  map.commits.observe((event) => events.push(event));
  map.document.attrs.set({ kind: "quid", quid: Q1 }, "a", 1);
  const operation = observed_commit(events).ops[0];
  assert.ok(operation !== undefined && operation.op !== "replace-root");
  assert.equal(operation.target.kind, "path");
  assert.deepEqual(operation.target.witness, { quid: Q1 });
  binding.dispose();
});

check("multi-operation replay exposes only canonical path targets", () => {
  const map = element(`<main <a @${Q1}/> <b @${Q2}/>/` + `>`);
  const events: LiveMapCommitObservation[] = [];
  map.commits.observe((event) => events.push(event));
  replay(map, [
    { domain: "graph", op: "move-content", target: path(0), from: 0, to: 1 },
    { domain: "graph", op: "set-attr", target: witnessed_path(Q1, 0, 1), name: "moved", value: true },
  ]);
  assert.ok(observed_commit(events).ops.every((operation) => operation.op === "replace-root" || operation.target.kind === "path"));
});

check("attribute operations do not rebuild correspondence", () => {
  const map = element(`<main @${Q1} <a @${Q2}/>/` + `>`);
  const binding = hsonReflect(map);
  const before = binding.diagnostics();
  map.document.attrs.set(path(0, 0), "x", 1);
  const after = binding.diagnostics();
  assert.equal(after.wholeCorrespondenceBuilds, before.wholeCorrespondenceBuilds);
  assert.equal(after.incrementalCorrespondenceUpdates, before.incrementalCorrespondenceUpdates);
  binding.dispose();
});

check("local structural operations use incremental correspondence", () => {
  const map = element(`<main @${Q1} <a @${Q2}/>/` + `>`);
  const binding = hsonReflect(map);
  const before = binding.diagnostics();
  map.document.content.insert(path(0), 0, projected_element(`<b @${Q3}/>`));
  const after = binding.diagnostics();
  assert.equal(after.wholeCorrespondenceBuilds, before.wholeCorrespondenceBuilds);
  assert.equal(after.incrementalCorrespondenceUpdates, before.incrementalCorrespondenceUpdates + 1);
  binding.dispose();
});

check("repeated path-routed attrs do not rescan correspondence", () => {
  const map = element(`<main <a/>/>`);
  const binding = hsonReflect(map);
  const before = binding.diagnostics();
  for (let index = 0; index < 5; index += 1) map.document.attrs.set(path(0, 0), "n", index);
  const after = binding.diagnostics();
  assert.equal(after.wholeCorrespondenceBuilds, before.wholeCorrespondenceBuilds);
  assert.equal(after.identityEffectsConsumed, before.identityEffectsConsumed);
  binding.dispose();
});

check("path-routed QUID evidence is consumed only as correspondence evidence", () => {
  const map = element(`<main @${Q1} <a @${Q2}/>/` + `>`);
  const binding = hsonReflect(map);
  map.document.attrs.set({ kind: "quid", quid: Q2 }, "evidence", true);
  assert.equal(binding.diagnostics().identityEffectsConsumed, 1);
  assert.equal(raw_node(binding.tree.node, [0, 0]).$_attrs?.evidence, true);
  binding.dispose();
});

check("replacement targets remain path-authoritative when QUIDs differ", () => {
  const map = element(`<main <a @${Q1}/>/` + `>`);
  const binding = hsonReflect(map);
  replay(map, [{
    domain: "graph",
    op: "replace-content",
    target: path(0),
    index: 0,
    replacement: projected_element(`<b @${Q2}/>`),
  }]);
  assert.equal(raw_node(binding.tree.node, [0, 0]).$_tag, "b");
  binding.dispose();
});

process.stdout.write(`# ${checks} Unit 6 path-first reflection checks passed\n`);
emit_hson_live_test_completion("reflect.document-path-authority", checks, checks, 0);
