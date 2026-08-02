import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
// @hson-live-external-test

import assert from "node:assert/strict";
import { assert_operator } from "./livemap-operators/operator-catalog.mts";
import { transport_propagation_operators } from "./livemap-operators/all-operators.mts";

let checks = 0;
function check(operator: typeof transport_propagation_operators[number]): void {
  const observed = assert_operator(operator);
  assert.equal(observed.classification, operator.expected);
  checks += 1;
  process.stdout.write(`ok ${checks} - ${operator.reproductionId} ${operator.name}\n`);
}

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
emit_hson_live_test_completion("livemap.deterministic-transport-propagation-operators", checks, checks, 0);
