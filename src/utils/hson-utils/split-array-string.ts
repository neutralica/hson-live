// split-top-2.ts


/*******
 * Split a flat “array body” string into top-level segments by a single-character separator,
 * while ignoring separators that appear inside:
 * - quoted strings ("…" or '…', with backslash escapes),
 * - nested arrays (both `[...]` and `«...»`),
 * - tag headers (`<...>`), meaning the attribute/header region only.
 *
 * This is a lightweight, single-pass scanner used to safely split list-like
 * surfaces (e.g. comma-separated items) without being fooled by commas that
 * are syntactically “owned” by deeper structures.
 *
 * Important limitations / expectations:
 * - `separator` is treated as a *single character* (the code compares `ch === separator`).
 * - The tag-header guard only covers `<...>` headers; it does not attempt to
 *   understand or skip content between `<tag>` and `</tag>`.
 * - Quote handling supports backslash escaping and ends a string only when the
 *   matching quote character is encountered unescaped.
 * - Nesting depths are tracked independently for square brackets and guillemets.
 *   Depths are assumed to be well-formed in the input.
 *
 * Output:
 * - Each segment is `trim()`’d.
 * - Empty segments are dropped (e.g. trailing separators or `a,,b`), but note that
 *   truly empty *quoted* values (like `""`) survive because their segment length is
 *   non-zero.
 *
 * @param str - The input string to split (typically a bracketless/flat slice).
 * @param separator - The single-character separator to split on (commonly `,`).
 * @returns An array of top-level segments with surrounding whitespace removed.
 *******/
export function split_array_string(str: string, separator: string): string[] {
  /* early out */
  if (!str || str.length === 0) return [];

  const results: string[] = [];
  let lastIx = 0;              /* start index of current segment */
  let ix = 0;                  /* cursor */

  /* state */
  let inString: '"' | "'" | null = null;  /* track which quote */
  let esc = false;                         /* backslash escape */
  let depthSquare = 0;                     /* [ … ] depth */
  let depthAngle = 0;                      /* « … » depth */
  let inHeader = false;                    /* inside < … > tag header */

  while (ix < str.length) {
    const ch = str[ix];

    /* handle escapes first */
    if (esc) { esc = false; ix++; continue; }
    if (ch === '\\') { esc = true; ix++; continue; }

    /* quoted strings */
    if (inString) {
      if (ch === inString) inString = null;
      ix++; continue;
    }
    if (ch === '"' || ch === "'") { inString = ch; ix++; continue; }

    /* tag header guard: enter on '<', exit on '>' */
    if (!inHeader && ch === '<') { inHeader = true; ix++; continue; }
    if (inHeader && ch === '>') { inHeader = false; ix++; continue; }

    /* array nesting */
    if (ch === '«') { depthAngle++; ix++; continue; }
    if (ch === '»') { depthAngle--; ix++; continue; }
    if (ch === '[') { depthSquare++; ix++; continue; }
    if (ch === ']') { depthSquare--; ix++; continue; }

    /* real split only when fully top-level */
    if (
      ch === separator &&
      depthSquare === 0 &&
      depthAngle === 0 &&
      !inHeader
    ) {
      results.push(str.slice(lastIx, ix).trim());
      ix++;
      lastIx = ix;
      continue;
    }

    ix++;
  }

  /* tail */
  results.push(str.slice(lastIx).trim());

  /* remove accidental empties but preserve "" which arrives quoted */
  return results.filter(s => s.length > 0);
}