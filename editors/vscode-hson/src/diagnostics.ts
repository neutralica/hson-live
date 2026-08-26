import {
  is_supported_document,
  produce_document_diagnostics,
  type DocumentDiagnosticInput,
  type DocumentDiagnosticSpec,
} from "./document-diagnostics.js";

export type DiagnosticDocument = DocumentDiagnosticInput & Readonly<{
  uri: string;
  version: number;
}>;

export type Disposable = Readonly<{ dispose(): void }>;

export type DiagnosticHost = Readonly<{
  openDocuments(): readonly DiagnosticDocument[];
  onDidOpen(listener: (document: DiagnosticDocument) => void): Disposable;
  onDidChange(listener: (document: DiagnosticDocument) => void): Disposable;
  onDidClose(listener: (document: DiagnosticDocument) => void): Disposable;
  setTimer(callback: () => void, delayMilliseconds: number): unknown;
  clearTimer(timer: unknown): void;
  reportUnexpected(error: unknown, document: DiagnosticDocument): void;
}>;

export type DiagnosticPublisher = Readonly<{
  set(document: DiagnosticDocument, diagnostics: readonly DocumentDiagnosticSpec[]): void;
  delete(uri: string): void;
}>;

export type DiagnosticControllerOptions = Readonly<{
  debounceMilliseconds?: number;
  produce?: (input: DocumentDiagnosticInput) => readonly DocumentDiagnosticSpec[];
}>;

function currentDocument(
  host: DiagnosticHost,
  uri: string,
): DiagnosticDocument | undefined {
  return host.openDocuments().find((document) => document.uri === uri);
}

export function start_diagnostics(
  host: DiagnosticHost,
  publisher: DiagnosticPublisher,
  options: DiagnosticControllerOptions = {},
): Disposable {
  const debounceMilliseconds = options.debounceMilliseconds ?? 150;
  const produce = options.produce ?? produce_document_diagnostics;
  const timers = new Map<string, unknown>();
  let disposed = false;

  const cancel = (uri: string): void => {
    const timer = timers.get(uri);
    if (timer !== undefined) host.clearTimer(timer);
    timers.delete(uri);
  };

  const analyze = (scheduled: DiagnosticDocument): void => {
    if (disposed) return;
    const before = currentDocument(host, scheduled.uri);
    if (before === undefined || before.version !== scheduled.version) return;
    if (!is_supported_document(before)) {
      publisher.delete(before.uri);
      return;
    }
    try {
      const diagnostics = produce(before);
      const after = currentDocument(host, scheduled.uri);
      if (after === undefined || after.version !== scheduled.version) return;
      publisher.set(after, diagnostics);
    } catch (error) {
      publisher.delete(before.uri);
      host.reportUnexpected(error, before);
    }
  };

  const schedule = (document: DiagnosticDocument): void => {
    cancel(document.uri);
    const scheduled = Object.freeze({ ...document });
    const timer = host.setTimer(() => {
      timers.delete(scheduled.uri);
      analyze(scheduled);
    }, debounceMilliseconds);
    timers.set(document.uri, timer);
  };

  const opened = host.onDidOpen((document) => {
    cancel(document.uri);
    analyze(document);
  });
  const changed = host.onDidChange(schedule);
  const closed = host.onDidClose((document) => {
    cancel(document.uri);
    publisher.delete(document.uri);
  });

  for (const document of host.openDocuments()) analyze(document);

  return Object.freeze({
    dispose(): void {
      if (disposed) return;
      disposed = true;
      opened.dispose();
      changed.dispose();
      closed.dispose();
      for (const uri of timers.keys()) cancel(uri);
    },
  });
}
