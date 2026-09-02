import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import { create_test_event_emitter } from "./test-events.mjs";
// @hson-live-external-test

import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import {
  admit_projected_value,
  ProjectedValueAdmissionError,
  type ProjectedValueAdmissionCode,
} from "../src/core/projected-value-admission.ts";
import { materialize_projected_value } from "../src/core/projected-value-materialization.ts";
import {
  is_ordered_projected_object,
  ordered_projected_array,
  ordered_projected_object,
  type OrderedProjectedValue,
} from "../src/core/ordered-projected-value.ts";
import type { JsonValue } from "../src/core/types.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "core.projected-value-admission",
  title: "Projected-value admission and materialization",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["projected-value", "admission", "materialization", "externally-discoverable"]),
});

const testEvents = create_test_event_emitter("core.projected-value-admission");
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

function admission_error(
  value: unknown,
  code: ProjectedValueAdmissionCode,
): ProjectedValueAdmissionError {
  let observed: ProjectedValueAdmissionError | undefined;
  assert.throws(
    () => admit_projected_value(value),
    (error) => {
      if (!(error instanceof ProjectedValueAdmissionError)) return false;
      observed = error;
      return error.code === code;
    },
  );
  assert.ok(observed);
  return observed;
}

function own_data_record(
  entries: readonly (readonly [string, unknown])[],
  prototype: object | null = Object.prototype,
): Record<string, unknown> {
  const record = Object.create(prototype) as Record<string, unknown>;
  for (const [key, value] of entries) {
    Object.defineProperty(record, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return record;
}

function carrier_object(value: OrderedProjectedValue) {
  assert.equal(is_ordered_projected_object(value), true);
  if (!is_ordered_projected_object(value)) throw new Error("Expected ordered data object.");
  return value;
}

function livemap_reason(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof Error);
    return String((error as Error & { reasonCode?: string }).reasonCode);
  }
  throw new Error("Expected LiveMap data admission to reject.");
}

check("primitive admission preserves strings, isolated surrogates, booleans, null, zero and negative zero", () => {
  for (const value of ["", "\ud800", true, false, null, 0, -0, 42.5] as const) {
    const admitted = admit_projected_value(value);
    assert.equal(Object.is(admitted, value), true);
  }
});

check("ordinary object admission captures enumerable data descriptors in observable own-key order", () => {
  const input = own_data_record([["b", 2], ["a", 1]]);
  const admitted = carrier_object(admit_projected_value(input));
  assert.deepEqual(admitted.entries.map(([key]) => key), ["b", "a"]);
  assert.equal(Object.isFrozen(admitted), true);
  assert.equal(Object.isFrozen(admitted.entries), true);
});

check("null-prototype objects admit and materialize as compatible ordinary objects", () => {
  const input = own_data_record([["value", 1]], null);
  const materialized = materialize_projected_value(admit_projected_value(input));
  assert.equal(Object.getPrototypeOf(materialized), Object.prototype);
  assert.deepEqual(materialized, { value: 1 });
});

check("frozen objects and sealed arrays admit by detached value", () => {
  const object = Object.freeze({ nested: Object.freeze({ value: 1 }) });
  const array = Object.seal([1, 2]);
  assert.deepEqual(materialize_projected_value(admit_projected_value(object)), { nested: { value: 1 } });
  assert.deepEqual(materialize_projected_value(admit_projected_value(array)), [1, 2]);
});

check("dense empty and populated ordinary arrays admit with exact indexes", () => {
  for (const value of [[], ["a", -0, null]] as const) {
    const result = materialize_projected_value(admit_projected_value(value));
    assert.ok(Array.isArray(result));
    assert.equal(result.length, value.length);
    for (let index = 0; index < result.length; index += 1) assert.equal(Object.hasOwn(result, index), true);
  }
});

check("repeated acyclic source references are copied structurally without identity", () => {
  const shared = { value: 1 };
  const input = { left: shared, right: shared };
  const admitted = carrier_object(admit_projected_value(input));
  assert.notEqual(admitted.entries[0]?.[1], admitted.entries[1]?.[1]);
  const output = materialize_projected_value(admitted) as Record<string, JsonValue>;
  assert.notEqual(output.left, output.right);
  shared.value = 2;
  assert.deepEqual(output, { left: { value: 1 }, right: { value: 1 } });
});

check("repeated admission is deterministic and never mutates caller descriptors", () => {
  const input = own_data_record([["first", [1, 2]], ["second", { ok: true }]]);
  const before = Object.getOwnPropertyDescriptors(input);
  const first = materialize_projected_value(admit_projected_value(input));
  const second = materialize_projected_value(admit_projected_value(input));
  assert.deepEqual(first, second);
  assert.deepEqual(Object.getOwnPropertyDescriptors(input), before);
});

check("dangerous names admit as exact ordinary carrier entries", () => {
  const input = own_data_record([["__proto__", "p"], ["constructor", "c"], ["prototype", "t"]]);
  const admitted = carrier_object(admit_projected_value(input));
  assert.deepEqual(admitted.entries.map(([key, value]) => [key, value]), [
    ["__proto__", "p"], ["constructor", "c"], ["prototype", "t"],
  ]);
});

check("undefined rejects with a path-specific structured code", () => {
  const error = admission_error({ nested: undefined }, "UNDEFINED_VALUE");
  assert.deepEqual(error.path, ["nested"]);
});

check("NaN and both infinities reject through the finite-number boundary", () => {
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    admission_error(value, "NONFINITE_NUMBER");
  }
});

check("bigint, symbols and functions reject without coercion", () => {
  for (const value of [1n, Symbol("value"), () => 1]) admission_error(value, "UNSUPPORTED_TYPE");
});

check("boxed primitive objects reject by unsupported prototype", () => {
  for (const value of [new String("x"), new Number(1), new Boolean(true)]) {
    admission_error(value, "UNSUPPORTED_PROTOTYPE");
  }
});

check("custom prototypes, class instances and exotic built-ins reject", () => {
  class Example { value = 1; }
  for (const value of [
    Object.create({ inherited: true }), new Example(), new Date(), new Map(), new Set(),
    Promise.resolve(1), /x/,
  ]) admission_error(value, "UNSUPPORTED_PROTOTYPE");
});

check("ordinary getters reject from descriptors without executing user code", () => {
  let calls = 0;
  const input = {};
  Object.defineProperty(input, "value", {
    get() { calls += 1; return 1; },
    enumerable: true,
  });
  admission_error(input, "ACCESSOR_PROPERTY");
  assert.equal(calls, 0);
});

check("ordinary setters reject from descriptors without executing user code", () => {
  let calls = 0;
  const input = {};
  Object.defineProperty(input, "value", {
    set(_value) { calls += 1; },
    enumerable: true,
  });
  admission_error(input, "ACCESSOR_PROPERTY");
  assert.equal(calls, 0);
});

check("nonenumerable own string properties reject", () => {
  const input = { visible: 1 };
  Object.defineProperty(input, "hidden", { value: 2, enumerable: false });
  const error = admission_error(input, "NONENUMERABLE_PROPERTY");
  assert.deepEqual(error.path, ["hidden"]);
});

check("symbol-keyed object and array properties reject", () => {
  const symbol = Symbol("extra");
  const object = { value: 1, [symbol]: 2 };
  const array = [1] as unknown[] & { [key: symbol]: number };
  array[symbol] = 2;
  admission_error(object, "SYMBOL_KEY");
  admission_error(array, "SYMBOL_KEY");
});

check("sparse arrays and explicit undefined entries reject distinctly", () => {
  admission_error(new Array(4), "SPARSE_ARRAY");
  const error = admission_error([undefined], "UNDEFINED_VALUE");
  assert.deepEqual(error.path, [0]);
});

check("extra named and numeric-looking array properties reject without scanning missing positions", () => {
  for (const key of ["named", "-1", "4294967295"] as const) {
    const input = [1] as unknown[] & Record<string, unknown>;
    Object.defineProperty(input, key, { value: 2, enumerable: true, configurable: true });
    admission_error(input, "EXTRA_ARRAY_PROPERTY");
  }
  const huge: unknown[] = [];
  huge.length = 4_294_967_294;
  admission_error(huge, "SPARSE_ARRAY");
});

check("array accessor indexes and subclassed arrays reject", () => {
  let calls = 0;
  const accessor = [1];
  Object.defineProperty(accessor, "0", { get() { calls += 1; return 1; }, enumerable: true });
  admission_error(accessor, "ACCESSOR_PROPERTY");
  assert.equal(calls, 0);
  class Values extends Array<number> {}
  admission_error(new Values(1, 2), "UNSUPPORTED_PROTOTYPE");
});

check("cycles reject with both current and originating structured paths", () => {
  const root: Record<string, unknown> = { branch: {} };
  (root.branch as Record<string, unknown>).back = root;
  const error = admission_error(root, "CYCLE");
  assert.deepEqual(error.path, ["branch", "back"]);
  assert.deepEqual(error.originPath, []);
});

check("materialization defines dangerous own data without changing Object.prototype", () => {
  const output = materialize_projected_value(ordered_projected_object([
    ["__proto__", "p"], ["constructor", "c"], ["prototype", "t"],
  ])) as Record<string, JsonValue>;
  assert.equal(Object.getPrototypeOf(output), Object.prototype);
  for (const key of ["__proto__", "constructor", "prototype"] as const) {
    assert.equal(Object.hasOwn(output, key), true);
    assert.deepEqual(Object.getOwnPropertyDescriptor(output, key), {
      value: key === "__proto__" ? "p" : key === "constructor" ? "c" : "t",
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
});

check("materialization returns fresh dense arrays, nested objects and repeated carrier occurrences", () => {
  const shared = ordered_projected_object([["value", 1]]);
  const carrier = ordered_projected_array([shared, shared]);
  const first = materialize_projected_value(carrier) as JsonValue[];
  const second = materialize_projected_value(carrier) as JsonValue[];
  assert.notEqual(first, second);
  assert.notEqual(first[0], first[1]);
  assert.notEqual(first[0], second[0]);
  assert.equal(Object.hasOwn(first, 0), true);
  assert.equal(Object.hasOwn(first, 1), true);
});

check("public LiveMap snapshots are prototype-safe, detached and truthful about integer-key enumeration", () => {
  const map = hson.liveMap.fromJson('{"10":"ten","2":"two","1":"one","__proto__":{"nested":1}}');
  const first = map.snap() as Record<string, JsonValue>;
  assert.equal(Object.getPrototypeOf(first), Object.prototype);
  assert.equal(Object.hasOwn(first, "__proto__"), true);
  assert.deepEqual(Object.keys(first), ["1", "2", "10", "__proto__"]);
  (first.__proto__ as Record<string, JsonValue>).nested = 2;
  const second = map.snap() as Record<string, JsonValue>;
  assert.notEqual(first, second);
  assert.deepEqual(second.__proto__, { nested: 1 });
  const rootObject = map.root().$_content[0];
  assert.equal(typeof rootObject, "object");
  assert.deepEqual((rootObject as { $_content: Array<{ $_tag: string }> }).$_content.map((item) => item.$_tag), [
    "10", "2", "1", "__proto__",
  ]);
});

check("accessor TOCTOU and throwing proxy admission failures are atomic", () => {
  const map = hson.liveMap.fromJson({ value: 0 });
  let getterCalls = 0;
  let feedCalls = 0;
  map.feed([], () => { feedCalls += 1; });
  const candidate = {};
  Object.defineProperty(candidate, "unstable", {
    get() { getterCalls += 1; return getterCalls === 1 ? 1 : () => 2; },
    enumerable: true,
  });
  assert.equal(
    livemap_reason(() => map.replace(["value"], candidate as unknown as JsonValue)),
    "ACCESSOR_PROPERTY",
  );
  assert.equal(getterCalls, 0);
  assert.equal(map.rev, 0);
  assert.equal(feedCalls, 0);
  assert.deepEqual(map.snap(), { value: 0 });

  const proxy = new Proxy({}, {
    getPrototypeOf() { throw new Error("proxy trap"); },
  });
  assert.equal(
    livemap_reason(() => map.replace(["value"], proxy as JsonValue)),
    "REFLECTION_FAILED",
  );
  assert.equal(map.rev, 0);
  assert.equal(feedCalls, 0);
  assert.deepEqual(map.snap(), { value: 0 });
});

process.stdout.write(`# ${checks} projected-value admission and materialization checks passed\n`);
testEvents.terminal("pass");
emit_hson_live_test_completion("core.projected-value-admission", checks, checks, 0);
