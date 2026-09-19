import { OBJ_TAG } from "../../../src/core/constants.js";
import { parse_hson } from "../../../src/api/transform/parsers/parse-hson.js";
import { serialize_hson } from "../../../src/api/transform/serializers/serialize-hson.js";
import { detach_hson_root_value } from "../../../src/api/transform/utils/node-utils/detach-hson-root-value.js";
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
export type StructuralDocumentEvidence = Readonly<{
  fileName: string;
  languageId: StructuralHostLanguage;
  text: string;
  regions: readonly StructuralRegion[];
}>;
export type StructuralEdit = Readonly<{ start: number; end: number; text: string }>;
export type StructuralIndentation = Readonly<{ insertSpaces: boolean; tabSize: number }>;
export type StructuralNewlinePlan = Readonly<{ beforeCursor: string; afterCursor: string }>;

type StructuralPair = Readonly<{
  open: number;
  close: number;
  openLine: number;
  closeLine: number;
  kind: "object" | "other";
  firstMember?: number;
}>;

type StructuralStackEntry = {
  token: Tokens;
  index: number;
  firstMember?: number;
};

function lineStart(text: string, offset: number): number {
  return text.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
}

function leadingWhitespaceAt(text: string, offset: number): string {
  const start = lineStart(text, offset);
  const prefix = text.slice(start, offset);
  return /^[ \t]*$/.test(prefix) ? prefix : "";
}

function discoverStructuralRegions(
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

export function structural_document_evidence(
  fileName: string,
  languageId: StructuralHostLanguage,
  text: string,
): StructuralDocumentEvidence {
  return Object.freeze({
    fileName,
    languageId,
    text,
    regions: discoverStructuralRegions(fileName, languageId, text),
  });
}

type StructuralEvidenceAnalyzer = (
  fileName: string,
  languageId: StructuralHostLanguage,
  text: string,
) => StructuralDocumentEvidence;

/** Small LRU for open-document binding evidence; versions are the invalidation authority. */
export class StructuralDocumentEvidenceCache {
  private readonly entries = new Map<string, Readonly<{ version: number; evidence: StructuralDocumentEvidence }>>();

  public constructor(
    private readonly capacity = 8,
    private readonly analyze: StructuralEvidenceAnalyzer = structural_document_evidence,
  ) {}

  public get(
    key: string,
    version: number,
    fileName: string,
    languageId: StructuralHostLanguage,
    text: string,
  ): StructuralDocumentEvidence {
    const cached = this.entries.get(key);
    if (cached !== undefined && cached.version === version) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached.evidence;
    }
    const evidence = this.analyze(fileName, languageId, text);
    this.entries.delete(key);
    this.entries.set(key, Object.freeze({ version, evidence }));
    while (this.entries.size > Math.max(1, this.capacity)) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    return evidence;
  }

  public invalidate(key: string): void { this.entries.delete(key); }
  public clear(): void { this.entries.clear(); }
}

export function structural_regions(
  fileName: string,
  languageId: StructuralHostLanguage,
  text: string,
): readonly StructuralRegion[] {
  return structural_document_evidence(fileName, languageId, text).regions;
}

export function structural_region_at_evidence(
  evidence: StructuralDocumentEvidence,
  offset: number,
): StructuralRegion | undefined {
  let low = 0;
  let high = evidence.regions.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const region = evidence.regions[middle];
    if (region === undefined) return undefined;
    if (offset < region.bodyRange.start) high = middle - 1;
    else if (offset > region.bodyRange.end) low = middle + 1;
    else return region.protectedRanges.some(range => offset > range.start && offset < range.end)
      ? undefined
      : region;
  }
  return undefined;
}

export function structural_region_at(
  fileName: string,
  languageId: StructuralHostLanguage,
  text: string,
  offset: number,
): StructuralRegion | undefined {
  return structural_region_at_evidence(structural_document_evidence(fileName, languageId, text), offset);
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
  const stack: StructuralStackEntry[] = [];
  const pairs: StructuralPair[] = [];
  for (const token of tokens) {
    if (token.kind === "EMPTY_OBJ" && token.pos !== undefined) {
      pairs.push(Object.freeze({
        open: token.pos.index,
        close: token.pos.index + 1,
        openLine: token.pos.line - 1,
        closeLine: token.pos.line - 1,
        kind: "object",
      }));
      continue;
    }
    if ((token.kind === "OPEN" || token.kind === "ARR_OPEN") && token.pos !== undefined) {
      const parent = stack.at(-1);
      if (token.kind === "OPEN" && parent?.token.kind === "OPEN"
        && parent.token.tag === OBJ_TAG && parent.firstMember === undefined) {
        parent.firstMember = token.pos.index;
      }
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
      kind: open.token.kind === "OPEN" && open.token.tag === OBJ_TAG ? "object" : "other",
      ...(open.firstMember === undefined ? {} : { firstMember: open.firstMember }),
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

function lexicalRanges(source: string): Readonly<{
  literals: readonly StructuralRange[];
  comments: readonly StructuralRange[];
}> {
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
  } catch { return Object.freeze({ literals: Object.freeze([]), comments: Object.freeze([]) }); }
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
  return Object.freeze({
    literals: Object.freeze(literals),
    comments: Object.freeze(comments),
  });
}

function insideNonStructuralSyntax(source: string, offset: number): boolean {
  const ranges = lexicalRanges(source);
  return [...ranges.literals, ...ranges.comments].some(range => offset > range.start && offset < range.end);
}

function indentationUnit(options: StructuralIndentation): string {
  const width = Number.isInteger(options.tabSize) && options.tabSize > 0 ? options.tabSize : 2;
  return options.insertSpaces ? " ".repeat(width) : "\t";
}

function overlaps(left: StructuralRange, right: StructuralRange): boolean {
  return left.start < right.end && right.start < left.end;
}

function preferredHorizontalTrivia(source: string, start: number, end: number): string {
  const left = source[start - 1] ?? "";
  const right = source[end] ?? "";
  const adjacent = left === "<" || left === "[" || left === "«" || left === "," || left === "="
    || right === ">" || right === "]" || right === "»" || right === "," || right === "="
    || (right === "/" && source[end + 1] === ">");
  return adjacent ? "" : " ";
}

function canonicalMeaning(source: string): string | undefined {
  try { return serialize_hson(detach_hson_root_value(parse_hson(source))); }
  catch { return undefined; }
}

/** Tokenizer-admitted same-line trivia only; lexical content and comment lines are excluded. */
function horizontalTriviaEdits(
  source: string,
  protectedRanges: readonly StructuralRange[],
  comments: readonly StructuralRange[],
  occupied: readonly StructuralRange[],
): readonly StructuralEdit[] {
  const edits: StructuralEdit[] = [];
  for (let index = 0; index < source.length;) {
    if (source[index] !== " " && source[index] !== "\t") { index += 1; continue; }
    const start = index;
    while (source[index] === " " || source[index] === "\t") index += 1;
    const end = index;
    if (start === lineStart(source, start) || end >= source.length || source[end] === "\n" || source[end] === "\r") continue;
    const range = { start, end };
    if (protectedRanges.some(protectedRange => overlaps(range, protectedRange))
      || occupied.some(occupiedRange => overlaps(range, occupiedRange))) continue;
    const sourceLineStart = lineStart(source, start);
    const sourceLineEnd = source.indexOf("\n", end);
    const lineEnd = sourceLineEnd === -1 ? source.length : sourceLineEnd;
    if (comments.some(comment => comment.start >= sourceLineStart && comment.start < lineEnd)) continue;
    const replacement = preferredHorizontalTrivia(source, start, end);
    if (source.slice(start, end) !== replacement) edits.push(Object.freeze({ start, end, text: replacement }));
  }
  return Object.freeze(edits);
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
    const regionEditStart = edits.length;
    const pairs = analyzedPairs(body);
    if (pairs === undefined) continue;
    const lexical = lexicalRanges(body);
    const comments = lexical.comments;
    for (const pair of pairs) {
      if (pair.kind !== "object" || pair.firstMember === undefined || pair.openLine === pair.closeLine) continue;
      if (lineOf(body, pair.firstMember) !== pair.openLine) continue;
      const openingLineEnd = body.indexOf("\n", pair.open);
      const commentOnOpeningLine = comments.some(comment =>
        comment.start > pair.open && (openingLineEnd === -1 || comment.start < openingLineEnd));
      if (commentOnOpeningLine) continue;
      const start = pair.open + 1;
      const end = pair.firstMember;
      if (requestedRange !== undefined) {
        const hostOpen = region.bodyRange.start + pair.open;
        const hostClose = region.bodyRange.start + pair.close + 1;
        if (hostOpen < requestedRange.start || hostClose > requestedRange.end) continue;
      }
      const depth = pairs.filter(container => container.open <= pair.open && container.close > pair.open).length;
      const newline = openingLineEnd > 0 && body[openingLineEnd - 1] === "\r" ? "\r\n" : "\n";
      const replacement = newline + region.baseIndentation + unit.repeat(depth);
      edits.push(Object.freeze({
        start: region.bodyRange.start + start,
        end: region.bodyRange.start + end,
        text: replacement,
      }));
    }
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
    const occupied = edits
      .filter(edit => edit.start >= region.bodyRange.start && edit.end <= region.bodyRange.end)
      .map(edit => ({ start: edit.start - region.bodyRange.start, end: edit.end - region.bodyRange.start }));
    const interpolationRanges = region.protectedRanges.map(range => ({
      start: range.start - region.bodyRange.start,
      end: range.end - region.bodyRange.start,
    }));
    for (const edit of horizontalTriviaEdits(
      body,
      [...lexical.literals, ...interpolationRanges],
      comments,
      occupied,
    )) {
      const start = region.bodyRange.start + edit.start;
      const end = region.bodyRange.start + edit.end;
      if (requestedRange !== undefined && (end < requestedRange.start || start > requestedRange.end)) continue;
      edits.push(Object.freeze({ start, end, text: edit.text }));
    }
    const regionEdits = edits.slice(regionEditStart).map(edit => ({
      start: edit.start - region.bodyRange.start,
      end: edit.end - region.bodyRange.start,
      text: edit.text,
    }));
    let candidate = body;
    for (const edit of [...regionEdits].sort((left, right) => right.start - left.start)) {
      candidate = candidate.slice(0, edit.start) + edit.text + candidate.slice(edit.end);
    }
    const beforeMeaning = canonicalMeaning(body);
    if (beforeMeaning === undefined || canonicalMeaning(candidate) !== beforeMeaning) edits.splice(regionEditStart);
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
  return structural_newline_plan_from_evidence(
    structural_document_evidence(fileName, languageId, text),
    offset,
    options,
    newline,
  );
}

export function structural_newline_plan_from_evidence(
  evidence: StructuralDocumentEvidence,
  offset: number,
  options: StructuralIndentation,
  newline: string,
): StructuralNewlinePlan | undefined {
  const region = structural_region_at_evidence(evidence, offset);
  if (region === undefined) return undefined;
  const body = maskProtectedSource(evidence.text, region);
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
