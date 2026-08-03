import { is_persisted_quid, mint_hson_node_quid } from "../../core/hson-node-quid.js";

export const LIVEMAP_QUID_MINT_RETRY_LIMIT = 32;

type CandidateSource = () => string;
const candidateSourceForOwner = new WeakMap<object, CandidateSource>();

export type LiveMapQuidClaimResult<T> =
  | Readonly<{ claimed: true; value: T }>
  | Readonly<{ claimed: false }>;

/** Narrow deterministic seam shared by every map-owned explicit allocator. */
export function set_livemap_quid_candidate_source_for_tests(
  owner: object,
  source: CandidateSource | undefined,
): void {
  if (source === undefined) candidateSourceForOwner.delete(owner);
  else candidateSourceForOwner.set(owner, source);
}

/** Run the one collision-aware map-owned QUID allocation loop. */
export function allocate_livemap_quid<T>(
  owner: object,
  unavailable: (candidate: string) => boolean,
  claim: (candidate: string) => LiveMapQuidClaimResult<T>,
): T | undefined {
  const source = candidateSourceForOwner.get(owner) ?? mint_hson_node_quid;
  for (let attempt = 0; attempt < LIVEMAP_QUID_MINT_RETRY_LIMIT; attempt += 1) {
    const candidate = source();
    if (!is_persisted_quid(candidate) || unavailable(candidate)) continue;
    const result = claim(candidate);
    if (result.claimed) return result.value;
  }
  return undefined;
}
