import * as messages from "./diagnostic-messages.js";
import { admit_hson_tagged_source } from "../../../src/internal/embedded-hson/hson-tagged-source-admission.js";
import { tokenize_hson, tokenize_authored_document_library, scan_hson_template_segments } from "../../../src/api/transform/parsers/tokenize-hson.js";
import { reject_portable_quid_tokens } from "../../../src/api/transform/parsers/parse-hson-source.js";
import { parse_authored_document_library, register_document_quad_declaration } from "../../../src/api/livemap/livemap.document.quad.js";
import { read_transform_error_details } from "../../../src/core/errors.js";
import { interpolation_site } from "../../../src/internal/trusted-schema-diagnostics/interpolation-source.js";
import { source_point_range_at, type HostSourceRange } from "../../../src/internal/embedded-hson/embedded-hson-source.js";
import { type HsonAuthoringKind, type HsonTaggedTemplateSource, type InterpolatedEmbeddedHsonTemplate } from "../../../src/internal/embedded-hson/discover-hson-tagged-templates.js";
import type { DocumentDiagnosticSpec } from "./document-diagnostics.js";

import type { AuthoredQuadDeclaration } from "../../../src/api/transform/token.types.js";
import type { HsonSourceLexicalCollector } from "../../../src/internal/hson-source-provenance/hson-source-provenance.js";

type Literal = ReturnType<typeof interpolation_site>["literals"][number];

function diagnostic(error: unknown, literal: Literal, fallback: HostSourceRange, kind?: HsonAuthoringKind,
  mapSource?: (index: number) => HostSourceRange | undefined,
): DocumentDiagnosticSpec {
  const details = read_transform_error_details(error);
  if (details === undefined && !(error instanceof TypeError) && !(error instanceof SyntaxError)) throw error;
  const map = mapSource ?? ((index: number): HostSourceRange | undefined => {
    const point = source_point_range_at(literal.raw, index);
    if (!point) return undefined;
    const start = literal.boundaries[point.start], end = literal.boundaries[point.end];
    return start === undefined || end === undefined ? undefined : { start, end };
  });
  const primary = details?.source && map(details.source.index);
  return {
    message: error instanceof Error ? error.message : kind === undefined ? messages.hsonAdmissionFailed : `Hson.${kind} requires ${kind === "schema" ? "Schema-definition data" : `${kind}-mode Hson`}.`,
    range: primary ?? fallback, source: "Hson", code: details?.code,
    precision: !primary ? "fallback" : mapSource === undefined && details?.source?.index === literal.raw.length ? "eof" : "point",
    related: (details?.related ?? []).flatMap(item => {
      const range = map(item.source.index);
      return range ? [{ message: messages.hsonSourceRelated(item.role), range }] : [];
    }),
  };
}

export function diagnose_hson_tag(source: HsonTaggedTemplateSource): readonly DocumentDiagnosticSpec[] {
  // Reuse D5's raw-template newline/UTF-16 correspondence, with zero holes.
  const literal = interpolation_site({ ...source, substitutionRanges: [], expressionRanges: [] }, source.fileName).literals[0]!;
  try {
    const raw = admit_hson_tagged_source(source);
    // Known duplicate names will fail governed admission; diagnose them while
    // retaining the distinction from canonical producer proof.
    if (source.authoringKind === "document") parse_authored_document_library(raw);
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
// These declarations are wholly owned by literal source, even around unknown
// content slots. They must not disappear through the conservative prefix filter.
const declarationFailures = new Set(["HSON_LIBRARY_QUAD_INVALID", "HSON_LIBRARY_QUAD_DUPLICATE",
  "HSON_LIBRARY_QUAD_INELIGIBLE", "HSON_ELEMENT_QUID_INVALID", "HSON_ELEMENT_HEADER_AFTER_CONTENT",
  "PORTABLE_RUNTIME_QUID_FORBIDDEN", "HSON_PART_DECLARATION_INVALID"]);

export function diagnose_hson_prefix(source: InterpolatedEmbeddedHsonTemplate, literalQuadsOnly = false): readonly DocumentDiagnosticSpec[] {
  const site = interpolation_site(source, source.fileName);
  const literal = site.literals[0]!;
  const preview = scan_hson_template_segments(
    site.literals.map(part => part.raw),
    site.expressions.map(() => "x"),
  );
  const mapPreview = (index: number): HostSourceRange | undefined => {
    let offset = 0;
    for (const part of site.literals) {
      if (index < offset + part.raw.length) {
        const point = source_point_range_at(part.raw, index - offset);
        if (point === undefined) return undefined;
        const start = part.boundaries[point.start], end = part.boundaries[point.end];
        return start === undefined || end === undefined ? undefined : { start, end };
      }
      offset += part.raw.length;
    }
    return undefined;
  };
  if (source.authoringKind === "schema") return [{
    message: "Hson.schema requires a substitution-free tagged template.",
    range: source.substitutionRanges[0]!, source: "Hson", code: "HSON_SCHEMA_INTERPOLATION_FORBIDDEN",
    precision: "exact", related: [],
  }];
  const quadDiagnostics: DocumentDiagnosticSpec[] = [];
  const names = new Map<string, AuthoredQuadDeclaration>();
  const collector: HsonSourceLexicalCollector = {
    recordToken(token) {
      if (token.kind !== "OPEN" || token.quad === undefined) return;
      try { register_document_quad_declaration(names, token.quad); }
      catch (error) { quadDiagnostics.push(diagnostic(error, literal, source.bodyRange, source.authoringKind, mapPreview)); }
    },
    recordAttribute() {},
  };
  // Retain observed declarations even if a later incomplete suffix stops scanning.
  // Slots remain opaque; only literal OPEN tokens can contribute names.
  if (preview.slots.length !== 0 || literalQuadsOnly) {
    try {
      const substitutions = site.expressions.map(() => "x");
      const tokens = source.authoringKind === "document"
        ? tokenize_authored_document_library(preview.source, collector, { slots: preview.slots, substitutions })
        : tokenize_hson(preview.source, 0, undefined, preview.slots, source.authoringKind, substitutions, source.authoringKind);
      reject_portable_quid_tokens(tokens);
    } catch (error) {
      if (literalQuadsOnly) return quadDiagnostics;
      const details = read_transform_error_details(error);
      // A malformed literal escape remains certain across opaque scalar slots.
      if (details !== undefined && (declarationFailures.has(details.code) || details.code === "invalid-json-escape") && details.source !== undefined
        && mapPreview(details.source.index) !== undefined) {
        return [...quadDiagnostics, diagnostic(error, literal, source.bodyRange, source.authoringKind, mapPreview)];
      }
      // Authored object/element mode crossings are knowable without evaluating
      // a substitution. Use the same scanner's contextual grammar observation.
      if (details?.code === "HSON_STRUCTURAL_MODE_CROSSING") {
        if (details.source && details.source.index < literal.raw.length) {
          return [...quadDiagnostics, diagnostic(error, literal, source.bodyRange, source.authoringKind)];
        }
        return [...quadDiagnostics, { message: error instanceof Error ? error.message : "Invalid Hson context.",
          range: source.bodyRange, source: "Hson", code: details.code, precision: "fallback", related: [] }];
      }
      if (details?.code === "HSON_INTERPOLATION_POSITION_INVALID") {
        const slot = preview.slots.find(item => item.offset === details.source?.index) ?? preview.slots[0]!;
        return [...quadDiagnostics, { message: error instanceof Error ? error.message : "Interpolation is not allowed here.",
          range: source.substitutionRanges[slot.substitution]!, source: "Hson", code: details.code, precision: "exact", related: [] }];
      }
    }
  }
  if (literalQuadsOnly) return quadDiagnostics;
  try {
    if (source.authoringKind === "document") tokenize_authored_document_library(literal.raw);
    else tokenize_hson(literal.raw);
  } catch (error) {
    const details = read_transform_error_details(error);
    if (!details) throw error;
    if (prefixFailures.has(details.code) && details.source && details.source.index < literal.raw.length - 1) {
      return [...quadDiagnostics, diagnostic(error, literal, literal.range)];
    }
  }
  return quadDiagnostics;
}
