// data-quid.ts

import { HsonNode } from '../../../core/types.js';
import { _DATA_QUID } from '../../../core/constants.js';
import { get_el_for_node } from '../utils/node-map-helpers.js';
import { collect_subtree_nodes } from '../utils/subtree-traversal.js';
import { record_livetree_materialization } from '../debug/materialization-profile.js';
import {
  assert_hson_node_quid_eligible,
  assign_hson_node_quid,
  collect_hson_node_quid_claims,
  HsonNodeQuidValidationError,
  index_unique_hson_node_quid_claims,
  mint_hson_node_quid,
  read_hson_node_quid,
  remove_hson_node_quid,
  type HsonNodeQuidClaim,
} from '../../../core/hson-node-quid.js';



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
export const LIVETREE_QUID_MINT_RETRY_LIMIT = 32;

function assert_quid_available(q: string, n: HsonNode): void {
  const registered = QUID_TO_NODE.get(q);
  if (!registered || registered === n) return;

  throw new Error(`Duplicate QUID \"${q}\" is already registered to another node.`);
}

/** Generate one canonical 80-bit persisted QUID from secure random bytes. */
export function mint_quid(): string {
  return mint_hson_node_quid();
}

function mint_available_quid(
  reserved: ReadonlySet<string> = new Set(),
): string {
  for (let attempt = 0; attempt < LIVETREE_QUID_MINT_RETRY_LIMIT; attempt += 1) {
    const candidate = mint_quid();
    if (!reserved.has(candidate) && !QUID_TO_NODE.has(candidate)) return candidate;
  }
  throw new Error(
    `Unable to generate an available LiveTree QUID after ${LIVETREE_QUID_MINT_RETRY_LIMIT} secure attempts.`,
  );
}

function unique_incoming_claims(
  root: HsonNode,
): readonly HsonNodeQuidClaim[] {
  const claims = collect_hson_node_quid_claims(root);
  try {
    index_unique_hson_node_quid_claims(claims);
  } catch (cause) {
    if (cause instanceof HsonNodeQuidValidationError) {
      throw new Error(
        `Duplicate QUID "${String(cause.value)}" occurs within the incoming LiveTree graph.`,
        { cause },
      );
    }
    throw cause;
  }
  return claims;
}

function assert_claims_available(
  claims: readonly HsonNodeQuidClaim[],
): void {
  for (const claim of claims) assert_quid_available(claim.quid, claim.node);
}

/** Validate one complete incoming graph against LiveTree's active ownership. */
export function preflight_livetree_quid_graph(
  root: HsonNode,
): readonly HsonNodeQuidClaim[] {
  const claims = unique_incoming_claims(root);
  assert_claims_available(claims);
  return claims;
}

/**
 * Atomically claim supplied graph identity and ensure identity for its handle root.
 *
 * Absent descendants remain unquidded. Supplied descendant QUIDs are active as
 * soon as the graph is admitted, even before descendant handles are created.
 */
export function admit_livetree_quid_graph(root: HsonNode): string {
  assert_hson_node_quid_eligible(root, "admit");
  const claims = preflight_livetree_quid_graph(root);
  const existingRootQuid = get_quid(root);
  const reserved = new Set(claims.map((claim) => claim.quid));
  const rootQuid = existingRootQuid ?? mint_available_quid(reserved);

  if (existingRootQuid === undefined) assign_hson_node_quid(root, rootQuid);
  for (const claim of claims) {
    QUID_TO_NODE.set(claim.quid, claim.node);
    NODE_TO_QUID.set(claim.node, claim.quid);
  }
  if (existingRootQuid === undefined) {
    QUID_TO_NODE.set(rootQuid, root);
    NODE_TO_QUID.set(root, rootQuid);
  }
  record_livetree_materialization("quidEnsureCalls");
  record_livetree_materialization(
    "quidRegistryWrites",
    2 * (claims.length + (existingRootQuid === undefined ? 1 : 0)),
  );
  return rootQuid;
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
  const q = read_hson_node_quid(n);
  if (q !== undefined) return q;

  const registeredQ = NODE_TO_QUID.get(n);
  if (registeredQ === undefined) return undefined;
  assert_hson_node_quid_eligible(n, "read");
  return registeredQ;
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
  assert_hson_node_quid_eligible(n, "ensure");
  const persist = opts?.persist ?? true; // default true

  let q = get_quid(n);
  if (!q) q = mint_available_quid();

  // Persisted identity cannot silently steal another node's registry entry.
  assert_quid_available(q, n);
  if (persist) assign_hson_node_quid(n, q);

  QUID_TO_NODE.set(q, n);
  NODE_TO_QUID.set(n, q);
  record_livetree_materialization("quidEnsureCalls");
  record_livetree_materialization("quidRegistryWrites", 2);

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
  const node = QUID_TO_NODE.get(q);
  if (node !== undefined) assert_hson_node_quid_eligible(node, "resolve");
  return node;
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
  assert_hson_node_quid_eligible(n, "reindex");
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
  const hasMetadataQuid = n.$_meta?.[_DATA_QUID] !== undefined;
  const registryQuid = NODE_TO_QUID.get(n);
  if (hasMetadataQuid || registryQuid !== undefined) {
    assert_hson_node_quid_eligible(n, "drop");
  }
  const metadataQuid = read_hson_node_quid(n);

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
  if (opts?.scrubMeta && metadataQuid !== undefined) remove_hson_node_quid(n);

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
  const nodes = collect_subtree_nodes(root, "post");

  // Validate the complete graph before destroying any identity so an invalid
  // descendant cannot leave the subtree partially scrubbed.
  for (const node of nodes) get_quid(node);

  for (const node of nodes) {
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
  assert_hson_node_quid_eligible(n, "remint");
  const q = mint_available_quid();

  // Drop old identity ownership before claiming a new QUID for the same node.
  drop_quid(n, { scrubMeta: opts?.scrubMeta ?? true, stripDomAttr: false });

  // Write new identity metadata and indexes.
  if (opts?.persist ?? true) assign_hson_node_quid(n, q);

  QUID_TO_NODE.set(q, n);
  NODE_TO_QUID.set(n, q);
  return q;
}

export function get_el_if_quid(el: Element): string | undefined {
  return el.getAttribute(_DATA_QUID) ?? undefined;
}
