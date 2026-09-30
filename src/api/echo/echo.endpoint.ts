import type { JsonValue } from "../../core/types.js";
import type {
  EchoActionPromise,
  EchoActionRequest,
  EchoActionStatusResult,
  EchoSession,
  EchoSessionDiagnostics,
  EchoSessionResult,
  EchoSessionStatus,
  LocusActionId,
  LocusActionPayloads,
  LocusActionRequestId,
  LocusActionStatusId,
  LocusClientId,
  LocusClientActionMessage,
  LocusClientActionResult,
  LocusDisposer,
  LocusSessionCredential,
  LocusSessionRequestId,
} from "../../types/locus.types.js";
import { LocusDisconnectedError, LocusDuplicateActionIdError } from "../locus/locus.error.js";
import { EchoSessionError } from "./echo.error.js";
import { admit_echo_action_payload, make_echo_reload_safe_id } from "./echo.request.js";
import type { HsonData } from "../transform/transform.types.js";
import type {
  EchoFiniteOperationCapability,
  EchoFiniteOperationOutcome,
} from "./echo.operation.internal.js";
import type { EchoAttachmentEvent, EchoEndpointTransport, EchoSubmission } from "../../types/echo.transport.types.js";

/** @internal Decoded server messages owned by the common endpoint. */
export type EchoEndpointServerMessage = EchoFiniteOperationOutcome | Readonly<{
  type: "session-fenced";
  sessionId: string;
  epoch: number;
  code: "LOCUS_SESSION_ATTACHMENT_FENCED";
}>;

type PendingAction = Readonly<{
  requestId: LocusActionRequestId;
  resolve: (result: LocusClientActionResult) => void;
  reject: (error: Error) => void;
}>;

type PendingStatus = Readonly<{
  requestId: LocusActionRequestId;
  resolve: (result: EchoActionStatusResult) => void;
  reject: (error: Error) => void;
}>;

type PendingSession = Readonly<{
  id: LocusSessionRequestId;
  kind: "create" | "reattach" | "detach" | "goodbye";
  resolve: (result: EchoSessionResult | undefined) => void;
  reject: (error: Error) => void;
}>;

function submission_error(submission: Exclude<EchoSubmission<unknown>, { kind: "response" }>): Error {
  return Object.assign(new LocusDisconnectedError(), {
    delivery: submission.kind,
    ...(submission.cause === undefined ? {} : { cause: submission.cause }),
  });
}

/** @internal Deterministic identifier seams used by repository proof fixtures. */
export type EchoEndpointIdFactories = Readonly<{
  actionId?: () => LocusActionId;
  actionAttemptId?: () => LocusActionId;
  actionStatusId?: () => LocusActionStatusId;
  sessionRequestId?: (kind: "create" | "reattach" | "detach" | "goodbye") => LocusSessionRequestId;
}>;

/** @internal */
export type EchoEndpointOptions<TActions extends LocusActionPayloads = LocusActionPayloads> = Readonly<{
  operations: EchoFiniteOperationCapability<TActions>;
  attachment: EchoEndpointTransport<TActions>["attachment"];
  clientId?: LocusClientId;
  sessionRequired: boolean;
  credential?: LocusSessionCredential;
  ids?: EchoEndpointIdFactories;
  actionMessageId?: "request" | "attempt";
  onSequence?: (sequence: number) => void;
  onAttachmentLost?: (reason: "disconnect" | "fenced" | "ended", error: Error) => void;
  operationLossError?: (reason: "disconnect" | "fenced" | "ended") => Error;
  onReadyChange?: () => void;
  onAvailable?: () => void;
  /** @internal Replica operations require synchronization in addition to attachment. */
  additionalReady?: () => boolean;
}>;

/** @internal Common replica-independent Echo endpoint state and behavior. */
export type EchoEndpoint<TActions extends LocusActionPayloads = LocusActionPayloads> = Readonly<{
  readonly clientId: LocusClientId;
  readonly session: EchoSession;
  readonly active: boolean;
  readonly ready: boolean;
  /** @internal Release this transport's retained attachment without revocation. */
  detachSession: () => Promise<void>;
  connect: () => void;
  disconnect: () => void;
  interrupt: () => void;
  receive: (message: EchoEndpointServerMessage) => boolean;
  action: <TName extends keyof TActions & string>(
    name: TName,
    ...args: undefined extends TActions[TName]
      ? [payload?: Exclude<TActions[TName], undefined> | HsonData]
      : [payload: TActions[TName] | HsonData]
  ) => EchoActionPromise<TActions, TName>;
  retryAction: <TName extends keyof TActions & string>(request: EchoActionRequest<TActions, TName>) => EchoActionPromise<TActions, TName>;
  actionStatus: (requestId: LocusActionRequestId) => Promise<EchoActionStatusResult>;
  waitUntilReady: () => Promise<void>;
  dispose: () => void;
}>;

let nextAttemptId = 0;
let nextStatusId = 0;
let nextSessionId = 0;

function defaultAttemptId(): LocusActionId {
  nextAttemptId += 1;
  return `lhaa-${nextAttemptId}`;
}

function defaultStatusId(): LocusActionStatusId {
  nextStatusId += 1;
  return `lhas-${nextStatusId}`;
}

function defaultSessionId(): LocusSessionRequestId {
  nextSessionId += 1;
  return `lhsr-${nextSessionId}`;
}

export function create_echo_endpoint_internal<TActions extends LocusActionPayloads = LocusActionPayloads>(
  options: EchoEndpointOptions<TActions>,
): EchoEndpoint<TActions> {
  const { credential: initialCredential, ...runtimeOptions } = options;
  const clientId = runtimeOptions.clientId ?? make_echo_reload_safe_id("lhc");
  const makeActionId = runtimeOptions.ids?.actionId ?? (() => make_echo_reload_safe_id("lha"));
  const makeAttemptId = runtimeOptions.ids?.actionAttemptId ?? defaultAttemptId;
  const makeStatusId = runtimeOptions.ids?.actionStatusId ?? defaultStatusId;
  const makeSessionId = runtimeOptions.ids?.sessionRequestId ?? defaultSessionId;
  const pendingActions = new Map<LocusActionId, PendingAction>();
  const attemptsByRequest = new Map<LocusActionRequestId, LocusActionId[]>();
  const pendingStatuses = new Map<LocusActionStatusId, PendingStatus>();
  const usedCorrelationIds = new Set<string>();
  const readyWaiters = new Set<Readonly<{ resolve: () => void; reject: (error: Error) => void }>>();
  let active = false;
  let disposed = false;
  let sessionDisposed = false;
  let sessionStatus: EchoSessionStatus = "idle";
  let sessionId: string | undefined;
  let credential = initialCredential;
  let sessionEpoch: number | undefined;
  let logicalMapId: string | undefined;
  let incarnationId: string | undefined;
  let sessionFailure: Readonly<{ code: string; message: string }> | undefined;
  let pendingSession: PendingSession | undefined;
  let sessionCreateCount = 0;
  let sessionReattachCount = 0;
  let sessionFencingCount = 0;
  let sessionRejectionCount = 0;
  let stopAttachmentEvents: LocusDisposer | undefined;

  function isReady(): boolean {
    return !disposed && active && (!runtimeOptions.sessionRequired || sessionStatus === "attached")
      && (runtimeOptions.additionalReady?.() ?? true);
  }

  function notifyReadyChange(): void {
    runtimeOptions.onReadyChange?.();
    if (!isReady()) return;
    const waiters = [...readyWaiters];
    readyWaiters.clear();
    for (const waiter of waiters) waiter.resolve();
  }

  function removeAttempt(attemptId: LocusActionId, requestId: LocusActionRequestId): PendingAction | undefined {
    const pending = pendingActions.get(attemptId);
    if (pending === undefined || pending.requestId !== requestId) return undefined;
    pendingActions.delete(attemptId);
    const attempts = attemptsByRequest.get(requestId);
    if (attempts !== undefined) {
      const index = attempts.indexOf(attemptId);
      if (index >= 0) attempts.splice(index, 1);
      if (attempts.length === 0) attemptsByRequest.delete(requestId);
    }
    return pending;
  }

  function rejectEndpointOperations(error: Error): void {
    const actions = [...pendingActions.values()];
    pendingActions.clear();
    attemptsByRequest.clear();
    for (const pending of actions) pending.reject(error);
    const statuses = [...pendingStatuses.values()];
    pendingStatuses.clear();
    for (const pending of statuses) pending.reject(error);
  }

  function rejectPendingSession(error: Error): void {
    const pending = pendingSession;
    pendingSession = undefined;
    pending?.reject(error);
  }

  function connect(): void {
    if (disposed) return;
    if (active) return;
    active = true;
    stopAttachmentEvents = runtimeOptions.attachment.observe((event: EchoAttachmentEvent) => {
      if (!active || disposed) return;
      if (event.kind === "available") {
        runtimeOptions.onAvailable?.();
        runtimeOptions.onReadyChange?.();
      } else if (event.kind === "observation-interrupted") {
        interrupt();
      } else if (event.kind === "fenced") {
        receive(Object.freeze({ type: "session-fenced", sessionId: event.sessionId, epoch: event.epoch,
          code: "LOCUS_SESSION_ATTACHMENT_FENCED" }));
      } else if (event.kind === "ended" && sessionId === event.sessionId && sessionEpoch === event.epoch) {
        sessionStatus = "ended";
        credential = undefined;
        const error = runtimeOptions.operationLossError?.("ended") ?? new LocusDisconnectedError();
        rejectEndpointOperations(error);
        rejectPendingSession(new EchoSessionError("LOCUS_SESSION_ALREADY_GONE", "Locus session ended."));
        runtimeOptions.onAttachmentLost?.("ended", error);
        runtimeOptions.onReadyChange?.();
      }
    });
    notifyReadyChange();
  }

  function disconnect(): void {
    if (!active || disposed) return;
    active = false;
    stopAttachmentEvents?.();
    stopAttachmentEvents = undefined;
    interrupt();
  }

  function interrupt(): void {
    if (disposed) return;
    const error = runtimeOptions.operationLossError?.("disconnect") ?? new LocusDisconnectedError();
    rejectEndpointOperations(error);
    rejectPendingSession(new EchoSessionError("LOCUS_SESSION_DISCONNECTED", "Locus session transport disconnected."));
    if (sessionStatus === "attached" || sessionStatus === "creating" || sessionStatus === "attaching") {
      sessionStatus = "detached";
    }
    runtimeOptions.onAttachmentLost?.("disconnect", error);
    runtimeOptions.onReadyChange?.();
  }

  function receive(message: EchoEndpointServerMessage): boolean {
    if (disposed) return true;
    if (message.type === "action-status") {
      const pending = pendingStatuses.get(message.id);
      if (pending === undefined || pending.requestId !== message.requestId) return true;
      pendingStatuses.delete(message.id);
      pending.resolve(Object.freeze({
        requestId: message.requestId,
        state: message.state,
        ...(message.outcome === undefined ? {} : { outcome: message.outcome }),
      }));
      return true;
    }
    if (message.type === "ack" || message.type === "error") {
      if ("seq" in message) runtimeOptions.onSequence?.(message.seq);
      if (message.id === undefined) return true;
      let attemptId: LocusActionId | undefined;
      if (message.attemptId !== undefined) attemptId = message.attemptId;
      else if (pendingActions.has(message.id)) attemptId = message.id;
      else attemptId = attemptsByRequest.get(message.id)?.[0];
      if (attemptId === undefined) return true;
      const pending = pendingActions.get(attemptId);
      if (pending === undefined) return true;
      const requestId = message.requestId ?? pending.requestId;
      const settled = removeAttempt(attemptId, requestId);
      settled?.resolve(message);
      return true;
    }
    if (message.type === "session-rejected") {
      const status = pendingStatuses.get(message.id);
      if (status !== undefined) {
        pendingStatuses.delete(message.id);
        status.reject(new EchoSessionError(message.code, message.message));
        return true;
      }
      if (sessionDisposed) return true;
      const pending = pendingSession;
      if (pending === undefined || pending.id !== message.id) return true;
      pendingSession = undefined;
      sessionStatus = "failed";
      sessionFailure ??= Object.freeze({ code: message.code, message: message.message });
      sessionRejectionCount += 1;
      pending.reject(new EchoSessionError(message.code, message.message));
      runtimeOptions.onReadyChange?.();
      return true;
    }
    if (message.type === "session-fenced") {
      if (sessionDisposed || sessionId !== message.sessionId || sessionEpoch !== message.epoch) return true;
      sessionStatus = "detached";
      sessionFencingCount += 1;
      sessionFailure ??= Object.freeze({ code: message.code, message: "Locus session attachment was fenced." });
      const disconnected = runtimeOptions.operationLossError?.("fenced") ?? new LocusDisconnectedError();
      rejectEndpointOperations(disconnected);
      rejectPendingSession(new EchoSessionError(message.code, "Locus session attachment was fenced."));
      runtimeOptions.onAttachmentLost?.("fenced", disconnected);
      runtimeOptions.onReadyChange?.();
      return true;
    }
    if (sessionDisposed) return true;
    const pending = pendingSession;
    const expectedKind = message.type === "session-created" ? "create"
      : message.type === "session-attached" ? "reattach"
        : message.type === "session-detached" ? "detach"
        : "goodbye";
    if (pending === undefined || pending.id !== message.id || pending.kind !== expectedKind) return true;
    if ((message.type === "session-ended" || message.type === "session-detached")
      && (sessionId !== message.sessionId || sessionEpoch !== message.epoch)) return true;
    pendingSession = undefined;
    if (message.type === "session-detached") {
      sessionStatus = "detached";
      pending.resolve(undefined);
      runtimeOptions.onAttachmentLost?.("disconnect", runtimeOptions.operationLossError?.("disconnect") ?? new LocusDisconnectedError());
      runtimeOptions.onReadyChange?.();
      return true;
    }
    if (message.type === "session-ended") {
      sessionStatus = "ended";
      credential = undefined;
      const error = runtimeOptions.operationLossError?.("ended") ?? new LocusDisconnectedError();
      rejectEndpointOperations(error);
      pending.resolve(undefined);
      runtimeOptions.onAttachmentLost?.("ended", error);
      runtimeOptions.onReadyChange?.();
      return true;
    }
    if ((logicalMapId !== undefined && logicalMapId !== message.logicalMapId)
      || (incarnationId !== undefined && incarnationId !== message.incarnationId)) {
      const mismatch = new EchoSessionError(
        "LOCUS_SESSION_AUTHORITY_MISMATCH",
        "Locus session authority identity contradicts the established session authority.",
      );
      sessionStatus = "failed";
      sessionFailure ??= Object.freeze({ code: mismatch.code, message: mismatch.message });
      sessionRejectionCount += 1;
      rejectEndpointOperations(mismatch);
      pending.reject(mismatch);
      runtimeOptions.onAttachmentLost?.("fenced", mismatch);
      runtimeOptions.onReadyChange?.();
      return true;
    }
    sessionId = message.sessionId;
    sessionEpoch = message.epoch;
    logicalMapId = message.logicalMapId;
    incarnationId = message.incarnationId;
    sessionStatus = "attached";
    sessionFailure = undefined;
    if (message.type === "session-created") {
      credential = message.credential;
      sessionCreateCount += 1;
    } else sessionReattachCount += 1;
    pending.resolve(Object.freeze({
      sessionId: message.sessionId,
      epoch: message.epoch,
      logicalMapId: message.logicalMapId,
      incarnationId: message.incarnationId,
      reattached: message.type === "session-attached",
    }));
    notifyReadyChange();
    return true;
  }

  function beginSession(kind: PendingSession["kind"], suppliedCredential?: LocusSessionCredential): Promise<EchoSessionResult | undefined> {
    if (sessionDisposed || disposed) return Promise.reject(new EchoSessionError("LOCUS_SESSION_DISPOSED", "Echo session API is disposed."));
    if (!active) return Promise.reject(new EchoSessionError("LOCUS_SESSION_DISCONNECTED", "Locus session requires active Echo participation."));
    if (pendingSession !== undefined) return Promise.reject(new EchoSessionError("LOCUS_SESSION_REQUEST_PENDING", "A Locus session request is already pending."));
    const id = makeSessionId(kind);
    if (usedCorrelationIds.has(id)) return Promise.reject(new EchoSessionError("LOCUS_SESSION_REQUEST_PENDING", "Locus session request correlation ID is already in use."));
    usedCorrelationIds.add(id);
    if (kind === "create") sessionStatus = "creating";
    if (kind === "reattach") sessionStatus = "attaching";
    return new Promise((resolve, reject) => {
      const pending: PendingSession = Object.freeze({ id, kind, resolve, reject });
      pendingSession = pending;
      void runtimeOptions.operations.submit(Object.freeze({
          type: kind === "create" ? "session-create" : kind === "reattach" ? "session-attach"
            : kind === "detach" ? "session-detach" : "session-goodbye",
          id,
          ...(kind === "reattach" && suppliedCredential !== undefined ? { credential: suppliedCredential } : {}),
        })).then((submission) => {
          if (pendingSession !== pending) return;
          if (submission.kind === "response") receive(submission.outcome);
          else {
            pendingSession = undefined;
            reject(new EchoSessionError("LOCUS_SESSION_DISCONNECTED", submission.kind === "uncertain"
              ? "Locus session request outcome is uncertain." : "Locus session request was not submitted."));
          }
        }, (cause) => {
          if (pendingSession !== pending) return;
          pendingSession = undefined;
          reject(Object.assign(new EchoSessionError("LOCUS_SESSION_DISCONNECTED", "Locus session request outcome is uncertain."), { cause }));
        });
    });
  }

  async function createSession(): Promise<EchoSessionResult> {
    if (sessionStatus === "attached") throw new EchoSessionError("LOCUS_SESSION_ALREADY_ATTACHED", "A Locus session is already attached.");
    const result = await beginSession("create");
    if (result === undefined) throw new EchoSessionError("LOCUS_SESSION_CREATE_FAILED", "Locus session creation produced no result.");
    return result;
  }

  async function reattachSession(suppliedCredential = credential): Promise<EchoSessionResult> {
    if (sessionStatus === "attached") throw new EchoSessionError("LOCUS_SESSION_ALREADY_ATTACHED", "A Locus session is already attached.");
    const result = await beginSession("reattach", suppliedCredential);
    if (result === undefined) throw new EchoSessionError("LOCUS_SESSION_ATTACH_FAILED", "Locus session reattachment produced no result.");
    credential = suppliedCredential;
    return result;
  }

  async function goodbyeSession(): Promise<void> {
    if (sessionStatus === "ended") throw new EchoSessionError("LOCUS_SESSION_ALREADY_GONE", "Locus session is already ended.");
    if (sessionStatus !== "attached") throw new EchoSessionError("LOCUS_SESSION_NOT_ATTACHED", "No authoritative Locus session is attached.");
    await beginSession("goodbye");
  }

  async function detachSession(): Promise<void> {
    if (sessionStatus !== "attached") return;
    await beginSession("detach");
  }

  function disposeSession(): void {
    if (sessionDisposed) return;
    sessionDisposed = true;
    sessionStatus = "disposed";
    rejectPendingSession(new EchoSessionError("LOCUS_SESSION_DISPOSED", "Echo session API was disposed."));
    runtimeOptions.onReadyChange?.();
  }

  function actionHandle<TName extends keyof TActions & string>(
    request: EchoActionRequest<TActions, TName>, retry: boolean,
  ): EchoActionPromise<TActions, TName> {
    const attemptId = makeAttemptId();
    if (!isReady()) return Object.assign(Promise.reject(new LocusDisconnectedError()), { request });
    if (usedCorrelationIds.has(attemptId)) {
      return Object.assign(Promise.reject(new LocusDuplicateActionIdError(attemptId)), { request });
    }
    usedCorrelationIds.add(attemptId);
    const promise = new Promise<LocusClientActionResult>((resolve, reject) => {
      pendingActions.set(attemptId, Object.freeze({ requestId: request.requestId, resolve, reject }));
      const attempts = attemptsByRequest.get(request.requestId) ?? [];
      attempts.push(attemptId);
      attemptsByRequest.set(request.requestId, attempts);
      const message = Object.freeze({
          type: "action",
          id: runtimeOptions.actionMessageId === "attempt" ? attemptId : request.requestId,
          requestId: request.requestId,
          attemptId,
          clientId,
          name: request.name,
          ...(request.payload === undefined ? {} : { payload: request.payload }),
          ...(retry ? { retry: true } : {}),
        }) as LocusClientActionMessage<TActions>;
      void runtimeOptions.operations.submit(message).then((submission) => {
        if (!pendingActions.has(attemptId)) return;
        if (submission.kind === "response") receive(submission.outcome);
        else {
          removeAttempt(attemptId, request.requestId);
          reject(submission_error(submission));
        }
      }, (cause) => {
        removeAttempt(attemptId, request.requestId);
        reject(submission_error(Object.freeze({ kind: "uncertain", cause })));
      });
    });
    return Object.assign(promise, { request });
  }

  function action<TName extends keyof TActions & string>(
    name: TName,
    ...args: undefined extends TActions[TName]
      ? [payload?: Exclude<TActions[TName], undefined> | HsonData]
      : [payload: TActions[TName] | HsonData]
  ): EchoActionPromise<TActions, TName> {
    const requestId = makeActionId();
    const request: EchoActionRequest<TActions, TName> = Object.freeze({
      requestId,
      name,
      ...(args[0] === undefined ? {} : { payload: admit_echo_action_payload(args[0]) }),
    });
    return actionHandle(request, false);
  }

  function retryAction<TName extends keyof TActions & string>(request: EchoActionRequest<TActions, TName>): EchoActionPromise<TActions, TName> {
    const stable: EchoActionRequest<TActions, TName> = Object.freeze({
      requestId: request.requestId,
      name: request.name,
      ...(request.payload === undefined ? {} : { payload: admit_echo_action_payload(request.payload) }),
    });
    return actionHandle(stable, true);
  }

  function actionStatus(requestId: LocusActionRequestId): Promise<EchoActionStatusResult> {
    if (!isReady()) return Promise.reject(new LocusDisconnectedError());
    const id = makeStatusId();
    if (usedCorrelationIds.has(id)) return Promise.reject(new Error(`Locus action status correlation ID ${JSON.stringify(id)} is already in use.`));
    usedCorrelationIds.add(id);
    return new Promise((resolve, reject) => {
      pendingStatuses.set(id, Object.freeze({ requestId, resolve, reject }));
      void runtimeOptions.operations.submit(Object.freeze({ type: "action-status", id, clientId, requestId })).then((submission) => {
        if (!pendingStatuses.has(id)) return;
        if (submission.kind === "response") receive(submission.outcome);
        else {
          pendingStatuses.delete(id);
          reject(submission_error(submission));
        }
      }, (cause) => {
        pendingStatuses.delete(id);
        reject(submission_error(Object.freeze({ kind: "uncertain", cause })));
      });
    });
  }

  function waitUntilReady(): Promise<void> {
    if (isReady()) return Promise.resolve();
    if (disposed) return Promise.reject(new LocusDisconnectedError());
    return new Promise((resolve, reject) => readyWaiters.add(Object.freeze({ resolve, reject })));
  }

  function debugSession(): EchoSessionDiagnostics {
    return Object.freeze({
      status: sessionStatus,
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(sessionEpoch === undefined ? {} : { epoch: sessionEpoch }),
      hasCredential: credential !== undefined,
      createCount: sessionCreateCount,
      reattachCount: sessionReattachCount,
      fencingCount: sessionFencingCount,
      rejectionCount: sessionRejectionCount,
    });
  }

  const session: EchoSession = Object.freeze({
    get status() { return sessionStatus; },
    get sessionId() { return sessionId; },
    get credential() { return credential; },
    get epoch() { return sessionEpoch; },
    get logicalMapId() { return logicalMapId; },
    get incarnationId() { return incarnationId; },
    get failure() { return sessionFailure; },
    create: createSession,
    reattach: reattachSession,
    goodbye: goodbyeSession,
    dispose: disposeSession,
    debug: debugSession,
  });

  return Object.freeze({
    clientId,
    session,
    get active() { return active; },
    get ready() { return isReady(); },
    detachSession,
    connect,
    disconnect,
    interrupt,
    receive,
    action,
    retryAction,
    actionStatus,
    waitUntilReady,
    dispose: () => {
      if (disposed) return;
      if (active) disconnect();
      disposed = true;
      stopAttachmentEvents?.();
      stopAttachmentEvents = undefined;
      const error = new LocusDisconnectedError();
      rejectEndpointOperations(error);
      rejectPendingSession(new EchoSessionError("LOCUS_SESSION_DISPOSED", "Echo session API was disposed."));
      for (const waiter of readyWaiters) waiter.reject(error);
      readyWaiters.clear();
      usedCorrelationIds.clear();
      sessionDisposed = true;
      sessionStatus = "disposed";
      credential = undefined;
      runtimeOptions.onReadyChange?.();
    },
  });
}
