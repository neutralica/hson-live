// @hson-live-external-test
import assert from "node:assert/strict";
import { Hson, hsonLiveMap } from "../src/index.ts";
import { parse_hson_exact_runtime } from "../src/internal/exact-runtime-hson-codec.ts";
import { admit_exact_runtime_livemap_libraries } from "../src/internal/exact-runtime-node-admission.ts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import { create_test_event_emitter } from "./test-events.mjs";

const Q1 = "000000v71";
const Q2 = "000000v72";
const Empty = Hson.schema`<type "document" tag "main" content "empty">`;
const Nested = Hson.schema`<type "document" tag "main" content <sequence [<tag "i" content "empty">]>>`;
export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.capture-categories", title: "Registry document capture identity boundary",
  category: "LiveMap", runtime: "node",
  tags: Object.freeze(["document", "quid", "capture", "admission", "externally-discoverable"]),
});
const events = create_test_event_emitter("livemap.capture-categories");
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
const exact = (source: string) => admit_exact_runtime_livemap_libraries({
  page: { document: parse_hson_exact_runtime(source, { allowTopLevelDocumentText: true }), schema: source.includes("<i ") ? Nested : Empty },
});
const ordinary = (source: string) => hsonLiveMap.fromLibraries({ page: { document: source, schema: Empty } });

check("registry capture is portable and QUID-free", () => {
  const capture = exact(`<main @${Q1}/>`).capture();
  assert.equal(capture.format, "hson-livemap-libraries-snapshot");
  assert.equal(JSON.stringify(capture).includes(Q1), false);
});
check("capture strips every generated QUID in nested content", () => {
  const capture = exact(`<main @${Q1} <i @${Q2}/>/>`).capture();
  assert.equal(JSON.stringify(capture).includes(Q1), false);
  assert.equal(JSON.stringify(capture).includes(Q2), false);
});
check("capture does not mutate source identity", () => {
  const map = exact(`<main @${Q1}/>`);
  map.capture();
  assert.equal(map.lib("page").document.byQuid(Q1)?.$_tag, "main");
});
check("capture carries the exact registry revision", () => {
  const map = exact(`<main @${Q1}/>`);
  map.lib("page").document.attrs.set({ kind: "path", path: [0] }, "data-v", 1);
  assert.equal(map.capture().revision, 1);
});
check("repeated captures are stable and detached", () => {
  const map = ordinary("<main/>");
  const first = map.capture();
  const second = map.capture();
  assert.deepEqual(first, second);
  assert.equal(first.libraries[0]?.name, "page");
  assert.equal(first.registryDigest, second.registryDigest);
});
check("capture of a QUID-free source does not mint identity", () => {
  const map = ordinary("<main/>");
  map.capture();
  assert.equal(JSON.stringify(map.lib("page").root()).includes("quid"), false);
  assert.equal(map.rev, 0);
});
check("restore transfers semantic state without source identity", () => {
  const source = exact(`<main @${Q1}/>`);
  source.lib("page").document.attrs.set({ kind: "path", path: [0] }, "title", "source");
  const target = ordinary("<main/>");
  target.restore(source.capture());
  assert.equal(target.lib("page").document.byQuid(Q1), undefined);
  assert.equal(target.lib("page").document.attrs.get({ kind: "path", path: [0] }, "title"), "source");
});
check("restore of same registry captures exact canonical state", () => {
  const source = ordinary("<main/>");
  source.lib("page").document.attrs.set({ kind: "path", path: [0] }, "title", "source");
  const target = ordinary("<main/>");
  target.restore(source.capture());
  assert.equal(canonical_hson_graph_equal(source.lib("page").root(), target.lib("page").root()), true);
  assert.equal(target.rev, source.rev);
});
check("incompatible registry snapshot is rejected atomically", () => {
  const target = ordinary("<main/>");
  const before = target.capture();
  const other = hsonLiveMap.fromLibraries({ other: { document: "<main/>", schema: Empty } });
  assert.throws(() => target.restore(other.capture()));
  assert.deepEqual(target.capture(), before);
});
check("local registry exposes no solo capture or install category", () => {
  const map = ordinary("<main/>");
  assert.equal("install" in map, false);
  assert.equal("replay" in map, false);
  assert.equal("cut" in map, false);
  assert.equal("capture" in map.lib("page"), true);
});
process.stdout.write(`# ${checks} registry document capture checks passed\n`);
events.terminal("pass");
