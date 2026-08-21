// One-map canonical stream and snapshot/representation contracts.
// locus.types.ts

import type {
  ClassifiedLiveMap,
  DataLiveMapMode,
  DocumentLiveMap,
  LiveMap,
  LiveMapCoreSchemaApi,
  LiveMapDocumentAttributeValue,
  LiveMapDocumentAttrs,
  LiveMapDocumentContent,
  LiveMapDocumentCommitTarget,
  LiveMapGraphOp,
  LiveMapProjectedGraphEnsureQuidOp,
  LiveMapAnyOp,
  LiveMapCommit,
  LiveMapAuthority,
  LiveMapDocumentApi,
  LiveMapRootMode,
  LiveMapPathArrayApi,
  LiveMapPathHandle,
  LiveMapPathObjectApi,
  LiveMapPathValue,
  LivePath,
  LiveMapOp,
  LiveMapStructuralJsonEnvelope,
} from "./livemap.types.js";
import type { JsonValue } from "../core/types.js";
import type {
  LocusActionId,
  LocusActionName,
  LocusActionRequestId,
  LocusActionStatusId,
  LocusConnectionEpoch,
  LocusDisposer,
  LocusError,
  LocusClientId,
  LocusIncarnationId,
  LocusLogicalMapId,
  LocusRecoveryId,
  LocusResult,
  LocusSchemaDecoder,
  LocusSchemaIssue,
  LocusSessionCredential,
  LocusSessionId,
  LocusSessionRequestId,
  LocusSeq,
  LocusValidator,
} from "./locus.shared.types.js";
import type { LiveTraceSink } from "./live.trace.types.js";


/** Wire-safe representation of a projected value that may be absent. */
export type LocusWireValue =
  | Readonly<{ present: false }>
  | Readonly<{ present: true; value: JsonValue }>;

/** Exact HSON-backed representation used for graph content at Locus boundaries. */
export type LocusEncodedGraphContent = Readonly<{
  format: "hson-graph";
  payload: string;
}>;

export type LocusCanonicalSetOp = Readonly<{
  kind: "set";
  path: LivePath;
  prev: LocusWireValue;
  next: LocusWireValue;
}>;

export type LocusCanonicalDeleteOp = Readonly<{
  kind: "delete";
  path: LivePath;
  prev: LocusWireValue;
  next: Readonly<{ present: false }>;
}>;

export type LocusCanonicalReplaceOp = Readonly<{
  kind: "replace";
  path: LivePath;
  prev: LocusWireValue;
  next: LocusWireValue;
}>;

export type LocusCanonicalSpliceOp = Readonly<{
  kind: "splice";
  path: LivePath;
  start: number;
  removed: readonly JsonValue[];
  inserted: readonly JsonValue[];
  prev: LocusWireValue;
  next: LocusWireValue;
}>;

export type LocusCanonicalRenameOp = Readonly<{
  kind: "rename";
  path: LivePath;
  from: string;
  to: string;
  prev: LocusWireValue;
  next: LocusWireValue;
}>;

export type LocusCanonicalMoveOp = Readonly<{
  kind: "move";
  path: LivePath;
  from: number;
  to: number;
  prev: LocusWireValue;
  next: LocusWireValue;
}>;

export type LocusEncodedGraphReplaceRootOp = Omit<
  Extract<LiveMapGraphOp, { op: "replace-root" }>,
  "root"
> & Readonly<{ root: LocusEncodedGraphContent }>;

type WithLocusCanonicalDocumentTarget<TOperation> = TOperation extends Readonly<{ target: unknown }>
  ? Omit<TOperation, "target"> & Readonly<{ target: LiveMapDocumentCommitTarget }>
  : never;

export type LocusEncodedGraphReplaceContentOp = Omit<
  WithLocusCanonicalDocumentTarget<Extract<LiveMapGraphOp, { op: "replace-content" }>>,
  "replacement"
> & Readonly<{ replacement: LocusEncodedGraphContent }>;

export type LocusEncodedGraphInsertContentOp = Omit<
  WithLocusCanonicalDocumentTarget<Extract<LiveMapGraphOp, { op: "insert-content" }>>,
  "content"
> & Readonly<{ content: LocusEncodedGraphContent }>;

export type LocusEncodedGraphOp =
  | WithLocusCanonicalDocumentTarget<Exclude<LiveMapGraphOp, { op: "replace-root" | "replace-content" | "insert-content" }>>
  | LocusEncodedGraphReplaceRootOp
  | LocusEncodedGraphReplaceContentOp
  | LocusEncodedGraphInsertContentOp;

export type LocusEncodedProjectedEnsureQuidOp = LiveMapProjectedGraphEnsureQuidOp;

export type LocusCanonicalOp =
  | LocusCanonicalSetOp
  | LocusCanonicalDeleteOp
  | LocusCanonicalReplaceOp
  | LocusCanonicalSpliceOp
  | LocusCanonicalRenameOp
  | LocusCanonicalMoveOp
  | LocusEncodedGraphOp
  | LocusEncodedProjectedEnsureQuidOp;

/** One immutable changed commit in an incarnation's authoritative stream. */
export type LocusCanonicalCommit = Readonly<{
  logicalMapId: LocusLogicalMapId;
  incarnationId: LocusIncarnationId;
  mode: LiveMapRootMode;
  prevRev: number;
  rev: number;
  ops: readonly LocusCanonicalOp[];
}> & Partial<LiveMapStructuralJsonEnvelope>;

export type LocusCanonicalCommitListener = (commit: LocusCanonicalCommit) => void;

export type LocusCanonicalHistoryOptions = Readonly<{
  maxCommits?: number;
  maxBytes?: number;
}>;

export type LocusCanonicalStreamOptions = Readonly<{
  logicalMapId?: LocusLogicalMapId;
  incarnationId?: LocusIncarnationId;
  history?: LocusCanonicalHistoryOptions;
  trace?: LiveTraceSink;
}>;

export type LocusCanonicalHistoryDiagnostics = Readonly<{
  logicalMapId: LocusLogicalMapId;
  incarnationId: LocusIncarnationId;
  headRev: number;
  firstRetainedCommitRev?: number;
  lastRetainedCommitRev?: number;
  earliestResumableBaseRev: number;
  retainedCommitCount: number;
  retainedEncodedBytes: number;
  maxCommits: number;
  maxBytes: number;
  publishedCommitCount: number;
  publicationErrorCount: number;
}>;

export type LocusCanonicalHistory = Readonly<{
  can_replay: (fromRev: number, throughRev?: number) => boolean;
  replay_after: (fromRev: number, throughRev?: number) => readonly LocusCanonicalCommit[] | undefined;
  debug: () => LocusCanonicalHistoryDiagnostics;
}>;

export type LocusCanonicalStream<
  TMap extends LiveMapAuthority = ClassifiedLiveMap,
> = Readonly<{
  mode: TMap["mode"];
  logicalMapId: LocusLogicalMapId;
  incarnationId: LocusIncarnationId;
  readonly headRev: number;
  history: LocusCanonicalHistory;
  on_commit: (listener: LocusCanonicalCommitListener) => LocusDisposer;
}>;

type LocusSnapshotCommonFields = Readonly<{
  logicalMapId: LocusLogicalMapId;
  incarnationId: LocusIncarnationId;
  rev: number;
  mode: LiveMapRootMode;
}>;

export type LocusSnapshotEnvelope = LocusSnapshotCommonFields & (
  | Readonly<{ hson: string }>
  | Readonly<{ format: "view-state"; payload: string }>
);

export type LocusSnapshotCapabilities = Readonly<{
  hson: true;
  viewState?: true;
}>;

export type LocusSnapshotEncodingSelection =
  | Readonly<{ format: "hson" }>
  | Readonly<{ format: "view-state" }>;
