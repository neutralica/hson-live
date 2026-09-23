// core.ts

import type { HsonNode, JsonValue } from "../../core/types.js";
import { register_echo_map_capability_internal } from "../../internal/echo-map-capability.js";
import { INTERACTION_RESERVED_LIBRARY_KEY } from "../../internal/interaction-storage.js";
import { rewrite_interaction_subjects, validate_interaction_subjects } from "../../internal/interaction-path-maintenance.js";
import type { HsonSchema } from "../transform/transform.types.js";
import { validate_hson_schema_graph } from "../../internal/schema-hson-validation/validate-canonical-hson.js";
import type { ClassifiedLiveMap, HostedLiveMapLibrariesSnapshot, LiveMap, LiveMapAnyOp, LiveMapCommit, LiveMapLibrariesSnapshot, LocalLibrariesContinuationSnapshot, LiveMapReplay, LiveMapCore, LiveMapCoreSchemaApi, LiveMapCoreSnap, LiveMapFeedListener, LiveMapPathValue, LiveMapStoreApi, LiveMapStorePathListener, LiveMapStoreSelectedListener, LiveMapStoreSubscribeOptions, LiveMapSubApi, LivePath, LiveMapDataOp, LiveMapBatchTx, LiveMapPathHandle, LiveMapCaptureOptions, LiveMapApply, LiveMapGraphCommit, LiveMapGraphOp, LiveMapGraphReplaceRootOp, LiveMapRootMode, LiveMapDocumentPath } from "../../types/livemap.types.js";
import type { LiveMapProjectedGraphEnsureQuidOp } from "./livemap.identity.types.js";
import { is_ordinary_element_node } from "../../core/node-guards.js";
import { resolve_document_path } from "./livemap.document.path.js";
import { register_livemap_document_identity_at_path } from "./livemap.document.identity.js";
import type { LiveMapRuntimeIdentityParticipant } from "./livemap.runtime-identity.js";
import {
  clone_live_root,
  delete_live_path,
  project_live_path,
  replace_live_path,
  resolve_value_node,
  set_live_path,
  snap_live_path,
  overwrite_hson_node,
} from "./livemap.editor.js";
import { make_livemap_feed_hub } from "./livemap.feed.js";
import { make_livemap_commit_observer_hub } from "./livemap.commit-observer.js";
import { make_livemap_path_handle } from "./livemap.handle.js";
import { make_livemap_proxy } from "./livemap.proxy.js";
import { make_livemap_store_api } from "./livemap.store.js";
import { must_feed_listener, must_live_path, must_ordered_projected_object, must_ordered_projected_value, path_kind_error } from "./livemap.guard.js";
import { append_live_path, clone_live_path, format_live_path, live_path_key, paths_overlap } from "./livemap.path.js";
import { LiveMapDocumentMutationError, LiveMapProjectedIdentityError, LiveMapProjectedMutationError, LiveMapProjectedTransportError, LiveMapReplayError, LiveMapRevError, } from "./livemap.error.js";
import { materialize_projected_value } from "../../core/projected-value-materialization.js";
import { hson_data_text_from_value } from "../data/hson-data.js";
import {
  is_ordered_projected_object,
  optional_ordered_projected_value_equal,
  ordered_projected_object,
  ordered_projected_value_equal,
  type OrderedProjectedObject,
  type OrderedProjectedValue,
} from "../../core/ordered-projected-value.js";
import {
  ordered_projected_array_move,
  ordered_projected_array_splice,
  ordered_projected_object_rename,
  ordered_projected_value_at,
  ordered_projected_value_delete,
  ordered_projected_value_replace,
  ordered_projected_value_set,
} from "../../core/ordered-projected-value-mutation.js";
import { projected_value_to_hson_root } from "../../core/projected-value-graph.js";
import { ROOT_TAG } from "../../core/constants.js";
import { is_Node } from "../../core/node-guards.js";
import { is_persisted_quid } from "../../core/hson-node-quid.js";
import { must_livemap_replay } from "./livemap.replay.js";
import {
  decode_projected_value_payload,
  encode_livemap_replay_transport,
  encode_projected_value_transport,
  LIVEMAP_STRUCTURAL_JSON_FORMAT,
  LiveMapTransportCodecError,
  materialize_livemap_projected_op,
  type LiveMapProjectedDataOp,
} from "./livemap.transport.js";
import { classify_live_root_mode, facade_for_livemap_root, prepare_livemap_root } from "./livemap.document.js";
import { canonical_graph_equal, type LiveMapDocumentInstallController, type PreparedDocumentInstall } from "./livemap.document.install.js";
import {
  prepare_document_graph_operation,
  type LiveMapDocumentMutationController,
  type PreparedDocumentMutation,
} from "./livemap.document.mutation.js";
import type { LiveMapDocumentReplayController, PreparedDocumentReplay } from "./livemap.document.replay.js";
import type { InternalDocumentSchemaController } from "./livemap.document.schema.js";
import { register_livemap_document_identity_candidate_commit } from "./livemap.document.registration.js";
import {
  LiveMapTransitionError,
  make_livemap_transition_controller,
  register_livemap_staged_authority,
  type LiveMapStagedAuthority,
  type LiveMapTransitionController,
  type PreparedLiveMapTransition,
} from "./livemap.authority.js";
import {
  livemap_projected_propagation,
  register_livemap_projected_propagation,
  type LiveMapProjectedDeleteWrite,
  type LiveMapProjectedPropagation,
  type LiveMapProjectedPropagationWrite,
  type LiveMapProjectedMoveWrite,
  type LiveMapProjectedRenameWrite,
  type LiveMapProjectedReplaceWrite,
  type LiveMapProjectedSetWrite,
  type LiveMapProjectedSpliceWrite,
} from "./livemap.projected-propagation.js";
import {
  register_livemap_document_identity_effects,
  livemap_document_identity_effects_for,
  livemap_document_identity_quids,
  livemap_document_identity_overlay_equal,
  replace_livemap_document_identity_overlay_effects,
  type LiveMapDocumentIdentityEffect,
} from "./livemap.document.identity.js";
import {
  livemap_document_commit_continuity,
  register_livemap_document_observation_evidence,
  register_livemap_document_commit_continuity,
} from "./livemap.document.capture.js";
import {
  apply_livemap_projected_identity_overlay,
  livemap_projected_identity_quids,
  reconcile_livemap_projected_identity_overlay,
  register_livemap_projected_identity_at_path,
  livemap_projected_identity_has_at_or_below,
  is_livemap_projected_identity_target,
  type LiveMapProjectedIdentityOverlay,
} from "./livemap.projected.identity.js";
import { make_livemap_projected_identity_api, register_livemap_projected_identity_api } from "./livemap.projected.identity-handle.js";
import {
  capture_livemap_projected,
  projected_capture_continuity,
  projected_capture_identity_overlay,
} from "./livemap.projected.capture.js";
import { clone_hson_graph_without_quids } from "./livemap.document.capture.js";
import { read_livemap_document_logical_location } from "./livemap.document.location.js";
import {
  detach_livemap_document_endpoint,
  make_livemap_watch_hub,
  optional_livemap_document_endpoint_equal,
  publish_livemap_after_watch,
  type LiveMapDocumentWatchRegistration,
} from "./livemap.watch.js";
import {
  register_internal_livemap_aggregate_owner,
  register_internal_livemap_library_owner,
  register_internal_livemap_owner,
  type InternalLiveMapAggregateAuthority,
} from "./livemap.internal.js";
import {
  enumerate_livemap_issued_quids,
  type LiveMapIdentityEpochController,
  type LiveMapIssuedQuidLedger,
  LiveMapIdentityEpochError,
  make_livemap_issued_quid_ledger,
  make_livemap_identity_epoch,
  register_livemap_identity_epoch_owner,
  retain_livemap_identity_epoch,
  stage_livemap_identity_epoch,
} from "./livemap.identity-epoch.js";
import {
  HOSTED_MAX_ISSUED_QUIDS,
  LIVEMAP_LIBRARIES_SNAPSHOT_FORMAT,
  assert_libraries_snapshot_bound,
  assert_libraries_snapshot_shape,
  assert_local_libraries_snapshot_shape,
  assert_hosted_libraries_snapshot_shape,
  decode_hosted_commit,
  decode_hosted_root,
  encode_hosted_root,
  hosted_sha256,
  make_hosted_authority_fence,
  make_hosted_commit,
  make_hosted_registry,
  type HostedAggregateCommit,
  type HostedAuthorityFence,
  type HostedRegistry,
  type HostedRegistryBinding,
} from "./livemap.hosted.js";
import {
  livemap_library_target,
  livemap_system_target,
  make_livemap_library,
  make_livemap_library_registry,
  reject_livemap_aggregate_legacy_lowering,
  type LiveMapAggregateCommit,
  type LiveMapAggregateOperation,
  type LiveMapAggregateWrite,
  type LiveMapLibraryIdentity,
  type LiveMapLibraryState,
  type LiveMapStructuralTarget,
} from "./livemap.library.js";
import {
  make_livemap_system_identity,
  type LiveMapSystemIdentity,
  type LiveMapSystemState,
} from "./livemap.system.js";

type LiveMapConstructiveSetWriteOp = Readonly<{
  kind: "constructive-set";
  path: LivePath;
  value: OrderedProjectedObject;
}>;

type LiveMapProjectedSetWriteOp = LiveMapProjectedSetWrite;
type LiveMapProjectedReplaceWriteOp = LiveMapProjectedReplaceWrite;
type LiveMapProjectedDeleteWriteOp = LiveMapProjectedDeleteWrite;
type LiveMapProjectedSpliceWriteOp = LiveMapProjectedSpliceWrite;
type LiveMapProjectedRenameWriteOp = LiveMapProjectedRenameWrite;
type LiveMapProjectedMoveWriteOp = LiveMapProjectedMoveWrite;

type LiveMapCoreWriteOp =
  | LiveMapProjectedSetWriteOp
  | LiveMapProjectedReplaceWriteOp
  | LiveMapProjectedDeleteWriteOp
  | LiveMapProjectedSpliceWriteOp
  | LiveMapProjectedRenameWriteOp
  | LiveMapProjectedMoveWriteOp
  | LiveMapConstructiveSetWriteOp;

type BuiltLiveMapCore = Readonly<{
  core: LiveMapCore<JsonValue | undefined>;
  projected: LiveMapProjectedPropagation;
  document?: LiveMapDocumentInstallController & LiveMapDocumentMutationController & LiveMapDocumentReplayController & InternalDocumentSchemaController;
  transitionController: LiveMapTransitionController;
  aggregateAuthority: InternalLiveMapAggregateAuthority;
  compatibilityLibrary: () => LiveMapLibraryState;
  mapRevision: () => number;
  mapIdentityEpoch: LiveMapIdentityEpochController;
  currentRoot: () => HsonNode;
  currentHsonSchema: () => HsonSchema | undefined;
  currentPreparedRoot: () => ReturnType<typeof prepare_livemap_root>;
  watchDocument: LiveMapDocumentWatchRegistration;
  prepareDetachedCommit: (
    commit: LiveMapCommit<LiveMapAnyOp>,
    nextRoot: HsonNode,
    preparedNext?: ReturnType<typeof prepare_livemap_root>,
  ) => PreparedLiveMapTransition;
  prepareProjectedWriteOps: (writeOps: readonly LiveMapCoreWriteOp[]) => PreparedLiveMapTransition;
  prepareProjectedBatch: (fn: (tx: LiveMapBatchTx<JsonValue | undefined>) => void) => PreparedLiveMapTransition;
}>;

export type RegistryRoot = Readonly<{
  root: HsonNode;
  hsonSchema?: HsonSchema;
}>;

export type InitialSystemState = Readonly<{
  key: string;
  transportName: string;
  root: HsonNode;
  hsonSchema: HsonSchema;
}>;

/** Construct all named graphs before opening their shared transition authority. @internal */
export function make_livemap_registry_authority(
  roots: readonly RegistryRoot[],
  systems: readonly InitialSystemState[] = [],
): Readonly<{
  aggregate: InternalLiveMapAggregateAuthority;
  identities: readonly LiveMapLibraryIdentity[];
}> {
  if (roots.length === 0) throw new Error("LiveMap registry requires at least one library.");
  const prepared = roots.map(({ root, hsonSchema }) => {
    const graph = prepare_livemap_root(root);
    if (hsonSchema !== undefined) must_hson_schema_root(hsonSchema, graph.root);
    return { graph, hsonSchema };
  });
  // The compatibility facade is deliberately neutral for a registry-backed
  // authority. No application record supplies its mode, root, or identity.
  const compatibilityRoot = prepare_livemap_root(projected_value_to_hson_root(ordered_projected_object([])));
  const built = make_livemap_core_from_compatibility_root(compatibilityRoot, {
    registry: prepared,
    systems,
  });
  return Object.freeze({
    aggregate: built.aggregateAuthority,
    identities: built.aggregateAuthority.libraries(),
  });
}



/**
 * Create the first Core facade for a LiveMap graph.
 *
 * Core owns the root Hson node and exposes graph-level operations in projected
 * JSON path terms. It is the layer that coordinates editor mutations, commit
 * generation, feeds, links, batching, and later transport-compatible behavior.
 *
 * `at(path)` is the data data handle. `root()` returns a detached canonical
 * clone. The solo compatibility record's canonical graph is never exposed
 * through the public facade.
 *
 * Mutation contract:
 * - `set(path, value)` requires the addressed path to resolve. Plain object
 *   values expand into shallow child writes when the current endpoint is an
 *   object, so unspecified siblings are preserved.
 * - `setMany(path, values)` requires `path` to resolve to an object and writes
 *   the supplied child keys under that object.
 * - `replace(path?, value)` destructively replaces the root or endpoint.
 * - `delete(path)` is strict and requires the addressed path to resolve.
 *
 * Schema validation previews the full candidate root before editor mutation, so
 * schema/editor failures leave the live graph unchanged.
 */
export function make_livemap_core(input: HsonNode): LiveMapCore<JsonValue | undefined> {
  const prepared = prepare_livemap_root(input);
  const built = make_livemap_core_from_compatibility_root(prepared);
  register_internal_livemap_owner(built.core, built.currentRoot);
  register_internal_livemap_library_owner(
    built.core,
    built.compatibilityLibrary,
    built.mapRevision,
    built.mapIdentityEpoch,
  );
  register_internal_livemap_aggregate_owner(built.core, built.aggregateAuthority);
  register_staged_facade(built.core, built);
  register_livemap_projected_propagation(built.core, built.projected);
  return built.core;
}

/** Construct the public shape-specific façade after detached root ownership. */
export function make_classified_livemap(input: HsonNode): ClassifiedLiveMap {
  const prepared = prepare_livemap_root(input);
  const built = make_livemap_core_from_compatibility_root(prepared);
  const facade = facade_for_livemap_root(
    built.core,
    prepared,
    built.document,
    built.watchDocument,
  );
  register_internal_livemap_owner(built.core, built.currentRoot);
  register_internal_livemap_owner(facade, built.currentRoot);
  register_internal_livemap_library_owner(
    built.core,
    built.compatibilityLibrary,
    built.mapRevision,
    built.mapIdentityEpoch,
  );
  register_internal_livemap_aggregate_owner(built.core, built.aggregateAuthority);
  register_internal_livemap_library_owner(
    facade,
    built.compatibilityLibrary,
    built.mapRevision,
    built.mapIdentityEpoch,
  );
  register_internal_livemap_aggregate_owner(facade, built.aggregateAuthority);
  register_staged_facade(facade, built);
  register_livemap_projected_propagation(built.core, built.projected);
  register_livemap_projected_propagation(facade, built.projected);
  return facade;
}

/** Build the shared Core around a root already cloned, validated, and indexed. */
function make_livemap_core_from_compatibility_root(
  prepared: ReturnType<typeof prepare_livemap_root>,
  initial: Readonly<{
    revision?: number;
    hsonSchema?: HsonSchema;
    registry?: readonly Readonly<{
      graph: ReturnType<typeof prepare_livemap_root>;
      hsonSchema?: HsonSchema;
    }>[];
    systems?: readonly InitialSystemState[];
  }> = {},
): BuiltLiveMapCore {
  const compatibilityLibrary = make_livemap_library(prepared, initial.hsonSchema);
  const states = initial.registry === undefined
    ? [compatibilityLibrary]
    : initial.registry.map(({ graph, hsonSchema }) => make_livemap_library(graph, hsonSchema));
  const libraryRegistry = make_livemap_library_registry(states);
  if (compatibilityLibrary.mode !== "document") {
    compatibilityLibrary.projectedValue = must_projected_root_value(compatibilityLibrary.root);
  }
  for (const library of states) {
    if (library.mode !== "document") library.projectedValue = must_projected_root_value(library.root);
  }
  const initialMode = compatibilityLibrary.mode;
  // Revision, transition, publication, and QUID identity authority stay on the
  // enclosing LiveMap. A Library owns only graph-local state.
  let mapRevision = initial.revision ?? 0;
  const getProjectedValue = (): OrderedProjectedValue => {
    if (compatibilityLibrary.projectedValue === undefined) throw new Error("Data value is unavailable in document mode.");
    return compatibilityLibrary.projectedValue;
  };
  const feedHub = make_livemap_feed_hub();
  const commitObserverHub = make_livemap_commit_observer_hub<LiveMapAnyOp>();
  const projectedWatchHub = make_livemap_watch_hub({
    clonePath: clone_live_path,
    read: (path: LivePath) => project_live_path(compatibilityLibrary.root, path),
    equal: optional_ordered_projected_value_equal,
    detach: (value: OrderedProjectedValue | undefined): JsonValue | undefined => (
      value === undefined ? undefined : materialize_projected_value(value)
    ),
    relevant: (commit, path) => commit.ops.some((operation) => (
      !("domain" in operation) && paths_overlap(path, operation.path)
    )),
  });
  const documentWatchHub = make_livemap_watch_hub({
    clonePath: (path: readonly number[]): readonly number[] => Object.freeze([...path]),
    read: (path: readonly number[]) => {
      if (initialMode !== "document") {
        throw new Error("Document location watch is unavailable in data mode.");
      }
      return read_livemap_document_logical_location(compatibilityLibrary.root, initialMode, path);
    },
    equal: optional_livemap_document_endpoint_equal,
    detach: detach_livemap_document_endpoint,
    relevant: () => true,
  });
  // This is deliberately one-per-LiveMap, not one-per-Library. It is the
  // map-wide QUID epoch and issued ledger. Active overlays remain graph-local
  // to their selected application Libraries.
  const mapIdentityEpoch = make_livemap_identity_epoch(aggregate_quid_locations(states).keys());
  let identityGeneration = 0;
  let localIdentityTransactionActive = false;
  /** Legacy root replacement resets an identity epoch and is one-library-only. */
  const assert_legacy_identity_epoch_reset_available = (): void => {
    if (libraryRegistry.size() === 1) return;
    throw new Error(
      "Legacy root replacement cannot reset a LiveMap-wide QUID epoch after another internal library is attached.",
    );
  };
  /** Revision zero represents the initial graph before any changed commit. */
  const transitionController = make_livemap_transition_controller(() => mapRevision);
  const publicationQueue: Array<() => void> = [];
  let publicationCursor = 0;
  let publishing = false;

  const enqueuePublication = (publish: () => void): void => {
    publicationQueue.push(publish);
    if (publishing) return;
    publishing = true;
    let firstFailure: unknown;
    let failed = false;
    try {
      while (publicationCursor < publicationQueue.length) {
        const next = publicationQueue[publicationCursor];
        publicationCursor += 1;
        if (next === undefined) continue;
        try {
          next();
        } catch (error) {
          if (!failed) {
            firstFailure = error;
            failed = true;
          }
        }
      }
    } finally {
      publicationQueue.length = 0;
      publicationCursor = 0;
      publishing = false;
    }
    if (failed) throw firstFailure;
  };

  const publishCommitWithWatch = (
    commit: LiveMapCommit<LiveMapAnyOp>,
    publishExisting: () => void,
  ): void => {
    // Canonical install is already complete here. Location watches publish
    // first; ordinary observers then run in registration order. Reflection is
    // one such observer, so callbacks before its slot can observe the new
    // canonical revision while that downstream runtime projection is older.
    const documentEvidence = initialMode === "document"
      ? Object.freeze({
        mode: initialMode,
        revision: commit.rev,
        root: compatibilityLibrary.root,
        continuity: livemap_document_commit_continuity(commit)
          ?? (commit.ops[0] !== undefined
            && "domain" in commit.ops[0]
            && commit.ops[0].op === "replace-root"
            ? "new-epoch"
            : "same-epoch"),
      })
      : undefined;
    enqueuePublication(() => {
      const watchFailure = initialMode === "document"
        ? documentWatchHub.emitCommit(commit)
        : projectedWatchHub.emitCommit(commit);
      publish_livemap_after_watch(watchFailure, () => {
        if (documentEvidence !== undefined) {
          commitObserverHub.prepareObservation((observation) => {
            register_livemap_document_observation_evidence(observation, documentEvidence);
          });
        }
        publishExisting();
      });
    });
  };

  const publishSnapshotWithWatch = (
    revision: number,
    continuity?: "same-epoch" | "new-epoch",
  ): void => {
    const documentEvidence = initialMode === "document"
      ? Object.freeze({
        mode: initialMode,
        revision,
        root: compatibilityLibrary.root,
        continuity: continuity ?? "new-epoch",
      })
      : undefined;
    enqueuePublication(() => {
      const watchFailure = initialMode === "document"
        ? documentWatchHub.emitSnapshot()
        : projectedWatchHub.emitSnapshot();
      publish_livemap_after_watch(
        watchFailure,
        () => {
          if (documentEvidence !== undefined) {
            commitObserverHub.prepareObservation((observation) => {
              register_livemap_document_observation_evidence(observation, documentEvidence);
            });
          }
          commitObserverHub.emitSnapshot(revision);
        },
      );
    });
  };

  function prepareDetachedCommit(
    commit: LiveMapCommit<LiveMapAnyOp>,
    detachedRoot: HsonNode,
    preparedInput?: ReturnType<typeof prepare_livemap_root>,
  ): PreparedLiveMapTransition {
    const preparedNext = preparedInput ?? prepare_livemap_root(detachedRoot);
    if (preparedNext.mode !== initialMode) {
      throw new Error(`Prepared LiveMap transition mode mismatch: expected ${initialMode}, observed ${preparedNext.mode}.`);
    }
    let aggregateTransition: import("./livemap.authority.js").PreparedLiveMapAuthorityTransition;
    if (initialMode === "document") {
      const documentOverlay = require_document_overlay(preparedNext.documentOverlay);
      const operations: LiveMapGraphOp[] = [];
      for (const operation of commit.ops) {
        if (!is_document_graph_operation(operation)) {
          throw new Error("Document compatibility staging produced a non-graph operation.");
        }
        operations.push(operation);
      }
      aggregateTransition = prepare_authority_transition([], [{
        library: compatibilityLibrary.identity,
        root: preparedNext.root,
        overlay: documentOverlay,
        operations,
        identityEffects: livemap_document_identity_effects_for(commit) ?? [],
        ...(livemap_document_commit_continuity(commit) === undefined
          ? {}
          : { continuity: livemap_document_commit_continuity(commit) }),
      }]);
    } else {
      const writes: LiveMapAggregateWrite[] = is_projected_identity_commit(commit)
        ? [Object.freeze({
          target: aggregate_target(compatibilityLibrary.identity, commit.ops[0]!.target.path),
          kind: "ensure-quid" as const,
          quid: commit.ops[0]!.quid,
        })]
        : must_livemap_replay(commit).ops.map((operation) => Object.freeze({
          target: aggregate_target(compatibilityLibrary.identity, operation.path),
          kind: "replay-data" as const,
          operation,
        }));
      aggregateTransition = prepare_authority_transition(writes);
      compatibilityCommitByAggregate.set(aggregateTransition.commit, commit);
    }
    aggregateOriginByCommit.set(aggregateTransition.commit, "authoritative");
    return transitionController.projectAggregateCompatibility(
      aggregateTransition,
      commit,
      initialMode,
    );
  }

  function useDocumentSchema(schema: HsonSchema): void {
    if (compatibilityLibrary.hsonSchema === schema) return;
    if (compatibilityLibrary.hsonSchema !== undefined) {
      throw new Error("LiveMap document schema contract is already attached and cannot be replaced.");
    }
    transitionController.assertPublicMutationAllowed();
    if (initialMode !== "document") {
      throw new TypeError("Document schema attachment is unavailable in data mode.");
    }
    must_hson_schema_root(schema, compatibilityLibrary.root);
    compatibilityLibrary.hsonSchema = schema;
    transitionController.invalidate();
  }
  let storeApi: LiveMapStoreApi<JsonValue | undefined> | undefined;

  const prepareCompatibilityDataAggregate = (
    writeOps: readonly LiveMapCoreWriteOp[],
    origin: "authoritative" | "replay",
  ): import("./livemap.authority.js").PreparedLiveMapAuthorityTransition => {
    const planned = plan_write_ops_with_identity(
      getProjectedValue(),
      writeOps,
      require_projected_overlay(compatibilityLibrary.projectedOverlay),
    );
    const transition = prepare_authority_transition(planned.transportOps.map((operation) => Object.freeze({
      target: aggregate_target(compatibilityLibrary.identity, operation.path),
      kind: "replay-data" as const,
      operation,
    })));
    aggregateOriginByCommit.set(transition.commit, origin);
    compatibility_data_commit_for(transition.commit);
    return transition;
  };

  const compatibility_data_commit_for = (
    aggregateCommit: LiveMapAggregateCommit,
  ): LiveMapCommit<LiveMapAnyOp> => {
    const existing = compatibilityCommitByAggregate.get(aggregateCommit);
    if (existing !== undefined) return existing;
    const operations = aggregateCommit.operations
      .filter((entry) => entry.target.domain === "application"
        && entry.target.library === compatibilityLibrary.identity)
      .map((entry) => entry.operation as LiveMapAnyOp);
    const projected = aggregateCommit.operations
      .filter((entry) => entry.target.domain === "application"
        && entry.target.library === compatibilityLibrary.identity
        && entry.projected !== undefined)
      .map((entry) => entry.projected!);
    const commit: LiveMapCommit<LiveMapAnyOp> = Object.freeze({
      changed: operations.length > 0,
      prevRev: aggregateCommit.prevRev,
      rev: aggregateCommit.rev,
      ops: Object.freeze(operations),
      ...encode_livemap_replay_transport(projected),
    });
    compatibilityCommitByAggregate.set(aggregateCommit, commit);
    return commit;
  };

  const prepareCompatibilityDataTransition = (
    writeOps: readonly LiveMapCoreWriteOp[],
    origin: "authoritative" | "replay" = "authoritative",
  ): PreparedLiveMapTransition => {
    const aggregateTransition = prepareCompatibilityDataAggregate(writeOps, origin);
    return transitionController.projectAggregateCompatibility(
      aggregateTransition,
      compatibility_data_commit_for(aggregateTransition.commit),
      initialMode,
    );
  };

  const commitOps = (
    writeOps: readonly LiveMapCoreWriteOp[],
    origin: "authoritative" | "replay" = "authoritative",
  ): LiveMapCommit => {
    transitionController.assertPublicMutationAllowed();
    if (writeOps.some((operation) => operation.kind === "replace" && operation.path.length === 0)) {
      assert_legacy_identity_epoch_reset_available();
    }
    const transition = prepareCompatibilityDataAggregate(writeOps, origin);
    const commit = compatibility_data_commit_for(transition.commit) as LiveMapCommit;
    transitionController.acceptAuthority(transition);
    return commit;
  };

  const getStoreApi = (): LiveMapStoreApi<JsonValue | undefined> => {
    return storeApi ??= make_livemap_store_api(core);
  };
  const subBase: LiveMapStoreApi<JsonValue | undefined>["subscribe"] = (listener) => {
    return getStoreApi().subscribe(listener);
  };

  const subDiff: LiveMapStoreApi<JsonValue | undefined>["subscribeDiff"] = (listener) => {
    return getStoreApi().subscribeDiff(listener);
  };

  const subSel: LiveMapStoreApi<JsonValue | undefined>["subscribeSel"] = <TSelected>(
    selector: (state: JsonValue | undefined) => TSelected,
    listener: LiveMapStoreSelectedListener<TSelected, JsonValue | undefined>,
    options?: LiveMapStoreSubscribeOptions<TSelected>,
  ) => {
    return getStoreApi().subscribeSel(selector, listener, options);
  };

  const subPath: LiveMapStoreApi<JsonValue | undefined>["subscribePath"] = <const TPath extends LivePath>(
    path: TPath,
    listener: LiveMapStorePathListener<JsonValue | undefined, TPath>,
    options?: LiveMapStoreSubscribeOptions<LiveMapPathValue<JsonValue | undefined, TPath>>,
  ) => {
    return getStoreApi().subscribePath(path, listener, options);
  };

  const subApi: LiveMapSubApi<JsonValue | undefined> = Object.assign(subBase, {
    diff: subDiff,
    sel: subSel,
    path: subPath,
  });

  const schemaApi: LiveMapCoreSchemaApi<JsonValue | undefined> = Object.freeze({
    get: () => compatibilityLibrary.hsonSchema,

    use: ((schema: HsonSchema) => {
      if (compatibilityLibrary.hsonSchema === schema) return core;
      if (compatibilityLibrary.hsonSchema !== undefined) {
        throw new Error("LiveMap data schema contract is already attached and cannot be replaced.");
      }
      transitionController.assertPublicMutationAllowed();
      must_hson_schema_root(schema, compatibilityLibrary.root);
      compatibilityLibrary.hsonSchema = schema;
      transitionController.invalidate();
      return core;
    }) as LiveMapCoreSchemaApi<JsonValue | undefined>["use"],
  });

  const applyProjectedIdentityTransition = (
    _nextRoot: HsonNode,
    _nextOverlay: LiveMapProjectedIdentityOverlay,
    operation: LiveMapProjectedGraphEnsureQuidOp,
    origin: "authoritative" | "replay" = "authoritative",
  ): LiveMapGraphCommit<LiveMapProjectedGraphEnsureQuidOp> => {
    transitionController.assertPublicMutationAllowed();
    if (initialMode === "document") {
      throw new Error("Data identity acquisition is unavailable in document mode.");
    }
    const transition = prepare_authority_transition([Object.freeze({
      target: aggregate_target(compatibilityLibrary.identity, operation.target.path),
      kind: "ensure-quid" as const,
      quid: operation.quid,
    })]);
    aggregateOriginByCommit.set(transition.commit, origin);
    const aggregateOperation = transition.commit.operations[0]?.operation;
    if (aggregateOperation === undefined || !("op" in aggregateOperation)
      || aggregateOperation.op !== "ensure-quid") {
      transitionController.discardAuthority(transition);
      throw new Error("Projected identity planning did not produce its canonical graph operation.");
    }
    const commit: LiveMapGraphCommit<LiveMapProjectedGraphEnsureQuidOp> = Object.freeze({
      changed: true,
      prevRev: transition.commit.prevRev,
      rev: transition.commit.rev,
      ops: Object.freeze([aggregateOperation as LiveMapProjectedGraphEnsureQuidOp]),
    });
    compatibilityCommitByAggregate.set(transition.commit, commit);
    transitionController.acceptAuthority(transition);
    return commit;
  };

  let core: LiveMapCore<JsonValue | undefined>;
  const projectedIdentityApi = make_livemap_projected_identity_api(
    () => core,
    Object.freeze({
      root: () => compatibilityLibrary.root,
      overlay: () => require_projected_overlay(compatibilityLibrary.projectedOverlay),
      identityEpoch: mapIdentityEpoch,
      acquireLocalIdentity: (path: LivePath, quid: string) =>
        acquire_local_projected_identity(compatibilityLibrary.identity, path, quid),
    }),
  );

  function replay(input: LiveMapReplay): LiveMapCommit;
  function replay(
    input: LiveMapGraphCommit<LiveMapProjectedGraphEnsureQuidOp>,
  ): LiveMapGraphCommit<LiveMapProjectedGraphEnsureQuidOp>;
  function replay(
    input: LiveMapReplay | LiveMapGraphCommit<LiveMapProjectedGraphEnsureQuidOp>,
  ): LiveMapCommit | LiveMapGraphCommit<LiveMapProjectedGraphEnsureQuidOp> {
    transitionController.assertPublicMutationAllowed();
    if (is_projected_identity_commit(input)) {
      must_expected_rev(input.prevRev, mapRevision);
      const operation = input.ops[0];
      if (operation === undefined
        || !("projected" in operation.target)
        || operation.target.projected !== true
        || !is_persisted_quid(operation.quid)) {
        throw new LiveMapProjectedIdentityError(
          "PROJECTED_IDENTITY_INVARIANT",
          [],
          "data identity registration is malformed",
        );
      }
      const path = clone_live_path(operation.target.path);
      const nextRoot = clone_live_root(compatibilityLibrary.root);
      const endpoint = resolve_value_node(nextRoot, path);
      if (endpoint === undefined || !is_livemap_projected_identity_target(endpoint)) {
        throw new LiveMapProjectedIdentityError(
          "PROJECTED_IDENTITY_INELIGIBLE",
          path,
          "replay target is ineligible",
        );
      }
      if (require_projected_overlay(compatibilityLibrary.projectedOverlay).quidAtPath(path) !== undefined) {
        throw new LiveMapProjectedIdentityError(
          "PROJECTED_IDENTITY_COLLISION",
          path,
          "replay target already carries a QUID",
        );
      }
      if (require_projected_overlay(compatibilityLibrary.projectedOverlay).pathForQuid(operation.quid) !== undefined) {
        throw new LiveMapProjectedIdentityError(
          "PROJECTED_IDENTITY_COLLISION",
          path,
          "replay QUID belongs to another active projected container",
        );
      }
      if (mapIdentityEpoch.issued().has(operation.quid)) {
        throw new LiveMapProjectedIdentityError(
          "PROJECTED_IDENTITY_REUSE",
          path,
          "replay cannot reuse a retired QUID in the same owner epoch",
        );
      }
      const nextOverlay = register_livemap_projected_identity_at_path(
        require_projected_overlay(compatibilityLibrary.projectedOverlay),
        operation.quid,
        path,
      );
      return applyProjectedIdentityTransition(nextRoot, nextOverlay, Object.freeze({
        ...operation,
        target: Object.freeze({ kind: "path", path, projected: true }),
      }), "replay");
    }
    const normalized = must_livemap_replay(input);
    must_expected_rev(normalized.prevRev, mapRevision);
    return commitOps(replay_write_ops(compatibilityLibrary.root, normalized.ops), "replay");
  }

  core = {
    /** Root capability selected during detached canonical construction. */
    mode: initialMode,
    /** Return a detached structural clone of the root compatibilityLibrary by this map core. */
    root: () => clone_live_root(compatibilityLibrary.root),

    /** Read the current projected JSON value at a path, or the whole graph. */
    snap: ((path: LivePath = []) => snap_live_path(compatibilityLibrary.root, must_live_path(path))) as LiveMapCoreSnap<JsonValue | undefined>,

    /** Read exact canonical data without crossing an ordinary object. */
    data: (path: LivePath = []) => {
      const value = project_live_path(compatibilityLibrary.root, must_live_path(path));
      return value === undefined ? undefined : hson_data_text_from_value(value);
    },

    /** Read and manage the schema currently attached to this Core, if present. */
    schema: schemaApi,

    /** Create an ergonomic handle scoped to one data path. */
    at: ((path: LivePath) => get_path_handle(path)) as unknown as LiveMapCore<JsonValue | undefined>["at"],

    /** Create an ergonomic Proxy path-builder scoped to one data path. */
    proxy: <const TPath extends LivePath = []>(path?: TPath) =>
      make_livemap_proxy<JsonValue | undefined, TPath>(
        core,
        path ?? ([] as unknown as TPath),
      ),

    /** Set a resolved data path; plain objects expand into shallow child sets. */
    set: (path, value) => {
      const livePath = must_live_path(path);
      return commitOps(
        write_ops_from_set(
          livePath,
          value,
          project_live_path(compatibilityLibrary.root, livePath),
        ),
      );
    },

    /** Set multiple object properties while preserving unspecified siblings. */
    setMany: (path, values) => {
      const livePath = must_live_path(path);
      const projectedValues = must_ordered_projected_object(values, livePath);
      return commitOps(
        write_ops_from_set_many(
          livePath,
          projectedValues,
          project_live_path(compatibilityLibrary.root, livePath),
        ),
      );
    },

    /** Apply one semantic array splice and preserve it in the resulting commit. */
    splice: (path, start, deleteCount, ...items) => {
      const livePath = must_live_path(path);
      const currentValue = project_live_path(compatibilityLibrary.root, livePath);
      const op = splice_write_op(livePath, currentValue, start, deleteCount, items);
      return commitOps([op]);
    },

    /**
     * Exact root or endpoint replacement.
     *
     * `set([])` remains invalid, so root replacement is explicit. The editor
     * overwrites the existing root node in place for root replace so existing
     * handles stay attached to this map.
     */
    replace: function (pathOrValue: unknown, value?: unknown) {
      const op = replace_write_op_from_args(arguments.length, pathOrValue, value);
      must_resolved_path("replace", op.path, project_live_path(compatibilityLibrary.root, op.path));
      return commitOps([op]);
    },

    /** Delete a data object-property path, emit the resulting commit, and return it. */
    delete: (path) => {
      const livePath = must_live_path(path);
      must_resolved_path("delete", livePath, project_live_path(compatibilityLibrary.root, livePath));
      return commitOps([
        { kind: "delete", path: livePath },
      ]);
    },

    /** Explicit synchronous transaction grouping, not automatic notification coalescing. */
    batch: (fn) => {
      transitionController.assertPublicMutationAllowed();
      const writeOps: LiveMapCoreWriteOp[] = [];
      let isOpen = true;
      const tx = make_batch_tx(compatibilityLibrary.root, writeOps, () => isOpen);

      try {
        fn(tx);
      } finally {
        isOpen = false;
      }
      return commitOps(writeOps);
    },

    /** Subscribe to commits whose op paths overlap the requested path. */
    feed: (path, listener) => feed_core_path(feedHub, must_live_path(path), must_feed_listener(listener)),

    commits: Object.freeze({ observe: commitObserverHub.observe }),

    /** Subscribe to data value changes. */
    sub: subApi,

    get rev() {
      return mapRevision;
    },
    /** Capture the current data root together with its committed revision. */
    capture: (options?: LiveMapCaptureOptions) => {
      const projected = must_projected_root_value(compatibilityLibrary.root);
      return capture_livemap_projected(
        mapIdentityEpoch,
        mapRevision,
        compatibilityLibrary.root,
        projected,
        require_projected_overlay(compatibilityLibrary.projectedOverlay),
        options,
      );
    },
    /** Restore data state and revision without a commit, feed, or increment. */
    restore: (capture, options): void => {
      transitionController.assertPublicMutationAllowed();
      if (projected_capture_continuity(mapIdentityEpoch, capture as object, options) === "new-epoch") {
        assert_legacy_identity_epoch_reset_available();
      }
      const normalized = must_projected_capture(capture);
      const operation: LiveMapProjectedReplaceWriteOp = {
        kind: "replace",
        path: [],
        value: normalized.value,
      };
      const planned = plan_write_ops(must_projected_root_value(compatibilityLibrary.root), [operation]);
      let candidate = clone_live_root(normalized.root);
      if (options?.identity === "strip") candidate = clone_hson_graph_without_quids(candidate);
      if (options?.identity === "reject") {
        const preparedForReject = prepare_livemap_root(candidate);
        if ((preparedForReject.projectedOverlay?.size ?? 0) !== 0) {
          throw new Error("Projected restore rejected QUID-bearing canonical metadata.");
        }
      }
      const candidateProjected = must_projected_root_value(candidate);
      if (!ordered_projected_value_equal(candidateProjected, planned.value)) {
        throw new LiveMapProjectedTransportError("restore", "canonical root and data payload disagree");
      }
      const observedMode = classify_live_root_mode(candidate);
      if (observedMode !== initialMode) {
        throw new Error(`LiveMap projected restore mode mismatch: expected ${initialMode}, observed ${observedMode}.`);
      }
      const preparedCandidate = prepare_livemap_root(candidate);
      if (compatibilityLibrary.hsonSchema !== undefined) must_hson_schema_root(compatibilityLibrary.hsonSchema, preparedCandidate.root);
      const continuity = projected_capture_continuity(mapIdentityEpoch, capture as object, options);
      const capturedOverlay = projected_capture_identity_overlay(capture as object);
      if (options?.identity === "reject" && (capturedOverlay?.size ?? 0) !== 0) {
        throw new Error("Projected restore rejected out-of-band identity claims.");
      }
      const restoredOverlay = options?.identity === "strip"
        ? preparedCandidate.projectedOverlay
        : capturedOverlay ?? preparedCandidate.projectedOverlay;
      if (restoredOverlay === undefined) {
        throw new Error("Same-epoch projected capture lost its identity overlay capability.");
      }
      apply_livemap_projected_identity_overlay(preparedCandidate.root, restoredOverlay);
      const restoredQuids = livemap_projected_identity_quids(
        restoredOverlay,
      );
      if (continuity === "new-epoch") {
        mapIdentityEpoch.replace(restoredQuids);
      } else {
        mapIdentityEpoch.install(retain_livemap_identity_epoch(
          mapIdentityEpoch.issued(),
          restoredQuids,
        ));
      }
      Object.assign(compatibilityLibrary, {
        root: preparedCandidate.root,
        documentOverlay: undefined,
        projectedOverlay: restoredOverlay,
      });
      mapRevision = normalized.rev;
      compatibilityLibrary.projectedValue = planned.value;
      transitionController.invalidate();
      publishSnapshotWithWatch(normalized.rev);
    },
    /** Replace the root only when the caller's base revision is still current. */
    apply: (input: LiveMapApply) => {
      const normalized = must_projected_apply(input);
      must_expected_rev(
        normalized.prevRev,
        mapRevision,
      );

      return commitOps([
        {
          kind: "replace",
          path: [],
          value: normalized.value,
        },
      ]);
    },
    /** Replay semantic ops only when their base revision and prior values match. */
    replay,


  };
  register_livemap_identity_epoch_owner(core, mapIdentityEpoch);

  // A serialized path is unique only within a Library. Scoping this cache by
  // opaque library authority keeps a future second graph from colliding at [0]
  // without changing any public path syntax today.
  const pathHandleCaches = new WeakMap<object, Map<string, LiveMapPathHandle>>();

  const projected: LiveMapProjectedPropagation = Object.freeze({
    read: (path) => project_live_path(compatibilityLibrary.root, path),
    feed: (path, listener) => feedHub.addProjected(path, listener),
    commit: (ops: readonly LiveMapProjectedPropagationWrite[]) => commitOps(ops),
  });


  function get_path_handle(path: LivePath): LiveMapPathHandle {
    const handlePath = must_live_path(path);
    const target = livemap_library_target(compatibilityLibrary, handlePath);
    const pathHandleCache = pathHandleCaches.get(target.library)
      ?? (() => {
        const cache = new Map<string, LiveMapPathHandle>();
        pathHandleCaches.set(target.library, cache);
        return cache;
      })();
    const key = live_path_key(target.path);
    const existing = pathHandleCache.get(key);
    if (existing) return existing;

    const handle = make_livemap_path_handle(
      core,
      handlePath,
      (listener) => projectedWatchHub.add(handlePath, listener),
    );
    pathHandleCache.set(key, handle);
    return handle;
  }

  type AggregateDataCandidate = {
    readonly library: LiveMapLibraryState;
    readonly baseRoot: HsonNode;
    readonly detachedRoot: HsonNode;
    value: OrderedProjectedValue;
    overlay: LiveMapProjectedIdentityOverlay;
    writes: LiveMapCoreWriteOp[];
    nextRoot: HsonNode;
  };
  type AggregateDocumentCandidate = {
    readonly library: LiveMapLibraryState;
    readonly baseRoot: HsonNode;
    root: HsonNode;
    overlay: import("./livemap.document.identity.js").LiveMapDocumentIdentityOverlay;
    operations: LiveMapGraphOp[];
    identityEffects: LiveMapDocumentIdentityEffect[];
    sourceCandidate?: PreparedDocumentMutation;
    continuity?: "same-epoch" | "new-epoch";
  };
  type AggregateSystemCandidate = {
    readonly system: LiveMapSystemState;
    readonly baseRoot: HsonNode;
    readonly detachedRoot: HsonNode;
    value: OrderedProjectedValue;
    writes: LiveMapCoreWriteOp[];
    nextRoot: HsonNode;
  };
  type AggregateCandidate = AggregateDataCandidate | AggregateDocumentCandidate;
  type AggregateWatch = Readonly<{
    library: LiveMapLibraryIdentity;
    path: LivePath;
    listener: (next: JsonValue | undefined) => void;
  }>;
  type AggregateFeed = Readonly<{
    library: LiveMapLibraryIdentity;
    path: LivePath;
    listener: (event: Readonly<{
      commit: LiveMapAggregateCommit;
      path: LivePath;
      operations: readonly LiveMapAggregateOperation[];
      value: JsonValue | undefined;
    }>) => void;
  }>;

  const aggregateObservers: Array<(commit: LiveMapAggregateCommit) => void> = [];
  const aggregatePositionObservers: Array<(revision: number) => void> = [];
  const publishAuthorityPosition = (): void => {
    for (const observer of [...aggregatePositionObservers]) observer(mapRevision);
  };
  const aggregateRestoreObservers: Array<(event: Readonly<{
    previousRevision: number;
    revision: number;
    libraries: readonly LiveMapLibraryIdentity[];
    changedLibraries: readonly LiveMapLibraryIdentity[];
    continuity: "same-epoch" | "new-epoch";
  }>) => void> = [];
  const aggregateWatches: AggregateWatch[] = [];
  const aggregateFeeds: AggregateFeed[] = [];
  const internalPathAuthorities = new WeakMap<object, Map<string, ReturnType<typeof make_internal_path_authority>>>();
  let aggregateCandidateRootsCloned = 0;
  let aggregatePublications = 0;
  let aggregateAcceptedTransitions = 0;
  let aggregateSchemaValidations = 0;
  // Aggregate commits retain the exact selected-document commit that supplied
  // their graph operation.  Reflection consumes that evidence without ever
  // inventing a document-local revision stream.
  const documentCommitByAggregate = new WeakMap<
    LiveMapAggregateCommit,
    Map<LiveMapLibraryIdentity, LiveMapGraphCommit<LiveMapGraphOp>>
  >();
  const aggregateByDocumentCommit = new WeakMap<LiveMapGraphCommit, LiveMapAggregateCommit>();
  const aggregateOriginByCommit = new WeakMap<LiveMapAggregateCommit, "authoritative" | "replay">();
  const compatibilityCommitByAggregate = new WeakMap<LiveMapAggregateCommit, LiveMapCommit<LiveMapAnyOp>>();
  let hostedRegistry: HostedRegistry | undefined;
  let hostedFence: HostedAuthorityFence | undefined;
  let hostedBindingsByIdentity: ReadonlyMap<object, HostedRegistryBinding> | undefined;
  let hostedBindingsByName: ReadonlyMap<string, HostedRegistryBinding> | undefined;
  const systemIdentity = make_livemap_system_identity();
  let systemState: LiveMapSystemState | undefined;

  function prepare_system_state(input: InitialSystemState): LiveMapSystemState {
    const preparedSystem = prepare_livemap_root(input.root);
    if (preparedSystem.mode === "document") {
      throw new Error("Transactional Hson system state must be data-mode.");
    }
    if ((preparedSystem.projectedOverlay?.size ?? 0) !== 0) {
      throw new Error("Transactional Hson system state cannot own QUID identity.");
    }
    must_hson_schema_root(input.hsonSchema, preparedSystem.root);
    return {
      identity: systemIdentity,
      key: input.key,
      transportName: input.transportName,
      root: preparedSystem.root,
      projectedValue: must_projected_root_value(preparedSystem.root),
      hsonSchema: input.hsonSchema,
    };
  }

  if ((initial.systems?.length ?? 0) > 1) {
    throw new Error("LiveMap currently supports one transactional Hson system-state domain.");
  }
  const initialSystem = initial.systems?.[0];
  if (initialSystem !== undefined) systemState = prepare_system_state(initialSystem);

  function require_hosted_state(): Readonly<{
    registry: HostedRegistry;
    fence: HostedAuthorityFence;
    byIdentity: ReadonlyMap<object, HostedRegistryBinding>;
    byName: ReadonlyMap<string, HostedRegistryBinding>;
  }> {
    if (hostedRegistry === undefined || hostedFence === undefined
      || hostedBindingsByIdentity === undefined || hostedBindingsByName === undefined) {
      throw new Error("LiveMap hosted aggregate registry is unavailable.");
    }
    return Object.freeze({
      registry: hostedRegistry,
      fence: hostedFence,
      byIdentity: hostedBindingsByIdentity,
      byName: hostedBindingsByName,
    });
  }

  function hosted_commit_fields(
    changed: boolean,
    prevRev: number,
    rev: number,
    operations: readonly LiveMapAggregateOperation[],
  ): Readonly<{ hosted?: HostedAggregateCommit }> {
    if (hostedRegistry === undefined || hostedFence === undefined || hostedBindingsByIdentity === undefined) return {};
    return {
      hosted: make_hosted_commit(hostedFence, hostedRegistry, hostedBindingsByIdentity, {
        changed,
        prevRev,
        rev,
        operations,
      }),
    };
  }

  function require_library(identity: LiveMapLibraryIdentity): LiveMapLibraryState {
    return libraryRegistry.require(identity);
  }

  function require_projected_library(library: LiveMapLibraryState): LiveMapProjectedIdentityOverlay {
    if (library.mode === "document") {
      throw new Error("Aggregate projected operations require a data library.");
    }
    if (library.projectedValue === undefined || library.projectedOverlay === undefined) {
      throw new Error("Data library has no projected state.");
    }
    return library.projectedOverlay;
  }

  function aggregate_target(
    library: LiveMapLibraryIdentity,
    path: LivePath,
  ): LiveMapStructuralTarget {
    return livemap_library_target(require_library(library), clone_live_path(must_live_path(path)));
  }

  function require_system(identity: LiveMapSystemIdentity): LiveMapSystemState {
    if (systemState !== undefined && systemState.identity === identity) return systemState;
    throw new Error("Transactional Hson system target belongs to another map authority.");
  }

  function aggregate_system_target(
    system: LiveMapSystemIdentity,
    path: LivePath,
  ): import("./livemap.library.js").LiveMapSystemTarget {
    return livemap_system_target(require_system(system).identity, clone_live_path(must_live_path(path)));
  }

  function aggregate_snap(
    libraryIdentity: LiveMapLibraryIdentity,
    path: LivePath = [],
  ): JsonValue | undefined {
    const library = require_library(libraryIdentity);
    require_projected_library(library);
    const value = project_live_path(library.root, must_live_path(path));
    return value === undefined ? undefined : materialize_projected_value(value);
  }

  function aggregate_quid_locations(
    states: Iterable<LiveMapLibraryState>,
  ): ReadonlyMap<string, LiveMapStructuralTarget> {
    const locations = new Map<string, LiveMapStructuralTarget>();
    for (const library of states) {
      const overlay = library.documentOverlay ?? library.projectedOverlay;
      if (overlay === undefined) throw new Error("LiveMap library has no identity overlay.");
      const quids = library.documentOverlay === undefined
        ? livemap_projected_identity_quids(require_projected_overlay(library.projectedOverlay))
        : livemap_document_identity_quids(library.documentOverlay);
      for (const quid of quids) {
        const path = overlay.pathForQuid(quid);
        if (path === undefined) throw new Error("LiveMap identity overlay cannot resolve an active QUID.");
        const target = livemap_library_target(library, clone_live_path([...path]));
        const prior = locations.get(quid);
        if (prior !== undefined) {
          throw new Error(`LiveMap-wide active QUID collision for ${JSON.stringify(quid)}.`);
        }
        locations.set(quid, target);
      }
    }
    return locations;
  }

  /** One map-wide, non-revisioned identity installation shared by every Library. */
  function transact_local_identity(
    library: LiveMapLibraryState,
    quid: string,
    installOverlay: () => void,
    restoreOverlay: () => void,
    participant?: LiveMapRuntimeIdentityParticipant,
  ): void {
    if (localIdentityTransactionActive) throw new Error("A LiveMap local identity transaction is already active.");
    const before = aggregate_quid_locations(libraryRegistry.all());
    if (before.has(quid) || mapIdentityEpoch.issued().has(quid)) {
      throw new Error("LiveMap-wide local QUID candidate was already issued.");
    }
    const nextLedger = stage_livemap_identity_epoch(
      mapIdentityEpoch.issued(),
      before.keys(),
      [...before.keys(), quid],
    );
    const revision = mapRevision;
    const generation = identityGeneration;
    const currentRoot = library.root;
    const currentOverlay = library.documentOverlay ?? library.projectedOverlay;
    localIdentityTransactionActive = true;
    let reservation: ReturnType<LiveMapRuntimeIdentityParticipant["preflight"]> | undefined;
    let overlayInstalled = false;
    let claimApplied = false;
    try {
      reservation = participant?.preflight();
      if (mapRevision !== revision || identityGeneration !== generation
        || library.root !== currentRoot
        || (library.documentOverlay ?? library.projectedOverlay) !== currentOverlay) {
        throw new Error("LiveMap local identity preflight became stale.");
      }
      reservation?.apply();
      claimApplied = reservation !== undefined;
      installOverlay();
      overlayInstalled = true;
      participant?.realize();
      // All fallible local claims and projections are complete before the
      // monotonic issued ledger and generation become visible.
      mapIdentityEpoch.install(nextLedger);
      identityGeneration += 1;
    } catch (cause) {
      if (overlayInstalled) restoreOverlay();
      reservation?.rollback();
      if (claimApplied) participant?.rollbackRealization();
      throw cause;
    } finally {
      reservation?.release();
      localIdentityTransactionActive = false;
    }
  }

  function acquire_local_document_identity(
    libraryIdentity: LiveMapLibraryIdentity,
    path: LiveMapDocumentPath,
    quid: string,
    participant?: LiveMapRuntimeIdentityParticipant,
  ): void {
    const library = require_library(libraryIdentity);
    if (library.mode !== "document") throw new Error("Local document identity requires a document Library.");
    const endpoint = resolve_document_path(library.root, "document", path);
    if (!is_ordinary_element_node(endpoint)) throw new Error("Local document identity target is ineligible.");
    const previous = require_document_overlay(library.documentOverlay);
    if (previous.quidAtPath(path) !== undefined) throw new Error("Local document identity target is already claimed.");
    const next = register_livemap_document_identity_at_path(previous, quid, path).overlay;
    transact_local_identity(
      library,
      quid,
      () => { library.documentOverlay = next; },
      () => { library.documentOverlay = previous; },
      participant,
    );
  }

  function acquire_local_projected_identity(
    libraryIdentity: LiveMapLibraryIdentity,
    path: LivePath,
    quid: string,
  ): void {
    const library = require_library(libraryIdentity);
    if (library.mode === "document") throw new Error("Local data identity requires a data Library.");
    const endpoint = resolve_value_node(library.root, path);
    if (endpoint === undefined || !is_livemap_projected_identity_target(endpoint)) {
      throw new Error("Local data identity target is ineligible.");
    }
    const previous = require_projected_overlay(library.projectedOverlay);
    if (previous.quidAtPath(path) !== undefined) throw new Error("Local data identity target is already claimed.");
    const next = register_livemap_projected_identity_at_path(previous, quid, path);
    transact_local_identity(
      library,
      quid,
      () => { library.projectedOverlay = next; },
      () => { library.projectedOverlay = previous; },
    );
  }

  function make_aggregate_data_candidate(library: LiveMapLibraryState): AggregateDataCandidate {
    const overlay = require_projected_library(library);
    const value = library.projectedValue;
    if (value === undefined) throw new Error("Data library has no projected value.");
    aggregateCandidateRootsCloned += 1;
    const detachedRoot = clone_live_root(library.root);
    return {
      library,
      baseRoot: detachedRoot,
      detachedRoot,
      value,
      overlay,
      writes: [],
      nextRoot: detachedRoot,
    };
  }

  function make_aggregate_document_candidate(library: LiveMapLibraryState): AggregateDocumentCandidate {
    if (library.mode !== "document" || library.documentOverlay === undefined) {
      throw new Error("Aggregate document candidate requires a document library.");
    }
    aggregateCandidateRootsCloned += 1;
    const root = clone_live_root(library.root);
    return {
      library,
      baseRoot: root,
      root,
      overlay: library.documentOverlay,
      operations: [],
      identityEffects: [],
    };
  }

  function is_aggregate_document_candidate(
    candidate: AggregateCandidate,
  ): candidate is AggregateDocumentCandidate {
    return "operations" in candidate;
  }

  function aggregate_write_ops(
    write: Extract<LiveMapAggregateWrite, { kind: "set" | "replace" | "delete" | "splice" | "rename" | "move" }>,
    value: OrderedProjectedValue,
  ): readonly LiveMapCoreWriteOp[] {
    const path = clone_live_path(must_live_path(write.target.path));
    if (write.kind === "set") {
      return write_ops_from_set(path, write.value, ordered_projected_value_at(value, path));
    }
    if (write.kind === "replace") {
      return [Object.freeze({
        kind: "replace" as const,
        path,
        value: must_ordered_projected_value(write.value, path),
      })];
    }
    if (write.kind === "splice") {
      return [Object.freeze({
        kind: "splice" as const,
        path,
        start: write.start,
        deleteCount: write.deleteCount,
        items: write.items,
      })];
    }
    if (write.kind === "rename") {
      return [Object.freeze({ kind: "rename" as const, path, from: write.from, to: write.to })];
    }
    if (write.kind === "move") {
      return [Object.freeze({ kind: "move" as const, path, from: write.from, to: write.to })];
    }
    return [Object.freeze({ kind: "delete" as const, path })];
  }

  function prepare_authority_transition(
    writes: readonly LiveMapAggregateWrite[],
    preparedDocuments: readonly Readonly<{
      library: LiveMapLibraryIdentity;
      root: HsonNode;
      overlay: import("./livemap.document.identity.js").LiveMapDocumentIdentityOverlay;
      operations: readonly LiveMapGraphOp[];
      identityEffects: readonly LiveMapDocumentIdentityEffect[];
      issuedLedger?: LiveMapIssuedQuidLedger;
      sourceCandidate?: PreparedDocumentMutation;
      continuity?: "same-epoch" | "new-epoch";
    }>[] = [],
  ): import("./livemap.authority.js").PreparedLiveMapAuthorityTransition {
    transitionController.assertPublicMutationAllowed();
    const prevRev = mapRevision;
    const preparedIdentityGeneration = identityGeneration;
    const candidates = new Map<LiveMapLibraryIdentity, AggregateCandidate>();
    let systemCandidate: AggregateSystemCandidate | undefined;
    const replayingSystem = writes.some((write) => write.kind === "replay-data");
    const initialActiveQuids = aggregate_quid_locations(libraryRegistry.all());
    let stagedIssuedLedger = mapIdentityEpoch.issued();
    const operations: LiveMapAggregateOperation[] = [];
    const merge_issued_ledgers = (
      left: LiveMapIssuedQuidLedger,
      right: LiveMapIssuedQuidLedger,
    ): LiveMapIssuedQuidLedger => make_livemap_issued_quid_ledger([
      ...enumerate_livemap_issued_quids(left),
      ...enumerate_livemap_issued_quids(right),
    ]);
    const candidate_for = (identity: LiveMapLibraryIdentity): AggregateCandidate => {
      const existing = candidates.get(identity);
      if (existing !== undefined) return existing;
      const library = require_library(identity);
      const candidate = library.mode === "document"
        ? make_aggregate_document_candidate(library)
        : make_aggregate_data_candidate(library);
      candidates.set(identity, candidate);
      return candidate;
    };
    const system_candidate = (): AggregateSystemCandidate | undefined => {
      if (systemState === undefined || systemState.key !== INTERACTION_RESERVED_LIBRARY_KEY) return undefined;
      systemCandidate ??= {
        system: systemState,
        baseRoot: clone_live_root(systemState.root),
        detachedRoot: clone_live_root(systemState.root),
        value: systemState.projectedValue,
        writes: [],
        nextRoot: clone_live_root(systemState.root),
      };
      return systemCandidate;
    };
    const stage_interaction_paths = (
      library: LiveMapLibraryState,
      beforeRoot: HsonNode,
      beforeOverlay: import("./livemap.document.identity.js").LiveMapDocumentIdentityOverlay,
      afterOverlay: import("./livemap.document.identity.js").LiveMapDocumentIdentityOverlay,
      operation: LiveMapGraphOp,
    ): void => {
      if (replayingSystem || systemState?.key !== INTERACTION_RESERVED_LIBRARY_KEY) return;
      const name = hostedBindingsByIdentity?.get(library.identity)?.name;
      if (name === undefined) throw new Error("Interaction document Library name is unavailable.");
      const current = systemCandidate?.value ?? systemState.projectedValue;
      const descriptors = ordered_projected_value_at(current, ["descriptors"]);
      if (descriptors === undefined) throw new Error("Canonical interaction descriptors are unavailable.");
      const rewritten = rewrite_interaction_subjects(
        descriptors, name, beforeRoot, beforeOverlay, afterOverlay, operation,
      );
      if (rewritten === undefined) return;
      const candidate = system_candidate();
      if (candidate === undefined) return;
      const localWrite: LiveMapCoreWriteOp = { kind: "replace", path: ["descriptors"], value: rewritten };
      const planned = plan_write_ops(candidate.value, [localWrite]);
      candidate.value = planned.value;
      candidate.writes.push(localWrite);
      for (let index = 0; index < planned.ops.length; index += 1) {
        const projected = planned.transportOps[index];
        const operation = planned.ops[index];
        if (projected === undefined || operation === undefined) throw new Error("Interaction path rewrite evidence is incomplete.");
        operations.push(Object.freeze({
          target: aggregate_system_target(candidate.system.identity, operation.path),
          operation,
          projected,
        }));
      }
    };
    const planned_quid_is_active = (quid: string): boolean => {
      for (const library of libraryRegistry.all()) {
        const candidate = candidates.get(library.identity);
        const overlay = candidate === undefined
          ? library.documentOverlay ?? library.projectedOverlay
          : candidate.overlay;
        if (overlay?.pathForQuid(quid) !== undefined) return true;
      }
      return false;
    };
    const stage_candidate_identity = (
      beforeQuids: Iterable<string>,
      afterQuids: Iterable<string>,
    ): void => {
      const before = new Set(beforeQuids);
      const after = new Set(afterQuids);
      const stagedAfter = new Set(after);
      for (const quid of after) {
        if (before.has(quid)) continue;
        if (planned_quid_is_active(quid)) {
          throw new Error(`LiveMap-wide active QUID collision for ${JSON.stringify(quid)}.`);
        }
        // A QUID moved from another application library is diagnosed after all
        // candidates are complete, where both qualified locations are known.
        if (initialActiveQuids.has(quid)) stagedAfter.delete(quid);
      }
      stagedIssuedLedger = stage_livemap_identity_epoch(
        stagedIssuedLedger,
        before,
        stagedAfter,
      );
    };

    for (const prepared of preparedDocuments) {
      const library = require_library(prepared.library);
      if (library.mode !== "document" || library.documentOverlay === undefined) {
        throw new Error("Prepared document effects require a document application Library.");
      }
      if (candidates.has(library.identity)) {
        throw new Error("One authority transition cannot install two prepared candidates for one document Library.");
      }
      aggregateCandidateRootsCloned += 1;
      const baseRoot = clone_live_root(library.root);
      const candidate: AggregateDocumentCandidate = {
        library,
        baseRoot,
        root: prepared.root,
        overlay: prepared.overlay,
        operations: [...prepared.operations],
        identityEffects: [...prepared.identityEffects],
        ...(prepared.sourceCandidate === undefined ? {} : { sourceCandidate: prepared.sourceCandidate }),
        ...(prepared.continuity === undefined ? {} : { continuity: prepared.continuity }),
      };
      if (canonical_graph_equal(library.root, prepared.root)
        && livemap_document_identity_overlay_equal(prepared.overlay, library.documentOverlay)
        && prepared.issuedLedger === undefined) {
        candidate.operations.length = 0;
        candidate.identityEffects.length = 0;
      }
      const replacesRoot = candidate.operations.some((operation) => operation.op === "replace-root");
      if (!replacesRoot) {
        stage_candidate_identity(
          livemap_document_identity_quids(library.documentOverlay),
          livemap_document_identity_quids(candidate.overlay),
        );
        if (prepared.issuedLedger !== undefined) {
          stagedIssuedLedger = merge_issued_ledgers(stagedIssuedLedger, prepared.issuedLedger);
        }
      }
      for (const operation of candidate.operations) {
        operations.push(Object.freeze({
          target: aggregate_target(library.identity, document_operation_path(operation)),
          operation,
        }));
        stage_interaction_paths(library, library.root, library.documentOverlay, candidate.overlay, operation);
      }
      candidates.set(library.identity, candidate);
    }

    for (const write of writes) {
      if (write.target.domain === "system") {
        const system = require_system(write.target.system);
        systemCandidate ??= {
          system,
          baseRoot: clone_live_root(system.root),
          detachedRoot: clone_live_root(system.root),
          value: system.projectedValue,
          writes: [],
          nextRoot: clone_live_root(system.root),
        };
        const candidate = systemCandidate;
        const target = aggregate_system_target(system.identity, write.target.path);
        if (write.kind === "graph" || write.kind === "ensure-quid") {
          throw new Error("Transactional Hson system state cannot own graph identity.");
        }
        if (write.kind === "replay-data") {
          const currentValue = ordered_projected_value_at(candidate.value, write.operation.path);
          must_replay_value(write.operation.path, write.operation.prev, currentValue);
          const localWrite = projected_write_op_from_transport(write.operation);
          const planned = plan_write_ops(candidate.value, [localWrite]);
          const nextValue = ordered_projected_value_at(planned.value, write.operation.path);
          must_replay_value(write.operation.path, write.operation.next, nextValue);
          candidate.value = planned.value;
          candidate.writes.push(localWrite);
          operations.push(Object.freeze({
            target,
            operation: materialize_livemap_projected_op(write.operation),
            projected: write.operation,
          }));
          continue;
        }
        const localWrites = aggregate_write_ops(write, candidate.value);
        const planned = plan_write_ops(candidate.value, localWrites);
        candidate.value = planned.value;
        candidate.writes.push(...localWrites);
        for (let index = 0; index < planned.ops.length; index += 1) {
          const operation = planned.ops[index];
          const projected = planned.transportOps[index];
          if (operation === undefined || projected === undefined) {
            throw new Error("System-state operation evidence is incomplete.");
          }
          operations.push(Object.freeze({
            target: aggregate_system_target(system.identity, operation.path),
            operation,
            projected,
          }));
        }
        continue;
      }
      const library = require_library(write.target.library);
      const target = aggregate_target(library.identity, write.target.path);
      const candidate = candidate_for(library.identity);
      if (write.kind === "graph") {
        if (!is_aggregate_document_candidate(candidate)) {
          throw new Error("Aggregate graph operations require a document library.");
        }
        const priorRoot = candidate.root;
        const priorOverlay = candidate.overlay;
        const planned = prepare_document_graph_operation(
          candidate.root,
          "document",
          write.operation,
          candidate.overlay,
        );
        if (!canonical_graph_equal(candidate.root, planned.root)
          || !livemap_document_identity_overlay_equal(planned.overlay, candidate.overlay)) {
          if (planned.operation.op !== "replace-root") {
            stage_candidate_identity(
              livemap_document_identity_quids(candidate.overlay),
              livemap_document_identity_quids(planned.overlay),
            );
          }
          candidate.root = planned.root;
          candidate.overlay = planned.overlay;
          candidate.operations.push(planned.operation);
          candidate.identityEffects.push(...planned.identityEffects);
          operations.push(Object.freeze({
            target: aggregate_target(library.identity, document_operation_path(planned.operation)),
            operation: planned.operation,
          }));
          stage_interaction_paths(library, priorRoot, priorOverlay, planned.overlay, planned.operation);
        }
        continue;
      }
      if (is_aggregate_document_candidate(candidate)) {
        throw new Error("Aggregate projected operations require a data library.");
      }
      if (write.kind === "ensure-quid") {
        if (!is_persisted_quid(write.quid)) {
          throw new Error("Aggregate QUID registration requires a persisted QUID.");
        }
        const candidateRoot = projected_candidate_graph(candidate.detachedRoot, candidate.value, candidate.writes);
        apply_livemap_projected_identity_overlay(candidateRoot, candidate.overlay);
        const endpoint = resolve_value_node(candidateRoot, target.path);
        if (endpoint === undefined || !is_livemap_projected_identity_target(endpoint)) {
          throw new Error("Aggregate QUID registration target is ineligible.");
        }
        const existing = candidate.overlay.quidAtPath(target.path);
        if (existing === write.quid) continue;
        if (existing !== undefined || candidate.overlay.pathForQuid(write.quid) !== undefined) {
          throw new Error("Aggregate QUID registration collides with an active library claim.");
        }
        const nextOverlay = register_livemap_projected_identity_at_path(candidate.overlay, write.quid, target.path);
        stage_candidate_identity(
          livemap_projected_identity_quids(candidate.overlay),
          livemap_projected_identity_quids(nextOverlay),
        );
        candidate.overlay = nextOverlay;
        operations.push(Object.freeze({
          target,
          operation: Object.freeze({
            domain: "graph" as const,
            op: "ensure-quid" as const,
            target: Object.freeze({ kind: "path" as const, path: target.path, projected: true as const }),
            quid: write.quid,
          }),
        }));
        continue;
      }
      if (write.kind === "replay-data") {
        const currentValue = ordered_projected_value_at(candidate.value, write.operation.path);
        must_replay_value(write.operation.path, write.operation.prev, currentValue);
        const localWrite = projected_write_op_from_transport(write.operation);
        const planned = plan_write_ops_with_identity(candidate.value, [localWrite], candidate.overlay);
        const nextValue = ordered_projected_value_at(planned.value, write.operation.path);
        must_replay_value(write.operation.path, write.operation.next, nextValue);
        if (planned.transportOps.length !== 1) {
          throw new Error("Hosted replay operation did not produce one exact authority operation.");
        }
        const nextOverlay = reconcile_livemap_projected_identity_overlay(candidate.overlay, planned.transportOps);
        if (!(localWrite.kind === "replace" && localWrite.path.length === 0)) {
          stage_candidate_identity(
            livemap_projected_identity_quids(candidate.overlay),
            livemap_projected_identity_quids(nextOverlay),
          );
        }
        candidate.value = planned.value;
        candidate.writes.push(localWrite);
        candidate.overlay = nextOverlay;
        operations.push(Object.freeze({
          target,
          operation: materialize_livemap_projected_op(write.operation),
          projected: write.operation,
        }));
        continue;
      }
      const localWrites = aggregate_write_ops(write, candidate.value);
      const planned = plan_write_ops_with_identity(candidate.value, localWrites, candidate.overlay);
      const nextOverlay = reconcile_livemap_projected_identity_overlay(candidate.overlay, planned.transportOps);
      if (!localWrites.some((operation) => operation.kind === "replace" && operation.path.length === 0)) {
        stage_candidate_identity(
          livemap_projected_identity_quids(candidate.overlay),
          livemap_projected_identity_quids(nextOverlay),
        );
      }
      candidate.value = planned.value;
      candidate.writes.push(...localWrites);
      candidate.overlay = nextOverlay;
      for (let index = 0; index < planned.ops.length; index += 1) {
        const operation = planned.ops[index];
        const projected = planned.transportOps[index];
        if (operation === undefined || projected === undefined) {
          throw new Error("Aggregate projected operation evidence is incomplete.");
        }
        operations.push(Object.freeze({
          target: aggregate_target(library.identity, operation.path),
          operation,
          projected,
        }));
      }
    }

    for (const candidate of candidates.values()) {
      aggregateSchemaValidations += 1;
      if (is_aggregate_document_candidate(candidate)) {
        if (candidate.library.hsonSchema !== undefined) {
          must_hson_schema_root(candidate.library.hsonSchema, candidate.root);
        }
      } else {
        must_hson_schema_projected_candidate(candidate.library.hsonSchema, candidate.value);
        const root = projected_candidate_graph(candidate.detachedRoot, candidate.value, candidate.writes);
        apply_livemap_projected_identity_overlay(root, candidate.overlay);
        candidate.nextRoot = root;
      }
    }
    if (systemCandidate !== undefined) {
      if (systemCandidate.system.key === INTERACTION_RESERVED_LIBRARY_KEY) {
        const descriptors = ordered_projected_value_at(systemCandidate.value, ["descriptors"]);
        validate_interaction_subjects(descriptors, (name) => hostedBindingsByName?.get(name)?.mode === "document");
      }
      aggregateSchemaValidations += 1;
      must_hson_schema_projected_candidate(systemCandidate.system.hsonSchema, systemCandidate.value);
      const root = projected_candidate_graph(
        systemCandidate.detachedRoot,
        systemCandidate.value,
        systemCandidate.writes,
      );
      const preparedSystem = prepare_livemap_root(root);
      if (preparedSystem.mode === "document" || (preparedSystem.projectedOverlay?.size ?? 0) !== 0) {
        throw new Error("Transactional Hson system state cannot own QUID identity.");
      }
      systemCandidate.nextRoot = preparedSystem.root;
    }

    const beforeActive = initialActiveQuids;
    const afterStates = libraryRegistry.all().map((library) => {
      const candidate = candidates.get(library.identity);
      if (candidate === undefined) return library;
      return {
        ...library,
        ...(is_aggregate_document_candidate(candidate)
          ? { root: candidate.root, documentOverlay: candidate.overlay, projectedOverlay: undefined, projectedValue: undefined }
          : { root: candidate.nextRoot, documentOverlay: undefined, projectedOverlay: candidate.overlay, projectedValue: candidate.value }),
      };
    });
    const afterActive = aggregate_quid_locations(afterStates);
    for (const [quid, beforeTarget] of beforeActive) {
      const afterTarget = afterActive.get(quid);
      if (afterTarget !== undefined && afterTarget.library !== beforeTarget.library) {
        throw new Error(
          "Cross-library QUID movement requires an explicit LiveMap transfer semantic.",
        );
      }
    }
    const resetsIdentityEpoch = operations.some((entry) => entry.target.domain === "application"
      && "kind" in entry.operation && entry.operation.kind === "replace" && entry.operation.path.length === 0)
      || [...candidates.values()].some((candidate) => is_aggregate_document_candidate(candidate)
        && candidate.operations.some((operation) => operation.op === "replace-root")
        && candidate.continuity !== "same-epoch");
    const retainsIdentityEpoch = [...candidates.values()].some((candidate) => is_aggregate_document_candidate(candidate)
      && candidate.operations.some((operation) => operation.op === "replace-root")
      && candidate.continuity === "same-epoch");
    if (resetsIdentityEpoch && libraryRegistry.size() !== 1) {
      throw new Error("Whole-root replacement cannot reset a map-global QUID epoch across multiple application Libraries.");
    }
    const validatedLedger = resetsIdentityEpoch
      ? undefined
      : retainsIdentityEpoch
        ? retain_livemap_identity_epoch(mapIdentityEpoch.issued(), afterActive.keys())
      : stage_livemap_identity_epoch(
        mapIdentityEpoch.issued(),
        beforeActive.keys(),
        afterActive.keys(),
      );
    const nextLedger = validatedLedger === undefined
      ? undefined
      : merge_issued_ledgers(validatedLedger, stagedIssuedLedger);
    const changed = operations.length > 0;
    const rev = changed ? prevRev + 1 : prevRev;
    const commit: LiveMapAggregateCommit = Object.freeze({
      kind: "aggregate",
      changed,
      prevRev,
      rev,
      operations: Object.freeze(operations),
      ...hosted_commit_fields(changed, prevRev, rev, operations),
    });
    const documentCommits = new Map<LiveMapLibraryIdentity, LiveMapGraphCommit<LiveMapGraphOp>>();
    for (const candidate of candidates.values()) {
      if (!is_aggregate_document_candidate(candidate) || candidate.operations.length === 0) continue;
      const documentCommit: LiveMapGraphCommit<LiveMapGraphOp> = Object.freeze({
        changed,
        prevRev,
        rev: commit.rev,
        ops: Object.freeze([...candidate.operations]),
      });
      if (candidate.sourceCandidate !== undefined) {
        register_livemap_document_identity_candidate_commit(candidate.sourceCandidate, documentCommit);
      }
      register_livemap_document_identity_effects(documentCommit, candidate.identityEffects);
      if (candidate.operations.some((operation) => operation.op === "replace-root")) {
        register_livemap_document_commit_continuity(
          documentCommit,
          candidate.continuity ?? "new-epoch",
        );
      }
      documentCommits.set(candidate.library.identity, documentCommit);
      aggregateByDocumentCommit.set(documentCommit, commit);
    }
    if (documentCommits.size > 0) documentCommitByAggregate.set(commit, documentCommits);
    return transitionController.prepareAuthority({
      commit,
      libraryModes: Object.freeze([...candidates.values()].map((candidate) => candidate.library.mode)),
      baseStillCurrent: () => mapRevision === prevRev
        && identityGeneration === preparedIdentityGeneration
        && [...candidates.values()].every((candidate) => canonical_graph_equal(candidate.library.root, candidate.baseRoot))
        && (systemCandidate === undefined
          || canonical_graph_equal(systemCandidate.system.root, systemCandidate.baseRoot)),
      install: () => {
        if (resetsIdentityEpoch) mapIdentityEpoch.replace(afterActive.keys());
        else mapIdentityEpoch.install(nextLedger!);
        for (const candidate of candidates.values()) {
          if (is_aggregate_document_candidate(candidate)) {
            Object.assign(candidate.library, {
              root: candidate.root,
              documentOverlay: candidate.overlay,
              projectedOverlay: undefined,
              projectedValue: undefined,
            });
          } else {
            overwrite_hson_node(candidate.library.root, candidate.nextRoot);
            Object.assign(candidate.library, {
              documentOverlay: undefined,
              projectedOverlay: candidate.overlay,
              projectedValue: candidate.value,
            });
          }
        }
        if (systemCandidate !== undefined) {
          overwrite_hson_node(systemCandidate.system.root, systemCandidate.nextRoot);
          systemCandidate.system.projectedValue = systemCandidate.value;
        }
        mapRevision = commit.rev;
      },
      notify: (acceptedCommit) => {
        enqueuePublication(() => {
          aggregateAcceptedTransitions += 1;
          aggregatePublications += 1;
          const compatibilityOperations = acceptedCommit.operations.filter((operation) => (
            operation.target.domain === "application"
            && operation.target.library === compatibilityLibrary.identity
          ));
          if (compatibilityOperations.length > 0) {
            if (initialMode === "document") {
              const documentCommit = documentCommitByAggregate.get(acceptedCommit)?.get(compatibilityLibrary.identity);
              if (documentCommit !== undefined) {
                publishCommitWithWatch(documentCommit, () => commitObserverHub.emitCommit(
                  documentCommit,
                  aggregateOriginByCommit.get(acceptedCommit) ?? "authoritative",
                ));
              }
            } else {
              const commit = compatibility_data_commit_for(acceptedCommit);
              publishCommitWithWatch(commit, () => {
                const dataOps = commit.ops.filter((operation): operation is LiveMapDataOp => !("domain" in operation));
                if (dataOps.length > 0) {
                  const dataProjected = compatibilityOperations.flatMap((entry) => (
                    entry.projected === undefined ? [] : [entry.projected]
                  ));
                  const dataCommit: LiveMapCommit<LiveMapDataOp> = Object.freeze({
                    changed: true,
                    prevRev: commit.prevRev,
                    rev: commit.rev,
                    ops: Object.freeze(dataOps),
                    ...encode_livemap_replay_transport(dataProjected),
                  });
                  feedHub.emitProjected(dataCommit, (path) => (
                    project_live_path(compatibilityLibrary.root, path)
                  ));
                }
                commitObserverHub.emitCommit(commit, aggregateOriginByCommit.get(acceptedCommit) ?? "authoritative");
              });
            }
          }
          for (const watch of [...aggregateWatches]) {
            if (require_library(watch.library).mode === "document") continue;
            if (!acceptedCommit.operations.some((operation) => (
              operation.target.library === watch.library && paths_overlap(watch.path, operation.target.path)
            ))) continue;
            watch.listener(aggregate_snap(watch.library, watch.path));
          }
          for (const feed of [...aggregateFeeds]) {
            if (require_library(feed.library).mode === "document") continue;
            const operations = acceptedCommit.operations.filter((operation) => (
              operation.target.library === feed.library && paths_overlap(feed.path, operation.target.path)
            ));
            if (operations.length === 0) continue;
            feed.listener(Object.freeze({
              commit: acceptedCommit,
              path: feed.path,
              operations: Object.freeze(operations),
              value: aggregate_snap(feed.library, feed.path),
            }));
          }
          for (const observer of [...aggregateObservers]) observer(acceptedCommit);
          publishAuthorityPosition();
        });
      },
    });
  }

  function document_operation_path(operation: LiveMapGraphOp): LivePath {
    return operation.op === "replace-root" ? [] : operation.target.path;
  }

  function commit_aggregate_document_mutation<TOp extends LiveMapGraphOp>(
    libraryIdentity: LiveMapLibraryIdentity,
    candidate: PreparedDocumentMutation<TOp>,
  ): LiveMapGraphCommit<TOp> {
    const library = require_library(libraryIdentity);
    if (library.mode !== "document" || library.documentOverlay === undefined) {
      throw new Error("Aggregate document mutation requires one document library.");
    }
    let transition: import("./livemap.authority.js").PreparedLiveMapAuthorityTransition;
    try {
      transition = prepare_authority_transition([], [{
        library: libraryIdentity,
        root: candidate.root,
        overlay: candidate.overlay,
        operations: [candidate.operation],
        identityEffects: candidate.identityEffects,
        sourceCandidate: candidate,
      }]);
    } catch (cause) {
      if (cause instanceof LiveMapIdentityEpochError && cause.code === "SAME_EPOCH_QUID_REUSE") {
        throw new LiveMapDocumentMutationError(
          "DOCUMENT_IDENTITY_REUSE",
          candidate.operation.op,
          "a retired QUID cannot identify unrelated content in the same LiveMap epoch",
          { cause },
        );
      }
      throw cause;
    }
    const accepted = transitionController.acceptAuthority(transition).commit;
    const documentCommit = documentCommitByAggregate.get(accepted)?.get(library.identity);
    if (documentCommit !== undefined) return documentCommit as LiveMapGraphCommit<TOp>;
    return Object.freeze({
      changed: false,
      prevRev: accepted.prevRev,
      rev: accepted.rev,
      ops: Object.freeze([]),
    });
  }

  function make_internal_path_authority(
    libraryIdentity: LiveMapLibraryIdentity,
    pathInput: LivePath,
  ): Readonly<{
    target: LiveMapStructuralTarget;
    at: (path: LivePath) => ReturnType<typeof make_internal_path_authority>;
    snap: () => JsonValue | undefined;
  }> {
    const library = require_library(libraryIdentity);
    require_projected_library(library);
    const target = aggregate_target(libraryIdentity, pathInput);
    const cache = internalPathAuthorities.get(libraryIdentity)
      ?? (() => {
        const next = new Map<string, ReturnType<typeof make_internal_path_authority>>();
        internalPathAuthorities.set(libraryIdentity, next);
        return next;
      })();
    const key = live_path_key(target.path);
    const existing = cache.get(key);
    if (existing !== undefined) return existing;
    const authority = Object.freeze({
      target,
      at: (path: LivePath) => make_internal_path_authority(
        libraryIdentity,
        clone_live_path([...target.path, ...must_live_path(path)]),
      ),
      snap: () => aggregate_snap(libraryIdentity, target.path),
    });
    cache.set(key, authority);
    return authority;
  }

  function configure_hosted_registry(bindingsInput: readonly HostedRegistryBinding[]): HostedRegistry {
    transitionController.assertPublicMutationAllowed();
    if (hostedRegistry !== undefined) throw new Error("LiveMap hosted registry is already fixed.");
    if (mapRevision !== 0) throw new Error("LiveMap hosted registry must be fixed before the first transition.");
    const states = libraryRegistry.all();
    if (bindingsInput.length !== states.length) {
      throw new Error("LiveMap hosted registry must name every static Library exactly once.");
    }
    const bindings = bindingsInput.map((raw, index): HostedRegistryBinding => {
      const state = states[index];
      if (state === undefined || raw.identity !== state.identity || raw.mode !== state.mode
        || raw.schema.toHson() !== state.hsonSchema?.toHson()) {
        throw new Error("LiveMap hosted registry order, mode, or Schema disagrees with aggregate authority.");
      }
      return Object.freeze({ ...raw });
    });
    const systemBinding = systemState === undefined ? [] : [Object.freeze({
      name: systemState.transportName,
      scope: "hson-internal" as const,
      identity: systemState.identity,
      mode: "data-object" as const,
      schema: systemState.hsonSchema,
    })];
    return install_hosted_registry([...bindings, ...systemBinding]);
  }

  function install_hosted_registry(bindingsInput: readonly HostedRegistryBinding[]): HostedRegistry {
    const byIdentity = new Map<object, HostedRegistryBinding>();
    const byName = new Map<string, HostedRegistryBinding>();
    const bindings = bindingsInput.map((raw): HostedRegistryBinding => {
      const binding = Object.freeze({ ...raw });
      if (byIdentity.has(binding.identity) || byName.has(binding.name)) {
        throw new Error("LiveMap hosted registry contains a duplicate Library.");
      }
      byIdentity.set(binding.identity, binding);
      byName.set(binding.name, binding);
      return binding;
    });
    const registry = make_hosted_registry(bindings);
    hostedRegistry = registry;
    hostedFence ??= make_hosted_authority_fence();
    hostedBindingsByIdentity = byIdentity;
    hostedBindingsByName = byName;
    return registry;
  }

  function capture_libraries_aggregate(): LiveMapLibrariesSnapshot {
    const hosted = require_hosted_state();
    const libraries = hosted.registry.libraries.map((entry) => {
      const binding = hosted.byName.get(entry.name);
      if (binding === undefined) throw new Error("Hosted registry binding is unavailable during aggregate capture.");
      const state = binding.scope === "hson-internal"
        ? (() => {
          if (systemState === undefined || binding.identity !== systemState.identity) {
            throw new Error("Hosted system-state binding is unavailable during aggregate capture.");
          }
          return systemState;
        })()
        : require_library(binding.identity as LiveMapLibraryIdentity);
      return Object.freeze({
        name: entry.name,
        mode: entry.mode,
        schema: entry.schema,
        schemaDigest: entry.schemaDigest,
        root: encode_hosted_root(clone_live_root(state.root)),
      });
    });
    const issuedQuids = enumerate_livemap_issued_quids(mapIdentityEpoch.issued());
    if (issuedQuids.length > HOSTED_MAX_ISSUED_QUIDS) {
      throw new Error("Hosted aggregate issued-QUID ledger exceeds its supported bound.");
    }
    const snapshot: LiveMapLibrariesSnapshot = Object.freeze({
      format: LIVEMAP_LIBRARIES_SNAPSHOT_FORMAT,
      revision: mapRevision,
      registry: hosted.registry,
      registryDigest: hosted.registry.digest,
      libraries: Object.freeze(libraries),
      identity: Object.freeze({
        epoch: mapIdentityEpoch.current(),
        issuedQuids,
      }),
    });
    assert_libraries_snapshot_bound(snapshot);
    return snapshot;
  }

  function capture_hosted_aggregate(): HostedLiveMapLibrariesSnapshot {
    const hosted = require_hosted_state();
    const snapshot = Object.freeze({ ...capture_libraries_aggregate(), authority: hosted.fence });
    assert_libraries_snapshot_bound(snapshot);
    return snapshot;
  }

  function restore_libraries_aggregate(
    snapshot: LiveMapLibrariesSnapshot | LocalLibrariesContinuationSnapshot,
    authority?: HostedAuthorityFence,
  ): void {
    transitionController.assertPublicMutationAllowed();
    const hosted = require_hosted_state();
    const identity = "identity" in snapshot ? snapshot.identity : undefined;
    if ("identity" in snapshot) assert_libraries_snapshot_shape(snapshot);
    else assert_local_libraries_snapshot_shape(snapshot);
    assert_libraries_snapshot_bound(snapshot);
    if (snapshot.format !== LIVEMAP_LIBRARIES_SNAPSHOT_FORMAT
      || snapshot.registryDigest !== hosted.registry.digest
      || snapshot.registry.digest !== hosted.registry.digest
      || JSON.stringify(snapshot.registry) !== JSON.stringify(hosted.registry)) {
      throw new Error("Hosted aggregate snapshot registry is incompatible with this LiveMap.");
    }
    if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0
      || (identity !== undefined && (!Number.isSafeInteger(identity.epoch) || identity.epoch < 0
        || !Array.isArray(identity.issuedQuids)
        || identity.issuedQuids.length > HOSTED_MAX_ISSUED_QUIDS))
      || !Array.isArray(snapshot.libraries)
      || snapshot.libraries.length !== hosted.registry.libraries.length) {
      throw new Error("Hosted aggregate snapshot envelope is malformed.");
    }

    const issuedLedger = identity === undefined ? undefined : make_livemap_issued_quid_ledger(identity.issuedQuids);
    if (identity !== undefined && issuedLedger?.size !== identity.issuedQuids.length) {
      throw new Error("Hosted aggregate snapshot issued-QUID ledger contains duplicates.");
    }
    const candidates: Array<Readonly<{
      library: LiveMapLibraryState;
      root: HsonNode;
      mode: LiveMapLibraryState["mode"];
      documentOverlay?: import("./livemap.document.identity.js").LiveMapDocumentIdentityOverlay;
      projectedOverlay?: LiveMapProjectedIdentityOverlay;
      projectedValue?: OrderedProjectedValue;
    }>> = [];
    let systemCandidate: Readonly<{
      state: LiveMapSystemState;
      root: HsonNode;
      projectedValue: OrderedProjectedValue;
    }> | undefined;
    for (let index = 0; index < snapshot.libraries.length; index += 1) {
      const encoded = snapshot.libraries[index];
      const entry = hosted.registry.libraries[index];
      if (encoded === undefined || entry === undefined
        || encoded.name !== entry.name || encoded.mode !== entry.mode
        || encoded.schema !== entry.schema || encoded.schemaDigest !== entry.schemaDigest
        || hosted_sha256(encoded.schema) !== encoded.schemaDigest) {
        throw new Error("Hosted aggregate snapshot Library metadata disagrees with its registry.");
      }
      const binding = hosted.byName.get(entry.name);
      if (binding === undefined) throw new Error("Hosted aggregate snapshot Library binding is unavailable.");
      const root = decode_hosted_root(encoded.root);
      const prepared = prepare_livemap_root(root);
      if (prepared.mode !== entry.mode) throw new Error("Hosted aggregate snapshot root mode disagrees with its registry.");
      must_hson_schema_root(binding.schema, prepared.root);
      if (entry.scope === "hson-internal") {
        if (systemState === undefined || binding.identity !== systemState.identity
          || prepared.mode === "document" || (prepared.projectedOverlay?.size ?? 0) !== 0) {
          throw new Error("Hosted aggregate snapshot system state is incompatible.");
        }
        systemCandidate = Object.freeze({
          state: systemState,
          root: prepared.root,
          projectedValue: must_projected_root_value(prepared.root),
        });
        continue;
      }
      candidates.push(Object.freeze({
        library: require_library(binding.identity as LiveMapLibraryIdentity),
        root: prepared.root,
        mode: prepared.mode,
        ...(prepared.documentOverlay === undefined ? {} : { documentOverlay: prepared.documentOverlay }),
        ...(prepared.projectedOverlay === undefined ? {} : {
          projectedOverlay: prepared.projectedOverlay,
          projectedValue: must_projected_root_value(prepared.root),
        }),
      }));
    }
    const candidateStates = candidates.map((candidate) => ({
      ...candidate.library,
      root: candidate.root,
      mode: candidate.mode,
      documentOverlay: candidate.documentOverlay,
      projectedOverlay: candidate.projectedOverlay,
      projectedValue: candidate.projectedValue,
    }));
    const active = aggregate_quid_locations(candidateStates);
    for (const quid of active.keys()) {
      if (issuedLedger === undefined || !issuedLedger.has(quid)) {
        throw new Error("Hosted aggregate snapshot active QUID is absent from its issued ledger.");
      }
    }

    // All fallible decoding, compilation, Schema, mode, identity, and bound checks
    // are complete before this single installation section begins.
    const previousRevision = mapRevision;
    const continuity = authority !== undefined && identity !== undefined && issuedLedger !== undefined
      && hosted.fence.logicalMapId === authority.logicalMapId
      && hosted.fence.incarnationId === authority.incarnationId
      && mapIdentityEpoch.current() === identity.epoch
      && enumerate_livemap_issued_quids(mapIdentityEpoch.issued()).every((quid) => issuedLedger.has(quid))
      ? "same-epoch" as const
      : "new-epoch" as const;
    const changedLibraries = Object.freeze(candidates
      .filter((candidate) => !canonical_graph_equal(candidate.library.root, candidate.root))
      .map((candidate) => candidate.library.identity));
    if (systemState !== undefined && systemCandidate === undefined) {
      throw new Error("Hosted aggregate snapshot omitted configured transactional system state.");
    }
    for (const candidate of candidates) {
      Object.assign(candidate.library, {
        root: candidate.root,
        documentOverlay: candidate.documentOverlay,
        projectedOverlay: candidate.projectedOverlay,
        projectedValue: candidate.projectedValue,
      });
    }
    if (systemCandidate !== undefined) {
      systemCandidate.state.root = systemCandidate.root;
      systemCandidate.state.projectedValue = systemCandidate.projectedValue;
    }
    if (identity === undefined) mapIdentityEpoch.replace([]);
    else if (issuedLedger !== undefined) mapIdentityEpoch.hydrate(identity.epoch, issuedLedger);
    mapRevision = snapshot.revision;
    if (authority !== undefined) hostedFence = Object.freeze({ ...authority });
    transitionController.invalidate();
    // A hosted recovery snapshot is an atomic replacement boundary, not a
    // fabricated operation commit.  Selected document libraries use this to
    // deliver their normal in-place snapshot observation to Reflect while
    // retained data/document handles continue to resolve through the same
    // stable library records above.
    const restored = Object.freeze(libraryRegistry.all().map((library) => library.identity));
    const event = Object.freeze({
      previousRevision,
      revision: snapshot.revision,
      libraries: restored,
      changedLibraries,
      continuity,
    });
    enqueuePublication(() => {
      for (const observer of [...aggregateRestoreObservers]) observer(event);
      publishAuthorityPosition();
    });
  }

  function restore_hosted_aggregate(snapshot: HostedLiveMapLibrariesSnapshot): void {
    assert_hosted_libraries_snapshot_shape(snapshot);
    if (typeof snapshot.authority.logicalMapId !== "string"
      || snapshot.authority.logicalMapId.length === 0
      || typeof snapshot.authority.incarnationId !== "string"
      || snapshot.authority.incarnationId.length === 0) {
      throw new Error("Hosted aggregate snapshot authority is malformed.");
    }
    const semantic: LiveMapLibrariesSnapshot = Object.freeze({
      format: snapshot.format,
      revision: snapshot.revision,
      registry: snapshot.registry,
      registryDigest: snapshot.registryDigest,
      libraries: snapshot.libraries,
      identity: snapshot.identity,
    });
    restore_libraries_aggregate(semantic, snapshot.authority);
  }

  function replay_hosted_aggregate(input: HostedAggregateCommit): LiveMapAggregateCommit {
    transitionController.assertPublicMutationAllowed();
    const hosted = require_hosted_state();
    const decoded = decode_hosted_commit(input, hosted.registry, hosted.byName);
    if (input.authority.logicalMapId !== hosted.fence.logicalMapId
      || input.authority.incarnationId !== hosted.fence.incarnationId) {
      throw new Error("Hosted aggregate commit authority fence is incompatible.");
    }
    if (input.prevRev !== mapRevision) {
      throw new LiveMapRevError(input.prevRev, mapRevision);
    }
    const writes: LiveMapAggregateWrite[] = decoded.map((entry): LiveMapAggregateWrite => {
      const path = "path" in entry.semantic ? entry.semantic.path : (
        "target" in entry.semantic ? entry.semantic.target.path : []
      );
      const target = entry.library.scope === "hson-internal"
        ? aggregate_system_target(entry.library.identity as LiveMapSystemIdentity, path)
        : aggregate_target(entry.library.identity as LiveMapLibraryIdentity, path);
      if (entry.projected !== undefined) {
        return Object.freeze({ target, kind: "replay-data", operation: entry.projected });
      }
      const operation = entry.graph;
      if (operation === undefined) throw new Error("Hosted replay operation has no decoded machine evidence.");
      if (operation.op === "ensure-quid" && "projected" in operation.target && operation.target.projected === true) {
        return Object.freeze({ target, kind: "ensure-quid", quid: operation.quid });
      }
      return Object.freeze({ target, kind: "graph", operation: operation as LiveMapGraphOp });
    });
    const transition = prepare_authority_transition(writes);
    if (transition.commit.hosted === undefined || JSON.stringify(transition.commit.hosted) !== JSON.stringify(input)) {
      transitionController.discardAuthority(transition);
      throw new Error("Hosted aggregate replay did not reproduce its exact semantic commit envelope.");
    }
    return transitionController.acceptAuthority(transition).commit;
  }

  const aggregateAuthority: InternalLiveMapAggregateAuthority = Object.freeze({
    libraries: () => Object.freeze(libraryRegistry.all().map((library) => library.identity)),
    configureSystemState: (key, transportName, root, hsonSchema) => {
      transitionController.assertPublicMutationAllowed();
      if (systemState !== undefined) {
        if (systemState.key === key) return systemState.identity;
        throw new Error("LiveMap transactional system-state slot is already configured.");
      }
      if (mapRevision !== 0) {
        throw new Error("Transactional Hson system state must be configured before the first transition.");
      }
      if (hostedRegistry === undefined || hostedBindingsByIdentity === undefined) {
        throw new Error("Canonical interactions require a fixed multi-library LiveMap.");
      }
      const candidate = prepare_system_state({ key, transportName, root, hsonSchema });
      const applicationBindings = libraryRegistry.all().map((state) => {
        const binding = hostedBindingsByIdentity?.get(state.identity);
        if (binding === undefined) throw new Error("Hosted LiveMap application binding disappeared during system-state configuration.");
        return binding;
      });
      install_hosted_registry([...applicationBindings, Object.freeze({
        name: transportName,
        scope: "hson-internal",
        identity: candidate.identity,
        mode: "data-object",
        schema: hsonSchema,
      })]);
      systemState = candidate;
      return candidate.identity;
    },
    systemState: (key) => systemState?.key === key ? systemState.identity : undefined,
    systemRoot: (system) => require_system(system).root,
    systemTarget: aggregate_system_target,
    configureHostedRegistry: configure_hosted_registry,
    hostedRegistry: () => require_hosted_state().registry,
    captureLibraries: capture_libraries_aggregate,
    captureHosted: capture_hosted_aggregate,
    restoreLibraries: (snapshot) => restore_libraries_aggregate(snapshot),
    restorePortableLibraries: (snapshot) => restore_libraries_aggregate(snapshot),
    restoreHosted: restore_hosted_aggregate,
    restoreHostedManaged: (owner, snapshot) => transitionController.runManaged(
      owner,
      () => restore_hosted_aggregate(snapshot),
    ),
    replayHosted: replay_hosted_aggregate,
    replayHostedManaged: (owner, commit) => transitionController.runManaged(
      owner,
      () => replay_hosted_aggregate(commit),
    ),
    advanceHostedProgressManaged: (owner, progress) => transitionController.runManaged(owner, () => {
      const hosted = require_hosted_state();
      if (progress.logicalMapId !== hosted.fence.logicalMapId
        || progress.incarnationId !== hosted.fence.incarnationId
        || progress.registryDigest !== hosted.registry.digest) {
        throw new Error("Hosted authority progress fence is incompatible.");
      }
      if (!Number.isSafeInteger(progress.prevRev) || !Number.isSafeInteger(progress.rev)
        || progress.prevRev !== mapRevision || progress.rev !== mapRevision + 1) {
        throw new LiveMapRevError(progress.prevRev, mapRevision);
      }
      mapRevision = progress.rev;
      publishAuthorityPosition();
      return mapRevision;
    }),
    observeAuthorityPosition: (listener) => {
      aggregatePositionObservers.push(listener);
      return () => {
        const index = aggregatePositionObservers.indexOf(listener);
        if (index !== -1) aggregatePositionObservers.splice(index, 1);
      };
    },
    target: aggregate_target,
    root: (library) => require_library(library).root,
    documentOverlay: (library) => {
      const overlay = require_library(library).documentOverlay;
      if (overlay === undefined) throw new Error("Selected LiveMap library is not a document library.");
      return overlay;
    },
    identityEpoch: () => mapIdentityEpoch,
    acquireLocalDocumentIdentity: acquire_local_document_identity,
    acquireLocalProjectedIdentity: acquire_local_projected_identity,
    snap: aggregate_snap,
    handle: make_internal_path_authority,
    resolveQuid: (quid) => aggregate_quid_locations(libraryRegistry.all()).get(quid),
    prepare: prepare_authority_transition,
    prepareManaged: (owner, writes) => transitionController.runManaged(
      owner,
      () => prepare_authority_transition(writes),
    ),
    accept: transitionController.acceptAuthority,
    discard: transitionController.discardAuthority,
    claimManagement: (owner) => transitionController.claimManagement(
      owner,
      () => Promise.reject(new LiveMapTransitionError(
        "LIVEMAP_MANAGED_MUTATION_REJECTED",
        "Aggregate LiveMap mutation is controlled by an exclusive Locus authority.",
      )),
    ),
    releaseManagement: transitionController.releaseManagement,
    commit: (writes) => transitionController.acceptAuthority(prepare_authority_transition(writes)).commit,
    commitDocumentMutation: commit_aggregate_document_mutation,
    documentCommitFor: (library, commit) => documentCommitByAggregate.get(commit)?.get(library),
    aggregateCommitForDocument: (commit) => aggregateByDocumentCommit.get(commit),
    lowerForLegacy: reject_livemap_aggregate_legacy_lowering,
    observe: (listener) => {
      aggregateObservers.push(listener);
      return () => {
        const index = aggregateObservers.indexOf(listener);
        if (index !== -1) aggregateObservers.splice(index, 1);
      };
    },
    observeRestore: (listener) => {
      aggregateRestoreObservers.push(listener);
      return () => {
        const index = aggregateRestoreObservers.indexOf(listener);
        if (index !== -1) aggregateRestoreObservers.splice(index, 1);
      };
    },
    watch: (library, path, listener) => {
      const watch: AggregateWatch = Object.freeze({
        library: require_library(library).identity,
        path: clone_live_path(must_live_path(path)),
        listener,
      });
      aggregateWatches.push(watch);
      return () => {
        const index = aggregateWatches.indexOf(watch);
        if (index !== -1) aggregateWatches.splice(index, 1);
      };
    },
    feed: (library, path, listener) => {
      const feed: AggregateFeed = Object.freeze({
        library: require_library(library).identity,
        path: clone_live_path(must_live_path(path)),
        listener,
      });
      aggregateFeeds.push(feed);
      return () => {
        const index = aggregateFeeds.indexOf(feed);
        if (index !== -1) aggregateFeeds.splice(index, 1);
      };
    },
    inspect: () => Object.freeze({
      revision: mapRevision,
      libraries: Object.freeze(libraryRegistry.all().map((library) => Object.freeze({
        identity: library.identity,
        mode: library.mode,
        root: clone_live_root(library.root),
        hsonSchemaAttached: library.hsonSchema !== undefined,
      }))),
    }),
    telemetry: () => Object.freeze({
      candidateRootsCloned: aggregateCandidateRootsCloned,
      schemaValidations: aggregateSchemaValidations,
      aggregatePublications,
      acceptedTransitions: aggregateAcceptedTransitions,
    }),
  });

  if (initialMode !== "document") {
    register_livemap_projected_identity_api(core, projectedIdentityApi);
    return {
      core,
      projected,
      transitionController,
      aggregateAuthority,
      compatibilityLibrary: () => compatibilityLibrary,
      mapRevision: () => mapRevision,
      mapIdentityEpoch,
      currentRoot: () => compatibilityLibrary.root,
      currentHsonSchema: () => compatibilityLibrary.hsonSchema,
      currentPreparedRoot: () => ({
        root: compatibilityLibrary.root,
        mode: initialMode,
        projectedOverlay: require_projected_overlay(compatibilityLibrary.projectedOverlay),
      }),
      watchDocument: documentWatchHub.add,
      prepareDetachedCommit,
      prepareProjectedWriteOps: (writeOps) => {
        if (writeOps.some((operation) => operation.kind === "replace" && operation.path.length === 0)) {
          assert_legacy_identity_epoch_reset_available();
        }
        return prepareCompatibilityDataTransition(writeOps);
      },
      prepareProjectedBatch: (fn) => {
        const writeOps: LiveMapCoreWriteOp[] = [];
        let open = true;
        try { fn(make_batch_tx_from_candidate(getProjectedValue(), writeOps, () => open)); }
        finally { open = false; }
        if (writeOps.some((operation) => operation.kind === "replace" && operation.path.length === 0)) {
          assert_legacy_identity_epoch_reset_available();
        }
        return prepareCompatibilityDataTransition(writeOps);
      },
    };
  }

  const document: LiveMapDocumentInstallController & LiveMapDocumentMutationController & LiveMapDocumentReplayController & InternalDocumentSchemaController = {
    mode: initialMode,
    rev: () => mapRevision,
    root: () => compatibilityLibrary.root,
    overlay: () => {
      const identity = compatibilityLibrary.documentOverlay;
      if (identity === undefined) {
        throw new Error(`LiveMap document mode ${initialMode} has no identity overlay.`);
      }
      return identity;
    },
    commits: Object.freeze({ observe: commitObserverHub.observe }),
    identityEpoch: mapIdentityEpoch,
    getDocumentSchema: () => compatibilityLibrary.hsonSchema,
    useDocumentSchema,
    apply: (
      candidate: PreparedDocumentInstall,
      continuity: "same-epoch" | "new-epoch",
    ): LiveMapGraphCommit<LiveMapGraphReplaceRootOp> => {
      transitionController.assertPublicMutationAllowed();
      const unchanged = canonical_graph_equal(compatibilityLibrary.root, candidate.root);
      if (continuity === "new-epoch" && !unchanged) assert_legacy_identity_epoch_reset_available();
      const currentOverlay = compatibilityLibrary.documentOverlay;
      if (currentOverlay === undefined) throw new Error("LiveMap document identity overlay is unavailable.");
      const operation: LiveMapGraphReplaceRootOp = Object.freeze({
        domain: "graph",
        op: "replace-root",
        mode: candidate.mode,
        root: clone_live_root(candidate.root),
      });
      const transition = prepare_authority_transition([], [{
        library: compatibilityLibrary.identity,
        root: candidate.root,
        overlay: candidate.overlay,
        operations: unchanged ? [] : [operation],
        identityEffects: unchanged
          ? []
          : replace_livemap_document_identity_overlay_effects(currentOverlay, candidate.overlay),
        continuity,
      }]);
      aggregateOriginByCommit.set(transition.commit, "authoritative");
      const accepted = transitionController.acceptAuthority(transition).commit;
      const documentCommit = documentCommitByAggregate.get(accepted)?.get(compatibilityLibrary.identity);
      if (documentCommit !== undefined) {
        return documentCommit as LiveMapGraphCommit<LiveMapGraphReplaceRootOp>;
      }
      return Object.freeze({
        changed: false,
        prevRev: accepted.prevRev,
        rev: accepted.rev,
        ops: Object.freeze([]),
      });
    },
    restore: (
      candidate: PreparedDocumentInstall,
      revision: number,
      continuity: "same-epoch" | "new-epoch",
    ): void => {
      transitionController.assertPublicMutationAllowed();
      if (compatibilityLibrary.hsonSchema !== undefined) must_hson_schema_root(compatibilityLibrary.hsonSchema, candidate.root);
      if (continuity === "new-epoch") assert_legacy_identity_epoch_reset_available();
      const candidateQuids = livemap_document_identity_quids(candidate.overlay);
      if (continuity === "new-epoch") {
        mapIdentityEpoch.replace(candidateQuids);
      } else {
        mapIdentityEpoch.install(retain_livemap_identity_epoch(
          mapIdentityEpoch.issued(),
          candidateQuids,
        ));
      }
      Object.assign(compatibilityLibrary, {
        root: candidate.root,
        documentOverlay: candidate.overlay,
        projectedOverlay: undefined,
      });
      mapRevision = revision;
      transitionController.invalidate();
      publishSnapshotWithWatch(revision, continuity);
    },
    applyMutation: <TOp extends LiveMapGraphOp>(candidate: PreparedDocumentMutation<TOp>): LiveMapGraphCommit<TOp> => {
      return commit_aggregate_document_mutation(compatibilityLibrary.identity, candidate);
    },
    acquireLocalIdentity: (path: LiveMapDocumentPath, quid: string, participant?: LiveMapRuntimeIdentityParticipant) =>
      acquire_local_document_identity(compatibilityLibrary.identity, path, quid, participant),
    applyReplay: (candidate: PreparedDocumentReplay): LiveMapGraphCommit => {
      transitionController.assertPublicMutationAllowed();
      register_livemap_document_identity_effects(candidate.commit, candidate.identityEffects);
      const replacesRoot = candidate.commit.ops[0]?.op === "replace-root";
      if (replacesRoot) assert_legacy_identity_epoch_reset_available();
      const transition = prepare_authority_transition([], [{
        library: compatibilityLibrary.identity,
        root: candidate.root,
        overlay: candidate.overlay,
        operations: candidate.commit.ops,
        identityEffects: candidate.identityEffects,
        issuedLedger: candidate.issuedLedger,
        ...(replacesRoot ? { continuity: "new-epoch" as const } : {}),
      }]);
      const generated = documentCommitByAggregate.get(transition.commit);
      if (generated !== undefined) generated.set(compatibilityLibrary.identity, candidate.commit);
      aggregateByDocumentCommit.set(candidate.commit, transition.commit);
      if (replacesRoot) {
        register_livemap_document_commit_continuity(candidate.commit, "new-epoch");
      }
      aggregateOriginByCommit.set(transition.commit, "replay");
      transitionController.acceptAuthority(transition);
      return candidate.commit;
    },
  };

  return {
    core,
    projected,
    document,
    transitionController,
    aggregateAuthority,
    compatibilityLibrary: () => compatibilityLibrary,
    mapRevision: () => mapRevision,
    mapIdentityEpoch,
    currentRoot: () => compatibilityLibrary.root,
    currentHsonSchema: () => compatibilityLibrary.hsonSchema,
    currentPreparedRoot: () => ({
      root: compatibilityLibrary.root,
      mode: initialMode,
      ...(compatibilityLibrary.documentOverlay === undefined ? {} : { documentOverlay: compatibilityLibrary.documentOverlay }),
      ...(compatibilityLibrary.projectedOverlay === undefined ? {} : { projectedOverlay: compatibilityLibrary.projectedOverlay }),
    }),
    watchDocument: documentWatchHub.add,
    prepareDetachedCommit,
    prepareProjectedWriteOps: () => {
      throw new LiveMapTransitionError(
        "LIVEMAP_TRANSITION_INVALID",
        "Projected staged write operations are unavailable for document maps.",
      );
    },
    prepareProjectedBatch: () => {
      throw new LiveMapTransitionError(
        "LIVEMAP_TRANSITION_INVALID",
        "Projected staged batches are unavailable for document maps.",
      );
    },
  };
}

/** Register the internal callback-based staging seam on one completed façade. */
function register_staged_facade<TMap extends object>(map: TMap, built: BuiltLiveMapCore): void {
  let stagedManagementOwner: object | undefined;
  const prepareThroughManagement = <T>(operation: () => T): T => (
    stagedManagementOwner === undefined
      ? operation()
      : built.transitionController.runManaged(stagedManagementOwner, operation)
  );
  const stagedAuthority: LiveMapStagedAuthority<TMap> = Object.freeze({
    prepare(mutation): PreparedLiveMapTransition {
      type DetachedFallback = Readonly<{
        preparedDraft: ReturnType<typeof prepare_livemap_root>;
        draftBuilt: BuiltLiveMapCore;
        ephemeral: ReturnType<typeof make_ephemeral_staged_draft<TMap>>;
        observations: Array<Readonly<{
          commit: LiveMapCommit<LiveMapAnyOp>;
          origin: "authoritative" | "replay";
        }>>;
      }>;
      let fallback: DetachedFallback | undefined;
      let fastTransition: PreparedLiveMapTransition | undefined;
      let active = true;

      const ensureFallback = (): DetachedFallback => {
        if (fastTransition !== undefined) {
          throw new LiveMapTransitionError(
            "LIVEMAP_TRANSITION_INVALID",
            "Staged LiveMap mutation must produce exactly one commit.",
          );
        }
        if (fallback !== undefined) return fallback;
        const preparedDraft = prepare_livemap_root(built.currentRoot());
        const draftBuilt = make_livemap_core_from_compatibility_root(preparedDraft, {
          revision: built.core.rev,
          ...(built.currentHsonSchema() !== undefined ? { hsonSchema: built.currentHsonSchema() } : {}),
        });
        const draft = facade_for_livemap_root(
          draftBuilt.core,
          preparedDraft,
          draftBuilt.document,
          draftBuilt.watchDocument,
        );
        register_livemap_projected_propagation(draftBuilt.core, draftBuilt.projected);
        register_livemap_projected_propagation(draft, draftBuilt.projected);
        const observations: DetachedFallback["observations"] = [];
        draft.commits.observe((event) => {
          if (event.kind === "commit") observations.push({ commit: event.commit, origin: event.origin });
          else observations.push({
            commit: Object.freeze({ changed: false, prevRev: event.revision, rev: event.revision, ops: Object.freeze([]) }),
            origin: "replay",
          });
        });
        const ephemeral = make_ephemeral_staged_draft(draft as TMap);
        register_livemap_projected_propagation(ephemeral.draft, draftBuilt.projected);
        fallback = { preparedDraft, draftBuilt, ephemeral, observations };
        return fallback;
      };

      const stagedDraft = new Proxy(Object.create(null) as TMap, {
        has(_target, property) {
          return Reflect.has(ensureFallback().ephemeral.draft, property);
        },
        ownKeys() {
          return Reflect.ownKeys(ensureFallback().ephemeral.draft);
        },
        getOwnPropertyDescriptor(_target, property) {
          const descriptor = Reflect.getOwnPropertyDescriptor(ensureFallback().ephemeral.draft, property);
          return descriptor === undefined ? undefined : { ...descriptor, configurable: true };
        },
        get(_target, property) {
          if (!active) {
            throw new LiveMapTransitionError("LIVEMAP_TRANSITION_INVALID", "Staged LiveMap draft is expired.");
          }
          if (property === "batch" && built.core.mode !== "document" && fallback === undefined) {
            return (fn: (tx: LiveMapBatchTx<JsonValue | undefined>) => void): LiveMapCommit => {
              if (fastTransition !== undefined) {
                throw new LiveMapTransitionError("LIVEMAP_TRANSITION_INVALID", "Staged LiveMap mutation must produce exactly one commit.");
              }
              fastTransition = prepareThroughManagement(() => built.prepareProjectedBatch(fn));
              return fastTransition.commit as LiveMapCommit;
            };
          }
          return Reflect.get(ensureFallback().ephemeral.draft, property);
        },
      });
      register_livemap_projected_propagation(stagedDraft, Object.freeze({
        read: (path) => livemap_projected_propagation(ensureFallback().ephemeral.draft)!.read(path),
        feed: (path, listener) => livemap_projected_propagation(ensureFallback().ephemeral.draft)!.feed(path, listener),
        commit: (ops) => livemap_projected_propagation(ensureFallback().ephemeral.draft)!.commit(ops),
      }));
      let result: unknown;
      try {
        result = mutation(stagedDraft);
      } finally {
        active = false;
        fallback?.ephemeral.expire();
      }
      if (is_promise_like(result)) {
        throw new LiveMapTransitionError(
          "LIVEMAP_TRANSITION_INVALID",
          "Staged LiveMap mutation callback must be synchronous.",
        );
      }
      if (!is_livemap_commit(result)) {
        throw new Error("Staged LiveMap mutation must return its LiveMap commit.");
      }
      if (fastTransition !== undefined) {
        if (result !== fastTransition.commit) {
          throw new Error("Staged LiveMap mutation must return its LiveMap commit.");
        }
        return fastTransition;
      }
      const detached = fallback;
      if (detached === undefined) {
        throw new Error("Staged LiveMap mutation did not use its draft.");
      }
      if (result.changed) {
        const observation = detached.observations[0];
        if (detached.observations.length !== 1
          || observation === undefined
          || observation.origin !== "authoritative"
          || observation.commit !== result) {
          throw new Error("Staged LiveMap mutation must produce exactly one authoritative commit.");
        }
      } else if (detached.observations.length !== 0
        || !canonical_graph_equal(detached.preparedDraft.root, detached.draftBuilt.currentRoot())) {
        throw new Error("Staged LiveMap no-op mutation changed detached authority state.");
      }

      return prepareThroughManagement(() => built.prepareDetachedCommit(
          result,
          detached.draftBuilt.currentRoot(),
          detached.draftBuilt.currentPreparedRoot(),
        ));
    },
    accept: built.transitionController.accept,
    discard: built.transitionController.discard,
    claimManagement(owner, schedule): void {
      built.transitionController.claimManagement(
        owner,
        schedule as unknown as (mutation: (draft: object) => LiveMapCommit<LiveMapAnyOp>) => Promise<LiveMapCommit<LiveMapAnyOp>>,
      );
      stagedManagementOwner = owner;
      try {
        const currentMode = classify_live_root_mode(built.currentRoot());
        if (currentMode !== built.core.mode) {
          throw new Error(
            `LiveMap canonical root mode changed outside governed mutation: expected ${built.core.mode}, observed ${currentMode}.`,
          );
        }
      } catch (cause) {
        built.transitionController.releaseManagement(owner);
        if (stagedManagementOwner === owner) stagedManagementOwner = undefined;
        throw cause;
      }
    },
    releaseManagement: (owner) => {
      built.transitionController.releaseManagement(owner);
      if (stagedManagementOwner === owner) stagedManagementOwner = undefined;
    },
    runManaged: built.transitionController.runManaged,
    scheduleManaged: (mutation) => built.transitionController.scheduleManaged(
      mutation as (draft: object) => LiveMapCommit<LiveMapAnyOp>,
    ),
  });
  register_livemap_staged_authority(map, stagedAuthority);
  register_echo_map_capability_internal(map, Object.freeze({
    topology: "solo" as const,
    revision: () => built.core.rev,
    documentMaps: () => built.core.mode === "document" ? Object.freeze([map]) : Object.freeze([]),
    acquire(owner: object) {
      stagedAuthority.claimManagement(owner, () => Promise.reject(new LiveMapTransitionError(
        "LIVEMAP_MANAGED_MUTATION_REJECTED",
        "Echo LiveMap mutation is reserved for accepted canonical replay.",
      )));
      return Object.freeze({
        runManaged: <T>(operation: () => T): T => stagedAuthority.runManaged(owner, operation),
        release: (): void => stagedAuthority.releaseManagement(owner),
      });
    },
  }));
}

const STAGED_DRAFT_UNAVAILABLE_PROPERTIES = new Set<PropertyKey>([
  "commits",
  "debug",
  "feed",
  "linkTo",
  "replay",
  "restore",
  "schema",
  "sub",
  "watch",
]);

/** Restrict and expire the detached callback façade without exposing candidate state. */
function make_ephemeral_staged_draft<TMap extends object>(value: TMap): Readonly<{
  draft: TMap;
  expire: () => void;
}> {
  const proxies = new WeakMap<object, object>();
  let active = true;

  const wrap = <TValue extends object>(target: TValue): TValue => {
    const existing = proxies.get(target);
    if (existing !== undefined) return existing as TValue;
    const proxyTarget = typeof target === "function" ? function () {} : Object.create(null) as object;
    const proxy = new Proxy(proxyTarget, {
      has(_current, property) {
        return Reflect.has(target, property);
      },
      get(_current, property) {
        if (STAGED_DRAFT_UNAVAILABLE_PROPERTIES.has(property)) {
          throw new LiveMapTransitionError(
            "LIVEMAP_TRANSITION_INVALID",
            "Operation is unavailable on a staged LiveMap draft.",
          );
        }
        const member = Reflect.get(target, property, target) as unknown;
        return (typeof member === "object" && member !== null) || typeof member === "function"
          ? wrap(member as object)
          : member;
      },
      set() {
        throw new LiveMapTransitionError(
          "LIVEMAP_TRANSITION_INVALID",
          "Staged LiveMap draft properties cannot be assigned directly.",
        );
      },
      apply(_current, thisArgument, argumentsList) {
        if (!active) {
          throw new LiveMapTransitionError(
            "LIVEMAP_TRANSITION_INVALID",
            "Staged LiveMap draft is expired.",
          );
        }
        return Reflect.apply(target as (...args: unknown[]) => unknown, thisArgument, argumentsList);
      },
    }) as TValue;
    proxies.set(target, proxy);
    return proxy;
  };

  return Object.freeze({
    draft: wrap(value),
    expire(): void { active = false; },
  });
}

function is_promise_like(value: unknown): value is PromiseLike<unknown> {
  return typeof value === "object"
    && value !== null
    && "then" in value
    && typeof value.then === "function";
}

function is_livemap_commit(value: unknown): value is LiveMapCommit<LiveMapAnyOp> {
  return typeof value === "object"
    && value !== null
    && "changed" in value
    && typeof value.changed === "boolean"
    && "prevRev" in value
    && typeof value.prevRev === "number"
    && "rev" in value
    && typeof value.rev === "number"
    && "ops" in value
    && Array.isArray(value.ops);
}

function is_projected_identity_commit(
  value: unknown,
): value is LiveMapGraphCommit<LiveMapProjectedGraphEnsureQuidOp> & Readonly<{ ops: readonly [LiveMapProjectedGraphEnsureQuidOp] }> {
  if (typeof value !== "object" || value === null || !("ops" in value) || !Array.isArray(value.ops)) return false;
  if (value.ops.length !== 1) return false;
  const operation = value.ops[0] as unknown;
  return typeof operation === "object"
    && operation !== null
    && "domain" in operation
    && operation.domain === "graph"
    && "op" in operation
    && operation.op === "ensure-quid"
    && "target" in operation
    && typeof operation.target === "object"
    && operation.target !== null
    && "projected" in operation.target
    && operation.target.projected === true;
}

function require_projected_overlay(
  overlay: LiveMapProjectedIdentityOverlay | undefined,
): LiveMapProjectedIdentityOverlay {
  if (overlay !== undefined) return overlay;
  throw new Error("Projected LiveMap identity overlay is unavailable.");
}

function require_document_overlay(
  overlay: import("./livemap.document.identity.js").LiveMapDocumentIdentityOverlay | undefined,
): import("./livemap.document.identity.js").LiveMapDocumentIdentityOverlay {
  if (overlay !== undefined) return overlay;
  throw new Error("LiveMap document mode is missing its identity overlay.");
}

/**
 * Register a Core-level feed listener.
 *
 * This small wrapper keeps the public Core method phrased in LiveMap terms
 * while the FeedHub owns the subscription registry and path matching behavior.
 */
function feed_core_path(
  feedHub: ReturnType<typeof make_livemap_feed_hub>,
  path: LivePath,
  listener: LiveMapFeedListener,
) {
  return feedHub.add(path, listener);
}

/**
 * Build the transaction facade used by `core.batch(...)`.
 *
 * The transaction keeps an immutable carrier candidate so each later operation sees
 * earlier staged writes for path resolution and object expansion. The live root
 * is not mutated until the collected write ops pass schema and editor preflight.
 */
function make_batch_tx(
  root: HsonNode,
  writeOps: LiveMapCoreWriteOp[],
  isOpen: () => boolean,
): LiveMapBatchTx<JsonValue | undefined> {
  return make_batch_tx_from_candidate(must_projected_root_value(root), writeOps, isOpen);
}

function make_batch_tx_from_candidate(
  initialCandidate: OrderedProjectedValue,
  writeOps: LiveMapCoreWriteOp[],
  isOpen: () => boolean,
): LiveMapBatchTx<JsonValue | undefined> {
  /** The transaction mirrors Core mutation semantics. */
  let candidate = initialCandidate;

  const pushWriteOps = (ops: readonly LiveMapCoreWriteOp[]) => {
    candidate = plan_write_ops(candidate, ops).value;
    writeOps.push(...ops);
  };

  const tx: LiveMapBatchTx<JsonValue | undefined> = {
    set: (path, value) => {
      must_batch_open(isOpen);
      const livePath = must_live_path(path);
      pushWriteOps(write_ops_from_set(livePath, value, ordered_projected_value_at(candidate, livePath)));
      return tx;
    },
    replace: function (pathOrValue: unknown, value?: unknown) {
      must_batch_open(isOpen);
      const op = replace_write_op_from_args(arguments.length, pathOrValue, value);
      must_resolved_path("replace", op.path, ordered_projected_value_at(candidate, op.path));
      pushWriteOps([op]);
      return tx;
    },
    setMany: (path, values) => {
      must_batch_open(isOpen);
      const livePath = must_live_path(path);
      const projectedValues = must_ordered_projected_object(values, livePath);
      pushWriteOps(write_ops_from_set_many(livePath, projectedValues, ordered_projected_value_at(candidate, livePath)));
      return tx;
    },
    splice: (path, start, deleteCount, ...items) => {
      must_batch_open(isOpen);
      const livePath = must_live_path(path);
      const op = splice_write_op(livePath, ordered_projected_value_at(candidate, livePath), start, deleteCount, items);
      pushWriteOps([op]);
      return tx;
    },
    delete: (path) => {
      must_batch_open(isOpen);
      const livePath = must_live_path(path);
      must_resolved_path("delete", livePath, ordered_projected_value_at(candidate, livePath));
      pushWriteOps([{ kind: "delete", path: livePath }]);
      return tx;
    },
  };

  return tx;
}

function must_batch_open(isOpen: () => boolean): void {
  if (isOpen()) return;
  throw new Error("LiveMap batch transaction is already closed");
}

function must_expected_rev(
  expectedRev: number,
  actualRev: number,
): void {
  if (
    !Number.isInteger(expectedRev)
    || expectedRev < 0
  ) {
    throw new Error(
      `LiveMap expected revision is not valid: ${String(expectedRev)}`,
    );
  }

  if (expectedRev === actualRev) return;

  throw new LiveMapRevError(
    expectedRev,
    actualRev,
  );
}

function replay_write_ops(
  root: HsonNode,
  ops: readonly LiveMapProjectedDataOp[],
): readonly LiveMapCoreWriteOp[] {
  let candidate = must_projected_root_value(root);

  const writeOps: LiveMapCoreWriteOp[] = [];

  for (const op of ops) {
    const currentValue = ordered_projected_value_at(candidate, op.path);

    must_replay_value(
      op.path,
      op.prev,
      currentValue,
    );

    const writeOp = projected_write_op_from_transport(op);

    candidate = plan_write_ops(candidate, [writeOp]).value;

    const nextValue = ordered_projected_value_at(candidate, op.path);

    must_replay_value(
      op.path,
      op.next,
      nextValue,
    );

    writeOps.push(writeOp);
  }

  return writeOps;
}

function must_projected_capture(input: unknown): Readonly<{ rev: number; value: OrderedProjectedValue; root: HsonNode }> {
  if (!is_plain_unknown_record(input)) {
    throw new LiveMapProjectedTransportError("restore", "capture is not an object");
  }
  if (typeof input.rev !== "number" || !Number.isInteger(input.rev) || input.rev < 0) {
    throw new LiveMapProjectedTransportError("restore", "revision is not a non-negative integer");
  }
  if (!has_exact_projected_keys(input, ["rev", "format", "payload"])) {
    throw new LiveMapProjectedTransportError("restore", "capture is not the canonical structural representation");
  }
  if (!has_projected_transport_field(input)) {
    throw new LiveMapProjectedTransportError("restore", "capture is missing structural transport");
  }
  const rootDescriptor = Object.getOwnPropertyDescriptor(input, "root");
  if (rootDescriptor === undefined || rootDescriptor.enumerable || !is_Node(input.root)) {
    throw new LiveMapProjectedTransportError("restore", "canonical root is not an Hson node");
  }
  const ownKeys = Reflect.ownKeys(input);
  if (ownKeys.length !== 4
    || !ownKeys.every((key) => typeof key === "string" && ["rev", "format", "payload", "root"].includes(key))) {
    throw new LiveMapProjectedTransportError("restore", "capture is not the canonical structural representation");
  }
  return Object.freeze({
    rev: input.rev,
    value: must_exact_projected_value(input, "restore"),
    root: clone_live_root(input.root),
  });
}

function must_projected_apply(input: unknown): Readonly<{ prevRev: number; value: OrderedProjectedValue }> {
  if (!is_plain_unknown_record(input)) {
    throw new LiveMapProjectedTransportError("apply", "input is not an object");
  }
  if (typeof input.prevRev !== "number" || !Number.isInteger(input.prevRev) || input.prevRev < 0) {
    throw new Error(`LiveMap expected revision is not valid: ${String(input.prevRev)}`);
  }
  if (!has_exact_projected_keys(input, ["prevRev", "format", "payload"])) {
    throw new LiveMapProjectedTransportError("apply", "input is not the canonical structural representation");
  }
  if (!has_projected_transport_field(input)) {
    throw new LiveMapProjectedTransportError("apply", "input is missing structural transport");
  }
  return Object.freeze({
    prevRev: input.prevRev,
    value: must_exact_projected_value(input, "apply"),
  });
}

function must_exact_projected_value(
  input: Readonly<Record<string, unknown>>,
  context: "apply" | "restore",
): OrderedProjectedValue {
  if (input.format !== LIVEMAP_STRUCTURAL_JSON_FORMAT) {
    throw new LiveMapProjectedTransportError(context, "format is not supported");
  }
  if (typeof input.payload !== "string") {
    throw new LiveMapProjectedTransportError(context, "payload is not a string");
  }
  try {
    return decode_projected_value_payload(input.payload);
  } catch (error) {
    if (error instanceof LiveMapTransportCodecError) {
      throw new LiveMapProjectedTransportError(context, error.reason, { cause: error });
    }
    throw error;
  }
}

function has_exact_projected_keys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function has_projected_transport_field(input: Readonly<Record<string, unknown>>): boolean {
  return Object.hasOwn(input, "format")
    || Object.hasOwn(input, "payload");
}

function is_plain_unknown_record(input: unknown): input is Readonly<Record<string, unknown>> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
  const prototype = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}

function must_replay_value(
  path: LivePath,
  expected: OrderedProjectedValue | undefined,
  actual: OrderedProjectedValue | undefined,
): void {
  if (optional_ordered_projected_value_equal(expected, actual)) return;

  throw new LiveMapReplayError(
    path,
    expected,
    actual,
  );
}

/** Normalize overloaded root/endpoint replace calls into one write intent. */
function replace_write_op_from_args(
  argCount: number,
  pathOrValue: unknown,
  value: unknown,
): LiveMapProjectedReplaceWriteOp {
  if (argCount <= 1) {
    return {
      kind: "replace",
      path: [],
      value: must_ordered_projected_value(pathOrValue, []),
    };
  }

  const livePath = must_live_path(pathOrValue);

  return {
    kind: "replace",
    path: livePath,
    value: must_ordered_projected_value(value, livePath),
  };
}

/** Normalize one public array splice into a transport-safe write intent. */
function splice_write_op(path: LivePath, currentValue: OrderedProjectedValue | undefined, start: number, deleteCount: number, items: readonly unknown[]): LiveMapProjectedSpliceWriteOp {
  const arrayValue = must_core_array_value(currentValue, path);
  const normalizedStart = normalize_splice_start(arrayValue.length, start, path);
  const normalizedDeleteCount = normalize_splice_delete_count(arrayValue.length, normalizedStart, deleteCount, path);
  const projectedItems = items.map((item, index) => must_ordered_projected_value(item, append_live_path(path, normalizedStart + index)));
  return Object.freeze({ kind: "splice", path: clone_live_path(path), start: normalizedStart, deleteCount: normalizedDeleteCount, items: Object.freeze(projectedItems) });
}

function must_core_array_value(value: OrderedProjectedValue | undefined, path: LivePath): readonly OrderedProjectedValue[] {
  if (!Array.isArray(value)) throw path_kind_error(path, "array");
  return value;
}

function must_core_object_value(value: OrderedProjectedValue | undefined, path: LivePath): OrderedProjectedObject {
  if (!is_ordered_projected_object(value)) throw path_kind_error(path, "object");
  return value;
}

function must_core_move_index(
  value: readonly OrderedProjectedValue[],
  path: LivePath,
  index: number,
  role: "source" | "destination",
): void {
  if (Number.isSafeInteger(index) && index >= 0 && index < value.length) return;
  throw new LiveMapProjectedMutationError(
    role === "source" ? "INVALID_ARRAY_MOVE_SOURCE" : "INVALID_ARRAY_MOVE_DESTINATION",
    "move",
    path,
    `${role} index ${String(index)} does not resolve in the staged array`,
  );
}

function normalize_splice_start(length: number, start: number, path: LivePath): number {
  if (!Number.isInteger(start)) throw new Error(`LiveMap array splice start is not a valid index at ${JSON.stringify(path)}: ${String(start)}`);
  if (start < 0) return Math.max(length + start, 0);
  return Math.min(start, length);
}

function normalize_splice_delete_count(length: number, start: number, deleteCount: number, path: LivePath): number {
  if (!Number.isInteger(deleteCount) || deleteCount < 0) throw new Error(`LiveMap array splice deleteCount is not valid at ${JSON.stringify(path)}: ${String(deleteCount)}`);
  return Math.min(deleteCount, length - start);
}


/** Enforce the sole public Schema authority against one complete canonical root. */
function must_hson_schema_root(schema: HsonSchema, root: HsonNode): void {
  validate_hson_schema_graph(schema, root);
}

function must_hson_schema_projected_candidate(
  schema: HsonSchema | undefined,
  candidate: OrderedProjectedValue,
): void {
  if (schema === undefined) return;
  must_hson_schema_root(schema, projected_value_to_hson_root(candidate));
}


function must_projected_root_value(root: HsonNode): OrderedProjectedValue {
  const value = project_live_path(root, []);
  if (value !== undefined) return value;
  throw new Error("LiveMap data root does not resolve.");
}

function is_document_graph_operation(operation: LiveMapAnyOp): operation is LiveMapGraphOp {
  if (!("domain" in operation) || operation.domain !== "graph") return false;
  return operation.op !== "ensure-quid" || !("projected" in operation.target);
}

/** Preserve direct data roots unless an explicit whole-root replacement owns the change. */
function projected_candidate_graph(
  currentRoot: HsonNode,
  value: OrderedProjectedValue,
  writeOps: readonly LiveMapCoreWriteOp[],
): HsonNode {
  const root = projected_value_to_hson_root(value);
  const replacesRoot = writeOps.some((op) => op.kind === "replace" && op.path.length === 0);
  if (currentRoot.$_tag === ROOT_TAG || replacesRoot) return root;
  const candidate = root.$_content[0];
  if (is_Node(candidate)) return candidate;
  throw new Error("LiveMap data constructor did not produce a value node.");
}

/**
 * Normalize public `set` into internal write intents.
 *
 * Plain object values at an existing object endpoint become constructive child
 * writes. Other JSON values, arrays, null, root values, and non-object current
 * endpoints stay as direct endpoint `set` writes.
 */
function write_ops_from_set(path: LivePath, value: unknown, currentValue: OrderedProjectedValue | undefined): readonly LiveMapCoreWriteOp[] {
  const projectedValue = must_ordered_projected_value(value, path);

  must_resolved_path("set", path, currentValue);

  if (path.length === 0 || !is_ordered_projected_object(projectedValue)) {
    return [
      { kind: "set", path, value: projectedValue },
    ];
  }

  if (currentValue !== undefined && !is_ordered_projected_object(currentValue)) {
    return [
      { kind: "set", path, value: projectedValue },
    ];
  }

  return [
    {
      kind: "constructive-set",
      path,
      value: projectedValue,
    },
  ];
}

/** Normalize public `setMany` into child-path set writes. */
function write_ops_from_set_many(path: LivePath, values: OrderedProjectedObject, currentValue: OrderedProjectedValue | undefined): readonly LiveMapProjectedSetWriteOp[] {
  must_resolved_object_path("setMany", path, currentValue);

  /** Build the child-path set ops used by sibling-preserving object sets. */
  return values.entries.map(([key, value]) => ({
    kind: "set" as const,
    path: append_live_path(path, key),
    value,
  }));
}

type LiveMapPlannedOps = Readonly<{
  changed: boolean;
  value: OrderedProjectedValue;
  ops: readonly LiveMapDataOp[];
  transportOps: readonly LiveMapProjectedDataOp[];
}>;
function plan_write_ops(
  root: OrderedProjectedValue,
  writeOps: readonly LiveMapCoreWriteOp[],
): LiveMapPlannedOps {
  let candidate = root;
  const transportOps: LiveMapProjectedDataOp[] = [];

  for (const op of writeOps) {
    if (op.kind === "constructive-set") {
      const planned = plan_constructive_set_write_op(candidate, op);
      candidate = planned.value;
      transportOps.push(...planned.ops);
      continue;
    }

    if (op.kind === "splice") {
      const prev = must_resolved_projected_value("set", op.path, ordered_projected_value_at(candidate, op.path));
      const result = ordered_projected_array_splice(candidate, op.path, op.start, op.deleteCount, op.items);
      const next = must_resolved_projected_value("set", op.path, ordered_projected_value_at(result.value, op.path));
      candidate = result.value;
      if (ordered_projected_value_equal(prev, next)) continue;
      transportOps.push(Object.freeze({
        kind: "splice",
        path: clone_live_path(op.path),
        start: op.start,
        removed: result.removed,
        inserted: op.items,
        prev: must_core_array_value(prev, op.path),
        next: must_core_array_value(next, op.path),
      }));
      continue;
    }

    if (op.kind === "rename") {
      const prev = must_core_object_value(ordered_projected_value_at(candidate, op.path), op.path);
      if (!prev.entries.some(([key]) => key === op.from)) {
        throw new LiveMapProjectedMutationError(
          "OBJECT_RENAME_SOURCE_NOT_FOUND",
          "rename",
          op.path,
          `source key ${JSON.stringify(op.from)} is not an own entry`,
        );
      }
      if (op.from === op.to) continue;
      candidate = ordered_projected_object_rename(candidate, op.path, op.from, op.to);
      const next = must_core_object_value(ordered_projected_value_at(candidate, op.path), op.path);
      transportOps.push(Object.freeze({
        kind: "rename",
        path: clone_live_path(op.path),
        from: op.from,
        to: op.to,
        prev,
        next,
      }));
      continue;
    }

    if (op.kind === "move") {
      const prev = must_core_array_value(ordered_projected_value_at(candidate, op.path), op.path);
      must_core_move_index(prev, op.path, op.from, "source");
      must_core_move_index(prev, op.path, op.to, "destination");
      if (op.from === op.to) continue;
      candidate = ordered_projected_array_move(candidate, op.path, op.from, op.to);
      const next = must_core_array_value(ordered_projected_value_at(candidate, op.path), op.path);
      transportOps.push(Object.freeze({
        kind: "move",
        path: clone_live_path(op.path),
        from: op.from,
        to: op.to,
        prev,
        next,
      }));
      continue;
    }

    if (op.kind === "set") {
      const prev = ordered_projected_value_at(candidate, op.path);
      candidate = ordered_projected_value_set(candidate, op.path, op.value);
      if (optional_ordered_projected_value_equal(prev, op.value)) continue;

      transportOps.push(Object.freeze({
        kind: "set",
        path: clone_live_path(op.path),
        prev,
        next: op.value,
      }));
      continue;
    }

    if (op.kind === "replace") {
      const prev = must_resolved_projected_value("replace", op.path, ordered_projected_value_at(candidate, op.path));
      candidate = ordered_projected_value_replace(candidate, op.path, op.value);
      if (ordered_projected_value_equal(prev, op.value)) continue;

      transportOps.push(Object.freeze({
        kind: "replace",
        path: clone_live_path(op.path),
        prev,
        next: op.value,
      }));
      continue;
    }

    const prev = must_resolved_projected_value("delete", op.path, ordered_projected_value_at(candidate, op.path));
    must_plan_projected_delete(candidate, op.path);
    candidate = ordered_projected_value_delete(candidate, op.path);

    transportOps.push(Object.freeze({
      kind: "delete",
      path: clone_live_path(op.path),
      prev,
      next: undefined,
    }));
  }

  const frozenTransportOps = Object.freeze(transportOps);
  return {
    changed: frozenTransportOps.length > 0,
    value: candidate,
    ops: Object.freeze(frozenTransportOps.map(materialize_livemap_projected_op)),
    transportOps: frozenTransportOps,
  };
}

/** Treat equal explicit replacement of an identified subtree as metadata retirement. */
function plan_write_ops_with_identity(
  root: OrderedProjectedValue,
  writeOps: readonly LiveMapCoreWriteOp[],
  overlay: LiveMapProjectedIdentityOverlay,
): LiveMapPlannedOps {
  const planned = plan_write_ops(root, writeOps);
  if (planned.changed) return planned;
  const replacementOps: LiveMapProjectedDataOp[] = [];
  for (const operation of writeOps) {
    if (operation.kind !== "replace"
      || !livemap_projected_identity_has_at_or_below(overlay, operation.path)) continue;
    const previous = ordered_projected_value_at(root, operation.path);
    if (previous === undefined || !ordered_projected_value_equal(previous, operation.value)) continue;
    replacementOps.push(Object.freeze({
      kind: "replace",
      path: clone_live_path(operation.path),
      prev: previous,
      next: operation.value,
    }));
  }
  if (replacementOps.length === 0) return planned;
  const transportOps = Object.freeze(replacementOps);
  return Object.freeze({
    changed: true,
    value: planned.value,
    ops: Object.freeze(transportOps.map(materialize_livemap_projected_op)),
    transportOps,
  });
}

function plan_constructive_set_write_op(
  root: OrderedProjectedValue,
  op: LiveMapConstructiveSetWriteOp,
): Readonly<{ value: OrderedProjectedValue; ops: readonly LiveMapProjectedDataOp[] }> {
  const currentValue = ordered_projected_value_at(root, op.path);
  if (currentValue === undefined) {
    throw new Error(`LiveMap set path does not resolve: ${format_live_path(op.path)}`);
  }
  if (!is_ordered_projected_object(currentValue)) {
    throw new Error(`LiveMap set path is not an object: ${format_live_path(op.path)}`);
  }

  const ops: LiveMapProjectedDataOp[] = [];
  let candidate = root;
  for (const [key, value] of op.value.entries) {
    const childPath = append_live_path(op.path, key);
    const prev = ordered_projected_value_at(candidate, childPath);
    candidate = ordered_projected_value_set(candidate, childPath, value);
    if (optional_ordered_projected_value_equal(prev, value)) continue;

    ops.push(Object.freeze({
      kind: "set",
      path: childPath,
      prev,
      next: value,
    }));
  }

  return Object.freeze({ value: candidate, ops: Object.freeze(ops) });
}

/** Enforce strict resolved-path semantics for endpoint operations. */
function must_resolved_path(action: "delete" | "replace" | "set", path: LivePath, value: OrderedProjectedValue | undefined): void {
  if (path.length === 0 || value !== undefined) return;

  throw new Error(`LiveMap ${action} path does not resolve: ${format_live_path(path)}`);
}

/** Enforce `setMany`'s existing-object endpoint requirement. */
function must_resolved_object_path(action: "setMany", path: LivePath, value: OrderedProjectedValue | undefined): void {
  if (value === undefined) {
    throw new Error(`LiveMap ${action} path does not resolve: ${format_live_path(path)}`);
  }

  if (is_ordered_projected_object(value)) return;

  throw new Error(`LiveMap ${action} path is not an object: ${format_live_path(path)}`);
}

function must_resolved_projected_value(
  action: "delete" | "replace" | "set",
  path: LivePath,
  value: OrderedProjectedValue | undefined,
): OrderedProjectedValue {
  if (value !== undefined) return value;
  throw new Error(`LiveMap ${action} path does not resolve: ${format_live_path(path)}`);
}

function must_plan_projected_delete(root: OrderedProjectedValue, path: LivePath): void {
  if (path.length === 0) {
    throw new Error("LiveMap editor cannot delete the root node yet.");
  }
  const leaf = path[path.length - 1];
  const parent = ordered_projected_value_at(root, path.slice(0, -1));
  if (typeof leaf === "number" && Array.isArray(parent)) {
    throw new Error(`LiveMap editor cannot delete array indexes yet: ${format_live_path(path)}`);
  }
}

/** Compile one already-admitted replay operation into carrier-native planning. */
function projected_write_op_from_transport(op: LiveMapProjectedDataOp): Exclude<LiveMapCoreWriteOp, LiveMapConstructiveSetWriteOp> {
  if (op.kind === "delete") {
    return Object.freeze({ kind: "delete", path: clone_live_path(op.path) });
  }
  if (op.kind === "splice") {
    return Object.freeze({
      kind: "splice",
      path: clone_live_path(op.path),
      start: op.start,
      deleteCount: op.removed.length,
      items: op.inserted,
    });
  }
  if (op.kind === "rename") {
    return Object.freeze({
      kind: op.kind,
      path: clone_live_path(op.path),
      from: op.from,
      to: op.to,
    });
  }
  if (op.kind === "move") {
    return Object.freeze({
      kind: op.kind,
      path: clone_live_path(op.path),
      from: op.from,
      to: op.to,
    });
  }
  return Object.freeze({
    kind: op.kind,
    path: clone_live_path(op.path),
    value: op.next,
  });
}

function write_op_path(op: LiveMapCoreWriteOp | undefined): LivePath {
  if (op === undefined) return [];
  return op.path;
}
