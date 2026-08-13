// @hson-live-external-test
import assert from "node:assert/strict";
import { hson } from "../src/index.ts";
import type { LiveMapProjectedSchema } from "../src/api/livemap/livemap.schema.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

let checks = 0;
function check(name: string, run: () => void): void { run(); checks += 1; process.stdout.write(`ok ${checks} - ${name}\n`); }

type TreeValue = Readonly<{ name: string; children: readonly TreeValue[] }>;
let Tree: LiveMapProjectedSchema<TreeValue>;
Tree = hson.liveMap.schema.define((s) => s.exact({
  name: s.string,
  children: s.array(s.recurse(() => Tree)),
}));

type AValue = Readonly<{ kind: "a"; peer?: BValue }>;
type BValue = Readonly<{ kind: "b"; peer?: AValue }>;
let A: LiveMapProjectedSchema<AValue>;
let B: LiveMapProjectedSchema<BValue>;
A = hson.liveMap.schema.define((s) => s.exact({ kind: s.literal("a"), peer: s.recurse(() => B).optional }));
B = hson.liveMap.schema.define((s) => s.exact({ kind: s.literal("b"), peer: s.recurse(() => A).optional }));

check("toolkit exposes constrain and recurse", () => { hson.liveMap.schema.define((s) => { assert.equal(typeof s.constrain, "function"); assert.equal(typeof s.recurse, "function"); return s.string; }); });
check("toolkit hard-removes refine", () => { hson.liveMap.schema.define((s) => { assert.equal("refine" in s, false); return s.string; }); });
check("toolkit hard-removes lazy", () => { hson.liveMap.schema.define((s) => { assert.equal("lazy" in s, false); return s.string; }); });
check("constrain admits values satisfying base and predicate", () => { const Positive = hson.liveMap.schema.define((s) => s.constrain(s.number, "positive", (value) => value > 0)); assert.equal(Positive.validateRoot(2).ok, true); });
check("constrain rejects failed predicates", () => { const Positive = hson.liveMap.schema.define((s) => s.constrain(s.number, "positive", (value) => value > 0)); assert.equal(Positive.validateRoot(-1).issues[0]?.code, "INVALID_CONSTRAINT"); });
check("constrain returns base validation before its predicate", () => { let calls = 0; const Positive = hson.liveMap.schema.define((s) => s.constrain(s.number, "positive", (value) => { calls += 1; return value > 0; })); assert.equal(Positive.validateRoot("wrong").issues[0]?.code, "TYPE_MISMATCH"); assert.equal(calls, 0); });
check("constrain does not transform admitted values", () => { const State = hson.liveMap.schema.define((s) => s.constrain(s.exact({ count: s.number }), "positive count", (value) => value.count > 0)); const map = hson.liveMap.fromJson({ count: 2 }).schema.use(State); assert.deepEqual(map.snap(), { count: 2 }); });
check("constrain rules use the final vocabulary", () => { const Positive = hson.liveMap.schema.define((s) => s.constrain(s.number, "positive", (value) => value > 0)); assert.equal(Positive.rules[0]?.kind, "constrain"); });
check("self recursion validates a recursive graph shape", () => { assert.equal(Tree.validateRoot({ name: "root", children: [{ name: "leaf", children: [] }] }).ok, true); });
check("self recursion reports a recursive child issue", () => { assert.equal(Tree.validateRoot({ name: "root", children: [{ name: 1, children: [] }] }).ok, false); });
check("mutual recursion validates forward references", () => { assert.equal(A.validateRoot({ kind: "a", peer: { kind: "b", peer: { kind: "a" } } }).ok, true); assert.equal(B.validateRoot({ kind: "b", peer: { kind: "a" } }).ok, true); });
check("recursive schemas remain immutable defined schemas", () => { assert.equal(Object.isFrozen(Tree), true); assert.equal(Object.isFrozen(A), true); assert.equal(Object.isFrozen(B), true); });
check("recurse rules use the final vocabulary", () => { const Recursive = hson.liveMap.schema.define((s) => s.recurse(() => s.string)); assert.equal(Recursive.rules[0]?.kind, "recurse"); });
check("recurse resolution is memoized", () => { let calls = 0; const Recursive = hson.liveMap.schema.define((s) => s.recurse(() => { calls += 1; return s.string; })); Recursive.validateRoot("a"); Recursive.validateRoot("b"); assert.equal(calls, 1); });
check("invalid recursive resolution retains explicit schema rejection", () => { const Invalid = hson.liveMap.schema.define((s) => s.recurse(() => Reflect.get(s, "missing"))); assert.throws(() => Invalid.validateRoot("x"), /unrecognized schema expression/); });

process.stdout.write(`# ${checks} final schema-vocabulary checks passed\n`);
emit_hson_live_test_completion("livemap.schema-vocabulary", checks, checks, 0);
