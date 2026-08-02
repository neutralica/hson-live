import { hsonNumber } from "./hson-number.js";
import {
  ordered_projected_array,
  ordered_projected_object,
  type OrderedProjectedValue,
} from "./ordered-projected-value.js";

export type ProjectedValueAdmissionCode =
  | "UNDEFINED_VALUE"
  | "NONFINITE_NUMBER"
  | "UNSUPPORTED_TYPE"
  | "UNSUPPORTED_PROTOTYPE"
  | "SYMBOL_KEY"
  | "NONENUMERABLE_PROPERTY"
  | "ACCESSOR_PROPERTY"
  | "SPARSE_ARRAY"
  | "EXTRA_ARRAY_PROPERTY"
  | "CYCLE"
  | "REFLECTION_FAILED";

export type ProjectedValuePath = readonly (string | number)[];

/** Structured failure from neutral projected-value admission. */
export class ProjectedValueAdmissionError extends TypeError {
  readonly code: ProjectedValueAdmissionCode;
  readonly path: ProjectedValuePath;
  readonly originPath: ProjectedValuePath | undefined;

  constructor(
    code: ProjectedValueAdmissionCode,
    path: ProjectedValuePath,
    detail: string,
    options: Readonly<{ originPath?: ProjectedValuePath; cause?: unknown }> = {},
  ) {
    super(
      `Projected value admission failed at ${format_projected_value_path(path)}: ${detail}`,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "ProjectedValueAdmissionError";
    this.code = code;
    this.path = Object.freeze([...path]);
    this.originPath = options.originPath === undefined
      ? undefined
      : Object.freeze([...options.originPath]);
  }
}

/**
 * Snapshot one supported JavaScript value into a fresh immutable semantic carrier.
 *
 * Each structured occurrence is reflected independently. Active recursion-stack
 * identity rejects cycles, while repeated acyclic references are copied
 * structurally and do not retain caller identity.
 */
export function admit_projected_value(
  input: unknown,
  initialPath: ProjectedValuePath = Object.freeze([]),
): OrderedProjectedValue {
  const active = new WeakMap<object, ProjectedValuePath>();

  const visit = (value: unknown, path: ProjectedValuePath): OrderedProjectedValue => {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") {
      try {
        return hsonNumber(value);
      } catch (cause) {
        throw new ProjectedValueAdmissionError(
          "NONFINITE_NUMBER",
          path,
          `number must be finite; received ${String(value)}`,
          { cause },
        );
      }
    }
    if (value === undefined) {
      throw new ProjectedValueAdmissionError("UNDEFINED_VALUE", path, "undefined is not supported");
    }
    if (typeof value !== "object") {
      throw new ProjectedValueAdmissionError(
        "UNSUPPORTED_TYPE",
        path,
        `${typeof value} is not supported`,
      );
    }

    const originPath = active.get(value);
    if (originPath !== undefined) {
      throw new ProjectedValueAdmissionError(
        "CYCLE",
        path,
        `cycle returns to ${format_projected_value_path(originPath)}`,
        { originPath },
      );
    }

    const prototype = reflect_once(path, "read prototype", () => Object.getPrototypeOf(value));
    const isArray = reflect_once(path, "classify array", () => Array.isArray(value));
    active.set(value, Object.freeze([...path]));
    try {
      return isArray
        ? admit_array(value, prototype, path, visit)
        : admit_object(value, prototype, path, visit);
    } finally {
      active.delete(value);
    }
  };

  return visit(input, Object.freeze([...initialPath]));
}

function admit_object(
  value: object,
  prototype: object | null,
  path: ProjectedValuePath,
  visit: (value: unknown, path: ProjectedValuePath) => OrderedProjectedValue,
): OrderedProjectedValue {
  if (prototype !== Object.prototype && prototype !== null) {
    throw new ProjectedValueAdmissionError(
      "UNSUPPORTED_PROTOTYPE",
      path,
      "object prototype must be Object.prototype or null",
    );
  }

  const keys = reflect_once(path, "read own keys", () => Reflect.ownKeys(value));
  const entries: Array<readonly [string, OrderedProjectedValue]> = [];
  for (const key of keys) {
    if (typeof key === "symbol") {
      throw new ProjectedValueAdmissionError("SYMBOL_KEY", path, "symbol-keyed properties are not supported");
    }
    const childPath = append_path(path, key);
    const descriptor = own_descriptor(value, key, childPath);
    assert_enumerable_data_descriptor(descriptor, key, childPath);
    entries.push([key, visit(descriptor.value, childPath)]);
  }
  return ordered_projected_object(entries);
}

function admit_array(
  value: object,
  prototype: object | null,
  path: ProjectedValuePath,
  visit: (value: unknown, path: ProjectedValuePath) => OrderedProjectedValue,
): OrderedProjectedValue {
  if (prototype !== Array.prototype) {
    throw new ProjectedValueAdmissionError(
      "UNSUPPORTED_PROTOTYPE",
      path,
      "array prototype must be Array.prototype",
    );
  }

  const keys = reflect_once(path, "read own keys", () => Reflect.ownKeys(value));
  const indexed: Array<Readonly<{ index: number; descriptor: PropertyDescriptor }>> = [];
  let lengthDescriptor: PropertyDescriptor | undefined;

  for (const key of keys) {
    if (typeof key === "symbol") {
      throw new ProjectedValueAdmissionError("SYMBOL_KEY", path, "symbol-keyed array properties are not supported");
    }
    const keyPath = append_path(path, key);
    const descriptor = own_descriptor(value, key, keyPath);
    if (key === "length") {
      lengthDescriptor = descriptor;
      continue;
    }
    const index = canonical_array_index(key);
    if (index === undefined) {
      throw new ProjectedValueAdmissionError(
        "EXTRA_ARRAY_PROPERTY",
        keyPath,
        `array property ${JSON.stringify(key)} is not an indexed item`,
      );
    }
    assert_enumerable_data_descriptor(descriptor, key, keyPath);
    indexed.push(Object.freeze({ index, descriptor }));
  }

  if (lengthDescriptor === undefined || !("value" in lengthDescriptor)) {
    throw new ProjectedValueAdmissionError("REFLECTION_FAILED", path, "array length descriptor is missing");
  }
  const length = lengthDescriptor.value;
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new ProjectedValueAdmissionError("REFLECTION_FAILED", path, "array length descriptor is invalid");
  }
  if (indexed.length !== length || indexed.some(({ index }) => index >= length)) {
    throw new ProjectedValueAdmissionError("SPARSE_ARRAY", path, "array must contain every index exactly once");
  }

  indexed.sort((left, right) => left.index - right.index);
  for (let position = 0; position < indexed.length; position += 1) {
    if (indexed[position]?.index !== position) {
      throw new ProjectedValueAdmissionError("SPARSE_ARRAY", path, "array indexes must be dense");
    }
  }

  return ordered_projected_array(indexed.map(({ index, descriptor }) => (
    visit(descriptor.value, append_path(path, index))
  )));
}

function own_descriptor(
  value: object,
  key: PropertyKey,
  path: ProjectedValuePath,
): PropertyDescriptor {
  const descriptor = reflect_once(path, "read own property descriptor", () => (
    Reflect.getOwnPropertyDescriptor(value, key)
  ));
  if (descriptor !== undefined) return descriptor;
  throw new ProjectedValueAdmissionError(
    "REFLECTION_FAILED",
    path,
    "own key disappeared before its descriptor was captured",
  );
}

function assert_enumerable_data_descriptor(
  descriptor: PropertyDescriptor,
  key: string,
  path: ProjectedValuePath,
): asserts descriptor is PropertyDescriptor & { value: unknown } {
  if (!descriptor.enumerable) {
    throw new ProjectedValueAdmissionError(
      "NONENUMERABLE_PROPERTY",
      path,
      `property ${JSON.stringify(key)} must be enumerable`,
    );
  }
  if (!("value" in descriptor)) {
    throw new ProjectedValueAdmissionError(
      "ACCESSOR_PROPERTY",
      path,
      `property ${JSON.stringify(key)} must be a data property`,
    );
  }
}

function canonical_array_index(key: string): number | undefined {
  if (key === "") return undefined;
  const index = Number(key);
  if (!Number.isInteger(index) || index < 0 || index >= 4_294_967_295) return undefined;
  return String(index) === key ? index : undefined;
}

function reflect_once<T>(
  path: ProjectedValuePath,
  operation: string,
  inspect: () => T,
): T {
  try {
    return inspect();
  } catch (cause) {
    throw new ProjectedValueAdmissionError(
      "REFLECTION_FAILED",
      path,
      `${operation} failed`,
      { cause },
    );
  }
}

function append_path(path: ProjectedValuePath, part: string | number): ProjectedValuePath {
  return Object.freeze([...path, part]);
}

function format_projected_value_path(path: ProjectedValuePath): string {
  return path.length === 0 ? "$" : `$${path.map((part) => `[${JSON.stringify(part)}]`).join("")}`;
}
