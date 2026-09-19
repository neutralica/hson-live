import type ts from "typescript";
import { compile_hson_schema, HSON_SCHEMA_MVP_COMPATIBILITY_VERSION, type CompiledHsonSchema } from "../../../src/internal/hson-schema/compiler.js";
import { generate_hson_schema_types } from "../../../src/internal/hson-schema/generate-types.js";
import { evaluate_canonical_document_schema, evaluate_canonical_projected_schema } from "../../../src/internal/canonical-schema/evaluate.js";
import { parse_hson_with_provenance } from "../../../src/internal/hson-source-provenance/parse-hson-with-provenance.js";
import { projected_value_from_hson_node } from "../../../src/core/projected-value-graph.js";
import { is_official_hson_package_binding } from "../../../src/internal/embedded-hson/discover-hson-tagged-templates.js";
import { generate_hson_schema_evidence } from "../../../src/internal/hson-schema/generated-evidence.js";
import { local_hson_schema_declarations } from "./hson-schema-local.js";
import { dirname, relative, sep } from "node:path";
import { createHash } from "node:crypto";

export type VerifiedSchemaAssignmentRange = Readonly<{ start: number; end: number }>;
type SchemaAssociation = Readonly<{ declaration: ts.VariableDeclaration; compiled: CompiledHsonSchema; mode: "data" | "document" }>;

/** Keep the producer's generated assertion out of the live program while its evidence is stale. */
export function mask_stale_schema_producer_evidence(
  typescript: typeof ts,
  fileName: string,
  source: string,
  projectPath: string,
  readCurrentFile: (path: string) => string | undefined,
  compilerOptions?: ts.CompilerOptions,
): string {
  const records = new Map(local_hson_schema_declarations(source, fileName).map(record => [record.name, record]));
  const options = compilerOptions ?? (() => {
    const config = typescript.readConfigFile(projectPath, readCurrentFile);
    return config.error === undefined
      ? typescript.parseJsonConfigFileContent(config.config, typescript.sys, dirname(projectPath), undefined, projectPath).options
      : undefined;
  })();
  const host = options === undefined ? undefined : typescript.createCompilerHost({ ...options, noEmit: true, skipLibCheck: true }, true);
  if (host !== undefined) {
    host.fileExists = path => readCurrentFile(path) !== undefined;
    host.readFile = readCurrentFile;
    host.getSourceFile = (path, languageVersion) => {
      const contents = path === fileName ? source : readCurrentFile(path);
      return contents === undefined ? undefined : typescript.createSourceFile(path, contents, languageVersion, true);
    };
  }
  const program = host === undefined ? undefined : typescript.createProgram([fileName], { ...options, noEmit: true, skipLibCheck: true }, host);
  const file = program?.getSourceFile(fileName) ?? typescript.createSourceFile(fileName, source, typescript.ScriptTarget.Latest, true);
  const checker = program?.getTypeChecker();
  const edits: { start: number; end: number }[] = [];
  for (const statement of file.statements) {
    if (!typescript.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!typescript.isIdentifier(declaration.name)) continue;
      const recordType = declaration.type;
      if (recordType === undefined || !typescript.isTypeReferenceNode(recordType) || !typescript.isIdentifier(recordType.typeName)
        || recordType.typeName.text !== "__HsonSchema") continue;
      const record = records.get(declaration.name.text);
      const stem = fileName.replace(/\.[cm]?tsx?$/, "");
      const artifactPath = `${stem}.${declaration.name.text}.hson-schema.generated.ts`;
      const metadataPath = `${stem}.${declaration.name.text}.hson-schema.generated.json`;
      const identity = `${relative(dirname(projectPath), fileName).split(sep).join("/")}#${declaration.name.text}`;
      let current = false;
      if (record !== undefined && checker !== undefined) try {
        const initializer = declaration.initializer;
        const tagged = initializer === undefined ? undefined : unwrap_tagged_schema(typescript, initializer);
        if (tagged === undefined || !is_official_member_tag(typescript, checker, tagged, "schema")) throw new Error("Untrusted Hson binding.");
        const evidence = generate_hson_schema_evidence(record.name, record.template, identity);
        current = readCurrentFile(artifactPath) === evidence.declaration && readCurrentFile(metadataPath) === evidence.metadata;
      } catch { /* Invalid or incomplete live Schema text has no proof. */ }
      if (current) continue;
      edits.push({ start: recordType.getStart(file), end: recordType.getEnd() });
      const visit = (node: ts.Node): void => {
        if (typescript.isAsExpression(node) && typescript.isTypeReferenceNode(node.type)
          && typescript.isIdentifier(node.type.typeName) && node.type.typeName.text === "__HsonSchema") {
          edits.push({ start: node.type.getStart(file), end: node.type.getEnd() });
        }
        typescript.forEachChild(node, visit);
      };
      if (declaration.initializer !== undefined) visit(declaration.initializer);
    }
  }
  let masked = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    const replacement = "__HsonSchema".padEnd(edit.end - edit.start, " ");
    masked = masked.slice(0, edit.start) + replacement + masked.slice(edit.end);
  }
  return masked;
}

/** Install a source-length-preserving producer overlay for the live TypeScript program. */
export function install_live_schema_proof_mask(
  typescript: typeof ts,
  host: ts.LanguageServiceHost,
  projectPath: string,
): void {
  const originalSnapshot = host.getScriptSnapshot.bind(host);
  const originalVersion = host.getScriptVersion.bind(host);
  const currentText = (path: string): string | undefined => {
    const snapshot = originalSnapshot(path);
    return snapshot === undefined ? typescript.sys.readFile(path) : snapshot.getText(0, snapshot.getLength());
  };
  const effectiveText = (fileName: string): string | undefined => {
    const source = currentText(fileName);
    return source === undefined || !source.includes("__HsonSchema") ? source
      : mask_stale_schema_producer_evidence(typescript, fileName, source, projectPath, currentText, host.getCompilationSettings());
  };
  host.getScriptSnapshot = (fileName): ts.IScriptSnapshot | undefined => {
    const original = originalSnapshot(fileName);
    if (original === undefined) return undefined;
    const source = original.getText(0, original.getLength());
    if (!source.includes("__HsonSchema")) return original;
    const masked = effectiveText(fileName);
    return masked === undefined || masked === source ? original : typescript.ScriptSnapshot.fromString(masked);
  };
  host.getScriptVersion = (fileName): string => {
    const base = originalVersion(fileName);
    const source = currentText(fileName);
    if (source === undefined || !source.includes("__HsonSchema")) return base;
    const effective = effectiveText(fileName);
    return `${base}:hson-proof:${createHash("sha256").update(effective ?? "").digest("hex")}`;
  };
}

/** Facts safe for editor diagnostic filtering; this never changes TypeScript types. */
export function verified_schema_assignment_ranges(
  typescript: typeof ts,
  program: ts.Program,
  fileName: string,
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
    const association = resolve_schema_association(typescript, program, checker, schemaQuery.exprName);
    if (association === undefined || association.mode !== mode || !verified_initializer(typescript, checker, sourceFile, declaration.initializer, association)) continue;
    output.push(Object.freeze({ start: declaration.name.getStart(sourceFile), end: declaration.name.getEnd() }));
  }
  return Object.freeze(output);
}

export function filter_verified_schema_assignment_diagnostics(
  diagnostics: readonly ts.Diagnostic[],
  ranges: readonly VerifiedSchemaAssignmentRange[],
): readonly ts.Diagnostic[] {
  return diagnostics.filter((diagnostic) => {
    const start = diagnostic.start;
    return diagnostic.code !== 2322 || start === undefined || !ranges.some((range) => start >= range.start && start < range.end);
  });
}

function resolve_schema_association(
  typescript: typeof ts,
  program: ts.Program,
  checker: ts.TypeChecker,
  identifier: ts.Identifier,
): SchemaAssociation | undefined {
  let symbol = checker.getSymbolAtLocation(identifier);
  if (symbol !== undefined && (symbol.flags & typescript.SymbolFlags.Alias) !== 0) symbol = checker.getAliasedSymbol(symbol);
  const declarations = (symbol?.declarations ?? []).filter(typescript.isVariableDeclaration);
  if (declarations.length !== 1) return undefined;
  const declaration = declarations[0];
  if (declaration === undefined || !typescript.isIdentifier(declaration.name) || declaration.initializer === undefined) return undefined;
  const producer = declaration.getSourceFile();
  const tagged = unwrap_tagged_schema(typescript, declaration.initializer);
  if (tagged === undefined || !is_official_member_tag(typescript, checker, tagged, "schema") || !typescript.isNoSubstitutionTemplateLiteral(tagged.template)) return undefined;
  const source = raw_template(tagged.template, producer);
  const compiled = compile_hson_schema(source);
  if (!compiled.ok) return undefined;
  const generated = generate_hson_schema_types(declaration.name.text, compiled.value.semantic, compiled.value.definitions);
  const generatedImports = [
    ...(generated.declarations.includes("HsonNumber") ? ["HsonNumber"] : []),
    ...(generated.declarations.includes("HsonSchemaMutationCandidate") ? ["HsonSchemaMutationCandidate"] : []),
  ];
  const generatedImport = generatedImports.length === 0 ? "" : `import type { ${generatedImports.join(", ")} } from "hson-live";\n`;
  const generatedJsonValueImport = generated.declarations.includes("JsonValue") ? 'import type { JsonValue } from "hson-live/hson";\n' : "";
  const expected = `/* Generated by Hson Schema ${HSON_SCHEMA_MVP_COMPATIBILITY_VERSION}. Do not edit. */\n${generatedImport}${generatedJsonValueImport}${generated.declarations}\n`;
  const artifactPath = `${producer.fileName.replace(/\.[cm]?ts$/, "")}.${declaration.name.text}.hson-schema.generated.ts`;
  const artifact = program.getSourceFile(artifactPath);
  if (artifact?.text !== expected) return undefined;
  const mode = compiled.value.semantic.kind === "document" || compiled.value.semantic.kind === "document-element" ? "document" : "data";
  return Object.freeze({ declaration, compiled: compiled.value, mode });
}

function verified_initializer(
  typescript: typeof ts,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  initializer: ts.Expression,
  association: SchemaAssociation,
): boolean {
  if (!typescript.isTaggedTemplateExpression(initializer) || !is_official_member_tag(typescript, checker, initializer, association.mode) || !typescript.isNoSubstitutionTemplateLiteral(initializer.template)) return false;
  try {
    const parsed = parse_hson_with_provenance(raw_template(initializer.template, sourceFile));
    const result = association.mode === "document"
      ? evaluate_canonical_document_schema(association.compiled.graph, parsed.value)
      : evaluate_canonical_projected_schema(association.compiled.graph, projected_value_from_hson_node(parsed.value));
    return result.ok;
  } catch { return false; }
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
