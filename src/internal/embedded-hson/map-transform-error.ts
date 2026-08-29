import {
  read_transform_error_details,
  type TransformErrorSource,
} from "../../core/errors.js";
import {
  create_host_source_locator,
  read_embedded_hson_body,
  source_point_range_at,
  validate_embedded_hson_source,
  type EmbeddedHsonSourceInvalidReason,
  type HostSourcePosition,
  type HostSourceRange,
} from "./embedded-hson-source.js";

export type EmbeddedDiagnosticWarning =
  | "source-line-column-invalid"
  | "source-line-column-mismatch";

export type EmbeddedDiagnosticPointFailureReason = "source-index-invalid";

export type EmbeddedDiagnosticPointMapping =
  | Readonly<{
      status: "mapped";
      precision: "point" | "eof";
      range: HostSourceRange;
      start: HostSourcePosition;
      end: HostSourcePosition;
      warnings: readonly EmbeddedDiagnosticWarning[];
    }>
  | Readonly<{
      status: "unmapped";
      reason: EmbeddedDiagnosticPointFailureReason;
      warnings: readonly EmbeddedDiagnosticWarning[];
    }>;

export type EmbeddedRelatedDiagnosticMapping = Readonly<{
  role: string;
  mapping: EmbeddedDiagnosticPointMapping;
}>;

export type EmbeddedDiagnosticFallbackReason =
  | "source-missing"
  | "source-index-invalid"
  | "transform-error-details-missing";

export type EmbeddedDiagnosticMapping =
  | Readonly<{
      status: "mapped";
      precision: "point" | "eof";
      range: HostSourceRange;
      start: HostSourcePosition;
      end: HostSourcePosition;
      warnings: readonly EmbeddedDiagnosticWarning[];
      related: readonly EmbeddedRelatedDiagnosticMapping[];
    }>
  | Readonly<{
      status: "fallback";
      precision: "body";
      reason: EmbeddedDiagnosticFallbackReason;
      range: HostSourceRange;
      start: HostSourcePosition;
      end: HostSourcePosition;
      warnings: readonly EmbeddedDiagnosticWarning[];
      related: readonly EmbeddedRelatedDiagnosticMapping[];
    }>
  | Readonly<{
      status: "invalid-descriptor";
      reason: EmbeddedHsonSourceInvalidReason;
      warnings: readonly EmbeddedDiagnosticWarning[];
      related: readonly EmbeddedRelatedDiagnosticMapping[];
    }>;

function isValidCoordinate(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value >= 1;
}

function sourceWarnings(
  source: TransformErrorSource,
  sourcePositionAt: (offset: number) => HostSourcePosition | undefined,
): readonly EmbeddedDiagnosticWarning[] {
  if (!isValidCoordinate(source.line) || !isValidCoordinate(source.column)) {
    return Object.freeze(["source-line-column-invalid"]);
  }
  const actual = sourcePositionAt(source.index);
  if (actual !== undefined
    && (actual.line !== source.line || actual.column !== source.column)) {
    return Object.freeze(["source-line-column-mismatch"]);
  }
  return Object.freeze([]);
}

function mapPoint(
  sourceText: string,
  bodyStart: number,
  source: TransformErrorSource,
  hostPositionAt: (offset: number) => HostSourcePosition | undefined,
  sourcePositionAt: (offset: number) => HostSourcePosition | undefined,
): EmbeddedDiagnosticPointMapping {
  const warnings = Number.isFinite(source.index)
    && Number.isInteger(source.index)
    && source.index >= 0
    && source.index <= sourceText.length
    ? sourceWarnings(source, sourcePositionAt)
    : Object.freeze([]);
  if (!Number.isFinite(source.index)
    || !Number.isInteger(source.index)
    || source.index < 0
    || source.index > sourceText.length) {
    return Object.freeze({ status: "unmapped", reason: "source-index-invalid", warnings });
  }

  const relativeRange = source_point_range_at(sourceText, source.index);
  if (relativeRange === undefined) {
    return Object.freeze({ status: "unmapped", reason: "source-index-invalid", warnings });
  }
  const range = Object.freeze({
    start: bodyStart + relativeRange.start,
    end: bodyStart + relativeRange.end,
  });
  const start = hostPositionAt(range.start);
  const end = hostPositionAt(range.end);
  if (start === undefined || end === undefined) {
    return Object.freeze({ status: "unmapped", reason: "source-index-invalid", warnings });
  }
  return Object.freeze({
    status: "mapped",
    precision: source.index === sourceText.length ? "eof" : "point",
    range,
    start,
    end,
    warnings,
  });
}

/** Map authoritative Hson-relative TransformError evidence into original host source. */
export function map_transform_error_to_embedded_source(
  error: unknown,
  descriptor: unknown,
): EmbeddedDiagnosticMapping {
  const validated = validate_embedded_hson_source(descriptor);
  if (validated.status === "invalid") {
    return Object.freeze({
      status: "invalid-descriptor",
      reason: validated.reason,
      warnings: Object.freeze([]),
      related: Object.freeze([]),
    });
  }

  const embedded = validated.source;
  const sourceText = read_embedded_hson_body(embedded);
  const hostLocator = create_host_source_locator(embedded.hostText);
  const sourceLocator = create_host_source_locator(sourceText);
  if (hostLocator === undefined || sourceLocator === undefined) {
    return Object.freeze({
      status: "invalid-descriptor",
      reason: "host-text-invalid",
      warnings: Object.freeze([]),
      related: Object.freeze([]),
    });
  }
  const positionAt = (offset: number): HostSourcePosition | undefined =>
    hostLocator.positionAt(offset);
  const sourcePositionAt = (offset: number): HostSourcePosition | undefined =>
    sourceLocator.positionAt(offset);
  const bodyStart = positionAt(embedded.bodyRange.start);
  const bodyEnd = positionAt(embedded.bodyRange.end);
  if (bodyStart === undefined || bodyEnd === undefined) {
    return Object.freeze({
      status: "invalid-descriptor",
      reason: "body-range-invalid",
      warnings: Object.freeze([]),
      related: Object.freeze([]),
    });
  }

  const details = read_transform_error_details(error);
  const related = Object.freeze((details?.related ?? []).map((item) => Object.freeze({
    role: item.role,
    mapping: mapPoint(
      sourceText,
      embedded.bodyRange.start,
      item.source,
      positionAt,
      sourcePositionAt,
    ),
  })));
  const source = details?.source;
  if (source === undefined) {
    return Object.freeze({
      status: "fallback",
      precision: "body",
      reason: details === undefined ? "transform-error-details-missing" : "source-missing",
      range: embedded.bodyRange,
      start: bodyStart,
      end: bodyEnd,
      warnings: Object.freeze([]),
      related,
    });
  }

  const primary = mapPoint(
    sourceText,
    embedded.bodyRange.start,
    source,
    positionAt,
    sourcePositionAt,
  );
  if (primary.status === "unmapped") {
    return Object.freeze({
      status: "fallback",
      precision: "body",
      reason: primary.reason,
      range: embedded.bodyRange,
      start: bodyStart,
      end: bodyEnd,
      warnings: primary.warnings,
      related,
    });
  }
  return Object.freeze({ ...primary, related });
}
