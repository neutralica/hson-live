import assert from "node:assert/strict";
import { hsonLiveMap, hsonTransform, enable_interactions, add_interaction } from "../../src/index.ts";
import { is_Node } from "../../src/core/node-guards.ts";
import { internal_livemap_aggregate_authority as authority } from "../../src/api/livemap/livemap.internal.ts";
import { make_livemap_libraries } from "../../src/api/livemap/livemap.libraries.ts";
import { part_collection_definition_internal as collection } from "../../src/api/livemap/livemap.parts.ts";
import { create_locus_hosted_aggregate_internal as locus, type LocusHostedAggregateStageWriter } from "../../src/api/locus/locus.aggregate.ts";
import { prepare_locus_scoped_commit_internal } from "../../src/api/locus/locus.scoped-preparation.internal.ts";
import { make_locus_hosted_projection_policy, normalize_locus_effective_projection } from "../../src/api/locus/locus.projection.ts";
import { capture_selected_authority_projection_snapshot as capture, admit_authority_projection_snapshot as admit,
  authority_projection_state_fingerprint_internal as fingerprint, type ScopedAuthorityProjectionSnapshot } from "../../src/api/locus/locus.authority-projection-snapshot.ts";
import { create_echo_scoped_replica_internal as receive, create_echo_aggregate_replica_capability_internal as replica } from "../../src/api/echo/echo.aggregate-replica.lifecycle.ts";
import { compose_client_projection_internal } from "../../src/api/echo/echo.projection.ts";
import { document_scoped_libraries_semantically_equal as equal } from "../../src/api/livemap/livemap.document.scoped-portable.ts";
import { DOCUMENT_SCOPED_QUAD_LIMITS } from "../../src/api/livemap/livemap.document.scoped-quad-codec.ts";
import { validate_document_path as path } from "../../src/api/livemap/livemap.document.path.ts";
import { enumerate_livemap_issued_quids } from "../../src/api/livemap/livemap.identity-epoch.ts";
import { set_livemap_quid_candidate_source_for_tests as allocator } from "../../src/api/livemap/livemap.quid-allocation.ts";
import { parse_document_stylesheet } from "../../src/internal/css/parse-document-stylesheet.ts";
import { encode_hosted_root, decode_hosted_root, type PrivateScopedAggregateCommit } from "../../src/api/livemap/livemap.hosted.ts";
import { assign_hson_node_quid } from "../../src/core/hson-node-quid.ts";
import { local_initializers } from "../helpers/client-projection.mts";
import { acquire_echo_map_management_internal } from "../../src/internal/echo-map-capability.ts";
import { locus_local_initializer_digest } from "../../src/api/locus/locus.local-initializer.ts";
import { prepare_echo_replica_internal } from "../../src/api/echo/echo.replica-preparation.ts";

const copy = <T,>(input: T): T => structuredClone(input);
const node = (source: string) => { const n = hsonTransform.fromHson(source).toNode().$_content[0]; assert.ok(is_Node(n)); return n; };
const page = (w: LocusHostedAggregateStageWriter) => { const d = w.lib("page"); assert.equal(d.mode, "document"); if (d.mode !== "document") throw Error(); return d; };
const listener = { event: "click", target: "element" as const, capture: false, once: false, passive: false,
  missingTarget: "ignore" as const, preventDefault: false, stopPropagation: false, stopImmediatePropagation: false };

async function fixture(flat = false) {
  const map = make_livemap_libraries({ parts: collection({
    leaf: { kind: "document", document: '<button @:root <span @:label "Visible"/>/>', css: ':scope{color:blue} [hson\\:quad="label"]{opacity:.5}' },
    panel: { kind: "document", document: '<section @:root <hson-part @:child at="leaf"/>/>', css: '@media screen{:scope{padding:3px}}' },
    secret: { kind: "document", document: '<strong "PRIVATE_PART_SENTINEL"/>' },
  }), page: { document: flat ? '<main @:page <footer @:footer/>/>' : '<main @:page <hson-part @:left lib="parts" at="panel"/> <hson-part lib="parts" at="panel"/> <footer @:footer/>/>' },
  data: { data: { n: 0 } }, zpage: { document: flat ? '<aside/>' : '<aside <hson-part lib="parts" at="leaf"/>/>' },
  hidden: { document: '<p "PRIVATE_LIBRARY_SENTINEL"/>' } }, [], undefined,
  { page: parse_document_stylesheet(flat ? 'main{margin:7px}' : 'main{margin:7px} [hson\\:quad="footer"]{border:0}', []) });
  const a = authority(map);
  enable_interactions(map);
  const pageId = a.libraries()[1]!;
  const footerPath = a.documentQuad(pageId, "footer", undefined)!.path;
  add_interaction(map, { id: "shared-footer", subject: { library: "page", path: footerPath }, listener, kind: "browser", key: "footer", args: null });
  add_interaction(map, { id: "hidden-event", subject: { library: "hidden", path: [0] }, listener, kind: "browser", key: "hidden", args: null });
  const policy = make_locus_hosted_projection_policy(a.hostedRegistry(), a.hostedPosition().authority,
    [{ name: "parts", ownership: "private" }, { name: "page", ownership: "shared" }, { name: "data", ownership: "shared" },
      { name: "zpage", ownership: "shared" }, { name: "hidden", ownership: "shared" }], undefined,
    () => ({ libraries: ["page", "data", "zpage"], systemFeatures: ["interactions"] }));
  const effective = await normalize_locus_effective_projection(policy, { libraries: ["parts", "page", "data", "zpage", "hidden"], systemFeatures: ["interactions"] });
  const batches: PrivateScopedAggregateCommit[] = [];
  const l = locus({ map, ...(flat ? {} : { scopedDocuments: true }), prepareGate: ({ transition }) => { batches.push(prepare_locus_scoped_commit_internal(map, transition, effective)); } });
  const state = () => capture(map, effective, true);
  const fresh = (snapshot = state()) => receive(snapshot, local_initializers({ local: { data: { n: 5 } }, localPage: { document: '<nav @:local/>' } }));
  const stage = async (write: (w: LocusHostedAggregateStageWriter) => void) => { await l.stage(write); return batches.at(-1)!; };
  return { map, a, pageId, effective, l, state, fresh, stage };
}
type Receiver = ReturnType<typeof receive>;
function view(cap: Receiver) {
  assert.ok(cap.map);
  const a = authority(cap.map), bindings = a.hostedRegistry().libraries.filter(e => e.scope === undefined);
  const id = a.libraries()[bindings.findIndex(e => e.name === "page")]!;
  return { map: cap.map, a, id, state: () => a.scopedDocumentState(id), scopes: () => a.documentScopes(id)!.occurrences };
}
function unchanged(cap: Receiver, run: () => void) {
  const { map, a } = view(cap), ids = a.libraries();
  const states = ids.map(id => ({ root: a.root(id), scopes: a.documentScopes(id), css: a.inspect().libraries.find(entry => entry.identity === id)?.mode === "document" ? a.stylesheet(id) : undefined,
    overlay: a.inspect().libraries.find(entry => entry.identity === id)?.mode === "document" ? a.documentOverlay(id) : undefined }));
  const ledger = a.identityEpoch().issued(), epoch = a.identityEpoch().current(), registry = a.hostedRegistry(), position = a.clientProjection(), rev = map.rev;
  const systemId = a.systemState("@hson/canonical-interactions"), system = systemId === undefined ? undefined : a.systemRoot(systemId);
  let commits = 0, positions = 0;
  const off = map.commits.observe(() => commits++), stop = a.observeAuthorityPosition(() => positions++), installed = a.observeAuthorityPosition(() => positions++, "installed");
  try { run(); } finally { off(); stop(); installed(); }
  assert.equal(map.rev, rev); assert.deepEqual(a.clientProjection(), position); assert.equal(a.hostedRegistry(), registry);
  assert.equal(a.identityEpoch().issued(), ledger); assert.equal(a.identityEpoch().current(), epoch);
  assert.deepEqual(a.libraries(), ids); assert.equal(commits, 0); assert.equal(positions, 0);
  if (systemId !== undefined) assert.equal(a.systemRoot(systemId), system);
  ids.forEach((id, i) => { const s = states[i]!; assert.equal(a.root(id), s.root); assert.equal(a.documentScopes(id), s.scopes); if (s.css !== undefined) assert.equal(a.stylesheet(id), s.css); if (s.overlay !== undefined) assert.equal(a.documentOverlay(id), s.overlay); });
}

export async function scoped_initial_cases(check: (name: string, run: () => Promise<void>) => Promise<void>) {
  await check("ordinary authored Parts retain complete scopes; authorized Locus state creates two fresh Echo compositions and ordered replay", async () => {
    const f = await fixture(), snapshot = f.state(), first = f.fresh(snapshot), second = f.fresh(snapshot);
    try {
      assert.equal(f.a.documentScopes(f.pageId)!.occurrences.length, 4);
      assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE_PART_SENTINEL|PRIVATE_LIBRARY_SENTINEL|hidden-event|"name":"parts"/);
      assert.equal(snapshot.libraries.find(e => e.name === "page")!.quads, undefined);
      assert.throws(() => admit(snapshot)); assert.throws(() => compose_client_projection_internal(snapshot, []));
      assert.throws(() => capture(f.map, f.effective)); assert.throws(() => f.map.capture()); assert.ok(f.a.captureSemanticCheckpoint().libraries.some(entry => entry.scopes !== undefined));
      assert.throws(() => f.a.captureDocumentSsr(f.pageId, []));
      assert.throws(() => Reflect.apply(prepare_echo_replica_internal, undefined, [{ now: {
        format: "hson-locus-session-now", sessionBinding: "a".repeat(32), libs: { ...snapshot, libraries: snapshot.libraries.map(({ scopes: _scopes, ...entry }) => entry) },
        local: [], initializerDigest: locus_local_initializer_digest([]),
      } }]), /projection snapshot/);
      assert.doesNotMatch(JSON.stringify(f.a.root(f.pageId)), /"quid"|"quad"|hson-part/);
      const allIds = [f.a, view(first).a, view(second).a].map(a => new Set(enumerate_livemap_issued_quids(a.identityEpoch().issued())));
      for (let i = 0; i < allIds.length; i++) for (let j = i + 1; j < allIds.length; j++) for (const id of allIds[i]!) assert.ok(!allIds[j]!.has(id));
      for (const cap of [first, second]) {
        const r = view(cap); assert.ok(equal(f.a.scopedDocumentState(f.pageId), r.state()));
        assert.equal(r.scopes().length, 4); assert.throws(() => r.map.lib("parts")); assert.throws(() => r.map.lib("hidden"));
        const doc = r.map.lib("page"); if (doc.mode !== "document") throw Error();
        assert.ok(doc.q("page")); assert.ok(doc.q("left")); assert.equal(doc.q("label"), undefined);
        assert.match(r.map.lib("page").css.snapshot(), /margin:7px/); assert.match(r.map.lib("page").css.snapshot(), /border:0/);
        assert.equal(r.a.clientProjection()!.revision, snapshot.revision);
        assert.match(JSON.stringify(r.a.systemRoot(r.a.systemState("@hson/canonical-interactions")!)), /shared-footer/);
        const data = r.map.lib("data"); if (data.mode === "document") throw Error(); assert.equal(data.snap(["n"]), 0);
      }
      const before = [view(first).scopes(), view(second).scopes()];
      const one = await f.stage(w => { page(w).attrs.set({ kind: "path", path: path([0]) }, "title", "next"); const d = w.lib("data"); if (d.mode === "document") throw Error(); d.at(["n"]).set(1); });
      for (const [i, cap] of [first, second].entries()) { cap.replayScopedHosted(one); assert.deepEqual(view(cap).scopes().map(s => s.lifetime), before[i]!.map(s => s.lifetime)); }
      const priorGraph = f.a.root(f.pageId);
      const two = await f.stage(w => page(w).content.replace({ kind: "path", path: path([0, 0]) }, 0, node('<hson-part lib="parts" at="panel"/>')));
      assert.deepEqual(f.a.root(f.pageId), priorGraph);
      for (const [i, cap] of [first, second].entries()) {
        const r = view(cap); cap.replayScopedHosted(two); assert.ok(equal(f.a.scopedDocumentState(f.pageId), r.state()));
        assert.equal(r.a.clientProjection()!.revision, snapshot.revision + 2);
        const data = r.map.lib("data"); if (data.mode === "document") throw Error(); assert.equal(data.snap(["n"]), 1);
        assert.notEqual(r.scopes()[0]!.lifetime, before[i]![0]!.lifetime); assert.notEqual(r.scopes()[1]!.lifetime, before[i]![1]!.lifetime);
        assert.equal(r.scopes()[2]!.lifetime, before[i]![2]!.lifetime); assert.match(r.map.lib("page").css.snapshot(), /border:0/);
        unchanged(cap, () => assert.throws(() => cap.replayScopedHosted(two)));
      }
    } finally { first.dispose(); second.dispose(); f.l.dispose(); }
  });

  await check("full projected replacement installs graph scopes CSS and position together while retaining client-local state", async () => {
    const f = await fixture(), cap = f.fresh(), r = view(cap);
    try {
      const local = r.map.lib("local"); if (local.mode === "document") throw Error(); local.at(["n"]).set(19);
      add_interaction(r.map, { id: "local-nav", subject: { library: "localPage", path: [0] }, listener, kind: "browser", key: "nav", args: null });
      const localId = r.a.libraries()[r.a.hostedRegistry().libraries.filter(e => e.scope === undefined).findIndex(e => e.name === "local")]!, localRoot = r.a.root(localId), old = r.scopes();
      await f.stage(w => page(w).attrs.set({ kind: "path", path: path([0]) }, "title", "restored"));
      let observed = 0;
      const stop = r.a.observeAuthorityPosition(() => { observed++; assert.equal(r.a.clientProjection()!.revision, f.l.rev); assert.ok(equal(f.a.scopedDocumentState(f.pageId), r.state())); }, "installed");
      cap.restoreScopedProjection(f.state()); stop(); assert.equal(observed, 1);
      assert.equal(local.snap(["n"]), 19); assert.equal(r.a.root(localId), localRoot);
      assert.match(JSON.stringify(r.a.systemRoot(r.a.systemState("@hson/canonical-interactions")!)), /local-nav/);
      for (const scope of r.scopes()) assert.ok(!old.some(previous => previous.lifetime === scope.lifetime));
      const next = r.scopes(); cap.restoreScopedProjection(f.state());
      for (const scope of r.scopes()) assert.ok(!next.some(previous => previous.lifetime === scope.lifetime), "equal graphs never prove occurrence continuity");
    } finally { cap.dispose(); f.l.dispose(); }
  });

  await check("malformed final scoped document rejects the entire multi-Library candidate before allocation", async () => {
    const f = await fixture(), cap = f.fresh(), r = view(cap);
    const changes: readonly [string, (entry: any) => void][] = [
      ["missing occurrences", e => { delete e.scopes.occurrences; }],
      ["unknown scope field", e => { e.scopes.extra = true; }],
      ["invalid parent", e => { e.scopes.occurrences[0].parent = e.scopes.occurrences[0].root; }],
      ["duplicate occurrence", e => { e.scopes.occurrences.push(copy(e.scopes.occurrences[0])); }],
      ["duplicate binding", e => { e.scopes.occurrences[0].bindings.push(copy(e.scopes.occurrences[0].bindings[0])); }],
      ["boundary crossing", e => { e.scopes.document = [{ name: "intruder", kind: "element", path: e.scopes.occurrences[0].bindings.find((b: any) => b.name === "label").path }]; }],
      ["foreign subject identity", e => { e.scopes.subjects[0].disposition = "authored"; }],
      ["invalid subject payload", e => { e.scopes.subjects[0].name = "_not-a-quid"; }],
      ["missing CSS correspondence", e => { e.scopes.subjects.pop(); }],
      ["excess CSS correspondence", e => { e.scopes.subjects.unshift({ name: "_defghjkmn", path: [0], disposition: "disposable" }); }],
      ["duplicate correspondence", e => { e.scopes.subjects.push(copy(e.scopes.subjects[0])); }],
      ["bad CSS owner", e => { e.css.order[0].owner = '[hson\\:quad="_defghjkmn"]'; }],
      ["unknown Library field", e => { e.extra = true; }],
      ["undefined scope evidence", e => { e.scopes = undefined; }],
      ["flat/scoped conflict", e => { e.quads = []; }],
      ["resource bound", e => { e.scopes.occurrences = Array(DOCUMENT_SCOPED_QUAD_LIMITS.occurrences + 1).fill(e.scopes.occurrences[0]); }],
      ["forged graph QUID", e => { const root = decode_hosted_root(e.root); const subject = root.$_content[0]; assert.ok(is_Node(subject)); assign_hson_node_quid(subject, "defghjkmn"); e.root = encode_hosted_root(root); }],
    ];
    try {
      for (const [name, change] of changes) {
        const input = JSON.parse(JSON.stringify(f.state()));
        // The data and first document are valid changes; the final document is corrupt.
        input.revision += 1;
        const first = input.libraries.find((e: any) => e.name === "page");
        first.scopes.document[0].name = "changed";
        const data = input.libraries.find((e: any) => e.name === "data");
        data.root = encode_hosted_root(hsonTransform.fromJson({ n: 999 }).toNode());
        change(input.libraries.find((e: any) => e.name === "zpage"));
        let allocations = 0;
        allocator(r.a.identityEpoch().owner, () => { allocations++; throw Error("Unexpected speculative allocation"); });
        try { unchanged(cap, () => assert.throws(() => cap.restoreScopedProjection(input), name)); }
        finally { allocator(r.a.identityEpoch().owner, undefined); }
        assert.equal(allocations, 0, name);
        assert.throws(() => receive(input), name);
      }
      cap.restoreScopedProjection(f.state()); assert.ok(equal(f.a.scopedDocumentState(f.pageId), r.state()));
    } finally { cap.dispose(); f.l.dispose(); }
  });

  await check("scoped content fingerprints and authorized restoration reject hidden or conflicting authority evidence", async () => {
    const f = await fixture(), cap = f.fresh();
    try {
      const original = f.state(), changed = JSON.parse(JSON.stringify(original));
      changed.libraries.find((e: any) => e.name === "page").scopes.document[0].name = "different";
      assert.notEqual(fingerprint(original, true), fingerprint(changed, true));
      assert.equal(admit(changed, true).projectionDigest, original.projectionDigest);
      const broaderPolicy = make_locus_hosted_projection_policy(f.a.hostedRegistry(), f.a.hostedPosition().authority,
        [{ name: "parts", ownership: "private" }, ...["page", "data", "zpage", "hidden"].map(name => ({ name, ownership: "shared" as const }))],
        undefined, () => ({ libraries: ["page", "data", "zpage", "hidden"], systemFeatures: ["interactions"] }));
      const broader = capture(f.map, await normalize_locus_effective_projection(broaderPolicy,
        { libraries: ["page", "data", "zpage", "hidden"], systemFeatures: ["interactions"] }), true);
      assert.equal(admit(broader, true).libraries.length, 4);
      unchanged(cap, () => assert.throws(() => cap.restoreScopedProjection(broader), /unauthorized/));
      // A raw Proxy get cannot substitute the authorized digest for the admitted one.
      unchanged(cap, () => assert.throws(() => cap.restoreScopedProjection(new Proxy(broader, {
        get(target, key, receiver) { return key === "projectionDigest" ? original.projectionDigest : Reflect.get(target, key, receiver); },
      })), /unauthorized/));
      const variants = [
        { ...original, authority: { ...original.authority, incarnationId: "forged" } },
        { ...original, authority: { ...original.authority, logicalMapId: "forged" } },
        { ...original, projectionDigest: "0".repeat(64) },
        { ...original, revision: -1 },
        { ...original, libraries: [...original.libraries, { ...original.libraries[0], name: "parts" }] },
      ];
      for (const input of variants) unchanged(cap, () => assert.throws(() => cap.restoreScopedProjection(input as ScopedAuthorityProjectionSnapshot)));
      await f.stage(w => page(w).attrs.set({ kind: "path", path: path([0]) }, "title", "later"));
      cap.restoreScopedProjection(f.state());
      unchanged(cap, () => assert.throws(() => cap.restoreScopedProjection(original), /authority/));
      assert.ok(equal(f.a.scopedDocumentState(f.pageId), view(cap).state()));
    } finally { cap.dispose(); f.l.dispose(); }
  });

  for (const phase of ["inspection", "descriptor", "property", "allocation"] as const) {
    await check(`complete restoration retains its entry management grant during ${phase}, including same-owner reacquisition`, async () => {
      const f = await fixture();
      try {
        for (const action of ["release", "same-owner", "replacement", "retained"] as const) {
          const map = compose_client_projection_internal(f.state(), [], true), a = authority(map);
          const lease = acquire_echo_map_management_internal(map), cap = replica(map, lease), replacement = {};
          let hit = false, issued = 0;
          const intervene = () => {
            if (hit) return; hit = true;
            if (action === "retained") { a.releaseManagement(replacement); return; }
            a.releaseManagement(lease.owner);
            if (action === "same-owner") a.claimManagement(lease.owner);
            if (action === "replacement") a.claimManagement(replacement);
          };
          const state = copy(f.state());
          const input = phase === "inspection" ? new Proxy(state, { ownKeys(target) { intervene(); return Reflect.ownKeys(target); } })
            : phase === "descriptor" ? new Proxy(state, { getOwnPropertyDescriptor(target, key) { intervene(); return Reflect.getOwnPropertyDescriptor(target, key); } }) : state;
          if (phase === "property") {
            const index = state.libraries.findIndex(entry => entry.name === "page");
            const entries = [...state.libraries];
            entries[index] = new Proxy(entries[index]!, { get(target, key, receiver) { if (key === "mode") intervene(); return Reflect.get(target, key, receiver); } });
            Object.assign(state, { libraries: entries });
          }
          if (phase === "allocation") allocator(a.identityEpoch().owner, () => { intervene(); return `c${(++issued).toString(36).padStart(8, "0")}`; });
          try {
            if (action === "retained") cap.restoreScopedProjection(input);
            else unchanged(cap, () => assert.throws(() => cap.restoreScopedProjection(input)));
            assert.ok(hit);
          } finally {
            allocator(a.identityEpoch().owner, undefined);
            a.releaseManagement(replacement); a.claimManagement(lease.owner);
          }
          cap.restoreScopedProjection(f.state()); assert.ok(equal(f.a.scopedDocumentState(f.pageId), view(cap).state()));
          cap.dispose();
        }
      } finally { f.l.dispose(); }
    });
  }

  await check("old restoration cannot roll back legitimately accepted replacement-manager work", async () => {
    const f = await fixture(), initial = f.state();
    const map = compose_client_projection_internal(initial, [], true), a = authority(map), lease = acquire_echo_map_management_internal(map), cap = replica(map, lease);
    let next: Receiver | undefined, replacementRoot: unknown, once = false;
    try {
      await f.stage(w => page(w).attrs.set({ kind: "path", path: path([0]) }, "title", "replacement-owner"));
      allocator(a.identityEpoch().owner, () => {
        assert.equal(once, false); once = true;
        allocator(a.identityEpoch().owner, undefined); lease.release(); next = replica(map);
        next.restoreScopedProjection(f.state()); replacementRoot = a.root(view(next).id);
        return "defghjkmn";
      });
      assert.throws(() => cap.restoreScopedProjection(initial));
      assert.ok(next); assert.equal(a.root(view(next).id), replacementRoot);
      assert.equal(a.clientProjection()!.revision, f.l.rev); assert.ok(equal(f.a.scopedDocumentState(f.pageId), view(next).state()));
    } finally { allocator(a.identityEpoch().owner, undefined); next?.dispose(); cap.dispose(); f.l.dispose(); }
  });

  await check("restoration rejects caller-owned array execution and allocation cannot adopt a disposable payload", async () => {
    const f = await fixture(), cap = f.fresh(), r = view(cap);
    try {
      const input = copy(f.state()); let called = false;
      Object.defineProperty(input.libraries, "map", { value: () => { called = true; throw Error("caller map"); } });
      unchanged(cap, () => assert.throws(() => cap.restoreScopedProjection(input))); assert.equal(called, false);
      const payload = f.state().libraries.find(e => e.name === "zpage")!.scopes!.subjects[0]!.name.slice(1);
      allocator(r.a.identityEpoch().owner, () => payload);
      try { unchanged(cap, () => assert.throws(() => cap.restoreScopedProjection(f.state()))); }
      finally { allocator(r.a.identityEpoch().owner, undefined); }
      cap.restoreScopedProjection(f.state()); assert.ok(!r.a.identityEpoch().issued().has(payload));
    } finally { cap.dispose(); f.l.dispose(); }
  });

  await check("allocation failure after a prepared document preserves every Library and permits retry", async () => {
    const f = await fixture(), cap = f.fresh(), r = view(cap);
    try {
      const pageIdentities = r.a.documentOverlay(r.id).size;
      let count = 0;
      allocator(r.a.identityEpoch().owner, () => {
        if (++count > pageIdentities) throw Error("Final document allocation failed");
        return `x${String(count).padStart(8, "0")}`;
      });
      try { unchanged(cap, () => assert.throws(() => cap.restoreScopedProjection(f.state()))); }
      finally { allocator(r.a.identityEpoch().owner, undefined); }
      assert.ok(count > pageIdentities);
      cap.restoreScopedProjection(f.state()); assert.ok(equal(f.a.scopedDocumentState(f.pageId), r.state()));
    } finally { cap.dispose(); f.l.dispose(); }
  });

  await check("initial restoration does not weaken stale missing reordered registry or incarnation replay fences", async () => {
    const f = await fixture(), cap = f.fresh();
    try {
      const one = await f.stage(w => page(w).attrs.set({ kind: "path", path: path([0]) }, "title", "one"));
      const two = await f.stage(w => page(w).attrs.set({ kind: "path", path: path([0]) }, "title", "two"));
      for (const bad of [two, { ...one, registryDigest: "0".repeat(64) }, { ...one, authority: { ...one.authority, incarnationId: "wrong" } },
        { ...one, operations: [], operationCount: 0 }]) unchanged(cap, () => assert.throws(() => cap.replayScopedHosted(bad)));
      cap.replayScopedHosted(one); unchanged(cap, () => assert.throws(() => cap.replayScopedHosted(one)));
      cap.replayScopedHosted(two); assert.ok(equal(f.a.scopedDocumentState(f.pageId), view(cap).state()));
    } finally { cap.dispose(); f.l.dispose(); }
  });

  await check("absent scopes retain flat continuity; explicit empty scopes reconstruct and remain private", async () => {
    const map = hsonLiveMap.fromLibraries({ page: { document: '<main/>' }, data: { data: { n: 0 } } }), a = authority(map);
    const policy = make_locus_hosted_projection_policy(a.hostedRegistry(), a.hostedPosition().authority,
      [{ name: "page", ownership: "shared" }, { name: "data", ownership: "shared" }], undefined, () => ({ libraries: ["page", "data"] }));
    const effective = await normalize_locus_effective_projection(policy, { libraries: ["page", "data"] });
    const flat = capture(map, effective), cap = receive(flat), r = view(cap);
    try {
      const root = r.a.root(r.id), overlay = r.a.documentOverlay(r.id);
      cap.restoreScopedProjection(flat); assert.equal(r.a.root(r.id), root); assert.equal(r.a.documentOverlay(r.id), overlay); assert.equal(r.a.documentScopes(r.id), undefined);
      // Equivalent flat acceptance must validate the entry grant too.
      const managedMap = compose_client_projection_internal(flat, [], true), managed = authority(managedMap);
      const lease = acquire_echo_map_management_internal(managedMap), other = replica(managedMap, lease);
      try {
        const stale = new Proxy(copy(flat), { ownKeys(target) {
          managed.releaseManagement(lease.owner); managed.claimManagement(lease.owner);
          return Reflect.ownKeys(target);
        } });
        unchanged(other, () => assert.throws(() => other.restoreScopedProjection(stale)));
        other.restoreScopedProjection(flat);
      } finally { other.dispose(); }
      const explicit: ScopedAuthorityProjectionSnapshot = { ...flat, libraries: flat.libraries.map(e => e.name === "page" ? { ...e, scopes: { document: [], occurrences: [], subjects: [] } } : e) };
      assert.notEqual(fingerprint(flat, true), fingerprint(explicit, true));
      cap.restoreScopedProjection(explicit); assert.deepEqual(r.a.documentScopes(r.id)!.occurrences, []);
      assert.throws(() => compose_client_projection_internal(explicit, []));
      assert.throws(() => admit(explicit));
      // A cache hit from private admission cannot bypass ordinary admission.
      const admitted = admit(explicit, true); assert.throws(() => admit(admitted));
    } finally { cap.dispose(); }
  });

}

// Shared private fixtures; importing these does not run the initial-state cases.
export { fixture as scoped_initial_fixture, view as scoped_receiver_view, unchanged as assert_scoped_unchanged, page, node, listener };
