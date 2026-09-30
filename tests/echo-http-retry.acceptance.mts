import assert from "node:assert/strict";
import { bind_locus_http, hsonEcho, hsonLiveMap, hsonLocus } from "../src/index.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "echo.http-retry", title: "HTTP replica physical stream retry discipline",
  category: "Echo", runtime: "node", tags: Object.freeze(["echo", "http", "recovery", "retry"]),
});
const events = create_test_event_emitter("echo.http-retry");
events.case_begin("delayed-retry", "temporary stream-open failures wait and later recover");
const map = hsonLiveMap.fromLibraries({ state: { data: { value: 0 } } });
const locus = hsonLocus.create({ map, libraries: [{ name: "state", ownership: "shared" }],
  defaultProjection: { libraries: ["state"] }, authorizeProjection: () => ({ libraries: ["state"] }) });
const retained = await locus.session.create({ libraries: ["state"] }, { connection: { principalId: "alice" } });
const binder = bind_locus_http(locus, { endpoint: "/_hson" });
let interrupt: (() => void) | undefined;
let wrapNext = true;
let failures = 0;
const failedAt: number[] = [];
let connectionFailures = 0;
const connectionFailedAt: number[] = [];
let openingCount = 0;
const fetcher: typeof fetch = async (input, init) => {
  const message = JSON.parse(String(init?.body)) as { type: string };
  const sync = String(input).endsWith("/sync") && message.type === "recover";
  if (sync) {
    openingCount += 1;
    if (failures > 0) {
      failures -= 1;
      failedAt.push(Date.now());
      return new Response(null, { status: 503 });
    }
    if (connectionFailures > 0) {
      connectionFailures -= 1;
      connectionFailedAt.push(Date.now());
      throw new Error("temporary connection failure");
    }
  }
  const response = await binder.handle(new Request(String(input), init), { principalId: "alice" });
  if (!sync || !wrapNext || response.body === null || response.status !== 200) return response;
  wrapNext = false;
  const reader = response.body.getReader();
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let stopped = false;
  const body = new ReadableStream<Uint8Array>({
    start(target) { controller = target; },
    async pull(target) {
      if (stopped) return;
      try {
        const next = await reader.read();
        if (stopped) return;
        if (next.done) target.close();
        else target.enqueue(next.value);
      } catch (cause) { if (!stopped) target.error(cause); }
    },
    cancel() { stopped = true; void reader.cancel(); },
  });
  interrupt = () => { stopped = true; controller?.error(new Error("temporary stream loss")); void reader.cancel(); };
  return new Response(body, { status: response.status, headers: response.headers });
};
const transport = hsonEcho.transport.http({ endpoint: "https://example.test/_hson", fetch: fetcher });
try {
  const echo = await hsonEcho.create({ now: retained.now(), credential: retained.credential!, transport });
  try {
    assert.equal(echo.sync.status, "caught_up");
    const epoch = echo.session.epoch;
    failures = 3;
    wrapNext = true;
    interrupt?.();
    for (let turn = 0; turn < 550 && (failedAt.length < 3 || echo.sync.status !== "caught_up"); turn += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(failedAt.length, 3);
    assert.ok(failedAt[1]! - failedAt[0]! >= 900, "first physical reopen was not delayed");
    assert.ok(failedAt[2]! - failedAt[1]! >= 900, "second physical reopen was not delayed");
    assert.equal(echo.sync.status, "caught_up");
    assert.equal(echo.session.epoch, epoch);
    connectionFailures = 2;
    wrapNext = true;
    interrupt?.();
    for (let turn = 0; turn < 400 && (connectionFailedAt.length < 2 || echo.sync.status !== "caught_up"); turn += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(connectionFailedAt.length, 2);
    assert.ok(connectionFailedAt[1]! - connectionFailedAt[0]! >= 900, "connection failures retried too quickly");
    assert.equal(echo.sync.status, "caught_up");
    assert.equal(echo.session.epoch, epoch);
    failures = 1;
    interrupt?.();
    for (let turn = 0; turn < 100 && failedAt.length < 4; turn += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(failedAt.length, 4);
    assert.equal(locus.session.get(echo.session.sessionId!)?.revoke(), true);
    assert.equal((await transport.operations.submit({ type: "action-status", id: "fenced",
      clientId: "client", requestId: "request" })).kind, "uncertain");
    const beforeDispose = openingCount;
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert.equal(openingCount, beforeDispose, "ended session restarted synchronization");
    echo.dispose();
    transport.dispose();
  } finally { echo.dispose(); }
  const second = await locus.session.create({ libraries: ["state"] }, { connection: { principalId: "alice" } });
  const disposalTransport = hsonEcho.transport.http({ endpoint: "https://example.test/_hson", fetch: fetcher });
  try {
    wrapNext = true;
    const disposalEcho = await hsonEcho.create({ now: second.now(), credential: second.credential!, transport: disposalTransport });
    try {
      const beforeFailure = failedAt.length;
      failures = 1;
      interrupt?.();
      for (let turn = 0; turn < 100 && failedAt.length === beforeFailure; turn += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(failedAt.length, beforeFailure + 1);
      const beforeDisposal = openingCount;
      disposalEcho.dispose();
      disposalTransport.dispose();
      await new Promise((resolve) => setTimeout(resolve, 1100));
      assert.equal(openingCount, beforeDisposal, "disposal allowed a delayed synchronization retry");
    } finally { disposalEcho.dispose(); }
  } finally { disposalTransport.dispose(); }
  const invalidRetained = await locus.session.create({ libraries: ["state"] }, { connection: { principalId: "alice" } });
  let invalidRecoveryOpens = 0;
  const invalidTransport = hsonEcho.transport.http({ endpoint: "https://example.test/_hson", fetch: async (input, init) => {
    const message = JSON.parse(String(init?.body)) as { type: string };
    if (String(input).endsWith("/sync") && message.type === "recover") {
      invalidRecoveryOpens += 1;
      return new Response("proxy page", { headers: { "content-type": "text/plain" } });
    }
    return binder.handle(new Request(String(input), init), { principalId: "alice" });
  } });
  try {
    await assert.rejects(hsonEcho.create({ now: invalidRetained.now(), credential: invalidRetained.credential!,
      transport: invalidTransport }));
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert.equal(invalidRecoveryOpens, 1, "protocol-invalid stream response retried");
  } finally { invalidTransport.dispose(); }
} finally { transport.dispose(); binder.dispose(); locus.dispose(); }
events.case_end("delayed-retry", "pass");
events.terminal("pass");
