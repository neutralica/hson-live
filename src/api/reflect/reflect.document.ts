import { ELEM_TAG, STR_TAG, VAL_TAG, HSON_META_QUID, ROOT_TAG } from "../../core/constants.js";
import { clone_node } from "../../core/clone-node.js";
import { canonical_hson_graph_difference } from "../../core/canonical-hson-equal.js";
import { canonical_public_attrs_equal, decode_public_attrs } from "../../core/public-attrs.js";
import { is_Node, is_ordinary_element_node } from "../../core/node-guards.js";
import type { CanonicalPublicAttrs, HsonNode, Primitive } from "../../core/types.js";
import type {
  DocumentLiveMap,
  LiveMapDocumentLibrary,
  LiveMapCommitObservation,
  LiveMapDisposer,
  LiveMapDocumentCommitTarget,
  LiveMapDocumentPath,
  LiveMapGraphCommit,
  LiveMapGraphOp,
} from "../../types/livemap.types.js";
import { create_linked_livetree_in_runtime } from "../livetree/creation/create-livetree.js";
import { project_linked_livetree } from "../livetree/creation/project-live-tree.js";
import type { LiveTree } from "../livetree/livetree.js";
import {
  document_binding_for_node,
  LiveTreeLinkedIdentityRequiredError,
  register_document_binding_node,
  unregister_document_binding_node,
  type DocumentBindingNodeRegistration,
  type DocumentBoundAttrsMutation,
  type DocumentBoundTextMutation,
} from "../livetree/lifecycle/document-binding-state.js";
import { apply_projected_attrs_replacement } from "../livetree/managers/attr-handle.js";
import {
  HSON_QUID_MARKUP_NAME,
  preflight_livetree_quid_epoch_replacement,
  preflight_supplied_livetree_quid,
  reset_livetree_quid_epoch,
  type SuppliedLiveTreeQuidReservation,
} from "../livetree/quid/data-quid.js";
import { LiveTreeQuidReuseError } from "../livetree/livetree.error.js";
import {
  assert_node_element_link,
  get_dom_for_node,
  get_el_for_node,
  get_node_for_dom,
  get_node_for_el,
} from "../livetree/utils/node-map-helpers.js";
import { collect_subtree_nodes } from "../livetree/utils/subtree-traversal.js";
import { dispose_node_deep } from "../livetree/utils/dispose-node.js";
import {
  claim_node_parent,
  parent_for_node,
  release_node_parent,
  release_subtree_ownership,
} from "../livetree/lifecycle/graph-ownership.js";
import {
  DOCUMENT_REFLECT_ALREADY_BOUND_ERROR_CODE,
  DOCUMENT_REFLECT_DISPOSED_ERROR_CODE,
  DOCUMENT_REFLECT_DELEGATION_TARGET_INVALID_ERROR_CODE,
  DOCUMENT_REFLECT_DELEGATION_UNSUPPORTED_ERROR_CODE,
  DOCUMENT_REFLECT_DOM_MAPPING_MISMATCH_ERROR_CODE,
  DOCUMENT_REFLECT_NODE_KIND_MISMATCH_ERROR_CODE,
  DOCUMENT_REFLECT_QUID_COLLISION_ERROR_CODE,
  DOCUMENT_REFLECT_UPDATE_FAILED_ERROR_CODE,
  DOCUMENT_REFLECT_QUID_MISMATCH_ERROR_CODE,
  DOCUMENT_REFLECT_REVISION_GAP_ERROR_CODE,
  DOCUMENT_REFLECT_ROOT_REPLACEMENT_FAILED_ERROR_CODE,
  DOCUMENT_REFLECT_SNAPSHOT_REVISION_MISMATCH_ERROR_CODE,
  DOCUMENT_REFLECT_TARGET_MISSING_ERROR_CODE,
  DOCUMENT_REFLECT_UNSUPPORTED_OPERATION_ERROR_CODE,
  DocumentMirrorError,
} from "./reflect.document.error.js";
import {
  apply_document_structural_transaction,
  plan_document_structural_transaction,
} from "./reflect.document.structure.js";
import {
  document_root_from_root,
  plan_document_root_convergence,
  type DocumentRootMaterial,
} from "./reflect.document.root.js";
import {
  bind_graph_runtime,
  default_livetree_runtime,
  release_nodes_runtime,
  runtime_for_node,
  runtime_for_tree,
  runtime_owns_document,
  type LiveTreeRuntime,
} from "../livetree/runtime/livetree-runtime.js";
import {
  assert_browser_realization_mappings,
  browser_parent_namespace_for_target,
  match_browser_realization_root,
} from "../../internal/browser-realization/browser-realization-dom.js";
import {
  lower_browser_attribute_value,
  plan_browser_realization,
} from "../../internal/browser-realization/browser-realization-plan.js";
import {
  livemap_document_identity_effects_for,
  livemap_document_identity_overlay_for,
  type LiveMapDocumentIdentityEffect,
} from "../livemap/livemap.document.identity.js";
import {
  LiveMapDocumentIdentityParticipantCollisionError,
  livemap_document_identity_reservation_for,
  register_livemap_document_identity_participant,
  require_livemap_document_canonical_identity,
  type LiveMapDocumentIdentityAppliedClaim,
  type LiveMapDocumentIdentityCommitReservation,
} from "../livemap/livemap.document.registration.js";
import { livemap_document_observation_evidence } from "../livemap/livemap.document.capture.js";
import {
  append_document_path,
  document_path_effect_for_graph_operation,
  document_path_equal,
  document_path_is_prefix,
  encode_document_path,
  transform_document_path,
  validate_document_path,
} from "../livemap/livemap.document.path.js";
import {
  echo_document_authority_for,
  type EchoDocumentAction,
} from "../echo/echo.document-authority.js";

export type DocumentMirrorStatus = "initializing" | "active" | "replacing" | "failed" | "disposed";

export type DocumentMirror = Readonly<{
  readonly tree: LiveTree;
  readonly status: DocumentMirrorStatus;
  readonly sourceRevision: number;
  readonly failure: DocumentMirrorError | undefined;
  diagnostics: () => Readonly<{
    updatesApplied: number;
    registeredElements: number;
    wholeCorrespondenceBuilds: number;
    incrementalCorrespondenceUpdates: number;
    correspondenceEntriesChanged: number;
    identityEffectsConsumed: number;
  }>;
  dispose: () => void;
}>;

type ProjectedRegistration = Omit<DocumentBindingNodeRegistration, "canonicalTarget" | "canonicalPath"> & Readonly<{
  canonicalTarget: LiveMapDocumentCommitTarget;
  canonicalPath: LiveMapDocumentPath;
  node: HsonNode;
}>;

type ReflectableDocumentMap = DocumentLiveMap | LiveMapDocumentLibrary;

const ACTIVE_DOCUMENT_BINDINGS = new WeakSet<object>();

/** Internal attribute-only proof that projects one DocumentLiveMap into one LiveTree. */
export function reflect_document(
  map: ReflectableDocumentMap,
): DocumentMirror {
  return reflect_document_in_runtime(map, default_livetree_runtime());
}

/** Bind a document projection into an already-selected LiveTree runtime. @internal */
export function reflect_document_in_runtime(
  map: ReflectableDocumentMap,
  runtime: LiveTreeRuntime,
): DocumentMirror {
  return reflect_document_binding_in_runtime(map, runtime, undefined);
}

/** Bind an admitted ordinary-root LiveTree without projecting initial state. @internal */
export function reflect_existing_document_in_runtime(
  map: ReflectableDocumentMap,
  existingTree: LiveTree,
  runtime: LiveTreeRuntime,
): DocumentMirror {
  return reflect_document_binding_in_runtime(map, runtime, existingTree);
}

function reflect_document_binding_in_runtime(
  map: ReflectableDocumentMap,
  runtime: LiveTreeRuntime,
  borrowedTree: LiveTree | undefined,
): DocumentMirror {
  if (ACTIVE_DOCUMENT_BINDINGS.has(map)) {
    throw new DocumentMirrorError(
      DOCUMENT_REFLECT_ALREADY_BOUND_ERROR_CODE,
      "DocumentLiveMap already has an active document projection binding.",
    );
  }
  ACTIVE_DOCUMENT_BINDINGS.add(map);

  let capturedRevision: number;
  let sourceRoot: HsonNode;
  try {
    capturedRevision = map.rev;
    sourceRoot = map.root();
  } catch (cause) {
    ACTIVE_DOCUMENT_BINDINGS.delete(map);
    throw as_binding_error(cause, DOCUMENT_REFLECT_UPDATE_FAILED_ERROR_CODE, "Initial document binding capture failed.");
  }
  const borrowed = borrowedTree !== undefined;
  let tree: LiveTree;
  let projectedRoot: HsonNode;
  let borrowedCarrier: HsonNode | undefined;
  try {
    if (borrowedTree === undefined) {
      tree = create_linked_livetree_in_runtime(sourceRoot, runtime);
      projectedRoot = tree.node;
    } else {
      tree = borrowedTree;
      borrowedCarrier = validate_borrowed_document_tree(sourceRoot, tree, runtime);
      projectedRoot = borrowedCarrier;
      bind_graph_runtime(borrowedCarrier, runtime);
      claim_node_parent(tree.node, borrowedCarrier);
    }
  } catch (cause) {
    ACTIVE_DOCUMENT_BINDINGS.delete(map);
    throw as_binding_error(cause, DOCUMENT_REFLECT_UPDATE_FAILED_ERROR_CODE, borrowed
      ? "Existing LiveTree document binding validation failed."
      : "Initial LiveTree projection construction failed.");
  }

  const owner = {};
  let registrations: ProjectedRegistration[] = [];
  const byPath = new Map<string, ProjectedRegistration>();
  const byQuid = new Map<string, ProjectedRegistration>();
  const runtimeEpochQuids = new Set<string>();
  const mountedElements = new WeakMap<HsonNode, Element>();
  const observedDomIdentity = new WeakSet<Element>();
  let currentStatus: DocumentMirrorStatus = "initializing";
  let currentRevision = capturedRevision;
  let currentFailure: DocumentMirrorError | undefined;
  let updatesApplied = 0;
  let wholeCorrespondenceBuilds = 0;
  let incrementalCorrespondenceUpdates = 0;
  let correspondenceEntriesChanged = 0;
  let identityEffectsConsumed = 0;
  let off: LiveMapDisposer | undefined;
  let offIdentityParticipant: (() => void) | undefined;
  let rootRegistration: DocumentBindingNodeRegistration | undefined;

  const release_borrowed_carrier = (): void => {
    if (borrowedCarrier === undefined) return;
    release_node_parent(tree.node, borrowedCarrier);
    release_nodes_runtime([borrowedCarrier], runtime);
    borrowedCarrier = undefined;
    projectedRoot = tree.node;
  };

  // Publish the fail-closed state before releasing callbacks so any cleanup
  // reentry observes a terminal binding and cannot delegate another mutation.
  const fail = (failure: DocumentMirrorError): void => {
    if (currentStatus === "failed" || currentStatus === "disposed") return;
    currentFailure = failure;
    currentStatus = "failed";
    const disposeObserver = off;
    off = undefined;
    disposeObserver?.();
    offIdentityParticipant?.();
    offIdentityParticipant = undefined;
  };

  const assert_delegation_ready = (registration: ProjectedRegistration): void => {
    if (currentStatus === "failed") throw currentFailure;
    if (currentStatus !== "active") {
      throw new DocumentMirrorError(
        DOCUMENT_REFLECT_UPDATE_FAILED_ERROR_CODE,
        "Document binding is not active for canonical attribute delegation.",
      );
    }
    validate_bound_registration(registration);
    const canonical = read_map_attrs(map, registration.canonicalTarget);
    const projected = read_projected_attrs(registration.node);
    if (!canonical_public_attrs_equal(canonical, projected)) {
      const failure = new DocumentMirrorError(
        DOCUMENT_REFLECT_UPDATE_FAILED_ERROR_CODE,
        "Projected attributes diverged from the canonical document before delegation.",
      );
      fail(failure);
      throw failure;
    }
  };

  const delegate_attrs = (
    registration: ProjectedRegistration,
    mutation: DocumentBoundAttrsMutation,
  ): void => {
    assert_delegation_ready(registration);
    const authority = echo_document_authority_for(map);
    if (authority !== undefined) {
      throw new DocumentMirrorError(
        DOCUMENT_REFLECT_UNSUPPORTED_OPERATION_ERROR_CODE,
        "Synchronous LiveTree document authoring requires tree.async while authority-bound.",
      );
    }
    execute_document_action(map, lower_attrs_action(registration.canonicalTarget, mutation));
  };

  const delegate_attrs_async = async (
    registration: ProjectedRegistration,
    mutation: DocumentBoundAttrsMutation,
  ): Promise<void> => {
    assert_delegation_ready(registration);
    const authority = echo_document_authority_for(map);
    if (authority !== undefined) {
      await authority.enqueue(() => {
        assert_delegation_ready(registration);
        return lower_attrs_action(registration.canonicalTarget, mutation);
      });
      return;
    }
    execute_document_action(map, lower_attrs_action(registration.canonicalTarget, mutation));
  };

  const execute_document_action = (
    targetMap: ReflectableDocumentMap,
    action: EchoDocumentAction,
  ): void => {
    switch (action.name) {
      case "document.attrs.set": targetMap.document.attrs.set(action.payload.target, action.payload.name, action.payload.value); return;
      case "document.attrs.setMany": targetMap.document.attrs.setMany(action.payload.target, action.payload.values); return;
      case "document.attrs.drop": targetMap.document.attrs.drop(action.payload.target, action.payload.name); return;
      case "document.attrs.dropMany": targetMap.document.attrs.dropMany(action.payload.target, action.payload.names); return;
      case "document.attrs.clear": targetMap.document.attrs.clear(action.payload.target); return;
      case "document.attrs.replace": targetMap.document.attrs.replace(action.payload.target, action.payload.values); return;
      case "document.content.insert": targetMap.document.content.insert(action.payload.target, action.payload.index, action.payload.content); return;
      case "document.content.replace": targetMap.document.content.replace(action.payload.target, action.payload.index, action.payload.replacement); return;
      case "document.content.remove": targetMap.document.content.remove(action.payload.target, action.payload.index); return;
      case "document.content.move": targetMap.document.content.move(action.payload.target, action.payload.from, action.payload.to); return;
    }
  };

  const lower_attrs_action = (
    target: LiveMapDocumentCommitTarget,
    mutation: DocumentBoundAttrsMutation,
  ): EchoDocumentAction => {
    if (mutation.kind === "transform") {
      return lower_attrs_action(target, mutation.apply(read_map_attrs(map, target)));
    }
    switch (mutation.kind) {
      case "set": return Object.freeze({ name: "document.attrs.set", payload: { target, name: mutation.name, value: mutation.value } });
      case "setMany": return Object.freeze({ name: "document.attrs.setMany", payload: { target, values: mutation.values } });
      case "drop": return Object.freeze({ name: "document.attrs.drop", payload: { target, name: mutation.name } });
      case "dropMany": return Object.freeze({ name: "document.attrs.dropMany", payload: { target, names: mutation.names } });
      case "clear": return Object.freeze({ name: "document.attrs.clear", payload: { target } });
      case "replace": return Object.freeze({ name: "document.attrs.replace", payload: { target, values: mutation.values } });
    }
  };

  const canonical_node_for = (registration: ProjectedRegistration): HsonNode => {
    assert_delegation_ready(registration);
    const canonical = resolve_raw_node(
      map.root(),
      registration.canonicalPath,
    );
    if (canonical === undefined || !is_ordinary_element_node(canonical)) {
      throw new DocumentMirrorError(
        DOCUMENT_REFLECT_DELEGATION_TARGET_INVALID_ERROR_CODE,
        "Bound mutation target no longer resolves to a canonical ordinary element.",
      );
    }
    if (canonical.$_tag !== registration.node.$_tag) {
      throw new DocumentMirrorError(
        DOCUMENT_REFLECT_DELEGATION_TARGET_INVALID_ERROR_CODE,
        "Bound mutation target kind differs from its canonical element.",
      );
    }
    return canonical;
  };

  const delegate_text = (
    registration: ProjectedRegistration,
    mutation: DocumentBoundTextMutation,
  ): void => {
    assert_delegation_ready(registration);
    const authority = echo_document_authority_for(map);
    if (authority !== undefined) {
      throw new DocumentMirrorError(
        DOCUMENT_REFLECT_UNSUPPORTED_OPERATION_ERROR_CODE,
        "Synchronous LiveTree document authoring requires tree.async while authority-bound.",
      );
    }
    execute_document_action(map, lower_text_action(registration, mutation));
  };

  const delegate_text_async = async (
    registration: ProjectedRegistration,
    mutation: DocumentBoundTextMutation,
  ): Promise<void> => {
    assert_delegation_ready(registration);
    const authority = echo_document_authority_for(map);
    if (authority !== undefined) {
      await authority.enqueue(() => lower_text_action(registration, mutation));
      return;
    }
    execute_document_action(map, lower_text_action(registration, mutation));
  };

  const lower_text_action = (
    registration: ProjectedRegistration,
    mutation: DocumentBoundTextMutation,
  ): EchoDocumentAction => {
    const canonical = canonical_node_for(registration);
    if (mutation.kind === "overwrite") {
      throw delegation_unsupported("text.overwrite changes complete effective content without one exact map operation");
    }
    const text = mutation.value === null ? "" : String(mutation.value);
    if (canonical.$_content.length === 0) {
      const bucket: HsonNode = { $_tag: ELEM_TAG, $_content: [{ $_tag: STR_TAG, $_content: [text] }] };
      return Object.freeze({ name: "document.content.insert", payload: { target: registration.canonicalTarget, index: 0, content: bucket } });
    }
    if (canonical.$_content.length !== 1) {
      throw delegation_unsupported("text mutation requires one canonical _hson_elem content bucket");
    }
    const bucket = canonical.$_content[0];
    if (!is_Node(bucket) || bucket.$_tag !== ELEM_TAG) {
      throw delegation_unsupported("text mutation requires canonical _hson_elem storage");
    }
    const bucketTarget: LiveMapDocumentCommitTarget = Object.freeze({
      kind: "path",
      path: validate_document_path([...registration.canonicalPath, 0]),
    });
    if (mutation.kind === "add") {
      return Object.freeze({ name: "document.content.insert", payload: { target: bucketTarget, index: bucket.$_content.length, content: text } });
    }
    if (mutation.kind === "insert") {
      const index = Number.isFinite(mutation.index)
        ? Math.max(0, Math.min(bucket.$_content.length, Math.floor(mutation.index)))
        : bucket.$_content.length;
      return Object.freeze({ name: "document.content.insert", payload: { target: bucketTarget, index, content: text } });
    }
    const leafIndexes = bucket.$_content.flatMap((item, index) =>
      is_Node(item) && (item.$_tag === STR_TAG || item.$_tag === VAL_TAG) ? [index] : []);
    if (leafIndexes.length === 0) {
      return Object.freeze({ name: "document.content.insert", payload: { target: bucketTarget, index: 0, content: text } });
    }
    if (leafIndexes.length !== 1) {
      throw delegation_unsupported("text.set would need more than one canonical content mutation");
    }
    return Object.freeze({
      name: "document.content.replace",
      payload: { target: bucketTarget, index: leafIndexes[0]!, replacement: { $_tag: STR_TAG, $_content: [text] } },
    });
  };

  const delegate_empty = (registration: ProjectedRegistration): void => {
    assert_delegation_ready(registration);
    const authority = echo_document_authority_for(map);
    if (authority !== undefined) {
      throw new DocumentMirrorError(
        DOCUMENT_REFLECT_UNSUPPORTED_OPERATION_ERROR_CODE,
        "Synchronous LiveTree document authoring requires tree.async while authority-bound.",
      );
    }
    const action = lower_empty_action(registration);
    if (action !== undefined) execute_document_action(map, action);
  };

  const delegate_empty_async = async (registration: ProjectedRegistration): Promise<void> => {
    assert_delegation_ready(registration);
    const authority = echo_document_authority_for(map);
    if (authority !== undefined) {
      await authority.enqueue(() => lower_empty_action(registration));
      return;
    }
    const action = lower_empty_action(registration);
    if (action !== undefined) execute_document_action(map, action);
  };

  const lower_empty_action = (registration: ProjectedRegistration): EchoDocumentAction | undefined => {
    const canonical = canonical_node_for(registration);
    if (canonical.$_content.length === 0) return undefined;
    if (canonical.$_content.length !== 1) {
      throw delegation_unsupported("empty would need more than one canonical content mutation");
    }
    return Object.freeze({ name: "document.content.remove", payload: { target: registration.canonicalTarget, index: 0 } });
  };

  const dispose_binding = (): void => {
    if (currentStatus === "disposed") return;
    const disposeObserver = off;
    off = undefined;
    disposeObserver?.();
    offIdentityParticipant?.();
    offIdentityParticipant = undefined;
    for (const registration of registrations) unregister_document_binding_node(registration.node, owner);
    if (rootRegistration !== undefined) {
      unregister_document_binding_node(projectedRoot, owner);
      rootRegistration = undefined;
    }
    byPath.clear();
    byQuid.clear();
    release_borrowed_carrier();
    ACTIVE_DOCUMENT_BINDINGS.delete(map);
    currentStatus = "disposed";
  };

  const delegate_remove = (registration: ProjectedRegistration): boolean => {
    canonical_node_for(registration);
    if (borrowed && registration.node === tree.node) {
      throw new DocumentMirrorError(
        DOCUMENT_REFLECT_UNSUPPORTED_OPERATION_ERROR_CODE,
        "Borrowed document root removal is unavailable while document-bound.",
      );
    }
    if (registration.canonicalPath.length === 0) {
      // Root removal is terminal lifecycle of the borrowed projection, not a
      // canonical LiveMap edit. Stop the bridge first, then let LiveTree own
      // its normal runtime teardown.
      dispose_binding();
      return false;
    }
    const lower = (): EchoDocumentAction => lower_remove_action(registration);
    const authority = echo_document_authority_for(map);
    if (authority !== undefined) {
      throw new DocumentMirrorError(
        DOCUMENT_REFLECT_UNSUPPORTED_OPERATION_ERROR_CODE,
        "Synchronous LiveTree document authoring requires tree.async while authority-bound.",
      );
    }
    execute_document_action(map, lower());
    return true;
  };

  const lower_remove_action = (registration: ProjectedRegistration): EchoDocumentAction => {
      canonical_node_for(registration);
      let index = registration.canonicalPath[registration.canonicalPath.length - 1]!;
      let parentPath = validate_document_path(registration.canonicalPath.slice(0, -1));
      const parent = resolve_raw_node(map.root(), parentPath);
      if (parent !== undefined && parent.$_tag === ELEM_TAG && parent.$_content.length === 1 && parentPath.length > 0) {
        index = parentPath[parentPath.length - 1]!;
        parentPath = validate_document_path(parentPath.slice(0, -1));
      }
      return Object.freeze({
        name: "document.content.remove",
        payload: { target: Object.freeze({ kind: "path", path: parentPath }), index },
      });
  };

  const delegate_remove_async = async (registration: ProjectedRegistration): Promise<void> => {
    canonical_node_for(registration);
    if (borrowed && registration.node === tree.node) {
      throw new DocumentMirrorError(
        DOCUMENT_REFLECT_UNSUPPORTED_OPERATION_ERROR_CODE,
        "Borrowed document root removal is unavailable while document-bound.",
      );
    }
    if (registration.canonicalPath.length === 0) {
      throw new DocumentMirrorError(
        DOCUMENT_REFLECT_UNSUPPORTED_OPERATION_ERROR_CODE,
        "Root removal is not part of AsyncLiveTree document authoring.",
      );
    }
    const lower = (): EchoDocumentAction => lower_remove_action(registration);
    const authority = echo_document_authority_for(map);
    if (authority !== undefined) {
      await authority.enqueue(lower);
      return;
    }
    execute_document_action(map, lower());
  };

  const reject_structural_mutation = (operation: string): never => {
    if (currentStatus === "failed") throw currentFailure;
    throw new DocumentMirrorError(
      DOCUMENT_REFLECT_UNSUPPORTED_OPERATION_ERROR_CODE,
      `Public LiveTree structural mutation ${operation} is unavailable while document-bound.`,
    );
  };

  const register_root_lifecycle = (): void => {
    const root = projectedRoot;
    const canonicalTarget: LiveMapDocumentCommitTarget = Object.freeze({
      kind: "path",
      path: validate_document_path([]),
    });
    rootRegistration = Object.freeze({
      owner,
      canonicalTarget,
      canonicalPath: canonicalTarget.path,
      requireCanonicalIdentity: (): never => {
        throw new LiveTreeLinkedIdentityRequiredError("QUID access on internal document root");
      },
      delegateAttrs: (): never => reject_structural_mutation("mutate internal document-root attributes"),
      delegateAttrsAsync: async (): Promise<never> => reject_structural_mutation("mutate internal document-root attributes"),
      delegateText: (): never => reject_structural_mutation("mutate internal document-root text"),
      delegateTextAsync: async (): Promise<never> => reject_structural_mutation("mutate internal document-root text"),
      delegateEmpty: (): never => reject_structural_mutation("empty internal document root"),
      delegateEmptyAsync: async (): Promise<never> => reject_structural_mutation("empty internal document root"),
      delegateRemove: (): false => {
        dispose_binding();
        return false;
      },
      delegateRemoveAsync: async (): Promise<never> => reject_structural_mutation("remove internal document root"),
      rejectStructuralMutation: reject_structural_mutation,
    });
    register_document_binding_node(root, rootRegistration);
  };

  const register = (node: HsonNode, canonicalPath: readonly number[]): void => {
    if (!is_ordinary_element_node(node)) return;
    const path = validate_document_path(canonicalPath);
    const pathKey = path_key(path);
    const persistedQuid = livemap_document_identity_overlay_for(map.document)
      .quidAtPath(path);
    if (node.$_meta?.[HSON_META_QUID] !== persistedQuid) {
      throw new DocumentMirrorError(
        DOCUMENT_REFLECT_QUID_MISMATCH_ERROR_CODE,
        "Projected element did not preserve its canonical persisted QUID.",
      );
    }
    const canonicalTarget: LiveMapDocumentCommitTarget = Object.freeze({ kind: "path", path });
    let registration: ProjectedRegistration;
    registration = Object.freeze({
      owner,
      node,
      canonicalPath: path,
      canonicalTarget,
      ...(persistedQuid === undefined ? {} : { persistedQuid }),
      requireCanonicalIdentity: () => {
        if (persistedQuid === undefined && echo_document_authority_for(map)?.rejectIdentityDemand === true) {
          throw new LiveTreeLinkedIdentityRequiredError("hosted QUID demand");
        }
        return require_livemap_document_canonical_identity(map.document, registration.canonicalTarget);
      },
      delegateAttrs: (mutation) => delegate_attrs(registration, mutation),
      delegateAttrsAsync: (mutation) => delegate_attrs_async(registration, mutation),
      delegateText: (mutation) => delegate_text(registration, mutation),
      delegateTextAsync: (mutation) => delegate_text_async(registration, mutation),
      delegateEmpty: () => delegate_empty(registration),
      delegateEmptyAsync: () => delegate_empty_async(registration),
      delegateRemove: () => delegate_remove(registration),
      delegateRemoveAsync: () => delegate_remove_async(registration),
      rejectStructuralMutation: reject_structural_mutation,
    });
    if (byPath.has(pathKey)) {
      throw new DocumentMirrorError(
        DOCUMENT_REFLECT_TARGET_MISSING_ERROR_CODE,
        "Document projection produced duplicate canonical-path correspondence.",
      );
    }
    if (persistedQuid !== undefined && byQuid.has(persistedQuid)) {
      throw new DocumentMirrorError(
        DOCUMENT_REFLECT_QUID_MISMATCH_ERROR_CODE,
        "Document projection produced duplicate persisted-QUID correspondence.",
      );
    }
    register_document_binding_node(node, registration);
    registrations.push(registration);
    byPath.set(pathKey, registration);
    if (persistedQuid !== undefined) {
      byQuid.set(persistedQuid, registration);
      runtimeEpochQuids.add(persistedQuid);
    }
  };

  const walk = (node: HsonNode, path: readonly number[]): void => {
    register(node, path);
    for (let index = 0; index < node.$_content.length; index += 1) {
      const child = node.$_content[index];
      if (is_Node(child)) walk(child, [...path, index]);
    }
  };

  const prune_removed_registrations = (finalNodes: ReadonlySet<HsonNode>): void => {
    const surviving: ProjectedRegistration[] = [];
    for (const registration of registrations) {
      if (finalNodes.has(registration.node)) surviving.push(registration);
      else unregister_document_binding_node(registration.node, owner);
    }
    registrations = surviving;
  };

  const rebuild_correspondence = (): void => {
    for (const registration of registrations) unregister_document_binding_node(registration.node, owner);
    registrations = [];
    byPath.clear();
    byQuid.clear();
    walk(projectedRoot, []);
    wholeCorrespondenceBuilds += 1;
  };

  const refresh_registration_at_path = (path: LiveMapDocumentPath): void => {
    const prior = byPath.get(path_key(path));
    if (prior === undefined) {
      throw new DocumentMirrorError(
        DOCUMENT_REFLECT_TARGET_MISSING_ERROR_CODE,
        "Canonical identity registration has no exact projected correspondence.",
      );
    }
    unregister_document_binding_node(prior.node, owner);
    registrations = registrations.filter((registration) => registration !== prior);
    byPath.delete(path_key(path));
    if (prior.persistedQuid !== undefined) byQuid.delete(prior.persistedQuid);
    register(prior.node, path);
  };

  const preflight_identity_operations = (
    operations: readonly LiveMapGraphOp[],
  ): LiveMapDocumentIdentityCommitReservation => {
    type Pending = { registration: ProjectedRegistration; path: LiveMapDocumentPath };
    type Claim = {
      registration: ProjectedRegistration;
      node: HsonNode;
      quid: string;
      path: LiveMapDocumentPath | undefined;
      reservation: SuppliedLiveTreeQuidReservation;
    };
    let pending: Pending[] = registrations.map((registration) => ({
      registration,
      path: registration.canonicalPath,
    }));
    const claims: Claim[] = [];

    try {
      for (const operation of operations) {
        if (operation.op === "ensure-quid") {
          const pendingTarget = pending.find((entry) => document_path_equal(entry.path, operation.target.path));
          if (pendingTarget === undefined) {
            throw new DocumentMirrorError(
              DOCUMENT_REFLECT_TARGET_MISSING_ERROR_CODE,
              "Canonical identity registration target has no exact projected correspondence.",
            );
          }
          validate_bound_registration(pendingTarget.registration);
          const activeCollision = runtime.quidToNode.get(operation.quid);
          const pendingCollision = runtime.pendingQuidClaims.get(operation.quid);
          if ((activeCollision !== undefined && activeCollision !== pendingTarget.registration.node)
            || (pendingCollision !== undefined && pendingCollision !== pendingTarget.registration.node)) {
            throw new LiveMapDocumentIdentityParticipantCollisionError(
              "Canonical QUID candidate collides in the selected LiveTree runtime.",
            );
          }
          let runtimeReservation: SuppliedLiveTreeQuidReservation;
          try {
            runtimeReservation = preflight_supplied_livetree_quid(
              pendingTarget.registration.node,
              operation.quid,
              runtime,
            );
          } catch (cause) {
            if (cause instanceof LiveTreeQuidReuseError) {
              throw new LiveMapDocumentIdentityParticipantCollisionError(
                "Canonical QUID candidate was already issued in the selected LiveTree runtime.",
                { cause },
              );
            }
            throw new DocumentMirrorError(
              DOCUMENT_REFLECT_QUID_MISMATCH_ERROR_CODE,
              "Projected node cannot accept the supplied canonical QUID.",
              cause,
            );
          }
          claims.push({
            registration: pendingTarget.registration,
            node: pendingTarget.registration.node,
            quid: operation.quid,
            path: pendingTarget.path,
            reservation: runtimeReservation,
          });
          continue;
        }

        const effect = document_path_effect_for_graph_operation(operation);
        if (effect === undefined) continue;
        if (effect.kind === "replace-root") {
          throw new DocumentMirrorError(
            DOCUMENT_REFLECT_UNSUPPORTED_OPERATION_ERROR_CODE,
            "Identity registration cannot compose with root replacement.",
          );
        }
        pending = pending.flatMap((entry) => {
          const transformed = transform_document_path(entry.path, effect);
          return transformed.kind === "retired"
            ? []
            : transformed.kind === "invalid"
              ? (() => { throw new DocumentMirrorError(DOCUMENT_REFLECT_UPDATE_FAILED_ERROR_CODE, transformed.reason); })()
              : [{ registration: entry.registration, path: transformed.path }];
        });
        for (const claim of claims) {
          if (claim.path === undefined) continue;
          const transformed = transform_document_path(claim.path, effect);
          if (transformed.kind === "invalid") {
            throw new DocumentMirrorError(DOCUMENT_REFLECT_UPDATE_FAILED_ERROR_CODE, transformed.reason);
          }
          claim.path = transformed.kind === "retired" ? undefined : transformed.path;
        }
      }
    } catch (cause) {
      for (const claim of claims) claim.reservation.release();
      throw cause;
    }

    let applied = false;
    const appliedClaims: LiveMapDocumentIdentityAppliedClaim[] = [];
    const claimed: Claim[] = [];
    return Object.freeze({
      get applied() { return applied; },
      apply(): readonly LiveMapDocumentIdentityAppliedClaim[] {
        if (applied) return Object.freeze([...appliedClaims]);
        try {
          for (const claim of claims) {
            if (claim.path === undefined) continue;
            if (resolve_raw_node(projectedRoot, claim.path) !== claim.node) {
              throw new DocumentMirrorError(
                DOCUMENT_REFLECT_TARGET_MISSING_ERROR_CODE,
                "Preflighted identity target no longer resolves to the same exact projected node.",
              );
            }
            claim.reservation.claim();
            claimed.push(claim);
            appliedClaims.push(Object.freeze({ path: claim.path, quid: claim.quid }));
          }
          applied = true;
          return Object.freeze([...appliedClaims]);
        } catch (cause) {
          for (const claim of claimed.reverse()) claim.reservation.rollback();
          throw cause;
        }
      },
      rollback(): void {
        if (!applied) return;
        for (const claim of claimed.reverse()) claim.reservation.rollback();
        claimed.length = 0;
        appliedClaims.length = 0;
        applied = false;
      },
      release(): void {
        for (const claim of claims) claim.reservation.release();
      },
    });
  };

  const verify_existing_identity = (path: LiveMapDocumentPath, quid: string): void => {
    const registration = byPath.get(path_key(path));
    if (registration === undefined || registration.persistedQuid !== quid) {
      throw new DocumentMirrorError(
        DOCUMENT_REFLECT_QUID_MISMATCH_ERROR_CODE,
        "Canonical identity is not registered to the expected projected correspondence.",
      );
    }
    validate_bound_registration(registration);
    if (runtime.quidToNode.get(quid) !== registration.node
      || runtime.nodeToQuid.get(registration.node) !== quid) {
      throw new DocumentMirrorError(
        DOCUMENT_REFLECT_QUID_MISMATCH_ERROR_CODE,
        "Canonical identity disagrees with the selected LiveTree runtime registry.",
      );
    }
  };

  const consume_identity_effects = (
    commit: LiveMapGraphCommit,
  ): readonly LiveMapDocumentIdentityEffect[] => {
    const effects = livemap_document_identity_effects_for(commit);
    if (effects === undefined) {
      throw new DocumentMirrorError(
        DOCUMENT_REFLECT_QUID_MISMATCH_ERROR_CODE,
        "Changed document commit is missing its derived identity-effect evidence.",
      );
    }
    const expected = new Map<string, LiveMapDocumentPath | undefined>();
    let expectedSize = byQuid.size;

    const current_path = (quid: string): LiveMapDocumentPath | undefined => {
      if (expected.has(quid)) return expected.get(quid);
      return byQuid.get(quid)?.canonicalPath;
    };

    const require_path = (
      quid: string,
      path: LiveMapDocumentPath,
      kind: LiveMapDocumentIdentityEffect["kind"],
    ): void => {
      const current = current_path(quid);
      if (current === undefined || !document_path_equal(current, path)) {
        throw new DocumentMirrorError(
          DOCUMENT_REFLECT_QUID_MISMATCH_ERROR_CODE,
          `Derived ${kind} identity effect disagrees with projected correspondence for QUID ${JSON.stringify(quid)}.`,
        );
      }
    };

    for (const effect of effects) {
      if (effect.kind === "preserved") {
        require_path(effect.quid, effect.path, effect.kind);
        expected.set(effect.quid, effect.path);
        continue;
      }
      if (effect.kind === "moved") {
        require_path(effect.quid, effect.from, effect.kind);
        expected.set(effect.quid, effect.to);
        continue;
      }
      if (effect.kind === "retired") {
        require_path(effect.quid, effect.formerPath, effect.kind);
        expected.set(effect.quid, undefined);
        expectedSize -= 1;
        continue;
      }
      if (current_path(effect.quid) !== undefined) {
        throw new DocumentMirrorError(
          DOCUMENT_REFLECT_QUID_MISMATCH_ERROR_CODE,
          `Derived introduced identity effect duplicates active QUID ${JSON.stringify(effect.quid)}.`,
        );
      }
      expected.set(effect.quid, effect.path);
      expectedSize += 1;
    }

    const overlay = livemap_document_identity_overlay_for(map.document);
    if (overlay.size !== expectedSize) {
      throw new DocumentMirrorError(
        DOCUMENT_REFLECT_QUID_MISMATCH_ERROR_CODE,
        "Derived identity effects do not account for the canonical final sparse overlay.",
      );
    }
    for (const [quid, path] of expected) {
      const finalPath = overlay.pathForQuid(quid);
      const mismatch = path === undefined
        ? finalPath !== undefined
        : finalPath === undefined
          || !document_path_equal(finalPath, path)
          || overlay.quidAtPath(path) !== quid;
      if (mismatch) {
        throw new DocumentMirrorError(
          DOCUMENT_REFLECT_QUID_MISMATCH_ERROR_CODE,
          `Derived identity effects disagree with the canonical final path for QUID ${JSON.stringify(quid)}.`,
        );
      }
    }
    identityEffectsConsumed += effects.length;
    return effects;
  };

  const reconcile_correspondence_incrementally = (
    operations: readonly LiveMapGraphOp[],
  ): void => {
    type PendingRegistration = {
      registration: ProjectedRegistration;
      path: LiveMapDocumentPath;
      changed: boolean;
    };
    let pending: PendingRegistration[] = registrations.map((registration) => ({
      registration,
      path: registration.canonicalPath,
      changed: false,
    }));
    // Path displacement is operation-local; canonical subject retirement is
    // decided separately by the accepted final identity effects.
    const displaced = new Set<ProjectedRegistration>();
    let introducedPaths: LiveMapDocumentPath[] = [];

    for (const operation of operations) {
      const effect = document_path_effect_for_graph_operation(operation);
      if (effect === undefined) continue;
      if (effect.kind === "replace-root") {
        throw new DocumentMirrorError(
          DOCUMENT_REFLECT_UNSUPPORTED_OPERATION_ERROR_CODE,
          "Root replacement cannot use incremental document correspondence.",
        );
      }

      const nextPending: PendingRegistration[] = [];
      for (const entry of pending) {
        const transformed = transform_document_path(entry.path, effect);
        if (transformed.kind === "invalid") {
          throw new DocumentMirrorError(
            DOCUMENT_REFLECT_UPDATE_FAILED_ERROR_CODE,
            `Projected correspondence path transform failed: ${transformed.reason}.`,
          );
        }
        if (transformed.kind === "retired") {
          displaced.add(entry.registration);
          continue;
        }
        nextPending.push({
          registration: entry.registration,
          path: transformed.path,
          changed: entry.changed || transformed.kind === "moved",
        });
      }
      pending = nextPending;

      const nextIntroduced: LiveMapDocumentPath[] = [];
      for (const path of introducedPaths) {
        const transformed = transform_document_path(path, effect);
        if (transformed.kind === "invalid") {
          throw new DocumentMirrorError(
            DOCUMENT_REFLECT_UPDATE_FAILED_ERROR_CODE,
            `Introduced projected path transform failed: ${transformed.reason}.`,
          );
        }
        if (transformed.kind !== "retired") nextIntroduced.push(transformed.path);
      }
      introducedPaths = nextIntroduced;

      if (operation.op === "insert-content" || operation.op === "replace-content") {
        introducedPaths.push(append_document_path(operation.target.path, operation.index));
      }
    }

    const moved = pending.filter((entry) => entry.changed);
    const unchanged = pending.filter((entry) => !entry.changed);
    for (const registration of displaced) unregister_document_binding_node(registration.node, owner);
    for (const entry of moved) unregister_document_binding_node(entry.registration.node, owner);

    registrations = unchanged.map((entry) => entry.registration);
    byPath.clear();
    byQuid.clear();
    for (const registration of registrations) {
      byPath.set(path_key(registration.canonicalPath), registration);
      if (registration.persistedQuid !== undefined) byQuid.set(registration.persistedQuid, registration);
    }
    for (const entry of moved) register(entry.registration.node, entry.path);

    const introducedRoots = introducedPaths.filter((path, index, paths) =>
      !paths.some((candidate, candidateIndex) => candidateIndex !== index
        && document_path_is_prefix(candidate, path)
        && (candidate.length < path.length || candidateIndex < index)));
    let introducedRegistrations = 0;
    for (const path of introducedRoots) {
      const node = resolve_raw_node(projectedRoot, path);
      if (node === undefined) continue;
      const priorCount = registrations.length;
      walk(node, path);
      introducedRegistrations += registrations.length - priorCount;
    }

    incrementalCorrespondenceUpdates += 1;
    correspondenceEntriesChanged += displaced.size + moved.length + introducedRegistrations;
  };

  const resolve_registration = (target: LiveMapDocumentCommitTarget): ProjectedRegistration => {
    const registration = byPath.get(path_key(target.path));
    if (registration === undefined) {
      throw new DocumentMirrorError(
        DOCUMENT_REFLECT_TARGET_MISSING_ERROR_CODE,
        "Canonical attribute target has no projected element correspondence.",
      );
    }
    if (target.witness !== undefined
      && registration.persistedQuid !== undefined
      && registration.persistedQuid !== target.witness.quid) {
      throw new DocumentMirrorError(
        DOCUMENT_REFLECT_QUID_MISMATCH_ERROR_CODE,
        "Canonical attribute path does not match its persisted-QUID witness.",
      );
    }
    return registration;
  };

  const validate_bound_registration = (registration: ProjectedRegistration): void => {
    if (resolve_raw_node(projectedRoot, registration.canonicalPath) !== registration.node) {
      throw new DocumentMirrorError(
        DOCUMENT_REFLECT_TARGET_MISSING_ERROR_CODE,
        "Projected element is no longer present at its canonical raw document path.",
      );
    }
    validate_registration(registration, mountedElements, observedDomIdentity, borrowed);
  };

  /** Cross the approved hard owner-epoch boundary with a fresh exact projection lineage. */
  const reconstruct_new_epoch = (
    canonicalMaterial: DocumentRootMaterial,
    targetRevision: number,
  ): void => {
    if (borrowed) {
      throw new DocumentMirrorError(
        DOCUMENT_REFLECT_UNSUPPORTED_OPERATION_ERROR_CODE,
        "A borrowed document tree cannot cross a root identity epoch.",
      );
    }
    for (const registration of registrations) validate_bound_registration(registration);
    const outgoingRoot = projectedRoot;
    const incomingRoot = clone_node(document_root_from_root(canonicalMaterial.root));
    try {
      preflight_livetree_quid_epoch_replacement(
        incomingRoot,
        outgoingRoot,
        runtimeEpochQuids,
        runtime,
      );
    } catch (cause) {
      throw new DocumentMirrorError(
        DOCUMENT_REFLECT_QUID_COLLISION_ERROR_CODE,
        "Fresh owner-epoch projection identity collides in the selected LiveTree runtime.",
        cause,
      );
    }

    const outgoingElement = mounted_document_anchor(outgoingRoot);
    const parent = outgoingElement?.parentNode;
    const nextSibling = outgoingElement?.nextSibling;
    const ownerDocument = outgoingElement?.ownerDocument;
    const namespace: "html" | "svg" = outgoingElement?.namespaceURI === "http://www.w3.org/2000/svg"
      ? "svg"
      : "html";

    currentStatus = "replacing";
    if (rootRegistration !== undefined) {
      unregister_document_binding_node(outgoingRoot, owner);
      rootRegistration = undefined;
    }
    for (const registration of registrations) unregister_document_binding_node(registration.node, owner);
    registrations = [];
    byPath.clear();
    byQuid.clear();
    dispose_node_deep(outgoingRoot, runtime);
    reset_livetree_quid_epoch(runtimeEpochQuids, runtime);
    runtimeEpochQuids.clear();
    if (currentStatus !== "replacing") return;

    tree = create_linked_livetree_in_runtime(incomingRoot, runtime);
    projectedRoot = tree.node;
    register_root_lifecycle();
    walk(projectedRoot, []);
    wholeCorrespondenceBuilds += 1;
    if (ownerDocument !== undefined) {
      const incomingElement = project_linked_livetree(
        projectedRoot,
        namespace,
        runtime,
        ownerDocument,
      );
      if (parent !== null && parent !== undefined) {
        parent.insertBefore(incomingElement, nextSibling ?? null);
      }
    }
    for (const registration of registrations) validate_bound_registration(registration);
    currentRevision = targetRevision;
    updatesApplied += 1;
    currentStatus = "active";
  };

  const converge_compatible_root = (
    canonicalMaterial: DocumentRootMaterial,
    observedMaterial: DocumentRootMaterial,
    targetRevision: number,
  ): void => {
    for (const registration of registrations) validate_bound_registration(registration);
    const priorRootQuid = byPath.get(path_key([]))?.persistedQuid;
    const convergence = plan_document_root_convergence(
      projectedRoot,
      canonicalMaterial.root,
      observedMaterial,
      priorRootQuid,
      (node) => {
        const registration = document_binding_for_node(node);
        return registration?.owner === owner ? registration.persistedQuid : undefined;
      },
    );
    currentStatus = "replacing";
    try {
      apply_document_structural_transaction(convergence.structural, () => {
        prune_removed_registrations(convergence.structural.finalNodes);
        rebuild_correspondence();
      });
    } catch (cause) {
      prune_removed_registrations(convergence.structural.finalNodes);
      throw new DocumentMirrorError(
        DOCUMENT_REFLECT_ROOT_REPLACEMENT_FAILED_ERROR_CODE,
        "Compatible projected root convergence failed during graph or DOM application.",
        cause,
      );
    }
    if (currentStatus !== "replacing") {
      if (currentStatus === "failed") {
        prune_removed_registrations(convergence.structural.finalNodes);
      }
      throw currentFailure ?? new DocumentMirrorError(
        DOCUMENT_REFLECT_ROOT_REPLACEMENT_FAILED_ERROR_CODE,
        "Compatible root convergence was interrupted before correspondence publication.",
      );
    }
    for (const registration of registrations) validate_bound_registration(registration);
    currentRevision = targetRevision;
    updatesApplied += 1;
    currentStatus = "active";
  };

  const apply_observation = (observation: LiveMapCommitObservation<LiveMapGraphOp>): void => {
    const evidence = livemap_document_observation_evidence(observation);
    if (evidence === undefined || evidence.mode !== "document") {
      throw new DocumentMirrorError(
        DOCUMENT_REFLECT_UPDATE_FAILED_ERROR_CODE,
        "DocumentLiveMap observation reached Reflection without exact accepted-state evidence.",
      );
    }
    if (observation.kind === "snapshot") {
      if (evidence.revision !== observation.revision) {
        throw new DocumentMirrorError(
          DOCUMENT_REFLECT_SNAPSHOT_REVISION_MISMATCH_ERROR_CODE,
          `Snapshot observation revision ${observation.revision} does not match accepted evidence revision ${evidence.revision}.`,
        );
      }
      if (evidence.continuity === "new-epoch") {
        reconstruct_new_epoch(evidence, observation.revision);
      } else {
        if (borrowed) assert_borrowed_root_continuity(evidence.root, tree.node);
        converge_compatible_root(
          evidence,
          evidence,
          observation.revision,
        );
      }
      return;
    }
    const { commit } = observation;
    if (evidence.revision !== commit.rev) {
      throw new DocumentMirrorError(
        DOCUMENT_REFLECT_REVISION_GAP_ERROR_CODE,
        `Commit revision ${commit.rev} does not match accepted evidence revision ${evidence.revision}.`,
      );
    }
    if (commit.prevRev !== currentRevision) {
      throw new DocumentMirrorError(
        DOCUMENT_REFLECT_REVISION_GAP_ERROR_CODE,
        `Document binding expected revision ${currentRevision}, but commit began at ${commit.prevRev}.`,
      );
    }
    // A selected document binding observes the map-wide revision stream.  A
    // commit to another Library deliberately has no graph work here, but it is
    // still continuity evidence for this binding's next selected transition.
    if (!commit.changed || commit.ops.length === 0) {
      currentRevision = commit.rev;
      return;
    }
    if (borrowed) assert_borrowed_root_continuity(evidence.root, tree.node);
    consume_identity_effects(commit);
    const hasIdentityRegistration = commit.ops.some((operation) => operation.op === "ensure-quid");
    const identityReservation = livemap_document_identity_reservation_for(commit);
    if (hasIdentityRegistration && identityReservation === undefined) {
      throw new DocumentMirrorError(
        DOCUMENT_REFLECT_QUID_MISMATCH_ERROR_CODE,
        "Canonical identity registration reached Mirror without local preflight evidence.",
      );
    }
    const replaceRoot = commit.ops.length === 1 && commit.ops[0]?.op === "replace-root"
      ? commit.ops[0]
      : undefined;
    if (replaceRoot !== undefined) {
      if (evidence.continuity === "new-epoch") {
        reconstruct_new_epoch(evidence, commit.rev);
      } else {
        converge_compatible_root(evidence, replaceRoot, commit.rev);
      }
      return;
    }
    if (commit.ops.some((operation) => operation.domain !== "graph"
      || (operation.op !== "set-attr"
        && operation.op !== "remove-attr"
        && operation.op !== "replace-attrs"
        && operation.op !== "insert-content"
        && operation.op !== "remove-content"
        && operation.op !== "move-content"
        && operation.op !== "replace-content"
        && operation.op !== "ensure-quid"))) {
      throw new DocumentMirrorError(
        DOCUMENT_REFLECT_UNSUPPORTED_OPERATION_ERROR_CODE,
        "Changed graph operation is unsupported by this document binding proof.",
      );
    }

    const hasStructuralOperation = commit.ops.some((operation) => operation.op === "insert-content"
      || operation.op === "remove-content"
      || operation.op === "move-content"
      || operation.op === "replace-content");
    if (hasStructuralOperation) {
      for (const registration of registrations) validate_bound_registration(registration);
      const plan = plan_document_structural_transaction(
        projectedRoot,
        document_root_from_root(evidence.root),
        commit.ops,
        (node) => {
          const registration = document_binding_for_node(node);
          return registration?.owner === owner ? registration.persistedQuid : undefined;
        },
      );
      let appliedIdentityClaims: readonly LiveMapDocumentIdentityAppliedClaim[] = Object.freeze([]);
      try {
        apply_document_structural_transaction(plan, () => {
          // The final canonical overlay is already installed at publication.
          // A structural reconciliation may re-register a moved subject against
          // that overlay, so its preflighted runtime QUID must be present first.
          appliedIdentityClaims = identityReservation?.apply() ?? Object.freeze([]);
          reconcile_correspondence_incrementally(commit.ops);
        });
      } catch (cause) {
        identityReservation?.rollback();
        prune_removed_registrations(plan.finalNodes);
        throw cause;
      }
      for (const claim of appliedIdentityClaims) {
        refresh_registration_at_path(claim.path);
      }
      for (const registration of registrations) validate_bound_registration(registration);
      currentRevision = commit.rev;
      updatesApplied += 1;
      return;
    }

    const appliedIdentityClaims = identityReservation?.apply() ?? Object.freeze([]);
    for (const claim of appliedIdentityClaims) refresh_registration_at_path(claim.path);

    const planned = new Map<ProjectedRegistration, CanonicalPublicAttrs>();
    for (const operation of commit.ops) {
      if (operation.op !== "set-attr" && operation.op !== "remove-attr" && operation.op !== "replace-attrs") continue;
      const registration = resolve_registration(operation.target);
      validate_bound_registration(registration);
      planned.set(registration, read_document_root_attrs(evidence.root, registration.canonicalTarget));
    }

    for (const [registration, attrs] of planned) {
      apply_projected_attrs_replacement(registration.node, attrs);
    }
    for (const [registration, attrs] of planned) {
      validate_bound_registration(registration);
      const projected = read_projected_attrs(registration.node);
      if (!canonical_public_attrs_equal(projected, attrs)) {
        throw new DocumentMirrorError(
          DOCUMENT_REFLECT_UPDATE_FAILED_ERROR_CODE,
          "Projected attributes do not match the canonical final state.",
        );
      }
      validate_dom_attrs(registration, attrs);
    }
    currentRevision = commit.rev;
    updatesApplied += 1;
  };

  const on_observation = (observation: LiveMapCommitObservation): void => {
    if (currentStatus === "replacing") {
      fail(new DocumentMirrorError(
        DOCUMENT_REFLECT_ROOT_REPLACEMENT_FAILED_ERROR_CODE,
        "A reentrant document observation interrupted compatible root convergence.",
      ));
      return;
    }
    if (currentStatus !== "active") return;
    try {
      apply_observation(observation as LiveMapCommitObservation<LiveMapGraphOp>);
    } catch (cause) {
      fail(as_binding_error(cause, DOCUMENT_REFLECT_UPDATE_FAILED_ERROR_CODE, "Document attribute projection failed."));
    }
  };

  try {
    register_root_lifecycle();
    walk(projectedRoot, []);
    wholeCorrespondenceBuilds += 1;
    // Identity preflight must exist before commit observation begins. The
    // revision recheck then closes the capture-to-subscribe initialization gap.
    offIdentityParticipant = register_livemap_document_identity_participant(map.document, Object.freeze({
      preflight: preflight_identity_operations,
      verifyExisting: verify_existing_identity,
    }));
    off = map.commits.observe(on_observation);
    if (map.rev !== capturedRevision) {
      throw new DocumentMirrorError(
        DOCUMENT_REFLECT_REVISION_GAP_ERROR_CODE,
        "DocumentLiveMap revision changed during document binding initialization.",
      );
    }
    currentStatus = "active";
  } catch (cause) {
    off?.();
    off = undefined;
    offIdentityParticipant?.();
    offIdentityParticipant = undefined;
    if (rootRegistration !== undefined) {
      unregister_document_binding_node(projectedRoot, owner);
      rootRegistration = undefined;
    }
    for (const registration of registrations) unregister_document_binding_node(registration.node, owner);
    if (borrowed) {
      release_borrowed_carrier();
    } else {
      const privateRoot = tree.node;
      dispose_node_deep(privateRoot, runtime);
      release_subtree_ownership(privateRoot);
    }
    ACTIVE_DOCUMENT_BINDINGS.delete(map);
    throw as_binding_error(cause, DOCUMENT_REFLECT_UPDATE_FAILED_ERROR_CODE, "Document binding initialization failed.");
  }

  const binding: DocumentMirror = Object.freeze({
    get tree() { return tree; },
    get status() { return currentStatus; },
    get sourceRevision() { return currentRevision; },
    get failure() { return currentFailure; },
    diagnostics: () => {
      if (currentStatus === "disposed") {
        throw new DocumentMirrorError(
          DOCUMENT_REFLECT_DISPOSED_ERROR_CODE,
          "Document binding has been disposed.",
        );
      }
      return Object.freeze({
        updatesApplied,
        registeredElements: registrations.length,
        wholeCorrespondenceBuilds,
        incrementalCorrespondenceUpdates,
        correspondenceEntriesChanged,
        identityEffectsConsumed,
      });
    },
    dispose: dispose_binding,
  });
  return binding;
}

function validate_borrowed_document_tree(
  canonicalRoot: HsonNode,
  tree: LiveTree,
  runtime: LiveTreeRuntime,
): HsonNode {
  const borrowedRoot = tree.node;
  if (!is_ordinary_element_node(borrowedRoot)
    || canonicalRoot.$_tag !== ROOT_TAG
    || canonicalRoot.$_content.length !== 1
    || !is_ordinary_element_node(canonicalRoot.$_content[0])) {
    throw new DocumentMirrorError(
      DOCUMENT_REFLECT_NODE_KIND_MISMATCH_ERROR_CODE,
      "Borrowed document binding requires one ordinary selected root beneath the canonical document carrier.",
    );
  }
  if (runtime_for_tree(tree) !== runtime || runtime.disposed) {
    throw new DocumentMirrorError(
      DOCUMENT_REFLECT_DOM_MAPPING_MISMATCH_ERROR_CODE,
      "Borrowed LiveTree does not belong to the selected active runtime.",
    );
  }
  if (document_binding_for_node(borrowedRoot) !== undefined) {
    throw new DocumentMirrorError(
      DOCUMENT_REFLECT_ALREADY_BOUND_ERROR_CODE,
      "Borrowed LiveTree root already belongs to a document Mirror binding.",
    );
  }
  if (parent_for_node(borrowedRoot) !== undefined) {
    throw new DocumentMirrorError(
      DOCUMENT_REFLECT_DOM_MAPPING_MISMATCH_ERROR_CODE,
      "Borrowed document root is not a standalone admitted graph root.",
    );
  }

  const carrier: HsonNode = { $_tag: ROOT_TAG, $_content: [borrowedRoot] };
  const difference = canonical_hson_graph_difference(carrier, canonicalRoot);
  if (difference !== undefined) {
    const identityDifference = difference.kind === "quid-difference"
      || difference.path.endsWith(`.${HSON_META_QUID}`)
      || canonical_quids_differ(carrier, canonicalRoot);
    throw new DocumentMirrorError(
      identityDifference
        ? DOCUMENT_REFLECT_QUID_MISMATCH_ERROR_CODE
        : DOCUMENT_REFLECT_UPDATE_FAILED_ERROR_CODE,
      `Borrowed LiveTree is not the exact canonical document realization: ${difference.message}.`,
    );
  }

  const rootElement = get_el_for_node(borrowedRoot);
  if (rootElement === undefined || get_node_for_el(rootElement) !== borrowedRoot) {
    throw new DocumentMirrorError(
      DOCUMENT_REFLECT_DOM_MAPPING_MISMATCH_ERROR_CODE,
      "Borrowed document root has no exact admitted DOM correspondence.",
    );
  }
  if (!runtime_owns_document(runtime, rootElement.ownerDocument)) {
    throw new DocumentMirrorError(
      DOCUMENT_REFLECT_DOM_MAPPING_MISMATCH_ERROR_CODE,
      "Borrowed document realization is not claimed by the selected runtime.",
    );
  }
  for (const node of collect_subtree_nodes(borrowedRoot, "pre")) {
    if (runtime_for_node(node) !== runtime) {
      throw new DocumentMirrorError(
        DOCUMENT_REFLECT_DOM_MAPPING_MISMATCH_ERROR_CODE,
        "Borrowed graph node is not routed through the selected runtime.",
      );
    }
    if (document_binding_for_node(node) !== undefined) {
      throw new DocumentMirrorError(
        DOCUMENT_REFLECT_ALREADY_BOUND_ERROR_CODE,
        "Borrowed LiveTree node already belongs to a document Mirror binding.",
      );
    }
    const quid = is_ordinary_element_node(node) ? node.$_meta?.[HSON_META_QUID] : undefined;
    if (is_ordinary_element_node(node)
      && (runtime.nodeToQuid.get(node) !== quid
        || (quid !== undefined && runtime.quidToNode.get(quid) !== node))) {
      throw new DocumentMirrorError(
        DOCUMENT_REFLECT_QUID_MISMATCH_ERROR_CODE,
        "Borrowed graph and runtime do not agree on persisted QUID identity.",
      );
    }
  }
  try {
    const plan = plan_browser_realization(borrowedRoot, {
      parentNamespace: browser_parent_namespace_for_target(rootElement, borrowedRoot.$_tag),
      capability: "dom",
    });
    const match = match_browser_realization_root(plan, rootElement, { allowRuntimeInfrastructure: true });
    assert_browser_realization_mappings(match);
    for (const link of match.links) {
      if (get_dom_for_node(link.canonicalNode) !== link.domNode
        || get_node_for_dom(link.domNode) !== link.canonicalNode) {
        throw new Error("Borrowed browser realization mapping is not exact.");
      }
    }
  } catch (cause) {
    throw new DocumentMirrorError(
      DOCUMENT_REFLECT_DOM_MAPPING_MISMATCH_ERROR_CODE,
      "Borrowed DOM no longer matches the shared browser realization plan.",
      cause,
    );
  }
  return carrier;
}

function canonical_quids_differ(left: HsonNode, right: HsonNode): boolean {
  if (left.$_meta?.[HSON_META_QUID] !== right.$_meta?.[HSON_META_QUID]) return true;
  if (left.$_content.length !== right.$_content.length) return false;
  for (let index = 0; index < left.$_content.length; index += 1) {
    const leftChild = left.$_content[index];
    const rightChild = right.$_content[index];
    if (is_Node(leftChild) && is_Node(rightChild) && canonical_quids_differ(leftChild, rightChild)) return true;
  }
  return false;
}

function assert_borrowed_root_continuity(canonicalRoot: HsonNode, borrowedRoot: HsonNode): void {
  const nextRoot = canonicalRoot.$_tag === ROOT_TAG && canonicalRoot.$_content.length === 1
    ? canonicalRoot.$_content[0]
    : undefined;
  if (!is_ordinary_element_node(nextRoot)
    || nextRoot.$_tag !== borrowedRoot.$_tag
    || nextRoot.$_meta?.[HSON_META_QUID] !== borrowedRoot.$_meta?.[HSON_META_QUID]) {
    throw new DocumentMirrorError(
      DOCUMENT_REFLECT_UNSUPPORTED_OPERATION_ERROR_CODE,
      "Canonical root replacement cannot retire or replace a borrowed document root.",
    );
  }
}

function mounted_document_anchor(root: HsonNode): Element | undefined {
  if (root.$_tag === ROOT_TAG) {
    if (root.$_content.length !== 1) return undefined;
    const only = root.$_content[0];
    return is_ordinary_element_node(only) ? get_el_for_node(only) : undefined;
  }
  return is_ordinary_element_node(root) ? get_el_for_node(root) : undefined;
}

function read_map_attrs(map: ReflectableDocumentMap, target: LiveMapDocumentCommitTarget): CanonicalPublicAttrs {
  const values: Record<string, unknown> = {};
  for (const name of map.document.attrs.keys(target)) values[name] = map.document.attrs.must.get(target, name);
  const attrs = decode_public_attrs(values);
  if (attrs === undefined) {
    throw new DocumentMirrorError(
      DOCUMENT_REFLECT_UPDATE_FAILED_ERROR_CODE,
      "Canonical document attribute read did not produce a valid final-state bag.",
    );
  }
  return attrs;
}

function read_document_root_attrs(
  root: HsonNode,
  target: LiveMapDocumentCommitTarget,
): CanonicalPublicAttrs {
  const node = resolve_raw_node(document_root_from_root(root), target.path);
  if (node === undefined || !is_ordinary_element_node(node)) {
    throw new DocumentMirrorError(
      DOCUMENT_REFLECT_TARGET_MISSING_ERROR_CODE,
      "Accepted document evidence has no ordinary element at the observed attribute target.",
    );
  }
  return read_projected_attrs(node);
}

function read_projected_attrs(node: HsonNode): CanonicalPublicAttrs {
  const attrs = decode_public_attrs(node.$_attrs ?? {});
  if (attrs === undefined) {
    throw new DocumentMirrorError(
      DOCUMENT_REFLECT_UPDATE_FAILED_ERROR_CODE,
      "Projected node contains invalid ordinary attributes.",
    );
  }
  return attrs;
}

function validate_registration(
  registration: ProjectedRegistration,
  mountedElements: WeakMap<HsonNode, Element>,
  observedDomIdentity: WeakSet<Element>,
  borrowed: boolean,
): void {
  if (!is_ordinary_element_node(registration.node)) {
    throw new DocumentMirrorError(
      DOCUMENT_REFLECT_NODE_KIND_MISMATCH_ERROR_CODE,
      "Projected attribute target is not an ordinary document element.",
    );
  }
  if (document_binding_for_node(registration.node)?.owner !== registration.owner) {
    throw new DocumentMirrorError(
      DOCUMENT_REFLECT_TARGET_MISSING_ERROR_CODE,
      "Projected element registration is missing or belongs to another binding.",
    );
  }
  if (registration.node.$_meta?.[HSON_META_QUID] !== registration.persistedQuid) {
    throw new DocumentMirrorError(
      DOCUMENT_REFLECT_QUID_MISMATCH_ERROR_CODE,
      "Projected element no longer carries its expected persisted QUID.",
    );
  }
  const element = get_el_for_node(registration.node);
  const priorElement = mountedElements.get(registration.node);
  if (element === undefined) {
    if (priorElement !== undefined) {
      throw new DocumentMirrorError(
        DOCUMENT_REFLECT_DOM_MAPPING_MISMATCH_ERROR_CODE,
        "Previously mounted projected element lost its node mapping.",
      );
    }
    return;
  }
  if (priorElement !== undefined && priorElement !== element) {
    throw new DocumentMirrorError(
      DOCUMENT_REFLECT_DOM_MAPPING_MISMATCH_ERROR_CODE,
      "Projected element mapping changed during an attribute-only binding.",
    );
  }
  mountedElements.set(registration.node, element);
  try {
    assert_node_element_link(registration.node);
  } catch (cause) {
    throw new DocumentMirrorError(
      DOCUMENT_REFLECT_DOM_MAPPING_MISMATCH_ERROR_CODE,
      "Projected node and DOM element mapping does not round-trip.",
      cause,
    );
  }
  if (get_node_for_el(element) !== registration.node) {
    throw new DocumentMirrorError(
      DOCUMENT_REFLECT_DOM_MAPPING_MISMATCH_ERROR_CODE,
      "Mounted projected element resolves to a different Hson node.",
    );
  }
  const projectedDomQuid = element.getAttribute(HSON_QUID_MARKUP_NAME) ?? undefined;
  if (projectedDomQuid === registration.persistedQuid && projectedDomQuid !== undefined) {
    observedDomIdentity.add(element);
  } else if (projectedDomQuid !== registration.persistedQuid
    && !(borrowed && projectedDomQuid === undefined && !observedDomIdentity.has(element))) {
    throw new DocumentMirrorError(
      DOCUMENT_REFLECT_QUID_MISMATCH_ERROR_CODE,
      "Mounted projected element does not carry its expected persisted QUID.",
    );
  }
  const tagName = (element as { tagName?: unknown }).tagName;
  if (typeof tagName === "string" && tagName.toLowerCase() !== registration.node.$_tag.toLowerCase()) {
    throw new DocumentMirrorError(
      DOCUMENT_REFLECT_NODE_KIND_MISMATCH_ERROR_CODE,
      "Mounted projected element tag does not match its Hson node kind.",
    );
  }
}

function validate_dom_attrs(
  registration: ProjectedRegistration,
  attrs: CanonicalPublicAttrs,
): void {
  const element = get_el_for_node(registration.node);
  if (element === undefined) return;
  const expectedNames = new Set<string>();
  for (const [name, value] of Object.entries(attrs)) {
    const namespace = element.namespaceURI === "http://www.w3.org/2000/svg" ? "svg" : "html";
    const lowered = lower_browser_attribute_value(name, value, namespace);
    if (lowered !== undefined) expectedNames.add(lowered.name);
    if (element.getAttribute(lowered?.name ?? name) !== (lowered?.value ?? null)) {
      throw new DocumentMirrorError(
        DOCUMENT_REFLECT_UPDATE_FAILED_ERROR_CODE,
        "Mounted DOM attributes do not match the canonical projected final state.",
      );
    }
  }
  for (const name of element.getAttributeNames()) {
    if (name === HSON_QUID_MARKUP_NAME) continue;
    if (!expectedNames.has(name)) {
      throw new DocumentMirrorError(
        DOCUMENT_REFLECT_UPDATE_FAILED_ERROR_CODE,
        "Mounted DOM contains an attribute outside the canonical projected final state.",
      );
    }
  }
}

function path_key(path: readonly number[]): string {
  return path.join("/");
}

function resolve_raw_node(root: HsonNode, path: readonly number[]): HsonNode | undefined {
  let current = root;
  for (const segment of path) {
    const child = current.$_content[segment];
    if (!is_Node(child)) return undefined;
    current = child;
  }
  return current;
}

function as_binding_error(
  cause: unknown,
  code: ConstructorParameters<typeof DocumentMirrorError>[0],
  message: string,
): DocumentMirrorError {
  return cause instanceof DocumentMirrorError
    ? cause
    : new DocumentMirrorError(code, message, cause);
}

function delegation_unsupported(reason: string): DocumentMirrorError {
  return new DocumentMirrorError(
    DOCUMENT_REFLECT_DELEGATION_UNSUPPORTED_ERROR_CODE,
    `Bound LiveTree mutation is deliberately unsupported: ${reason}.`,
  );
}
