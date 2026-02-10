// expand-self-closing.ts

// TODO -- I do not want to be using a list of void tags for this if possible
// check _content.length e.g.

const voidTags = [
    'area','base','br','col','embed','hr',
    'img','input','link','meta','param',
    'source','track','wbr',
  ];

/*******
 * Normalize HTML void elements to an explicit self-closing form (`/>`).
 *
 * This rewrites opening tags for known “void” HTML elements (elements that do
 * not have closing tags) into a consistent self-closing representation:
 *
 * - `<img src="x">`   → `<img src="x" />`
 * - `<br>`            → `<br />`
 *
 * What it targets:
 * - Only tag names in `voidTags` (case-insensitive match).
 * - Only tags that are not already self-closed (i.e. not `<img .../>`).
 *
 * What it avoids:
 * - It does not touch non-void tags.
 * - It attempts to avoid rewriting tags that already have an explicit closer
 *   immediately following (e.g. `<tag ...></tag>`), though for true void tags
 *   that pattern is already “nonstandard HTML”.
 *
 * Rationale:
 * - Some downstream tokenizers/serializers (including HSON-ish pipelines) find
 *   it simpler if void elements always appear in a single, unambiguous form.
 *
 * Caveats:
 * - This is a regex-based normalizer, not a full HTML parser.
 * - The `voidTags` list is the authority; tags not listed will never be
 *   rewritten, even if they are void in some HTML dialect.
 *
 * @param $input - HTML source text to normalize.
 * @returns HTML with matching void tags rewritten as `<tag ... />`.
 *******/
// src/utils/html-utils/expand-void-tags.ts (or wherever yours lives)
export function expand_void_tags(src: string): string {
  // CHANGED: include embed + full HTML void set; keep lowercase canonical
  const VOID = new Set([
    "area", "base", "br", "col", "embed", "hr", "img", "input",
    "link", "meta", "param", "source", "track", "wbr",
  ]);

  // CHANGED: self-close <void ...> into <void ... />
  // - handles attributes
  // - handles adjacency like </object><embed ...>
  // - does NOT touch already-self-closed tags
  // - does NOT touch tags that already have an explicit closer </tag>
  return src.replace(
    /<([A-Za-z][A-Za-z0-9:_-]*)([^<>]*?)>/g,
    (m: string, tagRaw: string, rest: string) => {
      const tag = tagRaw.toLowerCase();

      // not a void tag → leave
      if (!VOID.has(tag)) return m;

      // already self-closed → leave
      if (/\s\/\s*$/.test(rest)) return m;

      // if it already has an explicit closer somewhere, do not force self-close
      // (rare for true HTML voids, but keeps this transform conservative)
      const closer = new RegExp(`</\\s*${tagRaw}\\s*>`, "i");
      if (closer.test(src)) return m;

      // CHANGED: self-close
      return `<${tagRaw}${rest} />`;
    }
  );
}