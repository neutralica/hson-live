import * as messages from "./diagnostic-messages.js";
import { admit_hson, reconstruct_hson_interpolated_template } from "../../../src/api/transform/hson-admission.js";
import { admit_canonical_hson_data_value } from "../../../src/api/data/hson-data-hson.js";
import { qualify_hson_document_source } from "../../../src/api/document/hson-document.js";
import { tokenize_hson, scan_hson_template_segments } from "../../../src/api/transform/parsers/tokenize-hson.js";
import { read_transform_error_details } from "../../../src/core/errors.js";
import { interpolation_site } from "../../../src/internal/trusted-schema-diagnostics/interpolation-source.js";
import { source_point_range_at, type HostSourceRange } from "../../../src/internal/embedded-hson/embedded-hson-source.js";
import { create_hson_source_program, type HsonAuthoringKind, type HsonTaggedTemplateSource, type InterpolatedEmbeddedHsonTemplate } from "../../../src/internal/embedded-hson/discover-hson-tagged-templates.js";
import type { DocumentDiagnosticSpec } from "./document-diagnostics.js";

type Literal = ReturnType<typeof interpolation_site>["literals"][number];

function diagnostic(error: unknown, literal: Literal, fallback: HostSourceRange, kind?: HsonAuthoringKind): DocumentDiagnosticSpec {
  const details = read_transform_error_details(error);
  if (details === undefined && !(error instanceof TypeError) && !(error instanceof SyntaxError)) throw error;
  const map = (index: number): HostSourceRange | undefined => {
    const point = source_point_range_at(literal.raw, index);
    if (!point) return undefined;
    const start = literal.boundaries[point.start], end = literal.boundaries[point.end];
    return start === undefined || end === undefined ? undefined : { start, end };
  };
  const primary = details?.source && map(details.source.index);
  return {
    message: error instanceof Error ? error.message : kind === undefined ? messages.hsonAdmissionFailed : `Hson.${kind} requires ${kind === "schema" ? "Schema-definition data" : `${kind}-mode Hson`}.`,
    range: primary ?? fallback, source: "Hson", code: details?.code,
    precision: !primary ? "fallback" : details?.source?.index === literal.raw.length ? "eof" : "point",
    related: (details?.related ?? []).flatMap(item => {
      const range = map(item.source.index);
      return range ? [{ message: messages.hsonSourceRelated(item.role), range }] : [];
    }),
  };
}

export function diagnose_hson_tag(source: HsonTaggedTemplateSource): readonly DocumentDiagnosticSpec[] {
  // Reuse D5's raw-template newline/UTF-16 correspondence, with zero holes.
  const literal = interpolation_site({ ...source, substitutionRanges: [], expressionRanges: [] }, source.fileName).literals[0]!;
  // TypeScript, not an editor escape grammar, determines cooked availability.
  // The real tag rejects undefined cooked segments even though it parses raw.
  const program = create_hson_source_program(source.fileName, source.hostText.slice(source.templateRange.start, source.templateRange.end));
  const invalidEscape = program.getSyntacticDiagnostics().length > 0;
  // Cooked contents are not consumed by Hson, only their availability is checked.
  const strings = Object.freeze(Object.assign([invalidEscape ? undefined : literal.raw], { raw: Object.freeze([literal.raw]) }));
  try {
    // Reflect keeps the real tagged-template cooked-segment guard without eval.
    if (source.authoringKind === "document") {
      const raw = Reflect.apply(reconstruct_hson_interpolated_template, undefined, [strings, []]);
      qualify_hson_document_source(raw.source);
    } else {
      const canonical = Reflect.apply(admit_hson, undefined, [strings]);
      if (source.authoringKind === "data" || source.authoringKind === "schema") admit_canonical_hson_data_value(canonical);
    }
    return [];
  } catch (error) {
    return [diagnostic(error, literal, source.bodyRange, source.authoringKind)];
  }
}

// Only irrevocable lexer failures in the prefix, before any unknown value.
// Incomplete containers/tokens and downstream structure cannot be decided here.
// Codes are emitted by the real tokenizer, not matched by editor syntax rules.
const prefixFailures = new Set(["HSON_NUMBER_LEADING_PLUS", "HSON_NUMBER_LEADING_ZERO",
  "HSON_STRING_CONTROL_UNESCAPED", "HSON_NAME_CONTROL_UNESCAPED", "HSON_NAME_LEGACY_BACKTICK", "HSON_UNSUPPORTED_WHITESPACE"]);

export function diagnose_hson_prefix(source: InterpolatedEmbeddedHsonTemplate): readonly DocumentDiagnosticSpec[] {
  const site = interpolation_site(source, source.fileName);
  const literal = site.literals[0]!;
  const preview = scan_hson_template_segments(
    site.literals.map(part => part.raw),
    site.expressions.map(() => "x"),
  );
  if (source.authoringKind === "schema") return [{
    message: "Hson.schema requires a substitution-free tagged template.",
    range: source.substitutionRanges[0]!, source: "Hson", code: "HSON_SCHEMA_INTERPOLATION_FORBIDDEN",
    precision: "exact", related: [],
  }];
  if (preview.slots.length !== 0) {
    try {
      tokenize_hson(preview.source, 0, undefined, preview.slots,
        source.authoringKind, site.expressions.map(() => "x"), source.authoringKind);
    } catch (error) {
      const details = read_transform_error_details(error);
      // Authored object/element mode crossings are knowable without evaluating
      // a substitution. Use the same scanner's contextual grammar observation.
      if (details?.code === "HSON_STRUCTURAL_MODE_CROSSING") {
        if (details.source && details.source.index < literal.raw.length) {
          return [diagnostic(error, literal, source.bodyRange, source.authoringKind)];
        }
        return [{ message: error instanceof Error ? error.message : "Invalid Hson context.",
          range: source.bodyRange, source: "Hson", code: details.code, precision: "fallback", related: [] }];
      }
      if (details?.code === "HSON_INTERPOLATION_POSITION_INVALID" || details?.code === "HSON_QUOTED_INTERPOLATION_PARTIAL") {
        const slot = preview.slots.find(item => item.offset === details.source?.index) ?? preview.slots[0]!;
        return [{ message: error instanceof Error ? error.message : "Interpolation is not allowed here.",
          range: source.substitutionRanges[slot.substitution]!, source: "Hson", code: details.code, precision: "exact", related: [] }];
      }
    }
  }
  try { tokenize_hson(literal.raw); } catch (error) {
    const details = read_transform_error_details(error);
    if (!details) throw error;
    if (prefixFailures.has(details.code) && details.source && details.source.index < literal.raw.length - 1) {
      return [diagnostic(error, literal, literal.range)];
    }
  }
  return [];
}
