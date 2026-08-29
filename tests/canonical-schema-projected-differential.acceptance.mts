import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import { validate_livemap_schema_projected_root, type LiveMapProjectedSchema } from "../src/api/livemap/livemap.schema.ts";
import { admit_projected_value } from "../src/core/projected-value-admission.ts";
import { evaluate_canonical_projected_schema } from "../src/internal/canonical-schema/evaluate.ts";
import { lower_current_schema } from "../src/internal/canonical-schema/lower-current-schema.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

let checks = 0;
const check = (name: string, run: () => void): void => { run(); console.log(`ok ${++checks} - ${name}`); };
const define = hson.liveMap.schema.define;
const evidence = (result: { ok: boolean; issues: readonly { code: string; path: readonly (string | number)[]; expected?: string; received?: string; attributeName?: string }[] }) => ({
  ok: result.ok,
  issues: result.issues.map(({ code, path, expected, received, attributeName }) => ({ code, path: [...path], expected, received, attributeName })),
});
const differential = (name: string, schema: LiveMapProjectedSchema, candidate: unknown): void => check(name, () => {
  const lowered = lower_current_schema(schema); assert.equal(lowered.ok, true, lowered.ok ? "" : JSON.stringify(lowered.reasons));
  if (!lowered.ok) return;
  const admitted = admit_projected_value(candidate);
  assert.deepEqual(evidence(evaluate_canonical_projected_schema(lowered.graph, admitted)), evidence(validate_livemap_schema_projected_root(schema, admitted)));
});

const Exact = define(s => s.object.exact({ name: s.string, age: s.number, alias: s.string.optional }));
const Open = define(s => s.object({ age: s.number }));
const Tuple = define(s => s.tuple(s.string, s.number.optional));
const Numbers = define(s => s.array(s.number));
const Broad = define(s => s.array());
const Record = define(s => s.record(s.boolean));
const Union = define(s => s.pick(s.object.exact({ kind: s.literal("a"), value: s.number }), s.object.exact({ kind: s.literal("b"), value: s.string })));
const Nullable = define(s => s.number.optional.nullable);
const Literals = define(s => s.literal(0, -0, "x", { b: 2, a: 1 }));
const Tagged = define(s => s.tagged("kind", { a: s.object.exact({ value: s.number }), b: s.object({ label: s.string }) }));
const Partial = define(s => s.partial(s.object.exact({ a: s.number, b: s.string })));
const Deep = define(s => s.deepPartial(s.object.exact({ nested: s.object.exact({ n: s.number }), list: s.array(s.object({ x: s.string })) })));

differential("projected string accepts", define(s => s.string), "x");
differential("projected string rejects number", define(s => s.string), 1);
differential("finite number accepts", define(s => s.number), 1.5);
differential("boolean rejects null", define(s => s.boolean), null);
differential("null accepts", define(s => s.null), null);
differential("unknown accepts ordered object", define(s => s.unknown), { z: 1, a: true });
differential("positive zero literal", define(s => s.literal(0)), 0);
differential("positive zero does not equal negative zero", define(s => s.literal(0)), -0);
differential("negative zero literal", define(s => s.literal(-0)), -0);
differential("ordered object literal rejects reordered candidate", Literals, { a: 1, b: 2 });
differential("exact object valid with absent optional", Exact, { name: "n", age: 2 });
differential("exact object reports properties before candidate-order unknown keys", Exact, { age: "bad", extra2: 2, extra1: 1 });
differential("open object permits unknown key", Open, { age: 2, extra: true });
differential("tuple exact length", Tuple, ["x", 2]);
differential("tuple optional tail missing", Tuple, ["x"]);
differential("tuple required head missing", Tuple, []);
differential("tuple long reports each excess index", Tuple, ["x", 2, true, null]);
differential("homogeneous array accumulates ordered failures", Numbers, ["x", 2, false]);
differential("broad array accepts mixed admitted values", Broad, ["x", 2, false, null]);
differential("record follows candidate key order", Record, { z: 1, a: false });
differential("ordered union accepts second branch", Union, { kind: "b", value: "x" });
differential("ordered union tie selects first fewest-issues branch", Union, { kind: "c", value: false });
differential("optional nullable accepts null", Nullable, null);
differential("tagged compiled result accepts", Tagged, { value: 1, kind: "a" });
differential("tagged compiled result preserves property ordering", Tagged, { kind: "a", value: 1 });
differential("partial compiled result permits all missing", Partial, {});
differential("deepPartial compiled result permits nested missing", Deep, { nested: {}, list: [{}] });

check("constrain fails lowering without execution", () => {
  let calls = 0;
  const schema = define(s => s.number.constrain(() => { calls += 1; return true; }));
  const lowered = lower_current_schema(schema);
  assert.equal(lowered.ok, false); assert.equal(calls, 0);
  if (!lowered.ok) assert.equal(lowered.reasons[0]?.code, "CONSTRAIN_CALLBACK");
});

emit_hson_live_test_completion("canonical-schema-projected-differential", checks, checks, 0);
