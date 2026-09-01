import ts from "typescript";

import { compile_hson_schema } from "../../../src/internal/hson-schema/compiler.js";
import { create_hson_source_program } from "../../../src/internal/embedded-hson/discover-hson-tagged-templates.js";

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
  for (const syntax of discover_schema_syntax(fileName, text)) {
    const sourceText = raw_template(syntax.template, syntax.sourceFile);
    const result = compile_hson_schema(sourceText);
    const templateStart = syntax.template.getStart(syntax.sourceFile) + 1;
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
  const schemaBindings = supported_import_symbols(sourceFile, checker, "HsonSchema", true);
  const hsonBindings = supported_import_symbols(sourceFile, checker, "Hson", false);
  const output: SchemaSyntax[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement) || (statement.declarationList.flags & ts.NodeFlags.Const) === 0 || statement.declarationList.declarations.length !== 1) continue;
    const declaration = statement.declarationList.declarations[0];
    if (declaration === undefined || !ts.isIdentifier(declaration.name) || !supported_schema_annotation(declaration.type, checker, schemaBindings)) continue;
    const initializer = declaration.initializer;
    if (initializer === undefined || !ts.isTaggedTemplateExpression(initializer) || !ts.isIdentifier(initializer.tag) || !ts.isNoSubstitutionTemplateLiteral(initializer.template)) continue;
    const tagSymbol = checker.getSymbolAtLocation(initializer.tag);
    if (tagSymbol === undefined || !hsonBindings.has(tagSymbol)) continue;
    output.push(Object.freeze({ declaration, template: initializer.template, sourceFile }));
  }
  return Object.freeze(output);
}

function supported_schema_annotation(node: ts.TypeNode | undefined, checker: ts.TypeChecker, bindings: ReadonlySet<ts.Symbol>): boolean {
  if (node === undefined || !ts.isTypeReferenceNode(node) || !ts.isIdentifier(node.typeName)) return false;
  const symbol = checker.getSymbolAtLocation(node.typeName);
  if (symbol === undefined || !bindings.has(symbol)) return false;
  const argumentsList = node.typeArguments ?? [];
  if (argumentsList.length === 0) return true;
  if (argumentsList.length !== 2) return false;
  const mode = argumentsList[1];
  return mode !== undefined && ts.isLiteralTypeNode(mode) && ts.isStringLiteral(mode.literal)
    && (mode.literal.text === "data" || mode.literal.text === "document");
}

function supported_import_symbols(sourceFile: ts.SourceFile, checker: ts.TypeChecker, importedName: "Hson" | "HsonSchema", allowTypeOnly: boolean): ReadonlySet<ts.Symbol> {
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
