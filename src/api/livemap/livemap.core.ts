// core.ts

import type { HsonNode, JsonValue } from "../../core/types.js";
import type { HsonSchema } from "../transform/transform.types.js";
import { validate_hson_schema_graph } from "../../internal/schema-hson-validation/validate-canonical-hson.js";
import type { ClassifiedLiveMap, LiveMap, LiveMapAnyOp, LiveMapCommit, LiveMapReplay, LiveMapCore, LiveMapCoreSchemaApi, LiveMapCoreSnap, LiveMapFeedListener, LiveMapPathValue, LiveMapStoreApi, LiveMapStorePathListener, LiveMapStoreSelectedListener, LiveMapStoreSubscribeOptions, LiveMapSubApi, LivePath, LiveMapDataOp, LiveMapBatchTx, LiveMapPathHandle, LiveMapCaptureOptions, LiveMapApply, LiveMapGraphCommit, LiveMapProjectedGraphEnsureQuidOp, LiveMapGraphOp, LiveMapGraphReplaceRootOp, LiveMapRootMode } from "../../types/livemap.types.js";
import {
  clone_live_root,
  delete_live_path,
  overwrite_hson_node,
  project_live_path,
  replace_live_path,
  replace_live_path_from_projected,
  resolve_value_node,
  set_live_path,
  set_live_path_from_projected,
  snap_live_path,
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
import {
  is_ordered_projected_object,
  optional_ordered_projected_value_equal,
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
import { assign_hson_node_quid, is_persisted_quid, is_projected_container_quid_eligible, read_hson_node_quid } from "../../core/hson-node-quid.js";
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
  livemap_document_identity_quids,
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
  type LiveMapProjectedIdentityOverlay,
} from "./livemap.projected.identity.js";
import { make_livemap_projected_identity_api, register_livemap_projected_identity_api } from "./livemap.projected.identity-handle.js";
import { capture_livemap_projected, projected_capture_continuity } from "./livemap.projected.capture.js";
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
  type LiveMapIdentityEpochController,
  LiveMapIdentityEpochError,
  make_livemap_identity_epoch,
  register_livemap_identity_epoch_owner,
  retain_livemap_identity_epoch,
  stage_livemap_identity_epoch,
} from "./livemap.identity-epoch.js";
import {
  livemap_library_target,
  make_default_livemap_library,
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

type LiveMapCommitPublisher = (
  commit: LiveMapCommit<LiveMapAnyOp>,
  publishExisting: () => void,
) => void;

type BuiltLiveMapCore = Readonly<{
  core: LiveMapCore<JsonValue | undefined>;
  projected: LiveMapProjectedPropagation;
  document?: LiveMapDocumentInstallController & LiveMapDocumentMutationController & LiveMapDocumentReplayController & InternalDocumentSchemaController;
  transitionController: LiveMapTransitionController;
  aggregateAuthority: InternalLiveMapAggregateAuthority;
  defaultLibrary: () => LiveMapLibraryState;
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



/**
 * Create the first Core facade for a LiveMap graph.
 *
 * Core owns the root Hson node and exposes graph-level operations in projected
 * JSON path terms. It is the layer that coordinates editor mutations, commit
 * generation, feeds, links, batching, and later transport-compatible behavior.
 *
 * `at(path)` is the data data handle. `root()` returns a detached canonical
 * clone. The owned canonical graph is never exposed through the public facade.
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
  const built = make_livemap_core_from_owned_root(prepared);
  register_internal_livemap_owner(built.core, built.currentRoot);
  register_internal_livemap_library_owner(
    built.core,
    built.defaultLibrary,
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
  const built = make_livemap_core_from_owned_root(prepared);
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
    built.defaultLibrary,
    built.mapRevision,
    built.mapIdentityEpoch,
  );
  register_internal_livemap_aggregate_owner(built.core, built.aggregateAuthority);
  register_internal_livemap_library_owner(
    facade,
    built.defaultLibrary,
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
function make_livemap_core_from_owned_root(
  prepared: ReturnType<typeof prepare_livemap_root>,
  initial: Readonly<{
    revision?: number;
    hsonSchema?: HsonSchema;
  }> = {},
): BuiltLiveMapCore {
  const owned = make_default_livemap_library(prepared, initial.hsonSchema);
  const libraryRegistry = make_livemap_library_registry(owned);
  const initialMode = owned.mode;
  if (initialMode !== "document") {
    owned.projectedValue = must_projected_root_value(owned.root);
  }
  // Revision, transition, publication, and QUID identity authority stay on the
  // enclosing LiveMap. A Library owns only graph-local state.
  let mapRevision = initial.revision ?? 0;
  const getProjectedValue = (): OrderedProjectedValue => {
    if (owned.projectedValue === undefined) throw new Error("Data value is unavailable in document mode.");
    return owned.projectedValue;
  };
  const setProjectedValue = (value: OrderedProjectedValue): void => { owned.projectedValue = value; };
  const feedHub = make_livemap_feed_hub();
  const commitObserverHub = make_livemap_commit_observer_hub<LiveMapAnyOp>();
  const projectedWatchHub = make_livemap_watch_hub({
    clonePath: clone_live_path,
    read: (path: LivePath) => project_live_path(owned.root, path),
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
      return read_livemap_document_logical_location(owned.root, initialMode, path);
    },
    equal: optional_livemap_document_endpoint_equal,
    detach: detach_livemap_document_endpoint,
    relevant: () => true,
  });
  // This is deliberately one-per-LiveMap, not one-per-Library. It is the
  // map-wide QUID epoch and issued ledger, even while the active overlay below
  // is graph-local and currently belongs to the default Library.
  const mapIdentityEpoch = make_livemap_identity_epoch(
    prepared.documentOverlay === undefined
      ? livemap_projected_identity_quids(require_projected_overlay(prepared.projectedOverlay))
      : livemap_document_identity_quids(prepared.documentOverlay),
  );
  /** Legacy root replacement resets an identity epoch and is one-library-only. */
  const assert_legacy_identity_epoch_reset_available = (): void => {
    if (libraryRegistry.size() === 1) return;
    throw new Error(
      "Legacy root replacement cannot reset a LiveMap-wide QUID epoch after another internal library is attached.",
    );
  };
  /** Revision zero represents the initial graph before any changed commit. */
  const transitionController = make_livemap_transition_controller(initialMode, () => mapRevision);
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
        root: owned.root,
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
        root: owned.root,
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
    const baseRoot = clone_live_root(owned.root);
    const preparedNext = preparedInput ?? prepare_livemap_root(detachedRoot);
    if (preparedNext.mode !== initialMode) {
      throw new Error(`Prepared LiveMap transition mode mismatch: expected ${initialMode}, observed ${preparedNext.mode}.`);
    }
    if (owned.hsonSchema !== undefined) must_hson_schema_root(owned.hsonSchema, preparedNext.root);
    if ((initialMode === "document")
      ? livemap_document_commit_continuity(commit) === "new-epoch"
      : commit.ops.some((operation) => (
        !("domain" in operation) && operation.kind === "replace" && operation.path.length === 0
      ))) {
      assert_legacy_identity_epoch_reset_available();
    }
    const installsProjectedDelta = initialMode !== "document"
      && require_projected_overlay(owned.projectedOverlay).size === 0
      && require_projected_overlay(preparedNext.projectedOverlay).size === 0
      && commit.ops.every((operation) => !("domain" in operation))
      && !commit.ops.some((operation) => (
        !("domain" in operation) && operation.kind === "replace" && operation.path.length === 0
      ));
    return transitionController.prepare({
      commit,
      baseStillCurrent: () => mapRevision === commit.prevRev && canonical_graph_equal(owned.root, baseRoot),
      install: () => {
        if (initialMode === "document") {
          const continuity = livemap_document_commit_continuity(commit);
          if (continuity === "new-epoch") {
            mapIdentityEpoch.replace(livemap_document_identity_quids(
              require_document_overlay(preparedNext.documentOverlay),
            ));
          } else if (continuity === "same-epoch") {
            mapIdentityEpoch.install(retain_livemap_identity_epoch(
              mapIdentityEpoch.issued(),
              livemap_document_identity_quids(require_document_overlay(preparedNext.documentOverlay)),
            ));
          } else {
            mapIdentityEpoch.install(stage_livemap_identity_epoch(
              mapIdentityEpoch.issued(),
              livemap_document_identity_quids(require_document_overlay(owned.documentOverlay)),
              livemap_document_identity_quids(require_document_overlay(preparedNext.documentOverlay)),
            ));
          }
          Object.assign(owned, {
            root: preparedNext.root,
            documentOverlay: preparedNext.documentOverlay,
            projectedOverlay: undefined,
          });
          mapRevision = commit.rev;
        } else if (installsProjectedDelta) {
          apply_materialized_projected_ops(owned.root, commit.ops as readonly LiveMapDataOp[]);
          owned.projectedValue = must_projected_root_value(preparedNext.root);
          mapRevision = commit.rev;
        } else {
          if (commit.ops.some((operation) => (
            !("domain" in operation)
            && operation.kind === "replace"
            && operation.path.length === 0
          ))) {
            mapIdentityEpoch.replace(livemap_projected_identity_quids(
              require_projected_overlay(preparedNext.projectedOverlay),
            ));
          } else {
            mapIdentityEpoch.install(stage_livemap_identity_epoch(
              mapIdentityEpoch.issued(),
              livemap_projected_identity_quids(require_projected_overlay(owned.projectedOverlay)),
              livemap_projected_identity_quids(require_projected_overlay(preparedNext.projectedOverlay)),
            ));
          }
          overwrite_hson_node(owned.root, preparedNext.root);
          owned.projectedValue = must_projected_root_value(preparedNext.root);
          owned.projectedOverlay = preparedNext.projectedOverlay;
          mapRevision = commit.rev;
        }
      },
      notify: (acceptedCommit) => {
        publishCommitWithWatch(acceptedCommit, () => {
          if (initialMode === "document") {
            commitObserverHub.emitCommit(acceptedCommit, "authoritative");
          } else {
            feedHub.emitProjected(acceptedCommit as LiveMapCommit<LiveMapDataOp>, (path) => project_live_path(owned.root, path));
            commitObserverHub.emitCommit(acceptedCommit, "authoritative");
          }
        });
      },
    });
  }

  function useDocumentSchema(schema: HsonSchema): void {
    if (owned.hsonSchema === schema) return;
    if (owned.hsonSchema !== undefined) {
      throw new Error("LiveMap document schema contract is already attached and cannot be replaced.");
    }
    transitionController.assertPublicMutationAllowed();
    if (initialMode !== "document") {
      throw new TypeError("Document schema attachment is unavailable in data mode.");
    }
    must_hson_schema_root(schema, owned.root);
    owned.hsonSchema = schema;
    transitionController.invalidate();
  }
  let storeApi: LiveMapStoreApi<JsonValue | undefined> | undefined;
  const commitOps = (
    writeOps: readonly LiveMapCoreWriteOp[],
    origin: "authoritative" | "replay" = "authoritative",
  ): LiveMapCommit => {
    transitionController.assertPublicMutationAllowed();
    if (writeOps.some((operation) => operation.kind === "replace" && operation.path.length === 0)) {
      assert_legacy_identity_epoch_reset_available();
    }
    if (origin === "replay") {
      transitionController.invalidate();
      return apply_replay_ops(
        owned.root,
        getProjectedValue,
        setProjectedValue,
        owned.hsonSchema,
        feedHub,
        () => mapRevision,
        (revision) => { mapRevision = revision; },
        writeOps,
        commitObserverHub,
        publishCommitWithWatch,
        require_projected_overlay(owned.projectedOverlay),
        (overlay) => { owned.projectedOverlay = overlay; },
        mapIdentityEpoch,
      );
    }
    const transition = prepare_projected_transition(
      owned.root,
      getProjectedValue,
      setProjectedValue,
      owned.hsonSchema,
      feedHub,
      () => mapRevision,
      (revision) => { mapRevision = revision; },
      writeOps,
      commitObserverHub,
      publishCommitWithWatch,
      transitionController,
      require_projected_overlay(owned.projectedOverlay),
      (overlay) => { owned.projectedOverlay = overlay; },
      mapIdentityEpoch,
    );
    return transitionController.accept(transition, "legacy").commit as LiveMapCommit;
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
    get: () => owned.hsonSchema,

    use: ((schema: HsonSchema) => {
      if (owned.hsonSchema === schema) return core;
      if (owned.hsonSchema !== undefined) {
        throw new Error("LiveMap data schema contract is already attached and cannot be replaced.");
      }
      transitionController.assertPublicMutationAllowed();
      must_hson_schema_root(schema, owned.root);
      owned.hsonSchema = schema;
      transitionController.invalidate();
      return core;
    }) as LiveMapCoreSchemaApi<JsonValue | undefined>["use"],
  });

  const applyProjectedIdentityTransition = (
    nextRoot: HsonNode,
    nextOverlay: LiveMapProjectedIdentityOverlay,
    operation: LiveMapProjectedGraphEnsureQuidOp,
    origin: "authoritative" | "replay" = "authoritative",
  ): LiveMapGraphCommit<LiveMapProjectedGraphEnsureQuidOp> => {
    transitionController.assertPublicMutationAllowed();
    if (initialMode === "document") {
      throw new Error("Data identity acquisition is unavailable in document mode.");
    }
    const prevRev = mapRevision;
    const commit: LiveMapGraphCommit<LiveMapProjectedGraphEnsureQuidOp> = Object.freeze({
      changed: true,
      prevRev,
      rev: prevRev + 1,
      ops: Object.freeze([operation]),
    });
    const nextLedger = stage_livemap_identity_epoch(
      mapIdentityEpoch.issued(),
      livemap_projected_identity_quids(require_projected_overlay(owned.projectedOverlay)),
      livemap_projected_identity_quids(nextOverlay),
    );
    const transition = transitionController.prepare({
      commit,
      baseStillCurrent: () => mapRevision === prevRev,
      install: () => {
        mapIdentityEpoch.install(nextLedger);
        overwrite_hson_node(owned.root, nextRoot);
        owned.projectedOverlay = nextOverlay;
        mapRevision = commit.rev;
      },
      notify: (acceptedCommit) => publishCommitWithWatch(
        acceptedCommit,
        () => commitObserverHub.emitCommit(acceptedCommit, origin),
      ),
    });
    return transitionController.accept(transition, "legacy").commit as LiveMapGraphCommit<LiveMapProjectedGraphEnsureQuidOp>;
  };

  let core: LiveMapCore<JsonValue | undefined>;
  const projectedIdentityApi = make_livemap_projected_identity_api(
    () => core,
    Object.freeze({
      root: () => owned.root,
      overlay: () => require_projected_overlay(owned.projectedOverlay),
      identityEpoch: mapIdentityEpoch,
      applyIdentity: applyProjectedIdentityTransition,
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
      const nextRoot = clone_live_root(owned.root);
      const endpoint = resolve_value_node(nextRoot, path);
      if (endpoint === undefined || !is_projected_container_quid_eligible(endpoint)) {
        throw new LiveMapProjectedIdentityError(
          "PROJECTED_IDENTITY_INELIGIBLE",
          path,
          "replay target is ineligible",
        );
      }
      if (read_hson_node_quid(endpoint) !== undefined) {
        throw new LiveMapProjectedIdentityError(
          "PROJECTED_IDENTITY_COLLISION",
          path,
          "replay target already carries a QUID",
        );
      }
      if (require_projected_overlay(owned.projectedOverlay).pathForQuid(operation.quid) !== undefined) {
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
      assign_hson_node_quid(endpoint, operation.quid);
      const nextOverlay = register_livemap_projected_identity_at_path(
        require_projected_overlay(owned.projectedOverlay),
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
    return commitOps(replay_write_ops(owned.root, normalized.ops), "replay");
  }

  core = {
    /** Root capability selected during detached canonical construction. */
    mode: initialMode,
    /** Return a detached structural clone of the root owned by this map core. */
    root: () => clone_live_root(owned.root),

    /** Read the current projected JSON value at a path, or the whole graph. */
    snap: ((path: LivePath = []) => snap_live_path(owned.root, must_live_path(path))) as LiveMapCoreSnap<JsonValue | undefined>,

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
          project_live_path(owned.root, livePath),
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
          project_live_path(owned.root, livePath),
        ),
      );
    },

    /** Apply one semantic array splice and preserve it in the resulting commit. */
    splice: (path, start, deleteCount, ...items) => {
      const livePath = must_live_path(path);
      const currentValue = project_live_path(owned.root, livePath);
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
      must_resolved_path("replace", op.path, project_live_path(owned.root, op.path));
      return commitOps([op]);
    },

    /** Delete a data object-property path, emit the resulting commit, and return it. */
    delete: (path) => {
      const livePath = must_live_path(path);
      must_resolved_path("delete", livePath, project_live_path(owned.root, livePath));
      return commitOps([
        { kind: "delete", path: livePath },
      ]);
    },

    /** Explicit synchronous transaction grouping, not automatic notification coalescing. */
    batch: (fn) => {
      transitionController.assertPublicMutationAllowed();
      const writeOps: LiveMapCoreWriteOp[] = [];
      let isOpen = true;
      const tx = make_batch_tx(owned.root, writeOps, () => isOpen);

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
      const projected = must_projected_root_value(owned.root);
      return capture_livemap_projected(
        mapIdentityEpoch,
        mapRevision,
        owned.root,
        projected,
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
      const planned = plan_write_ops(must_projected_root_value(owned.root), [operation]);
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
      if (owned.hsonSchema !== undefined) must_hson_schema_root(owned.hsonSchema, preparedCandidate.root);
      const continuity = projected_capture_continuity(mapIdentityEpoch, capture as object, options);
      const restoredQuids = livemap_projected_identity_quids(
        require_projected_overlay(preparedCandidate.projectedOverlay),
      );
      if (continuity === "new-epoch") {
        mapIdentityEpoch.replace(restoredQuids);
      } else {
        mapIdentityEpoch.install(retain_livemap_identity_epoch(
          mapIdentityEpoch.issued(),
          restoredQuids,
        ));
      }
      Object.assign(owned, {
        root: preparedCandidate.root,
        documentOverlay: undefined,
        projectedOverlay: preparedCandidate.projectedOverlay,
      });
      mapRevision = normalized.rev;
      owned.projectedValue = planned.value;
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
    read: (path) => project_live_path(owned.root, path),
    feed: (path, listener) => feedHub.addProjected(path, listener),
    commit: (ops: readonly LiveMapProjectedPropagationWrite[]) => commitOps(ops),
  });


  function get_path_handle(path: LivePath): LiveMapPathHandle {
    const handlePath = must_live_path(path);
    const target = livemap_library_target(owned, handlePath);
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
    nextRoot?: HsonNode;
  };
  type AggregateDocumentCandidate = {
    readonly library: LiveMapLibraryState;
    readonly baseRoot: HsonNode;
    root: HsonNode;
    overlay: import("./livemap.document.identity.js").LiveMapDocumentIdentityOverlay;
    operations: LiveMapGraphOp[];
    identityEffects: LiveMapDocumentIdentityEffect[];
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
  const documentCommitByAggregate = new WeakMap<LiveMapAggregateCommit, Map<LiveMapLibraryIdentity, LiveMapGraphCommit>>();
  const aggregateByDocumentCommit = new WeakMap<LiveMapGraphCommit, LiveMapAggregateCommit>();

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
    write: Exclude<LiveMapAggregateWrite, { kind: "ensure-quid" }>,
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
    return [Object.freeze({ kind: "delete" as const, path })];
  }

  function prepare_aggregate_transition(
    writes: readonly LiveMapAggregateWrite[],
  ): import("./livemap.authority.js").PreparedLiveMapAggregateTransition {
    transitionController.assertPublicMutationAllowed();
    const prevRev = mapRevision;
    const candidates = new Map<LiveMapLibraryIdentity, AggregateCandidate>();
    const operations: LiveMapAggregateOperation[] = [];
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

    for (const write of writes) {
      const library = require_library(write.target.library);
      const target = aggregate_target(library.identity, write.target.path);
      const candidate = candidate_for(library.identity);
      if (write.kind === "graph") {
        if (!is_aggregate_document_candidate(candidate)) {
          throw new Error("Aggregate graph operations require a document library.");
        }
        const planned = prepare_document_graph_operation(
          candidate.root,
          "document",
          write.operation,
          candidate.overlay,
        );
        if (!canonical_graph_equal(candidate.root, planned.root)) {
          candidate.root = planned.root;
          candidate.overlay = planned.overlay;
          candidate.operations.push(planned.operation);
          candidate.identityEffects.push(...planned.identityEffects);
          operations.push(Object.freeze({
            target: aggregate_target(library.identity, document_operation_path(planned.operation)),
            operation: planned.operation,
          }));
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
        if (endpoint === undefined || !is_projected_container_quid_eligible(endpoint)) {
          throw new Error("Aggregate QUID registration target is ineligible.");
        }
        const existing = read_hson_node_quid(endpoint);
        if (existing === write.quid) continue;
        if (existing !== undefined || candidate.overlay.pathForQuid(write.quid) !== undefined) {
          throw new Error("Aggregate QUID registration collides with an active library claim.");
        }
        assign_hson_node_quid(endpoint, write.quid);
        candidate.overlay = register_livemap_projected_identity_at_path(candidate.overlay, write.quid, target.path);
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
      const localWrites = aggregate_write_ops(write, candidate.value);
      const planned = plan_write_ops_with_identity(candidate.value, localWrites, candidate.overlay);
      candidate.value = planned.value;
      candidate.writes.push(...localWrites);
      candidate.overlay = reconcile_livemap_projected_identity_overlay(candidate.overlay, planned.transportOps);
      for (const operation of planned.ops) {
        operations.push(Object.freeze({ target: aggregate_target(library.identity, operation.path), operation }));
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

    const beforeActive = aggregate_quid_locations(libraryRegistry.all());
    const afterStates = libraryRegistry.all().map((library) => {
      const candidate = candidates.get(library.identity);
      if (candidate === undefined) return library;
      return {
        ...library,
        ...(is_aggregate_document_candidate(candidate)
          ? { root: candidate.root, documentOverlay: candidate.overlay, projectedOverlay: undefined, projectedValue: undefined }
          : { root: candidate.nextRoot ?? library.root, documentOverlay: undefined, projectedOverlay: candidate.overlay, projectedValue: candidate.value }),
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
    const nextLedger = stage_livemap_identity_epoch(
      mapIdentityEpoch.issued(),
      beforeActive.keys(),
      afterActive.keys(),
    );
    const changed = operations.length > 0;
    const commit: LiveMapAggregateCommit = Object.freeze({
      kind: "aggregate",
      changed,
      prevRev,
      rev: changed ? prevRev + 1 : prevRev,
      operations: Object.freeze(operations),
    });
    const documentCommits = new Map<LiveMapLibraryIdentity, LiveMapGraphCommit>();
    for (const candidate of candidates.values()) {
      if (!is_aggregate_document_candidate(candidate) || candidate.operations.length === 0) continue;
      const documentCommit: LiveMapGraphCommit = Object.freeze({
        changed,
        prevRev,
        rev: commit.rev,
        ops: Object.freeze([...candidate.operations]),
      });
      register_livemap_document_identity_effects(documentCommit, candidate.identityEffects);
      documentCommits.set(candidate.library.identity, documentCommit);
      aggregateByDocumentCommit.set(documentCommit, commit);
    }
    if (documentCommits.size > 0) documentCommitByAggregate.set(commit, documentCommits);
    return transitionController.prepareAggregate({
      commit,
      libraryModes: Object.freeze([...candidates.values()].map((candidate) => candidate.library.mode)),
      baseStillCurrent: () => mapRevision === prevRev
        && [...candidates.values()].every((candidate) => canonical_graph_equal(candidate.library.root, candidate.baseRoot)),
      install: () => {
        mapIdentityEpoch.install(nextLedger);
        for (const candidate of candidates.values()) {
          if (is_aggregate_document_candidate(candidate)) {
            Object.assign(candidate.library, {
              root: candidate.root,
              documentOverlay: candidate.overlay,
              projectedOverlay: undefined,
              projectedValue: undefined,
            });
          } else {
            const nextRoot = candidate.nextRoot;
            if (nextRoot === undefined) throw new Error("Aggregate candidate root is unavailable.");
            Object.assign(candidate.library, {
              root: nextRoot,
              documentOverlay: undefined,
              projectedOverlay: candidate.overlay,
              projectedValue: candidate.value,
            });
          }
        }
        mapRevision = commit.rev;
      },
      notify: (acceptedCommit) => {
        enqueuePublication(() => {
          aggregateAcceptedTransitions += 1;
          aggregatePublications += 1;
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
    transitionController.assertPublicMutationAllowed();
    const library = require_library(libraryIdentity);
    if (library.mode !== "document" || library.documentOverlay === undefined) {
      throw new Error("Aggregate document mutation requires one document library.");
    }
    if (library.hsonSchema !== undefined) must_hson_schema_root(library.hsonSchema, candidate.root);

    let nextLedger;
    const beforeActive = aggregate_quid_locations(libraryRegistry.all());
    const afterStates = libraryRegistry.all().map((current) => current.identity === library.identity
      ? { ...current, root: candidate.root, documentOverlay: candidate.overlay, projectedOverlay: undefined }
      : current);
    const afterActive = aggregate_quid_locations(afterStates);
    for (const [quid, beforeTarget] of beforeActive) {
      const afterTarget = afterActive.get(quid);
      if (afterTarget !== undefined && afterTarget.library !== beforeTarget.library) {
        throw new Error("Cross-library QUID movement requires an explicit LiveMap transfer semantic.");
      }
    }
    try {
      nextLedger = stage_livemap_identity_epoch(
        mapIdentityEpoch.issued(),
        beforeActive.keys(),
        afterActive.keys(),
      );
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

    const prevRev = mapRevision;
    const changed = !canonical_graph_equal(library.root, candidate.root);
    const documentCommit: LiveMapGraphCommit<TOp> = changed
      ? Object.freeze({
        changed: true,
        prevRev,
        rev: prevRev + 1,
        ops: Object.freeze([candidate.operation]),
      })
      : Object.freeze({ changed: false, prevRev, rev: prevRev, ops: Object.freeze([]) });
    if (changed) {
      register_livemap_document_identity_candidate_commit(candidate, documentCommit);
      register_livemap_document_identity_effects(documentCommit, candidate.identityEffects);
    }
    const aggregateCommit: LiveMapAggregateCommit = Object.freeze({
      kind: "aggregate",
      changed,
      prevRev,
      rev: documentCommit.rev,
      operations: changed
        ? Object.freeze([Object.freeze({
          target: aggregate_target(library.identity, document_operation_path(candidate.operation)),
          operation: candidate.operation,
        })])
        : Object.freeze([]),
    });
    if (changed) {
      documentCommitByAggregate.set(aggregateCommit, new Map([[library.identity, documentCommit]]));
      aggregateByDocumentCommit.set(documentCommit, aggregateCommit);
    }
    const baseRoot = clone_live_root(library.root);
    const transition = transitionController.prepareAggregate({
      commit: aggregateCommit,
      libraryModes: Object.freeze([library.mode]),
      baseStillCurrent: () => mapRevision === prevRev && canonical_graph_equal(library.root, baseRoot),
      install: () => {
        mapIdentityEpoch.install(nextLedger);
        Object.assign(library, {
          root: candidate.root,
          documentOverlay: candidate.overlay,
          projectedOverlay: undefined,
          projectedValue: undefined,
        });
        mapRevision = aggregateCommit.rev;
      },
      notify: (acceptedCommit) => {
        enqueuePublication(() => {
          aggregateAcceptedTransitions += 1;
          aggregatePublications += 1;
          for (const observer of [...aggregateObservers]) observer(acceptedCommit);
        });
      },
    });
    transitionController.acceptAggregate(transition);
    return documentCommit;
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

  const aggregateAuthority: InternalLiveMapAggregateAuthority = Object.freeze({
    defaultLibrary: () => owned.identity,
    libraries: () => Object.freeze(libraryRegistry.all().map((library) => library.identity)),
    addLibrary: (root, options) => {
      transitionController.assertPublicMutationAllowed();
      if (mapRevision !== 0) {
        throw new Error("Internal libraries may be attached only before the LiveMap accepts a transition.");
      }
      const preparedLibrary = prepare_livemap_root(root);
      if (options?.hsonSchema !== undefined) must_hson_schema_root(options.hsonSchema, preparedLibrary.root);
      const library = make_livemap_library(preparedLibrary, options?.hsonSchema);
      if (library.mode !== "document") {
        library.projectedValue = must_projected_root_value(library.root);
      }
      const beforeActive = aggregate_quid_locations(libraryRegistry.all());
      const afterActive = aggregate_quid_locations([...libraryRegistry.all(), library]);
      const nextLedger = stage_livemap_identity_epoch(
        mapIdentityEpoch.issued(),
        beforeActive.keys(),
        afterActive.keys(),
      );
      mapIdentityEpoch.install(nextLedger);
      libraryRegistry.add(library);
      return library.identity;
    },
    target: aggregate_target,
    root: (library) => require_library(library).root,
    documentOverlay: (library) => {
      const overlay = require_library(library).documentOverlay;
      if (overlay === undefined) throw new Error("Selected LiveMap library is not a document library.");
      return overlay;
    },
    identityEpoch: () => mapIdentityEpoch,
    snap: aggregate_snap,
    handle: make_internal_path_authority,
    resolveQuid: (quid) => aggregate_quid_locations(libraryRegistry.all()).get(quid),
    prepare: prepare_aggregate_transition,
    accept: transitionController.acceptAggregate,
    discard: transitionController.discardAggregate,
    commit: (writes) => transitionController.acceptAggregate(prepare_aggregate_transition(writes)).commit,
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
      defaultLibrary: () => owned,
      mapRevision: () => mapRevision,
      mapIdentityEpoch,
      currentRoot: () => owned.root,
      currentHsonSchema: () => owned.hsonSchema,
      currentPreparedRoot: () => ({
        root: owned.root,
        mode: initialMode,
        projectedOverlay: require_projected_overlay(owned.projectedOverlay),
      }),
      watchDocument: documentWatchHub.add,
      prepareDetachedCommit,
      prepareProjectedWriteOps: (writeOps) => {
        if (writeOps.some((operation) => operation.kind === "replace" && operation.path.length === 0)) {
          assert_legacy_identity_epoch_reset_available();
        }
        return prepare_projected_transition(
          owned.root,
          getProjectedValue,
          setProjectedValue,
          owned.hsonSchema,
          feedHub,
          () => mapRevision,
          (revision) => { mapRevision = revision; },
          writeOps,
          commitObserverHub,
          publishCommitWithWatch,
          transitionController,
          require_projected_overlay(owned.projectedOverlay),
          (overlay) => { owned.projectedOverlay = overlay; },
          mapIdentityEpoch,
        );
      },
      prepareProjectedBatch: (fn) => {
        const writeOps: LiveMapCoreWriteOp[] = [];
        let open = true;
        try { fn(make_batch_tx_from_candidate(getProjectedValue(), writeOps, () => open)); }
        finally { open = false; }
        if (writeOps.some((operation) => operation.kind === "replace" && operation.path.length === 0)) {
          assert_legacy_identity_epoch_reset_available();
        }
        return prepare_projected_transition(
          owned.root,
          getProjectedValue,
          setProjectedValue,
          owned.hsonSchema,
          feedHub,
          () => mapRevision,
          (revision) => { mapRevision = revision; },
          writeOps,
          commitObserverHub,
          publishCommitWithWatch,
          transitionController,
          require_projected_overlay(owned.projectedOverlay),
          (overlay) => { owned.projectedOverlay = overlay; },
          mapIdentityEpoch,
        );
      },
    };
  }

  const document: LiveMapDocumentInstallController & LiveMapDocumentMutationController & LiveMapDocumentReplayController & InternalDocumentSchemaController = {
    mode: initialMode,
    rev: () => mapRevision,
    root: () => owned.root,
    overlay: () => {
      const identity = owned.documentOverlay;
      if (identity === undefined) {
        throw new Error(`LiveMap document mode ${initialMode} has no identity overlay.`);
      }
      return identity;
    },
    commits: Object.freeze({ observe: commitObserverHub.observe }),
    identityEpoch: mapIdentityEpoch,
    getDocumentSchema: () => owned.hsonSchema,
    useDocumentSchema,
    apply: (
      candidate: PreparedDocumentInstall,
      continuity: "same-epoch" | "new-epoch",
    ): LiveMapGraphCommit<LiveMapGraphReplaceRootOp> => {
      transitionController.assertPublicMutationAllowed();
      if (owned.hsonSchema !== undefined) must_hson_schema_root(owned.hsonSchema, candidate.root);
      const prevRev = mapRevision;
      const unchanged = canonical_graph_equal(owned.root, candidate.root);
      const commit: LiveMapGraphCommit<LiveMapGraphReplaceRootOp> = unchanged
        ? Object.freeze({ changed: false, prevRev, rev: prevRev, ops: Object.freeze([]) })
        : Object.freeze({
          changed: true,
          prevRev,
          rev: prevRev + 1,
          ops: Object.freeze([Object.freeze({
            domain: "graph",
            op: "replace-root",
            mode: candidate.mode,
            root: clone_live_root(candidate.root),
          })]),
        });
      if (commit.changed) {
        register_livemap_document_commit_continuity(commit, continuity);
        if (continuity === "new-epoch") assert_legacy_identity_epoch_reset_available();
        const currentOverlay = owned.documentOverlay;
        if (currentOverlay === undefined) throw new Error("LiveMap document identity overlay is unavailable.");
        register_livemap_document_identity_effects(
          commit,
          replace_livemap_document_identity_overlay_effects(currentOverlay, candidate.overlay),
        );
      }
      const candidateQuids = livemap_document_identity_quids(candidate.overlay);
      const retainedLedger = continuity === "same-epoch"
        ? retain_livemap_identity_epoch(mapIdentityEpoch.issued(), candidateQuids)
        : undefined;
      const transition = prepare_document_transition(
        owned.root,
        commit,
        transitionController,
        () => {
          if (continuity === "new-epoch") mapIdentityEpoch.replace(candidateQuids);
          else if (retainedLedger !== undefined) mapIdentityEpoch.install(retainedLedger);
          Object.assign(owned, {
            root: candidate.root,
            documentOverlay: candidate.overlay,
            projectedOverlay: undefined,
          });
          mapRevision = commit.rev;
        },
        (acceptedCommit) => publishCommitWithWatch(
          acceptedCommit,
          () => commitObserverHub.emitCommit(acceptedCommit, "authoritative"),
        ),
      );
      return transitionController.accept(transition, "legacy").commit as LiveMapGraphCommit<LiveMapGraphReplaceRootOp>;
    },
    restore: (
      candidate: PreparedDocumentInstall,
      revision: number,
      continuity: "same-epoch" | "new-epoch",
    ): void => {
      transitionController.assertPublicMutationAllowed();
      if (owned.hsonSchema !== undefined) must_hson_schema_root(owned.hsonSchema, candidate.root);
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
      Object.assign(owned, {
        root: candidate.root,
        documentOverlay: candidate.overlay,
        projectedOverlay: undefined,
      });
      mapRevision = revision;
      transitionController.invalidate();
      publishSnapshotWithWatch(revision, continuity);
    },
    applyMutation: <TOp extends LiveMapGraphOp>(candidate: PreparedDocumentMutation<TOp>): LiveMapGraphCommit<TOp> => {
      transitionController.assertPublicMutationAllowed();
      if (owned.hsonSchema !== undefined) must_hson_schema_root(owned.hsonSchema, candidate.root);
      let nextLedger;
      try {
        nextLedger = stage_livemap_identity_epoch(
          mapIdentityEpoch.issued(),
          livemap_document_identity_quids(require_document_overlay(owned.documentOverlay)),
          livemap_document_identity_quids(candidate.overlay),
        );
      } catch (cause) {
        if (cause instanceof LiveMapIdentityEpochError && cause.code === "SAME_EPOCH_QUID_REUSE") {
          throw new LiveMapDocumentMutationError(
            "DOCUMENT_IDENTITY_REUSE",
            candidate.operation.op,
            "a retired QUID cannot identify unrelated content in the same owner epoch",
            { cause },
          );
        }
        throw cause;
      }
      const prevRev = mapRevision;
      const unchanged = canonical_graph_equal(owned.root, candidate.root);
      const rev = unchanged ? prevRev : prevRev + 1;
      const commit: LiveMapGraphCommit<TOp> = unchanged
        ? Object.freeze({ changed: false, prevRev, rev, ops: Object.freeze([]) })
        : Object.freeze({
          changed: true,
          prevRev,
          rev,
          ops: Object.freeze([candidate.operation]),
        });
      register_livemap_document_identity_candidate_commit(candidate, commit);
      if (commit.changed) register_livemap_document_identity_effects(commit, candidate.identityEffects);
      const transition = prepare_document_transition(
        owned.root,
        commit,
        transitionController,
        () => {
          mapIdentityEpoch.install(nextLedger);
          Object.assign(owned, {
            root: candidate.root,
            documentOverlay: candidate.overlay,
            projectedOverlay: undefined,
          });
          mapRevision = rev;
        },
        (acceptedCommit) => publishCommitWithWatch(
          acceptedCommit,
          () => commitObserverHub.emitCommit(acceptedCommit, "authoritative"),
        ),
      );
      return transitionController.accept(transition, "legacy").commit as LiveMapGraphCommit<TOp>;
    },
    applyReplay: (candidate: PreparedDocumentReplay): LiveMapGraphCommit => {
      transitionController.assertPublicMutationAllowed();
      if (owned.hsonSchema !== undefined) must_hson_schema_root(owned.hsonSchema, candidate.root);
      register_livemap_document_identity_effects(candidate.commit, candidate.identityEffects);
      if (candidate.commit.ops[0]?.op === "replace-root") {
        assert_legacy_identity_epoch_reset_available();
        mapIdentityEpoch.replace(livemap_document_identity_quids(candidate.overlay));
      } else {
        mapIdentityEpoch.install(candidate.issuedLedger);
      }
      Object.assign(owned, {
        root: candidate.root,
        documentOverlay: candidate.overlay,
        projectedOverlay: undefined,
      });
      mapRevision = candidate.commit.rev;
      transitionController.invalidate();
      publishCommitWithWatch(
        candidate.commit,
        () => commitObserverHub.emitCommit(candidate.commit, "replay"),
      );
      return candidate.commit;
    },
  };

  return {
    core,
    projected,
    document,
    transitionController,
    aggregateAuthority,
    defaultLibrary: () => owned,
    mapRevision: () => mapRevision,
    mapIdentityEpoch,
    currentRoot: () => owned.root,
    currentHsonSchema: () => owned.hsonSchema,
    currentPreparedRoot: () => ({
      root: owned.root,
      mode: initialMode,
      ...(owned.documentOverlay === undefined ? {} : { documentOverlay: owned.documentOverlay }),
      ...(owned.projectedOverlay === undefined ? {} : { projectedOverlay: owned.projectedOverlay }),
    }),
    watchDocument: documentWatchHub.add,
    prepareDetachedCommit,
    prepareProjectedWriteOps: (writeOps) => {
      if (initialMode === "document") {
        throw new LiveMapTransitionError(
          "LIVEMAP_TRANSITION_INVALID",
          "Projected staged write operations are unavailable for document maps.",
        );
      }
      return prepare_projected_transition(
        owned.root,
        getProjectedValue,
        setProjectedValue,
        owned.hsonSchema,
        feedHub,
        () => mapRevision,
        (revision) => { mapRevision = revision; },
        writeOps,
        commitObserverHub,
        publishCommitWithWatch,
        transitionController,
        require_projected_overlay(owned.projectedOverlay),
        (overlay) => { owned.projectedOverlay = overlay; },
        mapIdentityEpoch,
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
  register_livemap_staged_authority(map, Object.freeze({
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
        const draftBuilt = make_livemap_core_from_owned_root(preparedDraft, {
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
              fastTransition = built.prepareProjectedBatch(fn);
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

      return built.prepareDetachedCommit(
        result,
        detached.draftBuilt.currentRoot(),
        detached.draftBuilt.currentPreparedRoot(),
      );
    },
    accept: built.transitionController.accept,
    discard: built.transitionController.discard,
    claimManagement(owner, schedule): void {
      built.transitionController.claimManagement(
        owner,
        schedule as unknown as (mutation: (draft: object) => LiveMapCommit<LiveMapAnyOp>) => Promise<LiveMapCommit<LiveMapAnyOp>>,
      );
      try {
        const currentMode = classify_live_root_mode(built.currentRoot());
        if (currentMode !== built.core.mode) {
          throw new Error(
            `LiveMap canonical root mode changed outside governed mutation: expected ${built.core.mode}, observed ${currentMode}.`,
          );
        }
      } catch (cause) {
        built.transitionController.releaseManagement(owner);
        throw cause;
      }
    },
    releaseManagement: built.transitionController.releaseManagement,
    scheduleManaged: (mutation) => built.transitionController.scheduleManaged(
      mutation as (draft: object) => LiveMapCommit<LiveMapAnyOp>,
    ),
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
  if (Object.hasOwn(input, "formatVersion") || Object.hasOwn(input, "value")) {
    throw new LiveMapProjectedTransportError("restore", "capture is not the canonical structural representation");
  }
  if (!has_projected_transport_field(input)) {
    throw new LiveMapProjectedTransportError("restore", "capture is missing structural transport");
  }
  if (!Object.hasOwn(input, "root") || !is_Node(input.root)) {
    throw new LiveMapProjectedTransportError("restore", "canonical root is not an Hson node");
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
  if (Object.hasOwn(input, "formatVersion") || Object.hasOwn(input, "value")) {
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

/** Apply accepted data data operations without rebuilding unaffected graph branches. */
function apply_materialized_projected_ops(
  root: HsonNode,
  operations: readonly LiveMapDataOp[],
): void {
  for (const operation of operations) {
    if (operation.kind === "delete") {
      delete_live_path(root, operation.path);
    } else if (operation.kind === "set") {
      if (operation.next === undefined) throw new Error("Projected set operation is missing its next value.");
      set_live_path(root, operation.path, operation.next);
    } else {
      if (operation.next === undefined) throw new Error("Data operation is missing its next value.");
      replace_live_path(root, operation.path, operation.next);
    }
  }
}

/** Apply already-admitted transition operations to only their addressed graph branches. */
function apply_projected_transport_ops(
  root: HsonNode,
  operations: readonly LiveMapProjectedDataOp[],
): void {
  for (const operation of operations) {
    if (operation.kind === "delete") {
      delete_live_path(root, operation.path);
    } else if (operation.kind === "set") {
      set_live_path_from_projected(root, operation.path, operation.next);
    } else {
      replace_live_path_from_projected(root, operation.path, operation.next);
    }
  }
}


/** Prepare one exact projected transition entirely against detached state. */
function prepare_projected_transition(
  root: HsonNode,
  getProjectedValue: () => OrderedProjectedValue,
  setProjectedValue: (value: OrderedProjectedValue) => void,
  hsonSchema: HsonSchema | undefined,
  feedHub: ReturnType<typeof make_livemap_feed_hub>,
  getRev: () => number,
  setRev: (rev: number) => void,
  writeOps: readonly LiveMapCoreWriteOp[],
  commitObserverHub: ReturnType<typeof make_livemap_commit_observer_hub<LiveMapAnyOp>>,
  publishCommit: LiveMapCommitPublisher,
  transitionController: LiveMapTransitionController,
  currentOverlay: LiveMapProjectedIdentityOverlay,
  setOverlay: (overlay: LiveMapProjectedIdentityOverlay) => void,
  identityEpoch: LiveMapIdentityEpochController,
): PreparedLiveMapTransition {
  const planned = plan_write_ops_with_identity(
    getProjectedValue(),
    writeOps,
    currentOverlay,
  );
  must_hson_schema_projected_candidate(hsonSchema, planned.value);
  const nextOverlay = reconcile_livemap_projected_identity_overlay(currentOverlay, planned.transportOps);
  const replacesRoot = planned.changed
    && writeOps.some((op) => op.kind === "replace" && op.path.length === 0);
  const installsProjectedDelta = currentOverlay.size === 0
    && nextOverlay.size === 0
    && !replacesRoot;
  const nextRoot = installsProjectedDelta
    ? undefined
    : projected_candidate_graph(root, planned.value, writeOps);
  if (nextRoot !== undefined) apply_livemap_projected_identity_overlay(nextRoot, nextOverlay);
  const nextLedger = replacesRoot
    ? undefined
    : stage_livemap_identity_epoch(
      identityEpoch.issued(),
      livemap_projected_identity_quids(currentOverlay),
      livemap_projected_identity_quids(nextOverlay),
    );
  const prevRev = getRev();
  const rev = planned.changed
    ? prevRev + 1
    : prevRev;
  const commit: LiveMapCommit = Object.freeze({
    changed: planned.changed,
    prevRev,
    rev,
    ops: planned.ops,
    ...encode_livemap_replay_transport(planned.transportOps),
  });
  return transitionController.prepare({
    commit,
    baseStillCurrent: () => getRev() === prevRev,
    install: () => {
      if (installsProjectedDelta) apply_projected_transport_ops(root, planned.transportOps);
      else overwrite_hson_node(root, nextRoot!);
      setProjectedValue(planned.value);
      setRev(rev);
      setOverlay(nextOverlay);
      if (replacesRoot) identityEpoch.replace(livemap_projected_identity_quids(nextOverlay));
      else if (nextLedger !== undefined) identityEpoch.install(nextLedger);
    },
    notify: (acceptedCommit) => {
      publishCommit(acceptedCommit, () => {
        feedHub.emitProjected(acceptedCommit as LiveMapCommit<LiveMapDataOp>, (feedPath) => project_live_path(root, feedPath));
        commitObserverHub.emitCommit(acceptedCommit, "authoritative");
      });
    },
  });
}

/** Privileged historical replay retains its exact existing notification semantics. */
function apply_replay_ops(
  root: HsonNode,
  getProjectedValue: () => OrderedProjectedValue,
  setProjectedValue: (value: OrderedProjectedValue) => void,
  hsonSchema: HsonSchema | undefined,
  feedHub: ReturnType<typeof make_livemap_feed_hub>,
  getRev: () => number,
  setRev: (rev: number) => void,
  writeOps: readonly LiveMapCoreWriteOp[],
  commitObserverHub: ReturnType<typeof make_livemap_commit_observer_hub<LiveMapAnyOp>>,
  publishCommit: LiveMapCommitPublisher,
  currentOverlay: LiveMapProjectedIdentityOverlay,
  setOverlay: (overlay: LiveMapProjectedIdentityOverlay) => void,
  identityEpoch: LiveMapIdentityEpochController,
): LiveMapCommit {
  const planned = plan_write_ops_with_identity(
    getProjectedValue(),
    writeOps,
    currentOverlay,
  );
  must_hson_schema_projected_candidate(hsonSchema, planned.value);
  const prevRev = getRev();
  const rev = planned.changed ? prevRev + 1 : prevRev;
  if (planned.changed) {
    const nextOverlay = reconcile_livemap_projected_identity_overlay(currentOverlay, planned.transportOps);
    const replacesRoot = writeOps.some((op) => op.kind === "replace" && op.path.length === 0);
    const installsProjectedDelta = currentOverlay.size === 0
      && nextOverlay.size === 0
      && !replacesRoot;
    const nextRoot = installsProjectedDelta
      ? undefined
      : projected_candidate_graph(root, planned.value, writeOps);
    if (nextRoot !== undefined) apply_livemap_projected_identity_overlay(nextRoot, nextOverlay);
    const nextLedger = replacesRoot
      ? undefined
      : stage_livemap_identity_epoch(
        identityEpoch.issued(),
        livemap_projected_identity_quids(currentOverlay),
        livemap_projected_identity_quids(nextOverlay),
      );
    if (installsProjectedDelta) apply_projected_transport_ops(root, planned.transportOps);
    else overwrite_hson_node(root, nextRoot!);
    setProjectedValue(planned.value);
    setOverlay(nextOverlay);
    if (replacesRoot) identityEpoch.replace(livemap_projected_identity_quids(nextOverlay));
    else if (nextLedger !== undefined) identityEpoch.install(nextLedger);
    setRev(rev);
  }
  const commit: LiveMapCommit = Object.freeze({
    changed: planned.changed,
    prevRev,
    rev,
    ops: planned.ops,
    ...encode_livemap_replay_transport(planned.transportOps),
  });
  publishCommit(commit, () => {
    feedHub.emitProjected(commit, (feedPath) => project_live_path(root, feedPath));
    commitObserverHub.emitCommit(commit, "replay");
  });
  return commit;
}

function prepare_document_transition(
  currentRoot: HsonNode,
  commit: LiveMapCommit<LiveMapGraphOp>,
  transitionController: LiveMapTransitionController,
  install: () => void,
  notify: (commit: LiveMapCommit<LiveMapAnyOp>) => void,
): PreparedLiveMapTransition {
  const baseRoot = clone_live_root(currentRoot);
  return transitionController.prepare({
    commit,
    baseStillCurrent: () => canonical_graph_equal(currentRoot, baseRoot),
    install,
    notify,
  });
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
