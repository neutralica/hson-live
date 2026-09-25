import ts from "typescript";

import {
  create_hson_source_program,
  read_template_substitution_ranges,
  read_supported_hson_import_symbols,
} from "./discover-hson-tagged-templates.js";
import {
  create_static_hson_source,
  type StaticHsonBoundary,
  type StaticHsonSource,
} from "./static-hson-source.js";

function strip(node: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(node)) node = node.expression;
  return node;
}

function domain(node: ts.Node): ts.SourceFile | ts.Block | undefined {
  for (let parent = node.parent; parent !== undefined; parent = parent.parent) {
    if (ts.isSourceFile(parent)) return parent;
    if (ts.isFunctionLike(parent)) return "body" in parent && parent.body !== undefined && ts.isBlock(parent.body) ? parent.body : undefined;
  }
  return undefined;
}

export type StaticFromHsonDiscovery = Readonly<{
  sources: readonly StaticHsonSource[];
  interpolated: readonly InterpolatedFromHsonSource[];
  dynamicCallRanges: readonly Readonly<{ start: number; end: number }>[];
}>;

export type InterpolatedFromHsonSource = Readonly<{
  kind: "javascript-template";
  fileName: string;
  hostText: string;
  boundary: StaticHsonBoundary;
  callRange: Readonly<{ start: number; end: number }>;
  calleeRange: Readonly<{ start: number; end: number }>;
  literalRange: Readonly<{ start: number; end: number }>;
  bodyRange: Readonly<{ start: number; end: number }>;
  substitutionRanges: readonly Readonly<{ start: number; end: number }>[];
  expressionRanges: readonly Readonly<{ start: number; end: number }>[];
}>;

function has_direct_template_segment_correspondence(template: ts.TemplateExpression): boolean {
  return [template.head, ...template.templateSpans.map(span => span.literal)]
    .every(literal => (literal.rawText ?? literal.text) === literal.text);
}

/** Discover exact static strings and safe interpolation ranges at current official facade identities. */
export function discover_static_from_hson_sources(fileName: string, hostText: string): StaticFromHsonDiscovery {
  const empty = (): StaticFromHsonDiscovery => Object.freeze({
    sources: Object.freeze([]),
    interpolated: Object.freeze([]),
    dynamicCallRanges: Object.freeze([]),
  });
  if (!/\.tsx?$/.test(fileName)) return empty();
  const program = create_hson_source_program(fileName, hostText);
  const file = program.getSourceFile(fileName);
  if (file === undefined) return empty();
  const diagnostics = program.getSyntacticDiagnostics(file);
  if (diagnostics.some(diagnostic => diagnostic.start === undefined)) return empty();
  const checker = program.getTypeChecker();
  const roots = read_supported_hson_import_symbols(file, checker, diagnostics, "hson");
  const transforms = read_supported_hson_import_symbols(file, checker, diagnostics, "hsonTransform");
  const trees = read_supported_hson_import_symbols(file, checker, diagnostics, "hsonLiveTree");
  const property = (expression: ts.Expression, name: string): ts.Expression | undefined => {
    const node = strip(expression);
    return ts.isPropertyAccessExpression(node) && node.name.text === name && node.questionDotToken === undefined ? strip(node.expression) : undefined;
  };
  const imported = (expression: ts.Expression, symbols: ReadonlySet<ts.Symbol>): boolean => {
    const node = strip(expression);
    if (!ts.isIdentifier(node)) return false;
    const symbol = checker.getSymbolAtLocation(node);
    return symbol !== undefined && symbols.has(symbol);
  };
  const rootMember = (expression: ts.Expression, name: string): boolean => {
    const owner = property(expression, name);
    return owner !== undefined && imported(owner, roots);
  };
  const boundary = (expression: ts.Expression): StaticHsonBoundary | undefined => {
    const owner = property(expression, "fromHson");
    if (owner === undefined) return undefined;
    if (imported(owner, transforms) || imported(owner, roots) || rootMember(owner, "transform")) return "transform";
    if (imported(owner, trees) || rootMember(owner, "liveTree")) return "livetree";
    return undefined;
  };
  const declaration = (identifier: ts.Identifier, use: ts.Node, seen: Set<ts.Symbol>): ts.VariableDeclaration | undefined => {
    const symbol = checker.getSymbolAtLocation(identifier);
    if (symbol === undefined || seen.has(symbol) || symbol.declarations?.length !== 1) return undefined;
    seen.add(symbol);
    const declaration = symbol.declarations[0];
    if (!ts.isVariableDeclaration(declaration) || !ts.isIdentifier(declaration.name)
      || !ts.isVariableDeclarationList(declaration.parent) || (declaration.parent.flags & ts.NodeFlags.Const) === 0
      || !ts.isVariableStatement(declaration.parent.parent) || declaration.parent.parent.parent !== domain(use)
      || declaration.end >= use.getStart(file)) return undefined;
    return declaration;
  };
  const literal = (expression: ts.Expression, use: ts.Node, seen = new Set<ts.Symbol>(), depth = 0): ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | undefined => {
    if (depth > 32) return undefined;
    const node = strip(expression);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node;
    if (!ts.isIdentifier(node)) return undefined;
    const found = declaration(node, use, seen);
    return found?.initializer === undefined ? undefined : literal(found.initializer, found, seen, depth + 1);
  };
  const overlapsDiagnostic = (node: ts.Node): boolean => diagnostics.some(diagnostic => diagnostic.start === undefined
    || (diagnostic.start < node.end && diagnostic.start + (diagnostic.length ?? 0) >= node.getStart(file)));
  const sources: StaticHsonSource[] = [];
  const interpolated: InterpolatedFromHsonSource[] = [];
  const dynamicCallRanges: Readonly<{ start: number; end: number }>[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.arguments.length === 1 && node.questionDotToken === undefined && node.typeArguments === undefined) {
      const kind = boundary(node.expression);
      if (kind !== undefined && !overlapsDiagnostic(node)) {
        const occurrence = literal(node.arguments[0], node);
        const source = occurrence === undefined ? undefined : create_static_hson_source(fileName, hostText, file, node, occurrence, kind);
        if (source === undefined) {
          dynamicCallRanges.push(Object.freeze({ start: node.getStart(file), end: node.end }));
          const argument = strip(node.arguments[0]);
          if (ts.isTemplateExpression(argument) && has_direct_template_segment_correspondence(argument)) {
            const substitutionRanges = read_template_substitution_ranges(argument, hostText, file);
            if (substitutionRanges !== undefined) {
              const literalRange = Object.freeze({ start: argument.getStart(file), end: argument.end });
              interpolated.push(Object.freeze({
                kind: "javascript-template",
                fileName,
                hostText,
                boundary: kind,
                callRange: Object.freeze({ start: node.getStart(file), end: node.end }),
                calleeRange: Object.freeze({ start: node.expression.getStart(file), end: node.expression.end }),
                literalRange,
                bodyRange: Object.freeze({ start: literalRange.start + 1, end: literalRange.end - 1 }),
                substitutionRanges,
                expressionRanges: Object.freeze(argument.templateSpans.map(span => Object.freeze({
                  start: span.expression.getStart(file),
                  end: span.expression.end,
                }))),
              }));
            }
          }
        } else sources.push(source);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return Object.freeze({
    sources: Object.freeze(sources),
    interpolated: Object.freeze(interpolated),
    dynamicCallRanges: Object.freeze(dynamicCallRanges),
  });
}
