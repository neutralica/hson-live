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
  readonly persistedQuid?: string;
  readonly replacementSource?: HsonNode;
  attrs: CanonicalPublicAttrs;
  content: ShadowContent[];
};

export type DocumentStructuralPlan = Readonly<{
  root: ShadowNode;
  finalNodes: ReadonlySet<HsonNode>;
  removedRoots: readonly HsonNode[];
  affectedOwners: readonly HsonNode[];
  runtime: LiveTreeRuntime;
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
      case "insert-content":
        affectedOwners.add(nearest_ordinary_owner(target));
        assert_insert_index(target, operation.index, operation.op);
        {
          const inserted = shadow_insert_content(target, operation.content);
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
        const replacement = plan_replacement(target, current, operation.replacement);
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
  root.attrs = must_attrs(canonicalFinalRoot.$_attrs ?? {});
  root.content = canonicalFinalRoot.$_content.map((item, index) =>
    plan_root_replacement(root, root.content[index], item));

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
  return Object.freeze({ root, finalNodes, removedRoots, affectedOwners, runtime });
}

function plan_root_replacement(
  parent: ShadowNode,
  current: ShadowContent | undefined,
  replacement: HsonNode | Primitive,
): ShadowContent {
  if (!is_shadow_node(current) || !is_Node(replacement)) {
    return shadow_fresh(clone_node(replacement), parent);
  }
  if (!current.node.$_tag.startsWith(HSON_SYS_PREFIX) || !replacement.$_tag.startsWith(HSON_SYS_PREFIX)) {
    return plan_replacement(parent, current, replacement);
  }
  if (current.node.$_tag !== replacement.$_tag) {
    return shadow_fresh(clone_node(replacement), parent);
  }
  const shadow: ShadowNode = {
    node: current.node,
    fresh: false,
    parent,
    attrs: must_attrs(replacement.$_attrs ?? {}),
    content: [],
  };
  shadow.content = replacement.$_content.map((item, index) =>
    plan_root_replacement(shadow, current.content[index], item));
  return shadow;
}

/** Apply one fully validated structural plan through explicit internal graph/DOM machinery. */
export function apply_document_structural_transaction(plan: DocumentStructuralPlan): void {
  apply_shadow_node(plan.root);
  bind_graph_runtime(plan.root.node, plan.runtime);
  for (const removed of plan.removedRoots) {
    release_subtree_ownership(removed);
    dispose_node_deep(removed, plan.runtime);
  }
  admit_livetree_quid_graph_preserving_absence(plan.root.node, plan.runtime);
  index_subtree_ownership(plan.root.node);

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

function shadow_fresh(content: HsonNode | Primitive, parent?: ShadowNode): ShadowContent {
  if (!is_Node(content)) return content;
  const persistedQuid = is_ordinary_element_node(content) ? content.$_meta?.[HSON_META_QUID] : undefined;
  const shadow: ShadowNode = {
    node: content,
    fresh: true,
    ...(parent === undefined ? {} : { parent }),
    ...(persistedQuid === undefined ? {} : { persistedQuid }),
    attrs: must_attrs(content.$_attrs ?? {}),
    content: [],
  };
  shadow.content = content.$_content.map((item) => shadow_fresh(item, shadow));
  return shadow;
}

function shadow_insert_content(target: ShadowNode, content: HsonNode | Primitive): ShadowContent {
  if (target.node.$_tag === ELEM_TAG && typeof content === "string") {
    return shadow_fresh({ $_tag: STR_TAG, $_content: [content] }, target);
  }
  return shadow_fresh(clone_node(content), target);
}

function plan_replacement(
  parent: ShadowNode,
  current: ShadowContent | undefined,
  replacementInput: HsonNode | Primitive,
): ShadowContent {
  const replacement = clone_node(replacementInput);
  if (!is_shadow_node(current) || !is_Node(replacement)) {
    return shadow_fresh(replacement, parent);
  }
  const currentQuid = current.persistedQuid;
  const replacementQuid = is_ordinary_element_node(replacement)
    ? replacement.$_meta?.[HSON_META_QUID]
    : undefined;
  if (currentQuid === undefined || replacementQuid === undefined || currentQuid !== replacementQuid) {
    return shadow_fresh(replacement, parent);
  }
  if (!is_ordinary_element_node(current.node)
    || !is_ordinary_element_node(replacement)
    || current.node.$_tag !== replacement.$_tag) {
    return shadow_fresh(replacement, parent);
  }
  const shadow: ShadowNode = {
    node: current.node,
    fresh: false,
    parent,
    persistedQuid: currentQuid,
    replacementSource: replacement,
    attrs: must_attrs(replacement.$_attrs ?? {}),
    content: [],
  };
  shadow.content = replacement.$_content.map((item) => shadow_fresh(item, shadow));
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
  if (source.$_attrs === undefined) delete target.$_attrs;
  else target.$_attrs = clone_node(source.$_attrs);
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
