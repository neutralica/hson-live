// One-map persistence contracts.

import type { DocumentLiveMap } from "./livemap.types.js";
import type { Locus, LocusOptions } from "./locus.core.types.js";
import type { LocusActionPayloads } from "./locus.protocol.types.js";
import type { LocusCanonicalCommit } from "./locus.representation.types.js";
import type { LocusIncarnationId, LocusLogicalMapId } from "./locus.shared.types.js";

/** Stable persisted map-kind discriminant. Projected data is reserved for a later codec. */
export type LocusPersistedMapKind = "document" | "projected-data";

export type LocusPersistedViewState = Readonly<{
  format: "view-state";
  payload: string;
}>;

export type LocusPersistedDocumentCheckpoint = Readonly<{
  logicalMapId: LocusLogicalMapId;
  incarnationId: LocusIncarnationId;
  mapKind: "document";
  mode: DocumentLiveMap["mode"];
  rev: number;
  snapshot: LocusPersistedViewState;
}>;

export type LocusPersistedCheckpoint = LocusPersistedDocumentCheckpoint;

/** Exact accepted canonical commit, keyed idempotently by map/incarnation/revision. */
export type LocusPersistedCommit = Readonly<{
  logicalMapId: LocusLogicalMapId;
  incarnationId: LocusIncarnationId;
  mapKind: "document";
  commit: LocusCanonicalCommit;
}>;

export type LocusPersistedMapState = Readonly<{
  checkpoint: LocusPersistedCheckpoint;
  commits: readonly LocusPersistedCommit[];
}>;

/** Backend port. Implementations must make exact repeated appends idempotent. */
export interface LocusPersistenceAdapter {
  load(logicalMapId: LocusLogicalMapId): Promise<LocusPersistedMapState | undefined>;
  /** Exact repeats for map/incarnation/revision must be idempotent; conflicting repeats must reject. */
  appendCommit(record: LocusPersistedCommit): Promise<void>;
  /** Atomically replace the checkpoint and remove commits through its revision. */
  replaceCheckpoint(record: LocusPersistedCheckpoint): Promise<void>;
}

export type PersistentDocumentLocusOptions<
  TMap extends DocumentLiveMap = DocumentLiveMap,
  TActions extends LocusActionPayloads = LocusActionPayloads,
> = LocusOptions<TMap, TActions> & Readonly<{
  persistence: LocusPersistenceAdapter;
}>;

export type PersistentLocus<
  TMap extends DocumentLiveMap = DocumentLiveMap,
  TActions extends LocusActionPayloads = LocusActionPayloads,
> = Locus<TMap, TActions> & Readonly<{
  checkpoint: () => Promise<void>;
}>;
