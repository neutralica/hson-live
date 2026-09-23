import type { JsonValue } from "../../core/types.js";
import { ExactDataCarrier, admit_hson_data_input, hson_data_text, encode_hson_data_internal } from "../data/hson-data.js";
import type {
  LiveMapDocumentCommitTarget,
  LiveMapDocumentRequestTarget,
  LiveMapGraphCommit,
  LiveMapLibraries,
  HostedLiveMapLibrariesSnapshot,
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




  LocusSocketLike,
} from "../../types/locus.types.js";
import { decode_locus_message } from "./locus.protocol.js";
import { is_locus_json_value } from "./locus.protocol.js";
import { internal_livemap_aggregate_authority } from "../livemap/livemap.internal.js";
import { make_livemap_hosted_mirror_from_snapshot_internal } from "../livemap/livemap.libraries.js";
import { validate_document_path } from "../livemap/livemap.document.path.js";
import { make_locus_action_dedupe_store } from "./locus.actions.js";
import { make_locus_session_manager } from "./locus.session.js";
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
  LOCUS_HOSTED_AGGREGATE_WIRE_FORMAT,
  create_locus_hosted_aggregate_internal,
  decode_locus_hosted_aggregate_envelope,
  type LocusHostedAggregate,
  type LocusHostedAggregateAction,
  type LocusHostedAggregateDocumentDraft,
  type LocusHostedAggregateDraft,
  type LocusHostedAggregateGateInput,
  type LocusHostedAggregateWireEnvelope,
} from "./locus.hosted-multi-library.js";
import { LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT } from "./locus.hosted-multi-library.protocol.js";
import {
  admit_locus_aggregate_external_action,
  type LocusAggregateExternalActionAttempt,
  type LocusAggregateActionAuthorityInternals,
} from "./locus.hosted-multi-library.action-admission.js";
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
  LocusHostedAggregateSemanticAttachment,
} from "./locus.hosted-multi-library.transport.internal.js";
import type { LocusFiniteOperationRequest } from "./locus.transport.internal.js";

/** The established Locus retained live-history budget. */
export const DEFAULT_LOCUS_HOSTED_AGGREGATE_HISTORY_BYTES = 4 * 1_024 * 1_024;

type HostedCursor = Readonly<{
  incarnationId: string;
  registryDigest: string;
  lastAppliedRev: number;
}>;

type HostedRequest =
  | Readonly<{ type: "recover"; id: string; logicalMapId: string; cursor?: HostedCursor }>
  | Readonly<{ type: "session-create"; id: string }>
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
  envelope: LocusHostedAggregateWireEnvelope;
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
  readonly pendingLive: LocusHostedAggregateWireEnvelope[];
  closed: boolean;
  releaseActivity?: LocusDisposer;
  releaseRecoveryActivity?: LocusDisposer;
  readonly context?: LocusConnectionContext;
  sessionId: string | undefined;
  sessionEpoch: number | undefined;
  sessionResumable: boolean;
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
  map: LiveMapLibraries;
  actions?: Readonly<Record<string, LocusHostedAggregateAction>>;
  gate?: (input: LocusHostedAggregateGateInput) => void | Promise<void>;
  maxWireBytes?: number;
  maxHistoryBytes?: number;
  authorizeAction?: LocusActionAuthorizer<TActions>;
  sessionId?: LocusSessionId | (() => LocusSessionId);
  sessions?: LocusSessionOptions;
  actionDedupe?: LocusActionDedupeOptions;
  schema?: Pick<LocusSchema<JsonValue | undefined, TActions>, "actions">;
  /** Internal deterministic interleave seam for pending-live proof coverage. */
  internal?: Readonly<{
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
  map: LiveMapLibraries;
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
  dispatch_action: LocusHostedAggregate["dispatch_action"];
  dispatch_message: (message: import("../../types/locus.types.js").LocusClientActionMessage) => Promise<LocusClientActionResult>;
  sessions: Readonly<{ debug: ReturnType<typeof make_locus_session_manager>["debug"]; onChange: ReturnType<typeof make_locus_session_manager>["onChange"]; dispose: () => void }>;
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
 * Locus, one global retained history and one map-wide recovery cut; it does
 * not route a library through the legacy solo Locus representation.
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
  const initial = aggregate.captureHosted();
  const registry = aggregate.hostedRegistry();
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
  const locus = create_locus_hosted_aggregate_internal({
    map: options.map,
    ...(options.actions === undefined ? {} : { actions: options.actions }),
    ...(options.gate === undefined ? {} : { gate: options.gate }),
    maxWireBytes,
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

  const stopWire = locus.on_wire((wire) => {
    if (disposed) return;
    const envelope = aggregate_envelope_from_wire(wire, locus);
    append_history(envelope);
    for (const connection of [...connections]) {
      if (connection.closed) continue;
      if (connection.recovering) connection.pendingLive.push(envelope);
      else if (connection.live && connection.recoveryId !== undefined) {
        send_live_commit(connection, connection.recoveryId, envelope);
      }
    }
  });

  function append_history(envelope: LocusHostedAggregateWireEnvelope): void {
    const commit = envelope.commit;
    const previous = history.length === 0 ? historyBaseRevision : history[history.length - 1]?.envelope.commit.rev;
    if (previous !== commit.prevRev) {
      throw new Error("Hosted aggregate history lost global revision continuity.");
    }
    const bytes = encoded_bytes(envelope);
    if (bytes > maxHistoryBytes) {
      history.length = 0;
      retainedBytes = 0;
      historyBaseRevision = commit.rev;
      return;
    }
    history.push(Object.freeze({ envelope, bytes }));
    retainedBytes += bytes;
    while (retainedBytes > maxHistoryBytes) {
      const removed = history.shift();
      if (removed === undefined) break;
      retainedBytes -= removed.bytes;
      historyBaseRevision = removed.envelope.commit.rev;
    }
  }

  function send(connection: HostedConnection, message: unknown, _limit = maxWireBytes): void {
    if (connection.closed) return;
    if (!is_hosted_aggregate_downstream_output(message)) {
      throw new Error("Hosted aggregate semantic output is malformed.");
    }
    const semantic: Record<string, unknown> = { ...message };
    if (semantic.type === "commit") {
      connection.downstream.publication(semantic as Parameters<LocusHostedAggregateDownstreamSink["publication"]>[0]);
      return;
    }
    if (semantic.type === "recovery-plan"
      || semantic.type === "recovery-snapshot"
      || semantic.type === "recovery-commit"
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

  function send_live_commit(connection: HostedConnection, id: string, envelope: LocusHostedAggregateWireEnvelope): void {
    send(connection, Object.freeze({
      type: "commit",
      id,
      commit: envelope,
    }));
  }

  async function recover(connection: HostedConnection, request: Extract<HostedRequest, { type: "recover" }>): Promise<void> {
    if (!bind_session(connection, false)) {
      reject(connection, "LOCUS_SESSION_NOT_ATTACHED", "Hosted aggregate recovery requires an active Locus session.", request.id);
      return;
    }
    if (request.logicalMapId !== locus.logicalMapId) {
      send(connection, recovery_plan(request.id, "reject", locus.rev, {
        code: "LOCUS_RECOVERY_INVALID_TARGET",
        message: `Unknown hosted logical map ID: ${request.logicalMapId}`,
      }));
      return;
    }
    const cursor = request.cursor;
    const sameIncarnation = cursor?.incarnationId === locus.incarnationId;
    const sameRegistry = cursor?.registryDigest === registry.digest;
    if (cursor !== undefined && cursor.lastAppliedRev > locus.rev && sameIncarnation && sameRegistry) {
      send(connection, recovery_plan(request.id, "reject", locus.rev, {
        code: "REVISION_AHEAD_OF_AUTHORITY",
        message: `Client revision ${cursor.lastAppliedRev} is ahead of authoritative revision ${locus.rev}.`,
      }));
      return;
    }
    if (connection.recovering) {
      reject(connection, "LOCUS_RECOVERY_IN_PROGRESS", "Hosted aggregate recovery is already in progress.", request.id);
      return;
    }

    if (connection.sessionId === undefined || connection.sessionEpoch === undefined) return;
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
    let snapshot: HostedLiveMapLibrariesSnapshot | undefined;
    let replay: readonly HostedHistoryEntry[] = Object.freeze([]);
    const head = locus.rev;
    if (cursor === undefined) {
      outcome = "snapshot";
      reason = "no_usable_revision";
    } else if (!sameRegistry) {
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
      snapshot = aggregate.captureHosted();
      if (snapshot.revision !== locus.rev) throw new Error("Hosted aggregate snapshot cut disagrees with its global revision.");
    }
    const cut = snapshot?.revision ?? head;
    await options.internal?.afterRecoveryCut?.();
    if (!recovery_delivery_current(connection, activeRecovery)) return;
    send(connection, recovery_plan(request.id, outcome, cut, reason === undefined ? undefined : { reason }));
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
        send(connection, Object.freeze({
          type: "recovery-commit",
          id: request.id,
          phase: "body",
          commit: entry.envelope,
        }));
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
      registryDigest: registry.digest,
      throughRev: cut,
    }));
    if (!recovery_delivery_current(connection, activeRecovery)) return;
    await options.internal?.afterRecoveryCaughtUp?.();
    if (!recovery_delivery_current(connection, activeRecovery)) return;
    connection.recovering = false;
    connection.live = true;
    while (connection.pendingLive.length > 0) {
      if (!recovery_attachment_current(connection, activeRecovery) || !connection.live) return;
      const pending = connection.pendingLive.shift();
      if (pending === undefined) continue;
      if (pending.commit.prevRev < cut) continue;
      send_live_commit(connection, request.id, pending);
      if (!recovery_attachment_current(connection, activeRecovery) || !connection.live) return;
    }
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
    detail?: Readonly<{ reason: HostedSnapshotReason }> | Readonly<{ code: string; message: string }>,
  ): object {
    const base = {
      type: "recovery-plan" as const,
      id,
      logicalMapId: locus.logicalMapId,
      incarnationId: locus.incarnationId,
      registryDigest: registry.digest,
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

  function bind_session(connection: HostedConnection, resumable: boolean): boolean {
    if (connection.sessionId !== undefined) {
      return connection.sessionEpoch !== undefined
        && !connection.fenced
        && sessions.is_active(connection.sessionId, connection.sessionEpoch);
    }
    const sessionId = next_session_id();
    const created = sessions.create(
      sessionId,
      resumable,
      session_attachment(connection),
      () => {},
      () => 0,
      connection.context,
    );
    if (!created.ok) {
      return false;
    }
    connection.sessionId = created.value.sessionId;
    connection.sessionEpoch = created.value.epoch;
    connection.sessionResumable = created.value.resumable;
    return true;
  }

  function session_create(connection: HostedConnection, request: Extract<HostedRequest, { type: "session-create" }>): void {
    if (connection.sessionId !== undefined) {
      send(connection, Object.freeze({ type: "session-rejected", id: request.id, code: "LOCUS_SESSION_NOT_ATTACHED", message: "This transport already owns a Locus session." }));
      return;
    }
    const sessionId = next_session_id();
    const created = sessions.create(sessionId, true, session_attachment(connection), () => {}, () => 0, connection.context);
    if (!created.ok || created.value.credential === undefined) {
      send(connection, Object.freeze({ type: "session-rejected", id: request.id, code: "LOCUS_SESSION_NOT_ATTACHED", message: "Locus could not create a resumable session." }));
      return;
    }
    connection.sessionId = created.value.sessionId;
    connection.sessionEpoch = created.value.epoch;
    connection.sessionResumable = true;
    send(connection, Object.freeze({
      type: "session-created",
      id: request.id,
      sessionId: created.value.sessionId,
      credential: created.value.credential,
      epoch: created.value.epoch,
      logicalMapId: locus.logicalMapId,
      incarnationId: locus.incarnationId,
    }));
  }

  function session_attach(connection: HostedConnection, request: Extract<HostedRequest, { type: "session-attach" }>): void {
    if (connection.sessionId !== undefined) {
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
          message: cause instanceof Error ? cause.message : "Hosted aggregate action failed.",
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
    const created = sessions.create(next_ephemeral_session_id(), false, attachment, () => {}, () => 0, connection);
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
    if (!bind_session(connection, false) || connection.sessionId === undefined || connection.sessionEpoch === undefined) return;
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
        message: cause instanceof Error ? cause.message : "Locus action payload is invalid.",
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

  function dispatch_request(connection: HostedConnection, request: HostedRequest): void | Promise<void> {
    if (request.type === "recover") {
      void recover(connection, request).catch((cause: unknown) => {
        if (connection.closed || connection.fenced || connection.recoveryId !== request.id) return;
        stop_recovery(connection);
        reject(connection, "LOCUS_RECOVERY_FAILED", cause instanceof Error ? cause.message : "Hosted aggregate recovery failed.", request.id);
      });
      return;
    }
    if (request.type === "session-create") {
      session_create(connection, request);
      return;
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
      if (!bind_session(connection, false)) return;
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
      return;
    }
    return action(connection, request);
  }

  function attach(
    downstream: LocusHostedAggregateDownstreamSink,
    context?: LocusConnectionContext,
    onClose?: LocusDisposer,
  ): LocusHostedAggregateSemanticAttachment<TActions> {
    if (disposed) {
      return Object.freeze({
        binding: Object.freeze({
          principalId: context?.principalId,
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
      fenced: false,
      ...(releaseConnectionActivity === undefined ? {} : { releaseActivity: releaseConnectionActivity }),
      ...(context === undefined ? {} : { context }),
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
      principalId: context?.principalId,
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
            message: cause instanceof Error ? cause.message : "Malformed hosted protocol message.",
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
    registryDigest: registry.digest,
    get rev() { return locus.rev; },
    connect,
    attach,
    mutate: locus.mutate,
    dispatch_action: locus.dispatch_action,
    dispatch_message,
    sessions: Object.freeze({ debug: sessions.debug, onChange: sessions.onChange, dispose: sessions.dispose }),
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


function aggregate_envelope_from_wire(wire: string, locus: LocusHostedAggregate): LocusHostedAggregateWireEnvelope {
  const parsed = JSON.parse(wire) as unknown;
  const message = exact_record(parsed, "Hosted aggregate wire");
  exact_keys(message, ["type", "id", "commit"], "Hosted aggregate wire");
  if (message.type !== "commit" || message.id !== "hosted-aggregate") throw new Error("Hosted aggregate wire routing is invalid.");
  const envelope = message.commit as LocusHostedAggregateWireEnvelope;
  decode_locus_hosted_aggregate_envelope(envelope, Object.freeze({
    logicalMapId: locus.logicalMapId,
    incarnationId: locus.incarnationId,
    registryDigest: locus.registryDigest,
    maxWireBytes: DEFAULT_LOCUS_HOSTED_AGGREGATE_MAX_WIRE_BYTES,
  }));
  return envelope;
}

function decode_request(raw: string, maxWireBytes: number): HostedRequest {
  if (typeof raw !== "string" || utf8_bytes(raw) > maxWireBytes) throw new Error("Hosted aggregate request is malformed or exceeds its byte limit.");
  const value = exact_record(JSON.parse(raw), "Hosted aggregate request");
  if (value.type === "recover") {
    const hasCursor = Object.hasOwn(value, "incarnationId") || Object.hasOwn(value, "registryDigest") || Object.hasOwn(value, "lastAppliedRev");
    exact_keys(value, hasCursor
      ? ["type", "id", "logicalMapId", "incarnationId", "registryDigest", "lastAppliedRev"]
      : ["type", "id", "logicalMapId"], "Hosted recovery request");
    const id = required_string(value.id);
    const logicalMapId = required_string(value.logicalMapId);
    if (id === undefined || logicalMapId === undefined) throw new Error("Hosted recovery request requires non-empty id and logicalMapId.");
    if (!hasCursor) return Object.freeze({ type: "recover", id, logicalMapId });
    const incarnationId = required_string(value.incarnationId);
    const registryDigest = required_digest(value.registryDigest);
    const lastAppliedRev = required_revision(value.lastAppliedRev);
    if (incarnationId === undefined || registryDigest === undefined || lastAppliedRev === undefined) throw new Error("Hosted recovery cursor is malformed.");
    return Object.freeze({ type: "recover", id, logicalMapId, cursor: Object.freeze({ incarnationId, registryDigest, lastAppliedRev }) });
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
