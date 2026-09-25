import assert from "node:assert/strict";
import { hsonLiveMap, hsonLocus, type LocusSocketLike } from "../src/index.ts";
import { create_echo_socket_client_internal } from "../src/api/echo/echo.aggregate-replica.ts";
import { create_locus_hosted_aggregate_socket_internal } from "../src/api/locus/locus.aggregate.socket.ts";
import { create_persistent_locus } from "../src/api/locus/index.ts";
import { parse_document_stylesheet } from "../src/internal/css/parse-document-stylesheet.ts";
import { MemoryCheckpointAdapter } from "./helpers/memory-checkpoint-adapter.mts";
import { create_persistent_locus_hosted_aggregate_internal,
  restore_persistent_locus_hosted_aggregate_internal } from "../src/api/locus/locus.aggregate.persistence.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({ id: "css.hosted-phase-c", title: "Hosted document CSS parity",
  category: "Locus", runtime: "node", tags: Object.freeze(["css", "hosted", "echo", "security", "durability"]) });

function pair() {
  const serverListeners = new Set<(raw: string) => void>();
  const clientListeners = new Set<(raw: string) => void>();
  const sent: string[] = [];
  const client: LocusSocketLike = {
    send(raw) { for (const listener of [...serverListeners]) listener(raw); }, close() {},
    onMessage(listener) { clientListeners.add(listener); return () => { clientListeners.delete(listener); }; },
    onClose() { return () => {}; },
  };
  const server: LocusSocketLike = {
    send(raw) { sent.push(raw); for (const listener of [...clientListeners]) listener(raw); }, close() {},
    onMessage(listener) { serverListeners.add(listener); return () => { serverListeners.delete(listener); }; },
    onClose() { return () => {}; },
  };
  return { client, server, sent, deliver(raw: string) { for (const listener of [...clientListeners]) listener(raw); } };
}

const map = hsonLiveMap.fromLibraries({
  page: { document: '<html <head/> <body <p "Hello"/>/>/>' },
  privatePage: { document: '<html <head/> <body/>/>' },
  ungrantedPage: { document: '<html <head/> <body/>/>' },
});
const page = map.lib("page"), privatePage = map.lib("privatePage"), ungranted = map.lib("ungrantedPage");
if (page.mode !== "document" || privatePage.mode !== "document" || ungranted.mode !== "document") throw new Error("Expected documents.");
page.css.stylesheet("p { color: rgb(1, 2, 3) !important; }");
privatePage.css.stylesheet(`.PRIVATE_CSS_SENTINEL { color: red; --blob: ${"x".repeat(25_000)}; }`);
ungranted.css.stylesheet(".UNGRANTED_CSS_SENTINEL { color: blue; }");
const locus = hsonLocus.create({ map,
  exposure: [
    { library: "page", exposure: "client-public" },
    { library: "privatePage", exposure: "server-private" },
    { library: "ungrantedPage", exposure: "client-public" },
  ],
  defaultProjection: { libraries: ["page"], htmlDocument: "page" },
  authorizeProjection: ({ requested }) => ({ libraries: requested.libraries, writableDocuments: ["page"] }),
});
const wire = pair();
let detach = locus.connect(wire.server, { principalId: "alice" });
const echo = create_echo_socket_client_internal({ socket: wire.client, logicalMapId: locus.logicalMapId,
  localLibraries: { localPage: { document: '<html <head/> <body/>/>' } } });
await echo.connect();
const client = echo.map;
if (client === undefined) throw new Error("Missing client map.");
const clientPage = client.lib("page"), localPage = client.lib("localPage");
if (clientPage.mode !== "document" || localPage.mode !== "document") throw new Error("Expected client documents.");
const initial = clientPage.css.snapshot();
assert.match(initial, /rgb\(1,2,3\)/);
assert.throws(() => clientPage.css.clearAll(), /hosted|managed|projection|authority/i);
assert.throws(() => page.css.clearAll(), /hosted|managed|authority/i);
localPage.css.stylesheet("body { color: green; }");
const localCss = localPage.css.snapshot();
const localRev = client.rev;
const sessionId = echo.session.sessionId;
if (sessionId === undefined) throw new Error("Missing Echo session.");
const cut = locus.cut(sessionId, "page");
assert.match(cut.html, /rgb\(1,2,3\)/);
assert.deepEqual(cut.data.libraries.find((entry) => entry.name === "page")?.css, map.capture().libraries.find((entry) => entry.name === "page")?.css);
assert.throws(() => hsonLiveMap.fromClientSnapshot({ authority: cut.data,
  localLibraries: { page: { document: '<html <head/> <body/>/>' } } }), /collid|duplicat|conflict/i);
for (const raw of [...wire.sent, JSON.stringify(cut)]) {
  assert.equal(raw.includes("PRIVATE_CSS_SENTINEL"), false);
  assert.equal(raw.includes("UNGRANTED_CSS_SENTINEL"), false);
}
assert.ok(wire.sent.every((raw) => raw.length < 10_000), "Private CSS must not inflate the projected bootstrap.");
const append = (css: string, existing: readonly string[] = []) => ({ domain: "css" as const, kind: "append" as const,
  stylesheet: parse_document_stylesheet(css, existing) });
await locus.mutate((draft) => { const selected = draft.lib("page"); if ("graph" in selected) selected.css(append("@media screen { p { background: navy; } }", page.css.list())); });
assert.match(clientPage.css.snapshot(), /background:navy/);
assert.equal(client.rev, localRev + 1);
const live = wire.sent.at(-1) ?? "";
assert.match(live, /hson-document-css-op/);
assert.equal(live.includes("PRIVATE_CSS_SENTINEL"), false);
assert.equal(live.includes("UNGRANTED_CSS_SENTINEL"), false);
const beforeHidden = wire.sent.length;
const localRevBeforeHidden = client.rev;
await locus.mutate((draft) => { const selected = draft.lib("privatePage"); if ("graph" in selected) selected.css(append(".PRIVATE_LIVE_CSS_SENTINEL { color: black; }", privatePage.css.list())); });
await locus.mutate((draft) => { const selected = draft.lib("ungrantedPage"); if ("graph" in selected) selected.css(append(".UNGRANTED_LIVE_CSS_SENTINEL { color: yellow; }", ungranted.css.list())); });
for (const raw of wire.sent.slice(beforeHidden)) {
  assert.equal(raw.includes("PRIVATE_LIVE_CSS_SENTINEL"), false);
  assert.equal(raw.includes("UNGRANTED_LIVE_CSS_SENTINEL"), false);
}
assert.equal(clientPage.css.snapshot().includes("PRIVATE_LIVE_CSS_SENTINEL"), false);
assert.equal(client.rev, localRevBeforeHidden);
assert.equal(echo.lastAppliedRev, locus.rev);
const authored = await echo.action("document.css", { library: "page",
  operation: { domain: "css", kind: "property", name: "--phase",
    definition: { name: "--phase", syn: "<number>", inh: false, init: "0" } } });
assert.equal(authored.type, "ack");
assert.match(clientPage.css.snapshot(), /@property --phase/);
const forbidden = await echo.action("document.css", { library: "ungrantedPage",
  operation: { domain: "css", kind: "clear-all" } });
assert.equal(forbidden.type, "error");
if (forbidden.type === "error") assert.equal(forbidden.error.code, "LOCUS_ACTION_FORBIDDEN");
assert.match(ungranted.css.snapshot(), /UNGRANTED_CSS_SENTINEL/);
echo.disconnect(); detach();
await locus.mutate((draft) => { const selected = draft.lib("page"); if ("graph" in selected) selected.css(append("@keyframes pulse { from { opacity: 0; } to { opacity: 1; } }", page.css.list())); });
detach = locus.connect(wire.server, { principalId: "alice" });
const recovered = await echo.connect();
assert.equal(recovered.outcome, "replay");
assert.match(clientPage.css.snapshot(), /@keyframes pulse/);
assert.equal(localPage.css.snapshot(), localCss);
echo.disconnect(); detach();
await locus.sessions.updateProjection(sessionId,
  { libraries: ["page", "ungrantedPage"], htmlDocument: "page" }, { principalId: "alice" });
detach = locus.connect(wire.server, { principalId: "alice" });
assert.ok(["current", "snapshot"].includes((await echo.connect()).outcome));
const expanded = client.lib("ungrantedPage");
if (expanded.mode !== "document") throw new Error("Expected expanded document.");
assert.match(expanded.css.snapshot(), /UNGRANTED_CSS_SENTINEL/);
assert.match(expanded.css.snapshot(), /UNGRANTED_LIVE_CSS_SENTINEL/);
echo.disconnect(); detach();
await locus.sessions.updateProjection(sessionId,
  { libraries: ["ungrantedPage"], htmlDocument: "ungrantedPage" }, { principalId: "alice" });
detach = locus.connect(wire.server, { principalId: "alice" });
assert.ok(["current", "snapshot"].includes((await echo.connect()).outcome));
assert.throws(() => client.lib("page"), /Unknown/);
assert.throws(() => clientPage.css.snapshot());
wire.deliver(live);
assert.throws(() => client.lib("page"), /Unknown/);
assert.equal(localPage.css.snapshot(), localCss);
assert.throws(() => locus.cut(sessionId, "page"), /unavailable/);
echo.disconnect(); detach();
await locus.sessions.updateProjection(sessionId,
  { libraries: ["page", "ungrantedPage"], htmlDocument: "page" }, { principalId: "alice" });
detach = locus.connect(wire.server, { principalId: "alice" });
assert.ok(["current", "snapshot"].includes((await echo.connect()).outcome));
const regranted = client.lib("page");
if (regranted.mode !== "document") throw new Error("Expected regranted document.");
assert.notEqual(regranted, clientPage);
assert.match(regranted.css.snapshot(), /@keyframes pulse/);
assert.throws(() => clientPage.css.snapshot());
echo.dispose(); detach(); locus.dispose();

const adapter = new MemoryCheckpointAdapter();
const durable = hsonLiveMap.fromLibraries({ page: { document: '<html <head/> <body/>/>' } });
const persistent = await create_persistent_locus_hosted_aggregate_internal({ map: durable, persistence: adapter,
  logicalMapId: "hosted-css-phase-c" });
await persistent.mutate((draft) => { const selected = draft.lib("page"); if ("graph" in selected) selected.css(append("body { color: purple; }")); });
await persistent.checkpoint();
await persistent.mutate((draft) => { const selected = draft.lib("page"); if ("graph" in selected) selected.css(append("body { background: teal; }", ["stylesheet:1"])); });
const state = adapter.state("hosted-css-phase-c");
if (state === undefined) throw new Error("Missing durable state.");
const restored = await restore_persistent_locus_hosted_aggregate_internal("hosted-css-phase-c", state, { persistence: adapter });
assert.ok(restored);
const restoredPage = restored.map.lib("page");
if (restoredPage.mode !== "document") throw new Error("Expected restored document.");
assert.match(restoredPage.css.snapshot(), /color:purple/);
assert.match(restoredPage.css.snapshot(), /background:teal/);
const durableCss = restoredPage.css.snapshot();
const beforeFailureRev = restored.rev;
adapter.failAppend = new Error("CSS append rejected");
await assert.rejects(() => restored.mutate((draft) => { const selected = draft.lib("page"); if ("graph" in selected) selected.css(append("body { margin: 9px; }", restoredPage.css.list())); }),
  { code: "LOCUS_PERSISTENCE_APPEND_FAILED" });
assert.equal(restored.rev, beforeFailureRev);
assert.equal(restoredPage.css.snapshot(), durableCss);
await restored.checkpoint();
const checkpointAtS2 = adapter.state("hosted-css-phase-c");
if (checkpointAtS2 === undefined) throw new Error("Missing stylesheet S2 checkpoint.");
const restoredAtS2 = await restore_persistent_locus_hosted_aggregate_internal("hosted-css-phase-c", checkpointAtS2,
  { persistence: adapter });
assert.ok(restoredAtS2);
const checkpointPage = restoredAtS2.map.lib("page");
if (checkpointPage.mode !== "document") throw new Error("Expected checkpoint stylesheet document.");
assert.equal(checkpointPage.css.snapshot(), durableCss);

const fallbackMap = hsonLiveMap.fromLibraries({
  page: { document: '<html <head/> <body/>/>' },
  hidden: { document: '<html <head/> <body/>/>' },
});
const fallbackPage = fallbackMap.lib("page"), fallbackHidden = fallbackMap.lib("hidden");
if (fallbackPage.mode !== "document" || fallbackHidden.mode !== "document") throw new Error("Expected fallback documents.");
fallbackPage.css.stylesheet("body { color: olive; }");
fallbackHidden.css.stylesheet(".HIDDEN_FALLBACK_CSS_SENTINEL { color: red; }");
const fallbackHost = create_locus_hosted_aggregate_socket_internal({ map: fallbackMap, maxHistoryBytes: 1,
  exposure: [{ library: "page", exposure: "client-public" }, { library: "hidden", exposure: "server-private" }],
  defaultProjection: { libraries: ["page"], htmlDocument: "page" },
  authorizeProjection: () => ({ libraries: ["page"] }) });
const fallbackWire = pair();
let stopFallback = fallbackHost.connect(fallbackWire.server);
const fallbackEcho = create_echo_socket_client_internal({ socket: fallbackWire.client, logicalMapId: fallbackHost.logicalMapId,
  localLibraries: { localPage: { document: '<html <head/> <body/>/>' } } });
await fallbackEcho.connect();
const fallbackClient = fallbackEcho.map;
if (fallbackClient === undefined) throw new Error("Missing fallback client.");
const fallbackLocal = fallbackClient.lib("localPage");
if (fallbackLocal.mode !== "document") throw new Error("Expected local fallback document.");
fallbackLocal.css.stylesheet("body { color: cyan; }");
const fallbackLocalCss = fallbackLocal.css.snapshot();
fallbackEcho.disconnect(); stopFallback();
await fallbackHost.mutate((draft) => { const selected = draft.lib("page"); if ("graph" in selected) selected.css(append("@media screen { body { background: coral; } }", fallbackPage.css.list())); });
await fallbackHost.mutate((draft) => { const selected = draft.lib("hidden"); if ("graph" in selected) selected.css(append(".HIDDEN_FALLBACK_TAIL_SENTINEL { color: blue; }", fallbackHidden.css.list())); });
stopFallback = fallbackHost.connect(fallbackWire.server);
assert.equal((await fallbackEcho.connect()).outcome, "snapshot");
const fallbackProjected = fallbackClient.lib("page");
if (fallbackProjected.mode !== "document") throw new Error("Expected fallback projected document.");
assert.match(fallbackProjected.css.snapshot(), /background:coral/);
assert.equal(fallbackLocal.css.snapshot(), fallbackLocalCss);
for (const raw of fallbackWire.sent) {
  assert.equal(raw.includes("HIDDEN_FALLBACK_CSS_SENTINEL"), false);
  assert.equal(raw.includes("HIDDEN_FALLBACK_TAIL_SENTINEL"), false);
}
fallbackEcho.dispose(); stopFallback(); fallbackHost.dispose();

const restartAdapter = new MemoryCheckpointAdapter();
const restartInput = () => hsonLiveMap.fromLibraries({ page: { document: '<html <head/> <body/>/>' } });
const restartMap = restartInput();
const restartPage = restartMap.lib("page");
if (restartPage.mode !== "document") throw new Error("Expected restart document.");
const restartOptions = {
  persistence: restartAdapter, logicalMapId: "hosted-css-restart",
  exposure: [{ library: "page", exposure: "client-public" as const }],
  defaultProjection: { libraries: ["page"], htmlDocument: "page" },
  authorizeProjection: () => ({ libraries: ["page"] }),
};
const firstAuthority = await create_persistent_locus({ map: restartMap, ...restartOptions });
await firstAuthority.mutate((draft) => { draft.lib("page").css(append("body { color: maroon; }")); });
await firstAuthority.checkpoint();
const restartWire = pair();
let stopRestart = firstAuthority.connect(restartWire.server);
const restartEcho = create_echo_socket_client_internal({ socket: restartWire.client, logicalMapId: firstAuthority.logicalMapId,
  localLibraries: { localPage: { document: '<html <head/> <body/>/>' } } });
await restartEcho.connect();
const restartClient = restartEcho.map;
if (restartClient === undefined) throw new Error("Missing restart client.");
const restartLocal = restartClient.lib("localPage");
if (restartLocal.mode !== "document") throw new Error("Expected restart local document.");
restartLocal.css.stylesheet("body { color: lime; }");
const restartLocalCss = restartLocal.css.snapshot();
const beforeRejectedCssRev = firstAuthority.rev;
const beforeRejectedClientCss = restartClient.lib("page");
if (beforeRejectedClientCss.mode !== "document") throw new Error("Expected projected CSS before failure.");
const beforeRejectedCss = beforeRejectedClientCss.css.snapshot();
const beforeRejectedWire = restartWire.sent.length;
restartAdapter.failAppend = new Error("CSS durable acceptance rejected");
await assert.rejects(() => firstAuthority.mutate((draft) => { draft.lib("page").css(append("body { margin: 11px; }", restartPage.css.list())); }),
  { code: "LOCUS_PERSISTENCE_APPEND_FAILED" });
assert.equal(firstAuthority.rev, beforeRejectedCssRev);
assert.equal(restartMap.rev, beforeRejectedCssRev);
assert.equal(restartEcho.lastAppliedRev, beforeRejectedCssRev);
assert.equal(beforeRejectedClientCss.css.snapshot(), beforeRejectedCss);
assert.equal(restartWire.sent.length, beforeRejectedWire);
restartEcho.disconnect(); stopRestart();
await firstAuthority.mutate((draft) => { draft.lib("page").css(append("body { background: silver; }", restartPage.css.list())); });
restartEcho.dispose();
firstAuthority.dispose();
const restarted = await create_persistent_locus({ map: restartInput(), ...restartOptions });
stopRestart = restarted.connect(restartWire.server);
const resumedEcho = create_echo_socket_client_internal({ socket: restartWire.client, map: restartClient,
  logicalMapId: restarted.logicalMapId });
assert.equal((await resumedEcho.connect()).outcome, "snapshot");
const restartedProjected = restartClient.lib("page");
if (restartedProjected.mode !== "document") throw new Error("Expected restarted projected document.");
assert.match(restartedProjected.css.snapshot(), /color:maroon/);
assert.match(restartedProjected.css.snapshot(), /background:silver/);
assert.equal(restartLocal.css.snapshot(), restartLocalCss);
resumedEcho.dispose(); stopRestart(); restarted.dispose();
process.stdout.write("Hosted document CSS Phase C acceptance passed.\n");
