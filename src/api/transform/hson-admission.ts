import type { Primitive } from "../../core/types.js";
import { admit_hson_number } from "../../core/hson-number.js";
import { parse_hson } from "./parsers/parse-hson.js";
import { serialize_hson } from "./serializers/serialize-hson.js";
import type { HsonCanonical } from "./transform.types.js";
import { detach_hson_root_value } from "./utils/node-utils/detach-hson-root-value.js";
import { serialize_primitive_hson } from "./utils/primitive-utils/serialize-primitive.utils.js";
import { _throw_transform_err } from "./utils/sys-utils/throw-transform-err.utils.js";

type HsonTemplatePrimitive = string | number | boolean | null;

export const HSON_TAGGED_TEMPLATE_REQUIRED = "HSON_TAGGED_TEMPLATE_REQUIRED" as const;
const HSON_TEMPLATE_SUBSTITUTION_TYPE_REQUIRED =
  "HSON_TEMPLATE_SUBSTITUTION_TYPE_REQUIRED";

function admitHsonSource(source: string): HsonCanonical {
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

function reconstructTaggedSource(
  strings: TemplateStringsArray,
  substitutions: readonly HsonTemplatePrimitive[],
): string {
  if (strings.raw.length !== substitutions.length + 1) {
    _throw_transform_err(
      "invalid HSON tagged-template segment/substitution arity",
      "HSON",
      undefined,
      undefined,
      {
        code: HSON_TEMPLATE_SUBSTITUTION_TYPE_REQUIRED,
        stage: "template-admission",
      },
    );
  }

  let source = strings.raw[0];
  for (let index = 0; index < substitutions.length; index += 1) {
    const value: unknown = substitutions[index];
    if (value !== null
      && typeof value !== "string"
      && typeof value !== "number"
      && typeof value !== "boolean") {
      _throw_transform_err(
        `HSON tagged-template substitutions must be primitive string, number, boolean, or null values; substitution ${index + 1} received ${typeof value}`,
        "HSON",
        undefined,
        undefined,
        {
          code: HSON_TEMPLATE_SUBSTITUTION_TYPE_REQUIRED,
          stage: "template-admission",
        },
      );
    }
    source += encodeTemplatePrimitive(value as HsonTemplatePrimitive);
    source += strings.raw[index + 1];
  }
  return source;
}

/**
 * Author HSON with typed primitive substitutions.
 *
 * Tagged literal segments use their raw source spelling. Substitutions never
 * become source splices: their JavaScript types determine canonical HSON scalar
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
      "HSON must be used as a tagged template: HSON`...`",
      "HSON",
      undefined,
      undefined,
      { code: HSON_TAGGED_TEMPLATE_REQUIRED, stage: "template-admission" },
    );
  }
  return admitHsonSource(reconstructTaggedSource(source, substitutions));
}
