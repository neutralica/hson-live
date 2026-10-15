import assert from "node:assert/strict";
import { Hson, type HsonSchema } from "../../src/hson-authoring.ts";
import { HsonSchemaError } from "../../src/api/livemap/livemap.error.ts";
import { hsonTransform } from "../../src/api/transform/index.ts";
import { compiled_hson_schema_of } from "../../src/api/schema/hson-schema.ts";
import { admit_projected_value } from "../../src/core/projected-value-admission.ts";
import { evaluate_canonical_document_schema, evaluate_canonical_projected_schema } from "../../src/internal/canonical-schema/evaluate.ts";
import { CANONICAL_SCHEMA_FORMAT, type CanonicalSchemaNode } from "../../src/internal/canonical-schema/graph.ts";
import { verify_canonical_schema_graph } from "../../src/internal/canonical-schema/verify.ts";
import { parse_hson_with_provenance } from "../../src/internal/hson-source-provenance/parse-hson-with-provenance.ts";
import { evaluate_static_schema_candidate } from "../../src/internal/hson-schema/candidate-evaluation.ts";

export function run_schema_diagnostic_cases(): void {
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
  const raw = Hson.data`<name "\\n">`;
  assert.deepEqual(Hson.data.materialize(raw), { name: "\\n" });
  assert.deepEqual(Hson.data.materialize(Hson.data`// \n \u0041 \0
<name "Ada">`), { name: "Ada" });
  assert.deepEqual(Hson.data.materialize(Hson.data`<name "\n">`), { name: "\n" });
  const schema: HsonSchema = Hson.schema`<type "data" defs <
    Title <content <kind <exact "title">>>
    Code <content <kind <exact "code"> language "string" body "string">>
    Image <content <kind <exact "image"> url "string">>
  > content <items <array <union [<ref "Title">, <ref "Image">, <ref "Code">]>>>>`;
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

  const candidate = Hson.data`<items [<kind "code">]>`;
  assert.throws(() => schema.certify(candidate), (error: unknown) => {
    assert.ok(error instanceof HsonSchemaError);
    assert.deepEqual(error.path, ["items", 0, "language"]);
    assert.deepEqual(error.issues.map(issue => issue.path), [["items", 0, "language"], ["items", 0, "body"]]);
    assert.equal(error.issues[0]?.expected, "string"); assert.equal(error.issues[0]?.received, "missing");
    return true;
  });
  const staticFailure = evaluate_static_schema_candidate(compiled, { source: candidate, family: "data" });
  assert.equal(staticFailure.kind, "invalid");
  if (staticFailure.kind === "invalid") {
    assert.deepEqual(staticFailure.issue.path, ["items", 0, "language"]);
    assert.equal(candidate.slice(staticFailure.range?.start, staticFailure.range?.end), ">");
  }

  const multiKey: HsonSchema = Hson.schema`<type "data" content <value <union [
    <content <x <exact "a"> y <exact "a">>>,
    <content <x <exact "b"> z <exact "a"> one "string" two "string" three "string" four "string">>,
    <content <y <exact "b"> z <exact "b">>>
  ]>>>`;
  const multiKeyResult = evaluate_canonical_projected_schema(compiled_hson_schema_of(multiKey).graph, admit_projected_value({ value: { x: "b", z: "a" } }));
  assert.deepEqual(multiKeyResult.issues.map(issue => issue.path), [["value", "one"], ["value", "two"], ["value", "three"], ["value", "four"]]);
  const conflicting: HsonSchema = Hson.schema`<type "data" content <value <union [
    <content <kind <exact "title"> mode <exact "title">>>,
    <content <kind <exact "code"> mode <exact "code"> language "string" body "string">>
  ]>>>`;
  const conflictingResult = evaluate_canonical_projected_schema(compiled_hson_schema_of(conflicting).graph, admit_projected_value({ value: { kind: "code", mode: "title" } }));
  assert.deepEqual(conflictingResult.issues.map(issue => issue.path), [["value", "kind"]], "Contradictory discriminators retain the fallback");
  const reversed: HsonSchema = Hson.schema`<type "data" content <value <union [
    <content <kind <exact "code"> language "string" body "string">>, <content <kind <exact "title">>>
  ]>>>`;
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
    const failure = evaluate_static_schema_candidate(docCompiled, { source, family: "document" });
    assert.equal(failure.kind, "invalid");
    if (failure.kind === "invalid") {
      assert.equal(failure.issue.attributeName, canonical.issues[0]?.attributeName);
      assert.ok(failure.range);
      assert.ok(source.slice(failure.range.start, failure.range.end).length > 0);
    }
  }
  const unique: HsonSchema = Hson.schema`<type "data" content <items <array <content <content <kind "string">> unique <by "kind" cases [["a", ["K"]], ["b", ["K"]]]>>>>>`;
  const collision = '<items [<kind "a">, <kind "b">]>';
  const failure = evaluate_static_schema_candidate(compiled_hson_schema_of(unique), { source: collision, family: "data" });
  assert.equal(failure.kind, "invalid");
  if (failure.kind === "invalid") {
    assert.deepEqual(failure.issue.path, ["items", 1, "kind"]);
    assert.deepEqual(failure.issue.evidence.relatedPath, ["items", 0, "kind"]);
    assert.equal(failure.issue.evidence.conflictingKey, "K");
    assert.ok(failure.range); assert.ok(failure.relatedRange);
    assert.equal(collision.slice(failure.range.start, failure.range.end), '"b"');
    assert.equal(collision.slice(failure.relatedRange.start, failure.relatedRange.end), '"a"');
  }
}
