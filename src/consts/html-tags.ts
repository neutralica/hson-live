// html-tags.ts

/**
 * Supported HTML tag names for the built-in `tree.create.<tag>()` sugar.
 *
 * These tags are chosen to keep the helper small, predictable, and in line
 * with the subset of structural elements LiveTree tends to operate on.
 *
 * Canonical list backing the dot-sugar creation functions on
 * `LiveTreeCreateHelper`.
 *
 * Each entry corresponds to a method added to the helper at runtime
 * (e.g., `helper.div()`, `helper.span()`, etc.).
 */
export const HTML_TAGS = [
  // Document metadata
  "html",
  "head",
  "title",
  "base",
  "link",
  "meta",
  "style",

  // Sectioning
  "body",
  "header",
  "nav",
  "main",
  "section",
  "article",
  "aside",
  "footer",
  "address",

  // Headings
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",

  // Grouping content
  "p",
  "hr",
  "pre",
  "blockquote",
  "ol",
  "ul",
  "li",
  "dl",
  "dt",
  "dd",
  "figure",
  "figcaption",
  "div",

  // Text-level semantics
  "a",
  "em",
  "strong",
  "small",
  "s",
  "cite",
  "q",
  "dfn",
  "abbr",
  "data",
  "time",
  "code",
  "var",
  "samp",
  "kbd",
  "sub",
  "sup",
  "i",
  "b",
  "u",
  "mark",
  "ruby",
  "rt",
  "rp",
  "bdi",
  "bdo",
  "span",
  "br",
  "wbr",

  // Edits
  "ins",
  "del",

  // Embedded content
  "img",
  "iframe",
  "embed",
  "object",
  "param",
  "video",
  "audio",
  "source",
  "track",
  "picture",

  // Tables
  "table",
  "caption",
  "colgroup",
  "col",
  "tbody",
  "thead",
  "tfoot",
  "tr",
  "td",
  "th",

  // Forms
  "form",
  "label",
  "input",
  "button",
  "select",
  "datalist",
  "optgroup",
  "option",
  "textarea",
  "output",
  "progress",
  "meter",
  "fieldset",
  "legend",

  // Interactive
  "details",
  "summary",
  "dialog",

  // Scripting
  "script",
  "noscript",
  "template",
  "canvas",

  // Obsolete / legacy (kept for tolerance)
  "menu",
  "menuitem",
  "center",
  "font",
] as const;