import ts from "typescript";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { create_hson_source_program, read_supported_hson_import_symbols, discover_hson_tagged_templates } from "../embedded-hson/discover-hson-tagged-templates.js";
import type { HostSourceRange } from "../embedded-hson/embedded-hson-source.js";
import { discover_static_from_hson_sources } from "../embedded-hson/discover-static-from-hson-sources.js";
import { authored_hson_occurrence_range, type AuthoredHsonSource } from "../embedded-hson/authored-hson-source.js";
import type { TrustedSchemaMapFlow, TrustedSchemaSourceBinding } from "./protocol.js";
import { interpolation_site, type InterpolationSite } from "./interpolation-source.js";

export type DiscoveredSchemaValidation = Readonly<{
  interpolation?: InterpolationSite;
  mapFlow?: TrustedSchemaMapFlow;
  constructionRange?: HostSourceRange;
  constructionCalleeRange?: HostSourceRange;
  useCalleeRange?: HostSourceRange;
  mapRange?: HostSourceRange;
  templateId: string;
  callId: string;
  source: AuthoredHsonSource;
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

function standalone(node: ts.Node): boolean {
  while (ts.isParenthesizedExpression(node.parent)) node = node.parent;
  return ts.isExpressionStatement(node.parent) && node.parent.parent === domain(node);
}

/** Finite local const tracing only. Source identity is never recovered by value. */
export function discover_schema_validation_sources(fileName: string, text: string): readonly DiscoveredSchemaValidation[] {
  if (!/\.(?:ts|tsx)$/.test(fileName)) return [];
  const discovered = discover_hson_tagged_templates(fileName, text);
  const templates = [...discovered.sources, ...discovered.interpolated];
  const staticSources = discover_static_from_hson_sources(fileName, text).sources;
  const program = create_hson_source_program(fileName, text);
  const file = program.getSourceFile(fileName);
  if (file === undefined) return [];
  const diagnostics = program.getSyntacticDiagnostics(file);
  const checker = program.getTypeChecker();
  const authors = read_supported_hson_import_symbols(file, checker, diagnostics);
  const roots = read_supported_hson_import_symbols(file, checker, diagnostics, "hson");
  const moduleUrl = pathToFileURL(fileName).href;
  const range = (node: ts.Node): HostSourceRange => ({ start: node.getStart(file), end: node.end });
  const maps = read_supported_hson_import_symbols(file, checker, diagnostics, "hsonLiveMap");
  const property = (expression: ts.Expression, name: string): ts.Expression | undefined => {
    const node = strip(expression);
    return ts.isPropertyAccessExpression(node) && node.name.text === name && node.questionDotToken === undefined ? strip(node.expression) : undefined;
  };
  const mapFacade = (expression: ts.Expression): boolean => {
    const node = strip(expression);
    if (ts.isIdentifier(node)) { const symbol = checker.getSymbolAtLocation(node); return symbol !== undefined && maps.has(symbol); }
    const root = property(node, "liveMap");
    if (root === undefined || !ts.isIdentifier(root)) return false;
    const symbol = checker.getSymbolAtLocation(root);
    return symbol !== undefined && roots.has(symbol);
  };
  const facade = (expression: ts.Expression): boolean => {
    const schema = property(expression, "validate");
    if (schema !== undefined && ts.isIdentifier(schema)) {
      const symbol = checker.getSymbolAtLocation(schema);
      if (symbol !== undefined && authors.has(symbol)) return true;
    }
    const map = schema === undefined ? undefined : property(schema, "schema");
    return map !== undefined && mapFacade(map);
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
  const canonical = (expression: ts.Expression, use: ts.Node, seen = new Set<ts.Symbol>(), depth = 0): AuthoredHsonSource | undefined => {
    if (depth > 32) return undefined;
    const node = strip(expression);
    if (ts.isTaggedTemplateExpression(node)) return templates.find(source => source.tagRange.start === node.tag.getStart(file));
    if (!ts.isIdentifier(node)) return undefined;
    const decl = declaration(node, use, seen);
    if (decl === undefined || !ts.isVariableDeclaration(decl) || decl.initializer === undefined) return undefined;
    return canonical(decl.initializer, decl, seen, depth + 1);
  };
  const staticSource = (boundary: ts.CallExpression): AuthoredHsonSource | undefined =>
    staticSources.find(source => source.callRange.start === boundary.getStart(file) && source.boundary === "livemap");
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
  const construction = (expression: ts.Expression, use: ts.Node, seen = new Set<ts.Symbol>(), depth = 0): ts.CallExpression | undefined => {
    if (depth > 32) return undefined;
    const node = strip(expression);
    if (ts.isCallExpression(node) && node.arguments.length === 1 && node.questionDotToken === undefined && node.typeArguments === undefined) {
      const owner = property(node.expression, "fromHson");
      return owner !== undefined && mapFacade(owner) ? node : undefined;
    }
    if (!ts.isIdentifier(node)) return undefined;
    const decl = declaration(node, use, seen);
    return decl !== undefined && ts.isVariableDeclaration(decl) && decl.initializer !== undefined
      ? construction(decl.initializer, decl, seen, depth + 1) : undefined;
  };
  // Body edits are new candidates, not new lifecycle sites. Every byte outside
  // the candidate body participates in authority; normalized offsets survive edits.
  const authoredBodies = [...templates, ...staticSources].map(source => source.bodyRange);
  const normalizedOffset = (offset: number): number => offset - authoredBodies.filter(body => body.end <= offset).reduce((n, body) => n + body.end - body.start, 0);

  const results: DiscoveredSchemaValidation[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.arguments.length === 2 && node.questionDotToken === undefined && node.typeArguments === undefined && facade(node.expression)
      && !diagnostics.some(d => d.start === undefined || (d.start < node.end && d.start + (d.length ?? 0) >= node.getStart(file)))) {
      const source = canonical(node.arguments[1], node);
      const binding = schema(node.arguments[0], node);
      if (source !== undefined && binding !== undefined) results.push({
        templateId: `${moduleUrl}#template:${authored_hson_occurrence_range(source).start}`,
        callId: `${moduleUrl}#validate:${node.getStart(file)}`,
        source, binding, callRange: range(node), schemaRange: range(node.arguments[0]), schemaLabel: node.arguments[0].getText(file),
      });
    }
    if (ts.isCallExpression(node) && standalone(node)
      && node.arguments.length === 1 && node.questionDotToken === undefined && node.typeArguments === undefined
      && !diagnostics.some(d => d.start === undefined || (d.start < node.end && d.start + (d.length ?? 0) >= node.getStart(file)))) {
      const owner = property(node.expression, "use");
      const map = owner === undefined ? undefined : property(owner, "schema");
      const boundary = map === undefined || !ts.isIdentifier(map) ? undefined : construction(map, node);
      const source = boundary === undefined ? undefined : canonical(boundary.arguments[0], boundary) ?? staticSource(boundary);
      const binding = schema(node.arguments[0], node);
      if (boundary !== undefined && source !== undefined && binding !== undefined && map !== undefined && domain(boundary) === domain(node)) {
        const occurrence = authored_hson_occurrence_range(source);
        const templateId = `${moduleUrl}#template:${normalizedOffset(occurrence.start)}`;
        const callId = `${moduleUrl}#use:${normalizedOffset(node.getStart(file))}`;
        results.push({ source, binding, templateId, callId, callRange: range(node), schemaRange: range(node.arguments[0]), schemaLabel: node.arguments[0].getText(file),
          constructionRange: range(boundary), constructionCalleeRange: range(boundary.expression), useCalleeRange: range(node.expression), mapRange: range(map),
          mapFlow: { moduleUrl, contextRevision: createHash("sha256").update(text.slice(0, source.bodyRange.start) + text.slice(source.bodyRange.end)).digest("hex"), templateId, callId, constructionId: `${moduleUrl}#fromHson:${normalizedOffset(boundary.getStart(file))}` },
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return results.map(site => {
    const interpolated = discovered.interpolated.find(source => source.templateRange.start === authored_hson_occurrence_range(site.source).start);
    return interpolated === undefined ? site : { ...site, interpolation: interpolation_site(interpolated, moduleUrl) };
  });
}
