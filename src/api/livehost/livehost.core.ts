// livehost/core.ts

import { hson } from "../../hson.js";
import type { ClassifiedLiveMap, JsonValue, LiveMap, LiveMapAnyOp, LiveMapAuthority, LiveMapCommit } from "../../types/index.js";
import type {
  LiveHost,
  LiveHostForMap,
  LiveHostActionContextForMap,
  LiveHostActionAuthorizationContext,
  LiveHostActionDelivery,
  LiveHostActionOrigin,
  LiveHostActionPayloads,
  LiveHostActionTerminalOutcome,
  LiveHostActionsForMap,
  LiveHostClientActionMessage,
  LiveHostClientActionResult,
  LiveHostClientRecoverMessage,
  LiveHostClientSessionAttachMessage,
  LiveHostCanonicalCommit,
  LiveHostConnection,
  LiveHostDisposer,
  LiveHostOptions,
  ExistingMapLiveHostOptions,
  ExclusiveExistingMapLiveHostOptions,
  ExclusiveLiveHostForMap,
  ExclusiveProjectedLiveHostOptions,
  ProjectedLiveHostOptions,
  LiveHostMapValue,
  LiveHostSchemaDecoder,
  LiveHostSchemaResult,
  LiveHostSeq,
  LiveHostServerMessage,
  LiveHostSessionId,
  LiveHostSocketLike,
  LiveHostSnapshotCapabilities,
  LiveHostSnapshotEncodingSelection,
  LiveHostValidator,
} from "../../types/livehost.types.js";
import { decode_livehost_message, encode_livehost_message, is_livehost_json_value } from "./livehost.protocol.js";
import { make_livehost_resume_log } from "./livehost.resume.js";
import { make_livehost_sync_manager } from "./livehost.sync.js";
import { make_livehost_canonical_stream_runtime } from "./livehost.history.js";
import {
  make_livehost_recovery_planner_internal,
} from "./livehost.recovery.js";
import type { LiveHostDocumentSnapshotEncoding } from "./livehost.document-snapshot.js";
import { LiveHostRecoveryError } from "./livehost.error.js";
import { LiveHostPersistenceError } from "./livehost.persistence.error.js";
import {
  make_livehost_exclusive_authority,
  LiveHostAuthorityError,
  type LiveHostAuthorityEvent,
  type LiveHostAuthorityGate,
} from "./livehost.authority.js";
import { make_livehost_session_manager } from "./livehost.session.js";
import { make_livehost_action_dedupe_store } from "./livehost.actions.js";
import { resolve_livehost_document_action } from "./livehost.document-actions.js";
import {
  create_live_trace_context,
  type LiveHostCommitCausation,
  type LiveTraceContext,
  type LiveTraceSpan,
} from "./livehost.trace.js";

let livehost_session_inc = 0;
let livehost_trace_inc = 0;
const hostedMapAuthorities = new WeakMap<object, Readonly<{ shared: number; exclusive?: object }>>();
const exclusiveHostAuthorities = new WeakMap<object, ReturnType<typeof make_livehost_exclusive_authority>>();

const DIRECT_ACTION_ORIGIN: LiveHostActionOrigin = Object.freeze({ kind: "direct" });
const HSON_SNAPSHOT_ENCODING: LiveHostDocumentSnapshotEncoding = Object.freeze({ format: "hson" });
const VIEW_STATE_V1_SNAPSHOT_ENCODING: LiveHostDocumentSnapshotEncoding = Object.freeze({
  format: "view-state",
  formatVersion: 1,
});

type LiveHostConnectionRecoveryState =
  | Readonly<{ phase: "awaiting-recovery" }>
  | Readonly<{
    phase: "recovering";
    requestId: string;
    snapshotEncoding: LiveHostDocumentSnapshotEncoding;
    capabilitySignature: string;
  }>
  | Readonly<{
    phase: "caught-up";
    requestId: string;
    snapshotEncoding: LiveHostDocumentSnapshotEncoding;
    capabilitySignature: string;
  }>
  | Readonly<{ phase: "failed" }>;

class LiveHostConnectionRecoveryError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "LiveHostConnectionRecoveryError";
  }
}

function select_snapshot_encoding(
  capabilities: LiveHostSnapshotCapabilities | undefined,
  documentMode: boolean,
): LiveHostDocumentSnapshotEncoding {
  return documentMode && capabilities?.viewStateVersions?.includes(1) === true
    ? VIEW_STATE_V1_SNAPSHOT_ENCODING
    : HSON_SNAPSHOT_ENCODING;
}

function snapshot_capability_signature(capabilities: LiveHostSnapshotCapabilities | undefined): string {
  return capabilities === undefined
    ? "absent"
    : `hson:${capabilities.viewStateVersions?.join(",") ?? ""}`;
}

function snapshot_encoding_equal(
  left: LiveHostSnapshotEncodingSelection,
  right: LiveHostSnapshotEncodingSelection,
): boolean {
  return left.format === right.format
    && (left.format !== "view-state"
      || (right.format === "view-state" && left.formatVersion === right.formatVersion));
}

function make_livehost_session_id(): LiveHostSessionId {
  livehost_session_inc += 1;
  return `lhs-${Date.now().toString(36)}-${livehost_session_inc.toString(36)}`;
}

function make_livehost_trace_id(): string {
  livehost_trace_inc += 1;
  return `lht-${Date.now().toString(36)}-${livehost_trace_inc.toString(36)}`;
}

function resolve_session_id(option: LiveHostOptions["sessionId"]): LiveHostSessionId {
  if (typeof option === "function") return option();
  return option ?? make_livehost_session_id();
}

function is_schema_result<TValue>(value: unknown): value is LiveHostSchemaResult<TValue> {
  return typeof value === "object"
    && value !== null
    && "ok" in value
    && typeof (value as { ok?: unknown }).ok === "boolean";
}

function decode_with_schema<TValue>(
  schema: LiveHostValidator<TValue> | LiveHostSchemaDecoder<TValue> | undefined,
  value: unknown,
): LiveHostSchemaResult<TValue> {
  if (!schema) return { ok: true, value: value as TValue };

  const result = schema(value);
  if (is_schema_result<TValue>(result)) return result;
  if (result === true) return { ok: true, value: value as TValue };

  return {
    ok: false,
    issues: ["Value failed LiveHost schema validation."],
  };
}

function schema_error_message(issues: readonly string[]): string {
  return issues.length ? issues.join("; ") : "Value failed LiveHost schema validation.";
}

function safe_error_code(cause: unknown, fallback: string): string {
  return typeof cause === "object"
    && cause !== null
    && "code" in cause
    && typeof cause.code === "string"
    ? cause.code
    : fallback;
}

function clone_action_value(value: JsonValue, frozen: boolean): JsonValue {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    const clone: JsonValue[] = value.map((item) => clone_action_value(item, frozen));
    if (frozen) Object.freeze(clone);
    return clone;
  }
  const clone: Record<string, JsonValue> = {};
  for (const key of Object.keys(value)) clone[key] = clone_action_value(value[key], frozen);
  return frozen ? Object.freeze(clone) : clone;
}

function clone_action_payload(value: JsonValue | undefined, frozen: boolean): JsonValue | undefined {
  return value === undefined ? undefined : clone_action_value(value, frozen);
}

export function create_livehost<
  TState extends JsonValue | undefined = JsonValue | undefined,
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
>(options: ExclusiveProjectedLiveHostOptions<TState, TActions>): ExclusiveLiveHostForMap<LiveMap<TState>, TActions>;
export function create_livehost<
  TMap extends LiveMapAuthority,
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
>(options: ExclusiveExistingMapLiveHostOptions<TMap, TActions>): ExclusiveLiveHostForMap<TMap, TActions>;
export function create_livehost<
  TState extends JsonValue | undefined = JsonValue | undefined,
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
>(options?: ProjectedLiveHostOptions<TState, TActions>): LiveHost<TState, TActions>;
export function create_livehost<
  TMap extends LiveMapAuthority,
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
>(options: ExistingMapLiveHostOptions<TMap, TActions>): LiveHostForMap<TMap, TActions>;
export function create_livehost(
  input: unknown = {},
): LiveHostForMap<LiveMapAuthority> | ExclusiveLiveHostForMap<LiveMapAuthority> {
  if (typeof input === "object" && input !== null && "persistence" in input) {
    throw new LiveHostPersistenceError(
      "LIVEHOST_PERSISTENCE_REQUIRES_EXCLUSIVE",
      "LiveHost persistence requires the asynchronous exclusive-host constructor.",
    );
  }
  const options = input as ProjectedLiveHostOptions
    | ExclusiveProjectedLiveHostOptions
    | ExistingMapLiveHostOptions<LiveMapAuthority>
    | ExclusiveExistingMapLiveHostOptions<LiveMapAuthority>;
  if ("map" in options && options.map !== undefined) {
    if ("state" in options) {
      throw new TypeError("LiveHost options state and map are mutually exclusive.");
    }
    return create_livehost_for_map(options.map, options);
  }
  const stateResult = decode_with_schema(options.schema?.state, options.state ?? {});
  const initialState: JsonValue = (stateResult.ok ? stateResult.value : options.state) ?? {};
  const map = hson.liveMap.fromJson(initialState);
  const { state: _state, ...shared } = options;
  return create_livehost_for_map(map, { ...shared, map });
}

/** Internal construction seam used by focused gate and failure tests. */
export function create_livehost_internal<
  TMap extends LiveMapAuthority,
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
>(
  options: ExistingMapLiveHostOptions<TMap, TActions> | ExclusiveExistingMapLiveHostOptions<TMap, TActions>,
  internal: Readonly<{
    authorityGate?: LiveHostAuthorityGate<TMap>;
    beforeAcceptedCommitIngestion?: () => void;
    initialHistory?: Readonly<{ baseRevision: number; commits: readonly LiveHostCanonicalCommit[] }>;
  }> = {},
): LiveHostForMap<TMap, TActions> | ExclusiveLiveHostForMap<TMap, TActions> {
  return create_livehost_for_map(options.map, options, internal);
}

function create_livehost_for_map<
  TMap extends LiveMapAuthority,
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
>(
  map: TMap,
  options: ExistingMapLiveHostOptions<TMap, TActions> | ExclusiveExistingMapLiveHostOptions<TMap, TActions>,
  internal: Readonly<{
    authorityGate?: LiveHostAuthorityGate<TMap>;
    beforeAcceptedCommitIngestion?: () => void;
    initialHistory?: Readonly<{ baseRevision: number; commits: readonly LiveHostCanonicalCommit[] }>;
  }> = {},
): LiveHostForMap<TMap, TActions> | ExclusiveLiveHostForMap<TMap, TActions> {
  const exclusive = options.authority === "exclusive";
  const hostOwner = Object.freeze({});
  assert_hosted_map_available(map, exclusive);
  const streamRuntime = make_livehost_canonical_stream_runtime(map, {
    ...(options.logicalMapId !== undefined ? { logicalMapId: options.logicalMapId } : {}),
    ...(options.incarnationId !== undefined ? { incarnationId: options.incarnationId } : {}),
    ...(options.history !== undefined ? { history: options.history } : {}),
    ...(options.trace !== undefined ? { trace: options.trace } : {}),
  }, {
    observeCommits: !exclusive,
    ...(internal.initialHistory !== undefined ? { initialHistory: internal.initialHistory } : {}),
  });
  const stream = streamRuntime.stream;
  const recovery = make_livehost_recovery_planner_internal(
    map,
    stream,
    options.recovery ?? {},
    options.trace,
  );
  const sync = make_livehost_sync_manager(map);
  const sessions = make_livehost_session_manager(options.sessions);
  const resume = make_livehost_resume_log();
  const actions = (options.actions ?? {}) as Partial<LiveHostActionsForMap<TActions, TMap>>;
  let seq = 0;
  const actionRequests = make_livehost_action_dedupe_store(
    () => stream.headRev,
    () => seq,
    options.actionDedupe,
  );
  const connections = new Set<LiveHostDisposer>();
  let disposed = false;
  reserve_hosted_map(map, hostOwner, exclusive);

  function trace_authority_event(event: LiveHostAuthorityEvent): void {
    if (options.trace === undefined) return;
    const trace = create_live_trace_context(options.trace, make_livehost_trace_id());
    trace.emit({
      subsystem: "livehost",
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

  let exclusiveAuthority: ReturnType<typeof make_livehost_exclusive_authority<TMap, LiveHostCommitCausation | undefined>> | undefined;
  try {
    exclusiveAuthority = exclusive
      ? make_livehost_exclusive_authority<TMap, LiveHostCommitCausation | undefined>(map, {
      ...(internal.authorityGate !== undefined ? { gate: internal.authorityGate } : {}),
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
        released: () => release_hosted_map(map, hostOwner, true),
      })
      : undefined;
  } catch (cause) {
    release_hosted_map(map, hostOwner, exclusive);
    throw cause;
  }

  function next_seq(): LiveHostSeq {
    seq += 1;
    return seq;
  }

  function action_context(
    origin: LiveHostActionOrigin,
    emitEvent: LiveHostActionContextForMap<TMap>["emit_event"],
    causation?: LiveHostCommitCausation,
  ): Readonly<{
    context: LiveHostActionContextForMap<TMap>;
    finish: () => Promise<void> | undefined;
  }> {
    let open = true;
    const pending: Promise<LiveMapCommit<LiveMapAnyOp>>[] = [];
    const context: LiveHostActionContextForMap<TMap> = Object.freeze({
      map: exclusive ? map : causation === undefined ? map : correlated_action_map(map, causation),
      mutate(mutation) {
        if (!open) {
          return Promise.reject(new LiveHostAuthorityError(
            "LIVEHOST_AUTHORITY_CLOSED",
            "LiveHost action mutation context is expired.",
          ));
        }
        let operation: Promise<LiveMapCommit<LiveMapAnyOp>>;
        if (exclusiveAuthority !== undefined) {
          operation = exclusiveAuthority.mutate(
            mutation as unknown as (draft: TMap) => LiveMapCommit<LiveMapAnyOp>,
            "action",
            causation,
          );
        } else {
          try {
            const commit = mutation(map as never);
            if (causation !== undefined) correlate_action_commit(commit, causation);
            operation = Promise.resolve(commit);
          } catch (cause) {
            operation = Promise.reject(cause);
          }
        }
        pending.push(operation);
        return operation;
      },
      seq,
      origin,
      emit_event: emitEvent,
    });
    return Object.freeze({
      context,
      finish(): Promise<void> | undefined {
        open = false;
        if (pending.length === 0) return undefined;
        return Promise.allSettled(pending).then((results) => {
          const failed = results.find((result) => result.status === "rejected");
          if (failed?.status === "rejected") throw failed.reason;
        });
      },
    });
  }

  function correlated_action_map<TValue extends object>(value: TValue, causation: LiveHostCommitCausation): TValue {
    const proxies = new WeakMap<object, object>();
    const wrap = <TObject extends object>(target: TObject): TObject => {
      const existing = proxies.get(target);
      if (existing !== undefined) return existing as TObject;
      const proxy = new Proxy(target, {
        get(current, property) {
          const member = Reflect.get(current, property, current) as unknown;
          if (typeof member === "function") {
            return (...args: unknown[]) => {
              const result = Reflect.apply(member, current, args) as unknown;
              correlate_action_commit(result, causation);
              return result;
            };
          }
          return typeof member === "object" && member !== null ? wrap(member) : member;
        },
      });
      proxies.set(target, proxy);
      return proxy;
    };
    return wrap(value);
  }

  function correlate_action_commit(value: unknown, causation: LiveHostCommitCausation): void {
    if (!is_livemap_commit(value)) return;
    streamRuntime.correlateCommit(value, causation);
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

  function make_action_trace(
    message: LiveHostClientActionMessage<TActions>,
    origin: LiveHostActionOrigin,
    envelopeAccepted = false,
  ): LiveTraceContext | undefined {
    const sink = options.trace;
    if (sink === undefined) return undefined;
    const trace = create_live_trace_context(sink, make_livehost_trace_id());
    trace.emit({
      subsystem: "livehost",
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
      subsystem: "livehost",
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
    message: LiveHostClientActionMessage<TActions>,
    origin: LiveHostActionOrigin,
    trace: LiveTraceContext | undefined,
  ): LiveHostCommitCausation | undefined {
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

  function validate_action(
    message: LiveHostClientActionMessage<TActions>,
    trace?: LiveTraceContext,
    parentSpanId?: string,
    causation?: LiveHostCommitCausation,
  ):
    | Readonly<{ ok: true; handler: NonNullable<Partial<LiveHostActionsForMap<TActions, TMap>>[keyof TActions & string]>; payload: JsonValue | undefined }>
    | Readonly<{ ok: false; code: "LIVEHOST_ACTION_UNKNOWN" | "LIVEHOST_ACTION_UNAVAILABLE" | "LIVEHOST_ACTION_INVALID"; message: string }> {
    const lookupSpan = trace?.beginSpan(
      "livehost",
      "action.lookup",
      parentSpanId,
      () => ({ action: message.name }),
    );
    const documentAction = resolve_livehost_document_action(map, message.name, message.payload);
    if (documentAction.kind === "unavailable") {
      lookupSpan?.failure(() => ({ action: message.name, errorCode: "LIVEHOST_ACTION_UNAVAILABLE" }));
      return { ok: false, code: "LIVEHOST_ACTION_UNAVAILABLE", message: documentAction.message };
    }
    const configuredHandler = actions[message.name];
    if (documentAction.kind === "not-document-action" && !configuredHandler) {
      lookupSpan?.failure(() => ({ action: message.name, errorCode: "LIVEHOST_UNKNOWN_ACTION" }));
      return { ok: false, code: "LIVEHOST_ACTION_UNKNOWN", message: `Unknown LiveHost action: ${message.name}` };
    }
    lookupSpan?.success(() => ({ action: message.name }));

    const validationSpan = trace?.beginSpan(
      "livehost",
      "payload.validation",
      parentSpanId,
      () => ({ action: message.name, payloadPresent: message.payload !== undefined }),
    );
    if (documentAction.kind === "invalid") {
      validationSpan?.failure(() => ({ action: message.name, errorCode: "LIVEHOST_SCHEMA_INVALID_PAYLOAD", issueCount: 1 }));
      return { ok: false, code: "LIVEHOST_ACTION_INVALID", message: documentAction.message };
    }
    if (documentAction.kind === "ready") {
      const handler: NonNullable<Partial<LiveHostActionsForMap<TActions, TMap>>[keyof TActions & string]> = async (context) => {
        if (exclusive) {
          await context.mutate((draft) => documentAction.execute(draft as unknown as TMap));
          return;
        }
        const commit = documentAction.execute();
        if (causation !== undefined) correlate_action_commit(commit, causation);
      };
      validationSpan?.success(() => ({ action: message.name, schemaConfigured: true }));
      return { ok: true, handler, payload: documentAction.payload };
    }
    const handler = configuredHandler;
    if (!handler) {
      throw new Error("LiveHost action resolution lost its configured handler.");
    }
    const actionSchema = options.schema?.actions?.[message.name];
    let payloadResult: LiveHostSchemaResult<JsonValue | undefined>;
    try {
      payloadResult = decode_with_schema(actionSchema?.payload, message.payload);
    } catch (cause) {
      validationSpan?.failure(() => ({ action: message.name, errorCode: safe_error_code(cause, "LIVEHOST_SCHEMA_DECODER_FAILED") }));
      throw cause;
    }
    if (!payloadResult.ok) {
      validationSpan?.failure(() => ({
        action: message.name,
        errorCode: "LIVEHOST_SCHEMA_INVALID_PAYLOAD",
        issueCount: payloadResult.issues.length,
      }));
      return { ok: false, code: "LIVEHOST_ACTION_INVALID", message: schema_error_message(payloadResult.issues) };
    }
    validationSpan?.success(() => ({ action: message.name, schemaConfigured: actionSchema?.payload !== undefined }));
    return { ok: true, handler, payload: payloadResult.value };
  }

  function public_action_error_code(
    code: "LIVEHOST_ACTION_UNKNOWN" | "LIVEHOST_ACTION_UNAVAILABLE" | "LIVEHOST_ACTION_INVALID",
  ): "LIVEHOST_UNKNOWN_ACTION" | "LIVEHOST_ACTION_UNAVAILABLE" | "LIVEHOST_SCHEMA_INVALID_PAYLOAD" {
    if (code === "LIVEHOST_ACTION_UNKNOWN") return "LIVEHOST_UNKNOWN_ACTION";
    if (code === "LIVEHOST_ACTION_UNAVAILABLE") return "LIVEHOST_ACTION_UNAVAILABLE";
    return "LIVEHOST_SCHEMA_INVALID_PAYLOAD";
  }

  type AuthorizationResult =
    | Readonly<{ ok: true; payload: JsonValue | undefined }>
    | Readonly<{
      ok: false;
      code: "LIVEHOST_ACTION_FORBIDDEN" | "LIVEHOST_ACTION_AUTHORIZATION_FAILED";
      message: string;
      cause?: unknown;
    }>;

  function authorize_validated_action(
    message: LiveHostClientActionMessage<TActions>,
    payload: JsonValue | undefined,
    origin: Extract<LiveHostActionOrigin, { kind: "session" }>,
    trace?: LiveTraceContext,
    parentSpanId?: string,
  ): AuthorizationResult | Promise<AuthorizationResult> {
    const authorizer = options.authorizeAction;
    if (authorizer === undefined) {
      trace?.emit({
        subsystem: "livehost",
        phase: "action.authorization",
        status: "skip",
        ...(parentSpanId !== undefined ? { parentSpanId } : {}),
        details: () => ({ action: message.name, reason: "implicit-allow" }),
      });
      return { ok: true, payload };
    }

    const authorizationSpan = trace?.beginSpan(
      "livehost",
      "action.authorization",
      parentSpanId,
      () => ({ action: message.name }),
    );
    const policyPayload = clone_action_payload(payload, true);
    const handlerPayload = clone_action_payload(payload, false);
    const context = Object.freeze({
      action: message.name,
      session: Object.freeze({
        sessionId: origin.sessionId,
        epoch: origin.epoch,
        resumable: origin.resumable,
      }),
      payload: policyPayload,
      logicalMapId: stream.logicalMapId,
      incarnationId: stream.incarnationId,
    }) as LiveHostActionAuthorizationContext<TActions>;

    function finish(decision: boolean): AuthorizationResult {
      if (!decision) {
        authorizationSpan?.failure(() => ({
          action: message.name,
          outcome: "denied",
          errorCode: "LIVEHOST_ACTION_FORBIDDEN",
        }));
        return {
          ok: false,
          code: "LIVEHOST_ACTION_FORBIDDEN",
          message: "LiveHost action is not authorized.",
        };
      }
      authorizationSpan?.success(() => ({ action: message.name, outcome: "allowed" }));
      return { ok: true, payload: handlerPayload };
    }

    function failed(cause: unknown): AuthorizationResult {
      authorizationSpan?.failure(() => ({
        action: message.name,
        outcome: "failed",
        errorCode: "LIVEHOST_ACTION_AUTHORIZATION_FAILED",
      }));
      return {
        ok: false,
        code: "LIVEHOST_ACTION_AUTHORIZATION_FAILED",
        message: "LiveHost action authorization failed.",
        cause,
      };
    }

    try {
      const decision = authorizer(context);
      return typeof decision === "boolean"
        ? finish(decision)
        : decision.then(finish, failed);
    } catch (cause) {
      return failed(cause);
    }
  }

  async function execute_validated_action(
    message: LiveHostClientActionMessage<TActions>,
    handler: NonNullable<Partial<LiveHostActionsForMap<TActions, TMap>>[keyof TActions & string]>,
    payload: JsonValue | undefined,
    origin: LiveHostActionOrigin,
    emitEvent: LiveHostActionContextForMap<TMap>["emit_event"],
    trace?: LiveTraceContext,
    parentSpanId?: string,
    causation?: LiveHostCommitCausation,
  ): Promise<LiveHostActionTerminalOutcome> {
    const previousRev = stream.headRev;
    const handlerSpan = trace?.beginSpan(
      "livehost",
      "handler.execute",
      parentSpanId,
      () => ({ action: message.name, origin: origin.kind }),
    );
    const scope = action_context(origin, emitEvent, causation);
    try {
      const result = await handler(scope.context, payload as never, message);
      const tracked = scope.finish();
      if (tracked !== undefined) await tracked;
      if (result !== undefined && !is_livehost_json_value(result)) {
        handlerSpan?.failure(() => ({
          action: message.name,
          errorCode: "LIVEHOST_ACTION_OUTCOME_NORMALIZATION_FAILED",
        }));
        trace_state_boundary(trace, parentSpanId, previousRev);
        return Object.freeze({
          state: "failed",
          seq,
          completionRev: stream.headRev,
          error: Object.freeze({
            message: "LiveHost action result could not be normalized for transport.",
            code: "LIVEHOST_ACTION_OUTCOME_NORMALIZATION_FAILED",
          }),
        });
      }
      handlerSpan?.success(() => ({ action: message.name, resultPresent: result !== undefined }));
      trace_state_boundary(trace, parentSpanId, previousRev);
      return Object.freeze({
        state: "succeeded",
        seq: next_seq(),
        completionRev: stream.headRev,
        ...(result !== undefined ? { result } : {}),
      });
    } catch (cause) {
      try {
        const tracked = scope.finish();
        if (tracked !== undefined) await tracked;
      } catch (trackedCause) {
        cause = trackedCause;
      }
      const causeCode = safe_error_code(cause, "LIVEHOST_ACTION_FAILED");
      handlerSpan?.failure(() => ({ action: message.name, errorCode: causeCode }));
      trace_state_boundary(trace, parentSpanId, previousRev);
      return Object.freeze({
        state: "failed",
        seq,
        completionRev: stream.headRev,
        error: Object.freeze({
          message: cause instanceof Error ? cause.message : "LiveHost action failed.",
          code: causeCode,
        }),
      });
    }
  }

  function action_response(
    id: string,
    outcome: LiveHostActionTerminalOutcome,
    requestId?: string,
    delivery?: LiveHostActionDelivery,
    attemptId?: string,
  ): LiveHostClientActionResult {
    if (outcome.state === "succeeded") {
      return {
        type: "ack",
        id,
        ok: true,
        seq: outcome.seq,
        completionRev: outcome.completionRev,
        ...(requestId ? { requestId } : {}),
        ...(attemptId ? { attemptId } : {}),
        ...(delivery ? { delivery } : {}),
        ...(outcome.result !== undefined ? { result: outcome.result } : {}),
      };
    }
    return {
      type: "error",
      id,
      ok: false,
      seq: outcome.seq,
      completionRev: outcome.completionRev,
      ...(requestId ? { requestId } : {}),
      ...(attemptId ? { attemptId } : {}),
      ...(delivery ? { delivery } : {}),
      error: outcome.error,
    };
  }

  async function dispatch_action_scoped(
    message: LiveHostClientActionMessage<TActions>,
    origin: LiveHostActionOrigin,
    emitEvent: LiveHostActionContextForMap<TMap>["emit_event"],
    trace?: LiveTraceContext,
  ): Promise<LiveHostServerMessage<LiveHostMapValue<TMap>>> {
    const causation = action_causation(message, origin, trace);
    const actionSpan = trace?.beginSpan(
      "livehost",
      "action.execute",
      undefined,
      () => ({ action: message.name, origin: origin.kind }),
    );
    if (disposed) {
      actionSpan?.failure(() => ({ action: message.name, errorCode: "LIVEHOST_HOST_DISPOSED" }));
      return {
        type: "error",
        id: message.id,
        ok: false,
        seq,
        completionRev: stream.headRev,
        error: {
          message: "LiveHost is disposed.",
          code: "LIVEHOST_HOST_DISPOSED",
        },
      };
    }
    const validated = (() => {
      try {
        return validate_action(message, trace, actionSpan?.spanId, causation);
      } catch (cause) {
        actionSpan?.failure(() => ({ action: message.name, errorCode: safe_error_code(cause, "LIVEHOST_SCHEMA_DECODER_FAILED") }));
        throw cause;
      }
    })();
    if (!validated.ok) {
      const code = public_action_error_code(validated.code);
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
    const authorization = origin.kind === "session"
      ? authorize_validated_action(
        message,
        validated.payload,
        origin,
        trace,
        actionSpan?.spanId,
      )
      : { ok: true as const, payload: validated.payload };
    const authorized = authorization instanceof Promise
      ? await authorization
      : authorization;
    if (!authorized.ok) {
      actionSpan?.failure(() => ({ action: message.name, errorCode: authorized.code }));
      return {
        type: "error",
        id: message.id,
        ok: false,
        seq,
        completionRev: stream.headRev,
        error: {
          message: authorized.message,
          code: authorized.code,
        },
      };
    }
    const response = action_response(
      message.id,
      await execute_validated_action(
        message,
        validated.handler,
        authorized.payload,
        origin,
        emitEvent,
        trace,
        actionSpan?.spanId,
      ),
    );
    trace?.emit({
      subsystem: "transport",
      phase: "response.created",
      status: response.type === "ack" ? "success" : "failure",
      ...(actionSpan !== undefined ? { parentSpanId: actionSpan.spanId } : {}),
      details: () => ({
        action: message.name,
        responseType: response.type,
        ...(response.type === "error" ? { errorCode: response.error.code ?? "LIVEHOST_ACTION_FAILED" } : {}),
      }),
    });
    if (response.type === "ack") actionSpan?.success(() => ({ action: message.name, responseType: response.type }));
    else actionSpan?.failure(() => ({ action: message.name, responseType: response.type, errorCode: response.error.code ?? "LIVEHOST_ACTION_FAILED" }));
    return response;
  }

  function dispatch_action(message: LiveHostClientActionMessage<TActions>): Promise<LiveHostServerMessage<LiveHostMapValue<TMap>>> {
    const trace = make_action_trace(message, DIRECT_ACTION_ORIGIN);
    return dispatch_action_scoped(message, DIRECT_ACTION_ORIGIN, () => false, trace);
  }

  function inert_connection(): LiveHostConnection {
    const disconnect = () => { };
    return Object.assign(disconnect, {
      emit_event(_event: string, _payload: JsonValue): void { },
    });
  }

  function connect(socket: LiveHostSocketLike): LiveHostConnection {
    if (disposed) return inert_connection();
    const disposers: LiveHostDisposer[] = [];
    let transportOpen = true;
    let fenced = false;
    let sessionId: LiveHostSessionId | undefined;
    let connectionEpoch: number | undefined;
    let sessionResumable: boolean | undefined;
    let stopRecoveryChannel: LiveHostDisposer | undefined;
    let recoveryState: LiveHostConnectionRecoveryState = Object.freeze({ phase: "awaiting-recovery" });

    function raw_send(message: LiveHostServerMessage): void {
      if (transportOpen) socket.send(encode_livehost_message(message));
    }

    function authoritative(): boolean {
      return transportOpen
        && !fenced
        && sessionId !== undefined
        && connectionEpoch !== undefined
        && sessions.is_active(sessionId, connectionEpoch);
    }

    function send_without_record(message: LiveHostServerMessage): void {
      if (authoritative()) raw_send(message);
    }

    function send(message: LiveHostServerMessage): void {
      if (!authoritative()) return;
      if (message.type === "sync") resume.record_sync(message);
      raw_send(message);
    }

    function dispose_recovery_channel(): void {
      const stop = stopRecoveryChannel;
      stopRecoveryChannel = undefined;
      stop?.();
    }

    function begin_recovery(message: LiveHostClientRecoverMessage): Readonly<{
      encoding: LiveHostDocumentSnapshotEncoding;
      acknowledgment?: LiveHostSnapshotEncodingSelection;
    }> {
      const signature = snapshot_capability_signature(message.snapshotCapabilities);
      const selected = select_snapshot_encoding(
        message.snapshotCapabilities,
        map.mode === "element" || map.mode === "fragment",
      );
      if (recoveryState.phase === "recovering") {
        if (recoveryState.capabilitySignature !== signature
          || !snapshot_encoding_equal(recoveryState.snapshotEncoding, selected)) {
          throw new LiveHostRecoveryError(
            "LIVEHOST_RECOVERY_NEGOTIATION_FAILED",
            "LiveHost snapshot capabilities cannot change during one connection.",
          );
        }
        throw new LiveHostConnectionRecoveryError(
          "LIVEHOST_RECOVERY_IN_PROGRESS",
          "LiveHost recovery is already in progress on this connection.",
        );
      }
      if (recoveryState.phase === "failed") {
        throw new LiveHostConnectionRecoveryError(
          "LIVEHOST_RECOVERY_LIFECYCLE_INVALID",
          "LiveHost recovery cannot restart on a failed connection.",
        );
      }
      if (recoveryState.phase === "caught-up"
        && (recoveryState.capabilitySignature !== signature
          || !snapshot_encoding_equal(recoveryState.snapshotEncoding, selected))) {
        throw new LiveHostRecoveryError(
          "LIVEHOST_RECOVERY_NEGOTIATION_FAILED",
          "LiveHost snapshot capabilities cannot change during one connection.",
        );
      }
      if (recoveryState.phase === "caught-up" && recoveryState.requestId === message.id) {
        throw new LiveHostConnectionRecoveryError(
          "LIVEHOST_RECOVERY_COMPLETED",
          "LiveHost recovery request is already completed on this connection.",
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

    function send_recovery(message: LiveHostServerMessage, requestId: string): void {
      if (recoveryState.phase !== "recovering"
        || recoveryState.requestId !== requestId
        || !authoritative()) {
        throw new LiveHostConnectionRecoveryError(
          "LIVEHOST_RECOVERY_INTERRUPTED",
          "LiveHost recovery was interrupted before completion.",
        );
      }
      raw_send(message);
      if (recoveryState.phase !== "recovering"
        || recoveryState.requestId !== requestId
        || !authoritative()) {
        throw new LiveHostConnectionRecoveryError(
          "LIVEHOST_RECOVERY_INTERRUPTED",
          "LiveHost recovery was interrupted before completion.",
        );
      }
    }

    function fence_attachment(fencedSessionId: LiveHostSessionId, epoch: number): void {
      if (sessionId !== fencedSessionId || connectionEpoch !== epoch || fenced) return;
      raw_send({ type: "session-fenced", sessionId: fencedSessionId, epoch, code: "LIVEHOST_SESSION_ATTACHMENT_FENCED" });
      fenced = true;
      recoveryState = Object.freeze({ phase: "failed" });
      dispose_recovery_channel();
    }

    const attachment = Object.freeze({ fence: fence_attachment });

    function session_subscription_count(id: LiveHostSessionId): number {
      return sync.debug_sessions().find((item) => item.sessionId === id)?.paths.length ?? 0;
    }

    function bind_new_session(resumable: boolean): boolean {
      if (sessionId !== undefined) return authoritative();
      const id = resolve_session_id(options.sessionId);
      const added = sync.add_session(id, send);
      if (!added.ok) return false;
      const created = sessions.create(
        id,
        resumable,
        attachment,
        () => sync.remove_session(id),
        () => session_subscription_count(id),
      );
      if (!created.ok) {
        sync.remove_session(id);
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

    function reject_session(id: string, code: Extract<LiveHostServerMessage, { type: "session-rejected" }>["code"], message: string): void {
      raw_send({ type: "session-rejected", id, code, message });
    }

    function create_resumable_session(id: string): void {
      if (sessionId !== undefined) {
        reject_session(id, "LIVEHOST_SESSION_NOT_ATTACHED", "This transport already owns a LiveHost session.");
        return;
      }
      const nextSessionId = resolve_session_id(options.sessionId);
      const added = sync.add_session(nextSessionId, send);
      if (!added.ok) {
        reject_session(id, "LIVEHOST_SESSION_NOT_ATTACHED", added.error.message);
        return;
      }
      const created = sessions.create(
        nextSessionId,
        true,
        attachment,
        () => sync.remove_session(nextSessionId),
        () => session_subscription_count(nextSessionId),
      );
      if (!created.ok || !created.value.credential) {
        sync.remove_session(nextSessionId);
        reject_session(id, "LIVEHOST_SESSION_NOT_ATTACHED", "LiveHost could not create a resumable session.");
        return;
      }
      sessionId = created.value.sessionId;
      connectionEpoch = created.value.epoch;
      sessionResumable = created.value.resumable;
      raw_send({ type: "session-created", id, sessionId, credential: created.value.credential, epoch: connectionEpoch });
    }

    function reattach_session(message: LiveHostClientSessionAttachMessage): void {
      if (sessionId !== undefined) {
        reject_session(message.id, "LIVEHOST_SESSION_NOT_ATTACHED", "This transport already owns a LiveHost session.");
        return;
      }
      const attached = sessions.reattach(message.credential, attachment);
      if (!attached.ok) {
        reject_session(
          message.id,
          (attached.error.code ?? "LIVEHOST_SESSION_CREDENTIAL_UNKNOWN") as Extract<LiveHostServerMessage, { type: "session-rejected" }>["code"],
          attached.error.message,
        );
        return;
      }
      sessionId = attached.value.sessionId;
      connectionEpoch = attached.value.epoch;
      sessionResumable = attached.value.resumable;
      const rebound = sync.attach_session(sessionId, send);
      if (!rebound.ok) {
        reject_session(message.id, "LIVEHOST_SESSION_NOT_ATTACHED", rebound.error.message);
        return;
      }
      raw_send({ type: "session-attached", id: message.id, sessionId, epoch: connectionEpoch });
    }

    function recovery_error(id: string, cause: unknown, trace?: LiveTraceContext, startedAt?: number): void {
      const code = typeof cause === "object" && cause !== null && "code" in cause && typeof cause.code === "string"
        ? cause.code
        : "LIVEHOST_RECOVERY_TRANSPORT_FAILED";
      const message = cause instanceof Error ? cause.message : "LiveHost recovery transport failed.";
      trace?.emit({
        subsystem: "transport",
        phase: "recovery.transport",
        status: "failure",
        details: () => ({ requestId: id, outcome: "send-failed", errorCode: code }),
      });
      trace?.emit({
        subsystem: "livehost",
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
      message: LiveHostClientActionMessage<TActions>,
      origin: Extract<LiveHostActionOrigin, { kind: "session" }>,
      trace?: LiveTraceContext,
    ): Promise<void> {
      if (!message.requestId || !message.clientId) {
        const response = await dispatch_action_scoped(
          message,
          origin,
          emit_connection_event,
          trace,
        );

        send(response);
        trace?.emit({
          subsystem: "transport",
          phase: "response.dispatch",
          status: response.type === "ack" ? "success" : "failure",
          details: () => ({
            action: message.name,
            responseType: response.type,
            ...(response.type === "error" ? { errorCode: response.error.code ?? "LIVEHOST_ACTION_FAILED" } : {}),
          }),
        });

        if (response.type === "ack") {
          sync.sync_all(response.seq);
        }

        return;
      }

      const actionSpan = trace?.beginSpan(
        "livehost",
        "action.execute",
        undefined,
        () => ({ action: message.name, origin: origin.kind }),
      );
      const causation = action_causation(message, origin, trace);
      const validated = (() => {
        try {
          return validate_action(message, trace, actionSpan?.spanId, causation);
        } catch (cause) {
          actionSpan?.failure(() => ({ action: message.name, errorCode: safe_error_code(cause, "LIVEHOST_SCHEMA_DECODER_FAILED") }));
          throw cause;
        }
      })();

      if (!validated.ok) {
        const code = public_action_error_code(validated.code);

        const response: LiveHostClientActionResult = {
          type: "error",
          id: message.id,
          ...(message.requestId !== undefined ? { requestId: message.requestId } : {}),
          ...(message.attemptId !== undefined
            ? { attemptId: message.attemptId }
            : {}),
          ok: false,
          seq,
          completionRev: stream.headRev,
          delivery: "rejected",
          error: {
            code,
            message: validated.message,
          },
        };
        send(response);
        trace?.emit({
          subsystem: "transport",
          phase: "response.dispatch",
          status: "failure",
          ...(actionSpan !== undefined ? { parentSpanId: actionSpan.spanId } : {}),
          details: () => ({ action: message.name, responseType: response.type, errorCode: code }),
        });
        actionSpan?.failure(() => ({ action: message.name, errorCode: code }));

        return;
      }

      const authorization = authorize_validated_action(
        message,
        validated.payload,
        origin,
        trace,
        actionSpan?.spanId,
      );
      const authorized = authorization instanceof Promise
        ? await authorization
        : authorization;
      if (!authorized.ok) {
        const response: LiveHostClientActionResult = {
          type: "error",
          id: message.id,
          ...(message.requestId !== undefined ? { requestId: message.requestId } : {}),
          ...(message.attemptId !== undefined
            ? { attemptId: message.attemptId }
            : {}),
          ok: false,
          seq,
          completionRev: stream.headRev,
          delivery: "rejected",
          error: {
            code: authorized.code,
            message: authorized.message,
          },
        };
        send(response);
        trace?.emit({
          subsystem: "transport",
          phase: "response.dispatch",
          status: "failure",
          ...(actionSpan !== undefined ? { parentSpanId: actionSpan.spanId } : {}),
          details: () => ({ action: message.name, responseType: response.type, errorCode: authorized.code }),
        });
        actionSpan?.failure(() => ({ action: message.name, errorCode: authorized.code }));
        return;
      }

      const result = await actionRequests.execute({
        clientId: message.clientId,
        requestId: message.requestId,
        actionName: message.name,
        payload: authorized.payload,
        retry: message.retry === true,
        ...(trace !== undefined ? { sourceTraceId: trace.traceId } : {}),
        run: () => execute_validated_action(
          message,
          validated.handler,
          authorized.payload,
          origin,
          emit_connection_event,
          trace,
          actionSpan?.spanId,
          causation,
        ),
      });

      if (!result.ok) {
        trace?.emit({
          subsystem: "livehost",
          phase: "action.dedupe",
          status: "failure",
          ...(actionSpan !== undefined ? { parentSpanId: actionSpan.spanId } : {}),
          details: () => ({
            action: message.name,
            sourceAction: message.name,
            delivery: "rejected",
            ...(trace !== undefined ? { sourceTraceId: trace.traceId } : {}),
            ...(message.requestId !== undefined ? { requestId: message.requestId } : {}),
            ...(message.attemptId !== undefined ? { attemptId: message.attemptId } : {}),
            errorCode: result.code,
          }),
        });
        const response: LiveHostClientActionResult = {
          type: "error",
          id: message.id,
          requestId: message.requestId,
          ...(message.attemptId !== undefined
            ? { attemptId: message.attemptId }
            : {}),
          ok: false,
          seq,
          completionRev: stream.headRev,
          delivery: "rejected",
          error: {
            code: result.code,
            message: result.message,
          },
        };
        send(response);
        trace?.emit({
          subsystem: "transport",
          phase: "response.dispatch",
          status: "failure",
          ...(actionSpan !== undefined ? { parentSpanId: actionSpan.spanId } : {}),
          details: () => ({ action: message.name, responseType: response.type, errorCode: result.code }),
        });
        actionSpan?.failure(() => ({ action: message.name, errorCode: result.code }));

        return;
      }

      trace?.emit({
        subsystem: "livehost",
        phase: "action.dedupe",
        status: result.delivery === "executed" ? "success" : "skip",
        ...(actionSpan !== undefined ? { parentSpanId: actionSpan.spanId } : {}),
        details: () => ({
          action: message.name,
          sourceAction: message.name,
          delivery: result.delivery,
          ...(result.sourceTraceId !== undefined ? { sourceTraceId: result.sourceTraceId } : {}),
          ...(message.requestId !== undefined ? { requestId: message.requestId } : {}),
          ...(message.attemptId !== undefined ? { attemptId: message.attemptId } : {}),
        }),
      });

      const response = action_response(
        message.id,
        result.outcome,
        message.requestId,
        result.delivery,
        message.attemptId,
      );

      send(response);
      trace?.emit({
        subsystem: "transport",
        phase: "response.dispatch",
        status: response.type === "ack" ? "success" : "failure",
        ...(actionSpan !== undefined ? { parentSpanId: actionSpan.spanId } : {}),
        details: () => ({
          action: message.name,
          responseType: response.type,
          delivery: result.delivery,
          ...(response.type === "error" ? { errorCode: response.error.code ?? "LIVEHOST_ACTION_FAILED" } : {}),
        }),
      });

      if (result.delivery === "executed" && response.type === "ack") {
        sync.sync_all(response.seq);
        trace?.emit({
          subsystem: "livehost",
          phase: "subscription.publication",
          status: "success",
          ...(actionSpan !== undefined ? { parentSpanId: actionSpan.spanId } : {}),
          details: () => ({
            sequence: response.seq,
            subscriberCount: sync.debug_sessions().reduce((count, session) => count + session.paths.length, 0),
          }),
        });
      }

      if (response.type === "ack") {
        actionSpan?.success(() => ({ action: message.name, responseType: response.type, delivery: result.delivery }));
      } else {
        actionSpan?.failure(() => ({
          action: message.name,
          responseType: response.type,
          delivery: result.delivery,
          errorCode: response.error.code ?? "LIVEHOST_ACTION_FAILED",
        }));
      }
    }

    function handle_recover(message: LiveHostClientRecoverMessage): void {
      if (!sessionId || connectionEpoch === undefined || !authoritative()) return;
      const startedAt = Date.now();
      const trace = options.trace === undefined
        ? undefined
        : create_live_trace_context(options.trace, `lht-recovery-${message.id}-${stream.headRev}`);
      const history = stream.history.debug();
      trace?.emit({
        subsystem: "livehost",
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
            subsystem: "livehost",
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
      const pendingLive: LiveHostCanonicalCommit[] = [];
      let stopLive: LiveHostDisposer = () => { };
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
          subsystem: "livehost",
          phase: "recovery.complete",
          status: "success",
          durationMs: Math.max(0, Date.now() - startedAt),
          details: () => ({
            requestId: message.id,
            strategy,
            targetRev: completion.caughtUp.throughRev,
            snapshotFormat: negotiation.encoding.format,
            ...(negotiation.encoding.format === "view-state"
              ? { snapshotFormatVersion: negotiation.encoding.formatVersion }
              : {}),
            outcome: "synchronized",
          }),
        });
      } catch (cause) {
        dispose_recovery_channel();
        fail_active_recovery(message.id);
        recovery_error(message.id, cause, trace, startedAt);
      }
    }

    async function handle_message(raw: string): Promise<void> {
      const decoded = decode_livehost_message<TActions>(raw);
      if (!decoded.ok) {
        if (!fenced) raw_send({ type: "error", seq, error: decoded.error });
        return;
      }
      const message = decoded.value;
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
          reject_session(message.id, (ended.error.code ?? "LIVEHOST_SESSION_ALREADY_GONE") as Extract<LiveHostServerMessage, { type: "session-rejected" }>["code"], ended.error.message);
          return;
        }
        dispose_recovery_channel();
        raw_send({ type: "session-ended", id: message.id, sessionId: endedSessionId, epoch: endedEpoch });
        fenced = true;
        return;
      }
      if (message.type === "hello") {
        if (!is_projected_live_map(map)) {
          send_without_record({
            type: "error",
            seq,
            error: {
              code: "LIVEHOST_DOCUMENT_RECOVERY_REQUIRED",
              message: "Document mirrors initialize through canonical recovery.",
            },
          });
          return;
        }
        if (options.trace !== undefined) {
          const retained = resume.debug_entries();
          const requestedSeq = message.lastSeq;
          const canReplay = requestedSeq !== undefined && resume.can_replay_after(requestedSeq);
          const replayCount = canReplay ? retained.filter((entry) => entry.seq > requestedSeq).length : 0;
          const resumeTrace = create_live_trace_context(options.trace, `lht-resume-${sessionId}-${requestedSeq ?? "initial"}`);
          resumeTrace.emit({
            subsystem: "livehost",
            phase: "resume.plan",
            status: "success",
            details: () => ({
              ...(requestedSeq !== undefined ? { requestedSeq } : {}),
              currentSeq: seq,
              ...(retained[0] !== undefined ? { oldestAvailableSeq: retained[0].seq } : {}),
              strategy: replayCount > 0 ? "snapshot-plus-replay" : "snapshot",
              revisionRelationship: requestedSeq === undefined
                ? "unknown"
                : requestedSeq === seq ? "equal" : requestedSeq < seq ? "behind" : "ahead",
              replayCount,
              snapshotPresent: true,
              outcome: "selected",
            }),
          });
        }
        send_without_record({ type: "hello", sessionId, seq, snapshot: map.snap() });
        if (message.lastSeq !== undefined && resume.can_replay_after(message.lastSeq)) {
          for (const replay of resume.replay_after(message.lastSeq)) send_without_record(replay);
        }
        return;
      }
      if (message.type === "recover") {
        handle_recover(message);
        return;
      }
      if (message.type === "action-status") {
        const status = actionRequests.status(message.clientId, message.requestId);
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
        const origin: LiveHostActionOrigin = Object.freeze({
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
      if (message.type === "subscribe") {
        const result = sync.subscribe(sessionId, message.path, seq);
        if (!result.ok) send({ type: "error", seq, error: result.error });
        return;
      }
      if (message.type === "unsubscribe") {
        const result = sync.unsubscribe(sessionId, message.path);
        if (!result.ok) send({ type: "error", seq, error: result.error });
      }
    }

    const stopMessage = socket.onMessage((raw) => { void handle_message(raw); });

    function detach_transport(hostShutdown = false): void {
      if (!transportOpen) return;
      transportOpen = false;
      recoveryState = Object.freeze({ phase: "awaiting-recovery" });
      dispose_recovery_channel();
      if (!hostShutdown && sessionId && connectionEpoch !== undefined && sessions.is_active(sessionId, connectionEpoch)) {
        sync.detach_session(sessionId);
        sessions.detach(sessionId, connectionEpoch);
      }
      while (disposers.length) disposers.pop()?.();
      connections.delete(shutdown_for_host);
    }

    const stopClose = socket.onClose(detach_transport);
    if (stopMessage) disposers.push(stopMessage);
    if (stopClose) disposers.push(stopClose);

    function shutdown_for_host(): void {
      detach_transport(true);
    }

    const disconnect = () => detach_transport();
    const connection = Object.assign(disconnect, {
      emit_event(event: string, payload: JsonValue): void {
        emit_connection_event(event, payload);
      },
    });
    connections.add(shutdown_for_host);
    return connection;
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    for (const shutdown of [...connections]) shutdown();
    connections.clear();
    sessions.dispose();
    actionRequests.dispose();
    if (exclusiveAuthority !== undefined) exclusiveAuthority.dispose();
    else release_hosted_map(map, hostOwner, false);
  }

  const host = {
    map,
    stream,
    recovery,
    sessions: Object.freeze({ debug: sessions.debug, on_change: sessions.on_change, dispose: sessions.dispose }),
    actionRequests: Object.freeze({ debug: actionRequests.debug, dispose: actionRequests.dispose }),
    get seq() { return seq; },
    schema: options.schema,
    dispatch_action,
    connect,
    dispose,
    ...(exclusiveAuthority !== undefined ? {
      mutate: (mutation: (draft: TMap) => LiveMapCommit<LiveMapAnyOp>) =>
        exclusiveAuthority.mutate(mutation, "host"),
    } : {}),
  };
  if (exclusiveAuthority !== undefined) {
    exclusiveHostAuthorities.set(host, exclusiveAuthority as ReturnType<typeof make_livehost_exclusive_authority>);
  }
  return host;
}

/** @internal Run a non-mutation barrier in one exclusive host's FIFO. */
export function run_livehost_exclusive_task<TResult>(
  host: object,
  operation: () => TResult | Promise<TResult>,
): Promise<TResult> {
  const authority = exclusiveHostAuthorities.get(host);
  if (authority === undefined) {
    return Promise.reject(new LiveHostAuthorityError(
      "LIVEHOST_AUTHORITY_CLOSED",
      "LiveHost does not expose exclusive authority.",
    ));
  }
  return authority.runExclusive(operation);
}

/** @internal Wait until exclusive host management has been safely released. */
export function wait_livehost_exclusive_closed(host: object): Promise<void> {
  return exclusiveHostAuthorities.get(host)?.closed ?? Promise.resolve();
}

function reserve_hosted_map(map: object, owner: object, exclusive: boolean): void {
  const current = hostedMapAuthorities.get(map);
  if (exclusive) {
    if (current !== undefined && (current.shared > 0 || current.exclusive !== undefined)) {
      throw new LiveHostAuthorityError(
        "LIVEHOST_AUTHORITY_ALREADY_MANAGED",
        "LiveMap already belongs to another LiveHost authority.",
      );
    }
    hostedMapAuthorities.set(map, Object.freeze({ shared: 0, exclusive: owner }));
    return;
  }
  if (current?.exclusive !== undefined) {
    throw new LiveHostAuthorityError(
      "LIVEHOST_AUTHORITY_ALREADY_MANAGED",
      "LiveMap already belongs to an exclusive LiveHost authority.",
    );
  }
  hostedMapAuthorities.set(map, Object.freeze({ shared: (current?.shared ?? 0) + 1 }));
}

function assert_hosted_map_available(map: object, exclusive: boolean): void {
  const current = hostedMapAuthorities.get(map);
  if (exclusive ? current !== undefined : current?.exclusive !== undefined) {
    throw new LiveHostAuthorityError(
      "LIVEHOST_AUTHORITY_ALREADY_MANAGED",
      exclusive
        ? "LiveMap already belongs to another LiveHost authority."
        : "LiveMap already belongs to an exclusive LiveHost authority.",
    );
  }
}

function release_hosted_map(map: object, owner: object, exclusive: boolean): void {
  const current = hostedMapAuthorities.get(map);
  if (current === undefined) return;
  if (exclusive) {
    if (current.exclusive === owner) hostedMapAuthorities.delete(map);
    return;
  }
  if (current.exclusive !== undefined || current.shared <= 0) return;
  if (current.shared === 1) hostedMapAuthorities.delete(map);
  else hostedMapAuthorities.set(map, Object.freeze({ shared: current.shared - 1 }));
}

function is_projected_live_map(map: LiveMapAuthority): map is LiveMap {
  return (map.mode === "data-object" || map.mode === "data-array")
    && "snap" in map
    && typeof map.snap === "function";
}
