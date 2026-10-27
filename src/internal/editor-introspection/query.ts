import { hson_grammar_checkpoint, hson_interpolation_roles, type HsonEditorMode, type HsonGrammarCheckpoint, type HsonInterpolationRole, type HsonTemplateSlot } from "../../api/transform/parsers/tokenize-hson.js";
import { serialize_hson_tag_name } from "../../api/transform/utils/hson-utils/hson-tag-helpers.js";
import { serialize_primitive_hson } from "../../api/transform/utils/primitive-utils/serialize-primitive.utils.js";
import { decode_hson_content_string } from "../../core/hson-content-string.js";
import { HSON_SCHEMA_DATA_ROOT_ORDER, type CompiledHsonSchema, type HsonSchemaDataSemanticNode } from "../hson-schema/compiler.js";
import type { PartSourceFacts, PartDocumentSource, PartConnectorSource } from "../hson-schema/part-source.js";
import { part_candidates } from "./part-completion.js";
import { project_schema_data, type SchemaDataPath } from "../hson-schema/data-projection.js";

/** Locate compiler source facts only; completion and reference diagnostics are separate consumers. */
export function query_hson_part_source(facts: PartSourceFacts, file: string, offset: number, includeLiteralEnd = false): Readonly<{
  document: PartDocumentSource; connector?: PartConnectorSource;
}> | undefined {
  if (!Number.isInteger(offset) || offset < 0) return undefined;
  const document = facts.documents.filter(found => found.location.file === file
    && found.authoredRanges.some(range => range.start <= offset && (offset < range.end || includeLiteralEnd && offset === range.end)))
    .reduce<PartDocumentSource | undefined>((inner, found) => inner === undefined
      || found.location.end - found.location.start < inner.location.end - inner.location.start ? found : inner, undefined);
  if (document === undefined) return undefined;
  const connector = document.connectors.find(found => found.location.start <= offset && offset <= found.location.end);
  return { document, ...(connector === undefined ? {} : { connector }) };
}

export type HsonEditorCandidate = Readonly<{
  label: string;
  kind: "member" | "literal" | "syntax" | "reference";
  insertText: string;
  detail: string;
  sortText: string;
  certainty?: "certain" | "possible";
}>;
export type HsonEditorContext = Readonly<{
  checkpoint?: HsonGrammarCheckpoint;
  candidates: readonly HsonEditorCandidate[];
  interpolationRoles: readonly (HsonInterpolationRole | undefined)[];
  expectedKinds: readonly string[];
}>;

/** One editor-neutral compiler query for cursor and interpolation-slot consumers. */
export function query_hson_editor_context(input: Readonly<{
  mode: HsonEditorMode;
  source: string;
  cursor?: number;
  slots?: readonly HsonTemplateSlot[];
  schema?: CompiledHsonSchema;
  parts?: Readonly<{ facts: PartSourceFacts; file: string; offset: number }>;
}>): HsonEditorContext {
  const slots = input.slots ?? [];
  const checkpoint = input.cursor === undefined ? undefined : hson_grammar_checkpoint(input.source, input.cursor, input.mode, slots);
  const interpolationRoles = slots.length === 0 ? [] : hson_interpolation_roles(input.source, input.mode, slots);
  if (checkpoint === undefined) return { candidates: [], interpolationRoles, expectedKinds: [] };
  if (input.mode === "document" && input.parts !== undefined) {
    const source = query_hson_part_source(input.parts.facts, input.parts.file, input.parts.offset, true);
    return { checkpoint, candidates: source === undefined ? [] : part_candidates(input.source, input.cursor!, checkpoint, input.parts.facts, source.document, input.parts.offset),
      interpolationRoles, expectedKinds: expected_kinds(checkpoint) };
  }
  const candidates = input.mode === "schema" ? schema_candidates(checkpoint)
    : input.mode === "data" && input.schema !== undefined ? data_candidates(input.schema, checkpoint)
    : input.mode === "data" || input.mode === "canonical" ? grammar_candidates(checkpoint) : [];
  let prefix = input.source.slice(checkpoint.range.start, input.cursor);
  if (checkpoint.quoted !== undefined && input.mode === "data") {
    try { prefix = serialize_primitive_hson(decode_hson_content_string(prefix)).slice(0, -1); }
    catch { return { checkpoint, candidates: [], interpolationRoles, expectedKinds: expected_kinds(checkpoint) }; }
  }
  return { checkpoint, candidates: prefix === "" ? candidates : candidates.filter(candidate => candidate.label.startsWith(prefix)),
    interpolationRoles, expectedKinds: expected_kinds(checkpoint) };
}

function item(label: string, kind: HsonEditorCandidate["kind"], insertText: string, detail: string, order: number): HsonEditorCandidate {
  return { label, kind, insertText, detail, sortText: String(order).padStart(4, "0") };
}

function expected_kinds(context: HsonGrammarCheckpoint): readonly string[] {
  switch (context.kind) {
    case "member": return ["object member name"];
    case "tag": return ["element tag name"];
    case "header": return ["attribute name", "flag", "document content"];
    case "child": return ["document content"];
    case "attribute-value": return ["attribute value"];
    case "parameter": return ["Part parameter spelling"];
    case "value": return ["data value"];
  }
}

function grammar_candidates(context: HsonGrammarCheckpoint): readonly HsonEditorCandidate[] {
  if (context.kind !== "value" || context.range.start !== context.range.end) return [];
  return [item("true", "literal", "true", "Hson boolean", 0), item("false", "literal", "false", "Hson boolean", 1),
    item("null", "literal", "null", "Hson null", 2), item("<", "syntax", "<", "Hson object", 3),
    item("«", "syntax", "«", "Hson array", 4)];
}

function schema_candidates(context: HsonGrammarCheckpoint): readonly HsonEditorCandidate[] {
  if (context.kind !== "member" || context.path.length !== 0 || context.rootType !== "data") return [];
  const existing = new Set(context.existing);
  const next = existing.has("content") ? [] : !existing.has("type") ? ["type"] : existing.has("defs") ? ["content"] : ["defs", "content"];
  return HSON_SCHEMA_DATA_ROOT_ORDER.filter(name => next.includes(name) && !existing.has(name))
    .map((name, index) => item(name, "member", name, "Hson Schema root member", index));
}

function data_candidates(schema: CompiledHsonSchema, context: HsonGrammarCheckpoint): readonly HsonEditorCandidate[] {
  if (context.kind !== "member" && context.kind !== "value" || schema.semantic.kind === "document" || schema.semantic.kind === "document-element") return [];
  const samePath = (left: SchemaDataPath, right: SchemaDataPath): boolean => left.length === right.length && left.every((part, i) => part === right[i]);
  const narrow = (nodes: readonly HsonSchemaDataSemanticNode[], path: SchemaDataPath): readonly HsonSchemaDataSemanticNode[] => {
    if (nodes.length < 2) return nodes;
    // The compiler distinguishes object unions by required exact string members.
    // Match those facts only; this is not structural inference or validation.
    return nodes.filter(node => node.kind !== "object" || node.members.every(member => {
      if (member.optional || member.schema.kind !== "exact" || typeof member.schema.value !== "string") return true;
      const memberPath = [...path, member.name];
      if (context.kind === "value" && samePath(context.path, memberPath)) return true;
      const fact = context.dataFacts?.find(fact => fact.kind !== "member" && samePath(fact.path, memberPath));
      return fact === undefined || fact.kind === "unknown" || fact.kind === "scalar" && fact.value === member.schema.value;
    }));
  };
  const nodes = project_schema_data(schema, context.path, narrow);
  if (context.kind === "value") return value_candidates(nodes, context);
  if (nodes.length === 0 || nodes.some(node => node.kind !== "object")) return [];
  const first = nodes[0];
  if (first.kind !== "object") return [];
  const already = new Set(context.existing);
  for (const fact of context.dataFacts ?? []) {
    if (fact.kind !== "member" || !samePath(fact.path.slice(0, -1), context.path)
      || context.range.start < fact.range.end && context.range.end > fact.range.start) continue;
    const name = fact.path.at(-1);
    if (typeof name === "string") already.add(name);
  }
  return first.members.flatMap((member, index) => {
    if (already.has(member.name) || nodes.some(node => node.kind !== "object" || !node.members.some(other => other.name === member.name))) return [];
    const optional = nodes.map(node => node.kind === "object" && node.members.find(other => other.name === member.name)?.optional);
    const detail = optional.every(Boolean) ? "optional data member" : optional.some(Boolean) ? "data member (required in some union alternatives)" : "required data member";
    return [item(member.name, "member", template_safe(serialize_hson_tag_name(member.name)), detail, index)];
  });
}

/** Hson escapes also preserve the host template's lexical boundaries. */
function template_safe(text: string): string {
  return text.replace(/`/g, "\\u0060").replace(/\$\{/g, "\\u0024{");
}

function value_candidates(nodes: readonly HsonSchemaDataSemanticNode[], context: HsonGrammarCheckpoint): readonly HsonEditorCandidate[] {
  const candidates = new Map<string, HsonEditorCandidate>();
  const literal = (value: string | number | boolean | null): void => {
    if (context.quoted !== undefined && typeof value !== "string") return;
    const label = serialize_primitive_hson(value);
    const insertText = template_safe(context.quoted === undefined ? label : label.slice(1, -1));
    candidates.set(label, item(label, "literal", insertText, nodes.length > 1 ? "Schema literal (union alternative)" : "Schema literal", candidates.size));
  };
  for (const node of nodes) {
    if (node.kind === "exact") literal(node.value);
    else if (node.kind === "null") literal(null);
    else if (node.kind === "boolean") { literal(true); literal(false); }
    else if (context.quoted === undefined && context.range.start === context.range.end) {
      const label = node.kind === "object" ? "<" : node.kind === "array" || node.kind === "tuple" ? "«" : undefined;
      if (label !== undefined) candidates.set(label, item(label, "syntax", label, node.kind === "object" ? "Schema object" : "Schema collection", candidates.size));
    }
  }
  return [...candidates.values()];
}
