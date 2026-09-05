import assert from "node:assert/strict";
import { Hson, hsonLiveMap } from "../src/index.ts";
import { create_echo_endpoint_internal } from "../src/api/echo/echo.endpoint.ts";
import { create_echo_solo_replica_capability_internal } from "../src/api/echo/echo.solo-replica.ts";
import { create_echo_aggregate_replica_capability_internal } from "../src/api/echo/echo.aggregate-replica.lifecycle.ts";
import { create_echo_with_replica_loaders_internal } from "../src/api/echo/echo.ts";
import type { EchoReplicaLoaders } from "../src/api/echo/echo.lazy.ts";
import { make_echo_document_authority } from "../src/api/echo/echo.document-authority.ts";
import type { EchoRecoveryResult, LocusClientMessage, LocusSocketLike } from "../src/types/locus.types.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "echo.replica-capability",
  title: "Echo replica capability lifecycle",
  category: "Echo",
  runtime: "node",
  tags: Object.freeze(["echo", "replica", "recovery", "management", "disposal"]),
});

const testEvents = create_test_event_emitter("echo.replica-capability");
let checks = 0;

function socketPair(): Readonly<{ client: LocusSocketLike; server: LocusSocketLike; sent: LocusClientMessage[] }> {
  const clientMessages = new Set<(raw: string) => void>();
  const serverMessages = new Set<(raw: string) => void>();
  const clientCloses = new Set<() => void>();
  const serverCloses = new Set<() => void>();
  const sent: LocusClientMessage[] = [];
  return Object.freeze({
    sent,
    client: Object.freeze({
      send(raw: string) {
        sent.push(JSON.parse(raw) as LocusClientMessage);
        for (const listener of [...serverMessages]) listener(raw);
      },
      close() { for (const listener of clientCloses) listener(); },
      onMessage(listener: (raw: string) => void) { clientMessages.add(listener); return () => clientMessages.delete(listener); },
      onClose(listener: () => void) { clientCloses.add(listener); return () => clientCloses.delete(listener); },
    }),
    server: Object.freeze({
      send(raw: string) { for (const listener of [...clientMessages]) listener(raw); },
      close() { for (const listener of serverCloses) listener(); },
      onMessage(listener: (raw: string) => void) { serverMessages.add(listener); return () => serverMessages.delete(listener); },
      onClose(listener: () => void) { serverCloses.add(listener); return () => serverCloses.delete(listener); },
    }),
  });
}

async function attachSession(
  echo: ReturnType<typeof create_echo_with_replica_loaders_internal>,
  pair: ReturnType<typeof socketPair>,
  logicalMapId: string,
): Promise<void> {
  echo.connect();
  const pending = echo.session.create();
  const request = pair.sent.find((message) => message.type === "session-create");
  if (request === undefined || request.type !== "session-create") throw new Error("Expected session-create request.");
  pair.server.send(JSON.stringify({
    type: "session-created",
    id: request.id,
    sessionId: "lazy-session",
    credential: "lazy-credential",
    epoch: 1,
    logicalMapId,
    incarnationId: "lazy-incarnation",
  }));
  await pending;
}

function fakeReplicaLoaders(calls: { count: number }): EchoReplicaLoaders {
  const create: EchoReplicaLoaders["solo"] = async () => {
    calls.count += 1;
    return (options, composition) => {
      let disposed = false;
      let status: "idle" | "caught_up" | "disposed" = "idle";
      const result: EchoRecoveryResult = Object.freeze({
        strategy: "current",
        sessionId: "lazy-session",
        logicalMapId: options.recovery.logicalMapId,
        incarnationId: "lazy-incarnation",
        headRev: composition.management.revision,
        incarnationChanged: false,
      });
      return Object.freeze({
        recovery: Object.freeze({
          get status() { return status; },
          logicalMapId: options.recovery.logicalMapId,
          incarnationId: "lazy-incarnation",
          lastAppliedRev: composition.management.revision,
          map: options.map,
          failure: undefined,
          strategy: "current" as const,
          async recover() { status = "caught_up"; return result; },
          onChange: () => () => {},
          dispose() { status = "disposed"; },
          debug: () => Object.freeze({
            status,
            strategy: "current" as const,
            logicalMapId: options.recovery.logicalMapId,
            incarnationId: "lazy-incarnation",
            lastAppliedRev: composition.management.revision,
            bodyCommitsApplied: 0,
            snapshotInstalls: 0,
            duplicateCommitsIgnored: 0,
            gapsDetected: 0,
            replayConflicts: 0,
            tailCommitsApplied: 0,
            liveCommitsApplied: 0,
            recoveryFailures: 0,
            consumerNotifications: 0,
            observerFailures: 0,
          }),
        }),
        dispose() {
          if (disposed) return;
          disposed = true;
          composition.management.release();
        },
      });
    };
  };
  return Object.freeze({ solo: create, aggregate: create });
}

async function check(name: string, run: () => void | Promise<void>): Promise<void> {
  testEvents.case_begin(name, name);
  try {
    await run();
    testEvents.case_end(name, "pass");
  } catch (error) {
    testEvents.diagnostic(name, "assertion", error instanceof Error ? error.message : "Check failed.");
    testEvents.case_end(name, "fail");
    testEvents.terminal("fail");
    throw error;
  }
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

await check("solo capability owns management across failure and releases it once terminally", async () => {
  const map = hsonLiveMap.fromJson({ value: 0 });
  const replica = create_echo_solo_replica_capability_internal(map, true);
  assert.throws(() => map.set(["value"], 1), /managed|reserved|controlled/i);
  replica.markFailed(new Error("recoverable"));
  assert.equal(replica.ready, false);
  const ready = replica.waitUntilReady();
  replica.markReady();
  await ready;
  assert.equal(replica.ready, true);
  replica.dispose();
  replica.dispose();
  replica.markReady();
  assert.equal(replica.ready, false);
  assert.doesNotThrow(() => map.set(["value"], 2));
});

await check("aggregate capability owns one complete mirror and cannot revive after disposal", async () => {
  const StateSchema = Hson`<type "data" content <value "number">>`;
  const map = hsonLiveMap.fromLibraries({ state: { data: { value: 0 }, schema: StateSchema } });
  const replica = create_echo_aggregate_replica_capability_internal(map);
  assert.throws(() => map.lib("state").at(["value"]).set(1), /managed|reserved|controlled/i);
  replica.markFailed(new Error("recoverable"));
  assert.equal(replica.ready, false);
  replica.markReady();
  assert.equal(replica.ready, true);
  replica.dispose();
  replica.dispose();
  replica.markReady();
  assert.equal(replica.ready, false);
  assert.doesNotThrow(() => map.lib("state").at(["value"]).set(2));
});

await check("replica failure does not destroy a healthy endpoint", async () => {
  const sent: LocusClientMessage[] = [];
  const endpoint = create_echo_endpoint_internal({
    transport: { send: (message) => sent.push(message) },
    sessionRequired: false,
    ids: { actionId: () => "request", actionAttemptId: () => "attempt" },
  });
  const replica = create_echo_solo_replica_capability_internal(hsonLiveMap.fromJson({ value: 0 }), true);
  endpoint.connect();
  replica.markFailed(new Error("replica unavailable"));
  assert.equal(endpoint.ready, true);
  const action = endpoint.action("increment", { by: 1 });
  endpoint.receive({ type: "ack", id: "request", requestId: "request", attemptId: "attempt", ok: true, seq: 1 });
  assert.equal((await action).type, "ack");
  assert.equal(sent.some((message) => message.type === "action"), true);
  endpoint.dispose();
  replica.dispose();
});

await check("terminal replica disposal cancels document revision observers and drains the queue", async () => {
  const map = hsonLiveMap.fromHson("<main/>");
  const replica = create_echo_solo_replica_capability_internal(map, true);
  let revision = 0;
  let dispatches = 0;
  let lowerings = 0;
  const observers = new Set<() => void>();
  const authority = make_echo_document_authority(
    async () => {
      dispatches += 1;
      return Object.freeze({ accepted: true, completionRev: 2 });
    },
    () => revision,
    (listener) => {
      observers.add(listener);
      return () => observers.delete(listener);
    },
    () => replica.ready,
    replica.onDispose,
    replica.waitUntilReady,
  );
  authority.enqueue(() => {
    lowerings += 1;
    return Object.freeze({ name: "document.attrs.clear" as const, payload: { target: { kind: "path" as const, path: [] } } });
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(dispatches, 1);
  assert.equal(authority.pendingRevisionWaits(), 1);
  assert.equal(observers.size, 1);
  replica.dispose();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(authority.pendingRevisionWaits(), 0);
  assert.equal(observers.size, 0);
  revision = 2;
  for (const observer of [...observers]) observer();
  authority.enqueue(() => {
    lowerings += 1;
    return Object.freeze({ name: "document.attrs.clear" as const, payload: { target: { kind: "path" as const, path: [] } } });
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual({ dispatches, lowerings }, { dispatches: 1, lowerings: 1 });
  authority.dispose();
});

await check("endpoint-only construction and use never calls a replica loader", async () => {
  const pair = socketPair();
  const calls = { count: 0 };
  const echo = create_echo_with_replica_loaders_internal({ socket: pair.client }, fakeReplicaLoaders(calls));
  echo.connect();
  const session = echo.session.create();
  const request = pair.sent.find((message) => message.type === "session-create");
  if (request === undefined || request.type !== "session-create") throw new Error("Expected session request.");
  pair.server.send(JSON.stringify({
    type: "session-created", id: request.id, sessionId: "endpoint-session", credential: "endpoint-credential",
    epoch: 1, logicalMapId: "endpoint-map", incarnationId: "endpoint-incarnation",
  }));
  await session;
  const action = echo.action("ping");
  const actionRequest = pair.sent.findLast((message) => message.type === "action");
  if (actionRequest === undefined || actionRequest.type !== "action") throw new Error("Expected action request.");
  pair.server.send(JSON.stringify({
    type: "ack", id: actionRequest.id, requestId: actionRequest.requestId,
    attemptId: actionRequest.attemptId, ok: true, seq: 1,
  }));
  await action;
  const status = echo.actionStatus(action.request.requestId);
  const statusRequest = pair.sent.findLast((message) => message.type === "action-status");
  if (statusRequest === undefined || statusRequest.type !== "action-status") throw new Error("Expected action-status request.");
  pair.server.send(JSON.stringify({ type: "action-status", id: statusRequest.id, requestId: statusRequest.requestId, state: "succeeded" }));
  await status;
  echo.disconnect();
  echo.dispose();
  assert.equal(calls.count, 0);
});

await check("replica management is immediate and pre-recovery disposal does not load", () => {
  const pair = socketPair();
  const calls = { count: 0 };
  const map = hsonLiveMap.fromJson({ value: 0 });
  const echo = create_echo_with_replica_loaders_internal(
    { socket: pair.client, map, recovery: { logicalMapId: "lazy-map" } },
    fakeReplicaLoaders(calls),
  );
  assert.equal(echo.map, map);
  assert.equal(echo.recovery.status, "idle");
  assert.throws(() => map.set(["value"], 1), /managed|reserved|controlled/i);
  assert.equal(calls.count, 0);
  echo.dispose();
  echo.dispose();
  assert.equal(calls.count, 0);
  assert.doesNotThrow(() => map.set(["value"], 2));
});

await check("aggregate management and recovery capability are immediate without loading", () => {
  const pair = socketPair();
  const calls = { count: 0 };
  const StateSchema = Hson`<type "data" content <value "number">>`;
  const map = hsonLiveMap.fromLibraries({ state: { data: { value: 0 }, schema: StateSchema } });
  const echo = create_echo_with_replica_loaders_internal(
    { socket: pair.client, map, recovery: { logicalMapId: "lazy-aggregate" } },
    fakeReplicaLoaders(calls),
  );
  assert.equal(echo.map, map);
  assert.equal(echo.recovery.map, map);
  assert.equal(echo.recovery.status, "idle");
  assert.equal(echo.recovery.lastAppliedRev, 0);
  assert.throws(() => map.lib("state").at(["value"]).set(1), /managed|exclusive|controlled/i);
  assert.equal(calls.count, 0);
  echo.dispose();
  assert.equal(calls.count, 0);
  assert.doesNotThrow(() => map.lib("state").at(["value"]).set(2));
});

await check("first recovery initializes one strategy and delegates ordinary recovery", async () => {
  const pair = socketPair();
  const calls = { count: 0 };
  const map = hsonLiveMap.fromJson({ value: 0 });
  const echo = create_echo_with_replica_loaders_internal(
    { socket: pair.client, map, recovery: { logicalMapId: "lazy-first" } },
    fakeReplicaLoaders(calls),
  );
  await attachSession(echo, pair, "lazy-first");
  assert.equal((await echo.recovery.recover()).strategy, "current");
  assert.equal(calls.count, 1);
  assert.throws(() => map.set(["value"], 1), /managed|reserved|controlled/i);
  echo.dispose();
  assert.doesNotThrow(() => map.set(["value"], 2));
});

await check("concurrent first recovery coalesces strategy loading and preserves in-progress rejection", async () => {
  const pair = socketPair();
  const calls = { count: 0 };
  let releaseLoad: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { releaseLoad = resolve; });
  const base = fakeReplicaLoaders(calls);
  const loaders: EchoReplicaLoaders = Object.freeze({
    solo: async () => { const create = await base.solo(); await gate; return create; },
    aggregate: base.aggregate,
  });
  const map = hsonLiveMap.fromJson({ value: 0 });
  const echo = create_echo_with_replica_loaders_internal(
    { socket: pair.client, map, recovery: { logicalMapId: "lazy-race" } },
    loaders,
  );
  await attachSession(echo, pair, "lazy-race");
  const first = echo.recovery.recover();
  const second = echo.recovery.recover();
  await assert.rejects(second, (error) => error instanceof Error && "code" in error && error.code === "LOCUS_RECOVERY_IN_PROGRESS");
  assert.equal(calls.count, 1);
  releaseLoad?.();
  assert.equal((await first).strategy, "current");
  assert.equal(calls.count, 1);
  echo.dispose();
});

await check("replica loader failure leaves the attached endpoint usable", async () => {
  const pair = socketPair();
  let calls = 0;
  const fail = async () => {
    calls += 1;
    throw new Error("deferred replica unavailable");
  };
  const map = hsonLiveMap.fromJson({ value: 0 });
  const echo = create_echo_with_replica_loaders_internal(
    { socket: pair.client, map, recovery: { logicalMapId: "lazy-failure" } },
    Object.freeze({ solo: fail, aggregate: fail }),
  );
  await attachSession(echo, pair, "lazy-failure");
  await assert.rejects(echo.recovery.recover(), /deferred replica unavailable/);
  assert.equal(calls, 1);
  assert.equal(echo.recovery.status, "failed");
  assert.throws(() => map.set(["value"], 1), /managed|reserved|controlled/i);
  const action = echo.action("ping");
  const request = pair.sent.findLast((message) => message.type === "action");
  if (request === undefined || request.type !== "action") throw new Error("Expected action request.");
  pair.server.send(JSON.stringify({ type: "ack", id: request.id, requestId: request.requestId, attemptId: request.attemptId, ok: true, seq: 1 }));
  assert.equal((await action).type, "ack");
  echo.dispose();
  assert.doesNotThrow(() => map.set(["value"], 2));
});

process.stdout.write(`1..${checks}\n`);
testEvents.terminal("pass");
