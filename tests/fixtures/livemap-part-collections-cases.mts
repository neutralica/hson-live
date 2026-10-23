import { require_livemap_library_internal } from "../../src/api/livemap/livemap.libraries.js";
import { client_projection_map } from "../helpers/client-projection.mts";
import { without_structured_clone } from "../helpers/without-structured-clone.mts";
import { admit_locus_local_initializers, install_client_local_initializers_internal } from "../../src/api/locus/locus.local-initializer.ts";
import { encode_ssr_bootstrap, decode_ssr_bootstrap } from "../../src/api/ssr/ssr-bootstrap.ts";
import assert from "node:assert/strict";
import { ANY_DATA, ANY_DOCUMENT, Hson, hsonLiveMap, type HsonSchema } from "../../src/index.ts";
import { install_libraries_snapshot } from "../../src/api/livemap/index.ts";
import { add_livemap_part_collection_internal as collect, read_livemap_part_internal as read,
  compose_livemap_document_internal as compose, make_livemap_from_canonical_libraries_internal,
  make_livemap_mirror_from_semantic_checkpoint_internal, make_livemap_client_composition_from_portable_aggregate_internal,
  reconcile_client_projection_snapshot_internal, install_client_projected_topology_internal } from "../../src/api/livemap/livemap.libraries.ts";
import { PART_COLLECTION_VALIDATION as validation,
  validate_part_collection } from "../../src/api/livemap/livemap.parts.ts";
import { internal_livemap_aggregate_authority as owner } from "../../src/api/livemap/livemap.internal.ts";
import { decode_hosted_root, encode_hosted_root, make_portable_aggregate_snapshot, make_portable_aggregate_commit,
  make_hosted_registry, make_hosted_topology_commit } from "../../src/api/livemap/livemap.hosted.ts";
import { projected_value_from_hson_node, projected_value_to_hson_root } from "../../src/core/projected-value-graph.ts";
import { admit_projected_value } from "../../src/core/projected-value-admission.ts";
import { overwrite_hson_node } from "../../src/api/livemap/livemap.editor.ts";
import { enumerate_livemap_issued_quids } from "../../src/api/livemap/livemap.identity-epoch.ts";
import { mint_hson_node_quid } from "../../src/core/hson-node-quid.ts";
import { set_livemap_quid_candidate_source_for_tests } from "../../src/api/livemap/livemap.quid-allocation.ts";
import { parse_document_stylesheet } from "../../src/internal/css/parse-document-stylesheet.ts";
import { decode_portable_document_stylesheet, render_portable_document_stylesheet } from "../../src/internal/css/portable-document-stylesheet.ts";
import { make_locus_hosted_projection_policy, normalize_locus_effective_projection } from "../../src/api/locus/locus.projection.ts";
import { capture_selected_authority_projection_snapshot, admit_authority_projection_snapshot,
  authority_projection_as_client_composition_internal } from "../../src/api/locus/locus.authority-projection-snapshot.ts";
import { write_semantic_checkpoint, load_persistent_locus_hosted_aggregate_internal } from "../../src/api/locus/locus.aggregate.persistence.ts";
import { encode_checkpoint_chunks } from "../../src/api/locus/locus.checkpoint-chunks.ts";
import { bind_locus_websocket } from "../../src/api/locus/locus.websocket.ts";
import { locus_map_internal, echo_map_internal } from "../../src/internal/governor-maps.ts";
import { MemoryCheckpointAdapter } from "../helpers/memory-checkpoint-adapter.mts";
import { test_echo_transport } from "../helpers/echo-websocket-transport.mts";
import { acquire_document_identity, acquire_projected_identity } from "../helpers/livemap-identity-internal.mts";
import type { LiveMapPartCollection, LiveMap, LiveMapDataLibrary, LiveMapCommit, LiveMapSnapshot } from "../../src/types/livemap.types.ts";
import type { LocusWebSocketLike } from "../../src/index.ts";
import { validate_document_path } from "../../src/api/livemap/livemap.document.path.ts";

const css = '@layer base{}@layer theme{}@property --tone{syntax:"<color>";inherits:false;initial-value:red}@layer base{article{color:var(--tone)}@media (min-width:1px){article>span{display:block}}}@keyframes pulse{from{opacity:0}to{opacity:1}}article{animation:pulse 1s}';
const parts = () => ({
  "first/β": { kind: "document" as const, document: '<article @:root <span @:label "First"/> <i/>/>', stylesheet: css },
  "二": { kind: "document" as const, document: '<a @:label href="/" "Second"/>', stylesheet: "" },
});
const definition = (parts: LiveMapPartCollection) => ({ parts });
const fixture = () => hsonLiveMap.fromLibraries({ collection: definition(parts()) });
function data(map: LiveMap, name = "collection"): LiveMapDataLibrary {
  const library = require_livemap_library_internal(map, name); if (library.mode === "document") throw Error("Expected data Library"); return library;
}
function atomic(map: LiveMap, run: () => unknown, pattern?: RegExp) {
  const aggregate = owner(map), before = map.capture(), registry = aggregate.hostedRegistry();
  const ids = aggregate.libraries(), roots = ids.map(id => aggregate.root(id));
  const epoch = aggregate.identityEpoch(), ledger = epoch.issued(), telemetry = aggregate.telemetry();
  let commits = 0, positions = 0, watches = 0;
  const stop = map.commits.observe(() => commits++), stopPosition = aggregate.observeAuthorityPosition(() => positions++);
  const stops = ids.filter(id => aggregate.inspect().libraries.find(entry => entry.identity === id)?.mode !== "document")
    .map(id => aggregate.watch(id, [], () => watches++));
  try { if (pattern) assert.throws(run, pattern); else assert.throws(run); }
  finally { stop(); stopPosition(); for (const stop of stops) stop(); }
  assert.deepEqual(map.capture(), before); assert.equal(aggregate.hostedRegistry(), registry);
  assert.equal(aggregate.identityEpoch(), epoch); assert.equal(epoch.issued(), ledger);
  assert.deepEqual(aggregate.libraries(), ids); ids.forEach((id, index) => assert.equal(aggregate.root(id), roots[index]));
  assert.equal(aggregate.telemetry().acceptedTransitions, telemetry.acceptedTransitions);
  assert.equal(aggregate.telemetry().aggregatePublications, telemetry.aggregatePublications);
  assert.equal(commits, 0); assert.equal(positions, 0); assert.equal(watches, 0);
}
const graph = (value: unknown) => projected_value_to_hson_root(admit_projected_value(value));
function invalidSnapshot(snapshot: LiveMapSnapshot): LiveMapSnapshot {
  return { ...snapshot, libraries: snapshot.libraries.map(entry => entry.name === "collection"
    ? { ...entry, root: encode_hosted_root(graph({ good: { kind: "document", document: '<p/>' }, late: { kind: "document", document: '<p' } })) }
    : entry) };
}
async function projection(map: LiveMap, names: readonly string[], privateNames: readonly string[] = []) {
  const aggregate = owner(map), position = aggregate.hostedPosition();
  const catalog = aggregate.hostedRegistry().libraries.filter(entry => entry.scope === undefined)
    .map(entry => ({ name: entry.name, ownership: privateNames.includes(entry.name) ? "private" as const : "shared" as const }));
  return normalize_locus_effective_projection(make_locus_hosted_projection_policy(aggregate.hostedRegistry(), position.authority,
    catalog, undefined, () => ({ libraries: names })), { libraries: names });
}
function sockets() {
  const toServer = new Set<(message: string) => void>(), toClient = new Set<(message: string) => void>();
  const wire: string[] = [];
  const client: LocusWebSocketLike = { send(raw) { for (const listener of toServer) listener(raw); }, close() {},
    onMessage(listener) { toClient.add(listener); return () => { toClient.delete(listener); }; }, onClose() { return () => {}; } };
  const server: LocusWebSocketLike = { send(raw) { wire.push(raw); for (const listener of toClient) listener(raw); }, close() {},
    onMessage(listener) { toServer.add(listener); return () => { toServer.delete(listener); }; }, onClose() { return () => {}; } };
  return { client, server, wire };
}

export async function part_collection_cases(check: (name: string, run: () => void | Promise<void>) => Promise<void>) {
  // Internal authority probes must share the source runtime that creates their maps.
  await check("public Parts final validation retains reentrancy and management fences", () => {
    for (const effect of ["edit", "management"] as const) {
      const map = hsonLiveMap.fromLibraries({ state: { data: { count: 1 } } });
      const aggregate = owner(map), manager = {};
      let captured = false, reentered = false, observations = 0, expected = map.capture();
      const stop = map.commits.observe(() => observations++);
      const definition = new Proxy({ parts: new Proxy({}, {
        ownKeys(target) { captured = true; return Reflect.ownKeys(target); },
      }) }, {
        has(target, key) {
          if (captured && key === "schema" && !reentered) {
            reentered = true;
            if (effect === "management") aggregate.claimManagement(manager);
            else { map.data.must("state").at(["count"]).set(2); expected = map.capture(); }
          }
          return Reflect.has(target, key);
        },
      });
      try {
        assert.throws(() => map.addLibraries({ earlier: { data: 2 }, parts: definition }),
          effect === "edit" ? /changed during capture/ : /controlled by an exclusive Locus authority/);
        assert.equal(reentered, true); assert.deepEqual(map.capture(), expected);
        assert.equal(observations, effect === "edit" ? 1 : 0);
        assert.throws(() => map.data.must("earlier")); assert.throws(() => map.parts.must("parts"));
      } finally { if (effect === "management" && reentered) aggregate.releaseManagement(manager); stop(); }
      map.addLibraries({ earlier: { data: 2 }, parts: { parts: {} } });
      const earlier = map.data.must("earlier");
      if (String(earlier.mode) === "document") throw Error("Expected data Library");
      assert.equal(earlier.snap(), 2);
    }
  });

  await check("installed Parts reject direct, widened, replayed, and reconstructed Schema attachment atomically", () => {
    const definitions = { collection: { parts: { p: { kind: "document", document: "<p/>" } } }, state: { data: 1 } } as const;
    const schema = Hson.schema`<type "data" content <p <content <kind "string" document "string">>>>` as HsonSchema<unknown, "data">;
    const ordinary = hsonLiveMap.fromLibraries({ collection: { data: definitions.collection.parts }, state: { data: 1 } });
    const replay = data(ordinary).schema.use(schema);
    const initial = hsonLiveMap.fromLibraries(definitions);
    const reconstructed = install_libraries_snapshot(initial.capture()).map;
    const dynamic = hsonLiveMap.create(); dynamic.addLibraries(definitions);
    for (const map of [initial, reconstructed, dynamic]) {
      const aggregate = owner(map), name: string = "collection", library = data(map, name);
      const contract = library.schema.get(), binding = aggregate.hostedRegistry().libraries.find(entry => entry.name === name)!;
      const identity = aggregate.libraries()[0]!;
      assert.ok(identity);
      const attempts = [
        () => library.schema.use(schema), () => data(map, name).schema.use(ANY_DATA),
        () => aggregate.useLibrarySchema(identity, schema, binding.schemaDigest), () => map.replay({ ...replay, prevRev: map.rev, rev: map.rev + 1 }),
      ];
      for (let repeat = 0; repeat < 2; repeat++) for (const attempt of attempts) {
        atomic(map, attempt, /Part collections do not support supplemental Schema/);
        assert.equal(library.schema.get(), contract);
        assert.equal(aggregate.hostedRegistry().libraries.find(entry => entry.name === name)?.validation, validation);
      }
      // A pending batch prefix must never publish if an indirect attachment rejects.
      atomic(map, () => map.batch(writer => {
        const target = writer.parts.must(name);
        if (String(target.mode) === "document") throw Error("Expected data");
        target.at(["p", "document"]).set('<p "discarded"/>');
        library.schema.use(schema);
      }));
      library.at(["p"]).replace({ kind: "document", document: '<p "valid after rejection"/>', stylesheet: "p{color:red}" });
      map.batch(writer => { const target = writer.parts.must(name);
        if (String(target.mode) === "document") throw Error("Expected data");
        target.at(["p", "document"]).set('<p "staged after rejection"/>'); });
      assert.equal(library.snap(["p", "document"]), '<p "staged after rejection"/>');
      assert.equal(library.schema.get(), contract);
      assert.equal(data(map, "state").snap(), 1);
    }
  });

  await check("hosted, mirror, and client-local Parts retain the attachment restriction", async () => {
    const map = hsonLiveMap.fromLibraries({ collection: { parts: { p: { kind: "document", document: "<p/>" } } } });
    const aggregate = owner(map), checkpoint = aggregate.captureSemanticCheckpoint();
    const mirror = make_livemap_mirror_from_semantic_checkpoint_internal(checkpoint);
    atomic(mirror, () => data(mirror).schema.use(ANY_DATA), /Part collections/);
    const snapshot = capture_selected_authority_projection_snapshot(map, await projection(map, ["collection"]));
    const client = client_projection_map({ authority: snapshot, local: { local: { parts: { p: { kind: "document", document: "<p/>" } } } } });
    atomic(client, () => data(client, "local").schema.use(ANY_DATA), /Part collections/);
    atomic(client, () => data(client).schema.use(ANY_DATA), /Shared|Locus authority/);
    data(client, "local").at(["p"]).replace({ kind: "document", document: "<aside/>" });
    const locus = hsonLiveMap.locus.create({ "collection": { parts: {}, access: "shared" } });
    try {
      assert.equal("use" in locus.parts.must("collection").schema, false);
      const authorityMap = locus_map_internal(locus), before = owner(authorityMap).hostedPosition();
      atomic(authorityMap, () => data(authorityMap).schema.use(ANY_DATA));
      assert.deepEqual(owner(authorityMap).hostedPosition(), before);
      await locus.parts.must("collection").at([]).replace({ p: { kind: "document", document: "<p/>" } });
      await locus.stage(writer => { writer.parts.must("collection").at(["p", "document"]).set("<aside/>"); });
    } finally { locus.dispose(); }
  });

  await check("reconstructed and hosted contracts cannot claim Parts plus a supplemental Schema", () => {
    const schema = Hson.schema`<type "data" content <p <content <kind "string" document "string">>>>` as HsonSchema<unknown, "data">;
    const ordinary = hsonLiveMap.fromLibraries({ collection: { data: { p: { kind: "document", document: "<p/>" } }, schema } });
    const snapshot = ordinary.capture();
    const entries = snapshot.registry.libraries.map(entry => ({ ...entry, validation }));
    // The canonical registry owner rejects even internally reconstructed evidence.
    assert.throws(() => make_hosted_registry(entries.map(entry => ({ name: entry.name, mode: entry.mode, validation,
      identity: {}, schema }))), /Part collections/);
    assert.throws(() => make_livemap_from_canonical_libraries_internal([{ name: "collection", family: "data", schema,
      root: graph({ p: { kind: "document", document: "<p/>" } }), validation }]), /Part collections/);
    const forged = { ...snapshot, registry: { ...snapshot.registry, libraries: entries },
      libraries: snapshot.libraries.map(entry => ({ ...entry, validation })) };
    assert.throws(() => install_libraries_snapshot(forged), /Part collections|registry/i);
  });

  await check("ordinary data and document post-admission Schemas retain governance", () => {
    const map = hsonLiveMap.fromLibraries({ state: { data: { count: 1 } }, page: { document: "<main/>" } });
    const state = map.data.must("state"), page = map.doc.must("page");
    assert.equal(state.schema.get(), ANY_DATA); assert.equal(page.schema.get(), ANY_DOCUMENT);
    assert.equal(data(map, "state").schema.use(Hson.schema`<type "data" content <count "number">>` as HsonSchema<unknown, "data">).changed, true);
    assert.equal(map.doc.must(String("page")).schema.use(Hson.schema`<type "document" tag "main" content "empty">`).changed, true);
    atomic(map, () => state.at(["count"]).set("bad" as never));
    atomic(map, () => page.at([0]).replace("<aside/>"));
    state.at(["count"]).set(2);
  });

  await check("one data Library admits two values in one transition without child registration or issuance", () => {
    const map = hsonLiveMap.fromLibraries({}), aggregate = owner(map), commits: LiveMapCommit[] = [];
    let attempts = 0;
    set_livemap_quid_candidate_source_for_tests(aggregate.identityEpoch().owner, () => { attempts++; throw Error("No Part identity allocation"); });
    try {
      map.commits.observe(commit => { assert.ok(read(map, "collection", "first/β")); commits.push(commit); });
      const commit = collect(map, "collection", parts());
      assert.equal(commit.rev, 1); assert.equal(commits.length, 1); assert.equal(commit.operations.length, 1);
      const op = commit.operations[0]!.operation;
      if (!("kind" in op) || op.kind !== "library-add") throw Error("Expected topology commit");
      assert.equal(op.libraries.length, 1); assert.equal(op.libraries[0]!.mode, "data-object");
      assert.equal(op.libraries[0]!.validation, validation);
      assert.deepEqual(map.capture().registry.libraries.map(entry => entry.name), ["collection"]);
      assert.equal(aggregate.libraries().length, 1); assert.equal(aggregate.telemetry().acceptedTransitions, 1);
      assert.equal(data(map), map.parts.must("collection"));
      for (const member of Object.keys(parts())) assert.throws(() => map.data.must(member));
      assert.equal(aggregate.projectedOverlay(aggregate.libraries()[0]!).size, 0);
      assert.equal(aggregate.identityEpoch().issued().size, 0); assert.deepEqual(enumerate_livemap_issued_quids(aggregate.identityEpoch().issued()), []); assert.equal(attempts, 0);
    } finally { set_livemap_quid_candidate_source_for_tests(aggregate.identityEpoch().owner, undefined); }
  });
  await check("keys are ordinary data strings and local landmarks never synthesize a root name", () => {
    const map = hsonLiveMap.fromLibraries({ "arbitrary library": definition({
      "slash/葉": { kind: "document", document: '<section <i @:label/>/>' },
      "1 non QUAD key": { kind: "document", document: '<a @:label/>' },
      controls: { kind: "document", document: '<b/>' }, button: { kind: "document", document: '<p/>' },
    }) });
    assert.deepEqual(read(map, "arbitrary library", "slash/葉").quads, [{ name: "label", path: [0, 0, 0] }]);
    assert.deepEqual(read(map, "arbitrary library", "1 non QUAD key").quads, [{ name: "label", path: [0] }]);
    assert.equal(read(map, "arbitrary library", "button").quads, undefined);
    assert.equal(owner(map).identityEpoch().issued().size, 0);
    const before = map.capture(); read(map, "arbitrary library", "controls"); assert.deepEqual(map.capture(), before);
    const ordinary = hsonLiveMap.fromLibraries({ controls: { data: { button: { kind: "document", document: '<bad' } } } });
    assert.equal(ordinary.capture().registry.libraries[0]!.validation, undefined);
    assert.throws(() => read(ordinary, "controls", "button"));
  });
  await check("source content distinctions and absent versus empty CSS survive exact materialization", () => {
    const map = hsonLiveMap.fromLibraries({ collection: definition({
      absent: { kind: "document", document: '<p/>' }, empty: { kind: "document", document: '<p ""/>', stylesheet: "" },
      text: { kind: "document", document: '<p "a" "b"/>' },
    }) });
    assert.notDeepEqual(read(map, "collection", "absent").root, read(map, "collection", "empty").root);
    assert.equal(Object.hasOwn(read(map, "collection", "absent"), "css"), false);
    assert.equal(Object.hasOwn(read(map, "collection", "empty"), "css"), true);
    const restored = install_libraries_snapshot(map.capture()).map;
    for (const member of ["absent", "empty", "text"]) assert.deepEqual(read(restored, "collection", member), read(map, "collection", member));
    assert.deepEqual(data(restored).snap(), data(map).snap());
    assert.equal(Hson.document`<p @:label/>`, "<p @:label/>");
  });
  await check("CSS keeps the full owned stylesheet including ordering-only layers properties and keyframes", () => {
    const map = fixture(), part = read(map, "collection", "first/β");
    assert.deepEqual(part.css, parse_document_stylesheet(css, []));
    assert.equal(part.css!.properties.length, 1); assert.equal(part.css!.keyframes.length, 1);
    assert.ok(part.css!.order!.length > 0);
    const ordering = '@layer reset{}@layer theme{}'; data(map).at(["二"]).replace({ ...parts()["二"], stylesheet: ordering });
    assert.deepEqual(read(map, "collection", "二").css, parse_document_stylesheet(ordering, []));
    assert.match(render_portable_document_stylesheet(decode_portable_document_stylesheet(read(map, "collection", "二").css)), /@layer reset/);
    assert.equal(JSON.stringify(part.root).includes('style'), false);
    assert.equal(JSON.stringify(part.root).includes('quid'), false);
  });
  await check("malformed late records reject atomically at initial and ordinary later admission", () => {
    const failures: unknown[] = [null, [], {}, { kind: "data", document: '<p/>' }, { kind: "document" },
      { kind: "document", document: "" }, { kind: "document", document: '"text"' },
      { kind: "document", document: '<p/> <q/>' }, { kind: "document", document: '<p' },
      { kind: "document", document: '<p/> trailing' }, { kind: "document", document: '<hson-part lib="x"/>' },
      { kind: "document", document: '<p @000009001/>' }, { kind: "document", document: '<p @bad/>' },
      { kind: "document", document: '<p @:1bad/>' }, { kind: "document", document: '<p @:same @:other/>' },
      { kind: "document", document: '<p <i @:same/> <b @:same/>/>' },
      { kind: "document", document: '<p/>', quads: [{ name: "a", path: [99] }] },
      { kind: "document", document: '<p/>', stylesheet: '@import "remote.css";' },
      { kind: "document", document: '<p/>', stylesheet: 'p{color:' },
      { kind: "document", document: '<p/>', stylesheet: undefined },
      { kind: "document", document: '<p/>', schema: Hson.schema`<type "document" tag "p">` },
      { kind: "document", document: '<p/>', schema: '<type "document" tag "p">' },
      { kind: "document", document: { $_tag: "p", $_content: [], $_meta: { quid: "000009001" } } },
    ];
    for (const bad of failures) {
      const candidate = { good: parts()["二"], late: bad };
      assert.throws(() => hsonLiveMap.fromLibraries({ collection: { data: candidate, validation } } as never));
      const map = fixture(); atomic(map, () => collect(map, "next", candidate));
      atomic(map, () => map.addLibraries({ next: { data: candidate, validation } } as never).commit);
      assert.throws(() => map.data.must("next"));
    }
  });
  await check("descriptor-exact portable data admission rejects getters undefined hidden and nonportable fields", () => {
    let reads = 0;
    const member = Object.defineProperty({ kind: "document", document: '<p/>' }, "stylesheet", { enumerable: true, get() { reads++; return ""; } });
    const collection = Object.defineProperty({}, "member", { enumerable: true, get() { reads++; return parts()["二"]; } });
    const hidden = Object.defineProperty({ kind: "document", document: '<p/>' }, "extra", { value: true });
    for (const input of [[], null, "text", { member }, collection, { hidden },
      { bad: { ...parts()["二"], extra: true } }, { bad: undefined }, { bad: () => 0 },
      { bad: new Date() }, { [Symbol("extra")]: parts()["二"] }]) {
      const map = fixture(); atomic(map, () => collect(map, "next", input));
    }
    assert.equal(reads, 0);
    for (const evidence of [undefined, "other", null]) assert.throws(() => hsonLiveMap.fromLibraries({ collection: { data: {}, validation: evidence } } as never));
    assert.throws(() => hsonLiveMap.fromLibraries({ collection: { document: '<p/>', validation } } as never));
    assert.throws(() => hsonLiveMap.fromLibraries({ collection: { data: [], validation } } as never));
    const accessor = Object.defineProperty({ data: {} }, "validation", { enumerable: true, get() { reads++; return validation; } });
    assert.throws(() => hsonLiveMap.fromLibraries({ collection: accessor })); assert.equal(reads, 0);
  });
  await check("all data field and object mutation helpers validate the complete final collection before publication", () => {
    const map = fixture(), library = data(map), member = library.at(["first/β"]).asObject()!, doc = member.at(["document"]);
    const invalid = { kind: "document", document: '<p' };
    const failures = [() => doc.set('<p'), () => doc.replace('<p/> <q/>'), () => doc.update(() => '<p'),
      () => doc.delete(), () => member.set({ css: '@import "x";' }), () => member.replace(invalid),
      () => member.update(() => invalid), () => member.object.setKey("document", '<p'),
      () => member.object.setMany({ document: '<p' }), () => member.object.clear(), () => member.object.deleteKey("kind"),
      () => member.object.deleteMany(["kind", "document"]), () => member.object.renameKey("document", "unsupported"),
      () => library.at([]).asObject()!.object.setKey("late", invalid), () => library.at([]).asObject()!.object.setMany({ good: parts()["二"], late: invalid })];
    for (const fail of failures) atomic(map, fail);
    doc.set('<section @:label/>');
    atomic(map, () => member.object.setKey("stylesheet", ""), /field access/);
    atomic(map, () => member.object.deleteKey("stylesheet"), /field access/);
    member.replace({ kind: "document", document: '<section @:label/>', stylesheet: "" });
    member.replace({ kind: "document", document: '<section @:label/>' });
    library.at([]).asObject()!.object.setKey("extra", { kind: "document", document: '<div/>' });
    library.at([]).asObject()!.object.renameKey("extra", "new/葉"); library.at(["new/葉"]).delete();
    library.at([]).asObject()!.object.deleteMany(["二"]); assert.equal(owner(map).libraries().length, 1);
    library.at([]).asObject()!.object.clear(); assert.deepEqual(library.snap(), {}); assert.equal(owner(map).identityEpoch().issued().size, 0);
  });
  await check("root set replace update and batches validate final state including coordinated incomplete edits", () => {
    const map = fixture(), library = data(map);
    for (const fail of [() => library.at([]).set({ bad: {} }), () => library.at([]).replace({ bad: {} }),
      () => library.at([]).update(() => ({ bad: {} })), () => library.at([]).delete()]) atomic(map, fail);
    library.at([]).replace({ only: { kind: "document", document: '<p/>' } });
    library.at([]).update(() => parts());
    const rev = map.rev;
    map.batch(writer => {
      writer.parts.must("collection").at(["first/β", "document"]).set('<bad');
      writer.parts.must("collection").at(["first/β", "kind"]).delete();
      writer.parts.must("collection").at(["first/β", "document"]).set('<p @:label/>');
      writer.parts.must("collection").at(["first/β"]).set({ kind: "document" });
    });
    assert.equal(map.rev, rev + 1);
    atomic(map, () => map.batch(writer => { writer.parts.must("collection").at(["二", "document"]).set('<p/>');
      writer.parts.must("collection").at(["first/β"]).replace({ ...parts()["first/β"], stylesheet: '@import "x";' }); }));
    atomic(map, () => map.batch(() => collect(map, "extra", parts())));
  });
  await check("ordinary Library uniqueness and aggregate authority fences apply uniformly", () => {
    const map = fixture(), aggregate = owner(map), manager = {};
    atomic(map, () => collect(map, "collection", parts()));
    atomic(map, () => map.addLibraries({ collection: { data: {} } } as never).commit);
    aggregate.claimManagement(manager);
    try { atomic(map, () => collect(map, "next", parts())); atomic(map, () => data(map).at(["二", "document"]).set('<p/>')); }
    finally { aggregate.releaseManagement(manager); }
    atomic(map, () => acquire_projected_identity(data(map), ["first/β"]));
  });
  await check("completed reentrant inner transitions survive invalid outer data candidates", () => {
    const map = fixture(), library = data(map), rev = map.rev;
    assert.throws(() => library.at(["二", "document"]).update(() => {
      library.at(["二"]).replace({ ...parts()["二"], stylesheet: '@layer one{}@layer two{}' }); return '<p';
    }));
    assert.equal(map.rev, rev + 1); assert.equal(map.parts.must("collection").at(["二"]).snap()?.stylesheet, '@layer one{}@layer two{}');
    const candidate = new Proxy(parts(), { ownKeys(target) {
      library.at(["二", "document"]).set('<b/>'); return Reflect.ownKeys(target);
    } });
    assert.throws(() => collect(map, "extra", candidate), /changed during capture/);
    assert.equal(library.snap(["二", "document"]), '<b/>'); assert.throws(() => map.data.must("extra"));
  });
  await check("late serialization and identity reentrancy fence Part admission and preserve independent effects", () => {
    for (const mode of ["throw", "management"]) {
      const map = fixture(), aggregate = owner(map), manager = {}, descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "toJSON");
      let reached = false;
      try {
        atomic(map, () => {
          Object.defineProperty(Object.prototype, "toJSON", { configurable: true, value(this: unknown) {
            if (!reached && typeof this === "object" && this !== null && Reflect.get(this, "format") === "hson-exact-value") {
              reached = true; if (mode === "throw") throw Error("Late serialization failure"); aggregate.claimManagement(manager);
            }
            return this;
          } });
          try { collect(map, "extra", parts()); }
          finally { if (descriptor === undefined) Reflect.deleteProperty(Object.prototype, "toJSON"); else Object.defineProperty(Object.prototype, "toJSON", descriptor); }
        });
        assert.equal(reached, true);
      } finally { if (mode === "management" && reached) aggregate.releaseManagement(manager); }
    }
    const map = hsonLiveMap.fromLibraries({ page: { document: '<main/>' } }), library = map.doc.must("page");
    if (library.mode !== "document") throw Error("Expected document");
    const aggregate = owner(map), before = map.capture();
    let reentered = false;
    const input = new Proxy(parts(), { ownKeys(target) { if (!reentered) { reentered = true;
      acquire_document_identity(library.document, { kind: "path", path: [0] }); } return Reflect.ownKeys(target); } });
    assert.throws(() => collect(map, "extra", input), /changed during capture/);
    assert.deepEqual(map.capture(), before); assert.equal(aggregate.identityEpoch().issued().size, 1);
    assert.throws(() => map.data.must("extra"));
  });
  await check("capture read and materialization are observational and fail during incomplete identity transactions", () => {
    const map = hsonLiveMap.fromLibraries({ collection: definition(parts()), page: { document: '<main/>' } });
    const aggregate = owner(map), id = aggregate.libraries()[1]!, before = map.capture();
    aggregate.acquireLocalDocumentIdentity(id, validate_document_path([0]), mint_hson_node_quid(), {
      preflight: () => ({ apply() {}, rollback() {}, release() {} }),
      realize() { assert.throws(() => map.capture(), /incomplete/); assert.throws(() => map.cut(), /incomplete/);
        assert.throws(() => read(map, "collection", "二"), /incomplete/); assert.throws(() => data(map).snap(), /incomplete/); },
      rollbackRealization() {},
    });
    const ledger = aggregate.identityEpoch().issued(), roots = aggregate.libraries().map(id => aggregate.root(id));
    map.capture(); map.cut(); aggregate.captureHosted(); aggregate.captureSemanticCheckpoint();
    read(map, "collection", "first/β"); data(map).root(); data(map).at([]).hson();
    assert.deepEqual(map.capture(), before); assert.equal(aggregate.identityEpoch().issued(), ledger);
    aggregate.libraries().forEach((id, index) => assert.equal(aggregate.root(id), roots[index]));
  });
  await check("selected root serialization reentrancy rejects source capture and preserves the completed inner edit", () => {
    const map = fixture(), library = data(map), revision = map.rev;
    const captured = map.cut().libs, collection = captured.libraries.find(entry => entry.name === "collection");
    assert.ok(collection);
    const encode = TextEncoder.prototype.encode;
    let entered = false, detachedBoundReached = false, result: unknown;
    TextEncoder.prototype.encode = function (input) {
      if (input?.startsWith('{"format":"hson-livemap-libraries-snapshot"')) detachedBoundReached = true;
      // The selected root's payload is encoded inside captureSelectedHosted,
      // before its source fence closes or the detached envelope is bounded.
      if (!entered && input === collection.root.payload) {
        assert.equal(detachedBoundReached, false);
        entered = true; TextEncoder.prototype.encode = encode;
        library.at(["二", "document"]).set('<b/>');
      }
      return encode.call(this, input);
    };
    try { assert.throws(() => { result = map.cut(); }, /changed during capture/); }
    finally { TextEncoder.prototype.encode = encode; }
    assert.equal(result, undefined); assert.equal(detachedBoundReached, false);
    assert.equal(entered, true); assert.equal(map.rev, revision + 1);
    assert.equal(library.snap(["二", "document"]), '<b/>');
  });
  await check("detached cut bounds and realization preserve captured siblings and completed source edits", () => {
    for (const phase of ["state-size", "html-size", "html-realization"]) {
      const map = hsonLiveMap.fromLibraries({ collection: definition(parts()), state: { data: { count: 0 } },
        page: { document: '<html <head/> <body data-cut=before/>/>' } });
      const library = data(map), page = map.doc.must("page");
      if (page.mode !== "document") throw Error("Expected document");
      const body = page.at([]).at([1]).asElement(); assert.ok(body);
      page.css.sel("body").set.color("blue");
      const revision = map.rev, capturedParts = library.snap(), capturedHtml = page.render();
      const expected = phase === "state-size" ? map.cut() : map.cut({ html: "page" });
      const document = expected.libs.libraries.find(entry => entry.name === "page"); assert.ok(document);
      const encode = TextEncoder.prototype.encode;
      let entered = false, detachedBoundReached = false;
      const mutate = () => {
        entered = true; TextEncoder.prototype.encode = encode;
        library.at(["二", "document"]).set('<b/>');
        data(map, "state").at(["count"]).set(1);
        body.attrs.set("data-cut", "after");
        page.css.sel("body").set.color("red");
      };
      TextEncoder.prototype.encode = function (input) {
        if (!entered && input?.startsWith('{"format":"hson-livemap-libraries-snapshot"')) {
          // Exact equality proves the complete candidate was assembled before reentry.
          assert.deepEqual(JSON.parse(input), expected.libs);
          detachedBoundReached = true;
          if (phase !== "html-realization") mutate();
        } else if (!entered && phase === "html-realization" && detachedBoundReached && input === document.root.payload) {
          // Only HTML realization decodes this detached document after the bound check.
          mutate();
        }
        return encode.call(this, input);
      };
      try {
        const result = phase === "state-size" ? map.cut() : map.cut({ html: "page" });
        assert.equal(detachedBoundReached, true); assert.equal(entered, true);
        assert.deepEqual(result, expected); assert.equal(result.libs.revision, revision);
        if ("html" in result) assert.equal(result.html, capturedHtml);
        const restored = install_libraries_snapshot(result.libs).map, restoredPage = restored.doc.must("page");
        if (restoredPage.mode !== "document") throw Error("Expected restored document");
        assert.deepEqual(data(restored).snap(), capturedParts);
        assert.equal(data(restored, "state").snap(["count"]), 0);
        assert.equal(restoredPage.render(), capturedHtml);
      } finally { TextEncoder.prototype.encode = encode; }
      assert.equal(map.rev, revision + 4); assert.equal(library.snap(["二", "document"]), '<b/>');
      assert.equal(data(map, "state").snap(["count"]), 1);
      const current = map.cut({ html: "page" });
      assert.equal(current.libs.revision, revision + 4);
      assert.match(current.html, /data-cut="after"/); assert.match(current.html, /color:red/);
      assert.equal(owner(map).identityEpoch().issued().size, 0);
    }
  });
  await check("invalid outbound source rejects every data read and export without output revision or issuance", () => {
    const map = hsonLiveMap.fromLibraries({ collection: definition(parts()), page: { document: '<main/>' } });
    const aggregate = owner(map), id = aggregate.libraries()[0]!, root = aggregate.root(id), original = data(map).root();
    const library = data(map), handle = library.at([]).asObject()!, ledger = aggregate.identityEpoch().issued(), revision = map.rev;
    overwrite_hson_node(root, graph({ bad: { kind: "document", document: '<p' } }));
    try {
      for (const outbound of [() => map.capture(), () => map.cut(), () => aggregate.captureHosted(),
        () => aggregate.captureSelectedHosted(["collection"], false), () => aggregate.captureSemanticCheckpoint(), () => aggregate.inspect(),
        () => library.snap(), () => library.root(), () => handle.snap(), () => handle.hson(),
        () => handle.object.toObject(), () => handle.object.values(), () => handle.object.entries(), () => handle.object.pick(["bad"]),
        () => read(map, "collection", "bad")]) assert.throws(outbound);
      assert.equal(aggregate.hostedPosition().revision, revision); assert.equal(aggregate.identityEpoch().issued(), ledger);
      assert.equal(map.cut({ data: [], documents: [] }).libs.libraries.length, 0);
      const excluded = map.cut({ data: [], documents: ["page"], html: "page" });
      assert.deepEqual(excluded.libs.registry.libraries.map(entry => entry.name), ["page"]);
      assert.equal(excluded.html, '<main></main>'); assert.equal(typeof encode_ssr_bootstrap(excluded.libs), "string");
    } finally { overwrite_hson_node(root, original); }
    assert.equal(read(map, "collection", "二").key, "二");
  });
  await check("capture selected cuts same-topology topology-changing and fresh restores retain the portable contract", () => {
    const map = fixture(), capture = map.capture(), cut = map.cut({ data: ["collection"], documents: [] }).libs;
    assert.deepEqual(cut, capture); data(map).at(["二", "document"]).set('<p/>'); map.restore(capture);
    assert.deepEqual(map.capture(), capture); atomic(map, () => data(map).at(["二", "document"]).set('<p'));
    const fresh = install_libraries_snapshot(structuredClone(capture)).map;
    assert.deepEqual(fresh.capture(), capture); atomic(fresh, () => data(fresh).at(["二", "document"]).set('<p'));
    const different = hsonLiveMap.fromLibraries({ ordinary: { data: {} } });
    // This actual internal owner route admits a different complete topology;
    // the public restore intentionally requires its current registry digest.
    owner(different).restoreLibraries(capture);
    assert.deepEqual(different.capture(), capture);
    const restoredId = owner(different).libraries()[0]!;
    atomic(different, () => owner(different).commit([{ target: owner(different).target(restoredId, ["二", "document"]),
      kind: "set", value: admit_projected_value('<p') }]));
    assert.equal(owner(fresh).identityEpoch().issued().size, 0);
    const ordinaryRegistry = make_hosted_registry([{ name: "collection", mode: "data-object", schema: data(map).schema.get(), identity: {} }]);
    assert.notEqual(ordinaryRegistry.digest, capture.registry.digest);
  });
  await check("malformed portable collections fail at every snapshot checkpoint and receiving owner admission", async () => {
    const map = fixture(), invalid = invalidSnapshot(map.capture()), aggregate = owner(map);
    atomic(map, () => map.restore(invalid)); assert.throws(() => install_libraries_snapshot(invalid));
    const other = hsonLiveMap.fromLibraries({ other: { data: {} } }); atomic(other, () => other.restore(invalid));
    const checkpoint = aggregate.captureSemanticCheckpoint();
    const badCheckpoint = { ...checkpoint, libraries: checkpoint.libraries.map(entry => ({ ...entry, root: decode_hosted_root(invalid.libraries[0]!.root) })) };
    atomic(map, () => aggregate.installSemanticCheckpoint(badCheckpoint));
    assert.throws(() => make_livemap_mirror_from_semantic_checkpoint_internal(badCheckpoint));
    const wire = make_portable_aggregate_snapshot(aggregate.captureHosted());
    const badWire = { ...wire, libraries: invalid.libraries };
    assert.throws(() => make_livemap_client_composition_from_portable_aggregate_internal(badWire));
    const adapter = new MemoryCheckpointAdapter(); await assert.rejects(() => write_semantic_checkpoint(badCheckpoint, adapter));
    assert.equal(adapter.chunks.size, 0); assert.equal(adapter.manifests.size, 0); assert.equal(adapter.checkpointCalls.length, 0);
    const fresh = make_livemap_mirror_from_semantic_checkpoint_internal(checkpoint);
    assert.deepEqual(read(fresh, "collection", "二"), read(map, "collection", "二"));
    atomic(fresh, () => data(fresh).at(["二"]).replace({ ...parts()["二"], stylesheet: '@import "x";' }));
    assert.throws(() => make_livemap_from_canonical_libraries_internal([{ name: "collection", family: "data", validation,
      schema: data(map).schema.get(), root: graph({ bad: {} }) }]));
  });
  await check("existing owners reject coherent ordinary-data restores that would remove their Part contract", () => {
    const map = fixture();
    const ordinary = hsonLiveMap.fromLibraries({ collection: { data: { bad: { kind: "document", document: '<p' } } } });
    atomic(map, () => owner(map).restoreLibraries(ordinary.capture()), /validation contract/);
    const portable = make_portable_aggregate_snapshot(owner(map).captureHosted());
    const mirror = make_livemap_client_composition_from_portable_aggregate_internal(portable), manager = {};
    owner(mirror).claimManagement(manager);
    try {
      const downgraded = { ...make_portable_aggregate_snapshot(owner(ordinary).captureHosted()), authority: portable.authority };
      atomic(mirror, () => reconcile_client_projection_snapshot_internal(mirror, manager, downgraded), /validation contract/);
    } finally { owner(mirror).releaseManagement(manager); }
  });
  await check("authorized projections preserve validation and private collections never enter wire state", async () => {
    const map = hsonLiveMap.fromLibraries({ collection: definition(parts()), hidden: definition({ secret: { kind: "document", document: '<secret-unique/>' } }) });
    const effective = await projection(map, ["collection", "hidden"], ["hidden"]);
    const snapshot = capture_selected_authority_projection_snapshot(map, effective);
    assert.deepEqual(snapshot.libraries.map(entry => entry.name), ["collection"]);
    assert.equal(snapshot.libraries[0]!.validation, validation); assert.equal(JSON.stringify(snapshot).includes('secret-unique'), false);
    const bad = { ...snapshot, libraries: snapshot.libraries.map(entry => ({ ...entry, root: invalidSnapshot(map.capture()).libraries[0]!.root })) };
    assert.throws(() => admit_authority_projection_snapshot(bad));
    const portable = authority_projection_as_client_composition_internal(snapshot), mirror = make_livemap_client_composition_from_portable_aggregate_internal(portable);
    assert.equal(read(mirror, "collection", "二").key, "二");
    const manager = {}; owner(mirror).claimManagement(manager);
    try {
      atomic(mirror, () => reconcile_client_projection_snapshot_internal(mirror, manager, { ...portable, libraries: invalidSnapshot(map.capture()).libraries.slice(0, 1) }));
      reconcile_client_projection_snapshot_internal(mirror, manager, portable);
      assert.equal(owner(mirror).identityEpoch().issued().size, 0);
    } finally { owner(mirror).releaseManagement(manager); }
  });
  await check("portable replay validates final data and hosted topology carries exactly one collection binding", async () => {
    const map = fixture(), aggregate = owner(map), snapshot = make_portable_aggregate_snapshot(aggregate.captureHosted());
    const mirror = make_livemap_client_composition_from_portable_aggregate_internal(snapshot), manager = {};
    owner(mirror).claimManagement(manager);
    const record = aggregate.commit([{ target: aggregate.target(aggregate.libraries()[0]!, ["二", "document"]), kind: "set", value: admit_projected_value('<p/>') }]);
    const replay = make_portable_aggregate_commit(record.hosted!)!;
    try {
      owner(mirror).replayClientHostedManaged(manager, replay, snapshot.revision);
      assert.equal(data(mirror).snap(["二", "document"]), '<p/>');
      const badSource = hsonLiveMap.fromLibraries({ collection: { data: data(map).snap()! } });
      owner(badSource).setInitialHostedAuthority(snapshot.authority);
      const badCommit = owner(badSource).commit([{ target: owner(badSource).target(owner(badSource).libraries()[0]!, ["二", "document"]), kind: "set", value: admit_projected_value('<p') }]);
      const bad = { ...make_portable_aggregate_commit(badCommit.hosted!)!, registryDigest: owner(mirror).clientProjection()!.registry.digest };
      atomic(mirror, () => owner(mirror).replayClientHostedManaged(manager, bad, replay.rev));
    } finally { owner(mirror).releaseManagement(manager); }
    const empty = hsonLiveMap.fromLibraries({}), emptyOwner = owner(empty), before = make_portable_aggregate_snapshot(emptyOwner.captureHosted());
    const client = make_livemap_client_composition_from_portable_aggregate_internal(before), clientManager = {};
    let hostedTopology: import("../../src/api/livemap/livemap.hosted.ts").HostedAggregateCommit | undefined;
    emptyOwner.observe(transition => { hostedTopology = transition.hosted; });
    const commit = collect(empty, "collection", parts());
    if (hostedTopology?.topology === undefined) throw Error("Expected hosted topology");
    const tampered = { ...hostedTopology, topology: { ...hostedTopology.topology, operation: { ...hostedTopology.topology.operation,
      libraries: hostedTopology.topology.operation.libraries.map(entry => ({ ...entry, root: encode_hosted_root(graph({ bad: {} })) })) } } };
    assert.throws(() => make_portable_aggregate_commit(tampered));
    const unstable: import("../../src/api/livemap/livemap.hosted.ts").HostedAggregateCommit = structuredClone(hostedTopology);
    const entries = unstable.topology!.operation.libraries;
    const original = entries[0]!;
    let switched = false;
    const proxy = new Proxy(original, { ownKeys(target) {
      if (!switched) { switched = true; const replacement = { ...original, root: encode_hosted_root(graph({ bad: { kind: "document", document: '<p' } })) };
        Reflect.deleteProperty(replacement, "validation"); Reflect.set(entries, "0", replacement); }
      return Reflect.ownKeys(target);
    } });
    Reflect.set(entries, "0", proxy);
    assert.throws(() => make_portable_aggregate_commit(unstable), /capture/);
    assert.equal(switched, true);
    without_structured_clone(() => {
      const legacy = hsonLiveMap.fromLibraries({});
      legacy.addLibraries({ ordinary: { data: { value: 1 } } });
      collect(legacy, "collection", parts());
      assert.equal(read(legacy, "collection", "二").key, "二");
      assert.equal(legacy.capture().registry.libraries.length, 2);
    });
    for (const route of ["portable", "hosted"]) for (const mutation of ["root", "contract"]) {
      const candidate: import("../../src/api/livemap/livemap.hosted.ts").HostedAggregateCommit = structuredClone(hostedTopology);
      const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "toJSON");
      let entered = false;
      Object.defineProperty(Object.prototype, "toJSON", { configurable: true, value(this: unknown) {
        if (!entered && typeof this === "object" && this !== null
          && Reflect.get(this, "format") === (route === "portable" ? "hson-portable-aggregate-commit" : "hson-hosted-commit")) {
          entered = true;
          const entry = candidate.topology!.operation.libraries[0]!;
          if (mutation === "root") Reflect.set(entry, "root", encode_hosted_root(graph({ bad: { kind: "document", document: '<p' } })));
          else Reflect.deleteProperty(entry, "validation");
        }
        return this;
      } });
      try {
        const output: import("../../src/api/livemap/livemap.hosted.ts").HostedAggregateCommit | import("../../src/api/livemap/livemap.hosted.ts").PortableAggregateCommit | undefined = route === "portable" ? make_portable_aggregate_commit(candidate)
          : make_hosted_topology_commit(candidate.authority, before.registry, empty.capture().registry, candidate.topology!, candidate.prevRev);
        const entry: import("../../src/types/livemap.types.ts").LiveMapLibraryAddOperation["operation"]["libraries"][number] = output!.topology!.operation.libraries[0]!;
        assert.equal(entered, true); assert.equal(entry.validation, validation);
        assert.equal(validate_part_collection(projected_value_from_hson_node(decode_hosted_root(entry.root))).length, 2);
      } finally { if (descriptor === undefined) Reflect.deleteProperty(Object.prototype, "toJSON"); else Object.defineProperty(Object.prototype, "toJSON", descriptor); }
    }
    const topology = commit.operations[0];
    if (topology === undefined || !("kind" in topology.operation) || topology.operation.kind !== "library-add") throw Error("Expected topology");
    owner(client).claimManagement(clientManager);
    try {
      install_client_projected_topology_internal(client, clientManager, topology as never, empty.capture().registryDigest);
      assert.equal(owner(client).libraries().length, 1); assert.equal(read(client, "collection", "二").key, "二");
    } finally { owner(client).releaseManagement(clientManager); }
  });
  await check("hosted managed actions Echo acceptance durable replay and restart enforce the same collection contract", async () => {
    const adapter = new MemoryCheckpointAdapter();
    const options = [{ "collection": { parts: parts(), access: "shared" }, "hidden": { parts: { secret: { kind: "document", document: '<secret-only/>' } }, access: "private" } }, { logicalMapId: "part-collection-durable", persistence: adapter, authorizeProjection: () => ({ libraries: ["collection", "hidden"] }), actions: {
        valid(context: import("../../src/types/locus.types.ts").LocusActionContext<ReturnType<typeof fixture>>) { context.stage.parts.must("collection").at(["二", "document"]).set('<p @:label/>'); },
        invalid(context: import("../../src/types/locus.types.ts").LocusActionContext<ReturnType<typeof fixture>>) { context.stage.parts.must("collection").at(["二"]).replace({ ...parts()["二"], stylesheet: '@import "x";' }); },
      } }] as const;
    const locus = await hsonLiveMap.locus.resume(options[0], options[1]), map = locus_map_internal(locus), pair = sockets();
    const session = await locus.session.create({ libraries: ["collection", "hidden"] });
    const detach = bind_locus_websocket(locus, pair.server);
    const echo = await hsonLiveMap.echo.create({ now: session.now(), credential: session.credential!, transport: test_echo_transport(pair.client) });
    try {
      assert.equal(echo.parts.must("collection").mode, "data-object"); assert.throws(() => echo.data.must("hidden"));
      assert.equal(JSON.stringify(session.now()).includes('secret-only'), false);
      const before = map.capture(), appended = adapter.appendCalls.length;
      const rejected = await echo.action("invalid"); assert.equal(rejected.type, "error");
      assert.deepEqual(map.capture(), before); assert.equal(adapter.appendCalls.length, appended);
      const accepted = await echo.action("valid"); assert.equal(accepted.type, "ack");
      assert.equal(adapter.appendCalls.length, appended + 1);
      const receiving = echo.parts.must("collection"); if (String(receiving.mode) === "document") throw Error("Expected data replica");
      assert.equal(receiving.snap(["二", "document"]), '<p @:label/>');
      assert.equal(pair.wire.some(raw => raw.includes('secret-only')), false);
      assert.equal(owner(map).identityEpoch().issued().size, 0);
    } finally { echo.dispose(); detach(); locus.dispose(); }
    const durable = await load_persistent_locus_hosted_aggregate_internal(options[1].logicalMapId, { persistence: adapter });
    assert.ok(durable); assert.equal(data(durable!.map).snap(["二", "document"]), '<p @:label/>'); durable!.dispose();
    const restarted = await hsonLiveMap.locus.resume(options[0], options[1]);
    try {
      assert.equal(data(locus_map_internal(restarted)).snap(["二", "document"]), '<p @:label/>');
      const rev = restarted.rev, appended = adapter.appendCalls.length;
      assert.equal((await restarted.dispatchAction({ type: "action", id: "restart-invalid", name: "invalid" })).type, "error");
      assert.equal(restarted.rev, rev); assert.equal(adapter.appendCalls.length, appended);
      await hsonLiveMap.locus.checkpoint(restarted);
      const manifest = adapter.state(options[1].logicalMapId)!.checkpoint;
      assert.equal(manifest.format, "hson-locus-durable-aggregate-checkpoint");
      if (manifest.format !== "hson-locus-durable-aggregate-checkpoint") throw Error("Expected durable manifest");
      assert.equal(manifest.registry.libraries[0]!.validation, validation);
    } finally { restarted.dispose(); }
    const reconstructed = await load_persistent_locus_hosted_aggregate_internal(options[1].logicalMapId, { persistence: adapter });
    assert.ok(reconstructed); atomic(reconstructed!.map, () => data(reconstructed!.map).at(["二", "document"]).set('<p'));
    reconstructed!.dispose();
  });
  await check("client-local Part initializer and repeated installation preserve validation and reject malformed seeds", async () => {
    const locus = hsonLiveMap.locus.create({ "base": { data: { value: 1 }, access: "shared" } }, { local: [{ name: "collection", initializer: definition(parts()) }], authorizeProjection: () => ({ libraries: ["base", "collection"] }) });
    const session = await locus.session.create({ libraries: ["base", "collection"] }), pair = sockets();
    const now = session.now(); assert.equal(now.local[0]!.validation, validation);
    const bad = now.local.map(entry => ({ ...entry, root: encode_hosted_root(graph({ bad: { kind: "document", document: '<p' } })) }));
    assert.throws(() => admit_locus_local_initializers(bad));
    const detach = bind_locus_websocket(locus, pair.server);
    const echo = await hsonLiveMap.echo.create({ now, credential: session.credential!, transport: test_echo_transport(pair.client) });
    try {
      const map = echo_map_internal(echo), local = echo.parts.must("collection");
      if (String(local.mode) === "document" || local.source !== "client-local") throw Error("Expected local data Library");
      assert.equal(read(map, "collection", "二").key, "二");
      atomic(map, () => data(map).at(["二", "document"]).set('<p'));
      local.at(["二", "document"]).set('<p @:label/>');
      install_client_local_initializers_internal(map, now.local);
      assert.equal(local.snap(["二", "document"]), '<p @:label/>');
      assert.equal(owner(map).hostedRegistry().libraries.find(entry => entry.name === "collection")!.validation, validation);
      assert.equal(locus.rev, 0); assert.equal(owner(map).identityEpoch().issued().size, 0);
      assert.equal(session.now().libs.libraries.some(entry => entry.name === "collection"), false);
    } finally { echo.dispose(); detach(); locus.dispose(); }
  });
  await check("runtime hosted admission projects one data binding and durable reconstruction retains its contract", async () => {
    const adapter = new MemoryCheckpointAdapter(), options = [{ "base": { data: { value: 1 }, access: "shared" } }, { logicalMapId: "runtime-part-collection", persistence: adapter, authorizeProjection: ({ requested }: { requested: { libraries: readonly string[] } }) => ({ libraries: requested.libraries }) }] as const;
    const locus = await hsonLiveMap.locus.resume(options[0], options[1]), map = locus_map_internal(locus), pair = sockets();
    const session = await locus.session.create({ libraries: ["base"] }), detach = bind_locus_websocket(locus, pair.server);
    const echo = await hsonLiveMap.echo.create({ now: session.now(), credential: session.credential!, transport: test_echo_transport(pair.client) });
    try {
      const before = map.capture(), appended = adapter.appendCalls.length;
      await assert.rejects(locus.admit({ "bad": { parts: { late: { kind: "document", document: '<p' } }, access: "shared" } }));
      assert.deepEqual(map.capture(), before); assert.equal(adapter.appendCalls.length, appended);
      await locus.admit({ "collection": { parts: parts(), access: "shared" } });
      assert.equal(map.rev, before.revision + 1); assert.equal(adapter.appendCalls.length, appended + 1);
      const topology = adapter.appendCalls.at(-1)!.commit.topology;
      assert.equal(topology!.operation.libraries.length, 1); assert.equal(topology!.operation.libraries[0]!.validation, validation);
      await session.update({ libraries: ["base", "collection"] });
      assert.equal(read(echo_map_internal(echo), "collection", "二").key, "二");
      assert.equal(owner(echo_map_internal(echo)).libraries().length, 2);
      assert.equal(pair.wire.some(raw => raw.includes('hson-part-collection-v1')), true);
      const revision = map.rev;
      await assert.rejects(locus.admit({ "collection": { data: {}, access: "shared" } }));
      assert.equal(map.rev, revision);
    } finally { echo.dispose(); detach(); locus.dispose(); }
    const resumed = await hsonLiveMap.locus.resume(options[0], options[1]);
    try { assert.equal(read(locus_map_internal(resumed), "collection", "二").key, "二");
      assert.equal(owner(locus_map_internal(resumed)).identityEpoch().issued().size, 0); }
    finally { resumed.dispose(); }
  });
  await check("checkpoint export owns detached valid Parts across load and chunk-write callbacks", async () => {
    for (const boundary of ["load", "chunk"]) {
      const map = hsonLiveMap.fromLibraries({ first: definition(parts()), second: definition(parts()) });
      const checkpoint = owner(map).captureSemanticCheckpoint(), original = structuredClone(checkpoint);
      const adapter = new MemoryCheckpointAdapter();
      let changed = false;
      const corrupt = () => { if (!changed) { changed = true;
        overwrite_hson_node(checkpoint.libraries[1]!.root, graph({ bad: { kind: "document", document: '<p' } })); } };
      if (boundary === "load") {
        const load = adapter.load.bind(adapter); adapter.load = async id => { corrupt(); return load(id); };
      } else {
        const put = adapter.putCheckpointChunk.bind(adapter); adapter.putCheckpointChunk = async chunk => { corrupt(); await put(chunk); };
      }
      await write_semantic_checkpoint(checkpoint, adapter);
      assert.equal(changed, true);
      const restored = await load_persistent_locus_hosted_aggregate_internal(original.authority.logicalMapId, { persistence: adapter });
      assert.ok(restored);
      try { assert.deepEqual(restored!.map.capture().libraries.map(entry => entry.root),
        original.libraries.map(entry => encode_hosted_root(entry.root))); }
      finally { restored!.dispose(); }
      assert.deepEqual(map.capture().libraries.map(entry => entry.root), original.libraries.map(entry => encode_hosted_root(entry.root)));
    }
  });
  await check("durable malformed checkpoint content rejects even when its exact chunks and hashes are coherent", async () => {
    const map = fixture(), aggregate = owner(map), adapter = new MemoryCheckpointAdapter();
    const checkpoint = aggregate.captureSemanticCheckpoint(); await write_semantic_checkpoint(checkpoint, adapter);
    const state = adapter.state(checkpoint.authority.logicalMapId)!;
    if (state.checkpoint.format !== "hson-locus-durable-aggregate-checkpoint") throw Error("Expected durable manifest");
    const manifest = state.checkpoint;
    const chunks = [...encode_checkpoint_chunks(manifest.checkpointId, manifest.rev, "collection", "root", graph({ bad: { kind: "document", document: '<p' } }))];
    for (const item of chunks) adapter.chunks.set(item.chunk.id, item.chunk);
    adapter.seed(checkpoint.authority.logicalMapId, { checkpoint: { ...manifest, chunks: [
      ...manifest.chunks.filter(entry => entry.part === "schema"), ...chunks.map(item => item.descriptor),
    ] }, commits: [] });
    await assert.rejects(() => load_persistent_locus_hosted_aggregate_internal(checkpoint.authority.logicalMapId, { persistence: adapter }));
  });
  await check("own contract evidence cannot be hidden by Proxy property reads in restore or SSR export", () => {
    const ordinary = hsonLiveMap.fromLibraries({ collection: { data: parts() } }).capture();
    const entry = ordinary.registry.libraries[0]!;
    const disguised = new Proxy({ ...entry, validation }, { get(target, key, receiver) {
      return key === "validation" ? undefined : Reflect.get(target, key, receiver);
    } });
    const candidate = { ...ordinary, registry: { ...ordinary.registry, libraries: [disguised] } };
    assert.throws(() => install_libraries_snapshot(candidate));
    assert.throws(() => encode_ssr_bootstrap(candidate));
    assert.throws(() => install_libraries_snapshot({ ...ordinary, registry: { ...ordinary.registry,
      libraries: [{ ...entry, scope: undefined }] } }));
  });
  await check("local SSR rejects selected Part transfers before output while excluded and source-free page transfers work", () => {
    const map = fixture();
    assert.throws(() => encode_ssr_bootstrap(map.capture()), (error: unknown) => error instanceof Error && error.cause instanceof Error && /temporarily unsupported/.test(error.cause.message));
    assert.throws(() => encode_ssr_bootstrap(map.cut().libs), (error: unknown) => error instanceof Error && error.cause instanceof Error && /temporarily unsupported/.test(error.cause.message));
    const part = read(map, "collection", "二");
    map.addLibraries({ source: { document: part.root } });
    compose(map, "source", "page");
    const cut = map.cut({ data: [], documents: ["page"], html: "page" });
    assert.deepEqual(cut.libs.registry.libraries.map(entry => entry.name), ["page"]);
    assert.match(cut.html, /<a/);
    const bootstrap = decode_ssr_bootstrap(encode_ssr_bootstrap(cut.libs));
    assert.equal(bootstrap.kind, "libraries");
    if (bootstrap.kind !== "libraries") throw Error("Expected local Library transfer");
    const receiving = install_libraries_snapshot(bootstrap.bootstrap).map;
    assert.equal(receiving.doc.must("page").mode, "document");
    assert.throws(() => receiving.parts.must("collection")); assert.throws(() => receiving.doc.must("source"));
    assert.deepEqual(receiving.capture(), cut.libs);
  });
  await check("Part materialization is detached and collection values cannot become initial document shells", () => {
    const map = fixture(), materialized = read(map, "collection", "first/β"), initial = read(map, "collection", "first/β");
    data(map).at(["first/β", "document"]).set('<section/>'); assert.deepEqual(materialized, initial);
    assert.equal(owner(map).identityEpoch().issued().size, 0); atomic(map, () => compose(map, "collection", "page"));
    const ordinary = hsonLiveMap.fromLibraries({ source: { document: '<p/>' } }), source = ordinary.doc.must("source");
    if (source.mode !== "document") throw Error("Expected document"); source.css.stylesheet('p{color:red}');
    atomic(ordinary, () => compose(ordinary, "source", "page"), /managed stylesheet/);
    assert.equal(validate_part_collection(projected_value_from_hson_node(data(map).root())).length, 2);
  });
}
