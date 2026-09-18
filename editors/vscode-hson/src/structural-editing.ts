import { OBJ_TAG } from "../../../src/core/constants.js";
import { parse_hson } from "../../../src/api/transform/parsers/parse-hson.js";
import { tokenize_hson } from "../../../src/api/transform/parsers/tokenize-hson.js";
import type { Tokens } from "../../../src/api/transform/token.types.js";
import { discover_hson_tagged_templates } from "../../../src/internal/embedded-hson/discover-hson-tagged-templates.js";
import { markdown_hson_fence_regions } from "./markdown-fence-marker.js";

export type StructuralHostLanguage = "typescript" | "typescriptreact" | "markdown";
export type StructuralRange = Readonly<{ start: number; end: number }>;
export type StructuralRegion = Readonly<{
  kind: "template" | "markdown-fence";
  bodyRange: StructuralRange;
  protectedRanges: readonly StructuralRange[];
  baseIndentation: string;
  bodyStartsAtLineStart: boolean;
}>;
export type StructuralEdit = Readonly<{ start: number; end: number; text: string }>;
export type StructuralIndentation = Readonly<{ insertSpaces: boolean; tabSize: number }>;
export type StructuralNewlinePlan = Readonly<{ beforeCursor: string; afterCursor: string }>;

type StructuralPair = Readonly<{ open: number; close: number; openLine: number; closeLine: number }>;

function lineStart(text: string, offset: number): number {
  return text.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
}

function leadingWhitespaceAt(text: string, offset: number): string {
  const start = lineStart(text, offset);
  const prefix = text.slice(start, offset);
  return /^[ \t]*$/.test(prefix) ? prefix : "";
}

export function structural_regions(
  fileName: string,
  languageId: StructuralHostLanguage,
  text: string,
): readonly StructuralRegion[] {
  if (languageId === "markdown") return markdown_hson_fence_regions(text).map(region => Object.freeze({
    kind: "markdown-fence" as const,
    bodyRange: region.bodyRange,
    protectedRanges: Object.freeze([]),
    baseIndentation: region.indentation,
    bodyStartsAtLineStart: true,
  }));

  const discovery = discover_hson_tagged_templates(fileName, text);
  const regions: StructuralRegion[] = [];
  for (const source of discovery.sources) regions.push(Object.freeze({
    kind: "template",
    bodyRange: source.bodyRange,
    protectedRanges: Object.freeze([]),
    baseIndentation: leadingWhitespaceAt(text, source.bodyRange.end),
    bodyStartsAtLineStart: source.bodyRange.start === lineStart(text, source.bodyRange.start),
  }));
  for (const source of discovery.interpolated) regions.push(Object.freeze({
    kind: "template",
    bodyRange: source.bodyRange,
    protectedRanges: source.substitutionRanges,
    baseIndentation: leadingWhitespaceAt(text, source.bodyRange.end),
    bodyStartsAtLineStart: source.bodyRange.start === lineStart(text, source.bodyRange.start),
  }));
  return Object.freeze(regions.sort((left, right) => left.bodyRange.start - right.bodyRange.start));
}

export function structural_region_at(
  fileName: string,
  languageId: StructuralHostLanguage,
  text: string,
  offset: number,
): StructuralRegion | undefined {
  return structural_regions(fileName, languageId, text).find(region =>
    offset >= region.bodyRange.start && offset <= region.bodyRange.end
    && !region.protectedRanges.some(range => offset > range.start && offset < range.end));
}

function maskProtectedSource(text: string, region: StructuralRegion): string | undefined {
  let body = text.slice(region.bodyRange.start, region.bodyRange.end);
  for (const range of [...region.protectedRanges].reverse()) {
    const start = range.start - region.bodyRange.start;
    const end = range.end - region.bodyRange.start;
    const original = body.slice(start, end);
    if (original.includes("\n") || original.includes("\r") || original.length < 3) return undefined;
    const replacement = '"x"'.padEnd(original.length, " ");
    body = body.slice(0, start) + replacement + body.slice(end);
  }
  return body;
}

function parses(source: string): boolean {
  try { parse_hson(source); return true; } catch { return false; }
}

/** Parser-probed closer selection. Exactly one valid structural mode must win. */
export function structural_closer_for_less_than(
  fileName: string,
  languageId: StructuralHostLanguage,
  textAfterLessThan: string,
  cursorAfterLessThan: number,
): ">" | "/>" | undefined {
  const region = structural_region_at(fileName, languageId, textAfterLessThan, cursorAfterLessThan);
  if (region === undefined || textAfterLessThan[cursorAfterLessThan - 1] !== "<") return undefined;
  const body = maskProtectedSource(textAfterLessThan, region);
  if (body === undefined) return undefined;
  const local = cursorAfterLessThan - region.bodyRange.start;
  if (body.startsWith("/>", local) && parses(body.slice(0, local) + "hson_probe" + body.slice(local))) return undefined;
  if (body[local] === ">" && parses(body)) return undefined;
  const objectCandidate = body.slice(0, local) + ">" + body.slice(local);
  const documentCandidate = body.slice(0, local) + "hson_probe/>" + body.slice(local);
  const object = parses(objectCandidate);
  const document = parses(documentCandidate);
  return object === document ? undefined : object ? ">" : "/>";
}

function lineOf(source: string, offset: number): number {
  let line = 0;
  for (let index = 0; index < offset; index += 1) if (source.charCodeAt(index) === 10) line += 1;
  return line;
}

function structuralPairs(tokens: readonly Tokens[]): readonly StructuralPair[] {
  const stack: Array<Readonly<{ token: Tokens; index: number }>> = [];
  const pairs: StructuralPair[] = [];
  for (const token of tokens) {
    if (token.kind === "EMPTY_OBJ" && token.pos !== undefined) {
      pairs.push(Object.freeze({
        open: token.pos.index,
        close: token.pos.index + 1,
        openLine: token.pos.line - 1,
        closeLine: token.pos.line - 1,
      }));
      continue;
    }
    if ((token.kind === "OPEN" || token.kind === "ARR_OPEN") && token.pos !== undefined) {
      stack.push({ token, index: token.pos.index });
      continue;
    }
    if (token.kind !== "CLOSE" && token.kind !== "ARR_CLOSE") continue;
    const open = stack.pop();
    if (open === undefined || token.pos === undefined) continue;
    const structural = token.kind === "ARR_CLOSE"
      ? open.token.kind === "ARR_OPEN"
      : open.token.kind === "OPEN" && (token.close === "elem" || open.token.tag === OBJ_TAG);
    if (structural) pairs.push(Object.freeze({
      open: open.index,
      close: token.pos.index,
      openLine: open.token.pos!.line - 1,
      closeLine: token.pos.line - 1,
    }));
  }
  return Object.freeze(pairs);
}

function analyzedPairs(source: string): readonly StructuralPair[] | undefined {
  try {
    parse_hson(source);
    return structuralPairs(tokenize_hson(source));
  } catch {
    return undefined;
  }
}

function insideNonStructuralSyntax(source: string, offset: number): boolean {
  const literals: StructuralRange[] = [];
  const attributeValues: StructuralRange[] = [];
  try {
    tokenize_hson(source, 0, {
      recordToken(token, evidence) {
        if (token.kind === "TEXT" && token.quoted === true && evidence.roles.coverage !== undefined) {
          literals.push(evidence.roles.coverage);
        }
        if (token.kind === "OPEN" && evidence.roles.name !== undefined && source[evidence.roles.name.start] === "'") {
          literals.push(evidence.roles.name);
        }
      },
      recordAttribute(_attribute, roles) {
        if (roles.value === undefined) return;
        attributeValues.push(roles.value);
        if (source[roles.value.start] === '"') literals.push(roles.value);
      },
    });
  } catch { return false; }
  const comments: StructuralRange[] = [];
  for (let index = 0; index < source.length;) {
    const lexical = [...literals, ...attributeValues].find(range => index >= range.start && index < range.end);
    if (lexical !== undefined) {
      index = lexical.end;
      continue;
    }
    if (!source.startsWith("//", index)) {
      index += 1;
      continue;
    }
    let end = index + 2;
    while (end < source.length && source[end] !== "\n" && source[end] !== "\r") end += 1;
    comments.push({ start: index, end });
    index = end;
  }
  return [...literals, ...comments].some(range => offset > range.start && offset < range.end);
}

function indentationUnit(options: StructuralIndentation): string {
  const width = Number.isInteger(options.tabSize) && options.tabSize > 0 ? options.tabSize : 2;
  return options.insertSpaces ? " ".repeat(width) : "\t";
}

export function structural_formatting_edits(
  fileName: string,
  languageId: StructuralHostLanguage,
  text: string,
  options: StructuralIndentation,
  requestedRange?: StructuralRange,
): readonly StructuralEdit[] {
  const edits: StructuralEdit[] = [];
  const unit = indentationUnit(options);
  for (const region of structural_regions(fileName, languageId, text)) {
    if (requestedRange !== undefined && (region.bodyRange.end <= requestedRange.start || region.bodyRange.start >= requestedRange.end)) continue;
    const body = maskProtectedSource(text, region);
    if (body === undefined) continue;
    const pairs = analyzedPairs(body);
    if (pairs === undefined) continue;
    let localStart = 0;
    let line = 0;
    while (localStart <= body.length) {
      const newline = body.indexOf("\n", localStart);
      const rawEnd = newline === -1 ? body.length : newline;
      const contentEnd = rawEnd > localStart && body.charCodeAt(rawEnd - 1) === 13 ? rawEnd - 1 : rawEnd;
      const rawLine = body.slice(localStart, contentEnd);
      const leading = /^[ \t]*/.exec(rawLine)?.[0] ?? "";
      const content = rawLine.slice(leading.length);
      const editableFirstLine = line > 0 || region.bodyStartsAtLineStart;
      if (editableFirstLine && content !== "") {
        const depth = pairs.filter(pair => pair.openLine < line && pair.closeLine > line).length;
        const replacement = region.baseIndentation + unit.repeat(depth);
        const start = region.bodyRange.start + localStart;
        const end = start + leading.length;
        if (leading !== replacement
          && (requestedRange === undefined || (end >= requestedRange.start && start <= requestedRange.end))) {
          edits.push(Object.freeze({ start, end, text: replacement }));
        }
      }
      if (newline === -1) break;
      localStart = newline + 1;
      line += 1;
    }
  }
  return Object.freeze(edits.sort((left, right) => left.start - right.start));
}

export function structural_newline_plan(
  fileName: string,
  languageId: StructuralHostLanguage,
  text: string,
  offset: number,
  options: StructuralIndentation,
  newline: string,
): StructuralNewlinePlan | undefined {
  const region = structural_region_at(fileName, languageId, text, offset);
  if (region === undefined) return undefined;
  const body = maskProtectedSource(text, region);
  if (body === undefined) return undefined;
  const pairs = analyzedPairs(body);
  if (pairs === undefined) return undefined;
  const local = offset - region.bodyRange.start;
  if (insideNonStructuralSyntax(body, local)) return undefined;
  const currentLine = lineOf(body, local);
  const unit = indentationUnit(options);
  const depth = pairs.filter(pair => pair.open < local && pair.close >= local).length;
  const inner = region.baseIndentation + unit.repeat(depth);
  const paired = pairs.find(pair => pair.close === local && pair.openLine === currentLine);
  if (paired === undefined) return Object.freeze({ beforeCursor: newline + inner, afterCursor: "" });
  const outer = region.baseIndentation + unit.repeat(Math.max(0, depth - 1));
  return Object.freeze({ beforeCursor: newline + inner, afterCursor: newline + outer });
}
