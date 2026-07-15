// livehost.recovery.ts

import type { JsonValue, LiveMap } from "../../types/index.js";
import type {
  LiveHostCanonicalCommit,
  LiveHostCanonicalStream,
  LiveHostDisposer,
  LiveHostRecoveryAttemptDiagnostics,
  LiveHostRecoveryAttemptState,
  LiveHostRecoveryBodyItem,
  LiveHostRecoveryBodyObserver,
  LiveHostRecoveryCompletion,
  LiveHostRecoveryCurrentPlan,
  LiveHostRecoveryHooks,
  LiveHostRecoveryOptions,
  LiveHostRecoveryPlan,
  LiveHostRecoveryPlanner,
  LiveHostRecoveryPlannerDiagnostics,
  LiveHostRecoveryRejectCode,
  LiveHostRecoveryRejectPlan,
  LiveHostRecoveryReplayPlan,
  LiveHostRecoveryRequest,
  LiveHostRecoveryRuntimeErrorCode,
  LiveHostRecoverySnapshotPlan,
  LiveHostRecoverySnapshotReason,
  LiveHostSnapshotEnvelope,
} from "../../types/livehost.types.js";
import { LiveHostRecoveryError } from "./livehost.error.js";

const DEFAULT_MAX_TAIL_COMMITS = 256;
const DEFAULT_MAX_TAIL_BYTES = 1 * 1_024 * 1_024;
const EMPTY_BODY: readonly [] = Object.freeze([]);
const textEncoder = new TextEncoder();

function must_bound(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (Number.isFinite(value) && value >= 0) return Math.trunc(value);
  throw new Error(`LiveHost recovery ${name} must be a finite non-negative number.`);
}

function is_json_value(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(is_json_value);
  if (typeof value !== "object") return false;

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.values(value).every(is_json_value);
}

function clone_json_value(value: JsonValue): JsonValue {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    const clone = value.map(clone_json_value);
    Object.freeze(clone);
    return clone;
  }

  const clone: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(value)) clone[key] = clone_json_value(item);
  Object.freeze(clone);
  return clone;
}

function encoded_bytes(value: unknown): number {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("LiveHost recovery value is not JSON-encodable.");
  return textEncoder.encode(encoded).byteLength;
}

function runtime_error(
  code: LiveHostRecoveryRuntimeErrorCode,
  message: string,
  cause?: unknown,
): LiveHostRecoveryError {
  return new LiveHostRecoveryError(code, message, cause);
}

/**
 * Create the host-side recovery planner for one canonical LiveMap stream.
 * The planner produces recovery material directly and has no transport role.
 */
export function make_livehost_recovery_planner<TState extends JsonValue | undefined>(
  map: LiveMap<TState>,
  stream: LiveHostCanonicalStream,
  options: LiveHostRecoveryOptions = {},
): LiveHostRecoveryPlanner {
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

  function reject(code: LiveHostRecoveryRejectCode, message: string): LiveHostRecoveryRejectPlan {
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

  function plan(request: LiveHostRecoveryRequest, hooks: LiveHostRecoveryHooks = {}): LiveHostRecoveryPlan {
    if (request.logicalMapId !== stream.logicalMapId) {
      return reject(
        "LIVEHOST_RECOVERY_INVALID_TARGET",
        `Unknown LiveHost logical map ID: ${request.logicalMapId}`,
      );
    }

    if (
      request.lastAppliedRev !== undefined
      && (!Number.isInteger(request.lastAppliedRev) || request.lastAppliedRev < 0)
    ) {
      return reject(
        "LIVEHOST_RECOVERY_INVALID_REQUEST",
        "LiveHost recovery lastAppliedRev must be a non-negative integer.",
      );
    }

    try {
      hooks.before_cut?.();
    } catch (cause) {
      abortedAttemptCount += 1;
      throw runtime_error(
        "LIVEHOST_RECOVERY_PLANNING_FAILED",
        "LiveHost recovery failed before establishing its cut.",
        cause,
      );
    }

    const preliminary: LiveHostCanonicalCommit[] = [];
    const tail: LiveHostCanonicalCommit[] = [];
    let tailBytes = 0;
    let cutRev: number | undefined;
    let state: LiveHostRecoveryAttemptState = "active";
    let attemptError: LiveHostRecoveryError | undefined;
    let stopSubscription: LiveHostDisposer = () => {};
    let released = false;

    function release_active_attempt(): void {
      if (released) return;
      released = true;
      activeAttemptCount -= 1;
    }

    function clear_queues(): void {
      preliminary.length = 0;
      tail.length = 0;
      tailBytes = 0;
    }

    function abort(error: LiveHostRecoveryError): void {
      if (state !== "active") return;
      state = "aborted";
      attemptError = error;
      stopSubscription();
      clear_queues();
      release_active_attempt();
      abortedAttemptCount += 1;
      if (error.code === "LIVEHOST_RECOVERY_TAIL_OVERFLOW") overflowCount += 1;
    }

    function enqueue_tail(commit: LiveHostCanonicalCommit): void {
      if (state !== "active") return;
      if (cutRev === undefined) {
        preliminary.push(commit);
        return;
      }
      if (commit.rev <= cutRev) return;

      const expectedPrevRev = tail[tail.length - 1]?.rev ?? cutRev;
      if (commit.prevRev !== expectedPrevRev) {
        abort(runtime_error(
          "LIVEHOST_RECOVERY_TAIL_GAP",
          `LiveHost recovery tail expected prevRev ${expectedPrevRev}, received ${commit.prevRev}.`,
        ));
        return;
      }

      let commitBytes: number;
      try {
        commitBytes = encoded_bytes(commit);
      } catch (cause) {
        abort(runtime_error(
          "LIVEHOST_RECOVERY_PLANNING_FAILED",
          "LiveHost recovery could not encode a queued tail commit.",
          cause,
        ));
        return;
      }

      tail.push(commit);
      tailBytes += commitBytes;

      if (tail.length > maxTailCommits || tailBytes > maxTailBytes) {
        abort(runtime_error(
          "LIVEHOST_RECOVERY_TAIL_OVERFLOW",
          "LiveHost recovery tail exceeded its configured count or byte limit.",
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

    let outcome: "current" | "replay" | "snapshot";
    let headRev = stream.headRev;
    let replayBody: readonly LiveHostCanonicalCommit[] | undefined;
    let snapshotBody: LiveHostSnapshotEnvelope | undefined;
    let snapshotReason: LiveHostRecoverySnapshotReason | undefined;

    try {
      const sameIncarnation = request.incarnationId === stream.incarnationId;
      const usableRevision = sameIncarnation ? request.lastAppliedRev : undefined;

      if (sameIncarnation && usableRevision !== undefined && usableRevision > headRev) {
        stopSubscription();
        clear_queues();
        release_active_attempt();
        state = "disposed";
        return reject(
          "REVISION_AHEAD_OF_AUTHORITY",
          `Client revision ${usableRevision} is ahead of authoritative revision ${headRev}.`,
        );
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
            "LIVEHOST_RECOVERY_REPLAY_FAILED",
            "LiveHost recovery could not prepare replay material.",
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
          if (capture.value === undefined || !is_json_value(capture.value)) {
            throw new Error("LiveHost recovery snapshot root is not JSON.");
          }
          if (capture.rev !== stream.headRev) {
            throw new Error(
              `LiveHost recovery snapshot revision ${capture.rev} does not match stream head ${stream.headRev}.`,
            );
          }

          headRev = capture.rev;
          snapshotBody = Object.freeze({
            logicalMapId: stream.logicalMapId,
            incarnationId: stream.incarnationId,
            rev: capture.rev,
            value: clone_json_value(capture.value),
          });
          encoded_bytes(snapshotBody);
          establish_cut(headRev);
        } catch (cause) {
          if (cause instanceof LiveHostRecoveryError) throw cause;
          throw runtime_error(
            "LIVEHOST_RECOVERY_SNAPSHOT_FAILED",
            "LiveHost recovery could not capture a valid atomic snapshot.",
            cause,
          );
        }
      }

      hooks.after_cut?.(headRev);
      throw_if_aborted();
    } catch (cause) {
      const error = cause instanceof LiveHostRecoveryError
        ? cause
        : runtime_error(
          "LIVEHOST_RECOVERY_PLANNING_FAILED",
          "LiveHost recovery planning failed after tail registration.",
          cause,
        );
      abort(error);
      throw error;
    }

    function must_be_active(): void {
      if (state === "active") return;
      if (state === "aborted" && attemptError) throw attemptError;
      if (state === "completed") {
        throw runtime_error("LIVEHOST_RECOVERY_COMPLETED", "LiveHost recovery attempt is already completed.");
      }
      throw runtime_error("LIVEHOST_RECOVERY_DISPOSED", "LiveHost recovery attempt is disposed.");
    }

    function dispose(): void {
      if (state !== "active") return;
      state = "disposed";
      stopSubscription();
      clear_queues();
      release_active_attempt();
      disposedAttemptCount += 1;
    }

    function body_items(): readonly LiveHostRecoveryBodyItem[] {
      if (outcome === "current") return EMPTY_BODY;
      if (outcome === "snapshot" && snapshotBody) {
        return Object.freeze([Object.freeze({ kind: "snapshot", snapshot: snapshotBody })]);
      }
      if (outcome === "replay" && replayBody) {
        return Object.freeze(replayBody.map((commit) => Object.freeze({ kind: "commit", commit })));
      }
      throw runtime_error(
        "LIVEHOST_RECOVERY_PLANNING_FAILED",
        "LiveHost recovery attempt has incomplete body material.",
      );
    }

    const producedBody = body_items();

    function complete(observer: LiveHostRecoveryBodyObserver = () => {}): LiveHostRecoveryCompletion {
      must_be_active();

      try {
        for (const item of producedBody) {
          observer(item);
          must_be_active();
        }
      } catch (cause) {
        if (state === "aborted" && attemptError) throw attemptError;
        const error = runtime_error(
          "LIVEHOST_RECOVERY_OBSERVER_FAILED",
          "LiveHost recovery body observer failed.",
          cause,
        );
        abort(error);
        throw error;
      }

      must_be_active();
      stopSubscription();
      const completedTail = Object.freeze([...tail]);
      const caughtUp = Object.freeze({
        kind: "caught_up" as const,
        logicalMapId: stream.logicalMapId,
        incarnationId: stream.incarnationId,
        throughRev: headRev,
      });
      clear_queues();
      state = "completed";
      release_active_attempt();
      completedAttemptCount += 1;

      return Object.freeze({ caughtUp, tail: completedTail });
    }

    function debug(): LiveHostRecoveryAttemptDiagnostics {
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

    if (outcome === "current") {
      currentPlanCount += 1;
      const currentPlan: LiveHostRecoveryCurrentPlan = Object.freeze({
        ...base,
        outcome: "current",
        body: EMPTY_BODY,
      });
      return currentPlan;
    }

    if (outcome === "replay" && replayBody) {
      replayPlanCount += 1;
      const replayPlan: LiveHostRecoveryReplayPlan = Object.freeze({
        ...base,
        outcome: "replay",
        body: replayBody,
      });
      return replayPlan;
    }

    if (outcome === "snapshot" && snapshotBody && snapshotReason) {
      snapshotPlanCount += 1;
      const snapshotPlan: LiveHostRecoverySnapshotPlan = Object.freeze({
        ...base,
        outcome: "snapshot",
        reason: snapshotReason,
        body: snapshotBody,
      });
      return snapshotPlan;
    }

    const error = runtime_error(
      "LIVEHOST_RECOVERY_PLANNING_FAILED",
      "LiveHost recovery planner produced an incomplete plan.",
    );
    abort(error);
    throw error;
  }

  function debug(): LiveHostRecoveryPlannerDiagnostics {
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

  return Object.freeze({ plan, debug });
}
