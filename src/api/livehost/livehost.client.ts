// livehost/client.ts

import { hson } from "../../hson.js";
import type {
  ClassifiedLiveMap,
  JsonValue,
  LiveMap,
  LiveMapAuthority,
  LiveMapGraphCommit,
  LiveMapGraphOp,
  LiveMapOp,
} from "../../types/index.js";
import type {
  LiveHostActionId,
  LiveHostActionPayloads,
  LiveHostActionRequestId,
  LiveHostActionStatusId,
  LiveHostCanonicalCommit,
  LiveHostClient,
  LiveHostClientForMap,
  LiveHostClientActionMessage,
  LiveHostClientActionPromise,
  LiveHostClientActionRequest,
  LiveHostClientActionResult,
  LiveHostClientActionStatusResult,
  LiveHostClientMessage,
  LiveHostClientOptions,
  LiveHostClientOptionsForMap,
  LiveHostClientRecoveryChange,
  LiveHostClientRecoveryChangeForMap,
  LiveHostClientRecoveryChangeListener,
  LiveHostClientRecoveryChangeListenerForMap,
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
  LiveHostSnapshotCapabilities,
  LiveHostSnapshotEncodingSelection,
} from "../../types/livehost.types.js";
import {
  LiveHostClientRecoveryError,
  LiveHostClientSessionError,
  LiveHostDisconnectedError,
  LiveHostDuplicateActionIdError,
} from "./livehost.error.js";
import { decode_livehost_client_server_message, is_livehost_json_value } from "./livehost.protocol.js";
import { create_live_trace_context, type LiveTraceContext } from "./livehost.trace.js";
import {
  decode_livehost_document_snapshot,
  LiveHostDocumentSnapshotDecodeError,
  type LiveHostDecodedServerMessage,
  type LiveHostValidatedSnapshotEnvelope,
} from "./livehost.document-snapshot.js";

let nextFallbackIdentityId = 0;
let nextActionAttemptId = 0;
let nextRecoveryId = 0;
let nextSessionRequestId = 0;
let nextActionStatusId = 0;

const CLIENT_SNAPSHOT_CAPABILITIES: LiveHostSnapshotCapabilities = Object.freeze({
  hson: true,
  viewStateVersions: Object.freeze([1]),
});

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

function recovery_trace_strategy(strategy: LiveHostClientRecoveryStrategy | undefined): string {
  if (strategy === "current") return "already-current";
  if (strategy === "replay") return "incremental-replay";
  return strategy ?? "unavailable";
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

type PendingRecovery = {
  id: LiveHostRecoveryId;
  resolve: (result: LiveHostClientRecoveryResult) => void;
  reject: (error: LiveHostClientRecoveryError) => void;
  trace?: LiveTraceContext;
  startedAt: number;
  localRevBefore: number;
  requestedRev?: number;
  commitCount: number;
  operationCount: number;
  operationKinds: string[];
  snapshotRev?: number;
};

type ClientRecoveryLifecycle =
  | Readonly<{ phase: "disconnected" | "idle" | "failed" }>
  | Readonly<{ phase: "awaiting-plan"; requestId: LiveHostRecoveryId }>
  | Readonly<{
    phase: "consuming";
    requestId: LiveHostRecoveryId;
    plan: Exclude<LiveHostServerRecoveryPlanMessage, { outcome: "reject" }>;
    snapshotReceived: boolean;
    tailStarted: boolean;
  }>
  | Readonly<{ phase: "caught-up"; requestId: LiveHostRecoveryId }>;

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
    if ("domain" in op) throw new Error("Canonical graph operation cannot replay on a projected mirror.");
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

function local_graph_commit(commit: LiveHostCanonicalCommit): LiveMapGraphCommit {
  const operations: LiveMapGraphOp[] = [];
  for (const operation of commit.ops) {
    if (!("domain" in operation)) {
      throw new Error("Canonical projected operation cannot replay on a document mirror.");
    }
    operations.push(operation);
  }
  return Object.freeze({
    changed: true,
    prevRev: commit.prevRev,
    rev: commit.rev,
    ops: Object.freeze(operations),
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
>(options: LiveHostClientOptions<TState>): LiveHostClient<TState, TActions>;
export function create_livehost_client<
  TMap extends ClassifiedLiveMap,
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
>(options: LiveHostClientOptionsForMap<TMap> & Readonly<{ map: TMap }>): LiveHostClientForMap<TMap, TActions>;
export function create_livehost_client<
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
>(options: LiveHostClientOptionsForMap<LiveMapAuthority>): unknown {
  if (options.recovery?.cursor && !options.map) {
    throw new Error("LiveHost recovery cursor requires the exact corresponding mirror.");
  }

  const clientId = options.clientId ?? make_client_id();
  const makeActionId = options.actionId ?? make_action_id;
  const makeActionAttemptId = options.actionAttemptId ?? make_action_attempt_id;
  const makeActionStatusId = options.actionStatusId ?? make_action_status_id;
  let map: ClassifiedLiveMap = classified_live_map(options.map);
  const pendingActions = new Map<LiveHostActionId, PendingAction[]>();
  const pendingActionAttemptsByRequest = new Map<LiveHostActionRequestId, LiveHostActionId[]>();
  const pendingActionStatuses = new Map<LiveHostActionStatusId, PendingActionStatus>();
  const eventListeners = new Set<LiveHostEventListener>();
  const recoveryListeners = new Set<LiveHostClientRecoveryChangeListenerForMap<ClassifiedLiveMap>>();
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
  let recoveryLifecycle: ClientRecoveryLifecycle = Object.freeze({ phase: "disconnected" });
  let stopRecoveryMessages: LiveHostDisposer | undefined;
  let negotiatedSnapshotEncoding: LiveHostSnapshotEncodingSelection | undefined;
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
    const pending = pendingRecovery;
    const failure = Object.freeze({ code, message, ...(cause !== undefined ? { cause } : {}) });
    firstFailure ??= failure;
    recoveryFailures += 1;
    recoveryStatus = "failed";
    recoveryStrategy = recoveryStrategy ?? "reject";
    recoveryLifecycle = Object.freeze({ phase: "failed" });
    stopRecoveryMessages?.();
    stopRecoveryMessages = undefined;
    pendingRecovery = undefined;
    pending?.trace?.emit({
      subsystem: "client",
      phase: "recovery.apply",
      status: "failure",
      details: () => ({
        requestId: pending.id,
        strategy: recovery_trace_strategy(recoveryStrategy),
        localRevBefore: pending.localRevBefore,
        ...(pending.requestedRev !== undefined ? { requestedRev: pending.requestedRev } : {}),
        commitCount: pending.commitCount,
        operationCount: pending.operationCount,
        localRevAfter: map.rev,
        outcome: "failed",
        errorCode: code,
      }),
    });
    pending?.trace?.emit({
      subsystem: "client",
      phase: "recovery.complete",
      status: "failure",
      durationMs: pending === undefined ? 0 : Math.max(0, Date.now() - pending.startedAt),
      details: () => ({
        requestId: pending?.id ?? "unknown",
        strategy: recovery_trace_strategy(recoveryStrategy),
        ...(pending?.requestedRev !== undefined ? { requestedRev: pending.requestedRev } : {}),
        finalRev: map.rev,
        commitCount: pending?.commitCount ?? 0,
        outcome: "failed",
        errorCode: code,
      }),
    });
    pending?.reject(new LiveHostClientRecoveryError(code, message, cause));
  }

  function notify(change: LiveHostClientRecoveryChangeForMap<ClassifiedLiveMap>): void {
    consumerNotifications += 1;
    try {
      for (const listener of [...recoveryListeners]) listener(change);
    } catch (cause) {
      observerFailures += 1;
      fail_recovery("LIVEHOST_RECOVERY_OBSERVER_FAILED", "LiveHost recovery observer failed after state application.", cause);
    }
  }

  function require_plan(messageId: string): LiveHostServerRecoveryPlanMessage | undefined {
    if (recoveryLifecycle.phase !== "consuming" || recoveryLifecycle.requestId !== messageId) return undefined;
    return recoveryLifecycle.plan;
  }

  function validate_snapshot_encoding_acknowledgment(
    selected: LiveHostSnapshotEncodingSelection | undefined,
  ): boolean {
    if (selected === undefined) {
      fail_recovery(
        "LIVEHOST_SNAPSHOT_NEGOTIATION_MISSING",
        "LiveHost recovery plan omitted the snapshot encoding acknowledgment.",
      );
      return false;
    }
    if (selected.format === "view-state"
      && !CLIENT_SNAPSHOT_CAPABILITIES.viewStateVersions?.includes(selected.formatVersion)) {
      fail_recovery(
        "LIVEHOST_SNAPSHOT_NEGOTIATION_UNSUPPORTED",
        "LiveHost selected an unsupported view-state snapshot version.",
      );
      return false;
    }
    if (negotiatedSnapshotEncoding !== undefined
      && (negotiatedSnapshotEncoding.format !== selected.format
        || (selected.format === "view-state"
          && (negotiatedSnapshotEncoding.format !== "view-state"
            || negotiatedSnapshotEncoding.formatVersion !== selected.formatVersion)))) {
      fail_recovery(
        "LIVEHOST_SNAPSHOT_NEGOTIATION_CHANGED",
        "LiveHost changed the selected snapshot encoding during one connection.",
      );
      return false;
    }
    negotiatedSnapshotEncoding = selected;
    return true;
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
    if (commit.mode !== map.mode) {
      fail_recovery(
        "LIVEHOST_RECOVERY_MAP_MODE_MISMATCH",
        `Canonical commit mode ${commit.mode} does not match mirror mode ${map.mode}.`,
      );
      return;
    }

    const localRevBefore = map.rev;
    try {
      const applied = map.mode === "element" || map.mode === "fragment"
        ? map.replay(local_graph_commit(commit))
        : map.replay({ prevRev: localRevBefore, ops: local_ops(commit) });
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
    if (pendingRecovery !== undefined && phase !== "live") {
      pendingRecovery.commitCount += 1;
      pendingRecovery.operationCount += commit.ops.length;
      pendingRecovery.operationKinds.push(...commit.ops.map((operation) =>
        "domain" in operation ? operation.op : operation.kind));
    }
    if (phase === "body") bodyCommitsApplied += 1;
    if (phase === "tail") tailCommitsApplied += 1;
    if (phase === "live") liveCommitsApplied += 1;
    notify({ kind: "commit", logicalMapId, incarnationId: commit.incarnationId, rev: commit.rev, map });
  }

  function install_snapshot(messageId: string, snapshot: LiveHostValidatedSnapshotEnvelope): void {
    const plan = require_plan(messageId);
    if (!plan || plan.outcome !== "snapshot") return;
    if (snapshot.logicalMapId !== plan.logicalMapId || snapshot.incarnationId !== plan.incarnationId || snapshot.rev !== plan.headRev) {
      fail_recovery("LIVEHOST_RECOVERY_INVALID_SNAPSHOT", "Snapshot identity or revision does not match its recovery plan.");
      return;
    }
    const snapshotFormat = "hson" in snapshot ? "hson" : "view-state";
    if (negotiatedSnapshotEncoding?.format !== snapshotFormat) {
      fail_recovery(
        "LIVEHOST_SNAPSHOT_NEGOTIATION_MISMATCH",
        "LiveHost recovery snapshot does not match the negotiated encoding.",
      );
      return;
    }
    try {
      if (is_projected_live_map(map)) {
        if (!("hson" in snapshot)) {
          throw new LiveHostDocumentSnapshotDecodeError(
            "LIVEHOST_RECOVERY_SNAPSHOT_MODE_MISMATCH",
            "Canonical document snapshot cannot restore a projected-data mirror.",
          );
        }
        const node = hson.fromHson(snapshot.hson).toNode();
        const staged = hson.liveMap.fromNode(node);
        if (staged.mode !== snapshot.mode || staged.mode !== map.mode || !is_projected_live_map(staged)) {
          throw new Error(`Recovery snapshot mode ${snapshot.mode} does not match mirror mode ${map.mode}.`);
        }
        const schema = map.schema.get();
        const capture = staged.capture();
        map.restore(Object.freeze({ rev: snapshot.rev, value: capture.value }));
        if (schema) map.schema.use(schema);
      } else if (is_document_live_map(map)) {
        const capture = decode_livehost_document_snapshot(snapshot);
        if (capture.mode !== map.mode) {
          throw new LiveHostDocumentSnapshotDecodeError(
            "LIVEHOST_RECOVERY_SNAPSHOT_MODE_MISMATCH",
            "LiveHost document snapshot mode does not match the mirror mode.",
          );
        }
        map.restore(capture);
      } else {
        throw new Error("Recovery snapshot reconstructed an incompatible map mode.");
      }
      incarnationId = snapshot.incarnationId;
      lastAppliedRev = snapshot.rev;
      if (pendingRecovery !== undefined) pendingRecovery.snapshotRev = snapshot.rev;
      snapshotInstalls += 1;
      if (recoveryLifecycle.phase === "consuming" && recoveryLifecycle.requestId === messageId) {
        recoveryLifecycle = Object.freeze({ ...recoveryLifecycle, snapshotReceived: true });
      }
      notify({ kind: "snapshot", logicalMapId: snapshot.logicalMapId, incarnationId: snapshot.incarnationId, rev: snapshot.rev, map });
    } catch (cause) {
      if (cause instanceof LiveHostDocumentSnapshotDecodeError) {
        fail_recovery(cause.code, cause.message, cause.cause);
        return;
      }
      fail_recovery("LIVEHOST_RECOVERY_INVALID_SNAPSHOT", "Snapshot replacement mirror could not be constructed.", cause);
    }
  }

  function handle_recovery_message(message: LiveHostDecodedServerMessage): boolean {
    if (message.type !== "recovery-plan" && message.type !== "recovery-commit" && message.type !== "recovery-snapshot" && message.type !== "recovery-caught-up" && message.type !== "commit" && message.type !== "recovery-error") return false;
    if (recoveryStatus === "failed" || recoveryStatus === "disposed") return true;
    const activeRequestId = recoveryLifecycle.phase === "awaiting-plan"
      || recoveryLifecycle.phase === "consuming"
      || recoveryLifecycle.phase === "caught-up"
      ? recoveryLifecycle.requestId
      : undefined;
    if (message.id !== activeRequestId) return true;

    if (message.type === "recovery-plan") {
      if (recoveryLifecycle.phase !== "awaiting-plan") {
        fail_recovery("LIVEHOST_RECOVERY_MESSAGE_OUT_OF_ORDER", "LiveHost sent more than one recovery plan for one recovery lifecycle.");
        return true;
      }
      if (message.logicalMapId !== options.recovery?.logicalMapId) {
        fail_recovery("LIVEHOST_RECOVERY_STREAM_MISMATCH", "Recovery plan targets a different logical map.");
        return true;
      }
      if (!validate_snapshot_encoding_acknowledgment(message.snapshotEncoding)) return true;
      recoveryStrategy = message.outcome;
      if (message.outcome === "reject") {
        fail_recovery(message.error.code, message.error.message);
        return true;
      }
      if (message.outcome !== "snapshot" && (incarnationId !== message.incarnationId || lastAppliedRev === undefined)) {
        fail_recovery("LIVEHOST_RECOVERY_CURSOR_MISMATCH", "Recovery plan requires a matching complete mirror cursor.");
        return true;
      }
      recoveryLifecycle = Object.freeze({
        phase: "consuming",
        requestId: message.id,
        plan: message,
        snapshotReceived: false,
        tailStarted: false,
      });
      return true;
    }

    if (message.type === "recovery-error") {
      fail_recovery(message.error.code ?? "LIVEHOST_RECOVERY_FAILED", message.error.message, message.error.cause);
      return true;
    }

    if (recoveryLifecycle.phase === "awaiting-plan") {
      fail_recovery("LIVEHOST_RECOVERY_MESSAGE_OUT_OF_ORDER", "LiveHost recovery material arrived before its recovery plan.");
      return true;
    }
    if (recoveryLifecycle.phase === "caught-up") {
      if (message.type === "commit") {
        apply_commit(message.commit, "live");
        return true;
      }
      fail_recovery("LIVEHOST_RECOVERY_MESSAGE_OUT_OF_ORDER", "LiveHost recovery material arrived after caught-up.");
      return true;
    }
    const plan = require_plan(message.id);
    if (!plan || plan.outcome === "reject" || recoveryLifecycle.phase !== "consuming") return true;
    if (message.type === "recovery-snapshot") {
      if (plan.outcome !== "snapshot" || recoveryLifecycle.snapshotReceived || recoveryLifecycle.tailStarted) {
        fail_recovery("LIVEHOST_RECOVERY_MESSAGE_OUT_OF_ORDER", "LiveHost recovery snapshot order is invalid.");
        return true;
      }
      install_snapshot(message.id, message.snapshot);
      return true;
    }
    if (message.type === "recovery-commit") {
      if (message.phase === "body") {
        if (plan.outcome !== "replay" || recoveryLifecycle.tailStarted) {
          fail_recovery("LIVEHOST_RECOVERY_MESSAGE_OUT_OF_ORDER", "LiveHost recovery body commit order is invalid.");
          return true;
        }
      } else {
        if (plan.outcome === "snapshot" && !recoveryLifecycle.snapshotReceived) {
          fail_recovery("LIVEHOST_RECOVERY_MESSAGE_OUT_OF_ORDER", "LiveHost recovery tail arrived before its snapshot.");
          return true;
        }
        if (!recoveryLifecycle.tailStarted) {
          recoveryLifecycle = Object.freeze({ ...recoveryLifecycle, tailStarted: true });
        }
      }
      apply_commit(message.commit, message.phase);
      return true;
    }
    if (message.type === "commit") {
      fail_recovery("LIVEHOST_RECOVERY_MESSAGE_OUT_OF_ORDER", "LiveHost live commit arrived before caught-up.");
      return true;
    }

    const caught = message.caughtUp;
    if (plan.outcome === "snapshot" && !recoveryLifecycle.snapshotReceived) {
      fail_recovery("LIVEHOST_RECOVERY_MESSAGE_OUT_OF_ORDER", "LiveHost caught-up arrived before its snapshot.");
      return true;
    }
    if (caught.logicalMapId !== plan.logicalMapId
      || caught.incarnationId !== plan.incarnationId
      || caught.throughRev < plan.headRev
      || incarnationId !== caught.incarnationId
      || lastAppliedRev !== caught.throughRev) {
      fail_recovery("LIVEHOST_RECOVERY_CAUGHT_UP_MISMATCH", "Caught-up boundary does not match the installed mirror cursor.");
      return true;
    }
    recoveryStatus = "caught_up";
    recoveryLifecycle = Object.freeze({ phase: "caught-up", requestId: message.id });
    const pending = pendingRecovery;
    pendingRecovery = undefined;
    const previousIncarnation = options.recovery?.cursor?.incarnationId;
    const strategy = recovery_trace_strategy(plan.outcome);
    pending?.trace?.emit({
      subsystem: "client",
      phase: "recovery.apply",
      status: "success",
      details: () => ({
        requestId: pending.id,
        logicalMapId: plan.logicalMapId,
        incarnationId: plan.incarnationId,
        strategy,
        localRevBefore: pending.localRevBefore,
        ...(pending.requestedRev !== undefined ? { requestedRev: pending.requestedRev } : {}),
        ...(pending.snapshotRev !== undefined ? { snapshotRev: pending.snapshotRev } : {}),
        commitCount: pending.commitCount,
        operationCount: pending.operationCount,
        operationKinds: pending.operationKinds,
        localRevAfter: map.rev,
        outcome: plan.outcome === "current" ? "already-current" : "applied",
      }),
    });
    pending?.trace?.emit({
      subsystem: "client",
      phase: "recovery.complete",
      status: "success",
      durationMs: Math.max(0, Date.now() - pending.startedAt),
      details: () => ({
        requestId: pending.id,
        logicalMapId: plan.logicalMapId,
        incarnationId: plan.incarnationId,
        strategy,
        ...(pending.requestedRev !== undefined ? { requestedRev: pending.requestedRev } : {}),
        targetRev: caught.throughRev,
        finalRev: map.rev,
        commitCount: pending.commitCount,
        outcome: plan.outcome === "current" ? "already-current" : "synchronized",
      }),
    });
    pending?.resolve({
      strategy: plan.outcome,
      sessionId: plan.sessionId,
      logicalMapId: plan.logicalMapId,
      incarnationId: plan.incarnationId,
      headRev: caught.throughRev,
      incarnationChanged: previousIncarnation !== undefined && previousIncarnation !== plan.incarnationId,
    });
    return true;
  }

  function is_recovery_message(message: LiveHostDecodedServerMessage): boolean {
    return message.type === "recovery-plan"
      || message.type === "recovery-commit"
      || message.type === "recovery-snapshot"
      || message.type === "recovery-caught-up"
      || message.type === "commit"
      || message.type === "recovery-error";
  }

  function is_session_message(
    message: LiveHostDecodedServerMessage,
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
      const decoded = decode_livehost_client_server_message(raw);
      if (!decoded.ok) {
        if (recoveryStatus === "recovering" || recoveryStatus === "caught_up") {
          fail_recovery(
            decoded.error.code ?? "LIVEHOST_RECOVERY_PROTOCOL_DECODE_FAILED",
            decoded.error.message,
            decoded.error.cause,
          );
        }
        return;
      }
      if (is_recovery_message(decoded.value)) handle_recovery_message(decoded.value);
    }) ?? (() => { });
  }

  function handle_server_message(message: LiveHostDecodedServerMessage): void {
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
      if (is_projected_live_map(map) && is_livehost_json_value(message.snapshot)) {
        map.replace(message.snapshot);
      }
      return;
    }
    if (message.type === "sync") {
      seq = message.seq;

      if (is_projected_live_map(map)) {
        if (message.path.length === 0) {
          if (is_livehost_json_value(message.value)) map.replace(message.value);
        } else if (message.value === undefined) {
          map.delete(message.path);
        } else {
          map.set(message.path, message.value);
        }
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
    if (!recoveryDisposed) {
      recoveryLifecycle = Object.freeze({ phase: "idle" });
      if (recoveryStatus === "failed" || recoveryStatus === "caught_up") {
        recoveryStatus = "idle";
        recoveryStrategy = undefined;
        firstFailure = undefined;
      }
    }
    const stopMessage = options.socket.onMessage((raw) => {
      const decoded = decode_livehost_client_server_message(raw);
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
    negotiatedSnapshotEncoding = undefined;
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
    recoveryLifecycle = Object.freeze({ phase: "disconnected" });
  }

  function recover(): Promise<LiveHostClientRecoveryResult> {
    if (recoveryDisposed) return Promise.reject(new LiveHostClientRecoveryError("LIVEHOST_RECOVERY_DISPOSED", "LiveHost client recovery is disposed."));
    if (!options.recovery) return Promise.reject(new LiveHostClientRecoveryError("LIVEHOST_RECOVERY_NOT_CONFIGURED", "LiveHost client recovery is not configured."));
    if (!isConnected) return Promise.reject(new LiveHostClientRecoveryError("LIVEHOST_RECOVERY_DISCONNECTED", "LiveHost recovery requires a connected transport."));
    if (pendingRecovery) return Promise.reject(new LiveHostClientRecoveryError("LIVEHOST_RECOVERY_IN_PROGRESS", "LiveHost recovery is already in progress."));
    if (recoveryStatus === "failed") return Promise.reject(new LiveHostClientRecoveryError("LIVEHOST_RECOVERY_LIFECYCLE_INVALID", "LiveHost recovery requires a reconnect after failure."));
    const id = make_recovery_id();
    install_recovery_messages();
    recoveryLifecycle = Object.freeze({ phase: "awaiting-plan", requestId: id });
    recoveryStatus = "recovering";
    recoveryStrategy = undefined;
    const recoveryOptions = options.recovery;
    const startedAt = Date.now();
    const trace = options.trace === undefined
      ? undefined
      : create_live_trace_context(options.trace, `lht-client-recovery-${id}`);
    trace?.emit({
      subsystem: "client",
      phase: "recovery.request",
      status: "event",
      details: () => ({
        requestId: id,
        logicalMapId: recoveryOptions.logicalMapId,
        mapMode: map.mode,
        reason: "explicit-recover",
        ...(lastAppliedRev !== undefined ? { requestedRev: lastAppliedRev } : {}),
        currentRev: map.rev,
      }),
    });
    const promise = new Promise<LiveHostClientRecoveryResult>((resolve, reject) => {
      pendingRecovery = {
        id,
        resolve,
        reject,
        ...(trace !== undefined ? { trace } : {}),
        startedAt,
        localRevBefore: map.rev,
        ...(lastAppliedRev !== undefined ? { requestedRev: lastAppliedRev } : {}),
        commitCount: 0,
        operationCount: 0,
        operationKinds: [],
      };
    });
    send({
      type: "recover",
      id,
      logicalMapId: recoveryOptions.logicalMapId,
      ...(incarnationId !== undefined && lastAppliedRev !== undefined ? { incarnationId, lastAppliedRev } : {}),
      snapshotCapabilities: CLIENT_SNAPSHOT_CAPABILITIES,
    });
    return promise;
  }

  function dispose_recovery(): void {
    if (recoveryDisposed) return;
    recoveryDisposed = true;
    const pending = pendingRecovery;
    pendingRecovery = undefined;
    recoveryLifecycle = Object.freeze({ phase: "failed" });
    stopRecoveryMessages?.();
    stopRecoveryMessages = undefined;
    recoveryStatus = "disposed";
    pending?.trace?.emit({
      subsystem: "client",
      phase: "recovery.complete",
      status: "failure",
      durationMs: Math.max(0, Date.now() - pending.startedAt),
      details: () => ({
        requestId: pending.id,
        strategy: recovery_trace_strategy(recoveryStrategy),
        finalRev: map.rev,
        commitCount: pending.commitCount,
        outcome: "cancelled",
        errorCode: "LIVEHOST_RECOVERY_DISPOSED",
      }),
    });
    pending?.reject(new LiveHostClientRecoveryError("LIVEHOST_RECOVERY_DISPOSED", "LiveHost client recovery was disposed."));
    recoveryListeners.clear();
  }

  function on_change(listener: LiveHostClientRecoveryChangeListenerForMap<ClassifiedLiveMap>): LiveHostDisposer {
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

function is_projected_live_map(map: LiveMapAuthority): map is LiveMap {
  return (map.mode === "data-object" || map.mode === "data-array")
    && "replace" in map
    && typeof map.replace === "function";
}

function is_document_live_map(map: LiveMapAuthority): map is Extract<ClassifiedLiveMap, { mode: "element" | "fragment" }> {
  return (map.mode === "element" || map.mode === "fragment")
    && "replay" in map
    && typeof map.replay === "function";
}

function classified_live_map(map: LiveMapAuthority | undefined): ClassifiedLiveMap {
  if (map === undefined) return hson.liveMap.fromJson({});
  if (is_projected_live_map(map) || is_document_live_map(map)) return map;
  throw new Error("LiveHost client map is not a classified LiveMap authority.");
}
