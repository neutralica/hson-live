import type { JsonValue } from "../core/types.js";
import type { LiveTree } from "../api/livetree/livetree.js";
import type {
  LiveMapCommit,
  LiveMapDisposer,
  LiveMapOp,
  LiveMapPathHandle,
  LivePath,
} from "./livemap.types.js";
import type { CollectionReflectError } from "../api/reflect/reflect.collection.error.js";

/** Application identity used by the first keyed collection projector. */
export type CollectionReflectKey = string | number;

export type CollectionReflectStatus =
  | "initializing"
  | "ready"
  | "updating"
  | "failed"
  | "disposed";

export type CollectionReflectChangeKind =
  | "nested"
  | "update"
  | "source-replaced"
  | "synchronize";

/** Commit context delivered to a surviving item's renderer update hook. */
export type CollectionReflectChange = Readonly<{
  kind: CollectionReflectChangeKind;
  commit?: LiveMapCommit;
  ops: readonly LiveMapOp[];
}>;

/** Immutable context for one current source-item/view correspondence. */
export type CollectionReflectItemContext = Readonly<{
  key: CollectionReflectKey;
  /** Undefined until LiveMap exposes stable value-node identity across array rewrites. */
  sourceQuid: string | undefined;
  path: LivePath;
  ordinal: number;
  /** Register callback-owned cleanup under the projected branch lifecycle. */
  own: (cleanup: () => void) => LiveMapDisposer;
}>;

export type CollectionReflectItemUpdate<TItem extends JsonValue = JsonValue> = (
  source: LiveMapPathHandle<TItem>,
  change: CollectionReflectChange,
  context: CollectionReflectItemContext,
) => void;

export type CollectionReflectRenderResult<TItem extends JsonValue = JsonValue> =
  | LiveTree
  | Readonly<{
    tree: LiveTree;
    update?: CollectionReflectItemUpdate<TItem>;
    dispose?: () => void;
  }>;

export type CollectionReflectRender<TItem extends JsonValue = JsonValue> = (
  source: LiveMapPathHandle<TItem>,
  context: CollectionReflectItemContext,
) => CollectionReflectRenderResult<TItem>;

export type CollectionReflectOptions<TItem extends JsonValue = JsonValue> = Readonly<{
  source: LiveMapPathHandle<readonly TItem[]>;
  host: LiveTree;
  key: (value: TItem, context: Readonly<{ path: LivePath; ordinal: number }>) => CollectionReflectKey;
  render: CollectionReflectRender<TItem>;
}>;

export type CollectionReflectDiagnostics = Readonly<{
  status: CollectionReflectStatus;
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
  firstFailure: CollectionReflectError | undefined;
  lastSourceReplacementFailure: CollectionReflectError | undefined;
}>;

export type CollectionReflectMappingSummary = Readonly<{
  applicationKey: CollectionReflectKey;
  sourceQuid: string | undefined;
  sourcePath: LivePath;
  viewQuid: string;
  ordinal: number;
}>;

export type CollectionReflectSnapshot = Readonly<{
  status: CollectionReflectStatus;
  itemCount: number;
  sourcePath: LivePath;
  sourceRevisionLastApplied: number;
  failure: CollectionReflectError | undefined;
}>;

export type CollectionReflectListener = (snapshot: CollectionReflectSnapshot) => void;

/** Public lifecycle and diagnostics surface for one keyed projection. */
export type CollectionReflect<TItem extends JsonValue = JsonValue> = Readonly<{
  readonly status: CollectionReflectStatus;
  readonly host: LiveTree;
  readonly itemCount: number;
  readonly sourcePath: LivePath;
  readonly sourceRevisionLastApplied: number;
  readonly failure: CollectionReflectError | undefined;
  diagnostics: () => CollectionReflectDiagnostics;
  debugMappings: () => readonly CollectionReflectMappingSummary[];
  subscribe: (listener: CollectionReflectListener) => LiveMapDisposer;
  replaceSource: (source: LiveMapPathHandle<readonly TItem[]>) => void;
  synchronize: () => void;
  dispose: () => void;
}>;
