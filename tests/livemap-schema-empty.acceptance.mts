// @hson-live-external-test
import assert from "node:assert/strict";
import { hson, LiveMapSchemaError } from "../src/index.ts";
import type { DocumentLiveMap, ElementLiveMap, FragmentLiveMap } from "../src/types/livemap.types.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

let checks = 0;
function check(name: string, run: () => void): void {
  run(); checks += 1; process.stdout.write(`ok ${checks} - ${name}\n`);
}
function element(source: string): ElementLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "element") throw new Error(`Expected element, observed ${map.mode}`);
  return map;
}
function fragment(source: string): FragmentLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "fragment") throw new Error(`Expected fragment, observed ${map.mode}`);
  return map;
}
function emptyFragment(): FragmentLiveMap {
  const map = hson.liveMap.fromNode({ $_tag: "_hson_root", $_content: [] });
  if (map.mode !== "fragment") throw new Error(`Expected fragment, observed ${map.mode}`);
  return map;
}
function rejects(map: DocumentLiveMap, schema: object): LiveMapSchemaError {
  let observed: unknown;
  try { Reflect.apply(map.schema.use, map.schema, [schema]); } catch (error) { observed = error; }
  assert.equal(observed instanceof LiveMapSchemaError, true);
  return observed as LiveMapSchemaError;
}

const Empty = hson.liveMap.schema.define((s) => s.empty);
const EmptyDiv = hson.liveMap.schema.define((s) => s.div(s.empty));
const EmptyTupleDiv = hson.liveMap.schema.define((s) => s.div(s.tuple()));
const BroadDiv = hson.liveMap.schema.define((s) => s.div());
const EmptyAny = hson.liveMap.schema.define((s) => s.tag(s.empty));
const BroadAny = hson.liveMap.schema.define((s) => s.tag());
const EmptyFoo = hson.liveMap.schema.define((s) => s.tag.foo(s.empty));
const EmptyCustom = hson.liveMap.schema.define((s) => s.tag["my-widget"](s.empty));
const EmptyTuple = hson.liveMap.schema.define((s) => s.tuple());
const EmptyProjectedTuple = hson.liveMap.schema.define((s) => s.tuple());
const ZeroRepeat = hson.liveMap.schema.define((s) => s.repeat(0, s.string));

check("empty is one frozen document content atom", () => {
  let first: object | undefined; let second: object | undefined;
  hson.liveMap.schema.define((s) => { first = s.empty; return s.empty; });
  hson.liveMap.schema.define((s) => { second = s.empty; return s.empty; });
  assert.equal(first, second); assert.equal(Object.isFrozen(first), true);
});
check("top-level empty accepts the empty fragment", () => { emptyFragment().schema.use(Empty); });
check("top-level empty rejects one text item", () => { assert.match(rejects(fragment(`"x"`), Empty).message, /length 0/); });
check("div empty accepts zero descendants", () => { element(`<div/>`).schema.use(EmptyDiv); });
check("div empty rejects text descendants", () => { assert.match(rejects(element(`<div "x"/>`), EmptyDiv).message, /length 0/); });
check("zero-child div remains broad", () => { element(`<div "x" <span/>/>`).schema.use(BroadDiv); });
check("tuple() remains exact-empty document content", () => { element(`<div/>`).schema.use(EmptyTupleDiv); });
check("tuple() exact-empty rejects descendants", () => { assert.match(rejects(element(`<div <span/>/>`), EmptyTupleDiv).message, /length 0/); });
check("callable any-tag empty accepts any empty element", () => { element(`<section/>`).schema.use(EmptyAny); });
check("callable any-tag empty rejects descendants", () => { assert.match(rejects(element(`<section "x"/>`), EmptyAny).message, /length 0/); });
check("zero-child any-tag remains broad", () => { element(`<section "x"/>`).schema.use(BroadAny); });
check("identifier custom tag retains exact tag and emptiness", () => { element(`<foo/>`).schema.use(EmptyFoo); assert.match(rejects(element(`<bar/>`), EmptyFoo).message, /Expected tag/); });
check("bracket custom tag retains exact tag and emptiness", () => { element(`<my-widget/>`).schema.use(EmptyCustom); assert.match(rejects(element(`<my-widget "x"/>`), EmptyCustom).message, /length 0/); });
check("empty and tuple() accept the same empty fragment", () => { emptyFragment().schema.use(EmptyTuple); emptyFragment().schema.use(Empty); });
check("tuple() retains projected empty tuple capability", () => { assert.equal(EmptyProjectedTuple.validateRoot([]).ok, true); });
check("projected tuple() rejects nonempty arrays", () => { assert.equal(EmptyProjectedTuple.validateRoot([1]).ok, false); });
check("empty rejects projected object and array composition", () => {
  assert.throws(() => hson.liveMap.schema.define((s) => Reflect.apply(s.object, undefined, [{ child: s.empty }])), /document-only/);
  assert.throws(() => hson.liveMap.schema.define((s) => Reflect.apply(s.array, undefined, [s.empty])), /document-only/);
});
check("repeat zero shares exact-empty semantics", () => { emptyFragment().schema.use(ZeroRepeat); assert.match(rejects(fragment(`"x"`), ZeroRepeat).message, /length 0/); });

process.stdout.write(`# ${checks} exact-empty schema checks passed\n`);
emit_hson_live_test_completion("livemap.schema-empty", checks, checks, 0);
