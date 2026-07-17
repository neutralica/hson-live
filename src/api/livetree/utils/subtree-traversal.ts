import { is_Node } from "../../../core/node-guards.js";
import type { HsonNode } from "../../../core/types.js";
import { record_livetree_materialization } from "../debug/materialization-profile.js";

export type SubtreeTraversalOrder = "pre" | "post";

/**
 * Collect every HSON node in a subtree using graph structure only.
 *
 * Structural VSN nodes are included and primitive content is ignored. Child
 * order follows `$_content`, making both supported traversal orders stable.
 */
export function collect_subtree_nodes(
  root: HsonNode,
  order: SubtreeTraversalOrder = "post",
): readonly HsonNode[] {
  const nodes: HsonNode[] = [];

  const visit = (node: HsonNode): void => {
    if (order === "pre") nodes.push(node);

    for (const child of node.$_content) {
      if (is_Node(child)) visit(child);
    }

    if (order === "post") nodes.push(node);
  };

  visit(root);
  record_livetree_materialization("subtreeTraversalPasses");
  record_livetree_materialization("subtreeNodesTraversed", nodes.length);
  return nodes;
}
