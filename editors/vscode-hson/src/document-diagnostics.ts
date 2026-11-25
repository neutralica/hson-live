import type ts from "typescript";
import * as messages from "./diagnostic-messages.js";
import { is_workspace_typescript_source } from "./typescript-project-discovery.js";
import { hson } from "../../../src/hson.js";
import { parse_hson } from "../../../src/api/transform/parsers/parse-hson.js";
import { qualify_authored_document_source } from "../../../src/api/document/hson-authored.js";
import { parse_authored_document_library } from "../../../src/api/livemap/livemap.document.quad.js";
import { admit_canonical_hson_data_value } from "../../../src/api/data/hson-data-hson.js";
import type { StandaloneAuthoringMode } from './authoring-mode.js';
import {
  read_transform_error_details,
  type TransformErrorDetails,
  type TransformErrorSource,
} from "../../../src/core/errors.js";
import { create_hson_source_program, discover_hson_tagged_templates } from "../../../src/internal/embedded-hson/discover-hson-tagged-templates.js";
import {
  source_point_range_at,
  type HostSourceRange,
} from "../../../src/internal/embedded-hson/embedded-hson-source.js";
import type { EventBodyCache, ReuseEventBody } from "./event-body-cache.js";
import { diagnose_hson_tag, diagnose_hson_prefix } from "./tag-admission.js";
import { static_interpolation_diagnostics } from "./static-interpolation-diagnostics.js";
import { discover_static_from_hson_sources } from "../../../src/internal/embedded-hson/discover-static-from-hson-sources.js";
import { apply_hson_diagnostic_expectations, HSON_EXPECT_ERROR_MARKER, type ExpectationRegion } from "./diagnostic-expectations.js";
import {
  map_static_hson_point,
  type StaticHsonSource,
} from "../../../src/internal/embedded-hson/static-hson-source.js";

export const DIAGNOSTIC_SOURCE = "Hson";
const DIAGNOSTICS_IGNORE_FILE_DIRECTIVE = "@hson-diagnostics-ignore-file";
export type SupportedLanguageId = "hson" | "typescript" | "typescriptreact";

export type DocumentDiagnosticInput = Readonly<{
  languageId: string;
  fileName: string;
  text: string;
  authoringMode?: StandaloneAuthoringMode;
  sourceProgram?: ts.Program;
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
  return input.languageId === "typescript" && is_workspace_typescript_source(input.fileName) && !/\.tsx$/i.test(input.fileName);
}

function isTypeScriptReactInput(input: DocumentDiagnosticInput): boolean {
  return input.languageId === "typescriptreact" && is_workspace_typescript_source(input.fileName) && /\.tsx$/i.test(input.fileName);
}

export function is_supported_document(input: DocumentDiagnosticInput): boolean {
  return input.languageId === "hson"
    || isTypeScriptInput(input)
    || isTypeScriptReactInput(input);
}

function hasDiagnosticsIgnoreFileDirective(input: DocumentDiagnosticInput): boolean {
  let cursor = 0;
  while (cursor < input.text.length) {
    const character = input.text[cursor];
    if (character === " " || character === "\t" || character === "\r" || character === "\n") {
      cursor += 1;
      continue;
    }
    if (input.text.startsWith("//", cursor)) {
      const end = input.text.indexOf("\n", cursor + 2);
      const commentEnd = end === -1 ? input.text.length : end;
      if (input.text.slice(cursor + 2, commentEnd).trim() === DIAGNOSTICS_IGNORE_FILE_DIRECTIVE) return true;
      cursor = commentEnd;
      continue;
    }
    if (input.languageId !== "hson" && input.text.startsWith("/*", cursor)) {
      const end = input.text.indexOf("*/", cursor + 2);
      if (end === -1) return false;
      cursor = end + 2;
      continue;
    }
    return false;
  }
  return false;
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
          message: messages.hsonSourceRelated(item.role),
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
    message: error instanceof Error ? error.message : messages.hsonValidationFailed,
    range,
    source: DIAGNOSTIC_SOURCE,
    code: details.code,
    precision,
    related: relatedFromDetails(text, details),
  });
}

function validateStandalone(text: string, mode: StandaloneAuthoringMode = 'canonical'): readonly DocumentDiagnosticSpec[] {
  try {
    if (mode === 'document') {
      // Same admission and declaration checks as Hson.document. This never
      // qualifies the source as canonical Transform input or issues identities.
      parse_authored_document_library(text);
      qualify_authored_document_source(text, new Map());
    } else if (mode === 'data') {
      parse_hson(text); // Retain canonical lexical/identity diagnostics before family qualification.
      admit_canonical_hson_data_value(text);
    }
    else hson.fromHson(text).toNode();
    return Object.freeze([]);
  } catch (error) {
    const diagnostic = transform_error_to_standalone_diagnostic(error, text);
    if (diagnostic === undefined) {
      if (mode === 'canonical' || !(error instanceof TypeError || error instanceof SyntaxError)) throw error;
      return [{message:error.message,range:fallbackRange(text),source:DIAGNOSTIC_SOURCE,precision:'fallback',related:[]}];
    }
    return Object.freeze([diagnostic]);
  }
}

// Cache only literal-relative diagnostics, including secondary source ranges.
function move_diagnostic(spec: DocumentDiagnosticSpec, offset: number): DocumentDiagnosticSpec {
  const move = ({ start, end }: HostSourceRange) => ({ start: start + offset, end: end + offset });
  return { ...spec, range: move(spec.range), related: spec.related.map(item => ({ ...item, range: move(item.range) })) };
}

function validateEmbedded(input: DocumentDiagnosticInput, ignoreDiagnostics: boolean,
  reuseEvent?: ReuseEventBody<readonly DocumentDiagnosticSpec[]>,
): readonly DocumentDiagnosticSpec[] {
  // Share the discovery program's parsed host with the expectation processor.
  // No extra expectation parse is needed, and marker-free production is unchanged.
  const program = input.sourceProgram ?? (input.text.includes(HSON_EXPECT_ERROR_MARKER)
    ? create_hson_source_program(input.fileName, input.text) : undefined);
  const diagnostics: DocumentDiagnosticSpec[] = [];
  const discovery = discover_hson_tagged_templates(input.fileName, input.text, program,
    ignoreDiagnostics ? undefined : source => { diagnostics.push(...diagnose_hson_prefix(source, true)); });
  const withIntent = (source: { authoringKind?: string; eventValueImport?: true }) =>
    source.authoringKind !== "event" || source.eventValueImport === true;
  if (!ignoreDiagnostics) {
    for (const source of discovery.sources.filter(withIntent)) {
      if (source.authoringKind !== "event" || reuseEvent === undefined) {
        diagnostics.push(...diagnose_hson_tag(source));
        continue;
      }
      const { start, end } = source.bodyRange;
      const body = input.text.slice(start, end);
      const relative = reuseEvent(body, () => diagnose_hson_tag(source).map(spec => move_diagnostic(spec, -start)));
      diagnostics.push(...relative.map(spec => move_diagnostic(spec, start)));
    }
    for (const source of discovery.interpolated.filter(withIntent)) diagnostics.push(...diagnose_hson_prefix(source));
    for (const source of discovery.incompleteEvents.filter(withIntent)) {
      // An unfinished body can change meaning. A JavaScript hole already violates the tag contract.
      if ("substitutionRanges" in source && source.substitutionRanges.length > 0) diagnostics.push(...diagnose_hson_prefix(source));
    }
    diagnostics.push(...static_interpolation_diagnostics(input.fileName, input.text, discovery));
  }
  const staticSources = discover_static_from_hson_sources(input.fileName, input.text, program).sources;
  for (const source of ignoreDiagnostics ? [] : staticSources) {
    try {
      parse_hson(source.runtimeText);
    } catch (error) {
      const details = read_transform_error_details(error);
      if (details === undefined) throw error;
      diagnostics.push(staticTransformDiagnostic(error, details, source));
    }
  }
  // Runtime substitution values are intentionally opaque to the editor. The
  // discovery result records interpolated templates, but only substitution-free
  // templates can receive authoritative whole-source parsing here.
  const ordinary = Object.freeze(diagnostics);
  const file = program?.getSourceFile(input.fileName);
  if (file === undefined) return ordinary;
  const regions: ExpectationRegion[] = [
    ...[...discovery.sources, ...discovery.interpolated].filter(withIntent).map((source): ExpectationRegion => ({
      kind: "template", range: { start: source.tagRange.start, end: source.templateRange.end },
    })),
    ...staticSources.map((source): ExpectationRegion => ({ kind: "static-source", range: source.callRange })),
  ];
  return apply_hson_diagnostic_expectations(file, regions, ordinary);
}

function staticTransformDiagnostic(
  error: unknown,
  details: TransformErrorDetails,
  source: StaticHsonSource,
): DocumentDiagnosticSpec {
  const primary = details.source === undefined ? undefined : map_static_hson_point(source, details.source.index);
  const related = Object.freeze((details.related ?? []).flatMap(item => {
    const mapped = map_static_hson_point(source, item.source.index);
    return mapped === undefined ? [] : [Object.freeze({ message: messages.hsonSourceRelated(item.role), range: mapped })];
  }));
  return Object.freeze({
    message: error instanceof Error ? error.message : messages.hsonValidationFailed,
    range: primary ?? source.bodyRange,
    source: DIAGNOSTIC_SOURCE,
    code: details.code,
    precision: primary === undefined ? "fallback" : details.source?.index === source.runtimeText.length ? "eof" : "point",
    related,
  });
}

export function produce_document_diagnostics(
  input: DocumentDiagnosticInput, eventBodies?: EventBodyCache<readonly DocumentDiagnosticSpec[]>,
): readonly DocumentDiagnosticSpec[] {
  if (!is_supported_document(input)) return Object.freeze([]);
  const ignoreDiagnostics = hasDiagnosticsIgnoreFileDirective(input);
  if (input.languageId === "hson") return ignoreDiagnostics ? [] : validateStandalone(input.text, input.authoringMode);
  const validate = (reuse?: ReuseEventBody<readonly DocumentDiagnosticSpec[]>) =>
    ignoreDiagnostics && !input.text.includes(HSON_EXPECT_ERROR_MARKER) ? [] : validateEmbedded(input, ignoreDiagnostics, reuse);
  return eventBodies === undefined ? validate() : eventBodies.scan(validate);
}
