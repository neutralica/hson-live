// Registry LiveMap transition and aggregate authority.
import type { PortableAggregateSnapshot } from "./livemap.hosted.internal.types.js";

import { ROOT_TAG } from "../../core/constants.js";
import { is_persisted_quid } from "../../core/hson-node-quid.js";
import { is_Node, is_ordinary_element_node } from "../../core/node-guards.js";
import {
  ordered_projected_array_move,
  ordered_projected_array_splice,
  ordered_projected_object_rename,
  ordered_projected_value_at,
  ordered_projected_value_delete,
  ordered_projected_value_replace,
  ordered_projected_value_set,
} from "../../core/ordered-projected-value-mutation.js";
import {
  is_ordered_projected_object,
  optional_ordered_projected_value_equal,
  ordered_projected_value_equal,
  type OrderedProjectedObject,
  type OrderedProjectedValue
} from "../../core/ordered-projected-value.js";
import { projected_value_to_hson_root } from "../../core/projected-value-graph.js";
import { materialize_projected_value } from "../../core/projected-value-materialization.js";
import type { HsonNode, JsonValue } from "../../core/types.js";
import { rewrite_interaction_subjects, validate_interaction_subjects } from "../../internal/interaction-path-maintenance.js";
import { INTERACTION_RESERVED_LIBRARY_KEY } from "../../internal/interaction-storage.js";
import { validate_hson_schema_graph } from "../../internal/schema-hson-validation/validate-canonical-hson.js";
import { HsonSchema as HsonSchemaHandle, compiled_hson_schema_of } from "../schema/hson-schema.js";
import type { HostedLiveMapSnapshot, LiveMapCssOp, LiveMapDataOp, LiveMapDocumentPath, LiveMapGraphCommit, LiveMapGraphOp, LiveMapSnapshot, LivePath } from "../../types/livemap.types.js";
import { apply_portable_document_css_op, canonical_portable_document_css_op } from "../../internal/css/portable-document-operations.js";
import { decode_portable_document_stylesheet, empty_portable_document_stylesheet, encode_portable_document_stylesheet, portable_document_stylesheet_equal } from "../../internal/css/portable-document-stylesheet.js";
import type { HsonSchema } from "../transform/transform.types.js";
import { admit_portable_hson_node } from "../transform/utils/hson-utils/quid-ingress.js";
import {
  LiveMapTransitionError,
  make_livemap_transition_controller
} from "./livemap.authority.js";
import {
  clone_hson_graph_without_quids,
  register_livemap_document_commit_continuity
} from "./livemap.document.capture.js";
import { livemap_document_identity_overlay_equal, livemap_document_identity_quids, register_livemap_document_identity_at_path, register_livemap_document_identity_effects, type LiveMapDocumentIdentityEffect } from "./livemap.document.identity.js";
import { canonical_graph_equal } from "./livemap.document.install.js";
import { classify_live_root_mode, prepare_livemap_root } from "./livemap.document.js";
import {
  prepare_document_graph_operation,
  type PreparedDocumentMutation
} from "./livemap.document.mutation.js";
import { resolve_document_path } from "./livemap.document.path.js";
import { register_livemap_document_identity_candidate_commit } from "./livemap.document.registration.js";
import {
  clone_live_root,
  overwrite_hson_node,
  project_live_path,
  resolve_value_node
} from "./livemap.editor.js";
import { LiveMapDocumentMutationError, LiveMapProjectedMutationError, LiveMapReplayError, LiveMapRevError } from "./livemap.error.js";
import { must_live_path, must_ordered_projected_value, path_kind_error } from "./livemap.guard.js";
import {
  assert_hosted_libraries_snapshot_shape,
  assert_libraries_snapshot_bound,
  assert_libraries_snapshot_shape,
  assert_portable_aggregate_snapshot_shape,
  decode_hosted_commit,
  decode_hosted_root,
  decode_portable_aggregate_commit,
  encode_hosted_root,
  HOSTED_MAX_ISSUED_QUIDS,
  HOSTED_MAX_SNAPSHOT_BYTES,
  hosted_sha256,
  LIVEMAP_LIBRARIES_SNAPSHOT_FORMAT,
  make_hosted_authority_fence,
  make_hosted_commit,
  make_hosted_registry,
  make_hosted_topology_commit,
  make_portable_aggregate_commit,
  portable_aggregate_snapshot_as_local,
  type HostedAggregateCommit,
  type HostedAuthorityFence,
  type HostedRegistry,
  type HostedRegistryBinding,
  type PortableAggregateCommit,
} from "./livemap.hosted.js";
import {
  enumerate_livemap_issued_quids,
  LiveMapIdentityEpochError,
  make_livemap_identity_epoch,
  make_livemap_issued_quid_ledger,
  retain_livemap_identity_epoch,
  stage_livemap_identity_epoch,
  type LiveMapIssuedQuidLedger
} from "./livemap.identity-epoch.js";
import type { LiveMapSemanticCheckpoint } from "./livemap.internal.js";
import {
  type InternalLiveMapAggregateAuthority
} from "./livemap.internal.js";
import {
  livemap_library_target,
  livemap_system_target,
  make_livemap_library,
  make_livemap_library_registry,
  type LiveMapAggregateCommit,
  type LiveMapAggregateOperation,
  type LiveMapAggregateWrite,
  type LiveMapLibraryIdentity,
  type LiveMapLibraryState,
  type LiveMapStructuralTarget,
} from "./livemap.library.js";
import { append_live_path, clone_live_path, format_live_path, live_path_key, paths_overlap } from "./livemap.path.js";
import {
  type LiveMapProjectedDeleteWrite,
  type LiveMapProjectedMoveWrite,
  type LiveMapProjectedRenameWrite,
  type LiveMapProjectedReplaceWrite,
  type LiveMapProjectedSetWrite,
  type LiveMapProjectedSpliceWrite
} from "./livemap.projected-propagation.js";
import {
  apply_livemap_projected_identity_overlay,
  is_livemap_projected_identity_target,
  livemap_projected_identity_has_at_or_below,
  livemap_projected_identity_quids,
  reconcile_livemap_projected_identity_overlay,
  register_livemap_projected_identity_at_path,
  type LiveMapProjectedIdentityOverlay,
} from "./livemap.projected.identity.js";
import type { LiveMapRuntimeIdentityParticipant } from "./livemap.runtime-identity.js";
import {
  make_livemap_system_identity,
  type LiveMapSystemIdentity,
  type LiveMapSystemState,
} from "./livemap.system.js";
import {
  materialize_livemap_projected_op,
  type LiveMapProjectedDataOp
} from "./livemap.transport.js";

const hostedSnapshotProvenance = new WeakMap<object, Readonly<{
  owner: object;
  epoch: number;
  bytes: string;
  overlays: ReadonlyMap<string, Readonly<{
    document?: import("./livemap.document.identity.js").LiveMapDocumentIdentityOverlay;
    projected?: LiveMapProjectedIdentityOverlay;
  }>>;
}>>();
const hostedCommitProvenance = new WeakMap<object, Readonly<{ owner: object; epoch: number; bytes: string }>>();

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

export type RegistryRoot = Readonly<{
  root: HsonNode;
  hsonSchema?: HsonSchema;
  family: "data" | "document";
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
  const prepared = roots.map(({ root, hsonSchema, family }) => {
    const graph = prepare_livemap_root(root, family);
    if (hsonSchema !== undefined) {
      must_hson_schema_family(hsonSchema, family);
      must_hson_schema_root(hsonSchema, graph.root);
    }
    return { graph, hsonSchema };
  });
  const aggregate = make_livemap_registry_engine(prepared, systems);
  return Object.freeze({ aggregate, identities: aggregate.libraries() });
}



/** Build one map authority around the admitted named library roots. */
function make_livemap_registry_engine(
  registry: readonly Readonly<{
    graph: ReturnType<typeof prepare_livemap_root>;
    hsonSchema?: HsonSchema;
  }>[],
  systems: readonly InitialSystemState[] = [],
): InternalLiveMapAggregateAuthority {
  const states = registry.map(({ graph, hsonSchema }) => make_livemap_library(graph, hsonSchema));
  const libraryRegistry = make_livemap_library_registry(states);
  for (const library of states) {
    if (library.mode !== "document") library.projectedValue = must_projected_root_value(library.root);
  }
  // Revision, transition, publication, and QUID identity authority stay on the
  // enclosing LiveMap. A Library owns only graph-local state.
  let mapRevision = 0;
  // This is deliberately one-per-LiveMap, not one-per-Library. It is the
  // map-wide QUID epoch and issued ledger. Active overlays remain graph-local
  // to their selected application Libraries.
  const mapIdentityEpoch = make_livemap_identity_epoch(aggregate_quid_locations(states).keys());
  let identityGeneration = 0;
  let localIdentityTransactionActive = false;
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
  const preparedSystemRoots = new WeakMap<import("./livemap.authority.js").PreparedLiveMapAuthorityTransition, HsonNode | undefined>();
  const aggregatePositionObservers: Array<(revision: number) => void> = [];
  const publishAuthorityPosition = (revision = mapRevision): void => {
    for (const observer of [...aggregatePositionObservers]) observer(revision);
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
  // their graph operation.  Mirror consumes that evidence without ever
  // inventing a document-local revision stream.
  const documentCommitByAggregate = new WeakMap<
    LiveMapAggregateCommit,
    Map<LiveMapLibraryIdentity, LiveMapGraphCommit<LiveMapGraphOp>>
  >();
  const documentRootByAggregate = new WeakMap<LiveMapAggregateCommit, Map<LiveMapLibraryIdentity, HsonNode>>();
  const aggregateByDocumentCommit = new WeakMap<LiveMapGraphCommit, LiveMapAggregateCommit>();
  let hostedRegistry: HostedRegistry | undefined;
  let hostedFence: HostedAuthorityFence | undefined;
  let hostedBindingsByIdentity: ReadonlyMap<object, HostedRegistryBinding> | undefined;
  let hostedBindingsByName: ReadonlyMap<string, HostedRegistryBinding> | undefined;
  let clientComposition: Readonly<{
    authority: HostedAuthorityFence;
    registry: HostedRegistry;
    revision: number;
    projected: ReadonlySet<LiveMapLibraryIdentity>;
    bindings: ReadonlyMap<string, HostedRegistryBinding>;
  }> | undefined;
  let clientManagementOwner: object | undefined;
  const projectedCaptureContinuity = new Map<LiveMapLibraryIdentity, object>();
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

  if (systems.length > 1) {
    throw new Error("LiveMap currently supports one transactional Hson system-state domain.");
  }
  const initialSystem = systems[0];
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
    if (clientComposition !== undefined || hostedRegistry === undefined || hostedFence === undefined || hostedBindingsByIdentity === undefined) return {};
    const hosted = make_hosted_commit(hostedFence, hostedRegistry, hostedBindingsByIdentity, {
      changed,
      prevRev,
      rev,
      operations,
    });
    hostedCommitProvenance.set(hosted, Object.freeze({
      owner: mapIdentityEpoch.owner,
      epoch: mapIdentityEpoch.current(),
      bytes: JSON.stringify(hosted),
    }));
    return { hosted };
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
    transitionController.assertLocalIdentityAllowed();
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
    write: Extract<LiveMapAggregateWrite, { kind: "set" | "set-key" | "replace" | "delete" | "splice" | "rename" | "move" }>,
    value: OrderedProjectedValue,
  ): readonly LiveMapCoreWriteOp[] {
    const path = clone_live_path(must_live_path(write.target.path));
    if (write.kind === "set-key") {
      const parent = ordered_projected_value_at(value, path);
      if (!is_ordered_projected_object(parent)) throw new Error(`LiveMap set-key path is not an object: ${format_live_path(path)}`);
      return [Object.freeze({ kind: "set" as const, path: [...path, write.key], value: write.value })];
    }
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
    if (clientComposition === undefined) transitionController.assertPublicMutationAllowed();
    else {
      const executing = transitionController.managedExecutionOwner();
      if (executing !== undefined && executing !== clientManagementOwner) {
        throw new Error("Client LiveMap transition belongs to another manager.");
      }
      const managed = executing !== undefined;
      const touched = [
        ...writes.map((write) => write.target),
        ...preparedDocuments.map((entry) => aggregate_target(entry.library, [])),
      ];
      for (const target of touched) {
        const projected = target.domain === "system" || clientComposition.projected.has(target.library);
        if (managed !== projected) {
          throw new Error("Client LiveMap transition crosses its library mutation authority.");
        }
      }
    }
    const prevRev = mapRevision;
    const preparedIdentityGeneration = identityGeneration;
    const candidates = new Map<LiveMapLibraryIdentity, AggregateCandidate>();
    const cssCandidates = new Map<LiveMapLibraryIdentity, Readonly<{
      before: import("../../internal/css/portable-document-stylesheet.js").PortableDocumentStylesheet;
      after: import("../../internal/css/portable-document-stylesheet.js").PortableDocumentStylesheet;
    }>>();
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
      if (replayingSystem || systemState?.key !== INTERACTION_RESERVED_LIBRARY_KEY
        || (clientComposition !== undefined && !clientComposition.projected.has(library.identity))) return;
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
        if (write.kind === "graph" || write.kind === "ensure-quid" || write.kind === "css") {
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
      if (write.kind === "css") {
        if (library.mode !== "document" || target.path.length !== 0) {
          throw new Error("CSS operations require a document Library root.");
        }
        const operation = canonical_portable_document_css_op(write.operation);
        const current = cssCandidates.get(library.identity)?.after ?? stylesheet(library.identity);
        const next = apply_portable_document_css_op(current, operation);
        if (!portable_document_stylesheet_equal(current, next)) {
          cssCandidates.set(library.identity, Object.freeze({
            before: cssCandidates.get(library.identity)?.before ?? current, after: next,
          }));
          operations.push(Object.freeze({ target, operation }));
        }
        continue;
      }
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
        const nextMode = classify_live_root_mode(root, "data");
        if (nextMode !== candidate.library.mode) {
          throw new Error(`LiveMap data root mode is fixed at construction: expected ${candidate.library.mode}; observed ${nextMode}.`);
        }
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
    const documentRoots = new Map<LiveMapLibraryIdentity, HsonNode>();
    for (const library of states) {
      if (library.mode !== "document") continue;
      const candidate = candidates.get(library.identity);
      documentRoots.set(library.identity, candidate !== undefined && is_aggregate_document_candidate(candidate)
        ? candidate.root
        : library.root);
    }
    documentRootByAggregate.set(commit, documentRoots);
    const prepared = transitionController.prepareAuthority({
      commit,
      libraryModes: Object.freeze([...candidates.values()].map((candidate) => candidate.library.mode)),
      baseStillCurrent: () => mapRevision === prevRev
        && identityGeneration === preparedIdentityGeneration
        && [...candidates.values()].every((candidate) => canonical_graph_equal(candidate.library.root, candidate.baseRoot))
        && [...cssCandidates].every(([identity, candidate]) => stylesheet(identity) === candidate.before)
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
        for (const [identity, candidate] of cssCandidates) require_library(identity).stylesheet = candidate.after;
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
          let firstObserverFailure: unknown;
          let observerFailed = false;
          for (const observer of [...aggregateObservers]) {
            try {
              observer(acceptedCommit);
            } catch (error) {
              if (!observerFailed) {
                firstObserverFailure = error;
                observerFailed = true;
              }
            }
          }
          publishAuthorityPosition(acceptedCommit.rev);
          if (observerFailed) throw firstObserverFailure;
        });
      },
    });
    preparedSystemRoots.set(prepared, systemCandidate === undefined ? systemState?.root : systemCandidate.nextRoot);
    return prepared;
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

  function configure_client_composition(snapshot: PortableAggregateSnapshot): void {
    if (clientComposition !== undefined || clientManagementOwner !== undefined || mapRevision !== 0) {
      throw new Error("Client LiveMap ownership must be fixed before its first transition.");
    }
    assert_portable_aggregate_snapshot_shape(snapshot);
    const hosted = require_hosted_state();
    const projected = new Set<LiveMapLibraryIdentity>();
    const bindings = new Map<string, HostedRegistryBinding>();
    const initialCss: Array<readonly [LiveMapLibraryIdentity, import("../../internal/css/portable-document-stylesheet.js").PortableDocumentStylesheet]> = [];
    for (let index = 0; index < snapshot.registry.libraries.length; index += 1) {
      const entry = snapshot.registry.libraries[index];
      const root = snapshot.libraries[index];
      if (entry === undefined || root === undefined || entry.name !== root.name) {
        throw new Error("Client projection registry and roots disagree.");
      }
      const binding = hosted.byName.get(entry.name);
      const fullEntry = hosted.registry.libraries.find((candidate) => candidate.name === entry.name);
      if (binding === undefined || binding.mode !== entry.mode
        || binding.scope !== entry.scope || binding.schema.toHson() !== entry.schema
        || fullEntry?.schemaDigest !== entry.schemaDigest || fullEntry.rootCodec !== entry.rootCodec) {
        throw new Error("Client projection contract disagrees with the composed registry.");
      }
      const current = binding.scope === "hson-internal"
        ? systemState?.root
        : require_library(binding.identity as LiveMapLibraryIdentity).root;
      if (current === undefined || !canonical_graph_equal(current, decode_hosted_root(root.root, HOSTED_MAX_SNAPSHOT_BYTES))) {
        throw new Error("Client projection initial root disagrees with the composed registry.");
      }
      bindings.set(entry.name, binding);
      if (binding.scope !== "hson-internal") {
        const identity = binding.identity as LiveMapLibraryIdentity;
        if (entry.mode === "document") initialCss.push([identity, decode_portable_document_stylesheet(root.css)]);
        projected.add(identity);
        projectedCaptureContinuity.set(identity, Object.freeze({}));
      }
    }
    for (const [identity, css] of initialCss) require_library(identity).stylesheet = css;
    clientComposition = Object.freeze({
      authority: Object.freeze({ ...snapshot.authority }),
      registry: snapshot.registry,
      revision: snapshot.revision,
      projected,
      bindings,
    });
    hostedFence = clientComposition.authority;
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

  type LibraryAddition = Readonly<{
    name: string;
    root: HsonNode;
    hsonSchema: HsonSchema;
    family: "data" | "document";
  }>;

  function prepare_add_libraries(definitions: readonly LibraryAddition[]): Readonly<{
    transition: import("./livemap.authority.js").PreparedLiveMapAuthorityTransition;
    identities: readonly LiveMapLibraryIdentity[];
  }> {
    if (clientComposition === undefined) transitionController.assertPublicMutationAllowed();
    const prevRev = mapRevision;
    if (definitions.length === 0) throw new Error("LiveMap topology batch is empty.");
    const hosted = require_hosted_state();
    const prepared = definitions.map(({ name, root, hsonSchema, family }) => {
      admit_portable_hson_node(root, `LiveMap Library ${JSON.stringify(name)}`);
      const graph = prepare_livemap_root(root, family);
      must_hson_schema_family(hsonSchema, family);
      must_hson_schema_root(hsonSchema, graph.root);
      const state = make_livemap_library(graph, hsonSchema);
      if (state.mode !== "document") state.projectedValue = must_projected_root_value(state.root);
      return Object.freeze({ name, state, hsonSchema });
    });
    const existingBindings = libraryRegistry.all().map((state) => {
      const binding = hosted.byIdentity.get(state.identity);
      if (binding === undefined) throw new Error("LiveMap Library binding is unavailable.");
      return binding;
    });
    const newBindings = prepared.map(({ name, state, hsonSchema }): HostedRegistryBinding => Object.freeze({
      name, identity: state.identity, mode: state.mode, schema: hsonSchema,
    }));
    const systemBinding: HostedRegistryBinding[] = [];
    if (systemState !== undefined) {
      const binding = hosted.byIdentity.get(systemState.identity);
      if (binding === undefined) throw new Error("LiveMap system binding is unavailable.");
      systemBinding.push(binding);
    }
    const nextBindings = [...existingBindings, ...newBindings, ...systemBinding];
    if (newBindings.some((binding) => binding.name === INTERACTION_RESERVED_LIBRARY_KEY)) {
      throw new Error("LiveMap system Library name is reserved.");
    }
    const nextRegistry = make_hosted_registry(nextBindings);
    const nextByIdentity = new Map(nextBindings.map((binding) => [binding.identity, binding]));
    const nextByName = new Map(nextBindings.map((binding) => [binding.name, binding]));
    const beforeActive = aggregate_quid_locations(libraryRegistry.all());
    const afterActive = aggregate_quid_locations([...libraryRegistry.all(), ...prepared.map((item) => item.state)]);
    const nextLedger = stage_livemap_identity_epoch(mapIdentityEpoch.issued(), beforeActive.keys(), afterActive.keys());
    const first = prepared[0];
    if (first === undefined) throw new Error("LiveMap topology batch is empty.");
    const topology = Object.freeze({
      library: first.name,
      operation: Object.freeze({ kind: "library-add" as const,
        libraries: Object.freeze(prepared.map(({ name, state, hsonSchema }) => Object.freeze({
          name,
          mode: state.mode,
          schema: hsonSchema.toHson(),
          root: encode_hosted_root(clone_hson_graph_without_quids(state.root)),
        }))),
      }),
    });
    const commit: LiveMapAggregateCommit = Object.freeze({
      kind: "aggregate", changed: true, prevRev, rev: prevRev + 1,
      operations: Object.freeze([]), topology,
      hosted: make_hosted_topology_commit(hosted.fence, hosted.registry, nextRegistry, topology, prevRev),
    });
    const transition = transitionController.prepareAuthority({
      commit,
      libraryModes: Object.freeze(prepared.map(({ state }) => state.mode)),
      baseStillCurrent: () => mapRevision === prevRev && hostedRegistry === hosted.registry,
      install: () => {
        mapIdentityEpoch.install(nextLedger);
        libraryRegistry.add(prepared.map(({ state }) => state));
        hostedRegistry = nextRegistry;
        hostedBindingsByIdentity = nextByIdentity;
        hostedBindingsByName = nextByName;
        mapRevision = commit.rev;
      },
      notify: (acceptedCommit) => enqueuePublication(() => {
        aggregateAcceptedTransitions += 1;
        aggregatePublications += 1;
        let firstFailure: unknown;
        for (const observer of [...aggregateObservers]) {
          try { observer(acceptedCommit); }
          catch (error) { firstFailure ??= error; }
        }
        publishAuthorityPosition(acceptedCommit.rev);
        if (firstFailure !== undefined) throw firstFailure;
      }),
    });
    return Object.freeze({ transition, identities: Object.freeze(prepared.map(({ state }) => state.identity)) });
  }

  function add_libraries(definitions: readonly LibraryAddition[], afterInstall?: (identities: readonly LiveMapLibraryIdentity[]) => void): LiveMapAggregateCommit {
    if (clientComposition === undefined) transitionController.assertPublicMutationAllowed();
    if (definitions.length === 0) return Object.freeze({
      kind: "aggregate", changed: false, prevRev: mapRevision, rev: mapRevision, operations: Object.freeze([]),
    });
    const prepared = prepare_add_libraries(definitions);
    return transitionController.acceptAuthority(prepared.transition, "propagate", () =>
      afterInstall?.(prepared.identities)).commit;
  }

  function stylesheet(libraryIdentity: LiveMapLibraryIdentity) {
    const state = require_library(libraryIdentity);
    if (state.mode !== "document" || state.stylesheet === undefined) {
      throw new Error("Document stylesheet requires a document Library.");
    }
    return state.stylesheet;
  }

  function commit_stylesheet(libraryIdentity: LiveMapLibraryIdentity, operation: LiveMapCssOp): LiveMapAggregateCommit {
    if (clientComposition === undefined) transitionController.assertPublicMutationAllowed();
    else if (clientComposition.projected.has(libraryIdentity)) {
      throw new Error("Projected document CSS requires authority authoring.");
    }
    const state = require_library(libraryIdentity);
    const current = stylesheet(libraryIdentity);
    const normalizedOp = canonical_portable_document_css_op(operation);
    if (new TextEncoder().encode(JSON.stringify(normalizedOp)).byteLength > HOSTED_MAX_SNAPSHOT_BYTES) {
      throw new TypeError("Document CSS operation exceeds the snapshot bound.");
    }
    const next = apply_portable_document_css_op(current, normalizedOp);
    const prevRev = mapRevision;
    if (portable_document_stylesheet_equal(current, next)) {
      return Object.freeze({ kind: "aggregate", changed: false, prevRev, rev: prevRev,
        operations: Object.freeze([]) });
    }
    const commit: LiveMapAggregateCommit = Object.freeze({ kind: "aggregate", changed: true,
      prevRev, rev: prevRev + 1, operations: Object.freeze([]),
      css: Object.freeze({ library: libraryIdentity, operation: normalizedOp }) });
    const prepared = transitionController.prepareAuthority({
      commit, libraryModes: Object.freeze(["document"]),
      baseStillCurrent: () => mapRevision === prevRev && state.stylesheet === current,
      install: () => { state.stylesheet = next; mapRevision = commit.rev; },
      notify: (accepted) => enqueuePublication(() => {
        aggregateAcceptedTransitions += 1;
        aggregatePublications += 1;
        let firstFailure: unknown;
        for (const observer of [...aggregateObservers]) {
          try { observer(accepted); } catch (error) { firstFailure ??= error; }
        }
        publishAuthorityPosition(accepted.rev);
        if (firstFailure !== undefined) throw firstFailure;
      }),
    });
    return transitionController.acceptAuthority(prepared).commit;
  }

  function capture_libraries_aggregate(): LiveMapSnapshot {
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
        root: encode_hosted_root(clone_hson_graph_without_quids(state.root)),
        ...(entry.mode === "document" ? { css: encode_portable_document_stylesheet(stylesheet(state.identity)) } : {}),
      });
    });
    const snapshot: LiveMapSnapshot = Object.freeze({
      format: LIVEMAP_LIBRARIES_SNAPSHOT_FORMAT,
      revision: mapRevision,
      registry: hosted.registry,
      registryDigest: hosted.registry.digest,
      libraries: Object.freeze(libraries),
    });
    assert_libraries_snapshot_bound(snapshot);
    return snapshot;
  }

  function capture_selected_hosted(names: readonly string[], includeSystem: boolean) {
    const hosted = require_hosted_state();
    const revision = mapRevision;
    const authority = hosted.fence;
    const libraries = names.map((name) => {
      const binding = hosted.byName.get(name);
      if (binding === undefined || binding.scope === "hson-internal") {
        throw new Error("Selected hosted Library is unavailable.");
      }
      const state = require_library(binding.identity as LiveMapLibraryIdentity);
      return Object.freeze({ name, root: encode_hosted_root(
        clone_hson_graph_without_quids(state.root), HOSTED_MAX_SNAPSHOT_BYTES),
        ...(state.mode === "document" ? { css: encode_portable_document_stylesheet(stylesheet(state.identity)) } : {}) });
    });
    const system = includeSystem ? (() => {
      if (systemState === undefined) throw new Error("Selected hosted system state is unavailable.");
      return encode_hosted_root(clone_hson_graph_without_quids(systemState.root), HOSTED_MAX_SNAPSHOT_BYTES);
    })() : null;
    // The synchronous structural capture admits no policy or application callbacks.
    if (mapRevision !== revision || hostedFence !== authority) {
      throw new Error("Selected hosted authority changed during capture.");
    }
    return Object.freeze({ authority, revision, libraries: Object.freeze(libraries), system });
  }

  function capture_hosted_aggregate(): HostedLiveMapSnapshot {
    const hosted = require_hosted_state();
    const portable = capture_libraries_aggregate();
    const issuedQuids = enumerate_livemap_issued_quids(mapIdentityEpoch.issued());
    if (issuedQuids.length > HOSTED_MAX_ISSUED_QUIDS) {
      throw new Error("Hosted aggregate issued-QUID ledger exceeds its supported bound.");
    }
    const libraries = portable.libraries.map((entry) => {
      const binding = hosted.byName.get(entry.name);
      if (binding === undefined) throw new Error("Hosted Library binding is unavailable during exact capture.");
      const state = binding.scope === "hson-internal"
        ? systemState
        : require_library(binding.identity as LiveMapLibraryIdentity);
      if (state === undefined) throw new Error("Hosted system state is unavailable during exact capture.");
      return Object.freeze({ ...entry, root: encode_hosted_root(clone_live_root(state.root)) });
    });
    const snapshot: HostedLiveMapSnapshot = Object.freeze({
      ...portable,
      libraries: Object.freeze(libraries),
      identity: Object.freeze({ epoch: mapIdentityEpoch.current(), issuedQuids }),
      authority: hosted.fence,
    });
    assert_libraries_snapshot_bound(snapshot);
    const overlays = new Map<string, Readonly<{
      document?: import("./livemap.document.identity.js").LiveMapDocumentIdentityOverlay;
      projected?: LiveMapProjectedIdentityOverlay;
    }>>();
    for (const entry of hosted.registry.libraries) {
      const binding = hosted.byName.get(entry.name);
      if (binding === undefined || binding.scope === "hson-internal") continue;
      const state = require_library(binding.identity as LiveMapLibraryIdentity);
      overlays.set(entry.name, Object.freeze({
        ...(state.documentOverlay === undefined ? {} : { document: state.documentOverlay }),
        ...(state.projectedOverlay === undefined ? {} : { projected: state.projectedOverlay }),
      }));
    }
    hostedSnapshotProvenance.set(snapshot, Object.freeze({
      owner: mapIdentityEpoch.owner,
      epoch: mapIdentityEpoch.current(),
      bytes: JSON.stringify(snapshot),
      overlays,
    }));
    return snapshot;
  }

  function capture_semantic_checkpoint(): LiveMapSemanticCheckpoint {
    const hosted = require_hosted_state();
    const revision = mapRevision;
    const authority = hosted.fence;
    const libraries = hosted.registry.libraries.map((entry) => {
      const binding = hosted.byName.get(entry.name);
      if (binding === undefined) throw new Error("Checkpoint Library binding is unavailable.");
      const state = binding.scope === "hson-internal"
        ? systemState : require_library(binding.identity as LiveMapLibraryIdentity);
      if (state === undefined) throw new Error("Checkpoint system state is unavailable.");
      return Object.freeze({ name: entry.name, root: clone_hson_graph_without_quids(state.root),
        ...(entry.mode === "document" ? { css: encode_portable_document_stylesheet(stylesheet(state.identity as LiveMapLibraryIdentity)) } : {}) });
    });
    if (mapRevision !== revision || hostedFence !== authority) {
      throw new Error("Authority changed during checkpoint capture.");
    }
    return Object.freeze({ authority, revision, registry: hosted.registry, libraries: Object.freeze(libraries) });
  }

  function install_semantic_checkpoint(checkpoint: LiveMapSemanticCheckpoint): void {
    transitionController.assertPublicMutationAllowed();
    const hosted = require_hosted_state();
    if (!Number.isSafeInteger(checkpoint.revision) || checkpoint.revision < 0
      || checkpoint.registry.digest !== hosted.registry.digest
      || JSON.stringify(checkpoint.registry) !== JSON.stringify(hosted.registry)
      || checkpoint.libraries.length !== hosted.registry.libraries.length
      || typeof checkpoint.authority.logicalMapId !== "string" || !checkpoint.authority.logicalMapId
      || typeof checkpoint.authority.incarnationId !== "string" || !checkpoint.authority.incarnationId) {
      throw new Error("Semantic checkpoint is incompatible with this authority.");
    }
    const candidates = checkpoint.libraries.map((item, index) => {
      const entry = hosted.registry.libraries[index];
      if (entry === undefined || item.name !== entry.name) throw new Error("Checkpoint Library order is invalid.");
      const binding = hosted.byName.get(entry.name);
      if (binding === undefined) throw new Error("Checkpoint Library binding is unavailable.");
      admit_portable_hson_node(item.root, "Semantic checkpoint root");
      const prepared = prepare_livemap_root(item.root, entry.mode === "document" ? "document" : "data");
      if (prepared.mode !== entry.mode) throw new Error("Checkpoint root mode disagrees with registry.");
      must_hson_schema_root(binding.schema, prepared.root);
      if (entry.scope === "hson-internal") {
        if (systemState === undefined || binding.identity !== systemState.identity || prepared.mode === "document") {
          throw new Error("Checkpoint system state is incompatible.");
        }
        return Object.freeze({ kind: "system" as const, state: systemState, prepared,
          projectedValue: must_projected_root_value(prepared.root) });
      }
      const state = require_library(binding.identity as LiveMapLibraryIdentity);
      return Object.freeze({ kind: "application" as const, state, prepared,
        css: prepared.mode === "document" ? decode_portable_document_stylesheet(item.css) : undefined,
        changed: !canonical_graph_equal(state.root, prepared.root)
          || (prepared.mode === "document" && !portable_document_stylesheet_equal(stylesheet(state.identity),
            decode_portable_document_stylesheet(item.css))),
        projectedValue: prepared.projectedOverlay === undefined
          ? undefined : must_projected_root_value(prepared.root) });
    });
    if (systemState !== undefined && !candidates.some((candidate) => candidate.kind === "system")) {
      throw new Error("Checkpoint omitted system state.");
    }
    const changedLibraries = candidates.flatMap((candidate) =>
      candidate.kind === "application" && candidate.changed ? [candidate.state.identity] : []);
    for (const candidate of candidates) {
      if (candidate.kind === "system") {
        candidate.state.root = candidate.prepared.root;
        candidate.state.projectedValue = candidate.projectedValue;
      } else {
        Object.assign(candidate.state, {
          root: candidate.prepared.root,
          documentOverlay: candidate.prepared.documentOverlay,
          projectedOverlay: candidate.prepared.projectedOverlay,
          projectedValue: candidate.projectedValue,
          ...(candidate.css === undefined ? {} : { stylesheet: candidate.css }),
        });
      }
    }
    const previousRevision = mapRevision;
    mapIdentityEpoch.replace([]);
    mapRevision = checkpoint.revision;
    hostedFence = Object.freeze({ ...checkpoint.authority });
    transitionController.invalidate();
    const event = Object.freeze({
      previousRevision,
      revision: checkpoint.revision,
      libraries: Object.freeze(libraryRegistry.all().map((library) => library.identity)),
      changedLibraries: Object.freeze(changedLibraries),
      continuity: "new-epoch" as const,
    });
    enqueuePublication(() => {
      for (const observer of [...aggregateRestoreObservers]) observer(event);
      publishAuthorityPosition();
    });
  }

  function restore_local_topology(
    snapshot: LiveMapSnapshot,
    afterTopologyInstall?: (identities: readonly LiveMapLibraryIdentity[]) => void,
  ): void {
    if (clientComposition !== undefined) {
      throw new Error("Client projection topology requires hosted synchronization.");
    }
    if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0
      || snapshot.registryDigest !== snapshot.registry.digest
      || snapshot.libraries.length !== snapshot.registry.libraries.length) {
      throw new Error("LiveMap topology snapshot envelope is malformed.");
    }
    const hosted = require_hosted_state();
    const candidates: Array<Readonly<{
      state: LiveMapLibraryState;
      prepared: ReturnType<typeof prepare_livemap_root>;
      css?: import("../../internal/css/portable-document-stylesheet.js").PortableDocumentStylesheet;
      projectedValue?: OrderedProjectedValue;
      newlyInstalled: boolean;
      schema: HsonSchema;
      name: string;
    }>> = [];
    let systemRoot: HsonNode | undefined;
    let systemValue: OrderedProjectedValue | undefined;
    for (let index = 0; index < snapshot.registry.libraries.length; index += 1) {
      const entry = snapshot.registry.libraries[index];
      const encoded = snapshot.libraries[index];
      if (entry === undefined || encoded === undefined || entry.name !== encoded.name
        || entry.mode !== encoded.mode || entry.schema !== encoded.schema
        || entry.schemaDigest !== encoded.schemaDigest) {
        throw new Error("LiveMap topology snapshot Library metadata is malformed.");
      }
      const root = decode_hosted_root(encoded.root);
      admit_portable_hson_node(root, "LiveMap topology snapshot");
      const schema = HsonSchemaHandle.fromHson(entry.schema);
      const prepared = prepare_livemap_root(root, entry.mode === "document" ? "document" : "data");
      if (prepared.mode !== entry.mode) throw new Error("LiveMap topology snapshot root mode disagrees with registry.");
      must_hson_schema_family(schema, entry.mode === "document" ? "document" : "data");
      must_hson_schema_root(schema, prepared.root);
      if (entry.scope === "hson-internal") {
        if (systemState === undefined || systemState.transportName !== entry.name
          || systemState.hsonSchema.toHson() !== entry.schema || entry.mode !== "data-object") {
          throw new Error("LiveMap topology snapshot system state is incompatible.");
        }
        systemRoot = prepared.root;
        systemValue = must_projected_root_value(prepared.root);
      } else {
        const old = hosted.byName.get(entry.name);
        const compatible = old !== undefined && old.scope === undefined
          && old.mode === entry.mode && old.schema.toHson() === entry.schema;
        const state = compatible
          ? require_library(old.identity as LiveMapLibraryIdentity)
          : make_livemap_library(prepared, schema);
        candidates.push(Object.freeze({ name: entry.name, state, prepared, schema, newlyInstalled: !compatible,
          ...(entry.mode === "document" ? { css: decode_portable_document_stylesheet(encoded.css) } : {}),
          projectedValue: prepared.mode === "document" ? undefined : must_projected_root_value(prepared.root) }));
      }
    }
    if (systemState !== undefined && systemRoot === undefined) {
      throw new Error("LiveMap topology snapshot omitted configured system state.");
    }
    const bindings: HostedRegistryBinding[] = candidates.map(({ name, state, schema }) => Object.freeze({
      name, identity: state.identity, mode: state.mode, schema,
    }));
    if (systemState !== undefined) bindings.push(Object.freeze({
      name: systemState.transportName,
      scope: "hson-internal",
      identity: systemState.identity,
      mode: "data-object",
      schema: systemState.hsonSchema,
    }));
    const registry = make_hosted_registry(bindings);
    if (registry.digest !== snapshot.registry.digest
      || JSON.stringify(registry) !== JSON.stringify(snapshot.registry)) {
      throw new Error("LiveMap topology snapshot registry is inconsistent.");
    }
    const previousRevision = mapRevision;
    const changedLibraries = Object.freeze(candidates
      .filter(({ state, prepared, newlyInstalled, css }) => newlyInstalled || !canonical_graph_equal(state.root, prepared.root)
        || (css !== undefined && !portable_document_stylesheet_equal(stylesheet(state.identity), css)))
      .map(({ state }) => state.identity));
    // Portable restoration starts a fresh identity epoch. Existing shared
    // records remain live; removed/replaced identities disappear from lookup.
    mapIdentityEpoch.replace([]);
    for (const { state, prepared, projectedValue, css } of candidates) {
      Object.assign(state, {
        root: prepared.root,
        documentOverlay: prepared.documentOverlay,
        projectedOverlay: prepared.projectedOverlay,
        projectedValue,
        ...(css === undefined ? {} : { stylesheet: css }),
      });
    }
    libraryRegistry.replace(candidates.map(({ state }) => state));
    if (systemState !== undefined && systemRoot !== undefined && systemValue !== undefined) {
      systemState.root = systemRoot;
      systemState.projectedValue = systemValue;
    }
    hostedRegistry = registry;
    hostedBindingsByIdentity = new Map(bindings.map((binding) => [binding.identity, binding]));
    hostedBindingsByName = new Map(bindings.map((binding) => [binding.name, binding]));
    mapRevision = snapshot.revision;
    transitionController.invalidate();
    const restored = Object.freeze(candidates.map(({ state }) => state.identity));
    afterTopologyInstall?.(restored);
    const event = Object.freeze({ previousRevision, revision: mapRevision, libraries: restored,
      changedLibraries, continuity: "new-epoch" as const });
    enqueuePublication(() => {
      for (const observer of [...aggregateRestoreObservers]) observer(event);
      publishAuthorityPosition();
    });
  }

  function restore_libraries_aggregate(
    snapshot: LiveMapSnapshot | HostedLiveMapSnapshot,
    authority?: HostedAuthorityFence,
    afterTopologyInstall?: (identities: readonly LiveMapLibraryIdentity[]) => void,
  ): void {
    transitionController.assertPublicMutationAllowed();
    const hosted = require_hosted_state();
    const identity = "identity" in snapshot ? snapshot.identity : undefined;
    const proof = identity === undefined ? undefined : hostedSnapshotProvenance.get(snapshot);
    if (identity !== undefined && (proof === undefined || proof.owner !== mapIdentityEpoch.owner
      || proof.epoch !== mapIdentityEpoch.current() || proof.bytes !== JSON.stringify(snapshot))) {
      throw new Error("Exact hosted snapshot requires its original living runtime owner and epoch.");
    }
    if ("identity" in snapshot) assert_hosted_libraries_snapshot_shape(snapshot);
    else assert_libraries_snapshot_shape(snapshot);
    assert_libraries_snapshot_bound(snapshot);
    if (identity === undefined && authority === undefined
      && snapshot.registry.digest !== hosted.registry.digest) {
      restore_local_topology(snapshot, afterTopologyInstall);
      return;
    }
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
      css?: import("../../internal/css/portable-document-stylesheet.js").PortableDocumentStylesheet;
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
      if (identity === undefined) admit_portable_hson_node(root, "LiveMap Libraries snapshot");
      const prepared = prepare_livemap_root(root, entry.mode === "document" ? "document" : "data");
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
        ...(prepared.mode === "document" ? { css: decode_portable_document_stylesheet(encoded.css) } : {}),
        ...((proof?.overlays.get(entry.name)?.document ?? prepared.documentOverlay) === undefined
          ? {} : { documentOverlay: proof?.overlays.get(entry.name)?.document ?? prepared.documentOverlay }),
        ...((proof?.overlays.get(entry.name)?.projected ?? prepared.projectedOverlay) === undefined ? {} : {
          projectedOverlay: proof?.overlays.get(entry.name)?.projected ?? prepared.projectedOverlay,
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
      ...(candidate.css === undefined ? {} : { stylesheet: candidate.css }),
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
      .filter((candidate) => !canonical_graph_equal(candidate.library.root, candidate.root)
        || (candidate.css !== undefined && !portable_document_stylesheet_equal(stylesheet(candidate.library.identity), candidate.css)))
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
        ...(candidate.css === undefined ? {} : { stylesheet: candidate.css }),
      });
    }
    if (systemCandidate !== undefined) {
      systemCandidate.state.root = systemCandidate.root;
      systemCandidate.state.projectedValue = systemCandidate.projectedValue;
    }
    if (identity === undefined) mapIdentityEpoch.replace([]);
    else if (issuedLedger !== undefined) mapIdentityEpoch.install(make_livemap_issued_quid_ledger([
      ...enumerate_livemap_issued_quids(mapIdentityEpoch.issued()),
      ...enumerate_livemap_issued_quids(issuedLedger),
    ]));
    mapRevision = snapshot.revision;
    if (authority !== undefined) hostedFence = Object.freeze({ ...authority });
    transitionController.invalidate();
    // A hosted recovery snapshot is an atomic replacement boundary, not a
    // fabricated operation commit.  Selected document libraries use this to
    // deliver their normal in-place snapshot observation to Mirror while
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

  function restore_hosted_aggregate(snapshot: HostedLiveMapSnapshot, authorityOverride?: HostedAuthorityFence): void {
    assert_hosted_libraries_snapshot_shape(snapshot);
    const proof = hostedSnapshotProvenance.get(snapshot);
    if (proof === undefined || proof.owner !== mapIdentityEpoch.owner
      || proof.epoch !== mapIdentityEpoch.current() || proof.bytes !== JSON.stringify(snapshot)) {
      throw new Error("Exact hosted snapshot requires its original living runtime owner and epoch.");
    }
    if (typeof snapshot.authority.logicalMapId !== "string"
      || snapshot.authority.logicalMapId.length === 0
      || typeof snapshot.authority.incarnationId !== "string"
      || snapshot.authority.incarnationId.length === 0) {
      throw new Error("Hosted aggregate snapshot authority is malformed.");
    }
    restore_libraries_aggregate(snapshot, authorityOverride ?? snapshot.authority);
  }

  function restore_client_hosted_aggregate(snapshot: PortableAggregateSnapshot): void {
    if (clientComposition !== undefined) {
      restore_client_projection(snapshot);
      return;
    }
    const portable = portable_aggregate_snapshot_as_local(snapshot);
    // An internal complete-registry mirror has no client-local partition.
    // Restoring it starts a fresh local identity epoch and fences prior handles.
    restore_libraries_aggregate(portable, snapshot.authority);
  }

  function restore_client_projection(
    snapshot: PortableAggregateSnapshot,
    afterTopologyInstall?: (projected: readonly Readonly<{ name: string; identity: LiveMapLibraryIdentity }>[],
      retired: readonly LiveMapLibraryIdentity[]) => void,
  ): void {
    const composition = clientComposition;
    if (composition === undefined) throw new Error("Client projection is not configured.");
    if (clientManagementOwner === undefined
      || transitionController.managedExecutionOwner() !== clientManagementOwner) {
      throw new Error("Client projection restore requires Echo management.");
    }
    assert_portable_aggregate_snapshot_shape(snapshot);
    if (snapshot.authority.logicalMapId !== composition.authority.logicalMapId) {
      throw new Error("Client projection snapshot authority is incompatible.");
    }
    const hosted = require_hosted_state();
    const localStates = libraryRegistry.all().filter((state) => !composition.projected.has(state.identity));
    const localBindings = localStates.map((state) => {
      const binding = hosted.byIdentity.get(state.identity);
      if (binding === undefined) throw new Error("Client-local Library binding is unavailable.");
      return binding;
    });
    const candidates: Array<Readonly<{
      name: string;
      state: LiveMapLibraryState;
      root: HsonNode;
      documentOverlay?: import("./livemap.document.identity.js").LiveMapDocumentIdentityOverlay;
      projectedOverlay?: LiveMapProjectedIdentityOverlay;
      projectedValue?: OrderedProjectedValue;
      css?: import("../../internal/css/portable-document-stylesheet.js").PortableDocumentStylesheet;
      retained: boolean;
      graphChanged: boolean;
      changed: boolean;
      binding: HostedRegistryBinding;
    }>> = [];
    let nextSystem: LiveMapSystemState | undefined;
    let systemBinding: HostedRegistryBinding | undefined;
    for (let index = 0; index < snapshot.registry.libraries.length; index += 1) {
      const entry = snapshot.registry.libraries[index];
      const encoded = snapshot.libraries[index];
      if (entry === undefined || encoded === undefined || entry.name !== encoded.name
        || entry.mode !== encoded.mode || entry.schema !== encoded.schema
        || entry.schemaDigest !== encoded.schemaDigest) {
        throw new Error("Client projection snapshot Library metadata is incompatible.");
      }
      const oldBinding = composition.bindings.get(entry.name);
      if (oldBinding === undefined && hosted.byName.has(entry.name)) {
        throw new Error("Client-local Library collides with the authority projection.");
      }
      const schema = HsonSchemaHandle.fromHson(entry.schema);
      const root = decode_hosted_root(encoded.root, HOSTED_MAX_SNAPSHOT_BYTES);
      admit_portable_hson_node(root, "Client projection snapshot");
      const prepared = prepare_livemap_root(root, entry.mode === "document" ? "document" : "data");
      if (prepared.mode !== entry.mode) throw new Error("Client projection snapshot root mode is incompatible.");
      must_hson_schema_root(schema, prepared.root);
      if (entry.scope === "hson-internal") {
        if (nextSystem !== undefined) throw new Error("Client projection has duplicate system state.");
        nextSystem = prepare_system_state(Object.freeze({
          key: INTERACTION_RESERVED_LIBRARY_KEY, transportName: entry.name,
          root: prepared.root, hsonSchema: schema,
        }));
        systemBinding = Object.freeze({ name: entry.name, scope: "hson-internal", identity: systemIdentity,
          mode: entry.mode, schema });
      } else {
        const retained = oldBinding !== undefined && oldBinding.scope === undefined
          && oldBinding.mode === entry.mode && oldBinding.schema.toHson() === entry.schema;
        const previous = retained ? require_library(oldBinding.identity as LiveMapLibraryIdentity) : undefined;
        const css = entry.mode === "document" ? decode_portable_document_stylesheet(encoded.css)
          : undefined;
        const state = previous ?? make_livemap_library(prepared, schema);
        const graphChanged = previous === undefined || !canonical_graph_equal(previous.root, prepared.root);
        const changed = graphChanged
          || (css !== undefined && !portable_document_stylesheet_equal(stylesheet(state.identity), css));
        const binding: HostedRegistryBinding = Object.freeze({ name: entry.name, identity: state.identity,
          mode: entry.mode, schema });
        candidates.push(Object.freeze({
          name: entry.name, state, binding, retained, graphChanged, changed,
          root: graphChanged ? prepared.root : state.root,
          documentOverlay: graphChanged ? prepared.documentOverlay : state.documentOverlay,
          projectedOverlay: graphChanged ? prepared.projectedOverlay : state.projectedOverlay,
          projectedValue: entry.mode === "document" ? undefined
            : graphChanged ? must_projected_root_value(prepared.root) : state.projectedValue,
          css,
        }));
      }
    }
    const projectedBindings = candidates.map((candidate) => candidate.binding);
    const nextBindings = [...localBindings, ...projectedBindings,
      ...(systemBinding === undefined ? [] : [systemBinding])];
    const nextRegistry = make_hosted_registry(nextBindings);
    const nextProjectedRegistry = make_hosted_registry([...projectedBindings,
      ...(systemBinding === undefined ? [] : [systemBinding])]);
    if (nextProjectedRegistry.digest !== snapshot.registryDigest
      || JSON.stringify(nextProjectedRegistry) !== JSON.stringify(snapshot.registry)) {
      throw new Error("Client projection snapshot registry is inconsistent.");
    }
    const projected = new Set(candidates.map((candidate) => candidate.state.identity));
    const retired = [...composition.projected].filter((identity) => !projected.has(identity));
    const beforeActive = aggregate_quid_locations(libraryRegistry.all());
    const afterStates = [...localStates, ...candidates.map((candidate) => Object.freeze({
      ...candidate.state, root: candidate.root,
      documentOverlay: candidate.documentOverlay, projectedOverlay: candidate.projectedOverlay,
      projectedValue: candidate.projectedValue,
      ...(candidate.css === undefined ? {} : { stylesheet: candidate.css }),
    }))];
    const afterActive = aggregate_quid_locations(afterStates);
    const ledger = stage_livemap_identity_epoch(mapIdentityEpoch.issued(), beforeActive.keys(), afterActive.keys());
    const previousRevision = mapRevision;
    const changedLibraries = Object.freeze(candidates
      .filter((candidate) => candidate.graphChanged)
      .map((candidate) => candidate.state.identity));
    const semanticChanged = retired.length > 0 || candidates.some((candidate) => candidate.changed)
      || (systemState === undefined) !== (nextSystem === undefined)
      || (systemState !== undefined && nextSystem !== undefined
        && !canonical_graph_equal(systemState.root, nextSystem.root));
    // The complete candidate is validated before this single installation.
    mapIdentityEpoch.install(ledger);
    for (const candidate of candidates) {
      if (candidate.changed) Object.assign(candidate.state, {
        root: candidate.root, documentOverlay: candidate.documentOverlay,
        projectedOverlay: candidate.projectedOverlay, projectedValue: candidate.projectedValue,
        ...(candidate.css === undefined ? {} : { stylesheet: candidate.css }),
      });
      projectedCaptureContinuity.set(candidate.state.identity, Object.freeze({}));
    }
    for (const identity of retired) projectedCaptureContinuity.delete(identity);
    libraryRegistry.replace([...localStates, ...candidates.map((candidate) => candidate.state)]);
    systemState = nextSystem;
    hostedRegistry = nextRegistry;
    hostedBindingsByIdentity = new Map(nextBindings.map((binding) => [binding.identity, binding]));
    hostedBindingsByName = new Map(nextBindings.map((binding) => [binding.name, binding]));
    if (semanticChanged) mapRevision += 1;
    hostedFence = Object.freeze({ ...snapshot.authority });
    clientComposition = Object.freeze({ authority: hostedFence, revision: snapshot.revision,
      registry: snapshot.registry, projected,
      bindings: new Map([...projectedBindings, ...(systemBinding === undefined ? [] : [systemBinding])]
        .map((binding) => [binding.name, binding])) });
    transitionController.invalidate();
    afterTopologyInstall?.(Object.freeze(candidates.map((candidate) => Object.freeze({
      name: candidate.name, identity: candidate.state.identity,
    }))), Object.freeze(retired));
    const event = Object.freeze({
      previousRevision,
      revision: mapRevision,
      libraries: Object.freeze(candidates.filter((candidate) => candidate.retained)
        .map((candidate) => candidate.state.identity)),
      changedLibraries,
      continuity: "same-epoch" as const,
    });
    enqueuePublication(() => {
      for (const observer of [...aggregateRestoreObservers]) observer(event);
      publishAuthorityPosition();
    });
  }

  function replay_portable_hosted_aggregate(input: PortableAggregateCommit, durable: boolean, authorityRev?: number): LiveMapAggregateCommit | undefined {
    if (clientComposition === undefined) transitionController.assertPublicMutationAllowed();
    const hosted = require_hosted_state();
    const composition = clientComposition;
    const decoded = decode_portable_aggregate_commit(input,
      composition?.registry ?? hosted.registry,
      composition?.bindings ?? hosted.byName);
    if (input.authority.logicalMapId !== hosted.fence.logicalMapId
      || input.authority.incarnationId !== hosted.fence.incarnationId) {
      throw new Error("Hosted client commit authority fence is incompatible.");
    }
    if (composition !== undefined || authorityRev !== undefined) {
      if (authorityRev === undefined || input.prevRev !== authorityRev) {
        throw new LiveMapRevError(input.prevRev, authorityRev ?? -1);
      }
    } else if (input.prevRev !== mapRevision) throw new LiveMapRevError(input.prevRev, mapRevision);
    const writes: LiveMapAggregateWrite[] = decoded.map((entry): LiveMapAggregateWrite => {
      if (entry.css !== undefined) return Object.freeze({
        target: aggregate_target(entry.library.identity as LiveMapLibraryIdentity, []),
        kind: "css", operation: entry.css,
      });
      const path = "path" in entry.semantic ? entry.semantic.path : (
        "target" in entry.semantic ? entry.semantic.target.path : []
      );
      const target = entry.library.scope === "hson-internal"
        ? aggregate_system_target(entry.library.identity as LiveMapSystemIdentity, path)
        : aggregate_target(entry.library.identity as LiveMapLibraryIdentity, path);
      if (entry.projected !== undefined) return Object.freeze({ target, kind: "replay-data", operation: entry.projected });
      if (entry.graph === undefined || entry.graph.op === "ensure-quid") {
        throw new Error("Hosted client event contains an identity-only operation.");
      }
      return Object.freeze({ target, kind: "graph", operation: entry.graph });
    });
    const transition = prepare_authority_transition(writes);
    if (composition !== undefined) return transitionController.acceptAuthority(transition, "propagate", () => {
      clientComposition = Object.freeze({ ...composition, revision: input.rev });
    }).commit;
    const local = transition.commit.hosted;
    if (durable && !transition.commit.changed) {
      // The old runtime may have distinguished equal-content subjects only
      // through local identity. The decoded path effect is valid but collapses
      // in this fresh runtime; retain its authority revision without a claim.
      transitionController.discardAuthority(transition);
      mapRevision = input.rev;
      transitionController.invalidate();
      publishAuthorityPosition();
      return undefined;
    }
    const localClient = local === undefined ? undefined : make_portable_aggregate_commit(local);
    const matchesPortableEffects = localClient !== undefined
      && localClient.format === input.format
      && JSON.stringify(localClient.authority) === JSON.stringify(input.authority)
      && localClient.registryDigest === input.registryDigest
      && (authorityRev !== undefined || (localClient.prevRev === input.prevRev && localClient.rev === input.rev))
      && (() => {
        let applied = 0;
        for (const expected of input.operations) {
          if (applied < localClient.operations.length
            && JSON.stringify(localClient.operations[applied]) === JSON.stringify(expected)) {
            applied += 1;
          } else if (expected.domain !== "graph") {
            return false;
          }
          // A valid graph operation may collapse against this runtime's
          // identity-free graph, while a following system/path effect remains.
        }
        return applied === localClient.operations.length;
      })();
    if (!matchesPortableEffects) {
      transitionController.discardAuthority(transition);
      throw new Error("Hosted client replay did not reproduce its portable operation semantics.");
    }
    return transitionController.acceptAuthority(transition).commit;
  }

  function replay_client_hosted_aggregate(input: PortableAggregateCommit, authorityRev?: number): LiveMapAggregateCommit {
    const replayed = replay_portable_hosted_aggregate(input, false, authorityRev);
    if (replayed === undefined) throw new Error("Hosted client replay made no authority progress.");
    return replayed;
  }

  function replay_durable_hosted_aggregate(input: PortableAggregateCommit): void {
    replay_portable_hosted_aggregate(input, true);
  }

  function replay_hosted_aggregate(input: HostedAggregateCommit): LiveMapAggregateCommit {
    transitionController.assertPublicMutationAllowed();
    const proof = hostedCommitProvenance.get(input);
    if (proof === undefined || proof.owner !== mapIdentityEpoch.owner
      || proof.epoch !== mapIdentityEpoch.current() || proof.bytes !== JSON.stringify(input)) {
      throw new Error("Exact hosted replay requires its original living runtime owner and epoch.");
    }
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
      if (entry.css !== undefined) return Object.freeze({
        target: aggregate_target(entry.library.identity as LiveMapLibraryIdentity, []),
        kind: "css", operation: entry.css,
      });
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
    addLibraries: add_libraries,
    prepareAddLibrariesManaged: (owner, definitions) => transitionController.runManaged(
      owner,
      () => prepare_add_libraries(definitions),
    ),
    hostedRegistry: () => require_hosted_state().registry,
    hostedPosition: () => {
      const hosted = require_hosted_state();
      return Object.freeze({ authority: hosted.fence, revision: mapRevision, registryDigest: hosted.registry.digest });
    },
    setInitialHostedAuthority: (authority) => {
      transitionController.assertPublicMutationAllowed();
      const hosted = require_hosted_state();
      if (mapRevision !== 0 || typeof authority.logicalMapId !== "string" || !authority.logicalMapId
        || typeof authority.incarnationId !== "string" || !authority.incarnationId) {
        throw new Error("A hosted authority identity may be set only before its first transition.");
      }
      hostedFence = Object.freeze({ ...authority });
      transitionController.invalidate();
      const continuity = hosted.fence.logicalMapId === authority.logicalMapId
        && hosted.fence.incarnationId === authority.incarnationId ? "same-epoch" as const : "new-epoch" as const;
      const event = Object.freeze({ previousRevision: mapRevision, revision: mapRevision,
        libraries: Object.freeze(libraryRegistry.all().map((library) => library.identity)),
        changedLibraries: Object.freeze([]), continuity });
      enqueuePublication(() => {
        for (const observer of [...aggregateRestoreObservers]) observer(event);
        publishAuthorityPosition();
      });
    },
    captureSelectedHosted: capture_selected_hosted,
    configureClientComposition: configure_client_composition,
    clientProjection: () => clientComposition === undefined ? undefined : Object.freeze({
      authority: clientComposition.authority,
      registry: clientComposition.registry,
      revision: clientComposition.revision,
      libraries: Object.freeze([...clientComposition.bindings.keys()]),
    }),
    extendClientProjectionManaged: (owner, names, expectedDigest) => transitionController.runManaged(owner, () => {
      const composition = clientComposition;
      const hosted = require_hosted_state();
      if (composition === undefined || clientManagementOwner !== owner) {
        throw new Error("Client projection topology requires Echo management.");
      }
      const bindings = new Map(composition.bindings);
      const projected = new Set(composition.projected);
      for (const name of names) {
        if (bindings.has(name)) throw new Error("Client projection already owns the Library.");
        const binding = hosted.byName.get(name);
        if (binding === undefined || binding.scope === "hson-internal") {
          throw new Error("Client projection topology is unavailable.");
        }
        bindings.set(name, binding);
        projected.add(binding.identity as LiveMapLibraryIdentity);
      }
      const application = [...bindings.values()].filter((binding) => binding.scope !== "hson-internal")
        .sort((a, b) => a.name.localeCompare(b.name));
      const system = [...bindings.values()].filter((binding) => binding.scope === "hson-internal");
      const registry = make_hosted_registry([...application, ...system]);
      if (registry.digest !== expectedDigest) throw new Error("Client projection registry digest is incompatible.");
      for (const name of names) {
        const binding = bindings.get(name);
        if (binding !== undefined) projectedCaptureContinuity.set(binding.identity as LiveMapLibraryIdentity, Object.freeze({}));
      }
      clientComposition = Object.freeze({ ...composition, registry, projected, bindings });
    }),
    prepareClientProjectionSystemManaged: (owner, root) => transitionController.runManaged(owner, () => {
      if (clientComposition === undefined || clientManagementOwner !== owner || systemState === undefined) {
        throw new Error("Client projected system state is unavailable.");
      }
      admit_portable_hson_node(root, "Client projected system root");
      const prepared = prepare_livemap_root(root, "data");
      if (prepared.mode !== "data-object") throw new Error("Client projected system root mode is incompatible.");
      must_hson_schema_root(systemState.hsonSchema, prepared.root);
      const value = must_projected_root_value(prepared.root);
      return () => {
        if (systemState !== undefined) {
          systemState.root = prepared.root;
          systemState.projectedValue = value;
        }
      };
    }),
    captureLibraries: capture_libraries_aggregate,
    stylesheet,
    commitStylesheet: commit_stylesheet,
    captureHosted: capture_hosted_aggregate,
    captureSemanticCheckpoint: capture_semantic_checkpoint,
    installSemanticCheckpoint: install_semantic_checkpoint,
    restoreLibraries: (snapshot, afterTopologyInstall) => restore_libraries_aggregate(snapshot, undefined, afterTopologyInstall),
    restorePortableLibraries: (snapshot) => restore_libraries_aggregate(snapshot),
    restoreHosted: restore_hosted_aggregate,
    restoreClientHosted: restore_client_hosted_aggregate,
    restoreClientHostedManaged: (owner, snapshot, afterTopologyInstall) => transitionController.runManaged(
      owner,
      () => clientComposition === undefined ? restore_client_hosted_aggregate(snapshot)
        : restore_client_projection(snapshot, afterTopologyInstall),
    ),
    restoreHostedManaged: (owner, snapshot) => transitionController.runManaged(
      owner,
      () => restore_hosted_aggregate(snapshot),
    ),
    replayHosted: replay_hosted_aggregate,
    replayClientHosted: replay_client_hosted_aggregate,
    replayDurableHosted: replay_durable_hosted_aggregate,
    replayClientHostedManaged: (owner, commit, authorityRev) => transitionController.runManaged(
      owner,
      () => replay_client_hosted_aggregate(commit, authorityRev),
    ),
    replayHostedManaged: (owner, commit) => transitionController.runManaged(
      owner,
      () => replay_hosted_aggregate(commit),
    ),
    advanceHostedProgressManaged: (owner, progress) => transitionController.runManaged(owner, () => {
      const hosted = require_hosted_state();
      const composition = clientComposition;
      if (progress.logicalMapId !== hosted.fence.logicalMapId
        || progress.incarnationId !== hosted.fence.incarnationId
        || progress.registryDigest !== (composition?.registry.digest ?? hosted.registry.digest)) {
        throw new Error("Hosted authority progress fence is incompatible.");
      }
      if (composition !== undefined) {
        if (!Number.isSafeInteger(progress.prevRev) || progress.prevRev !== composition.revision
          || progress.rev !== progress.prevRev + 1) {
          throw new LiveMapRevError(progress.prevRev, composition.revision);
        }
        clientComposition = Object.freeze({ ...composition, revision: progress.rev });
        return progress.rev;
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
    projectedOverlay: (library) => {
      const overlay = require_library(library).projectedOverlay;
      if (overlay === undefined) throw new Error("Selected LiveMap library is not a data library.");
      return overlay;
    },
    documentCaptureContinuity: (library) => projectedCaptureContinuity.get(require_library(library).identity),
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
    preparedSystemRoot: (transition) => {
      if (!preparedSystemRoots.has(transition)) throw new Error("Unknown prepared authority transition.");
      return preparedSystemRoots.get(transition);
    },
    accept: transitionController.acceptAuthority,
    reserve: transitionController.reserveAuthority,
    discard: transitionController.discardAuthority,
    claimManagement: (owner) => {
      transitionController.claimManagement(owner, () => Promise.reject(new LiveMapTransitionError(
        "LIVEMAP_MANAGED_MUTATION_REJECTED",
        "Aggregate LiveMap mutation is controlled by an exclusive Locus authority.",
      )));
      if (clientComposition !== undefined) clientManagementOwner = owner;
    },
    releaseManagement: (owner) => {
      transitionController.releaseManagement(owner);
      if (clientManagementOwner === owner) clientManagementOwner = undefined;
    },
    commit: (writes) => transitionController.acceptAuthority(prepare_authority_transition(writes)).commit,
    commitDocumentMutation: commit_aggregate_document_mutation,
    documentCommitFor: (library, commit) => documentCommitByAggregate.get(commit)?.get(library),
    documentRootFor: (library, commit) => documentRootByAggregate.get(commit)?.get(library),
    aggregateCommitForDocument: (commit) => aggregateByDocumentCommit.get(commit),
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

  return aggregateAuthority;
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


/** Enforce the sole public Schema authority against one complete canonical root. */
function must_hson_schema_family(schema: HsonSchema, family: "data" | "document"): void {
  const kind = compiled_hson_schema_of(schema).semantic.kind;
  const schemaFamily = kind === "document" || kind === "document-element" ? "document" : "data";
  if (schemaFamily !== family) throw new Error(`LiveMap ${family} Library requires a ${family} Schema.`);
}

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
