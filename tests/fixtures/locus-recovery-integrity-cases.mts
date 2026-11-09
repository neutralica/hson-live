import assert from "node:assert/strict";
import { Hson, hsonLiveMap, type LiveMap } from "../../src/index.ts";
import { internal_livemap_aggregate_authority } from "../../src/api/livemap/livemap.internal.ts";
import { registry_from_entries } from "../../src/api/livemap/livemap.hosted.ts";
import { hson_schema_digest } from "../../src/api/schema/hson-schema.ts";
import type { LocusHostedAggregatePersistedCommit } from "../../src/api/locus/locus.aggregate.persistence.ts";
import { resume_registry_locus } from "../../src/api/locus/locus.registry.persistence.ts";
import { encode_checkpoint_chunks } from "../../src/api/locus/locus.checkpoint-chunks.ts";
import { locus_map_internal } from "../../src/internal/governor-maps.ts";
import { MemoryCheckpointAdapter } from "../helpers/memory-checkpoint-adapter.mts";

type RunCase = (name: string, test: () => Promise<void>) => Promise<void>;
const startup = {
  state: { json: { count: 0 }, schema: Hson.schema`<type "data" content <count "number">>` },
  parts: { parts: { button: {
    kind: "document", document: '<button hson:part event:run/>',
    events: { run: '<hson:event on:click local:run input:data={<label "exact" count -0>} <> >' },
  } } },
} as const;
const libraries = [{ name: "state", ownership: "private" }, { name: "parts", ownership: "private" }] as const;
const invalid = { code: "LOCUS_PERSISTED_STATE_INVALID" };

function interaction_root(map: LiveMap) {
  return internal_livemap_aggregate_authority(map).captureSemanticCheckpoint().libraries.at(-1)!.root;
}

async function recovered_fixture(logicalMapId: string) {
  const persistence = new MemoryCheckpointAdapter();
  const config = { logicalMapId, persistence };
  const locus = await hsonLiveMap.locus.resume(startup, config);
  await locus.admit({ page: { document: '<main "buttons" <hson-part lib="parts" at="button"/> <hson-part lib="parts" at="button"/>/>' } });
  const snapshot = internal_livemap_aggregate_authority(locus_map_internal(locus)).captureSemanticCheckpoint();
  return { config, locus, snapshot, supplied: () => hsonLiveMap.fromLibraries(startup) };
}

export async function locus_recovery_integrity_cases(run: RunCase) {
  await run("current checkpoint registry order survives a normal snapshot round trip", async () => {
    const config = { persistence: new MemoryCheckpointAdapter(), logicalMapId: "canonical-recovery" };
    const locus = await hsonLiveMap.locus.resume(startup, config);
    const snapshot = locus_map_internal(locus).capture();
    await hsonLiveMap.locus.checkpoint(locus);
    locus.dispose();
    const { persistence, logicalMapId } = config;
    const valid = persistence.state(logicalMapId)!;
    const restored = await hsonLiveMap.locus.resume(startup, config);
    try {
      const captured = locus_map_internal(restored).capture();
      assert.deepEqual(captured, snapshot);
      const receiver = hsonLiveMap.fromLibraries(startup);
      receiver.restore(captured);
      assert.deepEqual(receiver.capture(), captured);
    } finally { restored.dispose(); }

    const order = [snapshot.registry.libraries.at(-1)!, ...snapshot.registry.libraries.slice(0, -1)];
    const digest = registry_from_entries(order).digest;
    const manifest = valid.checkpoint;
    const reordered = { ...manifest, registryDigest: digest,
      registry: { ...manifest.registry, digest, libraries: order.map(entry => manifest.registry.libraries.find(item => item.name === entry.name)!) },
      chunks: order.flatMap(entry => manifest.chunks.filter(chunk => chunk.owner === entry.name)) };
    persistence.seed(logicalMapId, { checkpoint: reordered, commits: [] });
    const map = hsonLiveMap.fromLibraries(startup), before = map.capture();
    await assert.rejects(resume_registry_locus({ ...config, map, libraries }), invalid);
    assert.deepEqual(map.capture(), before);
  });

  await run("covered and replayed records require the same canonical payloads", async () => {
    const { config, locus, snapshot } = await recovered_fixture("covered-recovery");
    const { persistence, logicalMapId } = config;
    const tail = persistence.state(logicalMapId)!;
    const malformed = structuredClone(tail.commits[0]!);
    const delta = malformed.commit.topology!.operation.interactionAdds!;
    Reflect.set(delta, "payload", "invalid");
    persistence.seed(logicalMapId, { ...tail, commits: [malformed] });
    await assert.rejects(hsonLiveMap.locus.resume(startup, config), invalid);
    persistence.seed(logicalMapId, tail);
    const replayed = await hsonLiveMap.locus.resume(startup, config);
    try { assert.deepEqual(internal_livemap_aggregate_authority(locus_map_internal(replayed)).captureSemanticCheckpoint(), snapshot); }
    finally { replayed.dispose(); }

    persistence.failPrune = new Error("interrupted pruning");
    await assert.rejects(hsonLiveMap.locus.checkpoint(locus), { code: "LOCUS_PERSISTENCE_CHECKPOINT_FAILED" });
    await locus.stage(stage => stage.data.state.at(["count"]).set(2));
    const interrupted = persistence.state(logicalMapId)!;
    const assertRecovered = async () => {
      const resumed = await hsonLiveMap.locus.resume(startup, config);
      try {
        assert.equal(resumed.rev, 2);
        assert.equal(resumed.data.state.snap(["count"]), 2);
        assert.deepEqual(interaction_root(locus_map_internal(resumed)), snapshot.libraries.at(-1)!.root);
      } finally { resumed.dispose(); }
    };
    await assertRecovered();
    persistence.seed(logicalMapId, { ...interrupted, commits: [malformed, interrupted.commits[1]!] });
    await assert.rejects(hsonLiveMap.locus.resume(startup, config), invalid);

    const malformedData = structuredClone(interrupted.commits[1]!);
    Reflect.set(malformedData.commit.operations[0]!, "payload", "invalid");
    persistence.seed(logicalMapId, { ...interrupted, commits: [interrupted.commits[0]!, malformedData] });
    await assert.rejects(hsonLiveMap.locus.resume(startup, config), invalid);
    persistence.seed(logicalMapId, interrupted);
    persistence.failPrune = new Error("interrupted pruning");
    await assert.rejects(hsonLiveMap.locus.checkpoint(locus), { code: "LOCUS_PERSISTENCE_CHECKPOINT_FAILED" });
    locus.dispose();
    const coveredData = persistence.state(logicalMapId)!;
    assert.equal(coveredData.checkpoint.rev, 2);
    await assertRecovered();
    persistence.seed(logicalMapId, { ...coveredData, commits: [coveredData.commits[0]!, malformedData] });
    await assert.rejects(hsonLiveMap.locus.resume(startup, config), invalid);
  });

  await run("covered and replayed topology records require the exact immutable registry transition", async () => {
    const persistence = new MemoryCheckpointAdapter(), logicalMapId = "registry-transition";
    const config = { persistence, logicalMapId };
    const locus = await hsonLiveMap.locus.resume(startup, config);
    const number = Hson.schema`<type "data" content <count "number">>`;
    const any = Hson.schema`<type "data" content <count "any">>`;
    await locus.stage(stage => stage.data.state.at(["count"]).set(1));
    await locus.admit({ added: { json: { count: 1 }, schema: number }, next: { json: { count: 2 } } });
    const authority = internal_livemap_aggregate_authority(locus_map_internal(locus));
    const initialAdd = authority.captureSemanticCheckpoint().registry.libraries;
    await locus.admit({ later: { json: { count: 3 } } });
    const replay = persistence.state(logicalMapId)!;
    persistence.failPrune = new Error("interrupted pruning");
    await assert.rejects(hsonLiveMap.locus.checkpoint(locus), { code: "LOCUS_PERSISTENCE_CHECKPOINT_FAILED" });
    const covered = persistence.state(logicalMapId)!;
    await locus.stage(stage => stage.data.must("added").at(["count"]).set(4));
    const withTail = persistence.state(logicalMapId)!;
    locus.dispose();

    const setSchema = (record: LocusHostedAggregatePersistedCommit) => {
      Reflect.set(record.commit.topology!.operation.libraries[0]!, "schema", any.toHson());
    };
    const setResult = (record: LocusHostedAggregatePersistedCommit, digest: string) => {
      Reflect.set(record, "registryDigest", digest);
      Reflect.set(record.commit, "registryDigest", digest);
    };
    const setOrder = (record: LocusHostedAggregatePersistedCommit, order: readonly number[]) => {
      const topology = record.commit.topology!;
      const entries = order.map(index => topology.operation.libraries[index]!);
      Reflect.set(topology, "library", entries[0]!.name);
      Reflect.set(topology.operation, "libraries", entries);
      Reflect.set(record.locus, "libraryOwnershipAdded", order.map(index => record.locus.libraryOwnershipAdded[index]!));
    };
    const schemaChangedDigest = registry_from_entries(initialAdd.map(entry => entry.name === "added"
      ? { ...entry, schema: any.toHson(), schemaDigest: hson_schema_digest(any) } : entry)).digest;
    const system = initialAdd.at(-1)!;
    const priorOnly = initialAdd.slice(0, -3);
    const [added, next] = initialAdd.slice(-3, -1);
    const reversedDigest = registry_from_entries([...priorOnly, next!, added!, system]).digest;
    const incompleteDigest = registry_from_entries([...priorOnly, added!, system]).digest;
    const changes = {
      "alternate Schema with original digests": setSchema,
      "alternate Schema with recomputed resulting digest": (record: LocusHostedAggregatePersistedCommit) => {
        setSchema(record);
        setResult(record, schemaChangedDigest);
      },
      "contradictory before digest": (record: LocusHostedAggregatePersistedCommit) => {
        Reflect.set(record.commit, "previousRegistryDigest", covered.checkpoint.registryDigest);
      },
      "contradictory resulting digest": (record: LocusHostedAggregatePersistedCommit) => {
        setResult(record, covered.checkpoint.registryDigest);
      },
      "reordered additions": (record: LocusHostedAggregatePersistedCommit) => {
        setOrder(record, [1, 0]);
        setResult(record, reversedDigest);
      },
      "missing addition": (record: LocusHostedAggregatePersistedCommit) => { setOrder(record, [0]); },
      "missing leading addition with recomputed before digest": (record: LocusHostedAggregatePersistedCommit) => {
        setOrder(record, [1]);
        Reflect.set(record.commit, "previousRegistryDigest", incompleteDigest);
      },
      "duplicated addition": (record: LocusHostedAggregatePersistedCommit) => { setOrder(record, [0, 0]); },
    };

    for (const [label, state, rev, count] of [
      ["replay", replay, 3, 1], ["covered", covered, 3, 1], ["covered plus tail", withTail, 4, 4],
    ] as const) {
      persistence.seed(logicalMapId, state);
      const resumed = await hsonLiveMap.locus.resume(startup, config);
      try {
        assert.equal(resumed.rev, rev);
        assert.equal(resumed.data.must("added").snap(["count"]), count);
        assert.equal(resumed.data.must("next").snap(["count"]), 2);
        const { registryDigest } = internal_livemap_aggregate_authority(locus_map_internal(resumed)).hostedPosition();
        assert.equal(registryDigest, covered.checkpoint.registryDigest);
      } finally { resumed.dispose(); }
      for (const [mutation, change] of Object.entries(changes)) {
        const bad = structuredClone(state);
        change(bad.commits[1]!);
        await assert.rejects(async () => {
          persistence.seed(logicalMapId, bad);
          (await hsonLiveMap.locus.resume(startup, config)).dispose();
        }, invalid, `${label}: ${mutation}`);
      }
    }

    // A truncated batch can be self-consistent in isolation. The next
    // retained fence must still require the complete historical batch.
    const truncated = structuredClone(withTail);
    setOrder(truncated.commits[1]!, [0]);
    setResult(truncated.commits[1]!, incompleteDigest);
    persistence.seed(logicalMapId, truncated);
    await assert.rejects(hsonLiveMap.locus.resume(startup, config), invalid);

    const shifted = structuredClone(covered);
    changes["missing leading addition with recomputed before digest"](shifted.commits[1]!);
    setResult(shifted.commits[0]!, incompleteDigest);
    persistence.seed(logicalMapId, shifted);
    await assert.rejects(hsonLiveMap.locus.resume(startup, config), invalid);
  });

  await run("covered scoped effects must retain their canonical operation encoding", async () => {
    const { config, locus } = await recovered_fixture("covered-scoped-recovery");
    const { persistence, logicalMapId } = config;
    await locus.stage(stage => stage.doc.must("page").at([0]).asElement().attrs.set("title", "durable"));
    persistence.failPrune = new Error("interrupted pruning");
    await assert.rejects(hsonLiveMap.locus.checkpoint(locus), { code: "LOCUS_PERSISTENCE_CHECKPOINT_FAILED" });
    locus.dispose();

    const state = persistence.state(logicalMapId)!;
    const valid = await hsonLiveMap.locus.resume(startup, config);
    try {
      assert.equal(valid.rev, 2);
      assert.equal(valid.doc.must("page").at([0]).asElement()?.attrs.get("title"), "durable");
    } finally { valid.dispose(); }
    const malformed = structuredClone(state);
    const effect = malformed.commits[1]!.commit.operations[0]!;
    assert.equal(effect.domain, "document");
    assert.ok("graph" in effect.effect);
    Reflect.set(effect.effect, "graph", ` ${effect.effect.graph}`);
    persistence.seed(logicalMapId, malformed);
    await assert.rejects(hsonLiveMap.locus.resume(startup, config), invalid);
  });

  for (const mode of ["working reporter", "throwing reporter getter", "throwing reporter function"] as const) {
    await run(`restore observers retain durable ownership with a ${mode}`, async () => {
      const { config, locus, snapshot, supplied } = await recovered_fixture("observer-recovery");
      locus.dispose();
      const map = supplied(), authority = internal_livemap_aggregate_authority(map);
      const observerFailure = new Error("restore observer");
      const reporterFailure = new Error(mode);
      const reports: unknown[] = [], asynchronous: unknown[] = [];
      const observations: unknown[] = [], attempts: unknown[] = [], commits: number[] = [];
      const observe = (phase: string) => {
        const captured = authority.captureSemanticCheckpoint();
        observations.push([phase, map.rev, captured.libraries.find(entry => entry.name === "page")?.root, captured.libraries.at(-1)!.root]);
        try { map.data.state.at(["count"]).set(99); }
        catch (cause) { attempts.push(cause); }
      };
      const stops = [
        authority.observeAuthorityPosition(() => observe("installed"), "installed"),
        authority.observeRestore(() => { throw observerFailure; }),
        authority.observeRestore(() => observe("restore")),
        authority.observeAuthorityPosition(() => observe("published")),
      ];
      const stopCommit = authority.observe(commit => { commits.push(commit.rev); });
      const priorReporter = Object.getOwnPropertyDescriptor(globalThis, "reportError");
      const reporter: PropertyDescriptor = mode === "throwing reporter getter"
        ? { get() { throw reporterFailure; } }
        : { value(this: unknown, error: unknown) {
          reports.push([this === globalThis, error]);
          if (mode === "throwing reporter function") throw reporterFailure;
        } };
      const captureUncaught = (error: unknown) => { asynchronous.push(error); };
      Object.defineProperty(globalThis, "reportError", { configurable: true, ...reporter });
      process.on("uncaughtException", captureUncaught);
      const resumed = await resume_registry_locus({
        ...config, map, libraries,
        actions: { advance({ stage }) { stage.data.state.at(["count"]).set(1); } },
      }).finally(() => {
        for (const stop of stops) stop();
        process.off("uncaughtException", captureUncaught);
        if (priorReporter === undefined) Reflect.deleteProperty(globalThis, "reportError");
        else Object.defineProperty(globalThis, "reportError", priorReporter);
      });
      try {
        assert.equal(resumed.rev, 1);
        const page = snapshot.libraries.find(entry => entry.name === "page")!.root;
        assert.deepEqual(observations, ["installed", "restore", "published"].map(phase => [phase, 1, page, snapshot.libraries.at(-1)!.root]));
        assert.equal(attempts.length, 3);
        const managed = { code: "LIVEMAP_MANAGED_MUTATION_REJECTED" };
        for (const attempt of attempts) assert.throws(() => { throw attempt; }, managed);
        assert.throws(() => map.data.state.at(["count"]).set(99), managed);
        assert.deepEqual(commits, []);
        assert.equal(config.persistence.appendCalls.length, 1);
        assert.deepEqual(asynchronous, mode === "working reporter" ? [] : [reporterFailure]);
        if (mode === "throwing reporter getter") assert.deepEqual(reports, []);
        else {
          assert.equal(reports.length, 1);
          const report = reports[0];
          assert.ok(Array.isArray(report) && report[0] === true && report[1] instanceof Error);
          assert.match(report[1].message, /restore observer failed after state acceptance/);
          assert.equal(report[1].cause, observerFailure);
        }
        const result = await resumed.dispatchAction({ type: "action", id: "advance", name: "advance" });
        assert.equal(result.ok, true);
        assert.equal(result.completionRev, 2);
        assert.equal(config.persistence.appendCalls.length, 2);
        const durableHead = config.persistence.state(config.logicalMapId)!.commits.at(-1)!.commit;
        assert.deepEqual([durableHead.prevRev, durableHead.rev, durableHead.registryDigest], [1, 2, authority.hostedPosition().registryDigest]);
        assert.equal(resumed.rev, 2);
        assert.deepEqual(commits, [2]);
      } finally { stopCommit(); resumed.dispose(); }
    });
  }

  await run("failed resume leaves the supplied map and restore observers untouched", async () => {
    const { config, locus, supplied } = await recovered_fixture("failed-recovery");
    locus.dispose();
    const map = supplied(), before = map.capture(), authority = internal_livemap_aggregate_authority(map);
    const position = authority.hostedPosition();
    let publications = 0;
    const stopInstalled = authority.observeAuthorityPosition(() => { publications++; }, "installed");
    const stopRestore = authority.observeRestore(() => { publications++; });
    const options = { ...config, map, libraries };
    const malformed = { ...options };
    Reflect.set(malformed, "actions", { malformed: false });
    await assert.rejects(resume_registry_locus(malformed), /requires an executable handler/);
    assert.equal(map.rev, before.revision, "handler rejection exposed the restored graph");
    assert.deepEqual(map.capture(), before);
    await assert.rejects(resume_registry_locus({ ...options, libraries: libraries.slice(0, 1) }), invalid);
    await assert.rejects(resume_registry_locus({ ...options, sessions: { graceMs: -1 } }), /graceMs/);

    const { persistence, logicalMapId } = config;
    const valid = persistence.state(logicalMapId)!;
    const manifest = valid.checkpoint;
    const chunks = manifest.chunks.map(descriptor => {
      if (descriptor.owner !== "state" || descriptor.part !== "root") return descriptor;
      const [replacement] = encode_checkpoint_chunks(manifest.checkpointId, manifest.rev,
        descriptor.owner, "root", hsonLiveMap.fromLibraries({ state: { json: { count: "wrong" } } }).data.state.root());
      persistence.chunks.set(descriptor.id, replacement!.chunk);
      return replacement!.descriptor;
    });
    persistence.seed(logicalMapId, { ...valid, checkpoint: { ...manifest, chunks } });
    await assert.rejects(resume_registry_locus(options), invalid);
    assert.deepEqual(map.capture(), before);
    assert.deepEqual(authority.hostedPosition(), position);
    assert.equal(publications, 0);
    stopInstalled();
    stopRestore();
    map.data.state.at(["count"]).set(3);
    assert.equal(map.rev, 1);
  });
}
