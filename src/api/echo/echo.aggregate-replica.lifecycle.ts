import type { PortableAggregateSnapshot } from "../livemap/livemap.hosted.internal.types.js";
import type { LiveMap } from "../../types/livemap.types.js";
import type { LocusDisposer } from "../../types/locus.types.js";
import type { EchoMapManagementLease } from "../../internal/echo-map-capability.js";
import { internal_livemap_aggregate_authority } from "../livemap/livemap.internal.js";
import type { HostedLiveMapSnapshot } from "../../types/livemap.types.js";
import type { PortableAggregateCommit } from "../livemap/livemap.hosted.js";
import type { LiveMapLibraryAddOperation } from "../../types/livemap.types.js";
import { install_client_projected_topology_internal, reconcile_client_projection_snapshot_internal } from "../livemap/livemap.libraries.js";
import type { HostedAuthorityFence, HostedRegistry } from "../livemap/livemap.hosted.js";
import type { EchoReplicaCapability } from "./echo.replica.js";

/** @internal Aggregate exact-replica management and terminal lifetime. */
export type EchoAggregateReplicaCapability = EchoReplicaCapability<LiveMap | undefined> & Readonly<{
  attachMap: (map: LiveMap) => void;
  captureHosted: () => HostedLiveMapSnapshot;
  hostedPosition: () => Readonly<{ authority: HostedAuthorityFence; revision: number; registryDigest: string }>;
  clientProjection: () => Readonly<{ authority: HostedAuthorityFence; registry: HostedRegistry; revision: number; libraries: readonly string[] }> | undefined;
  restoreHosted: (snapshot: PortableAggregateSnapshot) => void;
  replayHosted: (commit: PortableAggregateCommit, authorityRev?: number) => number;
  installProjectedTopology: (operation: LiveMapLibraryAddOperation, expectedRegistryDigest: string,
    system?: Readonly<{ format: "hson-exact-value"; payload: string }>) => void;
  advanceHostedProgress: (progress: Readonly<{
    logicalMapId: string;
    incarnationId: string;
    registryDigest: string;
    prevRev: number;
    rev: number;
  }>) => number;
}>;

/** @internal Construct an aggregate replica independently of endpoint/session mechanics. */
export function create_echo_aggregate_replica_capability_internal(
  initialMap?: LiveMap,
  management?: EchoMapManagementLease,
): EchoAggregateReplicaCapability {
  const owner = management?.owner ?? Object.freeze({});
  const readyWaiters = new Set<Readonly<{ resolve: () => void; reject: (reason: Error) => void }>>();
  const disposeListeners = new Set<(reason: Error) => void>();
  const stateListeners = new Set<() => void>();
  let map = initialMap;
  let ready = false;
  let disposed = false;
  let failure: unknown;
  if (map !== undefined && management === undefined) internal_livemap_aggregate_authority(map).claimManagement(owner);

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
    captureHosted(): HostedLiveMapSnapshot {
      if (map === undefined) throw new Error("Hosted aggregate replica has no mirror.");
      return internal_livemap_aggregate_authority(map).captureHosted();
    },
    hostedPosition() {
      if (map === undefined) throw new Error("Hosted aggregate replica has no mirror.");
      return internal_livemap_aggregate_authority(map).hostedPosition();
    },
    clientProjection() {
      return map === undefined ? undefined : internal_livemap_aggregate_authority(map).clientProjection();
    },
    restoreHosted(snapshot): void {
      if (map === undefined) throw new Error("Hosted aggregate replica has no mirror.");
      if (internal_livemap_aggregate_authority(map).clientProjection() === undefined) {
        internal_livemap_aggregate_authority(map).restoreClientHostedManaged(owner, snapshot);
      } else reconcile_client_projection_snapshot_internal(map, owner, snapshot);
    },
    replayHosted(commit, authorityRev): number {
      if (map === undefined) throw new Error("Hosted aggregate replica has no mirror.");
      return internal_livemap_aggregate_authority(map).replayClientHostedManaged(owner, commit, authorityRev).rev;
    },
    installProjectedTopology(operation, expectedRegistryDigest, system): void {
      if (map === undefined) throw new Error("Hosted aggregate replica has no mirror.");
      install_client_projected_topology_internal(map, owner, operation, expectedRegistryDigest, system);
    },
    advanceHostedProgress(progress): number {
      if (map === undefined) throw new Error("Hosted aggregate replica has no mirror.");
      return internal_livemap_aggregate_authority(map).advanceHostedProgressManaged(owner, progress);
    },
    markRecovering(): void {
      if (disposed) return;
      ready = false;
      for (const listener of [...stateListeners]) listener();
    },
    markReady(): void {
      if (disposed) return;
      ready = true;
      failure = undefined;
      for (const waiter of [...readyWaiters]) waiter.resolve();
      readyWaiters.clear();
      for (const listener of [...stateListeners]) listener();
    },
    markFailed(reason): void {
      if (disposed) return;
      ready = false;
      failure ??= reason;
      for (const listener of [...stateListeners]) listener();
    },
    waitUntilReady(): Promise<void> {
      if (ready) return Promise.resolve();
      if (disposed) return Promise.reject(terminalError());
      return new Promise((resolve, reject) => readyWaiters.add(Object.freeze({ resolve, reject })));
    },
    onStateChange(listener): LocusDisposer {
      if (disposed) return () => {};
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
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
      for (const listener of [...stateListeners]) listener();
      stateListeners.clear();
      for (const waiter of [...readyWaiters]) waiter.reject(reason);
      readyWaiters.clear();
      if (management !== undefined) management.release();
      else if (map !== undefined) internal_livemap_aggregate_authority(map).releaseManagement(owner);
    },
  });
}
