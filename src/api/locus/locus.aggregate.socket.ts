import type { HsonNode, JsonValue } from "../../core/types.js";
import { ExactDataCarrier, admit_hson_data_input, hson_data_text, encode_hson_data_internal } from "../data/hson-data.js";
import type {
  LiveMapDocumentCommitTarget,
  LiveMapDocumentRequestTarget,
  LiveMapGraphCommit,
  LiveMap,
  LiveMapDefinitions,
} from "../../types/livemap.types.js";
import type {
  LocusActionAuthorizer,
  LocusActionOrigin,
  LocusActionPayloads,
  LocusActionTerminalOutcome,
  LocusClientActionMessage,
  LocusClientActionResult,
  LocusConnectionContext,
  LocusDisposer,
  LocusSessionId,
  LocusSessionOptions,
  LocusActionDedupeOptions,
  LocusSchema,
  LocusExposureEntry,
  LocusLibraryExposure,
  LocusProjectionAuthorizer,
  LocusRequestedProjection,
  LocusSocketLike,
} from "../../types/locus.types.js";
import { decode_locus_message } from "./locus.protocol.js";
import { is_locus_json_value } from "./locus.protocol.js";
import { internal_livemap_aggregate_authority } from "../livemap/livemap.internal.js";
import { make_livemap_hosted_mirror_from_snapshot_internal } from "../livemap/livemap.libraries.js";
import { decode_hosted_root, encode_hosted_root, make_portable_aggregate_commit } from "../livemap/livemap.hosted.js";
import { locus_client_error_message } from "./locus.client-error.js";
import { LocusPersistenceError } from "./locus.persistence.error.js";
import { validate_document_path } from "../livemap/livemap.document.path.js";
import { make_locus_action_dedupe_store } from "./locus.actions.js";
import { make_locus_session_manager } from "./locus.session.js";
import { LocusProjectionUnavailableError, make_locus_hosted_projection_policy, normalize_locus_effective_projection, runtime_locus_exposure_entries, type LocusEffectiveProjection } from "./locus.projection.js";
import { LOCUS_LIVE_PROJECTED_WIRE_FORMAT, project_locus_live_transition_internal, projected_registry_digest, type LocusLiveProjectedEvent } from "./locus.live-projection.js";
import { capture_locus_session_authority_projection_snapshot, capture_selected_authority_projection_snapshot, authority_projection_as_client_composition_internal } from "./locus.authority-projection-snapshot.js";
import type { AuthorityProjectionSnapshot } from "../../types/locus.projection.types.js";
import { INTERACTION_RESERVED_LIBRARY_KEY } from "../../internal/interaction-storage.js";
import { decode_locus_action_payload, locus_schema_error_message } from "./locus.action-validation.js";
import {
  resolve_locus_document_action,
  type LocusDocumentActionTarget,
} from "./locus.document-actions.js";
import {
  HOSTED_MAX_SNAPSHOT_BYTES,
} from "../livemap/livemap.hosted.js";
import {
  DEFAULT_LOCUS_HOSTED_AGGREGATE_MAX_WIRE_BYTES,
  create_locus_hosted_aggregate_internal,
  type LocusHostedAggregate,
  type LocusHostedAggregateAction,
  type LocusHostedAggregateDocumentDraft,
  type LocusHostedAggregateDraft,
  type LocusHostedAggregateGateInput,
  type LocusHostedAggregateAuthorityEnvelope,
} from "./locus.aggregate.js";
import { LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT } from "./locus.aggregate.protocol.js";
import {
  admit_locus_aggregate_external_action,
  type LocusAggregateExternalActionAttempt,
  type LocusAggregateActionAuthorityInternals,
} from "./locus.aggregate.action-admission.js";
import {
  register_locus_remote_action_admission_internal,
  type LocusRemoteActionIngress,
} from "./locus.remote-action.internal.js";
import {
  read_locus_retained_action_status_internal,
  register_locus_retained_action_status_internal,
} from "./locus.action-status.internal.js";
import type {
  LocusHostedAggregateDownstreamSink,
  LocusHostedAggregateProgress,
  LocusHostedProjectionChange,
  LocusHostedAggregateSemanticAttachment,
} from "./locus.aggregate.transport.internal.js";
import type { LocusFiniteOperationRequest } from "./locus.transport.internal.js";

/** The established Locus retained live-history budget. */
export const DEFAULT_LOCUS_HOSTED_AGGREGATE_HISTORY_BYTES = 4 * 1_024 * 1_024;
/** Recovery IDs are admitted by UTF-8 bytes; preaccept uses their maximum JSON expansion. */
const MAX_RECOVERY_REQUEST_ID_BYTES = 1_024;
const WORST_CASE_RECOVERY_ID = "\u0000".repeat(MAX_RECOVERY_REQUEST_ID_BYTES);

type HostedCursor = Readonly<{
  incarnationId: string;
  registryDigest: string;
  projectionDigest: string;
  lastAppliedRev: number;
}>;

type HostedRequest =
  | Readonly<{ type: "recover"; id: string; logicalMapId: string; cursor?: HostedCursor }>
  | Readonly<{ type: "session-create"; id: string; projection?: LocusRequestedProjection }>
  | Readonly<{ type: "session-attach"; id: string; credential?: unknown }>
  | Readonly<{ type: "session-goodbye"; id: string }>
  | Readonly<{ type: "action-status"; id: string; clientId: string; requestId: string }>
  | Readonly<{
    type: "action";
    id: string;
    name: string;
    payload?: ExactDataCarrier | JsonValue;
    requestId?: string;
    attemptId?: string;
    clientId?: string;
    retry?: true;
  }>;

type HostedPlanOutcome = "current" | "replay" | "snapshot" | "reject";
type HostedSnapshotReason = "no_usable_revision" | "incarnation_mismatch" | "registry_mismatch" | "history_unavailable";

type HostedHistoryEntry = Readonly<{
  envelope: LocusHostedAggregateAuthorityEnvelope;
  beforeSystem?: HsonNode;
  afterSystem?: HsonNode;
  bytes: number;
}>;

type HostedRecoveryAttachment = Readonly<{
  id: string;
  sessionId: string;
  epoch: number;
}>;

type HostedConnection = {
  readonly downstream: LocusHostedAggregateDownstreamSink;
  readonly onClose?: LocusDisposer;
  recoveryId: string | undefined;
  recovering: boolean;
  live: boolean;
  readonly pendingLive: LocusHostedAggregateAuthorityEnvelope[];
  closed: boolean;
  releaseActivity?: LocusDisposer;
  releaseRecoveryActivity?: LocusDisposer;
  readonly context?: LocusConnectionContext;
  sessionId: string | undefined;
  sessionEpoch: number | undefined;
  sessionResumable: boolean;
  establishing: boolean;
  effectiveProjection?: LocusEffectiveProjection;
  fenced: boolean;
};

/** @internal Typed aggregate output before adapter framing. */
function is_hosted_aggregate_downstream_output(value: unknown): value is Readonly<{ type: string; readonly [field: string]: unknown }> {
  return typeof value === "object"
    && value !== null
    && "type" in value
    && typeof value.type === "string";
}

export type LocusHostedAggregateSocketOptions<
  TActions extends LocusActionPayloads = LocusActionPayloads,
> = Readonly<{
  map: LiveMap;
  exposure: readonly LocusExposureEntry[];
  defaultProjection?: LocusRequestedProjection;
  authorizeProjection?: LocusProjectionAuthorizer;
  actions?: Readonly<Record<string, LocusHostedAggregateAction>>;
  gate?: (input: LocusHostedAggregateGateInput) => void | Promise<void>;
  prepareGate?: (input: LocusHostedAggregateGateInput) => void;
  maxWireBytes?: number;
  maxHistoryBytes?: number;
  authorizeAction?: LocusActionAuthorizer<TActions>;
  sessionId?: LocusSessionId | (() => LocusSessionId);
  sessions?: LocusSessionOptions;
  actionDedupe?: LocusActionDedupeOptions;
  schema?: Pick<LocusSchema<JsonValue | undefined, TActions>, "actions">;
  /** Internal deterministic interleave seam for pending-live proof coverage. */
  internal?: Readonly<{
    /** A restored runtime cannot accept an old client's equal-revision identity as current. */
    recoveryFloorRevision?: number;
    afterRecoveryCut?: () => void | Promise<void>;
    beforeRecoveryCaughtUp?: () => void | Promise<void>;
    afterRecoveryCaughtUp?: () => void | Promise<void>;
    acquireActionActivity?: () => LocusDisposer;
    acquireSessionActivity?: () => LocusDisposer;
    acquireConnectionActivity?: () => LocusDisposer;
    acquireRecoveryActivity?: () => LocusDisposer;
  }>;
}>;

export type LocusHostedAggregateSocketServer<
  TActions extends LocusActionPayloads = LocusActionPayloads,
> = Readonly<{
  map: LiveMap;
  readonly logicalMapId: string;
  readonly incarnationId: string;
  readonly registryDigest: string;
  readonly rev: number;
  connect: (socket: LocusSocketLike, context?: LocusConnectionContext) => LocusDisposer;
  /** @internal Typed operation/synchronization attachment below the socket adapter. */
  attach: (
    downstream: LocusHostedAggregateDownstreamSink,
    context?: LocusConnectionContext,
    onClose?: LocusDisposer,
  ) => LocusHostedAggregateSemanticAttachment<TActions>;
  mutate: LocusHostedAggregate["mutate"];
  add_libraries: (definitions: LiveMapDefinitions, exposure?: Readonly<Record<string, LocusLibraryExposure>>) => Promise<void>;
  dispatch_action: LocusHostedAggregate["dispatch_action"];
  dispatch_message: (message: import("../../types/locus.types.js").LocusClientActionMessage) => Promise<LocusClientActionResult>;
  sessions: Readonly<{ debug: ReturnType<typeof make_locus_session_manager>["debug"]; onChange: ReturnType<typeof make_locus_session_manager>["onChange"]; revoke: ReturnType<typeof make_locus_session_manager>["revoke"]; projection: ReturnType<typeof make_locus_session_manager>["projection"]; updateProjection: (sessionId: LocusSessionId, request: LocusRequestedProjection) => Promise<Readonly<{ changed: boolean; sequence: number; digest: string; authorityRev: number }>>; dispose: () => void }>;
  actionRequests: Readonly<{ debug: ReturnType<typeof make_locus_action_dedupe_store>["debug"]; dispose: () => void }>;
  /** Ordered internal barrier used by persistence checkpointing. */
  run_exclusive: LocusHostedAggregate["run_exclusive"];
  debug: () => Readonly<{
    historyBaseRevision: number;
    retainedHistoryBytes: number;
    retainedCommits: number;
    connections: number;
    effectiveLiveWireBytes: number;
    effectiveSnapshotWireBytes: number;
  }>;
  dispose: () => void;
}>;

/**
 * Aggregate transport authority. It deliberately owns one aggregate
 * Locus, one global retained history and one map-wide recovery cut.
 */
export function create_locus_hosted_aggregate_socket_internal<
  TActions extends LocusActionPayloads = LocusActionPayloads,
>(
  options: LocusHostedAggregateSocketOptions<TActions>,
): LocusHostedAggregateSocketServer<TActions> {
  const maxWireBytes = bounded(
    options.maxWireBytes,
    DEFAULT_LOCUS_HOSTED_AGGREGATE_MAX_WIRE_BYTES,
    "live wire",
    DEFAULT_LOCUS_HOSTED_AGGREGATE_MAX_WIRE_BYTES,
  );
  const maxHistoryBytes = bounded(options.maxHistoryBytes, DEFAULT_LOCUS_HOSTED_AGGREGATE_HISTORY_BYTES, "history", HOSTED_MAX_SNAPSHOT_BYTES);
  const aggregate = internal_livemap_aggregate_authority(options.map);
  const initial = aggregate.hostedPosition();
  const registry = aggregate.hostedRegistry();
  const projectionPolicy = make_locus_hosted_projection_policy(registry, initial.authority, options.exposure,
    options.defaultProjection, options.authorizeProjection);
  const bindings = aggregate.libraries();
  const identitiesByName = new Map<string, object>();
  let applicationIndex = 0;
  for (let index = 0; index < registry.libraries.length; index += 1) {
    const entry = registry.libraries[index];
    if (entry === undefined) throw new Error("Hosted aggregate registry identity binding is unavailable.");
    if (entry.scope === "hson-internal") continue;
    const identity = bindings[applicationIndex];
    applicationIndex += 1;
    if (identity === undefined) throw new Error("Hosted aggregate application identity binding is unavailable.");
    identitiesByName.set(entry.name, identity);
  }

  let disposed = false;
  let historyBaseRevision = initial.revision;
  let retainedBytes = 0;
  const history: HostedHistoryEntry[] = [];
  const connections = new Set<HostedConnection>();
  const preparedLiveEvents = new WeakMap<object, ReadonlyMap<string, LocusLiveProjectedEvent>>();
  const preparedSystemRoots = new WeakMap<object, Readonly<{ before?: HsonNode; after?: HsonNode }>>();
  let admissionBarrier: Promise<void> | undefined;
  let releaseAdmissionBarrier: (() => void) | undefined;
  const locus = create_locus_hosted_aggregate_internal({
    map: options.map,
    ...(options.actions === undefined ? {} : { actions: options.actions }),
    ...(options.gate === undefined ? {} : { gate: options.gate }),
    ...(options.prepareGate === undefined ? {} : { prepareGate: options.prepareGate }),
    beforeAccept({ transition, commit }) {
      const system = aggregate.systemState(INTERACTION_RESERVED_LIBRARY_KEY);
      const beforeSystem = system === undefined ? undefined : aggregate.systemRoot(system);
      const afterSystem = commit.topology === undefined ? aggregate.preparedSystemRoot(transition) : beforeSystem;
      const roots = Object.freeze({
        ...(beforeSystem === undefined ? {} : { before: decode_hosted_root(encode_hosted_root(beforeSystem)) }),
        ...(afterSystem === undefined ? {} : { after: decode_hosted_root(encode_hosted_root(afterSystem)) }),
      });
      const envelope: LocusHostedAggregateAuthorityEnvelope = Object.freeze({
        logicalMapId: initial.authority.logicalMapId,
        incarnationId: initial.authority.incarnationId,
        registryDigest: initial.registryDigest,
        commit,
      });
      const historyDecision = prepare_history(envelope, roots);
      const events = new Map<string, LocusLiveProjectedEvent>();
      const roster = [...sessions.resumable_projections()];
      for (const connection of connections) {
        if (connection.closed || connection.sessionResumable || (!connection.live && !connection.recovering)
          || connection.sessionId === undefined || connection.effectiveProjection === undefined) continue;
        roster.push(Object.freeze({ sessionId: connection.sessionId, projection: connection.effectiveProjection }));
      }
      for (const { sessionId, projection: effective } of roster) {
        const event = project_locus_live_transition_internal(commit, effective, beforeSystem, afterSystem);
        const live = projected_output(WORST_CASE_RECOVERY_ID, event, effective);
        encode_downstream_message(live, maxWireBytes);
        encode_downstream_message(live.type === "progress"
          ? Object.freeze({ type: "recovery-progress", id: WORST_CASE_RECOVERY_ID, phase: "tail", progress: live.progress })
          : Object.freeze({ type: "recovery-commit", id: WORST_CASE_RECOVERY_ID, phase: "tail", commit: live.commit }), maxWireBytes);
        events.set(sessionId, event);
      }
      preparedSystemRoots.set(commit, roots);
      preparedLiveEvents.set(commit, events);
      admissionBarrier = new Promise<void>((resolve) => { releaseAdmissionBarrier = resolve; });
      return Object.freeze({
        install: () => install_history(historyDecision),
        release: () => {
          releaseAdmissionBarrier?.();
          releaseAdmissionBarrier = undefined;
          admissionBarrier = undefined;
        },
      });
    },
    onFault: () => fault_authority(),
    uncertainGateFailure: (cause) => cause instanceof LocusPersistenceError && cause.code === "LOCUS_PERSISTENCE_APPEND_UNCERTAIN",
  });
  let seq = 0;
  let generatedSessionId = 0;
  const sessions = make_locus_session_manager(options.sessions);
  const actionRequests = make_locus_action_dedupe_store(
    () => locus.rev,
    () => seq,
    options.actionDedupe,
  );
  const acquireActionActivity = options.internal?.acquireActionActivity ?? (() => () => {});
  const acquireEphemeralSessionActivity = options.internal?.acquireSessionActivity ?? (() => () => {});

  function next_session_id(): string {
    const configured = options.sessionId;
    if (typeof configured === "function") return configured();
    if (configured !== undefined) return configured;
    generatedSessionId += 1;
    return `locus-session-${Date.now().toString(36)}-${generatedSessionId.toString(36)}`;
  }

  function next_ephemeral_session_id(): string {
    generatedSessionId += 1;
    return `locus-ephemeral-session-${Date.now().toString(36)}-${generatedSessionId.toString(36)}`;
  }

  const stopWire = locus.on_commit((commit) => {
    if (disposed) return;
    const envelope: LocusHostedAggregateAuthorityEnvelope = Object.freeze({
      logicalMapId: locus.logicalMapId,
      incarnationId: locus.incarnationId,
      registryDigest: locus.registryDigest,
      commit,
    });
    const events = preparedLiveEvents.get(commit);
    for (const connection of [...connections]) {
      if (connection.closed || connection.sessionId === undefined || connection.sessionEpoch === undefined
        || !sessions.is_active(connection.sessionId, connection.sessionEpoch)) continue;
      if (connection.recovering) connection.pendingLive.push(envelope);
      else if (connection.live && connection.recoveryId !== undefined) {
        const effective = connection.effectiveProjection;
        const event = events?.get(connection.sessionId);
        if (effective === undefined || event === undefined) {
          close_failed_publication(connection);
          continue;
        }
        try { send(connection, projected_live_output(connection, event, effective)); }
        catch { close_failed_publication(connection); }
      }
    }
  });

  async function add_libraries(
    definitions: LiveMapDefinitions,
    exposure?: Readonly<Record<string, LocusLibraryExposure>>,
  ): Promise<void> {
    if (disposed) throw new Error("Hosted Locus authority is disposed.");
    if (typeof definitions !== "object" || definitions === null || Array.isArray(definitions)) {
      throw new Error("Hosted Library definitions are malformed.");
    }
    const entries = runtime_locus_exposure_entries(Object.keys(definitions), exposure);
    await locus.add_libraries_internal(definitions, () => {
      const nextRegistry = aggregate.hostedRegistry();
      projectionPolicy.installRuntimeExposure(entries, nextRegistry);
      const bindings = aggregate.libraries();
      for (const entry of entries) {
        const index = nextRegistry.libraries.findIndex((candidate) => candidate.name === entry.library);
        const identity = bindings[index];
        if (identity !== undefined) identitiesByName.set(entry.library, identity);
      }
    });
  }

  function update_projection(sessionId: LocusSessionId, request: LocusRequestedProjection): Promise<Readonly<{
    changed: boolean; sequence: number; digest: string; authorityRev: number;
  }>> {
    return locus.run_exclusive(async () => {
      if (disposed) throw new LocusProjectionUnavailableError();
      const connection = [...connections].find((candidate) => candidate.sessionId === sessionId
        && candidate.sessionEpoch !== undefined && candidate.live && !candidate.closed
        && !candidate.fenced && sessions.is_active(sessionId, candidate.sessionEpoch));
      const previous = sessions.projection(sessionId);
      if (connection === undefined || previous === undefined || connection.effectiveProjection !== previous
        || connection.recoveryId === undefined || connection.sessionEpoch === undefined) {
        throw new LocusProjectionUnavailableError();
      }
      const epoch = connection.sessionEpoch;
      const next = await normalize_locus_effective_projection(projectionPolicy, request, connection.context);
      if (!attachment_current(connection, sessionId, epoch) || !connection.live
        || sessions.projection(sessionId) !== previous || connection.effectiveProjection !== previous) {
        throw new LocusProjectionUnavailableError();
      }
      if (previous.libraries.some((entry) => !next.includesLibrary(entry.name))
        || JSON.stringify(previous.systemFeatures) !== JSON.stringify(next.systemFeatures)) {
        throw new LocusProjectionUnavailableError();
      }
      const currentSequence = sessions.projection_sequence(sessionId);
      if (currentSequence === undefined) throw new LocusProjectionUnavailableError();
      if (next.digest === previous.digest) return Object.freeze({ changed: false, sequence: currentSequence,
        digest: previous.digest, authorityRev: locus.rev });
      const added = next.libraries.filter((entry) => !previous.includesLibrary(entry.name));
      const snapshot = capture_selected_authority_projection_snapshot(options.map, next);
      const additions = added.map((entry) => {
        const captured = snapshot.libraries.find((candidate) => candidate.name === entry.name);
        if (captured === undefined) throw new LocusProjectionUnavailableError();
        return Object.freeze({ name: entry.name, mode: entry.mode, schema: entry.schema, root: captured.root });
      });
      const first = additions[0];
      const topology = first === undefined ? undefined : Object.freeze({ library: first.name,
        operation: Object.freeze({ kind: "library-add" as const, libraries: Object.freeze(additions) }) });
      const event: LocusHostedProjectionChange = Object.freeze({
        type: "projection-change", id: connection.recoveryId,
        logicalMapId: locus.logicalMapId, incarnationId: locus.incarnationId,
        authorityRev: locus.rev, sequence: currentSequence + 1,
        previousDigest: previous.digest, projectionDigest: next.digest,
        registryDigest: projected_registry_digest(next),
        libraries: next.libraries, htmlDocument: next.htmlDocument ?? null,
        systemFeatures: next.systemFeatures, writableDocuments: next.writableDocuments,
        ...(topology === undefined ? {} : { topology }),
        ...(added.some((entry) => entry.mode === "document") && snapshot.system !== null
          ? { system: snapshot.system.interactions } : {}),
      });
      encode_downstream_message(event, maxWireBytes);
      const sequence = sessions.update_projection(sessionId, previous, next);
      connection.effectiveProjection = next;
      try { send(connection, event); }
      catch (cause) {
        sessions.revoke(sessionId);
        close_failed_publication(connection);
        throw cause;
      }
      return Object.freeze({ changed: true, sequence, digest: next.digest, authorityRev: locus.rev });
    });
  }

  function projected_live_output(connection: HostedConnection, event: LocusLiveProjectedEvent, effective: LocusEffectiveProjection) {
    const id = connection.recoveryId;
    if (id === undefined) throw new Error("Live publication has no recovery identity.");
    return projected_output(id, event, effective);
  }

  function projected_output(id: string, event: LocusLiveProjectedEvent, effective: LocusEffectiveProjection) {
    return event.kind === "progress"
      ? Object.freeze({ type: "progress" as const, id, progress: event.progress })
      : Object.freeze({ type: "commit" as const, id, commit: Object.freeze({
        format: LOCUS_LIVE_PROJECTED_WIRE_FORMAT,
        logicalMapId: effective.authority.logicalMapId,
        incarnationId: effective.authority.incarnationId,
        registryDigest: event.commit.registryDigest,
        commit: event.commit,
      }) });
  }

  function close_failed_publication(connection: HostedConnection): void {
    if (connection.closed) return;
    connection.closed = true;
    stop_recovery(connection);
    connections.delete(connection);
    if (connection.sessionId !== undefined && connection.sessionEpoch !== undefined) {
      sessions.detach(connection.sessionId, connection.sessionEpoch);
    }
    connection.releaseActivity?.();
    connection.releaseActivity = undefined;
    try { connection.onClose?.(); } catch { /* Transport cleanup is isolated. */ }
  }

  function fault_authority(): void {
    if (disposed) return;
    disposed = true;
    stopWire();
    for (const connection of [...connections]) close_failed_publication(connection);
    actionRequests.dispose();
    sessions.dispose();
    // Keep LiveMap's management claim. A durable decision may exist beyond
    // this runtime revision, so the old map must not serve new mutations.
  }

  function prepare_history(envelope: LocusHostedAggregateAuthorityEnvelope, roots: Readonly<{ before?: HsonNode; after?: HsonNode }>) {
    const commit = envelope.commit;
    const previous = history.length === 0 ? historyBaseRevision : history[history.length - 1]?.envelope.commit.rev;
    if (previous !== commit.prevRev) {
      throw new Error("Hosted aggregate history lost global revision continuity.");
    }
    const bytes = encoded_bytes(envelope) + encoded_bytes(roots ?? {});
    const entry: HostedHistoryEntry = Object.freeze({ envelope,
      ...(roots?.before === undefined ? {} : { beforeSystem: roots.before }),
      ...(roots?.after === undefined ? {} : { afterSystem: roots.after }), bytes });
    let evict = 0;
    let remaining = retainedBytes + bytes;
    if (bytes <= maxHistoryBytes) {
      while (remaining > maxHistoryBytes && evict < history.length) {
        remaining -= history[evict]!.bytes;
        evict += 1;
      }
    }
    return Object.freeze({ entry, oversized: bytes > maxHistoryBytes, evict });
  }

  function install_history(decision: ReturnType<typeof prepare_history>): void {
    if (decision.oversized) {
      history.length = 0;
      retainedBytes = 0;
      historyBaseRevision = decision.entry.envelope.commit.rev;
      return;
    }
    for (let index = 0; index < decision.evict; index += 1) {
      const removed = history.shift();
      if (removed === undefined) throw new Error("Prepared history eviction lost its entry.");
      retainedBytes -= removed.bytes;
      historyBaseRevision = removed.envelope.commit.rev;
    }
    history.push(decision.entry);
    retainedBytes += decision.entry.bytes;
  }

  function send(connection: HostedConnection, message: unknown, _limit = maxWireBytes): void {
    if (connection.closed) return;
    if (!is_hosted_aggregate_downstream_output(message)) {
      throw new Error("Hosted aggregate semantic output is malformed.");
    }
    const semantic: Record<string, unknown> = { ...message };
    if (semantic.type === "commit" || semantic.type === "progress" || semantic.type === "projection-change") {
      connection.downstream.publication(semantic as Parameters<LocusHostedAggregateDownstreamSink["publication"]>[0]);
      return;
    }
    if (semantic.type === "recovery-plan"
      || semantic.type === "recovery-snapshot"
      || semantic.type === "recovery-commit"
      || semantic.type === "recovery-progress"
      || semantic.type === "recovery-caught-up") {
      connection.downstream.synchronization(semantic as Parameters<LocusHostedAggregateDownstreamSink["synchronization"]>[0]);
      return;
    }
    if (semantic.type === "synchronization-failure") {
      connection.downstream.synchronization(semantic as Parameters<LocusHostedAggregateDownstreamSink["synchronization"]>[0]);
      return;
    }
    connection.downstream.finite(semantic as Parameters<LocusHostedAggregateDownstreamSink["finite"]>[0]);
  }

  function attachment_current(connection: HostedConnection, sessionId: string, epoch: number): boolean {
    return !connection.closed
      && !connection.fenced
      && connection.sessionId === sessionId
      && connection.sessionEpoch === epoch
      && sessions.is_active(sessionId, epoch);
  }

  function recovery_attachment_current(connection: HostedConnection, recovery: HostedRecoveryAttachment): boolean {
    return connection.recoveryId === recovery.id
      && attachment_current(connection, recovery.sessionId, recovery.epoch);
  }

  function recovery_delivery_current(connection: HostedConnection, recovery: HostedRecoveryAttachment): boolean {
    return connection.recovering && recovery_attachment_current(connection, recovery);
  }

  function stop_recovery(connection: HostedConnection): void {
    connection.recovering = false;
    connection.live = false;
    connection.recoveryId = undefined;
    connection.pendingLive.length = 0;
    connection.releaseRecoveryActivity?.();
    connection.releaseRecoveryActivity = undefined;
  }

  function reject(connection: HostedConnection, code: string, message: string, id?: string): void {
    send(connection, Object.freeze({
      type: "synchronization-failure",
      error: Object.freeze({ code, message, ...(id === undefined ? {} : { cause: Object.freeze({ id }) }) }),
    }));
  }

  function projected_history_event(entry: HostedHistoryEntry, effective: LocusEffectiveProjection): LocusLiveProjectedEvent {
    return project_locus_live_transition_internal(entry.envelope.commit, effective, entry.beforeSystem, entry.afterSystem);
  }

  function send_projected_recovery_event(connection: HostedConnection, id: string, phase: "body" | "tail", event: LocusLiveProjectedEvent, effective: LocusEffectiveProjection): void {
    const live = projected_live_output(connection, event, effective);
    send(connection, live.type === "progress"
      ? Object.freeze({ type: "recovery-progress", id, phase, progress: live.progress })
      : Object.freeze({ type: "recovery-commit", id, phase, commit: live.commit }));
  }

  async function recover(connection: HostedConnection, request: Extract<HostedRequest, { type: "recover" }>): Promise<void> {
    if (utf8_bytes(request.id) > MAX_RECOVERY_REQUEST_ID_BYTES || request.id.length === 0) {
      reject(connection, "LOCUS_PROTOCOL_INVALID", "Hosted recovery request ID exceeds its byte limit.");
      return;
    }
    const binding = bind_session(connection, false);
    if (!(binding instanceof Promise ? await binding : binding)) {
      reject(connection, "LOCUS_SESSION_NOT_ATTACHED", "Hosted aggregate recovery requires an active Locus session.", request.id);
      return;
    }
    if (request.logicalMapId !== locus.logicalMapId) {
      reject(connection, "LOCUS_RECOVERY_INVALID_TARGET", "Hosted recovery target is incompatible.", request.id);
      return;
    }
    const cursor = request.cursor;
    const sameIncarnation = cursor?.incarnationId === locus.incarnationId;
    if (connection.recovering) {
      reject(connection, "LOCUS_RECOVERY_IN_PROGRESS", "Hosted aggregate recovery is already in progress.", request.id);
      return;
    }

    if (connection.sessionId === undefined || connection.sessionEpoch === undefined) return;
    const effective = sessions.projection(connection.sessionId);
    if (effective === undefined || effective !== connection.effectiveProjection) {
      reject(connection, "LOCUS_PROJECTION_UNAVAILABLE", "Hosted recovery projection is unavailable.", request.id);
      return;
    }
    if (cursor !== undefined && sameIncarnation && cursor.projectionDigest !== effective.digest) {
      reject(connection, "LOCUS_PROJECTION_UNAVAILABLE", "Hosted recovery projection is incompatible.", request.id);
      return;
    }
    if (cursor !== undefined && cursor.lastAppliedRev > locus.rev && sameIncarnation) {
      reject(connection, "REVISION_AHEAD_OF_AUTHORITY", "Hosted recovery cursor is ahead of authority.", request.id);
      return;
    }
    const activeRecovery: HostedRecoveryAttachment = Object.freeze({
      id: request.id,
      sessionId: connection.sessionId,
      epoch: connection.sessionEpoch,
    });

    connection.recoveryId = request.id;
    connection.recovering = true;
    connection.live = false;
    connection.pendingLive.length = 0;
    connection.releaseRecoveryActivity = options.internal?.acquireRecoveryActivity?.();
    let outcome: Exclude<HostedPlanOutcome, "reject">;
    let reason: HostedSnapshotReason | undefined;
    let snapshot: AuthorityProjectionSnapshot | undefined;
    let replay: readonly HostedHistoryEntry[] = Object.freeze([]);
    const headSnapshot = capture_locus_session_authority_projection_snapshot(options.map, sessions, connection.sessionId);
    const head = headSnapshot.revision;
    const projectedRegistryDigest = authority_projection_as_client_composition_internal(headSnapshot).registryDigest;
    const sameProjectedRegistry = cursor?.registryDigest === projectedRegistryDigest;
    if (cursor === undefined) {
      outcome = "snapshot";
      reason = "no_usable_revision";
    } else if (options.internal?.recoveryFloorRevision !== undefined
      && cursor.lastAppliedRev <= options.internal.recoveryFloorRevision) {
      outcome = "snapshot";
      reason = "history_unavailable";
    } else if (!sameProjectedRegistry) {
      outcome = "snapshot";
      reason = "registry_mismatch";
    } else if (!sameIncarnation) {
      outcome = "snapshot";
      reason = "incarnation_mismatch";
    } else if (cursor.lastAppliedRev === head) {
      outcome = "current";
    } else {
      const retained = replay_after(cursor.lastAppliedRev, head);
      if (retained === undefined) {
        outcome = "snapshot";
        reason = "history_unavailable";
      } else {
        outcome = "replay";
        replay = retained;
      }
    }

    if (outcome === "snapshot") {
      snapshot = headSnapshot;
      if (snapshot.revision !== locus.rev) throw new Error("Hosted aggregate snapshot cut disagrees with its global revision.");
    }
    const cut = snapshot?.revision ?? head;
    await options.internal?.afterRecoveryCut?.();
    if (!recovery_delivery_current(connection, activeRecovery)) return;
    const projectionSequence = sessions.projection_sequence(connection.sessionId) ?? 0;
    send(connection, recovery_plan(request.id, outcome, cut, effective.digest, projectedRegistryDigest,
      reason === undefined ? undefined : { reason }, projectionSequence));
    if (!recovery_delivery_current(connection, activeRecovery)) return;
    if (snapshot !== undefined) {
      send(connection, Object.freeze({
        type: "recovery-snapshot",
        id: request.id,
        snapshot,
      }), HOSTED_MAX_SNAPSHOT_BYTES);
      if (!recovery_delivery_current(connection, activeRecovery)) return;
    } else {
      for (const entry of replay) {
        if (!recovery_delivery_current(connection, activeRecovery)) return;
        send_projected_recovery_event(connection, request.id, "body", projected_history_event(entry, effective), effective);
        if (!recovery_delivery_current(connection, activeRecovery)) return;
      }
    }
    await options.internal?.beforeRecoveryCaughtUp?.();
    if (!recovery_delivery_current(connection, activeRecovery)) return;
    send(connection, Object.freeze({
      type: "recovery-caught-up",
      id: request.id,
      logicalMapId: locus.logicalMapId,
      incarnationId: locus.incarnationId,
      registryDigest: projectedRegistryDigest,
      projectionDigest: effective.digest,
      ...(projectionSequence === 0 ? {} : { projectionSequence }),
      throughRev: cut,
    }));
    if (!recovery_delivery_current(connection, activeRecovery)) return;
    await options.internal?.afterRecoveryCaughtUp?.();
    if (!recovery_delivery_current(connection, activeRecovery)) return;
    while (connection.pendingLive.length > 0) {
      if (!recovery_delivery_current(connection, activeRecovery)) return;
      const pending = connection.pendingLive.shift();
      if (pending === undefined) continue;
      if (pending.commit.prevRev < cut) continue;
      const roots = preparedSystemRoots.get(pending.commit);
      const event = project_locus_live_transition_internal(pending.commit, effective, roots?.before, roots?.after);
      send(connection, projected_live_output(connection, event, effective));
      if (!recovery_delivery_current(connection, activeRecovery)) return;
    }
    connection.recovering = false;
    connection.live = true;
    connection.releaseRecoveryActivity?.();
    connection.releaseRecoveryActivity = undefined;
  }

  function replay_after(revision: number, head: number): readonly HostedHistoryEntry[] | undefined {
    if (revision < historyBaseRevision) return undefined;
    if (revision === head) return Object.freeze([]);
    const result = history.filter((entry) => entry.envelope.commit.rev > revision && entry.envelope.commit.rev <= head);
    if (result.length === 0 || result[0]?.envelope.commit.prevRev !== revision || result[result.length - 1]?.envelope.commit.rev !== head) {
      return undefined;
    }
    for (let index = 1; index < result.length; index += 1) {
      if (result[index]?.envelope.commit.prevRev !== result[index - 1]?.envelope.commit.rev) return undefined;
    }
    return Object.freeze([...result]);
  }

  function recovery_plan(
    id: string,
    outcome: HostedPlanOutcome,
    headRev: number,
    projectionDigest: string,
    registryDigest: string,
    detail?: Readonly<{ reason: HostedSnapshotReason }> | Readonly<{ code: string; message: string }>,
    projectionSequence = 0,
  ): object {
    const base = {
      type: "recovery-plan" as const,
      id,
      logicalMapId: locus.logicalMapId,
      incarnationId: locus.incarnationId,
      registryDigest,
      projectionDigest,
      ...(projectionSequence === 0 ? {} : { projectionSequence }),
      headRev,
      outcome,
    };
    if (outcome === "snapshot") return Object.freeze({ ...base, reason: (detail as { reason: HostedSnapshotReason }).reason });
    if (outcome === "reject") return Object.freeze({ ...base, error: detail });
    return Object.freeze(base);
  }

  function session_attachment(connection: HostedConnection): Readonly<{ fence: (sessionId: string, epoch: number) => void }> {
    return Object.freeze({
      fence(sessionId, epoch): void {
        if (connection.sessionId !== sessionId || connection.sessionEpoch !== epoch || connection.fenced) return;
        send(connection, Object.freeze({
          type: "session-fenced",
          sessionId,
          epoch,
          code: "LOCUS_SESSION_ATTACHMENT_FENCED",
        }));
        connection.fenced = true;
        stop_recovery(connection);
      },
    });
  }

  function bind_session(connection: HostedConnection, resumable: boolean): boolean | Promise<boolean> {
    if (connection.sessionId !== undefined) {
      return connection.sessionEpoch !== undefined
        && !connection.fenced
        && sessions.is_active(connection.sessionId, connection.sessionEpoch);
    }
    if (connection.establishing) return false;
    connection.establishing = true;
    const policyRegistry = projectionPolicy.registry;
    let projection: LocusEffectiveProjection | Promise<LocusEffectiveProjection>;
    try {
      projection = normalize_locus_effective_projection(projectionPolicy, undefined, connection.context);
    } catch {
      connection.establishing = false;
      return false;
    }
    const finish = (effectiveProjection: LocusEffectiveProjection): boolean | Promise<boolean> => {
      if (admissionBarrier !== undefined || projectionPolicy.registry !== policyRegistry) return (admissionBarrier ?? Promise.resolve()).then(() => {
        connection.establishing = false;
        return bind_session(connection, resumable);
      });
      if (connection.closed || connection.fenced || connection.sessionId !== undefined) {
        connection.establishing = false;
        return false;
      }
      const sessionId = next_session_id();
      const created = sessions.create(
        sessionId,
        resumable,
        session_attachment(connection),
        () => {},
        () => 0,
        connection.context,
        effectiveProjection,
      );
      if (!created.ok) {
        connection.establishing = false;
        return false;
      }
      connection.sessionId = created.value.sessionId;
      connection.sessionEpoch = created.value.epoch;
      connection.sessionResumable = created.value.resumable;
      connection.effectiveProjection = effectiveProjection;
      connection.establishing = false;
      return true;
    };
    if (projection instanceof Promise) return projection.then(finish, () => { connection.establishing = false; return false; });
    return finish(projection);
  }

  function session_create(connection: HostedConnection, request: Extract<HostedRequest, { type: "session-create" }>): void | Promise<void> {
    if (connection.sessionId !== undefined || connection.establishing) {
      send(connection, Object.freeze({ type: "session-rejected", id: request.id, code: "LOCUS_SESSION_NOT_ATTACHED", message: "This transport already owns a Locus session." }));
      return;
    }
    connection.establishing = true;
    const policyRegistry = projectionPolicy.registry;
    const failProjection = (): void => {
      connection.establishing = false;
      if (!connection.closed) send(connection, Object.freeze({ type: "session-rejected", id: request.id, code: "LOCUS_PROJECTION_UNAVAILABLE", message: "Requested client projection is unavailable." }));
    };
    let projection: LocusEffectiveProjection | Promise<LocusEffectiveProjection>;
    try {
      projection = normalize_locus_effective_projection(projectionPolicy, request.projection, connection.context);
    } catch {
      failProjection();
      return;
    }
    const finish = (effectiveProjection: LocusEffectiveProjection): void | Promise<void> => {
      if (admissionBarrier !== undefined || projectionPolicy.registry !== policyRegistry) return (admissionBarrier ?? Promise.resolve()).then(() => {
        connection.establishing = false;
        return session_create(connection, request);
      });
      if (connection.closed || connection.fenced || connection.sessionId !== undefined) {
        connection.establishing = false;
        return;
      }
      const sessionId = next_session_id();
      const created = sessions.create(sessionId, true, session_attachment(connection), () => {}, () => 0, connection.context, effectiveProjection);
      if (!created.ok || created.value.credential === undefined) {
        connection.establishing = false;
        send(connection, Object.freeze({ type: "session-rejected", id: request.id, code: "LOCUS_SESSION_NOT_ATTACHED", message: "Locus could not create a resumable session." }));
        return;
      }
      connection.sessionId = created.value.sessionId;
      connection.sessionEpoch = created.value.epoch;
      connection.sessionResumable = true;
      connection.effectiveProjection = effectiveProjection;
      connection.establishing = false;
      send(connection, Object.freeze({
        type: "session-created",
        id: request.id,
        sessionId: created.value.sessionId,
        credential: created.value.credential,
        epoch: created.value.epoch,
        logicalMapId: locus.logicalMapId,
        incarnationId: locus.incarnationId,
      }));
    };
    if (projection instanceof Promise) return projection.then(finish, failProjection);
    finish(projection);
  }

  function session_attach(connection: HostedConnection, request: Extract<HostedRequest, { type: "session-attach" }>): void {
    if (Object.prototype.hasOwnProperty.call(request, "projection")) {
      send(connection, Object.freeze({ type: "session-rejected", id: request.id, code: "LOCUS_SESSION_NOT_ATTACHED", message: "A different projection requires a new Locus session." }));
      return;
    }
    if (connection.sessionId !== undefined || connection.establishing) {
      send(connection, Object.freeze({ type: "session-rejected", id: request.id, code: "LOCUS_SESSION_NOT_ATTACHED", message: "This transport already owns a Locus session." }));
      return;
    }
    const attached = sessions.reattach(request.credential, session_attachment(connection), connection.context);
    if (!attached.ok) {
      send(connection, Object.freeze({ type: "session-rejected", id: request.id, code: attached.error.code ?? "LOCUS_SESSION_NOT_ATTACHED", message: attached.error.message }));
      return;
    }
    connection.sessionId = attached.value.sessionId;
    connection.sessionEpoch = attached.value.epoch;
    connection.sessionResumable = attached.value.resumable;
    connection.effectiveProjection = attached.value.effectiveProjection;
    send(connection, Object.freeze({
      type: "session-attached",
      id: request.id,
      sessionId: attached.value.sessionId,
      epoch: attached.value.epoch,
      logicalMapId: locus.logicalMapId,
      incarnationId: locus.incarnationId,
    }));
  }

  function session_goodbye(connection: HostedConnection, request: Extract<HostedRequest, { type: "session-goodbye" }>): void {
    if (connection.sessionId === undefined || connection.sessionEpoch === undefined) {
      send(connection, Object.freeze({ type: "session-rejected", id: request.id, code: "LOCUS_SESSION_NOT_ATTACHED", message: "This transport does not own a Locus session." }));
      return;
    }
    const sessionId = connection.sessionId;
    const epoch = connection.sessionEpoch;
    const ended = sessions.goodbye(sessionId, epoch);
    if (!ended.ok) {
      send(connection, Object.freeze({ type: "session-rejected", id: request.id, code: ended.error.code ?? "LOCUS_SESSION_ALREADY_GONE", message: ended.error.message }));
      return;
    }
    send(connection, Object.freeze({ type: "session-ended", id: request.id, sessionId, epoch }));
    connection.fenced = true;
    stop_recovery(connection);
  }

  function send_action_result(
    connection: HostedConnection,
    response: LocusClientActionResult,
  ): void {
    send(connection, response);
  }

  async function execute_action(
    request: Extract<HostedRequest, { type: "action" }>,
    payload: ExactDataCarrier | undefined,
    origin: LocusActionOrigin = Object.freeze({ kind: "direct" }),
  ): Promise<LocusActionTerminalOutcome> {
    try {
      let result: unknown | void;
      if (is_document_action(request.name)) {
        const { payload: _wirePayload, ...requestWithoutPayload } = request;
        const validated = validate_action_request(Object.freeze({ ...requestWithoutPayload, ...(payload === undefined ? {} : { payload: hson_data_text(payload) }) }));
        if (!validated.ok || validated.executeDocument === undefined) throw new Error(validated.ok ? "Hosted document action resolution was lost." : validated.message);
        await locus.mutate(validated.executeDocument);
        result = undefined;
      } else {
        const { payload: _wirePayload, ...requestWithoutPayload } = request;
        const publicRequest = Object.freeze({ ...requestWithoutPayload, ...(payload === undefined ? {} : { payload: hson_data_text(payload) }) });
        result = await locus.dispatch_action(request.name, payload, publicRequest, origin);
      }
      seq += 1;
      const admittedResult = result === undefined ? undefined : admit_hson_data_input(result);
      return Object.freeze({
        state: "succeeded",
        seq,
        completionRev: locus.rev,
        ...(admittedResult === undefined ? {} : { result: hson_data_text(admittedResult) }),
      });
    } catch (cause) {
      return Object.freeze({
        state: "failed",
        seq,
        completionRev: locus.rev,
        error: Object.freeze({
          code: "LOCUS_ACTION_FAILED",
          message: locus_client_error_message(cause, "Hosted aggregate action failed."),
        }),
      });
    }
  }

  const actionAuthority: LocusAggregateActionAuthorityInternals<TActions> = Object.freeze({
    get authorizer() { return options.authorizeAction; },
    actionRequests,
    logicalMapId: locus.logicalMapId,
    incarnationId: locus.incarnationId,
    currentSeq: () => seq,
    headRev: () => locus.rev,
    validateAction: validate_action_request,
    executeAction: execute_action,
    acquireActionActivity,
  });

  function admit_external_action(
    attempt: LocusAggregateExternalActionAttempt<TActions>,
  ) {
    return admit_locus_aggregate_external_action(actionAuthority, attempt);
  }

  async function admit_ephemeral_remote_action(
    ingress: LocusRemoteActionIngress<TActions>,
  ): Promise<LocusClientActionResult> {
    const message = ingress.message;
    const connection = ingress.connection === undefined
      ? undefined
      : Object.freeze({
          ...(ingress.connection.principalId === undefined ? {} : { principalId: ingress.connection.principalId }),
          ...(Object.prototype.hasOwnProperty.call(ingress.connection, "attachment")
            ? { attachment: ingress.connection.attachment }
            : {}),
        });
    let live = true;
    const attachment = Object.freeze({ fence: () => { live = false; } });
    const effectiveProjection = await normalize_locus_effective_projection(projectionPolicy, { libraries: [] }, connection);
    if (admissionBarrier !== undefined) await admissionBarrier;
    const created = sessions.create(next_ephemeral_session_id(), false, attachment, () => {}, () => 0, connection, effectiveProjection);
    if (!created.ok) {
      return Object.freeze({
        type: "error",
        id: message.id,
        ...(message.requestId === undefined ? {} : { requestId: message.requestId }),
        ...(message.attemptId === undefined ? {} : { attemptId: message.attemptId }),
        ok: false,
        seq,
        completionRev: locus.rev,
        ...(message.requestId !== undefined && message.clientId !== undefined
          ? { delivery: "rejected" as const }
          : {}),
        error: Object.freeze({ code: "LOCUS_DISPOSED", message: "Locus is disposed." }),
      });
    }
    const origin = Object.freeze({
      kind: "session" as const,
      sessionId: created.value.sessionId,
      epoch: created.value.epoch,
      resumable: false,
    });
    const releaseSessionActivity = acquireEphemeralSessionActivity();
    try {
      const admitted = await admit_external_action({
        message,
        origin,
        ...(connection === undefined ? {} : { connection }),
        attachmentCurrent: () => live && sessions.is_active(origin.sessionId, origin.epoch),
      });
      return admitted.response;
    } finally {
      live = false;
      sessions.release_ephemeral(origin.sessionId, origin.epoch);
      releaseSessionActivity();
    }
  }

  async function action(connection: HostedConnection, request: Extract<HostedRequest, { type: "action" }>): Promise<void> {
    const binding = bind_session(connection, false);
    if (!(binding instanceof Promise ? await binding : binding) || connection.sessionId === undefined || connection.sessionEpoch === undefined) return;
    const capturedSessionId = connection.sessionId;
    const capturedEpoch = connection.sessionEpoch;
    const origin = Object.freeze({
      kind: "session" as const,
      sessionId: capturedSessionId,
      epoch: capturedEpoch,
      resumable: connection.sessionResumable,
    });
    const admitted = await admit_external_action({
      message: request as LocusClientActionMessage<TActions>,
      origin,
      ...(connection.context === undefined ? {} : { connection: connection.context }),
      attachmentCurrent: () => attachment_current(connection, capturedSessionId, capturedEpoch),
    });
    if (!attachment_current(connection, capturedSessionId, capturedEpoch)) return;
    send_action_result(connection, admitted.response);
  }

  function validate_action_request(
    request: Extract<HostedRequest, { type: "action" }>,
  ): Readonly<{ ok: true; payload: ExactDataCarrier | undefined; executeDocument?: (draft: LocusHostedAggregateDraft) => void }> | Readonly<{ ok: false; code: string; message: string }> {
    try {
      const admittedPayload = request.payload === undefined ? undefined : admit_hson_data_input(request.payload);
      if (is_document_action(request.name)) {
        const record = exact_record(admittedPayload?.materialize(), `Hosted document action ${request.name}`);
        const libraryName = required_string(record.library);
        const identity = libraryName === undefined ? undefined : identitiesByName.get(libraryName);
        if (libraryName === undefined || identity === undefined) throw new Error("Hosted document action requires a known library.");
        const selected = options.map.lib(libraryName);
        if (selected.mode !== "document") throw new Error("Hosted document action library is not a document Library.");
        const localPayload: Record<string, unknown> = { ...record };
        delete localPayload.library;
        if (!is_locus_json_value(localPayload)) throw new Error("Hosted document action payload is malformed.");
        const resolution = resolve_locus_document_action(selected, request.name, localPayload);
        if (resolution.kind === "invalid" || resolution.kind === "unavailable") throw new Error(resolution.message);
        if (resolution.kind !== "ready") throw new Error(`Unknown hosted document action ${request.name}.`);
        const normalizedRecord = exact_record(resolution.payload, `Hosted document action ${request.name}`);
        const normalizedCandidate = Object.freeze({ library: libraryName, ...normalizedRecord });
        if (!is_locus_json_value(normalizedCandidate)) throw new Error("Hosted document action payload is not canonical JSON.");
        const normalized: JsonValue = normalizedCandidate;
        return Object.freeze({
          ok: true,
          payload: ExactDataCarrier.from(normalized),
          executeDocument: (draft: LocusHostedAggregateDraft) => {
            const target = draft.lib(libraryName);
            if (!("graph" in target)) throw new Error("Hosted document action library is not a document Library.");
            resolution.execute(document_action_target(target, aggregate, identity));
          },
        });
      } else if (options.actions?.[request.name] === undefined) {
        return Object.freeze({ ok: false, code: "LOCUS_UNKNOWN_ACTION", message: `Unknown Locus action: ${request.name}` });
      } else {
        const decoded = decode_locus_action_payload(options.schema?.actions?.[request.name]?.payload, admittedPayload);
        if (!decoded.ok) return Object.freeze({ ok: false, code: "LOCUS_SCHEMA_INVALID_PAYLOAD", message: locus_schema_error_message(decoded.issues) });
        return Object.freeze({ ok: true, payload: decoded.value });
      }
    } catch (cause) {
      return Object.freeze({
        ok: false,
        code: "LOCUS_SCHEMA_INVALID_PAYLOAD",
        message: locus_client_error_message(cause, "Locus action payload is invalid."),
      });
    }
    return Object.freeze({ ok: true, payload: request.payload === undefined ? undefined : admit_hson_data_input(request.payload) });
  }

  async function dispatch_message(message: import("../../types/locus.types.js").LocusClientActionMessage): Promise<LocusClientActionResult> {
    const request: Extract<HostedRequest, { type: "action" }> = message;
    const validation = validate_action_request(request);
    if (!validation.ok) {
      return Object.freeze({
        type: "error",
        id: request.id,
        ok: false,
        seq,
        completionRev: locus.rev,
        delivery: "rejected",
        error: validation,
      });
    }
    const outcome = await execute_action(request, validation.payload);
    if (outcome.state === "succeeded") return Object.freeze({
      type: "ack",
      id: request.id,
      ok: true,
      seq: outcome.seq,
      completionRev: outcome.completionRev,
      ...(outcome.result === undefined ? {} : { result: outcome.result }),
    });
    return Object.freeze({ type: "error", id: request.id, ok: false, seq: outcome.seq, completionRev: outcome.completionRev, error: outcome.error });
  }

  async function action_status(connection: HostedConnection, request: Extract<HostedRequest, { type: "action-status" }>): Promise<void> {
    const binding = bind_session(connection, false);
    if (!(binding instanceof Promise ? await binding : binding)) return;
    if (connection.sessionId === undefined || connection.sessionEpoch === undefined) return;
    const capturedSessionId = connection.sessionId;
    const capturedEpoch = connection.sessionEpoch;
    if (!attachment_current(connection, capturedSessionId, capturedEpoch)) return;
    const status = read_locus_retained_action_status_internal(server, {
      clientId: request.clientId,
      requestId: request.requestId,
      ...(connection.context === undefined ? {} : { connection: connection.context }),
    });
    if (!attachment_current(connection, capturedSessionId, capturedEpoch)) return;
    if (!status.ok) {
      send(connection, Object.freeze({
        type: "session-rejected",
        id: request.id,
        code: status.code,
        message: status.message,
      }));
      return;
    }
    send(connection, Object.freeze({
      type: "action-status",
      id: request.id,
      requestId: request.requestId,
      state: status.state,
      ...(status.outcome === undefined ? {} : { outcome: status.outcome }),
    }));
  }

  function dispatch_request(connection: HostedConnection, request: HostedRequest): void | Promise<void> {
    if (request.type === "recover") {
      void recover(connection, request).catch(() => {
        if (connection.closed || connection.fenced || connection.recoveryId !== request.id) return;
        stop_recovery(connection);
        reject(connection, "LOCUS_RECOVERY_FAILED", "Hosted aggregate recovery failed.", request.id);
      });
      return;
    }
    if (request.type === "session-create") {
      return session_create(connection, request);
    }
    if (request.type === "session-attach") {
      session_attach(connection, request);
      return;
    }
    if (request.type === "session-goodbye") {
      session_goodbye(connection, request);
      return;
    }
    if (request.type === "action-status") {
      return action_status(connection, request);
    }
    return action(connection, request);
  }

  function attach(
    downstream: LocusHostedAggregateDownstreamSink,
    context?: LocusConnectionContext,
    onClose?: LocusDisposer,
  ): LocusHostedAggregateSemanticAttachment<TActions> {
    // Bind the authenticated principal at transport attachment, including
    // across an asynchronous projection decision.
    const attachedContext = context === undefined ? undefined : Object.freeze({
      ...(context.principalId === undefined ? {} : { principalId: context.principalId }),
      ...(context.attachment === undefined ? {} : { attachment: context.attachment }),
    });
    if (disposed) {
      return Object.freeze({
        binding: Object.freeze({
          principalId: attachedContext?.principalId,
          logicalMapId: locus.logicalMapId,
          incarnationId: locus.incarnationId,
          get sessionId() { return undefined; },
          get attachmentEpoch() { return undefined; },
          get attached() { return false; },
        }),
        operations: Object.freeze({ submit: () => {} }),
        synchronization: Object.freeze({ begin: () => {}, cancel: () => {} }),
        emit_event: () => {},
        close: () => {},
      });
    }
    const releaseConnectionActivity = options.internal?.acquireConnectionActivity?.();
    const connection: HostedConnection = {
      downstream,
      ...(onClose === undefined ? {} : { onClose }),
      recoveryId: undefined,
      recovering: false,
      live: false,
      pendingLive: [],
      closed: false,
      sessionId: undefined,
      sessionEpoch: undefined,
      sessionResumable: false,
      establishing: false,
      fenced: false,
      ...(releaseConnectionActivity === undefined ? {} : { releaseActivity: releaseConnectionActivity }),
      ...(attachedContext === undefined ? {} : { context: attachedContext }),
    };
    connections.add(connection);
    const dispose = (): void => {
      if (connection.closed) return;
      connection.closed = true;
      stop_recovery(connection);
      connections.delete(connection);
      if (connection.sessionId !== undefined && connection.sessionEpoch !== undefined) {
        sessions.detach(connection.sessionId, connection.sessionEpoch);
      }
      connection.releaseActivity?.();
      connection.releaseActivity = undefined;
      connection.onClose?.();
    };
    const binding = Object.freeze({
      principalId: attachedContext?.principalId,
      logicalMapId: locus.logicalMapId,
      incarnationId: locus.incarnationId,
      get sessionId() { return connection.sessionId; },
      get attachmentEpoch() { return connection.sessionEpoch; },
      get attached() {
        return connection.sessionId !== undefined
          && connection.sessionEpoch !== undefined
          && attachment_current(connection, connection.sessionId, connection.sessionEpoch);
      },
    });
    return Object.freeze({
      binding,
      operations: Object.freeze({
        submit(request: LocusFiniteOperationRequest<TActions>) {
          return dispatch_request(connection, request as Exclude<HostedRequest, { type: "recover" }>);
        },
      }),
      synchronization: Object.freeze({
        begin(request: Extract<HostedRequest, { type: "recover" }>) { void dispatch_request(connection, request); },
        cancel: () => stop_recovery(connection),
      }),
      emit_event: () => {},
      close: dispose,
    });
  }

  function connect(socket: LocusSocketLike, context?: LocusConnectionContext): LocusDisposer {
    if (disposed) return () => {};
    let stopMessage: LocusDisposer | void;
    let stopClose: LocusDisposer | void;
    let listenersOpen = true;
    const stopListeners = (): void => {
      if (!listenersOpen) return;
      listenersOpen = false;
      stopMessage?.();
      stopClose?.();
    };
    const semantic = attach({
      finite: (message) => socket.send(encode_downstream_message(message, maxWireBytes)),
      synchronization: (message) => socket.send(encode_downstream_message(message, message.type === "recovery-snapshot" ? HOSTED_MAX_SNAPSHOT_BYTES : maxWireBytes)),
      publication: (message) => socket.send(encode_downstream_message(message, maxWireBytes)),
      event: () => {},
    }, context, stopListeners);
    try {
      stopMessage = socket.onMessage((raw) => {
        let request: HostedRequest;
        try {
          request = decode_request(raw, maxWireBytes);
        } catch (cause) {
          socket.send(JSON.stringify(Object.freeze({
            type: "error",
            format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT,
            code: "LOCUS_PROTOCOL_INVALID",
            message: locus_client_error_message(cause, "Malformed hosted protocol message."),
          })));
          return;
        }
        if (request.type === "recover") semantic.synchronization.begin(request);
        else void semantic.operations.submit(request as LocusFiniteOperationRequest<TActions>);
      });
      stopClose = socket.onClose(semantic.close);
    } catch (error) {
      semantic.close();
      throw error;
    }
    return semantic.close;
  }

  const server = Object.freeze({
    map: options.map,
    logicalMapId: locus.logicalMapId,
    incarnationId: locus.incarnationId,
    get registryDigest() { return locus.registryDigest; },
    get rev() { return locus.rev; },
    connect,
    attach,
    mutate: locus.mutate,
    add_libraries,
    dispatch_action: locus.dispatch_action,
    dispatch_message,
    sessions: Object.freeze({ debug: sessions.debug, onChange: sessions.onChange, revoke: sessions.revoke,
      projection: sessions.projection, updateProjection: update_projection, dispose: sessions.dispose }),
    actionRequests: Object.freeze({ debug: actionRequests.debug, dispose: actionRequests.dispose }),
    run_exclusive: locus.run_exclusive,
    debug: () => Object.freeze({
      historyBaseRevision,
      retainedHistoryBytes: retainedBytes,
      retainedCommits: history.length,
      connections: connections.size,
      effectiveLiveWireBytes: maxWireBytes,
      effectiveSnapshotWireBytes: HOSTED_MAX_SNAPSHOT_BYTES,
    }),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      stopWire();
      for (const connection of [...connections]) {
        connection.closed = true;
        stop_recovery(connection);
        connection.onClose?.();
        connection.releaseActivity?.();
        connection.releaseActivity = undefined;
      }
      connections.clear();
      actionRequests.dispose();
      sessions.dispose();
      locus.dispose();
    },
  });
  register_locus_remote_action_admission_internal(
    server,
    (ingress) => admit_ephemeral_remote_action(ingress as LocusRemoteActionIngress<TActions>),
  );
  register_locus_retained_action_status_internal(server, (ingress) => {
    if (disposed) throw new Error("Locus retained action status authority is unavailable.");
    return actionRequests.status(
      ingress.clientId,
      ingress.requestId,
      ingress.connection?.principalId,
    );
  });
  return server;
}

function encode_downstream_message(message: unknown, limit: number): string {
  const semantic = exact_record(message, "Hosted aggregate semantic output");
  let framed: Readonly<Record<string, unknown>>;
  if (semantic.type === "synchronization-failure" && is_record(semantic.error)) {
    const cause = is_record(semantic.error.cause) ? semantic.error.cause : undefined;
    framed = Object.freeze({
      type: "error",
      format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT,
      ...(typeof cause?.id === "string" ? { id: cause.id } : {}),
      code: typeof semantic.error.code === "string" ? semantic.error.code : "LOCUS_RECOVERY_FAILED",
      message: semantic.error.message,
    });
  } else if (semantic.type === "ack" && Object.hasOwn(semantic, "result")) {
    const { result, ...rest } = semantic;
    framed = Object.freeze({
      ...rest,
      format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT,
      ...(result === undefined ? {} : { resultData: encode_hson_data_internal(result as ExactDataCarrier) }),
    });
  } else if (semantic.type === "action-status" && is_record(semantic.outcome)
    && semantic.outcome.state === "succeeded" && Object.hasOwn(semantic.outcome, "result")) {
    const { result, ...outcome } = semantic.outcome;
    framed = Object.freeze({
      ...semantic,
      format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT,
      outcome: Object.freeze({
        ...outcome,
        ...(result === undefined ? {} : { resultData: encode_hson_data_internal(result as ExactDataCarrier) }),
      }),
    });
  } else {
    framed = Object.freeze({ ...semantic, format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT });
  }
  const raw = JSON.stringify(framed);
  if (utf8_bytes(raw) > limit) throw new Error("Hosted aggregate socket message exceeds its configured byte limit.");
  return raw;
}

function is_record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}


/** Derive replica progress from exact authority history without rewriting that history. */
export function derive_locus_hosted_progress_internal(envelope: LocusHostedAggregateAuthorityEnvelope): LocusHostedAggregateProgress | undefined {
  const commit = envelope.commit;
  if (make_portable_aggregate_commit(commit) !== undefined) return undefined;
  return Object.freeze({
    logicalMapId: envelope.logicalMapId,
    incarnationId: envelope.incarnationId,
    registryDigest: envelope.registryDigest,
    prevRev: commit.prevRev,
    rev: commit.rev,
  });
}

function decode_request(raw: string, maxWireBytes: number): HostedRequest {
  if (typeof raw !== "string" || utf8_bytes(raw) > maxWireBytes) throw new Error("Hosted aggregate request is malformed or exceeds its byte limit.");
  const value = exact_record(JSON.parse(raw), "Hosted aggregate request");
  if (value.type === "recover") {
    const hasCursor = Object.hasOwn(value, "incarnationId") || Object.hasOwn(value, "registryDigest") || Object.hasOwn(value, "projectionDigest") || Object.hasOwn(value, "lastAppliedRev");
    exact_keys(value, hasCursor
      ? ["type", "id", "logicalMapId", "incarnationId", "registryDigest", "projectionDigest", "lastAppliedRev"]
      : ["type", "id", "logicalMapId"], "Hosted recovery request");
    const id = required_string(value.id);
    const logicalMapId = required_string(value.logicalMapId);
    if (id === undefined || logicalMapId === undefined) throw new Error("Hosted recovery request requires non-empty id and logicalMapId.");
    if (utf8_bytes(id) > MAX_RECOVERY_REQUEST_ID_BYTES) throw new Error("Hosted recovery request ID exceeds its byte limit.");
    if (!hasCursor) return Object.freeze({ type: "recover", id, logicalMapId });
    const incarnationId = required_string(value.incarnationId);
    const registryDigest = required_digest(value.registryDigest);
    const projectionDigest = required_digest(value.projectionDigest);
    const lastAppliedRev = required_revision(value.lastAppliedRev);
    if (incarnationId === undefined || registryDigest === undefined || projectionDigest === undefined || lastAppliedRev === undefined) throw new Error("Hosted recovery cursor is malformed.");
    return Object.freeze({ type: "recover", id, logicalMapId, cursor: Object.freeze({ incarnationId, registryDigest, projectionDigest, lastAppliedRev }) });
  }
  if (value.type === "session-create" || value.type === "session-goodbye") {
    const decoded = decode_locus_message(raw);
    if (!decoded.ok || (decoded.value.type !== "session-create" && decoded.value.type !== "session-goodbye")) throw new Error(decoded.ok ? "Hosted session request is malformed." : decoded.error.message);
    return decoded.value;
  }
  if (value.type === "session-attach") {
    const decoded = decode_locus_message(raw);
    if (!decoded.ok || decoded.value.type !== "session-attach") throw new Error(decoded.ok ? "Hosted session-attach request is malformed." : decoded.error.message);
    return decoded.value;
  }
  if (value.type === "action-status") {
    const decoded = decode_locus_message(raw);
    if (!decoded.ok || decoded.value.type !== "action-status") throw new Error(decoded.ok ? "Hosted action-status request is malformed." : decoded.error.message);
    return decoded.value;
  }
  if (value.type === "action") {
    const decoded = decode_locus_message(raw);
    if (!decoded.ok || decoded.value.type !== "action") throw new Error(decoded.ok ? "Hosted action request is malformed." : decoded.error.message);
    return decoded.value;
  }
  throw new Error("Hosted aggregate request type is unknown.");
}

function document_action_target(
  draft: LocusHostedAggregateDocumentDraft,
  aggregate: ReturnType<typeof internal_livemap_aggregate_authority>,
  identity: object,
): LocusDocumentActionTarget {
  const commit = (): LiveMapGraphCommit => Object.freeze({
    changed: false,
    prevRev: aggregate.inspect().revision,
    rev: aggregate.inspect().revision,
    ops: Object.freeze([]),
  });
  const target = (request: LiveMapDocumentRequestTarget): LiveMapDocumentCommitTarget => {
    const resolved = document_target_for_library(request, aggregate, identity);
    if (resolved === undefined) throw new Error("Hosted document action target is malformed or belongs to another Library.");
    return resolved;
  };
  const attrs: LocusDocumentActionTarget["document"]["attrs"] = Object.freeze({
    set(request, name, value) { draft.attrs.set(target(request), name, value); return commit(); },
    drop(request, name) { draft.attrs.drop(target(request), name); return commit(); },
    setMany(request, values) { for (const [name, value] of Object.entries(values)) draft.attrs.set(target(request), name, value); return commit(); },
    dropMany(request, names) { for (const name of names) draft.attrs.drop(target(request), name); return commit(); },
    clear(request) { draft.attrs.replace(target(request), Object.freeze({})); return commit(); },
    replace(request, values) { draft.attrs.replace(target(request), values); return commit(); },
  });
  const content: LocusDocumentActionTarget["document"]["content"] = Object.freeze({
    replace(request, index, replacement, lineage) {
      draft.graph(Object.freeze({ domain: "graph", op: "replace-content", target: target(request), index, replacement, ...(lineage === undefined ? {} : { lineage }) }));
      return commit();
    },
    insert(request, index, inserted) { draft.content.insert(target(request), index, inserted); return commit(); },
    remove(request, index) { draft.content.remove(target(request), index); return commit(); },
    move(request, from, to) { draft.content.move(target(request), from, to); return commit(); },
  });
  return Object.freeze({
    mode: "document" as const,
    document: Object.freeze({ attrs, content }),
  });
}

function document_target_for_library(
  target: LiveMapDocumentRequestTarget | undefined,
  aggregate: ReturnType<typeof internal_livemap_aggregate_authority>,
  identity: object,
): LiveMapDocumentCommitTarget | undefined {
  if (target === undefined) return undefined;
  void aggregate;
  void identity;
  return Object.freeze({
    kind: "path" as const,
    path: validate_document_path(target.path),
  });
}

function is_document_action(name: string): boolean {
  return name === "document.attrs.set"
    || name === "document.attrs.drop"
    || name === "document.attrs.setMany"
    || name === "document.attrs.dropMany"
    || name === "document.attrs.clear"
    || name === "document.attrs.replace"
    || name === "document.content.replace"
    || name === "document.content.insert"
    || name === "document.content.remove"
    || name === "document.content.move";
}

function bounded(value: number | undefined, fallback: number, label: string, ceiling: number): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result <= 0 || result > ceiling) throw new Error(`Hosted aggregate ${label} bound is invalid.`);
  return result;
}

function encoded_bytes(value: unknown): number {
  return utf8_bytes(JSON.stringify(value));
}

function utf8_bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function exact_record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new Error(`${label} is malformed.`);
  }
  return value as Record<string, unknown>;
}

function exact_keys(value: Readonly<Record<string, unknown>>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value);
  if (actual.length !== expected.length || !expected.every((key) => Object.hasOwn(value, key))) {
    throw new Error(`${label} contains missing or unexpected fields.`);
  }
}

function required_string(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function required_digest(value: unknown): string | undefined {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value) ? value : undefined;
}

function required_revision(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
