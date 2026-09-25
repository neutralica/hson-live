// @hson-live-external-test
import assert from "node:assert/strict";
import { Hson, hsonLiveMap } from "../src/index.ts";
import { create_test_event_emitter } from "./test-events.mjs";
import { element, path, registry_for_document_library } from "./helpers/mirror-unit6.mts";
import { acquire_document_identity, acquire_projected_identity } from "./helpers/livemap-identity-internal.mts";
import { livemap_identity_epoch_accounting } from "../src/api/livemap/livemap.identity-epoch.ts";
import { set_livemap_document_quid_candidate_source_for_tests } from "../src/api/livemap/livemap.document.registration.ts";
import { set_livemap_projected_quid_candidate_source_for_tests } from "../src/api/livemap/livemap.projected.identity-handle.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.issued-quid-ledger",
  title: "Registry issued QUID ledger",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["data", "document", "quid", "identity", "ledger", "externally-discoverable"]),
});
const events = create_test_event_emitter("livemap.issued-quid-ledger");
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
const Q1 = "000005a01";
const Q2 = "000005a02";
const DataSchema = Hson.schema`<type "data" content <a <optional "any"> b <optional "any">>>`;
const data = () => hsonLiveMap.fromLibraries({ state: { data: { a: {}, b: {} }, schema: DataSchema } }).lib("state");
const target = (...parts: number[]) => ({ kind: "path" as const, path: [0, ...parts] });

check("QUID-free data and document registries start with no issued claims", () => {
  assert.deepEqual(livemap_identity_epoch_accounting(data()), { epoch: 0, issued: 0 });
  assert.deepEqual(livemap_identity_epoch_accounting(element('<main/>').document), { epoch: 0, issued: 0 });
});

check("supplied document identity seeds active and issued state", () => {
  assert.deepEqual(livemap_identity_epoch_accounting(element(`<main @${Q1}/>`).document), { epoch: 0, issued: 1 });
});

check("first projected allocation enters active and issued state", () => {
  const map = data();
  set_livemap_projected_quid_candidate_source_for_tests(map, () => Q1);
  acquire_projected_identity(map, ["a"]);
  assert.deepEqual(livemap_identity_epoch_accounting(map), { epoch: 0, issued: 1 });
});

check("projected retirement reduces active claims but keeps issued bytes", () => {
  const map = data();
  set_livemap_projected_quid_candidate_source_for_tests(map, () => Q1);
  acquire_projected_identity(map, ["a"]);
  map.at(["a"]).delete();
  assert.deepEqual(livemap_identity_epoch_accounting(map), { epoch: 0, issued: 1 });
});

check("document retirement reduces active claims but keeps issued bytes", () => {
  const map = element('<main <item/> <item/>/>');
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => Q1);
  acquire_document_identity(map.document, target(0, 0));
  map.document.content.remove(path(0), 0);
  assert.deepEqual(livemap_identity_epoch_accounting(map.document), { epoch: 0, issued: 1 });
});

check("retired candidates are skipped in the same document epoch", () => {
  const map = element('<main <item/> <item/>/>');
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => Q1);
  acquire_document_identity(map.document, target(0, 0));
  map.document.content.remove(path(0), 0);
  let calls = 0;
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => ++calls === 1 ? Q1 : Q2);
  acquire_document_identity(map.document, target(0, 0));
  assert.equal(calls, 2);
  assert.deepEqual(livemap_identity_epoch_accounting(map.document), { epoch: 0, issued: 2 });
});

check("multiple handles share one issued QUID", () => {
  const map = element('<main/>');
  const first = acquire_document_identity(map.document, target());
  const second = acquire_document_identity(map.document, target());
  assert.equal(first.snap()?.$_meta?.quid, second.snap()?.$_meta?.quid);
  assert.deepEqual(livemap_identity_epoch_accounting(map.document), { epoch: 0, issued: 1 });
  first.dispose();
  assert.deepEqual(livemap_identity_epoch_accounting(map.document), { epoch: 0, issued: 1 });
});

check("portable registry restoration begins an empty identity epoch", () => {
  const map = element('<main/>');
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => Q1);
  acquire_document_identity(map.document, target());
  const owner = registry_for_document_library(map);
  owner.restore(owner.capture());
  assert.deepEqual(livemap_identity_epoch_accounting(map.document), { epoch: 1, issued: 0 });
});

check("independent registries may issue the same QUID bytes", () => {
  const left = data();
  const right = data();
  set_livemap_projected_quid_candidate_source_for_tests(left, () => Q1);
  set_livemap_projected_quid_candidate_source_for_tests(right, () => Q1);
  acquire_projected_identity(left, ["a"]);
  acquire_projected_identity(right, ["a"]);
  assert.equal(livemap_identity_epoch_accounting(left).issued, 1);
  assert.equal(livemap_identity_epoch_accounting(right).issued, 1);
});

events.terminal("pass");
process.stdout.write(`# ${checks} registry issued ledger checks passed\n`);
