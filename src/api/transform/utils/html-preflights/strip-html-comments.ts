// strip-html-comments.ts

/**
 * Strip HTML (and ESI-style) comments from a markup string prior to XML parsing.
 *
 * Behavior:
 * - Removes all well-formed comment blocks: `<!-- ... -->`, including multiline
 *   content, using a non-greedy match.
 * - Also removes a dangling or unterminated `<!-- ...` that runs to end-of-input,
 *   which commonly appears in malformed real-world HTML.
 * - Leaves all non-comment text untouched.
 *
 * Intended use:
 * - Run early in the HTML→XML/HSON preflight pipeline to avoid confusing the XML
 *   parser with comments, especially malformed ones.
 * - Safe to compose with other preflight transforms; this function has no side
 *   effects outside comment removal.
 *
 * @param input - Raw markup string that may contain HTML comments.
 * @returns Markup string with all comments removed.
 */
export function strip_html_comments(input: string): string {
  if (!input || input.indexOf('<!--') === -1) return input;

  // 1) Remove all properly closed comments
  let out = input.replace(/<!--[\s\S]*?-->/g, '');

  // 2) Remove any leftover unterminated comment to end-of-input
  out = out.replace(/<!--[\s\S]*$/g, '');

  return out;
}
