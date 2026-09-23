// @hson-live-external-test
import assert from "node:assert/strict";
import { Hson, hsonLiveMap, hsonMirror, type HsonSchema } from "../src/index.ts";
import { create_echo_aggregate_replica_capability_internal } from "../src/api/echo/echo.aggregate-replica.lifecycle.ts";
import { create_multi_library_echo_socket_client_internal } from "../src/api/echo/echo.aggregate-replica.ts";
import { make_echo_document_authority } from "../src/api/echo/echo.document-authority.ts";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";
import { make_livemap_client_mirror_from_snapshot_internal, make_livemap_hosted_mirror_from_snapshot_internal } from "../src/api/livemap/livemap.libraries.ts";
import { make_hosted_commit, make_hosted_client_commit, make_hosted_client_snapshot, type HostedRegistryBinding } from "../src/api/livemap/livemap.hosted.ts";
import { validate_document_path } from "../src/api/livemap/livemap.document.path.ts";
import { LOCUS_HOSTED_AGGREGATE_WIRE_FORMAT, decode_locus_hosted_aggregate_envelope } from "../src/api/locus/locus.hosted-multi-library.ts";
import { LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT } from "../src/api/locus/locus.hosted-multi-library.protocol.ts";
import { create_locus_hosted_aggregate_socket_internal, derive_locus_hosted_progress_internal } from "../src/api/locus/locus.hosted-multi-library.socket.ts";
import type { LocusSocketLike } from "../src/types/locus.types.ts";
import type { LiveMapLibraries } from "../src/types/livemap.types.ts";
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

const DataSchema: HsonSchema = Hson.schema`<type "data" content <value "number">>`;
const PageSchema: HsonSchema = Hson.schema`<type "document" tag "main" content "empty">`;

function make_map() {
  return hsonLiveMap.fromLibraries({
    state: { data: { value: 0 }, schema: DataSchema },
    page: { document: "<main/>", schema: PageSchema },
  });
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

await check("ordinary local LiveMap cannot advance authority position", () => {
  const map = hsonLiveMap.fromJson({ value: 0 });
  assert.equal(Reflect.has(map, "advanceHostedProgress"), false);
  assert.equal(map.rev, 0);
  map.set(["value"], 1);
  assert.equal(map.rev, 1);
});

function socket_pair(): Readonly<{
  client: LocusSocketLike;
  server: LocusSocketLike;
  serverSent: string[];
  sendFromServer: (message: Readonly<Record<string, unknown>>) => void;
  replaceServerDelivery: (replace: (message: Readonly<Record<string, unknown>>) => readonly Readonly<Record<string, unknown>>[]) => void;
}> {
  const clientMessages = new Set<(raw: string) => void>();
  const serverMessages = new Set<(raw: string) => void>();
  const serverSent: string[] = [];
  let replacement: ((message: Readonly<Record<string, unknown>>) => readonly Readonly<Record<string, unknown>>[]) | undefined;
  const client: LocusSocketLike = Object.freeze({
    send(raw: string) { for (const listener of [...serverMessages]) listener(raw); },
    close() {},
    onMessage(listener: (raw: string) => void) { clientMessages.add(listener); return () => clientMessages.delete(listener); },
    onClose() { return () => {}; },
  });
  const server: LocusSocketLike = Object.freeze({
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

function committed_value(source: LiveMapLibraries, value: number) {
  const aggregate = internal_livemap_aggregate_authority(source);
  const library = aggregate.libraries()[0]!;
  const commit = aggregate.commit([{ target: aggregate.target(library, ["value"]), kind: "set", value }]).hosted;
  if (commit === undefined) throw new Error("Expected hosted graph commit.");
  const client = make_hosted_client_commit(commit);
  if (client === undefined) throw new Error("Expected client graph effect.");
  return Object.freeze({
    format: LOCUS_HOSTED_AGGREGATE_WIRE_FORMAT,
    logicalMapId: commit.authority.logicalMapId,
    incarnationId: commit.authority.incarnationId,
    registryDigest: commit.registryDigest,
    commit: client,
  });
}

await check("Echo processes commit, consecutive progress, commit as one contiguous authority stream", async () => {
  const authority = make_map();
  const source = internal_livemap_aggregate_authority(authority);
  for (let revision = 1; revision <= 9; revision += 1) {
    source.commit([{ target: source.target(source.libraries()[0]!, ["value"]), kind: "set", value: revision }]);
  }
  const snapshot = source.captureHosted();
  const server = create_locus_hosted_aggregate_socket_internal({ map: authority });
  const pair = socket_pair();
  server.connect(pair.server);
  const client = create_multi_library_echo_socket_client_internal({ socket: pair.client, logicalMapId: server.logicalMapId });
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
  pair.sendFromServer({ type: "commit", id, commit: committed_value(origin, 1) });
  assert.equal(map.rev, 10);
  assert.equal(state.snap(["value"]), 1);
  pair.sendFromServer({ type: "progress", id, progress: progress(snapshot, 10) });
  pair.sendFromServer({ type: "progress", id, progress: progress(snapshot, 11) });
  assert.equal(map.rev, 12);
  assert.equal(client.lastAppliedRev, 12);
  assert.equal(state.snap(["value"]), 1);
  assert.equal(commits, 1);
  const originReplica = create_echo_aggregate_replica_capability_internal(origin);
  originReplica.advanceHostedProgress(progress(snapshot, 10));
  originReplica.advanceHostedProgress(progress(snapshot, 11));
  originReplica.dispose();
  pair.sendFromServer({ type: "commit", id, commit: committed_value(origin, 2) });
  assert.equal(map.rev, 13);
  assert.equal(client.lastAppliedRev, 13);
  assert.equal(state.snap(["value"]), 2);
  assert.equal(commits, 2);
  assert.equal(mirror.sourceRevision, 13);
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
  const first = committed_value(source, 1);
  const sourceReplica = create_echo_aggregate_replica_capability_internal(source);
  sourceReplica.advanceHostedProgress(progress(snapshot, 1));
  sourceReplica.dispose();
  const third = committed_value(source, 2);
  const server = create_locus_hosted_aggregate_socket_internal({ map: authority });
  const pair = socket_pair();
  pair.replaceServerDelivery((message) => {
    if (message.type === "recovery-plan") {
      const id = message.id;
      return [
        Object.freeze({ ...message, outcome: "replay", headRev: 4 }),
        Object.freeze({ format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT, type: "recovery-commit", id, phase: "body", commit: first }),
        Object.freeze({ format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT, type: "recovery-progress", id, phase: "body", progress: progress(snapshot, 1) }),
        Object.freeze({ format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT, type: "recovery-commit", id, phase: "body", commit: third }),
        Object.freeze({ format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT, type: "recovery-progress", id, phase: "body", progress: progress(snapshot, 3) }),
      ];
    }
    if (message.type === "recovery-caught-up") return [Object.freeze({ ...message, throughRev: 4 })];
    return [message];
  });
  server.connect(pair.server);
  const map = make_livemap_hosted_mirror_from_snapshot_internal(snapshot);
  let commits = 0;
  map.commits.observe(() => { commits += 1; });
  const client = create_multi_library_echo_socket_client_internal({ socket: pair.client, map, logicalMapId: server.logicalMapId });
  const recovered = await client.connect();
  const state = map.lib("state");
  if (!("snap" in state)) throw new Error("Expected data Library.");
  assert.equal(recovered.outcome, "replay");
  assert.equal(recovered.revision, 4);
  assert.equal(client.lastAppliedRev, 4);
  assert.equal(map.rev, 4);
  assert.equal(state.snap(["value"]), 2);
  assert.equal(commits, 2);
  client.dispose();
  server.dispose();
});

await check("snapshot recovery drains buffered progress and graph tail through caught-up", async () => {
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
  const sixth = committed_value(source, 6);
  const server = create_locus_hosted_aggregate_socket_internal({ map: authority });
  const pair = socket_pair();
  pair.replaceServerDelivery((message) => {
    if (message.type === "recovery-snapshot") {
      const id = message.id;
      return [
        message,
        Object.freeze({ format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT, type: "recovery-progress", id, phase: "tail", progress: progress(snapshot, 4) }),
        Object.freeze({ format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT, type: "recovery-commit", id, phase: "tail", commit: sixth }),
        Object.freeze({ format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT, type: "recovery-progress", id, phase: "tail", progress: progress(snapshot, 6) }),
      ];
    }
    if (message.type === "recovery-caught-up") return [Object.freeze({ ...message, throughRev: 7 })];
    return [message];
  });
  server.connect(pair.server);
  const client = create_multi_library_echo_socket_client_internal({ socket: pair.client, logicalMapId: server.logicalMapId });
  const recovered = await client.connect();
  const map = client.map;
  if (map === undefined) throw new Error("Expected snapshot-installed Echo map.");
  const state = map.lib("state");
  if (!("snap" in state)) throw new Error("Expected data Library.");
  assert.equal(recovered.outcome, "snapshot");
  assert.equal(recovered.revision, 7);
  assert.equal(client.lastAppliedRev, 7);
  assert.equal(map.rev, 7);
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
    { name: "wrong previous revision", make: (base) => ({ ...base, prevRev: 3, rev: 4 }) },
    { name: "wrong logical map", make: (base) => ({ ...base, logicalMapId: "wrong" }) },
    { name: "wrong incarnation", make: (base) => ({ ...base, incarnationId: "wrong" }) },
    { name: "wrong registry", make: (base) => ({ ...base, registryDigest: "0".repeat(64) }) },
    { name: "stale duplicate", make: (base) => base, firstValid: true },
  ];
  for (const scenario of cases) {
    const authority = make_map();
    const snapshot = internal_livemap_aggregate_authority(authority).captureHosted();
    const server = create_locus_hosted_aggregate_socket_internal({ map: authority });
    const pair = socket_pair();
    server.connect(pair.server);
    const client = create_multi_library_echo_socket_client_internal({ socket: pair.client, logicalMapId: server.logicalMapId });
    await client.connect();
    const id = JSON.parse(pair.serverSent.find((raw) => JSON.parse(raw).type === "recovery-caught-up")!).id;
    const base = progress(snapshot, 0);
    if (scenario.firstValid === true) {
      pair.sendFromServer({ type: "progress", id, progress: base });
      assert.equal(client.map?.rev, 1);
    }
    pair.sendFromServer({ type: "progress", id, progress: scenario.make(base) });
    assert.equal(client.diagnostics().status, "failed", scenario.name);
    assert.equal(client.map?.rev, scenario.firstValid === true ? 1 : 0, scenario.name);
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
  const pending = documentAuthority.enqueue(() => Object.freeze({
    name: "document.attrs.clear" as const,
    payload: { target: { kind: "path" as const, path: [0] } },
  }));
  void pending.then(() => { settled = true; });
  for (let turn = 0; turn < 8 && documentAuthority.pendingRevisionWaits() === 0; turn += 1) await Promise.resolve();
  assert.equal(documentAuthority.pendingRevisionWaits(), 1);
  assert.equal(map.rev, 0); // The acknowledged completion revision is not a stream event.
  assert.equal(settled, false);
  replica.advanceHostedProgress(progress(snapshot, 0));
  const quid = mirror.tree.find.byTag("main")!.quid;
  assert.equal(page.document.byQuid(quid)?.$_tag, "main");
  assert.equal(map.rev, 1);
  assert.equal(settled, false);
  replica.advanceHostedProgress(progress(snapshot, 1));
  await pending;
  assert.equal(settled, true);
  assert.equal(documentAuthority.pendingRevisionWaits(), 0);
  assert.equal(map.rev, 2);
  assert.equal(page.document.byQuid(quid)?.$_tag, "main");
  mirror.dispose();
  documentAuthority.dispose();
  replica.dispose();
});

await check("legacy exact identity history derives generic client progress without rewriting authority history", () => {
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
    format: LOCUS_HOSTED_AGGREGATE_WIRE_FORMAT,
    logicalMapId: snapshot.authority.logicalMapId,
    incarnationId: snapshot.authority.incarnationId,
    registryDigest: snapshot.registryDigest,
    commit: historical,
  });
  const original = JSON.stringify(envelope);
  const decoded = decode_locus_hosted_aggregate_envelope(envelope, Object.freeze({
    logicalMapId: snapshot.authority.logicalMapId,
    incarnationId: snapshot.authority.incarnationId,
    registryDigest: snapshot.registryDigest,
  }));
  assert.equal(decoded.rev, 1);
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
  const client = make_hosted_client_commit(mixed);
  assert.equal(client?.rev, 1);
  assert.equal(client?.operations.length, 1);
  assert.equal(client?.operations[0]?.kind, "set");
  assert.equal(JSON.stringify(client).includes("000004b31"), false);
  if (client === undefined) throw new Error("Mixed authority commit lost its graph effect.");
  const mirror = make_livemap_client_mirror_from_snapshot_internal(make_hosted_client_snapshot(snapshot));
  const clientIdentityBefore = internal_livemap_aggregate_authority(mirror).captureHosted().identity;
  internal_livemap_aggregate_authority(mirror).replayClientHosted(client);
  const state = mirror.lib("state");
  if (!("snap" in state)) throw new Error("Expected projected state Library.");
  assert.equal(state.snap(["value"]), 1);
  assert.deepEqual(internal_livemap_aggregate_authority(mirror).captureHosted().identity, clientIdentityBefore);
});

process.stdout.write(`1..${checks}\n`);
events.terminal("pass");
