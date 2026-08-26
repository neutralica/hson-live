import { hsonString } from "../../../src/api/transform/hson-string.js";
import {
  read_transform_error_details,
  type TransformErrorDetails,
  type TransformErrorSource,
} from "../../../src/core/errors.js";
import { discover_hson_tagged_templates } from "../../../src/internal/embedded-hson/discover-hson-tagged-templates.js";
import {
  read_embedded_hson_body,
  source_point_range_at,
  type HostSourceRange,
} from "../../../src/internal/embedded-hson/embedded-hson-source.js";
import { map_transform_error_to_embedded_source } from "../../../src/internal/embedded-hson/map-transform-error.js";

export const DIAGNOSTIC_SOURCE = "HSON";
export const SUBSTITUTION_DIAGNOSTIC_CODE = "HSON_TEMPLATE_SUBSTITUTION_UNSUPPORTED";
export const SUBSTITUTION_DIAGNOSTIC_MESSAGE =
  "HSON tagged templates do not currently support substitutions.";

export type SupportedLanguageId = "hson" | "typescript" | "typescriptreact";

export type DocumentDiagnosticInput = Readonly<{
  languageId: string;
  fileName: string;
  text: string;
}>;

export type RelatedDiagnosticSpec = Readonly<{
  message: string;
  range: HostSourceRange;
}>;

export type DocumentDiagnosticSpec = Readonly<{
  message: string;
  range: HostSourceRange;
  source: typeof DIAGNOSTIC_SOURCE;
  code?: string;
  precision: "point" | "eof" | "fallback" | "substitution";
  related: readonly RelatedDiagnosticSpec[];
}>;

function isTypeScriptInput(input: DocumentDiagnosticInput): boolean {
  return input.languageId === "typescript" && /\.ts$/.test(input.fileName);
}

function isTypeScriptReactInput(input: DocumentDiagnosticInput): boolean {
  return input.languageId === "typescriptreact" && /\.tsx$/.test(input.fileName);
}

export function is_supported_document(input: DocumentDiagnosticInput): boolean {
  return input.languageId === "hson"
    || isTypeScriptInput(input)
    || isTypeScriptReactInput(input);
}

function fallbackRange(text: string): HostSourceRange {
  return Object.freeze({ start: 0, end: text.length });
}

function mapStandaloneSource(
  text: string,
  source: TransformErrorSource,
): HostSourceRange | undefined {
  return source_point_range_at(text, source.index);
}

function relatedFromDetails(
  text: string,
  details: TransformErrorDetails,
): readonly RelatedDiagnosticSpec[] {
  return Object.freeze((details.related ?? []).flatMap((item) => {
    const range = mapStandaloneSource(text, item.source);
    return range === undefined
      ? []
      : [Object.freeze({
          message: `Related HSON source (${item.role}).`,
          range,
        })];
  }));
}

export function transform_error_to_standalone_diagnostic(
  error: unknown,
  text: string,
): DocumentDiagnosticSpec | undefined {
  const details = read_transform_error_details(error);
  if (details === undefined) return undefined;
  const exactRange = details.source === undefined
    ? undefined
    : mapStandaloneSource(text, details.source);
  const range = exactRange ?? fallbackRange(text);
  const precision = exactRange === undefined
    ? "fallback"
    : details.source?.index === text.length ? "eof" : "point";
  return Object.freeze({
    message: error instanceof Error ? error.message : "HSON validation failed.",
    range,
    source: DIAGNOSTIC_SOURCE,
    code: details.code,
    precision,
    related: relatedFromDetails(text, details),
  });
}

function validateStandalone(text: string): readonly DocumentDiagnosticSpec[] {
  try {
    hsonString(text);
    return Object.freeze([]);
  } catch (error) {
    const diagnostic = transform_error_to_standalone_diagnostic(error, text);
    if (diagnostic === undefined) throw error;
    return Object.freeze([diagnostic]);
  }
}

function validateEmbedded(input: DocumentDiagnosticInput): readonly DocumentDiagnosticSpec[] {
  const discovery = discover_hson_tagged_templates(input.fileName, input.text);
  const diagnostics: DocumentDiagnosticSpec[] = [];
  for (const source of discovery.sources) {
    try {
      hsonString(read_embedded_hson_body(source));
    } catch (error) {
      const details = read_transform_error_details(error);
      if (details === undefined) throw error;
      const mapping = map_transform_error_to_embedded_source(error, source);
      if (mapping.status === "invalid-descriptor") {
        throw new Error(`Invalid embedded HSON descriptor: ${mapping.reason}`);
      }
      const related = Object.freeze(mapping.related.flatMap((item) => {
        if (item.mapping.status !== "mapped") return [];
        return [Object.freeze({
          message: `Related HSON source (${item.role}).`,
          range: item.mapping.range,
        })];
      }));
      diagnostics.push(Object.freeze({
        message: error instanceof Error ? error.message : "HSON validation failed.",
        range: mapping.range,
        source: DIAGNOSTIC_SOURCE,
        code: details.code,
        precision: mapping.status === "fallback" ? "fallback" : mapping.precision,
        related,
      }));
    }
  }
  for (const unsupported of discovery.unsupported) {
    for (const range of unsupported.substitutionRanges) {
      diagnostics.push(Object.freeze({
        message: SUBSTITUTION_DIAGNOSTIC_MESSAGE,
        range,
        source: DIAGNOSTIC_SOURCE,
        code: SUBSTITUTION_DIAGNOSTIC_CODE,
        precision: "substitution",
        related: Object.freeze([]),
      }));
    }
  }
  return Object.freeze(diagnostics);
}

export function produce_document_diagnostics(
  input: DocumentDiagnosticInput,
): readonly DocumentDiagnosticSpec[] {
  if (!is_supported_document(input)) return Object.freeze([]);
  return input.languageId === "hson"
    ? validateStandalone(input.text)
    : validateEmbedded(input);
}
