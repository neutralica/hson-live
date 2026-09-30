import assert from "node:assert/strict";
import { Hson, add_interaction, decode_ssr_bootstrap, enable_interactions, encode_ssr_bootstrap, hsonEcho, hsonLiveMap, hsonLocus,
  type InteractionDescriptor, type Locus, type LocusOptions, type LocusSocketLike } from "../src/index.ts";
import { create_registry_locus_internal } from "../src/api/locus/locus.registry.ts";
import { encode_hosted_root, hosted_sha256 } from "../src/api/livemap/livemap.hosted.ts";
import { parse_hson_exact_runtime } from "../src/internal/exact-runtime-hson-codec.ts";
import { install_client_local_initializers_internal, make_locus_application_catalog } from "../src/api/locus/locus.local-initializer.ts";

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
  const client: LocusSocketLike = {
    send(raw) {
      if (JSON.parse(raw).type === "action") actionFrames++;
      for (const listener of [...toServer]) listener(raw);
    }, close() {},
    onMessage(listener) { toClient.add(listener); return () => { toClient.delete(listener); }; },
    onClose() { return () => {}; },
  };
  const server: LocusSocketLike = {
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
  const options: LocusOptions<typeof map> = {
    map,
    libraries: [{ name: "state", ownership: "shared" as const }],
    defaultProjection: { libraries: ["state"] },
    authorizeProjection: () => ({ libraries: ["state"] }),
  };
  const locus: Locus<typeof map> = truncateHistory
    ? create_registry_locus_internal(options, { maxHistoryBytes: 1 }).locus
    : hsonLocus.create(options);
  const session = await locus.session.create({ libraries: ["state"] });
  const cut = session.now();
  if (advance) await locus.mutate((draft) => {
    const state = draft.lib("state");
    if (!("at" in state)) throw new Error("Expected a data draft.");
    state.at(["value"]).set(1);
  });
  const pair = socket_pair();
  const detach = locus.connect(pair.server);
  if (expected === "current") {
    await assert.rejects(hsonEcho.init({ now: { ...cut, libs: { ...cut.libs, projectionDigest: "0".repeat(64) } },
      credential: session.credential!, socket: pair.client }), /digest|projection/i);
    assert.equal(pair.clientListenerCount(), 0, "invalid cut does not install transport listeners");
    const ahead = socket_pair();
    const detachAhead = locus.connect(ahead.server);
    await assert.rejects(hsonEcho.init({ now: { ...cut, libs: { ...cut.libs, revision: cut.libs.revision + 1 } },
      credential: session.credential!, socket: ahead.client }), /ahead|synchronization/i);
    assert.equal(ahead.clientListenerCount(), 0, "failed synchronization releases transport listeners");
    const retained = locus.session.debug().sessions[0]!;
    assert.equal(retained.state, "disconnected", "failed establishment detaches the authority session");
    assert.equal(retained.transportAttached, false);
    assert.equal(retained.resumable, true);
    assert.ok(retained.expiresAt);
    detachAhead();
  }
  const echo = await hsonEcho.init({ now: cut, credential: session.credential!, socket: pair.client });
  assert.equal(echo.session.status, "attached");
  assert.equal(echo.sync.status, "caught_up");
  assert.equal(echo.sync.strategy, expected);
  assert.equal(echo.sync.debug().lastAppliedRev, locus.rev);
  assert.equal(echo.session.credential, session.credential);
  const state = echo.map.lib("state");
  if (state.mode === "document") throw new Error("Expected a data library.");
  assert.equal(state.snap(["value"]), expected === "current" ? 0 : 1);
  assert.throws(() => state.at(["value"]).set(2), /authority|managed|controlled|reserved/i);
  echo.dispose();
  assert.equal(echo.session.credential, undefined);
  assert.equal(echo.sync.status, "disposed");
  assert.equal(echo.sync.debug().status, "disposed");
  assert.equal(pair.clientListenerCount(), 0);
  detach(); locus.dispose();
}

// A transferred root is only structurally admitted. Equal revision and scope
// cannot establish that its contents were the authority's contents.
{
  const map = hsonLiveMap.fromLibraries({ state: { data: { value: 0 } } });
  const locus = hsonLocus.create({ map, libraries: [{ name: "state", ownership: "shared" }],
    authorizeProjection: () => ({ libraries: ["state"] }) });
  const session = await locus.session.create({ libraries: ["state"] });
  const cut = session.now();
  const forged = { ...cut, libs: { ...cut.libs, libraries: cut.libs.libraries.map((entry) => ({
    ...entry, root: { ...entry.root, payload: entry.root.payload.replace('value 0>', 'value 99>') },
  })) } };
  assert.notEqual(forged.libs.libraries[0]!.root.payload, cut.libs.libraries[0]!.root.payload);
  const pair = socket_pair(); const detach = locus.connect(pair.server);
  const echo = await hsonEcho.init({ now: forged, credential: session.credential!, socket: pair.client });
  assert.equal(echo.sync.strategy, "reconcile");
  const state = echo.map.lib("state");
  if (state.mode === "document") throw new Error("Expected data.");
  assert.equal(state.snap(["value"]), 0);
  echo.dispose(); detach(); locus.dispose();
}

// A valid CSS value is also mutable projected state, even with an unchanged contract.
{
  const map = hsonLiveMap.fromLibraries({ page: { document: "<main/>" } });
  map.lib("page").css.stylesheet("main { color: red; }");
  const locus = hsonLocus.create({ map, libraries: [{ name: "page", ownership: "shared" }],
    authorizeProjection: () => ({ libraries: ["page"] }) });
  const session = await locus.session.create({ libraries: ["page"] });
  const cut = session.now();
  const forged = { ...cut, libs: { ...cut.libs, libraries: cut.libs.libraries.map((entry) => entry.css === undefined
    ? entry : { ...entry, css: { ...entry.css, rules: entry.css.rules.map((rule) => ({
      ...rule, declarations: rule.declarations.map(([name, value]): readonly [string, string] =>
        [name, value === "red" ? "blue" : value]),
    })) } }) } };
  const pair = socket_pair(); const detach = locus.connect(pair.server);
  const echo = await hsonEcho.init({ now: forged, credential: session.credential!, socket: pair.client });
  assert.equal(echo.sync.strategy, "reconcile");
  assert.equal(echo.map.lib("page").css.snapshot(), map.lib("page").css.snapshot());
  echo.dispose(); detach(); locus.dispose();
}

// Authorized interaction state is part of content convergence, not the scope digest.
{
  const map = hsonLiveMap.fromLibraries({ page: { document: "<main <button/>/>" } });
  enable_interactions(map);
  const emptyMap = hsonLiveMap.fromLibraries({ page: { document: "<main <button/>/>" } });
  enable_interactions(emptyMap);
  const emptyLocus = hsonLocus.create({ map: emptyMap, libraries: [{ name: "page", ownership: "shared" }],
    authorizeProjection: () => ({ libraries: ["page"], systemFeatures: ["interactions"] }) });
  const emptySession = await emptyLocus.session.create({ libraries: ["page"], systemFeatures: ["interactions"] });
  const emptySystem = emptySession.now().libs.system;
  const descriptor: InteractionDescriptor = Object.freeze({
    id: "save-click",
    subject: Object.freeze({ library: "page", path: [0, 0, 0] }),
    kind: "locus-authoritative",
    key: "save",
    payload: Hson.data.from({ value: 1 }),
    listener: Object.freeze({ event: "click", target: "element", capture: false, once: false,
      passive: false, missingTarget: "throw", preventDefault: false, stopPropagation: false,
      stopImmediatePropagation: false }),
  });
  add_interaction(map, descriptor);
  const locus = hsonLocus.create({ map, libraries: [{ name: "page", ownership: "shared" }],
    authorizeProjection: () => ({ libraries: ["page"], systemFeatures: ["interactions"] }) });
  const session = await locus.session.create({ libraries: ["page"], systemFeatures: ["interactions"] });
  const current = session.now();
  assert.notDeepEqual(current.libs.system, emptySystem);
  const mixed = { ...current, libs: { ...current.libs, system: emptySystem } };
  const pair = socket_pair(); const detach = locus.connect(pair.server);
  const echo = await hsonEcho.init({ now: mixed, credential: session.credential!, socket: pair.client });
  assert.equal(echo.sync.strategy, "reconcile");
  assert.equal(echo.sync.status, "caught_up");
  echo.dispose(); detach(); locus.dispose(); emptyLocus.dispose();
}

// Once Echo has established continuity, reconnect retains current and replay
// optimizations. Recovery is automatic and actions wait for caught-up.
for (const [mutate, truncateHistory] of [[false, false], [true, false], [true, true]] as const) {
  const map = hsonLiveMap.fromLibraries({ state: { data: { value: 0 } } });
  const options: LocusOptions<typeof map> = { map, libraries: [{ name: "state", ownership: "shared" }],
    authorizeProjection: () => ({ libraries: ["state"] }) };
  const locus = truncateHistory ? create_registry_locus_internal(options, { maxHistoryBytes: 1 }).locus
    : hsonLocus.create(options);
  const session = await locus.session.create({ libraries: ["state"] });
  const pair = socket_pair(); const detach = locus.connect(pair.server);
  const echo = await hsonEcho.init({ now: session.now(), credential: session.credential!, socket: pair.client });
  echo.disconnect();
  assert.equal(locus.session.debug().sessions[0]!.state, "disconnected");
  assert.equal(locus.session.debug().sessions[0]!.transportAttached, false);
  if (mutate) await locus.mutate((draft) => {
    const state = draft.lib("state");
    if ("at" in state) state.at(["value"]).set(1);
  });
  pair.holdCaughtUp();
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
  const locus = hsonLocus.create({ map, libraries: [{ name: "state", ownership: "shared" }],
    authorizeProjection: () => ({ libraries: ["state"] }) });
  const session = await locus.session.create({ libraries: ["state"] });
  const pair = socket_pair(); const detach = locus.connect(pair.server);
  const echo = await hsonEcho.init({ now: session.now(), credential: session.credential!, socket: pair.client });
  echo.disconnect();
  if (outcome === "rejected") {
    session.revoke();
    echo.connect();
    await until(() => echo.sync.status === "failed");
    assert.ok(echo.sync.failure);
    assert.equal(echo.sync.debug().status, "failed");
  } else {
    pair.holdCaughtUp();
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
  const locus = hsonLocus.create({ map, libraries: [{ name: "state", ownership: "shared" }],
    authorizeProjection: () => ({ libraries: ["state"] }) });
  const session = await locus.session.create({ libraries: ["state"] });
  const beforeAttachment = locus.session.debug().sessions[0]!;
  const pair = socket_pair(); const detach = locus.connect(pair.server);
  let fail = true;
  const socket: LocusSocketLike = {
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
  await assert.rejects(hsonEcho.init({ now: session.now(), credential: session.credential!, socket }), /listener installation failed/);
  assert.equal(pair.clientListenerCount(), 0);
  assert.equal(locus.session.debug().sessions[0]!.activeConnectionEpoch, beforeAttachment.activeConnectionEpoch);
  fail = false;
  const echo = await hsonEcho.init({ now: session.now(), credential: session.credential!, socket });
  assert.equal(echo.sync.status, "caught_up");
  echo.dispose(); detach(); locus.dispose();
}

{
  const map = hsonLiveMap.fromLibraries({ state: { data: { value: 0 } } });
  const locus = hsonLocus.create({ map,
    libraries: [{ name: "state", ownership: "shared" }],
    authorizeProjection: () => ({ libraries: ["state"] }),
  });
  const session = await locus.session.create({ libraries: ["state"] });
  const pair = socket_pair();
  const detach = locus.connect(pair.server);
  await assert.rejects(hsonEcho.init({ now: session.now(), credential: "invalid-credential", socket: pair.client }));
  assert.equal(pair.clientListenerCount(), 0, "failed attachment releases transport listeners");
  const empty = await locus.session.create({ libraries: [] });
  assert.deepEqual(empty.now().libs.libraries, []);
  await assert.rejects(hsonEcho.init({ now: empty.now(), credential: empty.credential!, socket: pair.client }), /no LiveMap|application libraries/i);
  assert.equal(pair.clientListenerCount(), 0, "action-only cut does not create a replica endpoint");
  detach(); locus.dispose();
}

{
  const map = hsonLiveMap.fromLibraries({ state: { data: { value: 0 } } });
  const locus = hsonLocus.create({ map,
    libraries: [{ name: "state", ownership: "shared" }],
    authorizeProjection: () => ({ libraries: ["state"] }),
  });
  const session = await locus.session.create({ libraries: ["state"] }, { connection: { principalId: "alice" } });
  const pair = socket_pair();
  const detach = locus.connect(pair.server, { principalId: "mallory" });
  await assert.rejects(hsonEcho.init({ now: session.now(), credential: session.credential!, socket: pair.client }));
  assert.equal(pair.clientListenerCount(), 0, "principal rejection releases transport listeners");
  detach(); locus.dispose();
}

{
  const map = hsonLiveMap.fromLibraries({ page: { document: "<main/>" } });
  const locus = hsonLocus.create({ map,
    libraries: [{ name: "page", ownership: "shared" }],
    authorizeProjection: () => ({ libraries: ["page"] }),
  });
  const session = await locus.session.create({ libraries: ["page"] });
  const cut = session.now();
  const quidRoot = encode_hosted_root(parse_hson_exact_runtime("<main @000000001/>", { allowTopLevelDocumentText: true }));
  const forged = { ...cut, libs: { ...cut.libs, libraries: cut.libs.libraries.map((entry) => ({ ...entry, root: quidRoot })) } };
  const pair = socket_pair();
  await assert.rejects(hsonEcho.init({ now: forged, credential: session.credential!, socket: pair.client }), /malformed/i);
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
  const authority = hsonLiveMap.fromLibraries({ state: { data: { value: 0 }, schema: StateSchema } });
  const options: LocusOptions<typeof authority> = {
    map: authority,
    libraries: [
      { name: "state", ownership: "shared" },
      { name: "ui", ownership: "local", initializer: { data: { value: 0 }, schema: LocalSchema } },
      { name: "panel", ownership: "local", initializer: { document: "<aside/>", schema: PanelSchema },
        css: cssSource.capture().libraries[0]!.css },
    ],
    authorizeProjection: ({ requested }) => ({ libraries: requested.libraries, writableDocuments: ["panel"] }),
  };
  const locus = create_registry_locus_internal(options, { maxHistoryBytes: 1 }).locus;
  assert.throws(() => locus.map.lib("ui"), /unknown/i, "local definitions never enter locus.map");
  const collisionAuthority = hsonLiveMap.fromLibraries({ state: { data: { value: 0 }, schema: StateSchema } });
  assert.throws(() => hsonLocus.create({ map: collisionAuthority, libraries: [
    { name: "state", ownership: "local", initializer: { data: { value: 9 }, schema: StateSchema } },
  ] }), /collides/i, "authority state cannot be relabeled local");
  const taintedAuthority = hsonLiveMap.fromLibraries({ state: { data: { value: 0 }, schema: StateSchema } });
  assert.throws(() => hsonLocus.create({ map: taintedAuthority, libraries: [
    { name: "state", ownership: "shared" },
    { name: "tainted", ownership: "local", initializer: {
      document: parse_hson_exact_runtime("<aside @000000321/>", { allowTopLevelDocumentText: true }), schema: PanelSchema,
    } },
  ] }), /QUID|portable|identity|malformed/i);

  const session = await locus.session.create({ libraries: ["state"] });
  assert.deepEqual(session.now().local, []);
  const pair = socket_pair();
  const detach = locus.connect(pair.server);
  const echo = await hsonEcho.init({ now: session.now(), credential: session.credential!, socket: pair.client });
  assert.throws(() => echo.map.lib("ui"), /unknown/i);

  await session.update({ libraries: ["state", "ui", "panel"] });
  await until(() => {
    try { return echo.map.lib("ui").mode === "data-object" && echo.map.lib("panel").mode === "document"; }
    catch { return false; }
  });
  const ui = echo.map.lib("ui");
  const panel = echo.map.lib("panel");
  if (ui.mode === "document" || panel.mode !== "document") throw new Error("Local initializer mode mismatch.");
  assert.equal(ui.snap(["value"]), 0);
  assert.match(JSON.stringify(panel.css.snapshot()), /red/);
  assert.deepEqual(session.now().libs.writableDocuments, [], "local documents cannot acquire server write authority");
  const authorityRevBeforeLocal = locus.rev;
  ui.at(["value"]).set(12);
  panel.css.stylesheet("aside { color: blue; }");
  assert.equal(locus.rev, authorityRevBeforeLocal, "local mutation never enters authority history");
  assert.doesNotThrow(() => ui.schema.use(LocalSchema));
  assert.throws(() => echo.map.lib("state").schema.use(StateSchema), /authority|projected|managed/i);

  await session.update({ libraries: ["state"] });
  assert.equal(ui.snap(["value"]), 12, "scope removal is non-destructive");
  await session.update({ libraries: ["state", "ui", "panel"] });
  assert.equal(echo.map.lib("ui"), ui);
  assert.equal(ui.snap(["value"]), 12, "remove/re-add does not reapply the seed");

  echo.disconnect();
  await locus.mutate((draft) => {
    const state = draft.lib("state");
    if ("at" in state) state.at(["value"]).set(1);
  });
  echo.connect();
  await until(() => echo.sync.status === "caught_up");
  assert.equal(echo.sync.strategy, "reconcile");
  assert.equal(ui.snap(["value"]), 12);
  assert.match(JSON.stringify(panel.css.snapshot()), /blue/);

  const changedSeed = make_locus_application_catalog(hsonLiveMap.create(), [
    { name: "ui", ownership: "local", initializer: { data: { value: 5 }, schema: LocalSchema } },
  ]).local.get("ui")!;
  install_client_local_initializers_internal(echo.map, [changedSeed]);
  assert.equal(ui.snap(["value"]), 12, "a changed compatible seed never overwrites existing local state");
  const incompatibleSeed = make_locus_application_catalog(hsonLiveMap.create(), [
    { name: "ui", ownership: "local", initializer: { data: { value: 5 } } },
  ]).local.get("ui")!;
  assert.throws(() => install_client_local_initializers_internal(echo.map, [incompatibleSeed]), /incompatible/i);

  const unauthorized = await locus.session.create({ libraries: ["state"] });
  assert.deepEqual(unauthorized.now().local, []);

  const freshSession = await locus.session.create({ libraries: ["state", "ui", "panel"] });
  const carried = decode_ssr_bootstrap(encode_ssr_bootstrap(freshSession.now()));
  assert.equal(carried.kind, "hosted-projection");
  if (carried.kind !== "hosted-projection") throw new Error("Expected hosted current-state carrier.");
  assert.deepEqual(carried.bootstrap.local.map(({ name }) => name), ["panel", "ui"]);
  const freshPair = socket_pair();
  const detachFresh = locus.connect(freshPair.server);
  const fresh = await hsonEcho.init({ now: freshSession.now(), credential: freshSession.credential!, socket: freshPair.client });
  const freshUi = fresh.map.lib("ui");
  if (freshUi.mode === "document") throw new Error("Expected fresh local data Library.");
  assert.equal(freshUi.snap(["value"]), 0);
  assert.match(JSON.stringify(fresh.map.lib("panel").css.snapshot()), /red/);
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
  const detachTamper = locus.connect(tamperPair.server);
  await assert.rejects(hsonEcho.init({ now: tampered as typeof authentic,
    credential: authorized.credential!, socket: tamperPair.client }), /initializer|integrity|sync/i);

  echo.dispose(); detachTamper(); detach(); locus.dispose();
}

console.log("Echo initialization and sync current, replay, reconcile, local ownership, admission, QUID fencing, and failure cleanup passed.");
