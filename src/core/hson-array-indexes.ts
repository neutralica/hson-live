import { ARR_TAG, HSON_META_INDEX, II_TAG } from "./constants.js";
import { is_Node } from "./node-guards.js";
import type { HsonNode, Primitive } from "./types.js";

export type HsonArrayIndexAnalysis =
  | Readonly<{
      valid: true;
      canonical: readonly HsonNode[];
      reordered: boolean;
    }>
  | Readonly<{
      valid: false;
      reason: string;
    }>;

/**
 * Validate one explicit `_hson_arr` wrapper sequence and derive its canonical
 * physical order.
 *
 * Index strings are matched only against the exact expected spellings for the
 * sibling count. This deliberately avoids numeric coercion while rejecting
 * gaps, duplicates, non-canonical spellings, and out-of-range values.
 */
export function analyze_hson_array_indexes(
  content: readonly (HsonNode | Primitive)[],
): HsonArrayIndexAnalysis {
  const expected = new Map<string, number>();
  const canonical: Array<HsonNode | undefined> = Array.from({
    length: content.length,
  });

  for (let position = 0; position < content.length; position += 1) {
    expected.set(String(position), position);
  }

  for (let physicalPosition = 0; physicalPosition < content.length; physicalPosition += 1) {
    const child = content[physicalPosition];
    if (!is_Node(child) || child.$_tag !== II_TAG) {
      return {
        valid: false,
        reason: `only ${II_TAG} nodes may appear directly under _hson_arr`,
      };
    }

    const rawIndex = child.$_meta?.[HSON_META_INDEX];
    if (typeof rawIndex !== "string") {
      return {
        valid: false,
        reason: `${II_TAG} at physical position ${physicalPosition} must carry "${HSON_META_INDEX}" as a string in $_meta`,
      };
    }

    const canonicalPosition = expected.get(rawIndex);
    if (canonicalPosition === undefined) {
      return {
        valid: false,
        reason: `${II_TAG} index ${JSON.stringify(rawIndex)} is not an exact canonical index for ${content.length} sibling(s)`,
      };
    }
    if (canonical[canonicalPosition] !== undefined) {
      return {
        valid: false,
        reason: `duplicate ${II_TAG} index ${JSON.stringify(rawIndex)}`,
      };
    }
    canonical[canonicalPosition] = child;
  }

  for (let position = 0; position < canonical.length; position += 1) {
    if (canonical[position] === undefined) {
      return {
        valid: false,
        reason: `missing ${II_TAG} index ${JSON.stringify(String(position))}`,
      };
    }
  }

  const ordered = canonical as HsonNode[];
  return {
    valid: true,
    canonical: ordered,
    reordered: ordered.some((child, position) => child !== content[position]),
  };
}

/**
 * Canonicalize only explicit array-wrapper order across a graph.
 *
 * This leaves every non-index field byte-for-byte equivalent, returns the
 * original root when no array changes, and copies only ancestor nodes whose
 * content order changed. Caller-owned input is never mutated.
 */
export function normalize_hson_array_index_order(
  input: HsonNode,
  where: string,
): HsonNode {
  const active = new WeakSet<object>();
  const complete = new WeakMap<object, HsonNode>();

  const visit = (node: HsonNode, path: string): HsonNode => {
    if (active.has(node)) {
      throw new Error(`[HSON array indexes] cycle detected in ${where} at ${path}`);
    }
    const existing = complete.get(node);
    if (existing !== undefined) return existing;

    active.add(node);
    let changed = false;
    let content = node.$_content.map((child, position) => {
      if (!is_Node(child)) return child;
      const normalized = visit(child, `${path}/${node.$_tag}/$_content[${position}]`);
      if (normalized !== child) changed = true;
      return normalized;
    });

    if (node.$_tag === ARR_TAG) {
      const analysis = analyze_hson_array_indexes(content);
      if (!analysis.valid) {
        throw new Error(
          `[HSON array indexes] ${analysis.reason} in ${where} at ${path}/${node.$_tag}`,
        );
      }
      if (analysis.reordered) {
        changed = true;
        content = [...analysis.canonical];
      }
    }

    const result = changed ? { ...node, $_content: content } : node;
    active.delete(node);
    complete.set(node, result);
    return result;
  };

  return visit(input, "");
}
