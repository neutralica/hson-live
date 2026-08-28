import ts from "typescript";

import {
  source_point_range_at,
  type HostSourceRange,
} from "./embedded-hson-source.js";

export type StaticHsonBoundary = "transform" | "livemap" | "livetree";

export type RuntimeHostSpan = Readonly<{
  runtimeRange: HostSourceRange;
  hostRange: HostSourceRange;
}>;

/** Private editor evidence for one exact ordinary JavaScript string occurrence. */
export type StaticHsonSource = Readonly<{
  kind: "javascript-string";
  fileName: string;
  hostText: string;
  boundary: StaticHsonBoundary;
  callRange: HostSourceRange;
  calleeRange: HostSourceRange;
  /** Common occurrence aliases retained for private D2/D3 tooling consumers. */
  tagRange: HostSourceRange;
  templateRange: HostSourceRange;
  literalRange: HostSourceRange;
  bodyRange: HostSourceRange;
  runtimeText: string;
  spans: readonly RuntimeHostSpan[];
}>;

function range(start: number, end: number): HostSourceRange {
  return Object.freeze({ start, end });
}

type RawSegment = Readonly<{ start: number; end: number; runtimeLength: number }>;

/**
 * Segment only the correspondence-bearing syntax. TypeScript's literal `text`
 * remains the cooking authority; this scanner never supplies cooked content.
 */
function segmentRawBody(raw: string, template: boolean): readonly RawSegment[] | undefined {
  const segments: RawSegment[] = [];
  let offset = 0;
  while (offset < raw.length) {
    const start = offset;
    const code = raw.charCodeAt(offset);
    if (code === 0x5c) {
      offset += 1;
      if (offset >= raw.length) return undefined;
      const escaped = raw.charCodeAt(offset);
      if (escaped === 0x0d) {
        offset += raw.charCodeAt(offset + 1) === 0x0a ? 2 : 1;
        segments.push({ start, end: offset, runtimeLength: 0 });
        continue;
      }
      if (escaped === 0x0a) {
        offset += 1;
        segments.push({ start, end: offset, runtimeLength: 0 });
        continue;
      }
      if (escaped === 0x78) {
        offset += 3;
      } else if (escaped === 0x75 && raw.charCodeAt(offset + 1) === 0x7b) {
        const close = raw.indexOf("}", offset + 2);
        if (close < 0) return undefined;
        offset = close + 1;
      } else if (escaped === 0x75) {
        offset += 5;
      } else {
        offset += 1;
      }
      if (offset > raw.length) return undefined;
      const spelling = raw.slice(start, offset);
      let runtimeLength = 1;
      if (spelling.startsWith("\\u{")) {
        const value = Number.parseInt(spelling.slice(3, -1), 16);
        runtimeLength = value > 0xffff ? 2 : 1;
      }
      segments.push({ start, end: offset, runtimeLength });
      continue;
    }
    if (template && code === 0x0d) {
      offset += raw.charCodeAt(offset + 1) === 0x0a ? 2 : 1;
      segments.push({ start, end: offset, runtimeLength: 1 });
      continue;
    }
    const next = raw.charCodeAt(offset + 1);
    const scalarLength = code >= 0xd800 && code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff ? 2 : 1;
    offset += scalarLength;
    segments.push({ start, end: offset, runtimeLength: scalarLength });
  }
  return Object.freeze(segments);
}

export function create_static_hson_source(
  fileName: string,
  hostText: string,
  file: ts.SourceFile,
  call: ts.CallExpression,
  literal: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral,
  boundary: StaticHsonBoundary,
): StaticHsonSource | undefined {
  const literalStart = literal.getStart(file);
  const literalEnd = literal.end;
  const bodyStart = literalStart + 1;
  const bodyEnd = literalEnd - 1;
  if (bodyEnd < bodyStart) return undefined;
  const delimiter = hostText[literalStart];
  if ((delimiter !== "'" && delimiter !== '"' && delimiter !== "`") || hostText[literalEnd - 1] !== delimiter) return undefined;
  const raw = hostText.slice(bodyStart, bodyEnd);
  const rawSegments = segmentRawBody(raw, delimiter === "`");
  if (rawSegments === undefined) return undefined;
  const spans: RuntimeHostSpan[] = [];
  let runtimeOffset = 0;
  for (const segment of rawSegments) {
    if (segment.runtimeLength > 0) {
      spans.push(Object.freeze({
        runtimeRange: range(runtimeOffset, runtimeOffset + segment.runtimeLength),
        hostRange: range(bodyStart + segment.start, bodyStart + segment.end),
      }));
      runtimeOffset += segment.runtimeLength;
    }
  }
  // Refuse correspondence when TypeScript's authoritative cooked value and
  // the syntax-only span accounting disagree.
  if (runtimeOffset !== literal.text.length) return undefined;
  const calleeRange = range(call.expression.getStart(file), call.expression.end);
  const literalRange = range(literalStart, literalEnd);
  return Object.freeze({
    kind: "javascript-string",
    fileName,
    hostText,
    boundary,
    callRange: range(call.getStart(file), call.end),
    calleeRange,
    tagRange: calleeRange,
    templateRange: literalRange,
    literalRange,
    bodyRange: range(bodyStart, bodyEnd),
    runtimeText: literal.text,
    spans: Object.freeze(spans),
  });
}

/** Map one Unicode-safe runtime point through complete authored escape spans. */
export function map_static_hson_point(source: StaticHsonSource, index: number): HostSourceRange | undefined {
  const point = source_point_range_at(source.runtimeText, index);
  return point === undefined ? undefined : map_static_hson_range(source, point);
}

/** Map one half-open runtime range to the smallest truthful host range. */
export function map_static_hson_range(source: StaticHsonSource, runtimeRange: HostSourceRange): HostSourceRange | undefined {
  const { start, end } = runtimeRange;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > source.runtimeText.length) return undefined;
  if (start === end) {
    if (start === source.runtimeText.length) return range(source.bodyRange.end, source.bodyRange.end);
    const next = source.spans.find(span => span.runtimeRange.start <= start && start < span.runtimeRange.end);
    return next === undefined ? undefined : range(next.hostRange.start, next.hostRange.start);
  }
  const overlaps = source.spans.filter(span => span.runtimeRange.start < end && span.runtimeRange.end > start);
  const first = overlaps[0];
  const last = overlaps.at(-1);
  return first === undefined || last === undefined ? undefined : range(first.hostRange.start, last.hostRange.end);
}
