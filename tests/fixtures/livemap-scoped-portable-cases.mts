import assert from "node:assert/strict";
import { hsonLiveMap, type LiveMap } from "../../src/index.ts";
import { internal_livemap_aggregate_authority as authority } from "../../src/api/livemap/livemap.internal.ts";
import { parse_authored_document_library } from "../../src/api/livemap/livemap.document.quad.ts";
import { document_scoped_libraries_semantically_equal as equal,
  type PortableDocumentScopedLibrary } from "../../src/api/livemap/livemap.document.scoped-portable.ts";
import { document_scoped_quads_equal } from "../../src/api/livemap/livemap.document.scoped-composition.ts";
import { encode_portable_document_stylesheet as css, render_portable_document_stylesheet as render } from "../../src/internal/css/portable-document-stylesheet.ts";
import { remap_portable_document_css_identities, document_css_subject_identities } from "../../src/internal/css/css-identity-translation.ts";
import { livemap_document_identity_quids as quids } from "../../src/api/livemap/livemap.document.identity.ts";
import { validate_document_path as path } from "../../src/api/livemap/livemap.document.path.ts";
import { set_livemap_quid_candidate_source_for_tests as allocator } from "../../src/api/livemap/livemap.quid-allocation.ts";

const copy = (value: unknown) => JSON.parse(JSON.stringify(value));
function receiver() {
  const map = hsonLiveMap.fromLibraries({ page: { document: '<aside/>' }, other: { data: { n: 0 } } });
  const aggregate = authority(map), owner = aggregate.libraries()[0]!;
  return { map, aggregate, owner, restore: (input: unknown) => aggregate.prepareScopedDocumentRestoration(owner, input) };
}
function unchanged(f: { map: Pick<LiveMap, "capture" | "rev" | "commits">; aggregate: ReturnType<typeof authority> }, run: () => void) {
  const snapshot = f.map.capture(), hosted = f.aggregate.captureHosted(), checkpoint = f.aggregate.captureSemanticCheckpoint();
  const ledger = f.aggregate.identityEpoch().issued(), rev = f.map.rev; let commits = 0;
  const off = f.map.commits.observe(() => commits++);
  try { run(); } finally { off(); }
  assert.deepEqual(f.map.capture(), snapshot); assert.deepEqual(f.aggregate.captureHosted(), hosted);
  assert.deepEqual(f.aggregate.captureSemanticCheckpoint(), checkpoint);
  assert.equal(f.aggregate.identityEpoch().issued(), ledger); assert.equal(f.map.rev, rev); assert.equal(commits, 0);
}
function fixture() {
  const map = hsonLiveMap.fromLibraries({ parts: { parts: {
    leaf: { kind: "document", document: '<button @:root <span @:label "Click"/>/>',
      stylesheet: ':scope{color:blue} @supports(display:grid){[hson\\:quad="label"]{display:grid}}' },
    panel: { kind: "document", document: '<section @:root <div @:body <hson-part @:child at="leaf"/>/>/>',
      stylesheet: '@media screen{:scope{padding:3px}}' },
    global: { kind: "document", document: '<i/>',
      stylesheet: ':scope{animation:glow 1s} @keyframes glow{to{opacity:1}} @property --tone{syntax:"<color>";inherits:false;initial-value:red}' },
    empty: { kind: "document", document: '<em/>' },
  } }, page: { document: '<main/>' } });
  map.doc.must("page").css.stylesheet('main{margin:7px}');
  const aggregate = authority(map), owner = aggregate.libraries()[1]!;
  const parsed = parse_authored_document_library('<main @:_000000002 <hson-part @:left lib="parts" at="panel"/> <hson-part lib="parts" at="panel"/> <hson-part lib="parts" at="global"/> <hson-part lib="parts" at="empty"/>/>');
  let count = 0;
  allocator(aggregate.identityEpoch().owner, () => (++count).toString(36).padStart(9, "0"));
  try {
    const candidate = aggregate.prepareScopedDocument(owner, { root: parsed.root,
      quads: [...parsed.declarations, { name: "mainAlias", path: path([0]) }] });
    return { map, aggregate, owner, candidate, count };
  } finally { allocator(aggregate.identityEpoch().owner, undefined); }
}

/** The Worker receives only this portable value, never the source definitions or owner. */
export function scoped_portable_fixture_capture(): PortableDocumentScopedLibrary {
  const f = fixture(); return f.aggregate.captureScopedDocument(f.candidate);
}
export function scoped_portable_roundtrip(input: unknown): PortableDocumentScopedLibrary {
  const f = receiver();
  assert.throws(() => f.map.parts.must("parts"));
  const candidate = f.restore(input);
  assert.throws(() => Reflect.apply(f.aggregate.accept, undefined, [candidate]), /another authority/);
  const capture = f.aggregate.captureScopedDocument(candidate);
  assert.ok(equal(input, capture)); return capture;
}

export function scoped_portable_cases(check: (name: string, run: () => void) => void) {
  check("scoped Library capture is observational, stable, detached and candidate-authenticated", () => {
    const f = fixture(); let allocations = 0;
    allocator(f.aggregate.identityEpoch().owner, () => { allocations++; throw Error("capture allocated"); });
    try { unchanged(f, () => {
      const a = f.aggregate.captureScopedDocument(f.candidate), b = f.aggregate.captureScopedDocument(f.candidate);
      assert.deepEqual(a, b); assert.deepEqual(copy(a.root), copy(f.candidate.root));
      assert.notEqual(a.root, f.candidate.root);
      assert.deepEqual(Object.keys(a).sort(), ["css", "root", "scopes"]);
      assert.doesNotMatch(JSON.stringify(a.root), /quid/);
      assert.equal(a.scopes.occurrences.length, 6);
      assert.throws(() => f.aggregate.captureScopedDocument({ ...f.candidate }), /another Library/);
      assert.throws(() => receiver().aggregate.captureScopedDocument(f.candidate), /another Library/);
      a.root.$_content.length = 0;
      assert.deepEqual(f.aggregate.captureScopedDocument(f.candidate), b);
    }); } finally { allocator(f.aggregate.identityEpoch().owner, undefined); }
    assert.equal(allocations, 0);
  });
  check("source-free reconstruction deduplicates aliases and preserves nested named and unnamed occurrences", () => {
    const f = fixture(), portable = f.aggregate.captureScopedDocument(f.candidate), receiving = receiver();
    let allocated = 0;
    allocator(receiving.aggregate.identityEpoch().owner, () => `b${(++allocated).toString(36).padStart(8, "0")}`);
    try { unchanged(receiving, () => {
      const next = receiving.restore(copy(portable));
      assert.equal(next.owner, receiving.owner); assert.notEqual(next.owner, f.owner);
      assert.equal(next.scopes.occurrences.length, 6);
      assert.equal(allocated, f.count); assert.equal(next.overlay.size, f.count);
      assert.equal(next.issued.size, f.count);
      assert.equal(next.scopes.document.find(b => b.name === "mainAlias")!.quid,
        next.scopes.document.find(b => b.name === "_000000002")!.quid);
      const [panel, leaf, otherPanel, otherLeaf, global, empty] = next.scopes.occurrences;
      assert.ok(panel && leaf && otherPanel && otherLeaf && global && empty);
      assert.equal(leaf.parent, panel.lifetime); assert.equal(otherLeaf.parent, otherPanel.lifetime);
      assert.equal(panel.bindings.find(b => b.name === "child")!.quid, leaf.bindings.find(b => b.name === "root")!.quid);
      assert.equal(next.scopes.document.find(b => b.name === "left")!.quid, panel.rootQuid);
      assert.deepEqual(panel.bindings.map(b => b.name), otherPanel.bindings.map(b => b.name));
      assert.notEqual(panel.rootQuid, otherPanel.rootQuid);
      assert.deepEqual(empty.bindings, []); assert.equal(empty.parent, null);
      for (const scope of next.scopes.occurrences) assert.ok(!f.candidate.scopes.occurrences.some(old => old.lifetime === scope.lifetime));
      for (const quid of quids(next.overlay)) assert.ok(!f.candidate.issued.has(quid));
      assert.equal(document_scoped_quads_equal(next.scopes, f.candidate.scopes), false);
      assert.ok(equal(portable, receiving.aggregate.captureScopedDocument(next)));
      assert.throws(() => receiving.map.parts.must("parts"));
      assert.equal(receiving.map.doc.must("page").q("left"), undefined, "candidate is not public installed state");
    }); } finally { allocator(receiving.aggregate.identityEpoch().owner, undefined); }
  });
  check("CSS transport labels remain separate even when an authored name has identical text", () => {
    const f = fixture(), portable = f.aggregate.captureScopedDocument(f.candidate), receiving = receiver();
    const label = portable.scopes.subjects.find(s => s.name === "_000000002")!;
    assert.ok(label); assert.notDeepEqual(label.path, portable.scopes.document.find(b => b.name === label.name)!.path);
    const next = receiving.restore(portable), exported = receiving.aggregate.captureScopedDocument(next);
    assert.deepEqual(exported.scopes.document, portable.scopes.document);
    assert.deepEqual(exported.scopes.occurrences, portable.scopes.occurrences);
    const names = new Set([...next.scopes.document, ...next.scopes.occurrences.flatMap(s => s.bindings)].map(b => b.name));
    for (const subject of exported.scopes.subjects) assert.ok(!names.has(subject.name));
    assert.equal(new Set(portable.scopes.subjects.map(s => JSON.stringify(s.path))).size, portable.scopes.subjects.length);
    assert.equal(portable.scopes.subjects.length, document_css_subject_identities(portable.css, "inbound").length);
  });
  check("several local aliases of a CSS subject still demand only one receiving QUID", () => {
    const source = fixture(), portable = copy(source.aggregate.captureScopedDocument(source.candidate)), f = receiver();
    const panel = portable.scopes.occurrences[0];
    panel.bindings.push({ name: "rootAlias", kind: "element", path: panel.root });
    const next = f.restore(portable), scope = next.scopes.occurrences[0]!;
    assert.equal(scope.bindings.find(b => b.name === "root")!.quid, scope.bindings.find(b => b.name === "rootAlias")!.quid);
    assert.equal(next.overlay.size, source.count);
    assert.ok(equal(portable, f.aggregate.captureScopedDocument(next)));
  });
  check("managed CSS, ownership and supported conditions survive two independent restorations", () => {
    const original = scoped_portable_fixture_capture(), once = scoped_portable_roundtrip(copy(original)), twice = scoped_portable_roundtrip(copy(once));
    assert.ok(equal(original, once)); assert.ok(equal(once, twice)); assert.ok(equal(original, twice));
    assert.notDeepEqual(original.scopes.subjects, once.scopes.subjects);
    assert.notDeepEqual(once.scopes.subjects, twice.scopes.subjects);
    const f = receiver(), c = f.restore(twice), text = render(c.stylesheet);
    for (const token of ["@scope", "@media", "@supports", "@keyframes glow", "@property --tone", "margin:7px", "display:grid"]) assert.ok(text.includes(token), token);
    for (const subject of twice.scopes.subjects) {
      assert.ok(text.includes(c.overlay.quidAtPath(subject.path)!));
      assert.equal(text.includes(subject.name), false);
    }
    const moved = f.aggregate.prepareScopedDocumentOperations(c, [{ domain: "graph", op: "move-content", target: { kind: "path", path: path([0, 0]) }, from: 0, to: 1 }]);
    assert.deepEqual(moved.scopes.occurrences.map(s => s.lifetime), c.scopes.occurrences.map(s => s.lifetime));
    assert.deepEqual(css(moved.stylesheet), css(c.stylesheet));
    const removed = f.aggregate.prepareScopedDocumentOperations(c, [{ domain: "graph", op: "remove-content", target: { kind: "path", path: path([0, 0]) }, index: 2 }]);
    assert.equal(render(removed.stylesheet).includes("glow"), false); assert.equal(render(removed.stylesheet).includes("--tone"), false);
    assert.ok(render(removed.stylesheet).includes("margin:7px"));
  });
  check("portable equality ignores disposable labels but distinguishes authored roles, relationships, topology and CSS", () => {
    const a = scoped_portable_fixture_capture(), renamed = copy(a);
    const names = new Map<string, string>();
    renamed.scopes.subjects.forEach((subject: { name: string }, index: number) => {
      const name = `_c${index.toString(36).padStart(8, "0")}`; names.set(subject.name, name); subject.name = name;
    });
    renamed.css = remap_portable_document_css_identities(a.css, names);
    assert.ok(equal(a, renamed));
    const role = copy(a); role.scopes.document.find((b: { name: string }) => b.name === "left").kind = "element";
    assert.equal(equal(a, role), false);
    const binding = copy(a); binding.scopes.document.find((b: { name: string }) => b.name === "mainAlias").name = "newAlias";
    assert.equal(equal(a, binding), false);
    const topology = copy(a); topology.scopes.occurrences.pop();
    assert.deepEqual(topology.root, copy(a.root)); assert.equal(equal(a, topology), false);
    const graph = copy(a); graph.root.$_content[0].$_tag = "article";
    assert.equal(equal(a, graph), false);
    const styles = copy(a); styles.css.rules[0].declarations[0][1] = "8px";
    assert.equal(equal(a, styles), false);
    const relationship = copy(a), subjects = relationship.scopes.subjects;
    const labels = subjects.filter((s: { path: number[] }) => s.path.length === 9);
    assert.equal(labels.length, 2);
    [labels[0].name, labels[1].name] = [labels[1].name, labels[0].name];
    assert.equal(equal(a, relationship), false);
  });
  check("sender payload, receiving issued identities and allocation exhaustion cannot acquire authority", () => {
    const input = scoped_portable_fixture_capture(), f = receiver();
    f.aggregate.acquireLocalDocumentIdentity(f.owner, path([0]), "d00000001");
    for (const unavailable of [input.scopes.subjects[0]!.name.slice(1), "d00000001", "invalid"]) {
      allocator(f.aggregate.identityEpoch().owner, () => unavailable);
      try { unchanged(f, () => assert.throws(() => f.restore(input), /No available/)); }
      finally { allocator(f.aggregate.identityEpoch().owner, undefined); }
    }
    let calls = 0; allocator(f.aggregate.identityEpoch().owner, () => ++calls === 1 ? "d00000002" : "invalid");
    try { unchanged(f, () => assert.throws(() => f.restore(input), /No available/)); }
    finally { allocator(f.aggregate.identityEpoch().owner, undefined); }
    assert.ok(!f.aggregate.identityEpoch().issued().has("d00000002"));
  });
  check("stale capture and reentrant reconstruction preserve only independently accepted work", () => {
    const sender = fixture(), input = sender.aggregate.captureScopedDocument(sender.candidate);
    sender.aggregate.acquireLocalDocumentIdentity(sender.owner, path([0]), "d00000003");
    unchanged(sender, () => assert.throws(() => sender.aggregate.captureScopedDocument(sender.candidate), /changed during capture/));
    const f = receiver(), ledger = f.aggregate.identityEpoch().issued(), rev = f.map.rev;
    let entered = false;
    allocator(f.aggregate.identityEpoch().owner, () => {
      if (!entered) { entered = true; f.map.data.must("other").at(["n"]).set(1); }
      return "d00000004";
    });
    try { assert.throws(() => f.restore(input), /changed during capture/); }
    finally { allocator(f.aggregate.identityEpoch().owner, undefined); }
    assert.equal(f.map.rev, rev + 1); assert.equal(f.aggregate.identityEpoch().issued().size, ledger.size);
    assert.equal(f.aggregate.identityEpoch().issued().has("d00000004"), false);
    assert.equal(f.map.data.must("other").at(["n"]).snap(), 1); assert.equal(f.map.doc.must("page").css.snapshot(), "");
  });
  check("reconstruction detaches graph, scope and CSS coordinates before invoking the receiving allocator", () => {
    const original = scoped_portable_fixture_capture(), input = copy(original), f = receiver(); let calls = 0;
    allocator(f.aggregate.identityEpoch().owner, () => {
      input.root.$_content.length = 0; input.scopes.occurrences.length = 0; input.css.rules.length = 0;
      return `e${(++calls).toString(36).padStart(8, "0")}`;
    });
    try { unchanged(f, () => assert.ok(equal(original, f.aggregate.captureScopedDocument(f.restore(input))))); }
    finally { allocator(f.aggregate.identityEpoch().owner, undefined); }
    assert.ok(calls > 1);
  });
  check("restoration respects management, reservation and Library ownership fences", () => {
    const input = scoped_portable_fixture_capture(), f = receiver(), manager = {}; let calls = 0;
    allocator(f.aggregate.identityEpoch().owner, () => { calls++; return "e00000001"; });
    try { unchanged(f, () => {
      f.aggregate.claimManagement(manager);
      try { assert.throws(() => f.restore(input), /exclusive Locus/); }
      finally { f.aggregate.releaseManagement(manager); }
      const pending = f.aggregate.prepare([]), release = f.aggregate.reserve(pending);
      try { assert.throws(() => f.restore(input), /reserved/); }
      finally { release(); f.aggregate.discard(pending); }
      assert.throws(() => f.aggregate.prepareScopedDocumentRestoration(receiver().owner, input), /another map authority/);
      assert.throws(() => f.aggregate.prepareScopedDocumentRestoration(f.aggregate.libraries()[1]!, input), /document Library/);
    }); } finally { allocator(f.aggregate.identityEpoch().owner, undefined); }
    assert.equal(calls, 0);
  });
  check("reentrant portable inspection is fenced before receiving issuance", () => {
    const input = scoped_portable_fixture_capture(), f = receiver(); let calls = 0, entered = false;
    const proxy = new Proxy(input, { getOwnPropertyDescriptor(target, key) {
      if (!entered) { entered = true; f.map.data.must("other").at(["n"]).set(1); }
      return Reflect.getOwnPropertyDescriptor(target, key);
    } });
    allocator(f.aggregate.identityEpoch().owner, () => { calls++; return "e00000001"; });
    try { assert.throws(() => f.restore(proxy), /changed during capture/); }
    finally { allocator(f.aggregate.identityEpoch().owner, undefined); }
    assert.equal(calls, 0); assert.equal(f.map.rev, 1); assert.equal(f.aggregate.identityEpoch().issued().size, 0);
    assert.equal(f.map.data.must("other").at(["n"]).snap(), 1);
  });
  const malformed: readonly [string, (input: ReturnType<typeof copy>) => void][] = [
    ["invalid binding path", p => { p.scopes.occurrences[0].bindings[0].path = [999]; }],
    ["cyclic occurrence parent", p => { p.scopes.occurrences[0].parent = p.scopes.occurrences[1].root; }],
    ["invalid binding role", p => { p.scopes.document[0].kind = "transport"; }],
    ["duplicate local alias", p => { p.scopes.occurrences[0].bindings.push(p.scopes.occurrences[0].bindings[0]); }],
    ["cross-scope alias", p => { p.scopes.occurrences[0].bindings[0].path = p.scopes.occurrences[3].root; }],
    ["shared graph subject at two occurrence paths", p => { const content = p.root.$_content[0].$_content[0].$_content; content[1] = content[0]; }],
    ["cyclic graph", p => { p.root.$_content[0] = p.root; }],
    ["unresolved construction connector", p => { p.root.$_content[0].$_content[0].$_content[3].$_tag = "hson-part"; }],
    ["duplicate transport label", p => { p.scopes.subjects[1].name = p.scopes.subjects[0].name; }],
    ["duplicate transport subject", p => { p.scopes.subjects[1].path = p.scopes.subjects[0].path; }],
    ["authored transport disposition", p => { p.scopes.subjects[0].disposition = "authored"; }],
    ["unresolved CSS subject", p => { p.scopes.subjects.shift(); }],
    ["undemanded CSS subject", p => { p.scopes.subjects.unshift({ name: "_z00000001", path: [0], disposition: "disposable" }); }],
    ["invalid CSS", p => { p.css.order.push({ kind: "group", header: "invalid", entries: [] }); }],
    ["ordinary subject claiming occurrence CSS ownership", p => { p.css.order[0].owner = '[hson\\:quad="_000000002"]'; p.scopes.occurrences.shift(); p.scopes.document = p.scopes.document.filter((b: { name: string }) => b.name !== "left"); p.scopes.occurrences[0].parent = null; }],
    ["runtime QUID claim", p => { p.root.$_content[0].$_meta = { quid: "d00000001" }; }],
    ["unknown runtime authority field", p => { p.issued = []; }],
    ["accessor payload", p => { Object.defineProperty(p, "root", { enumerable: true, get() { throw Error("getter executed"); } }); }],
  ];
  for (const [name, mutate] of malformed) check(`scoped restoration rejects ${name} before allocation`, () => {
    const input = copy(scoped_portable_fixture_capture()), f = receiver(); mutate(input);
    let calls = 0; allocator(f.aggregate.identityEpoch().owner, () => { calls++; return "d00000005"; });
    try { unchanged(f, () => assert.throws(() => f.restore(input), error => error instanceof Error && error.message !== "getter executed")); }
    finally { allocator(f.aggregate.identityEpoch().owner, undefined); }
    assert.equal(calls, 0);
  });
}
