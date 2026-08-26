import { admit_hson_number } from "./hson-number.js";
import type { Primitive } from "./types.js";

const ORDERED_PROJECTED_OBJECT: unique symbol = Symbol("hson.ordered-projected-object");
const VALIDATED_ORDERED_PROJECTED_VALUES = new WeakSet<object>();

/** One object-shaped projected value whose property order is explicit data. */
export type OrderedProjectedObject = Readonly<{
  readonly [ORDERED_PROJECTED_OBJECT]: true;
  readonly entries: readonly (readonly [string, OrderedProjectedValue])[];
}>;

/** Immutable semantic carrier for one generic projected JSON-like value. */
export type OrderedProjectedValue =
  | Primitive
  | readonly OrderedProjectedValue[]
  | OrderedProjectedObject;

/** Construct one immutable dense carrier array. */
export function ordered_projected_array(
  values: readonly OrderedProjectedValue[],
): readonly OrderedProjectedValue[] {
  const result = Object.freeze([...values]);
  assert_ordered_projected_value(result);
  return result;
}

/** Construct one immutable ordered carrier object and reject duplicate keys. */
export function ordered_projected_object(
  entries: readonly (readonly [string, OrderedProjectedValue])[],
): OrderedProjectedObject {
  const keys = new Set<string>();
  const copiedEntries = entries.map(([key, value]) => {
    if (typeof key !== "string") {
      throw new TypeError("Ordered projected object keys must be strings.");
    }
    if (keys.has(key)) {
      throw new TypeError(`Duplicate ordered projected object key ${JSON.stringify(key)}.`);
    }
    keys.add(key);
    assert_ordered_projected_value(value);
    return Object.freeze([key, value] as const);
  });

  return Object.freeze({
    [ORDERED_PROJECTED_OBJECT]: true as const,
    entries: Object.freeze(copiedEntries),
  });
}

/** Return whether a value carries the private ordered-object brand. */
export function is_ordered_projected_object(value: unknown): value is OrderedProjectedObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.getOwnPropertyDescriptor(value, ORDERED_PROJECTED_OBJECT)?.value === true;
}

/** Return whether a value is a complete deeply immutable ordered carrier. */
export function is_ordered_projected_value(value: unknown): value is OrderedProjectedValue {
  try {
    assert_ordered_projected_value(value);
    return true;
  } catch {
    return false;
  }
}

/** Assert the carrier domain, density, uniqueness, acyclicity, and immutability. */
export function assert_ordered_projected_value(value: unknown): asserts value is OrderedProjectedValue {
  const active = new WeakSet<object>();

  const visit = (candidate: unknown): void => {
    if (candidate === null || typeof candidate === "string" || typeof candidate === "boolean") return;
    if (typeof candidate === "number") {
      admit_hson_number(candidate);
      return;
    }
    if (typeof candidate !== "object") {
      throw new TypeError(`Unsupported ordered projected value type ${typeof candidate}.`);
    }
    if (VALIDATED_ORDERED_PROJECTED_VALUES.has(candidate)) return;
    if (active.has(candidate)) {
      throw new TypeError("Ordered projected values must be acyclic.");
    }

    active.add(candidate);
    if (Array.isArray(candidate)) {
      if (!Object.isFrozen(candidate)) {
        throw new TypeError("Ordered projected arrays must be immutable.");
      }
      for (let index = 0; index < candidate.length; index += 1) {
        if (!Object.hasOwn(candidate, index)) {
          throw new TypeError(`Ordered projected arrays must be dense at index ${index}.`);
        }
        visit(candidate[index]);
      }
      active.delete(candidate);
      VALIDATED_ORDERED_PROJECTED_VALUES.add(candidate);
      return;
    }

    if (!is_ordered_projected_object(candidate) || !Object.isFrozen(candidate)) {
      throw new TypeError("Ordered projected objects must use the ordered carrier factory.");
    }
    if (!Array.isArray(candidate.entries) || !Object.isFrozen(candidate.entries)) {
      throw new TypeError("Ordered projected object entries must be immutable.");
    }

    const keys = new Set<string>();
    for (const entry of candidate.entries) {
      if (!Array.isArray(entry) || entry.length !== 2 || !Object.isFrozen(entry)) {
        throw new TypeError("Ordered projected object entries must be immutable key/value pairs.");
      }
      const [key, child] = entry;
      if (typeof key !== "string") {
        throw new TypeError("Ordered projected object keys must be strings.");
      }
      if (keys.has(key)) {
        throw new TypeError(`Duplicate ordered projected object key ${JSON.stringify(key)}.`);
      }
      keys.add(key);
      visit(child);
    }
    active.delete(candidate);
    VALIDATED_ORDERED_PROJECTED_VALUES.add(candidate);
  };

  visit(value);
}

/** Exact ordered structural equality for admitted projected-value carriers. */
export function ordered_projected_value_equal(
  left: OrderedProjectedValue,
  right: OrderedProjectedValue,
): boolean {
  if (Object.is(left, right)) return true;

  if (left === null || right === null) return false;
  if (typeof left !== "object" || typeof right !== "object") return false;

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      const leftItem = left[index];
      const rightItem = right[index];
      if (leftItem === undefined || rightItem === undefined) return false;
      if (!ordered_projected_value_equal(leftItem, rightItem)) return false;
    }
    return true;
  }

  if (!is_ordered_projected_object(left) || !is_ordered_projected_object(right)) return false;
  if (left.entries.length !== right.entries.length) return false;

  for (let index = 0; index < left.entries.length; index += 1) {
    const leftEntry = left.entries[index];
    const rightEntry = right.entries[index];
    if (leftEntry === undefined || rightEntry === undefined) return false;
    if (leftEntry[0] !== rightEntry[0]) return false;
    if (!ordered_projected_value_equal(leftEntry[1], rightEntry[1])) return false;
  }
  return true;
}

/** Exact equality for a projected carrier or the path-absence sentinel. */
export function optional_ordered_projected_value_equal(
  left: OrderedProjectedValue | undefined,
  right: OrderedProjectedValue | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return ordered_projected_value_equal(left, right);
}
