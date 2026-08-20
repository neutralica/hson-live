// One-map current LiveHost authority, recovery, session, and client contracts.
// livehost.types.ts

import type {
  ClassifiedLiveMap,
  DataLiveMapMode,
  DocumentLiveMap,
  LiveMap,
  LiveMapCoreSchemaApi,
  LiveMapDocumentAttributeValue,
  LiveMapDocumentAttrs,
  LiveMapDocumentContent,
  LiveMapDocumentCommitTarget,
  LiveMapDocumentTarget,
  LiveMapGraphOp,
  LiveMapProjectedGraphEnsureQuidOp,
  LiveMapAnyOp,
  LiveMapCommit,
  LiveMapAuthority,
  LiveMapDocumentApi,
  LiveMapRootMode,
  LiveMapPathArrayApi,
  LiveMapPathHandle,
  LiveMapPathObjectApi,
  LiveMapPathValue,
  LivePath,
  LiveMapOp,
  LiveMapStructuralJsonEnvelope,
} from "./livemap.types.js";
import type { JsonValue } from "../core/types.js";
import type {
  LiveHostCanonicalCommit,
  LiveHostCanonicalHistoryOptions,
  LiveHostCanonicalStream,
  LiveHostSnapshotEnvelope,
} from "./livehost.representation.types.js";
import type {
  LiveHostActionAuthorizer,
  LiveHostActionOrigin,
  LiveHostActionPayloads,
  LiveHostActionStatusState,
  LiveHostActionTerminalOutcome,
  LiveHostClientActionResult,
  LiveHostClientActionMessage,
  LiveHostConnectionContext,
  LiveHostDocumentActionFn,
  LiveHostDocumentRetryActionFn,
  LiveHostSchema,
  LiveHostServerAckMessage,
  LiveHostServerErrorMessage,
  LiveHostServerEventMessage,
  LiveHostServerMessage,
  LiveHostSessionRejectCode,
  LiveHostRecoveryCaughtUp,
  LiveHostRecoveryRejectCode,
  LiveHostRecoveryRejection,
  LiveHostRecoverySnapshotReason,
  LiveHostSocketLike,
} from "./livehost.protocol.types.js";
import type {
  LiveHostActionId,
  LiveHostActionName,
  LiveHostActionRequestId,
  LiveHostActionStatusId,
  LiveHostConnectionEpoch,
  LiveHostDisposer,
  LiveHostError,
  LiveHostId,
  LiveHostIncarnationId,
  LiveHostLogicalMapId,
  LiveHostRecoveryId,
  LiveHostResult,
  LiveHostSchemaDecoder,
  LiveHostSchemaIssue,
  LiveHostSessionCredential,
  LiveHostSessionId,
  LiveHostSessionRequestId,
  LiveHostSeq,
  LiveHostStoreId,
  LiveHostValidator,
} from "./livehost.shared.types.js";
import type { LiveTraceSink } from "./livehost.trace.types.js";


/** Wire-safe representation of a projected value that may be absent. */
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

export type LiveHostRecoveryRuntimeErrorCode =
  | "LIVEHOST_RECOVERY_TAIL_OVERFLOW"
  | "LIVEHOST_RECOVERY_TAIL_GAP"
  | "LIVEHOST_RECOVERY_DISPOSED"
  | "LIVEHOST_RECOVERY_COMPLETED"
  | "LIVEHOST_RECOVERY_SNAPSHOT_FAILED"
  | "LIVEHOST_RECOVERY_REPLAY_FAILED"
  | "LIVEHOST_RECOVERY_OBSERVER_FAILED"
  | "LIVEHOST_RECOVERY_NEGOTIATION_FAILED"
  | "LIVEHOST_RECOVERY_PLANNING_FAILED";

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
  dispose: LiveHostDisposer;
}>;

export type LiveHostActionContextForMap<
  TMap extends LiveMapAuthority = LiveMap<JsonValue | undefined>,
> = Readonly<{
  map: LiveHostReadonlyMap<TMap>;
  mutate: (
    mutation: (draft: LiveHostMutationDraft<TMap>) => LiveMapCommit<LiveMapAnyOp>,
  ) => Promise<LiveMapCommit<LiveMapAnyOp>>;
  seq: LiveHostSeq;
  origin: LiveHostActionOrigin;
  emit_event: (event: string, payload: JsonValue) => boolean;
}>;

type LiveHostDataMutationDraft<TMap extends LiveMapAuthority> = Omit<
  TMap,
  "commits" | "debug" | "feed" | "replay" | "restore" | "schema" | "sub"
>;

type LiveHostDocumentMutationDraft<TMap extends DocumentLiveMap> = Omit<
  TMap,
  "commits" | "debug" | "replay" | "restore"
>;

/** Ephemeral mutation surface used only inside host-owned staged callbacks. */
export type LiveHostMutationDraft<TMap extends LiveMapAuthority> =
  TMap extends DocumentLiveMap ? LiveHostDocumentMutationDraft<TMap>
  : LiveHostDataMutationDraft<TMap>;

type ReadonlyHostedDocumentApi = Readonly<{
  root: LiveMapDocumentApi["root"];
  byQuid: LiveMapDocumentApi["byQuid"];
  content: () => ReturnType<LiveMapDocumentApi["content"]>;
  attrs: Pick<LiveMapDocumentApi["attrs"], "get" | "has" | "keys" | "must">;
}>;

type LiveHostReadonlyPathObjectApi<TValue> = Pick<
  LiveMapPathObjectApi<TValue>,
  "is" | "toObject" | "pick" | "omit" | "hasKey" | "getKey" | "keys" | "isEmpty" | "size" | "values" | "entries"
>;

type LiveHostReadonlyPathArrayApi<TValue> = Pick<
  LiveMapPathArrayApi<TValue>,
  "is" | "toArray" | "slice" | "take" | "drop" | "takeLast" | "dropLast" | "length" | "isEmpty" | "at" | "first" | "last" | "includes" | "indexOf"
>;

type LiveHostReadonlyPathHandle<TValue> = Pick<
  LiveMapPathHandle<TValue>,
  "rev" | "path" | "snap" | "feed" | "watch"
> & Readonly<{
  at: <const TPath extends LivePath>(
    path: TPath & ([LiveMapPathValue<TValue, TPath>] extends [never] ? never : unknown),
  ) => LiveHostReadonlyPathHandle<LiveMapPathValue<TValue, TPath>>;
  array: LiveHostReadonlyPathArrayApi<TValue>;
  object: LiveHostReadonlyPathObjectApi<TValue>;
}>;

type LiveHostReadonlyDataMap<TValue, TMap extends LiveMap<TValue>> = Pick<
  TMap,
  "mode" | "rev" | "root" | "snap" | "capture" | "commits" | "feed" | "sub"
> & Readonly<{
  schema: Pick<LiveMapCoreSchemaApi<TValue>, "get" | "match" | "resolve" | "has" | "must">;
  at: <const TPath extends LivePath>(
    path: TPath & ([LiveMapPathValue<TValue, TPath>] extends [never] ? never : unknown),
  ) => LiveHostReadonlyPathHandle<LiveMapPathValue<TValue, TPath>>;
}>;

/** Read and observation surface exposed by a hosted authority. */
export type LiveHostReadonlyMap<TMap extends LiveMapAuthority> =
  TMap extends LiveMap<infer TValue>
    ? LiveHostReadonlyDataMap<TValue, TMap>
    : TMap extends DocumentLiveMap
      ? Pick<TMap, "mode" | "rev" | "root" | "capture" | "commits"> & Readonly<{ document: ReadonlyHostedDocumentApi }>
      : Pick<TMap, "mode" | "rev" | "root" | "capture" | "commits">;

export type LiveHostActionContext<
  TState extends JsonValue | undefined = JsonValue | undefined,
> = LiveHostActionContextForMap<LiveMap<TState>>;

export type LiveHostActionHandlerForMap<
  TPayload extends JsonValue | undefined = JsonValue | undefined,
  TMap extends LiveMapAuthority = LiveMap<JsonValue | undefined>,
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
> = (
  ctx: LiveHostActionContextForMap<TMap>,
  payload: TPayload,
  message: LiveHostClientActionMessage<TActions>,
) => JsonValue | void | Promise<JsonValue | void>;

export type LiveHostActionHandler<
  TPayload extends JsonValue | undefined = JsonValue | undefined,
  TState extends JsonValue | undefined = JsonValue | undefined,
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
> = LiveHostActionHandlerForMap<TPayload, LiveMap<TState>, TActions>;

export type LiveHostActionsForMap<
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
  TMap extends LiveMapAuthority = LiveMap<JsonValue | undefined>,
> = Readonly<{
  [TName in keyof TActions & string]: LiveHostActionHandlerForMap<TActions[TName], TMap, TActions>;
}>;

export type LiveHostActions<
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
  TState extends JsonValue | undefined = JsonValue | undefined,
> = LiveHostActionsForMap<TActions, LiveMap<TState>>;

export type LiveHostMapValue<TMap extends LiveMapAuthority> =
  TMap extends LiveMap<infer TValue extends JsonValue | undefined>
  ? TValue
  : TMap extends DocumentLiveMap
  ? undefined
  : JsonValue | undefined;

type LiveHostSharedOptions<
  TMap extends LiveMapAuthority,
  TActions extends LiveHostActionPayloads,
> = Readonly<{
  actions?: Partial<LiveHostActionsForMap<TActions, TMap>>;
  schema?: LiveHostSchema<LiveHostMapValue<TMap>, TActions>;
  sessionId?: LiveHostSessionId | (() => LiveHostSessionId);
  logicalMapId?: LiveHostLogicalMapId;
  incarnationId?: LiveHostIncarnationId;
  history?: LiveHostCanonicalHistoryOptions;
  recovery?: LiveHostRecoveryOptions;
  sessions?: LiveHostSessionOptions;
  actionDedupe?: LiveHostActionDedupeOptions;
  authorizeAction?: LiveHostActionAuthorizer<TActions>;
  trace?: LiveTraceSink;
}>;

export type ProjectedLiveHostOptions<
  TState extends JsonValue | undefined = JsonValue | undefined,
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
> = LiveHostSharedOptions<LiveMap<TState>, TActions> & Readonly<{
  state?: TState;
  map?: never;
}>;

export type ExistingMapLiveHostOptions<
  TMap extends LiveMapAuthority,
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
> = LiveHostSharedOptions<TMap, TActions> & Readonly<{
  map: TMap;
  state?: never;
}>;

/** Backward-compatible name for the projected-state constructor form. */
export type LiveHostOptions<
  TState extends JsonValue | undefined = JsonValue | undefined,
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
> = ProjectedLiveHostOptions<TState, TActions>;

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

export type LiveHostSessionLifecycleEvent =
  | Readonly<{
    kind: "attached";
    session: LiveHostSessionDiagnostic;
    attachment: "created" | "reattached";
  }>
  | Readonly<{
    kind: "detached";
    session: LiveHostSessionDiagnostic;
  }>
  | Readonly<{
    kind: "expired";
    session: LiveHostSessionDiagnostic;
  }>
  | Readonly<{
    kind: "revoked";
    session: LiveHostSessionDiagnostic;
    reason: "goodbye" | "host_disposed";
  }>
  | Readonly<{
    kind: "fenced";
    sessionId: LiveHostSessionId;
    epoch: LiveHostConnectionEpoch;
  }>;

export type LiveHostSessionInspector = Readonly<{
  debug: () => LiveHostSessionDiagnostics;
  on_change: (listener: (event: LiveHostSessionLifecycleEvent) => void) => LiveHostDisposer;
  dispose: LiveHostDisposer;
}>;

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

export type LiveHostClientRecoveryChangeForMap<
  TMap extends LiveMapAuthority = LiveMap<JsonValue | undefined>,
> = Readonly<{
  kind: "commit" | "snapshot";
  logicalMapId: LiveHostLogicalMapId;
  incarnationId: LiveHostIncarnationId;
  rev: number;
  map: TMap;
}>;

export type LiveHostClientRecoveryChangeListener<
  TState extends JsonValue | undefined = JsonValue | undefined,
> = (change: LiveHostClientRecoveryChange<TState>) => void;

export type LiveHostClientRecoveryChange<
  TState extends JsonValue | undefined = JsonValue | undefined,
> = LiveHostClientRecoveryChangeForMap<LiveMap<TState>>;

export type LiveHostClientRecoveryChangeListenerForMap<
  TMap extends LiveMapAuthority = LiveMap<JsonValue | undefined>,
> = (change: LiveHostClientRecoveryChangeForMap<TMap>) => void;

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

export type LiveHostClientRecoveryForMap<
  TMap extends LiveMapAuthority = LiveMap<JsonValue | undefined>,
> = Readonly<{
  readonly status: LiveHostClientRecoveryStatus;
  readonly logicalMapId: LiveHostLogicalMapId | undefined;
  readonly incarnationId: LiveHostIncarnationId | undefined;
  readonly lastAppliedRev: number | undefined;
  readonly map: TMap;
  readonly failure: LiveHostClientRecoveryFailure | undefined;
  readonly strategy: LiveHostClientRecoveryStrategy | undefined;
  recover: () => Promise<LiveHostClientRecoveryResult>;
  on_change: (listener: LiveHostClientRecoveryChangeListenerForMap<TMap>) => LiveHostDisposer;
  dispose: LiveHostDisposer;
  debug: () => LiveHostClientRecoveryDiagnostics;
}>;

export type LiveHostClientRecovery<
  TState extends JsonValue | undefined = JsonValue | undefined,
> = LiveHostClientRecoveryForMap<LiveMap<TState>>;

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

export type LiveHostClientOptionsForMap<
  TMap extends LiveMapAuthority = LiveMap<JsonValue | undefined>,
> = Readonly<{
  socket: LiveHostSocketLike;
  map?: TMap;
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
  /** Optional local-only client lifecycle trace sink. Never transmitted. */
  trace?: LiveTraceSink;
}>;

export type LiveHostClientOptions<
  TState extends JsonValue | undefined = JsonValue | undefined,
> = LiveHostClientOptionsForMap<LiveMap<TState>>;

export type LiveHostClientForMap<
  TMap extends LiveMapAuthority = LiveMap<JsonValue | undefined>,
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
> = Readonly<{
  map: TMap;
  clientId: LiveHostId;
  recovery: LiveHostClientRecoveryForMap<TMap>;
  session: LiveHostClientSession;
  seq: LiveHostSeq;
  connect: () => LiveHostDisposer;
  disconnect: () => void;
  subscribe: LiveHostProjectedSubscription<TMap>;
  unsubscribe: LiveHostProjectedSubscription<TMap>;
  on_event: (listener: LiveHostEventListener) => LiveHostDisposer;
  action: LiveHostClientActionFn<TActions> & LiveHostDocumentActionFn;
  retry_action: LiveHostClientRetryActionFn<TActions> & LiveHostDocumentRetryActionFn;
  action_status: (requestId: LiveHostActionRequestId) => Promise<LiveHostClientActionStatusResult>;
}>;

type LiveHostProjectedSubscription<TMap extends LiveMapAuthority> =
  [TMap["mode"]] extends [DataLiveMapMode] ? (path: LivePath) => void : never;

export type LiveHostClient<
  TState extends JsonValue | undefined = JsonValue | undefined,
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
> = LiveHostClientForMap<LiveMap<TState>, TActions>;

export type LiveHostForMap<
  TMap extends LiveMapAuthority = LiveMap<JsonValue | undefined>,
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
> = Readonly<{
  map: LiveHostReadonlyMap<TMap>;
  stream: LiveHostCanonicalStream<TMap>;
  activity: LiveHostActivity;
  recovery: LiveHostRecoveryPlanner;
  sessions: LiveHostSessionInspector;
  actionRequests: LiveHostActionDedupeInspector;
  seq: LiveHostSeq;
  schema?: LiveHostSchema<LiveHostMapValue<TMap>, TActions>;
  mutate: (
    mutation: (draft: LiveHostMutationDraft<TMap>) => LiveMapCommit<LiveMapAnyOp>,
  ) => Promise<LiveMapCommit<LiveMapAnyOp>>;
  dispatch_action: (message: LiveHostClientActionMessage<TActions>) => Promise<LiveHostServerMessage<LiveHostMapValue<TMap>>>;
  connect: (socket: LiveHostSocketLike, context?: LiveHostConnectionContext) => LiveHostConnection;
  dispose: LiveHostDisposer;
}>;

export type LiveHostActivityKind =
  | "connection"
  | "session"
  | "action"
  | "recovery"
  | "mutation"
  | "persistence";

export type LiveHostActivityState = "active" | "idle" | "disposed";

/** Non-sensitive quiescence information for application-owned authority lifecycle policy. */
export type LiveHostActivitySnapshot = Readonly<{
  state: LiveHostActivityState;
  connectionCount: number;
  retainedSessionCount: number;
  actionCount: number;
  recoveryCount: number;
  mutationCount: number;
  persistenceCount: number;
  blockerCount: number;
  blockers: readonly LiveHostActivityKind[];
}>;

export type LiveHostActivity = Readonly<{
  snapshot(): LiveHostActivitySnapshot;
  on_change(listener: (snapshot: LiveHostActivitySnapshot) => void): LiveHostDisposer;
}>;

/** Compatibility surface for existing projected-state hosts. */
export type LiveHost<
  TState extends JsonValue | undefined = JsonValue | undefined,
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
> = LiveHostForMap<LiveMap<TState>, TActions>;
