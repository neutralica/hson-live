import type { DiagnosticHost, DiagnosticPublisher, Disposable, DiagnosticDocument } from "./diagnostics.js";
import type { SchemaClientResult, SchemaStatus } from "./trusted-schema-client.js";

export type SchemaDiagnosticClient = Readonly<{
  invalidateDocument?(document: DiagnosticDocument): void;
  validate(document: DiagnosticDocument, current: () => boolean): Promise<SchemaClientResult>;
}>;
export type SchemaDiagnosticOptions = Readonly<{
  enabled(): boolean;
  clientFor(document: DiagnosticDocument): SchemaDiagnosticClient | undefined;
  status(document: DiagnosticDocument, status: SchemaStatus, message?: string): void;
  measure?(result: SchemaClientResult, perceivedMs: number): void;
  debounceMilliseconds?: number;
}>;

/** Publication owns editor identities; D1 owns process/request/generation identities. */
export function start_schema_diagnostics(host: DiagnosticHost, publisher: DiagnosticPublisher, options: SchemaDiagnosticOptions): Disposable & { refresh(): void; retire(status?: SchemaStatus, message?: string): void } {
  const tickets = new Map<string, number>();
  const timers = new Map<string, unknown>();
  let sequence = 0, disposed = false;
  const cancel = (uri: string): void => {
    tickets.set(uri, ++sequence);
    const timer = timers.get(uri);
    if (timer !== undefined) host.clearTimer(timer);
    timers.delete(uri);
    publisher.delete(uri);
  };
  const schedule = (document: DiagnosticDocument): void => {
    cancel(document.uri);
    if (disposed) return;
    if (!options.enabled()) { options.status(document, "off"); return; }
    const ticket = tickets.get(document.uri);
    const started = performance.now();
    const current = (): boolean => !disposed && options.enabled() && tickets.get(document.uri) === ticket
      && host.openDocuments().some(doc => doc.uri === document.uri && doc.version === document.version && doc.text === document.text);
    options.status(document, "waiting");
    timers.set(document.uri, host.setTimer(() => {
      timers.delete(document.uri);
      if (!current()) return;
      const client = options.clientFor(document);
      if (client === undefined) { options.status(document, "unavailable"); return; }
      void client.validate(document, current).then(result => {
        if (!current()) return;
        publisher.set(document, result.diagnostics);
        options.status(document, result.status, result.message);
        options.measure?.(result, performance.now() - started);
      }).catch(error => {
        if (!current()) return;
        publisher.delete(document.uri);
        options.status(document, "runtime-failed", error instanceof Error ? error.message : "Runtime failed.");
      });
    }, options.debounceMilliseconds ?? 150));
  };
  const opened = host.onDidOpen(schedule), changed = host.onDidChange(document => {
    // Retire before debounce, including edit/revert sequences with equal bytes.
    cancel(document.uri);
    if (options.enabled()) options.clientFor(document)?.invalidateDocument?.(document);
    schedule(document);
  });
  const closed = host.onDidClose(doc => cancel(doc.uri));
  const refresh = (): void => { for (const doc of host.openDocuments()) schedule(doc); };
  refresh();
  return {
    refresh,
    retire(status: SchemaStatus = "stale", message?: string): void { for (const doc of host.openDocuments()) { cancel(doc.uri); options.status(doc, options.enabled() ? status : "off", message); } },
    dispose(): void { disposed = true; opened.dispose(); changed.dispose(); closed.dispose(); for (const uri of tickets.keys()) cancel(uri); },
  };
}
