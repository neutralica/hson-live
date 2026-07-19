import assert from "node:assert/strict";
import { hson } from "../src/index.ts";
import {
  create_live_trace_collector,
  create_live_trace_console_sink,
} from "../src/diagnostics/index.ts";
import { create_live_trace_context } from "../src/api/livehost/livehost.trace.ts";

let checks = 0;
async function check(name, fn) {
  await fn();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function socket_pair() {
  const clientMessages = new Set();
  const serverMessages = new Set();
  const clientSent = [];
  const serverSent = [];
  const client = {
    send(raw) { clientSent.push(raw); for (const listener of [...serverMessages]) listener(raw); },
    close() {},
    onMessage(listener) { clientMessages.add(listener); return () => clientMessages.delete(listener); },
    onClose() { return () => {}; },
  };
  const server = {
    send(raw) { serverSent.push(raw); for (const listener of [...clientMessages]) listener(raw); },
    close() {},
    onMessage(listener) { serverMessages.add(listener); return () => serverMessages.delete(listener); },
    onClose() { return () => {}; },
  };
  return { client, server, clientSent, serverSent };
}

function fixture(trace, identity = {}) {
  const pair = socket_pair();
  const host = hson.liveHost.create({
    state: { value: 0 },
    logicalMapId: "trace-map",
    incarnationId: "trace-incarnation",
    sessionId: "trace-session",
    ...(trace !== undefined ? { trace } : {}),
    schema: {
      actions: {
        update: {
          payload(value) {
            return typeof value === "object"
              && value !== null
              && !Array.isArray(value)
              && typeof value.value === "number"
              && typeof value.secret === "string";
          },
        },
      },
    },
    actions: {
      update(ctx, payload) {
        ctx.map.set(["value"], payload.value);
        return { accepted: true };
      },
    },
  });
  host.connect(pair.server);
  const client = hson.liveHost.client({
    socket: pair.client,
    clientId: "trace-client",
    actionId: identity.actionId ?? (() => "request-1"),
    actionAttemptId: identity.actionAttemptId ?? (() => "attempt-1"),
  });
  client.connect();
  return { host, client, pair };
}

async function run_success(trace) {
  const f = fixture(trace);
  const result = await f.client.action("update", { value: 2, secret: "payload-secret" });
  return {
    ...f,
    result,
    state: f.host.map.snap(),
    rev: f.host.map.rev,
    history: f.host.stream.history.replay_after(0, f.host.stream.headRev),
  };
}

await check("disabled tracing leaves behavior and ordinary output untouched", async () => {
  let writes = 0;
  const disabled = await run_success(undefined);
  assert.equal(writes, 0);
  assert.equal(disabled.result.type, "ack");
  assert.deepEqual(disabled.state, { value: 2 });
  assert.equal(disabled.rev, 1);
  assert.equal(disabled.history?.length, 1);
});

await check("successful remote action emits ordered redacted lifecycle events", async () => {
  const collector = create_live_trace_collector({ capacity: 64 });
  const traced = await run_success(collector);
  const events = collector.events();
  assert.ok(events.length > 0);
  const traceIds = new Set(events.map((event) => event.traceId));
  assert.equal(traceIds.size, 1);
  const [traceId] = traceIds;
  assert.match(traceId, /^lht-[a-z0-9]+-[a-z0-9]+$/);
  assert.notEqual(traceId, "attempt-1");
  assert.notEqual(traceId, "request-1");
  assert.deepEqual(events.map((event) => event.sequence), events.map((_, index) => index + 1));
  const phases = events.map((event) => `${event.phase}:${event.status}`);
  for (const expected of [
    "action.received:event",
    "action.envelope:success",
    "session.resolve:success",
    "action.execute:begin",
    "action.lookup:success",
    "payload.validation:success",
    "handler.execute:success",
    "state.transition:event",
    "response.dispatch:success",
    "subscription.publication:success",
    "action.execute:success",
  ]) assert.ok(phases.includes(expected), `missing ${expected}`);

  const transition = events.find((event) => event.phase === "state.transition");
  assert.deepEqual(transition?.details, {
    changed: true,
    prevRev: 0,
    rev: 1,
    historyAvailable: true,
    commitCount: 1,
    operationCount: 1,
    operationKinds: ["set"],
  });
  const serialized = JSON.stringify(events);
  assert.equal(serialized.includes("payload-secret"), false);
  assert.equal(serialized.includes('"payload"'), false);
  assert.equal(serialized.includes('"result"'), false);
  assert.equal(serialized.includes('"root"'), false);
  assert.equal(serialized.includes('"credential"'), false);

  const begins = events.filter((event) => event.status === "begin");
  for (const begin of begins) {
    const terminal = events.find((event) => event.spanId === begin.spanId && ["success", "failure", "skip"].includes(event.status));
    assert.ok(terminal);
    assert.ok(terminal.sequence > begin.sequence);
    assert.ok((terminal.durationMs ?? -1) >= 0);
  }
  const root = begins.find((event) => event.phase === "action.execute");
  const child = begins.find((event) => event.phase === "handler.execute");
  assert.equal(child?.parentSpanId, root?.spanId);
  assert.equal(traced.rev, 1);
});

await check("schema rejection traces the rejecting stage without reaching handler or mutation", async () => {
  const collector = create_live_trace_collector({ capacity: 64 });
  const f = fixture(collector);
  const before = f.host.map.capture();
  const result = await f.client.action("update", { value: "invalid", secret: "rejection-secret" });
  assert.equal(result.type, "error");
  assert.equal(result.error.code, "LIVEHOST_SCHEMA_INVALID_PAYLOAD");
  assert.deepEqual(f.host.map.capture(), before);
  const events = collector.events();
  const rejection = events.find((event) => event.phase === "payload.validation" && event.status === "failure");
  assert.equal(rejection?.details?.errorCode, "LIVEHOST_SCHEMA_INVALID_PAYLOAD");
  assert.equal(events.some((event) => event.phase === "handler.execute"), false);
  assert.equal(events.some((event) => event.phase === "state.transition"), false);
  assert.equal(events.some((event) => event.phase === "action.execute" && event.status === "failure"), true);
  assert.equal(JSON.stringify(events).includes("rejection-secret"), false);
});

await check("throwing sinks and writers cannot affect success or rejection semantics", async () => {
  const throwing = { emit() { throw new Error("sink failed"); } };
  const off = await run_success(undefined);
  const on = await run_success(throwing);
  assert.deepEqual(on.result, off.result);
  assert.deepEqual(on.state, off.state);
  assert.equal(on.rev, off.rev);
  assert.deepEqual(on.history, off.history);
  assert.deepEqual(on.pair.serverSent, off.pair.serverSent);

  const writerFailure = fixture(create_live_trace_console_sink({ write() { throw new Error("writer failed"); } }));
  const writerResult = await writerFailure.client.action("update", { value: 3, secret: "writer-secret" });
  assert.equal(writerResult.type, "ack");
  assert.deepEqual(writerFailure.host.map.snap(), { value: 3 });

  const rejected = fixture(throwing);
  const rejectedResult = await rejected.client.action("update", { value: false, secret: "sink-secret" });
  assert.equal(rejectedResult.type, "error");
  assert.equal(rejectedResult.error.code, "LIVEHOST_SCHEMA_INVALID_PAYLOAD");
  assert.equal(rejected.host.map.rev, 0);
});

await check("collector is bounded, detached, ordered, clearable, and validates capacity", () => {
  for (const capacity of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => create_live_trace_collector({ capacity }), /positive finite integer/);
  }
  const collector = create_live_trace_collector({ capacity: 2 });
  const mutableDetails = { count: 1, kinds: ["one"] };
  for (let sequence = 1; sequence <= 3; sequence += 1) {
    collector.emit({
      traceId: "collector",
      sequence,
      subsystem: "livehost",
      phase: "collector.test",
      status: "event",
      timestamp: sequence,
      details: mutableDetails,
    });
  }
  mutableDetails.count = 99;
  mutableDetails.kinds.push("changed");
  const retained = collector.events();
  assert.deepEqual(retained.map((event) => event.sequence), [2, 3]);
  assert.deepEqual(retained[0].details, { count: 1, kinds: ["one"] });
  assert.throws(() => retained.push(retained[0]));
  assert.throws(() => retained[0].details.kinds.push("mutated"));
  assert.deepEqual(collector.events().map((event) => event.sequence), [2, 3]);
  collector.clear();
  assert.deepEqual(collector.events(), []);
});

await check("trace clocks and detail summarizers are failure-isolated", () => {
  const collector = create_live_trace_collector({ capacity: 4 });
  const trace = create_live_trace_context(collector, "safe-summary", () => { throw new Error("clock failed"); });
  trace.emit({
    subsystem: "livehost",
    phase: "summary.failure",
    status: "event",
    details: () => { throw new Error("summary failed"); },
  });
  assert.deepEqual(collector.events(), [{
    traceId: "safe-summary",
    sequence: 1,
    subsystem: "livehost",
    phase: "summary.failure",
    status: "event",
    timestamp: 0,
  }]);
});

await check("console sink is explicit, compact, correlated, and redacts unsafe text", () => {
  const lines = [];
  const sink = create_live_trace_console_sink({ write: (line) => lines.push(line) });
  assert.deepEqual(lines, []);
  sink.emit({
    traceId: "console-trace",
    sequence: 7,
    subsystem: "livehost",
    phase: "payload.validation",
    status: "failure",
    timestamp: 10,
    durationMs: 2,
    details: { action: "update", errorCode: "LIVEHOST_SCHEMA_INVALID_PAYLOAD", payload: "console-secret" },
  });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\[trace console-trace #07\] livehost payload\.validation failure 2\.0ms/);
  assert.match(lines[0], /action=update/);
  assert.match(lines[0], /errorCode=LIVEHOST_SCHEMA_INVALID_PAYLOAD/);
  assert.equal(lines[0].includes("console-secret"), false);
});

await check("tracing does not alter action protocol envelopes", async () => {
  const collector = create_live_trace_collector({ capacity: 64 });
  const off = await run_success(undefined);
  const on = await run_success(collector);
  assert.deepEqual(on.pair.clientSent, off.pair.clientSent);
  assert.deepEqual(on.pair.serverSent, off.pair.serverSent);
  for (const raw of on.pair.clientSent.concat(on.pair.serverSent)) {
    const value = JSON.parse(raw);
    assert.equal("trace" in value, false);
    assert.equal("traceId" in value, false);
  }
});

await check("host trace identity is distinct per processing attempt despite retries and reused client attempt IDs", async () => {
  const collector = create_live_trace_collector({ capacity: 128 });
  let request = 0;
  const f = fixture(collector, {
    actionId: () => `request-${++request}`,
    actionAttemptId: () => "client-attempt-reused",
  });

  const firstCall = f.client.action("update", { value: 1, secret: "first-secret" });
  const first = await firstCall;
  const second = await f.client.action("update", { value: 2, secret: "second-secret" });
  const cached = await f.client.retry_action(firstCall.request);
  assert.equal(first.delivery, "executed");
  assert.equal(second.delivery, "executed");
  assert.equal(cached.delivery, "cached");

  const events = collector.events();
  const traceIds = [...new Set(events.map((event) => event.traceId))];
  assert.equal(traceIds.length, 3);
  assert.ok(traceIds.every((traceId) => traceId.startsWith("lht-")));
  const serialized = JSON.stringify(events);
  assert.equal(serialized.includes("client-attempt-reused"), false);
  assert.equal(serialized.includes("request-1"), false);
  assert.equal(serialized.includes("request-2"), false);

  const grouped = traceIds.map((traceId) => events.filter((event) => event.traceId === traceId));
  assert.deepEqual(
    grouped.map((traceEvents) => traceEvents.map((event) => event.sequence)),
    grouped.map((traceEvents) => traceEvents.map((_, index) => index + 1)),
  );
  assert.equal(
    grouped.filter((traceEvents) => traceEvents.some((event) => event.phase === "handler.execute")).length,
    2,
  );
  const cachedTrace = grouped.find((traceEvents) =>
    traceEvents.some((event) => event.details?.delivery === "cached"));
  assert.ok(cachedTrace);
  assert.equal(cachedTrace.some((event) => event.phase === "handler.execute"), false);
});

process.stdout.write(`# ${checks} LiveHost trace checks passed\n`);
