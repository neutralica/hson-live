// graft.tree.hson.ts

import { HsonNode } from "../../../types/node.types";
import { unwrap_root_elem } from "../../../utils/html-utils/unwrap-root-elem";
import { _throw_transform_err } from "../../../utils/sys-utils/throw-transform-err.utils";
import { parse_html } from "../../parsers/parse-html.new.transform";
import { project_livetree } from "./project-live-tree";
import { LiveTree } from "../livetree";
import { create_livetree } from "../create-livetree";


/**
 * grafts the hson model onto a DOM element, making it live and interactive
 *  - parses the element's existing HTML, rebuilds it as an HSON-managed
 *     DOM tree, and returns a queryable HsonTree instance that auto-updates
 * @param element the target HTMLElement to graft onto (default = document.body)
 * @returns a LiveTree for querying and manipulating the grafted DOM element and its children
 */
export function graft(
  element?: HTMLElement,
  options: { unsafe: boolean } = { unsafe: false }
): LiveTree {
  const targetElement = element;
  if (!targetElement) {
    _throw_transform_err("error getting target element", "graft", element);
  }

  const sourceHTML = targetElement.innerHTML;
  const rootNode: HsonNode = parse_html(sourceHTML);

  const contentNodes = unwrap_root_elem(rootNode);
  if (contentNodes.length !== 1) {
    _throw_transform_err(
      `[ERR: graft()]: expected 1 node, but received ${contentNodes.length}. Wrap multiple elements in a single container.`,
      "graft"
    );
  }

  const nodeToRender = contentNodes[0];

  // CHANGE: project exactly once into a fragment
  const frag = document.createDocumentFragment();
  frag.appendChild(project_livetree(nodeToRender));

  // CHANGE: replace DOM with the projected subtree
  targetElement.replaceChildren(frag);

  // CHANGE: return a handle ONLY (no projection here)
  return create_livetree(nodeToRender);
}