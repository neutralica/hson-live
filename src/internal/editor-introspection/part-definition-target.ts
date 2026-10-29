import { part_source_coordinates, type PartSourceFacts, type PartSourceLocation } from "../hson-schema/part-source.js";

export type PartDefinitionTarget = Readonly<{ name: string; origin: PartSourceLocation; target: PartSourceLocation }>;
/** Source navigation only, using the same lexical identities and governed
 * receiving-inventory evidence used by completion and contract diagnostics. */
export function part_definition_target(facts: PartSourceFacts, file: string, offset: number): PartDefinitionTarget | undefined {
  for (const document of facts.documents) {
    if (document.location.file !== file) continue;
    for (const use of document.bindingSources?.references ?? []) {
      if (use.root.start <= offset && offset < use.root.end && use.resolution === "resolved" && use.declaration !== undefined) {
        return { name: use.reference.name, origin: use.root, target: use.declaration.location };
      }
    }
    if (document.receivers.length !== 1) continue;
    const receiver = document.receivers[0]!;
    if (receiver.certainty !== "certain" || receiver.library?.family !== "document") continue;
    const batch = facts.batches.find(batch => batch.call === receiver.batch);
    if (!batch?.eligible || batch.receivingInventory !== "candidate-only" || batch.inventoryCompleteness !== "complete") continue;
    for (const connector of document.connectors) {
      if (!connector.headerComplete) continue;
      const coordinates = part_source_coordinates(connector);
      if (coordinates === undefined || coordinates.issue !== undefined) continue;
      const at = connector.attributes.find(attribute => attribute.name === "at")?.valueLocation;
      if (at?.precision !== "exact" || offset < at.start || offset >= at.end) continue;
      const libraries = batch.libraries.filter(library => library.name === coordinates.library);
      const library = libraries.length === 1 ? libraries[0] : undefined;
      if (library?.family !== "parts" || library.certainty !== "certain" || library.memberCompleteness !== "complete") continue;
      const members = library.members.filter(member => member.name === coordinates.member);
      const member = members.length === 1 ? members[0] : undefined;
      if (member?.certainty !== "certain" || member.admission !== "qualified" || member.declaration.precision !== "exact") continue;
      return { name: member.name, origin: at, target: member.declaration };
    }
  }
  return undefined;
}
