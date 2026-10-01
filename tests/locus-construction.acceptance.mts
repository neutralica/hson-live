import assert from "node:assert/strict";
import { Hson, hsonLiveMap, hsonLocus, type LocusOwnedLibraryCatalogEntry } from "../src/index.ts";
import { MemoryCheckpointAdapter } from "./helpers/memory-checkpoint-adapter.mts";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";

const Count = Hson.schema`<type "data" content <value "number">>`;
const Secret = Hson.schema`<type "data" content <token "string">>`;
const catalog = [
  { name: "count", ownership: "shared" as const, definition: { data: { value: 1 }, schema: Count } },
  { name: "secret", ownership: "private" as const, definition: { data: { token: "hidden" }, schema: Secret } },
  { name: "ui", ownership: "local" as const, initializer: { data: { selected: false } } },
] as const satisfies readonly LocusOwnedLibraryCatalogEntry[];
const projection = {
  defaultProjection: { libraries: ["count", "ui"] },
  authorizeProjection: () => ({ libraries: ["count", "ui"] }),
};

const owned = hsonLocus.create({ libraries: catalog, ...projection });
assert.equal(owned.rev, 0);
assert.deepEqual(owned.map.capture().registry.libraries.map((entry) => entry.name), ["count", "secret"]);
assert.equal(owned.map.lib("count").mode, "data-object");
assert.equal(owned.map.lib("secret").mode, "data-object");
assert.throws(() => owned.map.lib("ui"), /Unknown LiveMap Library/);
assert.throws(() => owned.map.lib("count").at(["value"]).set(2), /managed|authority|Locus/i);
await owned.stage.lib("count").at(["value"]).set(2);
await owned.stage((stage) => { stage.lib("count").at(["value"]).set(3); });
assert.equal(Hson.data.materialize(owned.map.lib("count").at(["value"]).data()!), 3);
const ownedSession = await owned.session.create({ libraries: ["count", "ui", "secret"] });
const ownedNow = ownedSession.now();
assert.deepEqual(ownedNow.libs.libraries.map((entry) => entry.name), ["count"]);
assert.deepEqual(ownedNow.local.map((entry) => entry.name), ["ui"]);
assert.equal(ownedNow.local[0]?.mode, "data-object");

const supplied = hsonLiveMap.fromLibraries({ count: catalog[0]!.definition, secret: catalog[1]!.definition });
const adopted = hsonLocus.create({ map: supplied, libraries: [
  { name: "count", ownership: "shared" },
  { name: "secret", ownership: "private" },
  catalog[2]!,
], ...projection });
assert.equal(adopted.map, supplied);
assert.equal(adopted.rev, 0);
assert.throws(() => supplied.lib("count").at(["value"]).set(2), /managed|authority|Locus/i);
assert.throws(() => supplied.batch((stage) => { stage.lib("count").at(["value"]).set(2); }), /managed|authority|Locus/i);
await adopted.stage.lib("count").at(["value"]).set(3);
const adoptedSession = await adopted.session.create({ libraries: ["count", "ui", "secret"] });
assert.deepEqual(adoptedSession.now().libs.libraries.map((entry) => entry.name), ownedNow.libs.libraries.map((entry) => entry.name));
assert.equal(adoptedSession.now().initializerDigest, ownedNow.initializerDigest);
assert.equal(adopted.map.lib("count").at(["value"]).data(), owned.map.lib("count").at(["value"]).data());
adopted.dispose();
supplied.lib("count").at(["value"]).set(4);
assert.equal(Hson.data.materialize(supplied.lib("count").at(["value"]).data()!), 4);
owned.dispose();

const styledCatalog = [{
  name: "page", ownership: "shared", definition: { document: "<main/>" },
  css: { rules: [{ ruleKey: "hero", selector: "main", scopes: [], declarations: [["color", "red"]] }],
    properties: [], keyframes: [], order: [{ kind: "rule", ruleKey: "hero", scopes: [] }] },
}] as const;
const styled = hsonLocus.create({ logicalMapId: "styled-authority", libraries: styledCatalog });
assert.equal(styled.logicalMapId, "styled-authority");
assert.match(styled.map.lib("page").css.snapshot(), /color:red/);
styled.dispose();
const styledStorage = new MemoryCheckpointAdapter();
const styledDurable = await hsonLocus.create({ logicalMapId: "styled-durable", libraries: styledCatalog,
  persistence: styledStorage });
const styledRevision = styledDurable.rev;
styledDurable.dispose();
const styledRestored = await hsonLocus.create({ logicalMapId: "styled-durable", libraries: styledCatalog,
  persistence: styledStorage });
assert.equal(styledRestored.rev, styledRevision);
assert.match(styledRestored.map.lib("page").css.snapshot(), /color:red/);
styledRestored.dispose();

const invalid = hsonLiveMap.fromLibraries({ count: catalog[0]!.definition });
assert.throws(() => hsonLocus.create({ libraries: [{ name: "count", ownership: "shared",
  definition: { data: { value: "wrong" }, schema: Count } }] }), /Schema|invalid|mismatch/i);
assert.throws(() => hsonLocus.create({ map: invalid, libraries: [
  { name: "count", ownership: "shared" },
  { name: "ui", ownership: "local", initializer: { data: { selected: false }, css: JSON.parse("{}") } },
] }), /CSS|initializer/i);
invalid.lib("count").at(["value"]).set(5);
const claimed = hsonLocus.create({ map: invalid, libraries: [{ name: "count", ownership: "shared" }] });
assert.throws(() => hsonLocus.create({ map: invalid, libraries: [{ name: "count", ownership: "shared" }],
  logicalMapId: "new-map" }), /managed|claimed|owner|controlled/i);
const conflictStorage = new MemoryCheckpointAdapter();
await assert.rejects(hsonLocus.create({ map: invalid, libraries: [{ name: "count", ownership: "shared" }],
  logicalMapId: "conflicting-durable-map", persistence: conflictStorage }), /managed|controlled/i);
assert.equal(conflictStorage.state("conflicting-durable-map"), undefined);
claimed.dispose();
invalid.lib("count").at(["value"]).set(6);

const failedPersistence = new MemoryCheckpointAdapter();
failedPersistence.failChunk = new Error("checkpoint unavailable");
const unaffected = hsonLiveMap.fromLibraries({ count: catalog[0]!.definition });
const priorIdentity = internal_livemap_aggregate_authority(unaffected).hostedPosition().authority;
await assert.rejects(hsonLocus.create({ map: unaffected, libraries: [{ name: "count", ownership: "shared" }],
  logicalMapId: "failed-construction", persistence: failedPersistence }), /checkpoint/i);
assert.deepEqual(internal_livemap_aggregate_authority(unaffected).hostedPosition().authority, priorIdentity);
unaffected.lib("count").at(["value"]).set(7);

const adapter = new MemoryCheckpointAdapter();
const durable = await hsonLocus.create({ libraries: catalog, ...projection, persistence: adapter,
  logicalMapId: "construction-durable" });
await durable.stage.lib("count").at(["value"]).set(7);
const durableRev = durable.rev;
durable.dispose();
const restored = await hsonLocus.create({ libraries: catalog, ...projection, persistence: adapter,
  logicalMapId: "construction-durable" });
assert.equal(restored.rev, durableRev);
assert.equal(Hson.data.materialize(restored.map.lib("count").at(["value"]).data()!), 7);
assert.throws(() => restored.map.lib("ui"), /Unknown LiveMap Library/);
const rejectedRestore = hsonLiveMap.fromLibraries({ count: catalog[0]!.definition });
await assert.rejects(hsonLocus.create({ map: rejectedRestore, persistence: adapter,
  logicalMapId: "construction-durable", libraries: [{ name: "count", ownership: "shared" }] }), /catalog|topology/i);
assert.equal(rejectedRestore.rev, 0);
rejectedRestore.lib("count").at(["value"]).set(9);
adapter.failAppend = new Error("rejected");
await assert.rejects(restored.stage.lib("count").at(["value"]).set(8));
assert.equal(restored.rev, durableRev);
assert.equal(Hson.data.materialize(restored.map.lib("count").at(["value"]).data()!), 7);
restored.dispose();

process.stdout.write("ok - Locus construction owns or adopts one managed map\n");
