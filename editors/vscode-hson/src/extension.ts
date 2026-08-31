import * as messages from "./diagnostic-messages.js";
import * as vscode from "vscode";
import { existsSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { resolve, dirname, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { TrustedSchemaClient, type SchemaStatus } from "./trusted-schema-client.js";
import { start_schema_diagnostics } from "./schema-diagnostics.js";
import { TrustedSchemaInfrastructureError } from "../../../src/internal/trusted-schema-diagnostics/node-supervisor.js";
import { schema_provider_source_changed } from "./schema-source-revision.js";
import { local_hson_schema_declarations, local_hson_schema_diagnostics } from "./hson-schema-local.js";
import {
  local_hson_schema_completion,
  local_hson_schema_symbols,
  rename_hson_schema_definition,
  schema_ref_completion_range,
  schema_target_at,
} from "./hson-schema-symbols.js";
import { discover_schema_project, resolve_workspace_hson_schema_tool } from "./schema-tooling.js";

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

  const localSchemaCollection = vscode.languages.createDiagnosticCollection("hson-schema-authoring");
  const schemaEvidenceCollection = vscode.languages.createDiagnosticCollection("hson-schema-evidence");
  const staleSchemaEvidence = new Set<string>();
  const schemaDeclarationSnapshots = new Map<string, string>();
  const publishSchemaEvidence = (document: vscode.TextDocument): void => {
    if (document.languageId !== "typescript" && document.languageId !== "typescriptreact") return;
    const declarations = local_hson_schema_declarations(document.getText());
    const stale = staleSchemaEvidence.has(document.uri.toString());
    const diagnostics: vscode.Diagnostic[] = [];
    for (const declaration of declarations) {
      const generated = resolve(document.fileName.slice(0, -extname(document.fileName).length) + `.${declaration.name}.hson-schema.generated.ts`);
      const metadata = generated.slice(0, -3) + "json";
      const range = new vscode.Range(document.positionAt(declaration.start), document.positionAt(declaration.end));
      if (!existsSync(generated) || !existsSync(metadata)) {
        const diagnostic = new vscode.Diagnostic(range, `Generated Hson Schema types for ${declaration.name} are missing. Generate Schema Types or start Hson Schema watch.`, vscode.DiagnosticSeverity.Warning);
        diagnostic.source = "Hson Schema"; diagnostic.code = "HSON_SCHEMA_GENERATED_EVIDENCE_MISSING"; diagnostics.push(diagnostic);
      } else if (stale) {
        const diagnostic = new vscode.Diagnostic(range, `Generated Hson Schema types for ${declaration.name} may be stale after this Schema edit. Generate Schema Types or start Hson Schema watch.`, vscode.DiagnosticSeverity.Warning);
        diagnostic.source = "Hson Schema"; diagnostic.code = "HSON_SCHEMA_GENERATED_EVIDENCE_STALE"; diagnostics.push(diagnostic);
      }
    }
    schemaEvidenceCollection.set(document.uri, diagnostics);
    schemaDeclarationSnapshots.set(document.uri.toString(), JSON.stringify(declarations.map(declaration => [declaration.name, declaration.template])));
  };
  const publishLocalSchema = (document: vscode.TextDocument): void => {
    if (document.languageId !== "typescript" && document.languageId !== "typescriptreact") return;
    localSchemaCollection.set(document.uri, local_hson_schema_diagnostics(document.fileName, document.getText()).map(spec => {
      const diagnostic = new vscode.Diagnostic(new vscode.Range(document.positionAt(spec.start), document.positionAt(spec.end)), spec.message, vscode.DiagnosticSeverity.Error);
      diagnostic.source = "Hson Schema"; diagnostic.code = spec.code; return diagnostic;
    }));
  };
  for (const document of vscode.workspace.textDocuments) { publishLocalSchema(document); publishSchemaEvidence(document); }
  context.subscriptions.push(localSchemaCollection, schemaEvidenceCollection,
    vscode.workspace.onDidOpenTextDocument(document => { publishLocalSchema(document); publishSchemaEvidence(document); }),
    vscode.workspace.onDidChangeTextDocument(event => {
      const before = schemaDeclarationSnapshots.get(event.document.uri.toString());
      const after = JSON.stringify(local_hson_schema_declarations(event.document.getText()).map(declaration => [declaration.name, declaration.template]));
      if (before !== undefined && before !== after) staleSchemaEvidence.add(event.document.uri.toString());
      publishLocalSchema(event.document); publishSchemaEvidence(event.document);
    }),
    vscode.workspace.onDidCloseTextDocument(document => { localSchemaCollection.delete(document.uri); schemaEvidenceCollection.delete(document.uri); staleSchemaEvidence.delete(document.uri.toString()); schemaDeclarationSnapshots.delete(document.uri.toString()); }));

  // Secure local defs/ref tooling deliberately shares the pure compiler with
  // authoring diagnostics. It never asks the trusted runtime to load a project.
  const localSchemaSelector = ["typescript", "typescriptreact"];
  const localSymbols = (document: vscode.TextDocument) => local_hson_schema_symbols(document.fileName, document.getText());
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(localSchemaSelector, {
      provideCompletionItems(document, position) {
        const offset = document.offsetAt(position);
        const range = schema_ref_completion_range(document.getText(), offset);
        if (range === undefined) return [];
        return local_hson_schema_completion(document.fileName, document.getText(), offset).map(symbol => {
          const item = new vscode.CompletionItem(symbol.name, vscode.CompletionItemKind.Reference);
          item.detail = symbol.capability === "data" ? "Hson Schema definition" : "Hson Schema document definition";
          item.range = new vscode.Range(document.positionAt(range.start), document.positionAt(range.end));
          item.insertText = JSON.stringify(symbol.name).slice(1, -1);
          return item;
        });
      },
    }),
    vscode.languages.registerDefinitionProvider(localSchemaSelector, {
      provideDefinition(document, position) {
        const target = schema_target_at(localSymbols(document), document.offsetAt(position));
        return target === undefined ? undefined : new vscode.Location(document.uri, new vscode.Range(document.positionAt(target.range.start), document.positionAt(target.range.end)));
      },
    }),
    vscode.languages.registerReferenceProvider(localSchemaSelector, {
      provideReferences(document, position, referenceContext) {
        const symbols = localSymbols(document);
        const target = schema_target_at(symbols, document.offsetAt(position));
        if (target === undefined) return [];
        const locations = target.references.map(range => new vscode.Location(document.uri, new vscode.Range(document.positionAt(range.start), document.positionAt(range.end))));
        if (referenceContext.includeDeclaration) locations.unshift(new vscode.Location(document.uri, new vscode.Range(document.positionAt(target.range.start), document.positionAt(target.range.end))));
        return locations;
      },
    }),
    vscode.languages.registerRenameProvider(localSchemaSelector, {
      prepareRename(document, position) {
        const target = schema_target_at(localSymbols(document), document.offsetAt(position));
        return target === undefined ? undefined : new vscode.Range(document.positionAt(target.range.start), document.positionAt(target.range.end));
      },
      provideRenameEdits(document, position, newName) {
        const renamed = rename_hson_schema_definition(localSymbols(document), document.offsetAt(position), newName);
        if (renamed === undefined) return undefined;
        const edit = new vscode.WorkspaceEdit();
        for (const change of renamed.edits) edit.replace(document.uri, new vscode.Range(document.positionAt(change.start), document.positionAt(change.end)), change.text);
        return edit;
      },
    }),
    vscode.languages.registerHoverProvider(localSchemaSelector, {
      provideHover(document, position) {
        const symbols = localSymbols(document);
        const target = schema_target_at(symbols, document.offsetAt(position));
        if (target === undefined) return undefined;
        const content = new vscode.MarkdownString();
        content.appendCodeblock(target.name, "hson");
        content.appendMarkdown(`Hson Schema ${target.capability === "data" ? "definition" : "document definition"}`);
        if (target.references.length > 0) content.appendMarkdown(`  \n${target.references.length} local reference${target.references.length === 1 ? "" : "s"}`);
        return new vscode.Hover(content, new vscode.Range(document.positionAt(target.range.start), document.positionAt(target.range.end)));
      },
    }),
  );

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
  const output = vscode.window.createOutputChannel("Hson Schema diagnostics");
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
        diagnostic.source = spec.runtimeAdmission ? "Hson" : "Hson Schema"; diagnostic.code = spec.code;
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
        : !hasConsent(folder, uri) ? "This provider/runtime configuration is awaiting explicit Hson consent."
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
      void vscode.window.showWarningMessage("Hson trusted Schema diagnostics remain off until this workspace is trusted through VS Code Workspace Trust.");
      return false;
    }
    const execution = executionConfiguration(resource);
    if (!execution.module || !execution.hsonModule) {
      void vscode.window.showWarningMessage("Configure both the Hson Provider Entry and Hson Runtime Module before enabling trusted Schema diagnostics.", "Open Hson Settings")
        .then(action => action === "Open Hson Settings" && vscode.commands.executeCommand("hson.openSettings"));
      return false;
    }
    if (pendingConsent.has(key)) return false;
    pendingConsent.add(key);
    try {
      const allow = process.env.HSON_D2_TEST_WORKSPACE !== undefined ? "Allow Trusted Execution" : await vscode.window.showWarningMessage(
        `Allow Hson to execute project code from “${folder.name}” with your user permissions in a supervised separate process? Schema definitions, constraints, recurse callbacks, and module initialization may run. This is not a security sandbox.`,
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
      void vscode.window.showWarningMessage("Open a workspace folder before configuring Hson trusted Schema diagnostics.");
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
  type ManagedSchemaWatch = Readonly<{ folder: vscode.WorkspaceFolder; project: string; child: ChildProcess }>;
  const schemaToolOutput = vscode.window.createOutputChannel("Hson Schema");
  const schemaToolStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 11);
  const schemaWatches = new Map<string, ManagedSchemaWatch>();
  const schemaToolStates = new Map<string, "stopped" | "watching" | "error">();
  const schemaWatchKey = (folder: vscode.WorkspaceFolder, project: string): string => `${folder.uri.toString()}::${project}`;
  const schemaToolFolder = async (requested?: vscode.Uri): Promise<vscode.WorkspaceFolder | undefined> => {
    const direct = requested === undefined ? vscode.window.activeTextEditor?.document.uri : requested;
    const activeFolder = direct === undefined ? undefined : vscode.workspace.getWorkspaceFolder(direct);
    if (activeFolder !== undefined) return activeFolder;
    const candidates = (vscode.workspace.workspaceFolders ?? []).filter(folder => {
      try { discover_schema_project(folder.uri.fsPath); return true; } catch { return false; }
    });
    if (candidates.length === 1) return candidates[0];
    if (candidates.length === 0) {
      void vscode.window.showWarningMessage("No workspace folder with tsconfig.json is available for Hson Schema tooling.");
      return undefined;
    }
    const choice = await vscode.window.showQuickPick(candidates.map(folder => ({ label: folder.name, description: discover_schema_project(folder.uri.fsPath), folder })), { placeHolder: "Choose the workspace project for Hson Schema tooling" });
    return choice?.folder;
  };
  const updateSchemaToolStatus = (): void => {
    const folder = vscode.window.activeTextEditor === undefined ? undefined : vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri);
    const entry = folder === undefined ? undefined : [...schemaToolStates.entries()].find(([key]) => key.startsWith(`${folder.uri.toString()}::`));
    const state = entry?.[1] ?? "stopped";
    schemaToolStatus.text = state === "watching" ? "Hson Schema: Watching" : state === "error" ? "Hson Schema: Error" : "Hson Schema: Stopped";
    schemaToolStatus.tooltip = state === "watching" ? "An extension-managed workspace hson-schema watch process is running."
      : state === "error" ? "The extension-managed Hson Schema command failed. Select to generate, watch, stop, or show output."
      : "No extension-managed Hson Schema watch process is running. An external terminal watcher may still exist.";
    schemaToolStatus.show();
  };
  const appendProcessOutput = (child: ChildProcess): void => {
    child.stdout?.on("data", chunk => schemaToolOutput.append(String(chunk)));
    child.stderr?.on("data", chunk => schemaToolOutput.append(String(chunk)));
  };
  const refreshSchemaEvidence = (): void => {
    for (const document of vscode.workspace.textDocuments) {
      if (!document.isDirty) staleSchemaEvidence.delete(document.uri.toString());
      publishSchemaEvidence(document);
    }
  };
  const stopSchemaWatch = async (requested?: vscode.Uri): Promise<void> => {
    const folder = await schemaToolFolder(requested);
    if (folder === undefined) return;
    const matches = [...schemaWatches.entries()].filter(([, watch]) => watch.folder.uri.toString() === folder.uri.toString());
    if (matches.length === 0) { schemaToolStates.set(`${folder.uri.toString()}::none`, "stopped"); updateSchemaToolStatus(); return; }
    for (const [key, watch] of matches) {
      schemaToolOutput.appendLine(`Stopping extension-managed hson-schema watch for ${watch.project}.`);
      terminate_schema_process(watch.child);
      schemaWatches.delete(key); schemaToolStates.set(key, "stopped");
    }
    updateSchemaToolStatus();
  };
  const prepareSchemaTool = async (requested?: vscode.Uri): Promise<Readonly<{ folder: vscode.WorkspaceFolder; project: string; executable: string }> | undefined> => {
    if (!vscode.workspace.isTrusted) {
      void vscode.window.showWarningMessage("Hson Schema commands do not run in Restricted Mode. Trust this workspace through VS Code Workspace Trust, then run the command again.");
      return undefined;
    }
    const folder = await schemaToolFolder(requested);
    if (folder === undefined) return undefined;
    try {
      const active = requested ?? vscode.window.activeTextEditor?.document.uri;
      const project = discover_schema_project(folder.uri.fsPath, active?.fsPath);
      const tool = resolve_workspace_hson_schema_tool(folder.uri.fsPath);
      return Object.freeze({ folder, project, executable: tool.executable });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not resolve workspace-local hson-schema tooling.";
      schemaToolOutput.appendLine(`Hson Schema setup failed: ${message}`); schemaToolOutput.show(true);
      void vscode.window.showErrorMessage(message, "Show Hson Output").then(action => action === "Show Hson Output" && schemaToolOutput.show(true));
      return undefined;
    }
  };
  const runSchemaOnce = async (mode: "generate" | "check", requested?: vscode.Uri): Promise<void> => {
    const prepared = await prepareSchemaTool(requested);
    if (prepared === undefined) return;
    const key = schemaWatchKey(prepared.folder, prepared.project);
    const started = performance.now();
    schemaToolOutput.appendLine(`hson-schema ${mode} --project ${prepared.project}`);
    const child = spawn(process.execPath, [prepared.executable, mode, "--project", prepared.project], { cwd: prepared.folder.uri.fsPath, stdio: ["ignore", "pipe", "pipe"] });
    appendProcessOutput(child);
    await new Promise<void>(resolveOnce => {
      child.once("error", error => { schemaToolOutput.appendLine(`Hson Schema ${mode} failed to start: ${error.message}`); schemaToolStates.set(key, "error"); updateSchemaToolStatus(); resolveOnce(); });
      child.once("close", code => {
        if (code === 0) { schemaToolOutput.appendLine(`Hson Schema ${mode} completed in ${Math.round(performance.now() - started)}ms.`); schemaToolStates.set(key, "stopped"); refreshSchemaEvidence(); }
        else { schemaToolOutput.appendLine(`Hson Schema ${mode} exited with code ${code ?? "unknown"}.`); schemaToolStates.set(key, "error"); void vscode.window.showErrorMessage(`Hson Schema ${mode} failed.`, "Show Hson Output").then(action => action === "Show Hson Output" && schemaToolOutput.show(true)); }
        updateSchemaToolStatus(); resolveOnce();
      });
    });
  };
  const startSchemaWatch = async (requested?: vscode.Uri): Promise<void> => {
    const prepared = await prepareSchemaTool(requested);
    if (prepared === undefined) return;
    const key = schemaWatchKey(prepared.folder, prepared.project);
    if (schemaWatches.has(key)) { schemaToolOutput.appendLine(`Hson Schema watch is already running for ${prepared.project}.`); updateSchemaToolStatus(); return; }
    schemaToolOutput.appendLine(`Starting hson-schema watch --project ${prepared.project}`);
    const child = spawn(process.execPath, [prepared.executable, "watch", "--project", prepared.project], { cwd: prepared.folder.uri.fsPath, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
    const watch = Object.freeze({ folder: prepared.folder, project: prepared.project, child });
    schemaWatches.set(key, watch); schemaToolStates.set(key, "watching"); appendProcessOutput(child); updateSchemaToolStatus();
    child.once("error", error => { schemaToolOutput.appendLine(`Hson Schema watch failed to start: ${error.message}`); schemaWatches.delete(key); schemaToolStates.set(key, "error"); updateSchemaToolStatus(); });
    child.once("close", code => {
      const managed = schemaWatches.delete(key);
      if (managed) { schemaToolStates.set(key, code === 0 ? "stopped" : "error"); schemaToolOutput.appendLine(`Hson Schema watch exited with code ${code ?? "unknown"}.`); if (code !== 0) void vscode.window.showErrorMessage("Hson Schema watch stopped unexpectedly.", "Show Hson Output").then(action => action === "Show Hson Output" && schemaToolOutput.show(true)); }
      updateSchemaToolStatus(); refreshSchemaEvidence();
    });
  };
  schemaToolStatus.command = "hson.schemaToolActions";
  updateSchemaToolStatus();
  statusBar.command = "hson.openSettings";
  context.subscriptions.push(
    vscode.commands.registerCommand("hson.openSettings", () => vscode.commands.executeCommand("workbench.action.openSettings", HSON_SETTINGS_QUERY)),
    vscode.commands.registerCommand("hson.enableTrustedSchemaDiagnostics", () => updateEnabled(true)),
    vscode.commands.registerCommand("hson.disableTrustedSchemaDiagnostics", () => updateEnabled(false)),
    vscode.commands.registerCommand("hson.restartTrustedSchemaRuntime", async () => {
      const folder = selectedFolder();
      if (folder === undefined || !trustedExecutionAvailable(resourceFor(folder))) {
        void vscode.window.showWarningMessage("Hson trusted Schema diagnostics are not currently authorized and available.");
        return;
      }
      reconfigure();
      void vscode.window.showInformationMessage("Hson trusted Schema runtime restarted.");
    }),
    vscode.commands.registerCommand("hson.generateSchemaTypes", (uri?: vscode.Uri) => runSchemaOnce("generate", uri)),
    vscode.commands.registerCommand("hson.checkSchemas", (uri?: vscode.Uri) => runSchemaOnce("check", uri)),
    vscode.commands.registerCommand("hson.startSchemaWatch", (uri?: vscode.Uri) => startSchemaWatch(uri)),
    vscode.commands.registerCommand("hson.stopSchemaWatch", (uri?: vscode.Uri) => stopSchemaWatch(uri)),
    vscode.commands.registerCommand("hson.showSchemaOutput", () => schemaToolOutput.show(true)),
    vscode.commands.registerCommand("hson.schemaToolActions", async () => {
      const action = await vscode.window.showQuickPick([
        { label: "Generate Schema Types", command: "hson.generateSchemaTypes" },
        { label: "Start Schema Watch", command: "hson.startSchemaWatch" },
        { label: "Stop Schema Watch", command: "hson.stopSchemaWatch" },
        { label: "Check Schemas", command: "hson.checkSchemas" },
        { label: "Show Hson Output", command: "hson.showSchemaOutput" },
      ], { placeHolder: "Hson Schema tooling" });
      if (action !== undefined) await vscode.commands.executeCommand(action.command);
    }),
  );
  context.subscriptions.push(vscode.languages.registerCodeActionsProvider(["typescript", "typescriptreact"], {
    provideCodeActions(document, _range, codeActionContext) {
      const evidence = codeActionContext.diagnostics.filter(diagnostic => diagnostic.code === "HSON_SCHEMA_GENERATED_EVIDENCE_MISSING" || diagnostic.code === "HSON_SCHEMA_GENERATED_EVIDENCE_STALE");
      if (evidence.length === 0) return [];
      const generate = new vscode.CodeAction("Generate Hson Schema types", vscode.CodeActionKind.QuickFix);
      generate.diagnostics = evidence; generate.command = { command: "hson.generateSchemaTypes", title: "Generate Hson Schema types", arguments: [document.uri] };
      const watch = new vscode.CodeAction("Start Hson Schema watch", vscode.CodeActionKind.QuickFix);
      watch.diagnostics = evidence; watch.command = { command: "hson.startSchemaWatch", title: "Start Hson Schema watch", arguments: [document.uri] };
      return [generate, watch];
    },
  }, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }));
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
    if (uri.fsPath.includes(".hson-schema.generated.")) refreshSchemaEvidence();
    for (const [key, client] of clients) {
      if (files.get(key)?.has(uri.fsPath) || client.schemaModuleUrls.includes(uri.toString())) {
        client.invalidate();
        if (!vscode.workspace.textDocuments.some(doc => doc.uri.toString() === uri.toString() && doc.isDirty)) staleProviders.delete(key);
        controller.refresh();
      }
    }
  };
  context.subscriptions.push(schemaCollection, statusBar, output, schemaToolOutput, schemaToolStatus, controller, watcher,
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
    vscode.workspace.onDidChangeWorkspaceFolders(event => {
      reconfigure();
      for (const folder of event.removed) {
        for (const [key, watch] of schemaWatches) if (watch.folder.uri.toString() === folder.uri.toString()) {
          terminate_schema_process(watch.child); schemaWatches.delete(key); schemaToolStates.set(key, "stopped");
        }
      }
      updateSchemaToolStatus();
    }),
    vscode.window.onDidChangeActiveTextEditor(() => { describe(); updateSchemaToolStatus(); }),
    { dispose(): void {
      for (const watch of schemaWatches.values()) terminate_schema_process(watch.child);
      schemaWatches.clear();
      for (const client of clients.values()) client.dispose(); clients.clear();
    } });
}

function terminate_schema_process(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === "win32") {
    const taskkill = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
    taskkill.once("error", () => child.kill());
    return;
  }
  try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
}
