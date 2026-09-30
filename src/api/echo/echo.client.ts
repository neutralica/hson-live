import type {
  Echo,
  EchoOptions,
  EchoSessionOptions,
  LocusActionPayloads,
  LocusDisposer,
} from "../../types/locus.types.js";
import type {
  EchoEndpointTransport,
  EchoReplicaTransport,
} from "../../types/echo.transport.types.js";
import {
  create_echo_endpoint_internal,
  type EchoEndpoint,
  type EchoEndpointIdFactories,
} from "./echo.endpoint.js";
import { release_echo_transport_owner_internal } from "./echo.transport-owner.internal.js";

export type EchoEndpointConnectionOptions<TActions extends LocusActionPayloads = LocusActionPayloads> = Readonly<{
  transport: EchoEndpointTransport<TActions>;
  clientId?: string;
  session?: EchoSessionOptions;
  ids?: EchoEndpointIdFactories;
  actionMessageId?: "request" | "attempt";
  operationLossError?: (reason: "disconnect" | "fenced" | "ended") => Error;
  additionalReady?: () => boolean;
}>;

/** One semantic Echo participation, independent of adapter-owned physical channels. */
export type EchoEndpointConnection<TActions extends LocusActionPayloads = LocusActionPayloads> = Readonly<{
  endpoint: EchoEndpoint<TActions>;
  echo: Echo<undefined, TActions>;
  readonly available: boolean;
  onAvailabilityChange: (listener: (available: boolean) => void) => LocusDisposer;
  onReadyChange: (listener: () => void) => LocusDisposer;
  onAttachmentLost: (listener: (reason: "disconnect" | "fenced" | "ended", error: Error) => void) => LocusDisposer;
  transport: EchoEndpointTransport<TActions>;
}>;

export function create_echo_semantic_connection_internal<TActions extends LocusActionPayloads = LocusActionPayloads>(
  options: EchoEndpointConnectionOptions<TActions>,
): EchoEndpointConnection<TActions> {
  const availabilityListeners = new Set<(available: boolean) => void>();
  const readyListeners = new Set<() => void>();
  const attachmentLostListeners = new Set<(reason: "disconnect" | "fenced" | "ended", error: Error) => void>();
  let available = false;
  let disposed = false;
  const endpoint = create_echo_endpoint_internal<TActions>({
    operations: options.transport.operations,
    attachment: options.transport.attachment,
    ...(options.clientId === undefined ? {} : { clientId: options.clientId }),
    ...(options.session?.credential === undefined ? {} : { credential: options.session.credential }),
    sessionRequired: true,
    ...(options.ids === undefined ? {} : { ids: options.ids }),
    ...(options.actionMessageId === undefined ? {} : { actionMessageId: options.actionMessageId }),
    ...(options.operationLossError === undefined ? {} : { operationLossError: options.operationLossError }),
    ...(options.additionalReady === undefined ? {} : { additionalReady: options.additionalReady }),
    onAvailable: () => {
      if (available || disposed) return;
      available = true;
      for (const listener of [...availabilityListeners]) listener(true);
    },
    onReadyChange: () => { for (const listener of [...readyListeners]) listener(); },
    onAttachmentLost: (reason, error) => {
      if (reason === "disconnect" && available) {
        available = false;
        for (const listener of [...availabilityListeners]) listener(false);
      }
      for (const listener of [...attachmentLostListeners]) listener(reason, error);
    },
  });

  const connect = (): LocusDisposer => {
    if (!disposed) endpoint.connect();
    return disconnect;
  };
  const disconnect = (): void => {
    if (disposed) return;
    endpoint.disconnect();
    if (available) {
      available = false;
      for (const listener of [...availabilityListeners]) listener(false);
    }
  };
  const dispose = (): void => {
    if (disposed) return;
    disconnect();
    disposed = true;
    endpoint.dispose();
    release_echo_transport_owner_internal(options.transport);
    availabilityListeners.clear();
    readyListeners.clear();
    attachmentLostListeners.clear();
  };
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
    get available() { return available; },
    onAvailabilityChange(listener: (next: boolean) => void) {
      if (disposed) return () => {};
      availabilityListeners.add(listener);
      listener(available);
      return () => availabilityListeners.delete(listener);
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
    transport: options.transport,
  });
}

export function create_endpoint_echo_internal<TActions extends LocusActionPayloads = LocusActionPayloads>(
  options: EchoOptions,
): Echo<undefined, TActions> {
  const connection = create_echo_semantic_connection_internal<TActions>(options);
  connection.onAvailabilityChange((available) => {
    if (available && connection.echo.session.status === "detached" && connection.echo.session.credential !== undefined) {
      void connection.echo.session.reattach().catch(() => {
        // The session API retains the failed attachment state for the caller.
      });
    }
  });
  return connection.echo;
}

/** Narrow a public transport only where replica composition needs its feed. */
export function replica_transport_internal<TActions extends LocusActionPayloads>(
  transport: EchoEndpointTransport<TActions>,
): EchoReplicaTransport<TActions> {
  if (!("synchronization" in transport) || typeof transport.synchronization !== "object"
    || transport.synchronization === null || typeof Reflect.get(transport.synchronization, "open") !== "function") {
    throw new TypeError("Echo replica requires a synchronization capability.");
  }
  return transport as EchoReplicaTransport<TActions>;
}
