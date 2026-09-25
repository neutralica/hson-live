// @hson-live-external-test
import assert from "node:assert/strict";
import { create_test_event_emitter } from "./test-events.mjs";
import { element, mount, path, raw_node, registry_for_document_library } from "./helpers/mirror-unit6.mts";
import { _create_livetree_runtime_test_handle, _reflect_document_for_runtime_test, _lookup_livetree_runtime_test_node } from "../src/_tests/diagnostics-internal.ts";
import { set_livemap_document_quid_candidate_source_for_tests } from "../src/api/livemap/livemap.document.registration.ts";
import { livemap_document_identity_overlay_for } from "../src/api/livemap/livemap.document.identity.ts";
import { get_el_for_node } from "../src/api/livetree/utils/node-map-helpers.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.linked-identity-registration",
  title: "Registry linked identity registration",
  category: "LiveMap",
  runtime: "node-synthetic-dom",
  tags: Object.freeze(["document", "mirror", "quid", "identity", "externally-discoverable"]),
});
const events = create_test_event_emitter("livemap.linked-identity-registration");
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
const Q1 = "000007a01";
const fixture = () => element('<main <item/>/>');
const reflected = () => {
  const map = fixture();
  const runtime = _create_livetree_runtime_test_handle();
  const binding = _reflect_document_for_runtime_test(runtime, map);
  return { map, runtime, binding };
};

check("linked descendant QUID demand registers one canonical local identity", () => {
  const { map, binding } = reflected();
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => Q1);
  const tree = binding.tree.find.byTag("item");
  assert.equal(tree?.quid, Q1);
  assert.deepEqual(livemap_document_identity_overlay_for(map.document).pathForQuid(Q1), [0, 0, 0]);
  assert.equal(map.document.byQuid(Q1)?.$_tag, "item");
  binding.dispose();
});

check("registration leaves canonical graph and revision unchanged", () => {
  const { map, binding } = reflected();
  const before = map.root();
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => Q1);
  binding.tree.find.byTag("item")?.quid;
  assert.deepEqual(map.root(), before);
  assert.equal(map.rev, 0);
  binding.dispose();
});

check("registration publishes no ordinary map commit", () => {
  const { map, binding } = reflected();
  let publications = 0;
  registry_for_document_library(map).commits.observe(() => { publications += 1; });
  binding.tree.find.byTag("item")?.quid;
  assert.equal(publications, 0);
  binding.dispose();
});

check("runtime registry resolves the exact reflected node", () => {
  const { map, runtime, binding } = reflected();
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => Q1);
  const tree = binding.tree.find.byTag("item");
  assert.equal(tree?.quid, Q1);
  assert.equal(_lookup_livetree_runtime_test_node(runtime, Q1), tree?.node);
  binding.dispose();
});

check("mounted registration keeps the exact DOM and publishes hson:quid", () => {
  const { map, binding } = reflected();
  mount(binding.tree.node);
  const item = raw_node(binding.tree.node, [0, 0]);
  const dom = get_el_for_node(item);
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => Q1);
  assert.equal(binding.tree.find.byTag("item")?.quid, Q1);
  assert.equal(get_el_for_node(item), dom);
  assert.equal(dom?.getAttribute("hson:quid"), Q1);
  binding.dispose();
});

check("repeated demand returns the same local QUID without a commit", () => {
  const { map, binding } = reflected();
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => Q1);
  const tree = binding.tree.find.byTag("item");
  assert.equal(tree?.quid, Q1);
  assert.equal(tree?.quid, Q1);
  assert.equal(map.rev, 0);
  binding.dispose();
});

check("portable capture does not carry registered runtime metadata", () => {
  const { map, binding } = reflected();
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => Q1);
  binding.tree.find.byTag("item")?.quid;
  const bytes = JSON.stringify(registry_for_document_library(map).capture());
  assert.equal(bytes.includes(Q1), false);
  binding.dispose();
});

check("diagnostic byQuid lookup is detached and has no acquisition authority", () => {
  const { map, binding } = reflected();
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => Q1);
  binding.tree.find.byTag("item")?.quid;
  const diagnostic = map.document.byQuid(Q1);
  if (diagnostic === undefined) throw new Error("Missing diagnostic node");
  diagnostic.$_tag = "other";
  assert.equal(map.document.byQuid(Q1)?.$_tag, "item");
  assert.equal(Reflect.get(map.document, "fromQuid"), undefined);
  binding.dispose();
});

check("unrelated path attributes remain QUID-free", () => {
  const { map, binding } = reflected();
  map.document.attrs.set(path(), "title", "ready");
  assert.equal(livemap_document_identity_overlay_for(map.document).size, 0);
  binding.dispose();
});

events.terminal("pass");
process.stdout.write(`# ${checks} registry linked registration checks passed\n`);
