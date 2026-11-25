import { markdown_hson_fence_regions } from "./markdown-fence-marker.js";
import * as vscode from "vscode";
import type { IGrammar } from "vscode-textmate";
import { createHash, randomUUID } from "node:crypto";
import { embedded_binding_highlights, hson_literal_highlights } from "./highlighting.js";
import { HsonBindingCache, binding_highlights } from "./binding-intelligence.js";
import { nativeTokenTypes, nativeTokenModifiers, read_native_tokens, NATIVE_SEMANTIC_COMMAND,
  isRecord, NATIVE_SEMANTIC_PROTOCOL, SEMANTIC_DOCUMENT_LIMIT } from "./native-semantic-tokens.js";

import { hsonTokenDefinitions, hsonTokenModifierDefinitions } from "./appearance-internals.js";

export { nativeTokenTypes, nativeTokenModifiers } from "./native-semantic-tokens.js";
export const hsonSemanticLegend = new vscode.SemanticTokensLegend([...nativeTokenTypes, ...Object.keys(hsonTokenDefinitions)], [...nativeTokenModifiers, ...Object.keys(hsonTokenModifierDefinitions)]);
const defaultBindingCache = new HsonBindingCache();

/** Public range-token and legend commands cannot identify a common provider.
 * The existing TS plugin instead returns an atomic, content-bound 2020 snapshot.
 * Unavailable/invalid snapshots yield to VS Code's native range highlighting. */
export async function document_semantic_tokens(
  document: vscode.TextDocument, cancellation: vscode.CancellationToken, grammar: Promise<IGrammar>,
  bindings: HsonBindingCache = defaultBindingCache, refresh?: NativeSemanticRefresh,
): Promise<vscode.SemanticTokens | undefined> {
  const version = document.version, text = document.getText();
  const stale = () => cancellation.isCancellationRequested || document.isClosed || document.version !== version;
  // At most twenty native requests; every atomic snapshot has the same bound.
  if (stale() || text.length > SEMANTIC_DOCUMENT_LIMIT) return undefined;
  try {
    const loaded = await grammar;
    if (stale()) return undefined;
    const snapshot = bindings.get({ uri: document.uri.toString(), fileName: document.fileName, languageId: document.languageId, version, text });
    // Standalone and Markdown need only this sparse overlay. TextMate continues
    // owning other tokens and all host Markdown content. Scanner-proven names
    // also correct keyword-shaped Data keys without replacing that grammar.
    if (document.languageId === "hson" || document.languageId === "markdown") {
      const builder = new vscode.SemanticTokensBuilder(hsonSemanticLegend);
      const regions = document.languageId === 'hson' ? [{bodyRange:{start:0,end:text.length}}] : markdown_hson_fence_regions(text);
      for (const {bodyRange} of regions) for (const token of hson_literal_highlights(loaded,text.slice(bodyRange.start,bodyRange.end))) {
        if (token.scannerName) builder.push(new vscode.Range(document.positionAt(bodyRange.start+token.range.start),document.positionAt(bodyRange.start+token.range.end)),token.type,[]);
      }
      for (const token of binding_highlights(snapshot)) builder.push(new vscode.Range(document.positionAt(token.range.start), document.positionAt(token.range.end)), token.type, [...token.modifiers]);
      return stale() ? undefined : builder.build();
    }
    const hson = embedded_binding_highlights(loaded, snapshot);
    if (hson.length === 0) return undefined;
    await vscode.extensions.getExtension("vscode.typescript-language-features")?.activate();
    if (stale()) return undefined;
    const textHash = createHash("sha256").update(text).digest("hex"), requestId = randomUUID();
    const observe = refresh?.begin(document, version);
    const native = await read_native_tokens(document, text.length, textHash, requestId, request =>
      vscode.commands.executeCommand<unknown>("typescript.tsserverRequest", NATIVE_SEMANTIC_COMMAND,
        { ...request, file: document.uri }, { lowPriority: true }, cancellation), stale);
    if (stale() || bindings.get(snapshot.document) !== snapshot) return undefined;
    if (observe?.(native?.revision) === false || native === undefined) return undefined;
    const builder = new vscode.SemanticTokensBuilder(hsonSemanticLegend);
    let hsonIndex = 0;
    for (const token of native.tokens) {
      while (hsonIndex < hson.length && hson[hsonIndex]!.range.end <= token.start) hsonIndex++;
      if (hsonIndex < hson.length && hson[hsonIndex]!.range.start < token.end) continue;
      builder.push(new vscode.Range(token.line, token.character, token.line, token.character + token.length), token.type, token.modifiers);
    }
    for (const token of hson) builder.push(new vscode.Range(document.positionAt(token.range.start), document.positionAt(token.range.end)), token.type, [...token.modifiers]);
    return stale() ? undefined : builder.build();
  } catch {
    // Missing plugin/command, cancelled server work, or malformed responses must
    // not replace native highlighting with a partial document.
    return undefined;
  }
}

type NativeObservation = { version: number; order: number; revision?: string; attempted: boolean };

/** VS Code exposes the native range provider without a refresh event. Use its
 * diagnostic notifications as a wake-up, then check only visible documents
 * for which we have attempted to compose a native packet. */
export class NativeSemanticRefresh implements vscode.Disposable {
  private readonly states = new WeakMap<vscode.TextDocument, NativeObservation>();
  private readonly semanticChanges = new vscode.EventEmitter<void>();
  private readonly diagnostics = vscode.languages.onDidChangeDiagnostics(event => {
    if (event.uris.some(uri => uri.scheme === "file" && /\.(?:[cm]?[jt]s|[jt]sx)$/i.test(uri.path))) this.scheduleProbe();
  });
  readonly onDidChangeSemanticTokens = this.semanticChanges.event;
  private order = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private firing?: ReturnType<typeof setTimeout>;
  private probing = false;
  private probeAgain = false;
  private disposed = false;

  begin(document: vscode.TextDocument, version: number): (revision: string | undefined) => boolean {
    let state = this.states.get(document);
    if (state?.version !== version) {
      state = { version, order: 0, attempted: false };
      this.states.set(document, state);
    }
    const order = ++this.order;
    return revision => {
      if (this.disposed || document.isClosed || document.version !== version) return false;
      if (order < state.order) return revision !== undefined && revision === state.revision;
      if (revision === undefined) {
        state.attempted = true;
        return false;
      }
      const changed = state.attempted && state.revision !== revision;
      state.order = order;
      state.revision = revision;
      state.attempted = true;
      if (changed && vscode.window.visibleTextEditors.some(editor => editor.document === document)) {
        this.firing ??= setTimeout(() => {
          this.firing = undefined;
          this.semanticChanges.fire();
        }, 0);
      }
      return true;
    };
  }

  private scheduleProbe(): void {
    if (this.disposed || !vscode.workspace.isTrusted) return;
    if (this.probing) { this.probeAgain = true; return; }
    this.timer ??= setTimeout(() => { this.timer = undefined; void this.probeVisible(); }, 100);
  }

  private async probeVisible(): Promise<void> {
    this.probing = true;
    try {
      const visible = new Set(vscode.window.visibleTextEditors.map(editor => editor.document));
      const observations = await Promise.all([...visible].map(async document => {
        const version = document.version;
        if (this.states.get(document)?.version !== version) return;
        const observe = this.begin(document, version);
        try {
          const reply = await vscode.commands.executeCommand<unknown>("typescript.tsserverRequest", NATIVE_SEMANTIC_COMMAND,
            { file: document.uri, probe: true }, { lowPriority: true });
          if (isRecord(reply) && reply.type === "response" && reply.success === true && isRecord(reply.body)
            && reply.body.protocol === NATIVE_SEMANTIC_PROTOCOL && typeof reply.body.revision === "string" && reply.body.revision.length > 0) {
            return { observe, revision: reply.body.revision };
          }
        } catch { /* A diagnostic notification can arrive while the service restarts. */ }
      }));
      // The VS Code event has no document argument. Publish one batch when
      // several visible buffers report the same project change.
      for (const observation of observations) observation?.observe(observation.revision);
    } finally {
      this.probing = false;
      if (this.probeAgain) { this.probeAgain = false; this.scheduleProbe(); }
    }
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    clearTimeout(this.firing);
    this.diagnostics.dispose();
    this.semanticChanges.dispose();
  }
}
