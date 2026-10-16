import { INTERACTION_RESERVED_LIBRARY_KEY } from "../../internal/interaction-storage.js";
import type { LiveMap } from "../../types/livemap.types.js";
import type { PreparedLiveMapAuthorityTransition } from "../livemap/livemap.authority.js";
import { internal_livemap_aggregate_authority } from "../livemap/livemap.internal.js";
import { make_portable_aggregate_commit, type PortableAggregateOperation } from "../livemap/livemap.hosted.js";
import type { DocumentScopedEffect } from "../livemap/livemap.document.scoped-effects.js";
import type { LocusEffectiveProjection } from "./locus.projection.js";
import { projected_registry_digest, project_locus_live_transition_internal } from "./locus.live-projection.js";

/** Private producer shape, deliberately absent from public protocol unions.
 * The containing authority/registry/revision is the only ordering boundary.
 * Library-local ordinals describe operation order, never receipt authority. @internal */
export type LocusPreparedScopedOperation = PortableAggregateOperation | Readonly<{
  library: string;
  domain: "document";
  effect: DocumentScopedEffect;
}>;

/** Prepare from the actual pending transition, never from later Library state.
 * No decoder, receiver authority, checkpoint format or public delivery is enabled.
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
  const indices = commit.replay.operations.flatMap((entry, index) => entry.scoped === undefined ? [index] : []);
  const ordinary = Object.freeze({ ...commit,
    operations: Object.freeze(indices.map(index => commit.operations[index]!)),
    replay: Object.freeze({ operations: Object.freeze(indices.map(index => commit.replay.operations[index]!)) }),
  });
  // Existing feature grants and interaction filtering remain authoritative.
  const ordinaryProjection = effective === undefined ? undefined : project_locus_live_transition_internal(ordinary, effective,
    aggregate.systemState(INTERACTION_RESERVED_LIBRARY_KEY) === undefined ? undefined : aggregate.systemRoot(aggregate.systemState(INTERACTION_RESERVED_LIBRARY_KEY)!),
    aggregate.preparedSystemRoot(transition));
  const ordinaryOperations = effective === undefined ? make_portable_aggregate_commit(ordinary)?.operations ?? []
    : ordinaryProjection?.kind === "commit" ? ordinaryProjection.commit.operations : [];
  const operations: LocusPreparedScopedOperation[] = [];
  let ordinaryIndex = 0;
  for (let index = 0; index < commit.replay.operations.length; index++) {
    const entry = commit.replay.operations[index]!;
    if (entry.scoped !== undefined) {
      if (effective === undefined || effective.includesLibrary(entry.library)) {
        operations.push(Object.freeze({ library: entry.library, domain: "document", effect: entry.scoped }));
      }
    } else {
      const semantic = commit.operations[index]!.operation;
      if ("domain" in semantic && semantic.domain === "graph" && semantic.op === "ensure-quid") continue;
      if (effective !== undefined && (entry.library === INTERACTION_RESERVED_LIBRARY_KEY || !effective.includesLibrary(entry.library))) continue;
      const operation = ordinaryOperations[ordinaryIndex++];
      if (operation === undefined || operation.library !== entry.library) throw new Error("Incomplete projected operation order.");
      operations.push(operation);
    }
  }
  operations.push(...ordinaryOperations.slice(ordinaryIndex));
  aggregate.assertPrepared(transition);
  return Object.freeze({ authority: commit.authority,
    registryDigest: effective === undefined ? commit.registryDigest : projected_registry_digest(effective),
    prevRev: commit.prevRev, rev: commit.rev, operations: Object.freeze(operations) });
}
