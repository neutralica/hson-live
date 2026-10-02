import { echo_map_internal } from "../src/internal/governor-maps.js";
import { authority_definition_from_fixture_options } from "./helpers/locus-definition-fixture.mts";
import { test_echo_transport } from "./helpers/echo-websocket-transport.mts";
import { bind_locus_websocket } from "../src/api/locus/locus.websocket.ts";
import { client_projection_map } from "./helpers/client-projection.mts";
import { test_public_projection } from "./helpers/hosted-catalog.mts";
// @hson-live-external-test
import assert from "node:assert/strict";
import { Hson, hsonEcho, hsonLiveMap, hsonLocus, hsonMirror, type HsonSchema } from "../src/index.ts";
import { create_echo_aggregate_replica_capability_internal } from "../src/api/echo/echo.aggregate-replica.lifecycle.ts";
import { create_echo_aggregate_client_internal } from "../src/api/echo/echo.aggregate-replica.ts";
import { make_echo_document_authority } from "../src/api/echo/echo.document-authority.ts";
import { echo_document_authority_for } from "../src/api/echo/echo.document-authority-registry.ts";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";
import { make_livemap_mirror_from_portable_aggregate_internal, make_livemap_hosted_mirror_from_snapshot_internal } from "../src/api/livemap/livemap.libraries.ts";
import { make_hosted_commit, make_portable_aggregate_commit, make_portable_aggregate_snapshot, type HostedRegistryBinding } from "../src/api/livemap/livemap.hosted.ts";
import { LOCUS_LIVE_PROJECTED_WIRE_FORMAT, project_locus_live_transition_internal } from "../src/api/locus/locus.live-projection.ts";
import { project_authority_snapshot, authority_projection_as_client_composition_internal } from "../src/api/locus/locus.authority-projection-snapshot.ts";
import { make_locus_hosted_projection_policy, normalize_locus_effective_projection } from "../src/api/locus/locus.projection.ts";
import { validate_document_path } from "../src/api/livemap/livemap.document.path.ts";
import { LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT } from "../src/api/locus/locus.aggregate.protocol.ts";
import { create_locus_hosted_aggregate_authority_internal, derive_locus_hosted_progress_internal } from "../src/api/locus/locus.aggregate.authority.ts";
import { create_registry_locus_internal } from "../src/api/locus/locus.registry.ts";
import { attach_locus_semantic_transport_internal } from "../src/api/locus/locus.transport.internal.ts";
import type { EchoAttachmentEvent, EchoCancellationSignal, EchoFiniteOperationRequest, EchoReplicaTransport,
  EchoSynchronizationObserver, EchoSynchronizationOutput, EchoSynchronizationRequest } from "../src/types/echo.transport.types.ts";
import type { LocusWebSocketLike } from "../src/types/locus.types.ts";
import type { LiveMap } from "../src/types/livemap.types.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "echo.authority-progress",
  title: "Managed Echo authority position without graph effects",
  category: "Echo",
  runtime: "node",
  tags: Object.freeze(["echo", "locus", "progress", "mirror", "revision"]),
});

const events = create_test_event_emitter("echo.authority-progress");
let checks = 0;
async function check(name: string, run: () => void | Promise<void>): Promise<void> {
  events.case_begin(name, name);
  try { await run(); events.case_end(name, "pass"); }
  catch (error) {
    events.diagnostic(name, "assertion", error instanceof Error ? error.message : String(error));
    events.case_end(name, "fail"); events.terminal("fail"); throw error;
  }
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

async function bounded<T>(promise: Promise<T>, milliseconds: number, message: () => string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message())), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

const DataSchema: HsonSchema = Hson.schema`<type "data" content <value "number">>`;
const PageSchema: HsonSchema = Hson.schema`<type "document" tag "main" content "empty">`;

function make_map() {
  return hsonLiveMap.fromLibraries({
    state: { data: { value: 0 }, schema: DataSchema },
    page: { document: "<main/>", schema: PageSchema },
  });
}

function effective_for(source: LiveMap) {
  const snapshot = internal_livemap_aggregate_authority(source).captureHosted();
  const configured = test_public_projection(source);
  const policy = make_locus_hosted_projection_policy(snapshot.registry, snapshot.authority,
    configured.libraries, configured.defaultProjection, configured.authorizeProjection);
  const effective = normalize_locus_effective_projection(policy, configured.defaultProjection);
  if (effective instanceof Promise) throw new Error("Expected synchronous test projection.");
  return effective;
}

function projection_fence(source: LiveMap) {
  return { projectionSequence: 0, projectionDigest: effective_for(source).digest };
}

function projected_client_map(source: LiveMap): LiveMap {
  return client_projection_map({ authority: project_authority_snapshot(
    internal_livemap_aggregate_authority(source).captureHosted(), effective_for(source)), local: {} });
}

function fixture() {
  const authority = make_map();
  const snapshot = internal_livemap_aggregate_authority(authority).captureHosted();
  const map = make_livemap_hosted_mirror_from_snapshot_internal(snapshot);
  const replica = create_echo_aggregate_replica_capability_internal(map);
  const aggregate = internal_livemap_aggregate_authority(map);
  const state = map.lib("state");
  const page = map.lib("page");
  if (!("snap" in state) || !("document" in page)) throw new Error("Expected hosted test Libraries.");
  return { authority, map, replica, aggregate, state, page, snapshot };
}

function progress(snapshot: ReturnType<ReturnType<typeof fixture>["aggregate"]["captureHosted"]>, prevRev: number) {
  return Object.freeze({
    logicalMapId: snapshot.authority.logicalMapId,
    incarnationId: snapshot.authority.incarnationId,
    registryDigest: snapshot.registryDigest,
    prevRev,
    rev: prevRev + 1,
  });
}

function live_progress(snapshot: ReturnType<ReturnType<typeof fixture>["aggregate"]["captureHosted"]>, prevRev: number) {
  return Object.freeze({ ...progress(snapshot, prevRev),
    registryDigest: authority_projection_as_client_composition_internal(project_authority_snapshot(snapshot,
      effective_for(make_livemap_hosted_mirror_from_snapshot_internal(snapshot)))).registryDigest });
}

await check("progress advances only managed authority position and Mirror bookkeeping", () => {
  const { map, replica, aggregate, state, page, snapshot } = fixture();
  const mirror = hsonMirror(page);
  const treeRoot = mirror.tree.node;
  const mirrorWork = mirror.diagnostics().updatesApplied;
  const beforeRoots = aggregate.captureHosted().libraries;
  const issued = aggregate.captureHosted().identity.issuedQuids;
  const beforeValue = state.snap(["value"]);
  let commits = 0;
  let values = 0;
  const positions: number[] = [];
  map.commits.observe(() => { commits += 1; });
  aggregate.watch(aggregate.libraries()[0]!, ["value"], () => { values += 1; });
  aggregate.observeAuthorityPosition((revision) => { positions.push(revision); });
  assert.equal(Reflect.has(map, "advanceHostedProgress"), false);
  assert.equal(Reflect.has(state, "advanceHostedProgress"), false);
  replica.advanceHostedProgress(progress(snapshot, 0));
  replica.advanceHostedProgress(progress(snapshot, 1));
  assert.equal(map.rev, 2);
  assert.deepEqual(positions, [1, 2]);
  assert.equal(commits, 0);
  assert.equal(values, 0);
  assert.equal(state.snap(["value"]), beforeValue);
  assert.deepEqual(aggregate.captureHosted().libraries, beforeRoots);
  assert.deepEqual(aggregate.captureHosted().identity.issuedQuids, issued);
  assert.equal(mirror.sourceRevision, 2);
  assert.equal(mirror.tree.node, treeRoot);
  assert.equal(mirror.diagnostics().updatesApplied, mirrorWork);
  assert.equal(mirror.status, "active");
  mirror.dispose();
  replica.dispose();
});

await check("progress requires the owner, contiguous revision, and exact authority fence", () => {
  const { map, replica, aggregate, snapshot } = fixture();
  const valid = progress(snapshot, 0);
  assert.throws(() => aggregate.advanceHostedProgressManaged(Object.freeze({}), valid));
  assert.equal(map.rev, 0);
  for (const invalid of [
    { ...valid, logicalMapId: "wrong" },
    { ...valid, incarnationId: "wrong" },
    { ...valid, registryDigest: "0".repeat(64) },
    { ...valid, prevRev: 1, rev: 2 },
    { ...valid, prevRev: 0, rev: 2 },
  ]) {
    assert.throws(() => replica.advanceHostedProgress(invalid));
    assert.equal(map.rev, 0);
  }
  replica.advanceHostedProgress(valid);
  assert.equal(map.rev, 1);
  assert.throws(() => replica.advanceHostedProgress(valid));
  assert.equal(map.rev, 1);
  replica.dispose();
});

await check("ordinary local registry LiveMap cannot advance authority position", () => {
  const map = hsonLiveMap.fromLibraries({ state: { data: { value: 0 }, schema: DataSchema } });
  assert.equal(Reflect.has(map, "advanceHostedProgress"), false);
  assert.equal(map.rev, 0);
  map.lib("state").at(["value"]).set(1);
  assert.equal(map.rev, 1);
});

function socket_pair(): Readonly<{
  client: LocusWebSocketLike;
  server: LocusWebSocketLike;
  serverSent: string[];
  sendFromServer: (message: Readonly<Record<string, unknown>>) => void;
  replaceServerDelivery: (replace: (message: Readonly<Record<string, unknown>>) => readonly Readonly<Record<string, unknown>>[]) => void;
}> {
  const clientMessages = new Set<(raw: string) => void>();
  const serverMessages = new Set<(raw: string) => void>();
  const serverSent: string[] = [];
  let replacement: ((message: Readonly<Record<string, unknown>>) => readonly Readonly<Record<string, unknown>>[]) | undefined;
  const client: LocusWebSocketLike = Object.freeze({
    send(raw: string) { for (const listener of [...serverMessages]) listener(raw); },
    close() {},
    onMessage(listener: (raw: string) => void) { clientMessages.add(listener); return () => clientMessages.delete(listener); },
    onClose() { return () => {}; },
  });
  const server: LocusWebSocketLike = Object.freeze({
    send(raw: string) {
      serverSent.push(raw);
      const parsed: Readonly<Record<string, unknown>> = JSON.parse(raw);
      for (const message of replacement?.(parsed) ?? [parsed]) {
        const delivered = JSON.stringify(message);
        for (const listener of [...clientMessages]) listener(delivered);
      }
    },
    close() {},
    onMessage(listener: (raw: string) => void) { serverMessages.add(listener); return () => serverMessages.delete(listener); },
    onClose() { return () => {}; },
  });
  return Object.freeze({
    client, server, serverSent,
    sendFromServer: (message: Readonly<Record<string, unknown>>) => server.send(JSON.stringify({ format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT, ...message })),
    replaceServerDelivery: (replace: (message: Readonly<Record<string, unknown>>) => readonly Readonly<Record<string, unknown>>[]) => { replacement = replace; },
  });
}

function live_committed_value(source: LiveMap, value: number) {
  const aggregate = internal_livemap_aggregate_authority(source);
  const library = aggregate.libraries()[0]!;
  const commit = aggregate.commit([{ target: aggregate.target(library, ["value"]), kind: "set", value }]).hosted;
  if (commit === undefined) throw new Error("Expected hosted graph commit.");
  const event = project_locus_live_transition_internal(commit, effective_for(source));
  if (event.kind !== "commit") throw new Error("Expected visible projected commit.");
  return Object.freeze({ format: LOCUS_LIVE_PROJECTED_WIRE_FORMAT,
    logicalMapId: commit.authority.logicalMapId, incarnationId: commit.authority.incarnationId,
    registryDigest: event.commit.registryDigest, commit: event.commit,
  });
}

await check("Echo processes commit, consecutive progress, commit as one contiguous authority stream", async () => {
  const authority = make_map();
  const source = internal_livemap_aggregate_authority(authority);
  for (let revision = 1; revision <= 9; revision += 1) {
    source.commit([{ target: source.target(source.libraries()[0]!, ["value"]), kind: "set", value: revision }]);
  }
  const snapshot = source.captureHosted();
  const server = create_locus_hosted_aggregate_authority_internal({ ...test_public_projection(authority), map: authority });
  const pair = socket_pair();
  bind_locus_websocket(server, pair.server);
  const client = create_echo_aggregate_client_internal({ transport: test_echo_transport(pair.client), logicalMapId: server.logicalMapId });
  const recovery = await client.connect();
  assert.equal(recovery.revision, 9);
  const map = client.map;
  if (map === undefined) throw new Error("Expected bootstrapped Echo map.");
  const state = map.lib("state");
  const page = map.lib("page");
  if (!("snap" in state) || !("document" in page)) throw new Error("Expected hosted test Libraries.");
  const mirror = hsonMirror(page);
  const id = JSON.parse(pair.serverSent.find((raw) => JSON.parse(raw).type === "recovery-caught-up")!).id;
  const origin = make_livemap_hosted_mirror_from_snapshot_internal(snapshot);
  const originAuthority = internal_livemap_aggregate_authority(origin);
  let commits = 0;
  map.commits.observe(() => { commits += 1; });
  pair.sendFromServer({ type: "commit", id, ...projection_fence(authority), commit: live_committed_value(origin, 1) });
  await Promise.resolve();
  assert.equal(map.rev, 1);
  assert.equal(state.snap(["value"]), 1);
  pair.sendFromServer({ type: "progress", id, ...projection_fence(authority), progress: live_progress(snapshot, 10) });
  pair.sendFromServer({ type: "progress", id, ...projection_fence(authority), progress: live_progress(snapshot, 11) });
  assert.equal(map.rev, 1);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(client.lastAppliedRev, 12);
  assert.equal(state.snap(["value"]), 1);
  assert.equal(commits, 1);
  const originReplica = create_echo_aggregate_replica_capability_internal(origin);
  originReplica.advanceHostedProgress(progress(snapshot, 10));
  originReplica.advanceHostedProgress(progress(snapshot, 11));
  originReplica.dispose();
  pair.sendFromServer({ type: "commit", id, ...projection_fence(authority), commit: live_committed_value(origin, 2) });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(map.rev, 2);
  assert.equal(client.lastAppliedRev, 13);
  assert.equal(state.snap(["value"]), 2);
  assert.equal(commits, 2);
  assert.equal(mirror.sourceRevision, 2);
  assert.equal(mirror.status, "active");
  mirror.dispose();
  client.dispose();
  server.dispose();
});

await check("replay history processes commit, progress, commit, final progress before caught-up", async () => {
  const authority = make_map();
  const snapshot = internal_livemap_aggregate_authority(authority).captureHosted();
  const source = make_livemap_hosted_mirror_from_snapshot_internal(snapshot);
  const sourceAuthority = internal_livemap_aggregate_authority(source);
  const first = live_committed_value(source, 1);
  const sourceReplica = create_echo_aggregate_replica_capability_internal(source);
  sourceReplica.advanceHostedProgress(progress(snapshot, 1));
  sourceReplica.dispose();
  const third = live_committed_value(source, 2);
  const server = create_locus_hosted_aggregate_authority_internal({ ...test_public_projection(authority), map: authority });
  const pair = socket_pair();
  pair.replaceServerDelivery((message) => {
    if (message.type === "recovery-plan") {
      const id = message.id;
      return [
        Object.freeze({ ...message, outcome: "replay", headRev: 4 }),
        Object.freeze({ format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT, type: "recovery-commit", id, phase: "body", ...projection_fence(authority), commit: first }),
        Object.freeze({ format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT, type: "recovery-progress", id, phase: "body", ...projection_fence(authority), progress: live_progress(snapshot, 1) }),
        Object.freeze({ format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT, type: "recovery-commit", id, phase: "body", ...projection_fence(authority), commit: third }),
        Object.freeze({ format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT, type: "recovery-progress", id, phase: "body", ...projection_fence(authority), progress: live_progress(snapshot, 3) }),
      ];
    }
    if (message.type === "recovery-caught-up") return [Object.freeze({ ...message, throughRev: 4 })];
    return [message];
  });
  bind_locus_websocket(server, pair.server);
  const map = projected_client_map(authority);
  let commits = 0;
  map.commits.observe(() => { commits += 1; });
  const client = create_echo_aggregate_client_internal({ transport: test_echo_transport(pair.client), map, logicalMapId: server.logicalMapId });
  const recovered = await client.connect();
  const state = map.lib("state");
  if (!("snap" in state)) throw new Error("Expected data Library.");
  assert.equal(recovered.outcome, "replay");
  assert.equal(recovered.revision, 4);
  assert.equal(client.lastAppliedRev, 4);
  assert.equal(map.rev, 2);
  assert.equal(state.snap(["value"]), 2);
  assert.equal(commits, 2);
  client.dispose();
  server.dispose();
});

await check("reconcile synchronization drains buffered progress and graph tail through caught-up", async () => {
  const authority = make_map();
  const aggregate = internal_livemap_aggregate_authority(authority);
  for (let revision = 1; revision <= 4; revision += 1) {
    aggregate.commit([{ target: aggregate.target(aggregate.libraries()[0]!, ["value"]), kind: "set", value: revision }]);
  }
  const snapshot = aggregate.captureHosted();
  const source = make_livemap_hosted_mirror_from_snapshot_internal(snapshot);
  const sourceReplica = create_echo_aggregate_replica_capability_internal(source);
  sourceReplica.advanceHostedProgress(progress(snapshot, 4));
  sourceReplica.dispose();
  const sixth = live_committed_value(source, 6);
  const server = create_locus_hosted_aggregate_authority_internal({ ...test_public_projection(authority), map: authority });
  const pair = socket_pair();
  pair.replaceServerDelivery((message) => {
    if (message.type === "recovery-snapshot") {
      const id = message.id;
      return [
        message,
        Object.freeze({ format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT, type: "recovery-progress", id, phase: "tail", ...projection_fence(authority), progress: live_progress(snapshot, 4) }),
        Object.freeze({ format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT, type: "recovery-commit", id, phase: "tail", ...projection_fence(authority), commit: sixth }),
        Object.freeze({ format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT, type: "recovery-progress", id, phase: "tail", ...projection_fence(authority), progress: live_progress(snapshot, 6) }),
      ];
    }
    if (message.type === "recovery-caught-up") return [Object.freeze({ ...message, throughRev: 7 })];
    return [message];
  });
  bind_locus_websocket(server, pair.server);
  const client = create_echo_aggregate_client_internal({ transport: test_echo_transport(pair.client), logicalMapId: server.logicalMapId });
  const recovered = await client.connect();
  const map = client.map;
  if (map === undefined) throw new Error("Expected snapshot-installed Echo map.");
  const state = map.lib("state");
  if (!("snap" in state)) throw new Error("Expected data Library.");
  assert.equal(recovered.outcome, "reconcile");
  assert.equal(recovered.revision, 7);
  assert.equal(client.lastAppliedRev, 7);
  assert.equal(map.rev, 1);
  assert.equal(state.snap(["value"]), 6);
  client.dispose();
  server.dispose();
});

await check("Echo rejects progress gaps, stale duplicates, and wrong authority fences", async () => {
  const cases: readonly Readonly<{
    name: string;
    make: (base: ReturnType<typeof progress>) => ReturnType<typeof progress>;
    firstValid?: true;
  }>[] = [
    { name: "gap", make: (base) => ({ ...base, prevRev: 1, rev: 2 }) },
    { name: "jump after current position", make: (base) => ({ ...base, rev: 2 }) },
    { name: "wrong previous revision", make: (base) => ({ ...base, prevRev: 3, rev: 4 }) },
    { name: "wrong logical map", make: (base) => ({ ...base, logicalMapId: "wrong" }) },
    { name: "wrong incarnation", make: (base) => ({ ...base, incarnationId: "wrong" }) },
    { name: "wrong registry", make: (base) => ({ ...base, registryDigest: "0".repeat(64) }) },
    { name: "stale duplicate", make: (base) => base, firstValid: true },
  ];
  for (const scenario of cases) {
    const authority = make_map();
    const snapshot = internal_livemap_aggregate_authority(authority).captureHosted();
    const server = create_locus_hosted_aggregate_authority_internal({ ...test_public_projection(authority), map: authority });
    const pair = socket_pair();
    bind_locus_websocket(server, pair.server);
    const client = create_echo_aggregate_client_internal({ transport: test_echo_transport(pair.client), logicalMapId: server.logicalMapId });
    await client.connect();
    const id = JSON.parse(pair.serverSent.find((raw) => JSON.parse(raw).type === "recovery-caught-up")!).id;
    const base = live_progress(snapshot, 0);
    if (scenario.firstValid === true) {
      pair.sendFromServer({ type: "progress", id, ...projection_fence(authority), progress: base });
      assert.equal(client.map?.rev, 0);
    }
    if (scenario.name === "jump after current position") {
      pair.sendFromServer({ type: "progress", id, ...projection_fence(authority), progress: scenario.make(base) });
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.notEqual(client.diagnostics().status, "live", "malformed frame interrupts the feed");
    } else {
      pair.sendFromServer({ type: "progress", id, ...projection_fence(authority), progress: scenario.make(base) });
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(client.diagnostics().status, "failed", scenario.name);
    }
    assert.equal(client.map?.rev, 0, scenario.name);
    client.dispose();
    server.dispose();
  }
});

await check("Echo rejects authority traffic stamped for another projection sequence or digest", async () => {
  for (const stale of [{ projectionSequence: 1 }, { projectionDigest: "0".repeat(64) }]) {
    const authority = make_map();
    const snapshot = internal_livemap_aggregate_authority(authority).captureHosted();
    const server = create_locus_hosted_aggregate_authority_internal({ ...test_public_projection(authority), map: authority });
    const pair = socket_pair();
    bind_locus_websocket(server, pair.server);
    const client = create_echo_aggregate_client_internal({ transport: test_echo_transport(pair.client), logicalMapId: server.logicalMapId });
    await client.connect();
    const id = JSON.parse(pair.serverSent.find((raw) => JSON.parse(raw).type === "recovery-caught-up")!).id;
    const before = client.lastAppliedRev;
    pair.sendFromServer({ type: "progress", id, ...projection_fence(authority), ...stale,
      progress: live_progress(snapshot, before ?? 0) });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(client.diagnostics().status, "failed");
    assert.equal(client.lastAppliedRev, before);
    client.dispose();
    server.dispose();
  }
});

await check("completionRev waits through ordered progress while local identity stays independent", async () => {
  const { map, replica, aggregate, page, snapshot } = fixture();
  const mirror = hsonMirror(page);
  const documentAuthority = make_echo_document_authority(
    async () => Object.freeze({ accepted: true, completionRev: 2 }),
    () => map.rev,
    (listener) => aggregate.observeAuthorityPosition(listener),
    () => true,
    replica.onDispose,
    replica.waitUntilReady,
    () => ({ logicalMapId: snapshot.authority.logicalMapId, incarnationId: snapshot.authority.incarnationId }),
    replica.onStateChange,
    () => replica.failure,
  );
  let settled = false;
  let settlements = 0;
  const pending = documentAuthority.enqueue(() => Object.freeze({
    name: "document.attrs.clear" as const,
    payload: { target: { kind: "path" as const, path: [0] } },
  }));
  void pending.then(() => { settled = true; settlements += 1; });
  for (let turn = 0; turn < 8 && documentAuthority.pendingRevisionWaits() === 0; turn += 1) await Promise.resolve();
  assert.equal(documentAuthority.pendingRevisionWaits(), 1);
  assert.equal(map.rev, 0); // The acknowledged completion revision is not a stream event.
  assert.equal(settled, false);
  replica.markRecovering(); // Lost feed does not revoke an admitted completionRev wait.
  assert.equal(documentAuthority.pendingRevisionWaits(), 1);
  assert.equal(settled, false);
  replica.advanceHostedProgress(progress(snapshot, 0));
  const quid = mirror.tree.find.byTag("main")!.quid;
  assert.equal(page.document.byQuid(quid)?.$_tag, "main");
  assert.equal(map.rev, 1);
  assert.equal(settled, false);
  replica.markReady();
  replica.advanceHostedProgress(progress(snapshot, 1));
  await pending;
  assert.equal(settled, true);
  assert.equal(settlements, 1);
  assert.equal(documentAuthority.pendingRevisionWaits(), 0);
  assert.equal(map.rev, 2);
  assert.equal(page.document.byQuid(quid)?.$_tag, "main");
  mirror.dispose();
  documentAuthority.dispose();
  replica.dispose();
});

for (const strategy of ["replay", "reconcile"] as const) {
  await check(`admitted document completionRev survives semantic interruption and ${strategy}`, async () => {
    const authority = make_map();
    const options = { ...test_public_projection(authority), map: authority };
    const locus = strategy === "reconcile"
      ? create_registry_locus_internal(options, { maxHistoryBytes: 1 }).locus
      : hsonLocus.create(authority_definition_from_fixture_options(options));
    const session = await locus.session.create({ libraries: ["state", "page"] });
    const notices = new Set<(event: EchoAttachmentEvent) => void>();
    const attachment = attach_locus_semantic_transport_internal(locus, {
      notice(event) {
        if (event.type === "session-fenced") for (const listener of notices) listener({ kind: "fenced", sessionId: event.sessionId, epoch: event.epoch });
      },
    });
    const plans: string[] = [];
    let holdLive = false;
    let heldLive = 0;
    let dispatches = 0;
    let actionRequest: Extract<EchoFiniteOperationRequest, { type: "action" }> | undefined;
    let releaseRecovery: () => void = () => {};
    const recoveryGate = new Promise<void>((resolve) => { releaseRecovery = resolve; });
    let pauseRecovery = false;
    let current: { interrupt(): void } | undefined;
    const transport: EchoReplicaTransport = Object.freeze({
      operations: Object.freeze({ async submit(request: EchoFiniteOperationRequest) {
        if (request.type === "action" && request.name === "document.attrs.set") {
          dispatches += 1;
          actionRequest = request;
        }
        try { return Object.freeze({ kind: "response" as const, outcome: await attachment.operations.submit(request) }); }
        catch (cause) { return Object.freeze({ kind: "uncertain" as const, cause }); }
      } }),
      attachment: Object.freeze({ observe(listener: (event: EchoAttachmentEvent) => void) {
        notices.add(listener); listener({ kind: "available" }); return () => { notices.delete(listener); };
      } }),
      synchronization: Object.freeze({ async open(request: EchoSynchronizationRequest, observer: EchoSynchronizationObserver,
        options?: Readonly<{ signal?: EchoCancellationSignal }>) {
        if (options?.signal?.aborted) throw new Error("Synchronization opening aborted.");
        if (pauseRecovery && plans.length > 0) await recoveryGate;
        let ended = false;
        const onOutput = (output: EchoSynchronizationOutput): void | Promise<void> => {
          if (ended) return;
          if (output.type === "recovery-plan") plans.push(output.outcome);
          if (holdLive && output.type === "commit") { heldLive += 1; return; }
          return observer.onOutput(output);
        };
        const stop = attachment.synchronization.open(request, onOutput, (cause) => {
          if (ended) return;
          ended = true;
          observer.onEnd({ kind: cause === undefined ? "cancelled" : "interrupted", cause });
        });
        const feed = { interrupt() {
          if (ended) return;
          ended = true;
          observer.onEnd({ kind: "interrupted" });
          stop();
        } };
        current = feed;
        return Object.freeze({ cancel() { if (ended) return; ended = true; stop(); observer.onEnd({ kind: "cancelled" }); } });
      } }),
    });
    const echo = await bounded(hsonEcho.create({ now: session.now(), credential: session.credential!, transport }), 1_000,
      () => `Replica establishment stalled: ${JSON.stringify({ plans, binding: attachment.binding.attached })}`);
    const documentAuthority = echo_document_authority_for(echo_map_internal(echo).lib("page"));
    assert.ok(documentAuthority);
    holdLive = true;
    const pending = documentAuthority.enqueue(() => Object.freeze({ name: "document.attrs.set" as const,
      payload: { target: { kind: "path" as const, path: [0] }, name: "title", value: "restored" } }));
    let settlements = 0;
    void pending.then(() => { settlements += 1; }, () => { settlements += 1; });
    for (let turn = 0; turn < 100 && (heldLive === 0 || documentAuthority.pendingRevisionWaits() === 0); turn++) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    assert.equal(heldLive, 1);
    assert.equal(documentAuthority.pendingRevisionWaits(), 1);
    assert.equal(settlements, 0);
    holdLive = false;
    pauseRecovery = true;
    current?.interrupt();
    assert.notEqual(echo.sync.status, "caught_up");
    assert.ok(actionRequest);
    const firstAttempt = actionRequest.attemptId;
    assert.equal((await echo.actionStatus(actionRequest.requestId!)).state, "succeeded");
    const retry = await echo.retryAction({ requestId: actionRequest.requestId!, name: actionRequest.name,
      ...(actionRequest.payload === undefined ? {} : { payload: actionRequest.payload }) });
    assert.equal(retry.type, "ack");
    assert.notEqual(actionRequest.attemptId, firstAttempt);
    await assert.rejects(echo.action("document.attrs.set", {
      library: "page", target: { kind: "path", path: [0] }, name: "title", value: "new-work",
    }), /disconnect|unavailable/i);
    releaseRecovery();
    for (let turn = 0; turn < 100 && echo.sync.status !== "caught_up"; turn++) await new Promise((resolve) => setTimeout(resolve, 1));
    await bounded(pending, 2_000,
      () => `Completion stalled: ${JSON.stringify({ plans, status: echo.sync.status, rev: echo.sync.appliedRev, waits: documentAuthority.pendingRevisionWaits() })}`);
    assert.equal(plans.at(-1), strategy);
    assert.equal(settlements, 1);
    assert.equal(dispatches, 2, "retry uses the existing logical request");
    assert.equal(locus.rev, 1);
    assert.equal(echo.sync.appliedRev, 1);
    echo.dispose(); attachment.close(); locus.dispose();
  });
}

await check("exact identity history derives generic client progress without rewriting authority history", () => {
  const authority = make_map();
  const aggregate = internal_livemap_aggregate_authority(authority);
  const snapshot = aggregate.captureHosted();
  const identities = aggregate.libraries();
  const pageIdentity = identities[1]!;
  const bindings = new Map<object, HostedRegistryBinding>([
    [identities[0]!, Object.freeze({ name: "state", identity: identities[0]!, mode: "data-object", schema: DataSchema })],
    [pageIdentity, Object.freeze({ name: "page", identity: pageIdentity, mode: "document", schema: PageSchema })],
  ]);
  const historical = make_hosted_commit(snapshot.authority, aggregate.hostedRegistry(), bindings, Object.freeze({
    changed: true,
    prevRev: 0,
    rev: 1,
    operations: Object.freeze([Object.freeze({
      target: Object.freeze({ library: pageIdentity }),
      operation: Object.freeze({
        domain: "graph" as const,
        op: "ensure-quid" as const,
        target: Object.freeze({ kind: "path" as const, path: validate_document_path([0]) }),
        quid: "000004b31",
      }),
    })]),
  }));
  const envelope = Object.freeze({
    logicalMapId: snapshot.authority.logicalMapId,
    incarnationId: snapshot.authority.incarnationId,
    registryDigest: snapshot.registryDigest,
    commit: historical,
  });
  const original = JSON.stringify(envelope);
  assert.deepEqual(derive_locus_hosted_progress_internal(envelope), progress(snapshot, 0));
  assert.equal(JSON.stringify(envelope), original);
  assert.equal(JSON.stringify(derive_locus_hosted_progress_internal(envelope)).includes("quid"), false);

  const mixed = make_hosted_commit(snapshot.authority, aggregate.hostedRegistry(), bindings, Object.freeze({
    changed: true,
    prevRev: 0,
    rev: 1,
    operations: Object.freeze([
      Object.freeze({
        target: aggregate.target(identities[0]!, ["value"]),
        operation: Object.freeze({ kind: "set" as const, path: Object.freeze(["value"]), prev: 0, next: 1 }),
      }),
      Object.freeze({
        target: Object.freeze({ library: pageIdentity }),
        operation: Object.freeze({
          domain: "graph" as const,
          op: "ensure-quid" as const,
          target: Object.freeze({ kind: "path" as const, path: validate_document_path([0]) }),
          quid: "000004b31",
        }),
      }),
    ]),
  }));
  const client = make_portable_aggregate_commit(mixed);
  assert.equal(client?.rev, 1);
  assert.equal(client?.operations.length, 1);
  assert.equal(client?.operations[0]?.kind, "set");
  assert.equal(JSON.stringify(client).includes("000004b31"), false);
  if (client === undefined) throw new Error("Mixed authority commit lost its graph effect.");
  const mirror = make_livemap_mirror_from_portable_aggregate_internal(make_portable_aggregate_snapshot(snapshot));
  const clientIdentityBefore = internal_livemap_aggregate_authority(mirror).captureHosted().identity;
  internal_livemap_aggregate_authority(mirror).replayClientHosted(client);
  const state = mirror.lib("state");
  if (!("snap" in state)) throw new Error("Expected projected state Library.");
  assert.equal(state.snap(["value"]), 1);
  assert.deepEqual(internal_livemap_aggregate_authority(mirror).captureHosted().identity, clientIdentityBefore);
});

process.stdout.write(`1..${checks}\n`);
events.terminal("pass");
