import { create_test_event_emitter } from "../test-events.mjs";
import assert from "node:assert/strict";
import { hson } from "../../src/index.ts";
import { admit_locus_solo_external_action } from "../../src/api/locus/locus.action-admission.ts";
import { make_locus_action_dedupe_store } from "../../src/api/locus/locus.actions.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "locus.action-admission",
  title: "Transport-neutral solo action admission",
  category: "Locus",
  runtime: "node",
  tags: Object.freeze(["actions", "admission", "authority", "transport-neutral"]),
});

const testEvents = create_test_event_emitter("locus.action-admission");
let checks = 0;
async function check(name, run) {
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
  process.stdout.write(`ok ${++checks} - ${name}\n`);
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture(options = {}) {
  const map = hson.liveMap.fromJson({ value: 0 });
  const actions = {
    set(context, payload) {
      void context.mutate((draft) => draft.set(["value"], payload.value));
      return payload;
    },
    async gated(_context, payload) {
      await options.gate?.promise;
      return payload;
    },
  };
  const schema = {
    actions: {
      set: { payload: (value) => typeof value === "object" && value !== null && typeof value.value === "number" },
      gated: { payload: (value) => typeof value === "number" },
    },
  };
  let seq = 0;
  let attachmentEpoch = 1;
  let actionActivity = 0;
  const actionRequests = make_locus_action_dedupe_store(() => map.rev, () => seq);
  const authority = Object.freeze({
    map,
    readonlyMap: map,
    actions,
    schema,
    authorizer: options.authorizer,
    actionRequests,
    mutations: Object.freeze({ mutate: async (mutation) => mutation(map) }),
    logicalMapId: "direct-admission-map",
    incarnationId: "direct-admission-incarnation",
    mapMode: map.mode,
    currentSeq: () => seq,
    nextSeq: () => ++seq,
    headRev: () => map.rev,
    disposed: () => false,
    acquireActionActivity: () => {
      actionActivity += 1;
      let held = true;
      return () => {
        if (!held) return;
        held = false;
        actionActivity -= 1;
      };
    },
    traceStateBoundary: () => {},
  });
  const origin = Object.freeze({ kind: "session", sessionId: "logical-session", epoch: 1, resumable: true });
  const connection = Object.freeze({ principalId: "principal", attachment: Object.freeze({ role: "editor" }) });
  function admit(message, epoch = attachmentEpoch) {
    return admit_locus_solo_external_action(authority, {
      message,
      origin,
      connection,
      attachmentCurrent: () => epoch === attachmentEpoch,
    });
  }
  return {
    map,
    authority,
    admit,
    replaceAttachment: () => { attachmentEpoch += 1; },
    actionActivity: () => actionActivity,
    dispose: actionRequests.dispose,
  };
}

await check("direct seam validates, authorizes, executes, settles, and constructs a terminal response", async () => {
  let context;
  const f = fixture({ authorizer(value) { context = value; return true; } });
  const admitted = await f.admit({
    type: "action", id: "wire-1", name: "set", payload: { value: 7 },
    clientId: "client-1", requestId: "request-1", attemptId: "attempt-1",
  });
  assert.equal(admitted.kind, "deduped");
  assert.equal(admitted.delivery, "executed");
  assert.deepEqual(admitted.response, {
    type: "ack", id: "wire-1", ok: true, seq: 1, completionRev: 1,
    requestId: "request-1", attemptId: "attempt-1", delivery: "executed", result: { value: 7 },
  });
  assert.equal(context.session.sessionId, "logical-session");
  assert.deepEqual(context.connection.attachment, { role: "editor" });
  assert.deepEqual(f.map.snap(), { value: 7 });
  f.dispose();
});

await check("direct seam denies before dedupe or execution", async () => {
  const f = fixture({ authorizer: () => false });
  const admitted = await f.admit({
    type: "action", id: "wire-2", name: "set", payload: { value: 8 },
    clientId: "client-2", requestId: "request-2", attemptId: "attempt-2",
  });
  assert.equal(admitted.kind, "rejected");
  assert.equal(admitted.response.error.code, "LOCUS_ACTION_FORBIDDEN");
  assert.equal(admitted.response.delivery, "rejected");
  assert.equal(f.authority.actionRequests.debug().executionsStarted, 0);
  assert.deepEqual(f.map.snap(), { value: 0 });
  f.dispose();
});

await check("attachment fenced during asynchronous authorization cannot cross admission", async () => {
  const authorization = deferred();
  const f = fixture({ authorizer: () => authorization.promise });
  const attempt = f.admit({
    type: "action", id: "wire-fenced-before", name: "set", payload: { value: 11 },
    clientId: "client-fenced-before", requestId: "request-fenced-before",
  });
  f.replaceAttachment();
  authorization.resolve(true);
  const admitted = await attempt;
  assert.equal(admitted.kind, "rejected");
  assert.equal(admitted.response.error.code, "LOCUS_SESSION_ATTACHMENT_FENCED");
  assert.equal(admitted.response.delivery, "rejected");
  assert.equal(f.authority.actionRequests.debug().executionsStarted, 0);
  assert.equal(f.authority.actionRequests.debug().pendingRequestCount, 0);
  assert.equal(f.authority.actionRequests.debug().retainedTerminalCount, 0);
  assert.equal(f.map.rev, 0);
  assert.deepEqual(f.map.snap(), { value: 0 });
  assert.equal(f.actionActivity(), 0);
  f.dispose();
});

await check("legacy attachment fenced during authorization cannot begin non-deduped execution", async () => {
  const authorization = deferred();
  const f = fixture({ authorizer: () => authorization.promise });
  const attempt = f.admit({ type: "action", id: "legacy-fenced-before", name: "set", payload: { value: 13 } });
  f.replaceAttachment();
  authorization.resolve(true);
  const admitted = await attempt;
  assert.equal(admitted.kind, "rejected");
  assert.equal(admitted.response.error.code, "LOCUS_SESSION_ATTACHMENT_FENCED");
  assert.equal(admitted.response.delivery, undefined);
  assert.equal(f.map.rev, 0);
  assert.deepEqual(f.map.snap(), { value: 0 });
  assert.equal(f.actionActivity(), 0);
  f.dispose();
});

await check("attachment fenced after admission cannot cancel retained authority work", async () => {
  const gate = deferred();
  const f = fixture({ gate, authorizer: () => true });
  const message = {
    type: "action", id: "wire-fenced-after", name: "gated", payload: 12,
    clientId: "client-fenced-after", requestId: "request-fenced-after",
  };
  const attempt = f.admit(message);
  assert.equal(f.authority.actionRequests.debug().executionsStarted, 1);
  assert.equal(f.authority.actionRequests.debug().pendingRequestCount, 1);
  assert.equal(f.actionActivity(), 1);
  f.replaceAttachment();
  gate.resolve();
  const admitted = await attempt;
  assert.equal(admitted.kind, "deduped");
  assert.equal(admitted.delivery, "executed");
  assert.equal(admitted.response.completionRev, 0);
  assert.equal(f.authority.actionRequests.debug().retainedTerminalCount, 1);
  assert.equal(f.actionActivity(), 0);
  const cached = await f.admit({ ...message, id: "wire-fenced-after-retry", retry: true });
  assert.equal(cached.kind, "deduped");
  assert.equal(cached.delivery, "cached");
  assert.deepEqual(cached.response.result, 12);
  assert.equal(cached.response.completionRev, admitted.response.completionRev);
  f.dispose();
});

await check("direct seam joins pending work and reuses its cached terminal outcome", async () => {
  const gate = deferred();
  let authorizations = 0;
  const f = fixture({ gate, authorizer: () => { authorizations += 1; return true; } });
  const firstMessage = {
    type: "action", id: "wire-3", name: "gated", payload: 9,
    clientId: "client-3", requestId: "request-3", attemptId: "attempt-3",
  };
  const first = f.admit(firstMessage);
  await Promise.resolve();
  const joined = f.admit({ ...firstMessage, id: "wire-4", attemptId: "attempt-4", retry: true });
  gate.resolve();
  const [executedResult, joinedResult] = await Promise.all([first, joined]);
  assert.equal(executedResult.delivery, "executed");
  assert.equal(joinedResult.delivery, "joined");
  const cached = await f.admit({ ...firstMessage, id: "wire-5", attemptId: "attempt-5", retry: true });
  assert.equal(cached.delivery, "cached");
  assert.deepEqual(cached.response.result, 9);
  assert.equal(cached.response.completionRev, executedResult.response.completionRev);
  assert.equal(authorizations, 3);
  f.dispose();
});

await check("direct seam preserves the distinct legacy non-deduped branch", async () => {
  const f = fixture({ authorizer: () => true });
  const admitted = await f.admit({ type: "action", id: "legacy-1", name: "set", payload: { value: 10 } });
  assert.equal(admitted.kind, "legacy");
  assert.equal(admitted.response.type, "ack");
  assert.equal(admitted.response.delivery, undefined);
  assert.equal(admitted.response.completionRev, 1);
  assert.deepEqual(f.map.snap(), { value: 10 });
  f.dispose();
});

process.stdout.write(`# ${checks} transport-neutral solo admission checks passed\n`);
testEvents.terminal("pass");
