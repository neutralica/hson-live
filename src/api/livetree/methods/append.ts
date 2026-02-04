// append.ts

import { is_Node } from "../../../utils/node-utils/node-guards";
import { unwrap_root_elem } from "../../../utils/html-utils/unwrap-root-elem";
import { STR_TAG, ELEM_TAG } from "../../../consts/constants";
import { HsonNode } from "../../../types/node.types";
import { CREATE_NODE } from "../../../consts/factories";
import { make_string } from "../../../utils/primitive-utils/make-string.nodes.utils";
import { _throw_transform_err } from "../../../utils/sys-utils/throw-transform-err.utils";
import { LiveTree } from "../livetree";
import { element_for_node } from "../../../utils/tree-utils/node-map-helpers";
import { project_livetree } from "../creation/project-live-tree";

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

export function append(this: LiveTree, content: LiveTree): LiveTree {
  // CHANGED: append is end-only
  return insert_at.call(this, content, Infinity);
}

export function prepend(this: LiveTree, content: LiveTree): LiveTree {
  // NEW: explicit prepend
  return insert_at.call(this, content, 0);
}

// CHANGED: add to LiveTree methods (where append is defined / exported)
export function insertAt(this: LiveTree, content: LiveTree, index: number): LiveTree {
  // CHANGED: forward directly; do not re-normalize here
  return this.append(content, index);
}

// CHANGED: old append(content, index?) becomes internal primitive
function insert_at(this: LiveTree, content: LiveTree, index: number): LiveTree {
  const targetNode = this.node;

  // Normalize content into HsonNode[]
  let nodesToAppend: HsonNode[];
  if (is_Node(content)) {
    nodesToAppend = unwrap_root_elem(content);
  } else {
    _throw_transform_err("[ERR] invalid content provided", "insert_at", make_string(content));
  }

  // Ensure container node
  let containerNode: HsonNode;
  const firstChild = targetNode._content[0];

  if (is_Node(firstChild) && firstChild._tag === ELEM_TAG) {
    containerNode = firstChild;
  } else {
    containerNode = CREATE_NODE({ _tag: ELEM_TAG, _content: [] });

    // CHANGED: migrate existing node-children into the container so indices mean what you think
    const existing = targetNode._content.filter(is_Node);
    const nonNodes = targetNode._content.filter(ch => !is_Node(ch));

    containerNode._content.push(...existing);

    // CHANGED: replace content with single container + any non-node content
    targetNode._content = [containerNode, ...nonNodes];
  }

  const childContent = containerNode._content;

  // HSON INSERTION
  const insertIx = normalize_ix(index, childContent.length); // CHANGED: always compute once
  childContent.splice(insertIx, 0, ...nodesToAppend);

  // DOM SYNC
  // --- DOM SYNC --------------------------------------------------------
  const liveElement = element_for_node(targetNode);
  if (liveElement) {
    const domChildren = Array.from(liveElement.childNodes);

    if (typeof index === "number") {
      let insertIx = normalize_ix(index, domChildren.length);

      for (const newNode of nodesToAppend) {
        const dom = project_livetree(newNode);
        const refNode = domChildren[insertIx] ?? null;
        liveElement.insertBefore(dom, refNode);
        insertIx += 1;
      }
    } else {
      for (const newNode of nodesToAppend) {
        const dom = project_livetree(newNode);
        liveElement.appendChild(dom);
      }
    }
  }

  return this;
}