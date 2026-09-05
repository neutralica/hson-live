import assert from "node:assert/strict";
import {
  Hson,
  hsonEcho,
  hsonLiveMap,
  hsonLocus,
  type HsonSchema,
} from "../src/index.ts";
import type { LocusSocketLike } from "../src/types/locus.types.ts";
import { install_fake_document } from "./helpers/fake-document.mts";
import { create_test_event_emitter } from "./test-events.mjs";

const StateSchema: HsonSchema = Hson`<type "data" content <value <number <int true min 0>>>>`;
const OtherSchema: HsonSchema = Hson`<type "data" content <value <number <int true min 0>>>>`;
const PageSchema: HsonSchema = Hson`<type "document" tag "main" content "empty">`;

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "locus.hosted-multi-library-action-pipeline",
  title: "Hosted multi-library action pipeline",
  category: "Locus",
  runtime: "node",
  tags: Object.freeze(["locus", "echo", "livemap", "libraries", "actions"]),
});

const testEvents = create_test_event_emitter("locus.hosted-multi-library-action-pipeline");
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

function make_map() {
  return hsonLiveMap.fromLibraries({
    state: { data: { value: 0 }, schema: StateSchema },
    other: { data: { value: 0 }, schema: OtherSchema },
    page: { document: "<main/>", schema: PageSchema },
  });
}

function wait_for_revision(map: ReturnType<typeof make_map>, revision: number): Promise<void> {
  if (map.rev >= revision) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = map.commits.observe(() => {
      if (map.rev < revision) return;
      stop();
      resolve();
    });
  });
}

function socket_pair(): Readonly<{
  client: LocusSocketLike;
  server: LocusSocketLike;
  received: readonly Readonly<{ type?: string; requestId?: string }>[];
  dropNextActionResult: () => void;
  disconnect: () => void;
}> {
  const clientMessages = new Set<(raw: string) => void>();
  const serverMessages = new Set<(raw: string) => void>();
  const clientCloses = new Set<() => void>();
  const serverCloses = new Set<() => void>();
  let dropActionResult = false;
  let closed = false;
  const received: Readonly<{ type?: string; requestId?: string }>[] = [];
  const disconnect = (): void => {
    if (closed) return;
    closed = true;
    for (const listener of [...clientCloses]) listener();
    for (const listener of [...serverCloses]) listener();
  };
  const client = Object.freeze({
    send(raw: string) { for (const listener of [...serverMessages]) listener(raw); },
    close: disconnect,
    onMessage(listener: (raw: string) => void) { clientMessages.add(listener); return () => clientMessages.delete(listener); },
    onClose(listener: () => void) { clientCloses.add(listener); return () => clientCloses.delete(listener); },
  });
  const server = Object.freeze({
    send(raw: string) {
      const message = JSON.parse(raw) as { type?: string; requestId?: string };
      if (dropActionResult && (message.type === "ack" || message.type === "error") && message.requestId !== undefined) {
        dropActionResult = false;
        return;
      }
      received.push(message);
      for (const listener of [...clientMessages]) listener(raw);
    },
    close: disconnect,
    onMessage(listener: (raw: string) => void) { serverMessages.add(listener); return () => serverMessages.delete(listener); },
    onClose(listener: () => void) { serverCloses.add(listener); return () => serverCloses.delete(listener); },
  });
  return Object.freeze({ client, server, received, dropNextActionResult: () => { dropActionResult = true; }, disconnect });
}

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => { resolve = done; });
  return Object.freeze({ promise, resolve });
}

install_fake_document();

await check("named document denial is terminal without mutation and the next queued request proceeds", async () => {
  const authority = make_map();
  const decisions: unknown[] = [];
  const locus = hsonLocus.create({
    map: authority,
    authorizeAction(context) {
      decisions.push(context);
      const payload = context.payload as { name?: string } | undefined;
      return payload?.name !== "blocked";
    },
  });
  const pair = socket_pair();
  locus.connect(pair.server, { principalId: "principal-a", attachment: { transport: "test" } });
  const echoMap = make_map();
  const echo = hsonEcho.create({ socket: pair.client, map: echoMap, recovery: { logicalMapId: locus.logicalMapId } });
  await echo.connect();
  const denied = await echo.action("document.attrs.set", {
    library: "page",
    target: { kind: "path", path: [0] },
    name: "blocked",
    value: "no",
  });
  assert.equal(denied.type, "error");
  if (denied.type === "error") assert.equal(denied.delivery, "rejected");
  assert.equal(authority.rev, 0);
  assert.equal(echoMap.rev, 0);
  assert.equal(authority.lib("page").document.attrs.get({ kind: "path", path: [0] }, "blocked"), undefined);
  const accepted = await echo.action("document.attrs.set", {
    library: "page",
    target: { kind: "path", path: [0] },
    name: "title",
    value: "accepted",
  });
  assert.equal(accepted.type, "ack");
  assert.equal(authority.rev, 1);
  assert.equal(echoMap.rev, 1);
  assert.equal(echoMap.lib("page").document.attrs.get({ kind: "path", path: [0] }, "title"), "accepted");
  const evidence = decisions[0] as { session: { resumable: boolean }; logicalMapId: string; incarnationId: string; connection: { principalId?: string }; payload: { library?: string } };
  assert.equal(evidence.logicalMapId, locus.logicalMapId);
  assert.equal(evidence.connection.principalId, "principal-a");
  assert.equal(evidence.payload.library, "page");
  echo.dispose();
  locus.dispose();
});

await check("application payload decoding precedes authorization and mutation", async () => {
  const authority = make_map();
  let authorizations = 0;
  const locus = hsonLocus.create({
    map: authority,
    actions: {
      validated: async (context, payload: { value: number }) => {
        await context.mutate((draft) => draft.lib("state").at(["value"]).set(payload.value));
      },
    },
    schema: {
      actions: {
        validated: {
          payload: (value: unknown): value is { value: number } => typeof value === "object" && value !== null && "value" in value && typeof value.value === "number",
        },
      },
    },
    authorizeAction() { authorizations += 1; return true; },
  });
  const pair = socket_pair();
  locus.connect(pair.server);
  const echo = hsonEcho.create({ socket: pair.client, map: make_map(), recovery: { logicalMapId: locus.logicalMapId } });
  await echo.connect();
  const invalid = await echo.action("validated", { value: "wrong" } as never);
  assert.equal(invalid.type, "error");
  if (invalid.type === "error") assert.equal(invalid.error.code, "LOCUS_SCHEMA_INVALID_PAYLOAD");
  assert.equal(authorizations, 0);
  assert.equal(authority.rev, 0);
  const accepted = await echo.action("validated", { value: 3 });
  assert.equal(accepted.type, "ack");
  assert.equal(authorizations, 1);
  assert.equal(authority.lib("state").snap(["value"]), 3);
  echo.dispose();
  locus.dispose();
});

await check("resumable session reattachment retains one complete aggregate authority domain", async () => {
  const authority = make_map();
  let sessionNumber = 0;
  const locus = hsonLocus.create({
    map: authority,
    sessionId: () => `aggregate-session-${++sessionNumber}`,
    sessions: { graceMs: 10_000, credential: () => "aggregate-session-credential-0001" },
    actions: {
      "state.set": async (context, payload: { value: number }) => {
        await context.mutate((draft) => draft.lib("state").at(["value"]).set(payload.value));
      },
    },
  });
  const firstPair = socket_pair();
  locus.connect(firstPair.server, { principalId: "principal-a" });
  const first = hsonEcho.create({ socket: firstPair.client, map: make_map(), recovery: { logicalMapId: locus.logicalMapId }, clientId: "stable-aggregate-client" });
  await first.connect();
  const credential = first.session.credential;
  const sessionId = first.session.sessionId;
  assert.ok(credential);
  await first.action("state.set", { value: 1 });
  firstPair.disconnect();
  first.dispose();

  const secondPair = socket_pair();
  locus.connect(secondPair.server, { principalId: "principal-a" });
  const second = hsonEcho.create({
    socket: secondPair.client,
    map: make_map(),
    recovery: { logicalMapId: locus.logicalMapId },
    clientId: "stable-aggregate-client",
    session: { credential },
  });
  await second.connect();
  assert.equal(second.session.sessionId, sessionId);
  assert.equal(second.session.epoch, 2);
  assert.equal(second.session.debug().reattachCount, 1);
  await second.action("state.set", { value: 2 });
  assert.equal(authority.lib("state").snap(["value"]), 2);
  assert.equal(authority.rev, 2);
  second.dispose();
  locus.dispose();
});

await check("retry, dedupe conflict, and action status match the one-map request contract", async () => {
  const authority = make_map();
  let executions = 0;
  const locus = hsonLocus.create({
    map: authority,
    sessions: { graceMs: 10_000, credential: () => "aggregate-dedupe-credential-01" },
    actions: {
      "state.set": async (context, payload: { value: number }) => {
        executions += 1;
        await context.mutate((draft) => draft.lib("state").at(["value"]).set(payload.value));
      },
    },
  });
  const firstPair = socket_pair();
  locus.connect(firstPair.server);
  const first = hsonEcho.create({ socket: firstPair.client, map: make_map(), recovery: { logicalMapId: locus.logicalMapId }, clientId: "dedupe-client" });
  await first.connect();
  const credential = first.session.credential;
  firstPair.dropNextActionResult();
  const pending = first.action("state.set", { value: 7 });
  await wait_for_revision(authority, 1);
  firstPair.disconnect();
  await assert.rejects(pending, /closed/i);
  const stable = pending.request;
  first.dispose();
  assert.equal(authority.rev, 1);
  assert.equal(executions, 1);

  const secondPair = socket_pair();
  locus.connect(secondPair.server);
  const second = hsonEcho.create({ socket: secondPair.client, map: make_map(), recovery: { logicalMapId: locus.logicalMapId }, clientId: "dedupe-client", session: { credential } });
  await second.connect();
  const retried = await second.retryAction(stable);
  assert.equal(retried.type, "ack");
  if (retried.type === "ack") assert.equal(retried.delivery, "cached");
  assert.equal(authority.rev, 1);
  assert.equal(executions, 1);
  const status = await second.actionStatus(stable.requestId);
  assert.equal(status.state, "succeeded");
  assert.equal(status.outcome?.completionRev, 1);
  const conflict = await second.retryAction(Object.freeze({ requestId: stable.requestId, name: "state.set", payload: { value: 8 } }));
  assert.equal(conflict.type, "error");
  if (conflict.type === "error") assert.equal(conflict.error.code, "LOCUS_ACTION_REQUEST_ID_CONFLICT");
  assert.equal(authority.rev, 1);
  second.dispose();
  locus.dispose();
});

await check("aggregate retained action lineage enforces exact principal continuity", async () => {
  const authority = make_map();
  let executions = 0;
  const locus = hsonLocus.create({
    map: authority,
    actions: {
      owned() {
        executions += 1;
        return { owner: "alice" };
      },
    },
  });
  const alicePair = socket_pair();
  locus.connect(alicePair.server, { principalId: "alice" });
  const alice = hsonEcho.create({
    socket: alicePair.client,
    map: make_map(),
    recovery: { logicalMapId: locus.logicalMapId },
    clientId: "aggregate-owned-client",
  });
  await alice.connect();
  const first = alice.action("owned");
  await first;

  const nextAlicePair = socket_pair();
  locus.connect(nextAlicePair.server, { principalId: "alice" });
  const nextAlice = hsonEcho.create({
    socket: nextAlicePair.client,
    map: make_map(),
    recovery: { logicalMapId: locus.logicalMapId },
    clientId: "aggregate-owned-client",
  });
  await nextAlice.connect();
  assert.equal((await nextAlice.actionStatus(first.request.requestId)).state, "succeeded");
  assert.equal((await nextAlice.retryAction(first.request)).delivery, "cached");

  const bobPair = socket_pair();
  locus.connect(bobPair.server, { principalId: "bob" });
  const bob = hsonEcho.create({
    socket: bobPair.client,
    map: make_map(),
    recovery: { logicalMapId: locus.logicalMapId },
    clientId: "aggregate-owned-client",
  });
  await bob.connect();
  await assert.rejects(bob.actionStatus(first.request.requestId), /session access is unavailable/i);
  const denied = await bob.retryAction(first.request);
  assert.equal(denied.type, "error");
  if (denied.type === "error") assert.equal(denied.error.code, "LOCUS_SESSION_CREDENTIAL_UNKNOWN");
  assert.equal(executions, 1);

  alice.dispose();
  nextAlice.dispose();
  bob.dispose();
  locus.dispose();
});

await check("built-ins and single- or cross-library application actions share one FIFO and revision stream", async () => {
  const authority = make_map();
  const order: string[] = [];
  const locus = hsonLocus.create({
    map: authority,
    actions: {
      "state.only": async (context) => {
        order.push("state");
        await context.mutate((draft) => draft.lib("state").at(["value"]).set(1));
      },
      "cross.library": async (context) => {
        order.push("cross");
        await context.mutate((draft) => {
          draft.lib("state").at(["value"]).set(2);
          draft.lib("other").at(["value"]).set(2);
        });
      },
    },
  });
  const pair = socket_pair();
  locus.connect(pair.server);
  const echo = hsonEcho.create({ socket: pair.client, map: make_map(), recovery: { logicalMapId: locus.logicalMapId } });
  await echo.connect();
  const revisions: number[] = [];
  const libraries: string[][] = [];
  const stop = authority.commits.observe((commit) => {
    revisions.push(commit.rev);
    libraries.push(commit.operations.map((operation) => operation.library));
  });
  const first = echo.action("state.only");
  const second = echo.action("document.attrs.set", { library: "page", target: { kind: "path", path: [0] }, name: "title", value: "fifo" });
  const third = echo.action("cross.library");
  const results = await Promise.all([first, second, third]);
  assert.deepEqual(results.map((result) => result.type), ["ack", "ack", "ack"]);
  assert.deepEqual(order, ["state", "cross"]);
  assert.deepEqual(revisions, [1, 2, 3]);
  assert.deepEqual(libraries, [["state"], ["page"], ["state", "other"]]);
  assert.equal(authority.rev, 3);
  assert.equal(echo.map.rev, 3);
  stop();
  echo.dispose();
  locus.dispose();
});

await check("replacement during authorization cannot cross aggregate admission", async () => {
  const authorizationEntered = deferred();
  const authorizationRelease = deferred();
  let executions = 0;
  const locus = hsonLocus.create({
    map: make_map(),
    sessions: { graceMs: 10_000, credential: () => "aggregate-auth-fence-credential" },
    authorizeAction: async () => {
      authorizationEntered.resolve();
      await authorizationRelease.promise;
      return true;
    },
    actions: { held: () => { executions += 1; } },
  });
  const firstPair = socket_pair();
  locus.connect(firstPair.server, { principalId: "alice" });
  const first = hsonEcho.create({ socket: firstPair.client, map: make_map(), recovery: { logicalMapId: locus.logicalMapId }, clientId: "auth-fence-client" });
  await first.connect();
  const credential = first.session.credential;
  assert.ok(credential);
  const pending = first.action("held");
  await authorizationEntered.promise;

  const secondPair = socket_pair();
  locus.connect(secondPair.server, { principalId: "alice" });
  const second = hsonEcho.create({
    socket: secondPair.client,
    map: make_map(),
    recovery: { logicalMapId: locus.logicalMapId },
    clientId: "auth-fence-client",
    session: { credential },
  });
  await second.connect();
  assert.equal(second.session.epoch, 2);
  authorizationRelease.resolve();
  await assert.rejects(pending, /fenced/i);
  await Promise.resolve();
  assert.equal(executions, 0);
  assert.equal(locus.rev, 0);
  assert.equal(locus.actionRequests.debug().pendingRequestCount, 0);
  assert.equal(locus.actionRequests.debug().retainedTerminalCount, 0);
  assert.equal(firstPair.received.some((message) => (message.type === "ack" || message.type === "error") && message.requestId === pending.request.requestId), false);
  first.dispose();
  second.dispose();
  locus.dispose();
});

await check("replacement after admission retains the outcome but fences late delivery", async () => {
  const handlerEntered = deferred();
  const handlerRelease = deferred();
  const authority = make_map();
  const locus = hsonLocus.create({
    map: authority,
    sessions: { graceMs: 10_000, credential: () => "aggregate-post-admit-credential" },
    actions: {
      held: async (context) => {
        handlerEntered.resolve();
        await handlerRelease.promise;
        await context.mutate((draft) => draft.lib("state").at(["value"]).set(9));
      },
    },
  });
  const firstPair = socket_pair();
  locus.connect(firstPair.server, { principalId: "alice" });
  const first = hsonEcho.create({ socket: firstPair.client, map: make_map(), recovery: { logicalMapId: locus.logicalMapId }, clientId: "post-admit-client" });
  await first.connect();
  const credential = first.session.credential;
  assert.ok(credential);
  const pending = first.action("held");
  await handlerEntered.promise;
  assert.equal(locus.activity.snapshot().actionCount, 1);

  const secondPair = socket_pair();
  locus.connect(secondPair.server, { principalId: "alice" });
  const second = hsonEcho.create({
    socket: secondPair.client,
    map: make_map(),
    recovery: { logicalMapId: locus.logicalMapId },
    clientId: "post-admit-client",
    session: { credential },
  });
  await second.connect();
  handlerRelease.resolve();
  await assert.rejects(pending, /fenced/i);
  const recovered = await second.retryAction(pending.request);
  assert.equal(recovered.type, "ack");
  if (recovered.type === "ack") assert.ok(recovered.delivery === "joined" || recovered.delivery === "cached");
  assert.equal(authority.rev, 1);
  assert.equal(authority.lib("state").snap(["value"]), 9);
  assert.equal(recovered.completionRev, 1);
  assert.equal((await second.actionStatus(pending.request.requestId)).state, "succeeded");
  assert.equal(locus.activity.snapshot().actionCount, 0);
  assert.equal(firstPair.received.some((message) => (message.type === "ack" || message.type === "error") && message.requestId === pending.request.requestId), false);
  first.dispose();
  second.dispose();
  locus.dispose();
});

await check("disconnect after admission cannot evict or cancel aggregate authority work", async () => {
  const handlerEntered = deferred();
  const handlerRelease = deferred();
  const authority = make_map();
  const locus = hsonLocus.create({
    map: authority,
    sessions: { graceMs: 10_000, credential: () => "aggregate-disconnect-credential" },
    actions: {
      held: async (context) => {
        handlerEntered.resolve();
        await handlerRelease.promise;
        await context.mutate((draft) => draft.lib("state").at(["value"]).set(11));
      },
    },
  });
  const firstPair = socket_pair();
  locus.connect(firstPair.server, { principalId: "alice" });
  const first = hsonEcho.create({ socket: firstPair.client, map: make_map(), recovery: { logicalMapId: locus.logicalMapId }, clientId: "disconnect-client" });
  await first.connect();
  const credential = first.session.credential;
  assert.ok(credential);
  const pending = first.action("held");
  await handlerEntered.promise;
  firstPair.disconnect();
  await assert.rejects(pending, /closed/i);
  assert.equal(locus.activity.snapshot().connectionCount, 0);
  assert.equal(locus.activity.snapshot().actionCount, 1);
  handlerRelease.resolve();

  const secondPair = socket_pair();
  locus.connect(secondPair.server, { principalId: "alice" });
  const second = hsonEcho.create({
    socket: secondPair.client,
    map: make_map(),
    recovery: { logicalMapId: locus.logicalMapId },
    clientId: "disconnect-client",
    session: { credential },
  });
  await second.connect();
  const recovered = await second.retryAction(pending.request);
  assert.equal(recovered.type, "ack");
  assert.equal(recovered.completionRev, 1);
  assert.equal(authority.lib("state").snap(["value"]), 11);
  assert.equal(locus.activity.snapshot().actionCount, 0);
  first.dispose();
  second.dispose();
  locus.dispose();
});

process.stdout.write(`1..${checks}\n`);
testEvents.terminal("pass");
