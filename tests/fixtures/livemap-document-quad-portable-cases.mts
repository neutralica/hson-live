import { encode_ssr_bootstrap, decode_ssr_bootstrap } from "../../src/api/ssr/ssr-bootstrap.ts";
import { create_echo_aggregate_client_internal } from "../../src/api/echo/echo.aggregate-replica.ts";
import { create_locus_hosted_aggregate_authority_internal } from "../../src/api/locus/locus.aggregate.authority.ts";
import { bind_locus_websocket } from "../../src/api/locus/locus.websocket.ts";
import { test_echo_transport } from "../helpers/echo-websocket-transport.mts";
import type { LocusWebSocketLike } from "../../src/index.ts";
import assert from "node:assert/strict";
import { Hson, hsonLiveMap } from "../../src/index.ts";
import { install_libraries_snapshot } from "../../src/api/livemap/index.ts";
import { internal_livemap_aggregate_authority as owner } from "../../src/api/livemap/livemap.internal.ts";
import { make_livemap_from_authored_libraries_internal as authored, compose_livemap_document_internal as compose,
  add_livemap_canonical_libraries_internal as addCanonical, reconcile_client_projection_snapshot_internal,
  install_client_projected_topology_internal } from "../../src/api/livemap/livemap.libraries.ts";
import { lookup_document_quad_internal as lookup, decode_document_quads } from "../../src/api/livemap/livemap.document.quad.ts";
import { encode_hosted_root, decode_hosted_root, make_portable_aggregate_snapshot, make_portable_aggregate_commit,
  registry_from_entries } from "../../src/api/livemap/livemap.hosted.ts";
import { validate_document_path } from "../../src/api/livemap/livemap.document.path.ts";
import { enumerate_livemap_issued_quids } from "../../src/api/livemap/livemap.identity-epoch.ts";
import { set_livemap_quid_candidate_source_for_tests } from "../../src/api/livemap/livemap.quid-allocation.ts";
import { mint_hson_node_quid } from "../../src/core/hson-node-quid.ts";
import { capture_selected_authority_projection_snapshot, project_authority_snapshot, admit_authority_projection_snapshot,
  authority_projection_as_client_composition_internal, authority_projection_state_fingerprint_internal } from "../../src/api/locus/locus.authority-projection-snapshot.ts";
import { make_locus_hosted_projection_policy, normalize_locus_effective_projection } from "../../src/api/locus/locus.projection.ts";
import { create_persistent_locus_hosted_aggregate_internal as host, load_persistent_locus_hosted_aggregate_internal as load,
  write_semantic_checkpoint, durable_aggregate_commit } from "../../src/api/locus/locus.aggregate.persistence.ts";
import { encode_checkpoint_chunks } from "../../src/api/locus/locus.checkpoint-chunks.ts";
import { decode_echo_hosted_aggregate_synchronization_frame_internal as decodeFrame } from "../../src/api/echo/echo.aggregate-semantic-codec.internal.ts";
import { LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT } from "../../src/api/locus/locus.aggregate.protocol.ts";
import { locus_local_initializer_digest } from "../../src/api/locus/locus.local-initializer.ts";
import { client_projection_map } from "../helpers/client-projection.mts";
import { MemoryCheckpointAdapter } from "../helpers/memory-checkpoint-adapter.mts";
import { acquire_document_identity } from "../helpers/livemap-identity-internal.mts";
import type { LiveMap, LiveMapDocumentLibrary, LiveMapSnapshot } from "../../src/types/livemap.types.ts";
import type { HsonNode } from "../../src/core/types.ts";

const target = (...path: number[]) => ({ kind: "path" as const, path: validate_document_path(path) });
const fixture = () => authored({ page: { document: '<main @:root <button @:confirm "Go"/> <aside/>/>' } });
function doc(map: LiveMap, name = "page"): LiveMapDocumentLibrary {
  const result = map.lib(name); if (result.mode !== "document") throw Error("Expected document"); return result;
}
function subject(map: LiveMap, name = "confirm", library = "page") {
  const result = lookup(doc(map, library), name); if (!result) throw Error(`Missing ${name}`); return result;
}
function atomic(map: LiveMap, run: () => unknown, throws = true) {
  const aggregate = owner(map), before = map.capture(), ids = aggregate.libraries();
  const overlays = ids.map(id => aggregate.documentOverlay(id));
  const roots = ids.map(id => aggregate.root(id)), registry = aggregate.hostedRegistry();
  const issued = aggregate.identityEpoch().issued();
  const addresses = ids.map(id => [aggregate.documentQuad(id, "confirm", undefined), aggregate.documentQuad(id, "root", undefined)]);
  const ledger = enumerate_livemap_issued_quids(aggregate.identityEpoch().issued());
  let events = 0, positions = 0; const stop = map.commits.observe(() => events++);
  const stopPosition = aggregate.observeAuthorityPosition(() => positions++);
  try { if (throws) assert.throws(run); else run(); } finally { stop(); stopPosition(); }
  assert.deepEqual(map.capture(), before);
  assert.deepEqual(aggregate.libraries(), ids);
  ids.forEach((id, index) => assert.equal(aggregate.documentOverlay(id), overlays[index]));
  assert.deepEqual(enumerate_livemap_issued_quids(aggregate.identityEpoch().issued()), ledger);
  assert.equal(events, 0); assert.equal(positions, 0);
  assert.equal(aggregate.hostedRegistry(), registry); assert.equal(aggregate.identityEpoch().issued(), issued);
  ids.forEach((id, index) => {
    assert.equal(aggregate.root(id), roots[index]);
    assert.deepEqual([aggregate.documentQuad(id, "confirm", undefined), aggregate.documentQuad(id, "root", undefined)], addresses[index]);
  });
}
function bindingSnapshot(snapshot: LiveMapSnapshot, quads: unknown): LiveMapSnapshot {
  return { ...snapshot, libraries: snapshot.libraries.map((entry, index) => index === 0 ? { ...entry, quads } : entry) } as LiveMapSnapshot;
}
async function projection(map: LiveMap, names: readonly string[], privateNames: readonly string[] = []) {
  const aggregate = owner(map), position = aggregate.hostedPosition();
  const catalog = aggregate.hostedRegistry().libraries.filter(entry => entry.scope === undefined)
    .map(entry => ({ name: entry.name, ownership: privateNames.includes(entry.name) ? "private" as const : "shared" as const }));
  const policy = make_locus_hosted_projection_policy(aggregate.hostedRegistry(), position.authority, catalog, undefined,
    () => ({ libraries: names, writableDocuments: names.filter(name => !privateNames.includes(name)) }));
  return normalize_locus_effective_projection(policy, { libraries: names });
}

export async function portable_quad_cases(check: (name: string, run: () => void | Promise<void>) => Promise<void>) {
  await check("raw SSR bootstrap retains portable addresses and rejects malformed or runtime authority", () => {
    const map = fixture(), snapshot = map.cut().libs;
    const encoded = encode_ssr_bootstrap(snapshot), decoded = decode_ssr_bootstrap(encoded);
    assert.equal(decoded.kind, "libraries");
    const restored = install_libraries_snapshot(decoded.bootstrap).map;
    for (const name of ["confirm", "root"]) {
      assert.deepEqual(subject(restored, name).path, subject(map, name).path);
      assert.notEqual(subject(restored, name).quid, subject(map, name).quid);
      assert.ok(owner(restored).identityEpoch().issued().has(subject(restored, name).quid));
      assert.equal(owner(restored).identityEpoch().issued().has(subject(map, name).quid), false);
    }
    const plain = hsonLiveMap.fromLibraries({ page: { document: '<main/>' } }).cut().libs;
    const payload = JSON.parse(Buffer.from(encode_ssr_bootstrap(plain), "base64url").toString());
    assert.equal(Object.hasOwn(payload.payload.libraries[0], "quads"), false);
    assert.equal(encode_ssr_bootstrap(decode_ssr_bootstrap(encode_ssr_bootstrap(plain)).bootstrap), encode_ssr_bootstrap(plain));
    for (const quads of [null, [], [{ name: "bad name", path: [0, 0] }], [{ name: "x", path: [99] }], [{ name: "x", path: [0, 0], quid: subject(map).quid }]]) {
      assert.throws(() => encode_ssr_bootstrap(bindingSnapshot(snapshot, quads)));
      const raw = JSON.parse(Buffer.from(encoded, "base64url").toString()); raw.payload.libraries[0].quads = quads;
      assert.throws(() => decode_ssr_bootstrap(Buffer.from(JSON.stringify(raw)).toString("base64url")));
    }
    const root = structuredClone(decode_hosted_root(snapshot.libraries[0]!.root));
    const stack = [root];
    while (stack.length) {
      const node = stack.pop()!;
      if (node.$_tag === "main") node.$_meta = { quid: subject(map).quid };
      for (const child of node.$_content) if (typeof child === "object" && child !== null && "$_tag" in child) stack.push(child);
    }
    const foreign = { ...snapshot, libraries: snapshot.libraries.map(entry => ({ ...entry, root: encode_hosted_root(root) })) };
    assert.throws(() => encode_ssr_bootstrap(foreign));
    const wireForeign = JSON.parse(Buffer.from(encoded, "base64url").toString());
    wireForeign.payload.libraries[0].rootPayload = foreign.libraries[0]!.root.payload;
    assert.throws(() => decode_ssr_bootstrap(Buffer.from(JSON.stringify(wireForeign)).toString("base64url")));
  });
  await check("absent QUAD fields ignore inherited data and getters across construction restoration addition and replay", async () => {
    const plain = hsonLiveMap.fromLibraries({ page: { document: '<main/>' } });
    const snapshot = structuredClone(plain.capture()), source = hsonLiveMap.create(), initial = source.capture();
    const commit = source.addLibraries({ added: { document: '<aside/>' } });
    const projected = capture_selected_authority_projection_snapshot(plain, await projection(plain, ["page"]));
    const original = Object.getOwnPropertyDescriptor(Object.prototype, "quads");
    let reads = 0;
    try {
      for (const descriptor of [{ value: [{ name: "inherited", path: [0, 0] }], writable: true },
        { get: () => { reads++; return [{ name: "inherited", path: [0, 0] }]; } }]) {
        Object.defineProperty(Object.prototype, "quads", { ...descriptor, configurable: true });
        const created = hsonLiveMap.fromLibraries({ page: { document: '<main/>' } });
        const restored = install_libraries_snapshot(snapshot).map;
        const projectedClient = client_projection_map({ authority: admit_authority_projection_snapshot(projected), local: {} });
        const ssr = install_libraries_snapshot(decode_ssr_bootstrap(encode_ssr_bootstrap(snapshot)).bootstrap).map;
        const authoredPlain = authored({ page: { document: '<main/>' } });
        const canonical = hsonLiveMap.create();
        addCanonical(canonical, [{ name: "added", family: "document", root: decode_hosted_root(snapshot.libraries[0]!.root),
          schema: owner(plain).librarySchema(owner(plain).libraries()[0]!) }]);
        const added = hsonLiveMap.create(); added.addLibraries({ added: { document: '<aside/>' } });
        const replayed = install_libraries_snapshot(initial).map; replayed.replay(commit);
        for (const [map, name] of [[created, "page"], [restored, "page"], [projectedClient, "page"], [ssr, "page"], [authoredPlain, "page"], [canonical, "added"], [added, "added"], [replayed, "added"]] as const) {
          assert.equal(lookup(doc(map, name), "inherited"), undefined);
          assert.equal(Object.hasOwn(map.capture().libraries[0]!, "quads"), false);
        }
      }
      assert.equal(reads, 0);
    } finally {
      if (original) Object.defineProperty(Object.prototype, "quads", original); else Reflect.deleteProperty(Object.prototype, "quads");
    }
  });
  await check("own QUAD accessors fail without execution at public canonical snapshot and replay ingress", () => {
    let reads = 0;
    const accessor = <T extends object>(input: T): T => Object.defineProperty(input, "quads", {
      enumerable: true, get() { reads++; return [{ name: "injected", path: [0, 0] }]; } });
    assert.throws(() => hsonLiveMap.fromLibraries({ page: accessor({ document: '<main/>' }) }));
    assert.throws(() => authored({ page: accessor({ document: '<main/>' }) }));
    const plain = hsonLiveMap.fromLibraries({ page: { document: '<main/>' } }), snapshot = structuredClone(plain.capture());
    accessor(snapshot.libraries[0]!); assert.throws(() => install_libraries_snapshot(snapshot));
    const definition = accessor({ name: "added", family: "document" as const, root: decode_hosted_root(plain.capture().libraries[0]!.root),
      schema: owner(plain).librarySchema(owner(plain).libraries()[0]!) });
    atomic(plain, () => addCanonical(plain, [definition]));
    const source = hsonLiveMap.create(), initial = source.capture(), commit = structuredClone(source.addLibraries({ added: { document: '<main/>' } }));
    const operation = commit.operations[0]!.operation;
    if (!("kind" in operation) || operation.kind !== "library-add") throw Error("Expected addition");
    accessor(operation.libraries[0]!); assert.throws(() => install_libraries_snapshot(initial).map.replay(commit));
    assert.equal(reads, 0);
  });
  await check("dynamic preparation exhaustion later invalid entries discard and stale acceptance leave authority unchanged", () => {
    const source = fixture(), captured = source.capture().libraries[0]!, map = fixture(), aggregate = owner(map), manager = {};
    const definition = { name: "added", family: "document" as const, root: decode_hosted_root(captured.root),
      hsonSchema: owner(source).librarySchema(owner(source).libraries()[0]!), quads: captured.quads };
    aggregate.claimManagement(manager);
    try {
      const allocationOwner = aggregate.identityEpoch().owner, fresh = mint_hson_node_quid(); let calls = 0;
      set_livemap_quid_candidate_source_for_tests(allocationOwner, () => { calls++; return fresh; });
      try { atomic(map, () => aggregate.prepareAddLibrariesManaged(manager, [definition])); assert.ok(calls > 1); }
      finally { set_livemap_quid_candidate_source_for_tests(allocationOwner, undefined); }
      atomic(map, () => aggregate.prepareAddLibrariesManaged(manager, [definition, { ...definition, name: "invalid", quads: [{ name: "invalid", path: validate_document_path([99]) }] }]));
      atomic(map, () => {
        const prepared = aggregate.prepareAddLibrariesManaged(manager, [definition]);
        aggregate.discard(prepared.transition);
      }, false);
      const stale = aggregate.prepareAddLibrariesManaged(manager, [definition]);
      acquire_document_identity(doc(map).document, target(0, 0, 1));
      atomic(map, () => aggregate.accept(stale.transition));
    } finally { aggregate.releaseManagement(manager); }
  });
  await check("actual Echo contraction retains addressed state retires excluded Libraries and continues commits", async () => {
    for (const addressed of [true, false]) {
      const map = addressed ? authored({ page: { document: '<main @:root <button @:confirm/>/>' },
        extra: { data: { value: 1 } }, hidden: { document: '<aside @:private/>' } })
        : hsonLiveMap.fromLibraries({ page: { document: '<main <button/>/>' }, extra: { data: { value: 1 } }, hidden: { document: '<aside/>' } });
      const server = create_locus_hosted_aggregate_authority_internal({ map,
        libraries: [{ name: "page", ownership: "shared" }, { name: "extra", ownership: "shared" }, { name: "hidden", ownership: "private" }],
        defaultProjection: { libraries: ["page", "extra"] }, authorizeProjection: ({ requested }) => ({ libraries: requested.libraries }) });
      const toServer = new Set<(raw: string) => void>(), toClient = new Set<(raw: string) => void>();
      const clientSocket: LocusWebSocketLike = { send(raw) { for (const listener of toServer) listener(raw); }, close() {},
        onMessage(listener) { toClient.add(listener); return () => { toClient.delete(listener); }; }, onClose() { return () => {}; } };
      const serverSocket: LocusWebSocketLike = { send(raw) { for (const listener of toClient) listener(raw); }, close() {},
        onMessage(listener) { toServer.add(listener); return () => { toServer.delete(listener); }; }, onClose() { return () => {}; } };
      const detach = bind_locus_websocket(server, serverSocket), echo = create_echo_aggregate_client_internal({
        transport: test_echo_transport(clientSocket), logicalMapId: server.logicalMapId });
      try {
        await echo.connect(); const client = echo.map!; assert.ok(client); assert.equal(echo.diagnostics().status, "live");
        assert.throws(() => client.lib("hidden"));
        if (addressed) assert.notEqual(subject(client).quid, subject(map).quid);
        await server.sessions.updateProjection(echo.session.sessionId!, { libraries: ["page"] });
        assert.equal(echo.diagnostics().status, "live"); assert.throws(() => client.lib("extra"));
        if (addressed) assert.deepEqual(subject(client).path, [0, 0, 0]);
        await server.stage(draft => { const page = draft.lib("page"); if (page.mode !== "document") throw Error("Document"); page.attrs.set(target(0), "title", "after"); });
        assert.equal(echo.diagnostics().status, "live"); assert.equal(echo.lastAppliedRev, server.rev);
        assert.equal(doc(client).document.attrs.get(target(0), "title"), "after");
        if (addressed) assert.ok(subject(client));
        await server.sessions.updateProjection(echo.session.sessionId!, { libraries: ["hidden"] });
        assert.equal(echo.diagnostics().status, "live");
        assert.throws(() => client.lib("hidden"));
      } finally { echo.dispose(); detach(); server.dispose(); }
    }
  });
  await check("authored portable graph associations restore multiple names with fresh sparse receiving identity", () => {
    const map = authored({ page: { document: '<main @:z <button @:A/> <aside @:__proto__/> <span/>/>' },
      other: { document: '<aside @:A/>' } });
    const captured = map.capture(), received = install_libraries_snapshot(structuredClone(captured)).map;
    assert.deepEqual(captured.libraries.find(entry => entry.name === "page")?.quads?.map(entry => entry.name), ["A", "__proto__", "z"]);
    assert.deepEqual(received.capture(), captured);
    for (const library of ["page", "other"]) {
      const entry = captured.libraries.find(entry => entry.name === library)!;
      for (const binding of entry.quads!) {
        const before = subject(map, binding.name, library), after = subject(received, binding.name, library);
        assert.equal(after.name, before.name); assert.deepEqual(after.path, before.path); assert.notEqual(after.quid, before.quid);
        assert.ok(owner(received).identityEpoch().issued().has(after.quid));
        assert.equal(owner(received).identityEpoch().issued().has(before.quid), false);
      }
    }
    assert.notEqual(subject(received, "A").quid, subject(received, "A", "other").quid);
    assert.equal(owner(received).documentOverlay(owner(received).libraries()[0]!).size, 3);
    assert.equal(JSON.stringify(captured).includes('"quid"'), false);
    for (const entry of captured.libraries) assert.equal(JSON.stringify(decode_hosted_root(entry.root)).includes("quad"), false);
  });
  await check("movement and lineage before and after portable restoration preserve occurrence correspondence", () => {
    const map = fixture(); doc(map).at([]).asElement()!.move(0, 1);
    assert.deepEqual(subject(map).path, [0, 0, 1]);
    const receiving = install_libraries_snapshot(map.capture()).map, quid = subject(receiving).quid;
    assert.deepEqual(subject(receiving).path, [0, 0, 1]);
    doc(receiving).document.content.replace(target(0, 0), 1, { $_tag: "button", $_content: [] },
      [{ source: validate_document_path([]), destination: validate_document_path([]) }]);
    assert.equal(subject(receiving).quid, quid);
    const next = install_libraries_snapshot(receiving.capture()).map;
    assert.deepEqual(subject(next).path, [0, 0, 1]);
    doc(next).at([]).asElement()!.move(1, 0);
    assert.deepEqual(subject(next).path, [0, 0, 0]);
    doc(next).document.content.replace(target(0, 0), 0, { $_tag: "button", $_content: [] });
    assert.equal(lookup(doc(next), "confirm"), undefined);
    assert.equal(lookup(doc(install_libraries_snapshot(next.capture()).map), "confirm"), undefined);
  });
  await check("retirement omits associations and portable reinsertion never resurrects an address", () => {
    const map = authored({ page: { document: '<main <button @:only/>/> ' } });
    doc(map).document.content.remove(target(0), 0);
    assert.equal(Object.hasOwn(map.capture().libraries[0]!, "quads"), false);
    const received = install_libraries_snapshot(map.capture()).map;
    doc(received).at([]).asElement()!.insert(0, { $_tag: "button", $_content: [] });
    acquire_document_identity(doc(received).document, target(0, 0, 0));
    assert.equal(lookup(doc(received), "only"), undefined);
    assert.equal(Object.hasOwn(received.capture().libraries[0]!, "quads"), false);
  });
  await check("QUAD-free exact graph snapshot cut and checkpoint shapes stay unchanged", () => {
    const map = hsonLiveMap.fromLibraries({ page: { document: '<main/>' }, state: { data: { n: 1 } } });
    const snapshot = map.capture();
    assert.deepEqual(Object.keys(snapshot), ["format", "revision", "registry", "registryDigest", "libraries"]);
    assert.deepEqual(Object.keys(snapshot.libraries[0]!), ["name", "mode", "schema", "schemaDigest", "root", "css"]);
    assert.deepEqual(Object.keys(snapshot.libraries[1]!), ["name", "mode", "schema", "schemaDigest", "root"]);
    assert.deepEqual(install_libraries_snapshot(snapshot).map.capture(), snapshot);
    assert.deepEqual(map.cut().libs, snapshot);
    assert.equal(JSON.stringify(owner(map).captureSemanticCheckpoint()).includes("quads"), false);
  });
  await check("exact binding decoding rejects malformed names shapes paths duplicates and ineligible subjects atomically", () => {
    const map = fixture(), snapshot = map.capture(), path = [0, 0, 0];
    const malformed: unknown[] = [null, {}, [], undefined, "confirm", [null], [{ name: "", path }],
      ...["2bad", "é", "a-b", "a.b", "a\n", "A".repeat(129)].map(name => [{ name, path }]),
      [{ name: "ok" }], [{ name: "ok", path, quid: "000009001" }], [{ name: "ok", path, epoch: 0 }],
      [{ name: "ok", path, extra: true }], [{ name: "ok", path: "0" }], [{ name: "ok", path: [-1] }],
      [{ name: "ok", path: [-0] }], [{ name: "ok", path: [0.5] }], [{ name: "ok", path: ["0"] }],
      [{ name: "ok", path: [99] }], [{ name: "ok", path: [] }], [{ name: "ok", path: [0, 0] }],
      [{ name: "ok", path: [0, 0, 0, 0, 0] }], [{ name: "a", path }, { name: "a", path: [0] }],
      [{ name: "a", path }, { name: "b", path }], [{ name: "z", path }, { name: "a", path: [0] }],
      [{ name: "a", path: Object.assign([...path], { extra: 1 }) }],
      [{ name: "a", path: Array(1) }], Object.assign([{ name: "a", path }], { extra: 1 }),
      [Object.assign({ name: "a", path }, { [Symbol("extra")]: 1 })],
      [Object.defineProperty({ name: "a", path }, "name", { get() { throw Error("must not execute"); }, enumerable: true })],
      [Object.defineProperty({ name: "a", path }, "hidden", { value: 1 })]];
    for (const quads of malformed) {
      const invalid = bindingSnapshot(snapshot, quads);
      atomic(map, () => map.restore(invalid));
      assert.throws(() => install_libraries_snapshot(invalid));
    }
    const state = hsonLiveMap.fromLibraries({ state: { data: { x: 1 } } });
    atomic(map, () => owner(map).restorePortableLibraries(bindingSnapshot(state.capture(), [{ name: "x", path: [0] }])));
  });
  await check("portable coordinates use own array storage despite hostile inherited iteration", () => {
    const map = fixture(), snapshot = map.capture();
    const coordinates = [99];
    Object.setPrototypeOf(coordinates, { entries() { return [[0, 0]][Symbol.iterator](); } });
    const associations = [{ name: "bad", path: coordinates }];
    Object.setPrototypeOf(associations, { map() { return [{ name: "good", path: [0] }]; } });
    atomic(map, () => map.restore(bindingSnapshot(snapshot, associations)));
    assert.throws(() => install_libraries_snapshot(bindingSnapshot(snapshot, associations)));
  });
  await check("complete graph special-tag Schema and foreign QUID obligations still precede identity installation", () => {
    const map = fixture(), snapshot = map.capture(), entry = snapshot.libraries[0]!;
    const root = decode_hosted_root(entry.root), main = root.$_content[0];
    if (typeof main !== "object" || main === null) throw Error("main");
    main.$_meta = { quid: subject(map, "root").quid };
    const invalid = { ...snapshot, libraries: [{ ...entry, root: encode_hosted_root(root) }] };
    atomic(map, () => map.restore(invalid)); assert.throws(() => install_libraries_snapshot(invalid));
    const wrongRoot: HsonNode = { $_tag: "_hson_root", $_content: [{ $_tag: "main", $_content: [{ $_tag: "_hson_arr", $_content: [] }] }] };
    atomic(map, () => map.restore({ ...snapshot, libraries: [{ ...entry, root: encode_hosted_root(wrongRoot) }] }));
    const restricted = authored({ page: { document: '<main @:only/>', schema: Hson.schema`<type "document" tag "main" content "empty">` } });
    const checkpoint = owner(restricted).captureSemanticCheckpoint();
    assert.throws(() => owner(restricted).installSemanticCheckpoint({ ...checkpoint,
      libraries: [{ ...checkpoint.libraries[0]!, root: { $_tag: "_hson_root", $_content: [{ $_tag: "aside", $_content: [] }] }, quads: [{ name: "only", path: validate_document_path([0]) }] }] }));
  });
  await check("allocation exhaustion leaves the complete restored registry overlay epoch and ledger untouched", () => {
    const map = fixture(), aggregate = owner(map), snapshot = map.capture(), epoch = aggregate.identityEpoch().current();
    const candidate = mint_hson_node_quid();
    set_livemap_quid_candidate_source_for_tests(aggregate.identityEpoch().owner, () => candidate);
    try { atomic(map, () => map.restore(snapshot)); } finally { set_livemap_quid_candidate_source_for_tests(aggregate.identityEpoch().owner, undefined); }
    assert.equal(aggregate.identityEpoch().current(), epoch);
    const old = subject(map).quid;
    set_livemap_quid_candidate_source_for_tests(aggregate.identityEpoch().owner, () => old);
    try { atomic(map, () => map.restore(snapshot)); } finally { set_livemap_quid_candidate_source_for_tests(aggregate.identityEpoch().owner, undefined); }
  });
  await check("identity-only reentrancy invalidates staged restoration without publishing reconstructed bindings", () => {
    const map = fixture(), aggregate = owner(map), snapshot = map.capture(), before = subject(map), generationLedger = aggregate.identityEpoch().issued().size;
    let first = true;
    set_livemap_quid_candidate_source_for_tests(aggregate.identityEpoch().owner, () => {
      if (first) { first = false; acquire_document_identity(doc(map).document, target(0, 0, 1)); }
      return mint_hson_node_quid();
    });
    try { assert.throws(() => map.restore(snapshot), /changed during capture/); }
    finally { set_livemap_quid_candidate_source_for_tests(aggregate.identityEpoch().owner, undefined); }
    assert.deepEqual(subject(map), before); assert.deepEqual(map.capture(), snapshot); assert.equal(map.rev, 0);
    assert.equal(aggregate.identityEpoch().issued().size, generationLedger + 1);
  });
  await check("captures cannot observe a partial non-revisioned identity transaction", () => {
    const map = fixture(), aggregate = owner(map), id = aggregate.libraries()[0]!, before = subject(map), snapshot = map.capture();
    const captures = [() => map.capture(), () => aggregate.captureHosted(), () => aggregate.captureSemanticCheckpoint(),
      () => aggregate.captureSelectedHosted(["page"], false), () => map.cut()];
    aggregate.acquireLocalDocumentIdentity(id, validate_document_path([0, 0, 1]), mint_hson_node_quid(), {
      preflight() { for (const capture of captures) assert.throws(capture, /incomplete identity transaction/);
        return { apply() {}, rollback() {}, release() {} }; },
      realize() { for (const capture of captures) assert.throws(capture, /incomplete identity transaction/); },
      rollbackRealization() {},
    });
    assert.deepEqual(subject(map), before); assert.deepEqual(map.capture(), snapshot); assert.equal(map.rev, 0);
  });
  await check("late hosted capture serialization cannot publish stale identity correspondence", () => {
    const map = fixture(), aggregate = owner(map), snapshot = map.capture(), before = subject(map);
    const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "toJSON");
    let observations = 0, exposed: unknown;
    Object.defineProperty(Object.prototype, "toJSON", { configurable: true, value(this: unknown) {
      if (typeof this === "object" && this !== null && Object.hasOwn(this, "format")
        && Reflect.get(this, "format") === "hson-livemap-libraries-snapshot") {
        observations++;
        if (observations === 3) acquire_document_identity(doc(map).document, target(0, 0, 1));
      }
      return this;
    } });
    try { assert.throws(() => { exposed = aggregate.captureHosted(); }, /changed during capture/); }
    finally {
      if (descriptor === undefined) Reflect.deleteProperty(Object.prototype, "toJSON");
      else Object.defineProperty(Object.prototype, "toJSON", descriptor);
    }
    assert.equal(exposed, undefined); assert.equal(observations, 3);
    assert.deepEqual(subject(map), before); assert.deepEqual(map.capture(), snapshot); assert.equal(map.rev, 0);
  });
  await check("portable topology restoration reconstructs addressed candidates before installation and drops omitted addresses", () => {
    const source = fixture(), targetMap = hsonLiveMap.create(), aggregate = owner(targetMap);
    aggregate.restorePortableLibraries(source.capture());
    const id = aggregate.libraries()[0]!, restored = aggregate.documentQuad(id, "confirm", undefined)!;
    assert.deepEqual(restored.path, subject(source).path); assert.notEqual(restored.quid, subject(source).quid);
    assert.ok(aggregate.identityEpoch().issued().has(restored.quid));
    const plain = hsonLiveMap.fromLibraries({ page: { document: '<main <button "Go"/> <aside/>/>' } });
    aggregate.restorePortableLibraries(plain.capture());
    assert.equal(aggregate.documentQuad(id, "confirm", undefined), undefined);
    assert.equal(aggregate.documentOverlay(id).size, 0);
  });
  await check("same-runtime exact hosted capture retains authority while copies and foreign owners fail", () => {
    const map = fixture(), aggregate = owner(map), exact = aggregate.captureHosted(), old = subject(map);
    doc(map).document.attrs.set(target(...old.path), "title", "Changed");
    aggregate.restoreHosted(exact);
    assert.deepEqual(subject(map), old);
    atomic(map, () => aggregate.restoreHosted(structuredClone(exact)));
    const foreign = fixture(); atomic(foreign, () => owner(foreign).restoreHosted(exact));
    assert.deepEqual(make_portable_aggregate_snapshot(exact).libraries[0]?.quads, map.capture().libraries[0]?.quads);
  });
  await check("Library-add carries associations local replay and managed projected forwarding reconstruct independently", async () => {
    const source = fixture(), capture = source.capture().libraries[0]!, aggregateSource = owner(source);
    const definition = { name: "added", family: "document" as const, root: decode_hosted_root(capture.root),
      schema: aggregateSource.librarySchema(aggregateSource.libraries()[0]!), quads: capture.quads };
    const map = hsonLiveMap.create(), initial = map.capture(), commit = addCanonical(map, [definition]);
    assert.deepEqual(commit.operations[0] && "kind" in commit.operations[0].operation ? commit.operations[0].operation : undefined,
      { kind: "library-add", libraries: [{ name: "added", mode: "document", schema: capture.schema, root: capture.root, quads: capture.quads }] });
    const replica = install_libraries_snapshot(initial).map; replica.replay(structuredClone(commit));
    assert.deepEqual(replica.capture(), map.capture());
    assert.notEqual(subject(replica, "confirm", "added").quid, subject(map, "confirm", "added").quid);
    const invalid = structuredClone(commit); const operation = invalid.operations[0]!;
    if (!("kind" in operation.operation) || operation.operation.kind !== "library-add") throw Error("topology");
    const bad = { ...invalid, operations: [{ ...operation, operation: { ...operation.operation,
      libraries: operation.operation.libraries.map(entry => ({ ...entry, quads: [{ name: "bad", path: [99] }] })) } }] };
    assert.throws(() => install_libraries_snapshot(initial).map.replay(bad as never));
    const seed = hsonLiveMap.fromLibraries({ seed: { document: '<main/>' } }), effective = await projection(seed, ["seed"]);
    const projected = capture_selected_authority_projection_snapshot(seed, effective), client = client_projection_map({ authority: projected, local: {} });
    const management = {}, clientOwner = owner(client); clientOwner.claimManagement(management);
    const seedOwner = owner(seed), serverManager = {}; seedOwner.claimManagement(serverManager);
    try {
      const prepared = seedOwner.prepareAddLibrariesManaged(serverManager, [{ name: "added", root: definition.root,
        family: "document", hsonSchema: definition.schema, quads: definition.quads }]);
      seedOwner.accept(prepared.transition);
      const next = await projection(seed, ["seed", "added"]), snapshot = capture_selected_authority_projection_snapshot(seed, next);
      const portable = authority_projection_as_client_composition_internal(snapshot), topology = prepared.transition.commit.topology!;
      install_client_projected_topology_internal(client, management, topology, portable.registryDigest);
      assert.deepEqual(subject(client, "confirm", "added").path, [0, 0, 0]);
      assert.notEqual(subject(client, "confirm", "added").quid, seedOwner.documentQuad(prepared.identities[0]!, "confirm", undefined)?.quid);
      const frame = { format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT, type: "projection-change", id: "forward",
        logicalMapId: snapshot.authority.logicalMapId, incarnationId: snapshot.authority.incarnationId,
        authorityRev: 1, sequence: 1, previousDigest: projected.projectionDigest, projectionDigest: snapshot.projectionDigest,
        registryDigest: portable.registryDigest, libraries: next.libraries, systemFeatures: [], writableDocuments: next.writableDocuments,
        local: [], initializerDigest: locus_local_initializer_digest([]), topology };
      const decoded = decodeFrame(JSON.stringify(frame));
      assert.ok(decoded && "topology" in decoded); assert.deepEqual(decoded && "topology" in decoded ? decoded.topology : undefined, topology);
      assert.ok(make_portable_aggregate_commit(prepared.transition.commit.hosted!)?.topology?.operation.libraries[0]?.quads);
    } finally { clientOwner.releaseManagement(management); seedOwner.releaseManagement(serverManager); }
  });
  await check("selected cuts and authorized projections preserve private source separation and Echo registry restoration", async () => {
    const map = authored({ hidden: { document: '<aside @:PRIVATE_ADDRESS/>' }, layout: { document: '<main <hson-template lib="hidden" quad="PRIVATE_ADDRESS"/>/>' },
      public: { document: '<button @:shared/>' } });
    compose(map, "layout", "composed");
    const effective = await projection(map, ["hidden", "composed", "public"], ["hidden", "layout"]);
    const projected = capture_selected_authority_projection_snapshot(map, effective);
    assert.deepEqual(projected, project_authority_snapshot(owner(map).captureHosted(), effective));
    assert.equal(JSON.stringify(projected).includes("PRIVATE_ADDRESS"), false);
    assert.equal(projected.libraries.find(entry => entry.name === "composed")?.quads, undefined);
    assert.deepEqual(projected.libraries.find(entry => entry.name === "public")?.quads?.map(entry => entry.name), ["shared"]);
    const client = client_projection_map({ authority: projected, local: { ui: { document: '<main/>' } } });
    assert.ok(lookup(doc(client, "public"), "shared")); assert.throws(() => client.lib("hidden"));
    assert.equal(JSON.stringify(client.capture()).includes("PRIVATE_ADDRESS"), false);
    const raw = map.cut({ documents: ["hidden"], data: [], html: "hidden" });
    assert.ok(JSON.stringify(raw.libs).includes("PRIVATE_ADDRESS")); assert.equal(raw.html, "<aside></aside>");
    assert.ok(lookup(doc(install_libraries_snapshot(raw.libs).map, "hidden"), "PRIVATE_ADDRESS"));
    const before = lookup(doc(client, "public"), "shared")!, manager = {}; owner(client).claimManagement(manager);
    try {
      reconcile_client_projection_snapshot_internal(client, manager, authority_projection_as_client_composition_internal(projected));
      const after = lookup(doc(client, "public"), "shared")!;
      assert.notEqual(after.quid, before.quid); assert.deepEqual(after.path, before.path);
      assert.equal(owner(client).identityEpoch().issued().has(after.quid), true);
      const bad = { ...projected, libraries: projected.libraries.map(entry => entry.name === "public"
        ? { ...entry, quads: [{ name: "shared", path: [99] }] } : entry) };
      assert.throws(() => admit_authority_projection_snapshot(bad));
      assert.throws(() => reconcile_client_projection_snapshot_internal(client, manager,
        { ...authority_projection_as_client_composition_internal(projected), libraries: bad.libraries as never }));
      assert.equal(lookup(doc(client, "public"), "shared")?.quid, after.quid);
    } finally { owner(client).releaseManagement(manager); }
    const changedAddress = { ...projected, libraries: projected.libraries.map(entry => entry.name === "public"
      ? { ...entry, quads: [{ name: "renamed", path: validate_document_path([0]) }] } : entry) };
    assert.notEqual(authority_projection_state_fingerprint_internal(projected), authority_projection_state_fingerprint_internal(changedAddress));
  });
  await check("restored source supports independent recursive composition without inherited addresses", () => {
    const original = authored({ layout: { document: '<main @:layout <hson-template lib="header"/> <hson-template lib="header"/>/>' },
      header: { document: '<header @:header <hson-template lib="button"/>/>' }, button: { document: '<button @:button "Go"/>' } });
    const received = install_libraries_snapshot(original.capture()).map;
    const result = compose(received, "layout", "result");
    assert.equal(lookup(result, "button"), undefined); assert.equal(lookup(result, "layout"), undefined);
    assert.equal(JSON.stringify(result.root()).includes("hson-template"), false);
    assert.equal(JSON.stringify(result.root()).includes("quid"), false);
    assert.ok(lookup(doc(original, "header"), "header")); assert.ok(lookup(doc(received, "header"), "header"));
    const final = install_libraries_snapshot(received.cut({ documents: ["result"], data: [] }).libs).map;
    assert.deepEqual(doc(final, "result").root(), result.root());
  });
  await check("hosted checkpoint and tail recovery preserve addresses and fresh identity through moves lineage and retirement", async () => {
    const adapter = new MemoryCheckpointAdapter(), map = fixture(), old = subject(map).quid;
    const locus = await host({ map, persistence: adapter, logicalMapId: "quad-host", incarnationId: "quad-run" });
    try {
      assert.ok(adapter.state("quad-host")?.checkpoint.chunks.some(chunk => chunk.part === "quads"));
      assert.equal(JSON.stringify([...adapter.chunks.values()]).includes(old), false);
      await locus.stage(draft => { const page = draft.lib("page"); if (page.mode !== "document") throw Error("doc");
        page.graph({ domain: "graph", op: "move-content", target: target(0, 0), from: 0, to: 1 }); });
      const recovered = await load("quad-host", { persistence: adapter }); assert.ok(recovered);
      try { assert.deepEqual(subject(recovered.map).path, [0, 0, 1]); assert.notEqual(subject(recovered.map).quid, old); }
      finally { recovered.dispose(); }
      await locus.stage(draft => { const page = draft.lib("page"); if (page.mode !== "document") throw Error("doc");
        page.graph({ domain: "graph", op: "replace-content", target: target(0, 0), index: 1,
          replacement: { $_tag: "button", $_content: [] }, lineage: [{ source: validate_document_path([]), destination: validate_document_path([]) }] }); });
      await locus.checkpoint();
      const restored = await load("quad-host", { persistence: adapter }); assert.ok(restored);
      try { assert.deepEqual(subject(restored.map).path, [0, 0, 1]); assert.notEqual(subject(restored.map).quid, old); }
      finally { restored.dispose(); }
      await locus.stage(draft => { const page = draft.lib("page"); if (page.mode !== "document") throw Error("doc");
        page.graph({ domain: "graph", op: "remove-content", target: target(0, 0), index: 1 }); });
      const retired = await load("quad-host", { persistence: adapter }); assert.ok(retired);
      try { assert.equal(lookup(doc(retired.map), "confirm"), undefined); assert.ok(lookup(doc(retired.map), "root")); }
      finally { retired.dispose(); }
    } finally { locus.dispose(); }
  });
  await check("durable Library-add tail carries authored associations through the existing verified replay codec", async () => {
    const source = fixture(), captured = source.capture().libraries[0]!, map = hsonLiveMap.create(), aggregate = owner(map);
    aggregate.setInitialHostedAuthority({ logicalMapId: "quad-topology-tail", incarnationId: "run" });
    const adapter = new MemoryCheckpointAdapter(); await write_semantic_checkpoint(aggregate.captureSemanticCheckpoint(), adapter);
    const manager = {}; aggregate.claimManagement(manager);
    try {
      const prepared = aggregate.prepareAddLibrariesManaged(manager, [{ name: "page", family: "document",
        root: decode_hosted_root(captured.root), hsonSchema: owner(source).librarySchema(owner(source).libraries()[0]!), quads: captured.quads }]);
      const record = durable_aggregate_commit(prepared.transition.commit.hosted!, [{ name: "page", ownership: "shared" }]);
      await adapter.appendCommit(record); aggregate.accept(prepared.transition);
      const received = await load("quad-topology-tail", { persistence: adapter }); assert.ok(received);
      try {
        const current = subject(received.map); assert.deepEqual(current.path, [0, 0, 0]);
        assert.notEqual(current.quid, aggregate.documentQuad(prepared.identities[0]!, "confirm", undefined)?.quid);
        assert.deepEqual(received.runtimeOwnership, [{ name: "page", ownership: "shared" }]);
        assert.deepEqual(received.map.capture().libraries[0]?.quads, captured.quads);
      } finally { received.dispose(); }
      const state = adapter.state("quad-topology-tail")!, commit = state.commits[0]!;
      adapter.seed("quad-topology-tail", { ...state, commits: [{ ...commit, commit: { ...commit.commit,
        topology: { ...commit.commit.topology!, operation: { kind: "library-add", libraries: [{ ...captured, name: "page", quads: [{ name: "bad", path: validate_document_path([99]) }] }] } } } }] });
      await assert.rejects(() => load("quad-topology-tail", { persistence: adapter }));
    } finally { aggregate.releaseManagement(manager); }
  });
  await check("checkpoint association checksums exact descriptors and decoded binding validity fail closed", async () => {
    const adapter = new MemoryCheckpointAdapter(), locus = await host({ map: fixture(), persistence: adapter, logicalMapId: "quad-tamper" });
    locus.dispose();
    const state = adapter.state("quad-tamper")!, manifest = state.checkpoint;
    const descriptor = manifest.chunks.find(chunk => chunk.part === "quads")!;
    const chunk = adapter.chunks.get(descriptor.id)!;
    adapter.chunks.set(descriptor.id, { ...chunk, payload: `${chunk.payload} ` });
    await assert.rejects(() => load("quad-tamper", { persistence: adapter }));
    adapter.chunks.set(descriptor.id, chunk);
    const replacements = [...encode_checkpoint_chunks(manifest.checkpointId, manifest.rev, "page", "quads", [{ name: "bad", path: [99] }])];
    for (const replacement of replacements) adapter.chunks.set(replacement.chunk.id, replacement.chunk);
    adapter.states.set("quad-tamper", { ...state, checkpoint: { ...manifest, chunks: manifest.chunks.map(item => item.part === "quads" ? replacements[0]!.descriptor : item) } });
    await assert.rejects(() => load("quad-tamper", { persistence: adapter }));
    const cleanAdapter = new MemoryCheckpointAdapter(), clean = await host({ map: fixture(), persistence: cleanAdapter, logicalMapId: "quad-prefix" });
    try {
      const semantic = owner(clean.map).captureSemanticCheckpoint();
      await assert.rejects(() => write_semantic_checkpoint({ ...semantic, libraries: semantic.libraries.map(entry => ({ ...entry,
        quads: entry.quads?.map(binding => ({ ...binding, name: `renamed_${binding.name}` })) })) }, cleanAdapter));
    } finally { clean.dispose(); }
  });
}
