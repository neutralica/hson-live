import { echo_map_internal, locus_map_internal } from "../../src/internal/governor-maps.ts";
import { install_fake_document } from "../helpers/fake-document.mts";
import { replace_structured_fixture, structured_css_fixture } from "../helpers/structured-css-fixture.mts";
import { enumerate_livemap_issued_quids } from "../../src/api/livemap/livemap.identity-epoch.ts";
import { set_livemap_quid_candidate_source_for_tests as allocator } from "../../src/api/livemap/livemap.quid-allocation.ts";
import assert from "node:assert/strict";
import { bind_locus_http, hsonMirror, hsonLiveMap } from "../../src/index.ts";
import { install_libraries_snapshot } from "../../src/api/livemap/index.ts";
import { make_livemap_from_authored_libraries_internal as authored } from "../../src/api/livemap/livemap.libraries.ts";
import { internal_livemap_aggregate_authority as owner } from "../../src/api/livemap/livemap.internal.ts";
import { encode_authoritative_scoped_commit, type HostedAggregateCommit, type PrivateScopedAggregateCommit } from "../../src/api/livemap/livemap.hosted.ts";
import { lookup_document_quad_internal as lookup } from "../../src/api/livemap/livemap.document.quad.ts";
import { validate_document_path as path } from "../../src/api/livemap/livemap.document.path.ts";
import { document_css_subject_identities } from "../../src/internal/css/css-identity-translation.ts";
import { encode_portable_document_stylesheet } from "../../src/internal/css/portable-document-stylesheet.ts";
import { node } from "./locus-scoped-ssr-cases.mts";
import type { LiveMap, LiveMapStagedWriter } from "../../src/types/livemap.types.ts";
const sel = (id: string) => `[hson\\:quid="${id}"]`;
const page = (map: LiveMap) => { const lib = map.doc.must("page"); if (lib.mode !== "document") throw Error("document"); return lib; };
function staged(writer: LiveMapStagedWriter<LiveMap, void>) {
  const selected = writer.doc.must("page"); if (selected.mode !== "document") throw Error("document"); return selected;
}
function structured(writer: LiveMapStagedWriter<LiveMap, void>, text: string): void {
  staged(writer).css({ domain: "css", kind: "replace", stylesheet: structured_css_fixture(text) });
}
function state(map: LiveMap) {
  const aggregate = owner(map), id = aggregate.libraries()[0]!;
  return { aggregate, id, overlay: aggregate.documentOverlay(id), ledger: aggregate.identityEpoch().issued() };
}
function atomic(map: LiveMap, run: () => void) {
  const before = map.capture(), saved = state(map); let events = 0;
  const stop = map.commits.observe(() => events++);
  try { assert.throws(run); } finally { stop(); }
  assert.deepEqual(map.capture(), before); assert.equal(state(map).overlay, saved.overlay);
  assert.equal(state(map).ledger, saved.ledger); assert.equal(events, 0);
}
export async function flat_correspondence_cases(check: (name: string, run: () => Promise<void>) => Promise<void>) {
  for (const named of [false, true]) await check(`opaque identity-looking CSS preserves text without demanding ${named ? "authored" : "disposable"} correspondence`, async () => {
    const source = named ? authored({ page: { document: '<main <button @:_000000000 "Before"/>/>' } })
      : hsonLiveMap.fromLibraries({ page: { document: '<main <button "Before"/>/>' } });
    const a = state(source), target = path([0,0,0]);
    const sourceId = named ? lookup(page(source), "_000000000")!.quid : "123456789";
    if (!named) a.aggregate.acquireLocalDocumentIdentity(a.id, target, sourceId);
    const raw = ` /* opaque */ ${sel(sourceId)} { CoLoR: red; }\n[hson\\:quad="unbound"] { color: blue; } `;
    const issued = enumerate_livemap_issued_quids(state(source).ledger), graph = page(source).hson();
    allocator(a.aggregate.identityEpoch().owner, () => { throw Error("Raw text must not allocate identity"); });
    try { page(source).css.stylesheet(raw); }
    finally { allocator(a.aggregate.identityEpoch().owner, undefined); }
    assert.deepEqual(enumerate_livemap_issued_quids(state(source).ledger), issued);
    const capture = source.capture(), css = capture.libraries[0]!.css;
    assert.deepEqual(css, { rules: [], properties: [], keyframes: [], order: [{ kind: "text", text: raw }] });
    assert.deepEqual(document_css_subject_identities(encode_portable_document_stylesheet(a.aggregate.stylesheet(a.id)), "outbound"), []);
    assert.equal(lookup(page(source), "unbound"), undefined);
    assert.deepEqual(capture.libraries[0]!.quads?.map(subject => subject.name) ?? [], named ? ["_000000000"] : []);
    a.aggregate.restorePortableLibraries({ ...capture, revision: 0 });
    const restored = state(source), receiver = install_libraries_snapshot(source.capture()).map, receiving = state(receiver);
    assert.deepEqual(receiver.capture().libraries, source.capture().libraries);
    assert.equal(page(source).hson(), graph); assert.equal(page(receiver).hson(), graph);
    assert.equal(page(source).css.snapshot(), raw); assert.equal(page(receiver).css.snapshot(), raw);
    assert.equal(lookup(page(receiver), "unbound"), undefined);
    const local = restored.overlay.quidAtPath(target), remote = receiving.overlay.quidAtPath(target);
    if (named) {
      assert.ok(local && remote); assert.notEqual(local, sourceId); assert.notEqual(remote, local); assert.notEqual(remote, sourceId);
      assert.equal(lookup(page(receiver), "_000000000")?.quid, remote);
    } else {
      assert.equal(local, undefined); assert.equal(remote, undefined);
      assert.deepEqual(enumerate_livemap_issued_quids(receiving.ledger), []);
      assert.equal(receiving.ledger.has(sourceId), false);
    }
  });
  for (const named of [false, true]) await check(`flat ${named ? "authored" : "disposable"} final transactions and receiving identities`, async () => {
    const source: LiveMap = named ? authored({ page: { document: '<main <button @:_000000000 "Before"/> <i/> <span/>/>' } })
      : hsonLiveMap.fromLibraries({ page: { document: '<main <button "Before"/> <i/> <span/>/>' } });
    const sourceState = state(source);
    const sourceId = named ? lookup(page(source), "_000000000")!.quid : "123456789";
    if (!named) sourceState.aggregate.acquireLocalDocumentIdentity(sourceState.id, path([0,0,0]), sourceId);
    replace_structured_fixture(page(source), `${sel(sourceId)}{color:red}`);
    sourceState.aggregate.restorePortableLibraries({ ...source.capture(), revision: 0 });
    const active = state(source), styled = active.overlay.quidAtPath(path([0,0,0]))!;
    active.aggregate.setInitialHostedAuthority({ logicalMapId: `flat-replay-${named}`, incarnationId: "run" });
    const receiver = install_libraries_snapshot(source.capture()).map, receiving = state(receiver);
    receiving.aggregate.setInitialHostedAuthority(active.aggregate.hostedPosition().authority);
    const retained = receiving.overlay.quidAtPath(path([0,0,0]))!;
    assert.notEqual(retained, styled);
    const replay = (run: () => void, mutate?: (effect: PrivateScopedAggregateCommit) => void) => {
      let commit: HostedAggregateCommit | undefined;
      const stop = active.aggregate.observe(c => { commit = c.hosted; });
      try { run(); } finally { stop(); }
      assert.ok(commit); const effect = encode_authoritative_scoped_commit(commit);
      assert.equal(JSON.stringify(effect).includes(styled), false);
      mutate?.(effect);
      receiving.aggregate.replayDurableHosted(effect);
      assert.equal(receiver.rev, source.rev);
      assert.equal(receiving.aggregate.documentScopes(receiving.id), undefined);
      return effect;
    };
    const first = replay(() => source.batch(w => {
      staged(w).at([0]).asElement().attrs.set("title", "accepted");
      staged(w).at([0]).asElement().flags.set("disabled");
      staged(w).at([0,0]).replace("After");
    }), effect => {
      const variants = [
        { ...effect, prevRev: 1, rev: 2 },
        { ...effect, authority: { ...effect.authority, incarnationId: "foreign" } },
        { ...effect, operations: effect.operations.map(op => ({ ...op, library: "foreign" })) },
        { ...effect, operationCount: effect.operationCount + 1 },
      ];
      for (const variant of variants) atomic(receiver, () => receiving.aggregate.replayDurableHosted(variant));
      const operation = effect.operations.find(op => op.domain === "document"); assert.ok(operation && operation.domain === "document");
      assert.ok("subjects" in operation.effect);
      for (const patch of [
        { before: "0".repeat(64) }, { after: "0".repeat(64) },
        { subjects: [...operation.effect.subjects, ...operation.effect.subjects] },
        { subjects: operation.effect.subjects.map(s => ({ ...s, path: [0,0,99] })) },
        { subjects: operation.effect.subjects.map(s => ({ ...s, name: "forged" })) },
      ]) {
        const forged = { ...effect, operations: [{ ...operation, effect: { ...operation.effect, ...patch } }] };
        atomic(receiver, () => Reflect.apply(receiving.aggregate.replayDurableHosted, undefined, [forged]));
      }
    });
    assert.equal(state(receiver).overlay.quidAtPath(path([0,0,0])), retained);
    atomic(receiver, () => receiving.aggregate.replayDurableHosted(first));
    // Runtime-only source acquisition creates no authority revision. First CSS
    // demand must issue a fresh receiver identity in the accepted transaction.
    const rev = source.rev;
    active.aggregate.acquireLocalDocumentIdentity(active.id, path([0,0,2]), "222222222");
    assert.equal(source.rev, rev); assert.equal(state(receiver).overlay.quidAtPath(path([0,0,2])), undefined);
    replay(() => source.batch(w => structured(w, `${sel(styled)}{color:green}${sel("222222222")}{color:blue}`)));
    const demanded = state(receiver).overlay.quidAtPath(path([0,0,2]))!;
    assert.ok(demanded); assert.notEqual(demanded, "222222222");
    assert.equal(state(receiver).ledger.has("222222222"), false);
    replay(() => source.batch(w => staged(w).at([]).asElement().move(2,0)));
    assert.equal(state(receiver).overlay.quidAtPath(path([0,0,0])), demanded);
    assert.equal(state(receiver).overlay.quidAtPath(path([0,0,1])), retained);
    for (const cssFirst of [false, true]) {
      replay(() => source.batch(w => {
        if (cssFirst) structured(w, "");
        staged(w).at([0]).delete();
        if (!cssFirst) structured(w, `${sel(styled)}{color:green}`);
      }));
      const retired = cssFirst ? retained : demanded;
      assert.equal(state(receiver).overlay.pathForQuid(retired), undefined);
      assert.equal(state(receiver).ledger.has(retired), true);
    }
    atomic(source, () => replace_structured_fixture(page(source), `${sel(styled)}{color:red}`));
    replay(() => source.batch(w => staged(w).at([]).asElement().insert(0, node('<button "New"/>'))));
    active.aggregate.acquireLocalDocumentIdentity(active.id, path([0,0,0]), "333333333");
    replay(() => source.batch(w => structured(w, `${sel("333333333")}{color:purple}`)));
    const fresh = state(receiver).overlay.quidAtPath(path([0,0,0]))!;
    assert.ok(fresh); assert.notEqual(fresh, retained); assert.notEqual(fresh, demanded);
    atomic(source, () => source.batch(w => staged(w).at([0]).delete()));
    replay(() => source.batch(w => { staged(w).at([0]).replace(node('<strong "Replacement"/>')); structured(w, ""); }));
    assert.equal(state(receiver).overlay.pathForQuid(fresh), undefined);
    assert.equal(state(receiver).ledger.has(fresh), true);
    assert.deepEqual(document_css_subject_identities(encode_portable_document_stylesheet(receiving.aggregate.stylesheet(receiving.id)), "outbound"), []);
  });
  await check("flat introduced styled fragment uses receiver issuance and existing Mirror identity effects", async () => {
    install_fake_document();
    const source = hsonLiveMap.fromLibraries({ page: { document: '<main <b "Kept"/>/>' } }), a = state(source);
    a.aggregate.setInitialHostedAuthority({ logicalMapId: "flat-introduction", incarnationId: "run" });
    const receiver = install_libraries_snapshot(source.capture()).map, r = state(receiver);
    r.aggregate.setInitialHostedAuthority(a.aggregate.hostedPosition().authority);
    const mirror = hsonMirror(page(receiver));
    try {
      const incoming = node('<button id="fresh" "Styled"/>'); incoming.$_meta = { quid: "555555555" };
      const commit = a.aggregate.commit([
        { target: a.aggregate.target(a.id, []), kind: "css", operation: { domain: "css", kind: "replace", stylesheet: structured_css_fixture(`${sel("555555555")}{color:red}`, []) } },
        { target: a.aggregate.target(a.id, []), kind: "graph", operation: { domain: "graph", op: "insert-content", target: { kind: "path", path: path([0,0]) }, index: 1, content: incoming } },
      ]);
      assert.ok(commit.hosted);
      const effect = encode_authoritative_scoped_commit(commit.hosted);
      assert.equal(JSON.stringify(effect).includes("555555555"), false);
      r.aggregate.replayDurableHosted(effect);
      assert.equal(mirror.status, "active", String(mirror.failure));
      const quid = state(receiver).overlay.quidAtPath(path([0,0,1]))!;
      assert.ok(quid); assert.notEqual(quid, "555555555");
      assert.ok(mirror.tree.find.byQuid(quid));
      assert.equal(state(receiver).ledger.has("555555555"), false);
    } finally { mirror.dispose(); }
  });
  await check("mixed flat subject CSS and scoped delivery remain atomic and projection-owned", async () => {
    const locus = hsonLiveMap.locus.create({ "parts": { parts: { p: { kind: "document", document: '<b @:label "Scoped"/>', stylesheet: 'b{color:blue}' } }, access: "private" }, "page": { document: '<main <button @:a "Flat"/>/>', stylesheet: '[hson\\:quad="a"]{color:red}', access: "shared" }, "scoped": { document: '<main <hson-part lib="parts" at="p"/>/>', access: "shared" } }, { authorizeProjection: ({ requested }) => ({ libraries: requested.libraries }) });
    const flatQuid = lookup(locus_map_internal(locus).doc.must("page"), "a")!.quid;
    await locus.stage(w => w.doc.must("page").css.sel(sel(flatQuid)).set.color("red"));
    const revision = locus.rev + 1;
    const session = await locus.session.create({ libraries: ["page", "scoped", "parts"] });
    const binding = bind_locus_http(locus, { endpoint: "/flat" });
    const transport = hsonLiveMap.echo.transport.http({ endpoint: "http://flat.test/flat", fetch: (input, init) => binding.handle(new Request(input, init), {}) });
    const echo = await hsonLiveMap.echo.create({ now: session.now(), credential: session.credential!, transport });
    try {
      const map = echo_map_internal(echo), aggregate = owner(map);
      const id = aggregate.libraries()[aggregate.hostedRegistry().libraries.findIndex(e => e.name === "page")]!;
      const quid = aggregate.documentOverlay(id).quidAtPath(path([0,0,0]));
      const applied = new Promise<void>(resolve => {
        const stop = echo.commits.observe(() => queueMicrotask(() => { if (echo.sync.appliedRev === revision) { stop(); resolve(); } }));
      });
      await locus.stage(w => { w.doc.must("page").at([0]).asElement().attrs.set("title", "flat"); w.doc.must("scoped").at([0]).asElement().flags.set("hidden"); });
      await applied;
      assert.equal(aggregate.documentScopes(id), undefined);
      const scoped = aggregate.libraries()[aggregate.hostedRegistry().libraries.findIndex(e => e.name === "scoped")]!;
      assert.equal(aggregate.documentScopes(scoped)?.occurrences.length, 1);
      assert.equal(aggregate.documentOverlay(id).quidAtPath(path([0,0,0])), quid);
      assert.throws(() => echo.parts.must("parts"));
      const before = session.now();
      await assert.rejects(locus.stage(w => { w.doc.must("page").at([0]).delete(); w.doc.must("scoped").at([0]).delete(); }));
      assert.deepEqual(session.now(), before); assert.equal(echo.sync.appliedRev, revision);
      assert.throws(() => page(map).document.attrs.set({ kind: "path", path: path([0]) }, "title", "forbidden"));
      await locus.admit({ "added": { document: '<aside @:new "Dynamic"/>', stylesheet: '[hson\\:quad="new"]{color:purple}', access: "shared" } });
      const addedQuid = lookup(locus_map_internal(locus).doc.must("added"), "new")!.quid;
      await locus.stage(w => w.doc.must("added").css.sel(sel(addedQuid)).set.color("purple"));
      const admitted = await locus.session.create({ libraries: ["added"] });
      const secondTransport = hsonLiveMap.echo.transport.http({ endpoint: "http://flat.test/flat", fetch: (input, init) => binding.handle(new Request(input, init), {}) });
      const second = await hsonLiveMap.echo.create({ now: admitted.now(), credential: admitted.credential!, transport: secondTransport });
      try {
        const addedMap = echo_map_internal(second), addedOwner = owner(addedMap), addedId = addedOwner.libraries()[0]!;
        assert.equal(addedOwner.documentScopes(addedId), undefined);
        const added = addedMap.doc.must("added"); assert.ok(added.mode === "document");
        const subject = lookup(added, "new"); assert.ok(subject); assert.ok(added.css.snapshot().includes(subject.quid));
        assert.throws(() => second.doc.must("page"));
      } finally { second.dispose(); secondTransport.dispose(); }

    } finally { echo.dispose(); transport.dispose(); binding.dispose(); locus.dispose(); }
  });

}
