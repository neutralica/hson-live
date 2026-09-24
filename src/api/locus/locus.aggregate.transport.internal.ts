import type { LocusActionPayloads } from "../../types/locus.types.js";
import type { AuthorityProjectionSnapshot } from "../../types/locus.projection.types.js";
import type { LocusLiveProjectedWireEnvelope } from "./locus.live-projection.js";
import type {
  LocusDownstreamSink,
  LocusFiniteOperationRequest,
  LocusSemanticAttachment,
} from "./locus.transport.internal.js";

export type LocusHostedAggregateRecoveryCursor = Readonly<{
  incarnationId: string;
  registryDigest: string;
  projectionDigest: string;
  lastAppliedRev: number;
}>;

/** @internal Aggregate topology evidence layered over the common synchronization lifecycle. */
export type LocusHostedAggregateSynchronizationRequest = Readonly<{
  type: "recover";
  id: string;
  logicalMapId: string;
  cursor?: LocusHostedAggregateRecoveryCursor;
}>;

type PlanOutcome = "current" | "replay" | "snapshot" | "reject";
type SnapshotReason = "no_usable_revision" | "incarnation_mismatch" | "registry_mismatch" | "history_unavailable";

/** One ordered authority revision with no graph effect for this replica. */
export type LocusHostedAggregateProgress = Readonly<{
  logicalMapId: string;
  incarnationId: string;
  registryDigest: string;
  prevRev: number;
  rev: number;
}>;

export type LocusHostedAggregateSynchronizationOutput =
  | Readonly<{ type: "recovery-plan"; id: string; logicalMapId: string; incarnationId: string; registryDigest: string; projectionDigest: string; headRev: number; outcome: Exclude<PlanOutcome, "reject">; reason?: SnapshotReason }>
  | Readonly<{ type: "recovery-plan"; id: string; logicalMapId: string; incarnationId: string; registryDigest: string; projectionDigest: string; headRev: number; outcome: "reject"; error: Readonly<{ code?: string; message: string }> }>
  | Readonly<{ type: "recovery-snapshot"; id: string; snapshot: AuthorityProjectionSnapshot }>
  | Readonly<{ type: "recovery-commit"; id: string; phase: "body" | "tail"; commit: LocusLiveProjectedWireEnvelope }>
  | Readonly<{ type: "recovery-progress"; id: string; phase: "body" | "tail"; progress: LocusHostedAggregateProgress }>
  | Readonly<{ type: "recovery-caught-up"; id: string; logicalMapId: string; incarnationId: string; registryDigest: string; projectionDigest: string; throughRev: number }>
  | Readonly<{ type: "synchronization-failure"; error: Readonly<{ code?: string; message: string; cause?: unknown }> }>;

export type LocusHostedAggregateCanonicalPublication =
  | Readonly<{ type: "commit"; id: string; commit: LocusLiveProjectedWireEnvelope }>
  | Readonly<{ type: "progress"; id: string; progress: LocusHostedAggregateProgress }>;

export type LocusHostedAggregateDownstreamSink = LocusDownstreamSink<
  LocusHostedAggregateSynchronizationOutput,
  LocusHostedAggregateCanonicalPublication
>;

/** @internal Common semantic attachment specialized only by aggregate recovery evidence. */
export type LocusHostedAggregateSemanticAttachment<
  TActions extends LocusActionPayloads = LocusActionPayloads,
> = LocusSemanticAttachment<TActions, LocusHostedAggregateSynchronizationRequest>;

export type LocusHostedAggregateFiniteOperationRequest<
  TActions extends LocusActionPayloads = LocusActionPayloads,
> = LocusFiniteOperationRequest<TActions>;
