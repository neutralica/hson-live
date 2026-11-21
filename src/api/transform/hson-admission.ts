import { parse_hson } from "./parsers/parse-hson.js";
import { scan_hson_template_segments, type HsonTemplateSlot } from "./parsers/tokenize-hson.js";
import { serialize_hson } from "./serializers/serialize-hson.js";
import type { HsonCanonical } from "./transform.types.js";
import { detach_hson_root_value } from "./utils/node-utils/detach-hson-root-value.js";
import { _throw_transform_err } from "./utils/sys-utils/throw-transform-err.utils.js";

type HsonTemplatePrimitive = string | number | boolean | null;

export const HSON_TAGGED_TEMPLATE_REQUIRED = "HSON_TAGGED_TEMPLATE_REQUIRED" as const;

/** Private neutral source admission shared with editor Schema diagnostics. */
export function admit_hson_source(source: string): HsonCanonical {
  return serialize_hson(detach_hson_root_value(parse_hson(source)));
}

function readTemplateRawSegments(value: unknown, count: number): string[] | undefined {
  try {
    if (!Array.isArray(value) || !Object.isFrozen(value) || value.length !== count) return undefined;
    const raw: unknown = Object.getOwnPropertyDescriptor(value, "raw")?.value;
    if (!Array.isArray(raw) || !Object.isFrozen(raw) || raw.length !== count) return undefined;

    const segments: string[] = [];
    for (let i = 0; i < count; i++) {
      const cooked: unknown = Object.getOwnPropertyDescriptor(value, i)?.value;
      const segment: unknown = Object.getOwnPropertyDescriptor(raw, i)?.value;
      if (typeof cooked !== "string" || typeof segment !== "string") return undefined;
      segments.push(segment);
    }
    return segments;
  } catch {
    // Reflection on a caller-supplied Proxy can throw during admission.
    return undefined;
  }
}

/** Validate raw template input and preserve every semantic slot boundary. */
export function reconstruct_hson_interpolated_template(
  strings: TemplateStringsArray,
  substitutions: readonly (HsonTemplatePrimitive | undefined)[],
): Readonly<{ source: string; slots: readonly HsonTemplateSlot[] }> {
  const raw = readTemplateRawSegments(strings, substitutions.length + 1);
  if (raw === undefined) {
    _throw_transform_err("invalid Hson tagged template", "Hson", undefined, undefined,
      { code: HSON_TAGGED_TEMPLATE_REQUIRED, stage: "template-admission" });
  }
  return scan_hson_template_segments(raw, substitutions);
}

/** Substitution-free admission retained for Schema and literal editor diagnostics. */
export function admit_hson(strings: TemplateStringsArray): HsonCanonical {
  return admit_hson_source(reconstruct_hson_interpolated_template(strings, []).source);
}
