// One-map persistence contracts.

import type { DocumentLiveMap } from "./livemap.types.js";
import type { Locus, LocusOptions } from "./locus.core.types.js";
import type { LocusActionPayloads } from "./locus.protocol.types.js";
import type { LocusClientCommit } from "./locus.representation.types.js";
import type { LocusIncarnationId, LocusLogicalMapId } from "./locus.shared.types.js";

/** Stable persisted map-kind discriminant. Data persistence is reserved for a later codec. */
export type LocusPersistedMapKind = "document" | "data";

export type LocusPersistedViewState = Readonly<{
  format: "view-state";
  payload: string;
}>;

export type LocusPersistedDocumentCheckpoint = Readonly<{
  format: "hson-locus-durable-document-checkpoint-v1";
  logicalMapId: LocusLogicalMapId;
  incarnationId: LocusIncarnationId;
  mapKind: "document";
  mode: DocumentLiveMap["mode"];
  rev: number;
  snapshot: LocusPersistedViewState;
}>;

export type LocusPersistedCheckpoint = LocusPersistedDocumentCheckpoint;

/** QUID-free semantic effect, keyed idempotently by map/incarnation/revision. */
export type LocusDurableDocumentEffects = Readonly<Omit<LocusClientCommit, "clientFormat">>;

export type LocusPersistedCommit = Readonly<{
  format: "hson-locus-durable-document-commit-v1";
  logicalMapId: LocusLogicalMapId;
  incarnationId: LocusIncarnationId;
  mapKind: "document";
  commit: LocusDurableDocumentEffects;
}>;

export type LocusPersistedMapState = Readonly<{
  checkpoint: LocusPersistedCheckpoint;
  commits: readonly LocusPersistedCommit[];
}>;

/** Backend port. Implementations must make repeated durable appends idempotent. */
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
