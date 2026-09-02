import { create_test_event_emitter } from "./test-events.mjs";
// @hson-live-external-test

import assert from "node:assert/strict";
import { assert_operator } from "./livemap-operators/operator-catalog.mts";
import { admission_schema_operators } from "./livemap-operators/all-operators.mts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.deterministic-admission-schema-operators",
  title: "Deterministic LiveMap admission and schema operators",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["projected-value", "operators", "admission", "schema", "deterministic", "externally-discoverable"]),
});

const testEvents = create_test_event_emitter("livemap.deterministic-admission-schema-operators");
let checks = 0;
function check(operator: typeof admission_schema_operators[number]): void {
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

check(admission_schema_operators[0]!);
check(admission_schema_operators[1]!);
check(admission_schema_operators[2]!);
check(admission_schema_operators[3]!);
check(admission_schema_operators[4]!);
check(admission_schema_operators[5]!);
check(admission_schema_operators[6]!);
check(admission_schema_operators[7]!);
check(admission_schema_operators[8]!);
check(admission_schema_operators[9]!);
check(admission_schema_operators[10]!);
check(admission_schema_operators[11]!);
check(admission_schema_operators[12]!);
check(admission_schema_operators[13]!);
check(admission_schema_operators[14]!);
check(admission_schema_operators[15]!);
check(admission_schema_operators[16]!);
check(admission_schema_operators[17]!);
check(admission_schema_operators[18]!);
check(admission_schema_operators[19]!);

assert.equal(checks, 20);
process.stdout.write(`# ${checks} deterministic LiveMap admission and schema operators passed\n`);
testEvents.terminal("pass");
