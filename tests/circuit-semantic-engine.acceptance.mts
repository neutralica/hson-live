import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import assert from "node:assert/strict";
import { hsonTransform } from "../src/api/transform/index.ts";
import {
  execute_circuit,
  prepare_explicit_entry,
  run_conversion_leg,
  run_direction,
  run_directional_lap,
  type CircuitEntry,
  type CircuitTransformBoundary,
} from "../src/diagnostics/circuit-engine.ts";
import type { HsonNode } from "../src/core/types.ts";
import { universalCircuitBoundary } from "./circuit-test-helpers.mts";

const LAUNCHER = "diagnostics.circuit-semantic-engine";
const JSON_SOURCE = '{"a":1,"b":[true,"x"]}';
let checks = 0;

function check(name: string, run: () => void): void {
  run();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function prepared_json() {
  const result = prepare_explicit_entry(universalCircuitBoundary, "json", JSON_SOURCE, { now: () => 0 });
  assert.ok(result.prepared);
  return result.prepared;
}

function strict_leg(expected: HsonNode, actual: HsonNode) {
  const boundary: CircuitTransformBoundary = Object.freeze({
    identity: "strict-fixture",
    serialize: () => "fixture",
    parse: () => actual,
  });
  return run_conversion_leg(
    boundary,
    { format: "json", text: "fixture", node: expected },
    "json",
    { direction: "cw", lap: 0, leg: 0 },
    { now: () => 0 },
  );
}

function from_json(source: string): HsonNode {
  return hsonTransform.fromJson(source).toNode();
}

function from_html(source: string): HsonNode {
  return hsonTransform.fromTrustedHtml(source).toNode();
}

check("explicit preparation admits once and records its boundary", () => {
  const result = prepare_explicit_entry(universalCircuitBoundary, "json", JSON_SOURCE, { now: () => 0 });
  assert.equal(result.failure, undefined);
  assert.equal(result.prepared?.entry, "json");
  assert.equal(result.prepared?.boundaryIdentity, "universal-htmlparser2");
  assert.deepEqual(result.operations, { parses: 1, serializations: 0, strictComparisons: 0, laps: 0, directions: 0 });
});

check("one conversion leg owns serialization, parse, and strict evidence", () => {
  const prepared = prepared_json();
  const result = run_conversion_leg(
    universalCircuitBoundary,
    { format: prepared.entry, text: prepared.text, node: prepared.node },
    "hson",
    { direction: "cw", lap: 0, leg: 0 },
    { now: () => 0 },
  );
  assert.equal(result.leg.comparison?.equal, true);
  assert.equal(result.leg.next?.format, "hson");
  assert.ok(result.leg.serializedOutput);
  assert.deepEqual(result.operations, { parses: 1, serializations: 1, strictComparisons: 1, laps: 0, directions: 0 });
});

check("one direction and one lap executes four source-sensitive legs", () => {
  const result = run_directional_lap(universalCircuitBoundary, prepared_json(), "cw", { now: () => 0 });
  assert.equal(result.lap.completed, true);
  assert.equal(result.lap.next.format, "json");
  assert.deepEqual(result.operations, { parses: 4, serializations: 4, strictComparisons: 4, laps: 1, directions: 1 });
});

check("CW uses the resolved entry rotation and one closure", () => {
  const result = run_direction(universalCircuitBoundary, prepared_json(), "cw", 1, { verbose: true, now: () => 0 });
  assert.deepEqual(result.direction.laps?.[0]?.legs?.map((leg) => leg.targetFormat), ["json", "html", "hson", "json"]);
  assert.deepEqual(result.direction.laps?.[0]?.legs?.map((leg) => leg.phase), ["conversion", "conversion", "conversion", "closure"]);
});

check("CCW independently uses its reverse rotation", () => {
  const result = run_direction(universalCircuitBoundary, prepared_json(), "ccw", 1, { verbose: true, now: () => 0 });
  assert.deepEqual(result.direction.laps?.[0]?.legs?.map((leg) => leg.targetFormat), ["json", "hson", "html", "json"]);
});

check("explicit HSON dual three-lap accounting reuses one prepared admission", () => {
  const source = hsonTransform.fromJson(JSON_SOURCE).toHson().serialize();
  const result = execute_circuit(
    universalCircuitBoundary,
    "hson",
    source,
    { times: 3, dual: true, direction: "cw" },
    { capture: false, verbose: false, paranoid: false, stopOnFirstFail: true, now: () => 0 },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.operations, { parses: 25, serializations: 24, strictComparisons: 25, laps: 6, directions: 2 });
});

check("times controls the number of actually completed laps", () => {
  const result = execute_circuit(universalCircuitBoundary, "json", JSON_SOURCE, { times: 4, dual: false, direction: "cw" }, { now: () => 0 });
  assert.equal(result.directions[0]?.completedLaps, 4);
  assert.equal(result.operations.laps, 4);
  assert.equal(result.operations.serializations, 16);
});

check("explicit JSON is authoritative and never redispatched as another entry", () => {
  const parsed: CircuitEntry[] = [];
  const boundary: CircuitTransformBoundary = Object.freeze({
    ...universalCircuitBoundary,
    parse(format: CircuitEntry, text: string): HsonNode {
      parsed.push(format);
      return universalCircuitBoundary.parse(format, text);
    },
  });
  execute_circuit(boundary, "json", '"<ambiguous>"', { times: 1, dual: false, direction: "cw" }, { now: () => 0 });
  assert.equal(parsed[0], "json");
  assert.equal(parsed.filter((format) => format === "json").length, 3);
});

check("explicit HSON is resolved once before repeated laps", () => {
  const source = hsonTransform.fromJson(JSON_SOURCE).toHson().serialize();
  const result = execute_circuit(universalCircuitBoundary, "hson", source, { times: 2, dual: false, direction: "cw" }, { now: () => 0 });
  assert.equal(result.ok, true);
  assert.equal(result.prepared?.entry, "hson");
  assert.equal(result.operations.parses, 9);
});

check("explicit HTML uses the injected universal HTML boundary", () => {
  const result = execute_circuit(universalCircuitBoundary, "html", "<main>hello</main>", { times: 1, dual: false, direction: "ccw" }, { now: () => 0 });
  assert.equal(result.ok, true);
  assert.equal(result.boundaryIdentity, "universal-htmlparser2");
});

check("quiet uncaptured execution retains no lap or checkpoint structures", () => {
  const result = execute_circuit(universalCircuitBoundary, "json", JSON_SOURCE, { times: 1, dual: false, direction: "cw" }, { now: () => 0 });
  assert.equal(result.directions[0]?.laps, undefined);
  assert.equal(result.directions[0]?.checkpoints, undefined);
});

check("verbose retains summaries without capture-only material", () => {
  const result = execute_circuit(universalCircuitBoundary, "json", JSON_SOURCE, { times: 1, dual: false, direction: "cw" }, { verbose: true, now: () => 0 });
  assert.equal(result.directions[0]?.laps?.[0]?.legs?.length, 4);
  assert.equal(result.directions[0]?.laps?.[0]?.legs?.[0]?.material, undefined);
});

check("capture retains bounded per-leg source and parsed material", () => {
  const result = execute_circuit(universalCircuitBoundary, "json", JSON_SOURCE, { times: 1, dual: false, direction: "cw" }, { capture: true, now: () => 0 });
  const material = result.directions[0]?.laps?.[0]?.legs?.[0]?.material;
  assert.equal(material?.inputText, JSON_SOURCE);
  assert.ok(material?.serializedOutput);
  assert.ok(material?.sourceNode);
  assert.ok(material?.parsedNode);
});

check("semantic records and retained collections are immutable", () => {
  const result = execute_circuit(universalCircuitBoundary, "json", JSON_SOURCE, { times: 1, dual: false, direction: "cw" }, { capture: true, now: () => 0 });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.directions), true);
  assert.equal(Object.isFrozen(result.directions[0]), true);
  assert.equal(Object.isFrozen(result.directions[0]?.laps), true);
});

check("strict closure detects object-member ordering", () => {
  const result = strict_leg(from_json('{"a":1,"b":2}'), from_json('{"b":2,"a":1}'));
  assert.equal(result.leg.failure?.difference?.kind, "content-ordering");
});

check("strict closure detects representable duplicate-member loss", () => {
  const result = strict_leg(from_html("<main><x></x><x></x></main>"), from_html("<main><x></x></main>"));
  assert.equal(result.leg.comparison?.equal, false);
  assert.equal(result.leg.failure?.difference?.kind, "content-length");
});

check("strict closure detects object and element structural modes", () => {
  const result = strict_leg(from_json('{"a":1}'), from_html("<a>1</a>"));
  assert.equal(result.leg.failure?.difference?.kind, "structural-mode-mismatch");
});

check("strict closure detects metadata presence", () => {
  const expected = from_html("<a></a>");
  const actual = structuredClone(expected);
  const element = actual.$_content[0] as HsonNode;
  const child = element.$_content[0] as HsonNode;
  child.$_meta = { quid: "0000000000000001" };
  const result = strict_leg(expected, actual);
  assert.equal(result.leg.failure?.difference?.kind, "metadata-presence");
});

check("strict closure detects QUID identity", () => {
  const expected = from_html("<a></a>");
  const actual = structuredClone(expected);
  const expectedChild = (expected.$_content[0] as HsonNode).$_content[0] as HsonNode;
  const actualChild = (actual.$_content[0] as HsonNode).$_content[0] as HsonNode;
  expectedChild.$_meta = { quid: "0000000000000001" };
  actualChild.$_meta = { quid: "0000000000000002" };
  const result = strict_leg(expected, actual);
  assert.equal(result.leg.failure?.difference?.kind, "quid-difference");
});

check("strict closure distinguishes zero from negative zero", () => {
  const result = strict_leg(from_json("0"), from_json("-0"));
  assert.equal(result.leg.failure?.difference?.kind, "negative-zero-mismatch");
});

check("strict closure distinguishes primitive types", () => {
  const result = strict_leg(from_json("0"), from_json("false"));
  assert.equal(result.leg.failure?.difference?.kind, "value-type-mismatch");
});

check("strict closure preserves array positions", () => {
  const result = strict_leg(from_json("[1,2]"), from_json("[2,1]"));
  assert.equal(result.leg.comparison?.equal, false);
  assert.notEqual(result.leg.failure?.difference?.path, undefined);
});

check("strict closure compares dangerous keys as own canonical members", () => {
  const result = strict_leg(from_json('{"__proto__":"safe"}'), from_json('{"__proto__":"changed"}'));
  assert.equal(result.leg.comparison?.equal, false);
});

check("strict closure preserves isolated surrogate code units", () => {
  const result = strict_leg(from_json('"\\ud800"'), from_json('"\\ud801"'));
  assert.equal(result.leg.comparison?.equal, false);
  assert.equal(result.leg.failure?.difference?.kind, "scalar-value-mismatch");
});

check("strict closure distinguishes element, object, and fragment graphs", () => {
  const object = from_json('{"a":1}');
  const element = from_html("<a></a>");
  const fragment = from_html("<a></a><b></b>");
  assert.equal(strict_leg(object, element).leg.comparison?.equal, false);
  assert.equal(strict_leg(element, fragment).leg.comparison?.equal, false);
});

assert.equal(checks, 25);
process.stdout.write(`# ${checks} circuit semantic engine checks passed\n`);
emit_hson_live_test_completion(LAUNCHER, checks, checks, 0);
