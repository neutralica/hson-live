import assert from "node:assert/strict";
import { hsonLiveMap, hsonTransform, continue_document } from "../../src/index.ts";
import { LiveTree } from "../../src/api/livetree/livetree.ts";
import { subject_for_tree, runtime_for_tree } from "../../src/api/livetree/runtime/livetree-runtime.ts";
import { clone_node } from "../../src/core/clone-node.ts";
import { is_Node } from "../../src/core/node-guards.ts";
import { clone_live_root } from "../../src/api/livemap/livemap.editor.ts";
import { clone_hson_graph_without_quids } from "../../src/api/livemap/livemap.document.capture.ts";
import { canonical_hson_graph_equal } from "../../src/core/canonical-hson-equal.ts";
import { internal_livemap_aggregate_authority } from "../../src/api/livemap/livemap.internal.ts";
import { decode_hosted_root } from "../../src/api/livemap/livemap.hosted.ts";
import { install_libraries_snapshot } from "../../src/api/livemap/index.ts";
import { canonical_public_attrs_equal, decode_public_attrs } from "../../src/core/public-attrs.ts";
import { serialize_json } from "../../src/api/transform/serializers/serialize-json.ts";
import { serialize_html } from "../../src/api/transform/serializers/serialize-html.ts";
import { lower_browser_attribute_value } from "../../src/internal/browser-realization/browser-realization-plan.ts";
import type { HsonNode } from "../../src/core/types.ts";
import { capture_internal_document } from "../helpers/document-capture.mts";
import { without_structured_clone } from "../helpers/without-structured-clone.mts";
import { FakeElement, install_fake_document } from "../helpers/fake-document.mts";

export function style_branch(tag = "main"): HsonNode {
  return { $_tag: tag, $_attrs: { count: -0, title: "original", style: {
    color: "red", opacity: -0, width: { value: -0, unit: undefined },
    height: { value: 0 }, left: { value: -0, unit: "px" }, nullable: null,
  } }, $_content: [] };
}

function is_record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function record(value: unknown): Record<string, unknown> {
  assert.ok(is_record(value));
  return value;
}
export function style_leaf(root: HsonNode, name: string): Record<string, unknown> {
  return record(root.$_attrs?.style?.[name]);
}
export function assert_style_fidelity(root: HsonNode): void {
  assert.ok(Object.is(root.$_attrs?.count, -0));
  assert.ok(Object.is(root.$_attrs?.style?.opacity, -0));
  const width = style_leaf(root, "width"), height = style_leaf(root, "height"), left = style_leaf(root, "left");
  assert.ok(Object.is(width.value, -0));
  assert.ok(Object.hasOwn(width, "unit"));
  assert.equal(width.unit, undefined);
  assert.ok(!Object.hasOwn(height, "unit"));
  assert.ok(Object.is(height.value, 0));
  assert.equal(left.unit, "px");
  assert.ok(Object.is(left.value, -0));
  assert.equal(root.$_attrs?.style?.nullable, null);
}

export function cut8_copy_cases(check: (name: string, run: () => void) => void): void {
  const native = globalThis.structuredClone;
  for (const mode of ["native", "fallback"] as const) {
    const case_ = (name: string, run: () => void) => check(`Cut 8 ${mode}: ${name}`, () => {
      if (mode === "fallback") without_structured_clone(run);
      else { assert.equal(typeof globalThis.structuredClone, "function"); run(); }
      assert.equal(globalThis.structuredClone, native);
    });
    case_("plain copy retains signed zero, presence, positions and independent storage", () => {
      const original = style_branch();
      for (const copy of [clone_node(original), clone_live_root(original)]) {
        assert.ok(canonical_hson_graph_equal(original, copy));
        assert_style_fidelity(copy);
        assert.notEqual(copy, original);
        assert.notEqual(copy.$_attrs, original.$_attrs);
        assert.notEqual(copy.$_attrs?.style, original.$_attrs?.style);
        assert.notEqual(style_leaf(copy, "width"), style_leaf(original, "width"));
        style_leaf(copy, "width").value = 9;
        assert.ok(Object.is(style_leaf(original, "width").value, -0));
      }
      const shared = { values: [-0, 0, { unit: undefined }, null] };
      const ordered = { first: shared, second: shared, absent: {}, sparse: new Array(3) };
      const copy = clone_node(ordered);
      assert.deepEqual(copy, ordered);
      assert.notEqual(copy.first, shared);
      assert.equal(copy.first, copy.second, "generic copy retains source sharing inside the new value");
      assert.ok(Object.is(copy.first.values[0], -0));
      assert.ok(Object.hasOwn(record(copy.first.values[2]), "unit"));
      assert.deepEqual(Object.keys(copy), Object.keys(ordered));
      assert.equal(copy.sparse.length, 3);
      assert.ok(!Object.hasOwn(copy.sparse, 0));
    });
    case_("undefined field copy never becomes absent even without signed numbers", () => {
      const original = { style: { width: { value: 0, unit: undefined }, height: { value: 0 }, left: { value: 0, unit: "px" } } };
      const copy = clone_node(original);
      assert.ok(Object.hasOwn(copy.style.width, "unit"));
      assert.equal(copy.style.width.unit, undefined);
      assert.ok(!Object.hasOwn(copy.style.height, "unit"));
      assert.equal(copy.style.left.unit, "px");
      assert.notEqual(copy.style.width, original.style.width);
    });
    case_("public library reads and document/portable captures remain exact", () => {
      const document: HsonNode = { $_tag: "_hson_root", $_content: [style_branch()] };
      const map = hsonLiveMap.fromLibraries({ data: { data: { nested: [0, -0] } }, page: { document } });
      const authority = internal_livemap_aggregate_authority(map);
      const checkpoint = authority.captureSemanticCheckpoint();
      const root = map.lib("data").root();
      assert.ok(canonical_hson_graph_equal(root, checkpoint.libraries[0]!.root));
      const page = map.lib("page").root();
      assert.ok(canonical_hson_graph_equal(page, document));
      const capture = capture_internal_document(map, "page");
      assert.ok(canonical_hson_graph_equal(capture.root, document));
      const portable = map.capture();
      assert.ok(canonical_hson_graph_equal(document, decode_hosted_root(portable.libraries[1]!.root)));
      const restored = install_libraries_snapshot(portable).map;
      assert.ok(canonical_hson_graph_equal(restored.lib("page").root(), document));
      assert.ok(canonical_hson_graph_equal(restored.lib("data").root(), root));
      const observed = map.lib("page").root();
      const main = observed.$_content[0];
      assert.ok(typeof main === "object" && main !== null);
      style_leaf(main, "width").value = 17;
      assert.ok(canonical_hson_graph_equal(map.lib("page").root(), document));
      assert.equal(map.rev, 0);
    });
    case_("public unrelated attribute mutation retains untouched typed storage", () => {
      const tree = new LiveTree(style_branch());
      try {
        tree.attrs.set("title", "changed");
        assert.equal(tree.attrs.get("title"), "changed");
        assert_style_fidelity(subject_for_tree(tree));
        const attrs = subject_for_tree(tree).$_attrs;
        tree.attrs.set("title", "changed");
        assert.equal(subject_for_tree(tree).$_attrs, attrs, "identical write retains no-op storage");
      } finally { tree.remove(); }
    });
    case_("public cloneBranch owns root and descendant styles through repeated copies", () => {
      const input = style_branch();
      input.$_content = [{ $_tag: "_hson_elem", $_content: [style_branch("span")] }];
      const source = new LiveTree(input);
      const child = source.find.must.byTag("span");
      const sourceQuids = [source.quid, child.quid];
      const runtime = runtime_for_tree(source), issued = runtime.issuedQuids.size;
      const clone = source.cloneBranch(), second = clone.cloneBranch();
      const cloneChild = clone.find.must.byTag("span"), secondChild = second.find.must.byTag("span");
      try {
        assert.equal(runtime.issuedQuids.size, issued + 4, "only fresh ordinary subjects receive clone identity");
        assert.equal(new Set([...sourceQuids, clone.quid, cloneChild.quid, second.quid, secondChild.quid]).size, 6);
        assert.ok(canonical_hson_graph_equal(clone_hson_graph_without_quids(subject_for_tree(source)), clone_hson_graph_without_quids(subject_for_tree(clone))));
        for (const [a, b] of [[source, clone], [child, cloneChild], [clone, second], [cloneChild, secondChild]]) {
          const left = subject_for_tree(a!), right = subject_for_tree(b!);
          assert.notEqual(left, right);
          assert.notEqual(left.$_attrs, right.$_attrs);
          assert.notEqual(left.$_attrs?.style, right.$_attrs?.style);
          assert.notEqual(style_leaf(left, "width"), style_leaf(right, "width"));
          assert_style_fidelity(right);
        }
        clone.style.set.color("blue");
        assert.equal(source.style.get.color(), "red");
        assert.equal(second.style.get.color(), "red");
        source.style.remove("width");
        assert.ok(Object.hasOwn(record(subject_for_tree(clone).$_attrs?.style), "width"));
        child.style.set.color("green");
        assert.equal(cloneChild.style.get.color(), "red");
        cloneChild.style.remove("width");
        assert.ok(Object.hasOwn(record(subject_for_tree(child).$_attrs?.style), "width"));
        assert.ok(Object.hasOwn(record(subject_for_tree(secondChild).$_attrs?.style), "width"));
        secondChild.attrs.set("title", "third");
        assert.equal(child.attrs.get("title"), "original");
        assert.equal(cloneChild.attrs.get("title"), "original");
        assert.equal(subject_for_tree(new LiveTree(source)), subject_for_tree(source), "genuine handle aliases retain their subject");
      } finally { second.remove(); clone.remove(); source.remove(); }
      for (const quid of sourceQuids) assert.equal(runtime.quidToNode.has(quid), false);
    });
    case_("public cloneBranch also owns lawful runtime form arrays and scalar styles", () => {
      const source = new LiveTree({ $_tag: "select", $_content: [] });
      source.attrs.set("style", -0);
      source.form.setSelected(["10", "2"]);
      const clone = source.cloneBranch(), second = clone.cloneBranch();
      try {
        const values = subject_for_tree(source).$_attrs?.values;
        assert.ok(Array.isArray(values));
        assert.notEqual(subject_for_tree(clone).$_attrs?.values, values);
        assert.notEqual(subject_for_tree(second).$_attrs?.values, subject_for_tree(clone).$_attrs?.values);
        for (const tree of [source, clone, second]) {
          assert.deepEqual(tree.node.$_attrs?.values, ["10", "2"]);
          assert.ok(Object.is(tree.node.$_attrs?.style, -0));
        }
        clone.form.setSelected(["1"]);
        assert.deepEqual(source.node.$_attrs?.values, ["10", "2"]);
        assert.deepEqual(second.node.$_attrs?.values, ["10", "2"]);
        source.form.setSelected(["2"]);
        assert.deepEqual(clone.node.$_attrs?.values, ["1"]);
        assert.deepEqual(second.node.$_attrs?.values, ["10", "2"]);
      } finally { second.remove(); clone.remove(); source.remove(); }
    });
    case_("attribute comparison and public writes honor both signed-zero directions", () => {
      const positive = decode_public_attrs({ count: 0, style: { width: { value: 0, unit: undefined } } });
      const negative = decode_public_attrs({ count: -0, style: { width: { value: -0, unit: undefined } } });
      const absent = decode_public_attrs({ count: -0, style: { width: { value: -0 } } });
      assert.ok(positive && negative && absent);
      assert.equal(canonical_public_attrs_equal(positive, negative), false);
      assert.equal(canonical_public_attrs_equal(negative, positive), false);
      assert.equal(canonical_public_attrs_equal(negative, absent), false);
      assert.equal(canonical_public_attrs_equal(negative, decode_public_attrs({ count: -0, style: { width: { value: -0, unit: undefined } } })!), true);
      const tree = new LiveTree({ $_tag: "main", $_attrs: { count: 0, style: { width: { value: 0 } } }, $_content: [] });
      const subject = subject_for_tree(tree), runtime = runtime_for_tree(tree), issued = [...runtime.issuedQuids];
      try {
        for (const value of [-0, 0, -0]) {
          tree.attrs.set("count", value);
          tree.attrs.set("style", { width: { value } });
          assert.ok(Object.is(tree.attrs.get("count"), value));
          assert.ok(Object.is(style_leaf(subject, "width").value, value));
          const attrs = subject.$_attrs;
          tree.attrs.set("count", value);
          tree.attrs.set("style", { width: { value } });
          assert.equal(subject.$_attrs, attrs);
          assert.equal(subject_for_tree(tree), subject);
          assert.deepEqual([...runtime.issuedQuids], issued);
        }
      } finally { tree.remove(); }
    });
    case_("Transform serialization retains its existing exact snapshot route", () => {
      const branch = style_branch();
      delete branch.$_attrs!.count;
      const value: HsonNode = { $_tag: "_hson_elem", $_content: [branch] };
      const transform = hsonTransform.fromNode(value);
      assert.ok(canonical_hson_graph_equal(transform.toNode(), value));
      assert.equal(transform.toHtml().serialize().includes("<main"), true);
      const data: HsonNode = { $_tag: "_hson_arr", $_content: [
        { $_tag: "_hson_ii", $_meta: { index: "0" }, $_content: [{ $_tag: "_hson_val", $_content: [-0] }] },
        { $_tag: "_hson_ii", $_meta: { index: "1" }, $_content: [{ $_tag: "_hson_val", $_content: [0] }] },
      ] };
      assert.match(hsonTransform.fromNode(data).toJson().serialize(), /-0/);
      assert.match(serialize_json(data), /-0/);
      assert.match(serialize_html(data), /-0/);
      const item = data.$_content[0]; assert.ok(is_Node(item));
      const primitive = item.$_content[0]; assert.ok(is_Node(primitive));
      assert.ok(Object.is(primitive.$_content[0], -0));
    });
    case_("continuation copying retains exact typed storage and native DOM identity", () => {
      const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
      const nodeDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Node");
      install_fake_document();
      const branch = style_branch(), root = new FakeElement("main");
      for (const [name, value] of Object.entries(branch.$_attrs!)) {
        const lowered = lower_browser_attribute_value(name, value, "html");
        if (lowered !== undefined) root.setAttribute(lowered.name, lowered.value);
      }
      const map = hsonLiveMap.fromLibraries({ page: { document: { $_tag: "_hson_root", $_content: [branch] } } });
      const continuation = continue_document({ map, root: root as unknown as Element });
      try {
        assert.equal(continuation.tree.dom.el(), root);
        assert.ok(canonical_hson_graph_equal(continuation.tree.node, branch));
        assert_style_fidelity(subject_for_tree(continuation.tree));
        continuation.tree.attrs.set("title", "continued");
        assert.equal(map.rev, 1);
        assert.equal(root.getAttribute("title"), "continued");
        assert_style_fidelity(subject_for_tree(continuation.tree));
        assert.equal(subject_for_tree(continuation.tree).$_meta, undefined, "continuation remains sparse");
      } finally {
        continuation.dispose(); continuation.tree.remove();
        if (documentDescriptor === undefined) Reflect.deleteProperty(globalThis, "document");
        else Object.defineProperty(globalThis, "document", documentDescriptor);
        if (nodeDescriptor === undefined) Reflect.deleteProperty(globalThis, "Node");
        else Object.defineProperty(globalThis, "Node", nodeDescriptor);
      }
    });
  }
  check("Cut 8 fallback rejects unsupported storage without running accessors", () => without_structured_clone(() => {
    let reads = 0;
    const accessor = Object.defineProperty({}, "unit", { enumerable: true, get() { reads++; return undefined; } });
    const cycle: { self?: object } = {}; cycle.self = cycle;
    for (const value of [accessor, cycle, new Date(), new Map(), () => {}, Symbol("unit"), NaN,
      Object.defineProperty({}, "hidden", { value: 1 }), { [Symbol("key")]: 1 }]) assert.throws(() => clone_node(value), /Clone source/);
    assert.equal(reads, 0);
  }));
}
