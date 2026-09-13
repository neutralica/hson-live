import type { HsonNode } from "../../core/types.js";
import { LiveTreeDisposedError } from "./livetree.error.js";
import { collect_subtree_nodes } from "./utils/subtree-traversal.js";

type DisposedNodeState = Readonly<{
  formerQuid: string | undefined;
}>;

const DISPOSED_NODE_STATE = new WeakMap<HsonNode, DisposedNodeState>();
const TERMINAL_LISTENERS = new WeakMap<HsonNode, Set<() => void>>();

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
    const listeners = TERMINAL_LISTENERS.get(node);
    if (listeners !== undefined) {
      TERMINAL_LISTENERS.delete(node);
      for (const listener of [...listeners]) listener();
    }
  }
}

/** Observe only terminal retirement of one exact canonical node. @internal */
export function observe_livetree_node_terminal(node: HsonNode, listener: () => void): () => void {
  if (is_livetree_node_disposed(node)) {
    listener();
    return () => {};
  }
  const listeners = TERMINAL_LISTENERS.get(node) ?? new Set<() => void>();
  listeners.add(listener);
  TERMINAL_LISTENERS.set(node, listeners);
  return (): void => {
    listeners.delete(listener);
    if (listeners.size === 0) TERMINAL_LISTENERS.delete(node);
  };
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
