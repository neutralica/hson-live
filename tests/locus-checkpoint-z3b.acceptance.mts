import assert from "node:assert/strict";
import { Hson, add_interaction, enable_interactions, hsonEcho, hsonLiveMap,
  type HsonSchema, type InteractionDescriptor } from "../src/index.ts";
import { create_persistent_locus } from "../src/api/locus/index.ts";
import { validate_document_path } from "../src/api/livemap/index.ts";
import type { LocusSocketLike } from "../src/types/locus.types.ts";
import type { HsonNode } from "../src/core/types.ts";
import { capture_selected_authority_projection_snapshot } from "../src/api/locus/locus.authority-projection-snapshot.ts";
import { make_locus_hosted_projection_policy, normalize_locus_effective_projection } from "../src/api/locus/locus.projection.ts";
import {
  create_persistent_locus_hosted_aggregate_internal,
  load_persistent_locus_hosted_aggregate_internal,
  type LocusHostedAggregatePersistedManifest,
} from "../src/api/locus/locus.aggregate.persistence.ts";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";
import { MemoryCheckpointAdapter } from "./helpers/memory-checkpoint-adapter.mts";

const Data: HsonSchema = Hson.schema`<type "data" content <value "string">>`;
const Page: HsonSchema = Hson.schema`<type "document" tag "main" content <repeat <tag "item" content "empty">>>`;
const Buttons: HsonSchema = Hson.schema`<type "document" tag "main" content <repeat <tag "button" content "empty">>>`;

function socket_pair(): { client: LocusSocketLike; server: LocusSocketLike; serverSent: string[] } {
  const toServer = new Set<(raw: string) => void>();
  const toClient = new Set<(raw: string) => void>();
  const serverSent: string[] = [];
  return {
    client: { send(raw) { for (const listener of [...toServer]) listener(raw); }, close() {},
      onMessage(listener) { toClient.add(listener); return () => { toClient.delete(listener); }; },
      onClose() { return () => {}; } },
    server: { send(raw) { serverSent.push(raw); for (const listener of [...toClient]) listener(raw); }, close() {},
      onMessage(listener) { toServer.add(listener); return () => { toServer.delete(listener); }; },
      onClose() { return () => {}; } },
    serverSent,
  };
}
function make_map() {
  return hsonLiveMap.fromLibraries({ public: { data: { value: "public" }, schema: Data },
    private: { data: { value: "private" }, schema: Data } });
}
const exposure = [{ library: "public", exposure: "client-public" as const },
  { library: "private", exposure: "server-private" as const }];

async function host(adapter: MemoryCheckpointAdapter, logicalMapId: string) {
  return create_persistent_locus({ map: make_map(), persistence: adapter, logicalMapId, exposure,
    defaultProjection: { libraries: ["public"] }, authorizeProjection: () => ({ libraries: ["public"] }) });
}

function active(adapter: MemoryCheckpointAdapter, id: string): LocusHostedAggregatePersistedManifest {
  const checkpoint = adapter.state(id)?.checkpoint;
  assert.equal(checkpoint?.format, "hson-locus-durable-aggregate-checkpoint-v3");
  if (checkpoint?.format !== "hson-locus-durable-aggregate-checkpoint-v3") throw new Error("Expected v2 checkpoint.");
  return checkpoint;
}

async function case_(name: string, run: () => Promise<void>) {
  await run();
  process.stdout.write(`ok - ${name}\n`);
}

await case_("v1 checkpoint rejects as unsupported", async () => {
  const adapter = new MemoryCheckpointAdapter();
  const map = make_map();
  const authority = internal_livemap_aggregate_authority(map);
  authority.setInitialHostedAuthority({ logicalMapId: "z3b-v1", incarnationId: "z3b-v1-inc" });
  const old = { format: "hson-locus-durable-aggregate-checkpoint-v1", logicalMapId: "z3b-v1",
    incarnationId: "z3b-v1-inc", mapKind: "hosted-aggregate", registryDigest: authority.captureHosted().registryDigest,
    rev: 0, snapshot: authority.captureHosted() };
  adapter.seed("z3b-v1", { checkpoint: old, commits: [] } as unknown as import("../src/api/locus/locus.aggregate.persistence.ts").LocusHostedAggregatePersistedState);
  await assert.rejects(() => host(adapter, "z3b-v1"), /invalid/i);
});

await case_("empty authority checkpoint restores without a placeholder library", async () => {
  const adapter = new MemoryCheckpointAdapter();
  const id = "z3b-empty";
  const locus = await create_persistent_locus({
    map: hsonLiveMap.create(), persistence: adapter, logicalMapId: id, exposure: [],
  });
  const manifest = active(adapter, id);
  assert.deepEqual(manifest.registry.libraries, []);
  assert.deepEqual(manifest.chunks, []);
  locus.dispose();
  const restored = await create_persistent_locus({
    map: hsonLiveMap.create(), persistence: adapter, logicalMapId: id, exposure: [],
  });
  assert.ok(restored);
  assert.equal(restored.rev, 0);
  assert.deepEqual(restored.map.capture().registry.libraries, []);
  restored.dispose();
});

await case_("checkpoint chunks exclude runtime QUID identity and restore fresh identity", async () => {
  const adapter = new MemoryCheckpointAdapter();
  const id = "z3b-quid";
  const locus = await host(adapter, id);
  const authority = internal_livemap_aggregate_authority(locus.map);
  const library = authority.libraries()[1];
  if (library === undefined) throw new Error("Expected private Library.");
  const quid = "0000ab123";
  authority.acquireLocalProjectedIdentity(library, [], quid);
  const owner = authority.identityEpoch().owner;
  await locus.checkpoint();
  assert.ok([...adapter.chunks.values()].every((chunk) => !chunk.payload.includes(quid)
    && !chunk.payload.includes("issuedQuids") && !chunk.payload.includes("identityEpoch")));
  locus.dispose();
  const restored = await host(adapter, id);
  const fresh = internal_livemap_aggregate_authority(restored.map);
  assert.notEqual(fresh.identityEpoch().owner, owner);
  assert.equal(fresh.resolveQuid(quid), undefined);
  assert.equal(restored.map.lib("private").snap(["value"]), "private");
  restored.dispose();
});

await case_("two data and two document libraries retain system interactions and tail lineage", async () => {
  const adapter = new MemoryCheckpointAdapter();
  const map = hsonLiveMap.fromLibraries({
    dataA: { data: { value: "A0" }, schema: Data },
    dataB: { data: { value: "B0" }, schema: Data },
    pageA: { document: "<main <button id=one/> <button id=two/>/>", schema: Buttons },
    pageB: { document: "<main/>", schema: Page },
  });
  const id = "z3b-complete";
  internal_livemap_aggregate_authority(map).setInitialHostedAuthority({ logicalMapId: id, incarnationId: "z3b-complete-inc" });
  enable_interactions(map);
  const listener: InteractionDescriptor["listener"] = Object.freeze({ event: "click", target: "element",
    capture: false, once: false, passive: false, missingTarget: "ignore", preventDefault: false,
    stopPropagation: false, stopImmediatePropagation: false });
  add_interaction(map, Object.freeze({ id: "z3b-click", subject: { library: "pageA", path: [0, 0, 1] },
    listener, kind: "browser-local", key: "run", args: null }));
  const locus = await create_persistent_locus_hosted_aggregate_internal({ map, persistence: adapter });
  await locus.mutate((draft) => {
    for (const [name, value] of [["dataA", "A1"], ["dataB", "B1"]] as const) {
      const library = draft.lib(name);
      if (!("at" in library)) throw new Error("Expected data Library.");
      library.at(["value"]).set(value);
    }
    const page = draft.lib("pageB");
    if (!("graph" in page)) throw new Error("Expected document Library.");
    page.graph({ domain: "graph", op: "insert-content", target: { kind: "path", path: validate_document_path([0]) },
      index: 0, content: { $_tag: "_hson_elem", $_content: [{ $_tag: "item", $_content: [] }] } });
  });
  await locus.checkpoint();
  await locus.mutate((draft) => {
    const page = draft.lib("pageB");
    if (!("graph" in page)) throw new Error("Expected document Library.");
    page.graph({ domain: "graph", op: "replace-content", target: { kind: "path", path: validate_document_path([0, 0]) },
      index: 0, replacement: { $_tag: "item", $_attrs: { title: "continued" }, $_content: [] },
      lineage: [{ source: validate_document_path([]), destination: validate_document_path([]) }] });
  });
  assert.ok(JSON.stringify(adapter.state(id)?.commits).includes("lineage"));
  locus.dispose();
  const restored = await load_persistent_locus_hosted_aggregate_internal(id, { persistence: adapter });
  assert.ok(restored);
  assert.equal(restored.rev, 3);
  for (const [name, expected] of [["dataA", "A1"], ["dataB", "B1"]] as const) {
    const selectedName: string = name;
    const library: { root: () => HsonNode } = restored.map.lib(selectedName);
    assert.ok(JSON.stringify(library.root()).includes(expected));
  }
  assert.equal(restored.map.lib("pageA").mode, "document");
  assert.ok(JSON.stringify(restored.map.lib("pageB").root()).includes("continued"));
  const authority = internal_livemap_aggregate_authority(restored.map);
  const system = authority.systemState("@hson/canonical-interactions/v1");
  assert.ok(system);
  assert.ok(JSON.stringify(authority.systemRoot(system)).includes("z3b-click"));
  restored.dispose();
});

await case_("preactivation failures preserve old checkpoint and complete tail", async () => {
  for (const phase of ["chunk", "manifest", "activation"] as const) {
    const id = `z3b-fail-${phase}`;
    const adapter = new MemoryCheckpointAdapter();
    const locus = await host(adapter, id);
    const old = active(adapter, id).checkpointId;
    await locus.mutate((draft) => { draft.lib("private").at(["value"]).set("R1"); });
    if (phase === "chunk") adapter.failChunk = new Error("chunk failure");
    if (phase === "manifest") adapter.failManifest = new Error("manifest failure");
    if (phase === "activation") adapter.failActivation = "before";
    await assert.rejects(locus.checkpoint());
    assert.equal(active(adapter, id).checkpointId, old);
    assert.equal(adapter.state(id)?.commits.length, 1);
    await locus.mutate((draft) => { draft.lib("private").at(["value"]).set("R2"); });
    locus.dispose();
    const restored = await host(adapter, id);
    assert.equal(restored.rev, 2);
    assert.equal(restored.map.lib("private").snap(["value"]), "R2");
    restored.dispose();
  }
});

await case_("uncertain activation reconciles; redundant covered tail survives a pruning crash", async () => {
  const adapter = new MemoryCheckpointAdapter();
  const id = "z3b-activation";
  const locus = await host(adapter, id);
  await locus.mutate((draft) => { draft.lib("private").at(["value"]).set("R1"); });
  adapter.failActivation = "after";
  adapter.failPrune = new Error("crash before cleanup");
  await assert.rejects(locus.checkpoint());
  assert.equal(active(adapter, id).rev, 1);
  assert.equal(adapter.state(id)?.commits.length, 1);
  locus.dispose();
  const restored = await host(adapter, id);
  assert.equal(restored.rev, 1);
  assert.equal(restored.map.lib("private").snap(["value"]), "R1");
  restored.dispose();
});

await case_("unreconcilable activation outcome closes the authority until reload", async () => {
  class UnreadableActivation extends MemoryCheckpointAdapter {
    fail = false;
    unreadable = false;
    override async activateCheckpoint(logicalMapId: string, expectedCheckpointId: string | undefined, checkpointId: string) {
      await super.activateCheckpoint(logicalMapId, expectedCheckpointId, checkpointId);
      if (this.fail) { this.fail = false; this.unreadable = true; throw new Error("uncertain activation"); }
    }
    override async load(logicalMapId: string) {
      if (this.unreadable) { this.unreadable = false; throw new Error("reconciliation unavailable"); }
      return super.load(logicalMapId);
    }
  }
  const adapter = new UnreadableActivation();
  const id = "z3b-uncertain";
  const locus = await host(adapter, id);
  await locus.mutate((draft) => { draft.lib("private").at(["value"]).set("R1"); });
  adapter.fail = true;
  await assert.rejects(locus.checkpoint(), (error: unknown) =>
    typeof error === "object" && error !== null && "code" in error
      && error.code === "LOCUS_PERSISTENCE_CHECKPOINT_UNCERTAIN");
  await assert.rejects(locus.mutate((draft) => { draft.lib("private").at(["value"]).set("R2"); }), /disposed|closed/i);
  const restored = await host(adapter, id);
  assert.equal(restored.rev, 1);
  assert.equal(restored.map.lib("private").snap(["value"]), "R1");
  restored.dispose();
});

await case_("later commits remain in tail while checkpoint chunks are blocked", async () => {
  const adapter = new MemoryCheckpointAdapter();
  const id = "z3b-concurrent";
  const locus = await host(adapter, id);
  await locus.mutate((draft) => { draft.lib("private").at(["value"]).set("R1"); });
  const paused = adapter.deferChunk();
  const checkpoint = locus.checkpoint();
  await paused.entered;
  await locus.mutate((draft) => { draft.lib("private").at(["value"]).set("R2"); });
  await locus.mutate((draft) => { draft.lib("private").at(["value"]).set("R3"); });
  paused.release();
  await checkpoint;
  assert.equal(active(adapter, id).rev, 1);
  assert.deepEqual(adapter.state(id)?.commits.map((record) => record.commit.rev), [2, 3]);
  locus.dispose();
  const restored = await host(adapter, id);
  assert.equal(restored.rev, 3);
  assert.equal(restored.map.lib("private").snap(["value"]), "R3");
  restored.dispose();
});

await case_("missing and corrupt chunks, bad descriptors, schema and tail gaps fail closed", async () => {
  const adapter = new MemoryCheckpointAdapter();
  const id = "z3b-integrity";
  const locus = await host(adapter, id);
  await locus.checkpoint();
  locus.dispose();
  const valid = adapter.state(id)!;
  const manifest = active(adapter, id);
  const first = manifest.chunks[0]!;
  const original = adapter.chunks.get(first.id)!;
  const expectInvalid = async () => {
    await assert.rejects(() => load_persistent_locus_hosted_aggregate_internal(id, { persistence: adapter }), /invalid/i);
  };
  adapter.chunks.delete(first.id);
  await expectInvalid();
  adapter.chunks.set(first.id, { ...original, payload: `${original.payload}x` });
  await expectInvalid();
  adapter.chunks.set(first.id, { ...original, payload: `${original.payload[0] === "x" ? "y" : "x"}${original.payload.slice(1)}` });
  await expectInvalid();
  adapter.chunks.set(first.id, original);
  const mutateManifest = async (change: (copy: any) => void) => {
    const copy = structuredClone(manifest) as any;
    change(copy);
    adapter.seed(id, { checkpoint: copy, commits: [] });
    await expectInvalid();
    adapter.seed(id, valid);
  };
  await mutateManifest((copy) => { copy.chunks.splice(1, 0, copy.chunks[0]); });
  await mutateManifest((copy) => { [copy.chunks[0], copy.chunks[1]] = [copy.chunks[1], copy.chunks[0]]; });
  await mutateManifest((copy) => { copy.chunks[0].bytes += 1; });
  await mutateManifest((copy) => { copy.chunks[0].sha256 = "0".repeat(64); });
  await mutateManifest((copy) => { copy.chunks[0].owner = "wrong"; });
  await mutateManifest((copy) => { copy.rev += 1; });
  await mutateManifest((copy) => { copy.registry.libraries[0].schemaDigest = "0".repeat(64); });
  const gap = structuredClone(valid) as any;
  gap.commits = [{ format: "hson-locus-durable-aggregate-record-v2", logicalMapId: id,
    incarnationId: manifest.incarnationId, mapKind: "hosted-aggregate", registryDigest: manifest.registryDigest,
    commit: { format: "hson-livemap-durable-commit-v2", authority: { logicalMapId: id,
      incarnationId: manifest.incarnationId }, registryDigest: manifest.registryDigest,
      prevRev: manifest.rev + 1, rev: manifest.rev + 2, operations: [] } }];
  adapter.seed(id, gap);
  await expectInvalid();
});

await case_("one root above 4 MiB and aggregate above 64 MiB checkpoint and restore", async () => {
  const adapter = new MemoryCheckpointAdapter();
  const count = 16;
  const names = Array.from({ length: count }, (_, index) => `private${index}`);
  const inputs: Record<string, { data: { value: string }; schema: HsonSchema } | { document: string; schema: HsonSchema }> = Object.create(null);
  inputs.public = { data: { value: "tiny" }, schema: Data };
  inputs.page = { document: "<main/>", schema: Page };
  for (const name of names) inputs[name] = { data: { value: "" }, schema: Data };
  const map = hsonLiveMap.fromLibraries(inputs);
  const exposure = [{ library: "public", exposure: "client-public" as const },
    { library: "page", exposure: "client-public" as const },
    ...names.map((library) => ({ library, exposure: "server-private" as const }))];
  const id = "z3b-large";
  const locus = await create_persistent_locus({ map, persistence: adapter, logicalMapId: id, exposure,
    defaultProjection: { libraries: ["public", "page"], htmlDocument: "page" },
    authorizeProjection: () => ({ libraries: ["public", "page"], htmlDocument: "page" }) });
  const authority = internal_livemap_aggregate_authority(map);
  const policy = make_locus_hosted_projection_policy(authority.hostedRegistry(), authority.hostedPosition().authority,
    exposure, { libraries: ["public", "page"], htmlDocument: "page" },
    () => ({ libraries: ["public", "page"], htmlDocument: "page" }));
  const effective = normalize_locus_effective_projection(policy, { libraries: ["public", "page"], htmlDocument: "page" });
  if (effective instanceof Promise) throw new Error("Expected synchronous projection policy.");
  const initialProjection = capture_selected_authority_projection_snapshot(map, effective);
  const clientMap = hsonLiveMap.fromClientSnapshot({ authority: initialProjection, localLibraries: {} });
  const value = "x".repeat(4 * 1024 * 1024 + 512 * 1024);
  for (const name of names) await locus.mutate((draft) => {
    const library = draft.lib(name);
    if (!("at" in library)) throw new Error("Expected data Library.");
    library.at(["value"]).set(value);
  });
  assert.ok(names.length * value.length > 64 * 1024 * 1024);
  assert.throws(() => internal_livemap_aggregate_authority(map).captureHosted(), /bound|limit|payload/i);
  await locus.checkpoint();
  const manifest = active(adapter, id);
  assert.equal(manifest.rev, count);
  assert.ok(manifest.chunks.length > count);
  assert.ok(manifest.chunks.every((entry) => entry.bytes <= 1024 * 1024));
  assert.ok([...adapter.chunks.values()].every((entry) => !entry.payload.includes("issuedQuids")));
  locus.dispose();
  const restoredMap = hsonLiveMap.fromLibraries(inputs);
  const restored = await create_persistent_locus({ map: restoredMap, persistence: adapter, logicalMapId: id, exposure,
    defaultProjection: { libraries: ["public", "page"], htmlDocument: "page" },
    authorizeProjection: () => ({ libraries: ["public", "page"], htmlDocument: "page" }) });
  assert.equal(restored.rev, count);
  assert.equal(restored.map, restoredMap);
  for (const name of names) {
    const library = restored.map.lib(name);
    if (!("snap" in library)) throw new Error("Expected data Library.");
    assert.equal(library.snap(["value"]), value);
  }
  const publicLibrary = restored.map.lib("public");
  if (!("snap" in publicLibrary)) throw new Error("Expected public data Library.");
  assert.equal(publicLibrary.snap(["value"]), "tiny");
  const pair = socket_pair();
  restored.connect(pair.server);
  const client = hsonEcho.create({ socket: pair.client, map: clientMap,
    recovery: { logicalMapId: restored.logicalMapId } });
  client.connect();
  await client.session.create();
  assert.equal((await client.recovery.recover()).strategy, "snapshot");
  const sessionId = client.session.sessionId;
  assert.ok(sessionId);
  const cut = restored.cut(sessionId, "page");
  assert.ok(cut.html.length > 0);
  assert.ok(JSON.stringify(cut.data).length < 1024 * 1024);
  assert.equal(pair.serverSent.join("\n").includes(value.slice(0, 1024)), false);
  client.dispose();
  restored.dispose();
});

process.stdout.write("Z3B checkpoint acceptance passed.\n");
