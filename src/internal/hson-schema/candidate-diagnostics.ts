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
import { static_part_inventory, type PartSourceFacts, type PartSourceLocation } from "./part-source.js";
import { is_part_argument_attribute, part_argument_name, whole_part_reference } from "../part-placeholder.js";
import { qualify_hson_document_root } from "../../api/document/hson-document.js";
import { parse_authored_document_library } from "../../api/livemap/livemap.document.quad.js";
import { is_ordinary_element_node } from "../../core/node-guards.js";
import { admit_canonical_hson_data_value } from "../../api/data/hson-data-hson.js";

type StaticSchemaDiagnosticLocation = Readonly<{ file: string; start: number; end: number; message: string }>;
export type StaticSchemaDiagnostic = StaticSchemaDiagnosticLocation & Readonly<{ code: string; related?: readonly StaticSchemaDiagnosticLocation[] }>;
type Schema = Readonly<{ declaration: ts.VariableDeclaration; name: string; compiled: CompiledHsonSchema }>;

/** Editor-only projection of compiler-owned facts. Never included in Schema build/Watch policy. */
export function static_part_reference_diagnostics(facts: PartSourceFacts): readonly StaticSchemaDiagnostic[] {
  const output: StaticSchemaDiagnostic[] = [];
  const reported = new Set<string>();
  const report = (where: PartSourceLocation | undefined, code: string, message: string): void => {
    if (where?.precision !== "exact") return;
    const key = JSON.stringify([where.file, where.start, where.end, code, message]);
    if (reported.has(key)) return;
    reported.add(key);
    output.push({ file: where.file, start: where.start, end: where.end, code, message });
  };
  for (const document of facts.documents) {
    // Grammar and declared-name conflicts are local facts; they require no receiver shape.
    const isDefinition = facts.batches.some(batch => batch.eligible && batch.libraries.some(library => library.family === "parts"
      && library.members.some(member => member.documents.includes(document))));
    for (const flag of document.partDeclarations) {
      if (flag.issue !== undefined) report(flag.location, "HSON_PART_DECLARATION_INVALID", flag.issue);
      else if (!isDefinition && document.receivers.some(receiver => receiver.certainty === "certain" && receiver.library?.family === "document")) {
        report(flag.location, "HSON_PART_DECLARATION_INVALID", "hson:part is only allowed on a governed Part definition root.");
      }
    }
    if (isDefinition && document.admission === "qualified" && document.librarySourceAdmission === "qualified" && document.partDeclarations.every(flag => !flag.root)) {
      report(document.definitionRoot, "HSON_PART_DECLARATION_MISSING", "Part definition root requires the hson:part flag.");
    }
    for (const flag of document.optionalStructures) {
      if (flag.issue !== undefined) report(flag.location, "HSON_PART_OPTIONAL_INVALID", flag.issue);
      else if (!isDefinition && document.receivers.some(receiver => receiver.certainty === "certain" && receiver.library?.family === "document")) {
        report(flag.location, "HSON_PART_OPTIONAL_INVALID", "part:optional is only allowed within a governed Part definition.");
      }
    }
    if (isDefinition) for (const issue of document.referenceIssues) report(issue.location, "HSON_PART_REFERENCE_INVALID", issue.message);
    if (document.admission === "qualified") for (const connector of document.connectors) {
      const supplied = new Set<string>();
      for (const attribute of connector.attributes.filter(attribute => is_part_argument_attribute(attribute.name))) {
        const argument = part_argument_name(attribute.name);
        if (argument === undefined) {
          report(attribute.nameLocation, "HSON_PART_ARGUMENT_INVALID", `Invalid Part argument ${JSON.stringify(attribute.name)}.`);
          continue;
        }
        if (supplied.has(argument.name)) report(attribute.nameLocation, "HSON_PART_ARGUMENT_CONFLICT", `Conflicting Part argument ${JSON.stringify(argument.name)}.`);
        supplied.add(argument.name);
        if (argument.kind !== "scalar" && attribute.value !== undefined && whole_part_reference(attribute.value) === undefined) {
          try {
            if (argument.kind === "data") admit_canonical_hson_data_value(attribute.value);
            else {
              const root = qualify_hson_document_root(parse_authored_document_library(attribute.value).root);
              if (root.$_content.length !== 1 || !is_ordinary_element_node(root.$_content[0])) throw new TypeError("Document input requires one authored element.");
            }
          }
          catch (cause) { report(attribute.valueLocation, argument.kind === "data" ? "HSON_PART_DATA_INVALID" : "HSON_PART_DOCUMENT_INVALID", `Invalid serialized ${argument.kind} for ${JSON.stringify(argument.name)}: ${String(cause)}`); }
        }
      }
    }
    // Possible, conditional, multiple and open-world receivers cannot prove absence.
    // Do not filter alternatives to turn an ambiguous relationship into a certain one.
    if (document.admission !== "qualified" || document.librarySourceAdmission !== "qualified" || document.receivers.length !== 1) continue;
    const receiver = document.receivers[0]!;
    // A stored Part can be composed after later admissions or governed writes.
    // Its collection relationship alone does not establish an initial execution context.
    if (receiver.certainty !== "certain" || receiver.library?.family !== "document") continue;
    const batch = facts.batches.find(batch => batch.call === receiver.batch);
    if (batch === undefined || !batch.eligible || batch.receivingInventory !== "candidate-only"
      || batch.inventoryCompleteness !== "complete" || batch.libraries.some(library => library.certainty !== "certain")) continue;
    for (const connector of document.connectors) {
      if (!connector.headerComplete || connector.location.precision !== "exact") continue;
      const coordinate = (name: string) => {
        const attributes = connector.attributes.filter(attribute => attribute.name === name);
        return attributes.length === 1 ? attributes[0] : undefined;
      };
      const lib = coordinate("lib"), at = coordinate("at");
      if (lib?.value === undefined || lib.value.length === 0 || at?.value === undefined
        || lib.valueLocation?.precision !== "exact" || at.valueLocation?.precision !== "exact") continue;
      const arguments_ = connector.attributes.filter(attribute => is_part_argument_attribute(attribute.name));
      // Unknown values include interpolations, placeholders and structured attributes.
      // Invalid local inputs were reported above; uncertainty still withholds absence claims.
      if (arguments_.some(attribute => attribute.value === undefined || part_argument_name(attribute.name) === undefined)) continue;
      const libraries = batch.libraries.filter(library => library.name === lib.value);
      if (libraries.length === 0 || libraries.length === 1 && libraries[0]!.family !== "parts") {
        report(lib.valueLocation, "HSON_PART_LIBRARY_UNKNOWN", `Unknown Parts Library ${JSON.stringify(lib.value)}.`);
        continue;
      }
      const library = libraries.length === 1 ? libraries[0] : undefined;
      if (library?.family !== "parts" || library.memberCompleteness !== "complete") continue;
      const members = library.members.filter(member => member.name === at.value);
      if (members.length === 0) {
        report(at.valueLocation, "HSON_PART_MEMBER_UNKNOWN", `Unknown Part member ${JSON.stringify(at.value)} in Parts Library ${JSON.stringify(lib.value)}.`);
        continue;
      }
      const member = members.length === 1 ? members[0] : undefined;
      if (member?.admission !== "qualified" || member.certainty !== "certain" || member.documents.length !== 1) continue;
      const definition = member.documents[0]!;
      if (definition.admission !== "qualified" || definition.parameterCompleteness !== "complete") continue;
      const supplied = new Set(arguments_.map(attribute => part_argument_name(attribute.name)!.name));
      const vocabulary = new Set(definition.parameters.map(parameter => parameter.name));
      const optionalRoot = definition.optionalStructures.some(flag => flag.root);
      for (const name of vocabulary) if (!supplied.has(name)
        && !(optionalRoot && !definition.receivingDeclarations.some(declaration => declaration.incoming === name && declaration.kind === "doc") && definition.parameters.find(parameter => parameter.name === name)?.uses.length === 0)) {
        report(connector.location, "HSON_PART_ARGUMENT_MISSING", `Missing Part parameter ${JSON.stringify(name)}.`);
      }
      for (const attribute of arguments_) {
        const argument = part_argument_name(attribute.name)!;
        if (!vocabulary.has(argument.name)) {
          report(attribute.nameLocation, "HSON_PART_ARGUMENT_UNKNOWN", `Unknown Part parameter ${JSON.stringify(attribute.name)}.`);
        } else if (argument.kind !== (definition.receivingDeclarations.find(declaration => declaration.incoming === argument.name)?.kind ?? "scalar")) {
          report(attribute.nameLocation, "HSON_PART_ARGUMENT_INVALID", `Part parameter ${JSON.stringify(argument.name)} does not match the receiving data interface.`);
        }
      }
    }
  }
  return output;
}

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
