// handle-array.ts

import type { JsonValue } from "../../core/types.js";
import type { LiveMapArrayItem, LiveMapArrayShape, LiveMapArrayWriteItem, LiveMapCore, LiveMapPathArrayApi, LivePath } from "../../types/livemap.types.js";
import { array_index_error, must_json_value, path_kind_error } from "./guard.js";

type LiveMapArrayHandleCore = Pick<LiveMapCore<JsonValue | undefined>, "snap" | "set">;

/**
 * Array-scoped helpers for a projected LiveMap path.
 *
 * Read helpers require the projected path to resolve to a JSON array. Mutation
 * helpers build a complete next array and write it back through core `set`, so
 * they preserve the public LiveMap rule that the addressed array path must
 * already resolve.
 *
 * Helpers that accept negative indexes resolve them relative to the end of the
 * current array. Insert positions may point one slot past the end; read,
 * remove, replace, and move positions must resolve to an existing item.
 */
export function make_livemap_array_api<TValue = JsonValue | undefined>(core: LiveMapArrayHandleCore, handlePath: LivePath): LiveMapPathArrayApi<TValue> {
  return {
    is: () => Array.isArray(core.snap(handlePath)),
    toArray: () => mustArrayValue(core.snap(handlePath), handlePath) as unknown as LiveMapArrayShape<TValue>,
    slice: (start, end) => arraySlice(core.snap(handlePath), handlePath, start, end) as unknown as LiveMapArrayShape<TValue>,
    take: (count) => mustArrayValue(core.snap(handlePath), handlePath).slice(0, arrayCount(count, handlePath)) as unknown as LiveMapArrayShape<TValue>,
    drop: (count) => mustArrayValue(core.snap(handlePath), handlePath).slice(arrayCount(count, handlePath)) as unknown as LiveMapArrayShape<TValue>,
    takeLast: (count) => {
      const arrayValue = mustArrayValue(core.snap(handlePath), handlePath);
      const itemCount = arrayCount(count, handlePath);
      return (itemCount === 0 ? [] : arrayValue.slice(-itemCount)) as unknown as LiveMapArrayShape<TValue>;
    },
    dropLast: (count) => {
      const arrayValue = mustArrayValue(core.snap(handlePath), handlePath);
      const itemCount = arrayCount(count, handlePath);
      return (itemCount === 0 ? arrayValue : arrayValue.slice(0, -itemCount)) as unknown as LiveMapArrayShape<TValue>;
    },
    length: () => mustArrayValue(core.snap(handlePath), handlePath).length,
    isEmpty: () => mustArrayValue(core.snap(handlePath), handlePath).length === 0,
    at: (index) => {
      const arrayValue = mustArrayValue(core.snap(handlePath), handlePath);
      return arrayValue[arrayIndex(arrayValue, handlePath, index)] as unknown as LiveMapArrayItem<TValue>;
    },
    first: () => {
      const arrayValue = mustArrayValue(core.snap(handlePath), handlePath);
      return arrayValue[arrayIndex(arrayValue, handlePath, 0)] as unknown as LiveMapArrayItem<TValue>;
    },
    last: () => {
      const arrayValue = mustArrayValue(core.snap(handlePath), handlePath);
      return arrayValue[arrayIndex(arrayValue, handlePath, -1)] as unknown as LiveMapArrayItem<TValue>;
    },
    includes: (value) => {
      const arrayValue = mustArrayValue(core.snap(handlePath), handlePath);
      const item = must_json_value(value, handlePath);
      return arrayValue.some((arrayItem) => jsonValueEquals(arrayItem, item));
    },
    indexOf: (value) => {
      const arrayValue = mustArrayValue(core.snap(handlePath), handlePath);
      const item = must_json_value(value, handlePath);
      return arrayValue.findIndex((arrayItem) => jsonValueEquals(arrayItem, item));
    },
    push: (value) => {
      const arrayValue = mustArrayValue(core.snap(handlePath), handlePath);
      return core.set(handlePath, arrayInsert(arrayValue, handlePath, arrayValue.length, must_json_value(value, [...handlePath, arrayValue.length])));
    },
    pushMany: (values) => {
      const arrayValue = mustArrayValue(core.snap(handlePath), handlePath);
      return core.set(handlePath, [...arrayValue, ...mustJsonArrayValue(values, handlePath)]);
    },
    unshift: (value) => core.set(handlePath, arrayInsert(core.snap(handlePath), handlePath, 0, must_json_value(value, [...handlePath, 0]))),
    unshiftMany: (values) => {
      const arrayValue = mustArrayValue(core.snap(handlePath), handlePath);
      return core.set(handlePath, [...mustJsonArrayValue(values, handlePath), ...arrayValue]);
    },
    pop: () => {
      const arrayValue = mustArrayValue(core.snap(handlePath), handlePath);
      return core.set(handlePath, arrayRemove(arrayValue, handlePath, arrayValue.length - 1));
    },
    shift: () => core.set(handlePath, arrayRemove(core.snap(handlePath), handlePath, 0)),
    clear: () => {
      mustArrayValue(core.snap(handlePath), handlePath);
      return core.set(handlePath, []);
    },
    reverse: () => core.set(handlePath, mustArrayValue(core.snap(handlePath), handlePath).reverse()),
    sortNumbers: (direction) => core.set(handlePath, arraySortNumbers(core.snap(handlePath), handlePath, direction)),
    sortStrings: (direction) => core.set(handlePath, arraySortStrings(core.snap(handlePath), handlePath, direction)),
   splice: (...args) => core.set(handlePath, arraySplice<TValue>(core.snap(handlePath), handlePath, args)),
    insert: (index, value) => core.set(handlePath, arrayInsert(core.snap(handlePath), handlePath, index, must_json_value(value, [...handlePath, index]))),
    remove: (index) => core.set(handlePath, arrayRemove(core.snap(handlePath), handlePath, index)),
    replace: (index, value) => core.set(handlePath, arrayReplace(core.snap(handlePath), handlePath, index, must_json_value(value, [...handlePath, index]))),
    move: (fromIndex, toIndex) => core.set(handlePath, arrayMove(core.snap(handlePath), handlePath, fromIndex, toIndex)),
    unique: () => core.set(handlePath, arrayUnique(core.snap(handlePath), handlePath)),
    removeValue: (value) => core.set(handlePath, arrayRemoveValue(core.snap(handlePath), handlePath, must_json_value(value, handlePath))),
    removeAll: (value) => core.set(handlePath, arrayRemoveAll(core.snap(handlePath), handlePath, must_json_value(value, handlePath))),
  };
}

/** Validate the current path as an array and return a shallow editable copy. */
function mustArrayValue(value: JsonValue | undefined, path: LivePath): JsonValue[] {
  if (!Array.isArray(value)) {
    throw path_kind_error(path, "array");
  }

  return [...value];
}

/** Validate a user-supplied value as a JSON array and return a shallow copy. */
function mustJsonArrayValue(value: unknown, path: LivePath): JsonValue[] {
  const jsonValue = must_json_value(value, path);
  if (!Array.isArray(jsonValue)) {
    throw new Error(`LiveMap array values are not an array at ${JSON.stringify(path)}`);
  }

  return [...jsonValue];
}

function arrayCount(count: number, path: LivePath): number {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`LiveMap array count is not valid at ${JSON.stringify(path)}: ${count}`);
  }

  return count;
}

function arrayOptionalIndex(index: number | undefined, path: LivePath, label: string): number | undefined {
  if (index === undefined) return undefined;
  if (!Number.isInteger(index)) {
    throw new Error(`LiveMap array ${label} is not a valid index at ${JSON.stringify(path)}: ${String(index)}`);
  }

  return index;
}

function arraySlice(value: JsonValue | undefined, path: LivePath, start?: number, end?: number): JsonValue[] {
  return mustArrayValue(value, path).slice(arrayOptionalIndex(start, path, "slice start"), arrayOptionalIndex(end, path, "slice end"));
}

function arraySpliceStart(start: number, path: LivePath): number {
  if (!Number.isInteger(start)) {
    throw new Error(`LiveMap array splice start is not a valid index at ${JSON.stringify(path)}: ${String(start)}`);
  }

  return start;
}

function arraySpliceDeleteCount(deleteCount: number, path: LivePath): number {
  if (!Number.isInteger(deleteCount) || deleteCount < 0) {
    throw new Error(`LiveMap array splice deleteCount is not valid at ${JSON.stringify(path)}: ${String(deleteCount)}`);
  }

  return deleteCount;
}

function arraySortDirection(direction: "asc" | "desc" | undefined, path: LivePath): 1 | -1 {
  if (direction === undefined || direction === "asc") return 1;
  if (direction === "desc") return -1;

  throw new Error(`LiveMap array sort direction is not valid at ${JSON.stringify(path)}: ${String(direction)}`);
}

function arraySortNumbers(value: JsonValue | undefined, path: LivePath, direction?: "asc" | "desc"): JsonValue {
  const next = mustArrayValue(value, path);
  const multiplier = arraySortDirection(direction, path);

  for (const item of next) {
    if (typeof item !== "number") {
      throw new Error(`LiveMap array contains a non-number item at ${JSON.stringify(path)}`);
    }
  }

  return next.sort((left, right) => multiplier * ((left as number) - (right as number)));
}

function arraySortStrings(value: JsonValue | undefined, path: LivePath, direction?: "asc" | "desc"): JsonValue {
  const next = mustArrayValue(value, path);
  const multiplier = arraySortDirection(direction, path);

  for (const item of next) {
    if (typeof item !== "string") {
      throw new Error(`LiveMap array contains a non-string item at ${JSON.stringify(path)}`);
    }
  }

  return next.sort((left, right) => {
    if (left === right) return 0;
    return multiplier * ((left as string) < (right as string) ? -1 : 1);
  });
}

function arraySplice<TValue>(value: JsonValue | undefined, path: LivePath, args: readonly [start: number] | readonly [start: number, deleteCount: number, ...items: LiveMapArrayWriteItem<TValue>[]]): JsonValue {
  const next = mustArrayValue(value, path);
  const [start, deleteCount, ...items] = args;
  const spliceStart = arraySpliceStart(start, path);
  const insertItems = items.map((item) => must_json_value(item, path));

  if (deleteCount === undefined) {
    next.splice(spliceStart);
    return next;
  }

  next.splice(spliceStart, arraySpliceDeleteCount(deleteCount, path), ...insertItems);
  return next;
}

function arrayUnique(value: JsonValue | undefined, path: LivePath): JsonValue {
  const next: JsonValue[] = [];

  for (const item of mustArrayValue(value, path)) {
    if (!next.some((nextItem) => jsonValueEquals(nextItem, item))) next.push(item);
  }

  return next;
}

function arrayRemoveValue(value: JsonValue | undefined, path: LivePath, item: JsonValue): JsonValue {
  const next = mustArrayValue(value, path);
  const index = next.findIndex((arrayItem) => jsonValueEquals(arrayItem, item));
  if (index === -1) return next;

  next.splice(index, 1);
  return next;
}

function arrayRemoveAll(value: JsonValue | undefined, path: LivePath, item: JsonValue): JsonValue {
  return mustArrayValue(value, path).filter((arrayItem) => !jsonValueEquals(arrayItem, item));
}

/** Structural equality for JSON values used by value-based array helpers. */
function jsonValueEquals(left: JsonValue, right: JsonValue): boolean {
  if (left === right) return true;

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;

    return left.every((item, index) => jsonValueEquals(item, right[index] as JsonValue));
  }

  if (!isObjectValue(left) || !isObjectValue(right)) return false;

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;

  return leftKeys.every((key) => key in right && jsonValueEquals(left[key] as JsonValue, right[key] as JsonValue));
}

function isObjectValue(value: JsonValue | undefined): value is Readonly<Record<string, JsonValue>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function arrayInsert(value: JsonValue | undefined, path: LivePath, index: number, item: JsonValue): JsonValue {
  const next = mustArrayValue(value, path);
  next.splice(arrayInsertIndex(next, path, index), 0, item);
  return next;
}

function arrayRemove(value: JsonValue | undefined, path: LivePath, index: number): JsonValue {
  const next = mustArrayValue(value, path);
  next.splice(arrayIndex(next, path, index), 1);
  return next;
}

function arrayReplace(value: JsonValue | undefined, path: LivePath, index: number, item: JsonValue): JsonValue {
  const next = mustArrayValue(value, path);
  next.splice(arrayIndex(next, path, index), 1, item);
  return next;
}

function arrayMove(value: JsonValue | undefined, path: LivePath, fromIndex: number, toIndex: number): JsonValue {
  const next = mustArrayValue(value, path);
  const [item] = next.splice(arrayIndex(next, path, fromIndex), 1);
  next.splice(arrayInsertIndex(next, path, toIndex), 0, item as JsonValue);
  return next;
}

function arrayIndex(value: readonly JsonValue[], path: LivePath, index: number): number {
  if (!Number.isInteger(index)) {
    throw array_index_error(path, index);
  }

  const resolvedIndex = index < 0 ? value.length + index : index;
  if (resolvedIndex < 0 || resolvedIndex >= value.length) {
    throw array_index_error(path, index);
  }

  return resolvedIndex;
}

function arrayInsertIndex(value: readonly JsonValue[], path: LivePath, index: number): number {
  if (!Number.isInteger(index)) {
    throw array_index_error(path, index);
  }

  const resolvedIndex = index < 0 ? value.length + index : index;
  if (resolvedIndex < 0 || resolvedIndex > value.length) {
    throw array_index_error(path, index);
  }

  return resolvedIndex;
}