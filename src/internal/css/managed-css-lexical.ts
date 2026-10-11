/// <reference path="../../types/css-tree-browser.d.ts" />
import { ident, parse, tokenize, tokenTypes } from "css-tree/dist/csstree.esm";
import { canon_to_css_prop, normalize_css_key } from "../../api/transform/utils/attrs-utils/normalize-css.js";

/** Remove only boundary CSS whitespace tokens, never whitespace within an escape or identifier. */
export function trim_managed_css(source: string): string {
  let first = source.length, last = 0;
  tokenize(source, (type, start, end) => {
    if (type === tokenTypes.WhiteSpace) return;
    first = Math.min(first, start);
    last = end;
  });
  return source.slice(first, last);
}

/** Selector-generated keys retain CSS token contents; opaque author keys keep their existing policy. */
export function managed_css_rule_key(source: string): string {
  const css = trim_managed_css(source);
  return css.startsWith("sel:") ? css : source.trim();
}

/** Native CSS identifiers use ASCII case folding; custom names are case-sensitive. */
export function native_managed_property(source: string): string {
  const decoded = ident.decode(trim_managed_css(source));
  return ident.encode(decoded.startsWith("--") ? decoded : decoded.replace(/[A-Z]/g, c => c.toLowerCase()));
}

/** JS setter names have a separate, intentional camelCase/alias receiving boundary. */
export function structured_managed_property(source: string): string {
  return native_managed_property(canon_to_css_prop(normalize_css_key(source)));
}

/** Priority is a pair of CSS tokens, not an arbitrary string suffix. */
export function managed_css_priority(source: string): Readonly<{ value: string; important: boolean }> {
  const tokens: { type: number; start: number; end: number }[] = [];
  tokenize(source, (type, start, end) => {
    if (type !== tokenTypes.WhiteSpace && type !== tokenTypes.Comment) tokens.push({ type, start, end });
  });
  const final = tokens.at(-1), bang = tokens.at(-2);
  const important = final?.type === tokenTypes.Ident && ident.decode(source.slice(final.start, final.end)).toLowerCase() === "important"
    && bang?.type === tokenTypes.Delim && source.slice(bang.start, bang.end) === "!";
  return { value: trim_managed_css(important ? source.slice(0, bang!.start) : source), important };
}

/** Validate one structural wrapper, using the same CSS grammar as source ingress. */
export function managed_css_group_header(header: string): string {
  const text = trim_managed_css(header);
  try {
    const ast = parse(`${text}{}`, {context:"stylesheet", onParseError(error) { throw error; }});
    if (ast.type !== "StyleSheet" || ast.children.size !== 1) throw new Error("Expected one wrapper.");
    const node = ast.children.first;
    if (!node || node.type !== "Atrule" || !node.block || node.block.children.size
      || !["media", "supports", "layer", "container", "scope", "starting-style"].includes(node.name)
      || (!["layer", "starting-style"].includes(node.name) && !node.prelude)) throw new Error("Unsupported wrapper.");
  } catch { throw new TypeError("Invalid stylesheet group header."); }
  return text;
}
