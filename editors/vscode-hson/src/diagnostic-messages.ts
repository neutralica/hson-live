import type { SchemaStatus } from "./trusted-schema-client.js";

// Editor-owned wording only. Selection, validation, evidence and range mapping
// stay with their existing owners. Stable export names are catalog review IDs.

// A Schema issue identifies an attribute or the final path segment, or neither.
// Used inside exact/anchor/unresolved diagnostics; a numeric path is not a name.
export function diagnosticSubject(name: string | number | undefined, attribute: boolean): string {
  return name === undefined ? "this value" : attribute ? `attribute \`${name}\`` : `\`${name}\``;
}

// Trusted capture associates a scalar with one substitution expression.
// Attached to that expression, not its evaluated characters or literal segments.
export function substitutionEvaluation(kind: string): string {
  return `This expression evaluated to ${kind === "null" ? "Hson null" : `an Hson ${kind}`}`;
}

// TYPE_MISMATCH belongs to a captured substitution expression.
// Expected is the existing Schema description, not a reconstructed contract.
export function substitutionTypeMismatch(evaluated: string, expected: string | undefined): string {
  return `${evaluated}, but the Schema requires ${expected ?? "a different value"} here.`;
}

// INVALID_LITERAL belongs to a captured substitution expression.
// The expression range is used; expected may describe several literals as text.
export function substitutionLiteralMismatch(evaluated: string, expected: string | undefined): string {
  return `${evaluated}, but the Schema requires literal ${expected} here.`;
}

// A captured substitution fails its predicate after base validation succeeds.
// The expression range is used; without a label no predicate intent is known.
export function substitutionConstraintFailed(evaluated: string, label: string | undefined): string {
  return `${evaluated} that does not satisfy ${label === undefined ? "its Schema constraint" : `constraint “${label}”`}.`;
}

// A substitution issue has no specialized wording for its code.
// Attached to the expression; the code is retained without inferring a repair.
export function substitutionValidationFailed(evaluated: string, code: string): string {
  return `${evaluated} that fails Schema validation (${code}).`;
}

// The private tag sidecar identifies a document element tag mismatch.
// Usually on the element's coverage; expected/received are formatted by the core.
export function documentTagMismatch(expected: string | undefined, received: string | undefined): string {
  return `Expected element tag ${expected}; found ${received}.`;
}

// MISSING_REQUIRED carries the private flag sidecar and attributeName.
// Anchored to the element close/name/coverage; there is no authored flag token.
export function requiredFlagMissing(name: string | undefined): string {
  return `Required flag \`${name}\` is missing.`;
}

// MISSING_REQUIRED covers data members, tuple positions and document gaps.
// Anchored to existing parent source; the path does not describe a complex child.
export function requiredValueMissing(subject: string): string {
  return `Required ${subject} is missing.`;
}

// UNKNOWN_KEY identifies a data member or an ordinary attribute.
// Usually on its name; the issue does not carry the full allowed-key set.
export function exactMemberUnknown(subject: string): string {
  return `${subject} is not allowed by this exact Schema.`;
}

// INVALID_CONSTRAINT follows successful base validation and a false predicate.
// Usually on the value; labels are metadata, not executable repair instructions.
export function constraintFailed(subject: string, label: string | undefined): string {
  return label === undefined ? `${subject} does not satisfy its Schema constraint.`
    : `${subject} does not satisfy constraint “${label}”.`;
}

// INVALID_LITERAL supplies preformatted expected and received descriptions.
// Usually on the value; no structured list of allowed literals crosses transport.
export function literalMismatch(subject: string, expected: string | undefined, received: string | undefined): string {
  return `Expected ${subject} to equal ${expected}; found ${received}.`;
}

// TYPE_MISMATCH has recognized primitive/container kind descriptions on both sides.
// Usually on the value; attributes remain strings even when authored unquoted.
export function primitiveTypeMismatch(subject: string, expected: string, received: string): string {
  return `Expected ${subject} to be ${expected === "null" ? "null" : `${expected === "object" || expected === "array" ? "an" : "a"} ${expected}`}, but this value is an Hson ${received}.`;
}

// TYPE_MISMATCH lacks two recognized kind descriptions (including root/pick errors).
// Uses the existing exact/anchor/unresolved range; missing descriptions stay neutral.
export function schemaTypeMismatch(subject: string, expected: string | undefined, received: string | undefined): string {
  return `Expected ${subject}: ${expected ?? "a compatible Schema value"}; received ${received ?? "an incompatible value"}.`;
}

// No specialized editor wording exists for this issue code, including surplus items.
// Uses the lowerer's range; the code must not be interpreted as an inferred fix.
export function schemaValidationFailed(subject: string, code: string): string {
  return `Schema validation failed for ${subject} (${code}).`;
}

// Lowering located existing parent source for absent required structure.
// Appended on anchor ranges only; it does not claim the missing token exists.
export const anchoredLocationNote = " (Anchored to existing source; required structure is absent.)";

// A Schema range could not be mapped truthfully to a character-exact host span.
// Appended on occurrence-level fallback; static fromHson also uses this legacy text.
export const unresolvedLocationNote = " (Template-level diagnostic; exact source location unavailable.)";

// A reconstructed-source span crosses more than one interpolation origin.
// The mapped host span is explicitly non-character-exact, even if offsets exist.
export const compositeLocationNote = " (Range spans multiple source origins; not a character-exact location.)";

// A discovered validation association supplies its Schema label and rendered issue.
// Wraps any precision without adding validation evidence or changing the range.
export function schemaDiagnostic(label: string, message: string, locationNote: string): string {
  return `[${label}] ${message}${locationNote}`;
}

// Discovery proved a certify/legacy validate or map.schema.use association for this occurrence.
// Related range is the call, not the primary diagnostic or Schema declaration.
export function schemaRequestRelated(call: "certify" | "validate" | "map.schema.use", label: string): string {
  return `Schema requested by this ${call} call (${label}).`;
}

// TransformError contains a related source role whose offset maps successfully.
// Related range points at that source token; role names are inherited, not inferred.
export function hsonSourceRelated(role: string): string {
  return `Related Hson source (${role}).`;
}

// The standalone/static adapter has Transform details but no local Error instance.
// Uses point/EOF or whole-source fallback; real local TransformErrors pass verbatim.
export const hsonValidationFailed = "Hson validation failed.";

// The tagged admission adapter has Transform details but no local Error instance.
// Uses literal point/EOF or body fallback; this is not a new admission rule.
export const hsonAdmissionFailed = "Hson admission failed.";

// The trusted client caught a non-Error value while validating.
// Status tooltip only; no source diagnostic or exception detail is invented.
export const schemaRuntimeFailed = "Trusted Schema runtime failed.";

// The diagnostic controller's client promise rejected with a non-Error value.
// Status tooltip only; this remains distinct from the trusted-client fallback.
export const runtimeFailed = "Runtime failed.";

// The active document's status is displayed, defaulting to off without a record.
// Status-bar text only; absence of errors must not imply validation success.
export function schemaStatusLabel(status: SchemaStatus | undefined): string {
  return `Hson Schema: ${status ?? "off"}`;
}

// Current source was checked against trusted runtime evidence.
// Status tooltip only; predicates can be stateful and this is not a certificate.
export const currentSchemaStatus = "Current authored source checked using trusted runtime evidence. Stateful predicates may change.";

// No current valid/invalid result supplies the default status explanation.
// Status tooltip only; off/waiting/stale/ambiguous/unavailable/failure share this text.
export const unavailableSchemaStatus = "Trusted Schema diagnostics require Workspace Trust, explicit enablement, and a current registered source binding. No diagnostics does not mean Schema passed.";

// An optional runtime message overrides the default status explanation verbatim.
// Tooltip only; even an empty supplied message is preserved, with no English parsing.
export function schemaStatusTooltip(status: SchemaStatus | undefined, message?: string): string {
  return message ?? (status === "current-valid" || status === "current-invalid" ? currentSchemaStatus : unavailableSchemaStatus);
}

// Syntax production threw outside the recognized TransformError path.
// Extension-host console only; the underlying error is logged separately.
export function unexpectedDiagnosticsFailure(fileName: string): string {
  return `Hson diagnostics failed for ${fileName}`;
}

// Measured trusted validation end-to-end time is at least two seconds.
// Diagnostics output channel only; the threshold does not imply a timeout.
export const slowSchemaRequest = "Slow trusted diagnostic request (>= 2 seconds); includes cold load if this is the first request.";

// A completion candidate provides its core-owned detail description.
// Completion menu only, not a diagnostic; the description passes through verbatim.
export function schemaCompletionDetail(detail: string): string {
  return `Hson Schema: ${detail}`;
}

// The packaged grammar registry returned no grammar after loading its resources.
// Infrastructure error only; not an authored syntax error or a color-setting change.
export const missingPackagedGrammar = "Missing packaged Hson grammar";
