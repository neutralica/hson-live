// node-search.ts

import { HsonNode } from "../../../types-consts/node.types";
import { STR_TAG } from "../../../consts/constants";
import { is_Node } from "../../../utils/node-utils/node-guards";
import { element_for_node } from "../../../utils/tree-utils/node-map-helpers";
import { HsonQuery } from "../../../types-consts/livetree.types";


/**
 * Narrowing helper to detect `RegExp` values.
 *
 * Uses `Object.prototype.toString` rather than `instanceof` so it
 * behaves correctly across realms (e.g. iframes).
 *
 * @param v - Unknown value to test.
 * @returns `true` if `v` is a `RegExp`, otherwise `false`.
 */
const isRegExp = (v: unknown): v is RegExp =>
  Object.prototype.toString.call(v) === "[object RegExp]";

/**
 * Extract a best-effort text representation for a node.
 *
 * Behavior:
 * - If a DOM element is mapped for the node, returns its
 *   `textContent` (or `""` if null).
 * - Otherwise:
 *   - Scans `_content` for the first `_str` child whose first content
 *     entry is a string and returns that.
 *   - If no such child exists, returns `""`.
 *
 * This is a lightweight, non-recursive heuristic used for text-based
 * matching in queries.
 *
 * @param n - The `HsonNode` to inspect.
 * @returns A string representation of the node's text, possibly empty.
 */
function nodeText(n: HsonNode): string {
  const el = element_for_node(n);
  if (el) return el.textContent ?? "";

  const kids = (n._content ?? []).filter(is_Node);
  for (const k of kids) {
    if (k._tag === STR_TAG && typeof k._content?.[0] === "string") {
      return k._content[0] as string;
    }
  }
  return "";
}

/**
 * Apply query-specific text matching to a node.
 *
 * Behavior:
 * - If `query.text` is `null`/`undefined`, returns `true` (no text
 *   constraint).
 * - Otherwise:
 *   - Computes `t = nodeText(node)`.
 *   - If `query.text` is a `RegExp`, tests `t` against it.
 *   - If `query.text` is a string, checks `t.includes(query.text)`.
 *   - If `query.text` is a function, calls it with `t` and coerces
 *     the result to boolean.
 *   - For any other type, falls back to `true`.
 *
 * @param node - The node to test.
 * @param query - The `HsonQuery` object, optionally containing a `text`
 *                field in one of the supported forms.
 * @returns `true` if the node passes the text constraint, `false` otherwise.
 * @see nodeText
 */
function matchText(node: HsonNode, query: HsonQuery): boolean {
  const qText = (query as any).text;
  if (qText == null) return true;

  const t = nodeText(node);

  if (isRegExp(qText)) {
    return qText.test(t);
  }
  if (typeof qText === "string") {
    return t.includes(qText);
  }
  if (typeof qText === "function") {
    return !!qText(t);
  }
  return true;
}

/**
 * Apply attribute-based matching rules from a query to a node.
 *
 * Behavior:
 * - If `query.attrs` is absent or falsy, returns `true` (no constraint).
 * - Otherwise, for each `[key, qv]` in `query.attrs`:
 *   - Let `nv = node._attrs[key]`.
 *   - If `qv` is a `RegExp`:
 *       - Requires `nv` to be a string that passes `qv.test(nv)`.
 *   - If `qv` is a non-null object:
 *       - Requires `nv` to be a non-null object and to match all
 *         sub-keys `sk` with strictly equal values `sv`.
 *   - If `qv === true`:
 *       - Interpreted as a flag-style attribute; requires that `key`
 *         exists in `node._attrs`.
 *   - Otherwise:
 *       - Requires strict equality `nv === qv`.
 * - Returns `false` on the first mismatch; `true` if all attributes match.
 *
 * @param node - The `HsonNode` whose attributes will be tested.
 * @param query - The `HsonQuery` providing an `attrs` constraint.
 * @returns `true` if the node matches all attribute rules, else `false`.
 */
function matchAttrs(node: HsonNode, query: HsonQuery): boolean {
  if (!query.attrs) return true;
  const na = node._attrs ?? {};

  for (const [k, qv] of Object.entries(query.attrs)) {
    const nv = (na as any)[k];

    if (qv instanceof RegExp) {
      if (typeof nv !== "string" || !qv.test(nv)) return false;
    } else if (typeof qv === "object" && qv !== null) {
      if (typeof nv !== "object" || nv === null) return false;
      for (const [sk, sv] of Object.entries(qv as Record<string, unknown>)) {
        if ((nv as any)[sk] !== sv) return false;
      }
    } else if (qv === true) {
      // flag-style: just needs to exist
      if (!(k in na)) return false;
    } else {
      if (nv !== qv) return false;
    }
  }
  return true;
}

/**
 * Apply meta-field matching rules from a query to a node.
 *
 * Behavior:
 * - If `query.meta` is absent or falsy, returns `true` (no constraint).
 * - Otherwise, for each `[key, qv]` in `query.meta`:
 *   - Let `nv = node._meta[key]`.
 *   - If `qv` is a `RegExp`:
 *       - Requires `nv` to be a string that passes `qv.test(nv)`.
 *   - Otherwise:
 *       - Requires strict equality `nv === qv`.
 * - Returns `false` on the first mismatch; `true` if all meta entries match.
 *
 * @param node - The `HsonNode` whose `_meta` object will be tested.
 * @param query - The `HsonQuery` providing a `meta` constraint.
 * @returns `true` if the node satisfies all meta rules, else `false`.
 */
function matchMeta(node: HsonNode, query: HsonQuery): boolean {
  if (!query.meta) return true;
  const nm = node._meta ?? {};
  const qMeta = query.meta as Record<string, unknown>;

  for (const [k, qv] of Object.entries(qMeta)) {
    const nv = (nm as any)[k];
    if (isRegExp(qv)) {
      if (typeof nv !== "string" || !qv.test(nv)) return false;
    } else if (nv !== qv) {
      return false;
    }
  }
  return true;
}

/**
 * Depth-first search over a set of HSON nodes using a structured query.
 *
 * Matching:
 * - A node is considered a match if all of the following pass:
 *   - Tag: `query.tag` is absent, or equals `node._tag` (case-insensitive).
 *   - Attributes: `matchAttrs(node, query)` is `true`.
 *   - Meta: `matchMeta(node, query)` is `true`.
 *   - Text: `matchText(node, query)` is `true`.
 *
 * Traversal:
 * - Walks the tree in depth-first order starting from the `nodes` array,
 *   descending via `_content` and filtering children with `is_Node`.
 * - If `options.findFirst` is `true`, traversal stops as soon as a
 *   match is found and only the first matching node is returned
 *   (wrapped in a single-element array).
 * - Otherwise, collects *all* matching nodes in document order.
 *
 * @param nodes - Root nodes to search from.
 * @param query - Query object describing tag, attrs, meta, and optional
 *                text constraints.
 * @param options - Search options:
 *   - `findFirst`: when `true`, stop after the first match and return
 *     at most one node.
 * @returns An array of matching nodes; either all matches or at most one
 *          when `findFirst` is enabled.
 * @see matchAttrs
 * @see matchMeta
 * @see matchText
 */
export function search_nodes(
  nodes: HsonNode[],
  query: HsonQuery,
  options: { findFirst: boolean },
): HsonNode[] {
  const results: HsonNode[] = [];

  const checkNode = (node: HsonNode): boolean => {
    const tagOK =
      !query.tag ||
      node._tag.toLowerCase() === query.tag.toLowerCase();

    return (
      tagOK &&
      matchAttrs(node, query) &&
      matchMeta(node, query) &&
      matchText(node, query)
    );
  };

  const traverse = (nodesToSearch: HsonNode[]) => {
    for (const node of nodesToSearch) {
      if (options.findFirst && results.length) return;

      if (checkNode(node)) {
        results.push(node);
        if (options.findFirst) return;
      }

      const kids = (node._content ?? []).filter(is_Node);
      if (kids.length) traverse(kids);
    }
  };

  traverse(nodes);
  return options.findFirst ? results.slice(0, 1) : results;
}