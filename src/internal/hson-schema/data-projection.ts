import { is_ordered_projected_object, type OrderedProjectedValue } from "../../core/ordered-projected-value.js";
import { ordered_projected_value_at } from "../../core/ordered-projected-value-mutation.js";
import type { CompiledHsonSchema, HsonSchemaDataSemanticNode } from "./compiler.js";

/** Unknown object member, distinct from every authored string key. */
export const OBJECT_VALUE = Symbol("object-value");
/** null selects array elements; OBJECT_VALUE selects ordered object values.
 * This is authoring evidence only, never a portable selector or identity. */
export type SchemaDataPath = readonly (string | number | null | typeof OBJECT_VALUE)[];

export type SchemaDataAlternative = Readonly<{ presence: "required" | "optional" } & (
  { kind: "supported"; node: HsonSchemaDataSemanticNode }
  | { kind: "absent" | "invalid-traversal" | "unavailable" | "budget-exhausted"; at: number }
)>;
export type SchemaDataProjection = Readonly<{ alternatives: readonly SchemaDataAlternative[] }>;

/** Context-free semantic projection. Failures remain alternatives, never evidence
 * that every union branch fails. Optional ancestors retain absence propagation.
 * The caller owns Schema provenance and whether conformity has been validated. */
export function inspect_schema_data(schema: CompiledHsonSchema, selectors: SchemaDataPath, limit = 256): SchemaDataProjection {
  let budget = limit;
  const definitions = new Map(schema.definitions.map(definition => [definition.name, definition.schema]));
  const branches = <T>(values: readonly T[], visit: (value: T) => readonly SchemaDataAlternative[]): SchemaDataAlternative[] => {
    const alternatives: SchemaDataAlternative[] = [];
    for (const value of values) { alternatives.push(...visit(value)); if (budget < 0) break; }
    return alternatives;
  };
  const expand = (node: HsonSchemaDataSemanticNode, presence: SchemaDataAlternative["presence"], at: number,
    seen = new Set<string>()): SchemaDataAlternative[] => {
    if (--budget < 0 || seen.size >= 64) return [{ kind: "budget-exhausted", presence, at }];
    if (node.kind === "ref") {
      if (seen.has(node.name)) return [{ kind: "budget-exhausted", presence, at }];
      const target = definitions.get(node.name);
      return target === undefined || target.kind === "document-element" ? [{ kind: "unavailable", presence, at }]
        : expand(target, presence, at, new Set(seen).add(node.name));
    }
    if (node.kind !== "union") return [{ kind: "supported", node, presence }];
    return branches(node.choices, choice => expand(choice, presence, at, seen));
  };
  if (schema.semantic.kind === "document" || schema.semantic.kind === "document-element") return { alternatives: [{ kind: "unavailable", presence: "required", at: 0 }] };
  let alternatives = expand(schema.semantic, "required", 0);
  for (let at = 0; at < selectors.length; at++) {
    if (at >= 64 || budget < 0) return { alternatives: [{ kind: "budget-exhausted", presence: "required", at }] };
    const selector = selectors[at]!;
    alternatives = alternatives.flatMap((alternative): SchemaDataAlternative[] => {
      if (alternative.kind !== "supported") return [alternative];
      const { node, presence } = alternative;
      if (--budget < 0) return [{ kind: "budget-exhausted", presence, at }];
      if (node.kind === "any") return [{ kind: "unavailable", presence, at }];
      if (typeof selector === "string" || selector === OBJECT_VALUE) {
        if (node.kind !== "object") return [{ kind: "invalid-traversal", presence, at }];
        const members = selector === OBJECT_VALUE ? node.members : node.members.filter(member => member.name === selector);
        if (members.length === 0) return [{ kind: "absent", presence, at }];
        return branches(members, member => expand(member.schema, presence === "optional" || selector !== OBJECT_VALUE && member.optional ? "optional" : "required", at + 1));
      }
      if (node.kind !== "array" && node.kind !== "tuple") return [{ kind: "invalid-traversal", presence, at }];
      if (selector !== null && node.refinements.some(({ rule }) => rule.kind === "collection-length" && rule.maximum !== undefined && selector >= rule.maximum)) return [{ kind: "absent", presence, at }];
      // Wildcards describe each selected value, never collection cardinality or
      // guaranteed execution. Numeric indices additionally allow absence.
      if (node.kind === "array") return expand(node.item, selector === null ? presence : "optional", at + 1);
      const items = selector === null ? node.items : node.items.slice(selector, selector + 1);
      return items.length === 0 ? [{ kind: "absent", presence, at }] : branches(items, item => expand(item, presence, at + 1));
    });
  }
  return { alternatives };
}

/** Concise display of production semantic nodes, preserving finite domains. */
export function schema_data_type(node: HsonSchemaDataSemanticNode, depth = 0): string {
  if (depth >= 5) return node.kind === "object" ? "object" : node.kind === "array" ? "array" : "…";
  switch (node.kind) {
    case "exact": return Object.is(node.value, -0) ? "-0" : JSON.stringify(node.value);
    case "ref": return node.name;
    case "union": return node.choices.slice(0, 12).map(choice => schema_data_type(choice, depth + 1)).join(" | ") + (node.choices.length > 12 ? " | …" : "");
    case "array": return `Array<${schema_data_type(node.item, depth + 1)}>`;
    case "tuple": return `[${node.items.slice(0, 12).map(item => schema_data_type(item, depth + 1)).join(", ")}${node.items.length > 12 ? ", …" : ""}]`;
    case "object": return `{ ${node.members.slice(0, 12).map(member => `${member.name}${member.optional ? "?" : ""}: ${schema_data_type(member.schema, depth + 1)}`).join("; ")}${node.members.length > 12 ? "; …" : ""} }`;
    default: return node.kind;
  }
}

export function schema_projection_description(projection: SchemaDataProjection): string {
  const types = [...new Set(projection.alternatives.flatMap(alternative => alternative.kind === "supported" ? [schema_data_type(alternative.node)] : []))];
  if (projection.alternatives.length > 0 && projection.alternatives.every(alternative => alternative.kind === "absent")) return "absent in this Schema";
  if (projection.alternatives.length > 0 && projection.alternatives.every(alternative => alternative.kind === "invalid-traversal")) return "invalid traversal in this Schema";
  const incomplete = projection.alternatives.some(alternative => alternative.kind === "unavailable" || alternative.kind === "budget-exhausted");
  const presence = projection.alternatives.some(alternative => alternative.kind !== "supported") ? "variant-dependent"
    : projection.alternatives.some(alternative => alternative.presence === "optional") ? "optional" : "required";
  return `${types.join(" | ") || "unknown"} (${incomplete ? "analysis unavailable" : presence})`;
}

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
