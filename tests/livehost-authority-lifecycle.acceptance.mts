import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
// @hson-live-external-test
import assert from "node:assert/strict";
import {
  hson,
} from "hson-live";
import {
  create_locus,
  create_persistent_locus,
  type Locus,
  type LocusSocketLike,
} from "hson-live/locus";
import { create_livehost_locus_registry } from "hson-live/livehost";
import { create_livehost_locus_registry_internal } from "../src/api/livehost/services/livehost.authority-registry.ts";
import { create_livehost_store } from "../src/api/livehost/services/livehost.store.ts";
import type { JsonValue, LiveMap } from "hson-live/types";

let checks = 0;
let sequence = Promise.resolve();

function check(name: string, run: () => void | Promise<void>): void {
  sequence = sequence.then(async () => {
    await run();
    checks += 1;
    process.stdout.write(`ok ${checks} - ${name}\n`);
  });
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (cause?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function socket_fixture(): Readonly<{
  socket: LocusSocketLike;
  message(raw: string): void;
  close(): void;
  sent: readonly string[];
}> {
  const messages = new Set<(raw: string) => void>();
  const closes = new Set<() => void>();
  const sent: string[] = [];
  return Object.freeze({
    socket: Object.freeze({
      send(raw: string) { sent.push(raw); },
      onMessage(listener: (message: string) => void) {
        messages.add(listener);
        return () => messages.delete(listener);
      },
      onClose(listener: () => void) {
        closes.add(listener);
        return () => closes.delete(listener);
      },
      close() {},
    }),
    message(raw) {
      for (const listener of [...messages]) listener(raw);
    },
    close() {
      for (const listener of [...closes]) listener();
    },
    sent,
  });
}

type TestState = Record<string, JsonValue>;
type TestHost = Locus<LiveMap<TestState>>;

function registry(
  options: Partial<Parameters<typeof create_livehost_locus_registry_internal<TestHost>>[0]> = {},
) {
  let time = 1_000;
  let creations = 0;
  const value = create_livehost_locus_registry_internal<TestHost>({
    maxLoci: 2,
    idleMs: 100,
    sweepIntervalMs: 50,
    create(key) {
      creations += 1;
      return create_locus<TestState>({ state: { key }, logicalMapId: key });
    },
    ...options,
  }, {
    now: () => time,
    schedule: () => () => {},
  });
  return {
    value,
    advance(ms: number) { time += ms; },
    creations: () => creations,
  };
}

check("new authorities expose a non-sensitive idle activity snapshot", () => {
  const host = create_locus({ state: { value: 0 } });
  assert.deepEqual(host.activity.snapshot().blockers, []);
  assert.equal(host.activity.snapshot().state, "idle");
  host.dispose();
  assert.equal(host.activity.snapshot().state, "disposed");
});

check("automatic sweep defaults to enabled and can be disabled without changing explicit eviction", async () => {
  const scheduled: number[] = [];
  const make = (automaticSweep?: boolean, sweepIntervalMs?: number) => create_livehost_locus_registry_internal<TestHost>({
    maxLoci: 1,
    idleMs: 100,
    ...(automaticSweep === undefined ? {} : { automaticSweep }),
    ...(sweepIntervalMs === undefined ? {} : { sweepIntervalMs }),
    create(key) { return create_locus<TestState>({ state: { key }, logicalMapId: key }); },
  }, {
    schedule(delayMs) {
      scheduled.push(delayMs);
      return () => {};
    },
  });
  const defaultRegistry = make();
  const enabledRegistry = make(true, 25);
  const disabledRegistry = make(false);
  assert.deepEqual(scheduled, [100, 25]);
  assert.throws(
    () => make(false, 25),
    /automaticSweep false cannot specify sweepIntervalMs/,
  );
  const acquired = await disabledRegistry.acquire("manual");
  assert.equal(acquired.ok, true);
  if (acquired.ok) acquired.value.release();
  assert.equal((await disabledRegistry.evict("manual")).status, "evicted");
  await defaultRegistry.dispose();
  await enabledRegistry.dispose();
  await disabledRegistry.dispose();
});

check("public registry automaticSweep controls only periodic eviction scheduling", async () => {
  const automatic = create_livehost_locus_registry<TestHost>({
    maxLoci: 1,
    idleMs: 10,
    automaticSweep: true,
    sweepIntervalMs: 10,
    create(key) { return create_locus<TestState>({ state: { key }, logicalMapId: key }); },
  });
  const manual = create_livehost_locus_registry<TestHost>({
    maxLoci: 1,
    idleMs: 10,
    automaticSweep: false,
    create(key) { return create_locus<TestState>({ state: { key }, logicalMapId: key }); },
  });
  const automaticLease = await automatic.acquire("automatic");
  const manualLease = await manual.acquire("manual");
  if (automaticLease.ok) automaticLease.value.release();
  if (manualLease.ok) manualLease.value.release();
  await new Promise<void>((resolve) => setTimeout(resolve, 40));
  assert.equal(automatic.has("automatic"), false);
  assert.equal(manual.has("manual"), true);
  assert.equal((await manual.evict("manual")).status, "evicted");
  await automatic.dispose();
  await manual.dispose();
});

check("basic store lookup key remains independent from a hosted logical map ID", () => {
  const store = create_livehost_store();
  const stored = store.create("runtime-lookup", {
    state: { value: 1 },
    logicalMapId: "canonical-map",
  });
  assert.equal(stored.ok, true);
  assert.equal(store.has("runtime-lookup"), true);
  assert.equal(store.get("runtime-lookup")?.stream.logicalMapId, "canonical-map");
  assert.equal(store.get("canonical-map"), undefined);
  if (stored.ok) stored.value.dispose();
});

check("transport attachment and exact listener disposal drive connection activity", () => {
  const host = create_locus({ state: {} });
  const socket = socket_fixture();
  const connection = host.connect(socket.socket);
  assert.equal(host.activity.snapshot().connectionCount, 1);
  connection();
  assert.equal(host.activity.snapshot().connectionCount, 0);
  connection();
  host.dispose();
});

check("detached resumable sessions remain activity until grace expiry", () => {
  let expiry: (() => void) | undefined;
  const host = create_locus({
    state: {},
    sessions: {
      graceMs: 100,
      credential: () => "credential-000000001",
      schedule: (_delay, callback) => {
        expiry = callback;
        return () => { expiry = undefined; };
      },
    },
  });
  const socket = socket_fixture();
  host.connect(socket.socket);
  socket.message(JSON.stringify({ type: "session-create", id: "create-1" }));
  assert.equal(host.activity.snapshot().retainedSessionCount, 1);
  socket.close();
  assert.equal(host.activity.snapshot().retainedSessionCount, 1);
  expiry?.();
  assert.equal(host.activity.snapshot().retainedSessionCount, 0);
  host.dispose();
});

check("an asynchronous action blocks quiescence through its terminal outcome", async () => {
  const gate = deferred<void>();
  const host = create_locus({
    state: {},
    actions: { slow: async () => { await gate.promise; } },
  });
  const action = host.dispatch_action({ type: "action", id: "a1", name: "slow" });
  await Promise.resolve();
  assert.equal(host.activity.snapshot().actionCount, 1);
  gate.resolve();
  await action;
  assert.equal(host.activity.snapshot().actionCount, 0);
  host.dispose();
});

check("a recovery plan blocks quiescence until completion or disposal", () => {
  const host = create_locus({ state: { value: 1 }, logicalMapId: "recovery-lifecycle" });
  const plan = host.recovery.plan({ logicalMapId: host.stream.logicalMapId });
  assert.equal(host.activity.snapshot().recoveryCount, 1);
  if (plan.outcome !== "reject") plan.dispose();
  assert.equal(host.activity.snapshot().recoveryCount, 0);
  host.dispose();
});

check("acquisition is counted, release is idempotent, and idle eviction succeeds", async () => {
  const fixture = registry();
  const acquired = await fixture.value.acquire("one");
  assert.equal(acquired.ok, true);
  assert.equal(fixture.value.diagnostics().acquisitionCount, 1);
  if (acquired.ok) {
    acquired.value.release();
    acquired.value.release();
  }
  assert.equal(fixture.value.diagnostics().acquisitionCount, 0);
  assert.equal((await fixture.value.evict("one")).status, "evicted");
  await fixture.value.dispose();
});

check("ordinary eviction leaves an acquired Locus reachable", async () => {
  const fixture = registry();
  const acquired = await fixture.value.acquire("busy");
  assert.equal(acquired.ok, true);
  const result = await fixture.value.evict("busy");
  assert.equal(result.status, "busy");
  assert.equal(fixture.value.has("busy"), true);
  if (acquired.ok) acquired.value.release();
  await fixture.value.dispose();
});

check("connection and retained-session activity block ordinary registry eviction", async () => {
  const fixture = registry();
  const acquired = await fixture.value.acquire("connected");
  assert.equal(acquired.ok, true);
  if (!acquired.ok) return;
  const socket = socket_fixture();
  acquired.value.locus.connect(socket.socket);
  acquired.value.release();
  const result = await fixture.value.evict("connected");
  assert.equal(result.status, "busy");
  if (result.status === "busy") assert.ok(result.blockers.includes("connection"));
  socket.close();
  await fixture.value.dispose();
});

check("concurrent same-key acquisition deduplicates one asynchronous creation", async () => {
  const gate = deferred<void>();
  let creations = 0;
  const fixture = registry({
    create: async (key) => {
      creations += 1;
      await gate.promise;
      return create_locus<TestState>({ state: {}, logicalMapId: key });
    },
  });
  const first = fixture.value.acquire("same");
  const second = fixture.value.acquire("same");
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(creations, 1);
  gate.resolve();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.ok && b.ok && Object.is(a.value.locus, b.value.locus), true);
  if (a.ok) a.value.release();
  if (b.ok) b.value.release();
  await fixture.value.dispose();
});

check("maxLoci one reserves capacity before a distinct concurrent creation", async () => {
  const leftStarted = deferred<void>();
  const releaseLeft = deferred<void>();
  const created: string[] = [];
  const fixture = registry({
    maxLoci: 1,
    async create(key) {
      created.push(key);
      if (key === "left") {
        leftStarted.resolve();
        await releaseLeft.promise;
      }
      return create_locus<TestState>({ state: { key }, logicalMapId: key });
    },
  });
  const left = fixture.value.acquire("left");
  await leftStarted.promise;
  const right = await fixture.value.acquire("right");
  assert.equal(right.ok, false);
  if (!right.ok) assert.equal(right.error.code, "LIVEHOST_LOCUS_CAPACITY_EXHAUSTED");
  assert.deepEqual(created, ["left"]);
  assert.deepEqual(fixture.value.diagnostics(), {
    state: "accepting",
    entryCount: 1,
    loadingCount: 1,
    activeCount: 0,
    idleCount: 0,
    disposingCount: 0,
    acquisitionCount: 0,
  });
  assert.equal(fixture.value.has("left"), true);
  assert.equal(fixture.value.has("right"), false);
  releaseLeft.resolve();
  const acquired = await left;
  if (acquired.ok) acquired.value.release();
  await fixture.value.dispose();
});

check("maxLoci two permits distinct creations to remain concurrent", async () => {
  const gates = new Map([
    ["left", deferred<void>()],
    ["right", deferred<void>()],
  ]);
  const started = new Set<string>();
  const bothStarted = deferred<void>();
  const fixture = registry({
    maxLoci: 2,
    async create(key) {
      started.add(key);
      if (started.size === 2) bothStarted.resolve();
      await gates.get(key)?.promise;
      return create_locus<TestState>({ state: { key }, logicalMapId: key });
    },
  });
  const left = fixture.value.acquire("left");
  const right = fixture.value.acquire("right");
  await bothStarted.promise;
  assert.deepEqual(new Set(started), new Set(["left", "right"]));
  assert.equal(fixture.value.diagnostics().entryCount, 2);
  assert.equal(fixture.value.diagnostics().loadingCount, 2);
  gates.get("left")?.resolve();
  gates.get("right")?.resolve();
  const [acquiredLeft, acquiredRight] = await Promise.all([left, right]);
  assert.equal(acquiredLeft.ok && acquiredRight.ok, true);
  if (acquiredLeft.ok) acquiredLeft.value.release();
  if (acquiredRight.ok) acquiredRight.value.release();
  assert.equal(fixture.value.has("left"), true);
  assert.equal(fixture.value.has("right"), true);
  await fixture.value.dispose();
});

check("failed creation removes its reservation for a later distinct key", async () => {
  const failureStarted = deferred<void>();
  const releaseFailure = deferred<void>();
  const created: string[] = [];
  const fixture = registry({
    maxLoci: 1,
    async create(key) {
      created.push(key);
      if (key === "failed") {
        failureStarted.resolve();
        await releaseFailure.promise;
        throw new Error("controlled creation failure");
      }
      return create_locus<TestState>({ state: { key }, logicalMapId: key });
    },
  });
  const failed = fixture.value.acquire("failed");
  await failureStarted.promise;
  const blocked = await fixture.value.acquire("later");
  assert.equal(blocked.ok, false);
  releaseFailure.resolve();
  assert.equal((await failed).ok, false);
  assert.equal(fixture.value.diagnostics().entryCount, 0);
  assert.equal(fixture.value.diagnostics().loadingCount, 0);
  const later = await fixture.value.acquire("later");
  assert.equal(later.ok, true);
  assert.deepEqual(created, ["failed", "later"]);
  if (later.ok) later.value.release();
  await fixture.value.dispose();
});

check("failed creation releases capacity and a later retry may succeed", async () => {
  let attempts = 0;
  const fixture = registry({
    create(key) {
      attempts += 1;
      if (attempts === 1) throw new Error("first failure");
      return create_locus<TestState>({ state: {}, logicalMapId: key });
    },
  });
  assert.equal((await fixture.value.acquire("retry")).ok, false);
  const retried = await fixture.value.acquire("retry");
  assert.equal(retried.ok, true);
  if (retried.ok) retried.value.release();
  await fixture.value.dispose();
});

check("finite capacity never selects an active Locus", async () => {
  const fixture = registry({ maxLoci: 1 });
  const active = await fixture.value.acquire("active");
  const rejected = await fixture.value.acquire("other");
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.error.code, "LIVEHOST_LOCUS_CAPACITY_EXHAUSTED");
  if (active.ok) active.value.release();
  await fixture.value.dispose();
});

check("capacity pressure deterministically removes an idle Locus", async () => {
  const fixture = registry({ maxLoci: 1 });
  const first = await fixture.value.acquire("old");
  if (first.ok) first.value.release();
  const second = await fixture.value.acquire("new");
  assert.equal(second.ok, true);
  assert.equal(fixture.value.has("old"), false);
  if (second.ok) second.value.release();
  await fixture.value.dispose();
});

check("idle sweep uses monotonic elapsed time and ignores a newly reacquired entry", async () => {
  const fixture = registry();
  const first = await fixture.value.acquire("timed");
  if (first.ok) first.value.release();
  fixture.advance(101);
  const reacquired = await fixture.value.acquire("timed");
  assert.equal(await fixture.value.sweep(), 0);
  assert.equal(fixture.value.has("timed"), true);
  if (reacquired.ok) reacquired.value.release();
  await fixture.value.dispose();
});

check("two application-owned registries isolate equal keys and disposal", async () => {
  const first = registry();
  const second = registry();
  const a = await first.value.acquire("equal");
  const b = await second.value.acquire("equal");
  assert.equal(a.ok && b.ok && !Object.is(a.value.locus, b.value.locus), true);
  if (a.ok) a.value.release();
  if (b.ok) b.value.release();
  await first.value.dispose();
  assert.equal(second.value.has("equal"), true);
  await second.value.dispose();
});

check("registry acquisition key remains independent from hosted logical map identity", async () => {
  const fixture = registry({
    create(acquisitionKey) {
      return create_locus<TestState>({
        state: { acquisitionKey },
        logicalMapId: "canonical-map",
      });
    },
  });
  const acquired = await fixture.value.acquire("resident-entry");
  assert.equal(acquired.ok, true);
  if (acquired.ok) {
    assert.equal(acquired.value.locus.stream.logicalMapId, "canonical-map");
    assert.equal(fixture.value.has("resident-entry"), true);
    assert.equal(fixture.value.has("canonical-map"), false);
    acquired.value.release();
  }
  await fixture.value.dispose();
});

check("registry disposal invalidates acquisition and disposes each Locus once", async () => {
  let disposals = 0;
  const fixture = registry({
    dispose(locus) {
      disposals += 1;
      locus.dispose();
    },
  });
  const acquired = await fixture.value.acquire("dispose");
  if (acquired.ok) acquired.value.release();
  await fixture.value.dispose();
  await fixture.value.dispose();
  assert.equal(disposals, 1);
  assert.equal((await fixture.value.acquire("dispose")).ok, false);
});

check("ephemeral recreation retains logical identity but replaces incarnation", async () => {
  const fixture = registry({ maxLoci: 1 });
  const first = await fixture.value.acquire("ephemeral");
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const incarnation = first.value.locus.stream.incarnationId;
  first.value.release();
  assert.equal((await fixture.value.evict("ephemeral")).status, "evicted");
  const second = await fixture.value.acquire("ephemeral");
  assert.equal(second.ok, true);
  if (second.ok) {
    assert.equal(second.value.locus.stream.logicalMapId, "ephemeral");
    assert.notEqual(second.value.locus.stream.incarnationId, incarnation);
    second.value.release();
  }
  await fixture.value.dispose();
});

check("persistent append and checkpoint work are reported as Locus activity", async () => {
  const appends: ReturnType<typeof deferred<void>>[] = [];
  const adapter = {
    async load() { return undefined; },
    async appendCommit() {
      const gate = deferred<void>();
      appends.push(gate);
      await gate.promise;
    },
    async replaceCheckpoint() {},
  };
  const map = hson.liveMap.fromHson(`<main @000002001/>`);
  if (map.mode !== "document") throw new Error("expected element map");
  const host = await create_persistent_locus({
    map,
        persistence: adapter,
    logicalMapId: "persistent-activity",
  });
  const mutation = host.mutate((draft) => draft.document.attrs.set({ kind: "path", path: [] }, "ready", true));
  await Promise.resolve();
  assert.equal(host.activity.snapshot().persistenceCount, 1);
  appends[0]?.resolve();
  await mutation;
  assert.equal(host.activity.snapshot().persistenceCount, 0);
  host.dispose();
});

check("activity observers stop cleanly and Locus-only lifecycle creates no DOM", () => {
  const before = Reflect.get(globalThis, "document");
  const host = create_locus({ state: {} });
  let changes = 0;
  const stop = host.activity.on_change(() => { changes += 1; });
  const socket = socket_fixture();
  const connection = host.connect(socket.socket);
  stop();
  connection();
  assert.equal(changes, 1);
  assert.equal(Reflect.get(globalThis, "document"), before);
  host.dispose();
});

await sequence;
process.stdout.write(`1..${checks}\n`);
emit_hson_live_test_completion("livehost.authority-lifecycle", checks, checks, 0);
