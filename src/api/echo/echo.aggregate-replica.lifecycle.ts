import { compose_client_projection_internal } from "./echo.projection.js";
import { admit_authority_projection_snapshot, authority_projection_as_client_composition_internal, client_projection_identity_internal } from "../locus/locus.authority-projection-snapshot.js";
import type { AuthorityProjectionSnapshot, LocusLocalInitializer } from "../../types/locus.projection.types.js";
import type { PortableAggregateSnapshot } from "../livemap/livemap.hosted.internal.types.js";
import type { LiveMap } from "../../types/livemap.types.js";
import type { LocusDisposer } from "../../types/locus.types.js";
import type { EchoMapManagementLease } from "../../internal/echo-map-capability.js";
import { internal_livemap_aggregate_authority } from "../livemap/livemap.internal.js";
import type { HostedLiveMapSnapshot } from "../../types/livemap.types.js";
import type { PortableAggregateCommit, PrivateScopedAggregateCommit } from "../livemap/livemap.hosted.js";
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
  restoreHosted: (snapshot: PortableAggregateSnapshot, assertAcceptance?: () => void) => void;
  captureRestorationFence: () => () => void;
  captureManagementFence: () => () => void;
  replayHosted: (commit: Omit<PortableAggregateCommit, "operations"> & Pick<PrivateScopedAggregateCommit, "operations">, authorityRev?: number, assertAcceptance?: () => void) => number;
  /** Replay complete scoped evidence under the containing hosted position. */
  replayScopedHosted: (commit: PrivateScopedAggregateCommit) => number;
  /** Complete private restoration under the existing projected contract. */
  restoreScopedProjection: (snapshot: AuthorityProjectionSnapshot, assertAcceptance?: () => void) => void;
  initializeScopedDocuments: (documents: readonly Readonly<{
    library: string; state: import("../livemap/livemap.document.scoped-portable.js").PortableDocumentScopedLibrary;
  }>[]) => void;
  installProjectedTopology: (operation: LiveMapLibraryAddOperation, expectedRegistryDigest: string,
    system?: Readonly<{ format: "hson-exact-value"; payload: string }>, assertAcceptance?: () => void) => void;
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
  // A bootstrap invocation predates its map; retain the grant established at
  // attachment so that its earlier management checks cannot adopt a renewal.
  let attachedManagementFence: (() => void) | undefined;
  let ready = false;
  let readinessPublication: (() => void) | undefined;
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
      const aggregate = internal_livemap_aggregate_authority(next);
      aggregate.claimManagement(owner);
      attachedManagementFence = aggregate.captureManagementFence(owner);
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
    captureManagementFence() {
      if (disposed) throw terminalError();
      const check = map === undefined ? () => attachedManagementFence?.() : internal_livemap_aggregate_authority(map).captureManagementFence(owner);
      return () => { if (disposed) throw terminalError(); check(); };
    },
    captureRestorationFence() {
      if (disposed) throw terminalError();
      const check = map === undefined ? () => {} : internal_livemap_aggregate_authority(map).captureManagedRestorationFence(owner);
      return () => { if (disposed) throw terminalError(); check(); };
    },
    restoreHosted(snapshot, assertAcceptance): void {
      if (map === undefined) throw new Error("Hosted aggregate replica has no mirror.");
      if (internal_livemap_aggregate_authority(map).clientProjection() === undefined) {
        internal_livemap_aggregate_authority(map).restoreClientHostedManaged(owner, snapshot);
      } else reconcile_client_projection_snapshot_internal(map, owner, snapshot, true, assertAcceptance);
    },
    replayHosted(commit, authorityRev, assertAcceptance): number {
      if (map === undefined) throw new Error("Hosted aggregate replica has no mirror.");
      const aggregate = internal_livemap_aggregate_authority(map);
      const assertCurrent = aggregate.captureManagedRestorationFence(owner);
      const check = () => { assertCurrent(); assertAcceptance?.(); };
      if (commit.format !== "hson-portable-aggregate-commit") throw new Error("Hosted receiving envelope is malformed.");
      const ordinary = commit.operations.filter(entry => entry.domain !== "document");
      check();
      if (ordinary.length === commit.operations.length) {
        return aggregate.replayClientHostedManaged(owner, { ...commit, operations: ordinary }, authorityRev, false, check).rev;
      }
      return aggregate.replayClientHostedManaged(owner, {
        authority: commit.authority, registryDigest: commit.registryDigest,
        prevRev: commit.prevRev, rev: commit.rev, operationCount: commit.operations.length, operations: commit.operations,
      }, authorityRev, true, check).rev;
    },
    replayScopedHosted(commit): number {
      if (disposed) throw terminalError();
      if (map === undefined) throw new Error("Hosted aggregate replica has no mirror.");
      const aggregate = internal_livemap_aggregate_authority(map);
      return aggregate.replayClientHostedManaged(owner, commit, aggregate.clientProjection()?.revision, true).rev;
    },
    restoreScopedProjection(snapshot, assertAcceptance): void {
      if (disposed || map === undefined) throw terminalError();
      const aggregate = internal_livemap_aggregate_authority(map);
      const assertCurrent = aggregate.captureManagedRestorationFence(owner);
      const expectedDigest = client_projection_identity_internal(map);
      const admitted = admit_authority_projection_snapshot(snapshot, true);
      const composition = authority_projection_as_client_composition_internal(admitted, true);
      if (admitted.projectionDigest !== expectedDigest) throw new Error("Scoped restoration projection is unauthorized.");
      assertCurrent();
      reconcile_client_projection_snapshot_internal(map, owner, composition, true, () => { assertCurrent(); assertAcceptance?.(); });
    },
    initializeScopedDocuments(documents): void {
      if (disposed) throw terminalError();
      if (map === undefined) throw new Error("Hosted aggregate replica has no mirror.");
      internal_livemap_aggregate_authority(map).initializeClientScopedDocumentsManaged(owner, documents);
    },
    installProjectedTopology(operation, expectedRegistryDigest, system, assertAcceptance): void {
      if (map === undefined) throw new Error("Hosted aggregate replica has no mirror.");
      install_client_projected_topology_internal(map, owner, operation, expectedRegistryDigest, system, assertAcceptance);
    },
    advanceHostedProgress(progress): number {
      if (disposed) throw terminalError();
      if (map === undefined) throw new Error("Hosted aggregate replica has no mirror.");
      return internal_livemap_aggregate_authority(map).advanceHostedProgressManaged(owner, progress);
    },
    markRecovering(): void {
      if (disposed) return;
      ready = false;
      readinessPublication = undefined;
      failure = undefined;
      for (const listener of [...stateListeners]) listener();
    },
    markReady(assertAcceptance): void {
      if (disposed) throw terminalError();
      const check = assertAcceptance ?? (() => {
        if (disposed || !ready) throw new Error("Replica readiness was interrupted.");
      });
      readinessPublication = check;
      ready = true;
      failure = undefined;
      try {
        for (const listener of [...stateListeners]) {
          listener();
          check();
          if (readinessPublication !== check) throw new Error("Replica readiness publication was replaced.");
        }
        check();
        if (readinessPublication !== check) throw new Error("Replica readiness publication was replaced.");
        readinessPublication = undefined;
        const waiters = [...readyWaiters];
        readyWaiters.clear();
        for (const waiter of waiters) waiter.resolve();
      } catch (error) {
        // A replacement publication owns its own readiness and waiter settlement.
        if (readinessPublication === check) { readinessPublication = undefined; ready = false; }
        throw error;
      }
    },
    markFailed(reason): void {
      if (disposed) return;
      ready = false;
      readinessPublication = undefined;
      failure ??= reason;
      const waiters = [...readyWaiters];
      readyWaiters.clear();
      const error = reason instanceof Error ? reason : new Error("Hosted aggregate replica failed.");
      for (const waiter of waiters) waiter.reject(error);
      for (const listener of [...stateListeners]) {
        listener();
        if (failure === undefined || ready || disposed) break;
      }
    },
    waitUntilReady(): Promise<void> {
      if (ready && readinessPublication === undefined) return Promise.resolve();
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
      readinessPublication = undefined;
      const reason = terminalError();
      const disposing = [...disposeListeners], changing = [...stateListeners], waiters = [...readyWaiters];
      disposeListeners.clear();
      stateListeners.clear();
      readyWaiters.clear();
      // Relinquish this lifetime and settle its promises before callbacks can
      // throw or establish a replacement manager on the same map.
      if (management !== undefined) management.release();
      else if (map !== undefined) internal_livemap_aggregate_authority(map).releaseManagement(owner);
      for (const waiter of waiters) waiter.reject(reason);
      for (const listener of disposing) listener(reason);
      for (const listener of changing) listener();
    },
  });
}

/** Complete private Locus state -> fresh Echo composition. No endpoint, public
 * constructor, recovery orchestration, or flat-then-scoped enrichment. @internal */
export function create_echo_scoped_replica_internal(snapshot: AuthorityProjectionSnapshot,
  local: readonly LocusLocalInitializer[] = []): EchoAggregateReplicaCapability {
  const map = compose_client_projection_internal(snapshot, local, true);
  return create_echo_aggregate_replica_capability_internal(map);
}
