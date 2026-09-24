import type { JsonValue } from "../core/types.js";
import type { LiveTree } from "../api/livetree/livetree.js";
import type {
  LiveMapCommit,
  LiveMapDisposer,
  LiveMapOp,
  LiveMapPathHandle,
  LivePath,
} from "./livemap.types.js";
import type { CollectionMirrorError } from "../api/mirror/mirror.collection.error.js";

/** Application identity used by the first keyed collection projector. */
export type CollectionMirrorKey = string | number;

export type CollectionMirrorStatus =
  | "initializing"
  | "ready"
  | "updating"
  | "failed"
  | "disposed";

export type CollectionMirrorChangeKind =
  | "nested"
  | "update"
  | "source-replaced"
  | "synchronize";

/** Commit context delivered to a surviving item's renderer update hook. */
export type CollectionMirrorChange = Readonly<{
  kind: CollectionMirrorChangeKind;
  commit?: LiveMapCommit;
  ops: readonly LiveMapOp[];
}>;

/** Immutable context for one current source-item/view correspondence. */
export type CollectionMirrorItemContext = Readonly<{
  key: CollectionMirrorKey;
  /** Undefined until LiveMap exposes stable value-node identity across array rewrites. */
  sourceQuid: string | undefined;
  path: LivePath;
  ordinal: number;
  /** Register callback-owned cleanup under the projected branch lifecycle. */
  own: (cleanup: () => void) => LiveMapDisposer;
}>;

export type CollectionMirrorItemUpdate<TItem extends JsonValue = JsonValue> = (
  source: LiveMapPathHandle<TItem>,
  change: CollectionMirrorChange,
  context: CollectionMirrorItemContext,
) => void;

export type CollectionMirrorRenderResult<TItem extends JsonValue = JsonValue> =
  | LiveTree
  | Readonly<{
    tree: LiveTree;
    update?: CollectionMirrorItemUpdate<TItem>;
    dispose?: () => void;
  }>;

export type CollectionMirrorRender<TItem extends JsonValue = JsonValue> = (
  source: LiveMapPathHandle<TItem>,
  context: CollectionMirrorItemContext,
) => CollectionMirrorRenderResult<TItem>;

export type CollectionMirrorOptions<TItem extends JsonValue = JsonValue> = Readonly<{
  source: LiveMapPathHandle<readonly TItem[]>;
  host: LiveTree;
  key: (value: TItem, context: Readonly<{ path: LivePath; ordinal: number }>) => CollectionMirrorKey;
  render: CollectionMirrorRender<TItem>;
}>;

export type CollectionMirrorDiagnostics = Readonly<{
  status: CollectionMirrorStatus;
  sourceRevisionLastApplied: number;
  reflectedItemCount: number;
  recordsCreated: number;
  recordsReused: number;
  recordsMoved: number;
  recordsUpdated: number;
  recordsRemoved: number;
  batchAttachmentPasses: number;
  recordsBatchAttached: number;
  largestAttachedBatch: number;
  fullSynchronizations: number;
  targetedCommitApplications: number;
  ignoredOutOfScopeCommits: number;
  keyConflicts: number;
  rendererFailures: number;
  observerFailures: number;
  sourceReplacements: number;
  failedSourceReplacements: number;
  subscriptionsCreated: number;
  subscriptionsDisposed: number;
  sourceQuidMappings: number;
  applicationKeyMappings: number;
  firstFailure: CollectionMirrorError | undefined;
  lastSourceReplacementFailure: CollectionMirrorError | undefined;
}>;

export type CollectionMirrorMappingSummary = Readonly<{
  applicationKey: CollectionMirrorKey;
  sourceQuid: string | undefined;
  sourcePath: LivePath;
  viewQuid: string;
  ordinal: number;
}>;

export type CollectionMirrorSnapshot = Readonly<{
  status: CollectionMirrorStatus;
  itemCount: number;
  sourcePath: LivePath;
  sourceRevisionLastApplied: number;
  failure: CollectionMirrorError | undefined;
}>;

export type CollectionMirrorListener = (snapshot: CollectionMirrorSnapshot) => void;

/** Public lifecycle and diagnostics surface for one keyed projection. */
export type CollectionMirror<TItem extends JsonValue = JsonValue> = Readonly<{
  readonly status: CollectionMirrorStatus;
  readonly host: LiveTree;
  readonly itemCount: number;
  readonly sourcePath: LivePath;
  readonly sourceRevisionLastApplied: number;
  readonly failure: CollectionMirrorError | undefined;
  diagnostics: () => CollectionMirrorDiagnostics;
  debugMappings: () => readonly CollectionMirrorMappingSummary[];
  subscribe: (listener: CollectionMirrorListener) => LiveMapDisposer;
  replaceSource: (source: LiveMapPathHandle<readonly TItem[]>) => void;
  synchronize: () => void;
  dispose: () => void;
}>;
