// @hson-live-external-test
import assert from "node:assert/strict";
import { create_test_event_emitter } from "./test-events.mjs";
import { Hson, hson } from "../src/index.ts";
import type { JsonValue } from "../src/core/types.ts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import { is_persisted_quid, scan_hson_node_quids } from "../src/core/hson-node-quid.ts";
import { acquire_projected_identity } from "./helpers/livemap-identity-internal.mts";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";
import {
  LIVEMAP_PROJECTED_QUID_MINT_RETRY_LIMIT,
  set_livemap_projected_quid_candidate_source_for_tests,
} from "../src/api/livemap/livemap.projected.identity-handle.ts";

const Q1 = "000003a01";
const Q2 = "000003a02";
export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.projected-identity-acquisition",
  title: "Internal sparse data identity acquisition",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["projected-value", "quid", "identity-handle", "authority", "externally-discoverable"]),
});

const testEvents = create_test_event_emitter("livemap.projected-identity-acquisition");
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
const ObjectSchema = Hson.schema`<type "data" content <a <optional "any"> b <optional "any">>>`;
const ArraySchema = Hson.schema`<type "data" defs <Root <array "any">> content <ref "Root">>`;
const map = (value: JsonValue) => hson.liveMap.fromLibraries({ state: { data: value, schema: Array.isArray(value) ? ArraySchema : ObjectSchema } });
const code = (expected: string) => (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === expected;

check("data identity acquisition is absent from the public façade", () => {
  const owner = map({});
  assert.equal(Reflect.get(owner, "ensureIdentity"), undefined);
  assert.equal(Reflect.get(owner, "retain"), undefined);
  assert.equal(Reflect.get(owner, "fromQuid"), undefined);
});
check("root object acquisition remains available internally", () => { const owner = map({ a: 1 }); const h = acquire_projected_identity(owner.lib("state"), []); assert.equal(h.active, true); assert.deepEqual(h.path(), []); });
check("root array acquisition remains available internally", () => { const owner = map([1, 2]); const h = acquire_projected_identity(owner.lib("state"), []); assert.deepEqual(h.snap(), [1, 2]); });
check("nested object acquisition remains path based internally", () => { const owner = map({ a: { b: 1 } }); const h = acquire_projected_identity(owner.lib("state"), ["a"]); assert.deepEqual(h.path(), ["a"]); });
check("nested array acquisition remains path based internally", () => { const owner = map({ a: [1] }); const h = acquire_projected_identity(owner.lib("state"), ["a"]); assert.deepEqual(h.snap(), [1]); });
check("new registration leaves the ordinary revision unchanged", () => { const owner = map({}); acquire_projected_identity(owner.lib("state"), []); assert.equal(owner.rev, 0); });
check("new registration publishes no application commit", () => {
  const owner = map({}); let commits = 0; owner.commits.observe(() => { commits += 1; }); acquire_projected_identity(owner.lib("state"), []);
  assert.equal(commits, 0);
});
check("registration allocates a valid 9-character overlay QUID", () => { const owner = map({}); set_livemap_projected_quid_candidate_source_for_tests(owner.lib("state"), () => Q1); acquire_projected_identity(owner.lib("state"), []); assert.equal(is_persisted_quid(Q1), true); assert.deepEqual(internal_livemap_aggregate_authority(owner).resolveQuid(Q1)?.path, []); });
check("existing registration is a no-op", () => { const owner = map({}); const a = acquire_projected_identity(owner.lib("state"), []); const rev = owner.rev; let seen = 0; owner.commits.observe(() => seen += 1); const b = acquire_projected_identity(owner.lib("state"), []); assert.equal(owner.rev, rev); assert.equal(seen, 0); assert.deepEqual(b.path(), a.path()); });
check("projected JavaScript value is unchanged", () => { const owner = map({ a: [1, { b: true }] }); const before = owner.lib("state").snap(); acquire_projected_identity(owner.lib("state"), ["a", 1]); assert.deepEqual(owner.lib("state").snap(), before); });
check("overlay acquisition leaves canonical graph equality unchanged", () => { const owner = map({}); const before = owner.lib("state").root(); acquire_projected_identity(owner.lib("state"), []); assert.equal(canonical_hson_graph_equal(before, owner.lib("state").root()), true); assert.equal(scan_hson_node_quids(owner.lib("state").root()).size, 0); });
check("handle snapshots are detached", () => { const owner = map({ a: { b: 1 } }); const value = acquire_projected_identity(owner.lib("state"), ["a"]).snap() as { b: number }; value.b = 2; assert.deepEqual(owner.lib("state").snap(["a"]), { b: 1 }); });
check("multiple handles may share one identity", () => { const owner = map({}); const a = acquire_projected_identity(owner.lib("state"), []); const b = acquire_projected_identity(owner.lib("state"), []); a.dispose(); assert.equal(a.active, false); assert.equal(b.active, true); });
check("disposal does not remove the shared overlay claim", () => { const owner = map({}); const h = acquire_projected_identity(owner.lib("state"), []); h.dispose(); const rev = owner.rev; const replacement = acquire_projected_identity(owner.lib("state"), []); assert.equal(replacement.active, true); assert.equal(owner.rev, rev); });
check("primitive string targets reject", () => { const owner = map({ a: "x" }); assert.throws(() => acquire_projected_identity(owner.lib("state"), ["a"]), code("PROJECTED_IDENTITY_INELIGIBLE")); });
check("primitive number targets reject", () => { const owner = map({ a: 1 }); assert.throws(() => acquire_projected_identity(owner.lib("state"), ["a"]), code("PROJECTED_IDENTITY_INELIGIBLE")); });
check("boolean and null targets reject", () => { const booleanOwner = map({ a: true }); const nullOwner = map({ a: null }); assert.throws(() => acquire_projected_identity(booleanOwner.lib("state"), ["a"])); assert.throws(() => acquire_projected_identity(nullOwner.lib("state"), ["a"])); });
check("missing paths reject atomically", () => { const owner = map({}); assert.throws(() => acquire_projected_identity(owner.lib("state"), ["missing"]), code("PROJECTED_IDENTITY_TARGET_NOT_FOUND")); assert.equal(owner.rev, 0); });
check("path input is detached from the handle", () => { const owner = map({ a: {} }); const path: (string | number)[] = ["a"]; const h = acquire_projected_identity(owner.lib("state"), path); path[0] = "x"; assert.deepEqual(h.path(), ["a"]); });
check("allocator collisions retry against the sparse overlay", () => { const owner = map({ a: {}, b: {} }); set_livemap_projected_quid_candidate_source_for_tests(owner.lib("state"), () => Q1); acquire_projected_identity(owner.lib("state"), ["a"]); let calls = 0; set_livemap_projected_quid_candidate_source_for_tests(owner.lib("state"), () => (++calls === 1 ? Q1 : Q2)); acquire_projected_identity(owner.lib("state"), ["b"]); assert.deepEqual(internal_livemap_aggregate_authority(owner).resolveQuid(Q2)?.path, ["b"]); });
check("allocator exhaustion is atomic", () => { const owner = map({}); let calls = 0; set_livemap_projected_quid_candidate_source_for_tests(owner.lib("state"), () => { calls += 1; return "bad"; }); assert.throws(() => acquire_projected_identity(owner.lib("state"), []), code("PROJECTED_IDENTITY_ALLOCATOR_EXHAUSTED")); assert.equal(calls, LIVEMAP_PROJECTED_QUID_MINT_RETRY_LIMIT); assert.equal(owner.rev, 0); });
check("passive map.at reads never acquire identity", () => { const owner = map({ a: {} }); owner.lib("state").at(["a"]).snap(); assert.equal(owner.rev, 0); assert.equal(scan_hson_node_quids(owner.lib("state").root()).size, 0); });

process.stdout.write(`1..${checks}\n`);
testEvents.terminal("pass");
