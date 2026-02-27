// normalize-css.ts

import { kebab_to_camel } from "../primitive-utils/kebab-to-camel.util.js";
import { camel_to_kebab } from "./camel_to_kebab.js";

//  keep this table small and explicit.
const CSS_PROP_ALIASES: Readonly<Record<string, string>> = {
  float: "cssFloat",        // input "float" -> store "cssFloat"
  "css-float": "cssFloat",  // if you ever see this
};

//  vendor prefixes to CSSOM-style names.
const VENDOR_PREFIX_ALIASES: Readonly<Record<string, string>> = {
  "-webkit-": "Webkit",
  "-moz-": "Moz",
  "-ms-": "ms",
  "-o-": "O",
};

/**
 * Convert a canonical internal style key into a CSS property name.
 *
 * @param propCanon - Canonical property name (camelCase or `--custom-prop`).
 * @returns CSS property name suitable for serialized styles.
 */
export function canon_to_css_prop(propCanon: string): string {
  if (propCanon.startsWith("--")) return propCanon;
  if (propCanon === "cssFloat") return "float";
  return camel_to_kebab(propCanon);
}

/**
 * Normalize a CSS style property key into a canonical form used internally
 * by the style system.
 *
 * This function exists to collapse the many ways a developer might specify
 * a CSS property into a single, predictable representation before it is
 * applied or removed.
 *
 * Accepted input forms:
 * - camelCase (e.g. `backgroundColor`)
 * - kebab-case (e.g. `background-color`)
 * - vendor-prefixed kebab-case (e.g. `-webkit-user-select`)
 * - CSS custom properties (e.g. `--my-var`)
 *
 * Normalization rules:
 * - Custom properties (`--*`) are returned unchanged.
 * - Known CSS aliases (e.g. `"float"`) are mapped explicitly
 *   (e.g. → `"cssFloat"`).
 * - Vendor-prefixed kebab-case properties are converted to their
 *   CSSOM-style camelCase equivalents (e.g. `-webkit-foo-bar` → `WebkitFooBar`).
 * - Standard kebab-case properties are converted to camelCase.
 * - Already-camelCase properties are returned as-is.
 *
 * This canonical form is used consistently across:
 * - Proxy-based setters (`style.set.backgroundColor(...)`)
 * - String-based setters (`setProp("background-color", ...)`)
 * - Bulk setters (`setMany({ backgroundColor: ..., "background-color": ... })`)
 *
 * @param raw
 *   A raw CSS property key in camelCase, kebab-case, vendor-prefixed,
 *   or custom-property form.
 *
 * @returns
 *   A canonicalized property key suitable for internal style application.
 *   Returns an empty string if the input trims to empty.
 */
export function nrmlz_cssom_prop_key(raw: string): string {
  const p = raw.trim();
  if (p === "") return "";

  // custom properties stay as-is
  if (p.startsWith("--")) return p;

  //  aliases first (treat input case-insensitively)
  const lower = p.toLowerCase();
  const aliased = CSS_PROP_ALIASES[lower]; //// currently special-case for cssFloat/css-float only
  if (aliased) return aliased;

  // vendor-ish: -webkit-foo-bar -> WebkitFooBar
  for (const [prefix, head] of Object.entries(VENDOR_PREFIX_ALIASES)) {
    if (lower.startsWith(prefix)) {
      const rest = p.slice(prefix.length);
      return head + kebab_to_camel(rest).replace(/^[a-z]/, ch => ch.toUpperCase());
    }
  }

  // already camel-ish (no dashes)
  if (!p.includes("-")) return p;

  // kebab -> camel
  return kebab_to_camel(p);
}
