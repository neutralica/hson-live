import * as messages from "./diagnostic-messages.js";
import * as vscode from "vscode";
import { spawn, type ChildProcess } from "node:child_process";
import { local_hson_schema_declarations, local_hson_schema_diagnostics } from "./hson-schema-local.js";
import {
  local_hson_schema_symbols,
  rename_hson_schema_definition,
  schema_target_at,
} from "./hson-schema-symbols.js";
import { discover_schema_project, resolve_workspace_hson_schema_tool, schema_watch_output_state } from "./schema-tooling.js";

import {
  type DiagnosticDocument,
  type DiagnosticPublisher,
} from "./diagnostics.js";
import { create_host_source_locator, type HostSourceRange } from "../../../src/internal/embedded-hson/embedded-hson-source.js";
import { is_typescript_configuration_path, PROJECT_DISCOVERY_COMMAND, project_file_keys, TypeScriptProjectScanner, type ProjectDiscoveryRequest, type ProjectDiscoveryResponse, type ProjectRevisions, type TypeScriptProjectDiscovery } from "./typescript-project-discovery.js";
import ts from "typescript";
import { event_source_imports, type EventSourceConfiguration, type EventSourceEvidence } from "./event-source-evidence.js";
import {
  start_workspace_diagnostics,
  type WorkspaceDiagnosticHost,
  type WorkspaceDiagnosticSource,
  type WorkspaceDiscoveryScope,
  type WorkspaceSourceChange,
} from "./workspace-diagnostics.js";
import { load_hson_grammar } from "./highlighting.js";
import { HsonAppearanceEditor } from "./appearance-editor.js";
import { AppearanceScratchpads } from './scratchpads.js';
import { standaloneAuthoringMode, type StandaloneAuthoringMode } from './authoring-mode.js';
import {
  HSON_LIBRARY_SEPARATOR_COLOR_ID,
  hson_identity_presentation,
  hsonIdentityMarkers,
} from "./authoring-marker.js";
import { markdown_hson_fence_marker_parts } from "./markdown-fence-marker.js";
import { HSON_SETTINGS_QUERY, marker_strength, marker_color } from "./settings.js";
import { document_semantic_tokens, hsonSemanticLegend } from "./semantic-tokens.js";
import { HsonBindingCache, binding_definition_at } from "./binding-intelligence.js";
import { HSON_BRANDING } from "./appearance-branding.generated.js";
import { formatting_target_is_current } from "./formatting-target.js";
import { HsonDelimiterDepthCache, HsonDepthDecorationSet } from "./delimiter-depth.js";
import { LocalHostExtensionManager } from "./local-host-extension.js";
import { ManualSaveTracker } from "./manual-save.js";
import type { LocalHostState } from "./local-host-controller.js";
import { HSON_TOOLTIP_COMMANDS, hson_quick_pick_actions, hson_status_presentation, hson_status_tooltip, type SchemaToolState } from "./hson-status.js";
import { run_development_services, type DevelopmentService } from "./development-actions.js";
import {
  StructuralDocumentEvidenceCache,
  structural_array_pair_for_bracket,
  structural_closer_for_less_than,
  structural_formatting_edits,
  structural_newline_plan_from_evidence,
  structural_region_at_evidence,
  structural_typing_snippet,
  type StructuralHostLanguage,
} from "./structural-editing.js";

let localHostManager: LocalHostExtensionManager | undefined;
let appearanceScratchpads: AppearanceScratchpads | undefined;

function diagnosticDocument(document: vscode.TextDocument, authoringMode?: StandaloneAuthoringMode): DiagnosticDocument {
  return Object.freeze({
    uri: document.uri.toString(),
    version: document.version,
    languageId: document.languageId,
    fileName: document.fileName,
    text: document.getText(),
    authoringMode,
  });
}

export function activate(context: vscode.ExtensionContext): void {
  const scratchpads = appearanceScratchpads = new AppearanceScratchpads(context.workspaceState);
  context.subscriptions.push(scratchpads);
  const authoringMode = (document: vscode.TextDocument): StandaloneAuthoringMode => {
    const family = scratchpads.context(document)?.family;
    return family === 'document' || family === 'data' ? family
      : standaloneAuthoringMode(vscode.workspace.getConfiguration('hson.authoring',document.uri).get('mode'));
  };
  const adaptDocument = (document: vscode.TextDocument) => diagnosticDocument(document,
    document.languageId === 'hson' ? authoringMode(document) : undefined);
  let eventImports = event_source_imports([], ts.sys.useCaseSensitiveFileNames);
  const bindingCache = new HsonBindingCache((file, text) => eventImports(file, text));
  context.subscriptions.push({ dispose: () => bindingCache.clear() },
    vscode.workspace.onDidCloseTextDocument(document => bindingCache.forget(document.uri.toString())),
    vscode.languages.registerDefinitionProvider(["hson", "markdown", "typescript", "typescriptreact"], {
      provideDefinition(document, position) {
        const target = binding_definition_at(bindingCache.get(adaptDocument(document)), document.offsetAt(position));
        return target === undefined ? undefined : [{ originSelectionRange: new vscode.Range(document.positionAt(target.origin.start), document.positionAt(target.origin.end)),
          targetUri: vscode.Uri.parse(target.uri),
          targetRange: new vscode.Range(document.positionAt(target.target.start), document.positionAt(target.target.end)),
          targetSelectionRange: new vscode.Range(document.positionAt(target.target.start), document.positionAt(target.target.end)) }];
      },
    }));
  const structuralEvidence = new StructuralDocumentEvidenceCache(8);
  const evidenceFor = (document: vscode.TextDocument, language: StructuralHostLanguage) => structuralEvidence.get(
    document.uri.toString(),
    document.version,
    document.fileName,
    language,
    document.getText(),
  );
  context.subscriptions.push({ dispose: () => structuralEvidence.clear() });
  const structuralLanguage = (document: vscode.TextDocument): StructuralHostLanguage | undefined =>
    document.languageId === "typescript" || document.languageId === "typescriptreact" || document.languageId === "markdown"
      ? document.languageId : undefined;
  const formattingLanguage = (document: vscode.TextDocument) =>
    document.languageId === "hson" ? "hson" : structuralLanguage(document);
  const documentIndentation = (document: vscode.TextDocument) => {
    const visibleEditor = vscode.window.visibleTextEditors.find(editor => editor.document === document);
    if (visibleEditor !== undefined) return Object.freeze({
      insertSpaces: visibleEditor.options.insertSpaces !== false,
      tabSize: typeof visibleEditor.options.tabSize === "number" ? visibleEditor.options.tabSize : 2,
    });
    const editor = vscode.workspace.getConfiguration("editor", document);
    return Object.freeze({
      insertSpaces: editor.get<boolean>("insertSpaces", true),
      tabSize: editor.get<number>("tabSize", 2),
    });
  };
  const editorIndentation = (editor: vscode.TextEditor) => Object.freeze({
    insertSpaces: editor.options.insertSpaces !== false,
    tabSize: typeof editor.options.tabSize === "number" ? editor.options.tabSize : 2,
  });
  const insertOrdinaryLineBreak = async (editor: vscode.TextEditor): Promise<void> => {
    const newline = editor.document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
    await editor.edit(edit => {
      for (const selection of editor.selections) {
        const line = editor.document.lineAt(selection.active.line).text;
        const indentation = /^[ \t]*/.exec(line)?.[0] ?? "";
        edit.replace(selection, newline + indentation);
      }
    }, { undoStopBefore: false, undoStopAfter: false });
  };
  const deleteOrdinaryLeft = async (editor: vscode.TextEditor): Promise<void> => {
    await editor.edit(edit => {
      for (const selection of editor.selections) {
        if (!selection.isEmpty) {
          edit.delete(selection);
          continue;
        }
        const position = selection.active;
        if (position.character > 0) {
          edit.delete(new vscode.Range(position.translate(0, -1), position));
        } else if (position.line > 0) {
          const previous = editor.document.lineAt(position.line - 1).range.end;
          edit.delete(new vscode.Range(previous, position));
        }
      }
    }, { undoStopBefore: false, undoStopAfter: false });
  };
  const updateStructuralContext = (): void => {
    const editor = vscode.window.activeTextEditor;
    const language = editor === undefined ? undefined : structuralLanguage(editor.document);
    const eligible = editor !== undefined && language !== undefined && editor.selections.length === 1 && editor.selection.isEmpty;
    if (!eligible || editor === undefined || language === undefined) {
      void vscode.commands.executeCommand("setContext", "hson.structuralEnter", false);
      void vscode.commands.executeCommand("setContext", "hson.structuralPairDeletion", false);
      return;
    }
    const text = editor.document.getText();
    const offset = editor.document.offsetAt(editor.selection.active);
    const evidence = evidenceFor(editor.document, language);
    const smartEnter = structural_newline_plan_from_evidence(
      evidence,
      offset,
      editorIndentation(editor),
      editor.document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n",
    ) !== undefined;
    const pairDeletion = eligible && text[offset - 1] === "<"
      && (text.startsWith("/>", offset) || text[offset] === ">")
      && structural_region_at_evidence(evidence, offset) !== undefined;
    void vscode.commands.executeCommand("setContext", "hson.structuralEnter", smartEnter);
    void vscode.commands.executeCommand("setContext", "hson.structuralPairDeletion", pairDeletion);
  };
  context.subscriptions.push(
    vscode.commands.registerCommand("type", async (args: Readonly<{ text?: string }> | undefined) => {
      const editor = vscode.window.activeTextEditor;
      const typed = args?.text;
      const language = editor === undefined ? undefined : structuralLanguage(editor.document);
      if ((typed !== "<" && typed !== "[" && typed !== "=" && typed !== "{") || editor === undefined || language === undefined
        || editor.selections.length !== 1 || !editor.selection.isEmpty) {
        await vscode.commands.executeCommand("default:type", args);
        return;
      }
      const document = editor.document;
      const offset = document.offsetAt(editor.selection.active);
      const text = document.getText();
      if (typed === "=" || typed === "{") {
        const snippet = structural_typing_snippet(evidenceFor(document, language), offset, typed);
        if (snippet === undefined) await vscode.commands.executeCommand("default:type", args);
        else await editor.insertSnippet(new vscode.SnippetString(snippet), editor.selection, {
          undoStopBefore: false,
          undoStopAfter: false,
        });
        return;
      }
      if (typed === "[") {
        if (structural_array_pair_for_bracket(document.fileName, language, text, offset)) {
          await editor.insertSnippet(new vscode.SnippetString("«$0»"), editor.selection, {
            undoStopBefore: false,
            undoStopAfter: false,
          });
        } else {
          await vscode.commands.executeCommand("default:type", args);
        }
        return;
      }
      const prospective = text.slice(0, offset) + "<" + text.slice(offset);
      const closer = structural_closer_for_less_than(document.fileName, language, prospective, offset + 1);
      if (closer === undefined) {
        await vscode.commands.executeCommand("default:type", args);
        return;
      }
      await editor.insertSnippet(new vscode.SnippetString("<$0" + closer), editor.selection, {
        undoStopBefore: false,
        undoStopAfter: false,
      });
    }),
    vscode.commands.registerCommand("hson.insertLineBreak", async () => {
      const editor = vscode.window.activeTextEditor;
      const language = editor === undefined ? undefined : structuralLanguage(editor.document);
      if (editor === undefined || language === undefined || editor.selections.length !== 1 || !editor.selection.isEmpty) {
        if (editor !== undefined) await insertOrdinaryLineBreak(editor);
        return;
      }
      const document = editor.document;
      const plan = structural_newline_plan_from_evidence(
        evidenceFor(document, language),
        document.offsetAt(editor.selection.active),
        editorIndentation(editor),
        document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n",
      );
      if (plan === undefined) {
        await insertOrdinaryLineBreak(editor);
        return;
      }
      const insertionOffset = document.offsetAt(editor.selection.start);
      const inserted = await editor.edit(edit => {
        edit.replace(editor.selection, plan.beforeCursor + plan.afterCursor);
      }, { undoStopBefore: false, undoStopAfter: false });
      if (inserted) {
        const cursor = document.positionAt(insertionOffset + plan.beforeCursor.length);
        editor.selection = new vscode.Selection(cursor, cursor);
      }
    }),
    vscode.commands.registerCommand("hson.deleteLeft", async () => {
      const editor = vscode.window.activeTextEditor;
      const language = editor === undefined ? undefined : structuralLanguage(editor.document);
      if (editor === undefined || language === undefined || editor.selections.length !== 1 || !editor.selection.isEmpty) {
        if (editor !== undefined) await deleteOrdinaryLeft(editor);
        return;
      }
      const document = editor.document;
      const offset = document.offsetAt(editor.selection.active);
      const text = document.getText();
      const closerLength = text.startsWith("/>", offset) ? 2 : text[offset] === ">" ? 1 : 0;
      if (closerLength === 0 || text[offset - 1] !== "<"
        || structural_region_at_evidence(evidenceFor(document, language), offset) === undefined) {
        await deleteOrdinaryLeft(editor);
        return;
      }
      const edit = new vscode.WorkspaceEdit();
      edit.delete(document.uri, new vscode.Range(document.positionAt(offset - 1), document.positionAt(offset + closerLength)));
      await vscode.workspace.applyEdit(edit);
    }),
    vscode.window.onDidChangeActiveTextEditor(updateStructuralContext),
    vscode.window.onDidChangeTextEditorSelection(updateStructuralContext),
    vscode.workspace.onDidChangeTextDocument(event => {
      structuralEvidence.invalidate(event.document.uri.toString());
      if (event.document === vscode.window.activeTextEditor?.document) updateStructuralContext();
    }),
    vscode.workspace.onDidCloseTextDocument(document => structuralEvidence.invalidate(document.uri.toString())),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (!event.affectsConfiguration("hson")) return;
      structuralEvidence.clear();
      updateStructuralContext();
    }),
  );
  updateStructuralContext();

  const formattingSaves = new ManualSaveTracker();
  const structuralFormattingEdits = (
    document: vscode.TextDocument,
    options: vscode.FormattingOptions,
    range?: vscode.Range,
  ): vscode.TextEdit[] => {
    const language = formattingLanguage(document);
    if (language === undefined) return [];
    return structural_formatting_edits(
      document.fileName,
      language,
      document.getText(),
      options,
      range === undefined ? undefined : { start: document.offsetAt(range.start), end: document.offsetAt(range.end) },
      document.languageId === 'hson' ? authoringMode(document) : undefined,
    ).map(edit => vscode.TextEdit.replace(
      new vscode.Range(document.positionAt(edit.start), document.positionAt(edit.end)), edit.text,
    ));
  };
  const formattingSelector: vscode.DocumentSelector = ["markdown", "hson"].flatMap(language =>
    [{ language, scheme: "file" }, { language, scheme: "untitled" }]);
  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider(formattingSelector, {
      provideDocumentFormattingEdits: (document, options) => formattingSaves.formattingAllowed(document.uri.toString()) ? structuralFormattingEdits(document, options) : [],
    }),
    vscode.languages.registerDocumentRangeFormattingEditProvider(formattingSelector, {
      provideDocumentRangeFormattingEdits: (document, range, options) => formattingSaves.formattingAllowed(document.uri.toString()) ? structuralFormattingEdits(document, options, range) : [],
    }),
  );
  const formatStructuralRegions = async (scope: "document" | "selection"): Promise<void> => {
    const initiatingEditor = vscode.window.activeTextEditor;
    if (initiatingEditor === undefined) return;
    const initiatingDocument = initiatingEditor.document;
    await vscode.commands.executeCommand(scope === "document" ? "editor.action.formatDocument" : "editor.action.formatSelection");
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined) return;
    if (!formatting_target_is_current(initiatingEditor, initiatingDocument, editor)) return;
    const language = formattingLanguage(initiatingDocument);
    if (language === undefined) return;
    const document = initiatingDocument;
    const requestedRange = scope === "selection" && !editor.selection.isEmpty
      ? { start: document.offsetAt(editor.selection.start), end: document.offsetAt(editor.selection.end) }
      : undefined;
    const edits = structuralFormattingEdits(
      document,
      editorIndentation(editor),
      requestedRange === undefined ? undefined : new vscode.Range(document.positionAt(requestedRange.start), document.positionAt(requestedRange.end)),
    );
    if (edits.length === 0) return;
    const workspaceEdit = new vscode.WorkspaceEdit();
    for (const edit of edits) workspaceEdit.replace(document.uri, edit.range, edit.newText);
    await vscode.workspace.applyEdit(workspaceEdit);
  };
  context.subscriptions.push(
    vscode.commands.registerCommand("hson.formatDocument", () => formatStructuralRegions("document")),
    vscode.commands.registerCommand("hson.formatSelection", () => formatStructuralRegions("selection")),
    vscode.workspace.onWillSaveTextDocument(event => {
      formattingSaves.willSave(event.document.uri.toString(), event.reason === vscode.TextDocumentSaveReason.Manual);
      if (event.reason !== vscode.TextDocumentSaveReason.Manual || formattingLanguage(event.document) === undefined
        || !vscode.workspace.getConfiguration("hson.formatting", event.document).get<boolean>("formatOnSave", true)) return;
      let edits: readonly vscode.TextEdit[] = [];
      try { edits = structuralFormattingEdits(event.document, documentIndentation(event.document)); }
      catch { edits = []; }
      event.waitUntil(Promise.resolve(edits));
    }),
    vscode.workspace.onDidSaveTextDocument(document => { formattingSaves.didSave(document.uri.toString()); }),
    vscode.workspace.onDidCloseTextDocument(document => formattingSaves.forget(document.uri.toString())),
  );
  const collection = vscode.languages.createDiagnosticCollection("hson");
  const diagnosticsOutput = vscode.window.createOutputChannel("Hson Diagnostics");
  context.subscriptions.push(collection, diagnosticsOutput);

  const localSchemaCollection = vscode.languages.createDiagnosticCollection("hson-schema-authoring");
  const publishLocalSchema = (document: vscode.TextDocument): void => {
    if (document.languageId !== "typescript" && document.languageId !== "typescriptreact") return;
    localSchemaCollection.set(document.uri, local_hson_schema_diagnostics(document.fileName, document.getText()).map(spec => {
      const diagnostic = new vscode.Diagnostic(new vscode.Range(document.positionAt(spec.start), document.positionAt(spec.end)), spec.message, vscode.DiagnosticSeverity.Error);
      diagnostic.source = "Hson Schema"; diagnostic.code = spec.code; return diagnostic;
    }));
  };
  for (const document of vscode.workspace.textDocuments) publishLocalSchema(document);
  context.subscriptions.push(localSchemaCollection,
    vscode.workspace.onDidOpenTextDocument(document => publishLocalSchema(document)),
    vscode.workspace.onDidChangeTextDocument(event => publishLocalSchema(event.document)),
    vscode.workspace.onDidCloseTextDocument(document => localSchemaCollection.delete(document.uri)));

  // Secure local defs/ref tooling deliberately shares the pure compiler with
  // authoring diagnostics. It never asks the trusted runtime to load a project.
  const localSchemaSelector = ["typescript", "typescriptreact"];
  const localSymbols = (document: vscode.TextDocument) => local_hson_schema_symbols(document.fileName, document.getText());
  context.subscriptions.push(
    // Completions share the authored TypeScript program through the tsserver plugin.
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

  const sourceWatcher = vscode.workspace.createFileSystemWatcher("**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,hson}");
  const projectWatcher = vscode.workspace.createFileSystemWatcher("**/*.json");
  context.subscriptions.push(sourceWatcher, projectWatcher);
  const sourceListeners = new Set<(changes: readonly WorkspaceSourceChange[]) => void>();
  const projectListeners = new Set<(scope?: WorkspaceDiscoveryScope, projects?: readonly string[]) => void>();
  let projectConfigurations = new Set<string>();
  let projectErrors = new Set<string>();
  const semanticChanges = new vscode.EventEmitter<void>();
  const moduleSource = (uri: vscode.Uri): boolean => uri.scheme === "file" && /\.(?:[cm]?[jt]s|[jt]sx)$/i.test(uri.path);
  const fireSource = (uri: vscode.Uri, kind: WorkspaceSourceChange["kind"], observationOnly = false): void => {
    const change = Object.freeze({ uri: uri.toString(), kind, affectsTypeScriptProjects: moduleSource(uri), observationOnly });
    for (const listener of sourceListeners) listener([change]);
  };
  const fireProject = (scope?: WorkspaceDiscoveryScope, projects?: readonly string[]) => {
    for (const listener of projectListeners) listener(scope, projects);
  };
  const onProjectJson = (uri: vscode.Uri): void => {
    // A configuration can change or disappear before its first discovery is accepted.
    if (is_typescript_configuration_path(uri.path) || projectConfigurations.has(uri.toString()) || /\/package\.json$/i.test(uri.path)) fireProject();
  };
  context.subscriptions.push(
    semanticChanges,
    sourceWatcher.onDidCreate(uri => fireSource(uri, "create")),
    sourceWatcher.onDidChange(uri => fireSource(uri, "change")),
    sourceWatcher.onDidDelete(uri => fireSource(uri, "delete")),
    projectWatcher.onDidCreate(onProjectJson),
    projectWatcher.onDidChange(onProjectJson),
    projectWatcher.onDidDelete(onProjectJson),
    vscode.workspace.onDidChangeTextDocument(event => {
      if (event.contentChanges.length > 0 && moduleSource(event.document.uri)) fireSource(event.document.uri, "change");
    }),
    vscode.workspace.onDidSaveTextDocument(document => fireSource(document.uri, "change")),
    vscode.workspace.onDidChangeWorkspaceFolders(() => fireProject("all")),
  );
  const register = <Listener>(listeners: Set<Listener>, listener: Listener): vscode.Disposable => {
    listeners.add(listener);
    return new vscode.Disposable(() => listeners.delete(listener));
  };
  // Inventory remains available when VS Code has no semantic TypeScript service.
  const projectScanner = new TypeScriptProjectScanner(ts, false);
  let discoverySession: string | undefined, projectRevision: ProjectRevisions | undefined;
  const requestProjects = async (request: ProjectDiscoveryRequest | { revisionOnly: true }) => {
    try {
      const reply = await vscode.commands.executeCommand<{ success?: boolean; body?: ProjectDiscoveryResponse }>(
        "typescript.tsserverRequest", PROJECT_DISCOVERY_COMMAND, request);
      if (reply?.success && typeof reply.body?.sessionId === "string" && Array.isArray(reply.body.revision)) return reply.body;
    } catch { /* A stopped or unavailable service cannot issue import evidence. */ }
    return undefined;
  };
  // SDK selection/restart can change bindings without changing any workspace file.
  // Native diagnostic updates let us check the service generation without rescanning the filesystem.
  let checkingRevision = false;
  context.subscriptions.push(vscode.languages.onDidChangeDiagnostics(async event => {
    if (!vscode.workspace.isTrusted || checkingRevision || !event.uris.some(moduleSource)) return;
    checkingRevision = true;
    const session = discoverySession, revision = projectRevision;
    try {
      const current = await requestProjects({ revisionOnly: true });
      if (session !== discoverySession || revision !== projectRevision) return;
      if (current?.sessionId !== session) {
        fireProject();
        discoverySession = current?.sessionId;
        projectRevision = current?.revision;
      } else if (current) {
        const before = new Map(revision);
        const after = new Map(current.revision);
        projectRevision = current.revision;
        if (after.size !== before.size || [...after.keys()].some(project => !before.has(project))) fireProject();
        else {
          const changed = [...after].filter(([project, version]) => before.get(project) !== version).map(([project]) => project);
          if (changed.length) fireProject("projects", changed);
        }
      }
    } finally { checkingRevision = false; }
  }));
  const discoverSources: WorkspaceDiagnosticHost["discoverSources"] = async ({ changedUris, isCurrent, standalone, typescript, withdrawEventSources }) => {
    const folders = vscode.workspace.workspaceFolders ?? [];
    await new Promise<void>(resolveYield => setTimeout(resolveYield, 0));
    const standaloneUris = standalone ? (await Promise.all(folders.map(folder => vscode.workspace.findFiles(
      new vscode.RelativePattern(folder, "**/*.hson"),
      "**/{node_modules,.git,dist,build,out,coverage}/**",
    )))).flat() : [];
    if (!isCurrent()) return { sources: [] };
    const standaloneSources: WorkspaceDiagnosticSource[] = standaloneUris.map(uri => Object.freeze({
      uri: uri.toString(),
      fileName: uri.fsPath,
      languageId: "hson",
      authoringMode: standaloneAuthoringMode(vscode.workspace.getConfiguration('hson.authoring',uri).get('mode')),
    }));
    if (!typescript) return { sources: standaloneSources };
    const fileFolders = folders.filter(folder => folder.uri.scheme === "file");
    const openModules = vscode.workspace.textDocuments.filter(document => moduleSource(document.uri));
    const withoutEventDiagnostics = new Set(openModules.filter(document => document.languageId !== "typescript"
      && document.languageId !== "typescriptreact").map(document => document.uri.toString()));
    const request: ProjectDiscoveryRequest = { roots: fileFolders.map(folder => folder.uri.fsPath),
      openFiles: openModules.map(document => [document.fileName, document.getText(), document.isDirty]),
      changedFiles: changedUris?.map(uri => vscode.Uri.parse(uri).fsPath) };
    let authoritative: ProjectDiscoveryResponse | undefined;
    if (vscode.workspace.isTrusted) {
      await vscode.extensions.getExtension("vscode.typescript-language-features")?.activate().then(undefined, () => undefined);
      authoritative = await requestProjects(request);
      if (authoritative?.projects) {
        const currentSources = authoritative.projects.sources;
        // An edited dependency can bring a consumer into a project that did
        // not own it in the last publication. The scanner now has both
        // memberships and can withdraw the disputed proof before accepting
        // any new positive evidence.
        withdrawEventSources(revision => {
          let retained: typeof publishedEventSources | undefined;
          for (const source of currentSources) {
            const uri = vscode.Uri.file(source.fileName).toString();
            const before = publishedEventSources.get(uri);
            if (!before || !source.owners.some(owner => !before.owners.includes(owner))) continue;
            const current = source.eventEvidence;
            if (current?.textHash === before.proof.textHash && before.proof.importOffsets.every(offset => current.importOffsets.includes(offset))) continue;
            (retained ??= new Map(publishedEventSources)).delete(uri);
          }
          return retained === undefined ? [] : publishEventSources(retained, revision);
        });
      }
    }
    if (!isCurrent()) return { sources: [] };
    let projects = authoritative?.projects;
    if (authoritative?.discoveryId === undefined) projects = undefined;
    if (!projects) {
      const openFiles = new Map<string, string>();
      for (const [file, content, dirty] of request.openFiles) if (dirty || ts.sys.fileExists(file)) openFiles.set(file, content);
      const scan = projectScanner.scan(request.roots, openFiles);
      let step = scan.next();
      while (!step.done) {
        await new Promise<void>(resolveYield => setTimeout(resolveYield, 0));
        if (!isCurrent()) return { sources: [] };
        step = scan.next();
      }
      projects = step.value;
    }
    const discovered = projects;
    // A syntax-only fallback during trusted startup cannot settle package identity.
    const awaitingProjectService = authoritative?.discoveryId === undefined && vscode.workspace.isTrusted
      && vscode.extensions.getExtension("vscode.typescript-language-features") !== undefined;
    const proofs = new Map<string, { proof: EventSourceEvidence; owners: readonly string[] }>();
    const sources = discovered.sources.map(source => {
      const uri = vscode.Uri.file(source.fileName).toString();
      const eventEvidence = withoutEventDiagnostics.has(uri) ? undefined : source.eventEvidence;
      if (eventEvidence) proofs.set(uri, { proof: eventEvidence, owners: source.owners });
      return Object.freeze({ uri, fileName: source.fileName, languageId: source.languageId, eventEvidence,
        ...(source.eventEvidencePending || awaitingProjectService ? { eventEvidencePending: true } : {}) });
    });
    return { sources: [...sources, ...standaloneSources], accept: revision => {
      if (authoritative) discoverySession = authoritative.sessionId;
      projectRevision = authoritative?.revision;
      projectFiles = new Map(discovered.projectFiles.map(([project, files]) => [project, new Map(files)]));
      projectConfigurations = new Set(discovered.configurations.map(fileName => vscode.Uri.file(fileName).toString()));
      for (const error of discovered.errors) if (!projectErrors.has(error)) diagnosticsOutput.appendLine(error);
      projectErrors = new Set(discovered.errors);
      return publishEventSources(proofs, revision, authoritative?.discoveryId);
    } };
  };
  let projectFiles = new Map<string, ReadonlyMap<string, string | null>>();
  let publishedEventSources = new Map<string, { proof: EventSourceEvidence; owners: readonly string[] }>();
  let pendingConfiguration: EventSourceConfiguration | undefined;
  type TypeScriptExports = { getAPI(version: 0): { configurePlugin(name: string, configuration: EventSourceConfiguration): void } | undefined };
  const publishEventSources = (next: typeof publishedEventSources, revision: number, discoveryId?: string): readonly string[] => {
    const previous = publishedEventSources;
    const affected = [...new Set([...previous.keys(), ...next.keys()])].filter(uri => {
      const before = previous.get(uri)?.proof, after = next.get(uri)?.proof;
      return before?.textHash !== after?.textHash || before?.importOffsets.join(",") !== after?.importOffsets.join(",");
    });
    publishedEventSources = next;
    const eventSources = [...next.values()].map(({ proof, owners }) => ({ ...proof, owners }));
    if (affected.length) {
      eventImports = event_source_imports(eventSources, ts.sys.useCaseSensitiveFileNames);
      for (const uri of affected) bindingCache.forget(uri);
    }
    const sessionId = discoverySession;
    const configuration: EventSourceConfiguration | undefined = sessionId === undefined ? undefined : discoveryId === undefined
      ? { sessionId, revision, retainedEventSources: eventSources }
      : { sessionId, revision, discoveryId, eventSources };
    pendingConfiguration = configuration;
    if (configuration) {
      const languageFeatures = vscode.extensions.getExtension<TypeScriptExports>("vscode.typescript-language-features");
      const send = (extension: TypeScriptExports | undefined) => {
        if (pendingConfiguration === configuration) extension?.getAPI(0)?.configurePlugin("hson-schema-typescript-plugin", configuration);
      };
      if (languageFeatures?.isActive) send(languageFeatures.exports);
      else void languageFeatures?.activate().then(send, () => { /* Syntax tooling stays available. */ });
    }
    if (affected.length) {
      const affectedUris = new Set(affected);
      if (vscode.window.visibleTextEditors.some(editor => affectedUris.has(editor.document.uri.toString()))) void appearanceEditor.refreshDecorations();
      semanticChanges.fire();
    }
    return affected;
  };
  const host: WorkspaceDiagnosticHost = {
    openDocuments: () => vscode.workspace.textDocuments.map(adaptDocument),
    discoverSources,
    eventImports: (file, text) => eventImports(file, text),
    invalidateProjects: (revision, change, projects) => {
      if ((change === undefined && projects === undefined) || (change?.affectsTypeScriptProjects && change.kind === "delete")) {
        return publishEventSources(new Map(), revision);
      }
      const changedUri = change?.uri;
      const affected = new Set(projects);
      if (change !== undefined) {
        const keys = project_file_keys(vscode.Uri.parse(change.uri).fsPath);
        const [path, identity] = keys;
        const aliases = new Set<string>(keys);
        let knownOnDisk = false;
        for (const files of projectFiles.values()) {
          const priorIdentity = files.get(path);
          if (!priorIdentity) continue;
          knownOnDisk = true;
          aliases.add(priorIdentity);
        }
        // A watcher can report a rewrite as a create. Attribute it only when
        // the exact path was already backed by a file in accepted discovery.
        // Include its previous identity in case a replacement changed inodes.
        if (change.affectsTypeScriptProjects && change.kind === "create" && (!knownOnDisk || identity === undefined)) {
          return publishEventSources(new Map(), revision);
        }
        const changedKeys = [...aliases];
        for (const [project, files] of projectFiles) {
          if (changedKeys.some(key => files.has(key))) affected.add(project);
        }
      }
      if (publishedEventSources.size === 0) return [];
      const retained = new Map([...publishedEventSources].filter(([uri, entry]) => uri !== changedUri
        && !entry.owners.some(project => affected.has(project))));
      return retained.size === publishedEventSources.size ? [] : publishEventSources(retained, revision);
    },
    readSource: async source => {
      if (source.languageId === "hson") return new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.parse(source.uri)));
      // Use the compiler's BOM handling. Event proof also requires the decoded
      // text to match the active SDK's authored snapshot exactly.
      const text = ts.sys.readFile(source.fileName);
      if (text === undefined) throw new Error(`Cannot read TypeScript source: ${source.fileName}`);
      return text;
    },
    onDidOpen: (listener) => vscode.workspace.onDidOpenTextDocument(document => {
      if (moduleSource(document.uri)) fireSource(document.uri, "change",
        !document.isDirty && document.getText() === ts.sys.readFile(document.fileName));
      listener(adaptDocument(document));
    }),
    onDidChange: (listener) => vscode.Disposable.from(
      vscode.workspace.onDidChangeTextDocument(event => listener(adaptDocument(event.document))),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (!event.affectsConfiguration('hson.authoring.mode')) return;
        for (const document of vscode.workspace.textDocuments) if (document.languageId === 'hson') listener(adaptDocument(document));
      })),
    onDidClose: (listener) => vscode.workspace.onDidCloseTextDocument(document => {
      if (moduleSource(document.uri)) fireSource(document.uri, "change",
        !document.isDirty && document.getText() === ts.sys.readFile(document.fileName));
      listener(adaptDocument(document));
    }),
    onDidChangeSources: listener => register(sourceListeners, listener),
    onDidChangeProjects: listener => vscode.Disposable.from(register(projectListeners, listener),
      vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('hson.authoring.mode')) listener("standalone"); })),
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
      if (specs.length === 0) {
        collection.set(uri, []);
        return;
      }
      const locator = create_host_source_locator(document.text)!;
      const positionAt = (offset: number): vscode.Position => {
        const { line, column } = locator.positionAt(Math.max(0, Math.min(offset, document.text.length)))!;
        return new vscode.Position(line - 1, column - 1);
      };
      const toRange = ({ start, end }: HostSourceRange) => new vscode.Range(positionAt(start), positionAt(end));
      const diagnostics = specs.map((spec) => {
        const diagnostic = new vscode.Diagnostic(
          toRange(spec.range),
          spec.message,
          vscode.DiagnosticSeverity.Error,
        );
        diagnostic.source = spec.source;
        diagnostic.code = spec.code;
        diagnostic.relatedInformation = spec.related.map((related) =>
          new vscode.DiagnosticRelatedInformation(
            new vscode.Location(uri, toRange(related.range)),
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

  // Independent of Schema associations and completion providers.
  const grammar = load_hson_grammar(context.extensionPath);
  const appearanceEditor = new HsonAppearanceEditor(context.extensionPath, grammar, bindingCache, scratchpads, document => {
    if (document.languageId !== 'hson') return 'all';
    const mode = authoringMode(document); return mode === 'canonical' ? 'all' : mode;
  });
  context.subscriptions.push(appearanceEditor, vscode.commands.registerCommand("hson.openAppearance", () =>
    appearanceEditor.open().catch(error => { void vscode.window.showErrorMessage(`Hson Appearance: ${String(error)}`); })));
  context.subscriptions.push(start_workspace_diagnostics(host, publisher));
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(() => semanticChanges.fire()),
    vscode.workspace.onDidChangeConfiguration(() => semanticChanges.fire()),
    vscode.languages.registerDocumentSemanticTokensProvider(
      ["hson", "markdown", "typescript", "typescriptreact"], {
        onDidChangeSemanticTokens: semanticChanges.event,
        provideDocumentSemanticTokens: (document, cancellation) => document_semantic_tokens(document, cancellation, grammar, bindingCache),
      }, hsonSemanticLegend));
  // TS/TSX islands retain host string metadata, so native bracket colors cannot
  // see them. Standalone Hson and Markdown continue using native colorization.
  const depthCache = new HsonDelimiterDepthCache();
  const depthDecorations = new HsonDepthDecorationSet(colorId =>
    vscode.window.createTextEditorDecorationType({ color: new vscode.ThemeColor(colorId) }));
  const presentDepth = async (editor: vscode.TextEditor): Promise<void> => {
    const document = editor.document;
    const language = document.languageId;
    const set = (decoration: vscode.TextEditorDecorationType, ranges: readonly { start: number; end: number }[]) =>
      editor.setDecorations(decoration, ranges.map(range => new vscode.Range(document.positionAt(range.start), document.positionAt(range.end))));
    const enabled = vscode.workspace.getConfiguration("editor", document).get<boolean>("bracketPairColorization.enabled", true);
    if (!enabled || language !== "typescript" && language !== "typescriptreact") {
      depthDecorations.apply(set, [], false);
      return;
    }
    const version = document.version;
    const loaded = await grammar;
    if (document.isClosed || document.version !== version || editor.document !== document) return;
    // Recheck enablement after the asynchronous grammar load.
    if (!vscode.workspace.getConfiguration("editor", document).get<boolean>("bracketPairColorization.enabled", true)) {
      depthDecorations.apply(set, [], false);
      return;
    }
    depthDecorations.apply(set, depthCache.get(loaded, evidenceFor(document, language)), true);
  };
  const presentVisibleDepth = (): void => {
    for (const editor of vscode.window.visibleTextEditors) void presentDepth(editor);
  };
  presentVisibleDepth();
  context.subscriptions.push(depthDecorations,
    vscode.window.onDidChangeVisibleTextEditors(presentVisibleDepth),
    vscode.workspace.onDidChangeTextDocument(event => {
      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document === event.document) void presentDepth(editor);
      }
    }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration("editor.bracketPairColorization")) presentVisibleDepth();
    }),
    vscode.window.onDidChangeActiveColorTheme(() => {
      depthDecorations.refresh();
      presentVisibleDepth();
    }));
  // Exact h/s/o/n and H/S/O/N identity colors are presentation-only. Binding
  // discovery and canonical Markdown fence structure are the authorities;
  // decoration never participates in admission.
  let markerDecorations = new Map<string, vscode.TextEditorDecorationType>();
  let colorLibraryMarker = true;
  const replaceMarkerDecorations = (): void => {
    for (const decoration of markerDecorations.values()) decoration.dispose();
    const appearance = vscode.workspace.getConfiguration("hson.appearance");
    const libraryStrength = marker_strength(appearance.get<number>("libraryMarkerStrength"), HSON_BRANDING.libraryOpacity);
    const authoringStrength = marker_strength(appearance.get<number>("authoringMarkerStrength"), HSON_BRANDING.authoringOpacity);
    colorLibraryMarker = appearance.get<boolean>("colorLibraryMarker", HSON_BRANDING.colorLibraryMarker);
    markerDecorations = new Map(hsonIdentityMarkers.map((marker): [string, vscode.TextEditorDecorationType] => {
      return [marker.colorId,
        vscode.window.createTextEditorDecorationType({
          color: marker_color(appearance, marker, new vscode.ThemeColor(marker.colorId)),
          opacity: String(marker.strength === "strong" ? libraryStrength : authoringStrength),
        })];
    }).concat([[
      HSON_LIBRARY_SEPARATOR_COLOR_ID,
      vscode.window.createTextEditorDecorationType({
        color: marker_color(appearance, HSON_BRANDING.librarySeparator, new vscode.ThemeColor(HSON_LIBRARY_SEPARATOR_COLOR_ID)),
        opacity: String(libraryStrength),
      }),
    ]]));
  };
  replaceMarkerDecorations();
  const presentMarkers = (editor: vscode.TextEditor): void => {
    const document = editor.document;
    const presentation = document.languageId === "typescript" || document.languageId === "typescriptreact"
      ? hson_identity_presentation(document.fileName, document.getText(), colorLibraryMarker)
      : document.languageId === "markdown"
        ? { markers: markdown_hson_fence_marker_parts(document.getText(), colorLibraryMarker), separators: [] }
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
    for (const editor of vscode.window.visibleTextEditors) void presentMarkers(editor);
  };
  presentVisibleMarkers();
  context.subscriptions.push({ dispose(): void { for (const decoration of markerDecorations.values()) decoration.dispose(); } },
    vscode.window.onDidChangeVisibleTextEditors(presentVisibleMarkers),
    vscode.workspace.onDidChangeTextDocument(event => {
      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document === event.document) void presentMarkers(editor);
      }
    }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (!event.affectsConfiguration("hson.appearance")) return;
      replaceMarkerDecorations();
      presentVisibleMarkers();
    }));
  type ManagedSchemaWatch = Readonly<{ folder: vscode.WorkspaceFolder; project: string; child: ChildProcess }>;
  const schemaToolOutput = vscode.window.createOutputChannel("Hson Schema");
  const schemaWatches = new Map<string, ManagedSchemaWatch>();
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
  const currentSchemaToolState = (): SchemaToolState => {
    const folder = vscode.window.activeTextEditor === undefined ? undefined : vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri);
    const entries = [...schemaToolStates.entries()].filter(([key]) => folder === undefined || key.startsWith(`${folder.uri.toString()}::`));
    const states = entries.map(([, state]) => state);
    return states.includes("error") ? "error" : states.includes("stale") ? "stale" : states.includes("starting") ? "starting" : states.includes("watching") ? "watching" : "stopped";
  };
  const hsonStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 11);
  hsonStatus.name = "Hson Extension";
  hsonStatus.command = "hson.actions";
  let localHostState: LocalHostState = "stopped";
  let displayedTooltip: string | undefined;
  const updateHsonStatus = (): void => {
    const schemaState = currentSchemaToolState();
    const url = localHostManager?.currentUrl;
    const presentation = hson_status_presentation(schemaState, localHostState, url);
    const tooltipContent = hson_status_tooltip(schemaState, localHostState, url);
    // An open VS Code status hover can retain old command links after a tooltip update.
    // Removing the existing item dismisses that hover before the current state is shown.
    if (displayedTooltip !== undefined && displayedTooltip !== tooltipContent) hsonStatus.hide();
    displayedTooltip = tooltipContent;
    hsonStatus.text = presentation.text;
    const tooltip = new vscode.MarkdownString(tooltipContent);
    tooltip.isTrusted = { enabledCommands: HSON_TOOLTIP_COMMANDS };
    hsonStatus.tooltip = tooltip;
    hsonStatus.backgroundColor = presentation.error ? new vscode.ThemeColor("statusBarItem.errorBackground") : undefined;
    hsonStatus.show();
  };
  const updateSchemaToolStatus = updateHsonStatus;
  localHostManager = new LocalHostExtensionManager(context, state => {
    localHostState = state;
    updateHsonStatus();
  });
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
  const stopSchemaWatch = async (requested?: vscode.Uri): Promise<void> => {
    const folder = await schemaToolFolder(requested);
    if (folder === undefined) return;
    const matches = [...schemaWatches.entries()].filter(([, watch]) => watch.folder.uri.toString() === folder.uri.toString());
    if (matches.length === 0) { schemaToolStates.set(`${folder.uri.toString()}::none`, "stopped"); updateSchemaToolStatus(); return; }
    for (const [key, watch] of matches) {
      schemaToolOutput.appendLine(`Stopping extension-managed hson-schema watch for ${watch.project}.`);
      await new Promise<void>(resolveStopped => {
        if (watch.child.exitCode !== null || watch.child.signalCode !== null) return resolveStopped();
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
        if (code === 0) { schemaToolOutput.appendLine(`Hson Schema ${mode} completed in ${Math.round(performance.now() - started)}ms.`); schemaToolStates.set(key, schemaWatches.has(key) ? "watching" : "stopped"); }
        else { schemaToolOutput.appendLine(`Hson Schema ${mode} exited with code ${code ?? "unknown"}.`); schemaToolStates.set(key, "error"); void vscode.window.showErrorMessage(`Hson Schema ${mode} failed.`, "Show Hson Output").then(action => action === "Show Hson Output" && schemaToolOutput.show(true)); }
        updateSchemaToolStatus(); resolveOnce();
      });
    });
  };
  const startSchemaWatch = async (requested?: vscode.Uri): Promise<boolean> => {
    const prepared = await prepareSchemaTool(requested);
    if (prepared === undefined) return false;
    const key = schemaWatchKey(prepared.folder, prepared.project);
    if (schemaWatches.has(key)) { schemaToolOutput.appendLine(`Hson Schema watch is already running for ${prepared.project}.`); updateSchemaToolStatus(); return true; }
    schemaToolOutput.appendLine(`Starting hson-schema watch --project ${prepared.project}`);
    const child = spawn(process.execPath, [prepared.executable, "watch", "--project", prepared.project], { cwd: prepared.folder.uri.fsPath, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
    const watch = Object.freeze({ folder: prepared.folder, project: prepared.project, child });
    schemaWatches.set(key, watch); schemaToolStates.set(key, "starting");
    appendProcessOutput(child, line => {
      const state = schema_watch_output_state(line);
      if (state === undefined || !schemaWatches.has(key)) return;
      schemaToolStates.set(key, state); updateSchemaToolStatus();
    });
    updateSchemaToolStatus();
    child.once("error", error => { schemaToolOutput.appendLine(`Hson Schema watch failed to start: ${error.message}`); schemaWatches.delete(key); schemaToolStates.set(key, "error"); updateSchemaToolStatus(); });
    child.once("close", code => {
      const managed = schemaWatches.delete(key);
      if (managed) { schemaToolStates.set(key, code === 0 ? "stopped" : "error"); schemaToolOutput.appendLine(`Hson Schema watch exited with code ${code ?? "unknown"}.`); if (code !== 0) void vscode.window.showErrorMessage("Hson Schema watch stopped unexpectedly.", "Show Hson Output").then(action => action === "Show Hson Output" && schemaToolOutput.show(true)); }
      updateSchemaToolStatus();
    });
    return new Promise<boolean>(resolveStart => {
      child.once("spawn", () => resolveStart(true));
      child.once("error", () => resolveStart(false));
    });
  };
  const runAll = async (): Promise<void> => {
    const folders = (vscode.workspace.workspaceFolders ?? []).filter(folder => folder.uri.scheme === "file");
    const services: DevelopmentService[] = [];
    for (const folder of folders) {
      const name = (service: string): string => folders.length === 1 ? service : `${folder.name}: ${service}`;
      try { discover_schema_project(folder.uri.fsPath); services.push({ name: name("Schema Watch"), start: () => startSchemaWatch(folder.uri) }); }
      catch { /* No Schema project is configured in this folder. */ }
      if (localHostManager?.hasConfiguredApp(folder)) services.push({ name: name("Local App"), reportsFailure: true, start: () => localHostManager?.start(folder.uri) ?? Promise.resolve(false) });
    }
    const failures = await run_development_services(services);
    if (services.length === 0) void vscode.window.showWarningMessage("No Hson development services are configured in this workspace.");
    else if (failures.length > 0) void vscode.window.showErrorMessage(`Hson: Run All could not start ${failures.join(" and ")}.`);
  };
  const stopAll = async (): Promise<void> => {
    for (const folder of vscode.workspace.workspaceFolders ?? []) await localHostManager?.stopRunning(folder);
    for (const [key, watch] of schemaWatches) {
      await new Promise<void>(resolveStopped => {
        if (watch.child.exitCode !== null || watch.child.signalCode !== null) return resolveStopped();
        watch.child.once("close", () => resolveStopped());
        terminate_schema_process(watch.child);
      });
      schemaWatches.delete(key);
      schemaToolStates.set(key, "stopped");
    }
    updateSchemaToolStatus();
  };
  updateSchemaToolStatus();
  context.subscriptions.push(
    vscode.commands.registerCommand("hson.openSettings", () => vscode.commands.executeCommand("workbench.action.openSettings", HSON_SETTINGS_QUERY)),
    vscode.commands.registerCommand("hson.generateSchemaTypes", (uri?: vscode.Uri) => runSchemaOnce("generate", uri)),
    vscode.commands.registerCommand("hson.checkSchemas", (uri?: vscode.Uri) => runSchemaOnce("check", uri)),
    vscode.commands.registerCommand("hson.startSchemaWatch", (uri?: vscode.Uri) => startSchemaWatch(uri)),
    vscode.commands.registerCommand("hson.runAll", runAll),
    vscode.commands.registerCommand("hson.stopAll", stopAll),
    vscode.commands.registerCommand("hson.stopSchemaWatch", (uri?: vscode.Uri) => stopSchemaWatch(uri)),
    vscode.commands.registerCommand("hson.showSchemaOutput", () => schemaToolOutput.show(true)),
    vscode.commands.registerCommand("hson.actions", async () => {
      const editor = vscode.window.activeTextEditor;
      const canFormatDocument = editor !== undefined && formattingLanguage(editor.document) !== undefined;
      const actions = hson_quick_pick_actions(
        { document: canFormatDocument, selection: canFormatDocument && !editor.selection.isEmpty },
        localHostManager?.quickPickActions() ?? [],
        currentSchemaToolState(),
      );
      type PickerItem = vscode.QuickPickItem & { command?: string };
      const items: PickerItem[] = [];
      let section: string | undefined;
      for (const action of actions) {
        if (action.section !== section) {
          section = action.section;
          items.push({ label: section, kind: vscode.QuickPickItemKind.Separator });
        }
        items.push({ label: action.label, command: action.command });
      }
      const action = await vscode.window.showQuickPick(items, { placeHolder: "Hson actions" });
      if (action?.command !== undefined) await vscode.commands.executeCommand(action.command);
    }),
  );
  context.subscriptions.push(schemaToolOutput, hsonStatus,
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

export async function deactivate(): Promise<void> {
  const scratchpads = appearanceScratchpads;
  appearanceScratchpads = undefined;
  const manager = localHostManager;
  localHostManager = undefined;
  try { await scratchpads?.flush(); }
  finally { await manager?.disposeAsync(); }
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
