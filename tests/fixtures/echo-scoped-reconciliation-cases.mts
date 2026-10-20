import { create_locus_fixture } from "../helpers/locus-definition-fixture.mts";
import assert from "node:assert/strict";
import { canonical_hson_graph_equal } from "../../src/core/canonical-hson-equal.ts";
import { project_interaction_state_internal as projectInteractions } from "../../src/api/interactions/interactions.projection.ts";
import { add_interaction, bind_locus_http, hsonLiveMap } from "../../src/index.ts";
import { authority_definitions_from_map_fixture } from "../helpers/locus-definition-fixture.mts";
import { scoped_initial_fixture as fixture, scoped_receiver_view as view, assert_scoped_unchanged as unchanged, page, node, listener } from "./echo-scoped-initial-state-cases.mts";
import { create_echo_aggregate_client_internal as client } from "../../src/api/echo/echo.aggregate-replica.ts";
import { create_echo_aggregate_replica_capability_internal as replica } from "../../src/api/echo/echo.aggregate-replica.lifecycle.ts";
import { compose_client_projection_internal } from "../../src/api/echo/echo.projection.ts";
import { authority_projection_as_client_composition_internal as composition, capture_locus_session_authority_projection_snapshot as captureSession } from "../../src/api/locus/locus.authority-projection-snapshot.ts";
import { plan_locus_revision_recovery_internal as plan } from "../../src/api/locus/locus.aggregate.authority.ts";
import { make_locus_session_manager } from "../../src/api/locus/locus.session.ts";
import { document_scoped_libraries_semantically_equal as equal } from "../../src/api/livemap/livemap.document.scoped-portable.ts";
import { internal_livemap_aggregate_authority as authority } from "../../src/api/livemap/livemap.internal.ts";
import { acquire_echo_map_management_internal } from "../../src/internal/echo-map-capability.ts";
import { enumerate_livemap_issued_quids } from "../../src/api/livemap/livemap.identity-epoch.ts";
import { set_livemap_quid_candidate_source_for_tests as allocator } from "../../src/api/livemap/livemap.quid-allocation.ts";
import { validate_document_path as path } from "../../src/api/livemap/livemap.document.path.ts";
import type { EchoReplicaTransport, EchoSynchronizationOutput, EchoSynchronizationObserver, EchoSynchronizationRequest, EchoAttachmentEvent } from "../../src/types/echo.transport.types.ts";
import { locus_local_initializer_digest } from "../../src/api/locus/locus.local-initializer.ts";
import { local_initializers } from "../helpers/client-projection.mts";

type Fixture = Awaited<ReturnType<typeof fixture>>;
type Output = EchoSynchronizationOutput;
type Snapshot = Extract<Output, { type: "recovery-snapshot" }>;

// Private semantic receiving seam: real Locus session grants and captured cuts,
// existing history selection and Echo recovery orchestration. No wire codec is opened.
function receiving(f: Fixture, scoped = true, initial = f.state(), existingMap?: import("../../src/types/livemap.types.ts").LiveMap) {
  const map = existingMap ?? compose_client_projection_internal(initial, local_initializers({ local: { data: { n: 5 } }, localPage: { document: '<nav @:local/>' } }), scoped);
  const management = acquire_echo_map_management_internal(map), a = authority(map);
  const sessions = make_locus_session_manager();
  const notices = new Set<(event: EchoAttachmentEvent) => void>();
  const attachment = { fence(sessionId: string, epoch: number) { for (const notify of notices) notify({ kind: "fenced", sessionId, epoch }); } };
  let epoch = 0;
  type Feed = { request: EchoSynchronizationRequest; observer: EchoSynchronizationObserver;
    signal: import("../../src/types/echo.transport.types.ts").EchoCancellationSignal | undefined };
  let opened: (feed: Feed) => void = () => {};
  let ready = new Promise<Feed>(resolve => { opened = resolve; });
  const opening: { failure?: "synchronous" | "asynchronous"; before?: (feed: Feed) => void; attempts: number; cancellations: number } = {
    attempts: 0, cancellations: 0,
  };
  const transport: EchoReplicaTransport = {
    operations: { async submit(request) {
      if (request.type === "session-create" || request.type === "session-attach") {
        const result = request.type === "session-create"
          ? sessions.create("receiving-session", true, attachment, () => {}, () => 0, undefined, f.effective)
          : sessions.reattach(request.credential, attachment);
        if (!result.ok) throw Error(result.error.message);
        epoch = result.value.epoch;
        const base = { id: request.id, sessionId: result.value.sessionId, epoch, ...initial.authority };
        return { kind: "response", outcome: request.type === "session-create"
          ? { ...base, type: "session-created", credential: sessions.credential(result.value.sessionId)! }
          : { ...base, type: "session-attached" } };
      }
      throw Error(`Unexpected operation ${request.type}`);
    } },
    attachment: { observe(notify) { notices.add(notify); notify({ kind: "available" }); return () => { notices.delete(notify); }; } },
    synchronization: { open(request, observer, options) {
      assert.ok(sessions.is_active("receiving-session", epoch));
      assert.equal(sessions.projection("receiving-session"), f.effective);
      opening.attempts++;
      const failure = opening.failure;
      const feed = { request, observer, signal: options?.signal };
      opening.before?.(feed);
      const error = Error("review open failure");
      if (failure === "synchronous") throw error;
      if (failure === "asynchronous") return Promise.reject(error);
      opened(feed);
      return Promise.resolve({ cancel() { opening.cancellations++; } });
    } },
  };
  const echo = client({ map, management, transport, scopedReconciliation: scoped });
  async function begin() {
    const result = echo.connect().then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }));
    const current = await Promise.race([ready, result.then(outcome => {
      throw outcome.ok ? Error("Recovery completed before opening its feed") : outcome.error;
    })]);
    ready = new Promise<Feed>(resolve => { opened = resolve; });
    const state = captureSession(f.map, sessions, "receiving-session", scoped), registryDigest = composition(state, scoped).registryDigest;
    const fence = { ...state.authority, projectionDigest: state.projectionDigest, registryDigest };
    const recoveryPlan: Extract<Output, { type: "recovery-plan" }> = { type: "recovery-plan", id: current.request.id, ...fence, headRev: state.revision, outcome: "reconcile", reason: "history_unavailable" };
    const snapshot: Snapshot = { type: "recovery-snapshot", id: current.request.id, snapshot: state };
    const caught: Extract<Output, { type: "recovery-caught-up" }> = { type: "recovery-caught-up", id: current.request.id, ...fence, throughRev: state.revision };
    const send = (output: Output) => { void current.observer.onOutput(output); };
    return { result, send, recoveryPlan, snapshot, caught, request: current.request, end: current.observer.onEnd, signal: current.signal };
  }
  return { echo, a, management, begin, opening, fence() { sessions.reattach(sessions.credential("receiving-session"), { fence() {} }); },
    endSession() { for (const notify of notices) notify({ kind: "ended", sessionId: "receiving-session", epoch }); },
    dispose() { echo.dispose(); sessions.dispose(); } };
}
function same(f: Fixture, cap: ReturnType<typeof replica>) {
  const r = view(cap), entries = r.a.hostedRegistry().libraries.filter(e => e.scope === undefined);
  for (const name of ["page", "zpage"]) {
    const sourceId = f.a.libraries()[f.a.hostedRegistry().libraries.filter(e => e.scope === undefined).findIndex(e => e.name === name)]!;
    const id = r.a.libraries()[entries.findIndex(e => e.name === name)]!;
    assert.ok(equal(f.a.scopedDocumentState(sourceId), r.a.scopedDocumentState(id)), name);
  }
  assert.equal(r.a.clientProjection()!.revision, f.l.rev);
  assert.equal(r.a.clientProjection()!.registry.digest, composition(f.state(), true).registryDigest);
  assert.deepEqual(r.a.clientProjection()!.authority, f.state().authority);
  assert.equal(r.a.clientProjection()!.libraries.includes("parts"), false);
  const sourceData = f.map.data.must("data"), receivedData = r.map.data.must("data");
  if (String(receivedData.mode) === "document") throw Error();
  assert.deepEqual(receivedData.snap(), sourceData.snap());
  const docs = new Set(["page", "zpage"]);
  assert.ok(canonical_hson_graph_equal(
    projectInteractions(f.a.systemRoot(f.a.systemState("@hson/canonical-interactions")!), docs),
    projectInteractions(r.a.systemRoot(r.a.systemState("@hson/canonical-interactions")!), docs)));

}
async function finish(h: ReturnType<typeof receiving>) {
  const feed = await h.begin(); feed.send(feed.recoveryPlan); feed.send(feed.snapshot); feed.send(feed.caught);
  const result = await feed.result; assert.ok(result.ok, result.ok ? "" : String(result.error));
  assert.equal(result.value.outcome, "reconcile"); return feed;
}

function assert_position(h: ReturnType<typeof receiving>, revision: number, ready: boolean,
  status: ReturnType<typeof h.echo.diagnostics>["status"], session = "attached") {
  assert.equal(h.a.clientProjection()!.revision, revision, "installed authority");
  assert.equal(h.echo.lastAppliedRev, revision, "Echo authority cursor");
  assert.equal(h.echo.replica.ready, ready, "replica readiness");
  assert.equal(h.echo.diagnostics().status, status, "orchestration status");
  assert.equal(h.echo.session.status, session, "session attachment");
}

export async function scoped_reconciliation_repair_cases(check: (name: string, run: () => Promise<void>) => Promise<void>) {
  for (const replacement of [false, true]) await check(`snapshot completion preserves reentrant replay${replacement ? " under a replacement manager" : ""} and rejects the obsolete cut`, async () => {
    const f = await fixture(), h = receiving(f);
    let next: ReturnType<typeof replica> | undefined;
    try {
      const feed = await h.begin(), cut = feed.snapshot.snapshot.revision;
      const one = await f.stage(w => page(w).attrs.set({ kind: "path", path: path([0]) }, "title", "reentrant-next"));
      let hit = false;
      const positions: number[] = [];
      const off = h.echo.observeAuthorityPosition(revision => {
        positions.push(revision);
        assert.equal(h.echo.lastAppliedRev, h.a.clientProjection()!.revision);
        if (hit) return;
        hit = true;
        if (replacement) { h.a.releaseManagement(h.management.owner); next = replica(h.echo.map); }
        (next ?? h.echo.replica).replayScopedHosted(one);
      });
      feed.send(feed.recoveryPlan); feed.send(feed.snapshot); off();
      assert.equal(hit, true); assert.deepEqual(positions, [cut, one.rev]);
      assert_position(h, one.rev, false, "failed");
      assert.equal((await feed.result).ok, false); same(f, next ?? h.echo.replica);
      const two = await f.stage(w => page(w).attrs.set({ kind: "path", path: path([0]) }, "title", "subsequent-next"));
      (next ?? h.echo.replica).replayScopedHosted(two);
      assert_position(h, two.rev, false, "failed"); same(f, next ?? h.echo.replica);
      next?.dispose(); next = undefined;
      if (replacement) h.a.claimManagement(h.management.owner);
      const retry = await h.begin();
      assert.equal(retry.request.cursor!.lastAppliedRev, two.rev);
      retry.send({ ...retry.recoveryPlan, outcome: "current" }); retry.send(retry.caught);
      assert.equal((await retry.result).ok, true); assert_position(h, two.rev, true, "live");
    } finally { next?.dispose(); h.dispose(); f.l.dispose(); }
  });

  await check("rejected reentrant replay leaves the snapshot cut usable and subsequent ordered replay succeeds", async () => {
    const f = await fixture(), h = receiving(f);
    try {
      const feed = await h.begin();
      const one = await f.stage(w => page(w).attrs.set({ kind: "path", path: path([0]) }, "title", "ordered"));
      let hit = false;
      const off = h.echo.observeAuthorityPosition(() => {
        if (hit) return; hit = true;
        unchanged(h.echo.replica, () => assert.throws(() => h.echo.replica.replayScopedHosted({ ...one, prevRev: one.rev, rev: one.rev + 1 })));
      });
      feed.send(feed.recoveryPlan); feed.send(feed.snapshot); feed.send(feed.caught); off();
      assert.equal((await feed.result).ok, true); assert_position(h, one.prevRev, true, "live");
      h.echo.replica.replayScopedHosted(one); same(f, h.echo.replica); assert_position(h, one.rev, true, "live");
    } finally { h.dispose(); f.l.dispose(); }
  });

  for (const scoped of [true, false]) for (const outcome of ["reconcile", "current", "replay"] as const) {
    await check(`${scoped ? "scoped" : "flat"} ${outcome} caught-up retains its original management and attachment grants`, async () => {
      for (const action of ["release", "same-owner", "replacement", "session", "dispose"] as const) {
        const f = await fixture(!scoped), h = receiving(f, scoped), replacement = {};
        try {
          const feed = await h.begin(), revision = h.echo.lastAppliedRev!;
          feed.send({ ...feed.recoveryPlan, outcome });
          if (outcome === "reconcile") feed.send(feed.snapshot);
          let hit = false, readiness = 0, positions = 0;
          const off = h.echo.replica.onStateChange(() => { if (h.echo.replica.ready) readiness++; });
          const stop = h.echo.observeAuthorityPosition(() => positions++);
          const message = new Proxy(feed.caught, { get(target, key, receiver) {
            if (key === "throughRev" && !hit) {
              hit = true;
              if (action === "session") h.fence();
              else if (action === "dispose") h.echo.dispose();
              else {
                h.a.releaseManagement(h.management.owner);
                if (action === "same-owner") h.a.claimManagement(h.management.owner);
                if (action === "replacement") h.a.claimManagement(replacement);
              }
            }
            return Reflect.get(target, key, receiver);
          } });
          unchanged(h.echo.replica, () => feed.send(message)); off(); stop();
          assert.equal(hit, true); assert.equal((await feed.result).ok, false);
          assert.equal(readiness, 0); assert.equal(positions, 0);
          assert_position(h, revision, false, action === "dispose" ? "closed" : action === "session" ? "idle" : "failed",
            action === "dispose" ? "disposed" : action === "session" ? "detached" : "attached");
          if (action !== "dispose") {
            h.a.releaseManagement(replacement); h.a.claimManagement(h.management.owner);
            await finish(h); assert_position(h, revision, true, "live");
          }
        } finally { h.a.releaseManagement(replacement); h.dispose(); f.l.dispose(); }
      }
    });
  }

  await check("caught-up rejects reentrant replacement work without losing its installed position", async () => {
    const f = await fixture(), h = receiving(f);
    let next: ReturnType<typeof replica> | undefined;
    try {
      const feed = await h.begin(); feed.send(feed.recoveryPlan); feed.send(feed.snapshot);
      const one = await f.stage(w => page(w).attrs.set({ kind: "path", path: path([0]) }, "title", "replacement-at-completion"));
      let hit = false;
      feed.send(new Proxy(feed.caught, { get(target, key, receiver) {
        if (key === "throughRev" && !hit) {
          hit = true; h.a.releaseManagement(h.management.owner); next = replica(h.echo.map); next.replayScopedHosted(one);
        }
        return Reflect.get(target, key, receiver);
      } }));
      assert.equal((await feed.result).ok, false); assert_position(h, one.rev, false, "failed"); same(f, next!);
    } finally { next?.dispose(); h.dispose(); f.l.dispose(); }
  });

  await check("caught-up owns evidence once and ignores duplicate or superseded receipts", async () => {
    const f = await fixture(), h = receiving(f);
    try {
      const feed = await h.begin(); feed.send(feed.recoveryPlan); feed.send(feed.snapshot);
      const reads = new Map<PropertyKey, number>();
      feed.send(new Proxy(feed.caught, { get(target, key, receiver) {
        reads.set(key, (reads.get(key) ?? 0) + 1); return Reflect.get(target, key, receiver);
      } }));
      assert.equal((await feed.result).ok, true);
      for (const key of ["id", "throughRev", "projectionSequence", "logicalMapId", "incarnationId", "registryDigest", "projectionDigest"]) assert.equal(reads.get(key), 1, String(key));
      assert_position(h, feed.caught.throughRev, true, "live");
      unchanged(h.echo.replica, () => feed.send(feed.caught));
      const retry = await h.begin();
      unchanged(h.echo.replica, () => feed.send(feed.caught));
      assert_position(h, feed.caught.throughRev, false, "recovering");
      retry.send({ ...retry.recoveryPlan, outcome: "current" }); retry.send(retry.caught);
      assert.equal((await retry.result).ok, true); assert_position(h, retry.caught.throughRev, true, "live");
    } finally { h.dispose(); f.l.dispose(); }
  });

  await check("caught-up discriminant and final evidence cannot renew a revoked invocation", async () => {
    for (const key of ["type", "projectionSequence"] as const) for (const action of ["same-owner", "session", "dispose"] as const) {
      const f = await fixture(), h = receiving(f);
      try {
        const feed = await h.begin(); feed.send(feed.recoveryPlan); feed.send(feed.snapshot);
        let hit = false;
        feed.send(new Proxy(feed.caught, { get(target, field, receiver) {
          if (field === key && !hit) {
            hit = true;
            if (action === "session") h.fence();
            else if (action === "dispose") h.echo.dispose();
            else { h.a.releaseManagement(h.management.owner); h.a.claimManagement(h.management.owner); }
          }
          return Reflect.get(target, field, receiver);
        } }));
        assert.equal(hit, true); assert.equal((await feed.result).ok, false);
        assert.equal(h.echo.lastRecoveryOutcome, undefined);
        assert_position(h, feed.caught.throughRev, false, action === "dispose" ? "closed" : action === "session" ? "idle" : "failed",
          action === "dispose" ? "disposed" : action === "session" ? "detached" : "attached");
      } finally { h.dispose(); f.l.dispose(); }
    }
  });

  await check("revocation from readiness publication cannot resurrect a live recovery", async () => {
    for (const action of ["same-owner", "session", "dispose"] as const) {
      const f = await fixture(), h = receiving(f);
      try {
        const feed = await h.begin(); feed.send(feed.recoveryPlan); feed.send(feed.snapshot);
        let hit = false;
        const off = h.echo.replica.onStateChange(() => {
          if (hit || !h.echo.replica.ready) return; hit = true;
          if (action === "session") h.fence();
          else if (action === "dispose") h.echo.dispose();
          else { h.a.releaseManagement(h.management.owner); h.a.claimManagement(h.management.owner); }
        });
        feed.send(feed.caught); off();
        assert.equal(hit, true); assert.equal((await feed.result).ok, false);
        assert.equal(h.echo.lastRecoveryOutcome, undefined);
        assert_position(h, feed.caught.throughRev, false, action === "dispose" ? "closed" : action === "session" ? "idle" : "failed",
          action === "dispose" ? "disposed" : action === "session" ? "detached" : "attached");
      } finally { h.dispose(); f.l.dispose(); }
    }
  });

  await check("malformed or contradictory completion evidence cannot publish readiness", async () => {
    const changes: readonly [string, unknown][] = [["throughRev", NaN], ["throughRev", 2.5], ["throughRev", "2"],
      ["throughRev", -1], ["incarnationId", "wrong"], ["registryDigest", "0".repeat(64)],
      ["projectionDigest", "0".repeat(64)], ["projectionSequence", -1]];
    for (const [field, value] of changes) {
      const f = await fixture(), h = receiving(f);
      try {
        const feed = await h.begin(); feed.send(feed.recoveryPlan); feed.send(feed.snapshot);
        const message = { ...feed.caught }; Reflect.set(message, field, value);
        let readiness = 0;
        const off = h.echo.replica.onStateChange(() => { if (h.echo.replica.ready) readiness++; });
        unchanged(h.echo.replica, () => feed.send(message)); off();
        assert.equal((await feed.result).ok, false); assert.equal(readiness, 0);
        assert_position(h, feed.caught.throughRev, false, "failed");
      } finally { h.dispose(); f.l.dispose(); }
    }
  });

  await check("current and replay plans cannot contradict the established projection sequence", async () => {
    for (const outcome of ["current", "replay"] as const) {
      const f = await fixture(), h = receiving(f);
      try {
        const feed = await h.begin();
        unchanged(h.echo.replica, () => {
          feed.send({ ...feed.recoveryPlan, outcome, projectionSequence: 1 }); feed.send(feed.caught);
        });
        assert.equal((await feed.result).ok, false);
        assert_position(h, feed.caught.throughRev, false, "failed");
      } finally { h.dispose(); f.l.dispose(); }
    }
  });
}

// Shared by the Node runner and its actual Worker; these exercise the same
// orchestration for scoped and ordinary flat receiving maps.
export async function recovery_closure_cases(check: (name: string, run: () => Promise<void>) => Promise<void>) {
  for (const scoped of [false, true]) {
    const label = scoped ? "scoped" : "flat";
    for (const kind of ["commit", "progress", "projection"] as const) await check(`${label} entry authority rejects input revocation (${kind})`, async () => {
      for (const phase of (kind === "projection" ? ["property", "allocation"] : ["property"])) {
        const f = await fixture(kind === "projection" || !scoped), h = receiving(f, scoped);
        try {
          const feed = await finish(h), revision = h.echo.lastAppliedRev!;
          const state = feed.snapshot.snapshot;
          let message: Output;
          if (kind === "commit") {
            const commit = await f.stage(w => { const d = w.data.must("data"); if (String(d.mode) === "document") throw Error(); d.at(["n"]).set(1); });
            message = { type: "commit", id: feed.request.id, projectionSequence: 0, projectionDigest: state.projectionDigest,
              commit: { format: "hson-locus-live-projected-client-wire", ...state.authority, registryDigest: feed.caught.registryDigest,
                commit: { authority: commit.authority, registryDigest: commit.registryDigest, prevRev: commit.prevRev, rev: commit.rev, operations: commit.operations.filter(operation => operation.domain !== "document"), format: "hson-locus-live-projected-client-commit" } } };
          } else if (kind === "progress") message = { type: "progress", id: feed.request.id,
            projectionSequence: 0, projectionDigest: state.projectionDigest,
            progress: { ...state.authority, registryDigest: feed.caught.registryDigest, prevRev: revision, rev: revision + 1 } };
          else {
            // A same-contract reconciliation is sufficient to expose unauthorized
            // graph/identity replacement. Flat projection messages remain flat.
            const flat = state;
            message = { type: "projection-change", id: feed.request.id, ...state.authority,
              authorityRev: revision, sequence: 1, previousDigest: state.projectionDigest,
              projectionDigest: flat.projectionDigest, registryDigest: composition(flat).registryDigest,
              libraries: flat.libraries.map(({ root: _root, css: _css, quads: _quads, ...entry }) => entry),
              systemFeatures: flat.systemFeatures, writableDocuments: flat.writableDocuments,
              local: [], initializerDigest: locus_local_initializer_digest([]), reconciliation: flat };
          }
          let hit = false, candidates = 0;
          if (phase === "allocation") allocator(h.a.identityEpoch().owner, () => {
            if (!hit) { hit = true; h.fence(); }
            return `d${(++candidates).toString(36).padStart(8, "0")}`;
          });
          const key = kind === "commit" ? "commit" : kind === "progress" ? "progress" : "reconciliation";
          const malicious = new Proxy(message, { get(target, field, receiver) {
            if (phase === "property" && field === key && !hit) {
              hit = true;
              if (kind === "progress") h.fence();
              else { h.a.releaseManagement(h.management.owner); h.a.claimManagement(h.management.owner); }
            }
            return Reflect.get(target, field, receiver);
          } });
          unchanged(h.echo.replica, () => feed.send(malicious));
          assert.ok(hit, phase);
          const detached = kind === "progress" || phase === "allocation";
          assert_position(h, revision, false, detached ? "idle" : "failed", detached ? "detached" : "attached");
        } finally { allocator(h.a.identityEpoch().owner, undefined); h.dispose(); f.l.dispose(); }
      }
    });

    await check(`${label} commit admission keeps entry authority through nested evidence`, async () => {
      const f = await fixture(true), h = receiving(f, scoped);
      try {
        const feed = await finish(h), revision = h.echo.lastAppliedRev!, state = feed.snapshot.snapshot;
        const one = await f.stage(w => page(w).content.insert({ kind: "path", path: path([0, 0]) }, 0, node('<span "new"/>')));
        let hit = false;
        const revoke = () => { if (hit) return; hit = true; h.fence(); };
        const operations = one.operations.filter(operation => operation.domain !== "document");
        const incoming = new Proxy(operations, { ownKeys(target) { revoke(); return Reflect.ownKeys(target); } });
        unchanged(h.echo.replica, () => feed.send({ type: "commit", id: feed.request.id,
          projectionSequence: 0, projectionDigest: state.projectionDigest,
          commit: { format: "hson-locus-live-projected-client-wire", ...state.authority, registryDigest: one.registryDigest,
            commit: { format: "hson-locus-live-projected-client-commit", authority: one.authority,
              registryDigest: one.registryDigest, prevRev: one.prevRev, rev: one.rev, operations: incoming } } }));
        assert.ok(hit); assert_position(h, revision, false, "idle", "detached");
      } finally { allocator(h.a.identityEpoch().owner, undefined); h.dispose(); f.l.dispose(); }
    });

    await check(`${label} recovery retains its management grant between receipts`, async () => {
      const f = await fixture(!scoped), h = receiving(f, scoped);
      try {
        const feed = await h.begin(); feed.send({ ...feed.recoveryPlan, outcome: "current" });
        h.a.releaseManagement(h.management.owner); h.a.claimManagement(h.management.owner);
        unchanged(h.echo.replica, () => feed.send(feed.caught));
        assert.equal((await feed.result).ok, false); assert_position(h, feed.caught.throughRev, false, "failed");
        await finish(h); assert_position(h, feed.caught.throughRev, true, "live");
      } finally { h.dispose(); f.l.dispose(); }
    });

    await check(`${label} caught-up redelivery cannot claim nested success`, async () => {
      const f = await fixture(!scoped), h = receiving(f, scoped);
      try {
        const feed = await h.begin(); feed.send(feed.recoveryPlan); feed.send(feed.snapshot);
        let hit = false;
        const off = h.echo.replica.onStateChange(() => {
          if (hit || !h.echo.replica.ready) return;
          hit = true; feed.send(feed.caught);
        });
        feed.send(feed.caught); off();
        const result = await feed.result;
        assert.ok(hit); assert.equal(result.ok, false);
        assert_position(h, feed.caught.throughRev, false, "failed");
        assert.equal(h.echo.lastRecoveryOutcome, undefined);
      } finally { h.dispose(); f.l.dispose(); }
    });

    await check(`${label} readiness revocation cannot resolve pending or callback-created waiters`, async () => {
      for (const revoke of ["grant", "session", "dispose"] as const) {
        const f = await fixture(!scoped), h = receiving(f, scoped);
        try {
          const feed = await h.begin(); feed.send(feed.recoveryPlan); feed.send(feed.snapshot);
          const outcomes: string[] = [];
          const observe = (p: Promise<void>, name: string) => { void p.then(() => outcomes.push(name + ":ready"), () => outcomes.push(name + ":rejected")); };
          observe(h.echo.replica.waitUntilReady(), "before"); observe(h.echo.wait_until_ready(), "client");
          let hit = false;
          const off = h.echo.replica.onStateChange(() => {
            if (hit || !h.echo.replica.ready) return;
            hit = true; observe(h.echo.replica.waitUntilReady(), "during"); observe(h.echo.wait_until_ready(), "client-during");
            if (revoke === "session") h.fence();
            else if (revoke === "dispose") h.echo.dispose();
            else { h.a.releaseManagement(h.management.owner); h.a.claimManagement(h.management.owner); }
          });
          feed.send(feed.caught); off(); await feed.result; await Promise.resolve();
          assert.ok(hit); assert.ok(!outcomes.some(value => value.endsWith(":ready")), outcomes.join(","));
          assert_position(h, feed.caught.throughRev, false, revoke === "grant" ? "failed" : revoke === "session" ? "idle" : "closed",
            revoke === "grant" ? "attached" : revoke === "session" ? "detached" : "disposed");
          assert.equal((await feed.result).ok, false);
          if (revoke === "dispose") { assert.equal(outcomes.length, 4); continue; }
          await finish(h); await Promise.resolve();
          assert.ok(outcomes.includes("before:ready") || outcomes.includes("before:rejected"));
          assert_position(h, feed.caught.throughRev, true, "live");
        } finally { h.dispose(); f.l.dispose(); }
      }
    });

    await check(`${label} ordinary commits and reentrant progress retain the newest cursor`, async () => {
      const f = await fixture(!scoped), h = receiving(f, scoped);
      try {
        const feed = await finish(h), state = feed.snapshot.snapshot;
        const one = await f.stage(w => { const d = w.data.must("data"); if (String(d.mode) === "document") throw Error(); d.at(["n"]).set(42); });
        const progress: Extract<Output, { type: "progress" }> = { type: "progress", id: feed.request.id,
          projectionSequence: 0, projectionDigest: state.projectionDigest,
          progress: { ...state.authority, registryDigest: feed.caught.registryDigest, prevRev: one.rev, rev: one.rev + 1 } };
        let hit = false;
        const off = h.echo.map!.commits.observe(() => { if (!hit) { hit = true; feed.send(progress); } });
        feed.send({ type: "commit", id: feed.request.id, projectionSequence: 0, projectionDigest: state.projectionDigest,
          commit: { format: "hson-locus-live-projected-client-wire", ...state.authority, registryDigest: feed.caught.registryDigest,
            commit: { format: "hson-locus-live-projected-client-commit", authority: one.authority,
              registryDigest: one.registryDigest, prevRev: one.prevRev, rev: one.rev,
              operations: one.operations.filter(operation => operation.domain !== "document") } } }); off();
        assert.ok(hit); assert_position(h, one.rev + 1, true, "live");
        const data = h.echo.map!.data.must("data"); if (String(data.mode) === "document") throw Error(); assert.equal(data.snap(["n"]), 42);
        let nested = false;
        const stop = h.echo.observeAuthorityPosition(() => {
          if (nested) return; nested = true;
          feed.send({ ...progress, progress: { ...progress.progress, prevRev: one.rev + 2, rev: one.rev + 3 } });
        });
        feed.send({ ...progress, progress: { ...progress.progress, prevRev: one.rev + 1, rev: one.rev + 2 } }); stop();
        assert.ok(nested); assert_position(h, one.rev + 3, true, "live");
        unchanged(h.echo.replica, () => feed.send(progress));
        assert_position(h, one.rev + 3, false, "failed");
      } finally { h.dispose(); f.l.dispose(); }
    });

    await check(`${label} recovery opening reserves ownership before state callbacks`, async () => {
      const f = await fixture(!scoped), h = receiving(f, scoped);
      try {
        await finish(h);
        let nested: ReturnType<typeof h.echo.recover> | undefined;
        const off = h.echo.replica.onStateChange(() => {
          if (h.echo.diagnostics().status !== "recovering" || nested !== undefined) return;
          nested = h.echo.recover(); void nested.catch(() => {});
        });
        const feed = await h.begin(); off();
        assert.ok(nested); await assert.rejects(nested, /already in progress/);
        const waits = [h.echo.replica.waitUntilReady(), h.echo.wait_until_ready()];
        feed.send({ ...feed.recoveryPlan, outcome: "current" }); feed.send(feed.caught);
        assert.ok((await feed.result).ok); await Promise.all(waits);
        assert_position(h, feed.caught.throughRev, true, "live");
      } finally { h.dispose(); f.l.dispose(); }
    });

    await check(`${label} interrupted feed cannot reset callback replacement or accept obsolete end`, async () => {
      const f = await fixture(!scoped), h = receiving(f, scoped);
      try {
        const old = await finish(h);
        let replacement: ReturnType<typeof h.begin> | undefined;
        const off = h.echo.replica.onStateChange(() => {
          if (replacement !== undefined || h.echo.diagnostics().status !== "idle") return;
          replacement = h.begin();
        });
        old.end({ kind: "interrupted", cause: Error("interrupted old feed") }); off();
        assert.ok(replacement); const next = await replacement;
        next.send({ ...next.recoveryPlan, outcome: "current" }); next.send(next.caught);
        assert.ok((await next.result).ok);
        old.end({ kind: "invalid", cause: Error("obsolete invalid end") });
        assert_position(h, next.caught.throughRev, true, "live");
      } finally { h.dispose(); f.l.dispose(); }
    });

    await check(`${label} failure during recovery preserves callback replacement and its waiters`, async () => {
      const f = await fixture(!scoped), h = receiving(f, scoped);
      try {
        const old = await h.begin();
        let replacement: ReturnType<typeof h.begin> | undefined;
        let waiter: Promise<void> | undefined;
        const off = h.echo.replica.onStateChange(() => {
          if (replacement !== undefined || h.echo.diagnostics().status !== "failed") return;
          replacement = h.begin(); waiter = h.echo.replica.waitUntilReady();
        });
        old.send({ type: "synchronization-failure", id: old.request.id, error: { message: "failed while recovering" } }); off();
        assert.equal((await old.result).ok, false); assert.ok(replacement);
        const next = await replacement;
        next.send({ ...next.recoveryPlan, outcome: "current" }); next.send(next.caught);
        assert.ok((await next.result).ok); await waiter;
        assert_position(h, next.caught.throughRev, true, "live");
      } finally { h.dispose(); f.l.dispose(); }
    });

    await check(`${label} failure and end evidence cannot interrupt a replacement opened during inspection`, async () => {
      for (const kind of ["failure", "end"] as const) {
        const f = await fixture(!scoped), h = receiving(f, scoped);
        try {
          const old = await finish(h);
          let nextFeed: ReturnType<typeof h.begin> | undefined;
          const replace = () => { nextFeed ??= h.begin(); };
          if (kind === "failure") old.send({ type: "synchronization-failure", id: old.request.id,
            error: new Proxy({ message: "obsolete failure" }, { get(target, key, receiver) { replace(); return Reflect.get(target, key, receiver); } }) });
          else old.end(new Proxy({ kind: "invalid" as const, cause: Error("obsolete end") }, {
            get(target, key, receiver) { replace(); return Reflect.get(target, key, receiver); },
          }));
          assert.ok(nextFeed); const next = await nextFeed;
          next.send({ ...next.recoveryPlan, outcome: "current" }); next.send(next.caught);
          assert.ok((await next.result).ok); assert_position(h, next.caught.throughRev, true, "live");
        } finally { h.dispose(); f.l.dispose(); }
      }
    });

    await check(`${label} failure callback replacement survives obsolete cleanup`, async () => {
      const f = await fixture(!scoped), h = receiving(f, scoped);
      try {
        const old = await finish(h);
        let replacement: ReturnType<typeof h.begin> | undefined;
        const off = h.echo.replica.onStateChange(() => {
          if (replacement !== undefined || h.echo.diagnostics().status !== "failed") return;
          replacement = h.begin();
        });
        old.send({ type: "synchronization-failure", id: old.request.id, error: { message: "old feed failed" } }); off();
        assert.ok(replacement);
        const next = await replacement;
        next.send({ ...next.recoveryPlan, outcome: "current" }); next.send(next.caught);
        const result = await next.result; assert.ok(result.ok, result.ok ? "" : String(result.error));
        assert_position(h, next.caught.throughRev, true, "live");
        unchanged(h.echo.replica, () => { old.send(old.snapshot); old.send(old.caught); old.send({ type: "synchronization-failure", id: old.request.id, error: { message: "obsolete" } }); });
        assert_position(h, next.caught.throughRev, true, "live");
      } finally { h.dispose(); f.l.dispose(); }
    });
  }
}

async function bounded_lifecycle<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Error("Lifecycle promise did not settle")), 2000);
    })]);
  } finally { clearTimeout(timer); }
}

export async function terminal_progress_open_cases(check: (name: string, run: () => Promise<void>) => Promise<void>) {
  for (const scoped of [false, true]) {
    const label = scoped ? "scoped" : "flat";
    for (const phase of ["before", "during", "publication", "after"] as const) {
      await check(`${label} terminal session disposal ${phase} recovery rejects waiters and invalidates readiness`, async () => {
        const f = await fixture(!scoped), h = receiving(f, scoped);
        try {
          const feed = phase === "before" ? undefined : phase === "after" ? await finish(h) : await h.begin();
          if (feed !== undefined && phase !== "after") { feed.send(feed.recoveryPlan); feed.send(feed.snapshot); }
          const waits = phase === "after" ? [] : [h.echo.wait_until_ready(), h.echo.replica.waitUntilReady()]
            .map(promise => promise.then(() => "ready", () => "rejected"));
          const revision = h.echo.lastAppliedRev!;
          let callbacks = 0;
          const off = h.echo.replica.onStateChange(() => {
            if (phase === "publication" && h.echo.replica.ready && callbacks++ === 0) h.echo.session.dispose();
          });
          unchanged(h.echo.replica, () => {
            if (phase === "publication") feed!.send(feed!.caught);
            else h.echo.session.dispose();
          });
          off();
          assert.deepEqual(await bounded_lifecycle(Promise.all(waits)), waits.map(() => "rejected"));
          if (feed !== undefined && phase !== "after") assert.equal((await bounded_lifecycle(feed.result)).ok, false);
          assert_position(h, revision, false, "failed", "disposed");
          assert.equal(h.echo.replica.disposed, true);
          h.endSession();
          assert.equal(h.echo.session.status, "disposed", "late session notices cannot replace terminal disposal");
          h.a.claimManagement(h.management.owner);
          let reads = 0;
          unchanged(h.echo.replica, () => assert.throws(() => h.echo.replica.advanceHostedProgress(new Proxy({
            ...h.a.clientProjection()!.authority, registryDigest: h.a.clientProjection()!.registry.digest,
            prevRev: revision, rev: revision + 1,
          }, { get(target, key, receiver) { reads++; return Reflect.get(target, key, receiver); } })), /disposed/i));
          assert.equal(reads, 0); h.a.releaseManagement(h.management.owner);
          await assert.rejects(bounded_lifecycle(h.echo.replica.waitUntilReady()), /disposed/i);
          await assert.rejects(bounded_lifecycle(h.echo.wait_until_ready()), /disposed/i);
          await assert.rejects(h.echo.recover(), /disposed/i);
          await assert.rejects(h.echo.connect(), /disposed/i);
          if (feed !== undefined) unchanged(h.echo.replica, () => {
            feed.send(feed.caught); feed.send(feed.snapshot); feed.end({ kind: "invalid", cause: Error("obsolete end") });
          });
          assert_position(h, revision, false, "failed", "disposed");
        } finally { h.dispose(); f.l.dispose(); }
      });
    }

    await check(`${label} terminal cleanup preserves an independently managed replacement session`, async () => {
      for (const phase of ["failure", "throwing-disposal"] as const) {
        const f = await fixture(!scoped), h = receiving(f, scoped);
        let replacement: ReturnType<typeof receiving> | undefined;
        let opening: ReturnType<typeof h.begin> | undefined;
        try {
          const old = await finish(h), revision = h.echo.lastAppliedRev!;
          const replace = () => {
            replacement = receiving(f, scoped, f.state(), h.echo.map);
            opening = replacement.begin();
          };
          const off = phase === "failure" ? h.echo.replica.onStateChange(() => {
            if (h.echo.diagnostics().status !== "failed" || replacement !== undefined) return;
            h.a.releaseManagement(h.management.owner); replace();
          }) : h.echo.replica.onDispose(() => { replace(); throw Error("disposal listener failed"); });
          const pending = h.echo.recover().then(value => ({ ok: true, value }), error => ({ ok: false, error }));
          const waits = [h.echo.wait_until_ready(), h.echo.replica.waitUntilReady()]
            .map(p => p.then(() => "ready", () => "rejected"));
          if (phase === "failure") h.echo.session.dispose();
          else assert.throws(() => h.echo.session.dispose(), /disposal listener failed/);
          off();
          assert.equal((await bounded_lifecycle(pending)).ok, false);
          assert.deepEqual(await bounded_lifecycle(Promise.all(waits)), ["rejected", "rejected"]);
          assert_position(h, revision, false, "failed", "disposed");
          assert.ok(replacement); assert.ok(opening);
          const next = await bounded_lifecycle(opening);
          const nextWaits = [replacement.echo.replica.waitUntilReady(), replacement.echo.wait_until_ready()];
          next.send({ ...next.recoveryPlan, outcome: "current" }); next.send(next.caught);
          assert.ok((await bounded_lifecycle(next.result)).ok); await bounded_lifecycle(Promise.all(nextWaits));
          assert_position(replacement, revision, true, "live");
          unchanged(replacement.echo.replica, () => {
            old.send(old.snapshot); old.send(old.caught); old.end({ kind: "invalid" }); h.dispose();
          });
          assert_position(replacement, revision, true, "live");
        } finally { h.dispose(); replacement?.dispose(); f.l.dispose(); }
      }
    });

    await check(`${label} progress owns every field once and rejects revoked entry grants`, async () => {
      const f = await fixture(!scoped), h = receiving(f, scoped);
      try {
        const position = h.a.clientProjection()!, revision = position.revision;
        const progress = { ...position.authority, registryDigest: position.registry.digest, prevRev: revision, rev: revision + 1 };
        for (const field of ["logicalMapId", "incarnationId", "registryDigest", "prevRev", "rev"] as const) {
          for (const reacquire of [false, true]) {
            let hit = false;
            unchanged(h.echo.replica, () => assert.throws(() => h.echo.replica.advanceHostedProgress(new Proxy(progress, {
              get(target, key, receiver) {
                if (key === field && !hit) {
                  hit = true; h.a.releaseManagement(h.management.owner);
                  if (reacquire) h.a.claimManagement(h.management.owner);
                }
                return Reflect.get(target, key, receiver);
              },
            }))));
            assert.ok(hit); h.a.claimManagement(h.management.owner);
          }
        }
        const reads = new Map<PropertyKey, number>(), mapRevision = h.echo.map!.rev;
        let commits = 0;
        const off = h.echo.map!.commits.observe(() => commits++);
        assert.equal(h.echo.replica.advanceHostedProgress(new Proxy(progress, { get(target, key, receiver) {
          reads.set(key, (reads.get(key) ?? 0) + 1); return Reflect.get(target, key, receiver);
        } })), revision + 1);
        off();
        for (const field of Object.keys(progress)) assert.equal(reads.get(field), 1, field);
        assert.equal(h.a.clientProjection()!.revision, revision + 1);
        assert.equal(h.echo.map!.rev, mapRevision); assert.equal(commits, 0);
        unchanged(h.echo.replica, () => assert.throws(() => h.echo.replica.advanceHostedProgress(progress)));
      } finally { h.dispose(); f.l.dispose(); }
    });

    await check(`${label} obsolete progress cannot replace revision 4 with revision 3`, async () => {
      const f = await fixture(!scoped), h = receiving(f, scoped);
      let next: ReturnType<typeof replica> | undefined;
      try {
        const position = h.a.clientProjection()!; assert.equal(position.revision, 2);
        const progress = (prevRev: number) => ({ ...position.authority, registryDigest: position.registry.digest, prevRev, rev: prevRev + 1 });
        const ledger = h.a.identityEpoch().issued(), mapRevision = h.echo.map!.rev, ids = h.a.libraries();
        const roots = ids.map(id => h.a.root(id)), css = h.echo.map!.doc.must("page").css.snapshot();
        let hit = false;
        assert.throws(() => h.echo.replica.advanceHostedProgress(new Proxy(progress(2), { get(target, key, receiver) {
          if (key === "rev" && !hit) {
            hit = true; h.a.releaseManagement(h.management.owner); next = replica(h.echo.map);
            assert.equal(next.advanceHostedProgress(progress(2)), 3);
            assert.equal(next.advanceHostedProgress(progress(3)), 4);
          }
          return Reflect.get(target, key, receiver);
        } })));
        assert.ok(hit); assert.equal(h.a.clientProjection()!.revision, 4);
        assert_position(h, 4, false, "idle", "idle"); next!.captureManagementFence()();
        assert.equal(h.a.identityEpoch().issued(), ledger); assert.equal(h.echo.map!.rev, mapRevision);
        assert.deepEqual(h.a.libraries(), ids); ids.forEach((id, index) => assert.equal(h.a.root(id), roots[index]));
        assert.equal(h.echo.map!.doc.must("page").css.snapshot(), css);
        assert.equal(next!.advanceHostedProgress(progress(4)), 5);
      } finally { next?.dispose(); h.dispose(); f.l.dispose(); }
    });

    for (const failure of ["synchronous", "asynchronous"] as const) {
      await check(`${label} ${failure} open failure relinquishes ownership and readiness waits for legitimate retry`, async () => {
        const f = await fixture(!scoped), h = receiving(f, scoped);
        try {
          h.echo.attachTransport(); await h.echo.session.create(); h.opening.failure = failure;
          const revision = h.echo.lastAppliedRev!, outcomes: string[] = [];
          const waits = [h.echo.replica.waitUntilReady(), h.echo.wait_until_ready()]
            .map(p => p.then(() => { outcomes.push("ready"); }, () => { outcomes.push("rejected"); }));
          await assert.rejects(bounded_lifecycle(h.echo.recover()), /review open failure/);
          assert_position(h, revision, false, "idle"); assert.equal(h.opening.attempts, 1);
          assert.deepEqual(outcomes, [], "recoverable interruption keeps waiters for the next accepted recovery");
          delete h.opening.failure;
          const retry = await h.begin(); retry.send({ ...retry.recoveryPlan, outcome: "current" }); retry.send(retry.caught);
          assert.ok((await bounded_lifecycle(retry.result)).ok); await bounded_lifecycle(Promise.all(waits));
          assert.deepEqual(outcomes, ["ready", "ready"]); assert_position(h, revision, true, "live");
          assert.equal(h.opening.attempts, 2); assert.equal(retry.signal!.aborted, false);
        } finally { h.dispose(); f.l.dispose(); }
      });

      for (const phase of ["cleanup", "opening-callback"] as const) {
        await check(`${label} ${failure} open failure preserves replacement recovery from ${phase}`, async () => {
          const f = await fixture(!scoped), h = receiving(f, scoped);
          let replacement: ReturnType<typeof h.begin> | undefined;
          try {
            await finish(h); h.opening.failure = failure;
            const off = h.echo.replica.onStateChange(() => {
              if (h.echo.diagnostics().status !== "idle" || replacement !== undefined) return;
              delete h.opening.failure; delete h.opening.before;
              replacement = h.begin();
            });
            if (phase === "opening-callback") h.opening.before = ({ observer }) => {
              observer.onEnd({ kind: "interrupted", cause: Error("opening callback interrupted") });
            };
            await assert.rejects(bounded_lifecycle(h.echo.recover()), phase === "cleanup" ? /review open failure/ : /opening callback interrupted/);
            off(); assert.ok(replacement);
            const next = await bounded_lifecycle(replacement);
            const waits = [h.echo.replica.waitUntilReady(), h.echo.wait_until_ready()];
            next.send({ ...next.recoveryPlan, outcome: "current" }); next.send(next.caught);
            assert.ok((await bounded_lifecycle(next.result)).ok); await bounded_lifecycle(Promise.all(waits));
            assert_position(h, next.caught.throughRev, true, "live");
            assert.equal(next.signal!.aborted, false); assert.equal(h.opening.cancellations, 0);
          } finally { h.dispose(); f.l.dispose(); }
        });
      }
    }
  }

  await check("public HTTP Echo terminal session disposal cannot retain caught-up readiness", async () => {
    const map = hsonLiveMap.fromLibraries({ state: { data: { n: 0 } } });
    const locus = create_locus_fixture({ ...authority_definitions_from_map_fixture(map, [{ name: "state", ownership: "shared" }]),
      defaultProjection: { libraries: ["state"] }, authorizeProjection: () => ({ libraries: ["state"] }) });
    const retained = await locus.session.create({ libraries: ["state"] }, { connection: { principalId: "terminal-review" } });
    const binder = bind_locus_http(locus, { endpoint: "/_hson" });
    const transport = hsonLiveMap.echo.transport.http({ endpoint: "https://example.test/_hson", fetch: async (input, init) =>
      binder.handle(new Request(String(input), init), { principalId: "terminal-review" }) });
    const echo = await hsonLiveMap.echo.create({ now: retained.now(), credential: retained.credential!, transport });
    try {
      const revision = echo.sync.appliedRev;
      assert.equal(echo.sync.status, "caught_up"); echo.session.dispose();
      assert.equal(echo.session.status, "disposed"); assert.equal(echo.sync.status, "failed");
      assert.equal(echo.sync.appliedRev, revision); assert.ok(echo.sync.failure);
      await assert.rejects(echo.session.reattach(), /disposed/i);
      assert.equal(echo.sync.status, "failed");
    } finally { echo.dispose(); binder.dispose(); locus.dispose(); }
  });
}

export async function retry_progress_publication_cases(check: (name: string, run: () => Promise<void>) => Promise<void>) {
  const reportingGlobal: typeof globalThis & { reportError?: (error: unknown) => void } = globalThis;
  for (const scoped of [false, true]) {
    const label = scoped ? "scoped" : "flat";
    for (const failure of ["synchronous", "asynchronous"] as const) {
      for (const completion of ["retry", "dispose", "replacement"] as const) {
        await check(`${label} ${failure} open failure with throwing idle listener permits ${completion}`, async () => {
          const f = await fixture(!scoped), h = receiving(f, scoped);
          const originalReporter = reportingGlobal.reportError, reports: unknown[] = [], unhandled: unknown[] = [];
          const onUnhandled = (error: unknown) => { unhandled.push(error); };
          reportingGlobal.reportError = error => { reports.push(error); };
          process.on("unhandledRejection", onUnhandled);
          const callbackError = Error("idle callback failed after choosing recovery"), outcomes: string[] = [];
          let waits: Promise<void>[] = [], replacement: ReturnType<typeof h.begin> | undefined;
          let failedSignal: import("../../src/types/echo.transport.types.ts").EchoCancellationSignal | undefined;
          let nextSignal: typeof failedSignal;
          let off = () => {};
          try {
            const old = await finish(h), revision = old.caught.throughRev;
            const grant = h.a.captureManagementFence(h.management.owner);
            h.opening.failure = failure;
            h.opening.before = ({ signal }) => {
              failedSignal = signal;
              waits = [h.echo.replica.waitUntilReady(), h.echo.wait_until_ready()]
                .map(p => p.then(() => { outcomes.push("ready"); }, () => { outcomes.push("rejected"); }));
            };
            off = h.echo.replica.onStateChange(() => {
              if (h.echo.diagnostics().status !== "idle") return;
              delete h.opening.failure; delete h.opening.before;
              if (completion === "dispose") h.echo.session.dispose();
              else if (completion === "replacement") replacement = h.begin();
              else h.opening.before = ({ request, observer, signal }) => {
                nextSignal = signal;
                observer.onOutput({ ...old.recoveryPlan, id: request.id, outcome: "current" });
                observer.onOutput({ ...old.caught, id: request.id });
              };
              throw callbackError;
            });
            await assert.rejects(bounded_lifecycle(h.echo.recover()), /review open failure/);
            off();
            assert.equal(failedSignal!.aborted, true);
            if (completion === "replacement") {
              assert.ok(replacement); const next = await bounded_lifecycle(replacement);
              nextSignal = next.signal;
              next.send({ ...next.recoveryPlan, outcome: "current" }); next.send(next.caught);
              assert.deepEqual(await bounded_lifecycle(next.result), { ok: true, value: { outcome: "current", revision } });
            }
            await bounded_lifecycle(Promise.all(waits));
            // Let the discarded opening promise's rejection and any stale retry run.
            await new Promise(resolve => setTimeout(resolve, completion === "retry" ? 0 : 1100));
            assert.deepEqual(unhandled, []); assert.equal(reports.length, 1);
            assert.equal(reports[0], callbackError, "async reporting retains the original callback error");
            if (completion === "dispose") {
              assert.deepEqual(outcomes, ["rejected", "rejected"]);
              assert_position(h, revision, false, "failed", "disposed");
              assert.equal(h.echo.replica.disposed, true); assert.equal(h.opening.attempts, 2);
              assert.throws(grant); const next = replica(h.echo.map); next.dispose();
            } else {
              assert.deepEqual(outcomes, ["ready", "ready"]); grant();
              assert_position(h, revision, true, "live"); assert.equal(h.echo.lastRecoveryOutcome, "current");
              assert.equal(nextSignal!.aborted, false); assert.equal(h.opening.attempts, 3);
              old.end({ kind: "invalid", cause: Error("obsolete feed") });
              assert_position(h, revision, true, "live"); grant();
            }
          } finally {
            off(); h.dispose(); f.l.dispose();
            process.off("unhandledRejection", onUnhandled);
            if (originalReporter === undefined) Reflect.deleteProperty(reportingGlobal, "reportError");
            else reportingGlobal.reportError = originalReporter;
          }
        });
      }
    }

    await check(`${label} synchronous end callback errors propagate after eligible retry is secured`, async () => {
      const f = await fixture(!scoped), h = receiving(f, scoped);
      try {
        const old = await finish(h), revision = old.caught.throughRev, callbackError = Error("direct idle callback failed");
        const grant = h.a.captureManagementFence(h.management.owner);
        const off = h.echo.replica.onStateChange(() => { if (h.echo.diagnostics().status === "idle") throw callbackError; });
        assert.throws(() => old.end({ kind: "interrupted" }), error => error === callbackError); off();
        assert_position(h, revision, false, "idle"); grant();
        const waits = [h.echo.replica.waitUntilReady(), h.echo.wait_until_ready()];
        h.opening.before = ({ request, observer }) => {
          observer.onOutput({ ...old.recoveryPlan, id: request.id, outcome: "current" });
          observer.onOutput({ ...old.caught, id: request.id });
        };
        await bounded_lifecycle(Promise.all(waits)); grant();
        assert_position(h, revision, true, "live"); assert.equal(h.opening.attempts, 2);
      } finally { h.dispose(); f.l.dispose(); }
    });

    await check(`${label} accepted internal progress publishes its installed cursor without graph work and completes recovery`, async () => {
      const f = await fixture(!scoped), h = receiving(f, scoped);
      try {
        await finish(h);
        const grant = h.a.captureManagementFence(h.management.owner), position = h.a.clientProjection()!;
        const progress = (prevRev: number) => ({ ...position.authority, registryDigest: position.registry.digest, prevRev, rev: prevRev + 1 });
        const revision = h.echo.map!.rev, ledger = h.a.identityEpoch().issued(), ids = h.a.libraries(), roots = ids.map(id => h.a.root(id));
        const installed: number[] = []; let commits = 0, published = 0;
        const off = h.a.observeAuthorityPosition(rev => { installed.push(rev); assert.equal(h.echo.lastAppliedRev, h.a.clientProjection()!.revision); }, "installed");
        const stop = h.echo.map!.commits.observe(() => commits++), stopPublished = h.a.observeAuthorityPosition(() => published++);
        assert.equal(h.echo.replica.advanceHostedProgress(progress(2)), 3);
        assert_position(h, 3, true, "live"); grant(); assert.deepEqual(installed, [3]);
        assert.equal(h.echo.map!.rev, revision); assert.equal(h.a.identityEpoch().issued(), ledger);
        assert.deepEqual(h.a.libraries(), ids); ids.forEach((id, index) => assert.equal(h.a.root(id), roots[index]));
        assert.equal(commits, 0); assert.equal(published, 0);
        for (const invalid of [progress(2), progress(1), progress(4), { ...progress(3), rev: 5 }, { ...progress(3), incarnationId: "wrong" }]) {
          unchanged(h.echo.replica, () => assert.throws(() => h.echo.replica.advanceHostedProgress(invalid)));
          assert_position(h, 3, true, "live"); grant();
        }
        const feed = await h.begin(), waits = [h.echo.replica.waitUntilReady(), h.echo.wait_until_ready()];
        assert.equal(feed.request.cursor!.lastAppliedRev, 3);
        feed.send({ ...feed.recoveryPlan, outcome: "replay", headRev: 4 });
        h.echo.replica.advanceHostedProgress(progress(3));
        feed.send({ ...feed.caught, throughRev: 4 });
        assert.deepEqual(await bounded_lifecycle(feed.result), { ok: true, value: { outcome: "replay", revision: 4 } });
        await bounded_lifecycle(Promise.all(waits)); assert_position(h, 4, true, "live"); grant();
        off(); stop(); stopPublished(); assert.deepEqual(installed, [3, 4]); assert.equal(commits, 0); assert.equal(published, 0);
        // A legitimate graph replay after progress uses the same authority cursor.
        for (const title of ["hidden-3", "hidden-4"]) await f.stage(w => {
          const d = w.doc.must("hidden"); if (d.mode !== "document") throw Error();
          d.attrs.set({ kind: "path", path: path([0]) }, "title", title);
        });
        const commit = await f.stage(w => { const d = w.data.must("data"); if (String(d.mode) === "document") throw Error(); d.at(["n"]).set(3); });
        assert.equal(commit.prevRev, 4);
        h.echo.replica.replayScopedHosted(commit);
        assert_position(h, 5, true, "live"); grant();
      } finally { h.dispose(); f.l.dispose(); }
    });

    await check(`${label} installed progress observers retain newer reentrant progress`, async () => {
      const f = await fixture(!scoped), h = receiving(f, scoped);
      try {
        await finish(h);
        const grant = h.a.captureManagementFence(h.management.owner), position = h.a.clientProjection()!;
        const progress = (prevRev: number) => ({ ...position.authority, registryDigest: position.registry.digest, prevRev, rev: prevRev + 1 });
        const seen: number[] = [], late: number[] = []; let commits = 0;
        const off = h.a.observeAuthorityPosition(rev => {
          seen.push(rev);
          if (rev === 3) h.echo.replica.advanceHostedProgress(progress(3));
        }, "installed");
        const later = h.a.observeAuthorityPosition(rev => { late.push(rev); assert_position(h, 4, true, "live"); }, "installed");
        const stop = h.echo.map!.commits.observe(() => commits++);
        assert.equal(h.echo.replica.advanceHostedProgress(progress(2)), 3);
        off(); later(); stop();
        assert.deepEqual(seen, [3, 4]); assert.deepEqual(late, [4, 4]); assert.equal(commits, 0);
        assert_position(h, 4, true, "live"); grant();
        unchanged(h.echo.replica, () => assert.throws(() => h.echo.replica.advanceHostedProgress(progress(2))));
      } finally { h.dispose(); f.l.dispose(); }
    });
  }
}

export async function scoped_reconciliation_cases(check: (name: string, run: () => Promise<void>) => Promise<void>) {
  await retry_progress_publication_cases(check);
  await terminal_progress_open_cases(check);
  await recovery_closure_cases(check);
  await scoped_reconciliation_repair_cases(check);
  await check("initial state to missing-history reconciliation to ordered replay converges across independent Echoes", async () => {
    const f = await fixture(), start = f.state(), first = f.fresh(start), h = receiving(f, true, start), second = h.echo.replica;
    try {
      const a = view(first), b = view(second), oldA = a.scopes(), oldB = b.scopes(), originalGraph = f.a.root(f.pageId);
      const retired = oldB.map(s => s.rootQuid);
      const local = b.map.data.must("local"); if (String(local.mode) === "document") throw Error(); local.at(["n"]).set(77);
      add_interaction(b.map, { id: "local-nav", subject: { library: "localPage", path: [0] }, listener, kind: "browser", key: "nav", args: null });
      const localRoot = local.root();
      // The first transition changes only the occurrence lifetime, not graph content.
      const one = await f.stage(w => page(w).content.replace({ kind: "path", path: path([0, 0]) }, 0, node('<hson-part lib="parts" at="panel"/>')));
      assert.ok(canonical_hson_graph_equal(f.a.root(f.pageId), originalGraph)); first.replayScopedHosted(one);
      assert.equal(a.scopes()[2]!.lifetime, oldA[2]!.lifetime);
      assert.equal(a.scopes()[3]!.lifetime, oldA[3]!.lifetime);
      const two = await f.stage(w => { page(w).attrs.set({ kind: "path", path: path([0]) }, "title", "cut"); const d = w.data.must("data"); if (String(d.mode) === "document") throw Error(); d.at(["n"]).set(2); });
      first.replayScopedHosted(two);
      const beforeThird = a.scopes();
      const three = await f.stage(w => page(w).content.replace({ kind: "path", path: path([0, 0]) }, 1, node('<hson-part lib="parts" at="leaf"/>')));
      first.replayScopedHosted(three);
      assert.equal(a.scopes()[0]!.lifetime, beforeThird[0]!.lifetime);
      assert.equal(a.scopes()[1]!.lifetime, beforeThird[1]!.lifetime);
      assert.equal((a.map.doc.must("page").css.snapshot().match(/padding:3px/g) ?? []).length, 1);
      assert.equal(a.scopes()[0]!.lifetime === oldA[0]!.lifetime, false);
      assert.equal(a.scopes()[1]!.lifetime === oldA[1]!.lifetime, false);
      const decision = plan(start.revision, f.l.rev, two.rev, [three], entry => entry);
      assert.deepEqual(decision, { outcome: "reconcile", reason: "history_unavailable" });
      await finish(h); assert.equal(h.echo.lastAppliedRev, f.l.rev);
      for (const scope of b.scopes()) assert.ok(!oldB.some(old => old.lifetime === scope.lifetime));
      for (const id of retired) { assert.equal(b.a.documentOverlay(b.id).pathForQuid(id), undefined); assert.ok(!b.map.doc.must("page").css.snapshot().includes(id)); }
      assert.match(b.map.doc.must("page").css.snapshot(), /border:0/);
      assert.equal(local.snap(["n"]), 77); assert.deepEqual(local.root(), localRoot);
      assert.match(JSON.stringify(b.a.systemRoot(b.a.systemState("@hson/canonical-interactions")!)), /local-nav/);
      same(f, first); same(f, second);
      const beforeA = a.scopes(), beforeB = b.scopes();
      const four = await f.stage(w => page(w).attrs.set({ kind: "path", path: path([0]) }, "title", "resumed"));
      assert.equal(plan(three.rev, f.l.rev, three.rev, [four], entry => entry).outcome, "replay");
      for (const cap of [first, second]) cap.replayScopedHosted(four);
      assert.deepEqual(a.scopes().map(s => s.lifetime), beforeA.map(s => s.lifetime));
      assert.deepEqual(b.scopes().map(s => s.lifetime), beforeB.map(s => s.lifetime));
      same(f, first); same(f, second);
      assert.equal(h.echo.lastAppliedRev, four.rev);
      const ids = [f.a, a.a, b.a].map(x => new Set(enumerate_livemap_issued_quids(x.identityEpoch().issued())));
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) for (const id of ids[i]!) assert.ok(!ids[j]!.has(id));
      assert.match(b.map.doc.must("page").css.snapshot(), /border:0/);
      const current = await h.begin();
      assert.equal(current.request.cursor!.lastAppliedRev, four.rev);
      assert.equal(plan(four.rev, f.l.rev, four.rev, [], entry => entry).outcome, "current");
      unchanged(second, () => { current.send({ ...current.recoveryPlan, outcome: "current" }); current.send(current.caught); });
      const result = await current.result; assert.ok(result.ok); assert.equal(result.value.outcome, "current");
    } finally { first.dispose(); h.dispose(); f.l.dispose(); }
  });

  await check("graph-identical reconciliation retires every occurrence and descriptor ownership remains complete", async () => {
    const f = await fixture(), h = receiving(f), r = view(h.echo.replica), old = r.scopes(), graph = r.a.root(r.id);
    try {
      await f.stage(w => page(w).content.replace({ kind: "path", path: path([0, 0]) }, 0, node('<hson-part lib="parts" at="panel"/>')));
      await finish(h); assert.ok(canonical_hson_graph_equal(r.a.root(r.id), graph));
      for (const scope of r.scopes()) assert.ok(!old.some(previous => previous.lifetime === scope.lifetime));
      same(f, h.echo.replica);
      assert.match(JSON.stringify(r.a.systemRoot(r.a.systemState("@hson/canonical-interactions")!)), /shared-footer/);
      assert.doesNotMatch(JSON.stringify(r.a.systemRoot(r.a.systemState("@hson/canonical-interactions")!)), /hidden-event/);
    } finally { h.dispose(); f.l.dispose(); }
  });

  const failures: readonly [string, (feed: Awaited<ReturnType<ReturnType<typeof receiving>["begin"]>>) => void][] = [
    ["snapshot without plan", x => x.send(x.snapshot)],
    ["missing snapshot", x => { x.send(x.recoveryPlan); x.send(x.caught); }],
    ["duplicate plan", x => { x.send(x.recoveryPlan); x.send(x.recoveryPlan); }],
    ["conflicting plan", x => { x.send(x.recoveryPlan); x.send({ ...x.recoveryPlan, headRev: x.recoveryPlan.headRev + 1 }); }],
    ["announced revision below snapshot", x => { x.send({ ...x.recoveryPlan, headRev: x.recoveryPlan.headRev - 1 }); x.send(x.snapshot); }],
    ["announced revision above snapshot", x => { x.send({ ...x.recoveryPlan, headRev: x.recoveryPlan.headRev + 1 }); x.send(x.snapshot); }],
    ["stale snapshot", x => { x.send(x.recoveryPlan); x.send({ ...x.snapshot, snapshot: { ...x.snapshot.snapshot, revision: 0 } }); }],
    ["stale plan", x => x.send({ ...x.recoveryPlan, headRev: x.request.cursor!.lastAppliedRev - 1 })],
    ["wrong registry", x => { x.send({ ...x.recoveryPlan, registryDigest: "0".repeat(64) }); x.send(x.snapshot); }],
    ["wrong projection", x => { x.send({ ...x.recoveryPlan, projectionDigest: "0".repeat(64) }); x.send(x.snapshot); }],
    ["wrong projection sequence", x => { x.send({ ...x.recoveryPlan, projectionSequence: 1 }); x.send({ ...x.caught, projectionSequence: 0 }); }],
    ["wrong incarnation", x => x.send({ ...x.recoveryPlan, incarnationId: "wrong" })],
    ["wrong logical authority", x => x.send({ ...x.recoveryPlan, logicalMapId: "wrong" })],
    ["explicit rejection", x => x.send({ ...x.recoveryPlan, outcome: "reject", error: { message: "Unauthorized" } })],
    ["malformed final Library", x => { const state: any = structuredClone(x.snapshot.snapshot); delete state.libraries.find((e: any) => e.name === "zpage").scopes.occurrences; x.send(x.recoveryPlan); x.send({ ...x.snapshot, snapshot: state }); }],
    ["unavailable scoped evidence", x => { const state: any = structuredClone(x.snapshot.snapshot); delete state.libraries.find((e: any) => e.name === "zpage").scopes; x.send(x.recoveryPlan); x.send({ ...x.snapshot, snapshot: state }); }],
  ];
  for (const [name, deliver] of failures) await check(`${name} rejects without installation and permits authorized retry`, async () => {
    const f = await fixture(), h = receiving(f);
    try {
      await f.stage(w => page(w).attrs.set({ kind: "path", path: path([0]) }, "title", "next"));
      const feed = await h.begin();
      unchanged(h.echo.replica, () => deliver(feed));
      assert.equal((await feed.result).ok, false);
      assert.equal(h.echo.lastAppliedRev, feed.request.cursor!.lastAppliedRev);
      await finish(h); same(f, h.echo.replica);
      const next = await f.stage(w => page(w).attrs.set({ kind: "path", path: path([0]) }, "title", "retry-replay"));
      h.echo.replica.replayScopedHosted(next); same(f, h.echo.replica);
    } finally { h.dispose(); f.l.dispose(); }
  });

  await check("duplicate and conflicting snapshots cannot recreate lifetimes after the first accepted receipt", async () => {
    for (const completed of [false, true]) for (const conflicting of [false, true]) {
      const f = await fixture(), h = receiving(f);
      try {
        const feed = await h.begin(); feed.send(feed.recoveryPlan); feed.send(feed.snapshot);
        if (completed) { feed.send(feed.caught); assert.equal((await feed.result).ok, true); }
        unchanged(h.echo.replica, () => feed.send({ ...feed.snapshot, snapshot: conflicting ? { ...feed.snapshot.snapshot, revision: 100 } : feed.snapshot.snapshot }));
        if (!completed) assert.equal((await feed.result).ok, false);
        assert.equal(h.echo.diagnostics().status, "failed");
        await finish(h); same(f, h.echo.replica);
      } finally { h.dispose(); f.l.dispose(); }
    }
  });

  for (const phase of ["envelope", "inspection", "allocation"] as const) {
    for (const action of ["release", "same-owner", "replacement", "dispose", "session"] as const) {
      await check(`${phase} ${action} invalidates the original recovery grant atomically`, async () => {
        const f = await fixture(), h = receiving(f), r = view(h.echo.replica), replacement = {};
        try {
          await f.stage(w => page(w).attrs.set({ kind: "path", path: path([0]) }, "title", "new"));
          const feed = await h.begin(); feed.send(feed.recoveryPlan);
          let hit = false, count = 0;
          const intervene = () => {
            if (hit) return; hit = true;
            if (action === "dispose") h.echo.dispose();
            else if (action === "session") h.fence();
            else { h.a.releaseManagement(h.management.owner); if (action === "same-owner") h.a.claimManagement(h.management.owner); if (action === "replacement") h.a.claimManagement(replacement); }
          };
          let message: Snapshot = feed.snapshot;
          if (phase === "envelope") message = new Proxy(message, { get(target, key, receiver) { intervene(); return Reflect.get(target, key, receiver); } });
          if (phase === "inspection") message = { ...message, snapshot: new Proxy(structuredClone(message.snapshot), { ownKeys(target) { intervene(); return Reflect.ownKeys(target); } }) };
          if (phase === "allocation") allocator(r.a.identityEpoch().owner, () => { intervene(); return `d${(++count).toString(36).padStart(8, "0")}`; });
          unchanged(h.echo.replica, () => feed.send(message));
          assert.equal(hit, true); assert.equal((await feed.result).ok, false);
          allocator(r.a.identityEpoch().owner, undefined);
          if (action !== "dispose") {
            h.a.releaseManagement(replacement); h.a.claimManagement(h.management.owner);
            await finish(h); same(f, h.echo.replica);
          }
        } finally { allocator(r.a.identityEpoch().owner, undefined); h.a.releaseManagement(replacement); h.dispose(); f.l.dispose(); }
      });
    }
  }

  for (const phase of ["inspection", "allocation"] as const) await check(`${phase} replacement-manager work survives rejection of the older candidate`, async () => {
    const f = await fixture(), h = receiving(f), r = view(h.echo.replica);
    let next: ReturnType<typeof replica> | undefined;
    try {
      const commit = await f.stage(w => page(w).attrs.set({ kind: "path", path: path([0]) }, "title", "replacement-work"));
      const feed = await h.begin(); feed.send(feed.recoveryPlan);
      let hit = false;
      let installed: ReturnType<typeof r.scopes> | undefined;
      let ledger = r.a.identityEpoch().issued();
      const intervene = () => {
        if (hit) return; hit = true;
        allocator(r.a.identityEpoch().owner, undefined);
        h.a.releaseManagement(h.management.owner); next = replica(r.map); next.replayScopedHosted(commit);
        installed = r.scopes(); ledger = r.a.identityEpoch().issued();
      };
      const input = phase === "inspection" ? new Proxy(structuredClone(feed.snapshot.snapshot), { ownKeys(target) {
        intervene(); return Reflect.ownKeys(target);
      } }) : feed.snapshot.snapshot;
      if (phase === "allocation") allocator(r.a.identityEpoch().owner, () => { intervene(); return "dfghjkmnp"; });
      feed.send({ ...feed.snapshot, snapshot: input }); assert.equal((await feed.result).ok, false);
      assert.equal(hit, true); same(f, next!);
      assert.equal(r.scopes(), installed); assert.equal(r.a.identityEpoch().issued(), ledger);
      assert.match(JSON.stringify(r.a.root(r.id)), /replacement-work/);
    } finally { allocator(r.a.identityEpoch().owner, undefined); next?.dispose(); h.dispose(); f.l.dispose(); }
  });
  await check("ordinary flat reconciliation uses the same recovery fences and preserves local state", async () => {
    const f = await fixture(true), h = receiving(f, false);
    try {
      const local = h.echo.map!.data.must("local"); if (String(local.mode) === "document") throw Error(); local.at(["n"]).set(91);
      await f.stage(w => page(w).attrs.set({ kind: "path", path: path([0]) }, "title", "flat-cut"));
      await finish(h);
      assert.equal(h.echo.lastAppliedRev, f.l.rev); assert.equal(local.snap(["n"]), 91);
      const r = view(h.echo.replica); assert.ok(canonical_hson_graph_equal(r.a.root(r.id), f.a.root(f.pageId)));
      assert.equal(r.a.documentScopes(r.id), undefined);
      const doc = h.echo.map!.doc.must("page"); if (doc.mode !== "document") throw Error(); assert.ok(doc.q("footer"));
    } finally { h.dispose(); f.l.dispose(); }
  });

  await check("a snapshot still being inspected cannot satisfy caught-up or a nested second receipt", async () => {
    for (const nested of ["caught-up", "snapshot"] as const) {
      const f = await fixture(), h = receiving(f);
      try {
        const feed = await h.begin(); feed.send(feed.recoveryPlan);
        let hit = false;
        const snapshot = new Proxy(structuredClone(feed.snapshot.snapshot), { ownKeys(target) {
          if (!hit) { hit = true; feed.send(nested === "caught-up" ? feed.caught : feed.snapshot); }
          return Reflect.ownKeys(target);
        } });
        unchanged(h.echo.replica, () => feed.send({ ...feed.snapshot, snapshot }));
        assert.equal(hit, true); assert.equal((await feed.result).ok, false);
        await finish(h);
      } finally { h.dispose(); f.l.dispose(); }
    }
  });

  await check("caught-up cannot claim an unreceived tail or a different projection sequence", async () => {
    for (const field of ["throughRev", "projectionSequence"] as const) {
      const f = await fixture(), h = receiving(f);
      try {
        const feed = await h.begin(); feed.send(feed.recoveryPlan); feed.send(feed.snapshot);
        unchanged(h.echo.replica, () => feed.send({ ...feed.caught, [field]: 999 }));
        assert.equal((await feed.result).ok, false);
        await finish(h);
      } finally { h.dispose(); f.l.dispose(); }
    }
  });

  await check("missing equal-revision snapshot cannot announce readiness", async () => {
    const f = await fixture(), h = receiving(f);
    try {
      const feed = await h.begin();
      assert.equal(feed.caught.throughRev, h.echo.lastAppliedRev);
      unchanged(h.echo.replica, () => { feed.send(feed.recoveryPlan); feed.send(feed.caught); });
      assert.equal((await feed.result).ok, false); assert.equal(h.echo.replica.ready, false);
      await finish(h);
    } finally { h.dispose(); f.l.dispose(); }
  });

}
