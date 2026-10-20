import { orderedRootReconstructionFixtures, forbid_structural_js_enumeration } from "./fixtures/structural-json-order-fixtures.mts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import type { HsonNode } from "../src/core/types.ts";
import { locus_map_internal } from "../src/internal/governor-maps.js";
import assert from "node:assert/strict";
import { Hson, hsonLiveMap } from "../src/index.ts";
import { MemoryCheckpointAdapter, deferred } from "./helpers/memory-checkpoint-adapter.mts";
import type { LocusHostedAggregatePersistedState } from "../src/api/locus/locus.aggregate.persistence.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "locus-final-model",
  title: "Flat Locus construction and durable runtime ownership",
  category: "Locus",
  runtime: "node",
  tags: Object.freeze(["locus", "persistence", "topology", "public-api"]),
});

for (const [definitions, configuration] of [
  [{ onlyPrivate: { data: 1 } }, {}],
  [{ onlyShared: { document: "<main/>", access: "shared" } }, {}],
  [{}, { local: [{ name: "onlyLocal", initializer: { data: 1 } }] }],
  [{}, {}],
] as const) {
  const created = hsonLiveMap.locus.create(definitions, configuration);
  assert.equal(created.rev, 0);
  assert.equal("lib" in created, false);
  created.dispose();
}

const definition = [{ "A": { data: { value: 1 }, access: "shared" } }, { logicalMapId: "final-locus-model" }] as const;
const read = (locus: ReturnType<typeof hsonLiveMap.locus.create>, name: string) => {
  const library = locus.data.must(name);
  if (String(library.mode) === "document") throw new Error("Expected data Library.");
  return Hson.data.materialize(library.at(["value"]).data()!);
};

const fresh = hsonLiveMap.locus.create({ "secret": { data: { value: 1 }, access: "private" }, "public": { data: { value: 2 }, access: "shared" } }, { local: [{ name: "ui", initializer: { data: { selected: false } } }] });
assert.equal(fresh.rev, 0);
assert.deepEqual(locus_map_internal(fresh).capture().registry.libraries.map((entry) => entry.name), ["secret", "public"]);
assert.throws(() => fresh.data.must("ui"), /Unknown LiveMap Library/);
assert.throws(() => Reflect.apply(hsonLiveMap.locus.create, undefined, [hsonLiveMap.create()]), /unsupported|definition|Library/i);
await assert.rejects(hsonLiveMap.locus.checkpoint(fresh), /no durable backing/i);
// @ts-expect-error Literal duplicate names are rejected before runtime.
assert.throws(() => hsonLiveMap.locus.create({ "x": { data: 1, access: "shared" } }, { local: [{ name: "x", initializer: { data: 2 } }] }), /duplicate/i);
fresh.dispose();

const storage = new MemoryCheckpointAdapter();
const first = await hsonLiveMap.locus.resume({ ...definition[0] }, { ...definition[1], persistence: storage });
assert.equal(first.rev, 0);
await first.admit({ "B": { data: { value: 2 }, access: "private" }, "C": { data: { value: 3 }, access: "shared" } });
assert.equal(first.rev, 1);
assert.deepEqual(storage.appendCalls.at(-1)?.locus.libraryOwnershipAdded,
  [{ name: "B", ownership: "private" }, { name: "C", ownership: "shared" }]);
const b = first.data.must("B");
const c = first.data.must("C");
if (String(b.mode) === "document" || String(c.mode) === "document") throw new Error("Expected data Libraries.");
await b.at(["value"]).set(4);
await c.at(["value"]).set(5);
const rev = first.rev;
first.dispose();
const tailState = storage.state(definition[1].logicalMapId);
assert.ok(tailState);

const fromTail = await hsonLiveMap.locus.resume({ ...definition[0] }, { ...definition[1], persistence: storage });
assert.equal(fromTail.rev, rev);
assert.equal(read(fromTail, "B"), 4);
assert.equal(read(fromTail, "C"), 5);
const session = await fromTail.session.create({ libraries: ["A", "B", "C"] });
assert.deepEqual(session.now().libs.libraries.map((entry) => entry.name), []);
await hsonLiveMap.locus.checkpoint(fromTail);
assert.deepEqual(storage.state(definition[1].logicalMapId)?.checkpoint.locus.runtimeOwnership,
  [{ name: "B", ownership: "private" }, { name: "C", ownership: "shared" }]);
assert.equal(storage.state(definition[1].logicalMapId)?.commits.length, 0);
fromTail.dispose();

const fromCheckpoint = await hsonLiveMap.locus.resume({ ...definition[0] }, { ...definition[1], persistence: storage, authorizeProjection: ({ requested }) => ({ libraries: requested.libraries }) });
assert.equal(fromCheckpoint.rev, rev);
assert.equal(read(fromCheckpoint, "B"), 4);
assert.equal(read(fromCheckpoint, "C"), 5);
const projected = await fromCheckpoint.session.create({ libraries: ["A"] });
assert.deepEqual(projected.now().libs.libraries.map((entry) => entry.name), ["A"]);
await projected.update({ libraries: ["A", "B", "C"] });
assert.deepEqual(projected.now().libs.libraries.map((entry) => entry.name), ["A", "C"]);
fromCheckpoint.dispose();
const checkpointState = storage.state(definition[1].logicalMapId);
assert.ok(checkpointState);
const validatedCheckpointState: LocusHostedAggregatePersistedState = checkpointState;
async function reject_corrupt(state: LocusHostedAggregatePersistedState): Promise<void> {
  storage.seed(definition[1].logicalMapId, state);
  await assert.rejects(hsonLiveMap.locus.resume({ ...definition[0] }, { ...definition[1], persistence: storage }), /invalid|conflict/i);
  storage.seed(definition[1].logicalMapId, validatedCheckpointState);
}
const addition = tailState.commits[0];
assert.ok(addition);
const wrongName = structuredClone(tailState);
Reflect.set(wrongName.commits[0]!.locus, "libraryOwnershipAdded", [{ name: "other", ownership: "shared" }]);
await reject_corrupt(wrongName);
const duplicate = structuredClone(tailState);
Reflect.set(duplicate.commits[0]!.locus, "libraryOwnershipAdded", [
  ...addition.locus.libraryOwnershipAdded, addition.locus.libraryOwnershipAdded[0],
]);
await reject_corrupt(duplicate);
const invalidOwnership = structuredClone(tailState);
Reflect.set(invalidOwnership.commits[0]!.locus, "libraryOwnershipAdded", [
  { name: "B", ownership: "local" }, { name: "C", ownership: "shared" },
]);
await reject_corrupt(invalidOwnership);
const missingOwnership = structuredClone(tailState);
Reflect.set(missingOwnership.commits[0]!.locus, "libraryOwnershipAdded", []);
await reject_corrupt(missingOwnership);
const missingCheckpointOwnership = structuredClone(checkpointState);
Reflect.set(missingCheckpointOwnership.checkpoint.locus, "runtimeOwnership", []);
await reject_corrupt(missingCheckpointOwnership);
const absentCheckpointLibrary = structuredClone(checkpointState);
Reflect.set(absentCheckpointLibrary.checkpoint.locus, "runtimeOwnership", [
  ...checkpointState.checkpoint.locus.runtimeOwnership, { name: "absent", ownership: "shared" },
]);
await reject_corrupt(absentCheckpointLibrary);
await assert.rejects(hsonLiveMap.locus.resume({ ...definition[0], C: { data: { value: 3 }, access: "shared" } }, { ...definition[1], persistence: storage }), /conflict/i);
await assert.rejects(hsonLiveMap.locus.resume({  }, { logicalMapId: definition[1].logicalMapId, persistence: storage }), /conflict/i);
await assert.rejects(hsonLiveMap.locus.resume({ "A": { document: "<main/>", access: "shared" } }, { logicalMapId: definition[1].logicalMapId, persistence: storage }), /conflict/i);
await assert.rejects(hsonLiveMap.locus.resume({ "A": { data: { value: 1 }, schema: Hson.schema`<type "data" content <value "number">>`, access: "shared" } }, { logicalMapId: definition[1].logicalMapId, persistence: storage }), /conflict/i);

const failed = new MemoryCheckpointAdapter();
const held = await hsonLiveMap.locus.resume({ ...definition[0] }, { ...definition[1], persistence: failed });
failed.failAppend = new Error("append unavailable");
await assert.rejects(held.admit({ "C": { data: {}, access: "shared" } }), /append/i);
assert.equal(held.rev, 0);
assert.throws(() => held.data.must("C"), /Unknown LiveMap Library/);
held.dispose();
const missingIdentityStorage = new MemoryCheckpointAdapter();
// @ts-expect-error Durable resume requires a stable logicalMapId.
await assert.rejects(hsonLiveMap.locus.resume(definition[0], { persistence: missingIdentityStorage }), /stable logicalMapId/i);
await assert.rejects(hsonLiveMap.locus.resume(definition[0], { logicalMapId: " ",
  persistence: missingIdentityStorage }), /stable logicalMapId/i);
assert.equal(missingIdentityStorage.states.size, 0);

class DelayedPreflightAdapter extends MemoryCheckpointAdapter {
  blockNextLoad = false;
  readonly entered = deferred();
  readonly release = deferred();
  override async load(logicalMapId: string) {
    if (this.blockNextLoad) {
      this.blockNextLoad = false;
      this.entered.resolve();
      await this.release.promise;
    }
    return super.load(logicalMapId);
  }
}
const racingStorage = new DelayedPreflightAdapter();
const racingDefinition = [{ "state": { data: { value: 0 }, access: "shared" } }, { logicalMapId: "checkpoint-prefix-race" }] as const;
const racing = await hsonLiveMap.locus.resume({ ...racingDefinition[0] }, { ...racingDefinition[1], persistence: racingStorage });
racingStorage.blockNextLoad = true;
const compacting = hsonLiveMap.locus.checkpoint(racing);
await racingStorage.entered.promise;
await racing.data.must("state").at(["value"]).set(1);
await racing.data.must("state").at(["value"]).set(2);
await racing.admit({ "later": { data: { value: 3 }, access: "shared" } });
racingStorage.release.resolve();
await compacting;
assert.equal(racingStorage.state(racingDefinition[1].logicalMapId)?.checkpoint.rev, 0);
assert.deepEqual(racingStorage.state(racingDefinition[1].logicalMapId)?.commits.map((entry) => entry.commit.rev), [1, 2, 3]);
racing.dispose();
const racingRestored = await hsonLiveMap.locus.resume({ ...racingDefinition[0] }, { ...racingDefinition[1], persistence: racingStorage });
assert.equal(racingRestored.rev, 3);
assert.equal(read(racingRestored, "state"), 2);
assert.equal(read(racingRestored, "later"), 3);
racingRestored.dispose();
const validation = hsonLiveMap.locus.create({  });
await assert.rejects(validation.admit({  }), /requires a Library/i);
// @ts-expect-error Local runtime additions are intentionally absent.
await assert.rejects(validation.admit({ local: { data: 1, access: "local" } }), /access/i);
validation.dispose();
// Durable scalar codec fidelity is Cut 8; negative zero is covered at exact in-memory receivers.
for (const fixture of orderedRootReconstructionFixtures.filter(entry => entry.id !== "structural-json-order.negative-zero")) {
  const persistence = new MemoryCheckpointAdapter();
  const options = [{ "base": { data: 1, access: "shared" } }, { logicalMapId: `ordered-root-${fixture.id}`, persistence }] as const;
  const created = await hsonLiveMap.locus.resume(options[0], options[1]);
  await created.admit({ "ordered": { data: fixture.expectedJson, access: "shared" } });
  const original: HsonNode = { $_tag: "_hson_root", $_content: [fixture.graph] };
  assert.equal(canonical_hson_graph_equal(locus_map_internal(created).data.must("ordered").root(), original), true);
  const payload = locus_map_internal(created).capture().libraries.find(entry => entry.name === "ordered")!.root.payload;
  created.dispose();
  for (const checkpoint of [false, true]) {
    const stop = forbid_structural_js_enumeration();
    let resumed;
    try { resumed = await hsonLiveMap.locus.resume(options[0], options[1]); }
    finally { stop(); }
    assert.equal(canonical_hson_graph_equal(locus_map_internal(resumed).data.must("ordered").root(), original), true, fixture.id);
    assert.equal(locus_map_internal(resumed).capture().libraries.find(entry => entry.name === "ordered")!.root.payload, payload);
    if (!checkpoint) await hsonLiveMap.locus.checkpoint(resumed);
    resumed.dispose();
  }
}

console.log("ok - final Locus construction and durable ownership");
