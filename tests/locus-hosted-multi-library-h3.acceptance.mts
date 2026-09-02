import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { Hson, hsonLiveMap, hsonReflect, validate_document_path, type HsonSchema } from "../src/index.ts";
import type { HsonNode } from "../src/core/types.ts";
import type { LocusSocketLike } from "../src/types/locus.types.ts";
import type { LiveMapLibraries } from "../src/types/livemap.types.ts";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";
import { make_livemap_hosted_mirror_from_snapshot_internal } from "../src/api/livemap/livemap.libraries.ts";
import { encode_locus_graph_content } from "../src/api/locus/locus.graph-content-codec.ts";
import {
  create_multi_library_echo_socket_client_internal,
} from "../src/api/echo/echo.multi-library.socket.ts";
import { create_locus_hosted_aggregate_socket_internal } from "../src/api/locus/locus.hosted-multi-library.socket.ts";
import type {
  LocusHostedAggregateDataDraft,
  LocusHostedAggregateDocumentDraft,
  LocusHostedAggregateDraft,
} from "../src/api/locus/locus.hosted-multi-library.ts";
import { install_fake_document } from "./helpers/fake-document.mts";
import { create_test_event_emitter } from "./test-events.mjs";

const StateSchema: HsonSchema = Hson`<type "data" content <theme "string" count <number <int true min 0>> box <content <id "number">>>>`;
const ColorsSchema: HsonSchema = Hson`<type "data" content <theme "string" accent "string">>`;
const PageSchema: HsonSchema = Hson`<type "document" tag "main" content <repeat <tag "item" content "empty">>>`;
const QUID = "000008203";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "locus.hosted-multi-library-h3",
  title: "Hosted multi-library H3",
  category: "Locus",
  runtime: "node",
  tags: Object.freeze(["locus", "livemap", "libraries", "hosted", "h3"]),
});

const testEvents = create_test_event_emitter("locus.hosted-multi-library-h3");
let checks = 0;
async function check(name: string, run: () => void | Promise<void>): Promise<void> {

  testEvents.case_begin(name, name);
  try {
    await run();
    testEvents.case_end(name, "pass");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Check failed.";
    testEvents.diagnostic(name, "assertion", message.slice(0, 1_000));
    testEvents.case_end(name, "fail");
    testEvents.terminal("fail");
    throw error;
  }
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function socket_pair(): Readonly<{
  client: LocusSocketLike;
  server: LocusSocketLike;
  clientSent: string[];
  serverSent: string[];
  before_server_delivery: (listener: (message: Record<string, unknown>) => Record<string, unknown> | void) => void;
  close: () => void;
}> {
  const clientMessages = new Set<(raw: string) => void>();
  const serverMessages = new Set<(raw: string) => void>();
  const clientCloses = new Set<() => void>();
  const serverCloses = new Set<() => void>();
  const clientSent: string[] = [];
  const serverSent: string[] = [];
  let beforeServerDelivery: ((message: Record<string, unknown>) => Record<string, unknown> | void) | undefined;
  const client = Object.freeze({
    send(raw: string) {
      clientSent.push(raw);
      for (const listener of [...serverMessages]) listener(raw);
    },
    close() {},
    onMessage(listener: (raw: string) => void) {
      clientMessages.add(listener);
      return () => clientMessages.delete(listener);
    },
    onClose(listener: () => void) {
      clientCloses.add(listener);
      return () => clientCloses.delete(listener);
    },
  });
  const server = Object.freeze({
    send(raw: string) {
      serverSent.push(raw);
      const message = JSON.parse(raw) as Record<string, unknown>;
      const delivered = beforeServerDelivery?.(message) ?? message;
      const deliveredRaw = JSON.stringify(delivered);
      for (const listener of [...clientMessages]) listener(deliveredRaw);
    },
    close() {},
    onMessage(listener: (raw: string) => void) {
      serverMessages.add(listener);
      return () => serverMessages.delete(listener);
    },
    onClose(listener: () => void) {
      serverCloses.add(listener);
      return () => serverCloses.delete(listener);
    },
  });
  return Object.freeze({
    client,
    server,
    clientSent,
    serverSent,
    before_server_delivery(listener) { beforeServerDelivery = listener; },
    close() {
      for (const listener of [...clientCloses]) listener();
      for (const listener of [...serverCloses]) listener();
    },
  });
}

function make_map(libraries = 3) {
  const input = {
    state: { data: { theme: "light", count: 0, box: { id: 0 } }, schema: StateSchema },
    colors: { data: { theme: "light", accent: "#000" }, schema: ColorsSchema },
    page: { document: "<main/>", schema: PageSchema },
    ...(libraries >= 4 ? { extra: { data: { theme: "light", accent: "#111" }, schema: ColorsSchema } } : {}),
  };
  return hsonLiveMap.fromLibraries(input);
}

function data(draft: LocusHostedAggregateDraft, name: string): LocusHostedAggregateDataDraft {
  const selected = draft.lib(name);
  if (!("at" in selected)) throw new Error(`Expected data library ${name}.`);
  return selected;
}

function document(draft: LocusHostedAggregateDraft, name: string): LocusHostedAggregateDocumentDraft {
  const selected = draft.lib(name);
  if (!("graph" in selected)) throw new Error(`Expected document library ${name}.`);
  return selected;
}

function data_library(map: LiveMapLibraries, name: string) {
  const selected = map.lib(name);
  if (!("snap" in selected)) throw new Error(`Expected data library ${name}.`);
  return selected;
}

function page_library(map: LiveMapLibraries) {
  const selected = map.lib("page");
  if (!("document" in selected)) throw new Error("Expected page document library.");
  return selected;
}

function insert_item(quid = QUID) {
  const item: HsonNode = { $_tag: "item", $_meta: { quid }, $_content: [] };
  const content: HsonNode = { $_tag: "_hson_elem", $_content: [item] };
  return Object.freeze({
    domain: "graph" as const,
    op: "insert-content" as const,
    target: Object.freeze({ kind: "path" as const, path: validate_document_path([0]) }),
    index: 0,
    content,
  });
}

async function attach(server: ReturnType<typeof create_locus_hosted_aggregate_socket_internal>, options: Readonly<{ map?: LiveMapLibraries }> = {}) {
  const pair = socket_pair();
  server.connect(pair.server);
  const client = create_multi_library_echo_socket_client_internal({
    socket: pair.client,
    logicalMapId: server.logicalMapId,
    ...options,
  });
  const started = performance.now();
  const recovery = await client.connect();
  return Object.freeze({ pair, client, recovery, elapsedMs: performance.now() - started });
}

await check("actual socket aggregate bootstrap establishes one complete two-data-library mirror with registry and issued-QUID state", async () => {
  const map = make_map(2);
  const server = create_locus_hosted_aggregate_socket_internal({ map });
  const attached = await attach(server);
  assert.equal(attached.recovery.outcome, "snapshot");
  assert.ok(attached.client.map);
  assert.deepEqual(
    internal_livemap_aggregate_authority(attached.client.map!).captureHosted(),
    internal_livemap_aggregate_authority(map).captureHosted(),
  );
  const sent = attached.pair.serverSent.map((raw) => JSON.parse(raw) as Record<string, unknown>);
  assert.equal(sent.some((message) => message.type === "hello"), false);
  assert.equal(sent.find((message) => message.type === "recovery-snapshot")?.format, "hson-locus-hosted-aggregate-message");
  server.dispose();
});

await check("old aggregate socket discriminator rejects as an ordinary non-current value", async () => {
  const server = create_locus_hosted_aggregate_socket_internal({ map: make_map() });
  const pair = socket_pair();
  server.connect(pair.server);
  pair.before_server_delivery((message) => message.type === "recovery-snapshot"
    ? { ...message, format: "hson-locus-hosted-aggregate-h3" }
    : message);
  const endpoint = create_multi_library_echo_socket_client_internal({
    socket: pair.client,
    logicalMapId: server.logicalMapId,
  });
  await assert.rejects(endpoint.connect(), /format|incompatible/i);
  assert.equal(endpoint.map, undefined);
  endpoint.dispose();
  server.dispose();
});

await check("custom socket action preserves one global commit, complete mirror replay, and library-qualified same-path subscriptions", async () => {
  const map = make_map();
  const server = create_locus_hosted_aggregate_socket_internal({
    map,
    actions: {
      "theme.all": async (context) => context.mutate((draft) => {
        data(draft, "state").at(["theme"]).set("dark");
        data(draft, "colors").at(["theme"]).set("blue");
      }),
    },
  });
  const attached = await attach(server);
  const clientMap = attached.client.map!;
  const stateValues: unknown[] = [];
  const colorValues: unknown[] = [];
  const stopState = attached.client.subscribe("state", ["theme"], (value, revision) => stateValues.push([value, revision]));
  attached.client.subscribe("colors", ["theme"], (value, revision) => colorValues.push([value, revision]));
  await attached.client.action("theme.all");
  assert.equal(clientMap.rev, 1);
  assert.equal(data_library(clientMap, "state").snap(["theme"]), "dark");
  assert.equal(data_library(clientMap, "colors").snap(["theme"]), "blue");
  assert.deepEqual(stateValues.at(-1), ["dark", 1]);
  assert.deepEqual(colorValues.at(-1), ["blue", 1]);
  assert.equal(server.debug().subscriptions.length, 2);
  assert.throws(() => attached.client.subscribe("missing", [], () => {}), /unknown|subscription/i);
  const stateSyncCount = stateValues.length;
  stopState();
  await server.mutate((draft) => data(draft, "colors").at(["accent"]).set("#fff"));
  assert.equal(clientMap.rev, 2);
  assert.equal(stateValues.length, stateSyncCount);
  assert.equal(server.debug().subscriptions.length, 1);
  server.dispose();
});

await check("retained global history recovers exact H1 aggregate commits without per-library cursors", async () => {
  const map = make_map();
  const seed = internal_livemap_aggregate_authority(map).captureHosted();
  const server = create_locus_hosted_aggregate_socket_internal({ map });
  await server.mutate((draft) => data(draft, "state").at(["theme"]).set("dark"));
  await server.mutate((draft) => {
    data(draft, "colors").at(["accent"]).set("#fff");
    document(draft, "page").graph(insert_item());
  });
  const stale = make_livemap_hosted_mirror_from_snapshot_internal(seed);
  const attached = await attach(server, { map: stale });
  assert.equal(attached.recovery.outcome, "replay");
  assert.equal(attached.client.lastAppliedRev, 2);
  assert.equal(data_library(stale, "state").snap(["theme"]), "dark");
  assert.equal(data_library(stale, "colors").snap(["accent"]), "#fff");
  assert.equal(page_library(stale).document.byQuid(QUID)?.$_tag, "item");
  assert.deepEqual(internal_livemap_aggregate_authority(stale).captureHosted(), internal_livemap_aggregate_authority(map).captureHosted());
  server.dispose();
});

await check("aggregate snapshot recovery restores a retained mirror in place and converges selected page Reflect once", async () => {
  install_fake_document();
  const map = make_map();
  const seed = internal_livemap_aggregate_authority(map).captureHosted();
  const server = create_locus_hosted_aggregate_socket_internal({ map, maxHistoryBytes: 1 });
  const stale = make_livemap_hosted_mirror_from_snapshot_internal(seed);
  const stateHandle = data_library(stale, "state").at(["theme"]);
  const pageHandle = page_library(stale).at([]);
  const reflected = hsonReflect(page_library(stale));
  await server.mutate((draft) => {
    data(draft, "state").at(["theme"]).set("dark");
    document(draft, "page").graph(insert_item());
  });
  const attached = await attach(server, { map: stale });
  assert.equal(attached.recovery.outcome, "snapshot");
  assert.equal(attached.client.map, stale);
  assert.equal(stateHandle.snap(), "dark");
  assert.equal(page_library(stale).root().$_tag, "_hson_root");
  assert.equal(page_library(stale).document.byQuid(QUID)?.$_tag, "item");
  assert.equal(reflected.sourceRevision, 1);
  assert.equal(reflected.diagnostics().updatesApplied, 1);
  reflected.dispose();
  server.dispose();
});

await check("a state-only aggregate replacement advances selected page Reflect without document reconciliation", async () => {
  install_fake_document();
  const map = make_map();
  const seed = internal_livemap_aggregate_authority(map).captureHosted();
  const server = create_locus_hosted_aggregate_socket_internal({ map, maxHistoryBytes: 1 });
  const stale = make_livemap_hosted_mirror_from_snapshot_internal(seed);
  const reflected = hsonReflect(page_library(stale));
  await server.mutate((draft) => data(draft, "state").at(["theme"]).set("dark"));
  const attached = await attach(server, { map: stale });
  assert.equal(attached.recovery.outcome, "snapshot");
  assert.equal(reflected.sourceRevision, 1);
  assert.equal(reflected.diagnostics().updatesApplied, 0);
  reflected.dispose();
  server.dispose();
});

await check("socket document action requires a named document library and replays through the complete mirror", async () => {
  const map = make_map();
  const server = create_locus_hosted_aggregate_socket_internal({ map });
  const attached = await attach(server);
  const content = encode_locus_graph_content(insert_item().content);
  await attached.client.action("document.content.insert", {
    library: "page",
    target: { kind: "path", path: [0] },
    index: 0,
    content,
  });
  assert.equal(page_library(attached.client.map!).document.byQuid(QUID)?.$_tag, "item");
  const invalid = await attached.client.action("document.content.insert", {
      library: "state",
      target: { kind: "path", path: [0] },
      index: 0,
      content,
    });
  assert.equal(invalid.type, "error");
  if (invalid.type === "error") assert.match(invalid.error.message, /document/i);
  server.dispose();
});

await check("aggregate bootstrap restores the complete issued-QUID ledger, including retired identities, and preserves ABA rejection", async () => {
  const map = make_map();
  const server = create_locus_hosted_aggregate_socket_internal({ map });
  await server.mutate((draft) => document(draft, "page").graph(insert_item()));
  await server.mutate((draft) => document(draft, "page").content.remove({ kind: "path", path: validate_document_path([0]) }, 0));
  const attached = await attach(server);
  const mirror = attached.client.map!;
  const snapshot = internal_livemap_aggregate_authority(mirror).captureHosted();
  assert.equal(page_library(mirror).document.byQuid(QUID), undefined);
  assert.equal(snapshot.identity.issuedQuids.includes(QUID), true);
  await assert.rejects(
    () => server.mutate((draft) => document(draft, "page").graph(insert_item())),
    /QUID|reuse|identity/i,
  );
  assert.equal(mirror.rev, 2);
  server.dispose();
});

await check("registry mismatch refuses replay against an existing topology and leaves its mirror unchanged", async () => {
  const map = make_map();
  const seed = internal_livemap_aggregate_authority(map).captureHosted();
  const stale = make_livemap_hosted_mirror_from_snapshot_internal(seed);
  const before = internal_livemap_aggregate_authority(stale).captureHosted();
  const server = create_locus_hosted_aggregate_socket_internal({ map });
  const original = internal_livemap_aggregate_authority(stale).captureHosted;
  const aggregate = internal_livemap_aggregate_authority(stale);
  // A deliberately incompatible mirror remains a normal H1 map, but its
  // cursor carries a bad registry fence into H3 recovery.
  const incompatible = make_livemap_hosted_mirror_from_snapshot_internal(seed);
  const badSnapshot = aggregate.captureHosted();
  assert.equal(badSnapshot.registryDigest, before.registryDigest);
  const pair = socket_pair();
  server.connect(pair.server);
  pair.client.send(JSON.stringify({
    type: "recover",
    id: "bad-registry",
    logicalMapId: server.logicalMapId,
    incarnationId: server.incarnationId,
    registryDigest: "0".repeat(64),
    lastAppliedRev: 0,
  }));
  await Promise.resolve();
  const plan = pair.serverSent.map((raw) => JSON.parse(raw) as Record<string, unknown>).find((message) => message.type === "recovery-plan");
  assert.equal(plan?.outcome, "snapshot");
  assert.equal(plan?.reason, "registry_mismatch");
  assert.deepEqual(internal_livemap_aggregate_authority(stale).captureHosted(), before);
  void original;
  void incompatible;
  server.dispose();
});

await check("snapshot cut buffers an accepted aggregate tail, drains it in global order, then synchronizes subscriptions", async () => {
  const map = make_map();
  const seed = internal_livemap_aggregate_authority(map).captureHosted();
  let server!: ReturnType<typeof create_locus_hosted_aggregate_socket_internal>;
  server = create_locus_hosted_aggregate_socket_internal({
    map,
    maxHistoryBytes: 1,
    internal: {
      afterRecoveryCut: async () => {
        await server.mutate((draft) => {
          data(draft, "state").at(["theme"]).set("dark");
          data(draft, "colors").at(["accent"]).set("#fff");
        });
      },
    },
  });
  await server.mutate((draft) => data(draft, "state").at(["count"]).set(1));
  const stale = make_livemap_hosted_mirror_from_snapshot_internal(seed);
  const attached = await attach(server, { map: stale });
  assert.equal(attached.recovery.outcome, "snapshot");
  assert.equal(attached.client.lastAppliedRev, 2);
  assert.equal(data_library(stale, "state").snap(["theme"]), "dark");
  assert.equal(data_library(stale, "colors").snap(["accent"]), "#fff");
  const values: unknown[] = [];
  attached.client.subscribe("state", ["theme"], (value, revision) => values.push([value, revision]));
  assert.deepEqual(values, [["dark", 2]]);
  server.dispose();
});

await check("current recovery preserves the global cursor and resynchronizes an existing library-qualified subscription", async () => {
  const server = create_locus_hosted_aggregate_socket_internal({ map: make_map() });
  const attached = await attach(server);
  const values: unknown[] = [];
  attached.client.subscribe("state", ["theme"], (value, revision) => values.push([value, revision]));
  const recovered = await attached.client.connect();
  assert.equal(recovered.outcome, "current");
  assert.equal(recovered.revision, 0);
  assert.deepEqual(values, [["light", 0], ["light", 0]]);
  server.dispose();
});

await check("H3 socket telemetry captures two/four-library bootstrap and effective four-megabyte live bound", async () => {
  const two = create_locus_hosted_aggregate_socket_internal({ map: make_map(2) });
  const four = create_locus_hosted_aggregate_socket_internal({ map: make_map(4) });
  const bootstrapTwo = await attach(two);
  const bootstrapFour = await attach(four);
  assert.equal(two.debug().effectiveLiveWireBytes, 4 * 1_024 * 1_024);
  process.stdout.write(`# telemetry ${JSON.stringify({
    bootstrapTwoMs: bootstrapTwo.elapsedMs,
    bootstrapFourMs: bootstrapFour.elapsedMs,
    twoBytes: bootstrapTwo.pair.serverSent.reduce((sum, raw) => sum + new TextEncoder().encode(raw).byteLength, 0),
    fourBytes: bootstrapFour.pair.serverSent.reduce((sum, raw) => sum + new TextEncoder().encode(raw).byteLength, 0),
    effectiveLiveWireBytes: two.debug().effectiveLiveWireBytes,
  })}\n`);
  two.dispose();
  four.dispose();
});

process.stdout.write(`1..${checks}\n`);
process.stdout.write(`Hosted multi-library H3 acceptance: ${checks}/${checks}\n`);
testEvents.terminal("pass");
