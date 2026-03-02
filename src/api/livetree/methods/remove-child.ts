// remove-child.ts

import { HsonNode } from "../../../types/index.js";
import { HsonQuery } from "../../../types/livetree.types.js";
import { is_Node } from "../../../utils/node-utils/node-guards.js";
import { detach_node_deep } from "../../../utils/tree-utils/detach-node.js";
import { parse_selector } from "../../../utils/tree-utils/parse-selector.js";
import { LiveTree } from "../livetree.js";
import { matchAttrs, matchMeta, matchText, search_nodes } from "./search.js";

export function remove_child(
  this: LiveTree,
  query: HsonQuery | string,
): LiveTree {
  const parent = this.node;
  const kids = parent._content;

  if (!Array.isArray(kids) || kids.length === 0) return this;

  const q: HsonQuery = typeof query === "string" ? parse_selector(query) : query;

  // CHANGED: only consider DIRECT node children for matching
  const toRemove: HsonNode[] = [];
  for (const ch of kids) {
    if (!is_Node(ch)) continue;
    if (matches_query(ch, q)) toRemove.push(ch); // implement using your checkNode logic
  }

  if (toRemove.length === 0) return this;

  // CHANGED: unlink first (graph correctness), then deep-detach
  const removeSet = new Set(toRemove);
  const nextKids = kids.filter((ch) => !(is_Node(ch) && removeSet.has(ch)));
  parent._content = nextKids;

  for (const n of toRemove) detach_node_deep(n);

  return this;
}

// CHANGED: factor out “does this node match the query”
function matches_query(node: HsonNode, query: HsonQuery): boolean {
  const tagOK = !query.tag || node._tag.toLowerCase() === query.tag.toLowerCase();
  return tagOK && matchAttrs(node, query) && matchMeta(node, query) && matchText(node, query);
}

