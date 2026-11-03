import { part_source_coordinates, type PartSourceFacts, type PartDocumentSource, type PartConnectorSource, type PartDataSchemaEvidence, type PartSourceBatch, type PartLibrarySource } from "../hson-schema/part-source.js";
import { inspect_schema_data, schema_projection_description, OBJECT_VALUE, type SchemaDataPath, type SchemaDataProjection } from "../hson-schema/data-projection.js";
import { part_argument_name, whole_part_reference } from "../part-placeholder.js";
import type { PartBindingDeclaration } from "./part-bindings.js";

type PartDataInvocation = Readonly<{
  source: PartDocumentSource;
  connector: PartConnectorSource;
  definition: PartDocumentSource;
  batch: PartSourceBatch;
  library: PartLibrarySource;
  root: Readonly<{ source: PartDocumentSource; connector: PartConnectorSource; batch: PartSourceBatch }>;
  parent?: PartDataInvocation;
  depth: number;
  /** Traversal boundaries remain visible on the invocation that encountered them. */
  incomplete: string[];
}>;
export type PartDataContext = PartDataInvocation & Readonly<{
  /** Shared by all receiving arguments of this invocation, never by other calls. */
  invocation: PartDataInvocation;
  incoming: string;
  /** The existing exact lexical identity, when source correspondence permits it. */
  receiving?: PartBindingDeclaration;
  argument?: PartConnectorSource["attributes"][number];
  evidence?: PartDataSchemaEvidence;
  /** Relative to the original Schema authority; no Schema subtree is compiled. */
  path: SchemaDataPath;
  uncertainty: readonly string[];
  executionCertain: boolean;
}>;

type ContextIndex = ReadonlyMap<PartDocumentSource, ReadonlyMap<string, readonly PartDataContext[]>>;
const indexes = new WeakMap<PartSourceFacts, ContextIndex>();
const FORWARDING_DEPTH = 16, FORWARDING_FRAMES = 256;
/** One bounded traversal per root caller in its own batch. Frames carry lexical
 * bindings and source authority; immutable Part definitions acquire no Schema. */
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
    const expand = (source: PartDocumentSource, connector: PartConnectorSource, root: PartDataInvocation["root"],
      budget: { frames: number }, reached: boolean, parent?: PartDataInvocation, inputs: readonly PartDataContext[] = []): void => {
      const coordinates = part_source_coordinates(connector, parent?.library.name);
      const entries = coordinates === undefined || coordinates.issue !== undefined ? []
        : selected.get(JSON.stringify([coordinates.library, coordinates.member])) ?? [];
      if (entries.length === 0) {
        parent?.incomplete.push("unresolved nested Part coordinate or source inventory; runtime destination unknown");
        return;
      }
      for (const { definition, library, certain } of entries) {
        if (budget.frames >= FORWARDING_FRAMES) {
          parent?.incomplete.push(`forwarding frame limit (${FORWARDING_FRAMES}); unknown continuation`); return;
        }
        budget.frames++;
        const depth = parent === undefined ? 0 : parent.depth + 1;
        let boundary = parent !== undefined && !connector.headerComplete ? "incomplete nested Part header; unknown continuation" : undefined;
        for (let ancestor = parent; ancestor !== undefined; ancestor = ancestor.parent) {
          if (ancestor.definition === definition && ancestor.library === library) { boundary = "forwarding cycle; unknown continuation"; break; }
        }
        if (depth >= FORWARDING_DEPTH) boundary = `forwarding depth limit (${FORWARDING_DEPTH}); unknown continuation`;
        const incomplete: string[] = boundary === undefined ? [] : [boundary];
        const invocation: PartDataInvocation = { source, connector, definition, batch, library, root, parent, depth, incomplete };
        const arguments_ = connector.attributes.flatMap(attribute => {
          const argument = part_argument_name(attribute.name);
          return argument === undefined ? [] : [{ attribute, argument }];
        });
        const contract = definition.signature;
        const interfaceValid = parent === undefined && contract !== undefined && connector.attributes.every(attribute => attribute.name === "lib" || attribute.name === "at" || part_argument_name(attribute.name) !== undefined)
          && arguments_.every(({ attribute, argument }) => contract.parameters.get(argument.name) === argument.kind && (attribute.value !== undefined || attribute.dynamicValue === true))
          && new Set(arguments_.map(({ argument }) => argument.name)).size === arguments_.length
          && [...contract.requiredness].every(([name, requiredness]) => requiredness !== "required" || arguments_.some(({ argument }) => argument.name === name));
        const contexts: PartDataContext[] = [];
        for (const declaration of definition.receivingDeclarations.filter(declaration => declaration.kind === "data")) {
          const argument = connector.attributes.find(attribute => attribute.name === `${declaration.incoming}:data`);
          const receiving = definition.bindingSources?.declarations.find(binding => binding.origin === "receiving" && binding.name === declaration.name && binding.incoming === declaration.incoming);
          const reference = argument?.value === undefined ? undefined : whole_part_reference(argument.value);
          const where = argument?.valueLocation;
          const use = reference?.namespace !== "local" || where?.precision !== "exact" ? undefined
            : source.bindingSources?.references.find(use => use.context === "forwarding" && use.resolution === "resolved" && use.location.start >= where.start && use.location.end <= where.end
              && use.reference.reference === reference.reference && use.reference.start === reference.start && use.reference.end === reference.end);
          const origin = use?.declaration === undefined ? undefined : part_binding_data_origin(use.declaration);
          const input = origin === undefined ? undefined : inputs.find(context => context.receiving === origin.receiving);
          const path = input === undefined || origin === undefined || reference === undefined ? [] : [...input.path, ...origin.path, ...reference.path];
          const evidence = boundary === undefined ? input?.evidence ?? (parent === undefined || reference === undefined ? argument?.dataEvidence : undefined) : undefined;
          const uncertainty = [...(input?.uncertainty ?? [])];
          if (evidence === undefined) uncertainty.push(boundary ?? (argument === undefined ? "absent Data argument" : "unknown or unsupported Data evidence"));
          if (reference?.optional) uncertainty.push("optional forwarding reference; value may be absent");
          if (definition.bindingSources?.references.some(use => use.context === "receiving" && use.reference.name === declaration.incoming && use.reference.optional)) {
            uncertainty.push("optional receiving argument; value may be absent");
          }
          const context: PartDataContext = { ...invocation, invocation, incoming: declaration.incoming, receiving, argument, evidence, path, uncertainty,
            executionCertain: parent === undefined && reached && certain && entries.length === 1 && interfaceValid && connector.headerComplete
              && definition.admission === "qualified" && definition.optionalStructures.length === 0 };
          contexts.push(context);
          const incoming = result.get(definition) ?? new Map<string, PartDataContext[]>();
          const existing = incoming.get(declaration.incoming) ?? [];
          existing.push(context); incoming.set(declaration.incoming, existing); result.set(definition, incoming);
        }
        if (boundary !== undefined) continue;
        for (const outgoing of definition.connectors) {
          if (budget.frames >= FORWARDING_FRAMES) { incomplete.push(`forwarding frame limit (${FORWARDING_FRAMES}); unknown continuation`); break; }
          expand(definition, outgoing, root, budget, false, invocation, contexts);
        }
      }
    };
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
        expand(source, connector, { source, connector, batch }, { frames: 0 }, reached);
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
  const position = (call: Pick<PartDataInvocation, "source" | "connector">): string => {
    const where = call.source.producer.getSourceFile().getLineAndCharacterOfPosition(call.connector.location.start);
    const file = call.connector.location.file.replaceAll("\\", "/").split("/").at(-1);
    return `${file}:${where.line + 1}:${where.character + 1}`;
  };
  const description = context.evidence === undefined ? "unknown Schema evidence"
    : `${schema_projection_description(part_data_projection(context.evidence, [...context.path, ...path]))}; ${context.evidence.strength}`;
  const chain: string[] = [], uncertainty = new Set(context.uncertainty);
  for (let invocation: PartDataInvocation | undefined = context.invocation; invocation !== undefined; invocation = invocation.parent) {
    if (invocation.parent !== undefined) chain.unshift(position(invocation));
    for (const reason of invocation.incomplete) uncertainty.add(reason);
  }
  const forwarding = chain.length === 0 ? "" : `; forwarded via ${chain.join(" → ")}; Schema path ${JSON.stringify(context.path.map(step => step === OBJECT_VALUE ? { objectValue: true } : step))}`
    + (context.evidence === undefined ? "" : `; Schema ${context.evidence.schemaLocation.file}:${context.evidence.schemaLocation.start}`)
    + `; batch ${context.batch.location.file}:${context.batch.location.start}; Parts Library ${JSON.stringify(context.library.name)}`;
  return `${position(context.root)}: ${description}${forwarding}${uncertainty.size === 0 ? "" : "; " + [...uncertainty].join("; ")}`;
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
    const kind = contexts.some(context => context.parent !== undefined) ? "recognized invocation contexts; recognized callers only" : `direct invocation${contexts.length === 1 ? "" : "s"}`;
    return { location: use.location, text: `Local Data ${use.reference.name} ← incoming ${origin.receiving.incoming}\n`
      + `Contextual Schema evidence (${contexts.length} ${kind})\n` + descriptions.join("\n") };
  }
  return undefined;
}
