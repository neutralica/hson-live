import type { HsonNode } from "./types.js";

/**
 * Compare already-valid, acyclic canonical HSON graphs without normalization.
 * Arrays and content remain ordered; record key order is irrelevant; absent
 * fields differ from present empty records; all metadata, including persisted
 * QUIDs, participates. This helper neither validates nor mutates its inputs.
 */
export function canonical_hson_graph_equal(left: HsonNode, right: HsonNode): boolean {
  return canonical_value_equal(left, right);
}

function canonical_value_equal(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== typeof right) return false;
  if (typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left)) {
    return Array.isArray(right)
      && left.length === right.length
      && left.every((item, index) => canonical_value_equal(item, right[index]));
  }
  if (Array.isArray(right)) return false;
  if (!is_record_value(left) || !is_record_value(right)) return false;

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key)
      && canonical_value_equal(left[key], right[key]));
}

function is_record_value(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
