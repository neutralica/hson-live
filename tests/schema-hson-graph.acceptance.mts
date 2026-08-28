import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import { HSON } from "../src/hson-authoring.ts";
import { LiveMapSchemaError } from "../src/api/livemap/livemap.error.ts";
import { is_transform_error } from "../src/core/errors.ts";
import { parse_hson_with_provenance } from "../src/internal/hson-source-provenance/parse-hson-with-provenance.ts";
import { projected_value_from_hson_node } from "../src/core/projected-value-graph.ts";
import { materialize_projected_value } from "../src/core/projected-value-materialization.ts";
import { validate_livemap_schema_projected_root } from "../src/api/livemap/livemap.schema.ts";
import { TrustedSchemaDiagnosticRuntime } from "../src/internal/trusted-schema-diagnostics/runtime.ts";
import type { TrustedSchemaDirectSource, TrustedSchemaRequest } from "../src/internal/trusted-schema-diagnostics/protocol.ts";
import * as schemas from "./fixtures/schema-hson-graph.fixture.mts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

let checks = 0;
const check = async (name: string, run: () => unknown | Promise<unknown>) => { await run(); console.log(`ok ${++checks} - ${name}`); };
const runtime = new TrustedSchemaDiagnosticRuntime(1);
const moduleUrl = new URL("./fixtures/schema-hson-graph.fixture.mts", import.meta.url).href;
const envelope = { protocolVersion: 1, runtimeGeneration: 1, requestId: "graph" };
const load = await runtime.handle({ ...envelope, type: "load", moduleUrl, hsonModuleUrl: new URL("../src/hson.ts", import.meta.url).href });
assert.equal(load.type, "loaded", load.message);
const cases: readonly [string, keyof typeof schemas.trustedSchemas, string, boolean][] = [
  ["integer key ordering rejects reordered literal", "integer", "<'2' \"b\" '1' \"a\">", false],
  ["ordinary key ordering rejects reordered literal", "ordinary", '<b 2 a 1>', false],
  ["nested structured literal ordering is preserved", "nested", '<value <b 2 a 1>>', false],
  ["positive zero remains positive", "zero", '0', true],
  ["negative zero remains negative", "negativeZero", '-0', true],
  ["zero cannot satisfy negative-zero literal", "negativeZero", '0', false],
  ["negative zero cannot satisfy zero literal", "zero", '-0', false],
  ["exact object rejects unknown member", "exact", '<age 37 extra true>', false],
  ["open object permits unknown member", "open", '<age 37 extra true>', true],
  ["labeled constraint is enforced", "constrained", '<age -1>', false],
  ["recurse retains existing authority", "recursive", '<age "37">', false],
  ["element root validates", "element", '<button/>', true],
  ["element wrong tag fails", "element", '<span/>', false],
  ["fragment layout validates", "fragment", '<a/> <b/>', true],
  ["element is not coerced to fragment", "fragment", '<a/>', false],
  ["attribute and flag case validates", "attrs", '<button disabled/>', true],
  ["invalid attr and missing flag fail", "attrs", '<button count="bad"/>', false],
  ["tuple projected root validates", "tuple", '[1, "x"]', true],
  ["pick projected scalar validates", "pick", '"text"', true],
  ["tagged choice retains branch diagnostics", "tagged", '<kind "user" age "37">', false],
];
for (const [name, id, source, valid] of cases) await check(name, async () => {
  const canonical = hson.fromHson(source).toHson().serialize();
  const schema = schemas.trustedSchemas[id];
  if (valid) assert.equal(hson.liveMap.schema.validate(schema, canonical), canonical);
  else assert.throws(() => hson.liveMap.schema.validate(schema, canonical), LiveMapSchemaError);
  const directSource: TrustedSchemaDirectSource = { templateId: name, callId: name, documentRevision: 1, templateRevision: 1, associationRevision: 1, binding: { moduleUrl, exportName: id } };
  const associated = await runtime.handle({ ...envelope, type: "associate-source", associationId: name, schemaId: id, directSource });
  assert.equal(associated.type, "associated", associated.message);
  const request: TrustedSchemaRequest = { ...envelope, type: "validate", associationId: name, schemaId: id, directSource, source, templateRevision: 1, candidateRevision: 1 };
  const result = await runtime.handle(request);
  assert.equal(result.result?.status, valid ? "VALID" : "INVALID", result.message);
});
await check("old materialize → validateRoot incorrectly accepts integer-order counterexample", async () => {
  const graph = parse_hson_with_provenance("<'2' \"b\" '1' \"a\">").value;
  const carrier = projected_value_from_hson_node(graph);
  assert.equal(validate_livemap_schema_projected_root(schemas.integer, carrier).ok, false);
  assert.equal(schemas.integer.validateRoot(materialize_projected_value(carrier)).ok, true);
  const lifecycle = load.associations?.[0]; assert.ok(lifecycle);
  assert.equal(lifecycle.attachment, "rejected");
  await runtime.handle({ ...envelope, type: "associate", associationId: lifecycle.associationId });
  assert.equal((await runtime.handle({ ...envelope, type: "validate", associationId: lifecycle.associationId, schemaId: "integer", templateRevision: lifecycle.templateRevision, candidateRevision: 1, source: lifecycle.source })).result?.status, "INVALID");
  console.log('# integer order: old outer round trip ACCEPT; direct authority / D1 / validate REJECT');
});
await check("ordinary scalar string is never retried as a text fragment", () => {
  const canonical = HSON`"text"`;
  const fragment = hson.liveMap.schema.define(s => s.tuple(s.string));
  assert.throws(() => hson.liveMap.schema.validate(fragment, canonical), (e: unknown) => e instanceof LiveMapSchemaError && e.issues[0]?.code === "TYPE_MISMATCH");
  assert.equal(hson.liveMap.schema.validate(schemas.text, canonical), canonical);
});
await check("unsupported and attrs-only Schemas fail INVALID_SCHEMA", () => {
  for (const schema of [{}, hson.liveMap.schema.define(s => s.attrs({ disabled: s.flag }))]) {
    assert.throws(() => hson.liveMap.schema.validate(schema, HSON`<button/>`), (e: unknown) => e instanceof LiveMapSchemaError && e.issues[0]?.code === "INVALID_SCHEMA");
  }
});
await check("untyped misuse and Transform errors preserve their authority", () => {
  assert.throws(() => Reflect.apply(hson.liveMap.schema.validate, undefined, [schemas.text, 1]), TypeError);
  assert.throws(() => Reflect.apply(hson.liveMap.schema.validate, undefined, [schemas.text, '<broken']), is_transform_error);
  const unnormalized = '  "text"  ';
  assert.equal(Reflect.apply(hson.liveMap.schema.validate, undefined, [schemas.text, unnormalized]), unnormalized);
});
await check("constraints receive JS values and exceptions propagate unchanged", () => {
  assert.throws(() => hson.liveMap.schema.validate(schemas.throwing, HSON`1`), /constraint sentinel/);
  let keys: string[] = [];
  const schema = hson.liveMap.schema.define(s => s.object({ "1": s.string, "2": s.string }).constrain(value => { keys = Object.keys(value); return true; }));
  hson.liveMap.schema.validate(schema, HSON`<'2' "b" '1' "a">`);
  assert.deepEqual(keys, ["1", "2"]);
});
emit_hson_live_test_completion("schema-hson-graph", checks, checks, 0);
