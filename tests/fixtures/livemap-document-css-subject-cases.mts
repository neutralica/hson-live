import assert from "node:assert/strict";
import { hsonLiveMap } from "../../src/index.ts";
import { install_libraries_snapshot } from "../../src/api/livemap/index.ts";
import { internal_livemap_aggregate_authority as owner } from "../../src/api/livemap/livemap.internal.ts";
import { make_livemap_from_authored_libraries_internal as authored } from "../../src/api/livemap/livemap.libraries.ts";
import { lookup_document_quad_internal as lookup } from "../../src/api/livemap/livemap.document.quad.ts";
import { validate_document_path as path } from "../../src/api/livemap/livemap.document.path.ts";
import { set_livemap_quid_candidate_source_for_tests as allocations } from "../../src/api/livemap/livemap.quid-allocation.ts";
import { parse_document_stylesheet } from "../../src/internal/css/parse-document-stylesheet.ts";
import { decode_portable_document_stylesheet, encode_portable_document_stylesheet } from "../../src/internal/css/portable-document-stylesheet.ts";
import { document_css_subject_identities } from "../../src/internal/css/css-identity-translation.ts";
import { assert_subject_free_portable_css_operation } from "../../src/internal/css/portable-document-operations.ts";
import { create_persistent_locus_hosted_aggregate_internal as host, load_persistent_locus_hosted_aggregate_internal as load,
  write_semantic_checkpoint, durable_aggregate_commit,
  type LocusHostedAggregatePersistedCommit } from "../../src/api/locus/locus.aggregate.persistence.ts";
import { MemoryCheckpointAdapter } from "../helpers/memory-checkpoint-adapter.mts";
import { create_locus_hosted_aggregate_authority_internal } from "../../src/api/locus/locus.aggregate.authority.ts";
import { create_echo_aggregate_client_internal } from "../../src/api/echo/echo.aggregate-replica.ts";
import { bind_locus_websocket } from "../../src/api/locus/locus.websocket.ts";
import { test_echo_transport } from "../helpers/echo-websocket-transport.mts";
import type { LocusWebSocketLike } from "../../src/index.ts";
import { decode_portable_aggregate_commit, decode_hosted_root, make_portable_aggregate_commit, type HostedAggregateCommit } from "../../src/api/livemap/livemap.hosted.ts";
import type { LiveMap } from "../../src/types/livemap.types.ts";

const selector = (quid: string) => `[hson\\:quid="${quid}"]`;
const target = (...segments: number[]) => ({ kind: "path" as const, path: path(segments) });
function page(map: LiveMap, name = "page") {
  const result = map.lib(name); if (result.mode !== "document") throw Error("document"); return result;
}
function fixture(full = false) {
  const map = hsonLiveMap.fromLibraries({ page: { document: full ? '<html <head/> <body <button/> <aside/> <span/>/>/>' : '<main <button/> <aside/> <span/>/>' } });
  const aggregate = owner(map), library = aggregate.libraries()[0]!;
  aggregate.acquireLocalDocumentIdentity(library, path(full ? [0, 0, 1, 0, 0] : [0, 0, 0]), "123456789");
  page(map).css.stylesheet(`${selector("123456789")}{color:red}.ordinary{color:blue}`);
  return map;
}
function assertCurrentCss(map: LiveMap, expectedPaths: readonly (readonly number[])[] = [[0, 0, 0]]) {
  const aggregate = owner(map), index = aggregate.hostedRegistry().libraries.filter(entry => entry.scope === undefined).findIndex(entry => entry.name === "page");
  const library = aggregate.libraries()[index]!, overlay = aggregate.documentOverlay(library);
  const demands = document_css_subject_identities(encode_portable_document_stylesheet(aggregate.stylesheet(library)), "outbound");
  assert.equal(demands.length, expectedPaths.length);
  for (const coordinate of expectedPaths) {
    const quid = overlay.quidAtPath(path(coordinate)); assert.ok(quid); assert.ok(demands.includes(quid));
    assert.deepEqual(overlay.pathForQuid(quid), coordinate); assert.ok(aggregate.identityEpoch().issued().has(quid));
  }
  return demands;
}
function atomic(map: LiveMap, run: () => unknown, reason?: RegExp) {
  const aggregate = owner(map), before = map.capture(), ledger = aggregate.identityEpoch().issued();
  const roots = aggregate.libraries().map(id => aggregate.root(id));
  const overlays = aggregate.libraries().map(id => aggregate.documentOverlay(id));
  let events = 0, positions = 0;
  const stop = map.commits.observe(() => events++), stopPosition = aggregate.observeAuthorityPosition(() => positions++);
  try { if (reason === undefined) assert.throws(run); else assert.throws(run, reason); } finally { stop(); stopPosition(); }
  assert.deepEqual(map.capture(), before); assert.equal(aggregate.identityEpoch().issued(), ledger);
  assert.deepEqual(aggregate.libraries().map(id => aggregate.root(id)), roots);
  aggregate.libraries().forEach((id, index) => assert.equal(aggregate.documentOverlay(id), overlays[index]));
  assert.equal(events, 0); assert.equal(positions, 0);
}

export async function document_css_subject_cases(check: (name: string, run: () => void | Promise<void>) => Promise<void>) {
  await check("ordinary CSS lookalikes survive admission capture and fresh restoration beside genuine subjects", () => {
    const ordinary = '::part(hson\\:quid){color:red}.hson\\:quid{color:red}:future(foo){color:blue}';
    for (const styled of [false, true]) {
      let map: LiveMap = styled ? fixture() : hsonLiveMap.fromLibraries({ page: { document: '<main <button/>/>' } });
      page(map).css.stylesheet(`${ordinary}${styled ? `${selector("123456789")}::part(hson\\:quad){color:green}` : ""}`);
      const initial = page(map).css.snapshot();
      for (let cycle = 0; cycle < 3; cycle++) {
        const snapshot = map.capture();
        assert.match(page(map).css.snapshot(), /::part\(hson/);
        if (styled) assertCurrentCss(map);
        else {
          assert.equal(page(map).css.snapshot(), initial); assert.equal(snapshot.libraries[0]!.quads, undefined);
          assert.equal(owner(map).identityEpoch().issued().size, 0);
        }
        map = install_libraries_snapshot(snapshot).map;
      }
      atomic(map, () => page(map).css.stylesheet(':future([hson\\:quid="123456789"]){color:red}'));
    }
  });
  await check("ordinary CSS subjects survive recurring fresh restore without retained disposable bindings or issuance on observation", () => {
    let map: LiveMap = fixture(true); const all = new Set<string>(), coordinate = [0, 0, 1, 0, 0];
    for (let cycle = 0; cycle < 4; cycle++) {
      const aggregate = owner(map), library = aggregate.libraries()[0]!, ledger = aggregate.identityEpoch().issued();
      const [quid] = assertCurrentCss(map, [coordinate]); assert.ok(quid); assert.equal(all.has(quid), false); all.add(quid);
      const snapshot = map.capture(), record = snapshot.libraries[0]!;
      assert.deepEqual(record.quads, [{ name: `_${quid}`, path: coordinate, disposition: "disposable" }]);
      assert.equal(lookup(page(map), `_${quid}`), undefined);
      assert.deepEqual(document_css_subject_identities(record.css!, "inbound"), [`_${quid}`]);
      assert.equal(aggregate.documentOverlay(library).size, 1);
      allocations(aggregate.identityEpoch().owner, () => { throw Error("observational issuance"); });
      try {
        for (let repeat = 0; repeat < 3; repeat++) {
          assert.deepEqual(map.capture(), snapshot);
          const cut = map.cut({ html: "page" }); assert.deepEqual(cut.libs, snapshot);
          assert.match(cut.html, /hson:quad=/); assert.equal(page(map).render(), cut.html);
        }
      } finally { allocations(aggregate.identityEpoch().owner, undefined); }
      assert.equal(aggregate.identityEpoch().issued(), ledger);
      map = install_libraries_snapshot(structuredClone(snapshot)).map;
      for (const foreign of all) assert.equal(owner(map).identityEpoch().issued().has(foreign), false);
    }
  });
  await check("authored underscore names and anonymous CSS demand preserve explicit disposition and authored precedence", () => {
    let map = authored({ page: { document: '<main <button @:named/> <aside @:_123456789/> <span/>/>' } });
    const aggregate = owner(map), library = aggregate.libraries()[0]!;
    aggregate.acquireLocalDocumentIdentity(library, path([0, 0, 2]), "987654321");
    page(map).css.stylesheet([lookup(page(map), "named")!.quid, lookup(page(map), "_123456789")!.quid, "987654321"]
      .map(quid => `${selector(quid)}{color:red}`).join(""));
    const receiving = hsonLiveMap.fromLibraries({ page: { document: '<main <button/> <aside/> <span/>/>' } });
    const receiver = owner(receiving), candidates = ["123456789", "aaaaaaaaa", "bbbbbbbbb"];
    let calls = 0; allocations(receiver.identityEpoch().owner, () => candidates[calls++] ?? "ccccccccc");
    try { receiver.restorePortableLibraries(map.capture()); } finally { allocations(receiver.identityEpoch().owner, undefined); }
    assert.equal(calls, 3); assert.equal(lookup(page(receiving), "_123456789")!.quid, "123456789");
    map = receiving;
    for (let cycle = 0; cycle < 3; cycle++) {
      assertCurrentCss(map, [[0, 0, 0], [0, 0, 1], [0, 0, 2]]);
      const snapshot = map.capture(), entries = snapshot.libraries[0]!.quads!;
      assert.equal(entries.filter(entry => entry.disposition === "disposable").length, 1);
      for (const name of ["named", "_123456789"]) {
        assert.equal(entries.find(entry => entry.name === name)?.disposition, undefined); assert.ok(lookup(page(map), name));
      }
      map = install_libraries_snapshot(snapshot).map;
    }
  });
  await check("strict retirement judges complete graph and CSS batches in either order while movement retains identity", () => {
    const map = fixture(), document = page(map);
    map.batch(draft => { const selected = draft.lib("page");
      selected.attrs.set(target(0), "title", "atomic");
      selected.css.stylesheet(`${selector("123456789")}{color:green}.ordinary{color:blue}`);
    });
    document.document.content.move(target(0, 0), 0, 1);
    assertCurrentCss(map, [[0, 0, 1]]);
    atomic(map, () => document.document.content.remove(target(0, 0), 1));
    atomic(map, () => document.document.content.replace(target(0, 0), 1, { $_tag: "section", $_content: [] }));
    atomic(map, () => map.batch(draft => {
      draft.lib("page").at([0, 0, 1]).delete();
      draft.lib("page").css.stylesheet(`${selector("999999999")}{color:red}`);
    }));
    for (const cssFirst of [false, true]) {
      const candidate = install_libraries_snapshot(map.capture()).map, aggregate = owner(candidate);
      const quid = assertCurrentCss(candidate, [[0, 0, 1]])[0]!;
      let events = 0; const stop = candidate.commits.observe(() => events++);
      try { candidate.batch(draft => {
        const selected = draft.lib("page");
        if (selected.mode !== "document") throw Error("document");
        if (cssFirst) selected.css.stylesheet(".ordinary{color:blue}");
        selected.at([0, 0, 1]).delete();
        if (!cssFirst) selected.css.stylesheet(".ordinary{color:blue}");
      }); } finally { stop(); }
      assert.equal(events, 1); assert.equal(aggregate.documentOverlay(aggregate.libraries()[0]!).pathForQuid(quid), undefined);
      assert.equal(aggregate.identityEpoch().issued().has(quid), true);
      assert.equal(candidate.capture().libraries[0]!.quads, undefined);
    }
  });
  await check("unissued foreign retired mixed ambiguous and opaque CSS candidates reject before publication", () => {
    const map = fixture(), foreign = fixture(), foreignMap = install_libraries_snapshot(foreign.capture()).map;
    const foreignQuid = assertCurrentCss(foreignMap)[0]!;
    for (const reference of [selector("999999999"), selector(foreignQuid), '[hson\\:quad="_123456789"]',
      '[hson\\:quid]', '[hson\\:quid^="123456789"]', '[hson\\:quid="123456789" i]',
      '[HSON\\:QUID="123456789"]', '[ns|hson\\:quid="123456789"]', ':future([hson\\:quid="123456789"])']) {
      atomic(map, () => page(map).css.stylesheet(`${reference}{color:red}`));
    }
    const scopes = parse_document_stylesheet(`@scope (${selector("123456789")}){.a{color:red}}@scope ([hson\\3a quid="123456789"]){.b{color:blue}}`, []);
    const collision = { ...scopes, rules: scopes.rules.map(rule => ({ ...rule, ruleKey: "same" })),
      order: scopes.order.map(entry => entry.kind === "group" ? { ...entry,
        entries: entry.entries.map(child => child.kind === "rule" ? { ...child, ruleKey: "same" } : child) } : entry) };
    atomic(map, () => map.batch(draft => draft.lib("page").css({ domain: "css", kind: "replace", stylesheet: collision })));
    map.batch(draft => { draft.lib("page").css.stylesheet(""); draft.lib("page").at([0, 0, 0]).delete(); });
    atomic(map, () => page(map).css.stylesheet(`${selector("123456789")}{color:red}`));
    const names = authored({ page: { document: '<main <button @:_123456789/> <aside/>/>' } });
    const aggregate = owner(names); aggregate.acquireLocalDocumentIdentity(aggregate.libraries()[0]!, path([0, 0, 1]), "123456789");
    atomic(names, () => page(names).css.stylesheet(`${selector("123456789")}{color:red}`));
  });
  await check("negative selector lists and scope boundaries retain strict demands while syntax feature tests and declared lookalikes do not", () => {
    const map = fixture();
    for (const source of [`:not(${selector("123456789")}),.ordinary{color:red}`,
      `@scope (${selector("123456789")}) to (:not(${selector("123456789")})){.ordinary{color:red}}`]) {
      page(map).css.stylesheet(source); assertCurrentCss(map);
      atomic(map, () => page(map).document.content.remove(target(0, 0), 0));
      assertCurrentCss(install_libraries_snapshot(map.capture()).map);
    }
    const ordinary = hsonLiveMap.fromLibraries({ page: { document: '<main <button/> <aside/>/>' } });
    page(ordinary).css.stylesheet(`@supports selector(${selector("999999999")}){.ordinary{color:red}}.x{content:'[hson\\:quid="123456789"]'}`);
    const snapshot = ordinary.capture();
    assert.equal(snapshot.libraries[0]!.quads, undefined);
    assert.deepEqual(install_libraries_snapshot(snapshot).map.capture(), snapshot);
    const featureRule = snapshot.libraries[0]!.css!.rules[0]!;
    assert.doesNotThrow(() => assert_subject_free_portable_css_operation({ domain: "css", kind: "rule",
      ruleKey: featureRule.ruleKey, scopes: featureRule.scopes, rule: featureRule }));
    page(ordinary).document.content.remove(target(0, 0), 0);
    assert.equal(owner(ordinary).identityEpoch().issued().size, 0);
    atomic(ordinary, () => page(ordinary).css.stylesheet(`@supports selector(:future(${selector("999999999")})){.x{color:red}}`));
  });
  await check("ordinary same-topology topology-changing exact and semantic checkpoint restoration rebind before publication", () => {
    const source = fixture(), snapshot = source.capture();
    for (const map of [fixture(), hsonLiveMap.create()]) {
      const aggregate = owner(map); let publications = 0;
      const stop = aggregate.observeRestore(() => { assertCurrentCss(map); publications++; });
      try { aggregate.restorePortableLibraries(snapshot); } finally { stop(); }
      assert.equal(publications, 1); assertCurrentCss(map);
      const semantic = aggregate.captureSemanticCheckpoint(); aggregate.installSemanticCheckpoint(semantic); assertCurrentCss(map);
      let reads = 0;
      atomic(map, () => aggregate.installSemanticCheckpoint({ ...semantic, libraries: semantic.libraries.map(entry =>
        Object.defineProperty({ ...entry }, "root", { enumerable: true, get() { reads++; throw Error("checkpoint accessor executed"); } })) }));
      assert.equal(reads, 0);
      const exact = aggregate.captureHosted(), quid = assertCurrentCss(map)[0]!;
      map.batch(draft => { const selected = draft.lib("page"); if (selected.mode !== "document") throw Error("document");
        selected.attrs.set(target(0), "title", "changed"); });
      aggregate.restoreHosted(exact);
      assert.equal(assertCurrentCss(map)[0], quid);
      assert.equal(aggregate.identityEpoch().issued().has("123456789"), false);
      atomic(map, () => aggregate.restorePortableLibraries({ ...snapshot, libraries: snapshot.libraries.map(entry => ({ ...entry,
        quads: [{ name: "_123456789", path: path([0, 0, 1]), disposition: "disposable" },
          { name: "_123456789", path: path([0, 0, 0]), disposition: "disposable" }] })) }));
    }
  });
  await check("Library-add commit serialization and local topology replay retain a current re-exportable stylesheet", () => {
    const source = fixture().capture().libraries[0]!, map = hsonLiveMap.create(), initial = map.capture();
    const commit = map.replay({ kind: "map", changed: true, prevRev: 0, rev: 1, operations: [{ library: "page", operation: {
      kind: "library-add", libraries: [{ name: "page", mode: "document", schema: source.schema, root: source.root,
        quads: source.quads, css: source.css }],
    } }] });
    assertCurrentCss(map);
    const replica = install_libraries_snapshot(initial).map; replica.replay(commit); assertCurrentCss(replica);
    assert.notEqual(assertCurrentCss(replica)[0], assertCurrentCss(map)[0]);
    assertCurrentCss(install_libraries_snapshot(replica.capture()).map);
  });
  await check("multiple Libraries exclude every foreign disposable payload from receiving allocation", () => {
    const source = fixture(), aggregate = owner(source);
    source.addLibraries({ other: { document: '<main <button/> <aside/>/>' } });
    const other = aggregate.libraries()[1]!; aggregate.acquireLocalDocumentIdentity(other, path([0, 0, 0]), "987654321");
    page(source, "other").css.stylesheet(`${selector("987654321")}{color:blue}`);
    atomic(source, () => page(source).css.stylesheet(`${selector("987654321")}{color:red}`));
    const receiver = hsonLiveMap.create(), receiving = owner(receiver), candidates = ["987654321", "123456789", "aaaaaaaaa", "bbbbbbbbb"];
    let calls = 0; allocations(receiving.identityEpoch().owner, () => candidates[calls++] ?? "ccccccccc");
    try { receiving.restorePortableLibraries(source.capture()); } finally { allocations(receiving.identityEpoch().owner, undefined); }
    assert.equal(calls, 4);
    assert.equal(receiving.identityEpoch().issued().has("123456789"), false);
    assert.equal(receiving.identityEpoch().issued().has("987654321"), false);
    const selected = source.cut({ documents: ["page"], data: [] });
    assert.equal(selected.libs.libraries.length, 1); assert.equal(JSON.stringify(selected).includes("987654321"), false);
    assertCurrentCss(install_libraries_snapshot(selected.libs).map);
  });
  await check("failed allocation and reentrant restoration retain accepted independent inner work without publishing the failed candidate", () => {
    const map = fixture(), aggregate = owner(map), before = map.capture(), ledger = aggregate.identityEpoch().issued();
    let once = false;
    allocations(aggregate.identityEpoch().owner, () => {
      if (!once) { once = true; page(map).css.clearAll(); }
      return "aaaaaaaaa";
    });
    try { assert.throws(() => aggregate.restorePortableLibraries(before), /changed during capture/); }
    finally { allocations(aggregate.identityEpoch().owner, undefined); }
    assert.equal(page(map).css.snapshot(), ""); assert.equal(map.rev, before.revision + 1);
    assert.equal(aggregate.identityEpoch().issued(), ledger);
    assert.equal(aggregate.documentOverlay(aggregate.libraries()[0]!).quidAtPath(path([0, 0, 0])), "123456789");
    assert.equal(aggregate.identityEpoch().issued().has("aaaaaaaaa"), false);
  });
  await check("coherent subject CSS capture closes its source fence before detached bounds allow independent retirement", () => {
    const map = fixture(), stringify = JSON.stringify;
    let mutated = false, captured;
    JSON.stringify = function(value, replacer, space) {
      if (value?.format === "hson-livemap-libraries-snapshot" && !mutated) {
        mutated = true;
        map.batch(draft => { draft.lib("page").at([0, 0, 0]).delete(); draft.lib("page").css.stylesheet(""); });
      }
      return Reflect.apply(stringify, JSON, [value, replacer, space]);
    };
    try { captured = map.capture(); } finally { JSON.stringify = stringify; }
    assert.equal(mutated, true); assertCurrentCss(install_libraries_snapshot(captured).map);
    assert.equal(page(map).css.snapshot(), ""); assert.equal(map.capture().libraries[0]!.quads, undefined);
  });
  await check("semantic durable checkpoints recapture disposable CSS and reject incoherent output before storage", async () => {
    const map = fixture(), aggregate = owner(map), adapter = new MemoryCheckpointAdapter();
    aggregate.restorePortableLibraries({ ...map.capture(), revision: 0 });
    aggregate.setInitialHostedAuthority({ logicalMapId: "css-subject-checkpoint", incarnationId: "run" });
    await write_semantic_checkpoint(aggregate.captureSemanticCheckpoint(), adapter);
    const restored = await load("css-subject-checkpoint", { persistence: adapter }); assert.ok(restored);
    try {
      assertCurrentCss(restored.map); await restored.checkpoint();
      const again = await load("css-subject-checkpoint", { persistence: adapter }); assert.ok(again);
      try { assertCurrentCss(again.map); await again.checkpoint(); } finally { again.dispose(); }
      const semantic = owner(restored.map).captureSemanticCheckpoint(), count = adapter.chunks.size;
      await assert.rejects(() => write_semantic_checkpoint({ ...semantic, libraries: semantic.libraries.map(({ quads: _quads, ...entry }) => entry) }, adapter));
      assert.equal(adapter.chunks.size, count);
    } finally { restored.dispose(); }
  });
  await check("hosted incremental subject CSS is rejected before durable append while full recovery remains portable", async () => {
    const map = fixture(), adapter = new MemoryCheckpointAdapter();
    owner(map).restorePortableLibraries({ ...map.capture(), revision: 0 });
    const locus = await host({ map, persistence: adapter, logicalMapId: "css-subject-host", incarnationId: "run" });
    try {
      const before = map.capture(), appends = adapter.appendCalls.length;
      await assert.rejects(() => locus.stage(draft => {
        const selected = draft.lib("page"); if (selected.mode !== "document") throw Error("document");
        selected.attrs.set(target(0, 0, 0), "title", "unsupported");
      }), /incremental subject-owned CSS/);
      assert.deepEqual(map.capture(), before); assert.equal(adapter.appendCalls.length, appends);
      const css = { domain: "css" as const, kind: "replace" as const, stylesheet: before.libraries[0]!.css! };
      assert.throws(() => assert_subject_free_portable_css_operation(css), /incremental subject-owned CSS/);
      assert.throws(() => assert_subject_free_portable_css_operation({ ...css, stylesheet: parse_document_stylesheet(`${selector("123456789")}{color:red}`, []) }));
    } finally { locus.dispose(); }
    const local = fixture(), aggregate = owner(local);
    let hosted: HostedAggregateCommit | undefined;
    const stop = aggregate.observe(commit => { hosted = commit.hosted; });
    try { local.batch(draft => draft.lib("page").css.stylesheet(`${selector("123456789")}{color:green}`)); } finally { stop(); }
    const captured = hosted; assert.ok(captured);
    assert.throws(() => make_portable_aggregate_commit(captured), /incremental subject-owned CSS/);
    const initial = hsonLiveMap.create(), receiving = owner(initial), manager = {}, entry = local.capture().libraries[0]!;
    receiving.claimManagement(manager);
    try {
      atomic(initial, () => receiving.prepareAddLibrariesManaged(manager, [{ name: "added", family: "document",
        root: decode_hosted_root(entry.root), quads: entry.quads,
        hsonSchema: aggregate.librarySchema(aggregate.libraries()[0]!), css: decode_portable_document_stylesheet(entry.css) }]));
    } finally { receiving.releaseManagement(manager); }
  });
  await check("durable replay enforces the live subject-CSS incremental boundary without rejecting identity-free tails or full checkpoints", async () => {
    for (const styled of [false, true]) {
      const map = authored({ page: { document: '<main <button @:authored/>/>' } }), aggregate = owner(map);
      if (styled) page(map).css.stylesheet(`${selector(lookup(page(map), "authored")!.quid)}{color:red}`);
      else page(map).css.stylesheet('::part(hson\\:quid){color:red}.hson\\:quid{color:red}:future(foo){color:blue}');
      aggregate.restorePortableLibraries({ ...map.capture(), revision: 0 });
      const logicalMapId = `css-subject-tail-${styled}`, adapter = new MemoryCheckpointAdapter();
      aggregate.setInitialHostedAuthority({ logicalMapId, incarnationId: "run" });
      await write_semantic_checkpoint(aggregate.captureSemanticCheckpoint(), adapter);
      const initial = map.capture(), sender = lookup(page(map), "authored")!.quid;
      const restored = await load(logicalMapId, { persistence: adapter }); assert.ok(restored);
      try {
        assert.notEqual(lookup(page(restored.map), "authored")!.quid, sender);
        if (styled) assertCurrentCss(restored.map);
      } finally { restored.dispose(); }
      let hosted: HostedAggregateCommit | undefined;
      const stop = aggregate.observe(commit => { hosted = commit.hosted; });
      // This local edit is semantically valid. Its hosted incremental transport
      // is unsupported when the affected Library already owns subject CSS.
      try { page(map).document.attrs.set(target(0, 0, 0), "title", "safe-local-edit"); } finally { stop(); }
      assert.ok(hosted);
      const portable = make_portable_aggregate_commit(hosted); assert.ok(portable);
      const receiver = install_libraries_snapshot(initial).map, receiving = owner(receiver);
      receiving.setInitialHostedAuthority({ logicalMapId, incarnationId: "run" });
      if (styled) {
        for (const replay of [() => receiving.replayDurableHosted(portable), () => receiving.replayClientHosted(portable)]) {
          atomic(receiver, replay, /Hosted incremental subject-owned CSS.*unsupported/);
        }
      } else {
        receiving.replayDurableHosted(portable);
        assert.equal(page(receiver).document.attrs.get(target(0, 0, 0), "title"), "safe-local-edit");
      }
      // Seed a fully fenced canonical tail, without going through live managed
      // authoring. The loader must apply the same support boundary in scratch state.
      await adapter.appendCommit(durable_aggregate_commit(hosted));
      const stored = adapter.state(logicalMapId), appends = adapter.appendCalls.length;
      if (styled) {
        let recovered: unknown;
        const unsupportedTail = (error: unknown) => error instanceof Error && "code" in error && error.code === "LOCUS_PERSISTED_STATE_INVALID"
          && error.cause instanceof Error && /Hosted incremental subject-owned CSS.*unsupported/.test(error.cause.message);
        await assert.rejects(async () => { recovered = await load(logicalMapId, { persistence: adapter }); },
          unsupportedTail);
        assert.equal(recovered, undefined);
        const chunks = adapter.chunks.size, manifests = adapter.checkpointCalls.length;
        await assert.rejects(() => write_semantic_checkpoint(aggregate.captureSemanticCheckpoint(), adapter), unsupportedTail);
        assert.equal(adapter.chunks.size, chunks); assert.equal(adapter.checkpointCalls.length, manifests);
      } else {
        const recovered = await load(logicalMapId, { persistence: adapter }); assert.ok(recovered);
        try {
          assert.equal(page(recovered.map).document.attrs.get(target(0, 0, 0), "title"), "safe-local-edit");
          assert.notEqual(lookup(page(recovered.map), "authored")!.quid, sender);
        } finally { recovered.dispose(); }
      }
      assert.deepEqual(adapter.state(logicalMapId), stored); assert.equal(adapter.appendCalls.length, appends);
      // A complete checkpoint of the same final state is supported separately;
      // the refused history above is never discarded or rewritten to recover it.
      const completeAdapter = styled ? new MemoryCheckpointAdapter() : adapter;
      await write_semantic_checkpoint(aggregate.captureSemanticCheckpoint(), completeAdapter);
      const complete = await load(logicalMapId, { persistence: completeAdapter }); assert.ok(complete);
      try {
        assert.equal(page(complete.map).document.attrs.get(target(0, 0, 0), "title"), "safe-local-edit");
        assert.notEqual(lookup(page(complete.map), "authored")!.quid, sender);
        if (styled) { assertCurrentCss(complete.map); assertCurrentCss(install_libraries_snapshot(complete.map.capture()).map); }
      } finally { complete.dispose(); }
    }
  });
  await check("durable topology replay rejects subject-CSS additions while ordinary local topology remains supported", async () => {
    const entry = fixture().capture().libraries[0]!, map = hsonLiveMap.create(), aggregate = owner(map);
    const logicalMapId = "css-subject-topology-tail", adapter = new MemoryCheckpointAdapter();
    aggregate.setInitialHostedAuthority({ logicalMapId, incarnationId: "run" });
    await write_semantic_checkpoint(aggregate.captureSemanticCheckpoint(), adapter);
    let hosted: HostedAggregateCommit | undefined;
    const stop = aggregate.observe(commit => { hosted = commit.hosted; });
    try {
      map.replay({ kind: "map", changed: true, prevRev: 0, rev: 1, operations: [{ library: "page", operation: {
        kind: "library-add", libraries: [{ name: "page", mode: "document", schema: entry.schema, root: entry.root,
          quads: entry.quads, css: entry.css }],
      } }] });
    } finally { stop(); }
    const captured = hosted;
    assertCurrentCss(map); assert.ok(captured?.topology); assert.ok(captured.previousRegistryDigest);
    assert.throws(() => durable_aggregate_commit(captured, [{ name: "page", ownership: "shared" }]), /incremental subject-owned CSS/);
    // Model an externally supplied, structurally fenced tail bypassing the writer.
    const record: LocusHostedAggregatePersistedCommit = {
      format: "hson-locus-durable-aggregate-record", logicalMapId, incarnationId: "run", mapKind: "hosted-aggregate",
      registryDigest: captured.registryDigest, locus: { libraryOwnershipAdded: [{ name: "page", ownership: "shared" }] },
      commit: { format: "hson-livemap-durable-commit", authority: captured.authority,
        previousRegistryDigest: captured.previousRegistryDigest, registryDigest: captured.registryDigest,
        prevRev: captured.prevRev, rev: captured.rev, topology: captured.topology, operations: [] },
    };
    await adapter.appendCommit(record);
    const stored = adapter.state(logicalMapId);
    await assert.rejects(() => load(logicalMapId, { persistence: adapter }), (error: unknown) => error instanceof Error
      && "code" in error && error.code === "LOCUS_PERSISTED_STATE_INVALID" && error.cause instanceof Error
      && /Portable incremental subject-owned CSS.*unsupported/.test(error.cause.message));
    assert.deepEqual(adapter.state(logicalMapId), stored);
  });
  await check("actual Echo full recovery and contraction rebind selected CSS without disclosing private Libraries", async () => {
    const map = fixture(); map.addLibraries({ extra: { document: '<aside/>' }, hidden: { data: { PRIVATE_PART_SENTINEL: true } } });
    owner(map).restorePortableLibraries({ ...map.capture(), revision: 0 });
    const sourceQuid = assertCurrentCss(map)[0]!;
    const server = create_locus_hosted_aggregate_authority_internal({ map,
      libraries: [{ name: "page", ownership: "shared" }, { name: "extra", ownership: "shared" }, { name: "hidden", ownership: "private" }],
      defaultProjection: { libraries: ["page", "extra"] }, authorizeProjection: ({ requested }) => ({ libraries: requested.libraries }) });
    const toServer = new Set<(raw: string) => void>(), toClient = new Set<(raw: string) => void>();
    const sent: string[] = [];
    const clientSocket: LocusWebSocketLike = { send(raw) { for (const listener of toServer) listener(raw); }, close() {},
      onMessage(listener) { toClient.add(listener); return () => { toClient.delete(listener); }; }, onClose() { return () => {}; } };
    const serverSocket: LocusWebSocketLike = { send(raw) { sent.push(raw); for (const listener of toClient) listener(raw); }, close() {},
      onMessage(listener) { toServer.add(listener); return () => { toServer.delete(listener); }; }, onClose() { return () => {}; } };
    const detach = bind_locus_websocket(server, serverSocket), echo = create_echo_aggregate_client_internal({
      transport: test_echo_transport(clientSocket), logicalMapId: server.logicalMapId });
    try {
      await echo.connect(); const client = echo.map; assert.ok(client); assert.equal(echo.diagnostics().status, "live");
      const local = assertCurrentCss(client)[0]!; assert.notEqual(local, sourceQuid);
      assert.equal(owner(client).identityEpoch().issued().has(sourceQuid), false);
      assert.equal(sent.join("").includes("PRIVATE_PART_SENTINEL"), false); assert.throws(() => client.lib("hidden"));
      assertCurrentCss(install_libraries_snapshot(client.capture()).map);
      await server.stage(draft => { const selected = draft.lib("extra"); if (selected.mode !== "document") throw Error("document");
        selected.attrs.set(target(0), "title", "unrelated-live-update"); });
      assert.equal(echo.diagnostics().status, "live"); assert.equal(assertCurrentCss(client)[0], local);
      await server.sessions.updateProjection(echo.session.sessionId!, { libraries: ["page"] });
      assert.equal(echo.diagnostics().status, "live"); assert.throws(() => client.lib("extra")); assertCurrentCss(client);
      const aggregate = owner(client), registry = aggregate.hostedRegistry();
      const css = { domain: "css" as const, kind: "replace" as const,
        stylesheet: parse_document_stylesheet(`${selector(sourceQuid)}{color:red}`, []) };
      assert.throws(() => decode_portable_aggregate_commit({ format: "hson-portable-aggregate-commit",
        authority: aggregate.hostedPosition().authority, registryDigest: registry.digest,
        prevRev: 0, rev: 1, operations: [{ library: "page", domain: "css", kind: "replace", format: "hson-document-css-op", payload: JSON.stringify(css) }] },
      registry, new Map([["page", { name: "page", identity: aggregate.libraries()[0]!, mode: "document", schema: aggregate.librarySchema(aggregate.libraries()[0]!) }]])), /incremental subject-owned CSS/);
    } finally { echo.dispose(); detach(); server.dispose(); }
  });
}
