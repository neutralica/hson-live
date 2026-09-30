import { test_echo_transport } from "./helpers/echo-websocket-transport.mts";
import { bind_locus_websocket } from "../src/api/locus/locus.websocket.ts";
import { client_projection_map } from "./helpers/client-projection.mts";
import assert from "node:assert/strict";
import { Hson, hsonLiveMap, hsonLocus, add_interaction, enable_interactions, encode_ssr_bootstrap,
  decode_ssr_bootstrap, type HsonSchema } from "../src/index.ts";
import type { LocusWebSocketLike } from "../src/types/locus.types.ts";
import { create_echo_aggregate_client_internal } from "../src/api/echo/echo.aggregate-replica.ts";
import { create_registry_locus_internal } from "../src/api/locus/locus.registry.ts";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";
import { validate_document_path } from "../src/api/livemap/livemap.document.path.ts";
import { acquire_livemap_document_identity } from "../src/api/livemap/livemap.document.identity-handle.ts";

const Page: HsonSchema = Hson.schema`<type "document" tag "main" content <repeat <tag "p" content "string">>>`;
const Private: HsonSchema = Hson.schema`<type "data" content <PRIVATE_SCHEMA_SENTINEL "string">>`;
const Unselected: HsonSchema = Hson.schema`<type "data" content <UNSELECTED_SCHEMA_SENTINEL "string">>`;
const Data: HsonSchema = Hson.schema`<type "data" content <value "string">>`;
const listener = Object.freeze({ event: "click", target: "element" as const, capture: false, once: false,
  passive: false, missingTarget: "ignore" as const, preventDefault: false, stopPropagation: false, stopImmediatePropagation: false });

function hostile_map() {
const map = hsonLiveMap.fromLibraries({
  page: { document: '<main <p "PERMITTED_HTML_SENTINEL"/>/>', schema: Page },
  permittedData: { data: { value: "PERMITTED_ROOT_SENTINEL" }, schema: Data },
  PRIVATE_NAME_SENTINEL: { data: { PRIVATE_SCHEMA_SENTINEL: "PRIVATE_ROOT_SENTINEL" }, schema: Private },
  privatePage: { document: '<main <p "PRIVATE_DOCUMENT_SENTINEL"/>/>', schema: Page },
  UNSELECTED_NAME_SENTINEL: { data: { UNSELECTED_SCHEMA_SENTINEL: "UNSELECTED_ROOT_SENTINEL" }, schema: Unselected },
  unselectedPage: { document: '<main <p "UNSELECTED_DOCUMENT_SENTINEL"/>/>', schema: Page },
});
enable_interactions(map);
add_interaction(map, { id: "visible", subject: { library: "page", path: [99] }, listener,
  kind: "browser", key: "PERMITTED_INTERACTION_SENTINEL", args: Hson.data.from(null) });
add_interaction(map, { id: "private", subject: { library: "privatePage", path: [99] }, listener,
  kind: "browser", key: "PRIVATE_INTERACTION_SENTINEL", args: Hson.data.from(null) });
add_interaction(map, { id: "unselected", subject: { library: "unselectedPage", path: [99] }, listener,
  kind: "browser", key: "UNSELECTED_INTERACTION_SENTINEL", args: Hson.data.from(null) });
return map;
}

const map = hostile_map();

const locus = hsonLocus.create({ map,
  libraries: [
    { name: "page", ownership: "shared" },
    { name: "permittedData", ownership: "shared" },
    { name: "PRIVATE_NAME_SENTINEL", ownership: "private" },
    { name: "privatePage", ownership: "private" },
    { name: "UNSELECTED_NAME_SENTINEL", ownership: "shared" },
    { name: "unselectedPage", ownership: "shared" },
  ],
  authorizeProjection: () => ({ libraries: ["page", "permittedData", "unselectedPage"], systemFeatures: ["interactions"] }),
});

const serverSent: Array<Record<string, unknown>> = [];
let receive: ((raw: string) => void) | undefined;
const socket: LocusWebSocketLike = {
  send(raw) { serverSent.push(JSON.parse(raw) as Record<string, unknown>); }, close() {},
  onMessage(listener) { receive = listener; return () => { receive = undefined; }; },
  onClose() { return () => {}; },
};
const disconnect = bind_locus_websocket(locus, socket);
receive?.(JSON.stringify({ type: "session-create", id: "ssr", projection: { libraries: ["permittedData", "page"], systemFeatures: ["interactions"] } }));
await new Promise<void>((resolve) => setImmediate(resolve));
const created = serverSent.find((entry) => entry.type === "session-created");
assert.ok(created && typeof created.sessionId === "string");
const sessionId = created.sessionId;
let receiveNoDefault: ((raw: string) => void) | undefined;
const noDefaultSent: Array<Record<string, unknown>> = [];
const noDefaultSocket: LocusWebSocketLike = {
  send(raw) { noDefaultSent.push(JSON.parse(raw) as Record<string, unknown>); }, close() {},
  onMessage(listener) { receiveNoDefault = listener; return () => { receiveNoDefault = undefined; }; },
  onClose() { return () => {}; },
};
const disconnectNoDefault = bind_locus_websocket(locus, noDefaultSocket);
receiveNoDefault?.(JSON.stringify({ type: "session-create", id: "no-default", projection: { libraries: ["page"] } }));
await new Promise<void>((resolve) => setImmediate(resolve));
const noDefaultCreated = noDefaultSent.find((entry) => entry.type === "session-created");
assert.ok(noDefaultCreated && typeof noDefaultCreated.sessionId === "string");
const noDefaultSessionId = noDefaultCreated.sessionId;
assert.deepEqual(Object.keys(locus.session.get(noDefaultSessionId)!.now()).sort(), ["format", "initializerDigest", "libs", "local", "sessionBinding"]);
const explicitCut = locus.session.get(noDefaultSessionId)!.now({ html: "page" });
assert.ok(explicitCut.html.includes("PERMITTED_HTML_SENTINEL"));

assert.equal(locus.session.get(""), undefined);
assert.throws(() => locus.session.get(sessionId)!.now({ html: "privatePage" }), /unavailable/i);
assert.throws(() => locus.session.get(sessionId)!.now({ html: "unselectedPage" }), /unavailable/i);
assert.throws(() => locus.session.get(sessionId)!.now({ html: "permittedData" }), /unavailable/i);
const cut = locus.session.get(sessionId)!.now({ html: "page" });
assert.notEqual(cut.libs.projectionDigest, explicitCut.libs.projectionDigest);
assert.equal(cut.document, "page");
assert.ok(cut.html.includes("PERMITTED_HTML_SENTINEL"));
assert.equal(cut.html.includes("hson:quid"), false);
assert.equal(cut.libs.libraries.some((entry) => entry.name === "permittedData"), true);
const wire = encode_ssr_bootstrap(cut);
const raw = Buffer.from(wire, "base64url").toString("utf8");
assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), ["format", "kind", "payload"]);
assert.equal(JSON.parse(raw).kind, "hosted-projection");
const decoded = decode_ssr_bootstrap(wire);
assert.equal(decoded.kind, "hosted-projection");
if (decoded.kind !== "hosted-projection") throw new Error("Expected projected SSR bootstrap.");
assert.deepEqual(decoded.bootstrap, { format: cut.format, sessionBinding: cut.sessionBinding, libs: cut.libs, local: cut.local, initializerDigest: cut.initializerDigest });
const wrongProjection = JSON.parse(raw);
wrongProjection.payload.libs.projectionDigest = "0".repeat(64);
assert.throws(() => decode_ssr_bootstrap(Buffer.from(JSON.stringify(wrongProjection)).toString("base64url")), /payload is invalid/i);
const malformedCarrier = JSON.parse(raw);
malformedCarrier.payload.libs.libraries[0].root.payload = "<malformed>";
assert.throws(() => decode_ssr_bootstrap(Buffer.from(JSON.stringify(malformedCarrier)).toString("base64url")), /payload is invalid/i);
const combined = `<html><body>${cut.html}<script type="application/hson-bootstrap">${wire}</script></body></html>`;
for (const artifact of [cut.html, raw, combined]) {
  for (const hidden of ["PRIVATE_NAME_SENTINEL", "PRIVATE_ROOT_SENTINEL", "PRIVATE_SCHEMA_SENTINEL",
    "PRIVATE_DOCUMENT_SENTINEL", "PRIVATE_INTERACTION_SENTINEL", "UNSELECTED_NAME_SENTINEL",
    "UNSELECTED_ROOT_SENTINEL", "UNSELECTED_SCHEMA_SENTINEL", "UNSELECTED_DOCUMENT_SENTINEL",
    "UNSELECTED_INTERACTION_SENTINEL", "hson:quid", "issuedQuids", "registryDigest"]) {
    assert.equal(artifact.includes(hidden), false, hidden);
  }
}
assert.ok(raw.includes("PERMITTED_ROOT_SENTINEL"));
assert.ok(raw.includes("PERMITTED_INTERACTION_SENTINEL"));
const client = client_projection_map({ authority: decoded.bootstrap.libs,
  local: { local: { data: { value: "CLIENT_LOCAL_SENTINEL" }, schema: Data } } });
assert.equal(client.rev, 0);
assert.equal(client.lib("local").mode, "data-object");
assert.equal(raw.includes("CLIENT_LOCAL_SENTINEL"), false);
const retained = JSON.stringify(cut);
await locus.mutate((draft) => { const library = draft.lib("permittedData"); if ("at" in library) library.at(["value"]).set("AFTER_CUT_SENTINEL"); });
assert.equal(JSON.stringify(cut), retained);
assert.equal(cut.libs.revision + 1, locus.rev);
const next = locus.session.get(sessionId)!.now({ html: "page" });
assert.equal(next.libs.revision, locus.rev);
assert.ok(JSON.stringify(next.libs).includes("AFTER_CUT_SENTINEL"));
assert.equal(next.html, cut.html);
const serverListeners = new Set<(raw: string) => void>();
const clientListeners = new Set<(raw: string) => void>();
const downstream: string[] = [];
const clientSocket: LocusWebSocketLike = {
  send(raw) { for (const listener of [...serverListeners]) listener(raw); }, close() {},
  onMessage(listener) { clientListeners.add(listener); return () => { clientListeners.delete(listener); }; },
  onClose() { return () => {}; },
};
const serverSocket: LocusWebSocketLike = {
  send(raw) { downstream.push(raw); for (const listener of [...clientListeners]) listener(raw); }, close() {},
  onMessage(listener) { serverListeners.add(listener); return () => { serverListeners.delete(listener); }; },
  onClose() { return () => {}; },
};
disconnect();
let stopServer = bind_locus_websocket(locus, serverSocket);
const echoClient = create_echo_aggregate_client_internal({ transport: test_echo_transport(clientSocket),
  map: client, session: { credential: created.credential as string } });
assert.equal(echoClient.lastAppliedRev, cut.libs.revision);
const firstRecovery = await echoClient.connect();
assert.equal(firstRecovery.outcome, "replay");
assert.equal(echoClient.lastAppliedRev, cut.libs.revision + 1);
assert.equal(client.rev, 1);
assert.equal(client.lib("local").mode, "data-object");
assert.ok(downstream.some((raw) => raw.includes("AFTER_CUT_SENTINEL")));
for (const raw of downstream) {
  for (const hidden of ["PRIVATE_NAME_SENTINEL", "PRIVATE_ROOT_SENTINEL", "PRIVATE_SCHEMA_SENTINEL",
    "PRIVATE_DOCUMENT_SENTINEL", "PRIVATE_INTERACTION_SENTINEL", "UNSELECTED_NAME_SENTINEL",
    "UNSELECTED_ROOT_SENTINEL", "UNSELECTED_SCHEMA_SENTINEL", "UNSELECTED_DOCUMENT_SENTINEL",
    "UNSELECTED_INTERACTION_SENTINEL"]) assert.equal(raw.includes(hidden), false, hidden);
}
echoClient.disconnect();
stopServer();
await locus.mutate((draft) => { const library = draft.lib("PRIVATE_NAME_SENTINEL"); if ("at" in library) library.at(["PRIVATE_SCHEMA_SENTINEL"]).set("PRIVATE_AFTER_DISCONNECT"); });
stopServer = bind_locus_websocket(locus, serverSocket);
const secondRecovery = await echoClient.connect();
assert.equal(secondRecovery.outcome, "replay");
assert.equal(echoClient.lastAppliedRev, cut.libs.revision + 2);
assert.equal(client.rev, 1);
assert.equal(client.lib("local").mode, "data-object");
assert.ok(downstream.some((raw) => raw.includes('"progress"')));
assert.equal(downstream.join("\n").includes("PRIVATE_AFTER_DISCONNECT"), false);
echoClient.dispose();
stopServer();
const capability = locus.session.get(sessionId)!;
assert.equal(capability.revoke(), true);
assert.throws(() => capability.now(), /projection is unavailable/i);
disconnectNoDefault();
locus.dispose();

// Local rendering remains independent of hosted authorization.
const local = hsonLiveMap.fromLibraries({ page: { document: '<main <p "LOCAL_CUT"/>/>', schema: Page } });
assert.match(local.cut({ html: "page" }).html, /LOCAL_CUT/);

// The same hostile authority fixture crosses an actual SSR -> live -> history-insufficient
// recovery. Inspect every emitted wire frame, including the fallback envelope and tail.
{
  let recoveryCuts = 0;
  let mutateTail: (() => Promise<void>) | undefined;
  const fallbackMap = hostile_map();
  const { locus: fallbackLocus } = create_registry_locus_internal({ map: fallbackMap,
    libraries: [
      { name: "page", ownership: "shared" },
      { name: "permittedData", ownership: "shared" },
      { name: "PRIVATE_NAME_SENTINEL", ownership: "private" },
      { name: "privatePage", ownership: "private" },
      { name: "UNSELECTED_NAME_SENTINEL", ownership: "shared" },
      { name: "unselectedPage", ownership: "shared" },
    ],
    authorizeProjection: () => ({ libraries: ["page", "permittedData"], systemFeatures: ["interactions"] }),
  }, { maxHistoryBytes: 1, afterRecoveryCut: async () => {
    recoveryCuts += 1;
    if (recoveryCuts === 2) await mutateTail?.();
  } });
  mutateTail = async () => fallbackLocus.mutate((draft) => {
    const permitted = draft.lib("permittedData");
    const hidden = draft.lib("PRIVATE_NAME_SENTINEL");
    if ("at" in permitted) permitted.at(["value"]).set("PERMITTED_FALLBACK_TAIL_SENTINEL");
    if ("at" in hidden) hidden.at(["PRIVATE_SCHEMA_SENTINEL"]).set("PRIVATE_FALLBACK_TAIL_SENTINEL");
  });
  let createReceiver: ((raw: string) => void) | undefined;
  let credential: string | undefined;
  let fallbackSessionId: string | undefined;
  const creationSocket: LocusWebSocketLike = { send(raw) {
    const frame = JSON.parse(raw) as Record<string, unknown>;
    if (frame.type === "session-created") {
      credential = frame.credential as string;
      fallbackSessionId = frame.sessionId as string;
    }
  }, close() {}, onMessage(listener) { createReceiver = listener; return () => { createReceiver = undefined; }; },
  onClose() { return () => {}; } };
  const stopCreation = bind_locus_websocket(fallbackLocus, creationSocket);
  createReceiver?.(JSON.stringify({ type: "session-create", id: "hostile-fallback-session", projection: { libraries: ["permittedData", "page"], systemFeatures: ["interactions"] } }));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.ok(credential && fallbackSessionId);
  const ssr = fallbackLocus.session.get(fallbackSessionId)!.now({ html: "page" });
  const browserMap = client_projection_map({ authority: ssr.libs,
    local: { local: { data: { value: "CLIENT_LOCAL_SENTINEL" }, schema: Data } } });
  assert.equal(browserMap.rev, 0);
  stopCreation();
  const toServer = new Set<(raw: string) => void>();
  const toClient = new Set<(raw: string) => void>();
  const wireFrames: string[] = [];
  const browserSocket: LocusWebSocketLike = { send(raw) { for (const listener of [...toServer]) listener(raw); },
    close() {}, onMessage(listener) { toClient.add(listener); return () => { toClient.delete(listener); }; },
    onClose() { return () => {}; } };
  const authoritySocket: LocusWebSocketLike = { send(raw) { wireFrames.push(raw); for (const listener of [...toClient]) listener(raw); },
    close() {}, onMessage(listener) { toServer.add(listener); return () => { toServer.delete(listener); }; },
    onClose() { return () => {}; } };
  let stopAuthority = bind_locus_websocket(fallbackLocus, authoritySocket);
  const browser = create_echo_aggregate_client_internal({ transport: test_echo_transport(browserSocket), map: browserMap,
    session: { credential } });
  assert.equal(browser.lastAppliedRev, ssr.libs.revision);
  assert.equal((await browser.connect()).outcome, "current");
  await fallbackLocus.mutate((draft) => { const permitted = draft.lib("permittedData");
    if ("at" in permitted) permitted.at(["value"]).set("PERMITTED_LIVE_SENTINEL"); });
  assert.equal(browser.lastAppliedRev, ssr.libs.revision + 1);
  const localLibrary = browserMap.lib("local");
  if (localLibrary.mode === "document") throw new Error("Expected local data library.");
  const localHandle = localLibrary.at(["value"]);
  const projectedPage = browserMap.lib("page");
  if (projectedPage.mode !== "document") throw new Error("Expected projected document library.");
  const projectedHandle = acquire_livemap_document_identity(projectedPage.document, { kind: "path", path: [0] });
  browser.disconnect();
  stopAuthority();
  localHandle.set("LOCAL_SURVIVES_FALLBACK_SENTINEL");
  await fallbackLocus.mutate((draft) => { const permitted = draft.lib("permittedData");
    if ("at" in permitted) permitted.at(["value"]).set("PERMITTED_FALLBACK_SNAPSHOT_SENTINEL"); });
  await fallbackLocus.mutate((draft) => { const hidden = draft.lib("PRIVATE_NAME_SENTINEL");
    if ("at" in hidden) hidden.at(["PRIVATE_SCHEMA_SENTINEL"]).set("PRIVATE_FALLBACK_SNAPSHOT_SENTINEL"); });
  const beforeFallback = wireFrames.length;
  stopAuthority = bind_locus_websocket(fallbackLocus, authoritySocket);
  assert.equal((await browser.connect()).outcome, "reconcile");
  for (let attempt = 0; attempt < 100 && (browser.lastAppliedRev ?? -1) < fallbackLocus.rev; attempt++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.equal(browser.lastAppliedRev, fallbackLocus.rev);
  assert.equal(browser.map, browserMap);
  assert.equal(browserMap.lib("local"), localLibrary);
  assert.equal(localHandle.snap(), "LOCAL_SURVIVES_FALLBACK_SENTINEL");
  assert.equal(projectedHandle.active, true);
  const permitted = browserMap.lib("permittedData");
  if (permitted.mode === "document") throw new Error("Expected projected data library.");
  assert.equal(permitted.snap(["value"]), "PERMITTED_FALLBACK_TAIL_SENTINEL");
  const fallbackWire = wireFrames.slice(beforeFallback);
  assert.ok(fallbackWire.some((raw) => JSON.parse(raw).type === "recovery-snapshot"));
  assert.ok(fallbackWire.some((raw) => raw.includes("PERMITTED_FALLBACK_TAIL_SENTINEL")));
  assert.ok(fallbackWire.some((raw) => raw.includes("PERMITTED_FALLBACK_SNAPSHOT_SENTINEL")));
  assert.ok(fallbackWire.some((raw) => raw.includes("PERMITTED_INTERACTION_SENTINEL")));
  const completeRegistryDigest = internal_livemap_aggregate_authority(fallbackMap).hostedRegistry().digest;
  for (const raw of fallbackWire) {
    assert.equal(raw.includes(completeRegistryDigest), false, "complete registry digest");
    for (const hidden of ["PRIVATE_NAME_SENTINEL", "PRIVATE_ROOT_SENTINEL", "PRIVATE_SCHEMA_SENTINEL",
      "PRIVATE_DOCUMENT_SENTINEL", "PRIVATE_INTERACTION_SENTINEL", "UNSELECTED_NAME_SENTINEL",
      "UNSELECTED_ROOT_SENTINEL", "UNSELECTED_SCHEMA_SENTINEL", "UNSELECTED_DOCUMENT_SENTINEL",
      "UNSELECTED_INTERACTION_SENTINEL", "PRIVATE_FALLBACK_TAIL_SENTINEL", "PRIVATE_FALLBACK_SNAPSHOT_SENTINEL",
      "hson:quid", "issuedQuids"]) assert.equal(raw.includes(hidden), false, hidden);
  }
  browser.dispose();
  stopAuthority();
  fallbackLocus.dispose();
}

// A registry of cardinality one uses precisely the same session, cut, live, and
// recovery machinery. It gains no implicit libraries, projection, or document.
{
  const oneMap = hsonLiveMap.fromLibraries({ page: { document: '<main <p "ONE_LIBRARY_HTML"/>/>', schema: Page } });
  assert.throws(() => hsonLocus.create({ map: oneMap, libraries: [] }), /application library catalog/i);
  const oneLocus = hsonLocus.create({ map: oneMap, libraries: [{ name: "page", ownership: "shared" }],
    authorizeProjection: () => ({ libraries: ["page"] }) });
  let receive: ((raw: string) => void) | undefined;
  let sessionId: string | undefined;
  let credential: string | undefined;
  const frames: string[] = [];
  const socket: LocusWebSocketLike = { send(raw) { frames.push(raw); const message = JSON.parse(raw) as Record<string, unknown>;
    if (message.type === "session-created") { sessionId = message.sessionId as string; credential = message.credential as string; }
  }, close() {}, onMessage(listener) { receive = listener; return () => { receive = undefined; }; },
  onClose() { return () => {}; } };
  const stop = bind_locus_websocket(oneLocus, socket);
  receive?.(JSON.stringify({ type: "session-create", id: "one-library", projection: { libraries: ["page"] } }));
  await new Promise<void>((resolve) => setImmediate(resolve));
  if (sessionId === undefined || credential === undefined) throw new Error("One-library session was unavailable.");
  const selectedId: string = sessionId;
  assert.deepEqual(Object.keys(oneLocus.session.get(selectedId)!.now()).sort(), ["format", "initializerDigest", "libs", "local", "sessionBinding"]);
  const selected = oneLocus.session.get(selectedId)!.now({ html: "page" });
  assert.ok(selected.html.includes("ONE_LIBRARY_HTML"));
  assert.equal(selected.libs.libraries.length, 1);
  const oneBrowser = client_projection_map({ authority: selected.libs, local: {} });
  const onePairServer = new Set<(raw: string) => void>();
  const onePairClient = new Set<(raw: string) => void>();
  const browserSocket: LocusWebSocketLike = { send(raw) { for (const listener of onePairServer) listener(raw); }, close() {},
    onMessage(listener) { onePairClient.add(listener); return () => { onePairClient.delete(listener); }; }, onClose() { return () => {}; } };
  const authoritySocket: LocusWebSocketLike = { send(raw) { frames.push(raw); for (const listener of onePairClient) listener(raw); }, close() {},
    onMessage(listener) { onePairServer.add(listener); return () => { onePairServer.delete(listener); }; }, onClose() { return () => {}; } };
  stop();
  let stopOne = bind_locus_websocket(oneLocus, authoritySocket);
  const oneEcho = create_echo_aggregate_client_internal({ transport: test_echo_transport(browserSocket), map: oneBrowser,
    session: { credential } });
  assert.equal((await oneEcho.connect()).outcome, "current");
  await oneLocus.mutate((draft) => { const page = draft.lib("page"); if ("attrs" in page) page.attrs.set({ kind: "path", path: validate_document_path([0]) }, "title", "ONE_LIBRARY_LIVE"); });
  assert.equal(oneEcho.lastAppliedRev, oneLocus.rev);
  oneEcho.disconnect(); stopOne();
  await oneLocus.mutate((draft) => { const page = draft.lib("page"); if ("attrs" in page) page.attrs.set({ kind: "path", path: validate_document_path([0]) }, "title", "ONE_LIBRARY_RECOVERY"); });
  stopOne = bind_locus_websocket(oneLocus, authoritySocket);
  assert.equal((await oneEcho.connect()).outcome, "replay");
  assert.equal(oneEcho.lastAppliedRev, oneLocus.rev);
  assert.equal(frames.some((raw) => raw.includes("ONE_LIBRARY_RECOVERY")), true);
  oneEcho.dispose(); stopOne(); oneLocus.dispose();
}
console.log("Step 6E projected hosted cut acceptance passed.");
