import type ts from "typescript";
import { compile_hson_schema, type CompiledHsonSchema } from "../../../src/internal/hson-schema/compiler.js";
import { evaluate_static_schema_candidate } from "../../../src/internal/hson-schema/candidate-evaluation.js";
import { resolve_immutable_schema } from "../../../src/internal/hson-schema/schema-identity.js";
import { is_official_hson_package_binding } from "../../../src/internal/embedded-hson/discover-hson-tagged-templates.js";
import { generate_hson_schema_evidence } from "../../../src/internal/hson-schema/generated-evidence.js";

export type VerifiedSchemaAssignmentRange = Readonly<{ start: number; end: number; failed?: true }>;
type SchemaAssociation = Readonly<{ declaration: ts.VariableDeclaration; compiled: CompiledHsonSchema; mode: "data" | "document" }>;

/** Facts safe for editor diagnostic filtering; this never changes TypeScript types. */
export function verified_schema_assignment_ranges(
  typescript: typeof ts,
  program: ts.Program,
  fileName: string,
  evidenceFile?: (producer: string, name: string) => string | undefined,
  includeFailures = false,
): readonly VerifiedSchemaAssignmentRange[] {
  const sourceFile = program.getSourceFile(fileName);
  if (sourceFile === undefined || sourceFile.isDeclarationFile) return Object.freeze([]);
  const checker = program.getTypeChecker();
  const output: VerifiedSchemaAssignmentRange[] = [];
  for (const statement of sourceFile.statements) {
    if (!typescript.isVariableStatement(statement) || (statement.declarationList.flags & typescript.NodeFlags.Const) === 0 || statement.declarationList.declarations.length !== 1) continue;
    const declaration = statement.declarationList.declarations[0];
    if (declaration === undefined || declaration.type === undefined || declaration.initializer === undefined || !typescript.isTypeReferenceNode(declaration.type) || !typescript.isIdentifier(declaration.type.typeName)) continue;
    const mode = declaration.type.typeName.text === "HsonData" ? "data" : declaration.type.typeName.text === "HsonDocument" ? "document" : undefined;
    if (mode === undefined || !official_binding(typescript, checker, declaration.type.typeName, mode === "data" ? "HsonData" : "HsonDocument") || declaration.type.typeArguments?.length !== 1) continue;
    const schemaQuery = declaration.type.typeArguments[0];
    if (schemaQuery === undefined || !typescript.isTypeQueryNode(schemaQuery) || !typescript.isIdentifier(schemaQuery.exprName)) continue;
    const association = resolve_schema_association(typescript, program, checker, schemaQuery.exprName, evidenceFile);
    if (association === undefined || association.mode !== mode) continue;
    const evaluated = evaluated_initializer(typescript, checker, sourceFile, declaration.initializer, association);
    if (evaluated === undefined || evaluated.kind === "unknown" || evaluated.kind === "invalid" && !includeFailures) continue;
    output.push(Object.freeze({ start: declaration.name.getStart(sourceFile), end: declaration.name.getEnd(), ...(evaluated.kind === "invalid" ? { failed: true as const } : {}) }));
  }
  return Object.freeze(output);
}

export function filter_verified_schema_assignment_diagnostics(
  diagnostics: readonly ts.Diagnostic[],
  ranges: readonly VerifiedSchemaAssignmentRange[],
): readonly ts.Diagnostic[] {
  return diagnostics.filter((diagnostic) => {
    const start = diagnostic.start;
    return diagnostic.code !== 2322 || start === undefined || !ranges.some((range) => start >= range.start && start < range.end && (range.failed !== true || redundant_brand_error(diagnostic.messageText)));
  });
}

function resolve_schema_association(
  typescript: typeof ts,
  program: ts.Program,
  checker: ts.TypeChecker,
  identifier: ts.Identifier,
  evidenceFile?: (producer: string, name: string) => string | undefined,
): SchemaAssociation | undefined {
  return resolve_immutable_schema(typescript, checker, identifier, declaration => {
    if (!typescript.isIdentifier(declaration.name) || declaration.initializer === undefined) return undefined;
    const producer = declaration.getSourceFile();
    const tagged = unwrap_tagged_schema(typescript, declaration.initializer);
    if (tagged === undefined || !is_official_member_tag(typescript, checker, tagged, "schema") || !typescript.isNoSubstitutionTemplateLiteral(tagged.template)) return undefined;
    const source = raw_template(tagged.template, producer);
    const compiled = compile_hson_schema(source);
    if (!compiled.ok) return undefined;
    const expected = generate_hson_schema_evidence(declaration.name.text, source, "editor-assignment").declaration;
    const artifactPath = evidenceFile?.(producer.fileName, declaration.name.text);
    if (artifactPath === undefined) return undefined;
    const artifact = program.getSourceFile(artifactPath);
    if (artifact?.text !== expected) return undefined;
    const mode = compiled.value.semantic.kind === "document" || compiled.value.semantic.kind === "document-element" ? "document" : "data";
    return Object.freeze({ declaration, compiled: compiled.value, mode });
  });
}

function evaluated_initializer(
  typescript: typeof ts,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  initializer: ts.Expression,
  association: SchemaAssociation,
) {
  if (!typescript.isTaggedTemplateExpression(initializer) || !is_official_member_tag(typescript, checker, initializer, association.mode)
    || !typescript.isNoSubstitutionTemplateLiteral(initializer.template) || initializer.template.isUnterminated) return undefined;
  return evaluate_static_schema_candidate(association.compiled, { source: raw_template(initializer.template, sourceFile), family: association.mode });
}

/** Suppress only incompatibility through the Schema proof, never other properties. */
function redundant_brand_error(message: string | ts.DiagnosticMessageChain): boolean {
  if (typeof message === "string") return false;
  if (message.code === 2326 && message.messageText === "Types of property '[HSON_SCHEMA_PROOF]' are incompatible.") return true;
  return message.next !== undefined && message.next.length > 0 && message.next.every(redundant_brand_error);
}

function unwrap_tagged_schema(typescript: typeof ts, node: ts.Expression): ts.TaggedTemplateExpression | undefined {
  if (typescript.isTaggedTemplateExpression(node)) return node;
  if (typescript.isAsExpression(node) || typescript.isParenthesizedExpression(node)) return unwrap_tagged_schema(typescript, node.expression);
  return undefined;
}

function is_official_member_tag(typescript: typeof ts, checker: ts.TypeChecker, tagged: ts.TaggedTemplateExpression, member: string): boolean {
  return typescript.isPropertyAccessExpression(tagged.tag)
    && tagged.tag.name.text === member
    && typescript.isIdentifier(tagged.tag.expression)
    && official_binding(typescript, checker, tagged.tag.expression, "Hson");
}

function official_binding(_typescript: typeof ts, checker: ts.TypeChecker, identifier: ts.Identifier, expected: "Hson" | "HsonData" | "HsonDocument"): boolean {
  return is_official_hson_package_binding(identifier, expected, checker, true);
}

function raw_template(node: ts.NoSubstitutionTemplateLiteral, sourceFile: ts.SourceFile): string {
  const text = node.getText(sourceFile);
  return text.slice(1, -1);
}
