import assert from "node:assert/strict";
import { hson } from "../../src/index.ts";
import { create_live_trace_collector } from "../../src/diagnostics/index.ts";

let checks = 0;
async function check(name, run) { await run(); process.stdout.write(`ok ${++checks} - ${name}\n`); }
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
function socket_pair() {
  const clientListeners = new Set(), serverListeners = new Set(), clientSent = [], serverSent = [];
  return {
    clientSent, serverSent,
    client: { send(raw) { clientSent.push(raw); for (const fn of serverListeners) fn(raw); }, close() {}, onMessage(fn) { clientListeners.add(fn); return () => clientListeners.delete(fn); }, onClose() { return () => {}; } },
    server: { send(raw) { serverSent.push(raw); for (const fn of clientListeners) fn(raw); }, close() {}, onMessage(fn) { serverListeners.add(fn); return () => serverListeners.delete(fn); }, onClose() { return () => {}; } },
  };
}
function connect(host, clientId) {
  const pair = socket_pair(); let request = 0, attempt = 0;
  host.connect(pair.server);
  const client = hson.liveHost.client({ socket: pair.client, clientId, actionId: () => `${clientId}-request-${++request}`, actionAttemptId: () => `${clientId}-attempt-${++attempt}` });
  client.connect(); return { client, pair };
}
function fixture(options = {}) {
  let executions = 0, session = 0;
  const host = hson.liveHost.create({
    state: { value: 0 }, logicalMapId: "auth-map", incarnationId: "auth-inc", sessionId: () => `session-${++session}`,
    schema: { actions: { set: { payload: (v) => typeof v === "object" && v !== null && !Array.isArray(v) && typeof v.value === "number" }, gated: { payload: (v) => typeof v === "number" } } },
    actions: {
      set(ctx, payload) { executions += 1; ctx.map.set(["value"], payload.value); return payload; },
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
    assert.equal(result.error.code, "LIVEHOST_ACTION_FORBIDDEN"); assert.equal(result.error.message, "LiveHost action is not authorized.");
    assert.equal(f.executions(), 0); assert.deepEqual(f.host.map.capture(), before); assert.equal(f.host.actionRequests.debug().retainedTerminalCount, 0);
  }
});

await check("throw and rejection are safe authorization failures", async () => {
  for (const authorizeAction of [() => { throw new Error("secret-sync"); }, () => Promise.reject(new Error("secret-async"))]) {
    const f = fixture({ authorizeAction }); const result = await connect(f.host, "failure").client.action("set", { value: 6 });
    assert.equal(result.error.code, "LIVEHOST_ACTION_AUTHORIZATION_FAILED"); assert.equal(result.error.message, "LiveHost action authorization failed.");
    assert.equal(JSON.stringify(result).includes("secret"), false); assert.equal(f.executions(), 0); assert.equal(f.host.map.rev, 0);
  }
});

await check("lookup and payload validation precede policy; sessions decide independently", async () => {
  let calls = 0;
  const f = fixture({ authorizeAction(ctx) { calls += 1; return ctx.session.sessionId === "session-1"; } });
  const one = connect(f.host, "one").client, two = connect(f.host, "two").client;
  assert.equal((await one.action("set", { value: "bad" })).error.code, "LIVEHOST_SCHEMA_INVALID_PAYLOAD"); assert.equal(calls, 0);
  assert.equal((await one.action("missing", 1)).error.code, "LIVEHOST_UNKNOWN_ACTION"); assert.equal(calls, 0);
  assert.equal((await one.action("set", { value: 7 })).type, "ack");
  assert.equal((await two.action("set", { value: 8 })).error.code, "LIVEHOST_ACTION_FORBIDDEN"); assert.deepEqual(f.host.map.snap(), { value: 7 });
});

await check("joining attempts authorize separately without cancelling the original", async () => {
  const gate = deferred(); let allow = true, calls = 0;
  const f = fixture({ gate, authorizeAction() { calls += 1; return allow; } });
  const a = connect(f.host, "join").client, b = connect(f.host, "join").client;
  const original = a.action("gated", 9); await Promise.resolve(); allow = false;
  assert.equal((await b.retry_action(original.request)).error.code, "LIVEHOST_ACTION_FORBIDDEN"); assert.equal(f.executions(), 1);
  allow = true; const joined = b.retry_action(original.request); gate.resolve();
  const [first, second] = await Promise.all([original, joined]); assert.equal(first.delivery, "executed"); assert.equal(second.delivery, "joined"); assert.equal(calls, 3);
});

await check("cached attempts reauthorize and policy decisions are not cached", async () => {
  let allow = true, calls = 0; const f = fixture({ authorizeAction() { calls += 1; return allow; } }); const client = connect(f.host, "cache").client;
  const call = client.action("set", { value: 10 }); await call; allow = false;
  assert.equal((await client.retry_action(call.request)).error.code, "LIVEHOST_ACTION_FORBIDDEN"); assert.equal(f.host.actionRequests.debug().retainedTerminalCount, 1);
  allow = true; const cached = await client.retry_action(call.request); assert.equal(cached.delivery, "cached"); assert.equal(f.executions(), 1); assert.equal(calls, 3);
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
  assert.equal((await connect(fixture({ trace, authorizeAction: () => false }).host, "sink-b").client.action("set", { value: 14 })).error.code, "LIVEHOST_ACTION_FORBIDDEN");
});

await check("authorization adds no protocol fields", async () => {
  const f = fixture({ authorizeAction: () => true }); const { client, pair } = connect(f.host, "wire"); await client.action("set", { value: 15 });
  for (const raw of [...pair.clientSent, ...pair.serverSent]) { const value = JSON.parse(raw); for (const key of ["authorizeAction", "authorization", "trace", "traceId"]) assert.equal(key in value, false); }
});

process.stdout.write(`# ${checks} LiveHost authorization checks passed\n`);
