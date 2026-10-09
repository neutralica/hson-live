// @hson-live-external-test
import assert from "node:assert/strict";
import { repository_typescript_worker } from "./helpers/repository-typescript-worker.mts";
import type { HsonNode } from "../src/core/types.ts";
import { is_Node } from "../src/core/node-guards.ts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import { read_transform_error_details } from "../src/core/errors.ts";
import { hsonLiveTree } from "../src/api/livetree/livetree.facade.ts";
import { begin_livetree_materialization_profile } from "../src/api/livetree/debug/materialization-profile.ts";
import { LiveTree } from "../src/api/livetree/livetree.ts";
import { admit_public_livetree_branch } from "../src/api/livetree/livetree.node-admission.ts";
import { create_livetree_in_runtime, create_linked_livetree_in_runtime } from "../src/api/livetree/creation/create-livetree.ts";
import { create_livetree_runtime, default_livetree_runtime, runtime_for_tree } from "../src/api/livetree/runtime/livetree-runtime.ts";
import { get_node_by_quid } from "../src/api/livetree/quid/data-quid.ts";
import { hsonTransform } from "../src/api/transform/transform.facade.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livetree.node-exact", title: "Exact LiveTree branch and public ownership admission", category: "LiveTree", runtime: "node",
  tags: Object.freeze(["ingress", "canonical", "identity", "ownership", "atomicity", "externally-discoverable"]),
});
const events = create_test_event_emitter("livetree.node-exact");
let checks = 0;
function check(name: string, run: () => void): void {
  events.case_begin(name, name);
  try { run(); events.case_end(name, "pass"); console.log(`ok ${++checks} - ${name}`); }
  catch (error) { events.case_end(name, "fail"); events.terminal("fail"); throw error; }
}
const n = (tag: string, ...content: HsonNode[]): HsonNode => ({ $_tag: tag, $_content: content });
const elem = (...content: HsonNode[]) => n("_hson_elem", ...content);
const str = (text: string): HsonNode => ({ $_tag: "_hson_str", $_content: [text] });
const val = (value: number | boolean | null): HsonNode => ({ $_tag: "_hson_val", $_content: [value] });
const obj = (...content: HsonNode[]) => n("_hson_obj", ...content);
const ii = (value: HsonNode, index: string): HsonNode => ({ $_tag: "_hson_ii", $_content: [value], $_meta: { index } });
const root = (...content: HsonNode[]) => n("_hson_root", ...content);
function same(actual: HsonNode, expected: HsonNode): void { assert.ok(canonical_hson_graph_equal(actual, expected)); }
function withoutIdentity(value: HsonNode): HsonNode {
  const copy = structuredClone(value);
  const stack = [copy];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.$_meta && Object.hasOwn(node.$_meta, "quid")) {
      delete node.$_meta.quid;
      if (!Object.keys(node.$_meta).length) delete node.$_meta;
    }
    for (const child of node.$_content) if (is_Node(child)) stack.push(child);
  }
  return copy;
}
function child(value: HsonNode, index = 0): HsonNode { const result = value.$_content[index]; assert.ok(is_Node(result)); return result; }
function runtimeState() {
  const runtime = default_livetree_runtime();
  return { claims: [...runtime.quidToNode], issued: [...runtime.issuedQuids], pending: [...runtime.pendingQuidClaims], resources: [...runtime.ownerDisposables] };
}
const publicConstructors = [
  (input: unknown): LiveTree => Reflect.construct(LiveTree, [input]),
  (input: unknown): LiveTree => Reflect.apply(hsonLiveTree.fromNode, hsonLiveTree, [input]),
];
function reject(input: unknown): void {
  for (const construct of publicConstructors) {
    const before = runtimeState();
    const profile = begin_livetree_materialization_profile();
    try {
      assert.throws(() => construct(input), error => {
        const details = read_transform_error_details(error);
        assert.equal(details?.stage, "source-admission");
        assert.match(details?.path ?? "", /^\$/);
        return true;
      });
      assert.ok(Object.values(profile.stop()).every(value => value === 0));
    } finally { profile.stop(); }
    assert.deepEqual(runtimeState(), before);
  }
}
check("element and data-mode branch roles qualify without portable grammar changes", () => {
  const values = [n("p"), n("p", elem(str("x"))), n("main", elem(n("p"), str(""), str("a"), str("b"), n("span"))),
    n("a", obj()), n("a", n("_hson_arr")), n("a", obj(val(-0))),
    n("a", obj(n("10", obj(val(1))), n("2", n("_hson_arr", ii(str("\ud800\0"), "0")))))];
  for (const input of values) {
    same(admit_public_livetree_branch(input, "test.branch"), input);
    for (const construct of publicConstructors) {
      const before = structuredClone(input);
      const tree = construct(input);
      assert.notEqual(tree.node, input);
      same(withoutIdentity(tree.node), before);
      assert.deepEqual(input, before);
      assert.equal(get_node_by_quid(tree.quid), tree.node);
      assert.equal(Object.isFrozen(input), false);
      tree.remove();
    }
    assert.throws(() => hsonTransform.fromNode(input));
  }
});
check("finite runtime attributes and exact style presence survive", () => {
  const input = { ...n("p"), $_attrs: { s: "\ud800", number: -0, yes: true, nil: null,
    style: { width: { value: -0, unit: undefined }, height: { value: 1 }, empty: "", space: " red " } } };
  const captured = admit_public_livetree_branch(input, "test.attrs");
  same(captured, input);
  const tree = new LiveTree(input);
  assert.ok(Object.is(tree.node.$_attrs?.number, -0));
  same(withoutIdentity(tree.node), input);
  tree.attrs.set("number", 2);
  assert.ok(Object.is(input.$_attrs.number, -0));
  tree.remove();
  same(admit_public_livetree_branch({ ...n("p"), $_attrs: { style: {} } }, "test.style"), { ...n("p"), $_attrs: { style: {} } });
});
check("original inputs and descendants remain independent mutable input material", () => {
  for (const construct of publicConstructors) {
    const input = n("p", elem(str("x"), n("span")));
    const tree = construct(input);
    input.$_tag = "changed";
    child(child(input)).$_content[0] = "changed";
    child(input).$_content.push(n("later"));
    same(withoutIdentity(tree.node), n("p", elem(str("x"), n("span"))));
    tree.id.set("live");
    assert.equal(input.$_attrs, undefined);
    assert.equal(tree.node.$_attrs?.id, "live");
    assert.equal(new LiveTree(tree).node, tree.node);
    tree.remove();
  }
});
check("Proxy semantic values cannot replace the descriptor-admitted private graph", () => {
  let calls = 0;
  const input = new Proxy(n("p"), { get(target, key, receiver) {
    if (key === "$_meta") { calls++; return { quid: "000000001" }; }
    return Reflect.get(target, key, receiver);
  } });
  for (const construct of publicConstructors) {
    const tree = construct(input);
    assert.equal(calls, 0);
    assert.notEqual(tree.node, input);
    assert.notEqual(tree.quid, "000000001");
    assert.equal(default_livetree_runtime().quidToNode.has("000000001"), false);
    assert.equal(default_livetree_runtime().issuedQuids.has("000000001"), false);
    tree.remove();
  }
});
check("only registered LiveTree handles confer retained-subject reuse", () => {
  const fake = Object.create(LiveTree.prototype); let calls = 0;
  Object.defineProperty(fake, "node", { get() { calls++; return { ...n("p"), $_meta: { quid: "000000001" } }; } });
  const before = runtimeState();
  assert.throws(() => new LiveTree(fake), /no runtime subject/);
  assert.equal(calls, 0); assert.deepEqual(runtimeState(), before);
  const original = new LiveTree(n("p")); const subject = original.node;
  Object.defineProperty(original, "node", { configurable: true, get() { calls++; return { ...n("p"), $_meta: { quid: "000000001" } }; } });
  const alias = new LiveTree(original);
  assert.equal(alias.node, subject); assert.equal(calls, 0);
  assert.equal(default_livetree_runtime().issuedQuids.has("000000001"), false);
  Reflect.deleteProperty(original, "node"); original.remove();
});
check("constructor handle classification cannot change between observations", () => {
  let prototypes = 0; let semanticCalls = 0;
  const input = new Proxy(n("p"), {
    getPrototypeOf() { return ++prototypes === 1 ? Object.prototype : LiveTree.prototype; },
    get(target, key, receiver) {
      if (key === "$_meta") { semanticCalls++; return { quid: "000000001" }; }
      return Reflect.get(target, key, receiver);
    },
  });
  const before = runtimeState();
  assert.throws(() => new LiveTree(input));
  assert.equal(semanticCalls, 0); assert.deepEqual(runtimeState(), before);
});
check("malformed descriptor storage rejects before any runtime publication", () => {
  const hidden = n("p"); Object.defineProperty(hidden, "$_content", { value: [], enumerable: false });
  const accessor = n("p"); let calls = 0;
  Object.defineProperty(accessor, "$_meta", { enumerable: true, get() { calls++; return { quid: "000000001" }; } });
  const semanticAccessors = ["$_tag", "$_content", "$_attrs"].map(key => {
    const value = n("p");
    Object.defineProperty(value, key, { enumerable: true, get() { calls++; return key === "$_tag" ? "p" : []; } });
    return value;
  });
  const sparse = n("p"); sparse.$_content.length = 1;
  const decorated = n("p"); Object.defineProperty(decorated.$_content, "map", { value: () => [] });
  const iterator = n("p"); Object.defineProperty(iterator.$_content, Symbol.iterator, { value: () => [][Symbol.iterator]() });
  const cycle = n("p"); cycle.$_content.push(cycle);
  for (const input of [{ $_content: [] }, { $_tag: "p" }, { ...n("p"), extra: true }, { ...n("p"), [Symbol("extra")]: true },
    hidden, accessor, ...semanticAccessors, sparse, decorated, iterator, cycle, { ...n("p"), $_attrs: undefined }, { ...n("p"), $_meta: undefined },
    { ...n("p"), $_attrs: {} }, { ...n("p"), $_meta: {} }, Object.assign(Object.create({ $_meta: { quid: "000000001" } }), n("p"))]) reject(input);
  assert.equal(calls, 0);
  assert.equal(Object.hasOwn(accessor, "$_meta"), true);
  assert.equal(sparse.$_content.length, 1);
});
check("malformed relationships and physical II order reject without repair", () => {
  for (const input of [n("p", str("x")), n("p", elem()), n("p", elem(obj())), n("p", root()),
    n("a", obj(n("b", val(1)))), n("a", n("_hson_arr", ii(val(2), "1"), ii(val(1), "0"))),
    n("a", n("_hson_arr", ii(val(1), "00"))), n("a", n("_hson_arr", ii(obj(val(1)), "0"))),
    n("a", obj(obj())), n("p", elem(n("span", str("x")))), n("p", elem({ ...n("span"), $_attrs: {} }))]) {
    const before = structuredClone(input);
    reject(input); assert.deepEqual(input, before);
  }
});
check("invalid runtime ordinary attributes reject without coercion", () => {
  for (const value of [Infinity, -Infinity, NaN, undefined, {}, []]) reject({ ...n("p"), $_attrs: { bad: value } });
});
check("all supplied QUID forms reject independently of format or placement", () => {
  for (const value of ["000000001", "bad", undefined]) {
    reject({ ...n("p"), $_meta: { quid: value } });
    reject(n("p", elem({ ...n("span"), $_meta: { quid: value } })));
    reject(n("p", { ...elem(str("x")), $_meta: { quid: value } }));
  }
});
check("source carriers qualify completely and select only one meaningful branch", () => {
  const input = root(elem(n("p", elem(str("x")))));
  const tree = hsonLiveTree.fromNode(input);
  same(withoutIdentity(tree.node), n("p", elem(str("x"))));
  assert.notEqual(tree.node, child(child(input)));
  same(input, root(elem(n("p", elem(str("x"))))));
  tree.remove();
  for (const bad of [root(), root(elem()), root(elem(n("p"), n("q"))), root(elem(n("p")), n("q")),
    root(elem(n("p")), n("q", str("broken"))), root(elem(str("lead"), n("p"))), root(elem(n("p"), str("tail"))),
    root(obj()), elem(n("p"))]) {
    const before = runtimeState();
    assert.throws(() => hsonLiveTree.fromNode(bad));
    assert.deepEqual(runtimeState(), before);
  }
});
check("parsed Hson single branches retain content; additional roots reject", () => {
  const tree = hsonLiveTree.fromHson('<p "x"/>', { isolated: true });
  same(withoutIdentity(tree.node), n("p", elem(str("x"))));
  tree.remove();
  for (const text of ['<p/><q/>', '<p/> "tail"']) assert.throws(() => hsonLiveTree.fromHson(text));
});
check("known tag creation still mints distinct local identity", () => {
  const parent = hsonLiveTree.fromNode(n("main"), { isolated: true });
  const first = parent.create.p(); const second = parent.create.p();
  assert.notEqual(first.quid, second.quid);
  const runtime = runtime_for_tree(parent);
  assert.equal(runtime.quidToNode.get(first.quid), first.node);
  assert.equal(runtime.quidToNode.get(second.quid), second.node);
  parent.remove();
});
check("internal owned and linked references retain their proven identity contracts", () => {
  const runtime = create_livetree_runtime();
  const owned = { ...n("p"), $_meta: { quid: "000000001" } };
  const tree = create_livetree_in_runtime(owned, runtime);
  assert.equal(tree.node, owned); assert.equal(tree.quid, "000000001");
  const absent = n("span");
  const linked = create_linked_livetree_in_runtime(absent, runtime);
  assert.equal(linked.node, absent); assert.equal(absent.$_meta, undefined);
  assert.equal(runtime.quidToNode.size, 1);
  tree.remove();
});
const workerCase = "actual source-loaded Worker preserves raw isolation and portable boundaries";
events.case_begin(workerCase, workerCase);
const worker = repository_typescript_worker(new URL("./fixtures/livetree-node-exact.worker.mts", import.meta.url));
try {
  const result = await new Promise((resolve, reject) => {
    worker.once("message", resolve); worker.once("error", reject);
    worker.once("exit", code => reject(new Error(`Worker exited ${code} before reporting`)));
  });
  assert.deepEqual(result, { sourceWorker: "pass", publicRawIsolation: true, portableBranchRejected: true });
  events.case_end(workerCase, "pass"); checks++;
} catch (error) { events.case_end(workerCase, "fail"); events.terminal("fail"); throw error; }
finally { await worker.terminate(); }
events.terminal("pass");
console.log(`LiveTree exact admission acceptance passed (${checks} cases).`);
