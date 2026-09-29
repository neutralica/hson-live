import assert from "node:assert/strict";
import { Hson, add_interaction, enable_interactions, hsonEcho, hsonLiveMap, hsonLocus,
  type InteractionDescriptor, type Locus, type LocusOptions, type LocusSocketLike } from "../src/index.ts";
import { create_registry_locus_internal } from "../src/api/locus/locus.registry.ts";
import { encode_hosted_root } from "../src/api/livemap/livemap.hosted.ts";
import { parse_hson_exact_runtime } from "../src/internal/exact-runtime-hson-codec.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "echo.replicate", title: "Echo retained-session replica establishment", category: "Echo", runtime: "node",
  tags: Object.freeze(["echo", "recovery", "session", "headless", "public"]),
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
  ["current", false, false], ["snapshot", true, false], ["snapshot", true, true],
] as const) {
  const map = hsonLiveMap.fromLibraries({ state: { data: { value: 0 } } });
  const options: LocusOptions<typeof map> = {
    map,
    exposure: [{ library: "state", exposure: "client-public" as const }],
    defaultProjection: { libraries: ["state"] },
    authorizeProjection: () => ({ libraries: ["state"] }),
  };
  const locus: Locus<typeof map> = truncateHistory
    ? create_registry_locus_internal(options, { maxHistoryBytes: 1 }).locus
    : hsonLocus.create(options);
  const session = await locus.session.create({ libraries: ["state"] });
  const cut = session.cut();
  if (advance) await locus.mutate((draft) => {
    const state = draft.lib("state");
    if (!("at" in state)) throw new Error("Expected a data draft.");
    state.at(["value"]).set(1);
  });
  const pair = socket_pair();
  const detach = locus.connect(pair.server);
  if (expected === "current") {
    await assert.rejects(hsonEcho.replicate({ cut: { libs: { ...cut.libs, projectionDigest: "0".repeat(64) } },
      credential: session.credential!, socket: pair.client }), /digest|projection/i);
    assert.equal(pair.clientListenerCount(), 0, "invalid cut does not install transport listeners");
    const ahead = socket_pair();
    const detachAhead = locus.connect(ahead.server);
    await assert.rejects(hsonEcho.replicate({ cut: { libs: { ...cut.libs, revision: cut.libs.revision + 1 } },
      credential: session.credential!, socket: ahead.client }), /ahead|recovery/i);
    assert.equal(ahead.clientListenerCount(), 0, "failed recovery releases transport listeners");
    const retained = locus.session.debug().sessions[0]!;
    assert.equal(retained.state, "disconnected", "failed establishment detaches the authority session");
    assert.equal(retained.transportAttached, false);
    assert.equal(retained.resumable, true);
    assert.ok(retained.expiresAt);
    detachAhead();
  }
  const echo = await hsonEcho.replicate({ cut, credential: session.credential!, socket: pair.client });
  assert.equal(echo.session.status, "attached");
  assert.equal(echo.recovery.status, "caught_up");
  assert.equal(echo.recovery.strategy, expected);
  assert.equal(echo.recovery.debug().lastAppliedRev, locus.rev);
  assert.equal(echo.session.credential, session.credential);
  const state = echo.map.lib("state");
  if (state.mode === "document") throw new Error("Expected a data library.");
  assert.equal(state.snap(["value"]), expected === "current" ? 0 : 1);
  assert.throws(() => state.at(["value"]).set(2), /authority|managed|controlled|reserved/i);
  echo.dispose();
  assert.equal(echo.session.credential, undefined);
  assert.equal(echo.recovery.status, "disposed");
  assert.equal(echo.recovery.debug().status, "disposed");
  assert.equal(pair.clientListenerCount(), 0);
  detach(); locus.dispose();
}

// A transferred root is only structurally admitted. Equal revision and scope
// cannot establish that its contents were the authority's contents.
{
  const map = hsonLiveMap.fromLibraries({ state: { data: { value: 0 } } });
  const locus = hsonLocus.create({ map, exposure: [{ library: "state", exposure: "client-public" }],
    authorizeProjection: () => ({ libraries: ["state"] }) });
  const session = await locus.session.create({ libraries: ["state"] });
  const cut = session.cut();
  const forged = { libs: { ...cut.libs, libraries: cut.libs.libraries.map((entry) => ({
    ...entry, root: { ...entry.root, payload: entry.root.payload.replace('value 0>', 'value 99>') },
  })) } };
  assert.notEqual(forged.libs.libraries[0]!.root.payload, cut.libs.libraries[0]!.root.payload);
  const pair = socket_pair(); const detach = locus.connect(pair.server);
  const echo = await hsonEcho.replicate({ cut: forged, credential: session.credential!, socket: pair.client });
  assert.equal(echo.recovery.strategy, "snapshot");
  const state = echo.map.lib("state");
  if (state.mode === "document") throw new Error("Expected data.");
  assert.equal(state.snap(["value"]), 0);
  echo.dispose(); detach(); locus.dispose();
}

// A valid CSS value is also mutable projected state, even with an unchanged contract.
{
  const map = hsonLiveMap.fromLibraries({ page: { document: "<main/>" } });
  map.lib("page").css.stylesheet("main { color: red; }");
  const locus = hsonLocus.create({ map, exposure: [{ library: "page", exposure: "client-public" }],
    authorizeProjection: () => ({ libraries: ["page"] }) });
  const session = await locus.session.create({ libraries: ["page"] });
  const cut = session.cut();
  const forged = { libs: { ...cut.libs, libraries: cut.libs.libraries.map((entry) => entry.css === undefined
    ? entry : { ...entry, css: { ...entry.css, rules: entry.css.rules.map((rule) => ({
      ...rule, declarations: rule.declarations.map(([name, value]): readonly [string, string] =>
        [name, value === "red" ? "blue" : value]),
    })) } }) } };
  const pair = socket_pair(); const detach = locus.connect(pair.server);
  const echo = await hsonEcho.replicate({ cut: forged, credential: session.credential!, socket: pair.client });
  assert.equal(echo.recovery.strategy, "snapshot");
  assert.equal(echo.map.lib("page").css.snapshot(), map.lib("page").css.snapshot());
  echo.dispose(); detach(); locus.dispose();
}

// Authorized interaction state is part of content convergence, not the scope digest.
{
  const map = hsonLiveMap.fromLibraries({ page: { document: "<main <button/>/>" } });
  enable_interactions(map);
  const emptyMap = hsonLiveMap.fromLibraries({ page: { document: "<main <button/>/>" } });
  enable_interactions(emptyMap);
  const emptyLocus = hsonLocus.create({ map: emptyMap, exposure: [{ library: "page", exposure: "client-public" }],
    authorizeProjection: () => ({ libraries: ["page"], systemFeatures: ["interactions"] }) });
  const emptySession = await emptyLocus.session.create({ libraries: ["page"], systemFeatures: ["interactions"] });
  const emptySystem = emptySession.cut().libs.system;
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
  const locus = hsonLocus.create({ map, exposure: [{ library: "page", exposure: "client-public" }],
    authorizeProjection: () => ({ libraries: ["page"], systemFeatures: ["interactions"] }) });
  const session = await locus.session.create({ libraries: ["page"], systemFeatures: ["interactions"] });
  const current = session.cut();
  assert.notDeepEqual(current.libs.system, emptySystem);
  const mixed = { libs: { ...current.libs, system: emptySystem } };
  const pair = socket_pair(); const detach = locus.connect(pair.server);
  const echo = await hsonEcho.replicate({ cut: mixed, credential: session.credential!, socket: pair.client });
  assert.equal(echo.recovery.strategy, "snapshot");
  assert.equal(echo.recovery.status, "caught_up");
  echo.dispose(); detach(); locus.dispose(); emptyLocus.dispose();
}

// Once Echo has established continuity, reconnect retains current and replay
// optimizations. Recovery is automatic and actions wait for caught-up.
for (const [mutate, truncateHistory] of [[false, false], [true, false], [true, true]] as const) {
  const map = hsonLiveMap.fromLibraries({ state: { data: { value: 0 } } });
  const options: LocusOptions<typeof map> = { map, exposure: [{ library: "state", exposure: "client-public" }],
    authorizeProjection: () => ({ libraries: ["state"] }) };
  const locus = truncateHistory ? create_registry_locus_internal(options, { maxHistoryBytes: 1 }).locus
    : hsonLocus.create(options);
  const session = await locus.session.create({ libraries: ["state"] });
  const pair = socket_pair(); const detach = locus.connect(pair.server);
  const echo = await hsonEcho.replicate({ cut: session.cut(), credential: session.credential!, socket: pair.client });
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
  assert.equal(echo.recovery.status, "recovering");
  const sent = pair.actionFrames();
  await assert.rejects(echo.action("any" as never), /disconnect/i);
  assert.equal(pair.actionFrames(), sent, "action must not send before recovery completes");
  pair.releaseCaughtUp();
  await until(() => echo.recovery.status === "caught_up");
  assert.equal(echo.recovery.strategy, truncateHistory ? "snapshot" : mutate ? "replay" : "current");
  assert.equal(locus.session.debug().reattachmentCount, 2, "one initial attach and one reconnect attach");
  echo.dispose(); detach(); locus.dispose();
}

for (const outcome of ["disposed", "rejected"] as const) {
  const map = hsonLiveMap.fromLibraries({ state: { data: { value: 0 } } });
  const locus = hsonLocus.create({ map, exposure: [{ library: "state", exposure: "client-public" }],
    authorizeProjection: () => ({ libraries: ["state"] }) });
  const session = await locus.session.create({ libraries: ["state"] });
  const pair = socket_pair(); const detach = locus.connect(pair.server);
  const echo = await hsonEcho.replicate({ cut: session.cut(), credential: session.credential!, socket: pair.client });
  echo.disconnect();
  if (outcome === "rejected") {
    session.revoke();
    echo.connect();
    await until(() => echo.recovery.status === "failed");
    assert.ok(echo.recovery.failure);
    assert.equal(echo.recovery.debug().status, "failed");
  } else {
    pair.holdCaughtUp();
    echo.connect();
    await until(() => echo.recovery.status === "recovering");
    echo.dispose();
    pair.releaseCaughtUp();
    assert.equal(echo.recovery.status, "disposed");
    assert.equal(echo.recovery.debug().status, "disposed");
    assert.equal(echo.session.credential, undefined);
  }
  echo.dispose(); detach(); locus.dispose();
}

// Both transport listener installations roll back atomically.
for (const stage of ["message", "close"] as const) {
  const map = hsonLiveMap.fromLibraries({ state: { data: { value: 0 } } });
  const locus = hsonLocus.create({ map, exposure: [{ library: "state", exposure: "client-public" }],
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
  await assert.rejects(hsonEcho.replicate({ cut: session.cut(), credential: session.credential!, socket }), /listener installation failed/);
  assert.equal(pair.clientListenerCount(), 0);
  assert.equal(locus.session.debug().sessions[0]!.activeConnectionEpoch, beforeAttachment.activeConnectionEpoch);
  fail = false;
  const echo = await hsonEcho.replicate({ cut: session.cut(), credential: session.credential!, socket });
  assert.equal(echo.recovery.status, "caught_up");
  echo.dispose(); detach(); locus.dispose();
}

{
  const map = hsonLiveMap.fromLibraries({ state: { data: { value: 0 } } });
  const locus = hsonLocus.create({ map,
    exposure: [{ library: "state", exposure: "client-public" }],
    authorizeProjection: () => ({ libraries: ["state"] }),
  });
  const session = await locus.session.create({ libraries: ["state"] });
  const pair = socket_pair();
  const detach = locus.connect(pair.server);
  await assert.rejects(hsonEcho.replicate({ cut: session.cut(), credential: "invalid-credential", socket: pair.client }));
  assert.equal(pair.clientListenerCount(), 0, "failed attachment releases transport listeners");
  const empty = await locus.session.create({ libraries: [] });
  assert.deepEqual(empty.cut().libs.libraries, []);
  await assert.rejects(hsonEcho.replicate({ cut: empty.cut(), credential: empty.credential!, socket: pair.client }), /no LiveMap|application libraries/i);
  assert.equal(pair.clientListenerCount(), 0, "action-only cut does not create a replica endpoint");
  detach(); locus.dispose();
}

{
  const map = hsonLiveMap.fromLibraries({ state: { data: { value: 0 } } });
  const locus = hsonLocus.create({ map,
    exposure: [{ library: "state", exposure: "client-public" }],
    authorizeProjection: () => ({ libraries: ["state"] }),
  });
  const session = await locus.session.create({ libraries: ["state"] }, { connection: { principalId: "alice" } });
  const pair = socket_pair();
  const detach = locus.connect(pair.server, { principalId: "mallory" });
  await assert.rejects(hsonEcho.replicate({ cut: session.cut(), credential: session.credential!, socket: pair.client }));
  assert.equal(pair.clientListenerCount(), 0, "principal rejection releases transport listeners");
  detach(); locus.dispose();
}

{
  const map = hsonLiveMap.fromLibraries({ page: { document: "<main/>" } });
  const locus = hsonLocus.create({ map,
    exposure: [{ library: "page", exposure: "client-public" }],
    authorizeProjection: () => ({ libraries: ["page"] }),
  });
  const session = await locus.session.create({ libraries: ["page"] });
  const cut = session.cut();
  const quidRoot = encode_hosted_root(parse_hson_exact_runtime("<main @000000001/>", { allowTopLevelDocumentText: true }));
  const forged = { libs: { ...cut.libs, libraries: cut.libs.libraries.map((entry) => ({ ...entry, root: quidRoot })) } };
  const pair = socket_pair();
  await assert.rejects(hsonEcho.replicate({ cut: forged, credential: session.credential!, socket: pair.client }), /malformed/i);
  assert.equal(pair.clientListenerCount(), 0);
  locus.dispose();
}

console.log("Echo high-level replication current, replay, snapshot, admission, QUID fencing, and failure cleanup passed.");
