// @hson-live-external-test
import assert from "node:assert/strict";
import { create_test_event_emitter } from "./test-events.mjs";
import { element, projected_element, commit_document_operations } from "./helpers/mirror-unit6.mts";
import { validate_document_path } from "../src/api/livemap/livemap.document.path.ts";
import {
  livemap_document_identity_accounting,
  livemap_document_identity_overlay_for,
} from "../src/api/livemap/livemap.document.identity.ts";
import type { LiveMapDocumentLibrary, LiveMapGraphOp } from "../src/types/livemap.types.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.document-staged-reconciliation",
  title: "Registry staged document identity reconciliation",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["document", "quid", "path", "staging", "reconciliation", "externally-discoverable"]),
});
const events = create_test_event_emitter("livemap.document-staged-reconciliation");
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
const Q1 = "000000601";
const Q2 = "000000602";
const Q3 = "000000603";
const p = (...parts: number[]) => Object.freeze({ kind: "path" as const, path: validate_document_path(parts) });
const carrier = p(0, 0);
const item = (index: number) => p(0, 0, index);
const fixture = () => element(`<main <item @${Q1}/> <item @${Q2}/> <item @${Q3}/>/` + `>`);
const overlay = (map: LiveMapDocumentLibrary) => livemap_document_identity_overlay_for(map.document);
const commit = (map: LiveMapDocumentLibrary, operations: readonly LiveMapGraphOp[]) => commit_document_operations(map, operations);

check("insert then mutate resolves the staged ordinal and shifts sparse claims", () => {
  const map = fixture();
  commit(map, [
    { domain: "graph", op: "insert-content", target: carrier, index: 1, content: projected_element('<item/>') },
    { domain: "graph", op: "set-attr", target: item(1), name: "inserted", value: true },
  ]);
  assert.equal(map.document.attrs.get(item(1), "inserted"), true);
  assert.deepEqual(overlay(map).pathForQuid(Q2), [0, 0, 2]);
  assert.equal(overlay(map).size, 3);
});

check("delete then mutate resolves the shifted sparse identity", () => {
  const map = fixture();
  commit(map, [
    { domain: "graph", op: "remove-content", target: carrier, index: 0 },
    { domain: "graph", op: "set-attr", target: item(0), name: "shifted", value: true },
  ]);
  assert.equal(overlay(map).pathForQuid(Q1), undefined);
  assert.deepEqual(overlay(map).pathForQuid(Q2), [0, 0, 0]);
  assert.equal(map.document.attrs.get(item(0), "shifted"), true);
});

check("move then mutate follows the final destination path", () => {
  const map = fixture();
  commit(map, [
    { domain: "graph", op: "move-content", target: carrier, from: 0, to: 2 },
    { domain: "graph", op: "set-attr", target: item(2), name: "moved", value: true },
  ]);
  assert.deepEqual(overlay(map).pathForQuid(Q1), [0, 0, 2]);
  assert.equal(map.document.attrs.get(item(2), "moved"), true);
});

check("later invalid path rejects all staged overlay and graph writes", () => {
  const map = fixture();
  const beforeRoot = map.root();
  const beforeRevision = map.rev;
  assert.throws(() => commit(map, [
    { domain: "graph", op: "move-content", target: carrier, from: 0, to: 2 },
    { domain: "graph", op: "set-attr", target: item(99), name: "bad", value: true },
  ]));
  assert.deepEqual(map.root(), beforeRoot);
  assert.equal(map.rev, beforeRevision);
  assert.deepEqual(overlay(map).pathForQuid(Q1), [0, 0, 0]);
});

check("one transaction reconciles sparse identity without a full rebuild", () => {
  const map = fixture();
  const before = livemap_document_identity_accounting();
  commit(map, [{ domain: "graph", op: "move-content", target: carrier, from: 0, to: 2 }]);
  const after = livemap_document_identity_accounting();
  assert.equal(after.fullBuilds, before.fullBuilds);
  assert.ok(after.reconciliations > before.reconciliations);
});

check("QUID-free insertion retains an empty sparse overlay", () => {
  const map = element('<main <item/>/>');
  commit(map, [{ domain: "graph", op: "insert-content", target: carrier, index: 1, content: projected_element('<item/>') }]);
  assert.equal(overlay(map).size, 0);
});

check("repeated QUID lookup changes no reconciliation accounting", () => {
  const map = fixture();
  const before = livemap_document_identity_accounting();
  for (let index = 0; index < 5; index += 1) assert.deepEqual(overlay(map).pathForQuid(Q2), [0, 0, 1]);
  assert.deepEqual(livemap_document_identity_accounting(), before);
});

events.terminal("pass");
process.stdout.write(`# ${checks} registry reconciliation checks passed\n`);
