import { echo_map_internal } from "../src/internal/governor-maps.js";
import { locus_map_internal } from "../src/internal/governor-maps.js";
import { authority_groups_from_catalog_fixture, authority_groups_from_map_fixture, authority_definition_from_fixture_options } from "./helpers/locus-definition-fixture.mts";
import { test_echo_transport } from "./helpers/echo-websocket-transport.mts";
import { bind_locus_websocket } from "../src/api/locus/locus.websocket.ts";
import assert from "node:assert/strict";
import { Hson, add_interaction, decode_ssr_bootstrap, enable_interactions, encode_ssr_bootstrap, hsonLiveMap, type InteractionDescriptor, type Locus, type LocusWebSocketLike } from "../src/index.ts";
import type { LocusRegistryOptions } from "../src/types/locus.core.types.ts";
import { create_registry_locus_internal } from "../src/api/locus/locus.registry.ts";
import { encode_hosted_root, hosted_sha256 } from "../src/api/livemap/livemap.hosted.ts";
import { parse_hson_exact_runtime } from "../src/internal/exact-runtime-hson-codec.ts";
import { admit_locus_session_now, install_client_local_initializers_internal, make_locus_application_catalog } from "../src/api/locus/locus.local-initializer.ts";
import { prepare_echo_replica_internal } from "../src/api/echo/echo.replica-preparation.ts";
import type { EchoAttachmentEvent, EchoCancellationSignal, EchoFiniteOperationRequest, EchoReplicaTransport,
  EchoSynchronizationObserver, EchoSynchronizationRequest } from "../src/types/echo.transport.types.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "echo.init", title: "Echo retained-session replica establishment", category: "Echo", runtime: "node",
  tags: Object.freeze(["echo", "sync", "session", "headless", "public"]),
});

function socket_pair() {
  const toServer = new Set<(raw: string) => void>();
  const toClient = new Set<(raw: string) => void>();
  const held: string[] = [];
  let holdCaughtUp = false;
  let actionFrames = 0;
  const client: LocusWebSocketLike = {
    send(raw) {
      if (JSON.parse(raw).type === "action") actionFrames++;
      for (const listener of [...toServer]) listener(raw);
    }, close() {},
    onMessage(listener) { toClient.add(listener); return () => { toClient.delete(listener); }; },
    onClose() { return () => {}; },
  };
  const server: LocusWebSocketLike = {
    send(raw) {
      if (holdCaughtUp && JSON.parse(raw).type === "recovery-caught-up") { held.push(raw); return; }
      for (const listener of [...toClient]) listener(raw);
    }, close() {},
    onMessage(listener) { toServer.add(listener); return () => { toServer.delete(listener); }; },
    onClose() { return () => {}; },
  };
  return { client, server, clientListenerCount: () => toClient.size,
    actionFrames: () => actionFrames,
    holdCaughtUp: () => { holdCaughtUp = true; },
    releaseCaughtUp: () => {
      holdCaughtUp = false;
      for (const raw of held.splice(0)) for (const listener of [...toClient]) listener(raw);
    } };
}

async function until(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.fail("Expected asynchronous replica lifecycle transition.");
}

for (const [expected, advance, truncateHistory] of [
  ["current", false, false], ["reconcile", true, false], ["reconcile", true, true],
] as const) {
  const map = hsonLiveMap.fromLibraries({ state: { data: { value: 0 } } });
  const options: LocusRegistryOptions<typeof map> = {
    map,
    libraries: [{ name: "state", ownership: "shared" as const }],
    defaultProjection: { libraries: ["state"] },
    authorizeProjection: () => ({ libraries: ["state"] }),
  };
  const locus: Locus<typeof map> = truncateHistory
    ? create_registry_locus_internal(options, { maxHistoryBytes: 1 }).locus
    : hsonLiveMap.locus.create(authority_definition_from_fixture_options(options));
  const session = await locus.session.create({ libraries: ["state"] });
  const cut = session.now();
  if (advance) await locus.stage((draft) => {
    const state = draft.lib("state");

    state.at(["value"]).set(1);
  });
  const pair = socket_pair();
  let detach = bind_locus_websocket(locus, pair.server);
  if (expected === "current") {
    await assert.rejects(hsonLiveMap.echo.create({ now: { ...cut, libs: { ...cut.libs, projectionDigest: "0".repeat(64) } },
      credential: session.credential!, transport: test_echo_transport(pair.client) }), /digest|projection/i);
    assert.equal(pair.clientListenerCount(), 0, "invalid cut does not install transport listeners");
    const ahead = socket_pair();
    const detachAhead = bind_locus_websocket(locus, ahead.server);
    await assert.rejects(hsonLiveMap.echo.create({ now: { ...cut, libs: { ...cut.libs, revision: cut.libs.revision + 1 } },
      credential: session.credential!, transport: test_echo_transport(ahead.client) }), /ahead|synchronization/i);
    assert.equal(ahead.clientListenerCount(), 0, "failed synchronization releases transport listeners");
    detachAhead(); // The deterministic fixture has no physical close notification.
    const retained = locus.session.debug().sessions[0]!;
    assert.equal(retained.state, "disconnected", "failed establishment detaches the authority session");
    assert.equal(retained.transportAttached, false);
    assert.equal(retained.resumable, true);
    assert.ok(retained.expiresAt);
  }
  const echo = await hsonLiveMap.echo.create({ now: cut, credential: session.credential!, transport: test_echo_transport(pair.client) });
  assert.equal(echo.session.status, "attached");
  assert.equal(echo.sync.status, "caught_up");
  assert.equal(echo.sync.strategy, expected);
  assert.equal(echo.sync.appliedRev, locus.rev);
  assert.equal(echo.session.credential, session.credential);
  const state = echo.lib("state");
  if (state.mode === "document") throw new Error("Expected a data library.");
  assert.equal(state.snap(["value"]), expected === "current" ? 0 : 1);
  assert.equal("set" in state.at(["value"]), false, "projected data has no direct setter");
  echo.dispose();
  assert.equal(echo.session.credential, undefined);
  assert.equal(echo.sync.status, "disposed");
  assert.equal(echo.sync.debug().status, "disposed");
  assert.equal(pair.clientListenerCount(), 0);
  detach(); locus.dispose();
}

{
  const map = hsonLiveMap.fromLibraries({ state: { data: { value: 0 } } });
  const locus = hsonLiveMap.locus.create({ ...authority_groups_from_map_fixture(map, [{ name: "state", ownership: "shared" }]), defaultProjection: { libraries: ["state"] }, authorizeProjection: () => ({ libraries: ["state"] }) });
  const session = await locus.session.create({ libraries: ["state"] });
  const pair = socket_pair();
  const detach = bind_locus_websocket(locus, pair.server);
  const transport = test_echo_transport(pair.client);
  const echo = await hsonLiveMap.echo.create({ now: session.now(), credential: session.credential!, transport });
  assert.equal(echo.sync.status, "caught_up");
  transport.dispose();
  assert.notEqual(echo.sync.status, "caught_up", "terminal transport disposal invalidates replica readiness");
  assert.notEqual(echo.session.status, "attached", "terminal transport disposal invalidates attachment observation");
  await assert.rejects(echo.action("unavailable"), /disconnect|unavailable/i);
  echo.dispose(); detach(); locus.dispose();
}

{
  const map = hsonLiveMap.fromLibraries({ state: { data: { value: 0 } } });
  const locus = hsonLiveMap.locus.create({ ...authority_groups_from_map_fixture(map, [{ name: "state", ownership: "shared" }]), defaultProjection: { libraries: ["state"] }, authorizeProjection: () => ({ libraries: ["state"] }) });
  const session = await locus.session.create({ libraries: ["state"] });
  let opening = false;
  let openingAborted = false;
  const transport: EchoReplicaTransport = Object.freeze({
    operations: Object.freeze({ async submit(request: EchoFiniteOperationRequest) {
      if (request.type !== "session-attach") throw new Error("Unexpected finite request.");
      return Object.freeze({ kind: "response" as const, outcome: Object.freeze({ type: "session-attached" as const,
        id: request.id, sessionId: "pending-open-session", epoch: 1,
        logicalMapId: locus.logicalMapId, incarnationId: locus.incarnationId }) });
    } }),
    attachment: Object.freeze({ observe(listener: (event: EchoAttachmentEvent) => void) { listener({ kind: "available" }); return () => {}; } }),
    synchronization: Object.freeze({ open(_request: EchoSynchronizationRequest, _observer: EchoSynchronizationObserver,
      options?: Readonly<{ signal?: EchoCancellationSignal }>) {
      opening = true;
      return new Promise<never>((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => { openingAborted = true; reject(new Error("Opening aborted.")); }, { once: true });
      });
    } }),
  });
  const prepared = prepare_echo_replica_internal({ now: session.now(), credential: session.credential!, transport });
  await prepared.attach();
  const completing = prepared.complete();
  void completing.catch(() => {});
  await until(() => opening);
  prepared.echo.dispose();
  assert.equal(openingAborted, true, "Echo disposal aborts a pending synchronization open");
  await assert.rejects(completing);
  locus.dispose();
}

// Content equality does not establish the retained session that produced now().
{
  const map = hsonLiveMap.fromLibraries({ state: { data: { value: 0 } } });
  const locus = create_registry_locus_internal({ map, libraries: [
    { name: "state", ownership: "shared" },
    { name: "ui", ownership: "local", initializer: { data: { value: 0 } } },
  ], authorizeProjection: ({ requested }) => ({ libraries: requested.libraries }) }, { maxHistoryBytes: 1 }).locus;
  const a = await locus.session.create({ libraries: ["state", "ui"] });
  const b = await locus.session.create({ libraries: ["state", "ui"] });
  assert.deepEqual(a.now().libs, b.now().libs);
  assert.deepEqual(a.now().local, b.now().local);
  assert.equal(a.now().initializerDigest, b.now().initializerDigest);
  assert.notEqual(a.now().sessionBinding, b.now().sessionBinding);
  assert.notEqual(a.now().sessionBinding, a.credential);
  const bindingA = a.now().sessionBinding;
  const mixedPair = socket_pair(); const detachMixed = bind_locus_websocket(locus, mixedPair.server);
  await assert.rejects(hsonLiveMap.echo.create({ now: a.now(), credential: b.credential!, transport: test_echo_transport(mixedPair.client) }),
    /binding|session/i);
  detachMixed();
  const c = await locus.session.create({ libraries: ["state"] });
  const differentPair = socket_pair(); const detachDifferent = bind_locus_websocket(locus, differentPair.server);
  await assert.rejects(hsonLiveMap.echo.create({ now: a.now(), credential: c.credential!, transport: test_echo_transport(differentPair.client) }),
    /binding|session|initializer|projection/i);
  detachDifferent();
  const validPair = socket_pair(); let detachValid = bind_locus_websocket(locus, validPair.server);
  const valid = await hsonLiveMap.echo.create({ now: a.now(), credential: a.credential!, transport: test_echo_transport(validPair.client) });
  assert.equal(valid.sync.status, "caught_up");
  const secondPair = socket_pair(); let detachSecond = bind_locus_websocket(locus, secondPair.server);
  const second = await hsonLiveMap.echo.create({ now: b.now(), credential: b.credential!, transport: test_echo_transport(secondPair.client) });
  const localA = valid.lib("ui"); const localB = second.lib("ui");
  if (localA.mode === "document" || localB.mode === "document"
    || localA.source !== "client-local" || localB.source !== "client-local") throw new Error("Expected local data Libraries.");
  const beforeLocal = locus.rev;
  localA.at(["value"]).set(12);
  localB.at(["value"]).set(20);
  assert.equal(localA.snap(["value"]), 12);
  assert.equal(localB.snap(["value"]), 20);
  assert.equal(locus.rev, beforeLocal);
  assert.equal(a.now().local[0]!.root.payload.includes("value 0>"), true);
  valid.disconnect(); second.disconnect();
  detachValid(); detachSecond();
  await locus.stage((draft) => {
    const state = draft.lib("state");
    state.at(["value"]).set(1);
  });
  detachValid = bind_locus_websocket(locus, validPair.server);
  detachSecond = bind_locus_websocket(locus, secondPair.server);
  valid.connect(); second.connect();
  await until(() => valid.sync.status === "caught_up" && second.sync.status === "caught_up");
  assert.equal(valid.sync.strategy, "reconcile");
  assert.equal(second.sync.strategy, "reconcile");
  assert.equal(localA.snap(["value"]), 12);
  assert.equal(localB.snap(["value"]), 20);
  assert.equal(a.now().sessionBinding, bindingA, "reattachment retains logical session provenance");
  assert.equal(a.now().local[0]!.root.payload.includes("value 0>"), true);
  valid.dispose(); second.dispose(); detachValid(); detachSecond(); locus.dispose();
}

// A transferred root is only structurally admitted. Equal revision and scope
// cannot establish that its contents were the authority's contents.
{
  const map = hsonLiveMap.fromLibraries({ state: { data: { value: 0 } } });
  const locus = hsonLiveMap.locus.create({ ...authority_groups_from_map_fixture(map, [{ name: "state", ownership: "shared" }]), authorizeProjection: () => ({ libraries: ["state"] }) });
  const session = await locus.session.create({ libraries: ["state"] });
  const cut = session.now();
  const forged = { ...cut, libs: { ...cut.libs, libraries: cut.libs.libraries.map((entry) => ({
    ...entry, root: { ...entry.root, payload: entry.root.payload.replace('value 0>', 'value 99>') },
  })) } };
  assert.notEqual(forged.libs.libraries[0]!.root.payload, cut.libs.libraries[0]!.root.payload);
  const pair = socket_pair(); const detach = bind_locus_websocket(locus, pair.server);
  const echo = await hsonLiveMap.echo.create({ now: forged, credential: session.credential!, transport: test_echo_transport(pair.client) });
  assert.equal(echo.sync.strategy, "reconcile");
  const state = echo.lib("state");
  if (state.mode === "document") throw new Error("Expected data.");
  assert.equal(state.snap(["value"]), 0);
  echo.dispose(); detach(); locus.dispose();
}

// A valid CSS value is also mutable projected state, even with an unchanged contract.
{
  const map = hsonLiveMap.fromLibraries({ page: { document: "<main/>" } });
  map.lib("page").css.stylesheet("main { color: red; }");
  const locus = hsonLiveMap.locus.create({ ...authority_groups_from_map_fixture(map, [{ name: "page", ownership: "shared" }]),
    authorizeProjection: () => ({ libraries: ["page"], writableDocuments: ["page"] }) });
  const session = await locus.session.create({ libraries: ["page"] });
  const cut = session.now();
  const forged = { ...cut, libs: { ...cut.libs, libraries: cut.libs.libraries.map((entry) => entry.css === undefined
    ? entry : { ...entry, css: { ...entry.css, rules: entry.css.rules.map((rule) => ({
      ...rule, declarations: rule.declarations.map(([name, value]): readonly [string, string] =>
        [name, value === "red" ? "blue" : value]),
    })) } }) } };
  const pair = socket_pair(); const detach = bind_locus_websocket(locus, pair.server);
  const echo = await hsonLiveMap.echo.create({ now: forged, credential: session.credential!, transport: test_echo_transport(pair.client) });
  assert.equal(echo.sync.strategy, "reconcile");
  const projectedPage = echo.lib("page");
  if (projectedPage.mode !== "document" || projectedPage.source !== "authority-projected")
    throw new Error("Expected projected document.");
  assert.equal(projectedPage.css.snapshot(), map.lib("page").css.snapshot());
  const beforeHostedCss = echo.rev;
  await projectedPage.css.stylesheet("main { color: blue; }");
  assert.match(projectedPage.css.snapshot(), /blue/);
  assert.equal(echo.rev, beforeHostedCss + 1);
  assert.equal(echo.sync.appliedRev, locus.rev);
  await projectedPage.css({ domain: "css", kind: "clear-all" });
  assert.equal(projectedPage.css.snapshot(), "");
  await projectedPage.at([]).attrs.set("title", "governed");
  assert.equal(projectedPage.at([]).attrs.get("title"), "governed");
  await projectedPage.at([]).insert(0, { $_tag: "p", $_content: [] });
  await projectedPage.at([0]).replace({ $_tag: "p", $_attrs: { title: "replaced" }, $_content: [] });
  assert.equal(projectedPage.at([0]).attrs.get("title"), "replaced");
  await projectedPage.at([0]).delete();
  echo.dispose(); detach(); locus.dispose();
}

// Authorized interaction state is part of content convergence, not the scope digest.
{
  const map = hsonLiveMap.fromLibraries({ page: { document: "<main <button/>/>" } });
  enable_interactions(map);
  const emptyMap = hsonLiveMap.fromLibraries({ page: { document: "<main <button/>/>" } });
  enable_interactions(emptyMap);
  const emptyLocus = hsonLiveMap.locus.create({ ...authority_groups_from_map_fixture(emptyMap, [{ name: "page", ownership: "shared" }]), authorizeProjection: () => ({ libraries: ["page"], systemFeatures: ["interactions"] }) });
  const emptySession = await emptyLocus.session.create({ libraries: ["page"], systemFeatures: ["interactions"] });
  const emptySystem = emptySession.now().libs.system;
  const descriptor: InteractionDescriptor = Object.freeze({
    id: "save-click",
    subject: Object.freeze({ library: "page", path: [0, 0, 0] }),
    kind: "locus",
    key: "save",
    payload: Hson.data.from({ value: 1 }),
    listener: Object.freeze({ event: "click", target: "element", capture: false, once: false,
      passive: false, missingTarget: "throw", preventDefault: false, stopPropagation: false,
      stopImmediatePropagation: false }),
  });
  add_interaction(map, descriptor);
  const locus = hsonLiveMap.locus.create({ ...authority_groups_from_map_fixture(map, [{ name: "page", ownership: "shared" }]), authorizeProjection: () => ({ libraries: ["page"], systemFeatures: ["interactions"] }) });
  const session = await locus.session.create({ libraries: ["page"], systemFeatures: ["interactions"] });
  const current = session.now();
  assert.notDeepEqual(current.libs.system, emptySystem);
  const mixed = { ...current, libs: { ...current.libs, system: emptySystem } };
  const pair = socket_pair(); const detach = bind_locus_websocket(locus, pair.server);
  const echo = await hsonLiveMap.echo.create({ now: mixed, credential: session.credential!, transport: test_echo_transport(pair.client) });
  assert.equal(echo.sync.strategy, "reconcile");
  assert.equal(echo.sync.status, "caught_up");
  echo.dispose(); detach(); locus.dispose(); emptyLocus.dispose();
}

// Once Echo has established continuity, reconnect retains current and replay
// optimizations. Recovery is automatic and actions wait for caught-up.
for (const [mutate, truncateHistory] of [[false, false], [true, false], [true, true]] as const) {
  const map = hsonLiveMap.fromLibraries({ state: { data: { value: 0 } } });
  const options: LocusRegistryOptions<typeof map> = { map, libraries: [{ name: "state", ownership: "shared" }],
    authorizeProjection: () => ({ libraries: ["state"] }) };
  const locus = truncateHistory ? create_registry_locus_internal(options, { maxHistoryBytes: 1 }).locus
    : hsonLiveMap.locus.create(authority_definition_from_fixture_options(options));
  const session = await locus.session.create({ libraries: ["state"] });
  const pair = socket_pair(); let detach = bind_locus_websocket(locus, pair.server);
  const echo = await hsonLiveMap.echo.create({ now: session.now(), credential: session.credential!, transport: test_echo_transport(pair.client) });
  echo.disconnect();
  detach();
  assert.equal(locus.session.debug().sessions[0]!.state, "disconnected");
  assert.equal(locus.session.debug().sessions[0]!.transportAttached, false);
  if (mutate) await locus.stage((draft) => {
    const state = draft.lib("state");
    state.at(["value"]).set(1);
  });
  pair.holdCaughtUp();
  detach = bind_locus_websocket(locus, pair.server);
  echo.connect(); echo.connect();
  await until(() => echo.session.status === "attached");
  assert.equal(echo.sync.status, "syncing");
  const sent = pair.actionFrames();
  await assert.rejects(echo.action("any" as never), /disconnect/i);
  assert.equal(pair.actionFrames(), sent, "action must not send before synchronization completes");
  pair.releaseCaughtUp();
  await until(() => echo.sync.status === "caught_up");
  assert.equal(echo.sync.strategy, truncateHistory ? "reconcile" : mutate ? "replay" : "current");
  assert.equal(locus.session.debug().reattachmentCount, 2, "one initial attach and one reconnect attach");
  echo.dispose(); detach(); locus.dispose();
}

for (const outcome of ["disposed", "rejected"] as const) {
  const map = hsonLiveMap.fromLibraries({ state: { data: { value: 0 } } });
  const locus = hsonLiveMap.locus.create({ ...authority_groups_from_map_fixture(map, [{ name: "state", ownership: "shared" }]), authorizeProjection: () => ({ libraries: ["state"] }) });
  const session = await locus.session.create({ libraries: ["state"] });
  const pair = socket_pair(); let detach = bind_locus_websocket(locus, pair.server);
  const echo = await hsonLiveMap.echo.create({ now: session.now(), credential: session.credential!, transport: test_echo_transport(pair.client) });
  echo.disconnect();
  detach();
  if (outcome === "rejected") {
    session.revoke();
    detach = bind_locus_websocket(locus, pair.server);
    echo.connect();
    await until(() => echo.sync.status === "failed");
    assert.ok(echo.sync.failure);
    assert.equal(echo.sync.debug().status, "failed");
  } else {
    pair.holdCaughtUp();
    detach = bind_locus_websocket(locus, pair.server);
    echo.connect();
    await until(() => echo.sync.status === "syncing");
    echo.dispose();
    pair.releaseCaughtUp();
    assert.equal(echo.sync.status, "disposed");
    assert.equal(echo.sync.debug().status, "disposed");
    assert.equal(echo.session.credential, undefined);
  }
  echo.dispose(); detach(); locus.dispose();
}

// Both transport listener installations roll back atomically.
for (const stage of ["message", "close"] as const) {
  const map = hsonLiveMap.fromLibraries({ state: { data: { value: 0 } } });
  const locus = hsonLiveMap.locus.create({ ...authority_groups_from_map_fixture(map, [{ name: "state", ownership: "shared" }]), authorizeProjection: () => ({ libraries: ["state"] }) });
  const session = await locus.session.create({ libraries: ["state"] });
  const beforeAttachment = locus.session.debug().sessions[0]!;
  const pair = socket_pair(); const detach = bind_locus_websocket(locus, pair.server);
  let fail = true;
  const socket: LocusWebSocketLike = {
    ...pair.client,
    onMessage(listener) {
      if (fail && stage === "message") throw new Error("message listener installation failed");
      return pair.client.onMessage(listener);
    },
    onClose(listener) {
      if (fail && stage === "close") throw new Error("close listener installation failed");
      return pair.client.onClose(listener);
    },
  };
  await assert.rejects(hsonLiveMap.echo.create({ now: session.now(), credential: session.credential!, transport: test_echo_transport(socket) }), /not submitted/);
  assert.equal(pair.clientListenerCount(), 0);
  assert.equal(locus.session.debug().sessions[0]!.activeConnectionEpoch, beforeAttachment.activeConnectionEpoch);
  fail = false;
  const echo = await hsonLiveMap.echo.create({ now: session.now(), credential: session.credential!, transport: test_echo_transport(socket) });
  assert.equal(echo.sync.status, "caught_up");
  echo.dispose(); detach(); locus.dispose();
}

{
  const map = hsonLiveMap.fromLibraries({ state: { data: { value: 0 } } });
  const locus = hsonLiveMap.locus.create({ ...authority_groups_from_map_fixture(map, [{ name: "state", ownership: "shared" }]), authorizeProjection: () => ({ libraries: ["state"] }) });
  const session = await locus.session.create({ libraries: ["state"] });
  const pair = socket_pair();
  const detach = bind_locus_websocket(locus, pair.server);
  await assert.rejects(hsonLiveMap.echo.create({ now: session.now(), credential: "invalid-credential", transport: test_echo_transport(pair.client) }));
  assert.equal(pair.clientListenerCount(), 0, "failed attachment releases transport listeners");
  const empty = await locus.session.create({ libraries: [] });
  assert.deepEqual(empty.now().libs.libraries, []);
  await assert.rejects(hsonLiveMap.echo.create({ now: empty.now(), credential: empty.credential!, transport: test_echo_transport(pair.client) }), /no LiveMap|application libraries/i);
  assert.equal(pair.clientListenerCount(), 0, "action-only cut does not create a replica endpoint");
  detach(); locus.dispose();
}

{
  const map = hsonLiveMap.fromLibraries({ state: { data: { value: 0 } } });
  const locus = hsonLiveMap.locus.create({ ...authority_groups_from_map_fixture(map, [{ name: "state", ownership: "shared" }]), authorizeProjection: () => ({ libraries: ["state"] }) });
  const session = await locus.session.create({ libraries: ["state"] }, { connection: { principalId: "alice" } });
  const pair = socket_pair();
  const detach = bind_locus_websocket(locus, pair.server, { principalId: "mallory" });
  await assert.rejects(hsonLiveMap.echo.create({ now: session.now(), credential: session.credential!, transport: test_echo_transport(pair.client) }));
  assert.equal(pair.clientListenerCount(), 0, "principal rejection releases transport listeners");
  detach(); locus.dispose();
}

{
  const map = hsonLiveMap.fromLibraries({ page: { document: "<main/>" } });
  const locus = hsonLiveMap.locus.create({ ...authority_groups_from_map_fixture(map, [{ name: "page", ownership: "shared" }]), authorizeProjection: () => ({ libraries: ["page"] }) });
  const session = await locus.session.create({ libraries: ["page"] });
  const cut = session.now();
  const quidRoot = encode_hosted_root(parse_hson_exact_runtime("<main @000000001/>", { allowTopLevelDocumentText: true }));
  const forged = { ...cut, libs: { ...cut.libs, libraries: cut.libs.libraries.map((entry) => ({ ...entry, root: quidRoot })) } };
  const pair = socket_pair();
  await assert.rejects(hsonLiveMap.echo.create({ now: forged, credential: session.credential!, transport: test_echo_transport(pair.client) }), /malformed/i);
  assert.equal(pair.clientListenerCount(), 0);
  locus.dispose();
}

// Local definitions are session-authorized initializers. Missing instances are
// installed once; existing client-owned state survives scope and sync changes.
{
  const StateSchema = Hson.schema`<type "data" content <value "number">>`;
  const LocalSchema = Hson.schema`<type "data" content <value "number">>`;
  const PanelSchema = Hson.schema`<type "document" tag "aside" content "empty">`;
  const cssSource = hsonLiveMap.fromLibraries({ panel: { document: "<aside/>", schema: PanelSchema } });
  cssSource.lib("panel").css.stylesheet("aside { color: red; }");
  const validCss = cssSource.capture().libraries[0]!.css!;
  const localDocument = (css: typeof validCss) => make_locus_application_catalog(hsonLiveMap.create(), [
    { name: "panel", ownership: "local", initializer: { document: "<aside/>", schema: PanelSchema }, css },
  ]);
  assert.doesNotThrow(() => localDocument(validCss));
  const callerCss = structuredClone(validCss);
  const detachedCatalog = localDocument(callerCss);
  (callerCss.rules[0]!.declarations[0] as unknown as string[])[1] = "blue";
  assert.match(JSON.stringify(detachedCatalog.local.get("panel")!.css), /red/);
  for (const change of [
    { selector: ":not(" }, { declaration: "red; color: blue" }, { declaration: "\"</style>\"" },
  ]) {
    const css = structuredClone(validCss);
    if ("selector" in change) (css.rules[0] as { selector: string }).selector = change.selector!;
    else (css.rules[0]!.declarations[0] as unknown as string[])[1] = change.declaration!;
    assert.throws(() => localDocument(css), /CSS|selector|declaration|RAWTEXT|style|syntax|duplicate/i);
  }
  const authority = hsonLiveMap.fromLibraries({ state: { data: { value: 0 }, schema: StateSchema } });
  const options: LocusRegistryOptions<typeof authority> = {
    map: authority,
    libraries: [
      { name: "state", ownership: "shared" },
      { name: "ui", ownership: "local", initializer: { data: { value: 0 } } },
      { name: "panel", ownership: "local", initializer: { document: "<aside/>", schema: PanelSchema },
        css: cssSource.capture().libraries[0]!.css },
    ],
    authorizeProjection: ({ requested }) => ({ libraries: requested.libraries, writableDocuments: ["panel"] }),
  };
  const locus = create_registry_locus_internal(options, { maxHistoryBytes: 1 }).locus;
  const immutableA = await locus.session.create({ libraries: ["panel", "ui"] });
  const immutableB = await locus.session.create({ libraries: ["panel", "ui"] });
  const first = immutableA.now();
  const originalLocal = structuredClone(immutableB.now().local);
  const originalDigest = immutableB.now().initializerDigest;
  const mutateReachable = (value: unknown): void => {
    if (typeof value !== "object" || value === null) return;
    for (const child of Object.values(value)) mutateReachable(child);
    try { (value as Record<string, unknown>).tampered = true; } catch { /* frozen value */ }
    if (Array.isArray(value)) try { value.push("tampered"); } catch { /* frozen array */ }
  };
  mutateReachable(first.local);
  assert.deepEqual(immutableB.now().local, originalLocal);
  assert.equal(immutableB.now().initializerDigest, originalDigest);
  assert.doesNotThrow(() => admit_locus_session_now(immutableB.now()));
  const cssRule = first.local.find((entry) => entry.name === "panel")!.css!.rules[0]!;
  assert.throws(() => { (cssRule.declarations[0] as unknown as string[])[1] = "green"; }, TypeError);
  assert.match(JSON.stringify(immutableB.now().local), /red/);
  assert.throws(() => locus.lib("ui"), /unknown/i, "local definitions never enter locus_map_internal(locus)");
  assert.throws(() => hsonLiveMap.locus.create({
    shared: [{ name: "state", definition: { data: { value: 0 }, schema: StateSchema } }],
    local: [{ name: "state", initializer: { data: { value: 9 }, schema: StateSchema } }],
  } as never), /duplicate/i, "authority and local names cannot collide");
  assert.throws(() => hsonLiveMap.locus.create({
    shared: [{ name: "state", definition: { data: { value: 0 }, schema: StateSchema } }],
    local: [{ name: "tainted", initializer: {
      document: parse_hson_exact_runtime("<aside @000000321/>", { allowTopLevelDocumentText: true }), schema: PanelSchema,
    } },
  ] }), /QUID|portable|identity|malformed/i);

  const session = await locus.session.create({ libraries: ["state"] });
  assert.deepEqual(session.now().local, []);
  const pair = socket_pair();
  let detach = bind_locus_websocket(locus, pair.server);
  const echo = await hsonLiveMap.echo.create({ now: session.now(), credential: session.credential!, transport: test_echo_transport(pair.client) });
  assert.throws(() => echo.lib("ui"), /unknown/i);
  const beforeTopologyRev = echo.rev;
  const beforeTopologyRegistry = echo_map_internal(echo).capture().registryDigest;
  const beforeAuthorityCursor = echo.sync.appliedRev;
  let topologyCommits = 0;
  const stopTopologyCommits = echo.commits.observe(() => { topologyCommits += 1; });
  assert.throws(() => echo_map_internal(echo).addLibraries({ ui: { data: { value: 99 } } }), /managed|authority|controlled/i);
  assert.throws(() => echo_map_internal(echo).addLibraries({ extraPage: { document: "<main/>" } }), /managed|authority|controlled/i);
  const replaySource = hsonLiveMap.create();
  const topologyCommit = replaySource.addLibraries({ replayedLocal: { data: { value: 99 } } });
  assert.throws(() => echo_map_internal(echo).replay(topologyCommit), /managed|authority|controlled/i);
  stopTopologyCommits();
  assert.equal(echo.rev, beforeTopologyRev);
  assert.equal(echo_map_internal(echo).capture().registryDigest, beforeTopologyRegistry);
  assert.equal(echo.sync.appliedRev, beforeAuthorityCursor);
  assert.equal(topologyCommits, 0);
  assert.throws(() => echo.lib("extraPage"), /unknown/i);
  assert.throws(() => echo.lib("replayedLocal"), /unknown/i);

  await session.update({ libraries: ["state", "ui", "panel"] });
  await until(() => {
    try { return echo.lib("ui").mode === "data-object" && echo.lib("panel").mode === "document"; }
    catch { return false; }
  });
  const ui = echo.lib("ui");
  const panel = echo.lib("panel");
  assert.equal(echo.sync.status, "caught_up", "a later authorized initializer grant remains healthy");
  if (ui.mode === "document" || panel.mode !== "document"
    || ui.source !== "client-local" || panel.source !== "client-local") throw new Error("Local initializer mode mismatch.");
  assert.equal(ui.snap(["value"]), 0);
  assert.match(JSON.stringify(panel.css.snapshot()), /red/);
  assert.deepEqual(session.now().libs.writableDocuments, [], "local documents cannot acquire server write authority");
  const authorityRevBeforeLocal = locus.rev;
  ui.at(["value"]).set(12);
  panel.css.stylesheet("aside { color: blue; }");
  assert.equal(locus.rev, authorityRevBeforeLocal, "local mutation never enters authority history");
  assert.doesNotThrow(() => ui.schema.use(LocalSchema as never));
  assert.equal(ui.schema.get().toHson(), LocalSchema.toHson());
  const projectedState = echo.lib("state");
  assert.equal(projectedState.source, "authority-projected");
  assert.equal("use" in projectedState.schema, false);
  if (projectedState.mode !== "document") assert.equal(projectedState.at([]).at(["value"]).snap(), 0);

  await session.update({ libraries: ["state"] });
  assert.equal(ui.snap(["value"]), 12, "scope removal is non-destructive");
  await session.update({ libraries: ["state", "ui", "panel"] });
  assert.equal(echo.lib("ui"), ui);
  assert.equal(ui.snap(["value"]), 12, "remove/re-add does not reapply the seed");
  assert.equal(ui.schema.get().toHson(), LocalSchema.toHson(), "re-add preserves the evolved local Schema");

  echo.disconnect();
  detach();
  await locus.stage((draft) => {
    const state = draft.lib("state");
    state.at(["value"]).set(1);
  });
  detach = bind_locus_websocket(locus, pair.server);
  echo.connect();
  await until(() => echo.sync.status === "caught_up");
  assert.equal(echo.sync.strategy, "reconcile");
  assert.equal(ui.snap(["value"]), 12);
  assert.match(JSON.stringify(panel.css.snapshot()), /blue/);
  const cssReplayRev = echo.rev;
  const cssReplay = echo_map_internal(echo).replay({ kind: "map", changed: true, prevRev: cssReplayRev, rev: cssReplayRev + 1,
    operations: [{ library: "panel", operation: { domain: "css", kind: "replace", stylesheet: validCss } }] });
  assert.equal(cssReplay.changed, true, "public replay of local CSS remains available");
  assert.match(JSON.stringify(panel.css.snapshot()), /red/);

  const changedSeed = make_locus_application_catalog(hsonLiveMap.create(), [
    { name: "ui", ownership: "local", initializer: { data: { value: 5 } } },
  ]).local.get("ui")!;
  install_client_local_initializers_internal(echo_map_internal(echo), [changedSeed]);
  assert.equal(ui.snap(["value"]), 12, "a changed compatible seed never overwrites existing local state");
  const incompatibleSeed = make_locus_application_catalog(hsonLiveMap.create(), [
    { name: "ui", ownership: "local", initializer: { data: { value: 5 }, schema: LocalSchema } },
  ]).local.get("ui")!;
  assert.throws(() => install_client_local_initializers_internal(echo_map_internal(echo), [incompatibleSeed]), /incompatible/i);

  const unauthorized = await locus.session.create({ libraries: ["state"] });
  assert.deepEqual(unauthorized.now().local, []);

  const freshSession = await locus.session.create({ libraries: ["state", "ui", "panel"] });
  const carried = decode_ssr_bootstrap(encode_ssr_bootstrap(freshSession.now()));
  assert.equal(carried.kind, "hosted-projection");
  if (carried.kind !== "hosted-projection") throw new Error("Expected hosted current-state carrier.");
  assert.deepEqual(carried.bootstrap.local.map(({ name }) => name), ["panel", "ui"]);
  const freshPair = socket_pair();
  const detachFresh = bind_locus_websocket(locus, freshPair.server);
  const fresh = await hsonLiveMap.echo.create({ now: freshSession.now(), credential: freshSession.credential!, transport: test_echo_transport(freshPair.client) });
  const freshUi = fresh.lib("ui");
  if (freshUi.mode === "document" || freshUi.source !== "client-local") throw new Error("Expected fresh local data Library.");
  assert.equal(freshUi.snap(["value"]), 0);
  const freshPanel = fresh.lib("panel");
  if (freshPanel.mode !== "document") throw new Error("Expected fresh local document.");
  assert.match(JSON.stringify(freshPanel.css.snapshot()), /red/);
  fresh.dispose(); detachFresh();

  const authorized = await locus.session.create({ libraries: ["state", "ui"] });
  const authentic = authorized.now();
  const original = authentic.local[0]!;
  const root = Object.freeze({ ...original.root, payload: original.root.payload.replace("value 0>", "value 99>") });
  const { fingerprint: _originalFingerprint, ...definition } = original;
  const withoutFingerprint = Object.freeze({ ...definition, root });
  const altered: typeof original = Object.freeze({ ...withoutFingerprint,
    fingerprint: hosted_sha256(JSON.stringify({ format: "hson-local-initializer", ...withoutFingerprint })) });
  const tampered = Object.freeze({ ...authentic, local: Object.freeze([altered]),
    initializerDigest: hosted_sha256(JSON.stringify({ format: "hson-local-initializer-set",
      initializers: [{ name: altered.name, fingerprint: altered.fingerprint }] })) });
  const tamperPair = socket_pair();
  const detachTamper = bind_locus_websocket(locus, tamperPair.server);
  await assert.rejects(hsonLiveMap.echo.create({ now: tampered as typeof authentic,
    credential: authorized.credential!, transport: test_echo_transport(tamperPair.client) }), /initializer|integrity|sync/i);

  echo.dispose(); detachTamper(); detach(); locus.dispose();
}

// The composed clock and processed-authority cursor intentionally diverge.
{
  const map = hsonLiveMap.fromLibraries({
    visible: { data: { value: 0 } }, hidden: { data: { value: 0 } },
  });
  const locus = create_registry_locus_internal({
    map,
    libraries: [
      { name: "visible", ownership: "shared" },
      { name: "hidden", ownership: "private" },
      { name: "local", ownership: "local", initializer: { data: { value: 0 } } },
    ],
    authorizeProjection: ({ requested }) => ({ libraries: requested.libraries }),
  }, { maxHistoryBytes: 1 }).locus;
  const session = await locus.session.create({ libraries: ["visible"] });
  const pair = socket_pair();
  let detach = bind_locus_websocket(locus, pair.server);
  const echo = await hsonLiveMap.echo.create({ now: session.now(), credential: session.credential!, transport: test_echo_transport(pair.client) });
  assert.equal("map" in echo, false);
  assert.equal(echo.sync.appliedRev, locus.rev);
  assert.deepEqual(echo.cut().libs.libraries.map((entry) => entry.name), ["visible"]);
  const composedCommits: number[] = [];
  const stopComposedCommits = echo.commits.observe((commit) => composedCommits.push(commit.rev));

  const initialRev = echo.rev;
  await locus.lib("hidden").at(["value"]).set(1);
  await until(() => echo.sync.appliedRev === locus.rev);
  assert.equal(echo.rev, initialRev, "private progress has no composed-state commit");
  assert.deepEqual(composedCommits, []);

  await locus.lib("visible").at(["value"]).set(1);
  await until(() => echo.sync.appliedRev === locus.rev);
  assert.equal(echo.rev, initialRev + 1, "visible authority commit changes composed state");
  assert.deepEqual(composedCommits, [echo.rev]);

  const beforeGrantRev = echo.rev;
  const beforeGrantApplied = echo.sync.appliedRev;
  const beforeGrantAuthority = locus.rev;
  await session.update({ libraries: ["visible", "local"] });
  await until(() => { try { return echo.lib("local").source === "client-local"; } catch { return false; } });
  assert.equal(echo.rev, beforeGrantRev + 1, "late initializer installs client-local topology");
  assert.equal(echo.sync.appliedRev, beforeGrantApplied);
  assert.equal(locus.rev, beforeGrantAuthority);
  assert.deepEqual(echo.cut().libs.libraries.map((entry) => entry.name), ["visible", "local"]);

  const local = echo.lib("local");
  if (local.source !== "client-local" || local.mode === "document") throw new Error("Expected local data handle.");
  const beforeLocalRev = echo.rev;
  local.at(["value"]).set(2);
  assert.equal(echo.rev, beforeLocalRev + 1);
  assert.equal(echo.sync.appliedRev, beforeGrantApplied);

  echo.disconnect(); detach();
  const beforeSnapshotRev = echo.rev;
  await locus.lib("hidden").at(["value"]).set(2);
  detach = bind_locus_websocket(locus, pair.server);
  echo.connect();
  await echo.session.reattach();
  assert.equal(echo.sync.strategy, "reconcile");
  assert.equal(echo.sync.appliedRev, locus.rev, "snapshot installs recovered authority position");
  assert.equal(echo.rev, beforeSnapshotRev, "unchanged composed state keeps its revision");
  assert.equal(local.at(["value"]).snap(), 2);
  assert.equal(composedCommits.at(-1), echo.rev);
  const oldVisible = echo.lib("visible");
  await session.update({ libraries: ["local"] });
  await until(() => { try { echo.lib("visible"); return false; } catch { return true; } });
  await session.update({ libraries: ["visible", "local"] });
  await until(() => { try { return echo.lib("visible").source === "authority-projected"; } catch { return false; } });
  assert.notEqual(echo.lib("visible"), oldVisible, "regranted projected library gets a fresh governed handle");
  assert.equal(echo.lib("local"), local, "client-local handle retains identity across grant changes");
  stopComposedCommits();
  echo.dispose(); detach(); locus.dispose();
}

console.log("Echo initialization and sync current, replay, reconcile, local ownership, admission, QUID fencing, and failure cleanup passed.");
