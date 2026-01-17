// empty.ts

import { is_Node } from "../../../utils/node-utils/node-guards";
import { detach_node_deep } from "../../../utils/tree-utils/detach-node";
import { element_for_node } from "../../../utils/tree-utils/node-map-helpers";
import { LiveTree } from "../livetree";

/**
 * Remove *all* children of this LiveTree’s node, both in the HSON model
 * and in the mounted DOM.
 *
 * Behavior:
 * - Iterates the current node’s `_content` list.
 * - For each child `HsonNode`, performs a full deep detach:
 *     - removes DOM elements,
 *     - unregisters listeners,
 *     - clears NODE_ELEMENT_MAP entries,
 *     - cleans up QUID scopes.
 * - After detaching, resets `_content` to an empty array.
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
export function empty_contents(this: LiveTree): LiveTree {
    const node = this.node;

    const kids = node._content;

    // 1) deep detach every child (listeners + DOM + map)
    for (const child of kids) {
        if (is_Node(child)) detach_node_deep(child);
    }

    // 2) set model content to empty
    node._content = [];

    // 3) ensure the element has no stray DOM children (paranoia; usually already gone)
    const el = element_for_node(node);
    if (el) while (el.firstChild) el.removeChild(el.firstChild);
    return this;
}

