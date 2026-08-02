// handle-array.ts

import type { JsonValue } from "../../core/types.js";
import {
  ordered_projected_array,
  ordered_projected_value_equal,
  type OrderedProjectedValue,
} from "../../core/ordered-projected-value.js";
import { materialize_projected_value } from "../../core/projected-value-materialization.js";
import type { LiveMapArrayItem, LiveMapArrayShape, LiveMapCore, LiveMapPathArrayApi, LivePath } from "../../types/livemap.types.js";
import { array_index_error, must_ordered_projected_value, path_kind_error } from "./livemap.guard.js";
import { livemap_projected_propagation } from "./livemap.projected-propagation.js";

type LiveMapArrayHandleCore = Pick<LiveMapCore<JsonValue | undefined>, "snap" | "set" | "splice">;

export function make_livemap_array_api<TValue = JsonValue | undefined>(
  core: LiveMapArrayHandleCore,
  handlePath: LivePath,
): LiveMapPathArrayApi<TValue> {
  const projected = livemap_projected_propagation(core);
  if (projected === undefined) throw new Error("LiveMap array helper has no projected propagation capability.");

  const read = (): readonly OrderedProjectedValue[] => {
    const value = projected.read(handlePath);
    if (!Array.isArray(value)) throw path_kind_error(handlePath, "array");
    return value;
  };
  const set = (value: readonly OrderedProjectedValue[]) => projected.commit([{
    kind: "set",
    path: handlePath,
    value: ordered_projected_array(value),
  }]);
  const splice = (
    start: number,
    deleteCount: number,
    items: readonly OrderedProjectedValue[] = [],
  ) => projected.commit([{ kind: "splice", path: handlePath, start, deleteCount, items }]);
  const materializeArray = (value: readonly OrderedProjectedValue[]) => (
    materialize_projected_value(ordered_projected_array(value)) as LiveMapArrayShape<TValue>
  );

  return {
    is: () => Array.isArray(projected.read(handlePath)),
    toArray: () => materializeArray(read()),
    slice: (start, end) => materializeArray(arraySlice(read(), handlePath, start, end)),
    take: (count) => materializeArray(read().slice(0, arrayCount(count, handlePath))),
    drop: (count) => materializeArray(read().slice(arrayCount(count, handlePath))),
    takeLast: (count) => {
      const value = read();
      const itemCount = arrayCount(count, handlePath);
      return materializeArray(itemCount === 0 ? [] : value.slice(-itemCount));
    },
    dropLast: (count) => {
      const value = read();
      const itemCount = arrayCount(count, handlePath);
      return materializeArray(itemCount === 0 ? value : value.slice(0, -itemCount));
    },
    length: () => read().length,
    isEmpty: () => read().length === 0,
    at: (index) => {
      const value = read();
      return materialize_projected_value(value[arrayIndex(value, handlePath, index)] as OrderedProjectedValue) as LiveMapArrayItem<TValue>;
    },
    first: () => {
      const value = read();
      return materialize_projected_value(value[arrayIndex(value, handlePath, 0)] as OrderedProjectedValue) as LiveMapArrayItem<TValue>;
    },
    last: () => {
      const value = read();
      return materialize_projected_value(value[arrayIndex(value, handlePath, -1)] as OrderedProjectedValue) as LiveMapArrayItem<TValue>;
    },
    includes: (value) => {
      const item = must_ordered_projected_value(value, handlePath);
      return read().some((arrayItem) => ordered_projected_value_equal(arrayItem, item));
    },
    indexOf: (value) => {
      const item = must_ordered_projected_value(value, handlePath);
      return read().findIndex((arrayItem) => ordered_projected_value_equal(arrayItem, item));
    },
    push: (value) => {
      const current = read();
      return splice(current.length, 0, [must_ordered_projected_value(value, [...handlePath, current.length])]);
    },
    pushMany: (values) => {
      const current = read();
      return splice(current.length, 0, mustOrderedArrayValue(values, handlePath));
    },
    unshift: (value) => {
      read();
      return splice(0, 0, [must_ordered_projected_value(value, [...handlePath, 0])]);
    },
    unshiftMany: (values) => {
      read();
      return splice(0, 0, mustOrderedArrayValue(values, handlePath));
    },
    pop: () => {
      const current = read();
      return splice(arrayIndex(current, handlePath, -1), 1);
    },
    shift: () => {
      const current = read();
      return splice(arrayIndex(current, handlePath, 0), 1);
    },
    clear: () => {
      read();
      return set([]);
    },
    reverse: () => set([...read()].reverse()),
    sortNumbers: (direction) => set(arraySortNumbers(read(), handlePath, direction)),
    sortStrings: (direction) => set(arraySortStrings(read(), handlePath, direction)),
    splice: (...args) => {
      const current = read();
      const [start, deleteCount, ...items] = args;
      const normalizedStart = normalizeHandleSpliceStart(current.length, arraySpliceStart(start, handlePath));
      const normalizedDeleteCount = deleteCount === undefined
        ? current.length - normalizedStart
        : arraySpliceDeleteCount(deleteCount, handlePath);
      return splice(normalizedStart, Math.min(normalizedDeleteCount, current.length - normalizedStart), items.map((item, index) => (
        must_ordered_projected_value(item, [...handlePath, normalizedStart + index])
      )));
    },
    insert: (index, value) => {
      const current = read();
      const resolvedIndex = arrayInsertIndex(current, handlePath, index);
      return splice(resolvedIndex, 0, [must_ordered_projected_value(value, [...handlePath, resolvedIndex])]);
    },
    remove: (index) => {
      const current = read();
      return splice(arrayIndex(current, handlePath, index), 1);
    },
    replace: (index, value) => {
      const current = read();
      const resolvedIndex = arrayIndex(current, handlePath, index);
      return splice(resolvedIndex, 1, [must_ordered_projected_value(value, [...handlePath, resolvedIndex])]);
    },
    move: (fromIndex, toIndex) => set(arrayMove(read(), handlePath, fromIndex, toIndex)),
    unique: () => set(arrayUnique(read())),
    removeValue: (value) => set(arrayRemoveValue(read(), must_ordered_projected_value(value, handlePath))),
    removeAll: (value) => set(arrayRemoveAll(read(), must_ordered_projected_value(value, handlePath))),
  };
}

function mustOrderedArrayValue(value: unknown, path: LivePath): readonly OrderedProjectedValue[] {
  const admitted = must_ordered_projected_value(value, path);
  if (!Array.isArray(admitted)) {
    throw new Error(`LiveMap array values are not an array at ${JSON.stringify(path)}`);
  }
  return admitted;
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

function arraySlice(
  value: readonly OrderedProjectedValue[],
  path: LivePath,
  start?: number,
  end?: number,
): readonly OrderedProjectedValue[] {
  return value.slice(arrayOptionalIndex(start, path, "slice start"), arrayOptionalIndex(end, path, "slice end"));
}

function arraySpliceStart(start: number, path: LivePath): number {
  if (!Number.isInteger(start)) {
    throw new Error(`LiveMap array splice start is not a valid index at ${JSON.stringify(path)}: ${String(start)}`);
  }
  return start;
}

function normalizeHandleSpliceStart(length: number, start: number): number {
  if (start < 0) return Math.max(length + start, 0);
  return Math.min(start, length);
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

function arraySortNumbers(
  value: readonly OrderedProjectedValue[],
  path: LivePath,
  direction?: "asc" | "desc",
): readonly OrderedProjectedValue[] {
  const next = [...value];
  const multiplier = arraySortDirection(direction, path);
  if (next.some((item) => typeof item !== "number")) {
    throw new Error(`LiveMap array contains a non-number item at ${JSON.stringify(path)}`);
  }
  return next.sort((left, right) => multiplier * ((left as number) - (right as number)));
}

function arraySortStrings(
  value: readonly OrderedProjectedValue[],
  path: LivePath,
  direction?: "asc" | "desc",
): readonly OrderedProjectedValue[] {
  const next = [...value];
  const multiplier = arraySortDirection(direction, path);
  if (next.some((item) => typeof item !== "string")) {
    throw new Error(`LiveMap array contains a non-string item at ${JSON.stringify(path)}`);
  }
  return next.sort((left, right) => {
    if (left === right) return 0;
    return multiplier * ((left as string) < (right as string) ? -1 : 1);
  });
}

function arrayUnique(value: readonly OrderedProjectedValue[]): readonly OrderedProjectedValue[] {
  const next: OrderedProjectedValue[] = [];
  for (const item of value) {
    if (!next.some((candidate) => ordered_projected_value_equal(candidate, item))) next.push(item);
  }
  return next;
}

function arrayRemoveValue(
  value: readonly OrderedProjectedValue[],
  item: OrderedProjectedValue,
): readonly OrderedProjectedValue[] {
  const next = [...value];
  const index = next.findIndex((candidate) => ordered_projected_value_equal(candidate, item));
  if (index !== -1) next.splice(index, 1);
  return next;
}

function arrayRemoveAll(
  value: readonly OrderedProjectedValue[],
  item: OrderedProjectedValue,
): readonly OrderedProjectedValue[] {
  return value.filter((candidate) => !ordered_projected_value_equal(candidate, item));
}

function arrayMove(
  value: readonly OrderedProjectedValue[],
  path: LivePath,
  fromIndex: number,
  toIndex: number,
): readonly OrderedProjectedValue[] {
  const next = [...value];
  const [item] = next.splice(arrayIndex(next, path, fromIndex), 1);
  next.splice(arrayInsertIndex(next, path, toIndex), 0, item as OrderedProjectedValue);
  return next;
}

function arrayIndex(value: readonly OrderedProjectedValue[], path: LivePath, index: number): number {
  if (!Number.isInteger(index)) throw array_index_error(path, index);
  const resolvedIndex = index < 0 ? value.length + index : index;
  if (resolvedIndex < 0 || resolvedIndex >= value.length) throw array_index_error(path, index);
  return resolvedIndex;
}

function arrayInsertIndex(value: readonly OrderedProjectedValue[], path: LivePath, index: number): number {
  if (!Number.isInteger(index)) throw array_index_error(path, index);
  const resolvedIndex = index < 0 ? value.length + index : index;
  if (resolvedIndex < 0 || resolvedIndex > value.length) throw array_index_error(path, index);
  return resolvedIndex;
}
