import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { Hson, type HsonSchema } from "../src/index.ts";
import { compile_hson_schema } from "../src/internal/hson-schema/compiler.ts";
import { generate_hson_schema_types } from "../src/internal/hson-schema/generate-types.ts";
import { evaluate_canonical_document_schema } from "../src/internal/canonical-schema/evaluate.ts";
import { parse_hson } from "../src/api/transform/parsers/parse-hson.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

let checks = 0;
const check = (name: string, run: () => void): void => { run(); console.log(`ok ${++checks} - ${name}`); };
const schema = (body: string) => compile_hson_schema(`<type "document" ${body}>`);
const evaluate = (source: string, candidate: string) => {
  const compiled = compile_hson_schema(source);
  assert.equal(compiled.ok, true);
  if (!compiled.ok) throw new Error("unreachable");
  return evaluate_canonical_document_schema(compiled.value.graph, parse_hson(candidate), "element");
};
const evaluateFragment = (source: string, candidate: string) => {
  const compiled = compile_hson_schema(source);
  assert.equal(compiled.ok, true);
  if (!compiled.ok) throw new Error("unreachable");
  return evaluate_canonical_document_schema(compiled.value.graph, parse_hson(candidate), "fragment");
};

check("exact HTML, SVG, and custom element roots compile", () => {
  for (const tag of ["main", "svg", "acme-card"]) assert.equal(schema(`tag "${tag}" content "empty"`).ok, true);
});
check("unknown and illegal document descriptor members reject", () => {
  assert.equal(schema('tag "main" content "empty" surprise true').ok, false);
  assert.equal(schema('tag "main"').ok, false);
  assert.equal(schema('tag <union [<exact "main">, <exact "section">]> content "empty"').ok, false);
});
check("string and exact empty content validate", () => {
  assert.equal(evaluate('<type "document" tag "main" content "string">', '<main "hello"/>').ok, true);
  assert.equal(evaluate('<type "document" tag "main" content "string">', '<main/>').ok, false);
  assert.equal(evaluate('<type "document" tag "main" content "empty">', '<main/>').ok, true);
  assert.equal(evaluate('<type "document" tag "main" content "empty">', '<main "extra"/>').ok, false);
});
check("fixed ordered nested element content validates exactly", () => {
  const source = '<type "document" tag "main" content <sequence [<tag "header" content "empty">, <tag "section" content <sequence [<tag "p" content "string">]>>]>>';
  assert.equal(evaluate(source, '<main <header/> <section <p "body"/>/>/>').ok, true);
  assert.equal(evaluate(source, '<main <section <p "body"/>/> <header/>/>').ok, false);
  assert.equal(evaluate(source, '<main <header/>/>').ok, false);
  assert.equal(evaluate(source, '<main <header/> <section <p "body"/>/> <footer/>/>').ok, false);
  assert.equal(schema('tag "main" content <sequence [<tag "header" content "empty">, "string"]>').ok, false);
});
check("repeat grammar lowers directly to canonical variable repetition", () => {
  const source = '<type "document" tag "main" content <repeat <tag "item" content "empty">>>';
  const compiled = compile_hson_schema(source);
  assert.equal(compiled.ok, true);
  if (!compiled.ok) return;
  assert.equal(compiled.value.documentRepeatCount, 1);
  assert.equal(compiled.value.documentExactCountCount, 0);
  assert.equal(compiled.value.graph.nodes.some((node) => node.kind === "document-repeat" && node.count === undefined), true);
  assert.equal(evaluate(source, '<main/>').ok, true);
  assert.equal(evaluate(source, '<main <item/>/>').ok, true);
  assert.equal(evaluate(source, '<main <item/> <item/> <item/>/>').ok, true);
  assert.equal(evaluate(source, '<main <wrong/>/>').ok, false);
});
check("count is exact, admits zero, and rejects every malformed cardinality", () => {
  const counted = (count: number) => `<type "document" tag "main" content <repeat <tag "item" content "empty"> count ${count}>>`;
  assert.equal(evaluate(counted(0), '<main/>').ok, true);
  assert.equal(evaluate(counted(1), '<main <item/>/>').ok, true);
  assert.equal(evaluate(counted(3), '<main <item/> <item/> <item/>/>').ok, true);
  assert.equal(evaluate(counted(2), '<main <item/>/>').ok, false);
  assert.equal(evaluate(counted(2), '<main <item/> <item/> <item/>/>').ok, false);
  for (const content of [
    '<repeat <tag "item" content "empty"> count -1>',
    '<repeat <tag "item" content "empty"> count 1.5>',
    '<repeat <tag "item" content "empty"> count "2">',
    '<repeat <tag "item" content "empty"> count 1 count 1>',
    '<repeat <tag "item" content "empty"> surprise true>',
    '<count 1>',
    '<repeat "string">',
  ]) assert.equal(schema(`tag "main" content ${content}`).ok, false, content);
});
check("repeat ref shares definition authority and preserves recursive descendant validation", () => {
  const source = '<type "document" defs <Code <string <prefix "ok-">> Item <tag "item" attrs <props <code <ref "Code">>> content "empty">> tag "main" content <repeat <ref "Item">>>';
  const compiled = compile_hson_schema(source);
  assert.equal(compiled.ok, true);
  if (!compiled.ok) return;
  assert.equal(compiled.value.referenceUses.length, 2);
  const repeatIndex = compiled.value.graph.nodes.findIndex((node) => node.kind === "document-repeat");
  const repeat = compiled.value.graph.nodes[repeatIndex];
  assert.equal(repeat?.kind, "document-repeat");
  if (repeat?.kind === "document-repeat") assert.equal(compiled.value.graph.nodes[repeat.item]?.kind, "document-element");
  assert.equal(evaluate(source, '<main <item code=ok-one/> <item code=ok-two/>/>').ok, true);
  assert.equal(evaluate(source, '<main <item code=bad/>/>').ok, false);
  assert.equal(compile_hson_schema('<type "document" defs <Data "string"> tag "main" content <repeat <ref "Data">>>').ok, false);

  const recursive = '<type "document" defs <Node <tag "node" content <repeat <ref "Node">>>> tag "main" content <repeat <ref "Node">>>';
  const recursiveCompiled = compile_hson_schema(recursive);
  assert.equal(recursiveCompiled.ok, true);
  if (recursiveCompiled.ok) {
    assert.equal(recursiveCompiled.value.recursiveSccCount, 1);
    const generated = generate_hson_schema_types("RecursiveRepeatSchema", recursiveCompiled.value.semantic, recursiveCompiled.value.definitions);
    assert.ok(generated.declarations.length < 5_000);
  }
  assert.equal(evaluate(recursive, '<main <node/> <node <node/>/>/>').ok, true);
  assert.equal(evaluate(recursive, '<main <node <wrong/>/>/>').ok, false);
});
check("repeated generated document content is readonly, nominal, and bounded", () => {
  const generic = compile_hson_schema('<type "document" tag "main" content <repeat <tag "item" content "empty">>>');
  const exact = compile_hson_schema('<type "document" tag "main" content <repeat <tag "item" content "empty"> count 2>>');
  const large = compile_hson_schema('<type "document" tag "main" content <repeat <tag "item" content "empty"> count 10000>>');
  assert.equal(generic.ok, true); assert.equal(exact.ok, true); assert.equal(large.ok, true);
  if (!generic.ok || !exact.ok || !large.ok) return;
  const genericTypes = generate_hson_schema_types("GenericRepeatSchema", generic.value.semantic, generic.value.definitions);
  const exactTypes = generate_hson_schema_types("ExactRepeatSchema", exact.value.semantic, exact.value.definitions);
  const largeTypes = generate_hson_schema_types("LargeRepeatSchema", large.value.semantic, large.value.definitions);
  assert.match(genericTypes.declarations, /ReadonlyArray</);
  assert.match(exactTypes.declarations, /readonly \[[^\]]+, [^\]]+\]/);
  assert.match(largeTypes.declarations, /ReadonlyArray</);
  assert.ok(largeTypes.declarations.length < 10_000);
});
check("tagless document roots expose existing fragment sequence and repeat semantics", () => {
  const sequence = '<type "document" defs <Tail <tag "footer" content "empty">> content <sequence [<tag "header" content "empty">, <ref "Tail">]>>';
  const compiled = compile_hson_schema(sequence);
  assert.equal(compiled.ok, true);
  if (compiled.ok) {
    assert.equal(compiled.value.semantic.kind, "document-fragment");
    assert.equal(compiled.value.graph.capabilities.documentFragmentRoot, 0);
    const generated = generate_hson_schema_types("FragmentSchema", compiled.value.semantic, compiled.value.definitions);
    assert.match(generated.declarations, /readonly \$_tag: "_hson_root"/);
    assert.match(generated.declarations, /readonly \$_tag: "header"/);
    assert.match(generated.declarations, /readonly \$_tag: "footer"/);
  }
  assert.equal(evaluateFragment(sequence, '<header/><footer/>').ok, true);
  assert.equal(evaluateFragment(sequence, '<footer/><header/>').ok, false);
  assert.equal(evaluateFragment(sequence, '<header/>').ok, false);
  const repeated = '<type "document" defs <Item <tag "item" content "empty">> content <repeat <ref "Item"> count 2>>';
  assert.equal(evaluateFragment(repeated, '<item/><item/>').ok, true);
  assert.equal(evaluateFragment(repeated, '<item/>').ok, false);
  assert.equal(compile_hson_schema('<type "document" attrs <props <id "string">> content "empty">').ok, false);
});
check("attrs default open, required, optional, flag, and optional flag semantics", () => {
  const source = '<type "document" tag "main" attrs <props <id "string" state <exact "ready"> hidden "flag" inert <optional "flag"> title <optional "string">>> content "empty">';
  assert.equal(evaluate(source, '<main id=hero state=ready hidden data-extra=yes/>').ok, true);
  assert.equal(evaluate(source, '<main id=hero state=ready hidden inert title=ok/>').ok, true);
  assert.equal(evaluate(source, '<main state=ready hidden/>').ok, false);
  assert.equal(evaluate(source, '<main id=hero state=wrong hidden/>').ok, false);
  assert.equal(evaluate(source, '<main id=hero state=ready hidden=false/>').ok, false);
  assert.equal(schema('tag "main" attrs <props <count "number">> content "empty"').ok, false);
});
check("attrs explicit closed key set rejects undeclared attrs without exact-value semantics", () => {
  const source = '<type "document" tag "main" attrs <props <id "string"> closed true> content "empty">';
  assert.equal(evaluate(source, '<main id=hero/>').ok, true);
  assert.equal(evaluate(source, '<main id=another-value/>').ok, true);
  assert.equal(evaluate(source, '<main id=hero data-extra=yes/>').ok, false);
});
check("retired attrs exact closure spelling rejects", () => {
  assert.equal(schema('tag "main" attrs <props <id "string"> exact true> content "empty"').ok, false);
});
check("lowering is deterministic and canonically verified", () => {
  const source = '<type "document" tag "main" attrs <props <id "string">> content <sequence [<tag "section" content "string">]>>';
  const left = compile_hson_schema(source), right = compile_hson_schema(source);
  assert.equal(left.ok, true); assert.equal(right.ok, true);
  if (left.ok && right.ok) {
    assert.deepEqual(left.value.graph, right.value.graph);
    assert.equal(left.value.graph.capabilities.documentElementRoot, 0);
    assert.equal(left.value.graph.capabilities.projectedRoot, undefined);
  }
});
check("runtime document certification preserves canonical string identity", () => {
  const pageSchema: HsonSchema = Hson`<type "document" tag "main" attrs <props <id "string">> content <sequence [<tag "section" content "string">]>>`;
  const candidate = Hson`<main id=hero data-extra=yes <section "body"/>/>`;
  assert.equal(Hson.certify(pageSchema, candidate), candidate);
  assert.throws(() => Hson.certify(pageSchema, Hson`<main id=hero <aside "body"/>/>`));
});
check("runtime certification uses canonical repeat and exact-count authority", () => {
  const repeatSchema: HsonSchema = Hson`<type "document" defs <Item <tag "item" content "empty">> tag "main" content <repeat <ref "Item"> count 2>>`;
  const candidate = Hson`<main <item/> <item/>/>`;
  assert.equal(Hson.certify(repeatSchema, candidate), candidate);
  assert.throws(() => Hson.certify(repeatSchema, Hson`<main <item/>/>`));
  assert.throws(() => Hson.certify(repeatSchema, Hson`<main <item/> <wrong/>/>`));
});
check("runtime fragment certification preserves the identical canonical string", () => {
  const fragmentSchema: HsonSchema = Hson`<type "document" defs <Item <tag "item" content "empty">> content <repeat <ref "Item"> count 2>>`;
  const candidate = Hson`<item/><item/>`;
  assert.equal(Hson.certify(fragmentSchema, candidate), candidate);
  assert.throws(() => Hson.certify(fragmentSchema, Hson`<item/>`));
});

const performanceCases = [
  ["simple-repeat", '<type "document" tag "root" content <repeat <tag "item" content "empty">>>', '<root <item/> <item/>/>'],
  ["exact-count", '<type "document" tag "root" content <repeat <tag "item" content "empty"> count 3>>', '<root <item/> <item/> <item/>/>'],
  ["repeat-ref", '<type "document" defs <Item <tag "item" content "empty">> tag "root" content <repeat <ref "Item">>>', '<root <item/> <item/>/>'],
  ["recursive-repeat", '<type "document" defs <Node <tag "node" content <repeat <ref "Node">>>> tag "root" content <repeat <ref "Node">>>', '<root <node/> <node <node/>/>/>'],
  ["composed-document", '<type "document" defs <Code <string <prefix "ok-">> Item <tag "item" attrs <props <code <ref "Code">>> content <repeat <tag "part" content "empty"> count 2>>> tag "root" content <repeat <ref "Item"> count 2>>', '<root <item code=ok-a <part/><part/>/> <item code=ok-b <part/><part/>/>/>'],
] as const;
const performanceTelemetry = performanceCases.map(([name, source, candidate]) => {
  const started = performance.now();
  const compiled = compile_hson_schema(source);
  const compileMs = performance.now() - started;
  assert.equal(compiled.ok, true);
  if (!compiled.ok) throw new Error("unreachable");
  const generated = generate_hson_schema_types("PerformanceSchema", compiled.value.semantic, compiled.value.definitions);
  const validationStarted = performance.now();
  assert.equal(evaluate_canonical_document_schema(compiled.value.graph, parse_hson(candidate), "element").ok, true);
  const runtimeValidationMs = performance.now() - validationStarted;
  return {
    name,
    definitions: compiled.value.definitions.length,
    refs: compiled.value.referenceUses.length,
    repeatNodes: compiled.value.documentRepeatCount,
    exactCountNodes: compiled.value.documentExactCountCount,
    canonicalNodes: compiled.value.canonicalNodeCount,
    proofNodes: generated.proofNodeCount,
    generatedDeclarationBytes: Buffer.byteLength(generated.declarations),
    compileMs: Math.round(compileMs * 100) / 100,
    runtimeValidationMs: Math.round(runtimeValidationMs * 100) / 100,
  };
});
console.log(JSON.stringify({ documentBreadthPerformance: performanceTelemetry }));

emit_hson_live_test_completion("hson-schema-document", checks, checks, 0);
