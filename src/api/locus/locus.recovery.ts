// locus.recovery.ts

import type { DocumentLiveMapCapture, LiveMapAuthority } from "../../types/livemap.types.js";
import { is_Node } from "../../core/node-guards.js";
import type {
  LocusCanonicalCommit,
  LocusCanonicalStream,
  LocusDisposer,
  LocusRecoveryAttemptDiagnostics,
  LocusRecoveryAttemptState,
  LocusRecoveryBodyItem,
  LocusRecoveryBodyObserver,
  LocusRecoveryCompletion,
  LocusRecoveryCurrentPlan,
  LocusRecoveryHooks,
  LocusRecoveryOptions,
  LocusRecoveryPlan,
  LocusRecoveryPlanner,
  LocusRecoveryPlannerDiagnostics,
  LocusRecoveryRejectCode,
  LocusRecoveryRejectPlan,
  LocusRecoveryReplayPlan,
  LocusRecoveryRequest,
  LocusRecoveryRuntimeErrorCode,
  LocusRecoverySnapshotPlan,
  LocusRecoverySnapshotReason,
  LocusSnapshotEnvelope,
  LiveTraceSink,
} from "../../types/locus.types.js";
import { LocusRecoveryError } from "./locus.error.js";
import { create_live_trace_context, type LiveTraceContext } from "./locus.trace.js";
import {
  encode_locus_document_snapshot,
  type LocusDocumentSnapshotEncoding,
  type LocusOutboundDocumentSnapshotEnvelope,
} from "./locus.document-snapshot.js";
import { serialize_hson } from "../transform/serializers/serialize-hson.js";
import { detach_hson_root_value } from "../transform/utils/node-utils/detach-hson-root-value.js";

const DEFAULT_MAX_TAIL_COMMITS = 256;
const DEFAULT_MAX_TAIL_BYTES = 1 * 1_024 * 1_024;
const EMPTY_BODY: readonly [] = Object.freeze([]);
const textEncoder = new TextEncoder();

function must_bound(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (Number.isFinite(value) && value >= 0) return Math.trunc(value);
  throw new Error(`Locus recovery ${name} must be a finite non-negative number.`);
}

function is_document_capture(value: unknown): value is DocumentLiveMapCapture {
  return typeof value === "object"
    && value !== null
    && "kind" in value
    && value.kind === "hson-document"
    && !("version" in value)
    && "mode" in value
    && (value.mode === "element" || value.mode === "fragment")
    && "rev" in value
    && typeof value.rev === "number"
    && "root" in value
    && is_Node(value.root);
}

function encoded_bytes(value: unknown): number {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Locus recovery value is not JSON-encodable.");
  return textEncoder.encode(encoded).byteLength;
}

function runtime_error(
  code: LocusRecoveryRuntimeErrorCode,
  message: string,
  cause?: unknown,
): LocusRecoveryError {
  return new LocusRecoveryError(code, message, cause);
}

type TracedLocusRecoveryPlanner = LocusRecoveryPlanner & Readonly<{
  plan_traced: (
    request: LocusRecoveryRequest,
    trace: LiveTraceContext,
    correlation?: Readonly<{ requestId?: string }>,
    hooks?: LocusRecoveryHooks,
  ) => LocusRecoveryPlan;
  plan_with_snapshot_encoding: (
    request: LocusRecoveryRequest,
    encoding: LocusDocumentSnapshotEncoding,
    hooks?: LocusRecoveryHooks,
  ) => LocusRecoveryPlan;
  plan_traced_with_snapshot_encoding: (
    request: LocusRecoveryRequest,
    encoding: LocusDocumentSnapshotEncoding,
    trace: LiveTraceContext,
    correlation?: Readonly<{ requestId?: string }>,
    hooks?: LocusRecoveryHooks,
  ) => LocusRecoveryPlan;
}>;

const HSON_SNAPSHOT_ENCODING: LocusDocumentSnapshotEncoding = Object.freeze({ format: "hson" });

/** Keep the public planner and connection-selected snapshot body on one current envelope. */
function recovery_plan_snapshot_view(
  snapshot: LocusOutboundDocumentSnapshotEnvelope,
): LocusSnapshotEnvelope {
  return snapshot;
}

/**
 * Create the Locus-side recovery planner for one canonical LiveMap stream.
 * The planner produces recovery material directly and has no transport role.
 */
export function make_locus_recovery_planner<TMap extends LiveMapAuthority>(
  map: TMap,
  stream: LocusCanonicalStream<TMap>,
  options: LocusRecoveryOptions = {},
  traceSink?: LiveTraceSink,
): TracedLocusRecoveryPlanner {
  return make_locus_recovery_planner_internal(map, stream, options, traceSink);
}

/** @internal Construct the real planner with connection-selected snapshot planning support. */
export function make_locus_recovery_planner_internal<TMap extends LiveMapAuthority>(
  map: TMap,
  stream: LocusCanonicalStream<TMap>,
  options: LocusRecoveryOptions,
  traceSink: LiveTraceSink | undefined,
  activity?: (active: boolean) => void,
): TracedLocusRecoveryPlanner {
  const maxTailCommits = must_bound(options.maxTailCommits, DEFAULT_MAX_TAIL_COMMITS, "maxTailCommits");
  const maxTailBytes = must_bound(options.maxTailBytes, DEFAULT_MAX_TAIL_BYTES, "maxTailBytes");
  let activeAttemptCount = 0;
  let currentPlanCount = 0;
  let replayPlanCount = 0;
  let snapshotPlanCount = 0;
  let rejectPlanCount = 0;
  let completedAttemptCount = 0;
  let disposedAttemptCount = 0;
  let abortedAttemptCount = 0;
  let overflowCount = 0;
  let traceAttemptCount = 0;
  const activeAttemptDisposers = new Set<LocusDisposer>();
  let disposed = false;

  function reject(code: LocusRecoveryRejectCode, message: string): LocusRecoveryRejectPlan {
    rejectPlanCount += 1;
    return Object.freeze({
      outcome: "reject",
      error: Object.freeze({
        code,
        message,
        authoritativeRev: stream.headRev,
        incarnationId: stream.incarnationId,
      }),
    });
  }

  function plan(request: LocusRecoveryRequest, hooks: LocusRecoveryHooks = {}): LocusRecoveryPlan {
    if (traceSink === undefined) return plan_internal(request, hooks, undefined, undefined, HSON_SNAPSHOT_ENCODING);
    traceAttemptCount += 1;
    const trace = create_live_trace_context(
      traceSink,
      `locus-recovery-${stream.logicalMapId}-${traceAttemptCount}`,
    );
    return plan_internal(request, hooks, trace, undefined, HSON_SNAPSHOT_ENCODING);
  }

  function plan_internal(
    request: LocusRecoveryRequest,
    hooks: LocusRecoveryHooks,
    trace: LiveTraceContext | undefined,
    correlation: Readonly<{ requestId?: string }> | undefined,
    documentSnapshotEncoding: LocusDocumentSnapshotEncoding,
  ): LocusRecoveryPlan {
    if (disposed) {
      throw runtime_error("LOCUS_RECOVERY_DISPOSED", "Locus recovery planner is disposed.");
    }
    if (request.logicalMapId !== stream.logicalMapId) {
      const rejected = reject(
        "LOCUS_RECOVERY_INVALID_TARGET",
        `Unknown Locus logical map ID: ${request.logicalMapId}`,
      );
      trace_plan(trace, request, rejected, "invalid", correlation);
      return rejected;
    }

    if (
      request.lastAppliedRev !== undefined
      && (!Number.isInteger(request.lastAppliedRev) || request.lastAppliedRev < 0)
    ) {
      const rejected = reject(
        "LOCUS_RECOVERY_INVALID_REQUEST",
        "Locus recovery lastAppliedRev must be a non-negative integer.",
      );
      trace_plan(trace, request, rejected, "invalid", correlation);
      return rejected;
    }

    try {
      hooks.before_cut?.();
    } catch (cause) {
      abortedAttemptCount += 1;
      throw runtime_error(
        "LOCUS_RECOVERY_PLANNING_FAILED",
        "Locus recovery failed before establishing its cut.",
        cause,
      );
    }

    const preliminary: LocusCanonicalCommit[] = [];
    const tail: LocusCanonicalCommit[] = [];
    let tailBytes = 0;
    let cutRev: number | undefined;
    let state: LocusRecoveryAttemptState = "active";
    let attemptError: LocusRecoveryError | undefined;
    let stopSubscription: LocusDisposer = () => {};
    let released = false;

    function release_active_attempt(): void {
      if (released) return;
      released = true;
      activeAttemptCount -= 1;
      activeAttemptDisposers.delete(dispose);
      activity?.(false);
    }

    function clear_queues(): void {
      preliminary.length = 0;
      tail.length = 0;
      tailBytes = 0;
    }

    function abort(error: LocusRecoveryError): void {
      if (state !== "active") return;
      state = "aborted";
      attemptError = error;
      stopSubscription();
      clear_queues();
      release_active_attempt();
      abortedAttemptCount += 1;
      if (error.code === "LOCUS_RECOVERY_TAIL_OVERFLOW") overflowCount += 1;
    }

    function enqueue_tail(commit: LocusCanonicalCommit): void {
      if (state !== "active") return;
      if (cutRev === undefined) {
        preliminary.push(commit);
        return;
      }
      if (commit.rev <= cutRev) return;

      const expectedPrevRev = tail[tail.length - 1]?.rev ?? cutRev;
      if (commit.prevRev !== expectedPrevRev) {
        abort(runtime_error(
          "LOCUS_RECOVERY_TAIL_GAP",
          `Locus recovery tail expected prevRev ${expectedPrevRev}, received ${commit.prevRev}.`,
        ));
        return;
      }

      let commitBytes: number;
      try {
        commitBytes = encoded_bytes(commit);
      } catch (cause) {
        abort(runtime_error(
          "LOCUS_RECOVERY_PLANNING_FAILED",
          "Locus recovery could not encode a queued tail commit.",
          cause,
        ));
        return;
      }

      tail.push(commit);
      tailBytes += commitBytes;

      if (tail.length > maxTailCommits || tailBytes > maxTailBytes) {
        abort(runtime_error(
          "LOCUS_RECOVERY_TAIL_OVERFLOW",
          "Locus recovery tail exceeded its configured count or byte limit.",
        ));
      }
    }

    function establish_cut(headRev: number): void {
      cutRev = headRev;
      const observed = [...preliminary];
      preliminary.length = 0;
      for (const commit of observed) {
        if (commit.rev > headRev) enqueue_tail(commit);
      }
    }

    function throw_if_aborted(): void {
      if (attemptError) throw attemptError;
    }

    stopSubscription = stream.on_commit(enqueue_tail);
    activeAttemptCount += 1;
    activity?.(true);

    let outcome: "current" | "replay" | "snapshot";
    let headRev = stream.headRev;
    let replayBody: readonly LocusCanonicalCommit[] | undefined;
    let snapshotBody: LocusSnapshotEnvelope | undefined;
    let snapshotReason: LocusRecoverySnapshotReason | undefined;

    try {
      const sameIncarnation = request.incarnationId === stream.incarnationId;
      const usableRevision = sameIncarnation ? request.lastAppliedRev : undefined;

      if (sameIncarnation && usableRevision !== undefined && usableRevision > headRev) {
        stopSubscription();
        clear_queues();
        release_active_attempt();
        state = "disposed";
        const rejected = reject(
          "REVISION_AHEAD_OF_AUTHORITY",
          `Client revision ${usableRevision} is ahead of authoritative revision ${headRev}.`,
        );
        trace_plan(trace, request, rejected, "ahead", correlation);
        return rejected;
      }

      if (sameIncarnation && usableRevision === headRev) {
        outcome = "current";
        establish_cut(headRev);
      } else if (sameIncarnation && usableRevision !== undefined && usableRevision < headRev) {
        try {
          const retained = stream.history.replay_after(usableRevision, headRev);
          if (retained !== undefined && retained.length > 0) {
            replayBody = Object.freeze([...retained]);
            outcome = "replay";
            establish_cut(headRev);
          } else {
            outcome = "snapshot";
            snapshotReason = "history_unavailable";
          }
        } catch (cause) {
          throw runtime_error(
            "LOCUS_RECOVERY_REPLAY_FAILED",
            "Locus recovery could not prepare replay material.",
            cause,
          );
        }
      } else {
        outcome = "snapshot";
        snapshotReason = request.incarnationId === undefined
          ? "no_usable_revision"
          : "incarnation_mismatch";
      }

      if (outcome === "snapshot") {
        try {
          // This barrier runs inside the capture critical section while tail
          // observation is already active. A mutation here is either reflected
          // by capture.rev/value or retained after the resulting cut.
          hooks.during_snapshot_capture?.();
          const capture = map.capture();
          if (capture.rev !== stream.headRev) {
            throw new Error(
              `Locus recovery snapshot revision ${capture.rev} does not match stream head ${stream.headRev}.`,
            );
          }

          headRev = capture.rev;
          if (map.mode === "element" || map.mode === "fragment") {
            if (!is_document_capture(capture)) {
              throw new Error("Locus document capture has no canonical root.");
            }
            snapshotBody = recovery_plan_snapshot_view(encode_locus_document_snapshot(
              {
                logicalMapId: stream.logicalMapId,
                incarnationId: stream.incarnationId,
              },
              capture,
              documentSnapshotEncoding,
            ));
          } else {
            if (!("payload" in capture) || typeof capture.payload !== "string" || !("root" in capture) || !is_Node(capture.root)) {
              throw new Error("Locus recovery snapshot has no exact data graph.");
            }
            snapshotBody = Object.freeze({
              logicalMapId: stream.logicalMapId,
              incarnationId: stream.incarnationId,
              rev: capture.rev,
              mode: map.mode,
              hson: serialize_hson(
                detach_hson_root_value(capture.root),
                { noBreak: true },
              ),
            });
          }
          encoded_bytes(snapshotBody);
          establish_cut(headRev);
        } catch (cause) {
          if (cause instanceof LocusRecoveryError) throw cause;
          throw runtime_error(
            "LOCUS_RECOVERY_SNAPSHOT_FAILED",
            "Locus recovery could not capture a valid atomic snapshot.",
            cause,
          );
        }
      }

      hooks.after_cut?.(headRev);
      throw_if_aborted();
    } catch (cause) {
      const error = cause instanceof LocusRecoveryError
        ? cause
        : runtime_error(
          "LOCUS_RECOVERY_PLANNING_FAILED",
          "Locus recovery planning failed after tail registration.",
          cause,
        );
      abort(error);
      throw error;
    }

    function must_be_active(): void {
      if (state === "active") return;
      if (state === "aborted" && attemptError) throw attemptError;
      if (state === "completed") {
        throw runtime_error("LOCUS_RECOVERY_COMPLETED", "Locus recovery attempt is already completed.");
      }
      throw runtime_error("LOCUS_RECOVERY_DISPOSED", "Locus recovery attempt is disposed.");
    }

    function dispose(): void {
      if (state !== "active") return;
      state = "disposed";
      stopSubscription();
      clear_queues();
      release_active_attempt();
      disposedAttemptCount += 1;
    }

    function body_items(): readonly LocusRecoveryBodyItem[] {
      if (outcome === "current") return EMPTY_BODY;
      if (outcome === "snapshot" && snapshotBody) {
        return Object.freeze([Object.freeze({ kind: "snapshot", snapshot: snapshotBody })]);
      }
      if (outcome === "replay" && replayBody) {
        return Object.freeze(replayBody.map((commit) => Object.freeze({ kind: "commit", commit })));
      }
      throw runtime_error(
        "LOCUS_RECOVERY_PLANNING_FAILED",
        "Locus recovery attempt has incomplete body material.",
      );
    }

    const producedBody = body_items();

    function complete(observer: LocusRecoveryBodyObserver = () => {}): LocusRecoveryCompletion {
      must_be_active();

      try {
        for (const item of producedBody) {
          observer(item);
          must_be_active();
        }
      } catch (cause) {
        if (state === "aborted" && attemptError) throw attemptError;
        const error = runtime_error(
          "LOCUS_RECOVERY_OBSERVER_FAILED",
          "Locus recovery body observer failed.",
          cause,
        );
        abort(error);
        throw error;
      }

      must_be_active();
      stopSubscription();
      const completedTail = Object.freeze([...tail]);
      const throughRev = completedTail[completedTail.length - 1]?.rev ?? headRev;
      const caughtUp = Object.freeze({
        kind: "caught_up" as const,
        logicalMapId: stream.logicalMapId,
        incarnationId: stream.incarnationId,
        throughRev,
      });
      clear_queues();
      state = "completed";
      release_active_attempt();
      completedAttemptCount += 1;

      trace_material(trace, request, outcome, producedBody, completedTail, throughRev, snapshotBody, correlation);

      return Object.freeze({ caughtUp, tail: completedTail });
    }

    function debug(): LocusRecoveryAttemptDiagnostics {
      return Object.freeze({
        state,
        outcome,
        headRev,
        queuedTailCommits: tail.length,
        queuedTailBytes: tailBytes,
        maxTailCommits,
        maxTailBytes,
        ...(attemptError ? { errorCode: attemptError.code } : {}),
      });
    }

    const base = {
      logicalMapId: stream.logicalMapId,
      incarnationId: stream.incarnationId,
      headRev,
      complete,
      dispose,
      debug,
    };
    activeAttemptDisposers.add(dispose);

    if (outcome === "current") {
      currentPlanCount += 1;
      const currentPlan: LocusRecoveryCurrentPlan = Object.freeze({
        ...base,
        outcome: "current",
        body: EMPTY_BODY,
      });
      trace_plan(trace, request, currentPlan, "equal", correlation);
      return currentPlan;
    }

    if (outcome === "replay" && replayBody) {
      replayPlanCount += 1;
      const replayPlan: LocusRecoveryReplayPlan = Object.freeze({
        ...base,
        outcome: "replay",
        body: replayBody,
      });
      trace_plan(trace, request, replayPlan, "behind-with-history", correlation);
      return replayPlan;
    }

    if (outcome === "snapshot" && snapshotBody && snapshotReason) {
      snapshotPlanCount += 1;
      const snapshotPlan: LocusRecoverySnapshotPlan = Object.freeze({
        ...base,
        outcome: "snapshot",
        reason: snapshotReason,
        body: snapshotBody,
      });
      trace_plan(
        trace,
        request,
        snapshotPlan,
        snapshotReason === "incarnation_mismatch" ? "incarnation-mismatch" : "behind-before-history",
        correlation,
      );
      return snapshotPlan;
    }

    const error = runtime_error(
      "LOCUS_RECOVERY_PLANNING_FAILED",
      "Locus recovery planner produced an incomplete plan.",
    );
    abort(error);
    throw error;
  }

  function debug(): LocusRecoveryPlannerDiagnostics {
    return Object.freeze({
      activeAttemptCount,
      currentPlanCount,
      replayPlanCount,
      snapshotPlanCount,
      rejectPlanCount,
      completedAttemptCount,
      disposedAttemptCount,
      abortedAttemptCount,
      overflowCount,
    });
  }

  function dispose_planner(): void {
    if (disposed) return;
    disposed = true;
    for (const dispose of [...activeAttemptDisposers]) dispose();
    activeAttemptDisposers.clear();
  }

  function trace_plan(
    trace: LiveTraceContext | undefined,
    request: LocusRecoveryRequest,
    recoveryPlan: LocusRecoveryPlan,
    relationship: string,
    correlation: Readonly<{ requestId?: string }> | undefined,
  ): void {
    if (trace === undefined) return;
    const history = stream.history.debug();
    const strategy = recoveryPlan.outcome === "current"
      ? "already-current"
      : recoveryPlan.outcome === "replay"
        ? "incremental-replay"
        : recoveryPlan.outcome;
    trace.emit({
      subsystem: "locus",
      phase: "recovery.plan",
      status: recoveryPlan.outcome === "reject" ? "failure" : "success",
      details: () => ({
        ...(correlation?.requestId !== undefined ? { requestId: correlation.requestId } : {}),
        logicalMapId: stream.logicalMapId,
        incarnationId: stream.incarnationId,
        mapMode: map.mode,
        ...(request.lastAppliedRev !== undefined ? { requestedRev: request.lastAppliedRev } : {}),
        currentRev: stream.headRev,
        oldestAvailableRev: history.earliestResumableBaseRev,
        targetRev: recoveryPlan.outcome === "reject" ? stream.headRev : recoveryPlan.headRev,
        strategy,
        revisionRelationship: relationship,
        outcome: recoveryPlan.outcome,
        ...(recoveryPlan.outcome === "replay" ? { commitCount: recoveryPlan.body.length } : {}),
        snapshotPresent: recoveryPlan.outcome === "snapshot",
        ...(recoveryPlan.outcome === "reject" ? { errorCode: recoveryPlan.error.code } : {}),
      }),
    });
  }

  function trace_material(
    trace: LiveTraceContext | undefined,
    request: LocusRecoveryRequest,
    outcome: "current" | "replay" | "snapshot",
    body: readonly LocusRecoveryBodyItem[],
    tail: readonly LocusCanonicalCommit[],
    headRev: number,
    snapshot: LocusSnapshotEnvelope | undefined,
    correlation: Readonly<{ requestId?: string }> | undefined,
  ): void {
    if (trace === undefined || outcome === "current") return;
    const commits = [
      ...body.filter((item): item is Extract<LocusRecoveryBodyItem, { kind: "commit" }> => item.kind === "commit").map((item) => item.commit),
      ...tail,
    ];
    const operationKinds = commits.flatMap((commit) => commit.ops.map((operation) =>
      "domain" in operation ? operation.op : operation.kind));
    trace.emit({
      subsystem: "locus",
      phase: "recovery.material",
      status: "success",
      details: () => ({
        ...(correlation?.requestId !== undefined ? { requestId: correlation.requestId } : {}),
        logicalMapId: stream.logicalMapId,
        incarnationId: stream.incarnationId,
        mapMode: map.mode,
        strategy: outcome === "replay"
          ? "incremental-replay"
          : tail.length > 0 ? "snapshot-plus-tail" : "snapshot",
        snapshotPresent: snapshot !== undefined,
        ...(snapshot !== undefined ? { snapshotByteLength: encoded_bytes(snapshot) } : {}),
        commitCount: commits.length,
        operationCount: operationKinds.length,
        operationKinds,
        ...(request.lastAppliedRev !== undefined ? { fromRev: request.lastAppliedRev } : {}),
        toRev: headRev,
        tailCommitCount: tail.length,
        ...(tail[0] !== undefined ? { tailFromRev: tail[0].prevRev, tailToRev: tail[tail.length - 1].rev } : {}),
        outcome: "constructed",
      }),
    });
  }

  return Object.freeze({
    plan,
    plan_traced: (request, trace, correlation, hooks = {}) => plan_internal(
      request,
      hooks,
      trace,
      correlation,
      HSON_SNAPSHOT_ENCODING,
    ),
    plan_with_snapshot_encoding: (request, encoding, hooks = {}) => plan_internal(
      request,
      hooks,
      undefined,
      undefined,
      encoding,
    ),
    plan_traced_with_snapshot_encoding: (request, encoding, trace, correlation, hooks = {}) => plan_internal(
      request,
      hooks,
      trace,
      correlation,
      encoding,
    ),
    debug,
    dispose: dispose_planner,
  });
}
