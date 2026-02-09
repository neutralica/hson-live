// node-guards.ts

import { II_TAG, STR_TAG, VAL_TAG } from "../../consts/constants";
import { BasicValue } from "../../types/core.types";
import { is_Primitive } from "../core-utils/guards.core"
import { _DATA_INDEX } from "../../consts/constants";
import { HsonNode } from "../../types/node.types";
import { JsonValue } from "../../types/core.types";

/**
 * Type guard for the current (new-structure) `HsonNode`.
 *
 * What it checks:
 * - `bit` is a non-null object.
 * - Has a string `_tag` (the minimal structural discriminator used everywhere else).
 *
 * What it *also* does (compat rejection):
 * - If `_meta` is an object, rejects legacy nodes that used `_meta.attrs` or `_meta.flags`.
 *   This avoids silently accepting old shapes during the migration.
 *
 * What it intentionally does *not* check:
 * - Does not validate `_content` or `_attrs` shape, since many callers use this as a lightweight
 *   narrowing guard before doing deeper checks.
 *
 * @param bit - Unknown value to test.
 * @returns `true` iff the value looks like a new-structure `HsonNode`.
 */
export function is_Node(bit: unknown): bit is HsonNode {
  if (!bit || typeof bit !== "object") return false;

  // minimal structural check first (enables narrowing)
  const b = bit as { _tag?: unknown; _meta?: unknown };
  if (typeof b._tag !== "string") return false;

  // legacy rejection: only if _meta is an object; otherwise it's fine
  const meta = (b as any)._meta as unknown;
  if (meta && typeof meta === "object") {
    // IMPORTANT: don't assume shape; just probe keys safely
    if ("attrs" in (meta as Record<string, unknown>)) return false;
    if ("flags" in (meta as Record<string, unknown>)) return false;
  }

  return true;
}


/**
 * Check whether a node is a scalar “primitive leaf” node.
 *
 * A primitive node is defined here as:
 * - `_content` contains exactly one item,
 * - that item is a `Primitive`,
 * - and the node’s tag is either `_str` or `_val`.
 *
 * This is used to distinguish structural nodes (`_obj`, `_arr`, `_elem`, `_ii`, etc.)
 * from leaf value carriers in the HSON tree.
 *
 * @param node - Node to inspect.
 * @returns `true` iff the node is a `_str`/`_val` leaf containing a single `Primitive`.
 */
export function is_Primitive_node(node: HsonNode): boolean {
  return (
    node._content.length === 1 &&
    is_Primitive(node._content[0]) &&
    (node._tag === STR_TAG ||
      node._tag === VAL_TAG)
  )
}

/**
 * Check whether a node is an indexed array-item wrapper (`<_ii>`).
 *
 * An indexed item is defined as:
 * - tag is `_ii`,
 * - `_content` is an array with exactly one entry (the wrapped item),
 * - and `_meta[data-_index]` is present as a string.
 *
 * This supports array representations where items may carry explicit stable indices
 * (e.g. for round-tripping order or matching back to source positions).
 *
 * @param node - Node to inspect.
 * @returns `true` iff the node is an `_ii` wrapper with a string `data-_index` meta key.
 */
export function is_indexed(node: HsonNode): boolean {
  return (
    node._tag === II_TAG &&
    Array.isArray(node._content) &&
    node._content.length === 1 &&
    typeof node._meta?.[_DATA_INDEX] === "string"
  );
}
