import assert from "node:assert/strict";
import { Hson, hsonLiveMap, type HsonSchema } from "../src/index.ts";
import type {
  LocusActionPayloads,
  LocusActionTerminalOutcome,
  LocusClientActionMessage,
} from "../src/types/locus.types.ts";
import { make_locus_action_dedupe_store } from "../src/api/locus/locus.actions.ts";
import {
  admit_locus_aggregate_external_action,
  type LocusAggregateExternalActionAuthority,
} from "../src/api/locus/locus.hosted-multi-library.action-admission.ts";
import {
  create_locus_hosted_aggregate_internal,
  type LocusHostedAggregateAction,
} from "../src/api/locus/locus.hosted-multi-library.ts";
import { create_test_event_emitter } from "./test-events.mjs";

const ValueSchema: HsonSchema = Hson`<type "data" content <value <number <int true min 0>>>>`;

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "locus.hosted-multi-library-admission",
  title: "Hosted multi-library external admission",
  category: "Locus",
  runtime: "node",
  tags: Object.freeze(["locus", "livemap", "libraries", "actions", "admission"]),
});

const testEvents = create_test_event_emitter("locus.hosted-multi-library-admission");
let checks = 0;
async function check(name: string, run: () => void | Promise<void>): Promise<void> {
  testEvents.case_begin(name, name);
  try {
    await run();
    testEvents.case_end(name, "pass");
  } catch (error) {
    testEvents.case_end(name, "fail");
    testEvents.terminal("fail");
    throw error;
  }
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => { resolve = done; });
  return Object.freeze({ promise, resolve });
}

function make_map() {
  return hsonLiveMap.fromLibraries({
    state: { data: { value: 0 }, schema: ValueSchema },
    other: { data: { value: 0 }, schema: ValueSchema },
  });
}

type TestActions = Readonly<{
  cross: Readonly<{ value: number }>;
  held: undefined;
}>;

function make_fixture(input: Readonly<{
  actions: Readonly<Record<string, LocusHostedAggregateAction>>;
  authorize?: LocusAggregateExternalActionAuthority<TestActions>["authorizer"];
}>) {
  const map = make_map();
  const aggregate = create_locus_hosted_aggregate_internal({ map, actions: input.actions });
  let seq = 0;
  let epoch = 1;
  let activity = 0;
  const requests = make_locus_action_dedupe_store(() => aggregate.rev, () => seq);
  const authority: LocusAggregateExternalActionAuthority<TestActions> = Object.freeze({
    authorizer: input.authorize,
    actionRequests: requests,
    logicalMapId: aggregate.logicalMapId,
    incarnationId: aggregate.incarnationId,
    currentSeq: () => seq,
    headRev: () => aggregate.rev,
    validateAction(message) {
      if (input.actions[message.name] === undefined) {
        return Object.freeze({ ok: false, code: "LOCUS_UNKNOWN_ACTION", message: `Unknown action ${message.name}.` });
      }
      return Object.freeze({ ok: true, payload: message.payload });
    },
    async executeAction(message, payload): Promise<LocusActionTerminalOutcome> {
      try {
        const result = await aggregate.dispatch_action(message.name, payload, message);
        seq += 1;
        return Object.freeze({
          state: "succeeded",
          seq,
          completionRev: aggregate.rev,
          ...(result === undefined ? {} : { result }),
        });
      } catch (cause) {
        return Object.freeze({
          state: "failed",
          seq,
          completionRev: aggregate.rev,
          error: Object.freeze({ code: "LOCUS_ACTION_FAILED", message: cause instanceof Error ? cause.message : "failed" }),
        });
      }
    },
    acquireActionActivity() {
      activity += 1;
      let held = true;
      return () => {
        if (!held) return;
        held = false;
        activity -= 1;
      };
    },
  });
  function admit(message: LocusClientActionMessage<TestActions>, principalId: string | undefined = undefined, capturedEpoch = epoch) {
    return admit_locus_aggregate_external_action(authority, {
      message,
      origin: Object.freeze({ kind: "session", sessionId: "aggregate-session", epoch: capturedEpoch, resumable: true }),
      connection: Object.freeze({ ...(principalId === undefined ? {} : { principalId }) }),
      attachmentCurrent: () => capturedEpoch === epoch,
    });
  }
  return Object.freeze({
    map,
    aggregate,
    requests,
    admit,
    fence: () => { epoch += 1; },
    activity: () => activity,
    dispose: () => { requests.dispose(); aggregate.dispose(); },
  });
}

await check("direct transport-neutral admission preserves one atomic cross-library revision", async () => {
  const commits: Readonly<{ rev: number; libraries: readonly string[] }>[] = [];
  const fixture = make_fixture({
    actions: {
      cross: async (context, payload) => {
        const value = (payload as { value: number }).value;
        await context.mutate((draft) => {
          const state = draft.lib("state");
          const other = draft.lib("other");
          if (!("at" in state) || !("at" in other)) throw new Error("Expected data libraries.");
          state.at(["value"]).set(value);
          other.at(["value"]).set(value);
        });
        return { accepted: true };
      },
    },
  });
  const stop = fixture.map.commits.observe((commit) => commits.push(Object.freeze({
    rev: commit.rev,
    libraries: Object.freeze(commit.operations.map((operation) => operation.library)),
  })));
  const result = await fixture.admit({
    type: "action", id: "wire-1", clientId: "client-1", requestId: "request-1",
    name: "cross", payload: { value: 7 },
  });
  assert.equal(result.kind, "deduped");
  assert.equal(result.response.type, "ack");
  assert.equal(result.response.completionRev, 1);
  assert.equal(fixture.map.rev, 1);
  assert.equal(fixture.map.lib("state").snap(["value"]), 7);
  assert.equal(fixture.map.lib("other").snap(["value"]), 7);
  assert.deepEqual(commits, [{ rev: 1, libraries: ["state", "other"] }]);
  assert.equal(fixture.requests.debug().retainedTerminalCount, 1);
  stop();
  fixture.dispose();
});

await check("authorization denial and authorization-time fencing are inert before dedupe", async () => {
  const authorization = deferred<boolean>();
  let executions = 0;
  const fixture = make_fixture({
    authorize: () => authorization.promise,
    actions: { held: () => { executions += 1; } },
  });
  const pending = fixture.admit({
    type: "action", id: "wire-2", clientId: "client-2", requestId: "request-2", name: "held",
  });
  fixture.fence();
  authorization.resolve(true);
  const fenced = await pending;
  assert.equal(fenced.kind, "rejected");
  assert.equal(fenced.response.type, "error");
  if (fenced.response.type === "error") assert.equal(fenced.response.error.code, "LOCUS_SESSION_ATTACHMENT_FENCED");
  assert.equal(executions, 0);
  assert.equal(fixture.map.rev, 0);
  assert.equal(fixture.requests.debug().pendingRequestCount, 0);
  assert.equal(fixture.requests.debug().retainedTerminalCount, 0);
  fixture.dispose();

  const denied = make_fixture({ authorize: () => false, actions: { held: () => { executions += 1; } } });
  const result = await denied.admit({
    type: "action", id: "wire-3", clientId: "client-3", requestId: "request-3", name: "held",
  });
  assert.equal(result.kind, "rejected");
  assert.equal(executions, 0);
  assert.equal(denied.requests.debug().retainedTerminalCount, 0);
  denied.dispose();
});

await check("admitted work survives fencing, retains activity, joins, caches, and protects ownership", async () => {
  const handler = deferred<void>();
  const handlerEntered = deferred<void>();
  let entered = 0;
  const fixture = make_fixture({
    actions: { held: async () => { entered += 1; handlerEntered.resolve(); await handler.promise; return { done: true }; } },
  });
  const request: LocusClientActionMessage<TestActions> = {
    type: "action", id: "wire-4", clientId: "client-4", requestId: "request-4", name: "held",
  };
  const first = fixture.admit(request, "alice");
  await handlerEntered.promise;
  assert.equal(entered, 1);
  assert.equal(fixture.activity(), 1);
  const joined = fixture.admit({ ...request, id: "wire-5", retry: true }, "alice");
  const mismatched = await fixture.admit({ ...request, id: "wire-6", retry: true }, "bob");
  assert.equal(mismatched.kind, "rejected");
  if (mismatched.response.type === "error") assert.equal(mismatched.response.error.code, "LOCUS_SESSION_CREDENTIAL_UNKNOWN");
  fixture.fence();
  assert.equal(fixture.activity(), 1);
  handler.resolve();
  const [executed, joinedResult] = await Promise.all([first, joined]);
  assert.equal(executed.kind, "deduped");
  assert.equal(joinedResult.kind, "deduped");
  if (joinedResult.kind === "deduped") assert.equal(joinedResult.delivery, "joined");
  assert.equal(fixture.activity(), 0);
  assert.equal(fixture.requests.debug().retainedTerminalCount, 1);
  const ownedStatus = fixture.requests.status("client-4", "request-4", "alice");
  assert.equal(ownedStatus.ok, true);
  if (ownedStatus.ok) assert.equal(ownedStatus.state, "succeeded");
  assert.equal(fixture.requests.status("client-4", "request-4", "bob").ok, false);
  const cached = await fixture.admit({ ...request, id: "wire-7", retry: true }, "alice", 2);
  assert.equal(cached.kind, "deduped");
  if (cached.kind === "deduped") assert.equal(cached.delivery, "cached");
  assert.equal(entered, 1);
  fixture.dispose();
});

await check("anonymous aggregate lineage is reusable only by another anonymous attempt", async () => {
  let entered = 0;
  const fixture = make_fixture({ actions: { held: () => { entered += 1; return { done: true }; } } });
  const request: LocusClientActionMessage<TestActions> = {
    type: "action", id: "wire-8", clientId: "client-8", requestId: "request-8", name: "held",
  };
  await fixture.admit(request);
  const cached = await fixture.admit({ ...request, id: "wire-9", retry: true });
  assert.equal(cached.kind, "deduped");
  if (cached.kind === "deduped") assert.equal(cached.delivery, "cached");
  const claimed = await fixture.admit({ ...request, id: "wire-10", retry: true }, "alice");
  assert.equal(claimed.kind, "rejected");
  if (claimed.response.type === "error") assert.equal(claimed.response.error.code, "LOCUS_SESSION_CREDENTIAL_UNKNOWN");
  assert.equal(fixture.requests.status("client-8", "request-8", undefined).ok, true);
  assert.equal(fixture.requests.status("client-8", "request-8", "alice").ok, false);
  assert.equal(entered, 1);
  fixture.dispose();
});

process.stdout.write(`1..${checks}\n`);
testEvents.terminal("pass");
