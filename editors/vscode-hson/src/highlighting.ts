import * as messages from "./diagnostic-messages.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Registry, INITIAL, parseRawGrammar, type IGrammar } from "vscode-textmate";
import { loadWASM, OnigScanner, OnigString } from "vscode-oniguruma";
import { discover_hson_tagged_templates } from "../../../src/internal/embedded-hson/discover-hson-tagged-templates.js";
import type { HostSourceRange } from "../../../src/internal/embedded-hson/embedded-hson-source.js";
import { discover_static_from_hson_sources } from "../../../src/internal/embedded-hson/discover-static-from-hson-sources.js";
import { map_static_hson_range } from "../../../src/internal/embedded-hson/static-hson-source.js";
import { hsonTokenScopes } from "./appearance.js";

export { hsonTokenScopes } from "./appearance.js";
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
  if (!grammar) throw new Error(messages.missingPackagedGrammar);
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
    if (scope.startsWith("constant.other.quid.")) return "hsonQuid";
    if (scope.startsWith("constant.language.")) return "hsonKeyword";
    if (scope.startsWith("comment.")) return "hsonComment";
    if (scope.startsWith("punctuation.")) return "hsonDelimiter";
    if (scope.startsWith("keyword.")) return "hsonOperator";
  }
  return undefined;
}

export function hson_highlights(grammar: IGrammar, fileName: string, text: string): readonly HsonHighlight[] {
  const tags = discover_hson_tagged_templates(fileName, text);
  const calls = discover_static_from_hson_sources(fileName, text);
  const result: HsonHighlight[] = [];
  const noHoles: readonly HostSourceRange[] = [];
  const islands = [...tags.sources.map(source => ({ source, holes: noHoles })),
    ...tags.interpolated.map(source => ({ source, holes: source.substitutionRanges })),
    ...calls.interpolated.map(source => ({ source, holes: source.substitutionRanges }))];
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
  for (const source of calls.sources) {
    // Highlight only literals written directly inside the recognized call.
    // Static diagnostic discovery may trace a same-scope const to its earlier
    // declaration, but that declaration is not itself an explicit host region.
    if (source.literalRange.start < source.callRange.start || source.literalRange.end > source.callRange.end) continue;
    let runtimeOffset = 0;
    let stack = INITIAL;
    for (const line of source.runtimeText.split("\n")) {
      const tokens = grammar.tokenizeLine(line, stack);
      for (const token of tokens.tokens) {
        const type = tokenType(token.scopes);
        if (!type) continue;
        const runtimeRange = {
          start: runtimeOffset + token.startIndex,
          end: runtimeOffset + Math.min(token.endIndex, line.replace(/\r$/, "").length),
        };
        const range = map_static_hson_range(source, runtimeRange);
        if (range !== undefined && range.start < range.end) result.push({ range, type, scopes: token.scopes });
      }
      stack = tokens.ruleStack;
      runtimeOffset += line.length + 1;
    }
  }
  return result.sort((a, b) => a.range.start - b.range.start);
}
