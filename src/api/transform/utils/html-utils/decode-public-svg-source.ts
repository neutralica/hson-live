import { parseDocument } from "htmlparser2";
import { isComment, isTag, isText } from "domhandler";
import type { Element as SourceElement } from "domhandler";
import { _throw_transform_err } from "../../../../core/errors.js";
import { is_svg_markup } from "../node-utils/node-from-svg.js";

/** Native XML decoding must not add elements absent from the source. In the
 * ordinary SVG routes, element-producing entity expansion is not established
 * by lexical topology. Comparing names, nesting and order catches inserted browser
 * diagnostics without reserving any authored element name or namespace.
 */
function svg_source_elements_match(source: SourceElement, decoded: Element): boolean {
  const pending = [{ source, decoded }];
  while (pending.length !== 0) {
    const pair = pending.pop();
    if (!pair) break;
    if (pair.source.name !== pair.decoded.tagName) return false;
    const sourceChildren = pair.source.children.filter(isTag);
    const decodedChildren = Array.from(pair.decoded.childNodes)
      .filter((child): child is Element => child.nodeType === 1);
    if (sourceChildren.length !== decodedChildren.length) return false;
    for (let index = 0; index < sourceChildren.length; index++) {
      pending.push({ source: sourceChildren[index], decoded: decodedChildren[index] });
    }
  }
  return true;
}

/** Observe the entire source, allowing XML instructions before a known SVG receiver. */
function svg_source_root(raw: string): SourceElement | undefined {
  const topology = raw.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>/g,
    token => token.startsWith("<?") ? "" : token);
  const children = parseDocument(topology, { xmlMode: true, recognizeSelfClosing: true }).children
    .filter(child => isTag(child) || (isText(child) && child.data.trim() !== "")
      || (isComment(child) && child.data.startsWith("hson-text")));
  return children.length === 1 && isTag(children[0]) && children[0].name.toLowerCase() === "svg"
    ? children[0] : undefined;
}

/** Generic HTML routing retains its established SVG-prefix convention. */
export function standalone_svg_source(raw: string): SourceElement | undefined {
  return is_svg_markup(raw.trimStart()) ? svg_source_root(raw) : undefined;
}

/** Public XML source decoding: completion and independently source-owned
 * element topology must both succeed. No name is reserved for diagnostics. */
export function decode_public_svg_source(raw: string, Parser: new () => DOMParser, operation: string): Element {
  const source = svg_source_root(raw);
  let completion = "hson-svg-source-end";
  while (raw.includes(completion)) completion += "_";
  const parsed = new Parser().parseFromString(`${raw}<?${completion}?>`, "image/svg+xml");
  if (!source || parsed.lastChild?.nodeType !== 7 || parsed.lastChild.nodeName !== completion
    || parsed.documentElement?.tagName.toLowerCase() !== "svg"
    || !svg_source_elements_match(source, parsed.documentElement)) {
    return _throw_transform_err("SVG XML parsing failed", operation, raw.slice(0, 200), undefined,
      { stage: "source-decoding" });
  }
  return parsed.documentElement;
}
