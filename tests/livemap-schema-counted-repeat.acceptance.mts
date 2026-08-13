// @hson-live-external-test
import assert from "node:assert/strict";
import { hson, LiveMapSchemaError } from "../src/index.ts";
import type { DocumentLiveMap, ElementLiveMap, FragmentLiveMap } from "../src/types/livemap.types.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

let checks = 0;
function check(name: string, run: () => void): void { run(); checks += 1; process.stdout.write(`ok ${checks} - ${name}\n`); }
function element(source: string): ElementLiveMap {
  const map = hson.liveMap.fromHson(source); if (map.mode !== "element") throw new Error("Expected element map"); return map;
}
function fragment(source: string): FragmentLiveMap {
  const map = hson.liveMap.fromHson(source); if (map.mode !== "fragment") throw new Error("Expected fragment map"); return map;
}
function emptyFragment(): FragmentLiveMap {
  const map = hson.liveMap.fromNode({ $_tag: "_hson_root", $_content: [] }); if (map.mode !== "fragment") throw new Error("Expected fragment map"); return map;
}
function schemaError(map: DocumentLiveMap, schema: object): LiveMapSchemaError {
  let observed: unknown; try { Reflect.apply(map.schema.use, map.schema, [schema]); } catch (error) { observed = error; }
  assert.equal(observed instanceof LiveMapSchemaError, true); return observed as LiveMapSchemaError;
}
function defineCount(count: unknown): object {
  return hson.liveMap.schema.define((s) => Reflect.apply(s.repeat, undefined, [count, s.string]));
}

const Unbounded = hson.liveMap.schema.define((s) => s.repeat(s.string));
const Zero = hson.liveMap.schema.define((s) => s.repeat(0, s.string));
const One = hson.liveMap.schema.define((s) => s.repeat(1, s.string));
const Three = hson.liveMap.schema.define((s) => s.repeat(3, s.string));
const Row = hson.liveMap.schema.define((s) => s.span(s.string));
const ThreeRows = hson.liveMap.schema.define((s) => s.div(s.repeat(3, Row)));

check("unbounded repeat still accepts zero or more", () => { emptyFragment().schema.use(Unbounded); fragment(`"a" "b"`).schema.use(Unbounded); });
check("count zero accepts exactly empty", () => { emptyFragment().schema.use(Zero); });
check("count one accepts exactly one item", () => { fragment(`"a"`).schema.use(One); });
check("count three accepts exactly three items", () => { fragment(`"a" "b" "c"`).schema.use(Three); });
check("count three reports a missing fourth-position requirement", () => { const error = schemaError(fragment(`"a" "b"`), Three); assert.equal(error.issues[0]?.code, "MISSING_REQUIRED"); });
check("count three rejects a fourth item", () => { const error = schemaError(fragment(`"a" "b" "c" "d"`), Three); assert.equal(error.issues[0]?.code, "TUPLE_INDEX_OUT_OF_RANGE"); });
check("counted repeat validates every homogeneous item", () => { assert.match(schemaError(fragment(`"a" <span/> "c"`), Three).message, /Expected text/); });
check("counted repeat composes inside an element", () => { element(`<div <span "a"/> <span "b"/> <span "c"/>/>`).schema.use(ThreeRows); });
check("one immutable child schema can populate every position", () => { assert.equal(Object.isFrozen(Row), true); assert.match(schemaError(element(`<div <span "a"/> <em/> <span "c"/>/>`), ThreeRows).message, /Expected tag/); });
check("dynamic count is captured when define evaluates", () => { let count: number = 2; const Dynamic = hson.liveMap.schema.define((s) => s.repeat(count, s.string)); count = 4; fragment(`"a" "b"`).schema.use(Dynamic); schemaError(fragment(`"a" "b" "c" "d"`), Dynamic); });
check("counted repeat owner rejects insertion", () => { const map = fragment(`"a" "b" "c"`); const typed = map.schema.use(Three); assert.throws(() => typed.at([]).insert(3, "d"), LiveMapSchemaError); });
check("counted repeat owner rejects deletion", () => { const map = fragment(`"a" "b" "c"`); const typed = map.schema.use(Three); assert.throws(() => typed.at([1]).delete(), LiveMapSchemaError); });
check("negative counts reject", () => { assert.throws(() => defineCount(-1), /nonnegative safe integer/); });
check("NaN counts reject", () => { assert.throws(() => defineCount(Number.NaN), /nonnegative safe integer/); });
check("infinite counts reject", () => { assert.throws(() => defineCount(Number.POSITIVE_INFINITY), /nonnegative safe integer/); });
check("fractional counts reject", () => { assert.throws(() => defineCount(1.5), /nonnegative safe integer/); });
check("boxed Number counts reject", () => { assert.throws(() => defineCount(new Number(3)), /nonnegative safe integer/); });
check("bigint counts reject", () => { assert.throws(() => defineCount(3n), /nonnegative safe integer/); });
check("boolean counts reject", () => { assert.throws(() => defineCount(true), /nonnegative safe integer/); });
check("string counts reject", () => { assert.throws(() => defineCount("3"), /nonnegative safe integer/); });
check("maximum safe count defines without tuple allocation", () => { const Huge = defineCount(Number.MAX_SAFE_INTEGER); assert.equal(Object.isFrozen(Huge), true); assert.equal(schemaError(emptyFragment(), Huge).issues[0]?.code, "MISSING_REQUIRED"); });
check("unsafe integer counts reject", () => { assert.throws(() => defineCount(Number.MAX_SAFE_INTEGER + 1), /nonnegative safe integer/); });
check("zero repeat and empty report the same closed length", () => { const Empty = hson.liveMap.schema.define((s) => s.empty); assert.equal(schemaError(fragment(`"x"`), Zero).issues[0]?.expected, schemaError(fragment(`"x"`), Empty).issues[0]?.expected); });

process.stdout.write(`# ${checks} counted-repeat schema checks passed\n`);
emit_hson_live_test_completion("livemap.schema-counted-repeat", checks, checks, 0);
