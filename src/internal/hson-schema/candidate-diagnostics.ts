import type ts from "typescript";
import { discover_hson_schema_declarations } from "./schema-discovery.js";
import { compile_hson_schema, type CompiledHsonSchema } from "./compiler.js";
import { is_official_hson_package_binding, read_supported_hson_import_symbols } from "../embedded-hson/discover-hson-tagged-templates.js";
import { evaluate_static_schema_candidate, type StaticSchemaCandidate } from "./candidate-evaluation.js";
import { resolve_immutable_schema } from "./schema-identity.js";
import type { CanonicalGraphIssue } from "../canonical-schema/issues.js";
import { library_schema_attachment_plan, type PreciseSchemaFact } from "./source-transformation.js";
import { resolve_hson_schema_annotation } from "./schema-annotation.js";

export type StaticSchemaDiagnostic = Readonly<{ file: string; start: number; end: number; code: string; message: string }>;
type Schema = Readonly<{ declaration: ts.VariableDeclaration; name: string; compiled: CompiledHsonSchema }>;
type Candidate = StaticSchemaCandidate & Readonly<{ node: ts.Expression; bodyStart?: number }>;

/** Pure preflight over authored ASTs. Unknown expressions withdraw the entire proof. */
export function static_schema_candidate_diagnostics(typescript: typeof ts, program: ts.Program): readonly StaticSchemaDiagnostic[] {
  const checker = program.getTypeChecker();
  const schemas = new Map<ts.Declaration, Schema>();
  const sources = program.getSourceFiles().filter(source => !source.isDeclarationFile && !program.isSourceFileFromExternalLibrary(source)
    && !source.fileName.replaceAll("\\", "/").split("/").includes(".hson"));
  for (const source of sources) for (const found of discover_hson_schema_declarations(typescript, source, checker)) {
    if (!found.eligible || !typescript.isNoSubstitutionTemplateLiteral(found.tagged.template)) continue;
    const compiled = compile_hson_schema(found.tagged.template.getText(source).slice(1, -1));
    if (compiled.ok) schemas.set(found.declaration, { declaration: found.declaration, name: found.name, compiled: compiled.value });
  }
  const declaration = (node: ts.Identifier): ts.VariableDeclaration | undefined => {
    let symbol = typescript.isShorthandPropertyAssignment(node.parent) ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node);
    if (symbol !== undefined && (symbol.flags & typescript.SymbolFlags.Alias) !== 0) symbol = checker.getAliasedSymbol(symbol);
    if (symbol?.declarations?.length !== 1) return undefined;
    const found = symbol.declarations[0];
    return found !== undefined && typescript.isVariableDeclaration(found) && typescript.isIdentifier(found.name)
      && typescript.isVariableDeclarationList(found.parent) && (found.parent.flags & typescript.NodeFlags.Const) !== 0 ? found : undefined;
  };
  const unwrap = (node: ts.Expression): ts.Expression => typescript.isParenthesizedExpression(node) || typescript.isAsExpression(node) || typescript.isSatisfiesExpression(node)
    ? unwrap(node.expression) : node;
  const schema = (input: ts.Expression): Schema | undefined => resolve_immutable_schema(typescript, checker, input, found => schemas.get(found));
  const candidates = (input: ts.Expression, family: "certify" | "document" | "data", seen = new Set<ts.Declaration>(), depth = 0): readonly Candidate[] | undefined => {
    if (depth > 16) return undefined;
    const node = unwrap(input);
    if (typescript.isIdentifier(node)) {
      const found = declaration(node);
      if (found === undefined || found.initializer === undefined || seen.has(found)) return undefined;
      // Nonprimitive JSON (including alternatives) is known only at its sole use.
      const initial = unwrap(found.initializer);
      const primitive = typescript.isStringLiteral(initial) || typescript.isNoSubstitutionTemplateLiteral(initial)
        || typescript.isNumericLiteral(initial) || typescript.isPrefixUnaryExpression(initial)
        || [typescript.SyntaxKind.TrueKeyword, typescript.SyntaxKind.FalseKeyword, typescript.SyntaxKind.NullKeyword].includes(initial.kind);
      if (family === "data" && !primitive) {
        if (found.getSourceFile() !== node.getSourceFile() || found.getEnd() >= node.getStart()) return undefined;
        let uncertain = false;
        const references = (entry: ts.Node): void => {
          if (typescript.isIdentifier(entry) && entry !== found.name && entry !== node && declaration(entry) === found) uncertain = true;
          typescript.forEachChild(entry, references);
        };
        references(node.getSourceFile());
        if (uncertain) return undefined;
      }
      const next = new Set(seen); next.add(found);
      return candidates(found.initializer, family, next, depth + 1);
    }
    if (typescript.isConditionalExpression(node)) {
      const left = candidates(node.whenTrue, family, new Set(seen), depth + 1);
      const right = candidates(node.whenFalse, family, new Set(seen), depth + 1);
      return left === undefined || right === undefined || left.length + right.length > 16 ? undefined : [...left, ...right];
    }
    if (family !== "data" && typescript.isTaggedTemplateExpression(node) && typescript.isPropertyAccessExpression(node.tag)
      && typescript.isIdentifier(node.tag.expression) && is_official_hson_package_binding(node.tag.expression, "Hson", checker, true)
      && ["document", "data", "canonical"].includes(node.tag.name.text)
      && typescript.isNoSubstitutionTemplateLiteral(node.template) && !node.template.isUnterminated) {
      return [{ node, source: node.template.getText(node.getSourceFile()).slice(1, -1), family: node.tag.name.text === "document" ? "document" : node.tag.name.text === "canonical" ? "canonical" : "data", bodyStart: node.template.getStart() + 1 }];
    }
    if (family === "document" && (typescript.isStringLiteral(node) || typescript.isNoSubstitutionTemplateLiteral(node))) {
      // Escaped JS strings have no direct raw-Hson correspondence; anchor on the expression.
      return [{ node, source: node.text, family: "document", bodyStart: -1 }];
    }
    if (family === "data") {
      const value = json_literal(node, typescript);
      if (!value.known) return undefined;
      if (typeof value.value === "string") {
        try { return [{ node, json: JSON.parse(value.value) }]; } catch { return undefined; }
      }
      return [{ node, json: value.value }];
    }
    return undefined;
  };
  const output: StaticSchemaDiagnostic[] = [];
  const reported = new Set<string>();
  const report = (contract: Schema | undefined, input: ts.Expression, family: "certify" | "document" | "data"): void => {
    if (contract === undefined) return;
    const possible = candidates(input, family);
    if (possible === undefined || possible.length === 0) return;
    const failures = possible.map(candidate => evaluate_static_schema_candidate(contract.compiled, candidate));
    // A valid branch, opaque branch or malformed Hson belongs to runtime/authoring diagnostics.
    if (failures.some(failure => failure.kind !== "invalid")) return;
    const first = failures[0];
    if (first?.kind !== "invalid") return;
    const candidate = possible[0]!;
    const local = possible.length === 1 && candidate.node.getSourceFile() === input.getSourceFile();
    const node = local ? candidate.node : input;
    const range = local && "source" in candidate && candidate.bodyStart !== undefined && candidate.bodyStart >= 0 && first.range !== undefined
      ? { start: candidate.bodyStart + first.range.start, end: candidate.bodyStart + first.range.end }
      : { start: node.getStart(), end: node.getEnd() };
    // Key the underlying proof, not its wording or chosen display anchor.
    const identity = (entry: ts.Node) => [entry.getSourceFile().fileName, entry.getStart(), entry.getEnd()];
    const key = JSON.stringify([identity(contract.declaration), possible.map(entry => identity(entry.node)),
      first.issue.code, first.issue.schemaNode, first.issue.path, first.issue.attributeName, first.issue.evidence]);
    if (reported.has(key)) return;
    reported.add(key);
    output.push({ file: node.getSourceFile().fileName, ...range, code: first.issue.code,
      message: `Static Hson does not satisfy ${contract.name}: ${issue_detail(first.issue)}${possible.length > 1 ? " (all static alternatives fail)." : "."}` });
  };
  for (const source of sources) {
    const mapSymbols = read_supported_hson_import_symbols(source, checker, [], "hsonLiveMap");
    const construction = (node: ts.Expression): ts.ObjectLiteralExpression | undefined => {
      if (!typescript.isCallExpression(node) || node.arguments.length !== 1 || !typescript.isPropertyAccessExpression(node.expression)
        || node.expression.name.text !== "fromLibraries" || !typescript.isIdentifier(node.expression.expression)) return undefined;
      const symbol = checker.getSymbolAtLocation(node.expression.expression);
      return symbol !== undefined && mapSymbols.has(symbol) && typescript.isObjectLiteralExpression(node.arguments[0]!) ? node.arguments[0] : undefined;
    };
    const validateDefinition = (definition: ts.Expression, attached?: Schema): void => {
      if (!typescript.isObjectLiteralExpression(definition)) return;
      const fields = object_fields(definition, typescript);
      if (fields === undefined) return;
      const document = fields.get("document"), data = fields.get("data");
      const contract = attached ?? (fields.get("schema") === undefined ? undefined : schema(fields.get("schema")!));
      if (document !== undefined && data === undefined) report(contract, document, "document");
      if (data !== undefined && document === undefined) report(contract, data, "data");
    };
    const facts: PreciseSchemaFact[] = [...schemas].map(([declaration, contract]) => ({ declaration,
      mode: contract.compiled.semantic.kind === "document" || contract.compiled.semantic.kind === "document-element" ? "document" : "data" }));
    for (const attachment of library_schema_attachment_plan(source, checker, facts).attachments) {
      const found = declaration(attachment.map);
      const owner = attachment.statement.parent;
      if (found === undefined || found.initializer === undefined || !typescript.isVariableDeclarationList(found.parent)
        || !typescript.isVariableStatement(found.parent.parent) || found.parent.declarations.length !== 1
        || (!typescript.isSourceFile(owner) && !typescript.isBlock(owner))) continue;
      const index = owner.statements.indexOf(attachment.statement);
      // No intervening statement, alias, mutation, callback or control-flow crossing.
      if (index < 1 || owner.statements[index - 1] !== found.parent.parent) continue;
      const initial = construction(found.initializer);
      const definition = initial === undefined ? undefined : object_fields(initial, typescript)?.get(attachment.library.text);
      if (definition !== undefined) validateDefinition(definition, schema(attachment.schema));
    }
    // Annotation relationships retain the direct, official, substitution-free
    // initializer boundary used to establish compiler/editor assignment proof.
    for (const statement of source.statements) {
      if (!typescript.isVariableStatement(statement) || (statement.declarationList.flags & typescript.NodeFlags.Const) === 0
        || statement.declarationList.declarations.length !== 1) continue;
      const found = statement.declarationList.declarations[0];
      if (found?.type === undefined || found.initializer === undefined) continue;
      const annotationNode = found.type;
      const annotation = resolve_hson_schema_annotation(typescript, checker, annotationNode);
      if (annotation === undefined) continue;
      const initializer = found.initializer;
      if (!typescript.isTaggedTemplateExpression(initializer) || !typescript.isPropertyAccessExpression(initializer.tag)
        || !["data", "document"].includes(initializer.tag.name.text) || !typescript.isIdentifier(initializer.tag.expression)
        || !is_official_hson_package_binding(initializer.tag.expression, "Hson", checker, true)
        || !typescript.isNoSubstitutionTemplateLiteral(initializer.template) || initializer.template.isUnterminated) continue;
      const contract = annotation.schema === undefined ? undefined : schema(annotation.schema);
      const annotationDiagnostic = (code: string, message: string): void => {
        output.push({ file: source.fileName, start: annotationNode.getStart(), end: annotationNode.getEnd(), code, message });
      };
      if (annotation.kind === "projected") {
        if (contract !== undefined && annotation.schema !== undefined && initializer.tag.name.text === "data") annotationDiagnostic("HSON_PROJECTED_VALUE_ANNOTATION",
          `This Hson.data template produces the Hson representation governed by ${contract.name}, but the annotation describes its JSON/JS value representation. For Hson source, use HsonFromSchema<typeof ${annotation.schema.text}>.`);
        continue;
      }
      if (annotation.kind !== "hson" && initializer.tag.name.text !== annotation.kind) continue;
      if (contract === undefined) {
        annotationDiagnostic("HSON_SCHEMA_PROOF_UNRESOLVED", `Unable to resolve the Schema proof for this ${annotation.kind === "hson" ? "HsonFromSchema" : annotation.kind === "data" ? "HsonData" : "HsonDocument"} annotation; use typeof a statically known Hson.schema binding.`);
        continue;
      }
      report(contract, initializer, "certify");
    }
    const visit = (node: ts.Node): void => {
      if (typescript.isCallExpression(node) && typescript.isPropertyAccessExpression(node.expression)) {
        if (node.expression.name.text === "certify" && node.arguments.length === 1) report(schema(node.expression.expression), node.arguments[0]!, "certify");
        const definitions = construction(node);
        if (definitions !== undefined) for (const definition of object_fields(definitions, typescript)?.values() ?? []) validateDefinition(definition);
      }
      typescript.forEachChild(node, visit);
    };
    visit(source);
  }
  return output;
}

function issue_detail(issue: CanonicalGraphIssue): string {
  const description = issue.code === "MISSING_REQUIRED" ? "missing required child/value" : issue.evidence.kind === "document-tag-mismatch" ? "wrong tag" : issue.code.replaceAll("_", " ").toLowerCase();
  return `${description} at ${issue.path.join(".") || "root"}${issue.expected === undefined ? "" : `; expected ${issue.expected}`}${issue.received === undefined ? "" : `; received ${issue.received}`}`;
}

function object_fields(node: ts.ObjectLiteralExpression, typescript: typeof ts): Map<string, ts.Expression> | undefined {
  const fields = new Map<string, ts.Expression>();
  for (const property of node.properties) {
    if ((!typescript.isPropertyAssignment(property) && !typescript.isShorthandPropertyAssignment(property))
      || (!typescript.isIdentifier(property.name) && !typescript.isStringLiteral(property.name))) return undefined;
    const key = property.name.text;
    if (fields.has(key) || typescript.isShorthandPropertyAssignment(property) && property.objectAssignmentInitializer !== undefined) return undefined;
    fields.set(key, typescript.isPropertyAssignment(property) ? property.initializer : property.name);
  }
  return fields;
}

type Literal = Readonly<{ known: true; value: unknown }> | Readonly<{ known: false }>;
/** JSON syntax only: no property reads, spreads, functions or application execution. */
function json_literal(node: ts.Expression, typescript: typeof ts): Literal {
  if (typescript.isStringLiteral(node) || typescript.isNoSubstitutionTemplateLiteral(node)) return { known: true, value: node.text };
  if (typescript.isNumericLiteral(node)) return { known: true, value: Number(node.text) };
  if (typescript.isPrefixUnaryExpression(node) && node.operator === typescript.SyntaxKind.MinusToken && typescript.isNumericLiteral(node.operand)) return { known: true, value: -Number(node.operand.text) };
  if (node.kind === typescript.SyntaxKind.TrueKeyword) return { known: true, value: true };
  if (node.kind === typescript.SyntaxKind.FalseKeyword) return { known: true, value: false };
  if (node.kind === typescript.SyntaxKind.NullKeyword) return { known: true, value: null };
  if (typescript.isArrayLiteralExpression(node)) {
    const entries = node.elements.map(entry => json_literal(entry, typescript));
    return entries.every(entry => entry.known) ? { known: true, value: entries.map(entry => entry.value) } : { known: false };
  }
  if (typescript.isObjectLiteralExpression(node)) {
    const fields = object_fields(node, typescript);
    if (fields === undefined) return { known: false };
    const value: Record<string, unknown> = Object.create(null);
    for (const [key, input] of fields) {
      const entry = json_literal(input, typescript);
      if (!entry.known || key === "__proto__") return { known: false };
      value[key] = entry.value;
    }
    return { known: true, value };
  }
  return { known: false };
}
