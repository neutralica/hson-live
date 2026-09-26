import assert from "node:assert/strict";
import { Hson, hsonLiveMap, type LiveMap } from "../src/index.ts";
import type { JsonValue } from "../src/core/types.ts";
import type { LocusHostedAggregateDraft } from "../src/api/locus/locus.aggregate.ts";
import {
  create_persistent_locus_hosted_aggregate_internal,
  load_persistent_locus_hosted_aggregate_internal,
  type LocusHostedAggregatePersistedCommit,
  type LocusHostedAggregatePersistedState,
} from "../src/api/locus/locus.aggregate.persistence.ts";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";
import { deferred, MemoryCheckpointAdapter } from "./helpers/memory-checkpoint-adapter.mts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "locus-hosted-topology-durability",
  title: "Hosted runtime Library durability foundation",
  category: "Locus",
  runtime: "node",
  tags: Object.freeze(["locus", "persistence", "livemap", "topology"]),
});

function data_value(map: LiveMap, name: string, key: string): unknown {
  const library = map.lib(name);
  if (!("snap" in library)) throw new Error("Expected a data Library.");
  return library.snap([key]);
}

function set_data(draft: LocusHostedAggregateDraft, name: string, key: string, value: JsonValue): void {
  const library = draft.lib(name);
  if (!("at" in library)) throw new Error("Expected a data Library draft.");
  library.at([key]).set(value);
}

async function case_(name: string, run: () => Promise<void>): Promise<void> {
  await run();
  process.stdout.write(`ok - ${name}\n`);
}

await case_("empty authority persists topology, writes, batches, checkpoint, and later topology", async () => {
  const adapter = new MemoryCheckpointAdapter();
  const id = "topology-empty-chain";
  const map = hsonLiveMap.create();
  const locus = await create_persistent_locus_hosted_aggregate_internal({ map, persistence: adapter, logicalMapId: id });
  const emptyDigest = locus.registryDigest;
  const emitted: number[] = [];
  const stop = locus.on_commit((commit) => emitted.push(commit.rev));
  assert.throws(() => map.addLibraries({ bypass: { data: 0 } }), /Locus authority|controlled|managed/i);
  assert.equal(map.rev, 0);

  const addA = await locus.add_libraries_internal({ A: { data: { count: 0 } } });
  assert.equal(addA.prevRev, 0);
  assert.equal(addA.rev, 1);
  assert.equal(addA.previousRegistryDigest, emptyDigest);
  assert.equal(addA.registryDigest, locus.registryDigest);
  assert.notEqual(addA.registryDigest, emptyDigest);
  assert.deepEqual(addA.topology?.operation.libraries.map((item) => item.name), ["A"]);
  assert.equal(addA.topology?.operation.libraries[0]?.schema, '<type "data">');
  assert.equal(data_value(map, "A", "count"), 0);
  await locus.mutate((draft) => { set_data(draft, "A", "count", 1); });

  const beforeBatch = locus.registryDigest;
  const batch = await locus.add_libraries_internal({
    B: { data: { value: "B0" } },
    C: { data: { value: "C0" } },
  });
  assert.equal(batch.prevRev, 2);
  assert.equal(batch.rev, 3);
  assert.equal(batch.previousRegistryDigest, beforeBatch);
  assert.deepEqual(batch.topology?.operation.libraries.map((item) => item.name), ["B", "C"]);
  await locus.mutate((draft) => { set_data(draft, "C", "value", "C1"); });
  assert.deepEqual(emitted, [1, 2, 3, 4]);
  assert.equal(map.rev, 4);
  const fromFullTail = await load_persistent_locus_hosted_aggregate_internal(id, { persistence: adapter });
  assert.ok(fromFullTail);
  assert.equal(fromFullTail.rev, 4);
  assert.equal(data_value(fromFullTail.map, "A", "count"), 1);
  assert.equal(data_value(fromFullTail.map, "C", "value"), "C1");
  fromFullTail.dispose();
  await locus.checkpoint();
  assert.equal(adapter.state(id)?.checkpoint.rev, 4);
  assert.equal(adapter.state(id)?.checkpoint.registryDigest, locus.registryDigest);
  const addD = await locus.add_libraries_internal({ D: { document: Hson.document`<main/>` } });
  assert.equal(addD.rev, 5);
  assert.equal(adapter.state(id)?.commits.length, 1);
  const finalDigest = locus.registryDigest;
  assert.equal(JSON.stringify(adapter.state(id)).includes("issuedQuids"), false);
  assert.equal(JSON.stringify(adapter.state(id)).includes("identityEpoch"), false);
  const originalIdentityOwner = internal_livemap_aggregate_authority(map).identityEpoch().owner;
  stop();
  locus.dispose();

  const restored = await load_persistent_locus_hosted_aggregate_internal(id, { persistence: adapter });
  assert.ok(restored);
  assert.equal(restored.rev, 5);
  assert.equal(restored.registryDigest, finalDigest);
  assert.notEqual(internal_livemap_aggregate_authority(restored.map).identityEpoch().owner, originalIdentityOwner);
  assert.equal(data_value(restored.map, "A", "count"), 1);
  assert.equal(data_value(restored.map, "B", "value"), "B0");
  assert.equal(data_value(restored.map, "C", "value"), "C1");
  assert.equal(restored.map.lib("D").mode, "document");
  restored.dispose();
});

await case_("checkpoint-before-add tail and checkpoint-after-add restore the same topology", async () => {
  const adapter = new MemoryCheckpointAdapter();
  const id = "topology-checkpoint-tail";
  const locus = await create_persistent_locus_hosted_aggregate_internal({
    map: hsonLiveMap.fromLibraries({ initial: { data: { value: 1 } } }),
    persistence: adapter, logicalMapId: id,
  });
  const initialDigest = locus.registryDigest;
  await locus.add_libraries_internal({ later: { data: { value: 2 } } });
  await locus.mutate((draft) => { set_data(draft, "later", "value", 3); });
  const laterDigest = locus.registryDigest;
  assert.notEqual(laterDigest, initialDigest);
  assert.equal(adapter.state(id)?.checkpoint.registryDigest, initialDigest);
  locus.dispose();
  const fromTail = await load_persistent_locus_hosted_aggregate_internal(id, { persistence: adapter });
  assert.ok(fromTail);
  assert.equal(data_value(fromTail.map, "later", "value"), 3);
  assert.equal(fromTail.registryDigest, laterDigest);
  await fromTail.checkpoint();
  assert.equal(adapter.state(id)?.checkpoint.registryDigest, laterDigest);
  assert.equal(adapter.state(id)?.commits.length, 0);
  fromTail.dispose();
  const fromCheckpoint = await load_persistent_locus_hosted_aggregate_internal(id, { persistence: adapter });
  assert.ok(fromCheckpoint);
  assert.equal(data_value(fromCheckpoint.map, "later", "value"), 3);
  assert.equal(fromCheckpoint.registryDigest, laterDigest);
  fromCheckpoint.dispose();
});

await case_("prepared topology stays invisible while the durable append is pending", async () => {
  class PausedAppendAdapter extends MemoryCheckpointAdapter {
    readonly entered = deferred();
    readonly release = deferred();
    override async appendCommit(record: LocusHostedAggregatePersistedCommit): Promise<void> {
      this.entered.resolve();
      await this.release.promise;
      await super.appendCommit(record);
    }
  }
  const adapter = new PausedAppendAdapter();
  const map = hsonLiveMap.create();
  const locus = await create_persistent_locus_hosted_aggregate_internal({
    map, persistence: adapter, logicalMapId: "topology-pending-append",
  });
  const digest = locus.registryDigest;
  const pending = locus.add_libraries_internal({ held: { data: { value: 1 } } });
  await adapter.entered.promise;
  assert.equal(map.rev, 0);
  assert.equal(locus.registryDigest, digest);
  assert.throws(() => map.lib("held"), /Unknown/);
  assert.throws(() => map.addLibraries({ bypass: { data: 2 } }), /Locus authority|controlled|managed/i);
  adapter.release.resolve();
  await pending;
  assert.equal(map.rev, 1);
  assert.equal(data_value(map, "held", "value"), 1);
  locus.dispose();
});

await case_("failed durable topology append leaves authority and publication untouched", async () => {
  const adapter = new MemoryCheckpointAdapter();
  const map = hsonLiveMap.create();
  const locus = await create_persistent_locus_hosted_aggregate_internal({
    map, persistence: adapter, logicalMapId: "topology-failed-append",
  });
  const digest = locus.registryDigest;
  const published: number[] = [];
  const stop = locus.on_commit((commit) => published.push(commit.rev));
  adapter.failAppend = new Error("append failed");
  await assert.rejects(locus.add_libraries_internal({ rejected: { data: { value: 1 } } }), /append/i);
  assert.equal(locus.rev, 0);
  assert.equal(map.rev, 0);
  assert.equal(locus.registryDigest, digest);
  assert.deepEqual(published, []);
  assert.deepEqual(adapter.state(locus.logicalMapId)?.commits, []);
  assert.throws(() => map.lib("rejected"), /Unknown/);
  const numberSchema = Hson.schema`<type "data" content <value "number">>`;
  await assert.rejects(locus.add_libraries_internal({
    valid: { data: { value: 1 } },
    invalid: { data: { value: "wrong" }, schema: numberSchema },
  }), /Schema|number/i);
  assert.equal(locus.rev, 0);
  assert.throws(() => map.lib("valid"), /Unknown/);
  await locus.add_libraries_internal({ accepted: { data: { value: 2 } } });
  assert.deepEqual(published, [1]);
  assert.equal(locus.rev, 1);
  const identity = internal_livemap_aggregate_authority(map).libraries()[0];
  assert.ok(identity);
  internal_livemap_aggregate_authority(map).acquireLocalProjectedIdentity(identity, [], "0000ab123");
  await locus.add_libraries_internal({ later: { data: { value: 3 } } });
  assert.equal(JSON.stringify(adapter.state(locus.logicalMapId)).includes("0000ab123"), false);
  stop();
  locus.dispose();
});

await case_("failed checkpoint after an accepted addition preserves the old manifest and topology tail", async () => {
  const adapter = new MemoryCheckpointAdapter();
  const id = "topology-checkpoint-failure";
  const locus = await create_persistent_locus_hosted_aggregate_internal({
    map: hsonLiveMap.create(), persistence: adapter, logicalMapId: id,
  });
  const oldCheckpoint = adapter.state(id)?.checkpoint.checkpointId;
  await locus.add_libraries_internal({ A: { data: { value: 1 } } });
  adapter.failManifest = new Error("manifest failed");
  await assert.rejects(locus.checkpoint(), /checkpoint/i);
  assert.equal(adapter.state(id)?.checkpoint.checkpointId, oldCheckpoint);
  assert.equal(adapter.state(id)?.commits.length, 1);
  assert.equal(locus.rev, 1);
  locus.dispose();
  const restored = await load_persistent_locus_hosted_aggregate_internal(id, { persistence: adapter });
  assert.ok(restored);
  assert.equal(data_value(restored.map, "A", "value"), 1);
  restored.dispose();
});

await case_("tampered topology digest and reordered tail fail closed on restart", async () => {
  const adapter = new MemoryCheckpointAdapter();
  const id = "topology-tamper";
  const locus = await create_persistent_locus_hosted_aggregate_internal({
    map: hsonLiveMap.create(), persistence: adapter, logicalMapId: id,
  });
  await locus.add_libraries_internal({ A: { data: { value: 0 } } });
  await locus.mutate((draft) => { set_data(draft, "A", "value", 1); });
  locus.dispose();
  const good = adapter.state(id);
  assert.ok(good);
  const wrongDigest = structuredClone(good);
  const first = wrongDigest.commits[0];
  assert.ok(first);
  const changed = { ...first, commit: { ...first.commit, previousRegistryDigest: "0".repeat(64) } };
  const tamperedPrior: LocusHostedAggregatePersistedState = {
    checkpoint: wrongDigest.checkpoint, commits: [changed, ...wrongDigest.commits.slice(1)],
  };
  adapter.seed(id, tamperedPrior);
  await assert.rejects(load_persistent_locus_hosted_aggregate_internal(id, { persistence: adapter }), /invalid/i);
  const wrongResult = structuredClone(good);
  const original = wrongResult.commits[0];
  assert.ok(original);
  const mismatched = { ...original, registryDigest: "f".repeat(64),
    commit: { ...original.commit, registryDigest: "f".repeat(64) } };
  const tamperedResult: LocusHostedAggregatePersistedState = {
    checkpoint: wrongResult.checkpoint, commits: [mismatched, ...wrongResult.commits.slice(1)],
  };
  adapter.seed(id, tamperedResult);
  await assert.rejects(load_persistent_locus_hosted_aggregate_internal(id, { persistence: adapter }), /invalid/i);
  const wrongRoot = structuredClone(good);
  const firstRoot = wrongRoot.commits[0];
  assert.ok(firstRoot?.commit.topology);
  const changedLibraries = firstRoot.commit.topology.operation.libraries.map((entry) => ({
    ...entry, root: { ...entry.root, payload: "not canonical Hson" },
  }));
  const changedTopology = { ...firstRoot.commit.topology,
    operation: { kind: "library-add" as const, libraries: changedLibraries } };
  const tamperedRoot: LocusHostedAggregatePersistedState = {
    checkpoint: wrongRoot.checkpoint,
    commits: [{ ...firstRoot, commit: { ...firstRoot.commit, topology: changedTopology } }, ...wrongRoot.commits.slice(1)],
  };
  adapter.seed(id, tamperedRoot);
  await assert.rejects(load_persistent_locus_hosted_aggregate_internal(id, { persistence: adapter }), /invalid/i);
  const reordered = structuredClone(good);
  adapter.seed(id, { checkpoint: reordered.checkpoint, commits: [reordered.commits[1]!, reordered.commits[0]!] });
  await assert.rejects(load_persistent_locus_hosted_aggregate_internal(id, { persistence: adapter }), /invalid/i);
});

process.stdout.write("Hosted topology durability acceptance passed.\n");
