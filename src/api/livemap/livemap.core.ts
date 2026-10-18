import { read_livemap_document_logical_location } from "./livemap.document.location.js";
import { lower_document_css_command } from "../../internal/document-css-commands.js";
import { plan_collection_command } from "./livemap.collection-command.js";
import { governed_document_element_target, governed_document_slot, governed_document_remove_slot, governed_document_insert_slot, governed_document_move_target } from "../../internal/governed-document.js";
import { own_semantic_checkpoint } from "./livemap.semantic-checkpoint.js";
import { decode_document_scoped_quads, type DocumentScopedQuadRecord } from "./livemap.document.scoped-quad-codec.js";
import { make_document_scoped_quads } from "./livemap.document.scoped-quad.js";
import { local_scoped_css_operation, prepare_document_scoped_css_operation, encode_document_scoped_effects, replay_document_scoped_effects } from "./livemap.document.scoped-effects.js";
import { PART_COLLECTION_VALIDATION, own_data_library_validation, validate_data_library, type DataLibraryValidation } from "./livemap.parts.js";
import { allocate_livemap_quid } from "./livemap.quid-allocation.js";
import { prepare_document_scoped_composition, prepare_document_scoped_operations, prepare_document_scoped_reconstruction } from "./livemap.document.scoped-composition.js";
import { prepare_document_scoped_library_styles, type PreparedDocumentScopedLibrary } from "./livemap.document.scoped-library.js";
import { normalize_document_scoped_library_subjects, capture_document_scoped_library, decode_document_scoped_library, own_document_scopes, restore_document_scoped_library_styles } from "./livemap.document.scoped-portable.js";
import { expand_document_composition, document_composition_options, has_part_connector, type DocumentCompositionStyle } from "./livemap.document.composition.js";
import { merge_part_stylesheets, retire_part_styles } from "../../internal/css/part-stylesheet.js";
import { registry_from_entries } from "./livemap.hosted.js";
import {
  make_document_quad_bindings,
  retain_document_quad_bindings,
  mark_quad_document_root,
  resolve_document_quad,
  project_document_correspondence,
  decode_document_quads,
  document_quad_disposition,
  disposable_document_quad_payloads,
  own_document_quads,
  assert_portable_document_css_correspondence,
  type DocumentQuadBindings,
  type DocumentQuadCorrespondence,
} from "./livemap.document.quad.js";
import type { PortableQuadRestoration, PortableDocumentHandoff } from "./livemap.internal.js";
import type { PortableDocumentQuads } from "../../types/livemap.types.js";
import { hson_schema_digest, hson_schema_source_digest } from "../schema/hson-schema.js";
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
  ordered_projected_array,
  ordered_projected_object,
  ordered_projected_value_equal,
  type OrderedProjectedObject,
  type OrderedProjectedValue
} from "../../core/ordered-projected-value.js";
import { projected_value_to_hson_root } from "../../core/projected-value-graph.js";
import { materialize_projected_value } from "../../core/projected-value-materialization.js";
import type { HsonNode, JsonValue } from "../../core/types.js";
import { rewrite_interaction_subjects, validate_interaction_descriptor_ids, validate_interaction_subjects } from "../../internal/interaction-path-maintenance.js";
import { interaction_descriptors_from_root, merge_interaction_descriptors, partition_interaction_descriptors } from "../../internal/interaction-partitions.js";
import { INTERACTION_RESERVED_LIBRARY_KEY, INTERACTION_RESERVED_LIBRARY_TRANSPORT_NAME } from "../../internal/interaction-storage.js";
import { interaction_schema_internal } from "../interactions/interactions.projection.js";
import { validate_hson_schema_graph } from "../../internal/schema-hson-validation/validate-canonical-hson.js";
import { ANY_DATA, ANY_DOCUMENT, HsonSchema as HsonSchemaHandle, compiled_hson_schema_of } from "../schema/hson-schema.js";
import type { HostedLiveMapSnapshot, LiveMapCssOp, LiveMapDataOp, LiveMapDocumentPath, LiveMapGraphCommit, LiveMapGraphOp, LiveMapSnapshot, LivePath } from "../../types/livemap.types.js";
import { apply_portable_document_css_op, canonical_portable_document_css_op } from "../../internal/css/portable-document-operations.js";
import { decode_portable_document_stylesheet, empty_portable_document_stylesheet, encode_portable_document_stylesheet, portable_document_stylesheet_equal, render_portable_document_stylesheet } from "../../internal/css/portable-document-stylesheet.js";
import { document_css_mentions_subject_identity, document_css_subject_identities, translate_document_css_identities } from "../../internal/css/css-identity-translation.js";
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
import { clone_livemap_document_exact_view, livemap_document_identity_overlay_equal, livemap_document_identity_quids, register_livemap_document_identity_at_path, register_livemap_document_identity_effects, type LiveMapDocumentIdentityEffect } from "./livemap.document.identity.js";
import { canonical_graph_equal } from "./livemap.document.install.js";
import { classify_live_root_mode, prepare_livemap_root } from "./livemap.document.js";
import { admit_owned_livemap_root, admit_public_livemap_root } from "./livemap.node-admission.js";
import {
  admit_public_document_graph_operation,
  lower_document_attrs_command,
  prepare_document_graph_operation,
  type PreparedDocumentMutation
} from "./livemap.document.mutation.js";
import { document_path_equal, resolve_document_path, validate_document_path } from "./livemap.document.path.js";
import { livemap_document_identity_quid_unavailable, register_livemap_document_identity_candidate_commit } from "./livemap.document.registration.js";
import {
  clone_live_root,
  overwrite_hson_node,
  project_live_path,
  resolve_value_node
} from "./livemap.editor.js";
import { LiveMapDocumentMutationError, LiveMapProjectedMutationError, LiveMapReplayError, LiveMapRevError } from "./livemap.error.js";
import { deliver_livemap_observers, report_livemap_observer_failure } from "./livemap.observer-delivery.js";
import { must_live_path, must_ordered_projected_value, path_kind_error } from "./livemap.guard.js";
import {
  assert_hosted_libraries_snapshot_shape,
  assert_libraries_snapshot_bound,
  assert_libraries_snapshot_shape,
  assert_portable_aggregate_snapshot_shape,
  decode_hosted_commit,
  decode_hosted_root,
  decode_portable_aggregate_commit,
  decode_private_scoped_aggregate_commit,
  encode_authoritative_scoped_commit,
  type PrivateScopedAggregateCommit,
  encode_hosted_root,
  HOSTED_MAX_ISSUED_QUIDS,
  HOSTED_MAX_SNAPSHOT_BYTES,
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
/** Exact root assignment that retains the living map's identity epoch. */
type LiveMapRootAssignmentWriteOp = Readonly<{
  kind: "root-assignment";
  path: readonly [];
  value: OrderedProjectedValue;
}>;
type LiveMapProjectedReplaceWriteOp = LiveMapProjectedReplaceWrite;
type LiveMapProjectedDeleteWriteOp = LiveMapProjectedDeleteWrite;
type LiveMapProjectedSpliceWriteOp = LiveMapProjectedSpliceWrite;
type LiveMapProjectedRenameWriteOp = LiveMapProjectedRenameWrite;
type LiveMapProjectedMoveWriteOp = LiveMapProjectedMoveWrite;

type LiveMapCoreWriteOp =
  | LiveMapProjectedSetWriteOp
  | LiveMapRootAssignmentWriteOp
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
  /** Portable internal data-Library contract. @internal */
  validation?: "hson-part-collection-v1";
  quads?: PortableDocumentQuads;
  compositionStyles?: readonly DocumentCompositionStyle[];
  /** @internal */
  compositionScopes?: DocumentScopedQuadRecord;
  /** @internal */
  scopes?: DocumentScopedQuadRecord;
  css?: import("../../internal/css/portable-document-stylesheet.js").PortableDocumentStylesheet;
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
  const prepared = roots.map((definition) => {
    const { root, hsonSchema, family, css } = definition;
    const quads = own_document_quads(definition);
    const validation = own_data_library_validation(definition);
    const graph = prepare_livemap_root(root, family);
    if (hsonSchema !== undefined) {
      must_hson_schema_family(hsonSchema, family);
      must_hson_schema_root(hsonSchema, graph.root);
    }
    validate_data_library(graph.root, graph.mode, validation);
    if (css !== undefined && family !== "document") throw new TypeError("Initial CSS requires a document Library.");
    const scopeInput = own_document_scopes(definition);
    if (scopeInput !== undefined && (definition.compositionScopes !== undefined || definition.compositionStyles !== undefined)) {
      throw new TypeError("Initial scoped state cannot also claim authored composition evidence.");
    }
    const scopes = scopeInput === undefined ? undefined : decode_document_scoped_library({
      root: graph.root, scopes: scopeInput, css: css === undefined ? undefined : encode_portable_document_stylesheet(css),
    }).scopes;
    const compositionScopes = definition.compositionScopes === undefined ? undefined : decode_document_scoped_quads(definition.compositionScopes, graph.root);
    return { graph, hsonSchema, css, validation, scopes, compositionScopes, compositionStyles: definition.compositionStyles, quads: decode_document_quads(quads, graph.root, graph.mode) };
  });
  const aggregate = make_livemap_registry_engine(prepared, systems);
  return Object.freeze({ aggregate, identities: aggregate.libraries() });
}



/** Build one map authority around the admitted named library roots. */
function make_livemap_registry_engine(
  registry: readonly Readonly<{
    graph: ReturnType<typeof prepare_livemap_root>;
    hsonSchema?: HsonSchema;
    validation?: DataLibraryValidation;
    quads?: PortableDocumentQuads;
    compositionStyles?: readonly DocumentCompositionStyle[];
    compositionScopes?: DocumentScopedQuadRecord;
    scopes?: DocumentScopedQuadRecord;
    css?: import("../../internal/css/portable-document-stylesheet.js").PortableDocumentStylesheet;
  }>[],
  systems: readonly InitialSystemState[] = [],
): InternalLiveMapAggregateAuthority {
  const states = registry.map(({ graph, hsonSchema, css, validation }) => {
    const state = make_livemap_library(graph, hsonSchema, validation);
    if (css !== undefined) state.stylesheet = css;
    return state;
  });
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
  const portableRestorations = new WeakMap<PortableQuadRestoration, ReadonlyMap<LiveMapLibraryIdentity,
    import("../../internal/css/portable-document-stylesheet.js").PortableDocumentStylesheetRecord>>();
  const portableHandoffs = new WeakSet<PortableDocumentHandoff>();
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
    try {
      while (publicationCursor < publicationQueue.length) {
        const next = publicationQueue[publicationCursor];
        publicationCursor += 1;
        if (next === undefined) continue;
        try {
          next();
        } catch (error) {
          report_livemap_observer_failure("publication", error);
        }
      }
    } finally {
      publicationQueue.length = 0;
      publicationCursor = 0;
      publishing = false;
    }
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
  const aggregatePositionObservers: Array<Readonly<{
    listener: (revision: number) => void;
    phase: "published" | "installed";
  }>> = [];
  const publishAuthorityPosition = (revision = mapRevision): void => {
    deliver_livemap_observers(aggregatePositionObservers.filter(observer => observer.phase === "published"),
      observer => observer.listener(revision), "authority-position");
  };
  // Reuse the owner position signal for q's private terminal latch. Publication
  // can be queued/reentrant, so its live-state observers are too late to prove
  // that a subject was never absent between two exact restorations.
  const publishInstalledPosition = (): void => {
    deliver_livemap_observers(aggregatePositionObservers.filter(observer => observer.phase === "installed"),
      // Reentrant observers can accept a newer authority cut. Each remaining
      // observer sees that installed cut, including progress without graph work.
      observer => observer.listener(clientComposition?.revision ?? mapRevision), "identity-installation");
  };
  const aggregateRestoreObservers: Array<(event: Readonly<{
    previousRevision: number;
    revision: number;
    libraries: readonly LiveMapLibraryIdentity[];
    changedLibraries: readonly LiveMapLibraryIdentity[];
    continuity: "same-epoch" | "new-epoch";
    documentRootRebases?: readonly Readonly<{ library: LiveMapLibraryIdentity; from: string | undefined; to: string | undefined }>[];
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
    const projectedValue = must_projected_root_value(preparedSystem.root);
    if (input.key === INTERACTION_RESERVED_LIBRARY_KEY) {
      validate_interaction_descriptor_ids(ordered_projected_value_at(projectedValue, ["descriptors"]));
    }
    return {
      identity: systemIdentity,
      key: input.key,
      transportName: input.transportName,
      root: preparedSystem.root,
      projectedValue,
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

  function install_initial_document_quads(identity: LiveMapLibraryIdentity, entries: readonly Readonly<{ name: string; quid: string }>[]): void {
    transitionController.assertPublicMutationAllowed();
    transitionController.assertLocalIdentityAllowed();
    if (mapRevision !== 0 || transitionController.managedExecutionOwner() !== undefined) throw new Error("Authored QUAD admission requires private initial construction.");
    const state = require_library(identity);
    if (state.mode !== "document" || state.documentQuads !== undefined) throw new Error("Initial QUAD admission requires an unbound document Library.");
    const bindings = make_document_quad_bindings(entries);
    const overlay = require_document_overlay(state.documentOverlay);
    for (const { name, quid } of entries) {
      if (!mapIdentityEpoch.issued().has(quid) || resolve_document_quad(state.root, overlay, bindings, name, quid) === undefined) {
        throw new Error("Authored QUAD binding requires an active owner-issued subject QUID.");
      }
    }
    transitionController.invalidate();
    identityGeneration += 1;
    state.documentQuads = bindings;
    mark_quad_document_root(state.root, bindings);
  }

  function portable_quads(state: LiveMapLibraryState, issued: LiveMapIssuedQuidLedger = mapIdentityEpoch.issued(), includeCss = true): Readonly<{
    quads?: PortableDocumentQuads;
    css?: import("../../internal/css/portable-document-stylesheet.js").PortableDocumentStylesheetRecord;
  }> {
    if (state.mode !== "document") return {};
    if (state.documentScopes !== undefined) throw new Error("Scoped document capture requires coordinated Echo/checkpoint support.");
    const assertCurrent = capture_fence();
    const css = encode_portable_document_stylesheet(state.stylesheet ?? empty_portable_document_stylesheet());
    const overlay = require_document_overlay(state.documentOverlay);
    const quads = project_document_correspondence(state.root, overlay, state.documentQuads, issued,
      document_css_subject_identities(css, "outbound"));
    const associations = (quads ?? []).map(entry => {
      const quid = overlay.quidAtPath(entry.path);
      if (quid === undefined) throw new Error("CSS correspondence requires a current Library subject.");
      return { ...entry, quid, disposition: document_quad_disposition(entry) };
    });
    const translated = document_css_mentions_subject_identity(css)
      ? translate_document_css_identities(css, "outbound", { associations, assertCurrent }, true) : css;
    assertCurrent();
    return { ...(quads === undefined ? {} : { quads }), ...(includeCss ? { css: translated } : {}) };
  }

  /** Only unpublished candidate overlays receive fresh identities; the ledger is installed atomically later. */
  function reconstruct_quads(prepared: ReturnType<typeof prepare_livemap_root>, input: unknown, reserved: Set<string>,
    exactOverlay?: import("./livemap.document.identity.js").LiveMapDocumentIdentityOverlay,
    correspondence?: DocumentQuadCorrespondence[], foreignPayloads: ReadonlySet<string> = new Set()): Readonly<{
      documentOverlay?: import("./livemap.document.identity.js").LiveMapDocumentIdentityOverlay;
      documentQuads?: DocumentQuadBindings;
    }> {
    const entries = decode_document_quads(input, prepared.root, prepared.mode);
    let overlay = exactOverlay ?? prepared.documentOverlay;
    if (entries === undefined) return { documentOverlay: overlay, documentQuads: undefined };
    if (overlay === undefined) throw new Error("Portable QUAD requires a document overlay.");
    const bindings: { name: string; quid: string }[] = [];
    const sourcePayloads = new Set(entries.filter(entry => document_quad_disposition(entry) === "disposable").map(entry => entry.name.slice(1)));
    for (const entry of entries) {
      const { name, path } = entry, disposition = document_quad_disposition(entry);
      const quid: string | undefined = exactOverlay === undefined ? allocate_livemap_quid(mapIdentityEpoch.owner,
        candidate => reserved.has(candidate) || mapIdentityEpoch.issued().has(candidate) || sourcePayloads.has(candidate) || foreignPayloads.has(candidate),
        candidate => ({ claimed: true, value: candidate })) : overlay.quidAtPath(path);
      if (quid === undefined) throw new Error("No available document QUID for portable QUAD reconstruction.");
      reserved.add(quid);
      overlay = register_livemap_document_identity_at_path(overlay, quid, path).overlay;
      if (disposition === "authored") bindings.push({ name, quid });
      correspondence?.push(Object.freeze({ name, quid, path, disposition }));
    }
    return { documentOverlay: overlay, documentQuads: make_document_quad_bindings(bindings) };
  }

  /** Reconstruction and CSS rebinding share one unpublished candidate and source fence. */
  function reconstruct_document(prepared: ReturnType<typeof prepare_livemap_root>, input: unknown,
    css: unknown, reserved: Set<string>, exactOverlay?: import("./livemap.document.identity.js").LiveMapDocumentIdentityOverlay,
    correspondence: DocumentQuadCorrespondence[] = [], foreignPayloads: ReadonlySet<string> = new Set()) {
    const assertCurrent = capture_fence();
    const portable = prepared.mode === "document" ? encode_portable_document_stylesheet(
      css === undefined ? empty_portable_document_stylesheet() : decode_portable_document_stylesheet(css)) : undefined;
    if (portable !== undefined) assert_portable_document_css_correspondence(prepared.root, prepared.mode, input, portable);
    const addressState = reconstruct_quads(prepared, input, reserved, exactOverlay, correspondence, foreignPayloads);
    const translated = portable !== undefined && document_css_mentions_subject_identity(portable)
      ? translate_document_css_identities(portable, "inbound", { associations: correspondence, assertCurrent }, true, exactOverlay !== undefined) : portable;
    const state = { ...addressState, ...(translated === undefined ? {} : { stylesheet: decode_portable_document_stylesheet(translated) }) };
    assertCurrent();
    return state;
  }

  function compose_styles(root: HsonNode,
    initialOverlay: import("./livemap.document.identity.js").LiveMapDocumentIdentityOverlay,
    occurrences: readonly DocumentCompositionStyle[], reserved: Set<string>,
    before = empty_portable_document_stylesheet(), foreignPayloads: ReadonlySet<string> = new Set(), participantOwner?: object) {
    const assertCurrent = capture_fence();
    // Conflict admission precedes all candidate allocation.
    merge_part_stylesheets([encode_portable_document_stylesheet(before), ...occurrences.map(item => item.css)]);
    let overlay = initialOverlay;
    const records = occurrences.map(occurrence => {
      const demanded = new Set(document_css_subject_identities(occurrence.css, "inbound"));
      const names = new Set<string>(), paths = new Set<string>();
      const associations = occurrence.subjects.map(({ name, path }) => {
        const coordinate = validate_document_path(path), key = JSON.stringify(coordinate);
        if (!demanded.has(name) || names.has(name) || paths.has(key)
          || !is_ordinary_element_node(resolve_document_path(root, "document", coordinate))) throw new Error("Part CSS requires exact bijective destination subject demand.");
        names.add(name); paths.add(key);
        let quid = overlay.quidAtPath(coordinate);
        if (quid === undefined) {
          quid = allocate_livemap_quid(mapIdentityEpoch.owner,
            candidate => reserved.has(candidate) || mapIdentityEpoch.issued().has(candidate) || foreignPayloads.has(candidate)
              || participantOwner !== undefined && livemap_document_identity_quid_unavailable(participantOwner, candidate),
            candidate => ({ claimed: true, value: candidate }));
          if (quid === undefined) throw new Error("No available destination QUID for Part CSS subject.");
          reserved.add(quid);
          overlay = register_livemap_document_identity_at_path(overlay, quid, coordinate).overlay;
        }
        return { name, quid, disposition: "authored" as const };
      });
      if (names.size !== demanded.size) throw new Error("Unresolved Part CSS destination subject.");
      return translate_document_css_identities(occurrence.css, "inbound", { associations, assertCurrent }, true);
    });
    const stylesheet = merge_part_stylesheets([encode_portable_document_stylesheet(before), ...records]);
    assertCurrent(); return { documentOverlay: overlay, stylesheet };
  }

  // Detached candidate provenance only. Installed scope ownership remains on
  // each Library; Locus uses the existing aggregate transition controller.
  const scopedPreparations = new WeakSet<PreparedDocumentScopedLibrary>();
  function scoped_preparation_authority(assertCurrent = capture_fence()) {
    transitionController.assertPublicMutationAllowed();
    transitionController.assertLocalIdentityAllowed();
    if (clientComposition !== undefined || transitionController.managedExecutionOwner() !== undefined) {
      throw new Error("Scoped Library preparation is local-only until hosted scoped replay is integrated.");
    }
    const generation = transitionController.generation;
    return {
      identityOwner: mapIdentityEpoch.owner,
      assertCurrent: () => {
        assertCurrent();
        transitionController.assertPublicMutationAllowed();
        transitionController.assertLocalIdentityAllowed();
        if (generation !== transitionController.generation) throw new Error("Scoped preparation authority changed.");
      },
      readPart: (collection: string, member: string) => {
        const binding = hostedBindingsByName?.get(collection);
        if (binding === undefined) throw new Error(`Unknown Part collection ${JSON.stringify(collection)}.`);
        if (binding.mode !== "data-object" || binding.validation === undefined) {
          throw new Error(`Library ${JSON.stringify(collection)} is not a governed Part collection; register it with definition: { parts }.`);
        }
        const library = require_library(binding.identity);
        const part = validate_data_library(library.root, library.mode, library.validation)?.find(part => part.key === member);
        if (part === undefined) throw new Error(`Unknown Part member ${JSON.stringify([collection, member])}.`);
        return part;
      },
    };
  }

  function finish_scoped_preparation(candidate: PreparedDocumentScopedLibrary, operations: readonly LiveMapGraphOp[] = []): PreparedDocumentScopedLibrary {
    const library = require_library(candidate.owner);
    if (library.hsonSchema !== undefined) must_hson_schema_root(library.hsonSchema, candidate.root);
    candidate.assertCurrent();
    // Authentication must also protect the graph that the scopes and CSS were
    // checked against. These are detached, qualified graphs; freezing them
    // cannot freeze source Libraries or caller input. Operations clone before
    // editing, so subsequent preparation still uses the ordinary mutation path.
    const pending: unknown[] = [candidate.root, ...candidate.steps.map(step => step.context.root), ...operations];
    const seen = new Set<object>();
    while (pending.length) {
      const value = pending.pop();
      if (value === null || typeof value !== "object" || seen.has(value)) continue;
      seen.add(value);
      pending.push(...Object.values(value));
      Object.freeze(value);
    }
    scopedPreparations.add(candidate);
    return candidate;
  }

  function reconstruct_scoped_library(library: LiveMapLibraryState, input: unknown,
    authority: import("./livemap.document.scoped-composition.js").DocumentScopedCompositionAuthority,
    issued = mapIdentityEpoch.issued(), foreignPayloads: ReadonlySet<string> = new Set()): PreparedDocumentScopedLibrary {
    if (library.mode !== "document") throw new Error("Scoped restoration requires a document Library.");
    const portable = decode_document_scoped_library(input);
    const prepared = prepare_livemap_root(portable.root, "document");
    if (!canonical_graph_equal(portable.root, prepared.root)) throw new Error("Scoped restoration requires canonical graph coordinates.");
    if (library.hsonSchema !== undefined) must_hson_schema_root(library.hsonSchema, prepared.root);
    authority.assertCurrent();
    const candidate = prepare_document_scoped_reconstruction({ owner: library.identity, root: prepared.root,
      overlay: require_document_overlay(prepared.documentOverlay), issued }, portable.scopes, authority, foreignPayloads);
    return restore_document_scoped_library_styles(candidate, portable);
  }

  function scoped_aliases(candidate: PreparedDocumentScopedLibrary): DocumentQuadBindings {
    return make_document_quad_bindings(candidate.scopes.document.map(({ name, quid }) => ({ name, quid })));
  }

  function capture_fence(): () => void {
    const revision = mapRevision, generation = identityGeneration, registry = hostedRegistry, authority = hostedFence;
    if (localIdentityTransactionActive) throw new Error("Capture cannot observe an incomplete identity transaction.");
    return () => {
      if (localIdentityTransactionActive || revision !== mapRevision || generation !== identityGeneration
        || registry !== hostedRegistry || authority !== hostedFence) throw new Error("LiveMap identity or authority changed during capture.");
    };
  }

  function capture_managed_restoration_fence(owner: object): () => void {
    const management = transitionController.captureManagementFence(owner), position = capture_fence();
    const composition = clientComposition, generation = transitionController.generation;
    return () => {
      management(); position();
      if (composition !== clientComposition || generation !== transitionController.generation) throw new Error("Receiving restoration authority changed.");
    };
  }

  function validated_library_root(library: LiveMapLibraryState): HsonNode {
    if (library.validation === undefined) return library.root;
    const checkCapture = capture_fence();
    validate_data_library(library.root, library.mode, library.validation);
    checkCapture();
    return library.root;
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
    const value = project_live_path(validated_library_root(library), must_live_path(path));
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
    if (library.validation !== undefined) throw new Error("Part definitions cannot acquire runtime subject identity.");
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
    write: Extract<LiveMapAggregateWrite, { kind: "set" | "set-key" | "replace" | "delete" | "splice" | "rename" | "move" | "collection" }>,
    value: OrderedProjectedValue,
  ): readonly LiveMapCoreWriteOp[] {
    const path = clone_live_path(must_live_path(write.target.path));
    if (write.kind === "collection") {
      return plan_collection_command(value, path, write.command).flatMap(op => aggregate_write_ops({
        ...op, target: { ...write.target, path: op.path },
      }, value));
    }
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
    hostedIncremental = false,
    scopedDocuments = false,
    receivingScoped?: ReadonlyMap<LiveMapAggregateWrite, import("./livemap.document.scoped-effects.js").DocumentScopedEffect>,
    receivingRevision?: number,
    entryManagementFence?: () => void,
  ): import("./livemap.authority.js").PreparedLiveMapAuthorityTransition {
    const managementOwner = transitionController.managedExecutionOwner();
    // Replay must retain the grant captured before caller-controlled decoding.
    // Direct aggregate preparation captures before inspecting writes/operations.
    const assertManagementCurrent = entryManagementFence ?? (managementOwner === undefined ? undefined
      : transitionController.captureManagementFence(managementOwner));
    assertManagementCurrent?.();
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
        if (target.domain === "system") continue;
        const projected = clientComposition.projected.has(target.library);
        if (managed !== projected) {
          throw new Error("Client LiveMap transition crosses its library mutation authority.");
        }
      }
    }
    const assertPreparationBase = capture_fence(), receivingComposition = clientComposition;
    const assertPreparationCurrent = () => {
      assertManagementCurrent?.();
      assertPreparationBase();
      // Local work may survive authority-only progress. A receiving candidate
      // must remain bound to the exact projection position it prepared against.
      if (receivingRevision !== undefined && clientComposition !== receivingComposition) {
        throw new Error("Echo receiving authority position changed during preparation.");
      }
    };
    const preparedGeneration = transitionController.generation;
    const assertScopedCurrent = () => {
      assertPreparationCurrent();
      transitionController.assertLocalIdentityAllowed();
      if (transitionController.generation !== preparedGeneration) throw new Error("Scoped transition preparation changed.");
    };
    const scopedCandidates = new Map<LiveMapLibraryIdentity, PreparedDocumentScopedLibrary>();
    const scopedOrdinals = new Map<LiveMapLibraryIdentity, number>();
    const unscopedConstructions = new Set<LiveMapLibraryIdentity>();
    const prevRev = mapRevision;
    const preparedIdentityGeneration = identityGeneration;
    const candidates = new Map<LiveMapLibraryIdentity, AggregateCandidate>();
    const constructionClaims: { library: LiveMapLibraryIdentity; quid: string }[] = [];
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
    const partValues = new Map<LiveMapLibraryIdentity, OrderedProjectedValue>();
    for (const write of writes) {
      if (write.target.domain !== "application") continue;
      const library = require_library(write.target.library);
      if (library.validation === undefined) continue;
      if (write.kind === "graph" || write.kind === "css" || write.kind === "ensure-quid" || write.kind === "replay-data") continue;
      const value = partValues.get(library.identity) ?? must_projected_root_value(library.root);
      partValues.set(library.identity, plan_write_ops(value, aggregate_write_ops(write, value)).value);
    }
    const readPartCandidate = (collection: string, member: string) => {
      const binding = hostedBindingsByName?.get(collection);
      if (binding === undefined) throw new Error(`Unknown Part collection ${JSON.stringify(collection)}.`);
      if (binding.mode !== "data-object" || binding.validation === undefined) {
        throw new Error(`Library ${JSON.stringify(collection)} is not a governed Part collection; register it with definition: { parts }.`);
      }
      const library = require_library(binding.identity);
      const value = partValues.get(library.identity);
      const root = value === undefined ? library.root : projected_value_to_hson_root(value);
      const selected = validate_data_library(root, library.mode, library.validation)?.find(part => part.key === member);
      if (selected === undefined) throw new Error(`Unknown Part member ${JSON.stringify([collection, member])}.`);
      return selected;
    };
    const realizeOperation = (operation: LiveMapGraphOp) => {
      const input = operation.op === "insert-content" ? operation.content : operation.op === "replace-content" ? operation.replacement : undefined;
      if (!is_Node(input) || !has_part_connector(input)) return { operation, styles: Object.freeze<DocumentCompositionStyle[]>([]) };
      const composed = expand_document_composition("ingress", () => ({ root: { $_tag: ROOT_TAG, $_content: [input] } }),
        document_composition_options(undefined), readPartCandidate);
      const output = composed.root.$_content[0];
      if (!is_Node(output) || composed.root.$_content.length !== 1) throw new Error("Part content must realize exactly one content slot.");
      if (operation.op !== "insert-content" && operation.op !== "replace-content") throw new Error("Unsupported Part construction operation.");
      const prefix = [...operation.target.path, operation.index];
      const styles = composed.styles.map(style => ({ ...style, subjects: style.subjects.map(subject => ({ ...subject, path: [...prefix, ...subject.path.slice(1)] })) }));
      const realized: LiveMapGraphOp = operation.op === "insert-content" ? { ...operation, content: output }
        : { ...operation, replacement: output };
      return { operation: realized, styles };
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
      if (library.documentScopes !== undefined) throw new Error("Prepared document replacement requires complete scoped effects.");
      if (library.mode !== "document" || library.documentOverlay === undefined) {
        throw new Error("Prepared document effects require a document application Library.");
      }
      if (candidates.has(library.identity)) {
        throw new Error("One authority transition cannot install two prepared candidates for one document Library.");
      }
      const admittedRoot = admit_owned_livemap_root(prepared.root, "document", "LiveMap.preparedDocument");
      aggregateCandidateRootsCloned += 1;
      const baseRoot = clone_live_root(library.root);
      const candidate: AggregateDocumentCandidate = {
        library,
        baseRoot,
        root: admittedRoot,
        overlay: prepared.overlay,
        operations: [...prepared.operations],
        identityEffects: [...prepared.identityEffects],
        ...(prepared.sourceCandidate === undefined ? {} : { sourceCandidate: prepared.sourceCandidate }),
        ...(prepared.continuity === undefined ? {} : { continuity: prepared.continuity }),
      };
      if (canonical_graph_equal(library.root, admittedRoot)
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

    for (let write of writes) {
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
      if (write.kind === "graph" && write.assertDocumentShape !== undefined) {
        const candidate = candidate_for(library.identity);
        if (!is_aggregate_document_candidate(candidate) || write.logicalLocation === undefined) throw new Error("Document refinement requires logical coordinates.");
        const value = read_livemap_document_logical_location(candidate.root, "document", write.logicalLocation);
        const shape = value === undefined ? "missing" : is_ordinary_element_node(value) ? "element" : is_Node(value) ? "root" : "text";
        if (shape !== write.assertDocumentShape) throw new Error(`Document location is not ${write.assertDocumentShape}.`);
        continue;
      }
      if (write.kind === "graph" && write.logicalLocation !== undefined) {
        const candidate = candidate_for(library.identity);
        if (!is_aggregate_document_candidate(candidate)) throw new Error("Logical document commands require a document Library.");
        const document = { mode: "document" as const, root: () => candidate.root };
        const path = write.logicalLocation;
        const operation = write.operation;
        let lowered: LiveMapGraphOp;
        switch (operation.op) {
          case "set-attr": case "remove-attr": case "replace-attrs":
            lowered = { ...operation, target: governed_document_element_target(document, path) }; break;
          case "replace-content":
            lowered = { ...operation, ...governed_document_slot(document, path) }; break;
          case "remove-content":
            lowered = { ...operation, ...governed_document_remove_slot(document, path) }; break;
          case "insert-content":
            lowered = { ...operation, ...governed_document_insert_slot(document, path, operation.index, operation.content) }; break;
          case "move-content":
            lowered = { ...operation, target: governed_document_move_target(document, path) }; break;
          default: throw new Error("Unsupported logical document command.");
        }
        write = { ...write, operation: lowered, target: aggregate_target(library.identity, document_operation_path(lowered)) };
      }
      if (write.kind === "graph" && write.attrsCommand !== undefined) {
        const candidate = candidate_for(library.identity);
        if (!is_aggregate_document_candidate(candidate) || write.operation.op !== "replace-attrs") {
          throw new Error("Bulk attribute commands require a document element.");
        }
        write = { ...write, operation: lower_document_attrs_command(candidate.root, candidate.overlay,
          write.operation.target, write.attrsCommand) };
      }
      const target = aggregate_target(library.identity, write.target.path);
      if (!scopedDocuments && !receivingScoped?.has(write) && (library.documentScopes !== undefined
        || library.documentScopesUnavailable && transitionController.managedExecutionOwner() !== undefined)) {
        throw new Error("Scoped document effects require private Locus/Echo preparation.");
      }
      if (write.kind === "css" && write.cssCommand !== undefined) {
        if (scopedDocuments) {
          assertScopedCurrent();
          if (library.documentScopesUnavailable) throw new Error("Missing scoped predecessor evidence from initial or local Part construction.");
        }
        if (library.mode !== "document" || target.path.length !== 0) throw new Error("CSS commands require a document Library root.");
        const operation = lower_document_css_command(cssCandidates.get(library.identity)?.after ?? stylesheet(library.identity), write.cssCommand);
        if (operation === undefined) continue;
        write = { ...write, operation };
      }
      if (scopedDocuments && library.mode === "document" && write.kind !== "graph" && write.kind !== "css") {
        throw new Error("Missing scoped evidence for non-graph document operation.");
      }
      if ((write.kind === "graph" || write.kind === "css") && (scopedDocuments || receivingScoped?.has(write))) {
        if (write.kind === "css" && target.path.length !== 0) throw new Error("CSS operations require a document Library root.");
        const candidate = candidate_for(library.identity);
        if (!is_aggregate_document_candidate(candidate)) throw new Error("Scoped operations require a document Library.");
        assertScopedCurrent();
        if (library.documentScopesUnavailable) throw new Error("Missing scoped predecessor evidence from initial or local Part construction.");
        const context = { owner: library.identity, root: candidate.root, overlay: candidate.overlay, issued: stagedIssuedLedger };
        const previous = scopedCandidates.get(library.identity);
        const before: PreparedDocumentScopedLibrary = previous === undefined ? {
          ...context,
          scopes: library.documentScopes ?? make_document_scoped_quads(context,
            [...(library.documentQuads?.byName ?? [])].map(([name, quid]) => ({ name, quid, kind: "element" })), []),
          stylesheet: stylesheet(library.identity), effects: undefined, identityEffects: [], initialStyles: [], steps: [],
          changed: false, assertCurrent: assertScopedCurrent,
        } : { ...previous, issued: stagedIssuedLedger };
        const receiving = receivingScoped?.get(write);
        const scopedAuthority = { identityOwner: mapIdentityEpoch.owner, assertCurrent: assertScopedCurrent, readPart: readPartCandidate };
        const ordinal = scopedOrdinals.get(library.identity) ?? 0;
        const next = receiving === undefined
          ? write.kind === "css" ? prepare_document_scoped_css_operation(before, canonical_portable_document_css_op(write.operation), ordinal)
          : prepare_document_scoped_library_styles(prepare_document_scoped_operations(before, before.scopes, [write.operation],
            scopedAuthority), before.stylesheet, before, true)
          : replay_document_scoped_effects(before, encode_document_scoped_effects([receiving]), scopedAuthority,
            () => {}, ordinal); // Schema validates the complete transaction below.
        if (!next.changed && receiving === undefined) {
          scopedCandidates.set(library.identity, before);
          continue;
        }
        const step = next.steps[0], effect = next.effects?.[0];
        if (write.kind === "graph" && step === undefined || effect === undefined || next.effects?.length !== 1) throw new Error("Missing scoped document operation evidence.");
        // Receiving CSS references have already been resolved and recaptured locally.
        const operation = write.kind === "graph" ? step!.operation : local_scoped_css_operation(effect);
        operations.push(Object.freeze({ target: aggregate_target(library.identity, write.kind === "css" ? [] : document_operation_path(step!.operation)),
          operation, scoped: Object.freeze({ ...effect, ordinal }) }));
        scopedOrdinals.set(library.identity, ordinal + 1);
        if (step !== undefined) stage_interaction_paths(library, candidate.root, candidate.overlay, next.overlay, step.operation);
        for (const quid of livemap_document_identity_quids(next.overlay)) {
          if (candidate.overlay.pathForQuid(quid) === undefined) constructionClaims.push({ library: library.identity, quid });
        }
        stage_candidate_identity(livemap_document_identity_quids(candidate.overlay), livemap_document_identity_quids(next.overlay));
        stagedIssuedLedger = merge_issued_ledgers(stagedIssuedLedger, next.issued);
        candidate.root = next.root;
        candidate.overlay = next.overlay;
        if (step !== undefined) {
          candidate.operations.push(step.operation);
          if (step.operation.op === "replace-root") candidate.continuity = "same-epoch";
        }
        candidate.identityEffects.push(...next.identityEffects);
        scopedCandidates.set(library.identity, next);
        cssCandidates.set(library.identity, { before: stylesheet(library.identity), after: next.stylesheet });
        continue;
      }
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
        const admittedOperation = write.publicStaged === true
          ? admit_public_document_graph_operation(write.operation)
          : write.operation;
        const incoming = admittedOperation.op === "insert-content" ? admittedOperation.content
          : admittedOperation.op === "replace-content" ? admittedOperation.replacement : undefined;
        if (is_Node(incoming) && has_part_connector(incoming)) {
          if (transitionController.managedExecutionOwner() !== undefined) throw new Error("Scoped Part operations require complete scoped evidence and Echo support.");
          unscopedConstructions.add(library.identity);
        }
        const construction = write.publicStaged === true ? realizeOperation(admittedOperation) : { operation: admittedOperation, styles: [] };
        const priorRoot = candidate.root;
        const priorOverlay = candidate.overlay;
        const planned = prepare_document_graph_operation(
          candidate.root,
          "document",
          construction.operation,
          candidate.overlay,
        );
        // Realization can add CSS/ownership and demand identity even when its
        // markup equals the outgoing fragment. Plan all governed effects before
        // deciding whether this operation is an observable transition.
        const beforeStylesheet = construction.styles.length
          ? cssCandidates.get(library.identity)?.after ?? stylesheet(library.identity) : undefined;
        const composed = beforeStylesheet === undefined ? undefined : compose_styles(
          planned.root, planned.overlay, construction.styles,
          new Set(enumerate_livemap_issued_quids(stagedIssuedLedger)),
          retire_part_styles(beforeStylesheet, new Set(livemap_document_identity_quids(planned.overlay))),
          undefined, library.identity,
        );
        if (!canonical_graph_equal(candidate.root, planned.root)
          || !livemap_document_identity_overlay_equal(planned.overlay, candidate.overlay)
          || composed !== undefined && beforeStylesheet !== undefined
            && (!livemap_document_identity_overlay_equal(composed.documentOverlay, candidate.overlay)
              || !portable_document_stylesheet_equal(beforeStylesheet, composed.stylesheet))) {
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
          const graphOperationIndex = operations.length;
          operations.push(Object.freeze({
            target: aggregate_target(library.identity, document_operation_path(planned.operation)),
            operation: planned.operation,
          }));
          stage_interaction_paths(library, priorRoot, priorOverlay, planned.overlay, planned.operation);
          if (composed !== undefined && beforeStylesheet !== undefined) {
            for (const quid of livemap_document_identity_quids(composed.documentOverlay)) {
              if (candidate.overlay.pathForQuid(quid) !== undefined) continue;
              const path = composed.documentOverlay.pathForQuid(quid)!;
              candidate.identityEffects.push({ kind: "introduced", quid, path });
              constructionClaims.push({ library: library.identity, quid });
            }
            // New subjects belong to the incoming fragment, not an ensure-quid
            // registration of an existing projected node. Carry exact owner-issued
            // identity through the existing structural insertion/lineage proof.
            if (planned.operation.op !== "insert-content" && planned.operation.op !== "replace-content") throw new Error("Invalid Part construction operation.");
            const exact = clone_livemap_document_exact_view(candidate.root, "document", composed.documentOverlay);
            const incoming = resolve_document_path(exact, "document", validate_document_path([...planned.operation.target.path, planned.operation.index]));
            if (!is_Node(incoming)) throw new Error("Part construction lost its incoming graph.");
            const operation: LiveMapGraphOp = planned.operation.op === "insert-content" ? { ...planned.operation, content: incoming }
              : { ...planned.operation, replacement: incoming };
            candidate.operations[candidate.operations.length - 1] = operation;
            operations[graphOperationIndex] = { target: aggregate_target(library.identity, document_operation_path(operation)), operation };
            stage_candidate_identity(livemap_document_identity_quids(candidate.overlay), livemap_document_identity_quids(composed.documentOverlay));
            candidate.overlay = composed.documentOverlay;
            cssCandidates.set(library.identity, { before: cssCandidates.get(library.identity)?.before ?? beforeStylesheet, after: composed.stylesheet });
            operations.push({ target: aggregate_target(library.identity, []), operation: { domain: "css", kind: "replace", stylesheet: encode_portable_document_stylesheet(composed.stylesheet) } });
          }
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
        const scoped = scopedCandidates.get(candidate.library.identity);
        if (scoped !== undefined) finish_scoped_preparation(scoped, candidate.operations);
        else if (candidate.library.hsonSchema !== undefined) {
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
        if (descriptors === undefined) throw new Error("Canonical interaction descriptors are unavailable.");
        if (clientComposition !== undefined) {
          const classify = (name: string): "shared" | "local" | undefined => {
            const binding = hostedBindingsByName?.get(name);
            if (binding?.mode !== "document" || binding.scope !== undefined) return undefined;
            return clientComposition?.bindings.has(name) ? "shared" : "local";
          };
          const before = partition_interaction_descriptors(
            ordered_projected_array(interaction_descriptors_from_root(systemCandidate.system.projectedValue)), classify);
          const after = partition_interaction_descriptors(descriptors, classify);
          const managed = transitionController.managedExecutionOwner() !== undefined;
          if (!ordered_projected_value_equal(ordered_projected_array(before.shared), ordered_projected_array(after.shared)) && !managed) {
            throw new Error("Shared canonical interactions require Locus library mutation authority.");
          }
          if (!ordered_projected_value_equal(ordered_projected_array(before.local), ordered_projected_array(after.local)) && managed) {
            throw new Error("Local canonical interactions require client authority.");
          }
          if (!ordered_projected_value_equal(descriptors, merge_interaction_descriptors(after.shared, after.local))) {
            throw new Error("Composed interaction descriptors must retain shared then local partition order.");
          }
        }
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
      return {
        ...library,
        ...(candidate === undefined ? {} : is_aggregate_document_candidate(candidate)
          ? { root: candidate.root, documentOverlay: candidate.overlay,
            documentQuads: retain_document_quad_bindings(library.documentQuads, candidate.overlay),
            projectedOverlay: undefined, projectedValue: undefined }
          : { root: candidate.nextRoot, documentOverlay: undefined, projectedOverlay: candidate.overlay, projectedValue: candidate.value }),
        ...(cssCandidates.has(library.identity) ? { stylesheet: cssCandidates.get(library.identity)!.after } : {}),
      };
    });
    // Validate every governed collection against the complete final aggregate,
    // before identity installation, hosted encoding, durable acceptance or publication.
    for (const state of afterStates) {
      validate_data_library(state.root, state.mode, state.validation);
      if (state.mode === "document" && has_part_connector(state.root)) throw new Error("Canonical document state cannot contain construction connectors.");
    }
    for (const state of afterStates) {
      if (state.mode !== "document" || !candidates.has(state.identity) || state.stylesheet === undefined) continue;
      if (scopedCandidates.has(state.identity)) continue;
      const next = retire_part_styles(state.stylesheet, new Set(livemap_document_identity_quids(require_document_overlay(state.documentOverlay))));
      if (!portable_document_stylesheet_equal(next, state.stylesheet)) {
        const before = cssCandidates.get(state.identity)?.before ?? stylesheet(state.identity);
        cssCandidates.set(state.identity, { before, after: next });
        state.stylesheet = next;
        operations.push({ target: aggregate_target(state.identity, []), operation: { domain: "css", kind: "replace", stylesheet: encode_portable_document_stylesheet(next) } });
      }
    }
    const afterActive = aggregate_quid_locations(afterStates);
    const nextQuadBindings = new Map([...candidates.values()].flatMap(candidate => is_aggregate_document_candidate(candidate)
      ? [[candidate.library.identity, scopedCandidates.has(candidate.library.identity) ? scoped_aliases(scopedCandidates.get(candidate.library.identity)!)
        : retain_document_quad_bindings(candidate.library.documentQuads, candidate.overlay)] as const] : []));
    for (const [quid, beforeTarget] of beforeActive) {
      const afterTarget = afterActive.get(quid);
      if (afterTarget !== undefined && afterTarget.library !== beforeTarget.library) {
        throw new Error(
          "Cross-library QUID movement requires an explicit LiveMap transfer semantic.",
        );
      }
    }
    const resetsIdentityEpoch = operations.some((entry) => entry.target.domain === "application"
      && "kind" in entry.operation && entry.operation.kind === "replace" && "path" in entry.operation && entry.operation.path.length === 0)
      || [...candidates.values()].some((candidate) => is_aggregate_document_candidate(candidate)
        && candidate.operations.some((operation) => operation.op === "replace-root")
        && candidate.continuity !== "same-epoch");
    const retainsIdentityEpoch = [...candidates.values()].some((candidate) => is_aggregate_document_candidate(candidate)
      && candidate.operations.some((operation) => operation.op === "replace-root")
      && candidate.continuity === "same-epoch" && !scopedCandidates.has(candidate.library.identity));
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
    const finalLedger = nextLedger ?? make_livemap_issued_quid_ledger(afterActive.keys());
    for (const state of afterStates) {
      if (scopedCandidates.has(state.identity)) continue; // Complete scoped capture already validated this candidate.
      if (candidates.has(state.identity) || cssCandidates.has(state.identity)) portable_quads(state, finalLedger);
      // Portable replay has no managed execution owner, but shares the live
      // hosted support boundary. Full snapshot/checkpoint reconstruction is separate.
      if ((hostedIncremental || transitionController.managedExecutionOwner() !== undefined) && state.mode === "document"
        && (candidates.has(state.identity) || cssCandidates.has(state.identity))
        && [state.stylesheet, require_library(state.identity).stylesheet].some(css => css !== undefined
          && document_css_subject_identities(encode_portable_document_stylesheet(css), "outbound").length > 0)) {
        throw new Error("Hosted incremental subject-owned CSS requires correspondence ordering and is unsupported.");
      }
    }
    assertPreparationCurrent();
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
      assertManagementCurrent,
      libraryModes: Object.freeze([...candidates.values()].map((candidate) => candidate.library.mode)),
      baseStillCurrent: () => {
        try { assertPreparationCurrent(); } catch { return false; }
        return mapRevision === prevRev
        && identityGeneration === preparedIdentityGeneration
        && constructionClaims.every(({ library, quid }) => !livemap_document_identity_quid_unavailable(library, quid))
        && [...candidates.values()].every((candidate) => canonical_graph_equal(candidate.library.root, candidate.baseRoot))
        && [...cssCandidates].every(([identity, candidate]) => stylesheet(identity) === candidate.before)
        && (systemCandidate === undefined
          || canonical_graph_equal(systemCandidate.system.root, systemCandidate.baseRoot));
      },
      install: () => {
        // A reservation retains the candidate, not a revoked management grant.
        assertManagementCurrent?.();
        if (resetsIdentityEpoch) mapIdentityEpoch.replace(afterActive.keys());
        else mapIdentityEpoch.install(nextLedger!);
        for (const candidate of candidates.values()) {
          if (is_aggregate_document_candidate(candidate)) {
            Object.assign(candidate.library, {
              root: candidate.root,
              documentOverlay: candidate.overlay,
              documentQuads: nextQuadBindings.get(candidate.library.identity),
              ...(unscopedConstructions.has(candidate.library.identity) ? { documentScopesUnavailable: true as const } : {}),
              ...(scopedCandidates.has(candidate.library.identity) ? { documentScopes: scopedCandidates.get(candidate.library.identity)!.scopes } : {}),
              projectedOverlay: undefined,
              projectedValue: undefined,
            });
            mark_quad_document_root(candidate.root, candidate.library.documentQuads);
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
        if (receivingRevision !== undefined && clientComposition !== undefined) {
          clientComposition = Object.freeze({ ...clientComposition, revision: receivingRevision });
        }
        publishInstalledPosition();
      },
      notify: (acceptedCommit) => {
        enqueuePublication(() => {
          aggregateAcceptedTransitions += 1;
          aggregatePublications += 1;
          deliver_livemap_observers(aggregateWatches, watch => {
            if (require_library(watch.library).mode === "document") return;
            if (!acceptedCommit.operations.some((operation) => (
              operation.target.library === watch.library && paths_overlap(watch.path, operation.target.path)
            ))) return;
            watch.listener(aggregate_snap(watch.library, watch.path));
          }, "watch");
          deliver_livemap_observers(aggregateFeeds, feed => {
            if (require_library(feed.library).mode === "document") return;
            const operations = acceptedCommit.operations.filter((operation) => (
              operation.target.library === feed.library && paths_overlap(feed.path, operation.target.path)
            ));
            if (operations.length === 0) return;
            feed.listener(Object.freeze({
              commit: acceptedCommit,
              path: feed.path,
              operations: Object.freeze(operations),
              value: aggregate_snap(feed.library, feed.path),
            }));
          }, "feed");
          deliver_livemap_observers(aggregateObservers, observer => observer(acceptedCommit), "commit");
          publishAuthorityPosition(acceptedCommit.rev);
        });
      },
    });
    preparedSystemRoots.set(prepared, systemCandidate === undefined ? systemState?.root : systemCandidate.nextRoot);
    assertPreparationCurrent();
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
      const operation = candidate.operation;
      const content = operation.op === "insert-content" ? operation.content : operation.op === "replace-content" ? operation.replacement : undefined;
      // Connector expansion replans the admitted public instruction. The preliminary
      // candidate's derived evidence belongs to its unexpanded graph only.
      const instruction: LiveMapGraphOp = operation.op === "replace-content"
        ? { domain: "graph", op: "replace-content", target: operation.target, index: operation.index, replacement: operation.replacement }
        : operation;
      transition = is_Node(content) && has_part_connector(content)
        ? prepare_authority_transition([{ target: aggregate_target(libraryIdentity, document_operation_path(operation)), kind: "graph", operation: instruction, publicStaged: true }])
        : prepare_authority_transition([], [{
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
      if (state === undefined || raw.identity !== state.identity || raw.mode !== state.mode || raw.validation !== state.validation
        || (state.hsonSchema === undefined || hson_schema_digest(raw.schema) !== hson_schema_digest(state.hsonSchema))) {
        throw new Error("LiveMap hosted registry order, mode, or Schema disagrees with aggregate authority.");
      }
      return Object.freeze({ ...raw });
    });
    if (systemState?.key === INTERACTION_RESERVED_LIBRARY_KEY) {
      validate_interaction_subjects(ordered_projected_value_at(systemState.projectedValue, ["descriptors"]),
        (name) => bindingsInput.some((binding) => binding.name === name && binding.mode === "document"
          && binding.scope === undefined));
    }
    const systemBinding = systemState === undefined ? [] : [Object.freeze({
      name: systemState.transportName,
      scope: "hson-internal" as const,
      identity: systemState.identity,
      mode: "data-object" as const,
      schema: systemState.hsonSchema,
    })];
    return install_hosted_registry([...bindings, ...systemBinding]);
  }

  function configure_client_composition(snapshot: PortableAggregateSnapshot, scoped = false): void {
    if (clientComposition !== undefined || clientManagementOwner !== undefined || mapRevision !== 0) {
      throw new Error("Client LiveMap ownership must be fixed before its first transition.");
    }
    assert_portable_aggregate_snapshot_shape(snapshot, scoped);
    const hosted = require_hosted_state();
    const projected = new Set<LiveMapLibraryIdentity>();
    const bindings = new Map<string, HostedRegistryBinding>();
    for (let index = 0; index < snapshot.registry.libraries.length; index += 1) {
      const entry = snapshot.registry.libraries[index];
      const root = snapshot.libraries[index];
      if (entry === undefined || root === undefined || entry.name !== root.name) {
        throw new Error("Client projection registry and roots disagree.");
      }
      const binding = hosted.byName.get(entry.name);
      const fullEntry = hosted.registry.libraries.find((candidate) => candidate.name === entry.name);
      if (binding === undefined || binding.mode !== entry.mode
        || binding.scope !== entry.scope || binding.validation !== own_data_library_validation(entry) || hson_schema_digest(binding.schema) !== hson_schema_source_digest(entry.schema)
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
        // The initial registry admitted graph, associations and CSS together.
        projected.add(identity);
        projectedCaptureContinuity.set(identity, Object.freeze({}));
      }
    }
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
    authored?: boolean;
    root: HsonNode;
    hsonSchema: HsonSchema;
    family: "data" | "document";
    validation?: DataLibraryValidation;
    quads?: PortableDocumentQuads;
    css?: import("../../internal/css/portable-document-stylesheet.js").PortableDocumentStylesheet;
    compositionStyles?: readonly DocumentCompositionStyle[];
    compositionScopes?: DocumentScopedQuadRecord;
    scopes?: DocumentScopedQuadRecord;
  }>;

  function prepare_add_libraries(definitions: readonly LibraryAddition[], clientLocal = false, entryManagementFence?: () => void): Readonly<{
    transition: import("./livemap.authority.js").PreparedLiveMapAuthorityTransition;
    identities: readonly LiveMapLibraryIdentity[];
  }> {
    if (clientLocal) {
      if (clientComposition === undefined) throw new Error("Client-local topology admission requires a composed LiveMap.");
    } else transitionController.assertPublicMutationAllowed();
    const executionOwner = transitionController.managedExecutionOwner();
    const assertManagementCurrent = entryManagementFence ?? (executionOwner === undefined ? undefined : transitionController.captureManagementFence(executionOwner));
    assertManagementCurrent?.();
    const managementGeneration = transitionController.generation;
    const prevRev = mapRevision;
    if (definitions.length === 0) throw new Error("LiveMap topology batch is empty.");
    const hosted = require_hosted_state();
    const generation = identityGeneration;
    const reserved = new Set<string>();
    // The managed source-definition entry marks authored ingress. Canonical
    // topology replay/projection never carries that private marker.
    const assertSourcesCurrent = capture_fence();
    const defined = new Map(definitions.map(definition => [definition.name, definition]));
    const readPart = (collection: string, member: string) => {
      const definition = defined.get(collection);
      const binding = hosted.byName.get(collection);
      const source = definition === undefined ? binding === undefined ? undefined : require_library(binding.identity) : definition;
      const mode = definition === undefined ? binding?.mode : classify_live_root_mode(definition.root, definition.family);
      if (source === undefined) throw new Error(`Unknown Part collection ${JSON.stringify(collection)}.`);
      if (mode !== "data-object" || source.validation === undefined) {
        throw new Error(`Library ${JSON.stringify(collection)} is not a governed Part collection; register it with definition: { parts }.`);
      }
      const part = validate_data_library(source.root, mode, source.validation)?.find(part => part.key === member);
      if (part === undefined) throw new Error(`Unknown Part member ${JSON.stringify([collection, member])}.`);
      return part;
    };
    definitions = definitions.map(definition => {
      if (definition.authored !== true || definition.family !== "document" || !has_part_connector(definition.root)) return definition;
      const result = expand_document_composition(definition.name, () => ({ root: definition.root, ...(definition.quads === undefined ? {} : { quads: definition.quads }) }), document_composition_options(undefined), readPart);
      const { quads: sourceQuads, ...ordinary } = definition;
      return { ...ordinary, root: result.root, ...(result.quads === undefined ? {} : { quads: result.quads }), compositionStyles: result.styles, compositionScopes: result.scoped };
    });
    assertSourcesCurrent();
    const foreignPayloads = new Set([...disposable_document_quad_payloads(definitions.map(definition => own_document_quads(definition))),
      ...definitions.flatMap(definition => definition.scopes?.subjects.map(subject => subject.name.slice(1)) ?? [])]);
    const candidateAuthority = { identityOwner: mapIdentityEpoch.owner, assertCurrent: () => {
      assertManagementCurrent?.();
      assertSourcesCurrent();
      if (transitionController.generation !== managementGeneration) throw new Error("Library admission management changed.");
    }, readPart: () => { throw new Error("Realized Library admission cannot reread Part collections."); } };
    const prepared = definitions.map((definition) => {
      const { name, root, hsonSchema, family, compositionStyles, compositionScopes } = definition;
      const scopes = own_document_scopes(definition);
      let css = definition.css;
      const quads = own_document_quads(definition);
      const validation = own_data_library_validation(definition);
      const admitted = admit_public_livemap_root(root, family, `LiveMap Library ${JSON.stringify(name)}`);
      const graph = prepare_livemap_root(admitted, family);
      must_hson_schema_family(hsonSchema, family);
      must_hson_schema_root(hsonSchema, graph.root);
      validate_data_library(graph.root, graph.mode, validation);
      if (has_part_connector(graph.root)) throw new Error("Canonical Library admission cannot contain construction connectors.");
      if (compositionStyles !== undefined && family !== "document") throw new Error("Part styles require a document candidate.");
      if (compositionStyles !== undefined) {
        merge_part_stylesheets([...(css === undefined ? [] : [encode_portable_document_stylesheet(css)]), ...compositionStyles.map(item => item.css)]);
      }
      const state = make_livemap_library(graph, hsonSchema, validation);
      if (scopes !== undefined && (compositionScopes !== undefined || compositionStyles !== undefined || quads !== undefined)) {
        throw new Error("Scoped topology cannot mix receiving and authored evidence.");
      }
      if (scopes === undefined) Object.assign(state, reconstruct_document(graph, quads,
        css === undefined ? undefined : encode_portable_document_stylesheet(css), reserved, undefined, [], foreignPayloads));
      const issued = () => make_livemap_issued_quid_ledger([...enumerate_livemap_issued_quids(mapIdentityEpoch.issued()), ...reserved]);
      let candidate: PreparedDocumentScopedLibrary | undefined;
      if (scopes !== undefined) {
        candidate = reconstruct_scoped_library(state, { root: graph.root, scopes,
          css: css === undefined ? undefined : encode_portable_document_stylesheet(css) }, candidateAuthority, issued(), foreignPayloads);
      } else if (compositionScopes !== undefined) {
        const composition = { root: graph.root, scoped: compositionScopes, styles: compositionStyles ?? [],
          identityDemands: (compositionStyles ?? []).flatMap(style => style.subjects.map(subject => subject.path)) };
        candidate = prepare_document_scoped_library_styles(prepare_document_scoped_composition({ owner: state.identity,
          root: state.root, overlay: require_document_overlay(state.documentOverlay), issued: issued() }, composition, candidateAuthority), state.stylesheet!);
      } else if (compositionStyles !== undefined) {
        throw new Error("Part styles require complete scoped topology evidence.");
      }
      if (candidate !== undefined) {
        for (const quid of enumerate_livemap_issued_quids(candidate.issued)) reserved.add(quid);
        Object.assign(state, { root: candidate.root, documentOverlay: candidate.overlay, documentScopes: candidate.scopes,
          documentQuads: scoped_aliases(candidate), stylesheet: candidate.stylesheet });
        css = state.stylesheet;
      }
      if (css !== undefined) {
        if (family !== "document") throw new TypeError("Initial CSS requires a document Library.");
        if (candidate === undefined && transitionController.managedExecutionOwner() !== undefined
          && document_css_subject_identities(encode_portable_document_stylesheet(css), "inbound").length > 0) {
          throw new Error("Hosted incremental subject-owned CSS topology is unsupported without correspondence ordering.");
        }
      }
      candidateAuthority.assertCurrent();
      if (state.mode !== "document") state.projectedValue = must_projected_root_value(state.root);
      return Object.freeze({ name, state, hsonSchema, css });
    });
    const existingBindings = libraryRegistry.all().map((state) => {
      const binding = hosted.byIdentity.get(state.identity);
      if (binding === undefined) throw new Error("LiveMap Library binding is unavailable.");
      return binding;
    });
    const newBindings = prepared.map(({ name, state, hsonSchema }): HostedRegistryBinding => Object.freeze({
      name, identity: state.identity, mode: state.mode, schema: hsonSchema,
      ...(state.validation === undefined ? {} : { validation: state.validation }),
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
        libraries: Object.freeze(prepared.map(({ name, state, hsonSchema, css }) => Object.freeze({
          name,
          mode: state.mode,
          schema: hsonSchema.toHson(),
          ...(state.validation === undefined ? {} : { validation: state.validation }),
          root: encode_hosted_root(clone_hson_graph_without_quids(validated_library_root(state))),
          ...(state.documentScopes === undefined ? portable_quads(state, nextLedger, css !== undefined)
            : (() => {
              const captured = capture_document_scoped_library({ owner: state.identity, root: state.root,
                overlay: require_document_overlay(state.documentOverlay), issued: nextLedger, scopes: state.documentScopes,
                stylesheet: state.stylesheet!, identityEffects: [], initialStyles: [], steps: [], changed: false,
                effects: undefined, assertCurrent: candidateAuthority.assertCurrent });
              const portable = normalize_document_scoped_library_subjects(captured);
              return { documentContract: "scoped" as const, scopes: portable.scopes, css: portable.css };
            })()),
        }))),
      }),
    });
    const commit: LiveMapAggregateCommit = Object.freeze({
      kind: "aggregate", changed: true, prevRev, rev: prevRev + 1,
      operations: Object.freeze([]), topology,
      hosted: make_hosted_topology_commit(hosted.fence, hosted.registry, nextRegistry, topology, prevRev),
    });
    assertManagementCurrent?.();
    const transition = transitionController.prepareAuthority({
      commit,
      assertManagementCurrent,
      libraryModes: Object.freeze(prepared.map(({ state }) => state.mode)),
      baseStillCurrent: () => mapRevision === prevRev && hostedRegistry === hosted.registry && identityGeneration === generation,
      install: () => {
        mapIdentityEpoch.install(nextLedger);
        identityGeneration += 1;
        libraryRegistry.add(prepared.map(({ state }) => { mark_quad_document_root(state.root, state.documentQuads); return state; }));
        hostedRegistry = nextRegistry;
        hostedBindingsByIdentity = nextByIdentity;
        hostedBindingsByName = nextByName;
        mapRevision = commit.rev;
      },
      notify: (acceptedCommit) => enqueuePublication(() => {
        aggregateAcceptedTransitions += 1;
        aggregatePublications += 1;
        deliver_livemap_observers(aggregateObservers, observer => observer(acceptedCommit), "commit");
        publishAuthorityPosition(acceptedCommit.rev);
      }),
    });
    return Object.freeze({ transition, identities: Object.freeze(prepared.map(({ state }) => state.identity)) });
  }

  function add_libraries(definitions: readonly LibraryAddition[], afterInstall?: (identities: readonly LiveMapLibraryIdentity[]) => void,
    beforeInstall?: () => void): LiveMapAggregateCommit {
    transitionController.assertPublicMutationAllowed();
    if (definitions.length === 0) return Object.freeze({
      kind: "aggregate", changed: false, prevRev: mapRevision, rev: mapRevision, operations: Object.freeze([]),
    });
    const prepared = prepare_add_libraries(definitions);
    // A source-derived candidate retains its original capture fence through all admission validation.
    beforeInstall?.();
    // Serialization may acquire exclusive management after the initial admission permission check.
    transitionController.assertPublicMutationAllowed();
    return transitionController.acceptAuthority(prepared.transition, "isolate", () =>
      afterInstall?.(prepared.identities)).commit;
  }

  function add_client_local_libraries(definitions: readonly LibraryAddition[], afterInstall?: (identities: readonly LiveMapLibraryIdentity[]) => void,
    assertAcceptance?: () => void): LiveMapAggregateCommit {
    const prepared = prepare_add_libraries(definitions, true);
    try { assertAcceptance?.(); }
    catch (cause) { transitionController.discardAuthority(prepared.transition); throw cause; }
    return transitionController.acceptAuthority(prepared.transition, "isolate", () =>
      afterInstall?.(prepared.identities)).commit;
  }

  function use_library_schema(
    libraryIdentity: LiveMapLibraryIdentity,
    schema: HsonSchema,
    expectedPreviousSchemaDigest?: string,
  ): LiveMapAggregateCommit {
    const state = require_library(libraryIdentity);
    if (clientComposition !== undefined) {
      if (clientComposition.projected.has(libraryIdentity)) {
        throw new LiveMapTransitionError(
          "LIVEMAP_MANAGED_MUTATION_REJECTED",
          "Shared LiveMap Library Schema attachment requires Locus authority.",
        );
      }
    } else transitionController.assertPublicMutationAllowed();
    if (state.validation === PART_COLLECTION_VALIDATION) {
      throw new TypeError("Part collections do not support supplemental Schema attachment.");
    }
    if (!(schema instanceof HsonSchemaHandle)) throw new TypeError("LiveMap Library Schema attachment requires a genuine HsonSchema.");
    const family = state.mode === "document" ? "document" as const : "data" as const;
    must_hson_schema_family(schema, family);
    const current = state.hsonSchema;
    if (current === undefined) throw new Error("LiveMap Library governing Schema is unavailable.");
    const hosted = require_hosted_state();
    const currentBinding = hosted.byIdentity.get(libraryIdentity);
    if (currentBinding === undefined || currentBinding.scope !== undefined) {
      throw new Error("LiveMap Library registry binding is unavailable.");
    }
    const currentEntry = hosted.registry.libraries.find((entry) => entry.name === currentBinding.name);
    if (currentEntry === undefined) throw new Error("LiveMap Library registry contract is unavailable.");
    if (expectedPreviousSchemaDigest !== undefined && expectedPreviousSchemaDigest !== currentEntry.schemaDigest) {
      throw new Error("LiveMap Library Schema replay prior-contract digest is incompatible.");
    }
    const currentDigest = hson_schema_digest(current);
    const requestedSource = schema.toHson();
    const prevRev = mapRevision;
    if (currentDigest === hson_schema_digest(schema)) {
      return Object.freeze({ kind: "aggregate", changed: false, prevRev, rev: prevRev,
        operations: Object.freeze([]) });
    }
    const familyTop = hson_schema_digest(family === "document" ? ANY_DOCUMENT : ANY_DATA);
    if (currentDigest !== familyTop) {
      throw new Error("LiveMap Library governing Schema is already fixed to a different specific contract.");
    }
    validated_library_root(state);
    must_hson_schema_root(schema, state.root);

    const nextBindings = hosted.registry.libraries.map((entry): HostedRegistryBinding => {
      const binding = hosted.byName.get(entry.name);
      if (binding === undefined) throw new Error("LiveMap hosted registry binding is incomplete.");
      return binding.identity === libraryIdentity ? Object.freeze({ ...binding, schema }) : binding;
    });
    const nextRegistry = make_hosted_registry(nextBindings);
    const nextByIdentity = new Map(nextBindings.map((binding) => [binding.identity, binding]));
    const nextByName = new Map(nextBindings.map((binding) => [binding.name, binding]));
    const operation = Object.freeze({
      kind: "library-schema-use" as const,
      previousSchemaDigest: currentEntry.schemaDigest,
      schema: requestedSource,
    });
    const commit: LiveMapAggregateCommit = Object.freeze({
      kind: "aggregate", changed: true, prevRev, rev: prevRev + 1,
      operations: Object.freeze([]),
      schemaUse: Object.freeze({ library: libraryIdentity, operation }),
    });
    const prepared = transitionController.prepareAuthority({
      commit,
      libraryModes: Object.freeze([state.mode]),
      baseStillCurrent: () => mapRevision === prevRev && state.hsonSchema === current
        && hostedRegistry === hosted.registry,
      install: () => {
        state.hsonSchema = schema;
        hostedRegistry = nextRegistry;
        hostedBindingsByIdentity = nextByIdentity;
        hostedBindingsByName = nextByName;
        mapRevision = commit.rev;
      },
      notify: (accepted) => enqueuePublication(() => {
        aggregateAcceptedTransitions += 1;
        aggregatePublications += 1;
        deliver_livemap_observers(aggregateObservers, observer => observer(accepted), "commit");
        publishAuthorityPosition(accepted.rev);
      }),
    });
    return transitionController.acceptAuthority(prepared).commit;
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
    portable_quads({ ...state, stylesheet: next });
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
        deliver_livemap_observers(aggregateObservers, observer => observer(accepted), "commit");
        publishAuthorityPosition(accepted.rev);
      }),
    });
    return transitionController.acceptAuthority(prepared).commit;
  }

  function capture_libraries_aggregate(): LiveMapSnapshot {
    const checkCapture = capture_fence();
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
        root: encode_hosted_root(clone_hson_graph_without_quids("mode" in state ? validated_library_root(state) : state.root)),
        ...(binding.scope === "hson-internal" ? {} : portable_quads(require_library(binding.identity as LiveMapLibraryIdentity))),
      });
    });
    const snapshot: LiveMapSnapshot = Object.freeze({
      format: LIVEMAP_LIBRARIES_SNAPSHOT_FORMAT,
      revision: mapRevision,
      registry: hosted.registry,
      registryDigest: hosted.registry.digest,
      libraries: Object.freeze(libraries),
    });
    checkCapture();
    assert_libraries_snapshot_bound(snapshot);
    return snapshot;
  }

  function capture_selected_hosted(names: readonly string[], includeSystem: boolean, scoped = false) {
    const checkCapture = capture_fence();
    const hosted = require_hosted_state();
    const revision = mapRevision;
    const authority = hosted.fence;
    const libraries = names.map((name) => {
      const binding = hosted.byName.get(name);
      if (binding === undefined || binding.scope === "hson-internal") {
        throw new Error("Selected hosted Library is unavailable.");
      }
      const state = require_library(binding.identity as LiveMapLibraryIdentity);
      if (scoped && state.documentScopesUnavailable) throw new Error("Missing scoped predecessor evidence.");
      if (scoped && state.documentScopes !== undefined) {
        const captured = capture_document_scoped_library({ owner: state.identity, root: state.root,
          overlay: require_document_overlay(state.documentOverlay), issued: mapIdentityEpoch.issued(),
          scopes: state.documentScopes, stylesheet: stylesheet(state.identity), identityEffects: [], initialStyles: [], steps: [],
          changed: false, effects: undefined, assertCurrent: checkCapture });
        return Object.freeze({ name, root: encode_hosted_root(captured.root, HOSTED_MAX_SNAPSHOT_BYTES), scopes: captured.scopes, css: captured.css });
      }
      return Object.freeze({ name, root: encode_hosted_root(
        clone_hson_graph_without_quids(validated_library_root(state)), HOSTED_MAX_SNAPSHOT_BYTES),
        ...portable_quads(state) });
    });
    const system = includeSystem ? (() => {
      if (systemState === undefined) throw new Error("Selected hosted system state is unavailable.");
      return encode_hosted_root(clone_hson_graph_without_quids(systemState.root), HOSTED_MAX_SNAPSHOT_BYTES);
    })() : null;
    // The synchronous structural capture admits no policy or application callbacks.
    if (mapRevision !== revision || hostedFence !== authority) {
      throw new Error("Selected hosted authority changed during capture.");
    }
    checkCapture();
    return Object.freeze({ authority, revision, libraries: Object.freeze(libraries), system });
  }

  function capture_hosted_aggregate(): HostedLiveMapSnapshot {
    const checkCapture = capture_fence();
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
    const bytes = JSON.stringify(snapshot);
    checkCapture();
    hostedSnapshotProvenance.set(snapshot, Object.freeze({
      owner: mapIdentityEpoch.owner,
      epoch: mapIdentityEpoch.current(),
      bytes,
      overlays,
    }));
    return snapshot;
  }

  function capture_semantic_checkpoint(): LiveMapSemanticCheckpoint {
    const checkCapture = capture_fence();
    const hosted = require_hosted_state();
    const revision = mapRevision;
    const authority = hosted.fence;
    const libraries = hosted.registry.libraries.map((entry) => {
      const binding = hosted.byName.get(entry.name);
      if (binding === undefined) throw new Error("Checkpoint Library binding is unavailable.");
      const state = binding.scope === "hson-internal"
        ? systemState : require_library(binding.identity as LiveMapLibraryIdentity);
      if (state === undefined) throw new Error("Checkpoint system state is unavailable.");
      if ("mode" in state) {
        if (state.documentScopesUnavailable) throw new Error("Missing scoped checkpoint evidence.");
        if (state.documentScopes !== undefined) {
          const captured = capture_document_scoped_library({ owner: state.identity, root: state.root,
            overlay: require_document_overlay(state.documentOverlay), issued: mapIdentityEpoch.issued(),
            scopes: state.documentScopes, stylesheet: stylesheet(state.identity), identityEffects: [], initialStyles: [], steps: [],
            changed: false, effects: undefined, assertCurrent: checkCapture });
          return Object.freeze({ name: entry.name, ...captured });
        }
      }
      return Object.freeze({ name: entry.name, root: clone_hson_graph_without_quids("mode" in state ? validated_library_root(state) : state.root),
        ...(binding.scope === "hson-internal" ? {} : portable_quads(require_library(binding.identity as LiveMapLibraryIdentity))) });
    });
    if (mapRevision !== revision || hostedFence !== authority) {
      throw new Error("Authority changed during checkpoint capture.");
    }
    checkCapture();
    return Object.freeze({ authority, revision, registry: hosted.registry, libraries: Object.freeze(libraries) });
  }

  function install_semantic_checkpoint(checkpoint: LiveMapSemanticCheckpoint): void {
    const owner = transitionController.managedExecutionOwner();
    const position = capture_fence(), generation = transitionController.generation;
    const grant = owner === undefined ? undefined : transitionController.captureManagementFence(owner);
    const checkRestore = () => {
      grant?.(); position();
      transitionController.assertPublicMutationAllowed();
      transitionController.assertLocalIdentityAllowed();
      if (transitionController.generation !== generation) throw new Error("Checkpoint restoration authority changed.");
    };
    checkRestore();
    checkpoint = own_semantic_checkpoint(checkpoint);
    checkRestore();
    const hosted = require_hosted_state();
    if (!Number.isSafeInteger(checkpoint.revision) || checkpoint.revision < 0
      || checkpoint.registry.format !== hosted.registry.format
      || checkpoint.registry.digest !== hosted.registry.digest
      || registry_from_entries(checkpoint.registry.libraries).digest !== hosted.registry.digest
      || checkpoint.libraries.length !== hosted.registry.libraries.length
      || typeof checkpoint.authority.logicalMapId !== "string" || !checkpoint.authority.logicalMapId
      || typeof checkpoint.authority.incarnationId !== "string" || !checkpoint.authority.incarnationId) {
      throw new Error("Semantic checkpoint is incompatible with this authority.");
    }
    const reserved = new Set<string>();
    const foreignPayloads = new Set([...disposable_document_quad_payloads(checkpoint.libraries.map(item => own_document_quads(item))),
      ...checkpoint.libraries.flatMap(item => item.scopes?.subjects.map(subject => subject.name.slice(1)) ?? [])]);
    const scopedAuthority = { identityOwner: mapIdentityEpoch.owner, assertCurrent: checkRestore,
      readPart: () => { throw new Error("Checkpoint restoration cannot read Part definitions."); } };
    const candidates = checkpoint.libraries.map((item, index) => {
      const entry = hosted.registry.libraries[index];
      if (entry === undefined || item.name !== entry.name) throw new Error("Checkpoint Library order is invalid.");
      const binding = hosted.byName.get(entry.name);
      if (binding === undefined) throw new Error("Checkpoint Library binding is unavailable.");
      const prepared = prepare_livemap_root(item.root, entry.mode === "document" ? "document" : "data");
      if (prepared.mode !== entry.mode) throw new Error("Checkpoint root mode disagrees with registry.");
      must_hson_schema_root(binding.schema, prepared.root);
      validate_data_library(prepared.root, prepared.mode, binding.validation);
      if (entry.scope === "hson-internal") {
        if (systemState === undefined || binding.identity !== systemState.identity || prepared.mode === "document") {
          throw new Error("Checkpoint system state is incompatible.");
        }
        return Object.freeze({ kind: "system" as const, state: systemState, prepared,
          projectedValue: must_projected_root_value(prepared.root) });
      }
      const state = require_library(binding.identity as LiveMapLibraryIdentity);
      const scopedCandidate = item.scopes === undefined ? undefined : reconstruct_scoped_library(state,
        { root: item.root, scopes: item.scopes, css: item.css }, scopedAuthority,
        make_livemap_issued_quid_ledger([...enumerate_livemap_issued_quids(mapIdentityEpoch.issued()), ...reserved]), foreignPayloads);
      if (scopedCandidate !== undefined) {
        for (const quid of livemap_document_identity_quids(scopedCandidate.overlay)) reserved.add(quid);
      }
      const addressState = scopedCandidate === undefined
        ? reconstruct_document(prepared, own_document_quads(item), item.css, reserved, undefined, [], foreignPayloads)
        : { documentOverlay: scopedCandidate.overlay, documentQuads: scoped_aliases(scopedCandidate), stylesheet: scopedCandidate.stylesheet };
      return Object.freeze({ kind: "application" as const, state, prepared,
        root: scopedCandidate?.root ?? prepared.root, addressState, documentScopes: scopedCandidate?.scopes,
        css: addressState.stylesheet,
        changed: scopedCandidate !== undefined || state.documentScopes !== undefined || !canonical_graph_equal(state.root, prepared.root)
          || (prepared.mode === "document" && !portable_document_stylesheet_equal(stylesheet(state.identity),
            addressState.stylesheet!)),
        projectedValue: prepared.projectedOverlay === undefined
          ? undefined : must_projected_root_value(prepared.root) });
    });
    if (systemState !== undefined && !candidates.some((candidate) => candidate.kind === "system")) {
      throw new Error("Checkpoint omitted system state.");
    }
    const changedLibraries = candidates.flatMap((candidate) =>
      candidate.kind === "application" && candidate.changed ? [candidate.state.identity] : []);
    checkRestore();
    mapIdentityEpoch.replace(reserved);
    for (const candidate of candidates) {
      if (candidate.kind === "system") {
        candidate.state.root = candidate.prepared.root;
        candidate.state.projectedValue = candidate.projectedValue;
      } else {
        Object.assign(candidate.state, {
          root: candidate.root,
          documentScopes: candidate.documentScopes, documentScopesUnavailable: undefined,
          ...candidate.addressState,
          projectedOverlay: candidate.prepared.projectedOverlay,
          projectedValue: candidate.projectedValue,
          ...(candidate.css === undefined ? {} : { stylesheet: candidate.css }),
        });
      }
    }
    const previousRevision = mapRevision;
    identityGeneration += 1;
    mapRevision = checkpoint.revision;
    hostedFence = Object.freeze({ ...checkpoint.authority });
    for (const state of libraryRegistry.all()) mark_quad_document_root(state.root, state.documentQuads);
    transitionController.invalidate();
    publishInstalledPosition();
    const event = Object.freeze({
      previousRevision,
      revision: checkpoint.revision,
      libraries: Object.freeze(libraryRegistry.all().map((library) => library.identity)),
      changedLibraries: Object.freeze(changedLibraries),
      continuity: "new-epoch" as const,
    });
    enqueuePublication(() => {
      deliver_livemap_observers(aggregateRestoreObservers, observer => observer(event), "restore");
      publishAuthorityPosition();
    });
  }

  function restore_local_topology(
    snapshot: LiveMapSnapshot,
    afterTopologyInstall?: (identities: readonly LiveMapLibraryIdentity[]) => void,
  ): PortableQuadRestoration {
    const checkRestore = capture_fence();
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
      addressState: ReturnType<typeof reconstruct_quads>;
      css?: import("../../internal/css/portable-document-stylesheet.js").PortableDocumentStylesheet;
      projectedValue?: OrderedProjectedValue;
      newlyInstalled: boolean;
      schema: HsonSchema;
      name: string;
    }>> = [];
    const reserved = new Set<string>();
    const foreignPayloads = disposable_document_quad_payloads(snapshot.libraries.map(entry => own_document_quads(entry)));
    const associations: PortableQuadRestoration["associations"][number][] = [];
    const portableStylesheets = new Map<LiveMapLibraryIdentity, import("../../internal/css/portable-document-stylesheet.js").PortableDocumentStylesheetRecord>();
    let systemRoot: HsonNode | undefined;
    let systemValue: OrderedProjectedValue | undefined;
    for (let index = 0; index < snapshot.registry.libraries.length; index += 1) {
      const entry = snapshot.registry.libraries[index];
      const encoded = snapshot.libraries[index];
      if (entry === undefined || encoded === undefined || entry.name !== encoded.name
        || entry.mode !== encoded.mode || hson_schema_source_digest(entry.schema) !== hson_schema_source_digest(encoded.schema)
        || entry.schemaDigest !== encoded.schemaDigest) {
        throw new Error("LiveMap topology snapshot Library metadata is malformed.");
      }
      const root = decode_hosted_root(encoded.root, HOSTED_MAX_SNAPSHOT_BYTES);
      admit_portable_hson_node(root, "LiveMap topology snapshot");
      const schema = HsonSchemaHandle.fromHson(entry.schema);
      const prepared = prepare_livemap_root(root, entry.mode === "document" ? "document" : "data");
      if (prepared.mode !== entry.mode) throw new Error("LiveMap topology snapshot root mode disagrees with registry.");
      must_hson_schema_family(schema, entry.mode === "document" ? "document" : "data");
      must_hson_schema_root(schema, prepared.root);
      validate_data_library(prepared.root, prepared.mode, own_data_library_validation(entry));
      if (entry.scope === "hson-internal") {
        if (systemState === undefined || systemState.transportName !== entry.name
          || hson_schema_digest(systemState.hsonSchema) !== hson_schema_source_digest(entry.schema) || entry.mode !== "data-object") {
          throw new Error("LiveMap topology snapshot system state is incompatible.");
        }
        systemRoot = prepared.root;
        systemValue = must_projected_root_value(prepared.root);
      } else {
        const old = hosted.byName.get(entry.name);
        if (old?.validation !== undefined && old.validation !== own_data_library_validation(entry)) {
          throw new Error("Restoration cannot remove an existing Part collection validation contract.");
        }
        const compatible = old !== undefined && old.scope === undefined
          && old.mode === entry.mode && old.validation === own_data_library_validation(entry) && hson_schema_digest(old.schema) === hson_schema_source_digest(entry.schema);
        const state = compatible
          ? require_library(old.identity as LiveMapLibraryIdentity)
          : make_livemap_library(prepared, schema, own_data_library_validation(entry));
        const correspondence: DocumentQuadCorrespondence[] = [];
        const portableCss = prepared.mode === "document" ? encode_portable_document_stylesheet(decode_portable_document_stylesheet(encoded.css)) : undefined;
        const addressState = reconstruct_document(prepared, own_document_quads(encoded), portableCss, reserved, undefined, correspondence, foreignPayloads);
        if (portableCss !== undefined) portableStylesheets.set(state.identity, portableCss);
        associations.push(...correspondence.map(subject => Object.freeze({ ...subject, library: state.identity, libraryName: entry.name })));
        candidates.push(Object.freeze({ name: entry.name, state, prepared, schema, newlyInstalled: !compatible,
          addressState,
          ...(entry.mode === "document" ? { css: addressState.stylesheet } : {}),
          projectedValue: prepared.mode === "document" ? undefined : must_projected_root_value(prepared.root) }));
      }
    }
    if (systemState !== undefined && systemRoot === undefined) {
      throw new Error("LiveMap topology snapshot omitted configured system state.");
    }
    if (systemValue !== undefined && systemState?.key === INTERACTION_RESERVED_LIBRARY_KEY) {
      validate_interaction_subjects(ordered_projected_value_at(systemValue, ["descriptors"]),
        (name) => snapshot.registry.libraries.some((entry) => entry.name === name && entry.mode === "document"
          && entry.scope === undefined));
    }
    const bindings: HostedRegistryBinding[] = candidates.map(({ name, state, schema }) => Object.freeze({
      name, identity: state.identity, mode: state.mode, schema,
      ...(state.validation === undefined ? {} : { validation: state.validation }),
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
      || registry.digest !== registry_from_entries(snapshot.registry.libraries).digest) {
      throw new Error("LiveMap topology snapshot registry is inconsistent.");
    }
    const previousRevision = mapRevision;
    const changedLibraries = Object.freeze(candidates
      .filter(({ state, prepared, newlyInstalled, css }) => newlyInstalled || !canonical_graph_equal(state.root, prepared.root)
        || (css !== undefined && !portable_document_stylesheet_equal(stylesheet(state.identity), css)))
      .map(({ state }) => state.identity));
    // Portable restoration starts a fresh identity epoch. Existing shared
    // records remain live; removed/replaced identities disappear from lookup.
    checkRestore();
    mapIdentityEpoch.replace(reserved);
    identityGeneration += 1;
    for (const { state, prepared, projectedValue, css, addressState } of candidates) {
      Object.assign(state, {
        root: prepared.root,
        ...addressState,
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
    for (const state of libraryRegistry.all()) mark_quad_document_root(state.root, state.documentQuads);
    transitionController.invalidate();
    publishInstalledPosition();
    const restored = Object.freeze(candidates.map(({ state }) => state.identity));
    const correspondence = Object.freeze({ associations: Object.freeze(associations), assertCurrent: capture_fence() });
    portableRestorations.set(correspondence, portableStylesheets);
    afterTopologyInstall?.(restored);
    const event = Object.freeze({ previousRevision, revision: mapRevision, libraries: restored,
      changedLibraries, continuity: "new-epoch" as const });
    enqueuePublication(() => {
      deliver_livemap_observers(aggregateRestoreObservers, observer => observer(event), "restore");
      publishAuthorityPosition();
    });
    return correspondence;
  }

  function restore_libraries_aggregate(
    snapshot: LiveMapSnapshot | HostedLiveMapSnapshot,
    authority?: HostedAuthorityFence,
    afterTopologyInstall?: (identities: readonly LiveMapLibraryIdentity[]) => void,
  ): PortableQuadRestoration {
    const checkRestore = capture_fence();
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
      return restore_local_topology(snapshot, afterTopologyInstall);
    }
    if (snapshot.format !== LIVEMAP_LIBRARIES_SNAPSHOT_FORMAT
      || snapshot.registryDigest !== hosted.registry.digest
      || snapshot.registry.digest !== hosted.registry.digest
      || registry_from_entries(snapshot.registry.libraries).digest !== hosted.registry.digest) {
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
      documentQuads?: DocumentQuadBindings;
      documentOverlay?: import("./livemap.document.identity.js").LiveMapDocumentIdentityOverlay;
      projectedOverlay?: LiveMapProjectedIdentityOverlay;
      projectedValue?: OrderedProjectedValue;
    }>> = [];
    const reserved = new Set<string>();
    const foreignPayloads = disposable_document_quad_payloads(snapshot.libraries.map(entry => own_document_quads(entry)));
    const associations: PortableQuadRestoration["associations"][number][] = [];
    const portableStylesheets = new Map<LiveMapLibraryIdentity, import("../../internal/css/portable-document-stylesheet.js").PortableDocumentStylesheetRecord>();
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
        || hson_schema_source_digest(encoded.schema) !== hson_schema_source_digest(entry.schema) || encoded.schemaDigest !== entry.schemaDigest
        || hson_schema_source_digest(encoded.schema) !== encoded.schemaDigest) {
        throw new Error("Hosted aggregate snapshot Library metadata disagrees with its registry.");
      }
      const binding = hosted.byName.get(entry.name);
      if (binding === undefined) throw new Error("Hosted aggregate snapshot Library binding is unavailable.");
      const root = decode_hosted_root(encoded.root, HOSTED_MAX_SNAPSHOT_BYTES);
      if (identity === undefined) admit_portable_hson_node(root, "LiveMap Libraries snapshot");
      const prepared = prepare_livemap_root(root, entry.mode === "document" ? "document" : "data");
      if (prepared.mode !== entry.mode) throw new Error("Hosted aggregate snapshot root mode disagrees with its registry.");
      must_hson_schema_root(binding.schema, prepared.root);
      validate_data_library(prepared.root, prepared.mode, binding.validation);
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
      const library = require_library(binding.identity as LiveMapLibraryIdentity);
      const correspondence: DocumentQuadCorrespondence[] = [];
      const portableCss = prepared.mode === "document" ? encode_portable_document_stylesheet(decode_portable_document_stylesheet(encoded.css)) : undefined;
      const addressState = reconstruct_document(prepared, own_document_quads(encoded), portableCss, reserved, proof?.overlays.get(entry.name)?.document, correspondence, foreignPayloads);
      if (portableCss !== undefined) portableStylesheets.set(library.identity, portableCss);
      associations.push(...correspondence.map(subject => Object.freeze({ ...subject, library: library.identity, libraryName: entry.name })));
      candidates.push(Object.freeze({
        library,
        root: prepared.root,
        mode: prepared.mode,
        ...(prepared.mode === "document" ? { css: addressState.stylesheet } : {}),
        ...addressState,
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
      documentQuads: candidate.documentQuads,
      projectedOverlay: candidate.projectedOverlay,
      projectedValue: candidate.projectedValue,
      ...(candidate.css === undefined ? {} : { stylesheet: candidate.css }),
    }));
    if (systemCandidate !== undefined && systemCandidate.state.key === INTERACTION_RESERVED_LIBRARY_KEY) {
      validate_interaction_subjects(ordered_projected_value_at(systemCandidate.projectedValue, ["descriptors"]),
        (name) => hosted.registry.libraries.some((entry) => entry.name === name && entry.mode === "document"
          && entry.scope === undefined));
    }
    const active = aggregate_quid_locations(candidateStates);
    for (const quid of active.keys()) {
      if (identity === undefined ? !reserved.has(quid) : issuedLedger === undefined || !issuedLedger.has(quid)) {
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
    checkRestore();
    for (const candidate of candidates) {
      Object.assign(candidate.library, {
        root: candidate.root,
        documentOverlay: candidate.documentOverlay,
        documentQuads: candidate.documentQuads,
        projectedOverlay: candidate.projectedOverlay,
        projectedValue: candidate.projectedValue,
        ...(candidate.css === undefined ? {} : { stylesheet: candidate.css }),
      });
    }
    if (systemCandidate !== undefined) {
      systemCandidate.state.root = systemCandidate.root;
      systemCandidate.state.projectedValue = systemCandidate.projectedValue;
    }
    if (identity === undefined) mapIdentityEpoch.replace(reserved);
    else if (issuedLedger !== undefined) mapIdentityEpoch.install(make_livemap_issued_quid_ledger([
      ...enumerate_livemap_issued_quids(mapIdentityEpoch.issued()),
      ...enumerate_livemap_issued_quids(issuedLedger),
    ]));
    identityGeneration += 1;
    mapRevision = snapshot.revision;
    if (authority !== undefined) hostedFence = Object.freeze({ ...authority });
    transitionController.invalidate();
    for (const state of libraryRegistry.all()) mark_quad_document_root(state.root, state.documentQuads);
    publishInstalledPosition();
    // A hosted recovery snapshot is an atomic replacement boundary, not a
    // fabricated operation commit.  Selected document libraries use this to
    // deliver their normal in-place snapshot observation to Mirror while
    // retained data/document handles continue to resolve through the same
    // stable library records above.
    const restored = Object.freeze(libraryRegistry.all().map((library) => library.identity));
    const correspondence = Object.freeze({ associations: Object.freeze(associations), assertCurrent: capture_fence() });
    portableRestorations.set(correspondence, portableStylesheets);
    const event = Object.freeze({
      previousRevision,
      revision: snapshot.revision,
      libraries: restored,
      changedLibraries,
      continuity,
    });
    enqueuePublication(() => {
      deliver_livemap_observers(aggregateRestoreObservers, observer => observer(event), "restore");
      publishAuthorityPosition();
    });
    return correspondence;
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
    scoped = false,
    assertAcceptance?: () => void,
  ): void {
    // Capture the authentic grant before any caller-controlled snapshot access.
    const owner = transitionController.managedExecutionOwner();
    if (owner === undefined) throw new Error("Client restoration requires management.");
    const checkGrant = transitionController.captureManagementFence(owner);
    const position = capture_fence(), generation = transitionController.generation;
    const checkRestore = () => {
      checkGrant(); position(); assertAcceptance?.();
      if (generation !== transitionController.generation) throw new Error("Restoration preparation changed.");
    };
    const composition = clientComposition;
    if (composition === undefined) throw new Error("Client projection is not configured.");
    if (clientManagementOwner === undefined
      || transitionController.managedExecutionOwner() !== clientManagementOwner) {
      throw new Error("Client projection restore requires Echo management.");
    }
    assert_portable_aggregate_snapshot_shape(snapshot, scoped);
    if (scoped && (snapshot.authority.incarnationId !== composition.authority.incarnationId
      || snapshot.registryDigest !== composition.registry.digest || snapshot.revision < composition.revision)) {
      throw new Error("Private scoped restoration requires its current authorized registry and authority.");
    }
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
      documentQuads?: DocumentQuadBindings;
      documentScopes?: import("./livemap.document.scoped-quad.js").DocumentScopedQuads;
      documentOverlay?: import("./livemap.document.identity.js").LiveMapDocumentIdentityOverlay;
      projectedOverlay?: LiveMapProjectedIdentityOverlay;
      projectedValue?: OrderedProjectedValue;
      css?: import("../../internal/css/portable-document-stylesheet.js").PortableDocumentStylesheet;
      retained: boolean;
      graphChanged: boolean;
      changed: boolean;
      binding: HostedRegistryBinding;
    }>> = [];
    const reserved = new Set<string>();
    const foreignPayloads = new Set([...disposable_document_quad_payloads(snapshot.libraries.map(entry => own_document_quads(entry))),
      ...snapshot.libraries.flatMap(entry => entry.scopes?.subjects.map(subject => subject.name.slice(1)) ?? [])]);
    const scopedAuthority = { identityOwner: mapIdentityEpoch.owner, assertCurrent: checkRestore,
      readPart: () => { throw new Error("Receiving restoration cannot read Part definitions."); } };
    let stagedIssued = mapIdentityEpoch.issued();
    let nextSystem: LiveMapSystemState | undefined;
    let systemBinding: HostedRegistryBinding | undefined;
    for (let index = 0; index < snapshot.registry.libraries.length; index += 1) {
      const entry = snapshot.registry.libraries[index];
      const encoded = snapshot.libraries[index];
      if (entry === undefined || encoded === undefined || entry.name !== encoded.name
        || entry.mode !== encoded.mode || hson_schema_source_digest(entry.schema) !== hson_schema_source_digest(encoded.schema)
        || entry.schemaDigest !== encoded.schemaDigest) {
        throw new Error("Client projection snapshot Library metadata is incompatible.");
      }
      const oldBinding = composition.bindings.get(entry.name);
      if (oldBinding?.validation !== undefined && oldBinding.validation !== own_data_library_validation(entry)) {
        throw new Error("Reconciliation cannot remove an existing Part collection validation contract.");
      }
      if (entry.scope !== "hson-internal" && oldBinding === undefined && hosted.byName.has(entry.name)) {
        throw new Error("Client-local Library collides with the authority projection.");
      }
      const schema = HsonSchemaHandle.fromHson(entry.schema);
      const root = decode_hosted_root(encoded.root, HOSTED_MAX_SNAPSHOT_BYTES);
      admit_portable_hson_node(root, "Client projection snapshot");
      const prepared = prepare_livemap_root(root, entry.mode === "document" ? "document" : "data");
      if (prepared.mode !== entry.mode) throw new Error("Client projection snapshot root mode is incompatible.");
      must_hson_schema_root(schema, prepared.root);
      validate_data_library(prepared.root, prepared.mode, own_data_library_validation(entry));
      if (entry.scope === "hson-internal") {
        if (nextSystem !== undefined) throw new Error("Client projection has duplicate system state.");
        nextSystem = prepare_system_state(Object.freeze({
          key: INTERACTION_RESERVED_LIBRARY_KEY, transportName: entry.name,
          root: prepared.root, hsonSchema: schema,
        }));
        systemBinding = Object.freeze({ name: entry.name, scope: "hson-internal", identity: systemIdentity,
          mode: entry.mode, schema,
          ...(own_data_library_validation(entry) === undefined ? {} : { validation: own_data_library_validation(entry) }) });
      } else {
        const retained = oldBinding !== undefined && oldBinding.scope === undefined
          && oldBinding.mode === entry.mode && oldBinding.validation === own_data_library_validation(entry) && hson_schema_digest(oldBinding.schema) === hson_schema_source_digest(entry.schema);
        const previous = retained ? require_library(oldBinding.identity as LiveMapLibraryIdentity) : undefined;
        const state = previous ?? make_livemap_library(prepared, schema, own_data_library_validation(entry));
        if (!scoped && previous?.documentScopes !== undefined) throw new Error("Scoped restoration requires private admission.");
        if ((previous?.documentScopes !== undefined || previous?.documentScopesUnavailable) && encoded.scopes === undefined) {
          throw new Error("Scoped restoration requires complete scoped evidence.");
        }
        const scopedCandidate = encoded.scopes === undefined ? undefined : reconstruct_scoped_library(state,
          { root: prepared.root, scopes: encoded.scopes, css: encoded.css }, scopedAuthority,
          make_livemap_issued_quid_ledger([...enumerate_livemap_issued_quids(stagedIssued), ...reserved]), foreignPayloads);
        if (scopedCandidate !== undefined) {
          stagedIssued = scopedCandidate.issued;
          for (const quid of enumerate_livemap_issued_quids(stagedIssued)) reserved.add(quid);
        }
        const graphChanged = scopedCandidate !== undefined || previous?.documentScopes !== undefined
          || previous === undefined || !canonical_graph_equal(previous.root, prepared.root)
          || own_document_quads(encoded) !== undefined || (previous.documentQuads?.byName.size ?? 0) > 0;
        const addressState = scopedCandidate !== undefined
          ? { documentOverlay: scopedCandidate.overlay, documentQuads: scoped_aliases(scopedCandidate), stylesheet: scopedCandidate.stylesheet }
          : graphChanged ? reconstruct_document(prepared, own_document_quads(encoded), encoded.css, reserved, undefined, [], foreignPayloads)
          : { documentOverlay: state.documentOverlay, documentQuads: state.documentQuads, stylesheet: state.stylesheet };
        const css = graphChanged ? addressState.stylesheet : entry.mode === "document"
          ? decode_portable_document_stylesheet(encoded.css) : undefined;
        const changed = graphChanged
          || (css !== undefined && !portable_document_stylesheet_equal(stylesheet(state.identity), css));
        const binding: HostedRegistryBinding = Object.freeze({ name: entry.name, identity: state.identity,
          mode: entry.mode, schema, ...(own_data_library_validation(entry) === undefined ? {} : { validation: own_data_library_validation(entry) }) });
        candidates.push(Object.freeze({
          name: entry.name, state, binding, retained, graphChanged, changed,
          root: scopedCandidate?.root ?? (graphChanged ? prepared.root : state.root),
          documentOverlay: addressState.documentOverlay, documentQuads: addressState.documentQuads,
          documentScopes: scopedCandidate?.scopes,
          projectedOverlay: graphChanged ? prepared.projectedOverlay : state.projectedOverlay,
          projectedValue: entry.mode === "document" ? undefined
            : graphChanged ? must_projected_root_value(prepared.root) : state.projectedValue,
          css,
        }));
      }
    }
    const projectedBindings = candidates.map((candidate) => candidate.binding);
    const localDocumentNames = new Set(localBindings.filter((binding) => binding.mode === "document")
      .map((binding) => binding.name));
    const projectedDocumentNames = new Set(projectedBindings.filter((binding) => binding.mode === "document")
      .map((binding) => binding.name));
    const currentClassify = (name: string): "shared" | "local" | undefined => {
      const binding = hosted.byName.get(name);
      if (binding?.mode !== "document" || binding.scope !== undefined) return undefined;
      return composition.bindings.has(name) ? "shared" : "local";
    };
    const localDescriptors = systemState === undefined ? [] : partition_interaction_descriptors(
      interaction_descriptors_from_root(systemState.projectedValue), currentClassify).local;
    const incomingDescriptors = nextSystem === undefined ? [] : interaction_descriptors_from_root(nextSystem.projectedValue);
    const incoming = partition_interaction_descriptors(ordered_projected_array(incomingDescriptors), (name) =>
      projectedDocumentNames.has(name) ? "shared" : localDocumentNames.has(name) ? "local" : undefined);
    if (incoming.local.length > 0) throw new Error("Authority interaction snapshot contains a local subject.");
    const keepLocalSystem = localDocumentNames.size > 0;
    const composedSystem = nextSystem !== undefined || keepLocalSystem ? prepare_system_state({
      key: INTERACTION_RESERVED_LIBRARY_KEY,
      transportName: nextSystem?.transportName ?? systemState?.transportName
        ?? INTERACTION_RESERVED_LIBRARY_TRANSPORT_NAME,
      hsonSchema: nextSystem?.hsonSchema ?? systemState?.hsonSchema ?? interaction_schema_internal(),
      root: projected_value_to_hson_root(ordered_projected_object([["descriptors",
        merge_interaction_descriptors(incoming.shared, localDescriptors)]])),
    }) : undefined;
    const composedSystemBinding: HostedRegistryBinding | undefined = composedSystem === undefined ? undefined
      : systemBinding ?? Object.freeze({ name: composedSystem.transportName, scope: "hson-internal",
        identity: composedSystem.identity, mode: "data-object", schema: composedSystem.hsonSchema });
    const nextBindings = [...localBindings, ...projectedBindings,
      ...(composedSystemBinding === undefined ? [] : [composedSystemBinding])];
    const nextRegistry = make_hosted_registry(nextBindings);
    const nextProjectedRegistry = make_hosted_registry([...projectedBindings,
      ...(systemBinding === undefined ? [] : [systemBinding])]);
    if (nextProjectedRegistry.digest !== snapshot.registryDigest
      || nextProjectedRegistry.digest !== registry_from_entries(snapshot.registry.libraries).digest) {
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
    const documentRootRebases = Object.freeze(candidates.flatMap(candidate => {
      if (!candidate.retained || !candidate.graphChanged || candidate.state.mode !== "document") return [];
      const path = validate_document_path([0]);
      const from = candidate.state.documentOverlay?.quidAtPath(path), to = candidate.documentOverlay?.quidAtPath(path);
      return from === to ? [] : [Object.freeze({ library: candidate.state.identity, from, to })];
    }));
    const semanticChanged = retired.length > 0 || candidates.some((candidate) => candidate.changed)
      || (systemState === undefined) !== (composedSystem === undefined)
      || (systemState !== undefined && composedSystem !== undefined
        && !canonical_graph_equal(systemState.root, composedSystem.root));
    // The complete candidate is validated before this single installation.
    checkRestore();
    mapIdentityEpoch.install(ledger);
    identityGeneration += 1;
    for (const candidate of candidates) {
      if (candidate.changed) Object.assign(candidate.state, {
        root: candidate.root, documentOverlay: candidate.documentOverlay, documentQuads: candidate.documentQuads,
        documentScopes: candidate.documentScopes, documentScopesUnavailable: undefined,
        projectedOverlay: candidate.projectedOverlay, projectedValue: candidate.projectedValue,
        ...(candidate.css === undefined ? {} : { stylesheet: candidate.css }),
      });
      projectedCaptureContinuity.set(candidate.state.identity, Object.freeze({}));
    }
    for (const identity of retired) projectedCaptureContinuity.delete(identity);
    libraryRegistry.replace([...localStates, ...candidates.map((candidate) => candidate.state)]);
    systemState = composedSystem;
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
    for (const state of libraryRegistry.all()) mark_quad_document_root(state.root, state.documentQuads);
    publishInstalledPosition();
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
      documentRootRebases,
    });
    enqueuePublication(() => {
      deliver_livemap_observers(aggregateRestoreObservers, observer => observer(event), "restore");
      publishAuthorityPosition();
    });
  }

  function replay_portable_hosted_aggregate(input: PortableAggregateCommit | PrivateScopedAggregateCommit, durable: boolean, authorityRev?: number, scoped = false, assertAcceptance?: () => void): LiveMapAggregateCommit | undefined {
    // Capture before any input traps, getters, enumeration or serialization.
    const managementOwner = transitionController.managedExecutionOwner();
    const checkManagement = managementOwner === undefined ? undefined
      : transitionController.captureManagementFence(managementOwner);
    const assertManagementCurrent = () => { checkManagement?.(); assertAcceptance?.(); };
    if (clientComposition === undefined) transitionController.assertPublicMutationAllowed();
    const hosted = require_hosted_state();
    const composition = clientComposition;
    if (durable && composition !== undefined) throw new Error("Durable replay requires full-map authority.");
    if (scoped && !durable && (composition === undefined || transitionController.managedExecutionOwner() !== clientManagementOwner)) {
      throw new Error("Private scoped receiving requires the managed Echo projection.");
    }
    let decoded: readonly (import("./livemap.hosted.js").DecodedHostedOperation & Readonly<{
      scoped?: import("./livemap.document.scoped-effects.js").DocumentScopedEffect;
    }>)[];
    if (scoped) {
      if ("format" in input) throw new Error("Invalid private scoped receiving envelope.");
      decoded = decode_private_scoped_aggregate_commit(input, composition?.registry ?? hosted.registry, composition?.bindings ?? hosted.byName);
    } else {
      if (!("format" in input)) throw new Error("Private scoped delivery remains inactive.");
      decoded = decode_portable_aggregate_commit(input, composition?.registry ?? hosted.registry, composition?.bindings ?? hosted.byName);
    }
    if (input.authority.logicalMapId !== hosted.fence.logicalMapId
      || input.authority.incarnationId !== hosted.fence.incarnationId) {
      throw new Error("Hosted client commit authority fence is incompatible.");
    }
    if (composition !== undefined || authorityRev !== undefined) {
      if (authorityRev === undefined || input.prevRev !== authorityRev
        || composition !== undefined && authorityRev !== composition.revision) {
        throw new LiveMapRevError(input.prevRev, authorityRev ?? -1);
      }
    } else if (input.prevRev !== mapRevision) throw new LiveMapRevError(input.prevRev, mapRevision);
    let replaySharedRoot: OrderedProjectedValue | undefined;
    let replayComposedDescriptors: OrderedProjectedValue | undefined;
    const receivingEffects = new Map<LiveMapAggregateWrite, import("./livemap.document.scoped-effects.js").DocumentScopedEffect>();
    const writes: LiveMapAggregateWrite[] = decoded.map((entry): LiveMapAggregateWrite => {
      if (entry.css !== undefined) {
        const write: LiveMapAggregateWrite = Object.freeze({ target: aggregate_target(entry.library.identity as LiveMapLibraryIdentity, []),
          kind: "css", operation: entry.css });
        if (entry.scoped !== undefined) receivingEffects.set(write, entry.scoped);
        return write;
      }
      const path = "path" in entry.semantic ? entry.semantic.path : (
        "target" in entry.semantic ? entry.semantic.target.path : []
      );
      const target = entry.library.scope === "hson-internal"
        ? aggregate_system_target(entry.library.identity as LiveMapSystemIdentity, path)
        : aggregate_target(entry.library.identity as LiveMapLibraryIdentity, path);
      if (composition !== undefined && entry.library.scope === "hson-internal" && entry.projected !== undefined) {
        if (systemState === undefined) throw new Error("Client interaction system state is unavailable.");
        const current = replayComposedDescriptors ?? ordered_projected_value_at(systemState.projectedValue, ["descriptors"]);
        if (current === undefined) throw new Error("Client interaction descriptors are unavailable.");
        const classify = (name: string): "shared" | "local" | undefined => {
          const binding = hosted.byName.get(name);
          if (binding?.mode !== "document" || binding.scope !== undefined) return undefined;
          return composition.bindings.has(name) ? "shared" : "local";
        };
        const partitions = partition_interaction_descriptors(current, classify);
        replaySharedRoot ??= ordered_projected_object([["descriptors", ordered_projected_array(partitions.shared)]]);
        const sharedValue = ordered_projected_value_at(replaySharedRoot, entry.projected.path);
        must_replay_value(entry.projected.path, entry.projected.prev, sharedValue);
        const planned = plan_write_ops(replaySharedRoot, [projected_write_op_from_transport(entry.projected)]);
        must_replay_value(entry.projected.path, entry.projected.next,
          ordered_projected_value_at(planned.value, entry.projected.path));
        const incoming = ordered_projected_value_at(planned.value, ["descriptors"]);
        if (incoming === undefined) throw new Error("Authority interaction descriptors are unavailable.");
        const incomingPartition = partition_interaction_descriptors(incoming, classify);
        if (incomingPartition.local.length > 0) throw new Error("Authority interaction replay contains a local subject.");
        const merged = merge_interaction_descriptors(incomingPartition.shared, partitions.local);
        const transformed: LiveMapProjectedDataOp = Object.freeze({
          kind: "replace", path: ["descriptors"], prev: current, next: merged,
        });
        replaySharedRoot = planned.value;
        replayComposedDescriptors = merged;
        return Object.freeze({ target: aggregate_system_target(systemState.identity, ["descriptors"]),
          kind: "replay-data", operation: transformed });
      }
      if (entry.projected !== undefined) return Object.freeze({ target, kind: "replay-data", operation: entry.projected });
      if (entry.graph === undefined || entry.graph.op === "ensure-quid") {
        throw new Error("Hosted client event contains an identity-only operation.");
      }
      const write: LiveMapAggregateWrite = Object.freeze({ target, kind: "graph", operation: entry.graph });
      if (entry.scoped !== undefined) receivingEffects.set(write, entry.scoped);
      return write;
    });
    if (composition !== clientComposition) throw new Error("Echo receiving projection changed during decoding.");
    const transition = prepare_authority_transition(writes, [], true, false, receivingEffects,
      composition === undefined ? undefined : input.rev, assertManagementCurrent);
    if (composition !== undefined) return transitionController.acceptAuthority(transition, "isolate").commit;
    const local = transition.commit.hosted;
    if (durable && scoped) {
      try {
        if (local === undefined || !transition.commit.changed
          || JSON.stringify(encode_authoritative_scoped_commit(local)) !== JSON.stringify(input)) {
          throw new Error("Durable scoped replay did not reproduce its complete effects.");
        }
        assertManagementCurrent();
      } catch (cause) { transitionController.discardAuthority(transition); throw cause; }
      return transitionController.acceptAuthority(transition).commit;
    }
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
      && "format" in input && localClient.format === input.format
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

  function replay_client_hosted_aggregate(input: PortableAggregateCommit | PrivateScopedAggregateCommit, authorityRev?: number, scoped = false, assertAcceptance?: () => void): LiveMapAggregateCommit {
    const replayed = replay_portable_hosted_aggregate(input, false, authorityRev, scoped, assertAcceptance);
    if (replayed === undefined) throw new Error("Hosted client replay made no authority progress.");
    return replayed;
  }

  function replay_durable_hosted_aggregate(input: PortableAggregateCommit | PrivateScopedAggregateCommit): void {
    replay_portable_hosted_aggregate(input, true, undefined, !("format" in input));
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

  const initialReserved = new Set<string>();
  const initialPayloads = new Set([...disposable_document_quad_payloads(registry.map(entry => entry.quads)),
    ...registry.flatMap(entry => entry.scopes?.subjects.map(subject => subject.name.slice(1)) ?? [])]);
  registry.forEach((entry, index) => {
    const state = states[index];
    if (state === undefined) throw new Error("Incomplete initial Library registry.");
    if (entry.compositionStyles !== undefined) merge_part_stylesheets([...(entry.css === undefined ? [] : [encode_portable_document_stylesheet(entry.css)]), ...entry.compositionStyles.map(item => item.css)]);
    if (entry.scopes === undefined) Object.assign(state, reconstruct_document(entry.graph, entry.quads, entry.css === undefined ? undefined : encode_portable_document_stylesheet(entry.css), initialReserved, undefined, [], initialPayloads));
    const initialAuthority = { identityOwner: mapIdentityEpoch.owner, assertCurrent: capture_fence(),
      readPart: () => { throw new Error("Initial restoration cannot read Part collections."); } };
    if (entry.scopes !== undefined) {
      const candidate = reconstruct_scoped_library(state, { root: state.root, scopes: entry.scopes,
        css: encode_portable_document_stylesheet(entry.css!) }, initialAuthority,
        make_livemap_issued_quid_ledger(initialReserved), initialPayloads);
      for (const quid of enumerate_livemap_issued_quids(candidate.issued)) initialReserved.add(quid);
      Object.assign(state, { root: candidate.root, documentOverlay: candidate.overlay, documentScopes: candidate.scopes,
        documentQuads: scoped_aliases(candidate), stylesheet: candidate.stylesheet });
    } else if (entry.compositionScopes !== undefined) {
      const composition = { root: state.root, scoped: entry.compositionScopes, styles: entry.compositionStyles ?? [],
        identityDemands: (entry.compositionStyles ?? []).flatMap(style => style.subjects.map(subject => subject.path)) };
      const candidate = prepare_document_scoped_library_styles(prepare_document_scoped_composition({ owner: state.identity,
        root: state.root, overlay: require_document_overlay(state.documentOverlay),
        issued: make_livemap_issued_quid_ledger(initialReserved) }, composition, initialAuthority), state.stylesheet!);
      for (const quid of enumerate_livemap_issued_quids(candidate.issued)) initialReserved.add(quid);
      Object.assign(state, { documentOverlay: candidate.overlay, documentScopes: candidate.scopes, stylesheet: candidate.stylesheet });
    } else if (entry.compositionStyles !== undefined) {
      state.documentScopesUnavailable = true;
      Object.assign(state, compose_styles(state.root, require_document_overlay(state.documentOverlay), entry.compositionStyles, initialReserved, state.stylesheet));
    }
    mark_quad_document_root(state.root, state.documentQuads);
  });
  if (initialReserved.size) {
    mapIdentityEpoch.install(stage_livemap_identity_epoch(mapIdentityEpoch.issued(), [], initialReserved));
    identityGeneration += 1;
  }

  const aggregateAuthority: InternalLiveMapAggregateAuthority = Object.freeze({
    libraries: () => Object.freeze(libraryRegistry.all().map((library) => library.identity)),
    configureSystemState: (key, transportName, root, hsonSchema) => {
      if (systemState !== undefined) {
        if (systemState.key === key) return systemState.identity;
        throw new Error("LiveMap transactional system-state slot is already configured.");
      }
      const localClientEnable = clientComposition !== undefined
        && key === INTERACTION_RESERVED_LIBRARY_KEY
        && libraryRegistry.all().some((state) => state.mode === "document"
          && !clientComposition?.projected.has(state.identity));
      if (!localClientEnable) transitionController.assertPublicMutationAllowed();
      if (mapRevision !== 0 && !localClientEnable) {
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
      if (localClientEnable) {
        const prevRev = mapRevision;
        mapRevision += 1;
        transitionController.invalidate();
        const commit: LiveMapAggregateCommit = Object.freeze({
          kind: "aggregate", changed: true, prevRev, rev: mapRevision, operations: Object.freeze([]),
        });
        enqueuePublication(() => {
          aggregateAcceptedTransitions += 1;
          aggregatePublications += 1;
          deliver_livemap_observers(aggregateObservers, observer => observer(commit), "commit");
          publishAuthorityPosition();
        });
      }
      return candidate.identity;
    },
    systemState: (key) => systemState?.key === key ? systemState.identity : undefined,
    systemRoot: (system) => require_system(system).root,
    systemTarget: aggregate_system_target,
    configureHostedRegistry: configure_hosted_registry,
    addLibraries: add_libraries,
    addClientLocalLibraries: add_client_local_libraries,
    assertPublicMutationAllowed: transitionController.assertPublicMutationAllowed,
    captureFence: capture_fence,
    prepareScopedDocument: (identity, source) => {
      const authority = scoped_preparation_authority(), library = require_library(identity);
      if (library.mode !== "document") throw new Error("Scoped preparation requires a document Library.");
      const composition = expand_document_composition("candidate", () => source,
        document_composition_options(undefined), authority.readPart);
      authority.assertCurrent();
      const prepared = prepare_livemap_root(composition.root, "document");
      const candidate = prepare_document_scoped_composition({ owner: library.identity, root: composition.root,
        overlay: require_document_overlay(prepared.documentOverlay), issued: mapIdentityEpoch.issued() }, composition, authority);
      return finish_scoped_preparation(prepare_document_scoped_library_styles(candidate, stylesheet(identity)));
    },
    prepareScopedDocumentOperations: (before, operations) => {
      if (!scopedPreparations.has(before)) throw new Error("Scoped candidate belongs to another Library preparation authority.");
      const authority = scoped_preparation_authority(before.assertCurrent);
      before.assertCurrent();
      const candidate = prepare_document_scoped_operations(before, before.scopes, operations, authority);
      return finish_scoped_preparation(prepare_document_scoped_library_styles(candidate, before.stylesheet, before, true));
    },
    captureScopedDocumentEffects: (candidate) => {
      if (!scopedPreparations.has(candidate)) throw new Error("Scoped candidate belongs to another Library preparation authority.");
      candidate.assertCurrent();
      if (candidate.effects === undefined) throw new Error("Scoped candidate has no incremental operation evidence.");
      return encode_document_scoped_effects(candidate.effects);
    },
    prepareScopedDocumentEffectReplay: (before, input) => {
      if (!scopedPreparations.has(before)) throw new Error("Scoped candidate belongs to another Library preparation authority.");
      const authority = scoped_preparation_authority(before.assertCurrent), library = require_library(before.owner);
      return finish_scoped_preparation(replay_document_scoped_effects(before, input, authority, root => {
        if (library.hsonSchema !== undefined) must_hson_schema_root(library.hsonSchema, root);
      }));
    },
    captureScopedDocument: (candidate) => {
      if (!scopedPreparations.has(candidate)) throw new Error("Scoped candidate belongs to another Library preparation authority.");
      return capture_document_scoped_library(candidate);
    },
    prepareScopedDocumentRestoration: (identity, input) => {
      const authority = scoped_preparation_authority(), library = require_library(identity);
      return finish_scoped_preparation(reconstruct_scoped_library(library, input, authority));
    },
    initializeClientScopedDocumentsManaged: (owner, documents) => transitionController.runManaged(owner, () => {
      // Even documents.length may execute a caller Proxy trap.
      const assertManagementCurrent = transitionController.captureManagementFence(owner);
      const composition = clientComposition;
      if (composition === undefined || clientManagementOwner !== owner || documents.length === 0) throw new Error("Scoped initialization requires Echo projection management and complete documents.");
      const assertCurrent = capture_fence(), generation = transitionController.generation;
      const authority = { identityOwner: mapIdentityEpoch.owner, assertCurrent: () => {
        assertManagementCurrent();
        assertCurrent(); transitionController.assertLocalIdentityAllowed();
        if (generation !== transitionController.generation || composition !== clientComposition) throw new Error("Scoped initialization authority changed.");
      }, readPart: () => { throw new Error("Receiving scoped restoration cannot read Part collections."); } };
      const seen = new Set<string>();
      // Initial private restoration only enriches an already authorized graph.
      // It cannot replace a graph, an installed scoped predecessor, or a cursor.
      // Own the result array: a caller-supplied map/species must not carry
      // candidate callbacks or iterators into the installation phase.
      const inputs = Array.from(documents, entry => {
        const binding = composition.bindings.get(entry.library);
        if (seen.has(entry.library) || binding === undefined || binding.mode !== "document" || binding.scope !== undefined) {
          throw new Error("Scoped initialization requires an exact authorized document Library.");
        }
        seen.add(entry.library);
        const library = require_library(binding.identity);
        const state = decode_document_scoped_library(entry.state);
        if (library.documentScopes !== undefined || library.documentScopesUnavailable
          || !canonical_graph_equal(library.root, state.root)) throw new Error("Scoped initialization disagrees with its installed predecessor.");
        return { library, state };
      });
      let issued = mapIdentityEpoch.issued();
      const candidates = inputs.map(({ library, state }) => {
        const candidate = reconstruct_scoped_library(library, state, authority, issued);
        issued = make_livemap_issued_quid_ledger([...enumerate_livemap_issued_quids(issued), ...enumerate_livemap_issued_quids(candidate.issued)]);
        // Flat aliases already admitted by the projected initial state retain
        // their names through paths; disposable CSS labels never become aliases.
        const quads = make_document_quad_bindings([...(library.documentQuads?.byName ?? [])].map(([name, quid]) => {
          const path = library.documentOverlay?.pathForQuid(quid), next = path === undefined ? undefined : candidate.overlay.quidAtPath(path);
          if (next === undefined) throw new Error("Scoped initialization lost an authored alias.");
          return { name, quid: next };
        }));
        return { library, candidate, quads };
      });
      authority.assertCurrent();
      mapIdentityEpoch.install(issued);
      for (const { library, candidate, quads } of candidates) Object.assign(library, {
        root: candidate.root, documentOverlay: candidate.overlay, documentScopes: candidate.scopes,
        documentQuads: quads, stylesheet: candidate.stylesheet,
      });
      for (const { library } of candidates) mark_quad_document_root(library.root, library.documentQuads);
      identityGeneration += 1;
      transitionController.invalidate();
      publishInstalledPosition();
    }),
    captureDocumentSsr: (identity, demanded) => {
      const assertCurrent = capture_fence(), state = require_library(identity);
      if (state.mode !== "document") throw new Error("SSR subject capture requires a document Library.");
      if (state.documentScopes !== undefined) throw new Error("Scoped document SSR remains inactive.");
      const overlay = require_document_overlay(state.documentOverlay);
      const quads = project_document_correspondence(state.root, overlay, state.documentQuads,
        mapIdentityEpoch.issued(), demanded);
      const correspondence: DocumentQuadCorrespondence[] = (quads ?? []).map(entry => {
        const quid = overlay.quidAtPath(entry.path);
        if (quid === undefined || !mapIdentityEpoch.issued().has(quid)) throw new Error("SSR subject requires active owner issuance.");
        return Object.freeze({ name: entry.name, path: entry.path, quid, disposition: document_quad_disposition(entry) });
      });
      const root = clone_hson_graph_without_quids(validated_library_root(state));
      const authoredCss = encode_portable_document_stylesheet(stylesheet(identity));
      const css = document_css_mentions_subject_identity(authoredCss)
        ? translate_document_css_identities(authoredCss, "outbound", { associations: correspondence, assertCurrent })
        : authoredCss;
      assertCurrent();
      return Object.freeze({ revision: mapRevision, root, css,
        ...(quads === undefined ? {} : { quads }), correspondence: Object.freeze(correspondence) });
    },
    installInitialDocumentQuads: install_initial_document_quads,
    documentQuad: (identity: LiveMapLibraryIdentity, name: string | undefined, quid: string | undefined) => {
      const state = require_library(identity);
      return resolve_document_quad(state.root, require_document_overlay(state.documentOverlay), state.documentQuads, name, quid);
    },
    projectDocumentCorrespondence: (identity, quids) => {
      const check = capture_fence(), state = require_library(identity);
      if (state.mode !== "document") throw new Error("Correspondence requires a document Library.");
      const result = project_document_correspondence(state.root, require_document_overlay(state.documentOverlay),
        state.documentQuads, mapIdentityEpoch.issued(), quids);
      check();
      return result;
    },
    prepareAddLibrariesManaged: (owner, definitions, assertEntryCurrent) => {
      const assertManagedEntryCurrent = capture_managed_restoration_fence(owner);
      const assertCurrent = () => { assertEntryCurrent?.(); assertManagedEntryCurrent(); };
      assertCurrent();
      return transitionController.runManaged(owner, () => prepare_add_libraries(definitions, false, assertCurrent));
    },
    useLibrarySchema: use_library_schema,
    librarySchema: (library) => {
      const schema = require_library(library).hsonSchema;
      if (schema === undefined) throw new Error("LiveMap Library governing Schema is unavailable.");
      return schema;
    },
    hostedRegistry: () => require_hosted_state().registry,
    hostedPosition: () => {
      const hosted = require_hosted_state();
      return Object.freeze({ authority: hosted.fence, revision: mapRevision, registryDigest: hosted.registry.digest });
    },
    documentAuthority: (identity) => {
      if (require_library(identity).mode !== "document") throw new Error("Document authority requires a document Library.");
      return clientComposition !== undefined && !clientComposition.projected.has(identity) ? undefined : hostedFence;
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
      publishInstalledPosition();
      const continuity = hosted.fence.logicalMapId === authority.logicalMapId
        && hosted.fence.incarnationId === authority.incarnationId ? "same-epoch" as const : "new-epoch" as const;
      const event = Object.freeze({ previousRevision: mapRevision, revision: mapRevision,
        libraries: Object.freeze(libraryRegistry.all().map((library) => library.identity)),
        changedLibraries: Object.freeze([]), continuity });
      enqueuePublication(() => {
        deliver_livemap_observers(aggregateRestoreObservers, observer => observer(event), "restore");
        publishAuthorityPosition();
      });
    },
    captureSelectedHosted: capture_selected_hosted,
    captureManagementFence: (owner) => transitionController.captureManagementFence(owner),
    captureManagedRestorationFence: capture_managed_restoration_fence,
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
    prepareClientProjectionSystemManaged: (owner, root, newSharedDocuments) => transitionController.runManaged(owner, () => {
      if (clientComposition === undefined || clientManagementOwner !== owner || systemState === undefined) {
        throw new Error("Client projected system state is unavailable.");
      }
      admit_portable_hson_node(root, "Client projected system root");
      const prepared = prepare_livemap_root(root, "data");
      if (prepared.mode !== "data-object") throw new Error("Client projected system root mode is incompatible.");
      must_hson_schema_root(systemState.hsonSchema, prepared.root);
      const value = must_projected_root_value(prepared.root);
      const hosted = require_hosted_state();
      const classify = (name: string): "shared" | "local" | undefined => {
        const binding = hosted.byName.get(name);
        if (binding?.mode !== "document" || binding.scope !== undefined) return undefined;
        return clientComposition?.bindings.has(name) ? "shared" : "local";
      };
      const local = partition_interaction_descriptors(
        interaction_descriptors_from_root(systemState.projectedValue), classify).local;
      const projectedDocuments = new Set([...clientComposition.bindings.values()]
        .filter((binding) => binding.mode === "document").map((binding) => binding.name));
      for (const name of newSharedDocuments) projectedDocuments.add(name);
      const incoming = partition_interaction_descriptors(interaction_descriptors_from_root(value), (name) =>
        projectedDocuments.has(name) ? "shared" : undefined);
      const merged = merge_interaction_descriptors(incoming.shared, local);
      const composedValue = ordered_projected_object([["descriptors", merged]]);
      const composedRoot = projected_value_to_hson_root(composedValue);
      must_hson_schema_root(systemState.hsonSchema, composedRoot);
      return () => {
        if (systemState !== undefined) {
          systemState.root = composedRoot;
          systemState.projectedValue = composedValue;
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
    restorePortableLibrariesWithCorrespondence: (snapshot) => {
      const check = capture_fence();
      transitionController.assertPublicMutationAllowed();
      assert_libraries_snapshot_shape(snapshot);
      check();
      return restore_libraries_aggregate(snapshot);
    },
    assertPortableDocumentHandoff: (candidate) => {
      if (!portableHandoffs.has(candidate)) throw new Error("Portable handoff candidate belongs to another Library authority.");
      candidate.assertCurrent();
    },
    preparePortableDocumentHandoff: (identity, restoration) => {
      // The installation capability proves completeness, including disposable
      // subjects that deliberately have no retained authored QUAD registration.
      if (!portableRestorations.has(restoration)) throw new Error("Portable correspondence belongs to another restoring authority.");
      restoration.assertCurrent();
      transitionController.assertPublicMutationAllowed();
      if (clientComposition !== undefined) throw new Error("Portable document handoff requires an ordinary local Library.");
      const state = require_library(identity), binding = require_hosted_state().byIdentity.get(identity);
      if (state.mode !== "document" || binding === undefined || binding.scope !== undefined) throw new Error("Portable handoff requires the selected document Library.");
      const overlay = require_document_overlay(state.documentOverlay);
      const associations = restoration.associations.filter(entry => entry.library === identity);
      const entries = associations.map((entry): PortableDocumentQuads[number] => {
        const currentPath = overlay.pathForQuid(entry.quid);
        if (entry.libraryName !== binding.name || overlay.quidAtPath(entry.path) !== entry.quid
          || currentPath === undefined || !document_path_equal(currentPath, entry.path)
          || !mapIdentityEpoch.issued().has(entry.quid)
          || !is_ordinary_element_node(resolve_document_path(state.root, "document", entry.path))) {
          throw new Error("Portable handoff subject does not match its owning Library and exact path.");
        }
        const authored = resolve_document_quad(state.root, overlay, state.documentQuads, entry.name, undefined);
        if (entry.disposition === "authored" ? authored?.quid !== entry.quid
          : entry.disposition !== "disposable" || authored !== undefined || state.documentQuads?.byQuid.has(entry.quid)) {
          throw new Error("Portable handoff disposition conflicts with authored Library associations.");
        }
        return entry.disposition === "disposable"
          ? { name: entry.name, path: entry.path, disposition: "disposable" }
          : { name: entry.name, path: entry.path };
      });
      const quads = entries.length === 0 ? undefined : decode_document_quads(entries, state.root, "document");
      const portable = portableRestorations.get(restoration)?.get(identity);
      if (portable === undefined) throw new Error("Portable restoration stylesheet evidence is unavailable.");
      const translated = document_css_mentions_subject_identity(portable)
        ? translate_document_css_identities(portable, "inbound", { associations, assertCurrent: restoration.assertCurrent }, true)
        : portable;
      if (!portable_document_stylesheet_equal(stylesheet(identity), decode_portable_document_stylesheet(translated))) {
        throw new Error("Portable restoration CSS evidence disagrees with the current receiving Library.");
      }
      const portableCss = render_portable_document_stylesheet(decode_portable_document_stylesheet(portable));
      const receivingCss = render_portable_document_stylesheet(decode_portable_document_stylesheet(translated));
      restoration.assertCurrent();
      let check = capture_fence(), accepted = false;
      const root = state.root;
      const candidate: PortableDocumentHandoff = Object.freeze({ owner: aggregateAuthority, library: identity, libraryName: binding.name,
        quads, portableCss, receivingCss, assertCurrent: () => check(),
        acceptCss: () => {
          check();
          if (accepted) return;
          const before = mapRevision, generation = identityGeneration, authority = hostedFence, registry = hostedRegistry;
          const commit = commit_stylesheet(identity, { domain: "css", kind: "replace", stylesheet: translated });
          // Publication can reenter. Only this exact accepted CSS transition
          // earns a new fence; any other graph/identity/authority change rejects.
          if (mapRevision !== commit.rev || commit.prevRev !== before || identityGeneration !== generation
            || hostedFence !== authority || hostedRegistry !== registry || state.root !== root || state.documentOverlay !== overlay
            || !portable_document_stylesheet_equal(stylesheet(identity), decode_portable_document_stylesheet(translated))) {
            throw new Error("Receiving authority changed during portable CSS acceptance.");
          }
          accepted = true;
          check = capture_fence();
        },
      });
      portableHandoffs.add(candidate);
      return candidate;
    },
    restoreHosted: restore_hosted_aggregate,
    restoreClientHosted: restore_client_hosted_aggregate,
    restoreClientHostedManaged: (owner, snapshot, afterTopologyInstall, scoped, assertAcceptance) => transitionController.runManaged(
      owner,
      () => clientComposition === undefined ? restore_client_hosted_aggregate(snapshot)
        : restore_client_projection(snapshot, afterTopologyInstall, scoped, assertAcceptance),
    ),
    restoreHostedManaged: (owner, snapshot) => transitionController.runManaged(
      owner,
      () => restore_hosted_aggregate(snapshot),
    ),
    replayHosted: replay_hosted_aggregate,
    replayClientHosted: replay_client_hosted_aggregate,
    replayDurableHosted: replay_durable_hosted_aggregate,
    replayClientHostedManaged: (owner, commit, authorityRev, scoped, assertAcceptance) => transitionController.runManaged(
      owner,
      () => replay_client_hosted_aggregate(commit, authorityRev, scoped, assertAcceptance),
    ),
    replayHostedManaged: (owner, commit) => transitionController.runManaged(
      owner,
      () => replay_hosted_aggregate(commit),
    ),
    advanceHostedProgressManaged: (owner, input) => transitionController.runManaged(owner, () => {
      // Retain the exact grant and installed cut before caller-controlled reads.
      const assertCurrent = capture_managed_restoration_fence(owner);
      const hosted = require_hosted_state();
      const composition = clientComposition;
      const progress = Object.freeze({ logicalMapId: input.logicalMapId, incarnationId: input.incarnationId,
        registryDigest: input.registryDigest, prevRev: input.prevRev, rev: input.rev });
      if (progress.logicalMapId !== hosted.fence.logicalMapId
        || progress.incarnationId !== hosted.fence.incarnationId
        || progress.registryDigest !== (composition?.registry.digest ?? hosted.registry.digest)) {
        throw new Error("Hosted authority progress fence is incompatible.");
      }
      if (composition !== undefined) {
        if (!Number.isSafeInteger(progress.prevRev) || !Number.isSafeInteger(progress.rev) || progress.prevRev !== composition.revision
          || progress.rev !== progress.prevRev + 1) {
          throw new LiveMapRevError(progress.prevRev, composition.revision);
        }
        assertCurrent();
        clientComposition = Object.freeze({ ...composition, revision: progress.rev });
        publishInstalledPosition();
        return progress.rev;
      }
      if (!Number.isSafeInteger(progress.prevRev) || !Number.isSafeInteger(progress.rev)
        || progress.prevRev !== mapRevision || progress.rev !== mapRevision + 1) {
        throw new LiveMapRevError(progress.prevRev, mapRevision);
      }
      assertCurrent();
      mapRevision = progress.rev;
      publishInstalledPosition();
      publishAuthorityPosition();
      return mapRevision;
    }),
    observeAuthorityPosition: (listener, phase = "published") => {
      const observer = Object.freeze({ listener, phase });
      aggregatePositionObservers.push(observer);
      return () => {
        const index = aggregatePositionObservers.indexOf(observer);
        if (index !== -1) aggregatePositionObservers.splice(index, 1);
      };
    },
    target: aggregate_target,
    root: (library) => validated_library_root(require_library(library)),
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
    withPublicBatch: transitionController.withPublicBatch,
    prepareManaged: (owner, writes, scopedDocuments) => transitionController.runManaged(
      owner,
      () => prepare_authority_transition(writes, [], false, scopedDocuments),
    ),
    documentScopes: (identity) => require_library(identity).documentScopes,
    scopedDocumentState: (identity) => {
      const library = require_library(identity), assertCurrent = capture_fence();
      if (library.documentScopesUnavailable) throw new Error("Missing scoped predecessor evidence.");
      const context = { owner: identity, root: library.root, overlay: require_document_overlay(library.documentOverlay), issued: mapIdentityEpoch.issued() };
      return capture_document_scoped_library({ ...context,
        scopes: library.documentScopes ?? make_document_scoped_quads(context,
          [...(library.documentQuads?.byName ?? [])].map(([name, quid]) => ({ name, quid, kind: "element" })), []),
        stylesheet: stylesheet(identity), effects: undefined, identityEffects: [], initialStyles: [], steps: [], changed: false, assertCurrent });
    },
    preparedSystemRoot: (transition) => {
      if (!preparedSystemRoots.has(transition)) throw new Error("Unknown prepared authority transition.");
      return preparedSystemRoots.get(transition);
    },
    accept: transitionController.acceptAuthority,
    reserve: transitionController.reserveAuthority,
    assertPrepared: transitionController.assertPreparedAuthority,
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
        root: clone_live_root(validated_library_root(library)),
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
  const replacesRoot = writeOps.some((op) => op.kind === "root-assignment"
    || (op.kind === "replace" && op.path.length === 0));
  if (currentRoot.$_tag === ROOT_TAG || replacesRoot) return root;
  const candidate = root.$_content[0];
  if (is_Node(candidate)) return candidate;
  throw new Error("LiveMap data constructor did not produce a value node.");
}

/**
 * Normalize public `set` into internal write intents.
 *
 * Plain object values at an existing object endpoint become constructive child
 * writes, including at the root. Other values stay as direct endpoint writes:
 * root assignments use a same-epoch intent, while child assignments use `set`.
 */
function write_ops_from_set(path: LivePath, value: unknown, currentValue: OrderedProjectedValue | undefined): readonly LiveMapCoreWriteOp[] {
  const projectedValue = must_ordered_projected_value(value, path);

  must_resolved_path("set", path, currentValue);

  if (!is_ordered_projected_object(projectedValue) || !is_ordered_projected_object(currentValue)) {
    // Equal assignments preserve identity; explicit replacement can retire it.
    if (optional_ordered_projected_value_equal(currentValue, projectedValue)) return [];
    if (path.length === 0) return [{ kind: "root-assignment", path: [], value: projectedValue }];
    return [{ kind: "set", path, value: projectedValue }];
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

    if (op.kind === "root-assignment") {
      const prev = must_resolved_projected_value("set", op.path, ordered_projected_value_at(candidate, op.path));
      candidate = ordered_projected_value_replace(candidate, op.path, op.value);
      if (ordered_projected_value_equal(prev, op.value)) continue;
      transportOps.push(Object.freeze({
        kind: "set",
        path: clone_live_path(op.path),
        prev,
        next: op.value,
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
  if (op.kind === "set" && op.path.length === 0) {
    const assignment: LiveMapRootAssignmentWriteOp = {
      kind: "root-assignment", path: [], value: op.next,
    };
    return Object.freeze(assignment);
  }
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
