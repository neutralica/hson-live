import * as vscode from "vscode";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { TrustedSchemaClient, type SchemaStatus } from "./trusted-schema-client.js";
import { start_schema_diagnostics } from "./schema-diagnostics.js";
import { TrustedSchemaInfrastructureError } from "../../../src/internal/trusted-schema-diagnostics/node-supervisor.js";
import { schema_provider_source_changed } from "./schema-source-revision.js";

import {
  start_diagnostics,
  type DiagnosticDocument,
  type DiagnosticHost,
  type DiagnosticPublisher,
} from "./diagnostics.js";
import type { DocumentDiagnosticSpec } from "./document-diagnostics.js";

function adaptDocument(document: vscode.TextDocument): DiagnosticDocument {
  return Object.freeze({
    uri: document.uri.toString(),
    version: document.version,
    languageId: document.languageId,
    fileName: document.fileName,
    text: document.getText(),
  });
}

function toRange(document: vscode.TextDocument, spec: DocumentDiagnosticSpec): vscode.Range {
  return new vscode.Range(
    document.positionAt(spec.range.start),
    document.positionAt(spec.range.end),
  );
}

export function activate(context: vscode.ExtensionContext): void {
  const collection = vscode.languages.createDiagnosticCollection("hson");
  context.subscriptions.push(collection);

  const host: DiagnosticHost = {
    openDocuments: () => vscode.workspace.textDocuments.map(adaptDocument),
    onDidOpen: (listener) => vscode.workspace.onDidOpenTextDocument((document) => listener(adaptDocument(document))),
    onDidChange: (listener) => vscode.workspace.onDidChangeTextDocument((event) => listener(adaptDocument(event.document))),
    onDidClose: (listener) => vscode.workspace.onDidCloseTextDocument((document) => listener(adaptDocument(document))),
    setTimer: (callback, delayMilliseconds) => setTimeout(callback, delayMilliseconds),
    clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
    reportUnexpected: (error, document) => {
      console.error(`HSON diagnostics failed for ${document.fileName}`, error);
    },
  };
  const publisher: DiagnosticPublisher = {
    set(document, specs): void {
      const current = vscode.workspace.textDocuments.find(
        (candidate) => candidate.uri.toString() === document.uri,
      );
      if (current === undefined || current.version !== document.version) return;
      const diagnostics = specs.map((spec) => {
        const diagnostic = new vscode.Diagnostic(
          toRange(current, spec),
          spec.message,
          vscode.DiagnosticSeverity.Error,
        );
        diagnostic.source = spec.source;
        diagnostic.code = spec.code;
        diagnostic.relatedInformation = spec.related.map((related) =>
          new vscode.DiagnosticRelatedInformation(
            new vscode.Location(
              current.uri,
              new vscode.Range(
                current.positionAt(related.range.start),
                current.positionAt(related.range.end),
              ),
            ),
            related.message,
          ));
        return diagnostic;
      });
      collection.set(current.uri, diagnostics);
    },
    delete(uri): void {
      collection.delete(vscode.Uri.parse(uri));
    },
  };

  context.subscriptions.push(start_diagnostics(host, publisher));
  const schemaCollection = vscode.languages.createDiagnosticCollection("hson-schema");
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 10);
  const output = vscode.window.createOutputChannel("HSON Schema diagnostics");
  const statuses = new Map<string, { status: SchemaStatus; message?: string }>();
  const clients = new Map<string, TrustedSchemaClient>();
  const files = new Map<string, ReadonlySet<string>>();
  const staleProviders = new Set<string>();
  const documentTexts = new Map(vscode.workspace.textDocuments.map(doc => [doc.uri.toString(), doc.getText()]));
  const describe = (): void => {
    const uri = vscode.window.activeTextEditor?.document.uri.toString();
    const state = uri === undefined ? undefined : statuses.get(uri);
    statusBar.text = `HSON Schema: ${state?.status ?? "off"}`;
    statusBar.tooltip = state?.message ?? (state?.status === "current-valid" || state?.status === "current-invalid"
      ? "Current editor candidate checked against current mapped Schema. Application validation has not been executed; stateful predicates may change."
      : "Trusted Schema diagnostics require Workspace Trust, explicit enablement, and a current registered source binding. No diagnostics does not mean Schema passed.");
    statusBar.show();
  };
  const enabled = (): boolean => vscode.workspace.isTrusted;
  const schemaPublisher: DiagnosticPublisher = {
    set(document, specs): void {
      const current = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === document.uri && doc.version === document.version);
      if (current === undefined) return;
      schemaCollection.set(current.uri, specs.map(spec => {
        const diagnostic = new vscode.Diagnostic(toRange(current, spec), spec.message, vscode.DiagnosticSeverity.Error);
        diagnostic.source = "HSON Schema"; diagnostic.code = spec.code;
        diagnostic.relatedInformation = spec.related.map(item => new vscode.DiagnosticRelatedInformation(new vscode.Location(current.uri,
          new vscode.Range(current.positionAt(item.range.start), current.positionAt(item.range.end))), item.message));
        return diagnostic;
      }));
    },
    delete(uri): void { schemaCollection.delete(vscode.Uri.parse(uri)); },
  };
  const controller = start_schema_diagnostics(host, schemaPublisher, {
    enabled,
    clientFor(document) {
      if (!vscode.workspace.isTrusted) return undefined;
      const uri = vscode.Uri.parse(document.uri);
      const folder = vscode.workspace.getWorkspaceFolder(uri);
      const config = vscode.workspace.getConfiguration("hson.trustedSchemaDiagnostics", uri);
      if (!config.get<boolean>("enabled", false) || folder === undefined) return undefined;
      const key = folder.uri.toString();
      if (staleProviders.has(key)) return undefined;
      const previous = clients.get(key);
      if (previous !== undefined) return previous;
      const module = config.get<string>("module", "");
      const hsonModule = config.get<string>("hsonModule", "");
      if (!module || !hsonModule) return undefined;
      const modulePath = resolve(folder.uri.fsPath, module);
      const hsonPath = resolve(folder.uri.fsPath, hsonModule);
      const entry = config.get<string>("runtimeEntry", "");
      const client = new TrustedSchemaClient({
        trust: { workspaceTrusted: vscode.workspace.isTrusted, enabled: true },
        moduleUrl: pathToFileURL(modulePath).href, hsonModuleUrl: pathToFileURL(hsonPath).href,
        runtimeEntry: entry ? resolve(folder.uri.fsPath, entry) : resolve(dirname(hsonPath), "internal/trusted-schema-diagnostics/node-runtime-entry.js"),
        execArgv: config.get<string[]>("execArgv", []),
        startupDeadlineMs: 5_000,
      });
      client.supervisor.onRetired(reason => controller.retire(reason instanceof TrustedSchemaInfrastructureError && reason.code === "RUNTIME_RETIRED" ? "stale" : "runtime-failed", reason.message));
      clients.set(key, client); files.set(key, new Set([modulePath, hsonPath, entry ? resolve(folder.uri.fsPath, entry) : resolve(dirname(hsonPath), "internal/trusted-schema-diagnostics/node-runtime-entry.js")]));
      return client;
    },
    status(document, status, message) {
      const config = vscode.workspace.getConfiguration("hson.trustedSchemaDiagnostics", vscode.Uri.parse(document.uri));
      const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.parse(document.uri));
      statuses.set(document.uri, { status: config.get<boolean>("enabled", false) && vscode.workspace.isTrusted
        ? folder !== undefined && staleProviders.has(folder.uri.toString()) ? "stale" : status : "off", message });
      describe();
    },
    measure(result, perceivedMs) {
      if (result.measurement === undefined) return;
      output.appendLine(JSON.stringify({ ...result.measurement, perceivedMs, status: result.status }));
      if (result.measurement.endToEndMs >= 2_000) output.appendLine("Slow trusted diagnostic request (>= 2 seconds); includes cold load if this is the first request.");
    },
  });
  const reconfigure = (): void => {
    controller.retire();
    for (const client of clients.values()) client.dispose();
    clients.clear(); files.clear(); staleProviders.clear();
    controller.refresh();
  };
  const watcher = vscode.workspace.createFileSystemWatcher("**/*.{js,mjs,cjs,ts,mts,cts}");
  const changed = (uri: vscode.Uri): void => {
    for (const [key, client] of clients) {
      if (files.get(key)?.has(uri.fsPath) || client.schemaModuleUrls.includes(uri.toString())) {
        client.invalidate();
        if (!vscode.workspace.textDocuments.some(doc => doc.uri.toString() === uri.toString() && doc.isDirty)) staleProviders.delete(key);
        controller.refresh();
      }
    }
  };
  context.subscriptions.push(schemaCollection, statusBar, output, controller, watcher,
    watcher.onDidChange(changed), watcher.onDidCreate(changed), watcher.onDidDelete(changed),
    vscode.workspace.onDidOpenTextDocument(doc => documentTexts.set(doc.uri.toString(), doc.getText())),
    vscode.workspace.onDidCloseTextDocument(doc => documentTexts.delete(doc.uri.toString())),
    vscode.workspace.onDidChangeTextDocument(event => {
      const doc = event.document;
      const previous = documentTexts.get(doc.uri.toString());
      documentTexts.set(doc.uri.toString(), doc.getText());
      for (const [key, client] of clients) {
        if ((files.get(key)?.has(doc.fileName) || client.schemaModuleUrls.includes(doc.uri.toString()))
          && (previous === undefined || schema_provider_source_changed(doc.fileName, previous, doc.getText()))) {
          staleProviders.add(key); client.invalidate(); controller.retire();
        }
      }
    }),
    vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration("hson.trustedSchemaDiagnostics")) reconfigure(); }),
    vscode.workspace.onDidGrantWorkspaceTrust(reconfigure),
    vscode.workspace.onDidChangeWorkspaceFolders(reconfigure),
    vscode.window.onDidChangeActiveTextEditor(describe),
    { dispose(): void { for (const client of clients.values()) client.dispose(); clients.clear(); } });
}
