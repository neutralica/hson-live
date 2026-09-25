import assert from "node:assert/strict";
import { Hson, hsonLiveMap, hsonLocus, add_interaction, enable_interactions, encode_ssr_bootstrap,
  decode_ssr_bootstrap, render_hosted_document, render_document, type HsonSchema } from "../src/index.ts";
import type { LocusSocketLike } from "../src/types/locus.types.ts";
import { create_echo_socket_client_internal } from "../src/api/echo/echo.aggregate-replica.ts";
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
  kind: "browser-local", key: "PERMITTED_INTERACTION_SENTINEL", args: Hson.data.from(null) });
add_interaction(map, { id: "private", subject: { library: "privatePage", path: [99] }, listener,
  kind: "browser-local", key: "PRIVATE_INTERACTION_SENTINEL", args: Hson.data.from(null) });
add_interaction(map, { id: "unselected", subject: { library: "unselectedPage", path: [99] }, listener,
  kind: "browser-local", key: "UNSELECTED_INTERACTION_SENTINEL", args: Hson.data.from(null) });
return map;
}

const map = hostile_map();

const locus = hsonLocus.create({ map,
  exposure: [
    { library: "page", exposure: "client-public" },
    { library: "permittedData", exposure: "client-public" },
    { library: "PRIVATE_NAME_SENTINEL", exposure: "server-private" },
    { library: "privatePage", exposure: "server-private" },
    { library: "UNSELECTED_NAME_SENTINEL", exposure: "client-public" },
    { library: "unselectedPage", exposure: "client-public" },
  ],
  authorizeProjection: () => ({ libraries: ["page", "permittedData", "unselectedPage"], systemFeatures: ["interactions"] }),
});

const serverSent: Array<Record<string, unknown>> = [];
let receive: ((raw: string) => void) | undefined;
const socket: LocusSocketLike = {
  send(raw) { serverSent.push(JSON.parse(raw) as Record<string, unknown>); }, close() {},
  onMessage(listener) { receive = listener; return () => { receive = undefined; }; },
  onClose() { return () => {}; },
};
const disconnect = locus.connect(socket);
receive?.(JSON.stringify({ type: "session-create", id: "ssr", projection: {
  libraries: ["permittedData"], htmlDocument: "page", systemFeatures: ["interactions"],
} }));
const created = serverSent.find((entry) => entry.type === "session-created");
assert.ok(created && typeof created.sessionId === "string");
const sessionId = created.sessionId;
let receiveNoDefault: ((raw: string) => void) | undefined;
const noDefaultSent: Array<Record<string, unknown>> = [];
const noDefaultSocket: LocusSocketLike = {
  send(raw) { noDefaultSent.push(JSON.parse(raw) as Record<string, unknown>); }, close() {},
  onMessage(listener) { receiveNoDefault = listener; return () => { receiveNoDefault = undefined; }; },
  onClose() { return () => {}; },
};
const disconnectNoDefault = locus.connect(noDefaultSocket);
receiveNoDefault?.(JSON.stringify({ type: "session-create", id: "no-default", projection: { libraries: ["page"] } }));
const noDefaultCreated = noDefaultSent.find((entry) => entry.type === "session-created");
assert.ok(noDefaultCreated && typeof noDefaultCreated.sessionId === "string");
const noDefaultSessionId = noDefaultCreated.sessionId;
assert.throws(() => locus.cut(noDefaultSessionId), /selection is required/i);
const explicitCut = locus.cut(noDefaultSessionId, "page");
assert.ok(explicitCut.html.includes("PERMITTED_HTML_SENTINEL"));

assert.throws(() => locus.cut(""), /projection is unavailable/i);
assert.throws(() => locus.cut(sessionId, "privatePage"), /unavailable/i);
assert.throws(() => locus.cut(sessionId, "unselectedPage"), /unavailable/i);
assert.throws(() => locus.cut(sessionId, "permittedData"), /unavailable/i);
const cut = locus.cut(sessionId);
assert.notEqual(cut.projectionDigest, explicitCut.projectionDigest);
assert.equal(cut.document, "page");
assert.equal(cut.revision, cut.data.revision);
assert.equal(cut.projectionDigest, cut.data.projectionDigest);
assert.equal(cut.data.htmlDocument, "page");
assert.ok(cut.html.includes("PERMITTED_HTML_SENTINEL"));
assert.equal(cut.html.includes("hson:quid"), false);
assert.equal(cut.data.libraries.some((entry) => entry.name === "permittedData"), true);
const rendered = render_hosted_document({ authority: locus, sessionId });
assert.equal(rendered.html, cut.html);
assert.equal(rendered.bootstrap.projectionDigest, cut.projectionDigest);
const wire = encode_ssr_bootstrap(cut.data);
const raw = Buffer.from(wire, "base64url").toString("utf8");
assert.equal(JSON.parse(raw).version, 3);
assert.equal(JSON.parse(raw).kind, "hosted-projection");
const decoded = decode_ssr_bootstrap(wire);
assert.equal(decoded.kind, "hosted-projection");
if (decoded.kind !== "hosted-projection") throw new Error("Expected projected SSR bootstrap.");
assert.deepEqual(decoded.bootstrap, cut.data);
const wrongProjection = JSON.parse(raw);
wrongProjection.payload.projectionDigest = "0".repeat(64);
assert.throws(() => decode_ssr_bootstrap(Buffer.from(JSON.stringify(wrongProjection)).toString("base64url")), /payload is invalid/i);
const malformedCarrier = JSON.parse(raw);
malformedCarrier.payload.libraries[0].root.payload = "<malformed>";
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
const client = hsonLiveMap.fromClientSnapshot({ authority: decoded.bootstrap,
  localLibraries: { local: { data: { value: "CLIENT_LOCAL_SENTINEL" }, schema: Data } } });
assert.equal(client.rev, 0);
assert.equal(client.lib("local").mode, "data-object");
assert.equal(raw.includes("CLIENT_LOCAL_SENTINEL"), false);
const retained = JSON.stringify(cut);
await locus.mutate((draft) => { const library = draft.lib("permittedData"); if ("at" in library) library.at(["value"]).set("AFTER_CUT_SENTINEL"); });
assert.equal(JSON.stringify(cut), retained);
assert.equal(cut.revision + 1, locus.rev);
const next = locus.cut(sessionId);
assert.equal(next.revision, locus.rev);
assert.ok(JSON.stringify(next.data).includes("AFTER_CUT_SENTINEL"));
assert.equal(next.html, cut.html);
const serverListeners = new Set<(raw: string) => void>();
const clientListeners = new Set<(raw: string) => void>();
const downstream: string[] = [];
const clientSocket: LocusSocketLike = {
  send(raw) { for (const listener of [...serverListeners]) listener(raw); }, close() {},
  onMessage(listener) { clientListeners.add(listener); return () => { clientListeners.delete(listener); }; },
  onClose() { return () => {}; },
};
const serverSocket: LocusSocketLike = {
  send(raw) { downstream.push(raw); for (const listener of [...clientListeners]) listener(raw); }, close() {},
  onMessage(listener) { serverListeners.add(listener); return () => { serverListeners.delete(listener); }; },
  onClose() { return () => {}; },
};
disconnect();
let stopServer = locus.connect(serverSocket);
const echoClient = create_echo_socket_client_internal({ socket: clientSocket,
  map: client, session: { credential: created.credential as string } });
assert.equal(echoClient.lastAppliedRev, cut.revision);
const firstRecovery = await echoClient.connect();
assert.equal(firstRecovery.outcome, "replay");
assert.equal(echoClient.lastAppliedRev, cut.revision + 1);
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
stopServer = locus.connect(serverSocket);
const secondRecovery = await echoClient.connect();
assert.equal(secondRecovery.outcome, "replay");
assert.equal(echoClient.lastAppliedRev, cut.revision + 2);
assert.equal(client.rev, 1);
assert.equal(client.lib("local").mode, "data-object");
assert.ok(downstream.some((raw) => raw.includes('"progress"')));
assert.equal(downstream.join("\n").includes("PRIVATE_AFTER_DISCONNECT"), false);
echoClient.dispose();
stopServer();
assert.equal(locus.revokeSession(sessionId), true);
assert.throws(() => locus.cut(sessionId), /projection is unavailable/i);
assert.throws(() => render_hosted_document({ authority: locus, sessionId }), /projection is unavailable/i);
disconnectNoDefault();
locus.dispose();

// Local rendering remains independent of hosted authorization.
const local = hsonLiveMap.fromLibraries({ page: { document: '<main <p "LOCAL_CUT"/>/>', schema: Page } });
assert.match(render_document({ map: local }).html, /LOCAL_CUT/);

// The same hostile authority fixture crosses an actual SSR -> live -> history-insufficient
// recovery. Inspect every emitted wire frame, including the fallback envelope and tail.
{
  let recoveryCuts = 0;
  let mutateTail: (() => Promise<void>) | undefined;
  const fallbackMap = hostile_map();
  const { locus: fallbackLocus } = create_registry_locus_internal({ map: fallbackMap,
    exposure: [
      { library: "page", exposure: "client-public" },
      { library: "permittedData", exposure: "client-public" },
      { library: "PRIVATE_NAME_SENTINEL", exposure: "server-private" },
      { library: "privatePage", exposure: "server-private" },
      { library: "UNSELECTED_NAME_SENTINEL", exposure: "client-public" },
      { library: "unselectedPage", exposure: "client-public" },
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
  const creationSocket: LocusSocketLike = { send(raw) {
    const frame = JSON.parse(raw) as Record<string, unknown>;
    if (frame.type === "session-created") {
      credential = frame.credential as string;
      fallbackSessionId = frame.sessionId as string;
    }
  }, close() {}, onMessage(listener) { createReceiver = listener; return () => { createReceiver = undefined; }; },
  onClose() { return () => {}; } };
  const stopCreation = fallbackLocus.connect(creationSocket);
  createReceiver?.(JSON.stringify({ type: "session-create", id: "hostile-fallback-session", projection: {
    libraries: ["permittedData"], htmlDocument: "page", systemFeatures: ["interactions"],
  } }));
  assert.ok(credential && fallbackSessionId);
  const ssr = fallbackLocus.cut(fallbackSessionId);
  const browserMap = hsonLiveMap.fromClientSnapshot({ authority: ssr.data,
    localLibraries: { local: { data: { value: "CLIENT_LOCAL_SENTINEL" }, schema: Data } } });
  assert.equal(browserMap.rev, 0);
  stopCreation();
  const toServer = new Set<(raw: string) => void>();
  const toClient = new Set<(raw: string) => void>();
  const wireFrames: string[] = [];
  const browserSocket: LocusSocketLike = { send(raw) { for (const listener of [...toServer]) listener(raw); },
    close() {}, onMessage(listener) { toClient.add(listener); return () => { toClient.delete(listener); }; },
    onClose() { return () => {}; } };
  const authoritySocket: LocusSocketLike = { send(raw) { wireFrames.push(raw); for (const listener of [...toClient]) listener(raw); },
    close() {}, onMessage(listener) { toServer.add(listener); return () => { toServer.delete(listener); }; },
    onClose() { return () => {}; } };
  let stopAuthority = fallbackLocus.connect(authoritySocket);
  const browser = create_echo_socket_client_internal({ socket: browserSocket, map: browserMap,
    session: { credential } });
  assert.equal(browser.lastAppliedRev, ssr.revision);
  assert.equal((await browser.connect()).outcome, "current");
  await fallbackLocus.mutate((draft) => { const permitted = draft.lib("permittedData");
    if ("at" in permitted) permitted.at(["value"]).set("PERMITTED_LIVE_SENTINEL"); });
  assert.equal(browser.lastAppliedRev, ssr.revision + 1);
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
  stopAuthority = fallbackLocus.connect(authoritySocket);
  assert.equal((await browser.connect()).outcome, "snapshot");
  assert.equal(browser.lastAppliedRev, fallbackLocus.rev);
  assert.equal(browser.map, browserMap);
  assert.equal(browserMap.lib("local"), localLibrary);
  assert.equal(localHandle.snap(), "LOCAL_SURVIVES_FALLBACK_SENTINEL");
  assert.equal(projectedHandle.active, false);
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
// recovery machinery. It gains no implicit exposure, projection, or document.
{
  const oneMap = hsonLiveMap.fromLibraries({ page: { document: '<main <p "ONE_LIBRARY_HTML"/>/>', schema: Page } });
  assert.throws(() => hsonLocus.create({ map: oneMap, exposure: [] }), /exposure configuration/i);
  const oneLocus = hsonLocus.create({ map: oneMap, exposure: [{ library: "page", exposure: "client-public" }],
    authorizeProjection: () => ({ libraries: ["page"] }) });
  let receive: ((raw: string) => void) | undefined;
  let sessionId: string | undefined;
  let credential: string | undefined;
  const frames: string[] = [];
  const socket: LocusSocketLike = { send(raw) { frames.push(raw); const message = JSON.parse(raw) as Record<string, unknown>;
    if (message.type === "session-created") { sessionId = message.sessionId as string; credential = message.credential as string; }
  }, close() {}, onMessage(listener) { receive = listener; return () => { receive = undefined; }; },
  onClose() { return () => {}; } };
  const stop = oneLocus.connect(socket);
  receive?.(JSON.stringify({ type: "session-create", id: "one-library", projection: { libraries: ["page"] } }));
  if (sessionId === undefined || credential === undefined) throw new Error("One-library session was unavailable.");
  const selectedId: string = sessionId;
  assert.throws(() => oneLocus.cut(selectedId), /selection is required/i);
  const selected = oneLocus.cut(selectedId, "page");
  assert.ok(selected.html.includes("ONE_LIBRARY_HTML"));
  assert.equal(selected.data.libraries.length, 1);
  const oneBrowser = hsonLiveMap.fromClientSnapshot({ authority: selected.data, localLibraries: {} });
  const onePairServer = new Set<(raw: string) => void>();
  const onePairClient = new Set<(raw: string) => void>();
  const browserSocket: LocusSocketLike = { send(raw) { for (const listener of onePairServer) listener(raw); }, close() {},
    onMessage(listener) { onePairClient.add(listener); return () => { onePairClient.delete(listener); }; }, onClose() { return () => {}; } };
  const authoritySocket: LocusSocketLike = { send(raw) { frames.push(raw); for (const listener of onePairClient) listener(raw); }, close() {},
    onMessage(listener) { onePairServer.add(listener); return () => { onePairServer.delete(listener); }; }, onClose() { return () => {}; } };
  stop();
  let stopOne = oneLocus.connect(authoritySocket);
  const oneEcho = create_echo_socket_client_internal({ socket: browserSocket, map: oneBrowser,
    session: { credential } });
  assert.equal((await oneEcho.connect()).outcome, "current");
  await oneLocus.mutate((draft) => { const page = draft.lib("page"); if ("attrs" in page) page.attrs.set({ kind: "path", path: validate_document_path([0]) }, "title", "ONE_LIBRARY_LIVE"); });
  assert.equal(oneEcho.lastAppliedRev, oneLocus.rev);
  oneEcho.disconnect(); stopOne();
  await oneLocus.mutate((draft) => { const page = draft.lib("page"); if ("attrs" in page) page.attrs.set({ kind: "path", path: validate_document_path([0]) }, "title", "ONE_LIBRARY_RECOVERY"); });
  stopOne = oneLocus.connect(authoritySocket);
  assert.equal((await oneEcho.connect()).outcome, "replay");
  assert.equal(oneEcho.lastAppliedRev, oneLocus.rev);
  assert.equal(frames.some((raw) => raw.includes("ONE_LIBRARY_RECOVERY")), true);
  oneEcho.dispose(); stopOne(); oneLocus.dispose();
}
console.log("Step 6E projected hosted cut acceptance passed.");
