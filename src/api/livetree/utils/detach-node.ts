// detach-node.ts

import { _listeners_off_for_target } from "../managers/listener-builder.js";
import { HsonNode } from "../../../core/types.js";
import { get_el_for_node, unlinkNode } from "./node-map-helpers.js";
import { CssManager } from "../managers/css-manager.js";
import { disposables_off_for_owner } from "../managers/lifecycle-registry.js";
import { get_quid } from "../quid/data-quid.js";
import { collect_subtree_nodes } from "./subtree-traversal.js";
import {
  default_livetree_runtime,
  runtime_for_node,
  type LiveTreeRuntime,
} from "../runtime/livetree-runtime.js";

/**
 * Recursively detach an Hson node and its descendants from the live DOM.
 *
 * This is a detach operation, not an identity-destroy operation. The branch keeps
 * its Hson nodes and any claimed `quid` ownership so it can remain a valid
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
 * - This is a teardown utility for LiveTree/Hson graphs; it assumes the node may be
 *   bound to a real DOM subtree via `NODE_ELEMENT_MAP`.
 * - Listener cleanup is best-effort and scoped to the internal listener registry
 *   (`_listeners_off_for_target`). It does not affect handlers attached outside that system.
 * - The descendant sweep prevents leaks when listeners were attached below the node’s root.
 * - Safe to call on nodes that were never mounted: no-op aside from map delete.
 * - This intentionally does not call `drop_quid`; QUID release belongs to
 *   `dispose_node_deep()` and terminal lifecycle, not this projection cleanup.
 *
 * @param node - Root Hson node to detach from live DOM bindings.
 * @returns void.
 */
export function detach_node_deep(
  node: HsonNode,
  runtime: LiveTreeRuntime = runtime_for_node(node) ?? default_livetree_runtime(),
): void {
  for (const current of collect_subtree_nodes(node, "post")) {
    detach_node_runtime(current, runtime);
  }
}

function detach_node_runtime(node: HsonNode, runtime: LiveTreeRuntime): void {
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
  const quid = get_quid(node, runtime);
  if (typeof quid === "string" && quid.length) {
    CssManager.forRuntime(runtime).releaseOwnedCssForQuid(quid);
    disposables_off_for_owner(quid, runtime);
  }
  // 3) finally drop the map entry
  unlinkNode(node);
}
