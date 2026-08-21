// Multi-authority store, persistence residency, and lifecycle registry contracts.

import type { DocumentLiveMap, LiveMap } from "./livemap.types.js";
import type { Locus, LocusActivity, LocusActivityKind, ProjectedLocusOptions } from "./locus.core.types.js";
import type { LocusActionPayloads, LocusConnectionContext, LocusSocketLike } from "./locus.protocol.types.js";
import type {
  LocusDisposer,
  LocusResult,
} from "./locus.shared.types.js";
import type {
  PersistentDocumentLocusOptions,
  PersistentLocus,
} from "./locus.persistence.types.js";

export type LiveHostStoreId = string;

export type LiveHostPersistentStoreEntry = Readonly<{
  id: LiveHostStoreId;
  host: PersistentLocus;
}>;

export type LiveHostPersistentStore = Readonly<{
  has: (id: LiveHostStoreId) => boolean;
  get: (id: LiveHostStoreId) => PersistentLocus | undefined;
  create: <TMap extends DocumentLiveMap, TActions extends LocusActionPayloads = LocusActionPayloads>(
    id: LiveHostStoreId,
    options: Omit<PersistentDocumentLocusOptions<TMap, TActions>, "logicalMapId" | "persistence">,
  ) => Promise<LocusResult<PersistentLocus<TMap, TActions>>>;
  load: (id: LiveHostStoreId) => Promise<LocusResult<PersistentLocus | undefined>>;
  unload: (id: LiveHostStoreId) => Promise<boolean>;
  list: () => readonly LiveHostPersistentStoreEntry[];
  connect: (id: LiveHostStoreId, socket: LocusSocketLike, context?: LocusConnectionContext) => Promise<LocusResult<LocusDisposer>>;
}>;

export type LiveHostStoreEntry<TState extends import("../core/types.js").JsonValue | undefined = import("../core/types.js").JsonValue | undefined, TActions extends LocusActionPayloads = LocusActionPayloads> = Readonly<{
  id: LiveHostStoreId;
  host: Locus<LiveMap<TState>, TActions>;
}>;

export type LiveHostStoreCreateOptions<TState extends import("../core/types.js").JsonValue | undefined = import("../core/types.js").JsonValue | undefined, TActions extends LocusActionPayloads = LocusActionPayloads> = ProjectedLocusOptions<TState, TActions>;

export type LiveHostStore = Readonly<{
  has: (id: LiveHostStoreId) => boolean;
  get: (id: LiveHostStoreId) => Locus | undefined;
  create: <TState extends import("../core/types.js").JsonValue | undefined = import("../core/types.js").JsonValue | undefined, TActions extends LocusActionPayloads = LocusActionPayloads>(id: LiveHostStoreId, options?: LiveHostStoreCreateOptions<TState, TActions>) => LocusResult<Locus<LiveMap<TState>, TActions>>;
  set: <TState extends import("../core/types.js").JsonValue | undefined = import("../core/types.js").JsonValue | undefined, TActions extends LocusActionPayloads = LocusActionPayloads>(id: LiveHostStoreId, host: Locus<LiveMap<TState>, TActions>) => LocusResult<Locus<LiveMap<TState>, TActions>>;
  delete: (id: LiveHostStoreId) => boolean;
  list: () => readonly LiveHostStoreEntry[];
  connect: (id: LiveHostStoreId, socket: LocusSocketLike, context?: LocusConnectionContext) => LocusResult<LocusDisposer>;
}>;

export type LiveHostAuthorityRegistryBlocker = LocusActivityKind | "acquisition" | "loading" | "disposing";
export type LiveHostAuthorityAcquisition<TAuthority extends LiveHostLifecycleAuthority = Locus> = Readonly<{ authority: TAuthority; release: LocusDisposer }>;
export type LiveHostAuthorityEvictionResult = Readonly<{ status: "evicted" }> | Readonly<{ status: "not-found" }> | Readonly<{ status: "busy"; blockers: readonly LiveHostAuthorityRegistryBlocker[] }> | Readonly<{ status: "disposing" }> | Readonly<{ status: "failed"; error: Readonly<{ code: string; message: string; cause?: unknown }> }>;
export type LiveHostAuthorityRegistryEvent = Readonly<{ type: "creation-started" | "creation-completed" | "creation-failed" | "became-active" | "became-idle" | "eviction-requested" | "eviction-blocked" | "eviction-completed" | "eviction-failed" | "capacity-rejected" | "disposal-started" | "disposal-completed" | "disposal-failed"; key?: string; code?: string; blockers?: readonly LiveHostAuthorityRegistryBlocker[] }>;
export type LiveHostAuthorityRegistrySchedule = (delayMs: number, callback: () => void) => LocusDisposer;
export type LiveHostAuthorityRegistryOptions<TAuthority extends LiveHostLifecycleAuthority = Locus> = Readonly<{ maxAuthorities: number; idleMs: number; sweepIntervalMs?: number; create(key: LiveHostStoreId): TAuthority | Promise<TAuthority>; dispose?(authority: TAuthority): void | Promise<void>; now?: () => number; schedule?: LiveHostAuthorityRegistrySchedule; event?(event: LiveHostAuthorityRegistryEvent): void }>;
export type LiveHostAuthorityRegistryDiagnostics = Readonly<{ state: "accepting" | "disposing" | "disposed"; entryCount: number; loadingCount: number; activeCount: number; idleCount: number; disposingCount: number; acquisitionCount: number }>;
export type LiveHostAuthorityRegistry<TAuthority extends LiveHostLifecycleAuthority = Locus> = Readonly<{ acquire(key: LiveHostStoreId): Promise<LocusResult<LiveHostAuthorityAcquisition<TAuthority>>>; evict(key: LiveHostStoreId): Promise<LiveHostAuthorityEvictionResult>; sweep(): Promise<number>; has(key: LiveHostStoreId): boolean; diagnostics(): LiveHostAuthorityRegistryDiagnostics; dispose(): Promise<void> }>;
/** Minimum authority-owned lifecycle surface accepted by the bounded registry. */
export type LiveHostLifecycleAuthority = Readonly<{ activity: LocusActivity; dispose: LocusDisposer }>;
