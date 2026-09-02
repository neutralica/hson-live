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
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
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
  dropNextActionResult: () => void;
  disconnect: () => void;
}> {
  const clientMessages = new Set<(raw: string) => void>();
  const serverMessages = new Set<(raw: string) => void>();
  const clientCloses = new Set<() => void>();
  const serverCloses = new Set<() => void>();
  let dropActionResult = false;
  let closed = false;
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
      for (const listener of [...clientMessages]) listener(raw);
    },
    close: disconnect,
    onMessage(listener: (raw: string) => void) { serverMessages.add(listener); return () => serverMessages.delete(listener); },
    onClose(listener: () => void) { serverCloses.add(listener); return () => serverCloses.delete(listener); },
  });
  return Object.freeze({ client, server, dropNextActionResult: () => { dropActionResult = true; }, disconnect });
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

process.stdout.write(`1..${checks}\n`);
testEvents.terminal("pass");
emit_hson_live_test_completion("locus.hosted-multi-library-action-pipeline", checks, checks, 0);
