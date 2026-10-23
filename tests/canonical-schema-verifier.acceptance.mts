import assert from "node:assert/strict";
import { admit_projected_value } from "../src/core/projected-value-admission.ts";
import { assert_ordered_projected_value, is_ordered_projected_value, ordered_projected_array, ordered_projected_object, ordered_projected_value_equal } from "../src/core/ordered-projected-value.ts";
import { materialize_projected_value } from "../src/core/projected-value-materialization.ts";
import { projected_value_from_hson_node, projected_value_to_hson_node } from "../src/core/projected-value-graph.ts";
import { CANONICAL_SCHEMA_FORMAT } from "../src/internal/canonical-schema/graph.ts";
import { decode_canonical_schema_graph_hson, encode_canonical_schema_graph_hson } from "../src/internal/canonical-schema/encode-hson.ts";
import { verify_canonical_schema_graph } from "../src/internal/canonical-schema/verify.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "canonical-schema-verifier",
  title: "Canonical Schema verifier",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["hson-schema", "canonical-schema", "verification"]),
});

const testEvents = create_test_event_emitter("canonical-schema-verifier");
let checks = 0;
const check = (name: string, run: () => void): void => {
  testEvents.case_begin(name, name);
  try {
    run();
    testEvents.case_end(name, "pass");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Check failed.";
    testEvents.diagnostic(name, "assertion", message.slice(0, 1_000));
    testEvents.case_end(name, "fail");
    testEvents.terminal("fail");
    throw error;
  } console.log(`ok ${++checks} - ${name}`); };
const graph = (capabilities: Record<string, number>, nodes: unknown[], extra: Record<string, unknown> = {}) => ({ format: CANONICAL_SCHEMA_FORMAT, capabilities, nodes, ...extra });
const accepted = (value: unknown): void => assert.equal(verify_canonical_schema_graph(value).ok, true);
const rejected = (value: unknown, pattern?: RegExp): void => {
  const result = verify_canonical_schema_graph(value); assert.equal(result.ok, false);
  if (!result.ok && pattern !== undefined) assert.match(result.issues.map(issue => issue.message).join("\n"), pattern);
};

check("minimal projected graph verifies and freezes", () => { const value = graph({ projectedRoot: 0 }, [{ kind: "projected-string" }]); const result = verify_canonical_schema_graph(value); assert.equal(result.ok, true); if (result.ok) assert.equal(Object.isFrozen(result.graph.nodes), true); });
check("minimal document graph verifies", () => accepted(graph(
  { documentRoot: 0 },
  [{ kind: "document-root", content: 1 }, { kind: "document-sequence", items: [2] }, { kind: "document-element", content: 3 }, { kind: "document-broad-content" }],
)));
check("format is exact", () => rejected({ ...graph({ projectedRoot: 0 }, [{ kind: "projected-string" }]), format: "other" }, /format/i));
check("unknown envelope fields reject", () => rejected({ ...graph({ projectedRoot: 0 }, [{ kind: "projected-string" }]), surprise: true }, /Unknown field/));
check("at least one capability is required", () => rejected(graph({}, [{ kind: "projected-string" }]), /capability/i));
check("capability refs are in range", () => rejected(graph({ projectedRoot: 2 }, [{ kind: "projected-string" }]), /out of range/));
check("capability domain is compatible", () => rejected(graph({ projectedRoot: 0 }, [{ kind: "document-text" }]), /incompatible/));
check("unknown capability field rejects", () => rejected(graph({ projectedRoot: 0, magic: 0 }, [{ kind: "projected-string" }]), /Unknown field/));
check("unknown node kind rejects", () => rejected(graph({ projectedRoot: 0 }, [{ kind: "code-hook", source: "return true" }]), /Unknown node kind/));
check("unknown node fields reject", () => rejected(graph({ projectedRoot: 0 }, [{ kind: "projected-string", callback: "x" }]), /Unknown field/));
check("projected operand domain rejects document nodes", () => rejected(graph({ projectedRoot: 0 }, [{ kind: "projected-object", exact: false, properties: [["x", 1]] }, { kind: "document-text" }]), /incompatible/));
check("duplicate projected properties reject", () => rejected(graph({ projectedRoot: 0 }, [{ kind: "projected-object", exact: true, properties: [["x", 1], ["x", 1]] }, { kind: "projected-string" }]), /Duplicate property/));
check("duplicate attrs reject", () => rejected(graph({ attrs: 0 }, [{ kind: "document-attrs", exact: true, properties: [{ name: "x", optional: false, flag: true }, { name: "x", optional: true, flag: true }] }]), /Duplicate attr/));
check("union cardinality is nonempty", () => rejected(graph({ projectedRoot: 0 }, [{ kind: "projected-union", choices: [] }]), /nonempty/));
check("repeat count is a nonnegative safe integer", () => rejected(graph({ documentContent: 0 }, [{ kind: "document-repeat", item: 1, count: -1 }, { kind: "document-text" }]), /Repeat count/));
check("exact state must be explicit boolean", () => rejected(graph({ projectedRoot: 0 }, [{ kind: "projected-object", exact: "yes", properties: [] }]), /exact state/));
check("wrapper ref must exist", () => rejected(graph({ projectedRoot: 0 }, [{ kind: "projected-optional", base: 9 }]), /out of range/));
check("literal carrier admission rejects raw objects", () => rejected(graph({ projectedRoot: 0 }, [{ kind: "projected-literal", values: [{ a: 1 }] }]), /canonical projected value/));
check("canonical ordered literal verifies", () => accepted(graph({ projectedRoot: 0 }, [{ kind: "projected-literal", values: [admit_projected_value({ b: 2, a: 1 })] }])));
for (const [name, input] of [
  ["empty array", []],
  ["numbers and negative zero", [1, -0]],
  ["object containing an array", { child: [] }],
  ["nested arrays", [[1]]],
  ["number control", 1],
  ["negative-zero scalar control", -0],
  ["string control", "literal"],
  ["boolean control", true],
  ["null control", null],
  ["array-free object control", { child: 1 }],
] as const) {
  check(`canonical literal HSON round trip owns ${name}`, () => {
    const original = admit_projected_value(input);
    const verified = verify_canonical_schema_graph(graph({ projectedRoot: 0 }, [{ kind: "projected-literal", values: [original] }]));
    assert.ok(verified.ok);
    const encoded = encode_canonical_schema_graph_hson(verified.graph);
    const decoded = decode_canonical_schema_graph_hson(encoded);
    assert.ok(decoded.ok, JSON.stringify(decoded));
    const node = decoded.graph.nodes[0];
    assert.ok(node?.kind === "projected-literal");
    const literal = node.values[0];
    assert_ordered_projected_value(literal);
    assert.equal(is_ordered_projected_value(literal), true);
    assert.equal(ordered_projected_value_equal(literal, original), true);
    assert.deepEqual(materialize_projected_value(literal), input);
    if (name === "numbers and negative zero") {
      assert.ok(Array.isArray(literal));
      assert.equal(Object.is(literal[1], -0), true);
    }
    assert.equal(encode_canonical_schema_graph_hson(decoded.graph), encoded);
    assert.equal(verify_canonical_schema_graph(decoded.graph).ok, true);
    assert.equal(ordered_projected_value_equal(projected_value_from_hson_node(projected_value_to_hson_node(literal)), original), true);
    assert.deepEqual(materialize_projected_value(ordered_projected_array([literal])), [input]);
    assert.deepEqual(materialize_projected_value(ordered_projected_object([["decoded", literal]])), { decoded: input });
  });
}
check("canonical literal wire numbers remain finite at every array depth", () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    rejected(graph({ projectedRoot: 0 }, [{ kind: "projected-literal", values: [value] }]), /canonical projected value|finite/);
    for (const input of [[value], { child: [value] }, [[value]]]) {
      assert.throws(() => admit_projected_value(input));
    }
  }
  const verified = verify_canonical_schema_graph(graph({ projectedRoot: 0 }, [{ kind: "projected-literal", values: [admit_projected_value([[17]])] }]));
  assert.ok(verified.ok);
  const encoded = encode_canonical_schema_graph_hson(verified.graph);
  for (const token of ["NaN", "Infinity", "-Infinity", "1e999", "-1e999"]) {
    const malformed = encoded.replace("value 17", `value ${token}`);
    assert.notEqual(malformed, encoded);
    assert.equal(decode_canonical_schema_graph_hson(malformed).ok, false);
  }
});
check("canonical literal verification never recognizes a caller-owned frozen array", () => {
  const external = Object.freeze([1, -0]);
  rejected(graph({ projectedRoot: 0 }, [{ kind: "projected-literal", values: [external] }]), /canonical projected value/);
  assert.equal(is_ordered_projected_value(external), false);
});
check("unreachable nodes reject", () => rejected(graph({ projectedRoot: 0 }, [{ kind: "projected-string" }, { kind: "projected-number" }]), /unreachable/));
check("first-discovery node order is canonical", () => rejected(graph({ projectedRoot: 0 }, [{ kind: "projected-object", exact: false, properties: [["x", 2], ["y", 1]] }, { kind: "projected-string" }, { kind: "projected-number" }]), /first-discovery/));
check("non-consuming self ref rejects", () => rejected(graph({ projectedRoot: 0 }, [{ kind: "projected-ref", target: 0 }]), /no consuming/));
check("non-consuming union cycle rejects", () => rejected(graph({ projectedRoot: 0 }, [{ kind: "projected-union", choices: [1] }, { kind: "projected-ref", target: 0 }]), /no consuming/));
check("object-property recursion is productive", () => accepted(graph({ projectedRoot: 0 }, [{ kind: "projected-object", exact: false, properties: [["child", 0]] }])));
check("document child recursion is productive", () => accepted(graph(
  { documentRoot: 0 },
  [{ kind: "document-root", content: 1 }, { kind: "document-sequence", items: [2] }, { kind: "document-element", content: 1 }],
)));
check("malformed refinement bound rejects", () => rejected(graph({ projectedRoot: 0 }, [{ kind: "projected-refinement", base: 1, rule: { kind: "number-lower-bound", value: Infinity, inclusive: true } }, { kind: "projected-number" }]), /finite/));
check("configured unique accepts direct and legitimately refined or referenced array bases", () => {
  const rule = { kind: "array-unique-by-cases", by: "position", cases: [["left", ["L"]]] };
  accepted(graph({ projectedRoot: 0 }, [{ kind: "projected-refinement", base: 1, rule }, { kind: "projected-array" }]));
  accepted(graph({ projectedRoot: 0 }, [
    { kind: "projected-refinement", base: 1, rule },
    { kind: "projected-refinement", base: 2, rule: { kind: "collection-length", minimum: 1 } },
    { kind: "projected-array" },
  ]));
  accepted(graph({ projectedRoot: 0 }, [
    { kind: "projected-refinement", base: 1, rule },
    { kind: "projected-ref", target: 2 },
    { kind: "projected-array" },
  ]));
});
check("configured unique rejects canonical non-array bases", () => {
  const rule = { kind: "array-unique-by-cases", by: "position", cases: [] };
  for (const base of [
    { kind: "projected-string" },
    { kind: "projected-number" },
    { kind: "projected-boolean" },
    { kind: "projected-null" },
    { kind: "projected-object", exact: true, properties: [] },
    { kind: "projected-tuple", items: [] },
  ]) rejected(graph({ projectedRoot: 0 }, [{ kind: "projected-refinement", base: 1, rule }, base]), /projected array Schema/);
});
check("closed deterministic pattern refinement verifies", () => accepted(graph({ projectedRoot: 0 }, [{ kind: "projected-refinement", base: 1, rule: { kind: "string-pattern", dialect: "literal-string", mode: "prefix", pattern: "id_" } }, { kind: "projected-string" }])));
check("closed string repertoire refinement verifies, including an empty repertoire", () => {
  accepted(graph({ projectedRoot: 0 }, [{ kind: "projected-refinement", base: 1, rule: { kind: "string-repertoire", repertoire: "a😀e\u0301\n" } }, { kind: "projected-string" }]));
  accepted(graph({ projectedRoot: 0 }, [{ kind: "projected-refinement", base: 1, rule: { kind: "string-repertoire", repertoire: "" } }, { kind: "projected-string" }]));
});
check("string repertoire rejects duplicate iteration units", () => {
  rejected(graph({ projectedRoot: 0 }, [{ kind: "projected-refinement", base: 1, rule: { kind: "string-repertoire", repertoire: "a😀a" } }, { kind: "projected-string" }]), /duplicate iteration units/i);
  rejected(graph({ projectedRoot: 0 }, [{ kind: "projected-refinement", base: 1, rule: { kind: "string-repertoire", repertoire: "😀a😀" } }, { kind: "projected-string" }]), /duplicate iteration units/i);
});
check("string repertoire rejects wrong payload type", () => rejected(graph({ projectedRoot: 0 }, [{ kind: "projected-refinement", base: 1, rule: { kind: "string-repertoire", repertoire: ["a"] } }, { kind: "projected-string" }]), /must be a string/i));
check("string repertoire remains closed to unknown fields", () => rejected(graph({ projectedRoot: 0 }, [{ kind: "projected-refinement", base: 1, rule: { kind: "string-repertoire", repertoire: "abc", extra: true } }, { kind: "projected-string" }]), /Unknown field/));
check("documentation metadata unknown fields reject", () => rejected(graph({ projectedRoot: 0 }, [{ kind: "projected-string" }], { documentationMetadata: { path: "/tmp/x" } }), /Unknown field/));
check("semantic metadata refs verify", () => accepted(graph({ projectedRoot: 0 }, [{ kind: "projected-string" }], { semanticDiagnosticMetadata: { labels: [[0, "name"]] } })));
check("function-valued escape hatch rejects", () => rejected(graph({ projectedRoot: 0 }, [{ kind: "projected-string", validate: () => true }]), /executable/));
check("accessor fields reject without invocation", () => { let calls = 0; const node = Object.defineProperty({}, "kind", { enumerable: true, get: () => { calls += 1; return "projected-string"; } }); rejected(graph({ projectedRoot: 0 }, [node]), /accessors/); assert.equal(calls, 0); });
check("object cycles reject in favor of numeric refs", () => { const node: Record<string, unknown> = { kind: "projected-string" }; node.self = node; rejected(graph({ projectedRoot: 0 }, [node]), /acyclic/); });
check("explicit undefined optional fields reject", () => rejected(graph({ projectedRoot: 0 }, [{ kind: "projected-array", item: undefined }]), /undefined/));
check("sparse graph arrays reject", () => { const choices = new Array(1); rejected(graph({ projectedRoot: 0 }, [{ kind: "projected-union", choices }]), /dense/); });

testEvents.terminal("pass");
