import { hsonLiveTree } from "../../src/api/livetree/livetree.facade.ts";
import { default_livetree_runtime } from "../../src/api/livetree/runtime/livetree-runtime.ts";
import { create_linked_livetree_in_runtime } from "../../src/api/livetree/creation/create-livetree.ts";
import { create_livetree_runtime } from "../../src/api/livetree/runtime/livetree-runtime.ts";
import assert from "node:assert/strict";
import { LiveTree } from "../../src/api/livetree/livetree.ts";
import type { HsonNode } from "../../src/core/types.ts";
import { subject_for_tree, runtime_for_tree, runtime_for_node } from "../../src/api/livetree/runtime/livetree-runtime.ts";
import { parent_for_node } from "../../src/api/livetree/lifecycle/graph-ownership.ts";
import { append_branches_atomic } from "../../src/api/livetree/methods/appends.ts";
import { hsonTransform } from "../../src/api/transform/transform.facade.ts";
const n = (tag: string, ...children: HsonNode[]): HsonNode => ({ $_tag: tag, $_content: children });
const str = (text: string): HsonNode => ({ $_tag: "_hson_str", $_content: [text] });
const at = (node: HsonNode, ...path: number[]): HsonNode => {
  for (const index of path) { const child = node.$_content[index]; assert.ok(typeof child === "object" && child !== null); node = child; }
  return node;
};
const state = (tree: LiveTree) => { const runtime = runtime_for_tree(tree); return { graph: tree.node,
  claims: [...runtime.quidToNode], issued: [...runtime.issuedQuids], pending: [...runtime.pendingQuidClaims] }; };
export function owned_mutation_cases(check: (name: string, run: () => void) => void): void {
  check("fresh source occurrences own independent subjects and all nested storage", () => {
    const empty = str(""), p = n("p", n("_hson_elem", empty, empty));
    p.$_attrs = { style: { width: { value: -0, unit: undefined } } };
    const raw = n("main", n("_hson_elem", p, p)); const tree = new LiveTree(raw), root = subject_for_tree(tree);
    try {
      const a = at(root, 0, 0), b = at(root, 0, 1);
      assert.notEqual(a, b); assert.notEqual(a, p); assert.notEqual(a.$_attrs, b.$_attrs);
      assert.notEqual(a.$_attrs?.style, b.$_attrs?.style); assert.notEqual(at(a, 0, 0), at(a, 0, 1));
      assert.equal(a.$_meta, undefined); assert.equal(b.$_meta, undefined);
      const handles = tree.findAll.byTag("p").array();
      assert.notEqual(handles[0]!.quid, handles[1]!.quid);
      handles[0]!.attrs.set("title", "first"); assert.equal(b.$_attrs?.title, undefined);
      raw.$_content.length = 0; p.$_tag = "caller"; assert.equal(b.$_tag, "p");
      assert.equal(Object.isFrozen(raw), false); assert.notEqual(subject_for_tree(new LiveTree(handles[0]!)), p);
      assert.equal(subject_for_tree(new LiveTree(handles[0]!)), a);
    } finally { tree.remove(); }
  });
  check("sharing under different parents and data relationships expands by occurrence", () => {
    const p = n("p"), tree = new LiveTree(n("main", n("_hson_elem", n("section", n("_hson_elem", p)), n("aside", n("_hson_elem", p)))));
    try { assert.notEqual(at(subject_for_tree(tree), 0, 0, 0, 0), at(subject_for_tree(tree), 0, 1, 0, 0)); } finally { tree.remove(); }
    const ii: HsonNode = { $_tag: "_hson_ii", $_meta: { index: "0" }, $_content: [{ $_tag: "_hson_val", $_content: [-0] }] };
    const arr = n("_hson_arr", ii), data = new LiveTree(n("main", n("_hson_obj", n("a", arr), n("b", arr))));
    try { const a = at(subject_for_tree(data), 0, 0, 0), b = at(subject_for_tree(data), 0, 1, 0);
      assert.notEqual(a, b); assert.notEqual(at(a, 0), at(b, 0)); assert.ok(Object.is(at(a, 0, 0).$_content[0], -0));
    } finally { data.remove(); }
    const shared = n("p"), value = n("_hson_elem", shared, shared);
    const snapshot = hsonTransform.fromNode(value).toNode();
    assert.equal(snapshot.$_content[0], snapshot.$_content[1], "generic exact snapshots retain their existing sharing contract");
  });
  check("element append rejects data crossings and duplicate placements atomically", () => {
    const target = new LiveTree(n("main")), data = new LiveTree(n("a", n("_hson_obj"))), branch = new LiveTree(n("p"));
    try {
      for (const run of [() => target.append(data), () => data.append(branch), () => append_branches_atomic(target, [branch, new LiveTree(branch)])]) {
        const before = state(target), dataBefore = state(data), branchBefore = state(branch);
        assert.throws(run); assert.deepEqual(state(target), before); assert.deepEqual(state(data), dataBefore); assert.deepEqual(state(branch), branchBefore);
        assert.equal(parent_for_node(subject_for_tree(branch)), undefined);
      }
      target.append(branch); assert.equal(parent_for_node(subject_for_tree(branch)), at(subject_for_tree(target), 0));
      const before = state(target); assert.throws(() => branch.append(target)); assert.deepEqual(state(target), before);
    } finally { target.remove(); branch.remove(); data.remove(); }
  });
  check("failed bound and detached multi-tag requests do not issue identity", () => {
    const host = new LiveTree(n("main")), runtime = default_livetree_runtime();
    try {
      const before = state(host);
      assert.throws(() => host.create.tags(["p", "xmlbad"])); assert.deepEqual(state(host), before);
      assert.throws(() => hsonLiveTree.create.tags(["p", "xmlbad"])); assert.deepEqual(state(host), before);
      const made = host.create.tags(["p", "span"]).array(); assert.equal(made.length, 2); assert.notEqual(made[0]!.quid, made[1]!.quid);
      assert.equal(runtime.quidToNode.get(made[0]!.quid), subject_for_tree(made[0]!));
    } finally { host.remove(); }
  });
  check("sparse linked moves and handle aliases preserve absence", () => {
    const runtime = create_livetree_runtime(), raw = n("main", n("_hson_elem", n("p")));
    const host = create_linked_livetree_in_runtime(raw, runtime), child = host.content.first()!;
    const before = state(host); assert.equal(subject_for_tree(child).$_meta, undefined);
    const emptyRoot = create_linked_livetree_in_runtime(n("_hson_root"), runtime);
    assert.throws(() => host.append(emptyRoot)); assert.deepEqual(state(host), before);
    assert.deepEqual(subject_for_tree(emptyRoot).$_content, []); emptyRoot.remove();
    child.detach(); host.append(child);
    assert.equal(subject_for_tree(child), at(raw, 0, 0)); assert.equal(subject_for_tree(child).$_meta, undefined);
    assert.deepEqual([...runtime.issuedQuids], before.issued); assert.deepEqual([...runtime.quidToNode], before.claims);
    assert.equal(subject_for_tree(new LiveTree(child)), subject_for_tree(child)); host.remove();
  });
  check("corrupted direct children and overlapping owned forests reject unchanged", () => {
    const host = new LiveTree(n("main")), branch = new LiveTree(n("p"));
    const root = subject_for_tree(host), subject = subject_for_tree(branch);
    root.$_content = [subject]; const before = state(host);
    assert.throws(() => host.append(branch)); assert.deepEqual(state(host), before);
    root.$_content = []; host.append(branch);
    const target = new LiveTree(n("aside")), prior = state(host);
    assert.throws(() => append_branches_atomic(target, [host, branch])); assert.deepEqual(state(host), prior);
    target.remove(); host.remove();
    const receiver = new LiveTree(n("main")), local = new LiveTree(n("p"));
    const foreign = create_linked_livetree_in_runtime(n("span"), create_livetree_runtime());
    subject_for_tree(local).$_content = [n("_hson_elem", subject_for_tree(foreign))];
    const localBefore = state(local), receiverBefore = state(receiver), foreignBefore = state(foreign);
    assert.throws(() => receiver.append(local));
    assert.deepEqual(state(local), localBefore); assert.deepEqual(state(receiver), receiverBefore);
    assert.deepEqual(state(foreign), foreignBefore);
    subject_for_tree(local).$_content = []; local.remove(); receiver.remove(); foreign.remove();
  });
  check("last child detach and removal remove only the empty ELEM relationship", () => {
    const parent = new LiveTree(n("main", n("_hson_elem", n("p")))), child = parent.find.must.byTag("p");
    const root = subject_for_tree(parent), quid = parent.quid, subject = subject_for_tree(child), identity = child.quid;
    child.detach(); assert.deepEqual(root.$_content, []); assert.equal(parent.quid, quid); assert.equal(child.quid, identity);
    assert.equal(parent_for_node(subject), undefined); parent.append(child); assert.equal(subject_for_tree(child), subject);
    child.remove(); assert.deepEqual(root.$_content, []); assert.equal(parent.quid, quid); assert.equal(runtime_for_tree(parent).issuedQuids.has(identity), true);
    parent.remove();
    const nested = new LiveTree(n("main", n("_hson_elem", n("section", n("_hson_elem", n("p"))))));
    nested.find.must.byTag("p").remove(); assert.deepEqual(at(subject_for_tree(nested), 0, 0).$_content, []);
    nested.find.must.byTag("section").remove(); assert.deepEqual(subject_for_tree(nested).$_content, []); nested.remove();
  });
  check("detached element content composes one relationship with exact text order", () => {
    const source = new LiveTree(n("section", n("_hson_elem", str(""), str("x"), n("i"))));
    const target = new LiveTree(n("section", n("_hson_elem", n("b"))));
    const relation = at(subject_for_tree(source), 0), children = [...relation.$_content], cap = source.detachContents();
    try {
      cap.appendTo(target); assert.equal(cap.isAttached, true); assert.equal(subject_for_tree(target).$_content.length, 1);
      assert.deepEqual(at(subject_for_tree(target), 0).$_content.slice(1), children);
      for (let index = 0; index < children.length; index++) assert.equal(at(subject_for_tree(target), 0).$_content[index + 1], children[index]);
      assert.throws(() => cap.appendTo(target)); assert.equal(runtime_for_node(relation), undefined);
    } finally { source.remove(); target.remove(); }
  });
  check("incompatible detached transfer preserves capability for a valid retry", () => {
    const source = new LiveTree(n("a", n("_hson_obj"))), target = new LiveTree(n("main", n("_hson_elem", n("p")))), empty = new LiveTree(n("section"));
    const relation = at(subject_for_tree(source), 0), cap = source.detachContents();
    try {
      const before = state(target); assert.throws(() => cap.appendTo(target)); assert.deepEqual(state(target), before); assert.equal(cap.isAttached, false);
      cap.appendTo(empty); assert.equal(at(subject_for_tree(empty), 0), relation); assert.equal(cap.isAttached, true);
    } finally { source.remove(); target.remove(); empty.remove(); }
  });
  check("text writes qualify context and route new/displaced storage", () => {
    const tree = new LiveTree(n("main"));
    try {
      tree.text.add(""); tree.text.insert(1, "x"); const root = subject_for_tree(tree), old = at(root, 0, 0), relation = at(root, 0);
      assert.equal(parent_for_node(old), relation); assert.equal(runtime_for_node(old), runtime_for_tree(tree)); assert.equal(runtime_for_node(relation), runtime_for_tree(tree));
      tree.text.set("next"); assert.equal(runtime_for_node(old), undefined); assert.equal(parent_for_node(old), undefined);
      tree.attrs.set("style", 2); tree.form.setSelected(["a"]); tree.text.add("still valid");
    } finally { tree.remove(); }
    const data = new LiveTree(n("main", n("_hson_arr"))); const before = state(data);
    for (const run of [() => data.text.add("x"), () => data.text.insert(0, "x"), () => data.text.set("x"), () => data.text.overwrite("x")]) {
      assert.throws(run); assert.deepEqual(state(data), before);
    }
    data.remove();
    const object = new LiveTree(n("main", n("_hson_obj", n("a", n("_hson_obj", str("old"))))));
    try {
      const member = object.find.must.byTag("a"); member.text.set("new"); const prior = state(object);
      assert.throws(() => member.empty()); assert.throws(() => member.detachContents()); assert.deepEqual(state(object), prior);
      assert.throws(() => object.text.add("bad")); assert.deepEqual(state(object), prior);
    } finally { object.remove(); }
  });
}
