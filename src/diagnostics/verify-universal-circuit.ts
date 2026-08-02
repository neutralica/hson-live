import { hsonTransform } from "../api/transform/index.js";
import {
  execute_circuit,
  type CircuitCheckpoint,
  type CircuitExecutionResult,
  type CircuitFailure,
} from "./circuit-engine.js";
import { create_circuit_transform_boundary } from "./circuit-transform-boundary.js";

export type UniversalCircuitEntry = "hson" | "json" | "html";
export type UniversalCircuitDirection = "cw" | "ccw";

export type UniversalCircuitVerificationRequest = Readonly<{
  entry: UniversalCircuitEntry;
  source: string;
}>;

export type UniversalCircuitOperationCounts = Readonly<{
  serializations: number;
  parses: number;
  comparisons: number;
  laps: number;
  directions: number;
}>;

export type UniversalCircuitFailure = Readonly<{
  stage: string;
  code: string;
  message: string;
  direction?: UniversalCircuitDirection;
  lap?: number;
  sourceFormat?: UniversalCircuitEntry;
  targetFormat?: UniversalCircuitEntry;
  path?: readonly (string | number)[];
}>;

export type UniversalCircuitProgress = Readonly<{
  stage: "cw-lap-complete" | "ccw-lap-complete" | "comparing";
  completed: number;
  total: number;
  direction?: UniversalCircuitDirection;
  lap?: number;
}>;

export type UniversalCircuitVerificationResult = Readonly<{
  status: "verified" | "failed" | "cancelled";
  entry: UniversalCircuitEntry;
  boundary: "universal-htmlparser2";
  operationCounts: UniversalCircuitOperationCounts;
  durationMs: number;
  failure?: UniversalCircuitFailure;
  baselineHson?: string;
  clockwiseFinalHson?: string;
  counterclockwiseFinalHson?: string;
  finalHtml?: string;
}>;

export type UniversalCircuitVerificationHooks = Readonly<{
  shouldCancel?: () => boolean;
  onProgress?: (progress: UniversalCircuitProgress) => void;
  now?: () => number;
}>;

const UNIVERSAL_CIRCUIT_BOUNDARY = create_circuit_transform_boundary(
  "universal-htmlparser2",
  {
    parseJson: (text) => hsonTransform.fromJson(text).toNode(),
    parseHtml: (text) => hsonTransform.fromTrustedHtml(text).toNode(),
    parseHson: (text) => hsonTransform.fromHson(text).toNode(),
    serializeJson: (node) => hsonTransform.fromNode(node).toJson().serialize(),
    serializeHtml: (node) => hsonTransform.fromNode(node).toHtml().serialize(),
    serializeHson: (node) => hsonTransform.fromNode(node).toHson().serialize(),
  },
);

function operation_counts(result: CircuitExecutionResult): UniversalCircuitOperationCounts {
  return Object.freeze({
    serializations: result.operations.serializations,
    parses: result.operations.parses,
    comparisons: result.operations.strictComparisons,
    laps: result.operations.laps,
    directions: result.operations.directions,
  });
}

function failure_code(failure: CircuitFailure): string {
  if (failure.stage === "cancel") return "CIRCUIT_CANCELLED";
  if (failure.stage === "prepare") return "CIRCUIT_PREPARE_FAILED";
  if (failure.stage === "serialize") return "CIRCUIT_SERIALIZATION_FAILED";
  if (failure.stage === "parse") return "CIRCUIT_PARSE_FAILED";
  return "CIRCUIT_STRICT_COMPARISON_FAILED";
}

function public_failure_message(failure: CircuitFailure): string {
  if (failure.stage === "cancel") return "Circuit verification was cancelled at a safe checkpoint.";
  if (failure.stage === "prepare") return "Circuit input could not be parsed as the explicit entry format.";
  if (failure.stage === "serialize") return "Circuit serialization failed.";
  if (failure.stage === "parse") return "A serialized circuit representation could not be parsed.";
  return failure.difference?.message ?? "Strict canonical circuit comparison failed.";
}

function detach_failure(failure: CircuitFailure): UniversalCircuitFailure {
  return Object.freeze({
    stage: failure.stage,
    code: failure_code(failure),
    message: public_failure_message(failure),
    ...(failure.direction === undefined ? {} : { direction: failure.direction }),
    ...(failure.lap === undefined ? {} : { lap: failure.lap + 1 }),
    ...(failure.sourceFormat === undefined ? {} : { sourceFormat: failure.sourceFormat }),
    ...(failure.targetFormat === undefined ? {} : { targetFormat: failure.targetFormat }),
    ...(failure.difference === undefined
      ? {}
      : { path: Object.freeze([failure.difference.path]) }),
  });
}

function first_failure(result: CircuitExecutionResult): CircuitFailure | undefined {
  return result.prepareFailure
    ?? result.executionFailure
    ?? result.directions.flatMap((direction) => direction.failures)[0]
    ?? result.finalComparison?.failure;
}

function safe_progress(
  callback: UniversalCircuitVerificationHooks["onProgress"],
  progress: UniversalCircuitProgress,
): void {
  try {
    callback?.(progress);
  } catch {
    // Diagnostic observation is best-effort and cannot alter circuit semantics.
  }
}

function checkpoint_progress(
  checkpoint: CircuitCheckpoint,
  callback: UniversalCircuitVerificationHooks["onProgress"],
): void {
  if (checkpoint.stage === "between-laps" && checkpoint.direction !== undefined && checkpoint.lap !== undefined) {
    const completed = checkpoint.direction === "cw" ? checkpoint.lap : 3 + checkpoint.lap;
    safe_progress(callback, Object.freeze({
      stage: checkpoint.direction === "cw" ? "cw-lap-complete" : "ccw-lap-complete",
      direction: checkpoint.direction,
      lap: checkpoint.lap,
      completed,
      total: 7,
    }));
    return;
  }
  if (checkpoint.stage === "before-opposite-direction") {
    safe_progress(callback, Object.freeze({
      stage: "cw-lap-complete",
      direction: "cw",
      lap: 3,
      completed: 3,
      total: 7,
    }));
    return;
  }
  if (checkpoint.stage === "before-final-comparison") {
    safe_progress(callback, Object.freeze({
      stage: "ccw-lap-complete",
      direction: "ccw",
      lap: 3,
      completed: 6,
      total: 7,
    }));
    safe_progress(callback, Object.freeze({ stage: "comparing", completed: 6, total: 7 }));
  }
}

/**
 * Execute the fixed Phase 2 universal Transform diagnostic policy.
 *
 * This diagnostics-only facade deliberately returns detached strings and scalar
 * evidence rather than exposing the semantic engine's canonical graph records.
 * Cancellation is observed at the engine's existing bounded checkpoints.
 */
export function verify_universal_circuit(
  request: UniversalCircuitVerificationRequest,
  hooks: UniversalCircuitVerificationHooks = {},
): UniversalCircuitVerificationResult {
  if (
    (request.entry !== "hson" && request.entry !== "json" && request.entry !== "html")
    || typeof request.source !== "string"
  ) {
    throw new Error("CIRCUIT_REQUEST_INVALID: verify_universal_circuit requires an explicit hson, json, or html entry and string source.");
  }
  const now = hooks.now ?? Date.now;
  const began = now();
  const result = execute_circuit(
    UNIVERSAL_CIRCUIT_BOUNDARY,
    request.entry,
    request.source,
    { times: 3, dual: true, direction: "cw" },
    {
      capture: false,
      verbose: false,
      paranoid: false,
      stopOnFirstFail: true,
      now,
      shouldCancel(checkpoint) {
        checkpoint_progress(checkpoint, hooks.onProgress);
        return hooks.shouldCancel?.() === true;
      },
    },
  );
  const counts = operation_counts(result);
  const durationMs = Math.max(0, now() - began);
  const failure = first_failure(result);
  if (!result.ok || result.prepared === undefined) {
    const fallback: UniversalCircuitFailure = Object.freeze({
      stage: "verification",
      code: "CIRCUIT_VERIFICATION_FAILED",
      message: "Universal Transform circuit verification failed.",
    });
    return Object.freeze({
      status: failure?.stage === "cancel" ? "cancelled" : "failed",
      entry: request.entry,
      boundary: "universal-htmlparser2",
      operationCounts: counts,
      durationMs,
      failure: failure === undefined ? fallback : detach_failure(failure),
    });
  }

  const clockwise = result.directions.find((direction) => direction.direction === "cw");
  const counterclockwise = result.directions.find((direction) => direction.direction === "ccw");
  if (clockwise === undefined || counterclockwise === undefined) {
    return Object.freeze({
      status: "failed",
      entry: request.entry,
      boundary: "universal-htmlparser2",
      operationCounts: counts,
      durationMs,
      failure: Object.freeze({
        stage: "materialize",
        code: "CIRCUIT_RESULT_INCOMPLETE",
        message: "Circuit verification completed without both directional results.",
      }),
    });
  }

  try {
    return Object.freeze({
      status: "verified",
      entry: request.entry,
      boundary: "universal-htmlparser2",
      operationCounts: counts,
      durationMs: Math.max(0, now() - began),
      baselineHson: UNIVERSAL_CIRCUIT_BOUNDARY.serialize("hson", result.prepared.node),
      clockwiseFinalHson: UNIVERSAL_CIRCUIT_BOUNDARY.serialize("hson", clockwise.final.node),
      counterclockwiseFinalHson: UNIVERSAL_CIRCUIT_BOUNDARY.serialize("hson", counterclockwise.final.node),
      finalHtml: UNIVERSAL_CIRCUIT_BOUNDARY.serialize("html", clockwise.final.node),
    });
  } catch {
    return Object.freeze({
      status: "failed",
      entry: request.entry,
      boundary: "universal-htmlparser2",
      operationCounts: counts,
      durationMs: Math.max(0, now() - began),
      failure: Object.freeze({
        stage: "materialize",
        code: "CIRCUIT_RESULT_MATERIALIZATION_FAILED",
        message: "Verified circuit material could not be detached for transport.",
      }),
    });
  }
}
