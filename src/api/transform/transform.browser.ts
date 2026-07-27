import type { OutputConstructor_2 } from "../../types/constructor.types.js";
import { parse_external_html } from "./parsers/parse-external-html.transform.js";
import { construct_source_1 } from "./constructors/construct-source-1.js";
import { set_transform_html_sanitizer } from "./constructors/construct-output-2.js";

export const SAFE_TRANSFORM_SOURCE = construct_source_1({ unsafe: false });
export const UNSAFE_TRANSFORM_SOURCE = construct_source_1({ unsafe: true });

set_transform_html_sanitizer(parse_external_html);

export function transform_from_untrusted_html(
  input: string | Element,
): OutputConstructor_2 {
  return SAFE_TRANSFORM_SOURCE.fromHtml(input, { sanitize: true });
}

export function transform_from_trusted_html(
  input: string | Element,
): OutputConstructor_2 {
  return UNSAFE_TRANSFORM_SOURCE.fromHtml(input, { sanitize: false });
}
