import assert from "node:assert/strict";
import { LiveTree } from "../../src/api/livetree/livetree.ts";
import type { HsonNode, ReadonlyHsonNode } from "../../src/core/types.ts";
import { observe_exact_hson_graph } from "../../src/internal/exact-node-qualification.ts";
import { read_transform_error_details } from "../../src/core/errors.ts";
import { serialize_hson } from "../../src/api/transform/serializers/serialize-hson.ts";
import { create_linked_livetree_in_runtime } from "../../src/api/livetree/creation/create-livetree.ts";
import { create_livetree_runtime, runtime_for_tree, runtime_for_node, subject_for_tree, historic_root_for_tree, bind_tree_historic_root, inherit_tree_historic_root } from "../../src/api/livetree/runtime/livetree-runtime.ts";

import { is_livetree_node_disposed } from "../../src/api/livetree/livetree-state.ts";
import { parent_for_node } from "../../src/api/livetree/lifecycle/graph-ownership.ts";
import { append_branches_atomic } from "../../src/api/livetree/methods/appends.ts";

const n = (tag: string, ...content: HsonNode[]): HsonNode => ({ $_tag: tag, $_content: content });
const str = (text: string): HsonNode => ({ $_tag: "_hson_str", $_content: [text] });
function objects(root: object): Set<object> {
  const seen = new Set<object>(), stack = [root];
  while (stack.length) {
    const value = stack.pop()!;
    if (seen.has(value)) continue;
    seen.add(value);
    for (const field of Object.values(Object.getOwnPropertyDescriptors(value))) {
      if (typeof field.value === "object" && field.value !== null) stack.push(field.value);
    }
  }
  return seen;
}
function child(node: ReadonlyHsonNode, index = 0): ReadonlyHsonNode {
  const result = node.$_content[index];
  assert.ok(typeof result === "object" && result !== null);
  return result;
}
function protectedCopy(owner: HsonNode, observation: ReadonlyHsonNode): void {
  const retained = objects(owner);
  for (const object of objects(observation)) {
    assert.equal(retained.has(object), false, "observation must own every container");
    assert.ok(Object.isFrozen(object), "every observation container must be frozen");
  }
}
export function observation_cases(check: (name: string, run: () => void) => void): void {
  check("fresh detached observations preserve exact text, styles, signed zero and QUIDs", () => {
    const raw = n("p", n("_hson_elem", str(""), str("x\ud800\u0000"), str("next")));
    raw.$_attrs = { number: -0, style: { width: { value: -0, unit: undefined }, color: "red" } };
    const tree = new LiveTree(raw), owner = subject_for_tree(tree), runtime = runtime_for_tree(tree);
    try {
      const issued = [...runtime.issuedQuids], claims = [...runtime.quidToNode];
      const before = tree.node, again = tree.node;
      protectedCopy(owner, before); protectedCopy(owner, again);
      for (const object of objects(before)) assert.equal(objects(again).has(object), false);
      assert.equal(before.$_meta?.quid, tree.quid);
      assert.deepEqual([...runtime.issuedQuids], issued); assert.deepEqual([...runtime.quidToNode], claims);
      assert.ok(Object.is(before.$_attrs?.number, -0));
      const style = before.$_attrs?.style;
      assert.ok(typeof style === "object" && style !== null);
      const width = style.width;
      assert.ok(typeof width === "object" && width !== null);
      assert.ok(Object.is(width.value, -0)); assert.ok(Object.hasOwn(width, "unit")); assert.equal(width.unit, undefined);
      assert.equal(child(child(before), 0).$_content[0], "");
      assert.equal(child(child(before), 1).$_content[0], "x\ud800\u0000");
      assert.equal(child(child(before), 2).$_content[0], "next");
      assert.equal(Reflect.set(before, "$_tag", "changed"), false);
      assert.equal(Reflect.set(before.$_attrs!, "number", 9), false);
      assert.equal(Reflect.set(width, "value", 9), false);
      assert.equal(Reflect.set(before.$_meta!, "quid", "000000001"), false);
      assert.throws(() => Array.prototype.push.call(before.$_content, str("bad")), TypeError);
      tree.attrs.set("title", "after"); tree.style.setMany({ color: "blue" }); tree.text.add("last");
      const after = tree.node;
      assert.equal(before.$_attrs?.title, undefined); assert.equal(after.$_attrs?.title, "after");
      assert.equal(child(before).$_content.length, 3); assert.equal(tree.text.get(), "x\ud800\u0000nextlast");
      raw.$_tag = "caller"; raw.$_content.length = 0; assert.equal(tree.node.$_tag, "p");
      assert.equal(Object.isFrozen(owner), false);
    } finally { tree.remove(); }
  });
  check("scalar styles remain observable and unrealized forms preserve canonical storage", () => {
    const tree = new LiveTree(n("select"));
    try {
      for (const value of [2, -0, true, null, "color: red"]) {
        tree.attrs.set("style", value);
        assert.ok(Object.is(tree.node.$_attrs?.style, value));
      }
      const before = tree.node;
      assert.throws(() => tree.form.setSelected(["a", "b"]), /missing native control/);
      assert.throws(() => tree.form.setValue("new"), /missing native control/);
      assert.throws(() => tree.form.setChecked(true), /missing native control/);
      assert.deepEqual(tree.node, before);
      assert.equal(tree.form.getValue(), ""); assert.equal(tree.form.getChecked(), false);
      assert.equal(tree.form.getSelected(), "");
      tree.attrs.set("title", "still canonical");
      assert.equal(tree.node.$_attrs?.values, undefined);
      protectedCopy(subject_for_tree(tree), tree.node);
    } finally { tree.remove(); }
  });
  check("optional presence, acyclic sharing and malformed relationships are copied without repair", () => {
    const tree = new LiveTree(n("p")), owner = subject_for_tree(tree), prior = owner.$_content;
    try {
      owner.$_attrs = {}; owner.$_meta = {};
      const shared = str("same");
      const ii = n("_hson_ii", n("_hson_val")); ii.$_meta = { index: "9" };
      owner.$_content = [n("_hson_elem"), n("_hson_elem", shared, shared), n("_hson_arr", ii)];
      const view = tree.node;
      assert.ok(Object.hasOwn(view, "$_attrs")); assert.ok(Object.hasOwn(view, "$_meta"));
      assert.deepEqual(view.$_attrs, {}); assert.deepEqual(view.$_meta, {});
      assert.equal(view.$_content.length, 3); assert.equal(child(view).$_content.length, 0);
      assert.equal(child(child(view, 1), 0), child(child(view, 1), 1));
      assert.notEqual(child(child(view, 1)), shared);
      assert.equal(child(child(view, 2)).$_meta?.index, "9");
      protectedCopy(owner, view);
      const sharedArray = ["a", "b"];
      Reflect.set(owner.$_attrs, "values", sharedArray); owner.$_content = sharedArray;
      const sharedView = tree.node;
      assert.equal(sharedView.$_attrs?.values, sharedView.$_content, "cross-role sharing must remain exact");
      protectedCopy(owner, sharedView);
      delete owner.$_attrs; delete owner.$_meta;
      assert.equal(Object.hasOwn(tree.node, "$_attrs"), false); assert.equal(Object.hasOwn(tree.node, "$_meta"), false);
    } finally { owner.$_content = prior; tree.remove(); }
  });
  check("historic-root observation is independent and private root context survives detach", () => {
    const parent = new LiveTree(n("main", n("_hson_elem", n("span"))));
    const branch = parent.find.must.byTag("span"), root = historic_root_for_tree(branch);
    try {
      const before = branch.hostRootNode(), again = branch.hostRootNode();
      protectedCopy(root, before); assert.notEqual(before, again);
      assert.equal(Reflect.set(before, "$_tag", "bad"), false);
      parent.attrs.set("title", "changed"); assert.equal(before.$_attrs?.title, undefined);
      assert.equal(branch.hostRootNode().$_attrs?.title, "changed");
      branch.detach(); assert.equal(historic_root_for_tree(branch), subject_for_tree(branch));
      assert.equal(branch.hostRootNode().$_tag, "span");
    } finally { branch.remove(); parent.remove(); }
    assert.throws(() => branch.node, /disposed/); assert.throws(() => branch.hostRootNode(), /disposed/);
    assert.equal(subject_for_tree(branch).$_tag, "span", "historical access survives retirement");
  });
  check("sparse linked observation neither acquires nor claims identity", () => {
    const runtime = create_livetree_runtime(), source = n("span"), tree = create_linked_livetree_in_runtime(source, runtime);
    assert.equal(subject_for_tree(tree), source);
    const alias = create_linked_livetree_in_runtime(source, runtime);
    assert.equal(subject_for_tree(alias), source); assert.equal(historic_root_for_tree(alias), source);
    for (const view of [tree.node, alias.node, tree.hostRootNode()]) {
      assert.equal(Object.hasOwn(view, "$_meta"), false); protectedCopy(source, view);
    }
    assert.equal(runtime.issuedQuids.size, 0); assert.equal(runtime.quidToNode.size, 0); tree.remove();
  });
  check("historic-root adoption rejects observations and copies without changing owner state", () => {
    const parent = new LiveTree(n("main", n("_hson_elem", n("span", n("_hson_elem", n("em"))))));
    const branch = parent.find.must.byTag("span"), root = historic_root_for_tree(branch);
    const runtime = runtime_for_tree(parent), old = parent.hostRootNode();
    const foreignRuntime = create_livetree_runtime();
    const foreign = create_linked_livetree_in_runtime(n("aside"), foreignRuntime);
    let semanticCalls = 0;
    const proxy = new Proxy(structuredClone(old), { get(target, key, receiver) {
      semanticCalls++; return Reflect.get(target, key, receiver);
    } });
    const state = () => ({ graph: parent.node, context: historic_root_for_tree(branch),
      registered: [...runtime.quidToNode], issued: [...runtime.issuedQuids], pending: [...runtime.pendingQuidClaims],
      resources: [...runtime.ownerDisposables].map(([node, resources]) => [node, [...resources]]),
      kinds: [...runtime.ownerDisposableKinds].map(([node, kinds]) => [node, [...kinds]]),
      foreignRegistered: [...foreignRuntime.quidToNode], foreignIssued: [...foreignRuntime.issuedQuids],
      foreignPending: [...foreignRuntime.pendingQuidClaims] });
    try {
      parent.attrs.set("title", "before rejection");
      const candidates: readonly [string, unknown][] = [
        ["fresh observation", parent.hostRootNode()], ["old observation", old],
        ["shallow copy", { ...root }], ["equal copy with QUID", structuredClone(parent.node)],
        ["fresh raw graph", n("main", n("_hson_elem", n("span")))],
        ["frozen raw graph", Object.freeze(n("main"))],
        ["foreign observation", foreign.hostRootNode()], ["copy Proxy", proxy],
        ["actual foreign subject", subject_for_tree(foreign)],
      ];
      for (const [name, candidate] of candidates) {
        const before = state();
        assert.throws(() => Reflect.apply(branch.adoptRoots, branch, [candidate]), /historic root must be owned/, name);
        assert.deepEqual(state(), before, name + " must be atomic");
        assert.equal(historic_root_for_tree(branch), root);
      }
      assert.equal(semanticCalls, 0);
      const beforePrivateBind = state();
      assert.throws(() => Reflect.apply(bind_tree_historic_root, undefined, [branch, old]), /historic root must be owned/);
      assert.deepEqual(state(), beforePrivateBind);
      assert.equal(historic_root_for_tree(branch), root, "private binding seam also requires provenance");
      parent.attrs.set("title", "changed");
      assert.equal(branch.hostRootNode().$_attrs?.title, "changed");
      const descendant = branch.find.must.byTag("em");
      assert.equal(historic_root_for_tree(descendant), root);
      assert.equal(descendant.hostRootNode().$_attrs?.title, "changed");
      assert.equal(branch.adoptRoots(root), branch, "actual same-runtime root remains accepted");
      protectedCopy(root, branch.hostRootNode());
      assert.notEqual(branch.hostRootNode(), branch.hostRootNode()); assert.notEqual(branch.node, branch.node);
    } finally { foreign.remove(); parent.remove(); }
  });
  check("sparse linked structural ROOT handoffs prove ownership without QUID registration", () => {
    const runtime = create_livetree_runtime(), span = n("span");
    const source = n("_hson_root", n("_hson_elem", n("main", n("_hson_elem", span))));
    const parent = create_linked_livetree_in_runtime(source, runtime);
    const branch = create_linked_livetree_in_runtime(span, runtime);
    try {
      assert.equal(runtime_for_node(source), runtime); assert.equal(runtime_for_node(span), runtime);
      assert.equal(runtime.quidToNode.size, 0); assert.equal(runtime.issuedQuids.size, 0);
      assert.equal(branch.adoptRoots(source), branch);
      assert.equal(historic_root_for_tree(branch), source);
      const alias = create_linked_livetree_in_runtime(span, runtime).adoptRoots(source);
      assert.equal(subject_for_tree(alias), span); assert.equal(historic_root_for_tree(alias), source);
      assert.equal(branch.hostRootNode().$_tag, "_hson_root");
      assert.equal(source.$_meta, undefined); assert.equal(span.$_meta, undefined);
      assert.equal(runtime.quidToNode.size, 0); assert.equal(runtime.issuedQuids.size, 0);
      assert.equal(runtime.pendingQuidClaims.size, 0);
    } finally { parent.remove(); }
    assert.equal(historic_root_for_tree(branch), source, "historical teardown context remains available");
    assert.throws(() => branch.hostRootNode(), /disposed/);
  });
  check("detached reusable branches retain genuine root contexts across adoption and wrapping", () => {
    const parent = new LiveTree(n("main", n("_hson_elem", n("span"))));
    const branch = parent.find.must.byTag("span"), original = subject_for_tree(branch), quid = branch.quid;
    try {
      branch.detach();
      assert.equal(historic_root_for_tree(branch), original);
      assert.equal(historic_root_for_tree(new LiveTree(branch)), original);
      parent.append(branch);
      assert.equal(subject_for_tree(branch), original); assert.equal(branch.quid, quid);
      assert.equal(historic_root_for_tree(branch), historic_root_for_tree(parent));
      parent.attrs.set("title", "reused"); assert.equal(branch.hostRootNode().$_attrs?.title, "reused");
    } finally { parent.remove(); }
  });
  check("active aliases inherit genuine historic roots after root retirement", () => {
    const parent = new LiveTree(n("main", n("_hson_elem", n("span"))));
    const branch = parent.find.must.byTag("span"), alias = new LiveTree(branch);
    const subject = subject_for_tree(alias), root = historic_root_for_tree(alias), runtime = runtime_for_tree(alias);
    const retiredQuid = parent.quid;
    const state = () => ({ graph: alias.node, root: alias.hostRootNode(),
      registered: [...runtime.quidToNode], issued: [...runtime.issuedQuids], pending: [...runtime.pendingQuidClaims],
      parent: parent_for_node(subject), resources: [...runtime.ownerDisposables].map(([node, values]) => [node, [...values]]),
      kinds: [...runtime.ownerDisposableKinds].map(([node, values]) => [node, [...values]]) });
    let destination: LiveTree | undefined;
    try {
      branch.detach(); parent.remove();
      assert.equal(is_livetree_node_disposed(subject), false); assert.equal(is_livetree_node_disposed(root), true);
      assert.equal(runtime_for_node(subject), runtime); assert.equal(runtime_for_node(root), undefined);
      assert.equal(runtime.quidToNode.has(retiredQuid), false); assert.equal(parent_for_node(subject), undefined);
      const before = state(), later = new LiveTree(alias);
      assert.deepEqual(state(), before, "inheriting a retired context must not register or mutate it");
      assert.equal(subject_for_tree(later), subject); assert.equal(runtime_for_tree(later), runtime);
      assert.equal(historic_root_for_tree(later), root); assert.equal(historic_root_for_tree(alias), root);
      assert.equal(historic_root_for_tree(new LiveTree(later)), root, "repeated aliases preserve context");
      assert.equal(runtime_for_node(root), undefined); assert.equal(is_livetree_node_disposed(root), true);
      assert.equal(parent_for_node(subject), undefined); assert.equal(runtime.quidToNode.has(retiredQuid), false);
      assert.notEqual(later.node, later.node); assert.notEqual(later.hostRootNode(), later.hostRootNode());
      protectedCopy(subject, later.node); protectedCopy(root, later.hostRootNode());
      for (const candidate of [later.hostRootNode(), structuredClone(later.hostRootNode()), root]) {
        const prior = state();
        assert.throws(() => Reflect.apply(later.adoptRoots, later, [candidate]), /historic root must be owned|disposed/);
        assert.deepEqual(state(), prior); assert.equal(historic_root_for_tree(later), root);
      }
      later.attrs.set("title", "still active"); assert.equal(alias.node.$_attrs?.title, "still active");
      const descendant = later.create.em();
      assert.equal(historic_root_for_tree(descendant), root, "creation inherits context from active handle");
      assert.equal(historic_root_for_tree(later.find.must.byTag("em")), root, "wrapping preserves retired context");
      const inserted = new LiveTree(n("i")); later.append(inserted);
      assert.equal(historic_root_for_tree(inserted), root, "attachment inherits context from active handle");
      const batch = [new LiveTree(n("b")), new LiveTree(n("strong"))];
      append_branches_atomic(later, batch);
      for (const member of batch) assert.equal(historic_root_for_tree(member), root, "batch inherits pinned context");
      assert.equal(runtime_for_node(root), undefined, "operations do not reactivate the retired root");
      destination = new LiveTree(n("section")); destination.append(branch);
      assert.equal(subject_for_tree(branch), subject); assert.equal(branch.quid, alias.quid);
      assert.equal(historic_root_for_tree(branch), subject_for_tree(destination));
      assert.equal(historic_root_for_tree(alias), root, "reattachment does not rewrite another alias's pinned context");
      destination.remove();
      assert.equal(subject_for_tree(later), subject); assert.equal(historic_root_for_tree(later), root);
      assert.throws(() => later.node, /disposed/); assert.throws(() => new LiveTree(later), /disposed/);
    } finally { destination?.remove(); branch.remove(); parent.remove(); }
  });
  check("historic inheritance rejects forged, disposed and foreign handles atomically", () => {
    const tree = new LiveTree(n("p")), root = historic_root_for_tree(tree), runtime = runtime_for_tree(tree);
    const foreign = create_linked_livetree_in_runtime(n("aside"), create_livetree_runtime());
    const disposed = new LiveTree(n("span")); disposed.remove();
    let calls = 0;
    const forged = Object.create(LiveTree.prototype);
    const proxy = new Proxy(tree, { get(target, key, receiver) { calls++; return Reflect.get(target, key, receiver); } });
    const state = () => ({ graph: tree.node, root: historic_root_for_tree(tree),
      registered: [...runtime.quidToNode], issued: [...runtime.issuedQuids], pending: [...runtime.pendingQuidClaims],
      resources: [...runtime.ownerDisposables], kinds: [...runtime.ownerDisposableKinds],
      foreignRegistered: [...runtime_for_tree(foreign).quidToNode], foreignIssued: [...runtime_for_tree(foreign).issuedQuids] });
    try {
      for (const source of [forged, proxy, disposed, tree.hostRootNode(), structuredClone(tree.hostRootNode()), foreign]) {
        const before = state();
        assert.throws(() => inherit_tree_historic_root(tree, source), /no runtime subject|disposed|same-runtime handles/);
        assert.deepEqual(state(), before); assert.equal(historic_root_for_tree(tree), root);
      }
      for (const source of [forged, proxy, disposed]) {
        const before = state();
        assert.throws(() => new LiveTree(source), /no runtime subject|disposed/);
        assert.deepEqual(state(), before);
      }
      assert.equal(calls, 0, "unregistered Proxy cannot supply handle authority through getters");
      assert.equal(tree.adoptRoots(root), tree); assert.equal(subject_for_tree(new LiveTree(tree)), subject_for_tree(tree));
    } finally { foreign.remove(); tree.remove(); }
  });
  check("sparse linked handles inherit retired structural ROOT without minting identity", () => {
    const runtime = create_livetree_runtime(), subject = n("span");
    const root = n("_hson_root", n("_hson_elem", n("main", n("_hson_elem", subject))));
    const parent = create_linked_livetree_in_runtime(root, runtime);
    const branch = create_linked_livetree_in_runtime(subject, runtime).adoptRoots(root);
    const alias = create_linked_livetree_in_runtime(subject, runtime);
    inherit_tree_historic_root(alias, branch);
    try {
      branch.detach(); parent.remove();
      assert.equal(runtime_for_node(root), undefined); assert.equal(runtime_for_node(subject), runtime);
      const later = create_linked_livetree_in_runtime(subject, runtime);
      inherit_tree_historic_root(later, alias);
      assert.equal(subject_for_tree(later), subject); assert.equal(historic_root_for_tree(later), root);
      assert.equal(root.$_meta, undefined); assert.equal(subject.$_meta, undefined);
      assert.equal(runtime.quidToNode.size, 0); assert.equal(runtime.issuedQuids.size, 0);
      assert.equal(runtime.pendingQuidClaims.size, 0); assert.equal(is_livetree_node_disposed(root), true);
      protectedCopy(root, later.hostRootNode());
      branch.remove();
      assert.equal(historic_root_for_tree(later), root, "teardown retains private historical access");
      assert.throws(() => inherit_tree_historic_root(later, alias), /disposed/);
    } finally { branch.remove(); parent.remove(); }
  });
  check("nested arrays retain physical II order, ROOT context and signed-zero values", () => {
    const item = (index: string, value: HsonNode): HsonNode => ({ $_tag: "_hson_ii", $_meta: { index }, $_content: [value] });
    const negative: HsonNode = { $_tag: "_hson_val", $_content: [-0] };
    const positive: HsonNode = { $_tag: "_hson_val", $_content: [0] };
    const source = n("_hson_root", n("_hson_arr", item("0", negative), item("1", n("_hson_arr", item("0", positive)))));
    const runtime = create_livetree_runtime(), tree = create_linked_livetree_in_runtime(source, runtime);
    try {
      const view = tree.node, array = child(view);
      assert.equal(view.$_tag, "_hson_root");
      assert.equal(child(array, 0).$_meta?.index, "0"); assert.equal(child(array, 1).$_meta?.index, "1");
      assert.ok(Object.is(child(child(array, 0)).$_content[0], -0));
      const nested = child(child(child(array, 1)));
      assert.equal(nested.$_meta?.index, "0"); assert.ok(Object.is(child(nested).$_content[0], 0));
      protectedCopy(source, view); assert.equal(runtime.issuedQuids.size, 0);
    } finally { tree.remove(); }
  });
  check("large deep runtime storage copies and freezes iteratively", () => {
    const tree = new LiveTree(n("p")), owner = subject_for_tree(tree), prior = owner.$_content;
    try {
      let deep = str("end");
      for (let index = 0; index < 20000; index++) deep = n("_hson_ii", deep);
      owner.$_content = [deep];
      let cursor = child(tree.node), count = 0;
      while (cursor.$_tag === "_hson_ii") { assert.ok(Object.isFrozen(cursor)); assert.ok(Object.isFrozen(cursor.$_content)); count++; cursor = child(cursor); }
      assert.equal(count, 20000); assert.equal(cursor.$_content[0], "end");
    } finally { owner.$_content = prior; tree.remove(); }
  });
  check("unsupported storage fails explicitly without invoking semantic getters", () => {
    const tree = new LiveTree(n("p")), owner = subject_for_tree(tree);
    let calls = 0;
    try {
      owner.$_attrs = {};
      Object.defineProperty(owner.$_attrs, "title", { enumerable: true, configurable: true, get() { calls++; return "bad"; } });
      assert.throws(() => tree.node, error => {
        const detail = read_transform_error_details(error);
        assert.equal(detail?.code, "HSON_CANONICAL_INVARIANT_VIOLATION"); assert.equal(detail?.operation, "LiveTree.node");
        assert.equal(detail?.stage, "runtime-observation"); return true;
      });
      assert.equal(calls, 0); delete owner.$_attrs;
      Reflect.set(owner.$_content, "0", undefined); assert.throws(() => tree.node, /require primitive/); owner.$_content.length = 0;
      owner.$_content.push(owner); assert.throws(() => tree.node, /cycle returns/); owner.$_content.length = 0;
      owner.$_attrs = { value: Infinity }; assert.throws(() => tree.node, /finite/); delete owner.$_attrs;
    } finally { owner.$_content.length = 0; delete owner.$_attrs; tree.remove(); }
  });
  check("internal mutation, querying, cloning and resource ownership bypass observation APIs", () => {
    const nodeDescriptor = Object.getOwnPropertyDescriptor(LiveTree.prototype, "node")!;
    const rootDescriptor = Object.getOwnPropertyDescriptor(LiveTree.prototype, "hostRootNode")!;
    const tree = new LiveTree(n("main"));
    Object.defineProperty(LiveTree.prototype, "node", { configurable: true, get() { throw new Error("internal public observation read"); } });
    Object.defineProperty(LiveTree.prototype, "hostRootNode", { configurable: true, value() { throw new Error("internal public root read"); } });
    try {
      tree.attrs.set("id", "main"); tree.flags.set("hidden"); tree.style.setMany({ color: "red" }); tree.text.set("hello");
      const branch = tree.create.div().attrs.set("title", "child");
      assert.equal(tree.find.must.byTag("div").attrs.get("title"), "child");
      assert.equal(branch.content.count(), 0); assert.equal(typeof tree.content.markup.outerHTML, "string");
      tree.events; tree.css; tree.canvas.inScope();
      const clone = branch.cloneBranch(); clone.remove(); branch.detach(); tree.append(branch); branch.remove();
      assert.equal(tree.text.get(), "hello");
    } finally {
      tree.remove(); Object.defineProperty(LiveTree.prototype, "node", nodeDescriptor); Object.defineProperty(LiveTree.prototype, "hostRootNode", rootDescriptor);
    }
  });
  check("frozen detached storage remains inspectable by serializers", () => {
    const source = n("main", n("_hson_elem", str("text")));
    const view = observe_exact_hson_graph(source, "LiveTree.node");
    // Serializer signature owns mutable authoring nodes; runtime reads are safe
    // on the detached frozen graph too, demonstrated without changing admission.
    assert.equal(Reflect.apply(serialize_hson, undefined, [view, { noBreak: true }]), '<main "text"/>');
    assert.equal(Object.isFrozen(source), false);
  });
}
