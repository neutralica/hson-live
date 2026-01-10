// remove-child.ts

import { HsonQuery } from "hson-live/types";
import { is_Node } from "../../../utils/node-utils/node-guards";
import { detach_node_deep } from "../../../utils/tree-utils/detach-node";
import { parse_selector } from "../../../utils/tree-utils/parse-selector";
import { LiveTree } from "../livetree";
import { search_nodes } from "./search";

/**
 * Removes one or more *direct child nodes* from this LiveTree’s underlying
 * HSON model, and detaches their corresponding DOM subtrees and listeners.
 *
 * Behavior:
 *   • Only **direct children** of the current node are considered.
 *   • `query` may be a selector string or an `HsonQuery` object.
 *   • Matching children are:
 *       – fully detached from the DOM,
 *       – removed from `NODE_ELEMENT_MAP`,
 *       – recursively stripped of listeners and QUID scopes,
 *       – pruned from the parent node’s `_content` array.
 *   • If nothing matches, the LiveTree is left unchanged.
 *
 * Guarantees:
 *   • Does not recurse through grandchildren unless they are reached by
 *     `detach_node_deep` during teardown.
 *   • Returns `this` to allow method chaining.
 *
 * Notes:
 *   • This is a structural *mutation* of the HSON model.
 *   • The LiveTree instance remains valid after removal, still pointing
 *     to the same parent node.
 *
 * @param query  A selector string or `HsonQuery` describing which direct
 *               children should be removed.
 * @returns      The same `LiveTree` instance, after mutation.
 */
export function remove_child(
  this: LiveTree,
  query: HsonQuery | string,
): LiveTree {
  // Single-node model: there is exactly one parent.
  const parent = this.node;
  const kids = parent._content;

  if (!Array.isArray(kids) || kids.length === 0) {
    // nothing to do
    return this;
  }

  // Only node children participate in the selector search.
  const nodeKids = kids.filter(is_Node);
  if (nodeKids.length === 0) {
    return this;
  }

  const q: HsonQuery =
    typeof query === "string" ? parse_selector(query) : query;

  // Find all direct children that match.
  const toRemove = search_nodes(nodeKids, q, { findFirst: false });
  if (!toRemove.length) {
    return this;
  }

  // Deep detach each child (listeners + DOM + NODE_ELEMENT_MAP, etc.)
  for (const child of toRemove) {
    detach_node_deep(child);
  }

  // Build a new child list without the removed nodes.
  // Using a Set avoids O(n²) filter+includes.
  const removeSet = new Set(toRemove);
  const nextKids: typeof kids = [];

  for (const ch of kids) {
    if (is_Node(ch) && removeSet.has(ch)) {
      continue; // skip removed node
    }
    nextKids.push(ch);
  }

  parent._content = nextKids;

  return this;
}