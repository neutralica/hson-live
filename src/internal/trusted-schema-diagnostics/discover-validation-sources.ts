import ts from "typescript";
import { pathToFileURL } from "node:url";
import { create_hson_source_program, read_supported_hson_import_symbols, discover_hson_tagged_templates } from "../embedded-hson/discover-hson-tagged-templates.js";
import type { EmbeddedHsonSource, HostSourceRange } from "../embedded-hson/embedded-hson-source.js";
import type { TrustedSchemaSourceBinding } from "./protocol.js";

export type DiscoveredSchemaValidation = Readonly<{
  templateId: string;
  callId: string;
  source: EmbeddedHsonSource;
  callRange: HostSourceRange;
  schemaRange: HostSourceRange;
  schemaLabel: string;
  binding: TrustedSchemaSourceBinding;
}>;

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

/** Finite local const tracing only. Source identity is never recovered by value. */
export function discover_schema_validation_sources(fileName: string, text: string): readonly DiscoveredSchemaValidation[] {
  if (!/\.(?:ts|tsx)$/.test(fileName)) return [];
  const templates = discover_hson_tagged_templates(fileName, text).sources;
  const program = create_hson_source_program(fileName, text);
  const file = program.getSourceFile(fileName);
  if (file === undefined) return [];
  const diagnostics = program.getSyntacticDiagnostics(file);
  const checker = program.getTypeChecker();
  const roots = read_supported_hson_import_symbols(file, checker, diagnostics);
  const moduleUrl = pathToFileURL(fileName).href;
  const range = (node: ts.Node): HostSourceRange => ({ start: node.getStart(file), end: node.end });
  const facade = (expression: ts.Expression): boolean => {
    let node = expression;
    for (const name of ["validate", "schema", "liveMap"]) {
      if (!ts.isPropertyAccessExpression(node) || node.name.text !== name || node.questionDotToken !== undefined) return false;
      node = node.expression;
    }
    if (!ts.isIdentifier(node)) return false;
    const symbol = checker.getSymbolAtLocation(node);
    return symbol !== undefined && roots.has(symbol);
  };
  const declaration = (node: ts.Identifier, use: ts.Node, seen: Set<ts.Symbol>): ts.Declaration | undefined => {
    const symbol = checker.getSymbolAtLocation(node);
    if (symbol === undefined || seen.has(symbol) || symbol.declarations?.length !== 1) return undefined;
    seen.add(symbol);
    const decl = symbol.declarations[0];
    if (ts.isImportSpecifier(decl)) return decl;
    if (!ts.isVariableDeclaration(decl) || !ts.isIdentifier(decl.name)
      || !ts.isVariableDeclarationList(decl.parent) || (decl.parent.flags & ts.NodeFlags.Const) === 0
      || !ts.isVariableStatement(decl.parent.parent) || decl.parent.parent.parent !== domain(use)
      || decl.end >= use.getStart(file)) return undefined;
    return decl;
  };
  const canonical = (expression: ts.Expression, use: ts.Node, seen = new Set<ts.Symbol>(), depth = 0): EmbeddedHsonSource | undefined => {
    if (depth > 32) return undefined;
    const node = strip(expression);
    if (ts.isTaggedTemplateExpression(node)) return templates.find(source => source.tagRange.start === node.tag.getStart(file));
    if (!ts.isIdentifier(node)) return undefined;
    const decl = declaration(node, use, seen);
    if (decl === undefined || !ts.isVariableDeclaration(decl) || decl.initializer === undefined) return undefined;
    return canonical(decl.initializer, decl, seen, depth + 1);
  };
  const schema = (expression: ts.Expression, use: ts.Node, seen = new Set<ts.Symbol>(), depth = 0): TrustedSchemaSourceBinding | undefined => {
    if (depth > 32) return undefined;
    const node = strip(expression);
    if (!ts.isIdentifier(node)) return undefined;
    const decl = declaration(node, use, seen);
    if (decl === undefined) return undefined;
    if (ts.isImportSpecifier(decl)) {
      const clause = decl.parent.parent;
      const imported = clause.parent;
      if (decl.isTypeOnly || clause.isTypeOnly || !ts.isImportDeclaration(imported) || !ts.isStringLiteral(imported.moduleSpecifier)) return undefined;
      const specifier = imported.moduleSpecifier.text;
      // Initial explicit module mapping: relative file imports, no guessed TS
      // path aliases, re-export traversal, namespace or package lookalikes.
      if (!specifier.startsWith("./") && !specifier.startsWith("../")) return undefined;
      return { moduleUrl: new URL(specifier, moduleUrl).href, exportName: decl.propertyName?.text ?? decl.name.text };
    }
    if (!ts.isVariableDeclaration(decl) || decl.initializer === undefined || !ts.isIdentifier(decl.name)) return undefined;
    const initializer = strip(decl.initializer);
    if (ts.isIdentifier(initializer)) return schema(initializer, decl, seen, depth + 1);
    const statement = decl.parent.parent;
    if (ts.isVariableStatement(statement) && statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) return { moduleUrl, exportName: decl.name.text };
    return { moduleUrl, localName: decl.name.text, declarationStart: decl.getStart(file) };
  };
  const results: DiscoveredSchemaValidation[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.arguments.length === 2 && node.questionDotToken === undefined && node.typeArguments === undefined && facade(node.expression)
      && !diagnostics.some(d => d.start === undefined || (d.start < node.end && d.start + (d.length ?? 0) >= node.getStart(file)))) {
      const source = canonical(node.arguments[1], node);
      const binding = schema(node.arguments[0], node);
      if (source !== undefined && binding !== undefined) results.push({
        templateId: `${moduleUrl}#template:${source.templateRange.start}`,
        callId: `${moduleUrl}#validate:${node.getStart(file)}`,
        source, binding, callRange: range(node), schemaRange: range(node.arguments[0]), schemaLabel: node.arguments[0].getText(file),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return results;
}
