import assert from "node:assert/strict";
import { Hson, hsonTransform, type HsonSchema } from "../src/index.ts";
import { compile_hson_schema, HSON_SCHEMA_MVP_BOOTSTRAP } from "../src/internal/hson-schema/compiler.ts";
import { decode_canonical_schema_graph_hson, encode_canonical_schema_graph_hson } from "../src/internal/canonical-schema/encode-hson.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

let checks = 0;
const check = (name: string, run: () => void): void => { run(); console.log(`ok ${++checks} - ${name}`); };
const compile = (body: string) => compile_hson_schema(`<type "data" content <${body}>>`);

check("valid primitive and closed structure lower deterministically", () => {
  const left = compile('name "string" active "boolean" nothing "null" score "number"');
  const right = compile('name "string" active "boolean" nothing "null" score "number"');
  assert.equal(left.ok, true); assert.equal(right.ok, true);
  if (left.ok && right.ok) { assert.deepEqual(left.value.graph, right.value.graph); assert.deepEqual(left.value.graph.nodes.map((node) => node.kind), ["projected-object", "projected-string", "projected-boolean", "projected-null", "projected-number"]); }
});
check("invalid root envelope rejects", () => assert.equal(compile_hson_schema('<type "document" content <>>').ok, false));
check("unknown Schema member rejects", () => { const result = compile('value <literal "x">'); assert.equal(result.ok, false); if (!result.ok) assert.equal(result.issues[0]?.code, "UNKNOWN_SCHEMA_MEMBER"); });
check("optional is direct-member-only", () => { const result = compile('items <array <optional "string">>'); assert.equal(result.ok, false); if (!result.ok) assert.equal(result.issues[0]?.code, "ILLEGAL_OPTIONAL"); });
check("exact primitives preserve zero sign", () => {
  const positive = compile('value <exact 0>'), negative = compile('value <exact -0>');
  assert.equal(positive.ok, true); assert.equal(negative.ok, true);
  if (positive.ok && negative.ok) {
    const a = positive.value.graph.nodes[1], b = negative.value.graph.nodes[1];
    assert.equal(a?.kind, "projected-literal"); assert.equal(b?.kind, "projected-literal");
    if (a?.kind === "projected-literal" && b?.kind === "projected-literal") { assert.equal(Object.is(a.values[0], 0), true); assert.equal(Object.is(b.values[0], -0), true); }
  }
});
check("optional, array, tuple and empty tuple lower", () => {
  const result = compile('nick <optional "string"> values <array "number"> pair <tuple ["string", "boolean"]> empty <tuple []>');
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value.graph.nodes.map((node) => node.kind), ["projected-object", "projected-optional", "projected-string", "projected-array", "projected-number", "projected-tuple", "projected-string", "projected-boolean", "projected-tuple"]);
});
check("primitive and discriminated unions lower", () => {
  assert.equal(compile('value <union ["string", "number"]>').ok, true);
  assert.equal(compile('account <union [<content <kind <exact "user">>>, <content <kind <exact "admin">>>]>').ok, true);
  assert.equal(compile('bad <union ["string", <exact "x">]>').ok, false);
});
check("bootstrap has a deterministic authored Hson machine representation", () => {
  const authored = encode_canonical_schema_graph_hson(HSON_SCHEMA_MVP_BOOTSTRAP);
  const decoded = decode_canonical_schema_graph_hson(authored);
  assert.equal(decoded.ok, true); if (decoded.ok) assert.deepEqual(decoded.graph, HSON_SCHEMA_MVP_BOOTSTRAP);
});
check("runtime validation returns unchanged canonical identity", () => {
  const schema: HsonSchema = Hson`<type "data" content <name "string" score "number">>`;
  const candidate = Hson`<name "Ada" score 37>`;
  assert.equal(Hson.validate(schema, candidate), candidate);
  assert.throws(() => Hson.validate(schema, Hson`<name "Ada" score "37">`));
  const dynamic = hsonTransform.fromJson({ name: "Ada", score: 37 }).toHson().serialize();
  assert.equal(Hson.validate(schema, dynamic), dynamic);
});

emit_hson_live_test_completion("hson-schema-mvp", checks, checks, 0);
