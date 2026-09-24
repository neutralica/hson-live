import { is_ordinary_element_node } from "../../core/node-guards.js";
import {
  read_hson_node_quid,
} from "../../core/hson-node-quid.js";
import type {
  LiveMapDocumentCommitTarget,
  LiveMapDocumentPath,
  LiveMapGraphCommit,
  LiveMapGraphOp,
} from "../../types/livemap.types.js";
import {
  LiveMapDocumentIdentityRegistrationError,
  LiveMapDocumentMutationError,
} from "./livemap.error.js";
import { document_path_equal, resolve_document_path } from "./livemap.document.path.js";
import {
  type LiveMapDocumentMutationController,
  type PreparedDocumentMutation,
} from "./livemap.document.mutation.js";
import type { LiveMapRuntimeIdentityParticipant } from "./livemap.runtime-identity.js";
import {
  allocate_livemap_quid,
  LIVEMAP_QUID_MINT_RETRY_LIMIT,
  set_livemap_quid_candidate_source_for_tests,
} from "./livemap.quid-allocation.js";
import type { LiveMapIdentityEpochController } from "./livemap.identity-epoch.js";

export const LIVEMAP_DOCUMENT_QUID_MINT_RETRY_LIMIT = LIVEMAP_QUID_MINT_RETRY_LIMIT;

export type LiveMapDocumentIdentityAppliedClaim = Readonly<{
  path: LiveMapDocumentPath;
  quid: string;
}>;

/** Opaque commit-scoped local Mirror reservation. */
export type LiveMapDocumentIdentityCommitReservation = Readonly<{
  readonly applied: boolean;
  apply: () => readonly LiveMapDocumentIdentityAppliedClaim[];
  /** Undo claims installed for an observer path that did not complete. */
  rollback: () => void;
  release: () => void;
}>;

/** One active local projection participant; never serialized or exposed publicly. */
export type LiveMapDocumentIdentityParticipant = Readonly<{
  preflight: (operations: readonly LiveMapGraphOp[]) => LiveMapDocumentIdentityCommitReservation;
  preflightLocalIdentity: (path: LiveMapDocumentPath, quid: string) => LiveMapDocumentIdentityCommitReservation;
  verifyExisting: (path: LiveMapDocumentPath, quid: string) => void;
  realize: (path: LiveMapDocumentPath) => void;
}>;

/** Retryable local namespace conflict found before canonical acceptance. */
export class LiveMapDocumentIdentityParticipantCollisionError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LiveMapDocumentIdentityParticipantCollisionError";
  }
}

type LiveMapDocumentIdentityAuthority = LiveMapDocumentMutationController & Readonly<{
  identityEpoch: LiveMapIdentityEpochController;
}>;

const authorityForOwner = new WeakMap<object, LiveMapDocumentIdentityAuthority>();
const participantForAuthority = new WeakMap<object, LiveMapDocumentIdentityParticipant>();
const reservedForAuthority = new WeakMap<object, Set<string>>();
const reservationForCandidate = new WeakMap<object, LiveMapDocumentIdentityCommitReservation>();
const reservationForCommit = new WeakMap<LiveMapGraphCommit<LiveMapGraphOp>, LiveMapDocumentIdentityCommitReservation>();

/** Register the internal map authority behind one frozen document façade. */
export function register_livemap_document_identity_authority(
  owner: object,
  controller: LiveMapDocumentIdentityAuthority,
): void {
  authorityForOwner.set(owner, controller);
  reservedForAuthority.set(controller, new Set());
}

/** Attach the sole active local Mirror participant. */
export function register_livemap_document_identity_participant(
  owner: object,
  participant: LiveMapDocumentIdentityParticipant,
): () => void {
  const authority = require_authority(owner);
  const current = participantForAuthority.get(authority);
  if (current !== undefined && current !== participant) {
    throw new LiveMapDocumentIdentityRegistrationError(
      "LIVEMAP_IDENTITY_PARTICIPANT_REQUIRED",
      "LiveMap document identity already has an active local projection participant.",
    );
  }
  participantForAuthority.set(authority, participant);
  return () => {
    if (participantForAuthority.get(authority) === participant) {
      participantForAuthority.delete(authority);
    }
  };
}

/** Narrow deterministic allocator seam for authoritative tests only. @internal */
export function set_livemap_document_quid_candidate_source_for_tests(
  owner: object,
  source: (() => string) | undefined,
): void {
  const authority = require_authority(owner);
  set_livemap_quid_candidate_source_for_tests(authority, source);
}

/** Authority-owned acquisition for the internal map-local capability. */
export function ensure_livemap_document_canonical_identity(
  owner: object,
  target: LiveMapDocumentCommitTarget,
): string {
  return acquire_livemap_document_canonical_identity(owner, target, false);
}

/** Authority-owned acquisition used by linked LiveTree delegation. */
export function require_livemap_document_canonical_identity(
  owner: object,
  target: LiveMapDocumentCommitTarget,
): string {
  return acquire_livemap_document_canonical_identity(owner, target, true);
}

function acquire_livemap_document_canonical_identity(
  owner: object,
  target: LiveMapDocumentCommitTarget,
  requireParticipant: boolean,
): string {
  const authority = require_authority(owner);
  const participant = participantForAuthority.get(authority);
  if (requireParticipant && participant === undefined) {
    throw new LiveMapDocumentIdentityRegistrationError(
      "LIVEMAP_IDENTITY_PARTICIPANT_REQUIRED",
      "Linked identity acquisition requires one active local Mirror participant.",
    );
  }
  const endpoint = resolve_document_path(authority.root(), authority.mode, target.path);
  if (!is_ordinary_element_node(endpoint)) {
    throw new LiveMapDocumentMutationError(
      "DOCUMENT_IDENTITY_INELIGIBLE",
      "ensure-quid",
      "target must resolve to an eligible ordinary document element",
    );
  }
  const overlay = authority.overlay();
  const metadata = read_hson_node_quid(endpoint);
  const existing = overlay.quidAtPath(target.path);
  const indexedPath = existing === undefined ? undefined : overlay.pathForQuid(existing);
  if ((metadata !== undefined && metadata !== existing)
    || (existing !== undefined
      && (indexedPath === undefined || !document_path_equal(indexedPath, target.path)))) {
    throw new LiveMapDocumentMutationError(
      "INVALID_DOCUMENT_IDENTITY",
      "ensure-quid",
      "document identity metadata and runtime overlay disagree",
    );
  }
  if (existing !== undefined) {
    participant?.verifyExisting(target.path, existing);
    return existing;
  }

  const reserved = reservedForAuthority.get(authority) ?? new Set<string>();
  reservedForAuthority.set(authority, reserved);
  const allocated = allocate_livemap_quid(
    authority,
    (candidateQuid) => reserved.has(candidateQuid)
      || authority.identityEpoch.issued().has(candidateQuid)
      || authority.overlay().pathForQuid(candidateQuid) !== undefined,
    (candidateQuid) => {
    const runtimeParticipant: LiveMapRuntimeIdentityParticipant | undefined = participant === undefined
      ? undefined
      : Object.freeze({
        preflight: () => participant.preflightLocalIdentity(target.path, candidateQuid),
        realize: () => {
          participant.realize(target.path);
          participant.verifyExisting(target.path, candidateQuid);
        },
        rollbackRealization: () => participant.realize(target.path),
      });
    reserved.add(candidateQuid);
    try {
      authority.acquireLocalIdentity(target.path, candidateQuid, runtimeParticipant);
      return Object.freeze({ claimed: true, value: candidateQuid });
    } catch (cause) {
      if (cause instanceof LiveMapDocumentIdentityParticipantCollisionError) return Object.freeze({ claimed: false });
      throw cause;
    } finally {
      reserved.delete(candidateQuid);
    }
  });
  if (allocated !== undefined) return allocated;
  throw new LiveMapDocumentIdentityRegistrationError(
    "LIVEMAP_IDENTITY_ALLOCATOR_EXHAUSTED",
    `LiveMap could not allocate an available document QUID after ${LIVEMAP_DOCUMENT_QUID_MINT_RETRY_LIMIT} secure attempts.`,
  );
}

/** Transfer a candidate's preflight reservation to its exact accepted commit. */
export function register_livemap_document_identity_candidate_commit(
  candidate: PreparedDocumentMutation,
  commit: LiveMapGraphCommit<LiveMapGraphOp>,
): void {
  const reservation = reservationForCandidate.get(candidate);
  if (reservation !== undefined) reservationForCommit.set(commit, reservation);
}

/** Preflight a replay's complete staged operation sequence before publication. */
export function preflight_livemap_document_identity_replay(
  authority: object,
  commit: LiveMapGraphCommit<LiveMapGraphOp>,
): LiveMapDocumentIdentityCommitReservation | undefined {
  if (!commit.ops.some((operation) => operation.op === "ensure-quid")) return undefined;
  const participant = participantForAuthority.get(authority);
  if (participant === undefined) return undefined;
  const reservation = participant.preflight(commit.ops);
  reservationForCommit.set(commit, reservation);
  return reservation;
}

/** Resolve the exact preflight evidence for Mirror's synchronous observer. */
export function livemap_document_identity_reservation_for(
  commit: LiveMapGraphCommit<LiveMapGraphOp>,
): LiveMapDocumentIdentityCommitReservation | undefined {
  return reservationForCommit.get(commit);
}

function require_authority(owner: object): LiveMapDocumentIdentityAuthority {
  const authority = authorityForOwner.get(owner);
  if (authority !== undefined) return authority;
  throw new LiveMapDocumentIdentityRegistrationError(
    "LIVEMAP_IDENTITY_PARTICIPANT_REQUIRED",
    "LiveMap document façade has no registered identity authority.",
  );
}
