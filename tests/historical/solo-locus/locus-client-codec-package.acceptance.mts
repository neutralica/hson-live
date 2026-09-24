import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "locus.client-codec-package",
  title: "Packed public Locus client codec",
  category: "Locus",
  runtime: "node",
  tags: Object.freeze(["locus", "protocol", "package", "exact-data", "public-api"]),
});

const testEvents = create_test_event_emitter("locus.client-codec-package");
const caseId = "packed external client encodes exact actions through the public Locus wire boundary";
testEvents.case_begin(caseId, caseId);

const repositoryRoot = resolve(import.meta.dirname, "..");
const temporaryParent = resolve(repositoryRoot, "tmp");
mkdirSync(temporaryParent, { recursive: true });
const consumerRoot = mkdtempSync(join(temporaryParent, "locus-client-codec-consumer-"));

try {
  const packed = spawnSync("npm", [
    "pack",
    "--json",
    "--pack-destination",
    consumerRoot,
    "--cache",
    join(consumerRoot, "npm-cache"),
  ], { cwd: repositoryRoot, encoding: "utf8" });
  assert.equal(packed.status, 0, packed.stderr);
  const report = JSON.parse(packed.stdout) as ReadonlyArray<{ filename?: unknown }>;
  const archiveName = report[0]?.filename;
  assert.equal(typeof archiveName, "string", "npm pack did not report an artifact filename");

  const packageRoot = join(consumerRoot, "node_modules", "hson-live");
  mkdirSync(packageRoot, { recursive: true });
  const extracted = spawnSync("tar", [
    "-xzf",
    join(consumerRoot, archiveName as string),
    "--strip-components=1",
    "-C",
    packageRoot,
  ], { cwd: consumerRoot, encoding: "utf8" });
  assert.equal(extracted.status, 0, extracted.stderr);
  writeFileSync(join(consumerRoot, "package.json"), JSON.stringify({ private: true, type: "module" }));

  const typeConsumer = join(consumerRoot, "consumer.mts");
  writeFileSync(typeConsumer, `
    import { Hson } from "hson-live/hson";
    import {
      decode_locus_message,
      decode_locus_server_message,
      encode_locus_client_message,
      encode_locus_message,
      type LocusClientMessage,
      type LocusServerMessage,
      type LocusSocketLike,
    } from "hson-live/locus";

    type Actions = Readonly<{ exact: { value: number } }>;
    const payload = Hson.data.from({ value: -0 });
    const message: LocusClientMessage<Actions> = {
      type: "action", id: "action", name: "exact", payload,
    };
    const wire: string = encode_locus_client_message(message);
    declare const socket: LocusSocketLike;
    socket.send(wire);
    void decode_locus_message<Actions>(wire);
    declare const serverMessage: LocusServerMessage;
    void decode_locus_server_message(encode_locus_message(serverMessage));
  `);
  const typecheck = spawnSync(resolve(repositoryRoot, "node_modules/.bin/tsc"), [
    "--noEmit",
    "--strict",
    "--target", "ES2022",
    "--module", "NodeNext",
    "--moduleResolution", "NodeNext",
    "--lib", "ES2022,DOM,DOM.Iterable",
    typeConsumer,
  ], { cwd: consumerRoot, encoding: "utf8" });
  assert.equal(typecheck.status, 0, typecheck.stdout + typecheck.stderr);

  const runtimeConsumer = join(consumerRoot, "consumer.mjs");
  writeFileSync(runtimeConsumer, `
    import assert from "node:assert/strict";
    import { Hson } from "hson-live/hson";
    import * as root from "hson-live";
    import {
      create_locus,
      decode_locus_message,
      decode_locus_server_message,
      encode_locus_client_message,
      encode_locus_message,
    } from "hson-live/locus";

    assert.equal(typeof encode_locus_client_message, "function");
    assert.equal("encode_locus_client_message" in root, false);

    function socket_pair() {
      const clientMessages = new Set();
      const serverMessages = new Set();
      const clientCloses = new Set();
      const serverCloses = new Set();
      return Object.freeze({
        client: Object.freeze({
          send(raw) { for (const listener of [...serverMessages]) listener(raw); },
          close() { for (const listener of [...clientCloses]) listener(); },
          onMessage(listener) { clientMessages.add(listener); return () => clientMessages.delete(listener); },
          onClose(listener) { clientCloses.add(listener); return () => clientCloses.delete(listener); },
        }),
        server: Object.freeze({
          send(raw) { for (const listener of [...clientMessages]) listener(raw); },
          close() { for (const listener of [...serverCloses]) listener(); },
          onMessage(listener) { serverMessages.add(listener); return () => serverMessages.delete(listener); },
          onClose(listener) { serverCloses.add(listener); return () => serverCloses.delete(listener); },
        }),
      });
    }

    const exact = Hson.data.fromHson(Hson.data\`<'10' -0 '2' <nested <__proto__ <constructor 1 prototype 2>>> __proto__ <polluted true> tail [0,-0,null]>\`);
    assert.deepEqual(Hson.data.entries(exact).map(([name]) => name), ["10", "2", "__proto__", "tail"]);
    assert.equal(Object.is(Hson.data.materialize(Hson.data.entries(exact)[0][1]), -0), true);

    let authorizationCalls = 0;
    let exactExecutions = 0;
    let deniedExecutions = 0;
    let authorizationPayload;
    let handlerPayload;
    const locus = create_locus({
      state: {},
      logicalMapId: "packed-client-codec",
      incarnationId: "packed-client-codec-incarnation",
      actions: {
        exact(_context, payload) { exactExecutions += 1; handlerPayload = payload; return payload; },
        denied() { deniedExecutions += 1; },
      },
      authorizeAction(context) {
        authorizationCalls += 1;
        if (context.action === "exact") authorizationPayload = context.payload;
        return context.action !== "denied";
      },
    });
    const pair = socket_pair();
    const disconnect = locus.connect(pair.server);
    const received = [];
    const waiters = [];
    pair.client.onMessage((raw) => {
      const decoded = decode_locus_server_message(raw);
      assert.equal(decoded.ok, true, decoded.ok ? "" : decoded.error.message);
      const message = decoded.value;
      const waiterIndex = waiters.findIndex((waiter) => waiter.type === message.type);
      if (waiterIndex === -1) received.push(message);
      else waiters.splice(waiterIndex, 1)[0].resolve(message);
    });
    function next(type) {
      const existing = received.findIndex((message) => message.type === type);
      if (existing !== -1) return Promise.resolve(received.splice(existing, 1)[0]);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Timed out waiting for " + type)), 2_000);
        waiters.push({ type, resolve(message) { clearTimeout(timer); resolve(message); } });
      });
    }

    pair.client.send(encode_locus_client_message({ type: "session-create", id: "session" }));
    const session = await next("session-created");
    assert.equal(session.logicalMapId, locus.stream.logicalMapId);
    assert.equal(session.incarnationId, locus.stream.incarnationId);

    const semanticAction = {
      type: "action",
      id: "attempt-exact",
      requestId: "request-exact",
      attemptId: "attempt-exact",
      clientId: "packed-client",
      name: "exact",
      payload: exact,
    };
    const actionWire = encode_locus_client_message(semanticAction);
    const actionEnvelope = JSON.parse(actionWire);
    assert.equal(typeof actionEnvelope.payloadData, "string");
    assert.equal(Object.hasOwn(actionEnvelope, "payload"), false);
    const decodedAction = decode_locus_message(actionWire);
    assert.equal(decodedAction.ok, true, decodedAction.ok ? "" : decodedAction.error.message);
    assert.equal(decodedAction.value.payload === exact, true);

    pair.client.send(actionWire);
    const acknowledged = await next("ack");
    assert.equal(acknowledged.result === exact, true);
    assert.equal(authorizationPayload === exact, true);
    assert.equal(handlerPayload === exact, true);
    assert.equal(exactExecutions, 1);
    const serverRoundTrip = decode_locus_server_message(encode_locus_message(acknowledged));
    assert.equal(serverRoundTrip.ok, true);
    assert.equal(serverRoundTrip.value.result === exact, true);

    pair.client.send(encode_locus_client_message({
      type: "action",
      id: "attempt-denied",
      requestId: "request-denied",
      attemptId: "attempt-denied",
      clientId: "packed-client",
      name: "denied",
      payload: null,
    }));
    const denied = await next("error");
    assert.equal(denied.error.code, "LOCUS_ACTION_FORBIDDEN");
    assert.equal(deniedExecutions, 0);

    const malformed = [
      JSON.stringify({ type: "action", id: "legacy", name: "exact", payload: { value: 1 } }),
      JSON.stringify({ type: "action", id: "malformed", name: "exact", payloadData: "{" }),
      JSON.stringify({ type: "action", id: "noncanonical", name: "exact", payloadData: " {\\"value\\":1}" }),
      JSON.stringify({ type: "action", id: "invalid", name: "exact", payloadData: "{\\n  \\"value\\": 1,\\n  \\"value\\": 2\\n}" }),
    ];
    const authorizationBeforeMalformed = authorizationCalls;
    const executionBeforeMalformed = exactExecutions;
    for (const raw of malformed) {
      assert.equal(decode_locus_message(raw).ok, false);
      pair.client.send(raw);
    }
    assert.equal(authorizationCalls, authorizationBeforeMalformed);
    assert.equal(exactExecutions, executionBeforeMalformed);

    disconnect();
    locus.dispose();
    process.stdout.write("packed Locus client codec exact transport passed\\n");
  `);
  const runtime = spawnSync(process.execPath, [runtimeConsumer], { cwd: consumerRoot, encoding: "utf8" });
  assert.equal(runtime.status, 0, runtime.stdout + runtime.stderr);
  assert.match(runtime.stdout, /exact transport passed/);

  testEvents.case_end(caseId, "pass");
  process.stdout.write("ok 1 - packed public Locus client codec preserves exact transport and authority boundaries\n1..1\n");
  testEvents.terminal("pass");
} catch (error) {
  const message = error instanceof Error ? error.message : "Packed Locus client codec acceptance failed.";
  testEvents.diagnostic(caseId, "assertion", message.slice(0, 1_000));
  testEvents.case_end(caseId, "fail");
  testEvents.terminal("fail");
  throw error;
} finally {
  rmSync(consumerRoot, { recursive: true, force: true });
}
