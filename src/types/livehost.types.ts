// livehost.types.ts

import type { JsonValue, LiveMap, LivePath, LiveMapOp } from "./index.js";

export type LiveHostId = string;
export type LiveHostStoreId = string;
export type LiveHostSessionId = string;
export type LiveHostActionId = string;
export type LiveHostActionRequestId = string;
export type LiveHostActionStatusId = string;
export type LiveHostActionName = string;
export type LiveHostSeq = number;
export type LiveHostRecoveryId = string;
export type LiveHostSessionRequestId = string;
export type LiveHostSessionCredential = string;
export type LiveHostConnectionEpoch = number;
export type LiveHostLogicalMapId = string;
export type LiveHostIncarnationId = string;

export type LiveHostDisposer = () => void;
export type LiveHostSchemaIssue = string;

/** Wire-safe representation of a projected value that may be absent. */
export type LiveHostWireValue =
  | Readonly<{ present: false }>
  | Readonly<{ present: true; value: JsonValue }>;

export type LiveHostCanonicalSetOp = Readonly<{
  kind: "set";
  path: LivePath;
  prev: LiveHostWireValue;
  next: LiveHostWireValue;
}>;

export type LiveHostCanonicalDeleteOp = Readonly<{
  kind: "delete";
  path: LivePath;
  prev: LiveHostWireValue;
  next: Readonly<{ present: false }>;
}>;

export type LiveHostCanonicalReplaceOp = Readonly<{
  kind: "replace";
  path: LivePath;
  prev: LiveHostWireValue;
  next: LiveHostWireValue;
}>;

export type LiveHostCanonicalSpliceOp = Readonly<{
  kind: "splice";
  path: LivePath;
  start: number;
  removed: readonly JsonValue[];
  inserted: readonly JsonValue[];
  prev: LiveHostWireValue;
  next: LiveHostWireValue;
}>;

export type LiveHostCanonicalOp =
  | LiveHostCanonicalSetOp
  | LiveHostCanonicalDeleteOp
  | LiveHostCanonicalReplaceOp
  | LiveHostCanonicalSpliceOp;

/** One immutable changed commit in an incarnation's authoritative stream. */
export type LiveHostCanonicalCommit = Readonly<{
  logicalMapId: LiveHostLogicalMapId;
  incarnationId: LiveHostIncarnationId;
  prevRev: number;
  rev: number;
  ops: readonly LiveHostCanonicalOp[];
}>;

export type LiveHostCanonicalCommitListener = (commit: LiveHostCanonicalCommit) => void;

export type LiveHostCanonicalHistoryOptions = Readonly<{
  maxCommits?: number;
  maxBytes?: number;
}>;

export type LiveHostCanonicalStreamOptions = Readonly<{
  logicalMapId?: LiveHostLogicalMapId;
  incarnationId?: LiveHostIncarnationId;
  history?: LiveHostCanonicalHistoryOptions;
}>;

export type LiveHostCanonicalHistoryDiagnostics = Readonly<{
  logicalMapId: LiveHostLogicalMapId;
  incarnationId: LiveHostIncarnationId;
  headRev: number;
  firstRetainedCommitRev?: number;
  lastRetainedCommitRev?: number;
  earliestResumableBaseRev: number;
  retainedCommitCount: number;
  retainedEncodedBytes: number;
  maxCommits: number;
  maxBytes: number;
  publishedCommitCount: number;
  publicationErrorCount: number;
}>;

export type LiveHostCanonicalHistory = Readonly<{
  can_replay: (fromRev: number, throughRev?: number) => boolean;
  replay_after: (fromRev: number, throughRev?: number) => readonly LiveHostCanonicalCommit[] | undefined;
  debug: () => LiveHostCanonicalHistoryDiagnostics;
}>;

export type LiveHostCanonicalStream = Readonly<{
  logicalMapId: LiveHostLogicalMapId;
  incarnationId: LiveHostIncarnationId;
  readonly headRev: number;
  history: LiveHostCanonicalHistory;
  on_commit: (listener: LiveHostCanonicalCommitListener) => LiveHostDisposer;
}>;

export type LiveHostSnapshotEnvelope = Readonly<{
  logicalMapId: LiveHostLogicalMapId;
  incarnationId: LiveHostIncarnationId;
  rev: number;
  value: JsonValue;
}>;

export type LiveHostRecoveryRequest = Readonly<{
  logicalMapId: LiveHostLogicalMapId;
  incarnationId?: LiveHostIncarnationId;
  lastAppliedRev?: number;
}>;

export type LiveHostRecoveryOptions = Readonly<{
  maxTailCommits?: number;
  maxTailBytes?: number;
}>;

/** Deterministic planning barriers for race-focused tests and diagnostics. */
export type LiveHostRecoveryHooks = Readonly<{
  before_cut?: () => void;
  during_snapshot_capture?: () => void;
  after_cut?: (headRev: number) => void;
}>;

export type LiveHostRecoveryRejectCode =
  | "LIVEHOST_RECOVERY_INVALID_TARGET"
  | "LIVEHOST_RECOVERY_INVALID_REQUEST"
  | "REVISION_AHEAD_OF_AUTHORITY";

export type LiveHostRecoveryRuntimeErrorCode =
  | "LIVEHOST_RECOVERY_TAIL_OVERFLOW"
  | "LIVEHOST_RECOVERY_TAIL_GAP"
  | "LIVEHOST_RECOVERY_DISPOSED"
  | "LIVEHOST_RECOVERY_COMPLETED"
  | "LIVEHOST_RECOVERY_SNAPSHOT_FAILED"
  | "LIVEHOST_RECOVERY_REPLAY_FAILED"
  | "LIVEHOST_RECOVERY_OBSERVER_FAILED"
  | "LIVEHOST_RECOVERY_PLANNING_FAILED";

export type LiveHostRecoveryRejection = Readonly<{
  code: LiveHostRecoveryRejectCode;
  message: string;
  authoritativeRev: number;
  incarnationId: LiveHostIncarnationId;
}>;

export type LiveHostRecoveryCaughtUp = Readonly<{
  kind: "caught_up";
  logicalMapId: LiveHostLogicalMapId;
  incarnationId: LiveHostIncarnationId;
  throughRev: number;
}>;

export type LiveHostRecoveryBodyItem =
  | Readonly<{ kind: "commit"; commit: LiveHostCanonicalCommit }>
  | Readonly<{ kind: "snapshot"; snapshot: LiveHostSnapshotEnvelope }>;

export type LiveHostRecoveryBodyObserver = (item: LiveHostRecoveryBodyItem) => void;

export type LiveHostRecoveryCompletion = Readonly<{
  caughtUp: LiveHostRecoveryCaughtUp;
  tail: readonly LiveHostCanonicalCommit[];
}>;

export type LiveHostRecoveryAttemptState = "active" | "completed" | "disposed" | "aborted";

export type LiveHostRecoveryAttemptDiagnostics = Readonly<{
  state: LiveHostRecoveryAttemptState;
  outcome: "current" | "replay" | "snapshot";
  headRev: number;
  queuedTailCommits: number;
  queuedTailBytes: number;
  maxTailCommits: number;
  maxTailBytes: number;
  errorCode?: LiveHostRecoveryRuntimeErrorCode;
}>;

export type LiveHostRecoveryAttemptBase = Readonly<{
  logicalMapId: LiveHostLogicalMapId;
  incarnationId: LiveHostIncarnationId;
  headRev: number;
  complete: (observer?: LiveHostRecoveryBodyObserver) => LiveHostRecoveryCompletion;
  dispose: LiveHostDisposer;
  debug: () => LiveHostRecoveryAttemptDiagnostics;
}>;

export type LiveHostRecoveryCurrentPlan = LiveHostRecoveryAttemptBase & Readonly<{
  outcome: "current";
  body: readonly [];
}>;

export type LiveHostRecoveryReplayPlan = LiveHostRecoveryAttemptBase & Readonly<{
  outcome: "replay";
  body: readonly LiveHostCanonicalCommit[];
}>;

export type LiveHostRecoverySnapshotReason =
  | "no_usable_revision"
  | "incarnation_mismatch"
  | "history_unavailable";

export type LiveHostRecoverySnapshotPlan = LiveHostRecoveryAttemptBase & Readonly<{
  outcome: "snapshot";
  reason: LiveHostRecoverySnapshotReason;
  body: LiveHostSnapshotEnvelope;
}>;

export type LiveHostRecoveryRejectPlan = Readonly<{
  outcome: "reject";
  error: LiveHostRecoveryRejection;
}>;

export type LiveHostRecoveryPlan =
  | LiveHostRecoveryCurrentPlan
  | LiveHostRecoveryReplayPlan
  | LiveHostRecoverySnapshotPlan
  | LiveHostRecoveryRejectPlan;

export type LiveHostRecoveryPlannerDiagnostics = Readonly<{
  activeAttemptCount: number;
  currentPlanCount: number;
  replayPlanCount: number;
  snapshotPlanCount: number;
  rejectPlanCount: number;
  completedAttemptCount: number;
  disposedAttemptCount: number;
  abortedAttemptCount: number;
  overflowCount: number;
}>;

export type LiveHostRecoveryPlanner = Readonly<{
  plan: (request: LiveHostRecoveryRequest, hooks?: LiveHostRecoveryHooks) => LiveHostRecoveryPlan;
  debug: () => LiveHostRecoveryPlannerDiagnostics;
}>;

export type LiveHostResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: LiveHostError }>;

export type LiveHostError = Readonly<{
  message: string;
  code?: string;
  path?: LivePath;
  cause?: unknown;
}>;

export type LiveHostValidator<TValue> = (value: unknown) => value is TValue;

export type LiveHostSchemaResult<TValue> =
  | Readonly<{ ok: true; value: TValue }>
  | Readonly<{ ok: false; issues: readonly LiveHostSchemaIssue[] }>;

export type LiveHostSchemaDecoder<TValue> = (value: unknown) => LiveHostSchemaResult<TValue>;

export type LiveHostActionPayloads = Readonly<Record<string, JsonValue | undefined>>;

export type LiveHostActionSchema<TPayload extends JsonValue | undefined = JsonValue | undefined> = Readonly<{
  payload?: LiveHostValidator<TPayload> | LiveHostSchemaDecoder<TPayload>;
}>;

export type LiveHostSchema<
  TState extends JsonValue | undefined = JsonValue | undefined,
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
> = Readonly<{
  state?: LiveHostValidator<TState> | LiveHostSchemaDecoder<TState>;
  actions?: Readonly<{
    [TName in keyof TActions & string]?: LiveHostActionSchema<TActions[TName]>;
  }>;
}>;

export type LiveHostSocketLike = Readonly<{
  send: (message: string) => void;
  close: (code?: number, reason?: string) => void;
  onMessage: (listener: (message: string) => void) => LiveHostDisposer | void;
  onClose: (listener: () => void) => LiveHostDisposer | void;
}>;

export type LiveHostClientHelloMessage = Readonly<{
  type: "hello";
  clientId?: LiveHostId;
  hostId?: LiveHostStoreId;
  lastSeq?: LiveHostSeq;
}>;

export type LiveHostClientActionMessageFor<
  TActions extends LiveHostActionPayloads,
  TName extends keyof TActions & string,
> = undefined extends TActions[TName]
  ? Readonly<{
    type: "action";
    id: LiveHostActionId;
    requestId?: LiveHostActionRequestId;
    attemptId?: LiveHostActionId;
    clientId?: LiveHostId;
    retry?: true;
    name: TName;
    payload?: TActions[TName];
  }>
  : Readonly<{
    type: "action";
    id: LiveHostActionId;
    requestId?: LiveHostActionRequestId;
    attemptId?: LiveHostActionId;
    clientId?: LiveHostId;
    retry?: true;
    name: TName;
    payload: TActions[TName];
  }>;

export type LiveHostClientActionMessage<
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
> = {
  [TName in keyof TActions & string]: LiveHostClientActionMessageFor<TActions, TName>;
}[keyof TActions & string];

export type LiveHostClientSubscribeMessage = Readonly<{
  type: "subscribe";
  path: LivePath;
}>;

export type LiveHostClientUnsubscribeMessage = Readonly<{
  type: "unsubscribe";
  path: LivePath;
}>;

export type LiveHostClientActionStatusMessage = Readonly<{
  type: "action-status";
  id: LiveHostActionStatusId;
  clientId: LiveHostId;
  requestId: LiveHostActionRequestId;
}>;

export type LiveHostClientRecoverMessage = Readonly<{
  type: "recover";
  id: LiveHostRecoveryId;
  logicalMapId: LiveHostLogicalMapId;
  incarnationId?: LiveHostIncarnationId;
  lastAppliedRev?: number;
}>;

export type LiveHostClientSessionCreateMessage = Readonly<{
  type: "session-create";
  id: LiveHostSessionRequestId;
}>;

export type LiveHostClientSessionAttachMessage = Readonly<{
  type: "session-attach";
  id: LiveHostSessionRequestId;
  credential?: unknown;
}>;

export type LiveHostClientSessionGoodbyeMessage = Readonly<{
  type: "session-goodbye";
  id: LiveHostSessionRequestId;
}>;

export type LiveHostClientMessage<
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
> =
  | LiveHostClientHelloMessage
  | LiveHostClientActionMessage<TActions>
  | LiveHostClientActionStatusMessage
  | LiveHostClientSubscribeMessage
  | LiveHostClientUnsubscribeMessage
  | LiveHostClientRecoverMessage
  | LiveHostClientSessionCreateMessage
  | LiveHostClientSessionAttachMessage
  | LiveHostClientSessionGoodbyeMessage;

export type LiveHostServerHelloMessage<TState extends JsonValue | undefined = JsonValue | undefined> = Readonly<{
  type: "hello";
  sessionId: LiveHostSessionId;
  seq: LiveHostSeq;
  snapshot: TState;
}>;

export type LiveHostServerPatchMessage = Readonly<{
  type: "patch";
  seq: LiveHostSeq;
  ops: readonly LiveMapOp[];
}>;

export type LiveHostServerEventMessage = Readonly<{
  type: "event";
  event: string;
  payload: JsonValue;
}>;

export type LiveHostServerSyncMessage<TValue extends JsonValue | undefined = JsonValue | undefined> = Readonly<{
  type: "sync";
  seq: LiveHostSeq;
  path: LivePath;
  value: TValue;
}>;

export type LiveHostServerAckMessage = Readonly<{
  type: "ack";
  id: LiveHostActionId;
  ok: true;
  seq: LiveHostSeq;
  result?: JsonValue;
  requestId?: LiveHostActionRequestId;
  attemptId?: LiveHostActionId;
  completionRev?: number;
  delivery?: LiveHostActionDelivery;
}>;

export type LiveHostServerErrorMessage = Readonly<{
  type: "error";
  id?: LiveHostActionId;
  ok?: false;
  seq: LiveHostSeq;
  error: LiveHostError;
  requestId?: LiveHostActionRequestId;
  attemptId?: LiveHostActionId;
  completionRev?: number;
  delivery?: LiveHostActionDelivery;
}>;

export type LiveHostActionDelivery = "executed" | "joined" | "cached" | "rejected";

export type LiveHostActionRequestErrorCode =
  | "LIVEHOST_ACTION_REQUEST_ID_MISSING"
  | "LIVEHOST_ACTION_REQUEST_ID_MALFORMED"
  | "LIVEHOST_ACTION_REQUEST_ID_CONFLICT"
  | "LIVEHOST_ACTION_REQUEST_UNKNOWN"
  | "LIVEHOST_ACTION_REQUEST_EXPIRED"
  | "LIVEHOST_ACTION_UNAVAILABLE"
  | "LIVEHOST_ACTION_INVALID"
  | "LIVEHOST_ACTION_OUTCOME_NORMALIZATION_FAILED"
  | "LIVEHOST_ACTION_DEDUPE_STORE_UNAVAILABLE";

export type LiveHostActionTerminalOutcome =
  | Readonly<{
    state: "succeeded";
    seq: LiveHostSeq;
    completionRev: number;
    result?: JsonValue;
  }>
  | Readonly<{
    state: "failed";
    seq: LiveHostSeq;
    completionRev: number;
    error: LiveHostError;
  }>;

export type LiveHostActionStatusState = "pending" | "succeeded" | "failed" | "unknown" | "expired";

export type LiveHostServerActionStatusMessage = Readonly<{
  type: "action-status";
  id: LiveHostActionStatusId;
  requestId: LiveHostActionRequestId;
  state: LiveHostActionStatusState;
  outcome?: LiveHostActionTerminalOutcome;
}>;

type LiveHostServerRecoveryPlanBase = Readonly<{
  type: "recovery-plan";
  id: LiveHostRecoveryId;
  sessionId: LiveHostSessionId;
  logicalMapId: LiveHostLogicalMapId;
  incarnationId: LiveHostIncarnationId;
  headRev: number;
}>;

export type LiveHostServerRecoveryPlanMessage =
  | LiveHostServerRecoveryPlanBase & Readonly<{ outcome: "current" }>
  | LiveHostServerRecoveryPlanBase & Readonly<{ outcome: "replay" }>
  | LiveHostServerRecoveryPlanBase & Readonly<{
    outcome: "snapshot";
    reason: LiveHostRecoverySnapshotReason;
  }>
  | LiveHostServerRecoveryPlanBase & Readonly<{
    outcome: "reject";
    error: LiveHostRecoveryRejection;
  }>;

export type LiveHostServerRecoveryCommitMessage = Readonly<{
  type: "recovery-commit";
  id: LiveHostRecoveryId;
  phase: "body" | "tail";
  commit: LiveHostCanonicalCommit;
}>;

export type LiveHostServerRecoverySnapshotMessage = Readonly<{
  type: "recovery-snapshot";
  id: LiveHostRecoveryId;
  snapshot: LiveHostSnapshotEnvelope;
}>;

export type LiveHostServerRecoveryCaughtUpMessage = Readonly<{
  type: "recovery-caught-up";
  id: LiveHostRecoveryId;
  caughtUp: LiveHostRecoveryCaughtUp;
}>;

export type LiveHostServerCanonicalCommitMessage = Readonly<{
  type: "commit";
  id: LiveHostRecoveryId;
  commit: LiveHostCanonicalCommit;
}>;

export type LiveHostServerRecoveryErrorMessage = Readonly<{
  type: "recovery-error";
  id: LiveHostRecoveryId;
  error: LiveHostError;
}>;

export type LiveHostSessionRejectCode =
  | "LIVEHOST_SESSION_CREDENTIAL_MISSING"
  | "LIVEHOST_SESSION_CREDENTIAL_MALFORMED"
  | "LIVEHOST_SESSION_CREDENTIAL_UNKNOWN"
  | "LIVEHOST_SESSION_CREDENTIAL_EXPIRED"
  | "LIVEHOST_SESSION_CREDENTIAL_REVOKED"
  | "LIVEHOST_SESSION_ATTACHMENT_FENCED"
  | "LIVEHOST_SESSION_NOT_ATTACHED"
  | "LIVEHOST_SESSION_ALREADY_GONE";

export type LiveHostServerSessionCreatedMessage = Readonly<{
  type: "session-created";
  id: LiveHostSessionRequestId;
  sessionId: LiveHostSessionId;
  credential: LiveHostSessionCredential;
  epoch: LiveHostConnectionEpoch;
}>;

export type LiveHostServerSessionAttachedMessage = Readonly<{
  type: "session-attached";
  id: LiveHostSessionRequestId;
  sessionId: LiveHostSessionId;
  epoch: LiveHostConnectionEpoch;
}>;

export type LiveHostServerSessionRejectedMessage = Readonly<{
  type: "session-rejected";
  id: LiveHostSessionRequestId;
  code: LiveHostSessionRejectCode;
  message: string;
}>;

export type LiveHostServerSessionFencedMessage = Readonly<{
  type: "session-fenced";
  sessionId: LiveHostSessionId;
  epoch: LiveHostConnectionEpoch;
  code: "LIVEHOST_SESSION_ATTACHMENT_FENCED";
}>;

export type LiveHostServerSessionEndedMessage = Readonly<{
  type: "session-ended";
  id: LiveHostSessionRequestId;
  sessionId: LiveHostSessionId;
  epoch: LiveHostConnectionEpoch;
}>;

export type LiveHostServerMessage<TState extends JsonValue | undefined = JsonValue | undefined> =
  | LiveHostServerHelloMessage<TState>
  | LiveHostServerEventMessage
  | LiveHostServerPatchMessage
  | LiveHostServerSyncMessage
  | LiveHostServerAckMessage
  | LiveHostServerErrorMessage
  | LiveHostServerActionStatusMessage
  | LiveHostServerRecoveryPlanMessage
  | LiveHostServerRecoveryCommitMessage
  | LiveHostServerRecoverySnapshotMessage
  | LiveHostServerRecoveryCaughtUpMessage
  | LiveHostServerCanonicalCommitMessage
  | LiveHostServerRecoveryErrorMessage
  | LiveHostServerSessionCreatedMessage
  | LiveHostServerSessionAttachedMessage
  | LiveHostServerSessionRejectedMessage
  | LiveHostServerSessionFencedMessage
  | LiveHostServerSessionEndedMessage;

export type LiveHostActionContext<TState extends JsonValue | undefined = JsonValue | undefined> = Readonly<{
  map: LiveMap<TState>;
  seq: LiveHostSeq;
  emit_event: (event: string, payload: JsonValue) => boolean;
}>;

export type LiveHostActionHandler<
  TPayload extends JsonValue | undefined = JsonValue | undefined,
  TState extends JsonValue | undefined = JsonValue | undefined,
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
> = (
  ctx: LiveHostActionContext<TState>,
  payload: TPayload,
  message: LiveHostClientActionMessage<TActions>,
) => JsonValue | void | Promise<JsonValue | void>;

export type LiveHostActions<
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
  TState extends JsonValue | undefined = JsonValue | undefined,
> = Readonly<{
  [TName in keyof TActions & string]: LiveHostActionHandler<TActions[TName], TState, TActions>;
}>;

export type LiveHostOptions<
  TState extends JsonValue | undefined = JsonValue | undefined,
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
> = Readonly<{
  state?: TState;
  actions?: Partial<LiveHostActions<TActions, TState>>;
  schema?: LiveHostSchema<TState, TActions>;
  sessionId?: LiveHostSessionId | (() => LiveHostSessionId);
  logicalMapId?: LiveHostLogicalMapId;
  incarnationId?: LiveHostIncarnationId;
  history?: LiveHostCanonicalHistoryOptions;
  recovery?: LiveHostRecoveryOptions;
  sessions?: LiveHostSessionOptions;
  actionDedupe?: LiveHostActionDedupeOptions;
}>;

export type LiveHostActionDedupeSchedule = (
  delayMs: number,
  callback: () => void,
) => LiveHostDisposer;

export type LiveHostActionDedupeOptions = Readonly<{
  namespace?: string;
  maxTerminalRecords?: number;
  maxTerminalBytes?: number;
  terminalRetentionMs?: number;
  maxExpiredTombstones?: number;
  now?: () => number;
  schedule?: LiveHostActionDedupeSchedule;
}>;

export type LiveHostActionDedupeDiagnostics = Readonly<{
  pendingRequestCount: number;
  pendingWaiterCount: number;
  retainedTerminalCount: number;
  retainedTerminalBytes: number;
  expiredTombstoneCount: number;
  joinedPendingDuplicateCount: number;
  cachedOutcomeResponseCount: number;
  requestIdConflictCount: number;
  expiredRecordCount: number;
  unknownStatusQueryCount: number;
  executionsStarted: number;
  executionsSucceeded: number;
  executionsFailed: number;
  outcomeNormalizationFailureCount: number;
  oldestRetainedTerminalCompletedAt?: number;
  oldestRetainedTerminalCompletionRev?: number;
  disposed: boolean;
}>;

export type LiveHostActionDedupeInspector = Readonly<{
  debug: () => LiveHostActionDedupeDiagnostics;
  dispose: LiveHostDisposer;
}>;

export type LiveHostSessionSchedule = (
  delayMs: number,
  callback: () => void,
) => LiveHostDisposer;

export type LiveHostSessionOptions = Readonly<{
  graceMs?: number;
  now?: () => number;
  schedule?: LiveHostSessionSchedule;
  credential?: () => LiveHostSessionCredential;
}>;

export type LiveHostSessionState = "attached" | "disconnected" | "expired" | "revoked";

export type LiveHostSessionDiagnostic = Readonly<{
  sessionId: LiveHostSessionId;
  state: LiveHostSessionState;
  resumable: boolean;
  activeConnectionEpoch: LiveHostConnectionEpoch;
  transportAttached: boolean;
  subscriptionCount: number;
  disconnectedAt?: number;
  expiresAt?: number;
  reattachmentCount: number;
  fencingCount: number;
  expiryCount: number;
}>;

export type LiveHostSessionDiagnostics = Readonly<{
  activeSessionCount: number;
  attachedSessionCount: number;
  disconnectedSessionCount: number;
  expiredSessionCount: number;
  revokedSessionCount: number;
  reattachmentCount: number;
  fencingCount: number;
  expiryCount: number;
  rejectedCredentialCounts: Readonly<Partial<Record<LiveHostSessionRejectCode, number>>>;
  sessions: readonly LiveHostSessionDiagnostic[];
}>;

export type LiveHostSessionInspector = Readonly<{
  debug: () => LiveHostSessionDiagnostics;
  dispose: LiveHostDisposer;
}>;

export type LiveHostClientActionResult = LiveHostServerAckMessage | LiveHostServerErrorMessage;

export type LiveHostClientActionRequest<
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
  TName extends keyof TActions & string = keyof TActions & string,
> = Readonly<{
  requestId: LiveHostActionRequestId;
  name: TName;
  payload?: TActions[TName];
}>;

export type LiveHostClientActionPromise<
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
  TName extends keyof TActions & string = keyof TActions & string,
> = Promise<LiveHostClientActionResult> & Readonly<{
  request: LiveHostClientActionRequest<TActions, TName>;
}>;

export type LiveHostEventListener = (message: LiveHostServerEventMessage) => void;

export type LiveHostConnection = LiveHostDisposer & Readonly<{
  emit_event: (event: string, payload: JsonValue) => void;
}>;

export type LiveHostClientActionFn<
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
> = <TName extends keyof TActions & string>(
  name: TName,
  ...args: undefined extends TActions[TName]
    ? [payload?: TActions[TName]]
    : [payload: TActions[TName]]
) => LiveHostClientActionPromise<TActions, TName>;

export type LiveHostClientRetryActionFn<
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
> = <TName extends keyof TActions & string>(
  request: LiveHostClientActionRequest<TActions, TName>,
) => LiveHostClientActionPromise<TActions, TName>;

export type LiveHostClientActionStatusResult = Readonly<{
  requestId: LiveHostActionRequestId;
  state: LiveHostActionStatusState;
  outcome?: LiveHostActionTerminalOutcome;
}>;

export type LiveHostClientRecoveryStatus = "idle" | "recovering" | "caught_up" | "failed" | "disposed";
export type LiveHostClientRecoveryStrategy = "current" | "replay" | "snapshot" | "reject";

export type LiveHostClientRecoveryCursor = Readonly<{
  incarnationId: LiveHostIncarnationId;
  lastAppliedRev: number;
}>;

export type LiveHostClientRecoveryOptions = Readonly<{
  logicalMapId: LiveHostLogicalMapId;
  cursor?: LiveHostClientRecoveryCursor;
}>;

export type LiveHostClientRecoveryFailure = Readonly<{
  code: string;
  message: string;
  cause?: unknown;
}>;

export type LiveHostClientRecoveryChange<TState extends JsonValue | undefined = JsonValue | undefined> = Readonly<{
  kind: "commit" | "snapshot";
  logicalMapId: LiveHostLogicalMapId;
  incarnationId: LiveHostIncarnationId;
  rev: number;
  map: LiveMap<TState>;
}>;

export type LiveHostClientRecoveryChangeListener<
  TState extends JsonValue | undefined = JsonValue | undefined,
> = (change: LiveHostClientRecoveryChange<TState>) => void;

export type LiveHostClientRecoveryResult = Readonly<{
  strategy: Exclude<LiveHostClientRecoveryStrategy, "reject">;
  sessionId: LiveHostSessionId;
  logicalMapId: LiveHostLogicalMapId;
  incarnationId: LiveHostIncarnationId;
  headRev: number;
  incarnationChanged: boolean;
}>;

export type LiveHostClientRecoveryDiagnostics = Readonly<{
  status: LiveHostClientRecoveryStatus;
  strategy?: LiveHostClientRecoveryStrategy;
  logicalMapId?: LiveHostLogicalMapId;
  incarnationId?: LiveHostIncarnationId;
  lastAppliedRev?: number;
  bodyCommitsApplied: number;
  snapshotInstalls: number;
  duplicateCommitsIgnored: number;
  gapsDetected: number;
  replayConflicts: number;
  tailCommitsApplied: number;
  liveCommitsApplied: number;
  recoveryFailures: number;
  consumerNotifications: number;
  observerFailures: number;
}>;

export type LiveHostClientRecovery<
  TState extends JsonValue | undefined = JsonValue | undefined,
> = Readonly<{
  readonly status: LiveHostClientRecoveryStatus;
  readonly logicalMapId: LiveHostLogicalMapId | undefined;
  readonly incarnationId: LiveHostIncarnationId | undefined;
  readonly lastAppliedRev: number | undefined;
  readonly map: LiveMap<TState>;
  readonly failure: LiveHostClientRecoveryFailure | undefined;
  readonly strategy: LiveHostClientRecoveryStrategy | undefined;
  recover: () => Promise<LiveHostClientRecoveryResult>;
  on_change: (listener: LiveHostClientRecoveryChangeListener<TState>) => LiveHostDisposer;
  dispose: LiveHostDisposer;
  debug: () => LiveHostClientRecoveryDiagnostics;
}>;

export type LiveHostClientSessionStatus = "idle" | "creating" | "attaching" | "attached" | "detached" | "failed" | "ended" | "disposed";

export type LiveHostClientSessionFailure = Readonly<{
  code: string;
  message: string;
}>;

export type LiveHostClientSessionResult = Readonly<{
  sessionId: LiveHostSessionId;
  epoch: LiveHostConnectionEpoch;
  reattached: boolean;
}>;

export type LiveHostClientSessionDiagnostics = Readonly<{
  status: LiveHostClientSessionStatus;
  sessionId?: LiveHostSessionId;
  epoch?: LiveHostConnectionEpoch;
  hasCredential: boolean;
  createCount: number;
  reattachCount: number;
  fencingCount: number;
  rejectionCount: number;
}>;

export type LiveHostClientSession = Readonly<{
  readonly status: LiveHostClientSessionStatus;
  readonly sessionId: LiveHostSessionId | undefined;
  readonly credential: LiveHostSessionCredential | undefined;
  readonly epoch: LiveHostConnectionEpoch | undefined;
  readonly failure: LiveHostClientSessionFailure | undefined;
  create: () => Promise<LiveHostClientSessionResult>;
  reattach: (credential?: LiveHostSessionCredential) => Promise<LiveHostClientSessionResult>;
  goodbye: () => Promise<void>;
  dispose: LiveHostDisposer;
  debug: () => LiveHostClientSessionDiagnostics;
}>;

export type LiveHostClientSessionOptions = Readonly<{
  credential?: LiveHostSessionCredential;
}>;

export type LiveHostClientOptions<
  TState extends JsonValue | undefined = JsonValue | undefined,
> = Readonly<{
  socket: LiveHostSocketLike;
  map?: LiveMap<TState>;
  /**
   * Logical client identity used to scope retry-safe action requests.
   * The default is reload-safe. Reuse an explicit value only when reconnecting
   * the same logical client and preserving its outstanding request lineage.
   */
  clientId?: LiveHostId;
  /**
   * Factory for fresh action request IDs. `action()` calls it once per new
   * command; `retry_action()` retains the request ID in the supplied descriptor.
   */
  actionId?: () => LiveHostActionId;
  actionAttemptId?: () => LiveHostActionId;
  actionStatusId?: () => LiveHostActionStatusId;
  recovery?: LiveHostClientRecoveryOptions;
  session?: LiveHostClientSessionOptions;
}>;

export type LiveHostClient<
  TState extends JsonValue | undefined = JsonValue | undefined,
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
> = Readonly<{
  map: LiveMap<TState>;
  clientId: LiveHostId;
  recovery: LiveHostClientRecovery<TState>;
  session: LiveHostClientSession;
  seq: LiveHostSeq;
  connect: () => LiveHostDisposer;
  disconnect: () => void;
  subscribe: (path: LivePath) => void;
  unsubscribe: (path: LivePath) => void;
  on_event: (listener: LiveHostEventListener) => LiveHostDisposer;
  action: LiveHostClientActionFn<TActions>;
  retry_action: LiveHostClientRetryActionFn<TActions>;
  action_status: (requestId: LiveHostActionRequestId) => Promise<LiveHostClientActionStatusResult>;
}>;

export type LiveHost<
  TState extends JsonValue | undefined = JsonValue | undefined,
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
> = Readonly<{
  map: LiveMap<TState>;
  stream: LiveHostCanonicalStream;
  recovery: LiveHostRecoveryPlanner;
  sessions: LiveHostSessionInspector;
  actionRequests: LiveHostActionDedupeInspector;
  seq: LiveHostSeq;
  schema?: LiveHostSchema<TState, TActions>;
  dispatch_action: (message: LiveHostClientActionMessage<TActions>) => Promise<LiveHostServerMessage<TState>>;
  connect: (socket: LiveHostSocketLike) => LiveHostConnection;
}>;

export type LiveHostStoreEntry<
  TState extends JsonValue | undefined = JsonValue | undefined,
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
> = Readonly<{
  id: LiveHostStoreId;
  host: LiveHost<TState, TActions>;
}>;

export type LiveHostStoreCreateOptions<
  TState extends JsonValue | undefined = JsonValue | undefined,
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
> = LiveHostOptions<TState, TActions>;

export type LiveHostStore = Readonly<{
  has: (id: LiveHostStoreId) => boolean;
  get: (id: LiveHostStoreId) => LiveHost | undefined;
  create: <
    TState extends JsonValue | undefined = JsonValue | undefined,
    TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
  >(id: LiveHostStoreId, options?: LiveHostStoreCreateOptions<TState, TActions>) => LiveHostResult<LiveHost<TState, TActions>>;
  set: <
    TState extends JsonValue | undefined = JsonValue | undefined,
    TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
  >(id: LiveHostStoreId, host: LiveHost<TState, TActions>) => LiveHostResult<LiveHost<TState, TActions>>;
  delete: (id: LiveHostStoreId) => boolean;
  list: () => readonly LiveHostStoreEntry[];
  connect: (id: LiveHostStoreId, socket: LiveHostSocketLike) => LiveHostResult<LiveHostDisposer>;
}>;
