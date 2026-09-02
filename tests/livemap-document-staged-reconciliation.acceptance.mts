// @hson-live-external-test
import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import type { HsonNode } from "../src/core/types.ts";
import type { DocumentLiveMap, LiveMapGraphCommit, LiveMapGraphOp } from "../src/types/livemap.types.ts";
import {
  livemap_document_identity_accounting,
  livemap_document_identity_overlay_for,
} from "../src/api/livemap/livemap.document.identity.ts";
import { LiveMapDocumentStagingError, LiveMapRevError } from "../src/api/livemap/livemap.error.ts";
import { prepare_document_graph_operation } from "../src/api/livemap/livemap.document.mutation.ts";
import { validate_document_path } from "../src/api/livemap/livemap.document.path.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.document-staged-reconciliation",
  title: "Staged document identity reconciliation",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["document", "quid", "path", "staging", "replay", "reconciliation", "externally-discoverable"]),
});

const testEvents = create_test_event_emitter("livemap.document-staged-reconciliation");
let checks = 0;
function check(name: string, run: () => void): void {

  testEvents.case_begin(name, name);
  try {
    run();
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

const Q1 = "000000601";
const Q2 = "000000602";
const Q3 = "000000603";
const Q4 = "000000604";
const path = (...parts: number[]) => validate_document_path(parts);
const target = (...parts: number[]) => Object.freeze({ kind: "path" as const, path: path(0, ...parts) });

function element(source: string): DocumentLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "document") throw new Error("Expected element map");
  return map;
}

function ordinary(tag: string, quid?: string): HsonNode {
  return {
    $_tag: tag,
    $_content: [],
    ...(quid === undefined ? {} : { $_meta: { quid } }),
  };
}

function graphCommit(map: DocumentLiveMap, ops: readonly LiveMapGraphOp[]): LiveMapGraphCommit {
  return Object.freeze({
    changed: true,
    prevRev: map.rev,
    rev: map.rev + 1,
    ops: Object.freeze([...ops]),
  });
}

function replay(map: DocumentLiveMap, ops: readonly LiveMapGraphOp[]): LiveMapGraphCommit {
  return map.replay(graphCommit(map, ops));
}

function overlayPaths(map: DocumentLiveMap, quids: readonly string[]) {
  const overlay = livemap_document_identity_overlay_for(map);
  return quids.map((quid) => overlay.pathForQuid(quid));
}

check("insert then mutate resolves the inserted QUID at the next ordinal", () => {
  const map = element(`<main @${Q1} <a @${Q2}/>/` + `>`);
  replay(map, [
    { domain: "graph", op: "insert-content", target: target(0), index: 0, content: ordinary("b", Q4) },
    { domain: "graph", op: "set-attr", target: { kind: "path", path: path(0, 0, 0), witness: { quid: Q4 } }, name: "id", value: "inserted" },
  ]);
  assert.equal(map.document.byQuid(Q4)?.$_attrs?.id, "inserted");
});

check("delete then mutate resolves the shifted sibling and witness", () => {
  const map = element(`<main <a @${Q2}/> <b @${Q3}/>/` + `>`);
  replay(map, [
    { domain: "graph", op: "remove-content", target: target(0), index: 0 },
    { domain: "graph", op: "set-attr", target: { kind: "path", path: path(0, 0, 0), witness: { quid: Q3 } }, name: "id", value: "shifted" },
  ]);
  assert.equal(map.document.byQuid(Q3)?.$_attrs?.id, "shifted");
});

check("move then mutate resolves the final destination and witness", () => {
  const map = element(`<main <a @${Q2}/> <b @${Q3}/>/` + `>`);
  replay(map, [
    { domain: "graph", op: "move-content", target: target(0), from: 0, to: 1 },
    { domain: "graph", op: "set-attr", target: { kind: "path", path: path(0, 0, 1), witness: { quid: Q2 } }, name: "id", value: "moved" },
  ]);
  assert.equal(map.document.byQuid(Q2)?.$_attrs?.id, "moved");
});

check("later witness reads the staged overlay produced by the prior operation", () => {
  const map = element(`<main <a @${Q2}/> <b @${Q3}/>/` + `>`);
  replay(map, [
    { domain: "graph", op: "move-content", target: target(0), from: 0, to: 1 },
    { domain: "graph", op: "set-attr", target: { kind: "path", path: path(0, 0, 1), witness: { quid: Q2 } }, name: "id", value: "observed" },
  ]);
  assert.deepEqual(overlayPaths(map, [Q2, Q3]), [[0, 0, 1], [0, 0, 0]]);
});

check("later stale witness rejects against the staged overlay", () => {
  const map = element(`<main <a @${Q2}/> <b @${Q3}/>/` + `>`);
  const before = map.capture();
  assert.throws(() => replay(map, [
    { domain: "graph", op: "move-content", target: target(0), from: 0, to: 1 },
    { domain: "graph", op: "set-attr", target: { kind: "path", path: path(0, 0, 0), witness: { quid: Q2 } }, name: "id", value: "bad" },
  ]), (error: unknown) => error instanceof LiveMapDocumentStagingError && error.opIndex === 1);
  assert.deepEqual(map.capture(), before);
});

check("replace then invalid descendant access rejects at its exact ordinal", () => {
  const map = element(`<main <section @${Q2} <b @${Q3}/>/` + `>/` + `>`);
  assert.throws(() => replay(map, [
    { domain: "graph", op: "replace-content", target: target(0), index: 0, replacement: ordinary("i", Q4) },
    { domain: "graph", op: "set-attr", target: target(0, 0, 0, 0), name: "id", value: "bad" },
  ]), (error: unknown) => error instanceof LiveMapDocumentStagingError && error.opIndex === 1);
  assert.equal(map.rev, 0);
});

check("the same canonical commit yields equal mutation and replay roots", () => {
  const left = element(`<main <a @${Q2}/> <b @${Q3}/>/` + `>`);
  const right = element(`<main <a @${Q2}/> <b @${Q3}/>/` + `>`);
  const commit = left.replay(graphCommit(left, [
    { domain: "graph", op: "move-content", target: target(0), from: 1, to: 0 },
    { domain: "graph", op: "set-attr", target: target(0, 0), name: "id", value: "same" },
  ]));
  right.replay(commit);
  assert.deepEqual(right.root(), left.root());
});

check("the same canonical commit yields equal sparse overlays", () => {
  const left = element(`<main <a @${Q2}/> <b @${Q3}/>/` + `>`);
  const right = element(`<main <a @${Q2}/> <b @${Q3}/>/` + `>`);
  const commit = left.replay(graphCommit(left, [
    { domain: "graph", op: "insert-content", target: target(0), index: 1, content: ordinary("i", Q4) },
    { domain: "graph", op: "remove-content", target: target(0), index: 0 },
  ]));
  right.replay(commit);
  assert.deepEqual(overlayPaths(right, [Q2, Q3, Q4]), overlayPaths(left, [Q2, Q3, Q4]));
});

check("operation reducer derives deterministic effects", () => {
  const map = element(`<main <a @${Q2}/> <b @${Q3}/>/` + `>`);
  const operation: LiveMapGraphOp = { domain: "graph", op: "move-content", target: target(0), from: 0, to: 1 };
  const first = prepare_document_graph_operation(map.root(), map.mode, operation, livemap_document_identity_overlay_for(map));
  const second = prepare_document_graph_operation(map.root(), map.mode, operation, livemap_document_identity_overlay_for(map));
  assert.deepEqual(second.identityEffects, first.identityEffects);
});

check("replaying an already accepted commit again is an atomic revision conflict", () => {
  const source = element(`<main @${Q1}/>`);
  const commit = source.document.attrs.set(target(), "id", "one");
  const map = element(`<main @${Q1}/>`);
  map.replay(commit);
  const before = map.capture();
  assert.throws(() => map.replay(commit), (error: unknown) => error instanceof LiveMapRevError);
  assert.deepEqual(map.capture(), before);
});

check("multi-operation replay performs no full overlay reconstruction", () => {
  const map = element(`<main <a @${Q2}/> <b @${Q3}/>/` + `>`);
  const before = livemap_document_identity_accounting();
  replay(map, [
    { domain: "graph", op: "insert-content", target: target(0), index: 1, content: ordinary("i", Q4) },
    { domain: "graph", op: "move-content", target: target(0), from: 2, to: 0 },
  ]);
  const after = livemap_document_identity_accounting();
  assert.equal(after.fullBuilds, before.fullBuilds);
});

check("multi-operation replay reconciles once per staged operation", () => {
  const map = element(`<main <a @${Q2}/> <b @${Q3}/>/` + `>`);
  const before = livemap_document_identity_accounting();
  replay(map, [
    { domain: "graph", op: "move-content", target: target(0), from: 0, to: 1 },
    { domain: "graph", op: "set-attr", target: target(0, 1), name: "id", value: "x" },
  ]);
  const after = livemap_document_identity_accounting();
  assert.equal(after.reconciliations, before.reconciliations + 2);
});

check("insert admission visits only the incoming subtree nodes", () => {
  const map = element(`<main <a @${Q2}/> <b @${Q3}/>/` + `>`);
  const before = livemap_document_identity_accounting();
  map.document.content.insert(target(0), 1, ordinary("i", Q4));
  const after = livemap_document_identity_accounting();
  assert.equal(after.incomingNodesVisited, before.incomingNodesVisited + 1);
});

check("insert reconciliation visits sparse overlay entries rather than graph nodes", () => {
  const map = element(`<main <a @${Q2}/> <b/> <c @${Q3}/>/` + `>`);
  const before = livemap_document_identity_accounting();
  map.document.content.insert(target(0), 1, ordinary("i", Q4));
  const after = livemap_document_identity_accounting();
  assert.equal(after.overlayEntriesVisited, before.overlayEntriesVisited + 2);
});

check("insert accounting records only shifted and introduced sparse claims as changed", () => {
  const map = element(`<main <a @${Q2}/> <b @${Q3}/>/` + `>`);
  const before = livemap_document_identity_accounting();
  map.document.content.insert(target(0), 1, ordinary("i", Q4));
  const after = livemap_document_identity_accounting();
  assert.equal(after.overlayEntriesChanged, before.overlayEntriesChanged + 2);
});

check("repeated QUID lookup changes no reconciliation accounting", () => {
  const map = element(`<main @${Q1}/>`);
  const before = livemap_document_identity_accounting();
  for (let index = 0; index < 20; index += 1) map.document.byQuid(Q1);
  assert.deepEqual(livemap_document_identity_accounting(), before);
});

check("QUID-free attr mutation retains one empty overlay without a full build", () => {
  const map = element(`<main/>`);
  const overlay = livemap_document_identity_overlay_for(map);
  const before = livemap_document_identity_accounting();
  map.document.attrs.set(target(), "id", "x");
  const after = livemap_document_identity_accounting();
  assert.equal(after.fullBuilds, before.fullBuilds);
  assert.equal(livemap_document_identity_overlay_for(map), overlay);
});

check("QUID-free insertion retains the empty overlay without identity entries", () => {
  const map = element(`<main <a/>/>`);
  const overlay = livemap_document_identity_overlay_for(map);
  map.document.content.insert(target(0), 1, ordinary("b"));
  assert.equal(livemap_document_identity_overlay_for(map), overlay);
  assert.equal(overlay.size, 0);
});

check("replace-root replay legitimately performs one complete admission scan", () => {
  const source = element(`<article @${Q2}/>`);
  const producer = element(`<main @${Q1}/>`);
  const commit = producer.install(source.capture());
  const map = element(`<main @${Q1}/>`);
  const before = livemap_document_identity_accounting();
  map.replay(commit);
  assert.equal(livemap_document_identity_accounting().fullBuilds, before.fullBuilds + 1);
});

check("external install legitimately performs one complete admission scan", () => {
  const source = element(`<article @${Q2}/>`);
  const map = element(`<main @${Q1}/>`);
  const before = livemap_document_identity_accounting();
  map.install(source.capture());
  assert.equal(livemap_document_identity_accounting().fullBuilds, before.fullBuilds + 1);
});

check("external restore legitimately performs one complete admission scan", () => {
  const source = element(`<article @${Q2}/>`);
  source.document.attrs.set(target(), "id", "revision-one");
  const map = element(`<main @${Q1}/>`);
  const before = livemap_document_identity_accounting();
  map.restore(source.capture());
  assert.equal(livemap_document_identity_accounting().fullBuilds, before.fullBuilds + 1);
  assert.equal(map.rev, 1);
});

check("capture serializes no overlay and changes no identity accounting", () => {
  const map = element(`<main @${Q1}/>`);
  const before = livemap_document_identity_accounting();
  const capture = map.capture();
  assert.deepEqual(livemap_document_identity_accounting(), before);
  assert.deepEqual(Object.keys(capture).sort(), ["kind", "mode", "rev", "root"]);
});

check("legacy QUID replay lowers through the same incremental reducer", () => {
  const map = element(`<main @${Q1}/>`);
  const before = livemap_document_identity_accounting();
  const commit = Reflect.apply(map.replay, map, [{
    changed: true,
    prevRev: 0,
    rev: 1,
    ops: [{ domain: "graph", op: "set-attr", target: { kind: "quid", quid: Q1 }, name: "id", value: "legacy" }],
  }]);
  const after = livemap_document_identity_accounting();
  assert.equal(after.fullBuilds, before.fullBuilds);
  assert.equal(commit.ops[0]?.op === "set-attr" && commit.ops[0].target.kind, "path");
  assert.equal(map.document.byQuid(Q1)?.$_attrs?.id, "legacy");
});

process.stdout.write(`1..${checks}\n`);
testEvents.terminal("pass");
emit_hson_live_test_completion("livemap.document-staged-reconciliation", checks, checks, 0);
