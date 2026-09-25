// @hson-live-external-test
import assert from "node:assert/strict";
import { create_test_event_emitter } from "./test-events.mjs";
import { element, path, projected_element, commit_document_operations, registry_for_document_library } from "./helpers/mirror-unit6.mts";
import { livemap_document_identity_overlay_for } from "../src/api/livemap/livemap.document.identity.ts";
import { validate_document_path } from "../src/api/livemap/livemap.document.path.ts";
import type { LiveMapSnapshot } from "../src/types/livemap.types.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.document-atomic-reconciliation",
  title: "Registry document atomic reconciliation",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["document", "identity", "atomicity", "registry", "externally-discoverable"]),
});
const events = create_test_event_emitter("livemap.document-atomic-reconciliation");
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
const Q1 = "000006b01";
const fixture = () => element(`<main <item @${Q1}/> <item/>/>`);
const overlay = (map: ReturnType<typeof element>) => livemap_document_identity_overlay_for(map.document);

check("supplied incoming QUID rejects before graph and revision publication", () => {
  const map = fixture();
  const before = map.capture();
  assert.throws(() => map.document.content.insert(path(0), 1, projected_element('<item @000006b02/>')));
  assert.deepEqual(map.capture(), before);
  assert.equal(overlay(map).size, 1);
});

check("incoming collision with an active claim rejects atomically", () => {
  const map = fixture();
  const before = map.capture();
  assert.throws(() => map.document.content.replace(path(0), 1, projected_element(`<item @${Q1}/>`)));
  assert.deepEqual(map.capture(), before);
});

check("explicit same-runtime lineage may preserve displaced local identity", () => {
  const map = fixture();
  map.document.content.replace(path(0), 0, projected_element('<item title="retained"/>'), [
    { source: validate_document_path([]), destination: validate_document_path([]) },
  ]);
  assert.equal(map.document.byQuid(Q1)?.$_attrs?.title, "retained");
});

check("invalid request path cannot route through an existing QUID", () => {
  const map = fixture();
  const before = map.capture();
  assert.throws(() => map.document.attrs.set({ kind: "path", path: [99] }, "bad", true));
  assert.deepEqual(map.capture(), before);
  assert.deepEqual(overlay(map).pathForQuid(Q1), [0, 0, 0]);
});

check("failed staged operation rolls back earlier graph and overlay effects", () => {
  const map = fixture();
  const before = map.root();
  const identity = overlay(map);
  const revision = map.rev;
  assert.throws(() => commit_document_operations(map, [
    { domain: "graph", op: "move-content", target: { kind: "path", path: validate_document_path([0, 0]) }, from: 0, to: 1 },
    { domain: "graph", op: "set-attr", target: { kind: "path", path: validate_document_path([0, 0, 99]) }, name: "bad", value: true },
  ]));
  assert.deepEqual(map.root(), before);
  assert.equal(map.rev, revision);
  assert.equal(overlay(map), identity);
});

check("failed operation publishes no partial observation", () => {
  const map = fixture();
  let publications = 0;
  map.commits.observe(() => { publications += 1; });
  assert.throws(() => map.document.content.insert(path(0), 1, projected_element('<item @000006b02/>')));
  assert.equal(publications, 0);
});

check("protected metadata mutation leaves canonical state intact", () => {
  const map = fixture();
  const before = map.capture();
  assert.throws(() => map.document.attrs.set(path(), "hson:quid", "bad"));
  assert.deepEqual(map.capture(), before);
});

check("same-position move is an atomic no-op", () => {
  const map = fixture();
  const before = map.capture();
  const result = map.document.content.move(path(0), 0, 0);
  assert.equal(result.changed, false);
  assert.deepEqual(map.capture(), before);
});

check("exact attribute no-op consumes no revision or publication", () => {
  const map = fixture();
  let publications = 0;
  map.commits.observe(() => { publications += 1; });
  map.document.attrs.drop(path(), "absent");
  assert.equal(map.rev, 0);
  assert.equal(publications, 0);
});

check("malformed portable registry restore leaves root and overlay intact", () => {
  const map = fixture();
  const owner = registry_for_document_library(map);
  const before = owner.capture();
  const identity = overlay(map);
  const invalid: LiveMapSnapshot = { ...before, registryDigest: "wrong" };
  assert.throws(() => owner.restore(invalid));
  assert.deepEqual(owner.capture(), before);
  assert.equal(overlay(map), identity);
});

events.terminal("pass");
process.stdout.write(`# ${checks} registry atomic reconciliation checks passed\n`);
