// parse_html_attrs.ts

import {
  HSON_META_MARKUP_PREFIX,
  HSON_META_QUID,
  HSON_META_TRANSIT_PREFIX,
  _TRANSIT_PREFIX,
} from "../../../../core/constants.js";
import {
  admit_hson_metadata_markup,
} from "../../../../core/hson-metadata.js";
import { HsonAttrs, HsonMeta } from "../../../../core/types.js";
import { normalize_attr_ws } from "../attrs-utils/normalize_attrs_ws.js";
import { parse_style_string } from "../attrs-utils/parse-style.js";
import {
  decode_hson_metadata_transit_name,
  is_hson_metadata_transit_name,
} from "../html-preflights/hson-metadata-transit.js";
import { _throw_transform_err } from "../sys-utils/throw-transform-err.utils.js";

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
 * - Returns `attrs` for user-visible attributes, optional `meta` for reserved
 *   structural metadata, and protected QUID input separately for canonical
 *   attachment by the caller.
 * - Decodes dedicated HSON metadata transit names only for the string parser
 *   path and rejects externally authored private names.
 * - Drops internal generic transit-only attributes used during preprocessing.
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
 * @returns Parsed ordinary attributes plus optional structural metadata and a
 *          separately captured protected QUID value.
 */
export function parse_html_attrs(
  el: Element,
  nodeTag: string,
  options: Readonly<{ allowHsonTransit?: boolean }> = {},
): {
  attrs: HsonAttrs;
  meta?: HsonMeta;
  quid?: string;
} {
  const attrs: HsonAttrs = {};
  let meta: HsonMeta | undefined;
  let quid: string | undefined;
  const svg = isSvgElement(el);

  // walk all DOM attributes verbatim
  for (const a of Array.from(el.attributes)) {
    const name = a.name;
    const key = attrKeyForElement(el, name);
    const v = a.value ?? "";

    // A) decode dedicated HSON metadata transit or admit a literal DOM name.
    let metadataMarkupName: string | undefined;
    if (is_hson_metadata_transit_name(key)) {
      if (!options.allowHsonTransit) {
        _throw_transform_err(
          `externally authored private HSON metadata transit name "${key}" is forbidden`,
          "parse-html-attrs",
        );
      }
      metadataMarkupName = decode_hson_metadata_transit_name(key);
      if (metadataMarkupName === undefined) {
        _throw_transform_err(
          `malformed private HSON metadata transit name "${key}"`,
          "parse-html-attrs",
        );
      }
    } else if (key.startsWith(HSON_META_MARKUP_PREFIX)) {
      metadataMarkupName = key;
    }

    if (metadataMarkupName !== undefined) {
      const admission = admit_hson_metadata_markup(
        nodeTag,
        metadataMarkupName,
        v,
      );
      if (!admission.valid) {
        _throw_transform_err(
          admission.reason,
          "parse-html-attrs",
        );
      }
      if (admission.key === HSON_META_QUID) quid = admission.value;
      else (meta ??= {})[admission.key] = admission.value;
      continue;
    }

    // B) generic parser transit remains internal.
    if (key.startsWith(_TRANSIT_PREFIX)) continue;
    if (key.startsWith(HSON_META_TRANSIT_PREFIX)) {
      _throw_transform_err(
        `externally authored private HSON metadata transit name "${key}" is forbidden`,
        "parse-html-attrs",
      );
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

  return {
    attrs,
    ...(meta === undefined ? {} : { meta }),
    ...(quid === undefined ? {} : { quid }),
  };
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
