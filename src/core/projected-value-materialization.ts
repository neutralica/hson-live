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
      for (const child of candidate) {
        define_materialized_property(result, result.length, visit(child));
      }
      return result;
    }
    if (!is_ordered_projected_object(candidate)) {
      throw new TypeError("Invalid ordered data object carrier.");
    }

    const result: Record<string, JsonValue> = {};
    for (const [key, child] of candidate.entries) {
      define_materialized_property(result, key, visit(child));
    }
    return result;
  };

  return visit(value);
}

/** Create an own Data property without invoking inherited setters. @internal */
export function define_materialized_property(target: object, key: string | number, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}
