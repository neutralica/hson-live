// parse-external-html.transform.ts

import { sanitize_external } from "../../../safety/sanitize-html.utils.js";
import { HsonNode } from "../../../core/types.js";
import { _throw_transform_err } from "../utils/sys-utils/throw-transform-err.utils.js";
import { normalize_html_source_attributes } from "../utils/html-preflights/ordinary-attribute-transit.js";
import {
  decode_hson_metadata_transit,
  encode_hson_metadata_transit,
} from "../utils/html-preflights/hson-metadata-transit.js";
import { parse_html } from "./parse-html.js";

const XML_SHAPED_ARRAY_WRAPPER = /<\/?_hson_(?:arr|ii)(?=[\s/>])/i;

/**
 * Parse untrusted HTML into a sanitized `HsonNode` tree.
 *
 * Pipeline:
 * 1. Apply the source-aware attribute pass while duplicate and reserved-name
 *    identity is still observable.
 * 2. Sanitize the normalized HTML via `sanitize_external` (DOMPurify-based).
 * 3. If sanitization removes all content (only forbidden tags/attrs),
 *    throw with a clear error message.
 * 4. Pass the sanitized HTML into `parse_html` to build the HSON tree.
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
  const sourceAwareHtml = normalize_html_source_attributes(raw);
  const xmlShaped = XML_SHAPED_ARRAY_WRAPPER.test(sourceAwareHtml);
  const sanitizerInput = xmlShaped
    ? encode_hson_metadata_transit(
      normalize_html_source_attributes(sourceAwareHtml, { encodeTransit: true }),
    )
    : sourceAwareHtml;
  const sanitized = sanitize_external(sanitizerInput, { xmlShaped });
  const safeHtml = xmlShaped
    ? decode_hson_metadata_transit(sanitized)
    : sanitized;

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
