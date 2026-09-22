import type { Primitive } from "../../core/types.js";
import { admit_hson_number } from "../../core/hson-number.js";
import { parse_hson } from "./parsers/parse-hson.js";
import { scan_hson_template_segments, type HsonTemplateSlot } from "./parsers/tokenize-hson.js";
import { serialize_hson } from "./serializers/serialize-hson.js";
import type { HsonCanonical } from "./transform.types.js";
import { detach_hson_root_value } from "./utils/node-utils/detach-hson-root-value.js";
import { serialize_primitive_hson } from "./utils/primitive-utils/serialize-primitive.utils.js";
import { _throw_transform_err } from "./utils/sys-utils/throw-transform-err.utils.js";

type HsonTemplatePrimitive = string | number | boolean | null;

export const HSON_TAGGED_TEMPLATE_REQUIRED = "HSON_TAGGED_TEMPLATE_REQUIRED" as const;
const HSON_TEMPLATE_SUBSTITUTION_TYPE_REQUIRED =
  "HSON_TEMPLATE_SUBSTITUTION_TYPE_REQUIRED";

/** Private neutral source admission shared with editor Schema diagnostics. */
export function admit_hson_source(source: string): HsonCanonical {
  return serialize_hson(detach_hson_root_value(parse_hson(source)));
}

function encodeTemplatePrimitive(value: HsonTemplatePrimitive): string {
  if (typeof value === "number") {
    // Numeric policy belongs to admit_hson_number; the shared scalar serializer owns
    // canonical source spelling, including preservation of negative zero.
    return serialize_primitive_hson(admit_hson_number(value));
  }
  return serialize_primitive_hson(value as Primitive);
}

/** Private shared admission operation; not a package export. */
export function encode_hson_template_substitution(value: unknown, index: number): string {
  if (value !== null && typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    _throw_transform_err(
      `Hson tagged-template substitutions must be primitive string, number, boolean, or null values; substitution ${index + 1} received ${typeof value}`,
      "Hson", undefined, undefined,
      { code: HSON_TEMPLATE_SUBSTITUTION_TYPE_REQUIRED, stage: "template-admission" },
    );
  }
  return encodeTemplatePrimitive(value);
}

function isTemplateStringsArray(value: unknown): value is TemplateStringsArray {
  if (!Array.isArray(value)) return false;
  const raw = (value as unknown as { raw?: unknown }).raw;
  return Array.isArray(raw)
    && Object.isFrozen(value)
    && Object.isFrozen(raw)
    && value.length === raw.length
    && value.every((segment) => typeof segment === "string")
    && raw.every((segment) => typeof segment === "string");
}

export function reconstruct_hson_template_source(
  strings: TemplateStringsArray,
  substitutions: readonly HsonTemplatePrimitive[],
): string {
  if (!isTemplateStringsArray(strings)) {
    _throw_transform_err(
      "Hson authoring requires a tagged template.", "Hson", undefined, undefined,
      { code: HSON_TAGGED_TEMPLATE_REQUIRED, stage: "template-admission" },
    );
  }
  if (strings.raw.length !== substitutions.length + 1) {
    _throw_transform_err(
      "invalid Hson tagged-template segment/substitution arity",
      "Hson",
      undefined,
      undefined,
      {
        code: HSON_TEMPLATE_SUBSTITUTION_TYPE_REQUIRED,
        stage: "template-admission",
      },
    );
  }

  const scanned = scan_hson_template_segments(strings.raw, substitutions, encode_hson_template_substitution);
  if (scanned.slots.length !== 0) {
    _throw_transform_err(
      "structural interpolation is unavailable in Hson.canonical",
      "Hson.canonical", undefined, undefined,
      { code: "HSON_STRUCTURAL_SLOT_MODE_FORBIDDEN", stage: "template-admission" },
    );
  }
  return scanned.source;
}

/** Private source and slot admission for the two semantic member tags. */
export function reconstruct_hson_structural_template(
  strings: TemplateStringsArray,
  substitutions: readonly HsonTemplatePrimitive[],
): Readonly<{ source: string; slots: readonly HsonTemplateSlot[] }> {
  if (!isTemplateStringsArray(strings) || strings.raw.length !== substitutions.length + 1) {
    _throw_transform_err("invalid Hson tagged template", "Hson", undefined, undefined,
      { code: HSON_TAGGED_TEMPLATE_REQUIRED, stage: "template-admission" });
  }
  return scan_hson_template_segments(strings.raw, substitutions, encode_hson_template_substitution);
}

/**
 * Author Hson with typed primitive substitutions.
 *
 * Tagged literal segments use their raw source spelling. Substitutions never
 * become source splices: their JavaScript types determine canonical Hson scalar
 * source before the complete reconstructed source is parsed authoritatively.
 */
export function admit_hson(
  strings: TemplateStringsArray,
  ...substitutions: readonly HsonTemplatePrimitive[]
): HsonCanonical;
export function admit_hson(
  source: TemplateStringsArray,
  ...substitutions: readonly HsonTemplatePrimitive[]
): HsonCanonical {
  if (!isTemplateStringsArray(source)) {
    _throw_transform_err(
      "Hson admission requires a semantic member tag",
      "Hson",
      undefined,
      undefined,
      { code: HSON_TAGGED_TEMPLATE_REQUIRED, stage: "template-admission" },
    );
  }
  return admit_hson_source(reconstruct_hson_template_source(source, substitutions));
}
