import { test_echo_transport } from "./helpers/echo-websocket-transport.mts";
import { bind_locus_websocket } from "../src/api/locus/locus.websocket.ts";
import { create_recovery_test_driver } from "./helpers/replica-driver.mts";
import { client_projection_map } from "./helpers/client-projection.mts";
import assert from "node:assert/strict";
import { Hson } from "../src/hson-authoring.ts";
import { hsonLiveMap, type LiveMap } from "../src/api/livemap/index.ts";
import { hsonLocus, type Locus, type LocusOptions, type LocusWebSocketLike } from "../src/api/locus/index.ts";
import { hsonEcho } from "../src/api/echo/index.ts";
// Only the fallback authority uses the existing history-budget test hook.
// Session creation, capture, composition, and Echo consumers use public APIs.
import { create_registry_locus_internal } from "../src/api/locus/locus.registry.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "locus.session-cut", title: "Retained authorized session cut", category: "Locus", runtime: "node",
  tags: Object.freeze(["locus", "echo", "recovery", "projection", "public"]),
});

function socket_pair() {
  const toServer = new Set<(raw: string) => void>();
  const toClient = new Set<(raw: string) => void>();
  const serverSent: string[] = [];
  const client: LocusWebSocketLike = {
    send(raw) { for (const listener of [...toServer]) listener(raw); }, close() {},
    onMessage(listener) { toClient.add(listener); return () => { toClient.delete(listener); }; },
    onClose() { return () => {}; },
  };
  const server: LocusWebSocketLike = {
    send(raw) { serverSent.push(raw); for (const listener of [...toClient]) listener(raw); }, close() {},
    onMessage(listener) { toServer.add(listener); return () => { toServer.delete(listener); }; },
    onClose() { return () => {}; },
  };
  return { client, server, serverSent };
}

async function session(locus: Locus) {
  const pair = socket_pair();
  const detach = bind_locus_websocket(locus, pair.server);
  pair.client.send(JSON.stringify({ type: "session-create", id: "session-cut" }));
  await Promise.resolve();
  const created = pair.serverSent.map((raw) => JSON.parse(raw)).find((message) => message.type === "session-created");
  assert.ok(created && typeof created.sessionId === "string" && typeof created.credential === "string");
  const sessionId: string = created.sessionId;
  const credential: string = created.credential;
  return { pair, detach, sessionId, credential, capability: locus.session.get(sessionId)! };
}

function data(map: LiveMap, name: string) {
  const library = map.lib(name);
  if (library.mode === "document") throw new Error("Expected data library.");
  return library;
}

function portable_private_free(raw: string) {
  for (const hidden of ["PRIVATE_NAME", "PRIVATE_SCHEMA", "PRIVATE_ROOT", "UNSELECTED_NAME", "UNSELECTED_ROOT",
    "hson:quid", "$_quid", "issuedQuids", "identityEpoch"]) assert.equal(raw.includes(hidden), false, hidden);
}

const Data = Hson.schema`<type "data" content <value "string">>`;
for (const strategy of ["replay", "reconcile"] as const) {
  const map = hsonLiveMap.fromLibraries({
    visible: { data: { value: "INITIAL" }, schema: Data },
    PRIVATE_NAME: { data: { PRIVATE_SCHEMA: "PRIVATE_ROOT" }, schema: Hson.schema`<type "data" content <PRIVATE_SCHEMA "string">>` },
    UNSELECTED_NAME: { data: { value: "UNSELECTED_ROOT" }, schema: Data },
  });
  const options: LocusOptions<typeof map> = { map,
    libraries: [{ name: "visible", ownership: "shared" }, { name: "PRIVATE_NAME", ownership: "private" },
      { name: "UNSELECTED_NAME", ownership: "shared" }],
    defaultProjection: { libraries: ["visible"] },
    // A grant makes an eligible library available; it does not select it.
    authorizeProjection: () => ({ libraries: ["visible", "UNSELECTED_NAME"] }),
  };
  const locus = strategy === "replay" ? hsonLocus.create(options)
    : create_registry_locus_internal(options, { maxHistoryBytes: 1 }).locus;
  await locus.stage((draft) => draft.lib("PRIVATE_NAME").at(["PRIVATE_SCHEMA"]).set("PRIVATE_ROOT_ADVANCED"));
  const initial = await session(locus);
  const sentBefore = initial.pair.serverSent.length;
  const snapshot = initial.capability.now().libs;
  assert.equal(initial.pair.serverSent.length, sentBefore, "capture does not send state");
  assert.equal("document" in globalThis, false);
  assert.equal("html" in snapshot, false);
  assert.equal(snapshot.format, "hson-authority-projection-snapshot");
  assert.equal(snapshot.revision, 1);
  assert.deepEqual(snapshot.authority, { logicalMapId: locus.logicalMapId, incarnationId: locus.incarnationId });
  assert.deepEqual(snapshot.libraries.map((entry) => entry.name), ["visible"]);
  assert.deepEqual(snapshot.systemFeatures, []);
  assert.deepEqual(snapshot.writableDocuments, []);
  assert.equal(snapshot.system, null);
  portable_private_free(JSON.stringify(snapshot));
  assert.deepEqual(Object.keys(initial.capability.now()).sort(), ["format", "initializerDigest", "libs", "local", "sessionBinding"]);
  const client = client_projection_map({ authority: snapshot,
    local: { local: { data: { value: "LOCAL" }, schema: Data } } });
  assert.deepEqual(data(client, "visible").snap(), { value: "INITIAL" });
  assert.equal(snapshot.libraries[0]?.schema, Data.toHson());
  assert.throws(() => client.lib("PRIVATE_NAME"), /unknown/i);
  const retained = JSON.stringify(snapshot);
  initial.detach();
  assert.deepEqual(initial.capability.now().libs, snapshot, "disconnected retained session remains available");
  const pair = socket_pair();
  let detach = bind_locus_websocket(locus, pair.server);
  const echo = create_recovery_test_driver({ transport: test_echo_transport(pair.client), map: client, session: { credential: initial.credential } });
  echo.connect();
  await echo.session.reattach();
  assert.equal((await echo.completeRecovery()).strategy, "current");
  assert.equal(echo.sync.debug().lastAppliedRev, snapshot.revision);
  const local = data(client, "local");
  const localHandle = local.at(["value"]);
  echo.disconnect(); detach();
  localHandle.set("LOCAL_OFFLINE");
  await locus.stage((draft) => draft.lib("visible").at(["value"]).set("RECOVERED"));
  await locus.stage((draft) => draft.lib("PRIVATE_NAME").at(["PRIVATE_SCHEMA"]).set("PRIVATE_ROOT_OFFLINE"));
  assert.equal(echo.sync.debug().lastAppliedRev, snapshot.revision);
  assert.equal(JSON.stringify(snapshot), retained, "captured artifact is detached from later mutations");
  detach = bind_locus_websocket(locus, pair.server);
  echo.connect(); await echo.awaitReconnect();
  assert.equal(echo.sync.strategy, strategy);
  assert.equal(echo.sync.debug().lastAppliedRev, locus.rev);
  assert.equal(echo.map, client);
  assert.equal(client.lib("local"), local);
  assert.equal(localHandle.snap(), "LOCAL_OFFLINE");
  assert.equal(data(client, "visible").snap(["value"]), "RECOVERED");
  if (strategy === "reconcile") {
    assert.ok(pair.serverSent.some((raw) => JSON.parse(raw).type === "recovery-snapshot"));
    assert.equal(echo.sync.strategy, "reconcile");
  }
  portable_private_free(pair.serverSent.join("\n"));
  const beforeProjection = initial.capability.now().libs;
  await initial.capability.update({ libraries: [] });
  const contracted = initial.capability.now().libs;
  assert.equal(contracted.revision, beforeProjection.revision);
  assert.notEqual(contracted.projectionDigest, beforeProjection.projectionDigest);
  assert.deepEqual(contracted.libraries, []);
  assert.equal(initial.capability.revoke(), true);
  assert.throws(() => initial.capability.now().libs, { code: "LOCUS_PROJECTION_UNAVAILABLE" });
  echo.dispose(); detach(); locus.dispose();
  assert.throws(() => initial.capability.now().libs, { code: "LOCUS_PROJECTION_UNAVAILABLE" });
  console.log(`ok - data-only public capture, privacy, current position, ${strategy}, local preservation, and projection changes`);
}

// Expiration is driven by the existing public session scheduler, with no wall-clock race.
{
  const expirations = new Set<() => void>();
  const locus = hsonLocus.create({ map: hsonLiveMap.fromLibraries({ state: { data: { value: "value" } } }),
    libraries: [{ name: "state", ownership: "shared" }], defaultProjection: { libraries: ["state"] },
    authorizeProjection: () => ({ libraries: ["state"] }),
    sessions: { schedule: (_delay, callback) => { expirations.add(callback); return () => { expirations.delete(callback); }; } },
  });
  for (const id of ["", "unknown"]) assert.equal(locus.session.get(id), undefined);
  const initial = await session(locus);
  initial.detach();
  assert.equal(expirations.size, 1);
  for (const expire of [...expirations]) expire();
  assert.throws(() => initial.capability.now().libs, { code: "LOCUS_PROJECTION_UNAVAILABLE" });
  locus.dispose();
  console.log("ok - unknown, empty, retained, and expired sessions");
}

for (const libraries of [["page"], ["page", "state"]]) {
  const map = hsonLiveMap.fromLibraries({ page: { document: "<html <head/> <body <main/>/>/>" }, state: { data: { value: 1 } } });
  map.lib("page").css.stylesheet("main { color: blue; }");
  const locus = hsonLocus.create({ map,
    libraries: [{ name: "page", ownership: "shared" }, { name: "state", ownership: "shared" }],
    defaultProjection: { libraries }, authorizeProjection: () => ({ libraries }),
  });
  const initial = await session(locus);
  const snapshot = initial.capability.now().libs;
  assert.deepEqual(snapshot, initial.capability.now({ html: "page" }).libs);
  assert.deepEqual(snapshot.libraries.map((entry) => entry.name), libraries);
  assert.ok(snapshot.libraries.find((entry) => entry.name === "page")?.css);
  const client = client_projection_map({ authority: snapshot, local: {} });
  const page = client.lib("page");
  assert.equal(page.mode, "document");
  if (page.mode === "document") assert.equal(page.css.snapshot(), map.lib("page").css.snapshot());
  initial.detach(); locus.dispose();
}
console.log("ok - document-only and mixed session now state preserves hosted state and CSS");
