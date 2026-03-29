// remove-child.ts

import { ELEM_TAG, EVERY_VSN } from "../../../consts/constants.js";
import { Primitive } from "../../../types/core.types.js";
import { HsonQuery } from "../../../types/livetree.types.js";
import { HsonNode } from "../../../types/node.types.js";
import { is_Node } from "../../../utils/node-utils/node-guards.js";
import { detach_node_deep } from "../../../utils/tree-utils/detach-node.js";
import { parse_selector } from "../../../utils/tree-utils/parse-selector.js";
import { LiveTree } from "../livetree.js";
import { matchAttrs, matchMeta, matchText, search_nodes } from "./search.js";


type ContentItem = HsonNode | Primitive;

// cached set for “is this a structural tag?”
const VSN_SET: ReadonlySet<string> = new Set(EVERY_VSN);
const is_vsn_tag = (tag: string): boolean => VSN_SET.has(tag);

// semantic container = unwrap single _elem
function unwrap_single_elem(node: HsonNode): HsonNode {
  const kids = node._content;
  if (!Array.isArray(kids)) return node;

  let only: HsonNode | undefined;
  let count = 0;

  for (const v of kids as ContentItem[]) {
    if (!is_Node(v)) continue;
    count += 1;
    if (count === 1) only = v;
    if (count > 1) return node;
  }

  return (count === 1 && only && only._tag === ELEM_TAG) ? only : node;
}

/**
 * CHANGED: Remove *direct element-children* from the semantic container.
 * - semantic container = single `_elem` child if present, else the node itself
 * - direct “element children” = node children whose tag is NOT a VSN tag
 * - returns number removed (semantic count)
 */
export function remove_node_children(parent: HsonNode): number {
  const container = unwrap_single_elem(parent);

  const kids = container._content;
  if (!Array.isArray(kids) || kids.length === 0) return 0;

  // collect direct element children only
  const toRemove: HsonNode[] = [];
  for (const v of kids as ContentItem[]) {
    if (!is_Node(v)) continue;
    if (is_vsn_tag(v._tag)) continue; // skip _str/_val/_elem/_obj/_arr/_ii/_root
    toRemove.push(v);
  }
  if (toRemove.length === 0) return 0;

  // unlink first (graph correctness)
  const removeSet = new Set(toRemove);
  container._content = (kids as ContentItem[]).filter(
    (v) => !(is_Node(v) && removeSet.has(v)),
  );

  for (const n of toRemove) {
    // then funnel teardown
    detach_node_deep(n);
  }

  return toRemove.length;
}

// if you have empty() that should clear EVERYTHING (nodes + primitives),
// implement it separately so semantics are explicit.
export function empty_contents(this: LiveTree): LiveTree {
  const parent = this.node;
  const kids = parent._content;

  if (!Array.isArray(kids) || kids.length === 0) return this;

  const toDetach: HsonNode[] = [];
  for (const ch of kids) {
    if (is_Node(ch)) toDetach.push(ch);
  }

  // drop everything, including primitives
  parent._content = [];

  for (const n of toDetach) detach_node_deep(n);

  return this;
}

// factor out “does this node match the query”
function matches_query(node: HsonNode, query: HsonQuery): boolean {
  const tagOK = !query.tag || node._tag.toLowerCase() === query.tag.toLowerCase();
  return tagOK && matchAttrs(node, query) && matchMeta(node, query) && matchText(node, query);
}

