// strip-html-comments.ts

/**
 * Strip HTML (and ESI-style) comments from a markup string prior to XML parsing.
 *
 * Behavior:
 * - Removes all well-formed comment blocks: `<!-- ... -->`, including multiline
 *   content, using a non-greedy match.
 * - Also removes a dangling or unterminated `<!-- ...` that runs to end-of-input,
 *   which commonly appears in malformed real-world HTML.
 * - With `preserveHsonTextBoundaries`, retains only reserved trusted text
 *   boundary comments for explicit parser decoding.
 * - Leaves all non-comment text untouched.
 *
 * Intended use:
 * - Run early in the HTML→XML/Hson preflight pipeline to avoid confusing the XML
 *   parser with comments, especially malformed ones.
 * - Safe to compose with other preflight transforms; this function has no side
 *   effects outside comment removal.
 *
 * @param input - Raw markup string that may contain HTML comments.
 * @returns Markup string with ordinary comments removed.
 */
export function strip_html_comments(input: string, preserveHsonTextBoundaries = false): string {
  if (!input || input.indexOf('<!--') === -1) return input;

  // 1) Remove all properly closed comments
  let out = input.replace(/<!--[\s\S]*?-->/g, (comment) =>
    preserveHsonTextBoundaries && comment.startsWith("<!--hson-text")
      ? comment
      : ""
  );

  // 2) Remove only a leftover unterminated comment. Preserved transport
  // boundaries are closed comments and must reach the trusted parser.
  const dangling = out.lastIndexOf('<!--');
  if (dangling > out.lastIndexOf('-->')) out = out.slice(0, dangling);

  return out;
}
