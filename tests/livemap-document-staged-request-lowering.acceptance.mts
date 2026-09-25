// @hson-live-external-test
import assert from "node:assert/strict";
import { create_test_event_emitter } from "./test-events.mjs";
import { element, projected_element, commit_document_operations } from "./helpers/mirror-unit6.mts";
import { validate_document_path } from "../src/api/livemap/livemap.document.path.ts";
import { livemap_document_identity_overlay_for } from "../src/api/livemap/livemap.document.identity.ts";
import type { LiveMapGraphOp, LiveMapDocumentLibrary } from "../src/types/livemap.types.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.document-staged-request-lowering",
  title: "Registry staged document path authority",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["document", "path", "staging", "identity", "externally-discoverable"]),
});
const events = create_test_event_emitter("livemap.document-staged-request-lowering");
let checks = 0;
function check(name: string, run: () => void): void {
  events.case_begin(name, name);
  try { run(); events.case_end(name, "pass"); }
  catch (error) {
    events.diagnostic(name, "assertion", error instanceof Error ? error.message : String(error));
    events.case_end(name, "fail"); events.terminal("fail"); throw error;
  }
  process.stdout.write(`ok ${++checks} - ${name}\n`);
}
const Q1 = "000000711";
const Q2 = "000000712";
const source = () => element(`<main <item @${Q1}/> <item @${Q2}/>/` + `>`);
const p = (...parts: number[]) => ({ kind: "path" as const, path: validate_document_path(parts) });
const carrier = p(0, 0);
const item = (index: number) => p(0, 0, index);
const commit = (map: LiveMapDocumentLibrary, operations: readonly LiveMapGraphOp[]) => commit_document_operations(map, operations);

check("staged paths address the current ordinal after movement", () => {
  const map = source();
  const result = commit(map, [
    { domain: "graph", op: "move-content", target: carrier, from: 0, to: 1 },
    { domain: "graph", op: "set-attr", target: item(1), name: "moved", value: true },
  ]);
  assert.equal(map.document.byQuid(Q1)?.$_attrs?.moved, true);
  const operation = result.operations[1]?.operation;
  assert.deepEqual(operation !== undefined && "domain" in operation && operation.domain === "graph" && operation.op === "set-attr"
    ? operation.target.path : undefined, [0, 0, 1]);
});

check("paths do not retarget through QUID continuity", () => {
  const map = source();
  commit(map, [
    { domain: "graph", op: "move-content", target: carrier, from: 0, to: 1 },
    { domain: "graph", op: "set-attr", target: item(0), name: "pathWins", value: true },
  ]);
  assert.equal(map.document.byQuid(Q2)?.$_attrs?.pathWins, true);
  assert.equal(map.document.byQuid(Q1)?.$_attrs?.pathWins, undefined);
});

check("invalid later target rejects the whole staged transaction", () => {
  const map = source();
  const before = map.capture();
  assert.throws(() => commit(map, [
    { domain: "graph", op: "move-content", target: carrier, from: 0, to: 1 },
    { domain: "graph", op: "set-attr", target: item(99), name: "bad", value: true },
  ]));
  assert.deepEqual(map.capture(), before);
});

check("inserted portable content is addressable at its staged path", () => {
  const map = source();
  commit(map, [
    { domain: "graph", op: "insert-content", target: carrier, index: 0, content: projected_element('<item/>') },
    { domain: "graph", op: "set-attr", target: item(0), name: "inserted", value: true },
  ]);
  assert.equal(map.document.attrs.get(item(0), "inserted"), true);
  assert.deepEqual(livemap_document_identity_overlay_for(map.document).pathForQuid(Q1), [0, 0, 1]);
});

check("path mutation retains sparse identity lookup without minting", () => {
  const map = source();
  commit(map, [{ domain: "graph", op: "set-attr", target: item(0), name: "ready", value: true }]);
  assert.equal(map.document.byQuid(Q1)?.$_attrs?.ready, true);
  assert.equal(livemap_document_identity_overlay_for(map.document).size, 2);
});

events.terminal("pass");
process.stdout.write(`# ${checks} staged registry request checks passed\n`);
