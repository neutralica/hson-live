// @hson-live-external-test
import assert from "node:assert/strict";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import { hsonTransform } from "../src/api/transform/index.ts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import type { HsonNode } from "../src/core/types.ts";
import {
  verify_universal_circuit,
  type UniversalCircuitProgress,
} from "../src/diagnostics/verify-universal-circuit.ts";
import { universalCircuitBoundary } from "./circuit-test-helpers.mts";

const LAUNCHER = "diagnostics.universal-circuit-verification";
const JSON_SOURCE = '{"alpha":1,"beta":[true,"worker"]}';
const HSON_SOURCE = hsonTransform.fromJson(JSON_SOURCE).toHson().serialize();
let checks = 0;

function check(name: string, run: () => void): void {
  run();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

async function check_async(name: string, run: () => void | Promise<void>): Promise<void> {
  await run();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function representationSha(format: "hson" | "json" | "html", node: HsonNode): Promise<string> {
  const source = hsonTransform.fromNode(node);
  if (format === "hson") return source.toHson().sha256();
  if (format === "json") return source.toJson().sha256();
  return source.toHtml().sha256();
}

async function assertRepresentationCircuitWitness(format: "hson" | "json" | "html"): Promise<void> {
  const graph0 = universalCircuitBoundary.parse("json", JSON_SOURCE);
  const representation0 = universalCircuitBoundary.serialize(format, graph0);
  const graph1 = universalCircuitBoundary.parse(format, representation0);
  assert.equal(canonical_hson_graph_equal(graph0, graph1), true);
  const representation1 = universalCircuitBoundary.serialize(format, graph1);
  assert.equal(representation1, representation0);
  assert.equal(await representationSha(format, graph1), await representationSha(format, graph0));
}

function verified(entry: "hson" | "json" | "html", source: string) {
  return verify_universal_circuit({ entry, source }, { now: () => 0 });
}

check("explicit HSON verifies through the universal boundary", () => {
  const result = verified("hson", HSON_SOURCE);
  assert.equal(result.status, "verified");
  assert.equal(result.boundary, "universal-htmlparser2");
});

check("explicit JSON verifies without entry redispatch", () => {
  const result = verified("json", JSON_SOURCE);
  assert.equal(result.status, "verified");
  assert.equal(result.entry, "json");
});

check("explicit HTML uses the htmlparser2 Transform path", () => {
  const result = verified("html", '<main data-phase="2">worker</main>');
  assert.equal(result.status, "verified");
  assert.equal(result.boundary, "universal-htmlparser2");
});

check("fixed Phase 2 accounting remains exact", () => {
  assert.deepEqual(verified("hson", HSON_SOURCE).operationCounts, {
    serializations: 24,
    parses: 25,
    comparisons: 25,
    laps: 6,
    directions: 2,
  });
});

check("certificate material contains only detached strings", () => {
  const result = verified("json", JSON_SOURCE);
  assert.equal(typeof result.baselineHson, "string");
  assert.equal(typeof result.clockwiseFinalHson, "string");
  assert.equal(typeof result.counterclockwiseFinalHson, "string");
  assert.equal(typeof result.finalHtml, "string");
});

check("certificate material survives JSON detachment", () => {
  const result = JSON.parse(JSON.stringify(verified("json", JSON_SOURCE))) as Record<string, unknown>;
  assert.equal(result.status, "verified");
  assert.equal(JSON.stringify(result).includes("$_content"), false);
});

check("progress reports six laps and one comparison boundary", () => {
  const progress: UniversalCircuitProgress[] = [];
  verify_universal_circuit({ entry: "hson", source: HSON_SOURCE }, { now: () => 0, onProgress: (event) => progress.push(event) });
  assert.equal(progress.length, 7);
  assert.deepEqual(progress.map((event) => event.stage), [
    "cw-lap-complete", "cw-lap-complete", "cw-lap-complete",
    "ccw-lap-complete", "ccw-lap-complete", "ccw-lap-complete", "comparing",
  ]);
});

check("progress uses monotonic completed counts", () => {
  const completed: number[] = [];
  verify_universal_circuit({ entry: "hson", source: HSON_SOURCE }, { now: () => 0, onProgress: (event) => completed.push(event.completed) });
  assert.deepEqual(completed, [1, 2, 3, 4, 5, 6, 6]);
});

check("progress is naturally bounded to seven semantic stages", () => {
  const totals = new Set<number>();
  verify_universal_circuit({ entry: "hson", source: HSON_SOURCE }, { now: () => 0, onProgress: (event) => totals.add(event.total) });
  assert.deepEqual([...totals], [7]);
});

check("cancellation before the first direction is structured", () => {
  const result = verify_universal_circuit({ entry: "json", source: JSON_SOURCE }, { now: () => 0, shouldCancel: () => true });
  assert.equal(result.status, "cancelled");
  assert.equal(result.failure?.code, "CIRCUIT_CANCELLED");
  assert.deepEqual(result.operationCounts, { serializations: 0, parses: 1, comparisons: 0, laps: 0, directions: 0 });
});

check("cancellation after a completed lap stops at the next checkpoint", () => {
  let cancel = false;
  const result = verify_universal_circuit({ entry: "hson", source: HSON_SOURCE }, {
    now: () => 0,
    onProgress: (event) => { if (event.stage === "cw-lap-complete" && event.lap === 1) cancel = true; },
    shouldCancel: () => cancel,
  });
  assert.equal(result.status, "cancelled");
  assert.equal(result.operationCounts.laps, 1);
  assert.equal(result.operationCounts.directions, 1);
});

check("malformed explicit HSON is a terminal preparation failure", () => {
  const result = verified("hson", "a: «unterminated");
  assert.equal(result.status, "failed");
  assert.equal(result.failure?.code, "CIRCUIT_PREPARE_FAILED");
  assert.equal(result.operationCounts.parses, 1);
});

check("malformed explicit JSON is a terminal preparation failure", () => {
  const result = verified("json", "{");
  assert.equal(result.status, "failed");
  assert.equal(result.failure?.stage, "prepare");
});

check("public failures do not echo malformed source", () => {
  const secret = "unique-source-that-must-not-escape:{";
  const result = verified("json", secret);
  assert.equal(JSON.stringify(result).includes(secret), false);
});

check("progress observer failures cannot alter verification", () => {
  const result = verify_universal_circuit({ entry: "json", source: JSON_SOURCE }, {
    now: () => 0,
    onProgress: () => { throw new Error("observer failure"); },
  });
  assert.equal(result.status, "verified");
});

check("fixed-time repeated certificates are deterministic", () => {
  assert.deepEqual(verified("json", JSON_SOURCE), verified("json", JSON_SOURCE));
});

check("dangerous keys retain canonical identity", () => {
  const result = verified("json", '{"__proto__":"safe","constructor":"value"}');
  assert.equal(result.status, "verified");
  assert.match(result.baselineHson ?? "", /__proto__/);
});

check("Unicode survives the universal circuit", () => {
  const result = verified("json", '{"text":"𝄞 café 日本語"}');
  assert.equal(result.status, "verified");
  assert.match(result.baselineHson ?? "", /café/);
});

check("quoted HSON member names survive the worker-facing facade", () => {
  const source = hsonTransform.fromJson('{"a b":1,"quoted:name":2}').toHson().serialize();
  const result = verified("hson", source);
  assert.equal(result.status, "verified");
  assert.match(result.baselineHson ?? "", /'a b'/);
});

check("auto is rejected at the diagnostics boundary", () => {
  assert.throws(
    () => verify_universal_circuit({ entry: "auto", source: JSON_SOURCE } as never),
    /CIRCUIT_REQUEST_INVALID/,
  );
});

check("non-string source is rejected at the diagnostics boundary", () => {
  assert.throws(
    () => verify_universal_circuit({ entry: "json", source: 1 } as never),
    /CIRCUIT_REQUEST_INVALID/,
  );
});

check("the facade result and nested evidence are immutable", () => {
  const result = verified("json", JSON_SOURCE);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.operationCounts), true);
});

await check_async("HSON circuit retains exact output with a SHA witness", () => {
  return assertRepresentationCircuitWitness("hson");
});

await check_async("JSON circuit retains exact output with a SHA witness", () => {
  return assertRepresentationCircuitWitness("json");
});

await check_async("HTML circuit retains exact output with a SHA witness", () => {
  return assertRepresentationCircuitWitness("html");
});

assert.equal(checks, 25);
process.stdout.write(`# ${checks} universal circuit verification checks passed\n`);
emit_hson_live_test_completion(LAUNCHER, checks, checks, 0);
