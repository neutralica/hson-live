import assert from "node:assert/strict";
import { admit_projected_value } from "../src/core/projected-value-admission.ts";
import { evaluate_canonical_projected_schema } from "../src/internal/canonical-schema/evaluate.ts";
import { CANONICAL_SCHEMA_FORMAT, CANONICAL_SCHEMA_VERSION, type CanonicalRefinementRule } from "../src/internal/canonical-schema/graph.ts";
import { verify_canonical_schema_graph } from "../src/internal/canonical-schema/verify.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "canonical-schema-refinement",
  title: "Canonical Schema refinement",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["hson-schema", "canonical-schema", "refinement"]),
});

const testEvents = create_test_event_emitter("canonical-schema-refinement");
let checks = 0;
const check = (name: string, run: () => void): void => {
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
  } console.log(`ok ${++checks} - ${name}`); };
const evaluate = (base: string, rule: CanonicalRefinementRule, value: unknown) => {
  const verified = verify_canonical_schema_graph({ format: CANONICAL_SCHEMA_FORMAT, version: CANONICAL_SCHEMA_VERSION, capabilities: { projectedRoot: 0 }, nodes: [{ kind: "projected-refinement", base: 1, rule }, { kind: base }] });
  assert.equal(verified.ok, true); if (!verified.ok) throw new Error("invalid fixture graph");
  return evaluate_canonical_projected_schema(verified.graph, admit_projected_value(value));
};

check("inclusive numeric lower bound", () => assert.equal(evaluate("projected-number", { kind: "number-lower-bound", value: 2, inclusive: true }, 2).ok, true));
check("exclusive numeric lower bound", () => assert.equal(evaluate("projected-number", { kind: "number-lower-bound", value: 2, inclusive: false }, 2).ok, false));
check("numeric upper bound", () => assert.equal(evaluate("projected-number", { kind: "number-upper-bound", value: 3, inclusive: true }, 4).issues[0]?.evidence.kind, "refinement-failure"));
check("integer rule", () => assert.equal(evaluate("projected-number", { kind: "integer" }, 1.5).ok, false));
check("string length counts Unicode code points", () => assert.equal(evaluate("projected-string", { kind: "string-length", minimum: 1, maximum: 1 }, "😀").ok, true));
check("literal prefix pattern", () => assert.equal(evaluate("projected-string", { kind: "string-pattern", dialect: "literal-string-v1", mode: "prefix", pattern: "id_" }, "id_7").ok, true));
check("pattern data has no RegExp interpretation", () => assert.equal(evaluate("projected-string", { kind: "string-pattern", dialect: "literal-string-v1", mode: "full", pattern: ".*" }, "anything").ok, false));
check("array collection length", () => assert.equal(evaluate("projected-array", { kind: "collection-length", minimum: 2, maximum: 3 }, [1]).ok, false));
check("array uniqueness uses canonical literal equality including negative zero", () => assert.equal(evaluate("projected-array", { kind: "array-unique" }, [0, -0]).ok, true));
check("array uniqueness detects ordered structured duplicates", () => assert.equal(evaluate("projected-array", { kind: "array-unique" }, [{ a: 1 }, { a: 1 }]).ok, false));
check("numeric refinement failure carries the closed bound rule", () => assert.deepEqual(evaluate("projected-number", { kind: "number-lower-bound", value: 2, inclusive: false }, 2).issues[0]?.evidence.refinement, { kind: "number-lower-bound", value: 2, inclusive: false }));
check("length refinement failure carries canonical actual code-point count", () => assert.equal(evaluate("projected-string", { kind: "string-length", maximum: 1 }, "e\u0301").issues[0]?.evidence.actualLength, 2));
check("semantic diagnostic metadata changes expected evidence", () => {
  const verified = verify_canonical_schema_graph({ format: CANONICAL_SCHEMA_FORMAT, version: CANONICAL_SCHEMA_VERSION, capabilities: { projectedRoot: 0 }, nodes: [{ kind: "projected-number" }], semanticDiagnosticMetadata: { labels: [[0, "finite count"]] } });
  assert.equal(verified.ok, true); if (!verified.ok) return;
  assert.equal(evaluate_canonical_projected_schema(verified.graph, admit_projected_value("bad")).issues[0]?.expected, "finite count");
});

testEvents.terminal("pass");
