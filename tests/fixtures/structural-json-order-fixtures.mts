import type { HsonNode, Primitive } from "../../src/core/types.ts";
import type { TransformErrorDetails } from "../../src/core/errors.ts";

function node(tag: string, content: HsonNode["$_content"] = []): HsonNode {
  return { $_tag: tag, $_content: content };
}

function scalar(value: Primitive): HsonNode {
  return node(typeof value === "string" ? "_hson_str" : "_hson_val", [value]);
}

function object(properties: readonly HsonNode[]): HsonNode {
  return node("_hson_obj", [...properties]);
}

function property(key: string, value: HsonNode): HsonNode {
  const relationship = value.$_tag === "_hson_obj" || value.$_tag === "_hson_arr"
    ? value
    : object([value]);
  return node(key, [relationship]);
}

function array(values: readonly HsonNode[]): HsonNode {
  return node("_hson_arr", values.map((value, index) => ({
    $_tag: "_hson_ii",
    $_meta: { index: String(index) },
    $_content: [value],
  })));
}

export type StructuralJsonOrderFixture = Readonly<{
  id: string;
  graph: HsonNode;
  expectedJson: string;
  expectedObjectOrders: readonly (readonly string[])[];
}>;

export const DIRECT_INTEGER_KEY_SOURCE = `<'10' "ten" '2' "two" '1' "one">`;

export const ADJACENT_DUPLICATE_JSON_SOURCE = `{"x":1,"x":2}`;
export const ADJACENT_DUPLICATE_JSON_ERROR: TransformErrorDetails = Object.freeze({
  operation: "parse-json",
  stage: "parsing",
  code: "HSON_JSON_DUPLICATE_PROPERTY",
  source: Object.freeze({ index: 7, line: 1, column: 8 }),
  path: `$["x"]`,
  related: Object.freeze([Object.freeze({
    role: "first-declaration",
    source: Object.freeze({ index: 1, line: 1, column: 2 }),
  })]),
});

export const directIntegerKeyFixture: StructuralJsonOrderFixture = Object.freeze({
  id: "structural-json-order.direct-integer-keys",
  graph: object([
    property("10", scalar("ten")),
    property("2", scalar("two")),
    property("1", scalar("one")),
  ]),
  expectedJson: `{
  "10": "ten",
  "2": "two",
  "1": "one"
}`,
  expectedObjectOrders: Object.freeze([Object.freeze(["10", "2", "1"])]),
});

export const mixedKeyFixture: StructuralJsonOrderFixture = Object.freeze({
  id: "structural-json-order.mixed-key-classes",
  graph: object([
    property("a", scalar("a")),
    property("10", scalar("ten")),
    property("2", scalar("two")),
    property("01", scalar("leading-zero")),
    property("4294967294", scalar("highest-index")),
    property("4294967295", scalar("outside-index")),
    property("-1", scalar("negative")),
    property("b", scalar("b")),
  ]),
  expectedJson: `{
  "a": "a",
  "10": "ten",
  "2": "two",
  "01": "leading-zero",
  "4294967294": "highest-index",
  "4294967295": "outside-index",
  "-1": "negative",
  "b": "b"
}`,
  expectedObjectOrders: Object.freeze([Object.freeze([
    "a",
    "10",
    "2",
    "01",
    "4294967294",
    "4294967295",
    "-1",
    "b",
  ])]),
});

export const nestedObjectFixture: StructuralJsonOrderFixture = Object.freeze({
  id: "structural-json-order.nested-object",
  graph: object([
    property("outer-z", scalar("first")),
    property("inner", object([
      property("10", scalar("ten")),
      property("2", scalar("two")),
      property("1", scalar("one")),
    ])),
    property("outer-a", scalar("last")),
  ]),
  expectedJson: `{
  "outer-z": "first",
  "inner": {
    "10": "ten",
    "2": "two",
    "1": "one"
  },
  "outer-a": "last"
}`,
  expectedObjectOrders: Object.freeze([
    Object.freeze(["outer-z", "inner", "outer-a"]),
    Object.freeze(["10", "2", "1"]),
  ]),
});

export const objectInsideArrayFixture: StructuralJsonOrderFixture = Object.freeze({
  id: "structural-json-order.object-inside-array",
  graph: array([
    object([
      property("10", scalar("ten")),
      property("2", scalar("two")),
      property("1", scalar("one")),
    ]),
    scalar("tail"),
  ]),
  expectedJson: `[
  {
    "10": "ten",
    "2": "two",
    "1": "one"
  },
  "tail"
]`,
  expectedObjectOrders: Object.freeze([Object.freeze(["10", "2", "1"])]),
});

export const arrayInsideObjectFixture: StructuralJsonOrderFixture = Object.freeze({
  id: "structural-json-order.array-inside-object",
  graph: object([
    property("before", scalar("first")),
    property("items", array([
      object([
        property("10", scalar("ten")),
        property("2", scalar("two")),
        property("1", scalar("one")),
      ]),
      object([
        property("3", scalar("three")),
        property("0", scalar("zero")),
      ]),
    ])),
    property("after", scalar("last")),
  ]),
  expectedJson: `{
  "before": "first",
  "items": [
    {
      "10": "ten",
      "2": "two",
      "1": "one"
    },
    {
      "3": "three",
      "0": "zero"
    }
  ],
  "after": "last"
}`,
  expectedObjectOrders: Object.freeze([
    Object.freeze(["before", "items", "after"]),
    Object.freeze(["10", "2", "1"]),
    Object.freeze(["3", "0"]),
  ]),
});

export const negativeZeroOrderFixture: StructuralJsonOrderFixture = Object.freeze({
  id: "structural-json-order.negative-zero",
  graph: object([
    property("10", scalar("ten")),
    property("negative-zero", scalar(-0)),
    property("2", scalar("two")),
    property("1", scalar("one")),
  ]),
  expectedJson: `{
  "10": "ten",
  "negative-zero": -0,
  "2": "two",
  "1": "one"
}`,
  expectedObjectOrders: Object.freeze([Object.freeze(["10", "negative-zero", "2", "1"])]),
});

export const structuralJsonOrderFixtures: readonly StructuralJsonOrderFixture[] = Object.freeze([
  directIntegerKeyFixture,
  mixedKeyFixture,
  nestedObjectFixture,
  objectInsideArrayFixture,
  arrayInsideObjectFixture,
  negativeZeroOrderFixture,
]);

const completeBoundaryNames = Object.freeze([
  "10", "alpha", "2", "01", "1", "omega", "4294967294", "0", "100",
  "00", "0001", "-1", "-0", "+1", "1.0", "1e0", "4294967295",
]);
export const orderedRootReconstructionFixtures: readonly StructuralJsonOrderFixture[] = Object.freeze([
  ...structuralJsonOrderFixtures,
  ...[false, true].map((equal): StructuralJsonOrderFixture => ({
    id: `ordered-root.complete-boundary-${equal ? "equal" : "distinct"}`,
    graph: object(completeBoundaryNames.map((key, index) => property(key, scalar(equal ? 1 : index)))),
    expectedJson: `{\n${completeBoundaryNames.map((key, index) => `  ${JSON.stringify(key)}: ${equal ? 1 : index}`).join(",\n")}\n}`,
    expectedObjectOrders: [completeBoundaryNames],
  })),
  { id: "ordered-root.empty", graph: object([]), expectedJson: "{}", expectedObjectOrders: [[]] },
  { id: "ordered-root.singleton", graph: object([property("10", scalar(1))]), expectedJson: '{\n  "10": 1\n}', expectedObjectOrders: [["10"]] },
  { id: "ordered-root.nonnumeric", graph: object([property("z", scalar(1)), property("a", scalar(2))]),
    expectedJson: '{\n  "z": 1,\n  "a": 2\n}', expectedObjectOrders: [["z", "a"]] },
]);

/** Observe the initial receiver too: later exact restoration cannot hide a JS detour. */
export function forbid_structural_js_enumeration(): () => void {
  const original = Reflect.ownKeys;
  let enumerations = 0;
  Reflect.ownKeys = new Proxy(original, {
    apply(target, receiver, args) {
      const value: unknown = args[0];
      if (typeof value === "object" && value !== null && !Array.isArray(value)
        && ["10", "2", "1"].every(key => Object.hasOwn(value, key))) {
        enumerations += 1;
        throw new Error("Canonical reconstruction enumerated structural members as JS properties.");
      }
      return Reflect.apply(target, receiver, args);
    },
  });
  return () => {
    Reflect.ownKeys = original;
    if (enumerations !== 0) throw new Error("Initial canonical admission passed through a lossy JS object.");
  };
}
