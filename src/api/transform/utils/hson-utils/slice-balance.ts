// slice-balance.ts

import { _throw_transform_err } from "../sys-utils/throw-transform-err.utils.js";
/*******
 * Extract the contents of a balanced, nested delimiter region from a string.
 *
 * Purpose:
 * - Used by tokenizers/parsers to grab the *body* of a bracketed segment
 *   (e.g. array/object-ish forms) while correctly handling:
 *   - nesting (depth),
 *   - quoted strings,
 *   - backslash escapes inside quotes,
 *   - multi-character openers/closers.
 *
 * Core semantics:
 * - Assumes the caller has already consumed the opener.
 * - `startIndex` must point to the first character *after* the opener.
 * - Scans forward until the matching `closer` that returns depth to 0.
 *
 * Quote rules:
 * - Only double quotes (`"`) are treated as string delimiters.
 * - While inside quotes:
 *   - `\"` does not terminate the quote,
 *   - `\\` toggles escape state normally,
 *   - openers/closers are ignored (they do not affect depth).
 *
 * Delimiter rules:
 * - Maintains `depth` starting at 1 (the initial opener already seen).
 * - Each opener occurrence increments depth.
 * - Each closer occurrence decrements depth.
 * - When depth reaches 0:
 *   - Returns `{ body, endIndex }` where:
 *     - `body` is the substring between `startIndex` and the closer,
 *     - `endIndex` is the index of the closer’s first character.
 *
 * Multi-character delimiter support:
 * - If `opener`/`closer` are multi-character strings, matching uses
 *   `str.startsWith(opener, ix)` / `str.startsWith(closer, ix)`, and
 *   the scan index advances by the delimiter length.
 *
 * Error behavior:
 * - If the scan reaches the end of `str` without closing (depth never returns
 *   to 0), throws a transform error indicating an unmatched opener/closer
 *   pair starting at `startIndex`.
 *
 * @param str - Source string to scan (may be a joined multi-line slice).
 * @param startIndex - Index of the first character immediately after the opener.
 * @param opener - Opening delimiter sequence (single- or multi-character).
 * @param closer - Closing delimiter sequence (single- or multi-character).
 * @returns `{ body, endIndex }` where `body` is the extracted inner text and
 *          `endIndex` is the index of the closer’s first character.
 *******/
export function slice_balanced_arr(
  str: string,
  startIndex: number,      /* index of the first char *after* the opener */
  opener: string,
  closer: string
): { body: string; endIndex: number } {
  let depth = 1;
  let ix = startIndex;
  let inQuote = false;
  let escaped = false;

  while (ix < str.length) {
    const ch = str[ix];

    if (inQuote) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inQuote = false;
      }
      ix++;
      continue;
    }

    if (ch === '"') {
      inQuote = true;
      ix++;
      continue;
    }

    /* multi-char openers/closers are supported */
    if (opener.length === 1 && ch === opener) {
      depth++; ix++; continue;
    }
    if (closer.length === 1 && ch === closer) {
      depth--; 
      if (depth === 0) {
        const body = str.slice(startIndex, ix);
        return { body, endIndex: ix };
      }
      ix++; 
      continue;
    }

    /* fallback for multi-char sequences */
    if (opener.length > 1 && str.startsWith(opener, ix)) { depth++; ix += opener.length; continue; }
    if (closer.length > 1 && str.startsWith(closer, ix)) {
      depth--;
      if (depth === 0) {
        const end = ix;
        const body = str.slice(startIndex, end);
        return { body, endIndex: end };
      }
      ix += closer.length;
      continue;
    }

    ix++;
  }

  _throw_transform_err(` unmatched ${opener}${closer} starting at ${startIndex}`, '[scan_balanced_flat]', str);
}