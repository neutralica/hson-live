// create-livetree.ts


// create-livetree.ts

import { HsonNode } from "../../../core/types.js";
import { LiveTree } from "../livetree.js";
import { assert_livetree_node_active } from "../livetree-state.js";
import {
  runtime_for_tree,
  type LiveTreeRuntime,
  with_linked_livetree_construction_runtime,
  with_livetree_construction_runtime,
} from "../runtime/livetree-runtime.js";

// CHANGE: canonical creation for a standalone branch (no parent roots).
export function create_livetree(node: HsonNode): LiveTree {
  assert_livetree_node_active(node, "create a LiveTree handle");
  return new LiveTree(node);
}

/** Construct a handle in one already-selected runtime. @internal */
export function create_livetree_in_runtime(
  node: HsonNode,
  runtime: LiveTreeRuntime,
): LiveTree {
  assert_livetree_node_active(node, "create a LiveTree handle");
  return with_livetree_construction_runtime(node, runtime, () => new LiveTree(node));
}

/** Construct a LiveMap-linked handle while preserving canonical QUID absence. @internal */
export function create_linked_livetree_in_runtime(
  node: HsonNode,
  runtime: LiveTreeRuntime,
): LiveTree {
  assert_livetree_node_active(node, "create a linked LiveTree handle");
  return with_linked_livetree_construction_runtime(node, runtime, () => new LiveTree(node));
}


/**
 * Wrap a raw `HsonNode` in a new `LiveTree` that inherits the caller’s host root.
 *
 * Semantics:
 * - Constructs a new `LiveTree` over `node`.
 * - Copies the parent’s `hostRoot` via `adoptRoots(parent.getHostRoots())`
 *   so the new tree participates in the same “document root” context
 *   (for removal, grafting, etc.).
 *
 * Notes:
 * - Used by search helpers (`find` / `find_all_in_tree`) to ensure that
 *   returned child trees still know which root they belong to, even
 *   though they are focused on a single node.
 *
 * @param parent - The `LiveTree` providing the host root context.
 * @param node - The raw `HsonNode` to wrap.
 * @returns A `LiveTree` bound to `node` with inherited host roots.
 */
export function wrap_in_tree(parent: LiveTree, node: HsonNode): LiveTree {
  // CHANGE: adopt the parent’s host root context.
  return create_livetree_in_runtime(node, runtime_for_tree(parent))
    .adoptRoots(parent.hostRootNode());
}
