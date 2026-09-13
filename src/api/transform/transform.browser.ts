import type { TransformOutput } from "./transform.types.js";
import { parse_external_html } from "./parsers/parse-external-html.transform.js";
import { construct_source_1 } from "./constructors/construct-source-1.js";

export const SAFE_TRANSFORM_SOURCE = construct_source_1({ unsafe: false });
export const UNSAFE_TRANSFORM_SOURCE = construct_source_1({ unsafe: true });

export function transform_from_untrusted_html(
  input: string | Element,
): TransformOutput {
  return SAFE_TRANSFORM_SOURCE.fromHtml(input, { sanitize: true });
}

export function transform_from_trusted_html(
  input: string | Element,
): TransformOutput {
  return UNSAFE_TRANSFORM_SOURCE.fromHtml(input, { sanitize: false });
}
