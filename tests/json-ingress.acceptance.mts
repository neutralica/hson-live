// @hson-live-external-test
import { create_test_event_emitter } from "./test-events.mjs";
import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import { nodeFromJson, parse_json } from "../src/api/transform/parsers/parse-json.ts";
import { hsonTransform } from "../src/api/transform/transform.facade.ts";
import { SAFE_TRANSFORM_SOURCE, UNSAFE_TRANSFORM_SOURCE } from "../src/api/transform/transform.browser.ts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import { is_Node } from "../src/core/node-guards.ts";
import { detach_hson_root_value } from "../src/api/transform/utils/node-utils/detach-hson-root-value.ts";
import type { HsonNode, JsonValue, Primitive } from "../src/core/types.ts";
import {
  read_transform_error_details,
  TransformError,
  type TransformErrorDetails,
} from "../src/core/errors.ts";
import {
  ADJACENT_DUPLICATE_JSON_ERROR,
  ADJACENT_DUPLICATE_JSON_SOURCE,
  DIRECT_INTEGER_KEY_SOURCE,
  arrayInsideObjectFixture,
  directIntegerKeyFixture,
  mixedKeyFixture,
  negativeZeroOrderFixture,
  nestedObjectFixture,
  objectInsideArrayFixture,
  structuralJsonOrderFixtures,
  type StructuralJsonOrderFixture,
} from "./fixtures/structural-json-order-fixtures.mts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "transform.json-ingress",
  title: "Detached JSON ingress and root metadata",
  category: "Transform",
  runtime: "node",
  tags: Object.freeze(["json", "ingress", "canonical-graph", "externally-discoverable"]),
});

const testEvents = create_test_event_emitter("transform.json-ingress");
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

const QUID = "d1r6x8qwc";

const str = (value: string): HsonNode => ({ $_tag: "_hson_str", $_content: [value] });
const val = (value: Exclude<Primitive, string>): HsonNode => ({ $_tag: "_hson_val", $_content: [value] });
const elem = (...content: HsonNode[]): HsonNode => ({ $_tag: "_hson_elem", $_content: content });
const named = (tag: string, ...content: HsonNode[]): HsonNode => ({ $_tag: tag, $_content: content });
const root = (content: HsonNode): HsonNode => ({ $_tag: "_hson_root", $_content: [content] });

function assert_source_graph(input: JsonValue, expected: HsonNode): void {
  // Producer observations precede any serialization or forgiving re-admission.
  assert.deepEqual(parse_json(input), expected);
  assert.equal(canonical_hson_graph_equal(hson.fromJson(input).toNode(), expected), true);
}

check("explicit scalar ROOT constructs direct complete primitives before normalization", () => {
  for (const payload of ["x", "", 1, 0, -0, true, false, null]) {
    const input = { _hson_root: payload };
    const complete = typeof payload === "string" ? str(payload) : val(payload);
    const expected = root(complete);
    assert.deepEqual(nodeFromJson(input, "_hson_obj").node, expected);
    assert_source_graph(input, expected);
    // JSON.stringify cannot express -0, so use an authored numeric spelling.
    const text = Object.is(payload, -0) ? '{"_hson_root":-0}' : JSON.stringify(input);
    assert.deepEqual(parse_json(text), expected);
    for (const sourceInput of [input, text]) {
      const source = hson.fromJson(sourceInput);
      assert.equal(canonical_hson_graph_equal(source.toNode(), expected), true);
      assert.equal(canonical_hson_graph_equal(hson.fromHson(source.toHson().serialize()).toNode(), complete), true);
      assert.equal(canonical_hson_graph_equal(hson.fromBinary(source.toBinary().serialize()).toNode(), complete), true);
    }
  }
});

check("only complete singleton JSON text scaffolds lower to STR", () => {
  for (const text of ["x", "", "\ud800\u0000\udfff", "𝄞"]) {
    const input = { _hson_elem: [text] };
    assert_source_graph(input, root(str(text)));
    assert_source_graph({ _hson_root: input }, root(str(text)));
    assert.deepEqual(parse_json(JSON.stringify(input)), root(str(text)));
    const nested = { _hson_elem: [{ p: input }] };
    const relationship = elem(named("p", elem(str(text))));
    assert.deepEqual(nodeFromJson(nested, "_hson_obj").node, relationship);
    assert_source_graph(nested, root(relationship));
    assert.equal(canonical_hson_graph_equal(hson.fromBinary(hson.fromJson(input).toBinary().serialize()).toNode(), str(text)), true);
  }
  // Source interpretation does not change direct canonical admission.
  assert.throws(() => hson.fromNode(elem(str("x"))));
  assert.throws(() => hson.fromNode(root(str("x"))));
});

check("named JSON elements construct relationships before graph normalization", () => {
  for (const payload of ["x", { _hson_elem: ["x"] }]) {
    const input = { _hson_elem: [{ p: payload }] };
    const expected = elem(named("p", elem(str("x"))));
    assert.deepEqual(nodeFromJson(input, "_hson_obj").node, expected);
    assert_source_graph(input, root(expected));
    const source = hson.fromJson(input);
    assert.equal(canonical_hson_graph_equal(hson.fromHson(source.toHson().serialize()).toNode(), expected), true);
    assert.equal(canonical_hson_graph_equal(hson.fromBinary(source.toBinary().serialize()).toNode(), expected), true);
  }
  for (const payload of ["", { _hson_elem: [] }]) {
    const input = { _hson_elem: [{ p: payload }] };
    const expected = elem(named("p"));
    assert.deepEqual(nodeFromJson(input, "_hson_obj").node, expected);
    assert_source_graph(input, root(expected));
  }
});

check("JSON ordered content preserves adjacent and empty STR nodes and nested empty elements", () => {
  const fixtures: readonly (readonly [JsonValue, HsonNode])[] = [
    [{ _hson_elem: ["a", "b"] }, elem(str("a"), str("b"))],
    [{ _hson_elem: ["a", { p: "x" }] }, elem(str("a"), named("p", elem(str("x"))))],
    [{ _hson_elem: [{ p: "x" }, "b"] }, elem(named("p", elem(str("x"))), str("b"))],
    [{ _hson_elem: ["", "a", "", { p: "x" }, "", "b", ""] }, elem(str(""), str("a"), str(""), named("p", elem(str("x"))), str(""), str("b"), str(""))],
    [{ _hson_elem: [{ p: { _hson_elem: ["", { br: "" }, ""] } }] }, elem(named("p", elem(str(""), named("br"), str(""))))],
  ];
  for (const [input, complete] of fixtures) {
    assert.deepEqual(nodeFromJson(input, "_hson_obj").node, complete);
    assert_source_graph(input, root(complete));
    assert.deepEqual(parse_json(JSON.stringify(input)), root(complete));
    const source = hson.fromJson(input);
    assert.equal(canonical_hson_graph_equal(hson.fromBinary(source.toBinary().serialize()).toNode(), complete), true);
    assert.equal(canonical_hson_graph_equal(hson.fromHson(source.toHson().serialize()).toNode(), complete), true);
  }
});

check("invalid JSON element structures reject without fallback values", () => {
  const invalidNamedPayloads: readonly JsonValue[] = [1, true, null, [], {}, { field: "x" }, { _hson_root: "x" }];
  const invalid: readonly JsonValue[] = [
    { _hson_elem: [] }, { _hson_root: { _hson_elem: [] } },
    ...[1, -0, true, false, null].map(payload => ({ _hson_elem: [payload] })),
    ...invalidNamedPayloads.map(payload => ({ _hson_elem: [{ p: payload }] })),
    { _hson_elem: [{ p: "x", q: "y" }] },
    { _hson_elem: [{ p: "x", _hson_elem: ["y"] }] },
    { _hson_elem: ["x"], _hson_root: "y" },
    { _hson_elem: ["x"], _hson_obj: {} },
  ];
  for (const input of invalid) {
    const before = structuredClone(input);
    for (const sourceInput of [input, JSON.stringify(input)]) {
      assert.throws(() => parse_json(sourceInput));
      assert.throws(() => hson.fromJson(sourceInput));
    }
    assert.deepEqual(input, before);
  }
});

check("JSON producer outputs remain isolated across generic source entrypoints and terminals", () => {
  for (const factory of [hson, hsonTransform, SAFE_TRANSFORM_SOURCE, UNSAFE_TRANSFORM_SOURCE]) {
    const child = { p: "x", $_attrs: { title: "original" } };
    const input = { _hson_root: { _hson_elem: ["before", child, "", "after"] } };
    const source = factory.fromJson(input);
    const expected = source.toNode();
    const hsonOutput = source.toHson(); const jsonOutput = source.toJson();
    const htmlOutput = source.toHtml(); const binaryOutput = source.toBinary();
    const text = hsonOutput.serialize(); const json = jsonOutput.serialize();
    const html = htmlOutput.serialize(); const bytes = binaryOutput.serialize();
    child.p = "changed"; child.$_attrs.title = "caller";
    input._hson_root._hson_elem.length = 0;
    const first = source.toNode();
    only_standard(first, "p").$_content.length = 0;
    const attrs = only_standard(first, "p").$_attrs;
    assert.ok(attrs); attrs.title = "copy";
    first.$_content.length = 0;
    for (let observation = 0; observation < 2; observation++) {
      assert.equal(canonical_hson_graph_equal(source.toNode(), expected), true);
      assert.notEqual(source.toNode(), source.toNode());
      assert.equal(source.toHson().serialize(), text); assert.equal(hsonOutput.serialize(), text);
      assert.equal(source.toJson().serialize(), json); assert.equal(jsonOutput.serialize(), json);
      assert.equal(source.toHtml().serialize(), html); assert.equal(htmlOutput.serialize(), html);
      assert.deepEqual(source.toBinary().serialize(), bytes); assert.deepEqual(binaryOutput.serialize(), bytes);
    }
  }
});

check("native JSON controls retain data carriers and physical array indexes", () => {
  const object = (...content: HsonNode[]): HsonNode => ({ $_tag: "_hson_obj", $_content: content });
  const array = (...content: HsonNode[]): HsonNode => ({ $_tag: "_hson_arr", $_content: content.map((item, index) => ({ $_tag: "_hson_ii", $_meta: { index: String(index) }, $_content: [item] })) });
  const input: JsonValue = { text: "", nested: [null, false, -0, {}, [], { ok: "x" }] };
  const expected = object(named("text", object(str(""))), named("nested", array(val(null), val(false), val(-0), object(), array(), object(named("ok", object(str("x")))))));
  assert_source_graph(input, root(expected));
  const payloads: readonly JsonValue[] = ["x", "", 1, -0, true, false, null, {}, []];
  for (const payload of payloads) {
    const complete = typeof payload === "string" ? str(payload)
      : typeof payload === "number" || typeof payload === "boolean" || payload === null ? val(payload)
      : Array.isArray(payload) ? array() : object();
    const sourceInput = typeof payload === "string" ? JSON.stringify(payload) : payload;
    assert_source_graph(sourceInput, root(complete));
  }
});

function explicit_root(meta: unknown = undefined): JsonValue {
  return {
    _hson_root: {
      _hson_elem: [{ div: "" }],
    },
    ...(meta === undefined ? {} : { $_meta: meta }),
  } as JsonValue;
}

function only_standard(root: HsonNode, tag: string): HsonNode {
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.shift();
    if (current === undefined) break;
    if (current.$_tag === tag) return current;
    for (const child of current.$_content) {
      if (is_Node(child)) pending.push(child);
    }
  }
  throw new Error(`Expected <${tag}>.`);
}

function deep_freeze(value: unknown, seen = new WeakSet<object>()): void {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  for (const child of Object.values(value)) deep_freeze(child, seen);
  Object.freeze(value);
}

function detached_json_text(source: string): HsonNode {
  return detach_hson_root_value(parse_json(source));
}

function object_property_orders(root: HsonNode): readonly (readonly string[])[] {
  const orders: string[][] = [];
  const visit = (current: HsonNode): void => {
    if (current.$_tag === "_hson_obj"
      && current.$_content.length > 0
      && current.$_content.every((child) => is_Node(child) && !child.$_tag.startsWith("_hson_"))) {
      orders.push(current.$_content.map((child) => (child as HsonNode).$_tag));
    }
    for (const child of current.$_content) if (is_Node(child)) visit(child);
  };
  visit(root);
  return orders;
}

function assert_ordered_json_closure(fixture: StructuralJsonOrderFixture): HsonNode {
  const before = structuredClone(fixture.graph);
  const firstText = hson.fromNode(fixture.graph).toJson().serialize();
  assert.equal(firstText, fixture.expectedJson);
  assert.deepEqual(fixture.graph, before);
  const reparsed = detached_json_text(firstText);
  assert.equal(canonical_hson_graph_equal(reparsed, fixture.graph), true);
  assert.deepEqual(object_property_orders(reparsed), fixture.expectedObjectOrders);
  assert.equal(hson.fromNode(reparsed).toJson().serialize(), fixture.expectedJson);
  return reparsed;
}

function duplicate_json_error(source: string): TransformErrorDetails {
  let observed: TransformError | undefined;
  assert.throws(
    () => parse_json(source),
    (cause) => {
      if (!(cause instanceof TransformError)) return false;
      observed = cause;
      return cause.code === "HSON_JSON_DUPLICATE_PROPERTY";
    },
  );
  const details = read_transform_error_details(observed);
  assert.ok(details);
  return details;
}

check("explicit root without metadata remains valid while runtime undefined rejects", () => {
  const populated = parse_json(explicit_root());
  const populatedText = parse_json(JSON.stringify(explicit_root()));
  assert.equal(populated.$_tag, "_hson_root");
  assert.equal(populated.$_content.length, 1);
  assert.equal(Object.hasOwn(populated, "$_meta"), false);
  assert.equal(canonical_hson_graph_equal(populated, populatedText), true);

  assert.throws(
    () => parse_json({ _hson_root: undefined } as unknown as JsonValue),
    (cause) => cause instanceof TransformError
      && cause.code === "PROJECTED_VALUE_UNDEFINED_VALUE"
      && cause.path === '["_hson_root"]',
  );
});

check("empty root metadata normalizes away while explicit undefined rejects", () => {
  const input = { _hson_root: { _hson_elem: [{ div: "" }] }, $_meta: {} };
  const result = parse_json(input as unknown as JsonValue);
  assert.equal(Object.hasOwn(result, "$_meta"), false);
  const textResult = parse_json(JSON.stringify(input));
  assert.equal(canonical_hson_graph_equal(result, textResult), true);

  assert.throws(
    () => parse_json({ ...input, $_meta: undefined } as unknown as JsonValue),
    (cause) => cause instanceof TransformError
      && cause.code === "PROJECTED_VALUE_UNDEFINED_VALUE"
      && cause.path === '["$_meta"]',
  );
});

check("JSON text and value reject every populated root metadata class", () => {
  const cases: readonly unknown[] = [
    { quid: QUID },
    { index: "0" },
    { unknown: "x" },
    { quid: QUID, unknown: "x" },
    { attrs: { legacy: "x" } },
  ];
  for (const meta of cases) {
    const value = explicit_root(meta);
    for (const input of [value, JSON.stringify(value)]) {
      assert.throws(
        () => parse_json(input as JsonValue),
        (cause) => cause instanceof Error
          && ("code" in cause && cause.code === "PORTABLE_RUNTIME_QUID_FORBIDDEN"
            || cause.message.includes("_hson_root") && cause.message.includes("meta")),
      );
    }
  }
});

check("malformed root metadata types reject rather than disappearing", () => {
  for (const meta of ["invalid", [], [1], null]) {
    const value = explicit_root(meta);
    for (const input of [value, JSON.stringify(value)]) {
      assert.throws(
        () => parse_json(input as JsonValue),
        /\$_meta must be a plain object[\s\S]*_hson_root/,
      );
    }
  }
});

check("raw-node and JSON ingress both reject root metadata", () => {
  const raw: HsonNode = {
    $_tag: "_hson_root",
    $_meta: { quid: QUID },
    $_content: [{ $_tag: "_hson_elem", $_content: [{ $_tag: "div", $_content: [] }] }],
  };
  assert.throws(() => hson.fromNode(raw),
    (error) => error instanceof TransformError && error.code === "PORTABLE_RUNTIME_QUID_FORBIDDEN");
  assert.throws(() => parse_json(explicit_root({ quid: QUID })), /runtime QUID metadata is invalid/);

  const malformedRaw = {
    $_tag: "_hson_root",
    $_meta: [],
    $_content: [],
  } as unknown as HsonNode;
  assert.throws(() => hson.fromNode(malformedRaw),
    (error) => error instanceof TransformError && error.path === '$["$_meta"]');
});

check("structured style normalizes only after a detached copy", () => {
  const input = {
    _hson_elem: [{
      div: "",
      $_attrs: {
        id: 7,
        "data-user": "application",
        style: {
          backgroundColor: " red ",
          marginTop: "1px",
          opacity: 0.5,
        },
      },
    }],
  } as unknown as JsonValue;
  const before = structuredClone(input);
  deep_freeze(input);
  const result = parse_json(input);
  assert.deepEqual(input, before);
  const div = only_standard(result, "div");
  assert.deepEqual(div.$_attrs, {
    id: "7",
    "data-user": "application",
    style: {
      backgroundColor: "red",
      marginTop: "1px",
      opacity: "0.5",
    },
  });
  assert.equal(div.$_meta?.quid, undefined);
});

check("nested element styles and ordinary attrs do not mutate caller input", () => {
  const input = {
    _hson_elem: [{
      section: {
        _hson_elem: [{
          span: "",
          $_attrs: {
            title: " kept ",
            style: { cssFloat: " left ", paddingTop: { value: 2, unit: "px" } },
          },
        }],
      },
      $_attrs: { style: " color: blue; margin-top: 3px " },
    }],
  } as unknown as JsonValue;
  const before = structuredClone(input);
  const result = parse_json(input);
  assert.deepEqual(input, before);
  assert.deepEqual(only_standard(result, "section").$_attrs?.style, {
    color: "blue",
    marginTop: "3px",
  });
  assert.deepEqual(only_standard(result, "span").$_attrs, {
    title: " kept ",
    style: { float: "left", paddingTop: "2px" },
  });
});

check("arrays, nested objects, metadata, data attrs, and empty records are detached", () => {
  const dataInput = { values: [{ nested: [1, 2] }] };
  const elementInput = {
    _hson_elem: [{
      p: "",
      $_attrs: { "data-state": "ready" },
      $_meta: {},
    }],
  } as unknown as JsonValue;
  const dataBefore = structuredClone(dataInput);
  const elementBefore = structuredClone(elementInput);
  const first = parse_json(elementInput);
  const second = parse_json(elementInput);
  const dataResult = parse_json(dataInput);
  assert.deepEqual(dataResult, parse_json(dataInput));
  const arrayNode = only_standard(dataResult, "values").$_content[0];
  assert.ok(is_Node(arrayNode));
  assert.equal(arrayNode.$_tag, "_hson_arr");
  assert.deepEqual(
    arrayNode.$_content.map((wrapper) => {
      assert.ok(is_Node(wrapper));
      return wrapper.$_meta?.index;
    }),
    ["0"],
  );
  assert.deepEqual(dataInput, dataBefore);
  assert.deepEqual(elementInput, elementBefore);
  assert.deepEqual(first, second);
  assert.deepEqual(only_standard(first, "p").$_attrs, { "data-state": "ready" });
  assert.equal(Object.hasOwn(only_standard(first, "p"), "$_meta"), false);
});

check("successful parse isolates later mutations in both directions", () => {
  const input = {
    div: {
      nested: [1, 2],
      $_attrs: { title: "original", style: { color: " red " } },
    },
  } as unknown as JsonValue;
  const result = parse_json(input);
  const snapshot = structuredClone(result);
  const inputRecord = input as unknown as {
    div: { $_attrs: { title: string; style: { color: string } }; nested: number[] };
  };
  inputRecord.div.$_attrs.title = "changed";
  inputRecord.div.$_attrs.style.color = "blue";
  inputRecord.div.nested.push(3);
  assert.deepEqual(result, snapshot);

  const div = only_standard(result, "div");
  if (div.$_attrs) div.$_attrs.title = "result-only";
  const divObject = div.$_content[0];
  assert.ok(is_Node(divObject));
  const nested = divObject.$_content[0];
  assert.ok(is_Node(nested));
  const array = nested.$_content[0];
  assert.ok(is_Node(array));
  const firstItem = array.$_content[0];
  assert.ok(is_Node(firstItem));
  const firstValue = firstItem.$_content[0];
  assert.ok(is_Node(firstValue));
  firstValue.$_content[0] = 99;
  assert.equal(inputRecord.div.$_attrs.title, "changed");
  assert.deepEqual(inputRecord.div.nested, [1, 2, 3]);
});

check("rejected style and metadata inputs remain unchanged", () => {
  const invalidStyle = {
    _hson_elem: [{ div: "", $_attrs: { style: { color: { nested: "bad" } } } }],
  } as unknown as JsonValue;
  const invalidMeta = {
    _hson_elem: [{ div: "", $_meta: "invalid" }],
  } as unknown as JsonValue;
  for (const value of [invalidStyle, invalidMeta]) {
    const before = structuredClone(value);
    assert.throws(() => parse_json(value));
    assert.deepEqual(value, before);
  }
});

check("cyclic parsed values reject deterministically without mutation", () => {
  const cyclic: Record<string, unknown> = { kept: "value" };
  cyclic.self = cyclic;
  assert.throws(
    () => parse_json(cyclic as JsonValue),
    (cause) => cause instanceof TransformError
      && cause.code === "PROJECTED_VALUE_CYCLE"
      && cause.path === '["self"]',
  );
  assert.equal(cyclic.kept, "value");
  assert.equal(cyclic.self, cyclic);
});

check("shared acyclic caller references are copied by value", () => {
  const shared = { value: 1 };
  const input = { left: shared, right: shared } as JsonValue;
  const result = parse_json(input);
  shared.value = 2;
  assert.deepEqual(hson.fromNode(detach_hson_root_value(result)).toJson().value(), {
    left: { value: 1 },
    right: { value: 1 },
  });
});

check("JSON text and parsed values produce canonically equal graphs", () => {
  const values: readonly JsonValue[] = [
    { name: "Ada", active: true, nested: [1, null, { ok: "yes" }] },
    [1, "two", false, { nested: [] }],
    {
      _hson_elem: [{
        div: "",
        $_attrs: { "data-user": "x", style: { backgroundColor: " red " } },
      }],
    } as unknown as JsonValue,
  ];
  for (const value of values) {
    assert.equal(
      canonical_hson_graph_equal(parse_json(value), parse_json(JSON.stringify(value))),
      true,
    );
  }
});

check("direct JSON values preserve negative zero while JSON text has JSON's zero semantics", () => {
  const direct = parse_json({ value: -0 });
  const text = parse_json(JSON.stringify({ value: -0 }));
  const directValue = hson.fromNode(detach_hson_root_value(direct)).toJson().value() as { value: number };
  const textValue = hson.fromNode(detach_hson_root_value(text)).toJson().value() as { value: number };
  assert.equal(Object.is(directValue.value, -0), true);
  assert.equal(Object.is(textValue.value, 0), true);
  assert.equal(Object.is(textValue.value, -0), false);
  assert.equal(canonical_hson_graph_equal(direct, text), false);
});

check("structural JSON directly preserves canonical integer-key property order", () => {
  const authored = hson.fromHson(DIRECT_INTEGER_KEY_SOURCE).toNode();
  assert.equal(canonical_hson_graph_equal(authored, directIntegerKeyFixture.graph), true);
  assert_ordered_json_closure(directIntegerKeyFixture);
});

check("structural JSON preserves one deliberate mixed key-class sequence", () => {
  assert_ordered_json_closure(mixedKeyFixture);
});

check("structural JSON preserves outer and inner ordered objects", () => {
  assert_ordered_json_closure(nestedObjectFixture);
});

check("structural JSON preserves ordered objects inside arrays", () => {
  const reparsed = assert_ordered_json_closure(objectInsideArrayFixture);
  assert.equal(reparsed.$_content.length, 2);
});

check("structural JSON preserves arrays containing ordered objects inside an object", () => {
  assert_ordered_json_closure(arrayInsideObjectFixture);
});

check("structural JSON multiple-cycle closure retains the original baseline", () => {
  const baseline = directIntegerKeyFixture.graph;
  const firstText = hson.fromNode(baseline).toJson().serialize();
  const firstGraph = detached_json_text(firstText);
  const secondText = hson.fromNode(firstGraph).toJson().serialize();
  const secondGraph = detached_json_text(secondText);
  assert.equal(canonical_hson_graph_equal(firstGraph, baseline), true);
  assert.equal(canonical_hson_graph_equal(secondGraph, baseline), true);
  assert.equal(firstText, directIntegerKeyFixture.expectedJson);
  assert.equal(secondText, directIntegerKeyFixture.expectedJson);
});

check("negative zero and integer-key order coexist through structural JSON", () => {
  const reparsed = assert_ordered_json_closure(negativeZeroOrderFixture);
  const property = reparsed.$_content[1];
  assert.ok(is_Node(property));
  const carrier = property.$_content[0];
  assert.ok(is_Node(carrier));
  const value = carrier.$_content[0];
  assert.ok(is_Node(value));
  assert.equal(Object.is(value.$_content[0], -0), true);
  assert.match(negativeZeroOrderFixture.expectedJson, /"negative-zero": -0/);
});

check("ordered JSON fixtures are deterministic and nonmutating", () => {
  for (const fixture of structuralJsonOrderFixtures) {
    const graphBefore = structuredClone(fixture.graph);
    const sourceBefore = fixture.expectedJson;
    const first = hson.fromNode(fixture.graph).toJson().serialize();
    const second = hson.fromNode(fixture.graph).toJson().serialize();
    assert.equal(first, second, fixture.id);
    assert.deepEqual(fixture.graph, graphBefore, fixture.id);
    detached_json_text(fixture.expectedJson);
    assert.equal(fixture.expectedJson, sourceBefore, fixture.id);
  }
});

check("JSON string ingress preserves text order while value ingress reflects runtime enumeration", () => {
  const fromText = detached_json_text(directIntegerKeyFixture.expectedJson);
  const runtimeValue = JSON.parse(directIntegerKeyFixture.expectedJson) as JsonValue;
  const exposedOrder = Object.keys(runtimeValue as Record<string, JsonValue>);
  assert.deepEqual(exposedOrder, ["1", "2", "10"]);
  const fromValue = detach_hson_root_value(parse_json(runtimeValue));
  assert.deepEqual(object_property_orders(fromText), [["10", "2", "1"]]);
  assert.deepEqual(object_property_orders(fromValue), [["1", "2", "10"]]);
  assert.equal(canonical_hson_graph_equal(fromText, fromValue), false);
});

check("adjacent duplicate JSON properties reject with both declaration positions", () => {
  assert.deepEqual(
    duplicate_json_error(ADJACENT_DUPLICATE_JSON_SOURCE),
    ADJACENT_DUPLICATE_JSON_ERROR,
  );
});

check("separated duplicate JSON properties reject instead of overwriting", () => {
  const source = `{"x":1,"y":2,"x":3}`;
  assert.deepEqual(duplicate_json_error(source), {
    operation: "parse-json",
    stage: "parsing",
    code: "HSON_JSON_DUPLICATE_PROPERTY",
    source: { index: 13, line: 1, column: 14 },
    path: `$["x"]`,
    related: [{
      role: "first-declaration",
      source: { index: 1, line: 1, column: 2 },
    }],
  });
});

check("decoded-equivalent escaped JSON property names reject as duplicates", () => {
  const source = `{"x":1,"\\u0078":2}`;
  assert.deepEqual(duplicate_json_error(source), {
    operation: "parse-json",
    stage: "parsing",
    code: "HSON_JSON_DUPLICATE_PROPERTY",
    source: { index: 7, line: 1, column: 8 },
    path: `$["x"]`,
    related: [{
      role: "first-declaration",
      source: { index: 1, line: 1, column: 2 },
    }],
  });
});

check("nested duplicate JSON properties retain multiline source evidence", () => {
  const source = `{
  "outer": {
    "x": 1,
    "x": 2
  }
}`;
  assert.deepEqual(duplicate_json_error(source), {
    operation: "parse-json",
    stage: "parsing",
    code: "HSON_JSON_DUPLICATE_PROPERTY",
    source: { index: 31, line: 4, column: 5 },
    path: `$["outer"]["x"]`,
    related: [{
      role: "first-declaration",
      source: { index: 19, line: 3, column: 5 },
    }],
  });
});

check("duplicate JSON properties inside an array object reject", () => {
  const source = `[{"x":1,"x":2}]`;
  assert.deepEqual(duplicate_json_error(source), {
    operation: "parse-json",
    stage: "parsing",
    code: "HSON_JSON_DUPLICATE_PROPERTY",
    source: { index: 8, line: 1, column: 9 },
    path: `$[0]["x"]`,
    related: [{
      role: "first-declaration",
      source: { index: 2, line: 1, column: 3 },
    }],
  });
});

check("integer-like source order and duplicate rejection coexist", () => {
  const source = `{"10":1,"x":2,"2":3,"x":4,"1":5}`;
  assert.deepEqual(duplicate_json_error(source), {
    operation: "parse-json",
    stage: "parsing",
    code: "HSON_JSON_DUPLICATE_PROPERTY",
    source: { index: 20, line: 1, column: 21 },
    path: `$["x"]`,
    related: [{
      role: "first-declaration",
      source: { index: 8, line: 1, column: 9 },
    }],
  });
});

check("all structural JSON string-ingress routes reject duplicates repeatably", () => {
  const source = ADJACENT_DUPLICATE_JSON_SOURCE;
  const before = source;
  const first = duplicate_json_error(source);
  const second = duplicate_json_error(source);
  assert.deepEqual(second, first);
  assert.deepEqual(
    (() => {
      try {
        hson.fromJson(source).toNode();
        assert.fail("expected public JSON string ingress to reject the duplicate");
      } catch (cause) {
        return read_transform_error_details(cause);
      }
    })(),
    first,
  );
  assert.equal(source, before);
});

check("late duplicate rejection settles without eager whole-source position scans", () => {
  const uniquePropertyCount = 12_000;
  const uniqueProperties = Array.from(
    { length: uniquePropertyCount },
    (_, index) => `"k${index}":${index}`,
  ).join(",");
  const source = `{"target":0,${uniqueProperties},"target":1}`;
  const duplicateIndex = source.lastIndexOf(`"target"`);
  const started = performance.now();
  const details = duplicate_json_error(source);
  const elapsed = performance.now() - started;

  assert.deepEqual(details, {
    operation: "parse-json",
    stage: "parsing",
    code: "HSON_JSON_DUPLICATE_PROPERTY",
    source: { index: duplicateIndex, line: 1, column: duplicateIndex + 1 },
    path: `$["target"]`,
    related: [{
      role: "first-declaration",
      source: { index: 1, line: 1, column: 2 },
    }],
  });
  assert.ok(elapsed < 750, `late duplicate rejection took ${elapsed.toFixed(1)}ms`);
});

process.stdout.write(`# ${checks} JSON ingress checks passed\n`);
testEvents.terminal("pass");
