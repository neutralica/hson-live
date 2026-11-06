import type { HsonSchema } from "../../api/transform/transform.types.js";
import { HsonSchemaError } from "../../api/livemap/livemap.error.js";
import { compiled_hson_schema_of } from "../../api/schema/hson-schema.js";
import { assert_canonical_hson_data_value, projected_value_from_hson_node } from "../../core/projected-value-graph.js";
import type { OrderedProjectedValue } from "../../core/ordered-projected-value.js";
import { evaluate_canonical_document_schema, evaluate_canonical_projected_schema } from "../canonical-schema/evaluate.js";

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
    assert_canonical_hson_data_value(projected);
    result = evaluate_canonical_projected_schema(compiled.graph, projected);
  }
  require_schema_match(result);
}

/** @internal Evaluate owned Data directly, preserving qualification and diagnostic mapping. */
export function validate_hson_schema_data(schema: HsonSchema, value: OrderedProjectedValue): void {
  assert_canonical_hson_data_value(value);
  require_schema_match(evaluate_canonical_projected_schema(compiled_hson_schema_of(schema).graph, value));
}

function require_schema_match(result: ReturnType<typeof evaluate_canonical_projected_schema>): void {
  if (!result.ok) throw new HsonSchemaError("Hson Schema validation failed.", result.issues[0]?.path ?? [], result.issues.map((issue) => Object.freeze({
    code: issue.code, path: issue.path, message: `Schema validation failed at ${issue.path.join(".") || "root"}.`,
    ...(issue.expected === undefined ? {} : { expected: issue.expected }),
    ...(issue.received === undefined ? {} : { received: issue.received }),
    ...(issue.attributeName === undefined ? {} : { attributeName: issue.attributeName }),
    ...(issue.evidence.relatedPath === undefined ? {} : { relatedPath: issue.evidence.relatedPath }),
    ...(issue.evidence.conflictingKey === undefined ? {} : { conflictingKey: issue.evidence.conflictingKey }),
  })));
}
