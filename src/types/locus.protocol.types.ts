// One-map action and transport protocol contracts.
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
  LocusCanonicalCommit,
  LocusSnapshotCapabilities,
  LocusSnapshotEncodingSelection,
  LocusSnapshotEnvelope,
} from "./locus.representation.types.js";
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

export type LocusRecoveryRejection = Readonly<{
  code: LocusRecoveryRejectCode;
  message: string;
  authoritativeRev: number;
  incarnationId: LocusIncarnationId;
}>;

export type LocusRecoveryCaughtUp = Readonly<{
  kind: "caught_up";
  logicalMapId: LocusLogicalMapId;
  incarnationId: LocusIncarnationId;
  throughRev: number;
}>;

export type LocusRecoverySnapshotReason =
  | "no_usable_revision"
  | "incarnation_mismatch"
  | "history_unavailable";

export type LocusRecoveryRejectCode =
  | "LOCUS_RECOVERY_INVALID_TARGET"
  | "LOCUS_RECOVERY_INVALID_REQUEST"
  | "REVISION_AHEAD_OF_AUTHORITY";


/** Wire-safe representation of a data value that may be absent. */
export type LocusActionPayloads = Readonly<Record<string, JsonValue | undefined>>;

export type LocusDocumentActionName =
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

export type LocusDocumentTargetPayload = LiveMapDocumentTarget;

export type LocusDocumentActionPayloads = Readonly<{
  "document.attrs.set": {
    target: LocusDocumentTargetPayload;
    name: string;
    value: LiveMapDocumentAttributeValue;
  };
  "document.attrs.drop": {
    target: LocusDocumentTargetPayload;
    name: string;
  };
  "document.attrs.setMany": {
    target: LocusDocumentTargetPayload;
    values: LiveMapDocumentAttrs;
  };
  "document.attrs.dropMany": {
    target: LocusDocumentTargetPayload;
    names: readonly string[];
  };
  "document.attrs.clear": {
    target: LocusDocumentTargetPayload;
  };
  "document.attrs.replace": {
    target: LocusDocumentTargetPayload;
    values: LiveMapDocumentAttrs;
  };
  "document.content.replace": {
    target: LocusDocumentTargetPayload;
    index: number;
    replacement: LiveMapDocumentContent;
  };
  "document.content.insert": {
    target: LocusDocumentTargetPayload;
    index: number;
    content: LiveMapDocumentContent;
  };
  "document.content.remove": {
    target: LocusDocumentTargetPayload;
    index: number;
  };
  "document.content.move": {
    target: LocusDocumentTargetPayload;
    from: number;
    to: number;
  };
}>;

export type LocusDocumentActionRequest<
  TName extends LocusDocumentActionName = LocusDocumentActionName,
> = Readonly<{
  requestId: LocusActionRequestId;
  name: TName;
  payload: LocusDocumentActionPayloads[TName];
}>;

export type LocusDocumentActionPromise<
  TName extends LocusDocumentActionName = LocusDocumentActionName,
> = Promise<LocusClientActionResult> & Readonly<{
  request: LocusDocumentActionRequest<TName>;
}>;

export type LocusDocumentActionFn = <TName extends LocusDocumentActionName>(
  name: TName,
  payload: LocusDocumentActionPayloads[TName],
) => LocusDocumentActionPromise<TName>;

export type LocusDocumentRetryActionFn = <TName extends LocusDocumentActionName>(
  request: LocusDocumentActionRequest<TName>,
) => LocusDocumentActionPromise<TName>;

export type LocusActionOrigin =
  | Readonly<{
    kind: "session";
    sessionId: LocusSessionId;
    epoch: LocusConnectionEpoch;
    resumable: boolean;
  }>
  | Readonly<{
    kind: "direct";
  }>;

export type LocusActionAuthorizationSession = Readonly<{
  sessionId: LocusSessionId;
  epoch: LocusConnectionEpoch;
  resumable: boolean;
}>;

/**
 * Opaque, transport-supplied attachment context for one Locus connection.
 *
 * Locus does not interpret `attachment`. A stable `principalId`, when
 * supplied, binds resumable session credentials to that authenticated
 * principal without persisting or placing the attachment on the wire.
 */
export type LocusConnectionContext = Readonly<{
  principalId?: string;
  attachment?: unknown;
}>;

export type LocusActionAuthorizationContext<
  TActions extends LocusActionPayloads = LocusActionPayloads,
> = {
  [TName in keyof TActions & string]: Readonly<{
    action: TName;
    session: LocusActionAuthorizationSession;
    payload: TActions[TName];
    logicalMapId: LocusLogicalMapId;
    incarnationId: LocusIncarnationId;
    connection?: LocusConnectionContext;
  }>;
}[keyof TActions & string];

export type LocusActionAuthorizer<
  TActions extends LocusActionPayloads = LocusActionPayloads,
> = (
  context: LocusActionAuthorizationContext<TActions>,
) => boolean | Promise<boolean>;

export type LocusActionSchema<TPayload extends JsonValue | undefined = JsonValue | undefined> = Readonly<{
  payload?: LocusValidator<TPayload> | LocusSchemaDecoder<TPayload>;
}>;

export type LocusSchema<
  TState = JsonValue | undefined,
  TActions extends LocusActionPayloads = LocusActionPayloads,
> = Readonly<{
  state?: LocusValidator<TState> | LocusSchemaDecoder<TState>;
  actions?: Readonly<{
    [TName in keyof TActions & string]?: LocusActionSchema<TActions[TName]>;
  }>;
}>;

export type LocusSocketLike = Readonly<{
  send: (message: string) => void;
  close: (code?: number, reason?: string) => void;
  onMessage: (listener: (message: string) => void) => LocusDisposer | void;
  onClose: (listener: () => void) => LocusDisposer | void;
}>;

export type LocusClientHelloMessage = Readonly<{
  type: "hello";
  clientId?: LocusClientId;
}>; 

export type LocusClientActionMessageFor<
  TActions extends LocusActionPayloads,
  TName extends keyof TActions & string,
> = undefined extends TActions[TName]
  ? Readonly<{
    type: "action";
    id: LocusActionId;
    requestId?: LocusActionRequestId;
    attemptId?: LocusActionId;
    clientId?: LocusClientId;
    retry?: true;
    name: TName;
    payload?: TActions[TName];
  }>
  : Readonly<{
    type: "action";
    id: LocusActionId;
    requestId?: LocusActionRequestId;
    attemptId?: LocusActionId;
    clientId?: LocusClientId;
    retry?: true;
    name: TName;
    payload: TActions[TName];
  }>;

export type LocusClientActionMessage<
  TActions extends LocusActionPayloads = LocusActionPayloads,
> = {
  [TName in keyof TActions & string]: LocusClientActionMessageFor<TActions, TName>;
}[keyof TActions & string];

export type LocusClientSubscribeMessage = Readonly<{
  type: "subscribe";
  path: LivePath;
}>;

export type LocusClientUnsubscribeMessage = Readonly<{
  type: "unsubscribe";
  path: LivePath;
}>;

export type LocusClientActionStatusMessage = Readonly<{
  type: "action-status";
  id: LocusActionStatusId;
  clientId: LocusClientId;
  requestId: LocusActionRequestId;
}>;

export type LocusClientRecoverMessage = Readonly<{
  type: "recover";
  id: LocusRecoveryId;
  logicalMapId: LocusLogicalMapId;
  incarnationId?: LocusIncarnationId;
  lastAppliedRev?: number;
  snapshotCapabilities?: LocusSnapshotCapabilities;
}>;

export type LocusClientSessionCreateMessage = Readonly<{
  type: "session-create";
  id: LocusSessionRequestId;
}>;

export type LocusClientSessionAttachMessage = Readonly<{
  type: "session-attach";
  id: LocusSessionRequestId;
  credential?: unknown;
}>;

export type LocusClientSessionGoodbyeMessage = Readonly<{
  type: "session-goodbye";
  id: LocusSessionRequestId;
}>;

export type LocusClientMessage<
  TActions extends LocusActionPayloads = LocusActionPayloads,
> =
  | LocusClientHelloMessage
  | LocusClientActionMessage<TActions>
  | LocusClientActionStatusMessage
  | LocusClientSubscribeMessage
  | LocusClientUnsubscribeMessage
  | LocusClientRecoverMessage
  | LocusClientSessionCreateMessage
  | LocusClientSessionAttachMessage
  | LocusClientSessionGoodbyeMessage;

export type LocusServerHelloMessage<TState extends JsonValue | undefined = JsonValue | undefined> = Readonly<{
  type: "hello";
  sessionId: LocusSessionId;
  seq: LocusSeq;
  snapshot: TState;
}> & Partial<LiveMapStructuralJsonEnvelope>;

export type LocusServerPatchMessage = Readonly<{
  type: "patch";
  seq: LocusSeq;
  ops: readonly LiveMapOp[];
}>;

export type LocusServerEventMessage = Readonly<{
  type: "event";
  event: string;
  payload: JsonValue;
}>;

export type LocusServerSyncMessage<TValue extends JsonValue | undefined = JsonValue | undefined> = Readonly<{
  type: "sync";
  seq: LocusSeq;
  path: LivePath;
  value: TValue;
}> & Partial<LiveMapStructuralJsonEnvelope>;

export type LocusServerAckMessage = Readonly<{
  type: "ack";
  id: LocusActionId;
  ok: true;
  seq: LocusSeq;
  result?: JsonValue;
  requestId?: LocusActionRequestId;
  attemptId?: LocusActionId;
  completionRev?: number;
  delivery?: LocusActionDelivery;
}>;

export type LocusServerErrorMessage = Readonly<{
  type: "error";
  id?: LocusActionId;
  ok?: false;
  seq: LocusSeq;
  error: LocusError;
  requestId?: LocusActionRequestId;
  attemptId?: LocusActionId;
  completionRev?: number;
  delivery?: LocusActionDelivery;
}>;

export type LocusClientActionResult = LocusServerAckMessage | LocusServerErrorMessage;

export type LocusActionDelivery = "executed" | "joined" | "cached" | "rejected";

export type LocusActionRequestErrorCode =
  | "LOCUS_ACTION_REQUEST_ID_MISSING"
  | "LOCUS_ACTION_REQUEST_ID_MALFORMED"
  | "LOCUS_ACTION_REQUEST_ID_CONFLICT"
  | "LOCUS_ACTION_REQUEST_UNKNOWN"
  | "LOCUS_ACTION_REQUEST_EXPIRED"
  | "LOCUS_ACTION_UNAVAILABLE"
  | "LOCUS_ACTION_INVALID"
  | "LOCUS_ACTION_OUTCOME_NORMALIZATION_FAILED"
  | "LOCUS_ACTION_DEDUPE_STORE_UNAVAILABLE";

export type LocusActionTerminalOutcome =
  | Readonly<{
    state: "succeeded";
    seq: LocusSeq;
    completionRev: number;
    result?: JsonValue;
  }>
  | Readonly<{
    state: "failed";
    seq: LocusSeq;
    completionRev: number;
    error: LocusError;
  }>;

export type LocusActionStatusState = "pending" | "succeeded" | "failed" | "unknown" | "expired";

export type LocusServerActionStatusMessage = Readonly<{
  type: "action-status";
  id: LocusActionStatusId;
  requestId: LocusActionRequestId;
  state: LocusActionStatusState;
  outcome?: LocusActionTerminalOutcome;
}>;

type LocusServerRecoveryPlanBase = Readonly<{
  type: "recovery-plan";
  id: LocusRecoveryId;
  sessionId: LocusSessionId;
  logicalMapId: LocusLogicalMapId;
  incarnationId: LocusIncarnationId;
  headRev: number;
  snapshotEncoding?: LocusSnapshotEncodingSelection;
}>;

export type LocusServerRecoveryPlanMessage =
  | LocusServerRecoveryPlanBase & Readonly<{ outcome: "current" }>
  | LocusServerRecoveryPlanBase & Readonly<{ outcome: "replay" }>
  | LocusServerRecoveryPlanBase & Readonly<{
    outcome: "snapshot";
    reason: LocusRecoverySnapshotReason;
  }>
  | LocusServerRecoveryPlanBase & Readonly<{
    outcome: "reject";
    error: LocusRecoveryRejection;
  }>;

export type LocusServerRecoveryCommitMessage = Readonly<{
  type: "recovery-commit";
  id: LocusRecoveryId;
  phase: "body" | "tail";
  commit: LocusCanonicalCommit;
}>;

export type LocusServerRecoverySnapshotMessage = Readonly<{
  type: "recovery-snapshot";
  id: LocusRecoveryId;
  snapshot: LocusSnapshotEnvelope;
}>;

export type LocusServerRecoveryCaughtUpMessage = Readonly<{
  type: "recovery-caught-up";
  id: LocusRecoveryId;
  caughtUp: LocusRecoveryCaughtUp;
}>;

export type LocusServerCanonicalCommitMessage = Readonly<{
  type: "commit";
  id: LocusRecoveryId;
  commit: LocusCanonicalCommit;
}>;

export type LocusServerRecoveryErrorMessage = Readonly<{
  type: "recovery-error";
  id: LocusRecoveryId;
  error: LocusError;
}>;

export type LocusSessionRejectCode =
  | "LOCUS_SESSION_CREDENTIAL_MISSING"
  | "LOCUS_SESSION_CREDENTIAL_MALFORMED"
  | "LOCUS_SESSION_CREDENTIAL_UNKNOWN"
  | "LOCUS_SESSION_CREDENTIAL_EXPIRED"
  | "LOCUS_SESSION_CREDENTIAL_REVOKED"
  | "LOCUS_SESSION_ATTACHMENT_FENCED"
  | "LOCUS_SESSION_NOT_ATTACHED"
  | "LOCUS_SESSION_ALREADY_GONE";

export type LocusServerSessionCreatedMessage = Readonly<{
  type: "session-created";
  id: LocusSessionRequestId;
  sessionId: LocusSessionId;
  credential: LocusSessionCredential;
  epoch: LocusConnectionEpoch;
}>;

export type LocusServerSessionAttachedMessage = Readonly<{
  type: "session-attached";
  id: LocusSessionRequestId;
  sessionId: LocusSessionId;
  epoch: LocusConnectionEpoch;
}>;

export type LocusServerSessionRejectedMessage = Readonly<{
  type: "session-rejected";
  id: LocusSessionRequestId;
  code: LocusSessionRejectCode;
  message: string;
}>;

export type LocusServerSessionFencedMessage = Readonly<{
  type: "session-fenced";
  sessionId: LocusSessionId;
  epoch: LocusConnectionEpoch;
  code: "LOCUS_SESSION_ATTACHMENT_FENCED";
}>;

export type LocusServerSessionEndedMessage = Readonly<{
  type: "session-ended";
  id: LocusSessionRequestId;
  sessionId: LocusSessionId;
  epoch: LocusConnectionEpoch;
}>;

export type LocusServerMessage<TState extends JsonValue | undefined = JsonValue | undefined> =
  | LocusServerHelloMessage<TState>
  | LocusServerEventMessage
  | LocusServerPatchMessage
  | LocusServerSyncMessage
  | LocusServerAckMessage
  | LocusServerErrorMessage
  | LocusServerActionStatusMessage
  | LocusServerRecoveryPlanMessage
  | LocusServerRecoveryCommitMessage
  | LocusServerRecoverySnapshotMessage
  | LocusServerRecoveryCaughtUpMessage
  | LocusServerCanonicalCommitMessage
  | LocusServerRecoveryErrorMessage
  | LocusServerSessionCreatedMessage
  | LocusServerSessionAttachedMessage
  | LocusServerSessionRejectedMessage
  | LocusServerSessionFencedMessage
  | LocusServerSessionEndedMessage;
