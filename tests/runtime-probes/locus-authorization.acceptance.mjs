import { create_test_event_emitter } from "../test-events.mjs";
import assert from "node:assert/strict";
import { hson } from "../../src/index.ts";
import { create_live_trace_collector } from "../../src/diagnostics/index.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "locus.authorization",
  title: "Locus action authorization",
  category: "Locus",
  runtime: "node",
  tags: Object.freeze(["actions", "authorization", "policy"]),
});

const testEvents = create_test_event_emitter("locus.authorization");
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
  } process.stdout.write(`ok ${++checks} - ${name}\n`); }
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
function socket_pair() {
  const clientListeners = new Set(), serverListeners = new Set(), clientSent = [], serverSent = [];
  return {
    clientSent, serverSent,
    client: { send(raw) { clientSent.push(raw); for (const fn of serverListeners) fn(raw); }, close() {}, onMessage(fn) { clientListeners.add(fn); return () => clientListeners.delete(fn); }, onClose() { return () => {}; } },
    server: { send(raw) { serverSent.push(raw); for (const fn of clientListeners) fn(raw); }, close() {}, onMessage(fn) { serverListeners.add(fn); return () => serverListeners.delete(fn); }, onClose() { return () => {}; } },
  };
}
function connect(host, clientId, context, options = {}) {
  const pair = socket_pair(); let request = 0, attempt = 0;
  host.connect(pair.server, context);
  const client = hson.echo.create({ socket: pair.client, clientId, actionId: () => `${clientId}-request-${++request}`, actionAttemptId: () => `${clientId}-attempt-${++attempt}`, ...options });
  client.connect(); return { client, pair };
}
function legacy_action(host, context, message) {
  const pair = socket_pair();
  host.connect(pair.server, context);
  const response = new Promise((resolve) => {
    pair.client.onMessage((raw) => {
      const value = JSON.parse(raw);
      if ((value.type === "ack" || value.type === "error") && value.id === message.id) resolve(value);
    });
  });
  pair.client.send(JSON.stringify(message));
  return { pair, response };
}
function fixture(options = {}) {
  let executions = 0, session = 0;
  const host = hson.locus.create({
    state: { value: 0 }, logicalMapId: "auth-map", incarnationId: "auth-inc", sessionId: () => `session-${++session}`,
    schema: { actions: { set: { payload: (v) => typeof v === "object" && v !== null && !Array.isArray(v) && typeof v.value === "number" }, gated: { payload: (v) => typeof v === "number" } } },
    actions: {
      async set(ctx, payload) { executions += 1; await ctx.mutate((draft) => draft.set(["value"], payload.value)); return payload; },
      async gated(_ctx, payload) { executions += 1; await options.gate?.promise; return payload; },
    },
    ...(options.authorizeAction ? { authorizeAction: options.authorizeAction } : {}),
    ...(options.trace ? { trace: options.trace } : {}),
  });
  return { host, executions: () => executions };
}

await check("omission is implicit allow; sync and async allow receive frozen validated context", async () => {
  const implicit = fixture(); const a = connect(implicit.host, "implicit").client;
  assert.equal((await a.action("set", { value: 1 })).type, "ack"); assert.equal(implicit.host.map.rev, 1);
  const seen = []; let async = false;
  const allowed = fixture({ authorizeAction(ctx) { seen.push(ctx); return async ? Promise.resolve(true) : true; } });
  const b = connect(allowed.host, "allow").client;
  await b.action("set", { value: 2 }); async = true; await b.action("set", { value: 3 });
  assert.equal(seen.length, 2); assert.equal(seen[0].action, "set"); assert.equal(seen[0].session.sessionId, "session-1");
  assert.equal(seen[0].logicalMapId, "auth-map"); assert.equal(Object.isFrozen(seen[0].payload), true);
});

await check("policy payload is detached and cannot alter handler input", async () => {
  let blocked = false;
  const f = fixture({ authorizeAction(ctx) { try { ctx.payload.value = 99; } catch { blocked = true; } return true; } });
  const result = await connect(f.host, "detach").client.action("set", { value: 4 });
  assert.equal(blocked, true); assert.deepEqual(result.result, { value: 4 }); assert.deepEqual(f.host.map.snap(), { value: 4 });
});

await check("sync and async denial are stable, uncached, and side-effect free", async () => {
  for (const decision of [false, Promise.resolve(false)]) {
    const f = fixture({ authorizeAction: () => decision }); const before = f.host.map.capture();
    const result = await connect(f.host, "deny").client.action("set", { value: 5 });
    assert.equal(result.error.code, "LOCUS_ACTION_FORBIDDEN"); assert.equal(result.error.message, "Locus action is not authorized.");
    assert.equal(f.executions(), 0); assert.deepEqual(f.host.map.capture(), before); assert.equal(f.host.actionRequests.debug().retainedTerminalCount, 0);
  }
});

await check("throw and rejection are safe authorization failures", async () => {
  for (const authorizeAction of [() => { throw new Error("secret-sync"); }, () => Promise.reject(new Error("secret-async"))]) {
    const f = fixture({ authorizeAction }); const result = await connect(f.host, "failure").client.action("set", { value: 6 });
    assert.equal(result.error.code, "LOCUS_ACTION_AUTHORIZATION_FAILED"); assert.equal(result.error.message, "Locus action authorization failed.");
    assert.equal(JSON.stringify(result).includes("secret"), false); assert.equal(f.executions(), 0); assert.equal(f.host.map.rev, 0);
  }
});

await check("lookup and payload validation precede policy; sessions decide independently", async () => {
  let calls = 0;
  const f = fixture({ authorizeAction(ctx) { calls += 1; return ctx.session.sessionId === "session-1"; } });
  const one = connect(f.host, "one").client, two = connect(f.host, "two").client;
  assert.equal((await one.action("set", { value: "bad" })).error.code, "LOCUS_SCHEMA_INVALID_PAYLOAD"); assert.equal(calls, 0);
  assert.equal((await one.action("missing", 1)).error.code, "LOCUS_UNKNOWN_ACTION"); assert.equal(calls, 0);
  assert.equal((await one.action("set", { value: 7 })).type, "ack");
  assert.equal((await two.action("set", { value: 8 })).error.code, "LOCUS_ACTION_FORBIDDEN"); assert.deepEqual(f.host.map.snap(), { value: 7 });
});

await check("joining attempts authorize separately without cancelling the original", async () => {
  const gate = deferred(); let allow = true, calls = 0;
  const f = fixture({ gate, authorizeAction() { calls += 1; return allow; } });
  const a = connect(f.host, "join").client, b = connect(f.host, "join").client;
  const original = a.action("gated", 9); await Promise.resolve(); allow = false;
  assert.equal((await b.retryAction(original.request)).error.code, "LOCUS_ACTION_FORBIDDEN"); assert.equal(f.executions(), 1);
  allow = true; const joined = b.retryAction(original.request); gate.resolve();
  const [first, second] = await Promise.all([original, joined]); assert.equal(first.delivery, "executed"); assert.equal(second.delivery, "joined"); assert.equal(calls, 3);
});

await check("replacement while asynchronous authorization is pending fences admission", async () => {
  const authorization = deferred();
  const f = fixture({ authorizeAction: () => authorization.promise });
  const first = connect(f.host, "authorization-fence", undefined, { session: {} });
  await first.client.session.create();
  const original = first.client.action("set", { value: 19 });
  const secondPair = socket_pair();
  f.host.connect(secondPair.server);
  const second = hson.echo.create({
    socket: secondPair.client,
    clientId: "authorization-fence",
    session: { credential: first.client.session.credential },
  });
  second.connect();
  await second.session.reattach();
  await assert.rejects(original);
  authorization.resolve(true);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(f.executions(), 0);
  assert.equal(f.host.map.rev, 0);
  assert.equal(f.host.actionRequests.debug().executionsStarted, 0);
  assert.equal(f.host.actionRequests.debug().pendingRequestCount, 0);
  assert.equal(f.host.actionRequests.debug().retainedTerminalCount, 0);
  assert.equal(f.host.activity.snapshot().actionCount, 0);
  assert.equal((await second.actionStatus(original.request.requestId)).state, "unknown");
});

await check("cached attempts reauthorize and policy decisions are not cached", async () => {
  let allow = true, calls = 0; const f = fixture({ authorizeAction() { calls += 1; return allow; } }); const client = connect(f.host, "cache").client;
  const call = client.action("set", { value: 10 }); await call; allow = false;
  assert.equal((await client.retryAction(call.request)).error.code, "LOCUS_ACTION_FORBIDDEN"); assert.equal(f.host.actionRequests.debug().retainedTerminalCount, 1);
  allow = true; const cached = await client.retryAction(call.request); assert.equal(cached.delivery, "cached"); assert.equal(f.executions(), 1); assert.equal(calls, 3);
});

await check("trace stage is ordered/redacted and omitted policy records implicit allow", async () => {
  const trace = create_live_trace_collector({ capacity: 64 }); const configured = fixture({ trace, authorizeAction: () => true });
  await connect(configured.host, "trace").client.action("set", { value: 11 });
  const events = trace.events(), begin = events.find((e) => e.phase === "action.authorization" && e.status === "begin"), success = events.find((e) => e.phase === "action.authorization" && e.status === "success"), handler = events.find((e) => e.phase === "handler.execute" && e.status === "begin");
  assert.ok(begin.sequence < success.sequence && success.sequence < handler.sequence);
  const serialized = JSON.stringify(events); assert.equal(serialized.includes('"payload"'), false);
  assert.equal(events.some((event) => event.details && "session" in event.details), false);
  const skipped = create_live_trace_collector({ capacity: 64 }); const implicit = fixture({ trace: skipped }); await connect(implicit.host, "skip").client.action("set", { value: 12 });
  const auth = skipped.events().filter((e) => e.phase === "action.authorization"); assert.equal(auth.length, 1); assert.equal(auth[0].status, "skip"); assert.equal(auth[0].details.reason, "implicit-allow");
});

await check("throwing trace sinks cannot alter allow or deny", async () => {
  const trace = { emit() { throw new Error("trace"); } };
  assert.equal((await connect(fixture({ trace, authorizeAction: () => true }).host, "sink-a").client.action("set", { value: 13 })).type, "ack");
  assert.equal((await connect(fixture({ trace, authorizeAction: () => false }).host, "sink-b").client.action("set", { value: 14 })).error.code, "LOCUS_ACTION_FORBIDDEN");
});

await check("authorization adds no protocol fields", async () => {
  const f = fixture({ authorizeAction: () => true }); const { client, pair } = connect(f.host, "wire"); await client.action("set", { value: 15 });
  for (const raw of [...pair.clientSent, ...pair.serverSent]) { const value = JSON.parse(raw); for (const key of ["authorizeAction", "authorization", "trace", "traceId"]) assert.equal(key in value, false); }
});

await check("opaque connection attachment reaches action policy without entering protocol", async () => {
  const attachment = Object.freeze({ roles: ["writer"], secret: "attachment-only" });
  const seen = [];
  const f = fixture({ authorizeAction(context) { seen.push(context.connection); return true; } });
  const { client, pair } = connect(f.host, "attached", {
    principalId: "principal-a",
    attachment,
  });
  assert.equal((await client.action("set", { value: 16 })).type, "ack");
  const legacy = legacy_action(f.host, { principalId: "principal-a", attachment }, {
    type: "action", id: "legacy-attached", name: "set", payload: { value: 17 },
  });
  assert.equal((await legacy.response).type, "ack");
  assert.equal(seen.length, 2);
  for (const connection of seen) {
    assert.equal(connection.principalId, "principal-a");
    assert.equal(connection.attachment, attachment);
  }
  assert.equal([...pair.clientSent, ...pair.serverSent].some((raw) => raw.includes("attachment-only")), false);
  assert.equal([...legacy.pair.clientSent, ...legacy.pair.serverSent].some((raw) => raw.includes("attachment-only")), false);
});

await check("legacy attachment-based denial does not execute or advance authority", async () => {
  const attachment = Object.freeze({ allow: false });
  const f = fixture({ authorizeAction(context) { return context.connection.attachment.allow; } });
  const before = f.host.map.capture();
  const legacy = legacy_action(f.host, { principalId: "principal-denied", attachment }, {
    type: "action", id: "legacy-denied", name: "set", payload: { value: 18 },
  });
  const result = await legacy.response;
  assert.equal(result.error.code, "LOCUS_ACTION_FORBIDDEN");
  assert.equal(result.delivery, undefined);
  assert.equal(f.executions(), 0);
  assert.equal(f.host.map.rev, 0);
  assert.deepEqual(f.host.map.capture(), before);
  assert.equal(f.host.actionRequests.debug().executionsStarted, 0);
  assert.equal(f.host.actionRequests.debug().pendingRequestCount, 0);
  assert.equal(f.host.actionRequests.debug().retainedTerminalCount, 0);
});

await check("direct dispatch intentionally bypasses session-origin application authorization", async () => {
  let policyCalls = 0;
  const f = fixture({ authorizeAction() { policyCalls += 1; return false; } });
  const result = await f.host.dispatch_action({ type: "action", id: "direct-set", name: "set", payload: { value: 17 } });
  assert.equal(result.type, "ack");
  assert.equal(policyCalls, 0);
  assert.deepEqual(f.host.map.snap(), { value: 17 });
});

await check("session-origin authorization observes a replacement policy after host creation", async () => {
  const options = {
    map: hson.liveMap.fromJson({ value: 0 }),
    actions: {
      async set(context, value) { await context.mutate((draft) => draft.set(["value"], value)); },
    },
    authorizeAction: () => false,
  };
  const host = hson.locus.create(options);
  const client = connect(host, "replace-policy").client;
  assert.equal((await client.action("set", 18)).error.code, "LOCUS_ACTION_FORBIDDEN");

  options.authorizeAction = () => true;

  assert.equal((await client.action("set", 18)).type, "ack");
  assert.deepEqual(host.map.snap(), { value: 18 });
});

await check("custom application handlers can use external state and emit non-canonical connection events", async () => {
  const applicationState = { deliveries: [] };
  const host = hson.locus.create({
    state: { value: 0 },
    logicalMapId: "application-boundary",
    actions: {
      notify(context, payload, message) {
        applicationState.deliveries.push({ origin: context.origin.kind, payload, action: message.name });
        return { delivered: context.emit_event("application.notice", payload) };
      },
    },
  });
  const { client } = connect(host, "application");
  const events = [];
  client.onEvent((event) => events.push(event));
  const beforeMap = host.map.capture();
  const beforeRev = host.map.rev;
  const beforeHistory = host.stream.history.debug().retainedCommitCount;

  const result = await client.action("notify", { source: "application" });

  assert.equal(result.type, "ack");
  assert.deepEqual(result.result, { delivered: true });
  assert.deepEqual(applicationState.deliveries, [{
    origin: "session",
    payload: { source: "application" },
    action: "notify",
  }]);
  assert.deepEqual(events, [{ type: "event", event: "application.notice", payload: { source: "application" } }]);
  assert.equal(host.map.rev, beforeRev);
  assert.equal(host.stream.headRev, beforeRev);
  assert.equal(host.stream.history.debug().retainedCommitCount, beforeHistory);
  assert.deepEqual(host.map.capture(), beforeMap);
});

process.stdout.write(`# ${checks} Locus authorization checks passed\n`);
testEvents.terminal("pass");
