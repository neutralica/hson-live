// @hson-live-external-test
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import { parse_json } from "../src/api/transform/parsers/parse-json.ts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import { is_Node } from "../src/core/node-guards.ts";
import type { HsonNode, JsonValue } from "../src/core/types.ts";

let checks = 0;
function check(name: string, fn: () => void): void {
  fn();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

const QUID = "4k7m2v9d1r6x8qwc";

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

check("explicit root without metadata and empty runtime root remain valid", () => {
  const populated = parse_json(explicit_root());
  const populatedText = parse_json(JSON.stringify(explicit_root()));
  assert.equal(populated.$_tag, "_hson_root");
  assert.equal(populated.$_content.length, 1);
  assert.equal(Object.hasOwn(populated, "$_meta"), false);
  assert.equal(canonical_hson_graph_equal(populated, populatedText), true);

  const empty = parse_json({ _hson_root: undefined } as unknown as JsonValue);
  assert.deepEqual(empty, { $_tag: "_hson_root", $_content: [] });
});

check("neutral empty root metadata records normalize away", () => {
  for (const input of [
    { _hson_root: { _hson_elem: [{ div: "" }] }, $_meta: {} },
    { _hson_root: { _hson_elem: [{ div: "" }] }, $_meta: undefined },
  ]) {
    const result = parse_json(input as unknown as JsonValue);
    assert.equal(Object.hasOwn(result, "$_meta"), false);
    if (input.$_meta !== undefined) {
      const textResult = parse_json(JSON.stringify(input));
      assert.equal(canonical_hson_graph_equal(result, textResult), true);
    }
  }
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
          && cause.message.includes("_hson_root")
          && cause.message.includes("meta"),
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
  assert.throws(() => hson.fromNode(raw).toNode(), /_hson_root.*quid|quid.*_hson_root/i);
  assert.throws(() => parse_json(explicit_root({ quid: QUID })), /_hson_root.*quid|quid.*_hson_root/i);

  const malformedRaw = {
    $_tag: "_hson_root",
    $_meta: [],
    $_content: [],
  } as unknown as HsonNode;
  assert.throws(() => hson.fromNode(malformedRaw).toNode(), /\$_meta must be a plain object/);
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
      $_meta: { quid: QUID },
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
  assert.deepEqual(div.$_meta, { quid: QUID });
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
    _hson_elem: [{
      div: { nested: [1, 2] },
      $_attrs: { title: "original", style: { color: " red " } },
    }],
  } as unknown as JsonValue;
  const result = parse_json(input);
  const snapshot = structuredClone(result);
  const inputRecord = input as unknown as {
    _hson_elem: Array<{ $_attrs: { title: string; style: { color: string } }; div: { nested: number[] } }>;
  };
  inputRecord._hson_elem[0].$_attrs.title = "changed";
  inputRecord._hson_elem[0].$_attrs.style.color = "blue";
  inputRecord._hson_elem[0].div.nested.push(3);
  assert.deepEqual(result, snapshot);

  const div = only_standard(result, "div");
  if (div.$_attrs) div.$_attrs.title = "result-only";
  div.$_content.push({ $_tag: "_hson_elem", $_content: [] });
  assert.equal(inputRecord._hson_elem[0].$_attrs.title, "changed");
  assert.deepEqual(inputRecord._hson_elem[0].div.nested, [1, 2, 3]);
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
    /cycle detected in parsed JSON input[\s\S]*reference returns to \$/,
  );
  assert.equal(cyclic.kept, "value");
  assert.equal(cyclic.self, cyclic);
});

check("shared acyclic caller references are copied by value", () => {
  const shared = { value: 1 };
  const input = { left: shared, right: shared } as JsonValue;
  const result = parse_json(input);
  shared.value = 2;
  assert.deepEqual(hson.fromNode(result).toJson().value(), {
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
        $_meta: { quid: QUID },
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
  const directValue = hson.fromNode(direct).toJson().value() as { value: number };
  const textValue = hson.fromNode(text).toJson().value() as { value: number };
  assert.equal(Object.is(directValue.value, -0), true);
  assert.equal(Object.is(textValue.value, 0), true);
  assert.equal(Object.is(textValue.value, -0), false);
  assert.equal(canonical_hson_graph_equal(direct, text), false);
});

process.stdout.write(`# ${checks} JSON ingress checks passed\n`);
emit_hson_live_test_completion("transform.json-ingress", checks, checks, 0);
