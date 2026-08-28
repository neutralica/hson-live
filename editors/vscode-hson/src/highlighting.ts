import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Registry, INITIAL, parseRawGrammar, type IGrammar } from "vscode-textmate";
import { loadWASM, OnigScanner, OnigString } from "vscode-oniguruma";
import { discover_hson_tagged_templates } from "../../../src/internal/embedded-hson/discover-hson-tagged-templates.js";
import type { HostSourceRange } from "../../../src/internal/embedded-hson/embedded-hson-source.js";

// Scope-to-theme transport only. The existing TextMate grammar remains the
// coloring authority; TypeScript binding discovery alone selects the islands.
export const hsonTokenScopes = {
  hsonType: ["entity.name.type.hson"],
  hsonProperty: ["entity.other.attribute-name.hson"],
  hsonString: ["string.quoted.double.hson", "string.unquoted.attribute-value.hson"],
  hsonNumber: ["constant.numeric.hson"],
  hsonKeyword: ["constant.language.boolean.hson", "constant.language.null.hson"],
  hsonComment: ["comment.line.double-slash.hson"],
  hsonOperator: ["punctuation.definition.tag.begin.hson", "keyword.operator.assignment.hson"],
  hsonEscape: ["constant.character.escape.hson"],
  hsonInvalid: ["invalid.illegal.hson"],
} as const;
export type HsonHighlight = Readonly<{ range: HostSourceRange; type: keyof typeof hsonTokenScopes; scopes: readonly string[] }>;

let wasm: Promise<void> | undefined;
export async function load_hson_grammar(extensionRoot: string): Promise<IGrammar> {
  wasm ??= readFile(join(extensionRoot, "dist/onig.wasm")).then(bytes => loadWASM(bytes));
  await wasm;
  const registry = new Registry({
    onigLib: Promise.resolve({ createOnigScanner: patterns => new OnigScanner(patterns), createOnigString: text => new OnigString(text) }),
    loadGrammar: async scope => scope === "source.hson"
      ? parseRawGrammar(await readFile(join(extensionRoot, "syntaxes/hson.tmLanguage.json"), "utf8"), "hson.json") : null,
  });
  const grammar = await registry.loadGrammar("source.hson");
  if (!grammar) throw new Error("Missing packaged HSON grammar");
  return grammar;
}

function tokenType(scopes: readonly string[]): HsonHighlight["type"] | undefined {
  for (const scope of [...scopes].reverse()) {
    if (scope.startsWith("invalid.")) return "hsonInvalid";
    if (scope.startsWith("constant.character.escape.")) return "hsonEscape";
    if (scope.startsWith("entity.name.type.")) return "hsonType";
    if (scope.startsWith("entity.other.attribute-name.")) return "hsonProperty";
    if (scope.startsWith("string.")) return "hsonString";
    if (scope.startsWith("constant.numeric.")) return "hsonNumber";
    if (scope.startsWith("constant.language.") || scope.startsWith("constant.other.")) return "hsonKeyword";
    if (scope.startsWith("comment.")) return "hsonComment";
    if (scope.startsWith("punctuation.") || scope.startsWith("keyword.")) return "hsonOperator";
  }
  return undefined;
}

export function hson_highlights(grammar: IGrammar, fileName: string, text: string): readonly HsonHighlight[] {
  const discovery = discover_hson_tagged_templates(fileName, text);
  const result: HsonHighlight[] = [];
  const noHoles: readonly HostSourceRange[] = [];
  const islands = [...discovery.sources.map(source => ({ source, holes: noHoles })),
    ...discovery.interpolated.map(source => ({ source, holes: source.substitutionRanges }))];
  for (const { source, holes } of islands) {
    // Omit expressions from grammar input and output, retaining offsets and
    // physical newlines. This is coloring only, never a parse/admission candidate.
    let body = "", offset = source.bodyRange.start;
    for (const hole of holes) {
      body += text.slice(offset, hole.start) + text.slice(hole.start, hole.end).replace(/[^\r\n]/g, " ");
      offset = hole.end;
    }
    body += text.slice(offset, source.bodyRange.end);
    offset = source.bodyRange.start;
    let stack = INITIAL;
    for (const line of body.split("\n")) {
      const tokens = grammar.tokenizeLine(line, stack);
      for (const token of tokens.tokens) {
        const type = tokenType(token.scopes);
        if (!type) continue;
        let start = offset + token.startIndex;
        const end = offset + Math.min(token.endIndex, line.replace(/\r$/, "").length);
        // A grammar token may span a masked hole; publish only literal pieces.
        for (const hole of holes) {
          if (hole.end <= start || hole.start >= end) continue;
          if (start < hole.start) result.push({ range: { start, end: hole.start }, type, scopes: token.scopes });
          start = Math.max(start, hole.end);
        }
        if (start < end) result.push({ range: { start, end }, type, scopes: token.scopes });
      }
      stack = tokens.ruleStack;
      offset += line.length + 1;
    }
  }
  return result.sort((a, b) => a.range.start - b.range.start);
}
