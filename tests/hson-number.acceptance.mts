// @hson-live-external-test
import assert from "node:assert/strict";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import {
  HSON_CALC_FUNCTION_REQUIRED,
  HSON_NUMBER_NONFINITE,
  HSON_NUMBER_TYPE_REQUIRED,
  hson,
  hsonCalc,
  hsonNumber,
} from "../src/index.ts";
import {
  hsonCalc as narrowHsonCalc,
  hsonNumber as narrowHsonNumber,
} from "../src/number.ts";

let checks = 0;
function check(name: string, fn: () => void): void {
  fn();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function error_details(fn: () => unknown): { operation: unknown; code: unknown } {
  try {
    fn();
  } catch (error) {
    if (typeof error !== "object" || error === null) {
      assert.fail("expected an object-shaped structured HSON error");
    }
    return {
      operation: Reflect.get(error, "operation"),
      code: Reflect.get(error, "code"),
    };
  }
  assert.fail("expected a structured HSON admission error");
}

function first_number(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = first_number(item);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  return first_number(Reflect.get(value, "$_content"));
}

const accepted = [
  0,
  -0,
  42,
  -42,
  1.25,
  1e100,
  Number.MAX_VALUE,
  Number.MIN_VALUE,
  2 ** -1073,
] as const;

const wrongTypes: readonly unknown[] = [
  "1",
  new Number(1),
  1n,
  true,
  false,
  null,
  undefined,
  {},
  [],
  () => 1,
  Symbol("one"),
];

check("namespace methods are the named leaf functions", () => {
  assert.equal(hson.transform.number, hsonNumber);
  assert.equal(hson.transform.calc, hsonCalc);
  assert.equal(narrowHsonNumber, hsonNumber);
  assert.equal(narrowHsonCalc, hsonCalc);
  assert.equal("string" in hson, false);
  assert.equal("number" in hson, false);
  assert.equal("calc" in hson, false);
});

check("hsonNumber accepts every representative finite numeric class", () => {
  for (const value of accepted) assert.equal(hsonNumber(value), value);
});

check("hson.transform.number accepts every representative finite numeric class", () => {
  for (const value of accepted) assert.equal(hson.transform.number(value), value);
});

check("both number surfaces preserve negative zero exactly", () => {
  assert.equal(Object.is(hsonNumber(-0), -0), true);
  assert.equal(Object.is(hson.transform.number(-0), -0), true);
});

check("hsonNumber rejects nonfinite numbers with one stable identity", () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.deepEqual(error_details(() => hsonNumber(value)), {
      operation: "hson.transform.number",
      code: HSON_NUMBER_NONFINITE,
    });
  }
});

check("hsonNumber rejects every non-number runtime class without coercion", () => {
  for (const value of wrongTypes) {
    assert.deepEqual(error_details(() => hsonNumber(value)), {
      operation: "hson.transform.number",
      code: HSON_NUMBER_TYPE_REQUIRED,
    });
  }
});

check("namespace number rejection matches named-export operation and codes", () => {
  for (const value of [NaN, Infinity, -Infinity, ...wrongTypes]) {
    assert.deepEqual(
      error_details(() => hson.transform.number(value)),
      error_details(() => hsonNumber(value)),
    );
  }
});

check("repeated and cross-surface admission is stable", () => {
  const first = hson.transform.number(42);
  assert.equal(hsonNumber(first), first);
  assert.equal(hson.transform.number(hsonNumber(first)), first);
});

check("hsonCalc executes an expression callback exactly once with zero arguments", () => {
  let calls = 0;
  const result = hsonCalc((...args: unknown[]) => {
    calls += 1;
    assert.deepEqual(args, []);
    return 6 * 7;
  });
  assert.equal(result, 42);
  assert.equal(calls, 1);
});

check("hson.transform.calc accepts a block callback and executes it exactly once", () => {
  let calls = 0;
  assert.equal(hson.transform.calc(() => {
    calls += 1;
    return 21 / 2;
  }), 10.5);
  assert.equal(calls, 1);
});

check("both calc surfaces preserve a returned negative zero", () => {
  assert.equal(Object.is(hsonCalc(() => -0), -0), true);
  assert.equal(Object.is(hson.transform.calc(() => -0), -0), true);
});

check("both calc surfaces accept an already admitted HsonNumber", () => {
  const admitted = hsonNumber(Number.MIN_VALUE);
  assert.equal(hsonCalc(() => admitted), admitted);
  assert.equal(hson.transform.calc(() => admitted), admitted);
});

check("calc result-domain failures use hsonNumber operation and codes", () => {
  const candidates: readonly unknown[] = [NaN, Infinity, -Infinity, "1", undefined, Promise.resolve(1)];
  for (const candidate of candidates) {
    const direct = error_details(() => hsonNumber(candidate));
    assert.deepEqual(error_details(() => hsonCalc(() => candidate)), direct);
    assert.deepEqual(error_details(() => hson.transform.calc(() => candidate)), direct);
  }
});

check("non-callable calc inputs use the dedicated structured identity", () => {
  for (const candidate of [42, null, {}, Promise.resolve(1)]) {
    const named = error_details(() => Reflect.apply(hsonCalc, undefined, [candidate]));
    const namespace = error_details(() => Reflect.apply(hson.transform.calc, undefined, [candidate]));
    assert.deepEqual(named, { operation: "hson.transform.calc", code: HSON_CALC_FUNCTION_REQUIRED });
    assert.deepEqual(namespace, named);
  }
});

check("a callback-thrown Error propagates with exact identity", () => {
  const original = new Error("calculation failed");
  assert.throws(() => hsonCalc(() => { throw original; }), (caught) => caught === original);
  assert.throws(() => hson.transform.calc(() => { throw original; }), (caught) => caught === original);
});

check("a callback-thrown non-Error value propagates unchanged", () => {
  const original = Object.freeze({ failure: "calculation failed" });
  for (const calculate of [hsonCalc, hson.transform.calc]) {
    try {
      calculate(() => { throw original; });
      assert.fail("expected callback failure");
    } catch (caught) {
      assert.equal(caught, original);
    }
  }
});

check("Promise results are rejected synchronously and are not awaited", () => {
  const promise = Promise.resolve(42);
  assert.deepEqual(error_details(() => hsonCalc(() => promise)), {
    operation: "hson.transform.number",
    code: HSON_NUMBER_TYPE_REQUIRED,
  });
});

check("authored HSON, JSON values, and raw nodes share finite admission", () => {
  const authored = hson.fromHson(`<value -0>`).toNode();
  assert.equal(Object.is(first_number(authored), -0), true);
  const json = hson.fromJson(-0).toNode();
  assert.equal(Object.is(first_number(json), -0), true);
  const raw = hson.fromNode({ $_tag: "_hson_val", $_content: [-0] }).toNode();
  assert.equal(Object.is(first_number(raw), -0), true);

  for (const value of [NaN, Infinity, -Infinity]) {
    for (const admit of [
      () => hson.fromJson(value).toNode(),
      () => hson.fromNode({ $_tag: "_hson_val", $_content: [value] }).toNode(),
    ]) {
      assert.deepEqual(error_details(admit), {
        operation: "hson.transform.number",
        code: HSON_NUMBER_NONFINITE,
      });
    }
  }
});

check("transport carries ordinary numbers and requires fresh admission proof", () => {
  const admitted = hsonNumber(42);
  const decoded: unknown = JSON.parse(JSON.stringify(admitted));
  assert.equal(typeof decoded, "number");
  assert.equal(hsonNumber(decoded), admitted);
});

emit_hson_live_test_completion("core.hson-number", checks, checks, 0);
process.stdout.write(`# ${checks} HSON numeric admission checks passed\n`);
