// empty.ts

import { LiveTree } from "../livetree.js";
import { empty_livetree_contents } from "../lifecycle/public-lifecycle.js";

/**
 * Remove *all* children of this LiveTree’s node, both in the HSON model
 * and in the mounted DOM.
 *
 * Behavior:
 * - Iterates the current node’s `$_content` list.
 * - For each child `HsonNode`, performs a full deep detach:
 *     - removes DOM elements,
 *     - unregisters listeners,
 *     - clears NODE_ELEMENT_MAP entries,
 *     - cleans up QUID scopes.
 * - After detaching, resets `$_content` to an empty array.
 *
 * DOM handling:
 * - If the node is mounted, any stray DOM children are removed
 *   defensively. In practice `detach_node_deep` already clears them, but
 *   this ensures no mismatches remain between IR and DOM.
 *
 * Postcondition:
 * - The LiveTree still points at the same node, now with zero children.
 * - Further mutations (append, create, setText, etc.) operate normally.
 *
 * Notes:
 * - This differs from `remove_self`: the node remains in place,
 *   only its interior is cleared.
 */
type EmptyTreeLike = Pick<LiveTree, "node">;

export function empty_contents<TTree extends EmptyTreeLike>(this: TTree): TTree {
  return empty_livetree_contents(this);
}
