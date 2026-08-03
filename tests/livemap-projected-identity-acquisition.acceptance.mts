// @hson-live-external-test
import assert from "node:assert/strict";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import { hson } from "../src/index.ts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import { is_persisted_quid, read_hson_node_quid } from "../src/core/hson-node-quid.ts";
import { resolve_value_node } from "../src/api/livemap/livemap.editor.ts";
import {
  LIVEMAP_PROJECTED_QUID_MINT_RETRY_LIMIT,
  set_livemap_projected_quid_candidate_source_for_tests,
} from "../src/api/livemap/livemap.projected.identity-handle.ts";

const Q1 = "0000000000003a01";
const Q2 = "0000000000003a02";
let checks = 0;
const check = (name: string, run: () => void) => { run(); checks += 1; process.stdout.write(`ok ${checks} - ${name}\n`); };
const map = (value: unknown) => hson.liveMap.fromJson(value as never);
const quidAt = (owner: ReturnType<typeof map>, path: readonly (string | number)[]) => {
  const node = resolve_value_node(owner.root(), path);
  return node === undefined ? undefined : read_hson_node_quid(node);
};
const code = (expected: string) => (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === expected;

check("projected acquisition has one repository-consistent map-level name", () => {
  const owner = map({});
  assert.equal(typeof owner.ensureIdentity, "function");
  assert.equal(Reflect.get(owner, "retain"), undefined);
  assert.equal(Reflect.get(owner, "fromQuid"), undefined);
});
check("root object acquisition returns an active handle", () => { const h = map({ a: 1 }).ensureIdentity([]); assert.equal(h.active, true); assert.deepEqual(h.path(), []); });
check("root array acquisition returns an active handle", () => { const h = map([1, 2]).ensureIdentity([]); assert.deepEqual(h.snap(), [1, 2]); });
check("nested object acquisition is path based", () => { const h = map({ a: { b: 1 } }).ensureIdentity(["a"]); assert.deepEqual(h.path(), ["a"]); });
check("nested array acquisition is path based", () => { const h = map({ a: [1] }).ensureIdentity(["a"]); assert.deepEqual(h.snap(), [1]); });
check("new registration advances one ordinary revision", () => { const owner = map({}); owner.ensureIdentity([]); assert.equal(owner.rev, 1); });
check("new registration publishes the shared ensure-quid operation", () => {
  const owner = map({}); let op: unknown; owner.commits.observe((e) => { if (e.kind === "commit") op = e.commit.ops[0]; }); owner.ensureIdentity([]);
  assert.deepEqual(op && typeof op === "object" ? (op as { target: unknown }).target : undefined, { kind: "path", path: [], projected: true });
});
check("registration stores a valid 16-character canonical QUID", () => { const owner = map({}); owner.ensureIdentity([]); assert.equal(is_persisted_quid(quidAt(owner, [])), true); });
check("existing registration is a no-op", () => { const owner = map({}); const a = owner.ensureIdentity([]); const rev = owner.rev; let seen = 0; owner.commits.observe(() => seen += 1); const b = owner.ensureIdentity([]); assert.equal(owner.rev, rev); assert.equal(seen, 0); assert.deepEqual(b.path(), a.path()); });
check("projected JavaScript value is unchanged", () => { const owner = map({ a: [1, { b: true }] }); const before = owner.snap(); owner.ensureIdentity(["a", 1]); assert.deepEqual(owner.snap(), before); });
check("metadata changes strict canonical equality", () => { const owner = map({}); const before = owner.root(); owner.ensureIdentity([]); assert.equal(canonical_hson_graph_equal(before, owner.root()), false); });
check("handle snapshots are detached", () => { const owner = map({ a: { b: 1 } }); const value = owner.ensureIdentity(["a"]).snap() as { b: number }; value.b = 2; assert.deepEqual(owner.snap(["a"]), { b: 1 }); });
check("multiple handles may share one identity", () => { const owner = map({}); const a = owner.ensureIdentity([]); const b = owner.ensureIdentity([]); a.dispose(); assert.equal(a.active, false); assert.equal(b.active, true); });
check("disposal does not remove canonical metadata", () => { const owner = map({}); const h = owner.ensureIdentity([]); const quid = quidAt(owner, []); h.dispose(); assert.equal(quidAt(owner, []), quid); });
check("primitive string targets reject", () => assert.throws(() => map({ a: "x" }).ensureIdentity(["a"]), code("PROJECTED_IDENTITY_INELIGIBLE")));
check("primitive number targets reject", () => assert.throws(() => map({ a: 1 }).ensureIdentity(["a"]), code("PROJECTED_IDENTITY_INELIGIBLE")));
check("boolean and null targets reject", () => { assert.throws(() => map({ a: true }).ensureIdentity(["a"])); assert.throws(() => map({ a: null }).ensureIdentity(["a"])); });
check("missing paths reject atomically", () => { const owner = map({}); assert.throws(() => owner.ensureIdentity(["missing"]), code("PROJECTED_IDENTITY_TARGET_NOT_FOUND")); assert.equal(owner.rev, 0); });
check("path input is detached from the handle", () => { const owner = map({ a: {} }); const path: (string | number)[] = ["a"]; const h = owner.ensureIdentity(path); path[0] = "x"; assert.deepEqual(h.path(), ["a"]); });
check("allocator collisions retry against the sparse overlay", () => { const owner = map({ a: {}, b: {} }); set_livemap_projected_quid_candidate_source_for_tests(owner, () => Q1); owner.ensureIdentity(["a"]); let calls = 0; set_livemap_projected_quid_candidate_source_for_tests(owner, () => (++calls === 1 ? Q1 : Q2)); owner.ensureIdentity(["b"]); assert.equal(quidAt(owner, ["b"]), Q2); });
check("allocator exhaustion is atomic", () => { const owner = map({}); let calls = 0; set_livemap_projected_quid_candidate_source_for_tests(owner, () => { calls += 1; return "bad"; }); assert.throws(() => owner.ensureIdentity([]), code("PROJECTED_IDENTITY_ALLOCATOR_EXHAUSTED")); assert.equal(calls, LIVEMAP_PROJECTED_QUID_MINT_RETRY_LIMIT); assert.equal(owner.rev, 0); });
check("passive map.at reads never acquire identity", () => { const owner = map({ a: {} }); owner.at(["a"]).snap(); assert.equal(quidAt(owner, ["a"]), undefined); });

process.stdout.write(`1..${checks}\n`);
emit_hson_live_test_completion("livemap.projected-identity-acquisition", checks, checks, 0);
