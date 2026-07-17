import type { JsonValue } from "../../core/types.js";
import { LiveTree } from "../livetree/livetree.js";
import { parent_for_node } from "../livetree/lifecycle/graph-ownership.js";
import { own_disposable_for_owner } from "../livetree/managers/lifecycle-registry.js";
import { get_el_for_node } from "../livetree/utils/node-map-helpers.js";
import { path_is_prefix, paths_equal, relative_live_path } from "../livemap/livemap.path.js";
import type {
  LiveMapCommit,
  LiveMapFeedEvent,
  LiveMapOp,
  LiveMapPathHandle,
  LivePath,
} from "../../types/livemap.types.js";
import type {
  LiveKeyedProjection,
  LiveKeyedProjectionOptions,
  LiveProjectionChange,
  LiveProjectionDiagnostics,
  LiveProjectionItemContext,
  LiveProjectionItemUpdate,
  LiveProjectionKey,
  LiveProjectionListener,
  LiveProjectionMappingSummary,
  LiveProjectionRenderResult,
  LiveProjectionSnapshot,
  LiveProjectionStatus,
} from "../../types/liveproject.types.js";
import {
  LIVE_PROJECTION_BRANCH_ATTACHED_ERROR_CODE,
  LIVE_PROJECTION_DISPOSED_ERROR_CODE,
  LIVE_PROJECTION_DUPLICATE_KEY_ERROR_CODE,
  LIVE_PROJECTION_HOST_NOT_EMPTY_ERROR_CODE,
  LIVE_PROJECTION_INVALID_BRANCH_ERROR_CODE,
  LIVE_PROJECTION_INVALID_SOURCE_ERROR_CODE,
  LIVE_PROJECTION_MAPPING_CONFLICT_ERROR_CODE,
  LIVE_PROJECTION_MISSING_IDENTITY_ERROR_CODE,
  LIVE_PROJECTION_RENDERER_CREATE_ERROR_CODE,
  LIVE_PROJECTION_RENDERER_UPDATE_ERROR_CODE,
  LIVE_PROJECTION_SOURCE_REPLACEMENT_ERROR_CODE,
  LiveProjectionError,
} from "./liveproject.error.js";

type MutableDiagnostics = {
  recordsCreated: number;
  recordsReused: number;
  recordsMoved: number;
  recordsUpdated: number;
  recordsRemoved: number;
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
};

type OwnedCleanup = {
  run: () => void;
  off: (() => void) | undefined;
};

type RendererOwner = Readonly<{
  own: (cleanup: () => void) => () => void;
  attach: (tree: LiveTree) => void;
  disposeUnattached: () => void;
}>;

type ProjectionRecord<TItem extends JsonValue> = {
  key: LiveProjectionKey;
  sourceQuid: string | undefined;
  path: LivePath;
  ordinal: number;
  tree: LiveTree;
  viewQuid: string;
  update: LiveProjectionItemUpdate<TItem> | undefined;
  owner: RendererOwner;
  disposed: boolean;
};

type DesiredItem<TItem extends JsonValue> = Readonly<{
  key: LiveProjectionKey;
  value: TItem;
  source: LiveMapPathHandle<TItem>;
  path: LivePath;
  ordinal: number;
}>;

type ReconcileKind = "reconcile" | "source-replaced" | "resync";

/** Create the experimental keyed LiveMap -> LiveTree collection projector. */
export function project_keyed_collection<TItem extends JsonValue>(
  options: LiveKeyedProjectionOptions<TItem>,
): LiveKeyedProjection<TItem> {
  return new KeyedProjection(options).publicHandle();
}

class KeyedProjection<TItem extends JsonValue> {
  private source: LiveMapPathHandle<readonly TItem[]>;
  private readonly projectionHost: LiveTree;
  private readonly selectKey: LiveKeyedProjectionOptions<TItem>["key"];
  private readonly render: LiveKeyedProjectionOptions<TItem>["render"];
  private records: ProjectionRecord<TItem>[] = [];
  private recordsByKey = new Map<LiveProjectionKey, ProjectionRecord<TItem>>();
  private sourceOff: (() => void) | undefined;
  private readonly listeners = new Set<LiveProjectionListener>();
  private currentStatus: LiveProjectionStatus = "initializing";
  private currentFailure: LiveProjectionError | undefined;
  private firstFailure: LiveProjectionError | undefined;
  private replacementFailure: LiveProjectionError | undefined;
  private lastAppliedRevision: number;
  private readonly counts: MutableDiagnostics = {
    recordsCreated: 0,
    recordsReused: 0,
    recordsMoved: 0,
    recordsUpdated: 0,
    recordsRemoved: 0,
    fullReconciliations: 0,
    targetedCommitApplications: 0,
    ignoredOutOfScopeCommits: 0,
    keyConflicts: 0,
    rendererFailures: 0,
    observerFailures: 0,
    sourceReplacements: 0,
    failedSourceReplacements: 0,
    subscriptionsCreated: 0,
    subscriptionsDisposed: 0,
  };

  public constructor(options: LiveKeyedProjectionOptions<TItem>) {
    this.source = options.source;
    this.projectionHost = options.host;
    this.selectKey = options.key;
    this.render = options.render;
    this.lastAppliedRevision = options.source.rev;

    if (this.projectionHost.isDisposed) {
      throw new LiveProjectionError(
        LIVE_PROJECTION_INVALID_BRANCH_ERROR_CODE,
        "Live projection host is disposed.",
      );
    }
    if (this.projectionHost.content.count() !== 0) {
      throw new LiveProjectionError(
        LIVE_PROJECTION_HOST_NOT_EMPTY_ERROR_CODE,
        "Patch 7A requires a dedicated empty LiveTree host.",
      );
    }

    try {
      this.reconcile(this.source, "reconcile", undefined, true);
      this.currentStatus = "ready";
      this.attachSource();
    } catch (error) {
      this.disposeRecords(this.records);
      this.records = [];
      this.recordsByKey.clear();
      throw asProjectionError(error, LIVE_PROJECTION_INVALID_SOURCE_ERROR_CODE, "Initial keyed projection failed.");
    }
  }

  public publicHandle(): LiveKeyedProjection<TItem> {
    const self = this;
    return Object.freeze({
      get status() { return self.currentStatus; },
      get host() { return self.projectionHost; },
      get itemCount() { return self.records.length; },
      get sourcePath() { return [...self.source.path()]; },
      get sourceRevisionLastApplied() { return self.lastAppliedRevision; },
      get failure() { return self.currentFailure; },
      diagnostics: () => self.diagnostics(),
      debugMappings: () => self.debugMappings(),
      subscribe: (listener) => self.subscribe(listener),
      replaceSource: (source) => self.replaceSource(source),
      resync: () => self.resync(),
      dispose: () => self.dispose(),
    });
  }

  private attachSource(): void {
    this.sourceOff = this.source.feed((event) => this.onCommit(event));
    this.counts.subscriptionsCreated += 1;
  }

  private detachSource(): void {
    const off = this.sourceOff;
    if (off === undefined) return;
    this.sourceOff = undefined;
    off();
    this.counts.subscriptionsDisposed += 1;
  }

  private onCommit(event: LiveMapFeedEvent): void {
    if (this.currentStatus === "disposed" || this.currentStatus === "failed") return;
    const basePath = this.source.path();
    const matching = event.ops.filter((op) => pathsOverlapSource(basePath, op.path));
    if (matching.length === 0) {
      this.counts.ignoredOutOfScopeCommits += 1;
      return;
    }

    try {
      if (matching.some((op) => isStructuralOp(basePath, op))) {
        const exactSpliceOnly = matching.every((op) => op.kind === "splice" && paths_equal(op.path, basePath));
        if (exactSpliceOnly) this.counts.targetedCommitApplications += 1;
        else this.counts.fullReconciliations += 1;
        this.reconcile(this.source, "reconcile", event.commit, false);
      } else {
        this.applyNested(event.commit, matching);
      }
      this.lastAppliedRevision = event.commit.rev;
      this.currentStatus = "ready";
      this.notify();
    } catch (error) {
      const failure = asProjectionError(
        error,
        LIVE_PROJECTION_RENDERER_UPDATE_ERROR_CODE,
        `Projection commit ${event.commit.rev} failed.`,
      );
      this.fail(failure);
      this.notify();
    }
  }

  private applyNested(commit: LiveMapCommit, ops: readonly LiveMapOp[]): void {
    const basePath = this.source.path();
    const affected = new Map<number, LiveMapOp[]>();
    for (const op of ops) {
      const relative = relative_live_path(basePath, op.path);
      const ordinal = relative?.[0];
      if (typeof ordinal !== "number") {
        this.counts.fullReconciliations += 1;
        this.reconcile(this.source, "reconcile", commit, false);
        return;
      }
      const itemOps = affected.get(ordinal) ?? [];
      itemOps.push(op);
      affected.set(ordinal, itemOps);
    }

    const desiredByOrdinal = new Map<number, DesiredItem<TItem>>();
    const nextKeys = this.records.map((record) => record.key);
    for (const ordinal of affected.keys()) {
      const desired = this.readItem(this.source, ordinal);
      desiredByOrdinal.set(ordinal, desired);
      nextKeys[ordinal] = desired.key;
    }
    this.assertUniqueKeys(nextKeys);

    const keyChanged = [...desiredByOrdinal].some(([ordinal, desired]) => this.records[ordinal]?.key !== desired.key);
    if (keyChanged) {
      this.counts.targetedCommitApplications += 1;
      this.reconcile(this.source, "reconcile", commit, false);
      return;
    }

    this.currentStatus = "reconciling";
    for (const [ordinal, itemOps] of affected) {
      const record = this.records[ordinal];
      const desired = desiredByOrdinal.get(ordinal);
      if (record === undefined || desired === undefined) {
        throw new LiveProjectionError(
          LIVE_PROJECTION_MAPPING_CONFLICT_ERROR_CODE,
          `No projection record exists for nested update at ordinal ${ordinal}.`,
        );
      }
      record.path = desired.path;
      record.ordinal = ordinal;
      this.updateRecord(record, desired.source, { kind: "nested", commit, ops: Object.freeze([...itemOps]) });
    }
    this.counts.targetedCommitApplications += 1;
  }

  private reconcile(
    nextSource: LiveMapPathHandle<readonly TItem[]>,
    kind: ReconcileKind,
    commit: LiveMapCommit | undefined,
    countFull: boolean,
  ): void {
    const desired = this.readCollection(nextSource);
    if (countFull) this.counts.fullReconciliations += 1;

    const oldByKey = this.recordsByKey;
    const staged: ProjectionRecord<TItem>[] = [];
    const nextRecords: ProjectionRecord<TItem>[] = [];
    const usedTrees = new Set(this.records.map((record) => record.tree.node));

    try {
      for (const item of desired) {
        const existing = oldByKey.get(item.key);
        if (existing !== undefined) {
          nextRecords.push(existing);
          continue;
        }
        const record = this.createRecord(item, usedTrees);
        usedTrees.add(record.tree.node);
        staged.push(record);
        nextRecords.push(record);
      }
    } catch (error) {
      this.disposeRecords(staged);
      throw error;
    }

    this.currentStatus = "reconciling";
    const change: LiveProjectionChange = Object.freeze({
      kind,
      ...(commit === undefined ? {} : { commit }),
      ops: Object.freeze(commit === undefined ? [] : [...commit.ops]),
    });

    try {
      for (let ordinal = 0; ordinal < desired.length; ordinal += 1) {
        const item = desired[ordinal];
        const record = nextRecords[ordinal];
        if (item === undefined || record === undefined || staged.includes(record)) continue;
        if (!shouldUpdateSurvivor(commit, nextSource.path(), ordinal)) {
          this.counts.recordsReused += 1;
          continue;
        }
        this.updateRecord(record, item.source, change, item.path, ordinal);
        this.counts.recordsReused += 1;
      }
    } catch (error) {
      this.disposeRecords(staged);
      throw error;
    }

    try {
      const retained = new Set(nextRecords);
      const removed = this.records.filter((record) => !retained.has(record));
      for (const record of removed) this.removeRecord(record);

      const currentOrder = this.records.filter((record) => retained.has(record));
      for (let ordinal = 0; ordinal < nextRecords.length; ordinal += 1) {
        const record = nextRecords[ordinal];
        const item = desired[ordinal];
        if (record === undefined || item === undefined) continue;
        const currentOrdinal = currentOrder.indexOf(record);
        if (currentOrdinal === -1) {
          this.projectionHost.append(record.tree, ordinal);
          currentOrder.splice(ordinal, 0, record);
        } else if (currentOrdinal !== ordinal) {
          record.tree.detach();
          this.projectionHost.append(record.tree, ordinal);
          currentOrder.splice(currentOrdinal, 1);
          currentOrder.splice(ordinal, 0, record);
          this.counts.recordsMoved += 1;
        }
        record.path = item.path;
        record.ordinal = ordinal;
        record.key = item.key;
      }
    } catch (error) {
      this.disposeRecords(staged);
      throw error;
    }

    this.records = nextRecords;
    this.recordsByKey = new Map(nextRecords.map((record) => [record.key, record]));
  }

  private createRecord(item: DesiredItem<TItem>, usedTrees: Set<object>): ProjectionRecord<TItem> {
    const owner = makeRendererOwner();
    const context = makeItemContext(item, owner);
    let result: LiveProjectionRenderResult<TItem>;
    try {
      result = this.render(item.source, context);
    } catch (error) {
      owner.disposeUnattached();
      this.counts.rendererFailures += 1;
      throw new LiveProjectionError(
        LIVE_PROJECTION_RENDERER_CREATE_ERROR_CODE,
        `Renderer creation failed for projection key ${formatKey(item.key)}.`,
        error,
      );
    }

    let normalized: ReturnType<typeof normalizeRenderResult<TItem>>;
    try {
      normalized = normalizeRenderResult(result);
    } catch (error) {
      owner.disposeUnattached();
      this.counts.rendererFailures += 1;
      throw error;
    }
    const tree = normalized.tree;
    try {
      this.assertRenderableBranch(tree, usedTrees);
      owner.attach(tree);
      if (normalized.dispose !== undefined) owner.own(normalized.dispose);
      const record: ProjectionRecord<TItem> = {
        key: item.key,
        sourceQuid: undefined,
        path: item.path,
        ordinal: item.ordinal,
        tree,
        viewQuid: tree.quid,
        update: normalized.update,
        owner,
        disposed: false,
      };
      this.counts.recordsCreated += 1;
      return record;
    } catch (error) {
      owner.disposeUnattached();
      if (!tree.isDisposed && parent_for_node(tree.node) === undefined) tree.remove();
      throw error;
    }
  }

  private assertRenderableBranch(tree: LiveTree, usedTrees: Set<object>): void {
    if (!(tree instanceof LiveTree) || tree.isDisposed) {
      throw new LiveProjectionError(
        LIVE_PROJECTION_INVALID_BRANCH_ERROR_CODE,
        "Projection renderer must return one active LiveTree branch.",
      );
    }
    const node = tree.node;
    if (usedTrees.has(node)) {
      throw new LiveProjectionError(
        LIVE_PROJECTION_MAPPING_CONFLICT_ERROR_CODE,
        "Projection renderer returned a branch already owned by this projection.",
      );
    }
    if (parent_for_node(node) !== undefined || get_el_for_node(node)?.parentNode) {
      throw new LiveProjectionError(
        LIVE_PROJECTION_BRANCH_ATTACHED_ERROR_CODE,
        "Projection renderer returned a branch attached elsewhere.",
      );
    }
  }

  private updateRecord(
    record: ProjectionRecord<TItem>,
    source: LiveMapPathHandle<TItem>,
    change: LiveProjectionChange,
    path: LivePath = record.path,
    ordinal: number = record.ordinal,
  ): void {
    if (record.update === undefined) return;
    try {
      record.update(source, change, makeItemContext({ key: record.key, path, ordinal }, record.owner));
      this.counts.recordsUpdated += 1;
    } catch (error) {
      this.counts.rendererFailures += 1;
      throw new LiveProjectionError(
        LIVE_PROJECTION_RENDERER_UPDATE_ERROR_CODE,
        `Renderer update failed for projection key ${formatKey(record.key)}.`,
        error,
      );
    }
  }

  private readCollection(source: LiveMapPathHandle<readonly TItem[]>): readonly DesiredItem<TItem>[] {
    let value: readonly TItem[];
    try {
      const snapshot = source.snap();
      if (!Array.isArray(snapshot)) {
        throw new LiveProjectionError(
          LIVE_PROJECTION_INVALID_SOURCE_ERROR_CODE,
          `Keyed projection source at ${JSON.stringify(source.path())} is not an array.`,
        );
      }
      value = snapshot as readonly TItem[];
    } catch (error) {
      throw asProjectionError(error, LIVE_PROJECTION_INVALID_SOURCE_ERROR_CODE, "Keyed projection source could not be read.");
    }

    const desired = value.map((_item, ordinal) => this.readItem(source, ordinal));
    this.assertUniqueKeys(desired.map((item) => item.key));
    return desired;
  }

  private readItem(source: LiveMapPathHandle<readonly TItem[]>, ordinal: number): DesiredItem<TItem> {
    const itemSource = source.at([ordinal]) as LiveMapPathHandle<TItem>;
    const value = itemSource.snap();
    if (value === undefined) {
      throw new LiveProjectionError(
        LIVE_PROJECTION_INVALID_SOURCE_ERROR_CODE,
        `Keyed projection item ${ordinal} does not resolve.`,
      );
    }
    const path = itemSource.path();
    let key: unknown;
    try {
      key = this.selectKey(value, Object.freeze({ path: [...path], ordinal }));
    } catch (error) {
      throw new LiveProjectionError(
        LIVE_PROJECTION_MISSING_IDENTITY_ERROR_CODE,
        `Key selector failed for projection item ${ordinal}.`,
        error,
      );
    }
    if (typeof key !== "string" && typeof key !== "number") {
      throw new LiveProjectionError(
        LIVE_PROJECTION_MISSING_IDENTITY_ERROR_CODE,
        `Projection item ${ordinal} has no valid string or number key.`,
      );
    }
    return Object.freeze({ key, value, source: itemSource, path: [...path], ordinal });
  }

  private assertUniqueKeys(keys: readonly LiveProjectionKey[]): void {
    const seen = new Set<LiveProjectionKey>();
    for (const key of keys) {
      if (!seen.has(key)) {
        seen.add(key);
        continue;
      }
      this.counts.keyConflicts += 1;
      throw new LiveProjectionError(
        LIVE_PROJECTION_DUPLICATE_KEY_ERROR_CODE,
        `Duplicate projection key ${formatKey(key)}.`,
      );
    }
  }

  private replaceSource(source: LiveMapPathHandle<readonly TItem[]>): void {
    this.assertUsable("replace source");
    const priorStatus = this.currentStatus;
    try {
      this.reconcile(source, "source-replaced", undefined, true);
      this.detachSource();
      this.source = source;
      this.lastAppliedRevision = source.rev;
      this.currentFailure = undefined;
      this.currentStatus = "ready";
      this.replacementFailure = undefined;
      this.counts.sourceReplacements += 1;
      this.attachSource();
      this.notify();
    } catch (error) {
      this.counts.failedSourceReplacements += 1;
      const projectionFailure = asProjectionError(
        error,
        LIVE_PROJECTION_SOURCE_REPLACEMENT_ERROR_CODE,
        "Live projection source replacement failed.",
      );
      const failure = new LiveProjectionError(
        LIVE_PROJECTION_SOURCE_REPLACEMENT_ERROR_CODE,
        "Live projection source replacement failed; the prior source remains subscribed.",
        projectionFailure,
      );
      this.replacementFailure = failure;
      if (this.currentStatus === "reconciling") this.fail(projectionFailure);
      else if (this.currentStatus !== "failed") this.currentStatus = priorStatus;
      throw failure;
    }
  }

  private resync(): void {
    this.assertUsable("resynchronize");
    try {
      this.reconcile(this.source, "resync", undefined, true);
      this.lastAppliedRevision = this.source.rev;
      this.currentFailure = undefined;
      this.currentStatus = "ready";
      this.notify();
    } catch (error) {
      const failure = asProjectionError(error, LIVE_PROJECTION_RENDERER_UPDATE_ERROR_CODE, "Projection resynchronization failed.");
      this.fail(failure);
      this.notify();
      throw failure;
    }
  }

  private subscribe(listener: LiveProjectionListener): () => void {
    this.assertUsable("subscribe");
    if (typeof listener !== "function") throw new TypeError("Live projection listener must be a function.");
    this.listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const snapshot = this.snapshot();
    for (const listener of [...this.listeners]) {
      try {
        listener(snapshot);
      } catch {
        this.counts.observerFailures += 1;
      }
    }
  }

  private snapshot(): LiveProjectionSnapshot {
    return Object.freeze({
      status: this.currentStatus,
      itemCount: this.records.length,
      sourcePath: Object.freeze([...this.source.path()]),
      sourceRevisionLastApplied: this.lastAppliedRevision,
      failure: this.currentFailure,
    });
  }

  private diagnostics(): LiveProjectionDiagnostics {
    return Object.freeze({
      status: this.currentStatus,
      sourceRevisionLastApplied: this.lastAppliedRevision,
      projectedItemCount: this.records.length,
      ...this.counts,
      sourceQuidMappings: this.records.filter((record) => record.sourceQuid !== undefined).length,
      applicationKeyMappings: this.recordsByKey.size,
      firstFailure: this.firstFailure,
      lastSourceReplacementFailure: this.replacementFailure,
    });
  }

  private debugMappings(): readonly LiveProjectionMappingSummary[] {
    this.assertUsable("inspect mappings");
    return Object.freeze(this.records.map((record) => Object.freeze({
      applicationKey: record.key,
      sourceQuid: record.sourceQuid,
      sourcePath: Object.freeze([...record.path]),
      viewQuid: record.viewQuid,
      ordinal: record.ordinal,
    })));
  }

  private fail(error: LiveProjectionError): void {
    this.firstFailure ??= error;
    this.currentFailure ??= error;
    this.currentStatus = "failed";
  }

  private removeRecord(record: ProjectionRecord<TItem>): void {
    if (record.disposed) return;
    record.disposed = true;
    record.tree.remove();
    this.counts.recordsRemoved += 1;
  }

  private disposeRecords(records: readonly ProjectionRecord<TItem>[]): void {
    for (const record of records) this.removeRecord(record);
  }

  private dispose(): void {
    if (this.currentStatus === "disposed") return;
    this.detachSource();
    this.disposeRecords(this.records);
    this.records = [];
    this.recordsByKey.clear();
    this.currentStatus = "disposed";
    this.notify();
    this.listeners.clear();
  }

  private assertUsable(operation: string): void {
    if (this.currentStatus !== "disposed") return;
    throw new LiveProjectionError(
      LIVE_PROJECTION_DISPOSED_ERROR_CODE,
      `Live projection is disposed; cannot ${operation}.`,
    );
  }
}

function makeRendererOwner(): RendererOwner {
  const resources = new Set<OwnedCleanup>();
  let attachedTree: LiveTree | undefined;

  const own = (cleanup: () => void): (() => void) => {
    if (typeof cleanup !== "function") throw new TypeError("Projection cleanup must be a function.");
    let active = true;
    const resource: OwnedCleanup = {
      off: undefined,
      run: () => {
        if (!active) return;
        active = false;
        resources.delete(resource);
        cleanup();
      },
    };
    resources.add(resource);
    if (attachedTree !== undefined) {
      resource.off = own_disposable_for_owner(attachedTree.quid, resource.run, "other");
    }
    return () => {
      if (resource.off !== undefined) resource.off();
      else resource.run();
    };
  };

  return Object.freeze({
    own,
    attach: (tree: LiveTree) => {
      attachedTree = tree;
      for (const resource of resources) {
        resource.off = own_disposable_for_owner(tree.quid, resource.run, "other");
      }
    },
    disposeUnattached: () => {
      for (const resource of [...resources]) {
        if (resource.off !== undefined) resource.off();
        else resource.run();
      }
    },
  });
}

function makeItemContext(
  item: Pick<DesiredItem<JsonValue>, "key" | "path" | "ordinal">,
  owner: RendererOwner,
): LiveProjectionItemContext {
  return Object.freeze({
    key: item.key,
    sourceQuid: undefined,
    path: Object.freeze([...item.path]),
    ordinal: item.ordinal,
    own: owner.own,
  });
}

function normalizeRenderResult<TItem extends JsonValue>(
  result: LiveProjectionRenderResult<TItem>,
): Readonly<{
  tree: LiveTree;
  update: LiveProjectionItemUpdate<TItem> | undefined;
  dispose: (() => void) | undefined;
}> {
  if (result instanceof LiveTree) return { tree: result, update: undefined, dispose: undefined };
  if (typeof result !== "object" || result === null || !(result.tree instanceof LiveTree)) {
    throw new LiveProjectionError(
      LIVE_PROJECTION_INVALID_BRANCH_ERROR_CODE,
      "Projection renderer returned an invalid branch result.",
    );
  }
  return { tree: result.tree, update: result.update, dispose: result.dispose };
}

function isStructuralOp(sourcePath: LivePath, op: LiveMapOp): boolean {
  if (path_is_prefix(op.path, sourcePath)) return true;
  const relative = relative_live_path(sourcePath, op.path);
  if (relative === undefined || typeof relative[0] !== "number") return true;
  return relative.length === 1;
}

/** Skip unchanged survivors before/after one exact semantic splice. */
function shouldUpdateSurvivor(commit: LiveMapCommit | undefined, sourcePath: LivePath, ordinal: number): boolean {
  if (commit === undefined || commit.ops.length !== 1) return true;
  const op = commit.ops[0];
  if (op?.kind !== "splice" || !paths_equal(op.path, sourcePath)) return true;
  if (ordinal < op.start) return false;
  const insertedEnd = op.start + op.inserted.length;
  if (ordinal < insertedEnd) return true;
  return op.inserted.length !== op.removed.length;
}

function pathsOverlapSource(sourcePath: LivePath, opPath: LivePath): boolean {
  return path_is_prefix(sourcePath, opPath) || path_is_prefix(opPath, sourcePath);
}

function asProjectionError(
  error: unknown,
  fallbackCode: ConstructorParameters<typeof LiveProjectionError>[0],
  fallbackMessage: string,
): LiveProjectionError {
  return error instanceof LiveProjectionError
    ? error
    : new LiveProjectionError(fallbackCode, fallbackMessage, error);
}

function formatKey(key: LiveProjectionKey): string {
  return JSON.stringify(key);
}
