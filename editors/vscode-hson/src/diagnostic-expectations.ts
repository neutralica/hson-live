import ts from "typescript";
import type { HostSourceRange } from "../../../src/internal/embedded-hson/embedded-hson-source.js";
import type { DocumentDiagnosticSpec } from "./document-diagnostics.js";
import * as messages from "./diagnostic-messages.js";

export const HSON_EXPECT_ERROR_MARKER = "@hson-expect-error";

export type ExpectationRegion = Readonly<{
  kind: "template" | "static-source";
  range: HostSourceRange;
}>;

type Expectation = Readonly<{ range: HostSourceRange; code?: string }>;
type IndexedStatement = Readonly<{
  leading: HostSourceRange;
  range: HostSourceRange;
  eligible: boolean;
  candidates: IndexedRegion[];
}>;
type IndexedRegion = {
  readonly id: number;
  readonly kind: ExpectationRegion["kind"];
  readonly range: HostSourceRange;
  readonly parent?: IndexedRegion;
  readonly ancestors: readonly IndexedRegion[];
  statement?: IndexedStatement;
};
type DiagnosticQueue = { indices: number[]; next: number };

function rangeKey(range: HostSourceRange): string {
  return `${range.start}:${range.end}`;
}

function containsRange(region: HostSourceRange, range: HostSourceRange): boolean {
  return range.start >= region.start && range.end >= range.start && range.end <= region.end;
}

/** AST-authored regions are disjoint or nested; preserve their local identities. */
function indexRegions(regions: readonly ExpectationRegion[]): readonly IndexedRegion[] {
  const sorted = regions.map((region, id) => ({ region, id }))
    .sort((left, right) => left.region.range.start - right.region.range.start
      || right.region.range.end - left.region.range.end || left.id - right.id);
  const indexed: IndexedRegion[] = [];
  const stack: IndexedRegion[] = [];
  for (const { region, id } of sorted) {
    while (stack.length > 0 && region.range.end > stack[stack.length - 1].range.end) stack.pop();
    const parent = stack[stack.length - 1];
    const ancestors: IndexedRegion[] = [];
    // Binary ancestor links bound ownership lookup even for deeply nested regions.
    for (let ancestor = parent, level = 0; ancestor !== undefined; level += 1) {
      ancestors.push(ancestor);
      ancestor = ancestor.ancestors[level];
    }
    const item: IndexedRegion = { id, kind: region.kind, range: region.range, ancestors,
      ...(parent === undefined ? {} : { parent }) };
    indexed.push(item);
    stack.push(item);
  }
  return indexed;
}

function inStatementList(node: ts.Node): boolean {
  const parent = node.parent;
  return parent !== undefined && (ts.isSourceFile(parent) || ts.isBlock(parent)
    || ts.isModuleBlock(parent) || ts.isCaseClause(parent) || ts.isDefaultClause(parent));
}

function eligibleStatement(node: ts.Node): boolean {
  return ts.isVariableStatement(node) || ts.isExpressionStatement(node)
    || ts.isReturnStatement(node) || ts.isThrowStatement(node);
}

/** One token-inclusive pass owns comments and statement candidates, including closing trivia. */
function indexDocument(file: ts.SourceFile, regions: readonly IndexedRegion[]) {
  const byRange = new Map(regions.map(region => [rangeKey(region.range), region]));
  const comments = new Set<string>();
  const directives: Expectation[] = [];
  const statements: IndexedStatement[] = [];
  const readComments = (token: ts.Node): void => {
    const start = token.getStart(file);
    ts.forEachLeadingCommentRange(file.text, token.getFullStart(), (pos, end, kind) => {
      const key = rangeKey({ start: pos, end });
      if (kind !== ts.SyntaxKind.SingleLineCommentTrivia || end > start || comments.has(key)) return;
      comments.add(key);
      const lineStart = file.getLineStarts()[file.getLineAndCharacterOfPosition(pos).line];
      if (!/^\s*$/.test(file.text.slice(lineStart, pos))) return;
      const comment = file.text.slice(pos, end);
      const marker = /^\/\/[ \t]*(@hson-expect-error)(?=[ \t]|$)/.exec(comment);
      if (marker === null) return;
      const markerStart = pos + marker[0].length - HSON_EXPECT_ERROR_MARKER.length;
      const rest = comment.slice(marker[0].length).trim();
      const code = /^[A-Za-z_][A-Za-z0-9_]*$/.test(rest) ? rest : undefined;
      directives.push({ range: { start: markerStart, end: pos + comment.trimEnd().length }, code });
    });
  };
  const visit = (node: ts.Node, owner?: IndexedStatement): void => {
    // JSX text and JSDoc children are payload, not host token trivia. Literal,
    // regex and template tokens expose only trivia before their parser-set start.
    if (node.kind === ts.SyntaxKind.JsxText || node.kind === ts.SyntaxKind.JSDocComment) return;
    if (ts.isToken(node)) { readComments(node); return; }
    if (ts.isStatement(node) && inStatementList(node)) {
      const start = node.getStart(file);
      const statement: IndexedStatement = { leading: { start: node.getFullStart(), end: start },
        range: { start, end: node.getEnd() }, eligible: eligibleStatement(node), candidates: [] };
      statements.push(statement);
      owner = statement.eligible ? statement : undefined;
    }
    // Continue indexing local statements and nested regions, but exclude them
    // from an enclosing statement's target candidates across a body boundary.
    if (ts.isFunctionLike(node) || ts.isClassDeclaration(node) || ts.isClassExpression(node)) owner = undefined;
    if (ts.isTaggedTemplateExpression(node) || ts.isCallExpression(node)) {
      const region = byRange.get(rangeKey({ start: node.getStart(file), end: node.getEnd() }));
      if (region !== undefined && owner !== undefined) {
        region.statement = owner;
        owner.candidates.push(region);
      }
    }
    for (const child of node.getChildren(file)) visit(child, owner);
  };
  visit(file);
  statements.sort((left, right) => left.leading.start - right.leading.start);
  directives.sort((left, right) => left.range.start - right.range.start);
  return { directives, statements };
}

function lastStartingBefore<T>(items: readonly T[], position: number, start: (item: T) => number): number {
  let low = 0, high = items.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (start(items[middle]) <= position) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}

function targetFor(statements: readonly IndexedStatement[], expectation: Expectation): IndexedRegion | undefined {
  const following = statements[lastStartingBefore(statements, expectation.range.start, item => item.leading.start)];
  if (following === undefined || expectation.range.end > following.leading.end || !following.eligible) return undefined;
  const target = following.candidates[0];
  return following.candidates.length === 1 && target?.kind === "template" ? target : undefined;
}

/** Ownership is the innermost authored region containing the entire primary range. */
function diagnosticOwner(regions: readonly IndexedRegion[], range: HostSourceRange): IndexedRegion | undefined {
  let region = regions[lastStartingBefore(regions, range.start, item => item.range.start)];
  if (region === undefined || range.end < range.start) return undefined;
  if (containsRange(region.range, range)) return region;
  for (let level = region.ancestors.length - 1; level >= 0; level -= 1) {
    const ancestor = region.ancestors[level];
    if (ancestor !== undefined && range.end > ancestor.range.end) region = ancestor;
  }
  return region.parent !== undefined && containsRange(region.parent.range, range) ? region.parent : undefined;
}

function expectableCode(diagnostic: DocumentDiagnosticSpec): string | undefined {
  const code = diagnostic.code;
  return typeof code === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(code) && code !== "TRANSFORM_ERROR"
    && code !== "HSON_EXPECT_ERROR_UNUSED" && code !== "HSON_EXPECT_ERROR_INVALID" ? code : undefined;
}

function failure(expectation: Expectation, code: "HSON_EXPECT_ERROR_UNUSED" | "HSON_EXPECT_ERROR_INVALID", message: string): DocumentDiagnosticSpec {
  return { code, message, source: "Hson", range: expectation.range, precision: "exact", related: [] };
}

/**
 * Main-producer host assertion only: select a unique template in the next local
 * statement, then consume one original diagnostic owned by that authored region.
 * Function/class bodies contribute ownership, but not enclosing target candidates.
 */
export function apply_hson_diagnostic_expectations(
  file: ts.SourceFile,
  regions: readonly ExpectationRegion[],
  diagnostics: readonly DocumentDiagnosticSpec[],
): readonly DocumentDiagnosticSpec[] {
  if (!file.text.includes(HSON_EXPECT_ERROR_MARKER)) return diagnostics;
  const indexedRegions = indexRegions(regions);
  const { directives, statements } = indexDocument(file, indexedRegions);
  if (directives.length === 0) return diagnostics;
  const consumed = new Set<number>();
  const errors: DocumentDiagnosticSpec[] = [];
  const queues = new Map<number, Map<string, DiagnosticQueue>>();
  const ordered = diagnostics.map((diagnostic, index) => ({ diagnostic, index }))
    .sort((left, right) => left.diagnostic.range.start - right.diagnostic.range.start
      || left.diagnostic.range.end - right.diagnostic.range.end || left.index - right.index);
  for (const { diagnostic, index } of ordered) {
    const code = expectableCode(diagnostic);
    if (code === undefined) continue;
    const owner = diagnosticOwner(indexedRegions, diagnostic.range);
    if (owner === undefined) continue;
    let codes = queues.get(owner.id);
    if (codes === undefined) { codes = new Map(); queues.set(owner.id, codes); }
    let queue = codes.get(code);
    if (queue === undefined) { queue = { indices: [], next: 0 }; codes.set(code, queue); }
    queue.indices.push(index);
  }
  for (const directive of directives) {
    if (directive.code === undefined) {
      errors.push(failure(directive, "HSON_EXPECT_ERROR_INVALID", messages.hsonExpectationInvalid));
      continue;
    }
    const target = targetFor(statements, directive);
    if (target === undefined) {
      errors.push(failure(directive, "HSON_EXPECT_ERROR_UNUSED", messages.hsonExpectationNoTarget(directive.code)));
      continue;
    }
    const queue = queues.get(target.id)?.get(directive.code);
    const match = queue?.indices[queue.next];
    if (match === undefined || queue === undefined) errors.push(failure(directive, "HSON_EXPECT_ERROR_UNUSED", messages.hsonExpectationUnused(directive.code)));
    else { consumed.add(match); queue.next += 1; }
  }
  return Object.freeze([...diagnostics.filter((_, index) => !consumed.has(index)), ...errors]);
}
