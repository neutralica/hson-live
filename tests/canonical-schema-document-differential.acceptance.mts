import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import { parse_hson } from "../src/api/transform/parsers/parse-hson.ts";
import { ROOT_TAG } from "../src/core/constants.ts";
import { CREATE_NODE } from "../src/core/factories.ts";
import { validate_livemap_document_schema_root, type InternalDocumentRootSchema } from "../src/api/livemap/livemap.document.schema.ts";
import { evaluate_canonical_document_schema } from "../src/internal/canonical-schema/evaluate.ts";
import { lower_current_schema } from "../src/internal/canonical-schema/lower-current-schema.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

let checks = 0;
const check = (name: string, run: () => void): void => { run(); console.log(`ok ${++checks} - ${name}`); };
const define = hson.liveMap.schema.define;
const evidence = (result: { ok: boolean; issues: readonly { code: string; path: readonly (string | number)[]; expected?: string; received?: string; attributeName?: string }[] }) => ({
  ok: result.ok,
  issues: result.issues.map(({ code, path, expected, received, attributeName }) => ({ code, path: [...path], expected, received, attributeName })),
});
const differential = (name: string, schema: object, source: string, mode: "element" | "fragment"): void => check(name, () => {
  const lowered = lower_current_schema(schema); assert.equal(lowered.ok, true, lowered.ok ? "" : JSON.stringify(lowered.reasons));
  if (!lowered.ok) return;
  const candidate = source === "" ? CREATE_NODE({ $_tag: ROOT_TAG, $_content: [] }) : parse_hson(source, { allowTopLevelTextFragment: true });
  const current = validate_livemap_document_schema_root(schema as InternalDocumentRootSchema, candidate, mode);
  const canonical = evaluate_canonical_document_schema(lowered.graph, candidate, mode);
  assert.deepEqual(evidence(canonical), evidence(current));
});

const AnyElement = define(s => s.tag());
const MainBroad = define(s => s.main());
const MainEmpty = define(s => s.main(s.empty));
const MainText = define(s => s.main(s.string));
const Mixed = define(s => s.main(s.string, s.tag()));
const RepeatedText = define(s => s.repeat(s.string));
const TwoText = define(s => s.repeat(2, s.string));
const OneElement = define(s => s.tag(s.tag(s.string)));
const ItemPick = define(s => s.tag(s.pick(s.string, s.tag(s.string))));
const FragmentMixed = define(s => s.tuple(s.string, s.tag()));
const LayoutPick = define(s => s.pick(s.tuple(s.string, s.tag()), s.repeat(s.string)));
const Attrs = define(s => s.button(s.attrs.exact({
  disabled: s.flag,
  selected: s.flag.optional,
  count: s.number,
  title: s.string.optional,
  mode: s.literal("a", "b"),
}), s.string));
const OpenAttrs = define(s => s.div(s.attrs({ id: s.string })));
const StyleAttrs = define(s => s.div(s.attrs.exact({ style: s.unknown })));

differential("arbitrary element accepts ordinary tag", AnyElement, "<custom/>", "element");
differential("exact element tag accepts", MainBroad, "<main/>", "element");
differential("exact element tag mismatch evidence", MainBroad, "<section/>", "element");
differential("broad element content accepts mixed children", MainBroad, '<main "x" <a/>/>', "element");
differential("explicit empty content accepts", MainEmpty, "<main/>", "element");
differential("explicit empty content rejects extra child", MainEmpty, '<main "x"/>', "element");
differential("text child accepts", MainText, '<main "x"/>', "element");
differential("text child rejects element", MainText, "<main <a/>/>", "element");
differential("exact sequence accepts child order", Mixed, '<main "x" <a/>/>', "element");
differential("exact sequence rejects reversed child order", Mixed, '<main <a/> "x"/>', "element");
differential("exact sequence reports missing child", Mixed, '<main "x"/>', "element");
differential("exact sequence reports extra child", Mixed, '<main "x" <a/> <b/>/>', "element");
differential("unbounded repeat accepts empty fragment", RepeatedText, "", "fragment");
differential("unbounded repeat accumulates item failures", RepeatedText, '"a" <b/> "c"', "fragment");
differential("counted repeat exact", TwoText, '"a" "b"', "fragment");
differential("counted repeat short", TwoText, '"a"', "fragment");
differential("counted repeat long", TwoText, '"a" "b" "c"', "fragment");
differential("nested element rule accepts", OneElement, '<main <span "x"/>/>', "element");
differential("item union accepts second branch", ItemPick, '<main <span "x"/>/>', "element");
differential("item union emits header then closest branch", ItemPick, '<main <span <b/>/>/>', "element");
differential("fragment root exact layout accepts", FragmentMixed, '"x" <a/>', "fragment");
differential("fragment is not coerced to element", FragmentMixed, '<a/>', "fragment");
differential("content union accepts repeat branch", LayoutPick, '"a" "b"', "fragment");
differential("content union branch ordering and depth", LayoutPick, '<a/> "b"', "fragment");
differential("exact attrs and flags accept", Attrs, '<button disabled count=2 mode="a" "go"/>', "element");
differential("missing required attrs preserve declared order", Attrs, '<button "go"/>', "element");
differential("wrong projected attr value", Attrs, '<button disabled count="bad" mode="a" "go"/>', "element");
differential("wrong flag value", Attrs, '<button disabled=false count=2 mode="a" "go"/>', "element");
differential("exact attrs candidate-order extras", Attrs, '<button disabled count=2 mode="a" z=1 a=2 "go"/>', "element");
differential("open attrs permit extra", OpenAttrs, '<div id="x" extra=true/>', "element");
differential("canonical structured style attr uses projected-any ref", StyleAttrs, '<div style="color:red; width:2px"/>', "element");

check("attrs constrain blocks whole lowering and does not execute", () => {
  let calls = 0;
  const schema = define(s => s.div(s.attrs({ id: s.string.constrain(() => { calls += 1; return true; }) })));
  const lowered = lower_current_schema(schema); assert.equal(lowered.ok, false); assert.equal(calls, 0);
  if (!lowered.ok) assert.equal(lowered.reasons.some(reason => reason.code === "CONSTRAIN_CALLBACK"), true);
});

emit_hson_live_test_completion("canonical-schema-document-differential", checks, checks, 0);
