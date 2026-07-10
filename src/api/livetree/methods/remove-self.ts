// remove-self.ts

import { drop_quid } from "../quid/data-quid.js";
import { HsonNode } from "../../../core/types.js";
import { _DATA_QUID } from "../../../core/constants.js";
import { detach_node_deep } from "../utils/detach-node.js";
import { get_el_for_node } from "../utils/node-map-helpers.js";
import { LiveTree } from "../livetree.js";
import { CssManager } from "../managers/css-manager.js";
import { is_Node } from "../../../core/node-guards.js";

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
  const rootEl = get_el_for_node(rootNode) as HTMLElement | undefined;
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

export function remove_livetree(this: LiveTree): number {
  const node = this.node;

  // idempotence should be based on graph membership, not DOM attachment.
  const root = this.hostRootNode();

  // If we have a root, we only count removal if we actually pruned it out.
  // This makes the operation idempotent even when called twice.
  const pruned = root ? pruneNodeFromRoot(root, node) : true;
  if (!pruned) return 0;

  // only clear per-quid CSS if quids exist
  const css = CssManager.invoke();
  const quids = collectQuidsForSubtree(node); // should return [] if none
  for (const q of quids) css.clearQuid(q);

  // Existing: detach listeners + DOM mappings where present (should tolerate "no DOM")
  detach_node_deep(node);

  // Existing: drop quid identity if present (should be a no-op if none)
  drop_quid(node);

  return 1;
}

/**
 * Recursively remove a specific HSON node from a root subtree.
 *
 * Algorithm:
 * - Walks the `$_content` array of `root` depth-first.
 * - For each child:
 *   - Skips non-node entries.
 *   - If the child is the `target`, removes it in-place via `splice` and
 *     returns `true`.
 *   - Otherwise, recurses into that child. If any recursive call returns
 *     `true`, bubbles that `true` up and stops further traversal.
 *
 * Characteristics:
 * - Purely structural: operates only on the `$_content` arrays; does not
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
  const content = root.$_content;
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
