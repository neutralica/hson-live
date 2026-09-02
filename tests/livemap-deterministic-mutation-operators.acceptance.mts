import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import { create_test_event_emitter } from "./test-events.mjs";
// @hson-live-external-test

import assert from "node:assert/strict";
import { assert_operator } from "./livemap-operators/operator-catalog.mts";
import { mutation_operators } from "./livemap-operators/all-operators.mts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.deterministic-mutation-operators",
  title: "Deterministic LiveMap mutation operators",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["projected-value", "operators", "mutation", "deterministic", "externally-discoverable"]),
});

const testEvents = create_test_event_emitter("livemap.deterministic-mutation-operators");
let checks = 0;
function check(operator: typeof mutation_operators[number]): void {
  testEvents.case_begin(operator.reproductionId, operator.name);
  try {
  const observed = assert_operator(operator);
  assert.equal(observed.classification, operator.expected);
  checks += 1;
  process.stdout.write(`ok ${checks} - ${operator.reproductionId} ${operator.name}\n`);

    testEvents.case_end(operator.reproductionId, "pass");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Check failed.";
    testEvents.diagnostic(operator.reproductionId, "assertion", message.slice(0, 1_000));
    testEvents.case_end(operator.reproductionId, "fail");
    testEvents.terminal("fail");
    throw error;
  }}

check(mutation_operators[0]!);
check(mutation_operators[1]!);
check(mutation_operators[2]!);
check(mutation_operators[3]!);
check(mutation_operators[4]!);
check(mutation_operators[5]!);
check(mutation_operators[6]!);
check(mutation_operators[7]!);
check(mutation_operators[8]!);
check(mutation_operators[9]!);
check(mutation_operators[10]!);
check(mutation_operators[11]!);
check(mutation_operators[12]!);
check(mutation_operators[13]!);
check(mutation_operators[14]!);
check(mutation_operators[15]!);
check(mutation_operators[16]!);
check(mutation_operators[17]!);
check(mutation_operators[18]!);
check(mutation_operators[19]!);

assert.equal(checks, 20);
process.stdout.write(`# ${checks} deterministic LiveMap mutation operators passed\n`);
testEvents.terminal("pass");
emit_hson_live_test_completion("livemap.deterministic-mutation-operators", checks, checks, 0);
