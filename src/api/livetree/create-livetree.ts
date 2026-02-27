
// create-livetree.ts

import { HsonNode } from "../../types/node.types.js";
import { LiveTree } from "./livetree.js";
import { ensure_quid } from "../../quid/data-quid.quid.js";

// CHANGE: canonical creation for a standalone branch (no parent roots).
export function create_livetree(node: HsonNode): LiveTree {
  // CHANGE: guarantee identity exists even without DOM projection.
  ensure_quid(node);

  // CHANGE: single canonical constructor call.
  return new LiveTree(node);
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
  // CHANGE: guarantee identity exists on returned handle.
  ensure_quid(node);

  // CHANGE: adopt the parent’s host root context.
  return create_livetree(node).adoptRoots(parent.hostRootNode());
}