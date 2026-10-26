import { ROOT_TAG } from "../../core/constants.js";
import { clone_node } from "../../core/clone-node.js";
import { is_ordinary_element_node } from "../../core/node-guards.js";
import type { HsonNode } from "../../core/types.js";
import { create_linked_livetree_in_runtime } from "../livetree/creation/create-livetree.js";
import type { LiveTree } from "../livetree/livetree.js";
import { is_livetree_node_disposed, observe_livetree_node_terminal } from "../livetree/livetree-state.js";
import { release_subtree_ownership } from "../livetree/lifecycle/graph-ownership.js";
import { preflight_livetree_quid_graph } from "../livetree/quid/data-quid.js";
import {
  bind_graph_runtime,
  claim_runtime_document_silently,
  continuation_runtime_for_document,
  release_nodes_runtime,
  runtime_for_tree,
  runtime_owns_document,
  type LiveTreeRuntime,
  type SilentRuntimeDocumentClaim,
  active_subject_for_tree,
  subject_for_tree,
  observe_livetree_realizations_internal,
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
  mark_runtime_infrastructure,
  unmark_runtime_infrastructure,
} from "../../internal/browser-realization/browser-realization-dom.js";
import { plan_browser_realization } from "../../internal/browser-realization/browser-realization-plan.js";
import { plan_managed_document_css, MANAGED_DOCUMENT_CSS_MARKER } from "../../internal/browser-realization/managed-document-css.js";
import { plan_portable_document_subjects } from "../../internal/browser-realization/portable-document-subjects.js";
import type { PortableDocumentQuads, LiveMapDocumentLibrary } from "../../types/livemap.types.js";
import { capture_document_css_reuse, type DocumentCssReuse, type DocumentCssReusePreparation } from "../livetree/managers/bound-document-css.js";

export type ExactDocumentAdoption = Readonly<{
  tree: LiveTree;
  managedStyles: readonly HTMLStyleElement[];
  portableSubjects: readonly Readonly<{ element: Element; name: string; quid: string }>[];
  commit: (currentTree?: () => LiveTree) => void;
  abort: (currentTree?: LiveTree) => void;
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
  readonly prepareCssReuse: DocumentCssReuse | undefined;
  stopTerminalObservation: () => void;
  stopRealizations: () => void;
};

const ADOPTED_ROOTS = new WeakMap<Element, AdoptedRootEntry>();

function exact_managed_styles(root: Element, css: readonly string[]): readonly HTMLStyleElement[] {
  const marked: Element[] = [];
  const visit = (element: Element): void => {
    if (element.hasAttribute(MANAGED_DOCUMENT_CSS_MARKER)) marked.push(element);
    for (const child of Array.from(element.childNodes)) if (child.nodeType === 1) visit(child as Element);
    if (element.localName === "template") {
      for (const child of Array.from((element as HTMLTemplateElement).content?.children ?? [])) visit(child);
    }
  };
  visit(root);
  if (marked.length !== css.length) throw new Error(`Expected ${css.length} managed document styles; found ${marked.length}.`);
  return marked.map((style, index) => {
    if (style.localName !== "style" || style.namespaceURI !== "http://www.w3.org/1999/xhtml"
      || style.getAttribute(MANAGED_DOCUMENT_CSS_MARKER) !== "managed") throw new Error("Managed document style marker is invalid.");
    if (style.textContent !== css[index]) throw new Error("Managed document style text does not match the selected document Library.");
    return style as HTMLStyleElement;
  });
}

function evict_adopted_root(target: Element, entry: AdoptedRootEntry): void {
  if (ADOPTED_ROOTS.get(target) !== entry) return;
  ADOPTED_ROOTS.delete(target);
  entry.stopTerminalObservation();
  entry.stopRealizations();
}

function commit_adopted_root(target: Element, currentTree: () => LiveTree): void {
  const tree = currentTree(), subject = active_subject_for_tree(tree);
  if (get_el_for_node(subject) !== target || get_node_for_el(target) !== subject) {
    throw new Error("Committed adoption provider does not own the exact current root Element.");
  }
  const prior = ADOPTED_ROOTS.get(target);
  const entry: AdoptedRootEntry = {
    get tree() { return currentTree(); },
    prepareCssReuse: capture_document_css_reuse(tree),
    stopTerminalObservation: () => {},
    stopRealizations: () => {},
  };
  let observed = subject;
  const refresh = (): void => {
    if (ADOPTED_ROOTS.get(target) !== entry) return;
    const subject = subject_for_tree(entry.tree);
    if (is_livetree_node_disposed(subject)) { evict_adopted_root(target, entry); return; }
    if (subject === observed) return;
    entry.stopTerminalObservation();
    observed = subject;
    entry.stopTerminalObservation = observe_livetree_node_terminal(subject, refresh);
  };
  entry.stopTerminalObservation = observe_livetree_node_terminal(subject, refresh);
  entry.stopRealizations = observe_livetree_realizations_internal(tree, refresh);
  ADOPTED_ROOTS.set(target, entry);
  prior?.stopTerminalObservation();
  prior?.stopRealizations();
}

/** Re-realize only a live cache owner's released CSS before exact admission.
 * Initial SSR adoption remains no-write and still rejects missing carriers. @internal */
export function prepare_retained_document_css(
  canonicalRoot: HsonNode, target: Element, document: LiveMapDocumentLibrary, css: readonly string[],
): DocumentCssReusePreparation | undefined {
  const entry = ADOPTED_ROOTS.get(target);
  if (!css.length || entry?.prepareCssReuse === undefined) return undefined;
  // Validate the retained graph/mappings and the receiving candidate before
  // allowing its previous CSS owner to touch any detached native resource.
  const tree = reusable_cached_tree(target, canonicalRoot, [], []);
  if (tree === undefined) return undefined;
  const subject = active_subject_for_tree(tree), runtime = runtime_for_tree(tree);
  plan_managed_document_css(plan_browser_realization(canonicalRoot, {
    parentNamespace: browser_parent_namespace_for_target(target, subject.$_tag),
  }), css);
  return entry.prepareCssReuse(document, target, () => {
    if (ADOPTED_ROOTS.get(target) !== entry || entry.tree !== tree || runtime.disposed
      || is_livetree_node_disposed(subject) || get_el_for_node(subject) !== target
      || get_node_for_el(target) !== subject || !runtime_owns_document(runtime, target.ownerDocument)) {
      throw new Error("Retained document CSS lost its existing root ownership.");
    }
  });
}

function reusable_cached_tree(target: Element, canonicalRoot: HsonNode, css: readonly string[],
  managedStyles: readonly HTMLStyleElement[]): LiveTree | undefined {
  const entry = ADOPTED_ROOTS.get(target);
  if (entry === undefined) return undefined;
  const tree = entry.tree;
  const runtime = runtime_for_tree(tree);
  try {
    if (is_livetree_node_disposed(active_subject_for_tree(tree)) || runtime.disposed) throw new Error("Cached tree is terminal.");
    if (get_el_for_node(active_subject_for_tree(tree)) !== target || get_node_for_el(target) !== active_subject_for_tree(tree)) {
      throw new Error("Cached root mapping is stale.");
    }
    if (!runtime_owns_document(runtime, target.ownerDocument)) throw new Error("Cached runtime document ownership is stale.");
    const plan = plan_browser_realization(active_subject_for_tree(tree), {
      parentNamespace: browser_parent_namespace_for_target(target, active_subject_for_tree(tree).$_tag),
    });
    const match = match_browser_realization_root(plan, target, { allowRuntimeInfrastructure: true });
    assert_browser_realization_mappings(match);
  } catch {
    evict_adopted_root(target, entry);
    return undefined;
  }
  // A mismatched candidate must not evict an otherwise valid cached owner.
  const canonicalOrdinaryRoot = canonicalRoot.$_tag === ROOT_TAG
    && canonicalRoot.$_content.length === 1
    && is_ordinary_element_node(canonicalRoot.$_content[0])
    ? canonicalRoot.$_content[0]
    : undefined;
  if (canonicalOrdinaryRoot === undefined) throw new Error("Cached continuation input has no ordinary canonical root.");
  const canonicalPlan = plan_managed_document_css(plan_browser_realization(canonicalRoot, {
    parentNamespace: browser_parent_namespace_for_target(target, canonicalOrdinaryRoot.$_tag),
  }), css);
  match_browser_realization_root(canonicalPlan, target, {
    allowRuntimeInfrastructure: true, retainRuntimeInfrastructure: managedStyles,
  });
  return tree;
}

function cleanup_new_adoption(
  root: HsonNode,
  linkedNodes: readonly HsonNode[],
  runtime: LiveTreeRuntime,
  claim: SilentRuntimeDocumentClaim,
): void {
  const nodes = [...new Set([...linkedNodes, ...collect_subtree_nodes(root, "post")])];
  for (const node of [...nodes].reverse()) unlinkNode(node);
  for (const node of nodes) {
    const quid = runtime.nodeToQuid.get(node);
    if (quid !== undefined) {
      if (runtime.quidToNode.get(quid) === node) runtime.quidToNode.delete(quid);
      runtime.nodeToQuid.delete(node);
      runtime.issuedQuids.delete(quid);
    }
  }
  release_nodes_runtime(nodes, runtime);
  release_subtree_ownership(root);
  claim.rollback();
}

/** Exact, no-write admission of one canonical document root into existing DOM. @internal */
export function adopt_exact_existing_document(
  canonicalDocumentRoot: HsonNode,
  target: Element,
  css: readonly string[] = [],
  portable?: Readonly<{ quads: PortableDocumentQuads | undefined }>,
): ExactDocumentAdoption {
  const managedStyles = exact_managed_styles(target, css);
  const priorTree = portable === undefined ? reusable_cached_tree(target, canonicalDocumentRoot, css, managedStyles) : undefined;
  if (priorTree !== undefined) {
    let finished = false;
    return Object.freeze({
      tree: priorTree,
      managedStyles,
      portableSubjects: Object.freeze([]),
      commit(currentTree = () => priorTree): void {
        if (finished) return;
        commit_adopted_root(target, currentTree);
        finished = true;
      },
      abort: () => { finished = true; },
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
  const browser = plan_browser_realization(projectedRoot, {
    parentNamespace: browser_parent_namespace_for_target(target, projectedRoot.$_tag),
  });
  const addressed = portable === undefined ? browser : plan_portable_document_subjects(browser,
    { $_tag: ROOT_TAG, $_content: [projectedRoot] }, portable.quads);
  const realization = plan_managed_document_css(addressed, css);
  const match = match_browser_realization_root(realization, target);
  const portableSubjects: Array<Readonly<{ element: Element; name: string; quid: string }>> = [];
  if (portable !== undefined) for (const link of match.links) {
    if (link.domNode.nodeType !== 1) continue;
    const element = link.domNode as Element, name = element.getAttribute("hson:quad");
    if (name === null) continue;
    const quid = link.canonicalNode.$_meta?.quid;
    if (quid === undefined) throw new Error("Portable carrier has no receiving owner-issued identity.");
    portableSubjects.push(Object.freeze({ element, name, quid }));
  }

  const runtime = continuation_runtime_for_document(target.ownerDocument);
  const claim = claim_runtime_document_silently(runtime, target.ownerDocument);
  let tree: LiveTree | undefined;
  const linkedNodes: HsonNode[] = [];
  let finished = false;
  try {
    const claims = preflight_livetree_quid_graph(projectedRoot, runtime);
    for (const link of match.links) {
      if (get_dom_for_node(link.canonicalNode) !== undefined || get_node_for_dom(link.domNode) !== undefined) {
        throw new Error("Exact adoption conflicts with an active canonical-to-DOM ownership claim.");
      }
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
    cleanup_new_adoption(projectedRoot, linkedNodes, runtime, claim);
    throw cause;
  }

  const adoptedTree = tree;
  if (adoptedTree === undefined) throw new Error("Exact document adoption did not construct a LiveTree.");
  managedStyles.forEach(mark_runtime_infrastructure);
  return Object.freeze({
    tree: adoptedTree,
    managedStyles,
    portableSubjects: Object.freeze(portableSubjects),
    commit(currentTree = () => adoptedTree): void {
      if (finished) return;
      commit_adopted_root(target, currentTree);
      finished = true;
    },
    abort(currentTree = adoptedTree): void {
      if (finished) return;
      finished = true;
      managedStyles.forEach(unmark_runtime_infrastructure);
      const currentRoot = subject_for_tree(currentTree);
      const currentNodes = collect_subtree_nodes(currentRoot, "post");
      const failures: unknown[] = [];
      for (const node of currentNodes) {
        try {
          const element = get_el_for_node(node), quid = runtime.nodeToQuid.get(node);
          if (quid !== undefined && element?.getAttribute("hson:quid") === quid) element.removeAttribute("hson:quid");
        } catch (cause) { failures.push(cause); }
      }
      try { cleanup_new_adoption(currentRoot, [...linkedNodes, ...currentNodes], runtime, claim); }
      catch (cause) { failures.push(cause); }
      if (failures.length) throw new AggregateError(failures, "Exact document adoption cleanup failed.");
    },
    activateRuntimeManagers(): void {
      claim.activate();
    },
  });
}
