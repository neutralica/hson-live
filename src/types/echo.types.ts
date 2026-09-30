/** Public Echo endpoint type boundary. */
import type { LiveMap } from "./livemap.types.js";
import type {
  Echo as CoreEcho,
  EchoOptions as CoreEchoOptions,
} from "./locus.core.types.js";
import type { LocusActionPayloads } from "./locus.protocol.types.js";

export type EchoOptions = CoreEchoOptions;
export type Echo<
  TMap extends LiveMap | undefined = undefined,
  TActions extends LocusActionPayloads = LocusActionPayloads,
> = CoreEcho<TMap, TActions>;

export type {
  EchoActionFn,
  EchoActionPromise,
  EchoActionRequest,
  EchoActionStatusResult,
  EchoSync,
  EchoSyncDiagnostics,
  EchoSyncFailure,
  EchoSyncStatus,
  EchoSyncStrategy,
  EchoRetryActionFn,
  EchoSession,
  EchoSessionDiagnostics,
  EchoSessionFailure,
  EchoSessionOptions,
  EchoSessionResult,
  EchoSessionStatus,
  EchoReplicaOptions,
} from "./locus.core.types.js";
export type {
  EchoEndpointTransport,
  EchoReplicaTransport,
  EchoSubmission,
  EchoAttachmentEvent,
  EchoFiniteOperationRequest,
  EchoFiniteOperationOutcome,
  EchoSynchronizationRequest,
  EchoSynchronizationOutput,
  EchoSynchronizationObserver,
  EchoSynchronizationSubscription,
  EchoSynchronizationEnd,
} from "./echo.transport.types.js";
