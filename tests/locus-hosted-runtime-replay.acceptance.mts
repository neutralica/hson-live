import assert from "node:assert/strict";
import { Hson, add_interaction, enable_interactions, hsonLiveMap, hsonLocus, hsonMirror,
  type LocusSocketLike } from "../src/index.ts";
import { create_echo_socket_client_internal } from "../src/api/echo/echo.aggregate-replica.ts";
import { create_echo_aggregate_replica_capability_internal } from "../src/api/echo/echo.aggregate-replica.lifecycle.ts";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";
import { project_authority_snapshot } from "../src/api/locus/locus.authority-projection-snapshot.ts";
import { make_locus_hosted_projection_policy, normalize_locus_effective_projection } from "../src/api/locus/locus.projection.ts";
import { LOCUS_LIVE_PROJECTED_WIRE_FORMAT, decode_locus_live_projected_envelope_internal,
  project_locus_live_transition_internal } from "../src/api/locus/locus.live-projection.ts";
import type { HostedAggregateCommit } from "../src/api/livemap/livemap.hosted.ts";
import type { LiveMap } from "../src/types/livemap.types.ts";
import { create_locus_hosted_aggregate_socket_internal } from "../src/api/locus/locus.aggregate.socket.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({ id: "locus.hosted-runtime-replay",
  title: "Hosted runtime topology retained reconnect", category: "Locus", runtime: "node",
  tags: Object.freeze(["locus", "echo", "recovery", "topology", "security"]) });

function pair() {
  const toServer = new Set<(raw: string) => void>();
  const toClient = new Set<(raw: string) => void>();
  const serverSent: string[] = [];
  const client: LocusSocketLike = {
    send(raw) { for (const listener of [...toServer]) listener(raw); }, close() {},
    onMessage(listener) { toClient.add(listener); return () => { toClient.delete(listener); }; },
    onClose() { return () => {}; },
  };
  const server: LocusSocketLike = {
    send(raw) { serverSent.push(raw); for (const listener of [...toClient]) listener(raw); }, close() {},
    onMessage(listener) { toServer.add(listener); return () => { toServer.delete(listener); }; },
    onClose() { return () => {}; },
  };
  return { client, server, serverSent };
}
function require_map(client: Readonly<{ map: LiveMap | undefined }>): LiveMap {
  const map = client.map;
  if (map === undefined) throw new Error("Expected a composed client map.");
  return map;
}

const authority = hsonLiveMap.fromLibraries({ page: { document: Hson.document`<main <p "Existing"/>/>` } });
const locus = hsonLocus.create({ map: authority,
  exposure: [{ library: "page", exposure: "client-public" }],
  defaultProjection: { libraries: ["page"], htmlDocument: "page" },
  authorizeProjection: ({ requested }) => ({ libraries: requested.libraries }),
});
const wire = pair();
let detach = locus.connect(wire.server, { principalId: "alice" });
const echo = create_echo_socket_client_internal({ socket: wire.client, logicalMapId: locus.logicalMapId,
  localLibraries: { preferences: { data: { theme: "dark" } } } });
await echo.connect();
const clientMap = echo.map;
assert.ok(clientMap);
const page = clientMap.lib("page");
if (page.mode !== "document") throw new Error("Expected document Library.");
const preferences = clientMap.lib("preferences");
const mirror = hsonMirror(page);
const tree = mirror.tree.node;
const startingClientRev = clientMap.rev;
const sessionId = echo.session.sessionId;
assert.ok(sessionId);
echo.disconnect();
detach();

await locus.lib.add({ newState: { data: { value: 1 } } },
  { exposure: { newState: "client-public" } });
await locus.mutate((draft) => {
  const state = draft.lib("newState");
  if (!("at" in state)) throw new Error("Expected data Library.");
  state.at(["value"]).set(2);
});
await locus.lib.add({ privateState: { data: { secret: "PRIVATE_REPLAY_ROOT_SENTINEL",
    PRIVATE_REPLAY_SCHEMA_SENTINEL: "private" },
    schema: Hson.schema`<type "data" content <secret "string" PRIVATE_REPLAY_SCHEMA_SENTINEL "string">>` },
  nextState: { data: { value: 3 } },
  ungrantedState: { data: { secret: "UNGRANTED_REPLAY_ROOT_SENTINEL",
    UNGRANTED_REPLAY_SCHEMA_SENTINEL: "ungranted" },
    schema: Hson.schema`<type "data" content <secret "string" UNGRANTED_REPLAY_SCHEMA_SENTINEL "string">>` } },
{ exposure: { nextState: "client-public", ungrantedState: "client-public" } });
await locus.mutate((draft) => {
  const next = draft.lib("nextState"), hidden = draft.lib("privateState");
  if (!("at" in next) || !("at" in hidden)) throw new Error("Expected data Libraries.");
  next.at(["value"]).set(4);
  hidden.at(["secret"]).set("PRIVATE_REPLAY_WRITE_SENTINEL");
});
const authorityRevBeforeProjection = locus.rev;
await assert.rejects(locus.sessions.updateProjection(sessionId,
  { libraries: ["page", "newState", "nextState"], htmlDocument: "page" },
  { principalId: "mallory" }), /projection.*unavailable/i);
const projection = await locus.sessions.updateProjection(sessionId,
  { libraries: ["page", "newState", "nextState"], htmlDocument: "page" },
  { principalId: "alice" });
assert.equal(projection.changed, true);
assert.equal(projection.authorityRev, authorityRevBeforeProjection);
assert.equal(authority.rev, authorityRevBeforeProjection);
const beforeReplay = wire.serverSent.length;
detach = locus.connect(wire.server, { principalId: "alice" });
const recovery = await echo.connect();
assert.equal(recovery.outcome, "replay");
assert.equal(echo.map, clientMap);
assert.equal(echo.lastAppliedRev, locus.rev);
assert.equal(clientMap.rev, startingClientRev + 1);
assert.equal(clientMap.lib("page"), page);
assert.equal(clientMap.lib("preferences"), preferences);
assert.equal(mirror.tree.node, tree);
const local = preferences;
if (!("snap" in local)) throw new Error("Expected local data Library.");
assert.equal(local.snap(["theme"]), "dark");
const state = clientMap.lib("newState"), next = clientMap.lib("nextState");
if (!("snap" in state) || !("snap" in next)) throw new Error("Expected recovered data Libraries.");
assert.equal(state.snap(["value"]), 2);
assert.equal(next.snap(["value"]), 4);
assert.throws(() => clientMap.lib("privateState"), /Unknown/);
assert.throws(() => clientMap.lib("ungrantedState"), /Unknown/);
const replayWire = wire.serverSent.slice(beforeReplay);
const privateRegistryDigest = internal_livemap_aggregate_authority(authority).captureHosted().registry.digest;
for (const encoded of replayWire) {
  assert.equal(encoded.includes(privateRegistryDigest), false);
  for (const hidden of ["privateState", "ungrantedState", "PRIVATE_REPLAY_ROOT_SENTINEL",
    "PRIVATE_REPLAY_WRITE_SENTINEL", "UNGRANTED_REPLAY_ROOT_SENTINEL",
    "PRIVATE_REPLAY_SCHEMA_SENTINEL", "UNGRANTED_REPLAY_SCHEMA_SENTINEL"]) {
    assert.equal(encoded.includes(hidden), false, hidden);
  }
}
const types = replayWire.map((raw) => JSON.parse(raw).type as string);
assert.ok(types.includes("projection-change"));
assert.ok(types.indexOf("projection-change") < types.indexOf("recovery-caught-up"));
assert.equal(types.filter((type) => type === "recovery-progress").length, locus.rev);
echo.dispose();
detach();
mirror.dispose();
locus.dispose();
process.stdout.write("ok - retained reconnect installs current grant after hidden history without rebuilding the client\n");

const currentAuthority = hsonLiveMap.fromLibraries({ anchor: { data: { value: 1 } } });
const currentServer = hsonLocus.create({ map: currentAuthority,
  exposure: [{ library: "anchor", exposure: "client-public" }],
  defaultProjection: { libraries: ["anchor"] },
  authorizeProjection: ({ requested }) => ({ libraries: requested.libraries }),
});
const currentWire = pair();
let detachCurrent = currentServer.connect(currentWire.server, { principalId: "alice" });
const currentEcho = create_echo_socket_client_internal({ socket: currentWire.client,
  logicalMapId: currentServer.logicalMapId });
await currentEcho.connect();
const currentMap = require_map(currentEcho);
const currentSession = currentEcho.session.sessionId;
assert.ok(currentSession);
await currentServer.lib.add({ later: { data: { value: 9 } } },
  { exposure: { later: "client-public" } });
assert.equal(currentEcho.lastAppliedRev, currentServer.rev);
assert.throws(() => currentMap.lib("later"), /Unknown/);
currentEcho.disconnect();
detachCurrent();
const currentAuthorityRev = currentServer.rev;
const currentMapRev = currentMap.rev;
const currentGrant = await currentServer.sessions.updateProjection(currentSession,
  { libraries: ["anchor", "later"] }, { principalId: "alice" });
assert.equal(currentGrant.authorityRev, currentAuthorityRev);
detachCurrent = currentServer.connect(currentWire.server, { principalId: "alice" });
assert.equal((await currentEcho.connect()).outcome, "current");
assert.equal(currentEcho.map, currentMap);
assert.equal(currentEcho.lastAppliedRev, currentAuthorityRev);
assert.equal(currentMap.rev, currentMapRev + 1);
const currentLater = currentMap.lib("later");
if (!("snap" in currentLater)) throw new Error("Expected current grant data Library.");
assert.equal(currentLater.snap(["value"]), 9);
currentEcho.dispose();
detachCurrent();
currentServer.dispose();
process.stdout.write("ok - a disconnected grant expansion reconciles even with no missed authority revision\n");

const topologySource = hsonLiveMap.create();
const sourceAggregate = internal_livemap_aggregate_authority(topologySource);
const beforeTopology = sourceAggregate.captureHosted();
const emptyPolicy = make_locus_hosted_projection_policy(beforeTopology.registry, beforeTopology.authority, [],
  { libraries: [] }, ({ requested }) => ({ libraries: requested.libraries }));
const emptyProjection = normalize_locus_effective_projection(emptyPolicy, { libraries: [] });
if (emptyProjection instanceof Promise) throw new Error("Expected synchronous projection.");
const topologyClient = hsonLiveMap.fromClientSnapshot({
  authority: project_authority_snapshot(beforeTopology, emptyProjection),
  localLibraries: { preferences: { data: { value: "local" } } },
});
const topologyLocal = topologyClient.lib("preferences");
const topologyReplica = create_echo_aggregate_replica_capability_internal(topologyClient);
let topologyCommit: HostedAggregateCommit | undefined;
sourceAggregate.observe((commit) => { topologyCommit = commit.hosted; });
topologySource.addLibraries({ visible: { data: { value: 1 } }, hidden: { data: { secret: "PURE_HIDDEN_SENTINEL" } } });
const afterTopology = sourceAggregate.captureHosted();
const visiblePolicy = make_locus_hosted_projection_policy(afterTopology.registry, afterTopology.authority,
  [{ library: "visible", exposure: "client-public" }, { library: "hidden", exposure: "server-private" }],
  { libraries: ["visible"] }, ({ requested }) => ({ libraries: requested.libraries }));
const visibleProjection = normalize_locus_effective_projection(visiblePolicy, { libraries: ["visible"] });
if (visibleProjection instanceof Promise || topologyCommit === undefined) throw new Error("Missing topology projection.");
const projectedAdd = project_locus_live_transition_internal(topologyCommit, visibleProjection);
assert.equal(projectedAdd.kind, "commit");
if (projectedAdd.kind !== "commit" || projectedAdd.commit.topology === undefined) throw new Error("Missing projected add.");
assert.deepEqual(projectedAdd.commit.topology.operation.libraries.map((entry) => entry.name), ["visible"]);
assert.equal(JSON.stringify(projectedAdd).includes("PURE_HIDDEN_SENTINEL"), false);
const admittedTopology = decode_locus_live_projected_envelope_internal(Object.freeze({
  format: LOCUS_LIVE_PROJECTED_WIRE_FORMAT,
  logicalMapId: beforeTopology.authority.logicalMapId,
  incarnationId: beforeTopology.authority.incarnationId,
  registryDigest: projectedAdd.commit.registryDigest,
  commit: projectedAdd.commit,
}), Object.freeze({ logicalMapId: beforeTopology.authority.logicalMapId,
  incarnationId: beforeTopology.authority.incarnationId,
  registryDigest: projectedAdd.commit.previousRegistryDigest ?? "" }));
assert.deepEqual(admittedTopology.topology, projectedAdd.commit.topology);
const clientRevBeforeAdd = topologyClient.rev;
topologyReplica.installProjectedTopology(projectedAdd.commit.topology, projectedAdd.commit.registryDigest);
topologyReplica.advanceHostedProgress({ logicalMapId: beforeTopology.authority.logicalMapId,
  incarnationId: beforeTopology.authority.incarnationId,
  registryDigest: projectedAdd.commit.registryDigest, prevRev: 0, rev: 1 });
assert.equal(topologyClient.rev, clientRevBeforeAdd + 1);
assert.equal(topologyClient.lib("preferences"), topologyLocal);
assert.equal(topologyClient.lib("visible").mode, "data-object");
assert.throws(() => topologyClient.lib("hidden"), /Unknown/);
topologyReplica.dispose();
process.stdout.write("ok - retained topology projector filters one atomic library-add and installs it in place\n");

let cuts = 0;
let enteredCut = (): void => {};
let releaseCut = (): void => {};
const cutEntered = new Promise<void>((resolve) => { enteredCut = resolve; });
const cutGate = new Promise<void>((resolve) => { releaseCut = resolve; });
const tailAuthority = hsonLiveMap.fromLibraries({ anchor: { data: { value: 0 } } });
const tailServer = create_locus_hosted_aggregate_socket_internal({ map: tailAuthority,
  exposure: [{ library: "anchor", exposure: "client-public" }],
  defaultProjection: { libraries: ["anchor"] },
  authorizeProjection: ({ requested }) => ({ libraries: requested.libraries }),
  internal: { afterRecoveryCut: async () => { cuts += 1; if (cuts === 2) { enteredCut(); await cutGate; } } },
});
const tailWire = pair();
let detachTail = tailServer.connect(tailWire.server, { principalId: "alice" });
const tailEcho = create_echo_socket_client_internal({ socket: tailWire.client,
  logicalMapId: tailServer.logicalMapId });
await tailEcho.connect();
const tailMap = tailEcho.map;
assert.ok(tailMap);
const tailSession = tailEcho.session.sessionId;
assert.ok(tailSession);
tailEcho.disconnect();
detachTail();
await tailServer.add_libraries({ added: { data: { value: 1 } } }, { added: "client-public" });
await tailServer.mutate((draft) => {
  const added = draft.lib("added");
  if (!("at" in added)) throw new Error("Expected added data Library.");
  added.at(["value"]).set(2);
});
await tailServer.sessions.updateProjection(tailSession, { libraries: ["anchor", "added"] },
  { principalId: "alice" });
const beforeTailWire = tailWire.serverSent.length;
detachTail = tailServer.connect(tailWire.server, { principalId: "alice" });
const tailRecovery = tailEcho.connect();
await cutEntered;
await assert.rejects(tailServer.sessions.updateProjection(tailSession,
  { libraries: ["anchor", "added"] }, { principalId: "alice" }), /projection.*unavailable/i);
await tailServer.mutate((draft) => {
  const added = draft.lib("added");
  if (!("at" in added)) throw new Error("Expected added data Library.");
  added.at(["value"]).set(3);
});
await tailServer.add_libraries({ hiddenTail: { data: { secret: "HIDDEN_TAIL_SENTINEL" } } });
releaseCut();
assert.equal((await tailRecovery).outcome, "replay");
assert.equal(tailEcho.map, tailMap);
assert.equal(tailEcho.lastAppliedRev, tailServer.rev);
const tailAdded = tailMap.lib("added");
if (!("snap" in tailAdded)) throw new Error("Expected recovered data Library.");
assert.equal(tailAdded.snap(["value"]), 3);
assert.throws(() => tailMap.lib("hiddenTail"), /Unknown/);
const tailMessages = tailWire.serverSent.slice(beforeTailWire).map((raw) => JSON.parse(raw));
assert.deepEqual(tailMessages.filter((message) => ["recovery-progress", "projection-change",
  "recovery-caught-up", "commit", "progress"].includes(message.type)).map((message) => message.type),
  ["recovery-progress", "recovery-progress", "projection-change", "recovery-caught-up", "commit", "progress"]);
assert.equal(tailMessages.some((message) => JSON.stringify(message).includes("HIDDEN_TAIL_SENTINEL")), false);
tailEcho.dispose();
detachTail();
tailServer.dispose();
process.stdout.write("ok - queued live writes and hidden topology follow retained recovery in order\n");

const emptyAuthority = hsonLiveMap.create();
const emptyServer = hsonLocus.create({ map: emptyAuthority, exposure: [],
  authorizeProjection: ({ requested }) => ({ libraries: requested.libraries }) });
const emptyWire = pair();
let detachEmpty = emptyServer.connect(emptyWire.server, { principalId: "alice" });
const emptyEcho = create_echo_socket_client_internal({ socket: emptyWire.client,
  logicalMapId: emptyServer.logicalMapId });
await emptyEcho.connect();
assert.equal(emptyEcho.map, undefined);
const emptySession = emptyEcho.session.sessionId;
assert.ok(emptySession);
emptyEcho.disconnect();
detachEmpty();
await emptyServer.lib.add({ first: { data: { value: 7 } } },
  { exposure: { first: "client-public" } });
await emptyServer.sessions.updateProjection(emptySession, { libraries: ["first"] },
  { principalId: "alice" });
detachEmpty = emptyServer.connect(emptyWire.server, { principalId: "alice" });
assert.equal((await emptyEcho.connect()).outcome, "replay");
const recoveredEmptyMap = require_map(emptyEcho);
const firstLibrary = recoveredEmptyMap.lib("first");
if (!("snap" in firstLibrary)) throw new Error("Expected first recovered Library.");
assert.equal(firstLibrary.snap(["value"]), 7);
assert.equal(emptyEcho.lastAppliedRev, emptyServer.rev);
emptyEcho.dispose();
detachEmpty();
emptyServer.dispose();
process.stdout.write("ok - an empty projected client gains its first Library through retained recovery\n");

const interactionAuthority = hsonLiveMap.fromLibraries({ basePage: { document: Hson.document`<main/>` } });
enable_interactions(interactionAuthority);
const interactionServer = hsonLocus.create({ map: interactionAuthority,
  exposure: [{ library: "basePage", exposure: "client-public" }],
  defaultProjection: { libraries: ["basePage"], htmlDocument: "basePage", systemFeatures: ["interactions"] },
  authorizeProjection: ({ requested }) => ({ libraries: requested.libraries,
    systemFeatures: requested.systemFeatures }),
});
const interactionWire = pair();
let detachInteraction = interactionServer.connect(interactionWire.server, { principalId: "alice" });
const interactionEcho = create_echo_socket_client_internal({ socket: interactionWire.client,
  logicalMapId: interactionServer.logicalMapId });
await interactionEcho.connect();
const interactionMap = interactionEcho.map;
assert.ok(interactionMap);
const basePage = interactionMap.lib("basePage");
if (basePage.mode !== "document") throw new Error("Expected document Library.");
const baseMirror = hsonMirror(basePage);
const baseTree = baseMirror.tree.node;
const interactionSession = interactionEcho.session.sessionId;
assert.ok(interactionSession);
interactionEcho.disconnect();
detachInteraction();
await interactionServer.lib.add({ nextPage: { document: Hson.document`<main <button "Next"/>/>` } },
  { exposure: { nextPage: "client-public" } });
await interactionServer.mutate((draft) => add_interaction(draft, {
  id: "recovered-button", subject: { library: "nextPage", path: [99] },
  listener: { event: "click", target: "element", capture: false, once: false, passive: false,
    missingTarget: "ignore", preventDefault: false, stopPropagation: false, stopImmediatePropagation: false },
  kind: "browser-local", key: "RECOVERED_INTERACTION_SENTINEL", args: Hson.data.from(null),
}));
await interactionServer.sessions.updateProjection(interactionSession,
  { libraries: ["basePage", "nextPage"], htmlDocument: "nextPage", systemFeatures: ["interactions"] },
  { principalId: "alice" });
const beforeInteractionReplay = interactionWire.serverSent.length;
detachInteraction = interactionServer.connect(interactionWire.server, { principalId: "alice" });
assert.equal((await interactionEcho.connect()).outcome, "replay");
assert.equal(interactionEcho.map, interactionMap);
assert.equal(interactionMap.lib("basePage"), basePage);
assert.equal(baseMirror.tree.node, baseTree);
const nextPage = interactionMap.lib("nextPage");
if (nextPage.mode !== "document") throw new Error("Expected recovered document Library.");
const nextMirror = hsonMirror(nextPage);
assert.ok(nextMirror.tree.node);
const interactionMessages = interactionWire.serverSent.slice(beforeInteractionReplay).map((raw) => JSON.parse(raw));
assert.equal(interactionMessages.filter((message) => message.type === "recovery-commit"
  || message.type === "recovery-progress").some((message) => JSON.stringify(message).includes("RECOVERED_INTERACTION_SENTINEL")), false);
assert.ok(interactionMessages.find((message) => message.type === "projection-change"
  && JSON.stringify(message).includes("RECOVERED_INTERACTION_SENTINEL")));
interactionEcho.dispose();
detachInteraction();
nextMirror.dispose();
baseMirror.dispose();
interactionServer.dispose();
process.stdout.write("ok - recovered document topology precedes projected interaction realization\n");

let revokeCuts = 0;
let enteredRevocationCut = (): void => {};
let releaseRevocationCut = (): void => {};
const revocationCutEntered = new Promise<void>((resolve) => { enteredRevocationCut = resolve; });
const revocationCutGate = new Promise<void>((resolve) => { releaseRevocationCut = resolve; });
const revokeAuthority = hsonLiveMap.fromLibraries({ base: { data: { value: 0 } } });
const revokeServer = create_locus_hosted_aggregate_socket_internal({ map: revokeAuthority,
  exposure: [{ library: "base", exposure: "client-public" }],
  defaultProjection: { libraries: ["base"] },
  authorizeProjection: ({ requested }) => ({ libraries: requested.libraries }),
  internal: { afterRecoveryCut: async () => { revokeCuts += 1;
    if (revokeCuts === 2) { enteredRevocationCut(); await revocationCutGate; } } },
});
const revokeWire = pair();
let detachRevoke = revokeServer.connect(revokeWire.server, { principalId: "alice" });
const revokeEcho = create_echo_socket_client_internal({ socket: revokeWire.client,
  logicalMapId: revokeServer.logicalMapId });
await revokeEcho.connect();
const revokeSession = revokeEcho.session.sessionId;
assert.ok(revokeSession);
revokeEcho.disconnect();
detachRevoke();
await revokeServer.add_libraries({ withheld: { data: { secret: "REVOKED_REPLAY_SENTINEL" } } });
const beforeRevokedReplay = revokeWire.serverSent.length;
detachRevoke = revokeServer.connect(revokeWire.server, { principalId: "alice" });
const revokedRecovery = revokeEcho.connect();
await revocationCutEntered;
assert.equal(revokeServer.sessions.revoke(revokeSession), true);
releaseRevocationCut();
await assert.rejects(revokedRecovery);
const revokedMessages = revokeWire.serverSent.slice(beforeRevokedReplay);
assert.equal(revokedMessages.some((raw) => raw.includes("REVOKED_REPLAY_SENTINEL")), false);
assert.equal(revokedMessages.some((raw) => ["recovery-commit", "recovery-progress", "projection-change"]
  .includes(JSON.parse(raw).type)), false);
revokeEcho.dispose();
detachRevoke();
revokeServer.dispose();
process.stdout.write("ok - revocation fences prepared retained topology delivery\n");
