/** Public Echo endpoint type boundary. */
import type { LiveMap } from "./livemap.types.js";
import type {
  Echo as CoreEcho,
  EchoOptions as CoreEchoOptions,
} from "./locus.core.types.js";
import type { LocusActionPayloads } from "./locus.protocol.types.js";

export type EchoOptions<TMap extends LiveMap | undefined = undefined> = CoreEchoOptions<TMap>;
export type Echo<
  TMap extends LiveMap | undefined = undefined,
  TActions extends LocusActionPayloads = LocusActionPayloads,
> = CoreEcho<TMap, TActions>;

export type {
  EchoActionFn,
  EchoActionPromise,
  EchoActionRequest,
  EchoActionStatusResult,
  EchoRecovery,
  EchoRecoveryCursor,
  EchoRecoveryDiagnostics,
  EchoRecoveryFailure,
  EchoRecoveryOptions,
  EchoRecoveryResult,
  EchoRecoveryStatus,
  EchoRecoveryStrategy,
  EchoRetryActionFn,
  EchoSession,
  EchoSessionDiagnostics,
  EchoSessionFailure,
  EchoSessionOptions,
  EchoSessionResult,
  EchoSessionStatus,
} from "./locus.core.types.js";
