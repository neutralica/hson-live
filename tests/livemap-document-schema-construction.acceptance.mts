// @hson-live-external-test
import assert from "node:assert/strict";
import { hson, LiveMapSchemaError } from "../src/index.ts";
import { HTML_TAGS, SVG_TAGS } from "../src/core/all-html-tags.ts";
import type { DocumentLiveMap, ElementLiveMap, FragmentLiveMap } from "../src/types/livemap.types.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

let checks = 0;
function check(name: string, run: () => void): void {
  run();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
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

function rejectsSchema(map: DocumentLiveMap, schema: object, pattern: RegExp): void {
  assert.throws(
    () => Reflect.apply(map.schema.use, map.schema, [schema]),
    (error: unknown) => error instanceof LiveMapSchemaError && pattern.test(error.message),
  );
}

const BroadDiv = hson.liveMap.schema.define((s) => s.div());
const EmptyDiv = hson.liveMap.schema.define((s) => s.div(s.tuple()));
const TextDiv = hson.liveMap.schema.define((s) => s.div(s.string));
const FixedDiv = hson.liveMap.schema.define((s) => s.div(s.span(), s.button(s.string)));
const AnyElement = hson.liveMap.schema.define((s) => s.tag());
const IdentifierCustom = hson.liveMap.schema.define((s) => s.tag.widget());
const Custom = hson.liveMap.schema.define((s) => s.tag["my-widget"]());
const CustomText = hson.liveMap.schema.define((s) => s.tag["my-widget"](s.string));
const AnyTextElement = hson.liveMap.schema.define((s) => s.tag(s.string));
const ThenText = hson.liveMap.schema.define((s) => s.tag.then(s.string));
const ToJsonText = hson.liveMap.schema.define((s) => s.tag.toJSON(s.string));
const RepeatedButtons = hson.liveMap.schema.define((s) => s.div(s.repeat(s.button())));
const ItemPick = hson.liveMap.schema.define((s) => s.div(s.pick(s.string, s.button())));
const MultiRoot = hson.liveMap.schema.define((s) => s.tuple(s.div(), s.button()));
const EmptyRoot = hson.liveMap.schema.define((s) => s.tuple());
let dynamicTagName: string = "runtime-widget";
const DynamicTag = hson.liveMap.schema.define((s) => s.tag[dynamicTagName](s.string));
dynamicTagName = "later-widget";

let observedTagFamily: object | undefined;
hson.liveMap.schema.define((s) => {
  observedTagFamily = s.tag;
  return s.string;
});
if (observedTagFamily === undefined) throw new Error("Expected the tag family.");
const tagFamilyObject: object = observedTagFamily;
const promisedTagFamily = await Promise.resolve(tagFamilyObject);
const awaitedTagFamily = await tagFamilyObject;
const constructedTagFamily = await new Promise((resolve) => resolve(tagFamilyObject));
const allTagFamilies = await Promise.all([tagFamilyObject, Promise.resolve(tagFamilyObject)]);

check("schema facade exposes only define", () => {
  assert.deepEqual(Object.keys(hson.liveMap.schema), ["define"]);
});

check("define receives one direct frozen toolkit", () => {
  let observed: object | undefined;
  hson.liveMap.schema.define((s) => { observed = s; return s.string; });
  assert.equal(Object.isFrozen(observed), true);
  assert.equal("projected" in (observed as object), false);
  assert.equal("document" in (observed as object), false);
  assert.equal("element" in (observed as object), false);
});

check("callable tag family is frozen, stateless, and reflection-minimal", () => {
  assert.equal(Object.isFrozen(tagFamilyObject), true);
  assert.equal(Object.getPrototypeOf(tagFamilyObject), null);
  assert.deepEqual(Reflect.ownKeys(tagFamilyObject), []);
  assert.equal("foo" in tagFamilyObject, false);
  assert.equal(Object.hasOwn(tagFamilyObject, "foo"), false);
  assert.equal(Reflect.get(tagFamilyObject, "foo") === Reflect.get(tagFamilyObject, "foo"), false);
});

check("Promise and coercion probes preserve ordinary callable-object behavior", () => {
  assert.equal(promisedTagFamily, tagFamilyObject);
  assert.equal(awaitedTagFamily, tagFamilyObject);
  assert.equal(constructedTagFamily, tagFamilyObject);
  assert.deepEqual(allTagFamilies, [tagFamilyObject, tagFamilyObject]);
  assert.equal(JSON.stringify({ tag: tagFamilyObject }), "{}");
  assert.equal(String(tagFamilyObject), "hson.liveMap.schema.tag");
  assert.equal(Object.prototype.toString.call(tagFamilyObject), "[object Function]");
});

check("non-string probe symbols stay unavailable", () => {
  assert.equal(Reflect.get(tagFamilyObject, Symbol.toStringTag), undefined);
  assert.equal(Reflect.get(tagFamilyObject, Symbol.iterator), undefined);
  assert.equal(Reflect.get(tagFamilyObject, Symbol.asyncIterator), undefined);
  assert.equal(Reflect.get(tagFamilyObject, Symbol.for("nodejs.util.inspect.custom")), undefined);
});

check("known HTML and SVG builders derive from the canonical tag catalogs", () => {
  hson.liveMap.schema.define((s) => {
    for (const tag of [...HTML_TAGS, ...SVG_TAGS]) {
      if (["object"].includes(tag)) continue;
      assert.equal(typeof Reflect.get(s, tag), "function", tag);
    }
    return s.div();
  });
});

check("defined schema objects are immutable and owner-independent", () => {
  assert.equal(Object.isFrozen(TextDiv), true);
  assert.equal(element(`<div "a"/>`).schema.use(TextDiv).schema.get(), TextDiv);
  assert.equal(element(`<div "b"/>`).schema.use(TextDiv).schema.get(), TextDiv);
});

check("zero known-tag children mean broad descendants", () => {
  element(`<div <section "x" <strong "y"/>/>/>`).schema.use(BroadDiv);
});

check("tuple() spells exact empty known-tag content", () => {
  element(`<div/>`).schema.use(EmptyDiv);
  rejectsSchema(element(`<div "x"/>`), EmptyDiv, /closed sequence length 0/);
});

check("one string child is exact logical string content", () => {
  const map = element(`<div "Save"/>`).schema.use(TextDiv);
  assert.equal(map.at([0]).snap(), "Save");
  rejectsSchema(element(`<div <em/>/>`), TextDiv, /Expected text/);
});

check("multiple child arguments form one exact ordered layout", () => {
  element(`<div <span/> <button "Save"/>/>`).schema.use(FixedDiv);
  rejectsSchema(element(`<div <button "Save"/> <span/>/>`), FixedDiv, /Expected tag/);
});

check("callable tag() zero-argument form retains any-element broadness", () => {
  element(`<button <em/>/>`).schema.use(AnyElement);
  element(`<section "x"/>`).schema.use(AnyElement);
});

check("identifier custom tag properties preserve exact runtime tags", () => {
  element(`<widget/>`).schema.use(IdentifierCustom);
  rejectsSchema(element(`<other-widget/>`), IdentifierCustom, /Expected tag "widget"/);
});

check("bracket custom tag properties preserve exact runtime tags", () => {
  element(`<my-widget/>`).schema.use(Custom);
  rejectsSchema(element(`<other-widget/>`), Custom, /Expected tag "my-widget"/);
});

check("custom tag explicit content is exact", () => {
  element(`<my-widget "x"/>`).schema.use(CustomText);
  rejectsSchema(element(`<my-widget "x" "y"/>`), CustomText, /closed sequence length 1/);
});

check("then and toJSON remain exact tag builders under host probes", () => {
  element(`<then "x"/>`).schema.use(ThenText);
  rejectsSchema(element(`<other "x"/>`), ThenText, /Expected tag "then"/);
  element(`<toJSON "x"/>`).schema.use(ToJsonText);
  rejectsSchema(element(`<other "x"/>`), ToJsonText, /Expected tag "toJSON"/);
});

check("function and object property names remain exact tag builders", () => {
  hson.liveMap.schema.define((s) => {
    for (const property of [
      "name", "length", "prototype", "constructor", "caller", "arguments",
      "call", "apply", "bind", "toString", "valueOf", "inspect", "__proto__",
    ]) {
      const PropertySchema = hson.liveMap.schema.define(() => s.tag[property]());
      element(`<${property}/>`).schema.use(PropertySchema);
    }
    return s.tag();
  });
});

check("any-element explicit content is exact", () => {
  element(`<other-widget "x"/>`).schema.use(AnyTextElement);
  rejectsSchema(element(`<other-widget/>`), AnyTextElement, /closed sequence length 1/);
});

check("repeat accepts zero or more matching direct children", () => {
  element(`<div/>`).schema.use(RepeatedButtons);
  element(`<div <button/> <button "x"/>/>`).schema.use(RepeatedButtons);
});

check("item pick preserves item branch evidence", () => {
  element(`<div "a"/>`).schema.use(ItemPick);
  element(`<div <button/>/>`).schema.use(ItemPick);
  rejectsSchema(element(`<div <span/>/>`), ItemPick, /no pick branch matched/);
});

check("tuple is one multi-root fragment schema", () => {
  fragment(`<div/> <button/>`).schema.use(MultiRoot);
  rejectsSchema(fragment(`<button/> <div/>`), MultiRoot, /Expected tag/);
});

check("tuple() is the exact empty fragment schema", () => {
  emptyFragment().schema.use(EmptyRoot);
  rejectsSchema(fragment(`"x"`), EmptyRoot, /closed sequence length 0/);
});

check("element and fragment attachment modes remain distinct", () => {
  assert.throws(() => Reflect.apply(element(`<div/>`).schema.use, undefined, [MultiRoot]), /fragment document root/);
  assert.throws(() => Reflect.apply(fragment(`"x" <div/>`).schema.use, undefined, [BroadDiv]), /element document root/);
});

check("defined document schemas compose with exact evidence", () => {
  const Label = hson.liveMap.schema.define((s) => s.span(s.string));
  const Button = hson.liveMap.schema.define((s) => s.button(Label));
  const Toolbar = hson.liveMap.schema.define((s) => s.div(Button, Button));
  const typed = element(`<div <button <span "A"/>/> <button <span "B"/>/>/>`).schema.use(Toolbar);
  assert.equal(typed.at([1, 0, 0]).snap(), "B");
});

check("one child schema can be reused by independent parents", () => {
  const Label = hson.liveMap.schema.define((s) => s.span(s.string));
  const Left = hson.liveMap.schema.define((s) => s.div(Label));
  const Right = hson.liveMap.schema.define((s) => s.button(Label));
  element(`<div <span "L"/>/>`).schema.use(Left);
  element(`<button <span "R"/>/>`).schema.use(Right);
});

check("shared string schema retains projected and document capabilities", () => {
  const StringSchema = hson.liveMap.schema.define((s) => s.string);
  const State = hson.liveMap.schema.define((s) => s.object.exact({ value: StringSchema }));
  assert.deepEqual(hson.liveMap.fromJson({ value: "value" }).schema.use(State).snap(), { value: "value" });
  const Parent = hson.liveMap.schema.define((s) => s.div(StringSchema));
  element(`<div "value"/>`).schema.use(Parent);
});

check("shared tuple retains projected and document layout capabilities", () => {
  const Pair = hson.liveMap.schema.define((s) => s.tuple(s.string, s.string));
  const State = hson.liveMap.schema.define((s) => s.object.exact({ pair: Pair }));
  hson.liveMap.fromJson({ pair: ["a", "b"] }).schema.use(State);
  const Parent = hson.liveMap.schema.define((s) => s.div(Pair));
  element(`<div "a" "b"/>`).schema.use(Parent);
});

check("cross-domain element-in-object composition rejects at runtime", () => {
  assert.throws(() => hson.liveMap.schema.define((s) => Reflect.apply(s.object.exact, s.object, [{ child: s.div() }])), /Projected schema composition/);
});

check("cross-domain number-in-element composition rejects at runtime", () => {
  assert.throws(() => hson.liveMap.schema.define((s) => Reflect.apply(s.div, s, [s.number])), /document item schema/);
});

check("incompatible pick categories reject at runtime", () => {
  assert.throws(() => hson.liveMap.schema.define((s) => Reflect.apply(s.pick, s, [s.number, s.button()])), /compatible schema capability/);
});

check("dynamic property names snapshot exact runtime constraints", () => {
  element(`<runtime-widget "x"/>`).schema.use(DynamicTag);
  rejectsSchema(element(`<later-widget "x"/>`), DynamicTag, /Expected tag "runtime-widget"/);
});

check("old string-taking tag calls reject at runtime", () => {
  assert.throws(
    () => hson.liveMap.schema.define((s) => Reflect.apply(s.tag, s.tag, ["legacy-widget"])),
    /Document element children must be document schema expressions/,
  );
});

process.stdout.write(`# ${checks} unified LiveMap document schema checks passed\n`);
emit_hson_live_test_completion("livemap.document-schema-construction", checks, checks, 0);
