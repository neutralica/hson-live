import {
  assert_ordered_projected_value,
  is_ordered_projected_object,
  type OrderedProjectedValue,
} from "./ordered-projected-value.js";
import type { JsonValue } from "./types.js";

/** Materialize a fresh detached public JavaScript view from the semantic carrier. */
export function materialize_projected_value(value: OrderedProjectedValue): JsonValue {
  assert_ordered_projected_value(value);

  const visit = (candidate: OrderedProjectedValue): JsonValue => {
    if (candidate === null
      || typeof candidate === "string"
      || typeof candidate === "boolean"
      || typeof candidate === "number") {
      return candidate;
    }
    if (Array.isArray(candidate)) {
      const result: JsonValue[] = [];
      for (const child of candidate) result.push(visit(child));
      return result;
    }
    if (!is_ordered_projected_object(candidate)) {
      throw new TypeError("Invalid ordered data object carrier.");
    }

    const result: Record<string, JsonValue> = {};
    for (const [key, child] of candidate.entries) {
      Object.defineProperty(result, key, {
        value: visit(child),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return result;
  };

  return visit(value);
}
