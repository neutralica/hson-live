import type { LiveMapAuthority, LiveMapLibraries } from "../../types/livemap.types.js";
import type {
  Echo,
  EchoOptions,
  EchoRecovery,
  EchoRecoveryChangeListener,
  EchoRecoveryDiagnostics,
  EchoRecoveryFailure,
  EchoRecoveryOptions,
  EchoRecoveryResult,
  EchoRecoveryStatus,
  EchoRecoveryStrategy,
  LocusActionPayloads,
  LocusDisposer,
} from "../../types/locus.types.js";
import type { EchoMapManagementLease } from "../../internal/echo-map-capability.js";
import { EchoRecoveryError } from "./echo.error.js";
import {
  create_deferred_echo_document_authority_internal,
  register_echo_document_authority,
  unregister_echo_document_authority,
} from "./echo.document-authority-registry.js";
import {
  create_echo_endpoint_connection_internal,
  type EchoEndpointConnection,
} from "./echo.client.js";

type EchoMap = LiveMapAuthority | LiveMapLibraries;
type ReplicaOptions<TMap extends EchoMap> = Omit<EchoOptions<undefined>, "map" | "recovery"> & Readonly<{
  map: TMap;
  recovery: EchoRecoveryOptions;
}>;
type ReplicaStrategy<TMap extends EchoMap, TActions extends LocusActionPayloads> = Readonly<{
  recovery: EchoRecovery<TMap>;
  dispose: LocusDisposer;
}>;
type ReplicaComposition<TActions extends LocusActionPayloads> = Readonly<{
  connection: EchoEndpointConnection<TActions>;
  management: EchoMapManagementLease;
}>;
type ReplicaInitializer = <TMap extends EchoMap, TActions extends LocusActionPayloads>(
  options: ReplicaOptions<TMap>,
  composition: ReplicaComposition<TActions>,
) => ReplicaStrategy<TMap, TActions>;

/** @internal Injectable deferred boundary used by deterministic packaging/lifecycle proofs. */
export type EchoReplicaLoaders = Readonly<{
  solo: () => Promise<ReplicaInitializer>;
  aggregate: () => Promise<ReplicaInitializer>;
}>;

/** @internal Production dynamic imports; neither module belongs to the initial Echo graph. */
export const DEFAULT_ECHO_REPLICA_LOADERS: EchoReplicaLoaders = Object.freeze({
  async solo() {
    const loaded = await import("./echo.solo.js");
    return loaded.create_solo_echo_internal as ReplicaInitializer;
  },
  async aggregate() {
    const loaded = await import("./echo.multi-library.js");
    return loaded.create_multi_library_echo as ReplicaInitializer;
  },
});

function isJsonValue(value: unknown, seen: Set<object> = new Set()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => isJsonValue(item, seen))
    : Object.values(value).every((item) => isJsonValue(item, seen));
  seen.delete(value);
  return valid;
}

function initialDiagnostics(
  status: EchoRecoveryStatus,
  options: EchoRecoveryOptions,
  management: EchoMapManagementLease,
  failure: EchoRecoveryFailure | undefined,
): EchoRecoveryDiagnostics {
  return Object.freeze({
    status,
    logicalMapId: options.logicalMapId,
    ...(management.initialRecovery.incarnationId === undefined ? {} : {
      incarnationId: management.initialRecovery.incarnationId,
    }),
    ...(management.initialRecovery.lastAppliedRev === undefined ? {} : {
      lastAppliedRev: management.initialRecovery.lastAppliedRev,
    }),
    bodyCommitsApplied: 0,
    snapshotInstalls: 0,
    duplicateCommitsIgnored: 0,
    gapsDetected: 0,
    replayConflicts: 0,
    tailCommitsApplied: 0,
    liveCommitsApplied: 0,
    recoveryFailures: failure === undefined ? 0 : 1,
    consumerNotifications: 0,
    observerFailures: 0,
  });
}

/** @internal Synchronous public shell with a coalesced deferred strategy initializer. */
export function create_lazy_replica_echo_internal<
  TMap extends EchoMap,
  TActions extends LocusActionPayloads = LocusActionPayloads,
>(
  options: ReplicaOptions<TMap>,
  management: EchoMapManagementLease,
  loaders: EchoReplicaLoaders = DEFAULT_ECHO_REPLICA_LOADERS,
): Echo<TMap, TActions> {
  const initialCursor = options.recovery.cursor;
  if (management.topology === "solo"
    && initialCursor !== undefined
    && initialCursor.lastAppliedRev !== management.revision) {
    throw new EchoRecoveryError(
      "LOCUS_RECOVERY_CURSOR_MISMATCH",
      `Locus recovery cursor revision ${initialCursor.lastAppliedRev} does not match mirror revision ${management.revision}.`,
    );
  }
  const internalOptions = options as ReplicaOptions<TMap> & Readonly<{
    actionId?: () => string;
    actionAttemptId?: () => string;
    actionStatusId?: () => string;
    sessionRequestId?: (kind: "create" | "reattach" | "goodbye") => string;
  }>;
  const aggregate = management.topology === "aggregate";
  const connection = create_echo_endpoint_connection_internal<TActions>({
    socket: options.socket,
    ...(options.clientId === undefined ? {} : { clientId: options.clientId }),
    ...(options.session === undefined ? {} : { session: options.session }),
    ids: Object.freeze({
      ...(internalOptions.actionId === undefined ? {} : { actionId: internalOptions.actionId }),
      ...(internalOptions.actionAttemptId === undefined ? {} : { actionAttemptId: internalOptions.actionAttemptId }),
      ...(internalOptions.actionStatusId === undefined ? {} : { actionStatusId: internalOptions.actionStatusId }),
      ...(internalOptions.sessionRequestId === undefined ? {} : { sessionRequestId: internalOptions.sessionRequestId }),
    }),
    ...(aggregate ? {
      endpointMessageFormat: "hson-locus-hosted-aggregate-message",
      actionMessageId: "attempt" as const,
      validateActionPayload: isJsonValue,
      operationLossError: (reason: "disconnect" | "fenced" | "ended") => new Error(reason === "ended"
        ? "Hosted aggregate Echo session ended before the pending operation completed."
        : reason === "fenced"
          ? "Hosted aggregate session attachment was fenced."
          : "Hosted aggregate socket closed."),
    } : {}),
  });
  const deferredDocumentAuthorities = management.documentMaps.map((map) => {
    const deferred = create_deferred_echo_document_authority_internal();
    register_echo_document_authority(map, deferred.authority);
    return Object.freeze({ map, ...deferred });
  });
  const listeners = new Set<EchoRecoveryChangeListener<TMap>>();
  const listenerDisposers = new Map<EchoRecoveryChangeListener<TMap>, LocusDisposer>();
  let strategy: ReplicaStrategy<TMap, TActions> | undefined;
  let initialization: Promise<ReplicaStrategy<TMap, TActions>> | undefined;
  let pendingRecovery = false;
  let disposed = false;
  let recoveryDisposed = false;
  let shellStatus: EchoRecoveryStatus = "idle";
  let shellFailure: EchoRecoveryFailure | undefined;
  let previouslyConnected = false;
  const stopShellConnection = connection.onConnectionChange((connected) => {
    if (connected && !previouslyConnected && shellStatus === "failed" && strategy === undefined) {
      shellStatus = "idle";
      shellFailure = undefined;
      initialization = undefined;
    }
    previouslyConnected = connected;
  });

  const initialize = (): Promise<ReplicaStrategy<TMap, TActions>> => {
    if (strategy !== undefined) return Promise.resolve(strategy);
    if (initialization !== undefined) return initialization;
    const load = aggregate ? loaders.aggregate : loaders.solo;
    initialization = load()
      .then((createReplica) => {
        if (disposed || recoveryDisposed) {
          throw new EchoRecoveryError("LOCUS_RECOVERY_DISPOSED", "Echo recovery is disposed.");
        }
        const created = createReplica<TMap, TActions>(options, Object.freeze({ connection, management }));
        strategy = created;
        for (const listener of listeners) {
          listenerDisposers.set(listener, created.recovery.onChange(listener));
        }
        return created;
      })
      .catch((cause: unknown) => {
        if (cause instanceof EchoRecoveryError && cause.code === "LOCUS_RECOVERY_DISPOSED") throw cause;
        const error = new EchoRecoveryError(
          "LOCUS_RECOVERY_FAILED",
          cause instanceof Error ? cause.message : "Echo replica implementation could not be loaded.",
          cause,
        );
        shellStatus = "failed";
        shellFailure ??= Object.freeze({ code: error.code, message: error.message, cause });
        throw error;
      });
    return initialization;
  };

  const recover = (): Promise<EchoRecoveryResult> => {
    if (disposed || recoveryDisposed) {
      return Promise.reject(new EchoRecoveryError("LOCUS_RECOVERY_DISPOSED", "Echo recovery is disposed."));
    }
    if (!connection.connected) {
      return Promise.reject(new EchoRecoveryError("LOCUS_RECOVERY_DISCONNECTED", "Locus recovery requires a connected transport."));
    }
    if (connection.endpoint.session.status !== "attached") {
      return Promise.reject(new EchoRecoveryError("LOCUS_SESSION_NOT_ATTACHED", "Locus recovery requires an attached session."));
    }
    if (connection.endpoint.session.logicalMapId !== options.recovery.logicalMapId) {
      const error = new EchoRecoveryError(
        "LOCUS_SESSION_AUTHORITY_MISMATCH",
        "Locus session authority does not match the configured recovery target.",
      );
      shellStatus = "failed";
      shellFailure ??= Object.freeze({ code: error.code, message: error.message, cause: error });
      return Promise.reject(error);
    }
    if (pendingRecovery) {
      return Promise.reject(new EchoRecoveryError("LOCUS_RECOVERY_IN_PROGRESS", "Locus recovery is already in progress."));
    }
    if (shellStatus === "failed" && strategy === undefined) {
      return Promise.reject(new EchoRecoveryError(
        "LOCUS_RECOVERY_LIFECYCLE_INVALID",
        "Locus recovery requires a reconnect after failure.",
      ));
    }
    pendingRecovery = true;
    shellStatus = "recovering";
    return initialize()
      .then((created) => created.recovery.recover())
      .then((result) => {
        shellStatus = "caught_up";
        shellFailure = undefined;
        return result;
      })
      .catch((cause: unknown) => {
        if (strategy === undefined && shellStatus !== "failed") {
          shellStatus = "failed";
          shellFailure ??= Object.freeze({
            code: "LOCUS_RECOVERY_FAILED",
            message: cause instanceof Error ? cause.message : "Echo recovery failed.",
            cause,
          });
        }
        throw cause;
      })
      .finally(() => { pendingRecovery = false; });
  };

  const recovery = Object.freeze({
    get status(): EchoRecoveryStatus {
      if (recoveryDisposed) return "disposed";
      if (pendingRecovery && strategy === undefined) return "recovering";
      return strategy?.recovery.status ?? shellStatus;
    },
    get logicalMapId() { return options.recovery.logicalMapId; },
    get incarnationId() {
      return strategy?.recovery.incarnationId
        ?? options.recovery.cursor?.incarnationId
        ?? management.initialRecovery.incarnationId;
    },
    get lastAppliedRev() {
      return strategy?.recovery.lastAppliedRev
        ?? options.recovery.cursor?.lastAppliedRev
        ?? management.initialRecovery.lastAppliedRev;
    },
    map: options.map,
    get failure(): EchoRecoveryFailure | undefined { return strategy?.recovery.failure ?? shellFailure; },
    get strategy(): EchoRecoveryStrategy | undefined { return strategy?.recovery.strategy; },
    recover,
    onChange(listener: EchoRecoveryChangeListener<TMap>): LocusDisposer {
      if (recoveryDisposed) return () => {};
      listeners.add(listener);
      if (strategy !== undefined) listenerDisposers.set(listener, strategy.recovery.onChange(listener));
      return () => {
        listeners.delete(listener);
        listenerDisposers.get(listener)?.();
        listenerDisposers.delete(listener);
      };
    },
    dispose(): void {
      if (recoveryDisposed) return;
      recoveryDisposed = true;
      shellStatus = "disposed";
      for (const disposeListener of listenerDisposers.values()) disposeListener();
      listenerDisposers.clear();
      listeners.clear();
      strategy?.recovery.dispose();
    },
    debug(): EchoRecoveryDiagnostics {
      return strategy?.recovery.debug() ?? initialDiagnostics(shellStatus, options.recovery, management, shellFailure);
    },
  });

  const echo = connection.echo;
  const publicEcho = {
    map: options.map,
    recovery,
    clientId: echo.clientId,
    session: echo.session,
    connect: echo.connect,
    disconnect: echo.disconnect,
    action: echo.action,
    retryAction: echo.retryAction,
    actionStatus: echo.actionStatus,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      recoveryDisposed = true;
      shellStatus = "disposed";
      for (const disposeListener of listenerDisposers.values()) disposeListener();
      listenerDisposers.clear();
      listeners.clear();
      if (strategy === undefined) management.release();
      else strategy.dispose();
      for (const deferred of deferredDocumentAuthorities) {
        unregister_echo_document_authority(deferred.map, deferred.authority);
        deferred.dispose();
      }
      stopShellConnection();
      echo.dispose();
    },
  };
  return Object.freeze(publicEcho) as unknown as Echo<TMap, TActions>;
}
