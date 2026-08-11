// @hson-live-external-test
import assert from "node:assert/strict";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import { hson } from "../src/index.ts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import { is_persisted_quid, read_hson_node_quid } from "../src/core/hson-node-quid.ts";
import { resolve_value_node } from "../src/api/livemap/livemap.editor.ts";
import { acquire_projected_identity } from "./helpers/livemap-identity-internal.mts";
import {
  LIVEMAP_PROJECTED_QUID_MINT_RETRY_LIMIT,
  set_livemap_projected_quid_candidate_source_for_tests,
} from "../src/api/livemap/livemap.projected.identity-handle.ts";

const Q1 = "000003a01";
const Q2 = "000003a02";
let checks = 0;
const check = (name: string, run: () => void) => { run(); checks += 1; process.stdout.write(`ok ${checks} - ${name}\n`); };
const map = (value: unknown) => hson.liveMap.fromJson(value as never);
const quidAt = (owner: ReturnType<typeof map>, path: readonly (string | number)[]) => {
  const node = resolve_value_node(owner.root(), path);
  return node === undefined ? undefined : read_hson_node_quid(node);
};
const code = (expected: string) => (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === expected;

check("projected identity acquisition is absent from the public façade", () => {
  const owner = map({});
  assert.equal(Reflect.get(owner, "ensureIdentity"), undefined);
  assert.equal(Reflect.get(owner, "retain"), undefined);
  assert.equal(Reflect.get(owner, "fromQuid"), undefined);
});
check("root object acquisition remains available internally", () => { const owner = map({ a: 1 }); const h = acquire_projected_identity(owner, []); assert.equal(h.active, true); assert.deepEqual(h.path(), []); });
check("root array acquisition remains available internally", () => { const owner = map([1, 2]); const h = acquire_projected_identity(owner, []); assert.deepEqual(h.snap(), [1, 2]); });
check("nested object acquisition remains path based internally", () => { const owner = map({ a: { b: 1 } }); const h = acquire_projected_identity(owner, ["a"]); assert.deepEqual(h.path(), ["a"]); });
check("nested array acquisition remains path based internally", () => { const owner = map({ a: [1] }); const h = acquire_projected_identity(owner, ["a"]); assert.deepEqual(h.snap(), [1]); });
check("new registration advances one ordinary revision", () => { const owner = map({}); acquire_projected_identity(owner, []); assert.equal(owner.rev, 1); });
check("new registration publishes the shared ensure-quid operation", () => {
  const owner = map({}); let op: unknown; owner.commits.observe((e) => { if (e.kind === "commit") op = e.commit.ops[0]; }); acquire_projected_identity(owner, []);
  assert.deepEqual(op && typeof op === "object" ? (op as { target: unknown }).target : undefined, { kind: "path", path: [], projected: true });
});
check("registration stores a valid 9-character canonical QUID", () => { const owner = map({}); acquire_projected_identity(owner, []); assert.equal(is_persisted_quid(quidAt(owner, [])), true); });
check("existing registration is a no-op", () => { const owner = map({}); const a = acquire_projected_identity(owner, []); const rev = owner.rev; let seen = 0; owner.commits.observe(() => seen += 1); const b = acquire_projected_identity(owner, []); assert.equal(owner.rev, rev); assert.equal(seen, 0); assert.deepEqual(b.path(), a.path()); });
check("projected JavaScript value is unchanged", () => { const owner = map({ a: [1, { b: true }] }); const before = owner.snap(); acquire_projected_identity(owner, ["a", 1]); assert.deepEqual(owner.snap(), before); });
check("metadata changes strict canonical equality", () => { const owner = map({}); const before = owner.root(); acquire_projected_identity(owner, []); assert.equal(canonical_hson_graph_equal(before, owner.root()), false); });
check("handle snapshots are detached", () => { const owner = map({ a: { b: 1 } }); const value = acquire_projected_identity(owner, ["a"]).snap() as { b: number }; value.b = 2; assert.deepEqual(owner.snap(["a"]), { b: 1 }); });
check("multiple handles may share one identity", () => { const owner = map({}); const a = acquire_projected_identity(owner, []); const b = acquire_projected_identity(owner, []); a.dispose(); assert.equal(a.active, false); assert.equal(b.active, true); });
check("disposal does not remove canonical metadata", () => { const owner = map({}); const h = acquire_projected_identity(owner, []); const quid = quidAt(owner, []); h.dispose(); assert.equal(quidAt(owner, []), quid); });
check("primitive string targets reject", () => { const owner = map({ a: "x" }); assert.throws(() => acquire_projected_identity(owner, ["a"]), code("PROJECTED_IDENTITY_INELIGIBLE")); });
check("primitive number targets reject", () => { const owner = map({ a: 1 }); assert.throws(() => acquire_projected_identity(owner, ["a"]), code("PROJECTED_IDENTITY_INELIGIBLE")); });
check("boolean and null targets reject", () => { const booleanOwner = map({ a: true }); const nullOwner = map({ a: null }); assert.throws(() => acquire_projected_identity(booleanOwner, ["a"])); assert.throws(() => acquire_projected_identity(nullOwner, ["a"])); });
check("missing paths reject atomically", () => { const owner = map({}); assert.throws(() => acquire_projected_identity(owner, ["missing"]), code("PROJECTED_IDENTITY_TARGET_NOT_FOUND")); assert.equal(owner.rev, 0); });
check("path input is detached from the handle", () => { const owner = map({ a: {} }); const path: (string | number)[] = ["a"]; const h = acquire_projected_identity(owner, path); path[0] = "x"; assert.deepEqual(h.path(), ["a"]); });
check("allocator collisions retry against the sparse overlay", () => { const owner = map({ a: {}, b: {} }); set_livemap_projected_quid_candidate_source_for_tests(owner, () => Q1); acquire_projected_identity(owner, ["a"]); let calls = 0; set_livemap_projected_quid_candidate_source_for_tests(owner, () => (++calls === 1 ? Q1 : Q2)); acquire_projected_identity(owner, ["b"]); assert.equal(quidAt(owner, ["b"]), Q2); });
check("allocator exhaustion is atomic", () => { const owner = map({}); let calls = 0; set_livemap_projected_quid_candidate_source_for_tests(owner, () => { calls += 1; return "bad"; }); assert.throws(() => acquire_projected_identity(owner, []), code("PROJECTED_IDENTITY_ALLOCATOR_EXHAUSTED")); assert.equal(calls, LIVEMAP_PROJECTED_QUID_MINT_RETRY_LIMIT); assert.equal(owner.rev, 0); });
check("passive map.at reads never acquire identity", () => { const owner = map({ a: {} }); owner.at(["a"]).snap(); assert.equal(quidAt(owner, ["a"]), undefined); });

process.stdout.write(`1..${checks}\n`);
emit_hson_live_test_completion("livemap.projected-identity-acquisition", checks, checks, 0);
