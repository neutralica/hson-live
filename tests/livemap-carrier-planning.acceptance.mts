import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
// @hson-live-external-test

import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import { make_livemap_core } from "../src/api/livemap/livemap.core.ts";
import { assert_invariants } from "../src/core/assert-invariants.ts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import { normalize_hson_graph } from "../src/core/normalize-hson-graph.ts";
import {
  is_ordered_projected_object,
  ordered_projected_array,
  ordered_projected_object,
  type OrderedProjectedObject,
  type OrderedProjectedValue,
} from "../src/core/ordered-projected-value.ts";
import {
  ordered_projected_array_splice,
  ordered_projected_object_merge,
  ordered_projected_value_at,
  ordered_projected_value_delete,
  ordered_projected_value_replace,
  ordered_projected_value_set,
} from "../src/core/ordered-projected-value-mutation.ts";
import {
  projected_value_from_hson_node,
  projected_value_to_hson_node,
  projected_value_to_hson_root,
} from "../src/core/projected-value-graph.ts";
import type { JsonValue } from "../src/core/types.ts";

let checks = 0;

function check(name: string, fn: () => void): void {
  fn();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

const object = (
  entries: readonly (readonly [string, OrderedProjectedValue])[],
): OrderedProjectedObject => ordered_projected_object(entries);

function make_map(value: OrderedProjectedValue) {
  return make_livemap_core(projected_value_to_hson_root(value));
}

function map_carrier(map: ReturnType<typeof make_livemap_core>): OrderedProjectedValue {
  return projected_value_from_hson_node(map.root());
}

function object_keys(value: OrderedProjectedValue): readonly string[] {
  assert.equal(is_ordered_projected_object(value), true);
  if (!is_ordered_projected_object(value)) throw new Error("Expected ordered object carrier.");
  return value.entries.map(([key]) => key);
}

function own_data(entries: readonly (readonly [string, JsonValue])[]): Record<string, JsonValue> {
  const value: Record<string, JsonValue> = {};
  for (const [key, child] of entries) {
    Object.defineProperty(value, key, {
      value: child,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return value;
}

check("carrier set retains an existing object property position", () => {
  const initial = object([["a", 1], ["b", 2], ["c", 3]]);
  const next = ordered_projected_value_set(initial, ["b"], -0);
  assert.deepEqual(object_keys(next), ["a", "b", "c"]);
  assert.equal(Object.is(ordered_projected_value_at(next, ["b"]), -0), true);
});

check("carrier set appends a missing object property", () => {
  const next = ordered_projected_value_set(object([["a", 1]]), ["b"], 2);
  assert.deepEqual(object_keys(next), ["a", "b"]);
});

check("carrier replace adopts the complete replacement order", () => {
  const replacement = object([["z", 1], ["a", 2], ["m", 3]]);
  const next = ordered_projected_value_replace(object([["old", true]]), [], replacement);
  assert.deepEqual(object_keys(next), ["z", "a", "m"]);
});

check("carrier merge retains existing positions and appends patch order", () => {
  const initial = object([["a", 1], ["b", 2]]);
  const patch = object([["b", 20], ["d", 4], ["c", 3]]);
  const next = ordered_projected_object_merge(initial, [], patch);
  assert.deepEqual(object_keys(next), ["a", "b", "d", "c"]);
});

check("carrier delete and splice remain dense and immutable", () => {
  const initial = object([["drop", 0], ["items", ordered_projected_array([1, 2, 3])]]);
  const deleted = ordered_projected_value_delete(initial, ["drop"]);
  const spliced = ordered_projected_array_splice(deleted, ["items"], 1, 1, [-0, 4]);
  assert.deepEqual(spliced.removed, [2]);
  assert.equal(Object.isFrozen(spliced.value), true);
  assert.equal(Object.isFrozen(ordered_projected_value_at(spliced.value, ["items"])), true);
  assert.equal(Object.is(ordered_projected_value_at(spliced.value, ["items", 1]), -0), true);
});

check("core set retains exact integer-like graph positions", () => {
  const map = make_map(object([["10", "ten"], ["2", "two"], ["1", "one"], ["a", true]]));
  map.set(["2"], "TWO");
  assert.deepEqual(object_keys(map_carrier(map)), ["10", "2", "1", "a"]);
});

check("core set appends a missing integer-like key internally", () => {
  const map = make_map(object([["10", 10], ["2", 2], ["1", 1]]));
  map.setMany([], own_data([["3", 3]]));
  assert.deepEqual(object_keys(map_carrier(map)), ["10", "2", "1", "3"]);
  assert.deepEqual(Object.keys(map.snap() as object), ["1", "2", "3", "10"]);
});

check("constructive object set retains existing positions and appends admitted order", () => {
  const map = make_map(object([["target", object([["a", 1], ["b", 2]])]]));
  map.set(["target"], own_data([["b", 20], ["d", 4], ["c", 3]]));
  const target = ordered_projected_value_at(map_carrier(map), ["target"]);
  assert.notEqual(target, undefined);
  assert.deepEqual(object_keys(target!), ["a", "b", "d", "c"]);
});

check("setMany retains positions and emits new keys in admitted order", () => {
  const map = make_map(object([["first", 1], ["kept", true], ["last", 3]]));
  const commit = map.setMany([], own_data([["last", 30], ["newB", 2], ["newA", 1]]));
  assert.deepEqual(object_keys(map_carrier(map)), ["first", "kept", "last", "newB", "newA"]);
  assert.deepEqual(commit.ops.map((op) => op.path), [["last"], ["newB"], ["newA"]]);
});

check("whole-object replacement adopts the admitted observable order", () => {
  const map = make_map(object([["old", true]]));
  map.replace(own_data([["z", 1], ["a", 2], ["m", 3]]));
  assert.deepEqual(object_keys(map_carrier(map)), ["z", "a", "m"]);
});

check("nested replacement preserves nested object and array order", () => {
  const map = make_map(object([["nested", object([["old", true]])]]));
  map.replace(["nested"], own_data([
    ["z", [own_data([["b", 2], ["a", 1]])]],
    ["a", -0],
  ]));
  const nested = ordered_projected_value_at(map_carrier(map), ["nested"]);
  assert.notEqual(nested, undefined);
  assert.deepEqual(object_keys(nested!), ["z", "a"]);
  const arrayObject = ordered_projected_value_at(nested!, ["z", 0]);
  assert.notEqual(arrayObject, undefined);
  assert.deepEqual(object_keys(arrayObject!), ["b", "a"]);
});

check("path-handle update plans its admitted result through carriers", () => {
  const map = make_map(object([["target", object([["a", 1], ["b", 2]])]]));
  map.at(["target"]).update((current) => ({ ...(current as Record<string, JsonValue>), b: 20, c: 3 }));
  const target = ordered_projected_value_at(map_carrier(map), ["target"]);
  assert.notEqual(target, undefined);
  assert.deepEqual(object_keys(target!), ["a", "b", "c"]);
});

check("dangerous names remain ordinary data through constructive set", () => {
  const map = make_map(object([["target", object([["kept", true]])]]));
  map.set(["target"], own_data([["__proto__", 1], ["constructor", 2], ["prototype", 3]]));
  const target = ordered_projected_value_at(map_carrier(map), ["target"]);
  assert.notEqual(target, undefined);
  assert.deepEqual(object_keys(target!), ["kept", "__proto__", "constructor", "prototype"]);
  const snap = map.snap(["target"]) as Record<string, JsonValue>;
  assert.equal(Object.getPrototypeOf(snap), Object.prototype);
  assert.equal(Object.hasOwn(snap, "__proto__"), true);
});

check("dangerous names remain ordinary data through whole replacement", () => {
  const map = make_map(object([["target", object([])]]));
  map.replace(["target"], own_data([["__proto__", "data"], ["constructor", false], ["prototype", null]]));
  const snap = map.snap(["target"]) as Record<string, JsonValue>;
  assert.equal(snap.__proto__, "data");
  assert.equal(snap.constructor, false);
  assert.equal(snap.prototype, null);
  assert.equal(Object.getPrototypeOf(snap), Object.prototype);
});

check("positive zero to negative zero is a changed set", () => {
  const map = make_map(object([["value", 0]]));
  const commit = map.set(["value"], -0);
  assert.equal(commit.changed, true);
  assert.equal(Object.is(ordered_projected_value_at(map_carrier(map), ["value"]), -0), true);
});

check("negative zero to negative zero is a no-op", () => {
  const map = make_map(object([["value", -0]]));
  const commit = map.set(["value"], -0);
  assert.equal(commit.changed, false);
  assert.equal(commit.ops.length, 0);
  assert.equal(map.rev, 0);
});

check("array item replacement and splice preserve SameValue and density", () => {
  const map = make_map(object([["items", ordered_projected_array([0, 1, 2])]]));
  map.set(["items", 0], -0);
  const commit = map.splice(["items"], 1, 1, own_data([["nested", [3, 4]]]));
  const items = ordered_projected_value_at(map_carrier(map), ["items"]);
  assert.equal(Array.isArray(items), true);
  if (!Array.isArray(items)) throw new Error("Expected carrier array.");
  assert.equal(Object.is(items[0], -0), true);
  assert.equal(commit.ops[0]?.kind, "splice");
});

check("batch planning observes earlier writes without a public snapshot round-trip", () => {
  const map = make_map(object([["10", 10], ["2", 2], ["obj", object([["a", 1]])]]));
  map.batch((tx) => {
    tx.setMany([], own_data([["1", 1], ["3", 3]]));
    tx.set(["obj"], own_data([["a", 10], ["b", 2]]));
    tx.replace(["3"], -0);
  });
  assert.deepEqual(object_keys(map_carrier(map)), ["10", "2", "obj", "1", "3"]);
  assert.equal(Object.is(ordered_projected_value_at(map_carrier(map), ["3"]), -0), true);
});

check("batch commit operations match the carrier-planned graph", () => {
  const map = make_map(object([["a", 1], ["items", ordered_projected_array([1, 2])]]));
  const commit = map.batch((tx) => {
    tx.setMany([], own_data([["b", 2], ["c", 3]]));
    tx.splice(["items"], 1, 1, -0, 4);
  });
  assert.equal(commit.changed, true);
  assert.deepEqual(commit.ops.map((op) => op.kind), ["set", "set", "splice"]);
  assert.deepEqual(object_keys(map_carrier(map)), ["a", "items", "b", "c"]);
});

check("failed admission is atomic for graph revision commit and feed", () => {
  const map = make_map(object([["value", 1]]));
  const before = map.root();
  let feeds = 0;
  map.feed([], () => { feeds += 1; });
  const bad = Object.defineProperty({}, "value", { enumerable: true, get: () => 2 });
  assert.throws(() => map.set(["value"], bad));
  assert.equal(map.rev, 0);
  assert.equal(feeds, 0);
  assert.equal(canonical_hson_graph_equal(map.root(), before), true);
});

check("failed late batch operation leaves authority unchanged", () => {
  const map = make_map(object([["a", 1], ["b", 2]]));
  const before = map.root();
  assert.throws(() => map.batch((tx) => {
    tx.set(["a"], 10);
    tx.replace(["missing"], 3);
  }));
  assert.equal(map.rev, 0);
  assert.equal(canonical_hson_graph_equal(map.root(), before), true);
});

check("schema preview validates only the completed detached carrier candidate", () => {
  const map = make_map(object([["value", 1], ["label", "ok"]]));
  map.schema.use(hson.liveMap.schema.define((shape) => shape.object({ value: shape.number, label: shape.string })));
  const accepted = map.batch((tx) => {
    tx.set(["value"], -0);
    tx.set(["label"], "next");
  });
  assert.equal(accepted.changed, true);
  const before = map.root();
  assert.throws(() => map.set(["value"], "wrong"));
  assert.equal(canonical_hson_graph_equal(map.root(), before), true);
});

check("every planned candidate closes as a strict canonical graph", () => {
  const map = make_map(object([["10", 10], ["2", 2], ["nested", object([["a", 1]])]]));
  map.batch((tx) => {
    tx.setMany([], own_data([["1", 1], ["__proto__", "data"]]));
    tx.replace(["nested"], own_data([["z", [1, -0]], ["a", false]]));
  });
  const root = map.root();
  assert_invariants(root, "LiveMap carrier planning closure");
  assert.equal(canonical_hson_graph_equal(root, normalize_hson_graph(root, "LiveMap carrier planning closure")), true);
  const direct = make_livemap_core(projected_value_to_hson_node(object([["a", 1]])));
  direct.set(["a"], 2);
  assert.equal(direct.root().$_tag, "_hson_obj");
});

check("caller mutation after admission cannot change the graph or commit", () => {
  const input = own_data([["nested", own_data([["value", 1]])], ["items", [1, 2]]]);
  const map = make_map(object([["target", object([])]]));
  const commit = map.replace(["target"], input);
  (input.nested as Record<string, JsonValue>).value = 99;
  (input.items as JsonValue[]).push(3);
  assert.equal(ordered_projected_value_at(map_carrier(map), ["target", "nested", "value"]), 1);
  assert.deepEqual((commit.ops[0]?.next as Record<string, JsonValue>).items, [1, 2]);
});

check("commit payload mutation cannot affect canonical state or later reads", () => {
  const map = make_map(object([["target", object([])]]));
  const commit = map.replace(["target"], own_data([["nested", own_data([["value", 1]])]]));
  const next = commit.ops[0]?.next as Record<string, JsonValue>;
  (next.nested as Record<string, JsonValue>).value = 42;
  assert.equal(ordered_projected_value_at(map_carrier(map), ["target", "nested", "value"]), 1);
  assert.equal((map.snap(["target", "nested"]) as Record<string, JsonValue>).value, 1);
});

process.stdout.write(`# ${checks} LiveMap carrier mutation-planning checks passed\n`);
emit_hson_live_test_completion("livemap.carrier-mutation-planning", checks, checks, 0);
