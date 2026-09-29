import assert from "node:assert/strict";
import { hsonLiveMap, validate_document_path, type LiveMap } from "../src/api/livemap/index.ts";
import { hsonLocus, create_persistent_locus, type LocusOptions, type LocusSocketLike } from "../src/api/locus/index.ts";
import { hsonEcho } from "../src/api/echo/index.ts";
import { create_registry_locus_internal } from "../src/api/locus/locus.registry.ts";
import { create_locus_hosted_aggregate_internal, type LocusHostedAggregateDraft } from "../src/api/locus/locus.aggregate.ts";
import { create_locus_hosted_aggregate_socket_internal } from "../src/api/locus/locus.aggregate.socket.ts";
import { MemoryCheckpointAdapter } from "./helpers/memory-checkpoint-adapter.mts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "locus.hosted-noop", title: "Hosted no-op acceptance", category: "Locus", runtime: "node",
  tags: Object.freeze(["locus", "projection", "recovery", "persistence", "public"]),
});

// Same in-memory socket pattern as the public capture/recovery acceptance suite.
function socket_pair() {
  const toServer = new Set<(raw: string) => void>();
  const toClient = new Set<(raw: string) => void>();
  const sent: Record<string, unknown>[] = [];
  const client: LocusSocketLike = {
    send(raw) { for (const listener of [...toServer]) listener(raw); }, close() {},
    onMessage(listener) { toClient.add(listener); return () => { toClient.delete(listener); }; },
    onClose() { return () => {}; },
  };
  const server: LocusSocketLike = {
    send(raw) { sent.push(JSON.parse(raw)); for (const listener of [...toClient]) listener(raw); }, close() {},
    onMessage(listener) { toServer.add(listener); return () => { toServer.delete(listener); }; },
    onClose() { return () => {}; },
  };
  return { client, server, sent, listeners: () => toServer.size + toClient.size,
    messages: (type: string) => sent.filter(message => message.type === type) };
}

function make_map() {
  return hsonLiveMap.fromLibraries({
    game: { data: { ready: true } },
    private: { data: { ready: true } },
    page: { document: "<main/>" },
  });
}

function data_draft(draft: LocusHostedAggregateDraft, name: string) {
  const library = draft.lib(name);
  if (!("at" in library)) throw new Error("Expected data Library draft.");
  return library;
}

function data(map: LiveMap, name: string) {
  const library = map.lib(name);
  if (library.mode === "document") throw new Error("Expected data Library.");
  return library;
}

function options(map: ReturnType<typeof make_map>): LocusOptions<typeof map> {
  return { map,
    exposure: [{ library: "game", exposure: "client-public" },
      { library: "private", exposure: "server-private" }, { library: "page", exposure: "client-public" }],
    defaultProjection: { libraries: ["game"] }, authorizeProjection: () => ({ libraries: ["game", "page"] }),
    actions: { noop: async context => {
      await context.mutate(draft => data_draft(draft, "game").at(["ready"]).set(true));
    } },
  };
}

// Only snapshot fallback uses an internal history-budget hook. Mutation, session
// creation, capture, client composition, action completion, and recovery are public.
for (const strategy of ["replay", "snapshot"] as const) {
  const map = make_map();
  const locus = strategy === "replay" ? hsonLocus.create(options(map))
    : create_registry_locus_internal(options(map), { maxHistoryBytes: 1 }).locus;
  const pair = socket_pair();
  const endpoint = hsonEcho.create({ socket: pair.client });
  let detach = () => {};
  let commits = 0;
  let feeds = 0;
  const stopCommits = map.commits.observe(() => { commits += 1; });
  const stopFeed = map.lib("game").at([]).feed(() => { feeds += 1; });
  const noop = () => locus.mutate(draft => data_draft(draft, "game").at(["ready"]).set(true));
  try {
    const initial = map.capture();
    assert.equal(await noop(), undefined);
    assert.deepEqual(map.capture(), initial);
    assert.deepEqual([map.rev, locus.rev, commits, feeds], [0, 0, 0, 0]);

    detach = locus.connect(pair.server);
    endpoint.connect();
    await endpoint.session.create();
    const sessionId = endpoint.session.sessionId;
    const credential = endpoint.session.credential;
    assert.ok(sessionId && credential);
    const snapshot = locus.session.get(sessionId)!.cut().libs;
    const attachedSent = pair.sent.length;
    await noop(); // Regression: identical operation and authority state across attachment.
    await locus.mutate(draft => data_draft(draft, "game").at([]).replace({ ready: true }));
    await locus.mutate(draft => draft.lib("page").attrs.drop({ kind: "path", path: validate_document_path([0]) }, "missing"));
    await locus.mutate(draft => data_draft(draft, "private").at(["ready"]).set(true));
    assert.deepEqual(map.capture(), initial);
    assert.deepEqual(locus.session.get(sessionId)!.cut().libs, snapshot);
    assert.deepEqual([map.rev, locus.rev, commits, feeds, pair.sent.length], [0, 0, 0, 0, attachedSent]);

    const client = hsonLiveMap.fromClientSnapshot({ authority: snapshot, localLibraries: {} });
    endpoint.dispose(); detach();
    detach = locus.connect(pair.server);
    const echo = hsonEcho.create({ socket: pair.client, map: client,
      recovery: { logicalMapId: snapshot.authority.logicalMapId }, session: { credential } });
    try {
      echo.connect(); await echo.session.reattach();
      assert.equal((await echo.recovery.recover()).strategy, "current");
      const before = echo.recovery.debug();
      const sent = pair.sent.length;
      await noop();
      assert.deepEqual(echo.recovery.debug(), before);
      assert.equal(client.rev, 0);
      assert.equal(pair.sent.length, sent);
      assert.deepEqual(await locus.session.get(sessionId)!.update({ libraries: ["game"] }), {
        changed: false, sequence: 0, digest: snapshot.projectionDigest, authorityRev: 0,
      });
      const action = await echo.action("noop");
      assert.equal(action.type, "ack");
      assert.equal(action.completionRev, 0);
      assert.equal(action.seq, 1, "action sequencing is independent of authority revision");
      assert.equal(pair.sent.length, sent + 1, "only the action acknowledgement is sent");
      assert.deepEqual([map.rev, locus.rev, commits, feeds, echo.recovery.lastAppliedRev], [0, 0, 0, 0, 0]);

      await locus.mutate(draft => data_draft(draft, "game").at(["ready"]).set(false));
      assert.deepEqual([map.rev, locus.rev, commits, feeds, echo.recovery.lastAppliedRev], [1, 1, 1, 1, 1]);
      assert.equal(data(client, "game").snap(["ready"]), false);
      assert.equal(pair.messages("commit").length, 1);
      assert.equal(pair.messages("commit")[0]?.projectionSequence, 0);

      const privateNoopSent = pair.sent.length;
      await locus.mutate(draft => data_draft(draft, "private").at(["ready"]).set(true));
      assert.equal(pair.sent.length, privateNoopSent);
      await locus.mutate(draft => data_draft(draft, "private").at(["ready"]).set(false));
      assert.deepEqual([map.rev, locus.rev, commits, feeds, echo.recovery.lastAppliedRev], [2, 2, 2, 1, 2]);
      assert.equal(pair.messages("progress").length, 1);
      assert.equal(pair.messages("progress")[0]?.projectionSequence, 0);
      assert.equal(data(client, "game").snap(["ready"]), false);

      echo.disconnect(); detach();
      const retained = locus.session.get(sessionId)!.cut().libs;
      const offlineSent = pair.sent.length;
      await locus.mutate(draft => data_draft(draft, "game").at(["ready"]).set(false));
      assert.deepEqual(locus.session.get(sessionId)!.cut().libs, retained);
      assert.equal(pair.sent.length, offlineSent);
      await locus.mutate(draft => data_draft(draft, "game").at(["ready"]).set(true));
      assert.equal(locus.rev, 3);
      assert.equal(echo.recovery.lastAppliedRev, 2);
      detach = locus.connect(pair.server);
      echo.connect(); await echo.session.reattach();
      assert.equal((await echo.recovery.recover()).strategy, strategy);
      assert.equal(echo.recovery.lastAppliedRev, 3);
      assert.equal(data(client, "game").snap(["ready"]), true);
      assert.equal(pair.messages("recovery-commit").length, strategy === "replay" ? 1 : 0);
      assert.equal(pair.messages("recovery-snapshot").length, strategy === "snapshot" ? 1 : 0);
      assert.deepEqual([commits, feeds], [3, 2]);

      const empty = await locus.session.get(sessionId)!.update({ libraries: [] });
      assert.equal(empty.sequence, 1);
      const emptySnapshot = locus.session.get(sessionId)!.cut().libs;
      const emptySent = pair.sent.length;
      await noop();
      assert.equal(pair.sent.length, emptySent);
      assert.deepEqual(locus.session.get(sessionId)!.cut().libs, emptySnapshot);
      assert.equal(echo.recovery.lastAppliedRev, 3);
      assert.deepEqual(await locus.session.get(sessionId)!.update({ libraries: [] }), {
        changed: false, sequence: 1, digest: empty.digest, authorityRev: 3,
      });
    } finally { echo.dispose(); }
  } finally {
    stopCommits(); stopFeed(); endpoint.dispose(); detach(); locus.dispose();
    assert.equal(pair.listeners(), 0);
  }
  console.log(`ok - public no-op silence, second operator, action, private progress, empty projection, and ${strategy}`);
}

// Existing internal authority hooks expose acceptance gates and commit listeners.
{
  const map = make_map();
  const calls: string[] = [];
  const authority = create_locus_hosted_aggregate_internal({ map,
    prepareGate: () => { calls.push("prepare"); },
    beforeAccept: () => { calls.push("before"); return {
      install: () => { calls.push("install"); }, release: () => { calls.push("release"); },
    }; },
    gate: () => { calls.push("gate"); },
  });
  const stop = authority.on_commit(() => { calls.push("commit"); });
  try {
    const set = (value: boolean) => authority.mutate(draft => {
      const game = draft.lib("game");
      if (!("at" in game)) throw new Error("Expected data Library.");
      game.at(["ready"]).set(value);
    });
    const unchanged = await set(true);
    assert.ok(unchanged);
    assert.deepEqual([unchanged.changed, unchanged.prevRev, unchanged.rev, unchanged.operations,
      unchanged.replay.operations], [false, 0, 0, [], []]);
    assert.deepEqual(calls, []);
    await set(false);
    assert.deepEqual(calls, ["prepare", "before", "gate", "install", "commit", "release"]);
    calls.length = 0;
    await set(false);
    assert.deepEqual(calls, []);
    await set(true);
    assert.equal(map.rev, 2, "no-op acceptance leaves no outstanding reservation");
  } finally { stop(); authority.dispose(); }
  console.log("ok - unchanged hosted results bypass gates and internal commit notifications");
}

// Inspect retained history with the existing socket authority debug surface.
// Recovery without session-create establishes a non-resumable projected session.
{
  const map = make_map();
  const host = create_locus_hosted_aggregate_socket_internal({ ...options(map), actions: {} });
  const pair = socket_pair();
  const detach = host.connect(pair.server);
  try {
    pair.client.send(JSON.stringify({ type: "recover", id: "ephemeral", logicalMapId: host.logicalMapId }));
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(pair.messages("recovery-caught-up").length, 1);
    assert.equal(host.sessions.debug().sessions[0]?.resumable, false);
    const history = host.debug();
    const sent = pair.sent.length;
    const set = (value: boolean) => host.mutate(draft => {
      const game = draft.lib("game");
      if (!("at" in game)) throw new Error("Expected data Library.");
      game.at(["ready"]).set(value);
    });
    await set(true);
    assert.deepEqual(host.debug(), history);
    assert.equal(pair.sent.length, sent);
    await set(false);
    assert.equal(host.debug().retainedCommits, 1);
    assert.equal(pair.messages("commit").length, 1);
    const afterReal = host.debug();
    await set(false);
    assert.deepEqual(host.debug(), afterReal);
    assert.equal(pair.messages("commit").length, 1);
  } finally { detach(); host.dispose(); assert.equal(pair.listeners(), 0); }
  console.log("ok - non-resumable projected no-ops retain no history or wire events");
}

{
  const persistence = new MemoryCheckpointAdapter();
  const map = make_map();
  const locus = await create_persistent_locus({ ...options(map), persistence });
  const pair = socket_pair();
  const detach = locus.connect(pair.server);
  const echo = hsonEcho.create({ socket: pair.client });
  try {
    const state = persistence.state(locus.logicalMapId);
    assert.ok(state);
    const checkpoints = persistence.checkpointCalls.length;
    await locus.mutate(draft => data_draft(draft, "game").at(["ready"]).set(true));
    echo.connect(); await echo.session.create();
    await locus.mutate(draft => data_draft(draft, "game").at(["ready"]).set(true));
    assert.equal(persistence.appendCalls.length, 0);
    assert.equal(persistence.checkpointCalls.length, checkpoints);
    assert.deepEqual(persistence.state(locus.logicalMapId), state);
    await locus.mutate(draft => data_draft(draft, "game").at(["ready"]).set(false));
    assert.equal(persistence.appendCalls.length, 1);
    const after = persistence.state(locus.logicalMapId);
    assert.ok(after);
    assert.equal(after.commits.length, 1);
    assert.equal(after.commits[0]?.commit.rev, 1);
    assert.deepEqual(after.checkpoint, state.checkpoint);
    await locus.mutate(draft => data_draft(draft, "game").at(["ready"]).set(false));
    assert.deepEqual(persistence.state(locus.logicalMapId), after);
    assert.equal(persistence.appendCalls.length, 1);
  } finally { echo.dispose(); detach(); locus.dispose(); assert.equal(pair.listeners(), 0); }
  console.log("ok - public persistent no-ops leave checkpoint and durable tail unchanged");
}
