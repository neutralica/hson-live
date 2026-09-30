import assert from "node:assert/strict";
import { bind_locus_http, hsonLiveMap, hsonLocus } from "../src/index.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "echo.http-binder-lifecycle", title: "HTTP binder establishment, stream, and lease fencing",
  category: "Echo", runtime: "node", tags: Object.freeze(["echo", "http", "locus", "lifecycle"]),
});
const events = create_test_event_emitter("echo.http-binder-lifecycle");
const url = "https://example.test/_hson";
const context = { principalId: "alice" };
const request = (body: unknown, token?: string, sync = false): Request => new Request(`${url}${sync ? "/sync" : ""}`, {
  method: "POST", headers: { "content-type": "application/json", ...(token ? { "x-hson-attachment": token } : {}) },
  body: JSON.stringify(body),
});
const waitEnd = async (reader: ReadableStreamDefaultReader<Uint8Array>): Promise<boolean> => {
  for (let turn = 0; turn < 20; turn += 1) {
    const next = await Promise.race([reader.read(), new Promise<null>((resolve) => setTimeout(() => resolve(null), 10))]);
    if (next === null) return false;
    if (next.done) return true;
  }
  return false;
};

events.case_begin("pending-create", "dispose fences asynchronous session establishment");
let releaseAuthorizer: (() => void) | undefined;
let authorizerEntered: (() => void) | undefined;
const entered = new Promise<void>((resolve) => { authorizerEntered = resolve; });
const gate = new Promise<void>((resolve) => { releaseAuthorizer = resolve; });
const map = hsonLiveMap.fromLibraries({ state: { data: 0 } });
const locus = hsonLocus.create({ map, libraries: [{ name: "state", ownership: "shared" }],
  defaultProjection: { libraries: ["state"] }, authorizeProjection: async ({ requested }) => {
    authorizerEntered?.();
    await gate;
    return { libraries: requested.libraries };
  } });
const binder = bind_locus_http(locus, { endpoint: "/_hson" });
try {
  const pending = binder.handle(request({ type: "session-create", id: "create" }), context);
  await entered;
  binder.dispose();
  binder.dispose();
  releaseAuthorizer?.();
  const response = await pending;
  assert.equal(response.status, 503);
  assert.equal(response.headers.has("x-hson-attachment"), false);
  assert.equal(locus.session.debug().attachedSessionCount, 0);
} finally { releaseAuthorizer?.(); binder.dispose(); locus.dispose(); }
events.case_end("pending-create", "pass");

events.case_begin("pending-attach", "dispose before an attach body arrives cannot advance its session");
const attachMap = hsonLiveMap.fromLibraries({ state: { data: 0 } });
const attachLocus = hsonLocus.create({ map: attachMap, libraries: [{ name: "state", ownership: "shared" }] });
const retained = await attachLocus.session.create({ libraries: ["state"] }, { connection: context });
const attachBinder = bind_locus_http(attachLocus, { endpoint: "/_hson" });
let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined;
const streamedBody = new ReadableStream<Uint8Array>({ start(controller) { bodyController = controller; } });
try {
  const pending = attachBinder.handle(new Request(url, { method: "POST", headers: { "content-type": "application/json" },
    body: streamedBody, duplex: "half" } as RequestInit & { duplex: "half" }), context);
  attachBinder.dispose();
  bodyController?.enqueue(new TextEncoder().encode(JSON.stringify({ type: "session-attach", id: "attach",
    credential: retained.credential })));
  bodyController?.close();
  const response = await pending;
  assert.equal(response.status, 503);
  assert.equal(response.headers.has("x-hson-attachment"), false);
  assert.equal(attachLocus.session.debug().sessions[0]?.activeConnectionEpoch, 1);
} finally { attachBinder.dispose(); attachLocus.dispose(); }
events.case_end("pending-attach", "pass");

events.case_begin("current-stream", "observe and recover each displace the old HTTP response");
const streamMap = hsonLiveMap.fromLibraries({ state: { data: 0 } });
const streamLocus = hsonLocus.create({ map: streamMap, libraries: [{ name: "state", ownership: "shared" }] });
const streamBinder = bind_locus_http(streamLocus, { endpoint: "/_hson" });
try {
  const created = await streamBinder.handle(request({ type: "session-create", id: "create" }), context);
  const token = created.headers.get("x-hson-attachment")!;
  const observe = () => streamBinder.handle(request({ type: "observe" }, token, true), context);
  const first = (await observe()).body!.getReader();
  await first.read();
  const second = (await observe()).body!.getReader();
  await second.read();
  assert.equal(await waitEnd(first), true);
  assert.equal((await first.read()).done, true);
  const recovery = (await streamBinder.handle(request({ type: "recover", id: "recover",
    logicalMapId: streamLocus.logicalMapId }, token, true), context)).body!.getReader();
  await recovery.read();
  assert.equal(await waitEnd(second), true);
  const replacement = (await streamBinder.handle(request({ type: "recover", id: "replacement",
    logicalMapId: streamLocus.logicalMapId }, token, true), context)).body!.getReader();
  await replacement.read();
  assert.equal(await waitEnd(recovery), true);
  const detached = await streamBinder.handle(request({ type: "session-detach", id: "detach" }, token), context);
  assert.equal(detached.status, 200);
  assert.equal(await waitEnd(replacement), true);
  await Promise.all([first.cancel(), second.cancel(), recovery.cancel(), replacement.cancel()]);
} finally { streamBinder.dispose(); streamLocus.dispose(); }
events.case_end("current-stream", "pass");

events.case_begin("lease-generation", "queued old lease callbacks cannot close refreshed or new attachments");
const originalSetTimeout = globalThis.setTimeout;
const originalNow = Date.now;
const leaseCallbacks: Array<() => void> = [];
globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
  if (delay === 120_000) {
    leaseCallbacks.push(() => callback(...args));
    const timer = originalSetTimeout(() => {}, 1_000_000);
    timer.unref?.();
    return timer;
  }
  return originalSetTimeout(callback, delay, ...args);
}) as typeof globalThis.setTimeout;
const leaseMap = hsonLiveMap.fromLibraries({ state: { data: 0 } });
const leaseLocus = hsonLocus.create({ map: leaseMap, libraries: [{ name: "state", ownership: "shared" }] });
const leaseBinder = bind_locus_http(leaseLocus, { endpoint: "/_hson" });
try {
  const first = await leaseBinder.handle(request({ type: "session-create", id: "create" }), context);
  const oldToken = first.headers.get("x-hson-attachment")!;
  const credential = (await first.json() as { credential: string }).credential;
  const oldExpiry = leaseCallbacks[0]!;
  const second = await leaseBinder.handle(request({ type: "session-attach", id: "attach", credential }), context);
  const token = second.headers.get("x-hson-attachment")!;
  oldExpiry();
  assert.equal((await leaseBinder.handle(request({ type: "heartbeat" }, token), context)).status, 204);
  const beforeActivity = leaseCallbacks.at(-1)!;
  const now = originalNow();
  Date.now = () => now + 119_000;
  assert.equal((await leaseBinder.handle(request({ type: "action-status", id: "status", clientId: "client",
    requestId: "request" }, token), context)).status, 200);
  beforeActivity();
  assert.equal((await leaseBinder.handle(request({ type: "heartbeat" }, token), context)).status, 204);
  const beforeStream = leaseCallbacks.at(-1)!;
  const observe = await leaseBinder.handle(request({ type: "observe" }, token, true), context);
  beforeStream();
  assert.equal((await leaseBinder.handle(request({ type: "heartbeat" }, token), context)).status, 204);
  await observe.body?.cancel();
  assert.equal((await leaseBinder.handle(request({ type: "session-goodbye", id: "goodbye" }, token), context)).status, 200);
  leaseCallbacks.at(-1)?.();
  assert.equal((await leaseBinder.handle(request({ type: "heartbeat" }, token), context)).status, 403);
  assert.equal((await leaseBinder.handle(request({ type: "heartbeat" }, oldToken), context)).status, 403);
} finally {
  Date.now = originalNow;
  globalThis.setTimeout = originalSetTimeout;
  leaseBinder.dispose();
  leaseLocus.dispose();
}
events.case_end("lease-generation", "pass");
events.terminal("pass");
