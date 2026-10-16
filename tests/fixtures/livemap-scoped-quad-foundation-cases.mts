import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mock } from "node:test";
import { hsonLiveMap } from "../../src/index.ts";
import type { HsonNode } from "../../src/core/types.ts";
import { internal_livemap_aggregate_authority } from "../../src/api/livemap/livemap.internal.ts";
import { validate_document_path } from "../../src/api/livemap/livemap.document.path.ts";
import { set_livemap_quid_candidate_source_for_tests } from "../../src/api/livemap/livemap.quid-allocation.ts";
import { set_livemap_document_quid_candidate_source_for_tests } from "../../src/api/livemap/livemap.document.registration.ts";
import { acquire_document_identity } from "../helpers/livemap-identity-internal.mts";
import {
  make_document_scoped_quads as make, encode_document_scoped_quads as encode,
  new_document_quad_occurrence as occurrence, retire_document_quad_occurrences as retire,
  type DocumentScopedQuadBinding, type DocumentScopedQuadContext, type DocumentQuadOccurrenceScope,
} from "../../src/api/livemap/livemap.document.scoped-quad.ts";
import {
  decode_document_scoped_quads as decode, document_scoped_quads_semantically_equal as equal,
  DOCUMENT_SCOPED_QUAD_LIMITS as limits, type DocumentScopedQuadRecord,
} from "../../src/api/livemap/livemap.document.scoped-quad-codec.ts";

// Isolated association fixtures on a realized graph. No Part composition,
// public scoped lookup, portable installation, CSS, or hosted replay is claimed.
function fixture(prefix = "a") {
  const map = hsonLiveMap.fromLibraries({ page: { document:
    '<main <section <button "next"/> <aside <button "nested"/>/>/> <section <button "next"/>/> <footer/>/>' } });
  const page = map.lib("page"); assert.equal(page.mode, "document");
  if (page.mode !== "document") throw Error("document fixture");
  const aggregate = internal_livemap_aggregate_authority(map), owner = aggregate.libraries()[0]!;
  const coordinates = {
    main: [0], left: [0, 0, 0], next: [0, 0, 0, 0, 0], inner: [0, 0, 0, 0, 1], innerNext: [0, 0, 0, 0, 1, 0, 0],
    right: [0, 0, 1], rightNext: [0, 0, 1, 0, 0], footer: [0, 0, 2],
  };
  let candidates = 0;
  set_livemap_document_quid_candidate_source_for_tests(page.document, () => prefix + String(candidates++).padStart(8, "0"));
  try {
    for (const coordinate of Object.values(coordinates)) {
      const handle = acquire_document_identity(page.document, { kind: "path", path: validate_document_path(coordinate) });
      handle.dispose();
    }
  } finally { set_livemap_document_quid_candidate_source_for_tests(page.document, undefined); }
  assert.equal(candidates, 8, "fixture subjects use the existing legitimate issuer");
  const context = (): DocumentScopedQuadContext => ({ owner, root: aggregate.root(owner), overlay: aggregate.documentOverlay(owner), issued: aggregate.identityEpoch().issued() });
  const id = (name: keyof typeof coordinates) => {
    const quid = context().overlay.quidAtPath(validate_document_path(coordinates[name])); assert.ok(quid); return quid;
  };
  const binding = (name: string, target: keyof typeof coordinates, kind: "element" | "part" = "element"): DocumentScopedQuadBinding => ({ name, kind, quid: id(target) });
  const left = occurrence(owner), inner = occurrence(owner), right = occurrence(owner);
  const scopes: DocumentQuadOccurrenceScope[] = [
    { lifetime: left, rootQuid: id("left"), parent: null, bindings: [binding("root", "left"), binding("next", "next"), binding("content", "inner", "part")] },
    { lifetime: inner, rootQuid: id("inner"), parent: left, bindings: [binding("next", "innerNext")] },
    { lifetime: right, rootQuid: id("right"), parent: null, bindings: [binding("next", "rightNext"), binding("root", "right")] },
  ];
  const document = [binding("page", "main"), binding("left", "left", "part"), binding("right", "right", "part")];
  const state = make(context(), document, scopes);
  const demanded = Object.values(coordinates).map(coordinate => context().overlay.quidAtPath(validate_document_path(coordinate))!);
  return { map, page, aggregate, owner, context, id, binding, scopes, document, state, demanded, left, inner, right };
}

function unchanged(f: ReturnType<typeof fixture>, run: () => void) {
  const before = f.aggregate.inspect(), context = f.context();
  let commits = 0, positions = 0;
  const stop = f.map.commits.observe(() => commits++), off = f.aggregate.observeAuthorityPosition(() => positions++);
  try { run(); } finally { stop(); off(); }
  assert.deepEqual(f.aggregate.inspect(), before);
  assert.equal(f.context().root, context.root); assert.equal(f.context().overlay, context.overlay);
  assert.equal(f.context().issued, context.issued); assert.equal(commits, 0); assert.equal(positions, 0);
}

type MutableBinding = { name: string; kind: string; path: number[] };
type MutableRecord = {
  document: MutableBinding[];
  occurrences: { root: number[]; parent: number[] | null; bindings: MutableBinding[] }[];
  subjects: { name: string; path: number[]; disposition: string }[];
};
function mutable(record: DocumentScopedQuadRecord): MutableRecord {
  const bindings = (entries: readonly DocumentScopedQuadRecord["document"][number][]) => entries.map(entry => ({ ...entry, path: [...entry.path] }));
  return { document: bindings(record.document), occurrences: record.occurrences.map(entry => ({ root: [...entry.root],
    parent: entry.parent === null ? null : [...entry.parent], bindings: bindings(entry.bindings) })),
  subjects: record.subjects.map(entry => ({ ...entry, path: [...entry.path] })) };
}

export function scoped_quad_foundation_cases(check: (name: string, run: () => void) => void) {
  check("repeated local names and nested independently scoped subjects", () => {
    const f = fixture(), record = encode(f.state, f.context(), f.demanded);
    assert.deepEqual(record.occurrences.map(scope => scope.bindings.find(entry => entry.name === "next")?.path),
      [[0, 0, 0, 0, 0], [0, 0, 0, 0, 1, 0, 0], [0, 0, 1, 0, 0]]);
    assert.deepEqual(record.occurrences[1]!.parent, record.occurrences[0]!.root);
    assert.equal(record.subjects.length, 8);
    assert.equal(f.page.q("left"), undefined, "private foundation installs no public names");
  });
  check("duplicates reject locally, including a duplicate name for the same subject", () => {
    const f = fixture(), left = f.scopes[0]!;
    for (const duplicate of [f.binding("next", "next"), f.binding("next", "left")]) unchanged(f, () => {
      assert.throws(() => make(f.context(), f.document, [{ ...left, bindings: [...left.bindings, duplicate] }, ...f.scopes.slice(1)]), /local name/);
    });
    assert.throws(() => make(f.context(), [...f.document, f.binding("page", "footer")], f.scopes), /local name/);
  });
  check("ordinary named ancestry does not create scopes or authorize boundary crossing", () => {
    const f = fixture();
    const plain = make(f.context(), [f.binding("ancestor", "main"), f.binding("next", "next")], []);
    assert.equal(encode(plain, f.context(), []).occurrences.length, 0);
    assert.throws(() => make(f.context(), [...f.document, f.binding("intruder", "next")], f.scopes), /crosses an occurrence/);
    assert.throws(() => make(f.context(), [f.binding("fakePart", "footer", "part")], []), /immediate child/);
  });
  check("ordinary addresses can share immediate child roots without changing their portable binding role", () => {
    const f = fixture();
    unchanged(f, () => {
      const state = make(f.context(), [...f.document, f.binding("slot", "left")],
        f.scopes.map(scope => scope.lifetime === f.left ? { ...scope, bindings: [...scope.bindings, f.binding("slot", "inner")] } : scope));
      const record = encode(state, f.context(), [f.id("left"), f.id("inner")]);
      const decoded = decode(JSON.parse(JSON.stringify(record)), f.context().root);
      assert.deepEqual(decoded, record);
      for (const bindings of [decoded.document, decoded.occurrences[0]!.bindings]) {
        const address = bindings.find(binding => binding.name === "slot")!;
        const capability = bindings.find(binding => binding.kind === "part" && JSON.stringify(binding.path) === JSON.stringify(address.path))!;
        assert.equal(address.kind, "element"); assert.ok(capability);
        assert.notEqual(address.name, capability.name);
      }
      assert.equal(record.subjects.length, 2, "distinct binding roles share subject identity");
      const elementOnly = mutable(record);
      elementOnly.document = elementOnly.document.filter(binding => binding.kind !== "part");
      const withoutCapability = decode(elementOnly, f.context().root);
      assert.equal(withoutCapability.document.find(binding => binding.name === "slot")!.kind, "element");
      assert.equal(equal(record, withoutCapability), false, "ordinary subject access is not equivalent to Part-scope access");
      const changedRole = mutable(record);
      changedRole.document.find(binding => binding.name === "slot")!.kind = "part";
      assert.equal(equal(record, decode(changedRole, f.context().root)), false, "portable meaning preserves explicit roles");
    });
  });
  check("child-root addresses still reject deeper and unrelated scope crossings and local name collisions", () => {
    const f = fixture();
    unchanged(f, () => {
      for (const target of ["next", "inner", "innerNext"] as const) {
        assert.throws(() => make(f.context(), [...f.document, f.binding("intruder", target)], f.scopes), /crosses an occurrence/);
      }
      for (const target of ["innerNext", "right", "rightNext"] as const) {
        const left = f.scopes[0]!;
        assert.throws(() => make(f.context(), f.document, [{ ...left, bindings: [...left.bindings, f.binding("intruder", target)] },
          ...f.scopes.slice(1)]), /crosses an occurrence|outside its occurrence/);
      }
      assert.throws(() => make(f.context(), [...f.document, f.binding("left", "left")], f.scopes), /local name/,
        "element and Part bindings do not create separate name domains");
    });
  });
  check("unnamed occurrences survive independently of incoming logical names", () => {
    const f = fixture(), state = make(f.context(), f.document.filter(binding => binding.name !== "right"), f.scopes);
    const record = decode(JSON.parse(JSON.stringify(encode(state, f.context(), []))), f.context().root);
    assert.equal(record.occurrences.length, 3); assert.equal(record.subjects.length, 0);
    assert.deepEqual(record.occurrences[2]!.bindings.map(binding => binding.name), ["next", "root"]);
  });
  check("multiple logical addresses share a single transport subject", () => {
    const f = fixture();
    const state = make(f.context(), [...f.document, f.binding("alias", "left", "part")], f.scopes);
    const record = encode(state, f.context(), [f.id("left"), f.id("left")]);
    assert.equal(record.subjects.length, 1);
    assert.deepEqual(record.document.find(binding => binding.name === "left")!.path, record.occurrences[0]!.bindings.find(binding => binding.name === "root")!.path);
    assert.equal(record.document.filter(binding => binding.kind === "part" && binding.path.at(-1) === 0).length, 2);
    const aliases = make(f.context(), [], [{ ...f.scopes[2]!, bindings: [f.binding("a", "rightNext"), f.binding("b", "rightNext")] }]);
    assert.equal(encode(aliases, f.context(), [f.id("rightNext")]).subjects.length, 1);
  });
  check("authored synthetic spelling is legal and never controls transport disposition", () => {
    const f = fixture(), label = `_${f.id("left")}`;
    const state = make(f.context(), [...f.document, f.binding(label, "footer")], f.scopes);
    const record = encode(state, f.context(), [f.id("left")]);
    assert.equal(record.subjects[0]!.name, label);
    assert.notDeepEqual(record.document.find(entry => entry.name === label)!.path, record.subjects[0]!.path);
    assert.deepEqual(decode(JSON.parse(JSON.stringify(record)), f.context().root), record);
    assert.equal(f.page.q(label), undefined);
  });
  check("CSS-only correspondence demands require no authored name or occurrence", () => {
    const f = fixture(), record = encode(make(f.context(), [], []), f.context(), [f.id("footer")]);
    assert.deepEqual(record.document, []); assert.deepEqual(record.occurrences, []);
    assert.deepEqual(record.subjects, [{ name: `_${f.id("footer")}`, path: [0, 0, 2], disposition: "disposable" }]);
  });
  check("occurrence retirement is independent of root QUID continuity and cascades locally", () => {
    const f = fixture(), remaining = retire(f.state, [f.left]);
    assert.deepEqual(remaining.occurrences.map(scope => scope.lifetime), [f.right]);
    assert.equal(remaining.document.some(binding => binding.name === "left"), false);
    assert.equal(f.context().overlay.quidAtPath(validate_document_path([0, 0, 0])), f.id("left"));
    const replacement = occurrence(f.owner);
    const state = make(f.context(), [...remaining.document, f.binding("left", "left", "part")],
      [...remaining.occurrences, { lifetime: replacement, rootQuid: f.id("left"), parent: null, bindings: [f.binding("fresh", "left")] }]);
    assert.notEqual(replacement, f.left);
    assert.equal(state.occurrences.find(scope => scope.rootQuid === f.id("left"))!.bindings[0]!.name, "fresh");
    assert.equal(state.occurrences.find(scope => scope.lifetime === f.inner), undefined);
    assert.deepEqual(encode(state, f.context(), []).occurrences.at(-1), encode(f.state, f.context(), []).occurrences.at(-1));
    assert.equal(f.state.occurrences.length, 3, "retirement does not mutate retained candidates");
    assert.throws(() => retire(remaining, [f.left]), /inactive/);
    assert.deepEqual(retire(f.state, [f.left, f.right]).occurrences, []);
  });
  check("equal graphs may have different valid occurrence topology", () => {
    const f = fixture(), empty = encode(make(f.context(), [], []), f.context(), []);
    const scoped = encode(make(f.context(), [], [{ ...f.scopes[2]!, bindings: [] }]), f.context(), []);
    assert.equal(equal(empty, scoped), false);
    const replacement = occurrence(f.owner);
    const replaced = make(f.context(), [], [{ ...f.scopes[2]!, lifetime: replacement, bindings: [] }]);
    assert.notEqual(replacement, f.right);
    assert.equal(equal(scoped, encode(replaced, f.context(), [])), true,
      "portable semantic equality cannot decide occurrence continuity or whether a transition is a no-op");
  });
  check("moves use the existing overlay while retaining occurrence lifetimes and handle-independent state", () => {
    const f = fixture(), leftQuid = f.id("left"), innerQuid = f.id("inner");
    f.page.document.content.move({ kind: "path", path: [0, 0] }, 0, 1);
    unchanged(f, () => {
      const moved = encode(f.state, f.context(), f.demanded);
      assert.deepEqual(moved.document.find(binding => binding.name === "left")!.path, [0, 0, 1]);
      assert.deepEqual(moved.occurrences[2]!.parent, [0, 0, 1]);
      assert.equal(f.state.occurrences[0]!.lifetime, f.left);
      assert.equal(f.state.occurrences[1]!.rootQuid, innerQuid);
      const handle = acquire_document_identity(f.page.document, { kind: "path", path: f.context().overlay.pathForQuid(leftQuid)! });
      handle.dispose();
      assert.deepEqual(encode(f.state, f.context(), f.demanded), moved);
    });
  });
  check("retired subjects cannot be serialized until the private candidate removes their bindings", () => {
    const f = fixture(), removed = f.id("next");
    f.page.document.content.remove({ kind: "path", path: [0, 0, 0, 0] }, 0);
    assert.equal(f.context().issued.has(removed), true);
    unchanged(f, () => {
      assert.throws(() => encode(f.state, f.context(), []), /active overlay/);
      const candidate = make(f.context(), f.document, f.scopes.map(scope => ({ ...scope, bindings: scope.bindings.filter(binding => binding.quid !== removed) })));
      assert.equal(encode(candidate, f.context(), f.demanded.filter(quid => quid !== removed)).subjects.length, 7);
      assert.equal(candidate.occurrences[0]!.lifetime, f.left);
    });
  });
  check("encoding is canonical, detached, frozen and stable across demand and construction order", () => {
    const f = fixture(), first = encode(f.state, f.context(), f.demanded);
    const state = make(f.context(), [...f.document].reverse(), [...f.scopes].reverse());
    const second = encode(state, f.context(), [...f.demanded].reverse());
    assert.equal(JSON.stringify(first), JSON.stringify(second));
    assert.equal(JSON.stringify(first), JSON.stringify(encode(f.state, f.context(), f.demanded)));
    const input = mutable(first), decoded = decode(input, f.context().root);
    input.document[0]!.name = "changed"; input.subjects[0]!.path.push(999);
    assert.deepEqual(decoded, first);
    assert.ok(Object.isFrozen(decoded) && Object.isFrozen(decoded.document) && Object.isFrozen(decoded.document[0]) && Object.isFrozen(decoded.subjects[0]!.path));
    assert.ok(Object.isFrozen(f.state) && Object.isFrozen(f.state.occurrences) && Object.isFrozen(f.state.occurrences[0]!.bindings));
  });
  check("fresh legitimate identities preserve scoped meaning, while actual byte hashes remain distinct", () => {
    const one = fixture("a"), two = fixture("b");
    const left = encode(one.state, one.context(), one.demanded), right = encode(two.state, two.context(), two.demanded);
    assert.notEqual(one.id("left"), two.id("left")); assert.deepEqual(one.context().root, two.context().root);
    assert.equal(equal(left, right), true);
    const digest = (record: DocumentScopedQuadRecord) => createHash("sha256").update(JSON.stringify(record)).digest("hex");
    assert.notEqual(digest(left), digest(right));
    const changed = mutable(right); changed.occurrences[0]!.bindings[1]!.name = "other";
    assert.equal(equal(left, decode(changed, two.context().root)), false);
    assert.equal(equal(left, encode(two.state, two.context(), two.demanded.slice(1))), false);
  });
  check("malformed topology and role evidence rejects without owner effects", () => {
    const f = fixture(), valid = encode(f.state, f.context(), f.demanded);
    const mutations: ((record: MutableRecord) => void)[] = [
      record => { record.occurrences.push(record.occurrences[0]!); },
      record => { record.occurrences.reverse(); },
      record => { record.occurrences[0]!.parent = record.occurrences[0]!.root; },
      record => { record.occurrences[0]!.parent = record.occurrences[1]!.root; },
      record => { record.occurrences[1]!.parent = null; },
      record => { record.occurrences[1]!.parent = [0, 0, 2]; },
      record => { record.occurrences[1]!.parent = record.occurrences[2]!.root; },
      record => { record.document[0]!.kind = "element"; record.document[0]!.path = [0, 0, 0, 0, 1]; },
      record => { record.occurrences[0]!.bindings[0]!.kind = "element"; record.occurrences[0]!.bindings[0]!.path = [0, 0, 0, 0, 1, 0, 0]; },
      record => { record.occurrences[0]!.bindings[1]!.kind = "part"; },
      record => { record.occurrences[0]!.bindings[1]!.path = [0, 0, 1, 0, 0]; },
      record => { record.document[0]!.kind = "unknown"; },
      record => { record.document[1]!.name = record.document[0]!.name; },
      record => { record.document[0]!.name = "bad name"; },
      record => { record.document[0]!.name = "a".repeat(129); },
      record => { record.document.reverse(); },
    ];
    unchanged(f, () => { for (const mutate of mutations) { const input = mutable(valid); mutate(input); assert.throws(() => decode(input, f.context().root)); } });
  });
  check("transport bijection and explicit classification reject hostile aliases and identity claims", () => {
    const f = fixture(), valid = encode(f.state, f.context(), f.demanded);
    const mutations: ((record: MutableRecord) => void)[] = [
      record => { record.subjects[1]!.name = record.subjects[0]!.name; },
      record => { record.subjects[1]!.path = record.subjects[0]!.path; },
      record => { record.subjects.reverse(); },
      record => { record.subjects[0]!.name = "s0"; },
      record => { record.subjects[0]!.name = "_00000000i"; },
      record => { record.subjects[0]!.name += "\n"; },
      record => { record.subjects[0]!.disposition = "authored"; },
      record => { Reflect.deleteProperty(record.subjects[0]!, "disposition"); },
      record => { Object.assign(record.subjects[0]!, { quid: f.id("main") }); },
      record => { Object.assign(record, { issued: [f.id("main")], epoch: 0 }); },
      record => { Object.assign(record, { version: 1 }); },
      record => { Object.assign(record.document[0]!, { disposition: "disposable" }); },
    ];
    unchanged(f, () => { for (const mutate of mutations) { const input = mutable(valid); mutate(input); assert.throws(() => decode(input, f.context().root)); } });
    const foreign = mutable(valid); foreign.subjects[0]!.name = "_zzzzzzzzz";
    unchanged(f, () => { assert.equal(decode(foreign, f.context().root).subjects[0]!.name, "_zzzzzzzzz"); });
    assert.equal(f.context().issued.has("zzzzzzzzz"), false, "label validation is not issuance or authority admission");
  });
  check("distinct coordinates cannot claim the same graph object as independent subjects or occurrence roots", () => {
    const shared: HsonNode = { $_tag: "button", $_content: [] };
    const root: HsonNode = { $_tag: "_hson_root", $_content: [shared, shared] };
    assert.throws(() => decode({ document: [], occurrences: [], subjects: [
      { name: "_a00000000", path: [0], disposition: "disposable" },
      { name: "_a00000001", path: [1], disposition: "disposable" },
    ] }, root), /ambiguous canonical coordinates/);
    assert.throws(() => decode({ document: [], subjects: [], occurrences: [
      { root: [0], parent: null, bindings: [] }, { root: [1], parent: null, bindings: [] },
    ] }, root), /ambiguous canonical coordinates/);
  });
  check("exact descriptors and canonical raw document paths reject without invoking accessors", () => {
    const f = fixture(), valid = encode(f.state, f.context(), f.demanded);
    let getters = 0;
    const mutations: ((record: MutableRecord) => void)[] = [
      record => { Object.defineProperty(record, "subjects", { enumerable: true, get() { getters++; return []; } }); },
      record => { Object.defineProperty(record.subjects[0]!, "name", { enumerable: true, get() { getters++; return "_000000000"; } }); },
      record => { Object.defineProperty(record.document, "0", { enumerable: true, get() { getters++; return {}; } }); },
      record => { Object.defineProperty(record.document[0]!.path, "0", { enumerable: true, get() { getters++; return 0; } }); },
      record => { Object.defineProperty(record.occurrences[0]!, "bindings", { enumerable: false, value: [] }); },
      record => { Object.assign(record.subjects, { extra: true }); },
      record => { Reflect.deleteProperty(record.subjects, "0"); },
      record => { Object.assign(record, { [Symbol("hidden")]: true }); },
      record => { Object.setPrototypeOf(record, { inherited: true }); },
      record => { Object.setPrototypeOf(record.subjects, { inherited: true }); },
      record => { Object.defineProperty(record.subjects[0]!, "toJSON", { get() { getters++; return () => ({}); } }); },
      record => { record.subjects[0]!.path = [-0, 0]; },
      record => { record.subjects[0]!.path = [0.5]; },
      record => { record.subjects[0]!.path = [Number.MAX_SAFE_INTEGER + 1]; },
      record => { record.subjects[0]!.path = [Infinity]; },
      record => { record.subjects[0]!.path = [-1]; },
      record => { record.subjects[0]!.path = [0, 0]; },
      record => { record.subjects[0]!.path = [0, 0, 0, 0, 0, 0, 0, 0]; },
      record => { record.subjects[0]!.path = [9]; },
      record => { Object.assign(record.subjects[0]!, { path: "0/0" }); },
    ];
    unchanged(f, () => { for (const mutate of mutations) { const input = mutable(valid); mutate(input); assert.throws(() => decode(input, f.context().root)); } });
    assert.equal(getters, 0);
    const nullPrototype = mutable(valid); Object.setPrototypeOf(nullPrototype, null); Object.setPrototypeOf(nullPrototype.document, null);
    assert.deepEqual(decode(nullPrototype, f.context().root), valid);
  });
  check("resource limits reject before traversing oversized arrays", () => {
    const f = fixture(), valid = encode(f.state, f.context(), f.demanded);
    for (const field of ["document", "occurrences", "subjects"] as const) {
      const input = mutable(valid); input[field].length = (field === "document" ? limits.bindings : limits[field]) + 1;
      unchanged(f, () => assert.throws(() => decode(input, f.context().root), /resource bound/));
    }
    const input = mutable(valid); input.subjects[0]!.path = Array(limits.pathDepth + 1).fill(0);
    assert.throws(() => decode(input, f.context().root), /resource bound/);
  });
  check("resource budgets include bindings across scopes and repeated path segments across the record", () => {
    const f = fixture();
    const bindings = (length: number, path: number[]) => Array.from({ length }, (_, index) => ({ name: `n${String(index).padStart(5, "0")}`, kind: "element", path }));
    const half = limits.bindings / 2;
    unchanged(f, () => assert.throws(() => decode({ document: bindings(half, [0]), subjects: [],
      occurrences: [{ root: [0, 0, 0], parent: null, bindings: bindings(half + 1, [0, 0, 0]) }],
    }, f.context().root), /resource bound/));
    let node: HsonNode = { $_tag: "button", $_content: [] };
    for (let depth = 0; depth < 64; depth++) node = { $_tag: "div", $_content: [{ $_tag: "_hson_elem", $_content: [node] }] };
    const root: HsonNode = { $_tag: "_hson_root", $_content: [node] }, coordinate = Array(129).fill(0);
    const count = Math.floor(limits.pathSegments / coordinate.length) + 1;
    assert.ok(count < limits.bindings);
    assert.throws(() => decode({ document: bindings(count, coordinate), occurrences: [], subjects: [] }, root), /path resource bound/);
  });
  check("runtime candidate validation requires live owner-issued overlay identities and Library-local lifetimes", () => {
    const f = fixture();
    unchanged(f, () => {
      assert.throws(() => make(f.context(), [{ name: "fake", kind: "element", quid: "zzzzzzzzz" }], []), /owner-issued/);
      assert.throws(() => encode(f.state, { ...f.context(), owner: {} }, []), /ownership/);
      assert.throws(() => make(f.context(), [], [{ ...f.scopes[2]!, lifetime: occurrence({}) }]), /lifetime/);
      assert.throws(() => make(f.context(), [], [{ ...f.scopes[2]!, parent: f.left }]), /not a live occurrence/);
      assert.throws(() => make(f.context(), [], [f.scopes[2]!, f.scopes[2]!]), /duplicate/);
      assert.throws(() => make(f.context(), [], [f.scopes[2]!, { ...f.scopes[2]!, lifetime: occurrence(f.owner) }]), /duplicate occurrence root/);
      assert.throws(() => encode(f.state, { ...f.context(), overlay: { size: 0, pathForQuid: () => undefined, quidAtPath: () => undefined } }, []), /active overlay/);
      assert.throws(() => encode(f.state, f.context(), ["zzzzzzzzz"]), /owner-issued/);
    });
  });
  check("mutable lifetime markers reject at admission without freezing or changing caller storage", () => {
    const f = fixture(), lifetime = { ...f.right }, key = Reflect.ownKeys(f.right)[0]!;
    const descriptor = Object.getOwnPropertyDescriptor(lifetime, key);
    unchanged(f, () => assert.throws(() => make(f.context(), [], [{ ...f.scopes[2]!, lifetime }]), /immutable own-data/));
    assert.equal(Object.isFrozen(lifetime), false);
    assert.deepEqual(Object.getOwnPropertyDescriptor(lifetime, key), descriptor);
    const sealed = Object.seal({ ...f.right });
    assert.throws(() => make(f.context(), [], [{ ...f.scopes[2]!, lifetime: sealed }]), /immutable own-data/);
    const inherited = Object.freeze(Object.create(f.right));
    assert.throws(() => make(f.context(), [], [{ ...f.scopes[2]!, lifetime: inherited }]), /immutable own-data/);
  });
  check("frozen accessor-backed lifetimes reject without reading even an initially correct owner", () => {
    const f = fixture(), key = Reflect.ownKeys(f.right)[0]!;
    let reads = 0;
    for (const initialOwner of [f.owner, {}]) {
      let apparentOwner = initialOwner;
      const lifetime = { ...f.right };
      Object.defineProperty(lifetime, key, { get() { reads++; return apparentOwner; } });
      Object.freeze(lifetime);
      const descriptor = Object.getOwnPropertyDescriptor(lifetime, key);
      unchanged(f, () => {
        assert.throws(() => make(f.context(), [], [{ ...f.scopes[2]!, lifetime }]), /immutable own-data/);
        assert.throws(() => encode({ ...f.state, occurrences: [{ ...f.scopes[2]!, lifetime }] }, f.context(), []), /immutable own-data/);
        apparentOwner = {};
        assert.throws(() => make(f.context(), [], [{ ...f.scopes[2]!, lifetime }]), /immutable own-data/);
      });
      assert.deepEqual(Object.getOwnPropertyDescriptor(lifetime, key), descriptor);
    }
    assert.equal(reads, 0);
  });
  check("parent lifetime references require the same immutable own-data ownership evidence", () => {
    const f = fixture(), key = Reflect.ownKeys(f.left)[0]!;
    const mutableParent = { ...f.left }, accessorParent = { ...f.left };
    let reads = 0;
    Object.defineProperty(accessorParent, key, { get() { reads++; return f.owner; } });
    Object.freeze(accessorParent);
    for (const parent of [mutableParent, accessorParent]) unchanged(f, () => {
      // Validate the parent marker itself even when no matching occurrence is present.
      assert.throws(() => make(f.context(), [], [{ ...f.scopes[1]!, parent }]), /immutable own-data/);
      assert.throws(() => make(f.context(), f.document, [
        { ...f.scopes[0]!, lifetime: parent }, { ...f.scopes[1]!, parent }, f.scopes[2]!,
      ]), /immutable own-data/);
    });
    assert.equal(reads, 0);
    assert.equal(Object.isFrozen(mutableParent), false);
  });
  check("factory-issued immutable marker identities survive candidate construction", () => {
    const f = fixture(), candidate = make(f.context(), f.document, f.scopes);
    for (const [index, source] of f.scopes.entries()) {
      assert.equal(candidate.occurrences[index]!.lifetime, source.lifetime);
      assert.equal(candidate.occurrences[index]!.parent, source.parent);
      assert.equal(Object.isFrozen(source.lifetime), true);
      const descriptor = Object.getOwnPropertyDescriptor(source.lifetime, Reflect.ownKeys(source.lifetime)[0]!);
      assert.deepEqual(descriptor, { value: f.owner, enumerable: true, configurable: false, writable: false });
    }
    assert.deepEqual(encode(candidate, f.context(), f.demanded), encode(f.state, f.context(), f.demanded));
  });
  check("retiring unrelated scopes preserves surviving lifetime and parent marker identity", () => {
    const f = fixture(), remaining = retire(f.state, [f.right]);
    assert.equal(remaining.occurrences[0]!.lifetime, f.left);
    assert.equal(remaining.occurrences[1]!.lifetime, f.inner);
    assert.equal(remaining.occurrences[1]!.parent, f.left);
    const rebuilt = make(f.context(), remaining.document, remaining.occurrences);
    assert.equal(rebuilt.occurrences[0]!.lifetime, f.left);
    assert.equal(rebuilt.occurrences[1]!.parent, f.left);
    assert.deepEqual(encode(rebuilt, f.context(), []), encode(remaining, f.context(), []));
  });
  check("external mutation attempts cannot change admitted marker authority topology or encoding", () => {
    const f = fixture(), before = JSON.stringify(encode(f.state, f.context(), f.demanded));
    unchanged(f, () => {
      for (const lifetime of [f.left, f.inner, f.right]) {
        const key = Reflect.ownKeys(lifetime)[0]!;
        assert.equal(Reflect.set(lifetime, key, {}), false);
        assert.equal(Reflect.deleteProperty(lifetime, key), false);
        assert.equal(Reflect.defineProperty(lifetime, key, { get() { throw Error("must never be read"); } }), false);
        assert.equal(Reflect.setPrototypeOf(lifetime, {}), false);
      }
      f.scopes[0] = { ...f.scopes[0]!, lifetime: occurrence(f.owner) };
      f.scopes[1] = { ...f.scopes[1]!, parent: null };
      assert.equal(f.state.occurrences[0]!.lifetime, f.left);
      assert.equal(f.state.occurrences[1]!.parent, f.left);
      assert.equal(JSON.stringify(encode(f.state, f.context(), f.demanded)), before);
    });
  });
  check("live Proxies around genuine lifetime markers reject instead of entering immutable candidates", () => {
    const f = fixture(), lifetime = new Proxy(f.right, {});
    unchanged(f, () => {
      assert.throws(() => make(f.context(), [], [{ ...f.scopes[2]!, lifetime }]), /factory-issued/);
      assert.throws(() => encode({ ...f.state, occurrences: [{ ...f.scopes[2]!, lifetime }] }, f.context(), []), /factory-issued/);
    });
  });
  check("live and revoked Proxy markers reject before any reflection traps", () => {
    const f = fixture(); let traps = 0;
    const trap = () => { traps++; throw Error("marker reflection trap must not run"); };
    const wrapped = Proxy.revocable(f.right, {
      get: trap, getOwnPropertyDescriptor: trap, getPrototypeOf: trap, ownKeys: trap, isExtensible: trap,
    });
    const reject = () => {
      assert.throws(() => make(f.context(), [], [{ ...f.scopes[2]!, lifetime: wrapped.proxy }]), /factory-issued/);
      assert.throws(() => encode({ ...f.state, occurrences: [{ ...f.scopes[2]!, lifetime: wrapped.proxy }] }, f.context(), []), /factory-issued/);
    };
    unchanged(f, () => { reject(); wrapped.revoke(); reject(); });
    assert.equal(traps, 0);
  });
  check("proxied parent references reject even when the genuine parent is live", () => {
    const f = fixture(); let traps = 0;
    const trap = () => { traps++; throw Error("parent marker reflection trap must not run"); };
    const wrapped = Proxy.revocable(f.left, { getOwnPropertyDescriptor: trap, isExtensible: trap, ownKeys: trap });
    unchanged(f, () => {
      const scopes = [f.scopes[0]!, { ...f.scopes[1]!, parent: wrapped.proxy }, f.scopes[2]!];
      assert.throws(() => make(f.context(), f.document, scopes), /factory-issued/);
      assert.throws(() => encode({ ...f.state, occurrences: scopes }, f.context(), []), /factory-issued/);
      assert.throws(() => make(f.context(), f.document, [
        { ...f.scopes[0]!, lifetime: wrapped.proxy }, scopes[1]!, f.scopes[2]!,
      ]), /factory-issued/);
      wrapped.revoke();
      assert.throws(() => make(f.context(), f.document, scopes), /factory-issued/);
    });
    assert.equal(traps, 0);
  });
  check("revoking rejected wrappers after unrelated retirement cannot invalidate accepted candidates", () => {
    const f = fixture(), wrapped = Proxy.revocable(f.left, {});
    unchanged(f, () => {
      const accepted = make(f.context(), f.document, f.scopes);
      assert.throws(() => make(f.context(), f.document, [
        { ...f.scopes[0]!, lifetime: wrapped.proxy }, { ...f.scopes[1]!, parent: wrapped.proxy }, f.scopes[2]!,
      ]), /factory-issued/);
      const remaining = retire(accepted, [f.right]);
      const before = JSON.stringify(encode(remaining, f.context(), []));
      wrapped.revoke();
      assert.equal(remaining.occurrences[0]!.lifetime, f.left);
      assert.equal(remaining.occurrences[1]!.parent, f.left);
      assert.equal(JSON.stringify(encode(remaining, f.context(), [])), before);
      assert.deepEqual(encode(make(f.context(), remaining.document, remaining.occurrences), f.context(), []),
        encode(remaining, f.context(), []));
      assert.deepEqual(encode(accepted, f.context(), []), encode(f.state, f.context(), []));
    });
  });
  check("frozen copies and fabricated lookalikes reject despite identical owner descriptors", () => {
    const f = fixture(), copied = Object.freeze({ ...f.right });
    const fabricated: typeof f.right = Object.freeze(Object.create(Object.getPrototypeOf(f.right), Object.getOwnPropertyDescriptors(f.right)));
    for (const lifetime of [copied, fabricated]) {
      assert.notEqual(lifetime, f.right);
      assert.equal(Object.isFrozen(lifetime), true);
      assert.deepEqual(Object.getOwnPropertyDescriptors(lifetime), Object.getOwnPropertyDescriptors(f.right));
      unchanged(f, () => assert.throws(() => make(f.context(), [], [{ ...f.scopes[2]!, lifetime }]), /factory-issued/));
    }
  });
  check("fresh factory markers work across Library owners while wrong-owner markers remain invalid", () => {
    const one = fixture("a"), two = fixture("b");
    for (const f of [one, two]) unchanged(f, () => {
      const lifetime = occurrence(f.owner), next = occurrence(f.owner);
      assert.notEqual(lifetime, next);
      for (const marker of [lifetime, next]) {
        const candidate = make(f.context(), [], [{ ...f.scopes[2]!, lifetime: marker }]);
        assert.equal(candidate.occurrences[0]!.lifetime, marker);
        assert.equal(encode(candidate, f.context(), []).occurrences.length, 1);
      }
    });
    unchanged(one, () => {
      assert.throws(() => make(one.context(), [], [{ ...one.scopes[2]!, lifetime: two.right }]), /Library ownership/);
      assert.throws(() => make(one.context(), [], [{ ...one.scopes[1]!, parent: two.left }]), /Library ownership/);
    });
  });
  check("encoding and decoding never issue QUIDs, install state, or acquire handles", () => {
    const f = fixture(); let attempts = 0;
    set_livemap_quid_candidate_source_for_tests(f.aggregate.identityEpoch().owner, () => { attempts++; throw Error("unexpected allocation"); });
    set_livemap_document_quid_candidate_source_for_tests(f.page.document, () => { attempts++; throw Error("unexpected acquisition"); });
    const random = mock.method(globalThis.crypto, "getRandomValues", () => { attempts++; throw Error("unexpected random identity"); });
    try {
      unchanged(f, () => {
        const state = make(f.context(), f.document, f.scopes);
        for (let index = 0; index < 3; index++) {
          const record = encode(state, f.context(), f.demanded);
          assert.deepEqual(decode(JSON.parse(JSON.stringify(record)), f.context().root), record);
          assert.equal(equal(record, decode(record, f.context().root)), true);
        }
        assert.throws(() => decode({ subjects: [] }, f.context().root));
        const mutableLifetime = { ...f.right }, accessorLifetime = { ...f.left };
        const key = Reflect.ownKeys(f.left)[0]!;
        Object.defineProperty(accessorLifetime, key, { get() { throw Error("unexpected owner getter"); } });
        Object.freeze(accessorLifetime);
        const before = encode(state, f.context(), f.demanded);
        assert.throws(() => make(f.context(), [], [{ ...f.scopes[2]!, lifetime: mutableLifetime }]), /immutable own-data/);
        assert.throws(() => make(f.context(), [], [{ ...f.scopes[0]!, lifetime: accessorLifetime }]), /immutable own-data/);
        assert.throws(() => make(f.context(), [], [{ ...f.scopes[1]!, parent: accessorLifetime }]), /immutable own-data/);
        const wrapped = Proxy.revocable(f.right, {}), live = new Proxy(f.right, {});
        wrapped.revoke();
        for (const lifetime of [live, wrapped.proxy, Object.freeze({ ...f.right })]) {
          assert.throws(() => make(f.context(), [], [{ ...f.scopes[2]!, lifetime }]), /factory-issued/);
          assert.throws(() => make(f.context(), [], [{ ...f.scopes[1]!, parent: lifetime }]), /factory-issued/);
        }
        assert.deepEqual(encode(state, f.context(), f.demanded), before);
        assert.equal(Object.isFrozen(mutableLifetime), false);
      });
    } finally {
      random.mock.restore();
      set_livemap_quid_candidate_source_for_tests(f.aggregate.identityEpoch().owner, undefined);
      set_livemap_document_quid_candidate_source_for_tests(f.page.document, undefined);
    }
    assert.equal(attempts, 0); assert.equal(f.page.q("next"), undefined);
  });
}
