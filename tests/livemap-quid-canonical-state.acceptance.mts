// @hson-live-external-test
import assert from "node:assert/strict";
import { create_test_event_emitter } from "./test-events.mjs";
import { element, registry_for_document_library } from "./helpers/mirror-unit6.mts";
import { canonical_hson_graph_difference, canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import { decode_view_state_snapshot, encode_view_state_snapshot } from "../src/api/livemap/livemap.document.view-state-codec.ts";
import { serialize_hson } from "../src/api/transform/serializers/serialize-hson.ts";
import { parse_hson_exact_runtime } from "../src/internal/exact-runtime-hson-codec.ts";
import { is_Node } from "../src/core/node-guards.ts";
import type { HsonNode } from "../src/core/types.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.quid-canonical-state",
  title: "Registry QUID canonical state",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["document", "quid", "canonical-graph", "revision", "externally-discoverable"]),
});
const events = create_test_event_emitter("livemap.quid-canonical-state");
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
const Q1 = "000000qa1";
const Q2 = "000000qa2";
function quids(root: HsonNode): string[] {
  const found: string[] = [];
  const walk = (node: HsonNode): void => {
    if (node.$_meta?.quid !== undefined) found.push(node.$_meta.quid);
    for (const child of node.$_content) if (typeof child === "object" && child !== null) walk(child);
  };
  walk(root);
  return found;
}
const restore = (target: ReturnType<typeof element>, source: ReturnType<typeof element>) =>
  registry_for_document_library(target).restore(registry_for_document_library(source).capture());

check("otherwise identical runtime graphs with different QUIDs differ exactly", () => {
  const left = element(`<main @${Q1}/>`).root();
  const right = element(`<main @${Q2}/>`).root();
  assert.equal(canonical_hson_graph_equal(left, right), false);
  assert.equal(canonical_hson_graph_difference(left, right)?.kind, "quid-difference");
});

check("adding or removing QUID metadata changes strict canonical equality", () => {
  const plain = element('<main/>').root();
  const claimed = element(`<main @${Q1}/>`).root();
  assert.equal(canonical_hson_graph_equal(plain, claimed), false);
  assert.equal(canonical_hson_graph_difference(plain, claimed)?.kind, "metadata-presence");
  assert.equal(canonical_hson_graph_difference(claimed, plain)?.kind, "metadata-presence");
});

check("portable registry capture strips supplied QUIDs without changing its source", () => {
  const source = element(`<main @${Q1} <span @${Q2}/>/>`);
  const snapshot = registry_for_document_library(source).capture();
  assert.equal(JSON.stringify(snapshot).includes('"quid"'), false);
  assert.deepEqual(quids(source.root()), [Q1, Q2]);
});

check("portable document capture strips supplied QUIDs", () => {
  const source = element(`<main @${Q1} <span @${Q2}/>/>`);
  assert.deepEqual(quids(source.capture().root), []);
  assert.equal(source.document.byQuid(Q1)?.$_tag, "main");
});

check("registry restore removes target QUIDs and imports no source QUIDs", () => {
  const target = element(`<main @${Q1}/>`);
  restore(target, element(`<main @${Q2}/>`));
  assert.deepEqual(quids(target.root()), []);
  assert.equal(target.document.byQuid(Q1), undefined);
  assert.equal(target.document.byQuid(Q2), undefined);
});

check("portable restore uses the captured registry revision", () => {
  const source = element(`<main @${Q1}/>`);
  source.document.attrs.set({ kind: "path", path: [0] }, "revision", true);
  const target = element('<main/>');
  restore(target, source);
  assert.equal(registry_for_document_library(target).rev, 1);
  assert.equal(target.document.byQuid(Q1), undefined);
});

check("view-state codec transfers only portable document state", () => {
  const source = element(`<main @${Q1}/>`);
  const decoded = decode_view_state_snapshot(encode_view_state_snapshot(source.capture()));
  assert.deepEqual(quids(decoded.root), []);
  assert.deepEqual(decoded.root, source.capture().root);
});

check("ordinary Hson serialization omits runtime QUID claims", () => {
  const source = element(`<main @${Q1}/>`);
  const ordinary = source.at([]).snap();
  if (!is_Node(ordinary)) throw new Error("Missing document element");
  const serialized = serialize_hson(ordinary);
  assert.equal(serialized.includes(Q1), false);
  const reparsed = parse_hson_exact_runtime(serialized, { allowTopLevelDocumentText: true });
  assert.deepEqual(quids(reparsed), []);
  assert.deepEqual(quids(source.root()), [Q1]);
});

events.terminal("pass");
process.stdout.write(`# ${checks} registry QUID state checks passed\n`);
