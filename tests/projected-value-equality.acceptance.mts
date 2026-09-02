import { create_test_event_emitter } from "./test-events.mjs";
// @hson-live-external-test

import assert from "node:assert/strict";
import { admit_projected_value } from "../src/core/projected-value-admission.ts";
import {
  ordered_projected_array,
  ordered_projected_object,
  optional_ordered_projected_value_equal,
  ordered_projected_value_equal,
  type OrderedProjectedValue,
} from "../src/core/ordered-projected-value.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "core.projected-value-equality",
  title: "Ordered projected-value equality",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["projected-value", "equality", "same-value", "externally-discoverable"]),
});

const testEvents = create_test_event_emitter("core.projected-value-equality");
let checks = 0;

function check(name: string, fn: () => void): void {

  testEvents.case_begin(name, name);
  try {
    fn();
    testEvents.case_end(name, "pass");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Check failed.";
    testEvents.diagnostic(name, "assertion", message.slice(0, 1_000));
    testEvents.case_end(name, "fail");
    testEvents.terminal("fail");
    throw error;
  }
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function equal(left: OrderedProjectedValue, right: OrderedProjectedValue): boolean {
  return ordered_projected_value_equal(left, right);
}

const object = (entries: readonly (readonly [string, OrderedProjectedValue])[]) => (
  ordered_projected_object(entries)
);

check("equal primitive carriers use SameValue", () => {
  for (const value of [null, true, false, "", "text", 0, -0, 42.5] as const) {
    assert.equal(equal(value, value), true);
  }
});

check("unlike primitive types compare unequal", () => {
  assert.equal(equal("1", 1), false);
  assert.equal(equal(false, 0), false);
  assert.equal(equal(null, ""), false);
});

check("positive and negative zero compare unequal", () => {
  assert.equal(equal(0, -0), false);
  assert.equal(equal(-0, 0), false);
});

check("negative zero compares equal to negative zero", () => {
  assert.equal(equal(-0, -0), true);
});

check("strings compare by exact JavaScript code units", () => {
  assert.equal(equal("\ud800", "\ud800"), true);
  assert.equal(equal("\ud800", "\ud801"), false);
  assert.equal(equal("é", "e\u0301"), false);
});

check("identical arrays compare equal positionally", () => {
  assert.equal(equal(ordered_projected_array([1, "a", null]), ordered_projected_array([1, "a", null])), true);
});

check("array length is semantic", () => {
  assert.equal(equal(ordered_projected_array([1]), ordered_projected_array([1, 2])), false);
});

check("different array items compare unequal", () => {
  assert.equal(equal(ordered_projected_array([1, 2]), ordered_projected_array([1, 3])), false);
});

check("reordered array items compare unequal", () => {
  assert.equal(equal(ordered_projected_array([1, 2]), ordered_projected_array([2, 1])), false);
});

check("array items distinguish positive and negative zero", () => {
  assert.equal(equal(ordered_projected_array([0]), ordered_projected_array([-0])), false);
});

check("array nested objects retain ordered identity", () => {
  const left = ordered_projected_array([object([["a", 1], ["b", 2]])]);
  const right = ordered_projected_array([object([["b", 2], ["a", 1]])]);
  assert.equal(equal(left, right), false);
});

check("identical ordered object entries compare equal", () => {
  assert.equal(equal(object([["a", 1], ["b", 2]]), object([["a", 1], ["b", 2]])), true);
});

check("reordered object entries compare unequal", () => {
  assert.equal(equal(object([["a", 1], ["b", 2]]), object([["b", 2], ["a", 1]])), false);
});

check("integer-like key order is compared from carrier entries", () => {
  const left = object([["10", "ten"], ["2", "two"], ["1", "one"]]);
  const right = object([["1", "one"], ["2", "two"], ["10", "ten"]]);
  assert.equal(equal(left, right), false);
});

check("nested ordered objects compare recursively", () => {
  const left = object([["outer", object([["a", 1], ["b", 2]])]]);
  const right = object([["outer", object([["a", 1], ["b", 2]])]]);
  assert.equal(equal(left, right), true);
});

check("dangerous names are ordinary ordered entries", () => {
  const entries = [["__proto__", 1], ["constructor", 2], ["prototype", 3]] as const;
  assert.equal(equal(object(entries), object(entries)), true);
});

check("dangerous-name values remain semantic", () => {
  assert.equal(equal(object([["__proto__", 1]]), object([["__proto__", 2]])), false);
});

check("different object values compare unequal", () => {
  assert.equal(equal(object([["a", 1]]), object([["a", 2]])), false);
});

check("different object keys compare unequal", () => {
  assert.equal(equal(object([["a", 1]]), object([["b", 1]])), false);
});

check("different object entry counts compare unequal", () => {
  assert.equal(equal(object([["a", 1]]), object([["a", 1], ["b", 2]])), false);
});

check("empty carriers remain distinct across domains", () => {
  const emptyObject = object([]);
  const emptyArray = ordered_projected_array([]);
  assert.equal(equal(emptyObject, emptyArray), false);
  assert.equal(equal(emptyObject, ""), false);
  assert.equal(equal(emptyArray, null), false);
});

check("absent data values differ from every present value", () => {
  assert.equal(optional_ordered_projected_value_equal(undefined, undefined), true);
  for (const present of [null, "", 0, -0, [], {}] as const) {
    assert.equal(optional_ordered_projected_value_equal(
      undefined,
      admit_projected_value(present),
    ), false);
  }
});

check("repeated acyclic source identity is not semantic", () => {
  const shared = { value: 1 };
  const repeated = admit_projected_value({ left: shared, right: shared });
  const separate = admit_projected_value({ left: { value: 1 }, right: { value: 1 } });
  assert.equal(equal(repeated, separate), true);
});

check("comparison is deterministic and does not mutate carriers", () => {
  const left = object([["a", ordered_projected_array([1, -0])]]);
  const right = object([["a", ordered_projected_array([1, -0])]]);
  const leftEntries = left.entries;
  assert.equal(equal(left, right), true);
  assert.equal(equal(left, right), true);
  assert.equal(left.entries, leftEntries);
  assert.equal(Object.isFrozen(left), true);
});

process.stdout.write(`# ${checks} ordered projected-value equality checks passed\n`);
testEvents.terminal("pass");
