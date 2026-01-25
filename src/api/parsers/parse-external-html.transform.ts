// parse-external-html.utils.ts

import { sanitize_external } from "../../safety/sanitize-html.utils";
import { HsonNode } from "../../types/node.types";
import { _throw_transform_err } from "../../utils/sys-utils/throw-transform-err.utils";
import { parse_html } from "./parse-html.new.transform";

/**
 * Parse untrusted HTML into a sanitized `HsonNode` tree.
 *
 * Pipeline:
 * 1. Sanitize the raw HTML via `sanitize_external` (DOMPurify-based).
 * 2. If sanitization removes all content (only forbidden tags/attrs),
 *    throw with a clear error message.
 * 3. Pass the sanitized HTML into `parse_html` to build the HSON tree.
 *
 * This function is the safe HTML entry-point: all external/untrusted
 * HTML should go through this path rather than `parse_html` directly.
 *
 * @param raw - Untrusted HTML string to sanitize and parse.
 * @returns A rooted `HsonNode` tree representing the sanitized markup.
 * @see sanitize_external
 * @see parse_html
 */
export function parse_external_html(raw: string): HsonNode {
  const safeHtml = sanitize_external(raw);

  //  if sanitizer nuked everything, fail with a clearer reason
  if (!safeHtml.trim()) {
    _throw_transform_err(
      "parse_external_html(): all content removed by sanitizer (forbidden tags/attrs only).",
      "parse_external_html",
      raw.slice(0, 200)
    );
  }

  return parse_html(safeHtml);
}
