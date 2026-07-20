import assert from "node:assert/strict";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import type { HsonNode } from "../src/core/types.ts";

let checks = 0;
function check(name: string, fn: () => void): void {
  fn();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function node(
  tag: string,
  content: HsonNode["$_content"] = [],
  attrs?: HsonNode["$_attrs"],
  meta?: HsonNode["$_meta"],
): HsonNode {
  return {
    $_tag: tag,
    ...(attrs === undefined ? {} : { $_attrs: attrs }),
    ...(meta === undefined ? {} : { $_meta: meta }),
    $_content: content,
  };
}

function document(root: HsonNode): HsonNode {
  return node("_hson_root", [node("_hson_elem", [root])]);
}

function raw_style_document(style: string): HsonNode {
  const attrs = {};
  Reflect.set(attrs, "style", style);
  return document(node("div", [], attrs));
}

check("detached canonical graphs compare structurally", () => {
  const left = document(node("main", [node("_hson_str", ["hello"])], { id: "root" }));
  const right = structuredClone(left);
  assert.notEqual(left, right);
  assert.notEqual(left.$_content[0], right.$_content[0]);
  assert.equal(canonical_hson_graph_equal(left, right), true);
});

check("root, nested tag, and wrapper differences are significant", () => {
  assert.equal(canonical_hson_graph_equal(document(node("main")), document(node("aside"))), false);
  assert.equal(
    canonical_hson_graph_equal(
      document(node("main", [node("span")])),
      document(node("main", [node("em")])),
    ),
    false,
  );
  assert.equal(
    canonical_hson_graph_equal(
      document(node("main", [node("_hson_str", ["x"])])),
      document(node("main", [node("wrapper", [node("_hson_str", ["x"])])])),
    ),
    false,
  );
});

check("content and nested arrays remain ordered", () => {
  const first = document(node("main", [node("a"), node("b")]));
  const same = document(node("main", [node("a"), node("b")]));
  const reordered = document(node("main", [node("b"), node("a")]));
  const inserted = document(node("main", [node("a"), node("b"), node("c")]));
  const removed = document(node("main", [node("a")]));
  assert.equal(canonical_hson_graph_equal(first, same), true);
  assert.equal(canonical_hson_graph_equal(first, reordered), false);
  assert.equal(canonical_hson_graph_equal(first, inserted), false);
  assert.equal(canonical_hson_graph_equal(first, removed), false);
  assert.equal(
    canonical_hson_graph_equal(
      document(node("main", [node("x", [node("a"), node("b")])])),
      document(node("main", [node("x", [node("b"), node("a")])])),
    ),
    false,
  );
});

check("primitive values remain type-sensitive without coercion", () => {
  const graph = (value: string | number | boolean | null): HsonNode =>
    document(node("value", [node(typeof value === "string" ? "_hson_str" : "_hson_val", [value])]));
  assert.equal(canonical_hson_graph_equal(graph(0), graph("0")), false);
  assert.equal(canonical_hson_graph_equal(graph(false), graph("false")), false);
  assert.equal(canonical_hson_graph_equal(graph(null), graph("null")), false);
  assert.equal(canonical_hson_graph_equal(graph(""), graph("")), true);
  assert.equal(canonical_hson_graph_equal(graph(""), graph(" ")), false);
});

check("attribute key order is irrelevant while key sets, values, and types remain exact", () => {
  const left = document(node("div", [], { count: 0, enabled: false }));
  const reordered = document(node("div", [], { enabled: false, count: 0 }));
  const changedKey = document(node("div", [], { enabled: false, total: 0 }));
  const changedValue = document(node("div", [], { enabled: true, count: 0 }));
  const changedType = document(node("div", [], { enabled: false, count: "0" }));
  const missing = document(node("div", [], { count: 0 }));
  assert.equal(canonical_hson_graph_equal(left, reordered), true);
  assert.equal(canonical_hson_graph_equal(left, changedKey), false);
  assert.equal(canonical_hson_graph_equal(left, changedValue), false);
  assert.equal(canonical_hson_graph_equal(left, changedType), false);
  assert.equal(canonical_hson_graph_equal(left, missing), false);
});

check("metadata key order is irrelevant and all metadata participates", () => {
  const left = document(node("div", [], undefined, {
    "data-_quid": "0000000000000001",
    "data-_custom": "kept",
  }));
  const reordered = document(node("div", [], undefined, {
    "data-_custom": "kept",
    "data-_quid": "0000000000000001",
  }));
  const changedQuid = document(node("div", [], undefined, {
    "data-_quid": "0000000000000002",
    "data-_custom": "kept",
  }));
  const missingQuid = document(node("div", [], undefined, { "data-_custom": "kept" }));
  const changedOther = document(node("div", [], undefined, {
    "data-_quid": "0000000000000001",
    "data-_custom": "changed",
  }));
  assert.equal(canonical_hson_graph_equal(left, reordered), true);
  assert.equal(canonical_hson_graph_equal(left, changedQuid), false);
  assert.equal(canonical_hson_graph_equal(left, missingQuid), false);
  assert.equal(canonical_hson_graph_equal(left, changedOther), false);
});

check("structured style is record-ordered while raw style strings remain exact", () => {
  const left = document(node("div", [], { style: { color: "red", display: "block" } }));
  const reordered = document(node("div", [], { style: { display: "block", color: "red" } }));
  const changed = document(node("div", [], { style: { color: "blue", display: "block" } }));
  assert.equal(canonical_hson_graph_equal(left, reordered), true);
  assert.equal(canonical_hson_graph_equal(left, changed), false);
  assert.equal(canonical_hson_graph_equal(raw_style_document("color:red"), raw_style_document("color:red")), true);
  assert.equal(canonical_hson_graph_equal(raw_style_document("color:red"), raw_style_document("color: red")), false);
});

check("ordered object-property content is not treated as an unordered record", () => {
  const property = (name: string, value: string): HsonNode => node(name, [node("_hson_obj", [node("_hson_str", [value])])]);
  const left = node("_hson_root", [node("_hson_obj", [property("a", "1"), property("b", "2")])]);
  const reordered = node("_hson_root", [node("_hson_obj", [property("b", "2"), property("a", "1")])]);
  assert.equal(canonical_hson_graph_equal(left, reordered), false);
});

check("absent attrs and metadata differ from explicitly empty records", () => {
  const absent = document(node("div"));
  const emptyAttrs = document(node("div", [], {}));
  const emptyMeta = document(node("div", [], undefined, {}));
  assert.equal(canonical_hson_graph_equal(absent, emptyAttrs), false);
  assert.equal(canonical_hson_graph_equal(absent, emptyMeta), false);
});

check("nested records are key-order-insensitive, arrays ordered, and records differ from arrays", () => {
  const left = document(node("div", [], { style: { color: "red", margin: "0" } }));
  const reordered = document(node("div", [], { style: { margin: "0", color: "red" } }));
  assert.equal(canonical_hson_graph_equal(left, reordered), true);

  const arrayLeft = document(node("div", [node("x"), node("y")]));
  const arrayRight = document(node("div", [node("y"), node("x")]));
  assert.equal(canonical_hson_graph_equal(arrayLeft, arrayRight), false);

  const recordValue = document(node("div", [], { style: { 0: "x", 1: "y" } }));
  const arrayValue = structuredClone(recordValue);
  const arrayRoot = arrayValue.$_content[0];
  if (typeof arrayRoot !== "object" || arrayRoot === null) throw new Error("Expected root node.");
  Reflect.set(arrayRoot, "$_attrs", { style: ["x", "y"] });
  assert.equal(canonical_hson_graph_equal(recordValue, arrayValue), false);
});

check("numeric edge behavior matches strict equality", () => {
  const graph = (value: number): HsonNode => document(node("value", [node("_hson_val", [value])]));
  const sameNaNGraph = graph(Number.NaN);
  assert.equal(canonical_hson_graph_equal(sameNaNGraph, sameNaNGraph), true);
  assert.equal(canonical_hson_graph_equal(graph(Number.NaN), graph(Number.NaN)), false);
  assert.equal(canonical_hson_graph_equal(graph(Infinity), graph(Infinity)), true);
  assert.equal(canonical_hson_graph_equal(graph(-Infinity), graph(-Infinity)), true);
  assert.equal(canonical_hson_graph_equal(graph(+0), graph(-0)), true);
});

check("comparison does not mutate key order, content, attrs, metadata, or style", () => {
  const left = document(node(
    "main",
    [node("b"), node("a")],
    { title: "x", style: { zIndex: "1", color: "red" } },
    { "data-_custom": "kept", "data-_quid": "0000000000000003" },
  ));
  const right = structuredClone(left);
  const beforeLeft = structuredClone(left);
  const beforeRight = structuredClone(right);
  const leftRoot = left.$_content[0];
  if (typeof leftRoot !== "object" || leftRoot === null) throw new Error("Expected root node.");
  const attrsKeys = Object.keys(leftRoot.$_attrs ?? {});
  const metaKeys = Object.keys(leftRoot.$_meta ?? {});
  const style = leftRoot.$_attrs?.style;
  const styleKeys = typeof style === "object" && style !== null ? Object.keys(style) : [];

  assert.equal(canonical_hson_graph_equal(left, right), true);
  assert.deepEqual(left, beforeLeft);
  assert.deepEqual(right, beforeRight);
  assert.deepEqual(Object.keys(leftRoot.$_attrs ?? {}), attrsKeys);
  assert.deepEqual(Object.keys(leftRoot.$_meta ?? {}), metaKeys);
  assert.deepEqual(typeof style === "object" && style !== null ? Object.keys(style) : [], styleKeys);
});

process.stdout.write(`# ${checks} canonical HSON equality checks passed\n`);
