import { parse_hson } from "../../api/transform/parsers/parse-hson.js";
import { serialize_hson } from "../../api/transform/serializers/serialize-hson.js";
import { detach_hson_root_value } from "../../api/transform/utils/node-utils/detach-hson-root-value.js";
import { admit_projected_value } from "../../core/projected-value-admission.js";
import { materialize_projected_value } from "../../core/projected-value-materialization.js";
import { is_ordered_projected_object, ordered_projected_object, type OrderedProjectedValue } from "../../core/ordered-projected-value.js";
import { is_projected_value_hson_node, projected_value_from_hson_node, projected_value_to_hson_node } from "../../core/projected-value-graph.js";
import type { CanonicalSchemaGraph, VerifiedCanonicalSchemaGraph } from "./graph.js";
import type { CanonicalGraphVerification } from "./issues.js";
import { verify_canonical_schema_graph } from "./verify.js";

type LiteralWire =
  | Readonly<{ type: "string"; value: string }>
  | Readonly<{ type: "number"; value: number }>
  | Readonly<{ type: "boolean"; value: boolean }>
  | Readonly<{ type: "null" }>
  | Readonly<{ type: "array"; items: readonly LiteralWire[] }>
  | Readonly<{ type: "object"; entries: readonly (readonly [string, LiteralWire])[] }>;

/** Deterministic machine encoding. The envelope is an ordinary HSON object (`>` closer). */
export function encode_canonical_schema_graph_hson(graph: VerifiedCanonicalSchemaGraph): string {
  const machine = {
    format: graph.format,
    version: graph.version,
    capabilities: graph.capabilities,
    nodes: graph.nodes.map((node) => node.kind === "projected-literal"
      ? { ...node, values: node.values.map(literal_to_wire) }
      : node),
    ...(graph.semanticDiagnosticMetadata === undefined ? {} : { semanticDiagnosticMetadata: graph.semanticDiagnosticMetadata }),
    ...(graph.documentationMetadata === undefined ? {} : { documentationMetadata: graph.documentationMetadata }),
  };
  return serialize_hson(projected_value_to_hson_node(admit_projected_value(machine)), { noBreak: true });
}

export function decode_canonical_schema_graph_hson(source: string): CanonicalGraphVerification {
  try {
    if (typeof source !== "string") throw new TypeError("Canonical Schema HSON must be a string.");
    const valueNode = detach_hson_root_value(parse_hson(source));
    if (!is_projected_value_hson_node(valueNode)) throw new TypeError("Canonical Schema graph encoding must use ordinary HSON object context (`>`), not element context (`/>`).");
    const materialized = materialize_projected_value(projected_value_from_hson_node(valueNode));
    if (!is_record(materialized) || !Array.isArray(materialized.nodes)) throw new TypeError("Canonical Schema graph encoding has no node table.");
    const nodes = materialized.nodes.map((node) => {
      if (!is_record(node) || node.kind !== "projected-literal") return node;
      if (!Array.isArray(node.values)) throw new TypeError("Canonical literal wire values must be an array.");
      return { ...node, values: node.values.map(wire_to_literal) };
    });
    return verify_canonical_schema_graph({ ...materialized, nodes } as unknown as CanonicalSchemaGraph);
  } catch (error) {
    return Object.freeze({
      ok: false,
      issues: Object.freeze([Object.freeze({
        code: "INVALID_GRAPH" as const,
        path: Object.freeze([]),
        message: error instanceof Error ? error.message : "Malformed Canonical Schema HSON.",
      })]),
    });
  }
}

function literal_to_wire(value: OrderedProjectedValue): LiteralWire {
  if (typeof value === "string") return Object.freeze({ type: "string", value });
  if (typeof value === "number") return Object.freeze({ type: "number", value });
  if (typeof value === "boolean") return Object.freeze({ type: "boolean", value });
  if (value === null) return Object.freeze({ type: "null" });
  if (Array.isArray(value)) return Object.freeze({ type: "array", items: Object.freeze(value.map(literal_to_wire)) });
  if (!is_ordered_projected_object(value)) throw new TypeError("Canonical literal is not an admitted ordered projected value.");
  return Object.freeze({
    type: "object",
    entries: Object.freeze(value.entries.map(([key, child]) => Object.freeze([key, literal_to_wire(child)] as const))),
  });
}

function wire_to_literal(value: unknown): OrderedProjectedValue {
  if (!is_record(value) || typeof value.type !== "string") throw new TypeError("Malformed canonical literal wire value.");
  const fields = Object.keys(value);
  if (value.type === "null" && fields.length === 1) return null;
  if (value.type === "string" && fields.length === 2 && typeof value.value === "string") return value.value;
  if (value.type === "number" && fields.length === 2 && typeof value.value === "number" && Number.isFinite(value.value)) return value.value;
  if (value.type === "boolean" && fields.length === 2 && typeof value.value === "boolean") return value.value;
  if (value.type === "array" && fields.length === 2 && Array.isArray(value.items)) return Object.freeze(value.items.map(wire_to_literal));
  if (value.type === "object" && fields.length === 2 && Array.isArray(value.entries)) {
    const names = new Set<string>();
    return ordered_projected_object(value.entries.map((entry) => {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || names.has(entry[0])) throw new TypeError("Malformed or duplicate canonical literal object entry.");
      names.add(entry[0]); return Object.freeze([entry[0], wire_to_literal(entry[1])] as const);
    }));
  }
  throw new TypeError("Malformed canonical literal wire value.");
}

function is_record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
