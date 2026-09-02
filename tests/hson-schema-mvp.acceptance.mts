import assert from "node:assert/strict";
import { Hson, hsonTransform, type HsonSchema } from "../src/index.ts";
import { compile_hson_schema, HSON_SCHEMA_MVP_BOOTSTRAP } from "../src/internal/hson-schema/compiler.ts";
import { decode_canonical_schema_graph_hson, encode_canonical_schema_graph_hson } from "../src/internal/canonical-schema/encode-hson.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "hson-schema-mvp",
  title: "Hson Schema MVP",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["hson-schema", "compiler", "canonical-schema"]),
});

const testEvents = create_test_event_emitter("hson-schema-mvp");
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
check("finite exact primitive domains lower when every branch is canonically disjoint", () => {
  const cases = [
    'value <union [<exact "lobby">, <exact "ready">]>',
    'value <union [<exact "lobby">, <union [<exact "ready">, <union [<exact "playing">, <exact "finished">]>]>]>',
    'value <union [<exact "player1">, <union [<exact "player2">, "null"]>]>',
    'value <union [<exact 1>, <exact 2>]>',
    'value <union [<exact true>, <exact false>]>',
  ];
  for (const source of cases) assert.equal(compile(source).ok, true, source);
  const signedZero = compile('value <union [<exact 0>, <exact -0>]>');
  assert.equal(signedZero.ok, true);
  if (signedZero.ok) {
    const literals = signedZero.value.graph.nodes.filter((node) => node.kind === "projected-literal");
    assert.equal(literals.length, 2);
    assert.equal(literals[0]?.kind === "projected-literal" && Object.is(literals[0].values[0], 0), true);
    assert.equal(literals[1]?.kind === "projected-literal" && Object.is(literals[1].values[0], -0), true);
  }
});
check("finite exact primitive domains reject every unproved or overlapping combination", () => {
  for (const source of [
    'value <union [<exact "same">, <exact "same">]>',
    'value <union [<exact 1>, <exact 1>]>',
    'value <union [<exact true>, <exact true>]>',
    'value <union ["null", "null"]>',
    'value <union [<exact null>, <exact null>]>',
    'value <union [<exact null>, "null"]>',
    'value <union [<exact "a">, <union [<exact "b">, <exact "a">]>]>',
    'value <union [<exact "x">, "string"]>',
    'value <union [<exact "x">, <string <prefix "y">>]>',
    'value <union [<exact 1>, "number"]>',
    'value <union [<exact 1>, <number <min 2>>]>',
    'value <union [<exact true>, "boolean"]>',
    'value <union [<union [<exact "a">, <exact "b">]>, "string"]>',
    'value <union [<union [<exact "a">, <exact "b">]>, <string <prefix "z">>]>',
  ]) assert.equal(compile(source).ok, false, source);
});
check("runtime certification accepts every finite-domain member and rejects outsiders", () => {
  const schema: HsonSchema = Hson`<type "data" content <
    phase <union [<exact "lobby">, <union [<exact "ready">, <union [<exact "playing">, <exact "finished">]>]>]>
    turn <union [<exact "player1">, <union [<exact "player2">, "null"]>]>
    score <union [<exact 1>, <exact 2>]>
    zero <union [<exact 0>, <exact -0>]>
    flag <union [<exact true>, <exact false>]>
  >>`;
  for (const candidate of [
    Hson`<phase "lobby" turn "player1" score 1 zero 0 flag true>`,
    Hson`<phase "ready" turn "player2" score 2 zero -0 flag false>`,
    Hson`<phase "playing" turn null score 1 zero 0 flag false>`,
    Hson`<phase "finished" turn "player1" score 2 zero -0 flag true>`,
  ]) assert.equal(Hson.certify(schema, candidate), candidate);
  assert.throws(() => Hson.certify(schema, Hson`<phase "paused" turn "player1" score 1 zero 0 flag true>`));
  assert.throws(() => Hson.certify(schema, Hson`<phase "lobby" turn "player3" score 1 zero 0 flag true>`));
  assert.throws(() => Hson.certify(schema, Hson`<phase "lobby" turn "player1" score 3 zero 0 flag true>`));
});
check("bootstrap has a deterministic authored Hson machine representation", () => {
  const authored = encode_canonical_schema_graph_hson(HSON_SCHEMA_MVP_BOOTSTRAP);
  const decoded = decode_canonical_schema_graph_hson(authored);
  assert.equal(decoded.ok, true); if (decoded.ok) assert.deepEqual(decoded.graph, HSON_SCHEMA_MVP_BOOTSTRAP);
});
check("approved refinements lower directly to canonical rules", () => {
  const source = 'age <number <int true min 0 max 130 over -1 under 131>> code <string <len 4 prefix "ID" suffix "7" contains "-">> names <array <content "string" unique true minlen 1 maxlen 3>> pair <tuple <content ["string", "number"] len 2>>';
  const result = compile(source), repeated = compile(source);
  assert.equal(result.ok, true);
  assert.equal(repeated.ok, true);
  if (result.ok && repeated.ok) {
    assert.deepEqual(result.value.graph, repeated.value.graph);
    assert.deepEqual(result.value.graph.nodes.filter((node) => node.kind === "projected-refinement").map((node) => node.kind === "projected-refinement" ? node.rule : undefined), [
    { kind: "integer" },
    { kind: "number-lower-bound", value: 0, inclusive: true },
    { kind: "number-upper-bound", value: 130, inclusive: true },
    { kind: "number-lower-bound", value: -1, inclusive: false },
    { kind: "number-upper-bound", value: 131, inclusive: false },
    { kind: "string-pattern", dialect: "literal-string-v1", mode: "prefix", pattern: "ID" },
    { kind: "string-pattern", dialect: "literal-string-v1", mode: "suffix", pattern: "7" },
    { kind: "string-pattern", dialect: "literal-string-v1", mode: "contains", pattern: "-" },
    { kind: "string-length", minimum: 4, maximum: 4 },
    { kind: "array-unique" },
    { kind: "collection-length", minimum: 1, maximum: 3 },
    { kind: "collection-length", minimum: 2, maximum: 2 },
    ]);
  }
});
check("refinement grammar rejects illegal domains and malformed operands", () => {
  for (const body of [
    'x <number <prefix "x">>', 'x <string <int true>>', 'x <array <content "string" prefix "x">>',
    'x <tuple <content ["string"] unique true>>', 'x <number <int false>>', 'x <number <min "0">>',
    'x <string <len -1>>', 'x <string <minlen 3 maxlen 2>>', 'x <string <len 2 minlen 1>>',
    'x <array <unique true>>', 'x <number <minimum 0>>', 'x <number <min 2 under 2>>',
    'x <number <int true over 0 under 1>>', 'x <string <prefix <exact "x">>>',
  ]) assert.equal(compile(body).ok, false, body);
});
check("duplicate refinement members fail in the Hson parser", () => assert.equal(compile('x <number <min 0 min 1>>').ok, false));
check("refinement diagnostics retain exact authored source provenance", () => {
  const result = compile('x <number <min "bad">>');
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.deepEqual(result.issues[0]?.path, ["content", "x", "number", "min"]);
    assert.ok(result.issues[0]?.range !== undefined);
  }
});
check("refinement evaluation covers numeric, Unicode, literals, length, and uniqueness", () => {
  const schema: HsonSchema = Hson`<type "data" content <age <number <int true min 0 under 130>> code <string <len 4 prefix "ID" suffix "7" contains "-">> glyph <string <len 1>> values <array <content "number" unique true minlen 1 maxlen 2>>>>`;
  const valid = Hson`<age 0 code "ID-7" glyph "😀" values [0, -0]>`;
  assert.equal(Hson.certify(schema, valid), valid);
  const dynamic = hsonTransform.fromJson({ age: 12, code: "ID-7", glyph: "😀", values: [1, 2] }).toHson().serialize();
  assert.equal(Hson.certify(schema, dynamic), dynamic);
  const invalidDynamic = hsonTransform.fromJson({ age: 12.5, code: "ID-7", glyph: "😀", values: [1, 1] }).toHson().serialize();
  assert.throws(() => Hson.certify(schema, invalidDynamic));
  for (const invalid of [
    Hson`<age 1.5 code "ID-7" glyph "😀" values [1]>`,
    Hson`<age -1 code "ID-7" glyph "😀" values [1]>`,
    Hson`<age 130 code "ID-7" glyph "😀" values [1]>`,
    Hson`<age 1 code "XX-7" glyph "😀" values [1]>`,
    Hson`<age 1 code "ID-X" glyph "😀" values [1]>`,
    Hson`<age 1 code "ID77" glyph "😀" values [1]>`,
    Hson`<age 1 code "ID--7" glyph "😀" values [1]>`,
    Hson`<age 1 code "ID-7" glyph "é" values [1]>`,
    Hson`<age 1 code "ID-7" glyph "😀" values []>`,
    Hson`<age 1 code "ID-7" glyph "😀" values [1, 1]>`,
  ]) assert.throws(() => Hson.certify(schema, invalid));
  const bounds: HsonSchema = Hson`<type "data" content <n <number <over 0 max 2>>>>`;
  assert.doesNotThrow(() => Hson.certify(bounds, Hson`<n 1>`));
  assert.doesNotThrow(() => Hson.certify(bounds, Hson`<n 2>`));
  assert.throws(() => Hson.certify(bounds, Hson`<n 0>`));
  assert.throws(() => Hson.certify(bounds, Hson`<n 3>`));
  const empty: HsonSchema = Hson`<type "data" content <s <string <len 0 prefix "" suffix "" contains "">> xs <array <content "number" len 0 unique true>>>>`;
  assert.doesNotThrow(() => Hson.certify(empty, Hson`<s "" xs []>`));
});
check("runtime validation returns unchanged canonical identity", () => {
  const schema: HsonSchema = Hson`<type "data" content <name "string" score "number">>`;
  const candidate = Hson`<name "Ada" score 37>`;
  assert.equal(Hson.certify(schema, candidate), candidate);
  assert.throws(() => Hson.certify(schema, Hson`<name "Ada" score "37">`));
  const dynamic = hsonTransform.fromJson({ name: "Ada", score: 37 }).toHson().serialize();
  assert.equal(Hson.certify(schema, dynamic), dynamic);
});

testEvents.terminal("pass");
