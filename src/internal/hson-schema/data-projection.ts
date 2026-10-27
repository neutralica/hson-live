import type { CompiledHsonSchema, HsonSchemaDataSemanticNode } from "./compiler.js";

/** A null step means an array member of unknown index. This is authoring
 * evidence only; selectors must be supported by every known alternative. */
export type SchemaDataPath = readonly (string | number | null)[];

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
  const path: (string | number | null)[] = [];
  for (const selector of selectors) {
    nodes = narrow(nodes, path);
    if (nodes.length === 0) return [];
    const next = nodes.map(node => {
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
