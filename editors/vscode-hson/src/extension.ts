import * as vscode from "vscode";

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
}
