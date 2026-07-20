import { is_Node } from "../../../core/node-guards.js";
import type { HsonNode, NodeContent } from "../../../core/types.js";
import type { DetachedLiveContent, LiveTreeLifecycleResult } from "../../../types/lifecycle.types.js";
import type { LiveTree } from "../livetree.js";
import { is_livetree_node_disposed } from "../livetree-state.js";
import { dispose_node_deep } from "../utils/dispose-node.js";
import { get_el_for_node } from "../utils/node-map-helpers.js";
import { append_detached_content } from "../methods/appends.js";
import {
  parent_for_node,
  release_node_parent,
  release_subtree_ownership,
  unlink_node_from_parent,
} from "./graph-ownership.js";
import {
  subtree_has_connected_projection,
  unmount_node_preserving_runtime,
} from "./runtime-detach.js";
import { LiveTreeAlreadyAttachedError, LiveTreeProtectedRootError } from "../livetree.error.js";
import {
  assert_document_structural_mutation_allowed,
  delegate_document_empty_if_bound,
  delegate_document_remove_if_bound,
} from "./document-binding-state.js";

type LifecycleTree = Pick<LiveTree, "node">;

export function empty_livetree_contents<TTree extends LifecycleTree>(tree: TTree): TTree {
  const owner = tree.node;
  if (delegate_document_empty_if_bound(owner)) return tree;
  const roots = owner.$_content.filter(is_Node);

  owner.$_content = [];
  for (const root of roots) release_node_parent(root, owner);

  for (const root of roots) {
    dispose_node_deep(root);
    release_subtree_ownership(root);
  }

  const element = get_el_for_node(owner);
  if (element) element.replaceChildren();
  return tree;
}

export function detach_livetree_contents<TTree extends LifecycleTree>(tree: TTree): DetachedLiveContent {
  const owner = tree.node;
  assert_document_structural_mutation_allowed(owner, "detach contents");
  const content = [...owner.$_content];
  const roots = content.filter(is_Node);

  owner.$_content = [];
  for (const root of roots) {
    release_node_parent(root, owner);
    unmount_node_preserving_runtime(root);
  }

  get_el_for_node(owner)?.replaceChildren();
  return make_detached_live_content(content);
}

export function detach_livetree(tree: LiveTree): LiveTreeLifecycleResult {
  const node = tree.node;
  assert_document_structural_mutation_allowed(node, "detach branch");
  assert_not_browser_owned_root(node, "detach");

  const wasProjected = subtree_has_connected_projection(node);
  const wasLinked = unlink_node_from_parent(node);
  const wasUnmounted = unmount_node_preserving_runtime(node);

  if (!wasLinked && !wasProjected && !wasUnmounted) return 0;
  tree.adoptRoots(node);
  return 1;
}

export function remove_livetree_terminal(
  node: HsonNode,
): LiveTreeLifecycleResult {
  const delegated = delegate_document_remove_if_bound(node);
  if (delegated !== undefined) return delegated;
  assert_document_structural_mutation_allowed(node, "remove branch");
  if (is_livetree_node_disposed(node)) return 0;
  assert_not_browser_owned_root(node, "remove");

  unlink_node_from_parent(node);
  dispose_node_deep(node);
  release_subtree_ownership(node);
  return 1;
}

function make_detached_live_content(content: NodeContent): DetachedLiveContent {
  let attached = false;

  return Object.freeze({
    length: content.length,
    get isAttached(): boolean {
      return attached;
    },
    appendTo<TTree extends LiveTree>(target: TTree): TTree {
      if (attached) throw new LiveTreeAlreadyAttachedError("append detached contents");
      append_detached_content(target, content);
      attached = true;
      return target;
    },
  });
}

function assert_not_browser_owned_root(node: HsonNode, operation: string): void {
  const element = get_el_for_node(node);
  if (!element) return;

  const document = element.ownerDocument;
  let name: string | undefined;
  if (element === document.documentElement) name = "documentElement";
  else if (element === document.head) name = "head";
  else if (element === document.body) name = "body";

  if (name) throw new LiveTreeProtectedRootError(operation, name);
}
