import { INITIAL, type IGrammar } from "vscode-textmate";
import { HSON_APPEARANCE } from "./appearance.js";
import type { StructuralDocumentEvidence, StructuralRange } from "./structural-editing.js";

export type HsonDelimiterDepth = Readonly<{
  range: StructuralRange;
  depth: number;
  unexpected: boolean;
}>;

/** Source delimiters only; implicit parser member nodes never advance depth. */
export function hson_delimiter_depths(grammar: IGrammar, evidence: StructuralDocumentEvidence): readonly HsonDelimiterDepth[] {
  if (evidence.languageId === "markdown") return Object.freeze([]);
  const result: HsonDelimiterDepth[] = [];
  const scope = HSON_APPEARANCE.themeDerived;
  for (const region of evidence.regions) {
    const pieces: string[] = [];
    let cursor = region.bodyRange.start;
    for (const hole of region.protectedRanges) {
      pieces.push(evidence.text.slice(cursor, hole.start), evidence.text.slice(hole.start, hole.end).replace(/[^\r\n]/g, " "));
      cursor = hole.end;
    }
    pieces.push(evidence.text.slice(cursor, region.bodyRange.end));
    const body = pieces.join("");
    const stack: { close: string; index: number }[] = [];
    let state = INITIAL;
    let offset = region.bodyRange.start;
    // Preserve all physical newline kinds and keep quote state within this region.
    for (const line of body.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g) ?? []) {
      const content = line.replace(/[\r\n]+$/, "");
      const tokenized = grammar.tokenizeLine(content, state);
      state = tokenized.ruleStack;
      for (const token of tokenized.tokens) {
        if (token.startIndex >= content.length || token.scopes.some(name =>
          name.startsWith("string.") || name.startsWith("comment.") || name === scope.authoredName)) continue;
        const character = content[token.startIndex];
        const opening = character === "<" && token.scopes.includes(scope.tagBegin)
          || (character === "«" || character === "[") && token.scopes.includes(scope.arrayBegin);
        const closing = character === ">" && token.scopes.includes(scope.tagEnd)
          || (character === "»" || character === "]") && token.scopes.includes(scope.arrayEnd);
        if (!opening && !closing) continue;
        const range = Object.freeze({ start: offset + token.startIndex, end: offset + token.startIndex + 1 });
        if (opening) {
          stack.push({ close: character === "<" ? ">" : character === "«" ? "»" : "]", index: result.length });
          result.push({ range, depth: stack.length, unexpected: false });
        } else {
          const parent = stack.at(-1);
          const matches = parent?.close === character;
          result.push({ range, depth: stack.length, unexpected: !matches });
          if (matches) stack.pop();
        }
      }
      offset += line.length;
    }
    for (const unclosed of stack) result[unclosed.index] = { ...result[unclosed.index], unexpected: true };
  }
  return Object.freeze(result.map(delimiter => Object.freeze(delimiter)));
}

/** Evidence is retained by the existing bounded document/version cache. */
export class HsonDelimiterDepthCache {
  private readonly entries = new WeakMap<StructuralDocumentEvidence, readonly HsonDelimiterDepth[]>();
  get(grammar: IGrammar, evidence: StructuralDocumentEvidence): readonly HsonDelimiterDepth[] {
    const cached = this.entries.get(evidence);
    if (cached !== undefined) return cached;
    const delimiters = hson_delimiter_depths(grammar, evidence);
    this.entries.set(evidence, delimiters);
    return delimiters;
  }
}

// Native defaults leave slots 4–6 transparent. Use the three visible standard
// slots rather than making delimiters disappear or resolving theme files ourselves.
export const HSON_DEPTH_COLOR_IDS = Object.freeze([
  "editorBracketHighlight.foreground1",
  "editorBracketHighlight.foreground2",
  "editorBracketHighlight.foreground3",
  "editorBracketHighlight.unexpectedBracket.foreground",
]);

/** Small theme-referenced decoration set, shared by the adapter and lifecycle tests. */
export class HsonDepthDecorationSet<Decoration extends { dispose(): void }> {
  private decorations: Decoration[] = [];
  constructor(private readonly create: (colorId: string) => Decoration) { this.refresh(); }

  refresh(): void {
    this.dispose();
    this.decorations = HSON_DEPTH_COLOR_IDS.map(this.create);
  }

  apply(set: (decoration: Decoration, ranges: readonly StructuralRange[]) => void,
    delimiters: readonly HsonDelimiterDepth[], enabled: boolean): void {
    const ranges: StructuralRange[][] = HSON_DEPTH_COLOR_IDS.map(() => []);
    if (enabled) for (const delimiter of delimiters) {
      ranges[delimiter.unexpected ? 3 : (delimiter.depth - 1) % 3].push(delimiter.range);
    }
    this.decorations.forEach((decoration, index) => set(decoration, ranges[index]));
  }

  dispose(): void {
    for (const decoration of this.decorations) decoration.dispose();
    this.decorations = [];
  }
}
