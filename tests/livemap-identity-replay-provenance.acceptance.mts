// @hson-live-external-test
import assert from "node:assert/strict";
import { create_test_event_emitter } from "./test-events.mjs";
import { hson } from "../src/index.ts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import { livemap_identity_epoch_accounting } from "../src/api/livemap/livemap.identity-epoch.ts";
import { set_livemap_projected_quid_candidate_source_for_tests } from "../src/api/livemap/livemap.projected.identity-handle.ts";
import { set_livemap_document_quid_candidate_source_for_tests } from "../src/api/livemap/livemap.document.registration.ts";
import { element } from "./helpers/mirror-unit6.mts";
import { validate_document_path } from "../src/api/livemap/livemap.document.path.ts";
import { acquire_document_identity, acquire_projected_identity } from "./helpers/livemap-identity-internal.mts";

const Q1 = "000004c01";
const Q2 = "000004c02";
const Q3 = "000004c03";
export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.identity-replay-provenance",
  title: "Identity replay and provenance ABA closure",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["projected-value", "document", "quid", "identity-handle", "replay", "provenance", "externally-discoverable"]),
});

const testEvents = create_test_event_emitter("livemap.identity-replay-provenance");
let checks = 0;
const check = (name: string, run: () => void) => {
  testEvents.case_begin(name, name);
  try {
    run();
    testEvents.case_end(name, "pass");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Check failed.";
    testEvents.diagnostic(name, "assertion", message.slice(0, 1_000));
    testEvents.case_end(name, "fail");
    testEvents.terminal("fail");
    throw error;
  } checks += 1; process.stdout.write(`ok ${checks} - ${name}\n`); };
const map = (value: unknown) => hson.liveMap.fromJson(value as never);
const target = (...path: number[]) => Object.freeze({ kind: "path" as const, path: Object.freeze([0, ...path]) });
const projectedEnsure = (prevRev: number, path: readonly (string | number)[], quid: string) => ({ changed: true, prevRev, rev: prevRev + 1, ops: [{ domain: "graph", op: "ensure-quid", target: { kind: "path", path, projected: true }, quid }] });
const graphCommit = (prevRev: number, ops: readonly unknown[]) => ({ changed: true, prevRev, rev: prevRev + 1, ops });
const ensure = (path: readonly number[], quid: string) => ({ domain: "graph", op: "ensure-quid", target: { kind: "path", path }, quid });
const remove = (path: readonly number[], index: number) => ({ domain: "graph", op: "remove-content", target: { kind: "path", path }, index });
const ordinary = (tag: string, quid?: string) => ({ $_tag: tag, ...(quid === undefined ? {} : { $_meta: { quid } }), $_content: [] });
const code = (expected: string) => (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === expected;
const reasonCode = (expected: string) => (error: unknown) => typeof error === "object" && error !== null && "reasonCode" in error && error.reasonCode === expected;

check("projected replay rejects a retired QUID claim before allocation", () => { const m = map({ a: {}, b: {} }); set_livemap_projected_quid_candidate_source_for_tests(m, () => Q1); acquire_projected_identity(m, ["a"]); m.delete(["a"]); const before = m.root(); const rev = m.rev; assert.throws(() => m.replay(projectedEnsure(rev, ["b"], Q1) as never), reasonCode("INVALID_REPLAY_ENVELOPE")); assert.equal(canonical_hson_graph_equal(before, m.root()), true); assert.equal(m.rev, rev); });
check("projected replay rejection never invokes the allocator", () => { const m = map({ a: {}, b: {} }); set_livemap_projected_quid_candidate_source_for_tests(m, () => Q1); acquire_projected_identity(m, ["a"]); m.delete(["a"]); set_livemap_projected_quid_candidate_source_for_tests(m, () => { throw new Error("allocator called"); }); assert.throws(() => m.replay(projectedEnsure(m.rev, ["b"], Q1) as never), reasonCode("INVALID_REPLAY_ENVELOPE")); });
check("projected replay rejects an active QUID claim", () => { const m = map({ a: {}, b: {} }); set_livemap_projected_quid_candidate_source_for_tests(m, () => Q1); acquire_projected_identity(m, ["a"]); assert.throws(() => m.replay(projectedEnsure(m.rev, ["b"], Q1) as never), reasonCode("INVALID_REPLAY_ENVELOPE")); });
check("document replay rejects a retired QUID claim", () => { const m = element(`<main <a/> <b/>/>`); set_livemap_document_quid_candidate_source_for_tests(m.document, () => Q1); acquire_document_identity(m.document, target(0, 0)); m.document.content.remove(target(0), 0); const before = m.root(); const rev = m.rev; assert.throws(() => m.replay(graphCommit(rev, [ensure([0, 0, 0], Q1)]) as never), reasonCode("INVALID_REPLAY_ENVELOPE")); assert.equal(canonical_hson_graph_equal(before, m.root()), true); assert.equal(m.rev, rev); });
check("incoming insertion rejects supplied QUID identity", () => { const m = element(`<main <a/> <b/>/>`); set_livemap_document_quid_candidate_source_for_tests(m.document, () => Q1); acquire_document_identity(m.document, target(0, 0)); m.document.content.remove(target(0), 0); const rev = m.rev; assert.throws(() => m.document.content.insert(target(0), 1, ordinary("i", Q1)), code("PORTABLE_RUNTIME_QUID_FORBIDDEN")); assert.equal(m.rev, rev); });
check("incoming replacement rejects supplied QUID identity", () => { const m = element(`<main <a/> <b/>/>`); set_livemap_document_quid_candidate_source_for_tests(m.document, () => Q1); acquire_document_identity(m.document, target(0, 0)); m.document.content.remove(target(0), 0); const rev = m.rev; assert.throws(() => m.document.content.replace(target(0), 0, ordinary("c", Q1)), code("PORTABLE_RUNTIME_QUID_FORBIDDEN")); assert.equal(m.rev, rev); });
check("replacement lineage explicitly preserves a local QUID lifetime", () => { const m = element(`<main <a @${Q1}/> <b/>/>`); m.document.content.replace(target(0), 0, ordinary("i"), [{ source: validate_document_path([]), destination: validate_document_path([]) }]); assert.equal(m.document.byQuid(Q1)?.$_tag, "i"); assert.equal(livemap_identity_epoch_accounting(m).issued, 1); });
check("document ingress rejects supplied active QUID identity", () => { const m = element(`<main <a/> <b/>/>`); set_livemap_document_quid_candidate_source_for_tests(m.document, () => Q1); acquire_document_identity(m.document, target(0, 0)); assert.throws(() => m.document.content.insert(target(0), 2, ordinary("i", Q1)), code("PORTABLE_RUNTIME_QUID_FORBIDDEN")); });
check("malformed data identity replay remains atomic", () => { const m = map({ x: {} }); const before = m.root(); assert.throws(() => m.replay(projectedEnsure(0, ["x"], "bad") as never)); assert.equal(canonical_hson_graph_equal(before, m.root()), true); assert.equal(livemap_identity_epoch_accounting(m).issued, 0); });
check("multi-operation replay rejects ensure-quid atomically", () => { const m = element(`<main <a/> <b/>/>`); const commit = graphCommit(0, [ensure([0, 0, 0], Q1), remove([0, 0], 0), ensure([0, 0, 0], Q1)]); const before = m.root(); assert.throws(() => m.replay(commit as never), reasonCode("INVALID_REPLAY_ENVELOPE")); assert.equal(canonical_hson_graph_equal(before, m.root()), true); assert.deepEqual(livemap_identity_epoch_accounting(m), { epoch: 0, issued: 0 }); });
check("public replay cannot publish staged QUID reservations", () => { const m = element(`<main <a/> <b/>/>`); const commit = graphCommit(0, [ensure([0, 0, 0], Q1), remove([0, 0], 0), ensure([0, 0, 0], Q2)]); const before = m.root(); assert.throws(() => m.replay(commit as never), reasonCode("INVALID_REPLAY_ENVELOPE")); assert.equal(canonical_hson_graph_equal(before, m.root()), true); assert.equal(livemap_identity_epoch_accounting(m).issued, 0); });
check("a later invalid replay operation publishes no issued reservations", () => { const m = element(`<main <a/> <b/>/>`); const commit = graphCommit(0, [ensure([0, 0, 0], Q1), remove([0, 0], 99)]); assert.throws(() => m.replay(commit as never)); assert.equal(m.rev, 0); assert.equal(livemap_identity_epoch_accounting(m).issued, 0); });
check("portable projected restore creates an empty fresh identity epoch", () => { const source = map({ x: {} }); set_livemap_projected_quid_candidate_source_for_tests(source, () => Q1); acquire_projected_identity(source, ["x"]); const m = map({}); m.restore(source.capture()); assert.deepEqual(livemap_identity_epoch_accounting(m), { epoch: 1, issued: 0 }); });
check("portable document restore creates an empty fresh identity epoch", () => { const m = element(`<main/>`); m.restore(element(`<article @${Q1}/>`).capture()); assert.deepEqual(livemap_identity_epoch_accounting(m), { epoch: 1, issued: 0 }); });
check("exact same-epoch restoration of captured identity succeeds", () => { const m = map({ a: {}, b: {} }); set_livemap_projected_quid_candidate_source_for_tests(m, () => Q1); const h = acquire_projected_identity(m, ["a"]); const capture = m.capture({ identity: "same-epoch" }); m.delete(["a"]); m.restore(capture, { identity: "same-epoch" }); assert.equal(h.active, true); assert.deepEqual(h.path(), ["a"]); assert.equal(livemap_identity_epoch_accounting(m).issued, 1); });
check("copied same-content capture cannot claim the restoration exception", () => { const m = map({ a: {} }); acquire_projected_identity(m, ["a"]); const capture = m.capture({ identity: "same-epoch" }); assert.throws(() => m.restore({ ...capture }, { identity: "same-epoch" })); });
check("foreign same-epoch capture cannot claim the restoration exception", () => { const a = map({ x: {} }); const b = map({ x: {} }); const capture = a.capture({ identity: "same-epoch" }); assert.throws(() => b.restore(capture, { identity: "same-epoch" })); });
check("same-epoch ledger retains QUIDs issued after capture time", () => { const m = map({ a: {}, b: {} }); set_livemap_projected_quid_candidate_source_for_tests(m, () => Q1); acquire_projected_identity(m, ["a"]); const capture = m.capture({ identity: "same-epoch" }); set_livemap_projected_quid_candidate_source_for_tests(m, () => Q2); acquire_projected_identity(m, ["b"]); m.restore(capture, { identity: "same-epoch" }); assert.equal(livemap_identity_epoch_accounting(m).issued, 2); });
check("post-capture bytes remain allocator-occupied after same-epoch restore", () => { const m = map({ a: {}, b: {} }); set_livemap_projected_quid_candidate_source_for_tests(m, () => Q1); acquire_projected_identity(m, ["a"]); const capture = m.capture({ identity: "same-epoch" }); set_livemap_projected_quid_candidate_source_for_tests(m, () => Q2); acquire_projected_identity(m, ["b"]); m.restore(capture, { identity: "same-epoch" }); let calls = 0; set_livemap_projected_quid_candidate_source_for_tests(m, () => ++calls === 1 ? Q2 : Q3); acquire_projected_identity(m, ["b"]); assert.equal(calls, 2); });
check("identity stripping crosses a durable new-epoch boundary", () => { const m = map({ x: {} }); acquire_projected_identity(m, ["x"]); m.restore(m.capture({ identity: "strip" }), { identity: "strip" }); assert.deepEqual(livemap_identity_epoch_accounting(m), { epoch: 1, issued: 0 }); });
check("durable capture does not serialize retired issued ledger entries", () => { const m = map({ x: {} }); set_livemap_projected_quid_candidate_source_for_tests(m, () => Q1); acquire_projected_identity(m, ["x"]); m.delete(["x"]); const serialized = JSON.stringify(m.capture()); assert.equal(serialized.includes(Q1), false); assert.equal(serialized.includes("issued"), false); });


check("independent LiveMap epochs may carry equal QUID bytes", () => { const a = map({ x: {} }); const b = map({ x: {} }); set_livemap_projected_quid_candidate_source_for_tests(a, () => Q1); set_livemap_projected_quid_candidate_source_for_tests(b, () => Q1); acquire_projected_identity(a, ["x"]); acquire_projected_identity(b, ["x"]); assert.equal(livemap_identity_epoch_accounting(a).issued, 1); assert.equal(livemap_identity_epoch_accounting(b).issued, 1); });

process.stdout.write(`1..${checks}\n`);
testEvents.terminal("pass");
