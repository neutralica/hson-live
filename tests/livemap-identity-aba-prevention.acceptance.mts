// @hson-live-external-test
import assert from "node:assert/strict";
import { Hson, hsonLiveMap } from "../src/index.ts";
import { create_test_event_emitter } from "./test-events.mjs";
import { element, path, projected_element, registry_for_document_library } from "./helpers/mirror-unit6.mts";
import { acquire_document_identity, acquire_projected_identity } from "./helpers/livemap-identity-internal.mts";
import { set_livemap_projected_quid_candidate_source_for_tests } from "../src/api/livemap/livemap.projected.identity-handle.ts";
import { set_livemap_document_quid_candidate_source_for_tests } from "../src/api/livemap/livemap.document.registration.ts";
import { livemap_identity_epoch_accounting } from "../src/api/livemap/livemap.identity-epoch.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.identity-aba-prevention",
  title: "Registry QUID ABA prevention",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["data", "document", "quid", "identity", "lifecycle", "externally-discoverable"]),
});
const events = create_test_event_emitter("livemap.identity-aba-prevention");
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
const Q1 = "000004b01";
const Q2 = "000004b02";
const DataSchema = Hson.schema`<type "data" content <a <optional "any"> b <optional "any"> items <optional "any">>>`;
const data = () => hsonLiveMap.fromLibraries({ state: { data: { a: {}, b: {}, items: [{ id: 1 }, { id: 2 }] }, schema: DataSchema } }).lib("state");
const document = () => element('<main <item/> <item/>/>');
const target = (...parts: number[]) => ({ kind: "path" as const, path: [0, ...parts] });

check("a retired data handle never reactivates for another path", () => {
  const map = data();
  set_livemap_projected_quid_candidate_source_for_tests(map, () => Q1);
  const stale = acquire_projected_identity(map, ["a"]);
  map.at(["a"]).delete();
  let calls = 0;
  set_livemap_projected_quid_candidate_source_for_tests(map, () => ++calls === 1 ? Q1 : Q2);
  const fresh = acquire_projected_identity(map, ["b"]);
  assert.equal(stale.active, false);
  assert.equal(stale.snap(), undefined);
  assert.equal(fresh.active, true);
  assert.equal(calls, 2);
});

check("a retired document handle never reactivates for a shifted sibling", () => {
  const map = document();
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => Q1);
  const stale = acquire_document_identity(map.document, target(0, 0));
  map.document.content.remove(path(0), 0);
  let calls = 0;
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => ++calls === 1 ? Q1 : Q2);
  const fresh = acquire_document_identity(map.document, target(0, 0));
  assert.equal(stale.active, false);
  assert.equal(stale.snap(), undefined);
  assert.equal(fresh.snap()?.$_tag, "item");
  assert.equal(map.document.byQuid(Q1), undefined);
  assert.equal(calls, 2);
});

check("retired data candidates are skipped before a new allocation", () => {
  const map = data();
  set_livemap_projected_quid_candidate_source_for_tests(map, () => Q1);
  acquire_projected_identity(map, ["a"]);
  map.at(["a"]).delete();
  let calls = 0;
  set_livemap_projected_quid_candidate_source_for_tests(map, () => ++calls === 1 ? Q1 : Q2);
  acquire_projected_identity(map, ["b"]);
  assert.equal(calls, 2);
});

check("retired document candidates are skipped before a new allocation", () => {
  const map = document();
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => Q1);
  acquire_document_identity(map.document, target(0, 0));
  map.document.content.remove(path(0), 0);
  let calls = 0;
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => ++calls === 1 ? Q1 : Q2);
  acquire_document_identity(map.document, target(0, 0));
  assert.equal(calls, 2);
});

check("multiple handles for one retired document identity stay inactive", () => {
  const map = document();
  const first = acquire_document_identity(map.document, target(0, 0));
  const second = acquire_document_identity(map.document, target(0, 0));
  map.document.content.remove(path(0), 0);
  assert.equal(first.active, false);
  assert.equal(second.active, false);
});

check("disposing one data handle leaves another and the issued ledger", () => {
  const map = data();
  const first = acquire_projected_identity(map, ["a"]);
  const second = acquire_projected_identity(map, ["a"]);
  first.dispose();
  assert.equal(first.active, false);
  assert.equal(second.active, true);
  assert.equal(livemap_identity_epoch_accounting(map).issued, 1);
});

check("a projected move preserves the active identity lifetime", () => {
  const map = data();
  const handle = acquire_projected_identity(map, ["items", 0]);
  map.at(["items"]).asArray()!.move(0, 1);
  assert.deepEqual(handle.path(), ["items", 1]);
  assert.equal(livemap_identity_epoch_accounting(map).issued, 1);
});

check("document insertion shifts a handle without issuing another QUID", () => {
  const map = document();
  const handle = acquire_document_identity(map.document, target(0, 1));
  map.document.content.insert(path(0), 0, projected_element('<item/>'));
  assert.deepEqual(handle.path(), [0, 0, 2]);
  assert.equal(livemap_identity_epoch_accounting(map.document).issued, 1);
});

check("a portable registry restore retires old document handles", () => {
  const map = element('<main/>');
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => Q1);
  const old = acquire_document_identity(map.document, target());
  const owner = registry_for_document_library(map);
  owner.restore(owner.capture());
  assert.equal(old.active, false);
  assert.equal(map.document.byQuid(Q1), undefined);
});

check("equal QUID bytes in independent registries remain independent", () => {
  const left = document();
  const right = document();
  set_livemap_document_quid_candidate_source_for_tests(left.document, () => Q1);
  set_livemap_document_quid_candidate_source_for_tests(right.document, () => Q1);
  const a = acquire_document_identity(left.document, target(0, 0));
  const b = acquire_document_identity(right.document, target(0, 0));
  left.document.content.remove(path(0), 0);
  assert.equal(a.active, false);
  assert.equal(b.active, true);
});

events.terminal("pass");
process.stdout.write(`# ${checks} registry ABA checks passed\n`);
