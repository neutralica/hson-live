// @hson-live-external-test
import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import type { DocumentLiveMap, LiveMapGraphCommit } from "../src/types/livemap.types.ts";
import { LiveMapDocumentStagingError } from "../src/api/livemap/livemap.error.ts";
import { livemap_document_identity_overlay_for } from "../src/api/livemap/livemap.document.identity.ts";
import { create_test_event_emitter } from "./test-events.mjs";

const Q1 = "000000711";
const Q2 = "000000712";
const Q3 = "000000713";
const Q4 = "000000714";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.document-staged-request-lowering",
  title: "Document staged path authority",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["document", "path", "staging", "identity", "externally-discoverable"]),
});

const testEvents = create_test_event_emitter("livemap.document-staged-request-lowering");
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
  if (map.mode !== "document") throw new Error("Expected document LiveMap");
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

const path = (...segments: number[]) => Object.freeze({
  kind: "path" as const,
  path: Object.freeze(segments),
});

function child(tag: string, quid: string) {
  const value = element(`<${tag} @${quid}/>`).root().$_content[0];
  if (value === undefined || value === null || typeof value !== "object") {
    throw new Error("Expected authored document child");
  }
  return value;
}

function source(): DocumentLiveMap {
  return element(`<main @${Q1} <a @${Q2}/> <b @${Q3}/>/>`);
}

check("staged operations use the caller's current canonical path", () => {
  const map = source();
  const commit = replay(map, [
    { domain: "graph", op: "move-content", target: path(0, 0), from: 0, to: 1 },
    { domain: "graph", op: "set-attr", target: path(0, 0, 1), name: "id", value: "moved" },
  ]);
  assert.equal(map.document.byQuid(Q2)?.$_attrs?.id, "moved");
  assert.deepEqual(Reflect.get(commit.ops[1]!, "target"), path(0, 0, 1));
});

check("paths do not retarget through QUID continuity", () => {
  const map = source();
  replay(map, [
    { domain: "graph", op: "move-content", target: path(0, 0), from: 0, to: 1 },
    { domain: "graph", op: "set-attr", target: path(0, 0, 0), name: "id", value: "path-wins" },
  ]);
  assert.equal(map.document.byQuid(Q3)?.$_attrs?.id, "path-wins");
  assert.equal(map.document.byQuid(Q2)?.$_attrs?.id, undefined);
});

check("raw-QUID staging rejects atomically at its ordinal", () => {
  const map = source();
  const before = map.capture();
  assert.throws(() => replay(map, [
    { domain: "graph", op: "move-content", target: path(0, 0), from: 0, to: 1 },
    { domain: "graph", op: "set-attr", target: { kind: "quid", quid: Q2 }, name: "id", value: "bad" },
  ]), (error: unknown) => error instanceof LiveMapDocumentStagingError
    && error.opIndex === 1
    && error.reasonCode === "INVALID_DOCUMENT_COMMIT_TARGET");
  assert.deepEqual(map.capture(), before);
});

check("inserted supplied identity remains observable through a path mutation", () => {
  const map = source();
  replay(map, [
    { domain: "graph", op: "insert-content", target: path(0, 0), index: 0, content: child("i", Q4) },
    { domain: "graph", op: "set-attr", target: path(0, 0, 0), name: "id", value: "inserted" },
  ]);
  assert.equal(map.document.byQuid(Q4)?.$_attrs?.id, "inserted");
});

check("witness QUID remains non-routing replay evidence", () => {
  const map = source();
  assert.throws(() => replay(map, [{
    domain: "graph",
    op: "set-attr",
    target: { kind: "path", path: [0, 0, 0], witness: { quid: Q3 } },
    name: "id",
    value: "bad",
  }]), (error: unknown) => error instanceof LiveMapDocumentStagingError
    && error.reasonCode === "DOCUMENT_WITNESS_MISMATCH");
  assert.equal(map.rev, 0);
});

check("path mutation preserves sparse identity lookup", () => {
  const map = source();
  map.document.attrs.set(path(0, 0, 0), "id", "same");
  assert.equal(livemap_document_identity_overlay_for(map).pathForQuid(Q2)?.join("/"), "0/0/0");
  assert.equal(map.document.byQuid(Q2)?.$_attrs?.id, "same");
});

process.stdout.write(`# ${checks} document staged path-authority checks passed\n`);
testEvents.terminal("pass");
