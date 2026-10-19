import { INTERACTION_RESERVED_LIBRARY_KEY } from "../../internal/interaction-storage.js";
import type { LiveMap } from "../../types/livemap.types.js";
import type { PreparedLiveMapAuthorityTransition } from "../livemap/livemap.authority.js";
import { internal_livemap_aggregate_authority } from "../livemap/livemap.internal.js";
import { encode_authoritative_scoped_commit } from "../livemap/livemap.hosted.js";
import type { LocusEffectiveProjection } from "./locus.projection.js";
import { projected_registry_digest, project_locus_live_transition_internal } from "./locus.live-projection.js";

/** Private producer shape, deliberately absent from public protocol unions.
 * The containing authority/registry/revision is the only ordering boundary.
 * Library-local ordinals describe operation order, never receipt authority. @internal */
export type LocusPreparedScopedOperation = import("../livemap/livemap.hosted.js").PrivateScopedAggregateOperation;

/** Prepare from the actual pending transition, never from later Library state.
 * The receiver consumes this complete private evidence under its existing Echo
 * authority position. No checkpoint format or public delivery is enabled.
 * The caller must retain the existing reservation through durable acceptance. @internal */
export function prepare_locus_scoped_commit_internal(map: LiveMap,
  transition: PreparedLiveMapAuthorityTransition, effective?: LocusEffectiveProjection) {
  const aggregate = internal_livemap_aggregate_authority(map);
  aggregate.assertPrepared(transition);
  const commit = transition.commit.hosted, position = aggregate.hostedPosition();
  if (commit === undefined || commit.prevRev !== position.revision || commit.rev !== commit.prevRev + 1
    || commit.registryDigest !== position.registryDigest
    || commit.authority.logicalMapId !== position.authority.logicalMapId
    || commit.authority.incarnationId !== position.authority.incarnationId) {
    throw new Error("Scoped preparation requires the current authoritative commit position.");
  }
  if (effective !== undefined && (effective.authority.logicalMapId !== commit.authority.logicalMapId
    || effective.authority.incarnationId !== commit.authority.incarnationId)) {
    throw new Error("Scoped projection belongs to another authority.");
  }
  if (effective === undefined) {
    const encoded = encode_authoritative_scoped_commit(commit);
    aggregate.assertPrepared(transition);
    return encoded;
  }
  const projected = project_locus_live_transition_internal(commit, effective,
    aggregate.systemState(INTERACTION_RESERVED_LIBRARY_KEY) === undefined ? undefined : aggregate.systemRoot(aggregate.systemState(INTERACTION_RESERVED_LIBRARY_KEY)!),
    aggregate.preparedSystemRoot(transition));
  const operations = projected.kind === "commit" ? projected.commit.operations : [];
  aggregate.assertPrepared(transition);
  return Object.freeze({ authority: commit.authority, registryDigest: projected_registry_digest(effective),
    prevRev: commit.prevRev, rev: commit.rev, operationCount: operations.length, operations: Object.freeze(operations) });
}
