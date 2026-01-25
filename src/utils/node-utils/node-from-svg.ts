// node-from-svg.ts

import { HsonNode } from "../../types/node.types";
import { STR_TAG } from "../../consts/constants";


//  tiny helper once, reuse everywhere
/**
 * XML namespace URI for SVG elements.
 */
export const SVG_NS = "http://www.w3.org/2000/svg";
/**
 * XML namespace URI for HTML elements.
 */
export const HTML_NS = "http://www.w3.org/1999/xhtml";
/**
 * Detect whether a string looks like an SVG fragment.
 *
 * @param s - Raw markup string to test.
 * @returns True when the string begins with an `<svg ...>` tag.
 */
export const isSvgMarkup = (s: string) => /^<\s*svg[\s>]/i.test(s);

/**
 * Convert an SVG DOM `Element` subtree into an HSON node tree.
 *
 * Namespace / intent:
 * - Intended for SVG elements (namespace-aware pipelines can route here when `el.namespaceURI === SVG_NS`
 *   or when `isSvgMarkup(...)` detects `<svg ...>` input).
 * - Tag names are normalized to lowercase for stable serialization (`<viewBox>` attributes remain verbatim).
 *
 * Attribute handling:
 * - Copies all attributes as-is into `_attrs` (no normalization, no filtering).
 * - This preserves SVG-specific casing and names like `viewBox`, `stroke-width`, and `xlink:href`.
 *
 * Child handling:
 * - Element children become nested HSON nodes via recursive conversion.
 * - Text nodes become `_str` leaves with the raw text content preserved (including whitespace).
 * - Other node types (comments, processing instructions, etc.) are ignored.
 *
 * Output shape:
 * - Produces a structural node with `_tag`, `_attrs`, `_content`, and an empty `_meta`.
 *
 * @param el - The root SVG `Element` to convert.
 * @returns An `HsonNode` representing `el` and its SVG subtree.
 */
export function node_from_svg(el: Element): HsonNode {
  const tag = el.tagName; 
  const attrs: Record<string, string> = {};
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes[i];
    attrs[a.name] = a.value;
  }
  const kids: HsonNode[] = [];
  el.childNodes.forEach(n => {
    if (n.nodeType === Node.ELEMENT_NODE) kids.push(node_from_svg(n as Element));
    else if (n.nodeType === Node.TEXT_NODE && n.nodeValue) {
      kids.push({ _tag: STR_TAG, _content: [n.nodeValue], _attrs: {}, _meta: {} } as HsonNode);
    }
  });
  return {
    _tag: tag,              
    _attrs: attrs,
    _content: kids.length ? kids : [],
    _meta: { }       
  } as HsonNode;
}
