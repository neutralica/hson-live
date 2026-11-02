import { part_source_coordinates, type PartSourceFacts, type PartDocumentSource, type PartConnectorSource, type PartDataSchemaEvidence, type PartSourceBatch, type PartLibrarySource } from "../hson-schema/part-source.js";
import { inspect_schema_data, schema_projection_description, OBJECT_VALUE, type SchemaDataPath, type SchemaDataProjection } from "../hson-schema/data-projection.js";
import { part_argument_name } from "../part-placeholder.js";
import type { PartBindingDeclaration } from "./part-bindings.js";

export type PartDataContext = Readonly<{
  source: PartDocumentSource;
  connector: PartConnectorSource;
  definition: PartDocumentSource;
  batch: PartSourceBatch;
  library: PartLibrarySource;
  incoming: string;
  /** The existing exact lexical identity, when source correspondence permits it. */
  receiving?: PartBindingDeclaration;
  argument?: PartConnectorSource["attributes"][number];
  evidence?: PartDataSchemaEvidence;
  executionCertain: boolean;
}>;

type ContextIndex = ReadonlyMap<PartDocumentSource, ReadonlyMap<string, readonly PartDataContext[]>>;
const indexes = new WeakMap<PartSourceFacts, ContextIndex>();
/** Index direct document callers once per immutable Program snapshot. No nested
 * forwarding, runtime occurrences, inferred shapes, or persistent Part state. */
function context_index(facts: PartSourceFacts): ContextIndex {
  const cached = indexes.get(facts);
  if (cached !== undefined) return cached;
  const result = new Map<PartDocumentSource, Map<string, PartDataContext[]>>();
  const definitions = new Set(facts.batches.flatMap(batch => batch.libraries.flatMap(library => library.family === "parts" ? library.members.flatMap(member => member.documents) : [])));
  for (const batch of facts.batches) {
    if (!batch.eligible) continue;
    const selected = new Map<string, { definition: PartDocumentSource; library: PartLibrarySource; certain: boolean }[]>();
    for (const library of batch.libraries) if (library.family === "parts") for (const member of library.members) {
      const key = JSON.stringify([library.name, member.name]);
      const entries = selected.get(key) ?? [];
      for (const definition of member.documents) entries.push({ definition, library, certain: library.certainty === "certain"
        && library.memberCompleteness === "complete" && member.certainty === "certain" && member.admission === "qualified"
        && member.documents.length === 1 && definition.parameterCompleteness === "complete" });
      selected.set(key, entries);
    }
    for (const source of facts.documents) {
      const receiver = source.receivers.find(receiver => receiver.batch === batch.call && receiver.library?.family === "document");
      if (receiver === undefined) continue;
      const ordinary = !definitions.has(source);
      const reached = ordinary && source.receivers.length === 1 && (receiver.certainty === "certain" || receiver.placementCertain === true)
        && (source.librarySourceAdmission === "qualified" || source.valueIndependentAdmission === true)
        && source.iteratorDeclarations.length === 0 && source.optionalStructures.length === 0 && source.partDeclarations.length === 0 && source.referenceIssues.length === 0
        && batch.receivingInventory === "candidate-only" && batch.inventoryCompleteness === "complete"
        && batch.libraries.every(library => library === receiver.library || library.certainty === "certain");
      for (const connector of source.connectors) {
        const coordinates = part_source_coordinates(connector);
        if (coordinates === undefined || coordinates.issue !== undefined) continue;
        const entries = selected.get(JSON.stringify([coordinates.library, coordinates.member])) ?? [];
        for (const { definition, library, certain } of entries) {
          const arguments_ = connector.attributes.flatMap(attribute => {
            const argument = part_argument_name(attribute.name);
            return argument === undefined ? [] : [{ attribute, argument }];
          });
          const contract = definition.signature;
          const interfaceValid = contract !== undefined && connector.attributes.every(attribute => attribute.name === "lib" || attribute.name === "at" || part_argument_name(attribute.name) !== undefined)
            && arguments_.every(({ attribute, argument }) => contract.parameters.get(argument.name) === argument.kind && (attribute.value !== undefined || attribute.dynamicValue === true))
            && new Set(arguments_.map(({ argument }) => argument.name)).size === arguments_.length
            && [...contract.requiredness].every(([name, requiredness]) => requiredness !== "required" || arguments_.some(({ argument }) => argument.name === name));
          for (const declaration of definition.receivingDeclarations.filter(declaration => declaration.kind === "data")) {
            const argument = connector.attributes.find(attribute => attribute.name === `${declaration.incoming}:data`);
            const context: PartDataContext = { source, connector, definition, batch, library, incoming: declaration.incoming,
              receiving: definition.bindingSources?.declarations.find(binding => binding.origin === "receiving" && binding.name === declaration.name && binding.incoming === declaration.incoming),
              argument, evidence: argument?.dataEvidence,
              executionCertain: reached && certain && entries.length === 1 && interfaceValid && connector.headerComplete
                && definition.admission === "qualified" && definition.optionalStructures.length === 0 };
            const incoming = result.get(definition) ?? new Map<string, PartDataContext[]>();
            const contexts = incoming.get(declaration.incoming) ?? [];
            contexts.push(context); incoming.set(declaration.incoming, contexts); result.set(definition, incoming);
          }
        }
      }
    }
  }
  indexes.set(facts, result);
  return result;
}

export function part_data_contexts(facts: PartSourceFacts, definition: PartDocumentSource, incoming: string): readonly PartDataContext[] {
  return context_index(facts).get(definition)?.get(incoming) ?? [];
}

/** Resolve through declaration identity before appending member selectors. */
export function part_binding_data_origin(binding: PartBindingDeclaration, depth = 0): Readonly<{ receiving: PartBindingDeclaration; path: SchemaDataPath }> | undefined {
  if (binding.kind !== "data" || depth >= 64) return undefined;
  if (binding.origin === "receiving") return { receiving: binding, path: [] };
  const source = binding.elementOf;
  const origin = source?.declaration === undefined ? undefined : part_binding_data_origin(source.declaration, depth + 1);
  return source === undefined || origin === undefined || binding.elementKind === undefined ? undefined
    : { receiving: origin.receiving, path: [...origin.path, ...source.reference.path, binding.elementKind === "object" ? OBJECT_VALUE : null] };
}

const projections = new WeakMap<PartDataSchemaEvidence, Map<string, SchemaDataProjection>>();
export function part_data_projection(evidence: PartDataSchemaEvidence, path: SchemaDataPath): SchemaDataProjection {
  let cached = projections.get(evidence);
  if (cached === undefined) { cached = new Map(); projections.set(evidence, cached); }
  const key = JSON.stringify(path.map(selector => selector === OBJECT_VALUE ? { objectValue: true } : selector));
  let projection = cached.get(key);
  if (projection === undefined) {
    projection = inspect_schema_data(evidence.schema, path);
    // Bound authoring-path retention for long editor sessions on one Program.
    if (cached.size < 512) cached.set(key, projection);
  }
  return projection;
}

/** Keep caller identity and evidence strength together in editor presentation. */
export function part_data_context_description(context: PartDataContext, path: SchemaDataPath): string {
  const where = context.source.producer.getSourceFile().getLineAndCharacterOfPosition(context.connector.location.start);
  const file = context.connector.location.file.replaceAll("\\", "/").split("/").at(-1);
  const description = context.evidence === undefined ? "unknown Schema evidence"
    : `${schema_projection_description(part_data_projection(context.evidence, path))}; ${context.evidence.strength}`;
  return `${file}:${where.line + 1}:${where.character + 1}: ${description}`;
}

export function part_data_hover(facts: PartSourceFacts, file: string, offset: number) {
  for (const definition of facts.documents) {
    if (definition.location.file !== file) continue;
    const use = definition.bindingSources?.references.find(use => use.reference.namespace === "local" && use.location.start <= offset && offset < use.location.end);
    const origin = use?.declaration === undefined ? undefined : part_binding_data_origin(use.declaration);
    if (use === undefined || origin?.receiving.incoming === undefined) continue;
    const contexts = part_data_contexts(facts, definition, origin.receiving.incoming).filter(context => context.receiving === origin.receiving);
    if (!contexts.some(context => context.evidence !== undefined)) continue;
    const descriptions = contexts.map(context => part_data_context_description(context, [...origin.path, ...use.reference.path]));
    return { location: use.location, text: `Local Data ${use.reference.name} ← incoming ${origin.receiving.incoming}\n`
      + `Contextual Schema evidence (${contexts.length} direct invocation${contexts.length === 1 ? "" : "s"})\n` + descriptions.join("\n") };
  }
  return undefined;
}
