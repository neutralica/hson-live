import * as messages from "./diagnostic-messages.js";
import * as vscode from "vscode";
import { spawn, type ChildProcess } from "node:child_process";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { local_hson_schema_declarations, local_hson_schema_diagnostics } from "./hson-schema-local.js";
import { inspect_hson_schema_evidence } from "../../../src/internal/hson-schema/generated-evidence.js";
import {
  local_hson_schema_completion,
  local_hson_schema_symbols,
  rename_hson_schema_definition,
  schema_ref_completion_range,
  schema_target_at,
} from "./hson-schema-symbols.js";
import { discover_schema_project, resolve_workspace_hson_schema_tool, schema_watch_output_state } from "./schema-tooling.js";

import {
  type DiagnosticDocument,
  type DiagnosticPublisher,
} from "./diagnostics.js";
import type { DocumentDiagnosticSpec } from "./document-diagnostics.js";
import { discover_typescript_projects } from "./typescript-project-discovery.js";
import {
  start_workspace_diagnostics,
  type WorkspaceDiagnosticHost,
  type WorkspaceDiagnosticSource,
  type WorkspaceSourceChange,
} from "./workspace-diagnostics.js";
import { hson_highlights, hsonTokenScopes, load_hson_grammar } from "./highlighting.js";
import {
  HSON_LIBRARY_SEPARATOR_COLOR_ID,
  hson_identity_presentation,
  hsonIdentityMarkers,
} from "./authoring-marker.js";
import { HSON_SETTINGS_QUERY, appearance_color, marker_strength, marker_color_key } from "./settings.js";

function adaptDocument(document: vscode.TextDocument): DiagnosticDocument {
  return Object.freeze({
    uri: document.uri.toString(),
    version: document.version,
    languageId: document.languageId,
    fileName: document.fileName,
    text: document.getText(),
  });
}

function positionAt(text: string, offset: number): vscode.Position {
  const target = Math.max(0, Math.min(offset, text.length));
  let line = 0;
  let lineStart = 0;
  for (let index = 0; index < target; index += 1) {
    if (text.charCodeAt(index) !== 10) continue;
    line += 1;
    lineStart = index + 1;
  }
  return new vscode.Position(line, target - lineStart);
}

function toRange(text: string, spec: DocumentDiagnosticSpec): vscode.Range {
  return new vscode.Range(
    positionAt(text, spec.range.start),
    positionAt(text, spec.range.end),
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
  const diagnosticsOutput = vscode.window.createOutputChannel("Hson Diagnostics");
  context.subscriptions.push(collection, diagnosticsOutput);

  const localSchemaCollection = vscode.languages.createDiagnosticCollection("hson-schema-authoring");
  const schemaEvidenceCollection = vscode.languages.createDiagnosticCollection("hson-schema-evidence");
  const publishSchemaEvidence = (document: vscode.TextDocument): void => {
    if (document.languageId !== "typescript" && document.languageId !== "typescriptreact") return;
    const declarations = local_hson_schema_declarations(document.getText(), document.fileName);
    const diagnostics: vscode.Diagnostic[] = [];
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    let project: string | undefined;
    if (folder !== undefined) try { project = discover_schema_project(folder.uri.fsPath, document.fileName); } catch { project = undefined; }
    for (const declaration of declarations) {
      const generated = resolve(document.fileName.slice(0, -extname(document.fileName).length) + `.${declaration.name}.hson-schema.generated.ts`);
      const metadata = generated.slice(0, -2) + "json";
      const range = new vscode.Range(document.positionAt(declaration.start), document.positionAt(declaration.end));
      const identity = project === undefined ? undefined : `${relative(dirname(project), document.fileName).split(sep).join("/")}#${declaration.name}`;
      const evidence = identity === undefined ? { state: "error" as const, message: "No containing tsconfig.json was found." }
        : inspect_hson_schema_evidence(declaration.name, declaration.template, identity, generated, metadata);
      if (evidence.state === "current") continue;
      const label = evidence.state === "missing" ? "missing" : evidence.state === "stale" ? "stale" : evidence.state === "invalid" ? "invalid" : "unavailable";
      const diagnostic = new vscode.Diagnostic(range, `Generated Hson Schema types for ${declaration.name} are ${label}.${evidence.message === undefined ? "" : ` ${evidence.message}`} Generate Schema Types or start Hson Schema watch.`, evidence.state === "invalid" || evidence.state === "error" ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning);
      diagnostic.source = "Hson Schema";
      diagnostic.code = evidence.state === "missing" ? "HSON_SCHEMA_GENERATED_EVIDENCE_MISSING" : evidence.state === "stale" ? "HSON_SCHEMA_GENERATED_EVIDENCE_STALE" : evidence.state === "invalid" ? "HSON_SCHEMA_GENERATED_EVIDENCE_INVALID" : "HSON_SCHEMA_GENERATED_EVIDENCE_ERROR";
      diagnostics.push(diagnostic);
    }
    schemaEvidenceCollection.set(document.uri, diagnostics);
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
    vscode.workspace.onDidChangeTextDocument(event => { publishLocalSchema(event.document); publishSchemaEvidence(event.document); }),
    vscode.workspace.onDidCloseTextDocument(document => { localSchemaCollection.delete(document.uri); schemaEvidenceCollection.delete(document.uri); }));

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

  const sourceWatcher = vscode.workspace.createFileSystemWatcher("**/*.{ts,tsx,hson}");
  const projectWatcher = vscode.workspace.createFileSystemWatcher("**/*.json");
  context.subscriptions.push(sourceWatcher, projectWatcher);
  const sourceListeners = new Set<(changes: readonly WorkspaceSourceChange[]) => void>();
  const projectListeners = new Set<() => void>();
  let projectConfigurations = new Set<string>();
  const fireSource = (uri: vscode.Uri, kind: WorkspaceSourceChange["kind"]): void => {
    const change = Object.freeze({ uri: uri.toString(), kind });
    for (const listener of sourceListeners) listener([change]);
  };
  context.subscriptions.push(
    sourceWatcher.onDidCreate(uri => fireSource(uri, "create")),
    sourceWatcher.onDidChange(uri => fireSource(uri, "change")),
    sourceWatcher.onDidDelete(uri => fireSource(uri, "delete")),
    projectWatcher.onDidCreate(uri => { if (/^(?:tsconfig.*|jsconfig)\.json$/i.test(uri.path.slice(uri.path.lastIndexOf("/") + 1))) for (const listener of projectListeners) listener(); }),
    projectWatcher.onDidChange(uri => { if (projectConfigurations.has(uri.toString())) for (const listener of projectListeners) listener(); }),
    projectWatcher.onDidDelete(uri => { if (projectConfigurations.has(uri.toString())) for (const listener of projectListeners) listener(); }),
    vscode.workspace.onDidSaveTextDocument(document => fireSource(document.uri, "change")),
    vscode.workspace.onDidChangeWorkspaceFolders(() => { for (const listener of projectListeners) listener(); }),
  );
  const register = <Listener>(listeners: Set<Listener>, listener: Listener): vscode.Disposable => {
    listeners.add(listener);
    return new vscode.Disposable(() => listeners.delete(listener));
  };
  const discoverSources = async (): Promise<readonly WorkspaceDiagnosticSource[]> => {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const fileFolders = folders.filter(folder => folder.uri.scheme === "file");
    await new Promise<void>(resolveYield => setTimeout(resolveYield, 0));
    const projects = discover_typescript_projects(fileFolders.map(folder => folder.uri.fsPath));
    projectConfigurations = new Set(projects.configurations.map(fileName => vscode.Uri.file(fileName).toString()));
    for (const error of projects.errors) diagnosticsOutput.appendLine(error);
    const standalone = (await Promise.all(folders.map(folder => vscode.workspace.findFiles(
      new vscode.RelativePattern(folder, "**/*.hson"),
      "**/{node_modules,.git,dist,build,out,coverage}/**",
    )))).flat();
    const standaloneSources: WorkspaceDiagnosticSource[] = standalone.map(uri => Object.freeze({
      uri: uri.toString(),
      fileName: uri.fsPath,
      languageId: "hson",
    }));
    return Object.freeze([
      ...projects.sources.map(source => Object.freeze({
        uri: vscode.Uri.file(source.fileName).toString(),
        fileName: source.fileName,
        languageId: source.languageId,
      })),
      ...standaloneSources,
    ]);
  };
  const host: WorkspaceDiagnosticHost = {
    openDocuments: () => vscode.workspace.textDocuments.map(adaptDocument),
    discoverSources,
    readSource: async source => new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.parse(source.uri))),
    onDidOpen: (listener) => vscode.workspace.onDidOpenTextDocument((document) => listener(adaptDocument(document))),
    onDidChange: (listener) => vscode.workspace.onDidChangeTextDocument((event) => listener(adaptDocument(event.document))),
    onDidClose: (listener) => vscode.workspace.onDidCloseTextDocument((document) => listener(adaptDocument(document))),
    onDidChangeSources: listener => register(sourceListeners, listener),
    onDidChangeProjects: listener => register(projectListeners, listener),
    setTimer: (callback, delayMilliseconds) => setTimeout(callback, delayMilliseconds),
    clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
    yield: () => new Promise(resolveYield => setTimeout(resolveYield, 0)),
    reportUnexpected: (error, source) => {
      const message = messages.unexpectedDiagnosticsFailure(source?.fileName ?? "workspace scan");
      diagnosticsOutput.appendLine(`${message} ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      console.error(message, error);
    },
  };
  const publisher: DiagnosticPublisher = {
    set(document, specs): void {
      const uri = vscode.Uri.parse(document.uri);
      const diagnostics = specs.map((spec) => {
        const diagnostic = new vscode.Diagnostic(
          toRange(document.text, spec),
          spec.message,
          vscode.DiagnosticSeverity.Error,
        );
        diagnostic.source = spec.source;
        diagnostic.code = spec.code;
        diagnostic.relatedInformation = spec.related.map((related) =>
          new vscode.DiagnosticRelatedInformation(
            new vscode.Location(
              uri,
              new vscode.Range(
                positionAt(document.text, related.range.start),
                positionAt(document.text, related.range.end),
              ),
            ),
            related.message,
          ));
        return diagnostic;
      });
      collection.set(uri, diagnostics);
    },
    delete(uri): void {
      collection.delete(vscode.Uri.parse(uri));
    },
  };

  context.subscriptions.push(start_workspace_diagnostics(host, publisher));
  // Independent of Schema associations and completion providers.
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
  type ManagedSchemaWatch = Readonly<{ folder: vscode.WorkspaceFolder; project: string; child: ChildProcess }>;
  const schemaToolOutput = vscode.window.createOutputChannel("Hson Schema");
  const schemaToolStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 11);
  const schemaWatches = new Map<string, ManagedSchemaWatch>();
  type SchemaToolState = "stopped" | "starting" | "watching" | "stale" | "error";
  const schemaToolStates = new Map<string, SchemaToolState>();
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
    const entries = [...schemaToolStates.entries()].filter(([key]) => folder === undefined || key.startsWith(`${folder.uri.toString()}::`));
    const states = entries.map(([, state]) => state);
    const state: SchemaToolState = states.includes("error") ? "error" : states.includes("stale") ? "stale" : states.includes("starting") ? "starting" : states.includes("watching") ? "watching" : "stopped";
    schemaToolStatus.text = state === "watching" ? "Hson Schema: Current" : state === "starting" ? "Hson Schema: Checking" : state === "stale" ? "Hson Schema: Stale" : state === "error" ? "Hson Schema: Error" : "Hson Schema: Stopped";
    schemaToolStatus.tooltip = state === "watching" ? "The extension-managed Schema watcher is running and generated evidence is current."
      : state === "starting" ? "The extension-managed Hson Schema command is starting or checking changes."
      : state === "stale" ? "An edited Schema has not yet been reconciled with generated evidence."
      : state === "error" ? "The extension-managed Hson Schema command reported an error. Select to generate, watch, stop, or show output."
      : "No extension-managed Hson Schema watch process is running. An external terminal watcher may still exist.";
    schemaToolStatus.show();
  };
  const appendProcessOutput = (child: ChildProcess, onLine?: (line: string) => void): void => {
    const attach = (stream: NodeJS.ReadableStream | null): void => {
      let pending = "";
      stream?.on("data", chunk => {
        const text = String(chunk);
        schemaToolOutput.append(text);
        pending += text;
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? "";
        for (const line of lines) onLine?.(line);
      });
      stream?.on("end", () => { if (pending !== "") onLine?.(pending); });
    };
    attach(child.stdout); attach(child.stderr);
  };
  const refreshSchemaEvidence = (): void => {
    for (const document of vscode.workspace.textDocuments) {
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
      await new Promise<void>(resolveStopped => {
        if (watch.child.exitCode !== null) return resolveStopped();
        watch.child.once("close", () => resolveStopped());
        terminate_schema_process(watch.child);
      });
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
        if (code === 0) { schemaToolOutput.appendLine(`Hson Schema ${mode} completed in ${Math.round(performance.now() - started)}ms.`); schemaToolStates.set(key, schemaWatches.has(key) ? "watching" : "stopped"); refreshSchemaEvidence(); }
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
    schemaWatches.set(key, watch); schemaToolStates.set(key, "starting");
    appendProcessOutput(child, line => {
      const state = schema_watch_output_state(line);
      if (state === undefined || !schemaWatches.has(key)) return;
      schemaToolStates.set(key, state); updateSchemaToolStatus();
      if (state === "watching") refreshSchemaEvidence();
    });
    updateSchemaToolStatus();
    child.once("error", error => { schemaToolOutput.appendLine(`Hson Schema watch failed to start: ${error.message}`); schemaWatches.delete(key); schemaToolStates.set(key, "error"); updateSchemaToolStatus(); });
    child.once("close", code => {
      const managed = schemaWatches.delete(key);
      if (managed) { schemaToolStates.set(key, code === 0 ? "stopped" : "error"); schemaToolOutput.appendLine(`Hson Schema watch exited with code ${code ?? "unknown"}.`); if (code !== 0) void vscode.window.showErrorMessage("Hson Schema watch stopped unexpectedly.", "Show Hson Output").then(action => action === "Show Hson Output" && schemaToolOutput.show(true)); }
      updateSchemaToolStatus(); refreshSchemaEvidence();
    });
  };
  schemaToolStatus.command = "hson.schemaToolActions";
  updateSchemaToolStatus();
  context.subscriptions.push(
    vscode.commands.registerCommand("hson.openSettings", () => vscode.commands.executeCommand("workbench.action.openSettings", HSON_SETTINGS_QUERY)),
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
  const watcher = vscode.workspace.createFileSystemWatcher("**/*.{js,mjs,cjs,ts,mts,cts,json}");
  const changed = (uri: vscode.Uri): void => {
    if (uri.fsPath.includes(".hson-schema.generated.")) refreshSchemaEvidence();
  };
  context.subscriptions.push(schemaToolOutput, schemaToolStatus, watcher,
    watcher.onDidChange(changed), watcher.onDidCreate(changed), watcher.onDidDelete(changed),
    vscode.workspace.onDidChangeWorkspaceFolders(event => {
      for (const folder of event.removed) {
        for (const [key, watch] of schemaWatches) if (watch.folder.uri.toString() === folder.uri.toString()) {
          terminate_schema_process(watch.child); schemaWatches.delete(key); schemaToolStates.set(key, "stopped");
        }
      }
      updateSchemaToolStatus();
    }),
    vscode.workspace.onDidChangeTextDocument(event => {
      const folder = vscode.workspace.getWorkspaceFolder(event.document.uri);
      if (folder === undefined || local_hson_schema_declarations(event.document.getText(), event.document.fileName).length === 0) return;
      for (const [key, watch] of schemaWatches) if (watch.folder.uri.toString() === folder.uri.toString()) schemaToolStates.set(key, "stale");
      updateSchemaToolStatus();
    }),
    vscode.window.onDidChangeActiveTextEditor(updateSchemaToolStatus),
    { dispose(): void {
      for (const watch of schemaWatches.values()) terminate_schema_process(watch.child);
      schemaWatches.clear();
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
