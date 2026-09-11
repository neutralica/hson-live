import type { JsonValue } from "../../../../core/types.js";
import type { OrderedProjectedValue } from "../../../../core/ordered-projected-value.js";
import { admit_projected_value } from "../../../../core/projected-value-admission.js";
import { materialize_projected_value } from "../../../../core/projected-value-materialization.js";

export { emit_ordered_json, parse_ordered_json_text } from "../../../../core/exact-data-codec.js";

export function ordered_json_from_runtime_value(value: JsonValue): OrderedProjectedValue {
  return admit_projected_value(value);
}

export function ordered_json_to_runtime_value(value: OrderedProjectedValue): JsonValue {
  return materialize_projected_value(value);
}
