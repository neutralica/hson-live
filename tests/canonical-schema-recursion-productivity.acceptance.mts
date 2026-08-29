import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import { admit_projected_value } from "../src/core/projected-value-admission.ts";
import { validate_livemap_schema_projected_root, type LiveMapProjectedSchema } from "../src/api/livemap/livemap.schema.ts";
import { evaluate_canonical_projected_schema } from "../src/internal/canonical-schema/evaluate.ts";
import { lower_current_schema } from "../src/internal/canonical-schema/lower-current-schema.ts";
import { verify_canonical_schema_graph } from "../src/internal/canonical-schema/verify.ts";
import { CANONICAL_SCHEMA_FORMAT, CANONICAL_SCHEMA_VERSION } from "../src/internal/canonical-schema/graph.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

let checks = 0;
const check = (name: string, run: () => void): void => { run(); console.log(`ok ${++checks} - ${name}`); };
const define = hson.liveMap.schema.define;
const envelope = (nodes: unknown[]) => ({ format: CANONICAL_SCHEMA_FORMAT, version: CANONICAL_SCHEMA_VERSION, capabilities: { projectedRoot: 0 }, nodes });
const evidence = (result: { ok: boolean; issues: readonly { code: string; path: readonly (string | number)[]; expected?: string; received?: string }[] }) => ({ ok: result.ok, issues: result.issues.map(issue => ({ code: issue.code, path: [...issue.path], expected: issue.expected, received: issue.received })) });

check("unresolved recurse returns structured non-lowerable result", () => {
  let calls = 0; let Tree: LiveMapProjectedSchema;
  Tree = define(s => s.object({ child: s.recurse(() => { calls += 1; return Tree; }).optional }));
  const result = lower_current_schema(Tree); assert.equal(result.ok, false); assert.equal(calls, 0);
  if (!result.ok) assert.equal(result.reasons.some(reason => reason.code === "UNRESOLVED_RECURSE_THUNK"), true);
});
check("resolved recurse evidence is reused without another thunk call", () => {
  let calls = 0; let Tree: LiveMapProjectedSchema;
  Tree = define(s => s.object({ value: s.string, child: s.recurse(() => { calls += 1; return Tree; }).optional }));
  Tree.validateRoot({ value: "root", child: { value: "leaf" } }); assert.equal(calls, 1);
  const result = lower_current_schema(Tree); assert.equal(result.ok, true); assert.equal(calls, 1);
});
check("productive recursive graph accepts finite valid tree", () => {
  let Tree: LiveMapProjectedSchema; Tree = define(s => s.object({ value: s.string, child: s.recurse(() => Tree).optional }));
  Tree.validateRoot({ value: "root", child: { value: "leaf" } }); const lowered = lower_current_schema(Tree); assert.equal(lowered.ok, true); if (!lowered.ok) return;
  const value = admit_projected_value({ value: "a", child: { value: "b", child: { value: "c" } } });
  assert.deepEqual(evidence(evaluate_canonical_projected_schema(lowered.graph, value)), evidence(validate_livemap_schema_projected_root(Tree, value)));
});
check("productive recursive graph reports deep path exactly", () => {
  let Tree: LiveMapProjectedSchema; Tree = define(s => s.object({ value: s.string, child: s.recurse(() => Tree).optional }));
  Tree.validateRoot({ value: "root", child: { value: "leaf" } }); const lowered = lower_current_schema(Tree); assert.equal(lowered.ok, true); if (!lowered.ok) return;
  const value = admit_projected_value({ value: "a", child: { value: "b", child: { value: 3 } } });
  assert.deepEqual(evidence(evaluate_canonical_projected_schema(lowered.graph, value)), evidence(validate_livemap_schema_projected_root(Tree, value)));
});
check("mutual resolved recursion lowers completely", () => {
  let A: LiveMapProjectedSchema; let B: LiveMapProjectedSchema;
  A = define(s => s.object({ kind: s.literal("a"), peer: s.recurse(() => B).optional }));
  B = define(s => s.object({ kind: s.literal("b"), peer: s.recurse(() => A).optional }));
  A.validateRoot({ kind: "a", peer: { kind: "b", peer: { kind: "a" } } });
  assert.equal(lower_current_schema(A).ok, true);
});
check("self reference zero-progress cycle rejects", () => assert.equal(verify_canonical_schema_graph(envelope([{ kind: "projected-ref", target: 0 }])).ok, false));
check("optional and ref zero-progress cycle rejects", () => assert.equal(verify_canonical_schema_graph(envelope([{ kind: "projected-optional", base: 1 }, { kind: "projected-ref", target: 0 }])).ok, false));
check("nullable and union zero-progress cycle rejects", () => assert.equal(verify_canonical_schema_graph(envelope([{ kind: "projected-nullable", base: 1 }, { kind: "projected-union", choices: [0] }])).ok, false));
check("refinement base zero-progress cycle rejects", () => assert.equal(verify_canonical_schema_graph(envelope([{ kind: "projected-refinement", base: 1, rule: { kind: "integer" } }, { kind: "projected-ref", target: 0 }])).ok, false));
check("array-item recursion is consuming", () => assert.equal(verify_canonical_schema_graph(envelope([{ kind: "projected-array", item: 0 }])).ok, true));
check("tuple-position recursion is consuming", () => assert.equal(verify_canonical_schema_graph(envelope([{ kind: "projected-tuple", items: [0] }])).ok, true));
check("record-value recursion is consuming", () => assert.equal(verify_canonical_schema_graph(envelope([{ kind: "projected-record", value: 0 }])).ok, true));
check("internal step budget yields structured resource evidence", () => {
  const verified = verify_canonical_schema_graph(envelope([{ kind: "projected-array", item: 0 }])); assert.equal(verified.ok, true); if (!verified.ok) return;
  const result = evaluate_canonical_projected_schema(verified.graph, admit_projected_value([[[[]]]]), { maxSteps: 2 });
  assert.equal(result.ok, false); assert.equal(result.issues[0]?.evidence.kind, "resource-limit");
});

emit_hson_live_test_completion("canonical-schema-recursion-productivity", checks, checks, 0);
