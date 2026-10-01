import { authority_groups_from_map_fixture } from "./helpers/locus-definition-fixture.mts";
import { test_echo_transport } from "./helpers/echo-websocket-transport.mts";
import { bind_locus_websocket } from "../src/api/locus/locus.websocket.ts";
import assert from "node:assert/strict";
import { Hson, add_interaction, enable_interactions, hsonLiveMap, hsonLocus, hsonMirror, type LocusWebSocketLike } from "../src/index.ts";
import { create_echo_aggregate_client_internal } from "../src/api/echo/echo.aggregate-replica.ts";
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
  const client: LocusWebSocketLike = {
    send(raw) { for (const listener of toServer) listener(raw); }, close() {},
    onMessage(listener) { toClient.add(listener); return () => { toClient.delete(listener); }; },
    onClose() { return () => {}; },
  };
  const server: LocusWebSocketLike = {
    send(raw) { received.push(raw); for (const listener of toClient) listener(raw); }, close() {},
    onMessage(listener) { toServer.add(listener); return () => { toServer.delete(listener); }; },
    onClose() { return () => {}; },
  };
  return { client, server, received };
}

const authority = hsonLiveMap.fromLibraries({ base: { data: { count: 1 } } });
let allowNew = false;
const locus = hsonLocus.create({ ...authority_groups_from_map_fixture(authority, [{ name: "base", ownership: "shared" }]), defaultProjection: { libraries: ["base"] }, authorizeProjection: ({ requested }) => ({ libraries: requested.libraries.filter((name) =>
    allowNew || (name !== "newPublic" && name !== "page")) }) });
const wire = sockets();
bind_locus_websocket(locus, wire.server);
const echo = create_echo_aggregate_client_internal({ transport: test_echo_transport(wire.client), logicalMapId: locus.logicalMapId });
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
await locus.stage.addLibraries({ private: [{ name: "privateState", definition: { data: { secret: "PRIVATE_ROOT_SENTINEL" } } }], shared: [{ name: "newPublic", definition: { data: { count: 2 } } }, { name: "page", definition: { document: Hson.document`<main <p "RUNTIME_PAGE_SENTINEL"/>/>` } }] });
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
const rejected = await locus.session.get(sessionId)!.update({ libraries: ["base", "newPublic"] });
assert.equal(rejected.changed, false);
assert.equal(clientMap.rev, beforeClientRev + 1);
allowNew = true;
const authorityMapRevBeforeProjection = locus.map.rev;
const result = await locus.session.get(sessionId)!.update({ libraries: ["base", "newPublic", "page"] });
assert.equal(result.changed, true);
assert.equal(result.authorityRev, locus.rev);
assert.equal(result.sequence, 1);
assert.equal(locus.map.rev, authorityMapRevBeforeProjection);
assert.equal(echo.map, clientMap);
assert.equal(clientMap.rev, beforeClientRev + 2);
assert.equal(clientMap.lib("base"), base);
assert.equal(clientMap.lib("preferences"), preferences);
assert.equal(clientMap.lib("newPublic").mode, "data-object");
assert.equal(client_library_source_internal(clientMap.lib("newPublic")), "authority-projected");
assert.equal(clientMap.lib("page").mode, "document");
assert.equal(wire.received.at(-1)?.includes("privateState"), false);
const cut = locus.session.get(sessionId)!.now({ html: "page" });
assert.match(cut.html, /RUNTIME_PAGE_SENTINEL/);
assert.ok(JSON.stringify(cut.libs).includes("newPublic"));
assert.equal(JSON.stringify(cut.libs).includes("PRIVATE_ROOT_SENTINEL"), false);
await locus.stage((draft) => {
  const library = draft.lib("newPublic");
  if (library.mode === "document") throw new Error("Expected data Library.");
  library.at(["count"]).set(3);
});
assert.equal(echo.lastAppliedRev, locus.rev);
const projected = clientMap.lib("newPublic");
if (!("snap" in projected)) throw new Error("Expected projected data Library.");
assert.equal(projected.snap(["count"]), 3);
assert.equal((await echo.recover()).outcome, "current");
assert.equal(echo.map, clientMap);

const sessionWire = sockets();
bind_locus_websocket(locus, sessionWire.server);
sessionWire.client.send(JSON.stringify({ type: "session-create", id: "new-session",
  projection: { libraries: ["newPublic", "page"] } }));
await Promise.resolve();
assert.ok(sessionWire.received.some((raw) => JSON.parse(raw).type === "session-created"));
sessionWire.client.send(JSON.stringify({ type: "recover", id: "new-recover", logicalMapId: locus.logicalMapId }));
await new Promise<void>((resolve) => setTimeout(resolve, 0));
const newSnapshot = sessionWire.received.find((raw) => JSON.parse(raw).type === "recovery-snapshot");
assert.ok(newSnapshot);
assert.ok(newSnapshot.includes("newPublic"));
assert.ok(newSnapshot.includes("RUNTIME_PAGE_SENTINEL"));
assert.equal(newSnapshot.includes("privateState"), false);

const beforeInvalid = locus.rev;
await assert.rejects(locus.stage.addLibraries({
  private: [{ name: "invalid", definition: { data: 1 } }],
  shared: [{ name: "invalid", definition: { data: 2 } }],
}), /duplicat/i);
assert.equal(locus.rev, beforeInvalid);
assert.throws(() => locus.map.lib("invalid"), /Unknown/);
const NumberSchema = Hson.schema`<type "data" content <value "number">>`;
await assert.rejects(locus.stage.addLibraries({ private: [{ name: "valid", definition: { data: { value: 1 } } }, { name: "invalidSchema", definition: { data: { value: "wrong" }, schema: NumberSchema } }] }), /Schema|schema|number/i);
assert.equal(locus.rev, beforeInvalid);
assert.throws(() => locus.map.lib("valid"), /Unknown/);
await locus.stage.addLibraries({ private: [{ name: "explicitPrivate", definition: { data: { secret: "EXPLICIT_PRIVATE_SENTINEL" } } }] });
assert.equal(echo.lastAppliedRev, locus.rev);
assert.equal(wire.received.at(-1)?.includes("explicitPrivate"), false);
assert.equal(wire.received.at(-1)?.includes("EXPLICIT_PRIVATE_SENTINEL"), false);

echo.dispose();
locus.dispose();
process.stdout.write("ok - public runtime admission and explicit live projection\n");

const interactionMap = hsonLiveMap.fromLibraries({ basePage: { document: Hson.document`<main/>` } });
enable_interactions(interactionMap);
const interactionLocus = hsonLocus.create({ ...authority_groups_from_map_fixture(interactionMap, [{ name: "basePage", ownership: "shared" }]), defaultProjection: { libraries: ["basePage"], systemFeatures: ["interactions"] }, authorizeProjection: ({ requested }) => ({ libraries: requested.libraries, systemFeatures: requested.systemFeatures }) });
const interactionWire = sockets();
bind_locus_websocket(interactionLocus, interactionWire.server);
const interactionEcho = create_echo_aggregate_client_internal({ transport: test_echo_transport(interactionWire.client),
  logicalMapId: interactionLocus.logicalMapId });
await interactionEcho.connect();
const interactionClientMap = interactionEcho.map;
assert.ok(interactionClientMap);
const initialPage = interactionClientMap.lib("basePage");
if (initialPage.mode !== "document") throw new Error("Expected initial document Library.");
const existingMirror = hsonMirror(initialPage);
const existingTree = existingMirror.tree.node;
const existingMirrorUpdates = existingMirror.diagnostics().updatesApplied;
await interactionLocus.stage.addLibraries({ shared: [{ name: "nextPage", definition: { document: Hson.document`<main <button "Next"/>/>` } }] });
const listener = Object.freeze({ event: "click", target: "element" as const, capture: false, once: false,
  passive: false, missingTarget: "ignore" as const, preventDefault: false, stopPropagation: false,
  stopImmediatePropagation: false });
await interactionLocus.stage((draft) => add_interaction(draft, {
  id: "next-button", subject: { library: "nextPage", path: [99] }, listener,
  kind: "browser", key: "NEW_INTERACTION_SENTINEL", args: Hson.data.from(null),
}));
assert.equal(interactionWire.received.at(-1)?.includes("NEW_INTERACTION_SENTINEL"), false);
const interactionSessionId = interactionEcho.session.sessionId;
assert.ok(interactionSessionId);
await interactionLocus.session.get(interactionSessionId)!.update({ libraries: ["basePage", "nextPage"], systemFeatures: ["interactions"] });
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
assert.match(interactionLocus.session.get(interactionSessionId)!.now({ html: "nextPage" }).html, /Next/);
interactionEcho.dispose();
nextMirror.dispose();
existingMirror.dispose();
interactionLocus.dispose();
process.stdout.write("ok - projected runtime document interaction\n");

const collisionMap = hsonLiveMap.fromLibraries({ base: { data: { value: 1 } } });
const collisionLocus = hsonLocus.create({ ...authority_groups_from_map_fixture(collisionMap, [{ name: "base", ownership: "shared" }]), defaultProjection: { libraries: ["base"] }, authorizeProjection: ({ requested }) => ({ libraries: requested.libraries }) });
const collisionWire = sockets();
bind_locus_websocket(collisionLocus, collisionWire.server);
const collisionEcho = create_echo_aggregate_client_internal({ transport: test_echo_transport(collisionWire.client),
  logicalMapId: collisionLocus.logicalMapId });
await collisionEcho.connect();
const collisionClientMap = collisionEcho.map;
assert.ok(collisionClientMap);
await collisionLocus.stage.addLibraries({ shared: [{ name: "shared", definition: { data: { owner: "authority" } } }] });
collisionClientMap.addLibraries({ shared: { data: { owner: "local" } } });
const localShared = collisionClientMap.lib("shared");
const localRev = collisionClientMap.rev;
const collisionSessionId = collisionEcho.session.sessionId;
assert.ok(collisionSessionId);
await collisionLocus.session.get(collisionSessionId)!.update({ libraries: ["base", "shared"] });
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
const revokeLocus = hsonLocus.create({ ...authority_groups_from_map_fixture(revokeMap, [{ name: "base", ownership: "shared" }]), defaultProjection: { libraries: ["base"] }, authorizeProjection: async ({ requested, connection }) => {
    if (!requested.libraries.includes("later")) return { libraries: requested.libraries };
    sawCurrentContext = connection?.principalId === "alice" && connection.attachment !== undefined;
    authorizationEntered();
    await authorization;
    return { libraries: requested.libraries };
  } });
const revokeWire = sockets();
bind_locus_websocket(revokeLocus, revokeWire.server, { principalId: "alice", attachment: { role: "user" } });
const revokeEcho = create_echo_aggregate_client_internal({ transport: test_echo_transport(revokeWire.client),
  logicalMapId: revokeLocus.logicalMapId });
await revokeEcho.connect();
await revokeLocus.stage.addLibraries({ shared: [{ name: "later", definition: { data: { value: 2 } } }] });
const revokeSessionId = revokeEcho.session.sessionId;
assert.ok(revokeSessionId);
const pendingUpdate = revokeLocus.session.get(revokeSessionId)!.update({ libraries: ["base", "later"] });
await entered;
assert.equal(sawCurrentContext, true);
assert.equal(revokeLocus.session.get(revokeSessionId)!.revoke(), true);
releaseAuthorization();
await assert.rejects(pendingUpdate, /projection.*unavailable/i);
assert.equal(revokeWire.received.some((raw) => JSON.parse(raw).type === "projection-change"), false);
revokeEcho.dispose();
revokeLocus.dispose();
process.stdout.write("ok - reauthorization uses current context and honors revocation\n");

const durableMap = hsonLiveMap.create();

const reservedAdapter = new MemoryCheckpointAdapter();
const reservedMap = hsonLiveMap.create();
const reserved = await hsonLocus.resume({ ...authority_groups_from_map_fixture(reservedMap, [
    { name: "ui", ownership: "local", initializer: { data: { value: 0 } } },
  ]), persistence: reservedAdapter, logicalMapId: "local-name-reservation", authorizeProjection: ({ requested }) => ({ libraries: requested.libraries }) });
const reservedSession = await reserved.session.create({ libraries: ["ui"] });
const reservedInitial = reservedSession.now();
assert.throws(() => reserved.map.addLibraries({ ui: { data: { value: 99 } } }), /managed|authority|reserved/i);
for (const ownership of ["private", "shared"] as const) {
  const beforeRev = reserved.rev;
  const beforeCommits = reservedAdapter.appendCalls.length;
  await assert.rejects(reserved.stage.addLibraries({
    [ownership]: [{ name: "ui", definition: { data: { value: 99 } } }],
  }), /local initializer|collides/i);
  assert.equal(reserved.rev, beforeRev);
  assert.equal(reservedAdapter.appendCalls.length, beforeCommits);
  assert.throws(() => reserved.map.lib("ui"), /Unknown/i);
  assert.deepEqual(reservedSession.now().local, reservedInitial.local);
  assert.equal(reservedSession.now().initializerDigest, reservedInitial.initializerDigest);
}
reserved.dispose();

const adapter = new MemoryCheckpointAdapter();
const durable = await hsonLocus.resume({ ...authority_groups_from_map_fixture(durableMap, []), persistence: adapter, logicalMapId: "public-hosted-admission" });
await durable.stage.addLibraries({ private: [{ name: "second", definition: { data: { value: 2 } } }], shared: [{ name: "first", definition: { data: { value: 1 } } }] });
assert.equal(durable.rev, 1);
assert.equal(adapter.state(durable.logicalMapId)?.commits.length, 1);
adapter.failAppend = new Error("append failed");
await assert.rejects(durable.stage.addLibraries({ shared: [{ name: "refused", definition: { data: { value: 3 } } }] }), /append/i);
assert.equal(durable.rev, 1);
assert.throws(() => durable.map.lib("refused"), /Unknown/);
durable.dispose();
const resumedMap = hsonLiveMap.create();
const resumed = await hsonLocus.resume({ ...authority_groups_from_map_fixture(resumedMap, []),
  persistence: adapter, logicalMapId: "public-hosted-admission" });
assert.equal(resumed.rev, 1);
const resumedFirst = resumed.map.lib("first");
if (!("snap" in resumedFirst)) throw new Error("Expected restored data Library.");
assert.equal(resumedFirst.snap(["value"]), 1);
resumed.dispose();
const sortedAdapter = new MemoryCheckpointAdapter();
const sortedInitial = hsonLiveMap.fromLibraries({ middle: { data: { value: 1 } } });
const sortedLocus = await hsonLocus.resume({ ...authority_groups_from_map_fixture(sortedInitial, [{ name: "middle", ownership: "shared" }]), persistence: sortedAdapter, logicalMapId: "sorted-hosted-admission" });
await sortedLocus.stage.addLibraries({ shared: [{ name: "aardvark", definition: { data: { value: 2 } } }] });
sortedLocus.dispose();
const sortedRestartMap = hsonLiveMap.fromLibraries({ middle: { data: { value: 0 } } });
const sortedRestart = await hsonLocus.resume({ ...authority_groups_from_map_fixture(sortedRestartMap, [
    { name: "middle", ownership: "shared" },
  ]), persistence: sortedAdapter, logicalMapId: "sorted-hosted-admission" });
assert.equal(sortedRestart.map.lib("aardvark").mode, "data-object");
sortedRestart.dispose();
process.stdout.write("ok - public admission uses the durable authority gate atomically\n");

const capturedMap = hsonLiveMap.create();
const capturedLocus = hsonLocus.create({ ...authority_groups_from_map_fixture(capturedMap, []), authorizeProjection: ({ requested }) => ({ libraries: requested.libraries }) });
const mutableBatch = { one: { data: { value: 1 } } };
const pendingBatch = capturedLocus.stage.addLibraries({ shared: [{ name: "one", definition: mutableBatch.one }] });
Object.assign(mutableBatch, { unclassified: { data: { secret: "LATE_LIBRARY_SENTINEL" } } });
await pendingBatch;
assert.equal(capturedLocus.rev, 1);
assert.equal(capturedLocus.map.lib("one").mode, "data-object");
assert.throws(() => capturedLocus.map.lib("unclassified"), /Unknown/);
await capturedLocus.stage.addLibraries({ private: [{ name: "inherited",
  definition: { data: { secret: "INHERITED_EXPOSURE_SENTINEL" } } }] });
const capturedWire = sockets();
bind_locus_websocket(capturedLocus, capturedWire.server);
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
process.stdout.write("ok - admission captures names before queueing and ignores inherited ownership metadata\n");
