import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import type { LiveMapProjectedSchema } from "../src/api/livemap/livemap.schema.ts";
import { parse_hson } from "../src/api/transform/parsers/parse-hson.ts";
import {
  validate_livemap_document_schema_root,
  type InternalDocumentRootSchema,
} from "../src/api/livemap/livemap.document.schema.ts";
import { encode_canonical_schema_graph_hson } from "../src/internal/canonical-schema/encode-hson.ts";
import {
  read_current_schema_shadow,
  read_current_schema_shadow_census,
  set_current_schema_shadow_differential,
} from "../src/internal/canonical-schema/shadow-current-schema.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

let checks = 0;
const check = (name: string, run: () => void): void => { run(); console.log(`ok ${++checks} - ${name}`); };
const define = hson.liveMap.schema.define;
const complete = (schema: object) => {
  const state = read_current_schema_shadow(schema);
  assert.equal(state?.status, "SHADOW_GRAPH_COMPLETE");
  if (state?.status !== "SHADOW_GRAPH_COMPLETE") throw new Error("expected complete shadow graph");
  return state;
};

const before = read_current_schema_shadow_census();
const User = define(s => s.object.exact({ name: s.string, age: s.number.optional, role: s.pick("admin", "user") }));
check("ordinary declarative definition finalizes automatically", () => assert.ok(complete(User).graph.nodes.length > 0));
check("complete graph has projected capability", () => assert.equal(complete(User).graph.capabilities.projectedRoot !== undefined, true));
check("shadow state is private rather than an own property", () => assert.deepEqual(Object.keys(User).includes("shadow"), false));

let CapturedExpression: object | undefined;
const Alias = define(s => { const Name = s.string; const LocalUser = s.object({ name: Name }); CapturedExpression = LocalUser; return LocalUser; });
check("builder aliases and local composition are complete", () => assert.equal(complete(Alias).capabilityClass, "projected"));
check("returned current expression shares finalized shadow evidence", () => assert.equal(read_current_schema_shadow(CapturedExpression)?.status, "SHADOW_GRAPH_COMPLETE"));

const Address = define(s => s.object.exact({ city: s.string }));
const Composed = define(s => s.object({ address: Address }));
check("defined Schema composition is complete", () => assert.equal(complete(Composed).graph.capabilities.projectedRoot !== undefined, true));

const exact = Date.now() > 0;
const Dynamic = define(s => exact ? s.object.exact({ value: s.string }) : s.object({ value: s.string }));
check("dynamic construction with declarative result is complete", () => assert.equal(complete(Dynamic).graph.nodes.some(node => node.kind === "projected-object"), true));

let callbackCalls = 0;
const Once = define(s => { callbackCalls += 1; return s.string; });
check("shadow acquisition does not replay schema.define", () => { complete(Once); assert.equal(callbackCalls, 1); });

let predicateCalls = 0;
const Constrained = define(s => s.number.constrain(() => { predicateCalls += 1; return true; }));
check("constrain is explicitly non-lowerable", () => assert.equal(read_current_schema_shadow(Constrained)?.status, "SHADOW_GRAPH_NON_LOWERABLE"));
check("constrain classification does not execute predicate", () => assert.equal(predicateCalls, 0));
check("constrain reason is structured", () => {
  const state = read_current_schema_shadow(Constrained);
  assert.equal(state?.status === "SHADOW_GRAPH_NON_LOWERABLE" && state.reasons.some(reason => reason.code === "CONSTRAIN_CALLBACK"), true);
});

const ParentConstrained = define(s => s.object({ value: Constrained }));
check("constrained child makes the whole parent non-lowerable", () => assert.equal(read_current_schema_shadow(ParentConstrained)?.status, "SHADOW_GRAPH_NON_LOWERABLE"));

let recurseCalls = 0;
let Recursive: LiveMapProjectedSchema;
Recursive = define(s => s.recurse(() => { recurseCalls += 1; return s.object({ next: Recursive.optional }); }));
check("unresolved recurse thunk is non-lowerable", () => assert.equal(read_current_schema_shadow(Recursive)?.status, "SHADOW_GRAPH_NON_LOWERABLE"));
check("shadow finalization does not resolve recurse", () => assert.equal(recurseCalls, 0));
Recursive.validateRoot({});
const ResolvedComposition = define(s => s.object({ root: Recursive }));
check("already-resolved recursion lowers in later composition", () => assert.equal(complete(ResolvedComposition).graph.nodes.some(node => node.kind === "projected-ref"), true));
check("original finalized recurse classification remains immutable", () => assert.equal(read_current_schema_shadow(Recursive)?.status, "SHADOW_GRAPH_NON_LOWERABLE"));

const Page = define(s => s.main(s.attrs.exact({ id: s.string }), s.div(s.a())));
check("document root and attrs finalize together", () => assert.equal(complete(Page).graph.nodes.some(node => node.kind === "document-attrs"), true));

const Multi = define(s => s.string);
check("dual projected/document item capability is preserved", () => {
  const state = complete(Multi);
  assert.equal(state.capabilityClass, "multi-capability");
  assert.equal(state.graph.capabilities.projectedRoot !== undefined && state.graph.capabilities.documentItem !== undefined, true);
});

const AttrsOnly = define(s => s.attrs.exact({ id: s.string, hidden: s.flag.optional }));
check("attrs-only capability finalizes", () => assert.equal(complete(AttrsOnly).graph.capabilities.attrs !== undefined, true));

const EquivalentA = define(s => s.object.exact({ value: s.string, count: s.number.optional }));
const EquivalentB = define(s => s.object.exact({ value: s.string, count: s.number.optional }));
check("equivalent repeated construction encodes deterministically", () => assert.equal(encode_canonical_schema_graph_hson(complete(EquivalentA).graph), encode_canonical_schema_graph_hson(complete(EquivalentB).graph)));

set_current_schema_shadow_differential(true);
check("projected valid candidate participates in automatic differential", () => assert.equal(User.validateRoot({ name: "Ada", role: "admin" }).ok, true));
check("projected invalid candidate participates in automatic differential", () => assert.equal(User.validateRoot({ name: "Ada", role: "owner" }).ok, false));
check("document valid candidate participates in automatic differential", () => assert.equal(validate_livemap_document_schema_root(Page as InternalDocumentRootSchema, parse_hson('<main id="p" <div <a/>/>/>'), "element").ok, true));
check("document invalid candidate participates in automatic differential", () => assert.equal(validate_livemap_document_schema_root(Page as InternalDocumentRootSchema, parse_hson('<main <div <a/>/>/>'), "element").ok, false));
set_current_schema_shadow_differential(false);

check("observed census records complete and non-lowerable Schemas", () => {
  const after = read_current_schema_shadow_census();
  assert.ok(after.total > before.total);
  assert.ok(after.complete > before.complete);
  assert.ok(after.nonLowerable > before.nonLowerable);
  assert.ok(after.reasons.constrain > before.reasons.constrain);
  assert.ok(after.reasons.recurse > before.reasons.recurse);
  assert.equal(after.differentialMismatches, before.differentialMismatches);
  assert.ok(after.differentialEvaluations >= before.differentialEvaluations + 4);
});

emit_hson_live_test_completion("canonical-schema-shadow-construction", checks, checks, 0);
