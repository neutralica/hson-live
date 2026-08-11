import { ARR_TAG, HSON_META_QUID, OBJ_TAG, STR_TAG, VAL_TAG } from "./constants.js";
import { is_Node, is_ordinary_element_node } from "./node-guards.js";
import { ensure_node_meta, prune_empty_node_meta } from "./node-storage.js";
import type { HsonNode } from "./types.js";

/** Canonical 45-bit persisted node identity. */
export type PersistedQuid = string;

export const PERSISTED_QUID_LENGTH = 9;
export const PERSISTED_QUID_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

const PERSISTED_QUID_RANDOM_BYTE_LENGTH = 6;

const PERSISTED_QUID_CHARS = new Set(PERSISTED_QUID_ALPHABET);

/** True only for an already-canonical persisted QUID; this never normalizes. */
export function is_persisted_quid(value: unknown): value is PersistedQuid {
  if (typeof value !== "string" || value.length !== PERSISTED_QUID_LENGTH) return false;
  for (const char of value) if (!PERSISTED_QUID_CHARS.has(char)) return false;
  return true;
}

/** Encode the first 45 bits of exactly six random bytes as nine Base32 digits. */
export function encode_persisted_quid(bytes: Uint8Array): PersistedQuid {
  if (bytes.length !== PERSISTED_QUID_RANDOM_BYTE_LENGTH) {
    throw new Error(`persisted QUID encoding requires exactly ${PERSISTED_QUID_RANDOM_BYTE_LENGTH} bytes`);
  }
  let output = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5 && output.length < PERSISTED_QUID_LENGTH) {
      bits -= 5;
      output += PERSISTED_QUID_ALPHABET[(buffer >>> bits) & 31];
    }
  }
  return output;
}

export type HsonNodeQuidValidationCode =
  | "INELIGIBLE_QUID"
  | "MALFORMED_QUID"
  | "DUPLICATE_QUID";

export class HsonNodeQuidValidationError extends Error {
  readonly code: HsonNodeQuidValidationCode;
  readonly node: HsonNode;
  readonly path: string | undefined;
  readonly value?: unknown;
  readonly conflictingNode: HsonNode | undefined;
  readonly conflictingPath: string | undefined;

  constructor(
    code: HsonNodeQuidValidationCode,
    message: string,
    details: {
      node: HsonNode;
      path?: string;
      value?: unknown;
      conflictingNode?: HsonNode;
      conflictingPath?: string;
    },
  ) {
    super(message);
    this.name = "HsonNodeQuidValidationError";
    this.code = code;
    this.node = details.node;
    this.path = details.path;
    this.value = details.value;
    this.conflictingNode = details.conflictingNode;
    this.conflictingPath = details.conflictingPath;
  }
}

/** Generate one canonical 45-bit persisted QUID from secure random bytes. */
export function mint_hson_node_quid(): PersistedQuid {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("secure QUID generation is unavailable");
  }
  const bytes = new Uint8Array(PERSISTED_QUID_RANDOM_BYTE_LENGTH);
  globalThis.crypto.getRandomValues(bytes);
  return encode_persisted_quid(bytes);
}

/** Reject any attempt to establish or operate on QUID state for a VSN. */
export function assert_hson_node_quid_eligible(
  node: HsonNode,
  operation: string,
): void {
  const eligible: boolean = is_ordinary_element_node(node)
    || is_projected_container_quid_eligible(node);
  if (eligible) return;
  throw new HsonNodeQuidValidationError(
    "INELIGIBLE_QUID",
    `Cannot ${operation} QUID metadata on ineligible HSON structural node "${node.$_tag}".`,
    { node, value: node.$_meta?.[HSON_META_QUID] },
  );
}

/** True only for semantic projected object/array values, never carrier wrappers. */
export function is_projected_container_quid_eligible(node: HsonNode): boolean {
  if (node.$_tag === ARR_TAG) return true;
  if (node.$_tag !== OBJ_TAG) return false;
  if (node.$_content.length !== 1) return true;
  const only = node.$_content[0];
  if (!is_Node(only)) return true;
  // A single structural value child is the transform's transparent scalar
  // carrier, not a user-visible object value.
  return only.$_tag !== STR_TAG
    && only.$_tag !== VAL_TAG
    && only.$_tag !== ARR_TAG
    && only.$_tag !== OBJ_TAG;
}

/**
 * Read and validate persisted QUID metadata without consulting a consumer
 * registry. Clean VSNs report absence; QUID-bearing VSNs reject.
 */
export function read_hson_node_quid(node: HsonNode): PersistedQuid | undefined {
  const value = node.$_meta?.[HSON_META_QUID];
  if (value === undefined) return undefined;
  assert_hson_node_quid_eligible(node, "read");
  if (!is_persisted_quid(value)) {
    throw new HsonNodeQuidValidationError(
      "MALFORMED_QUID",
      `Invalid persisted QUID "${String(value)}".`,
      { node, value },
    );
  }
  return value;
}

export function has_hson_node_quid(node: HsonNode): boolean {
  return read_hson_node_quid(node) !== undefined;
}

/** Validate one node's optional QUID value and placement without mutation. */
export function validate_hson_node_quid(node: HsonNode): void {
  read_hson_node_quid(node);
}

/** Assign one supplied canonical QUID to an eligible node. */
export function assign_hson_node_quid(
  node: HsonNode,
  quid: unknown,
): PersistedQuid {
  assert_hson_node_quid_eligible(node, "assign");
  if (!is_persisted_quid(quid)) {
    throw new HsonNodeQuidValidationError(
      "MALFORMED_QUID",
      `Invalid persisted QUID "${String(quid)}".`,
      { node, value: quid },
    );
  }
  ensure_node_meta(node)[HSON_META_QUID] = quid;
  return quid;
}

/** Reuse valid metadata or mint and persist a fresh canonical QUID. */
export function ensure_hson_node_quid(node: HsonNode): PersistedQuid {
  assert_hson_node_quid_eligible(node, "ensure");
  const existing = read_hson_node_quid(node);
  if (existing !== undefined) return existing;
  return assign_hson_node_quid(node, mint_hson_node_quid());
}

/** Deliberately remove valid QUID metadata from an eligible node. */
export function remove_hson_node_quid(node: HsonNode): PersistedQuid | undefined {
  assert_hson_node_quid_eligible(node, "remove");
  const existing = read_hson_node_quid(node);
  if (existing === undefined) return undefined;
  if (node.$_meta !== undefined) {
    delete node.$_meta[HSON_META_QUID];
    prune_empty_node_meta(node);
  }
  return existing;
}

export type HsonNodeQuidClaim = Readonly<{
  quid: PersistedQuid;
  node: HsonNode;
  path: string;
}>;

/**
 * Validate and collect every canonical QUID claim in one HSON object graph.
 *
 * Equal values on distinct nodes are preserved as separate claims. Repeated
 * references to the same object are one graph node and are visited once.
 * Traversal is deterministic depth-first content order and never mutates or
 * registers the graph.
 */
export function collect_hson_node_quid_claims(
  root: HsonNode,
): readonly HsonNodeQuidClaim[] {
  const claims: HsonNodeQuidClaim[] = [];
  const visited = new WeakSet<HsonNode>();
  const stack: { node: HsonNode; path: string }[] = [{
    node: root,
    path: `$<${root.$_tag}>`,
  }];

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined || visited.has(current.node)) continue;
    visited.add(current.node);

    let quid: PersistedQuid | undefined;
    try {
      quid = read_hson_node_quid(current.node);
    } catch (cause) {
      if (!(cause instanceof HsonNodeQuidValidationError)) throw cause;
      throw new HsonNodeQuidValidationError(
        cause.code,
        `${cause.message} at ${current.path}.`,
        {
          node: current.node,
          path: current.path,
          value: cause.value,
        },
      );
    }

    if (quid !== undefined) {
      claims.push(Object.freeze({
        quid,
        node: current.node,
        path: current.path,
      }));
    }

    for (let index = current.node.$_content.length - 1; index >= 0; index -= 1) {
      const child = current.node.$_content[index];
      if (!is_Node(child)) continue;
      stack.push({
        node: child,
        path: `${current.path}.$_content[${index}]<${child.$_tag}>`,
      });
    }
  }

  return Object.freeze(claims);
}

/** Deterministically reject duplicate claims and build one ownership index. */
export function index_unique_hson_node_quid_claims(
  claims: readonly HsonNodeQuidClaim[],
): ReadonlyMap<PersistedQuid, HsonNode> {
  const indexed = new Map<PersistedQuid, HsonNodeQuidClaim>();
  for (const claim of claims) {
    const prior = indexed.get(claim.quid);
    if (prior !== undefined && prior.node !== claim.node) {
      throw new HsonNodeQuidValidationError(
        "DUPLICATE_QUID",
        `Duplicate persisted QUID "${claim.quid}" at ${prior.path} and ${claim.path}.`,
        {
          node: claim.node,
          path: claim.path,
          value: claim.quid,
          conflictingNode: prior.node,
          conflictingPath: prior.path,
        },
      );
    }
    indexed.set(claim.quid, claim);
  }
  return new Map(
    [...indexed].map(([quid, claim]) => [quid, claim.node]),
  );
}

/**
 * Validate one graph and require unique persisted claims.
 *
 * This compatibility helper remains the canonical ownership-domain scan.
 * Pure transform boundaries use `collect_hson_node_quid_claims()` instead.
 */
export function scan_hson_node_quids(
  root: HsonNode,
): ReadonlyMap<PersistedQuid, HsonNode> {
  return index_unique_hson_node_quid_claims(
    collect_hson_node_quid_claims(root),
  );
}
