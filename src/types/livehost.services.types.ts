// Multi-authority store, persistence residency, and lifecycle registry contracts.

import type { DocumentLiveMap, LiveMap } from "./livemap.types.js";
import type { Locus, ProjectedLocusOptions } from "./locus.core.types.js";
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
