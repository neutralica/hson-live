import type ts from "typescript";
import { hson_source_syntactic_eligibility, is_official_hson_package_binding } from "../embedded-hson/discover-hson-tagged-templates.js";
import { admit_hson_tagged_template } from "../embedded-hson/hson-tagged-source-admission.js";

export type DiscoveredHsonSchemaDeclaration = Readonly<{
  sourceFile: ts.SourceFile;
  statement: ts.VariableStatement;
  declaration: ts.VariableDeclaration;
  tagged: ts.TaggedTemplateExpression;
  name: string;
  ambiguous: boolean;
  complete: boolean;
  eligible: boolean;
  source?: string;
  admissionError?: string;
}>;

/**
 * Recognition remains available for diagnostics when admission fails. Only an
 * unambiguous producer admitted by the shared tag contract is proof-eligible;
 * callers must still compile its admitted source as a valid Schema definition.
 */
export function discover_hson_schema_declarations(
  typescript: typeof ts,
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  eligible = hson_source_syntactic_eligibility(typescript),
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
    const tagged = typescript.isTaggedTemplateExpression(declaration.initializer) ? declaration.initializer : undefined;
    if (tagged === undefined || !typescript.isPropertyAccessExpression(tagged.tag) || tagged.tag.name.text !== "schema"
      || !typescript.isIdentifier(tagged.tag.expression)
      || !is_official_hson_package_binding(tagged.tag.expression, "Hson", checker, true, typescript)) continue;
    const ambiguous = (counts.get(declaration.name.text) ?? 0) > 1;
    const complete = typescript.isNoSubstitutionTemplateLiteral(tagged.template) && !tagged.template.isUnterminated;
    let source: string | undefined;
    let admissionError: string | undefined;
    if (complete) {
      try { source = admit_hson_tagged_template(typescript, tagged, "schema"); }
      catch (error) { admissionError = error instanceof Error ? error.message : "Hson Schema tagged-template admission failed."; }
    }
    output.push(Object.freeze({
      sourceFile, statement, declaration, tagged, name: declaration.name.text,
      ambiguous, complete, eligible: !ambiguous && source !== undefined && eligible(declaration)
        && is_official_hson_package_binding(tagged.tag.expression, "Hson", checker, true, typescript, eligible),
      ...(source === undefined ? {} : { source }),
      ...(admissionError === undefined ? {} : { admissionError }),
    }));
  }
  return Object.freeze(output);
}
