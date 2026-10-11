import { parse_inline_css } from "../../../../internal/css/inline-css.js";

/** Strict, whole-input CSS declaration-list admission into the flat style map.
 * Native browser recovery is deliberately outside this boundary. */
export function parse_style_string(input: string): Record<string, string> {
  return parse_inline_css(input);
}
