// @hson-live-external-test
import assert from "node:assert/strict";
import { create_test_event_emitter } from "./test-events.mjs";
import { parse_hson_exact_runtime } from "../src/internal/exact-runtime-hson-codec.ts";
import { admit_exact_runtime_livemap_node } from "../src/internal/exact-runtime-node-admission.ts";
import { is_Node } from "../src/core/node-guards.ts";
import { livemap_identity_epoch_accounting } from "../src/api/livemap/livemap.identity-epoch.ts";
import { validate_document_path } from "../src/api/livemap/livemap.document.path.ts";
import { _create_livetree_runtime_test_handle, _reflect_document_for_runtime_test } from "../src/_tests/diagnostics-internal.ts";
import { mount, raw_node } from "./helpers/reflect-unit6.mts";
import { get_el_for_node } from "../src/api/livetree/utils/node-map-helpers.ts";
import { set_livemap_document_quid_candidate_source_for_tests } from "../src/api/livemap/livemap.document.registration.ts";
import type { HsonNode } from "../src/core/types.ts";
import type { DocumentLiveMap, LiveMapReplacementLineage } from "../src/types/livemap.types.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.document-replacement-lineage",
  title: "Portable document replacement lineage",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["document", "replacement", "lineage", "identity"]),
});

const events = create_test_event_emitter("livemap.document-replacement-lineage");
let checks = 0;
function check(name: string, run: () => void): void {
  events.case_begin(name, name);
  try { run(); events.case_end(name, "pass"); }
  catch (error) {
    events.diagnostic(name, "assertion", error instanceof Error ? error.message : String(error));
    events.case_end(name, "fail");
    events.terminal("fail");
    throw error;
  }
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

const path = (...segments: number[]) => validate_document_path(segments);
const lineage_entry = (source: number[], destination: number[]): LiveMapReplacementLineage[number] =>
  Object.freeze({ source: path(...source), destination: path(...destination) });
const target = Object.freeze({ kind: "path" as const, path: path(0, 0) });
function node(source: string): HsonNode {
  const value = map(source).at([]).snap();
  if (!is_Node(value)) throw new TypeError("Expected an element.");
  return value;
}
function map(source: string): DocumentLiveMap {
  const result = admit_exact_runtime_livemap_node(parse_hson_exact_runtime(source, { allowTopLevelDocumentText: true }));
  if (result.mode !== "document") throw new TypeError("Expected a document.");
  return result;
}
function apply(document: DocumentLiveMap, replacement: HsonNode, lineage: LiveMapReplacementLineage): void {
  document.replay(Object.freeze({
    changed: true,
    prevRev: document.rev,
    rev: document.rev + 1,
    ops: Object.freeze([Object.freeze({ domain: "graph", op: "replace-content", target, index: 0, replacement, lineage })]),
  }));
}
function fixture(prefix: string): DocumentLiveMap {
  return map(`<main <section @${prefix}1 <a @${prefix}2/> <b @${prefix}3/> <c @${prefix}4/>/>/>`);
}

check("the same QUID-free lineage preserves different local identities through descendant rearrangement", () => {
  const a = fixture("00000910");
  const b = fixture("00000920");
  const lineage: LiveMapReplacementLineage = [
    lineage_entry([], []),
    lineage_entry([0, 0], [0, 2]),
    lineage_entry([0, 2], [0, 0]),
  ];
  const replacement = node("<section <c/> <new/> <a/>/>");
  apply(a, replacement, lineage);
  apply(b, replacement, lineage);
  assert.equal(a.document.byQuid("000009101")?.$_tag, "section");
  assert.equal(b.document.byQuid("000009201")?.$_tag, "section");
  assert.equal(a.document.byQuid("000009102")?.$_tag, "a");
  assert.equal(b.document.byQuid("000009202")?.$_tag, "a");
  assert.equal(a.document.byQuid("000009104")?.$_tag, "c");
  assert.equal(b.document.byQuid("000009204")?.$_tag, "c");
  assert.equal(a.document.byQuid("000009103"), undefined);
  assert.equal(b.document.byQuid("000009203"), undefined);
  assert.equal(a.document.byQuid("000009201"), undefined);
  assert.equal(b.document.byQuid("000009101"), undefined);
  const aSection = a.document.byQuid("000009101");
  const bSection = b.document.byQuid("000009201");
  const tags = (section: HsonNode | undefined) => {
    const wrapper = section?.$_content[0];
    return is_Node(wrapper) ? wrapper.$_content.map((child) => is_Node(child) ? child.$_tag : child) : [];
  };
  assert.deepEqual(tags(aSection), ["c", "new", "a"]);
  assert.deepEqual(tags(bSection), ["c", "new", "a"]);
  assert.equal(livemap_identity_epoch_accounting(a.document).issued, 4);
  assert.equal(livemap_identity_epoch_accounting(b.document).issued, 4);
});

check("same coordinate with no lineage replaces identity; an explicit self-map preserves it", () => {
  const killed = map("<main <a @000009301/>/>");
  apply(killed, node("<a/>"), []);
  assert.equal(killed.document.byQuid("000009301"), undefined);
  const survived = map("<main <a @000009302/>/>");
  apply(survived, node("<i/>"), [lineage_entry([], [])]);
  assert.equal(survived.document.byQuid("000009302")?.$_tag, "i");
});

check("lineage preserves sparse lifetimes without minting local QUIDs", () => {
  const document = map("<main <section <a/>/>/>");
  apply(document, node("<article <b/>/>"), [lineage_entry([], []), lineage_entry([0, 0], [0, 0])]);
  assert.equal(livemap_identity_epoch_accounting(document.document).issued, 0);
  const root = JSON.stringify(document.root());
  assert.equal(root.includes('"$_tag":"article"'), true);
  assert.equal(root.includes('"quid"'), false);
});

check("authority authoring accepts explicit path lineage with portable replacement content", () => {
  const document = fixture("00000970");
  const replacement = node("<article <c/> <new/> <a/>/>");
  const expected = [
    lineage_entry([], []),
    lineage_entry([0, 2], [0, 0]),
    lineage_entry([0, 0], [0, 2]),
  ];
  const commit = document.document.content.replace(target, 0, replacement, expected);
  const operation = commit.ops[0];
  assert.equal(operation?.op, "replace-content");
  if (operation?.op !== "replace-content") throw new TypeError("Expected replacement operation.");
  assert.deepEqual(operation.lineage, expected);
  assert.equal(document.document.byQuid("000009701")?.$_tag, "article");
  assert.equal(document.document.byQuid("000009703"), undefined);
});

check("Mirror follows receiving-runtime lineage and reuses compatible local DOM objects", () => {
  const document = fixture("00000960");
  const runtime = _create_livetree_runtime_test_handle();
  const binding = _reflect_document_for_runtime_test(runtime, document);
  mount(binding.tree.node);
  const oldA = raw_node(binding.tree.node, [0, 0, 0, 0]);
  const oldC = raw_node(binding.tree.node, [0, 0, 0, 2]);
  const domA = get_el_for_node(oldA);
  const domC = get_el_for_node(oldC);
  apply(document, node("<section <c/> <new/> <a/>/>"), [
    lineage_entry([], []),
    lineage_entry([0, 0], [0, 2]),
    lineage_entry([0, 2], [0, 0]),
  ]);
  assert.equal(raw_node(binding.tree.node, [0, 0, 0, 0]), oldC);
  assert.equal(raw_node(binding.tree.node, [0, 0, 0, 2]), oldA);
  assert.equal(get_el_for_node(oldC), domC);
  assert.equal(get_el_for_node(oldA), domA);
  assert.equal(document.document.byQuid("000009603"), undefined);
  assert.equal(binding.status, "active", binding.failure?.message);
  const beforeRejectedRev = document.rev;
  assert.throws(() => apply(document, node("<section <x/> <new/> <a/>/>"), [
    lineage_entry([], []), lineage_entry([], [0, 0]),
  ]));
  assert.equal(document.rev, beforeRejectedRev);
  assert.equal(raw_node(binding.tree.node, [0, 0, 0, 2]), oldA);
  assert.equal(get_el_for_node(oldA), domA);
  assert.equal(binding.status, "active");
  binding.dispose();
});

check("QUID-free replacement lineage carries an overlay-only local identity through Mirror", () => {
  const document = map("<main <section <a/> <b/>/>/>");
  const runtime = _create_livetree_runtime_test_handle();
  const binding = _reflect_document_for_runtime_test(runtime, document);
  const oldA = raw_node(binding.tree.node, [0, 0, 0, 0]);
  set_livemap_document_quid_candidate_source_for_tests(document.document, () => "000004b01");
  const quid = binding.tree.find.byTag("a")!.quid;
  assert.equal(quid, "000004b01");
  assert.equal(document.rev, 0);
  assert.equal(JSON.stringify(document.root()).includes('"quid"'), false);
  apply(document, node("<section <b/> <a/>/>"), [
    lineage_entry([], []),
    lineage_entry([0, 0], [0, 1]),
  ]);
  assert.equal(document.rev, 1);
  assert.equal(document.document.byQuid(quid)?.$_tag, "a");
  assert.equal(binding.status, "active", binding.failure?.message);
  assert.equal(raw_node(binding.tree.node, [0, 0, 0, 1]), oldA);
  assert.equal(JSON.stringify(document.root()).includes('"quid"'), false);
  binding.dispose();
});

check("invalid lineage and supplied QUID claims reject without state or ledger changes", () => {
  const invalid: readonly unknown[] = [
    [{ source: [], destination: [] }, { source: [], destination: [0] }],
    [{ source: [], destination: [] }, { source: [0], destination: [] }],
    [{ source: [99], destination: [] }],
    [{ source: [], destination: [99] }],
    [{ source: [-1], destination: [] }],
    [{ source: [0], destination: [] }],
  ];
  for (const [caseIndex, lineage] of invalid.entries()) {
    const document = fixture("00000940");
    const before = JSON.stringify(document.capture());
    const issued = livemap_identity_epoch_accounting(document.document).issued;
    assert.throws(() => apply(document, node("<section <c/>/>"), lineage as LiveMapReplacementLineage), `case ${caseIndex}`);
    assert.equal(JSON.stringify(document.capture()), before);
    assert.equal(document.rev, 0);
    assert.equal(livemap_identity_epoch_accounting(document.document).issued, issued);
  }
  const document = map("<main <a @000009501/>/>");
  const before = JSON.stringify(document.capture());
  assert.throws(() => apply(document, node("<a @000009501/>"), []), /runtime QUID metadata is invalid/i);
  assert.equal(JSON.stringify(document.capture()), before);
  assert.equal(document.rev, 0);
  const partialOracle = fixture("00000980");
  const partialBefore = JSON.stringify(partialOracle.capture());
  assert.throws(() => apply(partialOracle,
    node("<section @000009801 <c @000009804/> <new/> <a/>/>"),
    [lineage_entry([], []), lineage_entry([0, 2], [0, 0]), lineage_entry([0, 0], [0, 2])]),
    /runtime QUID metadata is invalid/i);
  assert.equal(JSON.stringify(partialOracle.capture()), partialBefore);
  assert.equal(partialOracle.rev, 0);
  const collided = map("<main <a @000009711/> <outside @000009712/>/>");
  const collidedBefore = JSON.stringify(collided.capture());
  const collidedIssued = livemap_identity_epoch_accounting(collided.document).issued;
  assert.throws(() => apply(collided, node("<new @000009712/>"), []));
  assert.equal(JSON.stringify(collided.capture()), collidedBefore);
  assert.equal(collided.rev, 0);
  assert.equal(livemap_identity_epoch_accounting(collided.document).issued, collidedIssued);
});

process.stdout.write(`1..${checks}\n`);
events.terminal("pass");
