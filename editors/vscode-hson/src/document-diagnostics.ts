import { hson } from "../../../src/hson.js";
import { parse_hson } from "../../../src/api/transform/parsers/parse-hson.js";
import {
  read_transform_error_details,
  type TransformErrorDetails,
  type TransformErrorSource,
} from "../../../src/core/errors.js";
import { discover_hson_tagged_templates } from "../../../src/internal/embedded-hson/discover-hson-tagged-templates.js";
import {
  source_point_range_at,
  type HostSourceRange,
} from "../../../src/internal/embedded-hson/embedded-hson-source.js";
import { diagnose_hson_tag, diagnose_hson_prefix } from "./tag-admission.js";
import { discover_static_from_hson_sources } from "../../../src/internal/embedded-hson/discover-static-from-hson-sources.js";
import {
  map_static_hson_point,
  type StaticHsonSource,
} from "../../../src/internal/embedded-hson/static-hson-source.js";

export const DIAGNOSTIC_SOURCE = "HSON";
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
  runtimeAdmission?: boolean;
  hostOrigin?: import("../../../src/internal/trusted-schema-diagnostics/interpolation-source.js").HostOrigin["kind"];
  message: string;
  range: HostSourceRange;
  source: typeof DIAGNOSTIC_SOURCE;
  code?: string;
  precision: "point" | "eof" | "fallback" | "exact" | "anchor" | "unresolved" | "substitution-expression";
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
    hson.fromHson(text).toNode();
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
    diagnostics.push(...diagnose_hson_tag(source));
  }
  for (const source of discovery.interpolated) diagnostics.push(...diagnose_hson_prefix(source));
  const staticSources = discover_static_from_hson_sources(input.fileName, input.text).sources;
  for (const source of staticSources) {
    try {
      // Boundary identity selects the parser contract. LiveMap alone admits a
      // top-level text/document fragment; Transform and LiveTree use the
      // ordinary parser-root contract.
      parse_hson(source.runtimeText, source.boundary === "livemap" ? { allowTopLevelTextFragment: true } : {});
    } catch (error) {
      const details = read_transform_error_details(error);
      if (details === undefined) throw error;
      diagnostics.push(staticTransformDiagnostic(error, details, source));
    }
  }
  // Runtime substitution values are intentionally opaque to the editor. The
  // discovery result records interpolated templates, but only substitution-free
  // templates can receive authoritative whole-source parsing here.
  return Object.freeze(diagnostics);
}

function staticTransformDiagnostic(
  error: unknown,
  details: TransformErrorDetails,
  source: StaticHsonSource,
): DocumentDiagnosticSpec {
  const primary = details.source === undefined ? undefined : map_static_hson_point(source, details.source.index);
  const related = Object.freeze((details.related ?? []).flatMap(item => {
    const mapped = map_static_hson_point(source, item.source.index);
    return mapped === undefined ? [] : [Object.freeze({ message: `Related HSON source (${item.role}).`, range: mapped })];
  }));
  return Object.freeze({
    message: error instanceof Error ? error.message : "HSON validation failed.",
    range: primary ?? source.bodyRange,
    source: DIAGNOSTIC_SOURCE,
    code: details.code,
    precision: primary === undefined ? "fallback" : details.source?.index === source.runtimeText.length ? "eof" : "point",
    related,
  });
}

export function produce_document_diagnostics(
  input: DocumentDiagnosticInput,
): readonly DocumentDiagnosticSpec[] {
  if (!is_supported_document(input)) return Object.freeze([]);
  return input.languageId === "hson"
    ? validateStandalone(input.text)
    : validateEmbedded(input);
}
