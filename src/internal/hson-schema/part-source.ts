import type ts from "typescript";
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
import { is_part_data_declaration_attribute, part_data_declaration, part_placeholder_matches, whole_part_reference, part_placeholder_placement_issue, transform_part_parameter_strings } from "../part-placeholder.js";
import { library_source_admission, library_source_field_candidates, library_source_fields } from "./library-source.js";
import { static_source_candidates } from "./source-candidates.js";

type Completeness = "complete" | "partial" | "unknown";
export type PartSourceLocation = HsonSourceRange & Readonly<{ file: string; precision: "exact" | "anchor" }>;
export type PartParameterSource = Readonly<{ name: string; uses: readonly Readonly<{ location: PartSourceLocation; context: "text" | "attribute"; reference: string; structured: boolean }>[] }>;
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
  receivingDeclarations: readonly Readonly<{ name: string; incoming: string; location: PartSourceLocation }>[];
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
    const uses: { name: string; location: PartSourceLocation; context: "text" | "attribute"; reference: string; structured: boolean }[] = [];
    const receivingDeclarations: { name: string; incoming: string; location: PartSourceLocation }[] = [];
    const referenceIssues: { location: PartSourceLocation; message: string }[] = [];
    const observeUses = (value: string, range: HsonSourceRange | undefined, context: "text" | "attribute", typed = false): void => {
      const mapped = range === undefined ? undefined : map(range);
      if (mapped === undefined) return;
      const whole = typed ? whole_part_reference(value) : undefined;
      if (typed && whole === undefined && !value.startsWith("%{")) return; // Serialized data is opaque.
      const matches = typed ? whole === undefined ? undefined : [whole] : part_placeholder_matches(value);
      if (matches === undefined) referenceIssues.push({ location: mapped, message: "Invalid Part property reference." });
      for (const match of matches ?? []) uses.push({ name: match.name, reference: match.reference, structured: match.path.length > 0,
        location: mapped, context });
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
          for (const attr of attrs) {
            if (observedAttributes.has(attr)) continue;
            observedAttributes.add(attr);
            const value = split_attrs_meta([attr]).attrs[attr.name];
            if (is_part_data_declaration_attribute(tag, attr.name)) {
              const ranges = attributeRanges.get(attr);
              const range = ranges?.value ?? ranges?.name;
              const where = range === undefined ? undefined : map(range);
              if (where !== undefined) {
                try {
                  if (tags.length !== 0) throw new TypeError("Part data declarations are only allowed on the single definition root.");
                  if (attr.value?.direct !== true) {
                    const declaration = part_data_declaration(attr.name, value);
                    receivingDeclarations.push({ name: declaration.name, incoming: declaration.reference.name, location: where });
                  }
                } catch (error) { referenceIssues.push({ location: where, message: String(error) }); }
              }
              continue;
            }
            if (attr.value?.direct !== true && typeof value === "string" && part_placeholder_placement_issue(tags, { name: attr.name, value }) === undefined) {
              observeUses(value, attributeRanges.get(attr)?.value, "attribute", connector && attr.name.startsWith("data:"));
            }
          }
          if (!connector) return;
          const mapped = map(range);
          if (mapped === undefined) return;
          headers.set(range.start, { location: mapped, headerComplete: complete, attributes: attrs.flatMap(attr => {
            const ranges = attributeRanges.get(attr), name = ranges?.name === undefined ? undefined : map(ranges.name);
            if (name === undefined) return [];
            const valueRange = ranges?.value === undefined ? undefined : map(ranges.value);
            const value = split_attrs_meta([attr]).attrs[attr.name];
            return [{ name: attr.name, nameLocation: name, ...(valueRange === undefined ? {} : { valueLocation: valueRange }),
              ...(attr.value?.direct === true || typeof value !== "string" || value.includes("%{") && !attr.name.startsWith("data:") ? {} : { value }) }];
          }) });
        },
      }, { slots, substitutions: slots.map(() => "") });
    } catch { scanned = false; }
    const names = new Set<string>();
    let parameterCompleteness: "complete" | "unknown" = "unknown";
    if (qualified && scanned && slots.length === 0) {
      try {
        const root = qualify_authored_document_source(text, new Map());
        const locals = new Set<string>();
        const observe = (name: string): void => { if (!locals.has(name)) names.add(name); };
        transform_part_parameter_strings(root, value => {
          const matches = part_placeholder_matches(value);
          if (matches === undefined) throw new Error("Invalid Part placeholder");
          for (const match of matches) observe(match.name);
          return value;
        }, reference => { observe(reference.name); }, declarations => {
          for (const declaration of declarations) {
            locals.add(declaration.name);
            names.add(declaration.reference.name);
          }
        });
        for (const use of uses) {
          if (use.structured && !locals.has(use.name)
            || !locals.has(use.name) && receivingDeclarations.some(declaration => declaration.incoming === use.name)) {
            referenceIssues.push({ location: use.location, message: `Part reference %{${use.reference}} requires a declared local data binding.` });
          }
        }
        for (const declaration of receivingDeclarations) if (!uses.some(use => use.name === declaration.name)) {
          referenceIssues.push({ location: declaration.location, message: `Unused Part data binding ${JSON.stringify(declaration.name)}.` });
        }
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
        receivingDeclarations.some(declaration => declaration.incoming === name && declaration.name === use.name)
        || !receivingDeclarations.some(declaration => declaration.name === use.name) && use.name === name) })),
      parameterSpellings: spellingEligible ? [...new Set(uses.map(use => use.name))].map(name => ({ name, uses: uses.filter(use => use.name === name) })) : [],
      parameterCompleteness, receivingDeclarations: spellingEligible ? receivingDeclarations : [], referenceIssues, receivers };
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
