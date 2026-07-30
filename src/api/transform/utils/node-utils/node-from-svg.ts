// node-from-svg.ts

import { HsonMeta, HsonNode } from "../../../../core/types.js";
import {
  HSON_SYS_PREFIX,
  STR_TAG,
  HSON_META_QUID,
  HSON_META_MARKUP_PREFIX,
  HSON_META_TRANSIT_PREFIX,
} from "../../../../core/constants.js";
import { admit_hson_metadata_markup } from "../../../../core/hson-metadata.js";
import { CREATE_NODE } from "../../../../core/factories.js";
import { assert_invariants } from "../../../../core/assert-invariants.js";
import {
  assign_ingested_hson_node_quid,
  scan_ingested_hson_node_quids,
} from "../hson-utils/quid-ingress.js";
import { _throw_transform_err } from "../sys-utils/throw-transform-err.utils.js";


//  tiny helper once, reuse everywhere
/**
 * XML namespace URI for SVG elements.
 */
export const SVG_NS = "http://www.w3.org/2000/svg"; // used in project_livetree
/**
 * XML namespace URI for HTML elements.
 */
export const HTML_NS = "http://www.w3.org/1999/xhtml"; // unused
/**
 * Detect whether a string looks like an SVG fragment.
 *
 * @param s - Raw markup string to test.
 * @returns True when the string begins with an `<svg ...>` tag.
 */
export const is_svg_markup = (s: string) => /^<\s*svg[\s>]/i.test(s);

/**
 * Convert an SVG DOM `Element` subtree into an HSON node tree.
 *
 * Namespace / intent:
 * - Intended for SVG elements (namespace-aware pipelines can route here when `el.namespaceURI === SVG_NS`
 *   or when `isSvgMarkup(...)` detects `<svg ...>` input).
 * - Tag names are normalized to lowercase for stable serialization (`<viewBox>` attributes remain verbatim).
 *
 * Attribute handling:
 * - Routes `quid` through canonical protected metadata assignment.
 * - Copies every other attribute as-is into `$_attrs` (no normalization or filtering).
 * - This preserves SVG-specific casing and names like `viewBox`, `stroke-width`, and `xlink:href`.
 *
 * Child handling:
 * - Element children become nested HSON nodes via recursive conversion.
 * - Text nodes become `_hson_str` leaves with the raw text content preserved (including whitespace).
 * - Other node types (comments, processing instructions, etc.) are ignored.
 *
 * Output shape:
 * - Produces a canonical node and omits empty attribute/metadata containers.
 *
 * @param el - The root SVG `Element` to convert.
 * @returns An `HsonNode` representing `el` and its SVG subtree.
 */
export function node_from_svg(el: Element): HsonNode {
  const root = convert_svg_element(el);
  scan_ingested_hson_node_quids(root, "node_from_svg");
  assert_invariants(root, "node_from_svg");
  return root;
}

function convert_svg_element(el: Element): HsonNode {
  const tag = el.tagName; 
  const attrs: Record<string, string> = {};
  const meta: HsonMeta = {};
  let quid: string | undefined;
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes[i];
    const name = a.name;
    if (name.startsWith(HSON_META_TRANSIT_PREFIX)) {
      _throw_transform_err(
        `externally authored private HSON metadata transit name "${name}" is forbidden`,
        "node_from_svg",
      );
    }
    if (name.startsWith(HSON_META_MARKUP_PREFIX)) {
      const admission = admit_hson_metadata_markup(tag, name, a.value);
      if (!admission.valid) {
        _throw_transform_err(admission.reason, "node_from_svg");
      }
      if (admission.key === HSON_META_QUID) quid = admission.value;
      else meta[admission.key] = admission.value;
    } else {
      attrs[name] = a.value;
    }
  }
  if (quid !== undefined && tag.startsWith(HSON_SYS_PREFIX)) {
    assign_ingested_hson_node_quid(CREATE_NODE({ $_tag: tag }), quid, "node_from_svg");
  }
  const kids: HsonNode[] = [];
  el.childNodes.forEach(n => {
    if (n.nodeType === Node.ELEMENT_NODE) kids.push(convert_svg_element(n as Element));
    else if (n.nodeType === Node.TEXT_NODE && n.nodeValue) {
      kids.push(CREATE_NODE({ $_tag: STR_TAG, $_content: [n.nodeValue] }));
    }
  });
  const node = CREATE_NODE({
    $_tag: tag,
    $_attrs: attrs,
    $_meta: meta,
    $_content: kids.length ? kids : [],
  });
  if (quid !== undefined) {
    assign_ingested_hson_node_quid(node, quid, "node_from_svg");
  }
  return node;
}
