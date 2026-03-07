// graft.tree.hson.ts

import { HsonNode } from "../../../types/node.types.js";
import { unwrap_root_elem } from "../../../utils/html-utils/unwrap-root-elem.js";
import { _throw_transform_err } from "../../../utils/sys-utils/throw-transform-err.utils.js";
import { parse_html } from "../../parsers/parse-html.js";
import { project_livetree } from "./project-live-tree.js";
import { LiveTree } from "../livetree.js";
import { create_livetree } from "../create-livetree.js";
import { node_for_element } from "../../../utils/tree-utils/node-map-helpers.js";



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
  const frag = document.createDocumentFragment();
  frag.appendChild(project_livetree(nodeToRender));

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
  void options; // CHANGED: currently unused; keep only if you expect it soon

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