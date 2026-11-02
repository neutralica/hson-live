import type { PartConnectorSource, PartDocumentSource, PartLibrarySource, PartSourceFacts, PartSourceLocation } from "../hson-schema/part-source.js";
import { part_coordinates } from "../part-coordinates.js";
import { part_binding_data_origin, part_data_context_description, part_data_contexts, part_data_projection, type PartDataContext } from "./part-data-evidence.js";

/** One reference, no Cartesian expansion. Projection already bounds semantic traversal. */
export const PART_SELECTOR_CANDIDATE_CAP = 16;
type Candidate = Readonly<{
  value: string;
  coordinates: ReturnType<typeof part_coordinates>;
  library?: PartLibrarySource;
  definitions: PartLibrarySource["members"];
  source: "qualified" | "missing" | "unavailable";
  inventoryComplete: boolean;
}>;
type Context = Readonly<{
  caller: PartDataContext;
  description: string;
  candidates: readonly Candidate[];
  alternatives: readonly string[];
  incomplete: boolean;
}>;
export type PartSelectorResolution = Readonly<{ location: PartSourceLocation; contexts: readonly Context[] }>;
const resolutions = new WeakMap<PartSourceFacts, WeakMap<PartConnectorSource, PartSelectorResolution | null>>();

/** Qualify against this caller's batch only. Partial inventories can still supply
 * exact admitted declarations; their omissions never prove runtime absence. */
function candidate(context: PartDataContext, lib: string | undefined, text: string, value: string): Candidate {
  const coordinates = part_coordinates(lib, text, context.library.name);
  if (coordinates.issue !== undefined) return { value, coordinates, definitions: [], source: "unavailable", inventoryComplete: false };
  const batch = context.batch;
  const libraries = batch.libraries.filter(library => library.name === coordinates.library);
  const library = libraries.length === 1 ? libraries[0] : undefined;
  const inventoryComplete = batch.eligible && batch.receivingInventory === "candidate-only" && batch.inventoryCompleteness === "complete"
    && (libraries.length === 0 || library?.family === "parts" && library.certainty === "certain" && library.memberCompleteness === "complete");
  const members = library?.family === "parts" ? library.members.filter(member => member.name === coordinates.member) : [];
  const definitions = batch.eligible ? members.filter(member => member.admission === "qualified" && member.declaration.precision === "exact") : [];
  return { value, coordinates, library, definitions, inventoryComplete,
    source: definitions.length > 0 ? "qualified" : inventoryComplete && members.length === 0 ? "missing" : "unavailable" };
}

function resolve(facts: PartSourceFacts, document: PartDocumentSource, connector: PartConnectorSource): PartSelectorResolution | undefined {
  if (!connector.headerComplete || connector.attributes.some(attribute => attribute.name.startsWith("^{") || attribute.name.startsWith("#{"))) return undefined;
  const ats = connector.attributes.filter(attribute => attribute.name === "at"), libs = connector.attributes.filter(attribute => attribute.name === "lib");
  const at = ats[0], selector = at?.referencedValue, location = at?.valueLocation;
  if (ats.length !== 1 || libs.length > 1 || libs.some(lib => lib.value === undefined) || location?.precision !== "exact"
    || selector?.references.length !== 1) return undefined;
  const reference = selector.references[0]!;
  if (reference.namespace !== "local") return undefined;
  // The runtime scanner owns decoded boundaries; the existing binding projection
  // owns their exact host correspondence and lexical declaration identity.
  const use = document.bindingSources?.references.find(use => use.location.start >= location.start && use.location.end <= location.end
    && use.reference.start === reference.start && use.reference.end === reference.end && use.reference.reference === reference.reference);
  const origin = use?.declaration === undefined ? undefined : part_binding_data_origin(use.declaration);
  if (origin?.receiving.incoming === undefined) return undefined;
  const path = [...origin.path, ...reference.path];
  const contexts = part_data_contexts(facts, document, origin.receiving.incoming).filter(context => context.receiving === origin.receiving).map((caller): Context => {
    const values = new Set<string>(), alternatives = new Set<string>();
    const projection = caller.evidence === undefined ? undefined : part_data_projection(caller.evidence, path);
    if (projection === undefined || projection.alternatives.length === 0) alternatives.add("unknown or unavailable Schema evidence");
    for (const alternative of projection?.alternatives ?? []) {
      if (alternative.presence === "optional") alternatives.add("optional path; value may be absent");
      if (alternative.kind !== "supported") {
        alternatives.add(alternative.kind === "absent" || alternative.kind === "invalid-traversal" ? "variant-dependent or absent path"
          : `${alternative.kind} Schema projection`);
      } else if (alternative.node.kind !== "exact" || typeof alternative.node.value !== "string") {
        alternatives.add(alternative.node.kind === "string" ? "open string alternatives" : `${alternative.node.kind} alternatives are not finite exact strings`);
      } else if (!values.has(alternative.node.value)) {
        if (values.size < PART_SELECTOR_CANDIDATE_CAP) values.add(alternative.node.value);
        else alternatives.add(`candidate cap (${PART_SELECTOR_CANDIDATE_CAP}) exceeded; additional values omitted`);
      }
    }
    if (reference.optional) alternatives.add("optional reference; execution is not guaranteed");
    const candidates = [...values].map(value => candidate(caller, libs[0]?.value,
      selector.text.slice(0, reference.start) + value + selector.text.slice(reference.end), value));
    return { caller, description: part_data_context_description(caller, path), candidates, alternatives: [...alternatives],
      incomplete: alternatives.size > 0 || candidates.some(candidate => candidate.coordinates.issue !== undefined || candidate.source !== "qualified"
        || !candidate.inventoryComplete || candidate.definitions.some(member => member.certainty !== "certain")) };
  });
  return { location, contexts };
}

/** Both editor consumers share one result per connector in the Program snapshot. */
export function part_selector_resolution(facts: PartSourceFacts, file: string, offset: number): PartSelectorResolution | undefined {
  for (const document of facts.documents) {
    if (document.location.file !== file) continue;
    for (const connector of document.connectors) {
      const at = connector.attributes.find(attribute => attribute.name === "at")?.valueLocation;
      if (at === undefined || offset < at.start || offset >= at.end) continue;
      let cache = resolutions.get(facts);
      if (cache === undefined) { cache = new WeakMap(); resolutions.set(facts, cache); }
      if (!cache.has(connector)) cache.set(connector, resolve(facts, document, connector) ?? null);
      return cache.get(connector) ?? undefined;
    }
  }
  return undefined;
}

function source_location(location: PartSourceLocation): string {
  return `${location.file}:${location.start}-${location.end}`;
}

export function part_selector_hover(result: PartSelectorResolution): string {
  const lines = [`Possible destination Parts (${result.contexts.length} recognized direct caller contexts).`,
    "Contextual Schema candidates; no guaranteed runtime destination or universal Part contract."];
  if (result.contexts.length === 0) lines.push("No recognized direct caller; unknown Schema evidence and source selection.");
  for (const context of result.contexts) {
    const { caller } = context;
    lines.push(`Caller ${context.description}; batch ${source_location(caller.batch.location)}; enclosing Parts Library ${JSON.stringify(caller.library.name)}`);
    if (caller.evidence !== undefined) lines.push(`Schema ${source_location(caller.evidence.schemaLocation)}; ${caller.evidence.strength === "advisory" ? "runtime value is not validated" : "input validated against Schema"}`);
    lines.push(`${context.candidates.length} known Schema candidate${context.candidates.length === 1 ? " in this context" : "s in this context"}${context.incomplete ? "; incomplete information, displayed destinations are not exhaustive" : "; finite Schema values in this context"}:`);
    for (const candidate of context.candidates) {
      if (candidate.coordinates.issue !== undefined) {
        lines.push(`- ${JSON.stringify(candidate.value)}: unresolved coordinate — ${candidate.coordinates.issue}`);
        continue;
      }
      lines.push(`- ${candidate.coordinates.library}/${candidate.coordinates.member} (Parts Library ${JSON.stringify(candidate.coordinates.library)}): `
        + (candidate.source === "qualified" ? `qualified source definition${candidate.definitions.length === 1 ? "" : "s"} ${candidate.definitions.map(member => source_location(member.declaration)).join(", ")}`
          : candidate.source === "missing" ? "no definition in this complete source inventory" : "source definition missing or unavailable; runtime existence is unknown")
        + (!candidate.inventoryComplete ? "; source inventory or selection incomplete" : "")
        + (candidate.definitions.some(member => member.certainty !== "certain") ? "; possible source selection" : ""));
    }
    for (const alternative of context.alternatives) lines.push(`- Unresolved: ${alternative}`);
  }
  return lines.join("\n");
}
