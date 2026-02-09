// tokenize-full-string.ts

import { _throw_transform_err } from "../sys-utils/throw-transform-err.utils";


type QuoteDelim = '"' | "'" | '`';

/**
 * Check whether a character is a supported quote delimiter.
 *
 * @param ch - Single character to test.
 * @returns True when `ch` is `"`, `'`, or `` ` ``.
 */
export function is_quote(ch: string): ch is QuoteDelim {
  return ch === '"';
}

/*******
 * Read a quoted literal that may span multiple lines, starting at a cursor
 * position where the current character is a quote delimiter (`"`, `'`, or `` ` ``).
 *
 * Scanning rules:
 * - Begins at `lines[lineIdx][colIdx]` (the opener) and consumes characters until the
 *   first *unescaped* matching delimiter is found.
 * - Supports backslash escaping for the delimiter and for backslash itself.
 * - Preserves the interior *verbatim* (no unescaping / decoding is performed here).
 * - Treats everything inside as literal text, including tokens that might otherwise
 *   look meaningful (e.g. `//`, `#`, `<`, `>`, brackets, etc.).
 * - If the closer is not found on the current line, a `\n` is appended to `raw` and
 *   scanning continues on the next line from column 0.
 *
 * Return value:
 * - `raw` is the exact interior content as written (excluding the opening/closing quotes).
 * - `endLine` / `endCol` point to the cursor *after* the closing delimiter (ready to continue).
 * - `delim` is the delimiter that opened (and therefore closed) the block.
 *
 * Errors:
 * - Throws (via `_throw_transform_err`) if:
 *   - the starting character is not a supported quote delimiter, or
 *   - the input ends (EOF) before a matching closing delimiter is found.
 *
 * Notes:
 * - Because `raw` is returned un-decoded, this helper is typically paired with a later
 *   “decode/unescape” step that is specific to the edge being parsed (HSON vs HTML vs JSON).
 * - Escape handling is intentionally conservative: it only recognizes backslash escapes
 *   and does not attempt to interpret `\n`, `\uXXXX`, etc.
 *
 * @param lines - Source split into lines (without their trailing newline characters).
 * @param lineIdx - Line index of the opening delimiter.
 * @param colIdx - Column index of the opening delimiter within `lines[lineIdx]`.
 * @returns The raw interior text plus the updated cursor after the closing delimiter.
 *******/
export function scan_quoted_block(
  lines: string[],
  lineIdx: number,
  colIdx: number
): { raw: string; endLine: number; endCol: number; delim: QuoteDelim } {
  const line = lines[lineIdx] ?? "";
  const opener = line[colIdx];

  // CHANGED: only support double quote blocks
  if (opener !== '"') {
    _throw_transform_err(
      `readQuotedSpan: unsupported quote delimiter (use " only) at ${lineIdx + 1}:${colIdx + 1}`,
      "tokenize_hson.readQuotedSpan"
    );
  }

  const delim: QuoteDelim = '"' as QuoteDelim;

  let i = lineIdx;
  let j = colIdx + 1;
  let raw = '"'; // CHANGED: start raw with opener (full literal contract)
  let escaped = false;

  while (i < lines.length) {
    const cur = lines[i];

    while (j < cur.length) {
      const ch = cur[j];
      if (escaped) {
        // preserve the escape sequence as authored (e.g. \" or \\ or \n)
        raw += '\\' + ch;
        escaped = false;
        j++;
        continue;
      }

      if (ch === '\\') { escaped = true; j++; continue; }

      if (ch === delim) {
        raw += '"'; // CHANGED: close JSON literal
        return { raw, endLine: i, endCol: j + 1, delim };
      }

      // CHANGED: encode literal newlines etc as JSON escapes (since this may span lines)
      if (ch === '\t') { raw += '\\t'; j++; continue; }
      if (ch === '\r') { raw += '\\r'; j++; continue; }
      if (ch === '"') { raw += '\\"'; j++; continue; } // because we normalize to JSON double quotes

      raw += ch;
      j++;
    }

    // end-of-line: preserve newline as \n in the JSON literal
    raw += '\\n';
    i++; j = 0;
  }

  _throw_transform_err("unterminated quoted string", "tokenize_hson.readQuotedSpan");
}