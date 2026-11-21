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
}>;

export type WorkspaceDiagnosticHost = Readonly<{
  openDocuments(): readonly DiagnosticDocument[];
  discoverSources(changedUris?: readonly string[], isCurrent?: () => boolean): Promise<readonly WorkspaceDiagnosticSource[]>;
  acceptSources?(sources: readonly WorkspaceDiagnosticSource[]): void;
  eventImports?: HsonEventImportEvidence;
  readSource(source: WorkspaceDiagnosticSource): Promise<string>;
  onDidOpen(listener: (document: DiagnosticDocument) => void): Disposable;
  onDidChange(listener: (document: DiagnosticDocument) => void): Disposable;
  onDidClose(listener: (document: DiagnosticDocument) => void): Disposable;
  onDidChangeSources(listener: (changes: readonly WorkspaceSourceChange[]) => void): Disposable;
  onDidChangeProjects(listener: () => void): Disposable;
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
  const fingerprints = new Map<string, string>();
  const timers = new Map<string, unknown>();
  let discoveryTimer: unknown | undefined;
  let discoveryGeneration = 0;
  let changedUris: Set<string> | undefined; // undefined requests a full project discovery.
  let disposed = false;

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
  const publish = (document: DiagnosticDocument, generation: number): void => {
    if (disposed || generations.get(document.uri) !== generation) return;
    const current = open(document.uri);
    if (current !== undefined && current.version !== document.version) return;
    try {
      const eventImports = host.eventImports?.(document.fileName, document.text);
      const specs = document.languageId !== "hson" && !eventImports?.size && !tsCandidate(document.text) ? [] : produce({
        ...document, eventImports,
      });
      if (disposed || generations.get(document.uri) !== generation) return;
      const after = open(document.uri);
      if (after !== undefined && after.version !== document.version) return;
      fingerprints.set(document.uri, `${document.languageId}\0${document.authoringMode ?? ''}\0${document.text}`);
      publisher.set(document, specs);
    } catch (error) {
      if (disposed) return;
      if (generations.get(document.uri) === generation) publisher.delete(document.uri);
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
    try {
      const text = await host.readSource(source);
      if (disposed || generations.get(source.uri) !== generation || open(source.uri) !== undefined || sources.get(source.uri) !== source) return;
      const fingerprint = `${source.languageId}\0${source.authoringMode ?? ''}\0${text}`;
      if (!force && fingerprints.get(source.uri) === fingerprint) return;
      publish(Object.freeze({ ...source, version: -generation, text }), generation);
    } catch (error) {
      if (disposed || generations.get(source.uri) !== generation || open(source.uri) !== undefined || sources.get(source.uri) !== source) return;
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
  const refresh = async (): Promise<void> => {
    if (disposed) return;
    const generation = ++discoveryGeneration;
    try {
      const isCurrent = () => !disposed && discoveryGeneration === generation;
      const discovered = await host.discoverSources(changedUris === undefined ? undefined : [...changedUris], isCurrent);
      if (!isCurrent()) return;
      changedUris = new Set();
      host.acceptSources?.(discovered);
      const next = new Map(discovered.map(source => [source.uri, source]));
      for (const [uri, source] of sources) {
        if (next.has(uri)) continue;
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
          && prior.languageId === source.languageId && prior.authoringMode === source.authoringMode) continue;
        sources.set(source.uri, source);
        fingerprints.delete(source.uri);
        const opened = source.languageId === "hson" ? undefined : open(source.uri);
        if (opened === undefined) added.push(source);
        else if (evidenceChanged) analyzeOpen(opened);
      }
      await analyzeBatch(added);
    } catch (error) {
      if (!disposed && discoveryGeneration === generation) host.reportUnexpected(error);
    }
  };
  const scheduleRefresh = (changedUri?: string): void => {
    // Invalidate pending discovery immediately, including during the debounce window.
    discoveryGeneration += 1;
    if (changedUri === undefined) changedUris = undefined;
    else changedUris?.add(changedUri);
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
        if (change.kind === "delete") {
          sources.delete(change.uri); fingerprints.delete(change.uri);
          if (open(change.uri) === undefined) { cancel(change.uri); advance(change.uri); publisher.delete(change.uri); }
          scheduleRefresh(change.affectsTypeScriptProjects ? undefined : change.uri);
          continue;
        }
        const source = sources.get(change.uri);
        if (source !== undefined && open(change.uri) === undefined) void analyzeDisk(source, true);
        if (change.affectsTypeScriptProjects || change.kind === "create" && source === undefined) {
          scheduleRefresh(change.kind === "create" && change.affectsTypeScriptProjects ? undefined : change.uri);
        }
      }
    }),
    host.onDidChangeProjects(() => scheduleRefresh()),
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
