import { create_locus_fixture, resume_locus_fixture, authority_groups_from_catalog_fixture, authority_groups_from_map_fixture, authority_definition_from_fixture_options } from "./helpers/locus-definition-fixture.mts";
import { test_echo_transport } from "./helpers/echo-websocket-transport.mts";
import { bind_locus_websocket } from "../src/api/locus/locus.websocket.ts";
import { client_projection_map } from "./helpers/client-projection.mts";
import assert from "node:assert/strict";
import { hsonLiveMap, type LocusWebSocketLike } from "../src/index.ts";
import { create_echo_aggregate_client_internal } from "../src/api/echo/echo.aggregate-replica.ts";
import { local_initializers } from "./helpers/client-projection.mts";
import { create_locus_hosted_aggregate_authority_internal } from "../src/api/locus/locus.aggregate.authority.ts";
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
  const client: LocusWebSocketLike = {
    send(raw) { for (const listener of [...serverListeners]) listener(raw); }, close() {},
    onMessage(listener) { clientListeners.add(listener); return () => { clientListeners.delete(listener); }; },
    onClose() { return () => {}; },
  };
  const server: LocusWebSocketLike = {
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
const fidelitySource = String.raw`p { color: rgb(1, 2, 3) !important; }
  @layer { .layer { CoLoR: red !important; } .layer { c\6f lor: blue !important; } }
  @media screen { @layer { #t\ { font-family: foo\ ; } } }
  @layer { @media screen { .escaped-newline { --x:"review\
word"; font-family:var(--x); } } }
  @keyframes fidelity { 0% { opacity: .2; } from { opacity: .8; } }`;
page.css.stylesheet(fidelitySource);
const fidelityRecord = map.capture().libraries.find(entry => entry.name === "page")?.css;
assert.ok(fidelityRecord);
assert.deepEqual(fidelityRecord.order[1], {kind:"group", header:"@layer", entries:[
  {kind:"rule",ruleKey:"stylesheet:2",scopes:["@layer"]},
  {kind:"rule",ruleKey:"stylesheet:3",scopes:["@layer"]},
]});
assert.deepEqual(fidelityRecord.keyframes[0]?.steps.map(step => step.at), ["0%", "from"]);
privatePage.css.stylesheet(`.PRIVATE_CSS_SENTINEL { color: red; --blob: ${"x".repeat(25_000)}; }`);
ungranted.css.stylesheet(".UNGRANTED_CSS_SENTINEL { color: blue; }");
const locus = create_locus_fixture({ ...authority_groups_from_map_fixture(map, [
    { name: "page", ownership: "shared" },
    { name: "privatePage", ownership: "private" },
    { name: "ungrantedPage", ownership: "shared" },
  ]), defaultProjection: { libraries: ["page"] }, authorizeProjection: ({ requested }) => ({ libraries: requested.libraries, writableDocuments: ["page"] }) });
const managedPage = locus.lib("page");
if (managedPage.mode !== "document") throw new Error("Expected managed document.");
const wire = pair();
let detach = bind_locus_websocket(locus, wire.server, { principalId: "alice" });
const echo = create_echo_aggregate_client_internal({ transport: test_echo_transport(wire.client), logicalMapId: locus.logicalMapId,
  initializers: local_initializers({ localPage: { document: '<html <head/> <body/>/>' } }) });
await echo.connect();
const client = echo.map;
if (client === undefined) throw new Error("Missing client map.");
const clientPage = client.lib("page"), localPage = client.lib("localPage");
if (clientPage.mode !== "document" || localPage.mode !== "document") throw new Error("Expected client documents.");
const initial = clientPage.css.snapshot();
assert.match(initial, /rgb\(1,2,3\)/);
assert.deepEqual(client.capture().libraries.find(entry => entry.name === "page")?.css, fidelityRecord);
const noopRev = locus.rev;
await locus.stage(draft => { const selected=draft.lib("page"); if ("graph" in selected) selected.css({domain:"css",kind:"replace",stylesheet:parse_document_stylesheet(fidelitySource, [])}); });
assert.equal(locus.rev, noopRev);
assert.deepEqual(client.capture().libraries.find(entry => entry.name === "page")?.css, fidelityRecord);
assert.throws(() => clientPage.css.clearAll(), /hosted|managed|projection|authority/i);
assert.equal(typeof managedPage.css.clearAll, "function", "Governed CSS authoring is exposed through authority submission");
localPage.css.stylesheet("body { color: green; }");
const localCss = localPage.css.snapshot();
const localRev = client.rev;
const sessionId = echo.session.sessionId;
if (sessionId === undefined) throw new Error("Missing Echo session.");
const cut = locus.session.get(sessionId)!.now({ html: "page" });
assert.match(cut.html, /rgb\(1,2,3\)/);
assert.deepEqual(cut.libs.libraries.find((entry) => entry.name === "page")?.css, map.capture().libraries.find((entry) => entry.name === "page")?.css);
assert.throws(() => client_projection_map({ authority: cut.libs,
  local: { page: { document: '<html <head/> <body/>/>' } } }), /collid|duplicat|conflict/i);
for (const raw of [...wire.sent, JSON.stringify(cut)]) {
  assert.equal(raw.includes("PRIVATE_CSS_SENTINEL"), false);
  assert.equal(raw.includes("UNGRANTED_CSS_SENTINEL"), false);
}
assert.ok(wire.sent.every((raw) => raw.length < 10_000), "Private CSS must not inflate the projected bootstrap.");
const rejectedBefore=locus.rev, rejectedRecord=client.capture();
let rejectedCodeInvocations=0;
for (const entries of [Array(1), Object.defineProperty([], "0", {get(){rejectedCodeInvocations++;throw Error("must not execute");},enumerable:true}), Object.assign([], {map(){rejectedCodeInvocations++;throw Error("must not execute map");}})]) {
  const malformed={rules:[],properties:[],keyframes:[],order:[{kind:"group",header:"@layer",entries}]};
  await assert.rejects(()=>locus.stage(draft=>{const selected=draft.lib("page");if("graph" in selected) selected.css({domain:"css",kind:"replace",stylesheet:malformed as unknown as NonNullable<typeof fidelityRecord>});}));
  assert.equal(locus.rev,rejectedBefore);
  assert.deepEqual(client.capture(),rejectedRecord);
}
const rejectedWireCount=wire.sent.length;
for(const operations of [Array(1),[, {domain:"css",kind:"clear-all"}], Object.defineProperty([],"0",{get(){rejectedCodeInvocations++;throw Error("executed batch getter")},enumerable:true}), Object.assign([{domain:"css",kind:"clear-all"}],{map(){rejectedCodeInvocations++;return []}})]) {
  await assert.rejects(()=>locus.stage(draft=>{const selected=draft.lib("page");if("graph" in selected) selected.css({domain:"css",kind:"batch",operations} as never);}));
  assert.equal(locus.rev,rejectedBefore);assert.deepEqual(client.capture(),rejectedRecord);assert.equal(wire.sent.length,rejectedWireCount);
}
const retainedRule=fidelityRecord.rules[0]!;
await locus.stage(draft=>{const selected=draft.lib("page");if("graph" in selected) selected.css({domain:"css",kind:"batch",operations:[{domain:"css",kind:"rule",ruleKey:retainedRule.ruleKey,scopes:retainedRule.scopes,rule:retainedRule}]});});
assert.equal(locus.rev,rejectedBefore);assert.deepEqual(client.capture(),rejectedRecord);assert.equal(wire.sent.length,rejectedWireCount);
const batchRule=(color:string)=>({domain:"css" as const,kind:"rule" as const,ruleKey:"batch-proof",scopes:[],rule:{ruleKey:"batch-proof",selector:".batch-proof",scopes:[],declarations:[["color",color] as const]}});
await locus.stage(draft=>{const selected=draft.lib("page");if("graph" in selected) selected.css({domain:"css",kind:"batch",operations:[batchRule("red"),batchRule("blue")]});});
assert.equal(locus.rev,rejectedBefore+1);assert.equal(client.rev,localRev+1);
assert.equal(wire.sent.length,rejectedWireCount+1);
assert.match(wire.sent.at(-1) ?? "",/hson-document-css-op/);
for(const snapshot of [locus.session.get(sessionId)!.now({html:"page"}).libs,client.capture()]) {
  assert.deepEqual(snapshot.libraries.find(entry=>entry.name==="page")?.css?.rules.find(rule=>rule.ruleKey==="batch-proof")?.declarations,[["color","blue"]]);
}
assert.equal(rejectedCodeInvocations,0);
const append = (css: string, existing: readonly string[] = []) => ({ domain: "css" as const, kind: "append" as const,
  stylesheet: parse_document_stylesheet(css, existing) });
await locus.stage((draft) => { const selected = draft.lib("page"); if ("graph" in selected) selected.css(append("@media screen { p { background: navy; } }", page.css.list())); });
assert.match(clientPage.css.snapshot(), /background:navy/);
assert.equal(client.rev, localRev + 2);
assert.deepEqual(client.capture().libraries.find(entry => entry.name === "page")?.css, locus.session.get(sessionId)!.now({html:"page"}).libs.libraries.find(entry => entry.name === "page")?.css);
const live = wire.sent.at(-1) ?? "";
assert.match(live, /hson-document-css-op/);
assert.equal(live.includes("PRIVATE_CSS_SENTINEL"), false);
assert.equal(live.includes("UNGRANTED_CSS_SENTINEL"), false);
const beforeHidden = wire.sent.length;
const localRevBeforeHidden = client.rev;
await locus.stage((draft) => { const selected = draft.lib("privatePage"); if ("graph" in selected) selected.css(append(".PRIVATE_LIVE_CSS_SENTINEL { color: black; }", privatePage.css.list())); });
await locus.stage((draft) => { const selected = draft.lib("ungrantedPage"); if ("graph" in selected) selected.css(append(".UNGRANTED_LIVE_CSS_SENTINEL { color: yellow; }", ungranted.css.list())); });
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
await locus.stage((draft) => { const selected = draft.lib("page"); if ("graph" in selected) selected.css(append("@keyframes pulse { from { opacity: 0; } to { opacity: 1; } }", page.css.list())); });
detach = bind_locus_websocket(locus, wire.server, { principalId: "alice" });
const recovered = await echo.connect();
assert.equal(recovered.outcome, "replay");
assert.match(clientPage.css.snapshot(), /@keyframes pulse/);
assert.equal(localPage.css.snapshot(), localCss);
echo.disconnect(); detach();
await locus.session.get(sessionId)!.update({ libraries: ["page", "ungrantedPage"] }, { principalId: "alice" });
detach = bind_locus_websocket(locus, wire.server, { principalId: "alice" });
assert.ok(["current", "reconcile"].includes((await echo.connect()).outcome));
const expanded = client.lib("ungrantedPage");
if (expanded.mode !== "document") throw new Error("Expected expanded document.");
assert.match(expanded.css.snapshot(), /UNGRANTED_CSS_SENTINEL/);
assert.match(expanded.css.snapshot(), /UNGRANTED_LIVE_CSS_SENTINEL/);
echo.disconnect(); detach();
await locus.session.get(sessionId)!.update({ libraries: ["ungrantedPage"] }, { principalId: "alice" });
detach = bind_locus_websocket(locus, wire.server, { principalId: "alice" });
assert.ok(["current", "reconcile"].includes((await echo.connect()).outcome));
assert.throws(() => client.lib("page"), /Unknown/);
assert.throws(() => clientPage.css.snapshot());
wire.deliver(live);
assert.throws(() => client.lib("page"), /Unknown/);
assert.equal(localPage.css.snapshot(), localCss);
assert.throws(() => locus.session.get(sessionId)!.now({ html: "page" }), /unavailable/);
echo.disconnect(); detach();
await locus.session.get(sessionId)!.update({ libraries: ["page", "ungrantedPage"] }, { principalId: "alice" });
detach = bind_locus_websocket(locus, wire.server, { principalId: "alice" });
assert.ok(["current", "reconcile"].includes((await echo.connect()).outcome));
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
await persistent.stage((draft) => { const selected = draft.lib("page"); if ("graph" in selected) selected.css(append(String.raw`body { color: purple; } @layer { @media screen { .escaped-newline { --x:"review\
word"; font-family:var(--x); } } } @layer { .x { color: red !important; } .x { color: blue !important; } } @keyframes durable { 0% { opacity: .2; } from { opacity: .8; } }`)); });
await persistent.checkpoint();
await persistent.stage((draft) => { const selected = draft.lib("page"); if ("graph" in selected) selected.css(append("body { background: teal; }", persistent.map.lib("page").css.list())); });
const durableRecord = persistent.map.capture().libraries.find(entry => entry.name === "page")?.css;
assert.ok(durableRecord);
assert.equal(durableRecord.rules.find(rule=>rule.selector===".escaped-newline")?.declarations[0]?.[1], '"review\\\nword"');
assert.equal(durableRecord.order[1]?.kind, "group");
const state = adapter.state("hosted-css-phase-c");
if (state === undefined) throw new Error("Missing durable state.");
const restored = await restore_persistent_locus_hosted_aggregate_internal("hosted-css-phase-c", state, { persistence: adapter });
assert.ok(restored);
const restoredPage = restored.map.lib("page");
if (restoredPage.mode !== "document") throw new Error("Expected restored document.");
assert.match(restoredPage.css.snapshot(), /color:purple/);
assert.match(restoredPage.css.snapshot(), /background:teal/);
assert.deepEqual(restored.map.capture().libraries.find(entry => entry.name === "page")?.css, durableRecord);
const durableCss = restoredPage.css.snapshot();
const beforeFailureRev = restored.rev;
adapter.failAppend = new Error("CSS append rejected");
await assert.rejects(() => restored.stage((draft) => { const selected = draft.lib("page"); if ("graph" in selected) selected.css(append("body { margin: 9px; }", restoredPage.css.list())); }),
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
assert.deepEqual(restoredAtS2.map.capture().libraries.find(entry => entry.name === "page")?.css, durableRecord);

const fallbackMap = hsonLiveMap.fromLibraries({
  page: { document: '<html <head/> <body/>/>' },
  hidden: { document: '<html <head/> <body/>/>' },
});
const fallbackPage = fallbackMap.lib("page"), fallbackHidden = fallbackMap.lib("hidden");
if (fallbackPage.mode !== "document" || fallbackHidden.mode !== "document") throw new Error("Expected fallback documents.");
fallbackPage.css.stylesheet("body { color: olive; }");
fallbackHidden.css.stylesheet(".HIDDEN_FALLBACK_CSS_SENTINEL { color: red; }");
const fallbackHost = create_locus_hosted_aggregate_authority_internal({ map: fallbackMap, maxHistoryBytes: 1,
  libraries: [{ name: "page", ownership: "shared" }, { name: "hidden", ownership: "private" }],
  defaultProjection: { libraries: ["page"] },
  authorizeProjection: () => ({ libraries: ["page"] }) });
const fallbackWire = pair();
let stopFallback = bind_locus_websocket(fallbackHost, fallbackWire.server);
const fallbackEcho = create_echo_aggregate_client_internal({ transport: test_echo_transport(fallbackWire.client), logicalMapId: fallbackHost.logicalMapId,
  initializers: local_initializers({ localPage: { document: '<html <head/> <body/>/>' } }) });
await fallbackEcho.connect();
const fallbackClient = fallbackEcho.map;
if (fallbackClient === undefined) throw new Error("Missing fallback client.");
const fallbackLocal = fallbackClient.lib("localPage");
if (fallbackLocal.mode !== "document") throw new Error("Expected local fallback document.");
fallbackLocal.css.stylesheet("body { color: cyan; }");
const fallbackLocalCss = fallbackLocal.css.snapshot();
fallbackEcho.disconnect(); stopFallback();
await fallbackHost.stage((draft) => { const selected = draft.lib("page"); if ("graph" in selected) selected.css(append("@media screen { body { background: coral; } }", fallbackPage.css.list())); });
await fallbackHost.stage((draft) => { const selected = draft.lib("hidden"); if ("graph" in selected) selected.css(append(".HIDDEN_FALLBACK_TAIL_SENTINEL { color: blue; }", fallbackHidden.css.list())); });
stopFallback = bind_locus_websocket(fallbackHost, fallbackWire.server);
assert.equal((await fallbackEcho.connect()).outcome, "reconcile");
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
  libraries: [{ name: "page", ownership: "shared" as const }],
  defaultProjection: { libraries: ["page"] },
  authorizeProjection: () => ({ libraries: ["page"] }),
};
const firstAuthority = await resume_locus_fixture(authority_definition_from_fixture_options({ map: restartMap, ...restartOptions }));
const managedRestartPage = firstAuthority.lib("page");
if (managedRestartPage.mode !== "document") throw new Error("Expected managed restart document.");
await firstAuthority.stage((draft) => { draft.lib("page").css(append("body { color: maroon; } @layer { .x { color: red !important; } .x { color: blue !important; } }")); });
await hsonLiveMap.locus.checkpoint(firstAuthority);
const restartWire = pair();
let stopRestart = bind_locus_websocket(firstAuthority, restartWire.server);
const restartEcho = create_echo_aggregate_client_internal({ transport: test_echo_transport(restartWire.client), logicalMapId: firstAuthority.logicalMapId,
  initializers: local_initializers({ localPage: { document: '<html <head/> <body/>/>' } }) });
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
const restartGroupRecord = restartClient.capture().libraries.find(entry => entry.name === "page")?.css;
assert.equal(restartGroupRecord?.order[1]?.kind, "group");
const beforeRejectedWire = restartWire.sent.length;
restartAdapter.failAppend = new Error("CSS durable acceptance rejected");
await assert.rejects(() => firstAuthority.stage((draft) => { draft.lib("page").css(append("body { margin: 11px; }", managedRestartPage.css.list())); }),
  { code: "LOCUS_PERSISTENCE_APPEND_FAILED" });
assert.equal(firstAuthority.rev, beforeRejectedCssRev);
assert.equal(firstAuthority.rev, beforeRejectedCssRev);
assert.equal(restartEcho.lastAppliedRev, beforeRejectedCssRev);
assert.equal(beforeRejectedClientCss.css.snapshot(), beforeRejectedCss);
assert.equal(restartWire.sent.length, beforeRejectedWire);
restartEcho.disconnect(); stopRestart();
await firstAuthority.stage((draft) => { draft.lib("page").css(append("body { background: silver; }", managedRestartPage.css.list())); });
restartEcho.dispose();
firstAuthority.dispose();
const restarted = await resume_locus_fixture(authority_definition_from_fixture_options({ map: restartInput(), ...restartOptions }));
stopRestart = bind_locus_websocket(restarted, restartWire.server);
const resumedEcho = create_echo_aggregate_client_internal({ transport: test_echo_transport(restartWire.client), map: restartClient,
  logicalMapId: restarted.logicalMapId });
assert.equal((await resumedEcho.connect()).outcome, "reconcile");
assert.deepEqual(restartClient.capture().libraries.find(entry => entry.name === "page")?.css?.order[1], restartGroupRecord?.order[1]);
const restartedProjected = restartClient.lib("page");
if (restartedProjected.mode !== "document") throw new Error("Expected restarted projected document.");
assert.match(restartedProjected.css.snapshot(), /color:maroon/);
assert.match(restartedProjected.css.snapshot(), /background:silver/);
assert.equal(restartLocal.css.snapshot(), restartLocalCss);
resumedEcho.dispose(); stopRestart(); restarted.dispose();

// Construction and client-local initializers use the same occurrence-bearing record.
const initialGroups = hsonLiveMap.locus.create({
  shared: [{name:"page", definition:{document:'<html <head/> <body/>/>'}, css:fidelitySource}],
  local: [{name:"local", initializer:{document:'<html <head/> <body/>/>'}, css:fidelitySource}],
  defaultProjection:{libraries:["page","local"]},
  authorizeProjection:()=>({libraries:["page","local"]}),
});
const initialSession=await initialGroups.session.create({libraries:["page","local"]});
const initialCut=initialSession.now({html:"page"});
assert.deepEqual(initialCut.libs.libraries.find(entry=>entry.name==="page")?.css, fidelityRecord);
assert.deepEqual(initialCut.local.find(entry=>entry.name==="local")?.css, fidelityRecord);
assert.equal(initialGroups.rev, 0);
initialGroups.dispose();

console.log("Hosted document CSS Phase C acceptance passed.");
