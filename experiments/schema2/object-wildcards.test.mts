import assert from "node:assert/strict";
import test from "node:test";
import { Hson, HsonDataValue } from "../../src/hson-authoring.js";
import { HsonSchema, compiled_hson_schema_of, hson_schema_digest } from "../../src/api/schema/hson-schema.js";
import { HsonSchemaError } from "../../src/api/livemap/livemap.error.js";
import { parse_canonical_hson_data, serialize_canonical_hson_data } from "../../src/core/hson-data-canonical-codec.js";
import { ordered_projected_object } from "../../src/core/ordered-projected-value.js";
import { evaluate_canonical_projected_fields } from "../../src/internal/canonical-schema/evaluate.js";
import { encode_canonical_schema_graph_hson } from "../../src/internal/canonical-schema/encode-hson.js";
import { evaluate_static_schema_candidate } from "../../src/internal/hson-schema/candidate-evaluation.js";
import { compile_hson_schema } from "../../src/internal/hson-schema/compiler.js";
import { inspect_schema_data, OBJECT_VALUE, schema_projection_description } from "../../src/internal/hson-schema/data-projection.js";
import { query_hson_editor_context } from "../../src/internal/editor-introspection/query.js";
import { generate_hson_schema_evidence } from "../../src/internal/hson-schema/generated-evidence.js";
import { compile_schema_source } from "./compile-source.js";
import { read_schema_source, SchemaSourceError } from "./source-reader.js";
import { repository_typescript_worker } from "../../tests/helpers/repository-typescript-worker.mjs";
import { reconstruct } from "./object-transport.worker.mjs";

function admitted(source: string) {
  const result = compile_schema_source(source);
  assert.ok(result.ok, result.ok ? undefined : JSON.stringify(result.issues));
  return result;
}

type Case = {
  authored: string; wire: string; digest: string; accept: string[];
  reject: [source: string, code: string, path: string[], expected?: string, received?: string][];
};
// Digests independently computed with Python hashlib over the ordered type-tagged tuples.
const cases: Case[] = [
  { authored: "<object>", wire: "<object <>>", digest: "e571643413897e445da5ace884c9d67d2edcaa7a51260c396d41519a5759fa27",
    accept: ["<>"], reject: [["<x 1>", "UNKNOWN_KEY", ["x"]]] },
  { authored: "<object <'id' <string>>>", wire: '<object <id "string">>', digest: "cbbd9c014abc42d19179fe4b797b37062f3dd33971f0b6721a7935067b8e219d",
    accept: ['<id "a">'], reject: [["<>", "MISSING_REQUIRED", ["id"], "string", "missing"], ["<id 2>", "TYPE_MISMATCH", ["id"], "string", "number"], ['<id "a" x false>', "UNKNOWN_KEY", ["x"]]] },
  { authored: "<object any>", wire: '<object <> any "any">', digest: "03167ba634df7d612ae0d8d4012ac665376ad0071e312eb5b163127b11b06b74",
    accept: ["<>", "<x null y [1]>"], reject: [["1", "TYPE_MISMATCH", [], "object", "number"]] },
  { authored: "<object any <number>>", wire: '<object <> any "number">', digest: "7fcb5964693f96c9c95e6e746a6d0bf6e98d9c010be135639311594906943305",
    accept: ["<>", "<x 1 y -0>", "<'' -0 __proto__ 2 constructor 4 '🧭' 3>"], reject: [['<x "a">', "TYPE_MISMATCH", ["x"], "number", "string"]] },
  { authored: "<object <'id' <string> any <number>>>", wire: '<object <id "string"> any "number">', digest: "095d5e58ed3ed2cb083fe8a57decbb92485a25fe3f0e6d1f3071bb92bb559821",
    accept: ['<id "a" x 2>'], reject: [["<id 2 x 3>", "TYPE_MISMATCH", ["id"], "string", "number"], ['<id "a" x false>', "TYPE_MISMATCH", ["x"], "number", "boolean"]] },
  { authored: "<object <'id' optional <string> any <number>>>", wire: '<object <id <optional "string">> any "number">', digest: "fb7a570004f36f0f18762307ee243ae40b54750b9268653bfc0bb02c2eefed88",
    accept: ["<>", "<x 2>", '<id "a" x 2>'], reject: [["<id null>", "TYPE_MISMATCH", ["id"], "string", "null"], ['<x "a">', "TYPE_MISMATCH", ["x"], "number", "string"]] },
];

for (const fixture of cases) test(fixture.authored, () => {
  const result = admitted(`<data ${fixture.authored}>`);
  const definition = parse_canonical_hson_data(`<type "data" root ${fixture.wire}>`);
  assert.deepEqual(result.orderedDefinition, definition);
  const canonical = serialize_canonical_hson_data(definition);
  assert.equal(result.schema1Source, canonical);
  const first = HsonSchema.fromHson(canonical);
  for (const handle of [first, Hson.schema.fromHson(first.toHson())]) {
    assert.equal(hson_schema_digest(handle), fixture.digest);
    assert.equal(handle.toHson(), canonical);
    assert.deepEqual(compiled_hson_schema_of(handle).graph, result.compiled.graph);
    for (const source of fixture.accept) {
      const value = HsonDataValue.fromSource(source);
      assert.equal(handle.certify(value), value);
    }
    for (const [source, code, path, expected, received] of fixture.reject) {
      assert.throws(() => handle.certify(HsonDataValue.fromSource(source)), error => {
        assert.ok(error instanceof HsonSchemaError);
        assert.deepEqual(error.issues, [{ code, path, ...(expected === undefined ? {} : { expected, received }),
          message: `Schema validation failed at ${path.join(".") || "root"}.` }]);
        return true;
      });
    }
  }
});

test("Node and Worker independently compile and re-admit each transported definition", async () => {
  const fixtures = cases.map(fixture => ({
    authored: `<data ${fixture.authored}>`, portable: admitted(`<data ${fixture.authored}>`).schema1Source,
    candidates: [...fixture.accept, ...fixture.reject.map(([source]) => source)],
  }));
  fixtures.push({ authored: '<data <defs <\'T\' <object any <ref "T">>>> <ref "T">>',
    portable: serialize_canonical_hson_data(parse_canonical_hson_data('<type "data" defs <T <object <> any <ref "T">>> root <ref "T">>')),
    candidates: ["<>", "<a <b <>>>", "<a <b 1>>"] });
  const expected = fixtures.map(reconstruct);
  const worker = repository_typescript_worker(new URL("./object-transport.worker.mts", import.meta.url), { workerData: fixtures });
  try {
    const received = await new Promise((resolve, reject) => {
      worker.once("message", resolve); worker.once("error", reject);
      worker.once("exit", code => reject(Error(`Worker exited before sending its results (${code})`)));
    });
    assert.deepEqual(received, expected);
  } finally { await worker.terminate(); }
});

test("only named order enters object definition identity", () => {
  const id = "'id' <string>", tag = "'tag' <boolean>", any = "any <number>";
  const digest = (expression: string) => hson_schema_digest(HsonSchema.fromHson(admitted(`<data ${expression}>`).schema1Source));
  for (const clauses of [[any, id, tag], [id, any, tag], [id, tag, any]]) {
    assert.equal(digest(`<object <${clauses.join(" ")}>>`), "86e71ceb8c3b70e3e01474bcd423c2c8a8ede9a02edd8143818adc57937fa6cf");
  }
  assert.equal(digest(`<object <${tag} ${any} ${id}>>`), "cf7d2a883f381c8cd7b7a755f10da05a293c764076cc3d054ababa9b5ad6bab9");
  assert.equal(digest("<object <>>"), cases[0]!.digest);
  const reserved = ["any", "object", "additional", "ref", "content"];
  const mixed = admitted(`<data <object <any // boundary\r\n ${reserved.map(name => `'${name}' <string>`).join(" ")}>>>`);
  const fields = Object.fromEntries(reserved.map(name => [name, "ok"]));
  const handle = HsonSchema.fromHson(mixed.schema1Source);
  handle.certify({ ...fields, extra: true });
  for (const name of reserved) assert.throws(() => handle.certify({ ...fields, [name]: true }), HsonSchemaError);
  const broad = admitted("<data <object <'id' <string> any>>>");
  assert.deepEqual(broad.compiled.graph.nodes, [{ kind: "projected-object", exact: false, properties: [["id", 1]] }, { kind: "projected-string" }]);
});

test("first discovery follows named references transitively before the wildcard reference", () => {
  const result = admitted(`<data <defs <'A' <ref "B"> 'B' <number> 'All' <any>>>
    <object <any <ref "All"> 'v' <ref "A">>>>`);
  assert.deepEqual(result.compiled.graph.nodes, [
    { kind: "projected-object", exact: false, properties: [["v", 1]], additional: 4 },
    { kind: "projected-ref", target: 2 }, { kind: "projected-ref", target: 3 },
    { kind: "projected-number" }, { kind: "projected-ref", target: 5 }, { kind: "projected-any" },
  ]);
  const machine = '<format "hson-canonical-schema" capabilities <projectedRoot 0> nodes «<kind "projected-object" exact false properties ««"v",1»» additional 4>,<kind "projected-ref" target 2>,<kind "projected-ref" target 3>,<kind "projected-number">,<kind "projected-ref" target 5>,<kind "projected-any">»>';
  assert.equal(encode_canonical_schema_graph_hson(result.compiled.graph), machine);
  const recursive = admitted('<data <defs <\'Tree\' <object any <ref "Tree">>>> <ref "Tree">>');
  assert.equal(recursive.compiled.recursiveSccCount, 1);
  assert.deepEqual(recursive.compiled.graph.nodes, [
    { kind: "projected-ref", target: 1 }, { kind: "projected-object", exact: false, properties: [], additional: 2 },
    { kind: "projected-ref", target: 1 },
  ]);
  const handle = HsonSchema.fromHson(recursive.schema1Source);
  for (const value of ["<>", "<a <b <>>>"]) handle.certify(HsonDataValue.fromSource(value));
  assert.throws(() => handle.certify({ a: { b: 1 } }), error => error instanceof HsonSchemaError && error.path.join(".") === "a.b");
  const generated = generate_hson_schema_evidence("S", result.schema1Source, "fixture");
  assert.equal(JSON.parse(generated.metadata).semanticGraphDigest, "065f4ca5c0bdad4c9033fe6ae371c5e0d562568e645b04a88e32aab28b216565");
  assert.match(generated.declaration, /export type All = \$SchemaDataRead;/);
  assert.match(generated.declaration, /readonly v: A; \} & \$SchemaObjectRead/);
});

test("nested wildcard operands use ordinary value semantics and validation", () => {
  for (const [expression, accept, reject] of [
    ["<array <number>>", "[1]", "[true]"], ["<tuple [<number>, <string>]>", '[1,"a"]', "[1]"],
    ["<union [<null>, <string>]>", "null", "false"], ["<object any <exact -0>>", "<nested -0>", "<nested 0>"],
    ['<number int min="2">', "2", "1"],
  ] as const) {
    const handle = HsonSchema.fromHson(admitted(`<data <object any ${expression}>>`).schema1Source);
    handle.certify(HsonDataValue.fromSource(`<extra ${accept}>`));
    assert.throws(() => handle.certify(HsonDataValue.fromSource(`<extra ${reject}>`)), HsonSchemaError);
  }
  for (const [source, code] of [
    ['<type "data" root <any "number" object <>>>', "UNKNOWN_SCHEMA_MEMBER"],
    ['<type "data" root <object <> any "number" typo true>>', "UNKNOWN_SCHEMA_MEMBER"],
    ['<type "data" root <object <> any <optional "string">>>', "ILLEGAL_OPTIONAL"],
    ['<type "data" root <object <> any "number" any "string">>', "INVALID_ROOT"],
    ['<type "data" root <array "any" any "string">>', "UNKNOWN_SCHEMA_MEMBER"],
    ['<type "data" defs <Unused <object <> any <ref "Missing">>> root "any">', "INVALID_REFERENCE"],
    ['<type "data" defs <Page <tag "main">> root <object <> any <ref "Page">>>', "INVALID_REFERENCE"],
    ['<type "data" defs <Bad <object <> any <union ["number","number"]>>> root "any">', "INVALID_UNION"],
    ['<type "data" defs <A <ref "B"> B <ref "A">> root <object <> any <ref "A">>>', "INVALID_SCHEMA_GRAPH"],
    ['<type "data" defs <Unused <object <> any <ref "Loop">> Loop <ref "Loop">> root "any">', "INVALID_SCHEMA_GRAPH"],
  ] as const) {
    const result = compile_hson_schema(source);
    assert.equal(result.ok, false, source);
    assert.deepEqual(result.issues.map(issue => issue.code), [code], source);
  }
});

test("ranges distinguish wildcard declarations, heads, flags and repeated operands", () => {
  const expression = '<array <ref "Missing">>';
  const source = `// 🧭\r\n<data <object <'🧭' optional ${expression} any // 🧭\r\n ${expression}>>>`;
  const result = compile_schema_source(source);
  assert.equal(result.ok, false);
  const member = result.declarationAt(["root", "object", "🧭"])!;
  const wildcard = result.declarationAt(["root", "any"])!;
  const span = (start: number, length: number) => ({ start, end: start + length });
  assert.deepEqual(result.nameRangeOf(member), span(source.indexOf("'🧭'"), 4));
  assert.deepEqual(result.rangeOf(result.originAt(["root","object","🧭"])), span(source.indexOf("optional"), 8));
  assert.deepEqual(result.nameRangeOf(wildcard), span(source.indexOf("any"), 3));
  assert.deepEqual(result.rangeOf(wildcard), { start: source.indexOf("any"), end: source.lastIndexOf(expression) + expression.length });
  assert.deepEqual(result.rangeOf(result.originAt(["root","any"])), span(source.lastIndexOf(expression), expression.length));
  assert.deepEqual(result.issues.map(({code, path, authoredRange}) => [code, path, authoredRange]), [
    ["INVALID_REFERENCE", ["root","object","🧭","optional","array","ref"], span(source.indexOf('"Missing"'), 9)],
    ["INVALID_REFERENCE", ["root","any","array","ref"], span(source.lastIndexOf('"Missing"'), 9)],
  ]);
  const bad = compile_schema_source('<data <object any <number min="3" max="1">>>');
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.issues.map(issue => [issue.code, issue.path, issue.authoredRange]), [
    ["INVALID_SCHEMA_EXPRESSION", ["root","any","number"], span(18, '<number min="3" max="1">'.length)],
  ]);
  const refinement = '<data <object any <array <string minlen="-1">>>>';
  const refined = compile_schema_source(refinement);
  assert.equal(refined.ok, false);
  assert.deepEqual(refined.issues.map(issue => [issue.path, issue.authoredRange]), [
    [["root","any","array","string","minlen"], span(refinement.indexOf("minlen"), 'minlen="-1"'.length)],
  ]);
  const detached = '<data <defs <\'Unused\' <object any <ref  "Loop">> \'Loop\' <ref "Loop">>> <string>>';
  const cycle = compile_schema_source(detached);
  assert.equal(cycle.ok, false);
  assert.deepEqual(cycle.issues.map(issue => [issue.code, issue.path, issue.authoredRange]), [
    ["INVALID_SCHEMA_GRAPH", ["defs", "Unused"], span(detached.indexOf('<ref  "Loop">'), '<ref  "Loop">'.length)],
  ]);

  for (const [body, fragment] of [
    ["<'n' any <string>>", "'n'"], ["<any any <number>>", "any <number>"], ["<any optional <number>>", "optional"],
    ['<any flag="x" <number>>', 'flag="x"'], ["any <number> <string>", "<string>"], ["any <number> optional", "optional"],
    ["any = \"x\"", "="], ["<anywhere <number>>", "a"], ["<'n' <string> '\\u006e' <number>>", "'\\u006e' <number>"],
  ] as const) {
    const text = `// 🧭\r\n<data <object ${body}>>`;
    assert.throws(() => compile_schema_source(text), error => {
      assert.ok(error instanceof SchemaSourceError);
      assert.equal(text.slice(error.range.start, error.range.end), fragment);
      return true;
    });
  }
  const duplicate = read_schema_source("<data <object any any>>").root.body;
  assert.ok(duplicate?.kind === "operation" && duplicate.body?.kind === "members");
  assert.deepEqual(duplicate.body.entries.map(entry => entry.name), ["any","any"]);
});

test("wildcard evidence visits long definition chains once and keeps arbitrary JavaScript reads unknown", () => {
  const count = 2400;
  const definitions = Array.from({ length: count }, (_, i) => `T${i} ${i + 1 === count ? '"number"' : `<ref "T${i+1}">`}`);
  const source = `<type "data" defs <${definitions.join(" ")}> root <object <> any <ref "T0">>>`;
  const evidence = generate_hson_schema_evidence("Chain", source, "fixture");
  assert.equal(evidence.declaration.match(/export type T\d+ = /g)?.length, count);
  assert.ok(evidence.generatedBytes < count * 40);
  const handle = HsonSchema.fromHson('<type "data" root <object <> any "number">>');
  for (const [source, expected] of [["<>", Object], ["<constructor 3>", 3]] as const) {
    const value = Hson.data.fromSource(source);
    assert.equal(handle.certify(value), value);
    const view = value.materialize();
    assert.ok(view !== null && typeof view === "object");
    assert.equal(view["constructor"], expected);
  }
});

test("concrete key presence, iteration, partial evaluation and qualified candidate locations", () => {
  const { compiled } = admitted("<data <object <'id' <string> any <object <'value' <number>>>>>>");
  const description = (path: Parameters<typeof inspect_schema_data>[1]) => schema_projection_description(inspect_schema_data(compiled, path));
  assert.equal(description(["id"]), "string (required)");
  assert.equal(description(["extra","value"]), "number (optional)");
  assert.equal(description(["$_reserved"]), "absent in this Schema");
  assert.equal(description([OBJECT_VALUE]), "string | { value: number } (required)");
  assert.equal(inspect_schema_data(compiled, ["extra","value"], 1).alternatives[0]?.kind, "budget-exhausted");
  assert.equal(evaluate_canonical_projected_fields(compiled.graph, ordered_projected_object([])).ok, true);
  const partial = evaluate_canonical_projected_fields(compiled.graph, ordered_projected_object([["extra", ordered_projected_object([])]]));
  assert.deepEqual(partial.issues.map(issue => [issue.code, issue.path]), [["MISSING_REQUIRED", ["extra","value"]]]);
  const source = '// 🧭\r\n<id "x" extra <value false>>';
  const issue = evaluate_static_schema_candidate(compiled, { source, family: "data" });
  assert.equal(issue.kind, "invalid");
  assert.equal(issue.issue.code, "TYPE_MISMATCH");
  assert.deepEqual(issue.issue.path, ["extra","value"]);
  assert.deepEqual(issue.range, { start: source.indexOf("false"), end: source.indexOf("false") + 5 });
  assert.equal(evaluate_static_schema_candidate(compiled, { source: "<p/>", family: "data" }).kind, "unknown");
});

test("editor completion uses named precedence and the wildcard value of a concrete extra", () => {
  const { compiled } = admitted('<data <object <\'id\' <exact "ID"> any <object <\'count\' <boolean>>>>>>');
  const labels = (source: string) => query_hson_editor_context({ mode: "data", source, cursor: source.length, schema: compiled })
    .candidates.map(candidate => candidate.label);
  assert.deepEqual(labels("<id "), ['"ID"']);
  assert.deepEqual(labels("<extra <co"), ["count"]);
  assert.deepEqual(labels("<extra <count "), ["true", "false"]);
  const union = admitted(`<data <union [
    <object <'kind' <exact "a"> any <number>>>,
    <object <'kind' <exact "b"> 'extra' <number>>>
  ]>>`).compiled;
  const { candidates } = query_hson_editor_context({ mode: "data", source: "<ex", cursor: 3, schema: union });
  assert.deepEqual(candidates.map(item => [item.label, item.detail]), [["extra", "data member (required in some union alternatives)"]]);
});
