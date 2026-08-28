import type { TrustedSchemaDiagnostic } from "../../../src/internal/trusted-schema-diagnostics/protocol.js";
import type { DiscoveredSchemaValidation } from "../../../src/internal/trusted-schema-diagnostics/discover-validation-sources.js";
import type { DocumentDiagnosticSpec } from "./document-diagnostics.js";

export function schema_diagnostic_message(issue: TrustedSchemaDiagnostic): string {
  const name = issue.attributeName ?? issue.path.at(-1);
  const subject = name === undefined ? "this value" : issue.attributeName === undefined ? `\`${name}\`` : `attribute \`${name}\``;
  if (issue.subject === "tag") return `Expected element tag ${issue.expected}; found ${issue.received}.`;
  if (issue.subject === "flag" && issue.code === "MISSING_REQUIRED") return `Required flag \`${issue.attributeName}\` is missing.`;
  if (issue.code === "MISSING_REQUIRED") return `Required ${subject} is missing.`;
  if (issue.code === "UNKNOWN_KEY") return `${subject} is not allowed by this exact Schema.`;
  if (issue.code === "INVALID_CONSTRAINT") return issue.constraintLabel === undefined
    ? `${subject} does not satisfy its Schema constraint.`
    : `${subject} does not satisfy constraint “${issue.constraintLabel}”.`;
  if (issue.code === "INVALID_LITERAL") return `Expected ${subject} to equal ${issue.expected}; found ${issue.received}.`;
  if (issue.code === "TYPE_MISMATCH") {
    if (["number", "string", "boolean", "object", "array", "null"].includes(issue.expected ?? "")
      && ["number", "string", "boolean", "object", "array", "null"].includes(issue.received ?? "")) {
      return `Expected ${subject} to be ${issue.expected === "null" ? "null" : `${issue.expected === "object" || issue.expected === "array" ? "an" : "a"} ${issue.expected}`}, but this value is an HSON ${issue.received}.`;
    }
    return `Expected ${subject}: ${issue.expected ?? "a compatible Schema value"}; received ${issue.received ?? "an incompatible value"}.`;
  }
  return `Schema validation failed for ${subject} (${issue.code}).`;
}

export function present_schema_diagnostic(issue: TrustedSchemaDiagnostic, association: DiscoveredSchemaValidation): DocumentDiagnosticSpec {
  const { bodyRange, templateRange } = association.source;
  const { start, end } = issue.range;
  const precise = issue.range.precision !== "unresolved" && start !== undefined && end !== undefined
    && Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end >= start && end <= bodyRange.end - bodyRange.start;
  const precision = precise ? issue.range.precision : "unresolved";
  const locationNote = precision === "anchor" ? " (Anchored to existing source; required structure is absent.)"
    : precision === "unresolved" ? " (Template-level diagnostic; exact source location unavailable.)" : "";
  return {
    message: `[${association.schemaLabel}] ${schema_diagnostic_message(issue)}${locationNote}`,
    range: precise ? { start: bodyRange.start + start!, end: bodyRange.start + end! } : templateRange,
    precision, source: "HSON", code: issue.code,
    related: [{ range: association.callRange, message: `Schema requested by this ${association.mapFlow === undefined ? "validate" : "map.schema.use"} call (${association.schemaLabel}).` }],
  };
}
