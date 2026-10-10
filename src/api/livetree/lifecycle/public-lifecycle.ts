import { begin_mutation_publication } from "./mutation-publication.js";
import { content_target_for_owner, prepare_terminal_dom, capture_dom_placement, restore_dom_children } from "./mutation-dom.js";
import { collect_subtree_nodes } from "../utils/subtree-traversal.js";
import { notify_livetree_realizations_internal } from "../runtime/livetree-runtime.js";
import { qualify_owned_content } from "./mutation-qualification.js";
import { is_Node } from "../../../core/node-guards.js";
import type { HsonNode, NodeContent } from "../../../core/types.js";
import type { DetachedLiveContent, LiveTreeLifecycleResult } from "../../../types/lifecycle.types.js";
import type { LiveTree } from "../livetree.js";
import { is_livetree_node_disposed } from "../livetree-state.js";
import { dispose_node_deep } from "../utils/dispose-node.js";
import { get_el_for_node } from "../utils/node-map-helpers.js";
import { append_detached_content } from "../methods/appends.js";
import {
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
import {
  runtime_for_tree,
  type LiveTreeRuntime,
  active_subject_for_tree,
} from "../runtime/livetree-runtime.js";

type LifecycleTree = Pick<LiveTree, "node">;

export function empty_livetree_contents<TTree extends LifecycleTree>(tree: TTree): TTree {
  const owner = active_subject_for_tree(tree);
  if (delegate_document_empty_if_bound(owner)) return tree;
  qualify_owned_content(owner, [], "empty contents");
  const roots = owner.$_content.filter(is_Node);
  const element = content_target_for_owner(owner), before = element ? Array.from(element.childNodes) : [];
  const placement = capture_dom_placement(roots.flatMap(root => collect_subtree_nodes(root, "pre")));
  const endPublication = begin_mutation_publication([owner], [...placement.containers, ...(element ? [element] : [])]);
  try {
    const restore = prepare_terminal_dom(roots);
    try { element?.replaceChildren(); } catch (cause) { restore(); if (element) restore_dom_children(element, before); throw cause; }

    owner.$_content = [];
    for (const root of roots) release_node_parent(root, owner);

    for (const root of roots) {
      dispose_node_deep(root, runtime_for_tree(tree), false, true);
      release_subtree_ownership(root);
    }

  } finally { endPublication(); }
  notify_livetree_realizations_internal(runtime_for_tree(tree));
  return tree;
}

export function detach_livetree_contents<TTree extends LifecycleTree>(tree: TTree): DetachedLiveContent {
  const owner = active_subject_for_tree(tree);
  assert_document_structural_mutation_allowed(owner, "detach contents");
  qualify_owned_content(owner, [], "detach contents");
  const content = [...owner.$_content];
  const roots = content.filter(is_Node);

  const element = content_target_for_owner(owner), before = element ? Array.from(element.childNodes) : [];
  const placement = capture_dom_placement(roots.flatMap(root => collect_subtree_nodes(root, "pre")));
  const endPublication = begin_mutation_publication([owner], [...placement.containers, ...(element ? [element] : [])]);
  try {
    const restore = placement;
    try {
      element?.replaceChildren();
      for (const root of roots) unmount_node_preserving_runtime(root);
    } catch (cause) { restore(); if (element) restore_dom_children(element, before); throw cause; }
    owner.$_content = [];
    for (const root of roots) release_node_parent(root, owner);
    return make_detached_live_content(content, runtime_for_tree(tree));
  } finally { endPublication(); }
}

export function detach_livetree(tree: LiveTree): LiveTreeLifecycleResult {
  const node = active_subject_for_tree(tree);
  assert_document_structural_mutation_allowed(node, "detach branch");
  assert_not_browser_owned_root(node, "detach");

  const placement = capture_dom_placement(collect_subtree_nodes(node, "pre"));
  const endPublication = begin_mutation_publication([node], placement.containers);
  let changed: boolean;
  try {
    const wasProjected = subtree_has_connected_projection(node);
    const restore = placement;
    let wasUnmounted: boolean;
    try { wasUnmounted = unmount_node_preserving_runtime(node); } catch (cause) { restore(); throw cause; }
    const wasLinked = unlink_node_from_parent(node);

    changed = wasLinked || wasProjected || wasUnmounted;
  } finally { endPublication(); }
  if (!changed) return 0;
  tree.adoptRoots(node);
  return 1;
}

export function remove_livetree_terminal(
  node: HsonNode,
  runtime: LiveTreeRuntime,
): void {
  const delegated = delegate_document_remove_if_bound(node);
  if (delegated) return;
  assert_document_structural_mutation_allowed(node, "remove branch");
  if (is_livetree_node_disposed(node)) return;
  assert_not_browser_owned_root(node, "remove");

  const placement = capture_dom_placement(collect_subtree_nodes(node, "pre"));
  const endPublication = begin_mutation_publication([node], placement.containers);
  try {
    prepare_terminal_dom([node]);
    unlink_node_from_parent(node);
    dispose_node_deep(node, runtime, false, true);
    release_subtree_ownership(node);
  } finally { endPublication(); }
  notify_livetree_realizations_internal(runtime);
}

function make_detached_live_content(
  content: NodeContent,
  runtime: LiveTreeRuntime,
): DetachedLiveContent {
  let attached = false;

  return Object.freeze({
    length: content.length,
    get isAttached(): boolean {
      return attached;
    },
    appendTo<TTree extends LiveTree>(target: TTree): TTree {
      if (attached) throw new LiveTreeAlreadyAttachedError("append detached contents");
      append_detached_content(target, content, runtime);
      attached = true;
      if (get_el_for_node(active_subject_for_tree(target))) notify_livetree_realizations_internal(runtime);
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
