import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  Hson,
  hsonLiveMap,
  hsonLocus,
  hsonEcho,
  hsonReflect,
  create_persistent_locus,
  validate_document_path,
  type HsonSchema,
} from "../src/index.ts";
import type { LocusSocketLike } from "../src/types/locus.types.ts";
import { create_livehost_locus_registry } from "../src/api/livehost/index.ts";
import { install_fake_document } from "./helpers/fake-document.mts";
import { create_livetree } from "../src/api/livetree/creation/create-livetree.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

const StateSchema: HsonSchema = Hson`<type "data" content <theme "string" count <number <int true min 0>>>>`;
const ColorsSchema: HsonSchema = Hson`<type "data" content <theme "string" accent "string">>`;
const PageSchema: HsonSchema = Hson`<type "document" tag "main" content <repeat <tag "item" content "empty">>>`;
const QUID = "000008205";
const RECOVERY_QUID = "000008207";
const RECOVERY_NEXT_QUID = "000008208";
const PERSISTED_QUID = "000008209";
const PERSISTED_NEXT_QUID = "000008210";

let checks = 0;
async function check(name: string, run: () => void | Promise<void>): Promise<void> {
  await run();
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

function reflected_document_element(reflection: ReturnType<typeof hsonReflect>) {
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
        return "ok";
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
  const bootstrap = await client.connect();
  const bootstrapMs = performance.now() - started;
  assert.equal(bootstrap.outcome, "snapshot");
  assert.equal(client.map, clientMap);
  assert.equal(client.map.rev, 0);
  assert.throws(() => clientMap.lib("state").at(["count"]).set(9), /exclusive Locus authority/i);
  assert.throws(() => {
    // @ts-expect-error Runtime input can still contain an unknown library name.
    client.subscribe("missing", [], () => {});
  }, /unknown/i);
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
  const reflection = hsonReflect(page);
  const stateValues: unknown[] = [];
  const colorsValues: unknown[] = [];
  const stopState = client.subscribe("state", ["theme"], (value, revision) => stateValues.push([value, revision]));
  const stopColors = client.subscribe("colors", ["theme"], (value, revision) => colorsValues.push([value, revision]));
  const aggregateStarted = performance.now();
  const themeAll = await client.action("theme.all");
  assert.equal(themeAll.type, "ack");
  if (themeAll.type === "ack") assert.equal(themeAll.result, "ok");
  const stateColorsPageMs = performance.now() - aggregateStarted;
  assert.deepEqual([serverMap.rev, clientMap.rev], [1, 1]);
  assert.equal(clientMap.lib("state").snap(["theme"]), "dark");
  assert.equal(clientMap.lib("colors").snap(["theme"]), "blue");
  assert.equal(page.document.byQuid(QUID)?.$_tag, "item");
  assert.equal(reflection.sourceRevision, 1);
  assert.equal(reflection.diagnostics().updatesApplied, 1);
  assert.deepEqual(stateValues.at(-1), ["dark", 1]);
  assert.deepEqual(colorsValues.at(-1), ["blue", 1]);
  const published = pair.serverSent
    .map((raw) => JSON.parse(raw) as Record<string, unknown>)
    .find((message) => message.type === "commit") as Record<string, any> | undefined;
  assert.deepEqual(published?.commit?.commit?.operations?.map((operation: { library: string }) => operation.library), ["state", "colors", "page"]);
  assert.deepEqual([published?.commit?.commit?.prevRev, published?.commit?.commit?.rev], [0, 1]);
  const stateOnlyStarted = performance.now();
  await client.action("state.only");
  const stateOnlyMs = performance.now() - stateOnlyStarted;
  assert.equal(reflection.sourceRevision, 2);
  assert.equal(reflection.diagnostics().updatesApplied, 1);
  assert.equal(client.lastAppliedRev, 2);
  const reflectedMain = reflected_document_element(reflection);
  reflectedMain.attrs.set("title", "echoed");
  assert.equal(serverMap.lib("page").document.attrs.get({ kind: "path", path: [0] }, "title"), undefined);
  await wait_for_aggregate_revision(clientMap, 3);
  assert.equal(serverMap.lib("page").document.attrs.get({ kind: "path", path: [0] }, "title"), "echoed");
  assert.equal(reflectedMain.attrs.get("title"), "echoed");
  assert.equal(reflection.sourceRevision, 3);
  stopState();
  client.unsubscribe("colors", ["theme"]);
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
  await echo.connect();
  const reflection = hsonReflect(clientMap.lib("page"));
  const main = reflected_document_element(reflection);
  main.attrs.set("title", "denied");
  main.attrs.set("id", "accepted");
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

await check("public recovery replays retained history, replaces one complete mirror in place, and resynchronizes qualified subscriptions", async () => {
  install_fake_document();
  const serverMap = make_map();
  const locus = hsonLocus.create({ map: serverMap });
  await locus.mutate((draft) => {
    draft.lib("state").at(["theme"]).set("dark");
    draft.lib("page").graph(insert_item(RECOVERY_QUID));
  });

  const staleMap = make_map();
  const stateHandle = staleMap.lib("state").at(["theme"]);
  const reflection = hsonReflect(staleMap.lib("page"));
  const first = socket_pair();
  locus.connect(first.server);
  const snapshotClient = hsonEcho.create({
    socket: first.client,
    map: staleMap,
    recovery: { logicalMapId: locus.logicalMapId },
  });
  const snapshotStarted = performance.now();
  assert.equal((await snapshotClient.connect()).outcome, "snapshot");
  const snapshotReplacementMs = performance.now() - snapshotStarted;
  assert.equal(snapshotClient.map, staleMap);
  assert.equal(stateHandle.snap(), "dark");
  assert.equal(staleMap.lib("page").document.byQuid(RECOVERY_QUID)?.$_tag, "item");
  assert.equal(reflection.sourceRevision, 1);
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
  assert.equal((await replayClient.connect()).outcome, "replay");
  const retainedReplayMs = performance.now() - replayStarted;
  assert.deepEqual([staleMap.rev, stateHandle.snap(), reflection.sourceRevision], [2, "dark", 2]);
  assert.equal(staleMap.lib("page").document.byQuid(RECOVERY_NEXT_QUID)?.$_tag, "item");
  const values: unknown[] = [];
  replayClient.subscribe("state", ["theme"], (value, revision) => values.push([value, revision]));
  assert.equal((await replayClient.connect()).outcome, "current");
  assert.deepEqual(values, [["dark", 2], ["dark", 2]]);
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
  await client.connect();
  const reflection = hsonReflect(clientMap.lib("page"));
  await client.action("state.page");
  assert.equal(clientMap.rev, 1);
  await client.action("page.retire");
  assert.equal(clientMap.rev, 2);
  assert.equal(clientMap.lib("page").document.byQuid(PERSISTED_QUID), undefined);
  const checkpointStarted = performance.now();
  await host.checkpoint();
  const checkpointMs = performance.now() - checkpointStarted;
  host.dispose();
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
      reuse: async (context) => {
        await context.mutate((draft) => draft.lib("page").graph(insert_item(PERSISTED_QUID)));
      },
    },
  });
  const restartLoadMs = performance.now() - restartStarted;
  assert.ok(restored);
  assert.equal(restored.map, restoredMap);
  assert.equal(restoredMap.rev, 2);
  const second = socket_pair();
  restored.connect(second.server);
  const recovered = hsonEcho.create({ socket: second.client, map: clientMap, recovery: { logicalMapId: restored.logicalMapId } });
  const reconnectStarted = performance.now();
  assert.equal((await recovered.connect()).outcome, "current");
  const reconnectMs = performance.now() - reconnectStarted;
  assert.equal(clientMap.lib("page").document.byQuid(PERSISTED_QUID), undefined);
  assert.equal(reflection.sourceRevision, 2);
  const reuse = await recovered.action("reuse");
  assert.equal(reuse.type, "error");
  if (reuse.type === "error") assert.match(reuse.error.message, /QUID|reuse|identity/i);
  assert.equal(clientMap.rev, 2);
  const continuedStatePageStarted = performance.now();
  await recovered.action("state.page");
  const continuedStatePageMs = performance.now() - continuedStatePageStarted;
  assert.deepEqual([restored.rev, clientMap.rev, clientMap.lib("state").snap(["count"])], [3, 3, 3]);
  assert.equal(clientMap.lib("page").document.byQuid(PERSISTED_NEXT_QUID)?.$_tag, "item");
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
emit_hson_live_test_completion("locus.hosted-multi-library-h5", checks, checks, 0);
