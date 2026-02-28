// sanitize-html.ts

import DOMPurify from "dompurify";

/***********************************************
 * ALLOWED_TAGS
 *
 * Base allowlist of HTML tag names for DOMPurify.
 *
 * Intent:
 *   - Represent a broad but finite subset of “safe-ish”
 *     HTML5 elements that are expected in typical UI
 *     markup (text, lists, tables, basic form controls).
 *   - Anything not in this list must be explicitly added
 *     via `ADD_TAGS` in `sanitize_external`, or it will
 *     be stripped by DOMPurify.
 *
 * Notes:
 *   - All entries are lowercase to match DOMPurify’s
 *     internal normalization.
 *   - High-risk or complex tags (e.g. <svg>, media,
 *     scripting, embedding) are excluded and handled
 *     separately via `FORBID_TAGS_HARD`.
 ***********************************************/
export const ALLOWED_TAGS: string[] = [
  "a", "abbr", "address", "article", "aside", "b", "bdi", "bdo", "blockquote", "br", "button",
  "caption", "code", "col", "colgroup", "data", "dd", "del", "details", "dfn", "div", "dl", "dt",
  "em", "figcaption", "figure", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr",
  "i", "img", "input", "ins", "kbd", "label", "li", "main", "mark", "nav", "ol", "p", "picture",
  "pre", "q", "rp", "rt", "ruby", "s", "samp", "section", "small", "span", "strong", "sub", "summary",
  "sup", "table", "tbody", "td", "tfoot", "th", "thead", "time", "tr", "u", "ul", "var"
];

/***********************************************
 * ALLOWED_ATTR
 *
 * Base allowlist of HTML attributes for DOMPurify.
 *
 * Coverage:
 *   - Core identity / semantics:
 *       id, class, title, role, data-*
 *   - Accessibility:
 *       aria-label, aria-hidden, aria-expanded,
 *       aria-controls
 *   - Links and images:
 *       href, src, srcset, sizes, alt, target, rel
 *   - Performance hints:
 *       loading, decoding
 *
 * Behavior:
 *   - Attributes not in this list are removed unless
 *     DOMPurify is configured to allow them via
 *     additional options.
 *   - `data-*` is handled via `ALLOW_DATA_ATTR: true`
 *     in the sanitizer options, not by literal listing
 *     of every possible data-foo.
 ***********************************************/
export const ALLOWED_ATTR: string[] = [
  "href", "src", "srcset", "sizes", "alt", "title", "id", "class",
  "role", "aria-label", "aria-hidden", "aria-expanded", "aria-controls",
  "target", "rel", "loading", "decoding", "data-*"
];

/***********************************************
 * FORBID_TAGS_HARD
 *
 * Set of tag names that are *always* rejected by the
 * sanitizer, even if:
 *   - they appear in the HTML,
 *   - they are added to `ADD_TAGS`, or
 *   - they slip into default DOMPurify allowlists.
 *
 * Includes:
 *   - Active / executable content:
 *       script, style
 *   - Embedding / navigation primitives:
 *       iframe, object, embed, link, meta, base, form
 *   - Complex rendering surfaces:
 *       svg, math, video, audio
 *
 * Rationale:
 *   - These tags either:
 *       - can execute code,
 *       - change document-level behavior (base/meta),
 *       - or open a large security / complexity surface
 *         (SVG, MathML, media).
 *   - If you ever need a *safe subset* of these (e.g.
 *     SVG icons), introduce a dedicated, tightly
 *     constrained pipeline instead of weakening this set.
 ***********************************************/
export const FORBID_TAGS_HARD: Set<string> = new Set([
  "script", "style", "iframe", "object", "embed", "link", "meta", "base", "form",
  "svg", "math", "video", "audio" // keep blocked unless adding a strict SVG subset
]);

/***********************************************
 * ALLOWED_URI_REGEX
 *
 * URI scheme allowlist used for URL-bearing attributes
 * (href, src, srcset, etc.).
 *
 * Allowed schemes:
 *   - http:
 *   - https:
 *   - mailto:
 *   - tel:
 *   - data:image/ (images only, not arbitrary data:)
 *
 * Security:
 *   - Rejects javascript:, vbscript:, and other
 *     scriptable / dangerous schemes by default.
 *   - Used both:
 *       - directly in `set_attrs_safe`, and
 *       - indirectly via DOMPurify’s ALLOWED_URI_REGEXP.
 ***********************************************/
export const ALLOWED_URI_REGEX: RegExp =
  /^(?:https?:|mailto:|tel:|data:image\/)/i;

/***********************************************
 * discoverTags
 *
 * Discover all element tag names in a chunk of HTML
 * without attaching anything to the live DOM.
 *
 * Pipeline:
 *   1. Create a `<template>` element (inert container).
 *   2. Assign `html` to `template.innerHTML`, letting
 *      the browser parse into a DocumentFragment that
 *      is not rendered.
 *   3. Walk the fragment’s node tree and collect every
 *      element’s tagName (lowercased) into a Set.
 *
 * Guarantees:
 *   - No nodes are ever appended to `document.body`.
 *   - The returned Set includes exactly the tag names
 *     that would appear in a real parse of `html`.
 *
 * Use cases:
 *   - Drive a discovery-based allowlist for DOMPurify,
 *     e.g. to allow custom tags that appear in trusted
 *     or semi-trusted input while still enforcing a
 *     base safety policy.
 *
 * @param html  Arbitrary HTML source to inspect.
 * @returns     A Set of lowercased tag names found in
 *              the inertly parsed tree.
 ***********************************************/
function discoverTags(html: string): Set<string> {
  const tpl = document.createElement("template");
  tpl.innerHTML = html; // inert parse
  const seen = new Set<string>();
  const walk = (node: Node): void => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      seen.add((node as Element).tagName.toLowerCase());
    }
    for (let c = node.firstChild; c; c = c.nextSibling) walk(c);
  };
  walk(tpl.content);
  return seen;
}

/***********************************************
 * buildAddTags
 *
 * Compute the per-call `ADD_TAGS` list for DOMPurify
 * based on *actual* tag usage in the input HTML.
 *
 * Steps:
 *   1. Call `discoverTags(html)` to find all tag names.
 *   2. Remove any tag present in `FORBID_TAGS_HARD` to
 *      ensure the hard block is never bypassed.
 *   3. Return the remaining set as a de-duplicated array.
 *
 * Semantics:
 *   - Acts as a “soft allow” layer on top of:
 *       - `ALLOWED_TAGS` (global base allowlist), and
 *       - `FORBID_TAGS_HARD` (non-negotiable blocklist).
 *   - Lets the sanitizer be permissive for unknown but
 *     non-dangerous tags (e.g. web components, custom
 *     design-system elements) *if* they appear in the
 *     input markup.
 *
 * @param html  HTML source whose tag usage should seed
 *              the `ADD_TAGS` option.
 * @returns     A list of discovered, non-forbidden tag
 *              names suitable for DOMPurify’s ADD_TAGS.
 ***********************************************/
function buildAddTags(html: string): string[] {
  const disc = discoverTags(html);
  for (const t of Array.from(disc)) {
    if (FORBID_TAGS_HARD.has(t)) disc.delete(t);
  }
  // Union + de-dup; include known UI tags up front
  return [...new Set([...disc])];
}

/***********************************************
 * sanitize_external
 *
 * One-shot sanitization for *external / untrusted* HTML
 * using DOMPurify, augmented with:
 *   - discovery-driven tag allowlists,
 *   - hard tag forbids,
 *   - strict attribute and URL enforcement,
 *   - and minimal attribute hygiene for links.
 *
 * Tag policy:
 *   - Base allowlist: `ALLOWED_TAGS`.
 *   - Per-call additions: `ADD_TAGS = buildAddTags(html)`,
 *     derived from the actual tag usage in the HTML.
 *   - Hard blocklist: `FORBID_TAGS_HARD`, which overrides
 *     any other allow lists and is always enforced.
 *
 * Attribute policy:
 *   - `ALLOWED_ATTR` defines the base attribute allowlist.
 *   - `FORBID_ATTR: ["style", "srcdoc"]` forbids inline
 *     styles and srcdoc frames outright.
 *   - `ALLOW_DATA_ATTR: true` allows all `data-*` attributes.
 *   - A DOMPurify `uponSanitizeAttribute` hook:
 *       - Drops `style` and `srcdoc` even if seen.
 *       - Validates URL-bearing attributes (`href`, `src`,
 *         `xlink:href`, `poster`) against `ALLOWED_URI_REGEX`.
 *       - For `srcset`, rejects the whole attribute if *any*
 *         candidate URL is unsafe.
 *       - Enforces `rel="noopener noreferrer"` on links with
 *         `target="_blank"` for tab-hijack protection.
 *
 * Behavior:
 *   - Returns a new HTML string that has been:
 *       - parsed by DOMPurify,
 *       - stripped of disallowed tags/attributes/URLs,
 *       - normalized according to the above policies.
 *
 * Notes:
 *   - `KEEP_CONTENT: false` means content inside forbidden
 *     elements (e.g. <script>) is discarded with the tags.
 *   - `WHOLE_DOCUMENT: false` treats the input as a fragment
 *     rather than a full HTML document.
 *
 * @param html  Raw, potentially untrusted HTML input.
 * @returns     A sanitized HTML string suitable for safe
 *              insertion via `mount_html_safe` or similar
 *              inert-parse pipelines.
 ***********************************************/
export function sanitize_external(html: string): string {
  const ADD_TAGS = buildAddTags(html);
  DOMPurify.addHook("uponSanitizeAttribute", (node: unknown) => {
    const el = node as unknown as Element;
    const name: string = (node as any).attrName;
    const value: string = (node as any).attrValue;

    // Drop all inline styles explicitly (DOMPurify also blocks by FORBID_ATTR)
    if (name === "style") { (node as any).keepAttr = false; return; }

    // Drop srcdoc
    if (name === "srcdoc") { (node as any).keepAttr = false; return; }

    // Harden URL-bearing attributes against the allowed regex
    if (/^(href|src|xlink:href|poster)$/i.test(name)) {
      if (!ALLOWED_URI_REGEX.test(value)) { (node as any).keepAttr = false; return; }
    }

    // srcset: drop whole attribute if any candidate is unsafe
    if (/^srcset$/i.test(name)) {
      const parts = value.split(/\s*,\s*/);
      for (let i = 0; i < parts.length; i++) {
        const url = (parts[i].trim().split(/\s+/)[0] || "");
        if (!ALLOWED_URI_REGEX.test(url)) { (node as any).keepAttr = false; return; }
      }
    }

    // rel hygiene for target=_blank
    if (name === "target" && value === "_blank") {
      const current = el.getAttribute("rel") || "";
      const set = new Set(current.split(/\s+/).filter(Boolean));
      set.add("noopener"); set.add("noreferrer");
      el.setAttribute("rel", Array.from(set).join(" "));
    }
  });

  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [...ALLOWED_TAGS],
    ALLOWED_ATTR: [...ALLOWED_ATTR],
    ADD_TAGS,
    FORBID_TAGS: Array.from(FORBID_TAGS_HARD),        // ensure the hard block wins
    FORBID_ATTR: ["style", "srcdoc"],                 // remove "on*" (no globbing)
    ALLOWED_URI_REGEXP: ALLOWED_URI_REGEX,
    ALLOW_DATA_ATTR: true,                            // replaces "data-*"
    KEEP_CONTENT: false,
    WHOLE_DOCUMENT: false,
  });
}