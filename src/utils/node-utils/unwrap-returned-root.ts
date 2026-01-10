// unwrap-returned-root.ts
import { HsonNode } from "../../types-consts/node.types";
import { ROOT_TAG } from "../../consts/constants";
import { is_Node } from "./node-guards";

/**
 * Normalize a returned parse root into a stable node fragment.
 *
 * Semantics:
 * - If the caller provides a `<_root>` node, this unwraps it and returns only its
 *   *direct child nodes*, discarding any non-node content (e.g. primitives).
 * - If the caller provides a non-root node, it is treated as a single-item fragment
 *   and returned as a one-element array.
 *
 * This function is intentionally shallow:
 * - It does **not** unwrap `_elem`, `_obj`, or other structural containers.
 * - It preserves original child order exactly.
 *
 * The return type is `ReadonlyArray` to signal that the fragment is a view over
 * parse results, not a mutable construction buffer.
 *
 * @param root - A parsed `HsonNode`, possibly a `<_root>` wrapper.
 * @returns A read-only array of top-level `HsonNode` items.
 */
export function unwrap_returned_root(root: HsonNode): ReadonlyArray<HsonNode> {
  //  if caller gives us <_root>, return its *element* children; else treat the node itself as a 1-item fragment
  if (root._tag === ROOT_TAG) {
    const kids = root._content ?? [];
    // Only real nodes (skip strings, etc.), stable order
    const out: HsonNode[] = [];
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      if (is_Node(k)) out.push(k);
    }
    return out;
  }
  return [root];
}
