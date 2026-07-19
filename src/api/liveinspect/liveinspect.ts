import type { HsonNode, JsonValue } from "../../core/types.js";
import type { LiveMapPathHandle, LivePath } from "../../types/livemap.types.js";
import type {
  LiveInspector,
  LiveInspectorArrayIdentity,
  LiveInspectorBranchRole,
  LiveInspectorDiagnostics,
  LiveInspectorHsonMode,
  LiveInspectorListener,
  LiveInspectorMappingSummary,
  LiveInspectorOptions,
  LiveInspectorReadHandle,
  LiveInspectorRendererResult,
  LiveInspectorSelection,
  LiveInspectorSemanticContext,
  LiveInspectorSemanticRenderer,
  LiveInspectorSerializationTarget,
  LiveInspectorSnapshot,
  LiveInspectorSource,
  LiveInspectorSpecialization,
  LiveInspectorStatus,
  LiveInspectorValueKind,
} from "../../types/liveinspect.types.js";
import type { LiveKeyedProjection, LiveProjectionChange, LiveProjectionKey } from "../../types/liveproject.types.js";
import { LiveTree } from "../livetree/livetree.js";
import { make_detached_livetree_create } from "../livetree/creation/make-detached-livetree.js";
import { own_disposable_for_owner } from "../livetree/managers/lifecycle-registry.js";
import { format_live_path, path_is_prefix, paths_overlap, relative_live_path } from "../livemap/livemap.path.js";
import { project_keyed_collection } from "../liveproject/liveproject.keyed.js";
import { LiveProjectionError, LIVE_PROJECTION_DUPLICATE_KEY_ERROR_CODE } from "../liveproject/liveproject.error.js";
import { construct_source_1 } from "../transform/constructors/construct-source-1.js";
import { record_livetree_materialization } from "../livetree/debug/materialization-profile.js";
import {
  LIVE_INSPECTOR_DISPOSED_ERROR_CODE,
  LIVE_INSPECTOR_DUPLICATE_ARRAY_KEY_ERROR_CODE,
  LIVE_INSPECTOR_EXPAND_LIMIT_ERROR_CODE,
  LIVE_INSPECTOR_INVALID_PATH_ERROR_CODE,
  LIVE_INSPECTOR_INVALID_ROOT_ERROR_CODE,
  LIVE_INSPECTOR_MISSING_ARRAY_KEY_ERROR_CODE,
  LIVE_INSPECTOR_NON_STRUCTURAL_EXPANSION_ERROR_CODE,
  LIVE_INSPECTOR_OBSERVER_ERROR_CODE,
  LIVE_INSPECTOR_PROJECTION_ERROR_CODE,
  LIVE_INSPECTOR_RENDERER_HOOK_ERROR_CODE,
  LIVE_INSPECTOR_SOURCE_REPLACEMENT_ERROR_CODE,
  LIVE_INSPECTOR_SPECIALIZATION_ERROR_CODE,
  LIVE_INSPECTOR_UNREPRESENTABLE_CONVERSION_ERROR_CODE,
  LIVE_INSPECTOR_UNSUPPORTED_SERIALIZATION_ERROR_CODE,
  LiveInspectorError,
} from "./liveinspect.error.js";
import {
  is_json_object,
  consume_inspector_pass_value,
  make_array_collection_handle,
  make_object_collection_handle,
  make_singleton_collection_handle,
  must_supported_json,
  normalize_inspector_source,
  type LiveInspectorSourceOrigin,
  type NormalizedInspectorSource,
} from "./liveinspect.source.js";

const CREATE = make_detached_livetree_create();
const TRANSFORM = construct_source_1({ unsafe: true });
const DEFAULT_INITIAL_DEPTH = 1;
const DEFAULT_LONG_STRING_LIMIT = 120;
const DEFAULT_EXPAND_ALL_LIMIT = 5_000;

type InspectorCreationContext = Readonly<{
  origin?: LiveInspectorSourceOrigin;
}>;

type MutableCounts = {
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
  projectionFailures: number;
  observerFailures: number;
  eagerlyMaterializedBranches: number;
  lazilyMaterializedBranches: number;
  branchesMaterializedAfterExpansion: number;
  materializationPasses: number;
  rowsMaterialized: number;
  largestMaterialization: number;
  materializationDurationMs: number;
  observerNotifications: number;
};

type AuxiliaryRenderer = Readonly<{
  name: string;
  tree: LiveTree;
  update: ((source: LiveInspectorReadHandle, context: LiveInspectorSemanticContext) => void) | undefined;
}>;

export function create_live_inspector(
  options: LiveInspectorOptions,
  creation: InspectorCreationContext = {},
): LiveInspector {
  return new InspectorController(options, creation).publicHandle();
}

class InspectorController {
  private sourceContext: NormalizedInspectorSource;
  private pendingSourceContext: NormalizedInspectorSource | undefined;
  private readonly suppliedHost: LiveTree;
  private readonly inspectorRoot: LiveTree;
  private readonly treeRegion: LiveTree;
  private readonly detailRegion: LiveTree;
  private rootProjection: LiveKeyedProjection<JsonValue>;
  private rootProjectionOff: (() => void) | undefined;
  private rootBranch: BranchController | undefined;
  private selected: BranchController | undefined;
  private readonly branchesById = new Map<string, BranchController>();
  private readonly branchesByPath = new Map<string, BranchController>();
  private readonly projectors = new Set<LiveKeyedProjection<JsonValue>>();
  private readonly listeners = new Set<LiveInspectorListener>();
  private readonly initialDepth: number;
  private readonly longStringLimit: number;
  private readonly expandAllLimit: number;
  private readonly arrayKey: LiveInspectorOptions["arrayKey"];
  private readonly showSchema: boolean;
  private readonly hsonMode: LiveInspectorHsonMode;
  private readonly specializations: readonly LiveInspectorSpecialization[];
  private readonly renderers: NonNullable<LiveInspectorOptions["renderers"]>;
  private activeChange: LiveProjectionChange | undefined;
  private currentStatus: LiveInspectorStatus = "initializing";
  private currentFailure: LiveInspectorError | undefined;
  private firstFailure: LiveInspectorError | undefined;
  private lastNonFatalError: LiveInspectorError | undefined;
  private suppressProjectionNotification = false;
  private initializing = true;
  private nextBranchId = 0;
  private absorbedProjectionCounts = { created: 0, reused: 0, moved: 0, removed: 0, batchPasses: 0, batchRows: 0 };
  private readonly counts: MutableCounts = {
    objectProjectors: 0,
    arrayProjectors: 0,
    primitiveUpdates: 0,
    typeReplacements: 0,
    recordsCreated: 0,
    recordsReused: 0,
    recordsMoved: 0,
    recordsRemoved: 0,
    sourceReplacements: 0,
    preservedBranchesAfterReplacement: 0,
    expansionChanges: 0,
    selectionChanges: 0,
    serializationRequests: 0,
    serializationFailures: 0,
    specializedRendererMatches: 0,
    specializedRendererFailures: 0,
    rendererHookFailures: 0,
    projectionFailures: 0,
    observerFailures: 0,
    eagerlyMaterializedBranches: 0,
    lazilyMaterializedBranches: 0,
    branchesMaterializedAfterExpansion: 0,
    materializationPasses: 0,
    rowsMaterialized: 0,
    largestMaterialization: 0,
    materializationDurationMs: 0,
    observerNotifications: 0,
  };

  public constructor(options: LiveInspectorOptions, creation: InspectorCreationContext) {
    this.sourceContext = normalize_inspector_source(options.source, creation.origin);
    this.suppliedHost = options.host;
    this.initialDepth = mustNonNegativeInteger(options.initialDepth ?? DEFAULT_INITIAL_DEPTH, "initialDepth");
    this.longStringLimit = mustPositiveInteger(options.longStringLimit ?? DEFAULT_LONG_STRING_LIMIT, "longStringLimit");
    this.expandAllLimit = mustPositiveInteger(options.expandAllLimit ?? DEFAULT_EXPAND_ALL_LIMIT, "expandAllLimit");
    this.arrayKey = options.arrayKey;
    this.showSchema = options.showSchema ?? true;
    this.hsonMode = options.hsonMode ?? "friendly";
    this.renderers = options.renderers ?? {};
    this.specializations = Object.freeze(
      (options.specializations ?? [])
        .map((entry, index) => ({ entry, index }))
        .sort((left, right) => (right.entry.priority ?? 0) - (left.entry.priority ?? 0) || left.index - right.index)
        .map(({ entry }) => entry),
    );

    if (this.suppliedHost.isDisposed || this.suppliedHost.content.count() !== 0) {
      throw new LiveInspectorError(
        LIVE_INSPECTOR_INVALID_ROOT_ERROR_CODE,
        "Live inspector requires one active dedicated empty LiveTree host.",
      );
    }
    this.preflight(this.sourceContext.handle.snap(), this.sourceContext.handle.path());

    this.inspectorRoot = CREATE.section();
    this.inspectorRoot.attr.setMany({
      "data-hson-inspect-kind": "inspector",
      "aria-label": "Structured data inspector",
    });
    this.treeRegion = this.inspectorRoot.create.div();
    this.treeRegion.attr.setMany({
      "data-hson-inspect-region": "tree",
      role: "tree",
      "aria-label": "Structured data",
    });
    this.detailRegion = this.inspectorRoot.create.aside();
    this.detailRegion.attr.setMany({
      "data-hson-inspect-region": "details",
      "aria-label": "Selected value details",
      "aria-live": "polite",
    });

    try {
      this.suppliedHost.append(this.inspectorRoot);
      this.installStyles();
      this.installDelegatedInteraction();
      const rootStarted = materializationNow();
      this.rootProjection = this.registerProjector(project_keyed_collection<JsonValue>({
        source: make_singleton_collection_handle(this.sourceContext.handle, true),
        host: this.treeRegion,
        key: () => "__hson_inspector_root__",
        render: (source, context) => this.renderBranch(source, {
          role: "root",
          key: undefined,
          depth: 0,
          parent: undefined,
          own: context.own,
        }),
      }));
      this.recordMaterialization(this.rootProjection, rootStarted);
      this.rootProjectionOff = this.rootProjection.subscribe(() => this.onRootProjectionChange());
      own_disposable_for_owner(this.inspectorRoot.quid, () => this.dispose(), "other");
      this.currentStatus = "ready";
      this.initializing = false;
      this.renderDetails();
    } catch (error) {
      this.currentStatus = "failed";
      if (!this.inspectorRoot.isDisposed) this.inspectorRoot.remove();
      throw this.translateProjectionError(error, "Initial live inspector projection failed.");
    }
  }

  public publicHandle(): LiveInspector {
    const self = this;
    return Object.freeze({
      get root() { return self.inspectorRoot; },
      get source() { return self.sourceContext.map ?? self.sourceContext.handle; },
      get status() { return self.currentStatus; },
      get sourcePath() { return Object.freeze([...self.currentSource().handle.path()]); },
      get sourceRevisionLastApplied() { return self.sourceRevision(); },
      get selection() { return self.selectionSnapshot(); },
      get failure() { return self.currentFailure; },
      diagnostics: () => self.diagnostics(),
      debugMappings: () => self.debugMappings(),
      subscribe: (listener) => self.subscribe(listener),
      replaceSource: (source) => self.replaceSource(source),
      select: (path) => self.select(path),
      clearSelection: () => self.clearSelection(),
      expand: (path) => self.expand(path),
      collapse: (path) => self.collapse(path),
      toggle: (path) => self.toggle(path),
      expandToDepth: (depth) => self.expandToDepth(depth),
      expandAll: (limit) => self.expandAll(limit),
      collapseAll: () => self.collapseAll(),
      serialize: (target, path) => self.serialize(target, path),
      dispose: () => self.dispose(),
    });
  }

  private currentSource(): NormalizedInspectorSource {
    return this.pendingSourceContext ?? this.sourceContext;
  }

  private renderBranch(
    source: LiveMapPathHandle<JsonValue>,
    input: Readonly<{
      role: LiveInspectorBranchRole;
      key: LiveProjectionKey | undefined;
      depth: number;
      parent: BranchController | undefined;
      own: (cleanup: () => void) => () => void;
    }>,
  ): LiveInspectorRendererResultForProjection {
    const started = materializationNow();
    let branch: BranchController | undefined;
    try {
      branch = new BranchController(this, source, input.role, input.key, input.depth, input.parent);
      input.own(() => branch?.dispose());
      if (input.role === "root") this.rootBranch = branch;
      return {
        tree: branch.tree,
        update: (next, change) => this.withChange(change, () => {
          try {
            branch?.refresh(next as LiveMapPathHandle<JsonValue>);
          } catch (error) {
            this.failProjection(error);
            throw error;
          }
        }),
      };
    } catch (error) {
      branch?.dispose();
      throw error;
    } finally {
      record_livetree_materialization("inspectorBranchConstructionMs", materializationNow() - started);
    }
  }

  public createChildProjector(branch: BranchController): LiveKeyedProjection<JsonValue> {
    const value = branch.source.snap();
    if (is_json_object(value)) {
      this.counts.objectProjectors += 1;
      const started = materializationNow();
      const projector = this.registerProjector(project_keyed_collection<JsonValue>({
        source: make_object_collection_handle(branch.source),
        host: branch.childrenRegion,
        key: (_item, context) => {
          const key = context.path.at(-1);
          if (typeof key !== "string") {
            throw new LiveInspectorError(LIVE_INSPECTOR_PROJECTION_ERROR_CODE, "Object property projection lost its string key.");
          }
          return key;
        },
        render: (source, context) => this.renderBranch(source, {
          role: "object-property",
          key: context.key,
          depth: branch.depth + 1,
          parent: branch,
          own: context.own,
        }),
      }));
      this.recordMaterialization(projector, started);
      return projector;
    }
    if (Array.isArray(value)) {
      this.counts.arrayProjectors += 1;
      branch.arrayIdentity = this.arrayIdentity(value, branch.source.path());
      const started = materializationNow();
      const projector = this.registerProjector(project_keyed_collection<JsonValue>({
        source: make_array_collection_handle(branch.source),
        host: branch.childrenRegion,
        key: (item, context) => this.arrayItemKey(item, branch, context.ordinal, context.path),
        render: (source, context) => this.renderBranch(source, {
          role: "array-item",
          key: context.key,
          depth: branch.depth + 1,
          parent: branch,
          own: context.own,
        }),
      }));
      this.recordMaterialization(projector, started);
      return projector;
    }
    throw new LiveInspectorError(
      LIVE_INSPECTOR_NON_STRUCTURAL_EXPANSION_ERROR_CODE,
      `Cannot materialize children for ${kindOf(value)}.`,
    );
  }

  public replaceChildProjector(branch: BranchController, projector: LiveKeyedProjection<JsonValue>): void {
    const value = branch.source.snap();
    if (is_json_object(value)) {
      projector.replaceSource(make_object_collection_handle(branch.source));
      return;
    }
    if (Array.isArray(value)) {
      branch.arrayIdentity = this.arrayIdentity(value, branch.source.path());
      projector.replaceSource(make_array_collection_handle(branch.source));
      return;
    }
  }

  public unregisterProjector(projector: LiveKeyedProjection<JsonValue>): void {
    if (!this.projectors.delete(projector)) return;
    const diagnostics = projector.diagnostics();
    this.absorbedProjectionCounts.created += diagnostics.recordsCreated;
    this.absorbedProjectionCounts.reused += diagnostics.recordsReused;
    this.absorbedProjectionCounts.moved += diagnostics.recordsMoved;
    this.absorbedProjectionCounts.removed += diagnostics.recordsRemoved;
    this.absorbedProjectionCounts.batchPasses += diagnostics.batchAttachmentPasses;
    this.absorbedProjectionCounts.batchRows += diagnostics.recordsBatchAttached;
  }

  private recordMaterialization(projector: LiveKeyedProjection<JsonValue>, started: number): void {
    this.counts.materializationPasses += 1;
    this.counts.rowsMaterialized += projector.itemCount;
    this.counts.largestMaterialization = Math.max(this.counts.largestMaterialization, projector.itemCount);
    this.counts.materializationDurationMs += materializationNow() - started;
  }

  public disposeProjector(projector: LiveKeyedProjection<JsonValue>): void {
    projector.dispose();
    this.unregisterProjector(projector);
  }

  private registerProjector(projector: LiveKeyedProjection<JsonValue>): LiveKeyedProjection<JsonValue> {
    this.projectors.add(projector);
    return projector;
  }

  public arrayIdentity(value: readonly JsonValue[], arrayPath: LivePath): LiveInspectorArrayIdentity {
    if (this.arrayKey === undefined || value.length === 0) return "positional";
    let explicit = 0;
    for (let index = 0; index < value.length; index += 1) {
      const key = this.arrayKey(value[index] as JsonValue, {
        arrayPath: Object.freeze([...arrayPath]),
        itemPath: Object.freeze([...arrayPath, index]),
        index,
      });
      if (key !== undefined) explicit += 1;
    }
    if (explicit === 0) return "positional";
    if (explicit !== value.length) {
      throw new LiveInspectorError(
        LIVE_INSPECTOR_MISSING_ARRAY_KEY_ERROR_CODE,
        `Array key resolver returned a key for only ${explicit} of ${value.length} items at ${format_live_path(arrayPath)}.`,
      );
    }
    return "application-key";
  }

  private arrayItemKey(
    item: JsonValue,
    branch: BranchController,
    index: number,
    itemPath: LivePath,
  ): LiveProjectionKey {
    if (branch.arrayIdentity !== "application-key") return index;
    const key = this.arrayKey?.(item, {
      arrayPath: Object.freeze([...branch.source.path()]),
      itemPath: Object.freeze([...itemPath]),
      index,
    });
    if (key === undefined || (typeof key !== "string" && typeof key !== "number")) {
      throw new LiveInspectorError(
        LIVE_INSPECTOR_MISSING_ARRAY_KEY_ERROR_CODE,
        `Array item ${index} has no valid application key at ${format_live_path(branch.source.path())}.`,
      );
    }
    return key;
  }

  public shouldRefresh(path: LivePath): boolean {
    const ops = this.activeChange?.commit?.ops;
    if (ops === undefined) return true;
    return ops.some((op) => paths_overlap(path, op.path));
  }

  private withChange<T>(change: LiveProjectionChange, run: () => T): T {
    const previous = this.activeChange;
    if (previous === undefined) this.activeChange = change;
    try { return run(); }
    finally { this.activeChange = previous; }
  }

  public registerBranch(branch: BranchController): string {
    this.nextBranchId += 1;
    const id = `hson-inspect-${this.nextBranchId}`;
    this.branchesById.set(id, branch);
    this.branchesByPath.set(pathKey(branch.path), branch);
    if (this.initializing) this.counts.eagerlyMaterializedBranches += 1;
    else this.counts.lazilyMaterializedBranches += 1;
    return id;
  }

  public updateBranchPath(branch: BranchController, previous: LivePath, next: LivePath): void {
    if (pathKey(previous) === pathKey(next)) return;
    if (this.branchesByPath.get(pathKey(previous)) === branch) this.branchesByPath.delete(pathKey(previous));
    this.branchesByPath.set(pathKey(next), branch);
  }

  public unregisterBranch(branch: BranchController): void {
    this.branchesById.delete(branch.id);
    if (this.branchesByPath.get(pathKey(branch.path)) === branch) this.branchesByPath.delete(pathKey(branch.path));
    if (this.selected !== branch || this.currentStatus === "disposed") return;
    const parent = branch.parent;
    if (parent !== undefined && !parent.disposed) this.selectBranch(parent, true);
    else this.clearSelection();
  }

  public branchMaterializedAfterExpansion(count: number): void {
    this.counts.branchesMaterializedAfterExpansion += count;
  }

  public expansionChanged(): void {
    this.counts.expansionChanges += 1;
  }

  public primitiveUpdated(): void {
    this.counts.primitiveUpdates += 1;
  }

  public typeReplaced(): void {
    this.counts.typeReplacements += 1;
  }

  public initialExpansionDepth(): number { return this.initialDepth; }
  public previewStringLimit(): number { return this.longStringLimit; }
  public branchCount(): number { return this.branchesById.size; }
  public childBranches(parent: BranchController): BranchController[] {
    return [...this.branchesById.values()].filter((branch) => branch.parent === parent);
  }
  public isSelected(branch: BranchController): boolean { return this.selected === branch; }

  public effectiveSchemaSummary(path: LivePath): string | undefined {
    if (!this.showSchema) return undefined;
    const map = this.currentSource().map;
    if (map === undefined) return undefined;
    const resolution = map.schema.resolve(path);
    if (resolution === undefined) return undefined;
    const rule = resolution.rule;
    const facets = [
      rule.kind,
      rule.optional ? "optional" : "required",
      rule.nullable ? "nullable" : undefined,
      rule.readonly ? "read-only" : undefined,
      rule.exact ? "exact" : undefined,
      rule.literals?.length ? `choices: ${rule.literals.map((value) => JSON.stringify(value)).join(" | ")}` : undefined,
    ].filter((value): value is string => value !== undefined);
    const schema = map.schema.get();
    const valid = schema?.validateValue(path, map.snap(path)).ok;
    if (valid !== undefined) facets.push(valid ? "valid" : "invalid");
    return facets.join(" · ");
  }

  public semanticContext(branch: BranchController): LiveInspectorSemanticContext {
    return Object.freeze({
      source: readonlyHandle(branch.source),
      path: Object.freeze([...branch.path]),
      depth: branch.depth,
      role: branch.role,
      kind: branch.kind,
      key: branch.key,
      arrayIdentity: branch.arrayIdentity,
    });
  }

  public selectAuxiliaryRenderer(branch: BranchController, value: JsonValue): Readonly<{
    name: string;
    renderer: LiveInspectorSemanticRenderer;
    category: "specialization" | "hook";
  }> | undefined {
    const context = this.semanticContext(branch);
    for (const specialization of this.specializations) {
      record_livetree_materialization("specializationMatchCalls");
      try {
        if (specialization.match(value, context)) {
          this.counts.specializedRendererMatches += 1;
          return { name: specialization.name, renderer: specialization.render, category: "specialization" };
        }
      } catch (error) {
        this.recordAuxiliaryFailure("specialization", specialization.name, error);
      }
    }
    const renderer = branch.isPrimitive
      ? this.renderers.primitive
      : branch.childCount === 0
      ? this.renderers.empty
      : branch.kind === "object"
      ? this.renderers.objectSummary
      : this.renderers.arraySummary;
    if (renderer !== undefined) record_livetree_materialization("rendererHookInvocations");
    return renderer === undefined ? undefined : { name: `hook:${branch.kind}`, renderer, category: "hook" };
  }

  public recordAuxiliaryFailure(category: "specialization" | "hook", name: string, error: unknown): void {
    const failure = new LiveInspectorError(
      category === "specialization" ? LIVE_INSPECTOR_SPECIALIZATION_ERROR_CODE : LIVE_INSPECTOR_RENDERER_HOOK_ERROR_CODE,
      `${category === "specialization" ? "Specialized renderer" : "Renderer hook"} ${JSON.stringify(name)} failed; neutral rendering remains active.`,
      error,
    );
    if (category === "specialization") this.counts.specializedRendererFailures += 1;
    else this.counts.rendererHookFailures += 1;
    this.lastNonFatalError = failure;
  }

  private installDelegatedInteraction(): void {
    record_livetree_materialization("inspectorRootListeners");
    this.inspectorRoot.listen.onClick((event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const actionElement = target.closest<HTMLElement>("[data-hson-inspect-action]");
      if (actionElement === null || !this.inspectorRoot.dom.contains.node(actionElement)) return;
      const id = actionElement.getAttribute("data-hson-inspect-branch");
      const branch = id === null ? undefined : this.branchesById.get(id);
      if (branch === undefined) return;
      const action = actionElement.getAttribute("data-hson-inspect-action");
      if (action === "toggle") branch.toggle();
      else if (action === "select") this.selectBranch(branch, false);
    });
  }

  private installStyles(): void {
    this.inspectorRoot.css.setMany({
      color: "var(--hson-inspect-fg, #24272d)",
      backgroundColor: "var(--hson-inspect-bg, transparent)",
      fontFamily: "var(--hson-inspect-font, ui-monospace, SFMono-Regular, Menlo, monospace)",
      fontSize: "var(--hson-inspect-size, 13px)",
      lineHeight: "1.45",
    });
    const rule = (selector: string, declarations: Record<string, string>) => {
      record_livetree_materialization("inspectorCssRuleSets");
      this.inspectorRoot.css.selector(`& ${selector}`).setMany(declarations);
    };
    rule("[data-hson-inspect-line]", { display: "flex", alignItems: "baseline", gap: "0.5rem", minHeight: "1.5rem" });
    rule("[data-hson-inspect-children]", { paddingLeft: "1.25rem" });
    rule("[data-hson-inspect-action]", { font: "inherit", color: "inherit", background: "transparent", border: "0", padding: "0.1rem 0.2rem", textAlign: "left" });
    rule("[data-hson-inspect-action=toggle]", { width: "1.25rem", cursor: "pointer" });
    rule("[data-hson-inspect-action=select]", { cursor: "pointer", fontWeight: "600" });
    rule("[data-hson-inspect-type]", { color: "var(--hson-inspect-type, #69707d)", fontSize: "0.85em" });
    rule("[data-hson-inspect-value]", { whiteSpace: "pre-wrap", overflowWrap: "anywhere" });
    rule("[aria-selected=true] > [data-hson-inspect-line]", { outline: "1px solid currentColor", outlineOffset: "1px" });
    rule("[data-hson-inspect-region=details]", { marginTop: "0.75rem", paddingTop: "0.5rem", borderTop: "1px solid color-mix(in srgb, currentColor 25%, transparent)" });
    rule("[data-hson-inspect-detail-row]", { display: "grid", gridTemplateColumns: "minmax(8rem, auto) 1fr", gap: "0.5rem" });
    rule("[data-hson-inspect-detail-label]", { color: "var(--hson-inspect-type, #69707d)" });
  }

  private onRootProjectionChange(): void {
    if (this.suppressProjectionNotification || this.currentStatus === "disposed") return;
    if (this.rootProjection.status === "failed") {
      this.failProjection(this.rootProjection.failure);
    } else if (this.currentStatus !== "failed") {
      this.currentStatus = "ready";
    }
    if (this.selected !== undefined) this.renderDetails();
    this.notify();
  }

  private replaceSource(source: LiveInspectorSource): void {
    this.assertUsable("replace source");
    const next = normalize_inspector_source(source);
    try {
      this.preflight(next.handle.snap(), next.handle.path());
    } catch (error) {
      throw new LiveInspectorError(
        LIVE_INSPECTOR_SOURCE_REPLACEMENT_ERROR_CODE,
        "Live inspector source replacement failed validation; the prior source remains active.",
        error,
      );
    }
    const before = new Set([...this.branchesById.values()].map((branch) => branch.viewQuid));
    this.currentStatus = "replacing";
    this.pendingSourceContext = next;
    this.suppressProjectionNotification = true;
    try {
      this.rootProjection.replaceSource(make_singleton_collection_handle(next.handle, true));
      this.sourceContext = next;
      this.pendingSourceContext = undefined;
      this.currentFailure = undefined;
      this.currentStatus = "ready";
      this.counts.sourceReplacements += 1;
      this.counts.preservedBranchesAfterReplacement += [...this.branchesById.values()]
        .filter((branch) => before.has(branch.viewQuid)).length;
      this.renderDetails();
    } catch (error) {
      this.pendingSourceContext = undefined;
      if (this.rootProjection.status === "failed") this.failProjection(error);
      else this.currentStatus = "ready";
      throw new LiveInspectorError(
        LIVE_INSPECTOR_SOURCE_REPLACEMENT_ERROR_CODE,
        "Live inspector source replacement failed; the prior source remains active where projection coherence permits.",
        error,
      );
    } finally {
      this.suppressProjectionNotification = false;
    }
    this.notify();
  }

  private preflight(value: unknown, path: LivePath): void {
    must_supported_json(value);
    const visit = (item: JsonValue, itemPath: LivePath): void => {
      if (Array.isArray(item)) {
        const identity = this.arrayIdentity(item, itemPath);
        if (identity === "application-key") {
          const keys = new Set<LiveProjectionKey>();
          for (let index = 0; index < item.length; index += 1) {
            const key = this.arrayKey?.(item[index] as JsonValue, {
              arrayPath: itemPath,
              itemPath: [...itemPath, index],
              index,
            });
            if (key === undefined) throw new LiveInspectorError(LIVE_INSPECTOR_MISSING_ARRAY_KEY_ERROR_CODE, `Missing array key at ${format_live_path([...itemPath, index])}.`);
            if (keys.has(key)) {
              throw new LiveInspectorError(
                LIVE_INSPECTOR_DUPLICATE_ARRAY_KEY_ERROR_CODE,
                `Duplicate array key ${JSON.stringify(key)} at ${format_live_path(itemPath)}.`,
              );
            }
            keys.add(key);
            visit(item[index] as JsonValue, [...itemPath, index]);
          }
        } else {
          item.forEach((child, index) => visit(child, [...itemPath, index]));
        }
        return;
      }
      if (is_json_object(item)) {
        for (const [key, child] of Object.entries(item)) visit(child, [...itemPath, key]);
      }
    };
    visit(value as JsonValue, path);
  }

  private select(path: LivePath): LiveInspectorSelection {
    this.assertUsable("select");
    const branch = this.resolveBranch(path, true);
    this.selectBranch(branch, false);
    return this.selectionSnapshot() as LiveInspectorSelection;
  }

  private selectBranch(branch: BranchController, fromRemoval: boolean): void {
    if (this.selected === branch) {
      this.renderDetails();
      return;
    }
    this.selected?.setSelected(false);
    this.selected = branch;
    branch.setSelected(true);
    this.counts.selectionChanges += 1;
    this.renderDetails();
    if (fromRemoval) branch.focusSelectionControl();
    this.notify();
  }

  private clearSelection(): void {
    if (this.selected === undefined) return;
    this.selected.setSelected(false);
    this.selected = undefined;
    this.counts.selectionChanges += 1;
    this.renderDetails();
    this.notify();
  }

  private expand(path: LivePath): void {
    this.assertUsable("expand");
    this.resolveBranch(path, true).expand();
  }

  private collapse(path: LivePath): void {
    this.assertUsable("collapse");
    this.resolveBranch(path, true).collapse();
  }

  private toggle(path: LivePath): void {
    this.assertUsable("toggle");
    this.resolveBranch(path, true).toggle();
  }

  private resolveBranch(path: LivePath, materialize: boolean): BranchController {
    const exact = this.branchesByPath.get(pathKey(path));
    if (exact !== undefined) return exact;
    const root = this.rootBranch;
    if (!materialize || root === undefined || !path_is_prefix(root.path, path)) throw invalidPath(path);
    let current = root;
    for (let length = root.path.length + 1; length <= path.length; length += 1) {
      current.expand();
      const next = this.branchesByPath.get(pathKey(path.slice(0, length)));
      if (next === undefined) throw invalidPath(path);
      current = next;
    }
    return current;
  }

  private expandToDepth(depth: number): void {
    this.assertUsable("expand to depth");
    const target = mustNonNegativeInteger(depth, "depth");
    const queue = this.rootBranch === undefined ? [] : [this.rootBranch];
    while (queue.length > 0) {
      const branch = queue.shift() as BranchController;
      if (branch.depth < target && branch.isStructural) branch.expand();
      queue.push(...branch.children());
    }
  }

  private expandAll(limit: number = this.expandAllLimit): void {
    this.assertUsable("expand all");
    const bounded = mustPositiveInteger(limit, "expand all limit");
    const required = countValueBranches(this.currentSource().handle.snap());
    if (required > bounded) {
      throw new LiveInspectorError(
        LIVE_INSPECTOR_EXPAND_LIMIT_ERROR_CODE,
        `Expanding ${required} branches exceeds the configured limit of ${bounded}.`,
      );
    }
    const queue = this.rootBranch === undefined ? [] : [this.rootBranch];
    while (queue.length > 0) {
      const branch = queue.shift() as BranchController;
      if (branch.isStructural) branch.expand();
      queue.push(...branch.children());
    }
  }

  private collapseAll(): void {
    this.assertUsable("collapse all");
    const branches = [...this.branchesById.values()].sort((left, right) => right.depth - left.depth);
    for (const branch of branches) if (branch.isStructural) branch.collapse();
  }

  private serialize(target: LiveInspectorSerializationTarget, path?: LivePath): string {
    this.assertUsable("serialize");
    this.counts.serializationRequests += 1;
    try {
      if (!["json", "hson", "html", "canonical-node"].includes(target)) {
        throw new LiveInspectorError(LIVE_INSPECTOR_UNSUPPORTED_SERIALIZATION_ERROR_CODE, `Unsupported inspector serialization target ${JSON.stringify(target)}.`);
      }
      const handle = this.handleAt(path ?? this.selected?.path ?? this.currentSource().handle.path());
      const value = handle.snap();
      must_supported_json(value);
      if (target === "json") return TRANSFORM.fromJson(value).toJson().serialize();
      if (target === "hson") return TRANSFORM.fromJson(value).toHson().serialize();
      const node = this.canonicalNode(handle.path());
      if (target === "canonical-node") {
        if (node === undefined) throw unrepresentable(target, handle.path());
        return JSON.stringify(node, null, 2);
      }
      if (node === undefined || this.currentSource().origin !== "hson" || !containsConcreteElement(node)) {
        throw unrepresentable(target, handle.path());
      }
      return TRANSFORM.fromNode(node).toHtml().serialize();
    } catch (error) {
      this.counts.serializationFailures += 1;
      if (error instanceof LiveInspectorError) throw error;
      throw new LiveInspectorError(LIVE_INSPECTOR_UNREPRESENTABLE_CONVERSION_ERROR_CODE, "Inspector serialization failed.", error);
    }
  }

  private handleAt(path: LivePath): LiveMapPathHandle {
    const root = this.currentSource().handle;
    const relative = relative_live_path(root.path(), path);
    if (relative === undefined) throw invalidPath(path);
    return relative.length === 0 ? root : root.at(relative);
  }

  private canonicalNode(path: LivePath): HsonNode | undefined {
    return this.currentSource().map?.debug.node(path).get();
  }

  private renderDetails(): void {
    if (this.detailRegion.isDisposed) return;
    this.detailRegion.empty();
    const selected = this.selected;
    if (selected === undefined) {
      const empty = this.detailRegion.create.p();
      empty.text.set("Select a branch to inspect path, type, schema, revision, and identity context.");
      return;
    }
    const heading = this.detailRegion.create.h3();
    heading.text.set(`Selected ${selected.role}`);
    const values: Array<readonly [string, string]> = [
      ["Path", format_live_path(selected.path)],
      ["Kind", selected.kind],
      ["Key / index", selected.key === undefined ? "—" : JSON.stringify(selected.key)],
      ["Array identity", selected.arrayIdentity ?? "—"],
      ["Revision", String(selected.source.rev)],
      ["Current path-handle QUID context", selected.source.quid],
      ["View QUID", selected.viewQuid],
      ["Child count", String(selected.childCount)],
      ["Schema", this.effectiveSchemaSummary(selected.path) ?? "unavailable"],
    ];
    for (const [label, value] of values) this.addDetailRow(label, value);
    const node = this.canonicalNode(selected.path);
    if (node !== undefined && this.hsonMode !== "none") {
      if (this.hsonMode === "friendly") {
        this.addDetailRow("HSON tag", node.$_tag);
        this.addDetailRow("HSON attributes", String(Object.keys(node.$_attrs ?? {}).length));
        this.addDetailRow("HSON ordered content", String(node.$_content.length));
        this.addDetailRow("Canonical VSN role", node.$_tag.startsWith("_hson_") ? node.$_tag : "element/tag");
      } else {
        const pre = this.detailRegion.create.pre();
        pre.attr.set("data-hson-inspect-canonical", "true");
        pre.text.set(JSON.stringify(node, null, 2));
      }
    }
  }

  private addDetailRow(label: string, value: string): void {
    const row = this.detailRegion.create.div();
    row.attr.set("data-hson-inspect-detail-row", "true");
    const term = row.create.span();
    term.attr.set("data-hson-inspect-detail-label", "true");
    term.text.set(label);
    const description = row.create.code();
    description.text.set(value);
  }

  private selectionSnapshot(): LiveInspectorSelection | undefined {
    const branch = this.selected;
    if (branch === undefined || branch.disposed) return undefined;
    return Object.freeze({
      path: Object.freeze([...branch.path]),
      role: branch.role,
      kind: branch.kind,
      key: branch.key,
      arrayIdentity: branch.arrayIdentity,
      sourceRevision: branch.source.rev,
      sourceQuidContext: branch.source.quid,
      viewQuid: branch.viewQuid,
      childCount: branch.childCount,
      schema: this.effectiveSchemaSummary(branch.path),
    });
  }

  private sourceRevision(): number {
    return this.rootProjection?.sourceRevisionLastApplied ?? this.currentSource().handle.rev;
  }

  private diagnostics(): LiveInspectorDiagnostics {
    const projection = this.sumProjectionDiagnostics();
    const branches = [...this.branchesById.values()];
    const rootKind = kindOf(this.currentSource().handle.snap());
    return Object.freeze({
      status: this.currentStatus,
      sourceKind: rootKind,
      sourceRevisionLastApplied: this.sourceRevision(),
      totalBranchCount: branches.length,
      visibleBranchCount: branches.filter((branch) => branch.visible).length,
      materializedBranchCount: branches.length,
      collapsedStructuralBranchCount: branches.filter((branch) => branch.isStructural && !branch.expanded).length,
      objectProjectors: this.counts.objectProjectors,
      arrayProjectors: this.counts.arrayProjectors,
      primitiveUpdates: this.counts.primitiveUpdates,
      typeReplacements: this.counts.typeReplacements,
      recordsCreated: projection.created,
      recordsReused: projection.reused,
      recordsMoved: projection.moved,
      recordsRemoved: projection.removed,
      sourceReplacements: this.counts.sourceReplacements,
      preservedBranchesAfterReplacement: this.counts.preservedBranchesAfterReplacement,
      expansionChanges: this.counts.expansionChanges,
      selectionChanges: this.counts.selectionChanges,
      serializationRequests: this.counts.serializationRequests,
      serializationFailures: this.counts.serializationFailures,
      specializedRendererMatches: this.counts.specializedRendererMatches,
      specializedRendererFailures: this.counts.specializedRendererFailures,
      rendererHookFailures: this.counts.rendererHookFailures,
      delegatedListenerCount: this.currentStatus === "disposed" ? 0 : 1,
      projectionFailures: this.counts.projectionFailures,
      observerFailures: this.counts.observerFailures,
      eagerlyMaterializedBranches: this.counts.eagerlyMaterializedBranches,
      lazilyMaterializedBranches: this.counts.lazilyMaterializedBranches,
      branchesMaterializedAfterExpansion: this.counts.branchesMaterializedAfterExpansion,
      materializationPasses: this.counts.materializationPasses,
      rowsMaterialized: this.counts.rowsMaterialized,
      batchAttachmentPasses: projection.batchPasses,
      rowsBatchAttached: projection.batchRows,
      largestMaterialization: this.counts.largestMaterialization,
      materializationDurationMs: this.counts.materializationDurationMs,
      observerNotifications: this.counts.observerNotifications,
      positionalArrayBranches: branches.filter((branch) => branch.arrayIdentity === "positional").length,
      disposed: this.currentStatus === "disposed",
      firstFailure: this.firstFailure,
      lastNonFatalError: this.lastNonFatalError,
    });
  }

  private sumProjectionDiagnostics(): Readonly<{ created: number; reused: number; moved: number; removed: number; batchPasses: number; batchRows: number }> {
    let created = this.absorbedProjectionCounts.created;
    let reused = this.absorbedProjectionCounts.reused;
    let moved = this.absorbedProjectionCounts.moved;
    let removed = this.absorbedProjectionCounts.removed;
    let batchPasses = this.absorbedProjectionCounts.batchPasses;
    let batchRows = this.absorbedProjectionCounts.batchRows;
    for (const projector of this.projectors) {
      const diagnostics = projector.diagnostics();
      created += diagnostics.recordsCreated;
      reused += diagnostics.recordsReused;
      moved += diagnostics.recordsMoved;
      removed += diagnostics.recordsRemoved;
      batchPasses += diagnostics.batchAttachmentPasses;
      batchRows += diagnostics.recordsBatchAttached;
    }
    return { created, reused, moved, removed, batchPasses, batchRows };
  }

  private debugMappings(): readonly LiveInspectorMappingSummary[] {
    this.assertUsable("inspect mappings");
    return Object.freeze([...this.branchesById.values()]
      .sort(compareBranchPath)
      .map((branch) => Object.freeze({
        path: Object.freeze([...branch.path]),
        applicationKey: branch.key,
        sourceQuidContext: branch.source.quid,
        viewQuid: branch.viewQuid,
        kind: branch.kind,
        role: branch.role,
        depth: branch.depth,
        expanded: branch.expanded,
        selected: this.selected === branch,
        materialized: branch.materialized,
        arrayIdentity: branch.arrayIdentity,
        specializationName: branch.specializationName,
      })));
  }

  private snapshot(): LiveInspectorSnapshot {
    return Object.freeze({
      status: this.currentStatus,
      sourcePath: Object.freeze([...this.currentSource().handle.path()]),
      sourceRevisionLastApplied: this.sourceRevision(),
      selection: this.selectionSnapshot(),
      failure: this.currentFailure,
    });
  }

  private subscribe(listener: LiveInspectorListener): () => void {
    this.assertUsable("subscribe");
    if (typeof listener !== "function") throw new TypeError("Live inspector listener must be a function.");
    this.listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    if (this.currentStatus === "disposed") return;
    this.counts.observerNotifications += 1;
    const snapshot = this.snapshot();
    for (const listener of [...this.listeners]) {
      try { listener(snapshot); }
      catch (error) {
        this.counts.observerFailures += 1;
        this.lastNonFatalError = new LiveInspectorError(
          LIVE_INSPECTOR_OBSERVER_ERROR_CODE,
          "A live inspector observer failed; inspector state remains active.",
          error,
        );
      }
    }
  }

  private failProjection(error: unknown): void {
    const failure = this.translateProjectionError(error, "Live inspector projection failed.");
    this.counts.projectionFailures += 1;
    this.firstFailure ??= failure;
    this.currentFailure ??= failure;
    this.currentStatus = "failed";
  }

  private translateProjectionError(error: unknown, message: string): LiveInspectorError {
    if (error instanceof LiveInspectorError) return error;
    if (hasProjectionCode(error, LIVE_PROJECTION_DUPLICATE_KEY_ERROR_CODE)) {
      return new LiveInspectorError(LIVE_INSPECTOR_DUPLICATE_ARRAY_KEY_ERROR_CODE, "Live inspector array contains duplicate application keys.", error);
    }
    return new LiveInspectorError(LIVE_INSPECTOR_PROJECTION_ERROR_CODE, message, error);
  }

  private dispose(): void {
    if (this.currentStatus === "disposed") return;
    this.currentStatus = "disposed";
    this.rootProjectionOff?.();
    this.rootProjectionOff = undefined;
    if (this.rootProjection !== undefined) this.disposeProjector(this.rootProjection);
    for (const projector of [...this.projectors]) {
      this.disposeProjector(projector);
    }
    this.projectors.clear();
    this.selected = undefined;
    this.branchesById.clear();
    this.branchesByPath.clear();
    this.listeners.clear();
    if (!this.inspectorRoot.isDisposed) this.inspectorRoot.remove();
  }

  private assertUsable(operation: string): void {
    if (this.currentStatus !== "disposed") return;
    throw new LiveInspectorError(LIVE_INSPECTOR_DISPOSED_ERROR_CODE, `Live inspector is disposed; cannot ${operation}.`);
  }
}

type LiveInspectorRendererResultForProjection = Readonly<{
  tree: LiveTree;
  update: (source: LiveMapPathHandle<JsonValue>, change: LiveProjectionChange) => void;
}>;

class BranchController {
  public readonly tree: LiveTree;
  public readonly childrenRegion: LiveTree;
  public readonly role: LiveInspectorBranchRole;
  public readonly key: LiveProjectionKey | undefined;
  public readonly depth: number;
  public readonly parent: BranchController | undefined;
  public readonly id: string;
  public source: LiveMapPathHandle<JsonValue>;
  public path: LivePath;
  public kind: LiveInspectorValueKind;
  public arrayIdentity: LiveInspectorArrayIdentity | undefined;
  public expanded = false;
  public materialized = false;
  public disposed = false;
  public specializationName: string | undefined;
  private childProjector: LiveKeyedProjection<JsonValue> | undefined;
  private auxiliary: AuxiliaryRenderer | undefined;
  private readonly disclosure: LiveTree;
  private readonly selectionControl: LiveTree;
  private readonly typeLabel: LiveTree;
  private readonly previewHost: LiveTree;
  private readonly defaultPreview: LiveTree;

  public constructor(
    private readonly inspector: InspectorController,
    source: LiveMapPathHandle<JsonValue>,
    role: LiveInspectorBranchRole,
    key: LiveProjectionKey | undefined,
    depth: number,
    parent: BranchController | undefined,
  ) {
    this.source = source;
    this.path = source.path();
    const initialValue = consume_inspector_pass_value(source) ?? source.snap();
    this.kind = kindOf(initialValue);
    this.role = role;
    this.key = key;
    this.depth = depth;
    this.parent = parent;
    this.arrayIdentity = Array.isArray(initialValue) ? this.inspector.arrayIdentity(initialValue, this.path) : undefined;
    this.tree = CREATE.div();
    this.id = this.inspector.registerBranch(this);
    this.tree.attr.setMany({
      "data-hson-inspect-kind": this.kind,
      "data-hson-inspect-role": role,
      "data-hson-inspect-depth": String(depth),
      "data-hson-inspect-branch-id": this.id,
      role: "treeitem",
      "aria-level": String(depth + 1),
      "aria-selected": "false",
    });
    const line = this.tree.create.div();
    line.attr.set("data-hson-inspect-line", "true");
    this.disclosure = line.create.button();
    this.disclosure.attr.setMany({
      type: "button",
      "data-hson-inspect-action": "toggle",
      "data-hson-inspect-branch": this.id,
      "aria-label": "Toggle branch",
    });
    this.selectionControl = line.create.button();
    this.selectionControl.attr.setMany({
      type: "button",
      "data-hson-inspect-action": "select",
      "data-hson-inspect-branch": this.id,
    });
    this.typeLabel = line.create.span();
    this.typeLabel.attr.set("data-hson-inspect-type", "true");
    this.previewHost = line.create.span();
    this.previewHost.attr.set("data-hson-inspect-value", "true");
    this.defaultPreview = this.previewHost.create.span();
    this.childrenRegion = this.tree.create.div();
    this.childrenRegion.attr.setMany({
      "data-hson-inspect-children": "true",
      role: "group",
    });
    this.refreshPresentation(initialValue);
    if (this.isStructural && depth < this.inspector.initialExpansionDepth()) this.expand(false);
  }

  public get viewQuid(): string { return this.tree.quid; }
  public get isStructural(): boolean { return this.kind === "object" || this.kind === "array"; }
  public get isPrimitive(): boolean { return !this.isStructural; }
  public get childCount(): number {
    const value = this.source.snap();
    if (Array.isArray(value)) return value.length;
    if (is_json_object(value)) return Object.keys(value).length;
    return 0;
  }
  public get visible(): boolean {
    let branch: BranchController | undefined = this.parent;
    while (branch !== undefined) {
      if (!branch.expanded) return false;
      branch = branch.parent;
    }
    return true;
  }

  public refresh(next: LiveMapPathHandle<JsonValue>): void {
    if (this.disposed) return;
    const passValue = consume_inspector_pass_value(next);
    const previousPath = this.path;
    const previousKind = this.kind;
    this.source = next;
    this.path = next.path();
    this.inspector.updateBranchPath(this, previousPath, this.path);
    if (!this.inspector.shouldRefresh(this.path)) return;
    const value = passValue ?? next.snap();
    this.kind = kindOf(value);
    if (previousKind !== this.kind) {
      this.disposeChildProjector();
      this.arrayIdentity = Array.isArray(value) ? this.inspector.arrayIdentity(value, this.path) : undefined;
      this.inspector.typeReplaced();
    } else if (this.isPrimitive) {
      this.inspector.primitiveUpdated();
    }
    this.refreshPresentation(value);
    if (this.materialized && this.isStructural && this.childProjector !== undefined) {
      this.inspector.replaceChildProjector(this, this.childProjector);
    }
  }

  private refreshPresentation(value: JsonValue): void {
    this.tree.attr.set("data-hson-inspect-kind", this.kind);
    this.tree.attr.set("aria-selected", String(this.inspector.isSelected(this)));
    this.selectionControl.text.set(labelFor(this));
    this.selectionControl.attr.set("aria-label", `Select ${labelFor(this)} at ${format_live_path(this.path)}`);
    this.typeLabel.text.set(this.kind);
    if (this.isStructural) {
      this.disclosure.flag.clear("hidden");
      this.disclosure.attr.set("aria-expanded", String(this.expanded));
      this.disclosure.text.set(this.expanded ? "▾" : "▸");
      this.tree.attr.set("aria-expanded", String(this.expanded));
      this.childrenRegion.flag[this.expanded ? "clear" : "set"]("hidden");
      const childCount = Array.isArray(value) ? value.length : is_json_object(value) ? Object.keys(value).length : 0;
      if (childCount === 0) this.tree.attr.set("data-hson-inspect-empty", this.kind);
      else this.tree.attr.drop("data-hson-inspect-empty");
    } else {
      this.disclosure.flag.set("hidden");
      this.disclosure.attr.drop("aria-expanded");
      this.tree.attr.drop("aria-expanded");
      this.childrenRegion.flag.set("hidden");
      this.tree.attr.drop("data-hson-inspect-empty");
    }
    this.refreshAuxiliary(value);
  }

  private refreshAuxiliary(value: JsonValue): void {
    const selected = this.inspector.selectAuxiliaryRenderer(this, value);
    if (selected === undefined) {
      this.disposeAuxiliary();
      this.defaultPreview.flag.clear("hidden");
      this.defaultPreview.text.set(previewValue(value, this.inspector.previewStringLimit()));
      return;
    }
    const context = this.inspector.semanticContext(this);
    if (this.auxiliary?.name === selected.name && this.auxiliary.update !== undefined) {
      try {
        this.auxiliary.update(readonlyHandle(this.source), context);
        this.specializationName = selected.name;
        return;
      } catch (error) {
        this.inspector.recordAuxiliaryFailure(selected.category, selected.name, error);
        this.disposeAuxiliary();
      }
    } else {
      this.disposeAuxiliary();
    }
    try {
      const result = selected.renderer(readonlyHandle(this.source), context);
      const normalized = normalizeAuxiliary(result);
      this.previewHost.append(normalized.tree);
      if (normalized.dispose !== undefined) own_disposable_for_owner(normalized.tree.quid, normalized.dispose, "other");
      this.auxiliary = { name: selected.name, tree: normalized.tree, update: normalized.update };
      this.specializationName = selected.name;
      this.defaultPreview.flag.set("hidden");
    } catch (error) {
      this.inspector.recordAuxiliaryFailure(selected.category, selected.name, error);
      this.defaultPreview.flag.clear("hidden");
      this.defaultPreview.text.set(previewValue(value, this.inspector.previewStringLimit()));
    }
  }

  public expand(countChange = true): void {
    if (!this.isStructural) {
      throw new LiveInspectorError(
        LIVE_INSPECTOR_NON_STRUCTURAL_EXPANSION_ERROR_CODE,
        `Cannot expand non-structural branch at ${format_live_path(this.path)}.`,
      );
    }
    if (this.expanded) return;
    const before = this.inspector.branchCount();
    if (!this.materialized) {
      this.childProjector = this.inspector.createChildProjector(this);
      this.materialized = true;
    }
    this.expanded = true;
    this.childrenRegion.flag.clear("hidden");
    this.disclosure.attr.set("aria-expanded", "true");
    this.disclosure.text.set("▾");
    this.tree.attr.set("aria-expanded", "true");
    if (countChange) {
      this.inspector.expansionChanged();
      this.inspector.branchMaterializedAfterExpansion(Math.max(0, this.inspector.branchCount() - before));
    }
  }

  public collapse(): void {
    if (!this.isStructural) {
      throw new LiveInspectorError(
        LIVE_INSPECTOR_NON_STRUCTURAL_EXPANSION_ERROR_CODE,
        `Cannot collapse non-structural branch at ${format_live_path(this.path)}.`,
      );
    }
    if (!this.expanded) return;
    const active = typeof document === "undefined" ? null : document.activeElement;
    const childElement = this.childrenRegion.dom.el();
    this.expanded = false;
    this.childrenRegion.flag.set("hidden");
    this.disclosure.attr.set("aria-expanded", "false");
    this.disclosure.text.set("▸");
    this.tree.attr.set("aria-expanded", "false");
    this.inspector.expansionChanged();
    if (active instanceof Node && childElement?.contains(active)) this.disclosure.dom.htmlEl()?.focus();
  }

  public toggle(): void {
    if (this.expanded) this.collapse();
    else this.expand();
  }

  public children(): BranchController[] {
    return this.inspector.childBranches(this);
  }

  public setSelected(selected: boolean): void {
    if (this.disposed) return;
    this.tree.attr.set("aria-selected", String(selected));
  }

  public focusSelectionControl(): void {
    this.selectionControl.dom.htmlEl()?.focus();
  }

  private disposeChildProjector(): void {
    const projector = this.childProjector;
    if (projector === undefined) return;
    this.childProjector = undefined;
    this.inspector.disposeProjector(projector);
    this.materialized = false;
    this.expanded = false;
  }

  private disposeAuxiliary(): void {
    const auxiliary = this.auxiliary;
    this.auxiliary = undefined;
    this.specializationName = undefined;
    if (auxiliary !== undefined && !auxiliary.tree.isDisposed) auxiliary.tree.remove();
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disposeChildProjector();
    this.disposeAuxiliary();
    this.inspector.unregisterBranch(this);
  }
}

function readonlyHandle(source: LiveMapPathHandle): LiveInspectorReadHandle {
  const wrap = (handle: LiveMapPathHandle): LiveInspectorReadHandle => Object.freeze({
    get quid() { return handle.quid; },
    get rev() { return handle.rev; },
    path: () => Object.freeze([...handle.path()]),
    snap: () => {
      const value = handle.snap();
      must_supported_json(value);
      return value;
    },
    at: (path: LivePath) => wrap(handle.at(path)),
  });
  return wrap(source);
}

function normalizeAuxiliary(result: LiveInspectorRendererResult): Readonly<{
  tree: LiveTree;
  update: AuxiliaryRenderer["update"];
  dispose: (() => void) | undefined;
}> {
  if (result instanceof LiveTree) return { tree: result, update: undefined, dispose: undefined };
  if (typeof result !== "object" || result === null || !(result.tree instanceof LiveTree)) {
    throw new LiveInspectorError(LIVE_INSPECTOR_RENDERER_HOOK_ERROR_CODE, "Inspector renderer returned an invalid LiveTree branch.");
  }
  return { tree: result.tree, update: result.update, dispose: result.dispose };
}

function kindOf(value: unknown): LiveInspectorValueKind {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (is_json_object(value)) return "object";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  throw new LiveInspectorError(LIVE_INSPECTOR_INVALID_ROOT_ERROR_CODE, `Unsupported inspector value kind ${typeof value}.`);
}

function labelFor(branch: BranchController): string {
  if (branch.role === "root") return "$";
  const leaf = branch.path.at(-1);
  return typeof leaf === "number" ? `[${leaf}]` : JSON.stringify(String(leaf));
}

function previewValue(value: JsonValue, longStringLimit: number): string {
  if (typeof value === "string") {
    const preview = value.length > longStringLimit ? `${value.slice(0, longStringLimit)}…` : value;
    return JSON.stringify(preview);
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) return String(value);
  const count = Array.isArray(value) ? value.length : Object.keys(value).length;
  if (Array.isArray(value)) return count === 0 ? "[] · empty" : `[…] · ${count}`;
  return count === 0 ? "{} · empty" : `{…} · ${count}`;
}

function pathKey(path: LivePath): string { return JSON.stringify(path); }

function compareBranchPath(left: BranchController, right: BranchController): number {
  return pathKey(left.path).localeCompare(pathKey(right.path));
}

function invalidPath(path: LivePath): LiveInspectorError {
  return new LiveInspectorError(LIVE_INSPECTOR_INVALID_PATH_ERROR_CODE, `Inspector path does not resolve: ${format_live_path(path)}.`);
}

function unrepresentable(target: LiveInspectorSerializationTarget, path: LivePath): LiveInspectorError {
  return new LiveInspectorError(
    LIVE_INSPECTOR_UNREPRESENTABLE_CONVERSION_ERROR_CODE,
    `Inspector path ${format_live_path(path)} is not representable as ${target}.`,
  );
}

function containsConcreteElement(node: HsonNode): boolean {
  if (!node.$_tag.startsWith("_hson_")) return true;
  return node.$_content.some((child) => typeof child === "object" && child !== null && containsConcreteElement(child));
}

function countValueBranches(value: unknown): number {
  must_supported_json(value);
  if (Array.isArray(value)) return 1 + value.reduce<number>((sum, child) => sum + countValueBranches(child), 0);
  if (is_json_object(value)) return 1 + Object.values(value).reduce<number>((sum, child) => sum + countValueBranches(child), 0);
  return 1;
}

function hasProjectionCode(error: unknown, code: string): boolean {
  let cursor: unknown = error;
  const seen = new Set<object>();
  while (cursor instanceof Error && !seen.has(cursor)) {
    seen.add(cursor);
    if (cursor instanceof LiveProjectionError && cursor.code === code) return true;
    cursor = (cursor as Error & { cause?: unknown }).cause;
  }
  return false;
}

function materializationNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function mustNonNegativeInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative integer.`);
  return value;
}

function mustPositiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive integer.`);
  return value;
}
