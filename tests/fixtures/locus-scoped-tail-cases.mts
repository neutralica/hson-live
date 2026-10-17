import assert from "node:assert/strict";
import { scoped_initial_fixture, page, node } from "./echo-scoped-initial-state-cases.mts";
import { MemoryCheckpointAdapter } from "../helpers/memory-checkpoint-adapter.mts";
import { internal_livemap_aggregate_authority as authority } from "../../src/api/livemap/livemap.internal.ts";
import { create_persistent_locus_hosted_aggregate_internal as persist,
  load_persistent_locus_hosted_aggregate_internal as resume, checkpoint_libraries_equal,
  durable_aggregate_commit, restore_semantic_checkpoint_manifest_internal } from "../../src/api/locus/locus.aggregate.persistence.ts";
import { encode_authoritative_scoped_commit, type HostedAggregateCommit } from "../../src/api/livemap/livemap.hosted.ts";
import { enumerate_livemap_issued_quids as issued } from "../../src/api/livemap/livemap.identity-epoch.ts";
import { validate_document_path as path } from "../../src/api/livemap/livemap.document.path.ts";
import { make_locus_hosted_projection_policy, normalize_locus_effective_projection } from "../../src/api/locus/locus.projection.ts";
import { capture_selected_authority_projection_snapshot as capture } from "../../src/api/locus/locus.authority-projection-snapshot.ts";
import { create_echo_scoped_replica_internal as echo } from "../../src/api/echo/echo.aggregate-replica.lifecycle.ts";
import { make_locus_session_manager } from "../../src/api/locus/locus.session.ts";
import { capture_locus_session_authority_projection_snapshot as captureSession } from "../../src/api/locus/locus.authority-projection-snapshot.ts";
import { local_initializers, client_projection_map } from "../helpers/client-projection.mts";
import { resume_registry_locus } from "../../src/api/locus/locus.registry.persistence.ts";
import { projected_registry_digest } from "../../src/api/locus/locus.live-projection.ts";
import { bind_locus_websocket } from "../../src/api/locus/locus.websocket.ts";
import { test_echo_transport } from "../helpers/echo-websocket-transport.mts";
import { create_recovery_test_driver } from "../helpers/replica-driver.mts";
import type { LocusWebSocketLike } from "../../src/types/locus.types.ts";
import { canonical_graph_equal } from "../../src/api/livemap/livemap.document.install.ts";

export const catalog = [{ name: "parts", ownership: "private" }, { name: "page", ownership: "shared" },
  { name: "data", ownership: "shared" }, { name: "zpage", ownership: "shared" }, { name: "hidden", ownership: "private" }] as const;
const target = { kind: "path" as const, path: path([0, 0]) };
const connector = () => node('<hson-part lib="parts" at="panel"/>');

export async function scoped_tail_fixture() {
  const f = await scoped_initial_fixture(), adapter = new MemoryCheckpointAdapter();
  f.l.dispose();
  const l = await persist({ map: f.map, persistence: adapter, scopedDocuments: true });
  const base = f.a.captureSemanticCheckpoint();
  const oldScopes = f.a.documentScopes(f.pageId)!.occurrences;
  const before = f.a.scopedDocumentState(f.pageId);
  const one = await l.stage(w => page(w).content.replace(target, 1, connector()));
  assert.ok(one);
  assert.ok(canonical_graph_equal(before.root, f.a.scopedDocumentState(f.pageId).root));
  const newScopes = f.a.documentScopes(f.pageId)!.occurrences;
  assert.notEqual(oldScopes[2]!.lifetime, newScopes[2]!.lifetime);
  assert.equal(oldScopes[0]!.lifetime, newScopes[0]!.lifetime);
  assert.ok(checkpoint_libraries_equal(base.libraries, f.a.captureSemanticCheckpoint().libraries));
  const mixed = await l.stage(w => {
    const d = w.lib("data"); if (d.mode === "document") throw Error(); d.at(["n"]).set(3);
    page(w).content.insert(target, 2, node('<hson-part lib="parts" at="leaf"/>'));
    const parts = w.lib("parts"); if (parts.mode === "document") throw Error();
    parts.at(["secret", "document"]).set('<strong "UPDATED_PRIVATE_PART"/>');
    page(w).attrs.set({ kind: "path", path: path([0]) }, "title", "tail");
  });
  assert.ok(mixed);
  const incomplete = { ...mixed, replay: { operations: mixed.replay.operations.map((entry, index) => {
    if (index !== 1) return entry;
    const { scoped: _scoped, ...ordinary } = entry; return ordinary;
  }) } };
  assert.throws(() => durable_aggregate_commit(incomplete), /scoped evidence/);
  await l.stage(w => page(w).content.remove(target, 2));
  const expected = f.a.captureSemanticCheckpoint();
  const sourceIds = issued(f.a.identityEpoch().issued());
  const state = adapter.state(l.logicalMapId)!;
  assert.equal(state.checkpoint.rev, base.revision);
  assert.equal(state.commits.length, 3);
  assert.deepEqual(state.commits[1]!.commit.operations.map(op => op.library), ["data", "page", "@hson/canonical-interactions", "parts", "page"]);
  // Encoding retained evidence after acceptance must be pure and owner-independent.
  assert.deepEqual(durable_aggregate_commit(one), state.commits[0]);
  const bytes = JSON.stringify(state.commits);
  for (const quid of sourceIds) assert.ok(!bytes.includes(quid));
  assert.match(bytes, /UPDATED_PRIVATE_PART/);
  assert.doesNotMatch(bytes, /"epoch"|"issued"|"lifetime"|"rootQuid"/);
  l.dispose();
  return { adapter, state, expected, sourceIds, base, oldScopes };
}

export async function verify_scoped_tail_restart(f: Pick<Awaited<ReturnType<typeof scoped_tail_fixture>>, "adapter" | "state" | "expected" | "sourceIds">) {
  const l = await resume(f.state.checkpoint.logicalMapId, { persistence: f.adapter, scopedDocuments: true });
  assert.ok(l);
  const a = authority(l.map), actual = a.captureSemanticCheckpoint();
  assert.ok(checkpoint_libraries_equal(f.expected.libraries, actual.libraries));
  assert.deepEqual(actual.authority, f.expected.authority); assert.deepEqual(actual.registry, f.expected.registry);
  assert.equal(actual.revision, f.expected.revision); assert.equal(a.clientProjection(), undefined);
  for (const quid of issued(a.identityEpoch().issued())) assert.ok(!f.sourceIds.includes(quid));
  const policy = make_locus_hosted_projection_policy(a.hostedRegistry(), actual.authority, catalog, undefined,
    () => ({ libraries: ["page", "data", "zpage"], systemFeatures: ["interactions"] }));
  const effective = await normalize_locus_effective_projection(policy, { libraries: ["parts", "page", "data", "zpage", "hidden"], systemFeatures: ["interactions"] });
  const sessions = make_locus_session_manager();
  const grant = sessions.create("resumed", true, { fence() {} }, () => {}, () => 0, undefined, effective);
  assert.ok(grant.ok);
  const projection = captureSession(l.map, sessions, "resumed", true);
  assert.doesNotMatch(JSON.stringify(projection), /UPDATED_PRIVATE_PART|PRIVATE_LIBRARY_SENTINEL|hidden-event|"name":"parts"/);
  const cap = echo(projection, local_initializers({ local: { data: { n: 1 } } }));
  assert.ok(cap.map); assert.throws(() => cap.map!.lib("parts"));
  try {
    const commit = await l.stage(w => page(w).attrs.set({ kind: "path", path: path([0]) }, "title", "after-resume"));
    assert.ok(commit);
    const encoded = encode_authoritative_scoped_commit(commit);
    assert.deepEqual(encoded.operations.map(op => op.library), ["page"]);
    cap.replayScopedHosted({ ...encoded, registryDigest: projected_registry_digest(effective) });
    const receiving = authority(cap.map);
    assert.equal(receiving.clientProjection()!.revision, l.rev);
    const finalProjection = capture(l.map, effective, true);
    const replicaProjection = receiving.captureSemanticCheckpoint();
    for (const name of ["page", "zpage"]) {
      const expected = a.captureSemanticCheckpoint().libraries.find(entry => entry.name === name)!;
      const actual = replicaProjection.libraries.find(entry => entry.name === name)!;
      assert.ok(checkpoint_libraries_equal([expected], [actual]));
    }
    assert.equal(finalProjection.revision, l.rev);
    assert.throws(() => cap.replayScopedHosted({ ...encoded, registryDigest: projected_registry_digest(effective) }));
  } finally { cap.dispose(); sessions.dispose(); l.dispose(); }
}

function wire() {
  const toServer = new Set<(raw: string) => void>(), toClient = new Set<(raw: string) => void>();
  const frames: string[] = [];
  const client: LocusWebSocketLike = { send(raw) { for (const notify of toServer) notify(raw); }, close() {},
    onMessage(fn) { toClient.add(fn); return () => { toClient.delete(fn); }; }, onClose() { return () => {}; } };
  const server: LocusWebSocketLike = { send(raw) { frames.push(raw); for (const notify of toClient) notify(raw); }, close() {},
    onMessage(fn) { toServer.add(fn); return () => { toServer.delete(fn); }; }, onClose() { return () => {}; } };
  return { client, server, frames };
}

export async function scoped_tail_cases(check: (name: string, run: () => Promise<void>) => Promise<void>) {
  await check("B2 complete checkpoint plus ordered tails resumes fresh authority and converges a private-free Echo", async () => {
    const f = await scoped_tail_fixture(); await verify_scoped_tail_restart(f);
  });
  await check("B2 full-map replay retires equal-graph occurrence lifetimes and respects management", async () => {
    const f = await scoped_tail_fixture();
    const map = await restore_semantic_checkpoint_manifest_internal(f.state.checkpoint, f.adapter), a = authority(map);
    const library = a.libraries()[1]!, before = a.documentScopes(library)!.occurrences, state = a.scopedDocumentState(library);
    const commit = f.state.commits[0]!.commit; assert.ok(commit.operationCount);
    const input = { authority: commit.authority, registryDigest: commit.registryDigest,
      prevRev: commit.prevRev, rev: commit.rev, operationCount: commit.operationCount, operations: commit.operations };
    const owner = {}; a.claimManagement(owner);
    assert.throws(() => a.replayDurableHosted(input), /managed|Locus|controlled/);
    assert.equal(map.rev, f.base.revision); a.releaseManagement(owner);
    a.replayDurableHosted(input);
    const after = a.documentScopes(library)!.occurrences;
    assert.equal(after[0]!.lifetime, before[0]!.lifetime); assert.notEqual(after[2]!.lifetime, before[2]!.lifetime);
    assert.equal(map.rev, f.base.revision + 1);
    assert.ok(canonical_graph_equal(state.root, a.scopedDocumentState(library).root));
    assert.match(JSON.stringify(a.scopedDocumentState(library).css), /margin|border/);
    const effect = commit.operations[0]!; assert.equal(effect.domain, "document");
    if (effect.domain !== "document") throw Error();
    assert.equal(effect.effect.retired.length, 2); assert.equal(effect.effect.created.length, 2);
    assert.equal(effect.effect.styles.length, 2);
    assert.throws(() => a.replayDurableHosted(input));
  });
  await check("B2 malformed later tails never publish partial authority and valid retry succeeds", async () => {
    const f = await scoped_tail_fixture();
    const corruptions: readonly [string, (state: any) => void][] = [
      ["gap", s => s.commits.splice(1, 1)], ["duplicate", s => s.commits.push(s.commits[2])],
      ["reorder", s => s.commits.reverse()], ["incarnation", s => s.commits[2].incarnationId = "other"],
      ["registry", s => s.commits[2].commit.registryDigest = "wrong"],
      ["count", s => s.commits[2].commit.operationCount++],
      ["ordinal", s => s.commits[2].commit.operations[0].effect.ordinal++],
      ["predecessor", s => s.commits[2].commit.operations[0].effect.before = "0".repeat(64)],
      ["missing evidence", s => delete s.commits[2].commit.operations[0].effect],
      ["retirement", s => s.commits[2].commit.operations[0].effect.retired = []],
      ["conflict", s => s.commits[2].commit.operations[0].payload = "conflict"],
      ["topology", s => s.commits[1].commit.operations[1].effect.created[0].parent = [9]],
      ["css", s => s.commits[1].commit.operations[1].effect.styles[0].subjects = []],
    ];
    for (const [name, corrupt] of corruptions) {
      const malformed = structuredClone(f.state); corrupt(malformed);
      f.adapter.seed(f.state.checkpoint.logicalMapId, malformed);
      await assert.rejects(() => resume(f.state.checkpoint.logicalMapId, { persistence: f.adapter, scopedDocuments: true }), /invalid/, name);
    }
    f.adapter.seed(f.state.checkpoint.logicalMapId, f.state);
    await verify_scoped_tail_restart(f);
  });
  await check("B2 append rejection and unsupported operations preserve source authority", async () => {
    const f = await scoped_tail_fixture();
    const l = await resume(f.state.checkpoint.logicalMapId, { persistence: f.adapter, scopedDocuments: true }); assert.ok(l);
    const a = authority(l.map), before = a.captureSemanticCheckpoint(), ledger = a.identityEpoch().issued();
    try {
      f.adapter.failAppend = Error("storage unavailable");
      await assert.rejects(() => l.stage(w => page(w).content.replace(target, 1, connector())), /append/);
      assert.deepEqual(a.captureSemanticCheckpoint(), before); assert.equal(a.identityEpoch().issued(), ledger);
      await assert.rejects(() => l.stage(w => page(w).css.stylesheet("main{color:red}")), /scoped evidence/);
      await assert.rejects(() => l.stage(w => page(w).graph({ domain: "graph", op: "replace-root", mode: "document", root: node('<main/>') })), /scoped|root/i);
      await assert.rejects(() => l.add_libraries_internal({ added: { data: 1 } }, undefined,
        [{ name: "added", ownership: "private" }]), /H0b/);
      assert.deepEqual(a.captureSemanticCheckpoint(), before);
      await l.stage(w => page(w).content.replace(target, 1, connector()));
      assert.equal(l.rev, before.revision + 1);
      f.adapter.failPrune = Error("prune failed"); await assert.rejects(() => l.checkpoint(), /checkpoint/);
      assert.equal(f.adapter.state(l.logicalMapId)!.checkpoint.rev, l.rev);
    } finally { l.dispose(); }
  });
  await check("B2 checkpoint crashes before and after activation retain complete tails and fence uncertainty", async () => {
    for (const phase of ["before", "after", "uncertain"] as const) {
      const f = await scoped_tail_fixture(), id = f.state.checkpoint.logicalMapId;
      const l = await resume(id, { persistence: f.adapter, scopedDocuments: true }); assert.ok(l);
      const oldId = f.state.checkpoint.checkpointId;
      const originalLoad = f.adapter.load.bind(f.adapter), activate = f.adapter.activateCheckpoint.bind(f.adapter);
      try {
        if (phase === "uncertain") f.adapter.activateCheckpoint = async (...args) => {
          await activate(...args); f.adapter.load = async () => { throw Error("storage unavailable"); }; throw Error("uncertain activation");
        }; else f.adapter.failActivation = phase;
        if (phase === "after") await l.checkpoint();
        else await assert.rejects(() => l.checkpoint(), /checkpoint/);
        f.adapter.load = originalLoad; f.adapter.activateCheckpoint = activate;
        const stored = f.adapter.state(id)!;
        assert.equal(stored.checkpoint.checkpointId === oldId, phase === "before");
        if (phase === "uncertain") await assert.rejects(() => l.stage(w => page(w).attrs.set({ kind: "path", path: path([0]) }, "title", "fenced")), /disposed|closed|faulted/);
        l.dispose();
        const restored = await resume(id, { persistence: f.adapter, scopedDocuments: true }); assert.ok(restored);
        assert.ok(checkpoint_libraries_equal(f.expected.libraries, authority(restored.map).captureSemanticCheckpoint().libraries));
        assert.equal(restored.rev, f.expected.revision); restored.dispose();
      } finally { l.dispose(); }
    }
  });
  await check("B2 append callbacks cannot bypass the reservation or undo independently queued work", async () => {
    const f = await scoped_tail_fixture(), id = f.state.checkpoint.logicalMapId;
    const l = await resume(id, { persistence: f.adapter, scopedDocuments: true }); assert.ok(l);
    const append = f.adapter.appendCommit.bind(f.adapter);
    let queued: Promise<HostedAggregateCommit | undefined> | undefined;
    f.adapter.appendCommit = async record => {
      f.adapter.appendCommit = append;
      const data = l.map.lib("data"); if (data.mode === "document") throw Error();
      assert.throws(() => data.at(["n"]).set(88), /managed|Locus|controlled/);
      queued = l.stage(w => { const d = w.lib("data"); if (d.mode === "document") throw Error(); d.at(["n"]).set(99); });
      throw Error("rejected append");
    };
    try {
      await assert.rejects(() => l.stage(w => page(w).content.replace(target, 1, connector())), /append/);
      await queued;
      assert.equal(l.rev, f.expected.revision + 1);
      const d = l.map.lib("data"); if (d.mode === "document") throw Error(); assert.equal(d.snap(["n"]), 99);
    } finally { l.dispose(); }
  });
  await check("B2 reentrant storage preserves independently accepted deployment work and retries", async () => {
    const f = await scoped_tail_fixture(), target = await scoped_initial_fixture(); target.l.dispose();
    const originalLoad = f.adapter.load.bind(f.adapter);
    let changed = false;
    f.adapter.load = async id => {
      if (!changed) { changed = true; target.map.lib("data").at(["n"]).set(91); }
      return originalLoad(id);
    };
    const options = { map: target.map, persistence: f.adapter, logicalMapId: f.state.checkpoint.logicalMapId, libraries: catalog };
    await assert.rejects(() => resume_registry_locus(options, { scopedDocuments: true }), /changed during/);
    assert.equal(target.map.lib("data").snap(["n"]), 91);
    f.adapter.load = originalLoad;
    const l = await resume_registry_locus(options, { scopedDocuments: true }); l.dispose();
  });
  await check("B2 registry recovery floor reconciles an equal revision without runtime continuity", async () => {
    const f = await scoped_tail_fixture(), target = await scoped_initial_fixture(); target.l.dispose();
    const l = await resume_registry_locus({ map: target.map, persistence: f.adapter,
      logicalMapId: f.state.checkpoint.logicalMapId, libraries: catalog,
      defaultProjection: { libraries: ["data"] }, authorizeProjection: () => ({ libraries: ["data"] }) }, { scopedDocuments: true });
    try {
      const a = target.a, policy = make_locus_hosted_projection_policy(a.hostedRegistry(), a.hostedPosition().authority,
        catalog, { libraries: ["data"] }, () => ({ libraries: ["data"] }));
      const effective = await normalize_locus_effective_projection(policy, { libraries: ["data"] });
      const map = client_projection_map({ authority: capture(target.map, effective), local: {} });
      const pair = wire(), detach = bind_locus_websocket(l, pair.server);
      const client = create_recovery_test_driver({ map, transport: test_echo_transport(pair.client) });
      try {
        client.connect(); await client.session.create();
        assert.equal((await client.completeRecovery()).strategy, "reconcile");
        assert.match(pair.frames.join("\n"), /history_unavailable/);
      } finally { client.dispose(); detach(); }
    } finally { l.dispose(); }
  });
  await check("B2 registry resume validates deployment before installation and retains private contracts", async () => {
    const f = await scoped_tail_fixture(), target = await scoped_initial_fixture(); target.l.dispose();
    const a = target.a, before = a.captureSemanticCheckpoint();
    try {
      await assert.rejects(() => resume_registry_locus({ map: target.map, persistence: f.adapter,
        logicalMapId: f.state.checkpoint.logicalMapId, libraries: catalog.slice(1) }, { scopedDocuments: true }));
      assert.deepEqual(a.captureSemanticCheckpoint(), before);
      const l = await resume_registry_locus({ map: target.map, persistence: f.adapter,
        logicalMapId: f.state.checkpoint.logicalMapId, libraries: catalog }, { scopedDocuments: true });
      try {
        assert.ok(checkpoint_libraries_equal(f.expected.libraries, a.captureSemanticCheckpoint().libraries));
        assert.equal(l.rev, f.expected.revision);
        await l.stage(w => { w.lib("data").at(["n"]).set(8); });
        assert.equal(l.rev, f.expected.revision + 1);
      } finally { l.dispose(); }
    } finally { target.l.dispose(); }
  });
}
