import { ELEM_TAG, STR_TAG, VAL_TAG, _DATA_QUID } from "../../core/constants.js";
import { canonical_public_attrs_equal, decode_public_attrs } from "../../core/public-attrs.js";
import { is_Node, is_ordinary_element_node } from "../../core/node-guards.js";
import { is_persisted_quid } from "../../core/persisted-quid.js";
import type { CanonicalPublicAttrs, HsonNode } from "../../core/types.js";
import type {
  DocumentLiveMapCapture,
  ElementLiveMap,
  LiveMapCommitObservation,
  LiveMapDisposer,
  LiveMapDocumentTarget,
  LiveMapGraphOp,
} from "../../types/livemap.types.js";
import { create_livetree } from "../livetree/creation/create-livetree.js";
import type { LiveTree } from "../livetree/livetree.js";
import {
  document_binding_for_node,
  register_document_binding_node,
  unregister_document_binding_node,
  type DocumentBindingNodeRegistration,
  type DocumentBoundAttrsMutation,
  type DocumentBoundTextMutation,
} from "../livetree/lifecycle/document-binding-state.js";
import { apply_projected_attrs_replacement } from "../livetree/managers/attr-handle.js";
import {
  assert_node_element_link,
  get_el_for_node,
  get_node_for_el,
} from "../livetree/utils/node-map-helpers.js";
import { serialize_style } from "../transform/utils/attrs-utils/serialize-style.js";
import {
  DOCUMENT_BINDING_ALREADY_BOUND_ERROR_CODE,
  DOCUMENT_BINDING_DISPOSED_ERROR_CODE,
  DOCUMENT_BINDING_DELEGATION_ROOT_FORBIDDEN_ERROR_CODE,
  DOCUMENT_BINDING_DELEGATION_TARGET_INVALID_ERROR_CODE,
  DOCUMENT_BINDING_DELEGATION_UNSUPPORTED_ERROR_CODE,
  DOCUMENT_BINDING_DOM_MAPPING_MISMATCH_ERROR_CODE,
  DOCUMENT_BINDING_NODE_KIND_MISMATCH_ERROR_CODE,
  DOCUMENT_BINDING_PROJECTION_FAILED_ERROR_CODE,
  DOCUMENT_BINDING_QUID_MISMATCH_ERROR_CODE,
  DOCUMENT_BINDING_REVISION_GAP_ERROR_CODE,
  DOCUMENT_BINDING_ROOT_REPLACEMENT_FAILED_ERROR_CODE,
  DOCUMENT_BINDING_SNAPSHOT_CAPTURE_FAILED_ERROR_CODE,
  DOCUMENT_BINDING_SNAPSHOT_REVISION_MISMATCH_ERROR_CODE,
  DOCUMENT_BINDING_TARGET_MISSING_ERROR_CODE,
  DOCUMENT_BINDING_UNSUPPORTED_OPERATION_ERROR_CODE,
  DocumentLiveTreeBindingError,
} from "./liveproject.document.error.js";
import {
  apply_document_structural_transaction,
  plan_document_structural_transaction,
} from "./liveproject.document.structure.js";
import {
  plan_document_root_convergence,
  type DocumentRootMaterial,
} from "./liveproject.document.root.js";

export type DocumentLiveTreeBindingStatus = "initializing" | "active" | "replacing" | "failed" | "disposed";

export type DocumentLiveTreeBinding = Readonly<{
  readonly tree: LiveTree;
  readonly status: DocumentLiveTreeBindingStatus;
  readonly sourceRevision: number;
  readonly failure: DocumentLiveTreeBindingError | undefined;
  diagnostics: () => Readonly<{ projectionTransactions: number; registeredElements: number }>;
  dispose: () => void;
}>;

type ProjectedRegistration = DocumentBindingNodeRegistration & Readonly<{
  node: HsonNode;
}>;

const ACTIVE_DOCUMENT_BINDINGS = new WeakSet<ElementLiveMap>();

/** Internal attribute-only proof that projects one ElementLiveMap into one LiveTree. */
export function bind_document_livetree(map: ElementLiveMap): DocumentLiveTreeBinding {
  if (ACTIVE_DOCUMENT_BINDINGS.has(map)) {
    throw new DocumentLiveTreeBindingError(
      DOCUMENT_BINDING_ALREADY_BOUND_ERROR_CODE,
      "ElementLiveMap already has an active document projection binding.",
    );
  }
  ACTIVE_DOCUMENT_BINDINGS.add(map);

  let capturedRevision: number;
  let sourceElement: HsonNode;
  let persistedQuidsByPath: ReadonlyMap<string, string>;
  try {
    capturedRevision = map.rev;
    sourceElement = map.element.node();
    persistedQuidsByPath = collect_persisted_quids(sourceElement);
  } catch (cause) {
    ACTIVE_DOCUMENT_BINDINGS.delete(map);
    throw as_binding_error(cause, DOCUMENT_BINDING_PROJECTION_FAILED_ERROR_CODE, "Initial document binding capture failed.");
  }
  let tree: LiveTree;
  try {
    tree = create_livetree(sourceElement);
  } catch (cause) {
    ACTIVE_DOCUMENT_BINDINGS.delete(map);
    throw as_binding_error(cause, DOCUMENT_BINDING_PROJECTION_FAILED_ERROR_CODE, "Initial LiveTree projection construction failed.");
  }

  const owner = {};
  let registrations: ProjectedRegistration[] = [];
  const byPath = new Map<string, ProjectedRegistration>();
  const byQuid = new Map<string, ProjectedRegistration>();
  const mountedElements = new WeakMap<HsonNode, Element>();
  let currentStatus: DocumentLiveTreeBindingStatus = "initializing";
  let currentRevision = capturedRevision;
  let currentFailure: DocumentLiveTreeBindingError | undefined;
  let projectionTransactions = 0;
  let off: LiveMapDisposer | undefined;

  const fail = (failure: DocumentLiveTreeBindingError): void => {
    if (currentStatus === "failed" || currentStatus === "disposed") return;
    currentFailure = failure;
    currentStatus = "failed";
    const disposeObserver = off;
    off = undefined;
    disposeObserver?.();
  };

  const assert_delegation_ready = (registration: ProjectedRegistration): void => {
    if (currentStatus === "failed") throw currentFailure;
    if (currentStatus !== "active") {
      throw new DocumentLiveTreeBindingError(
        DOCUMENT_BINDING_PROJECTION_FAILED_ERROR_CODE,
        "Document binding is not active for canonical attribute delegation.",
      );
    }
    validate_bound_registration(registration);
    const canonical = read_map_attrs(map, registration.canonicalTarget);
    const projected = read_projected_attrs(registration.node);
    if (!canonical_public_attrs_equal(canonical, projected)) {
      const failure = new DocumentLiveTreeBindingError(
        DOCUMENT_BINDING_PROJECTION_FAILED_ERROR_CODE,
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
    const target = registration.canonicalTarget;
    switch (mutation.kind) {
      case "set": map.document.attrs.set(target, mutation.name, mutation.value); return;
      case "setMany": map.document.attrs.setMany(target, mutation.values); return;
      case "drop": map.document.attrs.drop(target, mutation.name); return;
      case "dropMany": map.document.attrs.dropMany(target, mutation.names); return;
      case "clear": map.document.attrs.clear(target); return;
      case "replace": map.document.attrs.replace(target, mutation.values); return;
    }
  };

  const canonical_node_for = (registration: ProjectedRegistration): HsonNode => {
    assert_delegation_ready(registration);
    const canonical = resolve_raw_node(map.element.node(), registration.canonicalPath);
    if (canonical === undefined || !is_ordinary_element_node(canonical)) {
      throw new DocumentLiveTreeBindingError(
        DOCUMENT_BINDING_DELEGATION_TARGET_INVALID_ERROR_CODE,
        "Bound mutation target no longer resolves to a canonical ordinary element.",
      );
    }
    if (canonical.$_tag !== registration.node.$_tag) {
      throw new DocumentLiveTreeBindingError(
        DOCUMENT_BINDING_DELEGATION_TARGET_INVALID_ERROR_CODE,
        "Bound mutation target kind differs from its canonical element.",
      );
    }
    return canonical;
  };

  const delegate_text = (
    registration: ProjectedRegistration,
    mutation: DocumentBoundTextMutation,
  ): void => {
    const canonical = canonical_node_for(registration);
    if (mutation.kind === "overwrite") {
      throw delegation_unsupported("text.overwrite changes complete effective content without one exact map operation");
    }
    const text = mutation.value === null ? "" : String(mutation.value);
    if (canonical.$_content.length === 0) {
      const bucket: HsonNode = { $_tag: ELEM_TAG, $_content: [{ $_tag: STR_TAG, $_content: [text] }] };
      map.document.content.insert(registration.canonicalTarget, 0, bucket);
      return;
    }
    if (canonical.$_content.length !== 1) {
      throw delegation_unsupported("text mutation requires one canonical _hson_elem content bucket");
    }
    const bucket = canonical.$_content[0];
    if (!is_Node(bucket) || bucket.$_tag !== ELEM_TAG) {
      throw delegation_unsupported("text mutation requires canonical _hson_elem storage");
    }
    const bucketTarget: LiveMapDocumentTarget = Object.freeze({
      kind: "path",
      path: Object.freeze([...registration.canonicalPath, 0]),
    });
    if (mutation.kind === "add") {
      map.document.content.insert(bucketTarget, bucket.$_content.length, text);
      return;
    }
    if (mutation.kind === "insert") {
      const index = Number.isFinite(mutation.index)
        ? Math.max(0, Math.min(bucket.$_content.length, Math.floor(mutation.index)))
        : bucket.$_content.length;
      map.document.content.insert(bucketTarget, index, text);
      return;
    }
    const leafIndexes = bucket.$_content.flatMap((item, index) =>
      is_Node(item) && (item.$_tag === STR_TAG || item.$_tag === VAL_TAG) ? [index] : []);
    if (leafIndexes.length === 0) {
      map.document.content.insert(bucketTarget, 0, text);
      return;
    }
    if (leafIndexes.length !== 1) {
      throw delegation_unsupported("text.set would need more than one canonical content mutation");
    }
    map.document.content.replace(
      bucketTarget,
      leafIndexes[0]!,
      { $_tag: STR_TAG, $_content: [text] },
    );
  };

  const delegate_empty = (registration: ProjectedRegistration): void => {
    const canonical = canonical_node_for(registration);
    if (canonical.$_content.length === 0) return;
    if (canonical.$_content.length !== 1) {
      throw delegation_unsupported("empty would need more than one canonical content mutation");
    }
    map.document.content.remove(registration.canonicalTarget, 0);
  };

  const delegate_remove = (registration: ProjectedRegistration): 1 => {
    canonical_node_for(registration);
    if (registration.canonicalPath.length === 0) {
      throw new DocumentLiveTreeBindingError(
        DOCUMENT_BINDING_DELEGATION_ROOT_FORBIDDEN_ERROR_CODE,
        "The bound document root cannot be removed through LiveTree.remove().",
      );
    }
    const index = registration.canonicalPath[registration.canonicalPath.length - 1]!;
    const parentPath = Object.freeze(registration.canonicalPath.slice(0, -1));
    map.document.content.remove(Object.freeze({ kind: "path", path: parentPath }), index);
    return 1;
  };

  const reject_structural_mutation = (operation: string): never => {
    if (currentStatus === "failed") throw currentFailure;
    throw new DocumentLiveTreeBindingError(
      DOCUMENT_BINDING_UNSUPPORTED_OPERATION_ERROR_CODE,
      `Public LiveTree structural mutation ${operation} is unavailable while document-bound.`,
    );
  };

  const register = (node: HsonNode, canonicalPath: readonly number[]): void => {
    if (!is_ordinary_element_node(node)) return;
    const path = Object.freeze([...canonicalPath]);
    const pathKey = path_key(path);
    const persistedQuid = persistedQuidsByPath.get(pathKey);
    if (persistedQuid !== undefined && node.$_meta?.[_DATA_QUID] !== persistedQuid) {
      throw new DocumentLiveTreeBindingError(
        DOCUMENT_BINDING_QUID_MISMATCH_ERROR_CODE,
        "Projected element did not preserve its canonical persisted QUID.",
      );
    }
    const canonicalTarget: LiveMapDocumentTarget = Object.freeze({ kind: "path", path });
    let registration: ProjectedRegistration;
    registration = Object.freeze({
      owner,
      node,
      canonicalPath: path,
      canonicalTarget,
      ...(persistedQuid === undefined ? {} : { persistedQuid }),
      delegateAttrs: (mutation) => delegate_attrs(registration, mutation),
      delegateText: (mutation) => delegate_text(registration, mutation),
      delegateEmpty: () => delegate_empty(registration),
      delegateRemove: () => delegate_remove(registration),
      rejectStructuralMutation: reject_structural_mutation,
    });
    if (byPath.has(pathKey)) {
      throw new DocumentLiveTreeBindingError(
        DOCUMENT_BINDING_TARGET_MISSING_ERROR_CODE,
        "Document projection produced duplicate canonical-path correspondence.",
      );
    }
    if (persistedQuid !== undefined && byQuid.has(persistedQuid)) {
      throw new DocumentLiveTreeBindingError(
        DOCUMENT_BINDING_QUID_MISMATCH_ERROR_CODE,
        "Document projection produced duplicate persisted-QUID correspondence.",
      );
    }
    register_document_binding_node(node, registration);
    registrations.push(registration);
    byPath.set(pathKey, registration);
    if (persistedQuid !== undefined) byQuid.set(persistedQuid, registration);
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

  const rebuild_correspondence = (canonicalRoot: HsonNode): void => {
    for (const registration of registrations) unregister_document_binding_node(registration.node, owner);
    registrations = [];
    byPath.clear();
    byQuid.clear();
    persistedQuidsByPath = collect_persisted_quids(canonicalRoot);
    walk(tree.node, []);
  };

  const resolve_registration = (target: LiveMapDocumentTarget): ProjectedRegistration => {
    const registration = target.kind === "path"
      ? byPath.get(path_key(target.path))
      : byQuid.get(target.quid);
    if (registration === undefined) {
      throw new DocumentLiveTreeBindingError(
        DOCUMENT_BINDING_TARGET_MISSING_ERROR_CODE,
        "Canonical attribute target has no projected element correspondence.",
      );
    }
    if (target.kind === "quid" && registration.persistedQuid !== target.quid) {
      throw new DocumentLiveTreeBindingError(
        DOCUMENT_BINDING_QUID_MISMATCH_ERROR_CODE,
        "Canonical QUID target does not match projected correspondence.",
      );
    }
    return registration;
  };

  const validate_bound_registration = (registration: ProjectedRegistration): void => {
    if (resolve_raw_node(tree.node, registration.canonicalPath) !== registration.node) {
      throw new DocumentLiveTreeBindingError(
        DOCUMENT_BINDING_TARGET_MISSING_ERROR_CODE,
        "Projected element is no longer present at its canonical raw document path.",
      );
    }
    validate_registration(registration, mountedElements);
  };

  const converge_compatible_root = (
    canonicalCapture: DocumentLiveMapCapture<"element">,
    observedMaterial: DocumentRootMaterial,
    targetRevision: number,
  ): void => {
    for (const registration of registrations) validate_bound_registration(registration);
    const priorRootQuid = byPath.get(path_key([]))?.persistedQuid;
    const convergence = plan_document_root_convergence(
      tree.node,
      canonicalCapture.root,
      observedMaterial,
      priorRootQuid,
      (node) => {
        const registration = document_binding_for_node(node);
        return registration?.owner === owner ? registration.persistedQuid : undefined;
      },
    );
    currentStatus = "replacing";
    try {
      apply_document_structural_transaction(convergence.structural);
    } catch (cause) {
      prune_removed_registrations(convergence.structural.finalNodes);
      throw new DocumentLiveTreeBindingError(
        DOCUMENT_BINDING_ROOT_REPLACEMENT_FAILED_ERROR_CODE,
        "Compatible projected root convergence failed during graph or DOM application.",
        cause,
      );
    }
    if (currentStatus !== "replacing") {
      if (currentStatus === "failed") {
        prune_removed_registrations(convergence.structural.finalNodes);
      }
      throw currentFailure ?? new DocumentLiveTreeBindingError(
        DOCUMENT_BINDING_ROOT_REPLACEMENT_FAILED_ERROR_CODE,
        "Compatible root convergence was interrupted before correspondence publication.",
      );
    }
    prune_removed_registrations(convergence.structural.finalNodes);
    rebuild_correspondence(convergence.canonicalElement);
    for (const registration of registrations) validate_bound_registration(registration);
    currentRevision = targetRevision;
    projectionTransactions += 1;
    currentStatus = "active";
  };

  const apply_observation = (observation: LiveMapCommitObservation<LiveMapGraphOp>): void => {
    if (observation.kind === "snapshot") {
      let canonicalCapture: DocumentLiveMapCapture<"element">;
      try {
        canonicalCapture = map.capture();
      } catch (cause) {
        throw new DocumentLiveTreeBindingError(
          DOCUMENT_BINDING_SNAPSHOT_CAPTURE_FAILED_ERROR_CODE,
          "ElementLiveMap snapshot recapture failed.",
          cause,
        );
      }
      if (canonicalCapture.rev !== observation.revision) {
        throw new DocumentLiveTreeBindingError(
          DOCUMENT_BINDING_SNAPSHOT_REVISION_MISMATCH_ERROR_CODE,
          `Snapshot observation revision ${observation.revision} does not match captured revision ${canonicalCapture.rev}.`,
        );
      }
      converge_compatible_root(
        canonicalCapture,
        canonicalCapture,
        observation.revision,
      );
      return;
    }
    const { commit } = observation;
    if (commit.prevRev !== currentRevision) {
      throw new DocumentLiveTreeBindingError(
        DOCUMENT_BINDING_REVISION_GAP_ERROR_CODE,
        `Document binding expected revision ${currentRevision}, but commit began at ${commit.prevRev}.`,
      );
    }
    if (!commit.changed || commit.ops.length === 0) return;
    const replaceRoot = commit.ops.length === 1 && commit.ops[0]?.op === "replace-root"
      ? commit.ops[0]
      : undefined;
    if (replaceRoot !== undefined) {
      const canonicalCapture = map.capture();
      if (canonicalCapture.rev !== commit.rev) {
        throw new DocumentLiveTreeBindingError(
          DOCUMENT_BINDING_REVISION_GAP_ERROR_CODE,
          "ElementLiveMap revision changed before compatible root convergence could be planned.",
        );
      }
      converge_compatible_root(canonicalCapture, replaceRoot, commit.rev);
      return;
    }
    if (commit.ops.some((operation) => operation.domain !== "graph"
      || (operation.op !== "set-attr"
        && operation.op !== "remove-attr"
        && operation.op !== "replace-attrs"
        && operation.op !== "insert-content"
        && operation.op !== "remove-content"
        && operation.op !== "move-content"
        && operation.op !== "replace-content"))) {
      throw new DocumentLiveTreeBindingError(
        DOCUMENT_BINDING_UNSUPPORTED_OPERATION_ERROR_CODE,
        "Changed graph operation is unsupported by this document binding proof.",
      );
    }

    const hasStructuralOperation = commit.ops.some((operation) => operation.op === "insert-content"
      || operation.op === "remove-content"
      || operation.op === "move-content"
      || operation.op === "replace-content");
    if (hasStructuralOperation) {
      for (const registration of registrations) validate_bound_registration(registration);
      const canonicalRoot = map.element.node();
      const plan = plan_document_structural_transaction(
        tree.node,
        canonicalRoot,
        commit.ops,
        (node) => {
          const registration = document_binding_for_node(node);
          return registration?.owner === owner ? registration.persistedQuid : undefined;
        },
      );
      try {
        apply_document_structural_transaction(plan);
      } catch (cause) {
        prune_removed_registrations(plan.finalNodes);
        throw cause;
      }
      prune_removed_registrations(plan.finalNodes);
      rebuild_correspondence(canonicalRoot);
      for (const registration of registrations) validate_bound_registration(registration);
      currentRevision = commit.rev;
      projectionTransactions += 1;
      return;
    }

    const planned = new Map<ProjectedRegistration, CanonicalPublicAttrs>();
    for (const operation of commit.ops) {
      if (operation.op !== "set-attr" && operation.op !== "remove-attr" && operation.op !== "replace-attrs") continue;
      const registration = resolve_registration(operation.target);
      validate_bound_registration(registration);
      planned.set(registration, read_map_attrs(map, registration.canonicalTarget));
    }

    for (const [registration, attrs] of planned) {
      apply_projected_attrs_replacement(registration.node, attrs);
    }
    for (const [registration, attrs] of planned) {
      validate_bound_registration(registration);
      const projected = read_projected_attrs(registration.node);
      if (!canonical_public_attrs_equal(projected, attrs)) {
        throw new DocumentLiveTreeBindingError(
          DOCUMENT_BINDING_PROJECTION_FAILED_ERROR_CODE,
          "Projected attributes do not match the canonical final state.",
        );
      }
      validate_dom_attrs(registration, attrs);
    }
    currentRevision = commit.rev;
    projectionTransactions += 1;
  };

  const on_observation = (observation: LiveMapCommitObservation): void => {
    if (currentStatus === "replacing") {
      fail(new DocumentLiveTreeBindingError(
        DOCUMENT_BINDING_ROOT_REPLACEMENT_FAILED_ERROR_CODE,
        "A reentrant document observation interrupted compatible root convergence.",
      ));
      return;
    }
    if (currentStatus !== "active") return;
    try {
      apply_observation(observation as LiveMapCommitObservation<LiveMapGraphOp>);
    } catch (cause) {
      fail(as_binding_error(cause, DOCUMENT_BINDING_PROJECTION_FAILED_ERROR_CODE, "Document attribute projection failed."));
    }
  };

  try {
    walk(tree.node, []);
    off = map.commits.observe(on_observation);
    if (map.rev !== capturedRevision) {
      throw new DocumentLiveTreeBindingError(
        DOCUMENT_BINDING_REVISION_GAP_ERROR_CODE,
        "ElementLiveMap revision changed during document binding initialization.",
      );
    }
    currentStatus = "active";
  } catch (cause) {
    off?.();
    off = undefined;
    for (const registration of registrations) unregister_document_binding_node(registration.node, owner);
    ACTIVE_DOCUMENT_BINDINGS.delete(map);
    throw as_binding_error(cause, DOCUMENT_BINDING_PROJECTION_FAILED_ERROR_CODE, "Document binding initialization failed.");
  }

  const binding: DocumentLiveTreeBinding = Object.freeze({
    tree,
    get status() { return currentStatus; },
    get sourceRevision() { return currentRevision; },
    get failure() { return currentFailure; },
    diagnostics: () => {
      if (currentStatus === "disposed") {
        throw new DocumentLiveTreeBindingError(
          DOCUMENT_BINDING_DISPOSED_ERROR_CODE,
          "Document binding has been disposed.",
        );
      }
      return Object.freeze({ projectionTransactions, registeredElements: registrations.length });
    },
    dispose: () => {
      if (currentStatus === "disposed") return;
      const disposeObserver = off;
      off = undefined;
      disposeObserver?.();
      for (const registration of registrations) unregister_document_binding_node(registration.node, owner);
      byPath.clear();
      byQuid.clear();
      ACTIVE_DOCUMENT_BINDINGS.delete(map);
      currentStatus = "disposed";
    },
  });
  return binding;
}

function collect_persisted_quids(root: HsonNode): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  const walk = (node: HsonNode, path: readonly number[]): void => {
    if (is_ordinary_element_node(node)) {
      const quid = node.$_meta?.[_DATA_QUID];
      if (quid !== undefined) {
        if (!is_persisted_quid(quid)) {
          throw new DocumentLiveTreeBindingError(
            DOCUMENT_BINDING_QUID_MISMATCH_ERROR_CODE,
            "Canonical document contains a malformed persisted QUID.",
          );
        }
        result.set(path_key(path), quid);
      }
    }
    for (let index = 0; index < node.$_content.length; index += 1) {
      const child = node.$_content[index];
      if (is_Node(child)) walk(child, [...path, index]);
    }
  };
  walk(root, []);
  return result;
}

function read_map_attrs(map: ElementLiveMap, target: LiveMapDocumentTarget): CanonicalPublicAttrs {
  const values: Record<string, unknown> = {};
  for (const name of map.document.attrs.keys(target)) values[name] = map.document.attrs.must.get(target, name);
  const attrs = decode_public_attrs(values);
  if (attrs === undefined) {
    throw new DocumentLiveTreeBindingError(
      DOCUMENT_BINDING_PROJECTION_FAILED_ERROR_CODE,
      "Canonical document attribute read did not produce a valid final-state bag.",
    );
  }
  return attrs;
}

function read_projected_attrs(node: HsonNode): CanonicalPublicAttrs {
  const attrs = decode_public_attrs(node.$_attrs ?? {});
  if (attrs === undefined) {
    throw new DocumentLiveTreeBindingError(
      DOCUMENT_BINDING_PROJECTION_FAILED_ERROR_CODE,
      "Projected node contains invalid ordinary attributes.",
    );
  }
  return attrs;
}

function validate_registration(
  registration: ProjectedRegistration,
  mountedElements: WeakMap<HsonNode, Element>,
): void {
  if (!is_ordinary_element_node(registration.node)) {
    throw new DocumentLiveTreeBindingError(
      DOCUMENT_BINDING_NODE_KIND_MISMATCH_ERROR_CODE,
      "Projected attribute target is not an ordinary document element.",
    );
  }
  if (document_binding_for_node(registration.node)?.owner !== registration.owner) {
    throw new DocumentLiveTreeBindingError(
      DOCUMENT_BINDING_TARGET_MISSING_ERROR_CODE,
      "Projected element registration is missing or belongs to another binding.",
    );
  }
  if (registration.persistedQuid !== undefined
    && registration.node.$_meta?.[_DATA_QUID] !== registration.persistedQuid) {
    throw new DocumentLiveTreeBindingError(
      DOCUMENT_BINDING_QUID_MISMATCH_ERROR_CODE,
      "Projected element no longer carries its expected persisted QUID.",
    );
  }
  const element = get_el_for_node(registration.node);
  const priorElement = mountedElements.get(registration.node);
  if (element === undefined) {
    if (priorElement !== undefined) {
      throw new DocumentLiveTreeBindingError(
        DOCUMENT_BINDING_DOM_MAPPING_MISMATCH_ERROR_CODE,
        "Previously mounted projected element lost its node mapping.",
      );
    }
    return;
  }
  if (priorElement !== undefined && priorElement !== element) {
    throw new DocumentLiveTreeBindingError(
      DOCUMENT_BINDING_DOM_MAPPING_MISMATCH_ERROR_CODE,
      "Projected element mapping changed during an attribute-only binding.",
    );
  }
  mountedElements.set(registration.node, element);
  try {
    assert_node_element_link(registration.node);
  } catch (cause) {
    throw new DocumentLiveTreeBindingError(
      DOCUMENT_BINDING_DOM_MAPPING_MISMATCH_ERROR_CODE,
      "Projected node and DOM element mapping does not round-trip.",
      cause,
    );
  }
  if (get_node_for_el(element) !== registration.node) {
    throw new DocumentLiveTreeBindingError(
      DOCUMENT_BINDING_DOM_MAPPING_MISMATCH_ERROR_CODE,
      "Mounted projected element resolves to a different HSON node.",
    );
  }
  if (registration.persistedQuid !== undefined
    && element.getAttribute(_DATA_QUID) !== registration.persistedQuid) {
    throw new DocumentLiveTreeBindingError(
      DOCUMENT_BINDING_QUID_MISMATCH_ERROR_CODE,
      "Mounted projected element does not carry its expected persisted QUID.",
    );
  }
  const tagName = (element as { tagName?: unknown }).tagName;
  if (typeof tagName === "string" && tagName.toLowerCase() !== registration.node.$_tag.toLowerCase()) {
    throw new DocumentLiveTreeBindingError(
      DOCUMENT_BINDING_NODE_KIND_MISMATCH_ERROR_CODE,
      "Mounted projected element tag does not match its HSON node kind.",
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
    const styleText = name === "style" && typeof value === "object" && value !== null
      ? serialize_style(value)
      : undefined;
    const expected = styleText === ""
      ? null
      : styleText !== undefined
        ? styleText
        : String(value);
    if (expected !== null) expectedNames.add(name);
    if (element.getAttribute(name) !== expected) {
      throw new DocumentLiveTreeBindingError(
        DOCUMENT_BINDING_PROJECTION_FAILED_ERROR_CODE,
        "Mounted DOM attributes do not match the canonical projected final state.",
      );
    }
  }
  for (const name of element.getAttributeNames()) {
    if (name === _DATA_QUID) continue;
    if (!expectedNames.has(name)) {
      throw new DocumentLiveTreeBindingError(
        DOCUMENT_BINDING_PROJECTION_FAILED_ERROR_CODE,
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
  code: ConstructorParameters<typeof DocumentLiveTreeBindingError>[0],
  message: string,
): DocumentLiveTreeBindingError {
  return cause instanceof DocumentLiveTreeBindingError
    ? cause
    : new DocumentLiveTreeBindingError(code, message, cause);
}

function delegation_unsupported(reason: string): DocumentLiveTreeBindingError {
  return new DocumentLiveTreeBindingError(
    DOCUMENT_BINDING_DELEGATION_UNSUPPORTED_ERROR_CODE,
    `Bound LiveTree mutation is deliberately unsupported: ${reason}.`,
  );
}
