import type { HsonAttrs, HsonMeta, HsonNode } from "./types.js";

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
