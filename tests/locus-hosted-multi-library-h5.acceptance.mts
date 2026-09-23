import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  Hson,
  hsonLiveMap,
  hsonLocus,
  hsonEcho,
  hsonMirror,
  type HsonSchema,
} from "../src/index.ts";
import { validate_document_path } from "../src/api/livemap/index.ts";
import { create_persistent_locus } from "../src/api/locus/index.ts";
import type { LocusSocketLike } from "../src/types/locus.types.ts";
import { create_livehost_locus_registry } from "../src/api/livehost/index.ts";
import { install_fake_document } from "./helpers/fake-document.mts";
import { create_livetree } from "../src/api/livetree/creation/create-livetree.ts";
import { create_test_event_emitter } from "./test-events.mjs";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";
import { read_locus_retained_action_status_internal } from "../src/api/locus/locus.action-status.internal.ts";
import { encode_locus_portable_graph_content } from "../src/api/locus/locus.graph-content-codec.ts";

const StateSchema: HsonSchema = Hson.schema`<type "data" content <theme "string" count <number <int true min 0>>>>`;
const ColorsSchema: HsonSchema = Hson.schema`<type "data" content <theme "string" accent "string">>`;
const PageSchema: HsonSchema = Hson.schema`<type "document" tag "main" content <repeat <tag "item" content "empty">>>`;
const QUID = "000008205";
const RECOVERY_QUID = "000008207";
const RECOVERY_NEXT_QUID = "000008208";
const PERSISTED_QUID = "000008209";
const PERSISTED_NEXT_QUID = "000008210";
const LOCUS_RESTART_A_QUID = "000008211";
const LOCUS_RESTART_B_QUID = "000008212";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "locus.hosted-multi-library-h5",
  title: "Hosted multi-library H5",
  category: "Locus",
  runtime: "node",
  tags: Object.freeze(["locus", "echo", "livemap", "libraries", "hosted", "h5"]),
});

const testEvents = create_test_event_emitter("locus.hosted-multi-library-h5");
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
}> {
  const clientMessages = new Set<(raw: string) => void>();
  const serverMessages = new Set<(raw: string) => void>();
  const clientCloses = new Set<() => void>();
  const serverCloses = new Set<() => void>();
  const clientSent: string[] = [];
  const serverSent: string[] = [];
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
      for (const listener of [...clientMessages]) listener(raw);
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
  return Object.freeze({ client, server, clientSent, serverSent });
}

function make_map() {
  return hsonLiveMap.fromLibraries({
    state: { data: { theme: "light", count: 0 }, schema: StateSchema },
    colors: { data: { theme: "light", accent: "#000" }, schema: ColorsSchema },
    page: { document: "<main/>", schema: PageSchema },
  });
}

function reflected_document_element(reflection: ReturnType<typeof hsonMirror>) {
  const node = reflection.tree.node.$_content[0];
  if (node === null || typeof node !== "object") throw new Error("Expected reflected document element.");
  return create_livetree(node).adoptRoots(reflection.tree.hostRootNode());
}

function wait_for_aggregate_revision(map: ReturnType<typeof make_map>, revision: number): Promise<void> {
  if (map.rev >= revision) return Promise.resolve();
  return new Promise((resolve) => {
    const off = map.commits.observe(() => {
      if (map.rev < revision) return;
      off();
      resolve();
    });
  });
}

class MemoryPersistence {
  private state: Readonly<{ checkpoint: unknown; commits: readonly unknown[] }> | undefined;
  failAppends = false;

  snapshot(): unknown { return this.state; }

  async load(_logicalMapId: string): Promise<unknown | undefined> {
    return this.state;
  }

  async appendCommit(record: unknown): Promise<void> {
    if (this.failAppends) throw new Error("append rejected");
    if (this.state === undefined) throw new Error("missing checkpoint");
    this.state = Object.freeze({ ...this.state, commits: Object.freeze([...this.state.commits, record]) });
  }

  async replaceCheckpoint(record: unknown): Promise<void> {
    const revision = (record as { rev: number }).rev;
    const prior = this.state?.commits ?? [];
    this.state = Object.freeze({
      checkpoint: record,
      commits: Object.freeze(prior.filter((item) => (item as { commit: { rev: number } }).commit.rev > revision)),
    });
  }

  corrupt(): void {
    this.state = Object.freeze({ checkpoint: Object.freeze({}), commits: Object.freeze([]) });
  }
}

function insert_item(quid = QUID) {
  return {
    domain: "graph" as const,
    op: "insert-content" as const,
    target: { kind: "path" as const, path: validate_document_path([0]) },
    index: 0,
    content: {
      $_tag: "_hson_elem" as const,
      $_content: [{ $_tag: "item", $_meta: { quid }, $_content: [] }],
    },
  };
}

function remove_item() {
  return {
    domain: "graph" as const,
    op: "remove-content" as const,
    target: { kind: "path" as const, path: validate_document_path([0]) },
    index: 0,
  };
}

function page_item(map: ReturnType<typeof make_map>): import("../src/core/types.js").HsonNode | undefined {
  const main = map.lib("page").root().$_content[0];
  if (typeof main !== "object" || main === null) return undefined;
  const wrapper = main.$_content[0];
  if (typeof wrapper !== "object" || wrapper === null) return undefined;
  const item = wrapper.$_content[0];
  return typeof item === "object" && item !== null ? item : undefined;
}

await check("the public Locus and Echo paths bootstrap one typed aggregate mirror and replay atomic named-library actions", async () => {
  install_fake_document();
  const serverMap = make_map();
  const locus = hsonLocus.create({
    map: serverMap,
    actions: {
      "theme.all": async (context) => {
        await context.mutate((draft) => {
          draft.lib("state").at(["theme"]).set("dark");
          draft.lib("colors").at(["theme"]).set("blue");
          draft.lib("page").graph(insert_item());
        });
        return Hson.data.from("ok");
      },
      "state.only": async (context) => {
        assert.equal(typeof context.emitEvent, "function");
        assert.equal("emit_event" in context, false);
        await context.mutate((draft) => draft.lib("state").at(["count"]).set(1));
      },
      invalid: async (context) => {
        await context.mutate((draft) => draft.lib("state").at(["count"]).set("invalid"));
      },
    },
  });
  const pair = socket_pair();
  assert.equal(typeof locus.dispatchAction, "function");
  assert.equal("dispatch_action" in locus, false);
  locus.connect(pair.server);
  const clientMap = make_map();
  const client = hsonEcho.create({
    socket: pair.client,
    map: clientMap,
    recovery: { logicalMapId: locus.logicalMapId },
  });
  assert.equal(typeof client.retryAction, "function");
  assert.equal(typeof client.actionStatus, "function");
  assert.equal(typeof client.dispose, "function");
  for (const removed of ["recover", "close", "retry_action", "action_status"]) {
    assert.equal(removed in client, false, `unexpected multi-library Echo method ${removed}`);
  }
  const started = performance.now();
  client.connect();
  const established = await client.session.create();
  assert.equal(established.logicalMapId, locus.logicalMapId);
  assert.equal(established.incarnationId, locus.incarnationId);
  assert.equal(client.session.logicalMapId, locus.logicalMapId);
  assert.equal(client.session.incarnationId, locus.incarnationId);
  const bootstrap = await client.recovery.recover();
  const bootstrapMs = performance.now() - started;
  assert.equal(bootstrap.strategy, "snapshot");
  assert.equal(client.map, clientMap);
  assert.equal(client.map.rev, 0);
  assert.throws(() => clientMap.lib("state").at(["count"]).set(9), /exclusive Locus authority/i);
  assert.equal("subscribe" in client, false);
  assert.equal("unsubscribe" in client, false);
  const invalid = await client.action("invalid");
  assert.equal(invalid.type, "error");
  if (invalid.type === "error") assert.match(invalid.error.message, /schema/i);
  const wrongLibrary = await client.action("document.content.remove", {
      library: "state",
      target: { kind: "path", path: [0] },
      index: 0,
    });
  assert.equal(wrongLibrary.type, "error");
  if (wrongLibrary.type === "error") assert.match(wrongLibrary.error.message, /document/i);
  assert.deepEqual([serverMap.rev, clientMap.rev], [0, 0]);
  const page = client.map.lib("page");
  const reflection = hsonMirror(page);
  const stateValues: unknown[] = [];
  const colorsValues: unknown[] = [];
  const stopState = client.map.commits.observe((commit) => stateValues.push([client.map.lib("state").snap(["theme"]), commit.rev]));
  const stopColors = client.map.commits.observe((commit) => colorsValues.push([client.map.lib("colors").snap(["theme"]), commit.rev]));
  const aggregateStarted = performance.now();
  const themeAll = await client.action("theme.all");
  assert.equal(themeAll.type, "ack");
  if (themeAll.type === "ack") assert.equal(themeAll.result === undefined ? undefined : Hson.data.materialize(themeAll.result), "ok");
  const stateColorsPageMs = performance.now() - aggregateStarted;
  assert.deepEqual([serverMap.rev, clientMap.rev], [1, 1]);
  assert.equal(clientMap.lib("state").snap(["theme"]), "dark");
  assert.equal(clientMap.lib("colors").snap(["theme"]), "blue");
  assert.equal(page.document.byQuid(QUID), undefined);
  assert.equal(page_item(clientMap)?.$_tag, "item");
  assert.equal(reflection.sourceRevision, 1);
  assert.equal(reflection.diagnostics().updatesApplied, 1);
  assert.deepEqual(stateValues.at(-1), ["dark", 1]);
  assert.deepEqual(colorsValues.at(-1), ["blue", 1]);
  const published = pair.serverSent
    .map((raw) => JSON.parse(raw) as Record<string, unknown>)
    .find((message) => message.type === "commit") as Record<string, any> | undefined;
  assert.deepEqual(published?.commit?.commit?.operations?.map((operation: { library: string }) => operation.library), ["state", "colors", "page"]);
  assert.deepEqual([published?.commit?.commit?.prevRev, published?.commit?.commit?.rev], [0, 1]);
  assert.equal(JSON.stringify(published).includes(QUID), false);
  const stateOnlyStarted = performance.now();
  await client.action("state.only");
  const stateOnlyMs = performance.now() - stateOnlyStarted;
  assert.equal(reflection.sourceRevision, 2);
  assert.equal(reflection.diagnostics().updatesApplied, 1);
  assert.equal(client.recovery.lastAppliedRev, 2);
  const reflectedMain = reflected_document_element(reflection);
  const reflectedWrite = reflectedMain.async.attrs.set("title", "echoed");
  assert.equal(serverMap.lib("page").document.attrs.get({ kind: "path", path: [0] }, "title"), undefined);
  await wait_for_aggregate_revision(clientMap, 3);
  await reflectedWrite;
  assert.equal(serverMap.lib("page").document.attrs.get({ kind: "path", path: [0] }, "title"), "echoed");
  assert.equal(reflectedMain.attrs.get("title"), "echoed");
  assert.equal(reflection.sourceRevision, 3);
  const replacementRequest = JSON.parse(JSON.stringify({
    library: "page",
    target: { kind: "path", path: [0, 0] },
    index: 0,
    replacement: encode_locus_portable_graph_content({ $_tag: "item", $_attrs: { title: "lineage" }, $_content: [] }),
    lineage: [{ source: [], destination: [] }],
  }));
  const replacementResult = await client.action("document.content.replace", replacementRequest);
  assert.equal(replacementResult.type, "ack", JSON.stringify(replacementResult));
  await wait_for_aggregate_revision(clientMap, 4);
  assert.equal(serverMap.lib("page").document.byQuid(QUID)?.$_attrs?.title, "lineage");
  assert.equal(clientMap.lib("page").document.byQuid(QUID), undefined);
  assert.equal(page_item(clientMap)?.$_attrs?.title, "lineage");
  assert.equal(reflection.sourceRevision, 4);
  stopState();
  stopColors();
  reflection.dispose();
  process.stdout.write(`# telemetry ${JSON.stringify({ bootstrapMs, stateOnlyMs, stateColorsPageMs, aggregateCommitBytes: new TextEncoder().encode(JSON.stringify(published)).byteLength })}\n`);
  client.dispose();
  locus.dispose();
});

await check("named document Echo authoring honors aggregate authorization and continues after denial", async () => {
  install_fake_document();
  const decisions = [false, true];
  const serverMap = make_map();
  const locus = hsonLocus.create({
    map: serverMap,
    authorizeAction: () => decisions.shift() ?? true,
  });
  const pair = socket_pair();
  locus.connect(pair.server, { principalId: "principal-a" });
  const clientMap = make_map();
  const echo = hsonEcho.create({
    socket: pair.client,
    map: clientMap,
    recovery: { logicalMapId: locus.logicalMapId },
  });
  echo.connect();
  await echo.session.create();
  await echo.recovery.recover();
  const reflection = hsonMirror(clientMap.lib("page"));
  const main = reflected_document_element(reflection);
  const denied = main.async.attrs.set("title", "denied");
  const accepted = main.async.attrs.set("id", "accepted");
  await assert.rejects(denied, (error) => Reflect.get(error as object, "code") === "LOCUS_ACTION_FORBIDDEN");
  await accepted;
  await wait_for_aggregate_revision(clientMap, 1);
  assert.equal(serverMap.rev, 1);
  assert.equal(clientMap.rev, 1);
  assert.equal(main.attrs.get("title"), undefined);
  assert.equal(main.attrs.get("id"), "accepted");
  assert.equal(reflection.status, "active");
  reflection.dispose();
  echo.dispose();
  locus.dispose();
});

await check("named Mirror text replacement carries empty portable lineage through Echo and Locus", async () => {
  install_fake_document();
  const TextPageSchema: HsonSchema = Hson.schema`<type "document" tag "main" content <repeat <tag "item" content "string">>>`;
  const definitions = { page: { document: "<main <item \"old\"/>/>", schema: TextPageSchema } } as const;
  const serverMap = hsonLiveMap.fromLibraries(definitions);
  const locus = hsonLocus.create({ map: serverMap });
  const pair = socket_pair();
  locus.connect(pair.server);
  const clientMap = hsonLiveMap.fromLibraries(definitions);
  const echo = hsonEcho.create({ socket: pair.client, map: clientMap, recovery: { logicalMapId: locus.logicalMapId } });
  echo.connect();
  await echo.session.create();
  await echo.recovery.recover();
  const reflection = hsonMirror(clientMap.lib("page"));
  const lineages: unknown[] = [];
  const stop = serverMap.commits.observe((commit) => {
    for (const entry of commit.operations) {
      if ("op" in entry.operation && entry.operation.op === "replace-content") lineages.push(entry.operation.lineage);
    }
  });
  await reflection.tree.find.must.byTag("item").async.text.set("new");
  assert.deepEqual(lineages, [[]]);
  assert.equal(serverMap.rev, 1);
  assert.equal(clientMap.rev, 1);
  assert.equal(reflection.sourceRevision, 1);
  assert.equal(reflection.tree.find.must.byTag("item").text.get(), "new");
  assert.equal(clientMap.lib("page").document.byQuid(QUID), undefined);
  stop(); reflection.dispose(); echo.dispose(); locus.dispose();
});

await check("public recovery replays retained history and replaces one complete observed mirror in place", async () => {
  install_fake_document();
  const serverMap = make_map();
  const locus = hsonLocus.create({ map: serverMap });
  await locus.mutate((draft) => {
    draft.lib("state").at(["theme"]).set("dark");
    draft.lib("page").graph(insert_item(RECOVERY_QUID));
  });

  const staleMap = make_map();
  const staleAuthority = internal_livemap_aggregate_authority(staleMap);
  const pageIndex = staleAuthority.hostedRegistry().libraries.findIndex((library) => library.name === "page");
  const pageIdentity = staleAuthority.libraries()[pageIndex];
  if (pageIdentity === undefined) throw new Error("Expected page Library identity.");
  staleAuthority.commit([{
    target: staleAuthority.target(pageIdentity, [0]),
    kind: "graph",
    operation: insert_item(RECOVERY_QUID),
  }]);
  const stateHandle = staleMap.lib("state").at(["theme"]);
  const reflection = hsonMirror(staleMap.lib("page"));
  const staleMain = reflected_document_element(reflection);
  const staleItem = staleMain.content.mustOnly({ warn: false });
  const staleMainNode = staleMain.node;
  const staleItemNode = staleItem.node;
  staleAuthority.restoreHosted(staleAuthority.captureHosted());
  assert.equal(reflected_document_element(reflection).node, staleMain.node);
  assert.equal(staleItem.isDisposed, false);
  const first = socket_pair();
  locus.connect(first.server);
  const snapshotClient = hsonEcho.create({
    socket: first.client,
    map: staleMap,
    recovery: { logicalMapId: locus.logicalMapId },
  });
  assert.equal("onChange" in snapshotClient.recovery, false);
  const snapshotStarted = performance.now();
  snapshotClient.connect();
  await snapshotClient.session.create();
  assert.equal((await snapshotClient.recovery.recover()).strategy, "snapshot");
  const snapshotReplacementMs = performance.now() - snapshotStarted;
  assert.equal(snapshotClient.map, staleMap);
  assert.equal(stateHandle.snap(), "dark");
  assert.equal(staleMap.lib("page").document.byQuid(RECOVERY_QUID), undefined);
  assert.equal(page_item(staleMap)?.$_tag, "item");
  assert.equal(reflection.sourceRevision, 1);
  const restoredMain = reflected_document_element(reflection);
  const restoredItem = restoredMain.content.mustOnly({ warn: false });
  assert.equal(staleMain.isDisposed, true);
  assert.equal(staleItem.isDisposed, true);
  assert.notEqual(restoredMain.node, staleMainNode);
  assert.notEqual(restoredItem.node, staleItemNode);
  snapshotClient.dispose();

  await locus.mutate((draft) => {
    draft.lib("state").at(["count"]).set(2);
    draft.lib("page").graph(remove_item());
    draft.lib("page").graph(insert_item(RECOVERY_NEXT_QUID));
  });
  const second = socket_pair();
  locus.connect(second.server);
  const replayClient = hsonEcho.create({
    socket: second.client,
    map: staleMap,
    recovery: { logicalMapId: locus.logicalMapId },
  });
  const replayStarted = performance.now();
  replayClient.connect();
  await replayClient.session.create();
  assert.equal((await replayClient.recovery.recover()).strategy, "replay");
  const retainedReplayMs = performance.now() - replayStarted;
  assert.deepEqual([staleMap.rev, stateHandle.snap(), reflection.sourceRevision], [2, "dark", 2]);
  assert.equal(staleMap.lib("page").document.byQuid(RECOVERY_NEXT_QUID), undefined);
  assert.equal(page_item(staleMap)?.$_tag, "item");
  assert.equal(reflected_document_element(reflection).node, restoredMain.node);
  assert.equal(staleItem.isDisposed, true);
  assert.equal((await replayClient.recovery.recover()).strategy, "current");
  process.stdout.write(`# telemetry ${JSON.stringify({ snapshotReplacementMs, retainedReplayMs })}\n`);
  reflection.dispose();
  replayClient.dispose();
  locus.dispose();
});

await check("LiveHost lifecycle composition treats the multi-library Locus as one ordinary authority", async () => {
  const locus = hsonLocus.create({ map: make_map() });
  const registry = create_livehost_locus_registry({
    maxLoci: 1,
    idleMs: 0,
    automaticSweep: false,
    create: () => locus,
  });
  const acquired = await registry.acquire("h5-livehost");
  assert.equal(acquired.ok, true);
  if (!acquired.ok) throw new Error("Expected LiveHost acquisition.");
  assert.equal(acquired.value.locus, locus);
  acquired.value.release();
  await registry.dispose();
});

await check("the public socket fails closed for malformed requests and an ahead global recovery cursor", async () => {
  const map = make_map();
  const locus = hsonLocus.create({ map });
  const pair = socket_pair();
  locus.connect(pair.server);
  pair.client.send("{");
  assert.equal(
    pair.serverSent.map((raw) => JSON.parse(raw) as Record<string, unknown>).some((message) => message.type === "error"),
    true,
  );

  pair.client.send(JSON.stringify({ type: "recover", id: "bootstrap", logicalMapId: locus.logicalMapId }));
  await Promise.resolve();
  const bootstrap = pair.serverSent
    .map((raw) => JSON.parse(raw) as Record<string, any>)
    .find((message) => message.type === "recovery-snapshot");
  assert.ok(bootstrap?.snapshot);
  pair.client.send(JSON.stringify({
    type: "recover",
    id: "ahead",
    logicalMapId: locus.logicalMapId,
    incarnationId: bootstrap.snapshot.authority.incarnationId,
    registryDigest: bootstrap.snapshot.registryDigest,
    lastAppliedRev: 1,
  }));
  await Promise.resolve();
  const ahead = pair.serverSent
    .map((raw) => JSON.parse(raw) as Record<string, any>)
    .find((message) => message.type === "recovery-plan" && message.id === "ahead");
  assert.equal(ahead?.outcome, "reject");
  assert.match(ahead?.error?.message ?? "", /ahead/i);
  assert.equal(map.rev, 0);
  locus.dispose();
});

await check("the public persistence path checkpoints, reloads, recovers, and continues one global aggregate stream", async () => {
  install_fake_document();
  const persistence = new MemoryPersistence();
  const serverMap = make_map();
  const host = await create_persistent_locus({
    map: serverMap,
    logicalMapId: "h5-persisted-map",
    persistence,
    actions: {
      "state.page": async (context) => {
        await context.mutate((draft) => {
          draft.lib("state").at(["count"]).set(2);
          draft.lib("page").graph(insert_item(PERSISTED_QUID));
        });
      },
      "page.retire": async (context) => {
        await context.mutate((draft) => draft.lib("page").graph(remove_item()));
      },
    },
  });
  const first = socket_pair();
  host.connect(first.server);
  const clientMap = make_map();
  const client = hsonEcho.create({ socket: first.client, map: clientMap, recovery: { logicalMapId: host.logicalMapId } });
  client.connect();
  await client.session.create();
  await client.recovery.recover();
  const reflection = hsonMirror(clientMap.lib("page"));
  const echoMainQuid = reflected_document_element(reflection).quid;
  const retainedAction = client.action("state.page");
  await retainedAction;
  const retainedStatus = read_locus_retained_action_status_internal(host, {
    clientId: client.clientId,
    requestId: retainedAction.request.requestId,
  });
  assert.equal(retainedStatus.ok && retainedStatus.state, "succeeded");
  assert.equal(clientMap.rev, 1);
  await client.action("page.retire");
  assert.equal(clientMap.rev, 2);
  assert.equal(clientMap.lib("page").document.byQuid(PERSISTED_QUID), undefined);
  const locusA = internal_livemap_aggregate_authority(serverMap);
  const locusPageA = locusA.libraries()[2];
  if (locusPageA === undefined) throw new Error("Expected page Library.");
  locusA.acquireLocalDocumentIdentity(locusPageA, validate_document_path([0]), LOCUS_RESTART_A_QUID);
  assert.equal(serverMap.rev, 2);
  assert.equal(clientMap.lib("page").document.byQuid(LOCUS_RESTART_A_QUID), undefined);
  const checkpointStarted = performance.now();
  await host.checkpoint();
  assert.equal(JSON.stringify(persistence.snapshot()).includes(LOCUS_RESTART_A_QUID), false);
  const checkpointMs = performance.now() - checkpointStarted;
  host.dispose();
  assert.throws(() => read_locus_retained_action_status_internal(host, {
    clientId: client.clientId,
    requestId: retainedAction.request.requestId,
  }), /authority is unavailable/i);
  client.dispose();

  const restoredMap = make_map();
  const restartStarted = performance.now();
  const restored = await create_persistent_locus({
    map: restoredMap,
    logicalMapId: "h5-persisted-map",
    persistence,
    actions: {
      "state.page": async (context) => {
        await context.mutate((draft) => {
          draft.lib("state").at(["count"]).set(3);
          draft.lib("page").graph(insert_item(PERSISTED_NEXT_QUID));
        });
      },
    },
  });
  const restartLoadMs = performance.now() - restartStarted;
  assert.ok(restored);
  assert.equal(restored.map, restoredMap);
  assert.equal(restoredMap.rev, 2);
  const locusB = internal_livemap_aggregate_authority(restoredMap);
  const locusPageB = locusB.libraries()[2];
  if (locusPageB === undefined) throw new Error("Expected restored page Library.");
  assert.equal(locusB.resolveQuid(LOCUS_RESTART_A_QUID), undefined);
  locusB.acquireLocalDocumentIdentity(locusPageB, validate_document_path([0]), LOCUS_RESTART_B_QUID);
  assert.equal(restoredMap.rev, 2);
  assert.equal(clientMap.lib("page").document.byQuid(LOCUS_RESTART_B_QUID), undefined);
  const restoredRetainedStatus = read_locus_retained_action_status_internal(restored, {
    clientId: client.clientId,
    requestId: retainedAction.request.requestId,
  });
  assert.equal(restoredRetainedStatus.ok && restoredRetainedStatus.state, "unknown");
  const second = socket_pair();
  restored.connect(second.server);
  const recovered = hsonEcho.create({ socket: second.client, map: clientMap, recovery: { logicalMapId: restored.logicalMapId } });
  const reconnectStarted = performance.now();
  recovered.connect();
  await recovered.session.create();
  assert.equal((await recovered.recovery.recover()).strategy, "current");
  assert.equal(reflected_document_element(reflection).quid, echoMainQuid);
  assert.equal(second.serverSent.join("\n").includes(LOCUS_RESTART_A_QUID), false);
  assert.equal(second.serverSent.join("\n").includes(LOCUS_RESTART_B_QUID), false);
  const fallbackPair = socket_pair();
  restored.connect(fallbackPair.server);
  const fallbackMap = make_map();
  const fallback = hsonEcho.create({
    socket: fallbackPair.client, map: fallbackMap, recovery: { logicalMapId: restored.logicalMapId },
  });
  fallback.connect();
  await fallback.session.create();
  assert.equal((await fallback.recovery.recover()).strategy, "snapshot");
  assert.equal(fallbackMap.rev, restored.rev);
  assert.equal(fallbackMap.lib("state").snap(["count"]), 2);
  assert.equal(fallbackMap.lib("page").document.byQuid(LOCUS_RESTART_A_QUID), undefined);
  assert.equal(fallbackMap.lib("page").document.byQuid(LOCUS_RESTART_B_QUID), undefined);
  assert.equal(fallbackPair.serverSent.join("\n").includes(LOCUS_RESTART_A_QUID), false);
  assert.equal(fallbackPair.serverSent.join("\n").includes(LOCUS_RESTART_B_QUID), false);
  fallback.dispose();
  const reconnectMs = performance.now() - reconnectStarted;
  assert.equal(clientMap.lib("page").document.byQuid(PERSISTED_QUID), undefined);
  assert.equal(reflection.sourceRevision, 2);
  assert.equal(internal_livemap_aggregate_authority(restoredMap).captureHosted().identity.issuedQuids.includes(PERSISTED_QUID), false);
  assert.equal(clientMap.rev, 2);
  const continuedStatePageStarted = performance.now();
  await recovered.action("state.page");
  const continuedStatePageMs = performance.now() - continuedStatePageStarted;
  assert.deepEqual([restored.rev, clientMap.rev, clientMap.lib("state").snap(["count"])], [3, 3, 3]);
  assert.equal(clientMap.lib("page").document.byQuid(PERSISTED_NEXT_QUID), undefined);
  assert.equal(page_item(clientMap)?.$_tag, "item");
  assert.equal(reflection.sourceRevision, 3);
  process.stdout.write(`# telemetry ${JSON.stringify({ checkpointMs, restartLoadMs, reconnectMs, continuedStatePageMs })}\n`);
  recovered.dispose();
  reflection.dispose();
  restored.dispose();

  await assert.rejects(
    () => create_persistent_locus({
      map: hsonLiveMap.fromLibraries({
        state: { data: { theme: "light", count: 0 }, schema: StateSchema },
      }),
      logicalMapId: "h5-persisted-map",
      persistence,
    }),
    /registry.*topology/i,
  );

  persistence.corrupt();
  await assert.rejects(
    () => create_persistent_locus({ map: make_map(), logicalMapId: "h5-persisted-map", persistence }),
    /persisted state is invalid/i,
  );
});

await check("public hosted failures reject before acceptance and leave the aggregate unchanged", async () => {
  const persistence = new MemoryPersistence();
  const map = make_map();
  const host = await create_persistent_locus({
    map,
    persistence,
    actions: {
      increment: async (context) => {
        await context.mutate((draft) => draft.lib("state").at(["count"]).set(1));
      },
    },
  });
  persistence.failAppends = true;
  const result = await host.dispatchAction({ type: "action", id: "failed-append", name: "increment" });
  assert.equal(result.type, "error");
  assert.equal(map.rev, 0);
  host.dispose();
});

process.stdout.write(`1..${checks}\n`);
testEvents.terminal("pass");
