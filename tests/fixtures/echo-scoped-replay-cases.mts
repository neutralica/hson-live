import { replace_structured_fixture } from "../helpers/structured-css-fixture.mts";
import assert from "node:assert/strict";
import { hsonLiveMap, hsonTransform, enable_interactions, add_interaction } from "../../src/index.ts";
import { is_Node } from "../../src/core/node-guards.ts";
import { internal_livemap_aggregate_authority as authority } from "../../src/api/livemap/livemap.internal.ts";
import { create_locus_hosted_aggregate_internal as create, type LocusHostedAggregateStageWriter } from "../../src/api/locus/locus.aggregate.ts";
import { prepare_locus_scoped_commit_internal as encode } from "../../src/api/locus/locus.scoped-preparation.internal.ts";
import { make_locus_hosted_projection_policy, normalize_locus_effective_projection } from "../../src/api/locus/locus.projection.ts";
import { project_interaction_state_internal } from "../../src/api/interactions/interactions.projection.ts";
import { project_authority_snapshot } from "../../src/api/locus/locus.authority-projection-snapshot.ts";
import { create_echo_aggregate_replica_capability_internal as replica } from "../../src/api/echo/echo.aggregate-replica.lifecycle.ts";
import { document_scoped_libraries_semantically_equal as equal } from "../../src/api/livemap/livemap.document.scoped-portable.ts";
import { validate_document_path as path } from "../../src/api/livemap/livemap.document.path.ts";
import { enumerate_livemap_issued_quids } from "../../src/api/livemap/livemap.identity-epoch.ts";
import { canonical_graph_equal } from "../../src/api/livemap/livemap.document.install.ts";
import { encode_hosted_root, make_portable_aggregate_commit, type PrivateScopedAggregateCommit } from "../../src/api/livemap/livemap.hosted.ts";
import { project_locus_live_transition_internal } from "../../src/api/locus/locus.live-projection.ts";
import { set_livemap_quid_candidate_source_for_tests as allocator } from "../../src/api/livemap/livemap.quid-allocation.ts";
import { remap_portable_document_css_identities, document_css_subject_identities } from "../../src/internal/css/css-identity-translation.ts";
import { encode_portable_document_stylesheet } from "../../src/internal/css/portable-document-stylesheet.ts";
import { assign_hson_node_quid } from "../../src/core/hson-node-quid.ts";
import { decode_exact_hson_value, encode_exact_hson_value } from "../../src/api/livemap/livemap.document.view-state-codec.ts";
import { client_projection_map } from "../helpers/client-projection.mts";
import { acquire_echo_map_management_internal } from "../../src/internal/echo-map-capability.ts";
import type { LiveMap } from "../../src/types/livemap.types.ts";

const node = (text: string) => { const n = hsonTransform.fromHson(text).toNode().$_content[0]; assert.ok(is_Node(n)); return n; };
const connector = (name = "panel") => node(`<hson-part lib="parts" at="${name}"/>`);
const page = (w: LocusHostedAggregateStageWriter, name = "page") => { const p = w.doc.must(name); if (p.mode !== "document") throw Error(); return p; };
const doc = (map: LiveMap) => { const p = map.doc.must("page"); if (p.mode !== "document") throw Error(); return p; };
const data = (map: LiveMap, name: string) => { const d = map.data.must(name); if (String(d.mode) === "document") throw Error(); return d; };
const target = { kind: "path" as const, path: path([0, 0]) };
const insert = (w: LocusHostedAggregateStageWriter, index = 0, name = "panel") => page(w).content.insert(target, index, connector(name));
const replace = (w: LocusHostedAggregateStageWriter, index = 0, name = "panel") => page(w).content.replace(target, index, connector(name));
const listener = { event: "click", target: "element" as const, capture: false, once: false, passive: false,
  missingTarget: "ignore" as const, preventDefault: false, stopPropagation: false, stopImmediatePropagation: false };

async function fixture() {
  const map = hsonLiveMap.fromLibraries({ parts: { parts: {
    leaf: { kind: "document", document: '<b @:root <span @:label "visible"/>/>', css: { color: "blue", "@:label": { opacity: ".5" } } },
    panel: { kind: "document", document: '<section @:root <div @:body <hson-part @:child at="leaf"/>/>/>', css: { $media: { screen: { color: "red" } } } },
    green: { kind: "document", document: '<section @:root <div @:body <hson-part @:child at="leaf"/>/>/>', css: { color: "green" } },
    plain: { kind: "document", document: '<i/>' },
    secret: { kind: "document", document: '<strong "PRIVATE_DEFINITION_SENTINEL"/>' },
  } }, page: { document: '<main @:page <footer @:_abcdefghj/>/>' }, other: { data: { n: 0 } }, hidden: { document: '<aside/>' } });
  const a = authority(map), library = a.libraries()[1]!;
  const footer = a.documentOverlay(library).quidAtPath(path([0, 0, 0]))!;
  enable_interactions(map);
  replace_structured_fixture(map.doc.must("page"), `main{padding:7px} [hson\\:quid="${footer}"]{border:0}`);
  add_interaction(map, { id: "shared-footer", subject: { library: "page", path: [0, 0, 0] }, listener, kind: "browser", key: "footer", args: null });
  const initial = a.captureHosted();
  const policy = make_locus_hosted_projection_policy(initial.registry, initial.authority,
    [{ name: "parts", ownership: "private" }, { name: "page", ownership: "shared" }, { name: "other", ownership: "shared" }, { name: "hidden", ownership: "shared" }],
    undefined, () => ({ libraries: ["page", "other"], systemFeatures: ["interactions"] }));
  const effective = await normalize_locus_effective_projection(policy, { libraries: ["page", "other", "parts"], systemFeatures: ["interactions"] });
  const projected = project_authority_snapshot(initial, effective);
  const batches: PrivateScopedAggregateCommit[] = [];
  const locus = create({ map, scopedDocuments: true, prepareGate(input) { batches.push(encode(map, input.transition, effective)); } });
  const receive = (state = a.scopedDocumentState(library), revision = projected.revision,
    options: Readonly<{ initialize?: boolean; lease?: boolean }> = {}) => {
    // Existing private graph composition plus Cut 3B source-free reconstruction.
    // This fixture does not define a scoped snapshot or public checkpoint format.
    const libs = { ...projected, revision,
      system: { interactions: encode_hosted_root(project_interaction_state_internal(a.systemRoot(a.systemState("@hson/canonical-interactions")!), new Set(["page"]))) },
      libraries: projected.libraries.map(entry => entry.name !== "page" ? entry
      : { ...entry, root: encode_hosted_root(state.root), quads: state.scopes.document.filter(b => b.kind === "element").map(b => ({ name: b.name, path: b.path })), css: { rules: [], properties: [], keyframes: [], order: [] } }) };
    const r = client_projection_map({ authority: libs, local: { local: { data: { n: 5 } }, localPage: { document: '<nav @:local/>' } } });
    add_interaction(r, { id: "local-nav", subject: { library: "localPage", path: [0, 0] }, listener, kind: "browser", key: "local", args: null });
    const ra = authority(r);
    // Locate by authorized binding order rather than an effect-controlled name.
    const rootIdentity = ra.libraries().find(id => canonical_graph_equal(ra.root(id), state.root)); assert.ok(rootIdentity);
    const management = options.lease === true ? acquire_echo_map_management_internal(r) : undefined;
    const cap = replica(r, management);
    if (options.initialize !== false) {
      cap.initializeScopedDocuments([{ library: "page", state }]);
      assert.ok(equal(state, ra.scopedDocumentState(rootIdentity)));
    }
    return { map: r, a: ra, library: rootIdentity, cap, management };
  };
  const stage = async (write: (w: LocusHostedAggregateStageWriter) => void) => {
    const accepted = await locus.stage(write); assert.ok(accepted);
    return { accepted, batch: batches.at(-1)! };
  };
  return { map, a, library, initial, effective, locus, projected, receive, stage, batches };
}
type Receiver = ReturnType<Awaited<ReturnType<typeof fixture>>["receive"]>;
function unchanged(r: Receiver, run: () => void) {
  const roots = r.a.libraries().map(id => [id, r.a.root(id)] as const);
  const scopes = r.a.documentScopes(r.library), overlay = r.a.documentOverlay(r.library), css = r.a.stylesheet(r.library);
  const state = r.a.scopedDocumentState(r.library), issued = r.a.identityEpoch().issued(), epoch = r.a.identityEpoch().current();
  const rev = r.map.rev, projection = r.a.clientProjection(), registry = r.a.hostedRegistry();
  const values = roots.map(([, root]) => JSON.stringify(root));
  const system = r.a.systemState("@hson/canonical-interactions")!;
  const descriptors = JSON.stringify(r.a.systemRoot(system));
  let observations = 0, positions = 0, installations = 0;
  const off = r.map.commits.observe(() => observations++), stop = r.a.observeAuthorityPosition(() => positions++);
  const stopInstalled = r.a.observeAuthorityPosition(() => installations++, "installed");
  try { run(); } finally { off(); stop(); stopInstalled(); }
  assert.equal(r.map.rev, rev); assert.deepEqual(r.a.clientProjection(), projection); assert.equal(r.a.hostedRegistry(), registry);
  assert.equal(r.a.identityEpoch().issued(), issued); assert.equal(r.a.identityEpoch().current(), epoch);
  assert.equal(JSON.stringify(r.a.systemRoot(system)), descriptors);
  assert.equal(r.a.documentScopes(r.library), scopes); assert.equal(r.a.documentOverlay(r.library), overlay); assert.equal(r.a.stylesheet(r.library), css);
  assert.ok(equal(state, r.a.scopedDocumentState(r.library))); assert.equal(observations, 0); assert.equal(positions, 0); assert.equal(installations, 0);
  roots.forEach(([id, root], index) => { assert.equal(r.a.root(id), root); assert.equal(JSON.stringify(root), values[index]); });
}
const scopes = (r: Receiver) => r.a.documentScopes(r.library)!.occurrences;
const ids = (r: Receiver) => new Set(enumerate_livemap_issued_quids(r.a.identityEpoch().issued()));
const copy = <T,>(value: T): T => structuredClone(value);
function delivered(f: Awaited<ReturnType<typeof fixture>>, r: Receiver, batch: PrivateScopedAggregateCommit) {
  const before = r.map.rev, observed: unknown[] = [], installed: unknown[] = [];
  const stop = r.a.observeAuthorityPosition(() => {
    installed.push([r.map.rev, r.a.clientProjection()!.revision]);
  }, "installed");
  const off = r.map.commits.observe(() => {
    observed.push([r.map.rev, r.a.clientProjection()!.revision,
      equal(f.a.scopedDocumentState(f.library), r.a.scopedDocumentState(r.library)),
      canonical_graph_equal(project_interaction_state_internal(f.a.systemRoot(f.a.systemState("@hson/canonical-interactions")!), new Set(["page"])),
        project_interaction_state_internal(r.a.systemRoot(r.a.systemState("@hson/canonical-interactions")!), new Set(["page"])))]);
  });
  assert.equal(r.cap.replayScopedHosted(batch), before + 1); off(); stop();
  assert.deepEqual(installed, [[before + 1, batch.rev]]);
  assert.deepEqual(observed, [[before + 1, batch.rev, true, true]]);
  assert.equal(r.a.clientProjection()!.revision, batch.rev);
}

export async function echo_scoped_cases(check: (name: string, run: () => Promise<void>) => Promise<void>) {
  await check("two real Echo replicas converge through nested repeated Parts and successive graph-identical authoritative replacements", async () => {
    const f = await fixture(), first = f.receive(), second = f.receive();
    try {
      assert.equal(scopes(first).length, 0); assert.equal(scopes(second).length, 0);
      const local = first.map.data.must("local"); if (String(local.mode) === "document") throw Error(); local.at(["n"]).set(11);
      const independent = f.a.libraries()[2]!, sourceIds = new Set(enumerate_livemap_issued_quids(f.a.identityEpoch().issued()));
      const { batch } = await f.stage(w => {
        insert(w); const d = w.data.must("other"); if (String(d.mode) === "document") throw Error(); d.at(["n"]).set(1); insert(w, 1);
        const parts = w.parts.must("parts"); if (String(parts.mode) === "document") throw Error();
        parts.at(["secret", "document"]).set('<strong "UPDATED_PRIVATE_SENTINEL"/>');
        page(w, "hidden").attrs.set({ kind: "path", path: path([0]) }, "title", "PRIVATE_HIDDEN_SENTINEL");
      });
      assert.doesNotMatch(JSON.stringify(batch), /PRIVATE_DEFINITION_SENTINEL|UPDATED_PRIVATE_SENTINEL|PRIVATE_HIDDEN_SENTINEL|"library":"parts"|"library":"hidden"/);
      assert.deepEqual(batch.operations.map(op => op.library), ["page", "other", "page", "@hson/canonical-interactions"]);
      for (const r of [first, second]) {
        delivered(f, r, batch); assert.equal(scopes(r).length, 4);
        assert.equal(data(r.map, "other").snap(["n"]), 1);
        assert.throws(() => r.map.parts.must("parts")); assert.throws(() => r.map.doc.must("hidden"));
        assert.equal(doc(r.map).q("label"), undefined); assert.equal(doc(r.map).q("child"), undefined);
        const state = r.a.scopedDocumentState(r.library);
        assert.equal(state.scopes.occurrences.filter(s => s.bindings.some(b => b.name === "root")).length, 4);
        assert.equal(state.scopes.occurrences.filter(s => s.parent !== null).length, 2);
        assert.equal(r.a.documentQuad(r.library, "_abcdefghj", undefined)?.path.at(-1), 2);
        assert.match(r.map.doc.must("page").css.snapshot(), /padding:7px/); assert.match(r.map.doc.must("page").css.snapshot(), /border:0/);
      }
      assert.equal(data(first.map, "local").snap(["n"]), 11); assert.equal(data(second.map, "local").snap(["n"]), 5);
      for (const id of ids(first)) { assert.ok(!ids(second).has(id)); assert.ok(!sourceIds.has(id)); assert.ok(!f.a.identityEpoch().issued().has(id)); }
      const before = f.a.scopedDocumentState(f.library);
      for (let i = 0; i < 2; i++) {
        const old = [scopes(first), scopes(second)];
        const next = await f.stage(w => replace(w));
        assert.ok(canonical_graph_equal(before.root, f.a.scopedDocumentState(f.library).root));
        for (const [index, r] of [first, second].entries()) {
          delivered(f, r, next.batch);
          assert.notEqual(scopes(r)[0]!.lifetime, old[index]![0]!.lifetime);
          assert.notEqual(scopes(r)[1]!.lifetime, old[index]![1]!.lifetime);
          assert.equal(scopes(r)[2]!.lifetime, old[index]![2]!.lifetime);
          assert.equal(scopes(r)[3]!.lifetime, old[index]![3]!.lifetime);
        }
      }
      const old = [scopes(first), scopes(second)];
      const moved = await f.stage(w => page(w).content.move(target, 0, 1));
      for (const [index, r] of [first, second].entries()) {
        delivered(f, r, moved.batch);
        assert.deepEqual(scopes(r).map(scope => scope.lifetime), [old[index]![2]!.lifetime, old[index]![3]!.lifetime,
          old[index]![0]!.lifetime, old[index]![1]!.lifetime]);
      }
      assert.equal(f.a.snap(independent, ["n"]), 1);
      const system = first.a.systemState("@hson/canonical-interactions")!;
      assert.match(JSON.stringify(first.a.systemRoot(system)), /local-nav/);
    } finally { first.cap.dispose(); second.cap.dispose(); f.locus.dispose(); }
  });
  await check("private source-free initial restoration retains nested scopes, CSS and independently issued identities", async () => {
    const f = await fixture();
    try {
      const initial = await f.stage(w => { insert(w); insert(w, 1); });
      const a = f.receive(f.a.scopedDocumentState(f.library), initial.batch.rev), b = f.receive(f.a.scopedDocumentState(f.library), initial.batch.rev);
      try {
        assert.equal(scopes(a).length, 4); assert.equal(scopes(b).length, 4);
        for (const id of ids(a)) assert.ok(!ids(b).has(id));
        const { batch } = await f.stage(w => replace(w, 1, "green"));
        delivered(f, a, batch); delivered(f, b, batch);
      } finally { a.cap.dispose(); b.cap.dispose(); }
    } finally { f.locus.dispose(); }
  });
  await check("semantic compatibility cannot authorize duplicate stale missing or reordered commits", async () => {
    const f = await fixture(), r = f.receive();
    try {
      const one = await f.stage(w => insert(w, 0, "plain")); r.cap.replayScopedHosted(one.batch);
      const before = f.a.scopedDocumentState(f.library);
      const two = await f.stage(w => replace(w, 0, "plain")), three = await f.stage(w => replace(w, 0, "plain"));
      assert.ok(equal(before, f.a.scopedDocumentState(f.library)));
      assert.equal(two.batch.operations[0]!.domain, "document");
      unchanged(r, () => assert.throws(() => r.cap.replayScopedHosted(three.batch), /revision/i));
      r.cap.replayScopedHosted(two.batch);
      unchanged(r, () => assert.throws(() => r.cap.replayScopedHosted(two.batch), /revision/i));
      unchanged(r, () => assert.throws(() => r.cap.replayScopedHosted(one.batch), /revision/i));
      r.cap.replayScopedHosted(three.batch);
      // A forged caller-supplied cursor cannot bypass the installed receiving position.
      const owner = {}; r.cap.dispose(); r.a.claimManagement(owner);
      unchanged(r, () => assert.throws(() => r.a.replayClientHostedManaged(owner, two.batch, two.batch.prevRev, true), /revision/i));
      r.a.releaseManagement(owner);
    } finally { r.cap.dispose(); f.locus.dispose(); }
  });
  await check("wrong Library authority incarnation registry and projection expansion reject atomically", async () => {
    const f = await fixture(), r = f.receive();
    try {
      const { batch } = await f.stage(w => insert(w));
      const variants = [
        { ...batch, authority: { ...batch.authority, logicalMapId: "foreign" } },
        { ...batch, authority: { ...batch.authority, incarnationId: "foreign" } },
        { ...batch, registryDigest: "foreign" },
        ...["parts", "hidden", "localPage", "other", "missing"].map(library => ({ ...batch, operations: batch.operations.map(op => op.domain === "document" ? { ...op, library } : op) })),
      ];
      for (const input of variants) unchanged(r, () => assert.throws(() => r.cap.replayScopedHosted(input)));
      delivered(f, r, batch);
      unchanged(r, () => assert.throws(() => r.cap.initializeScopedDocuments([{ library: "page", state: f.a.scopedDocumentState(f.library) }])));
      unchanged(r, () => assert.throws(() => r.cap.initializeScopedDocuments([{ library: "localPage", state: f.a.scopedDocumentState(f.library) }])));
    } finally { r.cap.dispose(); f.locus.dispose(); }
  });
  await check("malformed evidence after a valid operation prefix preserves the ledger CSS scopes descriptors and cursors then recovers", async () => {
    const f = await fixture(), r = f.receive();
    try {
      const { batch } = await f.stage(w => { insert(w); insert(w, 1); });
      const bad = copy(batch), last = bad.operations.filter(op => op.domain === "document").at(-1)!;
      assert.equal(last.domain, "document"); if (last.domain !== "document") throw Error();
      Object.assign(last.effect, { after: "0".repeat(64) });
      let allocations = 0;
      allocator(r.a.identityEpoch().owner, () => `r${String(allocations++).padStart(8, "0")}`);
      try { unchanged(r, () => assert.throws(() => r.cap.replayScopedHosted(bad))); } finally { allocator(r.a.identityEpoch().owner, undefined); }
      assert.ok(allocations > 0, "the earlier valid operation reached detached identity preparation");
      delivered(f, r, batch);
    } finally { r.cap.dispose(); f.locus.dispose(); }
  });
  await check("incomplete reordered duplicated conflicting or identity-claiming operation evidence rejects without prefix installation", async () => {
    const f = await fixture(), r = f.receive();
    try {
      const { batch } = await f.stage(w => { insert(w); insert(w, 1); });
      const doc = batch.operations.filter(op => op.domain === "document"), system = batch.operations.filter(op => op.domain !== "document");
      const firstEffect = doc[0]!.effect; assert.ok("graph" in firstEffect);
      const variants = [
        { ...batch, operations: [...doc].reverse() },
        { ...batch, operations: [doc[0]!, doc[0]!] },
        { ...batch, operations: [doc[1]!] },
        { ...batch, operations: [doc[0]!] }, // Missing final effect still has ordinal zero.
        { ...batch, operations: [...doc] }, // Missing authorized system effects.
        { ...batch, operations: [{ library: "page", domain: "graph", kind: "insert-content", format: "hson-hosted-client-graph-op", payload: firstEffect.graph }] },
      ];
      for (const variant of variants) unchanged(r, () => assert.throws(() => r.cap.replayScopedHosted(variant as PrivateScopedAggregateCommit)));
      for (const edit of [
        (e: Record<string, unknown>) => { delete e.created; },
        (e: Record<string, unknown>) => { e.styles = []; },
        (e: Record<string, unknown>) => { e.issued = ["abcdefghj"]; },
        (e: Record<string, unknown>) => { const graph = JSON.parse(String(e.graph)); graph.index = 999; e.graph = JSON.stringify(graph); },
      ]) {
        const input = copy(batch), first = input.operations[0]!;
        if (first.domain !== "document" || !("graph" in first.effect)) throw Error(); edit(first.effect as unknown as Record<string, unknown>);
        unchanged(r, () => assert.throws(() => r.cap.replayScopedHosted(input)));
      }
      assert.ok(system.length > 0); delivered(f, r, batch);
    } finally { r.cap.dispose(); f.locus.dispose(); }
  });
  await check("CSS replacement retires only the replaced occurrence and preserves independent subject CSS", async () => {
    const f = await fixture(), r = f.receive();
    try {
      const initial = await f.stage(w => { insert(w); insert(w, 1); }); r.cap.replayScopedHosted(initial.batch);
      const old = scopes(r), cssBefore = r.map.doc.must("page").css.snapshot();
      assert.match(cssBefore, /color:red/); assert.match(cssBefore, /border:0/);
      const replacement = await f.stage(w => replace(w, 0, "green")); delivered(f, r, replacement.batch);
      const css = r.map.doc.must("page").css.snapshot(); assert.match(css, /color:green/); assert.match(css, /color:red/); assert.match(css, /border:0/);
      assert.equal((cssBefore.match(/color:red/g) ?? []).length, 2);
      assert.equal((css.match(/color:red/g) ?? []).length, 1);
      const demands = document_css_subject_identities(encode_portable_document_stylesheet(r.a.stylesheet(r.library)), "outbound");
      const footer = r.a.documentQuad(r.library, "_abcdefghj", undefined)!.quid;
      assert.ok(demands.includes(footer));
      if (old[0]!.rootQuid !== scopes(r)[0]!.rootQuid) assert.ok(!demands.includes(old[0]!.rootQuid));
      assert.equal(scopes(r)[2]!.lifetime, old[2]!.lifetime);
      const removal = await f.stage(w => page(w).content.remove(target, 1)); delivered(f, r, removal.batch);
      assert.doesNotMatch(r.map.doc.must("page").css.snapshot(), /color:red/); assert.match(r.map.doc.must("page").css.snapshot(), /border:0/);
    } finally { r.cap.dispose(); f.locus.dispose(); }
  });
  await check("authored alias and renamed disposable CSS transport subject remain separate", async () => {
    const f = await fixture(), r = f.receive();
    try {
      const { batch } = await f.stage(w => insert(w));
      const renamed = { ...batch, operations: batch.operations.map(op => op.domain !== "document" || !("styles" in op.effect) ? op : {
        ...op, effect: { ...op.effect, styles: op.effect.styles.map(style => {
          const names = new Map(style.subjects.map((subject, index) => [subject.name, index === 0 ? "_abcdefghj" : "_kmnpqrstv"]));
          return { css: remap_portable_document_css_identities(style.css, names), subjects: style.subjects.map(s => ({ ...s, name: names.get(s.name)! })) };
        }) },
      }) };
      delivered(f, r, renamed);
      assert.deepEqual(r.a.documentQuad(r.library, "_abcdefghj", undefined)?.path, [0, 0, 1]);
      assert.equal(r.a.documentQuad(r.library, "_kmnpqrstv", undefined), undefined);
      assert.equal(doc(r.map).q("root"), undefined);
    } finally { r.cap.dispose(); f.locus.dispose(); }
  });
  await check("receiving never accepts a sender QUID claim or uses a DOM attribute as local identity authority", async () => {
    const f = await fixture(), r = f.receive();
    try {
      const { batch } = await f.stage(w => {
        insert(w);
        page(w).attrs.set({ kind: "path", path: path([0, 0, 0]) }, "data-hson-quid", "abcdefghj");
      });
      const forged = copy(batch), first = forged.operations[0]!;
      if (first.domain !== "document" || !("graph" in first.effect)) throw Error();
      const graph = JSON.parse(first.effect.graph), content = decode_exact_hson_value(graph.content);
      assert.ok(is_Node(content)); assign_hson_node_quid(content, "abcdefghj");
      Object.assign(first.effect, { graph: JSON.stringify({ ...graph, content: encode_exact_hson_value(content) }) });
      unchanged(r, () => assert.throws(() => r.cap.replayScopedHosted(forged), /QUID|identity|claim/));
      delivered(f, r, batch);
      const quid = r.a.documentOverlay(r.library).quidAtPath(path([0, 0, 0]))!;
      assert.notEqual(quid, "abcdefghj"); assert.ok(r.a.identityEpoch().issued().has(quid));
      assert.notEqual(quid, f.a.documentOverlay(f.library).quidAtPath(path([0, 0, 0])));
    } finally { r.cap.dispose(); f.locus.dispose(); }
  });
  await check("a disposable transport label cannot be imported even when offered to the legitimate receiver issuer", async () => {
    const f = await fixture(), r = f.receive();
    try {
      const { batch } = await f.stage(w => insert(w)), first = batch.operations[0]!;
      if (first.domain !== "document" || !("graph" in first.effect)) throw Error();
      const labels = new Set(first.effect.styles.flatMap(style => style.subjects.map(s => s.name.slice(1))));
      let allocations = 0;
      allocator(r.a.identityEpoch().owner, () => allocations++ === 0 ? [...labels][0]! : `y${String(allocations).padStart(8, "0")}`);
      try { delivered(f, r, batch); } finally { allocator(r.a.identityEpoch().owner, undefined); }
      for (const label of labels) assert.equal(r.a.identityEpoch().issued().has(label), false);
      assert.ok(allocations > 1);
    } finally { r.cap.dispose(); f.locus.dispose(); }
  });
  for (const phase of ["replay", "initialization"] as const) {
    const hooks = phase === "replay" ? ["non-enumerable toJSON decoding", "envelope enumeration", "envelope property read"]
      : ["Proxy documents.length inspection", "documents iterator lookup", "state descriptor inspection"];
    for (const hook of hooks) for (const activity of ["release", "different-owner reacquisition", "same-owner reacquisition", "same-owner replacement", "retained grant"] as const) {
      await check(`${phase} retains its entry grant across ${hook}: ${activity}`, async () => {
        const f = await fixture(), initial = f.a.scopedDocumentState(f.library);
        const pending = phase === "replay" ? f.receive(initial, f.projected.revision, { lease: true }) : undefined;
        const { batch } = await f.stage(w => insert(w));
        const state = phase === "replay" ? initial : f.a.scopedDocumentState(f.library);
        const r = pending ?? f.receive(state, batch.rev, { initialize: false, lease: true });
        assert.ok(r.management);
        const revision = r.map.rev;
        const owner = r.management.owner, replacement = activity === "different-owner reacquisition" ? {} : owner;
        let entered = false;
        const reenter = () => {
          if (entered) return;
          entered = true;
          if (activity === "retained grant") r.a.releaseManagement({});
          else {
            if (activity !== "same-owner replacement") r.management!.release();
            if (activity !== "release") r.a.claimManagement(replacement);
          }
        };
        // Exact decoding reproducer: the callback is invisible to exact-key
        // enumeration, but runs when the decoder bounds the serialized input.
        const payload = copy(batch);
        const first = payload.operations[0]!, original = batch.operations[0]!;
        if (first.domain !== "document" || original.domain !== "document") throw Error("Expected scoped payload.");
        if (hook === "non-enumerable toJSON decoding") Object.defineProperty(first.effect, "toJSON", { value() { reenter(); return original.effect; } });
        const input = new Proxy(payload, {
          ownKeys(target) { if (hook === "envelope enumeration") reenter(); return Reflect.ownKeys(target); },
          get(target, key, receiver) {
            if (hook === "envelope property read" && key === "operations") reenter();
            return Reflect.get(target, key, receiver);
          },
        });
        // Exact initialization reproducer: even the first length read may
        // release and reacquire management under the very same owner.
        const inspected = new Proxy(state, {
          getOwnPropertyDescriptor(target, key) {
            if (hook === "state descriptor inspection") reenter();
            return Reflect.getOwnPropertyDescriptor(target, key);
          },
        });
        const documents = new Proxy([{ library: "page", state: inspected }], {
          get(target, key, receiver) {
            if (hook === "Proxy documents.length inspection" && key === "length"
              || hook === "documents iterator lookup" && key === Symbol.iterator) reenter();
            return Reflect.get(target, key, receiver);
          },
        });
        const run = () => phase === "replay" ? r.cap.replayScopedHosted(input) : r.cap.initializeScopedDocuments(documents);
        try {
          if (activity === "retained grant") {
            run();
            assert.ok(equal(f.a.scopedDocumentState(f.library), r.a.scopedDocumentState(r.library)));
            assert.equal(r.map.rev, revision + (phase === "replay" ? 1 : 0));
          } else {
            unchanged(r, () => assert.throws(run, /management|authority|stale/i));
          }
          assert.ok(entered, "the caller-controlled entry hook ran");
          if (activity !== "retained grant") {
            if (activity === "release") r.a.claimManagement(replacement);
            if (phase === "replay") r.a.replayClientHostedManaged(replacement, batch, batch.prevRev, true);
            else r.a.initializeClientScopedDocumentsManaged(replacement, [{ library: "page", state }]);
            assert.ok(equal(f.a.scopedDocumentState(f.library), r.a.scopedDocumentState(r.library)));
          }
        } finally { r.cap.dispose(); r.a.releaseManagement(replacement); f.locus.dispose(); }
      });
    }
  }
  await check("scoped initialization keeps candidate collections out of caller-controlled map results", async () => {
    const f = await fixture();
    await f.stage(w => insert(w));
    const state = f.a.scopedDocumentState(f.library), r = f.receive(state, f.map.rev, { initialize: false, lease: true });
    assert.ok(r.management);
    const owner = r.management.owner;
    let calls = 0;
    const documents = [{ library: "page", state }];
    Object.defineProperty(documents, "map", { value(callback: (entry: typeof documents[number]) => unknown) {
      calls++;
      const inputs = Array.from(documents, callback);
      return { map(prepare: (entry: unknown) => unknown) {
        const candidates = inputs.map(prepare);
        return new Proxy(candidates, { get(target, key, receiver) {
          if (key === Symbol.iterator) {
            r.management!.release(); r.a.claimManagement(owner);
          }
          return Reflect.get(target, key, receiver);
        } });
      } };
    } });
    try {
      r.cap.initializeScopedDocuments(documents);
      assert.equal(calls, 0, "private candidates must never flow through a caller-supplied map method");
      assert.ok(equal(state, r.a.scopedDocumentState(r.library)));
    } finally { r.cap.dispose(); r.a.releaseManagement(owner); f.locus.dispose(); }
  });
  for (const phase of ["replay", "initialization"]) {
    for (const revocation of ["dispose", "dispose after staged prefix", "release", "replace", "reacquire same owner"]) {
      await check(`${phase} rejects management ${revocation} during allocation without installing a prefix`, async () => {
        const f = await fixture();
        const initial = f.a.scopedDocumentState(f.library);
        const pending = phase === "replay" ? f.receive(initial, f.projected.revision, { lease: !revocation.startsWith("dispose") }) : undefined;
        const { batch } = await f.stage(w => { insert(w); insert(w, 1); });
        const state = phase === "replay" ? initial : f.a.scopedDocumentState(f.library);
        const r = pending ?? f.receive(state, batch.rev, { initialize: false, lease: !revocation.startsWith("dispose") });
        let replacement: ReturnType<typeof replica> | undefined, allocations = 0, revoked = false;
        const run = () => phase === "replay" ? r.cap.replayScopedHosted(batch)
          : r.cap.initializeScopedDocuments([{ library: "page", state }]);
        try {
          allocator(r.a.identityEpoch().owner, () => {
            allocations++;
            if (allocations === (revocation === "dispose" ? 1 : 3)) {
              revoked = true;
              if (revocation.startsWith("dispose")) r.cap.dispose();
              else {
                assert.ok(r.management); r.management.release();
                if (revocation === "replace") replacement = replica(r.map);
                if (revocation === "reacquire same owner") r.a.claimManagement(r.management.owner);
              }
            }
            return `x${String(allocations).padStart(8, "0")}`;
          });
          try { unchanged(r, () => assert.throws(run, /management|authority|stale/i)); }
          finally { allocator(r.a.identityEpoch().owner, undefined); }
          assert.ok(revoked); assert.ok(allocations >= (revocation === "dispose" ? 1 : 3));
          if (revocation !== "reacquire same owner") unchanged(r, () => assert.throws(run, /disposed|another authority/i));
          // The new/current owner can prepare fresh work; the rejected candidate
          // must not consume its revision or poison its identity ledger.
          if (replacement !== undefined) {
            if (phase === "replay") replacement.replayScopedHosted(batch);
            else replacement.initializeScopedDocuments([{ library: "page", state }]);
          } else if (revocation === "reacquire same owner") {
            assert.ok(r.management);
            if (phase === "replay") r.a.replayClientHostedManaged(r.management.owner, batch, batch.prevRev, true);
            else r.a.initializeClientScopedDocumentsManaged(r.management.owner, [{ library: "page", state }]);
            unchanged(r, () => assert.throws(run, phase === "replay" ? /revision/i : /predecessor/i));
          }
          if (replacement !== undefined || revocation === "reacquire same owner") {
            assert.ok(equal(state === initial ? f.a.scopedDocumentState(f.library) : state, r.a.scopedDocumentState(r.library)));
          }
          const healthy = f.receive(f.a.scopedDocumentState(f.library), batch.rev);
          try {
            const next = await f.stage(w => replace(w, 1, "green"));
            delivered(f, healthy, next.batch);
          } finally { healthy.cap.dispose(); }
        } finally {
          allocator(r.a.identityEpoch().owner, undefined); replacement?.dispose(); r.cap.dispose();
          if (r.management !== undefined) r.a.releaseManagement(r.management.owner);
          f.locus.dispose();
        }
      });
    }
    await check(`${phase} revocation preserves accepted reentrant work by a replacement Echo`, async () => {
      const f = await fixture(), initial = f.a.scopedDocumentState(f.library);
      const pending = phase === "replay" ? f.receive(initial) : undefined;
      const { batch } = await f.stage(w => { insert(w); insert(w, 1); });
      const state = phase === "replay" ? initial : f.a.scopedDocumentState(f.library);
      const r = pending ?? f.receive(state, batch.rev, { initialize: false });
      let replacement: ReturnType<typeof replica> | undefined, entered = false, observations = 0;
      let installed: Readonly<{ root: object; overlay: object; scopes: unknown; css: object; ledger: object; revision: number; cursor: number }> | undefined;
      const off = r.map.commits.observe(() => observations++);
      try {
        allocator(r.a.identityEpoch().owner, () => {
          if (!entered) {
            entered = true; r.cap.dispose(); replacement = replica(r.map);
            allocator(r.a.identityEpoch().owner, undefined);
            if (phase === "replay") replacement.replayScopedHosted(batch);
            else replacement.initializeScopedDocuments([{ library: "page", state }]);
            installed = { root: r.a.root(r.library), overlay: r.a.documentOverlay(r.library), scopes: r.a.documentScopes(r.library),
              css: r.a.stylesheet(r.library), ledger: r.a.identityEpoch().issued(), revision: r.map.rev, cursor: r.a.clientProjection()!.revision };
          }
          return "z00000000";
        });
        assert.throws(() => phase === "replay" ? r.cap.replayScopedHosted(batch)
          : r.cap.initializeScopedDocuments([{ library: "page", state }]), /management|authority|stale/i);
        assert.ok(entered); assert.ok(installed);
        assert.equal(r.a.root(r.library), installed.root); assert.equal(r.a.documentOverlay(r.library), installed.overlay);
        assert.equal(r.a.documentScopes(r.library), installed.scopes); assert.equal(r.a.stylesheet(r.library), installed.css);
        assert.equal(r.a.identityEpoch().issued(), installed.ledger); assert.equal(r.map.rev, installed.revision);
        assert.equal(r.a.clientProjection()!.revision, installed.cursor); assert.equal(observations, phase === "replay" ? 1 : 0);
        assert.ok(equal(f.a.scopedDocumentState(f.library), r.a.scopedDocumentState(r.library)));
        unchanged(r, () => assert.throws(() => r.cap.replayScopedHosted(batch), /disposed/));
        assert.ok(replacement);
        const next = await f.stage(w => replace(w, 1, "green"));
        delivered(f, { ...r, cap: replacement }, next.batch);
      } finally { allocator(r.a.identityEpoch().owner, undefined); off(); replacement?.dispose(); r.cap.dispose(); f.locus.dispose(); }
    });
  }
  await check("unrelated management release and independent receiver replay do not revoke the active Echo", async () => {
    const f = await fixture(), r = f.receive(), other = f.receive();
    try {
      const { batch } = await f.stage(w => insert(w)); let entered = false;
      allocator(r.a.identityEpoch().owner, () => {
        if (!entered) {
          entered = true; r.a.releaseManagement({}); other.cap.replayScopedHosted(batch);
          allocator(r.a.identityEpoch().owner, undefined);
        }
        return "z00000000";
      });
      delivered(f, r, batch); assert.ok(entered);
      assert.ok(equal(r.a.scopedDocumentState(r.library), other.a.scopedDocumentState(other.library)));
    } finally { allocator(r.a.identityEpoch().owner, undefined); r.cap.dispose(); other.cap.dispose(); f.locus.dispose(); }
  });
  await check("a reentrant authority-position change fences the outer candidate before installation", async () => {
    const f = await fixture(), r = f.receive();
    try {
      const { batch } = await f.stage(w => insert(w));
      const before = r.a.scopedDocumentState(r.library), issued = r.a.identityEpoch().issued(), rev = r.map.rev;
      let entered = false, observations = 0;
      const off = r.map.commits.observe(() => observations++);
      allocator(r.a.identityEpoch().owner, () => {
        if (!entered) {
          entered = true;
          r.cap.advanceHostedProgress({ ...batch.authority, registryDigest: batch.registryDigest, prevRev: batch.prevRev, rev: batch.rev });
        }
        return "z00000000";
      });
      try { assert.throws(() => r.cap.replayScopedHosted(batch), /changed|stale/); }
      finally { allocator(r.a.identityEpoch().owner, undefined); off(); }
      assert.ok(entered); assert.equal(observations, 0); assert.equal(r.map.rev, rev);
      assert.equal(r.a.identityEpoch().issued(), issued); assert.ok(equal(before, r.a.scopedDocumentState(r.library)));
      assert.equal(r.a.clientProjection()!.revision, batch.rev);
    } finally { r.cap.dispose(); f.locus.dispose(); }
  });
  await check("scoped receiver preserves standalone snapshot and SSR fences alongside hosted replay", async () => {
    const f = await fixture(), r = f.receive();
    try {
      const { batch, accepted } = await f.stage(w => insert(w));
      unchanged(r, () => assert.throws(() => r.cap.replayHosted(batch as never), /envelope/));
      assert.throws(() => make_portable_aggregate_commit(accepted), /Echo/);
      assert.throws(() => project_locus_live_transition_internal(accepted, f.effective), /interaction state/);
      r.cap.replayScopedHosted(batch);
      assert.throws(() => r.map.capture(), /Echo\/checkpoint/); assert.ok(r.a.captureSemanticCheckpoint().libraries.some(entry => entry.scopes !== undefined));
      assert.throws(() => r.a.captureDocumentSsr(r.library, []), /inactive/);
      r.cap.dispose(); unchanged(r, () => assert.throws(() => r.cap.replayScopedHosted(batch), /disposed/));
    } finally { r.cap.dispose(); f.locus.dispose(); }
  });
}
