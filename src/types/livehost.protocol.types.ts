// One-map action and transport protocol contracts.
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
  LiveHostSnapshotCapabilities,
  LiveHostSnapshotEncodingSelection,
  LiveHostSnapshotEnvelope,
} from "./livehost.representation.types.js";
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

export type LiveHostRecoverySnapshotReason =
  | "no_usable_revision"
  | "incarnation_mismatch"
  | "history_unavailable";

export type LiveHostRecoveryRejectCode =
  | "LIVEHOST_RECOVERY_INVALID_TARGET"
  | "LIVEHOST_RECOVERY_INVALID_REQUEST"
  | "REVISION_AHEAD_OF_AUTHORITY";


/** Wire-safe representation of a projected value that may be absent. */
export type LiveHostActionPayloads = Readonly<Record<string, JsonValue | undefined>>;

export type LiveHostDocumentActionName =
  | "document.attrs.set"
  | "document.attrs.drop"
  | "document.attrs.setMany"
  | "document.attrs.dropMany"
  | "document.attrs.clear"
  | "document.attrs.replace"
  | "document.content.replace"
  | "document.content.insert"
  | "document.content.remove"
  | "document.content.move";

export type LiveHostDocumentTargetPayload = LiveMapDocumentTarget;

export type LiveHostDocumentActionPayloads = Readonly<{
  "document.attrs.set": {
    target: LiveHostDocumentTargetPayload;
    name: string;
    value: LiveMapDocumentAttributeValue;
  };
  "document.attrs.drop": {
    target: LiveHostDocumentTargetPayload;
    name: string;
  };
  "document.attrs.setMany": {
    target: LiveHostDocumentTargetPayload;
    values: LiveMapDocumentAttrs;
  };
  "document.attrs.dropMany": {
    target: LiveHostDocumentTargetPayload;
    names: readonly string[];
  };
  "document.attrs.clear": {
    target: LiveHostDocumentTargetPayload;
  };
  "document.attrs.replace": {
    target: LiveHostDocumentTargetPayload;
    values: LiveMapDocumentAttrs;
  };
  "document.content.replace": {
    target: LiveHostDocumentTargetPayload;
    index: number;
    replacement: LiveMapDocumentContent;
  };
  "document.content.insert": {
    target: LiveHostDocumentTargetPayload;
    index: number;
    content: LiveMapDocumentContent;
  };
  "document.content.remove": {
    target: LiveHostDocumentTargetPayload;
    index: number;
  };
  "document.content.move": {
    target: LiveHostDocumentTargetPayload;
    from: number;
    to: number;
  };
}>;

export type LiveHostDocumentActionRequest<
  TName extends LiveHostDocumentActionName = LiveHostDocumentActionName,
> = Readonly<{
  requestId: LiveHostActionRequestId;
  name: TName;
  payload: LiveHostDocumentActionPayloads[TName];
}>;

export type LiveHostDocumentActionPromise<
  TName extends LiveHostDocumentActionName = LiveHostDocumentActionName,
> = Promise<LiveHostClientActionResult> & Readonly<{
  request: LiveHostDocumentActionRequest<TName>;
}>;

export type LiveHostDocumentActionFn = <TName extends LiveHostDocumentActionName>(
  name: TName,
  payload: LiveHostDocumentActionPayloads[TName],
) => LiveHostDocumentActionPromise<TName>;

export type LiveHostDocumentRetryActionFn = <TName extends LiveHostDocumentActionName>(
  request: LiveHostDocumentActionRequest<TName>,
) => LiveHostDocumentActionPromise<TName>;

export type LiveHostActionOrigin =
  | Readonly<{
    kind: "session";
    sessionId: LiveHostSessionId;
    epoch: LiveHostConnectionEpoch;
    resumable: boolean;
  }>
  | Readonly<{
    kind: "direct";
  }>;

export type LiveHostActionAuthorizationSession = Readonly<{
  sessionId: LiveHostSessionId;
  epoch: LiveHostConnectionEpoch;
  resumable: boolean;
}>;

/**
 * Opaque, transport-supplied attachment context for one LiveHost connection.
 *
 * LiveHost does not interpret `attachment`. A stable `principalId`, when
 * supplied, binds resumable session credentials to that authenticated
 * principal without persisting or placing the attachment on the wire.
 */
export type LiveHostConnectionContext = Readonly<{
  principalId?: string;
  attachment?: unknown;
}>;

export type LiveHostActionAuthorizationContext<
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
> = {
  [TName in keyof TActions & string]: Readonly<{
    action: TName;
    session: LiveHostActionAuthorizationSession;
    payload: TActions[TName];
    logicalMapId: LiveHostLogicalMapId;
    incarnationId: LiveHostIncarnationId;
    connection?: LiveHostConnectionContext;
  }>;
}[keyof TActions & string];

export type LiveHostActionAuthorizer<
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
> = (
  context: LiveHostActionAuthorizationContext<TActions>,
) => boolean | Promise<boolean>;

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
  snapshotCapabilities?: LiveHostSnapshotCapabilities;
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
}> & Partial<LiveMapStructuralJsonEnvelope>;

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
}> & Partial<LiveMapStructuralJsonEnvelope>;

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

export type LiveHostClientActionResult = LiveHostServerAckMessage | LiveHostServerErrorMessage;

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
  snapshotEncoding?: LiveHostSnapshotEncodingSelection;
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
