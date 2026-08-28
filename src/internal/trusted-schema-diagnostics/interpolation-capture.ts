import { HSON } from "../../hson-authoring.js";
import { encode_hson_template_substitution } from "../../api/transform/hson-admission.js";
import { read_transform_error_details, type TransformErrorDetails } from "../../core/errors.js";
import type { HsonCanonical } from "../../api/transform/transform.types.js";
import type { GeneratedSegment, InterpolationSite } from "./interpolation-source.js";

export type InterpolationCapture = Readonly<{
  evaluationId: string;
  site: InterpolationSite;
  source: string;
  segments: readonly GeneratedSegment[];
  canonical?: HsonCanonical;
  timings: Readonly<{ admissionMs: number; traceMs: number }>;
  failure?: Readonly<{ message: string; details?: TransformErrorDetails; substitution?: number }>;
}>;
const captures: InterpolationCapture[] = [];
const MAX_CAPTURES = 256;
const MAX_SOURCE = 1_000_000;
const MAX_TOTAL_SOURCE = 4_000_000;
let nextEvaluation = 0;
let overflow = false;
let totalSource = 0;
export function reset_interpolation_captures(): void { captures.length = 0; overflow = false; nextEvaluation = 0; totalSource = 0; }
export function read_interpolation_captures(): readonly InterpolationCapture[] { return overflow ? [] : captures.slice(); }

/** Calls the verified real tag once with the original arguments. Only afterwards
 * reuses its pure primitive encoder to record source; no expression, getter,
 * coercion, clone or second HSON parse is performed by capture. Unsupported
 * values are neither retained nor inspected. The original exception is rethrown.
 */
export function capture_interpolation(site: InterpolationSite, tag: typeof HSON,
  strings: TemplateStringsArray, values: readonly (string | number | boolean | null)[]): Readonly<{ canonical: HsonCanonical; capture?: InterpolationCapture }> {
  const evaluationId = `evaluation:${++nextEvaluation}`;
  let canonical: HsonCanonical | undefined;
  let cause: unknown, failed = false;
  const admissionStart = performance.now();
  try { canonical = tag(strings, ...values); } catch (error) { cause = error; failed = true; }
  const traceStart = performance.now();
  const admissionMs = traceStart - admissionStart;
  // Observation is best-effort and must never replace application behavior.
  let capture: InterpolationCapture | undefined;
  try {
    if (captures.length >= MAX_CAPTURES) overflow = true;
    else if (!overflow && strings.raw.length === site.literals.length && strings.raw.every((s, i) => s === site.literals[i]?.raw)) {
      let source = "";
      let substitution: number | undefined;
      const segments: GeneratedSegment[] = [];
      for (let i = 0; i < strings.raw.length; i++) {
        const start = source.length;
        source += strings.raw[i];
        segments.push({ kind: "literal", index: i, start, end: source.length });
        if (i < values.length) {
          let encoded: string;
          try { encoded = encode_hson_template_substitution(values[i], i); }
          catch { substitution = i; break; }
          const start = source.length;
          source += encoded;
          segments.push({ kind: "substitution", index: i, start, end: source.length, scalarKind: values[i] === null ? "null" : typeof values[i] });
        }
        if (source.length > MAX_SOURCE || totalSource + source.length > MAX_TOTAL_SOURCE) { overflow = true; break; }
      }
      if (!overflow) {
        capture = Object.freeze({ evaluationId, site, source, segments: Object.freeze(segments), canonical,
          timings: { admissionMs, traceMs: performance.now() - traceStart },
          failure: failed ? { message: cause instanceof Error ? cause.message : "HSON admission failed.", details: read_transform_error_details(cause), substitution } : undefined });
        captures.push(capture);
        totalSource += source.length;
      }
    }
  } catch { /* Evidence failure cannot change a tag return or throw. */ }
  if (failed) throw cause;
  return { canonical: canonical!, capture };
}
