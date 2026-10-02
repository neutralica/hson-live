import { authority_groups_from_catalog_fixture, authority_groups_from_map_fixture } from "./helpers/locus-definition-fixture.mts";
import assert from "node:assert/strict";
import { Hson, hsonEcho, hsonLiveMap, hsonLocus, bind_locus_http, bind_locus_websocket } from "../src/index.ts";
import WebSocket from "ws";
import { start_node_application_host } from "../src/api/livehost/node/livehost.node-application-host.ts";
import type { LiveHostApplication } from "../src/types/livehost.types.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "echo.http", title: "Echo HTTP semantic transport", category: "Echo", runtime: "node-real-http1",
  tags: Object.freeze(["echo", "http", "locus", "session", "stream"]),
});
const events = create_test_event_emitter("echo.http");
events.case_begin("http1", "HTTP/1 finite operations and continuing synchronization");

const map = hsonLiveMap.fromLibraries({ state: { data: { value: 0 } } });
const locus = hsonLocus.create({ ...authority_groups_from_map_fixture(map, [{ name: "state", ownership: "shared" },
  { name: "ui", ownership: "local", initializer: { data: { value: 0 } } }]), defaultProjection: { libraries: ["state", "ui"] }, authorizeProjection: ({ requested }) => ({ libraries: requested.libraries }), actions: { echo: (_context, payload) => payload } });
const binding = bind_locus_http(locus, { endpoint: "/_hson" });
const application: LiveHostApplication = {
  name: "echo-http",
  requests: ["/_hson", "/_hson/sync"].map((path) => ({ method: "POST", path,
    handle: (request, context) => binding.handle(request, { principalId: context.principal.id }) })),
  connections: [{ path: "/ws", accept(_request, connection, context) {
    bind_locus_websocket(locus, {
      send: (message) => connection.send(message),
      close: (code, reason) => connection.close(code, reason),
      onMessage: (listener) => connection.onMessage((message) => {
        if (typeof message === "string") listener(message);
      }),
      onClose: (listener) => connection.onClose(listener),
    }, { principalId: context.principal.id });
  } }],
  dispose() { binding.dispose(); },
};
const host = await start_node_application_host({ port: 0, applications: [application] });
const endpoint = `${host.httpUrl}/_hson`;
const transport = hsonEcho.transport.http({ endpoint });
try {
  const echo = hsonEcho.create({ transport });
  echo.connect();
  const created = await echo.session.create();
  assert.equal(created.epoch, 1);
  assert.equal(typeof echo.session.credential, "string");
  const action = echo.action("echo", Hson.data.from({ value: 7 }));
  const result = await action;
  assert.equal(result.type, "ack");
  assert.equal((await echo.actionStatus(action.request.requestId)).state, "succeeded");
  assert.equal((await echo.retryAction(action.request)).type, "ack");
  const response = await transport.operations.submit({ type: "action-status", id: "status", clientId: "client", requestId: "request" });
  assert.equal(response.kind, "response");
  const messages: string[] = [];
  const ends: string[] = [];
  const sync = await transport.synchronization.open({ type: "recover", id: "sync", logicalMapId: locus.logicalMapId }, {
    onOutput(output) { messages.push(output.type); },
    onEnd(end) { ends.push(end.kind); },
  });
  for (let i = 0; i < 100 && !messages.includes("recovery-caught-up"); i++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(messages.includes("recovery-caught-up"), true);
  sync.cancel();
  assert.deepEqual(ends, ["cancelled"]);
  const status = await transport.operations.submit({ type: "action-status", id: "status-two", clientId: "client", requestId: "request" });
  assert.equal(status.kind, "response");
  echo.dispose();

  const retained = await locus.session.create({ libraries: ["state", "ui"] },
    { connection: { principalId: "development-anonymous" } });
  let interruptSync: (() => void) | undefined;
  let syncOpens = 0;
  let pauseNextRecovery = false;
  let resumeRecovery: (() => void) | undefined;
  const releaseRecovery = () => {
    const release = resumeRecovery;
    resumeRecovery = undefined;
    release?.();
  };
  const interruptedFetch: typeof fetch = async (input, init) => {
    const recovering = String(input).endsWith("/sync") && typeof init?.body === "string"
      && JSON.parse(init.body).type === "recover";
    if (recovering && pauseNextRecovery) {
      pauseNextRecovery = false;
      await new Promise<void>((resolve) => { resumeRecovery = resolve; });
    }
    const response = await fetch(input, init);
    if (!recovering || response.body === null || response.status !== 200) return response;
    syncOpens += 1;
    const source = response.body.getReader();
    let target: ReadableStreamDefaultController<Uint8Array> | undefined;
    let interrupted = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { target = controller; },
      async pull(controller) {
        if (interrupted) return;
        try {
          const next = await source.read();
          if (interrupted) return;
          if (next.done) controller.close();
          else {
            controller.enqueue(next.value);
          }
        } catch (cause) { if (!interrupted) controller.error(cause); }
      },
      cancel() { interrupted = true; void source.cancel(); },
    });
    interruptSync = () => {
      interrupted = true;
      target?.error(new Error("Test stream interruption."));
      void source.cancel();
    };
    return new Response(stream, { status: response.status, headers: response.headers });
  };
  const replicaTransport = hsonEcho.transport.http({ endpoint, fetch: interruptedFetch });
  let closeReplica = () => {};
  try {
    const replica = await hsonEcho.create({ now: retained.now(), credential: retained.credential!, transport: replicaTransport });
    closeReplica = () => replica.dispose();
    assert.equal(replica.session.status, "attached");
    assert.equal(replica.sync.status, "caught_up");
    assert.equal(replica.sync.strategy, "current");
    const ui = replica.lib("ui");
    if (ui.mode === "document" || ui.source !== "client-local") throw new Error("Expected local data library.");
    ui.at(["value"]).set(23);
    await locus.stage((draft) => {
      const state = draft.lib("state");

      state.at(["value"]).set(1);
    });
    for (let i = 0; i < 100 && replica.sync.appliedRev !== locus.rev; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(replica.sync.appliedRev, locus.rev);
    const attachmentEpoch = replica.session.epoch;
    pauseNextRecovery = true;
    interruptSync?.();
    for (let i = 0; i < 100 && resumeRecovery === undefined; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(resumeRecovery, "replacement recovery waits before admission");
    await locus.stage((draft) => {
      const state = draft.lib("state");

      state.at(["value"]).set(2);
    });
    releaseRecovery();
    for (let i = 0; i < 100 && (syncOpens < 2 || replica.sync.status !== "caught_up"
      || replica.sync.appliedRev !== locus.rev); i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(replica.sync.strategy, "replay");
    assert.equal(replica.sync.appliedRev, locus.rev);
    pauseNextRecovery = true;
    interruptSync?.();
    for (let i = 0; i < 100 && resumeRecovery === undefined; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(resumeRecovery, "scope update begins while HTTP recovery is opening");
    const scopeUpdate = retained.update({ libraries: ["state"] });
    releaseRecovery();
    await scopeUpdate;
    for (let i = 0; i < 100 && (syncOpens < 3 || replica.sync.status !== "caught_up"); i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(replica.sync.status, "caught_up");
    assert.equal(ui.snap(["value"]), 23, "scope contraction preserves local state");
    await retained.update({ libraries: ["state", "ui"] });
    assert.ok(syncOpens >= 2, "stream interruption opens replacement recovery");
    assert.equal(replica.session.epoch, attachmentEpoch, "same-epoch recovery preserves logical attachment");
    assert.equal(replica.sync.status, "caught_up");
    assert.equal(ui.snap(["value"]), 23, "HTTP recovery preserves evolved local state");
    const afterStreamLoss = await replicaTransport.operations.submit({ type: "action-status", id: "after-loss",
      clientId: "client", requestId: "request" });
    assert.equal(afterStreamLoss.kind, "response");
  } finally { releaseRecovery(); closeReplica(); replicaTransport.dispose(); }

  const reconcileSession = await locus.session.create({ libraries: ["state", "ui"] },
    { connection: { principalId: "development-anonymous" } });
  const cut = reconcileSession.now();
  const forgedCut = { ...cut, libs: { ...cut.libs, libraries: cut.libs.libraries.map((library) => library.name === "state"
    ? { ...library, root: { ...library.root, payload: library.root.payload.replace("value 2>", "value 99>") } }
    : library) } };
  assert.notEqual(forgedCut.libs.libraries[0]?.root.payload, cut.libs.libraries[0]?.root.payload);
  const reconcileTransport = hsonEcho.transport.http({ endpoint });
  try {
    const reconciled = await hsonEcho.create({ now: forgedCut, credential: reconcileSession.credential!,
      transport: reconcileTransport });
    assert.equal(reconciled.sync.strategy, "reconcile");
    assert.equal(reconciled.sync.status, "caught_up");
    reconciled.dispose();
  } finally { reconcileTransport.dispose(); }

  const json = { "content-type": "application/json" };
  assert.equal((await binding.handle(new Request(endpoint, { method: "GET" }),
    { principalId: "development-anonymous" })).status, 405);
  assert.equal((await binding.handle(new Request(`${endpoint}?unexpected=1`, { method: "POST",
    headers: json, body: '{"type":"session-create","id":"query"}' }),
  { principalId: "development-anonymous" })).status, 404);
  assert.equal((await binding.handle(new Request(endpoint, { method: "POST", headers: json,
    body: '{"type":"session-create","id":"extra","unexpected":true}' }),
  { principalId: "development-anonymous" })).status, 400);
  const raw = async (value: unknown, token?: string, suffix = "") => fetch(`${endpoint}${suffix}`, {
    method: "POST", headers: { ...json, ...(token === undefined ? {} : { "x-hson-attachment": token }) },
    body: JSON.stringify(value),
  });
  const rejectedAttach = await raw({ type: "session-attach", id: "wrong-credential", credential: "0".repeat(64) });
  assert.equal(rejectedAttach.status, 200);
  assert.equal((await rejectedAttach.json() as { type: string }).type, "session-rejected");
  const createdRaw = await raw({ type: "session-create", id: "raw-create" });
  assert.equal(createdRaw.status, 200);
  const capabilityA = createdRaw.headers.get("x-hson-attachment")!;
  assert.match(capabilityA, /^[a-f0-9]{64}$/u);
  const retainedRaw = await createdRaw.json() as { sessionId: string; credential: string; epoch: number };
  const statusRequest = { type: "action-status", id: "raw-status", clientId: "raw-client", requestId: "raw-request" };
  assert.equal((await raw(statusRequest, capabilityA)).status, 200);
  assert.equal((await raw(statusRequest, "0".repeat(64))).status, 403);
  assert.equal((await binding.handle(new Request(endpoint, { method: "POST", headers: { ...json,
    "x-hson-attachment": capabilityA }, body: JSON.stringify(statusRequest) }), { principalId: "other" })).status, 403);
  const pendingOld = new Request(endpoint, { method: "POST", headers: { ...json,
    "x-hson-attachment": capabilityA }, body: JSON.stringify(statusRequest) });
  const attachedRaw = await raw({ type: "session-attach", id: "raw-attach", credential: retainedRaw.credential });
  assert.equal(attachedRaw.status, 200);
  const capabilityB = attachedRaw.headers.get("x-hson-attachment")!;
  const attachmentOutcome = await attachedRaw.json() as { epoch: number };
  assert.equal(attachmentOutcome.epoch, retainedRaw.epoch + 1);
  assert.notEqual(capabilityB, capabilityA);
  assert.equal((await binding.handle(pendingOld, { principalId: "development-anonymous" })).status, 403);
  assert.equal((await raw({ type: "recover", id: "stale", logicalMapId: locus.logicalMapId }, capabilityA, "/sync")).status, 403);
  assert.equal((await raw(statusRequest, capabilityB)).status, 200);
  const detached = await raw({ type: "session-detach", id: "raw-detach" }, capabilityB);
  assert.equal(detached.status, 200);
  assert.equal((await raw(statusRequest, capabilityB)).status, 403);
  const again = await raw({ type: "session-attach", id: "raw-again", credential: retainedRaw.credential });
  const capabilityC = again.headers.get("x-hson-attachment")!;
  assert.equal(again.status, 200);
  assert.equal((await raw({ type: "session-goodbye", id: "raw-goodbye" }, capabilityC)).status, 200);
  assert.equal((await raw(statusRequest, capabilityC)).status, 403);
  const revokedRaw = await raw({ type: "session-create", id: "raw-revoke" });
  const revokedCapability = revokedRaw.headers.get("x-hson-attachment")!;
  const revokedSession = await revokedRaw.json() as { sessionId: string };
  assert.equal(locus.session.get(revokedSession.sessionId)?.revoke(), true);
  assert.equal((await raw(statusRequest, revokedCapability)).status, 403);

  const credentialRaw = await raw({ type: "session-create", id: "credential-session" });
  const credentialSession = await credentialRaw.json() as { sessionId: string; credential: string };
  const cutRaw = await raw({ type: "session-create", id: "cut-session" });
  const cutCapability = cutRaw.headers.get("x-hson-attachment")!;
  const cutSession = await cutRaw.json() as { sessionId: string };
  const mixedTransport = hsonEcho.transport.http({ endpoint });
  try {
    await assert.rejects(hsonEcho.create({ now: locus.session.get(cutSession.sessionId)!.now(),
      credential: credentialSession.credential, transport: mixedTransport }));
  } finally { mixedTransport.dispose(); }
  assert.equal((await raw({ type: "session-goodbye", id: "cut-goodbye" }, cutCapability)).status, 200);
  assert.equal(locus.session.get(credentialSession.sessionId)?.revoke(), true);

  const otherMap = hsonLiveMap.fromLibraries({ other: { data: 0 } });
  const otherLocus = hsonLocus.create({ ...authority_groups_from_map_fixture(otherMap, [{ name: "other", ownership: "shared" }]) });
  const otherBinding = bind_locus_http(otherLocus, { endpoint: "/_hson" });
  try {
    const wrongAuthority = await otherBinding.handle(new Request(endpoint, { method: "POST",
      headers: { ...json, "x-hson-attachment": capabilityA }, body: JSON.stringify(statusRequest) }),
    { principalId: "development-anonymous" });
    assert.equal(wrongAuthority.status, 403);
    const otherCreated = await otherBinding.handle(new Request(endpoint, { method: "POST", headers: json,
      body: JSON.stringify({ type: "session-create", id: "other-create" }) }),
    { principalId: "development-anonymous" });
    const otherToken = otherCreated.headers.get("x-hson-attachment")!;
    otherLocus.dispose();
    assert.equal((await otherBinding.handle(new Request(endpoint, { method: "POST", headers: { ...json,
      "x-hson-attachment": otherToken }, body: JSON.stringify(statusRequest) }),
    { principalId: "development-anonymous" })).status, 403);
  } finally { otherBinding.dispose(); otherLocus.dispose(); }

  const websocketTransport = hsonEcho.transport.websocket({ url: `${host.url}/ws`, WebSocketConstructor: WebSocket });
  const websocketEcho = hsonEcho.create({ transport: websocketTransport });
  websocketEcho.connect();
  const websocketSession = await websocketEcho.session.create();
  const websocketCredential = websocketEcho.session.credential!;
  const websocketCut = locus.session.get(websocketSession.sessionId)!.now();
  websocketTransport.dispose();
  websocketEcho.dispose();
  const switchedTransport = hsonEcho.transport.http({ endpoint });
  try {
    const switched = await hsonEcho.create({ now: websocketCut, credential: websocketCredential,
      transport: switchedTransport });
    assert.equal(switched.session.sessionId, websocketSession.sessionId);
    assert.equal(switched.session.epoch, websocketSession.epoch + 1);
    assert.equal(switched.sync.status, "caught_up");
    switched.dispose();
  } finally { switchedTransport.dispose(); }

  const fenceTransport = hsonEcho.transport.http({ endpoint });
  const fenceEcho = hsonEcho.create({ transport: fenceTransport });
  const notices: string[] = [];
  const stopNotice = fenceTransport.attachment.observe((event) => notices.push(event.kind));
  try {
    fenceEcho.connect();
    const attached = await fenceEcho.session.create();
    assert.equal(locus.session.get(attached.sessionId)?.revoke(), true);
    for (let i = 0; i < 100 && !notices.includes("fenced"); i++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(notices.includes("fenced"), true, "endpoint-only HTTP control stream observes fencing");
  } finally { stopNotice(); fenceEcho.dispose(); fenceTransport.dispose(); }
  const shutdownRaw = await raw({ type: "session-create", id: "shutdown-session" });
  const shutdownCapability = shutdownRaw.headers.get("x-hson-attachment")!;
  binding.dispose();
  assert.equal((await raw(statusRequest, shutdownCapability)).status, 503);
} finally {
  transport.dispose();
  await host.dispose();
  locus.dispose();
}
events.case_end("http1", "pass");
events.terminal("pass");
