// split-attrs-meta.ts

import { HsonAttrs, HsonMeta } from "../../types/node.types";
import { _META_DATA_PREFIX } from "../../consts/constants";
import { RawAttr } from "../../types/token.types";
import { parse_style_string } from "../attrs-utils/parse-style";
import { unescape_hson_string } from "./unescape-hson";
import { Primitive } from "../../types/core.types";

/*******
 * Decode an attribute/meta value coming from the HSON tokenizer.
 *
 * HSON rule:
 * - If a value was quoted in source, it is treated as an HSON string literal
 *   and must be unescaped (e.g. \" \\n \\uXXXX, etc.) via `unescape_hson_string`.
 * - If it was not quoted, it is treated as raw text and only trimmed.
 *
 * This function exists as a single, explicit decision point so the parser does
 * not scatter “quoted?” logic across multiple call sites.
 *
 * @param text - Raw value text from the tokenizer (without surrounding quotes).
 * @param quoted - True iff the tokenizer recognized this value as quoted.
 * @returns The decoded string value suitable for storing in `_attrs` or `_meta`.
 *******/
function decode_hson_value(text: string, quoted: boolean | undefined): string {
  // single, explicit decision point
  return quoted ? unescape_hson_string(text) : text.trim();
}

/*******
 * Split raw parsed attributes into `_attrs` vs `_meta`, applying HSON-edge decoding.
 *
 * Input:
 * - `RawAttr[]` emitted by the tokenizer for a single open tag.
 * - Each RawAttr includes:
 *   - `name` (attribute key),
 *   - optional `value` as `{ text, quoted }`.
 *
 * Routing rules:
 * - Meta keys:
 *   - Only keys starting with `data-_` (via `_META_DATA_PREFIX`) are stored in `_meta`.
 *   - Meta values are decoded using HSON quoting rules (no HTML entity decoding).
 * - Attribute keys:
 *   - Everything else is stored in `_attrs`.
 *
 * Value semantics (HSON edge, not HTML):
 * - Quoted values are HSON string literals and are decoded via `decode_hson_value`.
 * - Unquoted values are treated as raw text and trimmed.
 * - No HTML entity decoding is performed at this stage; this path assumes HSON
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
 *   - `meta`: normalized `HsonMeta` containing only `data-_...` keys.
 *******/
export function split_attrs_meta(raw: RawAttr[]): { attrs: HsonAttrs; meta: HsonMeta } {
  const attrs: HsonAttrs = {};
  const meta:  HsonMeta  = {};

  for (const ra of raw) {
    const k: string = ra.name;

    // Route meta: ONLY data-_* goes to _meta (HSON edge — no HTML entities here)
    if (k.startsWith(_META_DATA_PREFIX)) {
      // decode quoted HSON once before storing
      if (ra.value) {
        const val: string = decode_hson_value(ra.value.text, ra.value.quoted);
        meta[k] = val;
      }
      // Bare meta keys are unusual; ignoring is fine.
      continue;
    }

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

    // Flags & normal values (HSON edge — JSON-literal quotes only, no HTML entities)
    if (!ra.value) {
      // flag === key="key"
      attrs[k] = k as unknown as Primitive; 
      continue;
    }

    // decode quoted HSON once
    const val: string = decode_hson_value(ra.value.text, ra.value.quoted);

    // Maintain disabled="" / disabled="disabled" → key flag behavior
    if (val === "" || val === k) {
      attrs[k] = k as unknown as Primitive;
    } else {
      attrs[k] = val as unknown as Primitive;
    }
  }

  // OPTIONAL (but recommended during debug builds):
  // Assert the Node invariant: no stray JSON escapes or HTML entities.
  // This catches missed decodes or accidental cross-edge escaping.
  if (process.env.NODE_ENV !== "production") {
    const suspicious = /\\["nrt]|&(?:quot|amp|lt|gt);/;
    for (const [ak, av] of Object.entries(attrs)) {
      if (typeof av === "string" && suspicious.test(av)) {
        console.warn(`[HSON ingest] suspicious attr value after decode: ${ak}=${JSON.stringify(av)}`);
      }
    }
    for (const [mk, mv] of Object.entries(meta)) {
      if (typeof mv === "string" && suspicious.test(mv)) {
        console.warn(`[HSON ingest] suspicious meta value after decode: ${mk}=${JSON.stringify(mv)}`);
      }
    }
  }

  return { attrs, meta };
}
