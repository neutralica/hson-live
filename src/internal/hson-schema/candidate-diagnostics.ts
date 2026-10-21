import type ts from "typescript";
import { discover_hson_schema_declarations } from "./schema-discovery.js";
import { compile_hson_schema, type CompiledHsonSchema } from "./compiler.js";
import { is_official_hson_package_binding, read_supported_hson_import_symbols } from "../embedded-hson/discover-hson-tagged-templates.js";
import { evaluate_static_schema_candidate } from "./candidate-evaluation.js";
import { resolve_immutable_schema } from "./schema-identity.js";
import type { CanonicalGraphIssue } from "../canonical-schema/issues.js";
import { library_schema_attachment_plan, type PreciseSchemaFact } from "./source-transformation.js";
import { resolve_hson_schema_annotation } from "./schema-annotation.js";
import { library_source_definitions, library_source_fields } from "./library-source.js";
import { static_source_candidates } from "./source-candidates.js";
import { static_part_inventory } from "./part-source.js";

type StaticSchemaDiagnosticLocation = Readonly<{ file: string; start: number; end: number; message: string }>;
export type StaticSchemaDiagnostic = StaticSchemaDiagnosticLocation & Readonly<{ code: string; related?: readonly StaticSchemaDiagnosticLocation[] }>;
type Schema = Readonly<{ declaration: ts.VariableDeclaration; name: string; compiled: CompiledHsonSchema }>;


/** Pure preflight over authored ASTs. Unknown expressions withdraw the entire proof. */
export function static_schema_candidate_diagnostics(typescript: typeof ts, program: ts.Program): readonly StaticSchemaDiagnostic[] {
  const checker = program.getTypeChecker();
  const schemas = new Map<ts.Declaration, Schema>();
  const sources = program.getSourceFiles().filter(source => !source.isDeclarationFile && !program.isSourceFileFromExternalLibrary(source)
    && !source.fileName.replaceAll("\\", "/").split("/").includes(".hson"));
  const sourceCandidates = static_source_candidates(typescript, checker, program);
  for (const source of sources) for (const found of discover_hson_schema_declarations(typescript, source, checker, sourceCandidates.eligible)) {
    if (!found.eligible || found.source === undefined) continue;
    const compiled = compile_hson_schema(found.source);
    if (compiled.ok) schemas.set(found.declaration, { declaration: found.declaration, name: found.name, compiled: compiled.value });
  }
  const { declaration, candidates } = sourceCandidates;
  const schema = (input: ts.Expression, use: "value" | "type-query" = "value"): Schema | undefined => resolve_immutable_schema(typescript, checker, input, found => schemas.get(found), new Set(), sourceCandidates.eligible, use);
  const output: StaticSchemaDiagnostic[] = [];
  const reported = new Set<string>();
  const report = (contract: Schema | undefined, input: ts.Expression, family: "certify" | "document" | "data", parts?: ReadonlyMap<string, unknown>): void => {
    if (contract === undefined) return;
    const possible = candidates(input, family);
    if (possible === undefined || possible.length === 0) return;
    const failures = possible.map(candidate => evaluate_static_schema_candidate(contract.compiled, candidate, parts));
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
      ...(possible.length === 1 && candidate.bodyStart !== undefined && candidate.bodyStart >= 0 && first.relatedRange !== undefined ? { related: [{
        file: candidate.node.getSourceFile().fileName, start: candidate.bodyStart + first.relatedRange.start, end: candidate.bodyStart + first.relatedRange.end,
        message: `Conflicting value at ${first.issue.evidence.relatedPath?.join(".")}; derived key ${first.issue.received}.`,
      }] } : {}),
      message: `Static Hson does not satisfy ${contract.name}: ${issue_detail(first.issue)}${possible.length > 1 ? " (all static alternatives fail)." : "."}` });
  };
  for (const source of sources) {
    const mapSymbols = read_supported_hson_import_symbols(source, checker, [], "hsonLiveMap", typescript);
    const construction = (node: ts.Expression) => sourceCandidates.eligible(node)
      ? library_source_definitions(node, checker, mapSymbols, false, typescript, sourceCandidates.eligible) : undefined;
    const inventory = (definitions: ts.ObjectLiteralExpression) => static_part_inventory(typescript, checker, definitions, sourceCandidates);
    const validateDefinition = (definition: ts.Expression, attached?: Schema, parts?: ReadonlyMap<string, unknown>): void => {
      if (!typescript.isObjectLiteralExpression(definition)) return;
      const fields = library_source_fields(definition, typescript);
      if (fields === undefined) return;
      const document = fields.get("document"), data = fields.get("data");
      const contract = attached ?? (fields.get("schema") === undefined ? undefined : schema(fields.get("schema")!));
      if (document !== undefined && data === undefined) report(contract, document, "document", parts);
      if (data !== undefined && document === undefined) report(contract, data, "data");
    };
    const facts: PreciseSchemaFact[] = [...schemas].map(([declaration, contract]) => ({ declaration,
      mode: contract.compiled.semantic.kind === "document" || contract.compiled.semantic.kind === "document-element" ? "document" : "data" }));
    for (const attachment of library_schema_attachment_plan(source, checker, facts, typescript).attachments) {
      const found = declaration(attachment.map);
      const owner = attachment.statement.parent;
      if (found === undefined || found.initializer === undefined || !typescript.isVariableDeclarationList(found.parent)
        || !typescript.isVariableStatement(found.parent.parent) || found.parent.declarations.length !== 1
        || (!typescript.isSourceFile(owner) && !typescript.isBlock(owner))) continue;
      const index = owner.statements.indexOf(attachment.statement);
      // No intervening statement, alias, mutation, callback or control-flow crossing.
      if (index < 1 || owner.statements[index - 1] !== found.parent.parent) continue;
      const initial = construction(found.initializer);
      const definition = initial === undefined ? undefined : library_source_fields(initial, typescript)?.get(attachment.library.text);
      if (definition !== undefined && initial !== undefined) validateDefinition(definition, schema(attachment.schema), inventory(initial));
    }
    // Annotation relationships retain the direct, official, substitution-free
    // initializer boundary used to establish compiler/editor assignment proof.
    for (const statement of source.statements) {
      if (!typescript.isVariableStatement(statement) || (statement.declarationList.flags & typescript.NodeFlags.Const) === 0
        || statement.declarationList.declarations.length !== 1) continue;
      const found = statement.declarationList.declarations[0];
      if (found?.type === undefined || found.initializer === undefined) continue;
      const annotationNode = found.type;
      const annotation = resolve_hson_schema_annotation(typescript, checker, annotationNode, sourceCandidates.eligible);
      if (annotation === undefined) continue;
      const initializer = found.initializer;
      if (!typescript.isTaggedTemplateExpression(initializer) || !typescript.isPropertyAccessExpression(initializer.tag)
        || !["data", "document"].includes(initializer.tag.name.text) || !typescript.isIdentifier(initializer.tag.expression)
        || !is_official_hson_package_binding(initializer.tag.expression, "Hson", checker, true, typescript, sourceCandidates.eligible)
        || !typescript.isNoSubstitutionTemplateLiteral(initializer.template) || initializer.template.isUnterminated) continue;
      const contract = annotation.schema === undefined ? undefined : schema(annotation.schema, "type-query");
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
      if (typescript.isCallExpression(node)) {
        if (typescript.isPropertyAccessExpression(node.expression) && node.expression.name.text === "certify" && node.arguments.length === 1) report(schema(node.expression.expression), node.arguments[0]!, "certify");
        const definitions = construction(node);
        if (definitions !== undefined) {
          const parts = inventory(definitions);
          for (const definition of library_source_fields(definitions, typescript)?.values() ?? []) validateDefinition(definition, undefined, parts);
        }
      }
      typescript.forEachChild(node, visit);
    };
    visit(source);
  }
  return output;
}

function issue_detail(issue: CanonicalGraphIssue): string {
  const description = issue.code === "MISSING_REQUIRED" ? "missing required child/value" : issue.evidence.kind === "document-tag-mismatch" ? "wrong tag" : issue.code.replaceAll("_", " ").toLowerCase();
  return `${description} at ${issue.path.join(".") || "root"}${issue.attributeName === undefined ? "" : ` attribute ${JSON.stringify(issue.attributeName)}`}${issue.expected === undefined ? "" : `; expected ${issue.expected}`}${issue.received === undefined ? "" : `; received ${issue.received}`}`;
}
