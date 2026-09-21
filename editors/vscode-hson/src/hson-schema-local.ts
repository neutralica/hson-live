import ts from "typescript";

import { compile_hson_schema } from "../../../src/internal/hson-schema/compiler.js";
import { admit_hson_source } from "../../../src/api/transform/hson-admission.js";
import { admit_canonical_hson_data_value } from "../../../src/api/data/hson-data-hson.js";
import { create_hson_source_program, discover_hson_tagged_templates } from "../../../src/internal/embedded-hson/discover-hson-tagged-templates.js";
import { read_embedded_hson_body } from "../../../src/internal/embedded-hson/embedded-hson-source.js";

export type LocalHsonSchemaDiagnostic = Readonly<{ start: number; end: number; code: string; message: string }>;
export type LocalHsonSchemaDeclaration = Readonly<{ name: string; start: number; end: number; template: string; templateStart: number; templateEnd: number }>;

type SchemaSyntax = Readonly<{
  declaration: ts.VariableDeclaration;
  template: ts.NoSubstitutionTemplateLiteral;
  sourceFile: ts.SourceFile;
}>;

/** Fast authoring feedback backed by the same pure compiler as the build analyzer. */
export function local_hson_schema_diagnostics(fileName: string, text: string): readonly LocalHsonSchemaDiagnostic[] {
  const diagnostics: LocalHsonSchemaDiagnostic[] = [];
  for (const source of discover_hson_tagged_templates(fileName, text).sources) {
    if (source.authoringKind !== "schema") continue;
    const sourceText = read_embedded_hson_body(source);
    try { admit_canonical_hson_data_value(admit_hson_source(sourceText)); }
    catch { continue; } // Base authoring diagnostics own invalid data syntax/context.
    const result = compile_hson_schema(sourceText);
    const templateStart = source.bodyRange.start;
    if (!result.ok) for (const issue of result.issues) diagnostics.push(Object.freeze({ start: templateStart + (issue.range?.start ?? 0), end: templateStart + (issue.range?.end ?? sourceText.length), code: issue.code, message: issue.message }));
  }
  return Object.freeze(diagnostics);
}

/** Binding-aware discovery only; generation and freshness remain shared tooling authority. */
export function local_hson_schema_declarations(text: string, fileName = "schema.ts"): readonly LocalHsonSchemaDeclaration[] {
  return Object.freeze(discover_schema_syntax(fileName, text).map(({ declaration, template, sourceFile }) => {
    const source = raw_template(template, sourceFile);
    const templateStart = template.getStart(sourceFile) + 1;
    return Object.freeze({
      name: (declaration.name as ts.Identifier).text,
      start: declaration.parent.parent.getStart(sourceFile),
      end: declaration.parent.parent.getEnd(),
      template: source,
      templateStart,
      templateEnd: templateStart + source.length,
    });
  }));
}

function discover_schema_syntax(fileName: string, text: string): readonly SchemaSyntax[] {
  if (!/\.[cm]?tsx?$/.test(fileName)) return Object.freeze([]);
  const program = create_hson_source_program(fileName, text);
  const sourceFile = program.getSourceFile(fileName);
  if (sourceFile === undefined) return Object.freeze([]);
  const checker = program.getTypeChecker();
  const hsonBindings = supported_import_symbols(sourceFile, checker, "Hson", false);
  const output: SchemaSyntax[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement) || (statement.declarationList.flags & ts.NodeFlags.Const) === 0 || statement.declarationList.declarations.length !== 1) continue;
    const declaration = statement.declarationList.declarations[0];
    if (declaration === undefined || !ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
    const initializer = unwrap_tagged_schema(declaration.initializer);
    if (initializer === undefined || !ts.isPropertyAccessExpression(initializer.tag) || initializer.tag.name.text !== "schema" || !ts.isIdentifier(initializer.tag.expression) || !ts.isNoSubstitutionTemplateLiteral(initializer.template)) continue;
    const tagSymbol = checker.getSymbolAtLocation(initializer.tag.expression);
    if (tagSymbol === undefined || !hsonBindings.has(tagSymbol)) continue;
    output.push(Object.freeze({ declaration, template: initializer.template, sourceFile }));
  }
  return Object.freeze(output);
}

function unwrap_tagged_schema(node: ts.Expression): ts.TaggedTemplateExpression | undefined {
  if (ts.isTaggedTemplateExpression(node)) return node;
  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node)) return unwrap_tagged_schema(node.expression);
  return undefined;
}

function supported_import_symbols(sourceFile: ts.SourceFile, checker: ts.TypeChecker, importedName: "Hson", allowTypeOnly: boolean): ReadonlySet<ts.Symbol> {
  const output = new Set<ts.Symbol>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || statement.importClause === undefined || !ts.isStringLiteral(statement.moduleSpecifier)
      || !["hson-live", "hson-live/hson"].includes(statement.moduleSpecifier.text)) continue;
    if (statement.importClause.isTypeOnly && !allowTypeOnly) continue;
    const bindings = statement.importClause.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if (!allowTypeOnly && element.isTypeOnly) continue;
      if ((element.propertyName?.text ?? element.name.text) !== importedName) continue;
      const symbol = checker.getSymbolAtLocation(element.name);
      if (symbol !== undefined) output.add(symbol);
    }
  }
  return output;
}

function raw_template(node: ts.NoSubstitutionTemplateLiteral, sourceFile: ts.SourceFile): string {
  const source = node.getText(sourceFile);
  return source.slice(1, -1);
}
