import * as vscode from "vscode";
import ts from "typescript";
import type { GeneratedDelimiters, StructuralIndentation, StructuralInputPlan } from "./structural-editing.js";

function atEachCursor(values: readonly string[]): string {
  if (values.every(value => value === "")) return "";
  // Resolve text as a variable so the snippet engine keeps indentation exact.
  // An empty final tabstop lets VS Code store each resulting selection in redo.
  const groups = new Map<string, number[]>();
  values.forEach((value, index) => {
    const group = groups.get(value);
    if (group === undefined) groups.set(value, [index]);
    else group.push(index);
  });
  const pattern = [...groups.values()].map(indices => "(" + indices.join("|") + ")").join("|");
  const replacement = [...groups.keys()].map((value, index) =>
    value === "" ? "" : "${" + (index + 1) + ":+" + value.replace(/[\\$}]/g, "\\$&") + "}").join("");
  return "${CURSOR_INDEX/^(?:" + pattern + ")$/" + replacement + "/}";
}

export function structuralInputSnippet(plans: readonly StructuralInputPlan[]): vscode.SnippetString {
  return new vscode.SnippetString(atEachCursor(plans.map(plan => plan.beforeCursor)) + "$0"
    + atEachCursor(plans.map(plan => plan.afterCursor)));
}

type OwnedInput = GeneratedDelimiters & Readonly<{ open: number; close: number }>;
type ContentChange = Readonly<{ rangeOffset: number; rangeLength: number; text: string }>;

function translate(start: number, length: number, changes: readonly ContentChange[]): number | undefined {
  let shift = 0;
  for (const change of changes) {
    if (change.rangeOffset >= start + length) break;
    if (change.rangeOffset + change.rangeLength > start) return undefined;
    shift += change.text.length - change.rangeLength;
  }
  return start + shift;
}

type InputChange = ContentChange & Readonly<{
  removed: string;
  beforeCursorLength: number;
  generated: GeneratedDelimiters | undefined;
}>;

type HistoryEntry = Readonly<{
  forward: readonly ContentChange[];
  backward: readonly ContentChange[];
  before: readonly OwnedInput[];
  after: readonly OwnedInput[];
}>;

type PendingInput = Readonly<{
  token: symbol;
  version: number;
  changes: readonly InputChange[];
  entry?: HistoryEntry;
}>;

function sameChanges(expected: readonly ContentChange[], actual: readonly ContentChange[]): boolean {
  return expected.length === actual.length && expected.every((change, index) => {
    const other = actual[index];
    return change.rangeOffset === other.rangeOffset && change.rangeLength === other.rangeLength && change.text === other.text;
  });
}

/** Only acknowledged snippets with their own undo stops enter the history.
 * Native edit groups have no public transaction ID. An unknown transition
 * breaks the tracked history, but ranges untouched by it can still move. */
export class StructuralInputOwnership {
  private owned: readonly OwnedInput[] = [];
  private readonly undo: HistoryEntry[] = [];
  private readonly redo: HistoryEntry[] = [];
  private pending?: PendingInput;

  public constructor(private version: number) {}

  private clearHistory(): void {
    this.undo.length = 0;
    this.redo.length = 0;
  }

  public prepare(version: number, source: string, plans: readonly StructuralInputPlan[]): symbol {
    if (version !== this.version) {
      this.version = version;
      this.owned = [];
      this.clearHistory();
    }
    if (this.pending !== undefined) this.clearHistory();
    const token = Symbol();
    this.pending = { token, version, changes: plans.map(plan => ({
      rangeOffset: plan.start,
      rangeLength: plan.end - plan.start,
      text: plan.beforeCursor + plan.afterCursor,
      removed: source.slice(plan.start, plan.end),
      beforeCursorLength: plan.beforeCursor.length,
      generated: plan.generated,
    })) };
    return token;
  }

  public finish(token: symbol, applied: boolean): void {
    if (this.pending?.token !== token) return;
    const { entry } = this.pending;
    this.pending = undefined;
    if (!applied || entry === undefined) {
      if (applied || entry !== undefined) this.clearHistory();
      return;
    }
    this.owned = entry.after;
    this.redo.length = 0;
    this.undo.push(entry);
    if (this.undo.length > 64) this.undo.shift();
  }

  private restore(reason: vscode.TextDocumentChangeReason, changes: readonly ContentChange[]): boolean {
    const isUndo = reason === vscode.TextDocumentChangeReason.Undo;
    const stack = isUndo ? this.undo : this.redo;
    const entry = stack.at(-1);
    if (entry === undefined || !sameChanges(isUndo ? entry.backward : entry.forward, changes)) return false;
    stack.pop();
    (isUndo ? this.redo : this.undo).push(entry);
    this.owned = isUndo ? entry.before : entry.after;
    return true;
  }

  public update(event: vscode.TextDocumentChangeEvent): void {
    const version = event.document.version;
    if (event.contentChanges.length === 0 && version === this.version) return;
    const pending = this.pending;
    this.pending = undefined;
    const consecutive = version === this.version + 1;
    this.version = version;
    if (!consecutive || event.contentChanges.length === 0) {
      this.owned = [];
      this.clearHistory();
      return;
    }

    const changes = [...event.contentChanges].sort((left, right) => left.rangeOffset - right.rangeOffset);
    if (event.reason !== undefined && pending === undefined && this.restore(event.reason, changes)) return;
    const before = this.owned;
    const translated = before.flatMap(pair => {
      const open = translate(pair.open, pair.opener.length, changes);
      const close = pair.closer === "" && open !== undefined
        ? open + pair.opener.length : translate(pair.close, pair.closer.length, changes);
      return open === undefined || close === undefined ? [] : [{ ...pair, open, close }];
    });
    this.owned = translated;

    if (event.reason === undefined && pending?.version === version - 1) {
      // VS Code can omit replacements that leave the original spelling in place.
      const planned = sameChanges(pending.changes, changes) ? pending.changes
        : pending.changes.filter(change => change.removed !== change.text);
      if (sameChanges(planned, changes)) {
        let shift = 0;
        const after = [...translated];
        const backward = planned.map(change => {
          const start = change.rangeOffset + shift;
          const generated = change.generated;
          if (generated !== undefined && change.removed !== change.text) {
            const close = start + change.beforeCursorLength;
            after.push({ ...generated, open: close - generated.opener.length, close });
          }
          shift += change.text.length - change.rangeLength;
          return { rangeOffset: start, rangeLength: change.text.length, text: change.removed };
        });
        this.pending = { ...pending, entry: { forward: changes, backward, before, after } };
        return;
      }
    }
    this.clearHistory();
  }

  public at(cursor: number): OwnedInput | undefined {
    return this.owned.find(pair => pair.close === cursor && pair.open + pair.opener.length === cursor);
  }

  public atCloser(cursor: number): OwnedInput | undefined {
    return this.owned.find(pair => pair.close === cursor && pair.closer !== "");
  }
}

/** A VS Code snippet has no native auto-pair command for individual cursors.
 * Compose only the host gestures with a known result. All other mixed gestures
 * are delegated together so their language rules and editor settings still run. */
export function mixedHostInput(
  editor: vscode.TextEditor,
  cursor: number,
  typed: string,
  indentation: StructuralIndentation,
  hostSource?: ts.SourceFile,
): StructuralInputPlan | undefined {
  const { document } = editor;
  if (document.languageId !== "typescript" && document.languageId !== "javascript") return undefined;
  const settings = vscode.workspace.getConfiguration("editor", document);
  const position = document.positionAt(cursor);
  const line = document.lineAt(position.line).text;
  const right = line.slice(position.character);
  if (typed === "[" && /^(?:[ \t;]|$)/.test(right)) {
    const setting = settings.get<string>("autoClosingBrackets", "languageDefined");
    const closer = setting === "never" || setting === "beforeWhitespace" && right.startsWith(";") ? "" : "]";
    return { start: cursor, end: cursor, beforeCursor: "[", afterCursor: closer,
      generated: { opener: "[", closer, host: true } };
  }
  if (typed !== "\n" || hostSource === undefined || line[position.character - 1] !== "{" || !right.startsWith("}")) return undefined;
  const autoIndent = settings.get<string>("autoIndent", "full");
  if (autoIndent !== "full" && autoIndent !== "advanced") return undefined;
  function isEmptyBracePair(node: ts.Node): boolean {
    if (node.pos > cursor - 1 || node.end < cursor + 1) return false;
    if ((ts.isBlock(node) || ts.isObjectLiteralExpression(node)) && node.end === cursor + 1
      && node.getStart(hostSource) === cursor - 1) return true;
    return node.forEachChild(isEmptyBracePair) === true;
  }
  if (!isEmptyBracePair(hostSource)) return undefined;
  const leading = /^[ \t]*/.exec(line)?.[0] ?? "";
  if (indentation.insertSpaces ? leading.includes("\t") : leading.includes(" ")) return undefined;
  const unit = indentation.insertSpaces ? " ".repeat(indentation.tabSize) : "\t";
  const newline = document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
  return { start: cursor, end: cursor, beforeCursor: newline + leading + unit, afterCursor: newline + leading };
}
