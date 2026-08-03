import {
  is_ordered_projected_object,
  ordered_projected_array,
  ordered_projected_object,
  type OrderedProjectedObject,
  type OrderedProjectedValue,
} from "./ordered-projected-value.js";

export type OrderedProjectedPath = readonly (string | number)[];

/** Read one immutable carrier value without materializing a JavaScript object view. */
export function ordered_projected_value_at(
  root: OrderedProjectedValue,
  path: OrderedProjectedPath,
): OrderedProjectedValue | undefined {
  let current: OrderedProjectedValue | undefined = root;

  for (const part of path) {
    if (typeof part === "number") {
      if (!Array.isArray(current) || !Number.isInteger(part) || part < 0) return undefined;
      current = current[part];
      continue;
    }

    if (!is_ordered_projected_object(current)) return undefined;
    current = object_entry_value(current, part);
  }

  return current;
}

/** Set one resolved endpoint, retaining object position or appending a new key. */
export function ordered_projected_value_set(
  root: OrderedProjectedValue,
  path: OrderedProjectedPath,
  value: OrderedProjectedValue,
): OrderedProjectedValue {
  if (path.length === 0) {
    throw new Error("Ordered projected set cannot replace the root.");
  }
  return write_at(root, path, 0, value, true);
}

/** Replace one existing endpoint exactly, including the root. */
export function ordered_projected_value_replace(
  root: OrderedProjectedValue,
  path: OrderedProjectedPath,
  value: OrderedProjectedValue,
): OrderedProjectedValue {
  if (path.length === 0) return value;
  return write_at(root, path, 0, value, false);
}

/** Delete one resolved object property while preserving all remaining positions. */
export function ordered_projected_value_delete(
  root: OrderedProjectedValue,
  path: OrderedProjectedPath,
): OrderedProjectedValue {
  if (path.length === 0) {
    throw new Error("Ordered projected delete cannot remove the root.");
  }
  return delete_at(root, path, 0);
}

/** Merge ordered entries into an existing object, retaining and appending positions. */
export function ordered_projected_object_merge(
  root: OrderedProjectedValue,
  path: OrderedProjectedPath,
  patch: OrderedProjectedObject,
): OrderedProjectedValue {
  const current = ordered_projected_value_at(root, path);
  if (!is_ordered_projected_object(current)) {
    throw new Error("Ordered projected merge endpoint is not an object.");
  }

  let candidate = root;
  for (const [key, value] of patch.entries) {
    candidate = ordered_projected_value_set(candidate, [...path, key], value);
  }
  return candidate;
}

/** Rename one own object entry in place and retire any existing destination entry. */
export function ordered_projected_object_rename(
  root: OrderedProjectedValue,
  path: OrderedProjectedPath,
  from: string,
  to: string,
): OrderedProjectedValue {
  const current = ordered_projected_value_at(root, path);
  if (!is_ordered_projected_object(current)) {
    throw new Error("Ordered projected rename endpoint is not an object.");
  }
  const sourceIndex = object_entry_index(current, from);
  if (sourceIndex === -1) {
    throw new Error("Ordered projected rename source does not exist.");
  }
  if (from === to) return root;

  const next = ordered_projected_object(current.entries.flatMap(([key, value]) => {
    if (key === from) return [[to, value] as const];
    if (key === to) return [];
    return [[key, value] as const];
  }));
  return ordered_projected_value_replace(root, path, next);
}

/** Move one existing array item to its final post-removal index. */
export function ordered_projected_array_move(
  root: OrderedProjectedValue,
  path: OrderedProjectedPath,
  from: number,
  to: number,
): OrderedProjectedValue {
  const current = ordered_projected_value_at(root, path);
  if (!Array.isArray(current)) {
    throw new Error("Ordered projected move endpoint is not an array.");
  }
  if (!Number.isSafeInteger(from) || from < 0 || from >= current.length) {
    throw new Error("Ordered projected move source is invalid.");
  }
  if (!Number.isSafeInteger(to) || to < 0 || to >= current.length) {
    throw new Error("Ordered projected move destination is invalid.");
  }
  if (from === to) return root;

  const items = [...current];
  const [moved] = items.splice(from, 1);
  if (moved === undefined) throw new Error("Ordered projected move source does not exist.");
  items.splice(to, 0, moved);
  return ordered_projected_value_replace(root, path, ordered_projected_array(items));
}

/** Apply one dense array splice and return the immutable candidate and removals. */
export function ordered_projected_array_splice(
  root: OrderedProjectedValue,
  path: OrderedProjectedPath,
  start: number,
  deleteCount: number,
  items: readonly OrderedProjectedValue[],
): Readonly<{
  value: OrderedProjectedValue;
  removed: readonly OrderedProjectedValue[];
}> {
  const current = ordered_projected_value_at(root, path);
  if (!Array.isArray(current)) {
    throw new Error("Ordered projected splice endpoint is not an array.");
  }
  if (!Number.isInteger(start) || start < 0 || start > current.length) {
    throw new Error("Ordered projected splice start is invalid.");
  }
  if (!Number.isInteger(deleteCount) || deleteCount < 0 || start + deleteCount > current.length) {
    throw new Error("Ordered projected splice delete count is invalid.");
  }

  const removed = ordered_projected_array(current.slice(start, start + deleteCount));
  const next = ordered_projected_array([
    ...current.slice(0, start),
    ...items,
    ...current.slice(start + deleteCount),
  ]);
  return Object.freeze({
    value: ordered_projected_value_replace(root, path, next),
    removed,
  });
}

function write_at(
  current: OrderedProjectedValue,
  path: OrderedProjectedPath,
  offset: number,
  value: OrderedProjectedValue,
  allowMissingLeaf: boolean,
): OrderedProjectedValue {
  const part = path[offset];
  if (part === undefined) return value;
  const atLeaf = offset === path.length - 1;

  if (typeof part === "number") {
    if (!Array.isArray(current) || !Number.isInteger(part) || part < 0 || part >= current.length) {
      throw new Error("Ordered projected array path does not resolve.");
    }
    const child = current[part];
    if (child === undefined) throw new Error("Ordered projected array path does not resolve.");
    const nextChild = atLeaf ? value : write_at(child, path, offset + 1, value, allowMissingLeaf);
    const items = [...current];
    items[part] = nextChild;
    return ordered_projected_array(items);
  }

  if (!is_ordered_projected_object(current)) {
    throw new Error("Ordered projected object path does not resolve.");
  }
  const index = object_entry_index(current, part);
  if (index === -1) {
    if (!atLeaf || !allowMissingLeaf) {
      throw new Error("Ordered projected object path does not resolve.");
    }
    return ordered_projected_object([...current.entries, [part, value]]);
  }

  const entry = current.entries[index];
  if (entry === undefined) throw new Error("Ordered projected object path does not resolve.");
  const nextChild = atLeaf ? value : write_at(entry[1], path, offset + 1, value, allowMissingLeaf);
  const entries = [...current.entries];
  entries[index] = [part, nextChild];
  return ordered_projected_object(entries);
}

function delete_at(
  current: OrderedProjectedValue,
  path: OrderedProjectedPath,
  offset: number,
): OrderedProjectedValue {
  const part = path[offset];
  if (part === undefined) throw new Error("Ordered projected delete path does not resolve.");
  const atLeaf = offset === path.length - 1;

  if (typeof part === "number") {
    if (!Array.isArray(current) || !Number.isInteger(part) || part < 0 || part >= current.length) {
      throw new Error("Ordered projected array path does not resolve.");
    }
    if (atLeaf) throw new Error("Ordered projected delete does not remove array indexes.");
    const child = current[part];
    if (child === undefined) throw new Error("Ordered projected array path does not resolve.");
    const items = [...current];
    items[part] = delete_at(child, path, offset + 1);
    return ordered_projected_array(items);
  }

  if (!is_ordered_projected_object(current)) {
    throw new Error("Ordered projected object path does not resolve.");
  }
  const index = object_entry_index(current, part);
  if (index === -1) throw new Error("Ordered projected object path does not resolve.");
  if (atLeaf) {
    return ordered_projected_object(current.entries.filter((_entry, entryIndex) => entryIndex !== index));
  }

  const entry = current.entries[index];
  if (entry === undefined) throw new Error("Ordered projected object path does not resolve.");
  const entries = [...current.entries];
  entries[index] = [part, delete_at(entry[1], path, offset + 1)];
  return ordered_projected_object(entries);
}

function object_entry_index(value: OrderedProjectedObject, key: string): number {
  return value.entries.findIndex(([entryKey]) => entryKey === key);
}

function object_entry_value(
  value: OrderedProjectedObject,
  key: string,
): OrderedProjectedValue | undefined {
  const index = object_entry_index(value, key);
  return index === -1 ? undefined : value.entries[index]?.[1];
}
