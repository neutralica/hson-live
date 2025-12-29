// remove2.ts

import { drop_quid } from "../../../quid/data-quid.quid";
import { HsonNode } from "../../../types-consts/node.types";
import { _DATA_QUID } from "../../../types-consts/constants";
import { detach_node_deep } from "../../../utils/tree-utils/detach-node";
import { element_for_node } from "../../../utils/tree-utils/node-map-helpers";
import { LiveTree } from "../livetree";
import { CssManager } from "./css-manager";
import { is_Node } from "../../../utils/node-utils/node-guards";
import { HsonQuery } from "hson-live/types";
import { search_nodes } from "./search";
import { parse_selector } from "../../../utils/tree-utils/parse-selector";

/**
 * Collect QUID identifiers for the DOM subtree of a given HSON node.
 *
 * If the node is not mounted, returns an empty set. Otherwise, scans the
 * mapped DOM element and its descendants for the `_DATA_QUID` attribute.
 *
 * @param rootNode - The HSON node whose mapped DOM subtree should be scanned.
 * @returns A set of QUID strings found on the root element and descendants.
 */
function collectQuidsForSubtree(rootNode: HsonNode): Set<string> {
  const rootEl = element_for_node(rootNode) as HTMLElement | undefined;
  if (!rootEl) return new Set(); // not mounted → nothing to clear

  const elements: HTMLElement[] = [
    rootEl,
    ...Array.from(
      rootEl.querySelectorAll<HTMLElement>(`[${_DATA_QUID}]`),
    ),
  ];

  const quids = new Set<string>();
  for (const el of elements) {
    const q = el.getAttribute(_DATA_QUID);
    if (q) quids.add(q);
  }

  return quids;
}
/**
 * Detach a subtree, cleaning up CSS, DOM, and QUID state.
 *
 * @param node - The root HSON node of the subtree to detach.
 * @returns void.
 */
function detach_subtree(node: HsonNode): void {
  // 1) Clear QUID-scoped CSS for the DOM subtree (if any).
  const css = CssManager.invoke();
  const quids = collectQuidsForSubtree(node);
  for (const q of quids) css.clearQuid(q);

  // 2) Tear down subtree: listeners + DOM + NODE_ELEMENT_MAP, etc.
  detach_node_deep(node);

  // 3) Drop any QUID(s) on the root node itself (IR-side cleanup).
  drop_quid(node);
}
// remove.ts (or wherever remove_livetree lives)

/**
 * Best-effort check for whether a node is still attached/mounted.
 *
 * @param node - The HSON node to check.
 * @returns True when the node has a mapped DOM element.
 */
function is_attached(node: HsonNode): boolean {
  // CHANGED: replace this with your real invariant.
  // Common options:
  // - node._parent exists
  // - hostRoot traversal can find it (slower)
  // - nodeRef still resolves, etc.
  return element_for_node(node)!== undefined;
}

/**
 * Remove this `LiveTree`'s node from DOM and HSON, returning a count.
 *
 * @returns `1` when the node was removed, or `0` if already detached.
 */
export function remove_livetree(this: LiveTree): number {
  const node = this.node;

  // ADDED: idempotent count behavior
  if (!is_attached(node)) return 0;

  // (existing)
  const css = CssManager.invoke();
  const quids = collectQuidsForSubtree(node);
  for (const q of quids) css.clearQuid(q);

  detach_node_deep(node);
  drop_quid(node);

  const root = this.hostRootNode();
  if (root) pruneNodeFromRoot(root, node);

  // CHANGED: return count
  return 1;
}

/**
 * Remove matching direct child nodes and return how many were removed.
 *
 * @param query - Selector string or `HsonQuery` describing direct children.
 * @returns The number of removed child nodes.
 */
export function remove_child(this: LiveTree, query: HsonQuery | string): number {
  const parent = this.node;
  const kids = parent._content;
  if (!Array.isArray(kids) || kids.length === 0) return 0;

  const nodeKids = kids.filter(is_Node);
  if (nodeKids.length === 0) return 0;

  const q: HsonQuery = typeof query === "string" ? parse_selector(query) : query;
  const toRemove = search_nodes(nodeKids, q, { findFirst: false });
  if (!toRemove.length) return 0;

  // CHANGED: centralized cleanup
  for (const child of toRemove) detach_subtree(child);

  // Keep your Set-based filter (good).
  const removeSet = new Set(toRemove);
  const nextKids: typeof kids = [];
  for (const ch of kids) {
    if (is_Node(ch) && removeSet.has(ch)) continue;
    nextKids.push(ch);
  }
  parent._content = nextKids;

  return toRemove.length; // CHANGED
}
/**
 * Recursively remove a specific HSON node from a root subtree.
 *
 * Algorithm:
 * - Walks the `_content` array of `root` depth-first.
 * - For each child:
 *   - Skips non-node entries.
 *   - If the child is the `target`, removes it in-place via `splice` and
 *     returns `true`.
 *   - Otherwise, recurses into that child. If any recursive call returns
 *     `true`, bubbles that `true` up and stops further traversal.
 *
 * Characteristics:
 * - Purely structural: operates only on the `_content` arrays; does not
 *   touch DOM, QUIDs, or maps.
 * - Returns a boolean to indicate whether the target was found and removed.
 *
 * Use cases:
 * - Internal helper for `remove_self`, or any operation that needs to
 *   excise a node from an existing HSON tree while preserving relatives.
 *
 * @param root - The HSON node to search within (treated as the current
 *   subtree root).
 * @param target - The exact `HsonNode` instance to remove.
 * @returns `true` if the target was found and removed somewhere under
 *   `root`; `false` if the target does not occur in this subtree.
 */
function pruneNodeFromRoot(root: HsonNode, target: HsonNode): boolean {
  const content = root._content;
  if (!Array.isArray(content)) return false;

  for (let i = 0; i < content.length; i += 1) {
    const child = content[i];
    if (!is_Node(child)) continue;

    if (child === target) {
      content.splice(i, 1);
      return true;
    }

    if (pruneNodeFromRoot(child, target)) {
      return true;
    }
  }
  return false;
}
