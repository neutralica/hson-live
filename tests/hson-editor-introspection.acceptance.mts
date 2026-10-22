import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { hson_grammar_checkpoint, hson_interpolation_roles, scan_hson_template_segments, tokenize_hson, type HsonInterpolationRole } from "../src/api/transform/parsers/tokenize-hson.ts";
import { compile_hson_schema } from "../src/internal/hson-schema/compiler.ts";
import { query_hson_editor_context } from "../src/internal/editor-introspection/query.ts";
import { interpolation_semantic_mismatch, type StaticInterpolationFamily } from "../src/internal/editor-introspection/interpolation-compatibility.ts";
import { read_transform_error_details } from "../src/core/errors.ts";
import { tokenize_authored_document_library } from "../src/api/transform/parsers/tokenize-hson.ts";
import { parse_hson } from "../src/api/transform/parsers/parse-hson.ts";
import { transform_part_parameter_strings } from "../src/internal/part-placeholder.ts";

const checkpoint = (source: string, mode: "data" | "document" | "schema" | "canonical" = "data") => hson_grammar_checkpoint(source, source.length, mode);
for (const marked of ['<hson-part lib=|"co"/>', '<hson-part lib="components" at=|"he"/>']) {
  const source = marked.replace('|', ''), cursor = marked.indexOf('|');
  const context = hson_grammar_checkpoint(source, cursor, 'document');
  assert.equal(context?.kind, 'attribute-value');
  assert.equal(source.slice(context!.range.start, context!.range.end), marked.includes('lib=|') ? '"co"' : '"he"');
}
for (const marked of [String.raw`<h1 id=%{co|}/>`, String.raw`<h1 id="%{\u0063o|}"/>`, String.raw`<h1 id="%\u007b\u0063o|\u007d"/>`]) {
  const source = marked.replace('|', '');
  const context = hson_grammar_checkpoint(source, marked.indexOf('|'), 'document');
  assert.equal(context?.kind, 'parameter'); assert.equal(context?.parameter?.prefix, 'co'); assert.equal(context?.parameter?.complete, true);
  assert.equal(source.slice(context!.range.start, context!.range.end), marked.includes('\\u0063') ? String.raw`\u0063o` : 'co');
  const raw = context?.parameter?.rawAttribute;
  assert.equal(raw?.name, 'id');
  assert.equal(raw?.value?.text, source.slice(raw!.start.index, raw!.end.index));
  assert.equal(raw?.value?.quoted, marked.includes('id="'));
}
for (const marked of ['<h1 id=%{co|', String.raw`<h1 id="%{\u0063o|`]) {
  const source = marked.replace('|', '');
  const context = hson_grammar_checkpoint(source, marked.indexOf('|'), 'document');
  assert.equal(context?.kind, 'parameter');
  assert.equal(context?.parameter?.prefix, 'co');
  assert.equal(context?.parameter?.rawAttribute?.value?.text, source.slice(context!.parameter!.rawAttribute!.start.index));
}
// A lexical checkpoint does not establish eligibility for Part completion.
for (const marked of ['<script <p id="%{co|}"/>/>', '<style <p "%{co|}"/>/>', '<p onclick="%{co|}"/>', '<p style="color:%{co|}"/>']) {
  const context = hson_grammar_checkpoint(marked.replace('|', ''), marked.indexOf('|'), 'document');
  assert.equal(context?.kind, 'parameter', marked);
  assert.equal(context?.parameter?.prefix, 'co', marked);
}
for (const marked of [String.raw`<h1 id="%{\u00|63o}"/>`, '<hson-part lib=|"co', String.raw`<hson-part lib=|"co\q"/>`]) {
  const context = hson_grammar_checkpoint(marked.replace('|', ''), marked.indexOf('|'), 'document');
  assert.ok(context === undefined || context.pendingValue, marked);
}
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
// Authored Document checkpoints share the production QUAD grammar.
for (const source of ['<span title=', '<span @:label title=', '<main @:root <span @:label title=']) {
  assert.equal(checkpoint(source, "document")?.kind, "attribute-value", source);
  if (source.includes("@:")) assert.equal(checkpoint(source, "canonical"), undefined, source);
}
assert.equal(checkpoint('<span @:same @:again title=', "document"), undefined);
assert.equal(checkpoint('<span @:label title=', "data"), undefined);
assert.equal(checkpoint('<span @:label title=', "schema"), undefined);
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

const contextual: { schema: string; cases: { name: string; body: string; expected: string[] }[] } = JSON.parse(readFileSync(new URL("./fixtures/contextual-completion.json", import.meta.url), "utf8"));
const contextualSchema = compile_hson_schema(contextual.schema);
assert.ok(contextualSchema.ok, JSON.stringify(contextualSchema));
for (const { name, body, expected } of contextual.cases) {
  const result = query_hson_editor_context({ mode: "data", source: body.replace("|", ""), cursor: body.indexOf("|"), schema: contextualSchema.value });
  assert.deepEqual(result.candidates.map(candidate => candidate.label), expected, name);
}
const optionalTuple = compile_hson_schema('<type "data" content <pair <tuple ["number", <optional "string">]>>>');
assert.ok(!optionalTuple.ok && optionalTuple.issues.some(issue => issue.code === "ILLEGAL_OPTIONAL"), "Optional tuple entries are not accepted grammar");

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
  { raw: ['<main "prefix', '" ', '/>'], roles: ["quoted-string", "document-content"] },
  { raw: ['<main ', ' "prefix', '" ', '/>'], roles: ["document-content", "quoted-string", "document-content"] },
  { raw: ['<main "prefix', '" "other', '" ', '/>'], roles: ["quoted-string", "quoted-string", "document-content"] },
  { raw: ['<main "', '', '" ', '/>'], roles: ["quoted-string", "quoted-string", "document-content"] },
  { raw: ['<main title="prefix', '" ', '/>'], roles: ["quoted-string", "document-content"] },
];
for (const { raw, roles: expected } of recoveredSlots) {
  const substitutions = Array(raw.length - 1).fill("text");
  const { source, slots } = scan_hson_template_segments(raw, substitutions);
  assert.deepEqual(hson_interpolation_roles(source, "document", slots), expected);
  assert.doesNotThrow(() => tokenize_hson(source, 0, undefined, slots, "document", substitutions, "document"));
  assert.equal(hson_grammar_checkpoint(source, source.length, "document", slots)?.kind, "value");
}
// Other malformed lexemes remain fail-fast: an unterminated quote cannot prove
// a later content role.
const unterminated = scan_hson_template_segments(['<main "prefix', ' ', '/>'], ["", ""]);
assert.deepEqual(hson_interpolation_roles(unterminated.source, "document", unterminated.slots), [undefined, undefined]);

// A known authored object closer cannot become document structure after a
// quoted slot. The crossing stops observation before either later slot.
const crossing = scan_hson_template_segments(['<main "prefix', '" <x ', '> ', '/>'], ["", "", ""]);
assert.deepEqual(hson_interpolation_roles(crossing.source, "document", crossing.slots), ["quoted-string", undefined, undefined]);
assert.throws(() => tokenize_hson(crossing.source, 0, undefined, crossing.slots, "document", ["text", "37", "37"]),
  error => read_transform_error_details(error)?.code === "HSON_STRUCTURAL_MODE_CROSSING");

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
// when a later malformed lexeme stops scanning after the completed string.
for (const raw of [['"', '', '" "unfinished'], ['<main "', '', '" "unfinished/>']]) {
  const template = scan_hson_template_segments(raw, ["", ""]);
  assert.equal(template.slots[0].offset, template.slots[1].offset);
  assert.deepEqual(hson_interpolation_roles(template.source, "document", template.slots), raw[0].startsWith("<") ? [undefined, undefined] : ["quoted-string", "quoted-string"]);
}
const cursorSlots = scan_hson_template_segments(['<main "', '', '" ', '/>'], ["", "", ""]);
const cursorContext = query_hson_editor_context({ mode: "document", source: cursorSlots.source, cursor: cursorSlots.slots[0].offset, slots: cursorSlots.slots });
assert.deepEqual(cursorContext.interpolationRoles, ["quoted-string", "quoted-string", "document-content"]);
assert.deepEqual(cursorContext.checkpoint, hson_grammar_checkpoint(cursorSlots.source, cursorSlots.slots[0].offset, "document"));
for (const mode of ["data", "document"] as const) {
  const raw = mode === "data" ? ['<kind "l', 'eft" sh'] : ['<hson-part lib="co', 'mponents"/>'];
  const template = scan_hson_template_segments(raw, [""]);
  assert.deepEqual(hson_interpolation_roles(template.source, mode, template.slots), ["quoted-string"]);
  for (let cursor = raw[0].indexOf('"') + 1; cursor <= raw[0].length + 2; cursor++) {
    const context = query_hson_editor_context({ mode, source: template.source, cursor, slots: template.slots });
    assert.deepEqual(context.candidates, [], "No edit may replace a quoted value across expressions");
    assert.equal(context.checkpoint?.quoted, undefined);
  }
  if (mode === "data") {
    const context = query_hson_editor_context({ mode, source: template.source, cursor: template.source.length, slots: template.slots, schema: union.value });
    assert.deepEqual(context.candidates.map(candidate => candidate.label), ["shared"]);
    assert.ok(context.checkpoint?.dataFacts?.some(fact => fact.kind === "unknown" && fact.path[0] === "kind"));
  }
}
for (const count of [10, 257, 10_000]) {
  const raw = ['<main "prefix', '" ', ...Array(count - 2).fill(" "), '/>'];
  const template = scan_hson_template_segments(raw, Array(count).fill(""));
  assert.deepEqual(hson_interpolation_roles(template.source, "document", template.slots),
    ["quoted-string", ...Array(count - 1).fill("document-content")]);
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

// Compare runtime tokens, errors, mutation and rejection semantics with the pinned
// committed implementation. Only import locations change in the temporary modules.
const root = resolve(import.meta.dirname, '..');
mkdirSync(join(root, 'tmp'), { recursive: true });
const baselineDirectory = mkdtempSync(join(root, 'tmp', 'part-scanner-baseline-'));
const baselineModule = (name: string) => {
  const original = execFileSync('git', ['show', '6938769e:' + name], { cwd: root, encoding: 'utf8' });
  const rewritten = original.replace(/(from\s+["'])(\.[^"']+)(["'])/g, (_match, before: string, specifier: string, after: string) =>
    before + pathToFileURL(resolve(dirname(join(root, name)), specifier).replace(/\.js$/, '.ts')).href + after);
  const path = join(baselineDirectory, name.endsWith('part-placeholder.ts') ? 'placement.mts' : 'scanner.mts');
  writeFileSync(path, rewritten); return pathToFileURL(path).href;
};
const observed = (run: () => unknown) => {
  try { return { value: run() }; }
  catch (error) { return { message: error instanceof Error ? error.message : String(error), details: read_transform_error_details(error) }; }
};
try {
  const baseline: Pick<typeof import('../src/api/transform/parsers/tokenize-hson.ts'), 'tokenize_hson' | 'tokenize_authored_document_library'> = await import(baselineModule('src/api/transform/parsers/tokenize-hson.ts'));
  const sources = ['<a "hello">', '<main title="%{Mixed-name}"/>', '<hson-part lib="components" at="heading"/>', '<main\r\n "line\\ntext"\r\n/>',
    '<h1 id=%{content}/>', String.raw`<h1 id="%{\u0063ontent}"/>`, '<script src="/a.js" type="%{Kind}"/>', '<style media=%{Media}/>',
    '<script <p title="%{bad}"/>/>', '<style <p "%{bad}"/>/>', '<hson-part lib=', '<hson-part lib="co', String.raw`<h1 id="\q"/>`,
    '<p x="a" x="b"/>', '<p "text" id="late"/>', '<p @:name/>', '<p "${ordinary text}"/>'];
  for (const source of sources) {
    assert.deepEqual(observed(() => tokenize_hson(source)), observed(() => baseline.tokenize_hson(source)), source);
    assert.deepEqual(observed(() => tokenize_authored_document_library(source)), observed(() => baseline.tokenize_authored_document_library(source)), source);
  }
  const placement: Pick<typeof import('../src/internal/part-placeholder.ts'), 'transform_part_parameter_strings'> = await import(baselineModule('src/internal/part-placeholder.ts'));
  for (const source of ['<script src="/a.js" type="%{Kind}"/>', '<style media=%{Media}/>', '<main title="%{Mixed-name}" "%{text}"/>',
    '<script <p title="%{bad}"/>/>', '<style <p "%{bad}"/>/>', '<p onclick="%{bad}"/>', '<p style="color:%{bad}"/>']) {
    const apply = (transform: typeof transform_part_parameter_strings) => { const node = parse_hson(source); transform(node, value => value.replace(/%\{[A-Za-z_-]+\}/g, 'filled')); return node; };
    assert.deepEqual(observed(() => apply(transform_part_parameter_strings)), observed(() => apply(placement.transform_part_parameter_strings)), source);
  }
  console.log('ok - pinned runtime scanner and governed placeholder placement parity');
} finally { rmSync(baselineDirectory, { recursive: true, force: true }); }
