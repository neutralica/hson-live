import { assert_invariants } from "../core/assert-invariants.js";
import {
  canonical_hson_graph_difference,
  type CanonicalHsonDifference,
} from "../core/canonical-hson-equal.js";
import type { HsonNode } from "../core/types.js";

export type CircuitEntry = "hson" | "json" | "html";
export type CircuitDirection = "cw" | "ccw";
export type CircuitLegPhase = "conversion" | "closure";

export type CircuitTransformBoundary = Readonly<{
  identity: string;
  parse(format: CircuitEntry, text: string): HsonNode;
  serialize(format: CircuitEntry, node: HsonNode): string;
}>;

export type CircuitOperationCounts = Readonly<{
  parses: number;
  serializations: number;
  strictComparisons: number;
  laps: number;
  directions: number;
}>;

export type CircuitFailureStage =
  | "prepare"
  | "serialize"
  | "parse"
  | "compare"
  | "cancel";

export type CircuitFailure = Readonly<{
  stage: CircuitFailureStage;
  message: string;
  terminal: boolean;
  direction?: CircuitDirection;
  lap?: number;
  leg?: number;
  sourceFormat?: CircuitEntry;
  targetFormat?: CircuitEntry;
  difference?: CanonicalHsonDifference;
}>;

export type CircuitTiming = Readonly<{
  serializeMs: number;
  parseMs: number;
  compareMs: number;
  totalMs: number;
}>;

export type PreparedCircuitInput = Readonly<{
  boundaryIdentity: string;
  entry: CircuitEntry;
  text: string;
  node: HsonNode;
  timingMs: number;
}>;

export type CircuitRepresentation = Readonly<{
  format: CircuitEntry;
  text: string;
  node: HsonNode;
}>;

export type CircuitComparisonEvidence = Readonly<{
  equal: boolean;
  difference?: CanonicalHsonDifference;
}>;

export type CapturedCircuitMaterial = Readonly<{
  inputText: string;
  serializedOutput: string;
  sourceNode: HsonNode;
  parsedNode: HsonNode;
}>;

export type CircuitLegDiagnostic = Readonly<{
  direction: CircuitDirection;
  lap: number;
  leg: number;
  phase: CircuitLegPhase;
  sourceFormat: CircuitEntry;
  targetFormat: CircuitEntry;
  comparison?: CircuitComparisonEvidence;
  timing: CircuitTiming;
  failure?: CircuitFailure;
  material?: CapturedCircuitMaterial;
}>;

export type CircuitLeg = Readonly<{
  direction: CircuitDirection;
  lap: number;
  leg: number;
  phase: CircuitLegPhase;
  sourceFormat: CircuitEntry;
  targetFormat: CircuitEntry;
  inputText: string;
  sourceNode: HsonNode;
  serializedOutput?: string;
  parseResult?: HsonNode;
  comparison?: CircuitComparisonEvidence;
  timing: CircuitTiming;
  failure?: CircuitFailure;
  next?: CircuitRepresentation;
}>;

export type CompletedCircuitLap = Readonly<{
  direction: CircuitDirection;
  lap: number;
  completed: boolean;
  next: CircuitRepresentation;
  failures: readonly CircuitFailure[];
  legs?: readonly CircuitLegDiagnostic[];
}>;

export type CircuitCheckpointNode = Readonly<{
  lap: number;
  targetFormat: CircuitEntry;
  phase: CircuitLegPhase;
  node: HsonNode;
}>;

export type CompletedCircuitDirection = Readonly<{
  direction: CircuitDirection;
  requestedLaps: number;
  completedLaps: number;
  completed: boolean;
  ok: boolean;
  final: CircuitRepresentation;
  failures: readonly CircuitFailure[];
  laps?: readonly CompletedCircuitLap[];
  checkpoints?: readonly CircuitCheckpointNode[];
}>;

export type DualDirectionComparison = Readonly<{
  performed: boolean;
  comparison?: CircuitComparisonEvidence;
  failure?: CircuitFailure;
  paranoidComparisons: number;
}>;

export type CircuitCheckpoint = Readonly<{
  stage:
    | "before-direction"
    | "before-opposite-direction"
    | "before-leg"
    | "between-laps"
    | "before-final-comparison";
  direction?: CircuitDirection;
  lap?: number;
  leg?: number;
}>;

export type CircuitExecutionOptions = Readonly<{
  capture?: boolean;
  verbose?: boolean;
  paranoid?: boolean;
  stopOnFirstFail?: boolean;
  shouldCancel?: (checkpoint: CircuitCheckpoint) => boolean;
  now?: () => number;
}>;

export type CircuitExecutionResult = Readonly<{
  ok: boolean;
  entry: CircuitEntry;
  boundaryIdentity: string;
  prepared?: PreparedCircuitInput;
  prepareFailure?: CircuitFailure;
  executionFailure?: CircuitFailure;
  directions: readonly CompletedCircuitDirection[];
  finalComparison?: DualDirectionComparison;
  operations: CircuitOperationCounts;
}>;

type MutableCounts = {
  parses: number;
  serializations: number;
  strictComparisons: number;
  laps: number;
  directions: number;
};

type ExecutionContext = {
  readonly boundary: CircuitTransformBoundary;
  readonly capture: boolean;
  readonly verbose: boolean;
  readonly paranoid: boolean;
  readonly stopOnFirstFail: boolean;
  readonly shouldCancel?: (checkpoint: CircuitCheckpoint) => boolean;
  readonly now: () => number;
  readonly counts: MutableCounts;
};

type DirectionRunResult = Readonly<{
  direction: CompletedCircuitDirection;
  cancelled: boolean;
}>;

function freeze_array<T>(values: T[]): readonly T[] {
  return Object.freeze(values.slice());
}

function counts_snapshot(counts: MutableCounts): CircuitOperationCounts {
  return Object.freeze({ ...counts });
}

function new_counts(): MutableCounts {
  return { parses: 0, serializations: 0, strictComparisons: 0, laps: 0, directions: 0 };
}

function error_message(error: unknown): string {
  return error instanceof Error ? error.message || String(error) : String(error);
}

function is_circuit_failure(
  value: PreparedCircuitInput | CircuitFailure,
): value is CircuitFailure {
  return "stage" in value;
}

function elapsed(now: () => number, began: number): number {
  return Math.max(0, now() - began);
}

function comparison_evidence(
  context: ExecutionContext,
  left: HsonNode,
  right: HsonNode,
): CircuitComparisonEvidence {
  context.counts.strictComparisons += 1;
  const difference = canonical_hson_graph_difference(left, right);
  return Object.freeze({
    equal: difference === undefined,
    ...(difference === undefined ? {} : { difference }),
  });
}

function cancellation_failure(
  checkpoint: CircuitCheckpoint,
  representation: CircuitRepresentation,
): CircuitFailure {
  return Object.freeze({
    stage: "cancel",
    message: `circuit cancelled at ${checkpoint.stage}`,
    terminal: true,
    ...(checkpoint.direction === undefined ? {} : { direction: checkpoint.direction }),
    ...(checkpoint.lap === undefined ? {} : { lap: checkpoint.lap }),
    ...(checkpoint.leg === undefined ? {} : { leg: checkpoint.leg }),
    sourceFormat: representation.format,
  });
}

function is_cancelled(context: ExecutionContext, checkpoint: CircuitCheckpoint): boolean {
  return context.shouldCancel?.(Object.freeze({ ...checkpoint })) === true;
}

function direction_path(entry: CircuitEntry, direction: CircuitDirection): readonly CircuitEntry[] {
  const ring: readonly CircuitEntry[] = direction === "cw"
    ? ["json", "html", "hson"]
    : ["json", "hson", "html"];
  const index = ring.indexOf(entry);
  return Object.freeze([
    ...ring.slice(index),
    ...ring.slice(0, index),
    entry,
  ]);
}

function leg_diagnostic(leg: CircuitLeg, capture: boolean): CircuitLegDiagnostic {
  const material = capture
    && leg.serializedOutput !== undefined
    && leg.parseResult !== undefined
      ? Object.freeze({
          inputText: leg.inputText,
          serializedOutput: leg.serializedOutput,
          sourceNode: leg.sourceNode,
          parsedNode: leg.parseResult,
        })
      : undefined;
  return Object.freeze({
    direction: leg.direction,
    lap: leg.lap,
    leg: leg.leg,
    phase: leg.phase,
    sourceFormat: leg.sourceFormat,
    targetFormat: leg.targetFormat,
    ...(leg.comparison === undefined ? {} : { comparison: leg.comparison }),
    timing: leg.timing,
    ...(leg.failure === undefined ? {} : { failure: leg.failure }),
    ...(material === undefined ? {} : { material }),
  });
}

function execute_leg(
  context: ExecutionContext,
  current: CircuitRepresentation,
  direction: CircuitDirection,
  lap: number,
  legIndex: number,
  targetFormat: CircuitEntry,
  phase: CircuitLegPhase,
): CircuitLeg {
  const totalBegan = context.now();
  const serializeBegan = context.now();
  let serializedOutput: string;
  context.counts.serializations += 1;
  try {
    serializedOutput = context.boundary.serialize(targetFormat, current.node);
  } catch (error) {
    const failure: CircuitFailure = Object.freeze({
      stage: "serialize",
      message: error_message(error),
      terminal: true,
      direction,
      lap,
      leg: legIndex,
      sourceFormat: current.format,
      targetFormat,
    });
    const serializeMs = elapsed(context.now, serializeBegan);
    const result: CircuitLeg = Object.freeze({
      direction,
      lap,
      leg: legIndex,
      phase,
      sourceFormat: current.format,
      targetFormat,
      inputText: current.text,
      sourceNode: current.node,
      timing: Object.freeze({ serializeMs, parseMs: 0, compareMs: 0, totalMs: elapsed(context.now, totalBegan) }),
      failure,
    });
    return result;
  }
  const serializeMs = elapsed(context.now, serializeBegan);

  const parseBegan = context.now();
  let parseResult: HsonNode;
  context.counts.parses += 1;
  try {
    parseResult = context.boundary.parse(targetFormat, serializedOutput);
    assert_invariants(parseResult, `circuit:${context.boundary.identity}:${targetFormat}`);
  } catch (error) {
    const failure: CircuitFailure = Object.freeze({
      stage: "parse",
      message: error_message(error),
      terminal: true,
      direction,
      lap,
      leg: legIndex,
      sourceFormat: current.format,
      targetFormat,
    });
    const parseMs = elapsed(context.now, parseBegan);
    const result: CircuitLeg = Object.freeze({
      direction,
      lap,
      leg: legIndex,
      phase,
      sourceFormat: current.format,
      targetFormat,
      inputText: current.text,
      sourceNode: current.node,
      serializedOutput,
      timing: Object.freeze({ serializeMs, parseMs, compareMs: 0, totalMs: elapsed(context.now, totalBegan) }),
      failure,
    });
    return result;
  }
  const parseMs = elapsed(context.now, parseBegan);

  const compareBegan = context.now();
  const comparison = comparison_evidence(context, current.node, parseResult);
  const compareMs = elapsed(context.now, compareBegan);
  const next = Object.freeze({ format: targetFormat, text: serializedOutput, node: parseResult });
  const failure: CircuitFailure | undefined = comparison.equal
    ? undefined
    : Object.freeze({
        stage: "compare",
        message: comparison.difference?.message ?? "strict canonical comparison failed",
        terminal: context.stopOnFirstFail,
        direction,
        lap,
        leg: legIndex,
        sourceFormat: current.format,
        targetFormat,
        ...(comparison.difference === undefined ? {} : { difference: comparison.difference }),
      });
  const result: CircuitLeg = Object.freeze({
    direction,
    lap,
    leg: legIndex,
    phase,
    sourceFormat: current.format,
    targetFormat,
    inputText: current.text,
    sourceNode: current.node,
    serializedOutput,
    parseResult,
    comparison,
    timing: Object.freeze({ serializeMs, parseMs, compareMs, totalMs: elapsed(context.now, totalBegan) }),
    ...(failure === undefined ? {} : { failure }),
    next,
  });
  return result;
}

function execute_direction(
  context: ExecutionContext,
  prepared: PreparedCircuitInput,
  direction: CircuitDirection,
  times: number,
): DirectionRunResult {
  context.counts.directions += 1;
  const path = direction_path(prepared.entry, direction);
  let current: CircuitRepresentation = Object.freeze({
    format: prepared.entry,
    text: prepared.text,
    node: prepared.node,
  });
  const failures: CircuitFailure[] = [];
  const retainedLaps: CompletedCircuitLap[] | undefined = context.capture || context.verbose ? [] : undefined;
  const checkpoints: CircuitCheckpointNode[] | undefined = context.paranoid ? [] : undefined;
  let completedLaps = 0;

  for (let lap = 0; lap < times; lap += 1) {
    if (lap > 0) {
      const checkpoint = Object.freeze({ stage: "between-laps", direction, lap }) satisfies CircuitCheckpoint;
      if (is_cancelled(context, checkpoint)) {
        failures.push(cancellation_failure(checkpoint, current));
        break;
      }
    }

    const lapFailures: CircuitFailure[] = [];
    const retainedLegs: CircuitLegDiagnostic[] | undefined = retainedLaps === undefined ? undefined : [];
    let lapCompleted = true;
    for (let legIndex = 0; legIndex < path.length; legIndex += 1) {
      const checkpoint = Object.freeze({ stage: "before-leg", direction, lap, leg: legIndex }) satisfies CircuitCheckpoint;
      if (is_cancelled(context, checkpoint)) {
        const failure = cancellation_failure(checkpoint, current);
        failures.push(failure);
        lapFailures.push(failure);
        lapCompleted = false;
        break;
      }
      const phase: CircuitLegPhase = legIndex === path.length - 1 ? "closure" : "conversion";
      const leg = execute_leg(context, current, direction, lap, legIndex, path[legIndex]!, phase);
      if (retainedLegs !== undefined) retainedLegs.push(leg_diagnostic(leg, context.capture));
      if (leg.failure !== undefined) {
        failures.push(leg.failure);
        lapFailures.push(leg.failure);
      }
      if (leg.next === undefined) {
        lapCompleted = false;
        break;
      }
      current = leg.next;
      if (checkpoints !== undefined) {
        checkpoints.push(Object.freeze({ lap, targetFormat: leg.targetFormat, phase, node: current.node }));
      }
      if (leg.failure?.terminal === true) {
        lapCompleted = false;
        break;
      }
    }

    if (lapCompleted) {
      completedLaps += 1;
      context.counts.laps += 1;
    }
    if (retainedLaps !== undefined) {
      retainedLaps.push(Object.freeze({
        direction,
        lap,
        completed: lapCompleted,
        next: current,
        failures: freeze_array(lapFailures),
        ...(retainedLegs === undefined ? {} : { legs: freeze_array(retainedLegs) }),
      }));
    }
    if (!lapCompleted) break;
  }

  const completed = completedLaps === times;
  return Object.freeze({
    direction: Object.freeze({
      direction,
      requestedLaps: times,
      completedLaps,
      completed,
      ok: completed && failures.length === 0,
      final: current,
      failures: freeze_array(failures),
      ...(retainedLaps === undefined ? {} : { laps: freeze_array(retainedLaps) }),
      ...(checkpoints === undefined ? {} : { checkpoints: freeze_array(checkpoints) }),
    }),
    cancelled: failures.some((failure) => failure.stage === "cancel"),
  });
}

function create_context(
  boundary: CircuitTransformBoundary,
  options: CircuitExecutionOptions,
  counts: MutableCounts,
): ExecutionContext {
  return {
    boundary,
    capture: options.capture === true,
    verbose: options.verbose === true,
    paranoid: options.paranoid === true,
    stopOnFirstFail: options.stopOnFirstFail ?? true,
    ...(options.shouldCancel === undefined ? {} : { shouldCancel: options.shouldCancel }),
    now: options.now ?? Date.now,
    counts,
  };
}

function prepare_with_context(
  context: ExecutionContext,
  entry: CircuitEntry,
  text: string,
): PreparedCircuitInput | CircuitFailure {
  const began = context.now();
  context.counts.parses += 1;
  try {
    const node = context.boundary.parse(entry, text);
    assert_invariants(node, `circuit:prepare:${context.boundary.identity}:${entry}`);
    return Object.freeze({
      boundaryIdentity: context.boundary.identity,
      entry,
      text,
      node,
      timingMs: elapsed(context.now, began),
    });
  } catch (error) {
    return Object.freeze({
      stage: "prepare",
      message: error_message(error),
      terminal: true,
      sourceFormat: entry,
    });
  }
}

export function prepare_explicit_entry(
  boundary: CircuitTransformBoundary,
  entry: CircuitEntry,
  text: string,
  options: CircuitExecutionOptions = {},
): Readonly<{
  prepared?: PreparedCircuitInput;
  failure?: CircuitFailure;
  operations: CircuitOperationCounts;
}> {
  const counts = new_counts();
  const context = create_context(boundary, options, counts);
  const prepared = prepare_with_context(context, entry, text);
  return Object.freeze({
    ...(is_circuit_failure(prepared) ? { failure: prepared } : { prepared }),
    operations: counts_snapshot(counts),
  });
}

export function run_conversion_leg(
  boundary: CircuitTransformBoundary,
  current: CircuitRepresentation,
  targetFormat: CircuitEntry,
  details: Readonly<{
    direction: CircuitDirection;
    lap: number;
    leg: number;
    phase?: CircuitLegPhase;
  }>,
  options: CircuitExecutionOptions = {},
): Readonly<{ leg: CircuitLeg; operations: CircuitOperationCounts }> {
  const counts = new_counts();
  const context = create_context(boundary, options, counts);
  const leg = execute_leg(
    context,
    current,
    details.direction,
    details.lap,
    details.leg,
    targetFormat,
    details.phase ?? "conversion",
  );
  return Object.freeze({ leg, operations: counts_snapshot(counts) });
}

export function run_direction(
  boundary: CircuitTransformBoundary,
  prepared: PreparedCircuitInput,
  direction: CircuitDirection,
  times: number,
  options: CircuitExecutionOptions = {},
): Readonly<{ direction: CompletedCircuitDirection; operations: CircuitOperationCounts }> {
  const counts = new_counts();
  const context = create_context(boundary, options, counts);
  const result = execute_direction(context, prepared, direction, times);
  return Object.freeze({ direction: result.direction, operations: counts_snapshot(counts) });
}

/** Execute one directional lap without requiring a dual-circuit structure. */
export function run_directional_lap(
  boundary: CircuitTransformBoundary,
  prepared: PreparedCircuitInput,
  direction: CircuitDirection,
  options: CircuitExecutionOptions = {},
): Readonly<{ lap: CompletedCircuitLap; operations: CircuitOperationCounts }> {
  const result = run_direction(boundary, prepared, direction, 1, options);
  const retained = result.direction.laps?.[0];
  const lap = retained ?? Object.freeze({
    direction,
    lap: 0,
    completed: result.direction.completed,
    next: result.direction.final,
    failures: result.direction.failures,
  });
  return Object.freeze({ lap, operations: result.operations });
}

function compare_directions(
  context: ExecutionContext,
  cw: CompletedCircuitDirection,
  ccw: CompletedCircuitDirection,
): DualDirectionComparison {
  if (!cw.completed || !ccw.completed) return Object.freeze({ performed: false, paranoidComparisons: 0 });
  const comparison = comparison_evidence(context, cw.final.node, ccw.final.node);
  const failure: CircuitFailure | undefined = comparison.equal
    ? undefined
    : Object.freeze({
        stage: "compare",
        message: comparison.difference?.message ?? "dual direction comparison failed",
        terminal: context.stopOnFirstFail,
        ...(comparison.difference === undefined ? {} : { difference: comparison.difference }),
      });

  let paranoidComparisons = 0;
  let paranoidFailure: CircuitFailure | undefined;
  if (context.paranoid && !(context.stopOnFirstFail && failure !== undefined)) {
    const cwMarks = new Map((cw.checkpoints ?? []).map((mark) => [`${mark.lap}|${mark.targetFormat}|${mark.phase}`, mark.node]));
    const ccwMarks = new Map((ccw.checkpoints ?? []).map((mark) => [`${mark.lap}|${mark.targetFormat}|${mark.phase}`, mark.node]));
    for (const key of new Set([...cwMarks.keys(), ...ccwMarks.keys()])) {
      const left = cwMarks.get(key);
      const right = ccwMarks.get(key);
      if (left === undefined || right === undefined) {
        paranoidFailure = Object.freeze({
          stage: "compare",
          message: `paranoid checkpoint missing for ${key}`,
          terminal: context.stopOnFirstFail,
        });
      } else {
        paranoidComparisons += 1;
        const evidence = comparison_evidence(context, left, right);
        if (!evidence.equal) {
          paranoidFailure = Object.freeze({
            stage: "compare",
            message: `paranoid checkpoint differs for ${key}: ${evidence.difference?.message ?? "strict comparison failed"}`,
            terminal: context.stopOnFirstFail,
            ...(evidence.difference === undefined ? {} : { difference: evidence.difference }),
          });
        }
      }
      if (context.stopOnFirstFail && paranoidFailure !== undefined) break;
    }
  }
  return Object.freeze({
    performed: true,
    comparison,
    ...((failure ?? paranoidFailure) === undefined ? {} : { failure: failure ?? paranoidFailure }),
    paranoidComparisons,
  });
}

export function compare_completed_directions(
  boundary: CircuitTransformBoundary,
  cw: CompletedCircuitDirection,
  ccw: CompletedCircuitDirection,
  options: CircuitExecutionOptions = {},
): Readonly<{ comparison: DualDirectionComparison; operations: CircuitOperationCounts }> {
  const counts = new_counts();
  const context = create_context(boundary, options, counts);
  const comparison = compare_directions(context, cw, ccw);
  return Object.freeze({ comparison, operations: counts_snapshot(counts) });
}

export function execute_circuit(
  boundary: CircuitTransformBoundary,
  entry: CircuitEntry,
  text: string,
  request: Readonly<{
    times: number;
    dual: boolean;
    direction: CircuitDirection;
  }>,
  options: CircuitExecutionOptions = {},
): CircuitExecutionResult {
  const counts = new_counts();
  const context = create_context(boundary, options, counts);
  const prepared = prepare_with_context(context, entry, text);
  if (is_circuit_failure(prepared)) {
    return Object.freeze({
      ok: false,
      entry,
      boundaryIdentity: boundary.identity,
      prepareFailure: prepared,
      directions: Object.freeze([]),
      operations: counts_snapshot(counts),
    });
  }

  const directions: CompletedCircuitDirection[] = [];
  const firstDirection: CircuitDirection = request.dual ? "cw" : request.direction;
  const firstCheckpoint = Object.freeze({ stage: "before-direction", direction: firstDirection }) satisfies CircuitCheckpoint;
  if (is_cancelled(context, firstCheckpoint)) {
    const representation = Object.freeze({ format: entry, text, node: prepared.node });
    const failure = cancellation_failure(firstCheckpoint, representation);
    return Object.freeze({
      ok: false,
      entry,
      boundaryIdentity: boundary.identity,
      prepared,
      executionFailure: failure,
      directions: Object.freeze([]),
      operations: counts_snapshot(counts),
    });
  }

  const first = execute_direction(context, prepared, firstDirection, request.times);
  directions.push(first.direction);

  if (!request.dual) {
    return Object.freeze({
      ok: first.direction.ok,
      entry,
      boundaryIdentity: boundary.identity,
      prepared,
      directions: freeze_array(directions),
      operations: counts_snapshot(counts),
    });
  }

  if (first.cancelled || (context.stopOnFirstFail && !first.direction.ok)) {
    return Object.freeze({
      ok: false,
      entry,
      boundaryIdentity: boundary.identity,
      prepared,
      directions: freeze_array(directions),
      operations: counts_snapshot(counts),
    });
  }

  const oppositeCheckpoint = Object.freeze({ stage: "before-opposite-direction", direction: "ccw" }) satisfies CircuitCheckpoint;
  if (is_cancelled(context, oppositeCheckpoint)) {
    const representation = Object.freeze({ format: entry, text, node: prepared.node });
    const failure = cancellation_failure(oppositeCheckpoint, representation);
    return Object.freeze({
      ok: false,
      entry,
      boundaryIdentity: boundary.identity,
      prepared,
      executionFailure: failure,
      directions: freeze_array(directions),
      operations: counts_snapshot(counts),
    });
  }

  const second = execute_direction(context, prepared, "ccw", request.times);
  directions.push(second.direction);
  if (second.cancelled || (context.stopOnFirstFail && !second.direction.ok)) {
    return Object.freeze({
      ok: false,
      entry,
      boundaryIdentity: boundary.identity,
      prepared,
      directions: freeze_array(directions),
      operations: counts_snapshot(counts),
    });
  }

  const finalCheckpoint = Object.freeze({ stage: "before-final-comparison" }) satisfies CircuitCheckpoint;
  if (is_cancelled(context, finalCheckpoint)) {
    const representation = Object.freeze({ format: entry, text, node: prepared.node });
    const failure = cancellation_failure(finalCheckpoint, representation);
    return Object.freeze({
      ok: false,
      entry,
      boundaryIdentity: boundary.identity,
      prepared,
      executionFailure: failure,
      directions: freeze_array(directions),
      operations: counts_snapshot(counts),
    });
  }

  const finalComparison = compare_directions(context, first.direction, second.direction);
  const ok = first.direction.ok
    && second.direction.ok
    && finalComparison.performed
    && finalComparison.failure === undefined;
  return Object.freeze({
    ok,
    entry,
    boundaryIdentity: boundary.identity,
    prepared,
    directions: freeze_array(directions),
    finalComparison,
    operations: counts_snapshot(counts),
  });
}
