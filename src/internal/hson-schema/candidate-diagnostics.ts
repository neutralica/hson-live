import type ts from "typescript";
import { discover_hson_schema_declarations } from "./schema-discovery.js";
import { compile_hson_schema, type CompiledHsonSchema } from "./compiler.js";
import { is_official_hson_package_binding, read_supported_hson_import_symbols } from "../embedded-hson/discover-hson-tagged-templates.js";
import { parse_hson_with_provenance } from "../hson-source-provenance/parse-hson-with-provenance.js";
import { projected_value_from_hson_node } from "../../core/projected-value-graph.js";
import { evaluate_canonical_document_schema, evaluate_canonical_projected_schema } from "../canonical-schema/evaluate.js";
import { resolve_document_schema_issue_source } from "../document-schema-source-lowering/document-schema-source-lowering.js";
import { resolve_projected_schema_issue_source } from "../projected-schema-source-lowering/projected-schema-source-lowering.js";
import type { CanonicalGraphIssue } from "../canonical-schema/issues.js";
import { admit_projected_value } from "../../core/projected-value-admission.js";
import { library_schema_attachment_plan, type PreciseSchemaFact } from "./source-transformation.js";

export type StaticSchemaDiagnostic = Readonly<{ file: string; start: number; end: number; code: string; message: string }>;
type Schema = Readonly<{ name: string; compiled: CompiledHsonSchema }>;
type Candidate = Readonly<{ node: ts.Expression; source: string; bodyStart: number }> | Readonly<{ node: ts.Expression; json: unknown }>;

/** Pure preflight over authored ASTs. Unknown expressions withdraw the entire proof. */
export function static_schema_candidate_diagnostics(typescript: typeof ts, program: ts.Program): readonly StaticSchemaDiagnostic[] {
  const checker = program.getTypeChecker();
  const schemas = new Map<ts.Declaration, Schema>();
  const sources = program.getSourceFiles().filter(source => !source.isDeclarationFile && !program.isSourceFileFromExternalLibrary(source)
    && !source.fileName.replaceAll("\\", "/").split("/").includes(".hson"));
  for (const source of sources) for (const found of discover_hson_schema_declarations(typescript, source, checker)) {
    if (!found.eligible || !typescript.isNoSubstitutionTemplateLiteral(found.tagged.template)) continue;
    const compiled = compile_hson_schema(found.tagged.template.getText(source).slice(1, -1));
    if (compiled.ok) schemas.set(found.declaration, { name: found.name, compiled: compiled.value });
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
  const schema = (input: ts.Expression, seen = new Set<ts.Declaration>()): Schema | undefined => {
    const node = unwrap(input);
    if (!typescript.isIdentifier(node)) return undefined;
    const found = declaration(node);
    if (found === undefined || seen.has(found)) return undefined;
    const precise = schemas.get(found);
    if (precise !== undefined) return precise;
    seen.add(found);
    return found.initializer === undefined ? undefined : schema(found.initializer, seen);
  };
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
      return [{ node, source: node.template.getText(node.getSourceFile()).slice(1, -1), bodyStart: node.template.getStart() + 1 }];
    }
    if (family === "document" && (typescript.isStringLiteral(node) || typescript.isNoSubstitutionTemplateLiteral(node))) {
      // Escaped JS strings have no direct raw-Hson correspondence; anchor on the expression.
      return [{ node, source: node.text, bodyStart: -1 }];
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
  const report = (contract: Schema | undefined, input: ts.Expression, family: "certify" | "document" | "data"): void => {
    if (contract === undefined) return;
    const possible = candidates(input, family);
    if (possible === undefined || possible.length === 0) return;
    const failures = possible.map(candidate => candidate_failure(contract.compiled, candidate));
    // A valid branch, opaque branch or malformed Hson belongs to runtime/authoring diagnostics.
    if (failures.some(failure => failure === undefined)) return;
    const first = failures[0];
    if (first === undefined) return;
    const candidate = possible[0]!;
    const local = possible.length === 1 && candidate.node.getSourceFile() === input.getSourceFile();
    const node = local ? candidate.node : input;
    const range = local && "source" in candidate && candidate.bodyStart >= 0 && first.range !== undefined
      ? { start: candidate.bodyStart + first.range.start, end: candidate.bodyStart + first.range.end }
      : { start: node.getStart(), end: node.getEnd() };
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
  // Repeated relationships can point at the same immutable candidate.
  return [...new Map(output.map(diagnostic => [JSON.stringify(diagnostic), diagnostic])).values()];
}

/** The same canonical evaluator and provenance lowering as runtime/annotated checking. */
function candidate_failure(compiled: CompiledHsonSchema, candidate: Candidate) {
  try {
    const document = compiled.semantic.kind === "document" || compiled.semantic.kind === "document-element";
    const parsed = "source" in candidate ? parse_hson_with_provenance(candidate.source, { allowTopLevelDocumentText: document }) : undefined;
    const result = document && parsed !== undefined
      ? evaluate_canonical_document_schema(compiled.graph, parsed.value)
      : evaluate_canonical_projected_schema(compiled.graph, "json" in candidate ? admit_projected_value(candidate.json) : projected_value_from_hson_node(parsed!.value));
    const issue = result.ok ? undefined : result.issues[0];
    if (issue === undefined || issue.evidence.kind === "resource-limit" || issue.code === "INVALID_SCHEMA") return undefined;
    const resolution = parsed === undefined ? undefined : document
      ? resolve_document_schema_issue_source(parsed.value, "document", parsed.provenance, issue)
      : resolve_projected_schema_issue_source(parsed.value, parsed.provenance, issue);
    return { issue, range: resolution === undefined || resolution.kind === "unresolved" ? undefined : resolution.range };
  } catch { return undefined; }
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
