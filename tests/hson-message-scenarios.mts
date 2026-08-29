import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hson } from "../src/hson.ts";
import { classify_live_root_mode } from "../src/api/livemap/livemap.document.ts";
import { is_projected_value_hson_node } from "../src/core/projected-value-graph.ts";
import { parse_hson_with_provenance } from "../src/internal/hson-source-provenance/parse-hson-with-provenance.ts";
import { validate_schema_hson_graph } from "../src/internal/schema-hson-validation/validate-schema-hson-graph.ts";
import { read_schema_issue_presentation } from "../src/internal/trusted-schema-diagnostics/issue-presentation.ts";
import { resolve_projected_schema_issue_source } from "../src/internal/projected-schema-source-lowering/projected-schema-source-lowering.ts";
import { resolve_document_schema_issue_source } from "../src/internal/document-schema-source-lowering/document-schema-source-lowering.ts";
import { present_schema_diagnostic } from "../editors/vscode-hson/src/schema-presentation.ts";
import { discover_schema_validation_sources } from "../src/internal/trusted-schema-diagnostics/discover-validation-sources.ts";
import { produce_document_diagnostics } from "../editors/vscode-hson/src/document-diagnostics.ts";

const define = hson.liveMap.schema.define;
export const schemaScenarios = [
  { id: "number-string", source: '<age "37">', schema: () => define(s => s.object({ age: s.number })) },
  { id: "string-number", source: '<name 37>', schema: () => define(s => s.object({ name: s.string })) },
  { id: "missing-member", source: '<>', schema: () => define(s => s.object({ age: s.number })) },
  { id: "unknown-member", source: '<extra 1>', schema: () => define(s => s.object.exact({})) },
  { id: "finite-literals", source: '<state "pending">', schema: () => define(s => s.object({ state: s.literal("draft", "published") })) },
  { id: "tuple-missing", source: '[1]', schema: () => define(s => s.tuple(s.number, s.string)) },
  { id: "tuple-extra", source: '[1, "extra"]', schema: () => define(s => s.tuple(s.number)) },
  { id: "constraint-labeled", source: '<age -1>', schema: () => define(s => s.object({ age: s.number.constrain("positive age", n => n > 0) })) },
  { id: "constraint-unlabeled", source: '<age -1>', schema: () => define(s => s.object({ age: s.number.constrain(n => n > 0) })) },
  { id: "pick", source: 'true', schema: () => define(s => s.pick(s.string, s.number)) },
  { id: "tagged", source: '<kind "other">', schema: () => define(s => s.tagged("kind", { draft: s.object({}), published: s.object({}) })) },
  { id: "document-pick", source: '<main <em/>/>', schema: () => define(s => s.main(s.pick(s.button(), s.span()))) },
  { id: "wrong-tag", source: '<span/>', schema: () => define(s => s.button()) },
  { id: "wrong-item-kind", source: '<main "bad"/>', schema: () => define(s => s.main(s.button())) },
  { id: "missing-child", source: '<main/>', schema: () => define(s => s.main(s.button())) },
  { id: "unexpected-child", source: '<main <button/>/>', schema: () => define(s => s.main(s.empty)) },
  { id: "invalid-attribute", source: '<button count="bad"/>', schema: () => define(s => s.button(s.attrs({ count: s.number }))) },
  { id: "unknown-attribute", source: '<button extra="x"/>', schema: () => define(s => s.button(s.attrs.exact({}))) },
  { id: "missing-attribute", source: '<button/>', schema: () => define(s => s.button(s.attrs({ id: s.string }))) },
  { id: "missing-flag", source: '<button/>', schema: () => define(s => s.button(s.attrs({ disabled: s.flag }))) },
  { id: "repeat-short", source: '<div <button/>/>', schema: () => define(s => s.div(s.repeat(2, s.button()))) },
  { id: "repeat-long", source: '<div <button/> <button/>/>', schema: () => define(s => s.div(s.repeat(1, s.button()))) },
  { id: "attribute-throw", source: '<button count="bad"/>', schema: () => define(s => s.button(s.attrs({ count: s.string.constrain("never throws?", () => { throw new Error("predicate exploded"); }) }))) },
  { id: "root-mismatch", source: '1', schema: () => define(s => s.tuple(s.button())) },
  { id: "invalid-capability", source: '1', schema: () => ({}) },
] as const;

export const syntaxScenarios = [
  { id: "invalid-primitive", source: "+1" },
  { id: "unsupported-quote", source: "'bad'" },
  { id: "malformed-member", source: "<age>" },
  { id: "incomplete-source", source: "<age 1" },
  { id: "empty-source", source: "" },
  { id: "duplicate-member", source: "<age 1 age 2>" },
  { id: "duplicate-attribute", source: "<button id=a id=b/>" },
  { id: "unexpected-closer", source: ">" },
] as const;

export function render_syntax_scenario(scenario: typeof syntaxScenarios[number]) {
  return produce_document_diagnostics({ languageId: "hson", fileName: "/project/review.hson", text: scenario.source }).map(spec => ({
    message: spec.message, code: spec.code, precision: spec.precision,
    slice: scenario.source.slice(spec.range.start, spec.range.end),
    related: spec.related.map(item => ({ message: item.message, slice: scenario.source.slice(item.range.start, item.range.end) })),
  }));
}

export function render_schema_scenario(scenario: typeof schemaScenarios[number]) {
  const parsed = parse_hson_with_provenance(scenario.source);
  const mode = is_projected_value_hson_node(parsed.value) ? "projected" : classify_live_root_mode(parsed.value);
  const issues = validate_schema_hson_graph(scenario.schema(), parsed.value).issues;
  assert.ok(issues.length > 0, scenario.id);
  const host = `import { Hson } from "hson-live"; import { ReviewSchema } from "./schema.js"; const value = Hson\`${scenario.source}\`; Hson.validate(ReviewSchema, value);`;
  const association = discover_schema_validation_sources("/project/review.ts", host)[0]!;
  return issues.map(issue => {
    const resolution = mode === "element" || mode === "fragment"
      ? resolve_document_schema_issue_source(parsed.value, mode, parsed.provenance, issue)
      : resolve_projected_schema_issue_source(parsed.value, parsed.provenance, issue);
    const range = resolution.kind === "unresolved" ? { precision: resolution.kind }
      : { precision: resolution.kind, ...resolution.range };
    const spec = present_schema_diagnostic({ ...read_schema_issue_presentation(issue), code: issue.code,
      path: issue.path, expected: issue.expected, received: issue.received, attributeName: issue.attributeName, range }, association);
    return { core: issue.message, message: spec.message, precision: spec.precision,
      slice: host.slice(spec.range.start, spec.range.end), related: spec.related[0]!.message };
  });
}

export function check_schema_scenarios(check: (name: string, run: () => void) => void): void {
  const catalog = readFileSync(new URL("../docs/hson-authoring-message-catalog.md", import.meta.url), "utf8");
  for (const scenario of schemaScenarios) check(`rendered scenario ${scenario.id}`, () => {
    // The catalog is the reviewed snapshot. Compare the entire rendered record,
    // including core/adapted text, placement and related information.
    const marker = `<!-- scenario:${scenario.id} -->\n\`\`\`json\n`;
    const start = catalog.indexOf(marker);
    assert.notEqual(start, -1, scenario.id);
    const jsonStart = start + marker.length;
    const end = catalog.indexOf("\n```", jsonStart);
    assert.deepEqual(render_schema_scenario(scenario), JSON.parse(catalog.slice(jsonStart, end)));
  });
  for (const scenario of syntaxScenarios) check(`syntax rendered scenario ${scenario.id}`, () => {
    const marker = `<!-- syntax:${scenario.id} -->\n\`\`\`json\n`;
    const start = catalog.indexOf(marker);
    assert.notEqual(start, -1, scenario.id);
    const jsonStart = start + marker.length;
    const end = catalog.indexOf("\n```", jsonStart);
    assert.deepEqual(render_syntax_scenario(scenario), JSON.parse(catalog.slice(jsonStart, end)));
  });
}
