import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { bind_locus_http, hsonLiveMap } from "../../src/index.ts";
import { make_livemap_libraries, make_livemap_mirror_from_semantic_checkpoint_internal as restore } from "../../src/api/livemap/livemap.libraries.ts";
import { internal_livemap_aggregate_authority as owner } from "../../src/api/livemap/livemap.internal.ts";
import { lookup_document_quad_internal as lookup } from "../../src/api/livemap/livemap.document.quad.ts";
import { enumerate_livemap_issued_quids as issued } from "../../src/api/livemap/livemap.identity-epoch.ts";
import { encode_authoritative_scoped_commit } from "../../src/api/livemap/livemap.hosted.ts";
import { parse_document_stylesheet } from "../../src/internal/css/parse-document-stylesheet.ts";
import { echo_map_internal } from "../../src/internal/governor-maps.ts";
import { create_persistent_locus_hosted_aggregate_internal as persist,
  load_persistent_locus_hosted_aggregate_internal as load, checkpoint_libraries_equal, durable_aggregate_commit } from "../../src/api/locus/locus.aggregate.persistence.ts";
import { MemoryCheckpointAdapter } from "../helpers/memory-checkpoint-adapter.mts";
import type { LiveMap, LiveMapStagedWriter } from "../../src/types/livemap.types.ts";

type Writer = LiveMapStagedWriter<LiveMap, void>;
const document = '<main <b @:a title="same" disabled "Same"/> <i/>/>';
const css = '[hson\\:quad="a"]{color:red}';
function page(w: Writer, name = "page") {
  const lib = w.doc.must(name); assert.equal(lib.mode, "document");
  if (lib.mode !== "document") throw Error("document"); return lib;
}
function data(w: Writer, n: number) {
  const lib = w.data.must("data"); if (String(lib.mode) === "document") throw Error("data"); lib.at(["n"]).set(n);
}
function snapshot(map: LiveMap) {
  const a = owner(map);
  return { semantic: a.captureSemanticCheckpoint(), ledger: a.identityEpoch().issued(), position: a.hostedPosition(),
    refs: a.libraries().map(id => ({ root: a.root(id), scopes: a.documentScopes(id),
      ...(a.inspect().libraries.find(l => l.identity === id)!.mode === "document"
        ? { overlay: a.documentOverlay(id), css: a.stylesheet(id) } : {}) })) };
}
function unchanged(map: LiveMap, before: ReturnType<typeof snapshot>) {
  const after = snapshot(map);
  assert.deepEqual(after.semantic, before.semantic); assert.deepEqual(after.position, before.position);
  assert.equal(after.ledger, before.ledger);
  after.refs.forEach((r, i) => { const old = before.refs[i]!;
    assert.equal(r.root, old.root); assert.equal(r.scopes, old.scopes);
    assert.equal(r.overlay, old.overlay); assert.equal(r.css, old.css);
  });
}
async function fixture() {
  const map = make_livemap_libraries({ page: { document }, other: { document }, data: { data: { n: 0 } },
    parts: { parts: { p: { kind: "document", document: '<i "Scoped"/>', stylesheet: 'i{color:green}' } } },
    scoped: { document: '<aside <hson-part lib="parts" at="p"/>/>' } }, [], undefined,
  { page: parse_document_stylesheet(css, []), other: parse_document_stylesheet(css, []) });
  const adapter = new MemoryCheckpointAdapter(), locus = await persist({ map, persistence: adapter, scopedDocuments: true });
  const lib = map.doc.must("page"); assert.ok(lib.mode === "document");
  const quid = lookup(lib, "a")!.quid;
  return { map, adapter, locus, stylesheet: `[hson\\:quid="${quid}"]{color:blue}` };
}
async function durable(f: Awaited<ReturnType<typeof fixture>>) {
  const expected = owner(f.map).captureSemanticCheckpoint(), tail = f.adapter.state(f.locus.logicalMapId)!.commits;
  const restored = await load(f.locus.logicalMapId, { persistence: f.adapter, scopedDocuments: true }); assert.ok(restored);
  try {
    const actual = owner(restored.map).captureSemanticCheckpoint();
    assert.ok(checkpoint_libraries_equal(actual.libraries, expected.libraries));
    assert.equal(actual.revision, expected.revision); assert.deepEqual(actual.registry, expected.registry);
    assert.deepEqual(actual.authority, expected.authority);
  } finally { restored.dispose(); }
  const restart = spawnSync(process.execPath, ["--import=tsx", fileURLToPath(new URL("./flat-transaction-restart.mts", import.meta.url))], {
    encoding: "utf8", timeout: 30_000, input: JSON.stringify({ logicalMapId: f.locus.logicalMapId,
      states: [...f.adapter.states], chunks: [...f.adapter.chunks], manifests: [...f.adapter.manifests], expected, tail,
      sender: issued(owner(f.map).identityEpoch().issued()) }),
  });
  assert.equal(restart.status, 0, restart.stderr || String(restart.error));
  assert.equal(restart.stdout, "flat transaction restored");
  assert.deepEqual(f.adapter.state(f.locus.logicalMapId)!.commits, tail);
}
const noops: readonly ((w: Writer) => void)[] = [
  w => page(w).at([0]).asElement().attrs.set("title", "same"),
  w => page(w).at([0]).asElement().attrs.drop("missing"),
  w => page(w).at([0]).asElement().flags.set("disabled"),
  w => page(w).at([0,0]).replace("Same"),
  w => page(w).at([]).asElement().move(0, 0),
];

export async function flat_transaction_cases(check: (name: string, run: () => Promise<void>) => Promise<void>) {
  for (const kind of ["scoped", "data", "other"] as const) for (const position of [0, 1, 2]) for (const graph of [false, true]) {
    await check(`flat CSS position ${position}, graph ${graph}, among ${kind} operations survives durable restart`, async () => {
      const f = await fixture(), a = owner(f.map), base = a.captureSemanticCheckpoint(), receiver = restore(base), r = owner(receiver);
      try {
        const ordered: { library: string; run: (w: Writer) => void }[] = kind === "scoped" ? [
          { library: kind, run: w => page(w, kind).at([]).asElement().attrs.set("title", "scoped") },
          { library: kind, run: w => page(w, kind).css.sel("i").setProp("padding", "5px") },
        ] : kind === "data" ? [
          { library: kind, run: w => data(w, 1) }, { library: kind, run: w => data(w, 2) },
        ] : [
          { library: kind, run: w => page(w, kind).css.sel("b").setProp("padding", "5px") },
          { library: kind, run: w => page(w, kind).at([0]).asElement().attrs.set("title", "other") },
        ];
        ordered.splice(position, 0, { library: "page", run: w => page(w).css.stylesheet(f.stylesheet) });
        // More operations in the same flat Library coalesce at its first accepted position.
        if (graph) ordered.push({ library: "page", run: w => page(w).at([0]).asElement().attrs.set("title", "updated") });
        const commit = await f.locus.stage(w => ordered.forEach(step => step.run(w))); assert.ok(commit);
        const effect = encode_authoritative_scoped_commit(commit), seen = new Set<string>();
        const expectedOrder = ordered.flatMap(step => {
          if (step.library === "page" || step.library === "other") {
            if (seen.has(step.library)) return []; seen.add(step.library);
          }
          return [step.library];
        });
        assert.deepEqual(effect.operations.map(op => op.library), expectedOrder);
        assert.deepEqual(f.adapter.state(f.locus.logicalMapId)!.commits[0], durable_aggregate_commit(commit));
        assert.equal(f.locus.rev, 1); assert.equal(f.adapter.appendCalls.length, 1);
        let observations = 0;
        const stops = [r.observe(() => observations++), r.observeAuthorityPosition(() => observations++, "installed")];
        // A bad flat effect after an earlier valid participant must install nothing.
        const flat = effect.operations.find(op => op.domain === "document" && "kind" in op.effect && op.effect.kind === "flat"); assert.ok(flat);
        for (const patch of [{ after: "0".repeat(64) }, { before: "0".repeat(64) }, { subjects: [] }, { graphs: ["malformed"] }]) {
          const forged = { ...effect, operations: effect.operations.map(op => op === flat && op.domain === "document"
            ? { ...op, effect: { ...op.effect, ...patch } } : op) };
          const before = snapshot(receiver);
          assert.throws(() => Reflect.apply(r.replayDurableHosted, undefined, [forged])); unchanged(receiver, before);
          assert.equal(observations, 0);
        }
        stops.forEach(stop => stop());
        r.replayDurableHosted(effect);
        assert.ok(checkpoint_libraries_equal(r.captureSemanticCheckpoint().libraries, a.captureSemanticCheckpoint().libraries));
        assert.equal(receiver.rev, 1);
        await durable(f); // Original checkpoint plus tail.
        await f.locus.checkpoint(); await durable(f); // Compacted checkpoint.
        await f.locus.stage(w => { page(w).css.stylesheet(f.stylesheet.replace("blue", "purple")); data(w, 3); });
        assert.deepEqual(f.adapter.state(f.locus.logicalMapId)!.commits[0]!.commit.operations.map(op => op.library), ["page", "data"]);
        assert.equal(f.locus.rev, 2); await durable(f); // New tail after checkpoint.
      } finally { f.locus.dispose(); }
    });
  }
  await check("styled flat semantic no-ops preserve state, durability and observations", async () => {
    const f = await fixture(), a = owner(f.map); let observations = 0;
    const stops = [a.observe(() => observations++), a.observeAuthorityPosition(() => observations++, "installed")];
    try {
      const before = snapshot(f.map), stored = f.adapter.state(f.locus.logicalMapId);
      for (const noop of noops) for (let repeat = 0; repeat < 2; repeat++) {
        const result = await f.locus.stage(noop); assert.ok(result && !result.changed);
        assert.deepEqual(result.replay.operations, []); unchanged(f.map, before);
        assert.deepEqual(f.adapter.state(f.locus.logicalMapId), stored);
        assert.equal(f.adapter.appendCalls.length, 0); assert.equal(observations, 0);
      }
      for (const kind of ["scoped", "data"] as const) for (const flatFirst of [false, true]) {
        const rev = f.locus.rev;
        const commit = await f.locus.stage(w => {
          if (flatFirst) noops.forEach(noop => noop(w));
          if (kind === "scoped") page(w, kind).at([]).asElement().attrs.set("title", String(rev)); else data(w, rev + 1);
          if (!flatFirst) noops.forEach(noop => noop(w));
        }); assert.ok(commit);
        assert.deepEqual(encode_authoritative_scoped_commit(commit).operations.map(op => op.library), [kind]);
        assert.equal(f.locus.rev, rev + 1);
      }
      const commit = await f.locus.stage(w => page(w).css.stylesheet(f.stylesheet)); assert.ok(commit);
      assert.equal(encode_authoritative_scoped_commit(commit).operations[0]!.domain, "document");
      const after = snapshot(f.map), count = f.adapter.appendCalls.length, events = observations;
      const result = await f.locus.stage(w => page(w).css.stylesheet(f.stylesheet)); assert.ok(result && !result.changed);
      unchanged(f.map, after); assert.equal(f.adapter.appendCalls.length, count); assert.equal(observations, events);
      for (const flatFirst of [false, true]) {
        const commit = await f.locus.stage(w => {
          noops.forEach(noop => noop(w));
          const change = () => page(w).css.stylesheet(f.stylesheet.replace("blue", flatFirst ? "orange" : "purple"));
          if (flatFirst) change();
          data(w, f.locus.rev + 1);
          if (!flatFirst) change();
        }); assert.ok(commit);
        // An earlier no-op touch cannot claim the later real effect's position.
        assert.deepEqual(encode_authoritative_scoped_commit(commit).operations.map(op => op.library),
          flatFirst ? ["page", "data"] : ["data", "page"]);
      }
      await durable(f);
    } finally { stops.forEach(stop => stop()); f.locus.dispose(); }
  });
  await check("styled flat Echo accepts no-op participants alongside scoped and data progress", async () => {
    const locus = hsonLiveMap.locus.create({ "parts": { parts: { p: { kind: "document", document: '<i "Scoped"/>' } }, access: "private" }, "page": { document, stylesheet: css, access: "shared" }, "data": { data: { n: 0 }, access: "shared" }, "scoped": { document: '<aside <hson-part lib="parts" at="p"/>/>', access: "shared" } }, { authorizeProjection: ({ requested }) => ({ libraries: requested.libraries }) });
    const session = await locus.session.create({ libraries: ["page", "data", "scoped"] });
    const binding = bind_locus_http(locus, { endpoint: "/flat-noop" });
    const transport = hsonLiveMap.echo.transport.http({ endpoint: "http://flat.test/flat-noop", fetch: (input, init) => binding.handle(new Request(input, init), {}) });
    const echo = await hsonLiveMap.echo.create({ now: session.now(), credential: session.credential!, transport });
    try {
      const map = echo_map_internal(echo), a = owner(map);
      const id = a.libraries()[a.hostedRegistry().libraries.findIndex(lib => lib.name === "page")]!;
      const overlay = a.documentOverlay(id), ledger = a.identityEpoch().issued();
      const before = snapshot(map), now = session.now(); let events = 0;
      const stop = echo.commits.observe(() => events++);
      try {
        await locus.stage(w => noops.forEach(noop => noop(w)));
        assert.deepEqual(session.now(), now); unchanged(map, before); assert.equal(echo.sync.appliedRev, 0);
        assert.equal(a.documentOverlay(id), overlay); assert.equal(a.identityEpoch().issued(), ledger); assert.equal(events, 0);
      } finally { stop(); }
      for (const kind of ["scoped", "data"] as const) {
        const rev = locus.rev + 1;
        const applied = new Promise<void>(resolve => { const stop = echo.commits.observe(() => queueMicrotask(() => {
          if (echo.sync.appliedRev === rev) { stop(); resolve(); }
        })); });
        await locus.stage(w => {
          noops.forEach(noop => noop(w));
          if (kind === "scoped") w.doc.must(kind).at([]).asElement().attrs.set("title", "propagated"); else w.data.must(kind).at(["n"]).set(1);
        });
        await applied; assert.equal(echo.sync.appliedRev, rev);
        assert.equal(a.documentOverlay(id), overlay); assert.deepEqual(issued(a.identityEpoch().issued()), issued(ledger));
      }
    } finally { echo.dispose(); transport.dispose(); binding.dispose(); locus.dispose(); }
  });
}
