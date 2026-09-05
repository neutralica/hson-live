import type { LiveMapLibraries } from "../../types/livemap.types.js";
import type { LocusDisposer } from "../../types/locus.types.js";
import { internal_livemap_aggregate_authority } from "../livemap/livemap.internal.js";
import type { HostedAggregateCommit, HostedAggregateSnapshot } from "../livemap/livemap.hosted.js";
import type { EchoReplicaCapability } from "./echo.replica.js";

/** @internal Aggregate exact-replica management and terminal lifetime. */
export type EchoAggregateReplicaCapability = EchoReplicaCapability<LiveMapLibraries | undefined> & Readonly<{
  attachMap: (map: LiveMapLibraries) => void;
  captureHosted: () => HostedAggregateSnapshot;
  restoreHosted: (snapshot: HostedAggregateSnapshot) => void;
  replayHosted: (commit: HostedAggregateCommit) => number;
}>;

/** @internal Construct an aggregate replica independently of endpoint/session mechanics. */
export function create_echo_aggregate_replica_capability_internal(
  initialMap?: LiveMapLibraries,
): EchoAggregateReplicaCapability {
  const owner = Object.freeze({});
  const readyWaiters = new Set<Readonly<{ resolve: () => void; reject: (reason: Error) => void }>>();
  const disposeListeners = new Set<(reason: Error) => void>();
  let map = initialMap;
  let ready = false;
  let disposed = false;
  let failure: unknown;
  if (map !== undefined) internal_livemap_aggregate_authority(map).claimManagement(owner);

  const terminalError = (): Error => new Error("Hosted aggregate replica capability is disposed.");

  return Object.freeze({
    get map() { return map; },
    get ready() { return ready; },
    get disposed() { return disposed; },
    get failure() { return failure; },
    attachMap(next): void {
      if (disposed) throw terminalError();
      if (map === next) return;
      if (map !== undefined) throw new Error("Hosted aggregate replica already owns a mirror.");
      internal_livemap_aggregate_authority(next).claimManagement(owner);
      map = next;
    },
    captureHosted(): HostedAggregateSnapshot {
      if (map === undefined) throw new Error("Hosted aggregate replica has no mirror.");
      return internal_livemap_aggregate_authority(map).captureHosted();
    },
    restoreHosted(snapshot): void {
      if (map === undefined) throw new Error("Hosted aggregate replica has no mirror.");
      internal_livemap_aggregate_authority(map).restoreHostedManaged(owner, snapshot);
    },
    replayHosted(commit): number {
      if (map === undefined) throw new Error("Hosted aggregate replica has no mirror.");
      return internal_livemap_aggregate_authority(map).replayHostedManaged(owner, commit).rev;
    },
    markRecovering(): void {
      if (disposed) return;
      ready = false;
    },
    markReady(): void {
      if (disposed) return;
      ready = true;
      failure = undefined;
      for (const waiter of [...readyWaiters]) waiter.resolve();
      readyWaiters.clear();
    },
    markFailed(reason): void {
      if (disposed) return;
      ready = false;
      failure ??= reason;
    },
    waitUntilReady(): Promise<void> {
      if (ready) return Promise.resolve();
      if (disposed) return Promise.reject(terminalError());
      return new Promise((resolve, reject) => readyWaiters.add(Object.freeze({ resolve, reject })));
    },
    onDispose(listener): LocusDisposer {
      if (disposed) {
        listener(terminalError());
        return () => {};
      }
      disposeListeners.add(listener);
      return () => disposeListeners.delete(listener);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      ready = false;
      const reason = terminalError();
      for (const listener of [...disposeListeners]) listener(reason);
      disposeListeners.clear();
      for (const waiter of [...readyWaiters]) waiter.reject(reason);
      readyWaiters.clear();
      if (map !== undefined) internal_livemap_aggregate_authority(map).releaseManagement(owner);
    },
  });
}
