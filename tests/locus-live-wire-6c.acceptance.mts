import assert from "node:assert/strict";
import { Hson, add_interaction, enable_interactions, hsonLiveMap, hsonLocus, type HsonSchema } from "../src/index.ts";
import { encode_locus_client_message } from "../src/api/locus/locus.protocol.ts";
import type { LocusSocketLike } from "../src/types/locus.types.ts";
import { LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT } from "../src/api/locus/locus.aggregate.protocol.ts";
import { DEFAULT_LOCUS_HOSTED_AGGREGATE_MAX_WIRE_BYTES, type LocusHostedAggregateDraft } from "../src/api/locus/locus.aggregate.ts";
import { create_echo_socket_client_internal } from "../src/api/echo/echo.aggregate-replica.ts";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";
import { make_locus_hosted_projection_policy, normalize_locus_effective_projection } from "../src/api/locus/locus.projection.ts";
import { project_locus_live_transition_internal, LOCUS_LIVE_PROJECTED_WIRE_FORMAT } from "../src/api/locus/locus.live-projection.ts";
import { create_locus_hosted_aggregate_socket_internal } from "../src/api/locus/locus.aggregate.socket.ts";

const Schema: HsonSchema = Hson.schema`<type "data" content <value "string">>`;
const map = hsonLiveMap.fromLibraries({
  A: { data: { value: "A0" }, schema: Schema },
  B: { data: { value: "B0" }, schema: Schema },
  PRIVATE_NAME_SENTINEL: { data: { value: "PRIVATE_ROOT_SENTINEL" }, schema: Schema },
  UNSELECTED_NAME_SENTINEL: { data: { value: "UNSELECTED_ROOT_SENTINEL" }, schema: Schema },
});
const server = create_locus_hosted_aggregate_socket_internal({ map, exposure: [
  { library: "A", exposure: "client-public" },
  { library: "B", exposure: "client-public" },
  { library: "PRIVATE_NAME_SENTINEL", exposure: "server-private" },
  { library: "UNSELECTED_NAME_SENTINEL", exposure: "client-public" },
], defaultProjection: { libraries: ["A"] }, authorizeProjection: () => ({ libraries: ["A", "B"] }) });
function data(draft: LocusHostedAggregateDraft, name: string) {
  const library = draft.lib(name);
  if (!("at" in library)) throw new Error("Expected data library.");
  return library;
}
function pair() {
  const toServer = new Set<(raw: string) => void>();
  const toClient = new Set<(raw: string) => void>();
  const received: string[] = [];
  const client: LocusSocketLike = {
    send(raw) { for (const listener of toServer) listener(raw); }, close() {},
    onMessage(listener) { toClient.add(listener); return () => { toClient.delete(listener); }; },
    onClose() { return () => {}; },
  };
  const socket: LocusSocketLike = {
    send(raw) { received.push(raw); for (const listener of toClient) listener(raw); }, close() {},
    onMessage(listener) { toServer.add(listener); return () => { toServer.delete(listener); }; },
    onClose() { return () => {}; },
  };
  return { client, socket, received };
}
async function settle() { await new Promise<void>((resolve) => setTimeout(resolve, 0)); }
async function session(selection: string) {
  const connection = pair();
  server.connect(connection.socket);
  connection.client.send(encode_locus_client_message({ type: "session-create", id: `create-${selection}`,
    projection: { libraries: [selection] } }));
  await settle();
  assert.ok(connection.received.some((raw) => JSON.parse(raw).type === "session-created"));
  connection.client.send(JSON.stringify({ type: "recover", id: `recover-${selection}`, logicalMapId: server.logicalMapId }));
  await settle();
  assert.ok(connection.received.some((raw) => JSON.parse(raw).type === "recovery-caught-up"));
  return connection;
}
const a = await session("A");
const b = await session("B");
function live(connection: Awaited<ReturnType<typeof session>>) {
  return connection.received.filter((raw) => {
    const message = JSON.parse(raw);
    return message.type === "commit" || message.type === "progress";
  });
}
await server.mutate((draft) => {
  data(draft, "A").at(["value"]).set("VISIBLE_A_SENTINEL");
  data(draft, "B").at(["value"]).set("VISIBLE_B_SENTINEL");
  data(draft, "PRIVATE_NAME_SENTINEL").at(["value"]).set("PRIVATE_SENTINEL");
  data(draft, "UNSELECTED_NAME_SENTINEL").at(["value"]).set("UNSELECTED_SENTINEL");
});
assert.equal(live(a).length, 1);
assert.equal(live(b).length, 1);
const firstA = live(a)[0]!;
const firstB = live(b)[0]!;
assert.ok(firstA.includes("VISIBLE_A_SENTINEL"));
assert.ok(firstB.includes("VISIBLE_B_SENTINEL"));
for (const text of [firstA, firstB]) {
  for (const hidden of ["PRIVATE_NAME_SENTINEL", "PRIVATE_SENTINEL", "UNSELECTED_NAME_SENTINEL", "UNSELECTED_SENTINEL"]) {
    assert.equal(text.includes(hidden), false);
  }
  assert.equal(JSON.parse(text).format, LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT);
}
assert.equal(firstA.includes("VISIBLE_B_SENTINEL"), false);
assert.equal(firstB.includes("VISIBLE_A_SENTINEL"), false);
assert.equal(JSON.parse(firstA).commit.commit.rev, JSON.parse(firstB).commit.commit.rev);
await server.mutate((draft) => data(draft, "PRIVATE_NAME_SENTINEL").at(["value"]).set("PRIVATE_SENTINEL_2"));
assert.equal(live(a).length, 2);
assert.equal(live(b).length, 2);
for (const connection of [a, b]) {
  const raw = live(connection)[1]!;
  const event = JSON.parse(raw);
  assert.equal(event.type, "progress");
  assert.equal(event.progress.prevRev, 1);
  assert.equal(event.progress.rev, 2);
  assert.deepEqual(Object.keys(event.progress).sort(), ["incarnationId", "logicalMapId", "prevRev", "registryDigest", "rev"]);
  assert.equal(raw.includes("PRIVATE"), false);
}
const echoPair = pair();
server.connect(echoPair.socket);
const echo = create_echo_socket_client_internal({ socket: echoPair.client, logicalMapId: server.logicalMapId });
assert.equal((await echo.connect()).revision, 2);
assert.equal(echo.lastAppliedRev, 2);
assert.equal(echo.map?.rev, 0);

const wireLimit = DEFAULT_LOCUS_HOSTED_AGGREGATE_MAX_WIRE_BYTES;
const privatePayload = `PRIVATE_OVERSIZE_WIRE_SENTINEL_${"x".repeat(4_500_000)}`;
assert.ok(new TextEncoder().encode(privatePayload).byteLength > wireLimit);
const privateCommit = await server.mutate((draft) => {
  data(draft, "PRIVATE_NAME_SENTINEL").at(["value"]).set(privatePayload);
});
assert.ok(privateCommit);
assert.equal(privateCommit.rev, 3);
assert.ok(JSON.stringify(privateCommit).includes("PRIVATE_OVERSIZE_WIRE_SENTINEL"));
assert.ok(new TextEncoder().encode(JSON.stringify(privateCommit)).byteLength > wireLimit);
assert.equal(map.rev, 3);
for (const connection of [a, b, echoPair]) {
  const raw = live(connection)[connection === echoPair ? 0 : 2]!;
  const event = JSON.parse(raw);
  assert.equal(event.type, "progress");
  assert.equal(event.progress.prevRev, 2);
  assert.equal(event.progress.rev, 3);
  assert.ok(new TextEncoder().encode(raw).byteLength < wireLimit);
  assert.deepEqual(Object.keys(event.progress).sort(), ["incarnationId", "logicalMapId", "prevRev", "registryDigest", "rev"]);
  assert.equal(raw.includes("PRIVATE_OVERSIZE_WIRE_SENTINEL"), false);
  assert.equal(raw.includes(privatePayload), false);
  assert.equal(raw.includes("PRIVATE_NAME_SENTINEL"), false);
}
assert.equal(echo.lastAppliedRev, 3);
assert.equal(echo.map?.rev, 0);

const mixedCommit = await server.mutate((draft) => {
  data(draft, "PRIVATE_NAME_SENTINEL").at(["value"]).set("PRIVATE_AFTER_MIXED");
  data(draft, "A").at(["value"]).set("SMALL_A_MIXED_SENTINEL");
  data(draft, "B").at(["value"]).set("SMALL_B_MIXED_SENTINEL");
});
assert.ok(mixedCommit);
assert.equal(mixedCommit.rev, 4);
assert.ok(JSON.stringify(mixedCommit).includes("PRIVATE_OVERSIZE_WIRE_SENTINEL"));
assert.ok(new TextEncoder().encode(JSON.stringify(mixedCommit)).byteLength > wireLimit);
assert.equal(map.rev, 4);
for (const [connection, index, visible, other] of [
  [a, 3, "SMALL_A_MIXED_SENTINEL", "SMALL_B_MIXED_SENTINEL"],
  [b, 3, "SMALL_B_MIXED_SENTINEL", "SMALL_A_MIXED_SENTINEL"],
  [echoPair, 1, "SMALL_A_MIXED_SENTINEL", "SMALL_B_MIXED_SENTINEL"],
] as const) {
  const raw = live(connection)[index]!;
  const event = JSON.parse(raw);
  assert.equal(event.type, "commit");
  assert.equal(event.commit.commit.prevRev, 3);
  assert.equal(event.commit.commit.rev, 4);
  assert.ok(new TextEncoder().encode(raw).byteLength < wireLimit);
  assert.ok(raw.includes(visible));
  assert.equal(raw.includes(other), false);
  assert.equal(raw.includes("PRIVATE_OVERSIZE_WIRE_SENTINEL"), false);
  assert.equal(raw.includes("PRIVATE_AFTER_MIXED"), false);
  assert.equal(raw.includes("PRIVATE_NAME_SENTINEL"), false);
}
assert.equal(echo.lastAppliedRev, 4);
assert.equal(echo.map?.rev, 1);
const echoA = echo.map?.lib("A");
if (echoA === undefined || echoA.mode === "document") throw new Error("Expected projected A data library.");
assert.equal(echoA.snap(["value"]), "SMALL_A_MIXED_SENTINEL");

const oversizedVisible = `VISIBLE_OVERSIZE_WIRE_SENTINEL_${"y".repeat(4_500_000)}`;
const beforeRejected = live(a).length;
const beforeRejectedB = live(b).length;
const beforeRejectedEcho = live(echoPair).length;
await assert.rejects(() => server.mutate((draft) => {
  data(draft, "A").at(["value"]).set(oversizedVisible);
  data(draft, "B").at(["value"]).set("SMALL_B_REJECTED_SENTINEL");
}), /Hosted aggregate socket message exceeds its configured byte limit/);
assert.equal(server.rev, 4);
assert.equal(map.rev, 4);
assert.equal(echo.lastAppliedRev, 4);
assert.equal(echo.map.rev, 1);
assert.equal(echoA.snap(["value"]), "SMALL_A_MIXED_SENTINEL");
assert.equal(live(a).length, beforeRejected);
assert.equal(live(b).length, beforeRejectedB);
assert.equal(live(echoPair).length, beforeRejectedEcho);
const authorityB = map.lib("B");
if (!("snap" in authorityB)) throw new Error("Expected B data library.");
assert.equal(authorityB.snap(["value"]), "SMALL_B_MIXED_SENTINEL");

const ordinary = await server.mutate((draft) => data(draft, "A").at(["value"]).set("SMALL_A_AFTER_REJECTION"));
assert.equal(ordinary?.prevRev, 4);
assert.equal(ordinary.rev, 5);
assert.equal(JSON.parse(live(a)[4]!).commit.commit.rev, 5);
assert.equal(JSON.parse(live(b)[4]!).progress.rev, 5);
assert.equal(echo.lastAppliedRev, 5);
assert.equal(echo.map.rev, 2);
assert.equal(echoA.snap(["value"]), "SMALL_A_AFTER_REJECTION");
echo.dispose();
server.dispose();

// A versioned projected frame is checked before accepting the authority write.
const probeMap = hsonLiveMap.fromLibraries({ A: { data: { value: "A0" }, schema: Schema } });
const probe = internal_livemap_aggregate_authority(probeMap);
const probeInitial = probe.captureHosted();
const probePolicy = make_locus_hosted_projection_policy(probeInitial.registry, probeInitial.authority,
  [{ library: "A", exposure: "client-public" }], undefined, () => ({ libraries: ["A"] }));
const probeEffective = await normalize_locus_effective_projection(probePolicy, { libraries: ["A"] });
const probeCommit = probe.commit([{ target: probe.target(probe.libraries()[0]!, ["value"]), kind: "set", value: "A1" }]).hosted;
assert.ok(probeCommit);
const oldBytes = new TextEncoder().encode(JSON.stringify(probeCommit)).byteLength;
const projected = project_locus_live_transition_internal(probeCommit, probeEffective);
assert.equal(projected.kind, "commit");
if (projected.kind !== "commit") throw new Error("Expected visible probe.");
const projectedBytes = new TextEncoder().encode(JSON.stringify({ type: "commit", id: "recover-A",
  commit: { format: LOCUS_LIVE_PROJECTED_WIRE_FORMAT, logicalMapId: probeEffective.authority.logicalMapId,
    incarnationId: probeEffective.authority.incarnationId, registryDigest: projected.commit.registryDigest,
    commit: projected.commit }, format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT })).byteLength;
assert.ok(projectedBytes > oldBytes + 1);
const tightMap = hsonLiveMap.fromLibraries({ A: { data: { value: "A0" }, schema: Schema } });
const tightServer = create_locus_hosted_aggregate_socket_internal({ map: tightMap, exposure: [{ library: "A", exposure: "client-public" }],
  defaultProjection: { libraries: ["A"] }, authorizeProjection: () => ({ libraries: ["A"] }),
  maxWireBytes: oldBytes + 1 });
const tightConnection = pair();
tightServer.connect(tightConnection.socket);
tightConnection.client.send(encode_locus_client_message({ type: "session-create", id: "tight-create" }));
await settle();
tightConnection.client.send(JSON.stringify({ type: "recover", id: "tight-recover", logicalMapId: tightServer.logicalMapId }));
await settle();
assert.ok(tightConnection.received.some((raw) => JSON.parse(raw).type === "recovery-caught-up"));
await assert.rejects(() => tightServer.mutate((draft) => {
  const library = draft.lib("A");
  if (!("at" in library)) throw new Error("Expected data library.");
  library.at(["value"]).set("A1");
}));
assert.equal(tightMap.rev, 0);
assert.equal(tightConnection.received.filter((raw) => ["commit", "progress"].includes(JSON.parse(raw).type)).length, 0);
tightServer.dispose();

const PageSchema: HsonSchema = Hson.schema`<type "document" tag "main" content "empty">`;
const interactionMap = hsonLiveMap.fromLibraries({
  page: { document: "<main/>", schema: PageSchema },
  hiddenDoc: { document: "<main/>", schema: PageSchema },
});
enable_interactions(interactionMap);
const interactionServer = hsonLocus.create({ map: interactionMap, exposure: [
  { library: "page", exposure: "client-public" }, { library: "hiddenDoc", exposure: "server-private" },
], defaultProjection: { libraries: ["page"], systemFeatures: ["interactions"] },
authorizeProjection: () => ({ libraries: ["page"], systemFeatures: ["interactions"] }) });
const interactionConnection = pair();
interactionServer.connect(interactionConnection.socket);
interactionConnection.client.send(encode_locus_client_message({ type: "session-create", id: "interaction-create" }));
await settle();
interactionConnection.client.send(JSON.stringify({ type: "recover", id: "interaction-recover", logicalMapId: interactionServer.logicalMapId }));
await settle();
const listener = Object.freeze({ event: "click", target: "element" as const, capture: false, once: false,
  passive: false, missingTarget: "ignore" as const, preventDefault: false, stopPropagation: false,
  stopImmediatePropagation: false });
await interactionServer.mutate((draft) => {
  add_interaction(draft, { id: "visible", subject: { library: "page", path: [99] }, listener,
    kind: "browser-local", key: "VISIBLE_INTERACTION_WIRE_SENTINEL", args: Hson.data.from(null) });
  add_interaction(draft, { id: "hidden", subject: { library: "hiddenDoc", path: [99] }, listener,
    kind: "browser-local", key: "HIDDEN_INTERACTION_WIRE_SENTINEL", args: Hson.data.from(null) });
});
const interactionWire = live(interactionConnection)[0]!;
assert.equal(JSON.parse(interactionWire).type, "commit");
assert.ok(interactionWire.includes("VISIBLE_INTERACTION_WIRE_SENTINEL"));
assert.equal(interactionWire.includes("HIDDEN_INTERACTION_WIRE_SENTINEL"), false);
assert.equal(interactionWire.includes("hiddenDoc"), false);
await interactionServer.mutate((draft) => {
  add_interaction(draft, { id: "hidden-two", subject: { library: "hiddenDoc", path: [98] }, listener,
    kind: "browser-local", key: "HIDDEN_INTERACTION_TWO_WIRE_SENTINEL", args: Hson.data.from(null) });
});
const interactionProgress = live(interactionConnection)[1]!;
assert.equal(JSON.parse(interactionProgress).type, "progress");
assert.equal(interactionProgress.includes("HIDDEN_INTERACTION_TWO_WIRE_SENTINEL"), false);
interactionServer.dispose();
process.stdout.write("Step 6C live socket wire acceptance passed.\n");
