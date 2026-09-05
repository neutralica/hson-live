import assert from "node:assert/strict";
import { hsonEcho } from "../src/index.ts";
import { create_multi_library_echo_socket_client_internal } from "../src/api/echo/echo.multi-library.socket.ts";
import { LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT } from "../src/api/locus/locus.hosted-multi-library.protocol.ts";
import type { LocusSocketLike } from "../src/types/locus.types.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "locus.endpoint-session-settlement",
  title: "Locus endpoint session settlement",
  category: "Locus",
  runtime: "node",
  tags: Object.freeze(["locus", "echo", "session", "fencing", "settlement"]),
});

const testEvents = create_test_event_emitter("locus.endpoint-session-settlement");
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

function controlled_socket(): Readonly<{
  socket: LocusSocketLike;
  sent: Record<string, unknown>[];
  deliver: (message: Record<string, unknown>) => void;
}> {
  const messages = new Set<(raw: string) => void>();
  const closes = new Set<() => void>();
  const sent: Record<string, unknown>[] = [];
  return Object.freeze({
    socket: Object.freeze({
      send(raw: string) { sent.push(JSON.parse(raw) as Record<string, unknown>); },
      close() { for (const listener of [...closes]) listener(); },
      onMessage(listener: (raw: string) => void) { messages.add(listener); return () => messages.delete(listener); },
      onClose(listener: () => void) { closes.add(listener); return () => closes.delete(listener); },
    }),
    sent,
    deliver(message: Record<string, unknown>) {
      const raw = JSON.stringify(message);
      for (const listener of [...messages]) listener(raw);
    },
  });
}

function last_sent(pair: ReturnType<typeof controlled_socket>, type: string): Record<string, unknown> {
  const message = pair.sent.findLast((candidate) => candidate.type === type);
  if (message === undefined) throw new Error(`Expected a sent ${type} message.`);
  return message;
}

function aggregate_message(message: Record<string, unknown>): Record<string, unknown> {
  return { ...message, format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT };
}

await check("solo fencing rejects and clears a pending session waiter while stale completion stays inert", async () => {
  const pair = controlled_socket();
  const echo = hsonEcho.create({ socket: pair.socket, session: {} });
  echo.connect();
  const created = echo.session.create();
  const createRequest = last_sent(pair, "session-create");
  pair.deliver({
    type: "session-created",
    id: createRequest.id,
    sessionId: "solo-session",
    credential: "solo-session-credential",
    epoch: 1,
    logicalMapId: "solo-map",
    incarnationId: "solo-incarnation",
  });
  await created;

  const goodbye = echo.session.goodbye();
  const goodbyeRequest = last_sent(pair, "session-goodbye");
  pair.deliver({
    type: "session-fenced",
    sessionId: "solo-session",
    epoch: 1,
    code: "LOCUS_SESSION_ATTACHMENT_FENCED",
  });
  await assert.rejects(goodbye, (error: unknown) => error instanceof Error && /fenced/i.test(error.message));

  const replacement = echo.session.reattach();
  const replacementRequest = last_sent(pair, "session-attach");
  pair.deliver({ type: "session-ended", id: goodbyeRequest.id, sessionId: "solo-session", epoch: 1 });
  assert.equal(echo.session.status, "attaching");
  pair.deliver({ type: "session-attached", id: replacementRequest.id, sessionId: "solo-session", epoch: 2, logicalMapId: "solo-map", incarnationId: "solo-incarnation" });
  assert.equal((await replacement).epoch, 2);
  assert.equal(echo.session.status, "attached");
  echo.dispose();
});

await check("aggregate fencing rejects and clears a pending session waiter while stale completion stays inert", async () => {
  const pair = controlled_socket();
  const echo = create_multi_library_echo_socket_client_internal({ socket: pair.socket, logicalMapId: "aggregate-fence" });
  echo.attachTransport();
  const created = echo.session.create();
  const createRequest = last_sent(pair, "session-create");
  pair.deliver(aggregate_message({
    type: "session-created",
    id: createRequest.id,
    sessionId: "aggregate-session",
    credential: "aggregate-session-credential",
    epoch: 1,
    logicalMapId: "aggregate-fence",
    incarnationId: "aggregate-incarnation",
  }));
  await created;

  const goodbye = echo.session.goodbye();
  const goodbyeRequest = last_sent(pair, "session-goodbye");
  pair.deliver(aggregate_message({
    type: "session-fenced",
    sessionId: "aggregate-session",
    epoch: 1,
    code: "LOCUS_SESSION_ATTACHMENT_FENCED",
  }));
  await assert.rejects(goodbye, /fenced/i);

  const replacement = echo.session.reattach();
  const replacementRequest = last_sent(pair, "session-attach");
  pair.deliver(aggregate_message({ type: "session-ended", id: goodbyeRequest.id, sessionId: "aggregate-session", epoch: 1 }));
  assert.equal(echo.session.status, "attaching");
  pair.deliver(aggregate_message({ type: "session-attached", id: replacementRequest.id, sessionId: "aggregate-session", epoch: 2, logicalMapId: "aggregate-fence", incarnationId: "aggregate-incarnation" }));
  assert.equal((await replacement).epoch, 2);
  assert.equal(echo.session.status, "attached");
  echo.dispose();
});

await check("aggregate session disposal rejects pending work and stale responses cannot resurrect it", async () => {
  const pair = controlled_socket();
  const echo = create_multi_library_echo_socket_client_internal({ socket: pair.socket, logicalMapId: "aggregate-dispose" });
  echo.attachTransport();
  const pending = echo.session.create();
  const request = last_sent(pair, "session-create");
  echo.session.dispose();
  echo.session.dispose();
  await assert.rejects(pending, /disposed/i);
  pair.deliver(aggregate_message({
    type: "session-created",
    id: request.id,
    sessionId: "disposed-session",
    credential: "disposed-session-credential",
    epoch: 1,
    logicalMapId: "aggregate-dispose",
    incarnationId: "aggregate-incarnation",
  }));
  assert.equal(echo.session.status, "disposed");
  assert.equal(echo.session.sessionId, undefined);
  await assert.rejects(echo.session.create(), /disposed/i);
  echo.dispose();
});

await check("aggregate session ending settles goodbye, action, and status while preserving retry lineage", async () => {
  const pair = controlled_socket();
  const echo = create_multi_library_echo_socket_client_internal({ socket: pair.socket, logicalMapId: "aggregate-ended" });
  echo.attachTransport();
  const created = echo.session.create();
  const createRequest = last_sent(pair, "session-create");
  pair.deliver(aggregate_message({
    type: "session-created",
    id: createRequest.id,
    sessionId: "ending-session",
    credential: "ending-session-credential",
    epoch: 1,
    logicalMapId: "aggregate-ended",
    incarnationId: "aggregate-incarnation",
  }));
  await created;

  const action = echo.action("retained.action", { value: 1 });
  const status = echo.actionStatus(action.request.requestId);
  const goodbye = echo.session.goodbye();
  const goodbyeRequest = last_sent(pair, "session-goodbye");
  pair.deliver(aggregate_message({ type: "session-ended", id: goodbyeRequest.id, sessionId: "ending-session", epoch: 1 }));
  await goodbye;
  await assert.rejects(action, /session ended/i);
  await assert.rejects(status, /session ended/i);
  assert.equal(echo.session.status, "ended");

  const replacement = echo.session.create();
  const replacementRequest = last_sent(pair, "session-create");
  pair.deliver(aggregate_message({
    type: "session-created",
    id: replacementRequest.id,
    sessionId: "replacement-session",
    credential: "replacement-session-credential",
    epoch: 1,
    logicalMapId: "aggregate-ended",
    incarnationId: "aggregate-incarnation",
  }));
  await replacement;
  const retry = echo.retryAction(action.request);
  const retryRequest = last_sent(pair, "action");
  assert.equal(retryRequest.requestId, action.request.requestId);
  pair.deliver(aggregate_message({
    type: "ack",
    id: retryRequest.id,
    ok: true,
    seq: 1,
    requestId: action.request.requestId,
    attemptId: retryRequest.id,
    completionRev: 1,
    delivery: "cached",
  }));
  const recovered = await retry;
  assert.equal(recovered.type, "ack");
  if (recovered.type === "ack") assert.equal(recovered.delivery, "cached");
  echo.dispose();
});

testEvents.terminal("pass");
process.stdout.write(`Locus endpoint session settlement acceptance checks passed (${checks}).\n`);
