import type { DiscoveredSchemaValidation } from "../../../src/internal/trusted-schema-diagnostics/discover-validation-sources.js";
import type { InterpolationCapture } from "../../../src/internal/trusted-schema-diagnostics/interpolation-capture.js";
import { is_static_hson_source, read_authored_hson_source } from "../../../src/internal/embedded-hson/authored-hson-source.js";
import { map_interpolation_range, type GeneratedSegment } from "../../../src/internal/trusted-schema-diagnostics/interpolation-source.js";

/** Source mapping only. Unknown substitutions are opaque scalar slots, not values. */
export function completion_source(association: DiscoveredSchemaValidation, offset: number, capture?: InterpolationCapture) {
  if (is_static_hson_source(association.source)) return undefined;
  const site = association.interpolation;
  if (site === undefined) {
    const body = association.source.bodyRange;
    if (offset < body.start || offset > body.end) return undefined;
    return { source: read_authored_hson_source(association.source), cursor: offset - body.start, unknownRanges: [],
      map: (range: Readonly<{ start: number; end: number }>) => ({ start: body.start + range.start, end: body.start + range.end }) };
  }
  const literalIndex = site.literals.findIndex(l => offset >= l.range.start && offset <= l.range.end);
  if (literalIndex < 0) return undefined; // Includes ${ delimiters and the expression.
  let source = "";
  const segments: GeneratedSegment[] = [];
  const unknownRanges: { start: number; end: number }[] = [];
  if (capture === undefined) for (let i = 0; i < site.literals.length; i++) {
    const start = source.length;
    source += site.literals[i].raw;
    segments.push({ kind: "literal", index: i, start, end: source.length });
    if (i < site.expressions.length) {
      const start = source.length;
      source += "null";
      unknownRanges.push({ start, end: source.length });
      segments.push({ kind: "substitution", index: i, start, end: source.length });
    }
  }
  const activeSegments = capture?.segments ?? segments;
  const segment = activeSegments.find(s => s.kind === "literal" && s.index === literalIndex);
  const local = site.literals[literalIndex].boundaries.indexOf(offset);
  if (segment === undefined || local < 0) return undefined;
  return { source: capture?.source ?? source, cursor: segment.start + local, unknownRanges,
    map: (range: Readonly<{ start: number; end: number }>) => {
      const origin = map_interpolation_range(site, activeSegments, { ...range, precision: "exact" });
      return origin.kind === "literal-exact" ? origin.range : undefined;
    } };
}
