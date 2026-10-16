import { encode_exact_hson_value } from "../../src/api/livemap/livemap.document.view-state-codec.ts";
import { canonical_graph_equal } from "../../src/api/livemap/livemap.document.install.ts";
import assert from "node:assert/strict";
import { Hson, hsonLiveMap, hsonTransform } from "../../src/index.ts";
import { internal_livemap_aggregate_authority as authority } from "../../src/api/livemap/livemap.internal.ts";
import { part_collection_definition_internal as collection } from "../../src/api/livemap/livemap.parts.ts";
import { parse_authored_document_library } from "../../src/api/livemap/livemap.document.quad.ts";
import { document_scoped_libraries_semantically_equal as equal, type PortableDocumentScopedLibrary } from "../../src/api/livemap/livemap.document.scoped-portable.ts";
import { capture_document_scoped_effect, encode_document_scoped_effects } from "../../src/api/livemap/livemap.document.scoped-effects.ts";
import { prepare_document_graph_operation } from "../../src/api/livemap/livemap.document.mutation.ts";
import { make_document_scoped_quads, new_document_quad_occurrence } from "../../src/api/livemap/livemap.document.scoped-quad.ts";
import { prepare_document_scoped_library_styles, type PreparedDocumentScopedLibrary } from "../../src/api/livemap/livemap.document.scoped-library.ts";
import { assign_hson_node_quid } from "../../src/core/hson-node-quid.ts";
import { validate_document_path as path } from "../../src/api/livemap/livemap.document.path.ts";
import { set_livemap_quid_candidate_source_for_tests as allocator } from "../../src/api/livemap/livemap.quid-allocation.ts";
import { remap_portable_document_css_identities } from "../../src/internal/css/css-identity-translation.ts";
import { render_portable_document_stylesheet as render } from "../../src/internal/css/portable-document-stylesheet.ts";
import { is_Node } from "../../src/core/node-guards.ts";
import type { LiveMapGraphOp } from "../../src/types/livemap.types.ts";

const source = (text: string) => { const p = parse_authored_document_library(text); return { root: p.root, quads: p.declarations }; };
const node = (text: string) => { const value = hsonTransform.fromHson(text).toNode().$_content[0]; assert.ok(is_Node(value)); return value; };
const target = (p: readonly number[]) => ({ kind: "path" as const, path: path(p) });
const insert = (p: readonly number[], index: number, member = "panel"): LiveMapGraphOp => ({ domain: "graph", op: "insert-content", target: target(p), index,
  content: node(`<hson-part lib="parts" at="${member}"/>`) });
const replace = (p: readonly number[], index: number, member: string): LiveMapGraphOp => ({ domain: "graph", op: "replace-content", target: target(p), index,
  replacement: node(`<hson-part lib="parts" at="${member}"/>`) });
const move = (p: readonly number[], from: number, to: number): LiveMapGraphOp => ({ domain: "graph", op: "move-content", target: target(p), from, to });
const remove = (p: readonly number[], index: number): LiveMapGraphOp => ({ domain: "graph", op: "remove-content", target: target(p), index });
function sender(text = '<main <hson-part @:left lib="parts" at="panel"/> <hson-part lib="parts" at="panel"/>/>') {
  const map = hsonLiveMap.fromLibraries({ parts: collection({
    leaf: { kind: "document", document: '<b @:root <span @:label "click"/>/>', css: ':scope{color:blue} [hson\\:quad="label"]{opacity:.5}' },
    panel: { kind: "document", document: '<section @:root <div @:body <hson-part @:child at="leaf"/>/>/>', css: '@media screen{:scope{color:red}}' },
    green: { kind: "document", document: '<section @:root <div @:body <hson-part @:child at="leaf"/>/>/>', css: ':scope{color:green}' },
    plain: { kind: "document", document: '<i/>' },
    globals: { kind: "document", document: '<em @:root/>', css: ':scope{animation:pulse 1s} @keyframes pulse{to{opacity:1}} @property --tone{syntax:"<color>";inherits:false;initial-value:red}' },
  }), page: { document: '<main/>' }, other: { data: { n: 0 } } });
  const a = authority(map), owner = a.libraries()[1]!;
  map.lib("page").css.stylesheet('main{padding:7px}');
  return { map, a, owner, before: a.prepareScopedDocument(owner, source(text)) };
}
function receiver(initial: unknown) {
  const map = hsonLiveMap.fromLibraries({ page: { document: '<aside/>' }, other: { data: { n: 0 } } });
  const a = authority(map), owner = a.libraries()[0]!;
  return { map, a, owner, before: a.prepareScopedDocumentRestoration(owner, initial) };
}
const at = (c: PreparedDocumentScopedLibrary, p: readonly number[]) => {
  const result = c.scopes.occurrences.find(s => s.rootQuid === c.overlay.quidAtPath(path(p))); assert.ok(result); return result;
};
function unchanged(f: ReturnType<typeof receiver> | ReturnType<typeof sender>, run: () => void) {
  const snapshot = f.map.capture(), hosted = f.a.captureHosted(), checkpoint = f.a.captureSemanticCheckpoint(), issued = f.a.identityEpoch().issued(), rev = f.map.rev;
  let commits = 0; const off = f.map.commits.observe(() => commits++);
  try { run(); } finally { off(); }
  assert.deepEqual(f.map.capture(), snapshot); assert.deepEqual(f.a.captureHosted(), hosted);
  assert.deepEqual(f.a.captureSemanticCheckpoint(), checkpoint); assert.equal(f.a.identityEpoch().issued(), issued);
  assert.equal(f.map.rev, rev); assert.equal(commits, 0);
}
function replay(f: ReturnType<typeof sender>, operations: readonly LiveMapGraphOp[]) {
  const next = f.a.prepareScopedDocumentOperations(f.before, operations), wire = f.a.captureScopedDocumentEffects(next);
  const r = receiver(f.a.captureScopedDocument(f.before));
  let result!: PreparedDocumentScopedLibrary;
  unchanged(r, () => { result = r.a.prepareScopedDocumentEffectReplay(r.before, wire); });
  assert.ok(equal(f.a.captureScopedDocument(next), r.a.captureScopedDocument(result)));
  return { ...r, result, next, wire };
}

export function scoped_effect_fixture() {
  const f = sender();
  const operations = [insert([0, 0], 0, "globals"), move([0, 0], 0, 2), replace([0, 0], 0, "green"),
    insert([0, 0, 0, 0, 0, 0], 1, "plain"), remove([0, 0], 2)];
  const next = f.a.prepareScopedDocumentOperations(f.before, operations);
  return { initial: f.a.captureScopedDocument(f.before), effects: f.a.captureScopedDocumentEffects(next), final: f.a.captureScopedDocument(next) };
}
export function scoped_effect_receive(input: ReturnType<typeof scoped_effect_fixture>): PortableDocumentScopedLibrary {
  const f = receiver(input.initial);
  assert.throws(() => f.map.lib("parts"));
  const result = f.a.prepareScopedDocumentEffectReplay(f.before, input.effects);
  const captured = f.a.captureScopedDocument(result); assert.ok(equal(input.final, captured));
  return captured;
}

export function scoped_effect_cases(check: (name: string, run: () => void) => void) {
  check("incremental repeated nested named and unnamed Parts agree across independent runtimes", () => {
    const f = sender(), r = replay(f, [insert([0, 0], 1, "panel"), insert([0, 0], 3, "plain")]);
    assert.equal(r.result.scopes.occurrences.length, 7);
    assert.equal(at(r.result, [0, 0, 1]).bindings.find(b => b.name === "child")?.kind, "part");
    assert.equal(new Set(r.result.scopes.occurrences.map(s => s.lifetime)).size, 7);
    assert.ok(render(r.result.stylesheet).includes("padding:7px"));
    for (const scope of r.result.scopes.occurrences) assert.ok(!r.next.scopes.occurrences.some(s => s.rootQuid === scope.rootQuid));
    assert.equal(r.map.lib("page").q("middle"), undefined);
  });
  check("named connector introduction into a surviving namespace and later retirement use opposite coordinates", () => {
    const f = sender(), prepared = f.a.prepareScopedDocumentOperations(f.before, [insert([0, 0], 0, "plain")]);
    // Operation-local Library evidence seam: the graph instruction itself has
    // no namespace fields. Public named-operation authoring stays out of scope.
    const next = { ...prepared, scopes: make_document_scoped_quads(prepared,
      [...prepared.scopes.document, { name: "introduced", kind: "part", quid: at(prepared, [0, 0, 0]).rootQuid }], prepared.scopes.occurrences) };
    const step = prepared.steps[0]!;
    const effect = capture_document_scoped_effect(f.before, next, step.operation, step.styles, 0);
    assert.deepEqual(effect.added.map(entry => entry.binding.path), [[0, 0, 0]]);
    const initial = f.a.captureScopedDocument(f.before), r = receiver(initial), peer = receiver(initial);
    const wire = encode_document_scoped_effects([effect]);
    const result = r.a.prepareScopedDocumentEffectReplay(r.before, wire), other = peer.a.prepareScopedDocumentEffectReplay(peer.before, wire);
    assert.equal(result.scopes.document.find(binding => binding.name === "introduced")?.kind, "part");
    const retired = r.a.prepareScopedDocumentOperations(result, [move([0, 0], 0, 2), remove([0, 0], 2)]);
    const effects = r.a.captureScopedDocumentEffects(retired);
    assert.deepEqual(JSON.parse(effects).effects[1].removed[0].binding.path, [0, 0, 2]);
    const received = peer.a.prepareScopedDocumentEffectReplay(other, effects);
    assert.ok(equal(r.a.captureScopedDocument(retired), peer.a.captureScopedDocument(received)));
    assert.equal(received.scopes.document.some(binding => binding.name === "introduced"), false);
  });
  check("movement preserves occurrence lifetimes and CSS ownership", () => {
    const f = sender(), r = replay(f, [move([0, 0], 0, 1)]);
    assert.equal(at(r.result, [0, 0, 1]).lifetime, at(r.before, [0, 0, 0]).lifetime);
    assert.equal(render(r.result.stylesheet), render(r.before.stylesheet));
    const effect = JSON.parse(r.wire).effects[0];
    assert.deepEqual(effect.created, []); assert.deepEqual(effect.retired, []);
  });
  check("named connector retirement and graph-equivalent replacement remain meaningful", () => {
    const f = sender(), r = replay(f, [replace([0, 0], 0, "green")]);
    assert.ok(canonical_graph_equal(r.result.root, r.before.root)); assert.equal(r.result.changed, true);
    assert.notEqual(at(r.result, [0, 0, 0]).lifetime, at(r.before, [0, 0, 0]).lifetime);
    assert.equal(r.result.scopes.document.some(b => b.name === "left"), false);
    assert.ok(render(r.result.stylesheet).includes("green"));
    const e = JSON.parse(r.wire).effects[0]; assert.equal(e.retired.length, 2); assert.equal(e.created.length, 2);
  });
  check("identical graph, names and CSS still retire and recreate occurrence lifetime", () => {
    const f = sender('<hson-part lib="parts" at="leaf"/>'), r = replay(f, [replace([], 0, "leaf")]);
    assert.ok(equal(f.a.captureScopedDocument(f.before), f.a.captureScopedDocument(r.next)));
    assert.notEqual(at(r.result, [0]).lifetime, at(r.before, [0]).lifetime);
    const e = JSON.parse(r.wire).effects[0]; assert.equal(e.before, e.after); assert.ok(e.retired.length); assert.ok(r.result.changed);
  });
  check("successive coordinates carry insertion, movement, replacement and nested insertion", () => {
    const input = scoped_effect_fixture(); scoped_effect_receive(input);
    const effects = JSON.parse(input.effects).effects;
    assert.deepEqual(effects.map((e: { ordinal: number }) => e.ordinal), [0, 1, 2, 3, 4]);
    assert.deepEqual(effects[0].created[0].root, [0, 0, 0]);
    assert.deepEqual(effects[4].retired[0].root, [0, 0, 2]);
    assert.equal(effects.some((e: object) => Object.hasOwn(e, "root") || Object.hasOwn(e, "scopes") || Object.hasOwn(e, "snapshot")), false);
  });
  check("later private operations continue from a replayed candidate", () => {
    const f = sender(), r = replay(f, [insert([0, 0], 0, "plain")]);
    const sourceNext = f.a.prepareScopedDocumentOperations(r.next, [move([0, 0], 0, 2)]);
    const result = r.a.prepareScopedDocumentEffectReplay(r.result, f.a.captureScopedDocumentEffects(sourceNext));
    assert.ok(equal(f.a.captureScopedDocument(sourceNext), r.a.captureScopedDocument(result)));
  });
  check("independent label renaming preserves complete CSS correspondence without receiving identity claims", () => {
    const f = sender(), next = f.a.prepareScopedDocumentOperations(f.before, [insert([0, 0], 0, "globals")]);
    const wire = JSON.parse(f.a.captureScopedDocumentEffects(next));
    let ordinal = 0; const labels = new Set<string>();
    for (const e of wire.effects) for (const style of e.styles) {
      const names = new Map<string, string>();
      for (const subject of style.subjects) { const label = `_z${(++ordinal).toString(36).padStart(8, "0")}`; names.set(subject.name, label); labels.add(label.slice(1)); subject.name = label; }
      style.css = remap_portable_document_css_identities(style.css, names);
    }
    const r = receiver(f.a.captureScopedDocument(f.before)); let calls = 0;
    allocator(r.a.identityEpoch().owner, () => calls++ === 0 ? [...labels][0]! : `y${calls.toString(36).padStart(8, "0")}`);
    try {
      const result = r.a.prepareScopedDocumentEffectReplay(r.before, JSON.stringify(wire));
      assert.ok(equal(f.a.captureScopedDocument(next), r.a.captureScopedDocument(result)));
      for (const label of labels) assert.equal(result.issued.has(label), false);
      const text = render(result.stylesheet); for (const token of ["@keyframes pulse", "@property --tone", "animation:pulse"]) assert.ok(text.includes(token));
    } finally { allocator(r.a.identityEpoch().owner, undefined); }
  });
  check("internal automatic replacement correspondence preserves root QUID but retires scope and complete owned CSS", () => {
    const f = sender('<hson-part lib="parts" at="globals"/>'), old = at(f.before, [0]);
    const replacement = node('<em/>'); assign_hson_node_quid(replacement, old.rootQuid);
    // Same-runtime exact evidence only, never caller-authored lineage.
    const planned = prepare_document_graph_operation(f.before.root, "document", { domain: "graph", op: "replace-content", target: target([]), index: 0, replacement }, f.before.overlay);
    const context = { ...f.before, root: planned.root, overlay: planned.overlay };
    const scopes = make_document_scoped_quads(context, [], [{ ...old, lifetime: new_document_quad_occurrence(f.owner) }]);
    const candidate = prepare_document_scoped_library_styles({ ...context, scopes, steps: [{ operation: planned.operation, context, scopes, styles: [] }], initialStyles: [] }, f.before.stylesheet, f.before);
    const effect = capture_document_scoped_effect(f.before, candidate, planned.operation, [], 0);
    const r = receiver(f.a.captureScopedDocument(f.before)), local = at(r.before, [0]);
    const result = r.a.prepareScopedDocumentEffectReplay(r.before, encode_document_scoped_effects([effect]));
    assert.equal(at(result, [0]).rootQuid, local.rootQuid); assert.notEqual(at(result, [0]).lifetime, local.lifetime);
    assert.equal(render(result.stylesheet).includes("pulse"), false); assert.equal(render(result.stylesheet).includes("--tone"), false);
    assert.equal(result.issued.size, r.before.issued.size);
  });
  const malformed: readonly [string, (wire: any) => void][] = [
    ["truncated batch", w => w.effects.pop()],
    ["reordered batch", w => w.effects.reverse()],
    ["duplicated operation", w => w.effects.splice(1, 0, w.effects[0])],
    ["stale precondition", w => w.effects[0].before = "0".repeat(64)],
    ["missing scope retirement", w => w.effects[2].retired = []],
    ["forged namespace binding", w => w.effects[0].created[0].bindings[0].path = [0]],
    ["invalid later graph after valid prefix", w => { const op = JSON.parse(w.effects[4].graph); op.index = 999; w.effects[4].graph = JSON.stringify(op); }],
    ["forged postcondition after valid prefix", w => w.effects[4].after = "0".repeat(64)],
    ["missing CSS subject", w => w.effects[0].styles[0].subjects = []],
    ["duplicated CSS subject", w => w.effects[0].styles[0].subjects.push(w.effects[0].styles[0].subjects[0])],
    ["missing CSS contribution", w => w.effects[0].styles = []],
    ["mismatched CSS label", w => w.effects[0].styles[0].subjects[0].name = "_x00000001"],
    ["forged occurrence parent", w => w.effects[0].created[0].parent = [0]],
    ["generated graph identity claim", w => { const op = JSON.parse(w.effects[0].graph), content = node('<em/>'); assign_hson_node_quid(content, "x00000001"); op.content = encode_exact_hson_value(content); w.effects[0].graph = JSON.stringify(op); }],
    ["runtime witness", w => { const op = JSON.parse(w.effects[0].graph); op.target.witness = "a00000001"; w.effects[0].graph = JSON.stringify(op); }],
    ["forged receiving ledger", w => w.effects[0].issued = ["a00000001"]],
    ["full snapshot substitute", w => { w.effects[0].snapshot = {}; delete w.effects[0].created; }],
  ];
  for (const [name, mutate] of malformed) check(`rejects ${name} before any allocation or publication`, () => {
    const input = scoped_effect_fixture(), wire = JSON.parse(input.effects); mutate(wire);
    const r = receiver(input.initial); let calls = 0;
    allocator(r.a.identityEpoch().owner, () => { calls++; return "y00000001"; });
    try { unchanged(r, () => assert.throws(() => r.a.prepareScopedDocumentEffectReplay(r.before, JSON.stringify(wire)))); }
    finally { allocator(r.a.identityEpoch().owner, undefined); }
    assert.equal(calls, 0);
  });
  check("noncanonical retirement coordinates and ordinals reject before issuance", () => {
    const input = scoped_effect_fixture(), r = receiver(input.initial); let calls = 0;
    allocator(r.a.identityEpoch().owner, () => { calls++; return "y00000001"; });
    try {
      assert.throws(() => r.a.prepareScopedDocumentEffectReplay(r.before, input.effects.replace('"ordinal":0', '"ordinal":-0')));
      assert.throws(() => r.a.prepareScopedDocumentEffectReplay(r.before, input.effects.replace('"retired":[{"root":[0,', '"retired":[{"root":[-0,')));
    } finally { allocator(r.a.identityEpoch().owner, undefined); }
    assert.equal(calls, 0);
  });
  check("mismatched, forged and foreign receiving candidates reject", () => {
    const f = sender(), next = f.a.prepareScopedDocumentOperations(f.before, [insert([0, 0], 0)]), wire = f.a.captureScopedDocumentEffects(next);
    const r = receiver(f.a.captureScopedDocument(f.before));
    assert.throws(() => r.a.prepareScopedDocumentEffectReplay({ ...r.before }, wire), /another Library/);
    assert.throws(() => r.a.prepareScopedDocumentEffectReplay(f.before, wire), /another Library/);
    const changed = r.a.prepareScopedDocumentOperations(r.before, [remove([0, 0], 0)]);
    assert.throws(() => r.a.prepareScopedDocumentEffectReplay(changed, wire), /stale|mismatched/);
    const result = r.a.prepareScopedDocumentEffectReplay(r.before, wire);
    assert.throws(() => r.a.prepareScopedDocumentEffectReplay(result, wire), /stale|mismatched/);
    assert.throws(() => Reflect.apply(r.a.accept, undefined, [result]), /another authority/);
  });
  check("stale fences, management and reservations reject before identity allocation", () => {
    const input = scoped_effect_fixture();
    for (const mode of ["stale", "managed", "reserved"]) {
      const r = receiver(input.initial); let calls = 0; let cleanup = () => {};
      if (mode === "stale") r.map.lib("other").at(["n"]).set(1);
      if (mode === "managed") { const owner = {}; r.a.claimManagement(owner); cleanup = () => r.a.releaseManagement(owner); }
      if (mode === "reserved") { const candidate = r.a.prepare([]), release = r.a.reserve(candidate); cleanup = () => { release(); r.a.discard(candidate); }; }
      allocator(r.a.identityEpoch().owner, () => { calls++; return "y00000001"; });
      try { unchanged(r, () => assert.throws(() => r.a.prepareScopedDocumentEffectReplay(r.before, input.effects))); }
      finally { allocator(r.a.identityEpoch().owner, undefined); cleanup(); }
      assert.equal(calls, 0);
    }
  });
  check("reentrant issuance rejects the batch while preserving independently accepted work", () => {
    const input = scoped_effect_fixture(), r = receiver(input.initial), issued = r.a.identityEpoch().issued(), snapshot = r.map.lib("page").root();
    allocator(r.a.identityEpoch().owner, () => { r.map.lib("other").at(["n"]).set(1); return "y00000001"; });
    try { assert.throws(() => r.a.prepareScopedDocumentEffectReplay(r.before, input.effects), /changed/); }
    finally { allocator(r.a.identityEpoch().owner, undefined); }
    assert.equal(r.a.identityEpoch().issued().size, issued.size); assert.equal(r.a.identityEpoch().issued().has("y00000001"), false); assert.deepEqual(r.map.lib("page").root(), snapshot);
    assert.equal(r.map.lib("other").at(["n"]).snap(), 1);
  });
  check("schema validates the completed batch before issuance, allowing transient intermediate graphs", () => {
    const f = sender('<main/>'), first = replace([], 0, "plain");
    const schema = Hson.schema`<type "document" tag "main">`;
    const map = hsonLiveMap.fromLibraries({ page: { document: '<main/>', schema } });
    const a = authority(map), owner = a.libraries()[0]!;
    const before = a.prepareScopedDocumentRestoration(owner, f.a.captureScopedDocument(f.before));
    const next = f.a.prepareScopedDocumentOperations(f.before, [first, { domain: "graph", op: "replace-content", target: target([]), index: 0, replacement: node('<main/>') }]);
    const result = a.prepareScopedDocumentEffectReplay(before, f.a.captureScopedDocumentEffects(next));
    assert.ok(equal(f.a.captureScopedDocument(next), a.captureScopedDocument(result)));
    const invalid = f.a.prepareScopedDocumentOperations(f.before, [first]);
    let calls = 0; allocator(a.identityEpoch().owner, () => { calls++; return "y00000001"; });
    try { assert.throws(() => a.prepareScopedDocumentEffectReplay(before, f.a.captureScopedDocumentEffects(invalid))); }
    finally { allocator(a.identityEpoch().owner, undefined); }
    assert.equal(calls, 0); assert.equal(a.identityEpoch().issued().size, 0);
  });
  check("semantic no-op operation preserves changed=false and issues no identity", () => {
    const f = sender(), r = replay(f, [move([0, 0], 0, 0)]);
    assert.equal(r.result.changed, false); assert.equal(r.result.issued.size, r.before.issued.size);
    assert.equal(at(r.result, [0, 0, 0]).lifetime, at(r.before, [0, 0, 0]).lifetime);
  });
  check("initial captures cannot substitute for missing incremental evidence", () => {
    const f = sender(), r = receiver(f.a.captureScopedDocument(f.before));
    assert.throws(() => f.a.captureScopedDocumentEffects(f.before), /no incremental/);
    assert.throws(() => r.a.captureScopedDocumentEffects(r.before), /no incremental/);
    assert.throws(() => r.a.prepareScopedDocumentEffectReplay(r.before, JSON.stringify(f.a.captureScopedDocument(f.before))));
  });
  check("empty batch has no effects and does not allocate", () => {
    const f = sender(), r = receiver(f.a.captureScopedDocument(f.before)); let calls = 0;
    allocator(r.a.identityEpoch().owner, () => { calls++; return "y00000001"; });
    try { const result = r.a.prepareScopedDocumentEffectReplay(r.before, encode_document_scoped_effects([])); assert.equal(result.changed, false); assert.equal(result.scopes, r.before.scopes); }
    finally { allocator(r.a.identityEpoch().owner, undefined); }
    assert.equal(calls, 0);
  });
}
