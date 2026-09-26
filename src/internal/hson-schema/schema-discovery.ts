import type ts from "typescript";
import { is_official_hson_package_binding } from "../embedded-hson/discover-hson-tagged-templates.js";
import { unwrap_tagged_schema } from "./source-transformation.js";

export type DiscoveredHsonSchemaDeclaration = Readonly<{
  sourceFile: ts.SourceFile;
  statement: ts.VariableStatement;
  declaration: ts.VariableDeclaration;
  tagged: ts.TaggedTemplateExpression;
  name: string;
  ambiguous: boolean;
  complete: boolean;
  eligible: boolean;
}>;

/**
 * Shared declaration identity and ambiguity policy for compiler projects and
 * live editor views. Parsing/compilation remains a caller concern, but only an
 * eligible declaration may own generated precise evidence.
 */
export function discover_hson_schema_declarations(
  typescript: typeof ts,
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
): readonly DiscoveredHsonSchemaDeclaration[] {
  const counts = new Map<string, number>();
  for (const statement of sourceFile.statements) {
    if (!typescript.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (typescript.isIdentifier(declaration.name)) {
        counts.set(declaration.name.text, (counts.get(declaration.name.text) ?? 0) + 1);
      }
    }
  }
  const output: DiscoveredHsonSchemaDeclaration[] = [];
  for (const statement of sourceFile.statements) {
    if (!typescript.isVariableStatement(statement)
      || (statement.declarationList.flags & typescript.NodeFlags.Const) === 0
      || statement.declarationList.declarations.length !== 1) continue;
    const declaration = statement.declarationList.declarations[0];
    if (declaration === undefined || !typescript.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
    const tagged = unwrap_tagged_schema(declaration.initializer);
    if (tagged === undefined || !typescript.isPropertyAccessExpression(tagged.tag) || tagged.tag.name.text !== "schema"
      || !typescript.isIdentifier(tagged.tag.expression)
      || !is_official_hson_package_binding(tagged.tag.expression, "Hson", checker, true)) continue;
    const ambiguous = (counts.get(declaration.name.text) ?? 0) > 1;
    const complete = typescript.isNoSubstitutionTemplateLiteral(tagged.template) && !tagged.template.isUnterminated;
    output.push(Object.freeze({
      sourceFile, statement, declaration, tagged, name: declaration.name.text,
      ambiguous, complete, eligible: !ambiguous && complete,
    }));
  }
  return Object.freeze(output);
}
