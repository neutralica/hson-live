import { is_Node } from "../../core/node-guards.js";
import type { JsonValue } from "../../core/types.js";
import type {
  LiveMapDocumentCommitTarget,
  LiveMapDocumentRequestTarget,
  LiveMapGraphCommit,
  LiveMapLibraries,
  LivePath,
} from "../../types/livemap.types.js";
import type {
  LocusActionAuthorizer,
  LocusActionDelivery,
  LocusActionPayloads,
  LocusActionTerminalOutcome,
  LocusClientActionResult,
  LocusConnectionContext,
  LocusDisposer,
  LocusSessionId,
  LocusSessionOptions,
  LocusActionDedupeOptions,
  LocusSchema,




  LocusSocketLike,
} from "../../types/locus.types.js";
import { parse_json } from "../transform/parsers/parse-json.js";
import { decode_locus_message, decode_locus_server_message } from "./locus.protocol.js";
import { is_locus_json_value } from "./locus.protocol.js";
import { internal_livemap_aggregate_authority } from "../livemap/livemap.internal.js";
import { make_livemap_hosted_mirror_from_snapshot_internal } from "../livemap/livemap.libraries.js";
import { node_to_json_value } from "../livemap/livemap.editor.js";
import { validate_document_path } from "../livemap/livemap.document.path.js";
import { make_locus_action_dedupe_store } from "./locus.actions.js";
import { authorize_locus_action } from "./locus.action-authorization.js";
import { make_locus_session_manager } from "./locus.session.js";
import { decode_locus_action_payload, locus_schema_error_message } from "./locus.action-validation.js";
import {
  resolve_locus_document_action,
  type LocusDocumentActionTarget,
} from "./locus.document-actions.js";
import {
  decode_exact_hson_value,
  encode_exact_hson_value,
} from "../livemap/livemap.document.view-state-codec.js";
import {
  HOSTED_MAX_SNAPSHOT_BYTES,
  assert_hosted_snapshot_bound,
  assert_hosted_snapshot_shape,
  type HostedAggregateSnapshot,
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

/** The established Locus retained live-history budget. */
export const DEFAULT_LOCUS_HOSTED_AGGREGATE_HISTORY_BYTES = 4 * 1_024 * 1_024;

type HostedCursor = Readonly<{
  incarnationId: string;
  registryDigest: string;
  lastAppliedRev: number;
}>;

type HostedSubscription = Readonly<{
  library: string;
  path: LivePath;
}>;

type HostedRequest =
  | Readonly<{ type: "recover"; id: string; logicalMapId: string; cursor?: HostedCursor }>
  | Readonly<{ type: "subscribe"; library: string; path: LivePath; registryDigest: string }>
  | Readonly<{ type: "unsubscribe"; library: string; path: LivePath; registryDigest: string }>
  | Readonly<{ type: "session-create"; id: string }>
  | Readonly<{ type: "session-attach"; id: string; credential?: unknown }>
  | Readonly<{ type: "session-goodbye"; id: string }>
  | Readonly<{ type: "action-status"; id: string; clientId: string; requestId: string }>
  | Readonly<{
    type: "action";
    id: string;
    name: string;
    payload?: JsonValue;
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

type HostedConnection = {
  readonly socket: LocusSocketLike;
  subscriptions: Map<string, HostedSubscription>;
  recoveryId: string | undefined;
  recovering: boolean;
  live: boolean;
  readonly pendingLive: LocusHostedAggregateWireEnvelope[];
  closed: boolean;
  stopMessage?: LocusDisposer;
  stopClose?: LocusDisposer;
  readonly context?: LocusConnectionContext;
  sessionId: string | undefined;
  sessionEpoch: number | undefined;
  sessionResumable: boolean;
  fenced: boolean;
};

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
  }>;
}>;

export type LocusHostedAggregateSocketServer = Readonly<{
  map: LiveMapLibraries;
  readonly logicalMapId: string;
  readonly incarnationId: string;
  readonly registryDigest: string;
  readonly rev: number;
  connect: (socket: LocusSocketLike, context?: LocusConnectionContext) => LocusDisposer;
  mutate: LocusHostedAggregate["mutate"];
  dispatch_action: LocusHostedAggregate["dispatch_action"];
  dispatch_message: (message: import("../../types/locus.types.js").LocusClientActionMessage) => Promise<LocusClientActionResult>;
  sessions: Readonly<{ debug: ReturnType<typeof make_locus_session_manager>["debug"]; on_change: ReturnType<typeof make_locus_session_manager>["on_change"]; dispose: () => void }>;
  actionRequests: Readonly<{ debug: ReturnType<typeof make_locus_action_dedupe_store>["debug"]; dispose: () => void }>;
  /** Ordered internal barrier used by persistence checkpointing. */
  run_exclusive: LocusHostedAggregate["run_exclusive"];
  debug: () => Readonly<{
    historyBaseRevision: number;
    retainedHistoryBytes: number;
    retainedCommits: number;
    connections: number;
    subscriptions: readonly Readonly<{ library: string; path: LivePath }>[];
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
): LocusHostedAggregateSocketServer {
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
  for (let index = 0; index < registry.libraries.length; index += 1) {
    const entry = registry.libraries[index];
    const identity = bindings[index];
    if (entry === undefined || identity === undefined) throw new Error("Hosted aggregate registry identity binding is unavailable.");
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
  const sessionResources = new Map<string, Map<string, HostedSubscription>>();
  const sessions = make_locus_session_manager(options.sessions);
  const actionRequests = make_locus_action_dedupe_store(
    () => locus.rev,
    () => seq,
    options.actionDedupe,
  );

  function next_session_id(): string {
    const configured = options.sessionId;
    if (typeof configured === "function") return configured();
    if (configured !== undefined) return configured;
    generatedSessionId += 1;
    return `locus-session-${Date.now().toString(36)}-${generatedSessionId.toString(36)}`;
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
    // This preserves the existing sync_all model: subscriptions do not filter
    // canonical commits, and are merely value-oriented notifications.
    for (const connection of [...connections]) {
      if (connection.live && !connection.recovering && !connection.closed) sync_all(connection);
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

  function send(connection: HostedConnection, message: unknown, limit = maxWireBytes): void {
    if (connection.closed) return;
    const raw = JSON.stringify(message);
    if (utf8_bytes(raw) > limit) throw new Error("Hosted aggregate socket message exceeds its configured byte limit.");
    connection.socket.send(raw);
  }

  function reject(connection: HostedConnection, code: string, message: string, id?: string): void {
    send(connection, Object.freeze({
      type: "error",
      format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT,
      ...(id === undefined ? {} : { id }),
      code,
      message,
    }));
  }

  function send_live_commit(connection: HostedConnection, id: string, envelope: LocusHostedAggregateWireEnvelope): void {
    send(connection, Object.freeze({
      type: "commit",
      format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT,
      id,
      commit: envelope,
    }));
  }

  function send_sync(connection: HostedConnection, subscription: HostedSubscription): void {
    const identity = identitiesByName.get(subscription.library);
    if (identity === undefined) return;
    const value = aggregate.snap(identity, subscription.path);
    const encoded = exact_sync_value(value);
    send(connection, Object.freeze({
      type: "sync",
      format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT,
      registryDigest: registry.digest,
      revision: locus.rev,
      library: subscription.library,
      path: clone_path(subscription.path),
      ...encoded,
    }));
  }

  function sync_all(connection: HostedConnection): void {
    for (const subscription of connection.subscriptions.values()) send_sync(connection, subscription);
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

    connection.recoveryId = request.id;
    connection.recovering = true;
    connection.live = false;
    connection.pendingLive.length = 0;
    let outcome: Exclude<HostedPlanOutcome, "reject">;
    let reason: HostedSnapshotReason | undefined;
    let snapshot: HostedAggregateSnapshot | undefined;
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
    send(connection, recovery_plan(request.id, outcome, cut, reason === undefined ? undefined : { reason }));
    if (snapshot !== undefined) {
      send(connection, Object.freeze({
        type: "recovery-snapshot",
        format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT,
        id: request.id,
        snapshot,
      }), HOSTED_MAX_SNAPSHOT_BYTES);
    } else {
      for (const entry of replay) {
        send(connection, Object.freeze({
          type: "recovery-commit",
          format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT,
          id: request.id,
          phase: "body",
          commit: entry.envelope,
        }));
      }
    }
    send(connection, Object.freeze({
      type: "recovery-caught-up",
      format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT,
      id: request.id,
      logicalMapId: locus.logicalMapId,
      incarnationId: locus.incarnationId,
      registryDigest: registry.digest,
      throughRev: cut,
    }));
    connection.recovering = false;
    connection.live = true;
    while (connection.pendingLive.length > 0) {
      const pending = connection.pendingLive.shift();
      if (pending === undefined) continue;
      if (pending.commit.prevRev < cut) continue;
      send_live_commit(connection, request.id, pending);
    }
    // Recover the complete mirror first; values are synchronized only after
    // the global stream has crossed its recovery boundary.
    sync_all(connection);
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
      format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT,
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
          format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT,
          sessionId,
          epoch,
          code: "LOCUS_SESSION_ATTACHMENT_FENCED",
        }));
        connection.fenced = true;
        connection.live = false;
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
    const resources = new Map<string, HostedSubscription>();
    sessionResources.set(sessionId, resources);
    const created = sessions.create(
      sessionId,
      resumable,
      session_attachment(connection),
      () => {
        resources.clear();
        sessionResources.delete(sessionId);
      },
      () => resources.size,
      connection.context,
    );
    if (!created.ok) {
      sessionResources.delete(sessionId);
      return false;
    }
    connection.sessionId = created.value.sessionId;
    connection.sessionEpoch = created.value.epoch;
    connection.sessionResumable = created.value.resumable;
    connection.subscriptions = resources;
    return true;
  }

  function session_create(connection: HostedConnection, request: Extract<HostedRequest, { type: "session-create" }>): void {
    if (connection.sessionId !== undefined) {
      send(connection, Object.freeze({ type: "session-rejected", format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT, id: request.id, code: "LOCUS_SESSION_NOT_ATTACHED", message: "This transport already owns a Locus session." }));
      return;
    }
    const sessionId = next_session_id();
    const resources = new Map<string, HostedSubscription>();
    sessionResources.set(sessionId, resources);
    const created = sessions.create(sessionId, true, session_attachment(connection), () => {
      resources.clear();
      sessionResources.delete(sessionId);
    }, () => resources.size, connection.context);
    if (!created.ok || created.value.credential === undefined) {
      send(connection, Object.freeze({ type: "session-rejected", format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT, id: request.id, code: "LOCUS_SESSION_NOT_ATTACHED", message: "Locus could not create a resumable session." }));
      return;
    }
    connection.sessionId = created.value.sessionId;
    connection.sessionEpoch = created.value.epoch;
    connection.sessionResumable = true;
    connection.subscriptions = resources;
    send(connection, Object.freeze({
      type: "session-created",
      format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT,
      id: request.id,
      sessionId: created.value.sessionId,
      credential: created.value.credential,
      epoch: created.value.epoch,
    }));
  }

  function session_attach(connection: HostedConnection, request: Extract<HostedRequest, { type: "session-attach" }>): void {
    if (connection.sessionId !== undefined) {
      send(connection, Object.freeze({ type: "session-rejected", format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT, id: request.id, code: "LOCUS_SESSION_NOT_ATTACHED", message: "This transport already owns a Locus session." }));
      return;
    }
    const attached = sessions.reattach(request.credential, session_attachment(connection), connection.context);
    if (!attached.ok) {
      send(connection, Object.freeze({ type: "session-rejected", format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT, id: request.id, code: attached.error.code ?? "LOCUS_SESSION_NOT_ATTACHED", message: attached.error.message }));
      return;
    }
    connection.sessionId = attached.value.sessionId;
    connection.sessionEpoch = attached.value.epoch;
    connection.sessionResumable = attached.value.resumable;
    connection.subscriptions = sessionResources.get(attached.value.sessionId) ?? new Map();
    send(connection, Object.freeze({ type: "session-attached", format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT, id: request.id, sessionId: attached.value.sessionId, epoch: attached.value.epoch }));
  }

  function session_goodbye(connection: HostedConnection, request: Extract<HostedRequest, { type: "session-goodbye" }>): void {
    if (connection.sessionId === undefined || connection.sessionEpoch === undefined) {
      send(connection, Object.freeze({ type: "session-rejected", format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT, id: request.id, code: "LOCUS_SESSION_NOT_ATTACHED", message: "This transport does not own a Locus session." }));
      return;
    }
    const sessionId = connection.sessionId;
    const epoch = connection.sessionEpoch;
    const ended = sessions.goodbye(sessionId, epoch);
    if (!ended.ok) {
      send(connection, Object.freeze({ type: "session-rejected", format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT, id: request.id, code: ended.error.code ?? "LOCUS_SESSION_ALREADY_GONE", message: ended.error.message }));
      return;
    }
    send(connection, Object.freeze({ type: "session-ended", format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT, id: request.id, sessionId, epoch }));
    connection.fenced = true;
    connection.live = false;
  }

  function send_action_result(
    connection: HostedConnection,
    request: Extract<HostedRequest, { type: "action" }>,
    outcome: LocusActionTerminalOutcome,
    delivery?: LocusActionDelivery,
  ): void {
    const common = {
      format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT,
      id: request.id,
      seq: outcome.seq,
      completionRev: outcome.completionRev,
      ...(request.requestId === undefined ? {} : { requestId: request.requestId }),
      ...(request.attemptId === undefined ? {} : { attemptId: request.attemptId }),
      ...(delivery === undefined ? {} : { delivery }),
    };
    if (outcome.state === "succeeded") {
      send(connection, Object.freeze({
        type: "ack",
        ok: true,
        ...common,
        ...(outcome.result === undefined ? {} : { result: outcome.result }),
      }));
      return;
    }
    send(connection, Object.freeze({ type: "error", ok: false, ...common, error: outcome.error }));
  }

  function rejected_action(
    connection: HostedConnection,
    request: Extract<HostedRequest, { type: "action" }>,
    code: string,
    message: string,
  ): void {
    send_action_result(connection, request, Object.freeze({
      state: "failed",
      seq,
      completionRev: locus.rev,
      error: Object.freeze({ code, message }),
    }), "rejected");
  }

  async function execute_action(
    request: Extract<HostedRequest, { type: "action" }>,
    payload: JsonValue | undefined,
  ): Promise<LocusActionTerminalOutcome> {
    try {
      let result: JsonValue | void;
      if (is_document_action(request.name)) {
        const validated = validate_action_request(Object.freeze({ ...request, ...(payload === undefined ? {} : { payload }) }));
        if (!validated.ok || validated.executeDocument === undefined) throw new Error(validated.ok ? "Hosted document action resolution was lost." : validated.message);
        await locus.mutate(validated.executeDocument);
        result = undefined;
      } else {
        result = await locus.dispatch_action(request.name, payload, request);
      }
      seq += 1;
      return Object.freeze({
        state: "succeeded",
        seq,
        completionRev: locus.rev,
        ...(result === undefined ? {} : { result }),
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

  async function action(connection: HostedConnection, request: Extract<HostedRequest, { type: "action" }>): Promise<void> {
    if (!bind_session(connection, false) || connection.sessionId === undefined || connection.sessionEpoch === undefined) return;
    const validation = validate_action_request(request);
    if (!validation.ok) {
      rejected_action(connection, request, validation.code, validation.message);
      return;
    }
    const origin = Object.freeze({
      kind: "session" as const,
      sessionId: connection.sessionId,
      epoch: connection.sessionEpoch,
      resumable: connection.sessionResumable,
    });
    const authorization = authorize_locus_action<TActions>({
      authorizer: options.authorizeAction,
      action: request.name,
      payload: validation.payload,
      origin,
      logicalMapId: locus.logicalMapId,
      incarnationId: locus.incarnationId,
      ...(connection.context === undefined ? {} : { connection: connection.context }),
    });
    const authorized = authorization instanceof Promise ? await authorization : authorization;
    if (!authorized.ok) {
      rejected_action(connection, request, authorized.code, authorized.message);
      return;
    }
    if (request.requestId === undefined || request.clientId === undefined) {
      send_action_result(connection, request, await execute_action(request, authorized.payload));
      return;
    }
    const result = await actionRequests.execute({
      clientId: request.clientId,
      requestId: request.requestId,
      actionName: request.name,
      payload: authorized.payload,
      retry: request.retry === true,
      run: () => execute_action(request, authorized.payload),
    });
    if (!result.ok) {
      rejected_action(connection, request, result.code, result.message);
      return;
    }
    send_action_result(connection, request, result.outcome, result.delivery);
  }

  function validate_action_request(
    request: Extract<HostedRequest, { type: "action" }>,
  ): Readonly<{ ok: true; payload: JsonValue | undefined; executeDocument?: (draft: LocusHostedAggregateDraft) => void }> | Readonly<{ ok: false; code: string; message: string }> {
    try {
      if (is_document_action(request.name)) {
        const record = exact_record(request.payload, `Hosted document action ${request.name}`);
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
          payload: normalized,
          executeDocument: (draft: LocusHostedAggregateDraft) => {
            const target = draft.lib(libraryName);
            if (!("graph" in target)) throw new Error("Hosted document action library is not a document Library.");
            resolution.execute(document_action_target(target, aggregate, identity));
          },
        });
      } else if (options.actions?.[request.name] === undefined) {
        return Object.freeze({ ok: false, code: "LOCUS_UNKNOWN_ACTION", message: `Unknown Locus action: ${request.name}` });
      } else {
        const decoded = decode_locus_action_payload(options.schema?.actions?.[request.name]?.payload, request.payload);
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
    return Object.freeze({ ok: true, payload: request.payload });
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

  function subscribe(connection: HostedConnection, request: Extract<HostedRequest, { type: "subscribe" | "unsubscribe" }>): void {
    if (!bind_session(connection, false)) {
      reject(connection, "LOCUS_SESSION_NOT_ATTACHED", "Hosted subscriptions require an active Locus session.");
      return;
    }
    if (!connection.live || connection.recovering) {
      reject(connection, "LOCUS_RECOVERY_REQUIRED", "Hosted subscriptions require a caught-up aggregate mirror.");
      return;
    }
    if (request.registryDigest !== registry.digest) {
      reject(connection, "LOCUS_REGISTRY_MISMATCH", "Hosted subscription registry digest is incompatible.");
      return;
    }
    const entry = registry.libraries.find((candidate) => candidate.name === request.library);
    const identity = identitiesByName.get(request.library);
    if (entry === undefined || identity === undefined) {
      reject(connection, "LOCUS_UNKNOWN_LIBRARY", `Unknown hosted Library ${JSON.stringify(request.library)}.`);
      return;
    }
    if (entry.mode === "document") {
      reject(connection, "LOCUS_PROJECTED_SUBSCRIPTION_UNSUPPORTED", "Document library subscriptions are not implemented for hosted multi-library Locus.");
      return;
    }
    const subscription = Object.freeze({ library: request.library, path: clone_path(request.path) });
    const key = subscription_key(subscription.library, subscription.path);
    if (request.type === "subscribe") {
      if (connection.subscriptions.has(key)) {
        reject(connection, "LOCUS_DUPLICATE_SUBSCRIPTION", "Hosted subscription already exists.");
        return;
      }
      connection.subscriptions.set(key, subscription);
      send_sync(connection, subscription);
      return;
    }
    if (!connection.subscriptions.delete(key)) {
      reject(connection, "LOCUS_UNKNOWN_SUBSCRIPTION", "Hosted subscription does not exist.");
    }
  }

  function connect(socket: LocusSocketLike, context?: LocusConnectionContext): LocusDisposer {
    if (disposed) return () => {};
    const connection: HostedConnection = {
      socket,
      subscriptions: new Map(),
      recoveryId: undefined,
      recovering: false,
      live: false,
      pendingLive: [],
      closed: false,
      sessionId: undefined,
      sessionEpoch: undefined,
      sessionResumable: false,
      fenced: false,
      ...(context === undefined ? {} : { context }),
    };
    connections.add(connection);
    const dispose = (): void => {
      if (connection.closed) return;
      connection.closed = true;
      connection.pendingLive.length = 0;
      connection.stopMessage?.();
      connection.stopClose?.();
      connections.delete(connection);
      if (connection.sessionId !== undefined && connection.sessionEpoch !== undefined) {
        sessions.detach(connection.sessionId, connection.sessionEpoch);
      }
    };
    connection.stopMessage = socket.onMessage((raw) => {
      let request: HostedRequest;
      try {
        request = decode_request(raw, maxWireBytes);
      } catch (cause) {
        reject(connection, "LOCUS_PROTOCOL_INVALID", cause instanceof Error ? cause.message : "Malformed hosted protocol message.");
        return;
      }
      if (request.type === "recover") {
        void recover(connection, request).catch((cause: unknown) => {
          connection.recovering = false;
          reject(connection, "LOCUS_RECOVERY_FAILED", cause instanceof Error ? cause.message : "Hosted aggregate recovery failed.", request.id);
        });
      }
      else if (request.type === "subscribe" || request.type === "unsubscribe") subscribe(connection, request);
      else if (request.type === "session-create") session_create(connection, request);
      else if (request.type === "session-attach") session_attach(connection, request);
      else if (request.type === "session-goodbye") session_goodbye(connection, request);
      else if (request.type === "action-status") {
        if (!bind_session(connection, false)) return;
        const status = actionRequests.status(request.clientId, request.requestId);
        send(connection, Object.freeze({
          type: "action-status",
          format: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT,
          id: request.id,
          requestId: request.requestId,
          state: status.state,
          ...(status.outcome === undefined ? {} : { outcome: status.outcome }),
        }));
      }
      else void action(connection, request);
    }) ?? undefined;
    connection.stopClose = socket.onClose(dispose) ?? undefined;
    return dispose;
  }

  return Object.freeze({
    map: options.map,
    logicalMapId: locus.logicalMapId,
    incarnationId: locus.incarnationId,
    registryDigest: registry.digest,
    get rev() { return locus.rev; },
    connect,
    mutate: locus.mutate,
    dispatch_action: locus.dispatch_action,
    dispatch_message,
    sessions: Object.freeze({ debug: sessions.debug, on_change: sessions.on_change, dispose: sessions.dispose }),
    actionRequests: Object.freeze({ debug: actionRequests.debug, dispose: actionRequests.dispose }),
    run_exclusive: locus.run_exclusive,
    debug: () => Object.freeze({
      historyBaseRevision,
      retainedHistoryBytes: retainedBytes,
      retainedCommits: history.length,
      connections: connections.size,
      subscriptions: Object.freeze([...connections].flatMap((connection) =>
        [...connection.subscriptions.values()].map((subscription) => Object.freeze({
          library: subscription.library,
          path: clone_path(subscription.path),
        })))),
      effectiveLiveWireBytes: maxWireBytes,
      effectiveSnapshotWireBytes: HOSTED_MAX_SNAPSHOT_BYTES,
    }),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      stopWire();
      for (const connection of [...connections]) {
        connection.closed = true;
        connection.stopMessage?.();
        connection.stopClose?.();
      }
      connections.clear();
      actionRequests.dispose();
      sessions.dispose();
      locus.dispose();
    },
  });
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
  if (value.type === "subscribe" || value.type === "unsubscribe") {
    exact_keys(value, ["type", "library", "path", "registryDigest"], "Hosted subscription request");
    const library = required_string(value.library);
    const registryDigest = required_digest(value.registryDigest);
    if (library === undefined || registryDigest === undefined || !is_live_path(value.path)) throw new Error("Hosted subscription target is malformed.");
    return Object.freeze({ type: value.type, library, path: clone_path(value.path), registryDigest });
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

type DecodedServerMessage =
  | Readonly<{ type: "error"; id?: string; message: string }>
  | LocusClientActionResult
  | Readonly<{ type: "action-status"; id: string; requestId: string; state: "pending" | "succeeded" | "failed" | "unknown" | "expired"; outcome?: LocusActionTerminalOutcome }>
  | Readonly<{ type: "session-created"; id: string; sessionId: string; credential: string; epoch: number }>
  | Readonly<{ type: "session-attached"; id: string; sessionId: string; epoch: number }>
  | Readonly<{ type: "session-rejected"; id: string; code: string; message: string }>
  | Readonly<{ type: "session-fenced"; sessionId: string; epoch: number; code: "LOCUS_SESSION_ATTACHMENT_FENCED" }>
  | Readonly<{ type: "session-ended"; id: string; sessionId: string; epoch: number }>
  | Readonly<{ type: "recovery-plan"; id: string; logicalMapId: string; incarnationId: string; registryDigest: string; headRev: number; outcome: Exclude<HostedPlanOutcome, "reject">; reason?: HostedSnapshotReason }>
  | Readonly<{ type: "recovery-plan"; id: string; logicalMapId: string; incarnationId: string; registryDigest: string; headRev: number; outcome: "reject"; error: Readonly<{ message: string }> }>
  | Readonly<{ type: "recovery-snapshot"; id: string; snapshot: HostedAggregateSnapshot }>
  | Readonly<{ type: "recovery-commit"; id: string; commit: LocusHostedAggregateWireEnvelope }>
  | Readonly<{ type: "commit"; id: string; commit: LocusHostedAggregateWireEnvelope }>
  | Readonly<{ type: "recovery-caught-up"; id: string; logicalMapId: string; incarnationId: string; registryDigest: string; throughRev: number }>
  | Readonly<{ type: "sync"; registryDigest: string; revision: number; library: string; path: LivePath; value: JsonValue | undefined }>;

function decode_server_message(raw: string): DecodedServerMessage {
  if (typeof raw !== "string" || utf8_bytes(raw) > HOSTED_MAX_SNAPSHOT_BYTES) throw new Error("Hosted aggregate server message exceeds its byte limit.");
  const value = exact_record(JSON.parse(raw), "Hosted aggregate server message");
  if (value.format !== LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT) throw new Error("Hosted aggregate server protocol format is incompatible.");
  if (value.type === "ack"
    || value.type === "action-status"
    || value.type === "session-created"
    || value.type === "session-attached"
    || value.type === "session-rejected"
    || value.type === "session-fenced"
    || value.type === "session-ended"
    || (value.type === "error" && Object.hasOwn(value, "error"))) {
    const standard: Record<string, unknown> = { ...value };
    delete standard.format;
    const decoded = decode_locus_server_message(JSON.stringify(standard));
    if (!decoded.ok) throw new Error(decoded.error.message);
    const message = decoded.value;
    if (message.type === "ack"
      || message.type === "action-status"
      || message.type === "session-created"
      || message.type === "session-attached"
      || message.type === "session-rejected"
      || message.type === "session-fenced"
      || message.type === "session-ended"
      || message.type === "error") return message;
    throw new Error("Hosted aggregate shared Locus response type is malformed.");
  }
  if (value.type === "error") {
    const hasId = Object.hasOwn(value, "id");
    exact_keys(value, hasId ? ["type", "format", "id", "code", "message"] : ["type", "format", "code", "message"], "Hosted aggregate error");
    const message = required_string(value.message);
    if (message === undefined || typeof value.code !== "string" || (hasId && required_string(value.id) === undefined)) throw new Error("Hosted aggregate error is malformed.");
    return Object.freeze({ type: "error", ...(hasId ? { id: value.id as string } : {}), message });
  }
  if (value.type === "recovery-plan") {
    const outcome = value.outcome;
    const isSnapshot = outcome === "snapshot";
    const isReject = outcome === "reject";
    exact_keys(value, isSnapshot
      ? ["type", "format", "id", "logicalMapId", "incarnationId", "registryDigest", "headRev", "outcome", "reason"]
      : isReject
        ? ["type", "format", "id", "logicalMapId", "incarnationId", "registryDigest", "headRev", "outcome", "error"]
        : ["type", "format", "id", "logicalMapId", "incarnationId", "registryDigest", "headRev", "outcome"], "Hosted recovery plan");
    const id = required_string(value.id);
    const logicalMapId = required_string(value.logicalMapId);
    const incarnationId = required_string(value.incarnationId);
    const registryDigest = required_digest(value.registryDigest);
    const headRev = required_revision(value.headRev);
    if (id === undefined || logicalMapId === undefined || incarnationId === undefined || registryDigest === undefined || headRev === undefined) throw new Error("Hosted recovery plan is malformed.");
    if (isReject) {
      const error = exact_record(value.error, "Hosted recovery rejection");
      exact_keys(error, ["code", "message"], "Hosted recovery rejection");
      const message = required_string(error.message);
      if (typeof error.code !== "string" || message === undefined) throw new Error("Hosted recovery rejection is malformed.");
      return Object.freeze({ type: "recovery-plan", id, logicalMapId, incarnationId, registryDigest, headRev, outcome: "reject", error: Object.freeze({ message }) });
    }
    if (outcome !== "current" && outcome !== "replay" && outcome !== "snapshot") throw new Error("Hosted recovery plan outcome is invalid.");
    if (isSnapshot && !is_snapshot_reason(value.reason)) throw new Error("Hosted recovery snapshot reason is invalid.");
    const acceptedOutcome: Exclude<HostedPlanOutcome, "reject"> = outcome;
    return Object.freeze({ type: "recovery-plan", id, logicalMapId, incarnationId, registryDigest, headRev, outcome: acceptedOutcome, ...(isSnapshot ? { reason: value.reason as HostedSnapshotReason } : {}) });
  }
  if (value.type === "recovery-snapshot") {
    exact_keys(value, ["type", "format", "id", "snapshot"], "Hosted recovery snapshot");
    const id = required_string(value.id);
    if (id === undefined) throw new Error("Hosted recovery snapshot is malformed.");
    return Object.freeze({ type: "recovery-snapshot", id, snapshot: value.snapshot as HostedAggregateSnapshot });
  }
  if (value.type === "recovery-commit") {
    exact_keys(value, ["type", "format", "id", "phase", "commit"], "Hosted recovery commit");
    const id = required_string(value.id);
    if (id === undefined || (value.phase !== "body" && value.phase !== "tail")) throw new Error("Hosted recovery commit is malformed.");
    return Object.freeze({ type: "recovery-commit", id, commit: value.commit as LocusHostedAggregateWireEnvelope });
  }
  if (value.type === "commit") {
    exact_keys(value, ["type", "format", "id", "commit"], "Hosted live commit");
    const id = required_string(value.id);
    if (id === undefined) throw new Error("Hosted live commit is malformed.");
    return Object.freeze({ type: "commit", id, commit: value.commit as LocusHostedAggregateWireEnvelope });
  }
  if (value.type === "recovery-caught-up") {
    exact_keys(value, ["type", "format", "id", "logicalMapId", "incarnationId", "registryDigest", "throughRev"], "Hosted recovery caught-up");
    const id = required_string(value.id);
    const logicalMapId = required_string(value.logicalMapId);
    const incarnationId = required_string(value.incarnationId);
    const registryDigest = required_digest(value.registryDigest);
    const throughRev = required_revision(value.throughRev);
    if (id === undefined || logicalMapId === undefined || incarnationId === undefined || registryDigest === undefined || throughRev === undefined) throw new Error("Hosted recovery caught-up is malformed.");
    return Object.freeze({ type: "recovery-caught-up", id, logicalMapId, incarnationId, registryDigest, throughRev });
  }
  if (value.type === "sync") {
    exact_keys(value, ["type", "format", "registryDigest", "revision", "library", "path", "present", "payload"], "Hosted subscription sync");
    const registryDigest = required_digest(value.registryDigest);
    const revision = required_revision(value.revision);
    const library = required_string(value.library);
    if (registryDigest === undefined || revision === undefined || library === undefined || !is_live_path(value.path) || typeof value.present !== "boolean" || typeof value.payload !== "string") throw new Error("Hosted subscription sync is malformed.");
    let decoded: JsonValue | undefined;
    if (value.present) {
      const exact = decode_exact_hson_value(value.payload);
      decoded = is_Node(exact) ? node_to_json_value(exact) : exact;
    } else if (value.payload !== "") {
      throw new Error("Hosted absent subscription sync must not carry a payload.");
    }
    return Object.freeze({ type: "sync", registryDigest, revision, library, path: clone_path(value.path), value: decoded });
  }
  throw new Error("Hosted aggregate server message type is unknown.");
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
    replace(request, index, replacement) { draft.content.replace(target(request), index, replacement); return commit(); },
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
  if (target.kind === "path") return Object.freeze({
    kind: "path" as const,
    path: validate_document_path(target.path),
  });
  const location = aggregate.resolveQuid(target.quid);
  if (location === undefined || location.library !== identity) return undefined;
  return Object.freeze({
    kind: "path" as const,
    path: validate_document_path(location.path),
    witness: Object.freeze({ quid: target.quid }),
  });
}

function exact_sync_value(value: JsonValue | undefined): Readonly<{ present: boolean; payload: string }> {
  if (value === undefined) return Object.freeze({ present: false, payload: "" });
  const exact = value === null || typeof value !== "object" ? value : parse_json(value);
  return Object.freeze({ present: true, payload: encode_exact_hson_value(exact) });
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

function same_json(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  if (left === right) return true;
  if (typeof left !== "object" || left === null || typeof right !== "object" || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((item, index) => same_json(item, right[index]));
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => Object.hasOwn(right, key) && same_json(left[key], right[key]));
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

function is_live_path(value: unknown): value is LivePath {
  return Array.isArray(value) && value.every((part) => typeof part === "string"
    || (typeof part === "number" && Number.isSafeInteger(part) && part >= 0));
}

function clone_path(path: LivePath): LivePath {
  return Object.freeze([...path]);
}

function subscription_key(library: string, path: LivePath): string {
  return `${library}\u0000${JSON.stringify(path)}`;
}

function is_snapshot_reason(value: unknown): value is HostedSnapshotReason {
  return value === "no_usable_revision" || value === "incarnation_mismatch" || value === "registry_mismatch" || value === "history_unavailable";
}
