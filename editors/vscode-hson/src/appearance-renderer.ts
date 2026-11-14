import * as vscode from "vscode";
import type { IGrammar } from "vscode-textmate";
import { AppearanceSpanCache, appearanceRoles, type AppearanceColors, type AppearanceRole } from "./appearance-spans.js";

/** One renderer for both Saved and Draft. Its ownership is an explicit document
 * set; normal editors and native-owned ranges never receive these decorations. */
export class AppearanceRenderer implements vscode.Disposable {
  private readonly documents = new Set<vscode.TextDocument>();
  private readonly decorations = new Map<AppearanceRole, { color: string; type: vscode.TextEditorDecorationType }>();
  private readonly subscriptions: vscode.Disposable[];
  private disposed = false;
  constructor(private readonly grammar: Promise<IGrammar>, private readonly cache = new AppearanceSpanCache()) {
    this.subscriptions = [
      vscode.window.onDidChangeVisibleTextEditors(() => { void this.refresh(); }),
      vscode.workspace.onDidChangeTextDocument(event => {
        if (this.documents.has(event.document)) {
          this.cache.forget(event.document.uri.toString());
          // Clear transformed ranges immediately; never leave stale color on a
          // newly native expression while asynchronous classification catches up.
          for (const editor of vscode.window.visibleTextEditors) if (editor.document === event.document) this.clearEditor(editor);
          void this.refresh();
        }
      }),
      vscode.workspace.onDidCloseTextDocument(document => {
        this.documents.delete(document);
        this.cache.forget(document.uri.toString());
      }),
    ];
  }
  async attach(document: vscode.TextDocument): Promise<void> {
    if (this.disposed) return;
    this.documents.add(document);
    await this.refresh();
  }
  async setColors(colors: AppearanceColors): Promise<void> {
    if (this.disposed) return;
    for (const role of appearanceRoles) {
      const previous = this.decorations.get(role);
      if (previous?.color === colors[role]) continue;
      previous?.type.dispose();
      this.decorations.set(role, { color: colors[role], type: vscode.window.createTextEditorDecorationType({
        color: colors[role], rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
      }) });
    }
    await this.refresh();
  }
  private clearEditor(editor: vscode.TextEditor): void {
    for (const { type } of this.decorations.values()) editor.setDecorations(type, []);
  }
  async refresh(): Promise<void> {
    const grammar = await this.grammar;
    if (this.disposed) return;
    for (const editor of vscode.window.visibleTextEditors) {
      const document = editor.document;
      if (!this.documents.has(document) || document.isClosed) continue;
      const spans = this.cache.get(grammar, { uri: document.uri.toString(), fileName: document.fileName,
        languageId: document.languageId, version: document.version, text: document.getText() });
      for (const [role, { type }] of this.decorations) editor.setDecorations(type, spans.filter(span => span.role === role)
        .map(({ range }) => new vscode.Range(document.positionAt(range.start), document.positionAt(range.end))));
    }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const subscription of this.subscriptions) subscription.dispose();
    for (const { type } of this.decorations.values()) type.dispose();
    this.decorations.clear();
    this.documents.clear();
    this.cache.clear();
  }
}
