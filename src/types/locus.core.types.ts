// Shared hosted contracts for the fixed library registry.
// locus.types.ts

import type {
  LiveMap,
  LiveMapDocumentAttributeValue,
  LiveMapDocumentAttrs,
  LiveMapDocumentContent,
  LiveMapDocumentCommitTarget,
  LiveMapDataLibraryInput,
  LiveMapGraphOp,
  LiveMapLibraries,
  LiveMapLibrariesInput,
  LiveMapAuthority,
  LiveMapPathValue,
  LiveMapSetValue,
  LiveMapWriteValue,
  LivePath,
} from "./livemap.types.js";
import type { LiveMapProjectedGraphEnsureQuidOp } from "../api/livemap/livemap.identity.types.js";
import type { JsonValue } from "../core/types.js";
import type { HsonData, SchemaType } from "../api/transform/transform.types.js";
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
  LocusServerEventMessage,
  LocusSessionRejectCode,
  LocusSocketLike,
} from "./locus.protocol.types.js";
import type { LocusExposureEntry, LocusProjectionAuthorizer, LocusRequestedProjection } from "./locus.projection.types.js";
import type {
  LocusActionRequestId,
  LocusConnectionEpoch,
  LocusDisposer,
  LocusClientId,
  LocusIncarnationId,
  LocusLogicalMapId,
  LocusSessionCredential,
  LocusSessionId,
  LocusSeq,
} from "./locus.shared.types.js";
import type { LiveTraceSink } from "./live.trace.types.js";


type LocusDataMutationHandle<TValue> = Readonly<{
  at: <const TPath extends LivePath>(
    path: TPath & ([LiveMapPathValue<TValue, TPath>] extends [never] ? never : unknown),
  ) => LocusDataMutationHandle<LiveMapPathValue<TValue, TPath>>;
  set: (value: LiveMapSetValue<TValue>) => void;
  replace: (value: LiveMapWriteValue<TValue>) => void;
  delete: () => void;
}>;

type LocusDataMutationDraft<TValue> = Readonly<{
  at: <const TPath extends LivePath>(
    path: TPath & ([LiveMapPathValue<TValue, TPath>] extends [never] ? never : unknown),
  ) => LocusDataMutationHandle<LiveMapPathValue<TValue, TPath>>;
}>;

type LocusDataMutationDraftForInput<TInput> =
  TInput extends LiveMapDataLibraryInput<infer TSchema>
    ? LocusDataMutationDraft<SchemaType<TSchema>>
    : never;

type LocusBroadDataMutationDraft = Readonly<{
  at: (path: LivePath) => Readonly<{
    set: (value: JsonValue) => void;
    replace: (value: JsonValue) => void;
    delete: () => void;
  }>;
}>;

type LocusDocumentGraphMutation = Exclude<LiveMapGraphOp, Readonly<{ op: "ensure-quid" }>>;

type LocusDocumentMutationDraft = Readonly<{
  graph: (operation: LocusDocumentGraphMutation) => void;
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

type LocusMutationDraftForInput<TInput> =
  TInput extends LiveMapDataLibraryInput
    ? LocusDataMutationDraftForInput<TInput>
    : TInput extends Readonly<{ document: string | import("../core/types.js").HsonNode }>
      ? LocusDocumentMutationDraft
      : LocusBroadDataMutationDraft | LocusDocumentMutationDraft;

/** Inferred only inside a Locus registry mutation callback. */
type LocusMutationDraft<TLibraries extends LiveMapLibrariesInput> = Readonly<{
  lib: <TLibrary extends Extract<keyof TLibraries, string>>(
    name: TLibrary,
  ) => LocusMutationDraftForInput<TLibraries[TLibrary]>;
}>;

type LocusInputs<TMap extends LiveMapLibraries> =
  TMap extends LiveMapLibraries<infer TLibraries> ? TLibraries : LiveMapLibrariesInput;

/** Ordinary Locus action context for one fixed library-registry LiveMap. */
export type LocusActionContext<
  TMap extends LiveMapLibraries = LiveMapLibraries,
> = Readonly<{
  map: TMap;
  mutate: (mutation: (draft: LocusMutationDraft<LocusInputs<TMap>>) => void) => Promise<void>;
  seq: LocusSeq;
  origin: LocusActionOrigin;
  emitEvent: (event: string, payload: JsonValue) => boolean;
}>;

export type LocusActionHandler<
  TPayload extends JsonValue | undefined = JsonValue | undefined,
  TMap extends LiveMapLibraries = LiveMapLibraries,
  TActions extends LocusActionPayloads = LocusActionPayloads,
> = (
  ctx: LocusActionContext<TMap>,
  payload: HsonData | undefined,
  message: LocusClientActionMessage<TActions>,
) => unknown | void | Promise<unknown | void>;

export type LocusActions<
  TMap extends LiveMapLibraries = LiveMapLibraries,
  TActions extends LocusActionPayloads = LocusActionPayloads,
> = Readonly<{
  [TName in keyof TActions & string]: LocusActionHandler<TActions[TName], TMap, TActions>;
}>;

/** Existing Locus construction options when `map` is a fixed public Library registry. */
export type LocusOptions<
  TMap extends LiveMapLibraries,
  TActions extends LocusActionPayloads = LocusActionPayloads,
> = Readonly<{
  map: TMap;
  /** Exactly one explicit classification for every application library. */
  exposure: readonly LocusExposureEntry[];
  /** Optional request used when a session supplies no request. Never implies all libraries. */
  defaultProjection?: LocusRequestedProjection;
  /** Absent authorizer grants no read, system-feature, or built-in write scope. */
  authorizeProjection?: LocusProjectionAuthorizer;
  state?: never;
  actions?: Partial<LocusActions<NoInfer<TMap>, TActions>>;
  logicalMapId?: LocusLogicalMapId;
  incarnationId?: LocusIncarnationId;
  sessionId?: LocusSessionId | (() => LocusSessionId);
  sessions?: LocusSessionOptions;
  actionDedupe?: LocusActionDedupeOptions;
  schema?: Pick<LocusSchema<JsonValue | undefined, TActions>, "actions">;
  authorizeAction?: LocusActionAuthorizer<TActions>;
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
    reason: "goodbye" | "locus_disposed" | "policy_revoked";
  }>
  | Readonly<{
    kind: "fenced";
    sessionId: LocusSessionId;
    epoch: LocusConnectionEpoch;
  }>;

export type LocusSessionInspector = Readonly<{
  debug: () => LocusSessionDiagnostics;
  onChange: (listener: (event: LocusSessionLifecycleEvent) => void) => LocusDisposer;
  dispose: LocusDisposer;
}>;

export type EchoActionRequest<
  TActions extends LocusActionPayloads = LocusActionPayloads,
  TName extends keyof TActions & string = keyof TActions & string,
> = Readonly<{
  requestId: LocusActionRequestId;
  name: TName;
  payload?: HsonData | TActions[TName];
}>;

export type EchoActionPromise<
  TActions extends LocusActionPayloads = LocusActionPayloads,
  TName extends keyof TActions & string = keyof TActions & string,
> = Promise<LocusClientActionResult> & Readonly<{
  request: EchoActionRequest<TActions, TName>;
}>;

export type LocusEventListener = (message: LocusServerEventMessage) => void;

export type LocusConnection = LocusDisposer & Readonly<{
  emitEvent: (event: string, payload: JsonValue) => void;
}>;

export type EchoActionFn<
  TActions extends LocusActionPayloads = LocusActionPayloads,
> = <TName extends keyof TActions & string>(
  name: TName,
  ...args: undefined extends TActions[TName]
    ? [payload?: Exclude<TActions[TName], undefined> | HsonData]
    : [payload: TActions[TName] | HsonData]
) => EchoActionPromise<TActions, TName>;

export type EchoRetryActionFn<
  TActions extends LocusActionPayloads = LocusActionPayloads,
> = <TName extends keyof TActions & string>(
  request: EchoActionRequest<TActions, TName>,
) => EchoActionPromise<TActions, TName>;

export type EchoActionStatusResult = Readonly<{
  requestId: LocusActionRequestId;
  state: LocusActionStatusState;
  outcome?: LocusActionTerminalOutcome;
}>;

export type EchoRecoveryStatus = "idle" | "recovering" | "caught_up" | "failed" | "disposed";
export type EchoRecoveryStrategy = "current" | "replay" | "snapshot" | "reject";

export type EchoRecoveryCursor = Readonly<{
  incarnationId: LocusIncarnationId;
  lastAppliedRev: number;
}>;

export type EchoRecoveryOptions = Readonly<{
  logicalMapId: LocusLogicalMapId;
  cursor?: EchoRecoveryCursor;
}>;

export type EchoRecoveryFailure = Readonly<{
  code: string;
  message: string;
  cause?: unknown;
}>;

export type EchoRecoveryResult = Readonly<{
  strategy: Exclude<EchoRecoveryStrategy, "reject">;
  sessionId: LocusSessionId;
  logicalMapId: LocusLogicalMapId;
  incarnationId: LocusIncarnationId;
  headRev: number;
  incarnationChanged: boolean;
}>;

export type EchoRecoveryDiagnostics = Readonly<{
  status: EchoRecoveryStatus;
  strategy?: EchoRecoveryStrategy;
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
  observerFailures: number;
}>;

export type EchoRecovery<
  TMap extends LiveMapAuthority | LiveMapLibraries = LiveMap<JsonValue | undefined>,
> = Readonly<{
  readonly status: EchoRecoveryStatus;
  readonly logicalMapId: LocusLogicalMapId | undefined;
  readonly incarnationId: LocusIncarnationId | undefined;
  readonly lastAppliedRev: number | undefined;
  readonly map: TMap;
  readonly failure: EchoRecoveryFailure | undefined;
  readonly strategy: EchoRecoveryStrategy | undefined;
  recover: () => Promise<EchoRecoveryResult>;
  dispose: LocusDisposer;
  debug: () => EchoRecoveryDiagnostics;
}>;

export type EchoSessionStatus = "idle" | "creating" | "attaching" | "attached" | "detached" | "failed" | "ended" | "disposed";

export type EchoSessionFailure = Readonly<{
  code: string;
  message: string;
}>;

export type EchoSessionResult = Readonly<{
  sessionId: LocusSessionId;
  epoch: LocusConnectionEpoch;
  logicalMapId: LocusLogicalMapId;
  incarnationId: LocusIncarnationId;
  reattached: boolean;
}>;

export type EchoSessionDiagnostics = Readonly<{
  status: EchoSessionStatus;
  sessionId?: LocusSessionId;
  epoch?: LocusConnectionEpoch;
  hasCredential: boolean;
  createCount: number;
  reattachCount: number;
  fencingCount: number;
  rejectionCount: number;
}>;

export type EchoSession = Readonly<{
  readonly status: EchoSessionStatus;
  readonly sessionId: LocusSessionId | undefined;
  readonly credential: LocusSessionCredential | undefined;
  readonly epoch: LocusConnectionEpoch | undefined;
  readonly logicalMapId: LocusLogicalMapId | undefined;
  readonly incarnationId: LocusIncarnationId | undefined;
  readonly failure: EchoSessionFailure | undefined;
  create: () => Promise<EchoSessionResult>;
  reattach: (credential?: LocusSessionCredential) => Promise<EchoSessionResult>;
  goodbye: () => Promise<void>;
  dispose: LocusDisposer;
  debug: () => EchoSessionDiagnostics;
}>;

export type EchoSessionOptions = Readonly<{
  credential?: LocusSessionCredential;
}>;

type EchoMap = LiveMapAuthority | LiveMapLibraries;

type EchoCommonOptions = Readonly<{
  socket: LocusSocketLike;
  /**
   * Logical client identity used to scope retry-safe action requests.
   * The default is reload-safe. Reuse an explicit value only when reconnecting
   * the same logical client and preserving its outstanding request lineage.
   */
  clientId?: LocusClientId;
  session?: EchoSessionOptions;
  /** Optional local-only client lifecycle trace sink. Never transmitted. */
  trace?: LiveTraceSink;
}>;

export type EchoOptions<TMap extends EchoMap | undefined = undefined> = EchoCommonOptions & (
  TMap extends EchoMap
    ? Readonly<{ map: TMap; recovery: EchoRecoveryOptions }>
    : Readonly<{ map?: never; recovery?: never }>
);

export type Echo<
  TMap extends EchoMap | undefined = undefined,
  TActions extends LocusActionPayloads = LocusActionPayloads,
> = Readonly<{
  clientId: LocusClientId;
  session: EchoSession;
  connect: () => LocusDisposer;
  disconnect: () => void;
  action: EchoActionFn<TActions> & LocusDocumentActionFn;
  retryAction: EchoRetryActionFn<TActions> & LocusDocumentRetryActionFn;
  actionStatus: (requestId: LocusActionRequestId) => Promise<EchoActionStatusResult>;
  dispose: LocusDisposer;
}> & (TMap extends EchoMap ? Readonly<{
  map: TMap;
  recovery: EchoRecovery<TMap>;
}> : Readonly<{}>);

/** Locus result for the fixed library-registry construction surface. */
export type Locus<
  TMap extends LiveMapLibraries = LiveMapLibraries,
  TActions extends LocusActionPayloads = LocusActionPayloads,
> = Readonly<{
  map: TMap;
  readonly logicalMapId: LocusLogicalMapId;
  readonly incarnationId: LocusIncarnationId;
  readonly rev: number;
  activity: LocusActivity;
  sessions: LocusSessionInspector;
  actionRequests: LocusActionDedupeInspector;
  mutate: (mutation: (draft: LocusMutationDraft<LocusInputs<TMap>>) => void | Promise<void>) => Promise<void>;
  /** Fence and revoke an existing session when its read policy is withdrawn. */
  revokeSession: (sessionId: LocusSessionId) => boolean;
  dispatchAction: (message: LocusClientActionMessage<TActions>) => Promise<LocusClientActionResult>;
  connect: (socket: LocusSocketLike, context?: LocusConnectionContext) => LocusConnection;
  dispose: LocusDisposer;
  /** Capture HTML and projected authority state for one already-authorized session. */
  cut: (sessionId: LocusSessionId, document?: string) => import("../api/ssr/ssr.types.js").HostedLibrariesDocumentCut;
}>;

/** Opaque durable-record port for a fixed hosted Library registry. */
export interface LocusPersistenceAdapter {
  load(logicalMapId: LocusLogicalMapId): Promise<unknown | undefined>;
  /** Resolve only after one fenced revision is durable. Ordinary rejection
   * guarantees no write; signal an uncertain write-then-error outcome with
   * LocusPersistenceAppendUncertainError to fence the authority until reload. */
  appendCommit(record: unknown): Promise<void>;
  /** Staging writes are exact and durable; they do not alter the active checkpoint or tail. */
  putCheckpointChunk(chunk: unknown): Promise<void>;
  /** Resolve only when the candidate and all referenced chunks are durable and valid. */
  putCheckpointManifest(manifest: unknown): Promise<void>;
  /** Atomic compare-and-swap of one still-valid complete candidate. */
  activateCheckpoint(logicalMapId: string, expectedCheckpointId: string | undefined, checkpointId: string): Promise<void>;
  readCheckpointChunk(id: string): Promise<unknown | undefined>;
  /** The adapter must verify checkpointId is active before pruning revisions through rev. */
  pruneCommitsThrough(logicalMapId: string, checkpointId: string, rev: number): Promise<void>;
}

export type PersistentLocusOptions<
  TMap extends LiveMapLibraries,
  TActions extends LocusActionPayloads = LocusActionPayloads,
> = LocusOptions<TMap, TActions> & Readonly<{
  persistence: LocusPersistenceAdapter;
}>;

export type PersistentLocus<
  TMap extends LiveMapLibraries = LiveMapLibraries,
  TActions extends LocusActionPayloads = LocusActionPayloads,
> = Locus<TMap, TActions> & Readonly<{
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
  onChange(listener: (snapshot: LocusActivitySnapshot) => void): LocusDisposer;
}>;
