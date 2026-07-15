// appends.ts

import { HsonNode, NodeContent, Primitive } from "../../../core/types.js";
import { ELEM_TAG } from "../../../core/constants.js";
import { CREATE_NODE } from "../../../core/factories.js";
import { unwrap_root_elem } from "../../transform/utils/html-utils/unwrap-root-elem.js";
import { get_el_for_node } from "../utils/node-map-helpers.js";
import { project_livetree } from "../creation/project-live-tree.js";
import { LiveTree } from "../livetree.js";
import { normalize_ix } from "../../transform/utils/json-utils/normalize-ix.js";
import { TreeSelector } from "../creation/tree-selector.js";
import { SVG_TAGS } from "../../../core/all-html-tags.js";
import { SvgTag } from "../../../types/livetree.types.js";
import { SVG_NS } from "../../transform/utils/node-utils/node-from-svg.js";
import { get_node_by_quid, get_quid } from "../quid/data-quid.js";
import { collect_subtree_nodes } from "../utils/subtree-traversal.js";
import { is_livetree_node_disposed } from "../livetree-state.js";
import {
  claim_node_parent,
  parent_for_node,
} from "../lifecycle/graph-ownership.js";
import { LiveTreeAlreadyAttachedError, LiveTreeDisposedError } from "../livetree.error.js";

/**
 * Append one or more HSON nodes into a target node's `_hson_elem` container
 * and mirror the change into the corresponding live DOM subtree.
 *
 * If the first child of `targetNode.$_content` is not an `_hson_elem` container,
 * this function will create one and insert it as the first child. All
 * appended nodes are then placed inside that container.
 *
 * When a bound live DOM element exists for `targetNode`, the same nodes
 * are rendered via `create_live_tree2` and inserted into the DOM at the
 * corresponding position, keeping HSON and DOM in sync.
 *
 * @param targetNode - The HSON node that will receive the new children.
 * @param nodesToAppend - The HSON nodes to append into the `_hson_elem` container.
 * @param index - Optional insertion index within the `_hson_elem` content.
 *                If provided, it is normalized via `normalize_ix` and
 *                used for both HSON and DOM insertion; otherwise nodes
 *                are appended to the end.
 */
function appendNodes(
  targetNode: HsonNode,
  nodesToAppend: HsonNode[],
  index?: number,
): void {
  if (!targetNode.$_content) targetNode.$_content = [];

  // find or create the `_hson_elem` container
  let containerNode: HsonNode;
  const firstChild = targetNode.$_content[0];

  if (firstChild && typeof firstChild === "object" && firstChild.$_tag === ELEM_TAG) {
    containerNode = firstChild;
  } else {
    containerNode = CREATE_NODE({ $_tag: ELEM_TAG, $_content: [] });
    targetNode.$_content = [containerNode, ...targetNode.$_content];
    claim_node_parent(containerNode, targetNode);
  }

  if (!containerNode.$_content) containerNode.$_content = [];
  const childContent = containerNode.$_content;

  // --- HSON INSERTION --------------------------------------------------
  if (typeof index === "number") {
    const insertIx = normalize_ix(index, childContent.length);
    childContent.splice(insertIx, 0, ...nodesToAppend);
  } else {
    childContent.push(...nodesToAppend);
  }
  for (const node of nodesToAppend) claim_node_parent(node, containerNode);

  // --- DOM SYNC --------------------------------------------------------
  const liveElement = get_el_for_node(targetNode);
  if (!liveElement) return;
const parentNs: "html" | "svg" =
  liveElement.namespaceURI === SVG_NS ? "svg" : "html";
  const domChildren = Array.from(liveElement.childNodes);

  if (typeof index === "number") {
    let insertIx = normalize_ix(index, domChildren.length);

    for (const newNode of nodesToAppend) {
      const dom = project_livetree(newNode, parentNs);
      const refNode = domChildren[insertIx] ?? null;
      liveElement.insertBefore(dom, refNode);
      insertIx += 1;
    }
  } else {
    for (const newNode of nodesToAppend) {
      const dom = project_livetree(newNode, parentNs);
      liveElement.appendChild(dom);
    }
  }
}

/**
 * Append a single `LiveTree` branch as children of the current `LiveTree`'s node,
 * preserving HSON → DOM linkage.
 *
 * The source branch's root `_hson_elem` wrapper is unwrapped via `unwrap_root_elem`,
 * so that only its meaningful children are appended. The source branch then
 * "adopts" the host roots from the current tree so subsequent operations
 * on the branch stay connected to the same host DOM.
 *
 * @this LiveTree
 * @param branch - The `LiveTree` branch whose node subtree will be appended.
 * @param index - Optional insertion index within the `_hson_elem` container of
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
      `[LiveTree.append] incompatible branch scope: cannot append <${String(unwrap_root_elem(srcNode)[0]?.$_tag ?? "?")}> to <${String(targetNode.$_tag)}>`
    );
  }

  const nodesToAppend: HsonNode[] = unwrap_root_elem(srcNode);

  assert_appendable_nodes(targetNode, nodesToAppend, "append branch");

  appendNodes(targetNode, nodesToAppend, index);
  branch.adoptRoots(this.hostRootNode());
  return this;
}

/** Append the exact ordered content captured by `detachContents()`. */
export function append_detached_content<TTree extends AppendTreeLike>(
  target: TTree,
  content: NodeContent,
): TTree {
  const targetNode = target.node;
  const nodes = content.filter((item): item is HsonNode => typeof item === "object" && item !== null);
  assert_appendable_nodes(targetNode, nodes, "append detached contents");

  const liveElement = get_el_for_node(targetNode);
  const parentNs: "html" | "svg" =
    liveElement?.namespaceURI === SVG_NS ? "svg" : "html";

  targetNode.$_content.push(...content);
  for (const node of nodes) claim_node_parent(node, targetNode);

  if (liveElement) {
    for (const item of content) {
      liveElement.appendChild(project_livetree(item as HsonNode | Primitive, parentNs));
    }
  }
  return target;
}

function assert_appendable_nodes(
  target: HsonNode,
  roots: readonly HsonNode[],
  operation: string,
): void {
  const targetSubtree = new Set(collect_subtree_nodes(target, "pre"));
  const localQuids = new Map<string, HsonNode>();

  for (const root of roots) {
    if (parent_for_node(root) || get_el_for_node(root)?.isConnected) {
      throw new LiveTreeAlreadyAttachedError(operation);
    }

    const subtreeNodes = collect_subtree_nodes(root, "pre");
    const subtreeSet = new Set(subtreeNodes);
    for (const node of subtreeNodes) {
      if (targetSubtree.has(node)) throw new LiveTreeAlreadyAttachedError(operation);
      const parent = parent_for_node(node);
      if ((node === root && parent) || (node !== root && parent && !subtreeSet.has(parent))) {
        throw new LiveTreeAlreadyAttachedError(operation);
      }
      if (get_el_for_node(node)?.isConnected) {
        throw new LiveTreeAlreadyAttachedError(operation);
      }
      if (is_livetree_node_disposed(node)) {
        throw new LiveTreeDisposedError(operation, get_quid(node));
      }

      const quid = get_quid(node);
      if (!quid) continue;
      const localOwner = localQuids.get(quid);
      if (localOwner && localOwner !== node) {
        throw new Error(`Duplicate QUID "${quid}" occurs within the appended subtree.`);
      }
      localQuids.set(quid, node);

      const registered = get_node_by_quid(quid);
      if (registered && registered !== node) {
        throw new Error(`Duplicate QUID "${quid}" is already registered to another node.`);
      }
    }
  }
}

function is_svg_tag(tag: string): boolean {
  return SVG_TAGS.includes(tag as SvgTag);
}

function can_append_branch_to_tree(target: AppendTreeLike, branch: AppendTreeLike): boolean {
  const targetTag = String(target.node.$_tag);

  const roots = unwrap_root_elem(branch.node);
  const first = roots[0];
  if (!first) return false;

  const branchRootTag = String(first.$_tag);

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
