import assert from "node:assert/strict";
import { Hson, hsonLiveMap, hsonLocus } from "../src/index.ts";
import { MemoryCheckpointAdapter } from "./helpers/memory-checkpoint-adapter.mts";
import type { LocusHostedAggregatePersistedState } from "../src/api/locus/locus.aggregate.persistence.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "locus-final-model",
  title: "Grouped Locus construction and durable runtime ownership",
  category: "Locus",
  runtime: "node",
  tags: Object.freeze(["locus", "persistence", "topology", "public-api"]),
});

for (const options of [
  { private: [{ name: "onlyPrivate", definition: { data: 1 } }] },
  { shared: [{ name: "onlyShared", definition: { document: "<main/>" } }] },
  { local: [{ name: "onlyLocal", initializer: { data: 1 } }] },
  {},
]) {
  const created = hsonLocus.create(options);
  assert.equal(created.rev, 0);
  assert.equal("lib" in created, false);
  created.dispose();
}

const definition = { shared: [{ name: "A", definition: { data: { value: 1 } } }],
  logicalMapId: "final-locus-model" } as const;
const read = (locus: ReturnType<typeof hsonLocus.create>, name: string) => {
  const library = locus.map.lib(name);
  if (library.mode === "document") throw new Error("Expected data Library.");
  return Hson.data.materialize(library.at(["value"]).data()!);
};

const fresh = hsonLocus.create({ private: [{ name: "secret", definition: { data: { value: 1 } } }],
  shared: [{ name: "public", definition: { data: { value: 2 } } }],
  local: [{ name: "ui", initializer: { data: { selected: false } } }] });
assert.equal(fresh.rev, 0);
assert.deepEqual(fresh.map.capture().registry.libraries.map((entry) => entry.name), ["secret", "public"]);
assert.throws(() => fresh.map.lib("ui"), /Unknown LiveMap Library/);
assert.throws(() => Reflect.apply(hsonLocus.create, undefined, [hsonLiveMap.create()]), /unsupported|grouped/i);
await assert.rejects(hsonLocus.checkpoint(fresh), /no durable backing/i);
// @ts-expect-error Literal duplicate names are rejected before runtime.
assert.throws(() => hsonLocus.create({ shared: [{ name: "x", definition: { data: 1 } }],
  local: [{ name: "x", initializer: { data: 2 } }] }), /duplicate/i);
fresh.dispose();

const storage = new MemoryCheckpointAdapter();
const first = await hsonLocus.resume({ ...definition, persistence: storage });
assert.equal(first.rev, 0);
await first.stage.addLibraries({ private: [{ name: "B", definition: { data: { value: 2 } } }],
  shared: [{ name: "C", definition: { data: { value: 3 } } }] });
assert.equal(first.rev, 1);
assert.deepEqual(storage.appendCalls.at(-1)?.locus.libraryOwnershipAdded,
  [{ name: "B", ownership: "private" }, { name: "C", ownership: "shared" }]);
const b = first.stage.lib("B");
const c = first.stage.lib("C");
if (b.mode === "document" || c.mode === "document") throw new Error("Expected data Libraries.");
await b.at(["value"]).set(4);
await c.at(["value"]).set(5);
const rev = first.rev;
first.dispose();
const tailState = storage.state(definition.logicalMapId);
assert.ok(tailState);

const fromTail = await hsonLocus.resume({ ...definition, persistence: storage });
assert.equal(fromTail.rev, rev);
assert.equal(read(fromTail, "B"), 4);
assert.equal(read(fromTail, "C"), 5);
const session = await fromTail.session.create({ libraries: ["A", "B", "C"] });
assert.deepEqual(session.now().libs.libraries.map((entry) => entry.name), []);
await hsonLocus.checkpoint(fromTail);
assert.deepEqual(storage.state(definition.logicalMapId)?.checkpoint.locus.runtimeOwnership,
  [{ name: "B", ownership: "private" }, { name: "C", ownership: "shared" }]);
assert.equal(storage.state(definition.logicalMapId)?.commits.length, 0);
fromTail.dispose();

const fromCheckpoint = await hsonLocus.resume({ ...definition, persistence: storage,
  authorizeProjection: ({ requested }) => ({ libraries: requested.libraries }) });
assert.equal(fromCheckpoint.rev, rev);
assert.equal(read(fromCheckpoint, "B"), 4);
assert.equal(read(fromCheckpoint, "C"), 5);
const projected = await fromCheckpoint.session.create({ libraries: ["A"] });
assert.deepEqual(projected.now().libs.libraries.map((entry) => entry.name), ["A"]);
await projected.update({ libraries: ["A", "B", "C"] });
assert.deepEqual(projected.now().libs.libraries.map((entry) => entry.name), ["A", "C"]);
fromCheckpoint.dispose();
const checkpointState = storage.state(definition.logicalMapId);
assert.ok(checkpointState);
const validatedCheckpointState: LocusHostedAggregatePersistedState = checkpointState;
async function reject_corrupt(state: LocusHostedAggregatePersistedState): Promise<void> {
  storage.seed(definition.logicalMapId, state);
  await assert.rejects(hsonLocus.resume({ ...definition, persistence: storage }), /invalid|conflict/i);
  storage.seed(definition.logicalMapId, validatedCheckpointState);
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
await assert.rejects(hsonLocus.resume({ ...definition, shared: [
  ...definition.shared, { name: "C", definition: { data: { value: 3 } } }], persistence: storage }), /conflict/i);
await assert.rejects(hsonLocus.resume({ logicalMapId: definition.logicalMapId, persistence: storage }), /conflict/i);
await assert.rejects(hsonLocus.resume({ logicalMapId: definition.logicalMapId, persistence: storage,
  shared: [{ name: "A", definition: { document: "<main/>" } }] }), /conflict/i);
await assert.rejects(hsonLocus.resume({ logicalMapId: definition.logicalMapId, persistence: storage,
  shared: [{ name: "A", definition: { data: { value: 1 }, schema: Hson.schema`<type "data" content <value "number">>` } }] }), /conflict/i);

const failed = new MemoryCheckpointAdapter();
const held = await hsonLocus.resume({ ...definition, persistence: failed });
failed.failAppend = new Error("append unavailable");
await assert.rejects(held.stage.addLibraries({ shared: [{ name: "C", definition: { data: {} } }] }), /append/i);
assert.equal(held.rev, 0);
assert.throws(() => held.map.lib("C"), /Unknown LiveMap Library/);
held.dispose();
const validation = hsonLocus.create({});
await assert.rejects(validation.stage.addLibraries({}), /requires a Library/i);
// @ts-expect-error Local runtime additions are intentionally absent.
await assert.rejects(validation.stage.addLibraries({ local: [{ name: "local", initializer: { data: 1 } }] }), /private\/shared/i);
validation.dispose();
console.log("ok - final Locus construction and durable ownership");
