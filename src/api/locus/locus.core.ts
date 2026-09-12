// locus/core.ts

import type { JsonValue } from "../../core/types.js";
import type { ClassifiedLiveMap, LiveMap, LiveMapAnyOp, LiveMapAuthority, LiveMapCommit } from "../../types/livemap.types.js";
import type {
  Locus,
  LocusActionContext,
  LocusActionOrigin,
  LocusActionPayloads,
  LocusActions,
  LocusClientActionMessage,
  LocusClientMessage,
  LocusClientRecoverMessage,
  LocusClientSessionAttachMessage,
  LocusCanonicalCommit,
  LocusConnection,
  LocusConnectionContext,
  LocusDisposer,
  LocusOptions,
  ProjectedLocusOptions,
  LocusMultiLibrary,
  LocusMultiLibraryOptions,
  LocusMutationDraft,
  LocusSeq,
  LocusServerMessage,
  LocusSessionId,
  LocusSocketLike,
  LocusSnapshotCapabilities,
  LocusSnapshotEncodingSelection,
} from "../../types/locus.types.js";
import { decode_locus_message, encode_locus_message } from "./locus.protocol.js";
import { make_locus_canonical_stream_runtime } from "./locus.history.js";
import { make_classified_livemap } from "../livemap/livemap.core.js";
import { is_public_multi_library_livemap } from "../livemap/livemap.libraries.js";
import { create_multi_library_locus } from "./locus.multi-library.js";
import { parse_json } from "../transform/parsers/parse-json.js";
import {
  make_locus_recovery_planner_internal,
} from "./locus.recovery.js";
import type { LocusDocumentSnapshotEncoding } from "./locus.document-snapshot.js";
import { LocusRecoveryError } from "./locus.error.js";
import { LocusPersistenceError } from "./locus.persistence.error.js";
import {
  make_locus_exclusive_authority,
  LocusAuthorityError,
  type LocusAuthorityEvent,
  type LocusAuthorityGate,
} from "./locus.authority.js";
import type { PreparedLiveMapTransition } from "../livemap/livemap.authority.js";
import { make_locus_session_manager } from "./locus.session.js";
import { make_locus_action_dedupe_store } from "./locus.actions.js";
import {
  admit_locus_solo_external_action,
  execute_locus_action_handler,
  locus_action_public_error_code,
  make_locus_action_response,
  resolve_locus_action_for_execution,
  type LocusSoloActionAuthorityInternals,
  type LocusSoloExternalActionAttempt,
} from "./locus.action-admission.js";
import { decode_locus_schema_value } from "./locus.action-validation.js";
import {
  create_live_trace_context,
  type LocusCommitCausation,
  type LiveTraceContext,
  type LiveTraceSpan,
} from "./locus.trace.js";
import {
  make_locus_activity_controller,
  register_locus_activity_controller,
} from "./locus.activity.js";
import {
  register_locus_remote_action_admission_internal,
  type LocusRemoteActionIngress,
} from "./locus.remote-action.internal.js";
import {
  read_locus_retained_action_status_internal,
  register_locus_retained_action_status_internal,
} from "./locus.action-status.internal.js";
import {
  deliver_locus_downstream_internal,
  inert_locus_semantic_attachment_internal,
  is_locus_synchronization_request_internal,
  register_locus_semantic_attachment_internal,
  type LocusSemanticAttachment,
  type LocusSemanticAttachmentOptions,
} from "./locus.transport.internal.js";

let locus_session_inc = 0;
let locus_trace_inc = 0;
const locusMapAuthorities = new WeakMap<object, object>();
const exclusiveLocusAuthorities = new WeakMap<object, ReturnType<typeof make_locus_exclusive_authority>>();

const DIRECT_ACTION_ORIGIN: LocusActionOrigin = Object.freeze({ kind: "direct" });
const HSON_SNAPSHOT_ENCODING: LocusDocumentSnapshotEncoding = Object.freeze({ format: "hson" });
const VIEW_STATE_SNAPSHOT_ENCODING: LocusDocumentSnapshotEncoding = Object.freeze({ format: "view-state" });

type LocusConnectionRecoveryState =
  | Readonly<{ phase: "awaiting-recovery" }>
  | Readonly<{
    phase: "recovering";
    requestId: string;
    snapshotEncoding: LocusDocumentSnapshotEncoding;
    capabilitySignature: string;
  }>
  | Readonly<{
    phase: "caught-up";
    requestId: string;
    snapshotEncoding: LocusDocumentSnapshotEncoding;
    capabilitySignature: string;
  }>
  | Readonly<{ phase: "failed" }>;

/**
 * Private application boundary for the semantic callbacks supplied to one-map
 * Locus. The authority runtime owns admission, ordering, delivery, and
 * canonical mutation; these callbacks retain application-defined meaning.
 */
type LocusApplicationCallbacks<
  TMap extends LiveMapAuthority,
  TActions extends LocusActionPayloads,
> = Readonly<{
  actions: Partial<LocusActions<TActions, TMap>>;
  authorizeAction: LocusOptions<TMap, TActions>["authorizeAction"];
}>;

class LocusConnectionRecoveryError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "LocusConnectionRecoveryError";
  }
}

function select_snapshot_encoding(
  capabilities: LocusSnapshotCapabilities | undefined,
  documentMode: boolean,
): LocusDocumentSnapshotEncoding {
  return documentMode && capabilities?.viewState === true
    ? VIEW_STATE_SNAPSHOT_ENCODING
    : HSON_SNAPSHOT_ENCODING;
}

function snapshot_capability_signature(capabilities: LocusSnapshotCapabilities | undefined): string {
  return capabilities === undefined
    ? "absent"
    : capabilities.viewState === true ? "hson:view-state" : "hson";
}

function snapshot_encoding_equal(
  left: LocusSnapshotEncodingSelection,
  right: LocusSnapshotEncodingSelection,
): boolean {
  return left.format === right.format;
}

function make_locus_session_id(): LocusSessionId {
  locus_session_inc += 1;
  return `locus-session-${Date.now().toString(36)}-${locus_session_inc.toString(36)}`;
}

function make_locus_trace_id(): string {
  locus_trace_inc += 1;
  return `locus-trace-${Date.now().toString(36)}-${locus_trace_inc.toString(36)}`;
}

function resolve_session_id(option: LocusOptions<LiveMapAuthority>["sessionId"]): LocusSessionId {
  if (typeof option === "function") return option();
  return option ?? make_locus_session_id();
}

function safe_error_code(cause: unknown, fallback: string): string {
  return typeof cause === "object"
    && cause !== null
    && "code" in cause
    && typeof cause.code === "string"
    ? cause.code
    : fallback;
}

export function create_locus<
  TMap extends import("../../types/livemap.types.js").LiveMapLibraries,
  TActions extends LocusActionPayloads = LocusActionPayloads,
>(options: LocusMultiLibraryOptions<TMap, TActions>): LocusMultiLibrary<TMap, TActions>;
export function create_locus<
  TState extends JsonValue | undefined = JsonValue | undefined,
  TActions extends LocusActionPayloads = LocusActionPayloads,
>(options?: ProjectedLocusOptions<TState, TActions>): Locus<LiveMap<TState>, TActions>;
export function create_locus<
  TMap extends LiveMapAuthority,
  TActions extends LocusActionPayloads = LocusActionPayloads,
>(options: LocusOptions<TMap, TActions>): Locus<TMap, TActions>;
export function create_locus(
  input: unknown = {},
): unknown {
  if (typeof input === "object" && input !== null && "persistence" in input) {
    throw new LocusPersistenceError(
      "LOCUS_PERSISTENCE_REQUIRES_EXCLUSIVE",
      "Locus persistence requires the asynchronous persistent-Locus constructor.",
    );
  }
  const options = input as ProjectedLocusOptions | LocusOptions<LiveMapAuthority>;
  if ("map" in options && options.map !== undefined) {
    if (is_public_multi_library_livemap(options.map)) {
      return create_multi_library_locus(options as never);
    }
    if ("state" in options) {
      throw new TypeError("Locus options state and map are mutually exclusive.");
    }
    return create_locus_for_map(options.map, options);
  }
  const stateResult = decode_locus_schema_value(options.schema?.state, options.state ?? {});
  const initialState: JsonValue = (stateResult.ok ? stateResult.value : options.state) ?? {};
  const classified = make_classified_livemap(parse_json(initialState));
  if (classified.mode !== "data-object" && classified.mode !== "data-array") {
    throw new Error(`Locus data state produced unexpected root mode ${classified.mode}.`);
  }
  const map: LiveMap = classified;
  const { state: _state, ...shared } = options;
  return create_locus_for_map(map, { ...shared, map });
}

/** Internal construction seam used by focused gate and failure tests. */
export function create_locus_internal<
  TMap extends LiveMapAuthority,
  TActions extends LocusActionPayloads = LocusActionPayloads,
>(
  options: LocusOptions<TMap, TActions>,
  internal: Readonly<{
    authorityGate?: LocusAuthorityGate<TMap>;
    afterAuthorityGate?: (transition: PreparedLiveMapTransition) => void;
    beforeAcceptedCommitIngestion?: () => void;
    initialHistory?: Readonly<{ baseRevision: number; commits: readonly LocusCanonicalCommit[] }>;
  }> = {},
): Locus<TMap, TActions> {
  return create_locus_for_map(options.map, options, internal);
}

function create_locus_for_map<
  TMap extends LiveMapAuthority,
  TActions extends LocusActionPayloads = LocusActionPayloads,
>(
  map: TMap,
  options: LocusOptions<TMap, TActions>,
  internal: Readonly<{
    authorityGate?: LocusAuthorityGate<TMap>;
    afterAuthorityGate?: (transition: PreparedLiveMapTransition) => void;
    beforeAcceptedCommitIngestion?: () => void;
    initialHistory?: Readonly<{ baseRevision: number; commits: readonly LocusCanonicalCommit[] }>;
  }> = {},
): Locus<TMap, TActions> {
  const locusOwner = Object.freeze({});
  const readonlyMap = map as Locus<TMap, TActions>["map"];
  const activity = make_locus_activity_controller();
  assert_locus_map_available(map);
  const streamRuntime = make_locus_canonical_stream_runtime(map, {
    ...(options.logicalMapId !== undefined ? { logicalMapId: options.logicalMapId } : {}),
    ...(options.incarnationId !== undefined ? { incarnationId: options.incarnationId } : {}),
    ...(options.history !== undefined ? { history: options.history } : {}),
    ...(options.trace !== undefined ? { trace: options.trace } : {}),
  }, {
    observeCommits: false,
    ...(internal.initialHistory !== undefined ? { initialHistory: internal.initialHistory } : {}),
  });
  const stream = streamRuntime.stream;
  const recoveryActivityReleases: LocusDisposer[] = [];
  const recovery = make_locus_recovery_planner_internal(
    map,
    stream,
    options.recovery ?? {},
    options.trace,
    (active) => {
      if (active) recoveryActivityReleases.push(activity.acquire("recovery"));
      else recoveryActivityReleases.pop()?.();
    },
  );
  const sessions = make_locus_session_manager(options.sessions);
  const retainedSessions = new Set<LocusSessionId>();
  const retainedSessionReleases = new Map<LocusSessionId, LocusDisposer>();
  const stopSessionActivity = sessions.on_change((event) => {
    if (event.kind === "attached" && !retainedSessions.has(event.session.sessionId)) {
      retainedSessions.add(event.session.sessionId);
      retainedSessionReleases.set(event.session.sessionId, activity.acquire("session"));
    } else if (
      (event.kind === "expired" || event.kind === "revoked")
      && retainedSessions.delete(event.session.sessionId)
    ) {
      retainedSessionReleases.get(event.session.sessionId)?.();
      retainedSessionReleases.delete(event.session.sessionId);
    }
  });
  // Keep application semantics separate from the one-map runtime mechanics below.
  // Reserved document actions deliberately do not enter this callback boundary.
  const application: LocusApplicationCallbacks<TMap, TActions> = Object.freeze({
    actions: (options.actions ?? {}) as Partial<LocusActions<TActions, TMap>>,
    get authorizeAction() { return options.authorizeAction; },
  });
  let seq = 0;
  const actionRequests = make_locus_action_dedupe_store(
    () => stream.headRev,
    () => seq,
    options.actionDedupe,
  );
  const connections = new Set<LocusDisposer>();
  let disposed = false;
  reserve_locus_map(map, locusOwner);

  function trace_authority_event(event: LocusAuthorityEvent): void {
    if (options.trace === undefined) return;
    const trace = create_live_trace_context(options.trace, make_locus_trace_id());
    trace.emit({
      subsystem: "locus",
      phase: `authority.${event.phase}`,
      status: event.phase === "gate-failed" || event.phase === "failed" || event.phase === "notification-failed"
        ? "failure"
        : event.phase === "enqueued" || event.phase === "prepared" || event.phase === "gate-started"
          ? "event"
          : "success",
      details: () => ({
        logicalMapId: stream.logicalMapId,
        mapMode: map.mode,
        source: event.source,
        queueDepth: event.queueDepth,
        ...(event.baseRevision !== undefined ? { prevRev: event.baseRevision } : {}),
        ...(event.nextRevision !== undefined ? { rev: event.nextRevision } : {}),
        ...(event.changed !== undefined ? { changed: event.changed } : {}),
        ...(event.errorCode !== undefined ? { errorCode: event.errorCode } : {}),
      }),
    });
  }

  let exclusiveAuthority: ReturnType<typeof make_locus_exclusive_authority<TMap, LocusCommitCausation | undefined>>;
  try {
    exclusiveAuthority = make_locus_exclusive_authority<TMap, LocusCommitCausation | undefined>(map, {
      ...(internal.authorityGate !== undefined ? { gate: internal.authorityGate } : {}),
      ...(internal.afterAuthorityGate !== undefined ? { afterGate: internal.afterAuthorityGate } : {}),
      accepted(commit, notificationFailureCount, _source, causation): void {
        internal.beforeAcceptedCommitIngestion?.();
        if (causation !== undefined) streamRuntime.correlateCommit(commit, causation);
        streamRuntime.ingestAccepted(commit);
        if (notificationFailureCount > 0) {
          trace_authority_event({
            phase: "notification-failed",
            source: _source,
            queueDepth: 0,
            baseRevision: commit.prevRev,
            nextRevision: commit.rev,
            changed: true,
          });
        }
      },
      event: trace_authority_event,
      terminal: () => {
        recovery.dispose();
        for (const shutdown of [...connections]) shutdown();
        connections.clear();
      },
      released: () => release_locus_map(map, locusOwner),
    });
  } catch (cause) {
    release_locus_map(map, locusOwner);
    throw cause;
  }

  function next_seq(): LocusSeq {
    seq += 1;
    return seq;
  }

  function make_action_trace(
    message: LocusClientActionMessage<TActions>,
    origin: LocusActionOrigin,
    envelopeAccepted = false,
  ): LiveTraceContext | undefined {
    const sink = options.trace;
    if (sink === undefined) return undefined;
    const trace = create_live_trace_context(sink, make_locus_trace_id());
    trace.emit({
      subsystem: "locus",
      phase: "action.received",
      status: "event",
      details: () => ({
        action: message.name,
        sourceAction: message.name,
        origin: origin.kind,
        retry: message.retry === true,
        logicalMapId: stream.logicalMapId,
        incarnationId: stream.incarnationId,
        mapMode: map.mode,
        ...(message.requestId !== undefined ? { requestId: message.requestId } : {}),
        ...(message.attemptId !== undefined ? { attemptId: message.attemptId } : {}),
      }),
    });
    if (envelopeAccepted) {
      trace.emit({
        subsystem: "transport",
        phase: "action.envelope",
        status: "success",
        details: () => ({ action: message.name }),
      });
    }
    trace.emit({
      subsystem: "locus",
      phase: "session.resolve",
      status: "success",
      details: () => ({
        origin: origin.kind,
        ...(origin.kind === "session" ? { resumable: origin.resumable } : {}),
      }),
    });
    return trace;
  }

  function action_causation(
    message: LocusClientActionMessage<TActions>,
    origin: LocusActionOrigin,
    trace: LiveTraceContext | undefined,
  ): LocusCommitCausation | undefined {
    if (trace === undefined) return undefined;
    return Object.freeze({
      sourceTraceId: trace.traceId,
      ...(message.requestId !== undefined ? { requestId: message.requestId } : {}),
      ...(message.attemptId !== undefined ? { attemptId: message.attemptId } : {}),
      logicalMapId: stream.logicalMapId,
      incarnationId: stream.incarnationId,
      mapMode: map.mode,
      origin: origin.kind,
      sourceAction: message.name,
    });
  }

  function trace_state_boundary(
    trace: LiveTraceContext | undefined,
    parentSpanId: string | undefined,
    previousRev: number,
  ): void {
    if (trace === undefined) return;
    trace.emit({
      subsystem: "livemap",
      phase: "state.transition",
      status: "event",
      ...(parentSpanId !== undefined ? { parentSpanId } : {}),
      details: () => {
        const rev = stream.headRev;
        const commits = rev > previousRev
          ? stream.history.replay_after(previousRev, rev)
          : [];
        const operationKinds = commits?.flatMap((commit) => commit.ops.map((operation) =>
          "domain" in operation ? operation.op : operation.kind));
        return {
          changed: rev !== previousRev,
          ...(rev !== previousRev ? { prevRev: previousRev } : {}),
          rev,
          historyAvailable: commits !== undefined,
          ...(commits !== undefined ? { commitCount: commits.length } : {}),
          ...(operationKinds !== undefined ? { operationCount: operationKinds.length, operationKinds } : {}),
        };
      },
    });
  }

  const actionAuthority: LocusSoloActionAuthorityInternals<TMap, TActions> = Object.freeze({
    map,
    readonlyMap,
    actions: application.actions,
    schema: options.schema,
    get authorizer() { return application.authorizeAction; },
    actionRequests,
    mutations: exclusiveAuthority,
    logicalMapId: stream.logicalMapId,
    incarnationId: stream.incarnationId,
    mapMode: map.mode,
    currentSeq: () => seq,
    nextSeq: next_seq,
    headRev: () => stream.headRev,
    disposed: () => disposed,
    acquireActionActivity: () => activity.acquire("action"),
    traceStateBoundary: trace_state_boundary,
  });

  function admit_external_action(
    attempt: LocusSoloExternalActionAttempt<TActions, TMap>,
  ) {
    return admit_locus_solo_external_action(actionAuthority, attempt);
  }

  async function admit_ephemeral_remote_action(
    ingress: LocusRemoteActionIngress<TActions>,
  ) {
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
    const created = sessions.create(make_locus_session_id(), false, attachment, () => {}, () => 0, connection);
    if (!created.ok) {
      return Object.freeze({
        type: "error" as const,
        id: message.id,
        ...(message.requestId === undefined ? {} : { requestId: message.requestId }),
        ...(message.attemptId === undefined ? {} : { attemptId: message.attemptId }),
        ok: false as const,
        seq,
        completionRev: stream.headRev,
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
    const trace = make_action_trace(message, origin, true);
    const actionSpan = trace?.beginSpan(
      "locus", "action.execute", undefined,
      () => ({ action: message.name, origin: origin.kind }),
    );
    try {
      const admitted = await admit_external_action({
        message,
        origin,
        ...(connection === undefined ? {} : { connection }),
        emitEvent: () => false,
        ...(trace === undefined ? {} : { trace }),
        ...(actionSpan === undefined ? {} : { parentSpanId: actionSpan.spanId }),
        attachmentCurrent: () => live && sessions.is_active(origin.sessionId, origin.epoch),
      });
      const response = admitted.response;
      if (response.type === "ack") {
        actionSpan?.success(() => ({
          action: message.name,
          responseType: response.type,
          ...(admitted.kind === "deduped" ? { delivery: admitted.delivery } : {}),
        }));
      } else {
        actionSpan?.failure(() => ({
          action: message.name,
          responseType: response.type,
          ...(admitted.kind === "deduped" ? { delivery: admitted.delivery } : {}),
          errorCode: response.error.code ?? "LOCUS_ACTION_FAILED",
        }));
      }
      return response;
    } finally {
      live = false;
      sessions.release_ephemeral(origin.sessionId, origin.epoch);
    }
  }

  async function dispatch_action_scoped_internal(
    message: LocusClientActionMessage<TActions>,
    origin: LocusActionOrigin,
    emitEvent: LocusActionContext<TMap>["emit_event"],
    trace?: LiveTraceContext,
  ): Promise<LocusServerMessage> {
    const causation = action_causation(message, origin, trace);
    const actionSpan = trace?.beginSpan(
      "locus",
      "action.execute",
      undefined,
      () => ({ action: message.name, origin: origin.kind }),
    );
    if (disposed) {
      actionSpan?.failure(() => ({ action: message.name, errorCode: "LOCUS_DISPOSED" }));
      return {
        type: "error",
        id: message.id,
        ok: false,
        seq,
        completionRev: stream.headRev,
        error: {
          message: "Locus is disposed.",
          code: "LOCUS_DISPOSED",
        },
      };
    }
    const validated = (() => {
      try {
        return resolve_locus_action_for_execution(actionAuthority, message, trace, actionSpan?.spanId);
      } catch (cause) {
        actionSpan?.failure(() => ({ action: message.name, errorCode: safe_error_code(cause, "LOCUS_SCHEMA_DECODER_FAILED") }));
        throw cause;
      }
    })();
    if (!validated.ok) {
      const code = locus_action_public_error_code(validated.code);
      actionSpan?.failure(() => ({ action: message.name, errorCode: code }));
      return {
        type: "error",
        id: message.id,
        ok: false,
        seq,
        completionRev: stream.headRev,
        error: {
          message: validated.message,
          code,
        },
      };
    }
    const response = make_locus_action_response(
      message.id,
      await execute_locus_action_handler({
        authority: actionAuthority,
        message,
        handler: validated.handler,
        payload: validated.payload,
        origin,
        emitEvent,
        ...(trace !== undefined ? { trace } : {}),
        ...(actionSpan !== undefined ? { parentSpanId: actionSpan.spanId } : {}),
        ...(causation !== undefined ? { causation } : {}),
      }),
    );
    trace?.emit({
      subsystem: "transport",
      phase: "response.created",
      status: response.type === "ack" ? "success" : "failure",
      ...(actionSpan !== undefined ? { parentSpanId: actionSpan.spanId } : {}),
      details: () => ({
        action: message.name,
        responseType: response.type,
        ...(response.type === "error" ? { errorCode: response.error.code ?? "LOCUS_ACTION_FAILED" } : {}),
      }),
    });
    if (response.type === "ack") actionSpan?.success(() => ({ action: message.name, responseType: response.type }));
    else actionSpan?.failure(() => ({ action: message.name, responseType: response.type, errorCode: response.error.code ?? "LOCUS_ACTION_FAILED" }));
    return response;
  }

  async function dispatch_action_scoped(
    message: LocusClientActionMessage<TActions>,
    origin: LocusActionOrigin,
    emitEvent: LocusActionContext<TMap>["emit_event"],
    trace?: LiveTraceContext,
  ): Promise<LocusServerMessage> {
    const release = activity.acquire("action");
    try {
      return await dispatch_action_scoped_internal(message, origin, emitEvent, trace);
    } finally {
      release();
    }
  }

  function dispatch_action(message: LocusClientActionMessage<TActions>): Promise<LocusServerMessage> {
    if (exclusiveAuthority.failed) {
      return Promise.reject(new LocusAuthorityError(
        "LOCUS_AUTHORITY_TERMINAL",
        "Locus authority is terminally failed.",
      ));
    }
    const trace = make_action_trace(message, DIRECT_ACTION_ORIGIN);
    return dispatch_action_scoped(message, DIRECT_ACTION_ORIGIN, () => false, trace);
  }

  function inert_connection(): LocusConnection {
    const disconnect = () => { };
    return Object.assign(disconnect, {
      emit_event(_event: string, _payload: JsonValue): void { },
    });
  }

  function attach_semantic_transport(
    attachmentOptions: LocusSemanticAttachmentOptions,
  ): LocusSemanticAttachment<TActions> {
    if (disposed || exclusiveAuthority.failed) {
      return inert_locus_semantic_attachment_internal(
        stream.logicalMapId,
        stream.incarnationId,
        attachmentOptions.connection?.principalId,
      );
    }
    const releaseConnectionActivity = activity.acquire("connection");
    const connectionContext = attachmentOptions.connection;
    const attachedContext: LocusConnectionContext | undefined = connectionContext === undefined
      ? undefined
      : Object.freeze({
          ...(connectionContext.principalId === undefined
            ? {}
            : { principalId: connectionContext.principalId }),
          ...(Object.prototype.hasOwnProperty.call(connectionContext, "attachment")
            ? { attachment: connectionContext.attachment }
            : {}),
        });
    let transportOpen = true;
    let fenced = false;
    let sessionId: LocusSessionId | undefined;
    let connectionEpoch: number | undefined;
    let sessionResumable: boolean | undefined;
    let stopRecoveryChannel: LocusDisposer | undefined;
    let recoveryState: LocusConnectionRecoveryState = Object.freeze({ phase: "awaiting-recovery" });

    function raw_send(message: LocusServerMessage): void {
      if (transportOpen) deliver_locus_downstream_internal(attachmentOptions.downstream, message);
    }

    function authoritative(): boolean {
      return transportOpen
        && !fenced
        && sessionId !== undefined
        && connectionEpoch !== undefined
        && sessions.is_active(sessionId, connectionEpoch);
    }

    function send_without_record(message: LocusServerMessage): void {
      if (authoritative()) raw_send(message);
    }

    function send(message: LocusServerMessage): void {
      if (!authoritative()) return;
      raw_send(message);
    }

    function dispose_recovery_channel(): void {
      const stop = stopRecoveryChannel;
      stopRecoveryChannel = undefined;
      stop?.();
    }

    function begin_recovery(message: LocusClientRecoverMessage): Readonly<{
      encoding: LocusDocumentSnapshotEncoding;
      acknowledgment?: LocusSnapshotEncodingSelection;
    }> {
      const signature = snapshot_capability_signature(message.snapshotCapabilities);
      const selected = select_snapshot_encoding(
        message.snapshotCapabilities,
        map.mode === "document",
      );
      if (recoveryState.phase === "recovering") {
        if (recoveryState.capabilitySignature !== signature
          || !snapshot_encoding_equal(recoveryState.snapshotEncoding, selected)) {
          throw new LocusRecoveryError(
            "LOCUS_RECOVERY_NEGOTIATION_FAILED",
            "Locus snapshot capabilities cannot change during one connection.",
          );
        }
        throw new LocusConnectionRecoveryError(
          "LOCUS_RECOVERY_IN_PROGRESS",
          "Locus recovery is already in progress on this connection.",
        );
      }
      if (recoveryState.phase === "failed") {
        throw new LocusConnectionRecoveryError(
          "LOCUS_RECOVERY_LIFECYCLE_INVALID",
          "Locus recovery cannot restart on a failed connection.",
        );
      }
      if (recoveryState.phase === "caught-up"
        && (recoveryState.capabilitySignature !== signature
          || !snapshot_encoding_equal(recoveryState.snapshotEncoding, selected))) {
        throw new LocusRecoveryError(
          "LOCUS_RECOVERY_NEGOTIATION_FAILED",
          "Locus snapshot capabilities cannot change during one connection.",
        );
      }
      if (recoveryState.phase === "caught-up" && recoveryState.requestId === message.id) {
        throw new LocusConnectionRecoveryError(
          "LOCUS_RECOVERY_COMPLETED",
          "Locus recovery request is already completed on this connection.",
        );
      }
      const encoding = recoveryState.phase === "caught-up"
        ? recoveryState.snapshotEncoding
        : selected;
      recoveryState = Object.freeze({
        phase: "recovering",
        requestId: message.id,
        snapshotEncoding: encoding,
        capabilitySignature: signature,
      });
      return Object.freeze({
        encoding,
        ...(message.snapshotCapabilities !== undefined
          ? { acknowledgment: encoding }
          : {}),
      });
    }

    function fail_active_recovery(requestId: string): void {
      if (recoveryState.phase === "recovering" && recoveryState.requestId === requestId) {
        recoveryState = Object.freeze({ phase: "failed" });
      }
    }

    function send_recovery(message: LocusServerMessage, requestId: string): void {
      if (recoveryState.phase !== "recovering"
        || recoveryState.requestId !== requestId
        || !authoritative()) {
        throw new LocusConnectionRecoveryError(
          "LOCUS_RECOVERY_INTERRUPTED",
          "Locus recovery was interrupted before completion.",
        );
      }
      raw_send(message);
      if (recoveryState.phase !== "recovering"
        || recoveryState.requestId !== requestId
        || !authoritative()) {
        throw new LocusConnectionRecoveryError(
          "LOCUS_RECOVERY_INTERRUPTED",
          "Locus recovery was interrupted before completion.",
        );
      }
    }

    function fence_attachment(fencedSessionId: LocusSessionId, epoch: number): void {
      if (sessionId !== fencedSessionId || connectionEpoch !== epoch || fenced) return;
      raw_send({ type: "session-fenced", sessionId: fencedSessionId, epoch, code: "LOCUS_SESSION_ATTACHMENT_FENCED" });
      fenced = true;
      recoveryState = Object.freeze({ phase: "failed" });
      dispose_recovery_channel();
    }

    const sessionAttachment = Object.freeze({ fence: fence_attachment });

    function bind_new_session(resumable: boolean): boolean {
      if (sessionId !== undefined) return authoritative();
      const id = resolve_session_id(options.sessionId);
      const created = sessions.create(
        id,
        resumable,
        sessionAttachment,
        () => {},
        () => 0,
        attachedContext,
      );
      if (!created.ok) {
        return false;
      }
      sessionId = created.value.sessionId;
      connectionEpoch = created.value.epoch;
      sessionResumable = created.value.resumable;
      return true;
    }

    function emit_connection_event(event: string, payload: JsonValue): boolean {
      if (sessionId === undefined && !bind_new_session(false)) return false;
      if (!authoritative()) return false;
      send_without_record({ type: "event", event, payload });
      return true;
    }

    function reject_session(id: string, code: Extract<LocusServerMessage, { type: "session-rejected" }>["code"], message: string): void {
      raw_send({ type: "session-rejected", id, code, message });
    }

    function create_resumable_session(id: string): void {
      if (sessionId !== undefined) {
        reject_session(id, "LOCUS_SESSION_NOT_ATTACHED", "This transport already owns a Locus session.");
        return;
      }
      const nextSessionId = resolve_session_id(options.sessionId);
      const created = sessions.create(
        nextSessionId,
        true,
        sessionAttachment,
        () => {},
        () => 0,
        attachedContext,
      );
      if (!created.ok || !created.value.credential) {
        reject_session(id, "LOCUS_SESSION_NOT_ATTACHED", "Locus could not create a resumable session.");
        return;
      }
      sessionId = created.value.sessionId;
      connectionEpoch = created.value.epoch;
      sessionResumable = created.value.resumable;
      raw_send({
        type: "session-created",
        id,
        sessionId,
        credential: created.value.credential,
        epoch: connectionEpoch,
        logicalMapId: stream.logicalMapId,
        incarnationId: stream.incarnationId,
      });
    }

    function reattach_session(message: LocusClientSessionAttachMessage): void {
      if (sessionId !== undefined) {
        reject_session(message.id, "LOCUS_SESSION_NOT_ATTACHED", "This transport already owns a Locus session.");
        return;
      }
      const attached = sessions.reattach(message.credential, sessionAttachment, attachedContext);
      if (!attached.ok) {
        reject_session(
          message.id,
          (attached.error.code ?? "LOCUS_SESSION_CREDENTIAL_UNKNOWN") as Extract<LocusServerMessage, { type: "session-rejected" }>["code"],
          attached.error.message,
        );
        return;
      }
      sessionId = attached.value.sessionId;
      connectionEpoch = attached.value.epoch;
      sessionResumable = attached.value.resumable;
      raw_send({
        type: "session-attached",
        id: message.id,
        sessionId,
        epoch: connectionEpoch,
        logicalMapId: stream.logicalMapId,
        incarnationId: stream.incarnationId,
      });
    }

    function recovery_error(id: string, cause: unknown, trace?: LiveTraceContext, startedAt?: number): void {
      const code = typeof cause === "object" && cause !== null && "code" in cause && typeof cause.code === "string"
        ? cause.code
        : "LOCUS_RECOVERY_TRANSPORT_FAILED";
      const message = cause instanceof Error ? cause.message : "Locus recovery transport failed.";
      trace?.emit({
        subsystem: "transport",
        phase: "recovery.transport",
        status: "failure",
        details: () => ({ requestId: id, outcome: "send-failed", errorCode: code }),
      });
      trace?.emit({
        subsystem: "locus",
        phase: "recovery.complete",
        status: "failure",
        ...(startedAt !== undefined ? { durationMs: Math.max(0, Date.now() - startedAt) } : {}),
        details: () => ({ requestId: id, outcome: "failed", errorCode: code }),
      });
      try {
        send_without_record({ type: "recovery-error", id, error: { code, message } });
      } catch {
        // The recovery trace already owns the transport failure.
      }
    }

    async function handle_deduped_action(
      message: LocusClientActionMessage<TActions>,
      origin: Extract<LocusActionOrigin, { kind: "session" }>,
      trace?: LiveTraceContext,
    ): Promise<void> {
      const actionSpan = trace?.beginSpan(
        "locus",
        "action.execute",
        undefined,
        () => ({ action: message.name, origin: origin.kind }),
      );
      let admitted;
      try {
        admitted = await admit_external_action({
          message,
          origin,
          ...(attachedContext === undefined ? {} : { connection: attachedContext }),
          emitEvent: emit_connection_event,
          ...(trace === undefined ? {} : { trace }),
          ...(actionSpan === undefined ? {} : { parentSpanId: actionSpan.spanId }),
          attachmentCurrent: authoritative,
        });
      } catch (cause) {
        actionSpan?.failure(() => ({
          action: message.name,
          errorCode: safe_error_code(cause, "LOCUS_SCHEMA_DECODER_FAILED"),
        }));
        throw cause;
      }

      const response = admitted.response;
      const stableIdentity = message.requestId !== undefined && message.clientId !== undefined;
      if (!stableIdentity) {
        trace?.emit({
          subsystem: "transport",
          phase: "response.created",
          status: response.type === "ack" ? "success" : "failure",
          ...(actionSpan !== undefined ? { parentSpanId: actionSpan.spanId } : {}),
          details: () => ({
            action: message.name,
            responseType: response.type,
            ...(response.type === "error" ? { errorCode: response.error.code ?? "LOCUS_ACTION_FAILED" } : {}),
          }),
        });
        if (response.type === "ack") {
          actionSpan?.success(() => ({ action: message.name, responseType: response.type }));
        } else {
          actionSpan?.failure(() => ({
            action: message.name,
            responseType: response.type,
            errorCode: response.error.code ?? "LOCUS_ACTION_FAILED",
          }));
        }
      }

      send(response);
      trace?.emit({
        subsystem: "transport",
        phase: "response.dispatch",
        status: response.type === "ack" ? "success" : "failure",
        ...(stableIdentity && actionSpan !== undefined ? { parentSpanId: actionSpan.spanId } : {}),
        details: () => ({
          action: message.name,
          responseType: response.type,
          ...(admitted.kind === "deduped" ? { delivery: admitted.delivery } : {}),
          ...(response.type === "error" ? { errorCode: response.error.code ?? "LOCUS_ACTION_FAILED" } : {}),
        }),
      });

      if (stableIdentity) {
        if (response.type === "ack") {
          actionSpan?.success(() => ({ action: message.name, responseType: response.type, ...(admitted.kind === "deduped" ? { delivery: admitted.delivery } : {}) }));
        } else {
          actionSpan?.failure(() => ({
            action: message.name,
            responseType: response.type,
            ...(admitted.kind === "deduped" ? { delivery: admitted.delivery } : {}),
            errorCode: response.error.code ?? "LOCUS_ACTION_FAILED",
          }));
        }
      }
    }

    function handle_recover(message: LocusClientRecoverMessage): void {
      if (!sessionId || connectionEpoch === undefined || !authoritative()) return;
      const startedAt = Date.now();
      const trace = options.trace === undefined
        ? undefined
        : create_live_trace_context(options.trace, `locus-recovery-${message.id}-${stream.headRev}`);
      const history = stream.history.debug();
      trace?.emit({
        subsystem: "locus",
        phase: "recovery.request",
        status: "event",
        details: () => ({
          requestId: message.id,
          logicalMapId: stream.logicalMapId,
          incarnationId: stream.incarnationId,
          mapMode: map.mode,
          origin: "protocol-request",
          reason: "explicit-recover",
          ...(message.lastAppliedRev !== undefined ? { requestedRev: message.lastAppliedRev } : {}),
          currentRev: stream.headRev,
          oldestAvailableRev: history.earliestResumableBaseRev,
        }),
      });
      let plan;
      let negotiation;
      try {
        negotiation = begin_recovery(message);
        dispose_recovery_channel();
        const request = {
          logicalMapId: message.logicalMapId,
          ...(message.incarnationId !== undefined ? { incarnationId: message.incarnationId } : {}),
          ...(message.lastAppliedRev !== undefined ? { lastAppliedRev: message.lastAppliedRev } : {}),
        };
        plan = trace === undefined
          ? recovery.plan_with_snapshot_encoding(request, negotiation.encoding)
          : recovery.plan_traced_with_snapshot_encoding(
            request,
            negotiation.encoding,
            trace,
            { requestId: message.id },
          );
        const snapshotEncoding = negotiation.acknowledgment;
        if (plan.outcome === "reject") {
          send_recovery({
            type: "recovery-plan",
            id: message.id,
            sessionId,
            logicalMapId: stream.logicalMapId,
            incarnationId: stream.incarnationId,
            headRev: stream.headRev,
            outcome: "reject",
            error: plan.error,
            ...(snapshotEncoding ? { snapshotEncoding } : {}),
          }, message.id);
        }
      } catch (cause) {
        fail_active_recovery(message.id);
        recovery_error(message.id, cause, trace, startedAt);
        return;
      }
      if (plan.outcome === "reject") {
        fail_active_recovery(message.id);
        try {
          trace?.emit({
            subsystem: "transport",
            phase: "recovery.transport",
            status: "success",
            details: () => ({ requestId: message.id, strategy: "rejected", messageCount: 1, commitCount: 0, snapshotPresent: false, outcome: "sent" }),
          });
          trace?.emit({
            subsystem: "locus",
            phase: "recovery.complete",
            status: "failure",
            durationMs: Math.max(0, Date.now() - startedAt),
            details: () => ({ requestId: message.id, strategy: "rejected", targetRev: stream.headRev, outcome: "failed", errorCode: plan.error.code }),
          });
        } catch (cause) {
          recovery_error(message.id, cause, trace, startedAt);
        }
        return;
      }
      let channelActive = true;
      let liveReady = false;
      const pendingLive: LocusCanonicalCommit[] = [];
      let stopLive: LocusDisposer = () => { };
      stopRecoveryChannel = () => {
        if (!channelActive) return;
        channelActive = false;
        plan.dispose();
        stopLive();
        pendingLive.length = 0;
      };
      try {
        const snapshotEncoding = negotiation.acknowledgment;
        const base = {
          type: "recovery-plan" as const,
          id: message.id,
          sessionId,
          logicalMapId: plan.logicalMapId,
          incarnationId: plan.incarnationId,
          headRev: plan.headRev,
          ...(snapshotEncoding ? { snapshotEncoding } : {}),
        };
        if (plan.outcome === "snapshot") send_recovery({ ...base, outcome: "snapshot", reason: plan.reason }, message.id);
        else send_recovery({ ...base, outcome: plan.outcome }, message.id);
        const completion = plan.complete((item) => {
          if (item.kind === "snapshot") send_recovery({ type: "recovery-snapshot", id: message.id, snapshot: item.snapshot }, message.id);
          else send_recovery({ type: "recovery-commit", id: message.id, phase: "body", commit: item.commit }, message.id);
        });
        stopLive = stream.on_commit((commit) => {
          if (!channelActive || !authoritative()) return;
          if (!liveReady) pendingLive.push(commit);
          else send_without_record({ type: "commit", id: message.id, commit });
        });
        for (const commit of completion.tail) {
          send_recovery({ type: "recovery-commit", id: message.id, phase: "tail", commit }, message.id);
        }
        send_recovery({ type: "recovery-caught-up", id: message.id, caughtUp: completion.caughtUp }, message.id);
        recoveryState = Object.freeze({
          phase: "caught-up",
          requestId: message.id,
          snapshotEncoding: negotiation.encoding,
          capabilitySignature: snapshot_capability_signature(message.snapshotCapabilities),
        });
        while (pendingLive.length) {
          const commit = pendingLive.shift();
          if (commit) send_without_record({ type: "commit", id: message.id, commit });
        }
        liveReady = true;
        const bodyCommitCount = plan.outcome === "replay" ? plan.body.length : 0;
        const bodyMessageCount = plan.outcome === "current" ? 0 : plan.outcome === "replay" ? plan.body.length : 1;
        const strategy = plan.outcome === "current"
          ? "already-current"
          : plan.outcome === "replay"
            ? "incremental-replay"
            : completion.tail.length > 0 ? "snapshot-plus-tail" : "snapshot";
        trace?.emit({
          subsystem: "transport",
          phase: "recovery.transport",
          status: "success",
          details: () => ({
            requestId: message.id,
            strategy,
            ...(message.lastAppliedRev !== undefined ? { requestedRev: message.lastAppliedRev } : {}),
            targetRev: completion.caughtUp.throughRev,
            messageCount: 2 + bodyMessageCount + completion.tail.length,
            commitCount: bodyCommitCount + completion.tail.length,
            snapshotPresent: plan.outcome === "snapshot",
            outcome: "sent",
          }),
        });
        trace?.emit({
          subsystem: "locus",
          phase: "recovery.complete",
          status: "success",
          durationMs: Math.max(0, Date.now() - startedAt),
          details: () => ({
            requestId: message.id,
            strategy,
            targetRev: completion.caughtUp.throughRev,
            snapshotFormat: negotiation.encoding.format,
            outcome: "synchronized",
          }),
        });
      } catch (cause) {
        dispose_recovery_channel();
        fail_active_recovery(message.id);
        recovery_error(message.id, cause, trace, startedAt);
      }
    }

    async function handle_message(message: LocusClientMessage<TActions>): Promise<void> {
      if (message.type === "session-create") {
        if (!fenced) create_resumable_session(message.id);
        return;
      }
      if (message.type === "session-attach") {
        if (!fenced) reattach_session(message);
        return;
      }
      if (sessionId === undefined && !bind_new_session(false)) return;
      if (!authoritative() || !sessionId || connectionEpoch === undefined) return;

      if (message.type === "session-goodbye") {
        const endedSessionId = sessionId;
        const endedEpoch = connectionEpoch;
        const ended = sessions.goodbye(endedSessionId, endedEpoch);
        if (!ended.ok) {
          reject_session(message.id, (ended.error.code ?? "LOCUS_SESSION_ALREADY_GONE") as Extract<LocusServerMessage, { type: "session-rejected" }>["code"], ended.error.message);
          return;
        }
        dispose_recovery_channel();
        raw_send({ type: "session-ended", id: message.id, sessionId: endedSessionId, epoch: endedEpoch });
        fenced = true;
        return;
      }
      if (message.type === "recover") {
        handle_recover(message);
        return;
      }
      if (message.type === "action-status") {
        const status = read_locus_retained_action_status_internal(locus, {
          clientId: message.clientId,
          requestId: message.requestId,
          ...(attachedContext === undefined ? {} : { connection: attachedContext }),
        });
        if (!status.ok) {
          reject_session(message.id, status.code, status.message);
          return;
        }
        send({
          type: "action-status",
          id: message.id,
          requestId: message.requestId,
          state: status.state,
          ...(status.outcome ? { outcome: status.outcome } : {}),
        });
        return;
      }
      if (message.type === "action") {
        const capturedSessionId = sessionId;
        const capturedEpoch = connectionEpoch;
        const origin: LocusActionOrigin = Object.freeze({
          kind: "session",
          sessionId: capturedSessionId,
          epoch: capturedEpoch,
          resumable: sessionResumable === true,
        });
        const trace = make_action_trace(message, origin, true);
        await handle_deduped_action(message, origin, trace);
        if (!sessions.is_active(capturedSessionId, capturedEpoch)) return;
        return;
      }
    }

    function detach_transport(hostShutdown = false): void {
      if (!transportOpen) return;
      transportOpen = false;
      releaseConnectionActivity();
      recoveryState = Object.freeze({ phase: "awaiting-recovery" });
      dispose_recovery_channel();
      if (!hostShutdown && sessionId && connectionEpoch !== undefined && sessions.is_active(sessionId, connectionEpoch)) {
        sessions.detach(sessionId, connectionEpoch);
      }
      connections.delete(shutdown_for_host);
      attachmentOptions.onClose?.();
    }

    function shutdown_for_host(): void {
      detach_transport(true);
    }

    const binding = Object.freeze({
      principalId: attachedContext?.principalId,
      logicalMapId: stream.logicalMapId,
      incarnationId: stream.incarnationId,
      get sessionId() { return sessionId; },
      get attachmentEpoch() { return connectionEpoch; },
      get attached() { return authoritative(); },
    });
    const semanticAttachment: LocusSemanticAttachment<TActions> = Object.freeze({
      binding,
      operations: Object.freeze({
        submit(message: import("./locus.transport.internal.js").LocusFiniteOperationRequest<TActions>) {
          return handle_message(message);
        },
      }),
      synchronization: Object.freeze({
        begin(message: LocusClientRecoverMessage) { void handle_message(message); },
        cancel: dispose_recovery_channel,
      }),
      emit_event(event, payload) { emit_connection_event(event, payload); },
      close: detach_transport,
    });
    connections.add(shutdown_for_host);
    return semanticAttachment;
  }

  function connect(socket: LocusSocketLike, connectionContext?: LocusConnectionContext): LocusConnection {
    if (disposed || exclusiveAuthority.failed) return inert_connection();
    let stopMessage: LocusDisposer | void;
    let stopClose: LocusDisposer | void;
    let listenersOpen = true;
    const stopListeners = (): void => {
      if (!listenersOpen) return;
      listenersOpen = false;
      stopMessage?.();
      stopClose?.();
    };
    const send = (message: LocusServerMessage): void => socket.send(encode_locus_message(message));
    const attachment = attach_semantic_transport({
      downstream: Object.freeze({
        finite: send,
        synchronization: send,
        publication: send,
        event: send,
      }),
      ...(connectionContext === undefined ? {} : { connection: connectionContext }),
      onClose: stopListeners,
    });
    try {
      stopMessage = socket.onMessage((raw) => {
        const decoded = decode_locus_message<TActions>(raw);
        if (!decoded.ok) {
          if (attachment.binding.sessionId === undefined || attachment.binding.attached) {
            send({ type: "error", seq, error: decoded.error });
          }
          return;
        }
        if (is_locus_synchronization_request_internal(decoded.value)) {
          attachment.synchronization.begin(decoded.value);
        } else {
          void attachment.operations.submit(decoded.value);
        }
      });
      stopClose = socket.onClose(() => attachment.close());
    } catch (error) {
      attachment.close();
      throw error;
    }
    const disconnect = () => attachment.close();
    return Object.assign(disconnect, {
      emit_event(event: string, payload: JsonValue): void { attachment.emit_event(event, payload); },
    });
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    for (const shutdown of [...connections]) shutdown();
    connections.clear();
    stopSessionActivity();
    sessions.dispose();
    for (const release of retainedSessionReleases.values()) release();
    retainedSessionReleases.clear();
    retainedSessions.clear();
    recovery.dispose();
    actionRequests.dispose();
    exclusiveAuthority.dispose();
    activity.dispose();
  }

  const locus = {
    map: readonlyMap,
    stream,
    activity: activity.public,
    recovery,
    sessions: Object.freeze({ debug: sessions.debug, on_change: sessions.on_change, dispose: sessions.dispose }),
    actionRequests: Object.freeze({ debug: actionRequests.debug, dispose: actionRequests.dispose }),
    get seq() { return seq; },
    schema: options.schema,
    dispatch_action,
    connect,
    dispose,
    mutate: async (mutation: (draft: LocusMutationDraft<TMap>) => LiveMapCommit<LiveMapAnyOp>) => {
      const release = activity.acquire("mutation");
      try {
        return await exclusiveAuthority.mutate(
          mutation as unknown as (draft: TMap) => LiveMapCommit<LiveMapAnyOp>,
          "locus",
        );
      } finally {
        release();
      }
    },
  };
  register_locus_activity_controller(locus, activity);
  register_locus_remote_action_admission_internal(
    locus,
    (ingress) => admit_ephemeral_remote_action(ingress as LocusRemoteActionIngress<TActions>),
  );
  register_locus_retained_action_status_internal(locus, (ingress) => {
    if (disposed) throw new Error("Locus retained action status authority is unavailable.");
    return actionRequests.status(
      ingress.clientId,
      ingress.requestId,
      ingress.connection?.principalId,
    );
  });
  register_locus_semantic_attachment_internal(locus, attach_semantic_transport);
  exclusiveLocusAuthorities.set(locus, exclusiveAuthority as ReturnType<typeof make_locus_exclusive_authority>);
  return locus;
}

/** @internal Run a non-mutation barrier in one exclusive Locus FIFO. */
export function run_locus_exclusive_task<TResult>(
  locus: object,
  operation: () => TResult | Promise<TResult>,
): Promise<TResult> {
  const authority = exclusiveLocusAuthorities.get(locus);
  if (authority === undefined) {
    return Promise.reject(new LocusAuthorityError(
      "LOCUS_AUTHORITY_CLOSED",
      "Locus does not expose ordered authority.",
    ));
  }
  return authority.runExclusive(operation);
}

/** @internal Wait until exclusive Locus management has been safely released. */
export function wait_locus_exclusive_closed(locus: object): Promise<void> {
  return exclusiveLocusAuthorities.get(locus)?.closed ?? Promise.resolve();
}

function reserve_locus_map(map: object, owner: object): void {
  if (locusMapAuthorities.has(map)) {
    throw new LocusAuthorityError(
      "LOCUS_AUTHORITY_ALREADY_MANAGED",
      "LiveMap already belongs to another Locus authority.",
    );
  }
  locusMapAuthorities.set(map, owner);
}

function assert_locus_map_available(map: object): void {
  if (locusMapAuthorities.has(map)) {
    throw new LocusAuthorityError(
      "LOCUS_AUTHORITY_ALREADY_MANAGED",
      "LiveMap already belongs to another Locus authority.",
    );
  }
}

function release_locus_map(map: object, owner: object): void {
  if (locusMapAuthorities.get(map) === owner) locusMapAuthorities.delete(map);
}
