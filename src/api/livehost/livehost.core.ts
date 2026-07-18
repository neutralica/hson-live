// livehost/core.ts

import { hson } from "../../hson.js";
import type { JsonValue, LiveMap } from "../../types/index.js";
import type {
  LiveHost,
  LiveHostActionContext,
  LiveHostActionDelivery,
  LiveHostActionOrigin,
  LiveHostActionPayloads,
  LiveHostActionTerminalOutcome,
  LiveHostActions,
  LiveHostClientActionMessage,
  LiveHostClientRecoverMessage,
  LiveHostClientSessionAttachMessage,
  LiveHostCanonicalCommit,
  LiveHostConnection,
  LiveHostDisposer,
  LiveHostOptions,
  LiveHostSchemaDecoder,
  LiveHostSchemaResult,
  LiveHostSeq,
  LiveHostServerMessage,
  LiveHostSessionId,
  LiveHostSocketLike,
  LiveHostValidator,
} from "../../types/livehost.types.js";
import { decode_livehost_message, encode_livehost_message, is_livehost_json_value } from "./livehost.protocol.js";
import { make_livehost_resume_log } from "./livehost.resume.js";
import { make_livehost_sync_manager } from "./livehost.sync.js";
import { make_livehost_canonical_stream } from "./livehost.history.js";
import { make_livehost_recovery_planner } from "./livehost.recovery.js";
import { make_livehost_session_manager } from "./livehost.session.js";
import { make_livehost_action_dedupe_store } from "./livehost.actions.js";

let livehost_session_inc = 0;

const DIRECT_ACTION_ORIGIN: LiveHostActionOrigin = Object.freeze({ kind: "direct" });

function make_livehost_session_id(): LiveHostSessionId {
  livehost_session_inc += 1;
  return `lhs-${Date.now().toString(36)}-${livehost_session_inc.toString(36)}`;
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

export function create_livehost<
  TState extends JsonValue | undefined = JsonValue | undefined,
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
>(options: LiveHostOptions<TState, TActions> = {}): LiveHost<TState, TActions> {
  const stateResult = decode_with_schema(options.schema?.state, options.state ?? {});
  const initialState: JsonValue = (stateResult.ok ? stateResult.value : options.state) ?? {};
  const map = hson.liveMap.fromJson(initialState) as unknown as LiveHost<TState, TActions>["map"];
  const stream = make_livehost_canonical_stream(map, {
    ...(options.logicalMapId !== undefined ? { logicalMapId: options.logicalMapId } : {}),
    ...(options.incarnationId !== undefined ? { incarnationId: options.incarnationId } : {}),
    ...(options.history !== undefined ? { history: options.history } : {}),
  });
  const recovery = make_livehost_recovery_planner(map, stream, options.recovery);
  const sync = make_livehost_sync_manager(map as unknown as LiveMap<JsonValue | undefined>);
  const sessions = make_livehost_session_manager(options.sessions);
  const resume = make_livehost_resume_log();
  const actions: Partial<LiveHostActions<TActions, TState>> = options.actions ?? {};
  let seq = 0;
  const actionRequests = make_livehost_action_dedupe_store(
    () => stream.headRev,
    () => seq,
    options.actionDedupe,
  );
  const connections = new Set<LiveHostDisposer>();
  let disposed = false;

  function next_seq(): LiveHostSeq {
    seq += 1;
    return seq;
  }

  function action_context(
    origin: LiveHostActionOrigin,
    emitEvent: LiveHostActionContext<TState>["emit_event"],
  ): LiveHostActionContext<TState> {
    return Object.freeze({ map, seq, origin, emit_event: emitEvent });
  }

  function validate_action(message: LiveHostClientActionMessage<TActions>):
    | Readonly<{ ok: true; handler: NonNullable<Partial<LiveHostActions<TActions, TState>>[keyof TActions & string]>; payload: JsonValue | undefined }>
    | Readonly<{ ok: false; code: "LIVEHOST_ACTION_UNAVAILABLE" | "LIVEHOST_ACTION_INVALID"; message: string }> {
    const handler = actions[message.name];
    if (!handler) {
      return { ok: false, code: "LIVEHOST_ACTION_UNAVAILABLE", message: `Unknown LiveHost action: ${message.name}` };
    }
    const actionSchema = options.schema?.actions?.[message.name];
    const payloadResult = decode_with_schema(actionSchema?.payload, message.payload);
    if (!payloadResult.ok) {
      return { ok: false, code: "LIVEHOST_ACTION_INVALID", message: schema_error_message(payloadResult.issues) };
    }
    return { ok: true, handler, payload: payloadResult.value };
  }

  async function execute_validated_action(
    message: LiveHostClientActionMessage<TActions>,
    handler: NonNullable<Partial<LiveHostActions<TActions, TState>>[keyof TActions & string]>,
    payload: JsonValue | undefined,
    origin: LiveHostActionOrigin,
    emitEvent: LiveHostActionContext<TState>["emit_event"],
  ): Promise<LiveHostActionTerminalOutcome> {
    try {
      const result = await handler(action_context(origin, emitEvent), payload as never, message);
      if (result !== undefined && !is_livehost_json_value(result)) {
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
      return Object.freeze({
        state: "succeeded",
        seq: next_seq(),
        completionRev: stream.headRev,
        ...(result !== undefined ? { result } : {}),
      });
    } catch (cause) {
      const causeCode = typeof cause === "object"
        && cause !== null
        && "code" in cause
        && typeof cause.code === "string"
        ? cause.code
        : "LIVEHOST_ACTION_FAILED";
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
  ): LiveHostServerMessage<TState> {
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
    emitEvent: LiveHostActionContext<TState>["emit_event"],
  ): Promise<LiveHostServerMessage<TState>> {
    if (disposed) {
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
    const validated = validate_action(message);
    if (!validated.ok) {
      return {
        type: "error",
        id: message.id,
        ok: false,
        seq,
        completionRev: stream.headRev,
        error: {
          message: validated.message,
          code: validated.code === "LIVEHOST_ACTION_UNAVAILABLE" ? "LIVEHOST_UNKNOWN_ACTION" : "LIVEHOST_SCHEMA_INVALID_PAYLOAD",
        },
      };
    }
    return action_response(
      message.id,
      await execute_validated_action(message, validated.handler, validated.payload, origin, emitEvent),
    );
  }

  function dispatch_action(message: LiveHostClientActionMessage<TActions>): Promise<LiveHostServerMessage<TState>> {
    return dispatch_action_scoped(message, DIRECT_ACTION_ORIGIN, () => false);
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

    function raw_send(message: LiveHostServerMessage<TState>): void {
      if (transportOpen) socket.send(encode_livehost_message(message));
    }

    function authoritative(): boolean {
      return transportOpen
        && !fenced
        && sessionId !== undefined
        && connectionEpoch !== undefined
        && sessions.is_active(sessionId, connectionEpoch);
    }

    function send_without_record(message: LiveHostServerMessage<TState>): void {
      if (authoritative()) raw_send(message);
    }

    function send(message: LiveHostServerMessage<TState>): void {
      if (!authoritative()) return;
      if (message.type === "sync") resume.record_sync(message);
      raw_send(message);
    }

    function dispose_recovery_channel(): void {
      const stop = stopRecoveryChannel;
      stopRecoveryChannel = undefined;
      stop?.();
    }

    function fence_attachment(fencedSessionId: LiveHostSessionId, epoch: number): void {
      if (sessionId !== fencedSessionId || connectionEpoch !== epoch || fenced) return;
      raw_send({ type: "session-fenced", sessionId: fencedSessionId, epoch, code: "LIVEHOST_SESSION_ATTACHMENT_FENCED" });
      fenced = true;
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

    function recovery_error(id: string, cause: unknown): void {
      const code = typeof cause === "object" && cause !== null && "code" in cause && typeof cause.code === "string"
        ? cause.code
        : "LIVEHOST_RECOVERY_TRANSPORT_FAILED";
      const message = cause instanceof Error ? cause.message : "LiveHost recovery transport failed.";
      send_without_record({ type: "recovery-error", id, error: { code, message } });
    }

    async function handle_deduped_action(
      message: LiveHostClientActionMessage<TActions>,
      origin: LiveHostActionOrigin,
    ): Promise<void> {
      if (!message.requestId || !message.clientId) {
        const response = await dispatch_action_scoped(
          message,
          origin,
          emit_connection_event,
        );

        send(response);

        if (response.type === "ack") {
          sync.sync_all(response.seq);
        }

        return;
      }

      const validated = validate_action(message);

      if (!validated.ok) {
        const code = validated.code === "LIVEHOST_ACTION_UNAVAILABLE"
          ? "LIVEHOST_UNKNOWN_ACTION"
          : "LIVEHOST_SCHEMA_INVALID_PAYLOAD";

        send({
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
            code,
            message: validated.message,
          },
        });

        return;
      }

      const result = await actionRequests.execute({
        clientId: message.clientId,
        requestId: message.requestId,
        actionName: message.name,
        payload: validated.payload,
        retry: message.retry === true,
        run: () => execute_validated_action(
          message,
          validated.handler,
          validated.payload,
          origin,
          emit_connection_event,
        ),
      });

      if (!result.ok) {
        send({
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
        });

        return;
      }

      const response = action_response(
        message.id,
        result.outcome,
        message.requestId,
        result.delivery,
        message.attemptId,
      );

      send(response);

      if (result.delivery === "executed" && response.type === "ack") {
        sync.sync_all(response.seq);
      }
    }

    function handle_recover(message: LiveHostClientRecoverMessage): void {
      if (!sessionId || connectionEpoch === undefined || !authoritative()) return;
      dispose_recovery_channel();
      let plan;
      try {
        plan = recovery.plan({
          logicalMapId: message.logicalMapId,
          ...(message.incarnationId !== undefined ? { incarnationId: message.incarnationId } : {}),
          ...(message.lastAppliedRev !== undefined ? { lastAppliedRev: message.lastAppliedRev } : {}),
        });
      } catch (cause) {
        recovery_error(message.id, cause);
        return;
      }
      if (plan.outcome === "reject") {
        send_without_record({ type: "recovery-plan", id: message.id, sessionId, logicalMapId: stream.logicalMapId, incarnationId: stream.incarnationId, headRev: stream.headRev, outcome: "reject", error: plan.error });
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
        const base = { type: "recovery-plan" as const, id: message.id, sessionId, logicalMapId: plan.logicalMapId, incarnationId: plan.incarnationId, headRev: plan.headRev };
        if (plan.outcome === "snapshot") send_without_record({ ...base, outcome: "snapshot", reason: plan.reason });
        else send_without_record({ ...base, outcome: plan.outcome });
        const completion = plan.complete((item) => {
          if (item.kind === "snapshot") send_without_record({ type: "recovery-snapshot", id: message.id, snapshot: item.snapshot });
          else send_without_record({ type: "recovery-commit", id: message.id, phase: "body", commit: item.commit });
        });
        stopLive = stream.on_commit((commit) => {
          if (!channelActive || !authoritative()) return;
          if (!liveReady) pendingLive.push(commit);
          else send_without_record({ type: "commit", id: message.id, commit });
        });
        send_without_record({ type: "recovery-caught-up", id: message.id, caughtUp: completion.caughtUp });
        for (const commit of completion.tail) send_without_record({ type: "recovery-commit", id: message.id, phase: "tail", commit });
        while (pendingLive.length) {
          const commit = pendingLive.shift();
          if (commit) send_without_record({ type: "commit", id: message.id, commit });
        }
        liveReady = true;
      } catch (cause) {
        dispose_recovery_channel();
        recovery_error(message.id, cause);
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
        await handle_deduped_action(message, origin);
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
  }

  return {
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
  };
}
