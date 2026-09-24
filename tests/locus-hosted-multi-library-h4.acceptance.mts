import assert from "node:assert/strict";
import { Hson, hsonLiveMap, enable_interactions, add_interaction, type HsonSchema, type InteractionDescriptor } from "../src/index.ts";
import { validate_document_path } from "../src/api/livemap/index.ts";
import type { HsonNode } from "../src/core/types.ts";
import { is_Node } from "../src/core/node-guards.ts";
import { projected_value_from_hson_node } from "../src/core/projected-value-graph.ts";
import { materialize_projected_value } from "../src/core/projected-value-materialization.ts";
import type { LiveMapGraphOp } from "../src/types/livemap.types.ts";
import { LocusPersistenceError } from "../src/api/locus/locus.persistence.error.ts";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";
import {
  create_persistent_locus_hosted_aggregate_internal,
  load_persistent_locus_hosted_aggregate_internal,
  restore_persistent_locus_hosted_aggregate_internal,
} from "../src/api/locus/locus.aggregate.persistence.ts";
import type {
  LocusHostedAggregateDataDraft,
  LocusHostedAggregateDocumentDraft,
  LocusHostedAggregateDraft,
} from "../src/api/locus/locus.aggregate.ts";
import { create_test_event_emitter } from "./test-events.mjs";
import { MemoryCheckpointAdapter } from "./helpers/memory-checkpoint-adapter.mts";

const StateSchema: HsonSchema = Hson.schema`<type "data" content <theme "string" count <number <int true min 0>>>>`;
const ColorsSchema: HsonSchema = Hson.schema`<type "data" content <accent "string">>`;
const PageSchema: HsonSchema = Hson.schema`<type "document" tag "main" content <repeat <tag "item" content "empty">>>`;
const ButtonSchema: HsonSchema = Hson.schema`<type "document" tag "main" content <repeat <tag "button" content "empty">>>`;
const RETIRED_QUID = "000008301";
const ACTIVE_QUID = "000008302";
const LOCAL_DOCUMENT_QUID = "000008303";
const LOCAL_DATA_QUID = "000008304";
const RESTART_DOCUMENT_QUID = "000008305";
const RESTART_DATA_QUID = "000008306";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "locus.aggregate-h4",
  title: "Hosted multi-library H4",
  category: "Locus",
  runtime: "node",
  tags: Object.freeze(["locus", "livemap", "libraries", "hosted", "h4"]),
});

const testEvents = create_test_event_emitter("locus.aggregate-h4");
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

function insert_item(quid?: string): Extract<LiveMapGraphOp, Readonly<{ op: "insert-content" }>> {
  return Object.freeze({
    domain: "graph" as const,
    op: "insert-content" as const,
    target: Object.freeze({ kind: "path" as const, path: validate_document_path([0]) }),
    index: 0,
    content: {
      $_tag: "_hson_elem",
      $_content: [{ $_tag: "item", ...(quid === undefined ? {} : { $_meta: { quid } }), $_content: [] }],
    } satisfies HsonNode,
  });
}

function remove_item(): Extract<LiveMapGraphOp, Readonly<{ op: "remove-content" }>> {
  return Object.freeze({
    domain: "graph" as const,
    op: "remove-content" as const,
    target: Object.freeze({ kind: "path" as const, path: validate_document_path([0]) }),
    index: 0,
  });
}

function interaction_paths(map: ReturnType<typeof hsonLiveMap.fromLibraries>): readonly number[][] {
  const authority = internal_livemap_aggregate_authority(map);
  const system = authority.systemState("@hson/canonical-interactions/v1");
  if (system === undefined) throw new Error("Missing transactional interaction state.");
  const value = materialize_projected_value(projected_value_from_hson_node(authority.systemRoot(system)));
  if (typeof value !== "object" || value === null || Array.isArray(value) || !Array.isArray(value.descriptors)) {
    throw new Error("Invalid interaction state.");
  }
  return value.descriptors.map((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)
      || typeof entry.subject !== "object" || entry.subject === null || Array.isArray(entry.subject)
      || !Array.isArray(entry.subject.path)
      || !entry.subject.path.every((part): part is number => typeof part === "number")) throw new Error("Invalid interaction subject.");
    return entry.subject.path;
  });
}

class MemoryPersistenceAdapter extends MemoryCheckpointAdapter {
  deferCheckpoint(): ReturnType<typeof deferred> {
    const pending = deferred();
    this.pendingChunk = pending;
    return pending;
  }
}

await check("initial durable aggregate cut and atomic cross-library tail omit generated identity", async () => {
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
  assert.equal(initial.checkpoint.format, "hson-locus-durable-aggregate-checkpoint-v2");
  if (initial.checkpoint.format !== "hson-locus-durable-aggregate-checkpoint-v2") throw new Error("Expected v2 checkpoint.");
  assert.equal(initial.checkpoint.registry.format, "hson-hosted-registry");
  assert.equal(initial.checkpoint.logicalMapId.startsWith("h1-"), false);
  assert.equal(initial.checkpoint.incarnationId.startsWith("h1-"), false);
  assert.equal("identity" in initial.checkpoint, false);
  assert.equal(JSON.stringify(initial.checkpoint).includes("issuedQuids"), false);
  assert.ok(initial.checkpoint.chunks.length > 0);
  assert.deepEqual(initial.commits, []);

  const accepted = await host.mutate((draft) => {
    data(draft, "state").at(["theme"]).set("dark");
    data(draft, "colors").at(["accent"]).set("#fff");
    document(draft, "page").graph(insert_item());
  });
  assert.equal(accepted?.prevRev, 0);
  assert.equal(accepted?.rev, 1);
  const persisted = adapter.state("h4-global-cut")!;
  assert.equal(persisted.commits.length, 1);
  const tail = persisted.commits[0]!;
  assert.equal(tail.mapKind, "hosted-aggregate");
  if (tail.mapKind !== "hosted-aggregate") throw new Error("Expected aggregate tail.");
  assert.equal(tail.commit.format, "hson-livemap-durable-commit-v1");
  assert.equal(JSON.stringify(tail).includes(ACTIVE_QUID), false);
  assert.equal(JSON.stringify(tail).includes("ensure-quid"), false);
  assert.deepEqual(tail.commit.operations.map((operation) => operation.library), ["state", "colors", "page"]);
  assert.equal(map.rev, 1);
  host.dispose();
});

await check("append failure and an invalid later library leave the entire aggregate and durable tail unchanged", async () => {
  const adapter = new MemoryPersistenceAdapter();
  const map = make_map();
  const host = await create_persistent_locus_hosted_aggregate_internal({ map, persistence: adapter });
  const before = internal_livemap_aggregate_authority(map).captureHosted();
  const accepted: unknown[] = [];
  host.on_commit((commit) => accepted.push(commit));
  adapter.failAppend = new Error("durability unavailable");
  await assert.rejects(
    () => host.mutate((draft) => document(draft, "page").graph(insert_item())),
    (error: unknown) => error instanceof LocusPersistenceError && error.code === "LOCUS_PERSISTENCE_APPEND_FAILED",
  );
  assert.deepEqual(internal_livemap_aggregate_authority(map).captureHosted(), before);
  assert.equal(adapter.state(host.logicalMapId)?.commits.length, 0);
  assert.deepEqual(accepted, []);

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

await check("checkpoint captures one revision while later commits remain in the durable tail", async () => {
  const adapter = new MemoryPersistenceAdapter();
  const map = make_map();
  const host = await create_persistent_locus_hosted_aggregate_internal({ map, persistence: adapter });
  await host.mutate((draft) => data(draft, "state").at(["count"]).set(1));
  const pending = adapter.deferCheckpoint();
  const checkpoint = host.checkpoint();
  await tick();
  const queued = host.mutate((draft) => {
    data(draft, "colors").at(["accent"]).set("#fff");
    document(draft, "page").graph(insert_item());
  });
  await tick();
  assert.equal(map.rev, 2);
  pending.resolve();
  await checkpoint;
  const atBarrier = adapter.state(host.logicalMapId)!;
  assert.equal(atBarrier.checkpoint.rev, 1);
  assert.equal(atBarrier.commits.length, 1);
  await queued;
  const after = adapter.state(host.logicalMapId)!;
  assert.equal(after.checkpoint.rev, 1);
  assert.equal(after.commits.length, 1);
  assert.equal(after.commits[0]?.commit.prevRev, 1);
  assert.equal(map.rev, 2);
  host.dispose();
});

await check("checkpoint-pruned generated identity is absent after fresh-runtime restart", async () => {
  const adapter = new MemoryPersistenceAdapter();
  const map = make_map();
  const host = await create_persistent_locus_hosted_aggregate_internal({
    map,
    persistence: adapter,
    logicalMapId: "h4-restart",
    incarnationId: "h4-restart-incarnation",
  });
  await host.mutate((draft) => document(draft, "page").graph(insert_item()));
  const localAuthority = internal_livemap_aggregate_authority(map);
  const localPage = localAuthority.libraries()[2];
  if (localPage === undefined) throw new Error("Expected document Library.");
  localAuthority.acquireLocalDocumentIdentity(localPage, validate_document_path([0, 0, 0]), RETIRED_QUID);
  await host.mutate((draft) => document(draft, "page").graph(remove_item()));
  const oldOwner = internal_livemap_aggregate_authority(map).identityEpoch().owner;
  await host.checkpoint();
  const persisted = adapter.state("h4-restart")!;
  assert.equal(persisted.checkpoint.rev, 2);
  assert.equal(persisted.commits.length, 0);
  assert.equal(JSON.stringify(persisted.checkpoint).includes(RETIRED_QUID), false);
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
  assert.equal(snapshot.identity.issuedQuids.includes(RETIRED_QUID), false);
  assert.notEqual(internal_livemap_aggregate_authority(restored.map).identityEpoch().owner, oldOwner);
  assert.equal(restored.rev, 2);
  assert.equal(adapter.state("h4-restart")?.commits.length, 0);
  restored.dispose();
});

await check("local document and data identity leave durable checkpoint and history unchanged across restart", async () => {
  const adapter = new MemoryPersistenceAdapter();
  const map = make_map();
  const host = await create_persistent_locus_hosted_aggregate_internal({
    map, persistence: adapter, logicalMapId: "h4-local-identity", incarnationId: "h4-local-incarnation",
  });
  const authority = internal_livemap_aggregate_authority(map);
  const [state, , page] = authority.libraries();
  if (state === undefined || page === undefined) throw new Error("Expected fixed registry.");
  const before = adapter.state(host.logicalMapId)!;
  const appendCount = adapter.appendCalls.length;
  authority.acquireLocalDocumentIdentity(page, validate_document_path([0]), LOCAL_DOCUMENT_QUID);
  authority.acquireLocalProjectedIdentity(state, [], LOCAL_DATA_QUID);
  assert.equal(host.rev, 0);
  assert.equal(adapter.appendCalls.length, appendCount);
  assert.equal(adapter.state(host.logicalMapId)?.checkpoint.rev, before.checkpoint.rev);
  await host.checkpoint();
  assert.equal(adapter.state(host.logicalMapId)?.checkpoint.rev, before.checkpoint.rev);
  assert.equal(authority.resolveQuid(LOCAL_DOCUMENT_QUID)?.path.join("/"), "0");
  assert.deepEqual(authority.resolveQuid(LOCAL_DATA_QUID)?.path, []);
  const oldOwner = authority.identityEpoch().owner;
  host.dispose();

  const restored = await load_persistent_locus_hosted_aggregate_internal("h4-local-identity", { persistence: adapter });
  if (restored === undefined) throw new Error("Expected restored map.");
  const fresh = internal_livemap_aggregate_authority(restored.map);
  assert.notEqual(fresh.identityEpoch().owner, oldOwner);
  assert.equal(fresh.identityEpoch().issued().size, 0);
  assert.equal(fresh.resolveQuid(LOCAL_DOCUMENT_QUID), undefined);
  assert.equal(fresh.resolveQuid(LOCAL_DATA_QUID), undefined);
  const [freshState, , freshPage] = fresh.libraries();
  if (freshState === undefined || freshPage === undefined) throw new Error("Expected restored registry.");
  const beforeRestartDemand = adapter.state(restored.logicalMapId)!;
  fresh.acquireLocalDocumentIdentity(freshPage, validate_document_path([0]), RESTART_DOCUMENT_QUID);
  fresh.acquireLocalProjectedIdentity(freshState, [], RESTART_DATA_QUID);
  assert.equal(restored.rev, 0);
  assert.equal(fresh.resolveQuid(RESTART_DOCUMENT_QUID)?.path.join("/"), "0");
  assert.deepEqual(fresh.resolveQuid(RESTART_DATA_QUID)?.path, []);
  assert.equal(adapter.state(restored.logicalMapId)?.checkpoint.rev, beforeRestartDemand.checkpoint.rev);
  await restored.checkpoint();
  assert.equal(adapter.state(restored.logicalMapId)?.checkpoint.rev, beforeRestartDemand.checkpoint.rev);
  restored.dispose();
});

await check("legacy exact aggregate checkpoint rejects before runtime construction", async () => {
  const adapter = new MemoryPersistenceAdapter();
  const map = make_map();
  const host = await create_persistent_locus_hosted_aggregate_internal({ map, persistence: adapter, logicalMapId: "h4-legacy" });
  const current = adapter.state("h4-legacy")!;
  const old = structuredClone(current) as any;
  old.checkpoint.format = "hson-locus-durable-aggregate-checkpoint-v1";
  host.dispose();
  await assert.rejects(
    () => restore_persistent_locus_hosted_aggregate_internal("h4-legacy", old, { persistence: adapter }),
    /invalid/i,
  );
});

await check("fresh-runtime local identity follows movement and explicit replacement lineage after restart", async () => {
  const adapter = new MemoryPersistenceAdapter();
  const map = make_map();
  const host = await create_persistent_locus_hosted_aggregate_internal({
    map, persistence: adapter, logicalMapId: "h4-lineage", incarnationId: "h4-lineage-incarnation",
  });
  await host.mutate((draft) => document(draft, "page").graph(insert_item()));
  await host.mutate((draft) => document(draft, "page").graph({
    domain: "graph", op: "insert-content", target: { kind: "path", path: validate_document_path([0, 0]) },
    index: 1, content: { $_tag: "item", $_content: [] },
  }));
  await host.checkpoint();
  assert.equal(adapter.state(host.logicalMapId)?.checkpoint.rev, 2);
  host.dispose();

  const restored = await load_persistent_locus_hosted_aggregate_internal("h4-lineage", { persistence: adapter });
  if (restored === undefined) throw new Error("Expected checkpoint restore.");
  const authority = internal_livemap_aggregate_authority(restored.map);
  const page = authority.libraries()[2];
  if (page === undefined) throw new Error("Expected document Library.");
  assert.equal(authority.resolveQuid("000008307"), undefined);
  authority.acquireLocalDocumentIdentity(page, validate_document_path([0, 0, 0]), RESTART_DOCUMENT_QUID);
  assert.equal(restored.rev, 2);
  await restored.mutate((draft) => document(draft, "page").graph({
    domain: "graph", op: "move-content", target: { kind: "path", path: validate_document_path([0, 0]) }, from: 0, to: 1,
  }));
  assert.deepEqual(authority.resolveQuid(RESTART_DOCUMENT_QUID)?.path, [0, 0, 1]);
  await restored.mutate((draft) => document(draft, "page").graph({
    domain: "graph", op: "replace-content", target: { kind: "path", path: validate_document_path([0, 0]) },
    index: 1, replacement: { $_tag: "item", $_attrs: { title: "continued" }, $_content: [] },
    lineage: [{ source: validate_document_path([]), destination: validate_document_path([]) }],
  }));
  assert.equal(restored.rev, 4);
  assert.equal(authority.resolveQuid(RESTART_DOCUMENT_QUID)?.path.join("/"), "0/0/1");
  const durable = adapter.state(restored.logicalMapId)!;
  assert.equal(durable.commits.length, 2);
  assert.equal(JSON.stringify(durable).includes(RESTART_DOCUMENT_QUID), false);
  assert.equal(JSON.stringify(durable.commits[1]).includes("lineage"), true);
  restored.dispose();

  const replayed = await load_persistent_locus_hosted_aggregate_internal("h4-lineage", { persistence: adapter });
  if (replayed === undefined) throw new Error("Expected tail replay.");
  assert.equal(replayed.rev, 4);
  const replayAuthority = internal_livemap_aggregate_authority(replayed.map);
  assert.equal(replayAuthority.resolveQuid(RESTART_DOCUMENT_QUID), undefined);
  const root = replayed.map.lib("page").root();
  const main = root.$_content[0];
  if (!is_Node(main)) throw new Error("Expected restored main.");
  const wrapper = main.$_content[0];
  if (!is_Node(wrapper)) throw new Error("Expected restored wrapper.");
  const item = wrapper.$_content[1];
  if (!is_Node(item)) throw new Error("Expected restored item.");
  assert.equal(item.$_attrs?.title, "continued");
  await replayed.checkpoint();
  assert.equal(JSON.stringify(adapter.state(replayed.logicalMapId)).includes(RESTART_DOCUMENT_QUID), false);
  const replayPage = replayAuthority.libraries()[2];
  if (replayPage === undefined) throw new Error("Expected replayed document Library.");
  replayAuthority.acquireLocalDocumentIdentity(replayPage, validate_document_path([0, 0, 1]), "000008309");
  await replayed.mutate((draft) => document(draft, "page").graph({
    domain: "graph", op: "remove-content", target: { kind: "path", path: validate_document_path([0, 0]) }, index: 1,
  }));
  assert.equal(replayAuthority.resolveQuid("000008309"), undefined);
  await assert.rejects(() => replayed.mutate((draft) => document(draft, "page").graph({
    domain: "graph", op: "insert-content", target: { kind: "path", path: validate_document_path([0, 0]) },
    index: 1, content: { $_tag: "item", $_meta: { quid: "000008309" }, $_content: [] },
  })), /QUID|reuse|identity/i);
  assert.equal(replayed.rev, 5);
  replayed.dispose();
});

await check("transactional interaction state and path descriptors survive checkpoint-plus-tail restart", async () => {
  const adapter = new MemoryPersistenceAdapter();
  const map = hsonLiveMap.fromLibraries({
    page: { document: "<main <button id=one/> <button id=two/>/>", schema: ButtonSchema },
  });
  enable_interactions(map);
  const listener: InteractionDescriptor["listener"] = Object.freeze({
    event: "click", target: "element", capture: false, once: false, passive: false,
    missingTarget: "ignore", preventDefault: false, stopPropagation: false, stopImmediatePropagation: false,
  });
  const interaction: InteractionDescriptor = Object.freeze({
    id: "persisted-click", subject: { library: "page", path: [0, 0, 1] },
    listener,
    kind: "browser-local", key: "run", args: null,
  });
  add_interaction(map, interaction);
  const host = await create_persistent_locus_hosted_aggregate_internal({
    map, persistence: adapter,
  });
  const checkpointRev = host.rev;
  assert.deepEqual(interaction_paths(map), [[0, 0, 1]]);
  await host.mutate((draft) => document(draft, "page").graph({
    domain: "graph", op: "move-content", target: { kind: "path", path: validate_document_path([0, 0]) }, from: 1, to: 0,
  }));
  assert.equal(host.rev, checkpointRev + 1);
  assert.deepEqual(interaction_paths(map), [[0, 0, 0]]);
  const persisted = adapter.state(host.logicalMapId)!;
  assert.equal(persisted.commits.length, 1);
  assert.equal(JSON.stringify(persisted).includes("issuedQuids"), false);
  host.dispose();

  const restored = await load_persistent_locus_hosted_aggregate_internal(host.logicalMapId, { persistence: adapter });
  if (restored === undefined) throw new Error("Expected interaction restore.");
  assert.equal(restored.rev, checkpointRev + 1);
  assert.equal(restored.registryDigest, persisted.checkpoint.registryDigest);
  assert.deepEqual(interaction_paths(restored.map), [[0, 0, 0]]);
  await restored.checkpoint();
  assert.equal(adapter.state(restored.logicalMapId)?.commits.length, 0);
  assert.equal(JSON.stringify(adapter.state(restored.logicalMapId)).includes("issuedQuids"), false);
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

  const badChunk = structuredClone(valid) as any;
  badChunk.checkpoint.chunks[0].sha256 = "0".repeat(64);
  await assert.rejects(
    () => restore_persistent_locus_hosted_aggregate_internal("h4-fences", badChunk, { persistence: adapter }),
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
