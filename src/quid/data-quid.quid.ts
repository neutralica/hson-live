// data-quid.quid.ts

import { HsonNode } from '../types-consts/node.types';
import { _DATA_QUID} from '../consts/constants';
import { element_for_node } from '../utils/tree-utils/node-map-helpers';

// Use type-only imports and .js specifiers to play nice with verbatimModuleSyntax

/** node <-> quid maps (WeakMap allows GC) */
const QUID_TO_NODE = new Map<string, HsonNode>();
const NODE_TO_QUID = new WeakMap<HsonNode, string>();

/** short, sortable-ish id; crypto if available, else timestamp+counter */
let _inc = 0;
function mk_quid(): string {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const b = new Uint8Array(8);
    crypto.getRandomValues(b);
    return [...b].map(x => x.toString(16).padStart(2, "0")).join("");
  }
  return `q-${Date.now().toString(36)}-${(_inc++).toString(36)}`;
}

/***************************************
 * get_quid
 *
 * Return the QUID (stable identity token)
 * associated with a node, if any.
 *
 * Sources:
 * - n._meta["data-_quid"] if present,
 * - otherwise the NODE_TO_QUID registry.
 *
 * Returns `undefined` if the node has never
 * been assigned a QUID.
 ***************************************/
export function get_quid(n: HsonNode): string | undefined {
  const q = n._meta?.[_DATA_QUID];
  if (typeof q === "string" && q) return q;
  return NODE_TO_QUID.get(n);
}

/***************************************
 * ensure_quid
 *
 * Ensure a node has a QUID.
 *
 * Behavior:
 * - Reuses existing QUID if present.
 * - Otherwise generates a new one via mk_quid().
 * - Indexes both directions:
 *     QUID → node  (Map)
 *     node → QUID  (WeakMap)
 * - If `persist` (default true), writes the QUID
 *   into n._meta["data-_quid"] so it survives
 *   serialization.
 *
 * Returns the node’s QUID.
 ***************************************/
export function ensure_quid(
  n: HsonNode,
  opts?: { persist?: boolean },
): string {
  const persist = opts?.persist ?? true; // default true

  let q = get_quid(n);
  if (!q) q = mk_quid();

  QUID_TO_NODE.set(q, n);
  NODE_TO_QUID.set(n, q);

  if (persist) {
    (n._meta ??= {})[_DATA_QUID] = q;
  }

  return q;
}

/***************************************
 * get_node_by_quid
 *
 * O(1) lookup:
 * Given a QUID string, return the associated
 * HsonNode if known. Returns undefined if the
 * QUID is unregistered or the node was GC’d
 * in the WeakMap.
 ***************************************/
export function get_node_by_quid(q: string): HsonNode | undefined {
  return QUID_TO_NODE.get(q);
}

/***************************************
 * reindex_quid
 *
 * Re-establish registry bindings after the
 * caller structurally replaced a node but
 * preserved the same QUID.
 *
 * Typical use:
 *   - a transform clones/rebuilds a subtree,
 *     but keeps logical identity.
 *   - After replacement, call reindex_quid
 *     on the new node so QUID → node resolves
 *     correctly.
 ***************************************/
export function reindex_quid(n: HsonNode): void {
  const q = get_quid(n);
  if (!q) return;
  NODE_TO_QUID.set(n, q);
  QUID_TO_NODE.set(q, n);
}

export { _DATA_QUID };

/***************************************
 * drop_quid
 *
 * Remove a node’s QUID from both registries.
 *
 * Behavior:
 * - Deletes:
 *     QUID_TO_NODE[quid]
 *     NODE_TO_QUID[node]
 * - If `scrubMeta`, removes the QUID from
 *   n._meta so future serialization does not
 *   embed identity.
 * - If `stripDomAttr`, removes the DOM-side
 *   `[data-_quid]` attribute if the node is
 *   currently mounted.
 *
 * Used when:
 *   - removing a subtree,
 *   - orphaning nodes,
 *   - resetting identity.
 ***************************************/
export function drop_quid(n: HsonNode, opts?: { scrubMeta?: boolean; stripDomAttr?: boolean }) {
  const q = get_quid(n);
  if (!q) return;

  // delete both directions
  QUID_TO_NODE.delete(q);
  NODE_TO_QUID.delete(n);

  // optional: remove from meta to avoid persistence
  if (opts?.scrubMeta && n._meta && _DATA_QUID in n._meta) {
    delete n._meta[_DATA_QUID];
  }

  // optional: strip DOM attribute if mounted
  if (opts?.stripDomAttr) {
    const el = element_for_node(n as any); // avoid import loop by localizing this in one place if needed
    el?.removeAttribute(_DATA_QUID);
  }
}

/***************************************
 * has_quid
 *
 * Boolean check for whether a node already
 * carries an identity token, either via meta
 * or registry.
 ***************************************/
export function has_quid(n: HsonNode): boolean {
  return !!get_quid(n);
}
