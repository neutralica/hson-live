// append-other.ts

import { HsonNode } from "../../../types/node.types.js";
import { ELEM_TAG } from "../../../consts/constants.js";
import { CREATE_NODE } from "../../../consts/factories.js";
import { unwrap_root_elem } from "../../../utils/html-utils/unwrap-root-elem.js";
import { element_for_node } from "../../../utils/tree-utils/node-map-helpers.js";
import { project_livetree } from "../creation/project-live-tree.js";
import { LiveTree } from "../livetree.js";
import { normalize_ix } from "../../../utils/json-utils/normalize-ix.js";
import { TreeSelector } from "../tree-selector.js";
import { SVG_TAGS } from "../../../consts/html-tags.js";
import { SvgTag } from "../../../types/livetree.types.js";

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
type AppendTreeLike = Pick<LiveTree, "node" | "hostRootNode" | "adoptRoots">;

export function append_branch<TTree extends AppendTreeLike>(
  this: TTree,
  branch: AppendTreeLike,
  index?: number,
): TTree {
  const targetNode = this.node;
  const srcNode = branch.node;

  if (!can_append_branch_to_tree(this, branch)) {
    throw new Error(
      `[LiveTree.append] incompatible branch scope: cannot append <${String(unwrap_root_elem(srcNode)[0]?._tag ?? "?")}> to <${String(targetNode._tag)}>`
    );
  }

  const nodesToAppend: HsonNode[] = unwrap_root_elem(srcNode);

  branch.adoptRoots(this.hostRootNode());
  appendNodes(targetNode, nodesToAppend, index);
  return this;
}

function is_svg_tag(tag: string): boolean {
  return SVG_TAGS.includes(tag as SvgTag);
}

function can_append_branch_to_tree(target: AppendTreeLike, branch: AppendTreeLike): boolean {
  const targetTag = String(target.node._tag);

  const roots = unwrap_root_elem(branch.node);
  const first = roots[0];
  if (!first) return false;

  const branchRootTag = String(first._tag);

  const targetIsSvg = is_svg_tag(targetTag);
  const branchIsSvg = is_svg_tag(branchRootTag);

  // svg target: only svg-scoped roots allowed
  if (targetIsSvg) {
    return branchIsSvg;
  }

  // html target:
  // - html roots are fine
  // - svg root is fine
  // - bare svg children are not
  if (!branchIsSvg) return true;
  return branchRootTag === "svg";
}