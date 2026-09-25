import assert from "node:assert/strict";
import { Hson, add_interaction, enable_interactions, hsonLiveMap, hsonLocus, hsonMirror,
  type LocusSocketLike } from "../src/index.ts";
import { create_echo_socket_client_internal } from "../src/api/echo/echo.aggregate-replica.ts";
import { create_locus_hosted_aggregate_socket_internal } from "../src/api/locus/locus.aggregate.socket.ts";
import { create_persistent_locus } from "../src/api/locus/index.ts";
import { MemoryCheckpointAdapter } from "./helpers/memory-checkpoint-adapter.mts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({ id: "locus.hosted-runtime-fallback",
  title: "Hosted runtime topology fallback and contraction", category: "Locus", runtime: "node",
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

const authority = hsonLiveMap.fromLibraries({ page: { document: Hson.document`<main <p "Original"/>/>` } });
const server = create_locus_hosted_aggregate_socket_internal({ map: authority,
  exposure: [{ library: "page", exposure: "client-public" }],
  defaultProjection: { libraries: ["page"], htmlDocument: "page" },
  authorizeProjection: ({ requested }) => ({ libraries: requested.libraries }),
  maxHistoryBytes: 1,
});
const wire = pair();
let detach = server.connect(wire.server, { principalId: "alice" });
const echo = create_echo_socket_client_internal({ socket: wire.client, logicalMapId: server.logicalMapId,
  localLibraries: { preferences: { data: { theme: "dark" } } } });
await echo.connect();
const map = echo.map;
assert.ok(map);
const page = map.lib("page");
if (page.mode !== "document") throw new Error("Expected document Library.");
const local = map.lib("preferences");
const mirror = hsonMirror(page);
const tree = mirror.tree.node;
const sessionId = echo.session.sessionId;
assert.ok(sessionId);
echo.disconnect();
detach();
await server.add_libraries({ added: { data: { value: 1 } },
  hidden: { data: { secret: "HIDDEN_FALLBACK_SENTINEL" } } }, { added: "client-public" });
await server.mutate((draft) => {
  const added = draft.lib("added");
  if (!("at" in added)) throw new Error("Expected data Library.");
  added.at(["value"]).set(2);
});
await server.add_libraries({ batchHidden: { data: { secret: "BATCH_HIDDEN_FALLBACK_SENTINEL" } },
  batchVisible: { data: { value: 6 } } }, { batchVisible: "client-public" });
await server.mutate((draft) => {
  const visible = draft.lib("batchVisible");
  if (!("at" in visible)) throw new Error("Expected batch data Library.");
  visible.at(["value"]).set(7);
});
await server.sessions.updateProjection(sessionId,
  { libraries: ["page", "added", "batchVisible"], htmlDocument: "page" }, { principalId: "alice" });
const beforeFallback = wire.serverSent.length;
detach = server.connect(wire.server, { principalId: "alice" });
assert.equal((await echo.connect()).outcome, "snapshot");
assert.equal(echo.map, map);
assert.equal(map.lib("page"), page);
assert.equal(map.lib("preferences"), local);
assert.equal(mirror.tree.node, tree);
assert.equal(echo.lastAppliedRev, server.rev);
const added = map.lib("added");
if (!("snap" in added) || !("snap" in local)) throw new Error("Expected data Libraries.");
assert.equal(added.snap(["value"]), 2);
const batchVisible = map.lib("batchVisible");
if (!("snap" in batchVisible)) throw new Error("Expected batch data Library.");
assert.equal(batchVisible.snap(["value"]), 7);
assert.equal(local.snap(["theme"]), "dark");
assert.throws(() => map.lib("hidden"), /Unknown/);
assert.throws(() => map.lib("batchHidden"), /Unknown/);
assert.equal(wire.serverSent.slice(beforeFallback).some((raw) =>
  raw.includes("HIDDEN_FALLBACK_SENTINEL") || raw.includes("BATCH_HIDDEN_FALLBACK_SENTINEL")), false);
process.stdout.write("ok - changed-topology fallback reconciles authority only\n");

const authorityRev = server.rev;
const authorityMapRev = authority.rev;
const clientRev = map.rev;
const oldAdded = map.lib("added");
const contraction = await server.sessions.updateProjection(sessionId,
  { libraries: ["page"], htmlDocument: "page" });
assert.equal(contraction.changed, true);
assert.equal(contraction.authorityRev, authorityRev);
assert.equal(server.rev, authorityRev);
assert.equal(authority.rev, authorityMapRev);
assert.equal(map.rev, clientRev + 1);
assert.throws(() => map.lib("added"), /Unknown/);
assert.throws(() => map.lib("batchVisible"), /Unknown/);
if (!("snap" in oldAdded)) throw new Error("Expected stale data Library.");
assert.throws(() => oldAdded.snap(["value"]), /authority|map/i);
assert.equal(map.lib("page"), page);
assert.equal(map.lib("preferences"), local);
assert.equal(mirror.tree.node, tree);
process.stdout.write("ok - live contraction removes only projected authority state\n");

const regrant = await server.sessions.updateProjection(sessionId,
  { libraries: ["page", "added"], htmlDocument: "page" });
assert.equal(regrant.changed, true);
const newAdded = map.lib("added");
assert.notEqual(newAdded, oldAdded);
if (!("snap" in newAdded)) throw new Error("Expected regranted data Library.");
assert.equal(newAdded.snap(["value"]), 2);
assert.throws(() => oldAdded.snap(["value"]), /authority|map/i);
await server.sessions.updateProjection(sessionId, { libraries: [] });
assert.throws(() => map.lib("page"), /Unknown/);
assert.throws(() => map.lib("added"), /Unknown/);
assert.throws(() => map.lib("batchVisible"), /Unknown/);
assert.equal(map.lib("preferences"), local);
assert.equal(local.snap(["theme"]), "dark");
assert.equal(mirror.status, "failed");
assert.throws(() => page.root(), /authority|map/i);
process.stdout.write("ok - regrant does not revive stale handles and empty projection preserves local state\n");

echo.dispose();
detach();
mirror.dispose();
server.dispose();

const adapter = new MemoryCheckpointAdapter();
const persistentAuthority = hsonLiveMap.fromLibraries({ anchor: { data: { value: 1 } } });
const persistent = await create_persistent_locus({ map: persistentAuthority, persistence: adapter,
  logicalMapId: "runtime-fallback-restart", exposure: [{ library: "anchor", exposure: "client-public" }],
  defaultProjection: { libraries: ["anchor"] },
  authorizeProjection: ({ requested }) => ({ libraries: requested.libraries }),
});
const restartWire = pair();
const detachBeforeRestart = persistent.connect(restartWire.server, { principalId: "alice" });
const beforeRestartEcho = create_echo_socket_client_internal({ socket: restartWire.client,
  logicalMapId: persistent.logicalMapId,
  localLibraries: { preferences: { data: { theme: "light" } } } });
await beforeRestartEcho.connect();
const continuedMap = beforeRestartEcho.map;
assert.ok(continuedMap);
const continuedLocal = continuedMap.lib("preferences");
beforeRestartEcho.disconnect();
detachBeforeRestart();
await persistent.lib.add({ durablePublic: { data: { value: 4 } },
  durableHidden: { data: { secret: `DURABLE_HIDDEN_FALLBACK_SENTINEL${"x".repeat(1024 * 1024)}` } } },
{ exposure: { durablePublic: "client-public" } });
await persistent.mutate((draft) => {
  const publicLibrary = draft.lib("durablePublic");
  if (!("at" in publicLibrary)) throw new Error("Expected durable public data Library.");
  publicLibrary.at(["value"]).set(5);
});
await persistent.checkpoint();
beforeRestartEcho.dispose();
persistent.dispose();
const resumedAuthority = hsonLiveMap.create();
const resumed = await create_persistent_locus({ map: resumedAuthority, persistence: adapter,
  logicalMapId: "runtime-fallback-restart", exposure: [
    { library: "anchor", exposure: "client-public" },
    { library: "durablePublic", exposure: "client-public" },
    { library: "durableHidden", exposure: "server-private" },
  ],
  defaultProjection: { libraries: ["anchor", "durablePublic"] },
  authorizeProjection: ({ requested }) => ({ libraries: requested.libraries }),
});
const resumedWire = pair();
const detachResumed = resumed.connect(resumedWire.server, { principalId: "alice" });
const resumedEcho = create_echo_socket_client_internal({ socket: resumedWire.client,
  logicalMapId: resumed.logicalMapId, map: continuedMap });
assert.equal((await resumedEcho.connect()).outcome, "snapshot");
assert.equal(resumedEcho.map, continuedMap);
assert.equal(continuedMap.lib("preferences"), continuedLocal);
if (!("snap" in continuedLocal)) throw new Error("Expected local data Library.");
assert.equal(continuedLocal.snap(["theme"]), "light");
const durablePublic = continuedMap.lib("durablePublic");
if (!("snap" in durablePublic)) throw new Error("Expected restored public data Library.");
assert.equal(durablePublic.snap(["value"]), 5);
assert.throws(() => continuedMap.lib("durableHidden"), /Unknown/);
assert.equal(resumedWire.serverSent.some((raw) => raw.includes("DURABLE_HIDDEN_FALLBACK_SENTINEL")), false);
const restartFallback = resumedWire.serverSent.find((raw) => JSON.parse(raw).type === "recovery-snapshot");
assert.ok(restartFallback);
assert.ok(restartFallback.length < 20_000);
resumedEcho.dispose();
detachResumed();
resumed.dispose();
process.stdout.write("ok - durable restart fallback preserves the composed client map and local state\n");

const detachedAuthority = hsonLiveMap.fromLibraries({ alpha: { data: { value: 1 } },
  beta: { data: { value: 2 } } });
const detachedServer = hsonLocus.create({ map: detachedAuthority,
  exposure: [{ library: "alpha", exposure: "client-public" }, { library: "beta", exposure: "client-public" }],
  defaultProjection: { libraries: ["alpha", "beta"] },
  authorizeProjection: ({ requested }) => ({ libraries: requested.libraries }),
});
const detachedWire = pair();
let detachDetached = detachedServer.connect(detachedWire.server, { principalId: "alice" });
const detachedEcho = create_echo_socket_client_internal({ socket: detachedWire.client,
  logicalMapId: detachedServer.logicalMapId,
  localLibraries: { preferences: { data: { theme: "local" } } } });
await detachedEcho.connect();
const detachedMap = detachedEcho.map;
assert.ok(detachedMap);
const detachedLocal = detachedMap.lib("preferences");
const retiredAlpha = detachedMap.lib("alpha");
const detachedSession = detachedEcho.session.sessionId;
assert.ok(detachedSession);
detachedEcho.disconnect();
detachDetached();
const revBeforeDetachedContraction = detachedServer.rev;
await detachedServer.sessions.updateProjection(detachedSession, { libraries: [] }, { principalId: "alice" });
detachDetached = detachedServer.connect(detachedWire.server, { principalId: "alice" });
assert.equal((await detachedEcho.connect()).outcome, "snapshot");
assert.equal(detachedEcho.map, detachedMap);
assert.equal(detachedEcho.lastAppliedRev, revBeforeDetachedContraction);
assert.throws(() => detachedMap.lib("alpha"), /Unknown/);
assert.throws(() => detachedMap.lib("beta"), /Unknown/);
assert.equal(detachedMap.lib("preferences"), detachedLocal);
if (!("snap" in detachedLocal) || !("snap" in retiredAlpha)) throw new Error("Expected data Libraries.");
assert.equal(detachedLocal.snap(["theme"]), "local");
assert.throws(() => retiredAlpha.snap(["value"]), /authority|map/i);
detachedEcho.dispose();
detachDetached();
detachedServer.dispose();
process.stdout.write("ok - disconnected contraction falls back to an empty projected authority\n");

const cutAuthority = hsonLiveMap.fromLibraries({ firstPage: { document: Hson.document`<main <p "First"/>/>` },
  secondPage: { document: Hson.document`<main <p "Second"/>/>` } });
const cutServer = hsonLocus.create({ map: cutAuthority,
  exposure: [{ library: "firstPage", exposure: "client-public" },
    { library: "secondPage", exposure: "client-public" }],
  defaultProjection: { libraries: ["firstPage", "secondPage"], htmlDocument: "secondPage" },
  authorizeProjection: ({ requested }) => ({ libraries: requested.libraries }),
});
const cutWire = pair();
const detachCut = cutServer.connect(cutWire.server);
const cutEcho = create_echo_socket_client_internal({ socket: cutWire.client,
  logicalMapId: cutServer.logicalMapId });
await cutEcho.connect();
const cutSession = cutEcho.session.sessionId;
assert.ok(cutSession);
assert.match(cutServer.cut(cutSession).html, /Second/);
const cutAuthorityRev = cutServer.rev;
await cutServer.sessions.updateProjection(cutSession,
  { libraries: ["firstPage"], htmlDocument: "firstPage" });
assert.equal(cutServer.rev, cutAuthorityRev);
assert.match(cutServer.cut(cutSession).html, /First/);
assert.throws(() => cutServer.cut(cutSession, "secondPage"), /unavailable|authorized/i);
assert.equal(JSON.stringify(cutServer.cut(cutSession).data).includes("secondPage"), false);
assert.throws(() => cutEcho.map?.lib("secondPage"), /Unknown/);
cutEcho.dispose();
detachCut();
cutServer.dispose();
process.stdout.write("ok - hosted cuts and bootstrap omit a revoked document immediately\n");

const collisionAuthority = hsonLiveMap.fromLibraries({ anchor: { data: { value: 1 } } });
const collisionServer = create_locus_hosted_aggregate_socket_internal({ map: collisionAuthority,
  exposure: [{ library: "anchor", exposure: "client-public" }],
  defaultProjection: { libraries: ["anchor"] },
  authorizeProjection: ({ requested }) => ({ libraries: requested.libraries }),
  maxHistoryBytes: 1,
});
const collisionWire = pair();
let detachCollision = collisionServer.connect(collisionWire.server, { principalId: "alice" });
const collisionEcho = create_echo_socket_client_internal({ socket: collisionWire.client,
  logicalMapId: collisionServer.logicalMapId,
  localLibraries: { preferences: { data: { owner: "local" } } } });
await collisionEcho.connect();
const collisionMap = collisionEcho.map;
assert.ok(collisionMap);
const collisionLocal = collisionMap.lib("preferences");
const collisionAnchor = collisionMap.lib("anchor");
const collisionSession = collisionEcho.session.sessionId;
assert.ok(collisionSession);
collisionEcho.disconnect();
detachCollision();
await collisionServer.add_libraries({ preferences: { data: { owner: "authority" } } },
  { preferences: "client-public" });
await collisionServer.sessions.updateProjection(collisionSession,
  { libraries: ["anchor", "preferences"] }, { principalId: "alice" });
const collisionRevision = collisionMap.rev;
detachCollision = collisionServer.connect(collisionWire.server, { principalId: "alice" });
await assert.rejects(collisionEcho.connect(), /collid/i);
assert.equal(collisionMap.rev, collisionRevision);
assert.equal(collisionMap.lib("preferences"), collisionLocal);
assert.equal(collisionMap.lib("anchor"), collisionAnchor);
if (!("snap" in collisionLocal)) throw new Error("Expected local data Library.");
assert.equal(collisionLocal.snap(["owner"]), "local");
collisionEcho.dispose();
detachCollision();
collisionServer.dispose();
process.stdout.write("ok - fallback collision fails before changing either ownership domain\n");

let cutCount = 0;
let enteredCut = (): void => {};
let releaseCut = (): void => {};
const cutEntered = new Promise<void>((resolve) => { enteredCut = resolve; });
const cutGate = new Promise<void>((resolve) => { releaseCut = resolve; });
const tailAuthority = hsonLiveMap.fromLibraries({ anchor: { data: { value: 1 } } });
const tailServer = create_locus_hosted_aggregate_socket_internal({ map: tailAuthority,
  exposure: [{ library: "anchor", exposure: "client-public" }],
  defaultProjection: { libraries: ["anchor"] },
  authorizeProjection: ({ requested }) => ({ libraries: requested.libraries }),
  maxHistoryBytes: 1,
  internal: { afterRecoveryCut: async () => { cutCount += 1;
    if (cutCount === 2) { enteredCut(); await cutGate; } } },
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
await tailServer.add_libraries({ target: { data: { value: 2 } } }, { target: "client-public" });
await tailServer.sessions.updateProjection(tailSession,
  { libraries: ["anchor", "target"] }, { principalId: "alice" });
const tailStart = tailWire.serverSent.length;
detachTail = tailServer.connect(tailWire.server, { principalId: "alice" });
const recoveringTail = tailEcho.connect();
await cutEntered;
await assert.rejects(tailServer.sessions.updateProjection(tailSession,
  { libraries: ["anchor"] }, { principalId: "alice" }), /unavailable/i);
await tailServer.mutate((draft) => {
  const target = draft.lib("target");
  if (!("at" in target)) throw new Error("Expected queued target data Library.");
  target.at(["value"]).set(3);
});
await tailServer.add_libraries({ hiddenTail: { data: { secret: "HIDDEN_FALLBACK_TAIL_SENTINEL" } } });
releaseCut();
assert.equal((await recoveringTail).outcome, "snapshot");
assert.equal(tailEcho.map, tailMap);
assert.equal(tailEcho.lastAppliedRev, tailServer.rev);
const tailTarget = tailMap.lib("target");
if (!("snap" in tailTarget)) throw new Error("Expected queued target data Library.");
assert.equal(tailTarget.snap(["value"]), 3);
assert.throws(() => tailMap.lib("hiddenTail"), /Unknown/);
const tailMessages = tailWire.serverSent.slice(tailStart).map((raw) => JSON.parse(raw));
assert.deepEqual(tailMessages.filter((message) => ["recovery-snapshot", "recovery-caught-up", "commit", "progress"]
  .includes(message.type)).map((message) => message.type),
["recovery-snapshot", "recovery-caught-up", "commit", "progress"]);
assert.equal(tailMessages.some((message) => JSON.stringify(message).includes("HIDDEN_FALLBACK_TAIL_SENTINEL")), false);
tailEcho.dispose();
detachTail();
tailServer.dispose();
process.stdout.write("ok - queued writes follow fallback topology and hidden tail remains opaque\n");

const interactionAuthority = hsonLiveMap.fromLibraries({ keep: { document: Hson.document`<main/>` },
  revoke: { document: Hson.document`<main <button "Revoke"/>/>` } });
enable_interactions(interactionAuthority);
const interactionServer = hsonLocus.create({ map: interactionAuthority,
  exposure: [{ library: "keep", exposure: "client-public" },
    { library: "revoke", exposure: "client-public" }],
  defaultProjection: { libraries: ["keep", "revoke"], systemFeatures: ["interactions"] },
  authorizeProjection: ({ requested }) => ({ libraries: requested.libraries,
    systemFeatures: requested.systemFeatures }),
});
const interactionWire = pair();
const detachInteraction = interactionServer.connect(interactionWire.server);
const interactionEcho = create_echo_socket_client_internal({ socket: interactionWire.client,
  logicalMapId: interactionServer.logicalMapId });
await interactionEcho.connect();
const interactionMap = interactionEcho.map;
assert.ok(interactionMap);
const keep = interactionMap.lib("keep"), revoke = interactionMap.lib("revoke");
if (keep.mode !== "document" || revoke.mode !== "document") throw new Error("Expected document Libraries.");
const keepMirror = hsonMirror(keep), revokedMirror = hsonMirror(revoke);
const keepTree = keepMirror.tree.node;
await interactionServer.mutate((draft) => add_interaction(draft, {
  id: "revoked-listener", subject: { library: "revoke", path: [99] },
  listener: { event: "click", target: "element", capture: false, once: false, passive: false,
    missingTarget: "ignore", preventDefault: false, stopPropagation: false, stopImmediatePropagation: false },
  kind: "browser-local", key: "REVOKED_INTERACTION_SENTINEL", args: Hson.data.from(null),
}));
const obsoleteCommitRaw = interactionWire.serverSent.findLast((raw) => JSON.parse(raw).type === "commit");
assert.ok(obsoleteCommitRaw);
const interactionSession = interactionEcho.session.sessionId;
assert.ok(interactionSession);
const interactionStart = interactionWire.serverSent.length;
await interactionServer.sessions.updateProjection(interactionSession,
  { libraries: ["keep"], systemFeatures: ["interactions"] });
assert.equal(interactionMap.lib("keep"), keep);
assert.equal(keepMirror.tree.node, keepTree);
assert.equal(keepMirror.status, "active");
assert.equal(revokedMirror.status, "failed");
assert.throws(() => interactionMap.lib("revoke"), /Unknown/);
const contractionWire = interactionWire.serverSent.slice(interactionStart);
assert.equal(contractionWire.some((raw) => raw.includes("REVOKED_INTERACTION_SENTINEL")), false);
const obsoleteCommit = JSON.parse(obsoleteCommitRaw);
const obsoleteAuthorityRev = interactionEcho.lastAppliedRev;
if (obsoleteAuthorityRev === undefined) throw new Error("Expected the Echo authority cursor.");
obsoleteCommit.commit.commit.prevRev = obsoleteAuthorityRev;
obsoleteCommit.commit.commit.rev = obsoleteAuthorityRev + 1;
interactionWire.server.send(JSON.stringify(obsoleteCommit));
assert.equal(interactionEcho.diagnostics().status, "failed");
assert.throws(() => interactionMap.lib("revoke"), /Unknown/);
interactionEcho.dispose();
detachInteraction();
revokedMirror.dispose();
keepMirror.dispose();
interactionServer.dispose();
process.stdout.write("ok - revoked document Mirror terminates and unrelated interaction resources survive\n");

const replaceAuthority = hsonLiveMap.fromLibraries({ A: { data: { value: 1 } },
  B: { data: { value: 2 } }, C: { data: { value: 3 } } });
const replaceServer = create_locus_hosted_aggregate_socket_internal({ map: replaceAuthority,
  exposure: [{ library: "A", exposure: "client-public" },
    { library: "B", exposure: "client-public" }, { library: "C", exposure: "client-public" }],
  defaultProjection: { libraries: ["A", "B"] },
  authorizeProjection: ({ requested }) => ({ libraries: requested.libraries }),
  maxHistoryBytes: 1,
});
const replaceWire = pair();
let detachReplace = replaceServer.connect(replaceWire.server, { principalId: "alice" });
const replaceEcho = create_echo_socket_client_internal({ socket: replaceWire.client,
  logicalMapId: replaceServer.logicalMapId,
  localLibraries: { preferences: { data: { value: "local" } } } });
await replaceEcho.connect();
const replaceMap = replaceEcho.map;
assert.ok(replaceMap);
const retainedA = replaceMap.lib("A");
const retiredB = replaceMap.lib("B");
const retainedLocal = replaceMap.lib("preferences");
const replaceRev = replaceMap.rev;
const replaceSession = replaceEcho.session.sessionId;
assert.ok(replaceSession);
replaceEcho.disconnect();
detachReplace();
await replaceServer.sessions.updateProjection(replaceSession, { libraries: ["A", "C"] },
  { principalId: "alice" });
detachReplace = replaceServer.connect(replaceWire.server, { principalId: "alice" });
assert.equal((await replaceEcho.connect()).outcome, "snapshot");
assert.equal(replaceEcho.map, replaceMap);
assert.equal(replaceMap.rev, replaceRev + 1);
assert.equal(replaceMap.lib("A"), retainedA);
assert.equal(replaceMap.lib("preferences"), retainedLocal);
assert.throws(() => replaceMap.lib("B"), /Unknown/);
if (!("snap" in retiredB)) throw new Error("Expected the retired data Library.");
assert.throws(() => retiredB.snap(["value"]), /authority|map/i);
const projectedC = replaceMap.lib("C");
if (!("snap" in projectedC)) throw new Error("Expected projected C data Library.");
assert.equal(projectedC.snap(["value"]), 3);
assert.equal(replaceEcho.lastAppliedRev, replaceServer.rev);
replaceEcho.dispose();
detachReplace();
replaceServer.dispose();
process.stdout.write("ok - fallback replaces authority projection A,B with A,C atomically\n");

const boundedAuthority = hsonLiveMap.fromLibraries({ retained: { data: { payload: "r".repeat(4096) } },
  revoked: { data: { value: 1 } } });
const boundedServer = create_locus_hosted_aggregate_socket_internal({ map: boundedAuthority,
  exposure: [{ library: "retained", exposure: "client-public" },
    { library: "revoked", exposure: "client-public" }],
  defaultProjection: { libraries: ["retained", "revoked"] },
  authorizeProjection: ({ requested }) => ({ libraries: requested.libraries }),
  maxWireBytes: 2048,
});
const boundedWire = pair();
const detachBounded = boundedServer.connect(boundedWire.server);
const boundedEcho = create_echo_socket_client_internal({ socket: boundedWire.client,
  logicalMapId: boundedServer.logicalMapId });
await boundedEcho.connect();
const boundedMap = boundedEcho.map;
assert.ok(boundedMap);
const retainedLarge = boundedMap.lib("retained");
const boundedSession = boundedEcho.session.sessionId;
assert.ok(boundedSession);
await boundedServer.sessions.updateProjection(boundedSession, { libraries: ["retained"] });
assert.equal(boundedMap.lib("retained"), retainedLarge);
assert.throws(() => boundedMap.lib("revoked"), /Unknown/);
assert.equal(boundedEcho.diagnostics().status, "live");
boundedEcho.dispose();
detachBounded();
boundedServer.dispose();
process.stdout.write("ok - contraction reconciliation uses the snapshot bound for retained large roots\n");
