// detach-node.ts

import { _listeners_off_for_target, listeners_off_for_owner_quid } from "../managers/listener-builder.js";
import { HsonNode } from "../../../core/types.js";
import { is_Node } from "../../../core/node-guards.js";
import { get_el_for_node, unlinkNode } from "./node-map-helpers.js";
import { CssManager } from "../managers/css-manager.js";
import { disposables_off_for_owner } from "../managers/lifecycle-registry.js";

type NodeWithKids = { $_content?: unknown[] };

/**
 * Recursively detach an HSON node and its descendants from the live DOM.
 *
 * This is a detach operation, not an identity-destroy operation. The branch keeps
 * its HSON nodes and any claimed `data-_quid` ownership so it can remain a valid
 * unmounted branch and may be grafted again later.
 *
 * Walk order:
 * 1) Recurses through `$_content` first, detaching child nodes before the parent.
 * 2) For each node, resolves its bound DOM element (if any) and:
 *    - removes all listeners registered via the listener system for that element,
 *    - removes all listeners for every DOM descendant of that element (defensive cleanup),
 *    - removes the element from its parent DOM node.
 * 3) Releases runtime side effects owned by the node QUID, such as scoped CSS,
 *    listener-owner registrations, and lifecycle disposables.
 * 4) Deletes the node→element association from `NODE_ELEMENT_MAP`.
 *
 * Notes:
 * - This is a teardown utility for LiveTree/HSON graphs; it assumes the node may be
 *   bound to a real DOM subtree via `NODE_ELEMENT_MAP`.
 * - Listener cleanup is best-effort and scoped to the internal listener registry
 *   (`_listeners_off_for_target`). It does not affect handlers attached outside that system.
 * - The descendant sweep prevents leaks when listeners were attached below the node’s root.
 * - Safe to call on nodes that were never mounted: no-op aside from map delete.
 * - This intentionally does not call `drop_quid`; QUID release belongs to a future
 *   explicit dispose/destroy path, not normal DOM detachment.
 *
 * @param node - Root HSON node to detach from live DOM bindings.
 * @returns void.
 */
export function detach_node_deep(node: HsonNode): void {
  // 1) recurse first so children go away before parent
  const kids = (node as NodeWithKids).$_content;
  if (Array.isArray(kids) && kids.length) {
    for (const child of kids) {
      if (is_Node(child)) detach_node_deep(child);
    }
  }

  // 2) drop listeners and element for this node
  const el = get_el_for_node(node);
  if (el) {
    _listeners_off_for_target(el);
    const iter = el.querySelectorAll("*");
    for (let i = 0; i < iter.length; i++) {
      _listeners_off_for_target(iter[i] as unknown as EventTarget);
    }
    el.remove();
  }

  // Clear runtime artifacts owned by this node QUID, but keep QUID ownership.
  const quid = (node as any)?.$_meta?.["data-_quid"];
  if (typeof quid === "string" && quid.length) {
    CssManager.invoke().releaseOwnedCssForQuid(quid);
    listeners_off_for_owner_quid(quid);
    disposables_off_for_owner(quid);
  }
  // 3) finally drop the map entry
  unlinkNode(node);
}
