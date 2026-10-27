import { is_ordered_projected_object, type OrderedProjectedValue } from "../../core/ordered-projected-value.js";
import { ordered_projected_value_at } from "../../core/ordered-projected-value-mutation.js";
import type { CompiledHsonSchema, HsonSchemaDataSemanticNode } from "./compiler.js";

/** Unknown object member, distinct from every authored string key. */
export const OBJECT_VALUE = Symbol("object-value");
/** null selects array elements; OBJECT_VALUE selects ordered object values.
 * This is authoring evidence only, never a portable selector or identity. */
export type SchemaDataPath = readonly (string | number | null | typeof OBJECT_VALUE)[];

/** Shared bounded Schema traversal for Data completion and lexical Part aliases. */
export function project_schema_data(schema: CompiledHsonSchema, selectors: SchemaDataPath,
  narrow: (nodes: readonly HsonSchemaDataSemanticNode[], path: SchemaDataPath) => readonly HsonSchemaDataSemanticNode[] = nodes => nodes,
): readonly HsonSchemaDataSemanticNode[] {
  if (schema.semantic.kind === "document" || schema.semantic.kind === "document-element") return [];
  const definitions = new Map(schema.definitions.map(definition => [definition.name, definition.schema]));
  let budget = 256, exhausted = false;
  const expand = (node: HsonSchemaDataSemanticNode, seen = new Set<string>()): readonly HsonSchemaDataSemanticNode[] => {
    if (--budget < 0 || seen.size > 64) { exhausted = true; return []; }
    if (node.kind === "ref") {
      if (seen.has(node.name)) { exhausted = true; return []; }
      const target = definitions.get(node.name);
      return target === undefined || target.kind === "document-element" ? [] : expand(target, new Set(seen).add(node.name));
    }
    return node.kind === "union" ? node.choices.flatMap(choice => expand(choice, seen)) : [node];
  };
  let nodes = expand(schema.semantic);
  const path: (string | number | null | typeof OBJECT_VALUE)[] = [];
  for (const selector of selectors) {
    nodes = narrow(nodes, path);
    if (nodes.length === 0) return [];
    const next = nodes.map(node => {
      if (selector === OBJECT_VALUE) return node.kind === "object" ? node.members.map(member => member.schema) : undefined;
      if (typeof selector === "string") {
        const member = node.kind === "object" ? node.members.find(member => member.name === selector) : undefined;
        return member === undefined ? undefined : [member.schema];
      }
      if (node.kind !== "array" && node.kind !== "tuple") return undefined;
      if (selector !== null && node.refinements.some(({ rule }) => rule.kind === "collection-length" && rule.maximum !== undefined && selector >= rule.maximum)) return undefined;
      if (node.kind === "array") return [node.item];
      return selector === null ? node.items : node.items[selector] === undefined ? undefined : [node.items[selector]!];
    });
    if (next.some(node => node === undefined)) return [];
    nodes = next.flatMap(nodes => nodes?.flatMap(node => expand(node)) ?? []);
    path.push(selector);
  }
  nodes = narrow(nodes, path);
  return exhausted ? [] : nodes;
}

/** Apply shared lexical selector evidence to an admitted immutable carrier.
 * Universal proofs require complete coverage; budget exhaustion then withholds results. */
export function project_ordered_data(value: OrderedProjectedValue, path: SchemaDataPath, requireComplete = false): readonly OrderedProjectedValue[] {
  let values = [value];
  for (const key of path) {
    const next: OrderedProjectedValue[] = [];
    for (const value of values) {
      if (key === null) {
        if (Array.isArray(value)) for (const item of value) { if (next.length === 512) break; next.push(item); }
      } else if (key === OBJECT_VALUE) {
        if (is_ordered_projected_object(value)) for (const [, item] of value.entries) { if (next.length === 512) break; next.push(item); }
      } else {
        const child = ordered_projected_value_at(value, [key]);
        if (child !== undefined) next.push(child);
      }
      if (next.length === 512) { if (requireComplete) return []; break; }
    }
    values = next;
  }
  return values;
}
