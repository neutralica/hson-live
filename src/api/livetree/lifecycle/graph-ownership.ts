import { is_Node } from "../../../core/node-guards.js";
import type { HsonNode } from "../../../core/types.js";
import { collect_subtree_nodes } from "../utils/subtree-traversal.js";
import { record_livetree_materialization } from "../debug/materialization-profile.js";

const PARENT_FOR_NODE = new WeakMap<HsonNode, HsonNode>();

/** Index parentage already expressed by an HSON subtree. */
export function index_subtree_ownership(root: HsonNode): void {
  const nodes = collect_subtree_nodes(root, "pre");
  record_livetree_materialization("ownershipIndexPasses");
  record_livetree_materialization("ownershipNodesIndexed", nodes.length);
  for (const owner of nodes) {
    for (const child of owner.$_content ?? []) {
      if (!is_Node(child)) continue;
      const existing = PARENT_FOR_NODE.get(child);
      if (!existing || existing === owner) PARENT_FOR_NODE.set(child, owner);
    }
  }
}

export function parent_for_node(node: HsonNode): HsonNode | undefined {
  return PARENT_FOR_NODE.get(node);
}

export function claim_node_parent(node: HsonNode, parent: HsonNode): void {
  PARENT_FOR_NODE.set(node, parent);
}

export function release_node_parent(node: HsonNode, parent?: HsonNode): void {
  if (parent && PARENT_FOR_NODE.get(node) !== parent) return;
  PARENT_FOR_NODE.delete(node);
}

export function release_subtree_ownership(root: HsonNode): void {
  for (const node of collect_subtree_nodes(root, "post")) {
    PARENT_FOR_NODE.delete(node);
  }
}

/** Unlink one exact node from its indexed graph parent. */
export function unlink_node_from_parent(node: HsonNode): boolean {
  const parent = PARENT_FOR_NODE.get(node);
  if (!parent) return false;

  const index = parent.$_content.findIndex((item) => item === node);
  if (index < 0) {
    PARENT_FOR_NODE.delete(node);
    return false;
  }

  parent.$_content.splice(index, 1);
  PARENT_FOR_NODE.delete(node);
  return true;
}
