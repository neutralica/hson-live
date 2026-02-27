// append-other.ts

import { HsonNode } from "../../../types/node.types.js";
import { ELEM_TAG } from "../../../consts/constants.js";
import { CREATE_NODE } from "../../../consts/factories.js";
import { unwrap_root_elem } from "../../../utils/html-utils/unwrap-root-elem.js";
import { element_for_node } from "../../../utils/tree-utils/node-map-helpers.js";
import { project_livetree } from "../creation/project-live-tree.js";
import { LiveTree } from "../livetree.js";
import { normalize_ix } from "./append.js";
import { TreeSelector } from "../tree-selector.js";

/**
 * Append one or more HSON nodes into a target node's `_elem` container
 * and mirror the change into the corresponding live DOM subtree.
 *
 * If the first child of `targetNode._content` is not an `_elem` container,
 * this function will create one and insert it as the first child. All
 * appended nodes are then placed inside that container.
 *
 * When a bound live DOM element exists for `targetNode`, the same nodes
 * are rendered via `create_live_tree2` and inserted into the DOM at the
 * corresponding position, keeping HSON and DOM in sync.
 *
 * @param targetNode - The HSON node that will receive the new children.
 * @param nodesToAppend - The HSON nodes to append into the `_elem` container.
 * @param index - Optional insertion index within the `_elem` content.
 *                If provided, it is normalized via `normalize_ix` and
 *                used for both HSON and DOM insertion; otherwise nodes
 *                are appended to the end.
 */
function appendNodes(
  targetNode: HsonNode,
  nodesToAppend: HsonNode[],
  index?: number,
): void {
  if (!targetNode._content) targetNode._content = [];

  // find or create the `_elem` container
  let containerNode: HsonNode;
  const firstChild = targetNode._content[0];

  if (firstChild && typeof firstChild === "object" && firstChild._tag === ELEM_TAG) {
    containerNode = firstChild;
  } else {
    containerNode = CREATE_NODE({ _tag: ELEM_TAG, _content: [] });
    targetNode._content = [containerNode, ...targetNode._content];
  }

  if (!containerNode._content) containerNode._content = [];
  const childContent = containerNode._content;

  // --- HSON INSERTION --------------------------------------------------
  if (typeof index === "number") {
    const insertIx = normalize_ix(index, childContent.length);
    childContent.splice(insertIx, 0, ...nodesToAppend);
  } else {
    childContent.push(...nodesToAppend);
  }

  // --- DOM SYNC --------------------------------------------------------
  const liveElement = element_for_node(targetNode);
  if (!liveElement) return;

  const domChildren = Array.from(liveElement.childNodes);

  if (typeof index === "number") {
    let insertIx = normalize_ix(index, domChildren.length);

    for (const newNode of nodesToAppend) {
      const dom = project_livetree(newNode); // Node | DocumentFragment
      const refNode = domChildren[insertIx] ?? null;
      liveElement.insertBefore(dom, refNode);
      insertIx += 1;
    }
  } else {
    for (const newNode of nodesToAppend) {
      const dom = project_livetree(newNode);
      liveElement.appendChild(dom);
    }
  }
}

/**
 * Append a single `LiveTree` branch as children of the current `LiveTree`'s node,
 * preserving HSON → DOM linkage.
 *
 * The source branch's root `_elem` wrapper is unwrapped via `unwrap_root_elem`,
 * so that only its meaningful children are appended. The source branch then
 * "adopts" the host roots from the current tree so subsequent operations
 * on the branch stay connected to the same host DOM.
 *
 * @this LiveTree
 * @param branch - The `LiveTree` branch whose node subtree will be appended.
 * @param index - Optional insertion index within the `_elem` container of
 *                the target node; normalized consistently with `appendNodesToTree`.
 * @returns The receiver `LiveTree` (for chaining).
 */
export function append_branch(
  this: LiveTree,
  branch: LiveTree,
  index?: number,
): LiveTree {
  const targetNode = this.node;        // throws if unbound
  const srcNode = branch.node;

  // optional safety: forbid JSON-ish VSNs if you want HTML-only subtrees
  // assert_htmlish_subtree(srcNode);

  const nodesToAppend: HsonNode[] = unwrap_root_elem(srcNode);

  // preserve host root for pruning / removal
  branch.adoptRoots(this.hostRootNode());

  appendNodes(targetNode, nodesToAppend, index);
  return this;
}

// /**
//  * Append multiple `LiveTree` branches as children of the current `LiveTree`'s node.
//  *
//  * Accepts either an explicit array of `LiveTree` instances or a `TreeSelector`
//  * that can be converted to such an array. Each branch is unwrapped via
//  * `unwrap_root_elem` to strip its root `_elem` wrapper, and its roots are
//  * re-bound to the current tree via `adoptRoots`. All resulting HSON nodes
//  * are batched and inserted through `appendNodesToTree`, which also updates
//  * the DOM.
//  *
//  * @this LiveTree
//  * @param branches - A `TreeSelector` or array of `LiveTree` branches to append.
//  * @param index - Optional insertion index within the target `_elem` container
//  *                where the combined branch nodes will be inserted.
//  * @returns The receiver `LiveTree` (for chaining).
//  */
// export function append_multi(
//   this: LiveTree,
//   branches: TreeSelector | LiveTree[],
//   index?: number,
// ): LiveTree {
//   const targetNode = this.node;

//   const branchList: LiveTree[] = Array.isArray(branches)
//     ? branches
//     : branches.toArray();

//   const nodesToAppend: HsonNode[] = [];
//   for (const b of branchList) {
//     const src = b.node;
//     nodesToAppend.push(...unwrap_root_elem(src));
//     b.adoptRoots(this.hostRootNode());
//   }

//   append_nodes(targetNode, nodesToAppend, index);
//   return this;
// }