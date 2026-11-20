import assert from "node:assert/strict";
import test from "node:test";
import { Hson } from "../../src/hson-authoring.js";
import { HsonDataValue } from "../../src/api/data/hson-data.js";
import { HsonSchemaError } from "../../src/api/livemap/livemap.error.js";
import { compiled_hson_schema_of, HsonSchema, hson_schema_digest } from "../../src/api/schema/hson-schema.js";
import { parse_canonical_hson_data, serialize_canonical_hson_data } from "../../src/core/hson-data-canonical-codec.js";
import { schema_definition_identity } from "../../src/internal/hson-schema/definition-identity.js";
import { generate_hson_schema_evidence } from "../../src/internal/hson-schema/generated-evidence.js";
import { compile_schema_source } from "./compile-source.js";

// Hand-authored wire operands. Digests are SHA-256 of the ordered, type-tagged
// definition tuples, computed independently of the reader, lowerer and compiler.
const roots = [
  {
    expression: "<string>", operand: '"string"', type: "string", accept: '"x"', reject: "1",
    digest: "0a65ca3abd5eb38f3c2f22b864c7596003ab5f7ff4706997114adfd8d656fec1",
    issue: { code: "TYPE_MISMATCH", path: [], expected: "string", received: "number" },
  },
  {
    expression: '<number int min="0">', operand: "<number <int true min 0>>", type: "number", accept: "0", reject: "-1",
    digest: "b9b873b63efce8f5e03448feb9fb6ba98203516ea6a16ee1606cff67b5f4260e",
    issue: { code: "INVALID_CONSTRAINT", path: [], expected: "min", received: "-1" },
  },
  {
    expression: "<boolean>", operand: '"boolean"', type: "boolean", accept: "false", reject: "0",
    digest: "0d3a7cc235c0990c4e08b72eb3c958a1c18cc653438df2add9834accfd627a17",
    issue: { code: "TYPE_MISMATCH", path: [], expected: "boolean", received: "number" },
  },
  {
    expression: "<null>", operand: '"null"', type: "null", accept: "null", reject: "false",
    digest: "dd4fe18e0dbaf914620ac7013b44ceaa749fe2ca095b6de11cd2962572945abe",
    issue: { code: "TYPE_MISMATCH", path: [], expected: "null", received: "boolean" },
  },
  {
    expression: "<array <string>>", operand: '<array "string">', type: "ReadonlyArray<string>", accept: '["x"]', reject: "[1]",
    digest: "c92bb3528b91e72be7038bbcbbf2c3f6e9817063e4d4dab0cc48ad6774261f6d",
    issue: { code: "TYPE_MISMATCH", path: [0], expected: "string", received: "number" },
  },
  {
    expression: "<tuple [<string>, <number>]>", operand: '<tuple ["string", "number"]>', type: "readonly [string, number]",
    accept: '["x", 2]', reject: '["x"]', digest: "2bbef0479d47fd49815ba79f189a9f2a118a4036c24189cc6db763d3c752a199",
    issue: { code: "MISSING_REQUIRED", path: [1], expected: "number", received: "missing" },
  },
  {
    expression: "<union [<string>, <number>]>", operand: '<union ["string", "number"]>', type: "(string) | (number)",
    accept: "2", reject: "false", digest: "bfe9b82f5ca25d8106a29d2530bd2daa8787033dcbcc08838ce76c26952f4c93",
    issue: { code: "TYPE_MISMATCH", path: [], expected: "string | number", received: "boolean" },
  },
  {
    expression: '<exact "ready">', operand: '<exact "ready">', type: '"ready"', accept: '"ready"', reject: '"later"',
    digest: "c58e89ba926d5758e8b1d326ed0421d6bbeb2b662bc6f1210ced01fbbcb09432",
    issue: { code: "INVALID_LITERAL", path: [], expected: '"ready"', received: '"later"' },
  },
] as const;

function compile(source: string) {
  const result = compile_schema_source(source);
  assert.ok(result.ok, result.ok ? undefined : JSON.stringify(result.issues));
  return result;
}

for (const { expression, operand, digest, type, accept, reject, issue } of roots) {
  test(`direct ${expression} retains its contract through Schema transport and evidence generation`, () => {
    const result = compile(`<data ${expression}>`);
    const definition = parse_canonical_hson_data(`<type "data" root ${operand}>`);
    const canonical = serialize_canonical_hson_data(definition);
    assert.deepEqual(result.orderedDefinition, definition);
    assert.deepEqual(result.compiled.orderedDefinition, definition);
    assert.equal(result.schema1Source, canonical);
    assert.deepEqual(result.compiled.symbols, { definitions: [], references: [] });
    assert.equal(result.compiled.canonicalRefCount, 0);
    assert.equal(result.originAt(["root"]), result.root.body);
    const handle = HsonSchema.fromHson(result.schema1Source);
    const restored = Hson.schema.fromHson(handle.toHson());
    assert.notEqual(restored, handle);
    for (const schema of [handle, restored]) {
      const compiled = compiled_hson_schema_of(schema);
      assert.equal(schema.toHson(), canonical);
      assert.deepEqual(compiled.graph, result.compiled.graph);
      assert.deepEqual(schema_definition_identity(compiled), schema_definition_identity(result.compiled));
      assert.equal(hson_schema_digest(schema), digest);
      const candidate = HsonDataValue.fromSource(accept);
      assert.equal(schema.certify(candidate), candidate);
      assert.throws(() => schema.certify(HsonDataValue.fromSource(reject)), error => {
        assert.ok(error instanceof HsonSchemaError);
        assert.deepEqual(error.issues, [{ ...issue, message: `Schema validation failed at ${issue.path.join(".") || "root"}.` }]);
        return true;
      });
    }
    const evidence = generate_hson_schema_evidence("Root", restored.toHson(), "test#Root");
    assert.equal(evidence.declaration, "/* Generated by Hson Schema. Do not edit. */\n"
      + "declare const __Identity: unique symbol;\n"
      + `export type Evidence = Readonly<{ value: ${type}; mode: "data"; identity: typeof __Identity }>;\n`);
  });
}

test("signed exact values and ordered root refinements survive re-admission", () => {
  const restored = (expr: string) => Hson.schema.fromHson(HsonSchema.fromHson(compile(`<data ${expr}>`).schema1Source).toHson());
  const positive = restored("<exact 0>"), negative = restored("<exact -0>");
  assert.notEqual(hson_schema_digest(positive), hson_schema_digest(negative));
  assert.ok(Object.is(negative.certify(-0).scalar(), -0));
  assert.ok(Object.is(positive.certify(0).scalar(), 0));
  assert.throws(() => negative.certify(0), HsonSchemaError);
  assert.throws(() => positive.certify(-0), HsonSchemaError);
  const first = restored('<number int min="0">'), second = restored('<number min="0" int>');
  assert.notEqual(hson_schema_digest(first), hson_schema_digest(second));
  for (const schema of [first, second]) {
    assert.equal(schema.certify(2).scalar(), 2);
    assert.throws(() => schema.certify(0.5), HsonSchemaError);
  }
});

test("a direct tuple resolves authored forward and productive recursive references", () => {
  const result = compile(`<data
    <defs <'A' <ref "B"> 'B' <object <'next' optional <ref "A">>>>>
    <tuple [<ref "A">]>
  >`);
  assert.deepEqual(result.compiled.definitions.map(definition => definition.name), ["A", "B"]);
  assert.deepEqual(result.compiled.referenceUses.map(use => use.name), ["B", "A", "A"]);
  assert.equal(result.compiled.recursiveSccCount, 1);
  const schema = Hson.schema.fromHson(HsonSchema.fromHson(result.schema1Source).toHson());
  assert.deepEqual(compiled_hson_schema_of(schema).graph, result.compiled.graph);
  const valid = HsonDataValue.fromSource("[<next <next <>>>]");
  assert.equal(schema.certify(valid), valid);
  assert.throws(() => schema.certify(HsonDataValue.fromSource("[<next false>]")), error => {
    assert.ok(error instanceof HsonSchemaError);
    assert.deepEqual(error.issues, [{ code: "TYPE_MISMATCH", path: [0, "next"], expected: "object", received: "boolean",
      message: "Schema validation failed at 0.next." }]);
    return true;
  });
});
