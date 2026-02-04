// detach-node.ts

import { _listeners_off_for_target } from "../../api/livetree/managers/listener-builder";
import { HsonNode } from "../../types/node.types";
import { NODE_ELEMENT_MAP } from "../../consts/constants";
import { is_Node } from "../node-utils/node-guards";
import { element_for_node } from "./node-map-helpers";



type NodeWithKids = { _content?: unknown[] };

/**
 * Recursively detach an HSON node and its descendants from the live DOM.
 *
 * Walk order:
 * 1) Recurses through `_content` first, detaching child nodes before the parent.
 * 2) For each node, resolves its bound DOM element (if any) and:
 *    - removes all listeners registered via the listener system for that element,
 *    - removes all listeners for every DOM descendant of that element (defensive cleanup),
 *    - removes the element from the document.
 * 3) Deletes the node→element association from `NODE_ELEMENT_MAP`.
 *
 * Notes:
 * - This is a teardown utility for LiveTree/HSON graphs; it assumes the node may be
 *   bound to a real DOM subtree via `NODE_ELEMENT_MAP`.
 * - Listener cleanup is best-effort and scoped to the internal listener registry
 *   (`_listeners_off_for_target`). It does not affect handlers attached outside that system.
 * - The descendant sweep prevents leaks when listeners were attached below the node’s root.
 * - Safe to call on nodes that were never mounted: no-op aside from map delete.
 *
 * @param node - Root HSON node to detach (deep).
 * @returns void.
 */
export function detach_node_deep(node: HsonNode): void {
  // 1) recurse first so children go away before parent
  const kids = (node as NodeWithKids)._content;
  if (Array.isArray(kids) && kids.length) {
    for (const child of kids) {
      if (is_Node(child)) detach_node_deep(child);
    }
  }

  // 2) drop listeners and element for this node
  const el = element_for_node(node);
  if (el) {
    _listeners_off_for_target(el);   // ← kill all listeners bound via builder
    // also drop listeners on all DOM descendants in case something attached there
    // (cheap DOM walk; safe even if builder didn’t attach anything below)
    const iter = el.querySelectorAll("*");
    for (let i = 0; i < iter.length; i++) {
      _listeners_off_for_target(iter[i] as unknown as EventTarget);
    }
    el.remove();
  }

  // 3) finally drop the map entry
  NODE_ELEMENT_MAP.delete(node);
}
