import {
  is_supported_document,
  produce_document_diagnostics,
  type DocumentDiagnosticInput,
  type DocumentDiagnosticSpec,
} from "./document-diagnostics.js";
import type { DiagnosticDocument, DiagnosticPublisher, Disposable } from "./diagnostics.js";
import { HSON_EXPECT_ERROR_MARKER } from "./diagnostic-expectations.js";
import type { StandaloneAuthoringMode } from './authoring-mode.js';
import type { HsonEventImportEvidence } from "../../../src/internal/embedded-hson/discover-hson-tagged-templates.js";
import type { EventSourceEvidence } from "./event-source-evidence.js";

export type WorkspaceDiagnosticSource = Readonly<{
  uri: string;
  fileName: string;
  languageId: "hson" | "typescript" | "typescriptreact";
  authoringMode?: StandaloneAuthoringMode;
  eventEvidence?: EventSourceEvidence;
}>;

export type WorkspaceSourceChange = Readonly<{
  uri: string;
  kind: "create" | "change" | "delete";
  affectsTypeScriptProjects?: boolean;
  observationOnly?: boolean;
}>;

export type WorkspaceDiscoveryScope = "projects" | "standalone" | "all";
type WorkspaceDiscoveryRequest = Readonly<{
  typescript: boolean;
  changedUris?: readonly string[];
  standalone: boolean;
  isCurrent: () => boolean;
  withdrawEventSources: (update: (revision: number) => readonly string[]) => void;
}>;
type WorkspaceDiscoveryResult = Readonly<{
  sources: readonly WorkspaceDiagnosticSource[];
  accept?(revision: number): readonly string[] | void;
}>;

export type WorkspaceDiagnosticHost = Readonly<{
  openDocuments(): readonly DiagnosticDocument[];
  discoverSources(request: WorkspaceDiscoveryRequest): Promise<WorkspaceDiscoveryResult>;
  invalidateProjects?(revision: number, change?: WorkspaceSourceChange, projects?: readonly string[]): readonly string[];
  eventImports?: HsonEventImportEvidence;
  readSource(source: WorkspaceDiagnosticSource): Promise<string>;
  onDidOpen(listener: (document: DiagnosticDocument) => void): Disposable;
  onDidChange(listener: (document: DiagnosticDocument) => void): Disposable;
  onDidClose(listener: (document: DiagnosticDocument) => void): Disposable;
  onDidChangeSources(listener: (changes: readonly WorkspaceSourceChange[]) => void): Disposable;
  onDidChangeProjects(listener: (scope?: WorkspaceDiscoveryScope, projects?: readonly string[]) => void): Disposable;
  setTimer(callback: () => void, delayMilliseconds: number): unknown;
  clearTimer(timer: unknown): void;
  yield(): Promise<void>;
  reportUnexpected(error: unknown, source?: WorkspaceDiagnosticSource): void;
}>;

export type WorkspaceDiagnosticOptions = Readonly<{
  debounceMilliseconds?: number;
  discoveryDebounceMilliseconds?: number;
  readConcurrency?: number;
  produce?: (input: DocumentDiagnosticInput) => readonly DocumentDiagnosticSpec[];
}>;

function tsCandidate(text: string): boolean {
  return text.includes("Hson") || text.includes("fromHson") || text.includes(HSON_EXPECT_ERROR_MARKER);
}

export function start_workspace_diagnostics(
  host: WorkspaceDiagnosticHost,
  publisher: DiagnosticPublisher,
  options: WorkspaceDiagnosticOptions = {},
): Disposable {
  const produce = options.produce ?? produce_document_diagnostics;
  const debounce = options.debounceMilliseconds ?? 150;
  const discoveryDebounce = options.discoveryDebounceMilliseconds ?? 250;
  const concurrency = Math.max(1, options.readConcurrency ?? 4);
  const sources = new Map<string, WorkspaceDiagnosticSource>();
  const generations = new Map<string, number>();
  // null means disk diagnostics need a read after project discovery accepts
  // the applicable dependency state.
  const fingerprints = new Map<string, string | null>();
  const timers = new Map<string, unknown>();
  let discoveryTimer: unknown | undefined;
  let discoveryGeneration = 0;
  let changedUris: Set<string> | undefined; // undefined requests a full project discovery.
  let scanStandalone = true;
  let disposed = false;
  const projectPending = () => changedUris === undefined || changedUris.size > 0;

  const open = (uri: string): DiagnosticDocument | undefined => host.openDocuments().find(document => document.uri === uri);
  const advance = (uri: string): number => {
    const generation = (generations.get(uri) ?? 0) + 1;
    generations.set(uri, generation);
    return generation;
  };
  const cancel = (uri: string): void => {
    const timer = timers.get(uri);
    if (timer !== undefined) host.clearTimer(timer);
    timers.delete(uri);
  };
  const publish = (document: DiagnosticDocument, generation: number, applicable = () => true): void => {
    const currentGeneration = () => !disposed && generations.get(document.uri) === generation && applicable();
    if (!currentGeneration()) return;
    const current = open(document.uri);
    if (current !== undefined && current.version !== document.version) return;
    try {
      const eventImports = host.eventImports?.(document.fileName, document.text);
      const specs = document.languageId !== "hson" && !eventImports?.size && !tsCandidate(document.text) ? [] : produce({
        ...document, eventImports,
      });
      if (!currentGeneration()) return;
      const after = open(document.uri);
      if (after !== undefined && after.version !== document.version) return;
      fingerprints.set(document.uri, `${document.languageId}\0${document.authoringMode ?? ''}\0${document.text}`);
      publisher.set(document, specs);
    } catch (error) {
      if (!currentGeneration()) return;
      publisher.delete(document.uri);
      host.reportUnexpected(error, sources.get(document.uri));
    }
  };
  const analyzeOpen = (document: DiagnosticDocument): void => {
    cancel(document.uri);
    const generation = advance(document.uri);
    if (!is_supported_document(document)) { publisher.delete(document.uri); return; }
    publish(Object.freeze({ ...document }), generation);
  };
  const scheduleOpen = (document: DiagnosticDocument): void => {
    cancel(document.uri);
    const generation = advance(document.uri);
    const snapshot = Object.freeze({ ...document });
    const timer = host.setTimer(() => {
      timers.delete(document.uri);
      publish(snapshot, generation);
    }, debounce);
    timers.set(document.uri, timer);
  };
  const analyzeDisk = async (source: WorkspaceDiagnosticSource, force = false): Promise<void> => {
    if (disposed || open(source.uri) !== undefined || sources.get(source.uri) !== source) return;
    const generation = advance(source.uri);
    const currentRead = () =>
      !disposed && generations.get(source.uri) === generation && open(source.uri) === undefined && sources.get(source.uri) === source;
    const projectReady = () => {
      if (source.languageId === "hson" || !projectPending()) return true;
      fingerprints.set(source.uri, null);
      return false;
    };
    if (!projectReady()) return;
    try {
      const text = await host.readSource(source);
      // A read can serve an equivalent source after rediscovery. Its Event
      // analysis can begin only with the currently accepted project evidence.
      if (!currentRead() || !projectReady()) return;
      const fingerprint = `${source.languageId}\0${source.authoringMode ?? ''}\0${text}`;
      if (!force && fingerprints.get(source.uri) === fingerprint) return;
      publish(Object.freeze({ ...source, version: -generation, text }), generation, projectReady);
    } catch (error) {
      if (!currentRead() || !projectReady()) return;
      publisher.delete(source.uri);
      host.reportUnexpected(error, source);
    }
  };
  const analyzeBatch = async (batch: readonly WorkspaceDiagnosticSource[]): Promise<void> => {
    let index = 0;
    const workers = Array.from({ length: Math.min(concurrency, batch.length) }, async () => {
      while (!disposed) {
        const source = batch[index];
        index += 1;
        if (source === undefined) return;
        await analyzeDisk(source);
        await host.yield();
      }
    });
    await Promise.all(workers);
  };
  const invalidateSources = (affected: readonly string[]): void => {
    for (const uri of affected) {
      const opened = open(uri);
      if (opened !== undefined) analyzeOpen(opened);
      else {
        fingerprints.set(uri, null);
        publisher.delete(uri);
      }
    }
  };
  const refresh = async (): Promise<void> => {
    if (disposed) return;
    let generation = ++discoveryGeneration;
    try {
      const isCurrent = () => !disposed && discoveryGeneration === generation;
      const withdrawEventSources = (update: (revision: number) => readonly string[]): void => {
        if (!isCurrent()) return;
        const affected = update(generation);
        if (affected.length === 0) return;
        // The receiver must also be able to accept this discovery's final
        // configuration after the interim withdrawal.
        generation = ++discoveryGeneration;
        invalidateSources(affected);
      };
      const request = { typescript: projectPending(), standalone: scanStandalone,
        changedUris: changedUris === undefined ? undefined : [...changedUris], isCurrent, withdrawEventSources };
      const { sources: discovered, accept } = await host.discoverSources(request);
      if (!isCurrent()) return;
      changedUris = new Set();
      scanStandalone = false;
      const proofChanged = new Set(request.typescript ? accept?.(generation) ?? [] : []);
      const next = new Map(discovered.map(source => [source.uri, source]));
      for (const [uri, source] of sources) {
        const searched = source.languageId === "hson" ? request.standalone : request.typescript;
        if (!searched || next.has(uri)) continue;
        sources.delete(uri); fingerprints.delete(uri);
        const opened = open(uri);
        if (opened === undefined) { cancel(uri); advance(uri); publisher.delete(uri); }
        else if (source.eventEvidence !== undefined) analyzeOpen(opened);
      }
      const added: WorkspaceDiagnosticSource[] = [];
      for (const source of discovered) {
        const prior = sources.get(source.uri);
        const evidenceChanged = prior?.eventEvidence?.textHash !== source.eventEvidence?.textHash
          || prior?.eventEvidence?.importOffsets.join(",") !== source.eventEvidence?.importOffsets.join(",");
        if (!evidenceChanged && prior?.fileName === source.fileName
          && prior.languageId === source.languageId && prior.authoringMode === source.authoringMode) {
          const opened = open(source.uri);
          if (opened !== undefined && proofChanged.has(source.uri)) analyzeOpen(opened);
          else if (fingerprints.get(source.uri) === null && opened === undefined) added.push(prior);
          continue;
        }
        sources.set(source.uri, source);
        fingerprints.delete(source.uri);
        const opened = source.languageId === "hson" ? undefined : open(source.uri);
        if (opened === undefined) added.push(source);
        else if (evidenceChanged || proofChanged.has(source.uri)) analyzeOpen(opened);
      }
      await analyzeBatch(added);
    } catch (error) {
      if (!disposed && discoveryGeneration === generation) host.reportUnexpected(error);
    }
  };
  const scheduleRefresh = (scope: WorkspaceDiscoveryScope = "projects", change?: WorkspaceSourceChange,
    projects?: readonly string[]): void => {
    // Invalidate pending discovery immediately, including during the debounce window.
    discoveryGeneration += 1;
    if (scope !== "projects") scanStandalone = true;
    if (scope !== "standalone") {
      // Topology notifications require a full scan. The sender still needs the
      // path and the notification kind to decide which proof to withdraw.
      if (change === undefined || change.affectsTypeScriptProjects && change.kind !== "change") changedUris = undefined;
      else changedUris?.add(change.uri);
      const affected = change?.observationOnly ? [] : host.invalidateProjects?.(discoveryGeneration, change, projects) ?? [];
      invalidateSources(affected);
    }
    if (discoveryTimer !== undefined) host.clearTimer(discoveryTimer);
    discoveryTimer = host.setTimer(() => { discoveryTimer = undefined; void refresh(); }, discoveryDebounce);
  };

  const subscriptions = [
    host.onDidOpen(analyzeOpen),
    host.onDidChange(scheduleOpen),
    host.onDidClose(document => {
      cancel(document.uri); advance(document.uri); fingerprints.delete(document.uri);
      const source = sources.get(document.uri);
      if (source === undefined) publisher.delete(document.uri);
      else void analyzeDisk(source, true);
    }),
    host.onDidChangeSources(changes => {
      for (const change of changes) {
        const source = sources.get(change.uri);
        if (change.affectsTypeScriptProjects) {
          scheduleRefresh("projects", change);
        } else if (change.kind !== "change" && (source?.languageId === "hson" || /\.hson(?:$|[?#])/i.test(change.uri))) {
          scheduleRefresh("standalone");
        } else if (change.kind === "delete" || change.kind === "create" && source === undefined) {
          scheduleRefresh("projects", change);
        }
        if (change.kind === "delete") {
          fingerprints.delete(change.uri);
          if (open(change.uri) === undefined) {
            sources.delete(change.uri); cancel(change.uri); advance(change.uri); publisher.delete(change.uri);
          }
          continue;
        }
        if (source !== undefined && open(change.uri) === undefined) void analyzeDisk(source, true);
      }
    }),
    host.onDidChangeProjects((scope, projects) => scheduleRefresh(scope, undefined, projects)),
  ];
  for (const document of host.openDocuments()) analyzeOpen(document);
  void refresh();

  return Object.freeze({ dispose(): void {
    if (disposed) return;
    disposed = true;
    for (const subscription of subscriptions) subscription.dispose();
    for (const uri of timers.keys()) cancel(uri);
    if (discoveryTimer !== undefined) host.clearTimer(discoveryTimer);
    for (const uri of sources.keys()) advance(uri);
  }});
}
