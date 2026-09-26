import assert from "node:assert/strict";
import { Hson, add_interaction, enable_interactions, hsonLiveMap, hsonLocus, hsonMirror, type LocusSocketLike } from "../src/index.ts";
import { create_persistent_locus } from "../src/api/locus/index.ts";
import { create_echo_socket_client_internal } from "../src/api/echo/echo.aggregate-replica.ts";
import { client_library_source_internal } from "../src/api/livemap/livemap.libraries.ts";
import { MemoryCheckpointAdapter } from "./helpers/memory-checkpoint-adapter.mts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "locus-hosted-runtime-admission",
  title: "Public hosted runtime admission and active projection",
  category: "Locus",
  runtime: "node",
  tags: Object.freeze(["locus", "echo", "livemap", "topology", "security"]),
});

function sockets() {
  const toServer = new Set<(raw: string) => void>();
  const toClient = new Set<(raw: string) => void>();
  const received: string[] = [];
  const client: LocusSocketLike = {
    send(raw) { for (const listener of toServer) listener(raw); }, close() {},
    onMessage(listener) { toClient.add(listener); return () => { toClient.delete(listener); }; },
    onClose() { return () => {}; },
  };
  const server: LocusSocketLike = {
    send(raw) { received.push(raw); for (const listener of toClient) listener(raw); }, close() {},
    onMessage(listener) { toServer.add(listener); return () => { toServer.delete(listener); }; },
    onClose() { return () => {}; },
  };
  return { client, server, received };
}

const authority = hsonLiveMap.fromLibraries({ base: { data: { count: 1 } } });
let allowNew = false;
const locus = hsonLocus.create({ map: authority,
  exposure: [{ library: "base", exposure: "client-public" }],
  defaultProjection: { libraries: ["base"] },
  authorizeProjection: ({ requested }) => ({ libraries: requested.libraries.filter((name) =>
    allowNew || (name !== "newPublic" && name !== "page")) }),
});
const wire = sockets();
locus.connect(wire.server);
const echo = create_echo_socket_client_internal({ socket: wire.client, logicalMapId: locus.logicalMapId });
await echo.connect();
const clientMap = echo.map;
assert.ok(clientMap);
const base = clientMap.lib("base");
const beforeClientRev = clientMap.rev;
const beforeAuthorityRev = locus.rev;
clientMap.addLibraries({ preferences: { data: { theme: "dark" } } });
assert.throws(() => clientMap.addLibraries({ base: { data: { count: 9 } } }), /duplicat/i);
const preferences = clientMap.lib("preferences");
assert.equal(client_library_source_internal(preferences), "client-local");
assert.equal(clientMap.rev, beforeClientRev + 1);
assert.equal(locus.rev, beforeAuthorityRev);
const beforeAdmissionWire = wire.received.length;
await locus.lib.add({ newPublic: { data: { count: 2 } }, page: { document: Hson.document`<main <p "RUNTIME_PAGE_SENTINEL"/>/>` },
  privateState: { data: { secret: "PRIVATE_ROOT_SENTINEL" } } },
{ exposure: { newPublic: "client-public", page: "client-public" } });
assert.equal(locus.rev, beforeAuthorityRev + 1);
assert.equal(echo.lastAppliedRev, locus.rev);
assert.equal(clientMap.rev, beforeClientRev + 1);
for (const encoded of wire.received.slice(beforeAdmissionWire)) {
  assert.equal(encoded.includes("newPublic"), false);
  assert.equal(encoded.includes("privateState"), false);
  assert.equal(encoded.includes("PRIVATE_ROOT_SENTINEL"), false);
}
const sessionId = echo.session.sessionId;
assert.ok(sessionId);
const rejected = await locus.sessions.updateProjection(sessionId, { libraries: ["base", "newPublic"] });
assert.equal(rejected.changed, false);
assert.equal(clientMap.rev, beforeClientRev + 1);
allowNew = true;
const authorityMapRevBeforeProjection = authority.rev;
const result = await locus.sessions.updateProjection(sessionId, { libraries: ["base", "newPublic", "page"], htmlDocument: "page" });
assert.equal(result.changed, true);
assert.equal(result.authorityRev, locus.rev);
assert.equal(result.sequence, 1);
assert.equal(authority.rev, authorityMapRevBeforeProjection);
assert.equal(echo.map, clientMap);
assert.equal(clientMap.rev, beforeClientRev + 2);
assert.equal(clientMap.lib("base"), base);
assert.equal(clientMap.lib("preferences"), preferences);
assert.equal(clientMap.lib("newPublic").mode, "data-object");
assert.equal(client_library_source_internal(clientMap.lib("newPublic")), "authority-projected");
assert.equal(clientMap.lib("page").mode, "document");
assert.equal(wire.received.at(-1)?.includes("privateState"), false);
const cut = locus.cut(sessionId);
assert.match(cut.html, /RUNTIME_PAGE_SENTINEL/);
assert.ok(JSON.stringify(cut.data).includes("newPublic"));
assert.equal(JSON.stringify(cut.data).includes("PRIVATE_ROOT_SENTINEL"), false);
await locus.mutate((draft) => {
  const library = draft.lib("newPublic");
  if (!("at" in library)) throw new Error("Expected data Library.");
  library.at(["count"]).set(3);
});
assert.equal(echo.lastAppliedRev, locus.rev);
const projected = clientMap.lib("newPublic");
if (!("snap" in projected)) throw new Error("Expected projected data Library.");
assert.equal(projected.snap(["count"]), 3);
assert.equal((await echo.recover()).outcome, "current");
assert.equal(echo.map, clientMap);

const sessionWire = sockets();
locus.connect(sessionWire.server);
sessionWire.client.send(JSON.stringify({ type: "session-create", id: "new-session",
  projection: { libraries: ["newPublic", "page"], htmlDocument: "page" } }));
assert.ok(sessionWire.received.some((raw) => JSON.parse(raw).type === "session-created"));
sessionWire.client.send(JSON.stringify({ type: "recover", id: "new-recover", logicalMapId: locus.logicalMapId }));
await new Promise<void>((resolve) => setTimeout(resolve, 0));
const newSnapshot = sessionWire.received.find((raw) => JSON.parse(raw).type === "recovery-snapshot");
assert.ok(newSnapshot);
assert.ok(newSnapshot.includes("newPublic"));
assert.ok(newSnapshot.includes("RUNTIME_PAGE_SENTINEL"));
assert.equal(newSnapshot.includes("privateState"), false);

const beforeInvalid = locus.rev;
await assert.rejects(locus.lib.add({ invalid: { data: 1 } },
  { exposure: { unknown: "client-public" } }), /unknown/i);
assert.equal(locus.rev, beforeInvalid);
assert.throws(() => authority.lib("invalid"), /Unknown/);
const NumberSchema = Hson.schema`<type "data" content <value "number">>`;
await assert.rejects(locus.lib.add({ valid: { data: { value: 1 } },
  invalidSchema: { data: { value: "wrong" }, schema: NumberSchema } }), /Schema|schema|number/i);
assert.equal(locus.rev, beforeInvalid);
assert.throws(() => authority.lib("valid"), /Unknown/);
await locus.lib.add({ defaultPrivate: { data: { secret: "DEFAULT_PRIVATE_SENTINEL" } } });
assert.equal(echo.lastAppliedRev, locus.rev);
assert.equal(wire.received.at(-1)?.includes("defaultPrivate"), false);
assert.equal(wire.received.at(-1)?.includes("DEFAULT_PRIVATE_SENTINEL"), false);

echo.dispose();
locus.dispose();
process.stdout.write("ok - public runtime admission and explicit live projection\n");

const interactionMap = hsonLiveMap.fromLibraries({ basePage: { document: Hson.document`<main/>` } });
enable_interactions(interactionMap);
const interactionLocus = hsonLocus.create({ map: interactionMap,
  exposure: [{ library: "basePage", exposure: "client-public" }],
  defaultProjection: { libraries: ["basePage"], htmlDocument: "basePage", systemFeatures: ["interactions"] },
  authorizeProjection: ({ requested }) => ({ libraries: requested.libraries, systemFeatures: requested.systemFeatures }),
});
const interactionWire = sockets();
interactionLocus.connect(interactionWire.server);
const interactionEcho = create_echo_socket_client_internal({ socket: interactionWire.client,
  logicalMapId: interactionLocus.logicalMapId });
await interactionEcho.connect();
const interactionClientMap = interactionEcho.map;
assert.ok(interactionClientMap);
const initialPage = interactionClientMap.lib("basePage");
if (initialPage.mode !== "document") throw new Error("Expected initial document Library.");
const existingMirror = hsonMirror(initialPage);
const existingTree = existingMirror.tree.node;
const existingMirrorUpdates = existingMirror.diagnostics().updatesApplied;
await interactionLocus.lib.add({ nextPage: { document: Hson.document`<main <button "Next"/>/>` } },
  { exposure: { nextPage: "client-public" } });
const listener = Object.freeze({ event: "click", target: "element" as const, capture: false, once: false,
  passive: false, missingTarget: "ignore" as const, preventDefault: false, stopPropagation: false,
  stopImmediatePropagation: false });
await interactionLocus.mutate((draft) => add_interaction(draft, {
  id: "next-button", subject: { library: "nextPage", path: [99] }, listener,
  kind: "browser-local", key: "NEW_INTERACTION_SENTINEL", args: Hson.data.from(null),
}));
assert.equal(interactionWire.received.at(-1)?.includes("NEW_INTERACTION_SENTINEL"), false);
const interactionSessionId = interactionEcho.session.sessionId;
assert.ok(interactionSessionId);
await interactionLocus.sessions.updateProjection(interactionSessionId,
  { libraries: ["basePage", "nextPage"], htmlDocument: "nextPage", systemFeatures: ["interactions"] });
assert.equal(interactionEcho.map, interactionClientMap);
assert.equal(interactionClientMap.lib("basePage"), initialPage);
assert.equal(existingMirror.tree.node, existingTree);
assert.equal(existingMirror.diagnostics().updatesApplied, existingMirrorUpdates);
assert.equal(interactionClientMap.lib("nextPage").mode, "document");
const nextPage = interactionClientMap.lib("nextPage");
if (nextPage.mode !== "document") throw new Error("Expected runtime document Library.");
const nextMirror = hsonMirror(nextPage);
assert.ok(nextMirror.tree.node);
assert.ok(interactionWire.received.at(-1)?.includes("NEW_INTERACTION_SENTINEL"));
assert.match(interactionLocus.cut(interactionSessionId).html, /Next/);
interactionEcho.dispose();
nextMirror.dispose();
existingMirror.dispose();
interactionLocus.dispose();
process.stdout.write("ok - projected runtime document interaction\n");

const collisionMap = hsonLiveMap.fromLibraries({ base: { data: { value: 1 } } });
const collisionLocus = hsonLocus.create({ map: collisionMap,
  exposure: [{ library: "base", exposure: "client-public" }],
  defaultProjection: { libraries: ["base"] },
  authorizeProjection: ({ requested }) => ({ libraries: requested.libraries }),
});
const collisionWire = sockets();
collisionLocus.connect(collisionWire.server);
const collisionEcho = create_echo_socket_client_internal({ socket: collisionWire.client,
  logicalMapId: collisionLocus.logicalMapId });
await collisionEcho.connect();
const collisionClientMap = collisionEcho.map;
assert.ok(collisionClientMap);
await collisionLocus.lib.add({ shared: { data: { owner: "authority" } } },
  { exposure: { shared: "client-public" } });
collisionClientMap.addLibraries({ shared: { data: { owner: "local" } } });
const localShared = collisionClientMap.lib("shared");
const localRev = collisionClientMap.rev;
const collisionSessionId = collisionEcho.session.sessionId;
assert.ok(collisionSessionId);
await collisionLocus.sessions.updateProjection(collisionSessionId, { libraries: ["base", "shared"] });
assert.equal(collisionEcho.diagnostics().status, "failed");
assert.equal(collisionClientMap.rev, localRev);
assert.equal(collisionClientMap.lib("shared"), localShared);
if (!("snap" in localShared)) throw new Error("Expected local data Library.");
assert.equal(localShared.snap(["owner"]), "local");
collisionEcho.dispose();
collisionLocus.dispose();
process.stdout.write("ok - client-local and projected authority collision is fenced\n");

const revokeMap = hsonLiveMap.fromLibraries({ base: { data: { value: 1 } } });
let releaseAuthorization = (): void => {};
let authorizationEntered = (): void => {};
const entered = new Promise<void>((resolve) => { authorizationEntered = resolve; });
const authorization = new Promise<void>((resolve) => { releaseAuthorization = resolve; });
let sawCurrentContext = false;
const revokeLocus = hsonLocus.create({ map: revokeMap,
  exposure: [{ library: "base", exposure: "client-public" }],
  defaultProjection: { libraries: ["base"] },
  authorizeProjection: async ({ requested, connection }) => {
    if (!requested.libraries.includes("later")) return { libraries: requested.libraries };
    sawCurrentContext = connection?.principalId === "alice" && connection.attachment !== undefined;
    authorizationEntered();
    await authorization;
    return { libraries: requested.libraries };
  },
});
const revokeWire = sockets();
revokeLocus.connect(revokeWire.server, { principalId: "alice", attachment: { role: "user" } });
const revokeEcho = create_echo_socket_client_internal({ socket: revokeWire.client,
  logicalMapId: revokeLocus.logicalMapId });
await revokeEcho.connect();
await revokeLocus.lib.add({ later: { data: { value: 2 } } }, { exposure: { later: "client-public" } });
const revokeSessionId = revokeEcho.session.sessionId;
assert.ok(revokeSessionId);
const pendingUpdate = revokeLocus.sessions.updateProjection(revokeSessionId, { libraries: ["base", "later"] });
await entered;
assert.equal(sawCurrentContext, true);
assert.equal(revokeLocus.revokeSession(revokeSessionId), true);
releaseAuthorization();
await assert.rejects(pendingUpdate, /projection.*unavailable/i);
assert.equal(revokeWire.received.some((raw) => JSON.parse(raw).type === "projection-change"), false);
revokeEcho.dispose();
revokeLocus.dispose();
process.stdout.write("ok - reauthorization uses current context and honors revocation\n");

const durableMap = hsonLiveMap.create();
const adapter = new MemoryCheckpointAdapter();
const durable = await create_persistent_locus({ map: durableMap, exposure: [],
  persistence: adapter, logicalMapId: "public-hosted-admission" });
await durable.lib.add({ first: { data: { value: 1 } }, second: { data: { value: 2 } } },
  { exposure: { first: "client-public" } });
assert.equal(durable.rev, 1);
assert.equal(adapter.state(durable.logicalMapId)?.commits.length, 1);
adapter.failAppend = new Error("append failed");
await assert.rejects(durable.lib.add({ refused: { data: { value: 3 } } },
  { exposure: { refused: "client-public" } }), /append/i);
assert.equal(durable.rev, 1);
assert.throws(() => durableMap.lib("refused"), /Unknown/);
durable.dispose();
const resumedMap = hsonLiveMap.create();
const resumed = await create_persistent_locus({ map: resumedMap, persistence: adapter,
  logicalMapId: "public-hosted-admission", exposure: [
    { library: "first", exposure: "client-public" },
    { library: "second", exposure: "server-private" },
  ] });
assert.equal(resumed.rev, 1);
const resumedFirst = resumedMap.lib("first");
if (!("snap" in resumedFirst)) throw new Error("Expected restored data Library.");
assert.equal(resumedFirst.snap(["value"]), 1);
resumed.dispose();
const sortedAdapter = new MemoryCheckpointAdapter();
const sortedInitial = hsonLiveMap.fromLibraries({ middle: { data: { value: 1 } } });
const sortedLocus = await create_persistent_locus({ map: sortedInitial, persistence: sortedAdapter,
  logicalMapId: "sorted-hosted-admission", exposure: [{ library: "middle", exposure: "client-public" }] });
await sortedLocus.lib.add({ aardvark: { data: { value: 2 } } },
  { exposure: { aardvark: "client-public" } });
sortedLocus.dispose();
const sortedRestartMap = hsonLiveMap.fromLibraries({ middle: { data: { value: 0 } } });
const sortedRestart = await create_persistent_locus({ map: sortedRestartMap, persistence: sortedAdapter,
  logicalMapId: "sorted-hosted-admission", exposure: [
    { library: "middle", exposure: "client-public" },
    { library: "aardvark", exposure: "client-public" },
  ] });
assert.equal(sortedRestartMap.lib("aardvark").mode, "data-object");
sortedRestart.dispose();
process.stdout.write("ok - public admission uses the durable authority gate atomically\n");

const capturedMap = hsonLiveMap.create();
const capturedLocus = hsonLocus.create({ map: capturedMap, exposure: [],
  authorizeProjection: ({ requested }) => ({ libraries: requested.libraries }) });
const mutableBatch = { one: { data: { value: 1 } } };
const pendingBatch = capturedLocus.lib.add(mutableBatch, { exposure: { one: "client-public" } });
Object.assign(mutableBatch, { unclassified: { data: { secret: "LATE_LIBRARY_SENTINEL" } } });
await pendingBatch;
assert.equal(capturedLocus.rev, 1);
assert.equal(capturedMap.lib("one").mode, "data-object");
assert.throws(() => capturedMap.lib("unclassified"), /Unknown/);
const inheritedExposure: Record<string, "client-public"> = Object.create({ inherited: "client-public" });
await capturedLocus.lib.add({ inherited: { data: { secret: "INHERITED_EXPOSURE_SENTINEL" } } },
  { exposure: inheritedExposure });
const capturedWire = sockets();
capturedLocus.connect(capturedWire.server);
capturedWire.client.send(JSON.stringify({ type: "session-create", id: "captured-session",
  projection: { libraries: ["one", "inherited"] } }));
capturedWire.client.send(JSON.stringify({ type: "recover", id: "captured-recover",
  logicalMapId: capturedLocus.logicalMapId }));
await new Promise<void>((resolve) => setTimeout(resolve, 0));
const capturedSnapshot = capturedWire.received.find((raw) => JSON.parse(raw).type === "recovery-snapshot");
assert.ok(capturedSnapshot);
assert.ok(capturedSnapshot.includes('"one"'));
assert.equal(capturedSnapshot.includes("INHERITED_EXPOSURE_SENTINEL"), false);
capturedLocus.dispose();
process.stdout.write("ok - admission captures names before queueing and ignores inherited exposure\n");
