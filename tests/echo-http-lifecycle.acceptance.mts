import { authority_groups_from_map_fixture } from "./helpers/locus-definition-fixture.mts";
import assert from "node:assert/strict";
import { bind_locus_http, hsonLiveMap } from "../src/index.ts";
import { LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT as format } from "../src/api/locus/locus.aggregate.protocol.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "echo.http-lifecycle", title: "HTTP Echo attachment generation and disposal",
  category: "Echo", runtime: "node", tags: Object.freeze(["echo", "http", "lifecycle", "fencing"]),
});
const events = create_test_event_emitter("echo.http-lifecycle");
const created = (id: string) => JSON.stringify({ type: "session-created", format, id,
  sessionId: "session", credential: "credential", epoch: 1, logicalMapId: "map", incarnationId: "incarnation" });
const attached = (id: string) => JSON.stringify({ type: "session-attached", format, id,
  sessionId: "session", epoch: 2, logicalMapId: "map", incarnationId: "incarnation" });
const status = (id: string) => JSON.stringify({ type: "action-status", format, id, requestId: "request", state: "unknown" });
const json = { "content-type": "application/json" };

for (const kind of ["finite", "sync", "heartbeat"] as const) {
  events.case_begin(kind, `late ${kind} rejection cannot fence a newer attachment`);
  const originalSetInterval = globalThis.setInterval;
  let heartbeatTick: (() => void) | undefined;
  globalThis.setInterval = ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
    if (delay === 30_000) {
      heartbeatTick = () => callback(...args);
      const timer = originalSetInterval(() => {}, 1_000_000);
      timer.unref?.();
      return timer;
    }
    return originalSetInterval(callback, delay, ...args);
  }) as typeof globalThis.setInterval;
  let releaseOld: ((response: Response) => void) | undefined;
  let oldStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => { oldStarted = resolve; });
  const seen: string[] = [];
  const transport = hsonLiveMap.echo.transport.http({ endpoint: "https://example.test/_hson", fetch: async (input, init) => {
    const message = JSON.parse(String(init?.body)) as { type: string; id?: string };
    const token = new Headers(init?.headers).get("x-hson-attachment");
    if (token !== null) seen.push(token);
    if (message.type === "session-create") return new Response(created(message.id!),
      { headers: { ...json, "x-hson-attachment": "a".repeat(64) } });
    if (message.type === "session-attach") return new Response(attached(message.id!),
      { headers: { ...json, "x-hson-attachment": "b".repeat(64) } });
    if ((kind === "finite" && message.id === "old")
      || (kind === "sync" && String(input).endsWith("/sync") && message.id === "old")
      || (kind === "heartbeat" && message.type === "heartbeat")) {
      oldStarted?.();
      return new Promise<Response>((resolve) => { releaseOld = resolve; });
    }
    if (String(input).endsWith("/sync")) return new Response(null, { status: 503 });
    return new Response(status(message.id!), { headers: json });
  } });
  try {
    assert.equal((await transport.operations.submit({ type: "session-create", id: "create" })).kind, "response");
    let old: Promise<unknown>;
    if (kind === "finite") old = transport.operations.submit({ type: "action-status", id: "old",
      clientId: "client", requestId: "request" });
    else if (kind === "sync") old = transport.synchronization.open({ type: "recover", id: "old", logicalMapId: "map" },
      { onOutput() {}, onEnd() {} }).catch(() => undefined);
    else {
      assert.ok(heartbeatTick);
      heartbeatTick();
      old = started;
    }
    await started;
    assert.equal((await transport.operations.submit({ type: "session-attach", id: "attach", credential: "credential" })).kind, "response");
    releaseOld?.(new Response(null, { status: 403, headers: { "x-hson-attachment-state": "invalid" } }));
    await old;
    assert.equal((await transport.operations.submit({ type: "action-status", id: "new",
      clientId: "client", requestId: "request" })).kind, "response");
    assert.equal(seen.at(-1), "b".repeat(64));
  } finally { transport.dispose(); globalThis.setInterval = originalSetInterval; }
  events.case_end(kind, "pass");
}

events.case_begin("dispose", "terminal transport disposal and Echo owner release stop attachment work");
let fetches = 0;
let pendingAbort = false;
let holdFinite = false;
const transport = hsonLiveMap.echo.transport.http({ endpoint: "https://example.test/_hson", fetch: async (input, init) => {
  fetches += 1;
  const message = JSON.parse(String(init?.body)) as { type: string; id?: string };
  if (message.type === "session-create") return new Response(created(message.id!),
    { headers: { ...json, "x-hson-attachment": "a".repeat(64) } });
  if (holdFinite && message.type === "action-status") return new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => { pendingAbort = true; reject(new Error("aborted")); }, { once: true });
  });
  if (String(input).endsWith("/sync")) return new Response(null, { status: 503 });
  return new Response(status(message.id!), { headers: json });
} });
const echo = hsonLiveMap.echo.create({ transport });
try {
  echo.connect();
  await echo.session.create();
  assert.equal(echo.session.status, "attached");
  holdFinite = true;
  const pending = transport.operations.submit({ type: "action-status", id: "pending",
    clientId: "client", requestId: "request" });
  await Promise.resolve();
  transport.dispose();
  assert.equal(echo.session.status, "detached");
  assert.equal((await pending).kind, "uncertain");
  assert.equal(pendingAbort, true);
  transport.dispose();
  assert.equal((await transport.operations.submit({ type: "action-status", id: "after",
    clientId: "client", requestId: "request" })).kind, "not-submitted");
} finally { echo.dispose(); transport.dispose(); }

const previousSetInterval = globalThis.setInterval;
let ownerHeartbeatTick: (() => void) | undefined;
globalThis.setInterval = ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
  if (delay === 30_000) ownerHeartbeatTick = () => callback(...args);
  const timer = previousSetInterval(() => {}, 1_000_000);
  timer.unref?.();
  return timer;
}) as typeof globalThis.setInterval;
const ownerTransport = hsonLiveMap.echo.transport.http({ endpoint: "https://example.test/_hson", fetch: async (input, init) => {
  fetches += 1;
  const message = JSON.parse(String(init?.body)) as { type: string; id?: string };
  if (message.type === "session-create") return new Response(created(message.id!),
    { headers: { ...json, "x-hson-attachment": "a".repeat(64) } });
  return new Response(null, { status: 503 });
} });
const ownerEcho = hsonLiveMap.echo.create({ transport: ownerTransport });
try {
  ownerEcho.connect();
  await ownerEcho.session.create();
  ownerEcho.dispose();
  const afterDispose = fetches;
  ownerHeartbeatTick?.();
  await Promise.resolve();
  assert.equal((await ownerTransport.operations.submit({ type: "action-status", id: "orphan",
    clientId: "client", requestId: "request" })).kind, "not-submitted");
  assert.equal(fetches, afterDispose);
  assert.throws(() => hsonLiveMap.echo.create({ transport: ownerTransport }), /one Echo for its lifetime/i);
} finally { ownerEcho.dispose(); ownerTransport.dispose(); globalThis.setInterval = previousSetInterval; }
events.case_end("dispose", "pass");

events.case_begin("pending-sync-dispose", "transport disposal interrupts a pending stream open");
const pendingMap = hsonLiveMap.fromLibraries({ state: { data: { value: 0 } } });
const pendingLocus = hsonLiveMap.locus.create({ ...authority_groups_from_map_fixture(pendingMap, [{ name: "state", ownership: "shared" }]), defaultProjection: { libraries: ["state"] }, authorizeProjection: () => ({ libraries: ["state"] }) });
const pendingBinder = bind_locus_http(pendingLocus, { endpoint: "/_hson" });
let streamStarted: (() => void) | undefined;
const streamOpening = new Promise<void>((resolve) => { streamStarted = resolve; });
let streamAborted = false;
const pendingTransport = hsonLiveMap.echo.transport.http({ endpoint: "https://example.test/_hson", fetch: async (input, init) => {
  if (String(input).endsWith("/sync")) {
    streamStarted?.();
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => { streamAborted = true; reject(new Error("aborted")); }, { once: true });
    });
  }
  return pendingBinder.handle(new Request(String(input), init), {});
} });
const pendingEcho = hsonLiveMap.echo.create({ transport: pendingTransport });
try {
  pendingEcho.connect();
  await pendingEcho.session.create();
  const opening = pendingTransport.synchronization.open({ type: "recover", id: "pending-sync", logicalMapId: "map" },
    { onOutput() {}, onEnd() {} }).catch(() => undefined);
  await streamOpening;
  pendingTransport.dispose();
  await opening;
  assert.equal(streamAborted, true);
  assert.equal(pendingEcho.session.status, "detached");
} finally { pendingEcho.dispose(); pendingTransport.dispose(); pendingBinder.dispose(); pendingLocus.dispose(); }
events.case_end("pending-sync-dispose", "pass");

events.case_begin("replica-dispose", "live replica loses readiness on transport disposal");
const replicaMap = hsonLiveMap.fromLibraries({ state: { data: { value: 0 } } });
const replicaLocus = hsonLiveMap.locus.create({ ...authority_groups_from_map_fixture(replicaMap, [{ name: "state", ownership: "shared" }]), defaultProjection: { libraries: ["state"] }, authorizeProjection: () => ({ libraries: ["state"] }) });
const retained = await replicaLocus.session.create({ libraries: ["state"] });
const replicaBinder = bind_locus_http(replicaLocus, { endpoint: "/_hson" });
const replicaTransport = hsonLiveMap.echo.transport.http({ endpoint: "https://example.test/_hson", fetch: (input, init) =>
  replicaBinder.handle(new Request(String(input), init), {}) });
try {
  const replicaEcho = await hsonLiveMap.echo.create({ now: retained.now(), credential: retained.credential!, transport: replicaTransport });
  try {
    assert.equal(replicaEcho.sync.status, "caught_up");
    replicaTransport.dispose();
    assert.equal(replicaEcho.session.status, "detached");
    assert.notEqual(replicaEcho.sync.status, "caught_up");
    replicaTransport.dispose();
  } finally { replicaEcho.dispose(); }
} finally { replicaTransport.dispose(); replicaBinder.dispose(); replicaLocus.dispose(); }
events.case_end("replica-dispose", "pass");
events.terminal("pass");
