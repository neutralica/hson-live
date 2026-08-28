import { createHash } from "node:crypto";
import type { InterpolatedEmbeddedHsonTemplate } from "../embedded-hson/discover-hson-tagged-templates.js";
import type { HostSourceRange } from "../embedded-hson/embedded-hson-source.js";

export type InterpolationSite = Readonly<{
  templateId: string;
  moduleUrl: string;
  sourceRevision: string;
  templateRange: HostSourceRange;
  literals: readonly Readonly<{ range: HostSourceRange; raw: string; boundaries: readonly number[] }>[];
  expressions: readonly HostSourceRange[];
}>;
export type GeneratedSegment = Readonly<{
  kind: "literal" | "substitution";
  index: number;
  start: number;
  end: number;
  scalarKind?: string;
}>;
export type HostOrigin = Readonly<{
  kind: "literal-exact" | "substitution-expression" | "anchor" | "composite" | "unresolved";
  range: HostSourceRange;
  scalarKind?: string;
}>;

export function interpolation_site(source: InterpolatedEmbeddedHsonTemplate, moduleUrl: string): InterpolationSite {
  const literals = [];
  let start = source.bodyRange.start;
  for (const hole of [...source.substitutionRanges, { start: source.bodyRange.end, end: source.bodyRange.end }]) {
    const range = { start, end: hole.start };
    let raw = "";
    const boundaries = [start];
    for (let i = start; i < hole.start;) {
      const char = source.hostText[i++];
      if (char === "\r" && source.hostText[i] === "\n") i++;
      raw += char === "\r" ? "\n" : char;
      boundaries.push(i);
    }
    literals.push({ range, raw, boundaries });
    start = hole.end;
  }
  return { moduleUrl, templateId: `${moduleUrl}#template:${source.templateRange.start}`,
    sourceRevision: createHash("sha256").update(source.hostText).digest("hex"),
    templateRange: source.templateRange, literals, expressions: source.expressionRanges };
}

/** Raw template bytes are preserved except ECMAScript physical newline normalization.
 * All offsets are UTF-16; expression origins are semantic, never character maps.
 */
export function map_interpolation_range(site: InterpolationSite, segments: readonly GeneratedSegment[],
  range: Readonly<{ precision: "exact" | "anchor" | "unresolved"; start?: number; end?: number }>): HostOrigin {
  const fallback: HostOrigin = { kind: "unresolved", range: site.templateRange };
  const { start, end } = range;
  if (range.precision === "unresolved" || start === undefined || end === undefined || !Number.isInteger(start)
    || !Number.isInteger(end) || start < 0 || end < start || end > (segments.at(-1)?.end ?? 0)) return fallback;
  // Nonempty intervals are half-open. EOF belongs to the final literal (even empty).
  const segment = start === end && start === segments.at(-1)?.end ? segments.at(-1)
    : segments.find(s => start >= s.start && end <= s.end && (start < s.end || end > start));
  if (segment === undefined) {
    const origins = segments.filter(s => s.start < end && s.end > start).map(s => {
      if (s.kind === "substitution") return site.expressions[s.index];
      const literal = site.literals[s.index];
      const a = literal?.boundaries[Math.max(start, s.start) - s.start];
      const b = literal?.boundaries[Math.min(end, s.end) - s.start];
      return a === undefined || b === undefined ? undefined : { start: a, end: b };
    }).filter(s => s !== undefined);
    return origins.length === 0 ? fallback : { kind: "composite", range: { start: Math.min(...origins.map(s => s.start)), end: Math.max(...origins.map(s => s.end)) } };
  }
  if (segment.kind === "substitution") return { kind: "substitution-expression", range: site.expressions[segment.index] ?? site.templateRange, scalarKind: segment.scalarKind };
  const literal = site.literals[segment.index];
  const a = literal?.boundaries[start - segment.start], b = literal?.boundaries[end - segment.start];
  return a === undefined || b === undefined ? fallback : { kind: range.precision === "anchor" ? "anchor" : "literal-exact", range: { start: a, end: b } };
}
