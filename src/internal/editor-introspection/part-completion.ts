import type { HsonGrammarCheckpoint } from "../../api/transform/parsers/tokenize-hson.js";
import { decode_hson_content_string } from "../../core/hson-content-string.js";
import { split_attrs_meta } from "../../api/transform/utils/hson-utils/split-attrs-meta.js";
import { part_placeholder_placement_issue } from "../part-placeholder.js";
import type { PartSourceFacts, PartDocumentSource } from "../hson-schema/part-source.js";
import type { HsonEditorCandidate } from "./query.js";

/** Advisory projections of compiler evidence; never infer an owner from a name. */
export function part_candidates(source: string, cursor: number, checkpoint: HsonGrammarCheckpoint,
  facts: PartSourceFacts, document: PartDocumentSource): readonly HsonEditorCandidate[] {
  const { element, attribute } = checkpoint;
  if (element === undefined || checkpoint.pendingValue) return [];
  let prefix = checkpoint.parameter?.prefix ?? source.slice(checkpoint.range.start, cursor);
  try { if (checkpoint.quoted !== undefined && checkpoint.parameter === undefined) prefix = decode_hson_content_string(prefix); }
  catch { return []; }
  const suggestions = new Map<string, { contexts: Set<number>; certain: boolean }>();
  const add = (name: string, context: number, certain: boolean): void => {
    const previous = suggestions.get(name);
    if (previous === undefined) suggestions.set(name, { contexts: new Set([context]), certain });
    else { previous.contexts.add(context); previous.certain &&= certain; }
  };
  let contextCount = document.receivers.length;
  let detail: string;
  if (checkpoint.kind === "parameter") {
    const rawAttribute = checkpoint.parameter?.rawAttribute;
    if (checkpoint.parameter === undefined || attribute !== rawAttribute?.name) return [];
    try {
      const decoded = rawAttribute === undefined ? undefined
        : { name: rawAttribute.name, value: split_attrs_meta([rawAttribute]).attrs[rawAttribute.name] };
      const tags = decoded === undefined ? element.contentTags : element.contentTags.slice(0, -1);
      if (part_placeholder_placement_issue(tags, decoded) !== undefined) return [];
    } catch { return []; }
    // Only actual member-source relationships establish a Part definition.
    const memberSource = facts.batches.some(batch => batch.eligible && batch.libraries.some(library => library.family === "parts"
      && library.members.some(member => member.documents.includes(document))));
    if (!memberSource) return [];
    for (const parameter of document.parameterSpellings) add(parameter.name, 0, document.parameterCompleteness === "complete");
    contextCount = 1;
    detail = "Part parameter spelling (new names are allowed)";
  } else {
    if (element.tag.toLowerCase() !== "hson-part" || checkpoint.kind !== "header" && checkpoint.kind !== "attribute-value") return [];
    const coordinate = (name: string): string | undefined => {
      const attrs = element.attributes.filter(attr => attr.name === name);
      if (attrs.length !== 1 || attrs[0]?.value === undefined || attrs[0].value.direct) return undefined;
      const value = split_attrs_meta([attrs[0]]).attrs[name];
      return typeof value === "string" && !value.includes("%{") ? value : undefined;
    };
    const libraryName = coordinate("lib"), memberName = coordinate("at");
    const selectingLibrary = checkpoint.kind === "attribute-value" && attribute === "lib";
    const selectingMember = checkpoint.kind === "attribute-value" && attribute === "at";
    if (!selectingLibrary && !selectingMember && checkpoint.kind !== "header") return [];
    if (!selectingLibrary && libraryName === undefined || checkpoint.kind === "header" && memberName === undefined) return [];
    const existing = new Set(element.attributes.filter(attr => attr.start.index < checkpoint.range.start || attr.start.index >= checkpoint.range.end).map(attr => attr.name));
    document.receivers.forEach((receiver, index) => {
      const batch = facts.batches.find(batch => batch.call === receiver.batch);
      if (batch === undefined || !batch.eligible) return;
      for (const library of batch.libraries) {
        if (library.family !== "parts" || library.name === undefined || !selectingLibrary && library.name !== libraryName) continue;
        const certain = receiver.certainty === "certain" && batch.inventoryCompleteness === "complete"
          && batch.receivingInventory === "candidate-only" && library.certainty === "certain";
        if (selectingLibrary) { add(library.name, index, certain); continue; }
        for (const member of library.members) {
          if (member.admission !== "qualified") continue;
          // A lexical member key alone cannot authorize an unsupported producer.
          const documents = member.documents.filter(document => document.admission === "qualified");
          if (documents.length === 0) continue;
          const memberCertain = certain && library.memberCompleteness === "complete" && member.certainty === "certain";
          if (selectingMember) { add(member.name, index, memberCertain); continue; }
          if (member.name !== memberName) continue;
          for (const definition of documents) for (const parameter of definition.parameters) {
            if (parameter.name !== "lib" && parameter.name !== "at" && !existing.has(parameter.name)) {
              add(parameter.name, index, memberCertain && definition.parameterCompleteness === "complete");
            }
          }
        }
      }
    });
    detail = selectingLibrary ? "Parts Library" : selectingMember ? "Part member" : "Part argument";
  }
  return [...suggestions].filter(([name]) => name.startsWith(prefix)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([label, evidence], index) => {
      const certainty = evidence.certain && evidence.contexts.size === contextCount ? "certain" : "possible";
      let insertText = label;
      if (checkpoint.kind === "attribute-value") {
        const quoted = JSON.stringify(label).replace(/`/g, "\\u0060").replace(/\$\{/g, "\\u0024{");
        insertText = checkpoint.quoted === undefined ? quoted : quoted.slice(1, -1) + (checkpoint.quoted.complete ? "" : '"');
      } else if (checkpoint.kind === "parameter" && !checkpoint.parameter?.complete) insertText += "}";
      return { label, kind: checkpoint.kind === "header" ? "member" : "reference", insertText,
        detail: `${detail}${certainty === "possible" ? " (possible source context)" : ""}`, certainty, sortText: String(index).padStart(4, "0") };
    });
}
