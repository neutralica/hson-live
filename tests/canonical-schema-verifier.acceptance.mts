import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { admit_projected_value } from "../src/core/projected-value-admission.ts";
import { assert_ordered_projected_value, is_ordered_projected_value, ordered_projected_array, ordered_projected_object, ordered_projected_value_equal } from "../src/core/ordered-projected-value.ts";
import { materialize_projected_value } from "../src/core/projected-value-materialization.ts";
import { projected_value_from_hson_node, projected_value_to_hson_node } from "../src/core/projected-value-graph.ts";
import { CANONICAL_SCHEMA_FORMAT, CANONICAL_SCHEMA_FORMAT_LIMITS } from "../src/internal/canonical-schema/graph.ts";
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
check("additional follows the named subtree in first-discovery order", () => {
  const nodes = [
    { kind: "projected-object", exact: false, properties: [["named", 1], ["shared", 2]], additional: 3 },
    { kind: "projected-ref", target: 2 },
    { kind: "projected-array", item: 0 },
    { kind: "projected-tuple", items: [2, 4] },
    { kind: "projected-number" },
  ];
  const verified = verify_canonical_schema_graph(graph({ projectedRoot: 0 }, nodes));
  assert.ok(verified.ok);
  const decoded = decode_canonical_schema_graph_hson(encode_canonical_schema_graph_hson(verified.graph));
  assert.ok(decoded.ok);
  assert.deepEqual(decoded.graph.nodes, nodes);
  rejected(graph({ projectedRoot: 0 }, [
    { kind: "projected-object", exact: false, properties: [["named", 2]], additional: 1 },
    { kind: "projected-string" }, { kind: "projected-number" },
  ]), /first-discovery/);
  accepted(graph({ projectedRoot: 0 }, [
    { kind: "projected-object", exact: false, properties: [["named", 1]], additional: 1 },
    { kind: "projected-string" },
  ]));
});
check("additional consumes candidate values but cannot make an alias cycle productive", () => {
  const root = { kind: "projected-object", exact: false, properties: [], additional: 1 };
  accepted(graph({ projectedRoot: 0 }, [root, { kind: "projected-ref", target: 0 }]));
  rejected(graph({ projectedRoot: 0 }, [
    root, { kind: "projected-ref", target: 2 }, { kind: "projected-ref", target: 1 },
  ]), /no consuming/);
});
check("invalid additional references and malformed targets reject at graph admission", () => {
  const root = { kind: "projected-object", exact: false, properties: [], additional: 1 };
  for (const additional of [-1, 2, 0.5, NaN, Infinity, "1", true, null, {}, [], undefined]) {
    const result = verify_canonical_schema_graph(graph({ projectedRoot: 0 }, [
      { ...root, additional }, { kind: "projected-number" },
    ]));
    assert.equal(result.ok, false);
    if (!result.ok) assert.deepEqual(result.issues[0]?.path, ["nodes", 0, "additional"]);
  }
  rejected(graph({ projectedRoot: 0 }, [{ ...root, exact: true }, { kind: "projected-number" }]), /Exact objects/);
  rejected(graph({ projectedRoot: 0 }, [root, { kind: "document-text" }]), /additional.*incompatible/);
  rejected(graph({ projectedRoot: 0 }, [root, { kind: "document-sequence", items: {} }]), /must be an array/);
  rejected(graph({ projectedRoot: 0 }, [{ ...root, wildcard: 1 }, { kind: "projected-number" }]), /Unknown field/);
  rejected(graph({ projectedRoot: 0 }, Object.assign([root, { kind: "projected-number" }], { "01": 0 })), /extra properties/);
});
check("additional has deterministic graph bytes and finite recursive transport", () => {
  const source = '<format "hson-canonical-schema" capabilities <projectedRoot 0> nodes «<kind "projected-object" exact false properties «» additional 1>,<kind "projected-ref" target 0>»>';
  const reordered = source.replace('exact false properties «» additional 1', 'additional 1 properties «» exact false');
  for (const wire of [source, reordered, source.replace("additional 1", "additional 1e0")]) {
    const decoded = decode_canonical_schema_graph_hson(wire);
    assert.ok(decoded.ok);
    assert.deepEqual(decoded.graph.nodes, [
      { kind: "projected-object", exact: false, properties: [], additional: 1 }, { kind: "projected-ref", target: 0 },
    ]);
    const encoded = encode_canonical_schema_graph_hson(decoded.graph);
    assert.equal(encoded, source);
    assert.equal(createHash("sha256").update(encoded).digest("hex"), "68e81a7047dafed91956bc4a12aa8cc42580f9fcb9db92265c7a7eec7ae542a2");
  }
  for (const malformed of [
    source.replace("exact false", "exact true"),
    source.replace("additional 1", "additional 2"),
    source.replace("additional 1", 'additional "1"'),
    source.replace("additional 1", "additional null"),
    source.replace("additional 1", "additional 1 additional 0"),
    source.replace('kind "projected-ref" target 0', 'kind "document-text"'),
  ]) assert.equal(decode_canonical_schema_graph_hson(malformed).ok, false, malformed);
});
check("legacy exact, open and record graph bytes and SHA-256 digests are stable", () => {
  for (const [body, digest] of [
    ['<kind "projected-object" exact true properties ««"id",1»»>,<kind "projected-string">', "88acdcc8a19a194f80cfe52c00d1433b876f5b8ae527e6a4ca8d67f338d100b7"],
    ['<kind "projected-object" exact false properties ««"id",1»»>,<kind "projected-string">', "89fd2fe1a3b16fb79d66b33ad64ac173f8765852b9a69134632c9576c67b43db"],
    ['<kind "projected-record" value 1>,<kind "projected-number">', "1d3910b9df1e54be0c325badef004d7b74387e19079a9913eba62b4035f1a1cb"],
  ]) {
    const bytes = `<format "hson-canonical-schema" capabilities <projectedRoot 0> nodes «${body}»>`;
    const decoded = decode_canonical_schema_graph_hson(bytes);
    assert.ok(decoded.ok);
    const encoded = encode_canonical_schema_graph_hson(decoded.graph);
    assert.equal(encoded, bytes);
    assert.equal(createHash("sha256").update(encoded).digest("hex"), digest);
  }
});
check("legacy record wire admits equivalent reference spelling and envelope order", () => {
  const body = '«<kind "projected-record" value 1>,<kind "projected-number">»';
  const source = `<format "hson-canonical-schema" capabilities <projectedRoot 0> nodes ${body}>`;
  const wire = `<nodes ${body.replace("value 1", "value 1e0")} capabilities <projectedRoot 0e0> format "hson-canonical-schema">`;
  const decoded = decode_canonical_schema_graph_hson(wire);
  assert.ok(decoded.ok);
  assert.equal(encode_canonical_schema_graph_hson(decoded.graph), source);
});
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
check("graph arrays with unsupported prototypes reject before traversal", () => {
  let calls = 0;
  const prototype = Object.create(Array.prototype, {
    forEach: { get: () => { calls += 1; throw new Error("Unexpected inherited getter invocation."); } },
  });
  const root = { kind: "projected-object", exact: false, properties: [] };
  for (const [value, path] of [
    [graph({ projectedRoot: 0 }, [{ ...root, properties: Object.setPrototypeOf([], null) }]), ["nodes", 0, "properties"]],
    [graph({ projectedRoot: 0 }, Object.setPrototypeOf([root], null)), ["nodes"]],
    [graph({ projectedRoot: 0 }, [
      { kind: "projected-union", choices: Object.setPrototypeOf([1], prototype) }, root,
    ]), ["nodes", 0, "choices"]],
  ] as const) {
    assert.deepEqual(verify_canonical_schema_graph(value), { ok: false, issues: [{
      code: "INVALID_GRAPH", path, message: "Canonical Schema arrays must use Array.prototype.",
    }] });
  }
  assert.equal(calls, 0);
});
check("ordinary graph arrays still reject malformed properties and cycles", () => {
  const withProperties = (properties: unknown) => graph({ projectedRoot: 0 }, [
    { kind: "projected-object", exact: false, properties },
  ]);
  const properties: unknown[] = [];
  properties.push(properties);
  rejected(withProperties(properties), /acyclic/);
  rejected(withProperties(Object.assign([], { forEach: null })), /extra properties/);
  rejected(withProperties([["key", 1]]), /out of range/);
  let calls = 0;
  const accessor = Object.defineProperty([], "0", {
    enumerable: true, get: () => { calls += 1; return ["key", 0]; },
  });
  rejected(withProperties(accessor), /accessors/);
  assert.equal(calls, 0);
  accepted(withProperties(Object.freeze([Object.freeze(["key", 0])])));
});

check("invalid diagnostic label references reject at the reference slot", () => {
  const nodes = [{ kind: "projected-string" }];
  const result = { ok: false, issues: [{ code: "INVALID_GRAPH",
    path: ["semanticDiagnosticMetadata", "labels", 0, 0], message: "Node reference is out of range.",
  }] };
  for (const ref of [{ toString: null }, [{ toString: null }], Object.create(null), ["0"], "0", null, false, -1, 1, 0.5, NaN, Infinity]) {
    assert.deepEqual(verify_canonical_schema_graph(graph({ projectedRoot: 0 }, nodes, {
      semanticDiagnosticMetadata: { labels: [[ref, "name"]] },
    })), result);
  }
  const wire = '<format "hson-canonical-schema" capabilities <projectedRoot 0> nodes «<kind "projected-string">» semanticDiagnosticMetadata <labels ««<toString null>,"name"»»>>';
  assert.deepEqual(decode_canonical_schema_graph_hson(wire), result);
});

check("label targets and duplicate references retain their metadata checks", () => {
  const nodes = [{ kind: "projected-string" }, { kind: "document-text" }];
  const capabilities = { projectedRoot: 0, documentItem: 1 };
  accepted(graph(capabilities, nodes, { semanticDiagnosticMetadata: { labels: [[-0, "name"]] } }));
  assert.deepEqual(verify_canonical_schema_graph(graph(capabilities, nodes, {
    semanticDiagnosticMetadata: { labels: [[0, "name"], [-0, "duplicate"], [1, "text"]] },
  })), { ok: false, issues: [
    { code: "INVALID_GRAPH", path: ["semanticDiagnosticMetadata", "labels", 1, 0], message: "Semantic diagnostic labels cannot duplicate a node reference." },
    { code: "INVALID_GRAPH", path: ["semanticDiagnosticMetadata", "labels", 2, 0], message: "Semantic diagnostic label must target a projected node." },
  ] });
});

check("deterministic pattern mode requires a supported string without coercion", () => {
  for (const mode of [{ toString: null }, ["full"]]) {
    const value = graph({ projectedRoot: 0 }, [
      { kind: "projected-refinement", base: 1, rule: { kind: "string-pattern", dialect: "literal-string", mode, pattern: "x" } },
      { kind: "projected-string" },
    ]);
    assert.deepEqual(verify_canonical_schema_graph(value), { ok: false, issues: [{ code: "INVALID_GRAPH",
      path: ["nodes", 0, "rule", "mode"], message: "Unsupported deterministic pattern mode.",
    }] });
  }
});

check("deep malformed arrays report their shape or full physical-cycle path", () => {
  const depth = 6_000;
  const outer: unknown[] = [];
  let inner = outer;
  for (let index = 0; index < depth; index++) {
    const child: unknown[] = [];
    inner.push(child);
    inner = child;
  }
  const value = graph({ projectedRoot: 0 }, [{ kind: "projected-object", exact: false, properties: [outer] }]);
  assert.deepEqual(verify_canonical_schema_graph(value), { ok: false, issues: [{ code: "INVALID_GRAPH",
    path: ["nodes", 0, "properties", 0], message: "Property must be a [name, ref] pair.",
  }] });
  inner.push(outer);
  assert.deepEqual(verify_canonical_schema_graph(value), { ok: false, issues: [{ code: "INVALID_GRAPH",
    path: ["nodes", 0, "properties", 0, ...Array<number>(depth + 1).fill(0)],
    message: "Canonical Schema object representation must be acyclic; recursion uses numeric references.",
  }] });
});

check("deep mixed data rejects accessors without invoking them", () => {
  let calls = 0;
  const leaf = Object.defineProperty({}, "blocked", { enumerable: true, get() { calls++; return null; } });
  let data: unknown = leaf;
  const path: (string | number)[] = ["nodes", 0, "properties", 0];
  for (let index = 0; index < 3_000; index++) {
    data = { child: [data] };
    path.push("child", 0);
  }
  const value = graph({ projectedRoot: 0 }, [{ kind: "projected-object", exact: false, properties: [data] }]);
  assert.deepEqual(verify_canonical_schema_graph(value), { ok: false, issues: [{ code: "INVALID_GRAPH",
    path: [...path, "blocked"], message: "Canonical Schema fields must be data properties; accessors are executable.",
  }] });
  assert.equal(calls, 0);
});

check("deeply nested shared literal containers verify and freeze in place", () => {
  let literal: Parameters<typeof ordered_projected_array>[0] = ordered_projected_array([-0]);
  for (let index = 0; index < 6_000; index++) literal = ordered_projected_array([literal]);
  const carrier = ordered_projected_object([["child", literal]]);
  for (const values of [[carrier], [carrier, carrier, literal]]) {
    const value = graph({ projectedRoot: 0 }, [{ kind: "projected-literal", values }]);
    const result = verify_canonical_schema_graph(value);
    assert.ok(result.ok);
    assert.equal(result.graph, value);
    assert.equal(Object.isFrozen(value.nodes[0]), true);
    assert.equal(Object.isFrozen(values), true);
  }
});

check("sparse array rejection reports the first missing index even at maximum length", () => {
  assert.deepEqual(verify_canonical_schema_graph(graph({ projectedRoot: 0 }, new Array(0xffff_ffff))), {
    ok: false, issues: [{ code: "INVALID_GRAPH", path: ["nodes", 0], message: "Canonical Schema arrays must be dense." }],
  });
});

check("ordinary graph arrays verify at the node count limit and reject above it", () => {
  const size = CANONICAL_SCHEMA_FORMAT_LIMITS.maxGraphNodes;
  const nodes = Array.from({ length: size }, (_, index) => index + 1 < size
    ? { kind: "projected-ref", target: index + 1 } : { kind: "projected-string" });
  accepted(graph({ projectedRoot: 0 }, nodes));
  assert.deepEqual(verify_canonical_schema_graph(graph({ projectedRoot: 0 }, [...nodes, nodes[0]])), {
    ok: false, issues: [{ code: "INVALID_GRAPH", path: ["nodes"], message: `Node table exceeds the format limit of ${size}.` }],
  });
});

testEvents.terminal("pass");
