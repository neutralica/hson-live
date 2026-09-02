import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import { create_test_event_emitter } from "./test-events.mjs";
// @hson-live-external-test

import assert from "node:assert/strict";
import { assert_operator } from "./livemap-operators/operator-catalog.mts";
import { transport_propagation_operators } from "./livemap-operators/all-operators.mts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.deterministic-transport-propagation-operators",
  title: "Deterministic LiveMap transport and propagation operators",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["projected-value", "operators", "capture", "replay", "propagation", "deterministic", "externally-discoverable"]),
});

const testEvents = create_test_event_emitter("livemap.deterministic-transport-propagation-operators");
let checks = 0;
function check(operator: typeof transport_propagation_operators[number]): void {
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

check(transport_propagation_operators[0]!);
check(transport_propagation_operators[1]!);
check(transport_propagation_operators[2]!);
check(transport_propagation_operators[3]!);
check(transport_propagation_operators[4]!);
check(transport_propagation_operators[5]!);
check(transport_propagation_operators[6]!);
check(transport_propagation_operators[7]!);
check(transport_propagation_operators[8]!);
check(transport_propagation_operators[9]!);
check(transport_propagation_operators[10]!);
check(transport_propagation_operators[11]!);
check(transport_propagation_operators[12]!);
check(transport_propagation_operators[13]!);
check(transport_propagation_operators[14]!);
check(transport_propagation_operators[15]!);
check(transport_propagation_operators[16]!);
check(transport_propagation_operators[17]!);
check(transport_propagation_operators[18]!);
check(transport_propagation_operators[19]!);

assert.equal(checks, 20);
process.stdout.write(`# ${checks} deterministic LiveMap transport and propagation operators passed\n`);
testEvents.terminal("pass");
emit_hson_live_test_completion("livemap.deterministic-transport-propagation-operators", checks, checks, 0);
