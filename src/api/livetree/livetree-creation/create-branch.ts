// live-tree-branch.utils.ts

import { HsonNode } from "../../../types-consts/node.types";
import { unwrap_root_elem } from "../../../utils/html-utils/unwrap-root-elem";
import { _throw_transform_err } from "../../../utils/sys-utils/throw-transform-err.utils";
import { create_live_tree } from "./create-live-tree";
import { LiveTree } from "../livetree";

/**
 * Convert a raw HSON node into a `LiveTree` branch and eagerly construct
 * its corresponding DOM subtree.
 *
 * Behavior:
 * - Calls `unwrap_root_elem(rootNode)` to remove structural wrappers such
 *   as `_root` or `_elem`, ensuring that only a real element node is used
 *   as the branch root.
 * - If unwrapping yields no element nodes, logs a warning and falls back
 *   to using `rootNode` directly.
 * - If unwrapping yields more than one node, throws, since a `LiveTree`
 *   branch must have exactly one concrete root.
 * - For the resulting root element, calls `create_live_tree2` to build the
 *   DOM subtree and populate `NODE_ELEMENT_MAP`.
 *
 * This function makes structural VSNs invisible to callers, guaranteeing
 * that the returned `LiveTree` always references a single, concrete,
 * DOM-backed element node.
 *
 * @param rootNode - The raw HSON node to normalize into a `LiveTree` root.
 * @returns A new `LiveTree` instance rooted at the unwrapped element node.
 * @see unwrap_root_elem
 * @see create_live_tree
 * @see LiveTree
 */
export function make_branch_from_node(rootNode: HsonNode): LiveTree {
  const unwrapped = unwrap_root_elem(rootNode);
  if (unwrapped.length === 0) {
    console.warn("createBranchFromNode: nothing to unwrap; falling back to rootNode");
    unwrapped.push(rootNode);
  }
  if (unwrapped.length !== 1) {
    _throw_transform_err(
      `createBranchFromNode: expected exactly 1 root for LiveTree.asBranch(), got ${unwrapped.length}`,
      "createBranchFromNode",
    );
  }

  const actualRoot = unwrapped[0];

  create_live_tree(actualRoot);   // populate NODE_ELEMENT_MAP for real element nodes
  return new LiveTree(actualRoot);
}
