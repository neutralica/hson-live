import type { HsonNode } from "../../core/types.js";
import type { HsonSchemaIssue } from "../../api/livemap/livemap.error.js";

export type SchemaGraphValidation = Readonly<{
  ok: boolean;
  issues: readonly HsonSchemaIssue[];
}>;

/** Callback-authored Schema validation is retired; use Hson.certify or LiveMap schema governance. */
export function validate_schema_hson_graph(_schema: unknown, _graph: HsonNode): SchemaGraphValidation {
  return {
    ok: false,
    issues: [Object.freeze({
      code: "INVALID_SCHEMA",
      path: [],
      message: "Historical callback-authored Schema validation is retired; use HsonSchema.",
    })],
  };
}
