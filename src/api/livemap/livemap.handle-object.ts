// handle-object.ts

import type { JsonValue } from "../../core/types.js";
import {
  is_ordered_projected_object,
  ordered_projected_object,
  type OrderedProjectedObject,
  type OrderedProjectedValue,
} from "../../core/ordered-projected-value.js";
import { materialize_projected_value } from "../../core/projected-value-materialization.js";
import type {
  LiveMapCore,
  LiveMapObjectEntry,
  LiveMapObjectKey,
  LiveMapObjectSetManyValues,
  LiveMapObjectSetValue,
  LiveMapObjectShape,
  LiveMapObjectValue,
  LiveMapPathObjectApi,
  LivePath,
} from "../../types/livemap.types.js";
import {
  must_object_key,
  must_ordered_projected_object,
  must_ordered_projected_value,
  path_kind_error,
} from "./livemap.guard.js";
import { livemap_projected_propagation } from "./livemap.projected-propagation.js";
import { LiveMapProjectedMutationError } from "./livemap.error.js";

type LiveMapObjectHandleCore = Pick<LiveMapCore<JsonValue | undefined>, "snap" | "set" | "replace" | "setMany" | "delete" | "batch">;

/** Object-scoped helpers backed by the canonical ordered carrier. */
export function make_livemap_object_api<TValue = JsonValue | undefined>(
  core: LiveMapObjectHandleCore,
  handlePath: LivePath,
): LiveMapPathObjectApi<TValue> {
  const projected = livemap_projected_propagation(core);
  if (projected === undefined) throw new Error("LiveMap object helper has no projected propagation capability.");

  const read = (): OrderedProjectedObject => {
    const value = projected.read(handlePath);
    if (!is_ordered_projected_object(value)) throw path_kind_error(handlePath, "object");
    return value;
  };
  const noChange = () => projected.commit([]);

  return {
    is: () => is_ordered_projected_object(projected.read(handlePath)),
    toObject: () => materialize_projected_value(read()) as LiveMapObjectShape<TValue>,
    pick: (keys) => materialize_projected_value(
      object_pick(read(), mustObjectKeyList(keys, handlePath)),
    ) as ReturnType<LiveMapPathObjectApi<TValue>["pick"]>,
    omit: (keys) => materialize_projected_value(
      object_omit(read(), mustObjectKeyList(keys, handlePath)),
    ) as ReturnType<LiveMapPathObjectApi<TValue>["omit"]>,
    hasKey: (key: unknown) => object_entry_index(read(), must_object_key(key, handlePath)) !== -1,
    getKey: <const TKey extends string>(key: TKey): LiveMapObjectValue<TValue, TKey> => {
      const entry = object_entry(read(), must_object_key(key, handlePath));
      return (entry === undefined ? undefined : materialize_projected_value(entry[1])) as LiveMapObjectValue<TValue, TKey>;
    },
    keys: () => read().entries.map(([key]) => key) as unknown as readonly LiveMapObjectKey<TValue>[],
    isEmpty: () => read().entries.length === 0,
    size: () => read().entries.length,
    values: () => read().entries.map(([, value]) => materialize_projected_value(value)) as unknown as readonly LiveMapObjectShape<TValue>[LiveMapObjectKey<TValue>][],
    entries: () => read().entries.map(([key, value]) => [key, materialize_projected_value(value)]) as unknown as readonly LiveMapObjectEntry<TValue>[],
    setKey: <const TKey extends LiveMapObjectKey<TValue>>(key: TKey, value: LiveMapObjectSetValue<TValue, TKey>) => {
      const objectKey = must_object_key(key, handlePath);
      read();
      return projected.commit([{
        kind: "set",
        path: [...handlePath, objectKey],
        value: must_ordered_projected_value(value, [...handlePath, objectKey]),
      }]);
    },
    setMany: (values: LiveMapObjectSetManyValues<TValue>) => {
      read();
      const admitted = must_ordered_projected_object(values, handlePath);
      return projected.commit(admitted.entries.map(([key, value]) => ({
        kind: "set" as const,
        path: [...handlePath, key],
        value,
      })));
    },
    clear: () => {
      read();
      return projected.commit([{ kind: "replace", path: handlePath, value: ordered_projected_object([]) }]);
    },
    deleteKey: (key: unknown) => {
      const objectKey = must_object_key(key, handlePath);
      if (object_entry_index(read(), objectKey) === -1) return noChange();
      return projected.commit([{ kind: "delete", path: [...handlePath, objectKey] }]);
    },
    deleteMany: (keys: unknown) => {
      const objectKeys = new Set(mustObjectKeyList(keys, handlePath));
      const value = read();
      return projected.commit(value.entries
        .filter(([key]) => objectKeys.has(key))
        .map(([key]) => ({ kind: "delete" as const, path: [...handlePath, key] })));
    },
    renameKey: (fromKey: unknown, toKey: unknown) => {
      const fromObjectKey = must_rename_key(fromKey, "source", handlePath);
      const toObjectKey = must_rename_key(toKey, "destination", handlePath);
      const value = read();
      if (object_entry_index(value, fromObjectKey) === -1) {
        throw new LiveMapProjectedMutationError(
          "OBJECT_RENAME_SOURCE_NOT_FOUND",
          "rename",
          handlePath,
          `source key ${JSON.stringify(fromObjectKey)} is not an own entry`,
        );
      }
      if (fromObjectKey === toObjectKey) return noChange();
      return projected.commit([{
        kind: "rename",
        path: handlePath,
        from: fromObjectKey,
        to: toObjectKey,
      }]);
    },
  };
}

/** Normalize and validate user-supplied object key lists. */
function mustObjectKeyList(value: unknown, path: LivePath): readonly string[] {
  if (!Array.isArray(value)) {
    throw new Error(`LiveMap object keys are not an array at ${JSON.stringify(path)}`);
  }
  return value.map((key) => must_object_key(key, path));
}

function object_entry_index(value: OrderedProjectedObject, key: string): number {
  return value.entries.findIndex(([entryKey]) => entryKey === key);
}

function object_entry(
  value: OrderedProjectedObject,
  key: string,
): readonly [string, OrderedProjectedValue] | undefined {
  const index = object_entry_index(value, key);
  return index === -1 ? undefined : value.entries[index];
}

function object_pick(value: OrderedProjectedObject, keys: readonly string[]): OrderedProjectedObject {
  const selected = new Set(keys);
  return ordered_projected_object(value.entries.filter(([key]) => selected.has(key)));
}

function object_omit(value: OrderedProjectedObject, keys: readonly string[]): OrderedProjectedObject {
  const omitted = new Set(keys);
  return ordered_projected_object(value.entries.filter(([key]) => !omitted.has(key)));
}

function must_rename_key(value: unknown, role: "source" | "destination", path: LivePath): string {
  if (typeof value === "string") return value;
  throw new LiveMapProjectedMutationError(
    role === "source" ? "INVALID_OBJECT_RENAME_SOURCE" : "INVALID_OBJECT_RENAME_DESTINATION",
    "rename",
    path,
    `${role} key is not a string`,
  );
}
