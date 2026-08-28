import * as messages from "./diagnostic-messages.js";
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
import { hson_highlights, hsonTokenScopes, load_hson_grammar } from "./highlighting.js";
import {
  HSON_LIBRARY_SEPARATOR_COLOR_ID,
  hson_identity_presentation,
  hsonIdentityMarkers,
} from "./authoring-marker.js";
import {
  HSON_SETTINGS_QUERY,
  TRUSTED_CONFIGURATION_KEYS,
  TRUSTED_CONFIGURATION_SECTION,
  appearance_color,
  marker_strength,
  marker_color_key,
  trusted_consent_key,
  trusted_execution_fingerprint,
  type TrustedExecutionConfiguration,
} from "./settings.js";

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

function explicitAppearanceColor(
  appearance: vscode.WorkspaceConfiguration,
  key: string,
): string | undefined {
  const inspected = appearance.inspect<string>(key);
  if (inspected === undefined) return undefined;
  const explicitlyConfigured = inspected.globalValue !== undefined
    || inspected.workspaceValue !== undefined
    || inspected.workspaceFolderValue !== undefined
    || inspected.globalLanguageValue !== undefined
    || inspected.workspaceLanguageValue !== undefined
    || inspected.workspaceFolderLanguageValue !== undefined;
  return explicitlyConfigured ? appearance_color(appearance.get<string>(key)) : undefined;
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
      console.error(messages.unexpectedDiagnosticsFailure(document.fileName), error);
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
  // Independent of all trusted clients, associations and completion providers.
  const legend = new vscode.SemanticTokensLegend(Object.keys(hsonTokenScopes));
  const grammar = load_hson_grammar(context.extensionPath);
  context.subscriptions.push(vscode.languages.registerDocumentSemanticTokensProvider(
    [{ language: "typescript" }, { language: "typescriptreact" }], {
      async provideDocumentSemanticTokens(document, cancellation) {
        const version = document.version, text = document.getText();
        const loaded = await grammar;
        if (cancellation.isCancellationRequested || document.isClosed || document.version !== version) return undefined;
        const builder = new vscode.SemanticTokensBuilder(legend);
        for (const token of hson_highlights(loaded, document.fileName, text)) {
          builder.push(new vscode.Range(document.positionAt(token.range.start), document.positionAt(token.range.end)), token.type);
        }
        if (cancellation.isCancellationRequested || document.version !== version) return undefined;
        return builder.build();
      },
    }, legend));
  // Exact h/s/o/n and H/S/O/N identity colors are presentation-only. Binding
  // discovery is the authority; decoration never participates in admission.
  let markerDecorations = new Map<string, vscode.TextEditorDecorationType>();
  let colorLibraryMarker = true;
  const replaceMarkerDecorations = (): void => {
    for (const decoration of markerDecorations.values()) decoration.dispose();
    const appearance = vscode.workspace.getConfiguration("hson.appearance");
    const libraryStrength = marker_strength(appearance.get<number>("libraryMarkerStrength"), 1);
    const authoringStrength = marker_strength(appearance.get<number>("authoringMarkerStrength"), 0.7);
    colorLibraryMarker = appearance.get<boolean>("colorLibraryMarker", true);
    markerDecorations = new Map(hsonIdentityMarkers.map((marker): [string, vscode.TextEditorDecorationType] => {
      const colorKey = marker_color_key(marker.letter);
      const explicitColor = colorKey === undefined ? undefined : explicitAppearanceColor(appearance, colorKey);
      return [marker.colorId,
        vscode.window.createTextEditorDecorationType({
          color: explicitColor ?? new vscode.ThemeColor(marker.colorId),
          opacity: String(marker.strength === "strong" ? libraryStrength : authoringStrength),
        })];
    }).concat([[
      HSON_LIBRARY_SEPARATOR_COLOR_ID,
      vscode.window.createTextEditorDecorationType({
        color: explicitAppearanceColor(appearance, "librarySeparatorColor")
          ?? new vscode.ThemeColor(HSON_LIBRARY_SEPARATOR_COLOR_ID),
        opacity: String(libraryStrength),
      }),
    ]]));
  };
  replaceMarkerDecorations();
  const presentMarkers = (editor: vscode.TextEditor): void => {
    const document = editor.document;
    const presentation = document.languageId === "typescript" || document.languageId === "typescriptreact"
      ? hson_identity_presentation(document.fileName, document.getText(), colorLibraryMarker)
      : { markers: [], separators: [] };
    for (const marker of hsonIdentityMarkers) {
      const decoration = markerDecorations.get(marker.colorId);
      if (decoration === undefined) continue;
      editor.setDecorations(decoration, presentation.markers.filter(part => part.colorId === marker.colorId).map(part =>
        new vscode.Range(document.positionAt(part.range.start), document.positionAt(part.range.end))));
    }
    const separatorDecoration = markerDecorations.get(HSON_LIBRARY_SEPARATOR_COLOR_ID);
    if (separatorDecoration !== undefined) {
      editor.setDecorations(separatorDecoration, presentation.separators.map(part =>
        new vscode.Range(document.positionAt(part.range.start), document.positionAt(part.range.end))));
    }
  };
  const presentVisibleMarkers = (): void => {
    for (const editor of vscode.window.visibleTextEditors) presentMarkers(editor);
  };
  presentVisibleMarkers();
  context.subscriptions.push({ dispose(): void { for (const decoration of markerDecorations.values()) decoration.dispose(); } },
    vscode.window.onDidChangeVisibleTextEditors(presentVisibleMarkers),
    vscode.workspace.onDidChangeTextDocument(event => {
      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document === event.document) presentMarkers(editor);
      }
    }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (!event.affectsConfiguration("hson.appearance")) return;
      replaceMarkerDecorations();
      presentVisibleMarkers();
    }));
  const schemaCollection = vscode.languages.createDiagnosticCollection("hson-schema");
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 10);
  const output = vscode.window.createOutputChannel("HSON Schema diagnostics");
  const statuses = new Map<string, { status: SchemaStatus; message?: string }>();
  const clients = new Map<string, TrustedSchemaClient>();
  const files = new Map<string, ReadonlySet<string>>();
  const staleProviders = new Set<string>();
  const pendingConsent = new Set<string>();
  const documentTexts = new Map(vscode.workspace.textDocuments.map(doc => [doc.uri.toString(), doc.getText()]));
  const executionConfiguration = (uri: vscode.Uri): TrustedExecutionConfiguration => {
    const configuration = vscode.workspace.getConfiguration(TRUSTED_CONFIGURATION_SECTION, uri);
    return {
      module: configuration.get<string>("module", ""),
      hsonModule: configuration.get<string>("hsonModule", ""),
      runtimeEntry: configuration.get<string>("runtimeEntry", ""),
      execArgv: configuration.get<string[]>("execArgv", []),
    };
  };
  const hasConsent = (folder: vscode.WorkspaceFolder, uri: vscode.Uri): boolean => context.workspaceState.get<string>(
    trusted_consent_key(folder.uri.toString()),
  ) === trusted_execution_fingerprint(executionConfiguration(uri));
  const trustedExecutionAvailable = (uri: vscode.Uri): boolean => {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    const configuration = vscode.workspace.getConfiguration(TRUSTED_CONFIGURATION_SECTION, uri);
    return vscode.workspace.isTrusted && folder !== undefined && configuration.get<boolean>("enabled", false)
      && hasConsent(folder, uri);
  };
  const describe = (): void => {
    const uri = vscode.window.activeTextEditor?.document.uri.toString();
    const state = uri === undefined ? undefined : statuses.get(uri);
    statusBar.text = messages.schemaStatusLabel(state?.status);
    statusBar.tooltip = messages.schemaStatusTooltip(state?.status, state?.message);
    statusBar.show();
  };
  const enabled = (): boolean => vscode.workspace.isTrusted;
  const schemaPublisher: DiagnosticPublisher = {
    set(document, specs): void {
      const current = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === document.uri && doc.version === document.version);
      if (current === undefined) return;
      schemaCollection.set(current.uri, specs.map(spec => {
        const diagnostic = new vscode.Diagnostic(toRange(current, spec), spec.message, vscode.DiagnosticSeverity.Error);
        diagnostic.source = spec.runtimeAdmission ? "HSON" : "HSON Schema"; diagnostic.code = spec.code;
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
      const config = vscode.workspace.getConfiguration(TRUSTED_CONFIGURATION_SECTION, uri);
      if (folder === undefined || !trustedExecutionAvailable(uri)) return undefined;
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
      const uri = vscode.Uri.parse(document.uri);
      const config = vscode.workspace.getConfiguration(TRUSTED_CONFIGURATION_SECTION, uri);
      const folder = vscode.workspace.getWorkspaceFolder(uri);
      const configured = config.get<boolean>("enabled", false);
      const unavailableMessage = !configured ? "Trusted Schema diagnostics are disabled."
        : !vscode.workspace.isTrusted ? "Workspace Trust is required before project code can execute."
        : folder === undefined ? "The document is not contained by a workspace folder."
        : !hasConsent(folder, uri) ? "This provider/runtime configuration is awaiting explicit HSON consent."
        : message;
      statuses.set(document.uri, { status: configured && vscode.workspace.isTrusted && folder !== undefined && hasConsent(folder, uri)
        ? staleProviders.has(folder.uri.toString()) ? "stale" : status : "off", message: unavailableMessage });
      describe();
    },
    measure(result, perceivedMs) {
      if (result.measurement === undefined) return;
      output.appendLine(JSON.stringify({ ...result.measurement, perceivedMs, status: result.status }));
      if (result.measurement.endToEndMs >= 2_000) output.appendLine(messages.slowSchemaRequest);
    },
  });
  const reconfigure = (): void => {
    controller.retire();
    for (const client of clients.values()) client.dispose();
    clients.clear(); files.clear(); staleProviders.clear();
    controller.refresh();
  };
  const selectedFolder = (): vscode.WorkspaceFolder | undefined => {
    const active = vscode.window.activeTextEditor?.document.uri;
    return active === undefined ? vscode.workspace.workspaceFolders?.[0] : vscode.workspace.getWorkspaceFolder(active);
  };
  const resourceFor = (folder: vscode.WorkspaceFolder): vscode.Uri => {
    const active = vscode.window.activeTextEditor?.document.uri;
    return active !== undefined && vscode.workspace.getWorkspaceFolder(active)?.uri.toString() === folder.uri.toString()
      ? active : folder.uri;
  };
  const requestConsent = async (folder: vscode.WorkspaceFolder, resource: vscode.Uri): Promise<boolean> => {
    const key = folder.uri.toString();
    if (hasConsent(folder, resource)) return true;
    if (!vscode.workspace.isTrusted) {
      void vscode.window.showWarningMessage("HSON trusted Schema diagnostics remain off until this workspace is trusted through VS Code Workspace Trust.");
      return false;
    }
    const execution = executionConfiguration(resource);
    if (!execution.module || !execution.hsonModule) {
      void vscode.window.showWarningMessage("Configure both the HSON Provider Entry and HSON Runtime Module before enabling trusted Schema diagnostics.", "Open HSON Settings")
        .then(action => action === "Open HSON Settings" && vscode.commands.executeCommand("hson.openSettings"));
      return false;
    }
    if (pendingConsent.has(key)) return false;
    pendingConsent.add(key);
    try {
      const allow = process.env.HSON_D2_TEST_WORKSPACE !== undefined ? "Allow Trusted Execution" : await vscode.window.showWarningMessage(
        `Allow HSON to execute project code from “${folder.name}” with your user permissions in a supervised separate process? Schema definitions, constraints, recurse callbacks, and module initialization may run. This is not a security sandbox.`,
        { modal: true },
        "Allow Trusted Execution",
      );
      if (allow !== "Allow Trusted Execution") return false;
      await context.workspaceState.update(trusted_consent_key(key), trusted_execution_fingerprint(execution));
      reconfigure();
      return true;
    } finally {
      pendingConsent.delete(key);
    }
  };
  const updateEnabled = async (value: boolean): Promise<void> => {
    const folder = selectedFolder();
    if (folder === undefined) {
      void vscode.window.showWarningMessage("Open a workspace folder before configuring HSON trusted Schema diagnostics.");
      return;
    }
    const resource = resourceFor(folder);
    const configuration = vscode.workspace.getConfiguration(TRUSTED_CONFIGURATION_SECTION, resource);
    const target = (vscode.workspace.workspaceFolders?.length ?? 0) > 1
      ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Workspace;
    await configuration.update("enabled", value, target);
    if (!value) {
      await context.workspaceState.update(trusted_consent_key(folder.uri.toString()), undefined);
      reconfigure();
      return;
    }
    await requestConsent(folder, resource);
  };
  statusBar.command = "hson.openSettings";
  context.subscriptions.push(
    vscode.commands.registerCommand("hson.openSettings", () => vscode.commands.executeCommand("workbench.action.openSettings", HSON_SETTINGS_QUERY)),
    vscode.commands.registerCommand("hson.enableTrustedSchemaDiagnostics", () => updateEnabled(true)),
    vscode.commands.registerCommand("hson.disableTrustedSchemaDiagnostics", () => updateEnabled(false)),
    vscode.commands.registerCommand("hson.restartTrustedSchemaRuntime", async () => {
      const folder = selectedFolder();
      if (folder === undefined || !trustedExecutionAvailable(resourceFor(folder))) {
        void vscode.window.showWarningMessage("HSON trusted Schema diagnostics are not currently authorized and available.");
        return;
      }
      reconfigure();
      void vscode.window.showInformationMessage("HSON trusted Schema runtime restarted.");
    }),
  );
  // Manual invocation only: no punctuation-trigger spam or expression ownership.
  context.subscriptions.push(vscode.languages.registerCompletionItemProvider(["typescript", "typescriptreact"], {
    async provideCompletionItems(document, position, token) {
      const folder = vscode.workspace.getWorkspaceFolder(document.uri);
      if (folder === undefined || !trustedExecutionAvailable(document.uri)) return [];
      const key = folder.uri.toString();
      const client = clients.get(key);
      if (client === undefined || staleProviders.has(key)) return [];
      const snapshot = adaptDocument(document);
      const current = () => !token.isCancellationRequested && document.version === snapshot.version && clients.get(key) === client
        && !staleProviders.has(key) && trustedExecutionAvailable(document.uri);
      const result = await client.complete(snapshot, document.offsetAt(position), current);
      if (!current() || result.completion?.range === undefined) return [];
      const started = performance.now();
      const range = new vscode.Range(document.positionAt(result.completion.range.start), document.positionAt(result.completion.range.end));
      const items = result.completion.items.map(spec => {
        const item = new vscode.CompletionItem(spec.label, spec.kind === "literal" ? vscode.CompletionItemKind.Value : spec.kind === "tag" ? vscode.CompletionItemKind.Class : vscode.CompletionItemKind.Property);
        item.range = range;
        item.insertText = spec.snippet ? new vscode.SnippetString(spec.insertText) : spec.insertText;
        item.detail = messages.schemaCompletionDetail(spec.detail);
        item.sortText = spec.sortText;
        return item;
      });
      output.appendLine(JSON.stringify({ completion: true, ...result.measurement, ...result.completion.timings, itemConstructionMs: performance.now() - started }));
      return items;
    },
  }));
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
    vscode.workspace.onDidChangeConfiguration(event => {
      if (!TRUSTED_CONFIGURATION_KEYS.some(key => event.affectsConfiguration(key))) return;
      reconfigure();
      for (const folder of vscode.workspace.workspaceFolders ?? []) {
        const resource = resourceFor(folder);
        if (vscode.workspace.getConfiguration(TRUSTED_CONFIGURATION_SECTION, resource).get<boolean>("enabled", false)) {
          void requestConsent(folder, resource);
        }
      }
    }),
    vscode.workspace.onDidGrantWorkspaceTrust(reconfigure),
    vscode.workspace.onDidChangeWorkspaceFolders(reconfigure),
    vscode.window.onDidChangeActiveTextEditor(describe),
    { dispose(): void { for (const client of clients.values()) client.dispose(); clients.clear(); } });
}
