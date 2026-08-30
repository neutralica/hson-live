import assert from "node:assert/strict";
import { Hson, type HsonSchema } from "../src/index.ts";
import { compile_hson_schema } from "../src/internal/hson-schema/compiler.ts";
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
check("attrs default open, required, optional, flag, and optional flag semantics", () => {
  const source = '<type "document" tag "main" attrs <props <id "string" state <exact "ready"> hidden "flag" inert <optional "flag"> title <optional "string">>> content "empty">';
  assert.equal(evaluate(source, '<main id=hero state=ready hidden data-extra=yes/>').ok, true);
  assert.equal(evaluate(source, '<main id=hero state=ready hidden inert title=ok/>').ok, true);
  assert.equal(evaluate(source, '<main state=ready hidden/>').ok, false);
  assert.equal(evaluate(source, '<main id=hero state=wrong hidden/>').ok, false);
  assert.equal(evaluate(source, '<main id=hero state=ready hidden=false/>').ok, false);
  assert.equal(schema('tag "main" attrs <props <count "number">> content "empty"').ok, false);
});
check("attrs explicit exact closure rejects undeclared attrs", () => {
  const source = '<type "document" tag "main" attrs <props <id "string"> exact true> content "empty">';
  assert.equal(evaluate(source, '<main id=hero/>').ok, true);
  assert.equal(evaluate(source, '<main id=hero data-extra=yes/>').ok, false);
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
  assert.equal(Hson.validate(pageSchema, candidate), candidate);
  assert.throws(() => Hson.validate(pageSchema, Hson`<main id=hero <aside "body"/>/>`));
});

emit_hson_live_test_completion("hson-schema-document", checks, checks, 0);
