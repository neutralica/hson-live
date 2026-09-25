// @hson-live-external-test
import assert from "node:assert/strict";
import { Hson, hsonLiveMap } from "../src/index.ts";
import { create_test_event_emitter } from "./test-events.mjs";
import { element, path, projected_element, registry_for_document_library } from "./helpers/mirror-unit6.mts";
import { acquire_document_identity } from "./helpers/livemap-identity-internal.mts";
import { set_livemap_document_quid_candidate_source_for_tests } from "../src/api/livemap/livemap.document.registration.ts";
import { validate_document_path } from "../src/api/livemap/livemap.document.path.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.identity-replay-provenance",
  title: "Registry identity ingress provenance",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["data", "document", "quid", "identity", "provenance", "externally-discoverable"]),
});
const events = create_test_event_emitter("livemap.identity-replay-provenance");
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
const Q1 = "000005b01";
const Q2 = "000005b02";
const PageSchema = Hson.schema`<type "document" tag "main" content <repeat <tag "item" content "empty">>>`;
const target = (index: number) => ({ kind: "path" as const, path: [0, 0, index] });

check("public document admission rejects generated QUID claims", () => {
  assert.throws(() => hsonLiveMap.fromLibraries({
    page: { document: `<main @${Q1}/>` , schema: PageSchema },
  }));
});

check("public document node admission rejects generated QUID metadata", () => {
  const claimed = element(`<main @${Q1}/>`).root();
  assert.throws(() => hsonLiveMap.fromLibraries({ page: { document: claimed, schema: PageSchema } }));
});

check("incoming document insertion rejects supplied identity atomically", () => {
  const map = element('<main <item/>/>');
  const before = map.capture();
  assert.throws(() => map.document.content.insert(path(0), 1, projected_element(`<item @${Q1}/>`)));
  assert.deepEqual(map.capture(), before);
});

check("incoming document replacement rejects supplied identity atomically", () => {
  const map = element('<main <item/>/>');
  const before = map.capture();
  assert.throws(() => map.document.content.replace(path(0), 0, projected_element(`<item @${Q1}/>`)));
  assert.deepEqual(map.capture(), before);
});

check("explicit same-runtime lineage retains a local QUID lifetime", () => {
  const map = element('<main <item/>/>');
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => Q1);
  const handle = acquire_document_identity(map.document, target(0));
  map.document.content.replace(path(0), 0, projected_element('<item title="new"/>'), [
    { source: validate_document_path([]), destination: validate_document_path([]) },
  ]);
  assert.equal(handle.active, true);
  assert.equal(map.document.byQuid(Q1)?.$_attrs?.title, "new");
});

check("portable capture never serializes issued QUID ledger entries", () => {
  const map = element('<main <item/>/>');
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => Q1);
  acquire_document_identity(map.document, target(0));
  const bytes = JSON.stringify(registry_for_document_library(map).capture());
  assert.equal(bytes.includes(Q1), false);
  assert.equal(bytes.includes("issuedQuids"), false);
});

check("portable restoration begins a new identity epoch", () => {
  const map = element('<main <item/>/>');
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => Q1);
  const old = acquire_document_identity(map.document, target(0));
  const owner = registry_for_document_library(map);
  owner.restore(owner.capture());
  assert.equal(old.active, false);
  assert.equal(map.document.byQuid(Q1), undefined);
});

check("separate registries can reuse the same local QUID bytes", () => {
  const left = element('<main <item/>/>');
  const right = element('<main <item/>/>');
  set_livemap_document_quid_candidate_source_for_tests(left.document, () => Q2);
  set_livemap_document_quid_candidate_source_for_tests(right.document, () => Q2);
  const a = acquire_document_identity(left.document, target(0));
  const b = acquire_document_identity(right.document, target(0));
  assert.equal(a.snap()?.$_meta?.quid, Q2);
  assert.equal(b.snap()?.$_meta?.quid, Q2);
});

events.terminal("pass");
process.stdout.write(`# ${checks} registry identity ingress checks passed\n`);
