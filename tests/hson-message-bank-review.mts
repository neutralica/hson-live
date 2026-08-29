import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as m from "../editors/vscode-hson/src/diagnostic-messages.ts";
import type { SchemaStatus } from "../editors/vscode-hson/src/trusted-schema-client.ts";

export type MessageCase = Readonly<{
  id: keyof typeof m;
  variant: string;
  render(): string;
  expected: string;
}>;

// Deliberately literal expectations: wording edits require a conscious review.
export const messageCases: readonly MessageCase[] = [
  { id: "diagnosticSubject", variant: "root", render: () => m.diagnosticSubject(undefined, false), expected: "this value" },
  { id: "diagnosticSubject", variant: "member", render: () => m.diagnosticSubject("age", false), expected: "`age`" },
  { id: "diagnosticSubject", variant: "index", render: () => m.diagnosticSubject(1, false), expected: "`1`" },
  { id: "diagnosticSubject", variant: "attribute", render: () => m.diagnosticSubject("count", true), expected: "attribute `count`" },
  { id: "substitutionEvaluation", variant: "string", render: () => m.substitutionEvaluation("string"), expected: "This expression evaluated to an Hson string" },
  { id: "substitutionEvaluation", variant: "null", render: () => m.substitutionEvaluation("null"), expected: "This expression evaluated to Hson null" },
  { id: "substitutionEvaluation", variant: "fallback", render: () => m.substitutionEvaluation("value"), expected: "This expression evaluated to an Hson value" },
  { id: "substitutionTypeMismatch", variant: "number", render: () => m.substitutionTypeMismatch(m.substitutionEvaluation("string"), "number"), expected: "This expression evaluated to an Hson string, but the Schema requires number here." },
  { id: "substitutionTypeMismatch", variant: "fallback", render: () => m.substitutionTypeMismatch(m.substitutionEvaluation("null"), undefined), expected: "This expression evaluated to Hson null, but the Schema requires a different value here." },
  { id: "substitutionLiteralMismatch", variant: "literal", render: () => m.substitutionLiteralMismatch(m.substitutionEvaluation("string"), '"draft"'), expected: 'This expression evaluated to an Hson string, but the Schema requires literal "draft" here.' },
  { id: "substitutionLiteralMismatch", variant: "missing-evidence", render: () => m.substitutionLiteralMismatch(m.substitutionEvaluation("string"), undefined), expected: "This expression evaluated to an Hson string, but the Schema requires literal undefined here." },
  { id: "substitutionConstraintFailed", variant: "labeled", render: () => m.substitutionConstraintFailed(m.substitutionEvaluation("number"), "positive age"), expected: "This expression evaluated to an Hson number that does not satisfy constraint “positive age”." },
  { id: "substitutionConstraintFailed", variant: "unlabeled", render: () => m.substitutionConstraintFailed(m.substitutionEvaluation("number"), undefined), expected: "This expression evaluated to an Hson number that does not satisfy its Schema constraint." },
  { id: "substitutionValidationFailed", variant: "generic", render: () => m.substitutionValidationFailed(m.substitutionEvaluation("string"), "INVALID_SCHEMA"), expected: "This expression evaluated to an Hson string that fails Schema validation (INVALID_SCHEMA)." },
  { id: "documentTagMismatch", variant: "tag", render: () => m.documentTagMismatch('"button"', '"span"'), expected: 'Expected element tag "button"; found "span".' },
  { id: "requiredFlagMissing", variant: "flag", render: () => m.requiredFlagMissing("disabled"), expected: "Required flag `disabled` is missing." },
  { id: "requiredValueMissing", variant: "member", render: () => m.requiredValueMissing("`age`"), expected: "Required `age` is missing." },
  { id: "requiredValueMissing", variant: "position", render: () => m.requiredValueMissing("`1`"), expected: "Required `1` is missing." },
  { id: "exactMemberUnknown", variant: "member", render: () => m.exactMemberUnknown("`extra`"), expected: "`extra` is not allowed by this exact Schema." },
  { id: "exactMemberUnknown", variant: "attribute", render: () => m.exactMemberUnknown("attribute `extra`"), expected: "attribute `extra` is not allowed by this exact Schema." },
  { id: "constraintFailed", variant: "labeled", render: () => m.constraintFailed("`age`", "positive age"), expected: "`age` does not satisfy constraint “positive age”." },
  { id: "constraintFailed", variant: "unlabeled", render: () => m.constraintFailed("`age`", undefined), expected: "`age` does not satisfy its Schema constraint." },
  { id: "constraintFailed", variant: "empty-label", render: () => m.constraintFailed("`age`", ""), expected: "`age` does not satisfy constraint “”." },
  { id: "literalMismatch", variant: "finite-alternatives", render: () => m.literalMismatch("`state`", '"draft" | "published"', '"pending"'), expected: 'Expected `state` to equal "draft" | "published"; found "pending".' },
  { id: "literalMismatch", variant: "missing-evidence", render: () => m.literalMismatch("this value", undefined, undefined), expected: "Expected this value to equal undefined; found undefined." },
  { id: "primitiveTypeMismatch", variant: "number", render: () => m.primitiveTypeMismatch("`age`", "number", "string"), expected: "Expected `age` to be a number, but this value is an Hson string." },
  { id: "primitiveTypeMismatch", variant: "string", render: () => m.primitiveTypeMismatch("`name`", "string", "number"), expected: "Expected `name` to be a string, but this value is an Hson number." },
  { id: "primitiveTypeMismatch", variant: "array", render: () => m.primitiveTypeMismatch("this value", "array", "object"), expected: "Expected this value to be an array, but this value is an Hson object." },
  { id: "primitiveTypeMismatch", variant: "object", render: () => m.primitiveTypeMismatch("this value", "object", "array"), expected: "Expected this value to be an object, but this value is an Hson array." },
  { id: "primitiveTypeMismatch", variant: "null", render: () => m.primitiveTypeMismatch("this value", "null", "boolean"), expected: "Expected this value to be null, but this value is an Hson boolean." },
  { id: "primitiveTypeMismatch", variant: "boolean", render: () => m.primitiveTypeMismatch("this value", "boolean", "null"), expected: "Expected this value to be a boolean, but this value is an Hson null." },
  { id: "schemaTypeMismatch", variant: "root", render: () => m.schemaTypeMismatch("this value", "fragment document root", "data root"), expected: "Expected this value: fragment document root; received data root." },
  { id: "schemaTypeMismatch", variant: "fallback", render: () => m.schemaTypeMismatch("attribute `count`", undefined, undefined), expected: "Expected attribute `count`: a compatible Schema value; received an incompatible value." },
  { id: "schemaValidationFailed", variant: "surplus", render: () => m.schemaValidationFailed("`1`", "TUPLE_INDEX_OUT_OF_RANGE"), expected: "Schema validation failed for `1` (TUPLE_INDEX_OUT_OF_RANGE)." },
  { id: "schemaValidationFailed", variant: "unknown-path", render: () => m.schemaValidationFailed("`ghost`", "UNKNOWN_PATH"), expected: "Schema validation failed for `ghost` (UNKNOWN_PATH)." },
  { id: "schemaValidationFailed", variant: "invalid-schema", render: () => m.schemaValidationFailed("this value", "INVALID_SCHEMA"), expected: "Schema validation failed for this value (INVALID_SCHEMA)." },
  { id: "anchoredLocationNote", variant: "anchor", render: () => m.anchoredLocationNote, expected: " (Anchored to existing source; required structure is absent.)" },
  { id: "unresolvedLocationNote", variant: "unresolved", render: () => m.unresolvedLocationNote, expected: " (Template-level diagnostic; exact source location unavailable.)" },
  { id: "compositeLocationNote", variant: "composite", render: () => m.compositeLocationNote, expected: " (Range spans multiple source origins; not a character-exact location.)" },
  { id: "schemaDiagnostic", variant: "exact", render: () => m.schemaDiagnostic("UserSchema", m.requiredValueMissing("`age`"), ""), expected: "[UserSchema] Required `age` is missing." },
  { id: "schemaRequestRelated", variant: "validate", render: () => m.schemaRequestRelated("validate", "UserSchema"), expected: "Schema requested by this validate call (UserSchema)." },
  { id: "schemaRequestRelated", variant: "use", render: () => m.schemaRequestRelated("map.schema.use", "UserSchema"), expected: "Schema requested by this map.schema.use call (UserSchema)." },
  { id: "hsonSourceRelated", variant: "first-declaration", render: () => m.hsonSourceRelated("first-declaration"), expected: "Related Hson source (first-declaration)." },
  { id: "hsonValidationFailed", variant: "fallback", render: () => m.hsonValidationFailed, expected: "Hson validation failed." },
  { id: "hsonAdmissionFailed", variant: "fallback", render: () => m.hsonAdmissionFailed, expected: "Hson admission failed." },
  { id: "schemaRuntimeFailed", variant: "fallback", render: () => m.schemaRuntimeFailed, expected: "Trusted Schema runtime failed." },
  { id: "runtimeFailed", variant: "fallback", render: () => m.runtimeFailed, expected: "Runtime failed." },
  { id: "schemaStatusLabel", variant: "missing-state", render: () => m.schemaStatusLabel(undefined), expected: "Hson Schema: off" },
  { id: "currentSchemaStatus", variant: "current", render: () => m.currentSchemaStatus, expected: "Current authored source checked using trusted runtime evidence. Stateful predicates may change." },
  { id: "unavailableSchemaStatus", variant: "not-current", render: () => m.unavailableSchemaStatus, expected: "Trusted Schema diagnostics require Workspace Trust, explicit enablement, and a current registered source binding. No diagnostics does not mean Schema passed." },
  { id: "schemaStatusTooltip", variant: "current", render: () => m.schemaStatusTooltip("current-valid"), expected: "Current authored source checked using trusted runtime evidence. Stateful predicates may change." },
  { id: "schemaStatusTooltip", variant: "missing-state", render: () => m.schemaStatusTooltip(undefined), expected: "Trusted Schema diagnostics require Workspace Trust, explicit enablement, and a current registered source binding. No diagnostics does not mean Schema passed." },
  { id: "schemaStatusTooltip", variant: "runtime-override", render: () => m.schemaStatusTooltip("runtime-failed", "predicate exploded"), expected: "predicate exploded" },
  { id: "schemaStatusTooltip", variant: "empty-override", render: () => m.schemaStatusTooltip("runtime-failed", ""), expected: "" },
  { id: "unexpectedDiagnosticsFailure", variant: "file", render: () => m.unexpectedDiagnosticsFailure("/project/user.ts"), expected: "Hson diagnostics failed for /project/user.ts" },
  { id: "slowSchemaRequest", variant: "slow", render: () => m.slowSchemaRequest, expected: "Slow trusted diagnostic request (>= 2 seconds); includes cold load if this is the first request." },
  { id: "schemaCompletionDetail", variant: "detail", render: () => m.schemaCompletionDetail("required member"), expected: "Hson Schema: required member" },
  { id: "missingPackagedGrammar", variant: "missing", render: () => m.missingPackagedGrammar, expected: "Missing packaged Hson grammar" },
];

export function check_message_bank(check: (name: string, run: () => void) => void): void {
  for (const sample of messageCases) check(`bank ${sample.id}/${sample.variant}`, () => assert.equal(sample.render(), sample.expected));
  const statuses: readonly SchemaStatus[] = ["off", "waiting", "current-valid", "current-invalid", "stale", "ambiguous", "unavailable", "runtime-failed"];
  for (const status of statuses) check(`status ${status}`, () => {
    assert.equal(m.schemaStatusLabel(status), `Hson Schema: ${status}`);
    assert.equal(m.schemaStatusTooltip(status), status === "current-valid" || status === "current-invalid"
      ? "Current authored source checked using trusted runtime evidence. Stateful predicates may change."
      : "Trusted Schema diagnostics require Workspace Trust, explicit enablement, and a current registered source binding. No diagnostics does not mean Schema passed.");
  });
  check("all bank exports are tested and catalog IDs reconcile exactly", () => {
    const catalog = readFileSync(new URL("../docs/hson-authoring-message-catalog.md", import.meta.url), "utf8");
    const ids = [...catalog.matchAll(/^### bank\.([A-Za-z][A-Za-z0-9]*)$/gm)].map(match => match[1]);
    assert.equal(new Set(ids).size, ids.length, "catalog bank IDs must be unique");
    assert.deepEqual(ids.sort(), Object.keys(m).sort());
    assert.deepEqual([...new Set(messageCases.map(sample => sample.id))].sort(), Object.keys(m).sort());
    const variants = messageCases.map(sample => `${sample.id}/${sample.variant}`);
    assert.equal(new Set(variants).size, variants.length, "sample IDs must be unique");
    for (const sample of messageCases) {
      const start = catalog.indexOf(`### bank.${sample.id}\n`);
      const end = catalog.indexOf("\n### ", start + 1);
      const entry = catalog.slice(start, end === -1 ? undefined : end);
      assert.ok(entry.includes(`\n\`\`\`text\n${sample.expected}\n\`\`\``), `${sample.id}/${sample.variant} exact text missing from catalog`);
    }
  });
  check("each bank export has an immediately preceding maintainer comment", () => {
    const text = readFileSync(new URL("../editors/vscode-hson/src/diagnostic-messages.ts", import.meta.url), "utf8");
    const source = ts.createSourceFile("diagnostic-messages.ts", text, ts.ScriptTarget.Latest, true);
    for (const statement of source.statements) {
      if (!ts.canHaveModifiers(statement) || !ts.getModifiers(statement)?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword)) continue;
      const before = text.slice(0, statement.getStart(source)).trimEnd();
      assert.match(before.split("\n").at(-1) ?? "", /^\/\//, statement.getText(source));
    }
  });
}
