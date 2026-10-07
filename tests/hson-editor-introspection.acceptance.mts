import assert from "node:assert/strict";
import { hson_grammar_checkpoint, hson_interpolation_roles, scan_hson_template_segments, tokenize_hson, type HsonInterpolationRole } from "../src/api/transform/parsers/tokenize-hson.ts";
import { compile_hson_schema } from "../src/internal/hson-schema/compiler.ts";
import { query_hson_editor_context } from "../src/internal/editor-introspection/query.ts";
import { interpolation_semantic_mismatch, type StaticInterpolationFamily } from "../src/internal/editor-introspection/interpolation-compatibility.ts";
import { read_transform_error_details } from "../src/core/errors.ts";

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
const recoveredSlots: readonly { raw: readonly string[]; roles: readonly (HsonInterpolationRole | undefined)[] }[] = [
  { raw: ['<main "prefix', '" ', '/>'], roles: [undefined, "document-content"] },
  { raw: ['<main ', ' "prefix', '" ', '/>'], roles: ["document-content", undefined, "document-content"] },
  { raw: ['<main "prefix', '" "other', '" ', '/>'], roles: [undefined, undefined, "document-content"] },
  { raw: ['<main "', '', '" ', '/>'], roles: [undefined, undefined, "document-content"] },
  { raw: ['<main title="prefix', '" ', '/>'], roles: [undefined, "document-content"] },
];
for (const { raw, roles: expected } of recoveredSlots) {
  const substitutions = Array(raw.length - 1).fill("text");
  const { source, slots } = scan_hson_template_segments(raw, substitutions);
  assert.deepEqual(hson_interpolation_roles(source, "document", slots), expected);
  assert.throws(() => tokenize_hson(source, 0, undefined, slots, "document", substitutions, "document"),
    /interpolation must occupy the entire quoted Hson string/);
  assert.equal(hson_grammar_checkpoint(source, source.length, "document", slots), undefined);
}
// Other malformed lexemes remain fail-fast: an unterminated quote cannot prove
// a later content role, even when its slot boundaries can be discarded.
const unterminated = scan_hson_template_segments(['<main "prefix', ' ', '/>'], ["", ""]);
assert.deepEqual(hson_interpolation_roles(unterminated.source, "document", unterminated.slots), [undefined, undefined]);

// A known authored object closer cannot become document structure after a
// partial quoted slot. The crossing stops observation before either later slot.
const crossing = scan_hson_template_segments(['<main "prefix', '" <x ', '> ', '/>'], ["", "", ""]);
assert.deepEqual(hson_interpolation_roles(crossing.source, "document", crossing.slots), [undefined, undefined, undefined]);
assert.throws(() => tokenize_hson(crossing.source, 0, undefined, crossing.slots, "document", ["text", "37", "37"]),
  error => read_transform_error_details(error)?.code === "HSON_QUOTED_INTERPOLATION_PARTIAL");

// Evidence is accumulated outside the scanner, so a fatal crossing retains
// earlier observed roles but cannot assign roles beyond the failure.
const partialEvidence = scan_hson_template_segments(['<main ', ' "', '" <x ', '> ', '/>'], ["", "", "", ""]);
assert.deepEqual(hson_interpolation_roles(partialEvidence.source, "document", partialEvidence.slots),
  ["document-content", "quoted-string", undefined, undefined]);
assert.throws(() => tokenize_hson(partialEvidence.source, 0, undefined, partialEvidence.slots, "document", ["text", "text", "37", "37"], "document"),
  error => read_transform_error_details(error)?.code === "HSON_STRUCTURAL_MODE_CROSSING");

const stoppedSlots: readonly (readonly string[])[] = [
  ['<main ', ' "', '" <ch', 'ild ', '/> />'], // Interrupted name.
  ['<main ', ' "', '" "prefix', '\\', 'n" ', '/>'], // Interrupted escape after recovery.
  ['<main ', ' "', '"/> "unfinished', ' ', ''], // Unterminated later root string.
];
for (const raw of stoppedSlots) {
  const template = scan_hson_template_segments(raw, Array(raw.length - 1).fill(""));
  assert.deepEqual(hson_interpolation_roles(template.source, "document", template.slots),
    ["document-content", "quoted-string", ...Array(raw.length - 3).fill(undefined)]);
}

// Coincident boundaries remain distinct, both with a safe resume point and
// when a later malformed lexeme prevents the original scan from reaching them.
for (const raw of [['"', '', '" "unfinished'], ['<main "', '', '" "unfinished/>']]) {
  const template = scan_hson_template_segments(raw, ["", ""]);
  assert.equal(template.slots[0].offset, template.slots[1].offset);
  assert.deepEqual(hson_interpolation_roles(template.source, "document", template.slots), [undefined, undefined]);
}
const cursorSlots = scan_hson_template_segments(['<main "', '', '" ', '/>'], ["", "", ""]);
const cursorContext = query_hson_editor_context({ mode: "document", source: cursorSlots.source, cursor: cursorSlots.slots[0].offset, slots: cursorSlots.slots });
assert.deepEqual(cursorContext.interpolationRoles, [undefined, undefined, "document-content"]);
assert.deepEqual(cursorContext.checkpoint, hson_grammar_checkpoint(cursorSlots.source, cursorSlots.slots[0].offset, "document"));
for (const count of [10, 257, 10_000]) {
  const raw = ['<main "prefix', '" ', ...Array(count - 2).fill(" "), '/>'];
  const template = scan_hson_template_segments(raw, Array(count).fill(""));
  assert.deepEqual(hson_interpolation_roles(template.source, "document", template.slots),
    [undefined, ...Array(count - 1).fill("document-content")]);
}
const coincidentRaw = ['<main "prefix', '" ', ...Array(254).fill(" ")];
coincidentRaw[coincidentRaw.length - 1] += '"';
coincidentRaw.push('', '" "unfinished/>');
const coincident = scan_hson_template_segments(coincidentRaw, Array(257).fill(""));
assert.equal(coincident.slots.length, 257);
assert.equal(coincident.slots[255].offset, coincident.slots[256].offset);
assert.deepEqual(hson_interpolation_roles(coincident.source, "document", coincident.slots), Array(257).fill(undefined));
assert.equal(interpolation_semantic_mismatch("document-content", "data"), undefined);
assert.equal(interpolation_semantic_mismatch("data-value", "document"), undefined);
assert.equal(interpolation_semantic_mismatch("document-content", "string"), undefined);
assert.equal(interpolation_semantic_mismatch("quoted-string", "data"), undefined);
assert.equal(interpolation_semantic_mismatch("quoted-string", "number"), undefined);
assert.equal(interpolation_semantic_mismatch("quoted-string", "object")?.code, "HSON_QUOTED_INTERPOLATION_STATIC_TYPE");
assert.equal(interpolation_semantic_mismatch("canonical-value", "object")?.code, "HSON_INTERPOLATION_CANONICAL_STATIC_TYPE");
const canonicalCandidates: readonly StaticInterpolationFamily[] = ["string", "canonical", "data", "document", "number", "boolean", "null"];
for (const family of canonicalCandidates) {
  assert.equal(interpolation_semantic_mismatch("canonical-value", family), undefined);
  assert.equal(interpolation_semantic_mismatch("quoted-string", family), undefined);
}
const unsupportedPrimitives: readonly StaticInterpolationFamily[] = ["undefined", "bigint", "symbol"];
const interpolationModes: readonly ("canonical" | "data" | "document")[] = ["canonical", "data", "document"];
for (const family of unsupportedPrimitives) {
  assert.equal(interpolation_semantic_mismatch("canonical-value", family, "canonical")?.code, "HSON_INTERPOLATION_CANONICAL_STATIC_TYPE");
  assert.equal(interpolation_semantic_mismatch("data-value", family, "data")?.code, "HSON_INTERPOLATION_DATA_STATIC_TYPE");
  assert.equal(interpolation_semantic_mismatch("document-content", family, "document")?.code,
    family === "undefined" ? undefined : "HSON_INTERPOLATION_DOCUMENT_STATIC_TYPE");
  for (const mode of interpolationModes) {
    assert.equal(interpolation_semantic_mismatch("quoted-string", family, mode)?.code, "HSON_QUOTED_INTERPOLATION_STATIC_TYPE");
  }
  assert.equal(interpolation_semantic_mismatch(undefined, family, "document"), undefined);
}
// Canonical element content has the same role, but no Document omission rule.
assert.equal(interpolation_semantic_mismatch("document-content", "undefined", "canonical")?.code, "HSON_INTERPOLATION_DOCUMENT_STATIC_TYPE");
assert.match(interpolation_semantic_mismatch("document-content", "symbol", "document")!.message, /undefined for structural omission/);
assert.equal(interpolation_semantic_mismatch("document-content", "number")?.code, "HSON_INTERPOLATION_DOCUMENT_STATIC_TYPE");
assert.deepEqual(hson_interpolation_roles("", "canonical", [{ offset: 0, substitution: 0 }]), ["canonical-value"]);
assert.deepEqual(hson_interpolation_roles("«»", "canonical", [{ offset: 1, substitution: 0 }]), ["data-value"]);
assert.deepEqual(hson_interpolation_roles("<x >", "canonical", [{ offset: 3, substitution: 0 }]), ["data-value"]);
assert.deepEqual(hson_interpolation_roles("<main />", "canonical", [{ offset: 6, substitution: 0 }]), ["document-content"]);
console.log("ok - compiler-owned editor checkpoint, completion, and interpolation compatibility");
