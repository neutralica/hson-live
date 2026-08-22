import type { HsonAttrs, HsonMeta, HsonNode } from "./types.js";

export type OwnEnumerableDataProperty = Readonly<{ present: false }>
  | Readonly<{ present: true; value: unknown }>;

/** Inspect one semantic field without invoking an accessor. */
export function own_enumerable_data_property(
  record: Readonly<Record<string, unknown>>,
  key: string,
): OwnEnumerableDataProperty | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined) return { present: false };
  if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) return undefined;
  return { present: true, value: descriptor.value };
}

/** Read the complete canonical string-keyed entry set without invoking accessors. */
export function enumerable_own_data_entries(
  record: Readonly<Record<string, unknown>>,
): readonly (readonly [string, unknown])[] | undefined {
  const entries: Array<readonly [string, unknown]> = [];
  for (const key of Object.getOwnPropertyNames(record)) {
    const inspected = own_enumerable_data_property(record, key);
    if (inspected === undefined || !inspected.present) return undefined;
    entries.push([key, inspected.value]);
  }
  return entries;
}

/** Read a dense canonical content array without invoking indexed accessors. */
export function enumerable_own_data_array_items(
  values: readonly unknown[],
): readonly unknown[] | undefined {
  const items: unknown[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(values, String(index));
    if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
      return undefined;
    }
    items.push(descriptor.value);
  }
  return items;
}

/** Detect one prototype-supplied field without reading its value. */
export function has_inherited_property(
  record: Readonly<Record<string, unknown>>,
  key: string,
): boolean {
  const prototype = Object.getPrototypeOf(record);
  return prototype !== null && Object.getOwnPropertyDescriptor(prototype, key) !== undefined;
}

/** True when an optional node container has at least one own enumerable entry. */
export function has_own_entries<TValue extends object>(value: TValue | undefined): value is TValue {
  return value !== undefined && Object.keys(value).length > 0;
}

/** Materialize the attribute container for a write. Reads must not call this. */
export function ensure_node_attrs(node: HsonNode): HsonAttrs {
  return node.$_attrs ??= {};
}

/** Materialize the metadata container for a write. Reads must not call this. */
export function ensure_node_meta(node: HsonNode): HsonMeta {
  return node.$_meta ??= {};
}

/** Restore canonical compact storage after an attribute deletion. */
export function prune_empty_node_attrs(node: HsonNode): void {
  if (!has_own_entries(node.$_attrs)) delete node.$_attrs;
}

/** Restore canonical compact storage after a metadata deletion. */
export function prune_empty_node_meta(node: HsonNode): void {
  if (!has_own_entries(node.$_meta)) delete node.$_meta;
}
