// escape_angles.ts

/***********************************************
 * escape_attr_angles
 *
 * Escape literal `<` and `>` characters that occur
 * *inside quoted attribute values* in an HTML string.
 *
 * This protects attribute payloads from accidentally
 * being interpreted as markup while leaving:
 *   - text nodes,
 *   - tag structure,
 *   - already-escaped entities
 * completely untouched.
 *
 * Rules:
 * - Outside of a tag: characters are emitted verbatim.
 * - Inside a tag but *not* inside quotes: `<` and `>`
 *   retain their markup meaning.
 * - Inside a quoted attribute value:
 *     `<` → `&lt;`
 *     `>` → `&gt;`
 * - Matching quote characters close the quoted section.
 *
 * This is a safe, conservative transform intended for
 * serializer output, not a general HTML sanitizer.
 *
 * @param src  Any HTML source string.
 * @returns    The same HTML string, but with `<` and `>`
 *             escaped only within quoted attribute values.
 ***********************************************/
export function escape_attr_angles(src: string): string {
  let out = '';
  let inTag = false;
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i] as string;

    if (!inTag) {
      if (ch === '<') { inTag = true; out += ch; continue; }
      out += ch; continue;
    }

    // inTag === true
    if (quote) {
      if (ch === quote) { quote = null; out += ch; continue; }
      if (ch === '<') { out += '&lt;'; continue; }
      if (ch === '>') { out += '&gt;'; continue; }
      out += ch; continue;
    } else {
      if (ch === '"' || ch === "'") { quote = ch as '"' | "'"; out += ch; continue; }
      if (ch === '>') { inTag = false; out += ch; continue; }
      out += ch; continue;
    }
  }
  return out;
}