import assert from "node:assert/strict";
import { Hson, add_interaction, enable_interactions, hsonLiveMap, hsonMirror, type HsonSchema, type LiveMapLibraries } from "../src/index.ts";
import type { LocusSocketLike } from "../src/types/locus.types.ts";
import { create_locus_hosted_aggregate_socket_internal } from "../src/api/locus/locus.aggregate.socket.ts";
import { create_echo_socket_client_internal } from "../src/api/echo/echo.aggregate-replica.ts";
import { make_echo_document_authority } from "../src/api/echo/echo.document-authority.ts";
import { LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT } from "../src/api/locus/locus.aggregate.protocol.ts";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";
import { acquire_livemap_document_identity } from "../src/api/livemap/livemap.document.identity-handle.ts";
import { livemap_identity_epoch_accounting } from "../src/api/livemap/livemap.identity-epoch.ts";
import { validate_livemap_document_admission } from "../src/api/livemap/livemap.document.capture.ts";
import { validate_document_path } from "../src/api/livemap/livemap.document.path.ts";
import { encode_hosted_root } from "../src/api/livemap/livemap.hosted.ts";
import { INTERACTION_RESERVED_LIBRARY_KEY } from "../src/internal/interaction-storage.ts";
import { install_fake_document } from "./helpers/fake-document.mts";

const VisibleSchema: HsonSchema = Hson.schema`<type "data" content <value "string">>`;
const PrivateSchema: HsonSchema = Hson.schema`<type "data" content <PRIVATE_SCHEMA_SENTINEL "string">>`;
const UnselectedSchema: HsonSchema = Hson.schema`<type "data" content <UNSELECTED_SCHEMA_SENTINEL "string">>`;
const LocalSchema: HsonSchema = Hson.schema`<type "data" content <value "string">>`;

function fixture(maxHistoryBytes?: number, afterRecoveryCut?: () => void | Promise<void>) {
  const map = hsonLiveMap.fromLibraries({
    visible: { data: { value: "VISIBLE_BOOTSTRAP_SENTINEL" }, schema: VisibleSchema },
    PRIVATE_NAME_SENTINEL: { data: { PRIVATE_SCHEMA_SENTINEL: "PRIVATE_ROOT_SENTINEL" }, schema: PrivateSchema },
    UNSELECTED_NAME_SENTINEL: { data: { UNSELECTED_SCHEMA_SENTINEL: "UNSELECTED_ROOT_SENTINEL" }, schema: UnselectedSchema },
  });
  const server = create_locus_hosted_aggregate_socket_internal({ map,
    exposure: [
      { library: "visible", exposure: "client-public" },
      { library: "PRIVATE_NAME_SENTINEL", exposure: "server-private" },
      { library: "UNSELECTED_NAME_SENTINEL", exposure: "client-public" },
    ],
    defaultProjection: { libraries: ["visible"] },
    authorizeProjection: () => ({ libraries: ["visible"] }),
    ...(maxHistoryBytes === undefined ? {} : { maxHistoryBytes }),
    ...(afterRecoveryCut === undefined ? {} : { internal: { afterRecoveryCut } }),
  });
  return { map, server };
}

function socket_pair() {
  const serverListeners = new Set<(raw: string) => void>();
  const clientListeners = new Set<(raw: string) => void>();
  const serverSent: string[] = [];
  const clientSent: string[] = [];
  let transformServer: ((message: Record<string, unknown>) => Record<string, unknown>) | undefined;
  const client: LocusSocketLike = {
    send(raw) { clientSent.push(raw); for (const listener of [...serverListeners]) listener(raw); }, close() {},
    onMessage(listener) { clientListeners.add(listener); return () => { clientListeners.delete(listener); }; },
    onClose() { return () => {}; },
  };
  const server: LocusSocketLike = {
    send(raw) {
      serverSent.push(raw);
      const message = JSON.parse(raw) as Record<string, unknown>;
      const delivered = JSON.stringify(transformServer?.(message) ?? message);
      for (const listener of [...clientListeners]) listener(delivered);
    }, close() {},
    onMessage(listener) { serverListeners.add(listener); return () => { serverListeners.delete(listener); }; },
    onClose() { return () => {}; },
  };
  return { client, server, serverSent, clientSent,
    transformServer(next: (message: Record<string, unknown>) => Record<string, unknown>) { transformServer = next; } };
}

function messages(raw: readonly string[]) { return raw.map((entry) => JSON.parse(entry) as Record<string, unknown>); }
function hidden_absent(raw: string) {
  for (const sentinel of ["PRIVATE_NAME_SENTINEL", "PRIVATE_SCHEMA_SENTINEL", "PRIVATE_ROOT_SENTINEL",
    "UNSELECTED_NAME_SENTINEL", "UNSELECTED_SCHEMA_SENTINEL", "UNSELECTED_ROOT_SENTINEL"]) {
    assert.equal(raw.includes(sentinel), false, sentinel);
  }
  assert.equal(raw.includes("issuedQuids"), false);
  assert.equal(raw.includes("identityEpoch"), false);
}
function data_library(map: LiveMapLibraries | undefined, name: string) {
  const library = map?.lib(name);
  if (library === undefined || library.mode === "document") throw new Error("Expected data Library.");
  return library;
}

{
  const { map, server } = fixture();
  await server.mutate((draft) => { const library = draft.lib("PRIVATE_NAME_SENTINEL"); if ("at" in library) library.at(["PRIVATE_SCHEMA_SENTINEL"]).set("PRIVATE_REV_ONE"); });
  const pair = socket_pair();
  let detachServer = server.connect(pair.server);
  const client = create_echo_socket_client_internal({ socket: pair.client, logicalMapId: server.logicalMapId,
    localLibraries: { local: { data: { value: "LOCAL_BOOTSTRAP" }, schema: LocalSchema } } });
  const initial = await client.connect();
  assert.equal(initial.outcome, "snapshot");
  assert.equal(client.lastAppliedRev, 1);
  assert.equal(client.map?.rev, 0);
  assert.equal(data_library(client.map, "visible").snap(["value"]), "VISIBLE_BOOTSTRAP_SENTINEL");
  assert.equal(data_library(client.map, "local").snap(["value"]), "LOCAL_BOOTSTRAP");
  const initialSnapshot = pair.serverSent.find((raw) => JSON.parse(raw).type === "recovery-snapshot");
  assert.ok(initialSnapshot);
  assert.equal(JSON.parse(initialSnapshot).snapshot.format, "hson-authority-projection-snapshot-v1");
  assert.equal(JSON.parse(initialSnapshot).format, LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT);
  hidden_absent(initialSnapshot);
  const local = data_library(client.map, "local");
  const localHandle = local.at(["value"]);
  client.disconnect();
  detachServer();
  localHandle.set("LOCAL_DISCONNECTED");
  assert.equal(client.lastAppliedRev, 1);
  await server.mutate((draft) => { const library = draft.lib("visible"); if ("at" in library) library.at(["value"]).set("VISIBLE_REPLAY_SENTINEL"); });
  await server.mutate((draft) => { const library = draft.lib("PRIVATE_NAME_SENTINEL"); if ("at" in library) library.at(["PRIVATE_SCHEMA_SENTINEL"]).set("PRIVATE_REPLAY_SENTINEL"); });
  await server.mutate((draft) => { const library = draft.lib("UNSELECTED_NAME_SENTINEL"); if ("at" in library) library.at(["UNSELECTED_SCHEMA_SENTINEL"]).set("UNSELECTED_REPLAY_SENTINEL"); });
  detachServer = server.connect(pair.server);
  const recovered = await client.connect();
  assert.equal(recovered.outcome, "replay");
  assert.equal(client.lastAppliedRev, 4);
  assert.equal(data_library(client.map, "visible").snap(["value"]), "VISIBLE_REPLAY_SENTINEL");
  assert.equal(localHandle.snap(), "LOCAL_DISCONNECTED");
  assert.equal(client.map?.lib("local"), local);
  const replay = pair.serverSent.filter((raw) => ["recovery-commit", "recovery-progress"].includes(JSON.parse(raw).type));
  assert.deepEqual(replay.map((raw) => JSON.parse(raw).type), ["recovery-commit", "recovery-progress", "recovery-progress"]);
  assert.deepEqual(replay.map((raw) => { const message = JSON.parse(raw); return message.commit?.commit?.rev ?? message.progress?.rev; }), [2, 3, 4]);
  for (const raw of replay) hidden_absent(raw);
  assert.ok(replay[0]?.includes("VISIBLE_REPLAY_SENTINEL"));
  client.dispose();
  detachServer();
  server.dispose();
  void map;
}

{
  let afterCuts = 0;
  let mutateDuringCut: (() => Promise<void>) | undefined;
  const { server } = fixture(1, async () => {
    afterCuts += 1;
    if (afterCuts === 2) await mutateDuringCut?.();
  });
  mutateDuringCut = async () => {
    await server.mutate((draft) => {
      const visible = draft.lib("visible");
      const hidden = draft.lib("PRIVATE_NAME_SENTINEL");
      if ("at" in visible) visible.at(["value"]).set("VISIBLE_TAIL_SENTINEL");
      if ("at" in hidden) hidden.at(["PRIVATE_SCHEMA_SENTINEL"]).set("PRIVATE_TAIL_SENTINEL");
    });
  };
  const pair = socket_pair();
  let detachServer = server.connect(pair.server);
  const client = create_echo_socket_client_internal({ socket: pair.client, logicalMapId: server.logicalMapId,
    localLibraries: { local: { data: { value: "LOCAL_FALLBACK" }, schema: LocalSchema } } });
  await client.connect();
  const sameMap = client.map;
  const local = data_library(client.map, "local");
  const localHandle = local.at(["value"]);
  client.disconnect();
  detachServer();
  localHandle.set("LOCAL_DURING_FALLBACK");
  await server.mutate((draft) => { const library = draft.lib("visible"); if ("at" in library) library.at(["value"]).set("VISIBLE_FALLBACK_SENTINEL"); });
  await server.mutate((draft) => { const library = draft.lib("PRIVATE_NAME_SENTINEL"); if ("at" in library) library.at(["PRIVATE_SCHEMA_SENTINEL"]).set("PRIVATE_FALLBACK_SENTINEL"); });
  detachServer = server.connect(pair.server);
  const result = await client.connect();
  assert.equal(result.outcome, "snapshot");
  assert.equal(client.map, sameMap);
  assert.equal(client.lastAppliedRev, 3);
  assert.equal(localHandle.snap(), "LOCAL_DURING_FALLBACK");
  assert.equal(data_library(client.map, "visible").snap(["value"]), "VISIBLE_TAIL_SENTINEL");
  const fallbackFrames = pair.serverSent.filter((raw) => ["recovery-snapshot", "commit", "progress"].includes(JSON.parse(raw).type));
  assert.equal(fallbackFrames.filter((raw) => JSON.parse(raw).type === "recovery-snapshot").length, 2);
  const secondSnapshot = fallbackFrames.filter((raw) => JSON.parse(raw).type === "recovery-snapshot")[1]!;
  assert.equal(JSON.parse(secondSnapshot).snapshot.revision, 2);
  assert.ok(secondSnapshot.includes("VISIBLE_FALLBACK_SENTINEL"));
  const tail = fallbackFrames.find((raw) => JSON.parse(raw).type === "commit");
  assert.ok(tail);
  assert.equal(JSON.parse(tail).commit.commit.rev, 3);
  assert.ok(tail.includes("VISIBLE_TAIL_SENTINEL"));
  for (const raw of [secondSnapshot, tail]) hidden_absent(raw);
  client.dispose();
  detachServer();
  server.dispose();
}

{
  const map = hsonLiveMap.fromLibraries({
    PRIVATE_NAME_SENTINEL: { data: { PRIVATE_SCHEMA_SENTINEL: "PRIVATE_ROOT_SENTINEL" }, schema: PrivateSchema },
  });
  const server = create_locus_hosted_aggregate_socket_internal({ map,
    exposure: [{ library: "PRIVATE_NAME_SENTINEL", exposure: "server-private" }],
    defaultProjection: { libraries: [] },
  });
  const pair = socket_pair();
  let detachServer = server.connect(pair.server);
  const client = create_echo_socket_client_internal({ socket: pair.client, logicalMapId: server.logicalMapId });
  await client.connect();
  assert.equal(client.map, undefined);
  assert.equal(client.lastAppliedRev, 0);
  client.disconnect();
  detachServer();
  await server.mutate((draft) => { const library = draft.lib("PRIVATE_NAME_SENTINEL"); if ("at" in library) library.at(["PRIVATE_SCHEMA_SENTINEL"]).set("PRIVATE_ENDPOINT_SENTINEL"); });
  detachServer = server.connect(pair.server);
  const recovered = await client.connect();
  assert.equal(recovered.outcome, "replay");
  assert.equal(client.map, undefined);
  assert.equal(client.lastAppliedRev, 1);
  const progress = pair.serverSent.find((raw) => JSON.parse(raw).type === "recovery-progress");
  assert.ok(progress);
  hidden_absent(progress);
  client.dispose();
  detachServer();
  server.dispose();
}

{
  const map = hsonLiveMap.fromLibraries({
    PRIVATE_NAME_SENTINEL: { data: { PRIVATE_SCHEMA_SENTINEL: "PRIVATE_ROOT_SENTINEL" }, schema: PrivateSchema },
  });
  const server = create_locus_hosted_aggregate_socket_internal({ map,
    exposure: [{ library: "PRIVATE_NAME_SENTINEL", exposure: "server-private" }],
    defaultProjection: { libraries: [] }, maxHistoryBytes: 1 });
  const pair = socket_pair();
  let detach = server.connect(pair.server);
  const client = create_echo_socket_client_internal({ socket: pair.client, logicalMapId: server.logicalMapId,
    localLibraries: { local: { data: { value: "LOCAL_ONLY_INITIAL" }, schema: LocalSchema } } });
  await client.connect();
  const sameMap = client.map;
  const handle = data_library(sameMap, "local").at(["value"]);
  client.disconnect(); detach();
  handle.set("LOCAL_ONLY_DISCONNECTED");
  await server.mutate((draft) => {
    const hidden = draft.lib("PRIVATE_NAME_SENTINEL");
    if ("at" in hidden) hidden.at(["PRIVATE_SCHEMA_SENTINEL"]).set("PRIVATE_LOCAL_ONLY_SENTINEL");
  });
  detach = server.connect(pair.server);
  assert.equal((await client.connect()).outcome, "snapshot");
  assert.equal(client.map, sameMap);
  assert.equal(client.lastAppliedRev, 1);
  assert.equal(handle.snap(), "LOCAL_ONLY_DISCONNECTED");
  assert.equal(pair.serverSent.some((raw) => raw.includes("PRIVATE_LOCAL_ONLY_SENTINEL")), false);
  client.dispose(); detach(); server.dispose();
}

{
  const { server } = fixture();
  const pair = socket_pair();
  server.connect(pair.server);
  pair.client.send(JSON.stringify({ type: "session-create", id: "create-projection-mismatch" }));
  const initial = messages(pair.serverSent).find((message) => message.type === "session-created");
  assert.ok(initial);
  pair.client.send(JSON.stringify({ type: "recover", id: "initial-projection-mismatch", logicalMapId: server.logicalMapId }));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  const plan = messages(pair.serverSent).find((message) => message.type === "recovery-plan");
  assert.ok(plan);
  pair.client.send(JSON.stringify({ type: "recover", id: "bad-projection", logicalMapId: server.logicalMapId,
    incarnationId: plan.incarnationId, registryDigest: plan.registryDigest,
    projectionDigest: "a".repeat(64), lastAppliedRev: 0 }));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  const bad = messages(pair.serverSent).find((message) => message.type === "error" && message.code === "LOCUS_PROJECTION_UNAVAILABLE");
  assert.ok(bad);
  assert.equal(pair.serverSent.some((raw) => raw.includes("PRIVATE_NAME_SENTINEL")), false);
  server.dispose();
}

{
  const DocumentSchema: HsonSchema = Hson.schema`<type "document" tag "main" content "empty">`;
  const map = hsonLiveMap.fromLibraries({
    page: { document: "<main/>", schema: DocumentSchema },
    PRIVATE_NAME_SENTINEL: { document: "<main/>", schema: DocumentSchema },
  });
  enable_interactions(map);
  const server = create_locus_hosted_aggregate_socket_internal({ map,
    exposure: [{ library: "page", exposure: "client-public" },
      { library: "PRIVATE_NAME_SENTINEL", exposure: "server-private" }],
    defaultProjection: { libraries: ["page"], systemFeatures: ["interactions"] },
    authorizeProjection: () => ({ libraries: ["page"], systemFeatures: ["interactions"] }),
  });
  const pair = socket_pair();
  let detachServer = server.connect(pair.server);
  const client = create_echo_socket_client_internal({ socket: pair.client, logicalMapId: server.logicalMapId });
  await client.connect();
  client.disconnect();
  detachServer();
  const listener = Object.freeze({ event: "click", target: "element" as const, capture: false, once: false,
    passive: false, missingTarget: "ignore" as const, preventDefault: false, stopPropagation: false,
    stopImmediatePropagation: false });
  await server.mutate((draft) => {
    add_interaction(draft, { id: "visible", subject: { library: "page", path: [99] }, listener,
      kind: "browser-local", key: "VISIBLE_INTERACTION_REPLAY_SENTINEL", args: Hson.data.from(null) });
    add_interaction(draft, { id: "hidden", subject: { library: "PRIVATE_NAME_SENTINEL", path: [99] }, listener,
      kind: "browser-local", key: "PRIVATE_INTERACTION_REPLAY_SENTINEL", args: Hson.data.from(null) });
  });
  await server.mutate((draft) => {
    add_interaction(draft, { id: "hidden-again", subject: { library: "PRIVATE_NAME_SENTINEL", path: [98] }, listener,
      kind: "browser-local", key: "PRIVATE_INTERACTION_ONLY_SENTINEL", args: Hson.data.from(null) });
  });
  detachServer = server.connect(pair.server);
  const result = await client.connect();
  assert.equal(result.outcome, "replay");
  assert.equal(client.lastAppliedRev, 2);
  const replay = pair.serverSent.filter((raw) => ["recovery-commit", "recovery-progress"].includes(JSON.parse(raw).type));
  assert.deepEqual(replay.map((raw) => JSON.parse(raw).type), ["recovery-commit", "recovery-progress"]);
  assert.ok(replay[0]?.includes("VISIBLE_INTERACTION_REPLAY_SENTINEL"));
  for (const raw of replay) {
    assert.equal(raw.includes("PRIVATE_INTERACTION_REPLAY_SENTINEL"), false);
    assert.equal(raw.includes("PRIVATE_INTERACTION_ONLY_SENTINEL"), false);
    assert.equal(raw.includes("PRIVATE_NAME_SENTINEL"), false);
  }
  client.dispose();
  detachServer();
  server.dispose();
}

{
  const { server } = fixture(4_000);
  const pairs = [socket_pair(), socket_pair(), socket_pair()];
  let detach = pairs.map((pair) => server.connect(pair.server));
  const clients = pairs.map((pair, index) => create_echo_socket_client_internal({
    socket: pair.client, logicalMapId: server.logicalMapId,
    localLibraries: { local: { data: { value: `LOCAL_${index}` }, schema: LocalSchema } },
  }));
  await Promise.all(clients.map((client) => client.connect()));
  const [live, replay, fallback] = clients;
  if (live === undefined || replay === undefined || fallback === undefined) throw new Error("Expected three clients.");
  fallback.disconnect();
  detach[2]?.();
  data_library(fallback.map, "local").at(["value"]).set("LOCAL_FALLBACK_DIVERGENCE");
  await server.mutate((draft) => { const library = draft.lib("visible"); if ("at" in library) library.at(["value"]).set("VISIBLE_ONE"); });
  await server.mutate((draft) => { const library = draft.lib("PRIVATE_NAME_SENTINEL"); if ("at" in library) library.at(["PRIVATE_SCHEMA_SENTINEL"]).set("PRIVATE_LARGE_" + "x".repeat(6_000)); });
  replay.disconnect();
  detach[1]?.();
  data_library(replay.map, "local").at(["value"]).set("LOCAL_REPLAY_DIVERGENCE");
  data_library(live.map, "local").at(["value"]).set("LOCAL_LIVE_DIVERGENCE");
  await server.mutate((draft) => { const library = draft.lib("visible"); if ("at" in library) library.at(["value"]).set("VISIBLE_FINAL"); });
  detach[1] = server.connect(pairs[1]!.server);
  detach[2] = server.connect(pairs[2]!.server);
  const replayResult = await replay.connect();
  const fallbackResult = await fallback.connect();
  assert.equal(replayResult.outcome, "replay");
  assert.equal(fallbackResult.outcome, "snapshot");
  for (const client of clients) {
    assert.equal(client.lastAppliedRev, 3);
    assert.equal(data_library(client.map, "visible").snap(["value"]), "VISIBLE_FINAL");
  }
  assert.equal(data_library(live.map, "local").snap(["value"]), "LOCAL_LIVE_DIVERGENCE");
  assert.equal(data_library(replay.map, "local").snap(["value"]), "LOCAL_REPLAY_DIVERGENCE");
  assert.equal(data_library(fallback.map, "local").snap(["value"]), "LOCAL_FALLBACK_DIVERGENCE");
  for (const pair of pairs) for (const raw of pair.serverSent.filter((entry) => ["recovery-snapshot", "recovery-commit", "commit"].includes(JSON.parse(entry).type))) hidden_absent(raw);
  for (const client of clients) client.dispose();
  for (const stop of detach) stop();
  server.dispose();
}

{
  const PageSchema: HsonSchema = Hson.schema`<type "document" tag "main" content "empty">`;
  const map = hsonLiveMap.fromLibraries({
    page: { document: "<main/>", schema: PageSchema },
    PRIVATE_NAME_SENTINEL: { document: "<main/>", schema: PageSchema },
    privateData: { data: { value: "initial" }, schema: LocalSchema },
  });
  enable_interactions(map);
  const server = create_locus_hosted_aggregate_socket_internal({ map,
    exposure: [{ library: "page", exposure: "client-public" },
      { library: "PRIVATE_NAME_SENTINEL", exposure: "server-private" },
      { library: "privateData", exposure: "server-private" }],
    defaultProjection: { libraries: ["page"], systemFeatures: ["interactions"] },
    authorizeProjection: () => ({ libraries: ["page"], systemFeatures: ["interactions"] }),
    maxHistoryBytes: 200_000 });
  const listener = Object.freeze({ event: "click", target: "element" as const, capture: false, once: false,
    passive: false, missingTarget: "ignore" as const, preventDefault: false, stopPropagation: false,
    stopImmediatePropagation: false });
  const add = (draft: Parameters<Parameters<typeof server.mutate>[0]>[0], id: string, library: string, key: string) =>
    add_interaction(draft, { id, subject: { library, path: [99] }, listener,
      kind: "browser-local", key, args: Hson.data.from(null) });
  await server.mutate((draft) => {
    add(draft, "visible-start", "page", "VISIBLE_INTERACTION_BOOTSTRAP_SENTINEL");
    add(draft, "hidden-start", "PRIVATE_NAME_SENTINEL", "PRIVATE_INTERACTION_BOOTSTRAP_SENTINEL");
  });
  const pairs = [socket_pair(), socket_pair(), socket_pair()];
  const detach = pairs.map((pair) => server.connect(pair.server));
  const clients = pairs.map((pair) => create_echo_socket_client_internal({ socket: pair.client,
    logicalMapId: server.logicalMapId }));
  await Promise.all(clients.map((client) => client.connect()));
  const [live, replay, fallback] = clients;
  if (live === undefined || replay === undefined || fallback === undefined) throw new Error("Expected three interaction clients.");
  for (const pair of pairs) {
    const bootstrap = pair.serverSent.find((raw) => JSON.parse(raw).type === "recovery-snapshot");
    assert.ok(bootstrap?.includes("VISIBLE_INTERACTION_BOOTSTRAP_SENTINEL"));
    if (bootstrap === undefined) throw new Error("Missing interaction bootstrap.");
    assert.equal(bootstrap.includes("PRIVATE_INTERACTION_BOOTSTRAP_SENTINEL"), false);
  }
  fallback.disconnect(); detach[2]?.();
  await server.mutate((draft) => add(draft, "visible-second", "page", "VISIBLE_INTERACTION_SECOND_SENTINEL"));
  await server.mutate((draft) => {
    const privateData = draft.lib("privateData");
    if ("at" in privateData) privateData.at(["value"]).set("PRIVATE_EVICTION_SENTINEL" + "x".repeat(250_000));
  });
  replay.disconnect(); detach[1]?.();
  await server.mutate((draft) => add(draft, "visible-third", "page", "VISIBLE_INTERACTION_THIRD_SENTINEL"));
  await server.mutate((draft) => add(draft, "hidden-second", "PRIVATE_NAME_SENTINEL", "PRIVATE_INTERACTION_TAIL_SENTINEL"));
  server.connect(pairs[1]!.server);
  server.connect(pairs[2]!.server);
  assert.equal((await replay.connect()).outcome, "replay");
  assert.equal((await fallback.connect()).outcome, "snapshot");
  const projectedSystem = (client: typeof live) => {
    if (client.map === undefined) throw new Error("Missing composed interaction map.");
    const engine = internal_livemap_aggregate_authority(client.map);
    const state = engine.systemState(INTERACTION_RESERVED_LIBRARY_KEY);
    if (state === undefined) throw new Error("Missing projected interaction state.");
    return encode_hosted_root(engine.systemRoot(state)).payload;
  };
  assert.equal(live.lastAppliedRev, 5);
  assert.equal(replay.lastAppliedRev, 5);
  assert.equal(fallback.lastAppliedRev, 5);
  assert.equal(projectedSystem(replay), projectedSystem(live));
  assert.equal(projectedSystem(fallback), projectedSystem(live));
  assert.ok(projectedSystem(live).includes("VISIBLE_INTERACTION_THIRD_SENTINEL"));
  assert.equal(projectedSystem(live).includes("PRIVATE_INTERACTION_TAIL_SENTINEL"), false);
  const fallbackSnapshots = pairs[2]!.serverSent.filter((raw) => JSON.parse(raw).type === "recovery-snapshot");
  assert.equal(fallbackSnapshots.length, 2);
  for (const raw of [fallbackSnapshots[1]!, ...pairs[1]!.serverSent.filter((entry) =>
    ["recovery-commit", "recovery-progress"].includes(JSON.parse(entry).type))]) {
    assert.equal(raw.includes("PRIVATE_INTERACTION_BOOTSTRAP_SENTINEL"), false);
    assert.equal(raw.includes("PRIVATE_INTERACTION_TAIL_SENTINEL"), false);
    assert.equal(raw.includes("PRIVATE_EVICTION_SENTINEL"), false);
  }
  for (const client of clients) client.dispose();
  server.dispose();
}

for (const mode of ["snapshot", "replay"] as const) {
  const { server } = fixture(mode === "snapshot" ? 1 : undefined);
  const pair = socket_pair();
  let detachServer = server.connect(pair.server);
  const client = create_echo_socket_client_internal({ socket: pair.client, logicalMapId: server.logicalMapId,
    localLibraries: { local: { data: { value: "LOCAL_UNCHANGED" }, schema: LocalSchema } } });
  await client.connect();
  const sameMap = client.map;
  const original = data_library(client.map, "visible").snap(["value"]);
  client.disconnect();
  detachServer();
  await server.mutate((draft) => { const library = draft.lib("visible"); if ("at" in library) library.at(["value"]).set("VISIBLE_MALFORMED_SOURCE"); });
  pair.transformServer((message) => {
    if (mode === "snapshot" && message.type === "recovery-snapshot") {
      const snapshot = message.snapshot as Record<string, unknown>;
      return { ...message, snapshot: { ...snapshot, projectionDigest: "0".repeat(64) } };
    }
    if (mode === "replay" && message.type === "recovery-commit") {
      const envelope = message.commit as Record<string, unknown>;
      return { ...message, commit: { ...envelope, format: "retired-complete-recovery-format" } };
    }
    return message;
  });
  detachServer = server.connect(pair.server);
  await assert.rejects(client.connect());
  assert.equal(client.map, sameMap);
  assert.equal(client.lastAppliedRev, 0);
  assert.equal(data_library(client.map, "visible").snap(["value"]), original);
  assert.equal(data_library(client.map, "local").snap(["value"]), "LOCAL_UNCHANGED");
  client.dispose();
  detachServer();
  server.dispose();
}

{
  let cuts = 0;
  let createTail: (() => Promise<void>) | undefined;
  const { server } = fixture(1, async () => { cuts += 1; if (cuts === 2) await createTail?.(); });
  createTail = async () => {
    await server.mutate((draft) => {
      const visible = draft.lib("visible");
      if ("at" in visible) visible.at(["value"]).set("VISIBLE_TAIL_FAILURE_SENTINEL");
    });
  };
  const pair = socket_pair();
  let detach = server.connect(pair.server);
  const client = create_echo_socket_client_internal({ socket: pair.client, logicalMapId: server.logicalMapId });
  await client.connect();
  client.disconnect(); detach();
  await server.mutate((draft) => {
    const visible = draft.lib("visible");
    if ("at" in visible) visible.at(["value"]).set("VISIBLE_SNAPSHOT_BEFORE_BAD_TAIL");
  });
  pair.transformServer((message) => message.type === "commit"
    ? { ...message, commit: { ...(message.commit as Record<string, unknown>), format: "invalid-tail-format" } }
    : message);
  detach = server.connect(pair.server);
  const result = await client.connect();
  assert.equal(result.outcome, "snapshot");
  assert.equal(result.revision, 1);
  assert.equal(client.lastAppliedRev, 1);
  assert.equal(data_library(client.map, "visible").snap(["value"]), "VISIBLE_SNAPSHOT_BEFORE_BAD_TAIL");
  assert.equal(client.diagnostics().status, "failed");
  client.dispose(); detach(); server.dispose();
}

{
  install_fake_document();
  const PageSchema: HsonSchema = Hson.schema`<type "document" tag "main" content "empty">`;
  const PanelSchema: HsonSchema = Hson.schema`<type "document" tag "aside" content "empty">`;
  const map = hsonLiveMap.fromLibraries({ page: { document: "<main/>", schema: PageSchema } });
  const server = create_locus_hosted_aggregate_socket_internal({ map,
    exposure: [{ library: "page", exposure: "client-public" }],
    defaultProjection: { libraries: ["page"] }, authorizeProjection: () => ({ libraries: ["page"] }), maxHistoryBytes: 1 });
  const pair = socket_pair();
  let detach = server.connect(pair.server);
  const client = create_echo_socket_client_internal({ socket: pair.client,
    logicalMapId: server.logicalMapId,
    localLibraries: { panel: { document: "<aside/>", schema: PanelSchema } } });
  await client.connect();
  const sameMap = client.map;
  const page = sameMap?.lib("page");
  const panel = sameMap?.lib("panel");
  if (sameMap === undefined || page?.mode !== "document" || panel?.mode !== "document") throw new Error("Expected projected and local documents.");
  const pageMirror = hsonMirror(page);
  const panelMirror = hsonMirror(panel);
  const localTree = panelMirror.tree.node;
  const projectedHandle = acquire_livemap_document_identity(page.document, { kind: "path", path: [0] });
  const localHandle = acquire_livemap_document_identity(panel.document, { kind: "path", path: [0] });
  const projectedExact = page.capture({ identity: "same-epoch" });
  const engine = internal_livemap_aggregate_authority(sameMap);
  const projectedId = engine.libraries()[0]!;
  const localEpoch = livemap_identity_epoch_accounting(panel).epoch;
  const localQuid = panelMirror.tree.find.must.byTag("aside").quid;
  client.disconnect();
  detach();
  const completion = make_echo_document_authority(
    async () => Object.freeze({ accepted: true, completionRev: 1 }),
    () => client.lastAppliedRev ?? 0,
    (listener) => client.observeAuthorityPosition(listener),
    () => true,
    undefined,
    undefined,
    () => ({ logicalMapId: server.logicalMapId, incarnationId: client.incarnationId }),
  );
  let completionSettled = false;
  const pendingCompletion = completion.enqueue(() => Object.freeze({
    name: "document.attrs.clear" as const,
    payload: { target: { kind: "path" as const, path: validate_document_path([0]) } },
  }));
  void pendingCompletion.then(() => { completionSettled = true; });
  for (let turn = 0; turn < 8 && completion.pendingRevisionWaits() === 0; turn += 1) await Promise.resolve();
  assert.equal(completion.pendingRevisionWaits(), 1);
  panel.document.attrs.set({ kind: "path", path: [0] }, "title", "LOCAL_DOCUMENT_DISCONNECTED");
  assert.equal(completionSettled, false);
  await server.mutate((draft) => {
    const projected = draft.lib("page");
    if ("graph" in projected) projected.graph({ domain: "graph", op: "set-attr", target: { kind: "path", path: validate_document_path([0]) }, name: "title", value: "PROJECTED_DOCUMENT_FALLBACK" });
  });
  const localUpdates = panelMirror.diagnostics().updatesApplied;
  detach = server.connect(pair.server);
  const result = await client.connect();
  await pendingCompletion;
  assert.equal(completionSettled, true);
  assert.equal(result.outcome, "snapshot");
  assert.equal(client.map, sameMap);
  assert.equal(client.lastAppliedRev, 1);
  assert.equal(panel.document.attrs.get({ kind: "path", path: [0] }, "title"), "LOCAL_DOCUMENT_DISCONNECTED");
  assert.equal(page.document.attrs.get({ kind: "path", path: [0] }, "title"), "PROJECTED_DOCUMENT_FALLBACK");
  assert.equal(panelMirror.tree.node, localTree);
  assert.equal(panelMirror.diagnostics().updatesApplied, localUpdates);
  assert.equal(localHandle.active, true);
  assert.equal(panelMirror.tree.find.must.byTag("aside").quid, localQuid);
  assert.equal(projectedHandle.active, false);
  assert.equal(livemap_identity_epoch_accounting(panel).epoch, localEpoch);
  assert.throws(() => validate_livemap_document_admission(engine.identityEpoch(), projectedExact, "same-epoch",
    () => engine.documentCaptureContinuity(projectedId)), /earlier recovery continuity/i);
  assert.equal(pageMirror.tree.find.must.byTag("main").attrs.get("title"), "PROJECTED_DOCUMENT_FALLBACK");
  pageMirror.dispose();
  panelMirror.dispose();
  completion.dispose();
  client.dispose();
  detach();
  server.dispose();
}

{
  const PageSchema: HsonSchema = Hson.schema`<type "document" tag "main" content "empty">`;
  const PanelSchema: HsonSchema = Hson.schema`<type "document" tag "aside" content "empty">`;
  const map = hsonLiveMap.fromLibraries({
    page: { document: "<main/>", schema: PageSchema },
    PRIVATE_NAME_SENTINEL: { document: "<main/>", schema: PageSchema },
  });
  const server = create_locus_hosted_aggregate_socket_internal({ map,
    exposure: [{ library: "page", exposure: "client-public" },
      { library: "PRIVATE_NAME_SENTINEL", exposure: "server-private" }],
    defaultProjection: { libraries: ["page"] }, authorizeProjection: () => ({ libraries: ["page"] }) });
  const pair = socket_pair();
  let detach = server.connect(pair.server);
  const client = create_echo_socket_client_internal({ socket: pair.client,
    logicalMapId: server.logicalMapId,
    localLibraries: { panel: { document: "<aside/>", schema: PanelSchema } } });
  await client.connect();
  const page = client.map?.lib("page");
  const panel = client.map?.lib("panel");
  if (page?.mode !== "document" || panel?.mode !== "document") throw new Error("Expected two document Libraries.");
  const projectedMirror = hsonMirror(page);
  const localMirror = hsonMirror(panel);
  const localTree = localMirror.tree.node;
  const localQuid = localMirror.tree.find.must.byTag("aside").quid;
  client.disconnect(); detach();
  panel.document.attrs.set({ kind: "path", path: [0] }, "title", "LOCAL_DOCUMENT_REPLAY_SURVIVES");
  await server.mutate((draft) => {
    const projected = draft.lib("page");
    if ("graph" in projected) projected.graph({ domain: "graph", op: "set-attr",
      target: { kind: "path", path: validate_document_path([0]) }, name: "title", value: "PROJECTED_DOCUMENT_REPLAY" });
  });
  await server.mutate((draft) => {
    const hidden = draft.lib("PRIVATE_NAME_SENTINEL");
    if ("graph" in hidden) hidden.graph({ domain: "graph", op: "set-attr",
      target: { kind: "path", path: validate_document_path([0]) }, name: "title", value: "PRIVATE_DOCUMENT_REPLAY" });
  });
  const localUpdates = localMirror.diagnostics().updatesApplied;
  detach = server.connect(pair.server);
  assert.equal((await client.connect()).outcome, "replay");
  assert.equal(client.lastAppliedRev, 2);
  assert.equal(projectedMirror.tree.find.must.byTag("main").attrs.get("title"), "PROJECTED_DOCUMENT_REPLAY");
  assert.equal(localMirror.tree.find.must.byTag("aside").attrs.get("title"), "LOCAL_DOCUMENT_REPLAY_SURVIVES");
  assert.equal(localMirror.tree.node, localTree);
  assert.equal(localMirror.tree.find.must.byTag("aside").quid, localQuid);
  assert.equal(localMirror.diagnostics().updatesApplied, localUpdates);
  const replayFrames = pair.serverSent.filter((raw) => ["recovery-commit", "recovery-progress"].includes(JSON.parse(raw).type));
  assert.deepEqual(replayFrames.map((raw) => JSON.parse(raw).type), ["recovery-commit", "recovery-progress"]);
  for (const raw of replayFrames) assert.equal(raw.includes("PRIVATE_DOCUMENT_REPLAY"), false);
  projectedMirror.dispose(); localMirror.dispose(); client.dispose(); detach(); server.dispose();
}

{
  const { server } = fixture();
  const pair = socket_pair();
  server.connect(pair.server);
  pair.client.send(JSON.stringify({ type: "session-create", id: "create-revoked" }));
  const created = messages(pair.serverSent).find((message) => message.type === "session-created");
  assert.ok(created);
  assert.equal(server.sessions.revoke(created.sessionId as string), true);
  const before = pair.serverSent.length;
  pair.client.send(JSON.stringify({ type: "recover", id: "revoked-recovery", logicalMapId: server.logicalMapId }));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  assert.equal(pair.serverSent.slice(before).some((raw) => JSON.parse(raw).type === "recovery-snapshot"), false);
  server.dispose();
}

process.stdout.write("Step 6D projected bootstrap and retained replay acceptance passed.\n");
