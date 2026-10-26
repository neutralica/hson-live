import assert from "node:assert/strict";
import { topology_repair_cases } from "./locus-scoped-topology-repair-cases.mts";
import { mint_hson_node_quid } from "../../src/core/hson-node-quid.ts";
import { Hson, hsonLiveMap } from "../../src/index.ts";
import type { LiveMap, LiveMapDefinitions, LiveMapLibraryAddOperation } from "../../src/types/livemap.types.ts";
import { internal_livemap_aggregate_authority as authority } from "../../src/api/livemap/livemap.internal.ts";
import { enumerate_livemap_issued_quids as issued } from "../../src/api/livemap/livemap.identity-epoch.ts";
import { set_livemap_quid_candidate_source_for_tests as allocator } from "../../src/api/livemap/livemap.quid-allocation.ts";
import { validate_document_path as path } from "../../src/api/livemap/livemap.document.path.ts";
import { document_scoped_libraries_semantically_equal as equal } from "../../src/api/livemap/livemap.document.scoped-portable.ts";
import { make_portable_aggregate_commit, encode_authoritative_scoped_commit } from "../../src/api/livemap/livemap.hosted.ts";
import { prepare_hosted_livemap_library_add_internal, reconcile_client_projection_snapshot_internal, replay_durable_library_add_internal } from "../../src/api/livemap/livemap.libraries.ts";
import { resume_registry_locus } from "../../src/api/locus/locus.registry.persistence.ts";
import { create_registry_locus_internal } from "../../src/api/locus/locus.registry.ts";
import { make_locus_hosted_projection_policy, normalize_locus_effective_projection } from "../../src/api/locus/locus.projection.ts";
import { capture_selected_authority_projection_snapshot as capture, capture_locus_session_authority_projection_snapshot as captureSession, authority_projection_as_client_composition_internal as composition } from "../../src/api/locus/locus.authority-projection-snapshot.ts";
import { projected_registry_digest } from "../../src/api/locus/locus.live-projection.ts";
import { create_echo_scoped_replica_internal as receive } from "../../src/api/echo/echo.aggregate-replica.lifecycle.ts";
import { compose_client_projection_internal } from "../../src/api/echo/echo.projection.ts";
import { make_locus_session_manager } from "../../src/api/locus/locus.session.ts";
import { local_initializers } from "../helpers/client-projection.mts";
import { MemoryCheckpointAdapter } from "../helpers/memory-checkpoint-adapter.mts";
import { create_persistent_locus_hosted_aggregate_internal as persist, load_persistent_locus_hosted_aggregate_internal as resume,
  checkpoint_libraries_equal } from "../../src/api/locus/locus.aggregate.persistence.ts";
import { parse_document_stylesheet } from "../../src/internal/css/parse-document-stylesheet.ts";

const parts = { parts: {
  leaf: { kind: "document", document: '<button hson:part @:root <span @:label "Visible"/>/>',
    stylesheet: 'button{color:red;span{opacity:.5}}[hson\\:quad="label"]{border:0}@media screen{@supports(display:grid){:scope{padding:2px}}}' },
  global: { kind: "document", document: '<button hson:part @:root <span @:label "Visible"/>/>', stylesheet: ':scope{--tone:red}@keyframes pulse{from{opacity:0}to{opacity:1}}@property --tone{syntax:"<color>";inherits:true;initial-value:red}' },
  panel: { kind: "document", document: '<section hson:part @:root <hson-part @:child at="leaf"/>/>', stylesheet: ':scope{margin:3px}' },
  secret: { kind: "document", document: '<p hson:part "PRIVATE_UNUSED_PART"/>' },
} } as const;
const page = { document: '<main @:root <hson-part @:left lib="parts" at="panel"/> <hson-part lib="parts" at="panel"/> <hson-part lib="parts" at="global"/> <footer @:footer/>/>' };
const css = parse_document_stylesheet('[hson\\:quad="footer"]{color:purple}main{display:block}', []);
const initialCatalog = [{ name: "parts", ownership: "private" }, { name: "initial", ownership: "shared" }, { name: "hidden", ownership: "private" }] as const;
const additions = [{ name: "page", ownership: "shared" }, { name: "data", ownership: "shared" }] as const;
const catalog = [...initialCatalog, ...additions];
function initial() { return hsonLiveMap.fromLibraries({ parts, initial: { document: '<aside @:initial/>' }, hidden: { data: { secret: "PRIVATE_LIBRARY" } } }); }
function id(map: LiveMap, name: string) { const a = authority(map); return a.libraries()[a.hostedRegistry().libraries.findIndex(e => e.name === name)]!; }
function data(map: LiveMap, name: string) { const library = map.data.must(name); if (String(library.mode) === "document") throw Error(); return library.snap(); }
function state(map: LiveMap, name = "page") { return authority(map).scopedDocumentState(id(map, name)); }
function preserved(map: LiveMap) {
  const a = authority(map), checkpoint = a.captureSemanticCheckpoint(), ledger = a.identityEpoch().issued(), epoch = a.identityEpoch().current();
  const registry = a.hostedRegistry(), position = a.hostedPosition();
  const refs = a.libraries().map(library => ({ library, root: a.root(library), scopes: a.documentScopes(library),
    ...(a.inspect().libraries.find(entry => entry.identity === library)!.mode === "document" ? { overlay: a.documentOverlay(library), css: a.stylesheet(library) } : {}) }));
  let observations = 0;
  const off = map.commits.observe(() => observations++), stop = a.observeAuthorityPosition(() => observations++);
  return () => {
    off(); stop(); assert.deepEqual(a.captureSemanticCheckpoint(), checkpoint); assert.equal(a.identityEpoch().issued(), ledger);
    assert.equal(a.identityEpoch().current(), epoch); assert.equal(a.hostedRegistry(), registry); assert.deepEqual(a.hostedPosition(), position); assert.equal(observations, 0);
    for (const item of refs) { assert.equal(a.root(item.library), item.root); assert.equal(a.documentScopes(item.library), item.scopes);
      if (item.overlay) { assert.equal(a.documentOverlay(item.library), item.overlay); assert.equal(a.stylesheet(item.library), item.css); } }
  };
}
async function projection(map: LiveMap, names: readonly string[] = ["initial", "page", "data"]) {
  const a = authority(map), policy = make_locus_hosted_projection_policy(a.hostedRegistry(), a.hostedPosition().authority,
    catalog, undefined, () => ({ libraries: names }));
  return normalize_locus_effective_projection(policy, { libraries: [...names, "parts", "hidden"] });
}
export async function topology_tail_fixture() {
  const map = initial(), a = authority(map), adapter = new MemoryCheckpointAdapter();
  const l = await persist({ map, persistence: adapter, scopedDocuments: true });
  const epoch = a.identityEpoch().current(), oldIds = issued(a.identityEpoch().issued()), initialState = state(map, "initial");
  let observations = 0; const off = map.commits.observe(() => observations++);
  const commit = await l.add_libraries_internal({ page, data: { data: { n: 0 } } }, undefined, additions, { page: css });
  off(); assert.equal(observations, 1); assert.equal(l.rev, 1); assert.equal(a.identityEpoch().current(), epoch);
  assert.ok(oldIds.every(q => a.identityEpoch().issued().has(q))); assert.ok(equal(initialState, state(map, "initial")));
  assert.deepEqual(commit.topology!.operation.libraries.map(e => e.name), ["page", "data"]);
  assert.equal(state(map).scopes.occurrences.length, 5);
  assert.equal(state(map).css.keyframes.length, 1); assert.equal(state(map).css.properties.length, 1);
  assert.deepEqual(state(map).scopes.occurrences.map(o => o.parent), [null, [0, 0, 0], null, [0, 0, 1], null]);
  assert.deepEqual(state(map).scopes.document.map(b => [b.name, b.kind]), [["footer", "element"], ["left", "part"], ["root", "element"]]);
  assert.throws(() => make_portable_aggregate_commit(commit), /Echo/);
  assert.throws(() => map.capture(), /Echo/);
  const effective = await projection(map), snapshot = capture(map, effective, true);
  assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE_UNUSED_PART|PRIVATE_LIBRARY|"name":"parts"/);
  const echo = receive(snapshot, local_initializers({ local: { data: 1 } })); assert.ok(echo.map);
  assert.ok(equal(state(map), state(echo.map))); assert.throws(() => echo.map!.parts.must("parts"));
  const sourceIds = issued(a.identityEpoch().issued());
  for (const quid of issued(authority(echo.map).identityEpoch().issued())) assert.ok(!sourceIds.includes(quid));
  const scoped = await l.stage(w => {
    const d = w.doc.must("page"); if (d.mode !== "document") throw Error();
    d.content.remove({ kind: "path", path: path([0, 0]) }, 1);
    d.content.remove({ kind: "path", path: path([0, 0]) }, 1);
    d.attrs.set({ kind: "path", path: path([0]) }, "title", "ordered");
    const data = w.data.must("data"); if (String(data.mode) === "document") throw Error(); data.at(["n"]).set(4);
  });
  assert.ok(scoped); echo.replayScopedHosted({ ...encode_authoritative_scoped_commit(scoped), registryDigest: projected_registry_digest(effective) });
  assert.ok(equal(state(map), state(echo.map))); assert.equal(state(map).scopes.occurrences.length, 2);
  assert.equal(state(map).css.keyframes.length, 0); assert.equal(state(map).css.properties.length, 0);
  assert.match(JSON.stringify(state(map).css), /purple/); echo.dispose();
  const expected = a.captureSemanticCheckpoint(), stored = adapter.state(l.logicalMapId)!;
  const bytes = JSON.stringify(stored.commits);
  for (const quid of issued(a.identityEpoch().issued())) assert.ok(!bytes.includes(quid));
  assert.doesNotMatch(bytes, /"epoch"|"issued"|"lifetime"|"rootQuid"/);
  l.dispose(); return { adapter, state: stored, expected, sourceIds: issued(a.identityEpoch().issued()) };
}
export async function verify_topology_restart(f: Awaited<ReturnType<typeof topology_tail_fixture>>) {
  const l = await resume(f.state.checkpoint.logicalMapId, { persistence: f.adapter, scopedDocuments: true }); assert.ok(l);
  try {
    const a = authority(l.map), actual = a.captureSemanticCheckpoint();
    assert.ok(checkpoint_libraries_equal(f.expected.libraries, actual.libraries)); assert.deepEqual(actual.registry, f.expected.registry);
    assert.deepEqual(actual.authority, f.expected.authority); assert.equal(actual.revision, f.expected.revision); assert.deepEqual(l.runtimeOwnership, additions);
    for (const quid of issued(a.identityEpoch().issued())) assert.ok(!f.sourceIds.includes(quid));
    const effective = await projection(l.map), snapshot = capture(l.map, effective, true);
    assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE_UNUSED_PART|PRIVATE_LIBRARY|"name":"parts"/);
    const echo = receive(snapshot, local_initializers({ local: { data: 1 } })); assert.ok(echo.map);
    try {
      assert.ok(equal(state(l.map), state(echo.map)));
      const op = await l.stage(w => { const d = w.doc.must("page"); if (d.mode !== "document") throw Error(); d.attrs.set({ kind: "path", path: path([0]) }, "title", "restarted"); });
      assert.ok(op); echo.replayScopedHosted({ ...encode_authoritative_scoped_commit(op), registryDigest: projected_registry_digest(effective) });
      assert.ok(equal(state(l.map), state(echo.map)));
      await l.checkpoint(); const again = await resume(l.logicalMapId, { persistence: f.adapter, scopedDocuments: true }); assert.ok(again);
      try { assert.ok(checkpoint_libraries_equal(a.captureSemanticCheckpoint().libraries, authority(again.map).captureSemanticCheckpoint().libraries)); }
      finally { again.dispose(); }
    } finally { echo.dispose(); }
  } finally { l.dispose(); }
}
export async function topology_cases(check: (name: string, run: () => Promise<void>) => Promise<void>) {
  await topology_repair_cases(check);
  await check("H0b dynamic scoped topology survives a tail, fresh authority, authorized Echo, and post-add checkpoint", async () => {
    await verify_topology_restart(await topology_tail_fixture());
  });
  await check("H0b additions preserve existing scoped lifetimes and identity history across a scoped checkpoint baseline", async () => {
    const map = initial(); map.addLibraries({ old: page });
    const a = authority(map), oldId = id(map, "old"), oldScopes = a.documentScopes(oldId), overlay = a.documentOverlay(oldId), sheet = a.stylesheet(oldId);
    const prior = state(map, "old"), epoch = a.identityEpoch().current(), ledger = issued(a.identityEpoch().issued());
    const adapter = new MemoryCheckpointAdapter(), locus = await persist({ map, persistence: adapter, scopedDocuments: true });
    try {
      await locus.add_libraries_internal({ page }, undefined, [{ name: "page", ownership: "shared" }], { page: css });
      assert.equal(a.documentScopes(oldId), oldScopes); assert.equal(a.documentOverlay(oldId), overlay); assert.equal(a.stylesheet(oldId), sheet);
      assert.equal(a.identityEpoch().current(), epoch); assert.ok(ledger.every(quid => a.identityEpoch().issued().has(quid))); assert.ok(equal(prior, state(map, "old")));
      const restored = await resume(locus.logicalMapId, { persistence: adapter, scopedDocuments: true }); assert.ok(restored);
      try { assert.ok(checkpoint_libraries_equal(a.captureSemanticCheckpoint().libraries, authority(restored.map).captureSemanticCheckpoint().libraries)); }
      finally { restored.dispose(); }
    } finally { locus.dispose(); }
  });
  await check("H0b public Locus uses private/shared and same-batch Parts without publishing their definitions", async () => {
    for (const ownership of ["private", "shared"] as const) for (const batch of [false, true]) {
      const map = batch ? hsonLiveMap.fromLibraries({ initial: { data: 0 } }) : hsonLiveMap.fromLibraries({ parts, initial: { data: 0 } });
      const libraries = batch ? [{ name: "initial", ownership: "shared" as const }] : [{ name: "parts", ownership }, { name: "initial", ownership: "shared" as const }];
      const { locus } = create_registry_locus_internal({ map, libraries, defaultProjection: { libraries: ["initial"] }, authorizeProjection: ({ requested }) => ({ libraries: requested.libraries }) });
      try {
        const definitions = { page: { ...page, stylesheet: '[hson\\:quad="footer"]{color:purple}', access: "shared" as const },
          ...(batch ? { parts: { ...parts, access: ownership } } : {}) };
        await locus.admit(definitions);
        assert.equal(map.rev, 1); assert.equal(state(map).scopes.occurrences.length, 5);
        const session = await locus.session.create({ libraries: ["page"] });
        assert.equal(session.now().libs.libraries[0]!.scopes!.occurrences.length, 5);
      } finally { locus.dispose(); }
    }
  });
  await check("H0b durable registry resume installs runtime ownership and public session guards", async () => {
    const f = await topology_tail_fixture(), map = initial();
    const locus = await resume_registry_locus({ map, libraries: initialCatalog, persistence: f.adapter,
      logicalMapId: f.state.checkpoint.logicalMapId, authorizeProjection: ({ requested }) => ({ libraries: requested.libraries }) }, { scopedDocuments: true });
    try {
      assert.ok(checkpoint_libraries_equal(f.expected.libraries, authority(map).captureSemanticCheckpoint().libraries));
      await locus.admit({ "later": { ...page, stylesheet: '[hson\\:quad="footer"]{color:purple}', access: "shared" } });
      const nextMap = initial(), restarted = await resume_registry_locus({ map: nextMap, libraries: initialCatalog,
        persistence: f.adapter, logicalMapId: f.state.checkpoint.logicalMapId }, { scopedDocuments: true });
      try { assert.ok(checkpoint_libraries_equal(authority(map).captureSemanticCheckpoint().libraries,
        authority(nextMap).captureSemanticCheckpoint().libraries)); }
      finally { restarted.dispose(); }
      const session = await locus.session.create({ libraries: ["page", "later", "parts", "hidden"] });
      assert.deepEqual(session.now().libs.libraries.map(e => e.name), ["later", "page"]);
      assert.throws(() => session.now({ html: "page" }), /browser-parser realization/);
    } finally { locus.dispose(); }
  });
  await check("H0b invalid scoped additions preserve authority and session state", async () => {
    const map = initial(), { locus } = create_registry_locus_internal({ map, libraries: initialCatalog,
      authorizeProjection: ({ requested }) => ({ libraries: requested.libraries }) });
    try {
      const session = await locus.session.create({ libraries: ["initial"] }, { resumable: true });
      const sessionBefore = session.now(), verify = preserved(map);
      await assert.rejects(locus.admit({ "earlier": { data: 1, access: "shared" }, "page": { document: '<hson-part lib="parts" at="missing"/>', access: "shared" } }), /Unknown Part/);
      verify(); assert.deepEqual(session.now(), sessionBefore); assert.throws(() => locus.data.must("earlier"));
    } finally { locus.dispose(); }
  });
  await check("H0b authenticated reauthorization reconstructs scoped receivers with management fencing", async () => {
    const map = initial(), a = authority(map), sessions = make_locus_session_manager();
    const policy = make_locus_hosted_projection_policy(a.hostedRegistry(), a.hostedPosition().authority,
      initialCatalog, undefined, () => ({ libraries: ["initial"] }));
    const before = await normalize_locus_effective_projection(policy, { libraries: ["initial"] });
    assert.ok(sessions.create("topology", true, { fence() {} }, () => {}, () => 0, undefined, before).ok);
    const receiver = compose_client_projection_internal(captureSession(map, sessions, "topology", true), local_initializers({}), true);
    const r = authority(receiver), manager = {}; r.claimManagement(manager);
    try {
      map.addLibraries({ page, data: { data: 1 } });
      const authorized = await projection(map); sessions.update_projection("topology", before, authorized);
      const snapshot = captureSession(map, sessions, "topology", true), incoming = composition(snapshot, true);
      assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE_UNUSED_PART|PRIVATE_LIBRARY|"name":"parts"/);
      const verify = preserved(receiver);
      assert.throws(() => reconcile_client_projection_snapshot_internal(receiver, {}, incoming, true));
      verify();
      reconcile_client_projection_snapshot_internal(receiver, manager, incoming, true);
      assert.ok(equal(state(map), state(receiver)));
      const fresh = compose_client_projection_internal(snapshot, local_initializers({ local: { data: 9 } }), true);
      const fa = authority(fresh), owner = {}; fa.claimManagement(owner);
      try {
        assert.ok(equal(state(map), state(fresh))); const local = fresh.data.must("local"), localRoot = fa.root(id(fresh, "local"));
        const oldId = id(fresh, "page"), oldScopes = fa.documentScopes(oldId), epoch = fa.identityEpoch().current();
        reconcile_client_projection_snapshot_internal(fresh, owner, incoming, true);
        assert.notEqual(fa.documentScopes(id(fresh, "page")), oldScopes); assert.ok(equal(state(map), state(fresh)));
        const retiring = fresh.doc.must("page"), retiringId = id(fresh, "page"), quids = issued(fa.identityEpoch().issued());
        const narrowed = await projection(map, ["initial"]); sessions.update_projection("topology", authorized, narrowed);
        // Authorized reconciliation removes projected scopes and retains client-local state.
        reconcile_client_projection_snapshot_internal(fresh, owner, composition(captureSession(map, sessions, "topology")), false);
        assert.throws(() => fresh.doc.must("page")); assert.throws(() => fa.documentScopes(retiringId)); assert.throws(() => retiring.root());
        assert.equal(fa.identityEpoch().current(), epoch); assert.ok(quids.every(quid => fa.identityEpoch().issued().has(quid)));
        assert.equal(fresh.data.must("local"), local); assert.equal(fa.root(id(fresh, "local")), localRoot);
      } finally { fa.releaseManagement(owner); }
    } finally { r.releaseManagement(manager); sessions.dispose(); }
  });
  await check("H0b CSS-free Deck-shaped documents and local same-batch forward references retain scopes", async () => {
    const map = hsonLiveMap.create();
    map.addLibraries({ page: { document: '<main @:root <hson-part @:slot lib="parts" at="panel"/> <hson-part lib="parts" at="panel"/>/>' },
      parts: { parts: { panel: { kind: "document", document: '<section hson:part @:root <hson-part at="leaf"/>/>' }, leaf: { kind: "document", document: '<button hson:part @:root/>' } } } });
    assert.equal(state(map).scopes.occurrences.length, 4); assert.equal(state(map).css.order.length, 0);
    const doc = map.doc.must("page"); if (doc.mode !== "document") throw Error(); assert.doesNotMatch(doc.render(), /hson-part|hson:quid/);
  });
  await check("H0b invalid final definitions, duplicate names, missing Parts and schema failures preserve the complete map", async () => {
    const map = initial(); map.addLibraries({ page });
    const invalid: LiveMapDefinitions[] = [
      { earlier: { data: 2 }, bad: { document: '<hson-part lib="missing" at="x"/>' } },
      { earlier: { data: 2 }, bad: { document: '<hson-part lib="parts" at="missing"/>' } },
      { earlier: { data: 2 }, page },
      { earlier: page, bad: { document: '<main <hson-part lib="parts" at="panel"/>/>', schema: Hson.schema`<type "document" tag "main" content "empty">` } },
      { earlier: page, bad: { parts: { broken: { kind: "document", document: '<p' } } } },
    ];
    for (const definitions of invalid) { const verify = preserved(map); assert.throws(() => map.addLibraries(definitions)); verify(); }
  });
  await check("H0b identity exhaustion and management release or same-owner reacquisition reject obsolete candidates", async () => {
    for (const change of ["exhaust", "release", "reacquire"] as const) {
      const map = initial(), a = authority(map), owner = {}; a.claimManagement(owner);
      const verify = preserved(map); let entered = false;
      allocator(a.identityEpoch().owner, () => {
        if (change === "exhaust") return "invalid";
        if (!entered) { entered = true; a.releaseManagement(owner); if (change === "reacquire") a.claimManagement(owner); }
        return mint_hson_node_quid();
      });
      try { assert.throws(() => prepare_hosted_livemap_library_add_internal(map, owner, { earlier: { data: 1 }, page }), /QUID|management authority changed/); verify(); }
      finally { allocator(a.identityEpoch().owner, undefined); a.releaseManagement(owner); }
    }
    const map = initial(), a = authority(map), manager = {}; a.claimManagement(manager);
    try {
      const prepared = prepare_hosted_livemap_library_add_internal(map, manager, { page });
      a.releaseManagement(manager); a.claimManagement(manager); const verify = preserved(map);
      assert.throws(() => a.accept(prepared.transition, "isolate", prepared.afterInstall), /management authority changed/); verify();
    } finally { a.releaseManagement(manager); }
  });
  await check("H0b independently accepted reentrant topology survives rejection of the outer candidate", async () => {
    const map = initial(), a = authority(map); let inner: ReturnType<typeof preserved> | undefined;
    allocator(a.identityEpoch().owner, () => { if (!inner) { map.addLibraries({ inner: { data: 9 } }); inner = preserved(map); } return mint_hson_node_quid(); });
    try { assert.throws(() => map.addLibraries({ page }), /changed|stale/); inner!(); assert.equal(data(map, "inner"), 9); }
    finally { allocator(a.identityEpoch().owner, undefined); }
  });
  await check("H0b malformed namespace, CSS subjects, CSS owners and durable registry evidence never publish a prefix", async () => {
    const f = await topology_tail_fixture(), op = f.state.commits[0]!.commit.topology!;
    const corruptions: ((value: any) => void)[] = [
      x => x.operation.libraries[0].scopes.occurrences[1].parent = [99],
      x => x.operation.libraries[0].scopes.subjects.pop(),
      x => x.operation.libraries[0].css.order[0].owner = '[hson\\:quad="_999999999"]',
      x => delete x.operation.libraries[0].scopes,
      x => x.operation.libraries[1].name = "page",
      x => x.operation.libraries[1].root.payload = "invalid",
    ];
    for (const corrupt of corruptions) {
      const bad: LiveMapLibraryAddOperation = structuredClone(op); corrupt(bad);
      const map = initial(), verify = preserved(map); assert.throws(() => replay_durable_library_add_internal(map, bad)); verify();
    }
    const durableCorruptions: ((value: any) => void)[] = [
      x => x.commits[0].commit.previousRegistryDigest = "0".repeat(64),
      x => x.commits[0].commit.registryDigest = "0".repeat(64),
      x => x.commits[0].locus.libraryOwnershipAdded.pop(),
      x => x.commits[0].locus.libraryOwnershipAdded[0].name = "hidden",
      x => x.commits[0].commit.topology.operation.kind = "library-remove",
      x => delete x.commits[0].commit.topology.operation.libraries[0].scopes,
    ];
    for (const corrupt of durableCorruptions) {
      const bad = structuredClone(f.state); corrupt(bad); f.adapter.seed(f.state.checkpoint.logicalMapId, bad);
      await assert.rejects(resume(f.state.checkpoint.logicalMapId, { persistence: f.adapter, scopedDocuments: true }), /invalid/);
    }
    f.adapter.seed(f.state.checkpoint.logicalMapId, f.state); await verify_topology_restart(f);
  });
  await check("H0b persistence refusal preserves all installed state while independently queued work survives", async () => {
    const map = initial(), a = authority(map), adapter = new MemoryCheckpointAdapter(), l = await persist({ map, persistence: adapter, scopedDocuments: true });
    const append = adapter.appendCommit.bind(adapter); let queued: Promise<unknown> | undefined;
    adapter.appendCommit = async () => {
      const verify = preserved(map); assert.throws(() => map.addLibraries({ bypass: { data: 1 } })); verify();
      queued = l.add_libraries_internal({ inner: { data: 7 } }, undefined, [{ name: "inner", ownership: "private" }]);
      adapter.appendCommit = append; throw Error("refused");
    };
    const before = a.captureSemanticCheckpoint(), ledger = a.identityEpoch().issued();
    try {
      await assert.rejects(l.add_libraries_internal({ page }, undefined, [{ name: "page", ownership: "shared" }]), /append/);
      assert.throws(() => map.doc.must("page")); assert.equal(a.identityEpoch().issued(), ledger);
      await queued; assert.equal(map.rev, before.revision + 1); assert.equal(data(map, "inner"), 7);
      assert.deepEqual(a.captureSemanticCheckpoint().libraries.slice(0, 3), before.libraries);
    } finally { l.dispose(); }
  });
}
