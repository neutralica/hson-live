// One-map current Locus authority, recovery, session, and client contracts.
// locus.types.ts

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
  LiveMapDataLibraryInput,
  LiveMapGraphOp,
  HsonSchemaValue,
  LiveMapLibraries,
  LiveMapLibrariesInput,
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
  LiveMapSetValue,
  LiveMapWriteValue,
  LivePath,
  LiveMapOp,
  LiveMapStructuralJsonEnvelope,
} from "./livemap.types.js";
import type { JsonValue } from "../core/types.js";
import type {
  LocusCanonicalCommit,
  LocusCanonicalHistoryOptions,
  LocusCanonicalStream,
  LocusSnapshotEnvelope,
} from "./locus.representation.types.js";
import type {
  LocusActionAuthorizer,
  LocusActionOrigin,
  LocusActionPayloads,
  LocusActionStatusState,
  LocusActionTerminalOutcome,
  LocusClientActionResult,
  LocusClientActionMessage,
  LocusConnectionContext,
  LocusDocumentActionFn,
  LocusDocumentRetryActionFn,
  LocusSchema,
  LocusServerAckMessage,
  LocusServerErrorMessage,
  LocusServerEventMessage,
  LocusServerMessage,
  LocusSessionRejectCode,
  LocusRecoveryCaughtUp,
  LocusRecoveryRejectCode,
  LocusRecoveryRejection,
  LocusRecoverySnapshotReason,
  LocusSocketLike,
} from "./locus.protocol.types.js";
import type {
  LocusActionId,
  LocusActionName,
  LocusActionRequestId,
  LocusActionStatusId,
  LocusConnectionEpoch,
  LocusDisposer,
  LocusError,
  LocusClientId,
  LocusIncarnationId,
  LocusLogicalMapId,
  LocusRecoveryId,
  LocusResult,
  LocusSchemaDecoder,
  LocusSchemaIssue,
  LocusSessionCredential,
  LocusSessionId,
  LocusSessionRequestId,
  LocusSeq,
  LocusValidator,
} from "./locus.shared.types.js";
import type { LiveTraceSink } from "./live.trace.types.js";


/** Wire-safe representation of a data value that may be absent. */
export type LocusRecoveryRequest = Readonly<{
  logicalMapId: LocusLogicalMapId;
  incarnationId?: LocusIncarnationId;
  lastAppliedRev?: number;
}>;

export type LocusRecoveryOptions = Readonly<{
  maxTailCommits?: number;
  maxTailBytes?: number;
}>;

/** Deterministic planning barriers for race-focused tests and diagnostics. */
export type LocusRecoveryHooks = Readonly<{
  before_cut?: () => void;
  during_snapshot_capture?: () => void;
  after_cut?: (headRev: number) => void;
}>;

export type LocusRecoveryRuntimeErrorCode =
  | "LOCUS_RECOVERY_TAIL_OVERFLOW"
  | "LOCUS_RECOVERY_TAIL_GAP"
  | "LOCUS_RECOVERY_DISPOSED"
  | "LOCUS_RECOVERY_COMPLETED"
  | "LOCUS_RECOVERY_SNAPSHOT_FAILED"
  | "LOCUS_RECOVERY_REPLAY_FAILED"
  | "LOCUS_RECOVERY_OBSERVER_FAILED"
  | "LOCUS_RECOVERY_NEGOTIATION_FAILED"
  | "LOCUS_RECOVERY_PLANNING_FAILED";

export type LocusRecoveryBodyItem =
  | Readonly<{ kind: "commit"; commit: LocusCanonicalCommit }>
  | Readonly<{ kind: "snapshot"; snapshot: LocusSnapshotEnvelope }>;

export type LocusRecoveryBodyObserver = (item: LocusRecoveryBodyItem) => void;

export type LocusRecoveryCompletion = Readonly<{
  caughtUp: LocusRecoveryCaughtUp;
  tail: readonly LocusCanonicalCommit[];
}>;

export type LocusRecoveryAttemptState = "active" | "completed" | "disposed" | "aborted";

export type LocusRecoveryAttemptDiagnostics = Readonly<{
  state: LocusRecoveryAttemptState;
  outcome: "current" | "replay" | "snapshot";
  headRev: number;
  queuedTailCommits: number;
  queuedTailBytes: number;
  maxTailCommits: number;
  maxTailBytes: number;
  errorCode?: LocusRecoveryRuntimeErrorCode;
}>;

export type LocusRecoveryAttemptBase = Readonly<{
  logicalMapId: LocusLogicalMapId;
  incarnationId: LocusIncarnationId;
  headRev: number;
  complete: (observer?: LocusRecoveryBodyObserver) => LocusRecoveryCompletion;
  dispose: LocusDisposer;
  debug: () => LocusRecoveryAttemptDiagnostics;
}>;

export type LocusRecoveryCurrentPlan = LocusRecoveryAttemptBase & Readonly<{
  outcome: "current";
  body: readonly [];
}>;

export type LocusRecoveryReplayPlan = LocusRecoveryAttemptBase & Readonly<{
  outcome: "replay";
  body: readonly LocusCanonicalCommit[];
}>;

export type LocusRecoverySnapshotPlan = LocusRecoveryAttemptBase & Readonly<{
  outcome: "snapshot";
  reason: LocusRecoverySnapshotReason;
  body: LocusSnapshotEnvelope;
}>;

export type LocusRecoveryRejectPlan = Readonly<{
  outcome: "reject";
  error: LocusRecoveryRejection;
}>;

export type LocusRecoveryPlan =
  | LocusRecoveryCurrentPlan
  | LocusRecoveryReplayPlan
  | LocusRecoverySnapshotPlan
  | LocusRecoveryRejectPlan;

export type LocusRecoveryPlannerDiagnostics = Readonly<{
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

export type LocusRecoveryPlanner = Readonly<{
  plan: (request: LocusRecoveryRequest, hooks?: LocusRecoveryHooks) => LocusRecoveryPlan;
  debug: () => LocusRecoveryPlannerDiagnostics;
  dispose: LocusDisposer;
}>;

export type LocusActionContext<
  TMap extends LiveMapAuthority = LiveMap<JsonValue | undefined>,
> = Readonly<{
  map: LocusReadonlyMap<TMap>;
  mutate: (
    mutation: (draft: LocusMutationDraft<TMap>) => LiveMapCommit<LiveMapAnyOp>,
  ) => Promise<LiveMapCommit<LiveMapAnyOp>>;
  seq: LocusSeq;
  origin: LocusActionOrigin;
  emit_event: (event: string, payload: JsonValue) => boolean;
}>;

type LocusDataMutationDraft<TMap extends LiveMapAuthority> = Omit<
  TMap,
  "commits" | "debug" | "feed" | "replay" | "restore" | "schema" | "sub"
>;

type LocusDocumentMutationDraft<TMap extends DocumentLiveMap> = Omit<
  TMap,
  "commits" | "debug" | "replay" | "restore"
>;

/** Ephemeral mutation surface used only inside Locus-owned staged callbacks. */
export type LocusMutationDraft<TMap extends LiveMapAuthority> =
  TMap extends DocumentLiveMap ? LocusDocumentMutationDraft<TMap>
  : LocusDataMutationDraft<TMap>;

type ReadonlyHostedDocumentApi = Readonly<{
  root: LiveMapDocumentApi["root"];
  byQuid: LiveMapDocumentApi["byQuid"];
  content: () => ReturnType<LiveMapDocumentApi["content"]>;
  attrs: Pick<LiveMapDocumentApi["attrs"], "get" | "has" | "keys" | "must">;
}>;

type LocusReadonlyPathObjectApi<TValue> = Pick<
  LiveMapPathObjectApi<TValue>,
  "is" | "toObject" | "pick" | "omit" | "hasKey" | "getKey" | "keys" | "isEmpty" | "size" | "values" | "entries"
>;

type LocusReadonlyPathArrayApi<TValue> = Pick<
  LiveMapPathArrayApi<TValue>,
  "is" | "toArray" | "slice" | "take" | "drop" | "takeLast" | "dropLast" | "length" | "isEmpty" | "at" | "first" | "last" | "includes" | "indexOf"
>;

type LocusReadonlyPathHandle<TValue> = Pick<
  LiveMapPathHandle<TValue>,
  "rev" | "path" | "snap" | "feed" | "watch"
> & Readonly<{
  at: <const TPath extends LivePath>(
    path: TPath & ([LiveMapPathValue<TValue, TPath>] extends [never] ? never : unknown),
  ) => LocusReadonlyPathHandle<LiveMapPathValue<TValue, TPath>>;
  array: LocusReadonlyPathArrayApi<TValue>;
  object: LocusReadonlyPathObjectApi<TValue>;
}>;

type LocusReadonlyDataMap<TValue, TMap extends LiveMap<TValue>> = Pick<
  TMap,
  "mode" | "rev" | "root" | "snap" | "capture" | "commits" | "feed" | "sub"
> & Readonly<{
  schema: Pick<LiveMapCoreSchemaApi<TValue>, "get">;
  at: <const TPath extends LivePath>(
    path: TPath & ([LiveMapPathValue<TValue, TPath>] extends [never] ? never : unknown),
  ) => LocusReadonlyPathHandle<LiveMapPathValue<TValue, TPath>>;
}>;

/** Read and observation surface exposed by a hosted authority. */
export type LocusReadonlyMap<TMap extends LiveMapAuthority> =
  TMap extends LiveMap<infer TValue>
    ? LocusReadonlyDataMap<TValue, TMap>
    : TMap extends DocumentLiveMap
      ? Pick<TMap, "mode" | "rev" | "root" | "capture" | "commits"> & Readonly<{ document: ReadonlyHostedDocumentApi }>
      : Pick<TMap, "mode" | "rev" | "root" | "capture" | "commits">;

export type LocusActionHandler<
  TPayload extends JsonValue | undefined = JsonValue | undefined,
  TMap extends LiveMapAuthority = LiveMap<JsonValue | undefined>,
  TActions extends LocusActionPayloads = LocusActionPayloads,
> = (
  ctx: LocusActionContext<TMap>,
  payload: TPayload,
  message: LocusClientActionMessage<TActions>,
) => JsonValue | void | Promise<JsonValue | void>;

export type LocusActions<
  TActions extends LocusActionPayloads = LocusActionPayloads,
  TMap extends LiveMapAuthority = LiveMap<JsonValue | undefined>,
> = Readonly<{
  [TName in keyof TActions & string]: LocusActionHandler<TActions[TName], TMap, TActions>;
}>;

export type LocusMapValue<TMap extends LiveMapAuthority> =
  TMap extends LiveMap<infer TValue extends JsonValue | undefined>
  ? TValue
  : TMap extends DocumentLiveMap
  ? undefined
  : JsonValue | undefined;

type LocusSharedOptions<
  TMap extends LiveMapAuthority,
  TActions extends LocusActionPayloads,
> = Readonly<{
  actions?: Partial<LocusActions<TActions, TMap>>;
  schema?: LocusSchema<LocusMapValue<TMap>, TActions>;
  sessionId?: LocusSessionId | (() => LocusSessionId);
  logicalMapId?: LocusLogicalMapId;
  incarnationId?: LocusIncarnationId;
  history?: LocusCanonicalHistoryOptions;
  recovery?: LocusRecoveryOptions;
  sessions?: LocusSessionOptions;
  actionDedupe?: LocusActionDedupeOptions;
  authorizeAction?: LocusActionAuthorizer<TActions>;
  trace?: LiveTraceSink;
}>;

export type ProjectedLocusOptions<
  TState extends JsonValue | undefined = JsonValue | undefined,
  TActions extends LocusActionPayloads = LocusActionPayloads,
> = LocusSharedOptions<LiveMap<TState>, TActions> & Readonly<{
  state?: TState;
  map?: never;
}>;

export type LocusOptions<
  TMap extends LiveMapAuthority,
  TActions extends LocusActionPayloads = LocusActionPayloads,
> = LocusSharedOptions<TMap, TActions> & Readonly<{
  map: TMap;
  state?: never;
}>;

type MultiLibraryDataMutationHandle<TValue> = Readonly<{
  at: <const TPath extends LivePath>(
    path: TPath & ([LiveMapPathValue<TValue, TPath>] extends [never] ? never : unknown),
  ) => MultiLibraryDataMutationHandle<LiveMapPathValue<TValue, TPath>>;
  set: (value: LiveMapSetValue<TValue>) => void;
  replace: (value: LiveMapWriteValue<TValue>) => void;
  delete: () => void;
  ensureQuid: (quid: string) => void;
}>;

type MultiLibraryDataMutationDraft<TValue> = Readonly<{
  at: <const TPath extends LivePath>(
    path: TPath & ([LiveMapPathValue<TValue, TPath>] extends [never] ? never : unknown),
  ) => MultiLibraryDataMutationHandle<LiveMapPathValue<TValue, TPath>>;
}>;

type MultiLibraryDataMutationDraftForInput<TInput> =
  TInput extends LiveMapDataLibraryInput<infer TSchema>
    ? MultiLibraryDataMutationDraft<HsonSchemaValue<TSchema>>
    : never;

type MultiLibraryBroadDataMutationDraft = Readonly<{
  at: (path: LivePath) => Readonly<{
    set: (value: JsonValue) => void;
    replace: (value: JsonValue) => void;
    delete: () => void;
    ensureQuid: (quid: string) => void;
  }>;
}>;

type MultiLibraryDocumentMutationDraft = Readonly<{
  graph: (operation: LiveMapGraphOp) => void;
  attrs: Readonly<{
    set: (target: LiveMapDocumentCommitTarget, name: string, value: LiveMapDocumentAttributeValue) => void;
    drop: (target: LiveMapDocumentCommitTarget, name: string) => void;
    replace: (target: LiveMapDocumentCommitTarget, attrs: LiveMapDocumentAttrs) => void;
  }>;
  content: Readonly<{
    replace: (target: LiveMapDocumentCommitTarget, index: number, replacement: LiveMapDocumentContent) => void;
    insert: (target: LiveMapDocumentCommitTarget, index: number, content: LiveMapDocumentContent) => void;
    remove: (target: LiveMapDocumentCommitTarget, index: number) => void;
    move: (target: LiveMapDocumentCommitTarget, from: number, to: number) => void;
  }>;
}>;

type MultiLibraryMutationDraftForInput<TInput> =
  TInput extends LiveMapDataLibraryInput
    ? MultiLibraryDataMutationDraftForInput<TInput>
    : TInput extends Readonly<{ document: string | import("../core/types.js").HsonNode }>
      ? MultiLibraryDocumentMutationDraft
      : MultiLibraryBroadDataMutationDraft | MultiLibraryDocumentMutationDraft;

/** Inferred only inside a multi-library Locus mutation callback. */
type MultiLibraryMutationDraft<TLibraries extends LiveMapLibrariesInput> = Readonly<{
  lib: <TLibrary extends Extract<keyof TLibraries, string>>(
    name: TLibrary,
  ) => MultiLibraryMutationDraftForInput<TLibraries[TLibrary]>;
}>;

type MultiLibraryInputs<TMap extends LiveMapLibraries> =
  TMap extends LiveMapLibraries<infer TLibraries> ? TLibraries : LiveMapLibrariesInput;

/** Ordinary Locus action context for one fixed multi-library LiveMap. */
export type LocusMultiLibraryActionContext<
  TMap extends LiveMapLibraries = LiveMapLibraries,
> = Readonly<{
  map: TMap;
  mutate: (mutation: (draft: MultiLibraryMutationDraft<MultiLibraryInputs<TMap>>) => void) => Promise<void>;
  seq: LocusSeq;
  origin: LocusActionOrigin;
  emit_event: (event: string, payload: JsonValue) => boolean;
}>;

export type LocusMultiLibraryActionHandler<
  TPayload extends JsonValue | undefined = JsonValue | undefined,
  TMap extends LiveMapLibraries = LiveMapLibraries,
  TActions extends LocusActionPayloads = LocusActionPayloads,
> = (
  ctx: LocusMultiLibraryActionContext<TMap>,
  payload: TPayload,
  message: LocusClientActionMessage<TActions>,
) => JsonValue | void | Promise<JsonValue | void>;

export type LocusMultiLibraryActions<
  TMap extends LiveMapLibraries = LiveMapLibraries,
  TActions extends LocusActionPayloads = LocusActionPayloads,
> = Readonly<{
  [TName in keyof TActions & string]: LocusMultiLibraryActionHandler<TActions[TName], TMap, TActions>;
}>;

/** Existing Locus construction options when `map` is a fixed public Library registry. */
export type LocusMultiLibraryOptions<
  TMap extends LiveMapLibraries,
  TActions extends LocusActionPayloads = LocusActionPayloads,
> = Readonly<{
  map: TMap;
  state?: never;
  actions?: Partial<LocusMultiLibraryActions<NoInfer<TMap>, TActions>>;
  logicalMapId?: LocusLogicalMapId;
  incarnationId?: LocusIncarnationId;
}>;

export type LocusActionDedupeSchedule = (
  delayMs: number,
  callback: () => void,
) => LocusDisposer;

export type LocusActionDedupeOptions = Readonly<{
  namespace?: string;
  maxTerminalRecords?: number;
  maxTerminalBytes?: number;
  terminalRetentionMs?: number;
  maxExpiredTombstones?: number;
  now?: () => number;
  schedule?: LocusActionDedupeSchedule;
}>;

export type LocusActionDedupeDiagnostics = Readonly<{
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

export type LocusActionDedupeInspector = Readonly<{
  debug: () => LocusActionDedupeDiagnostics;
  dispose: LocusDisposer;
}>;

export type LocusSessionSchedule = (
  delayMs: number,
  callback: () => void,
) => LocusDisposer;

export type LocusSessionOptions = Readonly<{
  graceMs?: number;
  now?: () => number;
  schedule?: LocusSessionSchedule;
  credential?: () => LocusSessionCredential;
}>;

export type LocusSessionState = "attached" | "disconnected" | "expired" | "revoked";

export type LocusSessionDiagnostic = Readonly<{
  sessionId: LocusSessionId;
  state: LocusSessionState;
  resumable: boolean;
  activeConnectionEpoch: LocusConnectionEpoch;
  transportAttached: boolean;
  subscriptionCount: number;
  disconnectedAt?: number;
  expiresAt?: number;
  reattachmentCount: number;
  fencingCount: number;
  expiryCount: number;
}>;

export type LocusSessionDiagnostics = Readonly<{
  activeSessionCount: number;
  attachedSessionCount: number;
  disconnectedSessionCount: number;
  expiredSessionCount: number;
  revokedSessionCount: number;
  reattachmentCount: number;
  fencingCount: number;
  expiryCount: number;
  rejectedCredentialCounts: Readonly<Partial<Record<LocusSessionRejectCode, number>>>;
  sessions: readonly LocusSessionDiagnostic[];
}>;

export type LocusSessionLifecycleEvent =
  | Readonly<{
    kind: "attached";
    session: LocusSessionDiagnostic;
    attachment: "created" | "reattached";
  }>
  | Readonly<{
    kind: "detached";
    session: LocusSessionDiagnostic;
  }>
  | Readonly<{
    kind: "expired";
    session: LocusSessionDiagnostic;
  }>
  | Readonly<{
    kind: "revoked";
    session: LocusSessionDiagnostic;
    reason: "goodbye" | "locus_disposed";
  }>
  | Readonly<{
    kind: "fenced";
    sessionId: LocusSessionId;
    epoch: LocusConnectionEpoch;
  }>;

export type LocusSessionInspector = Readonly<{
  debug: () => LocusSessionDiagnostics;
  on_change: (listener: (event: LocusSessionLifecycleEvent) => void) => LocusDisposer;
  dispose: LocusDisposer;
}>;

export type LocusClientActionRequest<
  TActions extends LocusActionPayloads = LocusActionPayloads,
  TName extends keyof TActions & string = keyof TActions & string,
> = Readonly<{
  requestId: LocusActionRequestId;
  name: TName;
  payload?: TActions[TName];
}>;

export type LocusClientActionPromise<
  TActions extends LocusActionPayloads = LocusActionPayloads,
  TName extends keyof TActions & string = keyof TActions & string,
> = Promise<LocusClientActionResult> & Readonly<{
  request: LocusClientActionRequest<TActions, TName>;
}>;

export type LocusEventListener = (message: LocusServerEventMessage) => void;

export type LocusConnection = LocusDisposer & Readonly<{
  emit_event: (event: string, payload: JsonValue) => void;
}>;

export type LocusClientActionFn<
  TActions extends LocusActionPayloads = LocusActionPayloads,
> = <TName extends keyof TActions & string>(
  name: TName,
  ...args: undefined extends TActions[TName]
    ? [payload?: TActions[TName]]
    : [payload: TActions[TName]]
) => LocusClientActionPromise<TActions, TName>;

export type LocusClientRetryActionFn<
  TActions extends LocusActionPayloads = LocusActionPayloads,
> = <TName extends keyof TActions & string>(
  request: LocusClientActionRequest<TActions, TName>,
) => LocusClientActionPromise<TActions, TName>;

export type LocusClientActionStatusResult = Readonly<{
  requestId: LocusActionRequestId;
  state: LocusActionStatusState;
  outcome?: LocusActionTerminalOutcome;
}>;

export type LocusClientRecoveryStatus = "idle" | "recovering" | "caught_up" | "failed" | "disposed";
export type LocusClientRecoveryStrategy = "current" | "replay" | "snapshot" | "reject";

export type LocusClientRecoveryCursor = Readonly<{
  incarnationId: LocusIncarnationId;
  lastAppliedRev: number;
}>;

export type LocusClientRecoveryOptions = Readonly<{
  logicalMapId: LocusLogicalMapId;
  cursor?: LocusClientRecoveryCursor;
}>;

export type LocusClientRecoveryFailure = Readonly<{
  code: string;
  message: string;
  cause?: unknown;
}>;

export type LocusClientRecoveryChange<
  TMap extends LiveMapAuthority = LiveMap<JsonValue | undefined>,
> = Readonly<{
  kind: "commit" | "snapshot";
  logicalMapId: LocusLogicalMapId;
  incarnationId: LocusIncarnationId;
  rev: number;
  map: TMap;
}>;

export type LocusClientRecoveryChangeListener<
  TMap extends LiveMapAuthority = LiveMap<JsonValue | undefined>,
> = (change: LocusClientRecoveryChange<TMap>) => void;

export type LocusClientRecoveryResult = Readonly<{
  strategy: Exclude<LocusClientRecoveryStrategy, "reject">;
  sessionId: LocusSessionId;
  logicalMapId: LocusLogicalMapId;
  incarnationId: LocusIncarnationId;
  headRev: number;
  incarnationChanged: boolean;
}>;

export type LocusClientRecoveryDiagnostics = Readonly<{
  status: LocusClientRecoveryStatus;
  strategy?: LocusClientRecoveryStrategy;
  logicalMapId?: LocusLogicalMapId;
  incarnationId?: LocusIncarnationId;
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

export type LocusClientRecovery<
  TMap extends LiveMapAuthority = LiveMap<JsonValue | undefined>,
> = Readonly<{
  readonly status: LocusClientRecoveryStatus;
  readonly logicalMapId: LocusLogicalMapId | undefined;
  readonly incarnationId: LocusIncarnationId | undefined;
  readonly lastAppliedRev: number | undefined;
  readonly map: TMap;
  readonly failure: LocusClientRecoveryFailure | undefined;
  readonly strategy: LocusClientRecoveryStrategy | undefined;
  recover: () => Promise<LocusClientRecoveryResult>;
  on_change: (listener: LocusClientRecoveryChangeListener<TMap>) => LocusDisposer;
  dispose: LocusDisposer;
  debug: () => LocusClientRecoveryDiagnostics;
}>;

export type LocusClientSessionStatus = "idle" | "creating" | "attaching" | "attached" | "detached" | "failed" | "ended" | "disposed";

export type LocusClientSessionFailure = Readonly<{
  code: string;
  message: string;
}>;

export type LocusClientSessionResult = Readonly<{
  sessionId: LocusSessionId;
  epoch: LocusConnectionEpoch;
  reattached: boolean;
}>;

export type LocusClientSessionDiagnostics = Readonly<{
  status: LocusClientSessionStatus;
  sessionId?: LocusSessionId;
  epoch?: LocusConnectionEpoch;
  hasCredential: boolean;
  createCount: number;
  reattachCount: number;
  fencingCount: number;
  rejectionCount: number;
}>;

export type LocusClientSession = Readonly<{
  readonly status: LocusClientSessionStatus;
  readonly sessionId: LocusSessionId | undefined;
  readonly credential: LocusSessionCredential | undefined;
  readonly epoch: LocusConnectionEpoch | undefined;
  readonly failure: LocusClientSessionFailure | undefined;
  create: () => Promise<LocusClientSessionResult>;
  reattach: (credential?: LocusSessionCredential) => Promise<LocusClientSessionResult>;
  goodbye: () => Promise<void>;
  dispose: LocusDisposer;
  debug: () => LocusClientSessionDiagnostics;
}>;

export type LocusClientSessionOptions = Readonly<{
  credential?: LocusSessionCredential;
}>;

export type LocusClientOptions<
  TMap extends LiveMapAuthority = LiveMap<JsonValue | undefined>,
> = Readonly<{
  socket: LocusSocketLike;
  map?: TMap;
  /**
   * Logical client identity used to scope retry-safe action requests.
   * The default is reload-safe. Reuse an explicit value only when reconnecting
   * the same logical client and preserving its outstanding request lineage.
   */
  clientId?: LocusClientId;
  /**
   * Factory for fresh action request IDs. `action()` calls it once per new
   * command; `retry_action()` retains the request ID in the supplied descriptor.
   */
  actionId?: () => LocusActionId;
  actionAttemptId?: () => LocusActionId;
  actionStatusId?: () => LocusActionStatusId;
  recovery?: LocusClientRecoveryOptions;
  session?: LocusClientSessionOptions;
  /** Optional local-only client lifecycle trace sink. Never transmitted. */
  trace?: LiveTraceSink;
}>;

/** Existing Locus client options when bootstrapping a fixed public Library registry. */
export type LocusMultiLibraryClientOptions<
  TMap extends LiveMapLibraries,
> = Readonly<{
  socket: LocusSocketLike;
  /** A same-topology local mirror; bootstrap replaces it atomically in place. */
  map: TMap;
  recovery: LocusClientRecoveryOptions;
}>;

export type LocusMultiLibraryClientRecovery = Readonly<{
  outcome: "current" | "replay" | "snapshot";
  revision: number;
}>;

/** One complete client mirror with library-qualified value subscriptions. */
export type LocusMultiLibraryClient<
  TMap extends LiveMapLibraries = LiveMapLibraries,
  TActions extends LocusActionPayloads = LocusActionPayloads,
> = Readonly<{
  map: TMap;
  logicalMapId: LocusLogicalMapId;
  readonly incarnationId: LocusIncarnationId | undefined;
  readonly lastAppliedRev: number | undefined;
  connect: () => Promise<LocusMultiLibraryClientRecovery>;
  recover: () => Promise<LocusMultiLibraryClientRecovery>;
  subscribe: (library: Extract<keyof MultiLibraryInputs<TMap>, string>, path: LivePath, listener: (value: JsonValue | undefined, revision: number) => void) => LocusDisposer;
  unsubscribe: (library: Extract<keyof MultiLibraryInputs<TMap>, string>, path: LivePath) => void;
  action: <TName extends keyof TActions & string>(
    name: TName,
    ...args: undefined extends TActions[TName]
      ? [payload?: TActions[TName]]
      : [payload: TActions[TName]]
  ) => Promise<JsonValue | undefined>;
  close: () => void;
}>;

export type LocusClient<
  TMap extends LiveMapAuthority = LiveMap<JsonValue | undefined>,
  TActions extends LocusActionPayloads = LocusActionPayloads,
> = Readonly<{
  map: TMap;
  clientId: LocusClientId;
  recovery: LocusClientRecovery<TMap>;
  session: LocusClientSession;
  seq: LocusSeq;
  connect: () => LocusDisposer;
  disconnect: () => void;
  subscribe: LocusProjectedSubscription<TMap>;
  unsubscribe: LocusProjectedSubscription<TMap>;
  on_event: (listener: LocusEventListener) => LocusDisposer;
  action: LocusClientActionFn<TActions> & LocusDocumentActionFn;
  retry_action: LocusClientRetryActionFn<TActions> & LocusDocumentRetryActionFn;
  action_status: (requestId: LocusActionRequestId) => Promise<LocusClientActionStatusResult>;
}>;

type LocusProjectedSubscription<TMap extends LiveMapAuthority> =
  [TMap["mode"]] extends [DataLiveMapMode] ? (path: LivePath) => void : never;

export type Locus<
  TMap extends LiveMapAuthority = LiveMap<JsonValue | undefined>,
  TActions extends LocusActionPayloads = LocusActionPayloads,
> = Readonly<{
  map: LocusReadonlyMap<TMap>;
  stream: LocusCanonicalStream<TMap>;
  activity: LocusActivity;
  recovery: LocusRecoveryPlanner;
  sessions: LocusSessionInspector;
  actionRequests: LocusActionDedupeInspector;
  seq: LocusSeq;
  schema?: LocusSchema<LocusMapValue<TMap>, TActions>;
  mutate: (
    mutation: (draft: LocusMutationDraft<TMap>) => LiveMapCommit<LiveMapAnyOp>,
  ) => Promise<LiveMapCommit<LiveMapAnyOp>>;
  dispatch_action: (message: LocusClientActionMessage<TActions>) => Promise<LocusServerMessage<LocusMapValue<TMap>>>;
  connect: (socket: LocusSocketLike, context?: LocusConnectionContext) => LocusConnection;
  dispose: LocusDisposer;
}>;

/** Locus result for the normal fixed multi-library construction surface. */
export type LocusMultiLibrary<
  TMap extends LiveMapLibraries = LiveMapLibraries,
  TActions extends LocusActionPayloads = LocusActionPayloads,
> = Readonly<{
  map: TMap;
  readonly logicalMapId: LocusLogicalMapId;
  readonly incarnationId: LocusIncarnationId;
  readonly rev: number;
  activity: LocusActivity;
  mutate: (mutation: (draft: MultiLibraryMutationDraft<MultiLibraryInputs<TMap>>) => void | Promise<void>) => Promise<void>;
  dispatch_action: (message: LocusClientActionMessage<TActions>) => Promise<LocusServerMessage<JsonValue | undefined>>;
  connect: (socket: LocusSocketLike, context?: LocusConnectionContext) => LocusConnection;
  dispose: LocusDisposer;
}>;

/** Opaque durable-record port for a fixed hosted Library registry. */
export interface LocusMultiLibraryPersistenceAdapter {
  load(logicalMapId: LocusLogicalMapId): Promise<unknown | undefined>;
  appendCommit(record: unknown): Promise<void>;
  replaceCheckpoint(record: unknown): Promise<void>;
}

export type PersistentLocusMultiLibraryOptions<
  TMap extends LiveMapLibraries,
  TActions extends LocusActionPayloads = LocusActionPayloads,
> = LocusMultiLibraryOptions<TMap, TActions> & Readonly<{
  persistence: LocusMultiLibraryPersistenceAdapter;
}>;

export type PersistentLocusMultiLibrary<
  TMap extends LiveMapLibraries = LiveMapLibraries,
  TActions extends LocusActionPayloads = LocusActionPayloads,
> = LocusMultiLibrary<TMap, TActions> & Readonly<{
  checkpoint: () => Promise<void>;
}>;

export type LocusActivityKind =
  | "connection"
  | "session"
  | "action"
  | "recovery"
  | "mutation"
  | "persistence";

export type LocusActivityState = "active" | "idle" | "disposed";

/** Non-sensitive quiescence information for application-owned authority lifecycle policy. */
export type LocusActivitySnapshot = Readonly<{
  state: LocusActivityState;
  connectionCount: number;
  retainedSessionCount: number;
  actionCount: number;
  recoveryCount: number;
  mutationCount: number;
  persistenceCount: number;
  blockerCount: number;
  blockers: readonly LocusActivityKind[];
}>;

export type LocusActivity = Readonly<{
  snapshot(): LocusActivitySnapshot;
  on_change(listener: (snapshot: LocusActivitySnapshot) => void): LocusDisposer;
}>;
