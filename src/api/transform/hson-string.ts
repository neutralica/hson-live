import { parse_hson } from "./parsers/parse-hson.js";
import { serialize_hson } from "./serializers/serialize-hson.js";
import type { HsonString } from "./transform.types.js";
import { detach_hson_root_value } from "./utils/node-utils/detach-hson-root-value.js";
import { _throw_transform_err } from "./utils/sys-utils/throw-transform-err.utils.js";

const HSON_TEMPLATE_SUBSTITUTION_UNSUPPORTED =
  "HSON_TEMPLATE_SUBSTITUTION_UNSUPPORTED";

function normalizeHsonStringSource(
  source: string | TemplateStringsArray,
  substitutions: readonly unknown[],
): string {
  if (typeof source === "string") return source;

  if (substitutions.length !== 0) {
    _throw_transform_err(
      `HSON tagged templates do not support substitutions; received ${substitutions.length}`,
      "hsonString",
      undefined,
      undefined,
      {
        code: HSON_TEMPLATE_SUBSTITUTION_UNSUPPORTED,
        stage: "template-admission",
      },
    );
  }

  // A host-created substitution-free TemplateStringsArray has one raw segment.
  return source.raw[0];
}

/**
 * Parse HSON source and return its normalized official default serialization.
 */
export function hsonString(
  source: TemplateStringsArray,
  ...substitutions: readonly unknown[]
): HsonString;
export function hsonString(source: string): HsonString;
export function hsonString(
  source: string | TemplateStringsArray,
  ...substitutions: readonly unknown[]
): HsonString {
  const hsonSource = normalizeHsonStringSource(source, substitutions);
  return serialize_hson(detach_hson_root_value(parse_hson(hsonSource)));
}
