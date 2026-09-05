import type { ClassifiedLiveMap } from "../../types/livemap.types.js";
import type { LocusDisposer } from "../../types/locus.types.js";
import type { EchoMapManagementLease } from "../../internal/echo-map-capability.js";
import { get_livemap_staged_authority, LiveMapTransitionError } from "../livemap/livemap.authority.js";
import type { EchoReplicaCapability } from "./echo.replica.js";

/** @internal Solo exact-replica ownership and terminal lifetime. */
export type EchoSoloReplicaCapability = EchoReplicaCapability<ClassifiedLiveMap> & Readonly<{
  runManaged: <T>(operation: () => T) => T;
}>;

/** @internal Construct a solo replica independently of endpoint/session mechanics. */
export function create_echo_solo_replica_capability_internal(
  map: ClassifiedLiveMap,
  initiallyReady: boolean,
  management?: EchoMapManagementLease,
): EchoSoloReplicaCapability {
  const authority = management === undefined ? get_livemap_staged_authority(map) : undefined;
  const owner = management?.owner ?? Object.freeze({});
  const readyWaiters = new Set<Readonly<{ resolve: () => void; reject: (reason: Error) => void }>>();
  const disposeListeners = new Set<(reason: Error) => void>();
  let ready = initiallyReady;
  let disposed = false;
  let failure: unknown;

  if (management === undefined) {
    authority?.claimManagement(owner, () => Promise.reject(new LiveMapTransitionError(
      "LIVEMAP_MANAGED_MUTATION_REJECTED",
      "Echo LiveMap mutation is reserved for accepted canonical replay.",
    )));
  } else if (management.topology !== "solo") {
    throw new Error("Echo solo replica received incompatible map management.");
  }

  const terminalError = (): Error => new Error("Echo replica capability is disposed.");

  return Object.freeze({
    map,
    get ready() { return ready; },
    get disposed() { return disposed; },
    get failure() { return failure; },
    runManaged: <T>(operation: () => T): T => management === undefined
      ? authority!.runManaged(owner, operation)
      : management.runManaged(operation),
    markRecovering(): void {
      if (disposed) return;
      ready = false;
    },
    markReady(): void {
      if (disposed) return;
      ready = true;
      failure = undefined;
      const waiters = [...readyWaiters];
      readyWaiters.clear();
      for (const waiter of waiters) waiter.resolve();
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
      if (management === undefined) authority?.releaseManagement(owner);
      else management.release();
    },
  });
}
