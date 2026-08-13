import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
// @hson-live-external-test

import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import { make_livemap_core } from "../src/api/livemap/livemap.core.ts";
import { link_livemap } from "../src/api/livemap/livemap.link.ts";
import { livemap_projected_propagation } from "../src/api/livemap/livemap.projected-propagation.ts";
import { make_livemap_store_api } from "../src/api/livemap/livemap.store.ts";
import { decode_livemap_replay_payload, decode_projected_value_payload } from "../src/api/livemap/livemap.transport.ts";
import { make_livehost_canonical_stream } from "../src/api/livehost/livehost.history.ts";
import { parse_json } from "../src/api/transform/parsers/parse-json.ts";
import { assert_invariants } from "../src/core/assert-invariants.ts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import { canonical_public_attrs_equal, decode_public_attrs } from "../src/core/public-attrs.ts";
import { admit_projected_value } from "../src/core/projected-value-admission.ts";
import {
  is_ordered_projected_object,
  ordered_projected_array,
  ordered_projected_object,
  ordered_projected_value_equal,
  type OrderedProjectedObject,
  type OrderedProjectedValue,
} from "../src/core/ordered-projected-value.ts";
import { projected_value_from_hson_node, projected_value_to_hson_root } from "../src/core/projected-value-graph.ts";
import type { JsonValue, LiveMapCore } from "../src/types/index.ts";

let checks = 0;
function check(name: string, run: () => void): void { run(); checks += 1; process.stdout.write(`ok ${checks} - ${name}\n`); }
const object = (entries: readonly (readonly [string, OrderedProjectedValue])[]): OrderedProjectedObject => ordered_projected_object(entries);
const map = (value: OrderedProjectedValue) => make_livemap_core(projected_value_to_hson_root(value));
const carrier = (valueMap: ReturnType<typeof map>) => projected_value_from_hson_node(valueMap.root());
const capability = (valueMap: ReturnType<typeof map>) => {
  const projected = livemap_projected_propagation(valueMap);
  if (projected === undefined) throw new Error("Expected carrier propagation.");
  return projected;
};
function keys(value: OrderedProjectedValue | undefined): readonly string[] {
  if (!is_ordered_projected_object(value)) throw new Error("Expected object carrier.");
  return value.entries.map(([key]) => key);
}
function own_data(entries: readonly (readonly [string, JsonValue])[]): Record<string, JsonValue> {
  const value: Record<string, JsonValue> = {};
  for (const [key, child] of entries) Object.defineProperty(value, key, { value: child, enumerable: true, writable: true, configurable: true });
  return value;
}
function assert_same_graph(left: ReturnType<typeof map>, right: ReturnType<typeof map>): void {
  assert.equal(canonical_hson_graph_equal(left.root(), right.root()), true);
  assert_invariants(left.root(), "Unit F exact route closure");
}
const ordered = object([["10", 10], ["2", 2], ["1", 1], ["tail", -0]]);
const dangerous = object([["__proto__", "data"], ["constructor", -0], ["prototype", "\ud800"]]);
const nested = object([["value", object([["ordered", ordered], ["dangerous", dangerous], ["items", ordered_projected_array([ordered, dangerous, -0])]])]]);

check("exact capture restores to the strict original graph", () => {
  const source = map(nested); const target = map(object([["old", true]])); target.restore(source.capture()); assert_same_graph(source, target);
});
check("exact apply reconstructs the strict original graph", () => {
  const source = map(nested); const target = map(object([["old", true]])); const capture = source.capture();
  target.apply({ prevRev: 0, format: capture.format, formatVersion: capture.formatVersion, payload: capture.payload }); assert_same_graph(source, target);
});
check("exact replay closes a mutation commit", () => {
  const initial = object([["value", object([])]]); const source = map(initial); const target = map(initial);
  target.replay(source.replace(["value"], own_data([["a", -0], ["nested", [1, 2]]]))); assert_same_graph(source, target);
});
check("capture restore replay tail and link form one closed chain", () => {
  const initial = object([["value", object([["old", true]])]]);
  const source = map(initial); source.replace(["value"], own_data([["10", 10], ["2", 2], ["1", 1]]));
  const restored = map(initial); restored.restore(source.capture());
  restored.replay(source.setMany(["value"], { tail: -0 }));
  const target = map(initial); target.restore(restored.capture()); link_livemap(restored, target, { path: ["value"] });
  restored.setMany(["value"], { final: "\ud800" }); assert_same_graph(restored, target); assert.equal(restored.capture().payload, target.capture().payload);
});
check("repeated exact captures are byte stable", () => { const valueMap = map(nested); assert.equal(valueMap.capture().payload, valueMap.capture().payload); });
check("exact transport retains integer-like order", () => { assert.deepEqual(keys(decode_projected_value_payload(map(ordered).capture().payload)), ["10", "2", "1", "tail"]); });
check("exact transport retains mixed key classes", () => {
  const mixed = object([["a", 1], ["10", 10], ["2", 2], ["01", 1], ["4294967294", 4], ["4294967295", 5], ["-1", -1], ["b", 2]]);
  assert.deepEqual(keys(decode_projected_value_payload(map(mixed).capture().payload)), keys(mixed));
});
check("exact transport retains dangerous own names", () => { assert.deepEqual(keys(decode_projected_value_payload(map(dangerous).capture().payload)), ["__proto__", "constructor", "prototype"]); });
check("exact transport retains negative zero", () => {
  const value = decode_projected_value_payload(map(object([["value", -0]])).capture().payload);
  assert.equal(Object.is(is_ordered_projected_object(value) ? value.entries[0]?.[1] : undefined, -0), true);
});
check("exact transport retains unusual string code units", () => {
  const value = decode_projected_value_payload(map(object([["value", "\ud800x\udfff"]])).capture().payload);
  assert.equal(is_ordered_projected_object(value) ? value.entries[0]?.[1] : undefined, "\ud800x\udfff");
});
check("objects inside arrays remain exact", () => {
  const value = object([["items", ordered_projected_array([ordered])]]); const target = map(object([])); target.restore(map(value).capture());
  assert.equal(ordered_projected_value_equal(carrier(target), value), true);
});
check("arrays inside objects remain exact", () => {
  const value = object([["nested", object([["items", ordered_projected_array([1, -0, dangerous])]])]]); const target = map(object([])); target.restore(map(value).capture());
  assert.equal(ordered_projected_value_equal(carrier(target), value), true);
});
check("repeated source references become detached structural occurrences", () => {
  const child = { value: 1 }; const admitted = admit_projected_value({ left: child, right: child }); const valueMap = map(admitted);
  const restored = map(object([])); restored.restore(valueMap.capture()); assert_same_graph(valueMap, restored); child.value = 9; assert.equal(valueMap.snap(["left", "value"]), 1);
});
check("null-prototype ingress remains exact through capture", () => {
  const input = Object.create(null) as Record<string, JsonValue>; Object.defineProperty(input, "value", { value: -0, enumerable: true });
  const source = hson.liveMap.fromJson(input); const target = map(object([])); target.restore(source.capture()); assert.equal(canonical_hson_graph_equal(source.root(), target.root()), true);
});
check("public feeds observe detached values while canonical state remains exact", () => {
  const source = map(object([["value", object([])]])); let observed: unknown;
  source.feed(["value"], (event) => { observed = event.value; (event.value as Record<string, JsonValue>).tail = 99; });
  capability(source).commit([{ kind: "replace", path: ["value"], value: ordered }]);
  assert.deepEqual(Object.keys(observed as object), ["1", "2", "10", "tail"]); assert.deepEqual(keys(capability(source).read(["value"])), ["10", "2", "1", "tail"]);
});
check("links propagate the exact carrier graph", () => {
  const source = map(object([["value", object([])]])); const target = map(object([["value", object([])]])); link_livemap(source, target, { path: ["value"] });
  capability(source).commit([{ kind: "replace", path: ["value"], value: ordered }]); assert_same_graph(source, target);
});
check("store publication preserves SameValue and detached reads", () => {
  const valueMap = map(object([["value", 0]])); const store = make_livemap_store_api(valueMap); let observed: unknown;
  store.subscribePath(["value"], (next) => { observed = next; }); capability(valueMap).commit([{ kind: "set", path: ["value"], value: -0 }]); assert.equal(Object.is(observed, -0), true);
});
check("carrier-native commits remain authoritative and mocks do not define them", () => {
  const valueMap = map(object([["value", object([])]])); capability(valueMap).commit([{ kind: "replace", path: ["value"], value: dangerous }]);
  assert.deepEqual(keys(capability(valueMap).read(["value"])), ["__proto__", "constructor", "prototype"]);
  const mock = { snap: () => ({}) } as unknown as LiveMapCore<JsonValue | undefined>;
  assert.equal(livemap_projected_propagation(mock), undefined);
});
check("LiveHost canonical commit payloads decode to the committed carrier", () => {
  const valueMap = map(object([["value", object([])]])); const stream = make_livehost_canonical_stream(valueMap, { logicalMapId: "unit-f", incarnationId: "closure" });
  let payload: string | undefined; stream.on_commit((commit) => { payload = commit.payload; }); capability(valueMap).commit([{ kind: "replace", path: ["value"], value: ordered }]);
  assert.equal(typeof payload, "string");
  const operations = decode_livemap_replay_payload(payload!);
  assert.deepEqual(keys(operations[0]?.next), ["10", "2", "1", "tail"]);
});
check("legacy capture input remains readable and observably lossy", () => {
  const source = hson.liveMap.fromJson('{"10":10,"2":2,"1":1}'); const legacy = { rev: source.rev, value: source.snap() as JsonValue };
  const target = map(object([])); target.restore(legacy); assert.deepEqual(keys(carrier(target)), ["1", "2", "10"]); assert.equal(canonical_hson_graph_equal(source.root(), target.root()), false);
});
check("custom selector-result equality remains a separate detached domain", () => {
  const valueMap = hson.liveMap.fromJson({ value: 0, other: 0 }); let calls = 0; let equalityCalls = 0;
  valueMap.sub.sel((state) => (state as Record<string, JsonValue>).value, () => { calls += 1; }, { equal: (left, right) => { equalityCalls += 1; return Object.is(left, right); } });
  valueMap.set(["other"], 1); valueMap.set(["value"], -0); assert.equal(calls, 0); assert.equal(equalityCalls, 2);
});
check("document attribute equality remains unordered by name and value", () => {
  const left = decode_public_attrs({ a: 1, b: "two" }); const right = decode_public_attrs({ b: "two", a: 1 });
  if (left === undefined || right === undefined) throw new Error("Expected attrs."); assert.equal(canonical_public_attrs_equal(left, right), true);
});
check("detached root mutation cannot bypass the commit stream", () => {
  const valueMap = hson.liveMap.fromNode(hson.fromJson({ a: { b: 1 } }).toNode());
  if (valueMap.mode !== "data-object") throw new Error(`Expected data-object, observed ${valueMap.mode}.`);
  const beforeRev = valueMap.rev; let commits = 0; let feeds = 0;
  valueMap.commits.observe(() => { commits += 1; }); valueMap.feed([], () => { feeds += 1; });
  const detached = valueMap.root(); detached.$_content.length = 0;
  assert.equal(valueMap.snap(["a", "b"]), 1); assert.equal(valueMap.rev, beforeRev); assert.equal(commits, 0); assert.equal(feeds, 0);
});
check("ordinary public snapshots can re-enter without semantic loss", () => {
  const source = hson.liveMap.fromJson({ a: 1, nested: { b: -0 }, items: [true, null] }); const target = hson.liveMap.fromJson(source.snap() as JsonValue);
  assert.equal(canonical_hson_graph_equal(source.root(), target.root()), true);
});
check("integer-like public snapshots are explicitly lossy ordered transport", () => {
  const source = hson.liveMap.fromJson('{"10":10,"2":2,"1":1}'); const target = hson.liveMap.fromJson(source.snap() as JsonValue);
  assert.deepEqual(keys(projected_value_from_hson_node(source.root())), ["10", "2", "1"]); assert.deepEqual(keys(projected_value_from_hson_node(target.root())), ["1", "2", "10"]);
  assert.equal(canonical_hson_graph_equal(source.root(), target.root()), false); assert.equal(source.capture().payload, source.capture().payload);
});

assert.equal(checks, 25);
process.stdout.write(`# ${checks} exact multi-route closure checks passed\n`);
emit_hson_live_test_completion("livemap.exact-route-closure", checks, checks, 0);
