import assert from "node:assert/strict";
import { Hson, hson, type HsonCanonical, type HsonData } from "../src/index.ts";
import { decode_locus_message } from "../src/api/locus/locus.protocol.ts";

function entries(value: HsonData | undefined): readonly (readonly [string, HsonData])[] | undefined {
  return value === undefined ? undefined : Hson.data.entries(value);
}
function materialize(value: HsonData | undefined): unknown {
  return value === undefined ? undefined : Hson.data.materialize(value);
}

function socket_pair() {
  const clientListeners = new Set<(raw: string) => void>();
  const serverListeners = new Set<(raw: string) => void>();
  const clientSent: string[] = [];
  return {
    clientSent,
    client: {
      send(raw: string) { clientSent.push(raw); for (const listener of serverListeners) listener(raw); },
      close() {},
      onMessage(listener: (raw: string) => void) { clientListeners.add(listener); return () => clientListeners.delete(listener); },
      onClose() { return () => {}; },
    },
    server: {
      send(raw: string) { for (const listener of clientListeners) listener(raw); },
      close() {},
      onMessage(listener: (raw: string) => void) { serverListeners.add(listener); return () => serverListeners.delete(listener); },
      onClose() { return () => {}; },
    },
  };
}

const pair = socket_pair();
let schemaValue: HsonData | undefined;
let authorizationValue: HsonData | undefined;
let handlerValue: HsonData | undefined;
let transformedAuthorization: HsonData | undefined;
let transformedHandler: HsonData | undefined;
let invalidTransformAuthorizations = 0;
let reservedTransformAuthorizations = 0;
let authorizationCalls = 0;
let executions = 0;
const locus = hson.locus.create({
  state: {},
  logicalMapId: "exact-action-data",
  actions: {
    echo(_context, payload) {
      executions += 1;
      handlerValue = payload;
      return payload;
    },
    transformed(_context, payload) {
      transformedHandler = payload;
      return payload;
    },
    transformedExact(_context, payload) { return payload; },
    invalidTransform() { return null; },
    reservedTransform() { return null; },
    reservedResult() { executions += 1; return { _hson_root: true }; },
    hsonSchema(_context, payload) { return payload; },
  },
  schema: {
    actions: {
      echo: {
        payload(value) {
          if (value === undefined) return { ok: true, value };
          if (typeof value !== "string") return { ok: false, issues: ["not exact data"] };
          schemaValue = Hson.data.fromHson(value as HsonCanonical);
          return { ok: true, value };
        },
      },
      transformed: { payload: () => ({ ok: true, value: { b: 2, a: 1 } }) },
      transformedExact: { payload: () => ({ ok: true, value: Hson.data.fromHson(Hson.canonical`<z -0 y true>`) }) },
      invalidTransform: { payload: () => ({ ok: true, value: new Date() }) },
      reservedTransform: { payload: () => ({ ok: true, value: { _hson_obj: true } }) },
      hsonSchema: { payload: Hson.schema`<type "data" content <value "number">>` },
    },
  },
  authorizeAction(context) {
    authorizationCalls += 1;
    if (context.action === "transformed") transformedAuthorization = context.payload;
    if (context.action === "invalidTransform") invalidTransformAuthorizations += 1;
    if (context.action === "reservedTransform") reservedTransformAuthorizations += 1;
    authorizationValue = context.payload;
    if (context.action === "echo" && context.payload !== undefined && entries(context.payload) !== undefined) {
      const names = entries(context.payload)?.map(([name]) => name);
      if (names?.includes("__proto__")) {
        const ordinary = materialize(context.payload) as Record<string, unknown>;
        assert.equal(Object.getPrototypeOf(ordinary), Object.prototype);
        assert.equal(Object.hasOwn(ordinary, "__proto__"), true);
        assert.equal(Object.hasOwn(ordinary, "polluted"), false);
        assert.equal(ordinary.polluted, undefined);
      }
    }
    return true;
  },
});
locus.connect(pair.server);
const echo = hson.echo.create({ socket: pair.client, clientId: "exact-action-client" });
echo.connect();
await echo.session.create();

const map = hson.liveMap.fromHson(Hson.canonical`<payload <'10' -0 '2' <nested <__proto__ <constructor 1 prototype 2>>> __proto__ <polluted true> tail [0,-0]>>`);
if (map.mode === "document") throw new Error("Expected data LiveMap.");
const source = map.at(["payload"]).data()!;
assert.equal(typeof source, "string");

const call = echo.action("echo", source);
assert.equal(call.request.payload, source);
const first = await call;
assert.equal(first.type, "ack");
if (first.type !== "ack" || first.result === undefined) throw new Error("Expected exact result data.");
assert.equal(source, schemaValue);
assert.equal(schemaValue, authorizationValue);
assert.equal(authorizationValue, handlerValue);
assert.equal(source, first.result);
assert.deepEqual(entries(source)?.map(([name]) => name), ["10", "2", "__proto__", "tail"]);
assert.equal(Object.is(materialize(entries(source)?.[0]?.[1]), -0), true);
assert.equal(Object.hasOwn(materialize(entries(entries(source)?.[1]?.[1])?.[0]?.[1]) as object, "__proto__"), true);
assert.equal(entries(source)?.[2]?.[0], "__proto__");

const actionWire = JSON.parse(pair.clientSent.find((raw) => JSON.parse(raw).type === "action") as string);
assert.equal(typeof actionWire.payloadData, "string");
assert.equal(Object.hasOwn(actionWire, "payload"), false);

const cached = await echo.retryAction(call.request);
assert.equal(cached.type, "ack");
if (cached.type !== "ack" || cached.result === undefined) throw new Error("Expected cached exact result.");
assert.equal(cached.delivery, "cached");
assert.equal(cached.result, first.result);
assert.equal(executions, 1);

const status = await echo.actionStatus(call.request.requestId);
assert.equal(status.state, "succeeded");
assert.equal(status.outcome?.state, "succeeded");
if (status.outcome?.state !== "succeeded" || status.outcome.result === undefined) throw new Error("Expected retained exact result.");
assert.equal(status.outcome.result, first.result);

const mutable = { nested: { value: 1 } };
const snapshotted = echo.action("echo", mutable);
mutable.nested.value = 9;
assert.equal(materialize(entries(entries(snapshotted.request.payload as HsonData)?.[0]?.[1])?.[0]?.[1]), 1);
const snapshottedResult = await snapshotted;
assert.equal(snapshottedResult.type === "ack" && materialize(entries(entries(snapshottedResult.result)?.[0]?.[1])?.[0]?.[1]), 1);

const orderConflict = await echo.retryAction({
  requestId: call.request.requestId,
  name: "echo",
  payload: Hson.data.fromHson(Hson.canonical`<'2' <nested <__proto__ <constructor 1 prototype 2>>> '10' -0 __proto__ <polluted true> tail [0,-0]>`),
});
assert.equal(orderConflict.type, "error");
if (orderConflict.type === "error") assert.equal(orderConflict.error.code, "LOCUS_ACTION_REQUEST_ID_CONFLICT");

const zero = echo.action("echo", 0);
await zero;
const signedZeroConflict = await echo.retryAction({ requestId: zero.request.requestId, name: "echo", payload: -0 });
assert.equal(signedZeroConflict.type, "error");
if (signedZeroConflict.type === "error") assert.equal(signedZeroConflict.error.code, "LOCUS_ACTION_REQUEST_ID_CONFLICT");

const absent = echo.action("echo");
await absent;
const nullConflict = await echo.retryAction({ requestId: absent.request.requestId, name: "echo", payload: null });
assert.equal(nullConflict.type, "error");
if (nullConflict.type === "error") assert.equal(nullConflict.error.code, "LOCUS_ACTION_REQUEST_ID_CONFLICT");

const observableResults = await Promise.all([
  echo.action("echo"),
  echo.action("echo", null),
  echo.action("echo", 0),
  echo.action("echo", -0),
  echo.action("echo", {}),
  echo.action("echo", []),
]);
assert.equal(observableResults[0].type === "ack" && observableResults[0].result, undefined);
assert.equal(observableResults[1].type === "ack" && materialize(observableResults[1].result), null);
assert.equal(Object.is(observableResults[2].type === "ack" && materialize(observableResults[2].result), 0), true);
assert.equal(Object.is(observableResults[3].type === "ack" && materialize(observableResults[3].result), -0), true);
assert.deepEqual(observableResults[4].type === "ack" && entries(observableResults[4].result), []);
assert.deepEqual(observableResults[5].type === "ack" && materialize(observableResults[5].result), []);

const malformed = decode_locus_message(JSON.stringify({
  type: "action", id: "bad", name: "echo", payloadData: " {\"a\":1}",
}));
assert.equal(malformed.ok, false);
const authorizationsBeforeMalformed = authorizationCalls;
const executionsBeforeMalformed = executions;
const retainedBeforeMalformed = locus.actionRequests.debug().retainedTerminalCount;
pair.client.send(JSON.stringify({
  type: "action",
  id: "bad-wire",
  name: "echo",
  clientId: echo.clientId,
  requestId: "bad-wire-request",
  attemptId: "bad-wire-attempt",
  payloadData: " {\"a\":1}",
}));
pair.client.send(JSON.stringify({
  type: "action",
  id: "legacy-wire",
  name: "echo",
  payload: { a: 1 },
}));
assert.equal(authorizationCalls, authorizationsBeforeMalformed);
assert.equal(locus.actionRequests.debug().retainedTerminalCount, retainedBeforeMalformed);

assert.throws(() => echo.action("echo", { _hson_root: true }), /Reserved Hson prefix/);
pair.client.send(JSON.stringify({
  type: "action",
  id: "reserved-wire",
  name: "echo",
  clientId: echo.clientId,
  requestId: "reserved-wire-request",
  attemptId: "reserved-wire-attempt",
  payloadData: "{\n  \"_hson_root\": true\n}",
}));
assert.equal(authorizationCalls, authorizationsBeforeMalformed);
assert.equal(executions, executionsBeforeMalformed);
assert.equal(locus.actionRequests.debug().retainedTerminalCount, retainedBeforeMalformed);

const transformed = await echo.action("transformed", { original: true });
assert.equal(transformed.type, "ack");
assert.deepEqual(entries(transformedAuthorization)?.map(([name]) => name), ["b", "a"]);
assert.equal(transformedAuthorization, transformedHandler);
const transformedExact = await echo.action("transformedExact", 1);
assert.equal(transformedExact.type, "ack");
if (transformedExact.type === "ack") {
  assert.deepEqual(entries(transformedExact.result)?.map(([name]) => name), ["z", "y"]);
  assert.equal(Object.is(materialize(entries(transformedExact.result)?.[0]?.[1]), -0), true);
}
const invalidTransform = await echo.action("invalidTransform", 1);
assert.equal(invalidTransform.type, "error");
if (invalidTransform.type === "error") assert.equal(invalidTransform.error.code, "LOCUS_SCHEMA_INVALID_PAYLOAD");
assert.equal(invalidTransformAuthorizations, 0);
const reservedTransform = await echo.action("reservedTransform", 1);
assert.equal(reservedTransform.type, "error");
if (reservedTransform.type === "error") assert.equal(reservedTransform.error.code, "LOCUS_SCHEMA_INVALID_PAYLOAD");
assert.equal(reservedTransformAuthorizations, 0);
const reservedResult = await echo.action("reservedResult", 1);
assert.equal(reservedResult.type, "error");
if (reservedResult.type === "error") assert.equal(reservedResult.error.code, "LOCUS_ACTION_OUTCOME_NORMALIZATION_FAILED");
assert.equal((await echo.action("hsonSchema", { value: -0 })).type, "ack");
const hsonSchemaInvalid = await echo.action("hsonSchema", { value: "no" });
assert.equal(hsonSchemaInvalid.type, "error");
if (hsonSchemaInvalid.type === "error") assert.equal(hsonSchemaInvalid.error.code, "LOCUS_SCHEMA_INVALID_PAYLOAD");

echo.dispose();
locus.dispose();
process.stdout.write("ok 1 - exact configured action data is symmetric through schema, authorization, execution, retention, retry, status, and dedupe\n1..1\n");
