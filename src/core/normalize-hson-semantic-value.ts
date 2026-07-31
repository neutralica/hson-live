import { ARR_TAG, ELEM_TAG, II_TAG, OBJ_TAG, STR_TAG, VAL_TAG } from "./constants.js";
import { normalize_hson_graph } from "./normalize-hson-graph.js";
import { is_Node } from "./node-guards.js";
import type { HsonNode } from "./types.js";

function is_scalar_leaf(node: HsonNode): boolean {
  return node.$_tag === STR_TAG || node.$_tag === VAL_TAG;
}

function scalar_carrier_value(node: HsonNode): HsonNode | undefined {
  if (node.$_tag !== OBJ_TAG && node.$_tag !== ELEM_TAG) return undefined;
  if (node.$_content.length !== 1 || !is_Node(node.$_content[0])) return undefined;
  return is_scalar_leaf(node.$_content[0]) ? node.$_content[0] : undefined;
}

function with_content(node: HsonNode, content: HsonNode["$_content"]): HsonNode {
  if (content.every((child, index) => child === node.$_content[index])) return node;
  return { ...node, $_content: content };
}

/**
 * Normalize a caller-supplied detached semantic value after ordinary graph
 * normalization has assigned all internal structural ownership.
 *
 * Scalar carriers at semantic-value boundaries collapse. Carriers owned by an
 * ordinary object member or element remain intact. Arrays remain arrays while
 * each item is independently treated as a semantic value.
 */
export function normalize_detached_hson_semantic_value(input: HsonNode, where: string): HsonNode {
  const canonical = normalize_hson_graph(input, where);

  const visit_object = (object: HsonNode): HsonNode => {
    const content = object.$_content.map((member) => {
      if (!is_Node(member) || member.$_content.length !== 1 || !is_Node(member.$_content[0])) return member;
      const relationship = member.$_content[0];
      let next = relationship;
      if (relationship.$_tag === ARR_TAG) next = visit_array(relationship);
      else if (relationship.$_tag === OBJ_TAG && scalar_carrier_value(relationship) === undefined) {
        next = visit_object(relationship);
      }
      return next === relationship ? member : with_content(member, [next]);
    });
    return with_content(object, content);
  };

  const visit_array = (array: HsonNode): HsonNode => {
    const content = array.$_content.map((item) => {
      if (!is_Node(item) || item.$_tag !== II_TAG || item.$_content.length !== 1 || !is_Node(item.$_content[0])) {
        return item;
      }
      const value = item.$_content[0];
      const next = visit_semantic(value);
      return next === value ? item : with_content(item, [next]);
    });
    return with_content(array, content);
  };

  const visit_semantic = (node: HsonNode): HsonNode => {
    const scalar = scalar_carrier_value(node);
    if (scalar !== undefined) return scalar;
    if (node.$_tag === ARR_TAG) return visit_array(node);
    if (node.$_tag === OBJ_TAG) return visit_object(node);
    return node;
  };

  return visit_semantic(canonical);
}
