// @hson-live-external-test
import assert from "node:assert/strict";
import { create_test_event_emitter } from "./test-events.mjs";
import { element, path, projected_element, registry_for_document_library } from "./helpers/mirror-unit6.mts";
import { livemap_document_identity_accounting, livemap_document_identity_overlay_for } from "../src/api/livemap/livemap.document.identity.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.document-identity-overlay-lifecycle",
  title: "Registry document identity overlay lifecycle",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["document", "quid", "identity", "overlay", "externally-discoverable"]),
});
const events = create_test_event_emitter("livemap.document-identity-overlay-lifecycle");
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
const Q1 = "000000901";
const Q2 = "000000902";
const fixture = () => element(`<main <item @${Q1}/> <item @${Q2}/>/` + `>`);
const overlay = (map: ReturnType<typeof element>) => livemap_document_identity_overlay_for(map.document);

check("construction builds a sparse overlay for admitted QUIDs", () => {
  const before = livemap_document_identity_accounting();
  const map = fixture();
  const after = livemap_document_identity_accounting();
  assert.equal(after.fullBuilds, before.fullBuilds + 1);
  assert.equal(overlay(map).size, 2);
});

check("attribute mutation reconciles without a full overlay rebuild", () => {
  const map = fixture();
  const before = livemap_document_identity_accounting();
  map.document.attrs.set(path(0, 0), "title", "ready");
  const after = livemap_document_identity_accounting();
  assert.equal(after.fullBuilds, before.fullBuilds);
  assert.ok(after.reconciliations > before.reconciliations);
  assert.deepEqual(overlay(map).pathForQuid(Q1), [0, 0, 0]);
});

check("byQuid reads preserve the overlay without reconciliation", () => {
  const map = fixture();
  const before = livemap_document_identity_accounting();
  for (let index = 0; index < 5; index += 1) assert.equal(map.document.byQuid(Q2)?.$_tag, "item");
  assert.deepEqual(livemap_document_identity_accounting(), before);
});

check("portable capture omits graph identity and derived overlay", () => {
  const map = fixture();
  const bytes = JSON.stringify(registry_for_document_library(map).capture());
  assert.equal(bytes.includes('"quid"'), false);
  assert.equal(bytes.includes("overlay"), false);
  assert.equal(overlay(map).size, 2);
});

check("removal retires only the removed sparse identity", () => {
  const map = fixture();
  map.document.content.remove(path(0), 0);
  assert.equal(overlay(map).pathForQuid(Q1), undefined);
  assert.deepEqual(overlay(map).pathForQuid(Q2), [0, 0, 0]);
  assert.equal(overlay(map).size, 1);
});

check("rejected supplied QUID insertion leaves root, revision, and overlay intact", () => {
  const map = fixture();
  const before = map.root();
  const revision = map.rev;
  assert.throws(() => map.document.content.insert(path(0), 1, projected_element('<item @000000903/>')));
  assert.deepEqual(map.root(), before);
  assert.equal(map.rev, revision);
  assert.equal(overlay(map).size, 2);
});

check("failed raw-QUID request publishes no candidate overlay", () => {
  const map = fixture();
  const before = livemap_document_identity_accounting();
  assert.throws(() => map.document.attrs.set({ kind: "quid", quid: Q1 } as never, "bad", true));
  assert.deepEqual(livemap_document_identity_accounting(), before);
});

check("commit observers see the accepted root and overlay", () => {
  const map = fixture();
  let publications = 0;
  map.commits.observe((event) => {
    if (event.kind !== "commit") return;
    publications += 1;
    assert.equal(map.document.attrs.get(path(0, 0), "ready"), true);
    assert.deepEqual(overlay(map).pathForQuid(Q1), [0, 0, 0]);
  });
  map.document.attrs.set(path(0, 0), "ready", true);
  assert.equal(publications, 1);
});

check("canonical no-op does not publish or rebuild", () => {
  const map = fixture();
  const before = livemap_document_identity_accounting();
  let publications = 0;
  map.commits.observe(() => { publications += 1; });
  map.document.attrs.drop(path(), "absent");
  assert.equal(map.rev, 0);
  assert.equal(publications, 0);
  assert.equal(livemap_document_identity_accounting().fullBuilds, before.fullBuilds);
});

check("portable registry restore starts a new identity epoch", () => {
  const source = fixture();
  const target = fixture();
  registry_for_document_library(target).restore(registry_for_document_library(source).capture());
  assert.equal(overlay(target).size, 0);
  assert.equal(target.document.byQuid(Q1), undefined);
  assert.equal(target.document.byQuid(Q2), undefined);
});

events.terminal("pass");
process.stdout.write(`# ${checks} registry identity overlay lifecycle checks passed\n`);
