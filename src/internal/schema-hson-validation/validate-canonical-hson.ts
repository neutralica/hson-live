import type { HsonCanonical, HsonSchema } from "../../api/transform/transform.types.js";
import { HsonSchemaError } from "../../api/livemap/livemap.error.js";
import { parse_hson } from "../../api/transform/parsers/parse-hson.js";
import { detach_hson_root_value } from "../../api/transform/utils/node-utils/detach-hson-root-value.js";
import { compiled_hson_schema_of } from "../../api/schema/hson-schema.js";
import { projected_value_from_hson_node } from "../../core/projected-value-graph.js";
import { evaluate_canonical_document_schema, evaluate_canonical_projected_schema } from "../canonical-schema/evaluate.js";

/** Shared synchronous canonical boundary. No map construction or certification. */
export function validate_canonical_hson(schema: HsonSchema, canonical: HsonCanonical): HsonCanonical;
export function validate_canonical_hson(schema: HsonSchema, canonical: HsonCanonical): HsonCanonical {
  if (typeof canonical !== "string") throw new TypeError("validate requires an HsonCanonical string.");
  const compiled = compiled_hson_schema_of(schema);
  const graph = compiled.semantic.kind === "document" || compiled.semantic.kind === "document-element"
    ? parse_hson(canonical, { allowTopLevelDocumentText: true })
    : detach_hson_root_value(parse_hson(canonical));
  validate_hson_schema_graph(schema, graph);
  return canonical;
}

/** @internal Validate an already-owned canonical graph without string round-tripping. */
export function validate_hson_schema_graph(schema: HsonSchema, graph: import("../../core/types.js").HsonNode): void {
  const compiled = compiled_hson_schema_of(schema);
  let result;
  if (compiled.semantic.kind === "document" || compiled.semantic.kind === "document-element") {
    result = evaluate_canonical_document_schema(compiled.graph, graph);
  } else {
    let projected;
    try { projected = projected_value_from_hson_node(graph); }
    catch { throw new HsonSchemaError("Hson Schema validation failed.", [], [Object.freeze({ code: "TYPE_MISMATCH" as const, path: [], message: "Expected data Hson; received document Hson." })]); }
    result = evaluate_canonical_projected_schema(compiled.graph, projected);
  }
  if (!result.ok) throw new HsonSchemaError("Hson Schema validation failed.", result.issues[0]?.path ?? [], result.issues.map((issue) => Object.freeze({ code: issue.code, path: issue.path, message: `Schema validation failed at ${issue.path.join(".") || "root"}.`, ...(issue.expected === undefined ? {} : { expected: issue.expected }), ...(issue.received === undefined ? {} : { received: issue.received }), ...(issue.evidence.relatedPath === undefined ? {} : { relatedPath: issue.evidence.relatedPath }), ...(issue.evidence.conflictingKey === undefined ? {} : { conflictingKey: issue.evidence.conflictingKey }) })));
}
