import * as messages from "./diagnostic-messages.js";
import { admit_hson } from "../../../src/api/transform/hson-admission.js";
import { tokenize_hson } from "../../../src/api/transform/parsers/tokenize-hson.js";
import { read_transform_error_details } from "../../../src/core/errors.js";
import { interpolation_site } from "../../../src/internal/trusted-schema-diagnostics/interpolation-source.js";
import { source_point_range_at, type EmbeddedHsonSource, type HostSourceRange } from "../../../src/internal/embedded-hson/embedded-hson-source.js";
import { create_hson_source_program, type InterpolatedEmbeddedHsonTemplate } from "../../../src/internal/embedded-hson/discover-hson-tagged-templates.js";
import type { DocumentDiagnosticSpec } from "./document-diagnostics.js";

type Literal = ReturnType<typeof interpolation_site>["literals"][number];

function diagnostic(error: unknown, literal: Literal, fallback: HostSourceRange): DocumentDiagnosticSpec {
  const details = read_transform_error_details(error);
  if (!details) throw error;
  const map = (index: number): HostSourceRange | undefined => {
    const point = source_point_range_at(literal.raw, index);
    if (!point) return undefined;
    const start = literal.boundaries[point.start], end = literal.boundaries[point.end];
    return start === undefined || end === undefined ? undefined : { start, end };
  };
  const primary = details.source && map(details.source.index);
  return {
    message: error instanceof Error ? error.message : messages.hsonAdmissionFailed,
    range: primary ?? fallback, source: "HSON", code: details.code,
    precision: !primary ? "fallback" : details.source?.index === literal.raw.length ? "eof" : "point",
    related: (details.related ?? []).flatMap(item => {
      const range = map(item.source.index);
      return range ? [{ message: messages.hsonSourceRelated(item.role), range }] : [];
    }),
  };
}

export function diagnose_hson_tag(source: EmbeddedHsonSource): readonly DocumentDiagnosticSpec[] {
  // Reuse D5's raw-template newline/UTF-16 correspondence, with zero holes.
  const literal = interpolation_site({ ...source, substitutionRanges: [], expressionRanges: [] }, source.fileName).literals[0]!;
  // TypeScript, not an editor escape grammar, determines cooked availability.
  // The real tag rejects undefined cooked segments even though it parses raw.
  const program = create_hson_source_program(source.fileName, source.hostText.slice(source.templateRange.start, source.templateRange.end));
  const invalidEscape = program.getSyntacticDiagnostics().length > 0;
  // Cooked contents are not consumed by HSON, only their availability is checked.
  const strings = Object.freeze(Object.assign([invalidEscape ? undefined : literal.raw], { raw: Object.freeze([literal.raw]) }));
  try {
    // Reflect allows the actual admission boundary to reject invalid cooked
    // segments; no eval, workspace import, or substitution execution occurs.
    Reflect.apply(admit_hson, undefined, [strings]);
    return [];
  } catch (error) {
    return [diagnostic(error, literal, source.bodyRange)];
  }
}

// Only irrevocable lexer failures in the prefix, before any unknown value.
// Incomplete containers/tokens and downstream structure cannot be decided here.
// Codes are emitted by the real tokenizer, not matched by editor syntax rules.
const prefixFailures = new Set(["HSON_NUMBER_LEADING_PLUS", "HSON_NUMBER_LEADING_ZERO",
  "HSON_STRING_CONTROL_UNESCAPED", "HSON_NAME_CONTROL_UNESCAPED", "HSON_NAME_LEGACY_BACKTICK", "HSON_UNSUPPORTED_WHITESPACE"]);

export function diagnose_hson_prefix(source: InterpolatedEmbeddedHsonTemplate): readonly DocumentDiagnosticSpec[] {
  const literal = interpolation_site(source, source.fileName).literals[0]!;
  try { tokenize_hson(literal.raw); } catch (error) {
    const details = read_transform_error_details(error);
    if (!details) throw error;
    if (prefixFailures.has(details.code) && details.source && details.source.index < literal.raw.length - 1) {
      return [diagnostic(error, literal, literal.range)];
    }
  }
  return [];
}
