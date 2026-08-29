import { ELEM_TAG, STR_TAG, VAL_TAG, HSON_META_QUID } from "../../core/constants.js";
import { clone_node } from "../../core/clone-node.js";
import { canonical_public_attrs_equal, decode_public_attrs } from "../../core/public-attrs.js";
import { is_Node, is_ordinary_element_node } from "../../core/node-guards.js";
import type { CanonicalPublicAttrs, HsonNode } from "../../core/types.js";
import type {
  ElementLiveMap,
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
  get_el_for_node,
  get_node_for_el,
} from "../livetree/utils/node-map-helpers.js";
import { dispose_node_deep } from "../livetree/utils/dispose-node.js";
import { release_subtree_ownership } from "../livetree/lifecycle/graph-ownership.js";
import { serialize_style } from "../transform/utils/attrs-utils/serialize-style.js";
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
  DocumentReflectError,
} from "./reflect.document.error.js";
import {
  apply_document_structural_transaction,
  plan_document_structural_transaction,
} from "./reflect.document.structure.js";
import {
  document_element_from_root,
  plan_document_root_convergence,
  type DocumentRootMaterial,
} from "./reflect.document.root.js";
import {
  default_livetree_runtime,
  type LiveTreeRuntime,
} from "../livetree/runtime/livetree-runtime.js";
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

export type DocumentReflectStatus = "initializing" | "active" | "replacing" | "failed" | "disposed";

export type DocumentReflect = Readonly<{
  readonly tree: LiveTree;
  readonly status: DocumentReflectStatus;
  readonly sourceRevision: number;
  readonly failure: DocumentReflectError | undefined;
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

const ACTIVE_DOCUMENT_BINDINGS = new WeakSet<ElementLiveMap>();

/** Internal attribute-only proof that projects one ElementLiveMap into one LiveTree. */
export function reflect_document(
  map: ElementLiveMap,
): DocumentReflect {
  return reflect_document_in_runtime(map, default_livetree_runtime());
}

/** Bind a document projection into an already-selected LiveTree runtime. @internal */
export function reflect_document_in_runtime(
  map: ElementLiveMap,
  runtime: LiveTreeRuntime,
): DocumentReflect {
  if (ACTIVE_DOCUMENT_BINDINGS.has(map)) {
    throw new DocumentReflectError(
      DOCUMENT_REFLECT_ALREADY_BOUND_ERROR_CODE,
      "ElementLiveMap already has an active document projection binding.",
    );
  }
  ACTIVE_DOCUMENT_BINDINGS.add(map);

  let capturedRevision: number;
  let sourceElement: HsonNode;
  try {
    capturedRevision = map.rev;
    sourceElement = map.element.node();
  } catch (cause) {
    ACTIVE_DOCUMENT_BINDINGS.delete(map);
    throw as_binding_error(cause, DOCUMENT_REFLECT_UPDATE_FAILED_ERROR_CODE, "Initial document binding capture failed.");
  }
  let tree: LiveTree;
  try {
    tree = create_linked_livetree_in_runtime(sourceElement, runtime);
  } catch (cause) {
    ACTIVE_DOCUMENT_BINDINGS.delete(map);
    throw as_binding_error(cause, DOCUMENT_REFLECT_UPDATE_FAILED_ERROR_CODE, "Initial LiveTree projection construction failed.");
  }

  const owner = {};
  let registrations: ProjectedRegistration[] = [];
  const byPath = new Map<string, ProjectedRegistration>();
  const byQuid = new Map<string, ProjectedRegistration>();
  const runtimeEpochQuids = new Set<string>();
  const mountedElements = new WeakMap<HsonNode, Element>();
  let currentStatus: DocumentReflectStatus = "initializing";
  let currentRevision = capturedRevision;
  let currentFailure: DocumentReflectError | undefined;
  let updatesApplied = 0;
  let wholeCorrespondenceBuilds = 0;
  let incrementalCorrespondenceUpdates = 0;
  let correspondenceEntriesChanged = 0;
  let identityEffectsConsumed = 0;
  let off: LiveMapDisposer | undefined;
  let offIdentityParticipant: (() => void) | undefined;

  const fail = (failure: DocumentReflectError): void => {
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
      throw new DocumentReflectError(
        DOCUMENT_REFLECT_UPDATE_FAILED_ERROR_CODE,
        "Document binding is not active for canonical attribute delegation.",
      );
    }
    validate_bound_registration(registration);
    const canonical = read_map_attrs(map, registration.canonicalTarget);
    const projected = read_projected_attrs(registration.node);
    if (!canonical_public_attrs_equal(canonical, projected)) {
      const failure = new DocumentReflectError(
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
      throw new DocumentReflectError(
        DOCUMENT_REFLECT_DELEGATION_TARGET_INVALID_ERROR_CODE,
        "Bound mutation target no longer resolves to a canonical ordinary element.",
      );
    }
    if (canonical.$_tag !== registration.node.$_tag) {
      throw new DocumentReflectError(
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
    const bucketTarget: LiveMapDocumentCommitTarget = Object.freeze({
      kind: "path",
      path: validate_document_path([...registration.canonicalPath, 0]),
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

  const dispose_binding = (): void => {
    if (currentStatus === "disposed") return;
    const disposeObserver = off;
    off = undefined;
    disposeObserver?.();
    offIdentityParticipant?.();
    offIdentityParticipant = undefined;
    for (const registration of registrations) unregister_document_binding_node(registration.node, owner);
    byPath.clear();
    byQuid.clear();
    ACTIVE_DOCUMENT_BINDINGS.delete(map);
    currentStatus = "disposed";
  };

  const delegate_remove = (registration: ProjectedRegistration): 1 | undefined => {
    canonical_node_for(registration);
    if (registration.canonicalPath.length === 0) {
      // Root removal is terminal lifecycle of the borrowed projection, not a
      // canonical LiveMap edit. Stop the bridge first, then let LiveTree own
      // its normal runtime teardown.
      dispose_binding();
      return undefined;
    }
    const index = registration.canonicalPath[registration.canonicalPath.length - 1]!;
    const parentPath = validate_document_path(registration.canonicalPath.slice(0, -1));
    map.document.content.remove(Object.freeze({ kind: "path", path: parentPath }), index);
    return 1;
  };

  const reject_structural_mutation = (operation: string): never => {
    if (currentStatus === "failed") throw currentFailure;
    throw new DocumentReflectError(
      DOCUMENT_REFLECT_UNSUPPORTED_OPERATION_ERROR_CODE,
      `Public LiveTree structural mutation ${operation} is unavailable while document-bound.`,
    );
  };

  const register = (node: HsonNode, canonicalPath: readonly number[]): void => {
    if (!is_ordinary_element_node(node)) return;
    const path = validate_document_path(canonicalPath);
    const pathKey = path_key(path);
    const persistedQuid = livemap_document_identity_overlay_for(map.document)
      .quidAtPath(path);
    if (node.$_meta?.[HSON_META_QUID] !== persistedQuid) {
      throw new DocumentReflectError(
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
      requireCanonicalIdentity: () => require_livemap_document_canonical_identity(
        map.document,
        registration.canonicalTarget,
      ),
      delegateAttrs: (mutation) => delegate_attrs(registration, mutation),
      delegateText: (mutation) => delegate_text(registration, mutation),
      delegateEmpty: () => delegate_empty(registration),
      delegateRemove: () => delegate_remove(registration),
      rejectStructuralMutation: reject_structural_mutation,
    });
    if (byPath.has(pathKey)) {
      throw new DocumentReflectError(
        DOCUMENT_REFLECT_TARGET_MISSING_ERROR_CODE,
        "Document projection produced duplicate canonical-path correspondence.",
      );
    }
    if (persistedQuid !== undefined && byQuid.has(persistedQuid)) {
      throw new DocumentReflectError(
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
    walk(tree.node, []);
    wholeCorrespondenceBuilds += 1;
  };

  const refresh_registration_at_path = (path: LiveMapDocumentPath): void => {
    const prior = byPath.get(path_key(path));
    if (prior === undefined) {
      throw new DocumentReflectError(
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
            throw new DocumentReflectError(
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
            throw new DocumentReflectError(
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
          throw new DocumentReflectError(
            DOCUMENT_REFLECT_UNSUPPORTED_OPERATION_ERROR_CODE,
            "Identity registration cannot compose with root replacement.",
          );
        }
        pending = pending.flatMap((entry) => {
          const transformed = transform_document_path(entry.path, effect);
          return transformed.kind === "retired"
            ? []
            : transformed.kind === "invalid"
              ? (() => { throw new DocumentReflectError(DOCUMENT_REFLECT_UPDATE_FAILED_ERROR_CODE, transformed.reason); })()
              : [{ registration: entry.registration, path: transformed.path }];
        });
        for (const claim of claims) {
          if (claim.path === undefined) continue;
          const transformed = transform_document_path(claim.path, effect);
          if (transformed.kind === "invalid") {
            throw new DocumentReflectError(DOCUMENT_REFLECT_UPDATE_FAILED_ERROR_CODE, transformed.reason);
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
            if (resolve_raw_node(tree.node, claim.path) !== claim.node) {
              throw new DocumentReflectError(
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
      release(): void {
        for (const claim of claims) claim.reservation.release();
      },
    });
  };

  const verify_existing_identity = (path: LiveMapDocumentPath, quid: string): void => {
    const registration = byPath.get(path_key(path));
    if (registration === undefined || registration.persistedQuid !== quid) {
      throw new DocumentReflectError(
        DOCUMENT_REFLECT_QUID_MISMATCH_ERROR_CODE,
        "Canonical identity is not registered to the expected projected correspondence.",
      );
    }
    validate_bound_registration(registration);
    if (runtime.quidToNode.get(quid) !== registration.node
      || runtime.nodeToQuid.get(registration.node) !== quid) {
      throw new DocumentReflectError(
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
      throw new DocumentReflectError(
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
        throw new DocumentReflectError(
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
        throw new DocumentReflectError(
          DOCUMENT_REFLECT_QUID_MISMATCH_ERROR_CODE,
          `Derived introduced identity effect duplicates active QUID ${JSON.stringify(effect.quid)}.`,
        );
      }
      expected.set(effect.quid, effect.path);
      expectedSize += 1;
    }

    const overlay = livemap_document_identity_overlay_for(map.document);
    if (overlay.size !== expectedSize) {
      throw new DocumentReflectError(
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
        throw new DocumentReflectError(
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
        throw new DocumentReflectError(
          DOCUMENT_REFLECT_UNSUPPORTED_OPERATION_ERROR_CODE,
          "Root replacement cannot use incremental document correspondence.",
        );
      }

      const nextPending: PendingRegistration[] = [];
      for (const entry of pending) {
        const transformed = transform_document_path(entry.path, effect);
        if (transformed.kind === "invalid") {
          throw new DocumentReflectError(
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
          throw new DocumentReflectError(
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
      const node = resolve_raw_node(tree.node, path);
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
      throw new DocumentReflectError(
        DOCUMENT_REFLECT_TARGET_MISSING_ERROR_CODE,
        "Canonical attribute target has no projected element correspondence.",
      );
    }
    if (target.witness !== undefined
      && registration.persistedQuid !== undefined
      && registration.persistedQuid !== target.witness.quid) {
      throw new DocumentReflectError(
        DOCUMENT_REFLECT_QUID_MISMATCH_ERROR_CODE,
        "Canonical attribute path does not match its persisted-QUID witness.",
      );
    }
    return registration;
  };

  const validate_bound_registration = (registration: ProjectedRegistration): void => {
    if (resolve_raw_node(tree.node, registration.canonicalPath) !== registration.node) {
      throw new DocumentReflectError(
        DOCUMENT_REFLECT_TARGET_MISSING_ERROR_CODE,
        "Projected element is no longer present at its canonical raw document path.",
      );
    }
    validate_registration(registration, mountedElements);
  };

  /** Cross the approved hard owner-epoch boundary with a fresh exact projection lineage. */
  const reconstruct_new_epoch = (
    canonicalMaterial: DocumentRootMaterial,
    targetRevision: number,
  ): void => {
    for (const registration of registrations) validate_bound_registration(registration);
    const outgoingRoot = tree.node;
    const incomingRoot = clone_node(document_element_from_root(canonicalMaterial.root));
    try {
      preflight_livetree_quid_epoch_replacement(
        incomingRoot,
        outgoingRoot,
        runtimeEpochQuids,
        runtime,
      );
    } catch (cause) {
      throw new DocumentReflectError(
        DOCUMENT_REFLECT_QUID_COLLISION_ERROR_CODE,
        "Fresh owner-epoch projection identity collides in the selected LiveTree runtime.",
        cause,
      );
    }

    const outgoingElement = get_el_for_node(outgoingRoot);
    const parent = outgoingElement?.parentNode;
    const nextSibling = outgoingElement?.nextSibling;
    const ownerDocument = outgoingElement?.ownerDocument;
    const namespace: "html" | "svg" = outgoingElement?.namespaceURI === "http://www.w3.org/2000/svg"
      ? "svg"
      : "html";

    currentStatus = "replacing";
    for (const registration of registrations) unregister_document_binding_node(registration.node, owner);
    registrations = [];
    byPath.clear();
    byQuid.clear();
    dispose_node_deep(outgoingRoot, runtime);
    reset_livetree_quid_epoch(runtimeEpochQuids, runtime);
    runtimeEpochQuids.clear();
    if (currentStatus !== "replacing") return;

    tree = create_linked_livetree_in_runtime(incomingRoot, runtime);
    walk(tree.node, []);
    wholeCorrespondenceBuilds += 1;
    if (ownerDocument !== undefined) {
      const incomingElement = project_linked_livetree(
        tree.node,
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
      tree.node,
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
      throw new DocumentReflectError(
        DOCUMENT_REFLECT_ROOT_REPLACEMENT_FAILED_ERROR_CODE,
        "Compatible projected root convergence failed during graph or DOM application.",
        cause,
      );
    }
    if (currentStatus !== "replacing") {
      if (currentStatus === "failed") {
        prune_removed_registrations(convergence.structural.finalNodes);
      }
      throw currentFailure ?? new DocumentReflectError(
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
    if (evidence === undefined || evidence.mode !== "element") {
      throw new DocumentReflectError(
        DOCUMENT_REFLECT_UPDATE_FAILED_ERROR_CODE,
        "ElementLiveMap observation reached Reflection without exact accepted-state evidence.",
      );
    }
    if (observation.kind === "snapshot") {
      if (evidence.revision !== observation.revision) {
        throw new DocumentReflectError(
          DOCUMENT_REFLECT_SNAPSHOT_REVISION_MISMATCH_ERROR_CODE,
          `Snapshot observation revision ${observation.revision} does not match accepted evidence revision ${evidence.revision}.`,
        );
      }
      if (evidence.continuity === "new-epoch") {
        reconstruct_new_epoch(evidence, observation.revision);
      } else {
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
      throw new DocumentReflectError(
        DOCUMENT_REFLECT_REVISION_GAP_ERROR_CODE,
        `Commit revision ${commit.rev} does not match accepted evidence revision ${evidence.revision}.`,
      );
    }
    if (commit.prevRev !== currentRevision) {
      throw new DocumentReflectError(
        DOCUMENT_REFLECT_REVISION_GAP_ERROR_CODE,
        `Document binding expected revision ${currentRevision}, but commit began at ${commit.prevRev}.`,
      );
    }
    if (!commit.changed || commit.ops.length === 0) return;
    consume_identity_effects(commit);
    const hasIdentityRegistration = commit.ops.some((operation) => operation.op === "ensure-quid");
    const identityReservation = livemap_document_identity_reservation_for(commit);
    if (hasIdentityRegistration && identityReservation === undefined) {
      throw new DocumentReflectError(
        DOCUMENT_REFLECT_QUID_MISMATCH_ERROR_CODE,
        "Canonical identity registration reached Reflection without local preflight evidence.",
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
      throw new DocumentReflectError(
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
        tree.node,
        document_element_from_root(evidence.root),
        commit.ops,
        (node) => {
          const registration = document_binding_for_node(node);
          return registration?.owner === owner ? registration.persistedQuid : undefined;
        },
      );
      try {
        apply_document_structural_transaction(plan, () => {
          reconcile_correspondence_incrementally(commit.ops);
        });
        identityReservation?.apply();
      } catch (cause) {
        prune_removed_registrations(plan.finalNodes);
        throw cause;
      }
      for (const claim of identityReservation?.apply() ?? []) {
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
        throw new DocumentReflectError(
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
      fail(new DocumentReflectError(
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
    walk(tree.node, []);
    wholeCorrespondenceBuilds += 1;
    offIdentityParticipant = register_livemap_document_identity_participant(map.document, Object.freeze({
      preflight: preflight_identity_operations,
      verifyExisting: verify_existing_identity,
    }));
    off = map.commits.observe(on_observation);
    if (map.rev !== capturedRevision) {
      throw new DocumentReflectError(
        DOCUMENT_REFLECT_REVISION_GAP_ERROR_CODE,
        "ElementLiveMap revision changed during document binding initialization.",
      );
    }
    currentStatus = "active";
  } catch (cause) {
    off?.();
    off = undefined;
    offIdentityParticipant?.();
    offIdentityParticipant = undefined;
    for (const registration of registrations) unregister_document_binding_node(registration.node, owner);
    const privateRoot = tree.node;
    dispose_node_deep(privateRoot, runtime);
    release_subtree_ownership(privateRoot);
    ACTIVE_DOCUMENT_BINDINGS.delete(map);
    throw as_binding_error(cause, DOCUMENT_REFLECT_UPDATE_FAILED_ERROR_CODE, "Document binding initialization failed.");
  }

  const binding: DocumentReflect = Object.freeze({
    get tree() { return tree; },
    get status() { return currentStatus; },
    get sourceRevision() { return currentRevision; },
    get failure() { return currentFailure; },
    diagnostics: () => {
      if (currentStatus === "disposed") {
        throw new DocumentReflectError(
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

function read_map_attrs(map: ElementLiveMap, target: LiveMapDocumentCommitTarget): CanonicalPublicAttrs {
  const values: Record<string, unknown> = {};
  for (const name of map.document.attrs.keys(target)) values[name] = map.document.attrs.must.get(target, name);
  const attrs = decode_public_attrs(values);
  if (attrs === undefined) {
    throw new DocumentReflectError(
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
  const node = resolve_raw_node(document_element_from_root(root), target.path);
  if (node === undefined || !is_ordinary_element_node(node)) {
    throw new DocumentReflectError(
      DOCUMENT_REFLECT_TARGET_MISSING_ERROR_CODE,
      "Accepted document evidence has no ordinary element at the observed attribute target.",
    );
  }
  return read_projected_attrs(node);
}

function read_projected_attrs(node: HsonNode): CanonicalPublicAttrs {
  const attrs = decode_public_attrs(node.$_attrs ?? {});
  if (attrs === undefined) {
    throw new DocumentReflectError(
      DOCUMENT_REFLECT_UPDATE_FAILED_ERROR_CODE,
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
    throw new DocumentReflectError(
      DOCUMENT_REFLECT_NODE_KIND_MISMATCH_ERROR_CODE,
      "Projected attribute target is not an ordinary document element.",
    );
  }
  if (document_binding_for_node(registration.node)?.owner !== registration.owner) {
    throw new DocumentReflectError(
      DOCUMENT_REFLECT_TARGET_MISSING_ERROR_CODE,
      "Projected element registration is missing or belongs to another binding.",
    );
  }
  if (registration.node.$_meta?.[HSON_META_QUID] !== registration.persistedQuid) {
    throw new DocumentReflectError(
      DOCUMENT_REFLECT_QUID_MISMATCH_ERROR_CODE,
      "Projected element no longer carries its expected persisted QUID.",
    );
  }
  const element = get_el_for_node(registration.node);
  const priorElement = mountedElements.get(registration.node);
  if (element === undefined) {
    if (priorElement !== undefined) {
      throw new DocumentReflectError(
        DOCUMENT_REFLECT_DOM_MAPPING_MISMATCH_ERROR_CODE,
        "Previously mounted projected element lost its node mapping.",
      );
    }
    return;
  }
  if (priorElement !== undefined && priorElement !== element) {
    throw new DocumentReflectError(
      DOCUMENT_REFLECT_DOM_MAPPING_MISMATCH_ERROR_CODE,
      "Projected element mapping changed during an attribute-only binding.",
    );
  }
  mountedElements.set(registration.node, element);
  try {
    assert_node_element_link(registration.node);
  } catch (cause) {
    throw new DocumentReflectError(
      DOCUMENT_REFLECT_DOM_MAPPING_MISMATCH_ERROR_CODE,
      "Projected node and DOM element mapping does not round-trip.",
      cause,
    );
  }
  if (get_node_for_el(element) !== registration.node) {
    throw new DocumentReflectError(
      DOCUMENT_REFLECT_DOM_MAPPING_MISMATCH_ERROR_CODE,
      "Mounted projected element resolves to a different HSON node.",
    );
  }
  const projectedDomQuid = element.getAttribute(HSON_QUID_MARKUP_NAME) ?? undefined;
  if (projectedDomQuid !== registration.persistedQuid) {
    throw new DocumentReflectError(
      DOCUMENT_REFLECT_QUID_MISMATCH_ERROR_CODE,
      "Mounted projected element does not carry its expected persisted QUID.",
    );
  }
  const tagName = (element as { tagName?: unknown }).tagName;
  if (typeof tagName === "string" && tagName.toLowerCase() !== registration.node.$_tag.toLowerCase()) {
    throw new DocumentReflectError(
      DOCUMENT_REFLECT_NODE_KIND_MISMATCH_ERROR_CODE,
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
      throw new DocumentReflectError(
        DOCUMENT_REFLECT_UPDATE_FAILED_ERROR_CODE,
        "Mounted DOM attributes do not match the canonical projected final state.",
      );
    }
  }
  for (const name of element.getAttributeNames()) {
    if (name === HSON_QUID_MARKUP_NAME) continue;
    if (!expectedNames.has(name)) {
      throw new DocumentReflectError(
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
  code: ConstructorParameters<typeof DocumentReflectError>[0],
  message: string,
): DocumentReflectError {
  return cause instanceof DocumentReflectError
    ? cause
    : new DocumentReflectError(code, message, cause);
}

function delegation_unsupported(reason: string): DocumentReflectError {
  return new DocumentReflectError(
    DOCUMENT_REFLECT_DELEGATION_UNSUPPORTED_ERROR_CODE,
    `Bound LiveTree mutation is deliberately unsupported: ${reason}.`,
  );
}
