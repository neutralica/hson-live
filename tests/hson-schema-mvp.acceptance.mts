import assert from "node:assert/strict";
import { Hson, hsonLiveMap, hsonTransform, type HsonSchema } from "../src/index.ts";
import { make_hosted_registry } from "../src/api/livemap/livemap.hosted.ts";
import { generate_hson_schema_evidence } from "../src/internal/hson-schema/generated-evidence.ts";
import { compile_hson_schema, HSON_SCHEMA_MVP_BOOTSTRAP } from "../src/internal/hson-schema/compiler.ts";
import { decode_canonical_schema_graph_hson, encode_canonical_schema_graph_hson } from "../src/internal/canonical-schema/encode-hson.ts";
import { generate_hson_schema_types } from "../src/internal/hson-schema/generate-types.ts";
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
check("authored any is the sole broad data atom and lowers directly", () => {
  const result = compile('value "any"');
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value.semantic, { kind: "object", members: [{ name: "value", optional: false, schema: { kind: "any" } }] });
    assert.deepEqual(result.value.graph.nodes.map((node) => node.kind), ["projected-object", "projected-any"]);
    const generated = generate_hson_schema_types("AnySchema", result.value.semantic);
    assert.match(generated.declarations, /readonly value: JsonValue/);
    assert.doesNotMatch(generated.declarations, /\bany\b/);
  }
  for (const body of ['value "Any"', 'value "data"', 'value "record"', "value <any true>", "value <record true>"]) {
    assert.equal(compile(body).ok, false, body);
  }
});
check("authored any certifies canonical nested data but not document Hson", () => {
  const schema: HsonSchema = Hson.schema`<type "data" content <args "any" payload "any">>`;
  const values = [
    Hson.canonical`<args null payload null>`,
    Hson.canonical`<args "local" payload 37>`,
    Hson.canonical`<args true payload []>`,
    Hson.canonical`<args [] payload <>>`,
    Hson.canonical`<args [null, "x", -0, <nested [true, <empty <>>]>] payload <action "rename" details <names ["Ada", "Grace"]> empty []>>`,
  ];
  for (const value of values) assert.equal(schema.certify(value), value);
  assert.throws(() => schema.certify(Hson.canonical`<main/>`));
  assert.throws(() => Hson.canonical`<_hson_private true>`);
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
check("authored unions require at least two branches", () => {
  for (const source of ['value <union []>', 'value <union ["string"]>']) {
    const result = compile(source);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.issues[0]?.code, "INVALID_UNION");
      assert.match(result.issues[0]?.message ?? "", /at least two branches/);
    }
  }
});
check("n-ary primitive choices preserve order and exact equality", () => {
  const result = compile('value <union [<exact "ready">, <exact 0>, <exact -0>, <exact true>, "null"]>');
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const union = result.value.graph.nodes.find((node) => node.kind === "projected-union");
  assert.equal(union?.kind, "projected-union");
  if (union?.kind !== "projected-union") return;
  assert.equal(union.choices.length, 5);
  assert.deepEqual(union.choices.map((ref) => result.value.graph.nodes[ref]?.kind), ["projected-literal", "projected-literal", "projected-literal", "projected-literal", "projected-null"]);
  const orderedValues = union.choices.map((ref) => {
    const node = result.value.graph.nodes[ref];
    return node?.kind === "projected-literal" ? node.values[0] : null;
  });
  assert.equal(orderedValues[0], "ready");
  assert.equal(Object.is(orderedValues[1], 0), true);
  assert.equal(Object.is(orderedValues[2], -0), true);
  assert.equal(orderedValues[3], true);
  assert.equal(orderedValues[4], null);
  const decoded = decode_canonical_schema_graph_hson(encode_canonical_schema_graph_hson(result.value.graph));
  assert.equal(decoded.ok, true);
  if (decoded.ok) assert.deepEqual(decoded.graph, result.value.graph);
  for (const source of [
    'value <union [<exact "a">, <exact "b">, <exact "a">]>',
    'value <union [<exact 0>, <exact -0>, <exact 0>]>',
  ]) assert.equal(compile(source).ok, false, source);
});
check("n-ary inline object discriminators prove every pair", () => {
  const result = compile('value <union [<content <kind <exact "a">>>, <content <kind <exact "b">>>, <content <kind <exact "c">>>]>');
  assert.equal(result.ok, true);
  const duplicate = compile('value <union [<content <kind <exact "a">>>, <content <kind <exact "b">>>, <content <kind <exact "a">>>]>');
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) {
    assert.equal(duplicate.issues[0]?.code, "INVALID_UNION");
    assert.match(duplicate.issues[0]?.message ?? "", /branches 1 and 3 cannot be proven distinguishable/);
    assert.ok(duplicate.issues[0]?.range);
  }
});
const deckSource = `<type "data" defs <
  Paragraph <content <kind <exact "paragraph"> text "string">>
  Heading <content <kind <exact "heading"> text "string">>
  Code <content <kind <exact "code"> language <optional "string"> source "string">>
  List <content <kind <exact "list"> items <array "string">>>
  Block <union [<ref "Paragraph">, <ref "Heading">, <ref "Code">, <ref "List">]>
> content <content <blocks <array <ref "Block">>>>>`;
check("Deck four-way ref union compiles, certifies, and generates four alternatives", () => {
  const compiled = compile_hson_schema(deckSource);
  assert.equal(compiled.ok, true, compiled.ok ? undefined : JSON.stringify(compiled.issues));
  if (!compiled.ok) return;
  const block = compiled.value.definitions.find((definition) => definition.name === "Block");
  assert.equal(block?.schema.kind, "union");
  const graphUnion = compiled.value.graph.nodes.find((node) => node.kind === "projected-union");
  assert.equal(graphUnion?.kind === "projected-union" ? graphUnion.choices.length : -1, 4);
  const schema: HsonSchema = Hson.schema`<type "data" defs <
    Paragraph <content <kind <exact "paragraph"> text "string">>
    Heading <content <kind <exact "heading"> text "string">>
    Code <content <kind <exact "code"> language <optional "string"> source "string">>
    List <content <kind <exact "list"> items <array "string">>>
    Block <union [<ref "Paragraph">, <ref "Heading">, <ref "Code">, <ref "List">]>
  > content <content <blocks <array <ref "Block">>>>>`;
  const values = Hson.canonical`<blocks [<kind "paragraph" text "body">, <kind "heading" text "title">, <kind "code" language "ts" source "const x = 1">, <kind "list" items ["a", "b"]>]>`;
  assert.equal(schema.certify(values), values);
  assert.throws(() => schema.certify(Hson.canonical`<blocks [<kind "unknown" text "body">]>`));
  assert.throws(() => schema.certify(Hson.canonical`<blocks [<kind "code" source 1>]>`));
  assert.equal(Hson.schema.fromHson(schema.toHson()).toHson(), schema.toHson());
  const map = hsonLiveMap.fromLibraries({ blocks: { data: { blocks: [{ kind: "paragraph", text: "body" }] }, schema } });
  assert.deepEqual(map.lib("blocks").snap(), { blocks: [{ kind: "paragraph", text: "body" }] });
  const registry = make_hosted_registry([{ name: "blocks", identity: Object.freeze({}), mode: "data-object", schema }]);
  assert.equal(Hson.schema.fromHson(registry.libraries[0]!.schema).toHson(), schema.toHson());
  const generated = generate_hson_schema_types("Deck", compiled.value.semantic, compiled.value.definitions).declarations;
  const blockType = generated.match(/type __DeckDefinition0 = ([^\n]+);/)?.[1];
  assert.ok(blockType);
  assert.match(blockType, /__DeckDefinition1\) \| \(__DeckDefinition2\) \| \(__DeckDefinition3\) \| \(__DeckDefinition4/);
  const evidence = generate_hson_schema_evidence("Deck", deckSource, "deck#Deck");
  assert.match(evidence.metadata, /semanticGraphDigest/);
});
check("pair diagnostics name refs and retain the union source range", () => {
  const source = `<type "data" defs <First <content <kind <exact "same">>> Second <content <kind <exact "other">>> Third <content <kind <exact "same">>> Block <union [<ref "First">, <ref "Second">, <ref "Third">]>> content <ref "Block">>`;
  const result = compile_hson_schema(source);
  assert.equal(result.ok, false);
  if (result.ok) return;
  const problem = result.issues.find((entry) => entry.code === "INVALID_UNION");
  assert.match(problem?.message ?? "", /branches 1 \("First"\) and 3 \("Third"\) cannot be proven distinguishable/);
  assert.ok(problem?.range);
  if (problem?.range) assert.match(source.slice(problem.range.start, problem.range.end), /union/);
});
check("n-ary pairwise verification has a shared compiler work bound", () => {
  const ordinary = Array.from({ length: 64 }, (_, index) => `<exact "branch-${index}">`).join(", ");
  assert.equal(compile(`value <union [${ordinary}]>`).ok, true);
  const branches = Array.from({ length: 449 }, (_, index) => `<exact "branch-${index}">`).join(", ");
  const result = compile(`value <union [${branches}]>`);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.issues.filter((entry) => entry.code === "INVALID_UNION").length, 1);
    assert.match(result.issues[0]?.message ?? "", /exceeds 100000 branch comparisons/);
  }
});
check("direct branch-pair work is shared across unions near the compiler limit", () => {
  const source = (count: number): string => {
    const branches = (prefix: string): string => Array.from({ length: count }, (_, index) => `<exact "${prefix}-${index}">`).join(", ");
    return `left <union [${branches("left")}]> right <union [${branches("right")}]>`;
  };
  // Two 316-way unions require 99,540 direct comparisons; 317-way unions require 100,172.
  assert.equal(compile(source(316)).ok, true);
  const exhausted = compile(source(317));
  assert.equal(exhausted.ok, false);
  if (!exhausted.ok) {
    assert.equal(exhausted.issues.filter((entry) => entry.code === "INVALID_UNION").length, 1);
    assert.match(exhausted.issues[0]?.message ?? "", /exceeds 100000 branch comparisons/);
  }
});
check("finite-domain analysis work is shared across two unions", () => {
  const defs = ['D0 <union [<exact "v0">, <exact "v1">]>'];
  for (let index = 1; index <= 9; index += 1) {
    defs.push(`D${index} <union [<ref "D${index - 1}">, <ref "D${index - 1}">]>`);
  }
  const outer = (prefix: string): string => `<union [<ref "D9">, ${Array.from({ length: 7 }, (_, index) => `<exact "${prefix}${index}">`).join(", ")}]>`;
  const left = outer("left");
  const right = outer("right");
  const source = (content: string): string => `<type "data" defs <${defs.join(" ")}> content <${content}>>`;
  // Each outer union has only 28 direct pairs; repeated finite-domain expansion consumes the budget.
  for (const content of [`left ${left}`, `right ${right}`]) {
    const result = compile_hson_schema(source(content));
    assert.equal(result.ok, false); // Repeated refs in the definitions are independently indistinguishable.
    if (!result.ok) assert.equal(result.issues.some((entry) => entry.message.includes("Schema compilation work limit")), false);
  }
  const authored = source(`left ${left} right ${right}`);
  const exhausted = compile_hson_schema(authored);
  assert.equal(exhausted.ok, false);
  if (!exhausted.ok) {
    const issue = exhausted.issues.find((entry) => entry.message.includes("Schema compilation work limit"));
    assert.equal(issue?.code, "INVALID_UNION");
    assert.ok(issue?.range);
    if (issue?.range) assert.equal(authored.slice(issue.range.start, issue.range.end), right);
  }
});
check("nested finite primitive unions through refs retain ordinary behavior", () => {
  const defs = ['D0 <union [<exact "a">, <exact "b">]>'];
  for (let index = 1; index <= 6; index += 1) {
    defs.push(`D${index} <union [<ref "D${index - 1}">, <exact "${String.fromCharCode(98 + index)}">]>`);
  }
  const result = compile_hson_schema(`<type "data" defs <${defs.join(" ")}> content <value <union [<ref "D6">, <exact "z">]>>>`);
  assert.equal(result.ok, true, result.ok ? undefined : JSON.stringify(result.issues));
});
check("compact repeated-ref finite domains fail through the Schema work guard", () => {
  const defs = ['D0 <union [<exact "a">, <exact "b">]>'];
  for (let index = 1; index <= 19; index += 1) {
    defs.push(`D${index} <union [<ref "D${index - 1}">, <ref "D${index - 1}">]>`);
  }
  const outerUnion = '<union [<ref "D19">, <exact "z">]>';
  const source = `<type "data" defs <${defs.join(" ")}> content <value ${outerUnion}>>`;
  const result = compile_hson_schema(source);
  assert.equal(result.ok, false);
  if (!result.ok) {
    const problem = result.issues.find((entry) => entry.code === "INVALID_UNION");
    assert.match(problem?.message ?? "", /distinguishability analysis exceeds the Schema compilation work limit/);
    assert.ok(problem?.range);
    if (problem?.range) assert.equal(source.slice(problem.range.start, problem.range.end), outerUnion);
  }
});
check("finite-domain comparison avoids a quadratic cross-product", () => {
  const branches = (prefix: string): string => Array.from({ length: 280 }, (_, index) => `<exact "${prefix}-${index}">`).join(", ");
  const source = `<type "data" defs <Left <union [${branches("left")}]> Right <union [${branches("right")}]>> content <value <union [<ref "Left">, <ref "Right">]>>>`;
  const result = compile_hson_schema(source);
  assert.equal(result.ok, true, result.ok ? undefined : JSON.stringify(result.issues));
});
check("finite exact primitive domains lower when every branch is canonically disjoint", () => {
  const cases = [
    'value <union [<exact "lobby">, <exact "ready">]>',
    'value <union [<exact "lobby">, <union [<exact "ready">, <union [<exact "playing">, <exact "finished">]>]>]>',
    'value <union [<exact "lobby">, <union [<exact "ready">, <exact "playing">, <exact "finished">]>]>',
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
check("nested finite-domain lookup preserves signed zero", () => {
  for (const [nestedZero, otherZero, distinguishable] of [
    ["0", "-0", true],
    ["-0", "0", true],
    ["0", "0", false],
    ["-0", "-0", false],
  ] as const) {
    const source = `value <union [<union [<exact ${nestedZero}>, <exact 1>]>, <exact ${otherZero}>]>`;
    const result = compile(source);
    assert.equal(result.ok, distinguishable, source);
    if (!distinguishable && !result.ok) {
      assert.match(result.issues[0]?.message ?? "", /Union branches 1 and 2 cannot be proven distinguishable/);
    }
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
  const schema: HsonSchema = Hson.schema`<type "data" content <
    phase <union [<exact "lobby">, <union [<exact "ready">, <union [<exact "playing">, <exact "finished">]>]>]>
    turn <union [<exact "player1">, <union [<exact "player2">, "null"]>]>
    score <union [<exact 1>, <exact 2>]>
    zero <union [<exact 0>, <exact -0>]>
    flag <union [<exact true>, <exact false>]>
  >>`;
  for (const candidate of [
    Hson.canonical`<phase "lobby" turn "player1" score 1 zero 0 flag true>`,
    Hson.canonical`<phase "ready" turn "player2" score 2 zero -0 flag false>`,
    Hson.canonical`<phase "playing" turn null score 1 zero 0 flag false>`,
    Hson.canonical`<phase "finished" turn "player1" score 2 zero -0 flag true>`,
  ]) assert.equal(schema.certify(candidate), candidate);
  assert.throws(() => schema.certify(Hson.canonical`<phase "paused" turn "player1" score 1 zero 0 flag true>`));
  assert.throws(() => schema.certify(Hson.canonical`<phase "lobby" turn "player3" score 1 zero 0 flag true>`));
  assert.throws(() => schema.certify(Hson.canonical`<phase "lobby" turn "player1" score 3 zero 0 flag true>`));
});
check("bootstrap has a deterministic authored Hson machine representation", () => {
  const authored = encode_canonical_schema_graph_hson(HSON_SCHEMA_MVP_BOOTSTRAP);
  const decoded = decode_canonical_schema_graph_hson(authored);
  assert.equal(decoded.ok, true); if (decoded.ok) assert.deepEqual(decoded.graph, HSON_SCHEMA_MVP_BOOTSTRAP);
});
check("approved refinements lower directly to canonical rules", () => {
  const source = 'age <number <int true min 0 max 130 over -1 under 131>> code <string <len 4 prefix "ID" suffix "7" contains "-" alphabet "ID-7">> names <array <content "string" unique true minlen 1 maxlen 3>> pair <tuple <content ["string", "number"] len 2>>';
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
    { kind: "string-pattern", dialect: "literal-string", mode: "prefix", pattern: "ID" },
    { kind: "string-pattern", dialect: "literal-string", mode: "suffix", pattern: "7" },
    { kind: "string-pattern", dialect: "literal-string", mode: "contains", pattern: "-" },
    { kind: "string-repertoire", repertoire: "ID-7" },
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
    'x <string <alphabet ["a"]>>', 'x <string <alphabet <exact "a">>>', 'x <string <alphabet "abca">>',
  ]) assert.equal(compile(body).ok, false, body);
});
check("duplicate refinement members fail in the Hson parser", () => {
  assert.equal(compile('x <number <min 0 min 1>>').ok, false);
  assert.equal(compile('x <string <alphabet "abc" alphabet "def">>').ok, false);
});
check("refinement diagnostics retain exact authored source provenance", () => {
  const result = compile('x <number <min "bad">>');
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.deepEqual(result.issues[0]?.path, ["content", "x", "number", "min"]);
    assert.ok(result.issues[0]?.range !== undefined);
  }
});
check("refinement evaluation covers numeric, Unicode, literals, length, and uniqueness", () => {
  const schema: HsonSchema = Hson.schema`<type "data" content <age <number <int true min 0 under 130>> code <string <len 4 prefix "ID" suffix "7" contains "-">> glyph <string <len 1>> values <array <content "number" unique true minlen 1 maxlen 2>>>>`;
  const valid = Hson.canonical`<age 0 code "ID-7" glyph "😀" values [0, -0]>`;
  assert.equal(schema.certify(valid), valid);
  const dynamic = hsonTransform.fromJson({ age: 12, code: "ID-7", glyph: "😀", values: [1, 2] }).toHson().serialize();
  assert.equal(schema.certify(dynamic), dynamic);
  const invalidDynamic = hsonTransform.fromJson({ age: 12.5, code: "ID-7", glyph: "😀", values: [1, 1] }).toHson().serialize();
  assert.throws(() => schema.certify(invalidDynamic));
  for (const invalid of [
    Hson.canonical`<age 1.5 code "ID-7" glyph "😀" values [1]>`,
    Hson.canonical`<age -1 code "ID-7" glyph "😀" values [1]>`,
    Hson.canonical`<age 130 code "ID-7" glyph "😀" values [1]>`,
    Hson.canonical`<age 1 code "XX-7" glyph "😀" values [1]>`,
    Hson.canonical`<age 1 code "ID-X" glyph "😀" values [1]>`,
    Hson.canonical`<age 1 code "ID77" glyph "😀" values [1]>`,
    Hson.canonical`<age 1 code "ID--7" glyph "😀" values [1]>`,
    Hson.canonical`<age 1 code "ID-7" glyph "é" values [1]>`,
    Hson.canonical`<age 1 code "ID-7" glyph "😀" values []>`,
    Hson.canonical`<age 1 code "ID-7" glyph "😀" values [1, 1]>`,
  ]) assert.throws(() => schema.certify(invalid));
  const bounds: HsonSchema = Hson.schema`<type "data" content <n <number <over 0 max 2>>>>`;
  assert.doesNotThrow(() => bounds.certify(Hson.canonical`<n 1>`));
  assert.doesNotThrow(() => bounds.certify(Hson.canonical`<n 2>`));
  assert.throws(() => bounds.certify(Hson.canonical`<n 0>`));
  assert.throws(() => bounds.certify(Hson.canonical`<n 3>`));
  const empty: HsonSchema = Hson.schema`<type "data" content <s <string <len 0 prefix "" suffix "" contains "">> xs <array <content "number" len 0 unique true>>>>`;
  assert.doesNotThrow(() => empty.certify(Hson.canonical`<s "" xs []>`));
});
check("alphabet composes conjunctively with length and literal string refinements", () => {
  const schema: HsonSchema = Hson.schema`<type "data" content <code <string <len 4 alphabet "ID-7" prefix "ID" suffix "7" contains "-">>>>`;
  assert.doesNotThrow(() => schema.certify(Hson.canonical`<code "ID-7">`));
  for (const invalid of [
    Hson.canonical`<code "ID7">`,
    Hson.canonical`<code "ID--7">`,
    Hson.canonical`<code "XD-7">`,
    Hson.canonical`<code "ID-X">`,
    Hson.canonical`<code "ID77">`,
    Hson.canonical`<code "ID_7">`,
  ]) assert.throws(() => schema.certify(invalid));
  const ranged: HsonSchema = Hson.schema`<type "data" content <code <string <minlen 2 maxlen 4 alphabet "ab">>>>`;
  for (const valid of [Hson.canonical`<code "aa">`, Hson.canonical`<code "abab">`]) assert.doesNotThrow(() => ranged.certify(valid));
  for (const invalid of [Hson.canonical`<code "a">`, Hson.canonical`<code "ababa">`, Hson.canonical`<code "abc">`]) assert.throws(() => ranged.certify(invalid));
  const empty: HsonSchema = Hson.schema`<type "data" content <onlyEmpty <string <alphabet "">>>>`;
  assert.doesNotThrow(() => empty.certify(Hson.canonical`<onlyEmpty "">`));
  assert.throws(() => empty.certify(Hson.canonical`<onlyEmpty "a">`));
  const impossible: HsonSchema = Hson.schema`<type "data" content <value <string <len 1 alphabet "">>>>`;
  assert.throws(() => impossible.certify(Hson.canonical`<value "">`));
});
check("alphabet follows string iteration for Unicode, controls, repetition, and case", () => {
  const schema: HsonSchema = Hson.schema`<type "data" content <value <string <alphabet "aé😀e\u0301\n\ud800">>>>`;
  for (const valid of ["", "aaa", "é", "😀", "e\u0301", "\n", "\ud800"]) {
    const candidate = hsonTransform.fromJson({ value: valid }).toHson().serialize();
    assert.doesNotThrow(() => schema.certify(candidate), JSON.stringify(valid));
  }
  for (const invalid of ["A", "É", "x", "\ud801"]) {
    const candidate = hsonTransform.fromJson({ value: invalid }).toHson().serialize();
    assert.throws(() => schema.certify(candidate), JSON.stringify(invalid));
  }
});
check("generic length plus alphabet expresses persisted QUID validation", () => {
  const schema: HsonSchema = Hson.schema`<type "data" content <quid <string <len 9 alphabet "0123456789abcdefghjkmnpqrstvwxyz">>>>`;
  for (const value of ["000000000", "012345678", "abcdefghj", "zzzzzzzzz"]) {
    assert.doesNotThrow(() => schema.certify(hsonTransform.fromJson({ quid: value }).toHson().serialize()), value);
  }
  for (const value of ["00000000", "0000000000", "!!!!!!!!a", "00000000i", "00000000l", "00000000o", "00000000u", "00000000A", "00000000😀"]) {
    assert.throws(() => schema.certify(hsonTransform.fromJson({ quid: value }).toHson().serialize()), value);
  }
});
check("alphabet canonical Hson round trips repertoire order and Unicode units", () => {
  const result = compile('value <string <alphabet "zé😀e\\u0301\\n\\ud800a">>');
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const authored = encode_canonical_schema_graph_hson(result.value.graph);
  const decoded = decode_canonical_schema_graph_hson(authored);
  assert.equal(decoded.ok, true);
  if (decoded.ok) assert.deepEqual(decoded.graph, result.value.graph);
  const rule = result.value.graph.nodes.find((node) => node.kind === "projected-refinement" && node.rule.kind === "string-repertoire");
  assert.equal(rule?.kind === "projected-refinement" && rule.rule.kind === "string-repertoire" ? rule.rule.repertoire : undefined, "zé😀e\u0301\n\ud800a");
  const reordered = compile('value <string <alphabet "azé😀e\\u0301\\n\\ud800">>');
  assert.equal(reordered.ok, true);
  if (reordered.ok) assert.notDeepEqual(reordered.value.graph, result.value.graph);
});
check("runtime validation returns unchanged canonical identity", () => {
  const schema: HsonSchema = Hson.schema`<type "data" content <name "string" score "number">>`;
  const candidate = Hson.canonical`<name "Ada" score 37>`;
  assert.equal(schema.certify(candidate), candidate);
  assert.throws(() => schema.certify(Hson.canonical`<name "Ada" score "37">`));
  const dynamic = hsonTransform.fromJson({ name: "Ada", score: 37 }).toHson().serialize();
  assert.equal(schema.certify(dynamic), dynamic);
});

testEvents.terminal("pass");
