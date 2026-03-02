// remove-child.ts

import { HsonNode } from "../../../types/index.js";
import { HsonQuery } from "../../../types/livetree.types.js";
import { is_Node } from "../../../utils/node-utils/node-guards.js";
import { detach_node_deep } from "../../../utils/tree-utils/detach-node.js";
import { parse_selector } from "../../../utils/tree-utils/parse-selector.js";
import { LiveTree } from "../livetree.js";
import { matchAttrs, matchMeta, matchText, search_nodes } from "./search.js";


// CHANGED: implement "remove all direct node-children" directly (no selector/search logic)
export function remove_child(this: LiveTree): number {
  const parent = this.node;
  const kids = parent._content;

  if (!Array.isArray(kids) || kids.length === 0) return 0;

  // Only node children are removable via detach_node_deep.
  const toRemove: HsonNode[] = [];
  const nextKids: typeof kids = [];

  for (const ch of kids) {
    if (is_Node(ch)) {
      toRemove.push(ch);
      continue;
    }
    // keep primitives (if you truly want to drop primitives too, we can change this)
    nextKids.push(ch);
  }

  if (toRemove.length === 0) return 0;

  // unlink first (graph correctness), then deep-detach
  parent._content = nextKids;

  for (const n of toRemove) detach_node_deep(n);

  return toRemove.length;
}

// CHANGED: if you have empty() that should clear EVERYTHING (nodes + primitives),
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

// CHANGED: factor out “does this node match the query”
function matches_query(node: HsonNode, query: HsonQuery): boolean {
  const tagOK = !query.tag || node._tag.toLowerCase() === query.tag.toLowerCase();
  return tagOK && matchAttrs(node, query) && matchMeta(node, query) && matchText(node, query);
}

