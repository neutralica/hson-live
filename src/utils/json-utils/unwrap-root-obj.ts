// unwrap-root-obj.ts

import { ARR_TAG, ELEM_TAG, OBJ_TAG, ROOT_TAG } from "../../consts/constants.js";
import { CREATE_NODE } from "../../consts/factories.js";
import { HsonNode } from "../../types/node.types.js";
import { is_Node } from "../node-utils/node-guards.js";


/**
 * Normalize an input node by removing an outer `<_hson_root>` wrapper and ensuring
 * the result is always a structural “cluster” node (`_hson_obj`, `_hson_arr`, or `_hson_elem`).
 *
 * Rules:
 * - If `node` is not `<_hson_root>`, it is returned unchanged.
 * - If `<_hson_root>` has no child nodes, returns an empty `_hson_obj` cluster.
 * - If `<_hson_root>` has exactly one child:
 *   - If that child is already `_hson_obj`, `_hson_arr`, or `_hson_elem`, return it.
 *   - Otherwise, box the single child inside a new `_hson_obj` cluster to keep a
 *     structural container as the canonical result.
 * - If `<_hson_root>` has multiple child nodes, wrap them in a new `_hson_obj` cluster.
 *
 * This is mainly used to enforce “structural-at-the-top” invariants so callers
 * can treat the returned value as a cluster node without special-casing.
 *
 * @param node - Input node that may be a `<_hson_root>` wrapper.
 * @returns A cluster node (`_hson_obj`, `_hson_arr`, or `_hson_elem`) suitable for downstream processing.
 */
export function unwrap_root_obj(node: HsonNode): HsonNode {
  if (node.$_tag !== ROOT_TAG) return node;

  const kids = (node.$_content ?? []).filter(is_Node) as HsonNode[];
  if (kids.length === 0) {
    // canonical empty object cluster as the item
    return CREATE_NODE({ $_tag: OBJ_TAG, $_meta: {}, $_content: [] });
  }
  if (kids.length === 1) {
    const k = kids[0];
    if (k.$_tag === OBJ_TAG || k.$_tag === ARR_TAG || k.$_tag === ELEM_TAG) return k;
    // single non-cluster: box it so the item stays structural
    return CREATE_NODE({ $_tag: OBJ_TAG, $_meta: {}, $_content: [k] });
  }
  // multiple clusters under implicit root → normalize as an object cluster
  return CREATE_NODE({ $_tag: OBJ_TAG, $_meta: {}, $_content: kids });
}
