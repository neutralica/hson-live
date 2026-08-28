import {
  ARR_TAG,
  ELEM_TAG,
  HSON_SYS_PREFIX,
  OBJ_TAG,
  ROOT_TAG,
  STR_TAG,
  VAL_TAG,
  HSON_META_QUID,
} from "../../core/constants.js";
import { clone_node } from "../../core/clone-node.js";
import { is_Node, is_ordinary_element_node } from "../../core/node-guards.js";
import { canonical_public_attrs_equal, decode_public_attrs } from "../../core/public-attrs.js";
import type { CanonicalPublicAttrs, HsonNode, Primitive } from "../../core/types.js";
import type { LiveMapDocumentCommitTarget, LiveMapGraphOp } from "../../types/livemap.types.js";
import { project_linked_livetree } from "../livetree/creation/project-live-tree.js";
import { index_subtree_ownership, release_subtree_ownership } from "../livetree/lifecycle/graph-ownership.js";
import { apply_projected_attrs_replacement } from "../livetree/managers/attr-handle.js";
import {
  admit_livetree_quid_graph_preserving_absence,
  get_node_by_quid,
  preflight_livetree_quid_lineage_transfer,
  type LiveTreeQuidLineageTransfer,
} from "../livetree/quid/data-quid.js";
import { dispose_node_deep } from "../livetree/utils/dispose-node.js";
import { get_el_for_node } from "../livetree/utils/node-map-helpers.js";
import { collect_subtree_nodes } from "../livetree/utils/subtree-traversal.js";
import {
  bind_graph_runtime,
  default_livetree_runtime,
  runtime_for_node,
  type LiveTreeRuntime,
} from "../livetree/runtime/livetree-runtime.js";
import {
  DOCUMENT_REFLECT_CONTENT_INDEX_INVALID_ERROR_CODE,
  DOCUMENT_REFLECT_CONTENT_MISMATCH_ERROR_CODE,
  DOCUMENT_REFLECT_CONTENT_PATH_INVALID_ERROR_CODE,
  DOCUMENT_REFLECT_QUID_COLLISION_ERROR_CODE,
  DOCUMENT_REFLECT_QUID_MISMATCH_ERROR_CODE,
  DOCUMENT_REFLECT_REUSE_INCOMPATIBLE_ERROR_CODE,
  DOCUMENT_REFLECT_STRUCTURAL_UPDATE_FAILED_ERROR_CODE,
  DocumentReflectError,
} from "./reflect.document.error.js";

type ShadowContent = ShadowNode | Primitive;

type ShadowNode = {
  readonly node: HsonNode;
  readonly fresh: boolean;
  readonly parent?: ShadowNode;
  persistedQuid?: string;
  readonly replacementSource?: HsonNode;
  attrs: CanonicalPublicAttrs;
  content: ShadowContent[];
};

type PlannedQuidLineageTransfer = Readonly<{
  quid: string;
  from: HsonNode;
  to: HsonNode;
}>;

type ContinuityPlanningContext = {
  readonly byQuid: ReadonlyMap<string, ShadowNode>;
  readonly transfers: PlannedQuidLineageTransfer[];
};

export type DocumentStructuralPlan = Readonly<{
  root: ShadowNode;
  finalNodes: ReadonlySet<HsonNode>;
  removedRoots: readonly HsonNode[];
  affectedOwners: readonly HsonNode[];
  runtime: LiveTreeRuntime;
  lineageTransfers: readonly PlannedQuidLineageTransfer[];
}>;

type PersistedQuidLookup = (node: HsonNode) => string | undefined;

/** Plan all graph operations sequentially without mutating the projected graph or DOM. */
export function plan_document_structural_transaction(
  projectedRoot: HsonNode,
  canonicalFinalRoot: HsonNode,
  operations: readonly LiveMapGraphOp[],
  persistedQuidForExisting: PersistedQuidLookup,
): DocumentStructuralPlan {
  const root = shadow_existing(projectedRoot, persistedQuidForExisting);
  const runtime = runtime_for_node(projectedRoot) ?? default_livetree_runtime();
  const continuity: ContinuityPlanningContext = {
    byQuid: index_shadow_quids(root),
    transfers: [],
  };
  const affectedOwners = new Set<ShadowNode>();
  const incomingRoots: ShadowContent[] = [];

  for (const operation of operations) {
    if (operation.op === "replace-root") {
      throw new DocumentReflectError(
        DOCUMENT_REFLECT_CONTENT_PATH_INVALID_ERROR_CODE,
        "Root replacement is outside the structural-content binding proof.",
      );
    }
    const target = resolve_shadow_target(root, operation.target, operation.op);
    switch (operation.op) {
      case "set-attr": {
        const next = { ...target.attrs, [operation.name]: clone_node(operation.value) };
        target.attrs = must_attrs(next);
        break;
      }
      case "remove-attr": {
        const next: Record<string, unknown> = { ...target.attrs };
        delete next[operation.name];
        target.attrs = must_attrs(next);
        break;
      }
      case "replace-attrs":
        target.attrs = must_attrs(operation.attrs);
        break;
      case "ensure-quid":
        if (target.persistedQuid !== undefined && target.persistedQuid !== operation.quid) {
          throw new DocumentReflectError(
            DOCUMENT_REFLECT_QUID_MISMATCH_ERROR_CODE,
            "Projected structural target already carries a different canonical QUID.",
          );
        }
        target.persistedQuid = operation.quid;
        break;
      case "insert-content":
        affectedOwners.add(nearest_ordinary_owner(target));
        assert_insert_index(target, operation.index, operation.op);
        {
          const inserted = shadow_insert_content(target, operation.content, continuity);
          target.content.splice(operation.index, 0, inserted);
          incomingRoots.push(inserted);
        }
        break;
      case "remove-content":
        affectedOwners.add(nearest_ordinary_owner(target));
        assert_existing_index(target, operation.index, operation.op);
        target.content.splice(operation.index, 1);
        break;
      case "move-content": {
        affectedOwners.add(nearest_ordinary_owner(target));
        assert_existing_index(target, operation.from, operation.op);
        assert_existing_index(target, operation.to, operation.op);
        const moved = target.content.splice(operation.from, 1)[0];
        if (moved === undefined) throw content_index_error(operation.op, operation.from);
        target.content.splice(operation.to, 0, moved);
        break;
      }
      case "replace-content": {
        affectedOwners.add(nearest_ordinary_owner(target));
        assert_existing_index(target, operation.index, operation.op);
        const current = target.content[operation.index];
        const replacement = plan_replacement(target, current, operation.replacement, continuity);
        target.content[operation.index] = replacement;
        incomingRoots.push(replacement);
        break;
      }
    }
  }

  validate_shadow_against_canonical(root, canonicalFinalRoot);
  const oldNodes = new Set(collect_subtree_nodes(projectedRoot, "pre"));
  const finalNodes = new Set<HsonNode>();
  collect_shadow_nodes(root, finalNodes);
  validate_incoming_quids(incomingRoots, oldNodes, finalNodes, runtime);
  const removedRoots = find_removed_roots(projectedRoot, finalNodes);
  const mountedAffectedOwners = [...affectedOwners]
    .map((shadow) => shadow.node)
    .filter((node) => finalNodes.has(node) && get_el_for_node(node) !== undefined);
  return Object.freeze({
    root,
    finalNodes,
    removedRoots,
    affectedOwners: Object.freeze(mountedAffectedOwners),
    runtime,
    lineageTransfers: Object.freeze([...continuity.transfers]),
  });
}

/** Plan complete compatible-root convergence while retaining the projected root object. */
export function plan_document_root_structural_transaction(
  projectedRoot: HsonNode,
  canonicalFinalRoot: HsonNode,
  persistedQuidForExisting: PersistedQuidLookup,
): DocumentStructuralPlan {
  const root = shadow_existing(projectedRoot, persistedQuidForExisting);
  const runtime = runtime_for_node(projectedRoot) ?? default_livetree_runtime();
  const continuity: ContinuityPlanningContext = {
    byQuid: index_shadow_quids(root),
    transfers: [],
  };
  root.attrs = must_attrs(canonicalFinalRoot.$_attrs ?? {});
  root.content = canonicalFinalRoot.$_content.map((item, index) =>
    plan_continuous_content(root, root.content[index], item, continuity));

  validate_shadow_against_canonical(root, canonicalFinalRoot);
  const oldNodes = new Set(collect_subtree_nodes(projectedRoot, "pre"));
  const finalNodes = new Set<HsonNode>();
  collect_shadow_nodes(root, finalNodes);
  validate_final_quids(root, oldNodes, finalNodes, runtime);
  const removedRoots = find_removed_roots(projectedRoot, finalNodes);
  const mountedOwners: HsonNode[] = [];
  walk_shadow(root, (shadow) => {
    if (is_ordinary_element_node(shadow.node) && get_el_for_node(shadow.node) !== undefined) {
      mountedOwners.push(shadow.node);
    }
  });
  const affectedOwners = Object.freeze(mountedOwners);
  return Object.freeze({
    root,
    finalNodes,
    removedRoots,
    affectedOwners,
    runtime,
    lineageTransfers: Object.freeze([...continuity.transfers]),
  });
}

/** Apply one fully validated structural plan through explicit internal graph/DOM machinery. */
export function apply_document_structural_transaction(
  plan: DocumentStructuralPlan,
  beforeDomRealization?: () => void,
): void {
  const transfers: LiveTreeQuidLineageTransfer[] = plan.lineageTransfers.map((transfer) => (
    preflight_livetree_quid_lineage_transfer(
      transfer.quid,
      transfer.from,
      transfer.to,
      plan.runtime,
    )
  ));
  apply_shadow_node(plan.root);
  bind_graph_runtime(plan.root.node, plan.runtime);
  for (const transfer of transfers) transfer.apply();
  for (const removed of plan.removedRoots) {
    detach_retained_projection_descendants(removed, plan.finalNodes);
    prune_retained_graph_descendants(removed, plan.finalNodes);
    release_subtree_ownership(removed);
    dispose_node_deep(removed, plan.runtime);
  }
  admit_livetree_quid_graph_preserving_absence(plan.root.node, plan.runtime);
  index_subtree_ownership(plan.root.node);
  beforeDomRealization?.();

  for (const owner of plan.affectedOwners) reconcile_owner_dom(owner, plan.runtime);
}

function shadow_existing(
  node: HsonNode,
  persistedQuidForExisting: PersistedQuidLookup,
  parent?: ShadowNode,
): ShadowNode {
  const persistedQuid = persistedQuidForExisting(node);
  const shadow: ShadowNode = {
    node,
    fresh: false,
    ...(parent === undefined ? {} : { parent }),
    ...(persistedQuid === undefined ? {} : { persistedQuid }),
    attrs: must_attrs(node.$_attrs ?? {}),
    content: [],
  };
  shadow.content = node.$_content.map((item) => is_Node(item)
    ? shadow_existing(item, persistedQuidForExisting, shadow)
    : item);
  return shadow;
}

function shadow_insert_content(
  target: ShadowNode,
  content: HsonNode | Primitive,
  continuity: ContinuityPlanningContext,
): ShadowContent {
  if (target.node.$_tag === ELEM_TAG && typeof content === "string") {
    return plan_continuous_content(
      target,
      undefined,
      { $_tag: STR_TAG, $_content: [content] },
      continuity,
    );
  }
  return plan_continuous_content(target, undefined, clone_node(content), continuity);
}

function plan_replacement(
  parent: ShadowNode,
  current: ShadowContent | undefined,
  replacementInput: HsonNode | Primitive,
  continuity: ContinuityPlanningContext,
): ShadowContent {
  return plan_continuous_content(parent, current, clone_node(replacementInput), continuity);
}

function plan_continuous_content(
  parent: ShadowNode,
  current: ShadowContent | undefined,
  replacement: HsonNode | Primitive,
  continuity: ContinuityPlanningContext,
): ShadowContent {
  if (!is_Node(replacement)) return replacement;

  const replacementQuid = is_ordinary_element_node(replacement)
    ? replacement.$_meta?.[HSON_META_QUID]
    : undefined;
  const continuous = replacementQuid === undefined
    ? undefined
    : continuity.byQuid.get(replacementQuid);

  if (continuous !== undefined && is_ordinary_element_node(continuous.node)) {
    if (replacementQuid === undefined) throw new Error("Continuous subject planning requires persisted identity.");
    if (continuous.node.$_tag === replacement.$_tag) {
      return plan_compatible_subject(parent, continuous, replacement, continuity);
    }
    const transferred = shadow_fresh_continuous(replacement, parent, continuous, continuity);
    if (!is_shadow_node(transferred)) throw new Error("QUID lineage transfer target is not a node.");
    continuity.transfers.push(Object.freeze({
      quid: replacementQuid,
      from: continuous.node,
      to: transferred.node,
    }));
    return transferred;
  }

  if (is_shadow_node(current)
    && current.node.$_tag.startsWith(HSON_SYS_PREFIX)
    && current.node.$_tag === replacement.$_tag) {
    const shadow: ShadowNode = {
      node: current.node,
      fresh: false,
      parent,
      attrs: must_attrs(replacement.$_attrs ?? {}),
      content: [],
    };
    shadow.content = replacement.$_content.map((item, index) =>
      plan_continuous_content(shadow, current.content[index], item, continuity));
    return shadow;
  }

  return shadow_fresh_continuous(
    replacement,
    parent,
    is_shadow_node(current) ? current : undefined,
    continuity,
  );
}

function plan_compatible_subject(
  parent: ShadowNode,
  current: ShadowNode,
  replacement: HsonNode,
  continuity: ContinuityPlanningContext,
): ShadowNode {
  const quid = current.persistedQuid;
  if (quid === undefined) throw new Error("Compatible subject planning requires persisted identity.");
  const shadow: ShadowNode = {
    node: current.node,
    fresh: false,
    parent,
    persistedQuid: quid,
    replacementSource: replacement,
    attrs: must_attrs(replacement.$_attrs ?? {}),
    content: [],
  };
  shadow.content = replacement.$_content.map((item, index) =>
    plan_continuous_content(shadow, current.content[index], item, continuity));
  return shadow;
}

function shadow_fresh_continuous(
  replacement: HsonNode,
  parent: ShadowNode,
  prior: ShadowNode | undefined,
  continuity: ContinuityPlanningContext,
): ShadowNode {
  const persistedQuid = is_ordinary_element_node(replacement)
    ? replacement.$_meta?.[HSON_META_QUID]
    : undefined;
  const shadow: ShadowNode = {
    node: replacement,
    fresh: true,
    parent,
    ...(persistedQuid === undefined ? {} : { persistedQuid }),
    attrs: must_attrs(replacement.$_attrs ?? {}),
    content: [],
  };
  shadow.content = replacement.$_content.map((item, index) =>
    plan_continuous_content(shadow, prior?.content[index], item, continuity));
  return shadow;
}

function resolve_shadow_target(root: ShadowNode, target: LiveMapDocumentCommitTarget, operation: string): ShadowNode {
  let current = root;
  for (const segment of target.path) {
    const child = current.content[segment];
    if (!is_shadow_node(child)) throw content_path_error(operation);
    current = child;
  }
  if (target.witness !== undefined
    && current.persistedQuid !== undefined
    && current.persistedQuid !== target.witness.quid) {
    throw new DocumentReflectError(
      DOCUMENT_REFLECT_QUID_MISMATCH_ERROR_CODE,
      `Canonical path target for ${operation} does not match its persisted-QUID witness.`,
    );
  }
  return current;
}

function apply_shadow_node(shadow: ShadowNode): HsonNode {
  if (shadow.replacementSource !== undefined) copy_replacement_shell(shadow.node, shadow.replacementSource);
  shadow.node.$_content = shadow.content.map((item) => is_shadow_node(item) ? apply_shadow_node(item) : item);
  if (is_ordinary_element_node(shadow.node)) {
    apply_projected_attrs_replacement(shadow.node, shadow.attrs);
  }
  return shadow.node;
}

function copy_replacement_shell(target: HsonNode, source: HsonNode): void {
  if (target.$_tag !== source.$_tag) {
    throw new DocumentReflectError(
      DOCUMENT_REFLECT_REUSE_INCOMPATIBLE_ERROR_CODE,
      "A same-QUID replacement changed element kind during structural application.",
    );
  }
  target.$_tag = source.$_tag;
  if (source.$_meta === undefined) delete target.$_meta;
  else target.$_meta = clone_node(source.$_meta);
}

function reconcile_owner_dom(owner: HsonNode, runtime: LiveTreeRuntime): void {
  const element = get_el_for_node(owner);
  if (element === undefined) return;
  try {
    const namespace: "html" | "svg" = element.namespaceURI === "http://www.w3.org/2000/svg" ? "svg" : "html";
    const desired = flatten_dom_content(
      owner.$_content,
      namespace,
      runtime,
      element.ownerDocument,
    );
    element.replaceChildren(...desired);
  } catch (cause) {
    throw new DocumentReflectError(
      DOCUMENT_REFLECT_STRUCTURAL_UPDATE_FAILED_ERROR_CODE,
      "Mounted DOM structural projection failed.",
      cause,
    );
  }
}

function flatten_dom_content(
  content: readonly (HsonNode | Primitive)[],
  namespace: "html" | "svg",
  runtime: LiveTreeRuntime,
  ownerDocument: Document,
): Node[] {
  const result: Node[] = [];
  for (const item of content) {
    result.push(...flatten_dom_item(item, namespace, runtime, ownerDocument));
  }
  return result;
}

function flatten_dom_item(
  item: HsonNode | Primitive,
  namespace: "html" | "svg",
  runtime: LiveTreeRuntime,
  ownerDocument: Document,
): Node[] {
  if (!is_Node(item)) return [ownerDocument.createTextNode(String(item ?? ""))];
  if (item.$_tag === STR_TAG || item.$_tag === VAL_TAG) {
    return [ownerDocument.createTextNode(String(item.$_content[0] ?? ""))];
  }
  if (item.$_tag === ARR_TAG) {
    const result: Node[] = [];
    for (const wrapper of item.$_content) {
      const payload = is_Node(wrapper) ? wrapper.$_content[0] : undefined;
      if (payload !== undefined && payload !== null) {
        result.push(...flatten_dom_item(payload, namespace, runtime, ownerDocument));
      }
    }
    return result;
  }
  if (item.$_tag === ROOT_TAG || item.$_tag === OBJ_TAG || item.$_tag === ELEM_TAG) {
    return flatten_dom_content(item.$_content, namespace, runtime, ownerDocument);
  }
  const existing = get_el_for_node(item);
  if (existing !== undefined) return [existing];
  return [project_linked_livetree(item, namespace, runtime, ownerDocument)];
}

function validate_shadow_against_canonical(shadow: ShadowNode, canonical: HsonNode): void {
  if (shadow.node.$_tag !== canonical.$_tag) throw content_mismatch();
  if (!canonical_public_attrs_equal(shadow.attrs, must_attrs(canonical.$_attrs ?? {}))) throw content_mismatch();
  const canonicalQuid = is_ordinary_element_node(canonical) ? canonical.$_meta?.[HSON_META_QUID] : undefined;
  if (shadow.persistedQuid !== canonicalQuid) throw content_mismatch();
  if (shadow.content.length !== canonical.$_content.length) throw content_mismatch();
  for (let index = 0; index < shadow.content.length; index += 1) {
    const planned = shadow.content[index];
    const expected = canonical.$_content[index];
    if (is_shadow_node(planned) && is_Node(expected)) validate_shadow_against_canonical(planned, expected);
    else if (is_shadow_node(planned) || is_Node(expected) || !Object.is(planned, expected)) throw content_mismatch();
  }
}

function validate_final_quids(
  root: ShadowNode,
  oldNodes: ReadonlySet<HsonNode>,
  finalNodes: ReadonlySet<HsonNode>,
  runtime: LiveTreeRuntime,
): void {
  const byQuid = new Map<string, HsonNode>();
  walk_shadow(root, (shadow) => {
    const quid = shadow.persistedQuid;
    if (quid === undefined) return;
    const duplicate = byQuid.get(quid);
    if (duplicate !== undefined && duplicate !== shadow.node) {
      throw new DocumentReflectError(
        DOCUMENT_REFLECT_QUID_COLLISION_ERROR_CODE,
        "Projected structural result contains duplicate persisted QUIDs.",
      );
    }
    byQuid.set(quid, shadow.node);
    const registered = get_node_by_quid(quid, runtime);
    if (registered !== undefined && registered !== shadow.node
      && (!oldNodes.has(registered) || finalNodes.has(registered))) {
      throw new DocumentReflectError(
        DOCUMENT_REFLECT_QUID_COLLISION_ERROR_CODE,
        "Inserted persisted QUID is owned by another active LiveTree node.",
      );
    }
  });
}

function validate_incoming_quids(
  incomingRoots: readonly ShadowContent[],
  oldNodes: ReadonlySet<HsonNode>,
  finalNodes: ReadonlySet<HsonNode>,
  runtime: LiveTreeRuntime,
): void {
  const visited = new Set<ShadowNode>();
  const visit = (shadow: ShadowContent): void => {
    if (!is_shadow_node(shadow) || visited.has(shadow) || !finalNodes.has(shadow.node)) return;
    visited.add(shadow);
    const quid = shadow.persistedQuid;
    if (quid !== undefined) {
      const registered = get_node_by_quid(quid, runtime);
      if (registered !== undefined && registered !== shadow.node
        && (!oldNodes.has(registered) || finalNodes.has(registered))) {
        throw new DocumentReflectError(
          DOCUMENT_REFLECT_QUID_COLLISION_ERROR_CODE,
          "Inserted persisted QUID is owned by another active LiveTree node.",
        );
      }
    }
    for (const child of shadow.content) visit(child);
  };
  for (const root of incomingRoots) visit(root);
}

function index_shadow_quids(root: ShadowNode): ReadonlyMap<string, ShadowNode> {
  const byQuid = new Map<string, ShadowNode>();
  walk_shadow(root, (shadow) => {
    const quid = shadow.persistedQuid;
    if (quid === undefined) return;
    const prior = byQuid.get(quid);
    if (prior !== undefined && prior.node !== shadow.node) {
      throw new DocumentReflectError(
        DOCUMENT_REFLECT_QUID_COLLISION_ERROR_CODE,
        "Projected structural input contains duplicate active persisted QUIDs.",
      );
    }
    byQuid.set(quid, shadow);
  });
  return byQuid;
}

function detach_retained_projection_descendants(
  removedRoot: HsonNode,
  finalNodes: ReadonlySet<HsonNode>,
): void {
  const visit = (node: HsonNode): void => {
    if (finalNodes.has(node)) {
      const element = get_el_for_node(node);
      if (element !== undefined) {
        element.remove();
        return;
      }
    }
    for (const child of node.$_content) if (is_Node(child)) visit(child);
  };
  visit(removedRoot);
}

function prune_retained_graph_descendants(
  removedRoot: HsonNode,
  finalNodes: ReadonlySet<HsonNode>,
): void {
  const retained: Array<HsonNode | Primitive> = [];
  for (const item of removedRoot.$_content) {
    if (!is_Node(item)) {
      retained.push(item);
      continue;
    }
    if (finalNodes.has(item)) continue;
    prune_retained_graph_descendants(item, finalNodes);
    retained.push(item);
  }
  removedRoot.$_content = retained;
}

function find_removed_roots(root: HsonNode, finalNodes: ReadonlySet<HsonNode>): HsonNode[] {
  const removed: HsonNode[] = [];
  const walk = (node: HsonNode, parentRemoved: boolean): void => {
    const isRemoved = !finalNodes.has(node);
    if (isRemoved && !parentRemoved) removed.push(node);
    for (const child of node.$_content) if (is_Node(child)) walk(child, parentRemoved || isRemoved);
  };
  for (const child of root.$_content) if (is_Node(child)) walk(child, false);
  return removed;
}

function collect_shadow_nodes(root: ShadowNode, result: Set<HsonNode>): void {
  walk_shadow(root, (shadow) => result.add(shadow.node));
}

function walk_shadow(root: ShadowNode, visit: (node: ShadowNode) => void): void {
  visit(root);
  for (const child of root.content) if (is_shadow_node(child)) walk_shadow(child, visit);
}

function nearest_ordinary_owner(target: ShadowNode): ShadowNode {
  let current: ShadowNode | undefined = target;
  while (current !== undefined) {
    if (is_ordinary_element_node(current.node)) return current;
    current = current.parent;
  }
  throw new DocumentReflectError(
    DOCUMENT_REFLECT_CONTENT_PATH_INVALID_ERROR_CODE,
    "Structural target has no ordinary projected DOM owner.",
  );
}

function is_shadow_node(input: ShadowContent | undefined): input is ShadowNode {
  return typeof input === "object" && input !== null && "node" in input && "content" in input;
}

function must_attrs(input: unknown): CanonicalPublicAttrs {
  const attrs = decode_public_attrs(input);
  if (attrs !== undefined) return attrs;
  throw new DocumentReflectError(
    DOCUMENT_REFLECT_CONTENT_MISMATCH_ERROR_CODE,
    "Structural transaction contains invalid ordinary attributes.",
  );
}

function assert_insert_index(target: ShadowNode, index: number, operation: string): void {
  if (Number.isInteger(index) && index >= 0 && index <= target.content.length) return;
  throw content_index_error(operation, index);
}

function assert_existing_index(target: ShadowNode, index: number, operation: string): void {
  if (Number.isInteger(index) && index >= 0 && index < target.content.length) return;
  throw content_index_error(operation, index);
}

function content_path_error(operation: string): DocumentReflectError {
  return new DocumentReflectError(
    DOCUMENT_REFLECT_CONTENT_PATH_INVALID_ERROR_CODE,
    `Structural operation ${operation} does not resolve to a projected raw content target.`,
  );
}

function content_index_error(operation: string, index: number): DocumentReflectError {
  return new DocumentReflectError(
    DOCUMENT_REFLECT_CONTENT_INDEX_INVALID_ERROR_CODE,
    `Structural operation ${operation} has invalid raw content index ${index}.`,
  );
}

function content_mismatch(): DocumentReflectError {
  return new DocumentReflectError(
    DOCUMENT_REFLECT_CONTENT_MISMATCH_ERROR_CODE,
    "Planned projected structure does not match the canonical final graph.",
  );
}
