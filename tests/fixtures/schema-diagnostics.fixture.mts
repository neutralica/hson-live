import assert from "node:assert/strict";
import { ANY_DATA, Hson, type HsonSchema, type HsonSchemaData } from "../../src/hson-authoring.ts";
import { hson_data_from_value } from "../../src/api/data/hson-data.ts";
import { HsonSchemaError } from "../../src/api/livemap/livemap.error.ts";
import { hsonTransform } from "../../src/api/transform/index.ts";
import { HsonSchema as SchemaHandle, compiled_hson_schema_of, hson_schema_digest } from "../../src/api/schema/hson-schema.ts";
import { admit_projected_value } from "../../src/core/projected-value-admission.ts";
import { HSON_MAX_NESTING } from "../../src/core/constants.ts";
import { parse_ordered_json_text } from "../../src/core/exact-data-codec.ts";
import { ordered_projected_array, type OrderedProjectedValue } from "../../src/core/ordered-projected-value.ts";
import { evaluate_canonical_document_schema, evaluate_canonical_projected_schema } from "../../src/internal/canonical-schema/evaluate.ts";
import { CANONICAL_SCHEMA_FORMAT, type CanonicalSchemaNode } from "../../src/internal/canonical-schema/graph.ts";
import { verify_canonical_schema_graph } from "../../src/internal/canonical-schema/verify.ts";
import { parse_hson_with_provenance } from "../../src/internal/hson-source-provenance/parse-hson-with-provenance.ts";
import { compile_hson_schema } from "../../src/internal/hson-schema/compiler.ts";
import { evaluate_static_schema_candidate } from "../../src/internal/hson-schema/candidate-evaluation.ts";
import { hsonLiveMap } from "../../src/api/livemap/livemap.facade.ts";
import { internal_livemap_aggregate_authority } from "../../src/api/livemap/livemap.internal.ts";
import type { LiveMapPartCollection } from "../../src/types/livemap.types.ts";

function reference_definitions(count: number, leaf = '"string"'): string {
  return Array.from({ length: count }, (_, i) =>
    `D${i} ${i + 1 === count ? leaf : `<ref "D${i + 1}">`}`).join(" ");
}

export function check_reference_transport(received?: readonly HsonSchemaData[]): readonly HsonSchemaData[] {
  return [1800, 2400].map((count, index) => {
    const source = received?.[index] ?? `<type "data" defs <${reference_definitions(count)}> root <array <ref "D0">>>`;
    const schema = received ? Hson.schema.fromHson(received[index]!) : SchemaHandle.fromHson(source);
    const { graph, recursiveSccCount } = compiled_hson_schema_of(schema);
    assert.equal(recursiveSccCount, 0);
    assert.equal(graph.nodes.length, count + 2);
    assert.deepEqual(graph.nodes[0], { kind: "projected-array", item: 1 });
    for (let ref = 1; ref <= count; ref++) assert.deepEqual(graph.nodes[ref], { kind: "projected-ref", target: ref + 1 });
    assert.deepEqual(graph.nodes.at(-1), { kind: "projected-string" });
    assert.equal(hson_schema_digest(schema), ["6c5310a8def330d6dc84b46a8058be27afd1cfe9650fab5adf81a4a4fb1c5ba8", "6fe1129e64155dde5158b4c6bf818753f6b3929a21d6f66a59b7088e1c7df82c"][index]);
    assert.equal(schema.certify([]).toHson(), "«»");
    if (received) assert.equal(schema.toHson(), source);
    return schema.toHson();
  });
}

function static_data_routes(source: string, jsonSource: string) {
  const json = JSON.parse(jsonSource);
  return [
    { candidate: { source, family: "data" }, admit: () => Hson.data.parse(source) },
    { candidate: { json }, admit: () => Hson.data.from(json) },
    { candidate: { data: parse_ordered_json_text(jsonSource) }, admit: () => Hson.data.fromSource(jsonSource) },
  ] as const;
}

function check_static_data_qualification(): void {
  const broad = compiled_hson_schema_of(ANY_DATA);
  const named = Hson.schema`<type "data" root <object <__proto__ "boolean" constructor "null"
    toString <string <minlen 2>> '' <array <object <zero <exact -0>>>>>>>`;
  const source = String.raw`<__proto__ true constructor null '\u0074oString' "ok" '' «<zero -0>»>`;
  const jsonSource = String.raw`{"__proto__":true,"constructor":null,"\u0074oString":"ok","":[{"zero":-0}]}`;
  for (const [hson, json, code, path, token] of [
    [source, jsonSource, undefined, undefined, undefined],
    [source.replace("-0", "0"), jsonSource.replace("-0", "0"), "INVALID_LITERAL", ["", 0, "zero"], "0"],
    [source.replace('"ok"', '"x"'), jsonSource.replace('"ok"', '"x"'), "INVALID_CONSTRAINT", ["toString"], '"x"'],
  ] as const) {
    for (const { candidate, admit } of static_data_routes(hson, json)) {
      const value = admit();
      assert.ok(ANY_DATA.certify(value).equals(value));
      assert.equal(evaluate_static_schema_candidate(broad, candidate, "data").kind, "valid");
      const result = evaluate_static_schema_candidate(compiled_hson_schema_of(named), candidate, "data");
      if (code === undefined) {
        assert.ok(named.certify(value).equals(value));
        assert.equal(result.kind, "valid");
        continue;
      }
      assert.throws(() => named.certify(value), error => {
        assert.ok(error instanceof HsonSchemaError);
        assert.equal(error.issues[0]?.code, code);
        assert.deepEqual(error.issues[0]?.path, path);
        return true;
      });
      assert.equal(result.kind, "invalid");
      assert.equal(result.issue.code, code);
      assert.deepEqual(result.issue.path, path);
      if ("source" in candidate) {
        const start = hson.lastIndexOf(token);
        assert.deepEqual(result.range, { start, end: start + token.length });
      } else assert.equal(result.range, undefined);
    }
  }

  const closed = Hson.schema`<type "data" root <object <known "number">>>`;
  for (const { candidate, admit } of static_data_routes("<known 1 '10' -0 '2' 0>", '{"known":1,"10":-0,"2":0}')) {
    const value = admit();
    const key = "json" in candidate ? "2" : "10";
    assert.deepEqual(value.entries()?.map(([name]) => name), "json" in candidate ? ["2", "10", "known"] : ["known", "10", "2"]);
    assert.equal(evaluate_static_schema_candidate(broad, candidate, "data").kind, "valid");
    assert.throws(() => closed.certify(value), error => error instanceof HsonSchemaError
      && error.issues[0]?.code === "UNKNOWN_KEY" && error.issues[0]?.path[0] === key);
    const result = evaluate_static_schema_candidate(compiled_hson_schema_of(closed), candidate, "data");
    assert.equal(result.kind, "invalid");
    assert.equal(result.issue.code, "UNKNOWN_KEY");
    assert.deepEqual(result.issue.path, [key]);
    if ("source" in candidate) {
      assert.ok(result.range);
      assert.equal(candidate.source.slice(result.range.start, result.range.end), "'10'");
    } else assert.equal(result.range, undefined);
  }

  for (const source of [String.raw`<toString 1 '\u0074oString' 2>`, '<value title="attribute" 1>', "<value 1", "<p/>"]) {
    assert.throws(() => Hson.data.parse(source));
    assert.equal(evaluate_static_schema_candidate(broad, { source, family: "data" }, "data").kind, "unknown");
  }
  let reads = 0;
  const accessor = Object.defineProperty([null], 0, { get() { reads++; return null; } });
  for (const json of [accessor, [undefined], Array(1), { nested: { invalid: Infinity } }, Object.create({ inherited: true })]) {
    assert.throws(() => Reflect.apply(Hson.data.from, Hson.data, [json]));
    assert.equal(evaluate_static_schema_candidate(broad, { json }, "data").kind, "unknown");
  }
  assert.throws(() => hson_data_from_value(accessor), /must be owned/);
  assert.equal(evaluate_static_schema_candidate(broad, { data: accessor }, "data").kind, "unknown");
  assert.equal(reads, 0);

  let deep: OrderedProjectedValue = -0;
  for (let depth = 0; depth < HSON_MAX_NESTING - 1; depth++) deep = ordered_projected_array([deep]);
  assert.ok(hson_data_from_value(deep));
  assert.equal(evaluate_static_schema_candidate(broad, { data: deep }, "data").kind, "valid");
  const tooDeep = ordered_projected_array([deep]);
  assert.throws(() => hson_data_from_value(tooDeep), /nesting depth/);
  assert.equal(evaluate_static_schema_candidate(broad, { data: tooDeep }, "data").kind, "unknown");
}

export function run_schema_diagnostic_cases(): void {
  const longChain = reference_definitions(6500);
  const requiresX = '<object <k <exact "no"> x <ref "D0">>>';
  const other = '<object <k <exact "yes">>>';
  for (const choices of [[requiresX, other], [other, requiresX]]) {
    const schema = SchemaHandle.fromHson(`<type "data" defs <${longChain}> root <union [${choices.join(", ")}]>>`);
    assert.equal(schema.certify({ k: "yes" }).toHson(), '<k "yes">');
    for (const [candidate, code, expected, received] of [
      [{ k: "no" }, "MISSING_REQUIRED", "string", "missing"],
      [{ k: "no", x: "text" }, "INVALID_SCHEMA", "resource budget", "exhausted"],
    ] as const) {
      assert.throws(() => schema.certify(candidate), error => {
        assert.ok(error instanceof HsonSchemaError);
        assert.deepEqual(error.issues, [{ code, path: ["x"], expected, received, message: "Schema validation failed at x." }]);
        return true;
      });
    }
  }
  const defs = reference_definitions(520);
  for (const [expression, nested] of [
    ['<ref "D0">', false], ['<union [<ref "D0">, "number"]>', false],
    ['<union ["number", <ref "D0">]>', false], ['<array <union [<ref "D0">, "number"]>>', true],
  ] as const) {
    const schema = SchemaHandle.fromHson(`<type "data" defs <${defs}> root ${expression}>`);
    assert.throws(() => schema.certify(nested ? ["x"] : "x"), error => {
      assert.ok(error instanceof HsonSchemaError);
      assert.deepEqual(error.issues, [{ code: "INVALID_SCHEMA", path: nested ? [0] : [],
        expected: "resource budget", received: "exhausted", message: `Schema validation failed at ${nested ? "0" : "root"}.` }]);
      return true;
    });
    if (expression.includes("union")) assert.ok(schema.certify(nested ? [3] : 3));
  }
  const finiteDefs = reference_definitions(520, '<exact "x">');
  const nestedUnion = SchemaHandle.fromHson(`<type "data" defs <${finiteDefs}> root <union [<union [<ref "D0">, <exact 0>]>, <exact false>]>>`);
  assert.throws(() => nestedUnion.certify("x"), error => {
    assert.ok(error instanceof HsonSchemaError);
    assert.deepEqual(error.issues, [{ code: "INVALID_SCHEMA", path: [], expected: "resource budget",
      received: "exhausted", message: "Schema validation failed at root." }]);
    return true;
  });
  for (const { candidate } of static_data_routes('"x"', '"x"')) {
    assert.deepEqual(evaluate_static_schema_candidate(compiled_hson_schema_of(nestedUnion), candidate, "data"), { kind: "unknown" });
  }
  const ordinary = Hson.schema`<type "data" root <union ["string", "number"]>>`;
  assert.throws(() => ordinary.certify(false), error => {
    assert.ok(error instanceof HsonSchemaError);
    assert.deepEqual(error.issues, [{ code: "TYPE_MISMATCH", path: [], expected: "string | number",
      received: "boolean", message: "Schema validation failed at root." }]);
    return true;
  });
  for (const depth of [169, 170]) {
    const result = compile_hson_schema('<type "data" root ' + "<array ".repeat(depth) + '"string"' + ">".repeat(depth + 1));
    assert.equal(result.ok, depth === 169);
    if (!result.ok) assert.deepEqual(result.issues, [{ code: "INVALID_SCHEMA_EXPRESSION", path: ["root", ...Array(depth).fill("array")],
      message: "Hson Schema exceeds the MVP resource limits." }]);
  }
  for (const depth of [168, 169, 252, 253]) {
    const nested = "<array ".repeat(depth) + '"string"' + ">".repeat(depth);
    const result = compile_hson_schema(`<type "data" root <object <value ${nested}>>>`);
    assert.equal(result.ok, depth === 168);
    if (!result.ok) {
      assert.equal(result.issues[0]?.code, depth === 253 ? "INVALID_ROOT" : "INVALID_SCHEMA_EXPRESSION");
      assert.match(result.issues[0]?.message ?? "", depth === 253 ? /Hson nesting depth/ : /MVP resource limits/);
    }
  }
  for (const depth of [167, 168, 169]) {
    const nested = "<array ".repeat(depth) + "<exact 0>" + ">".repeat(depth);
    const source = `<type "data" root <object <value ${nested}>>>`;
    const result = compile_hson_schema(source);
    if (depth === 169) {
      assert.equal(result.ok, false);
      if (!result.ok) assert.deepEqual(result.issues, [{ code: "INVALID_SCHEMA_EXPRESSION",
        path: ["root", "object", "value", ...Array(depth).fill("array")],
        message: "Hson Schema exceeds the MVP resource limits." }]);
      assert.throws(() => SchemaHandle.fromHson(source), /exceeds the MVP resource limits/);
      continue;
    }
    assert.ok(result.ok);
    const schema = SchemaHandle.fromHson(source);
    const readmitted = Hson.schema.fromHson(schema.toHson());
    assert.deepEqual(compiled_hson_schema_of(readmitted).graph, result.value.graph);
    const candidate = (leaf: "0" | "-0") => Hson.data.fromSource("<value " + "[".repeat(depth) + leaf + "]".repeat(depth) + ">");
    const valid = candidate("0");
    assert.equal(readmitted.certify(valid), valid);
    assert.throws(() => readmitted.certify(candidate("-0")), (error: unknown) => {
      assert.ok(error instanceof HsonSchemaError);
      assert.equal(error.issues[0]?.code, "INVALID_LITERAL");
      assert.deepEqual(error.issues[0]?.path, ["value", ...Array(depth).fill(0)]);
      return true;
    });
  }
  // Capture real JS template objects; runtime, rather than a test escape
  // approximation, determines which cooked segments are unavailable.
  const capture = (strings: TemplateStringsArray): TemplateStringsArray => strings;
  const rejected = [
    capture`// \8
<name "Ada">`,
    capture`// \9
<name "Ada">`,
    capture`// \unicode
<name "Ada">`,
    capture`// \xG0
<name "Ada">`,
    capture`// \u{110000}
<name "Ada">`,
  ];
  for (const strings of rejected) assert.throws(() => Reflect.apply(Hson.data, Hson, [strings]),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "HSON_TAGGED_TEMPLATE_REQUIRED");
  const raw = Hson.data.parse`<name "\\n">`;
  assert.deepEqual((raw).materialize(), { name: "\\n" });
  assert.deepEqual((Hson.data.parse`// \n \u0041 \0
<name "Ada">`).materialize(), { name: "Ada" });
  assert.deepEqual((Hson.data.parse`<name "\n">`).materialize(), { name: "\n" });
  const schema: HsonSchema = Hson.schema`<type "data" defs <
    Title <object <kind <exact "title">>>
    Code <object <kind <exact "code"> language "string" body "string">>
    Image <object <kind <exact "image"> url "string">>
  > root <object <items <array <union [<ref "Title">, <ref "Image">, <ref "Code">]>>>>>`;
  const compiled = compiled_hson_schema_of(schema);
  const evaluate = (candidate: unknown) => evaluate_canonical_projected_schema(compiled.graph, admit_projected_value(candidate));
  assert.deepEqual(evaluate({ items: [{ kind: "code" }] }).issues.map(issue => [issue.code, issue.path]), [
    ["MISSING_REQUIRED", ["items", 0, "language"]], ["MISSING_REQUIRED", ["items", 0, "body"]],
  ]);
  assert.deepEqual(evaluate({ items: [{ kind: "code", language: 12, body: false }] }).issues.map(issue => [issue.code, issue.path]), [
    ["TYPE_MISMATCH", ["items", 0, "language"]], ["TYPE_MISMATCH", ["items", 0, "body"]],
  ]);
  // Acceptance remains ordinary union evaluation, including exact object keys.
  for (const [candidate, expected] of [
    [{ items: [{ kind: "title" }] }, true], [{ items: [{ kind: "image", url: "x" }] }, true],
    [{ items: [{ kind: "code", language: "ts", body: "x" }] }, true],
    [{ items: [{ kind: "code" }] }, false], [{ items: [{ kind: "code", language: "ts", body: "x", extra: true }] }, false],
    [{ items: [{}] }, false], [{ items: [{ kind: "unknown" }] }, false],
  ] as const) assert.equal(evaluate(candidate).ok, expected);
  // Missing/unknown evidence retains the previous closest-branch fallback.
  assert.deepEqual(evaluate({ items: [{}] }).issues.map(issue => issue.path), [["items", 0, "kind"]]);
  assert.equal(evaluate({ items: [{ kind: "unknown" }] }).issues[0]?.expected, '"title"');

  const candidate = Hson.data.parse`<items [<kind "code">]>`;
  assert.throws(() => schema.certify(candidate), (error: unknown) => {
    assert.ok(error instanceof HsonSchemaError);
    assert.deepEqual(error.path, ["items", 0, "language"]);
    assert.deepEqual(error.issues.map(issue => issue.path), [["items", 0, "language"], ["items", 0, "body"]]);
    assert.equal(error.issues[0]?.expected, "string"); assert.equal(error.issues[0]?.received, "missing");
    return true;
  });
  const staticFailure = evaluate_static_schema_candidate(compiled, { source: candidate.toHson(), family: "data" }, "data");
  assert.equal(staticFailure.kind, "invalid");
  if (staticFailure.kind === "invalid") {
    assert.deepEqual(staticFailure.issue.path, ["items", 0, "language"]);
    assert.equal((candidate).toHson().slice(staticFailure.range?.start, staticFailure.range?.end), ">");
  }

  const multiKey: HsonSchema = Hson.schema`<type "data" root <object <value <union [
    <object <x <exact "a"> y <exact "a">>>,
    <object <x <exact "b"> z <exact "a"> one "string" two "string" three "string" four "string">>,
    <object <y <exact "b"> z <exact "b">>>
  ]>>>>`;
  const multiKeyResult = evaluate_canonical_projected_schema(compiled_hson_schema_of(multiKey).graph, admit_projected_value({ value: { x: "b", z: "a" } }));
  assert.deepEqual(multiKeyResult.issues.map(issue => issue.path), [["value", "one"], ["value", "two"], ["value", "three"], ["value", "four"]]);
  const conflicting: HsonSchema = Hson.schema`<type "data" root <object <value <union [
    <object <kind <exact "title"> mode <exact "title">>>,
    <object <kind <exact "code"> mode <exact "code"> language "string" body "string">>
  ]>>>>`;
  const conflictingResult = evaluate_canonical_projected_schema(compiled_hson_schema_of(conflicting).graph, admit_projected_value({ value: { kind: "code", mode: "title" } }));
  assert.deepEqual(conflictingResult.issues.map(issue => issue.path), [["value", "kind"]], "Contradictory discriminators retain the fallback");
  const reversed: HsonSchema = Hson.schema`<type "data" root <object <value <union [
    <object <kind <exact "code"> language "string" body "string">>, <object <kind <exact "title">>>
  ]>>>>`;
  assert.deepEqual(evaluate_canonical_projected_schema(compiled_hson_schema_of(reversed).graph, admit_projected_value({ value: { kind: "code" } })).issues.map(issue => issue.path), [["value", "language"], ["value", "body"]]);

  const nodes: readonly CanonicalSchemaNode[] = [
    { kind: "projected-union", choices: [1, 3] },
    { kind: "projected-object", exact: true, properties: [["kind", 2]] },
    { kind: "projected-literal", values: ["title"] },
    { kind: "projected-union", choices: [4, 7] },
    { kind: "projected-object", exact: true, properties: [["kind", 5], ["language", 6], ["body", 6]] },
    { kind: "projected-literal", values: ["code"] },
    { kind: "projected-string" },
    { kind: "projected-object", exact: true, properties: [["kind", 8], ["url", 6]] },
    { kind: "projected-literal", values: ["image"] },
  ];
  const graph = (entries: readonly CanonicalSchemaNode[]) => {
    const verified = verify_canonical_schema_graph({ format: CANONICAL_SCHEMA_FORMAT, capabilities: { projectedRoot: 0 }, nodes: entries });
    assert.ok(verified.ok, JSON.stringify(verified)); return verified.graph;
  };
  for (const [entries, accepted, rejected, path, schemaNode] of [
    [[{ kind: "projected-null" }], null, false, [], 0],
    [[{ kind: "projected-array", item: 1 }, { kind: "projected-null" }], [null], [false], [0], 1],
    [[{ kind: "projected-ref", target: 1 }, { kind: "projected-null" }], null, false, [], 1],
  ] as const) {
    const verified = graph(entries);
    assert.deepEqual(evaluate_canonical_projected_schema(verified, admit_projected_value(accepted)), { ok: true, issues: [] });
    assert.deepEqual(evaluate_canonical_projected_schema(verified, admit_projected_value(rejected)), {
      ok: false, issues: [{ code: "TYPE_MISMATCH", path, schemaNode, expected: "null", received: "boolean",
        evidence: { kind: "type-mismatch" } }],
    });
  }
  {
    const nested = graph(nodes);
    const result = evaluate_canonical_projected_schema(nested, admit_projected_value({ kind: "code" }));
    assert.deepEqual(result.issues.map(issue => issue.path), [["language"], ["body"]]);
  }
  // No unique discriminator: retain the first minimum issue count, even when
  // one branch matches a shared literal. Canonical graphs can express this.
  const ambiguous = graph([
    { kind: "projected-union", choices: [1, 4] },
    { kind: "projected-object", exact: true, properties: [["kind", 2], ["a", 3]] },
    { kind: "projected-literal", values: ["same"] }, { kind: "projected-string" },
    { kind: "projected-object", exact: true, properties: [["kind", 2], ["b", 3], ["c", 3]] },
  ]);
  assert.deepEqual(evaluate_canonical_projected_schema(ambiguous, admit_projected_value({ kind: "same" })).issues.map(issue => issue.path), [["a"]]);

  const doc: HsonSchema = Hson.schema`<type "document" tag "main" attrs <props <lang <exact "en"> hidden "flag"> closed true> content "empty">`;
  const docCompiled = compiled_hson_schema_of(doc);
  for (const source of ['<main lang="fr" hidden/>', '<main hidden/>', '<main lang="en" hidden="no"/>', '<main lang="en" hidden extra="x"/>']) {
    const parsed = parse_hson_with_provenance(source, { allowTopLevelDocumentText: true });
    const canonical = evaluate_canonical_document_schema(docCompiled.graph, parsed.value);
    assert.equal(canonical.ok, false);
    assert.throws(() => doc.certify(hsonTransform.fromHson(source).toHson().serialize()), (error: unknown) => {
      assert.ok(error instanceof HsonSchemaError);
      assert.deepEqual(error.issues.map(issue => ({ code: issue.code, path: issue.path, attributeName: issue.attributeName, expected: issue.expected, received: issue.received })),
        canonical.issues.map(issue => ({ code: issue.code, path: issue.path, attributeName: issue.attributeName, expected: issue.expected, received: issue.received })));
      return true;
    });
    const failure = evaluate_static_schema_candidate(docCompiled, { source, family: "document" }, "detached-document");
    assert.equal(failure.kind, "invalid");
    if (failure.kind === "invalid") {
      assert.equal(failure.issue.attributeName, canonical.issues[0]?.attributeName);
      assert.ok(failure.range);
      assert.ok(source.slice(failure.range.start, failure.range.end).length > 0);
    }
  }
  const unique: HsonSchema = Hson.schema`<type "data" root <object <items <array <content <object <kind "string">> unique <by "kind" cases [["a", ["K"]], ["b", ["K"]]]>>>>>>`;
  const collision = '<items [<kind "a">, <kind "b">]>';
  const failure = evaluate_static_schema_candidate(compiled_hson_schema_of(unique), { source: collision, family: "data" }, "data");
  assert.equal(failure.kind, "invalid");
  if (failure.kind === "invalid") {
    assert.deepEqual(failure.issue.path, ["items", 1, "kind"]);
    assert.deepEqual(failure.issue.evidence.relatedPath, ["items", 0, "kind"]);
    assert.equal(failure.issue.evidence.conflictingKey, "K");
    assert.ok(failure.range); assert.ok(failure.relatedRange);
    assert.equal(collision.slice(failure.range.start, failure.range.end), '"b"');
    assert.equal(collision.slice(failure.relatedRange.start, failure.relatedRange.end), '"a"');
  }

  const page: HsonSchema = Hson.schema`<type "document" tag "html" content <sequence [<tag "head" content "empty">, <tag "body" content <sequence [<tag "main" content <sequence «<tag "h1">»>>]>>]>>`;
  const pageCompiled = compiled_hson_schema_of(page);
  const shell = '<html <head/> <body <main <hson-part lib="bits" at="title" text="Hello"/>/>/>/>';
  const parts = { title: { kind: "document", document: '<h1 hson:part "%{text}"/>' } } satisfies LiveMapPartCollection;
  const inventory = new Map<string, unknown>([["bits", parts]]);
  const candidateDoc = { source: shell, family: "document" } as const;
  const library = { kind: "document-library", name: "page" } as const;
  assert.equal(evaluate_static_schema_candidate(pageCompiled, candidateDoc, library).kind, "unknown");
  assert.equal(evaluate_static_schema_candidate(pageCompiled, candidateDoc, { ...library, parts: new Map() }).kind, "unknown");
  assert.equal(evaluate_static_schema_candidate(pageCompiled, candidateDoc, { ...library, parts: inventory }).kind, "valid");
  assert.equal(evaluate_static_schema_candidate(pageCompiled, { source: shell, family: "canonical" }, { ...library, parts: inventory }).kind, "valid");
  const invalid = evaluate_static_schema_candidate(pageCompiled, candidateDoc,
    { ...library, parts: new Map([["bits", { title: { kind: "document", document: '<p hson:part "%{text}"/>' } }]]) });
  assert.equal(invalid.kind, "invalid");
  if (invalid.kind === "invalid") {
    assert.equal(invalid.issue.expected, '"h1"'); assert.equal(invalid.issue.received, '"p"');
    assert.equal(invalid.range, undefined, "Realized paths must not masquerade as authored source ranges");
  }
  // The existing complete collection validator also checks unused members.
  for (const unavailable of [undefined, {}, { title: parts.title, broken: { kind: "document", document: "<h1" } },
    { title: { kind: "document", document: '<h1 hson:part <hson-part at="title"/>/>' } }]) {
    assert.equal(evaluate_static_schema_candidate(pageCompiled, candidateDoc, { ...library, parts: new Map([["bits", unavailable]]) }).kind, "unknown");
  }
  const nested = new Map<string, unknown>([["bits", {
    title: { kind: "document", document: '<h1 hson:part <hson-part at="child"/>/>' },
    child: { kind: "document", document: '<span hson:part/>' },
  }]]);
  assert.equal(evaluate_static_schema_candidate(pageCompiled,
    { source: '<html <head/> <body <main <hson-part lib="bits" at="title"/>/>/>/>', family: "document" }, { ...library, parts: nested }).kind, "valid");
  const plain = evaluate_static_schema_candidate(pageCompiled, { source: '<html <head/> <body <main <p/>/>/>/>', family: "document" }, library);
  assert.equal(plain.kind, "invalid");
  assert.ok(plain.kind === "invalid" && plain.range !== undefined);
  // Static realization never installs a runtime or touches existing authority.
  const map = hsonLiveMap.fromLibraries({ page: { document: '<main/>' } });
  const aggregate = internal_livemap_aggregate_authority(map);
  const before = { revision: map.rev, position: aggregate.hostedPosition(), ledger: aggregate.identityEpoch().issued(),
    root: map.doc.must("page").snap(), parts: JSON.stringify(parts), shell: candidateDoc.source };
  let commits = 0, positions = 0;
  const stop = map.commits.observe(() => commits++), stopPosition = aggregate.observeAuthorityPosition(() => positions++);
  const random = globalThis.crypto.getRandomValues;
  globalThis.crypto.getRandomValues = () => { throw new Error("Static candidate analysis must not issue QUIDs"); };
  try {
    // A swallowed issuance error would return unknown and fail this assertion.
    assert.equal(evaluate_static_schema_candidate(pageCompiled, candidateDoc, { ...library, parts: inventory }).kind, "valid");
    assert.equal(evaluate_static_schema_candidate(pageCompiled,
      { source: '<html <head/> <body <main <hson-part @:title lib="bits" at="title" text="Hello"/>/>/>/>', family: "document" }, { ...library, parts: inventory }).kind, "valid");
  } finally { globalThis.crypto.getRandomValues = random; stop(); stopPosition(); }
  assert.equal(map.rev, before.revision); assert.deepEqual(aggregate.hostedPosition(), before.position);
  assert.equal(aggregate.identityEpoch().issued(), before.ledger); assert.deepEqual(map.doc.must("page").snap(), before.root);
  assert.equal(commits, 0); assert.equal(positions, 0);
  assert.equal(JSON.stringify(parts), before.parts); assert.equal(candidateDoc.source, before.shell);
  const realized = hsonLiveMap.fromLibraries({ page: { document: shell, schema: page }, bits: { parts } });
  assert.match(realized.doc.must("page").render(), /<h1>Hello<\/h1>/);
  check_static_data_qualification();
}
