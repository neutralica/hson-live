import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import type { Family, Mode } from './appearance-model.js';

export const scratchpadExamples = {
  Document: { family: 'document', language: 'hson', label: 'Hson Document', content: '// Editable Document scratchpad — paste your own Hson here.\n<section hson:part data:message=%{message} title="Attribute text" class="example"\n  <h1 @:title "Content text"/>\n  <p title=^{message} "Hello"/>\n/>\n' },
  Data: { family: 'data', language: 'hson', label: 'Hson Data', content: '// Editable Data scratchpad — paste your own Hson here.\n<catalog <\n  title "Data content"\n  tags ["alpha", "beta"]\n  count 42\n  enabled true\n>>\n' },
  Interpolation: { family: 'all', language: 'typescript', label: 'TS + Hson', content: 'import { Hson } from "hson-live/hson";\nconst hostValue = "Native TypeScript";\nconst document = Hson.document`\n<section title="Attribute text"\n  <p "Content text ${hostValue.toUpperCase()}"/>\n/>`;\nconst data = Hson.data`\n<catalog <\n  true "Data text"\n  false 1\n  null null\n>>`;\n' },
} satisfies Record<string, {family: Family; language: string; label: string; content: string}>;
export type ScratchpadExample = keyof typeof scratchpadExamples;
export type ScratchpadContext = Readonly<{ target: string; mode: Mode; family: Family }>;
type Scratchpad = {target:string;mode:Mode;family:Family} & { example: ScratchpadExample; uri: string; text: string };
type Checkpoint = {accepted: number; history: {before: string; after: string; reset: boolean; version: number}[]; error?: string};
const storageKey = 'hson.appearance.scratchpads.v1';

function isScratchpad(value: unknown): value is Scratchpad {
  if (!value || typeof value !== 'object') return false;
  return 'example' in value && (value.example === 'Document' || value.example === 'Data' || value.example === 'Interpolation')
    && 'family' in value && value.family === scratchpadExamples[value.example].family
    && 'mode' in value && (value.mode === 'dark' || value.mode === 'light')
    && 'target' in value && typeof value.target === 'string' && /^(palette:[\w-]+|override:(all|data|document))$/.test(value.target)
    && 'uri' in value && typeof value.uri === 'string' && value.uri.startsWith('untitled:')
    && 'text' in value && typeof value.text === 'string';
}

/** Native untitled editors own editing/undo. Workspace Memento owns source and
 * its declared context across close/reopen and extension-host lifetimes. */
export class AppearanceScratchpads implements vscode.Disposable {
  private readonly records: Scratchpad[];
  private readonly subscriptions: vscode.Disposable[];
  private move?: {target: string; destination: string; failed: boolean};
  private pending: Promise<void> = Promise.resolve();
  private readonly changesEmitter = new vscode.EventEmitter<void>();
  private writeError = '';
  private recovering?: Promise<void>;
  private disposed = false;
  private readonly acknowledgements = new Set<Promise<void>>();
  // Only these unacknowledged observations may contain native teardown values.
  // records always contains accepted authored source, including intentional ''.
  private readonly changes = new Map<vscode.TextDocument, Checkpoint>();
  private readonly initializing = new Set<string>();
  constructor(private readonly storage: vscode.Memento) {
    const stored: unknown = storage.get(storageKey);
    // Never mutate Memento's cached value before an acknowledged update.
    this.records = Array.isArray(stored) ? stored.filter(isScratchpad).map(record => ({...record})) : [];
    this.subscriptions = [vscode.workspace.onDidChangeTextDocument(event => {
      if (event.contentChanges.length) this.observe(event.document, event);
    }), vscode.workspace.onDidOpenTextDocument(document => this.observe(document)),
      vscode.workspace.onDidCloseTextDocument(document => {
        // Language changes emit didClose without disposing the native document.
        if (!document.isClosed) return;
        const history = this.changes.get(document)?.history;
        this.changes.delete(document);
        const last = history?.at(-1);
        const record = this.records.find(record => record.uri === document.uri.toString());
        if (!record || !last) return;
        const prior = history?.at(-2);
        // Native disposal resets EOL and then flushes the model to empty in one
        // main-thread transaction. Neither observation is authored source.
        const source = last.reset
          ? prior && prior.after === last.before && prior.before.includes('\r\n')
            && prior.before.replace(/\r\n/g, '\n') === prior.after ? prior.before : last.before
          : last.after;
        this.accept(record, source);
      })];
    for (const document of vscode.workspace.textDocuments) this.observe(document);
  }
  context(document: vscode.TextDocument): ScratchpadContext | undefined {
    return this.records.find(record => record.uri === document.uri.toString());
  }
  has(example: ScratchpadExample, target: string, mode: Mode): boolean {
    return this.records.some(record => record.example === example && record.target === target && record.mode === mode);
  }
  targets(): readonly string[] {
    return [...new Set([...this.records.map(record => record.target),
      ...(this.move ? [this.move.target, this.move.destination] : [])])];
  }
  get onDidChange(): vscode.Event<void> { return this.changesEmitter.event; }
  get error(): string {
    return [this.writeError, ...[...this.changes.values()].map(change => change.error),
      this.move?.failed ? 'Scratchpad ownership recovery is pending. Both palettes are protected; use Retry Scratchpad Save before moving again.' : ''].filter(Boolean).join('\n');
  }
  private report(error: unknown): void {
    if (this.disposed) return;
    this.changesEmitter.fire();
    void Promise.resolve(vscode.window.showErrorMessage(`Hson scratchpad could not be retained: ${String(error)}`, 'Retry'))
      .then(choice => { if (choice === 'Retry' && !this.disposed) void this.recover().catch(() => {}); }).catch(() => {});
  }
  private observe(document: vscode.TextDocument, event?: vscode.TextDocumentChangeEvent): void {
    const uri = document.uri.toString();
    if (document.isClosed || this.initializing.has(uri)) return;
    const record = this.records.find(record => record.uri === uri);
    if (!record) return;
    // Restored native tabs may initially expose an empty model, even without a
    // hot-exit backup. VS Code's initial model version is 1; a higher version
    // proves an existing edited model (including an intentional clear surviving
    // host restart). A never-edited placeholder is not an authored empty value.
    if (!event && document.version === 1 && document.getText() === '' && record.text !== '') return;
    let checkpoint = this.changes.get(document);
    if (!checkpoint) {
      checkpoint = {accepted: -1, history: []};
      this.changes.set(document, checkpoint);
    }
    const before = checkpoint.history.at(-1)?.after ?? record.text, after = document.getText();
    if (!event && before === after) return;
    const change = event?.contentChanges[0], version = document.version;
    checkpoint.history.push({before, after, version, reset: !!event && event.reason === undefined
      && event.contentChanges.length === 1 && change?.rangeOffset === 0
      && change.rangeLength === before.length && change.text === ''});
    checkpoint.history = checkpoint.history.slice(-2);
    this.acknowledge(document, checkpoint, version, after);
  }
  private acknowledge(document: vscode.TextDocument, checkpoint: Checkpoint, version: number, after: string): void {
    // The main-thread round trip follows the native transaction, including its
    // disposal notifications. No timer, dirty flag, or empty-text heuristic is
    // used to accept a live edit. Older acknowledgements cannot replace newer ones.
    const acknowledgement = Promise.resolve().then(() => vscode.commands.getCommands(true)).then(() => {
      if (document.isClosed || this.changes.get(document) !== checkpoint || version <= checkpoint.accepted) return;
      checkpoint.accepted = version;
      const failed = checkpoint.error;
      checkpoint.error = undefined;
      if (failed && !this.disposed) this.changesEmitter.fire();
      checkpoint.history = checkpoint.history.filter(change => change.version > version);
      const record = this.records.find(record => record.uri === document.uri.toString());
      if (record) this.accept(record, after);
    }).catch(error => {
      if (document.isClosed || this.changes.get(document) !== checkpoint || version <= checkpoint.accepted) return;
      checkpoint.error = `Scratchpad edit acknowledgement failed: ${String(error)}`;
      this.report(checkpoint.error);
    }).finally(() => this.acknowledgements.delete(acknowledgement));
    this.acknowledgements.add(acknowledgement);
  }
  private accept(record: Scratchpad, text: string): void {
    if (record.text === text) return;
    record.text = text;
    void this.persist().catch(() => {});
  }
  private persist(ownership?: {records: readonly Scratchpad[]; target: string}): Promise<void> {
    this.pending = this.pending.catch(() => {}).then(async () => {
      // Build at execution time: queued edits must not resurrect an old owner or
      // source after a move/rollback. One Memento value is the atomic boundary.
      const snapshot = this.records.map(record => ({...record,
        target: ownership?.records.includes(record) ? ownership.target : record.target}));
      await this.storage.update(storageKey, snapshot);
      if (ownership) for (const record of ownership.records) record.target = ownership.target;
      const failed = this.writeError;
      this.writeError = '';
      if (failed && !this.disposed) this.changesEmitter.fire();
    }).catch(error => {
      this.writeError = `Scratchpad save failed: ${String(error)}`;
      this.report(error);
      throw error;
    });
    return this.pending;
  }
  references(target: string): readonly string[] {
    return [...this.records.filter(record => record.target === target).map(record => `${record.example} ${record.mode}`),
      ...(this.move && [this.move.target, this.move.destination].includes(target)
        ? [this.move.failed ? 'scratchpad ownership recovery pending' : 'scratchpad move in progress'] : [])];
  }
  /** Retry the current accepted source/owner, never a captured rollback snapshot. */
  recover(): Promise<void> {
    return this.recovering ?? (this.recovering = this.reconcile().finally(() => { this.recovering = undefined; }));
  }
  private async reconcile(): Promise<void> {
    if (this.move && !this.move.failed) throw new Error('A scratchpad move is already in progress.');
    for (const [document, checkpoint] of this.changes) {
      const last = checkpoint.history.at(-1);
      if (checkpoint.error && last) this.acknowledge(document, checkpoint, last.version, last.after);
    }
    await this.settleAcknowledgements();
    await this.persist();
    await this.flush();
    this.move = undefined;
    if (!this.disposed) this.changesEmitter.fire();
  }
  async reassign(target: string, destination: string): Promise<void> {
    // Do not await recovery before reserving a new destination: it could be
    // deleted during that wait. Retry is explicit, then the controller rechecks
    // the saved destination and these guards are installed synchronously.
    if (this.recovering || this.move?.failed || this.writeError) throw new Error('Use Retry Scratchpad Save before moving scratchpads.');
    if (this.move) throw new Error('A scratchpad move is already in progress.');
    const records = this.records.filter(record => record.target === target);
    if (records.some(record => this.records.some(other => other.target === destination
      && other.example === record.example && other.mode === record.mode))) throw new Error('Destination already has matching scratchpads. Choose another palette.');
    const move: {target: string; destination: string; failed: boolean} = {target, destination, failed: false};
    this.move = move;
    try {
      await this.settleAcknowledgements();
      await this.persist({records, target: destination});
      await this.flush();
      this.move = undefined;
    } catch (error) {
      move.failed = true;
      // A rejected acknowledgement may still have written. Reconcile the current
      // accepted owner and newest source; hold both palettes if that also fails.
      try { await this.recover(); }
      catch (recoveryError) { throw new Error(`Scratchpad move recovery is pending; both palettes remain protected. ${String(recoveryError)}`); }
      if (records.every(record => record.target === destination)) return;
      throw error;
    }
  }
  async open(example: ScratchpadExample, target: string, mode: Mode, label: string): Promise<vscode.TextEditor> {
    const definition = scratchpadExamples[example];
    let record = this.records.find(record => record.example === example && record.target === target && record.mode === mode);
    if (!record) {
      if (this.move && [this.move.target, this.move.destination].includes(target)) throw new Error('Finish scratchpad ownership recovery before creating another buffer.');
      const suffix = definition.language === 'typescript' ? 'ts' : 'hson';
      record = {example, target, mode, family: definition.family, text: definition.content,
        uri: vscode.Uri.from({scheme:'untitled',path:`${definition.label} ${mode === 'dark' ? 'Dark' : 'Light'} - ${label} - ${randomUUID().slice(0,8)}.${suffix}`}).toString()};
      this.records.push(record);
      await this.persist();
    }
    let document = vscode.workspace.textDocuments.find(document => !document.isClosed && document.uri.toString() === record.uri);
    if (!document || (!this.changes.has(document) && document.getText() === '' && record.text !== '')) {
      this.initializing.add(record.uri);
      try {
        document ??= await vscode.workspace.openTextDocument(vscode.Uri.parse(record.uri));
        // Existing authored emptiness is authoritative. Unobserved startup
        // placeholders recover the retained source, using ordinary native edits.
        if (document.getText() === '' && record.text !== '') {
          const eol=record.text.includes('\r\n')?vscode.EndOfLine.CRLF:vscode.EndOfLine.LF;
          if(document.eol!==eol){
            const edit=new vscode.WorkspaceEdit();edit.set(document.uri,[vscode.TextEdit.setEndOfLine(eol)]);
            if(!await vscode.workspace.applyEdit(edit))throw new Error('Could not restore scratchpad line endings');
          }
          const edit = new vscode.WorkspaceEdit(); edit.insert(document.uri, new vscode.Position(0,0), record.text);
          if (!await vscode.workspace.applyEdit(edit)) throw new Error('Could not restore scratchpad');
        }
        if (document.languageId !== definition.language) document = await vscode.languages.setTextDocumentLanguage(document, definition.language);
      } finally { this.initializing.delete(record.uri); }
      this.observe(document);
    }
    return vscode.window.showTextDocument(document, {viewColumn:vscode.ViewColumn.Two,preview:false,preserveFocus:true});
  }
  async restoreExample(example: ScratchpadExample, target: string, mode: Mode, label: string): Promise<void> {
    const editor = await this.open(example, target, mode, label);
    const document = editor.document;
    if (!await editor.edit(edit => edit.replace(new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), scratchpadExamples[example].content))) {
      throw new Error('Could not restore scratchpad example');
    }
    await this.flush();
  }
  private async settleAcknowledgements(): Promise<void> {
    while (this.acknowledgements.size) await Promise.all([...this.acknowledgements]);
    const failed = [...this.changes.values()].find(checkpoint => checkpoint.error);
    if (failed) throw new Error(failed.error);
  }
  async flush(): Promise<void> {
    for (;;) {
      await this.settleAcknowledgements();
      const pending = this.pending;
      try { await pending; }
      catch (error) { if (pending === this.pending) throw error; }
      if (pending === this.pending && !this.acknowledgements.size) return;
    }
  }
  dispose(): void { this.disposed = true; for (const subscription of this.subscriptions) subscription.dispose(); this.changesEmitter.dispose(); }

}
