// escape-html.ts

import { is_Primitive } from "../core-utils/guards.core.js";
import { _throw_transform_err } from "../sys-utils/throw-transform-err.utils.js";

/**
 * Escape a primitive value for safe inclusion in serialized HTML.
 *
 * Behavior:
 * - Accepts only HSON primitives (string | number | boolean | null).
 * - Throws if a non-primitive value is provided, since structured values
 *   should never reach HTML text serialization directly.
 * - Non-string primitives are stringified without escaping.
 * - Strings are HTML-escaped to neutralize markup-significant characters.
 *
 * Escapes:
 * - `&` → `&amp;`
 * - `<` → `&lt;`
 * - `>` → `&gt;`
 * - `"` → `&quot;`
 * - `'` → `&#039;`
 *
 * Intended use:
 * - Final safety pass before emitting raw HTML text nodes or attribute values
 *   that are not already known to be safe.
 * - Not for escaping inside structured DOM APIs (which handle this themselves).
 *
 * @param str - A primitive value to escape for HTML output.
 * @returns The escaped string representation.
 * @throws If `str` is not a primitive value.
 */
export function escape_html_text(str: any): string {
  if (!is_Primitive(str)) {
    _throw_transform_err('need a string in escape_html', 'escape_html', str)
  }
  if (typeof str !== 'string') {
    return String(str);
  } else {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
