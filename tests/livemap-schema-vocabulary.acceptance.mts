// @hson-live-external-test
import assert from "node:assert/strict";
import { hson } from "../src/index.ts";
import type { LiveMapProjectedSchema } from "../src/api/livemap/livemap.schema.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

let checks = 0;
function check(name: string, run: () => void): void { run(); checks += 1; process.stdout.write(`ok ${checks} - ${name}\n`); }

type TreeValue = Readonly<{ name: string; children: readonly TreeValue[] }>;
let Tree: LiveMapProjectedSchema<TreeValue>;
Tree = hson.liveMap.schema.define((s) => s.object.exact({
  name: s.string,
  children: s.array(s.recurse(() => Tree)),
}));

type AValue = Readonly<{ kind: "a"; peer?: BValue }>;
type BValue = Readonly<{ kind: "b"; peer?: AValue }>;
let A: LiveMapProjectedSchema<AValue>;
let B: LiveMapProjectedSchema<BValue>;
A = hson.liveMap.schema.define((s) => s.object.exact({ kind: s.literal("a"), peer: s.recurse(() => B).optional }));
B = hson.liveMap.schema.define((s) => s.object.exact({ kind: s.literal("b"), peer: s.recurse(() => A).optional }));

check("constrain is a schema-value modifier and not a toolkit constructor", () => { hson.liveMap.schema.define((s) => { assert.equal("constrain" in s, false); assert.equal(typeof s.number.constrain, "function"); assert.equal(typeof s.recurse, "function"); return s.string; }); });
check("toolkit hard-removes refine", () => { hson.liveMap.schema.define((s) => { assert.equal("refine" in s, false); return s.string; }); });
check("toolkit hard-removes lazy", () => { hson.liveMap.schema.define((s) => { assert.equal("lazy" in s, false); return s.string; }); });
check("unlabeled constrain admits values satisfying base and predicate", () => { const Positive = hson.liveMap.schema.define((s) => s.number.constrain((value) => value > 0)); assert.equal(Positive.validateRoot(2).ok, true); });
check("unlabeled constrain rejects with useful default diagnostics", () => { const Positive = hson.liveMap.schema.define((s) => s.number.constrain((value) => value > 0)); const issue = Positive.validateRoot(-1).issues[0]; assert.equal(issue?.code, "INVALID_CONSTRAINT"); assert.equal(issue?.expected, "constraint"); });
check("labeled constrain preserves its diagnostic label", () => { const Positive = hson.liveMap.schema.define((s) => s.number.constrain("positive", (value) => value > 0)); assert.equal(Positive.validateRoot(-1).issues[0]?.expected, "positive"); });
check("constrain returns base validation before its predicate", () => { let calls = 0; const Positive = hson.liveMap.schema.define((s) => s.number.constrain("positive", (value) => { calls += 1; return value > 0; })); assert.equal(Positive.validateRoot("wrong").issues[0]?.code, "TYPE_MISMATCH"); assert.equal(calls, 0); });
check("structured constrain preserves and does not transform base evidence", () => { const State = hson.liveMap.schema.define((s) => s.object.exact({ count: s.number }).constrain("positive count", (value) => value.count > 0)); const map = hson.liveMap.fromJson({ count: 2 }).schema.use(State); assert.deepEqual(map.snap(), { count: 2 }); });
check("constrain rules retain the existing IR vocabulary", () => { const Positive = hson.liveMap.schema.define((s) => s.number.constrain("positive", (value) => value > 0)); assert.equal(Positive.rules[0]?.kind, "constrain"); });
check("constrain then optional or nullable bypasses the predicate for absence and null", () => { let calls = 0; const State = hson.liveMap.schema.define((s) => s.object.exact({ optional: s.number.constrain((value) => { calls += 1; return value > 0; }).optional, nullable: s.number.constrain((value) => { calls += 1; return value > 0; }).nullable })); assert.equal(State.validateRoot({ nullable: null }).ok, true); assert.equal(calls, 0); });
check("optional then constrain preserves the established required-present result", () => { const State = hson.liveMap.schema.define((s) => s.object.exact({ value: s.number.optional.constrain((value) => value > 0) })); assert.equal(State.validateRoot({}).issues[0]?.code, "MISSING_REQUIRED"); assert.equal(State.validateRoot({ value: 1 }).ok, true); });
check("nullable then constrain supplies null to the predicate", () => { let received: number | null | undefined; const State = hson.liveMap.schema.define((s) => s.number.nullable.constrain((value) => { received = value; return value === null; })); assert.equal(State.validateRoot(null).ok, true); assert.equal(received, null); });
check("document-only categories do not acquire constrain", () => { hson.liveMap.schema.define((s) => { assert.equal("constrain" in s.div(), false); assert.equal("constrain" in s.repeat(s.string), false); assert.equal("constrain" in s.attrs({}), false); assert.equal("constrain" in s.flag, false); return s.string; }); });
check("self recursion validates a recursive graph shape", () => { assert.equal(Tree.validateRoot({ name: "root", children: [{ name: "leaf", children: [] }] }).ok, true); });
check("self recursion reports a recursive child issue", () => { assert.equal(Tree.validateRoot({ name: "root", children: [{ name: 1, children: [] }] }).ok, false); });
check("mutual recursion validates forward references", () => { assert.equal(A.validateRoot({ kind: "a", peer: { kind: "b", peer: { kind: "a" } } }).ok, true); assert.equal(B.validateRoot({ kind: "b", peer: { kind: "a" } }).ok, true); });
check("recursive schemas remain immutable defined schemas", () => { assert.equal(Object.isFrozen(Tree), true); assert.equal(Object.isFrozen(A), true); assert.equal(Object.isFrozen(B), true); });
check("recurse rules use the final vocabulary", () => { const Recursive = hson.liveMap.schema.define((s) => s.recurse(() => s.string)); assert.equal(Recursive.rules[0]?.kind, "recurse"); });
check("recurse resolution is memoized", () => { let calls = 0; const Recursive = hson.liveMap.schema.define((s) => s.recurse(() => { calls += 1; return s.string; })); Recursive.validateRoot("a"); Recursive.validateRoot("b"); assert.equal(calls, 1); });
check("invalid recursive resolution retains explicit schema rejection", () => { const Invalid = hson.liveMap.schema.define((s) => s.recurse(() => Reflect.get(s, "missing"))); assert.throws(() => Invalid.validateRoot("x"), /unrecognized schema expression/); });

process.stdout.write(`# ${checks} final schema-vocabulary checks passed\n`);
emit_hson_live_test_completion("livemap.schema-vocabulary", checks, checks, 0);
