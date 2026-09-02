import assert from "node:assert/strict";
import { Hson, hson, hsonLiveMap, validate_document_path, type HsonSchema } from "../src/index.ts";
import type { HsonNode } from "../src/core/types.ts";
import type { LiveMapGraphOp } from "../src/types/livemap.types.ts";
import { LocusPersistenceError } from "../src/api/locus/locus.persistence.error.ts";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";
import { encode_hosted_root } from "../src/api/livemap/livemap.hosted.ts";
import {
  create_persistent_locus_hosted_aggregate_internal,
  load_persistent_locus_hosted_aggregate_internal,
  restore_persistent_locus_hosted_aggregate_internal,
  type LocusHostedAggregatePersistenceAdapter,
  type LocusHostedAggregatePersistedCheckpoint,
  type LocusHostedAggregatePersistedCommit,
  type LocusHostedAggregatePersistedState,
} from "../src/api/locus/locus.hosted-multi-library.persistence.ts";
import type {
  LocusHostedAggregateDataDraft,
  LocusHostedAggregateDocumentDraft,
  LocusHostedAggregateDraft,
} from "../src/api/locus/locus.hosted-multi-library.ts";
import { create_test_event_emitter } from "./test-events.mjs";

const StateSchema: HsonSchema = Hson`<type "data" content <theme "string" count <number <int true min 0>>>>`;
const ColorsSchema: HsonSchema = Hson`<type "data" content <accent "string">>`;
const PageSchema: HsonSchema = Hson`<type "document" tag "main" content <repeat <tag "item" content "empty">>>`;
const RETIRED_QUID = "000008301";
const ACTIVE_QUID = "000008302";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "locus.hosted-multi-library-h4",
  title: "Hosted multi-library H4",
  category: "Locus",
  runtime: "node",
  tags: Object.freeze(["locus", "livemap", "libraries", "hosted", "h4"]),
});

const testEvents = create_test_event_emitter("locus.hosted-multi-library-h4");
let checks = 0;
async function check(name: string, run: () => void | Promise<void>): Promise<void> {

  testEvents.case_begin(name, name);
  try {
    await run();
    testEvents.case_end(name, "pass");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Check failed.";
    testEvents.diagnostic(name, "assertion", message.slice(0, 1_000));
    testEvents.case_end(name, "fail");
    testEvents.terminal("fail");
    throw error;
  }
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function deferred(): Readonly<{ promise: Promise<void>; resolve: () => void }> {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return Object.freeze({ promise, resolve });
}

async function tick(): Promise<void> {
  await new Promise<void>((done) => { setTimeout(done, 0); });
}

function make_map() {
  return hsonLiveMap.fromLibraries({
    state: { data: { theme: "light", count: 0 }, schema: StateSchema },
    colors: { data: { accent: "#000" }, schema: ColorsSchema },
    page: { document: "<main/>", schema: PageSchema },
  });
}

function data(draft: LocusHostedAggregateDraft, name: string): LocusHostedAggregateDataDraft {
  const library = draft.lib(name);
  if (!("at" in library)) throw new Error(`Expected data Library ${name}.`);
  return library;
}

function document(draft: LocusHostedAggregateDraft, name: string): LocusHostedAggregateDocumentDraft {
  const library = draft.lib(name);
  if (!("graph" in library)) throw new Error(`Expected document Library ${name}.`);
  return library;
}

function insert_item(quid: string): LiveMapGraphOp {
  return Object.freeze({
    domain: "graph" as const,
    op: "insert-content" as const,
    target: Object.freeze({ kind: "path" as const, path: validate_document_path([0]) }),
    index: 0,
    content: {
      $_tag: "_hson_elem",
      $_content: [{ $_tag: "item", $_meta: { quid }, $_content: [] }],
    } satisfies HsonNode,
  });
}

function remove_item(): LiveMapGraphOp {
  return Object.freeze({
    domain: "graph" as const,
    op: "remove-content" as const,
    target: Object.freeze({ kind: "path" as const, path: validate_document_path([0]) }),
    index: 0,
  });
}

class MemoryPersistenceAdapter implements LocusHostedAggregatePersistenceAdapter {
  private readonly states = new Map<string, LocusHostedAggregatePersistedState>();
  failAppend: Error | undefined;
  nextCheckpoint: ReturnType<typeof deferred> | undefined;
  readonly appendCalls: LocusHostedAggregatePersistedCommit[] = [];
  readonly checkpointCalls: LocusHostedAggregatePersistedCheckpoint[] = [];

  deferCheckpoint(): ReturnType<typeof deferred> {
    const pending = deferred();
    this.nextCheckpoint = pending;
    return pending;
  }

  async load(logicalMapId: string): Promise<LocusHostedAggregatePersistedState | undefined> {
    return this.state(logicalMapId);
  }

  async appendCommit(record: LocusHostedAggregatePersistedCommit): Promise<void> {
    this.appendCalls.push(structuredClone(record));
    if (this.failAppend !== undefined) {
      const failure = this.failAppend;
      this.failAppend = undefined;
      throw failure;
    }
    const state = this.states.get(record.logicalMapId);
    if (state === undefined) throw new Error("Checkpoint required.");
    if (state.checkpoint.incarnationId !== record.incarnationId) throw new Error("Incarnation fence mismatch.");
    if (state.checkpoint.mapKind !== record.mapKind) throw new Error("Map-kind fence mismatch.");
    const expected = state.commits.at(-1)?.commit.rev ?? state.checkpoint.rev;
    if (record.commit.prevRev !== expected || record.commit.rev !== expected + 1) {
      throw new Error("Global commit tail is not contiguous.");
    }
    this.states.set(record.logicalMapId, Object.freeze({
      checkpoint: state.checkpoint,
      commits: Object.freeze([...state.commits, structuredClone(record)]),
    }));
  }

  async replaceCheckpoint(record: LocusHostedAggregatePersistedCheckpoint): Promise<void> {
    this.checkpointCalls.push(structuredClone(record));
    const pending = this.nextCheckpoint;
    this.nextCheckpoint = undefined;
    if (pending !== undefined) await pending.promise;
    const prior = this.states.get(record.logicalMapId);
    const commits = prior !== undefined && prior.checkpoint.incarnationId === record.incarnationId
      ? prior.commits.filter((commit) => commit.commit.rev > record.rev)
      : [];
    this.states.set(record.logicalMapId, Object.freeze({
      checkpoint: structuredClone(record),
      commits: Object.freeze(structuredClone(commits)),
    }));
  }

  state(logicalMapId: string): LocusHostedAggregatePersistedState | undefined {
    const state = this.states.get(logicalMapId);
    return state === undefined ? undefined : structuredClone(state);
  }
}

await check("initial H4 checkpoint is one exact aggregate H1 snapshot and one atomic cross-library mutation appends one exact tail record", async () => {
  const adapter = new MemoryPersistenceAdapter();
  const map = make_map();
  const host = await create_persistent_locus_hosted_aggregate_internal({
    map,
    persistence: adapter,
    logicalMapId: "h4-global-cut",
    incarnationId: "h4-global-cut-incarnation",
  });
  const initial = adapter.state("h4-global-cut")!;
  assert.equal(initial.checkpoint.mapKind, "hosted-aggregate");
  if (initial.checkpoint.mapKind !== "hosted-aggregate") throw new Error("Expected aggregate checkpoint.");
  assert.equal(initial.checkpoint.snapshot.format, "hson-hosted-snapshot");
  assert.equal(initial.checkpoint.snapshot.registry.format, "hson-hosted-registry");
  assert.equal(initial.checkpoint.snapshot.authority.logicalMapId.startsWith("h1-"), false);
  assert.equal(initial.checkpoint.snapshot.authority.incarnationId.startsWith("h1-"), false);
  const oldSnapshot = structuredClone(initial.checkpoint.snapshot) as any;
  oldSnapshot.format = "hson-hosted-snapshot-h1";
  assert.throws(() => internal_livemap_aggregate_authority(make_map()).restoreHosted(oldSnapshot), /format|snapshot/i);
  const oldRegistry = structuredClone(initial.checkpoint.snapshot) as any;
  oldRegistry.registry.format = "hson-hosted-registry-h1";
  assert.throws(() => internal_livemap_aggregate_authority(make_map()).restoreHosted(oldRegistry), /format|registry/i);
  assert.deepEqual(initial.checkpoint.snapshot, internal_livemap_aggregate_authority(map).captureHosted());
  assert.deepEqual(initial.commits, []);

  const accepted = await host.mutate((draft) => {
    data(draft, "state").at(["theme"]).set("dark");
    data(draft, "colors").at(["accent"]).set("#fff");
    document(draft, "page").graph(insert_item(ACTIVE_QUID));
  });
  assert.equal(accepted?.prevRev, 0);
  assert.equal(accepted?.rev, 1);
  const persisted = adapter.state("h4-global-cut")!;
  assert.equal(persisted.commits.length, 1);
  const tail = persisted.commits[0]!;
  assert.equal(tail.mapKind, "hosted-aggregate");
  if (tail.mapKind !== "hosted-aggregate") throw new Error("Expected aggregate tail.");
  assert.deepEqual(tail.commit, accepted);
  assert.deepEqual(tail.commit.operations.map((operation) => operation.library), ["state", "colors", "page"]);
  assert.equal(map.rev, 1);
  host.dispose();
});

await check("append failure and an invalid later library leave the entire aggregate and durable tail unchanged", async () => {
  const adapter = new MemoryPersistenceAdapter();
  const map = make_map();
  const host = await create_persistent_locus_hosted_aggregate_internal({ map, persistence: adapter });
  const before = internal_livemap_aggregate_authority(map).captureHosted();
  const wires: string[] = [];
  host.on_wire((wire) => wires.push(wire));
  adapter.failAppend = new Error("durability unavailable");
  await assert.rejects(
    () => host.mutate((draft) => document(draft, "page").graph(insert_item(ACTIVE_QUID))),
    (error: unknown) => error instanceof LocusPersistenceError && error.code === "LOCUS_PERSISTENCE_APPEND_FAILED",
  );
  assert.deepEqual(internal_livemap_aggregate_authority(map).captureHosted(), before);
  assert.equal(adapter.state(host.logicalMapId)?.commits.length, 0);
  assert.deepEqual(wires, []);

  await assert.rejects(
    () => host.mutate((draft) => {
      data(draft, "state").at(["theme"]).set("dark");
      data(draft, "colors").at(["accent"]).set(1 as never);
    }),
    /schema/i,
  );
  assert.deepEqual(internal_livemap_aggregate_authority(map).captureHosted(), before);
  assert.equal(adapter.state(host.logicalMapId)?.commits.length, 0);
  host.dispose();
});

await check("checkpoint is an aggregate FIFO barrier: it captures one prior global cut and then admits the queued mutation", async () => {
  const adapter = new MemoryPersistenceAdapter();
  const map = make_map();
  const host = await create_persistent_locus_hosted_aggregate_internal({ map, persistence: adapter });
  await host.mutate((draft) => data(draft, "state").at(["count"]).set(1));
  const pending = adapter.deferCheckpoint();
  const checkpoint = host.checkpoint();
  await tick();
  const queued = host.mutate((draft) => {
    data(draft, "colors").at(["accent"]).set("#fff");
    document(draft, "page").graph(insert_item(ACTIVE_QUID));
  });
  await tick();
  assert.equal(map.rev, 1);
  pending.resolve();
  await checkpoint;
  const atBarrier = adapter.state(host.logicalMapId)!;
  assert.equal(atBarrier.checkpoint.rev, 1);
  assert.equal(atBarrier.commits.length, 0);
  await queued;
  const after = adapter.state(host.logicalMapId)!;
  assert.equal(after.checkpoint.rev, 1);
  assert.equal(after.commits.length, 1);
  assert.equal(after.commits[0]?.commit.prevRev, 1);
  assert.equal(map.rev, 2);
  host.dispose();
});

await check("checkpoint-pruned retired QUID state survives restart and rejects ABA reuse through the durable load path", async () => {
  const adapter = new MemoryPersistenceAdapter();
  const map = make_map();
  const host = await create_persistent_locus_hosted_aggregate_internal({
    map,
    persistence: adapter,
    logicalMapId: "h4-restart",
    incarnationId: "h4-restart-incarnation",
  });
  await host.mutate((draft) => document(draft, "page").graph(insert_item(RETIRED_QUID)));
  await host.mutate((draft) => document(draft, "page").graph(remove_item()));
  await host.checkpoint();
  const persisted = adapter.state("h4-restart")!;
  assert.equal(persisted.checkpoint.rev, 2);
  assert.equal(persisted.commits.length, 0);
  host.dispose();

  const restored = await load_persistent_locus_hosted_aggregate_internal(
    "h4-restart",
    { persistence: adapter },
  );
  if (restored === undefined) throw new Error("Expected persisted hosted aggregate state.");
  const snapshot = internal_livemap_aggregate_authority(restored.map).captureHosted();
  const page = restored.map.lib("page");
  if (!("document" in page)) throw new Error("Expected restored document Library.");
  assert.equal(page.document.byQuid(RETIRED_QUID), undefined);
  assert.equal(snapshot.identity.issuedQuids.includes(RETIRED_QUID), true);
  await assert.rejects(
    () => restored.mutate((draft) => document(draft, "page").graph(insert_item(RETIRED_QUID))),
    /QUID|reuse|identity/i,
  );
  assert.equal(restored.rev, 2);
  assert.equal(adapter.state("h4-restart")?.commits.length, 0);
  restored.dispose();
});

await check("digest and authority mismatches in checkpoint or tail reject before a restarted aggregate authority is admitted", async () => {
  const adapter = new MemoryPersistenceAdapter();
  const map = make_map();
  const host = await create_persistent_locus_hosted_aggregate_internal({
    map,
    persistence: adapter,
    logicalMapId: "h4-fences",
    incarnationId: "h4-fences-incarnation",
  });
  await host.mutate((draft) => data(draft, "state").at(["theme"]).set("dark"));
  const valid = adapter.state("h4-fences")!;
  host.dispose();

  const badCheckpoint = structuredClone(valid) as any;
  badCheckpoint.checkpoint.registryDigest = "0".repeat(64);
  await assert.rejects(
    () => restore_persistent_locus_hosted_aggregate_internal("h4-fences", badCheckpoint, { persistence: adapter }),
    (error: unknown) => error instanceof LocusPersistenceError && error.code === "LOCUS_PERSISTED_STATE_INVALID",
  );

  const badSchemaRoot = structuredClone(valid) as any;
  badSchemaRoot.checkpoint.snapshot.libraries[0].root = encode_hosted_root(
    hson.fromJson({ theme: 1, count: 0 }).toNode(),
  );
  await assert.rejects(
    () => restore_persistent_locus_hosted_aggregate_internal("h4-fences", badSchemaRoot, { persistence: adapter }),
    (error: unknown) => error instanceof LocusPersistenceError && error.code === "LOCUS_PERSISTED_STATE_INVALID",
  );

  const badTail = structuredClone(valid) as any;
  badTail.commits[0].registryDigest = "0".repeat(64);
  await assert.rejects(
    () => restore_persistent_locus_hosted_aggregate_internal("h4-fences", badTail, { persistence: adapter }),
    (error: unknown) => error instanceof LocusPersistenceError && error.code === "LOCUS_PERSISTED_STATE_INVALID",
  );
});

process.stdout.write(`1..${checks}\n`);
process.stdout.write(`Hosted multi-library H4 acceptance: ${checks}/${checks}\n`);
testEvents.terminal("pass");
