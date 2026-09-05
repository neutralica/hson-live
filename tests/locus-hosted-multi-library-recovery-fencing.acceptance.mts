import assert from "node:assert/strict";
import { Hson, hsonLiveMap, type HsonSchema } from "../src/index.ts";
import { create_multi_library_echo_socket_client_internal } from "../src/api/echo/echo.multi-library.socket.ts";
import { LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT } from "../src/api/locus/locus.hosted-multi-library.protocol.ts";
import { create_locus_hosted_aggregate_socket_internal } from "../src/api/locus/locus.hosted-multi-library.socket.ts";
import type { LocusHostedAggregateDataDraft, LocusHostedAggregateDraft } from "../src/api/locus/locus.hosted-multi-library.ts";
import type { LocusSocketLike } from "../src/types/locus.types.ts";
import { create_test_event_emitter } from "./test-events.mjs";

const StateSchema: HsonSchema = Hson`<type "data" content <value <number <int true min 0>>>>`;

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "locus.hosted-multi-library-recovery-fencing",
  title: "Hosted multi-library recovery fencing",
  category: "Locus",
  runtime: "node",
  tags: Object.freeze(["locus", "echo", "recovery", "session", "fencing"]),
});

const testEvents = create_test_event_emitter("locus.hosted-multi-library-recovery-fencing");
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

function socket_pair(): Readonly<{
  client: LocusSocketLike;
  server: LocusSocketLike;
  clientSent: Record<string, unknown>[];
  serverSent: Record<string, unknown>[];
  deliverToClient: (message: Record<string, unknown>) => void;
  disconnect: () => void;
}> {
  const clientMessages = new Set<(raw: string) => void>();
  const serverMessages = new Set<(raw: string) => void>();
  const clientCloses = new Set<() => void>();
  const serverCloses = new Set<() => void>();
  const clientSent: Record<string, unknown>[] = [];
  const serverSent: Record<string, unknown>[] = [];
  let closed = false;
  const disconnect = (): void => {
    if (closed) return;
    closed = true;
    for (const listener of [...clientCloses]) listener();
    for (const listener of [...serverCloses]) listener();
  };
  return Object.freeze({
    client: Object.freeze({
      send(raw: string) {
        clientSent.push(JSON.parse(raw) as Record<string, unknown>);
        for (const listener of [...serverMessages]) listener(raw);
      },
      close: disconnect,
      onMessage(listener: (raw: string) => void) { clientMessages.add(listener); return () => clientMessages.delete(listener); },
      onClose(listener: () => void) { clientCloses.add(listener); return () => clientCloses.delete(listener); },
    }),
    server: Object.freeze({
      send(raw: string) {
        serverSent.push(JSON.parse(raw) as Record<string, unknown>);
        for (const listener of [...clientMessages]) listener(raw);
      },
      close: disconnect,
      onMessage(listener: (raw: string) => void) { serverMessages.add(listener); return () => serverMessages.delete(listener); },
      onClose(listener: () => void) { serverCloses.add(listener); return () => serverCloses.delete(listener); },
    }),
    clientSent,
    serverSent,
    deliverToClient(message: Record<string, unknown>) {
      const raw = JSON.stringify(message);
      for (const listener of [...clientMessages]) listener(raw);
    },
    disconnect,
  });
}

function make_map() {
  return hsonLiveMap.fromLibraries({ state: { data: { value: 0 }, schema: StateSchema } });
}

function state(draft: LocusHostedAggregateDraft): LocusHostedAggregateDataDraft {
  const selected = draft.lib("state");
  if (!("at" in selected)) throw new Error("Expected state data library.");
  return selected;
}

function connect_endpoint(
  server: ReturnType<typeof create_locus_hosted_aggregate_socket_internal>,
  credential?: string,
) {
  const pair = socket_pair();
  server.connect(pair.server);
  const client = create_multi_library_echo_socket_client_internal({
    socket: pair.client,
    logicalMapId: server.logicalMapId,
    ...(credential === undefined ? {} : { session: { credential } }),
  });
  client.attachTransport();
  return Object.freeze({ pair, client });
}

async function attach_replacement(
  server: ReturnType<typeof create_locus_hosted_aggregate_socket_internal>,
  credential: string,
) {
  const replacement = connect_endpoint(server, credential);
  await replacement.client.session.reattach();
  return replacement;
}

function types(messages: readonly Record<string, unknown>[]): unknown[] {
  return messages.map((message) => message.type);
}

await check("replacement after the recovery cut stops plan and body delivery and permits fresh recovery", async () => {
  const entered = deferred();
  const release = deferred();
  let hold = true;
  const server = create_locus_hosted_aggregate_socket_internal({
    map: make_map(),
    internal: {
      afterRecoveryCut: async () => {
        if (!hold) return;
        hold = false;
        entered.resolve();
        await release.promise;
      },
    },
  });
  const first = connect_endpoint(server);
  const interrupted = first.client.connect();
  await entered.promise;
  const credential = first.client.session.credential;
  assert.ok(credential);
  const replacement = await attach_replacement(server, credential);
  await assert.rejects(interrupted, /fenced/i);
  release.resolve();
  assert.equal((await replacement.client.connect()).revision, 0);
  assert.equal(types(first.pair.serverSent).includes("recovery-plan"), false);
  assert.equal(types(first.pair.serverSent).includes("recovery-caught-up"), false);
  assert.equal(first.client.map, undefined);
  first.client.dispose();
  replacement.client.dispose();
  server.dispose();
});

await check("replacement immediately before caught-up prevents completion and stale body cannot advance the replica", async () => {
  const entered = deferred();
  const release = deferred();
  let hold = true;
  const server = create_locus_hosted_aggregate_socket_internal({
    map: make_map(),
    internal: {
      beforeRecoveryCaughtUp: async () => {
        if (!hold) return;
        hold = false;
        entered.resolve();
        await release.promise;
      },
    },
  });
  const first = connect_endpoint(server);
  const interrupted = first.client.connect();
  await entered.promise;
  const revisionAtFence = first.client.lastAppliedRev;
  const credential = first.client.session.credential;
  assert.ok(credential);
  const replacement = await attach_replacement(server, credential);
  await assert.rejects(interrupted, /fenced/i);
  release.resolve();
  await replacement.client.connect();
  assert.equal(types(first.pair.serverSent).includes("recovery-caught-up"), false);
  assert.equal(first.client.lastAppliedRev, revisionAtFence);
  assert.equal(first.client.diagnostics().status, "idle");
  first.client.dispose();
  replacement.client.dispose();
  server.dispose();
});

await check("replacement after caught-up suppresses queued live drain and recovery subscription sync", async () => {
  const entered = deferred();
  const release = deferred();
  let caughtUpCount = 0;
  const server = create_locus_hosted_aggregate_socket_internal({
    map: make_map(),
    internal: {
      afterRecoveryCaughtUp: async () => {
        caughtUpCount += 1;
        if (caughtUpCount !== 2) return;
        entered.resolve();
        await release.promise;
      },
    },
  });
  const first = connect_endpoint(server);
  await first.client.connect();
  first.client.subscribe("state", ["value"], () => {});
  const syncCountBefore = types(first.pair.serverSent).filter((type) => type === "sync").length;
  const caughtUp = first.client.connect();
  await entered.promise;
  await caughtUp;
  const credential = first.client.session.credential;
  assert.ok(credential);
  await server.mutate((draft) => state(draft).at(["value"]).set(1));
  assert.equal(server.rev, 1);
  const replacement = await attach_replacement(server, credential);
  release.resolve();
  assert.equal((await replacement.client.connect()).revision, 1);
  assert.equal(types(first.pair.serverSent).filter((type) => type === "commit").length, 0);
  assert.equal(types(first.pair.serverSent).filter((type) => type === "sync").length, syncCountBefore);
  assert.equal(first.client.lastAppliedRev, 0);
  first.client.dispose();
  replacement.client.dispose();
  server.dispose();
});

await check("stale recovery identity cannot settle a replacement recovery on the same client", async () => {
  const pair = socket_pair();
  const mirror = make_map();
  const client = create_multi_library_echo_socket_client_internal({ socket: pair.client, map: mirror });
  client.attachTransport();
  const created = client.session.create();
  const createRequest = pair.clientSent.findLast((message) => message.type === "session-create");
  assert.ok(createRequest);
  pair.deliverToClient({
    type: "session-created",
    format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT,
    id: createRequest.id,
    sessionId: "session-a",
    credential: "aggregate-recovery-credential",
    epoch: 1,
    logicalMapId: client.logicalMapId,
    incarnationId: client.incarnationId,
  });
  await created;
  const recoveryA = client.connect();
  const requestA = pair.clientSent.findLast((message) => message.type === "recover");
  assert.ok(requestA);
  pair.deliverToClient({
    type: "session-fenced",
    format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT,
    sessionId: "session-a",
    epoch: 1,
    code: "LOCUS_SESSION_ATTACHMENT_FENCED",
  });
  await assert.rejects(recoveryA, /fenced/i);

  const attached = client.session.reattach();
  const attachRequest = pair.clientSent.findLast((message) => message.type === "session-attach");
  assert.ok(attachRequest);
  pair.deliverToClient({
    type: "session-attached",
    format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT,
    id: attachRequest.id,
    sessionId: "session-a",
    epoch: 2,
    logicalMapId: client.logicalMapId,
    incarnationId: client.incarnationId,
  });
  await attached;
  let replacementSettled = false;
  const recoveryB = client.connect().finally(() => { replacementSettled = true; });
  const requestB = pair.clientSent.findLast((message) => message.type === "recover");
  assert.ok(requestB);
  assert.notEqual(requestA.id, requestB.id);
  pair.deliverToClient({
    type: "recovery-caught-up",
    format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT,
    id: requestA.id,
    logicalMapId: client.logicalMapId,
    incarnationId: client.incarnationId,
    registryDigest: client.registryDigest,
    throughRev: 0,
  });
  await Promise.resolve();
  assert.equal(replacementSettled, false);
  pair.deliverToClient({
    type: "recovery-plan",
    format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT,
    id: requestB.id,
    logicalMapId: client.logicalMapId,
    incarnationId: client.incarnationId,
    registryDigest: client.registryDigest,
    headRev: 0,
    outcome: "current",
  });
  pair.deliverToClient({
    type: "recovery-caught-up",
    format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT,
    id: requestB.id,
    logicalMapId: client.logicalMapId,
    incarnationId: client.incarnationId,
    registryDigest: client.registryDigest,
    throughRev: 0,
  });
  assert.equal((await recoveryB).revision, 0);
  client.dispose();
});

await check("physical disconnect settles active recovery and a fresh endpoint can recover", async () => {
  const entered = deferred();
  const release = deferred();
  let hold = true;
  const server = create_locus_hosted_aggregate_socket_internal({
    map: make_map(),
    internal: {
      afterRecoveryCut: async () => {
        if (!hold) return;
        hold = false;
        entered.resolve();
        await release.promise;
      },
    },
  });
  const first = connect_endpoint(server);
  const interrupted = first.client.connect();
  await entered.promise;
  first.pair.disconnect();
  await assert.rejects(interrupted, /disconnect/i);
  release.resolve();
  const replacement = connect_endpoint(server);
  assert.equal((await replacement.client.connect()).revision, 0);
  first.client.dispose();
  replacement.client.dispose();
  server.dispose();
});

await check("replica recovery failure leaves the attached endpoint usable for unrelated actions", async () => {
  const pair = socket_pair();
  const client = create_multi_library_echo_socket_client_internal({
    socket: pair.client,
    map: make_map(),
    logicalMapId: "replica-failure-isolation",
  });
  const connecting = client.connect();
  const create = pair.clientSent.findLast((message) => message.type === "session-create");
  assert.ok(create);
  pair.deliverToClient({
    type: "session-created",
    format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT,
    id: create.id,
    sessionId: "healthy-endpoint-session",
    credential: "healthy-endpoint-credential",
    epoch: 1,
    logicalMapId: client.logicalMapId,
    incarnationId: client.incarnationId,
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const recover = pair.clientSent.findLast((message) => message.type === "recover");
  assert.ok(recover);
  assert.ok(client.incarnationId);
  assert.ok(client.registryDigest);
  pair.deliverToClient({
    type: "recovery-plan",
    format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT,
    id: recover.id,
    logicalMapId: client.logicalMapId,
    incarnationId: client.incarnationId,
    registryDigest: "0".repeat(64),
    headRev: 0,
    outcome: "current",
  });
  await assert.rejects(connecting, /registry mismatch/i);
  assert.equal(client.diagnostics().status, "failed");
  assert.equal(client.session.status, "attached");

  const action = client.action("endpoint.probe");
  const request = pair.clientSent.findLast((message) => message.type === "action");
  assert.ok(request);
  assert.equal(typeof request.id, "string");
  assert.equal(typeof request.requestId, "string");
  assert.equal(typeof request.attemptId, "string");
  pair.deliverToClient({
    type: "ack",
    format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT,
    id: request.id,
    requestId: request.requestId,
    attemptId: request.attemptId,
    ok: true,
    seq: 0,
  });
  assert.equal((await action).type, "ack");
  assert.equal(client.diagnostics().status, "failed");
  client.dispose();
});

testEvents.terminal("pass");
process.stdout.write(`Hosted multi-library recovery fencing acceptance checks passed (${checks}).\n`);
