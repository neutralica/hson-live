import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
// @hson-live-external-test

import assert from "node:assert/strict";
import { make_livemap_core } from "../src/api/livemap/livemap.core.ts";
import { assert_invariants } from "../src/core/assert-invariants.ts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import {
  is_ordered_projected_object,
  ordered_projected_array,
  ordered_projected_object,
  type OrderedProjectedObject,
  type OrderedProjectedValue,
} from "../src/core/ordered-projected-value.ts";
import {
  projected_value_from_hson_node,
  projected_value_to_hson_root,
} from "../src/core/projected-value-graph.ts";
import {
  decode_projected_value_payload,
  encode_livemap_replay_transport,
  encode_projected_value_transport,
  type LiveMapProjectedDataOp,
} from "../src/api/livemap/livemap.transport.ts";
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

function carrier(map: ReturnType<typeof make_livemap_core>): OrderedProjectedValue {
  return projected_value_from_hson_node(map.root());
}

function keys(value: OrderedProjectedValue): readonly string[] {
  if (!is_ordered_projected_object(value)) throw new Error("Expected object carrier.");
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

const orderedRoot = object([
  ["10", "ten"],
  ["2", "two"],
  ["1", "one"],
  ["a", object([["z", -0], ["b", true]])],
]);

check("capture emits the exact versioned envelope and compatibility value", () => {
  const capture = make_map(orderedRoot).capture();
  assert.equal(capture.format, "structural-json");
  assert.equal(capture.formatVersion, 1);
  assert.equal(typeof capture.payload, "string");
  assert.equal(typeof capture.value, "object");
});

check("repeated captures are byte-identical", () => {
  const map = make_map(orderedRoot);
  assert.equal(map.capture().payload, map.capture().payload);
});

check("mutating the compatibility view cannot change the exact payload", () => {
  const map = make_map(orderedRoot);
  const capture = map.capture();
  (capture.value as Record<string, JsonValue>).a = null;
  assert.equal(map.capture().payload, capture.payload);
});

check("capture retains direct integer-like order in structural text", () => {
  const decoded = decode_projected_value_payload(make_map(orderedRoot).capture().payload);
  assert.deepEqual(keys(decoded), ["10", "2", "1", "a"]);
});

check("capture retains mixed property-key classes", () => {
  const mixed = object([["a", 1], ["10", 10], ["2", 2], ["01", 1], ["4294967294", 4], ["4294967295", 5], ["-1", -1], ["b", 2]]);
  assert.deepEqual(keys(decode_projected_value_payload(make_map(mixed).capture().payload)), keys(mixed));
});

check("capture retains nested ordered objects", () => {
  const decoded = decode_projected_value_payload(make_map(orderedRoot).capture().payload);
  const nested = is_ordered_projected_object(decoded)
    ? decoded.entries.find(([key]) => key === "a")?.[1]
    : undefined;
  assert.notEqual(nested, undefined);
  assert.deepEqual(keys(nested!), ["z", "b"]);
});

check("capture retains an ordered object inside an array", () => {
  const root = object([["items", ordered_projected_array([object([["10", 10], ["2", 2], ["1", 1]])])]]);
  const decoded = decode_projected_value_payload(make_map(root).capture().payload);
  const item = is_ordered_projected_object(decoded) ? decoded.entries[0]?.[1] : undefined;
  assert.equal(Array.isArray(item), true);
  if (!Array.isArray(item)) throw new Error("Expected array carrier.");
  assert.deepEqual(keys(item[0]!), ["10", "2", "1"]);
});

check("capture retains an array inside an ordered object", () => {
  const root = object([["z", ordered_projected_array([1, -0, object([["b", 2], ["a", 1]])])], ["a", true]]);
  const decoded = decode_projected_value_payload(make_map(root).capture().payload);
  assert.deepEqual(keys(decoded), ["z", "a"]);
});

check("capture retains dangerous keys as ordinary ordered data", () => {
  const root = object([["__proto__", 1], ["constructor", 2], ["prototype", 3]]);
  assert.deepEqual(keys(decode_projected_value_payload(make_map(root).capture().payload)), ["__proto__", "constructor", "prototype"]);
});

check("capture preserves exact string code units", () => {
  const decoded = decode_projected_value_payload(make_map(object([["text", "\ud800x\udfff"]])).capture().payload);
  assert.equal(is_ordered_projected_object(decoded) ? decoded.entries[0]?.[1] : undefined, "\ud800x\udfff");
});

check("the neutral exact transport preserves root negative zero", () => {
  const decoded = decode_projected_value_payload(encode_projected_value_transport(-0).payload);
  assert.equal(Object.is(decoded, -0), true);
});

check("capture preserves nested negative zero", () => {
  const decoded = decode_projected_value_payload(make_map(object([["value", -0]])).capture().payload);
  const value = is_ordered_projected_object(decoded) ? decoded.entries[0]?.[1] : undefined;
  assert.equal(Object.is(value, -0), true);
});

check("exact capture restore closes to the original strict graph", () => {
  const source = make_map(orderedRoot);
  const baseline = source.root();
  const target = make_map(object([["old", true]]));
  target.restore(source.capture());
  assert_invariants(target.root(), "exact capture restore");
  assert.equal(canonical_hson_graph_equal(target.root(), baseline), true);
});

check("restore accepts the minimal exact envelope without a JavaScript value", () => {
  const source = make_map(orderedRoot);
  const capture = source.capture();
  const target = make_map(object([["old", true]]));
  target.restore({ rev: capture.rev, format: capture.format, formatVersion: capture.formatVersion, payload: capture.payload });
  assert.deepEqual(keys(carrier(target)), ["10", "2", "1", "a"]);
});

check("exact restore ignores a divergent compatibility value", () => {
  const source = make_map(orderedRoot);
  const capture = source.capture();
  const target = make_map(object([["old", true]]));
  target.restore({ ...capture, value: { degraded: true } });
  assert.deepEqual(keys(carrier(target)), ["10", "2", "1", "a"]);
});

check("exact apply reconstructs complete canonical order", () => {
  const source = make_map(orderedRoot);
  const capture = source.capture();
  const target = make_map(object([["old", true]]));
  target.apply({ prevRev: 0, format: capture.format, formatVersion: capture.formatVersion, payload: capture.payload });
  assert.equal(canonical_hson_graph_equal(target.root(), source.root()), true);
});

check("exact apply preserves nested negative zero", () => {
  const capture = make_map(object([["value", -0]])).capture();
  const target = make_map(object([["value", 0]]));
  target.apply({ prevRev: 0, format: capture.format, formatVersion: capture.formatVersion, payload: capture.payload });
  assert.equal(Object.is(target.snap(["value"]), -0), true);
});

check("data commits emit exact replay payloads alongside legacy operations", () => {
  const map = make_map(object([["value", 0]]));
  const commit = map.set(["value"], -0);
  assert.equal(commit.format, "structural-json");
  assert.equal(commit.formatVersion, 1);
  assert.equal(typeof commit.payload, "string");
  assert.equal(commit.ops.length, 1);
});

check("passing a data commit directly to replay preserves ordered objects inside arrays", () => {
  const initial = object([["items", ordered_projected_array([object([["10", 10], ["2", 2], ["1", 1]])])]]);
  const source = make_map(initial);
  const target = make_map(initial);
  const commit = source.splice(["items"], 1, 0, 4);
  target.replay(commit);
  const root = carrier(target);
  const items = is_ordered_projected_object(root) ? root.entries[0]?.[1] : undefined;
  assert.equal(Array.isArray(items), true);
  if (!Array.isArray(items)) throw new Error("Expected array carrier.");
  assert.deepEqual(keys(items[0]!), ["10", "2", "1"]);
});

check("exact replay retains nested order dangerous keys and negative zero", () => {
  const initial = object([["target", object([["old", true]])]]);
  const source = make_map(initial);
  const target = make_map(initial);
  const replacement = own_data([["__proto__", own_data([["10", -0], ["2", 2]])], ["constructor", 3]]);
  target.replay(source.replace(["target"], replacement));
  const root = carrier(target);
  const nested = is_ordered_projected_object(root) ? root.entries[0]?.[1] : undefined;
  assert.deepEqual(keys(nested!), ["__proto__", "constructor"]);
});

check("exact replay remains closed under tail operations", () => {
  const initial = object([["target", object([["a", 1]])]]);
  const target = make_map(initial);
  const exactOp: LiveMapProjectedDataOp = Object.freeze({
    kind: "replace",
    path: Object.freeze(["target"]),
    prev: object([["a", 1]]),
    next: object([["10", 10], ["2", 2], ["1", 1]]),
  });
  target.replay({ prevRev: 0, ...encode_livemap_replay_transport([exactOp]) });
  target.setMany(["target"], own_data([["3", -0], ["tail", true]]));
  const root = carrier(target);
  const nested = is_ordered_projected_object(root) ? root.entries[0]?.[1] : undefined;
  assert.deepEqual(keys(nested!), ["10", "2", "1", "3", "tail"]);
});

check("same-order exact replay succeeds", () => {
  const initial = object([["target", object([["a", 1], ["b", 2]])]]);
  const source = make_map(initial);
  const target = make_map(initial);
  const commit = source.replace(["target"], own_data([["a", 10], ["b", 20]]));
  assert.equal(target.replay(commit).changed, true);
});

check("exact replay conflicts when declared previous order differs", () => {
  const source = make_map(object([["target", object([["a", 1], ["b", 2]])]]));
  const target = make_map(object([["target", object([["b", 2], ["a", 1]])]]));
  const commit = source.replace(["target"], own_data([["a", 10], ["b", 20]]));
  assert.throws(() => target.replay(commit), (error: unknown) => {
    const replayError = error as { code?: unknown; expectedPayload?: unknown; actualPayload?: unknown };
    return replayError.code === "REPLAY_CONFLICT"
      && typeof replayError.expectedPayload === "string"
      && replayError.expectedPayload !== replayError.actualPayload;
  });
});

check("exact replay conflicts when declared previous zero differs by sign", () => {
  const source = make_map(object([["value", 0]]));
  const target = make_map(object([["value", -0]]));
  const commit = source.set(["value"], 1);
  assert.throws(() => target.replay(commit), (error: unknown) => {
    const replayError = error as { code?: unknown; expectedPayload?: unknown; actualPayload?: unknown };
    return replayError.code === "REPLAY_CONFLICT"
      && replayError.expectedPayload === "0"
      && replayError.actualPayload === "-0";
  });
});

check("exact replay snapshots input before later caller mutation", () => {
  const initial = object([["value", 0]]);
  const source = make_map(initial);
  const target = make_map(initial);
  const commit = source.set(["value"], -0);
  const input = { prevRev: commit.prevRev, format: commit.format!, formatVersion: commit.formatVersion!, payload: commit.payload! };
  target.replay(input);
  input.payload = "[]";
  assert.equal(Object.is(target.snap(["value"]), -0), true);
});

assert.equal(checks, 25);
process.stdout.write(`# ${checks} exact LiveMap capture/replay transport checks passed\n`);
emit_hson_live_test_completion("livemap.exact-transport", checks, checks, 0);
