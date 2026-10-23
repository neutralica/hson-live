import { admit_hson_number } from "./hson-number.js";
import type { Primitive } from "./types.js";

const ORDERED_PROJECTED_OBJECT: unique symbol = Symbol("hson.ordered-projected-object");
// Only the factories below enroll fresh containers, after checking every child.
// Frozen caller arrays can still contain getters or Proxy/iterator behavior.
const OWNED_ORDERED_PROJECTED_VALUES = new WeakSet<object>();

/** One object-shaped data value whose property order is explicit data. */
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
  for (const value of result) assert_ordered_projected_value(value);
  OWNED_ORDERED_PROJECTED_VALUES.add(result);
  return result;
}

/** Construct one immutable ordered carrier object and reject duplicate keys. */
export function ordered_projected_object(
  entries: readonly (readonly [string, OrderedProjectedValue])[],
): OrderedProjectedObject {
  const keys = new Set<string>();
  const copiedEntries: Array<readonly [string, OrderedProjectedValue]> = [];
  for (const [key, value] of entries) {
    if (typeof key !== "string") {
      throw new TypeError("Ordered data object keys must be strings.");
    }
    if (keys.has(key)) {
      throw new TypeError(`Duplicate ordered data object key ${JSON.stringify(key)}.`);
    }
    keys.add(key);
    assert_ordered_projected_value(value);
    copiedEntries.push(Object.freeze([key, value] as const));
  }

  const result: OrderedProjectedObject = Object.freeze({
    [ORDERED_PROJECTED_OBJECT]: true as const,
    entries: Object.freeze(copiedEntries),
  });
  OWNED_ORDERED_PROJECTED_VALUES.add(result);
  return result;
}

/** Recognize a factory-owned object; a copied brand does not establish ownership. */
export function is_ordered_projected_object(value: unknown): value is OrderedProjectedObject {
  return typeof value === "object" && value !== null
    && OWNED_ORDERED_PROJECTED_VALUES.has(value) && !Array.isArray(value);
}

/** Recognize an exact primitive or a factory-owned deeply immutable carrier. */
export function is_ordered_projected_value(value: unknown): value is OrderedProjectedValue {
  try {
    assert_ordered_projected_value(value);
    return true;
  } catch {
    return false;
  }
}

/** Assert the primitive domain or established recursive container ownership. */
export function assert_ordered_projected_value(value: unknown): asserts value is OrderedProjectedValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    admit_hson_number(value);
    return;
  }
  if (typeof value === "object" && OWNED_ORDERED_PROJECTED_VALUES.has(value)) return;
  throw new TypeError("Ordered data containers must be owned by the ordered carrier factories.");
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

/** Exact equality for a data carrier or the path-absence sentinel. */
export function optional_ordered_projected_value_equal(
  left: OrderedProjectedValue | undefined,
  right: OrderedProjectedValue | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return ordered_projected_value_equal(left, right);
}
