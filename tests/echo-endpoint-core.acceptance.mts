import { test_echo_transport } from "./helpers/echo-websocket-transport.mts";
import { bind_locus_websocket } from "../src/api/locus/locus.websocket.ts";
import assert from "node:assert/strict";
import { Hson, hsonLiveMap, create_echo } from "../src/index.ts";
import { hsonEcho } from "../src/api/echo/index.ts";
import { hsonLocus } from "../src/api/locus/index.ts";
import { LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT } from "../src/api/locus/locus.aggregate.protocol.ts";
import { create_echo_endpoint_internal } from "../src/api/echo/echo.endpoint.ts";
import type { LocusClientMessage, LocusWebSocketLike } from "../src/types/locus.types.ts";
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

function socket_pair(holdReplies = false): Readonly<{
  client: LocusWebSocketLike;
  server: LocusWebSocketLike;
  serverSent: readonly string[];
  flushReplies: () => void;
}> {
  const clientMessages = new Set<(raw: string) => void>();
  const serverMessages = new Set<(raw: string) => void>();
  const clientCloses = new Set<() => void>();
  const serverCloses = new Set<() => void>();
  const serverSent: string[] = [];
  const pending: string[] = [];
  return Object.freeze({
    serverSent,
    flushReplies() {
      holdReplies = false;
      for (const raw of pending.splice(0)) for (const listener of [...clientMessages]) listener(raw);
    },
    client: Object.freeze({
      send(raw: string) { for (const listener of [...serverMessages]) listener(raw); },
      close() { for (const listener of [...clientCloses]) listener(); },
      onMessage(listener: (raw: string) => void) { clientMessages.add(listener); return () => clientMessages.delete(listener); },
      onClose(listener: () => void) { clientCloses.add(listener); return () => clientCloses.delete(listener); },
    }),
    server: Object.freeze({
      send(raw: string) {
        serverSent.push(raw);
        if (holdReplies) pending.push(raw);
        else for (const listener of [...clientMessages]) listener(raw);
      },
      close() { for (const listener of [...serverCloses]) listener(); },
      onMessage(listener: (raw: string) => void) { serverMessages.add(listener); return () => serverMessages.delete(listener); },
      onClose(listener: () => void) { serverCloses.add(listener); return () => serverCloses.delete(listener); },
    }),
  });
}

async function bounded<T>(promise: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Endpoint operation did not settle.")), 1_000);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100 && !predicate(); attempt++) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(predicate(), true);
}

await check("public endpoint-only Echo accepts the actual hosted Locus reply and can act", async () => {
  const map = hsonLiveMap.fromLibraries({
    state: { data: { value: 0 }, schema: Hson.schema`<type "data" content <value "number">>` },
  });
  let actions = 0;
  const locus = hsonLocus.create({
    map,
    libraries: [{ name: "state", ownership: "shared" }],
    defaultProjection: { libraries: ["state"] },
    actions: { probe() { actions += 1; } },
  });
  const pair = socket_pair(true);
  const detach = bind_locus_websocket(locus, pair.server);
  const echo = hsonEcho.create({ transport: test_echo_transport(pair.client) });
  try {
    assert.equal(echo.session.status, "idle");
    echo.connect();
    const creating = bounded(echo.session.create());
    assert.equal(echo.session.status, "creating");
    assert.equal(echo.session.credential, undefined);
    // Inspect only: flushReplies forwards the original encoder output byte for byte.
    await waitFor(() => pair.serverSent.some((raw) => JSON.parse(raw).type === "session-created"));
    const wire = pair.serverSent.map((raw) => JSON.parse(raw)).find((reply) => reply.type === "session-created");
    assert.ok(wire);
    assert.equal(wire.format, LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT);
    pair.flushReplies();
    const session = await creating;
    assert.equal(echo.session.status, "attached");
    assert.equal(typeof wire.sessionId, "string");
    assert.ok(wire.sessionId.length > 0);
    assert.equal(typeof wire.credential, "string");
    assert.ok(wire.credential.length > 0);
    assert.deepEqual(session, {
      sessionId: wire.sessionId, epoch: 1, logicalMapId: locus.logicalMapId,
      incarnationId: locus.incarnationId, reattached: false,
    });
    assert.equal(echo.session.sessionId, wire.sessionId);
    assert.equal(echo.session.credential, wire.credential);
    assert.equal(echo.session.epoch, 1);
    assert.equal(echo.session.logicalMapId, locus.logicalMapId);
    assert.equal(echo.session.incarnationId, locus.incarnationId);
    assert.equal("map" in echo, false);
    assert.equal((await bounded(echo.action("probe"))).type, "ack");
    assert.equal(actions, 1);
  } finally {
    echo.dispose();
    assert.equal(echo.session.credential, undefined);
    detach();
    locus.dispose();
  }
});

await check("endpoint-only Echo reattaches after attachment observation is interrupted", async () => {
  const map = hsonLiveMap.fromLibraries({ state: { data: { value: 0 } } });
  const locus = hsonLocus.create({ map, libraries: [{ name: "state", ownership: "shared" }],
    defaultProjection: { libraries: ["state"] } });
  const pair = socket_pair();
  let detach = bind_locus_websocket(locus, pair.server);
  const transport = test_echo_transport(pair.client);
  const echo = hsonEcho.create({ transport });
  echo.connect();
  const initial = await echo.session.create();
  assert.equal(initial.epoch, 1);
  pair.client.close();
  await waitFor(() => echo.session.status === "detached");
  detach();
  detach = bind_locus_websocket(locus, pair.server);
  await waitFor(() => echo.session.status === "attached" && echo.session.epoch === 2);
  assert.equal(echo.session.sessionId, initial.sessionId);
  echo.dispose(); transport.dispose(); detach(); locus.dispose();
});

await check("untyped endpoint Echo construction rejects replica arguments", () => {
  const pair = socket_pair();
  const createUntyped = (options: unknown): unknown => Reflect.apply(create_echo, undefined, [options]);
  assert.throws(() => createUntyped({ transport: test_echo_transport(pair.client), map: Object.freeze({}) }), /endpoint-only/i);
  assert.throws(() => createUntyped({ transport: test_echo_transport(pair.client), now: Object.freeze({}) }), /endpoint-only/i);
  assert.throws(() => createUntyped({ transport: test_echo_transport(pair.client), recovery: {} }), /endpoint-only/i);
  assert.throws(
    () => createUntyped({ transport: test_echo_transport(pair.client), map: Object.freeze({}), recovery: { logicalMapId: "untyped-map" } }),
    /endpoint-only/i,
  );
});

await check("the endpoint core operates without a map, registry, or synchronization capability", async () => {
  const sent: LocusClientMessage[] = [];
  const attemptIds = ["attempt-a", "attempt-a", "attempt-b", "attempt-c", "attempt-d"];
  const statusIds = ["status-a", "status-a", "status-b", "status-c"];
  const sessionIds = ["session-create", "session-create", "session-attach", "session-reattach", "session-mismatch"];
  const endpoint = create_echo_endpoint_internal({
    operations: {
      submit: (message) => { sent.push(message); return new Promise(() => {}); },
    },
    attachment: { observe(listener) { listener({ kind: "available" }); return () => {}; } },
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
