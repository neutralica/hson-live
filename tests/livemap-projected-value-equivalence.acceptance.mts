import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
// @hson-live-external-test

import assert from "node:assert/strict";
import { make_livemap_core } from "../src/api/livemap/livemap.core.ts";
import { set_live_path } from "../src/api/livemap/livemap.editor.ts";
import { parse_json } from "../src/api/transform/parsers/parse-json.ts";
import { assert_invariants } from "../src/core/assert-invariants.ts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import { normalize_hson_graph } from "../src/core/normalize-hson-graph.ts";
import {
  is_ordered_projected_object,
  ordered_projected_array,
  ordered_projected_object,
  type OrderedProjectedValue,
} from "../src/core/ordered-projected-value.ts";
import {
  projected_value_from_hson_node,
  projected_value_to_hson_root,
} from "../src/core/projected-value-graph.ts";
import type { HsonNode, JsonValue } from "../src/core/types.ts";

let checks = 0;

function check(name: string, fn: () => void): void {
  fn();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function carrier_witness(value: OrderedProjectedValue): string {
  const visit = (candidate: OrderedProjectedValue): unknown => {
    if (typeof candidate === "number") {
      return Object.is(candidate, -0) ? ["number", "-0"] : ["number", String(candidate)];
    }
    if (candidate === null || typeof candidate === "string" || typeof candidate === "boolean") {
      return [typeof candidate, candidate];
    }
    if (Array.isArray(candidate)) return ["array", candidate.map(visit)];
    if (!is_ordered_projected_object(candidate)) throw new Error("Invalid carrier witness input.");
    return ["object", candidate.entries.map(([key, child]) => [key, visit(child)])];
  };
  return JSON.stringify(visit(value));
}

function assert_deeply_frozen(value: OrderedProjectedValue): void {
  if (value === null || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      assert.equal(Object.hasOwn(value, index), true);
      assert_deeply_frozen(value[index]!);
    }
    return;
  }
  if (!is_ordered_projected_object(value)) throw new Error("Invalid frozen carrier object.");
  assert.equal(Object.isFrozen(value.entries), true);
  for (const entry of value.entries) {
    assert.equal(Object.isFrozen(entry), true);
    assert_deeply_frozen(entry[1]);
  }
}

function assert_carrier_equivalence(
  carrier: OrderedProjectedValue,
  transformGraph: HsonNode,
): HsonNode {
  const before = carrier_witness(carrier);
  const first = projected_value_to_hson_root(carrier);
  const second = projected_value_to_hson_root(carrier);

  assert.equal(first.$_tag, "_hson_root");
  assert.equal(canonical_hson_graph_equal(first, transformGraph), true);
  assert.equal(canonical_hson_graph_equal(first, second), true);
  assert_invariants(first, "livemap projected-value equivalence");
  const normalized = normalize_hson_graph(first, "livemap projected-value equivalence");
  assert.equal(canonical_hson_graph_equal(first, normalized), true);

  const projected = projected_value_from_hson_node(first);
  assert.equal(carrier_witness(projected), before);
  assert.equal(carrier_witness(carrier), before);
  assert_deeply_frozen(carrier);
  return first;
}

function root_value(root: HsonNode): HsonNode {
  const child = root.$_content[0];
  assert.equal(root.$_content.length, 1);
  assert.equal(typeof child, "object");
  assert.notEqual(child, null);
  return child as HsonNode;
}

function object_property(root: HsonNode, key: string): HsonNode {
  const object = root_value(root);
  assert.equal(object.$_tag, "_hson_obj");
  const property = object.$_content.find(
    (candidate) => typeof candidate === "object" && candidate !== null && candidate.$_tag === key,
  );
  assert.notEqual(property, undefined);
  return property as HsonNode;
}

function transform_value(value: JsonValue): HsonNode {
  return typeof value === "string"
    ? parse_json(JSON.stringify(value))
    : parse_json(value);
}

function assert_mutation_equivalence(
  initial: JsonValue,
  mutate: (map: ReturnType<typeof make_livemap_core>) => void,
  expected: JsonValue,
): HsonNode {
  const first = make_livemap_core(transform_value(initial));
  const second = make_livemap_core(transform_value(initial));
  mutate(first);
  mutate(second);

  const firstRoot = first.root();
  const secondRoot = second.root();
  const transformGraph = transform_value(expected);
  assert.equal(canonical_hson_graph_equal(firstRoot, transformGraph), true);
  assert.equal(canonical_hson_graph_equal(firstRoot, secondRoot), true);
  assert_invariants(firstRoot, "LiveMap generic mutation equivalence");
  assert.equal(
    canonical_hson_graph_equal(
      firstRoot,
      normalize_hson_graph(firstRoot, "LiveMap generic mutation equivalence"),
    ),
    true,
  );
  return firstRoot;
}

function assert_editor_mutation_equivalence(
  initial: JsonValue,
  mutate: (root: HsonNode) => void,
  expected: JsonValue,
): HsonNode {
  const first = transform_value(initial);
  const second = transform_value(initial);
  mutate(first);
  mutate(second);

  const transformGraph = transform_value(expected);
  assert.equal(canonical_hson_graph_equal(first, transformGraph), true);
  assert.equal(canonical_hson_graph_equal(first, second), true);
  assert_invariants(first, "LiveMap editor mutation equivalence");
  assert.equal(
    canonical_hson_graph_equal(
      first,
      normalize_hson_graph(first, "LiveMap editor mutation equivalence"),
    ),
    true,
  );
  return first;
}

check("string carrier constructs the Transform scalar root", () => {
  assert_carrier_equivalence("text", parse_json('"text"'));
});

check("empty string carrier remains present text", () => {
  assert_carrier_equivalence("", parse_json('""'));
});

check("positive zero carrier constructs the Transform numeric root", () => {
  const root = assert_carrier_equivalence(0, parse_json(0));
  assert.equal(Object.is(root_value(root).$_content[0], 0), true);
});

check("negative zero carrier remains distinct in the canonical graph", () => {
  const root = assert_carrier_equivalence(-0, parse_json(-0));
  assert.equal(Object.is(root_value(root).$_content[0], -0), true);
  assert.equal(canonical_hson_graph_equal(root, parse_json(0)), false);
});

check("finite signed numbers retain their exact primitive values", () => {
  const carrier = ordered_projected_array([23.5, -17.25]);
  assert_carrier_equivalence(carrier, parse_json([23.5, -17.25]));
});

check("true carrier constructs the Transform boolean root", () => {
  assert_carrier_equivalence(true, parse_json(true));
});

check("false carrier constructs the Transform boolean root", () => {
  assert_carrier_equivalence(false, parse_json(false));
});

check("null carrier constructs the Transform null root", () => {
  assert_carrier_equivalence(null, parse_json(null));
});

check("empty ordered object constructs an empty canonical object", () => {
  assert_carrier_equivalence(ordered_projected_object([]), parse_json({}));
});

check("scalar string properties use the canonical object relationship wrapper", () => {
  const root = assert_carrier_equivalence(
    ordered_projected_object([["name", "Ada"]]),
    parse_json({ name: "Ada" }),
  );
  const property = object_property(root, "name");
  assert.equal((property.$_content[0] as HsonNode).$_tag, "_hson_obj");
  assert.equal(((property.$_content[0] as HsonNode).$_content[0] as HsonNode).$_tag, "_hson_str");
});

check("typed scalar properties use the canonical object relationship wrapper", () => {
  const root = assert_carrier_equivalence(
    ordered_projected_object([["count", -0]]),
    parse_json({ count: -0 }),
  );
  const property = object_property(root, "count");
  const relation = property.$_content[0] as HsonNode;
  assert.equal(relation.$_tag, "_hson_obj");
  assert.equal((relation.$_content[0] as HsonNode).$_tag, "_hson_val");
  assert.equal(Object.is((relation.$_content[0] as HsonNode).$_content[0], -0), true);
});

check("mixed scalar object properties match Transform exactly", () => {
  const carrier = ordered_projected_object([
    ["text", ""],
    ["count", 3],
    ["enabled", false],
    ["missing", null],
  ]);
  assert_carrier_equivalence(carrier, parse_json({ text: "", count: 3, enabled: false, missing: null }));
});

check("nested object properties remain direct structural relationships", () => {
  const carrier = ordered_projected_object([[
    "user",
    ordered_projected_object([["name", "Ada"]]),
  ]]);
  const root = assert_carrier_equivalence(carrier, parse_json({ user: { name: "Ada" } }));
  assert.equal((object_property(root, "user").$_content[0] as HsonNode).$_tag, "_hson_obj");
});

check("nested array properties remain direct structural relationships", () => {
  const carrier = ordered_projected_object([[
    "items",
    ordered_projected_array([1, "two"]),
  ]]);
  const root = assert_carrier_equivalence(carrier, parse_json({ items: [1, "two"] }));
  assert.equal((object_property(root, "items").$_content[0] as HsonNode).$_tag, "_hson_arr");
});

check("dangerous names are ordinary distinct ordered carrier keys", () => {
  const carrier = ordered_projected_object([
    ["__proto__", "proto-data"],
    ["constructor", 1],
    ["prototype", false],
  ]);
  const root = assert_carrier_equivalence(
    carrier,
    parse_json('{"__proto__":"proto-data","constructor":1,"prototype":false}'),
  );
  assert.deepEqual(
    (root_value(root).$_content as HsonNode[]).map((property) => property.$_tag),
    ["__proto__", "constructor", "prototype"],
  );
  assert.throws(
    () => ordered_projected_object([["same", 1], ["same", 2]]),
    /Duplicate ordered data object key/,
  );
});

check("integer-like names retain explicit canonical graph order", () => {
  const carrier = ordered_projected_object([
    ["10", "ten"],
    ["2", "two"],
    ["1", "one"],
  ]);
  const root = assert_carrier_equivalence(carrier, parse_json('{"10":"ten","2":"two","1":"one"}'));
  assert.deepEqual(
    (root_value(root).$_content as HsonNode[]).map((property) => property.$_tag),
    ["10", "2", "1"],
  );
});

check("empty ordered array constructs an empty canonical array", () => {
  assert_carrier_equivalence(ordered_projected_array([]), parse_json([]));
});

check("mixed scalar array items match Transform indexed relationships", () => {
  const carrier = ordered_projected_array(["", 0, true, null]);
  const root = assert_carrier_equivalence(carrier, parse_json(["", 0, true, null]));
  const array = root_value(root);
  assert.deepEqual(
    (array.$_content as HsonNode[]).map((item) => item.$_meta?.index),
    ["0", "1", "2", "3"],
  );
});

check("nested object array items match Transform", () => {
  const carrier = ordered_projected_array([
    ordered_projected_object([["name", "Ada"]]),
  ]);
  assert_carrier_equivalence(carrier, parse_json([{ name: "Ada" }]));
});

check("nested array items match Transform", () => {
  const carrier = ordered_projected_array([
    ordered_projected_array([1, 2]),
  ]);
  assert_carrier_equivalence(carrier, parse_json([[1, 2]]));
});

check("generic editor set of a missing scalar property appends canonical Transform shape", () => {
  const root = assert_editor_mutation_equivalence(
    {},
    (graph) => { set_live_path(graph, ["added"], "value"); },
    { added: "value" },
  );
  assert.equal(((object_property(root, "added").$_content[0] as HsonNode).$_content[0] as HsonNode).$_tag, "_hson_str");
});

check("generic replace of an existing scalar property uses canonical Transform shape", () => {
  const root = assert_mutation_equivalence(
    { value: "before" },
    (map) => { map.replace(["value"], false); },
    { value: false },
  );
  assert.equal(((object_property(root, "value").$_content[0] as HsonNode).$_content[0] as HsonNode).$_tag, "_hson_val");
});

check("generic setMany constructs every scalar relationship canonically", () => {
  assert_mutation_equivalence(
    { left: 1, kept: true },
    (map) => { map.setMany([], { left: -2, added: "new" }); },
    { left: -2, kept: true, added: "new" },
  );
});

check("generic whole-root replacement uses the canonical Transform root carrier", () => {
  const replacement = { next: "value", nested: [1, { ok: true }] };
  assert_mutation_equivalence(
    { before: true },
    (map) => { map.replace(replacement); },
    replacement,
  );
});

check("generic array-item replacement uses the canonical indexed relationship", () => {
  const root = assert_mutation_equivalence(
    { items: [1, 2] },
    (map) => { map.replace(["items", 1], -0); },
    { items: [1, -0] },
  );
  const array = object_property(root, "items").$_content[0] as HsonNode;
  const item = array.$_content[1] as HsonNode;
  assert.equal(item.$_tag, "_hson_ii");
  assert.equal(item.$_meta?.index, "1");
  assert.equal(Object.is((item.$_content[0] as HsonNode).$_content[0], -0), true);
});

process.stdout.write(`# ${checks} LiveMap projected-value equivalence checks passed\n`);
emit_hson_live_test_completion("livemap.projected-value-equivalence", checks, checks, 0);
