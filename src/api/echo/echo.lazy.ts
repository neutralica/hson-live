import type { LiveMap } from "../../types/livemap.types.js";
import type {
  Echo,
  EchoRecovery,
  EchoRecoveryDiagnostics,
  EchoRecoveryFailure,
  EchoRecoveryStatus,
  EchoRecoveryStrategy,
  EchoSessionResult,
  EchoSession,
  EchoSessionOptions,
  LocusActionPayloads,
  LocusClientId,
  LocusDisposer,
  LocusSocketLike,
} from "../../types/locus.types.js";
import type { EchoMapManagementLease } from "../../internal/echo-map-capability.js";
import { LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT } from "../locus/locus.aggregate.protocol.js";
import { internal_livemap_aggregate_authority } from "../livemap/livemap.internal.js";
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

type EchoMap = LiveMap;
type EchoRecoveryResult = Readonly<{
  strategy: Exclude<EchoRecoveryStrategy, "reject">;
  sessionId: string;
  logicalMapId: string;
  incarnationId: string;
  headRev: number;
  incarnationChanged: boolean;
}>;
export type ReplicaOptions<TMap extends EchoMap> = Readonly<{
  socket: LocusSocketLike;
  map: TMap;
  clientId?: LocusClientId;
  session?: EchoSessionOptions;
}>;
export type ReplicaStrategy = Readonly<{
  recovery: EchoRecovery & Readonly<{
    recover: () => Promise<EchoRecoveryResult>;
  }>;
  dispose: LocusDisposer;
}>;
type ReplicaComposition<TActions extends LocusActionPayloads> = Readonly<{
  connection: EchoEndpointConnection<TActions, any, any>;
  management: EchoMapManagementLease;
}>;
type ReplicaInitializer = <TMap extends EchoMap, TActions extends LocusActionPayloads>(
  options: ReplicaOptions<TMap>,
  composition: ReplicaComposition<TActions>,
) => ReplicaStrategy;

function initialDiagnostics(
  status: EchoRecoveryStatus,
  logicalMapId: string,
  management: EchoMapManagementLease,
  failure: EchoRecoveryFailure | undefined,
): EchoRecoveryDiagnostics {
  return Object.freeze({
    status,
    logicalMapId,
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
    observerFailures: 0,
  });
}

/** @internal Managed shell with a coalesced deferred strategy initializer. */
export function create_lazy_replica_echo_internal<
  TMap extends EchoMap,
  TActions extends LocusActionPayloads = LocusActionPayloads,
>(
  options: ReplicaOptions<TMap>,
  management: EchoMapManagementLease,
): Readonly<{
  echo: Echo<TMap, TActions>;
  rawSession: EchoSession;
  attach: () => Promise<EchoSessionResult>;
  complete: () => Promise<EchoRecoveryResult>;
}> {
  const logicalMapId = internal_livemap_aggregate_authority(options.map).clientProjection()?.authority.logicalMapId;
  if (logicalMapId === undefined) throw new Error("Echo replica requires an admitted authority projection.");
  const connection = create_echo_endpoint_connection_internal<TActions>({
    socket: options.socket,
    ...(options.clientId === undefined ? {} : { clientId: options.clientId }),
    ...(options.session === undefined ? {} : { session: options.session }),
    ...({
      endpointMessageFormat: LOCUS_HOSTED_AGGREGATE_SOCKET_FORMAT,
      actionMessageId: "attempt" as const,
      operationLossError: (reason: "disconnect" | "fenced" | "ended") => new Error(reason === "ended"
        ? "Hosted aggregate Echo session ended before the pending operation completed."
        : reason === "fenced"
          ? "Hosted aggregate session attachment was fenced."
          : "Hosted aggregate socket closed."),
    }),
  });
  const deferredDocumentAuthorities = management.documentMaps.map((map) => {
    const deferred = create_deferred_echo_document_authority_internal();
    register_echo_document_authority(map, deferred.authority);
    return Object.freeze({ map, ...deferred });
  });
  let strategy: ReplicaStrategy | undefined;
  let initialization: Promise<ReplicaStrategy> | undefined;
  let pendingRecovery = false;
  let disposed = false;
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

  const initialize = (): Promise<ReplicaStrategy> => {
    if (strategy !== undefined) return Promise.resolve(strategy);
    if (initialization !== undefined) return initialization;
    initialization = import("./echo.registry.js")
      .then((loaded) => {
        if (disposed) {
          throw new EchoRecoveryError("LOCUS_RECOVERY_DISPOSED", "Echo recovery is disposed.");
        }
        const createReplica = loaded.create_registry_echo as ReplicaInitializer;
        const created = createReplica<TMap, TActions>(options, Object.freeze({ connection, management }));
        strategy = created;
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
    if (disposed) {
      return Promise.reject(new EchoRecoveryError("LOCUS_RECOVERY_DISPOSED", "Echo recovery is disposed."));
    }
    if (!connection.connected) {
      return Promise.reject(new EchoRecoveryError("LOCUS_RECOVERY_DISCONNECTED", "Locus recovery requires a connected transport."));
    }
    if (connection.endpoint.session.status !== "attached") {
      return Promise.reject(new EchoRecoveryError("LOCUS_SESSION_NOT_ATTACHED", "Locus recovery requires an attached session."));
    }
    if (connection.endpoint.session.logicalMapId !== logicalMapId) {
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
      if (disposed) return "disposed";
      if (pendingRecovery && strategy === undefined) return "recovering";
      return strategy?.recovery.status ?? shellStatus;
    },
    get failure(): EchoRecoveryFailure | undefined { return strategy?.recovery.failure ?? shellFailure; },
    get strategy(): EchoRecoveryStrategy | undefined { return strategy?.recovery.strategy; },
    debug(): EchoRecoveryDiagnostics {
      return strategy?.recovery.debug() ?? initialDiagnostics(shellStatus, logicalMapId, management, shellFailure);
    },
  });

  const echo = connection.echo;
  const publicEcho = {
    map: options.map,
    recovery,
    clientId: echo.clientId,
    session: Object.freeze({
      get status() { return echo.session.status; },
      get sessionId() { return echo.session.sessionId; },
      get credential() { return echo.session.credential; },
      get epoch() { return echo.session.epoch; },
      get logicalMapId() { return echo.session.logicalMapId; },
      get incarnationId() { return echo.session.incarnationId; },
      get failure() { return echo.session.failure; },
      async create() {
        const result = await echo.session.create();
        await recover();
        return result;
      },
      async reattach(credential?: string) {
        const result = await echo.session.reattach(credential);
        await recover();
        return result;
      },
      goodbye: echo.session.goodbye,
      dispose: echo.session.dispose,
      debug: echo.session.debug,
    }),
    connect: echo.connect,
    disconnect: echo.disconnect,
    action: echo.action,
    retryAction: echo.retryAction,
    actionStatus: echo.actionStatus,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      shellStatus = "disposed";
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
  return Object.freeze({
    echo: Object.freeze(publicEcho) as unknown as Echo<TMap, TActions>,
    rawSession: echo.session,
    attach: () => echo.session.reattach(),
    complete: recover,
  });
}
