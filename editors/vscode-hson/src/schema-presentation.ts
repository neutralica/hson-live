import type { TrustedSchemaDiagnostic } from "../../../src/internal/trusted-schema-diagnostics/protocol.js";
import type { DiscoveredSchemaValidation } from "../../../src/internal/trusted-schema-diagnostics/discover-validation-sources.js";
import type { DocumentDiagnosticSpec } from "./document-diagnostics.js";
import { authored_hson_occurrence_range, map_authored_hson_range } from "../../../src/internal/embedded-hson/authored-hson-source.js";
import * as messages from "./diagnostic-messages.js";

export function schema_diagnostic_message(issue: TrustedSchemaDiagnostic): string {
  if (issue.hostOrigin?.kind === "substitution-expression") {
    const kind = issue.hostOrigin.scalarKind ?? issue.received ?? "value";
    const evaluated = messages.substitutionEvaluation(kind);
    if (issue.code === "TYPE_MISMATCH") return messages.substitutionTypeMismatch(evaluated, issue.expected);
    if (issue.code === "INVALID_LITERAL") return messages.substitutionLiteralMismatch(evaluated, issue.expected);
    if (issue.code === "INVALID_CONSTRAINT") return messages.substitutionConstraintFailed(evaluated, issue.constraintLabel);
    return messages.substitutionValidationFailed(evaluated, issue.code);
  }
  const name = issue.attributeName ?? issue.path.at(-1);
  const subject = messages.diagnosticSubject(name, issue.attributeName !== undefined);
  if (issue.subject === "tag") return messages.documentTagMismatch(issue.expected, issue.received);
  if (issue.subject === "flag" && issue.code === "MISSING_REQUIRED") return messages.requiredFlagMissing(issue.attributeName);
  if (issue.code === "MISSING_REQUIRED") return messages.requiredValueMissing(subject);
  if (issue.code === "UNKNOWN_KEY") return messages.exactMemberUnknown(subject);
  if (issue.code === "INVALID_CONSTRAINT") return messages.constraintFailed(subject, issue.constraintLabel);
  if (issue.code === "INVALID_LITERAL") return messages.literalMismatch(subject, issue.expected, issue.received);
  if (issue.code === "TYPE_MISMATCH") {
    if (issue.expected !== undefined && issue.received !== undefined
      && ["number", "string", "boolean", "object", "array", "null"].includes(issue.expected)
      && ["number", "string", "boolean", "object", "array", "null"].includes(issue.received)) {
      return messages.primitiveTypeMismatch(subject, issue.expected, issue.received);
    }
    return messages.schemaTypeMismatch(subject, issue.expected, issue.received);
  }
  return messages.schemaValidationFailed(subject, issue.code);
}

export function present_schema_diagnostic(issue: TrustedSchemaDiagnostic, association: DiscoveredSchemaValidation): DocumentDiagnosticSpec {
  const occurrenceRange = authored_hson_occurrence_range(association.source);
  const { start, end } = issue.range;
  const precise = issue.range.precision !== "unresolved" && start !== undefined && end !== undefined
    && Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end >= start;
  const mapped = issue.hostOrigin?.range ?? (precise ? map_authored_hson_range(association.source, { start, end }) : undefined);
  const precision = issue.hostOrigin?.kind === "composite" || issue.hostOrigin?.kind === "unresolved" ? "unresolved"
    : issue.hostOrigin?.kind === "substitution-expression" ? "substitution-expression" : mapped !== undefined ? issue.range.precision : "unresolved";
  const locationNote = issue.hostOrigin?.kind === "composite" ? messages.compositeLocationNote
    : precision === "anchor" ? messages.anchoredLocationNote
    : precision === "unresolved" ? messages.unresolvedLocationNote : "";
  return {
    message: messages.schemaDiagnostic(association.schemaLabel, schema_diagnostic_message(issue), locationNote),
    range: mapped ?? occurrenceRange,
    precision, source: "HSON", code: issue.code,
    hostOrigin: issue.hostOrigin?.kind,
    related: [{ range: association.callRange, message: messages.schemaRequestRelated(association.mapFlow === undefined ? "validate" : "map.schema.use", association.schemaLabel) }],
  };
}
