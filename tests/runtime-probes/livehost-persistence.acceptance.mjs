import assert from "node:assert/strict";
import {
  create_livehost_persistent_store,
  create_persistent_livehost,
  hson,
  LiveHostPersistenceError,
} from "../../src/index.ts";
import { canonical_hson_graph_equal } from "../../src/core/canonical-hson-equal.ts";

let checks = 0;
async function check(name, fn) {
  await fn();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const root = { kind: "path", path: [] };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function element(source = `<main data-_quid="0000000000001001"/>`) {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "element") throw new Error("expected element map");
  return map;
}

function clone(value) {
  return structuredClone(value);
}

class MemoryPersistenceAdapter {
  states = new Map();
  appendCalls = [];
  checkpointCalls = [];
  loadCalls = [];
  nextAppend;
  nextCheckpoint;
  nextLoad;
  failAppend;
  failCheckpoint;
  failLoad;
  loadOverride;

  deferAppend() { return this.nextAppend = deferred(); }
  deferCheckpoint() { return this.nextCheckpoint = deferred(); }
  deferLoad() { return this.nextLoad = deferred(); }

  async load(logicalMapId) {
    this.loadCalls.push(logicalMapId);
    if (this.failLoad) { const failure = this.failLoad; this.failLoad = undefined; throw failure; }
    if (this.nextLoad) { const pending = this.nextLoad; this.nextLoad = undefined; await pending.promise; }
    if (this.loadOverride !== undefined) return clone(this.loadOverride);
    const state = this.states.get(logicalMapId);
    return state === undefined ? undefined : clone(state);
  }

  async appendCommit(record) {
    this.appendCalls.push(record);
    if (this.failAppend) { const failure = this.failAppend; this.failAppend = undefined; throw failure; }
    if (this.nextAppend) { const pending = this.nextAppend; this.nextAppend = undefined; await pending.promise; }
    const state = this.states.get(record.logicalMapId);
    if (!state) throw new Error("checkpoint required");
    if (state.checkpoint.incarnationId !== record.incarnationId) throw new Error("incarnation conflict");
    const sameRevision = state.commits.find((item) => item.commit.rev === record.commit.rev);
    if (sameRevision) {
      if (JSON.stringify(sameRevision) === JSON.stringify(record)) return;
      throw new Error("same-revision conflict");
    }
    const expectedPrev = state.commits.at(-1)?.commit.rev ?? state.checkpoint.rev;
    if (record.commit.prevRev !== expectedPrev || record.commit.rev !== expectedPrev + 1) {
      throw new Error("noncontiguous append");
    }
    state.commits.push(clone(record));
  }

  async replaceCheckpoint(record) {
    this.checkpointCalls.push(record);
    if (this.failCheckpoint) { const failure = this.failCheckpoint; this.failCheckpoint = undefined; throw failure; }
    if (this.nextCheckpoint) { const pending = this.nextCheckpoint; this.nextCheckpoint = undefined; await pending.promise; }
    const prior = this.states.get(record.logicalMapId);
    const commits = prior?.checkpoint.incarnationId === record.incarnationId
      ? prior.commits.filter((item) => item.commit.rev > record.rev)
      : [];
    this.states.set(record.logicalMapId, { checkpoint: clone(record), commits: clone(commits) });
  }

  state(id) { return clone(this.states.get(id)); }
}

function socket_pair() {
  const clientListeners = new Set();
  const serverListeners = new Set();
  const serverSent = [];
  return {
    client: {
      send(raw) { for (const listener of [...serverListeners]) listener(raw); },
      onMessage(listener) { clientListeners.add(listener); return () => clientListeners.delete(listener); },
      onClose() { return () => {}; },
    },
    server: {
      send(raw) { serverSent.push(JSON.parse(raw)); for (const listener of [...clientListeners]) listener(raw); },
      onMessage(listener) { serverListeners.add(listener); return () => serverListeners.delete(listener); },
      onClose() { return () => {}; },
    },
    serverSent,
  };
}

await check("initial checkpoint is durable before a persistent host is returned", async () => {
  const adapter = new MemoryPersistenceAdapter();
  const checkpoint = adapter.deferCheckpoint();
  const map = element();
  let returned = false;
  const creating = create_persistent_livehost({
    map,
    authority: "exclusive",
    persistence: adapter,
    logicalMapId: "persistent-initial",
    incarnationId: "persistent-initial-incarnation",
  }).then((host) => { returned = true; return host; });
  await tick();
  assert.equal(returned, false);
  assert.throws(() => map.document.attrs.set(root, "early", true));
  checkpoint.resolve();
  const host = await creating;
  const state = adapter.state("persistent-initial");
  assert.equal(state.checkpoint.rev, 0);
  assert.equal(state.checkpoint.incarnationId, "persistent-initial-incarnation");
  assert.deepEqual(state.checkpoint.snapshot.format, "view-state");
  assert.deepEqual(state.commits, []);
  host.dispose();
});

await check("initial checkpoint failure rolls back exclusive management", async () => {
  const adapter = new MemoryPersistenceAdapter();
  adapter.failCheckpoint = new Error("unavailable");
  const map = element();
  await assert.rejects(
    create_persistent_livehost({ map, authority: "exclusive", persistence: adapter }),
    (cause) => cause instanceof LiveHostPersistenceError
      && cause.code === "LIVEHOST_PERSISTENCE_INITIAL_CHECKPOINT_FAILED",
  );
  assert.equal(map.document.attrs.set(root, "released", true).rev, 1);
});

await check("append completes before graph revision notifications history and publication", async () => {
  const adapter = new MemoryPersistenceAdapter();
  const map = element();
  const host = await create_persistent_livehost({ map, authority: "exclusive", persistence: adapter });
  const append = adapter.deferAppend();
  const observations = [];
  map.commits.observe((event) => observations.push(event.kind));
  const published = [];
  host.stream.on_commit((commit) => published.push(commit.rev));
  const mutation = host.mutate((draft) => draft.document.attrs.set(root, "count", 1));
  await tick();
  assert.equal(map.rev, 0);
  assert.equal(map.document.attrs.get(root, "count"), undefined);
  assert.equal(host.stream.headRev, 0);
  assert.deepEqual(observations, []);
  assert.deepEqual(published, []);
  append.resolve();
  assert.equal((await mutation).rev, 1);
  assert.equal(map.document.attrs.get(root, "count"), 1);
  assert.equal(host.stream.headRev, 1);
  assert.deepEqual(observations, ["commit"]);
  assert.deepEqual(published, [1]);
  assert.equal(adapter.state(host.stream.logicalMapId).commits.length, 1);
  host.dispose();
});

await check("append failure is inert and a later queued mutation succeeds", async () => {
  const adapter = new MemoryPersistenceAdapter();
  const map = element();
  const host = await create_persistent_livehost({ map, authority: "exclusive", persistence: adapter });
  adapter.failAppend = new Error("append rejected");
  await assert.rejects(
    host.mutate((draft) => draft.document.attrs.set(root, "failed", true)),
    (cause) => cause instanceof LiveHostPersistenceError && cause.code === "LIVEHOST_PERSISTENCE_APPEND_FAILED",
  );
  assert.equal(map.rev, 0);
  assert.equal(host.stream.headRev, 0);
  const commit = await host.mutate((draft) => draft.document.attrs.set(root, "accepted", true));
  assert.equal(commit.rev, 1);
  assert.equal(map.document.attrs.get(root, "failed"), undefined);
  host.dispose();
});

await check("adapter append identity is idempotent and conflicting content rejects", async () => {
  const adapter = new MemoryPersistenceAdapter();
  const map = element();
  const host = await create_persistent_livehost({ map, authority: "exclusive", persistence: adapter });
  await host.mutate((draft) => draft.document.attrs.set(root, "idempotent", 1));
  const persisted = adapter.state(host.stream.logicalMapId).commits[0];
  await adapter.appendCommit(persisted);
  assert.equal(adapter.state(host.stream.logicalMapId).commits.length, 1);
  const conflicting = clone(persisted);
  conflicting.commit.ops[0].value = 2;
  await assert.rejects(adapter.appendCommit(conflicting), /conflict/);
  host.dispose();
});

await check("no-op skips persistence while ordered changed commits remain contiguous", async () => {
  const adapter = new MemoryPersistenceAdapter();
  const map = element();
  const host = await create_persistent_livehost({ map, authority: "exclusive", persistence: adapter });
  const noop = await host.mutate((draft) => draft.document.attrs.drop(root, "absent"));
  assert.equal(noop.changed, false);
  for (const value of [1, 2, 3]) {
    await host.mutate((draft) => draft.document.attrs.set(root, "count", value));
  }
  assert.deepEqual(adapter.state(host.stream.logicalMapId).commits.map((item) => [item.commit.prevRev, item.commit.rev]), [
    [0, 1], [1, 2], [2, 3],
  ]);
  assert.equal(adapter.appendCalls.length, 3);
  host.dispose();
});

await check("checkpoint is atomic silent and orders a following mutation after replacement", async () => {
  const adapter = new MemoryPersistenceAdapter();
  const map = element();
  const host = await create_persistent_livehost({ map, authority: "exclusive", persistence: adapter });
  await host.mutate((draft) => draft.document.attrs.set(root, "count", 1));
  const replacement = adapter.deferCheckpoint();
  const checkpoint = host.checkpoint();
  let mutationCallbackRan = false;
  const later = host.mutate((draft) => {
    mutationCallbackRan = true;
    return draft.document.attrs.set(root, "count", 2);
  });
  await tick();
  assert.equal(mutationCallbackRan, false);
  assert.equal(map.rev, 1);
  replacement.resolve();
  await checkpoint;
  assert.equal((await later).rev, 2);
  const state = adapter.state(host.stream.logicalMapId);
  assert.equal(state.checkpoint.rev, 1);
  assert.deepEqual(state.commits.map((item) => item.commit.rev), [2]);
  assert.equal(map.rev, 2);
  host.dispose();
});

await check("checkpoint failure preserves the prior durable chain and host health", async () => {
  const adapter = new MemoryPersistenceAdapter();
  const map = element();
  const host = await create_persistent_livehost({ map, authority: "exclusive", persistence: adapter });
  await host.mutate((draft) => draft.document.attrs.set(root, "count", 1));
  const before = adapter.state(host.stream.logicalMapId);
  adapter.failCheckpoint = new Error("checkpoint rejected");
  await assert.rejects(host.checkpoint(), (cause) => cause instanceof LiveHostPersistenceError
    && cause.code === "LIVEHOST_PERSISTENCE_CHECKPOINT_FAILED");
  assert.deepEqual(adapter.state(host.stream.logicalMapId), before);
  assert.equal((await host.mutate((draft) => draft.document.attrs.set(root, "count", 2))).rev, 2);
  host.dispose();
});

await check("persistent store unload and checkpoint-plus-tail reload preserve exact authority", async () => {
  const adapter = new MemoryPersistenceAdapter();
  const store = create_livehost_persistent_store(adapter);
  const map = element(`<main data-_quid="0000000000001010"/>`);
  const created = await store.create("persistent-reload", { map, authority: "exclusive" });
  assert.equal(created.ok, true);
  const host = created.value;
  await host.mutate((draft) => draft.document.attrs.setMany(root, {
    count: 0,
    enabled: false,
    nullable: null,
    empty: "",
    style: { width: { value: 2, unit: "px" } },
  }));
  await host.checkpoint();
  await host.mutate((draft) => draft.document.attrs.set(root, "tail", "applied"));
  const expected = map.capture();
  const incarnation = host.stream.incarnationId;
  assert.equal(await store.unload("persistent-reload"), true);
  const loaded = await store.load("persistent-reload");
  assert.equal(loaded.ok, true);
  const restored = loaded.value;
  assert.equal(restored.stream.incarnationId, incarnation);
  assert.equal(restored.map.rev, expected.rev);
  assert.equal(canonical_hson_graph_equal(restored.map.capture().root, expected.root), true);
  assert.deepEqual(restored.stream.history.replay_after(1)?.map((commit) => commit.rev), [2]);
  assert.throws(() => restored.map.document.attrs.set(root, "direct", true));
  assert.equal((await restored.mutate((draft) => draft.document.attrs.set(root, "continued", true))).rev, 3);
  assert.equal(restored.stream.incarnationId, incarnation);
  await store.unload("persistent-reload");
});

await check("simultaneous loads coalesce and a failed coalesced load can retry", async () => {
  const adapter = new MemoryPersistenceAdapter();
  const seedStore = create_livehost_persistent_store(adapter);
  const seeded = await seedStore.create("coalesced", { map: element(), authority: "exclusive" });
  assert.equal(seeded.ok, true);
  await seedStore.unload("coalesced");

  const store = create_livehost_persistent_store(adapter);
  const wait = adapter.deferLoad();
  const first = store.load("coalesced");
  const second = store.load("coalesced");
  await tick();
  assert.equal(adapter.loadCalls.filter((id) => id === "coalesced").length, 1);
  wait.resolve();
  const [left, right] = await Promise.all([first, second]);
  assert.equal(left.ok, true);
  assert.equal(right.ok, true);
  assert.equal(left.value, right.value);
  await store.unload("coalesced");

  adapter.failLoad = new Error("load failed");
  const failedA = store.load("coalesced");
  const failedB = store.load("coalesced");
  assert.equal((await failedA).ok, false);
  assert.equal((await failedB).ok, false);
  assert.equal((await store.load("coalesced")).ok, true);
  await store.unload("coalesced");
});

await check("creation and load for one ID share one deterministic in-flight host", async () => {
  const adapter = new MemoryPersistenceAdapter();
  const store = create_livehost_persistent_store(adapter);
  const checkpoint = adapter.deferCheckpoint();
  const creating = store.create("creation-race", { map: element(), authority: "exclusive" });
  const loading = store.load("creation-race");
  await tick();
  assert.equal(adapter.loadCalls.includes("creation-race"), false);
  checkpoint.resolve();
  const [created, loaded] = await Promise.all([creating, loading]);
  assert.equal(created.ok, true);
  assert.equal(loaded.ok, true);
  assert.equal(created.value, loaded.value);
  await store.unload("creation-race");
});

await check("restored authority serves legacy HSON modern view-state and replay recovery", async () => {
  const adapter = new MemoryPersistenceAdapter();
  const store = create_livehost_persistent_store(adapter);
  const created = await store.create("recovery-after-load", { map: element(), authority: "exclusive" });
  const host = created.value;
  await host.mutate((draft) => draft.document.attrs.set(root, "one", 1));
  await host.checkpoint();
  await host.mutate((draft) => draft.document.attrs.set(root, "two", 2));
  await store.unload("recovery-after-load");
  const loaded = (await store.load("recovery-after-load")).value;

  for (const [id, capabilities] of [
    ["legacy", undefined],
    ["modern", { hson: true, viewStateVersions: [1] }],
  ]) {
    const pair = socket_pair();
    loaded.connect(pair.server);
    pair.client.send(JSON.stringify({
      type: "recover",
      id,
      logicalMapId: loaded.stream.logicalMapId,
      ...(capabilities === undefined ? {} : { snapshotCapabilities: capabilities }),
    }));
    const snapshot = pair.serverSent.find((message) => message.type === "recovery-snapshot")?.snapshot;
    if (capabilities === undefined) assert.equal(typeof snapshot.hson, "string");
    else assert.deepEqual({ format: snapshot.format, formatVersion: snapshot.formatVersion }, { format: "view-state", formatVersion: 1 });
  }

  const replayPair = socket_pair();
  loaded.connect(replayPair.server);
  replayPair.client.send(JSON.stringify({
    type: "recover",
    id: "replay",
    logicalMapId: loaded.stream.logicalMapId,
    incarnationId: loaded.stream.incarnationId,
    lastAppliedRev: 1,
    snapshotCapabilities: { hson: true, viewStateVersions: [1] },
  }));
  assert.equal(replayPair.serverSent.find((message) => message.type === "recovery-plan")?.outcome, "replay");
  assert.deepEqual(replayPair.serverSent.filter((message) => message.type === "recovery-commit").map((message) => message.commit.rev), [2]);
  await store.unload("recovery-after-load");
});

await check("exclusive actions persist through the gate and projected persistence is deferred", async () => {
  const actionAdapter = new MemoryPersistenceAdapter();
  const actionMap = element();
  const actionHost = await create_persistent_livehost({
    map: actionMap,
    authority: "exclusive",
    persistence: actionAdapter,
    actions: {
      set: (context) => { void context.mutate((draft) => draft.document.attrs.set(root, "action", true)); },
    },
  });
  const actionAppend = actionAdapter.deferAppend();
  const action = actionHost.dispatch_action({ type: "action", id: "persistent-action", name: "set" });
  await tick();
  assert.equal(actionMap.rev, 0);
  actionAppend.resolve();
  assert.equal((await action).type, "ack");
  assert.equal(actionMap.rev, 1);

  const source = hson.liveMap.fromJson({ value: 0 });
  const targetMap = hson.liveMap.fromJson({ value: 0 });
  const projectedAdapter = new MemoryPersistenceAdapter();
  await assert.rejects(
    create_persistent_livehost({ map: targetMap, authority: "exclusive", persistence: projectedAdapter }),
    (cause) => cause instanceof LiveHostPersistenceError
      && cause.code === "LIVEHOST_PERSISTENCE_MAP_KIND_UNSUPPORTED",
  );
  source.set(["value"], 1);
  assert.equal(targetMap.rev, 0);
  actionHost.dispose();
});

await check("host destruction waits for an active durable append before releasing management", async () => {
  const adapter = new MemoryPersistenceAdapter();
  const map = element();
  const host = await create_persistent_livehost({ map, authority: "exclusive", persistence: adapter });
  const append = adapter.deferAppend();
  const mutation = host.mutate((draft) => draft.document.attrs.set(root, "late", true));
  await tick();
  host.dispose();
  assert.throws(() => map.document.attrs.set(root, "bypass", true));
  append.resolve();
  assert.equal((await mutation).rev, 1);
  await tick();
  assert.equal(map.document.attrs.set(root, "released", true).rev, 2);
});

await check("shared configuration and projected maps cannot opt into persistence", async () => {
  const adapter = new MemoryPersistenceAdapter();
  assert.throws(() => hson.liveHost.create({ map: element(), persistence: adapter }));
  await assert.rejects(
    create_persistent_livehost({ map: hson.liveMap.fromJson({ value: 0 }), authority: "exclusive", persistence: adapter }),
    (cause) => cause instanceof LiveHostPersistenceError
      && cause.code === "LIVEHOST_PERSISTENCE_MAP_KIND_UNSUPPORTED",
  );
});

await check("corrupt persisted envelopes and tails reject without partial registration", async () => {
  const adapter = new MemoryPersistenceAdapter();
  const seed = create_livehost_persistent_store(adapter);
  const created = await seed.create("corruption-seed", { map: element(), authority: "exclusive" });
  await created.value.mutate((draft) => draft.document.attrs.set(root, "one", 1));
  await created.value.mutate((draft) => draft.document.attrs.set(root, "two", 2));
  const valid = adapter.state("corruption-seed");
  await seed.unload("corruption-seed");

  const corruptions = [
    (state) => { state.checkpoint.logicalMapId = "wrong"; },
    (state) => { state.checkpoint.incarnationId = ""; },
    (state) => { state.checkpoint.mapKind = "projected-data"; },
    (state) => { state.checkpoint.snapshot.format = "unknown"; },
    (state) => { state.checkpoint.snapshot.formatVersion = 2; },
    (state) => { state.checkpoint.snapshot.payload = "not valid view state"; },
    (state) => { state.checkpoint.rev = 1; },
    (state) => { state.checkpoint.mode = "fragment"; },
    (state) => { state.commits[0].commit.prevRev = 2; },
    (state) => { state.commits[1].commit.prevRev = 0; },
    (state) => { state.commits[1].commit.rev = 1; },
    (state) => { state.commits.reverse(); },
    (state) => { state.commits[0].incarnationId = "mixed"; },
    (state) => { state.commits[0].logicalMapId = "mixed"; },
    (state) => { state.commits[0].commit = { nope: true }; },
    (state) => { state.commits[0].commit.ops[0].target = { kind: "path", path: [999] }; },
    (state) => { state.commits.push(clone(state.commits[1])); },
  ];

  for (const corrupt of corruptions) {
    const state = clone(valid);
    state.checkpoint.logicalMapId = "corrupt";
    for (const item of state.commits) {
      item.logicalMapId = "corrupt";
      item.commit.logicalMapId = "corrupt";
    }
    corrupt(state);
    const corruptAdapter = new MemoryPersistenceAdapter();
    corruptAdapter.loadOverride = state;
    const store = create_livehost_persistent_store(corruptAdapter);
    const result = await store.load("corrupt");
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "LIVEHOST_PERSISTED_STATE_INVALID");
    assert.equal(store.has("corrupt"), false);
  }

  const corrected = clone(valid);
  corrected.checkpoint.logicalMapId = "corrected";
  for (const item of corrected.commits) {
    item.logicalMapId = "corrected";
    item.commit.logicalMapId = "corrected";
  }
  const correctedAdapter = new MemoryPersistenceAdapter();
  correctedAdapter.loadOverride = corrected;
  const correctedStore = create_livehost_persistent_store(correctedAdapter);
  assert.equal((await correctedStore.load("corrected")).ok, true);
  await correctedStore.unload("corrected");
});

process.stdout.write(`# ${checks} persistent LiveHost checks passed\n`);
