import { part_scalar_operand } from "../part-scalar.js";
import { decode_part_string_sigils, part_literal_sigils } from "../part-scalar-source.js";
import { event_argument_references, parse_authored_event, standalone_event_reference_issue, type AuthoredEventArgument, type AuthoredEventReference } from "../authored-events.js";
import { parse_part_event, type PartEvent } from "../part-events.js";
import { is_event_attachment_attribute } from "../../core/authored-event-names.js";
import { read_transform_error_details } from "../../core/errors.js";
import { is_hson_bare_name_char } from "../../core/hson-name.js";
import { part_coordinates } from "../part-coordinates.js";
import { analyze_part_definition, transform_part_parameter_strings, type PartEventAlternative, type PartEventEvidence, type PartLocalDeclaration, type PartDefinitionAnalysis, type PartReferenceUse } from "../part-definition.js";
import type ts from "typescript";
import type { HsonNode } from "../../core/types.js";
import { is_Node, is_ordinary_element_node } from "../../core/node-guards.js";
import { hson_package_declaration_path, hson_source_alias_eligible, is_official_hson_package_binding, read_supported_hson_import_symbols } from "../embedded-hson/discover-hson-tagged-templates.js";
import { hson_tagged_source, admit_hson_tagged_source, admit_hson_tagged_template } from "../embedded-hson/hson-tagged-source-admission.js";
import { interpolation_site, map_interpolation_range, type GeneratedSegment } from "../trusted-schema-diagnostics/interpolation-source.js";
import { static_hson_literal_correspondence, map_static_hson_range } from "../embedded-hson/static-hson-source.js";
import type { HsonSourceLexicalCollector, HsonSourceRange } from "../hson-source-provenance/hson-source-provenance.js";
import { tokenize_authored_document_library, scan_hson_template_segments, hson_grammar_checkpoint, hson_interpolation_roles, type HsonTemplateSlot } from "../../api/transform/parsers/tokenize-hson.js";
import { split_attrs_meta } from "../../api/transform/utils/hson-utils/split-attrs-meta.js";
import { qualify_authored_document_source } from "../../api/document/hson-authored.js";
import { validate_part_collection } from "../../api/livemap/livemap.parts.js";
import { parse_authored_document_library } from "../../api/livemap/livemap.document.quad.js";
import { is_locus_document_action_name } from "../../api/locus/locus.document-actions.js";
import { admit_projected_value } from "../../core/projected-value-admission.js";
import { PART_DECLARATION, is_part_scalar_qualifier, type PartArgumentKind, type PartQualifier, part_declaration_issue, part_direction_issue, part_argument_name, PART_OPTIONAL, has_part_reference, part_optional_issue, is_part_iterator_attribute, part_iterator_declaration, is_part_receiving_attribute, part_receiving_declaration, part_placeholder_matches, whole_part_reference, part_placeholder_placement_issue, type PartIteratorDeclaration, type PartReference } from "../part-placeholder.js";
import { library_source_admission, library_source_field_candidates, library_source_fields, is_object_literal_prototype_setter, literal_member } from "./library-source.js";
import { static_source_candidates } from "./source-candidates.js";
import { annotated_data_schema_provenance, resolve_hson_schema_annotation } from "./schema-annotation.js";
import { evaluate_static_schema_candidate } from "./candidate-evaluation.js";
import { immutable_source_declaration, resolve_immutable_schema } from "./schema-identity.js";
import { discover_hson_schema_declarations, type DiscoveredHsonSchemaDeclaration } from "./schema-discovery.js";
import { compile_hson_schema, type CompiledHsonSchema } from "./compiler.js";
import { OBJECT_VALUE, type SchemaDataPath } from "./data-projection.js";
import { project_part_bindings, parse_part_binding_source, type PartBindingSources } from "../editor-introspection/part-bindings.js";

type Completeness = "complete" | "partial" | "unknown";
export type PartSourceLocation = HsonSourceRange & Readonly<{ file: string; precision: "exact" | "anchor" }>;
type PartReferenceIssueSource = { location: PartSourceLocation; message: string; declaration?: PartSourceLocation; attachment?: PartSourceLocation };
type EventSource = Readonly<{
  event: PartEvent;
  location: PartSourceLocation;
  map: SourceRangeMap;
  attachment?: PartSourceLocation;
  maybeAbsent?: ReadonlySet<AuthoredEventArgument>;
  definition?: PartDocumentSource;
  batch?: ts.CallExpression;
}>;
type SourceRangeMap = (range: HsonSourceRange) => PartSourceLocation | undefined;
type ActionContractSource = Readonly<{
  required?: PartSourceLocation;
  schema?: Readonly<{ value: CompiledHsonSchema; location: PartSourceLocation }>;
}>;
type EventContractSource = EventSource & Readonly<{ contract: ActionContractSource }>;
type EventIssueSource = PartReferenceIssueSource & Readonly<{ code: string }>;
type LocusActionSources = Readonly<{ actions: ReadonlyMap<string, ActionContractSource | undefined>; complete: boolean }>;
type LocusEventSources = Readonly<{
  owner: ts.CallExpression;
  operation: "create" | "resume" | "admit";
  initialActions: LocusActionSources;
  events: EventSource[];
  definitions: ts.Expression;
}>;
export type PartParameterSource = Readonly<{ name: string; uses: readonly Readonly<{ location: PartSourceLocation; context: "text" | "attribute" | "structure" | "event"; namespace: "incoming" | "local"; reference: string; optional: boolean; structured: boolean; supply?: PartQualifier }>[] }>;
export type PartLocalSource = Readonly<{ name: string; kind: PartArgumentKind; location: PartSourceLocation; incoming?: string;
  iteratorScalar?: "str" | "num";
  dataOrigin?: Readonly<{ incoming: string; path: SchemaDataPath }> }>;
export type PartLexicalScopeSource = Readonly<{ location: PartSourceLocation; bindings: readonly PartLocalSource[] }>;
export type PartDataSchemaEvidence = Readonly<{
  schema: CompiledHsonSchema;
  strength: "validated" | "advisory";
  schemaLocation: PartSourceLocation;
  annotationLocation: PartSourceLocation;
  valueLocation: PartSourceLocation;
}>;

/** Source projection of the shared analyzer's lexical identities. */
export function part_source_bindings_at(scopes: readonly PartLexicalScopeSource[], position: number): readonly PartLocalSource[] | undefined {
  // Canonical wrappers can share coverage with their element. The later element
  // scope includes its iterator aliases; the narrower source value stays outside.
  let nearest: PartLexicalScopeSource | undefined;
  for (const scope of scopes) if (scope.location.start <= position && position <= scope.location.end
    && (nearest === undefined || scope.location.end - scope.location.start <= nearest.location.end - nearest.location.start)) nearest = scope;
  return nearest?.bindings;
}
/** Preserve the source's lexical origin, before the iterator introduces aliases. */
export function part_iterator_source_origin(document: PartDocumentSource, iterator: PartDocumentSource["iteratorDeclarations"][number]): PartLocalSource["dataOrigin"] {
  if (iterator.declaration === undefined || iterator.sourceLocation === undefined) return undefined;
  const source = iterator.declaration.source;
  const binding = part_source_bindings_at(document.lexicalScopes, iterator.sourceLocation.start)?.find(binding => binding.name === source.name);
  const origin = binding?.dataOrigin;
  return origin === undefined ? undefined : { incoming: origin.incoming, path: [...origin.path, ...source.path] };
}
export type PartConnectorSource = Readonly<{
  location: PartSourceLocation;
  headerComplete: boolean;
  attributes: readonly Readonly<{ name: string; value?: string; nameLocation: PartSourceLocation; valueLocation?: PartSourceLocation;
    dynamicValue?: true;
    scalarIssue?: string;
    /** Decoded authored coordinates, never an already resolved static value. */
    referencedValue?: Readonly<{ text: string; references: readonly PartReference[] }>;
    dataSchema?: CompiledHsonSchema;
    dataEvidence?: PartDataSchemaEvidence }>[];
}>;
/** Static projection only: opaque coordinate values never establish selection. */
export function part_source_coordinates(connector: PartConnectorSource, enclosingLibrary?: string): ReturnType<typeof part_coordinates> | undefined {
  const fields = (name: string) => connector.attributes.filter(attribute => attribute.name === name);
  const libs = fields("lib"), ats = fields("at");
  if (libs.length > 1 || ats.length > 1 || libs.some(attr => attr.value === undefined) || ats.some(attr => attr.value === undefined)) return undefined;
  if (connector.attributes.some(attr => attr.name.startsWith("^{") || attr.name.startsWith("#{"))) return undefined;
  return part_coordinates(libs[0]?.value, ats[0]?.value, enclosingLibrary);
}
export type PartDocumentSource = Readonly<{
  producer: ts.Expression;
  location: PartSourceLocation;
  /** Original literal segments only; TypeScript expressions never belong to this region. */
  authoredRanges: readonly PartSourceLocation[];
  admission: "qualified" | "unknown";
  /** Runtime Library-source admission is stronger than Hson authoring qualification (e.g. QUAD uniqueness). */
  librarySourceAdmission: "qualified" | "unknown";
  /** Value-only interpolation with an otherwise admitted authored structure. */
  valueIndependentAdmission?: true;
  connectors: readonly PartConnectorSource[];
  parameters: readonly PartParameterSource[];
  /** Lexical reuse suggestions only, never a qualified parameter inventory. */
  parameterSpellings: readonly PartParameterSource[];
  parameterCompleteness: "complete" | "unknown";
  /** Known input kinds and definite demands. An open vocabulary can still have a signature. */
  signature?: Pick<PartDefinitionAnalysis, "parameters" | "requiredness">;
  receivingDeclarations: readonly Readonly<{ name: string; incoming: string; kind: PartQualifier; location: PartSourceLocation }>[];
  iteratorDeclarations: readonly Readonly<{ location: PartSourceLocation; sourceLocation?: PartSourceLocation; declaration?: PartIteratorDeclaration; issue?: string;
    /** Shared analyzer ancestry; undefined withholds execution proof. */
    enclosingIterators?: readonly PartSourceLocation[] }>[];
  /** Nested node coverage; iterator source attributes retain their enclosing bindings. */
  lexicalScopes: readonly PartLexicalScopeSource[];
  /** Exact declarations and reference roots from the same lexical analysis. */
  bindingSources?: PartBindingSources;
  definitionRoot?: PartSourceLocation;
  partDeclarations: readonly Readonly<{ location: PartSourceLocation; root: boolean; issue?: string }>[];
  optionalStructures: readonly Readonly<{ location: PartSourceLocation; root: boolean; issue?: string; references?: number }>[];
  referenceIssues: readonly Readonly<PartReferenceIssueSource>[];
  /** Payload ranges, never guessed decoded-substring offsets. No type or optionality is implied. */
  receivers: readonly Readonly<{ batch: ts.CallExpression; library?: PartLibrarySource; certainty: "certain" | "possible";
    /** A single immutable producer in a known receiving field; its values may remain unknown. */
    placementCertain?: true }>[];
}>;
export type PartLibrarySource = Readonly<{
  name?: string;
  declaration: PartSourceLocation;
  nameLocation?: PartSourceLocation;
  family: "parts" | "document" | "data" | "unknown";
  /** Candidate evidence, not a claim about a live receiving inventory. */
  certainty: "certain" | "possible";
  members: readonly Readonly<{ name: string; declaration: PartSourceLocation; admission: "qualified" | "unknown"; certainty: "certain" | "possible";
    documents: readonly PartDocumentSource[];
    /** A known source contract at this coordinate, independent of collection-wide runtime admission. */
    contractSource?: PartDocumentSource }>[];
  memberCompleteness: Completeness;
}>;
export type PartSourceBatch = Readonly<{
  call: ts.CallExpression;
  operation: "fromLibraries" | "create" | "resume" | "admit" | "addLibraries";
  receiver: ts.Expression;
  location: PartSourceLocation;
  /** The producer and every supported authority dependency are syntactically eligible. */
  eligible: boolean;
  libraries: readonly PartLibrarySource[];
  inventoryCompleteness: Completeness;
  /** Existing receivers/resume can contain Libraries absent from this batch. */
  receivingInventory: "candidate-only" | "open";
}>;
/** Detached authoring against an exact immutable Part, not a receiving batch. */
export type PartWriteSource = Readonly<{
  call: ts.CallExpression;
  location: PartSourceLocation;
  /** Source inventory authority only; eventual admission/execution is unknown. */
  batch: PartSourceBatch;
  library: PartLibrarySource;
  definition: PartDocumentSource;
  arguments: readonly Readonly<{ name: string; kind: PartArgumentKind; expression: ts.Expression;
    nameLocation: PartSourceLocation; valueLocation: PartSourceLocation; dataEvidence?: PartDataSchemaEvidence }>[];
}>;
/** Program-snapshot facts, owned by the compiler. No registry, runtime identity or durable cache. */
export type PartSourceFacts = Readonly<{
  batches: readonly PartSourceBatch[];
  documents: readonly PartDocumentSource[];
  writes: readonly PartWriteSource[];
  eventContracts: readonly EventContractSource[];
  eventIssues: readonly EventIssueSource[];
  eventLiterals: readonly (ts.StringLiteral | ts.NoSubstitutionTemplateLiteral)[];
  /** Event lookup roots without a provable Part binding target. */
  unavailableEventReferences: readonly PartSourceLocation[];
}>;

type Candidates = ReturnType<typeof static_source_candidates>;
function event_range_map(literal: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral): SourceRangeMap {
  const file = literal.getSourceFile();
  const correspondence = static_hson_literal_correspondence(file.text, file, literal);
  return range => {
    const mapped = correspondence === undefined ? undefined : map_static_hson_range(correspondence, range);
    return mapped === undefined ? undefined : { file: file.fileName, ...mapped, precision: "exact" };
  };
}

function event_declaration_issue(literal: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral, map: SourceRangeMap, cause: unknown): PartReferenceIssueSource {
  const details = read_transform_error_details(cause);
  const at = (index: number) => {
    let end = index;
    while (end < literal.text.length && is_hson_bare_name_char(literal.text[end]!)) end++;
    return map({ start: index, end: Math.min(literal.text.length, Math.max(index + 1, end)) });
  };
  const first = details?.related?.find(item => item.role === "first-declaration")?.source.index;
  const end = details?.related?.find(item => item.role === "value-end")?.source.index;
  const start = details?.source?.index;
  const where = start === undefined ? undefined : end === undefined ? at(start) : map({ start, end });
  return { location: where ?? location(literal), message: cause instanceof Error ? cause.message : String(cause),
    ...(first === undefined ? {} : { declaration: at(first) }) };
}

function location(node: ts.Node): PartSourceLocation {
  return { file: node.getSourceFile().fileName, start: node.getStart(), end: node.getEnd(), precision: "exact" };
}

/** The same producer admission used by Schema composition candidates. */
function part_value(typescript: typeof ts, sources: Candidates, input: ts.Expression): ReturnType<Candidates["jsonLiteral"]> {
  if (!sources.eligible(input)) return { known: false };
  return sources.jsonLiteral(sources.unwrap(input), node => {
    const possible = sources.candidates(node, "document");
    const only = possible?.length === 1 ? possible[0] : undefined;
    if (only === undefined || !("source" in only) || only.family !== "document") return undefined;
    if (!typescript.isTaggedTemplateExpression(only.node)) return only.source;
    const source = hson_tagged_source(typescript, only.node, "document");
    if (source === undefined || "substitutionRanges" in source) return undefined;
    try { return admit_hson_tagged_source(source); } catch { return undefined; }
  });
}

/** One complete collection validator determines eligibility and the enumerated keys together. */
function part_collection_evidence(typescript: typeof ts, sources: Candidates, input: ts.Expression) {
  const value = part_value(typescript, sources, input);
  if (!value.known) return undefined;
  try { return { value: value.value, members: validate_part_collection(admit_projected_value(value.value)) }; }
  catch { return undefined; }
}

/** Fresh, complete same-batch collections only; aliases remain possible source facts. */
export function static_part_inventory(typescript: typeof ts, checker: ts.TypeChecker, definitions: ts.ObjectLiteralExpression,
  sources = static_source_candidates(typescript, checker)): ReadonlyMap<string, unknown> {
  const parts = new Map<string, unknown>();
  if (!sources.eligible(definitions)) return parts;
  for (const [name, definition] of library_source_fields(definitions, typescript) ?? []) {
    if (!typescript.isObjectLiteralExpression(definition)) continue;
    const fields = library_source_fields(definition, typescript), input = fields?.get("parts");
    if (input === undefined || fields?.size !== 1) continue;
    const evidence = part_collection_evidence(typescript, sources, input);
    if (evidence !== undefined) parts.set(name, evidence.value);
  }
  return parts;
}

/** Bounded, demand-driven facts over existing official sources and receiving candidates. */
const sourceFacts = new WeakMap<ts.Program, PartSourceFacts>();
export function collect_part_source_facts(typescript: typeof ts, program: ts.Program): PartSourceFacts {
  const cached = sourceFacts.get(program);
  if (cached !== undefined) return cached;
  const checker = program.getTypeChecker(), sources = static_source_candidates(typescript, checker, program);
  const schemas = new Map<string, CompiledHsonSchema | undefined>();
  const schemaDeclarations = new Map<ts.SourceFile, readonly DiscoveredHsonSchemaDeclaration[]>();
  const evidence = new Map<ts.Declaration, PartDataSchemaEvidence | undefined>();
  const dataSchema = (expression: ts.Expression | undefined, serialized = false): PartDataSchemaEvidence | undefined => {
    let input = expression;
    let serializedCarrier = false;
    if (serialized && input !== undefined && typescript.isCallExpression(input)) {
      // Authored attributes carry text; only the official carrier serializer
      // connects that text to value evidence. A same-spelled method is unknown.
      if (input === undefined || !sources.eligible(input) || !typescript.isCallExpression(input) || input.arguments.length !== 0
        || !typescript.isPropertyAccessExpression(input.expression) || input.expression.name.text !== "toHson") return undefined;
      const method = checker.getSymbolAtLocation(input.expression.name)?.declarations;
      const declaration = method?.length === 1 ? method[0] : undefined;
      if (declaration === undefined || !typescript.isMethodDeclaration(declaration)
        || !typescript.isClassDeclaration(declaration.parent) || declaration.parent.name?.text !== "HsonDataValue"
        || !["src/api/data/hson-data.ts", "dist/api/data/hson-data.d.ts"].includes(hson_package_declaration_path(declaration.getSourceFile().fileName) ?? "")) return undefined;
      input = input.expression.expression;
      serializedCarrier = true;
    }
    if (input === undefined || !typescript.isIdentifier(input) || !sources.eligible(input)) return undefined;
    const binding = immutable_source_declaration(typescript, checker, input, sources.eligible);
    const declaration = binding?.declaration;
    if (!binding?.eligible || declaration?.type === undefined) return undefined;
    const annotation = resolve_hson_schema_annotation(typescript, checker, declaration.type, sources.eligible);
    const sourceRepresentation = annotation?.kind === "data" || annotation?.kind === "hson";
    // A source brand describes serialized text. Parts .write() still receives
    // that text as a literal string; only authored transport parses its Data.
    if (serialized && !serializedCarrier ? !sourceRepresentation : annotation?.kind !== "value") return undefined;
    if (evidence.has(declaration)) return evidence.get(declaration);
    evidence.set(declaration, undefined);
    const provenance = annotated_data_schema_provenance(typescript, program, checker, declaration.type, sources.eligible, schemaDeclarations);
    if (provenance === undefined) return undefined;
    const { source } = provenance;
    if (!schemas.has(source)) {
      const compiled = compile_hson_schema(source);
      schemas.set(source, compiled.ok ? compiled.value : undefined);
    }
    const schema = schemas.get(source);
    if (schema === undefined || schema.semantic.kind === "document" || schema.semantic.kind === "document-element") return undefined;
    // A type annotation supplies context only. Validation uses the existing
    // bounded static Hson candidate admission and production Schema evaluator.
    const candidates = declaration.initializer === undefined ? undefined : sources.candidates(declaration.initializer, serialized && !serializedCarrier ? "data" : "json");
    const validated = candidates !== undefined && candidates.length > 0 && candidates.every(candidate => evaluate_static_schema_candidate(schema, candidate).kind === "valid");
    const result: PartDataSchemaEvidence = { schema, strength: validated ? "validated" : "advisory",
      schemaLocation: location(provenance.declaration), annotationLocation: location(declaration.type),
      valueLocation: location(declaration.initializer ?? declaration) };
    evidence.set(declaration, result);
    return result;
  };
  const documents = new Map<ts.Expression, PartDocumentSource>();
  const relationships = new Map<PartDocumentSource, PartDocumentSource["receivers"][number][]>();
  const object = (input: ts.Expression, seen = new Set<ts.Declaration>()): { node: ts.ObjectLiteralExpression; fresh: boolean } | undefined => {
    const node = sources.unwrap(input);
    if (typescript.isObjectLiteralExpression(node)) return { node, fresh: true };
    if (!typescript.isIdentifier(node) || seen.size > 16) return undefined;
    const found = sources.declaration(node);
    if (found?.initializer === undefined || seen.has(found)) return undefined;
    seen.add(found);
    const result = object(found.initializer, seen);
    return result === undefined ? undefined : { node: result.node, fresh: false };
  };
  type EventSources = Readonly<{
    events: PartEventEvidence | null;
    ranges: ReadonlyMap<PartReference, Readonly<{ map: SourceRangeMap; site: AuthoredEventReference }>>;
    declarations: ReadonlyMap<PartEvent, EventSource>;
    issues: readonly PartReferenceIssueSource[];
    issuesByName: ReadonlyMap<string, PartReferenceIssueSource>;
  }>;
  const missingEvents: EventSources = { events: null, ranges: new Map(), declarations: new Map(), issues: [], issuesByName: new Map() };
  const adjacent = new Map<ts.Expression, EventSources>();
  const contextual = new Map<ts.Expression, Map<EventSources, PartDocumentSource>>();
  const attachedEvents = new Map<PartDocumentSource, readonly EventSource[]>();
  const localEvents = new Map<ts.CallExpression, EventSource[]>();
  const locusEventSources = new Map<ts.CallExpression, LocusEventSources>();
  const eventContracts: EventContractSource[] = [];
  const eventIssues: EventIssueSource[] = [];
  const eventLiterals = new Set<PartSourceFacts["eventLiterals"][number]>();
  const unavailableEventReferences: PartSourceLocation[] = [];
  const reachable: { reachableOnly: true } = { reachableOnly: true };
  const knownRecord = (input: ts.Expression | undefined): ts.ObjectLiteralExpression | undefined => {
    if (input === undefined) return undefined;
    const evidence = sources.alternatives(input, "json", reachable);
    const only = evidence.complete && evidence.nodes.length === 1 ? evidence.nodes[0] : undefined;
    return only !== undefined && typescript.isObjectLiteralExpression(only) ? only : undefined;
  };
  const knownFields = (input: ts.Expression | undefined): ReadonlyMap<string, ts.Expression> | undefined => {
    const record = knownRecord(input);
    return record === undefined ? undefined : library_source_fields(record, typescript);
  };
  const actionSchema = (input: ts.Expression): CompiledHsonSchema | undefined => {
    const compile = (source: string) => {
      if (!schemas.has(source)) {
        const compiled = compile_hson_schema(source);
        schemas.set(source, compiled.ok ? compiled.value : undefined);
      }
      const value = schemas.get(source);
      return value?.graph.capabilities.projectedRoot === undefined ? undefined : value;
    };
    const expression = sources.unwrap(input);
    if (typescript.isTaggedTemplateExpression(expression) && typescript.isPropertyAccessExpression(expression.tag)
      && expression.tag.name.text === "schema" && typescript.isIdentifier(expression.tag.expression) && is_official_hson_package_binding(expression.tag.expression, "Hson", checker, true, typescript, sources.eligible)
      && sources.eligible(expression) && typescript.isNoSubstitutionTemplateLiteral(expression.template)) {
      try { return compile(admit_hson_tagged_template(typescript, expression, "schema")); }
      catch { return undefined; }
    }
    return resolve_immutable_schema(typescript, checker, expression, declaration => {
      const file = declaration.getSourceFile();
      let discovered = schemaDeclarations.get(file);
      if (discovered === undefined) {
        discovered = discover_hson_schema_declarations(typescript, file, checker, sources.eligible);
        schemaDeclarations.set(file, discovered);
      }
      const found = discovered.find(item => item.declaration === declaration && item.eligible);
      return found?.source === undefined ? undefined : compile(found.source);
    }, undefined, sources.eligible);
  };
  const actionContract = (args: ts.Expression | undefined): ActionContractSource | undefined => {
    const fields = knownFields(args);
    if (fields === undefined || [...fields.keys()].some(key => key !== "required" && key !== "schema")) return undefined;
    const flag = fields.get("required");
    const evidence = flag === undefined ? undefined : sources.alternatives(flag, "json", reachable);
    const required = flag !== undefined && evidence?.complete && evidence.nodes.length > 0
      && evidence.nodes.every(node => node.kind === typescript.SyntaxKind.TrueKeyword) ? location(flag) : undefined;
    const input = fields.get("schema");
    const schema = input === undefined ? undefined : actionSchema(input);
    return { ...(required === undefined ? {} : { required }),
      ...(input === undefined || schema === undefined ? {} : { schema: { value: schema, location: location(input) } }) };
  };
  const readInitialActions = (configuration: ts.Expression | undefined): LocusActionSources => {
    const actions = new Map<string, ActionContractSource | undefined>();
    if (configuration === undefined) return { actions, complete: true };
    const config = knownRecord(configuration);
    const choices: { methods: true } = { methods: true };
    const fields = config === undefined ? undefined : library_source_field_candidates(config, typescript, choices);
    if (!fields?.complete) return { actions, complete: false };
    const tableField = fields.fields.find(field => field.name === "actions");
    if (tableField === undefined) return { actions, complete: true };
    const table = knownRecord(tableField.value);
    if (table === undefined) return { actions, complete: false };
    const entries = library_source_field_candidates(table, typescript, choices);
    // An opaque later assignment can overwrite earlier entries. A final
    // explicit key still supplies its own contract in an otherwise open table.
    for (const { name, value } of entries.fields.reverse()) {
      if (name === undefined) break;
      if (name.length === 0 || is_locus_document_action_name(name) || actions.has(name)) continue;
      const record = knownRecord(value);
      const definition = record === undefined ? undefined : library_source_field_candidates(record, typescript, choices);
      const contract = definition?.complete && definition.fields.some(field => field.name === "handler")
        && definition.fields.every(field => field.name === "handler" || field.name === "args")
        ? actionContract(definition.fields.find(field => field.name === "args")?.value) : undefined;
      actions.set(name, contract);
    }
    return { actions, complete: entries.complete };
  };
  const unavailable = (site: AuthoredEventReference, map: SourceRangeMap): void => {
    const root = map(site.root);
    if (root !== undefined) unavailableEventReferences.push(root);
  };
  const eventSources = (input: ts.Expression): EventSources => {
    const cached = adjacent.get(input);
    if (cached !== undefined) return cached;
    const ranges = new Map<PartReference, { map: SourceRangeMap; site: AuthoredEventReference }>();
    const declarations = new Map<PartEvent, EventSource>();
    const issues = new Map<ts.Expression, PartReferenceIssueSource>();
    const issuesByName = new Map<string, PartReferenceIssueSource>();
    const parsed = new Map<ts.Expression, PartEventAlternative>();
    const declaration = (literal: ts.Expression): PartEventAlternative => {
      if (!sources.eligible(literal) || !typescript.isStringLiteral(literal) && !typescript.isNoSubstitutionTemplateLiteral(literal)) return "opaque";
      const previous = parsed.get(literal);
      if (previous !== undefined) return previous;
      eventLiterals.add(literal);
      const map = event_range_map(literal);
      try {
        const event = parse_part_event(literal.text);
        parsed.set(literal, event);
        for (const argument of event.args) for (const site of event_argument_references(argument)) {
          if (argument.operand.kind === "native") unavailable(site, map);
          else ranges.set(site.reference, { map, site });
        }
        declarations.set(event, { event, location: location(literal), map });
        return event;
      } catch (cause) {
        // Preserve the key while the malformed declaration supplies no use evidence.
        parsed.set(literal, "opaque");
        issues.set(literal, event_declaration_issue(literal, map, cause));
        return "opaque";
      }
    };
    const evidence = sources.alternatives(input, "json", reachable);
    const collections = evidence.nodes.map(node => {
      if (!typescript.isObjectLiteralExpression(node) || !sources.eligible(node)) return undefined;
      const fields = library_source_field_candidates(node, typescript).fields;
      const values = new Map<string, PartEventAlternative[]>();
      let opaque = false;
      // A later unknown field may overwrite an earlier key. A known last
      // assignment still supplies its own declaration independently.
      for (const { name, value } of fields.reverse()) {
        if (name === undefined || value === undefined) { opaque = true; continue; }
        const possible = sources.alternatives(value, "document", reachable);
        const options = possible.nodes.map(declaration);
        if (!opaque && evidence.complete && evidence.nodes.length === 1 && possible.complete && possible.nodes.length === 1) {
          const issue = issues.get(possible.nodes[0]!);
          if (issue !== undefined && !values.has(name)) issuesByName.set(name, issue);
        }
        if (opaque || !possible.complete) options.push("opaque");
        values.set(name, options);
      }
      return { values, opaque };
    });
    const events: PartEventEvidence = {
      get(name) {
        const options = new Set<PartEventAlternative>();
        for (const collection of collections) {
          const values = collection?.values.get(name) ?? [collection?.opaque === false ? "absent" : "opaque"];
          for (const value of values) options.add(value);
        }
        if (!evidence.complete) options.add("opaque");
        return options.size === 1 && options.has("absent") ? undefined : [...options];
      },
    };
    const result = { events, ranges, declarations, issues: [...issues.values()], issuesByName };
    adjacent.set(input, result);
    return result;
  };
  const document = (producer: ts.Expression, adjacentEvents?: EventSources): PartDocumentSource | undefined => {
    const existing = adjacentEvents === undefined ? documents.get(producer) : contextual.get(producer)?.get(adjacentEvents);
    if (existing !== undefined) return existing;
    const file = producer.getSourceFile();
    let text: string, slots: readonly HsonTemplateSlot[] = [], qualified = false, spellingEligible = false;
    let authoredRanges: readonly PartSourceLocation[];
    let map: (range: HsonSourceRange) => PartSourceLocation | undefined;
    if (typescript.isTaggedTemplateExpression(producer)) {
      if (!typescript.isPropertyAccessExpression(producer.tag) || producer.tag.name.text !== "document"
        || !typescript.isIdentifier(producer.tag.expression)
        || !is_official_hson_package_binding(producer.tag.expression, "Hson", checker, true, typescript)) return undefined;
      const source = hson_tagged_source(typescript, producer, "document");
      if (source === undefined) return undefined;
      spellingEligible = sources.eligible(producer)
        && is_official_hson_package_binding(producer.tag.expression, "Hson", checker, true, typescript, sources.eligible);
      const site = interpolation_site({ ...source, substitutionRanges: "substitutionRanges" in source ? source.substitutionRanges : [],
        expressionRanges: "expressionRanges" in source ? source.expressionRanges : [] }, file.fileName);
      authoredRanges = site.literals.map(literal => ({ file: file.fileName, ...literal.range, precision: "exact" }));
      const template = scan_hson_template_segments(site.literals.map(literal => literal.raw), site.expressions.map(() => ""));
      text = template.source; slots = template.slots;
      let offset = 0;
      const segments: GeneratedSegment[] = site.literals.map((literal, index) => {
        const start = offset; offset += literal.raw.length;
        return { kind: "literal", index, start, end: offset };
      });
      map = range => {
        const origin = map_interpolation_range(site, segments, { precision: "exact", ...range });
        return origin.kind === "unresolved" ? undefined : { file: file.fileName, ...origin.range, precision: origin.kind === "literal-exact" ? "exact" : "anchor" };
      };
      if (!("substitutionRanges" in source) && sources.eligible(producer)
        && is_official_hson_package_binding(producer.tag.expression, "Hson", checker, true, typescript, sources.eligible)) {
        try { text = admit_hson_tagged_source(source); qualified = true; } catch { /* Retain only lexical observations. */ }
      }
    } else if (typescript.isStringLiteral(producer) || typescript.isNoSubstitutionTemplateLiteral(producer)) {
      const correspondence = static_hson_literal_correspondence(file.text, file, producer);
      if (correspondence === undefined) return undefined;
      text = producer.text;
      spellingEligible = sources.eligible(producer);
      authoredRanges = [{ file: file.fileName, ...correspondence.bodyRange, precision: "exact" }];
      map = range => { const mapped = map_static_hson_range(correspondence, range); return mapped === undefined ? undefined : { file: file.fileName, ...mapped, precision: "exact" }; };
      if (sources.eligible(producer)) {
        try { qualify_authored_document_source(text, new Map()); qualified = true; } catch { /* Unknown authored source. */ }
      }
    } else return undefined;
    const headers = new Map<number, PartConnectorSource>();
    const attributeRanges = new WeakMap<object, Parameters<HsonSourceLexicalCollector["recordAttribute"]>[1]>();
    const uses: { name: string; location: PartSourceLocation; context: "text" | "attribute" | "structure" | "event"; namespace: "incoming" | "local"; reference: string; optional: boolean; structured: boolean; supply?: PartQualifier }[] = [];
    const receivingDeclarations: { name: string; incoming: string; kind: PartQualifier; location: PartSourceLocation }[] = [];
    const iteratorDeclarations: { location: PartSourceLocation; sourceLocation?: PartSourceLocation; declaration?: PartIteratorDeclaration; issue?: string;
      enclosingIterators?: readonly PartSourceLocation[] }[] = [];
    const lexicalScopes: PartLexicalScopeSource[] = [];
    const optionalStructures: { location: PartSourceLocation; root: boolean; issue?: string; references?: number }[] = [];
    const partDeclarations: { location: PartSourceLocation; root: boolean; issue?: string }[] = [];
    const roots: PartSourceLocation[] = [];
    const referenceIssues: PartReferenceIssueSource[] = [];
    const attachedEventIssues = new Set<PartReferenceIssueSource>();
    const addUnattachedEventIssues = () => {
      for (const issue of adjacentEvents?.issues ?? []) if (!attachedEventIssues.has(issue)) {
        attachedEventIssues.add(issue);
        referenceIssues.push(issue);
      }
    };
    const eventInputs = new Map<PartParameterSource["uses"][number], string | undefined>();
    const observeUses = (value: string, range: HsonSourceRange | undefined, context: "text" | "attribute" | "structure" | "event", typed?: PartQualifier, known?: readonly PartReference[]): void => {
      const mapped = range === undefined ? undefined : map(range);
      if (mapped === undefined) return;
      const whole = known === undefined && typed ? whole_part_reference(value) : undefined;
      if (known === undefined && typed && whole === undefined && !value.startsWith("%{") && !value.startsWith("^{") && !value.startsWith("#{")) return; // Serialized data is opaque.
      let invalid: string | undefined;
      const parsed = known === undefined ? part_placeholder_matches(value, message => { invalid = message; }) : undefined;
      const matches = known ?? (typed ? whole === undefined ? undefined : [whole] : parsed);
      if (matches === undefined) referenceIssues.push({ location: mapped,
        message: invalid === undefined || invalid === "Invalid Part placeholder." ? "Invalid Part property reference." : invalid });
      for (const match of matches ?? []) uses.push({ name: match.name, namespace: match.namespace, reference: match.reference, optional: match.optional, structured: match.path.length > 0,
        location: mapped, context, ...(typed === undefined ? {} : { supply: typed }) });
    };
    const observedAttributes = new WeakSet<object>();
    const tags: string[] = [];
    let scanned = true, hasEventAttachments = false;
    try {
      tokenize_authored_document_library(text, {
        recordToken(token, evidence) {
          if (token.kind === "OPEN") tags.push(token.tag.toLowerCase());
          if (token.kind === "CLOSE") tags.pop();
          if (token.kind === "TEXT" && token.directValue === undefined && token.quoted && part_placeholder_placement_issue(tags) === undefined) observeUses(JSON.parse(token.raw), evidence.roles.value, "text");
        },
        recordAttribute(attr, ranges) {
          attributeRanges.set(attr, ranges);
          if (adjacentEvents === missingEvents && attr.value === undefined && is_event_attachment_attribute(attr.name)) hasEventAttachments = true;
        },
        elementHeader(tag, range, attrs, complete) {
          const connector = tag.toLowerCase() === "hson-part";
          if (complete && (connector || attrs.some(attr => attr.name === PART_DECLARATION))) {
            for (const attr of attrs) {
              const issue = part_direction_issue(tag, attr.name, attr.value === undefined);
              const range = attributeRanges.get(attr)?.name;
              const where = range === undefined ? undefined : map(range);
              if (issue !== undefined && where !== undefined) referenceIssues.push({ location: where, message: issue });
            }
          }
          const rootLocation = tags.length === 0 && complete ? map(range) : undefined;
          if (rootLocation !== undefined) roots.push(rootLocation);
          for (const attr of attrs) {
            if (observedAttributes.has(attr)) continue;
            observedAttributes.add(attr);
            if (attr.name.toLowerCase() === PART_DECLARATION) {
              const range = attributeRanges.get(attr)?.name;
              const where = range === undefined ? undefined : map(range);
              const issue = part_declaration_issue(attr.name, attr.value !== undefined)
                ?? (tags.length !== 0 || connector ? "hson:part is only allowed on the single Part definition root." : undefined);
              if (where !== undefined) partDeclarations.push({ location: where, root: tags.length === 0, ...(issue === undefined ? {} : { issue }) });
              continue;
            }
            const value = split_attrs_meta([attr]).attrs[attr.name];
            if (is_part_iterator_attribute(attr.name)) {
              const ranges = attributeRanges.get(attr), where = ranges?.name === undefined ? undefined : map(ranges.name);
              if (where !== undefined) {
                let declaration: PartIteratorDeclaration | undefined, issue: string | undefined;
                // Dynamic values cannot prove directive syntax, but placement
                // and duplicate declarations remain independent local facts.
                if (attr.value?.direct !== true) {
                  try { declaration = part_iterator_declaration(attr.name, value); }
                  catch (error) { issue = String(error); }
                }
                if (tags.length === 0) issue = "Part iteration is only allowed on descendant elements, never the definition root.";
                if (attrs.filter(attr => is_part_iterator_attribute(attr.name)).length !== 1) issue = "An element may declare only one Part iterator.";
                const sourceLocation = ranges?.value === undefined ? undefined : map(ranges.value);
                iteratorDeclarations.push({ location: where, ...(declaration === undefined ? {} : { declaration }),
                  ...(sourceLocation === undefined ? {} : { sourceLocation }), ...(issue === undefined ? {} : { issue }) });
              }
              if (attr.value?.direct !== true && typeof value === "string") observeUses(value, ranges?.value, "attribute");
              continue;
            }
            if (attr.name.startsWith("^{")) {
              observeUses(attr.name, attributeRanges.get(attr)?.value, "structure");
              continue;
            }
            if (attr.name === PART_OPTIONAL) {
              const range = attributeRanges.get(attr)?.name;
              const where = range === undefined ? undefined : map(range);
              if (where !== undefined) optionalStructures.push({ location: where, root: tags.length === 0,
                ...(attr.value?.direct === true ? {} : { issue: part_optional_issue(value) }) });
              continue;
            }
            if (is_part_receiving_attribute(tag, attr.name)) {
              const ranges = attributeRanges.get(attr);
              const range = ranges?.value ?? ranges?.name;
              const where = range === undefined ? undefined : map(range);
              if (where !== undefined) {
                try {
                  if (tags.length !== 0) throw new TypeError("Part receiving declarations are only allowed on the single definition root.");
                  if (attr.value?.direct !== true) {
                    const declaration = part_receiving_declaration(attr.name, value);
                    receivingDeclarations.push({ name: declaration.name, incoming: declaration.reference.name, kind: declaration.kind, location: where });
                  }
                } catch (error) { referenceIssues.push({ location: where, message: String(error) }); }
              }
              continue;
            }
            if (attr.value?.direct !== true && typeof value === "string" && part_placeholder_placement_issue(tags, { name: attr.name, value }, tag) === undefined) {
              const argument = connector ? part_argument_name(attr.name) : undefined;
              const range = attributeRanges.get(attr)?.value;
              const kind = argument?.kind;
              if (is_part_scalar_qualifier(kind)) {
                try {
                  const operand = part_scalar_operand(kind, value, attr.value?.quoted ? decode_part_string_sigils(attr.value.text) : undefined);
                  if (operand.kind === "reference") observeUses(value, range, "attribute", kind, [operand.reference]);
                  else if (operand.kind === "interpolation") observeUses(value, range, "attribute", undefined, operand.references);
                } catch { /* The connector's value evidence owns this diagnostic. */ }
              } else observeUses(value, range, "attribute", kind === "scalar" ? undefined : kind);
            }
          }
          if (!connector) return;
          const mapped = map(range);
          if (mapped === undefined) return;
          headers.set(range.start, { location: mapped, headerComplete: complete, attributes: attrs.flatMap(attr => {
            const ranges = attributeRanges.get(attr), name = ranges?.name === undefined ? undefined : map(ranges.name);
            if (name === undefined) return [];
            const valueRange = ranges?.value === undefined ? undefined : map(ranges.value);
            const value = attr.name.toLowerCase() === PART_DECLARATION ? undefined : split_attrs_meta([attr]).attrs[attr.name];
            const argument = part_argument_name(attr.name);
            const directSlots = attr.value?.direct === true && attr.value.text === "" && argument?.kind === "data"
              ? slots.filter(slot => attr.start.index <= slot.offset && slot.offset <= attr.end.index) : [];
            const expression = directSlots.length === 1 && typescript.isTaggedTemplateExpression(producer) && typescript.isTemplateExpression(producer.template)
              ? producer.template.templateSpans[directSlots[0]!.substitution]?.expression : undefined;
            const schema = dataSchema(expression, true);
            const kind = argument?.kind;
            let scalarIssue: string | undefined, scalarLiteral: boolean | undefined;
            if (is_part_scalar_qualifier(kind) && attr.value?.direct !== true) {
              try {
                scalarLiteral = part_scalar_operand(kind, value, attr.value?.quoted ? decode_part_string_sigils(attr.value.text) : undefined).kind === "literal";
              } catch (cause) { scalarIssue = cause instanceof Error ? cause.message : String(cause); }
            }
            const dynamicValue: true | undefined = attr.value?.direct === true || typeof value === "string" && (scalarLiteral === undefined ? has_part_reference(value) : !scalarLiteral) ? true : undefined;
            const references = attr.value?.direct !== true && typeof value === "string" && (attr.name === "at" || attr.name === "lib")
              && has_part_reference(value) ? part_placeholder_matches(value) : undefined;
            return [{ name: attr.name, nameLocation: name, ...(valueRange === undefined ? {} : { valueLocation: valueRange }),
              ...(dynamicValue === undefined ? {} : { dynamicValue }),
              ...(scalarIssue === undefined ? {} : { scalarIssue }),
              ...(references === undefined || typeof value !== "string" ? {} : { referencedValue: { text: value, references } }),
              ...(schema === undefined ? {} : { dataSchema: schema.schema, dataEvidence: schema }),
              ...(attr.value?.direct === true || typeof value !== "string" || dynamicValue === true && (argument === undefined || argument.kind === "scalar" || is_part_scalar_qualifier(kind)) ? {} : { value }) }];
          }) });
        },
      }, { slots, substitutions: slots.map(() => "") });
    } catch { scanned = false; }
    // Proven absence only changes facts for a document with an authored attachment.
    if (adjacentEvents === missingEvents && !hasEventAttachments) {
      adjacentEvents = undefined;
      const ordinary = documents.get(producer);
      if (ordinary !== undefined) return ordinary;
    }
    const names = new Set<string>();
    let parameterCompleteness: "complete" | "unknown" = "unknown";
    let signature: PartDocumentSource["signature"];
    let bindingSources: PartBindingSources | undefined;
    const eventAttachments: EventSource[] = [];
    const completeAnalysis = qualified && scanned;
    // Quoted slots cannot add structural declarations. Their values remain
    // opaque, so local lexical facts survive without proving an input interface.
    const valueSlots = (source: string) => slots.length > 0
      && hson_interpolation_roles(source, "document", slots).every(role => role === "quoted-string");
    const staticStructure = slots.length === 0 || valueSlots(text);
    const lexicalComplete = completeAnalysis || spellingEligible && scanned && slots.length > 0 && staticStructure;
    let analysisText: string | undefined = lexicalComplete ? text : undefined;
    if (analysisText === undefined && spellingEligible) {
      const checkpoint = hson_grammar_checkpoint(text, text.length, "document", slots);
      // Close only scanner-proven unfinished reference/string/container slots.
      // Recovered analysis contributes lexical completion, never diagnostics or
      // receiving-interface proof. It uses the same parser and analyzer below.
      if (checkpoint?.kind === "parameter" && checkpoint.quoted !== undefined) {
        analysisText = text + (checkpoint.parameter?.complete ? "" : "}")
          + (checkpoint.quoted.complete ? "" : '"') + checkpoint.quoted.closingDelimiters.join("");
      }
    }
    if (analysisText !== undefined && (analysisText === text ? staticStructure : slots.length === 0 || valueSlots(analysisText))) {
      try {
        const { root, provenance } = parse_part_binding_source(analysisText, slots);
        const paths = new Map<HsonNode, readonly number[]>();
        const pending: { node: HsonNode; path: readonly number[] }[] = [{ node: root, path: [] }];
        while (pending.length) {
          const { node, path } = pending.pop()!;
          paths.set(node, path);
          node.$_content.forEach((child, index) => { if (is_Node(child)) pending.push({ node: child, path: [...path, index] }); });
        }
        const nodeLocation = (node: HsonNode, attribute?: string, role: "name" | "value" = "name"): PartSourceLocation => {
          const path = paths.get(node) ?? [];
          const range = attribute === undefined ? provenance.range({ kind: "node", path, role: "coverage" })
            : provenance.range({ kind: "attribute", owner: path, name: attribute, role });
          return range === undefined ? location(producer) : map({ start: range.start, end: Math.min(range.end, text.length) }) ?? location(producer);
        };
        const useIssues: [PartReferenceUse, (typeof referenceIssues)[number]][] = [];
        const optionalEventFields = new Map<HsonNode, Map<string, Set<AuthoredEventArgument>>>();
        const analysis = analyze_part_definition(root, issue => {
          if (!lexicalComplete || issue.use?.conditional) return;
          const owner = nodeLocation(issue.node, issue.attribute,
            issue.attribute?.startsWith("^{") || issue.attribute?.toLowerCase().startsWith("event:") ? "name" : "value");
          if (issue.conflictingEventLocal !== undefined) {
            const local = issue.conflictingEventLocal;
            const attr = local.receiving === undefined ? Object.keys(local.node.$_attrs ?? {}).find(is_part_iterator_attribute)
              : `${local.kind}:${local.name}`;
            referenceIssues.push({ location: owner, message: issue.message, declaration: nodeLocation(local.node, attr) });
            return;
          }
          if (issue.message === "Invalid Part placeholder." && referenceIssues.some(prior => prior.message === "Invalid Part property reference."
            && owner.start <= prior.location.start && prior.location.end <= owner.end)) return;
          const diagnostic: (typeof referenceIssues)[number] = { location: owner, message: issue.message };
          referenceIssues.push(diagnostic);
          if (issue.use !== undefined) useIssues.push([issue.use, diagnostic]);
        }, adjacentEvents?.events, (node, attribute, alternatives) => {
          if (!lexicalComplete) return;
          const attachment = nodeLocation(node, attribute);
          const issue = adjacentEvents?.issuesByName.get(attribute.slice("event:".length));
          if (issue !== undefined) {
            attachedEventIssues.add(issue);
            referenceIssues.push({ ...issue, attachment });
          }
          if (alternatives.length !== 1) return;
          const event = alternatives[0];
          if (event === undefined || typeof event === "string") return;
          const declaration = adjacentEvents?.declarations.get(event);
          if (declaration !== undefined) {
            const byAttribute = optionalEventFields.get(node) ?? new Map<string, Set<AuthoredEventArgument>>();
            const maybeAbsent = new Set<AuthoredEventArgument>();
            byAttribute.set(attribute, maybeAbsent);
            optionalEventFields.set(node, byAttribute);
            eventAttachments.push({ ...declaration, attachment, maybeAbsent });
          }
        });
        for (const use of analysis.uses) {
          if (use.eventArgument !== undefined && use.attribute !== undefined
            && (use.reference.optional || use.binding?.receiving?.reference.optional)) {
            optionalEventFields.get(use.node)?.get(use.attribute)?.add(use.eventArgument);
          }
        }
        addUnattachedEventIssues();
        if (analysisText === text && spellingEligible) {
          const projected = project_part_bindings(root, analysis, provenance, text, map,
            (reference, role) => {
              const source = adjacentEvents?.ranges.get(reference);
              if (source === undefined) return undefined;
              const { map, site } = source;
              return map(role === "root" ? site.root : { start: site.start.index, end: site.end.index });
            });
          bindingSources = projected.sources;
          for (const [use, diagnostic] of useIssues) {
            const observed = projected.byUse.get(use);
            diagnostic.declaration = observed?.declaration?.location;
            if (observed !== undefined && is_part_scalar_qualifier(use.supply)) diagnostic.location = observed.location;
            if (use.context === "event" && observed !== undefined) {
              diagnostic.location = observed.location;
              diagnostic.attachment = observed.attachment;
            }
          }
        }
        for (const use of analysis.uses) if (use.context === "event") {
          const reference = use.reference, eventRange = adjacentEvents?.ranges.get(reference);
          if (eventRange === undefined) continue;
          const { map, site } = eventRange;
          if (use.attribute !== undefined && analysis.opaqueEvents.get(use.node)?.has(use.attribute)) unavailable(site, map);
          const where = map({ start: site.start.index, end: site.end.index });
          if (where === undefined) continue;
          const fact = { name: reference.name, location: where, context: "event" as const, namespace: reference.namespace,
            reference: reference.reference, optional: reference.optional === true, structured: reference.path.length > 0 };
          uses.push(fact);
          eventInputs.set(fact, reference.namespace === "incoming" ? reference.name : use.binding?.receiving?.reference.name);
        }
        const declarationLocation = (binding: PartLocalDeclaration) => nodeLocation(binding.node,
          binding.receiving === undefined ? analysis.iterators.get(binding.node)?.attribute : `${binding.kind}:${binding.name}`,
          binding.receiving === undefined ? "name" : "value");
        const sourceScopes = new Map<ReadonlyMap<string, PartLocalDeclaration>, readonly PartLocalSource[]>();
        const dataOrigin = (binding: PartLocalDeclaration, depth = 0): PartLocalSource["dataOrigin"] => {
          if (binding.kind !== "data" || depth > 64) return undefined;
          if (binding.receiving !== undefined) return { incoming: binding.receiving.reference.name, path: [] };
          const source = binding.elementOf;
          const origin = source?.binding === undefined ? undefined : dataOrigin(source.binding, depth + 1);
          return origin === undefined || source === undefined ? undefined : { incoming: origin.incoming, path: [...origin.path, ...source.reference.path, analysis.iterators.get(binding.node)?.kind === "object" ? OBJECT_VALUE : null] };
        };
        const sourceBindings = (scope: ReadonlyMap<string, PartLocalDeclaration>): readonly PartLocalSource[] => {
          let result = sourceScopes.get(scope);
          if (result === undefined) {
            result = [...scope.values()].map(binding => {
              const origin = dataOrigin(binding);
              const iterator = analysis.iterators.get(binding.node);
              const iteratorScalar = binding.kind === "scalar" && iterator !== undefined
                ? iterator.kind === "array" ? "num" : "str" : undefined;
              return { name: binding.name, kind: binding.kind, location: declarationLocation(binding),
                ...(iteratorScalar === undefined ? {} : { iteratorScalar }),
                ...(origin === undefined ? {} : { dataOrigin: origin }),
                ...(binding.receiving === undefined ? {} : { incoming: binding.receiving.reference.name }) };
            });
            sourceScopes.set(scope, result);
          }
          return result;
        };
        const iterationReads = new Map(analysis.uses.filter(use => use.context === "iteration").map(use => [use.node, use]));
        const iteratorNodes = [...analysis.iterators.keys()];
        for (const [node, scope] of analysis.scopes) {
          lexicalScopes.push({ location: nodeLocation(node), bindings: sourceBindings(scope) });
          const iterator = analysis.iterators.get(node);
          if (iterator !== undefined) {
            const where = nodeLocation(node, iterator.attribute), path = paths.get(node)!;
            const fact = iteratorDeclarations.find(fact => fact.location.start === where.start && fact.location.end === where.end);
            if (fact !== undefined) fact.enclosingIterators = iteratorNodes.filter(ancestor => {
              const parent = paths.get(ancestor)!;
              return parent.length < path.length && parent.every((step, index) => path[index] === step);
            }).map(ancestor => nodeLocation(ancestor, analysis.iterators.get(ancestor)!.attribute));
            const source = provenance.range({ kind: "attribute", owner: paths.get(node) ?? [], name: iterator.attribute, role: "value" });
            const sourceLocation = source === undefined ? undefined : map(source);
            const read = iterationReads.get(node);
            // The source expression is outside this element's newly introduced bindings.
            if (sourceLocation !== undefined && read !== undefined) {
              lexicalScopes.push({ location: sourceLocation, bindings: sourceBindings(read.scope) });
            }
          }
        }
        if (completeAnalysis) {
          const counts = new Map<HsonNode, number>();
          const opaqueSubtrees = new Set(analysis.opaqueEvents.keys());
          const optionalNodes = new Map<HsonNode, typeof optionalStructures[number]>();
          let optionalIndex = 0;
          const count = (node: HsonNode, amount: number) => counts.set(node, (counts.get(node) ?? 0) + amount);
          for (const use of analysis.uses) if (use.context === "event") count(use.node, 1);
          transform_part_parameter_strings(root, (value, node) => {
            const matches = part_placeholder_matches(value);
            if (matches === undefined) throw new Error("Invalid Part placeholder");
            count(node, matches.length);
            return value;
          }, (_reference, node) => { count(node, 1); }, undefined, {
            inspect: true,
            scalarArgument(value, node, kind, attribute) {
              try {
                const operand = part_scalar_operand(kind, value, part_literal_sigils(node.$_attrs, attribute));
                if (operand.kind !== "literal") count(node, operand.kind === "reference" ? 1 : operand.references.length);
              } catch { /* The analyzer already reported the invalid operand. */ }
            },
            structure(_reference, node) { count(node, 1); },
            enter(node) {
              if (Object.hasOwn(node.$_attrs ?? {}, PART_OPTIONAL)) {
                const fact = optionalStructures[optionalIndex++];
                if (fact !== undefined) optionalNodes.set(node, fact);
              }
            },
            leave(node, parent) {
              const references = counts.get(node) ?? 0, fact = optionalNodes.get(node);
              if (fact !== undefined && (!opaqueSubtrees.has(node) || references > 0)) fact.references = references;
              if (parent !== undefined) {
                count(parent, references);
                if (opaqueSubtrees.has(node)) opaqueSubtrees.add(parent);
              }
            },
          });
          const opaqueScopes = [...analysis.opaqueEvents.keys()].map(node => analysis.scopes.get(node));
          for (const declaration of analysis.receiving) if (!analysis.used.has(declaration) && !optionalStructures.some(fact => fact.root)
            && !(declaration.kind === "data" && opaqueScopes.some(scope => scope?.get(declaration.name) === declaration))) {
            referenceIssues.push({ location: declarationLocation(declaration), message: `Unused Part ${declaration.kind} binding ${JSON.stringify(declaration.name)}.` });
          }
          for (const name of analysis.parameters.keys()) names.add(name);
          parameterCompleteness = analysis.opaqueEvents.size === 0 && referenceIssues.length === 0 ? "complete" : "unknown";
          const element = root.$_content[0];
          if (referenceIssues.length === 0 && root.$_content.length === 1 && is_ordinary_element_node(element)
            && element.$_tag.toLowerCase() !== "hson-part" && partDeclarations.some(flag => flag.root && flag.issue === undefined)
            && optionalStructures.every(flag => flag.issue === undefined)) {
            signature = { parameters: analysis.parameters, requiredness: analysis.requiredness };
          }
        }
      } catch { names.clear(); }
    }
    let librarySourceAdmission: "qualified" | "unknown" = "unknown";
    let valueIndependentAdmission: true | undefined;
    if (qualified && scanned && slots.length === 0) {
      try { parse_authored_document_library(text); librarySourceAdmission = "qualified"; }
      catch { /* Keep authoring/completion facts; this source cannot establish a receiving Library. */ }
    }
    if (lexicalComplete && slots.length > 0 && staticStructure) {
      // Quoted slots cannot add attributes or change QUAD ownership. Coordinate
      // values stay opaque. Parse through the same Library admission boundary.
      try { parse_authored_document_library(text); valueIndependentAdmission = true; }
      catch { /* Invalid authored structure still withdraws contract proof. */ }
    }
    addUnattachedEventIssues();
    const receivers: PartDocumentSource["receivers"][number][] = [];
    const inputs = new Map(uses.map(use => [use, use.context === "event" ? eventInputs.get(use) : use.namespace === "incoming" ? use.name
      : part_source_bindings_at(lexicalScopes, use.location.start)?.find(binding => binding.name === use.name)?.incoming]));
    const result: PartDocumentSource = { producer, location: location(producer), authoredRanges, admission: qualified ? "qualified" : "unknown",
      librarySourceAdmission, ...(valueIndependentAdmission === undefined ? {} : { valueIndependentAdmission }),
      connectors: [...headers.values()], parameters: [...names].map(name => ({ name, uses: uses.filter(use => inputs.get(use) === name) })),
      parameterSpellings: spellingEligible ? [...new Set(uses.map(use => use.name))].map(name => ({ name, uses: uses.filter(use => use.name === name) })) : [],
      ...(scanned && roots.length === 1 ? { definitionRoot: roots[0]! } : {}), partDeclarations,
      parameterCompleteness, ...(signature === undefined ? {} : { signature }), optionalStructures, receivingDeclarations: spellingEligible ? receivingDeclarations : [],
      ...(bindingSources === undefined ? {} : { bindingSources }),
      iteratorDeclarations: spellingEligible ? iteratorDeclarations : [], lexicalScopes: spellingEligible ? lexicalScopes : [], referenceIssues, receivers };
    if (adjacentEvents === undefined) documents.set(producer, result);
    else {
      const contexts = contextual.get(producer) ?? new Map<EventSources, PartDocumentSource>();
      contexts.set(adjacentEvents, result);
      contextual.set(producer, contexts);
    }
    relationships.set(result, receivers);
    if (eventAttachments.length > 0) attachedEvents.set(result, eventAttachments.map(event => ({ ...event, definition: result })));
    return result;
  };
  const alternatives = (input: ts.Expression, adjacentEvents?: EventSources) => {
    const possible = sources.alternatives(input, "document", adjacentEvents === undefined ? undefined : reachable);
    const found = possible.nodes.flatMap(node => { const observed = document(node, adjacentEvents); return observed === undefined ? [] : [observed]; });
    if (adjacentEvents !== undefined && (!possible.complete || found.length !== possible.nodes.length
      || found.some(document => document.bindingSources === undefined))) {
      // Structural interpolation or an opaque producer can add an attachment
      // whose scope cannot be projected. Withdraw navigation for these operands.
      for (const { site, map } of adjacentEvents.ranges.values()) unavailable(site, map);
    }
    // Filtering observations cannot remove an alternative or its conditionality from the proof.
    const lexicalCertain = possible.complete && !possible.conditional && possible.nodes.length === 1 && found.length === 1;
    return { documents: found, lexicalCertain, certain: lexicalCertain && found[0]!.admission === "qualified" };
  };
  const batches: PartSourceBatch[] = [];
  const writeCalls: ts.CallExpression[] = [];
  for (const file of program.getSourceFiles()) {
    if (file.isDeclarationFile || program.isSourceFileFromExternalLibrary(file) || file.fileName.replaceAll("\\", "/").split("/").includes(".hson")) continue;
    const mapSymbols = read_supported_hson_import_symbols(file, checker, [], "hsonLiveMap", typescript);
    const visit = (node: ts.Node): void => {
      if (typescript.isTaggedTemplateExpression(node)) document(node);
      if (typescript.isCallExpression(node)) {
        if (typescript.isPropertyAccessExpression(node.expression) && node.expression.name.text === "write") writeCalls.push(node);
        const admission = library_source_admission(node, checker, mapSymbols, false, typescript, sources.eligible);
        if (admission !== undefined) {
          const eligible = admission.eligible && sources.eligible(admission.definitions);
          const definitions = object(admission.definitions);
          const fields = definitions === undefined ? undefined : library_source_field_candidates(definitions.node, typescript);
          const owner = eligible ? admission.locusOwner : undefined;
          let hosted: LocusEventSources | undefined;
          if (owner !== undefined && (admission.operation === "create" || admission.operation === "resume" || admission.operation === "admit")) {
            hosted = { owner, operation: admission.operation, initialActions: locusEventSources.get(owner)?.initialActions
              ?? readInitialActions(owner.arguments[1]), events: [], definitions: admission.definitions };
            locusEventSources.set(node, hosted);
          }
          const libraries: PartLibrarySource[] = [];
          for (const entry of fields?.fields ?? []) {
            const definition = entry.value === undefined ? undefined : object(entry.value);
            const own = definition === undefined ? undefined : library_source_fields(definition.node, typescript);
            const parts = own?.get("parts"), body = own?.get("document");
            const access = own?.get("access");
            const accessValues = access === undefined ? undefined : sources.candidates(access, "json");
            const validParts = parts !== undefined && (own?.size === 1 || hosted !== undefined && own?.size === 2
              && accessValues !== undefined && accessValues.length > 0
              && accessValues.every(value => "json" in value && (value.json === "private" || value.json === "shared")));
            const hasData = own?.has("json") || own?.has("hson");
            const exclusiveData = !!own?.has("json") !== !!own?.has("hson");
            const family = own?.has("data") ? "unknown" : validParts ? "parts" : body !== undefined && !hasData && parts === undefined ? "document"
              : exclusiveData && body === undefined && parts === undefined ? "data" : "unknown";
            const collection = family !== "parts" || parts === undefined ? undefined : object(parts);
            const members = collection === undefined ? undefined : library_source_field_candidates(collection.node, typescript);
            const evidence = family !== "parts" || parts === undefined ? undefined : part_collection_evidence(typescript, sources, parts);
            let memberCompleteness: Completeness = members === undefined ? "unknown" : "partial";
            const shapeCertain = eligible && definitions?.fresh && fields?.complete && definition?.fresh && sources.eligible(definitions.node)
              && sources.eligible(entry.declaration);
            const observedMembers = (members?.fields ?? []).flatMap(member => {
              if (member.name === undefined || member.value === undefined) return [];
              const record = object(member.value);
              const value = part_value(typescript, sources, member.value);
              const variants = record === undefined ? sources.alternatives(member.value, "json", reachable) : undefined;
              const records = variants?.nodes ?? (record === undefined ? [] : [record.node]);
              const observed = records.map(node => {
                const fields = typescript.isObjectLiteralExpression(node) ? library_source_fields(node, typescript) : undefined;
                const source = fields?.get("document"), events = fields?.get("events");
                const adjacentEvents = source !== undefined && eligible && sources.eligible(node)
                  && (record?.fresh || value.known || variants !== undefined)
                  ? events === undefined ? missingEvents : eventSources(events) : undefined;
                return { fields, adjacentEvents, evidence: source === undefined ? undefined : alternatives(source, adjacentEvents) };
              });
              if (variants !== undefined && (!variants.complete || observed.some(variant => variant.evidence === undefined))) {
                for (const variant of observed) for (const { site, map } of variant.adjacentEvents?.ranges.values() ?? []) unavailable(site, map);
              }
              const memberEvidence = record === undefined ? { documents: [...new Set(observed.flatMap(variant => variant.evidence?.documents ?? []))],
                lexicalCertain: false, certain: false }
                : observed[0]?.evidence ?? { documents: [], lexicalCertain: false, certain: false };
              let qualified = false;
              if (value.known) {
                try { validate_part_collection(admit_projected_value({ [member.name]: value.value })); qualified = true; }
                catch { /* A lexical member can survive without qualifying as a Part. */ }
              }
              const selected = shapeCertain && collection?.fresh && members?.complete && record?.fresh && memberEvidence.certain
                ? memberEvidence.documents[0] : undefined;
              const fields = observed[0]?.fields, kind = fields?.get("kind");
              // Known Part syntax supplies a source contract even if its event
              // values cannot yet pass runtime collection admission.
              const contractSource = selected?.signature !== undefined && (qualified
                || selected.librarySourceAdmission === "qualified" && fields?.has("events")
                && [...fields.keys()].every(key => ["kind", "document", "events", "css", "stylesheet"].includes(key))
                && kind !== undefined && sources.candidates(kind, "json")?.every(candidate => "json" in candidate && candidate.json === "document"))
                ? selected : undefined;
              if (contractSource !== undefined) for (const source of attachedEvents.get(contractSource) ?? []) {
                const attachment = { ...source, batch: node };
                if (attachment.event.kind === "locus") {
                  hosted?.events.push(attachment);
                  const contract = hosted?.initialActions.actions.get(attachment.event.key);
                  if (contract !== undefined) eventContracts.push({ ...attachment, contract });
                } else if (admission.operation === "fromLibraries") {
                  const inputs = localEvents.get(node) ?? [];
                  inputs.push(attachment);
                  localEvents.set(node, inputs);
                }
              }
              return [{ name: member.name, declaration: location(member.declaration), fresh: record?.fresh === true,
                qualified, contractSource, evidence: memberEvidence }];
            });
            if (eligible && evidence !== undefined && members?.complete && evidence.members.length === observedMembers.length
              && evidence.members.every(member => observedMembers.some(observed => observed.name === member.key))) memberCompleteness = "complete";
            const documentEvidence = body === undefined ? undefined : alternatives(body);
            const producerCertain = family === "parts" ? memberCompleteness === "complete" : family === "document" ? documentEvidence?.certain === true
              : family === "data" && sources.candidates((own!.get("json") ?? own!.get("hson"))!, own!.has("json") ? "json" : "data") !== undefined;
            const library: PartLibrarySource = {
              ...(entry.name === undefined ? {} : { name: entry.name }), declaration: location(entry.declaration),
              ...(entry.declaration.name === undefined ? {} : { nameLocation: location(entry.declaration.name) }), family,
              certainty: shapeCertain && producerCertain ? "certain" : "possible",
              members: observedMembers.map(member => ({ name: member.name, declaration: member.declaration,
                admission: member.qualified ? "qualified" : "unknown",
                certainty: eligible && memberCompleteness === "complete" && collection?.fresh && member.fresh && member.evidence.certain ? "certain" : "possible",
                documents: member.evidence.documents,
                ...(member.contractSource === undefined ? {} : { contractSource: member.contractSource }) })), memberCompleteness,
            };
            libraries.push(library);
            const relate = (related: ReturnType<typeof alternatives>, certain: boolean): void => {
              for (const found of related.documents) relationships.get(found)?.push({ batch: node, library,
                certainty: certain && related.certain ? "certain" : "possible",
                ...(family === "document" && shapeCertain && related.lexicalCertain ? { placementCertain: true } : {}) });
            };
            if (documentEvidence !== undefined) relate(documentEvidence, library.certainty === "certain");
            for (const member of observedMembers) relate(member.evidence, library.certainty === "certain" && memberCompleteness === "complete" && member.fresh);
          }
          batches.push({ ...admission, location: location(node), libraries,
            inventoryCompleteness: fields === undefined ? "unknown" : eligible && definitions?.fresh && fields.complete && sources.eligible(definitions.node) ? "complete" : "partial",
            receivingInventory: admission.operation === "create" || admission.operation === "fromLibraries" ? "candidate-only" : "open" });
        }
      }
      typescript.forEachChild(node, visit);
    };
    visit(file);
  }
  // Unconnected authored templates have possible receivers only, each retaining its own batch identity.
  // They cannot borrow absence/membership proof from a similarly named Library elsewhere.
  const observedDocuments = [
    ...[...documents].filter(([producer, found]) => !contextual.has(producer) || found.receivers.length > 0).map(([, found]) => found),
    ...[...contextual.values()].flatMap(contexts => [...contexts.values()]),
  ];
  for (const found of observedDocuments) {
    const receivers = relationships.get(found)!;
    if (receivers.length !== 0 || found.connectors.length === 0) continue;
    for (const batch of batches) receivers.push({ batch: batch.call, certainty: "possible" });
  }
  const writes: PartWriteSource[] = [];
  for (const call of writeCalls) {
    const target = part_write_target(typescript, checker, sources, batches, call), input = call.arguments[0];
    if (target === undefined || input === undefined || !typescript.isObjectLiteralExpression(input) || !sources.eligible(call)) continue;
    const arguments_: PartWriteSource["arguments"][number][] = [];
    let supported = true;
    for (const property of input.properties) {
      if ((!typescript.isPropertyAssignment(property) && !typescript.isShorthandPropertyAssignment(property))
        || is_object_literal_prototype_setter(property, typescript)
        || typescript.isShorthandPropertyAssignment(property) && property.objectAssignmentInitializer !== undefined
        || !typescript.isIdentifier(property.name) && !typescript.isStringLiteral(property.name)) { supported = false; break; }
      const name = property.name.text, kind = target.definition.signature?.parameters.get(name);
      if (kind === undefined || arguments_.some(argument => argument.name === name)) { supported = false; break; }
      const expression = typescript.isPropertyAssignment(property) ? property.initializer : property.name;
      arguments_.push({ name, kind, expression, nameLocation: location(property.name), valueLocation: location(expression),
        ...(kind === "data" ? { dataEvidence: dataSchema(expression) } : {}) });
    }
    if (supported) writes.push({ call, location: location(call), ...target, arguments: arguments_ });
  }
  eventContracts.push(...direct_event_contracts(typescript, program, sources, localEvents,
    locusEventSources, eventIssues, eventLiterals, options => {
      const fields = knownFields(options);
      const args = fields?.get("args");
      // Capture can run application getters when the options or the args record are opaque.
      if (fields === undefined || args !== undefined && knownFields(args) === undefined) return undefined;
      return { contract: fields.size === 1 ? actionContract(args) : undefined };
    }));
  const facts: PartSourceFacts = { batches, documents: observedDocuments, writes, eventContracts, eventIssues,
    eventLiterals: [...eventLiterals], unavailableEventReferences };
  sourceFacts.set(program, facts);
  return facts;
}

/** Straight-line evidence from direct registrations on provable owners. */
function direct_event_contracts(typescript: typeof ts, program: ts.Program, sources: Candidates,
  localEvents: ReadonlyMap<ts.CallExpression, readonly EventSource[]>,
  locusEventSources: ReadonlyMap<ts.CallExpression, LocusEventSources>,
  issues: EventIssueSource[],
  eventLiterals: Set<PartSourceFacts["eventLiterals"][number]>,
  readOptions: (options: ts.Expression) => Readonly<{ contract: ActionContractSource | undefined }> | undefined): readonly EventContractSource[] {
  const checker = program.getTypeChecker();
  const output: EventContractSource[] = [];
  const receivingFiles = new Set([...localEvents.keys(), ...locusEventSources.keys()].map(call => call.getSourceFile()));
  // A small syntax whitelist allows ordinary arguments and deferred function
  // bodies. Calls, property reads, computed keys and spreads can execute code.
  const inertValue = (expression: ts.Expression, depth = 0, admission = false): boolean => {
    if (depth > 16) return false;
    const value = sources.unwrap(expression);
    if (typescript.isIdentifier(value)) {
      if (!admission) return true;
      // Admission reads the supplied records. Follow leaf aliases only, since
      // an aliased object could have acquired accessors before this call.
      const found = immutable_source_declaration(typescript, checker, value, sources.eligible);
      const initializer = found?.declaration.initializer;
      return found?.eligible === true && initializer !== undefined && !typescript.isObjectLiteralExpression(sources.unwrap(initializer))
        && inertValue(initializer, depth + 1, true);
    }
    if (typescript.isStringLiteral(value) || typescript.isNoSubstitutionTemplateLiteral(value) || typescript.isNumericLiteral(value)
      || value.kind === typescript.SyntaxKind.TrueKeyword || value.kind === typescript.SyntaxKind.FalseKeyword
      || value.kind === typescript.SyntaxKind.NullKeyword) return true;
    if (typescript.isArrowFunction(value) || typescript.isFunctionExpression(value)) return !admission;
    if (typescript.isConditionalExpression(value)) return [value.condition, value.whenTrue, value.whenFalse]
      .every(branch => inertValue(branch, depth + 1, admission));
    if (typescript.isObjectLiteralExpression(value)) return value.properties.every(property =>
      typescript.isPropertyAssignment(property) && !typescript.isComputedPropertyName(property.name)
        && (!admission || !is_object_literal_prototype_setter(property, typescript)) && inertValue(property.initializer, depth + 1, admission)
      || typescript.isShorthandPropertyAssignment(property) && property.objectAssignmentInitializer === undefined && inertValue(property.name, depth + 1, admission)
      || !admission && typescript.isMethodDeclaration(property) && !typescript.isComputedPropertyName(property.name));
    return typescript.isTaggedTemplateExpression(value) && typescript.isNoSubstitutionTemplateLiteral(value.template)
      && typescript.isPropertyAccessExpression(value.tag) && typescript.isIdentifier(value.tag.expression)
      && (value.tag.name.text === "document" || value.tag.name.text === "schema")
      && is_official_hson_package_binding(value.tag.expression, "Hson", checker, true, typescript, sources.eligible);
  };
  for (const file of program.getSourceFiles()) {
    if (file.isDeclarationFile || program.isSourceFileFromExternalLibrary(file) || file.fileName.replaceAll("\\", "/").split("/").includes(".hson")) continue;
    const trees = read_supported_hson_import_symbols(file, checker, [], "hsonLiveTree", typescript);
    const roots = read_supported_hson_import_symbols(file, checker, [], "hson", typescript);
    if (trees.size === 0 && roots.size === 0 && !receivingFiles.has(file)) continue;
    const officialFacade = (expression: ts.Expression, root: boolean): boolean => {
      if (!typescript.isIdentifier(expression)) return false;
      const symbol = checker.getSymbolAtLocation(expression);
      if (symbol === undefined || !(root ? roots : trees).has(symbol)
        || !hson_source_alias_eligible(symbol, checker, sources.eligible, typescript, true)) return false;
      const value = checker.getAliasedSymbol(symbol).valueDeclaration;
      const origin = value === undefined ? undefined : hson_package_declaration_path(value.getSourceFile().fileName);
      return root ? origin === "src/hson.ts" || origin === "dist/hson.d.ts"
        : origin === "src/api/livetree/livetree.facade.ts" || origin === "dist/api/livetree/livetree.facade.d.ts";
    };
    const freshTree = (expression: ts.Expression): boolean => {
      const node = sources.unwrap(expression);
      if (!typescript.isCallExpression(node) || !sources.eligible(node)) return false;
      const call = literal_member(node.expression, typescript);
      if (call === undefined) return false;
      const create = literal_member(call.owner, typescript);
      if (create?.name !== "create" && !["fromHson", "fromJson", "fromNode", "fromTrustedHtml", "fromUntrustedHtml"].includes(call.name)) return false;
      const facade = create?.name === "create" ? create.owner : call.owner;
      const umbrella = literal_member(facade, typescript);
      return officialFacade(facade, false) || (umbrella?.name === "liveTree" && officialFacade(umbrella.owner, true));
    };
    const literal = (input: ts.Expression | undefined) => {
      if (input === undefined) return undefined;
      const evidence = sources.alternatives(input, "json", { reachableOnly: true });
      const only = evidence.complete && evidence.nodes.length === 1 ? evidence.nodes[0] : undefined;
      return only !== undefined && (typescript.isStringLiteral(only) || typescript.isNoSubstitutionTemplateLiteral(only)) ? only : undefined;
    };
    const report = (events: readonly EventSource[], actions: ReadonlyMap<string, ActionContractSource | undefined>): void => {
      for (const event of events) {
        const contract = actions.get(event.event.key);
        if (contract !== undefined) output.push({ ...event, contract });
      }
    };
    const directCall = (input: ts.Expression | undefined): ts.CallExpression | undefined => {
      const expression = input === undefined ? undefined : sources.unwrap(input);
      if (expression === undefined || !typescript.isCallExpression(expression)
        || (expression.flags & typescript.NodeFlags.OptionalChain) !== 0) return undefined;
      return expression;
    };
    const visit = (node: ts.Node): void => {
      if (typescript.isSourceFile(node) || typescript.isBlock(node)) {
        type Owner = {
          family: "tree" | "local" | "locus";
          actions: Map<string, ActionContractSource | undefined>;
          inputs: EventSource[];
          openActions?: true;
        };
        const owners = new Map<ts.VariableDeclaration, Owner>();
        const loci = new Map<ts.CallExpression, Owner>();
        const withdraw = (): void => { owners.clear(); loci.clear(); };
        const receiver = (identifier: ts.Identifier) => {
          const found = immutable_source_declaration(typescript, checker, identifier, sources.eligible);
          return found?.eligible ? owners.get(found.declaration) : undefined;
        };
        for (const statement of node.statements) {
          if (!sources.eligible(statement)) { withdraw(); continue; }
          const declaration = typescript.isVariableStatement(statement) && statement.declarationList.declarations.length === 1
            ? statement.declarationList.declarations[0] : undefined;
          const binding = declaration !== undefined
            && (declaration.parent.flags & typescript.NodeFlags.Const) !== 0 ? declaration : undefined;
          const initializer = declaration?.initializer === undefined ? undefined : sources.unwrap(declaration.initializer);
          if (binding !== undefined && initializer !== undefined && typescript.isIdentifier(binding.name)) {
            const alias = typescript.isIdentifier(initializer) ? receiver(initializer) : undefined;
            if (alias !== undefined) { owners.set(binding, alias); continue; }
            const awaited = typescript.isAwaitExpression(initializer);
            const construction = directCall(awaited ? initializer.expression : initializer);
            const hosted = construction === undefined ? undefined : locusEventSources.get(construction);
            const parts = awaited || construction === undefined ? undefined : localEvents.get(construction);
            const tree = freshTree(initializer);
            if (construction !== undefined && (hosted?.owner === construction || parts !== undefined || tree)) {
              // Construction arguments can invalidate earlier facts before
              // establishing the new owner.
              if (awaited || (tree ? !construction.arguments.every(argument => inertValue(argument))
                : construction.arguments.some(argument => !inertValue(argument, 0, true)))) withdraw();
              if (tree) owners.set(binding, { family: "tree", actions: new Map(), inputs: [] });
              else if (parts !== undefined) owners.set(binding, { family: "local", actions: new Map(), inputs: [...parts] });
              else if (hosted?.initialActions.complete && (hosted.operation === "resume") === awaited) {
                const owner: Owner = { family: "locus", actions: new Map(hosted.initialActions.actions), inputs: [...hosted.events] };
                owners.set(binding, owner);
                loci.set(construction, owner);
              }
              continue;
            }
          }
          const expression = typescript.isExpressionStatement(statement) ? sources.unwrap(statement.expression) : initializer;
          const call = directCall(expression !== undefined && typescript.isAwaitExpression(expression) ? expression.expression : expression);
          if (call === undefined) {
            const inertDeclaration = typescript.isVariableStatement(statement) && statement.declarationList.declarations.every(declaration =>
              typescript.isIdentifier(declaration.name) && (declaration.initializer === undefined || inertValue(declaration.initializer)));
            if (!inertDeclaration && !typescript.isImportDeclaration(statement) && !typescript.isFunctionDeclaration(statement)
              && !typescript.isTypeAliasDeclaration(statement) && !typescript.isInterfaceDeclaration(statement)) withdraw();
            continue;
          }
          const admission = locusEventSources.get(call);
          if (admission?.operation === "admit") {
            const definitions = sources.unwrap(admission.definitions);
            if (!typescript.isObjectLiteralExpression(definitions) || !inertValue(definitions, 0, true)) { withdraw(); continue; }
            const locus = loci.get(admission.owner);
            if (locus !== undefined) {
              report(admission.events, locus.actions);
              locus.inputs.push(...admission.events);
            }
            // Suspension can change the registry before a subsequent define.
            if (expression !== undefined && typescript.isAwaitExpression(expression)) withdraw();
            continue;
          }
          if (expression !== undefined && typescript.isAwaitExpression(expression)) { withdraw(); continue; }
          const method = literal_member(call.expression, typescript);
          const namespace = method === undefined ? undefined : literal_member(method.owner, typescript);
          const owner = namespace !== undefined && typescript.isIdentifier(namespace.owner) ? receiver(namespace.owner) : undefined;
          if (owner === undefined || !call.arguments.every(argument => inertValue(argument))) {
            // Argument evaluation and opaque statements can change a tree's
            // registry owner or introduce an unobserved registration.
            withdraw();
            continue;
          }
          if (method?.name === "define" && namespace?.name === "actions") {
            const name = literal(call.arguments[0]);
            const options = call.arguments[2];
            const evidence = options === undefined ? { contract: undefined } : readOptions(options);
            if (evidence === undefined) { withdraw(); continue; }
            if (name === undefined) {
              // An unknown key may already occupy the slot a later call names.
              owner.actions.clear();
              owner.openActions = true;
              continue;
            }
            if (name.text.length === 0 || call.arguments.length < 2 || call.arguments.length > 3) continue;
            if (owner.openActions || owner.actions.has(name.text) || owner.family === "locus" && is_locus_document_action_name(name.text)) continue;
            owner.actions.set(name.text, evidence.contract);
            if (evidence.contract !== undefined) for (const event of owner.inputs) {
              if (event.event.key === name.text) output.push({ ...event, contract: evidence.contract });
            }
          } else if (method?.name === "event" && namespace?.name === "listen" && owner.family === "tree") {
            const source = literal(call.arguments[0]);
            if (source === undefined || call.arguments.length !== 1) continue;
            eventLiterals.add(source);
            const map = event_range_map(source);
            let event;
            try { event = parse_authored_event(source.text); }
            catch (cause) {
              issues.push({ ...event_declaration_issue(source, map, cause),
                code: read_transform_error_details(cause)?.code === "HSON_EVENT_REFERENCE_INVALID"
                  ? "HSON_EVENT_REFERENCE_INVALID" : "HSON_EVENT_DECLARATION_INVALID" });
              continue;
            }
            if (event.kind !== "browser") continue;
            for (const argument of event.args) {
              if (argument.operand.kind === "native") continue;
              for (const site of event_argument_references(argument)) {
                const where = map({ start: site.start.index, end: site.end.index });
                if (where !== undefined) issues.push({ location: where, code: "HSON_EVENT_REFERENCE_INVALID",
                  message: standalone_event_reference_issue(site) });
              }
            }
            const contract = owner.actions.get(event.key);
            if (contract !== undefined) output.push({ event, location: location(source), map, contract });
            else if (!owner.openActions && owner.actions.size > 0 && !owner.actions.has(event.key)) {
              const start = event.actionStart.index + "local:".length;
              const where = map({ start, end: start + event.key.length });
              if (where !== undefined) issues.push({ location: where, code: "HSON_EVENT_ACTION_UNKNOWN",
                message: `Unknown local Action ${JSON.stringify(event.key)}.` });
            }
          } else withdraw();
        }
      }
      typescript.forEachChild(node, visit);
    };
    visit(file);
  }
  return output;
}

/** Shared immutable coordinate resolution for write-key completion and ingress. */
function part_write_target(typescript: typeof ts, checker: ts.TypeChecker, sources: Candidates, batches: readonly PartSourceBatch[], call: ts.CallExpression) {
  if (!typescript.isPropertyAccessExpression(call.expression) || call.expression.name.text !== "write" || call.arguments.length !== 1
    || call.questionDotToken !== undefined || call.expression.questionDotToken !== undefined) return undefined;
  const coordinate = (input: ts.Expression, depth = 0): { batch: PartSourceBatch; path: string[] } | undefined => {
    if (depth > 16 || !sources.eligible(input)) return undefined;
    const node = sources.unwrap(input);
    if (typescript.isPropertyAccessExpression(node)) {
      if (node.questionDotToken !== undefined) return undefined;
      const parent = coordinate(node.expression, depth + 1);
      return parent === undefined ? undefined : { batch: parent.batch, path: [...parent.path, node.name.text] };
    }
    if (typescript.isIdentifier(node)) {
      const binding = immutable_source_declaration(typescript, checker, node, sources.eligible);
      return !binding?.eligible || binding.declaration.initializer === undefined ? undefined : coordinate(binding.declaration.initializer, depth + 1);
    }
    const batch = batches.find(batch => batch.call === node && batch.eligible);
    return batch === undefined ? undefined : { batch, path: [] };
  };
  const owner = coordinate(call.expression.expression);
  if (owner === undefined || owner.path.length !== 3 || owner.path[0] !== "parts") return undefined;
  const libraries = owner.batch.libraries.filter(library => library.name === owner.path[1] && library.family === "parts");
  const library = libraries.length === 1 ? libraries[0] : undefined;
  const members = library?.members.filter(member => member.name === owner.path[2]);
  const documents = members?.length === 1 ? members[0]!.documents : undefined;
  const definition = documents?.length === 1 ? documents[0] : undefined;
  return definition?.parameterCompleteness === "complete" && library !== undefined ? { batch: owner.batch, library, definition } : undefined;
}

/** Advisory write-key evidence from an immutable coordinate expression. A later governed
 * replacement may change its interface; this is completion evidence, never a TS type. */
export function part_write_context(typescript: typeof ts, program: ts.Program, facts: PartSourceFacts,
  fileName: string, offset: number): Readonly<{ names: readonly string[]; start: number; end: number; quote?: "'" | '"'; assignment: boolean }> | undefined {
  const file = program.getSourceFile(fileName);
  if (file === undefined) return undefined;
  const sources = static_source_candidates(typescript, program.getTypeChecker(), program);
  let call: ts.CallExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (node.getStart(file) > offset || node.end < offset) return;
    if (typescript.isCallExpression(node) && typescript.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === "write" && node.arguments.length === 1
      && typescript.isObjectLiteralExpression(node.arguments[0]!) && node.arguments[0]!.getStart(file) < offset && offset < node.arguments[0]!.end) call = node;
    typescript.forEachChild(node, visit);
  };
  visit(file);
  if (call === undefined) return undefined;
  const definition = part_write_target(typescript, program.getTypeChecker(), sources, facts.batches, call)?.definition;
  if (definition === undefined) return undefined;
  const argument = call.arguments[0]!;
  if (!typescript.isObjectLiteralExpression(argument)) return undefined;
  let start = offset, end = offset, assignment = false, namedProperty = false;
  let quote: "'" | '"' | undefined;
  let previous: ts.ObjectLiteralElementLike | undefined;
  const existing = new Set<string>();
  for (const property of argument.properties) {
    if (typescript.isSpreadAssignment(property) || property.name === undefined || typescript.isComputedPropertyName(property.name)) return undefined;
    if (property.getStart(file) <= offset && offset <= property.end) {
      // A named method/accessor is not a key/value slot, even without a colon.
      if (!typescript.isPropertyAssignment(property) && !typescript.isShorthandPropertyAssignment(property)) return undefined;
      const children = property.getChildren(file);
      // Recovery can retain modifiers, ?/!, or defaults on ordinary member kinds.
      if (property.getStart(file) !== property.name.getStart(file)
        || typescript.isShorthandPropertyAssignment(property) && property.end !== property.name.end
        || children.some(child => child.kind === typescript.SyntaxKind.QuestionToken || child.kind === typescript.SyntaxKind.ExclamationToken)) return undefined;
      // Other recovered punctuation can sit just outside the member's AST span.
      const scanner = typescript.createScanner(typescript.ScriptTarget.Latest, true, file.languageVariant, file.text);
      scanner.setTextPos(property.end);
      const boundary = scanner.scan();
      if (boundary !== typescript.SyntaxKind.CommaToken && boundary !== typescript.SyntaxKind.CloseBraceToken) return undefined;
      namedProperty = true;
      if (!typescript.isIdentifier(property.name) && !typescript.isStringLiteral(property.name)) return undefined;
      start = property.name.getStart(file); end = property.name.end;
      if (typescript.isStringLiteral(property.name)) {
        const delimiter = file.text[start];
        if (delimiter !== '"' && delimiter !== "'") return undefined;
        quote = delimiter; start++; if (!property.name.isUnterminated) end--;
      }
      if (offset < start || offset > end) return undefined;
      assignment = children.some(child => child.kind === typescript.SyntaxKind.ColonToken && child.getWidth(file) > 0);
    } else if (typescript.isIdentifier(property.name) || typescript.isStringLiteral(property.name)) existing.add(property.name.text);
    if (property.end < offset) previous = property;
  }
  if (!namedProperty) {
    // A missing initializer can end before the cursor. Only trivia after an
    // opening brace or a member separator establishes a new property slot.
    const scanner = typescript.createScanner(typescript.ScriptTarget.Latest, false, file.languageVariant, file.text);
    scanner.setTextPos(previous?.end ?? argument.getStart(file) + 1);
    let separated = previous === undefined;
    while (scanner.getTextPos() < offset) {
      const token = scanner.scan();
      if (scanner.getTokenEnd() > offset) {
        if (token !== typescript.SyntaxKind.WhitespaceTrivia && token !== typescript.SyntaxKind.NewLineTrivia) return undefined;
        break;
      }
      if (token === typescript.SyntaxKind.WhitespaceTrivia || token === typescript.SyntaxKind.NewLineTrivia
        || token === typescript.SyntaxKind.MultiLineCommentTrivia && !scanner.isUnterminated()) continue;
      if (token === typescript.SyntaxKind.SingleLineCommentTrivia && scanner.getTokenEnd() < offset) continue;
      if (token !== typescript.SyntaxKind.CommaToken || separated) return undefined;
      separated = true;
    }
    if (!separated) return undefined;
  }
  let prefix = file.text.slice(start, offset), invalid = false;
  if (prefix.length || quote !== undefined) {
    const raw = quote === undefined ? prefix : quote + prefix + quote;
    const scanner = typescript.createScanner(typescript.ScriptTarget.Latest, false, file.languageVariant, raw, () => { invalid = true; });
    const token = scanner.scan();
    if (invalid || scanner.isUnterminated() || scanner.getTokenEnd() !== raw.length
      || (quote === undefined ? !scanner.isIdentifier() && !scanner.isReservedWord() : token !== typescript.SyntaxKind.StringLiteral)) return undefined;
    prefix = scanner.getTokenValue();
  }
  return { names: definition.parameters.map(parameter => parameter.name).filter(name => !existing.has(name) && name.startsWith(prefix)), start, end,
    assignment, ...(quote === undefined ? {} : { quote }) };
}
