import type { HsonNode } from "./types.js";
import { normalize_hson_graph } from "./normalize-hson-graph.js";

/**
 * Compare HSON graphs after applying the canonical permissive-ingress
 * normalization.
 * Arrays and content remain ordered; record key order is irrelevant; absent
 * optional records equal permissive empty spellings; all populated metadata,
 * including persisted QUIDs, participates. This helper does not mutate its
 * inputs and is not an authoritative graph-admission boundary.
 */
export function canonical_hson_graph_equal(left: HsonNode, right: HsonNode): boolean {
  const normalizedLeft = normalize_hson_graph(left, "canonical_hson_graph_equal.left");
  const normalizedRight = normalize_hson_graph(right, "canonical_hson_graph_equal.right");
  return canonical_value_equal(
    normalizedLeft,
    normalizedRight,
  );
}

function canonical_value_equal(left: unknown, right: unknown): boolean {
  if (typeof left === "number" || typeof right === "number") {
    if ((typeof left === "number" && !Number.isFinite(left))
      || (typeof right === "number" && !Number.isFinite(right))) {
      const invalid = typeof left === "number" && !Number.isFinite(left) ? left : right;
      throw new Error(`[HSON equality] invalid HSON number ${String(invalid)}; numbers must be finite`);
    }
    if (typeof left === "number" && typeof right === "number") return Object.is(left, right);
  }
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
