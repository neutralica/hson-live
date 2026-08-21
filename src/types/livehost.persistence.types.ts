// One-map persistence contracts.

import type { DocumentLiveMap } from "./livemap.types.js";
import type { ExistingMapLiveHostOptions, LiveHostForMap } from "./livehost.core.types.js";
import type { LiveHostActionPayloads } from "./livehost.protocol.types.js";
import type { LiveHostCanonicalCommit } from "./livehost.representation.types.js";
import type { LiveHostIncarnationId, LiveHostLogicalMapId } from "./livehost.shared.types.js";

/** Stable persisted map-kind discriminant. Projected data is reserved for a later codec. */
export type LiveHostPersistedMapKind = "document" | "projected-data";

export type LiveHostPersistedViewState = Readonly<{
  format: "view-state";
  payload: string;
}>;

export type LiveHostPersistedDocumentCheckpoint = Readonly<{
  logicalMapId: LiveHostLogicalMapId;
  incarnationId: LiveHostIncarnationId;
  mapKind: "document";
  mode: DocumentLiveMap["mode"];
  rev: number;
  snapshot: LiveHostPersistedViewState;
}>;

export type LiveHostPersistedCheckpoint = LiveHostPersistedDocumentCheckpoint;

/** Exact accepted canonical commit, keyed idempotently by map/incarnation/revision. */
export type LiveHostPersistedCommit = Readonly<{
  logicalMapId: LiveHostLogicalMapId;
  incarnationId: LiveHostIncarnationId;
  mapKind: "document";
  commit: LiveHostCanonicalCommit;
}>;

export type LiveHostPersistedMapState = Readonly<{
  checkpoint: LiveHostPersistedCheckpoint;
  commits: readonly LiveHostPersistedCommit[];
}>;

/** Backend port. Implementations must make exact repeated appends idempotent. */
export interface LiveHostPersistenceAdapter {
  load(logicalMapId: LiveHostLogicalMapId): Promise<LiveHostPersistedMapState | undefined>;
  /** Exact repeats for map/incarnation/revision must be idempotent; conflicting repeats must reject. */
  appendCommit(record: LiveHostPersistedCommit): Promise<void>;
  /** Atomically replace the checkpoint and remove commits through its revision. */
  replaceCheckpoint(record: LiveHostPersistedCheckpoint): Promise<void>;
}

export type PersistentDocumentLiveHostOptions<
  TMap extends DocumentLiveMap = DocumentLiveMap,
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
> = ExistingMapLiveHostOptions<TMap, TActions> & Readonly<{
  persistence: LiveHostPersistenceAdapter;
}>;

export type PersistentLiveHostForMap<
  TMap extends DocumentLiveMap = DocumentLiveMap,
  TActions extends LiveHostActionPayloads = LiveHostActionPayloads,
> = LiveHostForMap<TMap, TActions> & Readonly<{
  checkpoint: () => Promise<void>;
}>;
