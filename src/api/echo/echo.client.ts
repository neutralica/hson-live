import type {
  Echo,
  EchoOptions,
  LocusActionPayloads,
  LocusDisposer,
} from "../../types/locus.types.js";
import { create_echo_endpoint_internal, type EchoEndpointServerMessage } from "./echo.endpoint.js";

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

/** @internal Endpoint-only wire admission without importing replica protocol machinery. */
function decodeEndpointMessage(raw: string): EchoEndpointServerMessage | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(value) || !isNonemptyString(value.type)) return undefined;
  if (value.type === "ack" || value.type === "error") {
    return value as EchoEndpointServerMessage;
  }
  if (value.type === "action-status") {
    if (!isNonemptyString(value.id) || !isNonemptyString(value.requestId)) return undefined;
    if (value.state !== "pending" && value.state !== "succeeded" && value.state !== "failed" && value.state !== "unknown" && value.state !== "expired") return undefined;
    return value as EchoEndpointServerMessage;
  }
  if (value.type === "session-fenced") {
    if (!hasExactKeys(value, ["type", "sessionId", "epoch", "code"])
      || !isNonemptyString(value.sessionId)
      || !isRevision(value.epoch)
      || value.code !== "LOCUS_SESSION_ATTACHMENT_FENCED") return undefined;
    return value as EchoEndpointServerMessage;
  }
  if (value.type === "session-created") {
    if (!hasExactKeys(value, ["type", "id", "sessionId", "credential", "epoch", "logicalMapId", "incarnationId"])
      || !isNonemptyString(value.id)
      || !isNonemptyString(value.sessionId)
      || !isNonemptyString(value.credential)
      || !isRevision(value.epoch)
      || !isNonemptyString(value.logicalMapId)
      || !isNonemptyString(value.incarnationId)) return undefined;
    return value as EchoEndpointServerMessage;
  }
  if (value.type === "session-attached") {
    if (!hasExactKeys(value, ["type", "id", "sessionId", "epoch", "logicalMapId", "incarnationId"])
      || !isNonemptyString(value.id)
      || !isNonemptyString(value.sessionId)
      || !isRevision(value.epoch)
      || !isNonemptyString(value.logicalMapId)
      || !isNonemptyString(value.incarnationId)) return undefined;
    return value as EchoEndpointServerMessage;
  }
  if (value.type === "session-rejected") {
    if (!hasExactKeys(value, ["type", "id", "code", "message"])
      || !isNonemptyString(value.id)
      || !isNonemptyString(value.code)
      || !isNonemptyString(value.message)) return undefined;
    return value as EchoEndpointServerMessage;
  }
  if (value.type === "session-ended") {
    if (!hasExactKeys(value, ["type", "id", "sessionId", "epoch"])
      || !isNonemptyString(value.id)
      || !isNonemptyString(value.sessionId)
      || !isRevision(value.epoch)) return undefined;
    return value as EchoEndpointServerMessage;
  }
  return undefined;
}

/** @internal Replica-independent public Echo composition. */
export function create_endpoint_echo_internal<
  TActions extends LocusActionPayloads = LocusActionPayloads,
>(options: EchoOptions<undefined>): Echo<undefined, TActions> {
  const endpoint = create_echo_endpoint_internal<TActions>({
    transport: { send: (message) => options.socket.send(JSON.stringify(message)) },
    ...(options.clientId === undefined ? {} : { clientId: options.clientId }),
    ...(options.session?.credential === undefined ? {} : { credential: options.session.credential }),
    sessionRequired: true,
  });
  let connected = false;
  let disposed = false;
  const transportDisposers: LocusDisposer[] = [];

  function disconnect(): void {
    if (!connected) return;
    connected = false;
    while (transportDisposers.length > 0) transportDisposers.pop()?.();
    endpoint.disconnect();
  }

  function connect(): LocusDisposer {
    if (disposed || connected) return disconnect;
    connected = true;
    const stopMessage = options.socket.onMessage((raw) => {
      const decoded = decodeEndpointMessage(raw);
      if (decoded !== undefined) endpoint.receive(decoded);
    });
    if (stopMessage !== undefined) transportDisposers.push(stopMessage);
    const stopClose = options.socket.onClose(disconnect);
    if (stopClose !== undefined) transportDisposers.push(stopClose);
    endpoint.connect();
    return disconnect;
  }

  return Object.freeze({
    clientId: endpoint.clientId,
    session: endpoint.session,
    connect,
    disconnect,
    action: endpoint.action,
    retryAction: endpoint.retryAction,
    actionStatus: endpoint.actionStatus,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      disconnect();
      endpoint.dispose();
    },
  }) as unknown as Echo<undefined, TActions>;
}
