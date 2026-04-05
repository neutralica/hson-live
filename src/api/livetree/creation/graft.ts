// graft.tree.hson.ts

import { HsonNode } from "../../../types/node.types.js";
import { unwrap_root_elem } from "../../../utils/html-utils/unwrap-root-elem.js";
import { _throw_transform_err } from "../../../utils/sys-utils/throw-transform-err.utils.js";
import { parse_html } from "../../parsers/parse-html.js";
import { project_livetree } from "./project-live-tree.js";
import { LiveTree } from "../livetree.js";
import { create_livetree } from "../create-livetree.js";
import { linkNodeToElement, node_for_element } from "../../../utils/tree-utils/node-map-helpers.js";
import { _DATA_QUID, ensure_quid } from "../../../quid/data-quid.quid.js";
import { set_attrs_safe } from "../../../safety/safe-mount.safe.js";
import { Primitive } from "../../../types/core.types.js";
import { canon_to_css_prop, normalize_css_key } from "../../../utils/attrs-utils/normalize-css.js";
import { SVG_NS } from "../../../utils/node-utils/node-from-svg.js";



/**
 * Project a known HSON node into an existing DOM element and return a LiveTree
 * handle for that node.
 *
 * This is the real endpoint used by graft().
 */
function graft_node_into_element(
  element: HTMLElement,
  nodeToRender: HsonNode,
): LiveTree {
  linkNodeToElement(nodeToRender, element);
  const parentNs: "html" | "svg" =
    element.namespaceURI === SVG_NS ? "svg" : "html";

  // reflect attrs from root node onto existing host element
  sync_root_attrs_to_element(nodeToRender, element);

  const frag = document.createDocumentFragment();
  for (const child of nodeToRender._content ?? []) {
    frag.appendChild(project_livetree(child as HsonNode | Primitive, parentNs));
  }

  element.replaceChildren(frag);

  return create_livetree(nodeToRender);
}

/**
 * Graft an existing DOM element into HSON/LiveTree.
 *
 * Semantics:
 * - parses the element itself (not its innerHTML string)
 * - unwraps parser-only structural wrappers (_root / _elem)
 * - requires exactly one real root node
 * - re-projects that node into the same DOM element
 * - returns a LiveTree handle for that element-node
 */
export function graft(
  element?: HTMLElement,
  options: { unsafe: boolean } = { unsafe: false },
): LiveTree {
  void options; // currently unused; keep only if you expect it soon

  const targetElement = element;
  if (!targetElement) {
    _throw_transform_err("error getting target element", "graft", element);
  }

  const parsedRoot: HsonNode = parse_html(targetElement);
  const contentNodes = unwrap_root_elem(parsedRoot);

  if (contentNodes.length !== 1) {
    _throw_transform_err(
      `[ERR: graft()]: expected 1 node, but received ${contentNodes.length}. Wrap multiple elements in a single container.`,
      "graft",
    );
  }

  const nodeToRender = contentNodes[0];
  if (!nodeToRender) {
    _throw_transform_err(
      `[ERR: graft()]: unwrap_root_elem() returned no renderable node.`,
      "graft",
    );
  }
  const existingNode = node_for_element(targetElement);
  if (existingNode) {
    return create_livetree(existingNode);
  }

  return graft_node_into_element(targetElement, nodeToRender);
}

/**
 * Legacy compatibility alias.
 *
 * Body is no longer treated specially here; it is grafted with the same
 * semantics as any other queried element.
 */
export function graft_body(
  element: HTMLElement,
  options: { unsafe: boolean } = { unsafe: false },
): LiveTree {
  return graft(element, options);
}

function sync_root_attrs_to_element(node: HsonNode, el: HTMLElement): void {
  const quid = ensure_quid(node);
  set_attrs_safe(el, _DATA_QUID, quid);

  const attrs = node._attrs ?? {};

  // optional but recommended: clear stale attrs first,
  // except things you explicitly preserve
  for (const name of el.getAttributeNames()) {
    if (name === _DATA_QUID) continue;
    if (!(name in attrs)) {
      el.removeAttribute(name);
    }
  }

  for (const [key, raw] of Object.entries(attrs)) {
    if (raw == null) {
      el.removeAttribute(key);
      continue;
    }

    if (key === "style") {
      if (typeof raw === "string") {
        el.style.cssText = raw;
      } else if (raw && typeof raw === "object") {
        // clear then rebuild
        el.removeAttribute("style");

        const obj = raw as Record<string, string | number | null>;
        for (const [prop, v] of Object.entries(obj)) {
          const val = v == null ? "" : String(v);
          const cssProp = canon_to_css_prop(normalize_css_key(prop));
          if (!cssProp) continue;
          if (val === "") el.style.removeProperty(cssProp);
          else el.style.setProperty(cssProp, val);
        }
      }
      continue;
    }

    if (raw === true) {
      set_attrs_safe(el, key, "");
      continue;
    }

    if (raw === false) {
      el.removeAttribute(key);
      continue;
    }

    set_attrs_safe(el, key, String(raw));
  }
}
