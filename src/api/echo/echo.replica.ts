import type { LocusDisposer } from "../../types/locus.types.js";

/** @internal Minimal lifecycle shared by exact Echo replica implementations. */
export type EchoReplicaCapability<TMap> = Readonly<{
  readonly map: TMap;
  readonly ready: boolean;
  readonly disposed: boolean;
  readonly failure: unknown;
  markRecovering: () => void;
  markReady: () => void;
  markFailed: (failure: unknown) => void;
  waitUntilReady: () => Promise<void>;
  onDispose: (listener: (reason: Error) => void) => LocusDisposer;
  dispose: () => void;
}>;
