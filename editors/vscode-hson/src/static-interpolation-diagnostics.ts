import ts from "typescript";
import { create_hson_source_program, discover_hson_tagged_templates, is_official_hson_package_binding } from "../../../src/internal/embedded-hson/discover-hson-tagged-templates.js";
import { interpolation_site } from "../../../src/internal/trusted-schema-diagnostics/interpolation-source.js";
import { query_hson_editor_context } from "../../../src/internal/editor-introspection/query.js";
import { interpolation_semantic_mismatch, type StaticInterpolationFamily } from "../../../src/internal/editor-introspection/interpolation-compatibility.js";
import type { DocumentDiagnosticSpec } from "./document-diagnostics.js";

/** Static proof only; undecidable expression types remain runtime-owned. */
export function static_interpolation_diagnostics(fileName: string, text: string): readonly DocumentDiagnosticSpec[] {
  const discovery = discover_hson_tagged_templates(fileName, text);
  if (discovery.interpolated.length === 0) return [];
  const program = create_hson_source_program(fileName, text);
  const file = program.getSourceFile(fileName);
  if (file === undefined) return [];
  const checker = program.getTypeChecker();
  const expressions = new Map<number, ts.Expression>();
  const visit = (node: ts.Node): void => {
    if (ts.isTemplateSpan(node)) expressions.set(node.expression.getStart(file), node.expression);
    ts.forEachChild(node, visit);
  };
  visit(file);
  const diagnostics: DocumentDiagnosticSpec[] = [];
  for (const template of discovery.interpolated) {
    if (template.authoringKind !== "data" && template.authoringKind !== "document") continue;
    const site = interpolation_site(template, fileName);
    let source = "";
    const slots: { offset: number; substitution: number }[] = [];
    site.literals.forEach((literal, index) => {
      source += literal.raw;
      if (index < site.expressions.length) slots.push({ offset: source.length, substitution: index });
    });
    const roles = query_hson_editor_context({ mode: template.authoringKind, source, slots }).interpolationRoles;
    roles.forEach((role, index) => {
      const range = template.expressionRanges[index];
      if (range === undefined) return;
      const expression = expressions.get(range.start);
      if (expression === undefined) return;
      const mismatch = interpolation_semantic_mismatch(role, expression_family(expression, checker, new Set()));
      if (mismatch === undefined) return;
      diagnostics.push({ message: mismatch.message, code: mismatch.code, source: "Hson", range, precision: "exact", related: [] });
    });
  }
  return diagnostics;
}

function type_family(node: ts.TypeNode, checker: ts.TypeChecker): StaticInterpolationFamily {
  if (ts.isParenthesizedTypeNode(node)) return type_family(node.type, checker);
  if (ts.isUnionTypeNode(node)) {
    const families = node.types.map(type => type_family(type, checker));
    return families.every(family => family === families[0]) ? families[0] ?? "unknown" : "unknown";
  }
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
    if (is_official_hson_package_binding(node.typeName, "HsonData", checker)) return "data";
    if (is_official_hson_package_binding(node.typeName, "HsonDocument", checker)) return "document";
    const type = checker.getTypeFromTypeNode(node);
    return type.flags & ts.TypeFlags.Object ? "object" : "unknown";
  }
  switch (node.kind) {
    case ts.SyntaxKind.StringKeyword: return "string";
    case ts.SyntaxKind.NumberKeyword: return "number";
    case ts.SyntaxKind.BooleanKeyword: return "boolean";
    case ts.SyntaxKind.NullKeyword: return "null";
    case ts.SyntaxKind.ObjectKeyword: return "object";
  }
  if (ts.isArrayTypeNode(node) || ts.isTypeLiteralNode(node) || ts.isTupleTypeNode(node)) return "object";
  if (ts.isLiteralTypeNode(node)) {
    if (ts.isStringLiteral(node.literal)) return "string";
    if (ts.isNumericLiteral(node.literal)) return "number";
    if (node.literal.kind === ts.SyntaxKind.TrueKeyword || node.literal.kind === ts.SyntaxKind.FalseKeyword) return "boolean";
    if (node.literal.kind === ts.SyntaxKind.NullKeyword) return "null";
  }
  return "unknown";
}

function expression_family(node: ts.Expression, checker: ts.TypeChecker, seen: Set<ts.Symbol>): StaticInterpolationFamily {
  if (ts.isParenthesizedExpression(node)) return expression_family(node.expression, checker, seen);
  if (ts.isAsExpression(node)) return type_family(node.type, checker);
  if (ts.isSatisfiesExpression(node)) return expression_family(node.expression, checker, seen);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) return "string";
  if (ts.isTaggedTemplateExpression(node) && ts.isPropertyAccessExpression(node.tag) && ts.isIdentifier(node.tag.expression)
    && is_official_hson_package_binding(node.tag.expression, "Hson", checker)) {
    if (node.tag.name.text === "data") return "data";
    if (node.tag.name.text === "document") return "document";
    if (node.tag.name.text === "canonical") return "canonical";
  }
  if (ts.isNumericLiteral(node) || ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand)) return "number";
  if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) return "boolean";
  if (node.kind === ts.SyntaxKind.NullKeyword) return "null";
  if (ts.isObjectLiteralExpression(node) || ts.isArrayLiteralExpression(node) || ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "String") return "object";
  if (ts.isIdentifier(node)) {
    const symbol = checker.getSymbolAtLocation(node);
    if (symbol === undefined || seen.has(symbol)) return "unknown";
    seen.add(symbol);
    const declaration = symbol.declarations?.find(item => ts.isVariableDeclaration(item) || ts.isParameter(item));
    if (declaration !== undefined && (ts.isVariableDeclaration(declaration) || ts.isParameter(declaration))) {
      if (declaration.type !== undefined) return type_family(declaration.type, checker);
      if (ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined) return expression_family(declaration.initializer, checker, seen);
    }
  }
  const type = checker.getTypeAtLocation(node);
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never)) return "unknown";
  if (type.flags & ts.TypeFlags.NumberLike) return "number";
  if (type.flags & ts.TypeFlags.BooleanLike) return "boolean";
  if (type.flags & ts.TypeFlags.Null) return "null";
  if (type.flags & ts.TypeFlags.StringLike) return "string";
  if (type.flags & ts.TypeFlags.Object) return "object";
  return "unknown";
}
