// append.ts

import { is_Node } from "../node-utils/node-guards.js";
import { unwrap_root_elem } from "../html-utils/unwrap-root-elem.js";
import { STR_TAG, ELEM_TAG } from "../../consts/constants.js";
import { HsonNode } from "../../types/node.types.js";
import { CREATE_NODE } from "../../consts/factories.js";
import { make_string } from "../primitive-utils/make-string.nodes.utils.js";
import { _throw_transform_err } from "../sys-utils/throw-transform-err.utils.js";
import { LiveTree } from "../../api/livetree/livetree.js";
import { element_for_node } from "../tree-utils/node-map-helpers.js";
import { project_livetree } from "../../api/livetree/creation/project-live-tree.js";

/**
 * Normalize an insertion index for an array of a given length.
 *
 * Positive indexes are clamped to the range `[0, length]`, so values
 * larger than `length` insert at the end. Negative indexes are treated
 * as offsets from the end (like `Array.prototype.at`), and are clamped
 * to `0` if they go past the start.
 *
 * @param index - Requested insertion index (may be negative to count from the end).
 * @param length - Current length of the array being indexed into.
 * @returns A safe insertion index in the range `[0, length]`.
 */
export function normalize_ix(index: number, length: number): number {
  if (length <= 0) return 0;

  if (index >= 0) {
    return index > length ? length : index;
  }

  const fromEnd = length + index;
  if (fromEnd < 0) return 0;
  return fromEnd;
}
