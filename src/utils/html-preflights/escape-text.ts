// escape-text.new.ts

/*******
 * Escape only *text* segments in an HTML-ish string, leaving markup intact.
 *
 * This function walks the input and treats characters outside of tag headers
 * (`<...>`) as text nodes. Only those text segments are escaped; everything
 * inside tag headers (tag names + attribute syntax + quoted attribute values)
 * is copied through unchanged.
 *
 * Escaping rules for text segments:
 * - Replaces bare `&` with `&amp;`, but preserves existing entities:
 *   - numeric: `&#123;`, `&#x1F4A9;`
 *   - named:   `&nbsp;`, `&amp;`, etc.
 * - Replaces `<` with `&lt;` and `>` with `&gt;`
 *
 * Tag detection notes:
 * - A `<` begins a tag header only when the next character looks like a tag
 *   starter (letter, `_`, `:`, `!`, `?`, or `/`). This reduces false positives
 *   for text like `1 < 2`.
 * - While inside a tag header, the scanner honors quotes (`"` / `'`) so that
 *   any `>` characters appearing inside quoted attribute values do not end the
 *   tag early.
 *
 * Limitations:
 * - This is not a full HTML parser; it is a conservative text-escape pass for
 *   “mostly-markup” strings.
 * - It does not attempt to understand comments/CDATA beyond the tag-header rule.
 *
 * Intended use:
 * - Pre-escaping user-visible text while preserving already-formed markup and
 *   attribute values (useful for “HTML string assembly” pipelines where you
 *   want to keep tags/attrs verbatim).
 *
 * @param input - An HTML-ish string containing markup and/or text.
 * @returns A string where only text segments are entity-escaped.
 *******/
export function escape_text(input: string): string {
  let out = "";
  let i = 0, n = input.length;
  let inTag = false;
  let quote: '"' | "'" | null = null;

  const escapeText = (chunk: string) =>
    chunk
      .replace(/&(?!#\d+;|#x[0-9A-Fa-f]+;|[a-zA-Z][\w.-]*;)/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  // XML NameStartChar (very simplified) + specials
  const isTagStarter = (c: string | undefined) =>
    !!c && (c === ":" || c === "_" || /[A-Za-z]/.test(c) || c === "!" || c === "?" || c === "/");

  while (i < n) {
    if (!inTag) {
      let j = i;
      while (j < n) {
        if (input[j] === "<" && isTagStarter(input[j + 1])) break; 
        j++;
      }
      if (j > i) out += escapeText(input.slice(i, j));
      if (j < n) { inTag = true; out += "<"; i = j + 1; } else { i = j; }
    } else {
      let j = i;
      while (j < n) {
        const c = input[j]!;
        if (quote) { if (c === quote) quote = null; j++; continue; }
        if (c === '"' || c === "'") { quote = c as '"' | "'"; j++; continue; }
        if (c === ">") { j++; inTag = false; break; }
        j++;
      }
      out += input.slice(i, j);
      i = j;
    }
  }
  return out;
}
