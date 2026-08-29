// split-attrs-meta.ts

import { HsonAttrs, HsonMeta } from "../../../../core/types.js";
import type { RawAttr } from "../../token.types.js";
import { parse_style_string } from "../attrs-utils/parse-style.js";
import { unescape_hson_string } from "./unescape-hson.js";
import { Primitive } from "../../../../core/types.js";

/*******
 * Decode an attribute/meta value coming from the Hson tokenizer.
 *
 * Hson rule:
 * - If a value was quoted in source, it is treated as an Hson string literal
 *   and must be unescaped (e.g. \" \\n \\uXXXX, etc.) via `unescape_hson_string`.
 * - If it was not quoted, it is treated as raw text and only trimmed.
 *
 * This function exists as a single, explicit decision point so the parser does
 * not scatter “quoted?” logic across multiple call sites.
 *
 * @param text - Raw value text from the tokenizer (without surrounding quotes).
 * @param quoted - True iff the tokenizer recognized this value as quoted.
 * @returns The decoded string value suitable for storing in `$_attrs` or `$_meta`.
 *******/
function decode_hson_value(text: string, quoted: boolean | undefined): string {
  // single, explicit decision point
  return quoted ? unescape_hson_string(text) : text.trim();
}

/*******
 * Split raw parsed attributes into `$_attrs` vs `$_meta`, applying Hson-edge decoding.
 *
 * Input:
 * - `RawAttr[]` emitted by the tokenizer for a single open tag.
 * - Each RawAttr includes:
 *   - `name` (attribute key),
 *   - optional `value` as `{ text, quoted }`.
 *
 * Hson metadata uses dedicated grammar (`@<quid>` and structural array order).
 * Attribute tokens are therefore always ordinary `$_attrs`.
 *
 * Value semantics (Hson edge, not HTML):
 * - Quoted values are Hson string literals and are decoded via `decode_hson_value`.
 * - Unquoted values are treated as raw text and trimmed.
 * - No HTML entity decoding is performed at this stage; this path assumes Hson
 *   source, not external HTML.
 *
 * Special cases:
 * - `style`:
 *   - If present, decode (if quoted) and parse using `parse_style_string` to
 *     produce an object form stored at `attrs.style`.
 *   - If present but valueless (`style` as a bare key), stores `{}`.
 * - Flags:
 *   - If the attribute has no value (bare key), it is treated as a boolean-present
 *     flag and stored as `attrs[k] = k`.
 *   - Additionally, `disabled=""` and `disabled="disabled"` (and equivalents) are
 *     normalized to the same flag representation (`attrs[k] = k`).
 *
 * Debug hygiene (optional):
 * - In non-production builds, may warn if decoded values still contain patterns
 *   that suggest missed decoding (JSON-style escapes) or cross-edge leakage
 *   (HTML entities).
 *
 * @param raw - Tokenizer-emitted raw attribute list for one open tag.
 * @returns An object containing:
 *   - `attrs`: normalized `HsonAttrs` (including parsed `style` when present),
 *   - `meta`: empty; retained in the return shape for parser composition.
 *******/
export function split_attrs_meta(raw: RawAttr[]): { attrs: HsonAttrs; meta: HsonMeta } {
  const attrs: HsonAttrs = {};
  const meta:  HsonMeta  = {};

  for (const ra of raw) {
    const k: string = ra.name;

    // style → decode (if quoted) → parse to object
    if (k === "style") {
      if (ra.value) {
        // decode first, then parse; keeps parity with other sources
        const decoded: string = decode_hson_value(ra.value.text, ra.value.quoted);
        attrs.style = parse_style_string(decoded);
      } else {
        attrs.style = {};
      }
      continue;
    }

    // Flags & normal values (Hson edge — JSON-literal quotes only, no HTML entities)
    if (!ra.value) {
      // flag === key="key"
      attrs[k] = k as unknown as Primitive; 
      continue;
    }

    // decode quoted Hson once
    const val: string = decode_hson_value(ra.value.text, ra.value.quoted);

    // Maintain disabled="" / disabled="disabled" → key flag behavior
    if (val === k) {
      attrs[k] = k as unknown as Primitive;
    } else {
      attrs[k] = val as unknown as Primitive;
    }
  }


  return { attrs, meta };
}
