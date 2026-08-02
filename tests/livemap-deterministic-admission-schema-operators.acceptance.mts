import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
// @hson-live-external-test

import assert from "node:assert/strict";
import { assert_operator } from "./livemap-operators/operator-catalog.mts";
import { admission_schema_operators } from "./livemap-operators/all-operators.mts";

let checks = 0;
function check(operator: typeof admission_schema_operators[number]): void {
  const observed = assert_operator(operator);
  assert.equal(observed.classification, operator.expected);
  checks += 1;
  process.stdout.write(`ok ${checks} - ${operator.reproductionId} ${operator.name}\n`);
}

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
emit_hson_live_test_completion("livemap.deterministic-admission-schema-operators", checks, checks, 0);
