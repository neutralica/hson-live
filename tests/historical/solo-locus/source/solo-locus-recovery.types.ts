import type { LocusCanonicalCommit, LocusSnapshotEnvelope } from "./solo-locus-representation.types.js";
import type { LocusRecoveryCaughtUp, LocusRecoveryRejectCode, LocusRecoveryRejection, LocusRecoverySnapshotReason } from "./solo-locus-protocol.types.js";
import type { LocusDisposer, LocusIncarnationId, LocusLogicalMapId } from "../../src/types/locus.shared.types.js";

/** Wire-safe representation of a data value that may be absent. */
export type LocusRecoveryRequest = Readonly<{
  logicalMapId: LocusLogicalMapId;
  incarnationId?: LocusIncarnationId;
  lastAppliedRev?: number;
}>;

export type LocusRecoveryOptions = Readonly<{
  maxTailCommits?: number;
  maxTailBytes?: number;
}>;

/** Deterministic planning barriers for race-focused tests and diagnostics. */
export type LocusRecoveryHooks = Readonly<{
  beforeCut?: () => void;
  duringSnapshotCapture?: () => void;
  afterCut?: (headRev: number) => void;
}>;

export type LocusRecoveryRuntimeErrorCode =
  | "LOCUS_RECOVERY_TAIL_OVERFLOW"
  | "LOCUS_RECOVERY_TAIL_GAP"
  | "LOCUS_RECOVERY_DISPOSED"
  | "LOCUS_RECOVERY_COMPLETED"
  | "LOCUS_RECOVERY_SNAPSHOT_FAILED"
  | "LOCUS_RECOVERY_REPLAY_FAILED"
  | "LOCUS_RECOVERY_OBSERVER_FAILED"
  | "LOCUS_RECOVERY_NEGOTIATION_FAILED"
  | "LOCUS_RECOVERY_PLANNING_FAILED";

export type LocusRecoveryBodyItem =
  | Readonly<{ kind: "commit"; commit: LocusCanonicalCommit }>
  | Readonly<{ kind: "snapshot"; snapshot: LocusSnapshotEnvelope }>;

export type LocusRecoveryBodyObserver = (item: LocusRecoveryBodyItem) => void;

export type LocusRecoveryCompletion = Readonly<{
  caughtUp: LocusRecoveryCaughtUp;
  tail: readonly LocusCanonicalCommit[];
}>;

export type LocusRecoveryAttemptState = "active" | "completed" | "disposed" | "aborted";

export type LocusRecoveryAttemptDiagnostics = Readonly<{
  state: LocusRecoveryAttemptState;
  outcome: "current" | "replay" | "snapshot";
  headRev: number;
  queuedTailCommits: number;
  queuedTailBytes: number;
  maxTailCommits: number;
  maxTailBytes: number;
  errorCode?: LocusRecoveryRuntimeErrorCode;
}>;

export type LocusRecoveryAttemptBase = Readonly<{
  logicalMapId: LocusLogicalMapId;
  incarnationId: LocusIncarnationId;
  headRev: number;
  complete: (observer?: LocusRecoveryBodyObserver) => LocusRecoveryCompletion;
  dispose: LocusDisposer;
  debug: () => LocusRecoveryAttemptDiagnostics;
}>;

export type LocusRecoveryCurrentPlan = LocusRecoveryAttemptBase & Readonly<{
  outcome: "current";
  body: readonly [];
}>;

export type LocusRecoveryReplayPlan = LocusRecoveryAttemptBase & Readonly<{
  outcome: "replay";
  body: readonly LocusCanonicalCommit[];
}>;

export type LocusRecoverySnapshotPlan = LocusRecoveryAttemptBase & Readonly<{
  outcome: "snapshot";
  reason: LocusRecoverySnapshotReason;
  body: LocusSnapshotEnvelope;
}>;

export type LocusRecoveryRejectPlan = Readonly<{
  outcome: "reject";
  error: LocusRecoveryRejection;
}>;

export type LocusRecoveryPlan =
  | LocusRecoveryCurrentPlan
  | LocusRecoveryReplayPlan
  | LocusRecoverySnapshotPlan
  | LocusRecoveryRejectPlan;

export type LocusRecoveryPlannerDiagnostics = Readonly<{
  activeAttemptCount: number;
  currentPlanCount: number;
  replayPlanCount: number;
  snapshotPlanCount: number;
  rejectPlanCount: number;
  completedAttemptCount: number;
  disposedAttemptCount: number;
  abortedAttemptCount: number;
  overflowCount: number;
}>;

export type LocusRecoveryPlanner = Readonly<{
  plan: (request: LocusRecoveryRequest, hooks?: LocusRecoveryHooks) => LocusRecoveryPlan;
  debug: () => LocusRecoveryPlannerDiagnostics;
  dispose: LocusDisposer;
}>;
