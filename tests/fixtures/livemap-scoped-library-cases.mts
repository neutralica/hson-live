import assert from "node:assert/strict";
import { hsonLiveMap, hsonTransform } from "../../src/index.ts";
import { internal_livemap_aggregate_authority } from "../../src/api/livemap/livemap.internal.ts";
import { part_collection_definition_internal as collection } from "../../src/api/livemap/livemap.parts.ts";
import { parse_authored_document_library } from "../../src/api/livemap/livemap.document.quad.ts";
import { validate_document_path as path } from "../../src/api/livemap/livemap.document.path.ts";
import { encode_document_scoped_quads as encode, make_document_scoped_quads as make,
  new_document_quad_occurrence } from "../../src/api/livemap/livemap.document.scoped-quad.ts";
import { prepare_document_scoped_library_styles, type PreparedDocumentScopedLibrary } from "../../src/api/livemap/livemap.document.scoped-library.ts";
import { expand_document_composition, document_composition_options } from "../../src/api/livemap/livemap.document.composition.ts";
import { prepare_document_scoped_composition } from "../../src/api/livemap/livemap.document.scoped-composition.ts";
import { set_livemap_quid_candidate_source_for_tests as allocator } from "../../src/api/livemap/livemap.quid-allocation.ts";
import { encode_portable_document_stylesheet } from "../../src/internal/css/portable-document-stylesheet.ts";
import { parse_part_stylesheet } from "../../src/internal/css/part-stylesheet.ts";
import { merge_part_stylesheets } from "../../src/internal/css/part-stylesheet.ts";
import { parse_document_stylesheet } from "../../src/internal/css/parse-document-stylesheet.ts";
import { document_scoped_quads_equal, prepare_document_scoped_operations } from "../../src/api/livemap/livemap.document.scoped-composition.ts";
import { is_Node } from "../../src/core/node-guards.ts";
import type { LiveMapGraphOp } from "../../src/types/livemap.types.ts";

const source = (text: string) => {
  const parsed = parse_authored_document_library(text); return { root: parsed.root, quads: parsed.declarations };
};
const part = (document: string, css?: string) => ({ kind: "document", document, ...(css === undefined ? {} : { css }) });
const definitions = {
  leaf: part('<b @:root/>', ':scope{color:blue}'),
  panel: part('<section @:root <div @:body <hson-part @:child at="leaf"/>/>/>', ':scope{color:red}'),
  green: part('<section @:root <div @:body <hson-part @:child at="leaf"/>/>/>', ':scope{color:green}'),
  blank: part('<span/>'),
};
const shell = '<main <hson-part @:left lib="parts" at="panel"/> <hson-part lib="parts" at="panel"/>/>';
const target = (p: readonly number[]) => ({ kind: "path" as const, path: path(p) });
const node = (text: string) => { const value = hsonTransform.fromHson(text).toNode().$_content[0]; assert.ok(is_Node(value)); return value; };
const connector = (at: string) => node(`<hson-part lib="parts" at="${at}"/>`);
const insert = (p: readonly number[], index: number, member: string): LiveMapGraphOp => ({ domain: "graph", op: "insert-content", target: target(p), index, content: connector(member) });
const replace = (p: readonly number[], index: number, member: string): LiveMapGraphOp => ({ domain: "graph", op: "replace-content", target: target(p), index, replacement: connector(member) });
const remove = (p: readonly number[], index: number): LiveMapGraphOp => ({ domain: "graph", op: "remove-content", target: target(p), index });
const move = (p: readonly number[], from: number, to: number): LiveMapGraphOp => ({ domain: "graph", op: "move-content", target: target(p), from, to });
const css = (c: PreparedDocumentScopedLibrary) => JSON.stringify(encode_portable_document_stylesheet(c.stylesheet));
const at = (c: PreparedDocumentScopedLibrary, p: readonly number[]) => {
  const scope = c.scopes.occurrences.find(scope => scope.rootQuid === c.overlay.quidAtPath(path(p))); assert.ok(scope); return scope;
};
function fixture() {
  const map = hsonLiveMap.fromLibraries({ parts: collection(definitions), page: { document: '<main/>' }, other: { data: { n: 0 } } });
  const page = map.doc.must("page"); assert.equal(page.mode, "document"); if (page.mode !== "document") throw Error();
  page.css.stylesheet('main{padding:3px}');
  const aggregate = internal_livemap_aggregate_authority(map), owner = aggregate.libraries()[1]!;
  return { map, page, aggregate, owner, initial: (text = shell) => aggregate.prepareScopedDocument(owner, source(text)),
    next: aggregate.prepareScopedDocumentOperations };
}
function unpublished(f: ReturnType<typeof fixture>, run: () => void) {
  const snapshot = f.map.capture(), hosted = f.aggregate.captureHosted(), checkpoint = f.aggregate.captureSemanticCheckpoint();
  const ledger = f.aggregate.identityEpoch().issued(), rev = f.map.rev; let commits = 0;
  const off = f.map.commits.observe(() => commits++);
  try { run(); } finally { off(); }
  assert.deepEqual(f.map.capture(), snapshot); assert.deepEqual(f.aggregate.captureHosted(), hosted);
  assert.deepEqual(f.aggregate.captureSemanticCheckpoint(), checkpoint);
  assert.equal(f.aggregate.identityEpoch().issued(), ledger); assert.equal(f.map.rev, rev); assert.equal(commits, 0);
}

export function scoped_library_cases(check: (name: string, run: () => void) => void) {
  check("authenticated candidates cannot be edited behind their authority fence", () => {
    const f = fixture(); unpublished(f, () => {
      const input = source(shell), c = f.aggregate.prepareScopedDocument(f.owner, input);
      const root = c.root.$_content[0]; assert.ok(is_Node(root));
      assert.throws(() => { root.$_tag = "aside"; }, TypeError);
      assert.throws(() => { root.$_content.length = 0; }, TypeError);
      assert.equal(Object.isFrozen(input.root), false, "caller-owned source remains untouched");
      const moved = f.next(c, [move([0, 0], 0, 1), move([0, 0], 1, 0)]);
      assert.throws(() => { moved.steps[0]!.context.root.$_content.length = 0; }, TypeError);
      assert.deepEqual(f.next(c, []).root, c.root);
    });
  });
  check("durable reservations fence scoped allocation and continuation", () => {
    const f = fixture(), c = f.initial(), pending = f.aggregate.prepare([]);
    const release = f.aggregate.reserve(pending); let calls = 0;
    allocator(f.aggregate.identityEpoch().owner, () => { calls++; return "d00000001"; });
    try { unpublished(f, () => {
      assert.throws(() => f.initial(), /reserved/);
      assert.throws(() => f.next(c, [insert([0, 0], 0, "blank")]), /reserved/);
    }); } finally { allocator(f.aggregate.identityEpoch().owner, undefined); release(); f.aggregate.discard(pending); }
    assert.equal(calls, 0); assert.equal(f.next(c, []).changed, false);
  });
  check("independent subject CSS rejects retirement after occurrence-owned CSS is removed", () => {
    const f = fixture(), c = f.initial(), root = at(c, [0, 0, 0]);
    unpublished(f, () => {
      const stylesheet = merge_part_stylesheets([encode_portable_document_stylesheet(c.stylesheet),
        parse_document_stylesheet(`[hson\\:quid="${root.rootQuid}"]{opacity:.5}`, [])]);
      const before = { ...c, stylesheet };
      const candidate = prepare_document_scoped_operations(before, before.scopes, [remove([0, 0], 0)], {
        identityOwner: f.aggregate.identityEpoch().owner, assertCurrent: c.assertCurrent,
        readPart: () => { throw Error("unused"); },
      });
      assert.throws(() => prepare_document_scoped_library_styles(candidate, stylesheet, before), /surviving Library subject/);
      assert.ok(css(before).includes(root.rootQuid));
    });
  });
  check("management claims fence both fresh preparation and existing candidates", () => {
    const f = fixture(), c = f.initial(), manager = {};
    f.aggregate.claimManagement(manager);
    assert.throws(() => f.initial()); assert.throws(() => f.next(c, []));
    f.aggregate.releaseManagement(manager);
    assert.equal(f.next(c, []).changed, false);
  });
  check("reentrant source changes reject before identity issuance", () => {
    const f = fixture(), selected = source(shell); let calls = 0;
    allocator(f.aggregate.identityEpoch().owner, () => { calls++; return "d00000001"; });
    try {
      assert.throws(() => f.aggregate.prepareScopedDocument(f.owner, {
        get root() { f.map.parts.must("parts").at(["leaf", "document"]).set('<strong @:root/>'); return selected.root; },
        quads: selected.quads,
      }), /changed during capture/);
    } finally { allocator(f.aggregate.identityEpoch().owner, undefined); }
    assert.equal(calls, 0); assert.equal(f.page.css.snapshot(), 'main{padding:3px;}');
    assert.equal(f.map.parts.must("parts").at(["leaf", "document"]).snap(), '<strong @:root/>');
  });
  check("Library preparation owns complete nested named/unnamed candidates without publishing flat/scoped dual state", () => {
    const f = fixture(); unpublished(f, () => {
      const c = f.initial();
      assert.throws(() => Reflect.apply(f.aggregate.accept, undefined, [c]), /foreign|another|unknown/i);
      assert.equal(c.owner, f.owner); assert.equal(c.scopes.owner, f.owner);
      assert.equal(c.scopes.occurrences.length, 4);
      const left = at(c, [0, 0, 0]), right = at(c, [0, 0, 1]);
      assert.notEqual(left.lifetime, right.lifetime); assert.notEqual(left.rootQuid, right.rootQuid);
      assert.deepEqual(left.bindings.map(b => b.name), right.bindings.map(b => b.name));
      assert.equal(at(c, [0, 0, 0, 0, 0, 0, 0]).parent, left.lifetime);
      assert.equal(c.scopes.document[0]!.quid, left.rootQuid);
      assert.ok(css(c).includes('padding')); assert.ok(css(c).includes('blue')); assert.ok(css(c).includes('red'));
      assert.equal(f.page.q("left"), undefined); assert.equal(f.page.css.snapshot(), 'main{padding:3px;}');
    });
  });
  check("later insertion and movement use existing occurrence boundaries and keep exact CSS ownership", () => {
    const f = fixture(); unpublished(f, () => {
      const before = f.initial(), left = at(before, [0, 0, 0]);
      const moved = f.next(before, [move([0, 0], 0, 1)]);
      assert.equal(at(moved, [0, 0, 1]).lifetime, left.lifetime); assert.equal(css(moved), css(before));
      const next = f.next(moved, [insert([0, 0, 1, 0, 0, 0], 1, "blank")]);
      assert.equal(at(next, [0, 0, 1, 0, 0, 0, 1]).parent, left.lifetime);
      assert.deepEqual(at(next, [0, 0, 1, 0, 0, 0, 1]).bindings, []);
    });
  });
  check("parent retirement removes nested contributions and preserves sibling and unrelated managed CSS", () => {
    const f = fixture(); unpublished(f, () => {
      const c = f.initial(), old = c.scopes.occurrences.filter(s => s === at(c, [0, 0, 0]) || s.parent === at(c, [0, 0, 0]).lifetime);
      const next = f.next(c, [remove([0, 0], 0)]);
      assert.equal(next.scopes.occurrences.length, 2);
      assert.equal(at(next, [0, 0, 0]).lifetime, at(c, [0, 0, 1]).lifetime);
      for (const s of old) assert.equal(css(next).includes(s.rootQuid), false);
      assert.ok(css(next).includes(at(c, [0, 0, 1]).rootQuid)); assert.ok(css(next).includes('padding'));
      assert.equal(next.issued.size, c.issued.size);
    });
  });
  check("replacement retires old CSS before installing new and distinguishes graph-equivalent transitions", () => {
    const f = fixture(); unpublished(f, () => {
      const c = f.initial('<hson-part lib="parts" at="panel"/>'), old = at(c, [0]);
      const next = f.next(c, [replace([], 0, "green")]);
      assert.deepEqual(next.root, c.root); assert.equal(next.changed, true);
      assert.notEqual(at(next, [0]).lifetime, old.lifetime);
      assert.equal(css(next).includes(old.rootQuid), false); assert.equal(css(next).includes('red'), false);
      assert.ok(css(next).includes('green')); assert.ok(css(next).includes('blue'));
    });
  });
  check("one batch inserts, moves, replaces and removes using operation-local CSS coordinates", () => {
    const f = fixture(); unpublished(f, () => {
      const c = f.initial('<main <i/>/>');
      const next = f.next(c, [insert([0, 0], 0, "panel"), move([0, 0], 0, 1), replace([0, 0], 1, "green"), remove([0, 0], 1)]);
      assert.deepEqual(next.root, c.root); assert.equal(next.changed, true); assert.equal(next.scopes.occurrences.length, 0);
      assert.equal(css(next), css(c)); assert.ok(next.issued.size > c.issued.size);
    });
  });
  check("ordinary subject removal preserves its containing occurrence", () => {
    const f = fixture(); unpublished(f, () => {
      const c = f.initial(), next = f.next(c, [{ domain: "graph", op: "insert-content", target: target([0, 0, 0, 0]), index: 1, content: node("<i/>") }, remove([0, 0, 0, 0], 0)]);
      assert.equal(at(next, [0, 0, 0]).lifetime, at(c, [0, 0, 0]).lifetime);
      assert.equal(at(next, [0, 0, 0]).bindings.some(b => b.name === "body"), false);
      assert.equal(next.scopes.occurrences.length, 3);
    });
  });
  check("invalid names, CSS, allocation and later operations discard staged identities and styles", () => {
    const f = fixture(); unpublished(f, () => {
      const c = f.initial();
      assert.throws(() => f.next(c, [insert([0, 0], 0, "panel"), remove([0, 0], 999)]));
      const s = source('<b @:root/>');
      assert.throws(() => f.aggregate.prepareScopedDocument(f.owner, { ...s, quads: [...s.quads, ...s.quads] }));
      allocator(f.aggregate.identityEpoch().owner, () => "invalid");
      try { assert.throws(() => f.next(c, [insert([0, 0], 0, "panel")]), /No available/); }
      finally { allocator(f.aggregate.identityEpoch().owner, undefined); }
      const styles = [{ ...c.initialStyles[0]!, subjects: [] }];
      assert.throws(() => prepare_document_scoped_library_styles({ ...c, initialStyles: styles }, c.stylesheet), /Unresolved/);
      assert.throws(() => prepare_document_scoped_library_styles({ ...c, initialStyles: [{ css: { rules: [], properties: [], keyframes: [], order: [{ kind: "group", header: "invalid", entries: [] }] }, subjects: [] }] }, c.stylesheet));
    });
  });
  check("foreign, forged and stale candidates cannot continue under another authority", () => {
    const f = fixture(), g = fixture(), c = f.initial();
    assert.throws(() => g.next(c, []), /another Library/); assert.throws(() => f.next({ ...c }, []), /another Library/);
    f.map.data.must("other").at(["n"]).set(1);
    unpublished(f, () => assert.throws(() => f.next(c, []), /changed during capture/));
  });
  check("non-revisioned identity acquisition invalidates an older scoped candidate", () => {
    const f = fixture(), c = f.initial(), rev = f.map.rev;
    f.aggregate.acquireLocalDocumentIdentity(f.owner, path([0]), "d00000002");
    assert.equal(f.map.rev, rev);
    assert.ok(f.aggregate.identityEpoch().issued().has("d00000002"));
    unpublished(f, () => assert.throws(() => f.next(c, []), /changed during capture/));
  });
  check("reentrant issuance preserves only independently accepted work", () => {
    const f = fixture(), c = f.initial(); let entered = false;
    allocator(f.aggregate.identityEpoch().owner, () => {
      if (!entered) { entered = true; f.map.data.must("other").at(["n"]).set(1); }
      return "d00000001";
    });
    const ledger = f.aggregate.identityEpoch().issued(), rev = f.map.rev;
    try { assert.throws(() => f.next(c, [insert([0, 0], 0, "blank")]), /changed during capture/); }
    finally { allocator(f.aggregate.identityEpoch().owner, undefined); }
    assert.equal(f.map.rev, rev + 1); assert.equal(f.aggregate.identityEpoch().issued().size, ledger.size);
    assert.equal(f.aggregate.identityEpoch().issued().has("d00000001"), false);
    assert.equal(f.page.css.snapshot(), 'main{padding:3px;}');
  });
  check("observation and no-op preparation issue no identities", () => {
    const f = fixture(), c = f.initial(); let calls = 0;
    allocator(f.aggregate.identityEpoch().owner, () => { calls++; throw Error("observation allocated"); });
    try { unpublished(f, () => {
      encode(c.scopes, c, []); css(c);
      const next = f.next(c, [move([0, 0], 0, 0)]); assert.equal(next.changed, false);
      assert.equal(at(next, [0, 0, 0]).lifetime, at(c, [0, 0, 0]).lifetime);
    }); } finally { allocator(f.aggregate.identityEpoch().owner, undefined); }
    assert.equal(calls, 0);
  });
  check("CSS retirement follows lifetime even when an internally proven root QUID survives", () => {
    const f = fixture();
    f.map.parts.must("parts").at(["leaf", "css"]).set(':scope{color:blue;animation:oldPulse 1s} @keyframes oldPulse{to{opacity:1}} @property --old-tone{syntax:"<color>";inherits:false;initial-value:blue}');
    const old = f.initial('<hson-part lib="parts" at="leaf"/>');
    unpublished(f, () => {
      // An operation-local unit seam, not caller-authored replacement lineage.
      const composed = expand_document_composition("shell", () => source('<hson-part lib="parts" at="leaf"/>'),
        document_composition_options(undefined), () => ({ ...source('<b @:root/>'), css: parse_part_stylesheet(':scope{color:green}') }));
      const authority = { identityOwner: f.aggregate.identityEpoch().owner, assertCurrent: old.assertCurrent,
        readPart: () => { throw Error("unused"); } };
      const fresh = prepare_document_scoped_composition({ ...old, root: composed.root }, composed, authority);
      assert.equal(fresh.overlay, old.overlay); assert.equal(fresh.issued.size, old.issued.size);
      assert.notEqual(fresh.scopes.occurrences[0]!.lifetime, old.scopes.occurrences[0]!.lifetime);
      const next = prepare_document_scoped_library_styles({ ...fresh, initialStyles: [], steps: [{ operation: replace([], 0, "leaf"),
        context: fresh, scopes: fresh.scopes, styles: composed.styles }] }, old.stylesheet, old);
      assert.equal(css(next).includes('blue'), false); assert.ok(css(next).includes('green'));
      assert.ok(css(old).includes('oldPulse')); assert.ok(css(old).includes('--old-tone'));
      assert.equal(css(next).includes('oldPulse'), false); assert.equal(css(next).includes('--old-tone'), false);
      assert.ok(css(next).includes(old.scopes.occurrences[0]!.rootQuid)); assert.ok(next.changed);
      const topologyOnly = make(old, old.scopes.document, old.scopes.occurrences.map(s => ({ ...s, lifetime: new_document_quad_occurrence(old.owner) })));
      assert.deepEqual(encode(topologyOnly, old, []), encode(old.scopes, old, []));
      assert.equal(document_scoped_quads_equal(topologyOnly, old.scopes), false,
        "identical graph, overlay, names and coordinates cannot hide a different occurrence lifetime");
      assert.equal(document_scoped_quads_equal(old.scopes, old.scopes), true);
    });
  });
}
