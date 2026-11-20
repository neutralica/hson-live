import assert from "node:assert/strict";
import { admit_canonical_hson_data_value } from "../src/api/data/hson-data-hson.ts";
import { parse_hson } from "../src/api/transform/parsers/parse-hson.ts";
import { admit_projected_value } from "../src/core/projected-value-admission.ts";
import { emit_ordered_json } from "../src/core/exact-data-codec.ts";
import { ordered_projected_array, ordered_projected_object, type OrderedProjectedValue } from "../src/core/ordered-projected-value.ts";
import {
  evaluate_canonical_document_schema,
  evaluate_canonical_projected_fields,
  evaluate_canonical_projected_schema,
} from "../src/internal/canonical-schema/evaluate.ts";
import {
  CANONICAL_SCHEMA_FORMAT,
  CANONICAL_SCHEMA_FORMAT_LIMITS,
  type CanonicalSchemaGraph,
  type CanonicalSchemaNode,
} from "../src/internal/canonical-schema/graph.ts";
import { encode_canonical_schema_graph_hson, decode_canonical_schema_graph_hson } from "../src/internal/canonical-schema/encode-hson.ts";
import { verify_canonical_schema_graph } from "../src/internal/canonical-schema/verify.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "canonical-schema-resource-semantics",
  title: "Canonical Schema resource semantics",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["hson-schema", "canonical-schema", "resources"]),
});

const testEvents = create_test_event_emitter("canonical-schema-resource-semantics");
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
const verified = (graph: CanonicalSchemaGraph) => {
  const result = verify_canonical_schema_graph(graph);
  if (!result.ok) assert.fail(JSON.stringify(result.issues));
  return result.graph;
};
const projected = (nodes: CanonicalSchemaGraph["nodes"]) => verified({ format: CANONICAL_SCHEMA_FORMAT, capabilities: { projectedRoot: 0 }, nodes });
const exhausted = (result: Readonly<{ issues: readonly Readonly<{ evidence: Readonly<{ kind: string }> }>[] }>) => result.issues[0]?.evidence.kind === "resource-limit";
const object = ordered_projected_object;
const array = ordered_projected_array;
const number = { kind: "projected-number" } as const;
const string = { kind: "projected-string" } as const;
const typed = { kind: "projected-object", exact: false, properties: [], additional: 1 } as const;
const mismatch = (path: readonly (string | number)[], schemaNode: number, expected: string, received: string) => ({
  code: "TYPE_MISMATCH", path, schemaNode, expected, received, evidence: { kind: "type-mismatch" },
});
const missing = (path: readonly (string | number)[], schemaNode: number, expected: string) => ({
  code: "MISSING_REQUIRED", path, schemaNode, expected, received: "missing", evidence: { kind: "missing-required" },
});
const resource = (path: readonly (string | number)[], schemaNode: number) => ({
  code: "INVALID_SCHEMA", path, schemaNode, expected: "resource budget", received: "exhausted", evidence: { kind: "resource-limit" },
});

check("canonical object acceptance matrix preserves named precedence and optionality", () => {
  const named = { kind: "projected-object", exact: true, properties: [["id", 1]] } as const;
  const id = object([["id", "a"]]);
  const wrongId = object([["id", 2], ["x", 3]]);
  const boolExtra = object([["id", "a"], ["x", false]]);
  const namedExtra = object([["id", "a"], ["x", 2]]);
  const badExtra = object([["x", "1"]]);
  const numericExtra = object([["x", 1], ["y", -0]]);
  const matrix = [
    {
      schema: projected([named, string]), accept: [id], reject: [[namedExtra, {
        code: "UNKNOWN_KEY", path: ["x"], schemaNode: 0, evidence: { kind: "unknown-key", detail: "x" },
      }]],
    },
    {
      schema: projected([{ ...named, exact: false }, string]), accept: [boolExtra],
      reject: [[object([]), missing(["id"], 1, "string")], [wrongId, mismatch(["id"], 1, "string", "number")]],
    },
    {
      schema: projected([typed, number]), accept: [object([]), numericExtra],
      reject: [[badExtra, mismatch(["x"], 1, "number", "string")]],
    },
    {
      schema: projected([{ ...named, exact: false, additional: 2 }, string, number]), accept: [namedExtra],
      reject: [[wrongId, mismatch(["id"], 1, "string", "number")], [boolExtra, mismatch(["x"], 2, "number", "boolean")]],
    },
    {
      schema: projected([{ ...named, exact: false, additional: 3 }, { kind: "projected-optional", base: 2 }, string, number]),
      accept: [object([]), object([["x", 2]]), namedExtra],
      reject: [[object([["id", null]]), mismatch(["id"], 2, "string", "null")], [badExtra, mismatch(["x"], 3, "number", "string")]],
    },
    {
      schema: projected([{ ...typed, additional: 0 }]), accept: [object([]), object([["a", object([["b", object([])]])]])],
      reject: [[object([["a", object([["b", 1]])]]), mismatch(["a", "b"], 0, "object", "number")]],
    },
    {
      schema: projected([{ kind: "projected-record", value: 1 }, number]), accept: [object([]), numericExtra],
      reject: [[badExtra, mismatch(["x"], 1, "number", "string")]],
    },
  ] as const;
  for (const { schema, accept, reject } of matrix) {
    for (const candidate of accept) assert.deepEqual(evaluate_canonical_projected_schema(schema, candidate), { ok: true, issues: [] });
    for (const [candidate, issue] of reject) assert.deepEqual(evaluate_canonical_projected_schema(schema, candidate), { ok: false, issues: [issue] });
  }
});

check("null literal membership works at the root and through nested schemas", () => {
  const literal = { kind: "projected-literal", values: [null, false, -0, "null"] } as const;
  const valid = { ok: true, issues: [] };
  const direct = projected([literal]);
  for (const member of literal.values) assert.deepEqual(evaluate_canonical_projected_schema(direct, member), valid);
  assert.deepEqual(evaluate_canonical_projected_schema(direct, 0), { ok: false, issues: [{
    code: "INVALID_LITERAL", path: [], schemaNode: 0, expected: 'null | false | -0 | "null"', received: "0",
    evidence: { kind: "literal-mismatch" },
  }] });
  assert.deepEqual(evaluate_canonical_projected_schema(projected([{ ...literal, values: [0] }]), 0), valid);
  assert.deepEqual(evaluate_canonical_projected_schema(projected([{ ...literal, values: [false] }]), null), {
    ok: false, issues: [mismatch([], 0, "false", "null")],
  });
  assert.deepEqual(evaluate_canonical_projected_schema(projected([number]), null), {
    ok: false, issues: [mismatch([], 0, "number", "null")],
  });

  const fields = admit_canonical_hson_data_value("<key null>");
  assert.deepEqual(fields, object([["key", null]]));
  const nullOrFalse = { ...literal, values: [null, false] };
  const record = projected([{ kind: "projected-record", value: 1 }, nullOrFalse]);
  const wildcard = projected([typed, nullOrFalse]);
  for (const graph of [record, wildcard]) {
    assert.deepEqual(evaluate_canonical_projected_schema(graph, fields), valid);
    assert.deepEqual(evaluate_canonical_projected_fields(graph, object([["key", null]])), valid);
    assert.deepEqual(evaluate_canonical_projected_schema(graph, fields, { maxSteps: 1 }), {
      ok: false, issues: [resource(["key"], 1)],
    });
  }

  const nested = projected([
    typed, { kind: "projected-tuple", items: [2] }, { kind: "projected-union", choices: [3, 4] }, number, nullOrFalse,
  ]);
  assert.deepEqual(evaluate_canonical_projected_fields(nested, object([["key", array([null])]])), valid);
  assert.deepEqual(evaluate_canonical_projected_schema(nested, object([["key", array([null])]])), valid);
  assert.deepEqual(evaluate_canonical_projected_schema(nested, object([["key", array(["null"])]])), {
    ok: false, issues: [{
      ...mismatch(["key", 0], 2, "number | null | false", "string"),
      evidence: { kind: "union-failure", branches: [3, 4] },
    }],
  });
});

check("ordered Data source preserves unusual keys, negative zero and diagnostic order", () => {
  const names = ["10", "__proto__", "2", "toString", "constructor", ""];
  const good = admit_canonical_hson_data_value("<'10' -0 __proto__ -0 '2' -0 toString -0 constructor -0 '' -0>");
  assert.deepEqual(good, object(names.map(name => [name, -0])));
  const literals = projected([typed, { kind: "projected-literal", values: [-0] }]);
  assert.ok(evaluate_canonical_projected_schema(literals, good).ok);
  assert.deepEqual(evaluate_canonical_projected_schema(literals, object([["", 0]])).issues, [{
    code: "INVALID_LITERAL", path: [""], schemaNode: 1, expected: "-0", received: "0", evidence: { kind: "literal-mismatch" },
  }]);
  const namedPrototypeKey = projected([{ ...typed, properties: [["__proto__", 1]], additional: 2 }, string, number]);
  assert.ok(evaluate_canonical_projected_schema(namedPrototypeKey, admit_canonical_hson_data_value("<__proto__ \"named\" constructor 1>")).ok);
  assert.deepEqual(evaluate_canonical_projected_schema(namedPrototypeKey, good).issues, [mismatch(["__proto__"], 1, "string", "number")]);
  const graph = projected([{ ...typed, properties: [["a", 1], ["b", 1]], additional: 2 }, string, number]);
  const candidate = admit_canonical_hson_data_value("<'10' false __proto__ false '2' false toString false b 1 constructor false a 2 '' false>");
  assert.deepEqual(evaluate_canonical_projected_schema(graph, candidate).issues, [
    mismatch(["a"], 1, "string", "number"), mismatch(["b"], 1, "string", "number"),
    ...names.map(name => mismatch([name], 2, "number", "boolean")),
  ]);
  for (const name of ["$_tag", "_hson_future"]) {
    assert.throws(() => admit_canonical_hson_data_value(`<nested «<'${name}' -0>»>`), /Canonical Data admission/);
  }
});

check("partial evaluation validates nested wildcard values in full", () => {
  const graph = projected([
    { ...typed, properties: [["id", 1]], additional: 2 }, string,
    { kind: "projected-array", item: 3 }, { kind: "projected-object", exact: true, properties: [["code", 1]] },
  ]);
  const omitted = object([["x", array([object([["code", "ok"]])])]]);
  assert.deepEqual(evaluate_canonical_projected_fields(graph, omitted), { ok: true, issues: [] });
  assert.deepEqual(evaluate_canonical_projected_schema(graph, omitted).issues, [missing(["id"], 1, "string")]);
  const supplied = object([["x", array([object([]), false])]]);
  assert.deepEqual(evaluate_canonical_projected_fields(graph, supplied).issues, [
    missing(["x", 0, "code"], 1, "string"), mismatch(["x", 1], 3, "object", "boolean"),
  ]);
});

check("wildcard operands share tuple definitions and retain refinement and related paths", () => {
  const wildcardTuple = projected([
    { ...typed, properties: [["named", 1]], additional: 3 },
    { kind: "projected-ref", target: 2 }, number, { kind: "projected-tuple", items: [1, 2] },
  ]);
  assert.ok(evaluate_canonical_projected_schema(wildcardTuple, object([["named", 1], ["x", array([-0, 2])]])).ok);
  assert.deepEqual(evaluate_canonical_projected_schema(wildcardTuple, object([["named", 1], ["x", array([false])]])).issues, [
    mismatch(["x", 0], 2, "number", "boolean"), missing(["x", 1], 2, "number"),
  ]);
  const tuple = projected([
    { ...typed, properties: [["named", 1]], additional: 2 },
    { kind: "projected-tuple", items: [2, 4] },
    { kind: "projected-ref", target: 3 },
    { kind: "projected-refinement", base: 4, rule: { kind: "integer" } }, number,
  ]);
  assert.ok(evaluate_canonical_projected_schema(tuple, object([["named", array([1, 2.5])], ["x", 3]])).ok);
  assert.deepEqual(evaluate_canonical_projected_schema(tuple, object([["named", array([false, 1])], ["x", 1.5]])).issues, [
    mismatch(["named", 0], 4, "number", "boolean"),
    { code: "INVALID_CONSTRAINT", path: ["x"], schemaNode: 3, expected: "integer", received: "1.5",
      evidence: { kind: "refinement-failure", detail: "integer", refinement: { kind: "integer" } } },
  ]);
  const unique = projected([typed,
    { kind: "projected-refinement", base: 2, rule: { kind: "array-unique-by-cases", by: "key", cases: [["a", ["K"]], ["b", ["K"]]] } },
    { kind: "projected-array", item: 3 }, { kind: "projected-object", exact: true, properties: [["key", 4]] }, string,
  ]);
  const a = object([["key", "a"]]), b = object([["key", "b"]]);
  assert.ok(evaluate_canonical_projected_schema(unique, object([["x", array([a])], ["y", array([b])]])).ok);
  assert.deepEqual(evaluate_canonical_projected_schema(unique, object([["x", array([a, b])]])).issues, [{
    code: "INVALID_CONSTRAINT", path: ["x", 1, "key"], schemaNode: 1, expected: "unique derived key", received: '"K"',
    evidence: { kind: "unique-key-conflict", detail: "key", relatedPath: ["x", 0, "key"], conflictingKey: "K" },
  }]);
});

check("wildcard operands consume the shared step, depth, issue and union budgets", () => {
  const graph = projected([typed, { kind: "projected-array", item: 2 }, number]);
  const good = object([["x", array([1])], ["y", array([2])]]);
  assert.deepEqual(evaluate_canonical_projected_schema(graph, object([["x", array([false])]])).issues, [mismatch(["x", 0], 2, "number", "boolean")]);
  assert.deepEqual(evaluate_canonical_projected_schema(graph, good, { maxSteps: 4 }).issues, [resource(["y", 0], 2)]);
  assert.ok(evaluate_canonical_projected_schema(graph, good, { maxSteps: 5, maxDepth: 2 }).ok);
  assert.deepEqual(evaluate_canonical_projected_schema(graph, object([["x", array([1])]]), { maxDepth: 1 }).issues, [resource(["x", 0], 2)]);
  assert.deepEqual(evaluate_canonical_projected_schema(graph, object([["x", array([false])], ["y", array(["bad"])]]), { maxIssues: 1 }).issues, [resource(["x", 0], 2)]);
  const union = projected([typed, { kind: "projected-union", choices: [2, 3] }, number, { kind: "projected-array", item: 4 }, string]);
  assert.deepEqual(evaluate_canonical_projected_schema(union, object([["x", array([1])]]), { maxDepth: 2 }).issues, [resource(["x", 0], 4)]);
  const broadUnion = projected([
    typed, { kind: "projected-union", choices: [2, 4] }, { kind: "projected-array", item: 3 }, string, { kind: "projected-any" },
  ]);
  assert.ok(evaluate_canonical_projected_schema(broadUnion, object([["x", array([1])]]), { maxDepth: 2 }).ok);
  assert.ok(evaluate_canonical_projected_schema(union, object([["x", array(["a"])], ["y", 2]])).ok);
  assert.deepEqual(evaluate_canonical_projected_schema(union, object([["x", 1], ["y", 2]]), { maxUnionWork: 2 }).issues, [resource(["y"], 1)]);
  assert.deepEqual(evaluate_canonical_projected_schema(union, object([["x", false]])).issues, [{
    code: "TYPE_MISMATCH", path: ["x"], schemaNode: 1, expected: "number | array", received: "boolean",
    evidence: { kind: "union-failure", branches: [2, 3] },
  }]);
});

check("format node-count limit rejects deterministically", () => {
  const nodes = Array.from({ length: CANONICAL_SCHEMA_FORMAT_LIMITS.maxGraphNodes + 1 }, () => Object.freeze({ kind: "projected-any" as const }));
  const result = verify_canonical_schema_graph({ format: CANONICAL_SCHEMA_FORMAT, capabilities: { projectedRoot: 0 }, nodes });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.issues[0]?.message ?? "", /format limit/);
});

check("test harness can lower the traversal-step budget", () => {
  const graph = projected([{ kind: "projected-optional", base: 1 }, { kind: "projected-string" }]);
  assert.equal(exhausted(evaluate_canonical_projected_schema(graph, admit_projected_value("x"), { maxSteps: 1 })), true);
});

check("candidate/reference depth has an independent budget", () => {
  const graph = projected([{ kind: "projected-optional", base: 1 }, { kind: "projected-nullable", base: 2 }, { kind: "projected-string" }]);
  assert.equal(exhausted(evaluate_canonical_projected_schema(graph, admit_projected_value("x"), { maxDepth: 1 })), true);
});

check("union branch work has an independent budget", () => {
  const graph = projected([{ kind: "projected-union", choices: [1, 2] }, { kind: "projected-string" }, { kind: "projected-number" }]);
  assert.equal(exhausted(evaluate_canonical_projected_schema(graph, admit_projected_value(true), { maxUnionWork: 1 })), true);
});

check("issue accumulation has an independent budget", () => {
  const graph = projected([{ kind: "projected-object", exact: true, properties: [["a", 1], ["b", 1]] }, { kind: "projected-string" }]);
  assert.equal(exhausted(evaluate_canonical_projected_schema(graph, admit_projected_value({}), { maxIssues: 1 })), true);
});

check("document content traversal has an independent budget", () => {
  const graph = verified({
    format: CANONICAL_SCHEMA_FORMAT,
    capabilities: { documentRoot: 0 },
    nodes: [{ kind: "document-root", content: 1 }, { kind: "document-repeat", item: 2 }, { kind: "document-text" }],
  });
  assert.equal(exhausted(evaluate_canonical_document_schema(graph, parse_hson('"a" "b"', { allowTopLevelDocumentText: true }), { maxContentItems: 1 })), true);
});

check("configured unique charges every inspected selector member", () => {
  const graph = projected([
    { kind: "projected-refinement", base: 1, rule: { kind: "array-unique-by-cases", by: "selector", cases: [["hit", []]] } },
    { kind: "projected-array", item: 2 },
    { kind: "projected-any" },
  ]);
  const laterMembers = Object.fromEntries(Array.from({ length: 64 }, (_, index) => [`later-${index}`, index]));
  const selectorFirst = admit_projected_value([{ selector: "hit", ...laterMembers }]);
  const selectorLast = admit_projected_value([{ ...laterMembers, selector: "hit" }]);
  const selectorMissing = admit_projected_value([{ ...laterMembers }]);

  assert.equal(evaluate_canonical_projected_schema(graph, selectorFirst, { maxSteps: 6 }).ok, true);
  assert.equal(exhausted(evaluate_canonical_projected_schema(graph, selectorLast, { maxSteps: 69 })), true);
  assert.equal(evaluate_canonical_projected_schema(graph, selectorLast, { maxSteps: 70 }).ok, true);
  assert.equal(exhausted(evaluate_canonical_projected_schema(graph, selectorMissing, { maxSteps: 68 })), true);
  const missing = evaluate_canonical_projected_schema(graph, selectorMissing, { maxSteps: 69 });
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.equal(missing.issues[0]?.code, "MISSING_REQUIRED");
    assert.equal(exhausted(missing), false);
  }
});

check("configured unique relation rows, keys, and contributed keys remain metered", () => {
  const graph = projected([
    { kind: "projected-refinement", base: 1, rule: { kind: "array-unique-by-cases", by: "selector", cases: [["hit", ["key"]]] } },
    { kind: "projected-array", item: 2 },
    { kind: "projected-any" },
  ]);
  const candidate = admit_projected_value([{ selector: "hit" }]);
  assert.equal(exhausted(evaluate_canonical_projected_schema(graph, candidate, { maxSteps: 7 })), true);
  assert.equal(evaluate_canonical_projected_schema(graph, candidate, { maxSteps: 8 }).ok, true);
});

check("configured unique resolves a long reference chain through canonical transport", () => {
  const unique = { kind: "projected-refinement", base: 1, rule: { kind: "array-unique-by-cases", by: "tag", cases: [["a", []]] } } as const;
  const nodes: CanonicalSchemaGraph["nodes"] = [unique,
    ...Array.from({ length: 11_998 }, (_, i) => ({ kind: "projected-ref", target: i + 2 } as const)),
    { kind: "projected-array" }];
  const wire = encode_canonical_schema_graph_hson(projected(nodes));
  const restored = decode_canonical_schema_graph_hson(wire);
  assert.ok(restored.ok);
  assert.equal(encode_canonical_schema_graph_hson(restored.graph), wire);
  for (const terminal of [{ kind: "projected-string" }, { kind: "projected-ref", target: 0 },
    { kind: "projected-ref", target: -1 }, { kind: "projected-ref", target: 2.5 }]) {
    const result = verify_canonical_schema_graph({ format: CANONICAL_SCHEMA_FORMAT, capabilities: { projectedRoot: 0 }, nodes: [unique, terminal] });
    assert.ok(!result.ok);
    assert.ok(result.issues.some(issue => issue.message.includes("base must resolve")));
  }
});

check("Document content and item unions retain the exhausting branch's issue", () => {
  for (const [nodes, source, depth, schemaNode] of [
    [[{ kind: "document-root", content: 1 }, { kind: "document-content-union", choices: [2, 4] },
      { kind: "document-repeat", item: 3, count: 2 }, { kind: "document-text" }, { kind: "document-repeat", item: 3 }], '"x"', 1, 3],
    [[{ kind: "document-root", content: 1 }, { kind: "document-repeat", item: 2 }, { kind: "document-item-union", choices: [3, 4] },
      { kind: "document-text" }, { kind: "document-element", content: 5 }, { kind: "document-sequence", items: [] }], "<a/>", 2, 5],
  ] as const) {
    const graph = verified({ format: CANONICAL_SCHEMA_FORMAT, capabilities: { documentRoot: 0 }, nodes });
    const candidate = parse_hson(source, { allowTopLevelDocumentText: true });
    const result = evaluate_canonical_document_schema(graph, candidate, { maxDepth: depth });
    assert.deepEqual(result.issues, [{ code: "INVALID_SCHEMA", path: [0], schemaNode, expected: "resource budget", received: "exhausted", evidence: { kind: "resource-limit" } }]);
    assert.ok(evaluate_canonical_document_schema(graph, candidate, { maxDepth: depth + 1 }).ok);
  }
});
check("nested Document content unions propagate default exhaustion and honor a successful sibling", () => {
  const nodes: CanonicalSchemaNode[] = [{ kind: "document-root", content: 1 },
    { kind: "document-content-union", choices: [2, 4] }, { kind: "document-repeat", count: 2, item: 3 }, { kind: "document-text" }];
  while (nodes.length < 518) nodes.push({ kind: "document-content-union", choices: [nodes.length + 1] });
  nodes.push({ kind: "document-repeat", item: 3 });
  const candidate = parse_hson('"x"', { allowTopLevelDocumentText: true });
  const capabilities = { documentRoot: 0 };
  const graph = verified({ format: CANONICAL_SCHEMA_FORMAT, capabilities, nodes });
  assert.ok(exhausted(evaluate_canonical_document_schema(graph, candidate)));
  assert.ok(evaluate_canonical_document_schema(graph, candidate, { maxDepth: 530 }).ok);
  const withSuccess = [...nodes, { kind: "document-broad-content" } as const];
  withSuccess[1] = { kind: "document-content-union", choices: [2, 4, nodes.length] };
  assert.ok(evaluate_canonical_document_schema(verified({ format: CANONICAL_SCHEMA_FORMAT, capabilities, nodes: withSuccess }), candidate).ok);
});

check("a diagnostic label preserves shared union branches and nullable wording", () => {
  const graph = projected([{ kind: "projected-object", exact: true, properties: [["x", 1]] },
    { kind: "projected-union", choices: [2, 4, 2] }, { kind: "projected-nullable", base: 3 },
    { kind: "projected-null" }, { kind: "projected-nullable", base: 5 }, { kind: "projected-string" }]);
  const result = evaluate_canonical_projected_schema(graph, admit_projected_value({}));
  assert.equal(result.issues[0]?.expected, "null | string | null | null");
});

check("missing-member labels retain the complete deeply nested exact literal", () => {
  const levels = 1850;
  let literal: OrderedProjectedValue = 0;
  let expected = "0";
  for (let level = levels - 1; level >= 0; level--) {
    literal = ordered_projected_array([literal]);
    expected = `[\n${"  ".repeat(level + 1)}${expected}\n${"  ".repeat(level)}]`;
  }
  const graph = projected([{ kind: "projected-object", exact: true, properties: [["absent", 1]] },
    { kind: "projected-literal", values: [literal] }]);
  assert.deepEqual(evaluate_canonical_projected_schema(graph, ordered_projected_object([])), {
    ok: false, issues: [{ code: "MISSING_REQUIRED", path: ["absent"], schemaNode: 1,
      expected, received: "missing", evidence: { kind: "missing-required" } }],
  });
});

check("deep exact objects and mixed containers retain indentation, escaping and signed zero", () => {
  for (const mixed of [false, true]) {
    let value: OrderedProjectedValue = -0;
    let expected = "-0";
    for (let level = 2000; level >= 1; level--) {
      const indent = "  ".repeat(level);
      if (mixed && level % 2 === 0) {
        value = ordered_projected_array([value]);
        expected = `[\n${indent}  ${expected}\n${indent}]`;
      } else {
        value = ordered_projected_object([["a\n", value]]);
        expected = `{\n${indent}  "a\\n": ${expected}\n${indent}}`;
      }
    }
    assert.equal(emit_ordered_json(value, 1), expected);
  }
});

check("attribute exhaustion survives item unions and nested item/content unions", () => {
  const candidate = parse_hson('<r a="x"/>');
  for (const contentUnion of [false, true]) for (const attributeFirst of [false, true]) {
    const nodes: CanonicalSchemaNode[] = [{ kind: "document-root", content: 1 }];
    if (!contentUnion) nodes.push({ kind: "document-sequence", items: [2] });
    const choices: number[] = [];
    nodes.push({ kind: contentUnion ? "document-content-union" : "document-item-union", choices });
    let scalar = 0, text = 0;
    for (const attribute of [attributeFirst, !attributeFirst]) {
      choices.push(nodes.length);
      if (contentUnion) nodes.push({ kind: "document-sequence", items: [nodes.length + 1] });
      if (attribute) {
        if (contentUnion) nodes.push({ kind: "document-item-union", choices: [nodes.length + 1] });
        const element = nodes.length;
        scalar = element + 2;
        nodes.push({ kind: "document-element", attrs: element + 1, content: element + 3 },
          { kind: "document-attrs", exact: true, properties: [{ name: "a", flag: false, optional: false, value: scalar }] },
          { kind: "projected-string" }, { kind: "document-broad-content" });
      } else {
        text = nodes.length;
        nodes.push({ kind: "document-text" });
      }
    }
    const graph = (entries: CanonicalSchemaNode[]) => verified({ format: CANONICAL_SCHEMA_FORMAT, capabilities: { documentRoot: 0 }, nodes: entries });
    const maxDepth = contentUnion ? 4 : 3;
    const original = graph(nodes);
    assert.deepEqual(evaluate_canonical_document_schema(original, candidate, { maxDepth }).issues, [{
      code: "INVALID_SCHEMA", path: [0], schemaNode: scalar, attributeName: "a",
      expected: "resource budget", received: "exhausted", evidence: { kind: "resource-limit" },
    }]);
    assert.ok(evaluate_canonical_document_schema(original, candidate, { maxDepth: maxDepth + 1 }).ok);
    const success = graph(nodes.with(text, { kind: "document-any-item" }));
    assert.ok(evaluate_canonical_document_schema(success, candidate, { maxDepth }).ok);
    if (!contentUnion && attributeFirst) {
      const mismatch = graph(nodes.with(scalar, { kind: "projected-number" }));
      const result = evaluate_canonical_document_schema(mismatch, candidate);
      assert.equal(result.issues[0]?.evidence.kind, "union-failure");
      assert.deepEqual(result.issues[1], { code: "TYPE_MISMATCH", path: [0], schemaNode: scalar, attributeName: "a",
        expected: "number", received: "string", evidence: { kind: "attr-invalid", detail: "type-mismatch" } });
    }
  }
});

testEvents.terminal("pass");
