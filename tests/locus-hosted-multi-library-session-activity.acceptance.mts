import assert from "node:assert/strict";
import { Hson, hsonLiveMap, hsonLocus, type HsonSchema } from "../src/index.ts";
import { create_livehost_locus_registry_internal } from "../src/api/livehost/services/livehost.authority-registry.ts";
import type { LocusSocketLike } from "../src/types/locus.types.ts";
import { create_test_event_emitter } from "./test-events.mjs";

const StateSchema: HsonSchema = Hson`<type "data" content <value <number <int true min 0>>>>`;

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "locus.hosted-multi-library-session-activity",
  title: "Hosted multi-library retained session activity",
  category: "Locus",
  runtime: "node",
  tags: Object.freeze(["locus", "livemap", "session", "activity", "eviction"]),
});

const testEvents = create_test_event_emitter("locus.hosted-multi-library-session-activity");
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
  let resolve = (): void => {};
  const promise = new Promise<void>((done) => { resolve = done; });
  return Object.freeze({ promise, resolve });
}

function controlled_schedule(): Readonly<{
  schedule: (delayMs: number, callback: () => void) => () => void;
  advance: (milliseconds: number) => void;
  now: () => number;
}> {
  let time = 1_000;
  let nextId = 0;
  const tasks = new Map<number, Readonly<{ due: number; callback: () => void }>>();
  return Object.freeze({
    schedule(delayMs, callback) {
      nextId += 1;
      const id = nextId;
      tasks.set(id, Object.freeze({ due: time + delayMs, callback }));
      return () => { tasks.delete(id); };
    },
    advance(milliseconds) {
      time += milliseconds;
      while (true) {
        const next = [...tasks.entries()]
          .filter(([, task]) => task.due <= time)
          .sort((left, right) => left[1].due - right[1].due)[0];
        if (next === undefined) return;
        tasks.delete(next[0]);
        next[1].callback();
      }
    },
    now: () => time,
  });
}

function is_record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function socket_fixture(): Readonly<{
  socket: LocusSocketLike;
  message: (message: Record<string, unknown>) => void;
  close: () => void;
  sent: readonly Record<string, unknown>[];
}> {
  const messages = new Set<(raw: string) => void>();
  const closes = new Set<() => void>();
  const sent: Record<string, unknown>[] = [];
  let closed = false;
  return Object.freeze({
    socket: Object.freeze({
      send(raw: string) {
        const parsed: unknown = JSON.parse(raw);
        if (!is_record(parsed)) throw new Error("Expected an object response.");
        sent.push(parsed);
      },
      close() {},
      onMessage(listener: (raw: string) => void) { messages.add(listener); return () => messages.delete(listener); },
      onClose(listener: () => void) { closes.add(listener); return () => closes.delete(listener); },
    }),
    message(message) {
      const raw = JSON.stringify(message);
      for (const listener of [...messages]) listener(raw);
    },
    close() {
      if (closed) return;
      closed = true;
      for (const listener of [...closes]) listener();
    },
    sent,
  });
}

function make_map() {
  return hsonLiveMap.fromLibraries({ state: { data: { value: 0 }, schema: StateSchema } });
}

function created_credential(socket: ReturnType<typeof socket_fixture>): string {
  const created = socket.sent.findLast((message) => message.type === "session-created");
  if (typeof created?.credential !== "string") throw new Error(`Expected a created session credential: ${JSON.stringify(socket.sent)}`);
  return created.credential;
}

function create_session(socket: ReturnType<typeof socket_fixture>, id = "session-create"): string {
  socket.message({ type: "session-create", id });
  return created_credential(socket);
}

await check("disconnect retains one resumable session blocker until deterministic grace expiry", () => {
  const clock = controlled_schedule();
  const locus = hsonLocus.create({
    map: make_map(),
    sessions: { graceMs: 100, now: clock.now, schedule: clock.schedule, credential: () => "aggregate-credential-0001" },
  });
  const socket = socket_fixture();
  locus.connect(socket.socket);
  create_session(socket);
  assert.deepEqual(
    [locus.activity.snapshot().connectionCount, locus.activity.snapshot().retainedSessionCount],
    [1, 1],
  );
  socket.close();
  assert.deepEqual(
    [locus.activity.snapshot().connectionCount, locus.activity.snapshot().retainedSessionCount],
    [0, 1],
  );
  clock.advance(99);
  assert.equal(locus.activity.snapshot().retainedSessionCount, 1);
  clock.advance(1);
  assert.equal(locus.sessions.debug().expiredSessionCount, 1);
  assert.equal(locus.activity.snapshot().retainedSessionCount, 0);
  locus.dispose();
});

await check("repeated detach and reattach keeps exactly one logical-session blocker", () => {
  const clock = controlled_schedule();
  let credentialId = 0;
  const locus = hsonLocus.create({
    map: make_map(),
    sessions: {
      graceMs: 100,
      now: clock.now,
      schedule: clock.schedule,
      credential: () => `aggregate-credential-${String(++credentialId).padStart(4, "0")}`,
    },
  });
  const first = socket_fixture();
  locus.connect(first.socket);
  const credential = create_session(first);
  first.close();
  assert.equal(locus.activity.snapshot().retainedSessionCount, 1);

  const second = socket_fixture();
  locus.connect(second.socket);
  second.message({ type: "session-attach", id: "attach-2", credential });
  assert.equal(locus.activity.snapshot().retainedSessionCount, 1);
  second.close();
  assert.equal(locus.activity.snapshot().retainedSessionCount, 1);

  const third = socket_fixture();
  locus.connect(third.socket);
  third.message({ type: "session-attach", id: "attach-3", credential });
  assert.equal(locus.activity.snapshot().retainedSessionCount, 1);
  third.close();
  assert.equal(locus.activity.snapshot().retainedSessionCount, 1);
  clock.advance(100);
  assert.equal(locus.activity.snapshot().retainedSessionCount, 0);
  locus.dispose();
});

await check("goodbye releases retained session activity exactly once", () => {
  const clock = controlled_schedule();
  const locus = hsonLocus.create({
    map: make_map(),
    sessions: { graceMs: 100, now: clock.now, schedule: clock.schedule, credential: () => "aggregate-credential-0002" },
  });
  const snapshots: number[] = [];
  locus.activity.on_change((snapshot) => snapshots.push(snapshot.retainedSessionCount));
  const socket = socket_fixture();
  locus.connect(socket.socket);
  create_session(socket);
  socket.message({ type: "session-goodbye", id: "goodbye-1" });
  assert.equal(locus.sessions.debug().revokedSessionCount, 1);
  assert.equal(locus.activity.snapshot().retainedSessionCount, 0);
  socket.close();
  locus.dispose();
  assert.equal(locus.activity.snapshot().state, "disposed");
  assert.equal(snapshots.filter((count) => count === 1).length, 1);
});

await check("authority disposal releases a live retained session before activity becomes terminal", () => {
  const clock = controlled_schedule();
  const locus = hsonLocus.create({
    map: make_map(),
    sessions: { graceMs: 100, now: clock.now, schedule: clock.schedule, credential: () => "aggregate-credential-0005" },
  });
  const snapshots: Readonly<{ state: string; sessions: number }>[] = [];
  locus.activity.on_change((snapshot) => snapshots.push(Object.freeze({
    state: snapshot.state,
    sessions: snapshot.retainedSessionCount,
  })));
  const socket = socket_fixture();
  locus.connect(socket.socket);
  create_session(socket);
  assert.equal(locus.activity.snapshot().retainedSessionCount, 1);
  locus.dispose();
  assert.equal(locus.activity.snapshot().state, "disposed");
  assert.equal(locus.activity.snapshot().retainedSessionCount, 0);
  assert.ok(snapshots.some((snapshot) => snapshot.state === "idle" && snapshot.sessions === 0));
  socket.close();
  clock.advance(100);
  assert.equal(locus.activity.snapshot().retainedSessionCount, 0);
});

await check("retained session and admitted action own independent activity blockers", async () => {
  const clock = controlled_schedule();
  const entered = deferred();
  const release = deferred();
  const locus = hsonLocus.create({
    map: make_map(),
    sessions: { graceMs: 100, now: clock.now, schedule: clock.schedule, credential: () => "aggregate-credential-0003" },
    actions: { slow: async () => { entered.resolve(); await release.promise; } },
  });
  const socket = socket_fixture();
  locus.connect(socket.socket);
  create_session(socket);
  const action = locus.dispatchAction({ type: "action", id: "slow-1", name: "slow" });
  await entered.promise;
  socket.close();
  assert.deepEqual(
    [
      locus.activity.snapshot().connectionCount,
      locus.activity.snapshot().retainedSessionCount,
      locus.activity.snapshot().actionCount,
    ],
    [0, 1, 1],
  );
  release.resolve();
  await action;
  assert.deepEqual(
    [locus.activity.snapshot().retainedSessionCount, locus.activity.snapshot().actionCount],
    [1, 0],
  );
  clock.advance(100);
  assert.equal(locus.activity.snapshot().retainedSessionCount, 0);
  locus.dispose();
});

await check("retained aggregate session blocks registry eviction until expiry", async () => {
  const clock = controlled_schedule();
  const registry = create_livehost_locus_registry_internal({
    maxLoci: 1,
    idleMs: 100,
    create(key: string) {
      return hsonLocus.create({
        map: make_map(),
        logicalMapId: key,
        sessions: { graceMs: 100, now: clock.now, schedule: clock.schedule, credential: () => "aggregate-credential-0004" },
      });
    },
  }, {
    now: clock.now,
    schedule: () => () => {},
  });
  const acquired = await registry.acquire("aggregate-session");
  assert.equal(acquired.ok, true);
  if (!acquired.ok) throw new Error("Expected aggregate authority acquisition.");
  const socket = socket_fixture();
  acquired.value.locus.connect(socket.socket);
  create_session(socket);
  acquired.value.release();
  socket.close();
  const busy = await registry.evict("aggregate-session");
  assert.equal(busy.status, "busy");
  if (busy.status === "busy") assert.ok(busy.blockers.includes("session"));
  clock.advance(100);
  assert.equal((await registry.evict("aggregate-session")).status, "evicted");
  await registry.dispose();
});

testEvents.terminal("pass");
process.stdout.write(`Hosted multi-library retained session activity checks passed (${checks}).\n`);
