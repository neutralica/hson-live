// handle-object.ts

import type { JsonValue } from "../../core/types.js";
import { is_ordered_projected_object, ordered_projected_object, type OrderedProjectedObject } from "../../core/ordered-projected-value.js";
import { materialize_projected_value } from "../../core/projected-value-materialization.js";
import type {
  LiveMapCore,
  LiveMapCoreCommit,
  LiveMapObjectEntry,
  LiveMapObjectKey,
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
import { livemap_projected_propagation, type LiveMapProjectedPropagation } from "./livemap.projected-propagation.js";
import { LiveMapProjectedMutationError } from "./livemap.error.js";

type LiveMapObjectHandleCore = Pick<LiveMapCore<JsonValue | undefined>, "snap" | "set" | "replace" | "setMany" | "delete">;

/** Object-scoped helpers backed by the selected Data read capability. */
export function make_livemap_object_api<
  TValue = JsonValue | undefined,
  TCommit = LiveMapCoreCommit,
>(
  core: LiveMapObjectHandleCore,
  handlePath: LivePath,
  authority?: LiveMapProjectedPropagation<TCommit>,
): LiveMapPathObjectApi<TValue, TCommit> {
  const projected = authority ?? livemap_projected_propagation(core) as LiveMapProjectedPropagation<TCommit> | undefined;
  if (projected === undefined) throw new Error("LiveMap object helper has no projected propagation capability.");

  // Full-container operations may use a temporary selected projection to retain order.
  const read = (): OrderedProjectedObject => {
    const value = projected.read(handlePath);
    if (!is_ordered_projected_object(value)) throw path_kind_error(handlePath, "object");
    return value;
  };
  const keys = (): readonly string[] => {
    const value = projected.keys(handlePath);
    if (value === undefined) throw path_kind_error(handlePath, "object");
    return value;
  };
  const assertObject = (): void => {
    if (projected.kind(handlePath) !== "object") throw path_kind_error(handlePath, "object");
  };
  const noChange = () => projected.commit([]);

  return {
    is: () => projected.kind(handlePath) === "object",
    toObject: () => { assertObject(); return projected.snap(handlePath) as LiveMapObjectShape<TValue>; },
    pick: (selected) => {
      // Capture the selected container before caller-controlled key-list access.
      const value = read(), wanted = new Set(mustObjectKeyList(selected, handlePath));
      return materialize_projected_value(ordered_projected_object(value.entries.filter(([key]) => wanted.has(key)))) as ReturnType<LiveMapPathObjectApi<TValue, TCommit>["pick"]>;
    },
    omit: (omitted) => {
      const value = read(), unwanted = new Set(mustObjectKeyList(omitted, handlePath));
      return materialize_projected_value(ordered_projected_object(value.entries.filter(([key]) => !unwanted.has(key)))) as ReturnType<LiveMapPathObjectApi<TValue, TCommit>["omit"]>;
    },
    hasKey: (key: unknown) => { assertObject(); return projected.kind([...handlePath, must_object_key(key, handlePath)]) !== "missing"; },
    getKey: <const TKey extends string>(key: TKey): LiveMapObjectValue<TValue, TKey> => {
      assertObject();
      return projected.snap([...handlePath, must_object_key(key, handlePath)]) as LiveMapObjectValue<TValue, TKey>;
    },
    keys: () => keys() as readonly LiveMapObjectKey<TValue>[],
    isEmpty: () => keys().length === 0,
    size: () => keys().length,
    values: () => read().entries.map(([, value]) => materialize_projected_value(value)) as unknown as readonly LiveMapObjectShape<TValue>[LiveMapObjectKey<TValue>][],
    entries: () => read().entries.map(([key, value]) => [key, materialize_projected_value(value)]) as unknown as readonly LiveMapObjectEntry<TValue>[],
    setKey: <const TKey extends LiveMapObjectKey<TValue>>(key: TKey, value: unknown) => {
      const objectKey = must_object_key(key, handlePath);
      assertObject();
      return projected.commit([{
        kind: "set-key",
        path: handlePath,
        key: objectKey,
        value: must_ordered_projected_value(value, [...handlePath, objectKey]),
      }]);
    },
    setMany: (values: unknown) => {
      assertObject();
      const admitted = must_ordered_projected_object(values, handlePath);
      return projected.commit(admitted.entries.map(([key, value]) => ({
        kind: "set-key" as const,
        path: handlePath,
        key,
        value,
      })));
    },
    clear: () => {
      assertObject();
      return projected.commit([{ kind: "replace", path: handlePath, value: ordered_projected_object([]) }]);
    },
    deleteKey: (key: unknown) => {
      const objectKey = must_object_key(key, handlePath);
      if (!keys().includes(objectKey)) return noChange();
      return projected.commit([{ kind: "delete", path: [...handlePath, objectKey] }]);
    },
    deleteMany: (selectedKeys: unknown) => {
      const objectKeys = new Set(mustObjectKeyList(selectedKeys, handlePath));
      const names = keys();
      return projected.commit(names
        .filter(key => objectKeys.has(key))
        .map(key => ({ kind: "delete" as const, path: [...handlePath, key] })));
    },
    renameKey: (fromKey: unknown, toKey: unknown) => {
      const fromObjectKey = must_rename_key(fromKey, "source", handlePath);
      const toObjectKey = must_rename_key(toKey, "destination", handlePath);
      if (!keys().includes(fromObjectKey)) {
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

function must_rename_key(value: unknown, role: "source" | "destination", path: LivePath): string {
  if (typeof value === "string") return value;
  throw new LiveMapProjectedMutationError(
    role === "source" ? "INVALID_OBJECT_RENAME_SOURCE" : "INVALID_OBJECT_RENAME_DESTINATION",
    "rename",
    path,
    `${role} key is not a string`,
  );
}
