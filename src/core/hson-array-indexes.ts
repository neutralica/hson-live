import { ARR_TAG, HSON_META_INDEX, II_TAG } from "./constants.js";
import { is_Node } from "./node-guards.js";
import {
  enumerable_own_data_array_items,
  own_enumerable_data_property,
} from "./node-storage.js";
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

function is_required_node_record(
  value: unknown,
): value is HsonNode & Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const tag = Object.getOwnPropertyDescriptor(value, "$_tag");
  const content = Object.getOwnPropertyDescriptor(value, "$_content");
  return tag !== undefined
    && tag.enumerable === true
    && Object.hasOwn(tag, "value")
    && typeof tag.value === "string"
    && content !== undefined
    && content.enumerable === true
    && Object.hasOwn(content, "value")
    && Array.isArray(content.value);
}

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

  const fail = (path: string, message: string): never => {
    throw new Error(`[Hson array indexes] ${message} in ${where} at ${path || "/"}`);
  };

  const visit = (value: unknown, path: string): HsonNode => {
    if (!is_required_node_record(value)) {
      return fail(path, "node must be a plain object with enumerable own data $_tag and $_content fields");
    }
    const tagProperty = own_enumerable_data_property(value, "$_tag");
    if (tagProperty === undefined || !tagProperty.present || typeof tagProperty.value !== "string") {
      return fail(path, "node must carry $_tag as an enumerable own data property with a valid string value");
    }
    const tag = tagProperty.value;
    const contentProperty = own_enumerable_data_property(value, "$_content");
    if (contentProperty === undefined || !contentProperty.present || !Array.isArray(contentProperty.value)) {
      return fail(`${path}/${tag}`, "node must carry an array $_content");
    }
    const contentItems = enumerable_own_data_array_items(contentProperty.value);
    if (contentItems === undefined) {
      return fail(`${path}/${tag}`, "node must carry dense enumerable own data items in $_content");
    }
    const attrsProperty = own_enumerable_data_property(value, "$_attrs");
    const metaProperty = own_enumerable_data_property(value, "$_meta");
    if (attrsProperty === undefined || metaProperty === undefined) {
      return fail(`${path}/${tag}`, "optional node fields must be enumerable own data properties when present");
    }

    const node = value;
    if (active.has(node)) {
      throw new Error(`[Hson array indexes] cycle detected in ${where} at ${path}`);
    }
    const existing = complete.get(node);
    if (existing !== undefined) return existing;

    active.add(node);
    let changed = false;
    let content: Array<HsonNode | Primitive> = contentItems.map((child, position) => {
      if (child === null || typeof child === "string" || typeof child === "number" || typeof child === "boolean") {
        return child;
      }
      const normalized = visit(child, `${path}/${tag}/$_content[${position}]`);
      if (normalized !== child) changed = true;
      return normalized;
    });

    if (tag === ARR_TAG) {
      const analysis = analyze_hson_array_indexes(content);
      if (!analysis.valid) {
        throw new Error(
          `[Hson array indexes] ${analysis.reason} in ${where} at ${path}/${tag}`,
        );
      }
      if (analysis.reordered) {
        changed = true;
        content = [...analysis.canonical];
      }
    }

    let result = node;
    if (changed) {
      result = { $_tag: tag, $_content: content };
      if (attrsProperty.present) Reflect.set(result, "$_attrs", attrsProperty.value);
      if (metaProperty.present) Reflect.set(result, "$_meta", metaProperty.value);
    }
    active.delete(node);
    complete.set(node, result);
    return result;
  };

  return visit(input, "");
}
