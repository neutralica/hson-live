// @hson-live-external-test
import assert from "node:assert/strict";
import { create_test_event_emitter } from "./test-events.mjs";
import { element, path, projected_element, registry_for_document_library } from "./helpers/mirror-unit6.mts";
import { acquire_document_identity } from "./helpers/livemap-identity-internal.mts";
import { set_livemap_document_quid_candidate_source_for_tests } from "../src/api/livemap/livemap.document.registration.ts";
import { validate_document_path } from "../src/api/livemap/livemap.document.path.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.document-identity-handle",
  title: "Registry document identity handles",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["document", "identity", "path", "lifecycle", "externally-discoverable"]),
});
const events = create_test_event_emitter("livemap.document-identity-handle");
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
const Q1 = "000003a01";
const fixture = () => element('<main <item/> <item/>/>');
const target = (index: number) => ({ kind: "path" as const, path: validate_document_path([0, 0, index]) });

check("new handle resolves one current canonical path", () => {
  const map = fixture();
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => Q1);
  const handle = acquire_document_identity(map.document, target(0));
  assert.equal(handle.active, true);
  assert.deepEqual(handle.path(), [0, 0, 0]);
  assert.equal(handle.snap()?.$_tag, "item");
});

check("path and snapshot results are detached inspection values", () => {
  const map = fixture();
  const handle = acquire_document_identity(map.document, target(0));
  const address = handle.path();
  assert.equal(Object.isFrozen(address), true);
  const snapshot = handle.snap();
  if (snapshot === undefined) throw new Error("Missing identity snapshot");
  snapshot.$_tag = "changed";
  assert.equal(handle.snap()?.$_tag, "item");
});

check("attribute mutation preserves handle activity", () => {
  const map = fixture();
  const handle = acquire_document_identity(map.document, target(0));
  map.document.attrs.set(target(0), "title", "ready");
  assert.equal(handle.active, true);
  assert.equal(handle.snap()?.$_attrs?.title, "ready");
});

check("insertion before an identified node shifts its resolved path", () => {
  const map = fixture();
  const handle = acquire_document_identity(map.document, target(1));
  map.document.content.insert(path(0), 0, projected_element('<item/>'));
  assert.deepEqual(handle.path(), [0, 0, 2]);
});

check("forward and backward movement follow one identified node", () => {
  const map = fixture();
  const handle = acquire_document_identity(map.document, target(0));
  map.document.content.move(path(0), 0, 1);
  assert.deepEqual(handle.path(), [0, 0, 1]);
  map.document.content.move(path(0), 1, 0);
  assert.deepEqual(handle.path(), [0, 0, 0]);
});

check("removal retires a document identity handle", () => {
  const map = fixture();
  const handle = acquire_document_identity(map.document, target(0));
  map.document.content.remove(path(0), 0);
  assert.equal(handle.active, false);
  assert.equal(handle.snap(), undefined);
});

check("replacement without lineage retires an old handle", () => {
  const map = fixture();
  const handle = acquire_document_identity(map.document, target(0));
  map.document.content.replace(path(0), 0, projected_element('<item title="new"/>'));
  assert.equal(handle.active, false);
});

check("explicit local lineage preserves an identified replacement", () => {
  const map = fixture();
  const handle = acquire_document_identity(map.document, target(0));
  map.document.content.replace(path(0), 0, projected_element('<item title="same"/>'), [
    { source: validate_document_path([]), destination: validate_document_path([]) },
  ]);
  assert.equal(handle.active, true);
  assert.equal(handle.snap()?.$_attrs?.title, "same");
});

check("portable registry restoration invalidates prior identity handles", () => {
  const map = fixture();
  const handle = acquire_document_identity(map.document, target(0));
  const owner = registry_for_document_library(map);
  owner.restore(owner.capture());
  assert.equal(handle.active, false);
});

check("two handles share a claim but dispose independently", () => {
  const map = fixture();
  const first = acquire_document_identity(map.document, target(0));
  const second = acquire_document_identity(map.document, target(0));
  first.dispose();
  assert.equal(first.active, false);
  assert.equal(second.active, true);
});

check("identity handles expose no raw QUID authority", () => {
  const map = fixture();
  const handle = acquire_document_identity(map.document, target(0));
  assert.equal(Reflect.get(handle, "quid"), undefined);
  assert.equal(Reflect.get(handle, "fromQuid"), undefined);
});

events.terminal("pass");
process.stdout.write(`# ${checks} registry document identity handle checks passed\n`);
