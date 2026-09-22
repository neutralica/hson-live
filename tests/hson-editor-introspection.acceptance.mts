import assert from "node:assert/strict";
import { hson_grammar_checkpoint, hson_interpolation_roles } from "../src/api/transform/parsers/tokenize-hson.ts";
import { compile_hson_schema } from "../src/internal/hson-schema/compiler.ts";
import { query_hson_editor_context } from "../src/internal/editor-introspection/query.ts";
import { interpolation_semantic_mismatch } from "../src/internal/editor-introspection/interpolation-compatibility.ts";

const checkpoint = (source: string, mode: "data" | "document" | "schema" | "canonical" = "data") => hson_grammar_checkpoint(source, source.length, mode);
assert.equal(checkpoint("<")?.kind, "member");
assert.equal(checkpoint("<foo")?.kind, "member");
assert.equal(checkpoint("<foo ")?.kind, "value");
assert.deepEqual(checkpoint("<foo ")?.path, ["foo"]);
assert.deepEqual(checkpoint("<a 1 b")?.existing, ["a"]);
assert.deepEqual(checkpoint("<a 1 b")?.range, { start: 5, end: 6 });
assert.deepEqual(hson_grammar_checkpoint("<count 1>", 3, "data")?.range, { start: 1, end: 6 });
assert.equal(checkpoint("«1,")?.kind, "value");
assert.deepEqual(checkpoint("«1,")?.path, [1]);
assert.deepEqual(checkpoint("<outer <in")?.path, ["outer"]);
assert.equal(checkpoint("<foo", "document")?.kind, "tag");
assert.equal(checkpoint("<", "canonical"), undefined);
assert.equal(checkpoint('<style "', "document"), undefined);
assert.equal(checkpoint("< // comment", "data"), undefined);
assert.equal(checkpoint("<a <div />", "data"), undefined);
assert.equal(hson_grammar_checkpoint("<div/>", 3, "data"), undefined);

const compiled = compile_hson_schema('<type "data" content <count "number" color "string" presentation <content <theme "string">>>>');
assert.equal(compiled.ok, true);
if (!compiled.ok) throw new Error("Schema fixture failed to compile");
const complete = (source: string) => query_hson_editor_context({ mode: "data", source, cursor: source.length, schema: compiled.value });
assert.deepEqual(complete("<co").candidates.map(candidate => candidate.label), ["count", "color"]);
assert.deepEqual(complete("<count 1 co").candidates.map(candidate => candidate.label), ["color"]);
assert.deepEqual(complete("<presentation <th").candidates.map(candidate => candidate.label), ["theme"]);
assert.deepEqual(complete("<co").checkpoint?.range, { start: 1, end: 3 });
assert.deepEqual(query_hson_editor_context({ mode: "data", source: "<co", cursor: 3 }).candidates, []);
assert.deepEqual(query_hson_editor_context({ mode: "schema", source: '<type "data" co', cursor: 15 }).candidates.map(candidate => candidate.label), ["content"]);

const union = compile_hson_schema('<type "data" defs <U <union [<content <kind <exact "left"> shared "string" left "number">>, <content <kind <exact "right"> shared "string" right "number">>]>> content <ref "U">>');
assert.equal(union.ok, true);
if (union.ok) assert.deepEqual(query_hson_editor_context({ mode: "data", source: "<", cursor: 1, schema: union.value }).candidates.map(candidate => candidate.label), ["kind", "shared"]);

const roles = query_hson_editor_context({ mode: "document", source: '<main "" />', slots: [{ offset: 7, substitution: 0 }] }).interpolationRoles;
assert.deepEqual(roles, ["quoted-string"]);
const firstLiteral = '<html <head <style "a>b"/> /> ';
const secondLiteral = ' <body <iframe src=';
const finalLiteral = ' title="Pulse"/> /> />';
assert.deepEqual(hson_interpolation_roles(firstLiteral + secondLiteral + finalLiteral, "document", [
  { offset: firstLiteral.length, substitution: 0 },
  { offset: firstLiteral.length + secondLiteral.length, substitution: 1 },
]), ["document-content", undefined]);
assert.equal(interpolation_semantic_mismatch("document-content", "data")?.code, "HSON_INTERPOLATION_DATA_IN_DOCUMENT");
assert.equal(interpolation_semantic_mismatch("data-value", "document")?.code, "HSON_INTERPOLATION_DOCUMENT_IN_DATA");
assert.equal(interpolation_semantic_mismatch("document-content", "string"), undefined);
assert.equal(interpolation_semantic_mismatch("quoted-string", "data"), undefined);
assert.equal(interpolation_semantic_mismatch("quoted-string", "number")?.code, "HSON_QUOTED_INTERPOLATION_STATIC_TYPE");
console.log("ok - compiler-owned editor checkpoint, completion, and interpolation compatibility");
