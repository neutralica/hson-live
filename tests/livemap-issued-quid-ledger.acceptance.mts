// @hson-live-external-test
import assert from "node:assert/strict";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import { hson } from "../src/index.ts";
import { collect_hson_node_quid_claims, PERSISTED_QUID_ALPHABET } from "../src/core/hson-node-quid.ts";
import { livemap_identity_epoch_accounting } from "../src/api/livemap/livemap.identity-epoch.ts";
import { set_livemap_projected_quid_candidate_source_for_tests } from "../src/api/livemap/livemap.projected.identity-handle.ts";
import { set_livemap_document_quid_candidate_source_for_tests } from "../src/api/livemap/livemap.document.registration.ts";
import { element } from "./helpers/reflect-unit6.mts";
import { acquire_document_identity, acquire_projected_identity } from "./helpers/livemap-identity-internal.mts";
import type { HsonNode } from "../src/core/types.ts";

const Q1 = "000004p01";
const Q2 = "000004p02";
const Q3 = "000004p03";
let checks = 0;
const check = (name: string, run: () => void) => { run(); checks += 1; process.stdout.write(`ok ${checks} - ${name}\n`); };
const map = (value: unknown) => hson.liveMap.fromJson(value as never);
const target = (...path: number[]) => Object.freeze({ kind: "path" as const, path: Object.freeze(path) });
const active = (owner: { root: () => HsonNode }) => collect_hson_node_quid_claims(owner.root()).length;
const state = (owner: object) => livemap_identity_epoch_accounting(owner);

check("a QUID-free projected epoch starts with Q=0 and I=0", () => { const m = map({}); assert.equal(active(m), 0); assert.deepEqual(state(m), { epoch: 0, issued: 0 }); });
check("a QUID-free document epoch starts with Q=0 and I=0", () => { const m = element(`<main/>`); assert.equal(active(m), 0); assert.deepEqual(state(m), { epoch: 0, issued: 0 }); });
check("initial projected metadata seeds active and issued state", () => { const source = map({ x: {} }); set_livemap_projected_quid_candidate_source_for_tests(source, () => Q1); acquire_projected_identity(source, ["x"]); const m = map({}); m.restore(source.capture()); assert.equal(active(m), 1); assert.equal(state(m).issued, 1); });
check("initial document metadata seeds active and issued state", () => { const m = element(`<main @${Q1}/>`); assert.equal(active(m), 1); assert.equal(state(m).issued, 1); });
check("first projected allocation enters active and issued state", () => { const m = map({ x: {} }); set_livemap_projected_quid_candidate_source_for_tests(m, () => Q1); acquire_projected_identity(m, ["x"]); assert.equal(active(m), 1); assert.equal(state(m).issued, 1); });
check("projected retirement removes Q but retains I", () => { const m = map({ x: {} }); set_livemap_projected_quid_candidate_source_for_tests(m, () => Q1); acquire_projected_identity(m, ["x"]); m.delete(["x"]); assert.equal(active(m), 0); assert.equal(state(m).issued, 1); });
check("document retirement removes Q but retains I", () => { const m = element(`<main <a/> <b/>/>`); set_livemap_document_quid_candidate_source_for_tests(m.document, () => Q1); acquire_document_identity(m.document, target(0, 0)); m.document.content.remove(target(0), 0); assert.equal(active(m), 0); assert.equal(state(m).issued, 1); });
check("a projected allocator retries a retired candidate", () => { const m = map({ a: {}, b: {} }); set_livemap_projected_quid_candidate_source_for_tests(m, () => Q1); acquire_projected_identity(m, ["a"]); m.delete(["a"]); let calls = 0; set_livemap_projected_quid_candidate_source_for_tests(m, () => ++calls === 1 ? Q1 : Q2); acquire_projected_identity(m, ["b"]); assert.equal(calls, 2); assert.equal(state(m).issued, 2); });
check("a document allocator retries a retired candidate", () => { const m = element(`<main <a/> <b/>/>`); set_livemap_document_quid_candidate_source_for_tests(m.document, () => Q1); acquire_document_identity(m.document, target(0, 0)); m.document.content.remove(target(0), 0); let calls = 0; set_livemap_document_quid_candidate_source_for_tests(m.document, () => ++calls === 1 ? Q1 : Q2); acquire_document_identity(m.document, target(0, 0)); assert.equal(calls, 2); assert.equal(state(m).issued, 2); });
check("multiple projected retirements grow I monotonically", () => { const m = map({ a: {}, b: {}, c: {} }); for (const [path, quid] of [["a", Q1], ["b", Q2], ["c", Q3]] as const) { set_livemap_projected_quid_candidate_source_for_tests(m, () => quid); acquire_projected_identity(m, [path]); m.delete([path]); } assert.equal(active(m), 0); assert.equal(state(m).issued, 3); });
check("active Q remains a subset of issued I", () => { const m = map({ a: {}, b: {} }); set_livemap_projected_quid_candidate_source_for_tests(m, () => Q1); acquire_projected_identity(m, ["a"]); set_livemap_projected_quid_candidate_source_for_tests(m, () => Q2); acquire_projected_identity(m, ["b"]); m.delete(["a"]); assert.equal(active(m), 1); assert.equal(state(m).issued, 2); });
check("disposing a handle changes neither Q nor I", () => { const m = map({ x: {} }); const h = acquire_projected_identity(m, ["x"]); const before = state(m); h.dispose(); assert.equal(active(m), 1); assert.deepEqual(state(m), before); });
check("multiple handles allocate only one issued QUID", () => { const m = map({ x: {} }); acquire_projected_identity(m, ["x"]); acquire_projected_identity(m, ["x"]); assert.equal(active(m), 1); assert.equal(state(m).issued, 1); });
check("allocator exhaustion publishes no issued state", () => { const m = map({}); set_livemap_projected_quid_candidate_source_for_tests(m, () => "bad"); assert.throws(() => acquire_projected_identity(m, [])); assert.deepEqual(state(m), { epoch: 0, issued: 0 }); });
check("a failed projected batch leaves issued state unchanged", () => { const m = map({ x: {} }); acquire_projected_identity(m, ["x"]); const before = state(m); assert.throws(() => m.batch((tx) => { tx.delete(["x"]); tx.set(["missing"], 1); })); assert.deepEqual(state(m), before); assert.equal(active(m), 1); });
check("a projected root replacement creates a fresh empty ledger", () => { const m = map({ x: {} }); set_livemap_projected_quid_candidate_source_for_tests(m, () => Q1); const h = acquire_projected_identity(m, ["x"]); m.replace({ y: {} }); assert.equal(h.active, false); assert.deepEqual(state(m), { epoch: 1, issued: 0 }); });
check("a fresh projected epoch may issue bytes used by the old epoch", () => { const m = map({ x: {} }); set_livemap_projected_quid_candidate_source_for_tests(m, () => Q1); const old = acquire_projected_identity(m, ["x"]); m.replace({ y: {} }); set_livemap_projected_quid_candidate_source_for_tests(m, () => Q1); const fresh = acquire_projected_identity(m, ["y"]); assert.equal(fresh.active, true); assert.equal(old.active, false); assert.equal(state(m).issued, 1); });
check("durable document restore seeds a fresh epoch from active claims", () => { const m = element(`<main/>`); const source = element(`<article @${Q1}/>`); m.restore(source.capture()); assert.deepEqual(state(m), { epoch: 1, issued: 1 }); });
check("identity-stripped durable restore seeds an empty new ledger", () => { const m = element(`<main @${Q1}/>`); m.restore(m.capture({ identity: "strip" })); assert.deepEqual(state(m), { epoch: 1, issued: 0 }); });
check("same-epoch restore never rolls the issued ledger back", () => { const m = map({ a: {}, b: {} }); set_livemap_projected_quid_candidate_source_for_tests(m, () => Q1); acquire_projected_identity(m, ["a"]); const capture = m.capture({ identity: "same-epoch" }); set_livemap_projected_quid_candidate_source_for_tests(m, () => Q2); acquire_projected_identity(m, ["b"]); m.restore(capture, { identity: "same-epoch" }); assert.equal(active(m), 1); assert.equal(state(m).issued, 2); });
check("a post-capture QUID remains reserved after same-epoch restore", () => { const m = map({ a: {}, b: {} }); set_livemap_projected_quid_candidate_source_for_tests(m, () => Q1); acquire_projected_identity(m, ["a"]); const capture = m.capture({ identity: "same-epoch" }); set_livemap_projected_quid_candidate_source_for_tests(m, () => Q2); acquire_projected_identity(m, ["b"]); m.restore(capture, { identity: "same-epoch" }); let calls = 0; set_livemap_projected_quid_candidate_source_for_tests(m, () => ++calls === 1 ? Q2 : Q3); acquire_projected_identity(m, ["b"]); assert.equal(calls, 2); assert.equal(state(m).issued, 3); });
check("bounded acquire-retire cycles retain O(I) strings and no active claims", () => { const m = map({ slot: {} }); for (let i = 0; i < 25; i += 1) { const quid = `00000000${PERSISTED_QUID_ALPHABET[i]}`; set_livemap_projected_quid_candidate_source_for_tests(m, () => quid); acquire_projected_identity(m, ["slot"]); m.delete(["slot"]); if (i !== 24) m.at([]).object.setKey("slot", {}); } assert.equal(active(m), 0); assert.equal(state(m).issued, 25); });

process.stdout.write(`1..${checks}\n`);
emit_hson_live_test_completion("livemap.issued-quid-ledger", checks, checks, 0);
