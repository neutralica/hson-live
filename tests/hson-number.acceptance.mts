// @hson-live-external-test
import assert from "node:assert/strict";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import {
  HSON_NUMBER_NONFINITE,
  HSON_NUMBER_TYPE_REQUIRED,
  hson,
  hsonCalc,
} from "../src/index.ts";
import { hsonCalc as narrowHsonCalc } from "../src/number.ts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import { read_transform_error_details } from "../src/core/errors.ts";
import { coerce } from "../src/api/transform/utils/primitive-utils/coerce-string.utils.ts";

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

function runtimeCalc(value: unknown): unknown {
  return Reflect.apply(hsonCalc, undefined, [value]);
}

function runtimeNamespaceCalc(value: unknown): unknown {
  return Reflect.apply(hson.transform.calc, hson.transform, [value]);
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

function authored_error_details(source: string) {
  try {
    hson.fromHson(source).toNode();
  } catch (error) {
    const details = read_transform_error_details(error);
    assert.ok(details, `expected a structured authored-HSON error for ${source}`);
    return details;
  }
  assert.fail(`expected authored HSON to reject: ${source}`);
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
  Symbol("one"),
];

check("namespace methods are the named leaf functions", () => {
  assert.equal(hson.transform.calc, hsonCalc);
  assert.equal(narrowHsonCalc, hsonCalc);
  assert.equal("number" in hson.transform, false);
  assert.equal("string" in hson, false);
  assert.equal("number" in hson, false);
  assert.equal("calc" in hson, false);
});

check("hsonCalc accepts every representative finite numeric class", () => {
  for (const value of accepted) assert.equal(hsonCalc(value), value);
});

check("hson.transform.calc accepts every representative finite numeric class", () => {
  for (const value of accepted) assert.equal(hson.transform.calc(value), value);
});

check("both calc surfaces preserve a directly admitted negative zero exactly", () => {
  assert.equal(Object.is(hsonCalc(-0), -0), true);
  assert.equal(Object.is(hson.transform.calc(-0), -0), true);
});

check("authored HSON accepts every settled JSON-number lexical branch", () => {
  for (const [source, value, canonical] of [
    ["0", 0, "0"],
    ["-0", -0, "-0"],
    ["1", 1, "1"],
    ["-1", -1, "-1"],
    ["42", 42, "42"],
    ["0.5", 0.5, "0.5"],
    ["-0.5", -0.5, "-0.5"],
    ["1e3", 1000, "1000"],
    ["1E3", 1000, "1000"],
    ["1e+3", 1000, "1000"],
    ["1e-3", 0.001, "0.001"],
    ["1.7976931348623157e308", Number.MAX_VALUE, "1.7976931348623157e+308"],
    ["5e-324", Number.MIN_VALUE, "5e-324"],
  ] as const) {
    const admitted = hson.fromHson(source).toNode();
    assert.equal(Object.is(first_number(admitted), value), true, source);
    assert.equal(hson.fromHson(source).toHson().noBreak().serialize(), canonical, source);
    assert.equal(
      canonical_hson_graph_equal(admitted, hson.fromHson(canonical).toNode()),
      true,
      source,
    );
  }
});

check("authored HSON leading zeroes reject at the second integer digit", () => {
  for (const [source, index, column] of [["01", 1, 2], ["00", 1, 2], ["-01", 2, 3]] as const) {
    assert.deepEqual(authored_error_details(source), {
      operation: "tokenize-hson",
      code: "HSON_NUMBER_LEADING_ZERO",
      stage: "tokenization",
      source: { index, line: 1, column },
    });
  }
});

check("authored HSON leading plus signs reject at the sign", () => {
  for (const source of ["+1", "+0", "+1.5", "+1e3"] as const) {
    assert.deepEqual(authored_error_details(source), {
      operation: "tokenize-hson",
      code: "HSON_NUMBER_LEADING_PLUS",
      stage: "tokenization",
      source: { index: 0, line: 1, column: 1 },
    });
  }
});

check("authored malformed unsupported and nonfinite spellings retain precise rejection", () => {
  for (const [source, code] of [
    [".5", "HSON_NUMBER_INCOMPLETE_FRACTION"],
    ["1.", "HSON_NUMBER_INCOMPLETE_FRACTION"],
    ["1e", "HSON_NUMBER_INCOMPLETE_EXPONENT"],
    ["1e+", "HSON_NUMBER_INCOMPLETE_EXPONENT"],
    ["--1", "HSON_NUMBER_INVALID_SIGN"],
    ["+-1", "HSON_NUMBER_INVALID_SIGN"],
    ["0x10", "HSON_NUMBER_UNSUPPORTED_SPELLING"],
    ["1_0", "HSON_NUMBER_UNSUPPORTED_SPELLING"],
    ["NaN", "HSON_NUMBER_UNSUPPORTED_SPELLING"],
    ["Infinity", "HSON_NUMBER_UNSUPPORTED_SPELLING"],
    ["-Infinity", "HSON_NUMBER_UNSUPPORTED_SPELLING"],
    ["1e309", "HSON_NUMBER_NONFINITE"],
  ] as const) {
    assert.equal(authored_error_details(source).code, code, source);
  }
});

check("authored numeric rejection is deterministic and does not mutate input", () => {
  const source = "01";
  const before = source.slice();
  const first = authored_error_details(source);
  const second = authored_error_details(source);
  assert.equal(source, before);
  assert.deepEqual(second, first);
  assert.equal(coerce("01"), "01");
  assert.equal(coerce("+1"), "+1");
});

check("hsonCalc rejects nonfinite numbers with one stable identity", () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.deepEqual(error_details(() => runtimeCalc(value)), {
      operation: "hson.transform.calc",
      code: HSON_NUMBER_NONFINITE,
    });
  }
});

check("hsonCalc rejects every non-number runtime class without coercion", () => {
  for (const value of wrongTypes) {
    assert.deepEqual(error_details(() => runtimeCalc(value)), {
      operation: "hson.transform.calc",
      code: HSON_NUMBER_TYPE_REQUIRED,
    });
  }
});

check("namespace calc rejection matches named-export operation and codes", () => {
  for (const value of [NaN, Infinity, -Infinity, ...wrongTypes]) {
    assert.deepEqual(
      error_details(() => runtimeNamespaceCalc(value)),
      error_details(() => runtimeCalc(value)),
    );
  }
});

check("repeated and cross-surface admission is stable", () => {
  const first = hson.transform.calc(42);
  assert.equal(hsonCalc(first), first);
  assert.equal(hson.transform.calc(hsonCalc(first)), first);
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
  const admitted = hsonCalc(Number.MIN_VALUE);
  assert.equal(hsonCalc(() => admitted), admitted);
  assert.equal(hson.transform.calc(() => admitted), admitted);
});

check("direct and callback calc failures use the same operation and codes", () => {
  const candidates: readonly unknown[] = [NaN, Infinity, -Infinity, "1", undefined, Promise.resolve(1)];
  for (const candidate of candidates) {
    const direct = error_details(() => runtimeCalc(candidate));
    assert.deepEqual(error_details(() => runtimeCalc(() => candidate)), direct);
    assert.deepEqual(error_details(() => runtimeNamespaceCalc(() => candidate)), direct);
  }
});

check("unsupported direct calc inputs use the numeric structured identity", () => {
  for (const candidate of [null, {}, new Number(1), Promise.resolve(1)]) {
    const named = error_details(() => Reflect.apply(hsonCalc, undefined, [candidate]));
    const namespace = error_details(() => Reflect.apply(hson.transform.calc, undefined, [candidate]));
    assert.deepEqual(named, { operation: "hson.transform.calc", code: HSON_NUMBER_TYPE_REQUIRED });
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
  assert.deepEqual(error_details(() => runtimeCalc(() => promise)), {
    operation: "hson.transform.calc",
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
        operation: "hson.number-admission",
        code: HSON_NUMBER_NONFINITE,
      });
    }
  }
});

check("transport carries ordinary numbers and requires fresh admission proof", () => {
  const admitted = hsonCalc(42);
  const decoded: unknown = JSON.parse(JSON.stringify(admitted));
  assert.equal(typeof decoded, "number");
  assert.equal(runtimeCalc(decoded), admitted);
});

process.stdout.write(`# ${checks} HSON numeric admission checks passed\n`);
emit_hson_live_test_completion("core.hson-number", checks, checks, 0);
