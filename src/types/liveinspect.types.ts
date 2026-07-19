import type { JsonValue } from "../core/types.js";
import type { LiveTree } from "../api/livetree/livetree.js";
import type { LiveMap, LiveMapDisposer, LiveMapPathHandle, LivePath } from "./livemap.types.js";
import type { LiveProjectionKey } from "./liveproject.types.js";
import type { LiveInspectorError } from "../api/liveinspect/liveinspect.error.js";

export type LiveInspectorSource = LiveInspectorMapSource | LiveMapPathHandle;
export type LiveInspectorStatus = "initializing" | "ready" | "replacing" | "failed" | "disposed";
export type LiveInspectorValueKind = "object" | "array" | "string" | "number" | "boolean" | "null";
export type LiveInspectorBranchRole = "root" | "object-property" | "array-item";
export type LiveInspectorArrayIdentity = "application-key" | "positional";
export type LiveInspectorHsonMode = "none" | "friendly" | "canonical";
export type LiveInspectorSerializationTarget = "json" | "hson" | "html" | "canonical-node";
export type LiveInspectorMapSource = Pick<
  LiveMap<any>,
  "root"
  | "at"
  | "snap"
  | "feed"
  | "schema"
  | "debug"
>;
export type LiveInspectorArrayKeyContext = Readonly<{
  arrayPath: LivePath;
  itemPath: LivePath;
  index: number;
}>;

/** Return undefined for an explicitly positional array at this source path. */
export type LiveInspectorArrayKeyResolver = (
  item: JsonValue,
  context: LiveInspectorArrayKeyContext,
) => LiveProjectionKey | undefined;

/** Mutation-free source view supplied to inspector render extensions. */
export type LiveInspectorReadHandle = Readonly<{
  readonly quid: string;
  readonly rev: number;
  path: () => LivePath;
  snap: () => JsonValue;
  at: (path: LivePath) => LiveInspectorReadHandle;
}>;

export type LiveInspectorSemanticContext = Readonly<{
  source: LiveInspectorReadHandle;
  path: LivePath;
  depth: number;
  role: LiveInspectorBranchRole;
  kind: LiveInspectorValueKind;
  key: LiveProjectionKey | undefined;
  arrayIdentity: LiveInspectorArrayIdentity | undefined;
}>;

export type LiveInspectorRendererUpdate = (
  source: LiveInspectorReadHandle,
  context: LiveInspectorSemanticContext,
) => void;

export type LiveInspectorRendererResult =
  | LiveTree
  | Readonly<{
    tree: LiveTree;
    update?: LiveInspectorRendererUpdate;
    dispose?: () => void;
  }>;

export type LiveInspectorSemanticRenderer = (
  source: LiveInspectorReadHandle,
  context: LiveInspectorSemanticContext,
) => LiveInspectorRendererResult;

export type LiveInspectorRenderers = Readonly<{
  primitive?: LiveInspectorSemanticRenderer;
  objectSummary?: LiveInspectorSemanticRenderer;
  arraySummary?: LiveInspectorSemanticRenderer;
  empty?: LiveInspectorSemanticRenderer;
}>;

export type LiveInspectorSpecialization = Readonly<{
  name: string;
  priority?: number;
  match: (value: JsonValue, context: LiveInspectorSemanticContext) => boolean;
  render: LiveInspectorSemanticRenderer;
}>;

export type LiveInspectorOptions = Readonly<{
  source: LiveInspectorSource;
  host: LiveTree;
  initialDepth?: number;
  arrayKey?: LiveInspectorArrayKeyResolver;
  showSchema?: boolean;
  hsonMode?: LiveInspectorHsonMode;
  longStringLimit?: number;
  expandAllLimit?: number;
  specializations?: readonly LiveInspectorSpecialization[];
  renderers?: LiveInspectorRenderers;
}>;

export type LiveInspectorOwnedJsonOptions = Omit<LiveInspectorOptions, "source"> & Readonly<{
  value: JsonValue;
}>;

export type LiveInspectorOwnedHsonOptions = Omit<LiveInspectorOptions, "source"> & Readonly<{
  value: string;
}>;

export type LiveInspectorSelection = Readonly<{
  path: LivePath;
  role: LiveInspectorBranchRole;
  kind: LiveInspectorValueKind;
  key: LiveProjectionKey | undefined;
  arrayIdentity: LiveInspectorArrayIdentity | undefined;
  sourceRevision: number;
  sourceQuidContext: string;
  viewQuid: string;
  childCount: number;
  schema: string | undefined;
}>;

export type LiveInspectorDiagnostics = Readonly<{
  status: LiveInspectorStatus;
  sourceKind: LiveInspectorValueKind;
  sourceRevisionLastApplied: number;
  totalBranchCount: number;
  visibleBranchCount: number;
  materializedBranchCount: number;
  collapsedStructuralBranchCount: number;
  objectProjectors: number;
  arrayProjectors: number;
  primitiveUpdates: number;
  typeReplacements: number;
  recordsCreated: number;
  recordsReused: number;
  recordsMoved: number;
  recordsRemoved: number;
  sourceReplacements: number;
  preservedBranchesAfterReplacement: number;
  expansionChanges: number;
  selectionChanges: number;
  serializationRequests: number;
  serializationFailures: number;
  specializedRendererMatches: number;
  specializedRendererFailures: number;
  rendererHookFailures: number;
  delegatedListenerCount: number;
  projectionFailures: number;
  observerFailures: number;
  eagerlyMaterializedBranches: number;
  lazilyMaterializedBranches: number;
  branchesMaterializedAfterExpansion: number;
  materializationPasses: number;
  rowsMaterialized: number;
  batchAttachmentPasses: number;
  rowsBatchAttached: number;
  largestMaterialization: number;
  materializationDurationMs: number;
  observerNotifications: number;
  positionalArrayBranches: number;
  disposed: boolean;
  firstFailure: LiveInspectorError | undefined;
  lastNonFatalError: LiveInspectorError | undefined;
}>;

export type LiveInspectorMappingSummary = Readonly<{
  path: LivePath;
  applicationKey: LiveProjectionKey | undefined;
  sourceQuidContext: string;
  viewQuid: string;
  kind: LiveInspectorValueKind;
  role: LiveInspectorBranchRole;
  depth: number;
  expanded: boolean;
  selected: boolean;
  materialized: boolean;
  arrayIdentity: LiveInspectorArrayIdentity | undefined;
  specializationName: string | undefined;
}>;

export type LiveInspectorSnapshot = Readonly<{
  status: LiveInspectorStatus;
  sourcePath: LivePath;
  sourceRevisionLastApplied: number;
  selection: LiveInspectorSelection | undefined;
  failure: LiveInspectorError | undefined;
}>;

export type LiveInspectorListener = (snapshot: LiveInspectorSnapshot) => void;

export type LiveInspector = Readonly<{
  readonly root: LiveTree;
  readonly source: LiveInspectorSource;
  readonly status: LiveInspectorStatus;
  readonly sourcePath: LivePath;
  readonly sourceRevisionLastApplied: number;
  readonly selection: LiveInspectorSelection | undefined;
  readonly failure: LiveInspectorError | undefined;
  diagnostics: () => LiveInspectorDiagnostics;
  debugMappings: () => readonly LiveInspectorMappingSummary[];
  subscribe: (listener: LiveInspectorListener) => LiveMapDisposer;
  replaceSource: (source: LiveInspectorSource) => void;
  select: (path: LivePath) => LiveInspectorSelection;
  clearSelection: () => void;
  expand: (path: LivePath) => void;
  collapse: (path: LivePath) => void;
  toggle: (path: LivePath) => void;
  expandToDepth: (depth: number) => void;
  expandAll: (limit?: number) => void;
  collapseAll: () => void;
  serialize: (target: LiveInspectorSerializationTarget, path?: LivePath) => string;
  dispose: () => void;
}>; 
