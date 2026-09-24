import type {
  Echo,
  EchoOptions,
  EchoSessionOptions,
  LocusActionPayloads,
  LocusClientMessage,
  LocusDisposer,
  LocusSocketLike,
} from "../../types/locus.types.js";
import {
  decode_hson_data_internal,
  encode_hson_data_internal,
  admit_hson_data_input,
  hson_data_text,
} from "../data/hson-data.js";
import {
  create_echo_endpoint_internal,
  type EchoEndpoint,
  type EchoEndpointIdFactories,
  type EchoEndpointServerMessage,
} from "./echo.endpoint.js";
import {
  create_echo_finite_operation_adapter_internal,
  type EchoFiniteOperationCapability,
} from "./echo.operation.internal.js";
import {
  create_echo_synchronization_adapter_internal,
  type EchoSynchronizationCapability,
  type EchoSynchronizationOutput,
  type EchoSynchronizationRequest,
} from "./echo.synchronization.internal.js";

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRevision(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value >= 0;
}

function hasExactKeys(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function encodeEndpointMessage(message: LocusClientMessage | EchoSynchronizationRequest): string {
  if (message.type !== "action") return JSON.stringify(message);
  const { payload, ...rest } = message;
  return JSON.stringify({
    ...rest,
    ...(payload === undefined ? {} : { payloadData: encode_hson_data_internal(admit_hson_data_input(payload)) }),
  });
}

/** @internal Endpoint-only wire admission without importing replica protocol machinery. */
function decodeEndpointMessage(raw: string, format?: string): EchoEndpointServerMessage | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(value) || !isNonemptyString(value.type)) return undefined;
  const exactKeys = (keys: readonly string[]): boolean => hasExactKeys(value, format === undefined ? keys : [...keys, "format"])
    && (format === undefined || value.format === format);
  if (value.type === "ack") {
    const resultPresent = Object.hasOwn(value, "resultData");
    const requestIdPresent = Object.hasOwn(value, "requestId");
    const attemptIdPresent = Object.hasOwn(value, "attemptId");
    const completionRevPresent = Object.hasOwn(value, "completionRev");
    const deliveryPresent = Object.hasOwn(value, "delivery");
    if (!exactKeys([
      "type", "id", "ok", "seq",
      ...(resultPresent ? ["resultData"] : []),
      ...(requestIdPresent ? ["requestId"] : []),
      ...(attemptIdPresent ? ["attemptId"] : []),
      ...(completionRevPresent ? ["completionRev"] : []),
      ...(deliveryPresent ? ["delivery"] : []),
    ]) || !isNonemptyString(value.id) || value.ok !== true || !isRevision(value.seq)
      || (requestIdPresent && !isNonemptyString(value.requestId))
      || (attemptIdPresent && !isNonemptyString(value.attemptId))
      || (completionRevPresent && !isRevision(value.completionRev))
      || (deliveryPresent && value.delivery !== "executed" && value.delivery !== "joined" && value.delivery !== "cached" && value.delivery !== "rejected")
      || (resultPresent && typeof value.resultData !== "string")) return undefined;
    try {
      const result = resultPresent ? hson_data_text(decode_hson_data_internal(value.resultData as string)) : undefined;
      return Object.freeze({
        type: "ack",
        id: value.id,
        ok: true,
        seq: value.seq,
        ...(requestIdPresent ? { requestId: value.requestId } : {}),
        ...(attemptIdPresent ? { attemptId: value.attemptId } : {}),
        ...(completionRevPresent ? { completionRev: value.completionRev } : {}),
        ...(deliveryPresent ? { delivery: value.delivery } : {}),
        ...(result === undefined ? {} : { result }),
      }) as EchoEndpointServerMessage;
    } catch {
      return undefined;
    }
  }
  if (value.type === "action-status") {
    if (!isNonemptyString(value.id) || !isNonemptyString(value.requestId)
      || (value.state !== "pending" && value.state !== "succeeded" && value.state !== "failed" && value.state !== "unknown" && value.state !== "expired")) return undefined;
    if (value.state === "pending" || value.state === "unknown" || value.state === "expired") {
      return exactKeys(["type", "id", "requestId", "state"])
        ? value as EchoEndpointServerMessage
        : undefined;
    }
    if (!exactKeys(["type", "id", "requestId", "state", "outcome"]) || !isRecord(value.outcome)
      || value.outcome.state !== value.state || !isRevision(value.outcome.seq) || !isRevision(value.outcome.completionRev)) return undefined;
    if (value.state === "succeeded") {
      const resultPresent = Object.hasOwn(value.outcome, "resultData");
      if (!hasExactKeys(value.outcome, ["state", "seq", "completionRev", ...(resultPresent ? ["resultData"] : [])])
        || (resultPresent && typeof value.outcome.resultData !== "string")) return undefined;
      try {
        const result = resultPresent ? hson_data_text(decode_hson_data_internal(value.outcome.resultData as string)) : undefined;
        return Object.freeze({
          type: "action-status",
          id: value.id,
          requestId: value.requestId,
          state: value.state,
          outcome: Object.freeze({
            state: value.state,
            seq: value.outcome.seq,
            completionRev: value.outcome.completionRev,
            ...(result === undefined ? {} : { result }),
          }),
        }) as EchoEndpointServerMessage;
      } catch {
        return undefined;
      }
    }
    if (!hasExactKeys(value.outcome, ["state", "seq", "completionRev", "error"])
      || !isRecord(value.outcome.error) || !isNonemptyString(value.outcome.error.message)
      || (Object.hasOwn(value.outcome.error, "code") && typeof value.outcome.error.code !== "string")) return undefined;
    return value as EchoEndpointServerMessage;
  }
  if (value.type === "error") {
    return value as EchoEndpointServerMessage;
  }
  if (value.type === "session-fenced") {
    if (!exactKeys(["type", "sessionId", "epoch", "code"])
      || !isNonemptyString(value.sessionId)
      || !isRevision(value.epoch)
      || value.code !== "LOCUS_SESSION_ATTACHMENT_FENCED") return undefined;
    return value as EchoEndpointServerMessage;
  }
  if (value.type === "session-created") {
    if (!exactKeys(["type", "id", "sessionId", "credential", "epoch", "logicalMapId", "incarnationId"])
      || !isNonemptyString(value.id)
      || !isNonemptyString(value.sessionId)
      || !isNonemptyString(value.credential)
      || !isRevision(value.epoch)
      || !isNonemptyString(value.logicalMapId)
      || !isNonemptyString(value.incarnationId)) return undefined;
    return value as EchoEndpointServerMessage;
  }
  if (value.type === "session-attached") {
    if (!exactKeys(["type", "id", "sessionId", "epoch", "logicalMapId", "incarnationId"])
      || !isNonemptyString(value.id)
      || !isNonemptyString(value.sessionId)
      || !isRevision(value.epoch)
      || !isNonemptyString(value.logicalMapId)
      || !isNonemptyString(value.incarnationId)) return undefined;
    return value as EchoEndpointServerMessage;
  }
  if (value.type === "session-rejected") {
    if (!exactKeys(["type", "id", "code", "message"])
      || !isNonemptyString(value.id)
      || !isNonemptyString(value.code)
      || !isNonemptyString(value.message)) return undefined;
    return value as EchoEndpointServerMessage;
  }
  if (value.type === "session-ended") {
    if (!exactKeys(["type", "id", "sessionId", "epoch"])
      || !isNonemptyString(value.id)
      || !isNonemptyString(value.sessionId)
      || !isRevision(value.epoch)) return undefined;
    return value as EchoEndpointServerMessage;
  }
  return undefined;
}

/** @internal Lightweight options for the common Echo transport/session connection. */
export type EchoEndpointConnectionOptions<TActions extends LocusActionPayloads = LocusActionPayloads> = Readonly<{
  socket: LocusSocketLike;
  clientId?: string;
  session?: EchoSessionOptions;
  ids?: EchoEndpointIdFactories;
  actionMessageId?: "request" | "attempt";
  operationLossError?: (reason: "disconnect" | "fenced" | "ended") => Error;
  endpointMessageFormat?: string;
}>;

/** @internal Shared transport/session shell used by endpoint-only and deferred-replica Echo. */
export type EchoEndpointConnection<
  TActions extends LocusActionPayloads = LocusActionPayloads,
  TSynchronizationRequest = EchoSynchronizationRequest,
  TSynchronizationOutput = EchoSynchronizationOutput,
> = Readonly<{
  endpoint: EchoEndpoint<TActions>;
  echo: Echo<undefined, TActions>;
  readonly connected: boolean;
  onConnectionChange: (listener: (connected: boolean) => void) => LocusDisposer;
  onReadyChange: (listener: () => void) => LocusDisposer;
  onAttachmentLost: (listener: (reason: "disconnect" | "fenced" | "ended", error: Error) => void) => LocusDisposer;
  synchronization: EchoSynchronizationCapability<TSynchronizationRequest, TSynchronizationOutput>;
  /** @internal Present only on the current WebSocket adapter. */
  setSynchronizationDecoder?: (
    decoder: (raw: string) => TSynchronizationOutput | undefined,
  ) => LocusDisposer;
  /** @internal Present only on the current WebSocket adapter. */
  setMessageEncoder?: (encoder: (message: LocusClientMessage<TActions> | EchoSynchronizationRequest) => string) => LocusDisposer;
}>;

/** @internal Transport lifecycle supplied independently of semantic capabilities. */
export type EchoSemanticAttachmentLifecycle = Readonly<{
  attach: (onDisconnect: () => void) => LocusDisposer;
}>;

/** @internal Smallest reusable Echo composition boundary below public transport options. */
export type EchoSemanticConnectionOptions<
  TActions extends LocusActionPayloads = LocusActionPayloads,
  TSynchronizationRequest = EchoSynchronizationRequest,
  TSynchronizationOutput = EchoSynchronizationOutput,
> = Readonly<{
  operations: EchoFiniteOperationCapability<TActions>;
  synchronization: EchoSynchronizationCapability<TSynchronizationRequest, TSynchronizationOutput>;
  lifecycle: EchoSemanticAttachmentLifecycle;
  clientId?: string;
  session?: EchoSessionOptions;
  ids?: EchoEndpointIdFactories;
  actionMessageId?: "request" | "attempt";
  operationLossError?: (reason: "disconnect" | "fenced" | "ended") => Error;
}>;

/** @internal Compose semantic Echo from independently supplied capabilities. */
export function create_echo_semantic_connection_internal<
  TActions extends LocusActionPayloads = LocusActionPayloads,
  TSynchronizationRequest = EchoSynchronizationRequest,
  TSynchronizationOutput = EchoSynchronizationOutput,
>(options: EchoSemanticConnectionOptions<TActions, TSynchronizationRequest, TSynchronizationOutput>): EchoEndpointConnection<TActions, TSynchronizationRequest, TSynchronizationOutput> {
  if (options.operations.binding === undefined
    || options.synchronization.binding === undefined
    || options.operations.binding !== options.synchronization.binding) {
    throw new Error("Echo semantic operation and synchronization capabilities require one authority/session binding.");
  }
  const connectionListeners = new Set<(connected: boolean) => void>();
  const readyListeners = new Set<() => void>();
  const attachmentLostListeners = new Set<(reason: "disconnect" | "fenced" | "ended", error: Error) => void>();
  const endpoint = create_echo_endpoint_internal<TActions>({
    operations: options.operations,
    ...(options.clientId === undefined ? {} : { clientId: options.clientId }),
    ...(options.session?.credential === undefined ? {} : { credential: options.session.credential }),
    sessionRequired: true,
    ...(options.ids === undefined ? {} : { ids: options.ids }),
    ...(options.actionMessageId === undefined ? {} : { actionMessageId: options.actionMessageId }),
    ...(options.operationLossError === undefined ? {} : { operationLossError: options.operationLossError }),
    onReadyChange: () => { for (const listener of [...readyListeners]) listener(); },
    onAttachmentLost: (reason, error) => {
      for (const listener of [...attachmentLostListeners]) listener(reason, error);
    },
  });
  let connected = false;
  let disposed = false;
  let detachTransport: LocusDisposer | undefined;

  function disconnect(): void {
    if (!connected) return;
    connected = false;
    const detach = detachTransport;
    detachTransport = undefined;
    detach?.();
    endpoint.disconnect();
    for (const listener of [...connectionListeners]) listener(false);
  }

  function connect(): LocusDisposer {
    if (disposed || connected) return disconnect;
    connected = true;
    detachTransport = options.lifecycle.attach(disconnect);
    endpoint.connect();
    for (const listener of [...connectionListeners]) listener(true);
    return disconnect;
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    disconnect();
    endpoint.dispose();
    connectionListeners.clear();
    readyListeners.clear();
    attachmentLostListeners.clear();
  }

  const echo = Object.freeze({
    clientId: endpoint.clientId,
    session: endpoint.session,
    connect,
    disconnect,
    action: endpoint.action,
    retryAction: endpoint.retryAction,
    actionStatus: endpoint.actionStatus,
    dispose,
  }) as unknown as Echo<undefined, TActions>;

  return Object.freeze({
    endpoint,
    echo,
    get connected() { return connected; },
    onConnectionChange(listener: (connected: boolean) => void) {
      if (disposed) return () => {};
      connectionListeners.add(listener);
      listener(connected);
      return () => connectionListeners.delete(listener);
    },
    onReadyChange(listener: () => void) {
      if (disposed) return () => {};
      readyListeners.add(listener);
      return () => readyListeners.delete(listener);
    },
    onAttachmentLost(listener: (reason: "disconnect" | "fenced" | "ended", error: Error) => void) {
      if (disposed) return () => {};
      attachmentLostListeners.add(listener);
      return () => attachmentLostListeners.delete(listener);
    },
    synchronization: options.synchronization,
  });
}

/** @internal Construct the lightweight common endpoint and own its socket listeners. */
export function create_echo_endpoint_connection_internal<
  TActions extends LocusActionPayloads = LocusActionPayloads,
>(options: EchoEndpointConnectionOptions<TActions>): EchoEndpointConnection<TActions> {
  let encodeMessage = (message: LocusClientMessage<TActions> | EchoSynchronizationRequest): string => encodeEndpointMessage(message);
  let decodeSynchronization: ((raw: string) => EchoSynchronizationOutput | undefined) | undefined;
  let disposed = false;
  const binding = Object.freeze({});
  const operationAdapter = create_echo_finite_operation_adapter_internal<TActions>(
    (message) => options.socket.send(encodeMessage(message)),
    binding,
  );
  const synchronizationAdapter = create_echo_synchronization_adapter_internal(
    (message) => options.socket.send(encodeMessage(message)),
    binding,
  );
  const semantic = create_echo_semantic_connection_internal<TActions>({
    operations: operationAdapter.capability,
    synchronization: synchronizationAdapter.capability,
    lifecycle: Object.freeze({
      attach(onDisconnect) {
        const disposers: LocusDisposer[] = [];
        const stopMessage = options.socket.onMessage((raw) => {
          const decoded = decodeEndpointMessage(raw, options.endpointMessageFormat);
          if (decoded !== undefined) operationAdapter.deliver(decoded);
          const synchronization = decodeSynchronization?.(raw);
          if (synchronization !== undefined) synchronizationAdapter.deliver(synchronization);
        });
        if (stopMessage !== undefined) disposers.push(stopMessage);
        const stopClose = options.socket.onClose(onDisconnect);
        if (stopClose !== undefined) disposers.push(stopClose);
        return () => {
          while (disposers.length > 0) disposers.pop()?.();
        };
      },
    }),
    ...(options.clientId === undefined ? {} : { clientId: options.clientId }),
    ...(options.session === undefined ? {} : { session: options.session }),
    ...(options.ids === undefined ? {} : { ids: options.ids }),
    ...(options.actionMessageId === undefined ? {} : { actionMessageId: options.actionMessageId }),
    ...(options.operationLossError === undefined ? {} : { operationLossError: options.operationLossError }),
  });

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    semantic.echo.dispose();
    operationAdapter.clear();
    synchronizationAdapter.clear();
  }

  const baseEcho = semantic.echo;
  const echo = Object.freeze({
    clientId: baseEcho.clientId,
    session: baseEcho.session,
    connect: baseEcho.connect,
    disconnect: baseEcho.disconnect,
    action: baseEcho.action,
    retryAction: baseEcho.retryAction,
    actionStatus: baseEcho.actionStatus,
    dispose,
  }) as unknown as Echo<undefined, TActions>;

  return Object.freeze({
    endpoint: semantic.endpoint,
    echo,
    get connected() { return semantic.connected; },
    onConnectionChange: semantic.onConnectionChange,
    onReadyChange: semantic.onReadyChange,
    onAttachmentLost: semantic.onAttachmentLost,
    synchronization: synchronizationAdapter.capability,
    setSynchronizationDecoder(decoder) {
      if (disposed) return () => {};
      const previous = decodeSynchronization;
      decodeSynchronization = decoder;
      return () => {
        if (decodeSynchronization === decoder) decodeSynchronization = previous;
      };
    },
    setMessageEncoder(encoder) {
      if (disposed) return () => {};
      const previous = encodeMessage;
      encodeMessage = encoder;
      return () => {
        if (encodeMessage === encoder) encodeMessage = previous;
      };
    },
  });
}

/** @internal Replica-independent public Echo composition. */
export function create_endpoint_echo_internal<
  TActions extends LocusActionPayloads = LocusActionPayloads,
>(options: EchoOptions<undefined>): Echo<undefined, TActions> {
  return create_echo_endpoint_connection_internal<TActions>(options).echo;
}
