import assert from "node:assert/strict";
import { hsonLiveMap, hsonTransform } from "../../src/index.ts";
import { internal_livemap_aggregate_authority } from "../../src/api/livemap/livemap.internal.ts";
import { read_livemap_part_internal as readPart } from "../../src/api/livemap/livemap.libraries.ts";
import { parse_authored_document_library } from "../../src/api/livemap/livemap.document.quad.ts";
import { expand_document_composition, document_composition_options } from "../../src/api/livemap/livemap.document.composition.ts";
import { prepare_document_scoped_composition as initial, prepare_document_scoped_operations as prepare,
  type DocumentScopedCompositionAuthority, type PreparedDocumentScopedComposition } from "../../src/api/livemap/livemap.document.scoped-composition.ts";
import { encode_document_scoped_quads as encode, make_document_scoped_quads as make } from "../../src/api/livemap/livemap.document.scoped-quad.ts";
import { build_livemap_document_identity_overlay, livemap_document_identity_overlay_equal } from "../../src/api/livemap/livemap.document.identity.ts";
import { validate_document_path as path, resolve_document_path } from "../../src/api/livemap/livemap.document.path.ts";
import { set_livemap_quid_candidate_source_for_tests as allocator } from "../../src/api/livemap/livemap.quid-allocation.ts";
import { canonical_graph_equal } from "../../src/api/livemap/livemap.document.install.ts";
import { is_Node } from "../../src/core/node-guards.ts";
import type { LiveMapGraphOp } from "../../src/types/livemap.types.ts";

const part = (document: string, css?: string) => ({ kind: "document" as const, document, ...(css === undefined ? {} : { css }) });
const parts = {
  panel: part('<section @:root <div @:body <button @:next/> <hson-part @:child at="inner"/>/>/>'),
  inner: part('<article @:root <hson-part @:child at="leaf"/>/>'),
  leaf: part('<b @:root/>'),
  holder: part('<section @:root <b @:slot/>/>'),
  blank: part('<span/>'),
  styled: part('<aside @:root <hson-part @:child at="leaf"/>/>', '[hson\\:quad="child"]{color:blue}'),
};
const shell = '<main @:page <hson-part @:left lib="parts" at="panel"/> <hson-part lib="parts" at="panel"/> <footer @:tail/>/>';
const source = (text: string) => {
  const parsed = parse_authored_document_library(text);
  return { root: parsed.root, quads: parsed.declarations };
};
const connector = (at: string) => {
  const node = hsonTransform.fromHson(`<hson-part lib="parts" at="${at}"/>`).toNode().$_content[0];
  assert.ok(is_Node(node)); return node;
};
const target = (coordinate: readonly number[]) => ({ kind: "path" as const, path: path(coordinate) });
const insert = (coordinate: readonly number[], index: number, member = "panel"): LiveMapGraphOp =>
  ({ domain: "graph", op: "insert-content", target: target(coordinate), index, content: connector(member) });
const remove = (coordinate: readonly number[], index: number): LiveMapGraphOp =>
  ({ domain: "graph", op: "remove-content", target: target(coordinate), index });
const replace = (coordinate: readonly number[], index: number, member = "panel"): LiveMapGraphOp =>
  ({ domain: "graph", op: "replace-content", target: target(coordinate), index, replacement: connector(member) });

function fixture(text = shell) {
  const map = hsonLiveMap.fromLibraries({ parts: { parts: parts }, state: { data: { n: 0 } },
    page: { document: '<main/>' }, unrelated: { document: '<aside @:other/>' } });
  const unrelated = map.doc.must("unrelated");
  if (unrelated.mode !== "document") throw Error("Expected document Library.");
  unrelated.css.stylesheet("aside{color:red}");
  const data = map.data.must("state"), definitions = map.parts.must("parts");
  const aggregate = internal_livemap_aggregate_authority(map), owner = aggregate.libraries()[2]!;
  const authority = (): DocumentScopedCompositionAuthority => ({ identityOwner: aggregate.identityEpoch().owner,
    assertCurrent: aggregate.captureFence(), readPart: (lib, at) => readPart(map, lib, at) });
  const constructionAuthority = authority();
  const composed = expand_document_composition("shell", () => source(text), document_composition_options(undefined), constructionAuthority.readPart);
  const context = { owner, root: composed.root, overlay: build_livemap_document_identity_overlay(composed.root, "document"), issued: aggregate.identityEpoch().issued() };
  let allocations = 0;
  const run = <T,>(job: () => T): T => {
    allocator(aggregate.identityEpoch().owner, () => `c${String(allocations++).padStart(8, "0")}`);
    try { return job(); } finally { allocator(aggregate.identityEpoch().owner, undefined); }
  };
  const candidate = run(() => initial(context, composed, constructionAuthority));
  const next = (base: PreparedDocumentScopedComposition, operations: readonly LiveMapGraphOp[]) => run(() => prepare(base, base.scopes, operations, authority()));
  return { map, data, definitions, aggregate, owner, context, composed, candidate, authority, next, run, allocations: () => allocations };
}
function at(candidate: PreparedDocumentScopedComposition, coordinate: readonly number[]) {
  const quid = candidate.overlay.quidAtPath(path(coordinate)); assert.ok(quid);
  const scope = candidate.scopes.occurrences.find(scope => scope.rootQuid === quid); assert.ok(scope); return scope;
}
function location(candidate: PreparedDocumentScopedComposition, quid: string) {
  const result = candidate.overlay.pathForQuid(quid); assert.ok(result); return result;
}
function unchanged(f: ReturnType<typeof fixture>, run: () => void) {
  const capture = f.map.capture(), ledger = f.aggregate.identityEpoch().issued(), registry = f.aggregate.hostedRegistry();
  const root = f.candidate.root, scopes = f.candidate.scopes, overlay = f.candidate.overlay;
  const graph = JSON.stringify(root), associations = encode(scopes, f.candidate, []), issued = f.candidate.issued;
  let commits = 0;
  const off = f.map.commits.observe(() => commits++);
  try { run(); } finally { off(); }
  assert.deepEqual(f.map.capture(), capture); assert.equal(f.aggregate.identityEpoch().issued(), ledger);
  assert.equal(f.aggregate.hostedRegistry(), registry); assert.equal(commits, 0);
  assert.equal(f.candidate.root, root); assert.equal(f.candidate.scopes, scopes); assert.equal(f.candidate.overlay, overlay);
  assert.equal(JSON.stringify(root), graph); assert.deepEqual(encode(scopes, f.candidate, []), associations);
  assert.equal(f.candidate.issued, issued);
}

export function scoped_composition_cases(check: (name: string, run: () => void) => void) {

  for (const nested of [false, true]) check(`${nested ? "occurrence" : "document"} destructive replacement retires the ordinary slot binding`, () => {
    const f = fixture(nested
      ? '<main <hson-part lib="parts" at="holder"/> <hson-part lib="parts" at="holder"/>/>'
      : '<main <b @:slot/>/>');
    const before = f.candidate, coordinate = nested ? [0, 0, 0, 0, 0] : [0, 0, 0];
    const oldQuid = before.overlay.quidAtPath(path(coordinate))!;
    unchanged(f, () => {
      const next = f.next(before, [{ domain: "graph", op: "replace-content", target: target(coordinate.slice(0, -1)),
        index: 0, replacement: connector("leaf") }]);
      const bindings = nested ? at(next, [0, 0, 0]).bindings : next.scopes.document;
      assert.equal(bindings.some(binding => binding.name === "slot"), false);
      assert.equal(next.overlay.pathForQuid(oldQuid), undefined);
      assert.notEqual(at(next, coordinate).rootQuid, oldQuid);
      assert.equal(next.issued.has(oldQuid), true);
      if (nested) {
        assert.equal(at(next, [0, 0, 0]).lifetime, at(before, [0, 0, 0]).lifetime);
        assert.deepEqual(at(next, [0, 0, 1]), at(before, [0, 0, 1]));
      }
    });
  });

  check("rejection after retained-slot replacement and styled insertion publishes no partial effects", () => {
    const f = fixture('<main <b @:slot/>/>'), before = f.candidate;
    unchanged(f, () => {
      const authority = f.authority();
      assert.throws(() => f.run(() => prepare(before, before.scopes, [replace([0, 0], 0, "leaf"),
        insert([0, 0], 1, "styled"), insert([0, 0], 2, "broken")], { ...authority, readPart: (lib, at) => {
          if (at !== "broken") return authority.readPart(lib, at);
          const selected = source('<b @:root/>');
          return { ...selected, quads: [...selected.quads, ...selected.quads] };
        } })), /landmark/);
      assert.equal(before.scopes.occurrences.length, 0);
      assert.equal(before.scopes.document.find(binding => binding.name === "slot")!.kind, "element");
    });
  });
  check("identical named and unnamed Parts retain local names at three depths with independent materialization", () => {
    const f = fixture(), { candidate: c, composed } = f;
    assert.equal(c.scopes.occurrences.length, 6);
    assert.deepEqual(composed.quads?.map(binding => binding.name), ["left", "page", "tail"], "committed public flat behavior stays intact");
    assert.deepEqual(composed.scoped.document.map(binding => binding.name), ["left", "page", "tail"]);
    const left = at(c, [0, 0, 0]), right = at(c, [0, 0, 1]);
    assert.notEqual(left.lifetime, right.lifetime); assert.notEqual(left.rootQuid, right.rootQuid);
    assert.deepEqual(left.bindings.map(binding => binding.name), ["body", "child", "next", "root"]);
    assert.deepEqual(left.bindings.map(binding => binding.name), right.bindings.map(binding => binding.name));
    assert.equal(left.parent, null); assert.equal(right.parent, null);
    const child = c.scopes.occurrences.find(scope => scope.parent === left.lifetime)!;
    assert.ok(child); assert.equal(c.scopes.occurrences.filter(scope => scope.parent === child.lifetime).length, 1);
    assert.equal(left.bindings.find(binding => binding.name === "child")!.quid, child.rootQuid);
    assert.equal(child.bindings.find(binding => binding.name === "root")!.quid, child.rootQuid);
    assert.equal(c.scopes.document.find(binding => binding.name === "left")!.quid, left.rootQuid);
    assert.equal(f.allocations(), 12, "logical aliases and occurrence roots demand each subject once");
    assert.equal(c.overlay.size, composed.identityDemands.length);
    assert.notEqual(resolve_document_path(c.root, "document", path([0, 0, 0])), resolve_document_path(c.root, "document", path([0, 0, 1])));
    assert.equal(JSON.stringify(c.scopes).includes('"path"'), false);
    assert.equal(JSON.stringify(c.scopes).includes('"collection"'), false);
    const record = encode(c.scopes, c, []); assert.equal(record.subjects.length, 0);
  });
  check("ordinary ancestry produces peer bindings, and repeated definitions outlive source changes", () => {
    const f = fixture(), c = f.candidate, before = encode(c.scopes, c, []);
    const left = at(c, [0, 0, 0]);
    assert.equal(left.bindings.find(binding => binding.name === "body")!.kind, "element");
    assert.equal(left.bindings.find(binding => binding.name === "next")!.kind, "element");
    assert.equal(c.scopes.occurrences.some(scope => scope.rootQuid === left.bindings.find(binding => binding.name === "body")!.quid), false);
    f.definitions.at(["leaf", "document"]).set('<strong @:changed/>');
    assert.deepEqual(encode(c.scopes, c, []), before);
  });
  check("same-scope duplicate and invalid binding rejection precedes identity allocation", () => {
    const f = fixture(); let calls = 0;
    allocator(f.aggregate.identityEpoch().owner, () => { calls++; return "d00000000"; });
    try { unchanged(f, () => {
      const first = f.composed.scoped.occurrences[0]!;
      for (const binding of [first.bindings[0]!, { name: "bad", kind: "element" as const, path: path([99]) }]) {
        const bad = { ...f.composed, scoped: { ...f.composed.scoped, occurrences:
          [{ ...first, bindings: [...first.bindings, binding] }, ...f.composed.scoped.occurrences.slice(1)] } };
        assert.throws(() => initial(f.context, bad, f.authority()));
      }
      const duplicate = source('<div <button/> <button/>/>');
      assert.throws(() => expand_document_composition("shell", () => ({ ...duplicate,
        quads: [{ name: "same", path: path([0, 0, 0]) }, { name: "same", path: path([0, 0, 1]) }] }),
      document_composition_options(undefined), f.authority().readPart), /landmark/);
    }); } finally { allocator(f.aggregate.identityEpoch().owner, undefined); }
    assert.equal(calls, 0);
  });
  check("movement preserves every occurrence lifetime and remaps final coordinates", () => {
    const f = fixture(), before = f.candidate;
    const moved = f.next(before, [{ domain: "graph", op: "move-content", target: target([0, 0]), from: 0, to: 1 }]);
    const left = at(before, [0, 0, 0]);
    assert.equal(at(moved, [0, 0, 1]).lifetime, left.lifetime);
    assert.deepEqual(new Set(moved.scopes.occurrences.map(scope => scope.lifetime)), new Set(before.scopes.occurrences.map(scope => scope.lifetime)));
    assert.ok(moved.identityEffects.some(effect => effect.kind === "moved"));
    assert.equal(f.allocations(), 12);
    const inserted = f.next(moved, [insert([0, 0, 1, 0, 0, 0], 0, "leaf")]);
    assert.equal(at(inserted, [0, 0, 1, 0, 0, 0, 0]).parent, left.lifetime, "ownership uses moved registered boundary");
  });
  check("subject removal keeps its occurrence; occurrence removal retires descendants and incoming names", () => {
    const f = fixture(), before = f.candidate, left = at(before, [0, 0, 0]);
    const removed = f.next(before, [remove([0, 0, 0, 0, 0, 0], 0)]);
    assert.equal(removed.scopes.occurrences.length, 6);
    assert.equal(at(removed, [0, 0, 0]).lifetime, left.lifetime);
    assert.equal(at(removed, [0, 0, 0]).bindings.some(binding => binding.name === "next"), false);
    const retired = f.next(removed, [remove([0, 0], 0)]);
    assert.equal(retired.scopes.occurrences.length, 3);
    assert.equal(retired.scopes.document.some(binding => binding.name === "left"), false);
    assert.equal(at(retired, [0, 0, 0]).lifetime, at(before, [0, 0, 1]).lifetime);
    assert.equal(retired.issued.size, before.issued.size, "retirement retains the issued ledger");
  });
  check("replacement retires root identity, old namespace and descendants", () => {
    const f = fixture(), before = f.candidate, old = at(before, [0, 0, 0]);
    const replaced = f.next(before, [replace([0, 0], 0, "inner")]), fresh = at(replaced, [0, 0, 0]);
    assert.notEqual(fresh.rootQuid, old.rootQuid);
    assert.equal(replaced.overlay.pathForQuid(old.rootQuid), undefined); assert.notEqual(fresh.lifetime, old.lifetime);
    assert.equal(fresh.parent, null); assert.equal(replaced.scopes.document.some(binding => binding.name === "left"), false);
    const oldChildren = new Set(before.scopes.occurrences.slice(0, 3).map(scope => scope.lifetime));
    assert.equal(replaced.scopes.occurrences.some(scope => oldChildren.has(scope.lifetime)), false);
    assert.equal(at(replaced, [0, 0, 1]).lifetime, at(before, [0, 0, 1]).lifetime);
    assert.equal(replaced.scopes.occurrences.length, 5);
  });
  check("graph-equivalent replacement retires identity and creates a fresh occurrence", () => {
    const f = fixture('<hson-part lib="parts" at="leaf"/>'), before = f.candidate;
    const replaced = f.next(before, [replace([], 0, "leaf")]);
    assert.equal(canonical_graph_equal(before.root, replaced.root), true);
    assert.equal(livemap_document_identity_overlay_equal(before.overlay, replaced.overlay), false);
    assert.deepEqual(encode(before.scopes, before, []), encode(replaced.scopes, replaced, []));
    assert.equal(replaced.changed, true);
    assert.notEqual(replaced.scopes.occurrences[0]!.lifetime, before.scopes.occurrences[0]!.lifetime);
    assert.equal(f.allocations(), 2);
  });
  check("ordinary graph-equivalent replacement retires an occurrence without inventing a new one", () => {
    const f = fixture('<hson-part lib="parts" at="leaf"/>'), before = f.candidate;
    const replaced = f.next(before, [{ domain: "graph", op: "replace-content", target: target([]), index: 0,
      replacement: { $_tag: "b", $_content: [] } }]);
    assert.equal(replaced.changed, true); assert.equal(replaced.scopes.occurrences.length, 0);
    assert.equal(replaced.overlay.quidAtPath(path([0])), undefined);
    assert.equal(replaced.overlay.pathForQuid(before.overlay.quidAtPath(path([0]))!), undefined);
  });
  check("later nested insertion belongs to the existing boundary, not an ordinary named ancestor", () => {
    const f = fixture(), before = f.candidate, left = at(before, [0, 0, 0]);
    const next = f.next(before, [insert([0, 0, 0, 0, 0, 0], 1)]);
    const newPanel = at(next, [0, 0, 0, 0, 0, 0, 1]);
    assert.equal(newPanel.parent, left.lifetime);
    assert.equal(next.scopes.occurrences.length, 9);
    assert.equal(at(next, [0, 0, 0]).lifetime, left.lifetime);
    assert.equal(next.scopes.document.length, before.scopes.document.length);
    assert.equal(at(next, [0, 0, 1]).lifetime, at(before, [0, 0, 1]).lifetime);
  });
  check("multiple prepared operations use preceding boundaries and preserve operation-local style coordinates", () => {
    const f = fixture('<main <i/>/>'), before = f.candidate;
    const next = f.next(before, [insert([0, 0], 0, "styled"), insert([0, 0, 0, 0], 0, "leaf"),
      { domain: "graph", op: "move-content", target: target([0, 0]), from: 0, to: 1 }]);
    assert.equal(next.steps.length, 3); assert.equal(next.steps[0]!.styles.length, 1);
    const root = at(next, [0, 0, 1]);
    assert.equal(next.scopes.occurrences.filter(scope => scope.parent === root.lifetime).length, 2);
    assert.equal(next.steps[0]!.scopes.occurrences[0]!.lifetime, root.lifetime);
    assert.equal(at({ ...next, ...next.steps[1]!.context, scopes: next.steps[1]!.scopes }, [0, 0, 0, 0, 0]).parent, root.lifetime);
    assert.ok(next.steps[0]!.styles[0]!.subjects.every(subject => subject.path[2] === 0));
    assert.equal(next.scopes.occurrences.length, 3);
  });
  check("allocation exhaustion and a failing later operation discard the complete private candidate", () => {
    const f = fixture(), before = f.candidate;
    unchanged(f, () => {
      allocator(f.aggregate.identityEpoch().owner, () => "invalid");
      try { assert.throws(() => prepare(before, before.scopes, [insert([0, 0], 0)], f.authority()), /No available/); }
      finally { allocator(f.aggregate.identityEpoch().owner, undefined); }
      assert.throws(() => f.next(before, [insert([0, 0], 0), remove([0, 0], 99)]));
    });
    assert.equal(before.scopes.occurrences.length, 6);
    const retry = f.next(before, [insert([0, 0], 0)]); assert.equal(retry.scopes.occurrences.length, 9);
  });
  check("reentrant allocation and source changes reject while preserving independently accepted inner work", () => {
    for (const during of ["allocation", "source"]) {
      const f = fixture(), before = f.candidate, authority = f.authority();
      let entered = false, accepted = f.map.capture(), acceptedLedger = f.aggregate.identityEpoch().issued();
      const change = () => { if (!entered) { entered = true;
        if (during === "source") f.definitions.at(["leaf", "document"]).set('<strong @:changed/>');
        else f.data.at(["n"]).set(1);
        accepted = f.map.capture(); acceptedLedger = f.aggregate.identityEpoch().issued(); } };
      if (during === "allocation") allocator(authority.identityOwner, () => { change(); return "d00000000"; });
      try {
        assert.throws(() => prepare(before, before.scopes, [insert([0, 0], 0)], {
          ...authority, readPart: (lib, at) => { if (during === "source") change(); return authority.readPart(lib, at); },
        }), /changed during capture/);
      } finally { allocator(authority.identityOwner, undefined); }
      assert.equal(entered, true);
      if (during === "source") assert.equal(f.definitions.at(["leaf", "document"]).snap(), '<strong @:changed/>');
      else assert.equal(f.data.at(["n"]).snap(), 1);
      assert.equal(f.map.rev, 2); assert.equal(f.aggregate.identityEpoch().issued(), acceptedLedger);
      assert.deepEqual(f.map.capture(), accepted);
      assert.equal(before.scopes.occurrences.length, 6); assert.equal(f.candidate, before);
    }
  });
  check("preparation never publishes document scope or CSS changes and returned fence detects staleness", () => {
    const f = fixture(), before = f.candidate;
    unchanged(f, () => {
      const next = f.next(before, [insert([0, 0], 0, "styled")]);
      assert.equal(next.changed, true); assert.equal(next.steps[0]!.styles.length, 1);
      const page = f.map.doc.must("page"); assert.equal(page.mode, "document");
      if (page.mode === "document") { assert.equal(page.q("left"), undefined); assert.equal(page.css.snapshot(), ""); }
      assert.equal(next.scopes.occurrences.length, 8);
    });
    const next = f.next(before, [insert([0, 0], 0)]);
    f.data.at(["n"]).set(2); assert.throws(next.assertCurrent, /changed during capture/);
  });
  check("private scope admission does not redefine committed configuration receiving names", () => {
    const f = fixture(), authority = f.authority();
    const composed = expand_document_composition("shell", () => source('<hson-part @:host lib="parts" at="panel"/>'),
      document_composition_options({ configuration: { at: { host: { at: { next: { q: "root" } } } } } }), authority.readPart);
    assert.deepEqual(composed.quads?.map(binding => binding.name), ["host", "root"]);
    assert.equal(composed.scoped.occurrences[0]!.bindings.filter(binding => binding.name === "root").length, 2);
    let calls = 0;
    allocator(authority.identityOwner, () => { calls++; return "d00000000"; });
    try { assert.throws(() => initial({ ...f.context, root: composed.root }, composed, authority), /local name/); }
    finally { allocator(authority.identityOwner, undefined); }
    assert.equal(calls, 0);
  });
  check("all local aliases survive composition evidence without allocating additional subject identities", () => {
    const f = fixture(), authority = f.authority();
    const composed = expand_document_composition("shell", () => source('<hson-part lib="parts" at="leaf"/>'),
      document_composition_options(undefined), () => {
        const selected = source('<b @:root/>');
        return { ...selected, quads: [...selected.quads, { name: "alias", path: path([0]) }] };
      });
    const before = f.allocations();
    const candidate = f.run(() => initial({ ...f.context, root: composed.root }, composed, authority));
    assert.equal(f.allocations() - before, 1);
    const scope = candidate.scopes.occurrences[0]!;
    assert.deepEqual(scope.bindings.map(binding => binding.name), ["alias", "root"]);
    assert.ok(scope.bindings.every(binding => binding.quid === scope.rootQuid));
  });
  check("fully unnamed Parts still create independent scoped roots without synthetic authored names", () => {
    const f = fixture('<main <hson-part lib="parts" at="blank"/> <hson-part lib="parts" at="blank"/>/>');
    assert.equal(f.candidate.scopes.occurrences.length, 2); assert.equal(f.allocations(), 2);
    assert.deepEqual(f.candidate.scopes.document, []);
    assert.ok(f.candidate.scopes.occurrences.every(scope => scope.bindings.length === 0));
    assert.notEqual(f.candidate.scopes.occurrences[0]!.rootQuid, f.candidate.scopes.occurrences[1]!.rootQuid);
    assert.notEqual(f.candidate.scopes.occurrences[0]!.lifetime, f.candidate.scopes.occurrences[1]!.lifetime);
  });
  check("partial allocation and invalid later source bindings cannot publish an earlier prepared step", () => {
    const f = fixture(), before = f.candidate; let calls = 0;
    unchanged(f, () => {
      allocator(f.aggregate.identityEpoch().owner, () => calls++ === 0 ? "d00000000" : "invalid");
      try { assert.throws(() => prepare(before, before.scopes, [insert([0, 0], 0)], f.authority()), /No available/); }
      finally { allocator(f.aggregate.identityEpoch().owner, undefined); }
      assert.ok(calls > 1);
      const authority = f.authority();
      assert.throws(() => f.run(() => prepare(before, before.scopes,
        [insert([0, 0], 0), insert([0, 0], 1, "broken")], { ...authority, readPart: (lib, at) => {
          if (at !== "broken") return authority.readPart(lib, at);
          const selected = source('<section @:root/>');
          return { ...selected, quads: [...selected.quads, ...selected.quads] };
        } })), /landmark/);
    });
    assert.equal(before.issued.has("d00000000"), false);
  });
  check("insert then remove retains staged issuance and prevents same-candidate identity reuse", () => {
    const f = fixture('<main <i/>/>'), before = f.candidate;
    const next = f.next(before, [insert([0, 0], 0, "blank"), remove([0, 0], 0)]);
    assert.equal(canonical_graph_equal(before.root, next.root), true);
    assert.equal(next.scopes.occurrences.length, 0); assert.equal(next.changed, true);
    assert.equal(next.issued.size, before.issued.size + 1);
    const introduced = next.identityEffects.find(effect => effect.kind === "introduced"); assert.ok(introduced);
    assert.equal(next.overlay.pathForQuid(introduced.quid), undefined);
    let attempts = 0;
    allocator(f.aggregate.identityEpoch().owner, () => attempts++ === 0 ? introduced.quid : "d00000001");
    try {
      const reinserted = prepare(next, next.scopes, [insert([0, 0], 0, "blank")], f.authority());
      assert.equal(reinserted.scopes.occurrences[0]!.rootQuid, "d00000001"); assert.equal(attempts, 2);
    } finally { allocator(f.aggregate.identityEpoch().owner, undefined); }
  });
  check("initial composition source fence rejects stale evidence before issuing identity", () => {
    const f = fixture(), authority = f.authority(); let changed = false, allocations = 0;
    const composed = expand_document_composition("shell", () => source(shell), document_composition_options(undefined), (lib, at) => {
      if (!changed) { changed = true; f.definitions.at(["leaf", "document"]).set('<strong @:changed/>'); }
      return authority.readPart(lib, at);
    });
    const accepted = f.map.capture(), ledger = f.aggregate.identityEpoch().issued();
    allocator(authority.identityOwner, () => { allocations++; return "d00000000"; });
    try { assert.throws(() => initial({ ...f.context, root: composed.root }, composed, authority), /changed during capture/); }
    finally { allocator(authority.identityOwner, undefined); }
    assert.equal(allocations, 0); assert.deepEqual(f.map.capture(), accepted);
    assert.equal(f.aggregate.identityEpoch().issued(), ledger);
  });
  check("observation and no-op preparation allocate no identity and preserve lifetimes", () => {
    const f = fixture(), before = f.candidate; let calls = 0;
    allocator(f.aggregate.identityEpoch().owner, () => { calls++; throw Error("unexpected allocation"); });
    try { unchanged(f, () => {
      encode(before.scopes, before, []);
      for (const scope of before.scopes.occurrences) {
        location(before, scope.rootQuid);
        for (const binding of scope.bindings) location(before, binding.quid);
      }
      const next = prepare(before, before.scopes, [{ domain: "graph", op: "move-content", target: target([0, 0]), from: 0, to: 0 }], f.authority());
      assert.equal(next.changed, false);
      assert.deepEqual(next.scopes.occurrences.map(scope => scope.lifetime), before.scopes.occurrences.map(scope => scope.lifetime));
    }); } finally { allocator(f.aggregate.identityEpoch().owner, undefined); }
    assert.equal(calls, 0);
  });
}
