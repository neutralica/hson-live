import {
  ARR_TAG,
  HSON_META_INDEX,
  HSON_MAX_NESTING,
  II_TAG,
  OBJ_TAG,
  ROOT_TAG,
  STR_TAG,
  VAL_TAG,
} from "./constants.js";
import { assert_valid_hson_data_name } from "./hson-name.js";
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
import { define_materialized_property } from "./projected-value-materialization.js";
import type { HsonNode, JsonValue, Primitive } from "./types.js";

/** Construct one canonical Hson value node from the neutral ordered carrier. */
export function projected_value_to_hson_node(value: OrderedProjectedValue): HsonNode {
  assert_canonical_hson_data_value(value);
  return build_projected_value_node(value);
}

// Canonical validation authenticates factory-owned, recursively frozen carriers.
// Their descendants cannot change between validation and synchronous construction.
// Only independently callable boundaries above/below validate complete subtrees.
function build_projected_value_node(value: OrderedProjectedValue): HsonNode {
  if (typeof value === "string") return value_node(STR_TAG, [value]);
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    const primitive = typeof value === "number" ? admit_hson_number(value) : value;
    return value_node(VAL_TAG, [primitive]);
  }
  if (Array.isArray(value)) {
    return value_node(
      ARR_TAG,
      value.map((child, index) => build_projected_array_item(index, child)),
    );
  }
  if (!is_ordered_projected_object(value)) {
    throw new TypeError("Invalid ordered data object carrier.");
  }
  return value_node(
    OBJ_TAG,
    value.entries.map(([key, child]) => build_projected_object_property(key, child)),
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
  assert_canonical_hson_data_value(value);
  return build_projected_object_property(key, value);
}

function build_projected_object_property(key: string, value: OrderedProjectedValue): HsonNode {
  const child = build_projected_value_node(value);
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
    throw new TypeError(`Data array index must be a non-negative safe integer; received ${String(index)}.`);
  }
  assert_canonical_hson_data_value(value);
  return build_projected_array_item(index, value);
}

function build_projected_array_item(index: number, value: OrderedProjectedValue): HsonNode {
  return CREATE_NODE({
    $_tag: II_TAG,
    $_meta: { [HSON_META_INDEX]: String(index) },
    $_content: [build_projected_value_node(value)],
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

/** Collapse only the transparent relationships recognized by canonical Data projection. */
export function projected_hson_value_node(node: HsonNode): HsonNode {
  if (node.$_tag === ROOT_TAG) {
    const [child] = node.$_content;
    if (node.$_content.length !== 1 || !is_Node(child)) {
      throw new TypeError("Projected Hson root must contain exactly one value node.");
    }
    return projected_hson_value_node(child);
  }
  if (node.$_tag === OBJ_TAG && node.$_content.length === 1 && is_Node(node.$_content[0])) {
    const only = node.$_content[0];
    if (only.$_tag === STR_TAG || only.$_tag === VAL_TAG || only.$_tag === ARR_TAG || only.$_tag === OBJ_TAG) {
      return projected_hson_value_node(only);
    }
  }
  return node;
}

/** Project one canonical generic Hson value/root into the ordered carrier. */
export function projected_value_from_hson_node(node: HsonNode): OrderedProjectedValue {
  return read_projected_hson_node(node, orderedReader);
}

/** Fresh detached JavaScript Data, using exactly the canonical projection decoder. */
export function materialize_projected_hson_node(node: HsonNode): JsonValue {
  return read_projected_hson_node(node, javascriptReader);
}

type DataReader<T, A, O> = Readonly<{
  scalar: (value: Primitive) => T;
  array: () => A;
  item: (target: A, index: number, value: T) => void;
  finishArray: (target: A) => T;
  object: () => O;
  property: (target: O, key: string, value: T) => void;
  finishObject: (target: O) => T;
}>;

type OrderedEntries = Array<readonly [string, OrderedProjectedValue]>;
const orderedReader: DataReader<OrderedProjectedValue, OrderedProjectedValue[], OrderedEntries> = {
  scalar: value => value,
  array: () => [],
  item: (items, index, value) => define_materialized_property(items, index, value),
  finishArray: ordered_projected_array,
  object: () => [],
  property: (entries, key, value) => define_materialized_property(entries, entries.length, [key, value]),
  finishObject: ordered_projected_object,
};
type JavascriptObject = { value: Record<string, JsonValue>; duplicate: string | undefined };
const javascriptReader: DataReader<JsonValue, JsonValue[], JavascriptObject> = {
  scalar: value => value,
  array: () => [],
  item: define_materialized_property,
  finishArray: items => items,
  object: () => ({ value: {}, duplicate: undefined }),
  property: (target, key, value) => {
    if (Object.hasOwn(target.value, key)) target.duplicate ??= key;
    define_materialized_property(target.value, key, value);
  },
  finishObject: target => {
    // Ordered projection checks duplicates after decoding all child relationships.
    if (target.duplicate !== undefined) throw new TypeError(`Duplicate ordered data object key ${JSON.stringify(target.duplicate)}.`);
    return target.value;
  },
};

/** Both output forms share scalar interpretation, relationship checks and failure behavior. */
function read_projected_hson_node<T, A, O>(source: HsonNode, reader: DataReader<T, A, O>): T {
  const node = projected_hson_value_node(source);
  if (node.$_tag === STR_TAG) {
    const [value] = node.$_content;
    if (node.$_content.length !== 1 || typeof value !== "string") {
      throw new TypeError("Projected _hson_str must contain exactly one string.");
    }
    return reader.scalar(value);
  }
  if (node.$_tag === VAL_TAG) {
    const [value] = node.$_content;
    if (node.$_content.length !== 1 || is_Node(value)) {
      throw new TypeError("Projected _hson_val must contain exactly one primitive.");
    }
    if (typeof value === "number") return reader.scalar(admit_hson_number(value));
    if (value === null || typeof value === "boolean") return reader.scalar(value);
    throw new TypeError("Projected _hson_val must contain number, boolean, or null.");
  }
  if (node.$_tag === ARR_TAG) {
    const result = reader.array();
    for (let index = 0; index < node.$_content.length; index++) {
      reader.item(result, index, read_projected_array_item(node.$_content[index], index, reader));
    }
    return reader.finishArray(result);
  }
  if (node.$_tag !== OBJ_TAG) {
    throw new TypeError(`Unsupported projected Hson value node <${node.$_tag}>.`);
  }
  const result = reader.object();
  for (const property of node.$_content) {
    if (!is_Node(property)) throw new TypeError("Projected _hson_obj properties must be nodes.");
    const child = projected_relationship_value_node(property);
    reader.property(result, property.$_tag, read_projected_hson_node(child, reader));
  }
  return reader.finishObject(result);
}

function assert_projected_object_key(key: string): void {
  assert_valid_hson_data_name(key);
}

/** Require that an ordered carrier uses only canonical Hson data-object names. */
export function assert_canonical_hson_data_value(
  value: OrderedProjectedValue,
): asserts value is OrderedProjectedValue {
  assert_ordered_projected_value(value);
  const visit = (candidate: OrderedProjectedValue, depth = 0): void => {
    if (depth >= HSON_MAX_NESTING) throw new TypeError(`Hson nesting depth must be less than ${HSON_MAX_NESTING}`);
    if (Array.isArray(candidate)) {
      for (const child of candidate) visit(child, depth + 1);
      return;
    }
    if (!is_ordered_projected_object(candidate)) return;
    for (const [key, child] of candidate.entries) {
      assert_valid_hson_data_name(key);
      visit(child, depth + 1);
    }
  };
  visit(value);
}

function value_node(tag: typeof STR_TAG | typeof VAL_TAG | typeof OBJ_TAG | typeof ARR_TAG, content: HsonNode[] | Primitive[]): HsonNode {
  return CREATE_NODE({ $_tag: tag, $_content: content });
}

/** Decode an occurrence using its original physical index. @internal */
export function materialize_projected_array_item(wrapper: unknown, index: number): JsonValue {
  return read_projected_array_item(wrapper, index, javascriptReader);
}

function read_projected_array_item<T, A, O>(wrapper: unknown, index: number, reader: DataReader<T, A, O>): T {
  if (!is_Node(wrapper)) throw new TypeError("Projected _hson_arr children must be _hson_ii nodes.");
  const child = projected_relationship_value_node(wrapper, index);
  return read_projected_hson_node(child, reader);
}

/** Shared selected member/item relationship qualification. @internal */
export function projected_relationship_value_node(wrapper: HsonNode, index?: string | number): HsonNode {
  if (index !== undefined) {
    if (wrapper.$_tag !== II_TAG) throw new TypeError("Projected _hson_arr children must be _hson_ii nodes.");
    if (wrapper.$_meta?.[HSON_META_INDEX] !== String(index)) throw new TypeError(`Data array index metadata must match position ${index}.`);
  } else {
    assert_projected_object_key(wrapper.$_tag);
  }
  const [child] = wrapper.$_content;
  if (wrapper.$_content.length !== 1 || !is_Node(child)) {
    throw new TypeError(index !== undefined ? "Projected _hson_ii must contain exactly one value node."
      : `Data property ${JSON.stringify(wrapper.$_tag)} must contain exactly one value relationship.`);
  }
  return child;
}
