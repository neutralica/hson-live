
// create-livetree.ts

import { HsonNode } from "hson-live/types";
import { LiveTree } from "./livetree";
import { ensure_quid } from "../../quid/data-quid.quid";

// CHANGE: canonical creation for a standalone branch (no parent roots).
export function create_livetree(node: HsonNode): LiveTree {
  // CHANGE: guarantee identity exists even without DOM projection.
  ensure_quid(node);

  // CHANGE: single canonical constructor call.
  return new LiveTree(node);
}

// CHANGE: canonical wrap for “subtrees” that must inherit host roots.
export function wrap_in_tree(parent: LiveTree, node: HsonNode): LiveTree {
  // CHANGE: guarantee identity exists on returned handle.
  ensure_quid(node);

  // CHANGE: adopt the parent’s host root context.
  return new LiveTree(node).adoptRoots(parent.hostRootNode());
}