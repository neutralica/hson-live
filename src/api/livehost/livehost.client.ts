// livehost/client.ts

import { hson } from "../../hson.js";
import type { JsonValue, LiveMap, LiveMapOp } from "../../types/index.js";
import type {
  LiveHostActionId,
  LiveHostActionPayloads,
  LiveHostActionRequestId,
  LiveHostActionStatusId,
  LiveHostCanonicalCommit,
  LiveHostClient,
  LiveHostClientActionMessage,
  LiveHostClientActionPromise,
  LiveHostClientActionRequest,
  LiveHostClientActionResult,
  LiveHostClientActionStatusResult,
  LiveHostClientMessage,
  LiveHostClientOptions,
  LiveHostClientRecoveryChange,
  LiveHostClientRecoveryChangeListener,
  LiveHostClientRecoveryDiagnostics,
  LiveHostClientRecoveryFailure,
  LiveHostClientRecoveryResult,
  LiveHostClientRecoveryStatus,
  LiveHostClientRecoveryStrategy,
  LiveHostClientSessionDiagnostics,
  LiveHostClientSessionResult,
  LiveHostClientSessionStatus,
  LiveHostDisposer,
  LiveHostEventListener,
  LiveHostId,
  LiveHostRecoveryId,
  LiveHostSessionCredential,
  LiveHostSessionRequestId,
  LiveHostSeq,
  LiveHostServerMessage,
  LiveHostServerRecoveryPlanMessage,
} from "../../types/livehost.types.js";
import {
  LiveHostClientRecoveryError,
  LiveHostClientSessionError,
  LiveHostDisconnectedError,
  LiveHostDuplicateActionIdError,
} from "./livehost.error.js";
import { decode_livehost_server_message } from "./livehost.protocol.js";

let nextFallbackIdentityId = 0;
let nextActionAttemptId = 0;
let nextRecoveryId = 0;
let nextSessionRequestId = 0;
let nextActionStatusId = 0;

function make_reload_safe_id(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid !== undefined) return `${prefix}-${uuid}`;
  nextFallbackIdentityId += 1;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${nextFallbackIdentityId.toString(36)}`;
}

function make_client_id(): LiveHostId {
  return make_reload_safe_id("lhc");
}

function make_action_id(): LiveHostActionId {
  return make_reload_safe_id("lha");
}

function make_action_attempt_id(): LiveHostActionId {
  nextActionAttemptId += 1;
  return `lhaa-${nextActionAttemptId}`;
}

function make_recovery_id(): LiveHostRecoveryId {
  nextRecoveryId += 1;
  return `lhr-${nextRecoveryId}`;
}

function make_session_request_id(): LiveHostSessionRequestId {
  nextSessionRequestId += 1;
  return `lhsr-${nextSessionRequestId}`;
}

function make_action_status_id(): LiveHostActionStatusId {
  nextActionStatusId += 1;
  return `lhas-${nextActionStatusId}`;
}

function encode_client_message<TActions extends LiveHostActionPayloads>(message: LiveHostClientMessage<TActions>): string {
  return JSON.stringify(message);
}

type PendingAction = Readonly<{
  resolve: (result: LiveHostClientActionResult) => void;
  reject: (error: LiveHostDisconnectedError) => void;
}>;

type PendingActionStatus = Readonly<{
  requestId: LiveHostActionRequestId;
  resolve: (result: LiveHostClientActionStatusResult) => void;
  reject: (error: LiveHostDisconnectedError) => void;
}>;

type PendingRecovery = Readonly<{
  id: LiveHostRecoveryId;
  resolve: (result: LiveHostClientRecoveryResult) => void;
  reject: (error: LiveHostClientRecoveryError) => void;
}>;

type PendingSession = Readonly<{
  id: LiveHostSessionRequestId;
  kind: "create" | "reattach" | "goodbye";
  resolve: (result: LiveHostClientSessionResult | undefined) => void;
  reject: (error: LiveHostClientSessionError) => void;
}>;

function reject_pending_actions(
  pendingActions: Map<LiveHostActionId, PendingAction[]>,
  pendingAttempts: Map<LiveHostActionRequestId, LiveHostActionId[]>,
  error: LiveHostDisconnectedError,
): void {
  const actions = [...pendingActions.values()].flat();
  pendingActions.clear();
  pendingAttempts.clear();
  for (const action of actions) action.reject(error);
}

function reject_pending_action_statuses(
  pendingStatuses: Map<LiveHostActionStatusId, PendingActionStatus>,
  error: LiveHostDisconnectedError,
): void {
  const statuses = [...pendingStatuses.values()];
  pendingStatuses.clear();
  for (const status of statuses) status.reject(error);
}

function local_ops(commit: LiveHostCanonicalCommit): readonly LiveMapOp[] {
  return commit.ops.map((op): LiveMapOp => {
    const prev = op.prev.present ? op.prev.value : undefined;
    const next = op.next.present ? op.next.value : undefined;
    if (op.kind === "delete") return { kind: "delete", path: op.path, prev, next: undefined };
    if (op.kind === "splice") {
      if (!Array.isArray(prev) || !Array.isArray(next)) throw new Error("Canonical splice values must be arrays.");
      return { kind: "splice", path: op.path, start: op.start, removed: op.removed, inserted: op.inserted, prev, next };
    }
    if (next === undefined) throw new Error(`Canonical ${op.kind} next value is absent.`);
    return { kind: op.kind, path: op.path, prev, next };
  });
}

function clone_action_payload(value: JsonValue): JsonValue {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    const clone = value.map(clone_action_payload);
    Object.freeze(clone);
    return clone;
  }
  const clone: Record<string, JsonValue> = {};
  for (const key of Object.keys(value)) clone[key] = clone_action_payload(value[key]);
  return Object.freeze(clone);
}

export function create_livehost_client<
  TState extends JsonValue | undefined = JsonValue | undefined,
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
>(options: LiveHostClientOptions<TState>): LiveHostClient<TState, TActions> {
  if (options.recovery?.cursor && !options.map) {
    throw new Error("LiveHost recovery cursor requires the exact corresponding mirror.");
  }

  const clientId = options.clientId ?? make_client_id();
  const makeActionId = options.actionId ?? make_action_id;
  const makeActionAttemptId = options.actionAttemptId ?? make_action_attempt_id;
  const makeActionStatusId = options.actionStatusId ?? make_action_status_id;
  let map: LiveMap<TState> = options.map ?? hson.liveMap.fromJson({}) as unknown as LiveMap<TState>;
  const pendingActions = new Map<LiveHostActionId, PendingAction[]>();
  const pendingActionAttemptsByRequest = new Map<LiveHostActionRequestId, LiveHostActionId[]>();
  const pendingActionStatuses = new Map<LiveHostActionStatusId, PendingActionStatus>();
  const eventListeners = new Set<LiveHostEventListener>();
  const recoveryListeners = new Set<LiveHostClientRecoveryChangeListener<TState>>();
  const disposers: LiveHostDisposer[] = [];
  let seq: LiveHostSeq = 0;
  let isConnected = false;
  let recoveryDisposed = false;
  let recoveryStatus: LiveHostClientRecoveryStatus = "idle";
  let recoveryStrategy: LiveHostClientRecoveryStrategy | undefined;
  let incarnationId = options.recovery?.cursor?.incarnationId;
  let lastAppliedRev = options.recovery?.cursor?.lastAppliedRev;
  let firstFailure: LiveHostClientRecoveryFailure | undefined;
  let pendingRecovery: PendingRecovery | undefined;
  let activeRecoveryId: LiveHostRecoveryId | undefined;
  let stopRecoveryMessages: LiveHostDisposer | undefined;
  let recoveryPlan: LiveHostServerRecoveryPlanMessage | undefined;
  let bodyCommitsApplied = 0;
  let snapshotInstalls = 0;
  let duplicateCommitsIgnored = 0;
  let gapsDetected = 0;
  let replayConflicts = 0;
  let tailCommitsApplied = 0;
  let liveCommitsApplied = 0;
  let recoveryFailures = 0;
  let consumerNotifications = 0;
  let observerFailures = 0;
  let sessionStatus: LiveHostClientSessionStatus = "idle";
  let sessionId: string | undefined;
  let sessionCredential: LiveHostSessionCredential | undefined = options.session?.credential;
  let sessionEpoch: number | undefined;
  let sessionFailure: Readonly<{ code: string; message: string }> | undefined;
  let pendingSession: PendingSession | undefined;
  let sessionDisposed = false;
  let sessionCreateCount = 0;
  let sessionReattachCount = 0;
  let sessionFencingCount = 0;
  let sessionRejectionCount = 0;

  function send(message: LiveHostClientMessage<TActions>): void {
    options.socket.send(encode_client_message(message));
  }

  function fail_recovery(code: string, message: string, cause?: unknown): void {
    if (recoveryStatus === "disposed" || recoveryStatus === "failed") return;
    const failure = Object.freeze({ code, message, ...(cause !== undefined ? { cause } : {}) });
    firstFailure ??= failure;
    recoveryFailures += 1;
    recoveryStatus = "failed";
    recoveryStrategy = recoveryStrategy ?? "reject";
    recoveryPlan = undefined;
    activeRecoveryId = undefined;
    stopRecoveryMessages?.();
    stopRecoveryMessages = undefined;
    const pending = pendingRecovery;
    pendingRecovery = undefined;
    pending?.reject(new LiveHostClientRecoveryError(code, message, cause));
  }

  function notify(change: LiveHostClientRecoveryChange<TState>): void {
    consumerNotifications += 1;
    try {
      for (const listener of [...recoveryListeners]) listener(change);
    } catch (cause) {
      observerFailures += 1;
      fail_recovery("LIVEHOST_RECOVERY_OBSERVER_FAILED", "LiveHost recovery observer failed after state application.", cause);
    }
  }

  function require_plan(messageId: string): LiveHostServerRecoveryPlanMessage | undefined {
    if (activeRecoveryId !== messageId || !recoveryPlan) return undefined;
    return recoveryPlan;
  }

  function apply_commit(commit: LiveHostCanonicalCommit, phase: "body" | "tail" | "live"): void {
    if (recoveryStatus === "failed" || recoveryStatus === "disposed") return;
    const logicalMapId = options.recovery?.logicalMapId;
    if (!logicalMapId || commit.logicalMapId !== logicalMapId || commit.incarnationId !== incarnationId) {
      fail_recovery("LIVEHOST_RECOVERY_STREAM_MISMATCH", "Canonical commit does not match the active recovery stream.");
      return;
    }
    if (lastAppliedRev === undefined) {
      fail_recovery("LIVEHOST_RECOVERY_CURSOR_MISSING", "Canonical commit arrived before a mirror cursor was installed.");
      return;
    }
    if (commit.rev <= lastAppliedRev) {
      duplicateCommitsIgnored += 1;
      return;
    }
    if (commit.rev !== commit.prevRev + 1) {
      fail_recovery("LIVEHOST_RECOVERY_INVALID_REVISION_DELTA", "Canonical commit revision delta is invalid.");
      return;
    }
    if (commit.prevRev !== lastAppliedRev) {
      if (commit.prevRev > lastAppliedRev) gapsDetected += 1;
      fail_recovery(
        commit.prevRev > lastAppliedRev ? "LIVEHOST_RECOVERY_COMMIT_GAP" : "LIVEHOST_RECOVERY_COMMIT_OVERLAP",
        `Canonical commit expected prevRev ${lastAppliedRev}, received ${commit.prevRev}.`,
      );
      return;
    }

    const localRevBefore = map.rev;
    try {
      const applied = map.replay({ prevRev: localRevBefore, ops: local_ops(commit) });
      if (!applied.changed || map.rev !== localRevBefore + 1) {
        throw new Error("Canonical changed commit did not advance the client mirror exactly once.");
      }
    } catch (cause) {
      if (map.rev === localRevBefore + 1) {
        lastAppliedRev = commit.rev;
        observerFailures += 1;
        fail_recovery("LIVEHOST_RECOVERY_OBSERVER_FAILED", "A mirror observer failed after canonical state application.", cause);
      } else {
        replayConflicts += 1;
        fail_recovery("LIVEHOST_RECOVERY_REPLAY_CONFLICT", "Canonical commit conflicts with the client mirror.", cause);
      }
      return;
    }

    lastAppliedRev = commit.rev;
    if (phase === "body") bodyCommitsApplied += 1;
    if (phase === "tail") tailCommitsApplied += 1;
    if (phase === "live") liveCommitsApplied += 1;
    notify({ kind: "commit", logicalMapId, incarnationId: commit.incarnationId, rev: commit.rev, map });
  }

  function install_snapshot(messageId: string, snapshot: Extract<LiveHostServerMessage, { type: "recovery-snapshot" }>["snapshot"]): void {
    const plan = require_plan(messageId);
    if (!plan || plan.outcome !== "snapshot") return;
    if (snapshot.logicalMapId !== plan.logicalMapId || snapshot.incarnationId !== plan.incarnationId || snapshot.rev !== plan.headRev) {
      fail_recovery("LIVEHOST_RECOVERY_INVALID_SNAPSHOT", "Snapshot identity or revision does not match its recovery plan.");
      return;
    }
    try {
      const node = hson.fromHson(snapshot.hson).toNode();
      const value = hson.fromNode(node).toJson().value();
      if (value === undefined) {
        throw new Error("Recovery snapshot HSON did not project to a JsonValue.");
      }
      const staged = hson.liveMap.fromJson(value);
      const schema = map.schema.get();
      if (schema) staged.schema.use(schema);
      map = staged as unknown as LiveMap<TState>;
      incarnationId = snapshot.incarnationId;
      lastAppliedRev = snapshot.rev;
      snapshotInstalls += 1;
      notify({ kind: "snapshot", logicalMapId: snapshot.logicalMapId, incarnationId: snapshot.incarnationId, rev: snapshot.rev, map });
    } catch (cause) {
      fail_recovery("LIVEHOST_RECOVERY_INVALID_SNAPSHOT", "Snapshot replacement mirror could not be constructed.", cause);
    }
  }

  function handle_recovery_message(message: LiveHostServerMessage): boolean {
    if (message.type !== "recovery-plan" && message.type !== "recovery-commit" && message.type !== "recovery-snapshot" && message.type !== "recovery-caught-up" && message.type !== "commit" && message.type !== "recovery-error") return false;
    if (message.id !== activeRecoveryId || recoveryStatus === "failed" || recoveryStatus === "disposed") return true;

    if (message.type === "recovery-plan") {
      if (message.logicalMapId !== options.recovery?.logicalMapId) {
        fail_recovery("LIVEHOST_RECOVERY_STREAM_MISMATCH", "Recovery plan targets a different logical map.");
        return true;
      }
      recoveryPlan = message;
      recoveryStrategy = message.outcome;
      if (message.outcome === "reject") {
        fail_recovery(message.error.code, message.error.message);
        return true;
      }
      if (message.outcome !== "snapshot" && (incarnationId !== message.incarnationId || lastAppliedRev === undefined)) {
        fail_recovery("LIVEHOST_RECOVERY_CURSOR_MISMATCH", "Recovery plan requires a matching complete mirror cursor.");
      }
      return true;
    }

    if (message.type === "recovery-error") {
      fail_recovery(message.error.code ?? "LIVEHOST_RECOVERY_FAILED", message.error.message, message.error.cause);
      return true;
    }

    const plan = require_plan(message.id);
    if (!plan || plan.outcome === "reject") return true;
    if (message.type === "recovery-snapshot") {
      install_snapshot(message.id, message.snapshot);
      return true;
    }
    if (message.type === "recovery-commit") {
      apply_commit(message.commit, message.phase);
      return true;
    }
    if (message.type === "commit") {
      apply_commit(message.commit, "live");
      return true;
    }

    const caught = message.caughtUp;
    if (caught.logicalMapId !== plan.logicalMapId || caught.incarnationId !== plan.incarnationId || caught.throughRev !== plan.headRev || incarnationId !== caught.incarnationId || lastAppliedRev !== caught.throughRev) {
      fail_recovery("LIVEHOST_RECOVERY_CAUGHT_UP_MISMATCH", "Caught-up boundary does not match the installed mirror cursor.");
      return true;
    }
    recoveryStatus = "caught_up";
    const pending = pendingRecovery;
    pendingRecovery = undefined;
    const previousIncarnation = options.recovery?.cursor?.incarnationId;
    pending?.resolve({
      strategy: plan.outcome,
      sessionId: plan.sessionId,
      logicalMapId: plan.logicalMapId,
      incarnationId: plan.incarnationId,
      headRev: plan.headRev,
      incarnationChanged: previousIncarnation !== undefined && previousIncarnation !== plan.incarnationId,
    });
    return true;
  }

  function is_recovery_message(message: LiveHostServerMessage): boolean {
    return message.type === "recovery-plan"
      || message.type === "recovery-commit"
      || message.type === "recovery-snapshot"
      || message.type === "recovery-caught-up"
      || message.type === "commit"
      || message.type === "recovery-error";
  }

  function is_session_message(
    message: LiveHostServerMessage,
  ): message is Extract<LiveHostServerMessage, { type: "session-created" | "session-attached" | "session-rejected" | "session-fenced" | "session-ended" }> {
    return message.type === "session-created"
      || message.type === "session-attached"
      || message.type === "session-rejected"
      || message.type === "session-fenced"
      || message.type === "session-ended";
  }

  function handle_session_message(
    message: Extract<LiveHostServerMessage, { type: "session-created" | "session-attached" | "session-rejected" | "session-fenced" | "session-ended" }>,
  ): void {
    if (sessionDisposed) return;
    if (message.type === "session-fenced") {
      if (sessionId !== message.sessionId || sessionEpoch !== message.epoch) return;
      sessionFencingCount += 1;
      sessionStatus = "detached";
      sessionFailure ??= Object.freeze({ code: message.code, message: "LiveHost session attachment was fenced." });
      reject_pending_actions(pendingActions, pendingActionAttemptsByRequest, new LiveHostDisconnectedError());
      reject_pending_action_statuses(pendingActionStatuses, new LiveHostDisconnectedError());
      if (recoveryStatus === "recovering" || recoveryStatus === "caught_up") {
        fail_recovery(message.code, "LiveHost session attachment was fenced.");
      }
      return;
    }
    const pending = pendingSession;
    if (!pending || pending.id !== message.id) return;
    pendingSession = undefined;
    if (message.type === "session-rejected") {
      sessionRejectionCount += 1;
      sessionStatus = "failed";
      sessionFailure ??= Object.freeze({ code: message.code, message: message.message });
      pending.reject(new LiveHostClientSessionError(message.code, message.message));
      return;
    }
    if (message.type === "session-ended") {
      sessionStatus = "ended";
      sessionCredential = undefined;
      reject_pending_actions(pendingActions, pendingActionAttemptsByRequest, new LiveHostDisconnectedError());
      reject_pending_action_statuses(pendingActionStatuses, new LiveHostDisconnectedError());
      pending.resolve(undefined);
      return;
    }
    sessionId = message.sessionId;
    sessionEpoch = message.epoch;
    sessionStatus = "attached";
    if (message.type === "session-created") {
      sessionCredential = message.credential;
      sessionCreateCount += 1;
    } else {
      sessionReattachCount += 1;
    }
    pending.resolve({ sessionId: message.sessionId, epoch: message.epoch, reattached: message.type === "session-attached" });
  }

  function install_recovery_messages(): void {
    if (stopRecoveryMessages || recoveryDisposed) return;
    stopRecoveryMessages = options.socket.onMessage((raw) => {
      const decoded = decode_livehost_server_message(raw);
      if (!decoded.ok) {
        if (recoveryStatus === "recovering" || recoveryStatus === "caught_up") {
          fail_recovery("LIVEHOST_RECOVERY_PROTOCOL_DECODE_FAILED", decoded.error.message, decoded.error.cause);
        }
        return;
      }
      if (is_recovery_message(decoded.value)) handle_recovery_message(decoded.value);
    }) ?? (() => { });
  }

  function handle_server_message(message: LiveHostServerMessage): void {
    if (handle_recovery_message(message)) return;
    if (is_session_message(message)) {
      handle_session_message(message);
      return;
    }
    if (message.type === "event") {
      for (const listener of [...eventListeners]) listener(message);
      return;
    }
    if (message.type === "hello") {
      seq = message.seq;
      map.replace(message.snapshot as never);
      return;
    }
    if (message.type === "sync") {
      seq = message.seq;

      if (message.path.length === 0) {
        map.replace(message.value as never);
      } else {
        map.set(message.path, message.value as never);
      }

      return;
    }
    if (message.type === "patch") {
      seq = message.seq;
      return;
    }
    if (message.type === "action-status") {
      const pending = pendingActionStatuses.get(message.id);
      if (!pending || pending.requestId !== message.requestId) return;
      pendingActionStatuses.delete(message.id);
      pending.resolve({
        requestId: message.requestId,
        state: message.state,
        ...(message.outcome ? { outcome: message.outcome } : {}),
      });
      return;
    }
    if (message.type === "ack" || message.type === "error") {
      seq = message.seq;
      if (!message.id) return;
      const legacyAttempts = pendingActionAttemptsByRequest.get(message.id);
      const routeId = message.attemptId ?? (pendingActions.has(message.id) ? message.id : legacyAttempts?.[0] ?? message.id);
      const actions = pendingActions.get(routeId);
      const action = actions?.shift();
      if (!action) return;
      if (actions?.length === 0) pendingActions.delete(routeId);
      for (const [requestId, attempts] of pendingActionAttemptsByRequest) {
        const index = attempts.indexOf(routeId);
        if (index < 0) continue;
        attempts.splice(index, 1);
        if (attempts.length === 0) pendingActionAttemptsByRequest.delete(requestId);
        break;
      }
      action.resolve(message);
    }
  }

  function connect(): LiveHostDisposer {
    if (isConnected) return disconnect;
    isConnected = true;
    const stopMessage = options.socket.onMessage((raw) => {
      const decoded = decode_livehost_server_message(raw);
      if (!decoded.ok || is_recovery_message(decoded.value)) return;
      handle_server_message(decoded.value);
    });
    if (stopMessage) disposers.push(stopMessage);
    const stopClose = options.socket.onClose(disconnect);
    if (stopClose) disposers.push(stopClose);
    if (options.recovery) install_recovery_messages();
    if (!options.recovery && !options.session) send({ type: "hello", clientId, lastSeq: seq });
    return disconnect;
  }

  function disconnect(): void {
    if (!isConnected) return;
    isConnected = false;
    while (disposers.length) disposers.pop()?.();
    stopRecoveryMessages?.();
    stopRecoveryMessages = undefined;
    reject_pending_actions(pendingActions, pendingActionAttemptsByRequest, new LiveHostDisconnectedError());
    reject_pending_action_statuses(pendingActionStatuses, new LiveHostDisconnectedError());
    const sessionPending = pendingSession;
    pendingSession = undefined;
    sessionPending?.reject(new LiveHostClientSessionError("LIVEHOST_SESSION_DISCONNECTED", "LiveHost session transport disconnected."));
    if (sessionStatus === "attached") sessionStatus = "detached";
    if (recoveryStatus === "recovering" || recoveryStatus === "caught_up") {
      fail_recovery("LIVEHOST_RECOVERY_DISCONNECTED", "LiveHost recovery transport disconnected.");
    }
  }

  function recover(): Promise<LiveHostClientRecoveryResult> {
    if (recoveryDisposed) return Promise.reject(new LiveHostClientRecoveryError("LIVEHOST_RECOVERY_DISPOSED", "LiveHost client recovery is disposed."));
    if (!options.recovery) return Promise.reject(new LiveHostClientRecoveryError("LIVEHOST_RECOVERY_NOT_CONFIGURED", "LiveHost client recovery is not configured."));
    if (!isConnected) return Promise.reject(new LiveHostClientRecoveryError("LIVEHOST_RECOVERY_DISCONNECTED", "LiveHost recovery requires a connected transport."));
    if (pendingRecovery) return Promise.reject(new LiveHostClientRecoveryError("LIVEHOST_RECOVERY_IN_PROGRESS", "LiveHost recovery is already in progress."));
    const id = make_recovery_id();
    install_recovery_messages();
    activeRecoveryId = id;
    recoveryStatus = "recovering";
    recoveryStrategy = undefined;
    recoveryPlan = undefined;
    const promise = new Promise<LiveHostClientRecoveryResult>((resolve, reject) => {
      pendingRecovery = { id, resolve, reject };
    });
    send({
      type: "recover",
      id,
      logicalMapId: options.recovery.logicalMapId,
      ...(incarnationId !== undefined && lastAppliedRev !== undefined ? { incarnationId, lastAppliedRev } : {}),
    });
    return promise;
  }

  function dispose_recovery(): void {
    if (recoveryDisposed) return;
    recoveryDisposed = true;
    const pending = pendingRecovery;
    pendingRecovery = undefined;
    activeRecoveryId = undefined;
    stopRecoveryMessages?.();
    stopRecoveryMessages = undefined;
    recoveryPlan = undefined;
    recoveryStatus = "disposed";
    pending?.reject(new LiveHostClientRecoveryError("LIVEHOST_RECOVERY_DISPOSED", "LiveHost client recovery was disposed."));
    recoveryListeners.clear();
  }

  function on_change(listener: LiveHostClientRecoveryChangeListener<TState>): LiveHostDisposer {
    if (recoveryDisposed) return () => { };
    recoveryListeners.add(listener);
    return () => recoveryListeners.delete(listener);
  }

  function debug(): LiveHostClientRecoveryDiagnostics {
    return Object.freeze({
      status: recoveryStatus,
      ...(recoveryStrategy ? { strategy: recoveryStrategy } : {}),
      ...(options.recovery ? { logicalMapId: options.recovery.logicalMapId } : {}),
      ...(incarnationId ? { incarnationId } : {}),
      ...(lastAppliedRev !== undefined ? { lastAppliedRev } : {}),
      bodyCommitsApplied,
      snapshotInstalls,
      duplicateCommitsIgnored,
      gapsDetected,
      replayConflicts,
      tailCommitsApplied,
      liveCommitsApplied,
      recoveryFailures,
      consumerNotifications,
      observerFailures,
    });
  }

  function begin_session_request(
    kind: PendingSession["kind"],
    message: LiveHostClientMessage<TActions>,
  ): Promise<LiveHostClientSessionResult | undefined> {
    if (sessionDisposed) return Promise.reject(new LiveHostClientSessionError("LIVEHOST_SESSION_DISPOSED", "LiveHost client session API is disposed."));
    if (!isConnected) return Promise.reject(new LiveHostClientSessionError("LIVEHOST_SESSION_DISCONNECTED", "LiveHost session requires a connected transport."));
    if (pendingSession) return Promise.reject(new LiveHostClientSessionError("LIVEHOST_SESSION_REQUEST_PENDING", "A LiveHost session request is already pending."));
    if (kind === "create") sessionStatus = "creating";
    if (kind === "reattach") sessionStatus = "attaching";
    const id = "id" in message && typeof message.id === "string" ? message.id : make_session_request_id();
    const promise = new Promise<LiveHostClientSessionResult | undefined>((resolve, reject) => {
      pendingSession = { id, kind, resolve, reject };
    });
    send(message);
    return promise;
  }

  async function create_session(): Promise<LiveHostClientSessionResult> {
    if (sessionStatus === "attached") throw new LiveHostClientSessionError("LIVEHOST_SESSION_ALREADY_ATTACHED", "A LiveHost session is already attached.");
    const id = make_session_request_id();
    const result = await begin_session_request("create", { type: "session-create", id });
    if (!result) throw new LiveHostClientSessionError("LIVEHOST_SESSION_CREATE_FAILED", "LiveHost session creation produced no result.");
    return result;
  }

  async function reattach_session(credential = sessionCredential): Promise<LiveHostClientSessionResult> {
    if (sessionStatus === "attached") throw new LiveHostClientSessionError("LIVEHOST_SESSION_ALREADY_ATTACHED", "A LiveHost session is already attached.");
    const id = make_session_request_id();
    const result = await begin_session_request("reattach", {
      type: "session-attach",
      id,
      ...(credential !== undefined ? { credential } : {}),
    });
    if (!result) throw new LiveHostClientSessionError("LIVEHOST_SESSION_ATTACH_FAILED", "LiveHost session reattachment produced no result.");
    sessionCredential = credential;
    return result;
  }

  async function goodbye_session(): Promise<void> {
    if (sessionStatus === "ended") throw new LiveHostClientSessionError("LIVEHOST_SESSION_ALREADY_GONE", "LiveHost session is already ended.");
    if (sessionStatus !== "attached") throw new LiveHostClientSessionError("LIVEHOST_SESSION_NOT_ATTACHED", "No authoritative LiveHost session is attached.");
    const id = make_session_request_id();
    const result = await begin_session_request("goodbye", { type: "session-goodbye", id });
    void result;
  }

  function dispose_session(): void {
    if (sessionDisposed) return;
    sessionDisposed = true;
    const pending = pendingSession;
    pendingSession = undefined;
    sessionStatus = "disposed";
    pending?.reject(new LiveHostClientSessionError("LIVEHOST_SESSION_DISPOSED", "LiveHost client session API was disposed."));
  }

  function debug_session(): LiveHostClientSessionDiagnostics {
    return Object.freeze({
      status: sessionStatus,
      ...(sessionId ? { sessionId } : {}),
      ...(sessionEpoch !== undefined ? { epoch: sessionEpoch } : {}),
      hasCredential: sessionCredential !== undefined,
      createCount: sessionCreateCount,
      reattachCount: sessionReattachCount,
      fencingCount: sessionFencingCount,
      rejectionCount: sessionRejectionCount,
    });
  }

  function subscribe(path: readonly (string | number)[]): void { send({ type: "subscribe", path: [...path] }); }
  function unsubscribe(path: readonly (string | number)[]): void { send({ type: "unsubscribe", path: [...path] }); }
  function on_event(listener: LiveHostEventListener): LiveHostDisposer {
    eventListeners.add(listener);
    return () => eventListeners.delete(listener);
  }

  function action_handle<TName extends keyof TActions & string>(
    request: LiveHostClientActionRequest<TActions, TName>,
    retry: boolean,
  ): LiveHostClientActionPromise<TActions, TName> {
    const attemptId = makeActionAttemptId();
    const connected = isConnected && (options.session === undefined || sessionStatus === "attached");
    const duplicateNewId = pendingActions.has(attemptId);
    const promise = connected && !duplicateNewId
      ? new Promise<LiveHostClientActionResult>((resolve, reject) => {
        const waiters = pendingActions.get(attemptId) ?? [];
        waiters.push({ resolve, reject });
        pendingActions.set(attemptId, waiters);
        const attempts = pendingActionAttemptsByRequest.get(request.requestId) ?? [];
        attempts.push(attemptId);
        pendingActionAttemptsByRequest.set(request.requestId, attempts);
      })
      : Promise.reject(duplicateNewId
        ? new LiveHostDuplicateActionIdError(attemptId)
        : new LiveHostDisconnectedError());
    const handle: LiveHostClientActionPromise<TActions, TName> = Object.assign(promise, { request });
    if (connected && !duplicateNewId) {
      const message = {
        type: "action",
        id: request.requestId,
        requestId: request.requestId,
        attemptId,
        clientId,
        name: request.name,
        ...(request.payload !== undefined ? { payload: request.payload } : {}),
        ...(retry ? { retry: true as const } : {}),
      } as LiveHostClientActionMessage<TActions>;
      send(message);
    }
    return handle;
  }

  function action<TName extends keyof TActions & string>(
    name: TName,
    ...args: undefined extends TActions[TName] ? [payload?: TActions[TName]] : [payload: TActions[TName]]
  ): LiveHostClientActionPromise<TActions, TName> {
    const requestId = makeActionId();
    const payload = args[0];
    const request = Object.freeze({
      requestId,
      name,
      ...(payload !== undefined ? { payload: clone_action_payload(payload as JsonValue) as TActions[TName] } : {}),
    });
    return action_handle(request, false);
  }

  function retry_action<TName extends keyof TActions & string>(
    request: LiveHostClientActionRequest<TActions, TName>,
  ): LiveHostClientActionPromise<TActions, TName> {
    const stableRequest: LiveHostClientActionRequest<TActions, TName> = Object.freeze({
      requestId: request.requestId,
      name: request.name,
      ...(request.payload !== undefined ? { payload: clone_action_payload(request.payload as JsonValue) as TActions[TName] } : {}),
    });
    return action_handle(stableRequest, true);
  }

  function action_status(requestId: LiveHostActionRequestId): Promise<LiveHostClientActionStatusResult> {
    if (!isConnected || (options.session !== undefined && sessionStatus !== "attached")) return Promise.reject(new LiveHostDisconnectedError());
    const id = makeActionStatusId();
    const result = new Promise<LiveHostClientActionStatusResult>((resolve, reject) => {
      pendingActionStatuses.set(id, { requestId, resolve, reject });
    });
    send({ type: "action-status", id, clientId, requestId });
    return result;
  }

  const recovery = Object.freeze({
    get status() { return recoveryStatus; },
    get logicalMapId() { return options.recovery?.logicalMapId; },
    get incarnationId() { return incarnationId; },
    get lastAppliedRev() { return lastAppliedRev; },
    get map() { return map; },
    get failure() { return firstFailure; },
    get strategy() { return recoveryStrategy; },
    recover,
    on_change,
    dispose: dispose_recovery,
    debug,
  });

  const session = Object.freeze({
    get status() { return sessionStatus; },
    get sessionId() { return sessionId; },
    get credential() { return sessionCredential; },
    get epoch() { return sessionEpoch; },
    get failure() { return sessionFailure; },
    create: create_session,
    reattach: reattach_session,
    goodbye: goodbye_session,
    dispose: dispose_session,
    debug: debug_session,
  });

  return Object.freeze({
    get map() { return map; },
    clientId,
    recovery,
    session,
    get seq() { return seq; },
    connect,
    disconnect,
    subscribe,
    unsubscribe,
    on_event,
    action,
    retry_action,
    action_status,
  });
}
