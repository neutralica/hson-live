import assert from "node:assert/strict";
import { admit_projected_value } from "../src/core/projected-value-admission.ts";
import { evaluate_canonical_projected_schema } from "../src/internal/canonical-schema/evaluate.ts";
import { CANONICAL_SCHEMA_FORMAT, CANONICAL_SCHEMA_VERSION, type CanonicalRefinementRule } from "../src/internal/canonical-schema/graph.ts";
import { verify_canonical_schema_graph } from "../src/internal/canonical-schema/verify.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

let checks = 0;
const check = (name: string, run: () => void): void => { run(); console.log(`ok ${++checks} - ${name}`); };
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
check("semantic diagnostic metadata changes expected evidence", () => {
  const verified = verify_canonical_schema_graph({ format: CANONICAL_SCHEMA_FORMAT, version: CANONICAL_SCHEMA_VERSION, capabilities: { projectedRoot: 0 }, nodes: [{ kind: "projected-number" }], semanticDiagnosticMetadata: { labels: [[0, "finite count"]] } });
  assert.equal(verified.ok, true); if (!verified.ok) return;
  assert.equal(evaluate_canonical_projected_schema(verified.graph, admit_projected_value("bad")).issues[0]?.expected, "finite count");
});

emit_hson_live_test_completion("canonical-schema-refinement", checks, checks, 0);
