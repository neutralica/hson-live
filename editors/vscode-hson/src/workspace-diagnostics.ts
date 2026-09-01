import {
  is_supported_document,
  produce_document_diagnostics,
  type DocumentDiagnosticInput,
  type DocumentDiagnosticSpec,
} from "./document-diagnostics.js";
import type { DiagnosticDocument, DiagnosticPublisher, Disposable } from "./diagnostics.js";

export type WorkspaceDiagnosticSource = Readonly<{
  uri: string;
  fileName: string;
  languageId: "hson" | "typescript" | "typescriptreact";
}>;

export type WorkspaceSourceChange = Readonly<{
  uri: string;
  kind: "create" | "change" | "delete";
}>;

export type WorkspaceDiagnosticHost = Readonly<{
  openDocuments(): readonly DiagnosticDocument[];
  discoverSources(): Promise<readonly WorkspaceDiagnosticSource[]>;
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
  return text.includes("Hson") || text.includes("fromHson");
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
      const specs = document.languageId !== "hson" && !tsCandidate(document.text) ? [] : produce(document);
      if (disposed || generations.get(document.uri) !== generation) return;
      const after = open(document.uri);
      if (after !== undefined && after.version !== document.version) return;
      fingerprints.set(document.uri, `${document.languageId}\0${document.text}`);
      publisher.set(document, specs);
    } catch (error) {
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
    if (disposed || open(source.uri) !== undefined) return;
    const generation = advance(source.uri);
    try {
      const text = await host.readSource(source);
      if (disposed || generations.get(source.uri) !== generation || open(source.uri) !== undefined || sources.get(source.uri) !== source) return;
      const fingerprint = `${source.languageId}\0${text}`;
      if (!force && fingerprints.get(source.uri) === fingerprint) return;
      publish(Object.freeze({ ...source, version: -generation, text }), generation);
    } catch (error) {
      if (generations.get(source.uri) === generation && open(source.uri) === undefined) publisher.delete(source.uri);
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
    try {
      const discovered = await host.discoverSources();
      if (disposed) return;
      const next = new Map(discovered.map(source => [source.uri, source]));
      for (const uri of sources.keys()) {
        if (next.has(uri)) continue;
        sources.delete(uri); fingerprints.delete(uri); cancel(uri); advance(uri);
        if (open(uri) === undefined) publisher.delete(uri);
      }
      const added: WorkspaceDiagnosticSource[] = [];
      for (const source of discovered) {
        const prior = sources.get(source.uri);
        sources.set(source.uri, source);
        if (prior === undefined) added.push(source);
      }
      await analyzeBatch(added);
    } catch (error) {
      host.reportUnexpected(error);
    }
  };
  const scheduleRefresh = (): void => {
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
          const wasKnown = sources.delete(change.uri);
          fingerprints.delete(change.uri); cancel(change.uri); advance(change.uri);
          if (open(change.uri) === undefined) publisher.delete(change.uri);
          if (wasKnown) scheduleRefresh();
          continue;
        }
        const source = sources.get(change.uri);
        if (source !== undefined && open(change.uri) === undefined) void analyzeDisk(source, true);
        if (change.kind === "create" && source === undefined) scheduleRefresh();
      }
    }),
    host.onDidChangeProjects(scheduleRefresh),
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
