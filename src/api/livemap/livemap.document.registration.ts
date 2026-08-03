import { is_ordinary_element_node } from "../../core/node-guards.js";
import {
  is_persisted_quid,
  mint_hson_node_quid,
  read_hson_node_quid,
} from "../../core/hson-node-quid.js";
import type {
  LiveMapDocumentCommitTarget,
  LiveMapDocumentPath,
  LiveMapGraphCommit,
  LiveMapGraphEnsureQuidOp,
  LiveMapGraphOp,
} from "../../types/livemap.types.js";
import {
  LiveMapDocumentIdentityRegistrationError,
  LiveMapDocumentMutationError,
} from "./livemap.error.js";
import { document_path_equal, resolve_document_path } from "./livemap.document.path.js";
import {
  prepare_ensure_document_quid,
  type LiveMapDocumentMutationController,
  type PreparedDocumentMutation,
} from "./livemap.document.mutation.js";

export const LIVEMAP_DOCUMENT_QUID_MINT_RETRY_LIMIT = 32;

export type LiveMapDocumentIdentityAppliedClaim = Readonly<{
  path: LiveMapDocumentPath;
  quid: string;
}>;

/** Opaque commit-scoped local Reflection reservation. */
export type LiveMapDocumentIdentityCommitReservation = Readonly<{
  readonly applied: boolean;
  apply: () => readonly LiveMapDocumentIdentityAppliedClaim[];
  release: () => void;
}>;

/** One active local projection participant; never serialized or exposed publicly. */
export type LiveMapDocumentIdentityParticipant = Readonly<{
  preflight: (operations: readonly LiveMapGraphOp[]) => LiveMapDocumentIdentityCommitReservation;
  verifyExisting: (path: LiveMapDocumentPath, quid: string) => void;
}>;

/** Retryable local namespace conflict found before canonical acceptance. */
export class LiveMapDocumentIdentityParticipantCollisionError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LiveMapDocumentIdentityParticipantCollisionError";
  }
}

type CandidateSource = () => string;

const authorityForOwner = new WeakMap<object, LiveMapDocumentMutationController>();
const participantForAuthority = new WeakMap<object, LiveMapDocumentIdentityParticipant>();
const candidateSourceForAuthority = new WeakMap<object, CandidateSource>();
const reservedForAuthority = new WeakMap<object, Set<string>>();
const reservationForCandidate = new WeakMap<object, LiveMapDocumentIdentityCommitReservation>();
const reservationForCommit = new WeakMap<LiveMapGraphCommit, LiveMapDocumentIdentityCommitReservation>();

/** Register the internal map authority behind one frozen document façade. */
export function register_livemap_document_identity_authority(
  owner: object,
  controller: LiveMapDocumentMutationController,
): void {
  authorityForOwner.set(owner, controller);
  reservedForAuthority.set(controller, new Set());
}

/** Attach the sole active local Reflection participant. */
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
  source: CandidateSource | undefined,
): void {
  const authority = require_authority(owner);
  if (source === undefined) candidateSourceForAuthority.delete(authority);
  else candidateSourceForAuthority.set(authority, source);
}

/** Authority-owned explicit acquisition for the public map-local capability. */
export function ensure_livemap_document_canonical_identity(
  owner: object,
  target: LiveMapDocumentCommitTarget,
): string {
  return acquire_livemap_document_canonical_identity(owner, target, false);
}

/** Authority-owned explicit acquisition used by linked LiveTree delegation. */
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
      "Linked identity acquisition requires one active local Reflection participant.",
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
  const existing = read_hson_node_quid(endpoint);
  const indexed = overlay.quidAtPath(target.path);
  const indexedPath = existing === undefined ? undefined : overlay.pathForQuid(existing);
  if (existing !== indexed
    || (existing !== undefined
      && (indexedPath === undefined || !document_path_equal(indexedPath, target.path)))) {
    throw new LiveMapDocumentMutationError(
      "INVALID_DOCUMENT_IDENTITY",
      "ensure-quid",
      "canonical graph and sparse identity overlay disagree",
    );
  }
  if (existing !== undefined) {
    participant?.verifyExisting(target.path, existing);
    return existing;
  }

  const source = candidateSourceForAuthority.get(authority) ?? mint_hson_node_quid;
  const reserved = reservedForAuthority.get(authority) ?? new Set<string>();
  reservedForAuthority.set(authority, reserved);
  for (let attempt = 0; attempt < LIVEMAP_DOCUMENT_QUID_MINT_RETRY_LIMIT; attempt += 1) {
    const candidateQuid = source();
    if (!is_persisted_quid(candidateQuid)
      || reserved.has(candidateQuid)
      || authority.overlay().pathForQuid(candidateQuid) !== undefined) continue;

    let prepared: PreparedDocumentMutation<LiveMapGraphEnsureQuidOp>;
    let reservation: LiveMapDocumentIdentityCommitReservation | undefined;
    try {
      prepared = prepare_ensure_document_quid(
        authority.root(),
        authority.mode,
        authority.overlay(),
        target,
        candidateQuid,
      );
      reservation = participant?.preflight(Object.freeze([prepared.operation]));
    } catch (cause) {
      if (cause instanceof LiveMapDocumentIdentityParticipantCollisionError) continue;
      throw cause;
    }

    reserved.add(candidateQuid);
    if (reservation !== undefined) reservationForCandidate.set(prepared, reservation);
    try {
      const commit = authority.applyMutation(prepared);
      if (!commit.changed || commit.ops[0]?.op !== "ensure-quid") {
        throw new LiveMapDocumentIdentityRegistrationError(
          "LIVEMAP_IDENTITY_PROJECTION_NOT_APPLIED",
          "Canonical identity acquisition did not publish its registration operation.",
        );
      }
      if (reservation !== undefined && !reservation.applied) {
        throw new LiveMapDocumentIdentityRegistrationError(
          "LIVEMAP_IDENTITY_PROJECTION_NOT_APPLIED",
          "Canonical identity committed, but the local projection did not install the supplied claim.",
        );
      }
      participant?.verifyExisting(target.path, candidateQuid);
      return candidateQuid;
    } finally {
      reservation?.release();
      reserved.delete(candidateQuid);
    }
  }
  throw new LiveMapDocumentIdentityRegistrationError(
    "LIVEMAP_IDENTITY_ALLOCATOR_EXHAUSTED",
    `LiveMap could not allocate an available document QUID after ${LIVEMAP_DOCUMENT_QUID_MINT_RETRY_LIMIT} secure attempts.`,
  );
}

/** Transfer a candidate's preflight reservation to its exact accepted commit. */
export function register_livemap_document_identity_candidate_commit(
  candidate: PreparedDocumentMutation,
  commit: LiveMapGraphCommit,
): void {
  const reservation = reservationForCandidate.get(candidate);
  if (reservation !== undefined) reservationForCommit.set(commit, reservation);
}

/** Preflight a replay's complete staged operation sequence before publication. */
export function preflight_livemap_document_identity_replay(
  authority: object,
  commit: LiveMapGraphCommit,
): LiveMapDocumentIdentityCommitReservation | undefined {
  if (!commit.ops.some((operation) => operation.op === "ensure-quid")) return undefined;
  const participant = participantForAuthority.get(authority);
  if (participant === undefined) return undefined;
  const reservation = participant.preflight(commit.ops);
  reservationForCommit.set(commit, reservation);
  return reservation;
}

/** Resolve the exact preflight evidence for Reflection's synchronous observer. */
export function livemap_document_identity_reservation_for(
  commit: LiveMapGraphCommit,
): LiveMapDocumentIdentityCommitReservation | undefined {
  return reservationForCommit.get(commit);
}

function require_authority(owner: object): LiveMapDocumentMutationController {
  const authority = authorityForOwner.get(owner);
  if (authority !== undefined) return authority;
  throw new LiveMapDocumentIdentityRegistrationError(
    "LIVEMAP_IDENTITY_PARTICIPANT_REQUIRED",
    "LiveMap document façade has no registered identity authority.",
  );
}
