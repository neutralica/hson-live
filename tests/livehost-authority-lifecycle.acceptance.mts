import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
// @hson-live-external-test
import assert from "node:assert/strict";
import {
  hson,
} from "hson-live";
import {
  create_livehost,
  create_livehost_authority_registry,
  create_persistent_livehost,
  type LiveHost,
  type LiveHostSocketLike,
} from "hson-live/livehost";
import type { JsonValue } from "hson-live/types";

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
  socket: LiveHostSocketLike;
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
type TestHost = LiveHost<TestState>;

function registry(
  options: Partial<Parameters<typeof create_livehost_authority_registry<TestHost>>[0]> = {},
) {
  let time = 1_000;
  let creations = 0;
  const value = create_livehost_authority_registry<TestHost>({
    maxAuthorities: 2,
    idleMs: 100,
    sweepIntervalMs: 50,
    now: () => time,
    schedule: () => () => {},
    create(key) {
      creations += 1;
      return create_livehost<TestState>({ state: { key }, logicalMapId: key });
    },
    ...options,
  });
  return {
    value,
    advance(ms: number) { time += ms; },
    creations: () => creations,
  };
}

check("new authorities expose a non-sensitive idle activity snapshot", () => {
  const host = create_livehost({ state: { value: 0 } });
  assert.deepEqual(host.activity.snapshot().blockers, []);
  assert.equal(host.activity.snapshot().state, "idle");
  host.dispose();
  assert.equal(host.activity.snapshot().state, "disposed");
});

check("transport attachment and exact listener disposal drive connection activity", () => {
  const host = create_livehost({ state: {} });
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
  const host = create_livehost({
    state: {},
    sessions: {
      graceMs: 100,
      credential: () => "credential-0000000000000001",
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
  const host = create_livehost({
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
  const host = create_livehost({ state: { value: 1 }, logicalMapId: "recovery-lifecycle" });
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

check("ordinary eviction leaves an acquired authority reachable", async () => {
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
  acquired.value.authority.connect(socket.socket);
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
      return create_livehost<TestState>({ state: {}, logicalMapId: key });
    },
  });
  const first = fixture.value.acquire("same");
  const second = fixture.value.acquire("same");
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(creations, 1);
  gate.resolve();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.ok && b.ok && Object.is(a.value.authority, b.value.authority), true);
  if (a.ok) a.value.release();
  if (b.ok) b.value.release();
  await fixture.value.dispose();
});

check("failed creation releases capacity and a later retry may succeed", async () => {
  let attempts = 0;
  const fixture = registry({
    create(key) {
      attempts += 1;
      if (attempts === 1) throw new Error("first failure");
      return create_livehost<TestState>({ state: {}, logicalMapId: key });
    },
  });
  assert.equal((await fixture.value.acquire("retry")).ok, false);
  const retried = await fixture.value.acquire("retry");
  assert.equal(retried.ok, true);
  if (retried.ok) retried.value.release();
  await fixture.value.dispose();
});

check("finite capacity never selects an active authority", async () => {
  const fixture = registry({ maxAuthorities: 1 });
  const active = await fixture.value.acquire("active");
  const rejected = await fixture.value.acquire("other");
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.error.code, "LIVEHOST_AUTHORITY_CAPACITY_EXHAUSTED");
  if (active.ok) active.value.release();
  await fixture.value.dispose();
});

check("capacity pressure deterministically removes an idle authority", async () => {
  const fixture = registry({ maxAuthorities: 1 });
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
  assert.equal(a.ok && b.ok && !Object.is(a.value.authority, b.value.authority), true);
  if (a.ok) a.value.release();
  if (b.ok) b.value.release();
  await first.value.dispose();
  assert.equal(second.value.has("equal"), true);
  await second.value.dispose();
});

check("registry disposal invalidates acquisition and disposes each authority once", async () => {
  let disposals = 0;
  const fixture = registry({
    dispose(authority) {
      disposals += 1;
      authority.dispose();
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
  const fixture = registry({ maxAuthorities: 1 });
  const first = await fixture.value.acquire("ephemeral");
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const incarnation = first.value.authority.stream.incarnationId;
  first.value.release();
  assert.equal((await fixture.value.evict("ephemeral")).status, "evicted");
  const second = await fixture.value.acquire("ephemeral");
  assert.equal(second.ok, true);
  if (second.ok) {
    assert.equal(second.value.authority.stream.logicalMapId, "ephemeral");
    assert.notEqual(second.value.authority.stream.incarnationId, incarnation);
    second.value.release();
  }
  await fixture.value.dispose();
});

check("persistent append and checkpoint work are reported as authority activity", async () => {
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
  const map = hson.liveMap.fromHson(`<main data-_quid="0000000000002001"/>`);
  if (map.mode !== "element") throw new Error("expected element map");
  const host = await create_persistent_livehost({
    map,
    authority: "exclusive",
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

check("activity observers stop cleanly and authority-only lifecycle creates no DOM", () => {
  const before = Reflect.get(globalThis, "document");
  const host = create_livehost({ state: {} });
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
