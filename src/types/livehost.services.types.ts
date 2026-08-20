// Multi-authority store, persistence residency, and lifecycle registry contracts.

import type { DocumentLiveMap } from "./livemap.types.js";
import type { LiveHost, LiveHostActivity, LiveHostActivityKind, LiveHostForMap, LiveHostOptions } from "./livehost.core.types.js";
import type { LiveHostActionPayloads, LiveHostConnectionContext, LiveHostSocketLike } from "./livehost.protocol.types.js";
import type {
  LiveHostDisposer,
  LiveHostResult,
  LiveHostStoreId,
} from "./livehost.shared.types.js";
import type {
  PersistentDocumentLiveHostOptions,
  PersistentLiveHostForMap,
} from "./livehost.persistence.types.js";

export type LiveHostPersistentStoreEntry = Readonly<{
  id: LiveHostStoreId;
  host: PersistentLiveHostForMap;
}>;

export type LiveHostPersistentStore = Readonly<{
  has: (id: LiveHostStoreId) => boolean;
  get: (id: LiveHostStoreId) => PersistentLiveHostForMap | undefined;
  create: <TMap extends DocumentLiveMap, TActions extends LiveHostActionPayloads = LiveHostActionPayloads>(
    id: LiveHostStoreId,
    options: Omit<PersistentDocumentLiveHostOptions<TMap, TActions>, "logicalMapId" | "persistence">,
  ) => Promise<LiveHostResult<PersistentLiveHostForMap<TMap, TActions>>>;
  load: (id: LiveHostStoreId) => Promise<LiveHostResult<PersistentLiveHostForMap | undefined>>;
  unload: (id: LiveHostStoreId) => Promise<boolean>;
  list: () => readonly LiveHostPersistentStoreEntry[];
  connect: (id: LiveHostStoreId, socket: LiveHostSocketLike, context?: LiveHostConnectionContext) => Promise<LiveHostResult<LiveHostDisposer>>;
}>;

export type LiveHostStoreEntry<TState extends import("../core/types.js").JsonValue | undefined = import("../core/types.js").JsonValue | undefined, TActions extends LiveHostActionPayloads = LiveHostActionPayloads> = Readonly<{
  id: LiveHostStoreId;
  host: LiveHost<TState, TActions>;
}>;

export type LiveHostStoreCreateOptions<TState extends import("../core/types.js").JsonValue | undefined = import("../core/types.js").JsonValue | undefined, TActions extends LiveHostActionPayloads = LiveHostActionPayloads> = LiveHostOptions<TState, TActions>;

export type LiveHostStore = Readonly<{
  has: (id: LiveHostStoreId) => boolean;
  get: (id: LiveHostStoreId) => LiveHost | undefined;
  create: <TState extends import("../core/types.js").JsonValue | undefined = import("../core/types.js").JsonValue | undefined, TActions extends LiveHostActionPayloads = LiveHostActionPayloads>(id: LiveHostStoreId, options?: LiveHostStoreCreateOptions<TState, TActions>) => LiveHostResult<LiveHost<TState, TActions>>;
  set: <TState extends import("../core/types.js").JsonValue | undefined = import("../core/types.js").JsonValue | undefined, TActions extends LiveHostActionPayloads = LiveHostActionPayloads>(id: LiveHostStoreId, host: LiveHost<TState, TActions>) => LiveHostResult<LiveHost<TState, TActions>>;
  delete: (id: LiveHostStoreId) => boolean;
  list: () => readonly LiveHostStoreEntry[];
  connect: (id: LiveHostStoreId, socket: LiveHostSocketLike, context?: LiveHostConnectionContext) => LiveHostResult<LiveHostDisposer>;
}>;

export type LiveHostAuthorityRegistryBlocker = LiveHostActivityKind | "acquisition" | "loading" | "disposing";
export type LiveHostAuthorityAcquisition<TAuthority extends LiveHostLifecycleAuthority = LiveHostForMap> = Readonly<{ authority: TAuthority; release: LiveHostDisposer }>;
export type LiveHostAuthorityEvictionResult = Readonly<{ status: "evicted" }> | Readonly<{ status: "not-found" }> | Readonly<{ status: "busy"; blockers: readonly LiveHostAuthorityRegistryBlocker[] }> | Readonly<{ status: "disposing" }> | Readonly<{ status: "failed"; error: Readonly<{ code: string; message: string; cause?: unknown }> }>;
export type LiveHostAuthorityRegistryEvent = Readonly<{ type: "creation-started" | "creation-completed" | "creation-failed" | "became-active" | "became-idle" | "eviction-requested" | "eviction-blocked" | "eviction-completed" | "eviction-failed" | "capacity-rejected" | "disposal-started" | "disposal-completed" | "disposal-failed"; key?: string; code?: string; blockers?: readonly LiveHostAuthorityRegistryBlocker[] }>;
export type LiveHostAuthorityRegistrySchedule = (delayMs: number, callback: () => void) => LiveHostDisposer;
export type LiveHostAuthorityRegistryOptions<TAuthority extends LiveHostLifecycleAuthority = LiveHostForMap> = Readonly<{ maxAuthorities: number; idleMs: number; sweepIntervalMs?: number; create(key: LiveHostStoreId): TAuthority | Promise<TAuthority>; dispose?(authority: TAuthority): void | Promise<void>; now?: () => number; schedule?: LiveHostAuthorityRegistrySchedule; event?(event: LiveHostAuthorityRegistryEvent): void }>;
export type LiveHostAuthorityRegistryDiagnostics = Readonly<{ state: "accepting" | "disposing" | "disposed"; entryCount: number; loadingCount: number; activeCount: number; idleCount: number; disposingCount: number; acquisitionCount: number }>;
export type LiveHostAuthorityRegistry<TAuthority extends LiveHostLifecycleAuthority = LiveHostForMap> = Readonly<{ acquire(key: LiveHostStoreId): Promise<LiveHostResult<LiveHostAuthorityAcquisition<TAuthority>>>; evict(key: LiveHostStoreId): Promise<LiveHostAuthorityEvictionResult>; sweep(): Promise<number>; has(key: LiveHostStoreId): boolean; diagnostics(): LiveHostAuthorityRegistryDiagnostics; dispose(): Promise<void> }>;
/** Minimum authority-owned lifecycle surface accepted by the bounded registry. */
export type LiveHostLifecycleAuthority = Readonly<{ activity: LiveHostActivity; dispose: LiveHostDisposer }>;
