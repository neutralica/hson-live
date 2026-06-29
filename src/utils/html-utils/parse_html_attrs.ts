// parse_html_attrs.ts

import { _DATA_INDEX, _DATA_QUID, _TRANSIT_PREFIX } from "../../consts/constants.js";
import { HsonAttrs, HsonMeta } from "../../types/node.types.js";
import { normalize_attr_ws } from "../attrs-utils/normalize_attrs_ws.js";
import { parse_style_string } from "../attrs-utils/parse-style.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

const isSvgElement = (el: Element): boolean => el.namespaceURI === SVG_NAMESPACE;

const isNamespaceNoise = (name: string): boolean => {
  return name === "xmlns" || name.startsWith("xmlns:") || name.startsWith("xml:");
};

const attrKeyForElement = (el: Element, name: string): string => {
  // changed: SVG attrs are case-sensitive in practice; preserve DOM/authored spelling.
  if (isSvgElement(el)) return name;

  // HTML attrs remain normalized to lowercase for HSON stability.
  return name.toLowerCase();
};

const isPresenceAttr = (key: string, name: string, value: string): boolean => {
  return value === "" || value === name || value === key;
};

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
 * - Preserves SVG attribute names exactly as the DOM reports them. This keeps
 *   case-sensitive SVG names such as `viewBox`, `stdDeviation`, and
 *   `preserveAspectRatio` intact instead of relying on an incomplete repair map.
 * - Lowercases HTML attribute names for stable HTML/HSON behavior.
 * - For SVG, maps `xlink:href` → `href` only if `href` is not already present,
 *   so downstream code can treat links uniformly.
 * - Canonicalizes boolean/presence flags so `disabled`, `disabled=""`, and
 *   `disabled="disabled"` become `disabled="disabled"` in `attrs`; SVG presence
 *   attributes preserve the SVG key spelling.
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
  const svg = isSvgElement(el);

  // walk all DOM attributes verbatim
  for (const a of Array.from(el.attributes)) {
    const name = a.name;
    const key = attrKeyForElement(el, name);
    const v = a.value ?? "";

    // A) strip transit-only hints outright
    if (key.startsWith(_TRANSIT_PREFIX)) continue;

    // B) $_meta-on-wire (reserved)
    if (key === _DATA_INDEX) {
      (meta ??= {})[_DATA_INDEX] = v;
      continue;
    }

    if (key === _DATA_QUID) {
      (meta ??= {})[_DATA_QUID] = v;
      continue;
    }

    // C) style → structured object
    if (key === "style") {
      (attrs as any).style = parse_style_string(v);
      continue;
    }

    // D) ignore xmlns / xml:* noise
    if (isNamespaceNoise(name)) continue;

    // E) svg alias normalize
    if (svg && name === "xlink:href") {
      if (!el.hasAttribute("href")) (attrs as any).href = v;
      continue;
    }

    // F) presence-only flags canonicalized as key="key"
    if (isPresenceAttr(key, name, v)) {
      (attrs as any)[key] = key;
      continue;
    }

    // G) default: normalized user attribute value, preserving the chosen key
    (attrs as any)[key] = normalize_attr_ws(v);
  }

  return { attrs, meta };
}

/**
 * Legacy SVG attr repair map.
 *
 * This is intentionally no longer used by `parse_html_attrs()` for live SVG DOM
 * reads. SVG attributes are now preserved exactly at the namespace boundary.
 * Keep the map available for older parse/repair paths that may need to recover
 * case-sensitive SVG attr names from already-lowercased legacy input.
 */
export const SVG_ATTR_CASE_MAP: Record<string, string> = {
  viewbox: "viewBox",
  preserveaspectratio: "preserveAspectRatio",
  markerwidth: "markerWidth",
  markerheight: "markerHeight",
  gradientunits: "gradientUnits",
  gradienttransform: "gradientTransform",
  patternunits: "patternUnits",
  patterncontentunits: "patternContentUnits",
  patterntransform: "patternTransform",
  clippathunits: "clipPathUnits",
  filterunits: "filterUnits",
  primitiveunits: "primitiveUnits",
  kernelunitlength: "kernelUnitLength",
  strokewidth: "strokeWidth",
  vectoreffect: "vectorEffect",
  stddeviation: "stdDeviation",
  basefrequency: "baseFrequency",
  diffuseconstant: "diffuseConstant",
  specularconstant: "specularConstant",
  specularexponent: "specularExponent",
  surfacescale: "surfaceScale",
  limitingconeangle: "limitingConeAngle",
};

export function canonical_svg_attr_name(name: string): string {
  const lower = name.toLowerCase();
  return SVG_ATTR_CASE_MAP[lower] ?? name;
}