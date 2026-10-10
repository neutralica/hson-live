import { assert_mutation_publication_available, begin_mutation_publication } from "../lifecycle/mutation-publication.js";
import { content_target_for_owner, restore_dom_children, capture_dom_placement } from "../lifecycle/mutation-dom.js";
import { plan_browser_realization, browser_element_namespace } from "../../../internal/browser-realization/browser-realization-plan.js";
import { assert_element_receiver, placement_nodes, qualify_owned_structure, qualify_owned_content } from "../lifecycle/mutation-qualification.js";
import { stage_livetree_projection, projection_needs_local_identity } from "../creation/project-live-tree.js";
import { plan_full_livetree_quid_graph, HSON_QUID_MARKUP_NAME, ensure_quid } from "../quid/data-quid.js";
import { remove_hson_node_quid } from "../../../core/hson-node-quid.js";
import { get_dom_for_node } from "../utils/node-map-helpers.js";
import { assert_graph_runtime_available, bind_graph_runtime, release_nodes_runtime, notify_livetree_realizations_internal } from "../runtime/livetree-runtime.js";
// appends.ts

import { HsonNode, NodeContent } from "../../../core/types.js";
import { ELEM_TAG } from "../../../core/constants.js";
import { is_Node } from "../../../core/node-guards.js";
import { CREATE_NODE } from "../../../core/factories.js";
import { unwrap_root_elem } from "../../transform/utils/html-utils/unwrap-root-elem.js";
import { get_el_for_node, unlinkNode } from "../utils/node-map-helpers.js";
import { LiveTree } from "../livetree.js";
import { normalize_ix } from "../../transform/utils/json-utils/normalize-ix.js";
import { SVG_TAGS, HTML_TAGS } from "../../../core/all-html-tags.js";
import { SvgTag } from "../../../types/livetree.types.js";
import { SVG_NS } from "../../transform/utils/node-utils/node-from-svg.js";
import { get_node_by_quid, get_quid } from "../quid/data-quid.js";
import { is_livetree_node_disposed } from "../livetree-state.js";
import {
  claim_node_parent,
  parent_for_node,
  release_node_parent,
} from "../lifecycle/graph-ownership.js";
import {
  LIVETREE_BATCH_ATTACHMENT_ERROR_CODE,
  LIVETREE_BATCH_VALIDATION_ERROR_CODE,
  LiveTreeAlreadyAttachedError,
  LiveTreeBatchError,
  LiveTreeDisposedError,
} from "../livetree.error.js";
import { record_livetree_materialization } from "../debug/materialization-profile.js";
import { assert_document_structural_mutation_allowed } from "../lifecycle/document-binding-state.js";
import {
  runtime_for_tree,
  type LiveTreeRuntime,
  active_subject_for_tree,
  active_historic_root_for_tree,
  inherit_trees_historic_root,
} from "../runtime/livetree-runtime.js";
import { reconcile_browser_realization_children, assert_retained_browser_realization_compatibility } from "../../../internal/browser-realization/browser-realization-dom.js";

type AppendTreeLike = Pick<LiveTree, "node" | "hostRootNode" | "adoptRoots">;

/**
 * Atomically attach an ordered forest of detached LiveTree branches.
 *
 * Validation scans the existing target once and every incoming subtree once.
 * DOM projection is staged in one fragment before graph ownership changes.
 * Either every branch is attached in order, or graph/DOM/mapping changes made
 * by this operation are rolled back and every branch remains detached.
 */
export function append_branches_atomic<TTree extends AppendTreeLike>(target: TTree, branches: readonly AppendTreeLike[], index?: number): TTree {
  try { attach_forest(target, branches, index); }
  catch (cause) {
    if (cause instanceof LiveTreeBatchError) throw cause;
    throw new LiveTreeBatchError(LIVETREE_BATCH_VALIDATION_ERROR_CODE, "LiveTree batch validation failed; no branch was attached.", cause);
  }
  if (branches.length && get_el_for_node(active_subject_for_tree(target))) notify_livetree_realizations_internal(runtime_for_tree(target));
  return target;
}

/** Factory-owned candidates finish root identity inside attachment, before the
 * factory publishes its result and sends the completed notification. @internal */
export function append_factory_branches_atomic<TTree extends AppendTreeLike>(target: TTree, branches: readonly AppendTreeLike[], index?: number): TTree {
  try { return attach_forest(target, branches, index, () => {
    const runtime = runtime_for_tree(target);
    for (const branch of branches) {
      const node = active_subject_for_tree(branch);
      if (runtime.nodeToQuid.get(node) === undefined) ensure_quid(node, undefined, runtime);
    }
  }); }
  catch (cause) {
    if (cause instanceof LiveTreeBatchError) throw cause;
    throw new LiveTreeBatchError(LIVETREE_BATCH_VALIDATION_ERROR_CODE, "LiveTree factory validation failed; no branch was attached.", cause);
  }
}

function attach_forest<TTree extends AppendTreeLike>(
  target: TTree,
  branches: readonly AppendTreeLike[],
  index?: number,
  completeFactoryIdentity?: () => void,
): TTree {
  const targetNode = active_subject_for_tree(target), runtime = runtime_for_tree(target);
  assert_mutation_publication_available(targetNode);
  for (const branch of branches) assert_mutation_publication_available(active_subject_for_tree(branch));
  assert_document_structural_mutation_allowed(targetNode, "append branches");
  assert_element_receiver(targetNode, "append branches");
  if (branches.length === 0) return target;
  const roots = branches.flatMap(branch => {
    if (runtime_for_tree(branch) !== runtime) throw new Error("LiveTree branch belongs to another runtime scope.");
    const source = active_subject_for_tree(branch);
    qualify_owned_structure(source, source.$_tag === "_hson_root" ? "document-root" : "runtime-branch", "append source");
    const incoming = unwrap_root_elem(source);
    for (const root of incoming) {
      if (!can_append_root_to_tree(targetNode, root)) throw new Error("LiveTree branch is incompatible with the target namespace.");
      qualify_owned_structure(root, root.$_tag === "_hson_str" ? "text" : "branch", "append branch");
    }
    return incoming;
  });
  assert_appendable_forest(targetNode, roots, runtime);
  active_historic_root_for_tree(target);
  const incomingNodes = placement_nodes(roots, "append branches");
  const rootClaims = branches.map(branch => { const node = active_subject_for_tree(branch), quid = runtime.nodeToQuid.get(node); return { node, quid, meta: node.$_meta }; });
  const issuedBefore = new Set(runtime.issuedQuids);
  const priorMappings = new Map(incomingNodes.map(node => [node, get_dom_for_node(node)]));
  const restorePositions = capture_dom_placement(incomingNodes);
  const priorContent = targetNode.$_content;
  const first = priorContent[0];
  const container = is_Node(first) && first.$_tag === ELEM_TAG ? first : undefined;
  const oldChildren = container?.$_content;
  const bucket = container ?? CREATE_NODE({ $_tag: ELEM_TAG, $_content: [] });
  const at = typeof index === "number" ? normalize_ix(index, bucket.$_content.length) : bucket.$_content.length;
  const children = [...bucket.$_content.slice(0, at), ...roots, ...bucket.$_content.slice(at)];
  assert_graph_runtime_available({ $_tag: targetNode.$_tag, $_content: [{ $_tag: ELEM_TAG, $_content: children }] }, runtime);
  const liveElement = get_el_for_node(targetNode);
  const contentTarget = content_target_for_owner(targetNode);
  const domBefore = contentTarget ? Array.from(contentTarget.childNodes) : [];
  if (liveElement) plan_browser_realization({ $_tag: targetNode.$_tag, $_content: [{ $_tag: ELEM_TAG, $_content: children }] },
    { parentNamespace: liveElement.namespaceURI === SVG_NS && targetNode.$_tag !== "svg" ? "svg" : "html", capability: "dom" });
  const plans = liveElement ? roots.filter(root => !root.$_tag.startsWith("_hson_") && projection_needs_local_identity(root))
    .map(root => plan_full_livetree_quid_graph(root, runtime)) : [];
  const quidWrites: Array<{ element: Element; prior: string | null }> = [];
  const endPublication = begin_mutation_publication([targetNode, bucket, ...roots], [...restorePositions.containers, ...(contentTarget ? [contentTarget] : [])]);
  try {
    if (liveElement) {
      const fragment = contentTarget!.ownerDocument!.createDocumentFragment();
      const ns = liveElement.namespaceURI === SVG_NS ? "svg" : "html";
      for (const root of roots) fragment.appendChild(stage_livetree_projection(root, ns, runtime, contentTarget!.ownerDocument!));
      // Keep staged nodes detached until the complete owner plan is installed.
    }
    bucket.$_content = children;
    if (!container) { targetNode.$_content = [bucket]; claim_node_parent(bucket, targetNode); }
    for (const root of roots) claim_node_parent(root, bucket);
    if (liveElement) reconcile_browser_realization_children(targetNode, runtime);
    // Recheck handles after native staging, before identity or context publication.
    active_subject_for_tree(target);
    for (const branch of branches) active_subject_for_tree(branch);
    assert_graph_runtime_available(targetNode, runtime);
    for (const plan of plans) plan.revalidate();
    // Install internal identity after native reconciliation. Observable markup
    // and final handle context follow, within the same rollback boundary.
    for (const plan of plans) plan.publish();
    bind_graph_runtime(bucket, runtime);
    completeFactoryIdentity?.();
    // Delay observable QUID markup until graph/native/claim publication has
    // succeeded. A later native failure still rolls back active ownership,
    // but callbacks and MutationObserver records can retain identity evidence.
    // Any callback can inspect all published branches, so protect every plan
    // before the first native attribute read/write.
    for (const plan of plans) plan.preserveIssuedHistory();
    for (const plan of plans) for (const [node, quid] of plan.identities) {
      const element = get_el_for_node(node);
      if (element && element.getAttribute(HSON_QUID_MARKUP_NAME) !== quid) {
        Object.defineProperty(quidWrites, quidWrites.length, { value: { element, prior: element.getAttribute(HSON_QUID_MARKUP_NAME) }, writable: true, enumerable: true, configurable: true });
        element.setAttribute(HSON_QUID_MARKUP_NAME, quid);
      }
    }
    inherit_trees_historic_root(branches, target);
  } catch (cause) {
    for (const plan of [...plans].reverse()) plan.rollback();
    // Headless factory root acquisition is also operation-local. Preserve every
    // earlier claim and ledger entry. Mounted plan rollback already preserves
    // any observable history; headless factory candidates remain unpublished.
    for (const { node, quid, meta } of rootClaims) {
      const current = get_quid(node, runtime);
      if (quid === undefined && current !== undefined) {
        if (runtime.quidToNode.get(current) === node) runtime.quidToNode.delete(current);
        runtime.nodeToQuid.delete(node);
        if (!issuedBefore.has(current)) runtime.issuedQuids.delete(current);
        remove_hson_node_quid(node);
        if (meta !== undefined) node.$_meta = meta;
      }
    }
    targetNode.$_content = priorContent;
    if (container && oldChildren) container.$_content = oldChildren;
    for (const root of roots) release_node_parent(root, bucket);
    if (!container) release_node_parent(bucket, targetNode);
    if (!container) release_nodes_runtime([bucket], runtime);
    if (contentTarget) restore_dom_children(contentTarget, domBefore);
    restorePositions();
    for (const { element, prior } of quidWrites) {
      const native = element.ownerDocument?.defaultView?.Element.prototype;
      if (prior === null) (native?.removeAttribute ?? element.removeAttribute).call(element, HSON_QUID_MARKUP_NAME);
      else (native?.setAttribute ?? element.setAttribute).call(element, HSON_QUID_MARKUP_NAME, prior);
    }
    for (const node of incomingNodes) if (priorMappings.get(node) === undefined) {
      get_dom_for_node(node)?.parentNode?.removeChild(get_dom_for_node(node)!); unlinkNode(node);
    }
    throw new LiveTreeBatchError(LIVETREE_BATCH_ATTACHMENT_ERROR_CODE, "LiveTree attachment failed without publication.", cause);
  }
  finally { endPublication(); }
  record_livetree_materialization("hsonHostInsertions", roots.length);
  return target;
}

export function append_branch<TTree extends AppendTreeLike>(
  this: TTree,
  branch: AppendTreeLike,
  index?: number,
): TTree {
  attach_forest(this, [branch], index);
  if (get_el_for_node(active_subject_for_tree(this))) notify_livetree_realizations_internal(runtime_for_tree(this));
  return this;
}

/** Append the exact ordered content captured by `detachContents()`. */
export function append_detached_content<TTree extends AppendTreeLike>(
  target: TTree,
  content: NodeContent,
  sourceRuntime: LiveTreeRuntime,
): TTree {
  const node = active_subject_for_tree(target), runtime = runtime_for_tree(target);
  assert_mutation_publication_available(node);
  for (const root of content.filter(is_Node)) assert_mutation_publication_available(root);
  assert_document_structural_mutation_allowed(node, "append detached content");
  if (runtime !== sourceRuntime) throw new Error("Detached LiveTree content cannot cross runtime scopes.");
  const incoming = content.filter(is_Node);
  if (incoming.length !== content.length) throw new Error("Detached relationships must contain nodes.");
  assert_appendable_forest(node, incoming, runtime);
  const first = node.$_content[0], transferred = content[0];
  const merge = node.$_content.length === 1 && is_Node(first) && first.$_tag === ELEM_TAG
    && content.length === 1 && is_Node(transferred) && transferred.$_tag === ELEM_TAG;
  const directElements = incoming.every(item => item.$_tag === "_hson_str" || !item.$_tag.startsWith("_hson_"));
  const directMerge = !merge && is_Node(first) && first.$_tag === ELEM_TAG && directElements;
  const priorContent = node.$_content, priorChildren = merge || directMerge ? first.$_content : undefined;
  const newBucket = priorContent.length === 0 && directElements && content.length
    ? CREATE_NODE({ $_tag: ELEM_TAG, $_content: [...content] }) : undefined;
  const next = merge || directMerge ? [ { $_tag: ELEM_TAG, $_content: [...first.$_content, ...(merge ? transferred.$_content : content)] } ]
    : newBucket ? [newBucket] : [...priorContent, ...content];
  qualify_owned_content(node, next, "append detached content");
  assert_graph_runtime_available({ $_tag: node.$_tag, $_content: next }, runtime);
  const el = get_el_for_node(node);
  const parentNamespace = (el ? el.namespaceURI === SVG_NS : is_svg_tag(String(node.$_tag)))
    && node.$_tag !== "svg" ? "svg" : "html";
  const childNamespace = browser_element_namespace(parentNamespace, node.$_tag).childNamespace;
  // Relationship wrappers do not change the namespace of their element
  // children. Check them just as direct append roots, including headless use.
  for (const root of incoming) {
    const children = root.$_tag === ELEM_TAG ? root.$_content : root.$_tag.startsWith("_hson_") ? [] : [root];
    for (const child of children) if (is_Node(child) && child.$_tag !== "_hson_str"
      && (childNamespace === "svg" ? !is_svg_tag(String(child.$_tag)) : is_svg_tag(String(child.$_tag)) && child.$_tag !== "svg")) {
      // Shared HTML/SVG spellings retain their actual realization. The full
      // receiving plan below checks mapped namespaces, even for nested content.
      if (childNamespace !== "html" || (get_el_for_node(child)?.namespaceURI !== "http://www.w3.org/1999/xhtml"
        && !HTML_TAGS.some(tag => tag === child.$_tag))) {
        throw new Error("Detached LiveTree content is incompatible with the target namespace.");
      }
    }
  }
  const moving = merge ? transferred.$_content.filter(is_Node) : incoming;
  const all = placement_nodes(incoming, "append detached content");
  const mappings = new Map(all.map(item => [item, get_dom_for_node(item)]));
  const restorePositions = capture_dom_placement(all);
  const contentTarget = content_target_for_owner(node), oldDom = contentTarget ? Array.from(contentTarget.childNodes) : [];
  if (el || next.some(item => is_Node(item) && item.$_tag === ELEM_TAG)) {
    const plan = plan_browser_realization({ $_tag: node.$_tag, $_content: next },
      { parentNamespace, capability: "dom" });
    assert_retained_browser_realization_compatibility(plan, contentTarget?.ownerDocument ?? undefined);
  }
  const endPublication = begin_mutation_publication([node, ...incoming, ...(newBucket ? [newBucket] : [])],
    [...restorePositions.containers, ...(contentTarget ? [contentTarget] : [])]);
  try {
    if (el) {
      const fragment = contentTarget!.ownerDocument!.createDocumentFragment();
      for (const root of incoming) fragment.appendChild(stage_livetree_projection(root,
        childNamespace, runtime, contentTarget!.ownerDocument!));
      // Materialization is staged without publishing children.
    }
    if (merge || directMerge) first.$_content = [...first.$_content, ...(merge ? transferred.$_content : content)];
    else node.$_content = next;
    if (el) reconcile_browser_realization_children(node, runtime);
    active_subject_for_tree(target);
    assert_graph_runtime_available(node, runtime);
    // Runtime routing is fallible. Complete it before changing the incoming
    // subjects' parent records or consuming their detached relationship shell.
    bind_graph_runtime(node, runtime);
    for (const root of moving) {
      release_node_parent(root);
      claim_node_parent(root, merge || directMerge ? first : newBucket ?? node);
    }
    if (newBucket) claim_node_parent(newBucket, node);
    if (merge) { transferred.$_content = []; release_node_parent(transferred); release_nodes_runtime([transferred], runtime); }
  } catch (cause) {
    node.$_content = priorContent;
    if ((merge || directMerge) && priorChildren) first.$_content = priorChildren;
    if (contentTarget) restore_dom_children(contentTarget, oldDom);
    restorePositions();
    for (const root of all) if (mappings.get(root) === undefined) { get_dom_for_node(root)?.parentNode?.removeChild(get_dom_for_node(root)!); unlinkNode(root); }
    throw cause;
  } finally { endPublication(); }
  return target;
}

function assert_appendable_forest(
  target: HsonNode,
  roots: readonly HsonNode[],
  runtime: LiveTreeRuntime,
): void {
  const targetSubtree = new Set(placement_nodes([target], "append branches"));
  record_livetree_materialization("appendValidationTargetNodes", targetSubtree.size);
  const forestNodes = new Set<HsonNode>();
  const localQuids = new Map<string, HsonNode>();

  for (const root of roots) {
    if (parent_for_node(root) || get_dom_for_node(root)?.isConnected) {
      throw new LiveTreeAlreadyAttachedError("append branch batch");
    }
    const subtreeNodes = placement_nodes([root], "append branches");
    record_livetree_materialization("appendValidationBranchNodes", subtreeNodes.length);
    const subtreeSet = new Set(subtreeNodes);
    for (const node of subtreeNodes) {
      if (forestNodes.has(node) || targetSubtree.has(node)) {
        throw new LiveTreeAlreadyAttachedError("append branch batch");
      }
      forestNodes.add(node);
      const parent = parent_for_node(node);
      if ((node === root && parent) || (node !== root && parent && !subtreeSet.has(parent))) {
        throw new LiveTreeAlreadyAttachedError("append branch batch");
      }
      if (get_dom_for_node(node)?.isConnected) throw new LiveTreeAlreadyAttachedError("append branch batch");
      if (is_livetree_node_disposed(node)) throw new LiveTreeDisposedError("append branch batch", get_quid(node));
      const quid = get_quid(node);
      if (!quid) continue;
      const localOwner = localQuids.get(quid);
      if (localOwner !== undefined && localOwner !== node) {
        throw new Error(`Duplicate QUID "${quid}" occurs within the appended batch.`);
      }
      localQuids.set(quid, node);
      const registered = get_node_by_quid(quid, runtime);
      if (registered !== undefined && registered !== node) {
        throw new Error(`Duplicate QUID "${quid}" is already registered to another node.`);
      }
    }
  }
}

function is_svg_tag(tag: string): boolean {
  return SVG_TAGS.includes(tag as SvgTag);
}

function can_append_root_to_tree(target: HsonNode, root: HsonNode): boolean {
  if (root.$_tag === "_hson_str") return true;
  const element = get_el_for_node(target);
  const targetIsSvg = element ? element.namespaceURI === SVG_NS : is_svg_tag(String(target.$_tag));
  const rootTag = String(root.$_tag), branchIsSvg = is_svg_tag(rootTag);
  return targetIsSvg ? branchIsSvg : !branchIsSvg || rootTag === "svg";
}
