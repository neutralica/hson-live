// @hson-live-external-test
import assert from "node:assert/strict";
import { admit_owned_livemap_root, admit_public_livemap_root } from "../src/api/livemap/livemap.node-admission.ts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import { is_Node } from "../src/core/node-guards.ts";
import type { HsonNode, Primitive } from "../src/core/types.ts";
import { LiveMapDocumentMutationError } from "../src/api/livemap/livemap.error.ts";
import { TransformError } from "../src/core/errors.ts";
import { create_test_event_emitter } from "./test-events.mjs";
import { hsonLiveMap } from "../src/api/livemap/livemap.facade.ts";
import { make_livemap_registry_authority } from "../src/api/livemap/livemap.core.ts";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";
import { prepare_livemap_root } from "../src/api/livemap/livemap.document.ts";
import { validate_document_path } from "../src/api/livemap/livemap.document.path.ts";
import { reconstructed_data_internal } from "../src/api/livemap/livemap.libraries.ts";
import { enumerate_livemap_issued_quids } from "../src/api/livemap/livemap.identity-epoch.ts";
import { capture_internal_document } from "./helpers/document-capture.mts";
import { acquire_document_identity } from "./helpers/livemap-identity-internal.mts";
import { capture_livemap_document, validate_livemap_document_admission } from "../src/api/livemap/livemap.document.capture.ts";
import { prepare_document_install, restore_livemap_document_capture } from "../src/api/livemap/livemap.document.install.ts";
import type { LiveMapDocumentInstallController } from "../src/api/livemap/livemap.document.install.ts";
import { ANY_DOCUMENT } from "../src/api/schema/hson-schema.ts";
import { livemap_document_identity_quids } from "../src/api/livemap/livemap.document.identity.ts";
import { admit_public_document_graph_operation } from "../src/api/livemap/livemap.document.mutation.ts";
import type { LiveMapGraphInsertContentOp, LiveMapGraphOp } from "../src/types/livemap.types.ts";
import type { LiveMap } from "../src/types/livemap.types.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.node-exact", title: "Exact LiveMap raw graph admission", category: "LiveMap", runtime: "node",
  tags: Object.freeze(["ingress", "canonical", "identity", "atomicity", "externally-discoverable"]),
});
const events = create_test_event_emitter("livemap.node-exact");
let checks = 0;
function check(name: string, run: () => void): void {
  events.case_begin(name, name);
  try { run(); events.case_end(name, "pass"); console.log(`ok ${++checks} - ${name}`); }
  catch (error) { events.case_end(name, "fail"); events.terminal("fail"); throw error; }
}
const node = (tag: string, ...content: HsonNode[]): HsonNode => ({ $_tag: tag, $_content: content });
const root = (...content: HsonNode[]) => node("_hson_root", ...content);
const elem = (...content: HsonNode[]) => node("_hson_elem", ...content);
const obj = (...content: HsonNode[]) => node("_hson_obj", ...content);
const str = (text: string): HsonNode => ({ $_tag: "_hson_str", $_content: [text] });
const val = (value: Exclude<Primitive, string>): HsonNode => ({ $_tag: "_hson_val", $_content: [value] });
const arr = (...content: HsonNode[]) => node("_hson_arr", ...content.map((value, index): HsonNode => ({
  $_tag: "_hson_ii", $_meta: { index: String(index) }, $_content: [value],
})));
function child(parent: HsonNode, index = 0): HsonNode { const value = parent.$_content[index]; assert.ok(is_Node(value)); return value; }
function same(actual: HsonNode, expected: HsonNode): void { assert.equal(canonical_hson_graph_equal(actual, expected), true); }
function rejects(input: unknown, family: "data" | "document"): void {
  assert.throws(() => admit_public_livemap_root(input, family, "test.raw"), error => error instanceof TransformError
    && error.stage === "source-admission" && typeof error.path === "string");
}

check("private data qualification preserves complete values and authorized ROOT", () => {
  const ordered = obj(node("10", obj(val(-0))), node("2", arr(str("\ud800\u0000"), val(true), val(null))), node("", obj()));
  for (const value of [str(""), val(-0), val(false), val(null), obj(), arr(), ordered]) {
    for (const input of [value, root(value)]) same(admit_owned_livemap_root(input, "data"), input);
  }
  for (const input of [obj(val(1)), obj(str("x")), obj(obj()), obj(arr()), root(obj(val(1))), root(obj(), obj())]) rejects(input, "data");
});
check("document ownership retains empty ROOT, ordered content and nested relationships", () => {
  for (const input of [root(), root(node("p")), root(str("")), root(str("a"), str(""), str("b"), node("p"), node("q", elem(str("x")))), root(elem(str("x"))), elem(node("p"))]) {
    same(admit_owned_livemap_root(input, "document"), input);
  }
  for (const input of [root(elem()), root(node("p", obj())), root(val(1)), root(root()), root(elem(node("p")), node("q"))]) rejects(input, "document");
});
check("qualified carrier projection does not introduce inherited metadata", () => {
  const input = admit_owned_livemap_root(root(elem(node("p"))), "document");
  const expected = admit_owned_livemap_root(root(node("p")), "document");
  const prior = Object.getOwnPropertyDescriptor(Object.prototype, "$_meta"); let calls = 0;
  Object.defineProperty(Object.prototype, "$_meta", { configurable: true, get() { calls++; return { quid: "000000001" }; } });
  try {
    same(prepare_livemap_root(input, "document").root, expected); assert.equal(calls, 0);
  } finally {
    if (prior === undefined) Reflect.deleteProperty(Object.prototype, "$_meta");
    else Object.defineProperty(Object.prototype, "$_meta", prior);
  }
});
check("runtime attrs and meaningful style field presence survive exact capture", () => {
  const input = root({ ...node("p"), $_attrs: {
    text: "\ud800", n: -0, yes: true, no: false, nil: null,
    style: { width: { value: -0, unit: undefined }, color: " red ", opacity: 0 },
  } });
  const copied = admit_public_livemap_root(input, "document", "test.attrs");
  same(copied, input);
  assert.notEqual(copied, input); assert.equal(Object.isFrozen(input), false);
  for (const style of [" color: red ", {}]) {
    const styled = root(node("p")); Reflect.set(child(styled), "$_attrs", { style });
    same(admit_owned_livemap_root(styled, "document"), styled);
  }
  for (const value of [Infinity, -Infinity, NaN, undefined, {}, []]) {
    const bad = root(node("p")); Reflect.set(child(bad), "$_attrs", { value }); rejects(bad, "document");
  }
});
check("invalid storage rejects without getters or caller iterators", () => {
  let calls = 0;
  const candidates: HsonNode[] = [];
  for (const field of ["$_attrs", "$_meta"]) {
    for (const value of [{}, undefined]) { const bad = root(node("p")); Reflect.set(bad, field, value); candidates.push(bad); }
  }
  const unknown = root(); Reflect.set(unknown, "extra", true); candidates.push(unknown);
  const symbol = root(); Reflect.set(symbol, Symbol("decoration"), true); candidates.push(symbol);
  const accessor = root(); Object.defineProperty(accessor, "$_meta", { enumerable: true, get() { calls++; return { quid: "000000001" }; } }); candidates.push(accessor);
  const hidden = root(); Object.defineProperty(hidden, "$_content", { value: [], enumerable: false }); candidates.push(hidden);
  const inherited: HsonNode = Object.create({ $_meta: { quid: "000000001" } }); inherited.$_tag = "_hson_root"; inherited.$_content = []; candidates.push(inherited);
  const sparse = root(); sparse.$_content.length = 1; candidates.push(sparse);
  const iterator = root(); Object.defineProperty(iterator.$_content, Symbol.iterator, { value() { calls++; throw new Error("iterator invoked"); } }); candidates.push(iterator);
  const method = root(); Reflect.set(method.$_content, "map", () => { calls++; return []; }); candidates.push(method);
  const nested = root(node("p", elem(node("b")))); Reflect.set(child(nested), "$_attrs", {}); candidates.push(nested);
  const cycle = root(); cycle.$_content.push(cycle); candidates.push(cycle);
  for (const candidate of candidates) rejects(candidate, "document");
  assert.equal(calls, 0);
});
check("physical II order and metadata are qualified before copying can repair them", () => {
  const correct = root(arr(val(1), val(-0))); same(admit_owned_livemap_root(correct, "data"), correct);
  const reversed = root(arr(val(1), val(2)));
  const content = reversed.$_content[0]; assert.ok(content && typeof content === "object"); content.$_content.reverse(); rejects(reversed, "data");
  assert.equal(content.$_content[0] && typeof content.$_content[0] === "object" ? content.$_content[0].$_meta?.index : undefined, "1");
  const wrong = arr(val(1)); const item = wrong.$_content[0]; assert.ok(item && typeof item === "object"); item.$_meta = { index: "00" }; rejects(wrong, "data");
});
check("structural QUID qualification is separate from public identity authority", () => {
  for (const quid of ["000000001", "bad", undefined]) {
    const input = root(node("p")); Reflect.set(child(input), "$_meta", { quid }); rejects(input, "document");
  }
  const owned = root({ ...node("p"), $_meta: { quid: "000000001" } });
  same(admit_owned_livemap_root(owned, "document"), owned);
});

function state(map: LiveMap) {
  const authority = internal_livemap_aggregate_authority(map);
  return { revision: map.rev, libraries: authority.libraries(),
    roots: authority.inspect().libraries.map(library => admit_owned_livemap_root(authority.root(library.identity), library.mode === "document" ? "document" : "data")),
    overlays: authority.inspect().libraries.filter(library => library.mode === "document").map(library => {
      const overlay = authority.documentOverlay(library.identity);
      return livemap_document_identity_quids(overlay).map(quid => [quid, overlay.pathForQuid(quid)]);
    }),
    epoch: authority.identityEpoch().current(), issued: enumerate_livemap_issued_quids(authority.identityEpoch().issued()),
    capture: map.capture(),
  };
}
function unchanged(map: LiveMap, before: ReturnType<typeof state>): void {
  const after = state(map);
  assert.equal(after.revision, before.revision); assert.deepEqual(after.libraries, before.libraries);
  assert.deepEqual(after.overlays, before.overlays); assert.equal(after.epoch, before.epoch); assert.deepEqual(after.issued, before.issued); assert.deepEqual(after.capture, before.capture);
  assert.equal(after.roots.length, before.roots.length);
  after.roots.forEach((value, index) => same(value, before.roots[index]));
}
function malformed_documents(): HsonNode[] {
  const values = [root(elem()), root(node("p", obj())), root(root()), root(val(1))];
  for (const field of ["$_attrs", "$_meta"]) {
    for (const value of [{}, undefined]) { const input = root(node("p")); Reflect.set(input, field, value); values.push(input); }
  }
  const decorated = root(node("p")); Reflect.set(child(decorated), "unexpected", true); values.push(decorated);
  const nested = root(node("p", elem(node("b")))); child(child(child(nested))).$_attrs = {}; values.push(nested);
  const cycle = root(); cycle.$_content.push(cycle); values.push(cycle);
  return values;
}
check("public initial roots and library additions reject repairs without publication", () => {
  const map = hsonLiveMap.fromLibraries({ page: { document: root(node("p")) } });
  let notifications = 0; map.commits.observe(() => notifications++);
  const before = state(map);
  for (const input of malformed_documents()) {
    assert.throws(() => hsonLiveMap.fromLibraries({ page: { document: input } }));
    assert.throws(() => map.addLibraries({ rejected: { document: input } }));
    unchanged(map, before); assert.equal(notifications, 0);
  }
  const canonical = root(node("p", elem(str("x"))));
  const accepted = map.addLibraries({ accepted: { document: canonical } });
  assert.equal(accepted.rev, before.revision + 1); assert.equal(notifications, 1);
  canonical.$_content.length = 0;
  same(internal_livemap_aggregate_authority(map).root(internal_livemap_aggregate_authority(map).libraries()[1]), root(node("p", elem(str("x")))));
});
check("public and internal root boundaries never read getter or inherited QUID claims", () => {
  let calls = 0;
  const getter = root(node("p")); Object.defineProperty(child(getter), "$_meta", { enumerable: true, get() { calls++; return { quid: "000000001" }; } });
  const inherited: HsonNode = Object.create({ $_meta: { quid: "000000001" } }); inherited.$_tag = "p"; inherited.$_content = [];
  const tagGetter = root(); Object.defineProperty(tagGetter, "$_tag", { enumerable: true, get() { calls++; return "_hson_root"; } });
  const hidden = root(node("p")); child(hidden).$_meta = {}; Object.defineProperty(child(hidden).$_meta, "quid", { value: "000000001", enumerable: false });
  const map = hsonLiveMap.fromLibraries({ page: { document: root(node("p")) } }); const before = state(map);
  for (const input of [getter, root(inherited), tagGetter, hidden]) {
    assert.throws(() => hsonLiveMap.fromLibraries({ page: { document: input } }));
    assert.throws(() => map.addLibraries({ rejected: { document: input } }));
    assert.throws(() => prepare_livemap_root(input, "document")); unchanged(map, before);
  }
  assert.equal(calls, 0);
});
check("owned data engine admits exact data and rejects array sorting or scalar-carrier repair", () => {
  const ordered = root(obj(node("10", obj(val(-0))), node("2", arr(str("\ud800"), val(null)))));
  for (const input of [str(""), val(-0), obj(), arr(), ordered]) {
    const expected = admit_owned_livemap_root(input, "data");
    const built = make_livemap_registry_authority([{ root: input, family: "data" }]);
    const identity = built.identities[0]; assert.ok(identity);
    same(built.aggregate.root(identity), input);
    input.$_content.length = 0;
    assert.notEqual(built.aggregate.root(identity), input); same(built.aggregate.root(identity), expected);
  }
  const reversed = root(arr(val(1), val(2))); child(reversed).$_content.reverse();
  const map = hsonLiveMap.fromLibraries({ state: { data: { value: 1 } } });
  const authority = internal_livemap_aggregate_authority(map); const before = state(map);
  for (const input of [reversed, root(obj(val(1))), root(obj(str("x"))), root(obj(obj())), root(obj(arr()))]) {
    assert.throws(() => prepare_livemap_root(input, "data"));
    assert.throws(() => reconstructed_data_internal(input));
    assert.throws(() => authority.addLibraries([{ name: "rejected", root: input, family: "data", hsonSchema: authority.librarySchema(authority.libraries()[0]) }]));
    unchanged(map, before);
  }
  assert.equal(child(child(reversed)).$_meta?.index, "1");
});
check("document ROOT semantics, runtime attrs and caller isolation survive ownership", () => {
  const inputs = [root(), root(node("p")), root(str("")), root(node("p"), str("a"), str(""), str("\ud800\u0000"), node("q")), root(elem(str("x")))];
  for (const input of inputs) {
    const expected = input.$_content.length === 1 && child(input).$_tag === "_hson_elem" ? root(...child(input).$_content.filter(is_Node)) : input;
    const map = hsonLiveMap.fromLibraries({ page: { document: input } }); const page = map.lib("page");
    same(page.root(), expected); const before = state(map);
    input.$_content.length = 0; page.root().$_content.length = 0; unchanged(map, before);
    assert.equal(Object.isFrozen(input), false);
  }
  for (const style of [" color: red ", {}, { width: { value: -0 } }, { width: { value: -0, unit: "" } }]) {
    const input = root(node("p")); Reflect.set(child(input), "$_attrs", { style });
    same(hsonLiveMap.fromLibraries({ page: { document: input } }).lib("page").root(), input);
  }
  const styled = root({ ...node("p"), $_attrs: { n: -0, yes: true, nil: null, style: { width: { value: -0, unit: undefined } } } });
  const page = hsonLiveMap.fromLibraries({ page: { document: styled } }).lib("page");
  same(page.root(), styled);
  const style = child(page.root()).$_attrs?.style; assert.ok(style && typeof style === "object");
  const width = style.width; assert.ok(width && typeof width === "object");
  assert.equal(Object.hasOwn(width, "unit"), true); assert.equal(Object.is(width.value, -0), true);
  for (const value of [Infinity, -Infinity, NaN, undefined, {}]) {
    const bad = root(node("p")); Reflect.set(child(bad), "$_attrs", { value });
    assert.throws(() => hsonLiveMap.fromLibraries({ page: { document: bad } }));
  }
});
check("raw insert and replace requests reject nested defects before owner/identity changes", () => {
  const map = hsonLiveMap.fromLibraries({ page: { document: root(node("p", elem(node("b")))) } });
  const page = map.lib("page"); const target = { kind: "path" as const, path: [0, 0] };
  const identity = acquire_document_identity(page.document, { kind: "path", path: [0] });
  let notifications = 0; map.commits.observe(() => notifications++); const before = state(map);
  let calls = 0;
  const getter = node("i"); Object.defineProperty(getter, "$_meta", { enumerable: true, get() { calls++; return { quid: "000000001" }; } });
  const symbol = node("i"); Reflect.set(symbol, Symbol("decoration"), true);
  const inherited: HsonNode = Object.create({ $_meta: { quid: "000000001" } }); inherited.$_tag = "i"; inherited.$_content = [];
  const empty = node("i", elem(node("b"))); child(child(empty)).$_attrs = {};
  const nonfinite = node("i"); Reflect.set(nonfinite, "$_attrs", { n: Infinity });
  const cycle = node("i", elem()); child(cycle).$_content.push(cycle);
  for (const input of [getter, symbol, inherited, empty, nonfinite, cycle, elem(), obj(val(1)), node("i", obj()), root(), { ...node("i"), $_meta: { quid: "000000001" } }]) {
    assert.throws(() => page.document.content.insert(target, 0, input));
    assert.throws(() => page.document.content.replace(target, 0, input));
    unchanged(map, before); assert.equal(notifications, 0); assert.equal(identity.active, true);
  }
  assert.equal(calls, 0);
  const input = node("i", elem(str("a"), str(""), str("\ud800"), node("u")));
  page.document.content.insert(target, 1, input);
  const accepted = state(map); input.$_content.length = 0; unchanged(map, accepted);
  same(child(child(child(page.root())), 1), node("i", elem(str("a"), str(""), str("\ud800"), node("u"))));
  assert.equal(notifications, 1); assert.equal(identity.active, true);
});
check("staged raw content is qualified before envelope cloning and publication", () => {
  const map = hsonLiveMap.fromLibraries({ page: { document: root(node("p", elem(node("b")))) } });
  let notifications = 0; map.commits.observe(() => notifications++); const before = state(map);
  let calls = 0;
  const getter = node("i"); Object.defineProperty(getter, "$_meta", { enumerable: true, get() { calls++; return { quid: "000000001" }; } });
  const symbol = node("i"); Reflect.set(symbol, Symbol("decoration"), true);
  for (const input of [getter, symbol, { ...node("i"), $_attrs: {} }, node("i", obj()), elem(), { ...node("i"), $_meta: { quid: "000000001" } }]) {
    assert.throws(() => map.batch(writer => {
      writer.lib("page").graph({ domain: "graph", op: "set-attr", target: { kind: "path", path: validate_document_path([0]) }, name: "temporary", value: true });
      writer.lib("page").graph({ domain: "graph", op: "insert-content", target: { kind: "path", path: validate_document_path([0, 0]) }, index: 1, content: input });
    }));
    assert.throws(() => map.batch(writer => writer.lib("page").at([0, 0, 0]).replace(input)));
    unchanged(map, before); assert.equal(notifications, 0);
  }
  assert.equal(calls, 0);
  const input = { ...node("i"), $_attrs: { style: { width: { value: -0, unit: undefined } } } };
  map.batch(writer => {
    writer.lib("page").graph({ domain: "graph", op: "insert-content", target: { kind: "path", path: validate_document_path([0, 0]) }, index: 1, content: input });
    input.$_content.push(str("caller mutation after staging"));
    input.$_attrs.style.width.value = 2;
  });
  same(child(child(child(map.lib("page").root())), 1), {
    ...node("i"), $_attrs: { style: { width: { value: -0, unit: undefined } } },
  });
  assert.equal(notifications, 1);
});
check("same-epoch capability qualification is descriptor-safe and preserves sparse identity", () => {
  const map = hsonLiveMap.fromLibraries({ page: { document: root(node("p")) } }); const page = map.lib("page");
  const authority = internal_livemap_aggregate_authority(map); const library = authority.libraries()[0]; assert.ok(library);
  const identity = acquire_document_identity(page.document, { kind: "path", path: [0] });
  const quid = identity.snap()?.$_meta?.quid; assert.ok(quid);
  const capture = capture_internal_document(map, "page", { identity: "same-epoch" });
  const before = state(map);
  const continuity = () => authority.documentCaptureContinuity(library);
  assert.equal(validate_livemap_document_admission(authority.identityEpoch(), capture, "same-epoch", continuity), "same-epoch");
  const prepared = prepare_document_install(capture, "document", "same-epoch");
  assert.equal(prepared.overlay.quidAtPath(validate_document_path([0])), quid); same(prepared.root, capture.root);
  assert.throws(() => validate_livemap_document_admission(authority.identityEpoch(), { ...capture }, "same-epoch", continuity));
  const tampered = capture_internal_document(map, "page", { identity: "same-epoch" });
  let calls = 0; Object.defineProperty(child(tampered.root), "$_meta", { enumerable: true, get() { calls++; return { quid }; } });
  assert.throws(() => validate_livemap_document_admission(authority.identityEpoch(), tampered, "same-epoch", continuity));
  assert.equal(calls, 0); unchanged(map, before); assert.equal(identity.active, true);
});
check("same-epoch installation binds provenance to the actual admitted private graph", () => {
  const map = hsonLiveMap.fromLibraries({ page: { document: root(node("p")) } });
  const authority = internal_livemap_aggregate_authority(map); const library = authority.libraries()[0]; assert.ok(library);
  const before = state(map); let installs = 0;
  const controller: LiveMapDocumentInstallController = {
    mode: "document", rev: () => map.rev, overlay: () => authority.documentOverlay(library), identityEpoch: authority.identityEpoch(),
    apply: () => { installs++; throw new Error("unexpected apply"); }, restore: () => { installs++; },
  };
  // Use a capability with no hosted-continuity requirement for this installer seam.
  const sameEpoch = capture_livemap_document(authority.identityEpoch(), "document", map.rev, before.roots[0], authority.documentOverlay(library), { identity: "same-epoch" });
  let observations = 0;
  sameEpoch.root.$_content[0] = new Proxy(child(sameEpoch.root), {
    getOwnPropertyDescriptor(target, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
      return key === "$_tag" && descriptor !== undefined
        ? { ...descriptor, value: ++observations === 1 ? "p" : "forged" }
        : descriptor;
    },
  });
  assert.throws(() => restore_livemap_document_capture(controller, sameEpoch, { identity: "same-epoch" }));
  assert.equal(installs, 0); unchanged(map, before);
});
check("capture install rejects malformed roots atomically and preserves new-epoch policy", () => {
  const map = hsonLiveMap.fromLibraries({ page: { document: root(node("p")) } });
  const authority = internal_livemap_aggregate_authority(map); const library = authority.libraries()[0]; assert.ok(library);
  const before = state(map); let installs = 0;
  const controller: LiveMapDocumentInstallController = {
    mode: "document", rev: () => map.rev, overlay: () => authority.documentOverlay(library), identityEpoch: authority.identityEpoch(),
    apply: () => { installs++; throw new Error("unexpected apply"); }, restore: () => { installs++; },
  };
  for (const input of malformed_documents()) {
    const capture = { kind: "hson-document" as const, mode: "document" as const, rev: 0, root: input };
    assert.throws(() => restore_livemap_document_capture(controller, capture)); unchanged(map, before); assert.equal(installs, 0);
  }
  const identityRoot = root({ ...node("p"), $_meta: { quid: "000000001" } });
  for (const policy of ["reject", "strip"] as const) {
    assert.throws(() => restore_livemap_document_capture(controller, { kind: "hson-document", mode: "document", rev: 0, root: identityRoot }, { identity: policy }));
    unchanged(map, before); assert.equal(installs, 0);
  }
  for (const input of [root(), root(node("p"), str(""), node("q"))]) {
    same(prepare_document_install({ kind: "hson-document", mode: "document", rev: 0, root: input }, "document").root, input);
  }
  const portable = capture_internal_document(map, "page");
  restore_livemap_document_capture(controller, portable); assert.equal(installs, 1); unchanged(map, before);
  const handle = acquire_document_identity(map.lib("page").document, { kind: "path", path: [0] });
  map.restore(map.capture()); assert.equal(handle.active, false);
});


check("public library source selection evaluates changing configuration getters once", () => {
  const forged = root({ ...node("p"), $_meta: { quid: "000000001" } });
  const expectedForged = admit_owned_livemap_root(forged, "document");
  let reads = 0;
  const map = hsonLiveMap.fromLibraries({ page: { get document() { return ++reads <= 2 ? "<p/>" : forged; } } });
  assert.equal(reads, 1); same(map.lib("page").root(), root(node("p")));
  assert.deepEqual(state(map).issued, []); assert.deepEqual(state(map).overlays, [[]]);
  assert.equal(map.lib("page").document.byQuid("000000001"), undefined); same(forged, expectedForged);
  let outerReads = 0;
  const selected = hsonLiveMap.fromLibraries({ get page() { return ++outerReads === 1 ? { document: "<p/>" } : { document: forged }; } });
  assert.equal(outerReads, 1); same(selected.lib("page").root(), root(node("p")));
  assert.deepEqual(state(selected).issued, []);
});
check("selected public raw QUID rejects even when a later configuration read would be text", () => {
  const forged = root({ ...node("p"), $_meta: { quid: "000000001" } });
  const expected = admit_owned_livemap_root(forged, "document");
  let reads = 0; let published: LiveMap | undefined;
  const definition = { get document() { return ++reads === 1 ? forged : "<p/>"; } };
  assert.throws(() => { published = hsonLiveMap.fromLibraries({ page: definition }); }, error => error instanceof TransformError
    && error.code === "PORTABLE_RUNTIME_QUID_FORBIDDEN");
  assert.equal(published, undefined); assert.equal(reads, 1); same(forged, expected);
  let semanticCalls = 0;
  const accessor = root(node("p")); Object.defineProperty(child(accessor), "$_meta", { enumerable: true, get() { semanticCalls++; return { quid: "000000001" }; } });
  assert.throws(() => hsonLiveMap.fromLibraries({ page: { get document() { return accessor; } } }));
  assert.equal(semanticCalls, 0);
});
check("selected canonical source is privately admitted and configuration combinations remain valid", () => {
  const input = root(node("p", elem(str("x")))); let reads = 0; let schemaReads = 0; let dataReads = 0;
  const definitions = {
    page: { get document() { return ++reads === 1 ? input : root(node("q")); }, get schema() { schemaReads++; return ANY_DOCUMENT; } },
    state: { get data() { dataReads++; return { count: -0, list: [true, null] }; } },
    empty: { document: root() },
  };
  const map = hsonLiveMap.fromLibraries(definitions);
  assert.equal(reads, 1); assert.equal(schemaReads, 1); assert.equal(dataReads, 1);
  assert.equal(map.lib("page").schema.get(), ANY_DOCUMENT); same(map.lib("empty").root(), root());
  const before = state(map); input.$_content.length = 0; unchanged(map, before);
  same(map.lib("page").root(), root(node("p", elem(str("x")))));
  same(map.lib("state").root(), root(obj(node("count", obj(val(-0))), node("list", arr(val(true), val(null))))));
  let inheritedReads = 0;
  const inheritedSchema: { document: string } = Object.create({ get schema() { inheritedReads++; return ANY_DOCUMENT; } });
  inheritedSchema.document = "<p/>";
  same(hsonLiveMap.fromLibraries({ page: inheritedSchema }).lib("page").root(), root(node("p")));
  assert.equal(inheritedReads, 1);
  const contradictory = { document: "<p/>" }; Reflect.set(contradictory, "data", {});
  assert.throws(() => hsonLiveMap.fromLibraries({ bad: contradictory }));
});
check("library addition shares stable selection and rejects forged additions atomically", () => {
  const map = hsonLiveMap.fromLibraries({ page: { document: "<p/>" } });
  const handle = acquire_document_identity(map.lib("page").document, { kind: "path", path: [0] });
  const authority = internal_livemap_aggregate_authority(map); const library = authority.libraries()[0]; assert.ok(library);
  const capability = capture_internal_document(map, "page", { identity: "same-epoch" });
  let notifications = 0; map.commits.observe(() => notifications++); const before = state(map);
  const forged = root({ ...node("p"), $_meta: { quid: "000000001" } });
  let reads = 0;
  assert.throws(() => map.addLibraries({ earlier: { document: "<q/>" }, rejected: { get document() { return ++reads === 1 ? forged : "<p/>"; } } }),
    error => error instanceof TransformError && error.code === "PORTABLE_RUNTIME_QUID_FORBIDDEN");
  assert.equal(reads, 1); unchanged(map, before); assert.equal(notifications, 0); assert.equal(handle.active, true);
  assert.equal(validate_livemap_document_admission(authority.identityEpoch(), capability, "same-epoch", () => authority.documentCaptureContinuity(library)), "same-epoch");
  let acceptedReads = 0;
  map.addLibraries({ accepted: { get document() { return ++acceptedReads === 1 ? "<q/>" : forged; } } });
  assert.equal(acceptedReads, 1); assert.equal(map.rev, before.revision + 1); assert.equal(notifications, 1);
  same(map.lib("accepted").root(), root(node("q")));
  assert.deepEqual(state(map).issued, before.issued); assert.deepEqual(state(map).overlays, [...before.overlays, []]);
  const accepted = map.lib("accepted"); assert.equal(accepted.mode, "document");
  assert.equal(accepted.document.byQuid("000000001"), undefined);
});

function insert_instruction(content: HsonNode = node("i")): LiveMapGraphInsertContentOp {
  return { domain: "graph", op: "insert-content", target: { kind: "path", path: validate_document_path([0, 0]) }, index: 1, content };
}
function mutation_fixture() {
  const map = hsonLiveMap.fromLibraries({ page: { document: root(node("p", elem(node("b")))) } });
  const handle = acquire_document_identity(map.lib("page").document, { kind: "path", path: [0] });
  const authority = internal_livemap_aggregate_authority(map); const library = authority.libraries()[0]; assert.ok(library);
  const capability = capture_internal_document(map, "page", { identity: "same-epoch" });
  let notifications = 0; let documentNotifications = 0;
  map.commits.observe(() => notifications++); map.lib("page").commits.observe(() => documentNotifications++);
  const before = state(map);
  return { map, verify() {
    unchanged(map, before); assert.equal(notifications, 0); assert.equal(documentNotifications, 0); assert.equal(handle.active, true);
    assert.equal(validate_livemap_document_admission(authority.identityEpoch(), capability, "same-epoch", () => authority.documentCaptureContinuity(library)), "same-epoch");
  } };
}
function public_instruction_error(error: unknown): boolean {
  return error instanceof LiveMapDocumentMutationError && error.code === "INVALID_DOCUMENT_REPLACEMENT";
}
check("changing and stable accessor discriminants reject before semantic graph getters", () => {
  for (const changing of [true, false]) {
    const { map, verify } = mutation_fixture(); let semanticCalls = 0; let reads = 0;
    const bad = node("i"); Object.defineProperty(bad, "$_attrs", { enumerable: true, get() { semanticCalls++; return { id: "smuggled" }; } });
    Object.defineProperty(bad, "hidden", { value: true });
    const operation = insert_instruction(bad);
    Object.defineProperty(operation, "op", { enumerable: true, get() { reads++; return changing && reads <= 7 ? "remove-content" : "insert-content"; } });
    assert.throws(() => map.batch(writer => writer.lib("page").graph(operation)), public_instruction_error);
    assert.equal(reads, 0); assert.equal(semanticCalls, 0); verify();
    assert.throws(() => admit_public_document_graph_operation(operation), public_instruction_error);
    assert.equal(reads, 0); assert.equal(semanticCalls, 0); verify();
  }
});
check("target, path, index, domain and content envelopes are descriptor-safe", () => {
  for (const field of ["target", "path", "path-index", "index", "domain", "content", "replacement"]) {
    const { map, verify } = mutation_fixture(); let calls = 0;
    const operation: LiveMapGraphOp = field === "replacement"
      ? { domain: "graph", op: "replace-content", target: { kind: "path", path: validate_document_path([0, 0]) }, index: 0, replacement: node("i") }
      : insert_instruction();
    const target = { kind: "path" as const, path: [0, 0] };
    const envelope = field === "path" ? target : field === "path-index" ? target.path : operation;
    const name = field === "path-index" ? "0" : field;
    if (field === "path" || field === "path-index") Reflect.set(operation, "target", target);
    Object.defineProperty(envelope, name, { enumerable: true, get() {
      calls++; return field === "target" ? target : field === "path" ? [0, 0] : field === "content" || field === "replacement" ? node("i") : 0;
    } });
    assert.throws(() => map.batch(writer => writer.lib("page").graph(operation)), public_instruction_error);
    assert.equal(calls, 0); verify();
  }
});
check("selected raw staged content rejects hidden/accessor storage and public QUID atomically", () => {
  const { map, verify } = mutation_fixture(); let calls = 0;
  const bad = node("i"); Object.defineProperty(bad, "$_attrs", { enumerable: true, get() { calls++; return { id: "smuggled" }; } });
  Object.defineProperty(bad, "hidden", { value: true });
  for (const input of [bad, { ...node("i"), $_meta: { quid: "000000001" } }]) {
    assert.throws(() => map.batch(writer => {
      writer.lib("page").graph({ domain: "graph", op: "set-attr", target: { kind: "path", path: validate_document_path([0]) }, name: "temporary", value: true });
      writer.lib("page").graph(insert_instruction(input));
    }), error => input === bad ? public_instruction_error(error) : error instanceof TransformError && error.code === "PORTABLE_RUNTIME_QUID_FORBIDDEN");
    assert.equal(calls, 0); verify();
  }
});
check("staging retains one private instruction after caller changes every selected field", () => {
  const map = hsonLiveMap.fromLibraries({ page: { document: root(node("p", elem(node("b")))) } });
  let notifications = 0; map.commits.observe(() => notifications++);
  const input = node("i", elem(str("a"), str(""), str("\ud800"))); const operation = insert_instruction(input);
  map.batch(writer => {
    writer.lib("page").graph(operation);
    Reflect.set(operation, "op", "remove-content"); Reflect.set(operation, "index", 0);
    Reflect.set(operation.target, "path", validate_document_path([])); Reflect.set(operation, "content", node("q"));
    input.$_content.length = 0;
  });
  same(map.lib("page").root(), root(node("p", elem(node("b"), node("i", elem(str("a"), str(""), str("\ud800")))))));
  assert.equal(map.rev, 1); assert.equal(notifications, 1);
});
check("canonical insert, replace and remove instructions retain batch behavior", () => {
  const map = hsonLiveMap.fromLibraries({ page: { document: root(node("p", elem(node("b"), node("u")))) } });
  const handle = acquire_document_identity(map.lib("page").document, { kind: "path", path: [0] });
  let notifications = 0; map.commits.observe(() => notifications++);
  const target = { kind: "path" as const, path: validate_document_path([0, 0]) };
  map.batch(writer => {
    writer.lib("page").graph({ domain: "graph", op: "insert-content", target, index: 1, content: node("j") });
    const replacement = { domain: "graph" as const, op: "replace-content" as const, target, index: 0, replacement: node("k") };
    Reflect.set(replacement, "lineage", undefined);
    writer.lib("page").graph(replacement);
    writer.lib("page").graph({ domain: "graph", op: "remove-content", target, index: 1 });
  });
  same(map.lib("page").root(), root(node("p", elem(node("k"), node("u")))));
  assert.equal(map.rev, 1); assert.equal(notifications, 1); assert.equal(handle.active, true);
});


// Sequential prototype probes restore descriptors before assertions or publication.
function probe_instruction_queue(prototype: object, index: 0 | 1, run: () => void) {
  const key = String(index); const prior = Object.getOwnPropertyDescriptor(prototype, key);
  let intercepted = 0;
  const exposed = new Set<object>();
  Object.defineProperty(prototype, key, { configurable: true, set(this: object, item: unknown) {
    if (typeof item === "object" && item !== null) {
      const target = Object.getOwnPropertyDescriptor(item, "target");
      if (Object.hasOwn(item, "source") && target !== undefined && Object.hasOwn(item, "key") && !Object.hasOwn(item, "kind")) {
        intercepted++;
        if (typeof target.value === "object" && target.value !== null) exposed.add(target.value);
      } else if (Object.hasOwn(item, "leave")) intercepted++;
    }
    // Preserve unrelated array writes without recursively invoking this setter.
    Object.defineProperty(this, key, { value: item, enumerable: true, configurable: true, writable: true });
  } });
  try { run(); }
  finally {
    if (prior === undefined) Reflect.deleteProperty(prototype, key);
    else Object.defineProperty(prototype, key, prior);
  }
  return { intercepted, exposed };
}
function redirect_exposed_paths(exposed: Set<object>, callerPath: readonly number[]): number {
  let changed = 0;
  for (const record of exposed) {
    const target = Object.getOwnPropertyDescriptor(record, "target")?.value;
    if (typeof target !== "object" || target === null) continue;
    const path = Object.getOwnPropertyDescriptor(target, "path")?.value;
    if (Array.isArray(path) && path !== callerPath && path[0] === 0) {
      Reflect.set(path, "0", 1); changed++;
    }
  }
  return changed;
}
for (const [label, prototype] of [["Object.prototype", Object.prototype], ["Array.prototype", Array.prototype]] as const) {
  for (const index of [0, 1] as const) {
    check(`instruction queue owns index ${index} against ${label} setters`, () => {
      const map = hsonLiveMap.fromLibraries({ page: { document: root(node("p", elem(node("b"))), node("q", elem(node("u")))) } });
      let notifications = 0; map.commits.observe(() => notifications++);
      const instruction = insert_instruction(node("i"));
      let intercepted = -1; let references = -1; let redirected = -1;
      map.batch(writer => {
        const probe = probe_instruction_queue(prototype, index, () => writer.lib("page").graph(instruction));
        intercepted = probe.intercepted; references = probe.exposed.size;
        // Exploit any exposed private path after restoring the prototype, before execution.
        redirected = redirect_exposed_paths(probe.exposed, instruction.target.path);
      });
      assert.equal(intercepted, 0); assert.equal(references, 0); assert.equal(redirected, 0);
      assert.deepEqual(instruction, { domain: "graph", op: "insert-content",
        target: { kind: "path", path: [0, 0] }, index: 1, content: node("i") });
      same(map.lib("page").root(), root(node("p", elem(node("b"), node("i"))), node("q", elem(node("u")))));
      assert.equal(map.rev, 1); assert.equal(notifications, 1);

      const nested = hsonLiveMap.fromLibraries({ page: { document: root(
        node("p", elem(node("section", elem(node("b"))))), node("q", elem(node("section", elem(node("u"))))),
      ) } });
      let nestedNotifications = 0; nested.commits.observe(() => nestedNotifications++);
      const content = node("i", elem(str("a"), str(""), str("\ud800"), node("em", elem(str("x")))));
      const first: LiveMapGraphInsertContentOp = { domain: "graph", op: "insert-content",
        target: { kind: "path", path: validate_document_path([0, 0, 0, 0]) }, index: 1, content };
      const second: LiveMapGraphInsertContentOp = { domain: "graph", op: "insert-content",
        target: { kind: "path", path: validate_document_path([1, 0, 0, 0]) }, index: 1, content: node("j") };
      const style = { width: { value: -0, unit: "px" }, color: " red " };
      let nestedInterceptions = -1; let nestedReferences = -1;
      nested.batch(writer => {
        const probe = probe_instruction_queue(prototype, index, () => {
          writer.lib("page").graph(first);
          writer.lib("page").graph(second);
          writer.lib("page").graph({ domain: "graph", op: "set-attr",
            target: { kind: "path", path: validate_document_path([0]) }, name: "style", value: style });
        });
        nestedInterceptions = probe.intercepted; nestedReferences = probe.exposed.size;
        Reflect.set(first.target, "path", validate_document_path([1, 0, 0, 0])); Reflect.set(first, "index", 0);
        Reflect.set(second.target, "path", validate_document_path([0, 0, 0, 0])); Reflect.set(second, "content", node("wrong"));
        content.$_content.length = 0; style.width.value = 9; style.color = "blue";
      });
      assert.equal(nestedInterceptions, 0); assert.equal(nestedReferences, 0);
      const inserted = node("i", elem(str("a"), str(""), str("\ud800"), node("em", elem(str("x")))));
      const expectedFirst = node("p", elem(node("section", elem(node("b"), inserted))));
      expectedFirst.$_attrs = { style: { width: { value: -0, unit: "px" }, color: " red " } };
      same(nested.lib("page").root(), root(expectedFirst, node("q", elem(node("section", elem(node("u"), node("j")))))));
      assert.equal(nested.rev, 1); assert.equal(nestedNotifications, 1);
    });
  }
}
check("prototype-sensitive malformed content rejects without exposing jobs or changing state", () => {
  for (const prototype of [Object.prototype, Array.prototype]) {
    for (const index of [0, 1] as const) {
      const { map, verify } = mutation_fixture(); let semanticCalls = 0; let failure: unknown;
      const bad = node("i"); Object.defineProperty(bad, "$_attrs", { enumerable: true, get() { semanticCalls++; return { id: "smuggled" }; } });
      Object.defineProperty(bad, "hidden", { value: true });
      const probe = probe_instruction_queue(prototype, index, () => {
        try {
          map.batch(writer => {
            writer.lib("page").graph(insert_instruction());
            writer.lib("page").graph(insert_instruction(bad));
          });
        } catch (error) { failure = error; }
      });
      assert.equal(public_instruction_error(failure), true); assert.equal(semanticCalls, 0);
      assert.equal(probe.intercepted, 0); assert.equal(probe.exposed.size, 0); verify();
    }
  }
});

events.terminal("pass"); console.log(`1..${checks}`);
