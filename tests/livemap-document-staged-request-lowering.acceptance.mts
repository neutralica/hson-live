// @hson-live-external-test
import assert from "node:assert/strict";
import { hson } from "../src/index.ts";
import type { HsonNode } from "../src/core/types.ts";
import {
  livemap_document_identity_accounting,
  livemap_document_identity_overlay_build_count,
  livemap_document_identity_overlay_for,
} from "../src/api/livemap/livemap.document.identity.ts";
import {
  LiveMapDocumentStagingError,
  LiveMapRevError,
} from "../src/api/livemap/livemap.error.ts";
import type {
  DocumentLiveMap,
  LiveMapGraphCommit,
} from "../src/types/livemap.types.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

const Q1 = "000000711";
const Q2 = "000000712";
const Q3 = "000000713";
const Q4 = "000000714";

let checks = 0;
function check(name: string, run: () => void): void {
  run();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function element(source: string): DocumentLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "document") throw new Error("Expected element LiveMap");
  return map;
}

function replay(map: DocumentLiveMap, ops: readonly unknown[]): LiveMapGraphCommit {
  return Reflect.apply(map.replay, map, [{
    changed: true,
    prevRev: map.rev,
    rev: map.rev + 1,
    ops,
  }]);
}

function quidTarget(quid: string): Readonly<{ kind: "quid"; quid: string }> {
  return Object.freeze({ kind: "quid", quid });
}

function pathTarget(...path: number[]): Readonly<{ kind: "path"; path: readonly number[] }> {
  return Object.freeze({ kind: "path", path: Object.freeze([0, ...path]) });
}

function child(tag: string, quid: string): HsonNode {
  const value = element(`<${tag} @${quid}/>`).root().$_content[0];
  if (value === undefined || value === null || typeof value !== "object") throw new Error("Expected authored document child");
  return value;
}

function stagedSource(): DocumentLiveMap {
  return element(`<main @${Q1} <a @${Q2}/> <b @${Q3}/>/>`);
}

function operationTarget(commit: LiveMapGraphCommit, index: number): unknown {
  const operation = commit.ops[index];
  return typeof operation === "object" && operation !== null && "target" in operation
    ? Reflect.get(operation, "target")
    : undefined;
}

function targetField(commit: LiveMapGraphCommit, index: number, field: string): unknown {
  const target = operationTarget(commit, index);
  return typeof target === "object" && target !== null ? Reflect.get(target, field) : undefined;
}

check("move then QUID target resolves the moved staged path", () => {
  const commit = replay(stagedSource(), [
    { domain: "graph", op: "move-content", target: pathTarget(0), from: 0, to: 1 },
    { domain: "graph", op: "set-attr", target: quidTarget(Q2), name: "id", value: "moved" },
  ]);
  assert.deepEqual(targetField(commit, 1, "path"), [0, 0, 1]);
});

check("move then QUID target retains evidence for the same identity", () => {
  const commit = replay(stagedSource(), [
    { domain: "graph", op: "move-content", target: pathTarget(0), from: 0, to: 1 },
    { domain: "graph", op: "set-attr", target: quidTarget(Q2), name: "id", value: "moved" },
  ]);
  assert.deepEqual(targetField(commit, 1, "witness"), { quid: Q2 });
});

check("inserted supplied QUID is targetable at the next ordinal", () => {
  const map = stagedSource();
  const commit = replay(map, [
    { domain: "graph", op: "insert-content", target: pathTarget(0), index: 0, content: child("i", Q4) },
    { domain: "graph", op: "set-attr", target: quidTarget(Q4), name: "id", value: "inserted" },
  ]);
  assert.deepEqual(targetField(commit, 1, "path"), [0, 0, 0]);
  assert.equal(map.document.byQuid(Q4)?.$_attrs?.id, "inserted");
});

check("inserted target canonicalization is deterministic", () => {
  const run = (): unknown => operationTarget(replay(stagedSource(), [
    { domain: "graph", op: "insert-content", target: pathTarget(0), index: 1, content: child("i", Q4) },
    { domain: "graph", op: "set-attr", target: quidTarget(Q4), name: "id", value: "inserted" },
  ]), 1);
  assert.deepEqual(run(), run());
});

check("remove then retired QUID target rejects at its exact ordinal", () => {
  const map = stagedSource();
  assert.throws(() => replay(map, [
    { domain: "graph", op: "remove-content", target: pathTarget(0), index: 0 },
    { domain: "graph", op: "set-attr", target: quidTarget(Q2), name: "id", value: "bad" },
  ]), (error: unknown) => error instanceof LiveMapDocumentStagingError
    && error.opIndex === 1
    && error.reasonCode === "DOCUMENT_TARGET_NOT_FOUND");
});

check("retired-target failure rolls the graph back", () => {
  const map = stagedSource();
  const before = map.capture();
  assert.throws(() => replay(map, [
    { domain: "graph", op: "remove-content", target: pathTarget(0), index: 0 },
    { domain: "graph", op: "set-attr", target: quidTarget(Q2), name: "id", value: "bad" },
  ]));
  assert.deepEqual(map.capture(), before);
});

check("retired-target failure retains the exact installed overlay", () => {
  const map = stagedSource();
  const before = livemap_document_identity_overlay_for(map);
  assert.throws(() => replay(map, [
    { domain: "graph", op: "remove-content", target: pathTarget(0), index: 0 },
    { domain: "graph", op: "set-attr", target: quidTarget(Q2), name: "id", value: "bad" },
  ]));
  assert.equal(livemap_document_identity_overlay_for(map), before);
});

check("replace then old QUID target rejects without guessing", () => {
  const map = stagedSource();
  assert.throws(() => replay(map, [
    { domain: "graph", op: "replace-content", target: pathTarget(0), index: 0, replacement: child("i", Q4) },
    { domain: "graph", op: "set-attr", target: quidTarget(Q2), name: "id", value: "bad" },
  ]), (error: unknown) => error instanceof LiveMapDocumentStagingError
    && error.opIndex === 1
    && error.reasonCode === "DOCUMENT_TARGET_NOT_FOUND");
});

check("replace then new QUID target resolves replacement identity", () => {
  const map = stagedSource();
  const commit = replay(map, [
    { domain: "graph", op: "replace-content", target: pathTarget(0), index: 0, replacement: child("i", Q4) },
    { domain: "graph", op: "set-attr", target: quidTarget(Q4), name: "id", value: "new" },
  ]);
  assert.deepEqual(targetField(commit, 1, "path"), [0, 0, 0]);
  assert.equal(map.document.byQuid(Q4)?.$_attrs?.id, "new");
});

check("old witness at a replacement path reports conflict", () => {
  const map = stagedSource();
  assert.throws(() => replay(map, [
    { domain: "graph", op: "replace-content", target: pathTarget(0), index: 0, replacement: child("i", Q4) },
    {
      domain: "graph",
      op: "set-attr",
      target: { kind: "path", path: [0, 0, 0], witness: { quid: Q2 } },
      name: "id",
      value: "bad",
    },
  ]), (error: unknown) => error instanceof LiveMapDocumentStagingError
    && error.reasonCode === "DOCUMENT_WITNESS_MISMATCH");
});

check("insertion shift is visible to later QUID lowering", () => {
  const commit = replay(stagedSource(), [
    { domain: "graph", op: "insert-content", target: pathTarget(0), index: 0, content: child("i", Q4) },
    { domain: "graph", op: "set-attr", target: quidTarget(Q3), name: "id", value: "shifted" },
  ]);
  assert.deepEqual(targetField(commit, 1, "path"), [0, 0, 2]);
});

check("deletion shift is visible to later QUID lowering", () => {
  const commit = replay(stagedSource(), [
    { domain: "graph", op: "remove-content", target: pathTarget(0), index: 0 },
    { domain: "graph", op: "set-attr", target: quidTarget(Q3), name: "id", value: "shifted" },
  ]);
  assert.deepEqual(targetField(commit, 1, "path"), [0, 0, 0]);
});

check("backward move rewrites later QUID request coordinates", () => {
  const commit = replay(stagedSource(), [
    { domain: "graph", op: "move-content", target: pathTarget(0), from: 1, to: 0 },
    { domain: "graph", op: "set-attr", target: quidTarget(Q3), name: "id", value: "first" },
  ]);
  assert.deepEqual(targetField(commit, 1, "path"), [0, 0, 0]);
});

check("same-position move leaves the next QUID request on the same path", () => {
  const map = stagedSource();
  const beforeOverlay = livemap_document_identity_overlay_for(map);
  const noOp = map.document.content.move({ kind: "path", path: [0, 0] }, 0, 0);
  const commit = map.document.attrs.set(quidTarget(Q2), "id", "same");
  assert.equal(noOp.changed, false);
  assert.equal(livemap_document_identity_overlay_for(map), beforeOverlay);
  assert.deepEqual(targetField(commit, 0, "path"), [0, 0, 0]);
});

check("successful legacy staging returns only canonical path targets", () => {
  const commit = replay(stagedSource(), [
    { domain: "graph", op: "set-attr", target: quidTarget(Q2), name: "id", value: "a" },
    { domain: "graph", op: "set-attr", target: quidTarget(Q3), name: "id", value: "b" },
  ]);
  assert.ok(commit.ops.every((operation) => {
    const target = typeof operation === "object" && operation !== null && "target" in operation
      ? Reflect.get(operation, "target")
      : undefined;
    return typeof target === "object" && target !== null && Reflect.get(target, "kind") === "path";
  }));
});

check("legacy staging performs no full overlay reconstruction", () => {
  const map = stagedSource();
  const before = livemap_document_identity_overlay_build_count();
  replay(map, [
    { domain: "graph", op: "set-attr", target: quidTarget(Q2), name: "id", value: "a" },
    { domain: "graph", op: "set-attr", target: quidTarget(Q3), name: "id", value: "b" },
  ]);
  assert.equal(livemap_document_identity_overlay_build_count(), before);
});

check("each staged legacy operation reconciles against its current overlay", () => {
  const map = stagedSource();
  const before = livemap_document_identity_accounting();
  replay(map, [
    { domain: "graph", op: "move-content", target: pathTarget(0), from: 0, to: 1 },
    { domain: "graph", op: "set-attr", target: quidTarget(Q2), name: "id", value: "moved" },
  ]);
  const after = livemap_document_identity_accounting();
  assert.equal(after.reconciliations, before.reconciliations + 2);
});

check("mutation and canonical replay produce equal roots", () => {
  const source = stagedSource();
  const target = stagedSource();
  const commit = source.document.attrs.set(quidTarget(Q2), "id", "same");
  target.replay(commit);
  assert.deepEqual(target.root(), source.root());
});

check("mutation and canonical replay produce equal overlays", () => {
  const source = stagedSource();
  const target = stagedSource();
  const commit = source.document.attrs.set(quidTarget(Q2), "id", "same");
  target.replay(commit);
  assert.deepEqual(
    livemap_document_identity_overlay_for(target).pathForQuid(Q2),
    livemap_document_identity_overlay_for(source).pathForQuid(Q2),
  );
});

check("malformed legacy request rejects at its ordinal", () => {
  const map = stagedSource();
  assert.throws(() => replay(map, [{
    domain: "graph", op: "set-attr", target: quidTarget("bad"), name: "id", value: "bad",
  }]), (error: unknown) => error instanceof LiveMapDocumentStagingError
    && error.opIndex === 0
    && error.reasonCode === "INVALID_DOCUMENT_TARGET");
});

check("missing legacy request publishes no revision", () => {
  const map = stagedSource();
  assert.throws(() => replay(map, [{
    domain: "graph", op: "set-attr", target: quidTarget(Q4), name: "id", value: "bad",
  }]));
  assert.equal(map.rev, 0);
});

check("failed staged lowering produces no commit observation", () => {
  const map = stagedSource();
  let observed = 0;
  map.commits.observe(() => { observed += 1; });
  assert.throws(() => replay(map, [
    { domain: "graph", op: "remove-content", target: pathTarget(0), index: 0 },
    { domain: "graph", op: "set-attr", target: quidTarget(Q2), name: "id", value: "bad" },
  ]));
  assert.equal(observed, 0);
});

check("repeating an accepted replay is an atomic stale-revision conflict", () => {
  const source = stagedSource();
  const target = stagedSource();
  const commit = source.document.attrs.set(quidTarget(Q2), "id", "once");
  target.replay(commit);
  const before = target.capture();
  assert.throws(() => target.replay(commit), (error: unknown) => error instanceof LiveMapRevError);
  assert.deepEqual(target.capture(), before);
});

check("staged overlay remains owned by the accepting map", () => {
  const first = stagedSource();
  const second = stagedSource();
  replay(first, [
    { domain: "graph", op: "insert-content", target: pathTarget(0), index: 0, content: child("i", Q4) },
    { domain: "graph", op: "set-attr", target: quidTarget(Q4), name: "id", value: "first" },
  ]);
  assert.equal(first.document.byQuid(Q4)?.$_attrs?.id, "first");
  assert.equal(second.document.byQuid(Q4), undefined);
});

process.stdout.write(`# ${checks} staged request-lowering checks passed\n`);
emit_hson_live_test_completion("livemap.document-staged-request-lowering", checks, checks, 0);
