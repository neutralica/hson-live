import { ROOT_TAG } from "../../../../core/constants.js";
import { assert_invariants } from "../../../../core/assert-invariants.js";
import { is_Node } from "../../../../core/node-guards.js";
import type { HsonNode } from "../../../../core/types.js";
import { _throw_transform_err } from "../sys-utils/throw-transform-err.utils.js";

/**
 * Detach the one semantic value carried by an internal HSON root.
 *
 * This boundary is deliberately exact: it accepts only a canonical
 * `_hson_root` with one direct node child, returns that identical child, and
 * never unwraps another meaningful structural node.
 */
export function detach_hson_root_value(root: HsonNode): HsonNode {
  if (!is_Node(root) || root.$_tag !== ROOT_TAG) {
    _throw_transform_err(
      `expected an internal ${ROOT_TAG} attachment carrier`,
      "detach_hson_root_value",
    );
  }
  if (!Array.isArray(root.$_content)) {
    _throw_transform_err(
      `${ROOT_TAG} must carry an array $_content`,
      "detach_hson_root_value",
    );
  }
  if (root.$_content.length !== 1) {
    _throw_transform_err(
      `${ROOT_TAG} must contain exactly one semantic node; observed ${root.$_content.length}`,
      "detach_hson_root_value",
    );
  }
  const semantic = root.$_content[0];
  if (!is_Node(semantic)) {
    _throw_transform_err(
      `${ROOT_TAG} semantic content must be a HsonNode`,
      "detach_hson_root_value",
    );
  }

  assert_invariants(root, "detach_hson_root_value");
  return semantic;
}
