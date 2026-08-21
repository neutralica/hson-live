// One-map canonical stream and snapshot/representation contracts.
// livehost.types.ts

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
  LiveHostActionId,
  LiveHostActionName,
  LiveHostActionRequestId,
  LiveHostActionStatusId,
  LiveHostConnectionEpoch,
  LiveHostDisposer,
  LiveHostError,
  LiveHostId,
  LiveHostIncarnationId,
  LiveHostLogicalMapId,
  LiveHostRecoveryId,
  LiveHostResult,
  LiveHostSchemaDecoder,
  LiveHostSchemaIssue,
  LiveHostSessionCredential,
  LiveHostSessionId,
  LiveHostSessionRequestId,
  LiveHostSeq,
  LiveHostStoreId,
  LiveHostValidator,
} from "./livehost.shared.types.js";
import type { LiveTraceSink } from "./livehost.trace.types.js";


/** Wire-safe representation of a projected value that may be absent. */
export type LiveHostWireValue =
  | Readonly<{ present: false }>
  | Readonly<{ present: true; value: JsonValue }>;

/** Exact HSON-backed representation used for graph content at LiveHost boundaries. */
export type LiveHostEncodedGraphContent = Readonly<{
  format: "hson-graph";
  payload: string;
}>;

export type LiveHostCanonicalSetOp = Readonly<{
  kind: "set";
  path: LivePath;
  prev: LiveHostWireValue;
  next: LiveHostWireValue;
}>;

export type LiveHostCanonicalDeleteOp = Readonly<{
  kind: "delete";
  path: LivePath;
  prev: LiveHostWireValue;
  next: Readonly<{ present: false }>;
}>;

export type LiveHostCanonicalReplaceOp = Readonly<{
  kind: "replace";
  path: LivePath;
  prev: LiveHostWireValue;
  next: LiveHostWireValue;
}>;

export type LiveHostCanonicalSpliceOp = Readonly<{
  kind: "splice";
  path: LivePath;
  start: number;
  removed: readonly JsonValue[];
  inserted: readonly JsonValue[];
  prev: LiveHostWireValue;
  next: LiveHostWireValue;
}>;

export type LiveHostCanonicalRenameOp = Readonly<{
  kind: "rename";
  path: LivePath;
  from: string;
  to: string;
  prev: LiveHostWireValue;
  next: LiveHostWireValue;
}>;

export type LiveHostCanonicalMoveOp = Readonly<{
  kind: "move";
  path: LivePath;
  from: number;
  to: number;
  prev: LiveHostWireValue;
  next: LiveHostWireValue;
}>;

export type LiveHostEncodedGraphReplaceRootOp = Omit<
  Extract<LiveMapGraphOp, { op: "replace-root" }>,
  "root"
> & Readonly<{ root: LiveHostEncodedGraphContent }>;

type WithLiveHostCanonicalDocumentTarget<TOperation> = TOperation extends Readonly<{ target: unknown }>
  ? Omit<TOperation, "target"> & Readonly<{ target: LiveMapDocumentCommitTarget }>
  : never;

export type LiveHostEncodedGraphReplaceContentOp = Omit<
  WithLiveHostCanonicalDocumentTarget<Extract<LiveMapGraphOp, { op: "replace-content" }>>,
  "replacement"
> & Readonly<{ replacement: LiveHostEncodedGraphContent }>;

export type LiveHostEncodedGraphInsertContentOp = Omit<
  WithLiveHostCanonicalDocumentTarget<Extract<LiveMapGraphOp, { op: "insert-content" }>>,
  "content"
> & Readonly<{ content: LiveHostEncodedGraphContent }>;

export type LiveHostEncodedGraphOp =
  | WithLiveHostCanonicalDocumentTarget<Exclude<LiveMapGraphOp, { op: "replace-root" | "replace-content" | "insert-content" }>>
  | LiveHostEncodedGraphReplaceRootOp
  | LiveHostEncodedGraphReplaceContentOp
  | LiveHostEncodedGraphInsertContentOp;

export type LiveHostEncodedProjectedEnsureQuidOp = LiveMapProjectedGraphEnsureQuidOp;

export type LiveHostCanonicalOp =
  | LiveHostCanonicalSetOp
  | LiveHostCanonicalDeleteOp
  | LiveHostCanonicalReplaceOp
  | LiveHostCanonicalSpliceOp
  | LiveHostCanonicalRenameOp
  | LiveHostCanonicalMoveOp
  | LiveHostEncodedGraphOp
  | LiveHostEncodedProjectedEnsureQuidOp;

/** One immutable changed commit in an incarnation's authoritative stream. */
export type LiveHostCanonicalCommit = Readonly<{
  logicalMapId: LiveHostLogicalMapId;
  incarnationId: LiveHostIncarnationId;
  mode: LiveMapRootMode;
  prevRev: number;
  rev: number;
  ops: readonly LiveHostCanonicalOp[];
}> & Partial<LiveMapStructuralJsonEnvelope>;

export type LiveHostCanonicalCommitListener = (commit: LiveHostCanonicalCommit) => void;

export type LiveHostCanonicalHistoryOptions = Readonly<{
  maxCommits?: number;
  maxBytes?: number;
}>;

export type LiveHostCanonicalStreamOptions = Readonly<{
  logicalMapId?: LiveHostLogicalMapId;
  incarnationId?: LiveHostIncarnationId;
  history?: LiveHostCanonicalHistoryOptions;
  trace?: LiveTraceSink;
}>;

export type LiveHostCanonicalHistoryDiagnostics = Readonly<{
  logicalMapId: LiveHostLogicalMapId;
  incarnationId: LiveHostIncarnationId;
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

export type LiveHostCanonicalHistory = Readonly<{
  can_replay: (fromRev: number, throughRev?: number) => boolean;
  replay_after: (fromRev: number, throughRev?: number) => readonly LiveHostCanonicalCommit[] | undefined;
  debug: () => LiveHostCanonicalHistoryDiagnostics;
}>;

export type LiveHostCanonicalStream<
  TMap extends LiveMapAuthority = ClassifiedLiveMap,
> = Readonly<{
  mode: TMap["mode"];
  logicalMapId: LiveHostLogicalMapId;
  incarnationId: LiveHostIncarnationId;
  readonly headRev: number;
  history: LiveHostCanonicalHistory;
  on_commit: (listener: LiveHostCanonicalCommitListener) => LiveHostDisposer;
}>;

type LiveHostSnapshotCommonFields = Readonly<{
  logicalMapId: LiveHostLogicalMapId;
  incarnationId: LiveHostIncarnationId;
  rev: number;
  mode: LiveMapRootMode;
}>;

export type LiveHostSnapshotEnvelope = LiveHostSnapshotCommonFields & (
  | Readonly<{ hson: string }>
  | Readonly<{ format: "view-state"; payload: string }>
);

export type LiveHostSnapshotCapabilities = Readonly<{
  hson: true;
  viewState?: true;
}>;

export type LiveHostSnapshotEncodingSelection =
  | Readonly<{ format: "hson" }>
  | Readonly<{ format: "view-state" }>;
