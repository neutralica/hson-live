// @hson-live-external-test
import assert from "node:assert/strict";
import { create_test_event_emitter } from "./test-events.mjs";
import { element, path, projected_element, raw_node, mount, registry_for_document_library } from "./helpers/mirror-unit6.mts";
import { validate_document_path } from "../src/api/livemap/livemap.document.path.ts";
import { acquire_document_identity } from "./helpers/livemap-identity-internal.mts";
import { set_livemap_document_quid_candidate_source_for_tests } from "../src/api/livemap/livemap.document.registration.ts";
import { livemap_identity_epoch_accounting } from "../src/api/livemap/livemap.identity-epoch.ts";
import { _create_livetree_runtime_test_handle, _reflect_document_for_runtime_test } from "../src/_tests/diagnostics-internal.ts";
import { get_el_for_node } from "../src/api/livetree/utils/node-map-helpers.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.document-same-quid-replacement-continuity",
  title: "Registry document replacement identity continuity",
  category: "LiveMap",
  runtime: "node-synthetic-dom",
  tags: Object.freeze(["document", "replacement", "quid", "mirror", "externally-discoverable"]),
});
const events = create_test_event_emitter("livemap.document-same-quid-replacement-continuity");
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
const Q1 = "000006a01";
const Q2 = "000006a02";
const fixture = () => element(`<main <item @${Q1}/>/` + `>`);
const self = [{ source: validate_document_path([]), destination: validate_document_path([]) }];
const target = { kind: "path" as const, path: [0, 0, 0] };

check("replacement without lineage retires the active mapping", () => {
  const map = fixture();
  map.document.content.replace(path(0), 0, projected_element('<item title="next"/>'));
  assert.equal(map.document.byQuid(Q1), undefined);
  assert.equal(livemap_identity_epoch_accounting(map.document).issued, 1);
});

check("retired identity stays retired when a later local demand allocates another QUID", () => {
  const map = fixture();
  map.document.content.replace(path(0), 0, projected_element('<item/>'));
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => Q2);
  const handle = acquire_document_identity(map.document, target);
  assert.equal(handle.snap()?.$_meta?.quid, Q2);
  assert.equal(map.document.byQuid(Q1), undefined);
});

check("explicit self lineage preserves canonical local identity", () => {
  const map = fixture();
  const handle = acquire_document_identity(map.document, target);
  map.document.content.replace(path(0), 0, projected_element('<item title="same"/>'), self);
  assert.equal(handle.active, true);
  assert.equal(map.document.byQuid(Q1)?.$_attrs?.title, "same");
  assert.equal(livemap_identity_epoch_accounting(map.document).issued, 1);
});

check("compatible lineage preserves reflected subject and DOM", () => {
  const map = fixture();
  const binding = _reflect_document_for_runtime_test(_create_livetree_runtime_test_handle(), map);
  mount(binding.tree.node);
  const original = raw_node(binding.tree.node, [0, 0]);
  const dom = get_el_for_node(original);
  map.document.content.replace(path(0), 0, projected_element('<item title="new"/>'), self);
  assert.equal(raw_node(binding.tree.node, [0, 0]), original);
  assert.equal(get_el_for_node(original), dom);
  assert.equal(original.$_attrs?.title, "new");
  binding.dispose();
});

check("QUID-free replacement can later acquire local identity", () => {
  const map = element('<main <item/>/>');
  map.document.content.replace(path(0), 0, projected_element('<item title="new"/>'));
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => Q2);
  assert.equal(acquire_document_identity(map.document, target).snap()?.$_meta?.quid, Q2);
});

check("portable equal-QUID replacement input rejects before mutation", () => {
  const map = fixture();
  const before = map.capture();
  assert.throws(() => map.document.content.replace(path(0), 0, projected_element(`<item @${Q1}/>`)));
  assert.deepEqual(map.capture(), before);
});

check("portable restoration reconstructs a fresh identity epoch", () => {
  const map = fixture();
  const handle = acquire_document_identity(map.document, target);
  const owner = registry_for_document_library(map);
  owner.restore(owner.capture());
  assert.equal(handle.active, false);
  assert.equal(map.document.byQuid(Q1), undefined);
});

check("independent registries admit equal exact QUID bytes", () => {
  const left = element(`<main <item @${Q1}/> <item/>/>`);
  const right = element(`<main <item @${Q1}/> <item/>/>`);
  assert.equal(left.document.byQuid(Q1)?.$_tag, "item");
  assert.equal(right.document.byQuid(Q1)?.$_tag, "item");
  left.document.content.remove(path(0), 0);
  assert.equal(left.document.byQuid(Q1), undefined);
  assert.equal(right.document.byQuid(Q1)?.$_tag, "item");
});

events.terminal("pass");
process.stdout.write(`# ${checks} registry replacement continuity checks passed\n`);
