import type { HsonNode } from "../../core/types.js";
import { LiveTreeDisposedError } from "./livetree.error.js";
import { collect_subtree_nodes } from "./utils/subtree-traversal.js";

type DisposedNodeState = Readonly<{
  formerQuid: string | undefined;
}>;

const DISPOSED_NODE_STATE = new WeakMap<HsonNode, DisposedNodeState>();

export function is_livetree_node_disposed(node: HsonNode): boolean {
  return DISPOSED_NODE_STATE.has(node);
}

export function mark_livetree_nodes_disposed(
  nodes: readonly HsonNode[],
  formerQuids?: ReadonlyMap<HsonNode, string>,
): void {
  for (const node of nodes) {
    if (DISPOSED_NODE_STATE.has(node)) continue;
    DISPOSED_NODE_STATE.set(node, {
      formerQuid: formerQuids?.get(node),
    });
  }
}

export function disposed_nodes_count_for_subtree(root: HsonNode): number {
  let count = 0;
  for (const node of collect_subtree_nodes(root, "post")) {
    if (is_livetree_node_disposed(node)) count += 1;
  }
  return count;
}

/** Central guard for the later public lifecycle rollout. */
export function assert_livetree_node_active(
  node: HsonNode,
  operation: string,
): void {
  const state = DISPOSED_NODE_STATE.get(node);
  if (!state) return;
  throw new LiveTreeDisposedError(operation, state.formerQuid);
}
