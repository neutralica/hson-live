import assert from "node:assert/strict";
import { Hson, hson, hsonLiveMap, hsonLocus } from "../../src/index.ts";
import { create_locus_hosted_aggregate_socket_internal } from "../../src/api/locus/locus.hosted-multi-library.socket.ts";
import { admit_locus_remote_action_internal } from "../../src/api/locus/locus.remote-action.internal.ts";
import { read_locus_retained_action_status_internal } from "../../src/api/locus/locus.action-status.internal.ts";
import { create_test_event_emitter } from "../test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "locus.action-status-internal",
  title: "Transport-neutral retained action status",
  category: "Locus",
  runtime: "node",
  tags: Object.freeze(["actions", "status", "authority", "transport-neutral"]),
});

const testEvents = create_test_event_emitter("locus.action-status-internal");
let checks = 0;
async function check(name, run) {
  testEvents.case_begin(name, name);
  try { await run(); testEvents.case_end(name, "pass"); }
  catch (error) { testEvents.case_end(name, "fail"); testEvents.terminal("fail"); throw error; }
  process.stdout.write(`ok ${++checks} - ${name}\n`);
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return Object.freeze({ promise, resolve });
}

function fake_clock() {
  let time = 1_000;
  let nextId = 0;
  const tasks = new Map();
  function schedule(delay, callback) {
    const id = ++nextId;
    tasks.set(id, { due: time + delay, callback });
    return () => tasks.delete(id);
  }
  function advance(ms) {
    time += ms;
    while (true) {
      const due = [...tasks.entries()]
        .filter(([, task]) => task.due <= time)
        .sort((left, right) => left[1].due - right[1].due)[0];
      if (due === undefined) return;
      tasks.delete(due[0]);
      due[1].callback();
    }
  }
  return Object.freeze({ now: () => time, schedule, advance });
}

function message(id, name, payload, clientId = "retained-client") {
  return Object.freeze({
    type: "action",
    id: `${id}-wire`,
    clientId,
    requestId: `${id}-request`,
    attemptId: `${id}-attempt`,
    name,
    ...(payload === undefined ? {} : { payload }),
  });
}

function retained(locus, request, principalId) {
  return read_locus_retained_action_status_internal(locus, {
    clientId: request.clientId,
    requestId: request.requestId,
    ...(principalId === undefined ? {} : { connection: { principalId } }),
  });
}

function aggregate_map() {
  return hsonLiveMap.fromLibraries({
    state: { data: { value: 0 }, schema: Hson.canonical`<type "data" content <value <number <int true>>>>` },
  });
}

await check("solo bound status preserves state ownership outcomes identity and observation lifetime", async () => {
  const clock = fake_clock();
  const gate = deferred();
  const entered = deferred();
  let executions = 0;
  const locus = hson.locus.create({
    state: { value: 0 },
    actionDedupe: {
      maxTerminalRecords: 2,
      maxTerminalBytes: 1_000_000,
      terminalRetentionMs: 100,
      maxExpiredTombstones: 8,
      now: clock.now,
      schedule: clock.schedule,
    },
    actions: {
      async held(_context, payload) { executions += 1; entered.resolve(); await gate.promise; return payload; },
      echo(_context, payload) { executions += 1; return payload; },
      fail() { executions += 1; throw new Error("expected retained failure"); },
    },
  });

  const sessionsBeforeUnknown = locus.sessions.debug().sessions.length;
  const activityBeforeUnknown = locus.activity.snapshot();
  const unknownBefore = locus.actionRequests.debug().unknownStatusQueryCount;
  assert.deepEqual(retained(locus, message("absent", "echo", 0), "alice"), { ok: true, state: "unknown" });
  assert.equal(locus.actionRequests.debug().unknownStatusQueryCount, unknownBefore + 1);
  assert.deepEqual(read_locus_retained_action_status_internal(locus, {
    clientId: "",
    requestId: "invalid-request",
    connection: { principalId: "alice" },
  }), { ok: true, state: "unknown" });
  assert.equal(locus.actionRequests.debug().unknownStatusQueryCount, unknownBefore + 1);
  assert.equal(locus.sessions.debug().sessions.length, sessionsBeforeUnknown);
  assert.deepEqual(locus.activity.snapshot(), activityBeforeUnknown);

  const pendingRequest = message("pending", "held", { value: 1 });
  const pendingAction = admit_locus_remote_action_internal(locus, { message: pendingRequest, connection: { principalId: "alice" } });
  await entered.promise;
  const sessionsDuringAction = locus.sessions.debug().sessions.length;
  assert.deepEqual(retained(locus, pendingRequest, "alice"), { ok: true, state: "pending" });
  assert.deepEqual(retained(locus, pendingRequest, "alice"), { ok: true, state: "pending" });
  assert.equal(locus.actionRequests.debug().pendingWaiterCount, 1);
  assert.equal(locus.sessions.debug().sessions.length, sessionsDuringAction);
  assert.equal(locus.activity.snapshot().actionCount, 1);
  assert.equal(executions, 1);
  assert.deepEqual(retained(locus, { ...pendingRequest, clientId: "other-client" }, "alice"), { ok: true, state: "unknown" });
  assert.deepEqual(retained(locus, { ...pendingRequest, requestId: "other-request" }, "alice"), { ok: true, state: "unknown" });
  assert.equal(retained(locus, pendingRequest, "bob").ok, false);

  gate.resolve();
  const completed = await pendingAction;
  assert.equal(completed.type, "ack");
  const succeeded = retained(locus, pendingRequest, "alice");
  assert.deepEqual(succeeded, {
    ok: true,
    state: "succeeded",
    outcome: {
      state: "succeeded",
      seq: completed.seq,
      completionRev: completed.completionRev,
      result: { value: 1 },
    },
  });
  assert.equal(locus.sessions.debug().sessions.length, 0);

  const failedRequest = message("failed", "fail");
  const failure = await admit_locus_remote_action_internal(locus, { message: failedRequest, connection: { principalId: "alice" } });
  assert.equal(failure.type, "error");
  assert.deepEqual(retained(locus, failedRequest, "alice"), {
    ok: true,
    state: "failed",
    outcome: {
      state: "failed",
      seq: failure.seq,
      completionRev: failure.completionRev,
      error: failure.error,
    },
  });

  const anonymousRequest = message("anonymous", "echo", "anonymous", "anonymous-client");
  await admit_locus_remote_action_internal(locus, { message: anonymousRequest });
  assert.equal(retained(locus, anonymousRequest).state, "succeeded");
  assert.equal(retained(locus, anonymousRequest, "alice").ok, false);

  // Observing the older terminal neither reorders it nor refreshes its timer.
  assert.equal(retained(locus, failedRequest, "alice").state, "failed");
  const newestRequest = message("newest", "echo", "newest");
  await admit_locus_remote_action_internal(locus, { message: newestRequest, connection: { principalId: "alice" } });
  assert.equal(retained(locus, failedRequest, "alice").state, "expired");
  clock.advance(101);
  assert.equal(retained(locus, newestRequest, "alice").state, "expired");
  assert.equal(locus.actionRequests.debug().pendingWaiterCount, 0);

  locus.dispose();
  assert.throws(() => retained(locus, newestRequest, "alice"), /authority is unavailable/i);

  const recreated = hson.locus.create({ state: { value: 0 }, actions: { echo: (_context, payload) => payload } });
  assert.equal(retained(recreated, newestRequest, "alice").state, "unknown");
  recreated.dispose();
});

await check("aggregate authority and facade share the bound retained-status semantics", async () => {
  const map = aggregate_map();
  const gate = deferred();
  const entered = deferred();
  const server = create_locus_hosted_aggregate_socket_internal({
    map,
    actions: { async echo(_context, payload) { entered.resolve(); await gate.promise; return payload; } },
  });
  const request = message("aggregate", "echo", { aggregate: true }, "aggregate-client");
  const admission = admit_locus_remote_action_internal(server, { message: request, connection: { principalId: "alice" } });
  await entered.promise;
  const sessionsDuringAction = server.sessions.debug().sessions.length;
  assert.deepEqual(retained(server, request, "alice"), { ok: true, state: "pending" });
  assert.equal(server.actionRequests.debug().pendingWaiterCount, 1);
  assert.equal(server.sessions.debug().sessions.length, sessionsDuringAction);
  gate.resolve();
  const result = await admission;
  assert.equal(result.type, "ack");
  assert.deepEqual(retained(server, request, "alice"), {
    ok: true,
    state: "succeeded",
    outcome: {
      state: "succeeded",
      seq: result.seq,
      completionRev: result.completionRev,
      result: { aggregate: true },
    },
  });
  assert.equal(retained(server, request, "bob").ok, false);
  assert.equal(server.sessions.debug().sessions.length, 0);
  server.dispose();
  assert.throws(() => retained(server, request, "alice"), /authority is unavailable/i);

  const facade = hsonLocus.create({
    map: aggregate_map(),
    actions: { echo: (_context, payload) => payload },
  });
  const facadeRequest = message("facade", "echo", "facade", "facade-client");
  await admit_locus_remote_action_internal(facade, { message: facadeRequest });
  assert.equal(retained(facade, facadeRequest).state, "succeeded");
  assert.equal(facade.sessions.debug().sessions.length, 0);
  facade.dispose();
  assert.throws(() => retained(facade, facadeRequest), /authority is unavailable/i);
});

process.stdout.write(`# ${checks} transport-neutral retained action status checks passed\n`);
testEvents.terminal("pass");
