import type { TrustedSchemaDiagnostic } from "../../../src/internal/trusted-schema-diagnostics/protocol.js";
import type { DiscoveredSchemaValidation } from "../../../src/internal/trusted-schema-diagnostics/discover-validation-sources.js";
import type { DocumentDiagnosticSpec } from "./document-diagnostics.js";
import { authored_hson_occurrence_range, map_authored_hson_range } from "../../../src/internal/embedded-hson/authored-hson-source.js";

export function schema_diagnostic_message(issue: TrustedSchemaDiagnostic): string {
  if (issue.hostOrigin?.kind === "substitution-expression") {
    const kind = issue.hostOrigin.scalarKind ?? issue.received ?? "value";
    const evaluated = `This expression evaluated to ${kind === "null" ? "HSON null" : `an HSON ${kind}`}`;
    if (issue.code === "TYPE_MISMATCH") return `${evaluated}, but the Schema requires ${issue.expected ?? "a different value"} here.`;
    if (issue.code === "INVALID_LITERAL") return `${evaluated}, but the Schema requires literal ${issue.expected} here.`;
    if (issue.code === "INVALID_CONSTRAINT") return `${evaluated} that does not satisfy ${issue.constraintLabel === undefined ? "its Schema constraint" : `constraint “${issue.constraintLabel}”`}.`;
    return `${evaluated} that fails Schema validation (${issue.code}).`;
  }
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
  const occurrenceRange = authored_hson_occurrence_range(association.source);
  const { start, end } = issue.range;
  const precise = issue.range.precision !== "unresolved" && start !== undefined && end !== undefined
    && Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end >= start;
  const mapped = issue.hostOrigin?.range ?? (precise ? map_authored_hson_range(association.source, { start, end }) : undefined);
  const precision = issue.hostOrigin?.kind === "composite" || issue.hostOrigin?.kind === "unresolved" ? "unresolved"
    : issue.hostOrigin?.kind === "substitution-expression" ? "substitution-expression" : mapped !== undefined ? issue.range.precision : "unresolved";
  const locationNote = issue.hostOrigin?.kind === "composite" ? " (Range spans multiple source origins; not a character-exact location.)"
    : precision === "anchor" ? " (Anchored to existing source; required structure is absent.)"
    : precision === "unresolved" ? " (Template-level diagnostic; exact source location unavailable.)" : "";
  return {
    message: `[${association.schemaLabel}] ${schema_diagnostic_message(issue)}${locationNote}`,
    range: mapped ?? occurrenceRange,
    precision, source: "HSON", code: issue.code,
    hostOrigin: issue.hostOrigin?.kind,
    related: [{ range: association.callRange, message: `Schema requested by this ${association.mapFlow === undefined ? "validate" : "map.schema.use"} call (${association.schemaLabel}).` }],
  };
}
