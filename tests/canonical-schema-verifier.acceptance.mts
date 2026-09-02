import assert from "node:assert/strict";
import { admit_projected_value } from "../src/core/projected-value-admission.ts";
import { CANONICAL_SCHEMA_FORMAT, CANONICAL_SCHEMA_VERSION } from "../src/internal/canonical-schema/graph.ts";
import { verify_canonical_schema_graph } from "../src/internal/canonical-schema/verify.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "canonical-schema-verifier",
  title: "Canonical Schema verifier",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["hson-schema", "canonical-schema", "verification"]),
});

const testEvents = create_test_event_emitter("canonical-schema-verifier");
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
const graph = (capabilities: Record<string, number>, nodes: unknown[], extra: Record<string, unknown> = {}) => ({ format: CANONICAL_SCHEMA_FORMAT, version: CANONICAL_SCHEMA_VERSION, capabilities, nodes, ...extra });
const accepted = (value: unknown): void => assert.equal(verify_canonical_schema_graph(value).ok, true);
const rejected = (value: unknown, pattern?: RegExp): void => {
  const result = verify_canonical_schema_graph(value); assert.equal(result.ok, false);
  if (!result.ok && pattern !== undefined) assert.match(result.issues.map(issue => issue.message).join("\n"), pattern);
};

check("minimal projected graph verifies and freezes", () => { const value = graph({ projectedRoot: 0 }, [{ kind: "projected-string" }]); const result = verify_canonical_schema_graph(value); assert.equal(result.ok, true); if (result.ok) assert.equal(Object.isFrozen(result.graph.nodes), true); });
check("minimal document graph verifies", () => accepted(graph(
  { documentRoot: 0 },
  [{ kind: "document-root", content: 1 }, { kind: "document-sequence", items: [2] }, { kind: "document-element", content: 3 }, { kind: "document-broad-content" }],
)));
check("format is exact", () => rejected({ ...graph({ projectedRoot: 0 }, [{ kind: "projected-string" }]), format: "other" }, /format/i));
check("version is supported", () => rejected({ ...graph({ projectedRoot: 0 }, [{ kind: "projected-string" }]), version: 2 }, /version/i));
check("unknown envelope fields reject", () => rejected({ ...graph({ projectedRoot: 0 }, [{ kind: "projected-string" }]), surprise: true }, /Unknown field/));
check("at least one capability is required", () => rejected(graph({}, [{ kind: "projected-string" }]), /capability/i));
check("capability refs are in range", () => rejected(graph({ projectedRoot: 2 }, [{ kind: "projected-string" }]), /out of range/));
check("capability domain is compatible", () => rejected(graph({ projectedRoot: 0 }, [{ kind: "document-text" }]), /incompatible/));
check("unknown capability field rejects", () => rejected(graph({ projectedRoot: 0, magic: 0 }, [{ kind: "projected-string" }]), /Unknown field/));
check("unknown node kind rejects", () => rejected(graph({ projectedRoot: 0 }, [{ kind: "code-hook", source: "return true" }]), /Unknown node kind/));
check("unknown node fields reject", () => rejected(graph({ projectedRoot: 0 }, [{ kind: "projected-string", callback: "x" }]), /Unknown field/));
check("projected operand domain rejects document nodes", () => rejected(graph({ projectedRoot: 0 }, [{ kind: "projected-object", exact: false, properties: [["x", 1]] }, { kind: "document-text" }]), /incompatible/));
check("duplicate projected properties reject", () => rejected(graph({ projectedRoot: 0 }, [{ kind: "projected-object", exact: true, properties: [["x", 1], ["x", 1]] }, { kind: "projected-string" }]), /Duplicate property/));
check("duplicate attrs reject", () => rejected(graph({ attrs: 0 }, [{ kind: "document-attrs", exact: true, properties: [{ name: "x", optional: false, flag: true }, { name: "x", optional: true, flag: true }] }]), /Duplicate attr/));
check("union cardinality is nonempty", () => rejected(graph({ projectedRoot: 0 }, [{ kind: "projected-union", choices: [] }]), /nonempty/));
check("repeat count is a nonnegative safe integer", () => rejected(graph({ documentContent: 0 }, [{ kind: "document-repeat", item: 1, count: -1 }, { kind: "document-text" }]), /Repeat count/));
check("exact state must be explicit boolean", () => rejected(graph({ projectedRoot: 0 }, [{ kind: "projected-object", exact: "yes", properties: [] }]), /exact state/));
check("wrapper ref must exist", () => rejected(graph({ projectedRoot: 0 }, [{ kind: "projected-optional", base: 9 }]), /out of range/));
check("literal carrier admission rejects raw objects", () => rejected(graph({ projectedRoot: 0 }, [{ kind: "projected-literal", values: [{ a: 1 }] }]), /canonical projected value/));
check("canonical ordered literal verifies", () => accepted(graph({ projectedRoot: 0 }, [{ kind: "projected-literal", values: [admit_projected_value({ b: 2, a: 1 })] }])));
check("unreachable nodes reject", () => rejected(graph({ projectedRoot: 0 }, [{ kind: "projected-string" }, { kind: "projected-number" }]), /unreachable/));
check("first-discovery node order is canonical", () => rejected(graph({ projectedRoot: 0 }, [{ kind: "projected-object", exact: false, properties: [["x", 2], ["y", 1]] }, { kind: "projected-string" }, { kind: "projected-number" }]), /first-discovery/));
check("non-consuming self ref rejects", () => rejected(graph({ projectedRoot: 0 }, [{ kind: "projected-ref", target: 0 }]), /no consuming/));
check("non-consuming union cycle rejects", () => rejected(graph({ projectedRoot: 0 }, [{ kind: "projected-union", choices: [1] }, { kind: "projected-ref", target: 0 }]), /no consuming/));
check("object-property recursion is productive", () => accepted(graph({ projectedRoot: 0 }, [{ kind: "projected-object", exact: false, properties: [["child", 0]] }])));
check("document child recursion is productive", () => accepted(graph(
  { documentRoot: 0 },
  [{ kind: "document-root", content: 1 }, { kind: "document-sequence", items: [2] }, { kind: "document-element", content: 1 }],
)));
check("malformed refinement bound rejects", () => rejected(graph({ projectedRoot: 0 }, [{ kind: "projected-refinement", base: 1, rule: { kind: "number-lower-bound", value: Infinity, inclusive: true } }, { kind: "projected-number" }]), /finite/));
check("closed deterministic pattern refinement verifies", () => accepted(graph({ projectedRoot: 0 }, [{ kind: "projected-refinement", base: 1, rule: { kind: "string-pattern", dialect: "literal-string-v1", mode: "prefix", pattern: "id_" } }, { kind: "projected-string" }])));
check("documentation metadata unknown fields reject", () => rejected(graph({ projectedRoot: 0 }, [{ kind: "projected-string" }], { documentationMetadata: { path: "/tmp/x" } }), /Unknown field/));
check("semantic metadata refs verify", () => accepted(graph({ projectedRoot: 0 }, [{ kind: "projected-string" }], { semanticDiagnosticMetadata: { labels: [[0, "name"]] } })));
check("function-valued escape hatch rejects", () => rejected(graph({ projectedRoot: 0 }, [{ kind: "projected-string", validate: () => true }]), /executable/));
check("accessor fields reject without invocation", () => { let calls = 0; const node = Object.defineProperty({}, "kind", { enumerable: true, get: () => { calls += 1; return "projected-string"; } }); rejected(graph({ projectedRoot: 0 }, [node]), /accessors/); assert.equal(calls, 0); });
check("object cycles reject in favor of numeric refs", () => { const node: Record<string, unknown> = { kind: "projected-string" }; node.self = node; rejected(graph({ projectedRoot: 0 }, [node]), /acyclic/); });
check("explicit undefined optional fields reject", () => rejected(graph({ projectedRoot: 0 }, [{ kind: "projected-array", item: undefined }]), /undefined/));
check("sparse graph arrays reject", () => { const choices = new Array(1); rejected(graph({ projectedRoot: 0 }, [{ kind: "projected-union", choices }]), /dense/); });

testEvents.terminal("pass");
emit_hson_live_test_completion("canonical-schema-verifier", checks, checks, 0);
