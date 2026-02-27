// safe-mount.ts
import {  ALLOWED_URI_REGEX, sanitize_external } from "./sanitize-html.utils.js";

const DANGEROUS_TAGS = new Set([
  "script", "style", "iframe", "object", "embed", "link", "meta", "base",
  "form", "input", "video", "audio"
]);

/***********************************************
 * mount_html_safe
 *
 * Safely mount untrusted HTML into a target element.
 *
 * Pipeline:
 *   1. Runs the raw HTML through `sanitize_external`, which:
 *        - parses via DOMPurify (or equivalent),
 *        - strips disallowed tags/attrs/URLs,
 *        - returns a trusted HTML string.
 *   2. Parses the sanitized string via a `<template>` element,
 *      so the markup is built in an inert DOM fragment.
 *   3. Appends the template’s `content` into `into` using a
 *      single `appendChild` call – no `innerHTML` on live nodes.
 *
 * Guarantees:
 *   - Never touches `into.innerHTML` directly.
 *   - Only sanitized, inert-parsed nodes are adopted into
 *     the live document.
 *
 * Limitations:
 *   - Relies entirely on `sanitize_external` to define what
 *     is allowed; “safe” here means “safe according to that
 *     sanitizer’s policy”.
 *
 * @param rawHtml  Arbitrary HTML source (potentially untrusted).
 * @param into     Host element that will receive the sanitized
 *                 DOM subtree as children.
 ***********************************************/
export function mount_html_safe(rawHtml: string, into: HTMLElement): void {
  const cleanHtml = sanitize_external(rawHtml); // discover → allow → sanitize
  const t = document.createElement("template");
  t.innerHTML = cleanHtml;          // inert parse
  into.appendChild(t.content);      // single adopt, no innerHTML writes
}

// safety/set-attr-safe.ts
const FORBID_ATTR = new Set(["style"]); // keep this strict for now
const URL_ATTR = new Set(["href", "src", "srcset", "sizes"]);

/***********************************************
 * set_attrs_safe
 *
 * Safely set an attribute on an existing element, with
 * aggressive blocking of dangerous names and URL payloads.
 *
 * Rules:
 *   - Hard-block:
 *       - Any attribute whose lowercase name starts with "on"
 *         (e.g. `onclick`, `onload`).
 *       - The `style` attribute (inline style injection).
 *   - URL attributes (`href`, `src`, `srcset`, `sizes`):
 *       - Extract each URL (handling `srcset`’s comma-separated
 *         list, reading only the URL token per item).
 *       - If any URL fails `ALLOWED_URI_REGEX`, the *entire*
 *         write is rejected.
 *   - For anchors with `target="_blank"`:
 *       - Ensures `rel` includes both `noopener` and `noreferrer`
 *         to avoid opener-based tab hijacking.
 *   - All other attributes are set verbatim via `el.setAttribute`.
 *
 * Notes:
 *   - This is a *write* guard only; it does not sanitize existing
 *     markup, only future attribute writes.
 *   - The URL policy is conservative: one bad URL cancels the
 *     whole attribute write.
 *
 * @param el     Target DOM Element.
 * @param name   Attribute name (case preserved on output, but
 *               normalized to lowercase for checks).
 * @param value  Attribute value to write.
 ***********************************************/
export function set_attrs_safe(el: Element, name: string, value: string): void {
  const n = name.toLowerCase();

  // Block event handlers and style entirely
  if (n.startsWith("on") || FORBID_ATTR.has(n)) return;

  if (URL_ATTR.has(n)) {
    // conservative srcset split
    const items = n === "srcset"
      ? value.split(",").map(p => (p.trim().split(/\s+/)[0] ?? ""))
      : [value.trim()];
    for (const url of items) {
      if (url && !ALLOWED_URI_REGEX.test(url)) return; // reject whole write
    }
    // extra: normalize rel for target=_blank links
    if (n === "href" && (el as HTMLAnchorElement).target === "_blank") {
      const a = el as HTMLAnchorElement;
      const rel = (a.rel || "").split(/\s+/);
      if (!rel.includes("noopener")) rel.push("noopener");
      if (!rel.includes("noreferrer")) rel.push("noreferrer");
      a.rel = rel.join(" ").trim();
    }
  }

  el.setAttribute(name, value);
}

/***********************************************
 * create_el_safe
 *
 * Create a DOM element while preventing direct instantiation
 * of high-risk HTML tags.
 *
 * Behavior:
 *   - If `tagName` is considered dangerous (case-insensitive):
 *       script, style, iframe, object, embed, link, meta, base,
 *       form, input, video, audio
 *     then:
 *       - Creates a literal `<_tag>` element instead.
 *       - Stores the original requested tag name in a `name`
 *         attribute via `set_attrs_safe`, so callers can later:
 *           - inspect or log the intent,
 *           - render a safe placeholder,
 *           - or transform via a controlled path.
 *   - Otherwise:
 *       - Returns `document.createElement(tagName)` as-is.
 *
 * Intent:
 *   - Enforce a “no dangerous element constructors” rule in
 *     the parsing pipeline.
 *   - Keep a reversible trace of the original tag choice
 *     without exposing the browser to its native behavior.
 *
 * @param tagName  The requested HTML tag name.
 * @returns        A safe HTMLElement, either the requested tag
 *                 or a neutral `<_tag name="original">` wrapper.
 ***********************************************/
export function create_el_safe(tagName: string): HTMLElement {
  const t = tagName.toLowerCase();
  if (DANGEROUS_TAGS.has(t)) {
    const el = document.createElement("_tag");
    set_attrs_safe(el, "name", tagName); // encode original
    return el;
  }
  return document.createElement(tagName);
}

