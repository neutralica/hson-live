import assert from "node:assert/strict";

import { hson } from "../src/hson.ts";
import { assert_invariants } from "../src/core/assert-invariants.ts";
import { normalize_hson_graph } from "../src/core/normalize-hson-graph.ts";
import { serialize_hson } from "../src/api/transform/serializers/serialize-hson.ts";
import { TransformError } from "../src/core/errors.ts";
import type { HsonNode } from "../src/core/types.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

let checks = 0;

function check(name: string, fn: () => void): void {
  fn();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function node(tag: string, content: HsonNode["$_content"] = []): HsonNode {
  return { $_tag: tag, $_content: content };
}

function root(cluster: HsonNode): HsonNode {
  return node("_hson_root", [cluster]);
}

function elem(...content: HsonNode[]): HsonNode {
  return node("_hson_elem", content);
}

function obj(...content: HsonNode[]): HsonNode {
  return node("_hson_obj", content);
}

function arr(...content: HsonNode[]): HsonNode {
  return node("_hson_arr", content);
}

function item(index: string, value?: HsonNode): HsonNode {
  return {
    $_tag: "_hson_ii",
    $_meta: { index },
    $_content: value === undefined ? [] : [value],
  };
}

function parse(source: string): HsonNode {
  return hson.fromHson(source).toNode();
}

function compact(source: string): string {
  return hson.fromHson(source).toHson().noBreak().serialize();
}

function rejectsEveryBoundary(candidate: HsonNode, pattern: RegExp): void {
  const before = structuredClone(candidate);
  assert.throws(() => assert_invariants(candidate, "structural-mode regression"), pattern);
  assert.deepEqual(candidate, before);
  assert.throws(() => hson.fromNode(candidate).toNode(), pattern);
  assert.deepEqual(candidate, before);
  const serializerCandidate = candidate.$_tag === "_hson_root"
    ? candidate.$_content[0] as HsonNode
    : candidate;
  assert.throws(() => serialize_hson(serializerCandidate), pattern);
  assert.deepEqual(candidate, before);
}

check("parser groups a uniform top-level element sequence", () => {
  const parsed = parse(`<a/><b/>`);
  assert.equal(parsed.$_tag, "_hson_elem");
  assert.equal(compact(`<a/><b/>`), `<a/> <b/>`);
});

check("parser retains one complete top-level object value", () => {
  const parsed = parse(`<a 1 b 2>`);
  assert.equal(parsed.$_tag, "_hson_obj");
  assert.equal(compact(`<a 1 b 2>`), `<a 1 b 2>`);
});

check("parser retains an element child beneath an element parent", () => {
  assert.equal(compact(`<wrapper <child/>/>`), `<wrapper <child/>/>`);
});

check("parser retains an object property beneath an object parent", () => {
  assert.equal(compact(`<record <field 2>>`), `<record <field 2>>`);
});

check("parser retains strings interleaved with element children", () => {
  assert.equal(
    compact(`<p "first" <em "middle"/> "last"/>`),
    `<p "first" <em "middle"/> "last"/>`,
  );
});

check("parser retains an object scalar property", () => {
  assert.equal(compact(`<record <field 2>>`), `<record <field 2>>`);
});

check("parser retains a nested object property", () => {
  assert.equal(compact(`<record <nested <field 2>>>`), `<record <nested <field 2>>>`);
});

check("parser retains an array-valued object property", () => {
  assert.equal(compact(`<record <items «1,2»>>`), `<record <items «1,2»>>`);
});

check("parser rejects mixed top-level element then object mode", () => {
  assert.throws(() => parse(`<a/><b 2>`), /mixed top-level structural modes.*elem, obj/);
});

check("parser rejects mixed top-level object then element mode", () => {
  assert.throws(() => parse(`<a 1><b/>`), /mixed top-level structural modes.*obj, elem/);
});

check("parser rejects an object child beneath an element parent", () => {
  assert.throws(() => parse(`<wrapper <child 2>/>`), /structural mode crossing.*wrapper.*object-mode.*1:10/);
});

check("parser rejects an array-valued child beneath an element parent", () => {
  assert.throws(() => parse(`<wrapper «1»/>`), /element branch.*cannot contain object\/array structure/);
});

check("parser rejects an element child beneath an object parent", () => {
  assert.throws(() => parse(`<record <field/>>`), /cannot contain an element-mode value/);
});

check("parser rejects a deeper recursive element-to-object crossing", () => {
  assert.throws(() => parse(`<outer <middle <field 2>/>/>`), /structural mode crossing.*middle.*object-mode/);
});

check("parser rejects a deeper recursive object-to-element crossing", () => {
  assert.throws(() => parse(`<outer <middle <leaf/>>>`), /cannot contain an element-mode value/);
});

check("canonical admission accepts an empty ordinary element node", () => {
  assert.doesNotThrow(() => assert_invariants(node("empty"), "empty ordinary element"));
});

check("canonical admission accepts one nonempty element relationship", () => {
  assert.doesNotThrow(() => assert_invariants(node("wrapper", [elem(node("child"))]), "element relationship"));
});

check("canonical admission preserves empty object and empty array clusters", () => {
  assert.doesNotThrow(() => assert_invariants(root(obj()), "empty object"));
  assert.doesNotThrow(() => assert_invariants(root(arr()), "empty array"));
  assert.equal(serialize_hson(obj()), `<>`);
  assert.equal(serialize_hson(arr()), `«»`);
});

check("canonical admission accepts a recursively nested element branch", () => {
  assert.doesNotThrow(() => assert_invariants(root(elem(node("outer", [elem(node("inner"))]))), "nested element"));
});

check("canonical admission accepts a recursively nested object branch", () => {
  const graph = root(obj(node("record", [obj(node("field", [obj(node("_hson_val", [2]))]))])));
  assert.doesNotThrow(() => assert_invariants(graph, "nested object"));
});

check("canonical array membership accepts object-wrapped ordinary values", () => {
  const value = obj(node("field", [obj(node("_hson_val", [2]))]));
  const graph = root(arr(item("0", value)));
  assert.doesNotThrow(() => assert_invariants(graph, "object-wrapped array item"));
});

check("canonical string leaf accepts the empty string", () => {
  assert.doesNotThrow(() => assert_invariants(node("_hson_str", [""]), "empty string leaf"));
});

check("canonical value leaf accepts finite numbers, negative zero, booleans, and null", () => {
  for (const value of [0, -0, 1.5, true, false, null]) {
    assert.doesNotThrow(() => assert_invariants(node("_hson_val", [value]), "valid value leaf"));
  }
});

check("fromNode elides only a sole empty element wrapper without mutating its caller", () => {
  const source = node("empty", [elem()]);
  const before = structuredClone(source);
  const normalized = hson.fromNode(source).toNode();
  assert.deepEqual(source, before);
  assert.deepEqual(normalized, node("empty"));
  assert.notEqual(normalized, source);
});

check("standalone empty element wrappers reject at every canonical boundary", () => {
  rejectsEveryBoundary(elem(), /empty _hson_elem is not valid retained canonical state/);
});

check("root-attached empty element wrappers reject at every canonical boundary", () => {
  rejectsEveryBoundary(root(elem()), /empty _hson_elem is not valid retained canonical state/);
});

check("nested redundant empty element wrappers reject at every canonical boundary", () => {
  rejectsEveryBoundary(root(elem(elem())), /empty _hson_elem is not valid retained canonical state/);
});

check("element branches reject typed value leaves", () => {
  for (const value of [false, null, 1, -0]) {
    rejectsEveryBoundary(root(elem(node("_hson_val", [value]))), /_hson_elem cannot contain _hson_val/);
  }
});

check("element branches reject object clusters", () => {
  rejectsEveryBoundary(root(elem(obj())), /_hson_elem cannot contain _hson_obj/);
});

check("element branches reject array clusters", () => {
  rejectsEveryBoundary(root(elem(arr())), /_hson_elem cannot contain _hson_arr/);
});

check("element branches reject ordinary nodes with object content", () => {
  rejectsEveryBoundary(root(elem(node("child", [obj()]))), /element branch requires recursively element-structured/);
});

check("element branches reject ordinary nodes with array content", () => {
  rejectsEveryBoundary(root(elem(node("child", [arr()]))), /element branch requires recursively element-structured/);
});

check("object branches reject ordinary properties with element content", () => {
  rejectsEveryBoundary(root(obj(node("property", [elem(node("child"))]))), /object property must retain/);
});

check("object branches reject empty element-shaped ordinary properties", () => {
  rejectsEveryBoundary(root(obj(node("property"))), /object property must retain/);
});

check("ordinary nodes reject multiple structural wrappers", () => {
  rejectsEveryBoundary(node("mixed", [obj(), arr()]), /exactly one structural wrapper|contradictory or redundant/);
});

check("ordinary nodes reject direct primitive payloads", () => {
  rejectsEveryBoundary(node("value", [2]), /structural wrapper/);
});

check("array items reject direct ordinary node children", () => {
  rejectsEveryBoundary(root(arr(item("0", node("property", [obj()])))), /ordinary.*_hson_ii|_hson_ii.*ordinary/);
});

check("arrays reject element-mode values recursively", () => {
  assert.throws(() => parse(`«<child/>»`), /_hson_arr cannot contain an element-mode value/);
  assert.throws(() => parse(`<items ««<child/>»»>`), /_hson_arr cannot contain an element-mode value/);
  const direct = root(arr(item("0", elem(node("child")))));
  rejectsEveryBoundary(direct, /_hson_arr cannot contain an element-mode value/);
  const nested = root(arr(item("0", arr(item("0", elem(node("child")))))));
  rejectsEveryBoundary(nested, /_hson_arr cannot contain an element-mode value/);
});

check("array items reject empty membership wrappers", () => {
  rejectsEveryBoundary(root(arr(item("0"))), /_hson_ii must contain exactly one child node/);
});

check("value leaves reject every payload outside the exact primitive domain", () => {
  const forbidden: ReadonlyArray<readonly [string, HsonNode["$_content"]]> = [
    ["string", ["x"]],
    ["plain object", [{} as unknown as HsonNode]],
    ["array", [[] as unknown as HsonNode]],
    ["HsonNode", [node("child")]],
    ["undefined", [undefined as unknown as null]],
    ["NaN", [Number.NaN]],
    ["Infinity", [Infinity]],
    ["negative Infinity", [-Infinity]],
    ["absent", []],
    ["multiple", [1, 2]],
  ];
  for (const [name, content] of forbidden) {
    const candidate = node("_hson_val", content);
    assert.throws(
      () => assert_invariants(candidate, `forbidden value payload: ${name}`),
      /_hson_val|invalid Hson number/,
      name,
    );
    assert.throws(() => serialize_hson(candidate), /_hson_val|invalid Hson number/, name);
  }
});

check("valid structural source order does not affect unanimous grouping", () => {
  assert.equal(parse(`<a/><b/>`).$_tag, "_hson_elem");
  assert.equal(parse(`<b/><a/>`).$_tag, "_hson_elem");
  assert.equal(parse(`<a 1 b 2>`).$_tag, "_hson_obj");
  assert.equal(parse(`<b 2 a 1>`).$_tag, "_hson_obj");
});

check("JSON scalar, nested-object, and array relationships remain canonical", () => {
  const value = { scalar: 2, nested: { field: true }, items: [{ name: "Ada" }] };
  assert.deepEqual(hson.fromJson(value).toJson().value(), value);
});

check("direct serialization never emits a literal empty element wrapper", () => {
  assert.throws(() => serialize_hson(elem()), /empty _hson_elem/);
});

check("authored structural crossings retain parser-owned structured evidence", () => {
  assert.throws(
    () => parse(`<outer <field 1>/>`),
    (cause) => cause instanceof TransformError
      && cause.code === "HSON_STRUCTURAL_MODE_CROSSING"
      && cause.stage === "tokenization"
      && cause.source?.index === 7
      && cause.source.line === 1
      && cause.source.column === 8,
  );
});

process.stdout.write(`# ${checks} structural-mode checks passed\n`);
emit_hson_live_test_completion("transform.hson-structural-mode", checks, checks, 0);
