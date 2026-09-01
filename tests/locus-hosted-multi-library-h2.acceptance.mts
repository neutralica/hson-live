import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { Hson, hsonLiveMap, hsonReflect, validate_document_path, type HsonSchema } from "../src/index.ts";
import type { LiveMapLibraries } from "../src/types/livemap.types.ts";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";
import {
  create_locus_hosted_aggregate_client_internal,
  create_locus_hosted_aggregate_internal,
  type LocusHostedAggregateDataDraft,
  type LocusHostedAggregateDocumentDraft,
  type LocusHostedAggregateDraft,
} from "../src/api/locus/locus.hosted-multi-library.ts";
import { install_fake_document } from "./helpers/fake-document.mts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

const StateSchema: HsonSchema = Hson`<type "data" content <theme "string" count <number <int true min 0>> box <content <id "number">>>>`;
const ColorsSchema: HsonSchema = Hson`<type "data" content <accent "string">>`;
const PageSchema: HsonSchema = Hson`<type "document" tag "main" content <repeat <tag "item" content "empty">>>`;
const QUID = "000008202";

let checks = 0;
async function check(name: string, run: () => void | Promise<void>): Promise<void> {
  await run();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function make_map() {
  return hsonLiveMap.fromLibraries({
    state: { data: { theme: "light", count: 0, box: { id: 0 } }, schema: StateSchema },
    colors: { data: { accent: "#000" }, schema: ColorsSchema },
    page: { document: "<main/>", schema: PageSchema },
  });
}

function data(draft: LocusHostedAggregateDraft, name: string): LocusHostedAggregateDataDraft {
  const library = draft.lib(name);
  if (!("at" in library)) throw new Error(`Expected data Library ${name}`);
  return library;
}

function document(draft: LocusHostedAggregateDraft, name: string): LocusHostedAggregateDocumentDraft {
  const library = draft.lib(name);
  if (!("graph" in library)) throw new Error(`Expected document Library ${name}`);
  return library;
}

function data_library(libraries: LiveMapLibraries, name: string) {
  const library = libraries.lib(name);
  if (!("snap" in library)) throw new Error(`Expected data Library ${name}`);
  return library;
}

function document_library(libraries: LiveMapLibraries, name: string) {
  const library = libraries.lib(name);
  if (!("document" in library)) throw new Error(`Expected document Library ${name}`);
  return library;
}

function insert_item(quid = QUID) {
  return {
    domain: "graph" as const,
    op: "insert-content" as const,
    target: { kind: "path" as const, path: validate_document_path([0]) },
    index: 0,
    content: {
      $_tag: "_hson_elem",
      $_content: [{ $_tag: "item", $_meta: { quid }, $_content: [] }],
    },
  };
}

await check("one managed action stages state, colors, and page behind one gate and one revision", async () => {
  const map = make_map();
  const seed = internal_livemap_aggregate_authority(map).captureHosted();
  assert.equal(seed.authority.logicalMapId.startsWith("h1-"), false);
  assert.equal(seed.authority.incarnationId.startsWith("h1-"), false);
  const wires: string[] = [];
  const gateSeen: unknown[] = [];
  let publications = 0;
  map.commits.observe(() => { publications += 1; });
  const server = create_locus_hosted_aggregate_internal({
    map,
    send: (wire) => wires.push(wire),
    gate: ({ commit }) => {
      gateSeen.push({
        before: [map.lib("state").snap(["theme"]), map.lib("colors").snap(["accent"]), map.rev],
        operations: commit.operations.map((operation) => operation.library),
      });
    },
    actions: {
      "theme.all": async (context) => {
        await context.mutate((draft) => {
          data(draft, "state").at(["theme"]).set("dark");
          data(draft, "colors").at(["accent"]).replace("#fff");
          const pageInsert = insert_item();
          document(draft, "page").content.insert(pageInsert.target, pageInsert.index, pageInsert.content);
        });
        return "ok";
      },
    },
  });
  assert.throws(() => map.lib("state").at(["theme"]).set("bypass"), /controlled by an exclusive Locus authority/i);
  assert.equal(await server.dispatch_action("theme.all"), "ok");
  assert.deepEqual(gateSeen, [{
    before: ["light", "#000", 0],
    operations: ["state", "colors", "page"],
  }]);
  assert.equal(map.rev, 1);
  assert.equal(map.lib("state").snap(["theme"]), "dark");
  assert.equal(map.lib("colors").snap(["accent"]), "#fff");
  assert.equal(map.lib("page").document.byQuid(QUID)?.$_tag, "item");
  assert.equal(publications, 1);
  assert.equal(wires.length, 1);

  const client = create_locus_hosted_aggregate_client_internal(seed);
  let observerState: unknown;
  client.map.commits.observe(() => {
    observerState = [
      data_library(client.map, "state").snap(["theme"]),
      data_library(client.map, "colors").snap(["accent"]),
      document_library(client.map, "page").document.byQuid(QUID)?.$_tag,
      client.map.rev,
    ];
  });
  client.apply_wire(wires[0]!);
  assert.deepEqual(observerState, ["dark", "#fff", "item", 1]);
  assert.deepEqual(internal_livemap_aggregate_authority(client.map).captureHosted(), internal_livemap_aggregate_authority(map).captureHosted());
  server.dispose();
});

await check("invalid later Library, an action throw, and a rejected gate leave all state and wire output unchanged", async () => {
  const map = make_map();
  const wires: string[] = [];
  const server = create_locus_hosted_aggregate_internal({
    map,
    send: (wire) => wires.push(wire),
    gate: ({ commit }) => {
      if (commit.operations.some((entry) => entry.library === "colors")) throw new Error("durability rejected");
    },
    actions: {
      invalid: (context) => context.mutate((draft) => {
        data(draft, "state").at(["theme"]).set("dark");
        data(draft, "colors").at(["accent"]).set(1 as never);
      }),
      thrower: (context) => {
        void context.mutate((draft) => data(draft, "state").at(["theme"]).set("dark"));
        throw new Error("application threw");
      },
      gated: (context) => context.mutate((draft) => {
        data(draft, "state").at(["theme"]).set("dark");
        data(draft, "colors").at(["accent"]).set("#fff");
      }),
    },
  });
  const before = internal_livemap_aggregate_authority(map).captureHosted();
  await assert.rejects(() => server.dispatch_action("invalid"), /schema/i);
  assert.deepEqual(internal_livemap_aggregate_authority(map).captureHosted(), before);
  await assert.rejects(() => server.dispatch_action("thrower"), /application threw/);
  assert.deepEqual(internal_livemap_aggregate_authority(map).captureHosted(), before);
  await assert.rejects(() => server.dispatch_action("gated"), /durability rejected/);
  assert.deepEqual(internal_livemap_aggregate_authority(map).captureHosted(), before);
  assert.deepEqual(wires, []);
  server.dispose();
});

await check("wire fencing, stale revisions, malformed replay evidence, and schema failure reject atomically on one mirror", async () => {
  const map = make_map();
  const seed = internal_livemap_aggregate_authority(map).captureHosted();
  const wires: string[] = [];
  const server = create_locus_hosted_aggregate_internal({ map, send: (wire) => wires.push(wire) });
  await server.mutate((draft) => {
    data(draft, "state").at(["theme"]).set("dark");
    data(draft, "colors").at(["accent"]).set("#fff");
  });
  const wire = wires[0]!;
  const client = create_locus_hosted_aggregate_client_internal(seed);
  const before = internal_livemap_aggregate_authority(client.map).captureHosted();
  const oldAggregateFormat = JSON.parse(wire) as any;
  oldAggregateFormat.commit.format = "hson-locus-hosted-aggregate-h2";
  assert.throws(() => client.apply_wire(JSON.stringify(oldAggregateFormat)), /format|incompatible/i);
  const oldCommitFormat = JSON.parse(wire) as any;
  oldCommitFormat.commit.commit.format = "hson-hosted-commit-h1";
  assert.throws(() => client.apply_wire(JSON.stringify(oldCommitFormat)), /format|incompatible/i);
  const registryMismatch = JSON.parse(wire) as any;
  registryMismatch.commit.registryDigest = "0".repeat(64);
  assert.throws(() => client.apply_wire(JSON.stringify(registryMismatch)), /fence/i);
  assert.deepEqual(internal_livemap_aggregate_authority(client.map).captureHosted(), before);
  const malformed = JSON.parse(wire) as any;
  malformed.commit.commit.replay.operations[1].payload = "{}";
  assert.throws(() => client.apply_wire(JSON.stringify(malformed)), /disagree|payload|malformed/i);
  assert.deepEqual(internal_livemap_aggregate_authority(client.map).captureHosted(), before);
  client.apply_wire(wire);
  const accepted = internal_livemap_aggregate_authority(client.map).captureHosted();
  assert.throws(() => client.apply_wire(wire), /revision|expected/i);
  assert.deepEqual(internal_livemap_aggregate_authority(client.map).captureHosted(), accepted);
  server.dispose();
});

await check("page Reflect receives structural work once while unrelated data only advances its global cursor", async () => {
  install_fake_document();
  const map = make_map();
  const seed = internal_livemap_aggregate_authority(map).captureHosted();
  const wires: string[] = [];
  const server = create_locus_hosted_aggregate_internal({ map, send: (wire) => wires.push(wire) });
  const client = create_locus_hosted_aggregate_client_internal(seed);
  const binding = hsonReflect(document_library(client.map, "page"));
  await server.mutate((draft) => {
    data(draft, "state").at(["theme"]).set("dark");
    document(draft, "page").graph(insert_item());
  });
  client.apply_wire(wires[0]!);
  assert.equal(binding.sourceRevision, 1);
  assert.equal(binding.diagnostics().updatesApplied, 1);
  assert.equal(document_library(client.map, "page").document.byQuid(QUID)?.$_tag, "item");
  await server.mutate((draft) => data(draft, "colors").at(["accent"]).set("#fff"));
  client.apply_wire(wires[1]!);
  assert.equal(binding.sourceRevision, 2);
  assert.equal(binding.diagnostics().updatesApplied, 1);
  binding.dispose();
  server.dispose();
});

await check("QUID collisions and oversized live envelopes reject before aggregate acceptance", async () => {
  const map = make_map();
  const server = create_locus_hosted_aggregate_internal({ map, maxWireBytes: 512 });
  const before = internal_livemap_aggregate_authority(map).captureHosted();
  await assert.rejects(() => server.mutate((draft) => {
    data(draft, "state").at(["box"]).ensureQuid(QUID);
    document(draft, "page").graph(insert_item(QUID));
  }), /collision/i);
  assert.deepEqual(internal_livemap_aggregate_authority(map).captureHosted(), before);
  await assert.rejects(() => server.mutate((draft) => data(draft, "state").at(["theme"]).set("dark")), /byte limit/i);
  assert.deepEqual(internal_livemap_aggregate_authority(map).captureHosted(), before);
  server.dispose();
});

await check("hosted actions remain FIFO and report focused prepare/replay telemetry", async () => {
  const map = make_map();
  const seed = internal_livemap_aggregate_authority(map).captureHosted();
  const wires: string[] = [];
  const server = create_locus_hosted_aggregate_internal({ map, send: (wire) => wires.push(wire) });
  const serverStart = performance.now();
  const [first, second] = await Promise.all([
    server.mutate((draft) => {
      data(draft, "state").at(["theme"]).set("dark");
      data(draft, "colors").at(["accent"]).set("#fff");
    }),
    server.mutate((draft) => data(draft, "state").at(["count"]).set(1)),
  ]);
  const serverMs = performance.now() - serverStart;
  assert.deepEqual([first?.prevRev, first?.rev, second?.prevRev, second?.rev], [0, 1, 1, 2]);
  const client = create_locus_hosted_aggregate_client_internal(seed);
  const replayStart = performance.now();
  for (const wire of wires) client.apply_wire(wire);
  const replayMs = performance.now() - replayStart;
  const engine = internal_livemap_aggregate_authority(map).telemetry();
  assert.equal(client.map.rev, 2);
  assert.equal(engine.acceptedTransitions, 2);
  process.stdout.write(`# telemetry ${JSON.stringify({
    serverPrepareGateAcceptMs: serverMs,
    clientReplayMs: replayMs,
    serverEngine: engine,
    clientEngine: internal_livemap_aggregate_authority(client.map).telemetry(),
  })}\n`);
  server.dispose();
});

process.stdout.write(`1..${checks}\n`);
process.stdout.write(`Hosted multi-library H2 acceptance: ${checks}/${checks}\n`);
emit_hson_live_test_completion("locus.hosted-multi-library-h2", checks, checks, 0);
