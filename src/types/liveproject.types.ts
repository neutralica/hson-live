import type { JsonValue } from "../core/types.js";
import type { LiveTree } from "../api/livetree/livetree.js";
import type {
  LiveMapCommit,
  LiveMapDisposer,
  LiveMapOp,
  LiveMapPathHandle,
  LivePath,
} from "./livemap.types.js";
import type { LiveProjectionError } from "../api/liveproject/liveproject.error.js";

/** Application identity used by the first keyed collection projector. */
export type LiveProjectionKey = string | number;

export type LiveProjectionStatus =
  | "initializing"
  | "ready"
  | "reconciling"
  | "failed"
  | "disposed";

export type LiveProjectionChangeKind =
  | "nested"
  | "reconcile"
  | "source-replaced"
  | "resync";

/** Commit context delivered to a surviving item's renderer update hook. */
export type LiveProjectionChange = Readonly<{
  kind: LiveProjectionChangeKind;
  commit?: LiveMapCommit;
  ops: readonly LiveMapOp[];
}>;

/** Immutable context for one current source-item/view correspondence. */
export type LiveProjectionItemContext = Readonly<{
  key: LiveProjectionKey;
  /** Undefined until LiveMap exposes stable value-node identity across array rewrites. */
  sourceQuid: string | undefined;
  path: LivePath;
  ordinal: number;
  /** Register callback-owned cleanup under the projected branch lifecycle. */
  own: (cleanup: () => void) => LiveMapDisposer;
}>;

export type LiveProjectionItemUpdate<TItem extends JsonValue = JsonValue> = (
  source: LiveMapPathHandle<TItem>,
  change: LiveProjectionChange,
  context: LiveProjectionItemContext,
) => void;

export type LiveProjectionRenderResult<TItem extends JsonValue = JsonValue> =
  | LiveTree
  | Readonly<{
    tree: LiveTree;
    update?: LiveProjectionItemUpdate<TItem>;
    dispose?: () => void;
  }>;

export type LiveProjectionRender<TItem extends JsonValue = JsonValue> = (
  source: LiveMapPathHandle<TItem>,
  context: LiveProjectionItemContext,
) => LiveProjectionRenderResult<TItem>;

export type LiveKeyedProjectionOptions<TItem extends JsonValue = JsonValue> = Readonly<{
  source: LiveMapPathHandle<readonly TItem[]>;
  host: LiveTree;
  key: (value: TItem, context: Readonly<{ path: LivePath; ordinal: number }>) => LiveProjectionKey;
  render: LiveProjectionRender<TItem>;
}>;

export type LiveProjectionDiagnostics = Readonly<{
  status: LiveProjectionStatus;
  sourceRevisionLastApplied: number;
  projectedItemCount: number;
  recordsCreated: number;
  recordsReused: number;
  recordsMoved: number;
  recordsUpdated: number;
  recordsRemoved: number;
  batchAttachmentPasses: number;
  recordsBatchAttached: number;
  largestAttachedBatch: number;
  fullReconciliations: number;
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
  firstFailure: LiveProjectionError | undefined;
  lastSourceReplacementFailure: LiveProjectionError | undefined;
}>;

export type LiveProjectionMappingSummary = Readonly<{
  applicationKey: LiveProjectionKey;
  sourceQuid: string | undefined;
  sourcePath: LivePath;
  viewQuid: string;
  ordinal: number;
}>;

export type LiveProjectionSnapshot = Readonly<{
  status: LiveProjectionStatus;
  itemCount: number;
  sourcePath: LivePath;
  sourceRevisionLastApplied: number;
  failure: LiveProjectionError | undefined;
}>;

export type LiveProjectionListener = (snapshot: LiveProjectionSnapshot) => void;

/** Public lifecycle and diagnostics surface for one keyed projection. */
export type LiveKeyedProjection<TItem extends JsonValue = JsonValue> = Readonly<{
  readonly status: LiveProjectionStatus;
  readonly host: LiveTree;
  readonly itemCount: number;
  readonly sourcePath: LivePath;
  readonly sourceRevisionLastApplied: number;
  readonly failure: LiveProjectionError | undefined;
  diagnostics: () => LiveProjectionDiagnostics;
  debugMappings: () => readonly LiveProjectionMappingSummary[];
  subscribe: (listener: LiveProjectionListener) => LiveMapDisposer;
  replaceSource: (source: LiveMapPathHandle<readonly TItem[]>) => void;
  resync: () => void;
  dispose: () => void;
}>;
