// parse_html_attrs.ts


import { _DATA_INDEX, _DATA_QUID, _TRANSIT_PREFIX } from "../../consts/constants";
import { HsonAttrs, HsonMeta } from "../../types/node.types";
import { normalize_attr_ws } from "../attrs-utils/normalize_attrs_ws";
import { parse_style_string } from "../attrs-utils/parse-style";


/**
 * Extract HSON-facing attributes from a live DOM `Element`.
 *
 * Rules:
 * - Returns `attrs` for user-visible attributes and optional `meta` for reserved
 *   on-wire metadata (`data-_...` keys).
 * - Drops internal transit-only attributes (`data--*`) used during preprocessing.
 * - Normalizes style into a structured object via `parse_style_string`.
 * - Ignores XML namespace noise (`xmlns`, `xmlns:*`, `xml:*`) so HTML/SVG/XML
 *   sources don’t leak parser plumbing into HSON.
 * - For SVG, maps `xlink:href` → `href` (only if `href` is not already present),
 *   so downstream code can treat links uniformly.
 * - Canonicalizes boolean/presence flags so `disabled`, `disabled=""`, and
 *   `disabled="disabled"` become `disabled="disabled"` in `attrs`.
 * - Normalizes other attribute values with `normalize_attr_ws` to collapse
 *   whitespace (but does not apply this to `style`, which is parsed separately).
 *
 * @param el - The DOM element to read attributes from.
 * @returns `{ attrs, meta? }` where `attrs` holds user attributes and `meta`
 *          holds reserved on-wire metadata when present.
 */
export function parse_html_attrs(el: Element): {
  attrs: HsonAttrs;
  meta?: HsonMeta;
} {
  const attrs: HsonAttrs = {};
  let meta: HsonMeta | undefined;

  // walk all DOM attributes verbatim
  for (const a of Array.from(el.attributes)) {
    const name = a.name;
    const n = name.toLowerCase();
    const v = a.value ?? "";

    // A) strip transit-only hints outright
    if (n.startsWith(_TRANSIT_PREFIX)) continue;

    // B) _meta-on-wire (reserved)
    if (n === _DATA_INDEX) { (meta ??= {})[_DATA_INDEX] = v; continue; }
    if (n === _DATA_QUID) { (meta ??= {})[_DATA_QUID] = v; continue; }

    // C) style → structured object 
    if (n === "style") { (attrs as any).style = parse_style_string(v); continue; }

    // D) ignore xmlns / xml:* noise
    if (name === "xmlns" || name.startsWith("xmlns:") || name.startsWith("xml:")) continue;

    // E) svg alias normalize
    if (el.namespaceURI === "http://www.w3.org/2000/svg" && n === "xlink:href") {
      if (!el.hasAttribute("href")) (attrs as any).href = v;
      continue;
    }

    // F) presence-only flags canonicalized as key="key"
    if (v === "" || v === name) { (attrs as any)[n] = name; continue; }

    // G) default: normalized user attribute
    (attrs as any)[n] = normalize_attr_ws(v);
  }

  return { attrs, meta };
}
