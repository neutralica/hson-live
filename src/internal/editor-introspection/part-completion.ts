import { admit_canonical_hson_data_value } from "../../api/data/hson-data-hson.js";
import { is_ordered_projected_object, type OrderedProjectedValue } from "../../core/ordered-projected-value.js";
import type { HsonGrammarCheckpoint } from "../../api/transform/parsers/tokenize-hson.js";
import { decode_hson_content_string } from "../../core/hson-content-string.js";
import { split_attrs_meta } from "../../api/transform/utils/hson-utils/split-attrs-meta.js";
import { PART_OPTIONAL, has_part_reference, is_part_parameter_name, is_part_receiving_attribute, part_argument_name, part_placeholder_placement_issue } from "../part-placeholder.js";
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
  const memberSource = facts.batches.some(batch => batch.eligible && batch.libraries.some(library => library.family === "parts"
    && library.members.some(member => member.documents.includes(document))));
  const optionalCandidate: HsonEditorCandidate[] = [];
  if (checkpoint.kind === "header" && memberSource && PART_OPTIONAL.startsWith(prefix)
    && !element.attributes.some(attr => attr.name === PART_OPTIONAL && (attr.start.index < checkpoint.range.start || attr.start.index >= checkpoint.range.end))) {
    optionalCandidate.push({ label: PART_OPTIONAL, kind: "member", insertText: PART_OPTIONAL,
      detail: "Include this structure when any authored value placeholder is present", certainty: "certain", sortText: "0000" });
  }
  const suggestions = new Map<string, { contexts: Set<number>; certain: boolean }>();
  const add = (name: string, context: number, certain: boolean): void => {
    const previous = suggestions.get(name);
    if (previous === undefined) suggestions.set(name, { contexts: new Set([context]), certain });
    else { previous.contexts.add(context); previous.certain &&= certain; }
  };
  let contextCount = document.receivers.length;
  let detail: string;
  if (checkpoint.kind === "parameter") {
    if (attribute === PART_OPTIONAL) return [];
    if (checkpoint.parameter?.structural && element.attributes.some(attr => attr.name !== PART_OPTIONAL && !attr.name.startsWith("#{"))) return [];
    const rawAttribute = checkpoint.parameter?.rawAttribute;
    if (checkpoint.parameter === undefined || !checkpoint.parameter.structural && attribute !== rawAttribute?.name) return [];
    try {
      const decoded = rawAttribute === undefined ? undefined
        : { name: rawAttribute.name, value: split_attrs_meta([rawAttribute]).attrs[rawAttribute.name] };
      const tags = decoded === undefined ? element.contentTags : element.contentTags.slice(0, -1);
      if (part_placeholder_placement_issue(tags, decoded) !== undefined) return [];
      if (element.tag.toLowerCase() === "hson-part" && (decoded?.name.startsWith("data:") || decoded?.name.startsWith("doc:"))
        && (typeof decoded.value !== "string" || !decoded.value.startsWith("%{") && !decoded.value.startsWith("#{"))) return [];
    } catch { return []; }
    // Only actual member-source relationships establish a Part definition.
    if (!memberSource) return [];
    const receiving = attribute !== undefined && is_part_receiving_attribute(element.tag, attribute);
    if (receiving && element.contentTags.length !== 1) return [];
    if (checkpoint.parameter.namespace === "incoming") {
      if (!receiving && (attribute?.startsWith("data:") || attribute?.startsWith("doc:"))) return [];
      const structured = new Set(document.receivingDeclarations.map(declaration => declaration.incoming));
      if (receiving) for (const declaration of document.receivingDeclarations) add(declaration.incoming, 0, false);
      for (const parameter of document.parameters) if (receiving || !structured.has(parameter.name)) add(parameter.name, 0, document.parameterCompleteness === "complete");
      for (const parameter of document.parameterSpellings) for (const use of parameter.uses) {
        if (use.namespace === "incoming" && !use.structured && use.supply === undefined && (receiving || !structured.has(parameter.name))) add(use.reference, 0, false);
      }
    } else if (!receiving) {
      for (const declaration of document.receivingDeclarations) {
        if ((!checkpoint.parameter.structural || declaration.kind === "doc") && (!attribute?.startsWith("data:") || declaration.kind === "data") && (!attribute?.startsWith("doc:") || declaration.kind === "doc")) add(declaration.name, 0, document.parameterCompleteness === "complete");
      }
      if (!checkpoint.parameter.structural && !attribute?.startsWith("doc:")) for (const batch of facts.batches) for (const library of batch.libraries) for (const member of library.members) {
        if (!member.documents.includes(document)) continue;
        for (const source of facts.documents) {
          if (!source.receivers.some(receiver => receiver.batch === batch.call && receiver.certainty === "certain" && receiver.library?.family === "document")) continue;
          for (const connector of source.connectors) {
            if (connector.attributes.find(attr => attr.name === "lib")?.value !== library.name
              || connector.attributes.find(attr => attr.name === "at")?.value !== member.name) continue;
            for (const declaration of document.receivingDeclarations.filter(declaration => declaration.kind === "data")) {
              const value = connector.attributes.find(attr => attr.name === `data:${declaration.incoming}`)?.value;
              if (value === undefined) continue;
              try { for (const path of data_paths(admit_canonical_hson_data_value(value), declaration.name)) add(path, 0, false); }
              catch { /* Invalid or dynamic inputs provide no shape evidence. */ }
            }
          }
        }
      }
      if (!checkpoint.parameter.structural) for (const parameter of document.parameterSpellings) for (const use of parameter.uses) {
        const declaration = document.receivingDeclarations.find(declaration => declaration.name === parameter.name);
        if (use.namespace === "local" && declaration !== undefined
          && (!attribute?.startsWith("data:") || declaration.kind === "data")
          && (!attribute?.startsWith("doc:") || declaration.kind === "doc")) add(use.reference, 0, document.parameterCompleteness === "complete");
      }
    }
    contextCount = 1;
    detail = "Part parameter spelling (new names are allowed)";
  } else {
    if (element.attributes.some(attr => attr.name.startsWith("#{"))) return optionalCandidate;
    if (memberSource && checkpoint.kind === "header" && element.tag.toLowerCase() === "hson-part"
      && element.attributes.every(attr => attr.name === PART_OPTIONAL)) {
      const structural = document.receivingDeclarations.filter(declaration => declaration.kind === "doc")
        .map(declaration => `#{${declaration.name}}`).filter(name => name.startsWith(prefix));
      return [...optionalCandidate, ...structural.map((label): HsonEditorCandidate => ({ label, insertText: label, kind: "reference",
        detail: "Insert a declared local Document", certainty: "certain", sortText: "0001" }))];
    }
    if (element.tag.toLowerCase() !== "hson-part" || checkpoint.kind !== "header" && checkpoint.kind !== "attribute-value") return optionalCandidate;
    const coordinate = (name: string): string | undefined => {
      const attrs = element.attributes.filter(attr => attr.name === name);
      if (attrs.length !== 1 || attrs[0]?.value === undefined || attrs[0].value.direct) return undefined;
      const value = split_attrs_meta([attrs[0]]).attrs[name];
      return typeof value === "string" && !has_part_reference(value) ? value : undefined;
    };
    const libraryName = coordinate("lib"), memberName = coordinate("at");
    const selectingLibrary = checkpoint.kind === "attribute-value" && attribute === "lib";
    const selectingMember = checkpoint.kind === "attribute-value" && attribute === "at";
    if (!selectingLibrary && !selectingMember && checkpoint.kind !== "header") return [];
    if (!selectingLibrary && libraryName === undefined || checkpoint.kind === "header" && memberName === undefined) return optionalCandidate;
    const existing = new Set(element.attributes.filter(attr => attr.start.index < checkpoint.range.start || attr.start.index >= checkpoint.range.end).map(attr => part_argument_name(attr.name)?.name ?? attr.name));
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
              const structured = definition.receivingDeclarations.find(declaration => declaration.incoming === parameter.name);
              add(structured ? `${structured.kind}:${parameter.name}` : parameter.name,
                index, memberCertain && definition.parameterCompleteness === "complete");
            }
          }
        }
      }
    });
    detail = selectingLibrary ? "Parts Library" : selectingMember ? "Part member" : "Part argument";
  }
  return [...optionalCandidate, ...[...suggestions].filter(([name]) => name.startsWith(prefix)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([label, evidence], index): HsonEditorCandidate => {
      const certainty = evidence.certain && evidence.contexts.size === contextCount ? "certain" : "possible";
      let insertText = label;
      if (checkpoint.kind === "attribute-value") {
        const quoted = JSON.stringify(label).replace(/`/g, "\\u0060").replace(/\$\{/g, "\\u0024{");
        insertText = checkpoint.quoted === undefined ? quoted : quoted.slice(1, -1) + (checkpoint.quoted.complete ? "" : '"');
      } else if (checkpoint.kind === "parameter") {
        // Selectors may contain quoted keys; insert decoded references through the enclosing Hson string.
        if (checkpoint.quoted !== undefined) insertText = JSON.stringify(label).slice(1, -1)
          .replace(/`/g, "\\u0060").replace(/\$\{/g, "\\u0024{");
        if (!checkpoint.parameter?.complete) insertText += "}";
      }
      return { label, kind: checkpoint.kind === "header" ? "member" : "reference", insertText,
        detail: `${detail}${certainty === "possible" ? " (possible source context)" : ""}`, certainty, sortText: String(index).padStart(4, "0") };
    })];
}

/** Enumerate only observed immutable ordered Data; no receiving Schema is inferred. */
function data_paths(value: OrderedProjectedValue, root: string): readonly string[] {
  const result: string[] = [], pending = [{ value, path: root, depth: 0 }];
  while (pending.length && result.length < 512) {
    const current = pending.pop()!;
    if (current.depth >= 16) continue;
    const entries: readonly (readonly [string | number, OrderedProjectedValue])[] = Array.isArray(current.value)
      ? current.value.map((value, index): readonly [number, OrderedProjectedValue] => [index, value])
      : is_ordered_projected_object(current.value) ? current.value.entries : [];
    for (const [key, value] of entries) {
      const path = current.path + (typeof key === "number" ? `[${key}]` : is_part_parameter_name(key) ? `.${key}` : `[${JSON.stringify(key)}]`);
      result.push(path); pending.push({ value, path, depth: current.depth + 1 });
      if (result.length === 512) break;
    }
  }
  return result;
}
