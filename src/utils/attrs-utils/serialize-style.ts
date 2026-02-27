// serialize-style.ts

import { CssMap } from "../../types/css.types.js";
import { camel_to_kebab } from "./camel_to_kebab.js";

/*******
 * Serialize a style object into a CSS declaration list string.
 *
 * Purpose:
 * - Converts an internal `StyleObject` (dictionary of properties → values)
 *   into a browser-compatible declaration list suitable for `style=""`
 *   or for emitting inline styles.
 *
 * Output format:
 * - Uses `kebab-case` property names for non-custom properties.
 * - Preserves custom properties (`--foo`) verbatim as keys.
 * - Produces declarations in a deterministic order (sorted by final key).
 * - Produces a compact string with:
 *   - one space after `:`
 *   - declarations separated by `"; "`
 *   - no trailing semicolon at the end
 *
 * Normalization:
 * - Skips null/undefined values.
 * - Trims stringified values.
 * - Skips empty values after trimming.
 * - Strips any trailing semicolons from values to avoid `;;` output.
 *
 * Caveats:
 * - Does not validate property names or values.
 * - Coerces values via `String(...)`, so non-string values are serialized by
 *   their string representation.
 *
 * @param style - Style object mapping property names to values (or undefined).
 * @returns A CSS declaration list string, or `""` when there is nothing to emit.
 *******/
export function serialize_style(style: CssMap | undefined): string {
  if (!style || !Object.keys(style).length) { return ""; }

  // CHANGE: normalize entries BEFORE sorting/serializing
  const entries: Array<[string, string]> = [];
  for (const [prop, raw] of Object.entries(style)) {
    if (raw == null) continue;                       // CHANGE: skip null/undefined
    let v = String(raw).trim();                      // CHANGE: trim values
    if (!v) continue;                                // CHANGE: skip empty values
    if (v.endsWith(";")) v = v.replace(/;+$/g, "");  // CHANGE: strip any trailing semicolons
    const isCustomProp = prop.startsWith("--");
    const outKey =
      isCustomProp ? prop :
        prop === "cssFloat" ? "float" :
          camel_to_kebab(prop);

    entries.push([outKey, v]);
  }

  // CHANGE: sort deterministically after normalization
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  // CHANGE: no trailing semicolon; single-space after colon; single "; " between decls
  return entries.map(([k, v]) => `${k}: ${v}`).join("; ");
}
