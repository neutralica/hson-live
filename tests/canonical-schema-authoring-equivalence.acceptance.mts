import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import { encode_canonical_schema_graph_hson } from "../src/internal/canonical-schema/encode-hson.ts";
import { read_current_schema_shadow, set_current_schema_shadow_differential, read_current_schema_shadow_census } from "../src/internal/canonical-schema/shadow-current-schema.ts";
import { read_graph_backed_schema } from "../src/api/livemap/livemap.schema.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

let checks = 0;
const check = (name: string, run: () => void): void => { run(); console.log(`ok ${++checks} - ${name}`); };
const schema = hson.liveMap.schema;
const define = schema.define;
const legacyGraph = (value: object) => { const state = read_current_schema_shadow(value); assert.equal(state?.status, "SHADOW_GRAPH_COMPLETE"); if (state?.status !== "SHADOW_GRAPH_COMPLETE") throw new Error("legacy graph incomplete"); return state.graph; };
const directGraph = (value: object) => { const graph = read_graph_backed_schema(value); assert.ok(graph); return graph; };
const equivalent = (legacy: object, direct: object): void => assert.equal(encode_canonical_schema_graph_hson(legacyGraph(legacy)), encode_canonical_schema_graph_hson(directGraph(direct)));

check("primitive authoring is semantically identical", () => equivalent(define(s => s.string), schema.string));
check("exact object authoring is semantically identical", () => equivalent(define(s => s.object.exact({ name: s.string, active: s.boolean })), schema.object.exact({ name: schema.string, active: schema.boolean })));
check("optional nesting authoring is semantically identical", () => equivalent(define(s => s.object.exact({ value: s.number.optional })), schema.object.exact({ value: schema.optional(schema.number) })));
check("nullable nesting authoring is semantically identical", () => equivalent(define(s => s.object.exact({ value: s.number.nullable })), schema.object.exact({ value: schema.nullable(schema.number) })));
check("array and tuple authoring is semantically identical", () => equivalent(define(s => s.object.exact({ values: s.array(s.number), pair: s.tuple(s.string, s.boolean) })), schema.object.exact({ values: schema.array(schema.number), pair: schema.tuple(schema.string, schema.boolean) })));
check("literal union authoring is semantically identical", () => equivalent(define(s => s.pick("a", "b", s.number)), schema.pick("a", "b", schema.number)));
check("record authoring is semantically identical", () => equivalent(define(s => s.record(s.string)), schema.record(schema.string)));
check("document and attrs authoring is semantically identical", () => equivalent(define(s => s.main(s.attrs.exact({ id: s.string, hidden: s.flag.optional }), s.div(s.a()))), schema.main(schema.attrs.exact({ id: schema.string, hidden: schema.flag.optional }), schema.div(schema.a()))));
check("partial transform authoring is semantically identical", () => { const Legacy = define(s => s.object.exact({ a: s.string, nested: s.object.exact({ b: s.number }) })); const Direct = schema.object.exact({ a: schema.string, nested: schema.object.exact({ b: schema.number }) }); equivalent(define(s => s.partial(Legacy)), schema.partial(Direct)); });
check("deepPartial transform authoring is semantically identical", () => { const Legacy = define(s => s.object.exact({ nested: s.object.exact({ b: s.number }) })); const Direct = schema.object.exact({ nested: schema.object.exact({ b: schema.number }) }); equivalent(define(s => s.deepPartial(Legacy)), schema.deepPartial(Direct)); });

const before = read_current_schema_shadow_census();
set_current_schema_shadow_differential(true);
const Differential = schema.object.exact({ name: schema.string, count: schema.optional(schema.number) });
check("direct valid candidate participates in old/canonical differential", () => assert.equal(Differential.validateRoot({ name: "x", count: 1 }).ok, true));
check("direct invalid candidate participates in old/canonical differential", () => assert.equal(Differential.validateRoot({ name: 1 }).ok, false));
const RefinedDifferential = schema.length(schema.pattern(schema.string, { mode: "prefix", pattern: "sys_" }), { minimum: 5, maximum: 8 });
check("direct valid refinement participates in differential", () => assert.equal(RefinedDifferential.validateRoot("sys_1").ok, true));
check("direct invalid refinement participates in differential", () => assert.equal(RefinedDifferential.validateRoot("user_1").ok, false));
set_current_schema_shadow_differential(false);
check("direct differential has no mismatch", () => { const after = read_current_schema_shadow_census(); assert.ok(after.differentialEvaluations >= before.differentialEvaluations + 4); assert.equal(after.differentialMismatches, before.differentialMismatches); });

const observedBefore = read_current_schema_shadow_census();
const observed = Array.from({ length: 43 }, (_, index) => {
  if (index % 4 === 0) return { value: schema.length(schema.string, { minimum: 1 }), valid: "x", invalid: 1 };
  if (index % 4 === 1) return { value: schema.minimum(schema.number, 0), valid: 1, invalid: -1 };
  if (index % 4 === 2) return { value: schema.object.exact({ value: schema.string }), valid: { value: "x" }, invalid: { value: 1 } };
  return { value: schema.array(schema.number), valid: [1], invalid: ["x"] };
});
set_current_schema_shadow_differential(true);
for (const sample of observed) {
  sample.value.validateRoot(sample.valid as never);
  sample.value.validateRoot(sample.invalid as never);
}
set_current_schema_shadow_differential(false);
const observedAfter = read_current_schema_shadow_census();
const observedDelta = {
  schemas: observedAfter.total - observedBefore.total,
  complete: observedAfter.complete - observedBefore.complete,
  nonLowerable: observedAfter.nonLowerable - observedBefore.nonLowerable,
  comparisons: observedAfter.differentialEvaluations - observedBefore.differentialEvaluations,
  mismatches: observedAfter.differentialMismatches - observedBefore.differentialMismatches,
};
check("expanded direct shadow corpus is completely graph-backed", () => assert.deepEqual(observedDelta, { schemas: 43, complete: 43, nonLowerable: 0, comparisons: 86, mismatches: 0 }));
console.log(`# Phase-3 expanded shadow sample ${JSON.stringify(observedDelta)}`);

console.log(`# Phase-3 authoring shadow census ${JSON.stringify(read_current_schema_shadow_census())}`);

emit_hson_live_test_completion("canonical-schema-authoring-equivalence", checks, checks, 0);
