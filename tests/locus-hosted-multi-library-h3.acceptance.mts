import { test_public_exposure, test_public_projection } from "./helpers/hosted-exposure.mts";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { Hson, hsonLiveMap, hsonMirror, type HsonSchema } from "../src/index.ts";
import { validate_document_path } from "../src/api/livemap/index.ts";
import type { HsonNode } from "../src/core/types.ts";
import type { LocusSocketLike } from "../src/types/locus.types.ts";
import type { LiveMapLibraries } from "../src/types/livemap.types.ts";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";
import { encode_hosted_root, make_hosted_client_snapshot } from "../src/api/livemap/livemap.hosted.ts";
import { encode_locus_graph_content, encode_locus_portable_graph_content } from "../src/api/locus/locus.graph-content-codec.ts";
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
import { acquire_document_identity } from "./helpers/livemap-identity-internal.mts";
import { set_livemap_document_quid_candidate_source_for_tests } from "../src/api/livemap/livemap.document.registration.ts";
import { livemap_identity_epoch_accounting } from "../src/api/livemap/livemap.identity-epoch.ts";
import { parse_hson_exact_runtime } from "../src/internal/exact-runtime-hson-codec.ts";
import { admit_authority_projection_snapshot, project_authority_snapshot } from "../src/api/locus/locus.authority-projection-snapshot.ts";
import { make_locus_hosted_projection_policy, normalize_locus_effective_projection } from "../src/api/locus/locus.projection.ts";

const StateSchema: HsonSchema = Hson.schema`<type "data" content <theme "string" count <number <int true min 0>> box <content <id "number">>>>`;
const ColorsSchema: HsonSchema = Hson.schema`<type "data" content <theme "string" accent "string">>`;
const PageSchema: HsonSchema = Hson.schema`<type "document" tag "main" content <repeat <tag "item" content "empty">>>`;
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

function projected_client_map(authority: LiveMapLibraries): LiveMapLibraries {
  const captured = internal_livemap_aggregate_authority(authority).captureHosted();
  const configured = test_public_projection(authority);
  const policy = make_locus_hosted_projection_policy(captured.registry, captured.authority,
    configured.exposure, configured.defaultProjection, configured.authorizeProjection);
  const effective = normalize_locus_effective_projection(policy, configured.defaultProjection);
  if (effective instanceof Promise) throw new Error("Expected synchronous test projection.");
  return hsonLiveMap.fromClientSnapshot({ authority: project_authority_snapshot(captured, effective), localLibraries: {} });
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

function page_item(map: LiveMapLibraries): HsonNode | undefined {
  const main = page_library(map).root().$_content[0];
  if (typeof main !== "object" || main === null) return undefined;
  const wrapper = main.$_content[0];
  if (typeof wrapper !== "object" || wrapper === null) return undefined;
  const item = wrapper.$_content[0];
  return typeof item === "object" && item !== null ? item : undefined;
}

function insert_item(quid?: string) {
  const item: HsonNode = { $_tag: "item", ...(quid === undefined ? {} : { $_meta: { quid } }), $_content: [] };
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

await check("actual socket aggregate bootstrap establishes one projected QUID-free client replica", async () => {
  const map = make_map(2);
  const server = create_locus_hosted_aggregate_socket_internal({ ...test_public_projection(map), map });
  const attached = await attach(server);
  assert.equal(attached.recovery.outcome, "snapshot");
  assert.ok(attached.client.map);
  assert.equal(data_library(attached.client.map!, "state").snap(["theme"]), "light");
  assert.equal(data_library(attached.client.map!, "colors").snap(["accent"]), "#000");
  const sent = attached.pair.serverSent.map((raw) => JSON.parse(raw) as Record<string, unknown>);
  assert.equal(sent.some((message) => message.type === "hello"), false);
  assert.equal(sent.find((message) => message.type === "recovery-snapshot")?.format, "hson-locus-hosted-aggregate-message-v4");
  assert.equal((sent.find((message) => message.type === "recovery-snapshot")?.snapshot as { format: string }).format,
    "hson-authority-projection-snapshot-v1");
  assert.equal(attached.pair.serverSent.some((raw) => raw.includes("issuedQuids") || raw.includes("identityEpoch")), false);
  server.dispose();
});

await check("old aggregate socket discriminator rejects as an ordinary non-current value", async () => {
  const server = create_locus_hosted_aggregate_socket_internal({ ...test_public_projection(make_map()), map: make_map() });
  const pair = socket_pair();
  server.connect(pair.server);
  pair.before_server_delivery((message) => message.type === "recovery-snapshot"
    ? { ...message, format: "hson-locus-hosted-aggregate-h3" }
    : message);
  const endpoint = create_multi_library_echo_socket_client_internal({
    socket: pair.client,
    logicalMapId: server.logicalMapId,
  });
  await assert.rejects(endpoint.connect(), /recovery failed|format|incompatible/i);
  assert.equal(endpoint.map, undefined);
  endpoint.dispose();
  server.dispose();
});

await check("projected bootstrap admission rejects generated authority QUID claims", () => {
  const map = make_map();
  const captured = internal_livemap_aggregate_authority(map).captureHosted();
  const configured = test_public_projection(map);
  const policy = make_locus_hosted_projection_policy(captured.registry, captured.authority,
    configured.exposure, configured.defaultProjection, configured.authorizeProjection);
  const effective = normalize_locus_effective_projection(policy, configured.defaultProjection);
  if (effective instanceof Promise) throw new Error("Expected synchronous test projection.");
  const snapshot = project_authority_snapshot(captured, effective);
  const poisoned = Object.freeze({
    ...snapshot,
    libraries: snapshot.libraries.map((entry) => entry.name === "page"
      ? Object.freeze({ ...entry, root: encode_hosted_root(parse_hson_exact_runtime('<main @000008299/>')) })
      : entry),
  });
  assert.throws(() => admit_authority_projection_snapshot(poisoned), /malformed/i);
});

await check("custom socket action preserves one global projected commit", async () => {
  const map = make_map();
  const server = create_locus_hosted_aggregate_socket_internal({
    ...test_public_projection(map),
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
  await attached.client.action("theme.all");
  assert.equal(clientMap.rev, 1);
  assert.equal(data_library(clientMap, "state").snap(["theme"]), "dark");
  assert.equal(data_library(clientMap, "colors").snap(["theme"]), "blue");
  await server.mutate((draft) => data(draft, "colors").at(["accent"]).set("#fff"));
  assert.equal(clientMap.rev, 2);
  assert.equal(data_library(clientMap, "colors").snap(["accent"]), "#fff");
  server.dispose();
});

await check("retained global history recovers QUID-free aggregate effects without per-library cursors", async () => {
  const map = make_map();
  const stale = projected_client_map(map);
  const server = create_locus_hosted_aggregate_socket_internal({ ...test_public_projection(map), map });
  await server.mutate((draft) => data(draft, "state").at(["theme"]).set("dark"));
  await server.mutate((draft) => {
    data(draft, "colors").at(["accent"]).set("#fff");
    document(draft, "page").graph(insert_item());
  });
  const attached = await attach(server, { map: stale });
  assert.equal(attached.recovery.outcome, "replay");
  assert.equal(attached.client.lastAppliedRev, 2);
  assert.equal(data_library(stale, "state").snap(["theme"]), "dark");
  assert.equal(data_library(stale, "colors").snap(["accent"]), "#fff");
  assert.equal(page_item(stale)?.$_tag, "item");
  assert.equal(page_library(stale).document.byQuid(QUID), undefined);
  for (const raw of attached.pair.serverSent) {
    assert.equal(raw.includes(QUID), false, "authority QUID crossed the aggregate client wire");
    assert.equal(raw.includes('"quid"') || raw.includes('\\"quid\\"'), false, "aggregate client wire contains a node QUID field");
  }
  assert.equal(data_library(stale, "state").snap(["theme"]), "dark");
  server.dispose();
});

await check("aggregate snapshot recovery restores a retained mirror in place and converges selected page Mirror once", async () => {
  install_fake_document();
  const map = make_map();
  const server = create_locus_hosted_aggregate_socket_internal({ ...test_public_projection(map), map, maxHistoryBytes: 1 });
  const stale = projected_client_map(map);
  const stateHandle = data_library(stale, "state").at(["theme"]);
  const pageHandle = page_library(stale).at([]);
  const reflected = hsonMirror(page_library(stale));
  await server.mutate((draft) => {
    data(draft, "state").at(["theme"]).set("dark");
    document(draft, "page").graph(insert_item());
  });
  const attached = await attach(server, { map: stale });
  assert.equal(attached.recovery.outcome, "snapshot");
  assert.equal(attached.client.map, stale);
  assert.equal(stateHandle.snap(), "dark");
  assert.equal(page_library(stale).root().$_tag, "_hson_root");
  assert.equal(page_item(stale)?.$_tag, "item");
  assert.equal(page_library(stale).document.byQuid(QUID), undefined);
  assert.equal(reflected.sourceRevision, 1);
  assert.equal(reflected.diagnostics().updatesApplied, 1);
  reflected.dispose();
  server.dispose();
});

await check("a state-only aggregate snapshot preserves the client identity epoch while retiring projected claims", async () => {
  install_fake_document();
  const map = make_map();
  const server = create_locus_hosted_aggregate_socket_internal({ ...test_public_projection(map), map, maxHistoryBytes: 1 });
  const stale = projected_client_map(map);
  set_livemap_document_quid_candidate_source_for_tests(page_library(stale).document, () => "000008299");
  const oldSubject = acquire_document_identity(page_library(stale).document, { kind: "path", path: validate_document_path([0]) });
  const oldEpoch = livemap_identity_epoch_accounting(page_library(stale).document).epoch;
  const reflected = hsonMirror(page_library(stale));
  await server.mutate((draft) => data(draft, "state").at(["theme"]).set("dark"));
  const attached = await attach(server, { map: stale });
  assert.equal(attached.recovery.outcome, "snapshot");
  assert.equal(reflected.sourceRevision, 1);
  assert.equal(reflected.diagnostics().updatesApplied, 1);
  assert.equal(oldSubject.active, false);
  assert.equal(livemap_identity_epoch_accounting(page_library(stale).document).epoch, oldEpoch);
  assert.equal(page_library(stale).document.byQuid("000008299"), undefined);
  assert.equal(reflected.status, "active");
  reflected.dispose();
  server.dispose();
});

await check("socket document action requires a named document library and replays through the projected mirror", async () => {
  const map = make_map();
  const server = create_locus_hosted_aggregate_socket_internal({ ...test_public_projection(map), map });
  const attached = await attach(server);
  const content = encode_locus_portable_graph_content(insert_item().content);
  await attached.client.action("document.content.insert", {
    library: "page",
    target: { kind: "path", path: [0] },
    index: 0,
    content,
  });
  assert.equal(page_item(attached.client.map!)?.$_tag, "item");
  assert.equal(page_library(attached.client.map!).document.byQuid(QUID), undefined);
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

await check("aggregate action rejects generated QUID content before authority admission", async () => {
  const map = make_map();
  const server = create_locus_hosted_aggregate_socket_internal({ ...test_public_projection(map), map });
  const attached = await attach(server);
  const before = internal_livemap_aggregate_authority(map).captureHosted();
  const ledger = livemap_identity_epoch_accounting(page_library(map).document);
  const exact = encode_locus_graph_content(insert_item(QUID).content);
  const result = await attached.client.action("document.content.insert", {
    library: "page",
    target: { kind: "path", path: [0] },
    index: 0,
    content: { format: "hson-graph-portable-v1", payload: exact.payload },
  });
  assert.equal(result.type, "error");
  assert.deepEqual(internal_livemap_aggregate_authority(map).captureHosted(), before);
  assert.deepEqual(livemap_identity_epoch_accounting(page_library(map).document), ledger);
  server.dispose();
});

await check("authority retains local issued-QUID history while client bootstrap omits the authority ledger", async () => {
  const map = make_map();
  const server = create_locus_hosted_aggregate_socket_internal({ ...test_public_projection(map), map });
  await server.mutate((draft) => document(draft, "page").graph(insert_item()));
  set_livemap_document_quid_candidate_source_for_tests(page_library(map).document, () => QUID);
  acquire_document_identity(page_library(map).document, { kind: "path", path: validate_document_path([0, 0, 0]) });
  await server.mutate((draft) => document(draft, "page").content.remove({ kind: "path", path: validate_document_path([0]) }, 0));
  const attached = await attach(server);
  const mirror = attached.client.map!;
  const snapshot = make_hosted_client_snapshot(internal_livemap_aggregate_authority(mirror).captureHosted());
  assert.equal(page_library(mirror).document.byQuid(QUID), undefined);
  assert.equal("identity" in snapshot, false);
  assert.equal(JSON.stringify(snapshot).includes(QUID), false);
  await assert.rejects(
    () => server.mutate((draft) => document(draft, "page").graph(insert_item(QUID))),
    /QUID|reuse|identity/i,
  );
  assert.equal(attached.client.lastAppliedRev, 2);
  assert.equal(mirror.rev, 0);
  server.dispose();
});

await check("registry mismatch refuses replay against an existing topology and leaves its mirror unchanged", async () => {
  const map = make_map();
  const stale = projected_client_map(map);
  const before = internal_livemap_aggregate_authority(stale).captureHosted();
  const server = create_locus_hosted_aggregate_socket_internal({ ...test_public_projection(map), map });
  // The bad projected-registry claim changes the recovery strategy without
  // changing this detached composed map.
  const pair = socket_pair();
  server.connect(pair.server);
  pair.client.send(JSON.stringify({ type: "recover", id: "bootstrap-registry", logicalMapId: server.logicalMapId }));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  const initialPlan = pair.serverSent.map((raw) => JSON.parse(raw) as Record<string, unknown>)
    .find((message) => message.type === "recovery-plan" && message.id === "bootstrap-registry");
  assert.ok(initialPlan);
  pair.client.send(JSON.stringify({
    type: "recover",
    id: "bad-registry",
    logicalMapId: server.logicalMapId,
    incarnationId: server.incarnationId,
    registryDigest: "0".repeat(64),
    projectionDigest: initialPlan.projectionDigest,
    lastAppliedRev: 0,
  }));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  const plan = pair.serverSent.map((raw) => JSON.parse(raw) as Record<string, unknown>)
    .find((message) => message.type === "recovery-plan" && message.id === "bad-registry");
  assert.equal(plan?.outcome, "snapshot");
  assert.equal(plan?.reason, "registry_mismatch");
  assert.deepEqual(internal_livemap_aggregate_authority(stale).captureHosted(), before);
  server.dispose();
});

await check("snapshot cut buffers an accepted aggregate tail and drains it in global order", async () => {
  const map = make_map();
  const stale = projected_client_map(map);
  let server!: ReturnType<typeof create_locus_hosted_aggregate_socket_internal>;
  server = create_locus_hosted_aggregate_socket_internal({
    ...test_public_projection(map),
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
  const attached = await attach(server, { map: stale });
  assert.equal(attached.recovery.outcome, "snapshot");
  assert.equal(attached.client.lastAppliedRev, 2);
  assert.equal(data_library(stale, "state").snap(["theme"]), "dark");
  assert.equal(data_library(stale, "colors").snap(["accent"]), "#fff");
  server.dispose();
});

await check("current recovery preserves the global cursor and projected mirror", async () => {
  const server = create_locus_hosted_aggregate_socket_internal({ ...test_public_projection(make_map()), map: make_map() });
  const attached = await attach(server);
  const mirror = attached.client.map;
  const recovered = await attached.client.connect();
  assert.equal(recovered.outcome, "current");
  assert.equal(recovered.revision, 0);
  assert.equal(attached.client.map, mirror);
  assert.equal(data_library(attached.client.map!, "state").snap(["theme"]), "light");
  server.dispose();
});

await check("H3 socket telemetry captures two/four-library bootstrap and effective four-megabyte live bound", async () => {
  const two = create_locus_hosted_aggregate_socket_internal({ ...test_public_projection(make_map(2)), map: make_map(2) });
  const four = create_locus_hosted_aggregate_socket_internal({ ...test_public_projection(make_map(4)), map: make_map(4) });
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
