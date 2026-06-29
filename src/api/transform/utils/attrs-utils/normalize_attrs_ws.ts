// normalize_attrs_ws.ts

/*******
 * Normalize whitespace inside an attribute value.
 *
 * Behavior:
 * - Replaces newlines, carriage returns, and tabs with spaces.
 * - Collapses multiple consecutive spaces into a single space.
 * - Trims leading and trailing whitespace.
 *
 * Intended use:
 * - Canonicalize attribute values for comparison, serialization,
 *   or downstream processing.
 *
 * Notes:
 * - This should NOT be applied to the `style` attribute, whose
 *   internal spacing may be semantically meaningful.
 *
 * @param s - Raw attribute value string.
 * @returns A whitespace-normalized string.
 *******/
export function normalize_attr_ws(s: string): string {
  // don’t use on 'style'
  return s
    .replace(/[\r\n\t]/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}
