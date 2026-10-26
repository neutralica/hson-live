import { part_receiving_interface, transform_part_parameter_strings } from "../part-definition.js";
import type ts from "typescript";
import type { HsonNode } from "../../core/types.js";
import { is_official_hson_package_binding, read_supported_hson_import_symbols } from "../embedded-hson/discover-hson-tagged-templates.js";
import { hson_tagged_source, admit_hson_tagged_source } from "../embedded-hson/hson-tagged-source-admission.js";
import { interpolation_site, map_interpolation_range, type GeneratedSegment } from "../trusted-schema-diagnostics/interpolation-source.js";
import { static_hson_literal_correspondence, map_static_hson_range } from "../embedded-hson/static-hson-source.js";
import type { HsonSourceLexicalCollector, HsonSourceRange } from "../hson-source-provenance/hson-source-provenance.js";
import { tokenize_authored_document_library, scan_hson_template_segments, type HsonTemplateSlot } from "../../api/transform/parsers/tokenize-hson.js";
import { split_attrs_meta } from "../../api/transform/utils/hson-utils/split-attrs-meta.js";
import { qualify_authored_document_source } from "../../api/document/hson-authored.js";
import { validate_part_collection } from "../../api/livemap/livemap.parts.js";
import { parse_authored_document_library } from "../../api/livemap/livemap.document.quad.js";
import { admit_projected_value } from "../../core/projected-value-admission.js";
import { PART_DECLARATION, part_declaration_issue, PART_OPTIONAL, has_part_reference, part_optional_issue, is_part_receiving_attribute, part_receiving_declaration, part_placeholder_matches, whole_part_reference, part_placeholder_placement_issue } from "../part-placeholder.js";
import { library_source_admission, library_source_field_candidates, library_source_fields } from "./library-source.js";
import { static_source_candidates } from "./source-candidates.js";

type Completeness = "complete" | "partial" | "unknown";
export type PartSourceLocation = HsonSourceRange & Readonly<{ file: string; precision: "exact" | "anchor" }>;
export type PartParameterSource = Readonly<{ name: string; uses: readonly Readonly<{ location: PartSourceLocation; context: "text" | "attribute" | "structure"; namespace: "incoming" | "local"; reference: string; structured: boolean; supply?: "data" | "doc" }>[] }>;
export type PartConnectorSource = Readonly<{
  location: PartSourceLocation;
  headerComplete: boolean;
  attributes: readonly Readonly<{ name: string; value?: string; nameLocation: PartSourceLocation; valueLocation?: PartSourceLocation }>[];
}>;
export type PartDocumentSource = Readonly<{
  producer: ts.Expression;
  location: PartSourceLocation;
  /** Original literal segments only; TypeScript expressions never belong to this region. */
  authoredRanges: readonly PartSourceLocation[];
  admission: "qualified" | "unknown";
  /** Runtime Library-source admission is stronger than Hson authoring qualification (e.g. QUAD uniqueness). */
  librarySourceAdmission: "qualified" | "unknown";
  connectors: readonly PartConnectorSource[];
  parameters: readonly PartParameterSource[];
  /** Lexical reuse suggestions only, never a qualified parameter inventory. */
  parameterSpellings: readonly PartParameterSource[];
  parameterCompleteness: "complete" | "unknown";
  receivingDeclarations: readonly Readonly<{ name: string; incoming: string; kind: "data" | "doc"; location: PartSourceLocation }>[];
  definitionRoot?: PartSourceLocation;
  partDeclarations: readonly Readonly<{ location: PartSourceLocation; root: boolean; issue?: string }>[];
  optionalStructures: readonly Readonly<{ location: PartSourceLocation; root: boolean; issue?: string; references?: number }>[];
  referenceIssues: readonly Readonly<{ location: PartSourceLocation; message: string }>[];
  /** Payload ranges, never guessed decoded-substring offsets. No type or optionality is implied. */
  receivers: readonly Readonly<{ batch: ts.CallExpression; library?: PartLibrarySource; certainty: "certain" | "possible" }>[];
}>;
export type PartLibrarySource = Readonly<{
  name?: string;
  declaration: PartSourceLocation;
  nameLocation?: PartSourceLocation;
  family: "parts" | "document" | "data" | "unknown";
  /** Candidate evidence, not a claim about a live receiving inventory. */
  certainty: "certain" | "possible";
  members: readonly Readonly<{ name: string; declaration: PartSourceLocation; admission: "qualified" | "unknown"; certainty: "certain" | "possible"; documents: readonly PartDocumentSource[] }>[];
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
/** Program-snapshot facts, owned by the compiler. No registry, runtime identity or durable cache. */
export type PartSourceFacts = Readonly<{ batches: readonly PartSourceBatch[]; documents: readonly PartDocumentSource[] }>;

type Candidates = ReturnType<typeof static_source_candidates>;
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
export function collect_part_source_facts(typescript: typeof ts, program: ts.Program): PartSourceFacts {
  const checker = program.getTypeChecker(), sources = static_source_candidates(typescript, checker, program);
  const documents = new Map<ts.Expression, PartDocumentSource>();
  const relationships = new Map<PartDocumentSource, { batch: ts.CallExpression; library?: PartLibrarySource; certainty: "certain" | "possible" }[]>();
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
  const document = (producer: ts.Expression): PartDocumentSource | undefined => {
    const existing = documents.get(producer);
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
    const uses: { name: string; location: PartSourceLocation; context: "text" | "attribute" | "structure"; namespace: "incoming" | "local"; reference: string; structured: boolean; supply?: "data" | "doc" }[] = [];
    const receivingDeclarations: { name: string; incoming: string; kind: "data" | "doc"; location: PartSourceLocation }[] = [];
    const optionalStructures: { location: PartSourceLocation; root: boolean; issue?: string; references?: number }[] = [];
    const partDeclarations: { location: PartSourceLocation; root: boolean; issue?: string }[] = [];
    const roots: PartSourceLocation[] = [];
    const referenceIssues: { location: PartSourceLocation; message: string }[] = [];
    const observeUses = (value: string, range: HsonSourceRange | undefined, context: "text" | "attribute" | "structure", typed?: "data" | "doc"): void => {
      const mapped = range === undefined ? undefined : map(range);
      if (mapped === undefined) return;
      const whole = typed ? whole_part_reference(value) : undefined;
      if (typed && whole === undefined && !value.startsWith("%{") && !value.startsWith("#{")) return; // Serialized data is opaque.
      const matches = typed ? whole === undefined ? undefined : [whole] : part_placeholder_matches(value);
      if (matches === undefined) referenceIssues.push({ location: mapped, message: "Invalid Part property reference." });
      for (const match of matches ?? []) uses.push({ name: match.name, namespace: match.namespace, reference: match.reference, structured: match.path.length > 0,
        location: mapped, context, ...(typed === undefined ? {} : { supply: typed }) });
    };
    const observedAttributes = new WeakSet<object>();
    const tags: string[] = [];
    let scanned = true;
    try {
      tokenize_authored_document_library(text, {
        recordToken(token, evidence) {
          if (token.kind === "OPEN") tags.push(token.tag.toLowerCase());
          if (token.kind === "CLOSE") tags.pop();
          if (token.kind === "TEXT" && token.directValue === undefined && token.quoted && part_placeholder_placement_issue(tags) === undefined) observeUses(JSON.parse(token.raw), evidence.roles.value, "text");
        },
        recordAttribute(attr, ranges) {
          attributeRanges.set(attr, ranges);
        },
        elementHeader(tag, range, attrs, complete) {
          const connector = tag.toLowerCase() === "hson-part";
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
            if (attr.name.startsWith("#{")) {
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
            if (attr.value?.direct !== true && typeof value === "string" && part_placeholder_placement_issue(tags, { name: attr.name, value }) === undefined) {
              observeUses(value, attributeRanges.get(attr)?.value, "attribute", connector && attr.name.startsWith("data:") ? "data" : connector && attr.name.startsWith("doc:") ? "doc" : undefined);
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
            return [{ name: attr.name, nameLocation: name, ...(valueRange === undefined ? {} : { valueLocation: valueRange }),
              ...(attr.value?.direct === true || typeof value !== "string" || has_part_reference(value) && !attr.name.startsWith("data:") && !attr.name.startsWith("doc:") ? {} : { value }) }];
          }) });
        },
      }, { slots, substitutions: slots.map(() => "") });
    } catch { scanned = false; }
    const names = new Set<string>();
    let parameterCompleteness: "complete" | "unknown" = "unknown";
    if (qualified && scanned && slots.length === 0) {
      try {
        const root = qualify_authored_document_source(text, new Map());
        const counts = new Map<HsonNode, number>();
        const optionalNodes = new Map<HsonNode, typeof optionalStructures[number]>();
        let optionalIndex = 0;
        const count = (node: HsonNode, amount: number) => counts.set(node, (counts.get(node) ?? 0) + amount);
        transform_part_parameter_strings(root, (value, node) => {
          const matches = part_placeholder_matches(value);
          if (matches === undefined) throw new Error("Invalid Part placeholder");
          count(node, matches.length);
          return value;
        }, (_reference, node) => { count(node, 1); }, undefined, {
          inspect: true,
          structure(_reference, node) { count(node, 1); },
          enter(node) {
            if (Object.hasOwn(node.$_attrs ?? {}, PART_OPTIONAL)) {
              const fact = optionalStructures[optionalIndex++];
              if (fact !== undefined) optionalNodes.set(node, fact);
            }
          },
          leave(node, parent) {
            const references = counts.get(node) ?? 0, fact = optionalNodes.get(node);
            if (fact !== undefined) fact.references = references;
            if (parent !== undefined) count(parent, references);
          },
        });
        const declared = new Map<string, typeof receivingDeclarations[number]>();
        for (const declaration of receivingDeclarations) {
          if (declared.has(declaration.name)) referenceIssues.push({ location: declaration.location, message: `Conflicting Part local binding ${JSON.stringify(declaration.name)}.` });
          declared.set(declaration.name, declaration);
        }
        for (const use of uses) {
          const declaration = declared.get(use.name);
          const invalid = use.namespace === "incoming" ? use.structured || use.context === "structure" || use.supply !== undefined
            || receivingDeclarations.some(declaration => declaration.incoming === use.name)
            : declaration === undefined || (use.supply !== undefined && declaration.kind !== use.supply) || (use.structured && declaration.kind !== "data") || (use.context === "structure" && declaration.kind !== "doc");
          if (invalid) referenceIssues.push({ location: use.location, message: `Part ${use.namespace} reference ${JSON.stringify(use.reference)} requires the matching declared representation and namespace.` });
        }
        for (const declaration of receivingDeclarations) if (!uses.some(use => use.namespace === "local" && use.name === declaration.name) && !optionalStructures.some(fact => fact.root)) {
          referenceIssues.push({ location: declaration.location, message: `Unused Part ${declaration.kind} binding ${JSON.stringify(declaration.name)}.` });
        }
        try { for (const name of part_receiving_interface(root).keys()) names.add(name); }
        catch (error) { if (!referenceIssues.length) referenceIssues.push({ location: location(producer), message: String(error) }); }
        parameterCompleteness = referenceIssues.length === 0 ? "complete" : "unknown";
      } catch { names.clear(); }
    }
    let librarySourceAdmission: "qualified" | "unknown" = "unknown";
    if (qualified && scanned && slots.length === 0) {
      try { parse_authored_document_library(text); librarySourceAdmission = "qualified"; }
      catch { /* Keep authoring/completion facts; this source cannot establish a receiving Library. */ }
    }
    const receivers: { batch: ts.CallExpression; library?: PartLibrarySource; certainty: "certain" | "possible" }[] = [];
    const result: PartDocumentSource = { producer, location: location(producer), authoredRanges, admission: qualified ? "qualified" : "unknown",
      librarySourceAdmission, connectors: [...headers.values()], parameters: [...names].map(name => ({ name, uses: uses.filter(use =>
        receivingDeclarations.some(declaration => use.namespace === "local" && declaration.incoming === name && declaration.name === use.name)
        || use.namespace === "incoming" && use.name === name) })),
      parameterSpellings: spellingEligible ? [...new Set(uses.map(use => use.name))].map(name => ({ name, uses: uses.filter(use => use.name === name) })) : [],
      ...(scanned && roots.length === 1 ? { definitionRoot: roots[0]! } : {}), partDeclarations,
      parameterCompleteness, optionalStructures, receivingDeclarations: spellingEligible ? receivingDeclarations : [], referenceIssues, receivers };
    documents.set(producer, result);
    relationships.set(result, receivers);
    return result;
  };
  const alternatives = (input: ts.Expression) => {
    const possible = sources.alternatives(input, "document");
    const found = possible.nodes.flatMap(node => { const observed = document(node); return observed === undefined ? [] : [observed]; });
    // Filtering observations cannot remove an alternative or its conditionality from the proof.
    return { documents: found, certain: possible.complete && !possible.conditional && possible.nodes.length === 1
      && found.length === 1 && found[0]!.admission === "qualified" };
  };
  const batches: PartSourceBatch[] = [];
  for (const file of program.getSourceFiles()) {
    if (file.isDeclarationFile || program.isSourceFileFromExternalLibrary(file) || file.fileName.replaceAll("\\", "/").split("/").includes(".hson")) continue;
    const mapSymbols = read_supported_hson_import_symbols(file, checker, [], "hsonLiveMap", typescript);
    const visit = (node: ts.Node): void => {
      if (typescript.isTaggedTemplateExpression(node)) document(node);
      if (typescript.isCallExpression(node)) {
        const admission = library_source_admission(node, checker, mapSymbols, false, typescript, sources.eligible);
        if (admission !== undefined) {
          const eligible = admission.eligible && sources.eligible(admission.definitions);
          const definitions = object(admission.definitions);
          const fields = definitions === undefined ? undefined : library_source_field_candidates(definitions.node, typescript);
          const libraries: PartLibrarySource[] = [];
          for (const entry of fields?.fields ?? []) {
            const definition = entry.value === undefined ? undefined : object(entry.value);
            const own = definition === undefined ? undefined : library_source_fields(definition.node, typescript);
            const parts = own?.get("parts"), body = own?.get("document");
            const family = parts !== undefined && own?.size === 1 ? "parts" : body !== undefined && !own?.has("data") && parts === undefined ? "document"
              : own?.has("data") && body === undefined && parts === undefined ? "data" : "unknown";
            const collection = family !== "parts" || parts === undefined ? undefined : object(parts);
            const members = collection === undefined ? undefined : library_source_field_candidates(collection.node, typescript);
            const evidence = family !== "parts" || parts === undefined ? undefined : part_collection_evidence(typescript, sources, parts);
            let memberCompleteness: Completeness = members === undefined ? "unknown" : "partial";
            const observedMembers = (members?.fields ?? []).flatMap(member => {
              if (member.name === undefined || member.value === undefined) return [];
              const record = object(member.value), fields = record === undefined ? undefined : library_source_fields(record.node, typescript);
              const source = fields?.get("document");
              const value = part_value(typescript, sources, member.value);
              let qualified = false;
              if (value.known) {
                try { validate_part_collection(admit_projected_value({ [member.name]: value.value })); qualified = true; }
                catch { /* A lexical member can survive without qualifying as a Part. */ }
              }
              return [{ name: member.name, declaration: location(member.declaration), fresh: record?.fresh === true,
                qualified,
                evidence: source === undefined ? { documents: [], certain: false } : alternatives(source) }];
            });
            if (eligible && evidence !== undefined && members?.complete && evidence.members.length === observedMembers.length
              && evidence.members.every(member => observedMembers.some(observed => observed.name === member.key))) memberCompleteness = "complete";
            const documentEvidence = body === undefined ? undefined : alternatives(body);
            const producerCertain = family === "parts" ? memberCompleteness === "complete" : family === "document" ? documentEvidence?.certain === true
              : family === "data" && sources.candidates(own!.get("data")!, "data") !== undefined;
            const library: PartLibrarySource = {
              ...(entry.name === undefined ? {} : { name: entry.name }), declaration: location(entry.declaration),
              ...(entry.declaration.name === undefined ? {} : { nameLocation: location(entry.declaration.name) }), family,
              certainty: eligible && producerCertain && definitions?.fresh && fields?.complete && definition?.fresh && sources.eligible(definitions.node)
                && sources.eligible(entry.declaration) ? "certain" : "possible",
              members: observedMembers.map(member => ({ name: member.name, declaration: member.declaration,
                admission: member.qualified ? "qualified" : "unknown",
                certainty: eligible && memberCompleteness === "complete" && collection?.fresh && member.fresh && member.evidence.certain ? "certain" : "possible",
                documents: member.evidence.documents })), memberCompleteness,
            };
            libraries.push(library);
            const relate = (related: ReturnType<typeof alternatives>, certain: boolean): void => {
              for (const found of related.documents) relationships.get(found)?.push({ batch: node, library,
                certainty: certain && related.certain ? "certain" : "possible" });
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
  for (const found of documents.values()) {
    const receivers = relationships.get(found)!;
    if (receivers.length !== 0 || found.connectors.length === 0) continue;
    for (const batch of batches) receivers.push({ batch: batch.call, certainty: "possible" });
  }
  return { batches, documents: [...documents.values()] };
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
  if (call === undefined || !typescript.isPropertyAccessExpression(call.expression)) return undefined;
  const coordinate = (node: ts.Expression, depth = 0): { batch: ts.CallExpression; path: string[] } | undefined => {
    if (depth > 16) return undefined;
    node = sources.unwrap(node);
    if (typescript.isPropertyAccessExpression(node)) {
      const parent = coordinate(node.expression, depth + 1);
      return parent === undefined ? undefined : { batch: parent.batch, path: [...parent.path, node.name.text] };
    }
    if (typescript.isIdentifier(node)) {
      const declaration = sources.declaration(node);
      return declaration?.initializer === undefined ? undefined : coordinate(declaration.initializer, depth + 1);
    }
    return typescript.isCallExpression(node) && facts.batches.some(batch => batch.call === node && batch.eligible)
      ? { batch: node, path: [] } : undefined;
  };
  const owner = coordinate(call.expression.expression);
  if (owner === undefined || owner.path.length !== 3 || owner.path[0] !== "parts") return undefined;
  const batch = facts.batches.find(batch => batch.call === owner.batch);
  const libraries = batch?.libraries.filter(library => library.name === owner.path[1] && library.family === "parts");
  const members = libraries?.length === 1 ? libraries[0]!.members.filter(member => member.name === owner.path[2]) : undefined;
  const documents = members?.length === 1 ? members[0]!.documents : undefined;
  const definition = documents?.length === 1 ? documents[0] : undefined;
  if (definition?.parameterCompleteness !== "complete") return undefined;
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
