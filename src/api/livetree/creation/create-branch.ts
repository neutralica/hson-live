// live-tree-branch.utils.ts

import { HsonNode } from "../../../types/node.types.js";
import { unwrap_root_elem } from "../../../utils/html-utils/unwrap-root-elem.js";
import { _throw_transform_err } from "../../../utils/sys-utils/throw-transform-err.utils.js";
import { project_livetree } from "./project-live-tree.js";
import { LiveTree } from "../livetree.js";
import { create_livetree } from "./create-livetree.js";

/**
 * Normalize a parsed HSON root into a detached `LiveTree` branch.
 *
 * Structural wrapper nodes such as `_-root` and `_-elem` are unwrapped first so
 * the returned tree always points at one concrete branch root. Exactly one
 * concrete root element must remain after unwrapping.
 *
 * This is the detached-branch path used by `hson.liveTree.from*` entrypoints.
 * It does not graft into the existing live DOM.
 *
 * @param rootNode - Raw HSON root to normalize.
 * @returns A detached `LiveTree` rooted at the unwrapped concrete node.
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
  return create_livetree(actualRoot);

}
