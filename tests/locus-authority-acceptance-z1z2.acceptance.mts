import assert from "node:assert/strict";
import { Hson, hsonLiveMap, type HsonSchema } from "../src/index.ts";
import { create_persistent_multi_library_locus } from "../src/api/locus/locus.multi-library.persistence.ts";
import { create_locus_hosted_aggregate_socket_internal } from "../src/api/locus/locus.hosted-multi-library.socket.ts";
import type { LocusHostedAggregateDraft } from "../src/api/locus/locus.hosted-multi-library.ts";
import { create_persistent_locus_hosted_aggregate_internal } from "../src/api/locus/locus.hosted-multi-library.persistence.ts";
import { LocusPersistenceAppendUncertainError } from "../src/api/locus/locus.persistence.error.ts";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";
import { encode_locus_client_message } from "../src/api/locus/locus.protocol.ts";
import type { LocusSocketLike } from "../src/types/locus.types.ts";
import { MemoryCheckpointAdapter } from "./helpers/memory-checkpoint-adapter.mts";
import type { LocusHostedAggregatePersistedCommit } from "../src/api/locus/locus.hosted-multi-library.persistence.ts";

const schema: HsonSchema = Hson.schema`<type "data" content <value "string">>`;
function make_map() {
  return hsonLiveMap.fromLibraries({
    A: { data: { value: "A0" }, schema },
    B: { data: { value: "B0" }, schema },
  });
}
const exposure = [
  { library: "A", exposure: "client-public" as const },
  { library: "B", exposure: "client-public" as const },
];
function set_value(draft: LocusHostedAggregateDraft, name: "A" | "B", value: string) {
  const library = draft.lib(name);
  if (!("at" in library)) throw new Error("Expected data Library.");
  library.at(["value"]).set(value);
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
class MemoryPersistence extends MemoryCheckpointAdapter {
  mode: "normal" | "clean" | "uncertain" = "normal";
  pendingAppend: ReturnType<typeof deferred> | undefined;
  enteredAppend: ReturnType<typeof deferred> | undefined;

  deferNextAppend() {
    const entered = deferred();
    const release = deferred();
    this.enteredAppend = entered;
    this.pendingAppend = release;
    return { entered: entered.promise, release: release.resolve };
  }
  override async appendCommit(record: LocusHostedAggregatePersistedCommit): Promise<void> {
    this.enteredAppend?.resolve();
    const pending = this.pendingAppend;
    this.pendingAppend = undefined;
    this.enteredAppend = undefined;
    if (pending) await pending.promise;
    if (this.mode === "clean") { this.mode = "normal"; throw new Error("clean append rejection"); }
    await super.appendCommit(record);
    if (this.mode === "uncertain") {
      this.mode = "normal";
      throw new LocusPersistenceAppendUncertainError();
    }
  }
  get commits(): readonly unknown[] { return this.states.values().next().value?.commits ?? []; }
}
function pair() {
  const toServer = new Set<(raw: string) => void>();
  const toClient = new Set<(raw: string) => void>();
  const received: Record<string, unknown>[] = [];
  const client: LocusSocketLike = {
    send(raw) { for (const listener of toServer) listener(raw); }, close() {},
    onMessage(listener) { toClient.add(listener); return () => { toClient.delete(listener); }; },
    onClose() { return () => {}; },
  };
  const socket: LocusSocketLike = {
    send(raw) { received.push(JSON.parse(raw)); for (const listener of toClient) listener(raw); }, close() {},
    onMessage(listener) { toServer.add(listener); return () => { toServer.delete(listener); }; },
    onClose() { return () => {}; },
  };
  return { client, socket, received };
}
async function settle() { await new Promise<void>((resolve) => setTimeout(resolve, 0)); }
function messages(connection: ReturnType<typeof pair>, type: string) {
  return connection.received.filter((message) => message.type === type);
}
async function session(server: { connect: (socket: LocusSocketLike) => () => void; logicalMapId: string }, selected: "A" | "B", recover = true) {
  const connection = pair();
  const close = server.connect(connection.socket);
  connection.client.send(encode_locus_client_message({ type: "session-create", id: `create-${selected}`, projection: { libraries: [selected] } }));
  await settle();
  const created = messages(connection, "session-created")[0];
  assert.ok(created);
  if (recover) {
    connection.client.send(JSON.stringify({ type: "recover", id: `recover-${selected}`, logicalMapId: server.logicalMapId }));
    await settle();
    assert.equal(messages(connection, "recovery-caught-up").length, 1);
  }
  return { ...connection, close, credential: created.credential };
}

// One oversized visible projection rejects a persistent, multi-session
// candidate before append, even when another session's projection is small.
{
  const persistence = new MemoryPersistence();
  const map = make_map();
  const host = await create_persistent_multi_library_locus({ map, exposure,
    defaultProjection: { libraries: ["A"] }, authorizeProjection: ({ requested }) => requested,
    logicalMapId: "z1z2-persistent-rejection", persistence });
  let installed = 0;
  internal_livemap_aggregate_authority(map).observe(() => { installed += 1; });
  const a = await session(host, "A");
  const b = await session(host, "B");
  const huge = "X".repeat(4_500_000);
  await assert.rejects(host.mutate((draft) => {
    draft.lib("A").at(["value"]).set(huge);
    draft.lib("B").at(["value"]).set("B-small");
  }), /byte limit/i);
  assert.equal(map.rev, 0);
  assert.equal(installed, 0);
  assert.equal(persistence.appendCalls.length, 0);
  assert.equal(persistence.commits.length, 0);
  for (const connection of [a, b]) {
    assert.equal(messages(connection, "commit").length, 0);
    assert.equal(messages(connection, "progress").length, 0);
  }
  await host.mutate((draft) => {
    draft.lib("A").at(["value"]).set("A-small");
    draft.lib("B").at(["value"]).set("B-small");
  });
  assert.equal(map.rev, 1);
  assert.equal(installed, 1);
  assert.equal(persistence.appendCalls.length, 1);
  assert.equal(persistence.commits.length, 1);
  assert.equal(messages(a, "commit").length, 1);
  assert.equal(messages(b, "commit").length, 1);
  host.dispose();
  const restoredMap = make_map();
  const restored = await create_persistent_multi_library_locus({ map: restoredMap, exposure,
    logicalMapId: "z1z2-persistent-rejection", persistence });
  assert.equal(restored.rev, 1);
  assert.equal(restoredMap.lib("A").snap(["value"]), "A-small");
  assert.equal(restoredMap.lib("B").snap(["value"]), "B-small");
  assert.equal(persistence.commits.length, 1);
  restored.dispose();
}

// Clean rejection leaves no durable/runtime effect and permits a later append.
{
  const persistence = new MemoryPersistence();
  const map = make_map();
  const host = await create_persistent_multi_library_locus({ map, exposure,
    logicalMapId: "z1z2-clean-append", persistence });
  persistence.mode = "clean";
  await assert.rejects(host.mutate((draft) => draft.lib("A").at(["value"]).set("A1")), /durably append/i);
  assert.equal(map.rev, 0);
  assert.equal(persistence.commits.length, 0);
  await host.mutate((draft) => draft.lib("A").at(["value"]).set("A2"));
  assert.equal(map.rev, 1);
  assert.equal(persistence.commits.length, 1);
  host.dispose();
}

// A write-then-uncertain error fences the old runtime; restoration observes
// the single durable revision and no blind retry duplicates its record.
{
  const persistence = new MemoryPersistence();
  const map = make_map();
  const host = await create_persistent_multi_library_locus({ map, exposure,
    logicalMapId: "z1z2-uncertain-append", persistence });
  persistence.mode = "uncertain";
  await assert.rejects(host.mutate((draft) => draft.lib("A").at(["value"]).set("A1")), /durably append/i);
  assert.equal(map.rev, 0);
  assert.equal(persistence.commits.length, 1);
  await assert.rejects(host.mutate((draft) => draft.lib("A").at(["value"]).set("A2")), /faulted/i);
  assert.equal(persistence.appendCalls.length, 1);
  host.dispose();
  const restored = await create_persistent_multi_library_locus({ map: make_map(), exposure,
    logicalMapId: "z1z2-uncertain-append", persistence });
  assert.equal(restored.rev, 1);
  assert.equal(restored.map.lib("A").snap(["value"]), "A1");
  restored.dispose();
}

// A resumably disconnected session remains in the preaccept roster.
{
  const map = make_map();
  const server = create_locus_hosted_aggregate_socket_internal({ map, exposure,
    authorizeProjection: ({ requested }) => requested, maxWireBytes: 30_000 });
  const disconnected = await session(server, "A");
  disconnected.close();
  assert.equal(server.sessions.debug().disconnectedSessionCount, 1);
  await assert.rejects(server.mutate((draft) => set_value(draft, "A", "X".repeat(40_000))), /byte limit/i);
  assert.equal(server.rev, 0);
  assert.equal(server.debug().retainedCommits, 0);
  const attached = pair();
  server.connect(attached.socket);
  attached.client.send(encode_locus_client_message({ type: "session-attach", id: "reattach-A", credential: disconnected.credential }));
  await settle();
  assert.equal(messages(attached, "session-attached").length, 1);
  attached.client.send(JSON.stringify({ type: "recover", id: "recovery-A", logicalMapId: server.logicalMapId }));
  await settle();
  assert.equal(messages(attached, "recovery-caught-up").length, 1);
  assert.equal(messages(attached, "error").some((message) => message.code === "LOCUS_RECOVERY_FAILED"), false);
  await server.mutate((draft) => set_value(draft, "A", "A-small"));
  assert.equal(server.rev, 1);
  server.dispose();
}

// Revocation before the roster cut removes the session's future obligation.
{
  const map = make_map();
  const server = create_locus_hosted_aggregate_socket_internal({ map, exposure,
    authorizeProjection: ({ requested }) => requested, maxWireBytes: 30_000 });
  const revoked = await session(server, "A");
  const sessionId = messages(revoked, "session-created")[0]?.sessionId;
  if (typeof sessionId !== "string") throw new Error("Expected session ID.");
  assert.equal(server.sessions.revoke(sessionId), true);
  await server.mutate((draft) => set_value(draft, "A", "X".repeat(40_000)));
  assert.equal(server.rev, 1);
  server.dispose();
}

// The recovery ID bound is enforced at ingress, including a direct recovery
// request that would otherwise leave an unprovable future wrapper size.
{
  const map = make_map();
  const server = create_locus_hosted_aggregate_socket_internal({ map, exposure,
    authorizeProjection: ({ requested }) => requested });
  const connection = await session(server, "A", false);
  connection.client.send(JSON.stringify({ type: "recover", id: "r".repeat(1_025), logicalMapId: server.logicalMapId }));
  await settle();
  assert.equal(messages(connection, "recovery-caught-up").length, 0);
  assert.equal(messages(connection, "error").some((message) => message.code === "LOCUS_PROTOCOL_INVALID"), true);
  server.dispose();
}

// During recovery the same session must reject an oversized event, then
// buffer/drain a proven-small accepted event after its captured cut.
{
  const map = make_map();
  const held = deferred();
  const entered = deferred();
  let hold = true;
  const server = create_locus_hosted_aggregate_socket_internal({ map, exposure,
    authorizeProjection: ({ requested }) => requested, maxWireBytes: 30_000,
    internal: { afterRecoveryCut: async () => { if (hold) { entered.resolve(); await held.promise; } } } });
  const recovering = await session(server, "A", false);
  recovering.client.send(JSON.stringify({ type: "recover", id: "recover-A", logicalMapId: server.logicalMapId }));
  await entered.promise;
  await assert.rejects(server.mutate((draft) => set_value(draft, "A", "X".repeat(40_000))), /byte limit/i);
  assert.equal(server.rev, 0);
  assert.equal(server.debug().retainedCommits, 0);
  await server.mutate((draft) => set_value(draft, "A", "A-small"));
  assert.equal(server.rev, 1);
  hold = false;
  held.resolve();
  await settle();
  assert.equal(messages(recovering, "recovery-caught-up").length, 1);
  assert.equal(messages(recovering, "commit").length, 1);
  assert.equal(messages(recovering, "error").some((message) => message.code === "LOCUS_RECOVERY_FAILED"), false);
  server.dispose();
}

// A held durable decision reserves local identity and session admission.
{
  const persistence = new MemoryPersistence();
  const map = make_map();
  const authorization = deferred();
  const host = await create_persistent_multi_library_locus({ map, exposure,
    logicalMapId: "z1z2-reservation", persistence,
    authorizeProjection: async ({ requested }) => { await authorization.promise; return requested; } });
  const pending = persistence.deferNextAppend();
  const mutation = host.mutate((draft) => draft.lib("A").at(["value"]).set("A1"));
  await pending.entered;
  const aggregate = internal_livemap_aggregate_authority(map);
  const library = aggregate.libraries()[0]!;
  assert.throws(() => aggregate.acquireLocalProjectedIdentity(library, [], "00004b001"), /reserved/i);
  const connection = pair();
  host.connect(connection.socket);
  connection.client.send(encode_locus_client_message({ type: "session-create", id: "racing-create", projection: { libraries: ["A"] } }));
  authorization.resolve();
  await settle();
  assert.equal(messages(connection, "session-created").length, 0);
  pending.release();
  await mutation;
  await settle();
  assert.equal(messages(connection, "session-created").length, 1);
  connection.client.send(JSON.stringify({ type: "recover", id: "racing-recover", logicalMapId: host.logicalMapId }));
  await settle();
  const snapshot = messages(connection, "recovery-snapshot")[0]?.snapshot as { revision: number } | undefined;
  assert.equal(snapshot?.revision, 1);
  aggregate.acquireLocalProjectedIdentity(library, [], "00004b001");
  assert.equal(map.rev, 1);
  assert.deepEqual(aggregate.resolveQuid("00004b001")?.path, []);
  host.dispose();
}

// Failure in mandatory postinstall history work is fatal after append. The
// existing internal preaccept installer supplies the fault injection seam.
{
  const persistence = new MemoryCheckpointAdapter();
  const map = make_map();
  const host = await create_persistent_locus_hosted_aggregate_internal({ map, persistence,
    logicalMapId: "z1z2-postinstall-fault",
    beforeAccept: () => ({ install: () => { throw new Error("injected postinstall fault"); } }),
  });
  await assert.rejects(host.mutate((draft) => set_value(draft, "A", "A1")), /injected postinstall fault/i);
  assert.equal(persistence.state("z1z2-postinstall-fault")?.commits.length, 1);
  await assert.rejects(host.mutate((draft) => set_value(draft, "A", "A2")), /faulted/i);
  host.dispose();
  const restored = await create_persistent_multi_library_locus({ map: make_map(), exposure,
    logicalMapId: "z1z2-postinstall-fault", persistence });
  assert.equal(restored.rev, 1);
  restored.dispose();
}

process.stdout.write("Z1/Z2 authority acceptance and session roster acceptance passed.\n");
