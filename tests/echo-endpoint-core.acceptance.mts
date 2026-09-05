import assert from "node:assert/strict";
import { create_echo, create_locus } from "../src/index.ts";
import { create_echo_endpoint_internal } from "../src/api/echo/echo.endpoint.ts";
import type { LocusClientMessage, LocusSocketLike } from "../src/types/locus.types.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "echo.endpoint-core",
  title: "Replica-free Echo endpoint core",
  category: "Echo",
  runtime: "node",
  tags: Object.freeze(["echo", "endpoint", "session", "action", "correlation", "fencing"]),
});

const testEvents = create_test_event_emitter("echo.endpoint-core");
let checks = 0;

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

function last<TType extends LocusClientMessage["type"]>(
  sent: readonly LocusClientMessage[], type: TType,
): Extract<LocusClientMessage, { type: TType }> {
  const message = sent.findLast((candidate) => candidate.type === type);
  if (message === undefined) throw new Error(`Expected ${type} message.`);
  return message as Extract<LocusClientMessage, { type: TType }>;
}

function socket_pair(): Readonly<{ client: LocusSocketLike; server: LocusSocketLike }> {
  const clientMessages = new Set<(raw: string) => void>();
  const serverMessages = new Set<(raw: string) => void>();
  const clientCloses = new Set<() => void>();
  const serverCloses = new Set<() => void>();
  return Object.freeze({
    client: Object.freeze({
      send(raw: string) { for (const listener of [...serverMessages]) listener(raw); },
      close() { for (const listener of [...clientCloses]) listener(); },
      onMessage(listener: (raw: string) => void) { clientMessages.add(listener); return () => clientMessages.delete(listener); },
      onClose(listener: () => void) { clientCloses.add(listener); return () => clientCloses.delete(listener); },
    }),
    server: Object.freeze({
      send(raw: string) { for (const listener of [...clientMessages]) listener(raw); },
      close() { for (const listener of [...serverCloses]) listener(); },
      onMessage(listener: (raw: string) => void) { serverMessages.add(listener); return () => serverMessages.delete(listener); },
      onClose(listener: () => void) { serverCloses.add(listener); return () => serverCloses.delete(listener); },
    }),
  });
}

await check("untyped Echo construction rejects incomplete replica capability pairs", () => {
  const pair = socket_pair();
  const createUntyped = (options: unknown): unknown => Reflect.apply(create_echo, undefined, [options]);
  assert.throws(() => createUntyped({ socket: pair.client, map: Object.freeze({}) }), /map and recovery together/i);
  assert.throws(() => createUntyped({ socket: pair.client, recovery: { logicalMapId: "untyped-map" } }), /map and recovery together/i);
});

await check("public endpoint-only Echo uses explicit session lifecycle without replica state", async () => {
  const pair = socket_pair();
  const locus = create_locus({
    state: { value: 0 },
    logicalMapId: "endpoint-only-map",
    incarnationId: "endpoint-only-incarnation",
    actions: {
      async increment(context, by: number) {
        const value = context.map.snap(["value"]);
        if (typeof value !== "number") throw new Error("Expected numeric authority state.");
        await context.mutate((draft) => draft.set(["value"], value + by));
      },
    },
  });
  locus.connect(pair.server);
  const echo = create_echo({ socket: pair.client });
  assert.equal("map" in echo, false);
  assert.equal("recovery" in echo, false);
  assert.equal("seq" in echo, false);
  assert.equal("subscribe" in echo, false);
  assert.equal("onEvent" in echo, false);
  echo.connect();
  await assert.rejects(echo.action("increment", 1));
  const established = await echo.session.create();
  assert.deepEqual(
    { logicalMapId: established.logicalMapId, incarnationId: established.incarnationId },
    { logicalMapId: locus.stream.logicalMapId, incarnationId: locus.stream.incarnationId },
  );
  const action = echo.action("increment", 2);
  const outcome = await action;
  assert.equal(outcome.type, "ack");
  assert.equal(locus.map.snap(["value"]), 2);
  const retry = await echo.retryAction(action.request);
  assert.equal(retry.type, "ack");
  const status = await echo.actionStatus(action.request.requestId);
  assert.equal(status.state, "succeeded");
  echo.disconnect();
  await assert.rejects(echo.action("increment", 1));
  echo.connect();
  assert.equal(echo.session.status, "detached");
  assert.equal(echo.session.logicalMapId, established.logicalMapId);
  assert.equal(echo.session.incarnationId, established.incarnationId);
  echo.dispose();
  locus.dispose();
});

await check("the endpoint core operates without a map, registry, or recovery capability", async () => {
  const sent: LocusClientMessage[] = [];
  const attemptIds = ["attempt-a", "attempt-a", "attempt-b", "attempt-c", "attempt-d"];
  const statusIds = ["status-a", "status-a", "status-b", "status-c"];
  const sessionIds = ["session-create", "session-create", "session-attach", "session-reattach", "session-mismatch"];
  const endpoint = create_echo_endpoint_internal({
    transport: { send: (message) => { sent.push(message); } },
    clientId: "client-one",
    sessionRequired: true,
    ids: {
      actionId: () => `request-${sent.length}`,
      actionAttemptId: () => attemptIds.shift() ?? "attempt-fallback",
      actionStatusId: () => statusIds.shift() ?? "status-fallback",
      sessionRequestId: () => sessionIds.shift() ?? "session-fallback",
    },
  });

  assert.equal(endpoint.ready, false);
  endpoint.connect();
  const creating = endpoint.session.create();
  const create = last(sent, "session-create");
  endpoint.receive({
    type: "session-created",
    id: create.id,
    sessionId: "authority-session",
    credential: "credential-one",
    epoch: 1,
    logicalMapId: "authority-map",
    incarnationId: "authority-incarnation",
  });
  assert.deepEqual(await creating, {
    sessionId: "authority-session",
    epoch: 1,
    logicalMapId: "authority-map",
    incarnationId: "authority-incarnation",
    reattached: false,
  });
  assert.equal(endpoint.ready, true);

  const first = endpoint.action("increment", { by: 1 });
  const duplicate = endpoint.action("increment", { by: 2 });
  await assert.rejects(duplicate, /already pending|duplicate/i);
  const firstWire = last(sent, "action");
  assert.equal(firstWire.attemptId, "attempt-a");
  endpoint.receive({ type: "ack", id: firstWire.id, requestId: first.request.requestId, attemptId: "attempt-a", ok: true, seq: 1 });
  assert.equal((await first).type, "ack");

  const newer = endpoint.action("increment", { by: 3 });
  let newerSettled = false;
  void newer.then(() => { newerSettled = true; }, () => { newerSettled = true; });
  endpoint.receive({ type: "ack", id: firstWire.id, requestId: first.request.requestId, attemptId: "attempt-a", ok: true, seq: 2 });
  await Promise.resolve();
  assert.equal(newerSettled, false);
  const newerWire = last(sent, "action");
  endpoint.receive({ type: "ack", id: newerWire.id, requestId: newer.request.requestId, attemptId: "attempt-b", ok: true, seq: 3 });
  await newer;

  const status = endpoint.actionStatus(first.request.requestId);
  const duplicateStatus = endpoint.actionStatus(first.request.requestId);
  await assert.rejects(duplicateStatus, /already in use/i);
  endpoint.receive({ type: "action-status", id: "status-a", requestId: first.request.requestId, state: "succeeded" });
  assert.deepEqual(await status, { requestId: first.request.requestId, state: "succeeded" });

  const newerStatus = endpoint.actionStatus(newer.request.requestId);
  let statusSettled = false;
  void newerStatus.then(() => { statusSettled = true; }, () => { statusSettled = true; });
  endpoint.receive({ type: "action-status", id: "status-a", requestId: first.request.requestId, state: "expired" });
  await Promise.resolve();
  assert.equal(statusSettled, false);
  endpoint.receive({ type: "action-status", id: "status-b", requestId: newer.request.requestId, state: "pending" });
  assert.equal((await newerStatus).state, "pending");

  const fencedAction = endpoint.action("increment", { by: 4 });
  endpoint.receive({
    type: "session-fenced",
    sessionId: "authority-session",
    epoch: 1,
    code: "LOCUS_SESSION_ATTACHMENT_FENCED",
  });
  await assert.rejects(fencedAction);
  assert.equal(endpoint.session.status, "detached");
  endpoint.receive({ type: "ack", id: fencedAction.request.requestId, requestId: fencedAction.request.requestId, attemptId: "attempt-c", ok: true, seq: 4 });

  await assert.rejects(endpoint.session.reattach(), /correlation ID is already in use/i);
  endpoint.receive({ type: "session-attached", id: "session-create", sessionId: "authority-session", epoch: 2, logicalMapId: "authority-map", incarnationId: "authority-incarnation" });
  assert.equal(endpoint.session.status, "detached");
  const attaching = endpoint.session.reattach();
  const attach = last(sent, "session-attach");
  endpoint.receive({ type: "session-attached", id: attach.id, sessionId: "authority-session", epoch: 2, logicalMapId: "authority-map", incarnationId: "authority-incarnation" });
  await attaching;
  const uncertain = endpoint.action("increment", { by: 5 });
  endpoint.disconnect();
  await assert.rejects(uncertain);
  const stableRequest = uncertain.request;

  endpoint.connect();
  const reattaching = endpoint.session.reattach();
  const secondAttach = last(sent, "session-attach");
  endpoint.receive({ type: "session-attached", id: secondAttach.id, sessionId: "authority-session", epoch: 3, logicalMapId: "authority-map", incarnationId: "authority-incarnation" });
  await reattaching;
  const retry = endpoint.retryAction(stableRequest);
  assert.equal(retry.request.requestId, stableRequest.requestId);
  const retryWire = last(sent, "action");
  assert.equal(retryWire.retry, true);
  endpoint.receive({ type: "ack", id: retryWire.id, requestId: stableRequest.requestId, attemptId: retryWire.attemptId, ok: true, seq: 5 });
  await retry;

  endpoint.disconnect();
  endpoint.connect();
  const mismatched = endpoint.session.reattach();
  const mismatchRequest = last(sent, "session-attach");
  endpoint.receive({
    type: "session-attached",
    id: mismatchRequest.id,
    sessionId: "authority-session",
    epoch: 4,
    logicalMapId: "different-authority",
    incarnationId: "authority-incarnation",
  });
  await assert.rejects(mismatched, /authority identity/i);
  assert.equal(endpoint.session.status, "failed");
  assert.equal(endpoint.session.logicalMapId, "authority-map");
  assert.equal(endpoint.session.incarnationId, "authority-incarnation");

  const disposedAction = endpoint.action("increment", { by: 6 });
  const disposedStatus = endpoint.actionStatus(stableRequest.requestId);
  endpoint.dispose();
  await assert.rejects(disposedAction);
  await assert.rejects(disposedStatus);
  assert.equal(endpoint.session.status, "disposed");
  await assert.rejects(endpoint.waitUntilReady());
});

process.stdout.write(`1..${checks}\n`);
testEvents.terminal("pass");
