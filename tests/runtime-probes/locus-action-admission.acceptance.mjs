import { create_test_event_emitter } from "../test-events.mjs";
import assert from "node:assert/strict";
import { hson } from "../../src/index.ts";
import { admit_locus_remote_action_internal } from "../../src/api/locus/locus.remote-action.internal.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({ id: "locus.action-admission", title: "Transport-neutral solo action admission", category: "Locus", runtime: "node", tags: Object.freeze(["actions", "admission", "authority", "transport-neutral"]) });
const testEvents = create_test_event_emitter("locus.action-admission");
let checks = 0;
async function check(name, run) {
  testEvents.case_begin(name, name);
  try { await run(); testEvents.case_end(name, "pass"); }
  catch (error) { testEvents.case_end(name, "fail"); testEvents.terminal("fail"); throw error; }
  process.stdout.write(`ok ${++checks} - ${name}\n`);
}
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return Object.freeze({ promise, resolve }); }

function fixture(options = {}) {
  let executions = 0;
  const authorizationContexts = [];
  const handlerOrigins = [];
  let host;
  host = hson.locus.create({
    state: { value: 0 }, logicalMapId: "remote-admission-map", incarnationId: "remote-admission-incarnation",
    schema: { actions: {
      set: { payload: (value) => typeof value === "object" && value !== null && typeof value.value === "number" },
      held: { payload: (value) => typeof value === "number" }, fail: { payload: () => true }, event: { payload: () => true },
    } },
    authorizeAction(context) {
      authorizationContexts.push(context);
      assert.equal(host.sessions.debug().sessions.some((session) => session.sessionId === context.session.sessionId && session.state === "attached" && session.resumable === false), true);
      return options.authorizer?.(context) ?? true;
    },
    actions: {
      async set(context, payload) {
        executions += 1; handlerOrigins.push(context.origin);
        assert.equal(host.sessions.debug().sessions.some((session) => session.sessionId === context.origin.sessionId && session.state === "attached"), true);
        await context.mutate((draft) => draft.set(["value"], payload.value)); return payload;
      },
      async held(context, payload) { executions += 1; handlerOrigins.push(context.origin); options.entered?.resolve(); await options.gate?.promise; return payload; },
      fail() { executions += 1; throw new Error("application failed"); },
      event(context) { executions += 1; return { delivered: context.emit_event("notice", { value: 1 }) }; },
    },
  });
  const connection = Object.freeze({ principalId: "alice", attachment: Object.freeze({ role: "editor" }) });
  return Object.freeze({ host, authorizationContexts, handlerOrigins, executions: () => executions,
    admit: (message, supplied = connection) => admit_locus_remote_action_internal(host, { message, connection: supplied }) });
}
function stable(id, name, payload, attemptId = `${id}-attempt`) {
  return Object.freeze({ type: "action", id: `${id}-wire`, clientId: `${id}-client`, requestId: `${id}-request`, attemptId, name, ...(payload === undefined ? {} : { payload }) });
}
function assert_clean(host) {
  assert.equal(host.sessions.debug().activeSessionCount, 0); assert.equal(host.sessions.debug().sessions.length, 0);
  assert.equal(host.activity.snapshot().actionCount, 0); assert.equal(host.activity.snapshot().retainedSessionCount, 0);
}

await check("one-shot success uses a real principal-bound non-resumable session and standard result", async () => {
  const f = fixture(); const result = await f.admit(stable("success", "set", { value: 7 }, "attempt-success"));
  assert.deepEqual(result, { type: "ack", id: "success-wire", requestId: "success-request", attemptId: "attempt-success", ok: true, seq: 1, completionRev: 1, delivery: "executed", result: { value: 7 } });
  const authorization = f.authorizationContexts[0];
  assert.equal(authorization.connection.principalId, "alice"); assert.deepEqual(authorization.connection.attachment, { role: "editor" });
  assert.equal(authorization.session.resumable, false); assert.equal(f.handlerOrigins[0].kind, "session");
  assert.equal(f.handlerOrigins[0].sessionId, authorization.session.sessionId); assert.deepEqual(f.host.map.snap(), { value: 7 });
  assert_clean(f.host); f.host.dispose();
});

await check("pending and completed duplicates share lineage across distinct ephemeral sessions", async () => {
  const gate = deferred(), entered = deferred(), f = fixture({ gate, entered });
  const message = stable("dedupe", "held", 9, "attempt-1"); const first = f.admit(message); await entered.promise;
  const joined = f.admit({ ...message, id: "dedupe-wire-2", attemptId: "attempt-2", retry: true }); gate.resolve();
  const [executed, joinedResult] = await Promise.all([first, joined]);
  assert.equal(executed.delivery, "executed"); assert.equal(joinedResult.delivery, "joined");
  assert.notEqual(f.authorizationContexts[0].session.sessionId, f.authorizationContexts[1].session.sessionId);
  const cached = await f.admit({ ...message, id: "dedupe-wire-3", attemptId: "attempt-3", retry: true });
  assert.equal(cached.delivery, "cached"); assert.equal(cached.attemptId, "attempt-3"); assert.equal(f.executions(), 1);
  assert_clean(f.host); f.host.dispose();
});

await check("fingerprint conflicts and principal ownership use the existing request store", async () => {
  const f = fixture(), message = stable("owned", "held", 1); assert.equal((await f.admit(message)).type, "ack");
  const conflict = await f.admit({ ...message, id: "owned-conflict", payload: 2, retry: true });
  assert.equal(conflict.type, "error"); assert.equal(conflict.error.code, "LOCUS_ACTION_REQUEST_ID_CONFLICT");
  const foreign = await f.admit({ ...message, id: "owned-foreign", retry: true }, Object.freeze({ principalId: "bob", attachment: Object.freeze({ role: "editor" }) }));
  assert.equal(foreign.type, "error"); assert.equal(foreign.error.code, "LOCUS_SESSION_CREDENTIAL_UNKNOWN"); assert.equal(f.executions(), 1);
  assert_clean(f.host); f.host.dispose();
});

await check("event delivery is unavailable without inventing a downstream channel", async () => {
  const f = fixture(), result = await f.admit(stable("event", "event", undefined));
  assert.equal(result.type, "ack"); assert.deepEqual(result.result, { delivered: false }); assert_clean(f.host); f.host.dispose();
});

await check("rejection and handler failure paths release ephemeral state", async () => {
  const invalid = fixture(); assert.equal((await invalid.admit(stable("invalid", "set", { value: "bad" }))).error.code, "LOCUS_SCHEMA_INVALID_PAYLOAD"); assert_clean(invalid.host); invalid.host.dispose();
  for (const [authorizer, code] of [[() => false, "LOCUS_ACTION_FORBIDDEN"], [() => { throw new Error("secret"); }, "LOCUS_ACTION_AUTHORIZATION_FAILED"]]) {
    const denied = fixture({ authorizer }), result = await denied.admit(stable(`denied-${code}`, "held", 1));
    assert.equal(result.type, "error"); assert.equal(result.error.code, code); assert_clean(denied.host); denied.host.dispose();
  }
  const failed = fixture(); assert.equal((await failed.admit(stable("failed", "fail", undefined))).error.code, "LOCUS_ACTION_FAILED"); assert_clean(failed.host); failed.host.dispose();
});

await check("Locus disposal fences pre-admission work and releases the operation session", async () => {
  const authorization = deferred(), f = fixture({ authorizer: () => authorization.promise });
  const pending = f.admit(stable("dispose", "held", 1)); await Promise.resolve(); f.host.dispose(); authorization.resolve(true);
  const result = await pending; assert.equal(result.type, "error"); assert.equal(result.error.code, "LOCUS_SESSION_ATTACHMENT_FENCED");
  assert.equal(f.host.sessions.debug().activeSessionCount, 0); assert.equal(f.host.sessions.debug().sessions.length, 0); assert.equal(f.host.activity.snapshot().state, "disposed");
});

process.stdout.write(`# ${checks} transport-neutral solo admission checks passed\n`);
testEvents.terminal("pass");
