// handle-object.ts


import type { JsonValue } from "../../core/types.js";
import type { LiveMapCore, LiveMapObjectEntry, LiveMapObjectKey, LiveMapObjectSetManyValues, LiveMapObjectSetValue, LiveMapObjectShape, LiveMapObjectValue, LiveMapPathObjectApi, LivePath } from "./livemap.types.js";
import { format_live_path, must_json_value, must_object_key, must_set_many_values, path_kind_error } from "./guard.js";

type LiveMapObjectHandleCore = Pick<LiveMapCore<JsonValue | undefined>, "snap" | "set" | "replace" | "setMany" | "delete" | "batch">;

/**
 * Object-scoped helpers for a projected LiveMap path.
 *
 * `setKey` uses normal set semantics for one child key. `setMany` performs a
 * shallow sibling-preserving set by changing only the provided child keys.
 */
export function make_livemap_object_api<TValue = JsonValue | undefined>(core: LiveMapObjectHandleCore, handlePath: LivePath): LiveMapPathObjectApi<TValue> {
  return {
    is: () => isObjectValue(core.snap(handlePath)),
    toObject: () => ({ ...mustObjectValue(core.snap(handlePath), handlePath) }) as LiveMapObjectShape<TValue>,
    pick: (keys) => objectPick(core.snap(handlePath), handlePath, mustObjectKeyList(keys, handlePath)) as ReturnType<LiveMapPathObjectApi<TValue>["pick"]>,
    omit: (keys) => objectOmit(core.snap(handlePath), handlePath, mustObjectKeyList(keys, handlePath)) as ReturnType<LiveMapPathObjectApi<TValue>["omit"]>,
    hasKey: (key: unknown) => {
      const objectKey = must_object_key(key, handlePath);
      return objectKey in mustObjectValue(core.snap(handlePath), handlePath);
    },
    getKey: <const TKey extends string>(key: TKey): LiveMapObjectValue<TValue, TKey> => {
      const objectKey = must_object_key(key, handlePath);
      return mustObjectValue(core.snap(handlePath), handlePath)[objectKey] as unknown as LiveMapObjectValue<TValue, TKey>;
    },
    keys: () => Object.keys(mustObjectValue(core.snap(handlePath), handlePath)) as unknown as readonly LiveMapObjectKey<TValue>[],
    isEmpty: () => Object.keys(mustObjectValue(core.snap(handlePath), handlePath)).length === 0,
    size: () => Object.keys(mustObjectValue(core.snap(handlePath), handlePath)).length,
    values: () => Object.values(mustObjectValue(core.snap(handlePath), handlePath)) as unknown as readonly LiveMapObjectShape<TValue>[LiveMapObjectKey<TValue>][],
    entries: () => Object.entries(mustObjectValue(core.snap(handlePath), handlePath)) as unknown as readonly LiveMapObjectEntry<TValue>[],
    setKey: <const TKey extends LiveMapObjectKey<TValue>>(key: TKey, value: LiveMapObjectSetValue<TValue, TKey>) => {
      const objectKey = must_object_key(key, handlePath);
      mustObjectValue(core.snap(handlePath), handlePath);
      return core.setMany(handlePath, { [objectKey]: must_json_value(value, [...handlePath, objectKey]) });
    },
    setMany: (values: LiveMapObjectSetManyValues<TValue>) => {
      mustObjectValue(core.snap(handlePath), handlePath);
      return core.setMany(handlePath, must_set_many_values(values, handlePath));
    },
    clear: () => {
      mustObjectValue(core.snap(handlePath), handlePath);
      return core.replace(handlePath, {});
    },
    deleteKey: (key: unknown) => {
      const objectKey = must_object_key(key, handlePath);
      const objectValue = mustObjectValue(core.snap(handlePath), handlePath);
      if (!(objectKey in objectValue)) return emptyCommit();
      return core.delete([...handlePath, objectKey]);
    },
    deleteMany: (keys: unknown) => {
      const objectKeys = mustObjectKeyList(keys, handlePath);
      const objectValue = mustObjectValue(core.snap(handlePath), handlePath);
      return core.batch((tx) => {
        for (const key of new Set(objectKeys)) {
          if (key in objectValue) tx.delete([...handlePath, key]);
        }
      });
    },
    renameKey: (fromKey: unknown, toKey: unknown) => {
      const fromObjectKey = must_object_key(fromKey, handlePath);
      const toObjectKey = must_object_key(toKey, handlePath);
      const objectValue = mustObjectValue(core.snap(handlePath), handlePath);
      if (!(fromObjectKey in objectValue)) return emptyCommit();
      if (fromObjectKey === toObjectKey) return emptyCommit();
      return core.replace(handlePath, objectRenameKey(objectValue, handlePath, fromObjectKey, toObjectKey));
    },
  };
}

function emptyCommit() {
  return Object.freeze({
    changed: false,
    ops: [],
  });
}

function isObjectValue(value: JsonValue | undefined): value is Readonly<Record<string, JsonValue>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mustObjectValue(value: JsonValue | undefined, path: LivePath): Readonly<Record<string, JsonValue>> {
  if (!isObjectValue(value)) {
    throw path_kind_error(path, "object");
  }

  return value;
}

function mustObjectKeyList(value: unknown, path: LivePath): readonly string[] {
  if (!Array.isArray(value)) {
    throw new Error(`LiveMap object keys are not an array at ${JSON.stringify(path)}`);
  }

  return value.map((key) => must_object_key(key, path));
}

function objectPick(value: JsonValue | undefined, path: LivePath, keys: readonly string[]): Readonly<Record<string, JsonValue>> {
  const objectValue = mustObjectValue(value, path);
  const next: Record<string, JsonValue> = {};

  for (const key of keys) {
    if (key in objectValue) next[key] = objectValue[key] as JsonValue;
  }

  return next;
}

function objectOmit(value: JsonValue | undefined, path: LivePath, keys: readonly string[]): Readonly<Record<string, JsonValue>> {
  const objectValue = mustObjectValue(value, path);
  const omitKeys = new Set(keys);
  const next: Record<string, JsonValue> = {};

  for (const [key, item] of Object.entries(objectValue)) {
    if (!omitKeys.has(key)) next[key] = item;
  }

  return next;
}

function objectRenameKey(value: JsonValue | undefined, path: LivePath, fromKey: string, toKey: string): JsonValue {
  const objectValue = mustObjectValue(value, path);
  if (!(fromKey in objectValue)) {
    throw new Error(`LiveMap rename path does not resolve: ${format_live_path([...path, fromKey])}`);
  }

  if (fromKey === toKey) return { ...objectValue };

  const next: Record<string, JsonValue> = {};

  for (const [key, item] of Object.entries(objectValue)) {
    if (key === fromKey) {
      next[toKey] = item;
      continue;
    }

    if (key !== toKey) next[key] = item;
  }

  return next;
}
