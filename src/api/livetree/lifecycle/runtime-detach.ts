import { is_Node } from "../../../core/node-guards.js";
import type { HsonNode } from "../../../core/types.js";
import { get_el_for_node } from "../utils/node-map-helpers.js";

/**
 * Unmount a subtree without releasing its runtime projection.
 *
 * Mappings, listeners, CSS, disposables, and QUIDs remain intact. Concrete
 * mapped roots are retained off-document and may be inserted again later.
 */
export function unmount_node_preserving_runtime(root: HsonNode): boolean {
  let changed = false;

  const visit = (node: HsonNode, mappedAncestor: boolean): void => {
    const element = get_el_for_node(node);
    const nextMappedAncestor = mappedAncestor || Boolean(element);

    if (element && !mappedAncestor) {
      if (element.parentNode) {
        element.remove();
        changed = true;
      }
      return;
    }

    for (const child of node.$_content ?? []) {
      if (is_Node(child)) visit(child, nextMappedAncestor);
    }
  };

  visit(root, false);
  return changed;
}

export function subtree_has_connected_projection(root: HsonNode): boolean {
  const visit = (node: HsonNode): boolean => {
    const element = get_el_for_node(node);
    if (element?.isConnected) return true;
    return (node.$_content ?? []).some((child) => is_Node(child) && visit(child));
  };
  return visit(root);
}
