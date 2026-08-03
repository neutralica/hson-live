// data-quid.ts

import { HsonNode } from '../../../core/types.js';
import { HSON_META_QUID } from '../../../core/constants.js';
import { HSON_METADATA_REGISTRY } from '../../../core/hson-metadata.js';
import { get_el_for_node } from '../utils/node-map-helpers.js';
import { collect_subtree_nodes } from '../utils/subtree-traversal.js';
import { record_livetree_materialization } from '../debug/materialization-profile.js';
import {
  assign_hson_node_quid,
  collect_hson_node_quid_claims,
  HsonNodeQuidValidationError,
  index_unique_hson_node_quid_claims,
  is_persisted_quid,
  mint_hson_node_quid,
  read_hson_node_quid,
  remove_hson_node_quid,
  type HsonNodeQuidClaim,
} from '../../../core/hson-node-quid.js';
import { is_ordinary_element_node } from '../../../core/node-guards.js';
import { LiveTreeQuidReuseError } from "../livetree.error.js";
import {
  assert_graph_runtime_available,
  bind_graph_runtime,
  default_livetree_runtime,
  runtime_for_node,
  type LiveTreeRuntime,
} from "../runtime/livetree-runtime.js";



/**
 * LiveTree runtime identity registry.
 *
 * Each runtime owns an independent QUID claim space. Ownership is an
 * object-identity concern, not a DOM-mount concern.
 * Detaching a branch from the DOM or from its parent graph must not release its
 * claimed QUIDs; detached branches remain valid objects that may be grafted again.
 *
 * A runtime's reverse index is weak, but its forward index strongly retains
 * registered nodes until an explicit identity disposal/reset path calls
 * `drop_quid()`.
 */
export const LIVETREE_QUID_MINT_RETRY_LIMIT = 32;

const QUID_CANDIDATE_SOURCE_FOR_TESTS = new WeakMap<LiveTreeRuntime, () => string>();

export type SuppliedLiveTreeQuidReservation = Readonly<{
  readonly applied: boolean;
  claim: () => void;
  rollback: () => void;
  release: () => void;
}>;

function runtime_for_operation(n: HsonNode, runtime?: LiveTreeRuntime): LiveTreeRuntime {
  return runtime ?? runtime_for_node(n) ?? default_livetree_runtime();
}

/** LiveTree remains ordinary-element-only even though LiveMap data containers are canonically eligible. */
function assert_livetree_quid_eligible(node: HsonNode, operation: string): void {
  const eligible: boolean = is_ordinary_element_node(node);
  if (eligible) return;
  throw new HsonNodeQuidValidationError(
    "INELIGIBLE_QUID",
    `Cannot ${operation} QUID metadata on ineligible HSON structural node "${node.$_tag}".`,
    { node, value: node.$_meta?.[HSON_META_QUID] },
  );
}

function assert_quid_available(q: string, n: HsonNode, runtime: LiveTreeRuntime): void {
  const registered = runtime.quidToNode.get(q);
  if (registered === n) return;
  if (registered !== undefined) {
    throw new Error(`Duplicate QUID \"${q}\" is already registered to another node.`);
  }

  const pending = runtime.pendingQuidClaims.get(q);
  if (pending !== undefined && pending !== n) {
    throw new Error(`Duplicate QUID \"${q}\" is reserved for another node.`);
  }
  if (runtime.issuedQuids.has(q)) throw new LiveTreeQuidReuseError(q);
}

function record_issued_quid(q: string, runtime: LiveTreeRuntime): void {
  runtime.issuedQuids.add(q);
}

/** Generate one canonical 80-bit persisted QUID from secure random bytes. */
export function mint_quid(): string {
  return mint_hson_node_quid();
}

/** Narrow deterministic candidate seam for diagnostics only. @internal */
export function set_livetree_quid_candidate_source_for_tests(
  runtime: LiveTreeRuntime,
  source: (() => string) | undefined,
): void {
  if (source === undefined) QUID_CANDIDATE_SOURCE_FOR_TESTS.delete(runtime);
  else QUID_CANDIDATE_SOURCE_FOR_TESTS.set(runtime, source);
}

function mint_available_quid(
  runtime: LiveTreeRuntime,
  reserved: ReadonlySet<string> = new Set(),
): string {
  for (let attempt = 0; attempt < LIVETREE_QUID_MINT_RETRY_LIMIT; attempt += 1) {
    const candidate = QUID_CANDIDATE_SOURCE_FOR_TESTS.get(runtime)?.() ?? mint_quid();
    if (!is_persisted_quid(candidate)) continue;
    if (!reserved.has(candidate)
      && !runtime.quidToNode.has(candidate)
      && !runtime.pendingQuidClaims.has(candidate)
      && !runtime.issuedQuids.has(candidate)) return candidate;
  }
  throw new Error(
    `Unable to generate an available LiveTree QUID after ${LIVETREE_QUID_MINT_RETRY_LIMIT} secure attempts.`,
  );
}

function unique_incoming_claims(
  root: HsonNode,
): readonly HsonNodeQuidClaim[] {
  const claims = collect_hson_node_quid_claims(root);
  for (const claim of claims) assert_livetree_quid_eligible(claim.node, "admit");
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
  runtime: LiveTreeRuntime,
): void {
  for (const claim of claims) assert_quid_available(claim.quid, claim.node, runtime);
}

/** Validate one complete incoming graph against LiveTree's active ownership. */
export function preflight_livetree_quid_graph(
  root: HsonNode,
  runtime: LiveTreeRuntime = runtime_for_operation(root),
): readonly HsonNodeQuidClaim[] {
  const claims = unique_incoming_claims(root);
  assert_graph_runtime_available(root, runtime);
  assert_claims_available(claims, runtime);
  return claims;
}

/**
 * Atomically claim supplied graph identity and ensure identity for its handle root.
 *
 * Absent descendants remain unquidded. Supplied descendant QUIDs are active as
 * soon as the graph is admitted, even before descendant handles are created.
 */
export function admit_livetree_quid_graph(
  root: HsonNode,
  runtime: LiveTreeRuntime = runtime_for_operation(root),
): string {
  assert_livetree_quid_eligible(root, "admit");
  const claims = preflight_livetree_quid_graph(root, runtime);
  const existingRootQuid = get_quid(root, runtime);
  const reserved = new Set(claims.map((claim) => claim.quid));
  const rootQuid = existingRootQuid ?? mint_available_quid(runtime, reserved);

  if (existingRootQuid === undefined) assign_hson_node_quid(root, rootQuid);
  for (const claim of claims) {
    runtime.quidToNode.set(claim.quid, claim.node);
    runtime.nodeToQuid.set(claim.node, claim.quid);
  }
  if (existingRootQuid === undefined) {
    runtime.quidToNode.set(rootQuid, root);
    runtime.nodeToQuid.set(root, rootQuid);
  }
  for (const claim of claims) record_issued_quid(claim.quid, runtime);
  record_issued_quid(rootQuid, runtime);
  bind_graph_runtime(root, runtime);
  record_livetree_materialization("quidEnsureCalls");
  record_livetree_materialization(
    "quidRegistryWrites",
    2 * (claims.length + (existingRootQuid === undefined ? 1 : 0)),
  );
  return rootQuid;
}

/**
 * Admit only QUIDs supplied by an authority-owned graph.
 *
 * Unlike standalone admission, this path never mints and preserves an absent
 * root claim. It is used by LiveMap-linked Reflection.
 */
export function admit_livetree_quid_graph_preserving_absence(
  root: HsonNode,
  runtime: LiveTreeRuntime = runtime_for_operation(root),
): string | undefined {
  assert_livetree_quid_eligible(root, "admit linked");
  const claims = preflight_livetree_quid_graph(root, runtime);
  for (const claim of claims) {
    runtime.quidToNode.set(claim.quid, claim.node);
    runtime.nodeToQuid.set(claim.node, claim.quid);
    record_issued_quid(claim.quid, runtime);
  }
  bind_graph_runtime(root, runtime);
  if (claims.length !== 0) {
    record_livetree_materialization("quidRegistryWrites", 2 * claims.length);
  }
  return read_hson_node_quid(root);
}

/** Register one supplied canonical claim without minting an absent claim. @internal */
export function register_supplied_livetree_quid(
  node: HsonNode,
  runtime: LiveTreeRuntime = runtime_for_operation(node),
): string | undefined {
  const q = read_hson_node_quid(node);
  if (q === undefined) {
    if (runtime_for_node(node) !== runtime) bind_graph_runtime(node, runtime);
    return undefined;
  }
  assert_livetree_quid_eligible(node, "register supplied");
  assert_quid_available(q, node, runtime);
  if (runtime_for_node(node) !== runtime) bind_graph_runtime(node, runtime);
  const alreadyRegistered = runtime.quidToNode.get(q) === node
    && runtime.nodeToQuid.get(node) === q;
  runtime.quidToNode.set(q, node);
  runtime.nodeToQuid.set(node, q);
  record_issued_quid(q, runtime);
  if (!alreadyRegistered) record_livetree_materialization("quidRegistryWrites", 2);
  return q;
}

/**
 * Reserve one supplied canonical QUID for one exact currently-unquidded linked node.
 * Preflight is mutation-free apart from the scoped runtime reservation itself.
 * @internal
 */
export function preflight_supplied_livetree_quid(
  node: HsonNode,
  quid: string,
  runtime: LiveTreeRuntime = runtime_for_operation(node),
): SuppliedLiveTreeQuidReservation {
  if (!is_persisted_quid(quid)) throw new Error("Supplied canonical QUID is malformed.");
  assert_livetree_quid_eligible(node, "preflight supplied");
  if (runtime.disposed) throw new Error("LiveTree runtime scope has been disposed.");
  if (runtime_for_node(node) !== runtime) {
    throw new Error("Supplied QUID target is not owned by the selected LiveTree runtime.");
  }
  if (read_hson_node_quid(node) !== undefined || runtime.nodeToQuid.get(node) !== undefined) {
    throw new Error("Supplied QUID target already carries runtime identity.");
  }
  const active = runtime.quidToNode.get(quid);
  const pending = runtime.pendingQuidClaims.get(quid);
  if ((active !== undefined && active !== node) || (pending !== undefined && pending !== node)) {
    throw new Error("Supplied canonical QUID collides in the selected LiveTree runtime.");
  }
  if (active === undefined && runtime.issuedQuids.has(quid)) {
    throw new LiveTreeQuidReuseError(quid);
  }
  const element = get_el_for_node(node);
  if (element !== undefined && element.getAttribute(HSON_QUID_MARKUP_NAME) !== null) {
    throw new Error("Supplied QUID target DOM element already carries identity metadata.");
  }
  runtime.pendingQuidClaims.set(quid, node);
  let applied = false;
  const issuedBefore = runtime.issuedQuids.has(quid);

  const rollback = (): void => {
    if (!applied) return;
    if (runtime.quidToNode.get(quid) === node) runtime.quidToNode.delete(quid);
    if (runtime.nodeToQuid.get(node) === quid) runtime.nodeToQuid.delete(node);
    if (read_hson_node_quid(node) === quid) remove_hson_node_quid(node);
    const currentElement = get_el_for_node(node);
    if (currentElement?.getAttribute(HSON_QUID_MARKUP_NAME) === quid) {
      currentElement.removeAttribute(HSON_QUID_MARKUP_NAME);
    }
    if (!issuedBefore) runtime.issuedQuids.delete(quid);
    applied = false;
  };

  const reservation: SuppliedLiveTreeQuidReservation = Object.freeze({
    get applied() { return applied; },
    claim(): void {
      if (applied) return;
      if (runtime.pendingQuidClaims.get(quid) !== node
        || runtime.quidToNode.has(quid)
        || runtime.nodeToQuid.has(node)
        || read_hson_node_quid(node) !== undefined) {
        throw new Error("Supplied canonical QUID reservation is no longer claimable.");
      }
      const currentElement = get_el_for_node(node);
      if (currentElement !== undefined && currentElement.getAttribute(HSON_QUID_MARKUP_NAME) !== null) {
        throw new Error("Supplied QUID target DOM metadata changed after preflight.");
      }
      try {
        currentElement?.setAttribute(HSON_QUID_MARKUP_NAME, quid);
        assign_hson_node_quid(node, quid);
        runtime.quidToNode.set(quid, node);
        runtime.nodeToQuid.set(node, quid);
        record_issued_quid(quid, runtime);
        applied = true;
        record_livetree_materialization("quidRegistryWrites", 2);
      } catch (cause) {
        if (runtime.quidToNode.get(quid) === node) runtime.quidToNode.delete(quid);
        if (runtime.nodeToQuid.get(node) === quid) runtime.nodeToQuid.delete(node);
        if (read_hson_node_quid(node) === quid) remove_hson_node_quid(node);
        if (currentElement?.getAttribute(HSON_QUID_MARKUP_NAME) === quid) {
          currentElement.removeAttribute(HSON_QUID_MARKUP_NAME);
        }
        if (!issuedBefore) runtime.issuedQuids.delete(quid);
        throw cause;
      }
    },
    rollback,
    release(): void {
      if (runtime.pendingQuidClaims.get(quid) === node) runtime.pendingQuidClaims.delete(quid);
    },
  });
  return reservation;
}

/***************************************
 * get_quid
 *
 * Return the QUID (stable identity token)
 * associated with a node, if any.
 *
 * Sources:
 * - n.$_meta["quid"] if present,
 * - otherwise the NODE_TO_QUID registry.
 *
 * Returns `undefined` if the node has never
 * been assigned a QUID.
 ***************************************/
export function get_quid(
  n: HsonNode,
  runtime: LiveTreeRuntime = runtime_for_operation(n),
): string | undefined {
  const q = read_hson_node_quid(n);
  if (q !== undefined) {
    assert_livetree_quid_eligible(n, "read");
    return q;
  }

  const registeredQ = runtime.nodeToQuid.get(n);
  if (registeredQ === undefined) return undefined;
  assert_livetree_quid_eligible(n, "read");
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
 *   into n.$_meta["quid"] so it survives
 *   serialization.
 *
 * Returns the node’s QUID.
 ***************************************/
export function ensure_quid(
  n: HsonNode,
  opts?: { persist?: boolean },
  runtime: LiveTreeRuntime = runtime_for_operation(n),
): string {
  assert_livetree_quid_eligible(n, "ensure");
  const persist = opts?.persist ?? true; // default true

  let q = get_quid(n, runtime);
  if (!q) q = mint_available_quid(runtime);

  // Persisted identity cannot silently steal another node's registry entry.
  assert_quid_available(q, n, runtime);
  assert_graph_runtime_available(n, runtime);
  if (persist) assign_hson_node_quid(n, q);
  bind_graph_runtime(n, runtime);
  runtime.quidToNode.set(q, n);
  runtime.nodeToQuid.set(n, q);
  record_issued_quid(q, runtime);
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
export function get_node_by_quid(
  q: string,
  runtime: LiveTreeRuntime = default_livetree_runtime(),
): HsonNode | undefined {
  record_livetree_materialization("quidLookups");
  const node = runtime.quidToNode.get(q);
  if (node !== undefined) assert_livetree_quid_eligible(node, "resolve");
  return node;
}

/***************************************
 * reindex_quid
 *
 * Re-establish complete registry bindings for an already-active exact node.
 *
 * This is not a detach/remove or restoration operation. An issued-but-inactive
 * QUID cannot be reindexed onto replacement content in the same runtime.
 ***************************************/
export function reindex_quid(
  n: HsonNode,
  runtime: LiveTreeRuntime = runtime_for_operation(n),
): void {
  assert_livetree_quid_eligible(n, "reindex");
  const q = get_quid(n, runtime);
  if (!q) return;

  // Reindexing may complete active exact-node indexes, but may not reuse identity.
  assert_quid_available(q, n, runtime);
  bind_graph_runtime(n, runtime);
  runtime.nodeToQuid.set(n, q);
  runtime.quidToNode.set(q, n);
  record_issued_quid(q, runtime);
}

export { HSON_META_QUID };
export const HSON_QUID_MARKUP_NAME =
  HSON_METADATA_REGISTRY[HSON_META_QUID].markupName;

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
 *   `hson:quid` attribute if the node is
 *   currently mounted.
 *
 * Used when explicitly destroying active identity ownership. The runtime's
 * issued ledger remains monotonic and is not reset here.
 *
 * Not used for normal detach/removeSelf flows. A detached branch still owns its
 * HSON nodes and persisted QUIDs so it can remain valid while unmounted and may
 * be grafted again later.
 ***************************************/
export function drop_quid(
  n: HsonNode,
  opts?: { scrubMeta?: boolean; stripDomAttr?: boolean },
  runtime: LiveTreeRuntime = runtime_for_operation(n),
): void {
  const hasMetadataQuid = n.$_meta?.[HSON_META_QUID] !== undefined;
  const registryQuid = runtime.nodeToQuid.get(n);
  if (hasMetadataQuid || registryQuid !== undefined) {
    assert_livetree_quid_eligible(n, "drop");
  }
  const metadataQuid = read_hson_node_quid(n);

  // Only remove forward entries when this node still owns them.
  // This prevents malformed duplicate metadata from deleting another node's binding.
  if (metadataQuid && runtime.quidToNode.get(metadataQuid) === n) {
    runtime.quidToNode.delete(metadataQuid);
  }
  if (
    registryQuid
    && registryQuid !== metadataQuid
    && runtime.quidToNode.get(registryQuid) === n
  ) {
    runtime.quidToNode.delete(registryQuid);
  }
  runtime.nodeToQuid.delete(n);

  // optional: remove from meta to avoid persistence
  if (opts?.scrubMeta && metadataQuid !== undefined) remove_hson_node_quid(n);

  // optional: strip DOM attribute if mounted
  if (opts?.stripDomAttr) {
    const el = get_el_for_node(n);
    el?.removeAttribute(HSON_QUID_MARKUP_NAME);
  }
}

/**
 * Terminally destroy every QUID identity trace in an HSON subtree.
 *
 * Traversal is graph-derived and post-order. Registry ownership, persisted
 * metadata, and mapped DOM attributes are removed for the root and every
 * descendant without minting or reclaiming identity.
 */
export function destroy_subtree_quids(
  root: HsonNode,
  runtime: LiveTreeRuntime = runtime_for_operation(root),
): number {
  let destroyed = 0;
  const nodes = collect_subtree_nodes(root, "post");

  // Validate the complete graph before destroying any identity so an invalid
  // descendant cannot leave the subtree partially scrubbed.
  for (const node of nodes) get_quid(node, runtime);

  for (const node of nodes) {
    const q = get_quid(node, runtime);
    const hadMeta = node.$_meta !== undefined && HSON_META_QUID in node.$_meta;
    const hadDomAttr = get_el_for_node(node)?.hasAttribute(HSON_QUID_MARKUP_NAME) ?? false;

    drop_quid(node, { scrubMeta: true, stripDomAttr: true }, runtime);

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
  runtime: LiveTreeRuntime = runtime_for_operation(n),
): string {
  assert_livetree_quid_eligible(n, "remint");
  const q = mint_available_quid(runtime);

  // Drop old identity ownership before claiming a new QUID for the same node.
  drop_quid(n, { scrubMeta: opts?.scrubMeta ?? true, stripDomAttr: false }, runtime);

  // Write new identity metadata and indexes.
  if (opts?.persist ?? true) assign_hson_node_quid(n, q);

  bind_graph_runtime(n, runtime);
  runtime.quidToNode.set(q, n);
  runtime.nodeToQuid.set(n, q);
  record_issued_quid(q, runtime);
  return q;
}

export function get_el_if_quid(el: Element): string | undefined {
  return el.getAttribute(HSON_QUID_MARKUP_NAME) ?? undefined;
}
