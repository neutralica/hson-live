import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import { create_test_event_emitter } from "./test-events.mjs";
import assert from "node:assert/strict";
import {
  execute_circuit,
  type CircuitExecutionOptions,
  type CircuitExecutionResult,
} from "../src/diagnostics/circuit-engine.ts";
import type { HsonNode } from "../src/core/types.ts";
import {
  boundary_with_hooks,
  first_scalar,
  universalCircuitBoundary,
} from "./circuit-test-helpers.mts";

const LAUNCHER = "diagnostics.circuit-failure-control";
const SOURCE = '{"a":1,"b":2}';
export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "diagnostics.circuit-failure-control",
  title: "Circuit failure and execution control",
  category: "Transform",
  runtime: "node",
  tags: Object.freeze(["diagnostics", "circuit", "failure-propagation", "operation-accounting"]),
});

const testEvents = create_test_event_emitter("diagnostics.circuit-failure-control");
let checks = 0;

function check(name: string, run: () => void): void {

  testEvents.case_begin(name, name);
  try {
    run();
    testEvents.case_end(name, "pass");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Check failed.";
    testEvents.diagnostic(name, "assertion", message.slice(0, 1_000));
    testEvents.case_end(name, "fail");
    testEvents.terminal("fail");
    throw error;
  }
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function execute(
  options: CircuitExecutionOptions = {},
  boundary = universalCircuitBoundary,
  request: Readonly<{ times: number; dual: boolean; direction: "cw" | "ccw" }> = {
    times: 1,
    dual: false,
    direction: "cw",
  },
): CircuitExecutionResult {
  return execute_circuit(boundary, "json", SOURCE, request, { now: () => 0, ...options });
}

function change_first_scalar(node: HsonNode): HsonNode {
  const changed = structuredClone(node);
  const scalar = first_scalar(changed);
  scalar.$_content[0] = scalar.$_content[0] === 1 ? 99 : 1;
  return changed;
}

check("entry parse failure is one terminal structured failure", () => {
  const boundary = boundary_with_hooks({ beforeParse: () => { throw new Error("prepare-bang"); } });
  const result = execute({}, boundary);
  assert.equal(result.prepareFailure?.stage, "prepare");
  assert.equal(result.prepareFailure?.terminal, true);
  assert.match(result.prepareFailure?.message ?? "", /prepare-bang/);
  assert.deepEqual(result.operations, { parses: 1, serializations: 0, strictComparisons: 0, laps: 0, directions: 0 });
});

check("first-leg serialization failure is terminal for that direction", () => {
  const boundary = boundary_with_hooks({ beforeSerialize: () => { throw new Error("emit-bang"); } });
  const result = execute({}, boundary);
  assert.equal(result.directions[0]?.failures[0]?.stage, "serialize");
  assert.equal(result.directions[0]?.completed, false);
  assert.deepEqual(result.operations, { parses: 1, serializations: 1, strictComparisons: 0, laps: 0, directions: 1 });
});

check("first-leg parse failure is terminal for that direction", () => {
  const boundary = boundary_with_hooks({ beforeParse: (ordinal) => { if (ordinal === 2) throw new Error("parse-bang"); } });
  const result = execute({}, boundary);
  assert.equal(result.directions[0]?.failures[0]?.stage, "parse");
  assert.deepEqual(result.operations, { parses: 2, serializations: 1, strictComparisons: 0, laps: 0, directions: 1 });
});

check("failed parse never carries malformed closure text into another leg", () => {
  const boundary = boundary_with_hooks({ beforeParse: (ordinal) => { if (ordinal === 2) throw new Error("parse-bang"); } });
  const result = execute({ stopOnFirstFail: false }, boundary);
  assert.equal(result.operations.serializations, 1);
  assert.equal(result.operations.strictComparisons, 0);
  assert.equal(result.directions[0]?.final.text, SOURCE);
});

check("fail-fast comparison stops later conversions in the lap", () => {
  const boundary = boundary_with_hooks({
    afterParse: (ordinal, _format, node) => ordinal === 2 ? change_first_scalar(node) : node,
  });
  const result = execute({ stopOnFirstFail: true }, boundary);
  assert.equal(result.directions[0]?.failures[0]?.stage, "compare");
  assert.deepEqual(result.operations, { parses: 2, serializations: 1, strictComparisons: 1, laps: 0, directions: 1 });
});

check("exhaustive mode may continue from a parsed but divergent graph", () => {
  const boundary = boundary_with_hooks({
    afterParse: (ordinal, _format, node) => ordinal === 2 ? change_first_scalar(node) : node,
  });
  const result = execute({ stopOnFirstFail: false }, boundary);
  assert.equal(result.directions[0]?.completed, true);
  assert.equal(result.directions[0]?.ok, false);
  assert.deepEqual(result.operations, { parses: 5, serializations: 4, strictComparisons: 4, laps: 1, directions: 1 });
});

check("second-lap serialization failure preserves only the completed first lap", () => {
  const boundary = boundary_with_hooks({ beforeSerialize: (ordinal) => { if (ordinal === 5) throw new Error("lap-two-bang"); } });
  const result = execute({ stopOnFirstFail: false }, boundary, { times: 3, dual: false, direction: "cw" });
  assert.equal(result.directions[0]?.completedLaps, 1);
  assert.equal(result.directions[0]?.failures[0]?.lap, 1);
  assert.deepEqual(result.operations, { parses: 5, serializations: 5, strictComparisons: 4, laps: 1, directions: 1 });
});

check("second-lap parse failure suppresses later dependent work", () => {
  const boundary = boundary_with_hooks({ beforeParse: (ordinal) => { if (ordinal === 6) throw new Error("lap-two-parse"); } });
  const result = execute({ stopOnFirstFail: false }, boundary, { times: 3, dual: false, direction: "cw" });
  assert.equal(result.directions[0]?.completedLaps, 1);
  assert.equal(result.operations.serializations, 5);
  assert.equal(result.operations.parses, 6);
  assert.equal(result.operations.strictComparisons, 4);
});

check("CW failure with fail-fast enabled prevents CCW", () => {
  const boundary = boundary_with_hooks({ beforeSerialize: (ordinal) => { if (ordinal === 1) throw new Error("cw-bang"); } });
  const result = execute({ stopOnFirstFail: true }, boundary, { times: 1, dual: true, direction: "cw" });
  assert.equal(result.directions.length, 1);
  assert.equal(result.operations.directions, 1);
  assert.equal(result.finalComparison, undefined);
});

check("CW terminal failure permits the independent CCW branch in exhaustive mode", () => {
  const boundary = boundary_with_hooks({ beforeSerialize: (ordinal) => { if (ordinal === 1) throw new Error("cw-only"); } });
  const result = execute({ stopOnFirstFail: false }, boundary, { times: 1, dual: true, direction: "cw" });
  assert.equal(result.directions.length, 2);
  assert.equal(result.directions[1]?.completed, true);
  assert.deepEqual(result.operations, { parses: 5, serializations: 5, strictComparisons: 4, laps: 1, directions: 2 });
});

check("no final comparison runs when CW has no completed valid result", () => {
  const boundary = boundary_with_hooks({ beforeSerialize: (ordinal) => { if (ordinal === 1) throw new Error("cw-only"); } });
  const result = execute({ stopOnFirstFail: false }, boundary, { times: 1, dual: true, direction: "cw" });
  assert.equal(result.finalComparison?.performed, false);
  assert.equal(result.operations.strictComparisons, 4);
});

check("no final comparison runs when CCW has no completed valid result", () => {
  const boundary = boundary_with_hooks({ beforeSerialize: (ordinal) => { if (ordinal === 5) throw new Error("ccw-only"); } });
  const result = execute({ stopOnFirstFail: false }, boundary, { times: 1, dual: true, direction: "cw" });
  assert.equal(result.directions[0]?.completed, true);
  assert.equal(result.directions[1]?.completed, false);
  assert.equal(result.finalComparison?.performed, false);
  assert.deepEqual(result.operations, { parses: 5, serializations: 5, strictComparisons: 4, laps: 1, directions: 2 });
});

check("cancellation before the first direction performs only admission", () => {
  const result = execute({ shouldCancel: (point) => point.stage === "before-direction" });
  assert.equal(result.executionFailure?.stage, "cancel");
  assert.deepEqual(result.operations, { parses: 1, serializations: 0, strictComparisons: 0, laps: 0, directions: 0 });
});

check("cancellation can stop safely between conversion legs", () => {
  const result = execute({
    shouldCancel: (point) => point.stage === "before-leg" && point.leg === 2,
  });
  assert.equal(result.directions[0]?.failures[0]?.stage, "cancel");
  assert.deepEqual(result.operations, { parses: 3, serializations: 2, strictComparisons: 2, laps: 0, directions: 1 });
});

check("cancellation between laps retains the completed prior lap", () => {
  const result = execute(
    { shouldCancel: (point) => point.stage === "between-laps" },
    universalCircuitBoundary,
    { times: 3, dual: false, direction: "cw" },
  );
  assert.equal(result.directions[0]?.completedLaps, 1);
  assert.deepEqual(result.operations, { parses: 5, serializations: 4, strictComparisons: 4, laps: 1, directions: 1 });
});

check("cancellation before the opposite direction is structured", () => {
  const result = execute(
    { shouldCancel: (point) => point.stage === "before-opposite-direction" },
    universalCircuitBoundary,
    { times: 1, dual: true, direction: "cw" },
  );
  assert.equal(result.executionFailure?.stage, "cancel");
  assert.equal(result.directions.length, 1);
  assert.deepEqual(result.operations, { parses: 5, serializations: 4, strictComparisons: 4, laps: 1, directions: 1 });
});

check("cancellation before final comparison preserves both completed directions", () => {
  const result = execute(
    { shouldCancel: (point) => point.stage === "before-final-comparison" },
    universalCircuitBoundary,
    { times: 1, dual: true, direction: "cw" },
  );
  assert.equal(result.executionFailure?.stage, "cancel");
  assert.equal(result.directions.length, 2);
  assert.deepEqual(result.operations, { parses: 9, serializations: 8, strictComparisons: 8, laps: 2, directions: 2 });
});

check("cancellation checkpoints are deterministic and bounded", () => {
  const observed: string[] = [];
  execute({ shouldCancel: (point) => { observed.push(`${point.stage}:${point.direction ?? "-"}:${point.lap ?? "-"}:${point.leg ?? "-"}`); return false; } });
  assert.deepEqual(observed, [
    "before-direction:cw:-:-",
    "before-leg:cw:0:0",
    "before-leg:cw:0:1",
    "before-leg:cw:0:2",
    "before-leg:cw:0:3",
  ]);
});

check("one direction one lap authoritative operation accounting is exact", () => {
  const result = execute();
  assert.deepEqual(result.operations, { parses: 5, serializations: 4, strictComparisons: 4, laps: 1, directions: 1 });
});

check("dual three-lap authoritative operation accounting is exact", () => {
  const result = execute(
    { capture: false, verbose: false, paranoid: false, stopOnFirstFail: true },
    universalCircuitBoundary,
    { times: 3, dual: true, direction: "cw" },
  );
  assert.deepEqual(result.operations, { parses: 25, serializations: 24, strictComparisons: 25, laps: 6, directions: 2 });
});

check("capture changes retention but not semantic operation counts", () => {
  const plain = execute({}, universalCircuitBoundary, { times: 2, dual: true, direction: "cw" });
  const captured = execute({ capture: true }, universalCircuitBoundary, { times: 2, dual: true, direction: "cw" });
  assert.deepEqual(captured.operations, plain.operations);
  assert.equal(captured.directions[0]?.laps?.[0]?.legs?.[0]?.material !== undefined, true);
});

check("paranoid mode adds twelve explicit cross-direction checks for three laps", () => {
  const result = execute(
    { paranoid: true },
    universalCircuitBoundary,
    { times: 3, dual: true, direction: "cw" },
  );
  assert.equal(result.finalComparison?.paranoidComparisons, 12);
  assert.deepEqual(result.operations, { parses: 25, serializations: 24, strictComparisons: 37, laps: 6, directions: 2 });
});

check("paranoid mode retains only explicit parsed checkpoints", () => {
  const result = execute({ paranoid: true }, universalCircuitBoundary, { times: 2, dual: true, direction: "cw" });
  assert.equal(result.directions[0]?.checkpoints?.length, 8);
  assert.equal(result.directions[1]?.checkpoints?.length, 8);
  assert.equal(result.directions[0]?.laps, undefined);
});

check("operation accounting is independent of wall-clock readings", () => {
  let tick = 0;
  const timed = execute({ now: () => { tick += 7; return tick; } });
  const fixed = execute({ now: () => 0 });
  assert.deepEqual(timed.operations, fixed.operations);
  assert.equal(timed.ok, fixed.ok);
});

check("closure parse failure is terminal even in exhaustive mode", () => {
  const boundary = boundary_with_hooks({
    beforeParse: (ordinal) => { if (ordinal === 5) throw new Error("closure-parse"); },
  });
  const result = execute({ stopOnFirstFail: false }, boundary, { times: 2, dual: false, direction: "cw" });
  assert.equal(result.directions[0]?.failures[0]?.stage, "parse");
  assert.equal(result.directions[0]?.failures[0]?.leg, 3);
  assert.equal(result.directions[0]?.completedLaps, 0);
  assert.deepEqual(result.operations, { parses: 5, serializations: 4, strictComparisons: 3, laps: 0, directions: 1 });
});

assert.equal(checks, 25);
process.stdout.write(`# ${checks} circuit failure and execution-control checks passed\n`);
testEvents.terminal("pass");
emit_hson_live_test_completion(LAUNCHER, checks, checks, 0);
