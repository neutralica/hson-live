import { CSS_PROPERTY_NAMES } from "../../../../core/css-properties.js";
import { trim_css_value_boundary } from "../../../../core/css-value-boundary.js";
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

// Some CSS segments (3dlight, x-max) lose separators in CSSOM camel spelling.
// Resolve maintained names before the generic converter rather than guessing those boundaries.
const CSS_CANONICAL_NAMES: ReadonlyMap<string, string> = new Map(CSS_PROPERTY_NAMES.map(name => [normalize_css_key(name), name]));

/**
 * Convert a canonical internal style key into a CSS property name.
 *
 * @param propCanon - Canonical property name (camelCase or `--custom-prop`).
 * @returns CSS property name suitable for serialized styles.
 */
export function canon_to_css_prop(propCanon: string): string {
  if (propCanon.startsWith("--")) return propCanon;
  if (propCanon === "cssFloat") return "float";
  const known = CSS_CANONICAL_NAMES.get(propCanon);
  if (known !== undefined) return known;
  const vendor = /^(Webkit|webkit|Moz|moz|ms|Ms|O|o)([A-Z].*)$/.exec(propCanon);
  if (vendor) {
    const prefix = `-${vendor[1].toLowerCase()}-`;
    const alias = CSS_CANONICAL_NAMES.get(`${VENDOR_PREFIX_ALIASES[prefix]}${vendor[2]}`);
    return alias ?? `${prefix}${camel_to_kebab(vendor[2].replace(/([A-Z])([A-Z][a-z])/g, "$1-$2"))}`;
  }
  return camel_to_kebab(propCanon.replace(/([A-Z])([A-Z][a-z])/g, "$1-$2"));
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
export function normalize_css_key(raw: string): string {
  const p = trim_css_value_boundary(raw);
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

export function normalize_css_value(prop: string, value: string): string {
  if (prop !== "content") return value;

  const v = trim_css_value_boundary(value);

  // already quoted string
  if (
    (v.startsWith(`"`) && v.endsWith(`"`)) ||
    (v.startsWith(`'`) && v.endsWith(`'`))
  ) return v;

  // raw CSS content forms / keywords
  if (
    v === "none" ||
    v === "normal" ||
    v === "open-quote" ||
    v === "close-quote" ||
    v === "no-open-quote" ||
    v === "no-close-quote" ||
    /^attr\(/.test(v) ||
    /^counter\(/.test(v) ||
    /^counters\(/.test(v) ||
    /^url\(/.test(v)
  ) return v;

  // otherwise treat as literal text content
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
