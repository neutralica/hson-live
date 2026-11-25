import { action_args_keys_valid, action_args_schema_is_data } from "../action-args.js";
import { ANY_DATA, compiled_hson_schema_of } from "../../api/schema/hson-schema.js";
import { part_scalar_operand } from "../part-scalar.js";
import { decode_part_string_sigils, part_literal_sigils } from "../part-scalar-source.js";
import { event_argument_references, standalone_event_reference_issue, type AuthoredEventReference } from "../authored-events.js";
import type { PartEvent } from "../part-events.js";
import { is_event_attachment_attribute } from "../../core/authored-event-names.js";
import { read_transform_error_details } from "../../core/errors.js";
import { is_hson_bare_name_char } from "../../core/hson-name.js";
import { part_coordinates } from "../part-coordinates.js";
import { analyze_part_definition, transform_part_parameter_strings, type PartEventAlternative, type PartEventEvidence, type PartLocalDeclaration, type PartDefinitionAnalysis, type PartReferenceUse } from "../part-definition.js";
import type ts from "typescript";
import type { HsonNode } from "../../core/types.js";
import { is_Node, is_ordinary_element_node } from "../../core/node-guards.js";
import { selected_hson_value_declaration, hson_package_declaration_path, package_value_import, is_official_hson_package_binding, read_supported_hson_import_symbols } from "../embedded-hson/discover-hson-tagged-templates.js";
import { hson_tagged_source, admit_hson_tagged_source, admit_hson_tagged_template, hson_tagged_literal } from "../embedded-hson/hson-tagged-source-admission.js";
import { interpolation_site, map_interpolation_range, type GeneratedSegment } from "../trusted-schema-diagnostics/interpolation-source.js";
import { static_hson_literal_correspondence, map_static_hson_range } from "../embedded-hson/static-hson-source.js";
import type { HsonSourceLexicalCollector, HsonSourceRange } from "../hson-source-provenance/hson-source-provenance.js";
import { tokenize_authored_document_library, scan_hson_template_segments, hson_grammar_checkpoint, hson_interpolation_roles, type HsonTemplateSlot } from "../../api/transform/parsers/tokenize-hson.js";
import { split_attrs_meta } from "../../api/transform/utils/hson-utils/split-attrs-meta.js";
import { qualify_authored_document_source } from "../../api/document/hson-authored.js";
import { read_part_member_source, validate_part_collection } from "../../api/livemap/livemap.parts.js";
import { parse_authored_document_library } from "../../api/livemap/livemap.document.quad.js";
import { is_locus_document_action_name } from "../../api/locus/locus.document-actions.js";
import { admit_projected_value } from "../../core/projected-value-admission.js";
import { normalize_part_css_authoring } from "../../core/part-css-authoring.js";
import { PART_DECLARATION, is_part_scalar_qualifier, type PartArgumentKind, type PartQualifier, part_declaration_issue, part_direction_issue, part_argument_name, PART_OPTIONAL, has_part_reference, part_optional_issue, is_part_iterator_attribute, part_iterator_declaration, is_part_receiving_attribute, part_receiving_declaration, part_placeholder_matches, whole_part_reference, part_placeholder_placement_issue, type PartIteratorDeclaration, type PartReference } from "../part-placeholder.js";
import { library_source_admission, library_source_field_candidates, library_source_fields, is_object_literal_prototype_setter, literal_member, official_library_constructor, official_library_source } from "./library-source.js";
import { is_event_const_declaration, PartOwnershipWork, static_source_candidates } from "./source-candidates.js";
import { annotated_data_schema_provenance, resolve_hson_schema_annotation } from "./schema-annotation.js";
import { evaluate_static_schema_candidate } from "./candidate-evaluation.js";
import { immutable_source_declaration } from "./schema-identity.js";
import type { DiscoveredHsonSchemaDeclaration } from "./schema-discovery.js";
import { compile_hson_schema, type CompiledHsonSchema } from "./compiler.js";
import { static_event_parser } from "./static-event-parser.js";
import { OBJECT_VALUE, type SchemaDataPath } from "./data-projection.js";
import { project_part_bindings, parse_part_binding_source, type PartBindingSources } from "../editor-introspection/part-bindings.js";

type Completeness = "complete" | "partial" | "unknown";
export type PartSourceLocation = HsonSourceRange & Readonly<{ file: string; precision: "exact" | "anchor" }>;
type PartReferenceIssueSource = { location: PartSourceLocation; message: string; declaration?: PartSourceLocation; attachment?: PartSourceLocation };
export type EventSource = Readonly<{
  event: PartEvent;
  location: PartSourceLocation;
  map: SourceRangeMap;
}>;
type SourceRangeMap = (range: HsonSourceRange) => PartSourceLocation | undefined;
type EventIssueSource = PartReferenceIssueSource & Readonly<{ code: string }>;
export type EventLiteral = ts.StringLiteral | ts.NoSubstitutionTemplateLiteral;
export type EventLiteralUse = "part" | "document";
type EventAttachmentSource = Readonly<{ location: PartSourceLocation; part?: PartDocumentSource }>;
export type ActionDeclarationSource = Readonly<{
  owner: ts.CallExpression;
  domain: "host" | "local";
  name: string;
  location: PartSourceLocation;
  required?: boolean;
  requiredLocation?: PartSourceLocation;
  schema?: Readonly<{ value: CompiledHsonSchema; location: PartSourceLocation }>;
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
  /** Explicit receiving kinds can survive an invalid or unavailable Event attachment. */
  declaredWriteKinds?: ReadonlyMap<string, PartArgumentKind>;
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
    knownWriteTarget: boolean;
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
  /** Only individually established scalar checks survive a partial write record. */
  partial?: true;
  arguments: readonly Readonly<{ name: string; kind: PartArgumentKind; expression: ts.Expression;
    nameLocation: PartSourceLocation; valueLocation: PartSourceLocation; dataEvidence?: PartDataSchemaEvidence }>[];
}>;
/** Program-snapshot facts, owned by the compiler. No registry, runtime identity or durable cache. */
export type PartSourceFacts = Readonly<{
  batches: readonly PartSourceBatch[];
  documents: readonly PartDocumentSource[];
  writes: readonly PartWriteSource[];
  actionDeclarations: readonly ActionDeclarationSource[];
  inlineEventLiterals: ReadonlySet<EventLiteral>;
  eventOwners: ReadonlyMap<EventLiteral, ReadonlySet<ts.CallExpression>>;
  parsedEvents: ReadonlyMap<EventLiteral, EventSource>;
  eventAttachments: ReadonlyMap<EventLiteral, readonly EventAttachmentSource[]>;
  eventIssues: readonly EventIssueSource[];
  eventLiterals: ReadonlyMap<EventLiteral, ReadonlySet<EventLiteralUse>>;
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

function event_producer(typescript: typeof ts, sources: Candidates, node: ts.Expression) {
  if (typescript.isStringLiteral(node) || typescript.isNoSubstitutionTemplateLiteral(node)) {
    return { literal: node, tagged: false, map: event_range_map(node), parse: () => sources.parseEvent.part(node.text) };
  }
  if (!typescript.isTaggedTemplateExpression(node) || !typescript.isNoSubstitutionTemplateLiteral(node.template)) return undefined;
  const tagged = sources.eventSource(node, "attachment");
  if (tagged === undefined) return undefined;
  const template = hson_tagged_literal(tagged);
  const map: SourceRangeMap = range => {
    const start = template.boundaries[range.start], end = template.boundaries[range.end];
    return start === undefined || end === undefined ? undefined : { file: tagged.fileName, start, end, precision: "exact" };
  };
  return { literal: node.template, tagged: true, map, parse: () => sources.parseEvent.tagged(tagged, template.raw) };
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
function part_value(typescript: typeof ts, sources: Candidates, input: ts.Expression, work: PartOwnershipWork, depth: number): ReturnType<Candidates["jsonLiteral"]> {
  const inspected = sources.inspectExpression(input, work, depth);
  if (!inspected || !sources.eligibility(work)(input)) return { known: false };
  return sources.jsonLiteral(inspected.node, (node, childDepth) => {
    const possible = sources.candidates(node, "document", work, childDepth);
    const only = possible?.length === 1 ? possible[0] : undefined;
    if (only === undefined) {
      // Collection validation reads the general authored value; it creates no Event attachment.
      const values = sources.alternatives(node, "document", { work, depth: childDepth });
      const event = values.complete && values.nodes.length === 1 ? sources.eventSource(values.nodes[0]!, "collection", work) : undefined;
      if (event === undefined) return undefined;
      const { raw } = hson_tagged_literal(event);
      try { sources.parseEvent.tagged(event, raw); return raw; } catch { return undefined; }
    }
    if (!("source" in only) || only.family !== "document") return undefined;
    if (!typescript.isTaggedTemplateExpression(only.node)) return only.source;
    const source = hson_tagged_source(typescript, only.node, "document");
    if (source === undefined || "substitutionRanges" in source) return undefined;
    try { return admit_hson_tagged_source(source); } catch { return undefined; }
  }, work, inspected.depth);
}

/** An independently selected input contract can survive opaque Event metadata.
 * Check the observed non-Event fields through the same reader as runtime admission. */
function part_write_source(typescript: typeof ts, sources: Candidates, name: string, record: ts.ObjectLiteralExpression,
  fields: ReadonlyMap<string, ts.Expression>, document: PartDocumentSource, work: PartOwnershipWork, depth: number): boolean {
  if (!sources.projectablePrototype(record, work, depth) || document.librarySourceAdmission !== "qualified"
    || !document.signature && !document.declaredWriteKinds) return false;
  const kind = fields.get("kind");
  const kinds = kind && sources.candidates(kind, "json", work, depth + 2);
  if (!kinds?.length || !kinds.every(candidate => "json" in candidate && candidate.json === "document")) return false;
  const source = part_value(typescript, sources, document.producer, work, depth + 2);
  if (!source.known) return false;
  const observed: Record<string, unknown> = { kind: "document", document: source.value };
  for (const [key, expression] of fields) {
    if (!work.charge()) return false;
    if (key === "kind" || key === "document" || key === "events") continue;
    if (key !== "css" && key !== "stylesheet") return false;
    const style = sources.partStyleLiteral(expression, work, depth + 2);
    if (!style.known) return false;
    observed[key] = style.value;
  }
  try { read_part_member_source(name, admit_projected_value(normalize_part_css_authoring(observed, [name]))); return true; }
  catch { return false; }
}

/** One complete collection validator determines eligibility and the enumerated keys together. */
function part_collection_evidence(typescript: typeof ts, sources: Candidates, input: ts.Expression, work: PartOwnershipWork, depth: number) {
  const value = part_value(typescript, sources, input, work, depth);
  if (!value.known) return undefined;
  try { return { value: value.value, members: validate_part_collection(admit_projected_value(value.value), sources.parseEvent.part) }; }
  catch { return undefined; }
}

/** A referenced collection requires full admission, including unused members. */
export function static_part_collection(typescript: typeof ts, sources: Candidates, definition: ts.Expression, work: PartOwnershipWork, depth: number) {
  if (!typescript.isObjectLiteralExpression(definition)) return undefined;
  const fields = sources.libraryFields(definition, work, depth);
  const input = fields?.get("parts");
  return input !== undefined && fields?.size === 1
    ? part_collection_evidence(typescript, sources, input, work, depth + 2)?.value : undefined;
}

/** Individually proved same-batch collections. A missing entry supplies no absence proof. */
export function static_part_inventory(typescript: typeof ts, checker: ts.TypeChecker, definitions: ts.ObjectLiteralExpression,
  sources = static_source_candidates(typescript, checker)): ReadonlyMap<string, unknown> {
  const inventory = sources.libraryInventory(definitions, "part-record");
  const parts = new Map<string, unknown>();
  if (inventory.completeness !== "complete") return parts;
  for (const [name, definition] of inventory.fields) {
    const value = static_part_collection(typescript, sources, definition, inventory.work.fork(), inventory.depth + 2);
    if (value !== undefined) parts.set(name, value);
  }
  return parts;
}

/** Bounded, demand-driven facts over existing official sources and receiving candidates. */
const sourceFacts = new WeakMap<ts.Program, PartSourceFacts>();
export function collect_part_source_facts(typescript: typeof ts, program: ts.Program, parseEvent = static_event_parser()): PartSourceFacts {
  const cached = sourceFacts.get(program);
  if (cached !== undefined) return cached;
  const checker = program.getTypeChecker(), sources = static_source_candidates(typescript, checker, program, parseEvent);
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
    const validated = candidates !== undefined && candidates.length > 0 && candidates.every(candidate => evaluate_static_schema_candidate(schema, candidate, "data").kind === "valid");
    const result: PartDataSchemaEvidence = { schema, strength: validated ? "validated" : "advisory",
      schemaLocation: location(provenance.declaration), annotationLocation: location(declaration.type),
      valueLocation: location(declaration.initializer ?? declaration) };
    evidence.set(declaration, result);
    return result;
  };
  const documents = new Map<ts.Expression, PartDocumentSource>();
  const relationships = new Map<PartDocumentSource, PartDocumentSource["receivers"][number][]>();
  const coordinateRecord = (input: ts.Expression, work: PartOwnershipWork, depth = 0, scope: "batch" | "nested" = "nested") => {
    const possible = sources.alternatives(input, "part-record", { work, depth, recordContents: "coordinate" });
    const node = possible.nodes[0];
    if (!node || !typescript.isObjectLiteralExpression(node)) return undefined;
    const recordDepth = possible.depth ?? depth;
    // The bounded own-key pass establishes batch entries. Nested records can
    // have prototype-sensitive admission, including inherited Library metadata.
    const qualified = possible.complete && (scope === "batch" || sources.projectablePrototype(node, work, recordDepth));
    return { node, fresh: possible.direct === true, qualified, depth: recordDepth };
  };
  const coordinateFields = (record: ReturnType<typeof coordinateRecord>, work: PartOwnershipWork) => {
    if (!record) return undefined;
    if (record.qualified) {
      const fields = library_source_field_candidates(record.node, typescript, undefined, relative => work.charge(1, record.depth + relative));
      if (!work.exhausted) return fields;
    }
    // Lexical observations can outlive an unavailable ownership witness.
    return library_source_field_candidates(record.node, typescript);
  };
  const recordFields = (node: ts.ObjectLiteralExpression, work?: PartOwnershipWork, depth = 0) => {
    if (work && !work.exhausted) {
      const fields = library_source_fields(node, typescript, relative => work.charge(1, depth + relative));
      if (!work.exhausted) return fields;
    }
    return library_source_fields(node, typescript);
  };
  type EventSources = Readonly<{
    events: PartEventEvidence | null;
    ranges: ReadonlyMap<PartReference, Readonly<{ map: SourceRangeMap; site: AuthoredEventReference }>>;
    declarations: ReadonlyMap<PartEvent, EventSource>;
    issues: readonly PartReferenceIssueSource[];
    issuesByName: ReadonlyMap<string, PartReferenceIssueSource>;
    literals: ReadonlySet<EventLiteral>;
    literalsByName: ReadonlyMap<string, EventLiteral>;
  }>;
  const missingEvents: EventSources = { events: null, ranges: new Map(), declarations: new Map(),
    issues: [], issuesByName: new Map(), literals: new Set(), literalsByName: new Map() };
  const adjacent = new Map<ts.Expression, EventSources>();
  const contextual = new Map<ts.Expression, Map<EventSources, PartDocumentSource>>();
  const attachedLiterals = new Map<PartDocumentSource, readonly [EventLiteral, PartSourceLocation][]>();
  const inlineEventLiterals = new Set<EventLiteral>();
  const eventOwners = new Map<EventLiteral, Set<ts.CallExpression>>();
  const actionDeclarations: ActionDeclarationSource[] = [];
  const actionCalls: ts.CallExpression[] = [];
  const owners = new Map<ts.CallExpression, ActionDeclarationSource["domain"]>();
  const parsedEvents = new Map<EventLiteral, EventSource>();
  const eventAttachments = new Map<EventLiteral, EventAttachmentSource[]>();
  const associate = (literal: EventLiteral, owner: ts.CallExpression, attachment: EventAttachmentSource) => {
    const found = eventOwners.get(literal) ?? new Set<ts.CallExpression>();
    found.add(owner);
    eventOwners.set(literal, found);
    const attachments = eventAttachments.get(literal) ?? [];
    attachments.push(attachment);
    eventAttachments.set(literal, attachments);
  };
  const eventIssues: EventIssueSource[] = [];
  const eventLiterals = new Map<EventLiteral, Set<EventLiteralUse>>();
  const noteEventLiteral = (literal: EventLiteral, use?: EventLiteralUse): void => {
    const uses = eventLiterals.get(literal) ?? new Set<EventLiteralUse>();
    if (use !== undefined) uses.add(use);
    eventLiterals.set(literal, uses);
  };
  const reachable: { reachableOnly: true } = { reachableOnly: true };
  const actionSchema = (input: ts.Expression): CompiledHsonSchema | undefined => {
    const compile = (source: string) => {
      if (!schemas.has(source)) {
        const compiled = compile_hson_schema(source);
        schemas.set(source, compiled.ok ? compiled.value : undefined);
      }
      return schemas.get(source);
    };
    const expression = sources.declarationSource(input, (site, symbol) => {
      const statement = site.parent.parent.parent;
      if ((site.propertyName ?? site.name).text !== "ANY_DATA" || !typescript.isStringLiteral(statement.moduleSpecifier)
        || !["hson-live", "hson-live/hson"].includes(statement.moduleSpecifier.text)) return false;
      const target = package_value_import(typescript, checker, symbol, sources.eligible);
      const file = target?.valueDeclaration?.getSourceFile();
      const origin = file && hson_package_declaration_path(file.fileName);
      return target?.name === "ANY_DATA" && (origin === "src/api/schema/hson-schema.ts" || origin === "dist/api/schema/hson-schema.d.ts");
    });
    // An identifier can only terminate this traversal at the verified import.
    if (expression && typescript.isIdentifier(expression)) return compiled_hson_schema_of(ANY_DATA);
    if (expression && typescript.isTaggedTemplateExpression(expression) && typescript.isPropertyAccessExpression(expression.tag)
      && expression.tag.name.text === "schema" && typescript.isIdentifier(expression.tag.expression)
      && is_official_hson_package_binding(expression.tag.expression, "Hson", checker, true, typescript, sources.eligible, "package")
      && typescript.isNoSubstitutionTemplateLiteral(expression.template)) {
      try { return compile(admit_hson_tagged_template(typescript, expression, "schema")); }
      catch { return undefined; }
    }
  };
  const directRecord = (input: ts.Expression | undefined) => {
    while (input && typescript.isParenthesizedExpression(input)) input = input.expression;
    return input && typescript.isObjectLiteralExpression(input) && sources.eligible(input)
      && input.properties.every(property => property.name !== undefined
        && (typescript.isIdentifier(property.name) || typescript.isStringLiteral(property.name))
        && !is_object_literal_prototype_setter(property, typescript)) ? input : undefined;
  };
  const directFields = (input: ts.Expression | undefined) => {
    const record = directRecord(input);
    return record && library_source_fields(record, typescript);
  };
  const actionContract = (input: ts.Expression | undefined) => {
    const args = directFields(input);
    if (!args || !action_args_keys_valid([...args.keys()], "args")) return {};
    const flag = args.get("required"), schemaInput = args.get("schema");
    const required = flag && sources.declarationSource(flag);
    const schema = schemaInput && actionSchema(schemaInput);
    return {
      ...(flag && required?.kind === typescript.SyntaxKind.TrueKeyword ? { required: true, requiredLocation: location(sources.unwrap(flag)) }
        : required?.kind === typescript.SyntaxKind.FalseKeyword ? { required: false } : {}),
      ...(schemaInput && schema && action_args_schema_is_data(schema.graph) ? { schema: { value: schema, location: location(sources.unwrap(schemaInput)) } } : {}),
    };
  };
  const startupDeclarations = (owner: ts.CallExpression) => {
    const config = directRecord(owner.arguments[1]);
    const fields = config && library_source_field_candidates(config, typescript, { methods: true });
    const table = fields?.complete ? directRecord(fields.fields.find(field => field.name === "actions")?.value) : undefined;
    if (!table) return;
    const entries = library_source_field_candidates(table, typescript, { methods: true });
    if (!entries.complete) return;
    for (const { name, value, declaration } of entries.fields) {
      if (!name || is_locus_document_action_name(name)) continue;
      const record = directRecord(value);
      const fields = record && library_source_field_candidates(record, typescript, { methods: true });
      if (fields && (!fields.complete || fields.fields.some(field => field.name !== "handler" && field.name !== "args"))) continue;
      const entry = fields?.fields.find(field => field.name === "handler");
      const handler = entry?.value ?? entry?.declaration ?? value ?? declaration;
      if (!checker.getTypeAtLocation(handler).getCallSignatures().length) continue;
      actionDeclarations.push({ owner, domain: "host", name, location: location(declaration.name ?? declaration),
        ...actionContract(fields?.fields.find(field => field.name === "args")?.value) });
    }
  };
  // A literal Library declaration has an authored statement or initializer.
  // A factory return or nested arbitrary expression has no declared Event owner.
  const declarationSite = (call: ts.CallExpression) => {
    let value: ts.Expression = call;
    while (typescript.isParenthesizedExpression(value.parent) || typescript.isAwaitExpression(value.parent)) value = value.parent;
    const parent = value.parent;
    if (typescript.isExpressionStatement(parent)) return typescript.isSourceFile(parent.parent);
    return typescript.isVariableDeclaration(parent) && parent.initializer === value && !parent.type
      && typescript.isIdentifier(parent.name) && typescript.isVariableDeclarationList(parent.parent)
      && is_event_const_declaration(typescript, parent) && typescript.isVariableStatement(parent.parent.parent)
      && typescript.isSourceFile(parent.parent.parent.parent)
      && !parent.parent.parent.modifiers?.some(modifier => modifier.kind === typescript.SyntaxKind.DeclareKeyword)
      && selected_hson_value_declaration(typescript, checker, checker.getSymbolAtLocation(parent.name), sources.eligible) === parent;
  };
  const eventOwnerDomain = (call: ts.CallExpression) => {
    const cached = owners.get(call);
    if (cached) return cached;
    if (!declarationSite(call) || call.arguments.some(typescript.isSpreadElement)) return undefined;
    const symbols = read_supported_hson_import_symbols(call.getSourceFile(), checker, [], "hsonLiveMap", typescript);
    const construction = official_library_constructor(call, checker, symbols, typescript, sources.eligible, true);
    if (!construction?.eligible) return undefined;
    const domain = construction.family === "locus" ? "host" : "local";
    owners.set(call, domain);
    return domain;
  };
  const eventSources = (input: ts.Expression): EventSources => {
    const cached = adjacent.get(input);
    if (cached !== undefined) return cached;
    const ranges = new Map<PartReference, { map: SourceRangeMap; site: AuthoredEventReference }>();
    const declarations = new Map<PartEvent, EventSource>();
    const issues = new Map<ts.Expression, PartReferenceIssueSource>();
    const issuesByName = new Map<string, PartReferenceIssueSource>();
    const literals = new Set<EventLiteral>();
    const producers = new Map<ts.Expression, EventLiteral>();
    const literalsByName = new Map<string, EventLiteral>();
    const parsed = new Map<ts.Expression, PartEventAlternative>();
    const declaration = (node: ts.Expression): PartEventAlternative => {
      if (!sources.eligible(node)) return "opaque";
      const previous = parsed.get(node);
      if (previous !== undefined) return previous;
      const producer = event_producer(typescript, sources, node);
      if (producer === undefined) return "opaque";
      const { literal, map } = producer;
      literals.add(literal);
      producers.set(node, literal);
      noteEventLiteral(literal);
      try {
        const body = producer.parse();
        // Source facts index reference objects by occurrence within this table.
        const event: PartEvent = { ...body, args: body.args.map(argument => {
          const { operand } = argument;
          const site = (source: AuthoredEventReference) => ({ ...source, reference: { ...source.reference } });
          if (operand.kind === "reference") return { ...argument, operand: { ...operand, site: site(operand.site) } };
          if (operand.kind === "interpolation") return { ...argument, operand: { ...operand, sites: operand.sites.map(site) } };
          return argument;
        }) };
        parsed.set(node, event);
        for (const argument of event.args) for (const site of event_argument_references(argument)) {
          if (argument.operand.kind !== "native") ranges.set(site.reference, { map, site });
        }
        const source = { event, map, location: location(node) };
        declarations.set(event, source);
        parsedEvents.set(literal, source);
        return event;
      } catch (cause) {
        // Preserve the attachment identity for editing through parser failures.
        parsed.set(node, "opaque");
        if (!producer.tagged) issues.set(node, event_declaration_issue(literal, map, cause));
        return "opaque";
      }
    };
    const table = directRecord(input);
    const fields = table && library_source_fields(table, typescript);
    const values = new Map<string, PartEventAlternative>();
    for (const [name, value] of fields ?? []) {
      const producer = sources.declarationSource(value);
      values.set(name, producer === undefined ? "opaque" : declaration(producer));
      if (producer === undefined) continue;
      const issue = issues.get(producer);
      if (issue !== undefined) issuesByName.set(name, issue);
      const literal = producers.get(producer);
      if (literal !== undefined) {
        literalsByName.set(name, literal);
        if (sources.unwrap(value) === producer) inlineEventLiterals.add(literal);
      }
    }
    const events: PartEventEvidence = {
      get(name) {
        const value = values.get(name);
        return value === undefined ? fields === undefined ? ["opaque"] : undefined : [value];
      },
    };
    const result = { events, ranges, declarations, issues: [...issues.values()], issuesByName, literals, literalsByName };
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
    let declaredWriteKinds: PartDocumentSource["declaredWriteKinds"];
    const literals: [EventLiteral, PartSourceLocation][] = [];
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
        let validBindings = referenceIssues.length === 0;
        const analysis = analyze_part_definition(root, issue => {
          if (!lexicalComplete || issue.use?.conditional) return;
          if (issue.use?.context !== "event" && !(issue.attribute && is_event_attachment_attribute(issue.attribute))) validBindings = false;
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
        }, adjacentEvents?.events, (node, attribute) => {
          if (!lexicalComplete) return;
          const attachment = nodeLocation(node, attribute);
          const name = attribute.slice("event:".length);
          const literal = adjacentEvents?.literalsByName.get(name);
          if (literal !== undefined) { noteEventLiteral(literal, "part"); literals.push([literal, attachment]); }
          const issue = adjacentEvents?.issuesByName.get(name);
          if (issue !== undefined) {
            attachedEventIssues.add(issue);
            referenceIssues.push({ ...issue, attachment });
          }
        });
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
            && !(is_part_scalar_qualifier(declaration.kind) && opaqueScopes.length > 0)
            && !(declaration.kind === "data" && opaqueScopes.some(scope => scope?.get(declaration.name) === declaration))) {
            referenceIssues.push({ location: declarationLocation(declaration), message: `Unused Part ${declaration.kind} binding ${JSON.stringify(declaration.name)}.` });
          }
          for (const name of analysis.parameters.keys()) names.add(name);
          parameterCompleteness = analysis.opaqueEvents.size === 0 && referenceIssues.length === 0 ? "complete" : "unknown";
          const element = root.$_content[0];
          if (root.$_content.length === 1 && is_ordinary_element_node(element)
            && element.$_tag.toLowerCase() !== "hson-part" && partDeclarations.some(flag => flag.root && flag.issue === undefined)
            && optionalStructures.every(flag => flag.issue === undefined)) {
            if (referenceIssues.length === 0) signature = { parameters: analysis.parameters, requiredness: analysis.requiredness };
            else if (validBindings) declaredWriteKinds = new Map(analysis.receiving.map(local => [local.receiving.reference.name, local.kind]));
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
      parameterCompleteness, ...(declaredWriteKinds === undefined ? {} : { declaredWriteKinds }), ...(signature === undefined ? {} : { signature }), optionalStructures, receivingDeclarations: spellingEligible ? receivingDeclarations : [],
      ...(bindingSources === undefined ? {} : { bindingSources }),
      iteratorDeclarations: spellingEligible ? iteratorDeclarations : [], lexicalScopes: spellingEligible ? lexicalScopes : [], referenceIssues, receivers };
    if (adjacentEvents === undefined) documents.set(producer, result);
    else {
      const contexts = contextual.get(producer) ?? new Map<EventSources, PartDocumentSource>();
      contexts.set(adjacentEvents, result);
      contextual.set(producer, contexts);
    }
    relationships.set(result, receivers);
    if (literals.length > 0) attachedLiterals.set(result, literals);
    return result;
  };
  const linkPartEvents = (input: ts.Expression, events: EventSources, work: PartOwnershipWork, depth: number) => {
    const producer = sources.declarationSource(input, undefined, work, depth);
    if (producer === undefined) return undefined;
    if (typescript.isTaggedTemplateExpression(producer) && typescript.isPropertyAccessExpression(producer.tag)
      && typescript.isIdentifier(producer.tag.expression)
      && !is_official_hson_package_binding(producer.tag.expression, "Hson", checker, true, typescript, sources.eligibility(work), "package")) return undefined;
    return { producer, events };
  };
  const alternatives = (input: ts.Expression, options?: typeof reachable, work?: PartOwnershipWork, depth = 0,
    link?: ReturnType<typeof linkPartEvents>) => {
    // General Part alternatives retain their own source rules. Only the exact
    // producer reached by the finite Event link receives the adjacent table.
    const possible = sources.alternatives(input, "document", { ...options, work, depth });
    const found = possible.nodes.flatMap(node => {
      const observed = document(node, node === link?.producer ? link.events : undefined);
      return observed === undefined ? [] : [observed];
    });
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
        if (typescript.isPropertyAccessExpression(node.expression) && node.expression.name.text === "define"
          && typescript.isPropertyAccessExpression(node.expression.expression) && node.expression.expression.name.text === "actions") actionCalls.push(node);
        const admission = library_source_admission(node, checker, mapSymbols, false, typescript, sources.eligible);
        if (admission !== undefined) {
          const eligible = admission.eligible && sources.eligible(admission.definitions);
          const batchWork = new PartOwnershipWork();
          const definitions = coordinateRecord(admission.definitions, batchWork, 0, "batch");
          const fields = coordinateFields(definitions, batchWork);
          const qualifiedBatch = eligible && definitions?.qualified && !batchWork.exhausted;
          const incremental = admission.operation === "admit" || admission.operation === "addLibraries";
          const owner = eligible && declarationSite(node) && !node.arguments.some(typescript.isSpreadElement) && (!incremental || sources.declarationSource(admission.receiver) === admission.owner)
            && eventOwnerDomain(admission.owner) ? admission.owner : undefined;
          const hosted = admission.operation === "create" || admission.operation === "resume" || admission.operation === "admit";
          if (owner && hosted && !incremental) startupDeclarations(owner);
          const literalBatch = owner !== undefined && fields?.complete === true && directRecord(admission.definitions) !== undefined;
          const libraries: PartLibrarySource[] = [];
          for (const entry of fields?.fields ?? []) {
            const libraryWork = qualifiedBatch ? batchWork.fork() : new PartOwnershipWork();
            const definition = entry.value === undefined ? undefined : coordinateRecord(entry.value, libraryWork,
              qualifiedBatch ? definitions.depth + 2 : 0);
            const own = definition === undefined ? undefined : recordFields(definition.node,
              definition.qualified ? libraryWork : undefined, definition.depth);
            const parts = own?.get("parts"), body = own?.get("document");
            const access = own?.get("access");
            const accessValues = access === undefined ? undefined : sources.candidates(access, "json",
              definition?.qualified ? libraryWork : new PartOwnershipWork(), (definition?.depth ?? 0) + 2);
            const validParts = parts !== undefined && (own?.size === 1 || hosted && own?.size === 2
              && accessValues !== undefined && accessValues.length > 0
              && accessValues.every(value => "json" in value && (value.json === "private" || value.json === "shared")));
            const hasData = own?.has("json") || own?.has("hson");
            const exclusiveData = !!own?.has("json") !== !!own?.has("hson");
            const family = own?.has("data") ? "unknown" : validParts ? "parts" : body !== undefined && !hasData && parts === undefined ? "document"
              : exclusiveData && body === undefined && parts === undefined ? "data" : "unknown";
            const directMetadata = literalBatch && directRecord(entry.value) !== undefined;
            const documentShape = own && [...own.keys()].every(key => ["document", "events", "schema", "stylesheet"].includes(key)
              || key === "access" && hosted && accessValues?.every(value => "json" in value && (value.json === "shared" || value.json === "private")));
            const directEvents = family === "document" && documentShape && directMetadata ? own.get("events") : undefined;
            if (directEvents !== undefined && owner !== undefined) {
              const direct = eventSources(directEvents);
              for (const literal of direct.literals) { noteEventLiteral(literal, "document"); associate(literal, owner, { location: location(directEvents) }); }
              eventIssues.push(...direct.issues.map(issue => ({ ...issue, code: "HSON_EVENT_DECLARATION_INVALID" })));
              for (const source of direct.declarations.values()) {
                for (const argument of source.event.args) {
                  if (argument.operand.kind === "native") continue;
                  for (const site of event_argument_references(argument)) {
                    const where = source.map({ start: site.start.index, end: site.end.index });
                    if (where !== undefined) eventIssues.push({ location: where, code: "HSON_EVENT_REFERENCE_INVALID", message: standalone_event_reference_issue(site), attachment: location(directEvents) });
                  }
                }
              }
            }
            const qualifiedLibrary = qualifiedBatch && definition?.qualified && !libraryWork.exhausted && own !== undefined;
            const collectionWork = qualifiedLibrary ? libraryWork : new PartOwnershipWork();
            const collectionInputDepth = qualifiedLibrary ? definition.depth + 2 : 0;
            const collection = family !== "parts" || parts === undefined ? undefined : coordinateRecord(parts, collectionWork,
              collectionInputDepth);
            const members = coordinateFields(collection, collectionWork);
            const qualifiedCollection = qualifiedLibrary && collection?.qualified && !collectionWork.exhausted;
            const evidence = qualifiedCollection && parts !== undefined
              ? part_collection_evidence(typescript, sources, parts, collectionWork.fork(), collectionInputDepth) : undefined;
            let memberCompleteness: Completeness = members === undefined ? "unknown" : "partial";
            const shapeCertain = qualifiedLibrary && definitions?.fresh && fields?.complete && definition.fresh
              && sources.eligible(entry.declaration);
            const literalParts = directMetadata && directRecord(parts) !== undefined && members?.complete;
            const prefixExhausted = batchWork.exhausted || libraryWork.exhausted || collectionWork.exhausted;
            const observedMembers = (members?.fields ?? []).flatMap(member => {
              if (member.name === undefined || member.value === undefined) return [];
              const work = qualifiedCollection ? collectionWork.fork() : new PartOwnershipWork();
              const variants = sources.alternatives(member.value, "part-record", { ...reachable, work,
                depth: qualifiedCollection ? collection.depth + 2 : 0 });
              // Establish identity before filtering out alternatives without an observable Document.
              const only = variants.complete && !variants.conditional && variants.nodes.length === 1 ? variants.nodes[0] : undefined;
              const selectedRecord = only && typescript.isObjectLiteralExpression(only) ? only : undefined;
              const fresh = selectedRecord !== undefined && variants.direct === true;
              const depth = variants.depth ?? 0;
              const observed = variants.nodes.map(node => {
                const selected = node === selectedRecord;
                const fields = typescript.isObjectLiteralExpression(node) ? recordFields(node, selected ? work : undefined, depth) : undefined;
                const source = fields?.get("document"), events = fields?.get("events");
                const kind = fields?.get("kind");
                const partShape = fields && [...fields.keys()].every(key => ["kind", "document", "events", "css", "stylesheet"].includes(key));
                const adjacentEvents = source !== undefined && literalParts && partShape
                  && directRecord(member.value) === node && kind && typescript.isStringLiteralLike(kind) && kind.text === "document"
                  ? events === undefined ? missingEvents : eventSources(events) : undefined;
                // Both proofs inherit the Library and member costs. Event linking
                // cannot spend Part's remaining work, including on an observation retry.
                const link = source !== undefined && adjacentEvents !== undefined && !prefixExhausted && !work.exhausted
                  ? linkPartEvents(source, adjacentEvents, work.fork(), depth + 2) : undefined;
                const value = selected && selectedRecord !== undefined ? part_value(typescript, sources, selectedRecord, work, depth) : undefined;
                const partOptions = eligible && sources.eligible(node) ? reachable : undefined;
                let evidence = source !== undefined && selected && !work.exhausted
                  ? alternatives(source, partOptions, work, depth + 2, link) : undefined;
                if (source !== undefined && (evidence === undefined || work.exhausted)) {
                  evidence = alternatives(source, partOptions, new PartOwnershipWork(), 0, link);
                }
                return { fields, evidence, value };
              });
              const selected = selectedRecord === undefined ? undefined : observed[0];
              const memberEvidence = selected?.evidence ?? { documents: [...new Set(observed.flatMap(variant => variant.evidence?.documents ?? []))],
                lexicalCertain: false, certain: false };
              const value = selected?.value;
              let qualified = false;
              if (value?.known) {
                try { validate_part_collection(admit_projected_value({ [member.name]: value.value }), parseEvent.part); qualified = true; }
                catch { /* A lexical member can survive without qualifying as a Part. */ }
              }
              const document = memberEvidence.certain ? memberEvidence.documents[0] : undefined;
              const memberFields = selected?.fields;
              const coordinateKnown = qualifiedCollection && entry.name !== undefined && fields?.selected.has(entry.name) && members?.selected.has(member.name);
              const knownWriteTarget = !!coordinateKnown && document !== undefined && !work.exhausted && (qualified || selectedRecord !== undefined
                && memberFields !== undefined && part_write_source(typescript, sources, member.name, selectedRecord, memberFields, document, work, depth))
                && !work.exhausted;
              const contractSource = knownWriteTarget && members?.complete && (qualified || memberFields?.has("events")) && shapeCertain && collection?.fresh && fresh && document?.signature
                ? document : undefined;
              if (owner) for (const document of memberEvidence.documents) {
                for (const [literal, attachment] of attachedLiterals.get(document) ?? []) associate(literal, owner, { location: attachment, part: document });
              }
              return [{ name: member.name, declaration: location(member.declaration), fresh,
                qualified, knownWriteTarget, contractSource, evidence: memberEvidence }];
            });
            if (eligible && evidence !== undefined && members?.complete && evidence.members.length === observedMembers.length
              && evidence.members.every(member => observedMembers.some(observed => observed.name === member.key))) memberCompleteness = "complete";
            const documentEvidence = body === undefined ? undefined : qualifiedLibrary
              ? alternatives(body, undefined, libraryWork, definition.depth + 2) : alternatives(body);
            const producerCertain = family === "parts" ? memberCompleteness === "complete" : family === "document" ? documentEvidence?.certain === true
              : family === "data" && qualifiedLibrary
                && sources.candidates((own!.get("json") ?? own!.get("hson"))!, own!.has("json") ? "json" : "data", libraryWork, definition.depth + 2) !== undefined;
            const library: PartLibrarySource = {
              ...(entry.name === undefined ? {} : { name: entry.name }), declaration: location(entry.declaration),
              ...(entry.declaration.name === undefined ? {} : { nameLocation: location(entry.declaration.name) }), family,
              certainty: shapeCertain && producerCertain ? "certain" : "possible",
              members: observedMembers.map(member => ({ name: member.name, declaration: member.declaration,
                admission: member.qualified ? "qualified" : "unknown", knownWriteTarget: member.knownWriteTarget,
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
            inventoryCompleteness: fields === undefined ? "unknown" : qualifiedBatch && definitions?.fresh && fields.complete ? "complete" : "partial",
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
    const parameters = target.definition.signature?.parameters ?? target.definition.declaredWriteKinds;
    if (!parameters) continue;
    const args = new Map<string, PartWriteSource["arguments"][number]>();
    const seen = new Set<string>();
    let complete = target.definition.signature !== undefined;
    for (const property of input.properties) {
      const key = property.name;
      const literalKey = key && typescript.isComputedPropertyName(key) ? key.expression : key;
      const name = literalKey && (typescript.isStringLiteralLike(literalKey) || typescript.isNumericLiteral(literalKey)
        || literalKey === key && typescript.isIdentifier(literalKey)) ? literalKey.text : undefined;
      if (name === undefined) {
        // A spread or dynamic key may overwrite every earlier value.
        args.clear();
        complete = false;
        continue;
      }
      const kind = parameters.get(name);
      if (!key || !typescript.isIdentifier(key) && !typescript.isStringLiteral(key) || seen.has(name) || kind === undefined
        || is_object_literal_prototype_setter(property, typescript)
        || !typescript.isPropertyAssignment(property) && !(typescript.isShorthandPropertyAssignment(property) && !property.objectAssignmentInitializer)) {
        args.delete(name);
        complete = false;
      } else {
        const expression = typescript.isPropertyAssignment(property) ? property.initializer : property.name;
        args.set(name, { name, kind, expression, nameLocation: location(key), valueLocation: location(expression),
          ...(kind === "data" ? { dataEvidence: dataSchema(expression) } : {}) });
      }
      seen.add(name);
    }
    const established = [...args.values()].filter(argument => complete || is_part_scalar_qualifier(argument.kind));
    if (complete || established.length) writes.push({ call, location: location(call), ...target,
      arguments: established, ...(complete ? {} : { partial: true }) });
  }
  // A declaration belongs to the same lexical owner in any statement order.
  // Keep duplicate declarations distinct. No claim is made about installation.
  for (const call of actionCalls) {
    const method = literal_member(call.expression, typescript);
    const namespace = method && literal_member(method.owner, typescript);
    const owner = namespace && sources.declarationSource(namespace.owner);
    if (!owner || !typescript.isCallExpression(owner) || !sources.eligible(call)
      || call.arguments.length < 2 || call.arguments.length > 3) continue;
    const domain = eventOwnerDomain(owner);
    if (!domain) continue;
    const signature = checker.getResolvedSignature(call)?.getDeclaration();
    if (!signature || !official_library_source(signature, domain === "host" ? "locus.core.types" : "local-action.types")) continue;
    const name = sources.declarationSource(call.arguments[0]!);
    if (!name || !typescript.isStringLiteralLike(name) || !name.text || domain === "host" && is_locus_document_action_name(name.text)
      || !checker.getTypeAtLocation(call.arguments[1]!).getCallSignatures().length) continue;
    const options = directFields(call.arguments[2]);
    actionDeclarations.push({ owner, domain, name: name.text, location: location(call.arguments[0]!),
      ...actionContract(options && action_args_keys_valid([...options.keys()], "options") ? options.get("args") : undefined) });
  }
  const facts: PartSourceFacts = { batches, documents: observedDocuments, writes, actionDeclarations, eventOwners, inlineEventLiterals, eventIssues, eventLiterals, parsedEvents, eventAttachments };
  sourceFacts.set(program, facts);
  return facts;
}

function part_write_target(typescript: typeof ts, checker: ts.TypeChecker, sources: Candidates, batches: readonly PartSourceBatch[], call: ts.CallExpression) {
  if (!typescript.isPropertyAccessExpression(call.expression) || call.expression.name.text !== "write" || call.arguments.length !== 1
    || call.questionDotToken !== undefined || call.expression.questionDotToken !== undefined) return undefined;
  const work = new PartOwnershipWork();
  const checked = sources.eligibility(work);
  const coordinate = (input: ts.Expression, steps = 0, depth = 0): { batch: PartSourceBatch; path: string[] } | undefined => {
    if (steps > 16) return undefined;
    const inspected = sources.inspectExpression(input, work, depth);
    if (!inspected || !checked(input)) return undefined;
    const node = inspected.node, next = inspected.depth + 1;
    if (typescript.isPropertyAccessExpression(node)) {
      if (node.questionDotToken !== undefined) return undefined;
      const parent = coordinate(node.expression, steps + 1, next);
      return parent === undefined ? undefined : { batch: parent.batch, path: [...parent.path, node.name.text] };
    }
    if (typescript.isIdentifier(node)) {
      const binding = immutable_source_declaration(typescript, checker, node, checked);
      return work.exhausted || !binding?.eligible || binding.declaration.initializer === undefined ? undefined
        : coordinate(binding.declaration.initializer, steps + 1, next);
    }
    const batch = batches.find(batch => batch.call === node && batch.eligible);
    return batch === undefined ? undefined : { batch, path: [] };
  };
  const owner = coordinate(call.expression.expression);
  if (owner === undefined || owner.path.length !== 3 || owner.path[0] !== "parts") return undefined;
  const libraries = owner.batch.libraries.filter(library => library.name === owner.path[1] && library.family === "parts");
  const library = libraries.length === 1 ? libraries[0] : undefined;
  const members = library?.members.filter(member => member.name === owner.path[2]);
  const member = members?.length === 1 ? members[0] : undefined;
  const definition = member?.documents.length === 1 ? member.documents[0] : undefined;
  if (!library || !member?.knownWriteTarget || !definition
    || !definition.signature && !definition.declaredWriteKinds && definition.parameterCompleteness !== "complete") return undefined;
  return { batch: owner.batch, library, definition };
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
  const names = definition.declaredWriteKinds ? [...definition.declaredWriteKinds.keys()] : definition.parameters.map(parameter => parameter.name);
  return { names: names.filter(name => !existing.has(name) && name.startsWith(prefix)), start, end,
    assignment, ...(quote === undefined ? {} : { quote }) };
}
