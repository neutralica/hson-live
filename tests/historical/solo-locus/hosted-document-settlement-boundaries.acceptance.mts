// @hson-live-external-test
import assert from "node:assert/strict";
import { hson } from "../src/index.ts";
import { echo_document_authority_for } from "../src/api/echo/echo.document-authority.ts";
import {
  DOCUMENT_REFLECT_STRUCTURAL_UPDATE_FAILED_ERROR_CODE,
} from "../src/api/reflect/mirror.document.error.ts";
import { create_livetree } from "../src/api/livetree/creation/create-livetree.ts";
import type { LocusSocketLike } from "../src/types/locus.types.ts";
import type { DocumentLiveMap } from "../src/types/livemap.types.ts";
import { mount, path, raw_node } from "./helpers/reflect-unit6.mts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "echo.hosted-document-settlement-boundaries",
  title: "Hosted document settlement boundaries",
  category: "Echo",
  runtime: "node-synthetic-dom",
  tags: Object.freeze(["echo", "reflect", "document", "authoring", "settlement", "failure", "externally-discoverable"]),
});

const testEvents = create_test_event_emitter("echo.hosted-document-settlement-boundaries");
let checks = 0;

async function check(name: string, run: () => Promise<void>): Promise<void> {
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

function document(source: string): DocumentLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "document") throw new Error("Expected a document LiveMap.");
  return map;
}

type ServerMessage = Readonly<{
  type?: string;
  completionRev?: number;
  commit?: Readonly<{
    logicalMapId?: string;
    incarnationId?: string;
    rev?: number;
  }>;
}>;

function controlled_socket_pair(): Readonly<{
  client: LocusSocketLike;
  server: LocusSocketLike;
  heldCommits: readonly string[];
  delivered: readonly ServerMessage[];
  clientSent: readonly Readonly<{ type?: string; name?: string }>[];
  holdCommits: () => void;
  releaseNextCommit: () => ServerMessage;
  nextDelivered: (predicate: (message: ServerMessage) => boolean) => Promise<ServerMessage>;
}> {
  const clientMessages = new Set<(raw: string) => void>();
  const serverMessages = new Set<(raw: string) => void>();
  const heldCommits: string[] = [];
  const delivered: ServerMessage[] = [];
  const clientSent: Readonly<{ type?: string; name?: string }>[] = [];
  const deliveryWaiters = new Set<Readonly<{
    predicate: (message: ServerMessage) => boolean;
    resolve: (message: ServerMessage) => void;
  }>>();
  let commitsHeld = false;

  const deliver = (raw: string): ServerMessage => {
    const message = JSON.parse(raw) as ServerMessage;
    delivered.push(message);
    for (const waiter of [...deliveryWaiters]) {
      if (!waiter.predicate(message)) continue;
      deliveryWaiters.delete(waiter);
      waiter.resolve(message);
    }
    for (const listener of [...clientMessages]) listener(raw);
    return message;
  };

  return Object.freeze({
    client: Object.freeze({
      send(raw: string) {
        clientSent.push(JSON.parse(raw) as Readonly<{ type?: string; name?: string }>);
        for (const listener of [...serverMessages]) listener(raw);
      },
      close() {},
      onMessage(listener: (raw: string) => void) { clientMessages.add(listener); return () => clientMessages.delete(listener); },
      onClose() { return () => {}; },
    }),
    server: Object.freeze({
      send(raw: string) {
        const message = JSON.parse(raw) as ServerMessage;
        if (commitsHeld && message.type === "commit") {
          heldCommits.push(raw);
          return;
        }
        deliver(raw);
      },
      close() {},
      onMessage(listener: (raw: string) => void) { serverMessages.add(listener); return () => serverMessages.delete(listener); },
      onClose() { return () => {}; },
    }),
    heldCommits,
    delivered,
    clientSent,
    holdCommits() { commitsHeld = true; },
    releaseNextCommit() {
      const raw = heldCommits.shift();
      if (raw === undefined) throw new Error("Expected one held canonical commit.");
      return deliver(raw);
    },
    nextDelivered(predicate) {
      const existing = delivered.findLast(predicate);
      if (existing !== undefined) return Promise.resolve(existing);
      return new Promise((resolve) => deliveryWaiters.add(Object.freeze({ predicate, resolve })));
    },
  });
}

async function wait_for_revision_wait(
  authority: Readonly<{ pendingRevisionWaits: () => number }>,
  count: number,
): Promise<void> {
  for (let turn = 0; turn < 20 && authority.pendingRevisionWaits() !== count; turn += 1) {
    await Promise.resolve();
  }
  assert.equal(authority.pendingRevisionWaits(), count);
}

function deferred(): Readonly<{ promise: Promise<void>; resolve: () => void }> {
  let resolve = (): void => {};
  const promise = new Promise<void>((done) => { resolve = done; });
  return Object.freeze({ promise, resolve });
}

await check("authority ack, Echo convergence, Reflect failure, and queue progression remain distinct", async () => {
  const authoritative = document(`<main/>`);
  const host = hson.locus.create({ map: authoritative, logicalMapId: "settlement-boundaries", sessions: {} });
  const replica = document(`<main/>`);
  const pair = controlled_socket_pair();
  host.connect(pair.server);
  const echo = hson.echo.create({
    socket: pair.client,
    map: replica,
    session: {},
    recovery: { logicalMapId: host.stream.logicalMapId },
  });
  echo.connect();
  await echo.session.create();
  await echo.recovery.recover();

  assert.equal(echo.recovery.logicalMapId, host.stream.logicalMapId);
  assert.equal(echo.recovery.incarnationId, host.stream.incarnationId);
  assert.equal(authoritative.rev, 0);
  assert.equal(replica.rev, 0);

  const binding = hson.reflect(replica);
  const projectedMain = raw_node(binding.tree.node, []);
  const projectedTree = create_livetree(projectedMain).adoptRoots(binding.tree.hostRootNode());
  const dom = mount(binding.tree.node);
  dom.failReplace = true;
  const authority = echo_document_authority_for(replica);
  assert.notEqual(authority, undefined);
  if (authority === undefined) throw new Error("Expected hosted document authority.");

  pair.holdCommits();
  const firstAckPending = pair.nextDelivered((message) => message.type === "ack" && message.completionRev === 1);
  const firstResult = projectedTree.async.text.set("first");
  assert.equal(firstResult instanceof Promise, true);

  const secondLowered = deferred();
  let secondLowerings = 0;
  let queueProgressionState: unknown;
  authority.enqueue(() => {
    secondLowerings += 1;
    assert.deepEqual(replica.at([]).snap(), authoritative.at([]).snap());
    queueProgressionState = {
      echoRevision: replica.rev,
      reflectStatus: binding.status,
      reflectSourceRevision: binding.sourceRevision,
      projectedContentCount: projectedMain.$_content.length,
      domChildCount: dom.childNodes.length,
    };
    secondLowered.resolve();
    return Object.freeze({
      name: "document.attrs.set" as const,
      payload: { target: path(), name: "phase", value: "second" },
    });
  });

  const firstAck = await firstAckPending;
  await wait_for_revision_wait(authority, 1);
  const firstHeld = JSON.parse(pair.heldCommits[0] ?? "null") as ServerMessage;
  assert.deepEqual({
    authoritativeRevision: authoritative.rev,
    actionResultType: firstAck.type,
    completionRev: firstAck.completionRev,
    echoRevision: replica.rev,
    pendingRevisionWaits: authority.pendingRevisionWaits(),
    outboundActions: pair.clientSent.filter((message) => message.type === "action").length,
    secondLowerings,
  }, {
    authoritativeRevision: 1,
    actionResultType: "ack",
    completionRev: 1,
    echoRevision: 0,
    pendingRevisionWaits: 1,
    outboundActions: 1,
    secondLowerings: 0,
  });
  assert.equal(firstHeld.type, "commit");
  assert.equal(firstHeld.commit?.logicalMapId, host.stream.logicalMapId);
  assert.equal(firstHeld.commit?.incarnationId, host.stream.incarnationId);
  assert.equal(firstHeld.commit?.rev, firstAck.completionRev);
  assert.equal(binding.status, "active");
  assert.equal(binding.sourceRevision, 0);
  assert.equal(dom.childNodes.length, 0);
  assert.equal(projectedTree.text.get(), "");

  const deliveredFirstCommit = pair.releaseNextCommit();
  assert.equal(deliveredFirstCommit.commit?.rev, 1);
  await secondLowered.promise;
  assert.equal(await firstResult, projectedTree.async);
  assert.equal(replica.rev, 1);
  assert.equal(echo.recovery.lastAppliedRev, 1);
  assert.deepEqual(replica.at([]).snap(), document(`<main "first"/>`).at([]).snap());
  assert.equal(binding.status, "failed");
  assert.equal(binding.failure?.code, DOCUMENT_REFLECT_STRUCTURAL_UPDATE_FAILED_ERROR_CODE);
  assert.equal(binding.sourceRevision, 0);
  assert.equal(projectedMain.$_content.length, 1);
  assert.equal(projectedTree.text.get(), "first");
  assert.equal(dom.childNodes.length, 0);
  assert.deepEqual(queueProgressionState, {
    echoRevision: 1,
    reflectStatus: "failed",
    reflectSourceRevision: 0,
    projectedContentCount: 1,
    domChildCount: 0,
  });
  assert.equal(secondLowerings, 1);

  const secondAck = await pair.nextDelivered((message) => message.type === "ack" && message.completionRev === 2);
  await wait_for_revision_wait(authority, 1);
  assert.equal(authoritative.rev, 2);
  assert.equal(secondAck.completionRev, 2);
  assert.equal(replica.rev, 1);
  assert.equal(binding.status, "failed");
  assert.equal(binding.sourceRevision, 0);
  assert.equal(pair.heldCommits.length, 1);

  binding.dispose();
  echo.dispose();
});

testEvents.terminal("pass");
