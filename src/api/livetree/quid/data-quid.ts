// data-quid.ts

import { HsonNode } from '../../../core/types.js';
import { _DATA_QUID } from '../../../core/constants.js';
import { get_el_for_node } from '../utils/node-map-helpers.js';
import { collect_subtree_nodes } from '../utils/subtree-traversal.js';
import { ensure_node_meta, prune_empty_node_meta } from '../../../core/node-storage.js';
import { record_livetree_materialization } from '../debug/materialization-profile.js';



/**
 * LiveTree-global identity registry.
 *
 * QUID ownership is an object-identity concern, not a DOM-mount concern.
 * Detaching a branch from the DOM or from its parent graph must not release its
 * claimed QUIDs; detached branches remain valid objects that may be grafted again.
 *
 * NODE_TO_QUID is weak, but QUID_TO_NODE strongly retains registered nodes until
 * an explicit identity disposal/reset path calls `drop_quid()`.
 */
const QUID_TO_NODE = new Map<string, HsonNode>();
const NODE_TO_QUID = new WeakMap<HsonNode, string>();

function assert_quid_available(q: string, n: HsonNode): void {
  const registered = QUID_TO_NODE.get(q);
  if (!registered || registered === n) return;

  throw new Error(`Duplicate QUID \"${q}\" is already registered to another node.`);
}

/** short, sortable-ish id; crypto if available, else timestamp+counter */
let _inc = 0;
function mint_quid(): string {
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
 * - n.$_meta["data-_quid"] if present,
 * - otherwise the NODE_TO_QUID registry.
 *
 * Returns `undefined` if the node has never
 * been assigned a QUID.
 ***************************************/
export function get_quid(n: HsonNode): string | undefined {
  const q = n.$_meta?.[_DATA_QUID];
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
 * - Otherwise generates a new one via mint_quid().
 * - Claims the QUID for this node and indexes both directions:
 *     QUID → node  (Map)
 *     node → QUID  (WeakMap)
 * - Rejects any QUID that is already claimed by another node.
 * - If `persist` (default true), writes the QUID
 *   into n.$_meta["data-_quid"] so it survives
 *   serialization.
 *
 * Returns the node’s QUID.
 ***************************************/
export function ensure_quid(
  n: HsonNode,
  opts?: { persist?: boolean },
): string {
  record_livetree_materialization("quidEnsureCalls");
  const persist = opts?.persist ?? true; // default true

  let q = get_quid(n);
  if (!q) q = mint_quid();

  // Persisted identity cannot silently steal another node's registry entry.
  assert_quid_available(q, n);
  QUID_TO_NODE.set(q, n);
  NODE_TO_QUID.set(n, q);
  record_livetree_materialization("quidRegistryWrites", 2);

  if (persist) {
    ensure_node_meta(n)[_DATA_QUID] = q;
  }

  return q;
}

/***************************************
 * get_node_by_quid
 *
 * O(1) lookup:
 * Given a QUID string, return the associated
 * HsonNode if known. Returns undefined if the
 * QUID is unregistered.
 ***************************************/
export function get_node_by_quid(q: string): HsonNode | undefined {
  record_livetree_materialization("quidLookups");
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
 *
 * This is not a detach/remove operation. Reindexing may restore this node's
 * registry entry, but it must not overwrite another live owner.
 ***************************************/
export function reindex_quid(n: HsonNode): void {
  const q = get_quid(n);
  if (!q) return;

  // Reindexing may restore this node, but may not overwrite another owner.
  assert_quid_available(q, n);
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
 *   n.$_meta so future serialization does not
 *   embed identity.
 * - If `stripDomAttr`, removes the DOM-side
 *   `[data-_quid]` attribute if the node is
 *   currently mounted.
 *
 * Used when explicitly destroying or resetting identity ownership.
 *
 * Not used for normal detach/removeSelf flows. A detached branch still owns its
 * HSON nodes and persisted QUIDs so it can remain valid while unmounted and may
 * be grafted again later.
 ***************************************/
export function drop_quid(n: HsonNode, opts?: { scrubMeta?: boolean; stripDomAttr?: boolean }): void {
  const metadataQuid = n.$_meta?.[_DATA_QUID];
  const registryQuid = NODE_TO_QUID.get(n);

  // Only remove forward entries when this node still owns them.
  // This prevents malformed duplicate metadata from deleting another node's binding.
  if (metadataQuid && QUID_TO_NODE.get(metadataQuid) === n) {
    QUID_TO_NODE.delete(metadataQuid);
  }
  if (
    registryQuid
    && registryQuid !== metadataQuid
    && QUID_TO_NODE.get(registryQuid) === n
  ) {
    QUID_TO_NODE.delete(registryQuid);
  }
  NODE_TO_QUID.delete(n);

  // optional: remove from meta to avoid persistence
  if (opts?.scrubMeta && n.$_meta) {
    if (_DATA_QUID in n.$_meta) delete n.$_meta[_DATA_QUID];
    prune_empty_node_meta(n);
  }

  // optional: strip DOM attribute if mounted
  if (opts?.stripDomAttr) {
    const el = get_el_for_node(n);
    el?.removeAttribute(_DATA_QUID);
  }
}

/**
 * Terminally destroy every QUID identity trace in an HSON subtree.
 *
 * Traversal is graph-derived and post-order. Registry ownership, persisted
 * metadata, and mapped DOM attributes are removed for the root and every
 * descendant without minting or reclaiming identity.
 */
export function destroy_subtree_quids(root: HsonNode): number {
  let destroyed = 0;

  for (const node of collect_subtree_nodes(root, "post")) {
    const q = get_quid(node);
    const hadMeta = node.$_meta !== undefined && _DATA_QUID in node.$_meta;
    const hadDomAttr = get_el_for_node(node)?.hasAttribute(_DATA_QUID) ?? false;

    drop_quid(node, { scrubMeta: true, stripDomAttr: true });

    if (q || hadMeta || hadDomAttr) destroyed += 1;
  }

  return destroyed;
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


export function remint_quid(
  n: HsonNode,
  opts?: { persist?: boolean; scrubMeta?: boolean },
): string {
  // Drop old identity ownership before claiming a new QUID for the same node.
  drop_quid(n, { scrubMeta: opts?.scrubMeta ?? true, stripDomAttr: false });

  // Write new identity metadata and indexes.
  const q = mint_quid();
  assert_quid_available(q, n);
  QUID_TO_NODE.set(q, n);
  NODE_TO_QUID.set(n, q);

  if (opts?.persist ?? true) {
    ensure_node_meta(n)[_DATA_QUID] = q;
  }
  return q;
}

export function get_el_if_quid(el: Element): string | undefined {
  return el.getAttribute(_DATA_QUID) ?? undefined;
}
