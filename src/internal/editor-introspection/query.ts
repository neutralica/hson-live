import { hson_grammar_checkpoint, hson_interpolation_roles, type HsonEditorMode, type HsonGrammarCheckpoint, type HsonInterpolationRole, type HsonTemplateSlot } from "../../api/transform/parsers/tokenize-hson.js";
import { serialize_hson_tag_name } from "../../api/transform/utils/hson-utils/hson-tag-helpers.js";
import { HSON_SCHEMA_DATA_ROOT_ORDER, type CompiledHsonSchema, type HsonSchemaDataSemanticNode } from "../hson-schema/compiler.js";

export type HsonEditorCandidate = Readonly<{
  label: string;
  kind: "member" | "literal" | "syntax";
  insertText: string;
  detail: string;
  sortText: string;
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
}>): HsonEditorContext {
  const slots = input.slots ?? [];
  const checkpoint = input.cursor === undefined ? undefined : hson_grammar_checkpoint(input.source, input.cursor, input.mode, slots);
  const interpolationRoles = slots.length === 0 ? [] : hson_interpolation_roles(input.source, input.mode, slots);
  if (checkpoint === undefined) return { candidates: [], interpolationRoles, expectedKinds: [] };
  const candidates = input.mode === "schema" ? schema_candidates(checkpoint)
    : input.mode === "data" && input.schema !== undefined ? data_candidates(input.schema, checkpoint)
    : input.mode === "data" || input.mode === "canonical" ? grammar_candidates(checkpoint) : [];
  const prefix = input.source.slice(checkpoint.range.start, input.cursor);
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
  if (context.kind !== "member" || schema.semantic.kind === "document" || schema.semantic.kind === "document-element") return [];
  const definitions = new Map(schema.definitions.map(definition => [definition.name, definition.schema]));
  let budget = 256;
  const expand = (node: HsonSchemaDataSemanticNode, seen = new Set<string>()): readonly HsonSchemaDataSemanticNode[] => {
    if (--budget < 0 || seen.size > 64) return [];
    if (node.kind === "ref") {
      if (seen.has(node.name)) return [];
      const target = definitions.get(node.name);
      return target === undefined || target.kind === "document-element" ? [] : expand(target, new Set(seen).add(node.name));
    }
    return node.kind === "union" ? node.choices.flatMap(choice => expand(choice, seen)) : [node];
  };
  let nodes: readonly HsonSchemaDataSemanticNode[] = expand(schema.semantic);
  for (const part of context.path) {
    if (typeof part !== "string") return [];
    if (nodes.length === 0 || nodes.some(node => node.kind !== "object")) return [];
    const next = nodes.map(node => node.kind === "object" ? node.members.find(member => member.name === part)?.schema : undefined);
    if (next.some(node => node === undefined)) return [];
    nodes = next.flatMap(node => node === undefined ? [] : expand(node));
  }
  if (nodes.length === 0 || nodes.some(node => node.kind !== "object")) return [];
  const first = nodes[0];
  if (first.kind !== "object") return [];
  const already = new Set(context.existing);
  return first.members.flatMap((member, index) => {
    if (already.has(member.name) || nodes.some(node => node.kind !== "object" || !node.members.some(other => other.name === member.name))) return [];
    return [item(member.name, "member", serialize_hson_tag_name(member.name), member.optional ? "optional data member" : "required data member", index)];
  });
}
