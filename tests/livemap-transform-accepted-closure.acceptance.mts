import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
// @hson-live-external-test

import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import { make_livemap_core } from "../src/api/livemap/livemap.core.ts";
import { parse_json } from "../src/api/transform/parsers/parse-json.ts";
import { assert_invariants } from "../src/core/assert-invariants.ts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import { normalize_hson_graph } from "../src/core/normalize-hson-graph.ts";
import { admit_projected_value } from "../src/core/projected-value-admission.ts";
import {
  is_ordered_projected_object,
  ordered_projected_array,
  ordered_projected_object,
  ordered_projected_value_equal,
  type OrderedProjectedValue,
} from "../src/core/ordered-projected-value.ts";
import {
  projected_value_from_hson_node,
  projected_value_to_hson_root,
} from "../src/core/projected-value-graph.ts";
import type { HsonNode, JsonValue } from "../src/core/types.ts";

let checks = 0;
function check(name: string, run: () => void): void {
  run(); checks += 1; process.stdout.write(`ok ${checks} - ${name}\n`);
}

function own_data(entries: readonly (readonly [string, unknown])[], prototype: object | null = Object.prototype): Record<string, unknown> {
  const value = Object.create(prototype) as Record<string, unknown>;
  for (const [key, child] of entries) {
    Object.defineProperty(value, key, { value: child, enumerable: true, writable: true, configurable: true });
  }
  return value;
}

function assert_closed_graph(actual: HsonNode, expected: HsonNode, label: string): void {
  assert.equal(canonical_hson_graph_equal(actual, expected), true, label);
  assert_invariants(actual, label);
  assert.equal(canonical_hson_graph_equal(actual, normalize_hson_graph(actual, label)), true, `${label}: normalization delta`);
}

function assert_javascript_equivalence(value: unknown, transformValue: JsonValue = value as JsonValue): OrderedProjectedValue {
  const firstCarrier = admit_projected_value(value);
  const secondCarrier = admit_projected_value(value);
  assert.equal(ordered_projected_value_equal(firstCarrier, secondCarrier), true);
  const carrierGraph = projected_value_to_hson_root(firstCarrier);
  const transformGraph = typeof transformValue === "string"
    ? parse_json(JSON.stringify(transformValue))
    : parse_json(transformValue);
  assert_closed_graph(carrierGraph, transformGraph, "Transform–carrier equivalence");
  if (firstCarrier === null || typeof firstCarrier !== "object") {
    const mapCarrier = ordered_projected_object([["value", firstCarrier]]);
    const valueMap = make_livemap_core(projected_value_to_hson_root(mapCarrier));
    const mapExpected = projected_value_to_hson_root(mapCarrier);
    assert_closed_graph(valueMap.root(), mapExpected, "LiveMap scalar-property equivalence");
  } else {
    const valueMap = make_livemap_core(carrierGraph);
    assert_closed_graph(valueMap.root(), transformGraph, "Transform–LiveMap equivalence");
    assert.equal(ordered_projected_value_equal(projected_value_from_hson_node(valueMap.root()), firstCarrier), true);
  }
  return firstCarrier;
}

function graph_object_keys(root: HsonNode): readonly string[] {
  const value = root.$_content[0];
  if (typeof value !== "object" || value === null || value.$_tag !== "_hson_obj") throw new Error("Expected object root.");
  return value.$_content.map((child) => {
    if (typeof child !== "object" || child === null) throw new Error("Expected object property.");
    return child.$_tag;
  });
}

check("string roots close identically", () => { assert_javascript_equivalence("text", "text"); });
check("empty strings remain present", () => { assert_javascript_equivalence("", ""); });
check("isolated surrogate code units remain exact", () => { assert_javascript_equivalence("\ud800x\udfff", "\ud800x\udfff"); });
check("true roots close identically", () => { assert_javascript_equivalence(true); });
check("false roots close identically", () => { assert_javascript_equivalence(false); });
check("null roots close identically", () => { assert_javascript_equivalence(null); });
check("positive zero remains positive zero", () => {
  const carrier = assert_javascript_equivalence(0);
  assert.equal(Object.is(carrier, 0), true); assert.equal(Object.is(carrier, -0), false);
});
check("negative zero remains distinct", () => {
  const carrier = assert_javascript_equivalence(-0);
  assert.equal(Object.is(carrier, -0), true);
  assert.equal(canonical_hson_graph_equal(projected_value_to_hson_root(carrier), parse_json(0)), false);
});
check("finite signed numbers close identically", () => { assert_javascript_equivalence(-23.5); });
check("empty objects close identically", () => { assert_javascript_equivalence({}); });
check("empty arrays close identically", () => { assert_javascript_equivalence([]); });
check("nested objects and arrays close identically", () => {
  assert_javascript_equivalence({ user: { name: "Ada", flags: [true, null, -0] }, tail: [] });
});
check("objects inside arrays close identically", () => { assert_javascript_equivalence([{ a: 1, b: [2, 3] }]); });
check("arrays inside objects close identically", () => { assert_javascript_equivalence({ items: [1, { nested: [] }] }); });
check("dangerous own keys close as ordinary data", () => {
  const value = own_data([["__proto__", "data"], ["constructor", -0], ["prototype", true]]);
  const carrier = assert_javascript_equivalence(value, value as JsonValue);
  assert.equal(is_ordered_projected_object(carrier), true);
  if (!is_ordered_projected_object(carrier)) throw new Error("Expected object carrier.");
  assert.deepEqual(carrier.entries.map(([key]) => key), ["__proto__", "constructor", "prototype"]);
});
check("ordinary mixed key order closes identically", () => {
  assert_javascript_equivalence({ a: 1, "01": 2, "-1": 3, b: 4 });
});
check("structural JSON text preserves authored integer-like order", () => {
  const text = '{"10":"ten","2":"two","1":"one"}';
  const transformGraph = parse_json(text);
  const liveMapGraph = hson.liveMap.fromJson(text).root();
  const carrierGraph = projected_value_to_hson_root(ordered_projected_object([["10", "ten"], ["2", "two"], ["1", "one"]]));
  assert_closed_graph(liveMapGraph, transformGraph, "structural JSON LiveMap closure");
  assert_closed_graph(carrierGraph, transformGraph, "structural JSON carrier closure");
  assert.deepEqual(graph_object_keys(liveMapGraph), ["10", "2", "1"]);
});
check("structural JSON text preserves mixed key classes", () => {
  const text = '{"a":1,"10":10,"2":2,"01":1,"4294967294":4,"4294967295":5,"-1":-1,"b":2}';
  const transformGraph = parse_json(text);
  const liveMapGraph = hson.liveMap.fromJson(text).root();
  assert_closed_graph(liveMapGraph, transformGraph, "mixed structural JSON closure");
  assert.deepEqual(graph_object_keys(liveMapGraph), ["a", "10", "2", "01", "4294967294", "4294967295", "-1", "b"]);
});
check("null-prototype inputs close identically", () => {
  assert_javascript_equivalence(own_data([["a", 1], ["nested", own_data([["b", 2]], null)]], null) as JsonValue);
});
check("frozen objects admit without mutation", () => {
  const value = Object.freeze({ a: 1, nested: Object.freeze({ b: -0 }) });
  const before = Object.getOwnPropertyDescriptors(value);
  assert_javascript_equivalence(value);
  assert.deepEqual(Object.getOwnPropertyDescriptors(value), before);
});
check("sealed dense arrays admit without mutation", () => {
  const value = Object.seal([1, -0, { a: true }]);
  const before = Object.getOwnPropertyDescriptors(value);
  assert_javascript_equivalence(value);
  assert.deepEqual(Object.getOwnPropertyDescriptors(value), before);
});
check("repeated acyclic references copy structurally", () => {
  const child = { value: -0 };
  const carrier = assert_javascript_equivalence({ left: child, right: child });
  if (!is_ordered_projected_object(carrier)) throw new Error("Expected object carrier.");
  assert.notEqual(carrier.entries[0]?.[1], carrier.entries[1]?.[1]);
  child.value = 9;
  assert.equal(Object.is((carrier.entries[0]?.[1] as { entries: readonly (readonly [string, OrderedProjectedValue])[] }).entries[0]?.[1], -0), true);
});
check("scalar object wrappers close through a LiveMap set", () => {
  const map = make_livemap_core(parse_json({ value: 0 }));
  map.set(["value"], -0);
  assert_closed_graph(map.root(), parse_json({ value: -0 }), "scalar wrapper set closure");
});
check("array index wrappers close through a LiveMap splice", () => {
  const map = make_livemap_core(parse_json({ items: [0] }));
  map.splice(["items"], 0, 1, -0, own_data([["__proto__", "data"]]) as JsonValue);
  assert_closed_graph(map.root(), parse_json({ items: [-0, own_data([["__proto__", "data"]]) as JsonValue] }), "array index closure");
});

assert.equal(checks, 24);
process.stdout.write(`# ${checks} Transform–LiveMap accepted closure checks passed\n`);
emit_hson_live_test_completion("livemap.transform-accepted-closure", checks, checks, 0);
