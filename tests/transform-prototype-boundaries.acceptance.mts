// @hson-live-external-test
import assert from "node:assert/strict";
import { hsonTransform } from "../src/api/transform/transform.facade.ts";
import { SAFE_TRANSFORM_SOURCE, UNSAFE_TRANSFORM_SOURCE } from "../src/api/transform/transform.browser.ts";
import { hson } from "../src/hson.ts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import { read_transform_error_details } from "../src/core/errors.ts";
import { is_Node } from "../src/core/node-guards.ts";
import { own_transform_source, is_transform_snapshot } from "../src/api/transform/node-exact.ts";
import { assert_invariants, assertNewShapeQuick } from "../src/core/assert-invariants.ts";
import { ExactDocumentCarrier } from "../src/api/document/hson-document.ts";
import { encode_locus_graph_content, decode_locus_graph_content } from "../src/api/locus/locus.graph-content-codec.ts";
import { json_value_from_node, serialize_json } from "../src/api/transform/serializers/serialize-json.ts";
import type { HsonAttrs, HsonNode, JsonValue } from "../src/core/types.ts";
import type { TransformOutput } from "../src/api/transform/transform.types.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "transform.prototype-boundaries",
  title: "Own semantic storage and exact-admission work queues",
  category: "Transform",
  runtime: "node",
  tags: Object.freeze(["snapshot", "json", "binary", "prototype", "externally-discoverable"]),
});
const events = create_test_event_emitter("transform.prototype-boundaries");
let checks = 0;
async function check(name: string, run: () => void | Promise<void>): Promise<void> {
  events.case_begin(name, name);
  try { await run(); events.case_end(name, "pass"); checks++; console.log(`ok ${checks} - ${name}`); }
  catch (error) { events.case_end(name, "fail"); events.terminal("fail"); throw error; }
}

// Every case runs sequentially in this suite's own process. Preserve any prior
// prototype descriptors, including on assertion failure; never leak test hooks.
async function withInherited(
  fields: ReadonlyArray<readonly [string, PropertyDescriptor]>,
  run: () => void | Promise<void>,
  prototype: object = Object.prototype,
): Promise<void> {
  const originals = fields.map(([key]) => Object.getOwnPropertyDescriptor(prototype, key));
  try {
    for (const [key, descriptor] of fields) {
      Object.defineProperty(prototype, key, Object.assign(Object.create(null), descriptor, { configurable: true }));
    }
    await run();
  } finally {
    for (let index = fields.length - 1; index >= 0; index--) {
      const key = fields[index][0]; const original = originals[index];
      if (original) Object.defineProperty(prototype, key, Object.assign(Object.create(null), original));
      else Reflect.deleteProperty(prototype, key);
    }
  }
}
function node(tag: string, content: HsonNode["$_content"] = [], attrs?: HsonAttrs): HsonNode {
  const result: HsonNode = Object.create(null);
  result.$_tag = tag; result.$_content = content;
  if (attrs !== undefined) result.$_attrs = attrs;
  return result;
}
const record = <T extends object>(value: T): T => Object.assign(Object.create(null), value);
function documentGraph(): HsonNode {
  return node("_hson_elem", [node("p", [node("_hson_elem", [
    node("_hson_str", ["red"]),
    node("span", [node("_hson_elem", [node("_hson_str", ["child"])])], record({ title: "nested" })),
  ])], record({ id: "x", style: record({ color: "red", width: record({ value: 2, unit: "px" }) }) }))]);
}
const expectedJson = {
  _hson_elem: [{
    p: { _hson_elem: ["red", { span: { _hson_elem: ["child"] }, $_attrs: { title: "nested" } }] },
    $_attrs: { id: "x", style: { color: "red", width: { value: 2, unit: "px" } } },
  }],
};
async function observations(source: TransformOutput) {
  const hson = source.toHson().noBreak(); const json = source.toJson();
  const html = source.toHtml(); const binary = source.toBinary();
  return {
    node: source.toNode(), hson: hson.serialize(), json: json.serialize(), html: html.serialize(), bytes: binary.serialize(),
    hashes: await Promise.all([hson.sha256(), json.sha256(), html.sha256(), binary.sha256()]),
  };
}
const baseline = await observations(hsonTransform.fromNode(documentGraph()));
async function assertDocument(source: TransformOutput): Promise<void> {
  const json = source.toJson();
  const value = json.value();
  assert.deepEqual(value, expectedJson);
  assert.deepEqual(JSON.parse(json.serialize()), expectedJson);
  assert.equal(Object.getPrototypeOf(value), Object.prototype, "public JSON objects retain their prototype contract");
  const element = (value as typeof expectedJson)._hson_elem[0];
  const sidecar = Object.getOwnPropertyDescriptor(element, "$_attrs");
  assert.equal(sidecar?.enumerable, true); assert.equal(sidecar?.writable, true);
  assert.equal(Object.hasOwn(element.$_attrs, "injected"), false);
  assert.deepEqual(element.$_attrs, expectedJson._hson_elem[0].$_attrs);
  element.p._hson_elem.length = 0; element.$_attrs.id = "changed projection";
  assert.deepEqual(json.value(), expectedJson, "returned JSON values are independent");
  const first = source.toNode(); const second = source.toNode();
  assert.notEqual(first, second); assert.notEqual(first.$_content, second.$_content);
  first.$_content.length = 0;
  assert.equal(canonical_hson_graph_equal(second, baseline.node), true);
  const actual = await observations(source);
  assert.equal(canonical_hson_graph_equal(actual.node, baseline.node), true);
  assert.equal(actual.hson, baseline.hson); assert.equal(actual.json, baseline.json);
  assert.equal(actual.html, baseline.html); assert.deepEqual(actual.bytes, baseline.bytes);
  assert.deepEqual(actual.hashes, baseline.hashes);
  assert.equal(source.toHson().withOptions({ noBreak: true }).serialize(), baseline.hson);
  assert.deepEqual(source.toJson().noBreak().value(), expectedJson);
  assert.deepEqual(JSON.parse(source.toJson().noBreak().serialize()), expectedJson);
}

await check("nested JSON ignores distinct inherited attribute data after admission", async () => {
  const source = hsonTransform.fromNode(documentGraph());
  await withInherited([["$_attrs", { value: { injected: "yes" }, writable: true }]], () => assertDocument(source));
});
await check("JSON getters before construction and after terminal selection never participate", async () => {
  for (const beforeConstruction of [true, false]) {
    const raw = documentGraph();
    const source = beforeConstruction ? undefined : hsonTransform.fromNode(raw);
    const selected = source?.toJson(); const selectedHtml = source?.toHtml();
    let calls = 0;
    await withInherited([["$_attrs", {
      get() {
        calls++;
        Object.defineProperty(this, "p", { value: { corrupted: true }, configurable: true, enumerable: true });
        return { injected: "yes" };
      },
    }]], async () => {
      const admitted = source ?? hsonTransform.fromNode(raw);
      // Plain raw nodes inheriting semantic storage still reject. Internally
      // allocated projections must instead exclude it without reading it.
      if (beforeConstruction) assert.throws(() => hsonTransform.fromNode({ $_tag: "_hson_val", $_content: [-0] }));
      await assertDocument(admitted);
      if (selected) { assert.deepEqual(selected.value(), expectedJson); assert.equal(selected.serialize(), baseline.json); }
      if (selectedHtml) assert.equal(selectedHtml.serialize(), baseline.html);
      assert.equal(calls, 0);
    });
  }
});
await check("JSON sidecar installation bypasses inherited setters", async () => {
  const source = hsonTransform.fromNode(documentGraph()); const selected = source.toHson();
  let calls = 0;
  await withInherited([["$_attrs", {
    set() { calls++; Object.defineProperty(this, "p", { value: { corrupted: true }, configurable: true }); },
  }]], async () => {
    await assertDocument(source); assert.equal(selected.noBreak().serialize(), baseline.hson); assert.equal(calls, 0);
  });
});
await check("ordinary data materialization installs storage-name keys as own data", async () => {
  const data = { $_attrs: "authored attrs", $_meta: "authored meta", $_tag: "authored tag", $_content: "authored content" };
  const source = hsonTransform.fromJson(data); let calls = 0;
  await withInherited(Object.keys(data).map(key => [key, {
    get() { calls++; return "inherited"; }, set() { calls++; },
  }] as const), () => {
    const json = source.toJson(); assert.deepEqual(json.value(), data); assert.deepEqual(JSON.parse(json.serialize()), data);
    for (const key of Object.keys(data)) assert.equal(Object.hasOwn(json.value() as object, key), true);
    assert.equal(calls, 0);
  });
});
await check("contextual object-member projection also bypasses inherited key setters", async () => {
  // This existing internal relationship projection reaches the converter's
  // OBJ fallback. It is deliberately not a portable complete-value positive.
  const member = node("record", [node("_hson_obj", [
    node("$_attrs", [node("_hson_obj", [node("_hson_str", ["application"])])]),
  ])]);
  assert.throws(() => hsonTransform.fromNode(member));
  const snapshot = own_transform_source(member); let calls = 0;
  await withInherited([["$_attrs", { get() { calls++; return "inherited"; }, set() { calls++; } }]], () => {
    const expected = { record: { $_attrs: "application" } };
    assert.deepEqual(json_value_from_node(snapshot), expected);
    assert.deepEqual(JSON.parse(serialize_json(snapshot)), expected);
    const value = json_value_from_node(snapshot) as typeof expected;
    assert.equal(Object.hasOwn(value.record, "$_attrs"), true); assert.equal(calls, 0);
  });
});

const NEGATIVE_ZERO = Uint8Array.from(Buffer.from("48534f4e120000238000000000000000", "hex"));
await check("exact VAL(-0) bytes exclude inherited undefined metadata", async () => {
  await withInherited([["$_meta", { value: undefined, writable: true }]], () => {
    const source = hsonTransform.fromBinary(NEGATIVE_ZERO); const copy = source.toNode();
    assert.equal(Object.getPrototypeOf(copy), null); assert.equal(Object.hasOwn(copy, "$_meta"), false);
    assert.equal(copy.$_meta, undefined); assert.equal(Object.is(copy.$_content[0], -0), true);
    assert.deepEqual(source.toBinary().serialize(), NEGATIVE_ZERO);
    assert.equal(source.toHson().serialize(), "-0"); assert.equal(source.toJson().serialize(), "-0");
    assert.equal(Object.is(source.toJson().value(), -0), true); assert.match(source.toHtml().serialize(), /-0/);
  });
});
await check("Binary scratch nodes never invoke inherited semantic getters or setters", async () => {
  let calls = 0;
  await withInherited(["$_tag", "$_content", "$_attrs", "$_meta"].map(key => [key, {
    get(this: HsonNode) {
      calls++;
      if (key === "$_meta" && this.$_tag === "_hson_val" && !Object.isFrozen(this)) this.$_content[0] = 42;
      return undefined;
    },
    set() { calls++; },
  }] as const), async () => {
    const source = hsonTransform.fromBinary(NEGATIVE_ZERO);
    assert.equal(Object.is(source.toNode().$_content[0], -0), true);
    assert.deepEqual(source.toBinary().serialize(), NEGATIVE_ZERO);
    assert.equal(source.toHson().serialize(), "-0"); assert.equal(source.toJson().serialize(), "-0");
    assert.equal(Object.is(source.toJson().value(), -0), true); assert.match(source.toHtml().serialize(), /-0/);
    assert.equal(calls, 0);
  });
});
await check("nested Binary data and item metadata stay exact under inherited storage", async () => {
  const original = hsonTransform.fromJson([{ a: -0, nested: ["x", true] }]);
  const bytes = original.toBinary().serialize(); const expected = hsonTransform.fromBinary(bytes).toNode();
  let calls = 0;
  await withInherited(["$_meta", "$_attrs", "index"].map(key => [key, {
    get() { calls++; return "injected"; }, set() { calls++; },
  }] as const), () => {
    const decoded = hsonTransform.fromBinary(bytes); const copy = decoded.toNode();
    assert.equal(canonical_hson_graph_equal(copy, expected), true); assert.deepEqual(decoded.toBinary().serialize(), bytes);
    const value = decoded.toJson().value() as Array<{ a: number; nested: JsonValue[] }>;
    assert.equal(Object.is(value[0].a, -0), true); assert.deepEqual(value[0].nested, ["x", true]);
    const item = copy.$_content[0] as HsonNode;
    assert.equal(Object.getPrototypeOf(item.$_meta), null); assert.equal(item.$_meta?.index, "0");
    assert.equal(calls, 0);
  });
});
await check("Binary typed style leaves preserve all unit presence states and signed zero", async () => {
  const leaves = record({ absent: record({ value: -0 }), undefined: record({ value: -0, unit: undefined }), pixels: record({ value: -0, unit: "px" }) });
  const input = node("_hson_elem", [node("p", [], record({ style: leaves }))]);
  const original = hsonTransform.fromNode(input); const bytes = original.toBinary().serialize(); let calls = 0;
  await withInherited(["unit", "value", "$_meta", "$_attrs"].map(key => [key, {
    get() { calls++; return "injected"; }, set() { calls++; },
  }] as const), () => {
    const decoded = hsonTransform.fromBinary(bytes); const copy = decoded.toNode();
    assert.equal(canonical_hson_graph_equal(copy, original.toNode()), true); assert.deepEqual(decoded.toBinary().serialize(), bytes);
    const branch = copy.$_content[0] as HsonNode;
    const style = branch.$_attrs?.style as typeof leaves;
    assert.equal(Object.getPrototypeOf(style), null);
    for (const leaf of Object.values(style)) {
      assert.equal(Object.getPrototypeOf(leaf), null); assert.equal(Object.is(leaf.value, -0), true);
    }
    assert.equal(Object.hasOwn(style.absent, "unit"), false);
    assert.equal(Object.hasOwn(style.undefined, "unit"), true); assert.equal(style.undefined.unit, undefined);
    assert.equal(Object.hasOwn(style.pixels, "unit"), true); assert.equal(style.pixels.unit, "px");
    assert.equal(calls, 0);
  });
});
await check("prototype-safe decode retains canonical rejection and error categories", () => {
  const itemZero = "16000100000001000000050069006e0064006500780000000100300000000112000020";
  const itemOne = "16000100000001000000050069006e0064006500780000000100310000000112000020";
  const fixtures: Array<readonly [string, string, string]> = [
    ["48534f4e15000000000001110000000000010078", "HSON_CANONICAL_INVARIANT_VIOLATION", "source-admission"], // ELEM[STR]
    ["48534f4e1300000000000112000020", "HSON_CANONICAL_INVARIANT_VIOLATION", "source-admission"], // OBJ[VAL]
    ["48534f4e10000000010070000000000000", "HSON_CANONICAL_INVARIANT_VIOLATION", "source-admission"], // p[]
    ["48534f4e11000100000000000000010078", "HSON_EMPTY_METADATA", "source-admission"],
    ["48534f4e150000000000011000000001007001000000010000000200690064233ff00000000000000000000000", "HSON_CANONICAL_INVARIANT_VIOLATION", "source-admission"], // typed ordinary id
    ["48534f4e14000000000002" + itemOne + itemZero, "HSON_CANONICAL_INVARIANT_VIOLATION", "source-admission"],
    ["48534f4e15000000000001100000000100700001000000010000000400710075006900640000000900300030003000300030003000300030003100000000", "PORTABLE_RUNTIME_QUID_FORBIDDEN", "source-admission"],
    ["00534f4e12000020", "HSON_BINARY_WIRE_INVALID", "source-decoding"],
  ];
  for (const [hex, code, stage] of fixtures) {
    assert.throws(() => hsonTransform.fromBinary(Uint8Array.from(Buffer.from(hex, "hex"))), (error: unknown) => {
      const details = read_transform_error_details(error);
      assert.equal(details?.operation, "fromBinary"); assert.equal(details?.code, code); assert.equal(details?.stage, stage);
      assert.equal(typeof details?.path, "string"); return true;
    });
  }
  for (const [options, code, stage] of [
    [{ maxBytes: 1 }, "HSON_BINARY_CAPACITY_EXCEEDED", "source-decoding"],
    [{ maxGraphNodes: 1 }, "HSON_BINARY_CAPACITY_EXCEEDED", "source-decoding"],
    [{ maxGraphDepth: 1 }, "HSON_BINARY_CAPACITY_EXCEEDED", "source-decoding"],
    [{ maxBytes: 0 }, "HSON_BINARY_OPTIONS_INVALID", "source-options"],
  ] as const) {
    assert.throws(() => hsonTransform.fromBinary(baseline.bytes, options), (error: unknown) => {
      const details = read_transform_error_details(error);
      assert.equal(details?.operation, "fromBinary"); assert.equal(details?.code, code); assert.equal(details?.stage, stage); return true;
    });
  }
});

// Forward unrelated bookkeeping writes normally. Count values identifying the
// semantic storage under attack. Assertions run after restoration because Node's
// assertion implementation also constructs internal arrays of compared values.
async function withIndexSetter<T>(
  prototype: object,
  index: number,
  matches: (value: unknown) => boolean,
  corrupt: (value: unknown) => unknown,
  run: () => T | Promise<T>,
): Promise<T> {
  let calls = 0;
  let result!: T;
  await withInherited([[String(index), { set(value: unknown) {
    if (matches(value)) { calls++; value = corrupt(value); }
    Object.defineProperty(this, index, { value, enumerable: true, writable: true, configurable: true });
  } }]], async () => { result = await run(); }, prototype);
  assert.equal(calls, 0, "semantic index installation must bypass inherited setters");
  return result;
}
function assertOwnArray(value: unknown): asserts value is unknown[] {
  assert.ok(Array.isArray(value));
  assert.equal(Object.getPrototypeOf(value), Array.prototype);
  assert.equal(Object.isFrozen(value), false);
  assert.deepEqual(Object.getOwnPropertyDescriptor(value, "length"), {
    value: value.length, enumerable: false, writable: true, configurable: false,
  });
  assert.equal(Object.keys(value).length, value.length);
  for (let index = 0; index < value.length; index++) {
    assert.deepEqual(Object.getOwnPropertyDescriptor(value, index), {
      value: value[index], enumerable: true, writable: true, configurable: true,
    });
  }
}
function assertOwnArrays(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  if (Array.isArray(value)) assertOwnArray(value);
  for (const child of Object.values(value)) assertOwnArrays(child);
}
const indexTargets = [[Object.prototype, 0], [Array.prototype, 0], [Object.prototype, 1], [Array.prototype, 1]] as const;

await check("reviewer JSON negative-zero reproduction stays exact after selection", async () => {
  for (const prototype of [Object.prototype, Array.prototype]) {
    const source = hsonTransform.fromJson([-0]); const json = source.toJson();
    const actual = await withIndexSetter(prototype, 0, value => Object.is(value, -0), () => 42, () => ({
      first: json.value(), second: json.value(), text: json.serialize(), fresh: source.toJson().value(),
    }));
    assert.deepEqual(actual.first, [-0]); assert.deepEqual(actual.second, [-0]); assert.deepEqual(actual.fresh, [-0]);
    assert.deepEqual(JSON.parse(actual.text), [-0]); assertOwnArray(actual.first);
  }
});
await check("JSON numeric indices preserve signed zero before and after builder selection", async () => {
  for (const [prototype, index] of indexTargets) for (const selectedFirst of [false, true]) {
    const input = [-0, -0, { nested: [-0, "keep"] }];
    const source = hsonTransform.fromJson(input); const expected = await observations(source);
    const selected = selectedFirst ? source.toJson() : undefined;
    const actual = await withIndexSetter(prototype, index, value => Object.is(value, -0), () => 42, async () => {
      input[0] = 42; source.toNode().$_content.length = 0;
      const json = selected ?? source.toJson();
      return {
        values: Array.from({ length: 3 }, () => json.value()), json: json.serialize(),
        terminals: await observations(source), options: source.toHson().withOptions({ noBreak: true }).serialize(),
      };
    });
    for (const value of actual.values) {
      assert.deepEqual(value, [-0, -0, { nested: [-0, "keep"] }]);
      assert.deepEqual(JSON.parse(actual.json), value); assertOwnArray(value); assert.equal(value.length, 3);
      assert.equal(Object.is(value[index], -0), true);
      const nested = value[2] as { nested: unknown[] }; assertOwnArray(nested.nested);
      assertOwnArrays(value);
    }
    assert.equal(canonical_hson_graph_equal(actual.terminals.node, expected.node), true);
    assert.deepEqual(actual.terminals, expected); assert.equal(actual.options, expected.hson);
    const observed = actual.values[0]; assertOwnArray(observed); observed[0] = "mutable"; observed.push("appended");
    assert.equal(observed.length, 4); assert.notEqual(observed, actual.values[1]);
    assert.deepEqual(actual.values[1], [-0, -0, { nested: [-0, "keep"] }]);
    assert.deepEqual(source.toJson().value(), [-0, -0, { nested: [-0, "keep"] }]);
  }
});
await check("nested ELEM arrays install projected branches as own indices", async () => {
  for (const [prototype, index] of indexTargets) {
    const source = hsonTransform.fromNode(documentGraph()); const selected = source.toJson();
    const actual = await withIndexSetter(prototype, index,
      value => typeof value === "object" && value !== null && (Object.hasOwn(value, "p") || Object.hasOwn(value, "span")),
      () => ({ corrupted: true }), async () => ({
        terminals: await observations(source), value: selected.value(), json: selected.serialize(),
        repeated: selected.value(),
      }));
    assert.deepEqual(actual.terminals, baseline); assert.deepEqual(actual.value, expectedJson);
    assert.deepEqual(actual.repeated, expectedJson); assert.equal(actual.json, baseline.json);
    const value = actual.value as typeof expectedJson;
    assertOwnArray(value._hson_elem); assert.equal(value._hson_elem.length, 1);
    assertOwnArray(value._hson_elem[0].p._hson_elem); assert.equal(value._hson_elem[0].p._hson_elem.length, 2);
    assertOwnArrays(value);
  }
});
await check("contextual ARR fallback uses own numeric projection storage", async () => {
  const member = node("record", [node("_hson_arr", [0, 1].map(index => {
    const item = node("_hson_ii", [node("_hson_val", [-0])]); item.$_meta = record({ index: String(index) }); return item;
  }))]);
  assert.throws(() => hsonTransform.fromNode(member));
  const snapshot = own_transform_source(member);
  for (const [prototype, index] of indexTargets) {
    const actual = await withIndexSetter(prototype, index, value => Object.is(value, -0), () => 42, () => ({
      value: json_value_from_node(snapshot), json: serialize_json(snapshot),
    }));
    assert.deepEqual(actual.value, { record: [-0, -0] });
    const value = actual.value as { record: JsonValue[] }; assertOwnArray(value.record);
    assert.deepEqual(JSON.parse(actual.json), value);
  }
});
await check("ordered JSON sidecar and admission entry lists bypass numeric setters", async () => {
  const source = hsonTransform.fromNode(documentGraph());
  const data = hsonTransform.fromJson({ a: -0, b: [-0, "keep"] });
  for (const [prototype, index] of indexTargets) {
    const actual = await withIndexSetter(prototype, index, value => Array.isArray(value) && value.length === 2
      && ["$_attrs", "id", "style", "a", "b"].includes(value[0]), () => ["corrupted", 42], async () => ({
        document: await observations(source), value: data.toJson().value(), json: data.toJson().serialize(),
      }));
    assert.deepEqual(actual.document, baseline); assert.deepEqual(actual.value, { a: -0, b: [-0, "keep"] });
    assert.deepEqual(JSON.parse(actual.json), actual.value);
  }
});

await check("recursive ordered-carrier admission and outputs bypass inherited numeric setters", async () => {
  const input = { a: -0, b: { a: -0, b: [-0, "keep"] } };
  const expected = await observations(hsonTransform.fromJson(input));
  for (const [prototype, index] of indexTargets) {
    const actual = await withIndexSetter(prototype, index,
      value => Array.isArray(value) && value.length === 2 && (value[0] === "a" || value[0] === "b"),
      () => ["corrupted", 42], async () => {
        const source = hsonTransform.fromJson(input);
        return { terminals: await observations(source), value: source.toJson().value(), repeated: source.toJson().value() };
      });
    assert.deepEqual(actual.terminals, expected);
    assert.deepEqual(actual.value, input); assert.deepEqual(actual.repeated, input);
    assert.deepEqual(JSON.parse(actual.terminals.json), input);
    assertOwnArrays(actual.value);
  }
});

await check("projected-value admission descriptor arrays bypass inherited numeric setters", async () => {
  const source = hsonTransform.fromJson([-0, -0, ["keep", true]]); const selected = source.toJson();
  for (const [prototype, index] of indexTargets) {
    const actual = await withIndexSetter(prototype, index,
      value => typeof value === "object" && value !== null && Object.hasOwn(value, "index") && Object.hasOwn(value, "descriptor"),
      () => ({ index: 42, descriptor: { value: 42 } }), () => ({ value: selected.value(), json: selected.serialize() }));
    assert.deepEqual(actual.value, [-0, -0, ["keep", true]]);
    assert.deepEqual(JSON.parse(actual.json), actual.value); assertOwnArrays(actual.value);
  }
});

const INDEXED_NEGATIVE_ZERO = Uint8Array.from(Buffer.from(
  "48534f4e1400000000000116000100000001000000050069006e00640065007800000001003000000001120000238000000000000000", "hex"));
await check("Binary exact indexed negative zero excludes inherited scratch-array setters", async () => {
  const expected = hsonTransform.fromBinary(INDEXED_NEGATIVE_ZERO).toNode();
  for (const prototype of [Object.prototype, Array.prototype]) {
    const actual = await withIndexSetter(prototype, 0,
      value => typeof value === "object" && value !== null && Object.getOwnPropertyDescriptor(value, "$_tag")?.value === "_hson_ii",
      value => {
        const content: HsonNode[] = Object.getOwnPropertyDescriptor(value, "$_content")!.value;
        content[0].$_content[0] = 42; return value;
      }, () => {
        const decoded = hsonTransform.fromBinary(INDEXED_NEGATIVE_ZERO);
        return { copy: decoded.toNode(), bytes: decoded.toBinary().serialize(), value: decoded.toJson().value() };
      });
    assert.equal(canonical_hson_graph_equal(actual.copy, expected), true);
    assert.deepEqual(actual.bytes, INDEXED_NEGATIVE_ZERO); assert.deepEqual(actual.value, [-0]);
    assertOwnArray(actual.copy.$_content); assert.equal(actual.copy.$_content.length, 1);
    const item = actual.copy.$_content[0] as HsonNode;
    assert.equal(item.$_meta?.index, "0"); assertOwnArray(item.$_content);
    const leaf = item.$_content[0] as HsonNode; assertOwnArray(leaf.$_content);
    assert.equal(Object.is(leaf.$_content[0], -0), true);
    assertOwnArrays(actual.copy); assertOwnArrays(actual.value);
  }
});
await check("Binary later indices and nested content preserve graph order and UTF-16", async () => {
  const input = [-0, -0, { text: "\u0000\ud800🎯", nested: [-0, true, "keep"] }];
  const bytes = hsonTransform.fromJson(input).toBinary().serialize();
  const expected = hsonTransform.fromBinary(bytes).toNode();
  for (const [prototype, index] of indexTargets) {
    const actual = await withIndexSetter(prototype, index,
      value => typeof value === "object" && value !== null && Object.getOwnPropertyDescriptor(value, "$_tag")?.value === "_hson_ii",
      () => node("_hson_val", [42]), () => {
        const decoded = hsonTransform.fromBinary(bytes);
        return { copy: decoded.toNode(), bytes: decoded.toBinary().serialize(), value: decoded.toJson().value(), json: decoded.toJson().serialize() };
      });
    assert.equal(canonical_hson_graph_equal(actual.copy, expected), true); assert.deepEqual(actual.bytes, bytes);
    assert.deepEqual(actual.value, input); assert.deepEqual(JSON.parse(actual.json), input);
    assertOwnArray(actual.copy.$_content); assert.equal(actual.copy.$_content.length, 3);
    assertOwnArrays(actual.copy); assertOwnArrays(actual.value);
    for (let position = 0; position < actual.copy.$_content.length; position++) {
      const item = actual.copy.$_content[position] as HsonNode;
      assert.equal(item.$_meta?.index, String(position)); assertOwnArray(item.$_content);
    }
  }
});
await check("Binary UTF-16 chunks and canonical byte arrays install own indices", async () => {
  for (const [prototype, index] of indexTargets) {
    // 'index' supplies i/n at scratch positions 0/1; HSON supplies H/S at
    // canonical byte positions 0/1. Chunk reset must also reinstall own keys.
    const source = hsonTransform.fromJson(["in" + "x".repeat(8192)]);
    const bytes = source.toBinary().serialize();
    const actual = await withIndexSetter(prototype, index,
      value => value === 120 || value === (index === 0 ? 105 : 110) || value === (index === 0 ? 72 : 83), () => 42, () => {
        const decoded = hsonTransform.fromBinary(bytes);
        return { value: decoded.toJson().value(), bytes: decoded.toBinary().serialize() };
      });
    assert.deepEqual(actual.value, ["in" + "x".repeat(8192)]); assert.deepEqual(actual.bytes, bytes);
  }
});

function ownField(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
}
function scalarZeroJob(value: unknown): boolean {
  return ownField(value, "kind") === "enter" && ownField(value, "storage") === "scalar"
    && Object.is(ownField(value, "source"), -0);
}
function dataValJob(value: unknown): boolean {
  return ownField(value, "role") === "data" && ownField(ownField(value, "node"), "$_tag") === "_hson_val";
}
function captureLeaveJob(value: unknown): boolean {
  return ownField(value, "kind") === "leave" && typeof ownField(value, "source") === "object"
    && ownField(value, "source") !== null;
}
function arrayNode(...values: HsonNode[]): HsonNode {
  return node("_hson_arr", values.map((value, index) => {
    const item = node("_hson_ii", [value]); item.$_meta = record({ index: String(index) }); return item;
  }));
}
function attemptNode(factory: { fromNode(input: HsonNode): TransformOutput }, input: HsonNode) {
  try { return { output: factory.fromNode(input), error: undefined }; }
  catch (error) { return { output: undefined, error }; }
}
function assertAdmissionError(error: unknown, path: string, operation = "fromNode"): void {
  const details = read_transform_error_details(error);
  assert.equal(details?.code, "HSON_CANONICAL_INVARIANT_VIOLATION");
  assert.equal(details?.stage, "source-admission"); assert.equal(details?.operation, operation);
  assert.equal(details?.path, path);
}
const invalidValPath = '$["$_content"][0]["$_content"][0]["$_content"][0]';
const nodeFactories = [hsonTransform, SAFE_TRANSFORM_SOURCE, UNSAFE_TRANSFORM_SOURCE, hson] as const;

await check("capture scalar enter jobs bypass both inherited numeric setter locations", async () => {
  const input = arrayNode(node("_hson_val", [-0]), node("_hson_val", [-0]));
  const source = hsonTransform.fromNode(input); const expected = source.toNode();
  for (const [prototype, index] of indexTargets) {
    const actual = await withIndexSetter(prototype, index, scalarZeroJob, job => {
      Object.defineProperty(job, "source", { value: 42 }); return job;
    }, () => ({ first: source.toNode(), second: source.toNode(), value: source.toJson().value() }));
    assert.equal(canonical_hson_graph_equal(actual.first, expected), true);
    assert.equal(canonical_hson_graph_equal(actual.second, expected), true);
    assert.deepEqual(actual.value, [-0, -0]); assertOwnArrays(actual.first);
    assert.notEqual(actual.first, actual.second); assert.notEqual(actual.first.$_content, actual.second.$_content);
    const item = actual.first.$_content[0] as HsonNode;
    (item.$_content[0] as HsonNode).$_content[0] = 42;
    assert.equal(canonical_hson_graph_equal(actual.second, expected), true);
    assert.equal(canonical_hson_graph_equal(source.toNode(), expected), true);
  }
});
await check("capture scalar child index 1 stays protected before graph qualification", async () => {
  // A candidate is captured before cardinality qualification. Two scalar slots
  // put a real enter/scalar/-0 child job at index 1 without changing the grammar.
  const invalid = arrayNode(node("_hson_val", [-0, -0]));
  for (const prototype of [Object.prototype, Array.prototype]) {
    const actual = await withIndexSetter(prototype, 1, scalarZeroJob, job => {
      Object.defineProperty(job, "source", { value: 42 }); return job;
    }, () => attemptNode(hsonTransform, invalid));
    assert.equal(actual.output, undefined);
    assertAdmissionError(actual.error, '$["$_content"][0]["$_content"][0]["$_content"]');
    const leaf = (invalid.$_content[0] as HsonNode).$_content[0] as HsonNode;
    assert.deepEqual(leaf.$_content, [-0, -0]);
  }
});
await check("capture nested node and content child jobs cannot replace graph sources", async () => {
  const input = arrayNode(node("_hson_val", [-0]), arrayNode(node("_hson_val", [-0]), node("_hson_str", ["keep"])));
  const source = hsonTransform.fromNode(input); const expected = source.toNode();
  const replacementNode = arrayNode(node("_hson_val", [42])); const replacementContent = [node("_hson_val", [42])];
  for (const storage of ["node", "content"]) {
    for (const [prototype, index] of indexTargets) {
      const actual = await withIndexSetter(prototype, index, job => ownField(job, "kind") === "enter"
        && ownField(job, "storage") === storage && (storage === "content" || ownField(job, "key") !== "value"), job => {
          Object.defineProperty(job, "source", { value: storage === "content" ? replacementContent : replacementNode });
          return job;
        }, () => ({ copy: source.toNode(), value: source.toJson().value() }));
      assert.equal(canonical_hson_graph_equal(actual.copy, expected), true);
      assert.deepEqual(actual.value, [-0, [-0, "keep"]]); assertOwnArrays(actual.copy); assertOwnArrays(actual.value);
    }
  }
});
await check("capture leave jobs never expose private snapshot references", async () => {
  const source = hsonTransform.fromNode(arrayNode(node("_hson_val", [-0]), arrayNode(node("_hson_val", [-0]))));
  const expected = source.toNode();
  for (const [prototype, index] of indexTargets) {
    const exposed = new Set<unknown>();
    const actual = await withIndexSetter(prototype, index, captureLeaveJob, job => {
      exposed.add(ownField(job, "source")); return job;
    }, () => ({ copy: source.toNode(), value: source.toJson().value() }));
    assert.equal(exposed.size, 0); assert.equal(canonical_hson_graph_equal(actual.copy, expected), true);
    assert.deepEqual(actual.value, [-0, [-0]]);
    actual.copy.$_content.length = 0;
    assert.equal(canonical_hson_graph_equal(source.toNode(), expected), true);
  }
});
await check("qualification jobs cannot substitute a valid VAL for the actual invalid graph", async () => {
  for (const [prototype, index] of indexTargets) {
    // With two items, the first VAL's data job is queued at index 1 while the
    // second item's job remains below it. The single-item reviewer case uses 0.
    const invalid = index === 0 ? arrayNode(node("_hson_val", ["invalid"]))
      : arrayNode(node("_hson_val", ["invalid"]), node("_hson_val", [-0]));
    const valid = index === 0 ? arrayNode(node("_hson_val", [-0]))
      : arrayNode(node("_hson_val", [-0]), node("_hson_val", [-0]));
    const actual = await withIndexSetter(prototype, index, dataValJob, job => {
      Object.defineProperty(job, "node", { value: node("_hson_val", [42]) });
      Object.defineProperty(job, "role", { value: "complete" }); return job;
    }, () => nodeFactories.map(factory => ({ rejected: attemptNode(factory, invalid), admitted: factory.fromNode(valid) })));
    for (const result of actual) {
      assert.equal(result.rejected.output, undefined, "no Transform may be published");
      assertAdmissionError(result.rejected.error, invalidValPath);
      assert.equal(canonical_hson_graph_equal(result.admitted.toNode(), valid), true);
      assert.deepEqual(result.admitted.toJson().value(), index === 0 ? [-0] : [-0, -0]);
    }
  }
});
await check("qualification item jobs retain their physical-index evidence", async () => {
  for (const [prototype, index] of indexTargets) {
    const invalid = index === 0 ? arrayNode(node("_hson_val", [-0]))
      : arrayNode(node("_hson_val", [-0]), node("_hson_val", [-0]));
    (invalid.$_content[0] as HsonNode).$_meta!.index = "1";
    const actual = await withIndexSetter(prototype, index, job => ownField(job, "role") === "item", job => {
      Object.defineProperty(job, "index", { value: 1 });
      return job;
    }, () => attemptNode(hsonTransform, invalid));
    assert.equal(actual.output, undefined);
    assertAdmissionError(actual.error, '$["$_content"][0]["$_meta"]["index"]');
  }
});
await check("exact-admission diagnostic paths bypass inherited numeric setters", async () => {
  for (const [prototype, index] of indexTargets) {
    const invalid = arrayNode(node("_hson_val", ["invalid"]));
    const actual = await withIndexSetter(prototype, index, part => part === 0 || part === "$_content", () => "corrupted",
      () => attemptNode(hsonTransform, invalid));
    assert.equal(actual.output, undefined); assertAdmissionError(actual.error, invalidValPath);
  }
});
await check("capture and verification attacks preserve the two-negative-zero terminal matrix", async () => {
  for (const input of [[-0, -0], [-0, [-0, -0], { nested: [-0, "keep"] }]]) {
    for (const [prototype, index] of indexTargets) {
      const source = hsonTransform.fromJson(input); const expected = await observations(source);
      const selected = { json: source.toJson(), hson: source.toHson().noBreak(), html: source.toHtml(), binary: source.toBinary() };
      const expectedOptions = source.toJson().noBreak().serialize();
      const actual = await withIndexSetter(prototype, index,
        job => (ownField(job, "kind") === "enter" && typeof ownField(job, "storage") === "string")
          || captureLeaveJob(job) || typeof ownField(job, "role") === "string", job => {
          if (scalarZeroJob(job)) Object.defineProperty(job, "source", { value: 42 });
          if (dataValJob(job)) Object.defineProperty(job, "node", { value: node("_hson_val", [42]) });
          return job;
        }, async () => ({
          fresh: await observations(source), first: selected.json.value(), second: selected.json.value(),
          json: selected.json.serialize(), hson: selected.hson.serialize(), html: selected.html.serialize(), bytes: selected.binary.serialize(),
          hashes: await Promise.all([selected.hson.sha256(), selected.json.sha256(), selected.html.sha256(), selected.binary.sha256()]),
          options: source.toJson().withOptions({ noBreak: true }).serialize(), hsonOptions: source.toHson().withOptions({ noBreak: true }).serialize(),
        }));
      assert.deepEqual(actual.fresh, expected); assert.deepEqual(actual.first, input); assert.deepEqual(actual.second, input);
      assert.deepEqual(JSON.parse(actual.json), input); assert.equal(actual.hson, expected.hson); assert.equal(actual.html, expected.html);
      assert.deepEqual(actual.bytes, expected.bytes); assert.deepEqual(actual.hashes, expected.hashes);
      assert.equal(actual.options, expectedOptions); assert.equal(actual.hsonOptions, expected.hson);
      assertOwnArrays(actual.first); assertOwnArrays(actual.fresh.node);
      assert.notEqual(actual.first, actual.second); (actual.first as JsonValue[])[0] = 42;
      input[0] = 42;
      assert.deepEqual(selected.json.value(), actual.second);
      assert.equal(canonical_hson_graph_equal(source.toNode(), expected.node), true);
      input[0] = -0;
    }
  }
});
await check("Binary admission cannot rewrite decoded values through capture or verification jobs", async () => {
  const expected = hsonTransform.fromBinary(INDEXED_NEGATIVE_ZERO).toNode();
  for (const [prototype, index] of indexTargets) {
    const actual = await withIndexSetter(prototype, index, job => scalarZeroJob(job) || dataValJob(job) || captureLeaveJob(job), job => {
      if (scalarZeroJob(job)) Object.defineProperty(job, "source", { value: 42 });
      if (dataValJob(job)) Object.defineProperty(job, "node", { value: node("_hson_val", [42]) });
      return job;
    }, () => {
      const source = hsonTransform.fromBinary(INDEXED_NEGATIVE_ZERO);
      const json = source.toJson();
      let invalidGraph: unknown; let invalidWire: unknown;
      try { hsonTransform.fromBinary(Uint8Array.from(Buffer.from("48534f4e1300000000000112000020", "hex"))); } catch (error) { invalidGraph = error; }
      try { hsonTransform.fromBinary(Uint8Array.from(Buffer.from("00534f4e12000020", "hex"))); } catch (error) { invalidWire = error; }
      return { source, copy: source.toNode(), repeated: source.toNode(), bytes: source.toBinary().serialize(),
        value: json.value(), text: json.serialize(), invalidGraph, invalidWire };
    });
    assert.equal(canonical_hson_graph_equal(actual.copy, expected), true);
    assert.equal(canonical_hson_graph_equal(actual.repeated, expected), true);
    assert.deepEqual(actual.bytes, INDEXED_NEGATIVE_ZERO); assert.deepEqual(actual.value, [-0]); assert.equal(actual.text, "[\n  -0\n]");
    assertOwnArrays(actual.copy); assertOwnArrays(actual.value);
    assertAdmissionError(actual.invalidGraph, '$', "fromBinary");
    const wireDetails = read_transform_error_details(actual.invalidWire);
    assert.equal(wireDetails?.code, "HSON_BINARY_WIRE_INVALID"); assert.equal(wireDetails?.stage, "source-decoding");
    assert.equal(wireDetails?.operation, "fromBinary");
    actual.copy.$_content.length = 0;
    assert.equal(canonical_hson_graph_equal(actual.source.toNode(), expected), true);
    assert.deepEqual(actual.source.toBinary().serialize(), INDEXED_NEGATIVE_ZERO);
  }
});

function validationFrame(value: unknown): boolean {
  const kind = ownField(value, "kind"); const graph = ownField(value, "value");
  return (kind === "enter" || kind === "leave") && typeof graph === "object" && graph !== null;
}
function errorObservation(run: () => void) {
  try { run(); return { accepted: true, error: undefined }; }
  catch (error) {
    return { accepted: false, error: { name: error instanceof Error ? error.name : "unknown",
      message: error instanceof Error ? error.message : String(error), details: read_transform_error_details(error) } };
  }
}

await check("HTML validator leave frames never expose the admitted frozen VAL snapshot", async () => {
  for (const [prototype, index] of indexTargets) {
    const input = node("_hson_val", [-0]); const source = hsonTransform.fromNode(input);
    const copy = source.toNode(); const selected = source.toHtml(); const expected = selected.serialize();
    const leaked = new Set<unknown>();
    const actual = await withIndexSetter(prototype, index,
      frame => validationFrame(frame) && ownField(frame, "kind") === "leave" && Object.isFrozen(ownField(frame, "value")), frame => {
        leaked.add(ownField(frame, "value")); return frame;
      }, () => ({ html: selected.serialize(), repeated: selected.serialize(), fresh: source.toHtml().serialize(),
        value: source.toJson().value(), copy: source.toNode() }));
    assert.equal(leaked.size, 0); assert.equal([...leaked].some(is_transform_snapshot), false);
    assert.equal(is_transform_snapshot(input), false); assert.equal(is_transform_snapshot(copy), false);
    assert.equal(actual.html, expected); assert.equal(actual.repeated, expected); assert.equal(actual.fresh, expected);
    assert.match(actual.html, /<_hson_val>-0<\/_hson_val>/); assert.equal(Object.is(actual.value, -0), true);
    assert.equal(Object.is(actual.copy.$_content[0], -0), true); assert.notEqual(actual.copy, input); assert.notEqual(actual.copy, copy);
  }
});
await check("all generic terminal validators protect nested frame references and semantic results", async () => {
  const sources = [hsonTransform.fromNode(arrayNode(node("_hson_val", [-0]), arrayNode(node("_hson_val", [-0]), node("_hson_str", ["keep"])))),
    hsonTransform.fromNode(documentGraph())];
  for (const source of sources) {
    const expected = await observations(source); const expectedValue = source.toJson().value();
    for (const [prototype, index] of indexTargets) {
      const selected = { hson: source.toHson().noBreak(), html: source.toHtml(), json: source.toJson(), binary: source.toBinary() };
      const leaked = new Set<unknown>();
      const actual = await withIndexSetter(prototype, index, validationFrame, frame => {
        leaked.add(ownField(frame, "value"));
        Object.defineProperty(frame, "value", { value: node("_hson_val", [42]) }); return frame;
      }, async () => ({ fresh: await observations(source), value: selected.json.value(), repeated: selected.json.value(),
        hson: selected.hson.serialize(), html: selected.html.serialize(), json: selected.json.serialize(), bytes: selected.binary.serialize(),
        hashes: await Promise.all([selected.hson.sha256(), selected.json.sha256(), selected.html.sha256(), selected.binary.sha256()]),
        options: source.toHson().withOptions({ noBreak: true }).serialize() }));
      assert.equal(leaked.size, 0); assert.deepEqual(actual.fresh, expected);
      assert.deepEqual(actual.value, expectedValue); assert.deepEqual(actual.repeated, expectedValue);
      assert.deepEqual(JSON.parse(actual.json), expectedValue); assert.equal(actual.hson, expected.hson); assert.equal(actual.html, expected.html);
      assert.deepEqual(actual.bytes, expected.bytes); assert.deepEqual(actual.hashes, expected.hashes); assert.equal(actual.options, expected.hson);
      assertOwnArrays(actual.value); assertOwnArrays(actual.fresh.node);
      actual.fresh.node.$_content.length = 0;
      assert.equal(canonical_hson_graph_equal(source.toNode(), expected.node), true);
    }
  }
});
await check("shared validator frame substitution cannot hide malformed children or change first-error order", async () => {
  const first = node("first"); const second = node("second");
  Object.defineProperty(first, "$_content", { value: 42, enumerable: true, writable: true, configurable: true });
  Object.defineProperty(second, "$_content", { value: 43, enumerable: true, writable: true, configurable: true });
  const invalid = node("_hson_elem", [first, second]);
  const expected = errorObservation(() => assert_invariants(invalid, "frame-substitution"));
  assert.equal(expected.accepted, false); assert.match(expected.error!.message, /node <first> must carry an array/);
  assert.match(expected.error!.message, /frame-substitution/);
  const valid = documentGraph();
  for (const [prototype, index] of indexTargets) {
    const actual = await withIndexSetter(prototype, index, validationFrame, frame => {
      Object.defineProperty(frame, "value", { value: node("_hson_val", [42]) });
      Object.defineProperty(frame, "path", { value: "/substituted" }); return frame;
    }, () => ({ invalid: errorObservation(() => assert_invariants(invalid, "frame-substitution")),
      valid: errorObservation(() => assert_invariants(valid, "frame-substitution")) }));
    assert.deepEqual(actual.invalid, expected); assert.equal(actual.valid.accepted, true);
  }
});
await check("shared validator diagnostics retain exact error codes paths and order under numeric setters", async () => {
  const invalid = node("_hson_elem", [node("_hson_val", [1]), node("_hson_val", [2])]);
  const optional = node("_hson_val", [-0]); optional.$_meta = record({});
  const crossing = node("_hson_obj", [node("_hson_elem", [node("p")])]);
  const cycle = node("_hson_root"); cycle.$_content = [cycle];
  const shared = node("p"); const validSharing = node("_hson_elem", [shared, shared]);
  const run = () => ({
    first: errorObservation(() => assert_invariants(invalid, "diagnostics", { throwOnFirst: true })),
    all: errorObservation(() => assert_invariants(invalid, "diagnostics", { throwOnFirst: false })),
    optional: errorObservation(() => assert_invariants(optional, "diagnostics")),
    crossing: errorObservation(() => assert_invariants(crossing, "diagnostics")),
    cycle: errorObservation(() => assertNewShapeQuick(cycle, "diagnostics")),
    sharing: errorObservation(() => assert_invariants(validSharing, "diagnostics")),
  });
  const expected = run();
  assert.equal(expected.optional.error?.details?.code, "HSON_EMPTY_METADATA");
  assert.equal(expected.optional.error?.details?.stage, "canonical-invariant-admission");
  assert.equal(expected.optional.error?.details?.path, "/_hson_val/$_meta");
  assert.equal(expected.crossing.error?.details?.code, "OBJ004");
  assert.match(expected.cycle.error!.message, /cycle detected.*reference returns to/); assert.equal(expected.sharing.accepted, true);
  assert.ok(expected.first.error!.message.indexOf("[0]") >= 0);
  assert.ok(expected.all.error!.message.indexOf("[0]") < expected.all.error!.message.indexOf("[1]"));
  for (const [prototype, index] of indexTargets) {
    const actual = await withIndexSetter(prototype, index,
      value => validationFrame(value) || (typeof ownField(value, "message") === "string" && !(value instanceof Error)), value => {
        if (validationFrame(value)) Object.defineProperty(value, "value", { value: node("_hson_val", [42]) });
        else Object.defineProperty(value, "message", { value: "injected diagnostic" });
        return value;
      }, run);
    assert.deepEqual(actual, expected);
  }
});
await check("Document and runtime graph-codec validator callers retain ROOT identity and ordering", async () => {
  const input = node("_hson_root", [node("main", [node("_hson_elem", [node("span"), node("_hson_str", ["tail"])])]), node("aside")]);
  const expectedDocument = ExactDocumentCarrier.fromNode(input); const expectedNode = expectedDocument.toNode();
  const runtime = node("_hson_root", [node("main"), node("aside")]);
  (runtime.$_content[0] as HsonNode).$_meta = record({ quid: "000000101" });
  (runtime.$_content[1] as HsonNode).$_meta = record({ quid: "000000102" });
  const expectedWire = encode_locus_graph_content(runtime);
  const invalid = node("_hson_root", [node("_hson_obj")]);
  const invalidResult = errorObservation(() => { ExactDocumentCarrier.fromNode(invalid); });
  assert.equal(invalidResult.accepted, false); assert.throws(() => hsonTransform.fromNode(input));
  for (const [prototype, index] of indexTargets) {
    const actual = await withIndexSetter(prototype, index, validationFrame, frame => {
      Object.defineProperty(frame, "value", { value: node("_hson_val", [42]) }); return frame;
    }, () => {
      const document = ExactDocumentCarrier.fromNode(input); const wire = encode_locus_graph_content(runtime);
      return { document, hson: document.toHson(), copy: document.toNode(), wire, decoded: decode_locus_graph_content(wire),
        invalid: errorObservation(() => { ExactDocumentCarrier.fromNode(invalid); }) };
    });
    assert.equal(actual.document.equals(expectedDocument), true); assert.equal(actual.hson, expectedDocument.toHson());
    assert.equal(canonical_hson_graph_equal(actual.copy, expectedNode), true); assert.equal(actual.copy.$_tag, "_hson_root");
    assert.notEqual(actual.copy, input); assert.deepEqual(actual.wire, expectedWire);
    assert.ok(is_Node(actual.decoded));
    assert.equal(canonical_hson_graph_equal(actual.decoded, runtime), true); assert.deepEqual(actual.invalid, invalidResult);
    actual.copy.$_content.length = 0;
    assert.equal(canonical_hson_graph_equal(actual.document.toNode(), expectedNode), true);
  }
});

console.log(`1..${checks}`);
events.terminal("pass");
