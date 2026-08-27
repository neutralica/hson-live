import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import { classify_live_root_mode } from "../src/api/livemap/livemap.document.ts";
import {
  validate_livemap_document_schema_root,
  type InternalDocumentRootSchema,
} from "../src/api/livemap/livemap.document.schema.ts";
import type { LiveMapSchemaIssue } from "../src/api/livemap/livemap.schema.ts";
import type { HsonNode } from "../src/core/types.ts";
import {
  resolve_document_schema_issue_source,
  type DocumentSchemaSourceResolution,
} from "../src/internal/document-schema-source-lowering/document-schema-source-lowering.ts";
import { HsonSourceProvenanceBuilder } from "../src/internal/hson-source-provenance/hson-source-provenance.ts";
import { parse_hson_with_provenance } from "../src/internal/hson-source-provenance/parse-hson-with-provenance.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

let checks = 0;
function check(name: string, run: () => void): void {
  run();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function resolve_first(source: string, schema: InternalDocumentRootSchema): DocumentSchemaSourceResolution {
  const parsed = parse_hson_with_provenance(source);
  const mode = classify_live_root_mode(parsed.value);
  if (mode !== "element" && mode !== "fragment") {
    throw new Error(`Expected document root; observed ${mode}`);
  }
  const issue = validate_livemap_document_schema_root(schema, parsed.value, mode).issues[0];
  assert.notEqual(issue, undefined);
  return resolve_document_schema_issue_source(parsed.value, mode, parsed.provenance, issue);
}

function assert_exact_slice(result: DocumentSchemaSourceResolution, source: string, expected: string): void {
  assert.equal(result.kind, "exact");
  if (result.kind !== "exact") return;
  assert.equal(source.slice(result.range.start, result.range.end), expected);
}

function assert_anchor(result: DocumentSchemaSourceResolution): void {
  assert.equal(result.kind, "anchor");
  if (result.kind !== "anchor") return;
  assert.equal(result.range.start < result.range.end, true);
}

check("element root tag failure resolves root coverage", () => {
  const source = `<main/>`;
  assert_exact_slice(resolve_first(source, hson.liveMap.schema.define((s) => s.div())), source, source);
});

check("child element failure resolves child coverage", () => {
  const source = `<main <span/>/>`;
  assert_exact_slice(resolve_first(source, hson.liveMap.schema.define((s) => s.main(s.button()))), source, `<span/>`);
});

check("nested element failure resolves nested coverage", () => {
  const source = `<main <section <em/>/>/>`;
  assert_exact_slice(resolve_first(source, hson.liveMap.schema.define((s) => s.main(s.section(s.strong())))), source, `<em/>`);
});

check("element roots prepend exactly one Phase-B root slot", () => {
  const result = resolve_first(`<main <span/>/>`, hson.liveMap.schema.define((s) => s.main(s.button())));
  assert.deepEqual(result.kind === "exact" ? result.physicalPath : undefined, [0, 0, 0]);
});

check("text rejected as an element resolves the scalar payload", () => {
  const source = `<main "bad"/>`;
  assert_exact_slice(resolve_first(source, hson.liveMap.schema.define((s) => s.main(s.button()))), source, `"bad"`);
});

check("nested rejected text resolves the nested scalar payload", () => {
  const source = `<main <section "bad"/>/>`;
  assert_exact_slice(resolve_first(source, hson.liveMap.schema.define((s) => s.main(s.section(s.button())))), source, `"bad"`);
});

check("text carrier mechanically advances to the authoritative value path", () => {
  const result = resolve_first(`<main "bad"/>`, hson.liveMap.schema.define((s) => s.main(s.button())));
  assert.deepEqual(result.kind === "exact" ? result.physicalPath : undefined, [0, 0, 0, 0]);
  assert.equal(result.kind === "exact" ? result.role : undefined, "value");
});

check("materialized fragment root failures resolve fragment coverage", () => {
  const source = `<a/> <b/>`;
  assert_exact_slice(resolve_first(source, hson.liveMap.schema.define((s) => s.tuple(s.a()))), source, source);
});

check("fragment child failures resolve the existing child", () => {
  const source = `<a/> <span/>`;
  assert_exact_slice(resolve_first(source, hson.liveMap.schema.define((s) => s.tuple(s.a(), s.button()))), source, `<span/>`);
});

check("nested fragment content resolves through element carriers", () => {
  const source = `<a/> <section <em/>/>`;
  assert_exact_slice(resolve_first(source, hson.liveMap.schema.define((s) => s.tuple(s.a(), s.section(s.strong())))), source, `<em/>`);
});

check("fragment physical paths receive no element-root prefix", () => {
  const result = resolve_first(`<a/> <span/>`, hson.liveMap.schema.define((s) => s.tuple(s.a(), s.button())));
  assert.deepEqual(result.kind === "exact" ? result.physicalPath : undefined, [1]);
});

check("invalid attribute values prefer attribute value provenance", () => {
  const source = `<button count="bad"/>`;
  const schema = hson.liveMap.schema.define((s) => s.button(s.attrs({ count: s.number })));
  const result = resolve_first(source, schema);
  assert_exact_slice(result, source, `"bad"`);
  assert.equal(result.kind === "exact" ? result.role : undefined, "value");
});

check("unknown exact attributes prefer attribute name provenance", () => {
  const source = `<button extra="x"/>`;
  const schema = hson.liveMap.schema.define((s) => s.button(s.attrs.exact({})));
  const result = resolve_first(source, schema);
  assert_exact_slice(result, source, "extra");
  assert.equal(result.kind === "exact" ? result.role : undefined, "name");
});

check("missing required attributes anchor to the owning element", () => {
  const schema = hson.liveMap.schema.define((s) => s.button(s.attrs({ id: s.string })));
  const result = resolve_first(`<button/>`, schema);
  assert_anchor(result);
  assert.deepEqual(result.kind === "anchor" ? result.physicalPath : undefined, [0]);
});

check("missing required flags anchor to the owning element", () => {
  const schema = hson.liveMap.schema.define((s) => s.button(s.attrs({ disabled: s.flag })));
  assert_anchor(resolve_first(`<button/>`, schema));
});

check("missing element content anchors to the parent close", () => {
  const result = resolve_first(`<main <span/>/>`, hson.liveMap.schema.define((s) => s.main(s.span(), s.button())));
  assert_anchor(result);
  assert.equal(result.kind === "anchor" ? result.role : undefined, "close");
});

check("nested missing content anchors to the nested parent", () => {
  const result = resolve_first(`<main <section <span/>/>/>`, hson.liveMap.schema.define((s) => s.main(s.section(s.span(), s.button()))));
  assert_anchor(result);
  assert.deepEqual(result.kind === "anchor" ? result.physicalPath : undefined, [0, 0, 0]);
});

check("missing tuple position anchors to the fragment container", () => {
  const result = resolve_first(
    `<a/> <span/>`,
    hson.liveMap.schema.define((s) => s.tuple(s.a(), s.span(), s.button())),
  );
  assert_anchor(result);
  assert.deepEqual(result.kind === "anchor" ? result.physicalPath : undefined, []);
});

check("short counted repeats anchor to the existing parent", () => {
  const schema = hson.liveMap.schema.define((s) => s.div(s.repeat(2, s.button())));
  assert_anchor(resolve_first(`<div <button/>/>`, schema));
});

check("absent empty-element carriers still anchor to the ordinary owner", () => {
  const result = resolve_first(`<main/>`, hson.liveMap.schema.define((s) => s.main(s.button())));
  assert_anchor(result);
  assert.deepEqual(result.kind === "anchor" ? result.physicalPath : undefined, [0]);
});

check("empty fragments remain unresolved without fabricated root provenance", () => {
  const root: HsonNode = { $_tag: "_hson_root", $_content: [] };
  const provenance = new HsonSourceProvenanceBuilder().finalize(root, 0);
  const schema = hson.liveMap.schema.define((s) => s.tuple(s.string));
  const issue = validate_livemap_document_schema_root(schema, root, "fragment").issues[0];
  assert.notEqual(issue, undefined);
  assert.equal(resolve_document_schema_issue_source(root, "fragment", provenance, issue).kind, "unresolved");
});

check("non-BMP prefixes preserve authored UTF-16 offsets", () => {
  const source = `<main title="😀" "bad"/>`;
  const result = resolve_first(source, hson.liveMap.schema.define((s) => s.main(s.button())));
  assert_exact_slice(result, source, `"bad"`);
  assert.equal(result.kind === "exact" ? result.range.start : undefined, 17);
});

check("stale numeric logical paths resolve as unresolved", () => {
  const parsed = parse_hson_with_provenance(`<main/>`);
  const issue: LiveMapSchemaIssue = Object.freeze({
    code: "TYPE_MISMATCH",
    path: Object.freeze([9, 4]),
    message: "stale internal issue",
  });
  assert.equal(resolve_document_schema_issue_source(parsed.value, "element", parsed.provenance, issue).kind, "unresolved");
});

check("unexpected existing content resolves the offending item's coverage", () => {
  const source = `<a/> <em/>`;
  const schema = hson.liveMap.schema.define((s) => s.tuple(s.a(), s.button()));
  assert_exact_slice(resolve_first(source, schema), source, `<em/>`);
});

process.stdout.write(`# ${checks} document Schema source-lowering checks passed\n`);
emit_hson_live_test_completion("livemap.document-schema-source-lowering", checks, checks, 0);
