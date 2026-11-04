import assert from "node:assert/strict";
import { isMainThread, parentPort } from "node:worker_threads";
import { ANY_DATA, Hson, hsonLiveMap, enable_interactions } from "../src/index.ts";
import { HsonSchema } from "../src/api/schema/hson-schema.ts";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";
import { registry_from_entries, type HostedAggregateCommit, type HostedRegistry } from "../src/api/livemap/livemap.hosted.ts";
import { make_locus_hosted_projection_policy, normalize_locus_effective_projection, type LocusEffectiveProjection } from "../src/api/locus/locus.projection.ts";
import { projected_registry_digest, project_locus_live_transition_internal } from "../src/api/locus/locus.live-projection.ts";
import { locus_map_internal } from "../src/internal/governor-maps.ts";
import { MemoryCheckpointAdapter } from "./helpers/memory-checkpoint-adapter.mts";
import { repository_typescript_worker } from "./helpers/repository-typescript-worker.mts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "locus.projected-registry-reuse", title: "Immutable projected registry digest reuse",
  category: "Locus", runtime: "node", tags: Object.freeze(["projection", "schema", "authority", "topology", "worker", "recovery"]),
});

const Count = Hson.schema`<type "data" content <count "number">>`;
const map = hsonLiveMap.fromLibraries({ a: { data: { count: 0 }, schema: Count }, b: { data: { count: 0 }, schema: Count },
  page: { document: "<main/>" } });
enable_interactions(map);
const engine = internal_livemap_aggregate_authority(map);
function policy(registry = engine.hostedRegistry(), writableDocuments: readonly string[] = []) {
  return make_locus_hosted_projection_policy(registry, engine.hostedPosition().authority,
    registry.libraries.filter(entry => entry.scope !== "hson-internal").map(entry => ({ name: entry.name, ownership: "shared" })),
    undefined, () => ({ libraries: ["a", "b", "page", "extra"], writableDocuments, systemFeatures: ["interactions"] }));
}
const sourceAdmission = HsonSchema.fromHson;
let calls = 0;
HsonSchema.fromHson = function (source) { calls++; return sourceAdmission.call(this, source); };
let checks = 0;
function uncached(effective: LocusEffectiveProjection): string {
  // A structurally identical frozen clone has no internal ownership. It must
  // execute the original complete computation, including on its second use.
  return projected_registry_digest(Object.freeze({ ...effective }));
}
try {
  const both = await normalize_locus_effective_projection(policy(), { libraries: ["a", "b"] });
  calls = 0;
  const digest = projected_registry_digest(both);
  assert.equal(calls, 4, "first use admits each Schema in bindings and registry construction");
  calls = 0;
  for (let n = 0; n < 5; n++) assert.equal(projected_registry_digest(both), digest);
  assert.equal(calls, 0);
  const clone = Object.freeze({ ...both });
  assert.equal(projected_registry_digest(clone), digest);
  assert.equal(projected_registry_digest(clone), digest);
  assert.equal(calls, 8, "frozen callers never acquire cache authority");
  checks++;

  const retry = await normalize_locus_effective_projection(policy(), { libraries: ["b"] });
  const failure = new TypeError("first-use Schema admission failure");
  HsonSchema.fromHson = () => { throw failure; };
  assert.throws(() => projected_registry_digest(retry), error => error === failure);
  HsonSchema.fromHson = function (source) { calls++; return sourceAdmission.call(this, source); };
  calls = 0;
  assert.equal(projected_registry_digest(retry), uncached(retry));
  assert.equal(calls, 4, "failed first use does not cache a result");
  checks++;

  for (const libraries of [["a"], ["a", "b"], ["b"], []]) {
    const next = await normalize_locus_effective_projection(policy(), { libraries });
    calls = 0;
    const current = projected_registry_digest(next);
    assert.equal(calls, libraries.length * 2, "each new selection owns its first computation");
    assert.equal(current, uncached(next));
    assert.equal(current === digest, libraries.length === 2);
  }
  const readOnly = await normalize_locus_effective_projection(policy(), { libraries: ["page"] });
  const writable = await normalize_locus_effective_projection(policy(undefined, ["page"]), { libraries: ["page"] });
  assert.notEqual(readOnly.digest, writable.digest);
  projected_registry_digest(readOnly);
  calls = 0;
  assert.equal(projected_registry_digest(writable), uncached(writable));
  assert.equal(calls, 4, "equal registry content with different rights is independently prepared");
  const plain = await normalize_locus_effective_projection(policy(), { libraries: ["a"] });
  const system = await normalize_locus_effective_projection(policy(), { libraries: ["a"], systemFeatures: ["interactions"] });
  assert.notEqual(projected_registry_digest(plain), projected_registry_digest(system));
  assert.equal(projected_registry_digest(system), uncached(system));
  const other = hsonLiveMap.fromLibraries({ a: { data: "different root mode and Schema" } });
  const otherEngine = internal_livemap_aggregate_authority(other);
  const otherPolicy = make_locus_hosted_projection_policy(otherEngine.hostedRegistry(), otherEngine.hostedPosition().authority,
    [{ name: "a", ownership: "shared" }], undefined, () => ({ libraries: ["a"] }));
  const otherSelection = await normalize_locus_effective_projection(otherPolicy, { libraries: ["a"] });
  assert.notEqual(projected_registry_digest(otherSelection), projected_registry_digest(plain));
  assert.equal(projected_registry_digest(otherSelection), uncached(otherSelection));
  const partsMap = hsonLiveMap.fromLibraries({ components: { parts: {
    button: { kind: "document", document: "<button hson:part/>" },
  } } });
  const partsEngine = internal_livemap_aggregate_authority(partsMap);
  const partsPolicy = make_locus_hosted_projection_policy(partsEngine.hostedRegistry(), partsEngine.hostedPosition().authority,
    [{ name: "components", ownership: "shared" }], undefined, () => ({ libraries: ["components"] }));
  const parts = await normalize_locus_effective_projection(partsPolicy, { libraries: ["components"] });
  assert.equal(parts.libraries[0]?.validation, "hson-part-collection-v1");
  assert.equal(projected_registry_digest(parts), uncached(parts));
  const withoutValidation = Object.freeze({ ...parts, libraries: Object.freeze(parts.libraries.map(({ validation, ...entry }) => Object.freeze(entry))) });
  assert.notEqual(projected_registry_digest(parts), projected_registry_digest(withoutValidation), "validation metadata remains in registry identity");
  checks++;

  const first = engine.hostedRegistry().libraries[0]!;
  const forged: HostedRegistry = Object.freeze({ ...engine.hostedRegistry(), libraries: Object.freeze([
    Object.freeze({ ...first, schemaDigest: "forged" }),
  ]) });
  assert.throws(() => normalize_locus_effective_projection(policy(forged), { libraries: ["a"] }), { code: "LOCUS_PROJECTION_UNAVAILABLE" });
  assert.throws(() => registry_from_entries(forged.libraries), /Schema identity/);
  const malformed: LocusEffectiveProjection = Object.freeze({ ...both,
    libraries: JSON.parse(JSON.stringify([{ ...first, schema: "<invalid" }])) });
  for (let n = 0; n < 2; n++) assert.throws(() => projected_registry_digest(malformed));
  assert.throws(() => registry_from_entries([{ ...first, validation: "hson-part-collection-v1" }]), /Part|part/);
  checks++;

  let topology: HostedAggregateCommit | undefined;
  const stop = engine.observe(commit => { topology = commit.hosted; });
  map.addLibraries({ extra: { data: { count: 1 }, schema: Count } });
  stop();
  assert.ok(topology?.topology);
  const expanded = await normalize_locus_effective_projection(policy(), { libraries: ["a", "extra"] });
  const event = project_locus_live_transition_internal(topology, expanded);
  assert.equal(event.kind, "commit");
  if (event.kind !== "commit") throw Error("Expected visible topology");
  assert.equal(event.commit.registryDigest, uncached(expanded));
  assert.equal(event.commit.previousRegistryDigest, projected_registry_digest(plain));
  calls = 0;
  assert.deepEqual(project_locus_live_transition_internal(topology, expanded), event);
  assert.equal(calls, 2, "derived previous-registry subset computes its own evidence");
  const hidden = project_locus_live_transition_internal(topology, plain);
  assert.equal(hidden.kind, "progress");
  assert.equal(hidden.kind === "progress" && hidden.progress.registryDigest, projected_registry_digest(plain));
  const expandedSystem = await normalize_locus_effective_projection(policy(),
    { libraries: ["a", "extra"], systemFeatures: ["interactions"] });
  const systemEvent = project_locus_live_transition_internal(topology, expandedSystem);
  assert.equal(systemEvent.kind, "commit");
  assert.equal(systemEvent.kind === "commit" && systemEvent.commit.previousRegistryDigest, projected_registry_digest(system));
  assert.equal(systemEvent.kind === "commit" && systemEvent.commit.registryDigest, uncached(expandedSystem));
  checks++;

  let authorizations = 0;
  const host = hsonLiveMap.locus.create({ a: { data: { count: 0 }, schema: Count, access: "shared" },
    b: { data: { count: 0 }, schema: Count, access: "shared" } },
  { authorizeProjection: () => { authorizations++; return { libraries: ["a", "b"] }; } });
  try {
    const session = await host.session.create({ libraries: ["a", "b"] });
    calls = 0;
    await host.data.must("a").at(["count"]).set(1);
    assert.equal(calls, 4);
    calls = 0;
    for (let n = 2; n < 6; n++) await host.data.must("a").at(["count"]).set(n);
    assert.equal(calls, 0, "ordinary accepted mutations reuse the established projection");
    const rev = host.rev;
    await assert.rejects(host.stage(draft => { draft.data.must("a").at(["count"]).set("invalid"); }), /schema/i);
    assert.equal(host.rev, rev, "cached evidence cannot certify new Data");
    const managed = locus_map_internal(host).data.must("a");
    assert.throws(() => managed.schema.use(ANY_DATA), /managed|authority|controlled/i);
    for (const libraries of [["a"], ["a", "b"]]) {
      assert.equal((await session.update({ libraries })).changed, true);
      calls = 0;
      await host.data.must("a").at(["count"]).set(host.rev + 10);
      assert.equal(calls, libraries.length * 2);
    }
    assert.equal(authorizations, 3);
    assert.equal(session.revoke(), true);
    assert.throws(() => session.now(), { code: "LOCUS_PROJECTION_UNAVAILABLE" });
    await assert.rejects(session.update({ libraries: ["a"] }), { code: "LOCUS_PROJECTION_UNAVAILABLE" });
    calls = 0;
    await host.data.must("a").at(["count"]).set(host.rev + 20);
    assert.equal(calls, 0, "revoked sessions are absent from preparation roster");
    const replacement = await host.session.create({ libraries: ["a", "b"] });
    calls = 0;
    await host.data.must("a").at(["count"]).set(host.rev + 30);
    assert.equal(calls, 4, "a fresh session does not inherit foreign projection evidence");
    host.dispose();
    assert.throws(() => replacement.now(), { code: "LOCUS_PROJECTION_UNAVAILABLE" });
  } finally { host.dispose(); }
  checks++;

  const storage = new MemoryCheckpointAdapter();
  const definitions = { a: { data: { count: 0 }, schema: Count, access: "shared" } } as const;
  const configuration = { logicalMapId: "r1-restoration", persistence: storage,
    authorizeProjection: () => ({ libraries: ["a"] }) };
  for (let runtime = 0; runtime < 2; runtime++) {
    const host = await hsonLiveMap.locus.resume(definitions, configuration);
    try {
      await host.session.create({ libraries: ["a"] });
      calls = 0;
      await host.data.must("a").at(["count"]).set(host.rev + 1);
      assert.equal(calls, 2, "restored runtime has a new projection owner");
      calls = 0;
      await host.data.must("a").at(["count"]).set(host.rev + 1);
      assert.equal(calls, 0);
    } finally { host.dispose(); }
  }
  checks++;
} finally { HsonSchema.fromHson = sourceAdmission; }

if (isMainThread) {
  const worker = repository_typescript_worker(new URL(import.meta.url));
  try {
    const count = await new Promise<number>((resolve, reject) => {
      worker.once("message", resolve); worker.once("error", reject);
      worker.once("exit", code => reject(Error(`Registry reuse Worker exited ${code}`)));
    });
    assert.equal(count, checks);
  } finally { await worker.terminate(); }
  console.log(`Projected registry reuse passed (${checks} Node and ${checks} Worker groups; first use 4 admissions, steady state 0).`);
} else parentPort!.postMessage(checks);
