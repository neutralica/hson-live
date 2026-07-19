// node-guards.ts

import { HSON_SYS_PREFIX, II_TAG, STR_TAG, VAL_TAG, _DATA_INDEX } from "./constants.js";
import type { HsonNode } from "./types.js";
import { is_Primitive } from "./value-guards.js";

export function is_Node(bit: unknown): bit is HsonNode {
  if (!bit || typeof bit !== "object") return false;

  const b = bit as { $_tag?: unknown; $_meta?: unknown };
  if (typeof b.$_tag !== "string") return false;

  const meta = b.$_meta;
  if (meta && typeof meta === "object") {
    if ("attrs" in (meta as Record<string, unknown>)) return false;
    if ("flags" in (meta as Record<string, unknown>)) return false;
  }

  return true;
}

/** True for a user/document element rather than a structural HSON VSN node. */
export function is_ordinary_element_node(bit: unknown): bit is HsonNode {
  return is_Node(bit) && !bit.$_tag.startsWith(HSON_SYS_PREFIX);
}

export function is_Primitive_node(node: HsonNode): boolean {
  return (
    node.$_content.length === 1 &&
    is_Primitive(node.$_content[0]) &&
    (node.$_tag === STR_TAG ||
      node.$_tag === VAL_TAG)
  );
}

export function is_indexed(node: HsonNode): boolean {
  return (
    node.$_tag === II_TAG &&
    Array.isArray(node.$_content) &&
    node.$_content.length === 1 &&
    typeof node.$_meta?.[_DATA_INDEX] === "string"
  );
}
