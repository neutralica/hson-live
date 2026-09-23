import { ROOT_TAG } from "../../core/constants.js";
import { clone_node } from "../../core/clone-node.js";
import { is_ordinary_element_node } from "../../core/node-guards.js";
import type { HsonNode } from "../../core/types.js";
import { create_linked_livetree_in_runtime } from "../livetree/creation/create-livetree.js";
import type { LiveTree } from "../livetree/livetree.js";
import { is_livetree_node_disposed, observe_livetree_node_terminal } from "../livetree/livetree-state.js";
import { release_subtree_ownership } from "../livetree/lifecycle/graph-ownership.js";
import { preflight_livetree_quid_graph } from "../livetree/quid/data-quid.js";
import { forget_inherited_dom_quid, record_inherited_dom_quid } from "../livetree/quid/inherited-dom-quid.js";
import {
  bind_graph_runtime,
  claim_runtime_document_silently,
  default_livetree_runtime,
  release_nodes_runtime,
  runtime_for_tree,
  runtime_owns_document,
  type LiveTreeRuntime,
  type SilentRuntimeDocumentClaim,
} from "../livetree/runtime/livetree-runtime.js";
import { collect_subtree_nodes } from "../livetree/utils/subtree-traversal.js";
import {
  get_dom_for_node,
  get_el_for_node,
  get_node_for_dom,
  get_node_for_el,
  link_node_to_dom,
  link_node_to_el,
  unlinkNode,
} from "../livetree/utils/node-map-helpers.js";
import {
  assert_browser_realization_mappings,
  browser_parent_namespace_for_target,
  match_browser_realization_root,
} from "../../internal/browser-realization/browser-realization-dom.js";
import { plan_browser_realization } from "../../internal/browser-realization/browser-realization-plan.js";

export type ExactDocumentAdoption = Readonly<{
  tree: LiveTree;
  commit: () => void;
  abort: () => void;
  activateRuntimeManagers: () => void;
}>;

type AdoptionFaultPoint = "after-first-link" | "after-links" | "after-runtime" | "after-tree";
let adoptionFaultHook: ((point: AdoptionFaultPoint) => void) | undefined;

/** @internal Deterministic transaction fault seam; never exported by a package entrypoint. */
export function set_document_adoption_fault_hook_for_tests(
  hook: ((point: AdoptionFaultPoint) => void) | undefined,
): void {
  adoptionFaultHook = hook;
}

type AdoptedRootEntry = {
  readonly tree: LiveTree;
  readonly inheritedElements: readonly Element[];
  stopTerminalObservation: () => void;
};

const ADOPTED_ROOTS = new WeakMap<Element, AdoptedRootEntry>();

function evict_adopted_root(target: Element, entry: AdoptedRootEntry): void {
  if (ADOPTED_ROOTS.get(target) !== entry) return;
  ADOPTED_ROOTS.delete(target);
  entry.stopTerminalObservation();
  for (const element of entry.inheritedElements) forget_inherited_dom_quid(element);
}

function reusable_cached_tree(target: Element, canonicalRoot: HsonNode): LiveTree | undefined {
  const entry = ADOPTED_ROOTS.get(target);
  if (entry === undefined) return undefined;
  const tree = entry.tree;
  const runtime = runtime_for_tree(tree);
  try {
    if (is_livetree_node_disposed(tree.node) || runtime.disposed) throw new Error("Cached tree is terminal.");
    if (get_el_for_node(tree.node) !== target || get_node_for_el(target) !== tree.node) {
      throw new Error("Cached root mapping is stale.");
    }
    if (!runtime_owns_document(runtime, target.ownerDocument)) throw new Error("Cached runtime document ownership is stale.");
    const plan = plan_browser_realization(tree.node, {
      parentNamespace: browser_parent_namespace_for_target(target, tree.node.$_tag),
    });
    const match = match_browser_realization_root(plan, target, { allowRuntimeInfrastructure: true });
    assert_browser_realization_mappings(match);
    const canonicalOrdinaryRoot = canonicalRoot.$_tag === ROOT_TAG
      && canonicalRoot.$_content.length === 1
      && is_ordinary_element_node(canonicalRoot.$_content[0])
      ? canonicalRoot.$_content[0]
      : undefined;
    if (canonicalOrdinaryRoot === undefined) throw new Error("Cached continuation input has no ordinary canonical root.");
    const canonicalPlan = plan_browser_realization(canonicalRoot, {
      parentNamespace: browser_parent_namespace_for_target(target, canonicalOrdinaryRoot.$_tag),
    });
    match_browser_realization_root(canonicalPlan, target, { allowRuntimeInfrastructure: true });
    return tree;
  } catch {
    evict_adopted_root(target, entry);
    return undefined;
  }
}

function cleanup_new_adoption(
  root: HsonNode,
  linkedNodes: readonly HsonNode[],
  inheritedElements: readonly Element[],
  runtime: LiveTreeRuntime,
  claim: SilentRuntimeDocumentClaim,
): void {
  for (const element of inheritedElements) forget_inherited_dom_quid(element);
  for (const node of [...linkedNodes].reverse()) unlinkNode(node);
  for (const node of collect_subtree_nodes(root, "post")) {
    const quid = runtime.nodeToQuid.get(node);
    if (quid !== undefined) {
      if (runtime.quidToNode.get(quid) === node) runtime.quidToNode.delete(quid);
      runtime.nodeToQuid.delete(node);
      runtime.issuedQuids.delete(quid);
    }
  }
  release_nodes_runtime(collect_subtree_nodes(root, "post"), runtime);
  release_subtree_ownership(root);
  claim.rollback();
}

/** Exact, no-write admission of one canonical document root into existing DOM. @internal */
export function adopt_exact_existing_document(
  canonicalDocumentRoot: HsonNode,
  target: Element,
): ExactDocumentAdoption {
  const priorTree = reusable_cached_tree(target, canonicalDocumentRoot);
  if (priorTree !== undefined) {
    return Object.freeze({
      tree: priorTree,
      commit: () => {},
      abort: () => {},
      activateRuntimeManagers: () => {},
    });
  }
  if (get_node_for_el(target) !== undefined || get_node_for_dom(target) !== undefined) {
    throw new Error("Existing document root is already managed outside document continuation.");
  }
  if (canonicalDocumentRoot.$_tag !== ROOT_TAG
    || canonicalDocumentRoot.$_content.length !== 1
    || !is_ordinary_element_node(canonicalDocumentRoot.$_content[0])) {
    throw new Error("Document continuation requires exactly one ordinary canonical document root.");
  }

  const canonicalOrdinaryRoot = canonicalDocumentRoot.$_content[0];
  const projectedRoot = clone_node(canonicalOrdinaryRoot);
  const realization = plan_browser_realization(projectedRoot, {
    parentNamespace: browser_parent_namespace_for_target(target, projectedRoot.$_tag),
  });
  const match = match_browser_realization_root(realization, target);

  const runtime = default_livetree_runtime();
  const claim = claim_runtime_document_silently(runtime, target.ownerDocument);
  let tree: LiveTree | undefined;
  const linkedNodes: HsonNode[] = [];
  const inheritedElements: Element[] = [];
  let finished = false;
  try {
    const claims = preflight_livetree_quid_graph(projectedRoot, runtime);
    for (const link of match.links) {
      if (get_dom_for_node(link.canonicalNode) !== undefined || get_node_for_dom(link.domNode) !== undefined) {
        throw new Error("Exact adoption conflicts with an active canonical-to-DOM ownership claim.");
      }
    }
    for (const link of match.links) {
      if (link.domNode.nodeType !== 1) continue;
      const element = link.domNode as Element;
      record_inherited_dom_quid(element);
      inheritedElements.push(element);
    }
    for (let index = 0; index < match.links.length; index += 1) {
      const link = match.links[index]!;
      if (link.domNode.nodeType === 1) link_node_to_el(link.canonicalNode, link.domNode as Element);
      else link_node_to_dom(link.canonicalNode, link.domNode);
      linkedNodes.push(link.canonicalNode);
      if (index === 0) adoptionFaultHook?.("after-first-link");
    }
    adoptionFaultHook?.("after-links");
    bind_graph_runtime(projectedRoot, runtime);
    for (const identity of claims) {
      runtime.quidToNode.set(identity.quid, identity.node);
      runtime.nodeToQuid.set(identity.node, identity.quid);
      runtime.issuedQuids.add(identity.quid);
    }
    adoptionFaultHook?.("after-runtime");
    tree = create_linked_livetree_in_runtime(projectedRoot, runtime);
    adoptionFaultHook?.("after-tree");
  } catch (cause) {
    cleanup_new_adoption(projectedRoot, linkedNodes, inheritedElements, runtime, claim);
    throw cause;
  }

  const adoptedTree = tree;
  if (adoptedTree === undefined) throw new Error("Exact document adoption did not construct a LiveTree.");
  return Object.freeze({
    tree: adoptedTree,
    commit(): void {
      if (finished) return;
      const entry: AdoptedRootEntry = {
        tree: adoptedTree,
        inheritedElements,
        stopTerminalObservation: () => {},
      };
      entry.stopTerminalObservation = observe_livetree_node_terminal(adoptedTree.node, () => {
        evict_adopted_root(target, entry);
      });
      ADOPTED_ROOTS.set(target, entry);
      finished = true;
    },
    abort(): void {
      if (finished) return;
      finished = true;
      cleanup_new_adoption(projectedRoot, linkedNodes, inheritedElements, runtime, claim);
    },
    activateRuntimeManagers(): void {
      claim.activate();
    },
  });
}
