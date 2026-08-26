import {
  ARR_TAG,
  HSON_META_INDEX,
  HSON_SYS_PREFIX,
  II_TAG,
  OBJ_TAG,
  ROOT_TAG,
  STR_TAG,
  VAL_TAG,
} from "./constants.js";
import { CREATE_NODE } from "./factories.js";
import { admit_hson_number } from "./hson-number.js";
import { is_Node } from "./node-guards.js";
import {
  assert_ordered_projected_value,
  is_ordered_projected_object,
  ordered_projected_array,
  ordered_projected_object,
  type OrderedProjectedValue,
} from "./ordered-projected-value.js";
import type { HsonNode, Primitive } from "./types.js";

/** Construct one canonical HSON value node from the neutral ordered carrier. */
export function projected_value_to_hson_node(value: OrderedProjectedValue): HsonNode {
  assert_ordered_projected_value(value);
  if (typeof value === "string") return value_node(STR_TAG, [value]);
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    const primitive = typeof value === "number" ? admit_hson_number(value) : value;
    return value_node(VAL_TAG, [primitive]);
  }
  if (Array.isArray(value)) {
    return value_node(
      ARR_TAG,
      value.map((child, index) => projected_array_item_to_hson_node(index, child)),
    );
  }
  if (!is_ordered_projected_object(value)) {
    throw new TypeError("Invalid ordered projected object carrier.");
  }
  return value_node(
    OBJ_TAG,
    value.entries.map(([key, child]) => projected_object_property_to_hson_node(key, child)),
  );
}

/** Construct the canonical root carrier used by Transform generic JSON admission. */
export function projected_value_to_hson_root(value: OrderedProjectedValue): HsonNode {
  return CREATE_NODE({
    $_tag: ROOT_TAG,
    $_content: [projected_value_to_hson_node(value)],
  });
}

/** Construct one canonical ordinary object-property relationship. */
export function projected_object_property_to_hson_node(
  key: string,
  value: OrderedProjectedValue,
): HsonNode {
  assert_projected_object_key(key);
  const child = projected_value_to_hson_node(value);
  const payload = child.$_tag === OBJ_TAG || child.$_tag === ARR_TAG
    ? child
    : value_node(OBJ_TAG, [child]);
  return CREATE_NODE({
    $_tag: key,
    $_content: [payload],
  });
}

/** Construct one canonical indexed array relationship. */
export function projected_array_item_to_hson_node(
  index: number,
  value: OrderedProjectedValue,
): HsonNode {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new TypeError(`Projected array index must be a non-negative safe integer; received ${String(index)}.`);
  }
  return CREATE_NODE({
    $_tag: II_TAG,
    $_meta: { [HSON_META_INDEX]: String(index) },
    $_content: [projected_value_to_hson_node(value)],
  });
}

/** Return whether a node is a generic projected-value node or root. */
export function is_projected_value_hson_node(node: HsonNode): boolean {
  if (node.$_tag === STR_TAG || node.$_tag === VAL_TAG || node.$_tag === OBJ_TAG || node.$_tag === ARR_TAG) {
    return true;
  }
  if (node.$_tag !== ROOT_TAG || node.$_content.length !== 1) return false;
  const child = node.$_content[0];
  return is_Node(child)
    && (child.$_tag === STR_TAG || child.$_tag === VAL_TAG || child.$_tag === OBJ_TAG || child.$_tag === ARR_TAG);
}

/** Project one canonical generic HSON value/root into the ordered carrier. */
export function projected_value_from_hson_node(node: HsonNode): OrderedProjectedValue {
  if (node.$_tag === ROOT_TAG) {
    const [child] = node.$_content;
    if (node.$_content.length !== 1 || !is_Node(child)) {
      throw new TypeError("Projected HSON root must contain exactly one value node.");
    }
    return projected_value_from_hson_node(child);
  }

  if (node.$_tag === STR_TAG) {
    const [value] = node.$_content;
    if (node.$_content.length !== 1 || typeof value !== "string") {
      throw new TypeError("Projected _hson_str must contain exactly one string.");
    }
    return value;
  }

  if (node.$_tag === VAL_TAG) {
    const [value] = node.$_content;
    if (node.$_content.length !== 1 || is_Node(value)) {
      throw new TypeError("Projected _hson_val must contain exactly one primitive.");
    }
    if (typeof value === "number") return admit_hson_number(value);
    if (value === null || typeof value === "boolean") return value;
    throw new TypeError("Projected _hson_val must contain number, boolean, or null.");
  }

  if (node.$_tag === ARR_TAG) {
    return ordered_projected_array(node.$_content.map((wrapper, index) => {
      if (!is_Node(wrapper) || wrapper.$_tag !== II_TAG) {
        throw new TypeError("Projected _hson_arr children must be _hson_ii nodes.");
      }
      if (wrapper.$_meta?.[HSON_META_INDEX] !== String(index)) {
        throw new TypeError(`Projected array index metadata must match position ${index}.`);
      }
      const [child] = wrapper.$_content;
      if (wrapper.$_content.length !== 1 || !is_Node(child)) {
        throw new TypeError("Projected _hson_ii must contain exactly one value node.");
      }
      return projected_value_from_hson_node(child);
    }));
  }

  if (node.$_tag !== OBJ_TAG) {
    throw new TypeError(`Unsupported projected HSON value node <${node.$_tag}>.`);
  }

  if (node.$_content.length === 1 && is_Node(node.$_content[0])) {
    const only = node.$_content[0];
    if (only.$_tag === STR_TAG || only.$_tag === VAL_TAG || only.$_tag === ARR_TAG || only.$_tag === OBJ_TAG) {
      return projected_value_from_hson_node(only);
    }
  }

  return ordered_projected_object(node.$_content.map((property) => {
    if (!is_Node(property)) {
      throw new TypeError("Projected _hson_obj properties must be nodes.");
    }
    assert_projected_object_key(property.$_tag);
    const [child] = property.$_content;
    if (property.$_content.length !== 1 || !is_Node(child)) {
      throw new TypeError(`Projected property ${JSON.stringify(property.$_tag)} must contain exactly one value relationship.`);
    }
    return [property.$_tag, projected_value_from_hson_node(child)] as const;
  }));
}

function assert_projected_object_key(key: string): void {
  if (typeof key !== "string" || key.startsWith(HSON_SYS_PREFIX)) {
    throw new TypeError(`Reserved HSON prefix ${JSON.stringify(HSON_SYS_PREFIX)} is not allowed in projected object key ${JSON.stringify(key)}.`);
  }
}

function value_node(tag: typeof STR_TAG | typeof VAL_TAG | typeof OBJ_TAG | typeof ARR_TAG, content: HsonNode[] | Primitive[]): HsonNode {
  return CREATE_NODE({ $_tag: tag, $_content: content });
}
