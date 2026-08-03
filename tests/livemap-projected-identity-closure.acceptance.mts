// @hson-live-external-test
import assert from "node:assert/strict";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import { hson, link_livemap, make_livemap_store_api } from "../src/index.ts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import { collect_hson_node_quid_claims, read_hson_node_quid } from "../src/core/hson-node-quid.ts";
import { resolve_value_node } from "../src/api/livemap/livemap.editor.ts";
import { livemap_projected_identity_accounting } from "../src/api/livemap/livemap.projected.identity.ts";
import { set_livemap_projected_quid_candidate_source_for_tests } from "../src/api/livemap/livemap.projected.identity-handle.ts";
import { make_livehost_canonical_stream } from "../src/api/livehost/livehost.history.ts";
import { make_livehost_recovery_planner } from "../src/api/livehost/livehost.recovery.ts";
import { decode_livehost_canonical_commit } from "../src/api/livehost/livehost.protocol.ts";
import { parse_hson } from "../src/api/transform/parsers/parse-hson.ts";

const Q1 = "0000000000003c01";
let checks = 0;
const check = (name: string, run: () => void) => { run(); checks += 1; process.stdout.write(`ok ${checks} - ${name}\n`); };
const map = (value: unknown) => hson.liveMap.fromJson(value as never);
const quidAt = (owner: ReturnType<typeof map>, path: readonly (string | number)[]) => {
  const node = resolve_value_node(owner.root(), path);
  return node === undefined ? undefined : read_hson_node_quid(node);
};

check("durable exact capture preserves projected container metadata", () => { const a = map({ x: {} }); a.ensureIdentity(["x"]); const b = map({ x: {} }); b.restore(a.capture()); assert.equal(quidAt(b, ["x"]), quidAt(a, ["x"])); });
check("identity stripping removes projected QUID metadata", () => { const a = map({ x: {} }); a.ensureIdentity(["x"]); assert.equal(collect_hson_node_quid_claims(a.capture({ identity: "strip" }).root).length, 0); });
check("copied durable bytes create fresh local handle scope", () => { const a = map({ x: {} }); const h = a.ensureIdentity(["x"]); const b = map({ x: {} }); b.restore(structuredClone(a.capture())); assert.equal(h.active, true); assert.equal(b.ensureIdentity(["x"]).active, true); });
check("registration replay uses the recorded QUID", () => { const a = map({ x: {} }); let commit: unknown; a.commits.observe((e) => { if (e.kind === "commit") commit = e.commit; }); a.ensureIdentity(["x"]); const b = map({ x: {} }); b.replay(commit as never); assert.equal(quidAt(b, ["x"]), quidAt(a, ["x"])); });
check("registration replay never calls the allocator", () => { const a = map({ x: {} }); let commit: unknown; a.commits.observe((e) => { if (e.kind === "commit") commit = e.commit; }); a.ensureIdentity(["x"]); const b = map({ x: {} }); set_livemap_projected_quid_candidate_source_for_tests(b, () => { throw new Error("minted"); }); b.replay(commit as never); assert.equal(b.rev, 1); });
check("malformed replay rejects atomically", () => { const b = map({ x: {} }); assert.throws(() => b.replay({ changed: true, prevRev: 0, rev: 1, ops: [{ domain: "graph", op: "ensure-quid", target: { kind: "path", path: ["x"], projected: true }, quid: "bad" }] } as never)); assert.equal(b.rev, 0); });
check("colliding replay rejects atomically", () => { const b = map({ x: {}, y: {} }); set_livemap_projected_quid_candidate_source_for_tests(b, () => Q1); b.ensureIdentity(["x"]); const before = b.root(); assert.throws(() => b.replay({ changed: true, prevRev: 1, rev: 2, ops: [{ domain: "graph", op: "ensure-quid", target: { kind: "path", path: ["y"], projected: true }, quid: Q1 }] } as never)); assert.equal(canonical_hson_graph_equal(before, b.root()), true); });
check("canonical commit observers see identity registration", () => { const a = map({}); let seen = 0; a.commits.observe((e) => { if (e.kind === "commit" && e.commit.ops[0] && "domain" in e.commit.ops[0]) seen += 1; }); a.ensureIdentity([]); assert.equal(seen, 1); });
check("projected feeds do not publish hidden metadata-only changes", () => { const a = map({ x: {} }); let seen = 0; a.feed(["x"], () => seen += 1); a.ensureIdentity(["x"]); assert.equal(seen, 0); });
check("stores do not publish hidden metadata-only changes", () => { const a = map({ x: {} }); const store = make_livemap_store_api(a); let seen = 0; store.subscribe(() => seen += 1); a.ensureIdentity(["x"]); assert.equal(seen, 0); });
check("links remain projected-value channels and do not claim exact identity", () => { const a = map({ x: {} }); const b = map({ x: {} }); const stop = link_livemap(a, b, { path: ["x"] }); a.ensureIdentity(["x"]); assert.equal(quidAt(b, ["x"]), undefined); stop(); });
check("exact schemas see no unknown identity key", () => { const schema = hson.liveMap.schema.define((s) => s.exact({ x: s.exact({ value: s.number }) })); const a = map({ x: { value: 1 } }).withSchema(schema); a.ensureIdentity(["x"]); assert.deepEqual(a.snap(), { x: { value: 1 } }); });
check("readonly schemas still observe the same projected value", () => { const schema = hson.liveMap.schema.define((s) => s.exact({ x: s.exact({ value: s.number.readonly }) })); const a = map({ x: { value: 1 } }).withSchema(schema); const before = a.snap(); a.ensureIdentity(["x"]); assert.deepEqual(a.snap(), before); assert.equal(a.schema.get(), schema); });
check("map.at remains location-bound after retained value moves", () => { const a = map({ x: {}, y: { next: true } }); const location = a.at(["x"]); const identity = a.ensureIdentity(["x"]); a.at([]).object.renameKey("x", "z"); assert.equal(location.snap(), undefined); assert.deepEqual(identity.path(), ["z"]); });
check("ordinary bindings and subscriptions do not mint", () => { const a = map({ x: {} }); const stop = a.sub.path(["x"], () => {}); a.snap(["x"]); stop(); assert.equal(quidAt(a, ["x"]), undefined); });
check("QUID-free large projected maps retain zero claims", () => { const rows = Array.from({ length: 2000 }, (_, id) => ({ id, nested: {} })); const a = map({ rows }); a.snap(); a.at(["rows"]).array.move(0, 1999); assert.equal(collect_hson_node_quid_claims(a.root()).length, 0); });
check("one explicit acquisition adds only one sparse claim", () => { const rows = Array.from({ length: 1000 }, (_, id) => ({ id })); const a = map({ rows }); a.ensureIdentity(["rows", 500]); assert.equal(collect_hson_node_quid_claims(a.root()).length, 1); });
check("identity-specific reconciliation visits sparse entries", () => { const a = map({ rows: [{}, {}, {}] }); a.ensureIdentity(["rows", 1]); const before = livemap_projected_identity_accounting(); a.at(["rows"]).array.move(1, 2); const after = livemap_projected_identity_accounting(); assert.equal(after.overlayEntriesVisited - before.overlayEntriesVisited, 1); });
check("ordinary projected mutations never allocate identity", () => { const a = map({ x: {}, rows: [{}] }); set_livemap_projected_quid_candidate_source_for_tests(a, () => { throw new Error("minted"); }); a.set(["x"], { value: 1 }); a.at(["rows"]).array.push({}); assert.equal(collect_hson_node_quid_claims(a.root()).length, 0); });
check("document identity acquisition remains unchanged", () => { const doc = hson.liveMap.fromHson("<main/>"); if (doc.mode !== "element") throw new Error("fixture"); const h = doc.document.ensureIdentity({ kind: "path", path: [] }); assert.equal(h.snap()?.$_tag, "main"); });
check("raw QUID bytes expose no projected handle constructor", () => { const a = map({}); a.ensureIdentity([]); assert.equal(Reflect.get(a, "fromQuid"), undefined); assert.equal(Reflect.get(a, "byQuid"), undefined); });
check("metadata-only acquisition leaves exact projected payload unchanged", () => { const a = map({ x: {} }); const before = a.capture().payload; a.ensureIdentity(["x"]); assert.equal(a.capture().payload, before); });
check("LiveHost history carries projected path-authoritative registration", () => { const a = map({ x: {} }); const stream = make_livehost_canonical_stream(a, { logicalMapId: "unit-11", incarnationId: "history" }); a.ensureIdentity(["x"]); const commit = stream.history.replay_after(0)?.[0]; assert.deepEqual(commit?.ops[0], { domain: "graph", op: "ensure-quid", target: { kind: "path", path: ["x"], projected: true }, quid: quidAt(a, ["x"]) }); assert.equal(commit?.format, undefined); });
check("LiveHost decoder admits recorded projected registration without a transport version change", () => { const a = map({ x: [] }); const stream = make_livehost_canonical_stream(a, { logicalMapId: "unit-11", incarnationId: "decode" }); a.ensureIdentity(["x"]); const wire = structuredClone(stream.history.replay_after(0)?.[0]); const decoded = decode_livehost_canonical_commit(wire); assert.deepEqual(decoded?.ops, wire?.ops); });
check("LiveHost HSON recovery preserves projected container metadata as fresh local identity", () => {
  const a = map({ x: {}, y: [] });
  const objectQuid = (a.ensureIdentity(["x"]), quidAt(a, ["x"]));
  const arrayQuid = (a.ensureIdentity(["y"]), quidAt(a, ["y"]));
  const stream = make_livehost_canonical_stream(a, { logicalMapId: "unit-11", incarnationId: "snapshot" });
  const plan = make_livehost_recovery_planner(a, stream).plan({ logicalMapId: stream.logicalMapId });
  if (plan.outcome !== "snapshot" || !("hson" in plan.body)) throw new Error("expected HSON snapshot");
  const b = hson.liveMap.fromNode(parse_hson(plan.body.hson));
  if (b.mode === "element" || b.mode === "fragment") throw new Error("expected projected snapshot");
  const objectNode = resolve_value_node(b.root(), ["x"]);
  const arrayNode = resolve_value_node(b.root(), ["y"]);
  assert.equal(objectNode === undefined ? undefined : read_hson_node_quid(objectNode), objectQuid);
  assert.equal(arrayNode === undefined ? undefined : read_hson_node_quid(arrayNode), arrayQuid);
  assert.equal(b.ensureIdentity(["x"]).active, true);
  assert.equal(b.ensureIdentity(["y"]).active, true);
  plan.dispose();
});

process.stdout.write(`1..${checks}\n`);
emit_hson_live_test_completion("livemap.projected-identity-closure", checks, checks, 0);
