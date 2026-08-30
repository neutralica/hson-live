import type { HsonNode } from "../../core/types.js";
import { projected_value_from_hson_node } from "../../core/projected-value-graph.js";
import { materialize_projected_value } from "../../core/projected-value-materialization.js";
import { parse_hson_with_provenance } from "../hson-source-provenance/parse-hson-with-provenance.js";
import type { HsonSourceProvenance, HsonSourceRange } from "../hson-source-provenance/hson-source-provenance.js";
import {
  CANONICAL_SCHEMA_FORMAT,
  CANONICAL_SCHEMA_VERSION,
  type CanonicalSchemaGraph,
  type CanonicalSchemaNode,
  type VerifiedCanonicalSchemaGraph,
} from "../canonical-schema/graph.js";
import { verify_canonical_schema_graph } from "../canonical-schema/verify.js";
import { evaluate_canonical_projected_schema } from "../canonical-schema/evaluate.js";
import { admit_projected_value } from "../../core/projected-value-admission.js";

export const HSON_SCHEMA_MVP_COMPATIBILITY_VERSION = "hson-schema-mvp-1" as const;

export type HsonSchemaIssueCode =
  | "INVALID_ROOT"
  | "UNKNOWN_SCHEMA_MEMBER"
  | "INVALID_SCHEMA_EXPRESSION"
  | "ILLEGAL_OPTIONAL"
  | "INVALID_UNION"
  | "INVALID_SCHEMA_GRAPH";

export type HsonSchemaIssue = Readonly<{
  code: HsonSchemaIssueCode;
  path: readonly (string | number)[];
  message: string;
  range?: HsonSourceRange;
}>;

export type HsonSchemaSemanticNode =
  | Readonly<{ kind: "string" | "number" | "boolean" | "null" }>
  | Readonly<{ kind: "exact"; value: string | number | boolean | null }>
  | Readonly<{ kind: "object"; members: readonly Readonly<{ name: string; optional: boolean; schema: HsonSchemaSemanticNode }>[] }>
  | Readonly<{ kind: "array"; item: HsonSchemaSemanticNode }>
  | Readonly<{ kind: "tuple"; items: readonly HsonSchemaSemanticNode[] }>
  | Readonly<{ kind: "union"; choices: readonly [HsonSchemaSemanticNode, HsonSchemaSemanticNode] }>;

export type CompiledHsonSchema = Readonly<{
  semantic: HsonSchemaSemanticNode;
  graph: VerifiedCanonicalSchemaGraph;
  provenance: HsonSourceProvenance;
  semanticRanges: ReadonlyMap<HsonSchemaSemanticNode, HsonSourceRange>;
  canonicalNodeCount: number;
}>;

export type HsonSchemaCompilation =
  | Readonly<{ ok: true; value: CompiledHsonSchema }>
  | Readonly<{ ok: false; issues: readonly HsonSchemaIssue[] }>;

type JsonObject = Record<string, unknown>;

/**
 * Editor-neutral compiler for the frozen Hson Schema MVP. It parses only data
 * Hson, validates the recursive bootstrap domain, decodes the human vocabulary,
 * and finally subjects the lowered graph to the canonical verifier.
 */
export function compile_hson_schema(source: string): HsonSchemaCompilation {
  let parsed: ReturnType<typeof parse_hson_with_provenance>;
  try {
    parsed = parse_hson_with_provenance(source);
  } catch (error) {
    return failure("INVALID_ROOT", [], error instanceof Error ? error.message : "Invalid Hson Schema source.");
  }

  let materialized: unknown;
  try {
    materialized = materialize_projected_value(projected_value_from_hson_node(parsed.value));
  } catch (error) {
    return failure("INVALID_ROOT", [], error instanceof Error ? error.message : "Schema must be ordinary data Hson.");
  }

  const admitted = admit_projected_value(materialized);
  const bootstrapResult = evaluate_canonical_projected_schema(HSON_SCHEMA_MVP_BOOTSTRAP, admitted);
  if (!bootstrapResult.ok && bootstrapResult.issues.some((entry) => entry.evidence.kind === "resource-limit")) {
    return failure("INVALID_SCHEMA_EXPRESSION", bootstrapResult.issues[0]?.path ?? [], "Hson Schema exceeds the MVP resource limits.");
  }

  const issues: HsonSchemaIssue[] = [];
  const ranges = new Map<HsonSchemaSemanticNode, HsonSourceRange>();
  if (!is_object(materialized)) return failure("INVALID_ROOT", [], "Hson Schema root must be an object.");
  const rootKeys = Object.keys(materialized);
  if (rootKeys.length !== 2 || rootKeys[0] !== "type" || rootKeys[1] !== "content" || materialized.type !== "data") {
    return failure("INVALID_ROOT", [], 'Hson Schema root must contain exactly `type "data"` followed by `content`.');
  }

  const semantic = decode_object_members(materialized.content, ["content"], issues, ranges, parsed.value, parsed.provenance);
  if (semantic === undefined || issues.length > 0) return Object.freeze({ ok: false, issues: Object.freeze(issues) });
  if (!bootstrapResult.ok) {
    const first = bootstrapResult.issues[0];
    return failure("INVALID_SCHEMA_EXPRESSION", first?.path ?? [], first === undefined
      ? "Schema does not match the MVP bootstrap language."
      : `Schema does not match the MVP bootstrap language (${first.code}${first.expected === undefined ? "" : `: expected ${first.expected}`}).`);
  }
  const graph = lower_hson_schema_semantic(semantic);
  const verified = verify_canonical_schema_graph(graph);
  if (!verified.ok) return failure("INVALID_SCHEMA_GRAPH", [], verified.issues.map((issue) => issue.message).join(" "));
  return Object.freeze({
    ok: true,
    value: Object.freeze({ semantic, graph: verified.graph, provenance: parsed.provenance, semanticRanges: ranges, canonicalNodeCount: verified.graph.nodes.length }),
  });
}

function decode_expression(
  input: unknown,
  path: readonly (string | number)[],
  memberPosition: boolean,
  issues: HsonSchemaIssue[],
  ranges: Map<HsonSchemaSemanticNode, HsonSourceRange>,
  root: HsonNode,
  provenance: HsonSourceProvenance,
): Readonly<{ schema: HsonSchemaSemanticNode; optional: boolean }> | undefined {
  if (input === "string" || input === "number" || input === "boolean" || input === "null") {
    const schema = Object.freeze({ kind: input } as const);
    bind_range(schema, path, ranges, root, provenance);
    return Object.freeze({ schema, optional: false });
  }
  if (!is_object(input)) {
    issue(issues, "INVALID_SCHEMA_EXPRESSION", path, "Schema expression must be a primitive atom or one MVP descriptor.");
    return undefined;
  }
  const keys = Object.keys(input);
  if (keys.length !== 1) {
    issue(issues, "UNKNOWN_SCHEMA_MEMBER", path, "Schema descriptor must contain exactly one known member.");
    return undefined;
  }
  const operator = keys[0] as string;
  const operand = input[operator];
  let schema: HsonSchemaSemanticNode | undefined;
  switch (operator) {
    case "exact":
      if (!is_primitive(operand)) issue(issues, "INVALID_SCHEMA_EXPRESSION", path, "`exact` requires one finite primitive or null.");
      else schema = Object.freeze({ kind: "exact", value: operand });
      break;
    case "content":
      schema = decode_object_members(operand, [...path, "content"], issues, ranges, root, provenance);
      break;
    case "optional": {
      if (!memberPosition) {
        issue(issues, "ILLEGAL_OPTIONAL", path, "`optional` is legal only as the direct Schema of a structure member.");
        break;
      }
      const decoded = decode_expression(operand, [...path, "optional"], false, issues, ranges, root, provenance);
      if (decoded?.optional) issue(issues, "ILLEGAL_OPTIONAL", path, "Nested `optional` is not supported.");
      if (decoded !== undefined) return Object.freeze({ schema: decoded.schema, optional: true });
      break;
    }
    case "array": {
      const decoded = decode_expression(operand, [...path, "array"], false, issues, ranges, root, provenance);
      if (decoded !== undefined) schema = Object.freeze({ kind: "array", item: decoded.schema });
      break;
    }
    case "tuple": {
      if (!Array.isArray(operand)) issue(issues, "INVALID_SCHEMA_EXPRESSION", path, "`tuple` requires one Hson array.");
      else {
        const items: HsonSchemaSemanticNode[] = [];
        operand.forEach((item, index) => {
          const decoded = decode_expression(item, [...path, "tuple", index], false, issues, ranges, root, provenance);
          if (decoded !== undefined) items.push(decoded.schema);
        });
        schema = Object.freeze({ kind: "tuple", items: Object.freeze(items) });
      }
      break;
    }
    case "union": {
      if (!Array.isArray(operand) || operand.length !== 2) issue(issues, "INVALID_UNION", path, "`union` requires exactly two branches.");
      else {
        const left = decode_expression(operand[0], [...path, "union", 0], false, issues, ranges, root, provenance);
        const right = decode_expression(operand[1], [...path, "union", 1], false, issues, ranges, root, provenance);
        if (left !== undefined && right !== undefined && distinguishable(left.schema, right.schema)) {
          schema = Object.freeze({ kind: "union", choices: Object.freeze([left.schema, right.schema]) as readonly [HsonSchemaSemanticNode, HsonSchemaSemanticNode] });
        } else if (left !== undefined && right !== undefined) issue(issues, "INVALID_UNION", path, "Union branches are not distinguishable under the MVP rule.");
      }
      break;
    }
    default:
      issue(issues, "UNKNOWN_SCHEMA_MEMBER", [...path, operator], `Unknown Hson Schema member ${JSON.stringify(operator)}.`);
  }
  if (schema === undefined) return undefined;
  bind_range(schema, path, ranges, root, provenance);
  return Object.freeze({ schema, optional: false });
}

function decode_object_members(input: unknown, path: readonly (string | number)[], issues: HsonSchemaIssue[], ranges: Map<HsonSchemaSemanticNode, HsonSourceRange>, root: HsonNode, provenance: HsonSourceProvenance): HsonSchemaSemanticNode | undefined {
  if (!is_object(input)) {
    issue(issues, "INVALID_SCHEMA_EXPRESSION", path, "`content` requires one closed data object.");
    return undefined;
  }
  const members: { name: string; optional: boolean; schema: HsonSchemaSemanticNode }[] = [];
  for (const [name, value] of Object.entries(input)) {
    const decoded = decode_expression(value, [...path, name], true, issues, ranges, root, provenance);
    if (decoded !== undefined) members.push(Object.freeze({ name, optional: decoded.optional, schema: decoded.schema }));
  }
  const schema = Object.freeze({ kind: "object", members: Object.freeze(members) } as const);
  bind_range(schema, path, ranges, root, provenance);
  return schema;
}

export function lower_hson_schema_semantic(root: HsonSchemaSemanticNode): CanonicalSchemaGraph {
  const nodes: CanonicalSchemaNode[] = [];
  const lower = (schema: HsonSchemaSemanticNode, optional = false): number => {
    const ref = nodes.length;
    nodes.push({ kind: "projected-null" });
    if (optional) {
      nodes[ref] = { kind: "projected-optional", base: lower(schema) };
      return ref;
    }
    switch (schema.kind) {
      case "string": case "number": case "boolean": case "null": nodes[ref] = { kind: `projected-${schema.kind}` }; break;
      case "exact": nodes[ref] = schema.value === null ? { kind: "projected-null" } : { kind: "projected-literal", values: Object.freeze([schema.value]) }; break;
      case "object": nodes[ref] = { kind: "projected-object", exact: true, properties: Object.freeze(schema.members.map((member) => Object.freeze([member.name, lower(member.schema, member.optional)] as const))) }; break;
      case "array": nodes[ref] = { kind: "projected-array", item: lower(schema.item) }; break;
      case "tuple": nodes[ref] = { kind: "projected-tuple", items: Object.freeze(schema.items.map((item) => lower(item))) }; break;
      case "union": nodes[ref] = { kind: "projected-union", choices: Object.freeze(schema.choices.map((choice) => lower(choice))) }; break;
    }
    return ref;
  };
  const projectedRoot = lower(root);
  return { format: CANONICAL_SCHEMA_FORMAT, version: CANONICAL_SCHEMA_VERSION, capabilities: { projectedRoot }, nodes: Object.freeze(nodes) };
}

function distinguishable(left: HsonSchemaSemanticNode, right: HsonSchemaSemanticNode): boolean {
  const primitive = (value: HsonSchemaSemanticNode): string | undefined => value.kind === "exact" ? typeof value.value : ["string", "number", "boolean", "null"].includes(value.kind) ? value.kind : undefined;
  const a = primitive(left), b = primitive(right);
  if (a !== undefined || b !== undefined) return a !== undefined && b !== undefined && a !== b;
  if (left.kind !== "object" || right.kind !== "object") return false;
  for (const member of left.members) {
    if (member.optional || member.schema.kind !== "exact" || typeof member.schema.value !== "string") continue;
    const other = right.members.find((candidate) => candidate.name === member.name);
    if (other !== undefined && !other.optional && other.schema.kind === "exact" && typeof other.schema.value === "string" && other.schema.value !== member.schema.value) return true;
  }
  return false;
}

function is_object(value: unknown): value is JsonObject { return typeof value === "object" && value !== null && !Array.isArray(value); }
function is_primitive(value: unknown): value is string | number | boolean | null { return value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)); }
function issue(issues: HsonSchemaIssue[], code: HsonSchemaIssueCode, path: readonly (string | number)[], message: string): void { issues.push(Object.freeze({ code, path: Object.freeze([...path]), message })); }
function failure(code: HsonSchemaIssueCode, path: readonly (string | number)[], message: string): HsonSchemaCompilation { return Object.freeze({ ok: false, issues: Object.freeze([Object.freeze({ code, path: Object.freeze([...path]), message })]) }); }
function bind_range(schema: HsonSchemaSemanticNode, _path: readonly (string | number)[], ranges: Map<HsonSchemaSemanticNode, HsonSourceRange>, _root: HsonNode, provenance: HsonSourceProvenance): void { ranges.set(schema, provenance.sourceRange); }

function build_bootstrap(): VerifiedCanonicalSchemaGraph {
  // The recursive bootstrap intentionally validates the finite wire domain only;
  // type-dependent legality and restricted-union distinguishability belong to
  // the deterministic human decoder above.
  const nodes: CanonicalSchemaNode[] = [
    { kind: "projected-object", exact: true, properties: [["type", 1], ["content", 2]] },
    { kind: "projected-literal", values: ["data"] },
    { kind: "projected-record", value: 3 },
    { kind: "projected-union", choices: [4, 5, 11, 14, 16, 18, 21] },
    { kind: "projected-literal", values: ["string", "number", "boolean", "null"] },
    { kind: "projected-object", exact: true, properties: [["exact", 6]] },
    { kind: "projected-union", choices: [7, 8, 9, 10] },
    { kind: "projected-string" },
    { kind: "projected-number" },
    { kind: "projected-boolean" },
    { kind: "projected-null" },
    { kind: "projected-object", exact: true, properties: [["content", 12]] },
    { kind: "projected-record", value: 13 },
    { kind: "projected-ref", target: 3 },
    { kind: "projected-object", exact: true, properties: [["optional", 15]] },
    { kind: "projected-ref", target: 3 },
    { kind: "projected-object", exact: true, properties: [["array", 17]] },
    { kind: "projected-ref", target: 3 },
    { kind: "projected-object", exact: true, properties: [["tuple", 19]] },
    { kind: "projected-array", item: 20 },
    { kind: "projected-ref", target: 3 },
    { kind: "projected-object", exact: true, properties: [["union", 22]] },
    { kind: "projected-tuple", items: [23, 24] },
    { kind: "projected-ref", target: 3 },
    { kind: "projected-ref", target: 3 },
  ];
  const result = verify_canonical_schema_graph({ format: CANONICAL_SCHEMA_FORMAT, version: CANONICAL_SCHEMA_VERSION, capabilities: { projectedRoot: 0 }, nodes });
  if (!result.ok) throw new Error(result.issues.map((entry) => entry.message).join(" "));
  return result.graph;
}

export const HSON_SCHEMA_MVP_BOOTSTRAP = build_bootstrap();
