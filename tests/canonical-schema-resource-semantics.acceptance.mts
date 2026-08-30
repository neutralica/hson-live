import assert from "node:assert/strict";
import { parse_hson } from "../src/api/transform/parsers/parse-hson.ts";
import { admit_projected_value } from "../src/core/projected-value-admission.ts";
import {
  evaluate_canonical_document_schema,
  evaluate_canonical_projected_schema,
} from "../src/internal/canonical-schema/evaluate.ts";
import {
  CANONICAL_SCHEMA_FORMAT,
  CANONICAL_SCHEMA_FORMAT_LIMITS,
  CANONICAL_SCHEMA_VERSION,
  type CanonicalSchemaGraph,
} from "../src/internal/canonical-schema/graph.ts";
import { verify_canonical_schema_graph } from "../src/internal/canonical-schema/verify.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

let checks = 0;
const check = (name: string, run: () => void): void => { run(); console.log(`ok ${++checks} - ${name}`); };
const verified = (graph: CanonicalSchemaGraph) => {
  const result = verify_canonical_schema_graph(graph);
  if (!result.ok) assert.fail(JSON.stringify(result.issues));
  return result.graph;
};
const projected = (nodes: CanonicalSchemaGraph["nodes"]) => verified({ format: CANONICAL_SCHEMA_FORMAT, version: CANONICAL_SCHEMA_VERSION, capabilities: { projectedRoot: 0 }, nodes });
const exhausted = (result: Readonly<{ issues: readonly Readonly<{ evidence: Readonly<{ kind: string }> }>[] }>) => result.issues[0]?.evidence.kind === "resource-limit";

check("format node-count limit rejects deterministically", () => {
  const nodes = Array.from({ length: CANONICAL_SCHEMA_FORMAT_LIMITS.maxGraphNodes + 1 }, () => Object.freeze({ kind: "projected-any" as const }));
  const result = verify_canonical_schema_graph({ format: CANONICAL_SCHEMA_FORMAT, version: CANONICAL_SCHEMA_VERSION, capabilities: { projectedRoot: 0 }, nodes });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.issues[0]?.message ?? "", /format limit/);
});

check("test harness can lower the traversal-step budget", () => {
  const graph = projected([{ kind: "projected-optional", base: 1 }, { kind: "projected-string" }]);
  assert.equal(exhausted(evaluate_canonical_projected_schema(graph, admit_projected_value("x"), { maxSteps: 1 })), true);
});

check("candidate/reference depth has an independent budget", () => {
  const graph = projected([{ kind: "projected-optional", base: 1 }, { kind: "projected-nullable", base: 2 }, { kind: "projected-string" }]);
  assert.equal(exhausted(evaluate_canonical_projected_schema(graph, admit_projected_value("x"), { maxDepth: 1 })), true);
});

check("union branch work has an independent budget", () => {
  const graph = projected([{ kind: "projected-union", choices: [1, 2] }, { kind: "projected-string" }, { kind: "projected-number" }]);
  assert.equal(exhausted(evaluate_canonical_projected_schema(graph, admit_projected_value(true), { maxUnionWork: 1 })), true);
});

check("issue accumulation has an independent budget", () => {
  const graph = projected([{ kind: "projected-object", exact: true, properties: [["a", 1], ["b", 1]] }, { kind: "projected-string" }]);
  assert.equal(exhausted(evaluate_canonical_projected_schema(graph, admit_projected_value({}), { maxIssues: 1 })), true);
});

check("document content traversal has an independent budget", () => {
  const graph = verified({
    format: CANONICAL_SCHEMA_FORMAT,
    version: CANONICAL_SCHEMA_VERSION,
    capabilities: { documentRoot: 0 },
    nodes: [{ kind: "document-root", content: 1 }, { kind: "document-repeat", item: 2 }, { kind: "document-text" }],
  });
  assert.equal(exhausted(evaluate_canonical_document_schema(graph, parse_hson('"a" "b"', { allowTopLevelDocumentText: true }), { maxContentItems: 1 })), true);
});

emit_hson_live_test_completion("canonical-schema-resource-semantics", checks, checks, 0);
