import { h0a_cases } from "./locus-scoped-h0a-cases.mts";
import { scoped_tail_cases } from "./locus-scoped-tail-cases.mts";
import assert from "node:assert/strict";
import { Hson, hsonLiveMap, hsonTransform } from "../../src/index.ts";
import { internal_livemap_aggregate_authority as authority, type LiveMapSemanticCheckpoint } from "../../src/api/livemap/livemap.internal.ts";
import { make_livemap_mirror_from_semantic_checkpoint_internal as restore } from "../../src/api/livemap/livemap.libraries.ts";
import { document_scoped_libraries_semantically_equal as equal } from "../../src/api/livemap/livemap.document.scoped-portable.ts";
import { remap_portable_document_css_identities } from "../../src/internal/css/css-identity-translation.ts";
import { enumerate_livemap_issued_quids as issued } from "../../src/api/livemap/livemap.identity-epoch.ts";
import { set_livemap_quid_candidate_source_for_tests as allocator } from "../../src/api/livemap/livemap.quid-allocation.ts";
import { registry_from_entries } from "../../src/api/livemap/livemap.hosted.ts";
import { hson_schema_source_digest } from "../../src/api/schema/hson-schema.ts";
import { validate_document_path as path } from "../../src/api/livemap/livemap.document.path.ts";
import { DOCUMENT_SCOPED_QUAD_LIMITS } from "../../src/api/livemap/livemap.document.scoped-quad-codec.ts";
import { CheckpointTokenDecoder, encode_checkpoint_chunks, validate_checkpoint_chunk, type CheckpointChunkDescriptor } from "../../src/api/locus/locus.checkpoint-chunks.ts";
import { write_semantic_checkpoint as write, restore_semantic_checkpoint_manifest_internal as read,
  checkpoint_libraries_equal, create_persistent_locus_hosted_aggregate_internal as persist,
  load_persistent_locus_hosted_aggregate_internal as resume, durable_aggregate_commit,
  type LocusHostedAggregatePersistedManifest } from "../../src/api/locus/locus.aggregate.persistence.ts";
import { MemoryCheckpointAdapter } from "../helpers/memory-checkpoint-adapter.mts";
import { scoped_initial_fixture as fixture, page, node } from "./echo-scoped-initial-state-cases.mts";

const ownership = [{ name: "parts", ownership: "private" }, { name: "page", ownership: "shared" },
  { name: "data", ownership: "shared" }, { name: "zpage", ownership: "shared" }, { name: "hidden", ownership: "private" }] as const;
const clone = <T,>(input: T): T => structuredClone(input);
const librariesEqual = (a: LiveMapSemanticCheckpoint, b: LiveMapSemanticCheckpoint) => {
  assert.equal(checkpoint_libraries_equal(a.libraries, b.libraries), true);
  assert.deepEqual(a.authority, b.authority); assert.equal(a.revision, b.revision); assert.deepEqual(a.registry, b.registry);
};
function document(checkpoint: LiveMapSemanticCheckpoint, name = "page") {
  const value = checkpoint.libraries.find(entry => entry.name === name)!;
  assert.ok(value.scopes && value.css);
  return { root: value.root, scopes: value.scopes, css: value.css };
}
function unchanged(a: ReturnType<typeof authority>, run: () => void) {
  const before = a.captureSemanticCheckpoint(), ledger = a.identityEpoch().issued(), epoch = a.identityEpoch().current();
  const position = a.hostedPosition(), registry = a.hostedRegistry();
  const refs = a.libraries().map(id => ({ id, root: a.root(id), scopes: a.documentScopes(id),
    ...(a.inspect().libraries.find(x => x.identity === id)!.mode === "document" ? { css: a.stylesheet(id), overlay: a.documentOverlay(id) } : {}) }));
  let events = 0;
  const stops = [a.observeRestore(() => events++), a.observeAuthorityPosition(() => events++), a.observeAuthorityPosition(() => events++, "installed")];
  try { run(); } finally { stops.forEach(stop => stop()); }
  assert.deepEqual(a.captureSemanticCheckpoint(), before); assert.equal(a.identityEpoch().issued(), ledger);
  assert.equal(a.identityEpoch().current(), epoch); assert.deepEqual(a.hostedPosition(), position); assert.equal(a.hostedRegistry(), registry); assert.equal(events, 0);
  for (const r of refs) { assert.equal(a.root(r.id), r.root); assert.equal(a.documentScopes(r.id), r.scopes);
    if (r.css) { assert.equal(a.stylesheet(r.id), r.css); assert.equal(a.documentOverlay(r.id), r.overlay); } }
}
function active(adapter: MemoryCheckpointAdapter, checkpoint: LiveMapSemanticCheckpoint) {
  return adapter.state(checkpoint.authority.logicalMapId)!.checkpoint;
}
function rename(checkpoint: LiveMapSemanticCheckpoint) {
  return { ...checkpoint, libraries: checkpoint.libraries.map(library => {
    if (!library.scopes || !library.css) return library;
    const names = new Map(library.scopes.subjects.map((subject, index) => [subject.name, `_z${index.toString(36).padStart(8, "0")}`]));
    return { ...library, scopes: { ...library.scopes, subjects: library.scopes.subjects.map(subject => ({ ...subject, name: names.get(subject.name)! })) },
      css: remap_portable_document_css_identities(library.css, names) };
  }) };
}
function replacePart(adapter: MemoryCheckpointAdapter, manifest: LocusHostedAggregatePersistedManifest,
  owner: string, part: CheckpointChunkDescriptor["part"], value: unknown) {
  const encoded = [...encode_checkpoint_chunks(manifest.checkpointId, manifest.rev, owner, part, value)];
  encoded.forEach(entry => adapter.chunks.set(entry.chunk.id, entry.chunk));
  let replaced = false;
  return { ...manifest, chunks: manifest.chunks.flatMap(descriptor => {
    if (descriptor.owner !== owner || descriptor.part !== part) return [descriptor];
    if (replaced) return []; replaced = true; return encoded.map(entry => entry.descriptor);
  }) };
}

export async function scoped_checkpoint_cases(check: (name: string, run: () => Promise<void>) => Promise<void>) {
  await check("structural Document input restores and checkpoints through existing source-free scoped records", async () => {
    const f = await fixture(false, true), adapter = new MemoryCheckpointAdapter();
    try {
      const snapshot = f.state();
      assert.doesNotMatch(JSON.stringify(snapshot), /hson-part|:doc|#\{/);
      const receiver = f.fresh(snapshot);
      const receivingMap = receiver.map;
      assert.ok(receivingMap);
      assert.deepEqual(receivingMap.doc.must("page").root(), f.map.doc.must("page").root());
      assert.throws(() => receivingMap.parts.must("parts"));
      const checkpoint = f.a.captureSemanticCheckpoint();
      await write(checkpoint, adapter, ownership);
      const received = await read(active(adapter, checkpoint), adapter);
      const loaded = authority(received).captureSemanticCheckpoint();
      assert.equal(equal(document(loaded), document(checkpoint)), true);
      const restored = restore(loaded);
      assert.equal(equal(document(authority(restored).captureSemanticCheckpoint()), document(checkpoint)), true);
    } finally { f.l.dispose(); }
  });
  await scoped_tail_cases(check);
  await h0a_cases(check);
  await check("B1 complete authority capture is coherent, detached, observational and QUID-free", async () => {
    const f = await fixture();
    try {
      let allocations = 0;
      allocator(f.a.identityEpoch().owner, () => { allocations++; throw Error("capture allocated"); });
      try { unchanged(f.a, () => {
        const checkpoint = f.a.captureSemanticCheckpoint();
        assert.deepEqual(checkpoint, f.a.captureSemanticCheckpoint());
        assert.ok(checkpoint.libraries.some(entry => entry.name === "parts"));
        assert.match(JSON.stringify(checkpoint), /PRIVATE_PART_SENTINEL|PRIVATE_LIBRARY_SENTINEL/);
        assert.match(JSON.stringify(checkpoint), /hidden-event/);
        assert.equal(document(checkpoint).scopes.occurrences.length, 4);
        assert.equal(document(checkpoint, "zpage").scopes.occurrences.length, 1);
        assert.ok(document(checkpoint).scopes.occurrences.some(s => s.parent !== null));
        assert.ok(document(checkpoint).scopes.occurrences.filter(s => s.parent === null).length === 2);
        for (const entry of checkpoint.libraries) if (entry.scopes) assert.equal(Object.hasOwn(entry, "quads"), false);
        assert.doesNotMatch(JSON.stringify(checkpoint), /"quid"|"issuedQuids"|"epoch"|"lifetime"|"rootQuid"/);
        document(checkpoint).root.$_content.length = 0;
        assert.ok(document(f.a.captureSemanticCheckpoint()).root.$_content.length > 0);
      }); } finally { allocator(f.a.identityEpoch().owner, undefined); }
      assert.equal(allocations, 0);
    } finally { f.l.dispose(); }
  });
  await check("B1 existing chunks restore complete scoped meaning, private ownership, interactions and fresh sparse identities", async () => {
    const f = await fixture(), adapter = new MemoryCheckpointAdapter();
    try {
      await f.stage(w => { const data = w.data.must("data"); if (String(data.mode) === "document") throw Error(); data.at(["n"]).set(7); });
      const checkpoint = f.a.captureSemanticCheckpoint();
      await write(checkpoint, adapter, ownership);
      const manifest = active(adapter, checkpoint);
      assert.equal(manifest.format, "hson-locus-durable-aggregate-checkpoint");
      assert.deepEqual(manifest.locus.runtimeOwnership, ownership);
      assert.equal(manifest.rev, checkpoint.revision);
      for (const name of ["page", "zpage"]) {
        const parts = manifest.chunks.filter(d => d.owner === name);
        assert.deepEqual(parts.map(d => d.part), ["schema", "root", "css", "scopes"]);
        const decoder = new CheckpointTokenDecoder();
        for (const d of parts.filter(d => d.part === "scopes")) decoder.feed(validate_checkpoint_chunk(adapter.chunks.get(d.id), d));
        assert.deepEqual(JSON.parse(JSON.stringify(decoder.finish())), document(checkpoint, name).scopes);
      }
      const received = await read(manifest, adapter), a = authority(received);
      librariesEqual(checkpoint, a.captureSemanticCheckpoint());
      const original = new Set(issued(f.a.identityEpoch().issued())), receiver = issued(a.identityEpoch().issued());
      assert.ok(receiver.length > 0); for (const quid of receiver) assert.ok(!original.has(quid));
      let demanded = 0;
      for (const [index, id] of a.libraries().entries()) {
        const source = f.a.documentScopes(f.a.libraries()[index]!), next = a.documentScopes(id);
        if (!next || !source) continue;
        for (const scope of next.occurrences) assert.ok(!source.occurrences.some(s => s.lifetime === scope.lifetime));
        demanded += a.documentOverlay(id)!.size;
      }
      assert.equal(receiver.length, demanded);
      assert.match(received.doc.must("page").css.snapshot(), /border:0/);
      assert.ok(equal(document(checkpoint), document(a.captureSemanticCheckpoint())));
      // Governed Part contents remain durable, but are not used to rebuild realized documents.
      const withoutDefinitions = { ...checkpoint, libraries: checkpoint.libraries.map(entry => entry.name === "parts"
        ? { ...entry, root: hsonTransform.fromJson({}).toNode() } : entry) };
      const noSources = authority(restore(withoutDefinitions));
      assert.ok(equal(document(checkpoint), document(noSources.captureSemanticCheckpoint())));
      assert.deepEqual(noSources.snap(noSources.libraries()[0]!, []), {});
    } finally { f.l.dispose(); }
  });
  await check("B1 flat representation remains unchanged and absent/empty scopes stay distinct", async () => {
    const flat = authority(hsonLiveMap.fromLibraries({ page: { document: '<main @:root/>' }, data: { data: { n: 1 } } })).captureSemanticCheckpoint();
    assert.ok(flat.libraries[0]!.quads); assert.equal(Object.hasOwn(flat.libraries[0]!, "scopes"), false);
    const adapter = new MemoryCheckpointAdapter(); await write(flat, adapter);
    assert.deepEqual(active(adapter, flat).chunks.map(d => d.part), ["schema", "root", "css", "quads", "schema", "root"]);
    librariesEqual(flat, authority(await read(active(adapter, flat), adapter)).captureSemanticCheckpoint());
    const plain = authority(hsonLiveMap.fromLibraries({ page: { document: '<main/>' } })).captureSemanticCheckpoint();
    const empty = { ...plain, libraries: plain.libraries.map(entry => ({ ...entry, scopes: { document: [], occurrences: [], subjects: [] } })) };
    assert.equal(checkpoint_libraries_equal(plain.libraries, empty.libraries), false);
    const emptyAdapter = new MemoryCheckpointAdapter(); await write(empty, emptyAdapter);
    librariesEqual(empty, authority(await read(active(emptyAdapter, empty), emptyAdapter)).captureSemanticCheckpoint());
  });
  await check("B1 prefix equality alpha-renames subjects and checks roles, topology, paths and CSS", async () => {
    const f = await fixture(), adapter = new MemoryCheckpointAdapter();
    try {
      const checkpoint = f.a.captureSemanticCheckpoint(), renamed = rename(checkpoint);
      assert.equal(checkpoint_libraries_equal(checkpoint.libraries, renamed.libraries), true);
      await write(checkpoint, adapter, ownership); await write(renamed, adapter, ownership);
      const mutate: readonly ((p: any) => void)[] = [
        p => { p.scopes.document.find((b: any) => b.name === "left").kind = "element"; },
        p => { p.scopes.document[0].name = "renamed"; },
        p => { p.scopes.occurrences[0].bindings[0].name = "renamed"; },
        p => { p.scopes.occurrences[1].parent = null; },
        p => { const a = p.scopes.subjects[0], b = p.scopes.subjects[1]; [a.name, b.name] = [b.name, a.name]; },
        p => { p.css.rules[0].declarations[0][1] = "19px"; },
      ];
      for (const edit of mutate) {
        const changed = clone(checkpoint); edit(changed.libraries.find(entry => entry.name === "page"));
        let same = false; try { same = checkpoint_libraries_equal(checkpoint.libraries, changed.libraries); } catch { /* Invalid evidence is also rejected. */ }
        assert.equal(same, false); await assert.rejects(() => write(changed, adapter, ownership));
      }
    } finally { f.l.dispose(); }
  });
  await check("B1 semantic equality never suppresses graph-identical authoritative occurrence replacement", async () => {
    const f = await fixture();
    try {
      const before = f.a.captureSemanticCheckpoint(), lifetimes = f.a.documentScopes(f.pageId)!.occurrences.map(s => s.lifetime);
      const batch = await f.stage(w => page(w).content.replace({ kind: "path", path: path([0, 0]) }, 1, node('<hson-part lib="parts" at="panel"/>')));
      const after = f.a.captureSemanticCheckpoint();
      assert.equal(checkpoint_libraries_equal(before.libraries, after.libraries), true);
      assert.equal(after.revision, before.revision + 1); assert.ok(batch.operations.length > 0);
      assert.notEqual(f.a.documentScopes(f.pageId)!.occurrences[2]!.lifetime, lifetimes[2]);
      const adapter = new MemoryCheckpointAdapter(); await write(before, adapter, ownership);
      await assert.rejects(() => write(after, adapter, ownership), /invalid/);
      assert.equal(active(adapter, before).rev, before.revision);
    } finally { f.l.dispose(); }
  });
  await check("B1 complete candidate admission rejects malformed final Libraries without allocation or partial publication", async () => {
    const f = await fixture();
    try {
      const checkpoint = f.a.captureSemanticCheckpoint(), map = restore(checkpoint), a = authority(map);
      const data = map.data.must("data"); if (String(data.mode) === "document") throw Error(); data.at(["n"]).set(99);
      const mutations: readonly [string, (entry: any) => void][] = [
        ["missing occurrences", p => { delete p.scopes.occurrences; }],
        ["invalid parent", p => { p.scopes.occurrences[0].parent = p.scopes.occurrences[0].root; }],
        ["invalid binding role", p => { p.scopes.occurrences[0].bindings[0].kind = "transport"; }],
        ["duplicate binding", p => { p.scopes.occurrences[0].bindings.push(p.scopes.occurrences[0].bindings[0]); }],
        ["invalid owner", p => { p.css.order[0].owner = '[hson\\:quad="_z00000000"]'; }],
        ["missing subject", p => { p.scopes.subjects.pop(); }],
        ["excess subject", p => { p.scopes.subjects.push({ name: "_z00000000", path: [0], disposition: "disposable" }); }],
        ["duplicate subject", p => { p.scopes.subjects.push(p.scopes.subjects[0]); }],
        ["forged QUID", p => { p.root.$_content[0].$_meta = { quid: "a00000001" }; }],
        ["forged epoch", p => { p.epoch = 1; }],
        ["forged occurrence lifetime", p => { p.scopes.occurrences[0].lifetime = {}; }],
        ["conflicting flat contract", p => { p.quads = []; }],
        ["undefined scoped contract", p => { p.scopes = undefined; }],
        ["scope bound", p => { p.scopes.occurrences = Array(DOCUMENT_SCOPED_QUAD_LIMITS.occurrences + 1).fill(p.scopes.occurrences[0]); }],
        ["unknown field", p => { p.extra = true; }],
        ["accessor", p => { Object.defineProperty(p, "css", { enumerable: true, get() { throw Error("executed getter"); } }); }],
      ];
      for (const [name, mutate] of mutations) {
        const bad = clone(checkpoint); mutate(bad.libraries.find(entry => entry.name === "zpage"));
        let allocations = 0; allocator(a.identityEpoch().owner, () => { allocations++; return "a00000001"; });
        try { unchanged(a, () => assert.throws(() => a.installSemanticCheckpoint(bad), error => error instanceof Error && error.message !== "executed getter", name)); }
        finally { allocator(a.identityEpoch().owner, undefined); }
        assert.equal(allocations, 0, name);
        const adapter = new MemoryCheckpointAdapter(); await assert.rejects(() => write(bad, adapter, ownership), name);
        assert.equal(adapter.chunks.size, 0);
      }
      // A schema mismatch and invalid governed Part definition are also whole-candidate failures.
      const schema = Hson.schema`<type "document" tag "p" content "empty">`.toHson();
      const changedSchema = { ...checkpoint, registry: registry_from_entries(checkpoint.registry.libraries.map(entry => entry.name === "hidden"
        ? { ...entry, schema, schemaDigest: hson_schema_source_digest(schema) } : entry)) };
      assert.throws(() => restore(changedSchema));
      const badParts = { ...checkpoint, libraries: checkpoint.libraries.map(entry => entry.name === "parts"
        ? { ...entry, root: hsonTransform.fromJson({ broken: { kind: "document", document: '<hson-part at="missing"/>' } }).toNode() } : entry) };
      unchanged(a, () => assert.throws(() => a.installSemanticCheckpoint(badParts)));
      const malformedFinal: any = clone(checkpoint);
      malformedFinal.libraries.at(-1).unexpectedAuthority = { issuedQuids: ["a00000001"] };
      unchanged(a, () => assert.throws(() => a.installSemanticCheckpoint(malformedFinal)));
      const badArray: any = clone(checkpoint); badArray.libraries.issuedQuids = [];
      unchanged(a, () => assert.throws(() => a.installSemanticCheckpoint(badArray)));
      const badContract: any = clone(checkpoint); badContract.registry.libraries.at(-1).unknown = true;
      unchanged(a, () => assert.throws(() => a.installSemanticCheckpoint(badContract)));
      a.installSemanticCheckpoint(checkpoint); librariesEqual(checkpoint, a.captureSemanticCheckpoint());
    } finally { f.l.dispose(); }
  });
  await check("B1 failed allocation, reserved authority and reentrant management revocation are atomic and retryable", async () => {
    const f = await fixture();
    try {
      const checkpoint = f.a.captureSemanticCheckpoint(), a = authority(restore(checkpoint));
      for (const failAfter of [0, 3, a.documentOverlay(a.libraries()[1]!)!.size]) {
        let n = 0; allocator(a.identityEpoch().owner, () => ++n <= failAfter ? `y${n.toString(36).padStart(8, "0")}` : "invalid");
        try { unchanged(a, () => assert.throws(() => a.installSemanticCheckpoint(checkpoint), /No available/)); }
        finally { allocator(a.identityEpoch().owner, undefined); }
      }
      for (const forbidden of [document(checkpoint, "zpage").scopes.subjects[0]!.name.slice(1), issued(a.identityEpoch().issued())[0]!]) {
        allocator(a.identityEpoch().owner, () => forbidden);
        try { unchanged(a, () => assert.throws(() => a.installSemanticCheckpoint(checkpoint), /No available/)); }
        finally { allocator(a.identityEpoch().owner, undefined); }
      }
      const candidate = a.prepare([]), release = a.reserve(candidate);
      try { unchanged(a, () => assert.throws(() => a.installSemanticCheckpoint(checkpoint), /reserved/)); }
      finally { release(); a.discard(candidate); }
      const manager = {}; a.claimManagement(manager);
      unchanged(a, () => assert.throws(() => a.installSemanticCheckpoint(checkpoint), /exclusive Locus/));
      let entered = false;
      allocator(a.identityEpoch().owner, () => { a.releaseManagement(manager); return "y00000001"; });
      try { unchanged(a, () => assert.throws(() => a.prepareManaged(manager, new Proxy([], {
        get(target, key, receiver) {
          if (!entered) { entered = true; a.installSemanticCheckpoint(checkpoint); }
          return Reflect.get(target, key, receiver);
        },
      }), true), /management authority changed/)); } finally { allocator(a.identityEpoch().owner, undefined); a.releaseManagement(manager); }
      assert.equal(entered, true); a.installSemanticCheckpoint(checkpoint); librariesEqual(checkpoint, a.captureSemanticCheckpoint());
    } finally { f.l.dispose(); }
  });
  await check("B1 owns every Library before reentrant allocation and storage callbacks", async () => {
    const f = await fixture();
    try {
      const checkpoint = f.a.captureSemanticCheckpoint(), a = authority(restore(checkpoint)), input = clone(checkpoint);
      let n = 0; allocator(a.identityEpoch().owner, () => {
        document(input, "zpage").root.$_content.length = 0;
        return `y${(++n).toString(36).padStart(8, "0")}`;
      });
      try { a.installSemanticCheckpoint(input); } finally { allocator(a.identityEpoch().owner, undefined); }
      librariesEqual(checkpoint, a.captureSemanticCheckpoint());
      class Reentrant extends MemoryCheckpointAdapter {
        override async load(id: string) {
          document(presented, "zpage").root.$_content.length = 0;
          return super.load(id);
        }
      }
      const presented = clone(checkpoint), adapter = new Reentrant(), paused = adapter.deferChunk();
      const pending = write(presented, adapter, ownership); await paused.entered;
      await f.stage(w => {
        page(w).attrs.set({ kind: "path", path: path([0]) }, "title", "later");
        const data = w.data.must("data"); if (String(data.mode) === "document") throw Error(); data.at(["n"]).set(22);
      });
      paused.release(); await pending;
      librariesEqual(checkpoint, authority(await read(active(adapter, checkpoint), adapter)).captureSemanticCheckpoint());
      assert.equal(f.map.rev, checkpoint.revision + 1);
      const manifest = active(adapter, checkpoint);
      class MutatingReader extends MemoryCheckpointAdapter {
        override async readCheckpointChunk(id: string) {
          Object.assign(manifest.chunks, { length: 0 });
          return adapter.readCheckpointChunk(id);
        }
      }
      librariesEqual(checkpoint, authority(await read(manifest, new MutatingReader())).captureSemanticCheckpoint());
    } finally { f.l.dispose(); }
  });
  await check("B1 chunk grammar rejects missing, duplicate, reordered, corrupt, misowned and conflicting evidence", async () => {
    const f = await fixture(), adapter = new MemoryCheckpointAdapter();
    try {
      const checkpoint = f.a.captureSemanticCheckpoint(); await write(checkpoint, adapter, ownership);
      const manifest = active(adapter, checkpoint), descriptor = manifest.chunks.find(d => d.owner === "zpage" && d.part === "scopes")!;
      const original = adapter.chunks.get(descriptor.id)!;
      adapter.chunks.delete(descriptor.id); await assert.rejects(() => read(manifest, adapter));
      adapter.chunks.set(descriptor.id, { ...original, payload: original.payload.replace('"o"', '"a"') }); await assert.rejects(() => read(manifest, adapter));
      adapter.chunks.set(descriptor.id, { ...original, id: "wrong" }); await assert.rejects(() => read(manifest, adapter));
      adapter.chunks.set(descriptor.id, original);
      const changes: readonly ((m: any) => void)[] = [
        m => { m.chunks.push(m.chunks.at(-1)); },
        m => { [m.chunks[0], m.chunks[1]] = [m.chunks[1], m.chunks[0]]; },
        m => { m.chunks[0].owner = "wrong"; }, m => { m.checkpointId = "0".repeat(36); },
        m => { m.chunks[0].extra = true; }, m => { m.chunks[0].bytes++; }, m => { m.chunks[0].index++; },
        m => { m.chunks[0].rev++; }, m => { m.chunks[0].sha256 = "0".repeat(64); },
        m => { m.chunks = m.chunks.filter((d: any) => d.owner !== "zpage" || d.part !== "scopes"); },
      ];
      for (const edit of changes) { const bad = clone(manifest); edit(bad); await assert.rejects(() => read(bad, adapter)); }
      const extra = [...encode_checkpoint_chunks(manifest.checkpointId, manifest.rev, "zpage", "quads", [])];
      for (const e of extra) adapter.chunks.set(e.chunk.id, e.chunk);
      const conflict = { ...manifest, chunks: manifest.chunks.flatMap(d => d.id === descriptor.id ? [d, ...extra.map(e => e.descriptor)] : [d]) };
      await assert.rejects(() => read(conflict, adapter));
      const scopes: any = clone(document(checkpoint, "zpage").scopes); scopes.occurrences[0].parent = scopes.occurrences[0].root;
      await assert.rejects(() => read(replacePart(adapter, manifest, "zpage", "scopes", scopes), adapter));
      adapter.chunks.set(descriptor.id, original);
      const stored = new Map(adapter.chunks), badCss: any = clone(document(checkpoint, "zpage").css);
      badCss.order[0].owner = '[hson\\:quad="_z00000000"]';
      const badRoot: any = clone(document(checkpoint, "zpage").root); badRoot.$_content[0].$_meta = { quid: "a00000001" };
      const incomplete = { ...document(checkpoint, "zpage").scopes, subjects: [] };
      for (const [part, value] of [["css", badCss], ["root", badRoot], ["scopes", incomplete], ["schema", "invalid schema"]] as const) {
        await assert.rejects(() => read(replacePart(adapter, manifest, "zpage", part, value), adapter));
        adapter.chunks.clear(); for (const [id, chunk] of stored) adapter.chunks.set(id, chunk);
      }
      librariesEqual(checkpoint, authority(await read(manifest, adapter)).captureSemanticCheckpoint());
    } finally { f.l.dispose(); }
  });
  await check("B1 storage failure, activation verification, prune failure and successful retry retain the checkpoint contract", async () => {
    const f = await fixture();
    try {
      const checkpoint = f.a.captureSemanticCheckpoint();
      for (const phase of ["chunk", "manifest", "activation"] as const) {
        const adapter = new MemoryCheckpointAdapter(); await write(checkpoint, adapter, ownership);
        const old = active(adapter, checkpoint).checkpointId;
        if (phase === "chunk") adapter.failChunk = Error("chunk failure");
        if (phase === "manifest") adapter.failManifest = Error("manifest failure");
        if (phase === "activation") adapter.failActivation = "before";
        await assert.rejects(() => write(checkpoint, adapter, ownership));
        assert.equal(active(adapter, checkpoint).checkpointId, old);
        await write(checkpoint, adapter, ownership); assert.notEqual(active(adapter, checkpoint).checkpointId, old);
      }
      const adapter = new MemoryCheckpointAdapter(); await write(checkpoint, adapter, ownership);
      const old = active(adapter, checkpoint).checkpointId;
      adapter.failActivation = "after"; adapter.failPrune = Error("prune failure");
      await assert.rejects(() => write(checkpoint, adapter, ownership), /prune failure/);
      assert.notEqual(active(adapter, checkpoint).checkpointId, old);
      librariesEqual(checkpoint, authority(await read(active(adapter, checkpoint), adapter)).captureSemanticCheckpoint());
      await write(checkpoint, adapter, ownership);
      class Uncertain extends MemoryCheckpointAdapter {
        unreadable = false; uncertain = true; prunes = 0;
        override async activateCheckpoint(id: string, expected: string | undefined, next: string) {
          await super.activateCheckpoint(id, expected, next);
          if (this.uncertain) { this.uncertain = false; this.unreadable = true; throw Error("uncertain"); }
        }
        override async load(id: string) { if (this.unreadable) { this.unreadable = false; throw Error("unavailable"); } return super.load(id); }
        override async pruneCommitsThrough(id: string, checkpointId: string, rev: number) { this.prunes++; return super.pruneCommitsThrough(id, checkpointId, rev); }
      }
      const uncertain = new Uncertain();
      await assert.rejects(() => write(checkpoint, uncertain, ownership), (e: any) => e.code === "LOCUS_PERSISTENCE_CHECKPOINT_UNCERTAIN");
      assert.equal(uncertain.prunes, 0);
      librariesEqual(checkpoint, authority(await read(active(uncertain, checkpoint), uncertain)).captureSemanticCheckpoint());
      await write(checkpoint, uncertain, ownership); assert.equal(uncertain.prunes, 1);
    } finally { f.l.dispose(); }
  });
  await check("B1 stale manifests and competing activation never authorize blind pruning", async () => {
    const f = await fixture();
    try {
      const checkpoint = f.a.captureSemanticCheckpoint();
      class Conflict extends MemoryCheckpointAdapter {
        conflict = false; prunes = 0;
        override async activateCheckpoint(id: string, expected: string | undefined, next: string) {
          if (this.conflict) { this.conflict = false; const state = this.state(id)!;
            this.seed(id, { ...state, checkpoint: { ...state.checkpoint, checkpointId: "00000000-0000-0000-0000-000000000000" } }); }
          return super.activateCheckpoint(id, expected, next);
        }
        override async pruneCommitsThrough(id: string, checkpointId: string, rev: number) { this.prunes++; return super.pruneCommitsThrough(id, checkpointId, rev); }
      }
      const adapter = new Conflict(); await write(checkpoint, adapter, ownership); const valid = adapter.state(checkpoint.authority.logicalMapId)!;
      adapter.conflict = true;
      await assert.rejects(() => write(checkpoint, adapter, ownership), (e: any) => e.code === "LOCUS_PERSISTENCE_CHECKPOINT_UNCERTAIN");
      assert.equal(adapter.prunes, 1); adapter.seed(checkpoint.authority.logicalMapId, valid);
      await assert.rejects(() => write({ ...checkpoint, revision: checkpoint.revision - 1 }, adapter, ownership));
      await assert.rejects(() => write({ ...checkpoint, authority: { ...checkpoint.authority, incarnationId: "different" } }, adapter, ownership));
      await write(checkpoint, adapter, ownership);
    } finally { f.l.dispose(); }
  });
  await check("B1 explicit scoped preparation and malformed tails remain guarded", async () => {
    const f = await fixture(), adapter = new MemoryCheckpointAdapter();
    try {
      const checkpoint = f.a.captureSemanticCheckpoint();
      await assert.rejects(() => persist({ map: f.map, persistence: adapter }), /explicit private scoped/);
      assert.equal(adapter.chunks.size, 0);
      await write(checkpoint, adapter, ownership);
      const restored = await resume(checkpoint.authority.logicalMapId, { persistence: adapter }); assert.ok(restored); restored.dispose();
      let rejected = false;
      const stop = f.l.on_commit(commit => { assert.ok(durable_aggregate_commit(commit).commit.operationCount); rejected = true; });
      await f.stage(w => page(w).attrs.set({ kind: "path", path: path([0]) }, "title", "next")); stop(); assert.equal(rejected, true);
      await f.stage(w => page(w).css.stylesheet("main{color:red}"));
      assert.equal(adapter.appendCalls.length, 0);
      const forgedTail: any = { format: "hson-locus-durable-aggregate-record", logicalMapId: checkpoint.authority.logicalMapId,
        incarnationId: checkpoint.authority.incarnationId, mapKind: "hosted-aggregate", registryDigest: checkpoint.registry.digest,
        commit: { format: "hson-livemap-durable-commit", authority: checkpoint.authority, registryDigest: checkpoint.registry.digest,
          prevRev: checkpoint.revision, rev: checkpoint.revision + 1, operations: [] }, locus: { libraryOwnershipAdded: [] } };
      adapter.seed(checkpoint.authority.logicalMapId, { checkpoint: active(adapter, checkpoint), commits: [forgedTail] });
      await assert.rejects(() => write(f.a.captureSemanticCheckpoint(), adapter, ownership), /B2|invalid/);
    } finally { f.l.dispose(); }
  });
}
