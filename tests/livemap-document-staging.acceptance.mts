// @hson-live-external-test
import assert from "node:assert/strict";
import { hson, validate_document_path } from "../src/index.ts";
import { is_Node } from "../src/core/node-guards.ts";
import { LiveMapDocumentStagingError, LiveMapReplayInputError } from "../src/api/livemap/livemap.error.ts";
import type {
  DocumentLiveMap,
  LiveMapGraphCommit,
  LiveMapGraphOp,
} from "../src/types/livemap.types.ts";
import type { HsonNode } from "../src/core/types.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.document-staging",
  title: "Staged canonical document operations",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["document", "path", "staging", "replay", "externally-discoverable"]),
});

const testEvents = create_test_event_emitter("livemap.document-staging");
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

function element(source: string): DocumentLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "document") throw new Error("Expected element map");
  return map;
}

function multiNodeDocument(source: string): DocumentLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "document") throw new Error("Expected multiNodeDocument map");
  return map;
}

const target = (...parts: number[]) => Object.freeze({
  kind: "path" as const,
  path: validate_document_path(parts),
});

function replay(map: DocumentLiveMap, ops: readonly LiveMapGraphOp[]): LiveMapGraphCommit {
  return map.replay(Object.freeze({
    changed: true,
    prevRev: map.rev,
    rev: map.rev + 1,
    ops: Object.freeze([...ops]),
  }));
}

function tags(map: DocumentLiveMap): readonly string[] {
  return map.document.content().map((item) => is_Node(item) ? item.$_tag : String(item));
}

const ordinary = (source: string): HsonNode => {
  const value = element(source).at([]).snap();
  if (!is_Node(value)) throw new Error("Expected ordinary document element");
  return value;
};

check("operation zero is interpreted against commit.prevRev", () => {
  const map = multiNodeDocument(`<a/> <guard/>`);
  replay(map, [{ domain: "graph", op: "set-attr", target: target(0), name: "id", value: "first" }]);
  assert.equal(map.document.attrs.get({ kind: "path", path: [0] }, "id"), "first");
  assert.equal(map.rev, 1);
});

check("insert followed by mutation resolves the inserted node at ordinal one", () => {
  const map = multiNodeDocument(`<a/> <c/>`);
  replay(map, [
    { domain: "graph", op: "insert-content", target: target(), index: 1, content: ordinary(`<b/>`) },
    { domain: "graph", op: "set-attr", target: target(1), name: "id", value: "inserted" },
  ]);
  assert.deepEqual(tags(map), ["a", "b", "c"]);
  assert.equal(map.document.attrs.get({ kind: "path", path: [1] }, "id"), "inserted");
});

check("insertion shifts old siblings before later ordinal paths resolve", () => {
  const map = multiNodeDocument(`<a/> <b/>`);
  replay(map, [
    { domain: "graph", op: "insert-content", target: target(), index: 0, content: ordinary(`<x/>`) },
    { domain: "graph", op: "set-attr", target: target(1), name: "id", value: "old-a" },
  ]);
  assert.deepEqual(tags(map), ["x", "a", "b"]);
  assert.equal(map.document.attrs.get({ kind: "path", path: [1] }, "id"), "old-a");
});

check("delete followed by mutation resolves the shifted sibling", () => {
  const map = multiNodeDocument(`<a/> <b/> <c/>`);
  replay(map, [
    { domain: "graph", op: "remove-content", target: target(), index: 0 },
    { domain: "graph", op: "set-attr", target: target(0), name: "id", value: "shifted-b" },
  ]);
  assert.deepEqual(tags(map), ["b", "c"]);
  assert.equal(map.document.attrs.get({ kind: "path", path: [0] }, "id"), "shifted-b");
});

check("move followed by mutation resolves the final destination", () => {
  const map = multiNodeDocument(`<a/> <b/> <c/>`);
  replay(map, [
    { domain: "graph", op: "move-content", target: target(), from: 0, to: 2 },
    { domain: "graph", op: "set-attr", target: target(2), name: "id", value: "moved-a" },
  ]);
  assert.deepEqual(tags(map), ["b", "c", "a"]);
  assert.equal(map.document.attrs.get({ kind: "path", path: [2] }, "id"), "moved-a");
});

check("replacement followed by access to the replacement is staged", () => {
  const map = multiNodeDocument(`<a/> <c/>`);
  replay(map, [
    { domain: "graph", op: "replace-content", target: target(), index: 0, replacement: ordinary(`<b/>`) },
    { domain: "graph", op: "set-attr", target: target(0), name: "id", value: "replacement" },
  ]);
  assert.deepEqual(tags(map), ["b", "c"]);
  assert.equal(map.document.attrs.get({ kind: "path", path: [0] }, "id"), "replacement");
});

check("replacement followed by access beyond its new descendants rejects", () => {
  const map = multiNodeDocument(`<a <span/>/> <c/>`);
  const before = map.capture();
  assert.throws(() => replay(map, [
    { domain: "graph", op: "replace-content", target: target(), index: 0, replacement: ordinary(`<b/>`) },
    { domain: "graph", op: "set-attr", target: target(0, 0), name: "id", value: "invalid" },
  ]), (error: unknown) => error instanceof LiveMapDocumentStagingError
    && error.opIndex === 1
    && error.reasonCode === "DOCUMENT_PATH_OUT_OF_RANGE");
  assert.deepEqual(map.capture(), before);
});

check("replace-root is rejected when followed by another operation", () => {
  const map = element(`<main/>`);
  const replacement = element(`<article/>`).root();
  const before = map.capture();
  assert.throws(() => replay(map, [
    { domain: "graph", op: "replace-root", mode: "document", root: replacement },
    { domain: "graph", op: "set-attr", target: target(0), name: "id", value: "bad" },
  ]), (error: unknown) => error instanceof LiveMapReplayInputError
    && error.opIndex === 0
    && error.reasonCode === "ROOT_OPERATION_COMPOSITION");
  assert.deepEqual(map.capture(), before);
});

check("replace-root is rejected when preceded by another operation", () => {
  const map = element(`<main/>`);
  const replacement = element(`<article/>`).root();
  assert.throws(() => replay(map, [
    { domain: "graph", op: "set-attr", target: target(0), name: "id", value: "bad" },
    { domain: "graph", op: "replace-root", mode: "document", root: replacement },
  ]), (error: unknown) => error instanceof LiveMapReplayInputError
    && error.opIndex === 1
    && error.reasonCode === "ROOT_OPERATION_COMPOSITION");
  assert.equal(map.rev, 0);
});

check("forward move uses final-position-after-removal semantics", () => {
  const map = multiNodeDocument(`<a/> <b/> <c/> <d/>`);
  replay(map, [{ domain: "graph", op: "move-content", target: target(), from: 1, to: 3 }]);
  assert.deepEqual(tags(map), ["a", "c", "d", "b"]);
});

check("backward move uses final-position-after-removal semantics", () => {
  const map = multiNodeDocument(`<a/> <b/> <c/> <d/>`);
  replay(map, [{ domain: "graph", op: "move-content", target: target(), from: 3, to: 1 }]);
  assert.deepEqual(tags(map), ["a", "d", "b", "c"]);
});

check("adjacent forward move swaps the two final positions", () => {
  const map = multiNodeDocument(`<a/> <b/> <c/>`);
  replay(map, [{ domain: "graph", op: "move-content", target: target(), from: 0, to: 1 }]);
  assert.deepEqual(tags(map), ["b", "a", "c"]);
});

check("adjacent backward move swaps the two final positions", () => {
  const map = multiNodeDocument(`<a/> <b/> <c/>`);
  replay(map, [{ domain: "graph", op: "move-content", target: target(), from: 1, to: 0 }]);
  assert.deepEqual(tags(map), ["b", "a", "c"]);
});

check("first-to-last move uses the last existing index", () => {
  const map = multiNodeDocument(`<a/> <b/> <c/>`);
  replay(map, [{ domain: "graph", op: "move-content", target: target(), from: 0, to: 2 }]);
  assert.deepEqual(tags(map), ["b", "c", "a"]);
});

check("last-to-first move uses zero as the final destination", () => {
  const map = multiNodeDocument(`<a/> <b/> <c/>`);
  replay(map, [{ domain: "graph", op: "move-content", target: target(), from: 2, to: 0 }]);
  assert.deepEqual(tags(map), ["c", "a", "b"]);
});

check("same-position move is invalid inside a changed replay commit", () => {
  const map = multiNodeDocument(`<a/> <b/>`);
  assert.throws(() => replay(map, [
    { domain: "graph", op: "move-content", target: target(), from: 1, to: 1 },
  ]), (error: unknown) => error instanceof LiveMapReplayInputError
    && error.opIndex === 0
    && error.reasonCode === "UNCHANGED_STAGED_OPERATION");
  assert.equal(map.rev, 0);
});

check("move preserves the complete moved subtree", () => {
  const map = multiNodeDocument(`<a <span id="child"/>/> <b/>`);
  replay(map, [{ domain: "graph", op: "move-content", target: target(), from: 0, to: 1 }]);
  assert.equal(map.document.attrs.get({ kind: "path", path: [1, 0, 0] }, "id"), "child");
});

check("forward move shifts each intervening sibling exactly once", () => {
  const map = multiNodeDocument(`<a id="a"/> <b id="b"/> <c id="c"/> <d id="d"/>`);
  replay(map, [{ domain: "graph", op: "move-content", target: target(), from: 0, to: 3 }]);
  assert.deepEqual([0, 1, 2, 3].map((index) => map.document.attrs.get({ kind: "path", path: [index] }, "id")), ["b", "c", "d", "a"]);
});

check("backward move shifts each intervening sibling exactly once", () => {
  const map = multiNodeDocument(`<a id="a"/> <b id="b"/> <c id="c"/> <d id="d"/>`);
  replay(map, [{ domain: "graph", op: "move-content", target: target(), from: 3, to: 0 }]);
  assert.deepEqual([0, 1, 2, 3].map((index) => map.document.attrs.get({ kind: "path", path: [index] }, "id")), ["d", "a", "b", "c"]);
});

check("an unchanged attribute operation is invalid inside a changed commit", () => {
  const map = element(`<main id="same"/>`);
  assert.throws(() => replay(map, [
    { domain: "graph", op: "set-attr", target: target(0), name: "id", value: "same" },
  ]), (error: unknown) => error instanceof LiveMapReplayInputError
    && error.opIndex === 0
    && error.reasonCode === "UNCHANGED_STAGED_OPERATION");
});

check("a later ordinal failure leaves every earlier staged operation unapplied", () => {
  const map = multiNodeDocument(`<a/> <b/> <c/>`);
  const before = map.capture();
  assert.throws(() => replay(map, [
    { domain: "graph", op: "remove-content", target: target(), index: 0 },
    { domain: "graph", op: "set-attr", target: target(9), name: "id", value: "bad" },
  ]), (error: unknown) => error instanceof LiveMapDocumentStagingError && error.opIndex === 1);
  assert.deepEqual(map.capture(), before);
});

check("caller paths are never silently rebased between ordinals", () => {
  const map = multiNodeDocument(`<a id="a"/> <b id="b"/> <c id="c"/>`);
  replay(map, [
    { domain: "graph", op: "remove-content", target: target(), index: 0 },
    { domain: "graph", op: "set-attr", target: target(0), name: "title", value: "ordinal-path" },
  ]);
  assert.equal(map.document.attrs.get({ kind: "path", path: [0] }, "id"), "b");
  assert.equal(map.document.attrs.get({ kind: "path", path: [0] }, "title"), "ordinal-path");
});

check("the same staged commit replays deterministically on equal roots", () => {
  const left = multiNodeDocument(`<a/> <b/> <c/>`);
  const right = multiNodeDocument(`<a/> <b/> <c/>`);
  const commit = replay(left, [
    { domain: "graph", op: "move-content", target: target(), from: 2, to: 0 },
    { domain: "graph", op: "set-attr", target: target(0), name: "id", value: "moved" },
    { domain: "graph", op: "remove-content", target: target(), index: 2 },
  ]);
  right.replay(commit);
  assert.deepEqual(right.capture(), left.capture());
});

process.stdout.write(`# ${checks} staged canonical document-operation checks passed\n`);
testEvents.terminal("pass");
emit_hson_live_test_completion("livemap.document-staging", checks, checks, 0);
