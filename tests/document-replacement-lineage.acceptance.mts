// @hson-live-external-test
import assert from "node:assert/strict";
import { create_test_event_emitter } from "./test-events.mjs";
import { element, path, projected_element, raw_node } from "./helpers/mirror-unit6.mts";
import { validate_document_path } from "../src/api/livemap/livemap.document.path.ts";
import { _create_livetree_runtime_test_handle, _reflect_document_for_runtime_test } from "../src/_tests/diagnostics-internal.ts";
import { livemap_identity_epoch_accounting } from "../src/api/livemap/livemap.identity-epoch.ts";
import type { LiveMapReplacementLineage } from "../src/types/livemap.types.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.document-replacement-lineage",
  title: "Registry document replacement lineage",
  category: "LiveMap",
  runtime: "node-synthetic-dom",
  tags: Object.freeze(["document", "replacement", "lineage", "identity", "externally-discoverable"]),
});
const events = create_test_event_emitter("livemap.document-replacement-lineage");
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
const Q1 = "000009101";
const Q2 = "000009102";
const Q3 = "000009103";
const Q4 = "000009104";
const lineage = (source: number[], destination: number[]): LiveMapReplacementLineage[number] => ({
  source: validate_document_path(source), destination: validate_document_path(destination),
});
const fixture = () => element(`<main <section @${Q1} <item @${Q2}/> <item @${Q3}/> <item @${Q4}/>/` + `>/>`);
const replacement = () => projected_element('<section <item id="c"/> <item id="new"/> <item id="a"/>/>');
const rearranged: LiveMapReplacementLineage = [
  lineage([], []), lineage([0, 0], [0, 2]), lineage([0, 2], [0, 0]),
];

check("replacement without lineage retires outgoing local identity", () => {
  const map = element(`<main <item @${Q2}/>/` + `>`);
  map.document.content.replace(path(0), 0, projected_element('<item/>'));
  assert.equal(map.document.byQuid(Q2), undefined);
});

check("explicit self lineage preserves one local identity", () => {
  const map = element(`<main <item @${Q2}/>/` + `>`);
  map.document.content.replace(path(0), 0, projected_element('<item title="same"/>'), [lineage([], [])]);
  assert.equal(map.document.byQuid(Q2)?.$_attrs?.title, "same");
});

check("descendant rearrangement retains only declared local lifetimes", () => {
  const map = fixture();
  map.document.content.replace(path(0), 0, replacement(), rearranged);
  assert.equal(map.document.byQuid(Q1)?.$_tag, "section");
  assert.equal(map.document.byQuid(Q2)?.$_attrs?.id, "a");
  assert.equal(map.document.byQuid(Q4)?.$_attrs?.id, "c");
  assert.equal(map.document.byQuid(Q3), undefined);
  assert.equal(livemap_identity_epoch_accounting(map.document).issued, 4);
});

check("accepted map-global commit records explicit path lineage", () => {
  const map = fixture();
  const commit = map.document.content.replace(path(0), 0, replacement(), rearranged);
  const operation = commit.operations[0]?.operation;
  assert.equal(operation?.op, "replace-content");
  if (operation?.op !== "replace-content") throw new Error("Missing replacement operation");
  assert.deepEqual(operation.lineage, rearranged);
  assert.equal(commit.operations[0]?.library, "page");
});

check("Mirror follows local replacement lineage for compatible descendants", () => {
  const map = fixture();
  const binding = _reflect_document_for_runtime_test(_create_livetree_runtime_test_handle(), map);
  const oldFirst = raw_node(binding.tree.node, [0, 0, 0, 0]);
  const oldThird = raw_node(binding.tree.node, [0, 0, 0, 2]);
  map.document.content.replace(path(0), 0, replacement(), rearranged);
  assert.equal(raw_node(binding.tree.node, [0, 0, 0, 0]), oldThird);
  assert.equal(raw_node(binding.tree.node, [0, 0, 0, 2]), oldFirst);
  binding.dispose();
});

events.terminal("pass");
process.stdout.write(`# ${checks} registry replacement lineage checks passed\n`);
