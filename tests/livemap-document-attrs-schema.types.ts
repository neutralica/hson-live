import { hson } from "../src/index.js";
import type { CanonicalPublicAttrValue } from "../src/core/types.js";
import type { ElementLiveMap } from "../src/types/livemap.types.js";

type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends
  (<T>() => T extends TRight ? 1 : 2) ? true : false;
type Expect<TValue extends true> = TValue;

declare const elementMap: ElementLiveMap;
declare const dynamicName: string;

const ExactAttrs = hson.liveMap.schema.define((s) => s.attrs.exact({
  id: s.string,
  title: s.string.optional,
  active: s.flag.optional,
  count: s.number.optional,
  code: s.string.constrain((value) => /^[A-Z]{3}-\d{4}$/.test(value)),
  tabindex: s.number.constrain((value) => Number.isInteger(value) && value >= -1).optional,
  style: s.unknown.optional,
}));
const ExactRoot = hson.liveMap.schema.define((s) => s.main(ExactAttrs, s.div(ExactAttrs)));
const exactMap = elementMap.schema.use(ExactRoot);
const exact = exactMap.at([]);
const exactRelative = exact.at([0]);
const exactProxy = exactMap.proxy()[0].$_;

type _RequiredGet = Expect<Equal<ReturnType<typeof exact.attrs.get<"id">>, string>>;
type _OptionalGet = Expect<Equal<ReturnType<typeof exact.attrs.get<"title">>, string | undefined>>;
type _FlagRawGet = Expect<Equal<ReturnType<typeof exact.attrs.get<"active">>, "active" | undefined>>;
type _ConstrainedStringAttrGet = Expect<Equal<ReturnType<typeof exact.attrs.get<"code">>, string>>;
type _ConstrainedAttrGet = Expect<Equal<ReturnType<typeof exact.attrs.get<"tabindex">>, number | undefined>>;
type _StyleGet = Expect<Equal<ReturnType<typeof exact.attrs.get<"style">>, CanonicalPublicAttrValue | undefined>>;
type _MustOptional = Expect<Equal<ReturnType<typeof exact.attrs.must.get<"title">>, string>>;
type _ExactKeys = Expect<Equal<ReturnType<typeof exact.attrs.keys>, readonly ("id" | "title" | "active" | "count" | "code" | "tabindex" | "style")[]>>;

exact.attrs.has("active");
exact.attrs.set("id", "next");
exact.attrs.set("count", 2);
exact.attrs.set("code", "ABC-1234");
exact.attrs.set("tabindex", 0);
exact.attrs.set("active", "active");
exact.attrs.setMany({ id: "next", count: 3, active: "active" });
exact.attrs.drop("id");
exact.attrs.dropMany(["id", "title"]);
exact.attrs.clear();
exact.attrs.replace({ id: "next", code: "ABC-1234" });
exact.attrs.replace({ id: "next", code: "ABC-1234", title: "label", active: "active" });
exact.flags.has("active");
exact.flags.set("active", "id", "title");
exact.flags.clear("active");

// @ts-expect-error Exact attrs reject undeclared reads.
exact.attrs.get("other");
// @ts-expect-error Exact attrs reject dynamic constructive names.
exact.attrs.set(dynamicName, "x");
// @ts-expect-error Exact attrs reject undeclared writes.
exact.attrs.set("other", "x");
// @ts-expect-error Declared values retain their schema type.
exact.attrs.set("count", "wrong");
// @ts-expect-error String-constrained attrs retain the base string type.
exact.attrs.set("code", 123);
// @ts-expect-error setMany rejects undeclared exact properties.
exact.attrs.setMany({ other: "x" });
// @ts-expect-error replace requires required attrs.
exact.attrs.replace({ title: "missing id" });
// @ts-expect-error replace rejects undeclared exact properties.
exact.attrs.replace({ id: "x", other: "x" });
// @ts-expect-error Number attrs cannot admit same-name flag form.
exact.flags.set("count");
// @ts-expect-error Exact undeclared flag names reject.
exact.flags.set("other");

type _RelativeRequired = Expect<Equal<ReturnType<typeof exactRelative.attrs.get<"id">>, string>>;
type _ProxyFlag = Expect<Equal<ReturnType<typeof exactProxy.attrs.get<"active">>, "active" | undefined>>;

const OpenRoot = hson.liveMap.schema.define((s) => s.main(s.attrs({
  id: s.string,
  optional: s.boolean.optional,
  count: s.number.optional,
})));
const open = elementMap.schema.use(OpenRoot).at([]);
type _OpenKnown = Expect<Equal<ReturnType<typeof open.attrs.get<"id">>, string>>;
type _OpenExtra = Expect<Equal<ReturnType<typeof open.attrs.get<"extra">>, CanonicalPublicAttrValue | undefined>>;
type _OpenKeys = Expect<Equal<ReturnType<typeof open.attrs.keys>, readonly string[]>>;
open.attrs.set("extra", null);
open.attrs.setMany({ id: "x", extra: true });
open.attrs.replace({ id: "x", extra: 2 });
open.flags.set("custom-state");
// @ts-expect-error Open declared keys still retain their declared value type.
open.attrs.set("id", 2);
// @ts-expect-error Open declared number attrs cannot be set into flag form.
open.flags.set("count");

const BranchA = hson.liveMap.schema.define((s) => s.button(s.attrs.exact({
  mode: s.literal("a"),
  a: s.string,
  selected: s.flag.optional,
})));
const BranchB = hson.liveMap.schema.define((s) => s.button(s.attrs.exact({
  mode: s.literal("b"),
  b: s.number,
  selected: s.string,
})));
const PickRoot = hson.liveMap.schema.define((s) => s.main(s.pick(BranchA, BranchB)));
const picked = elementMap.schema.use(PickRoot).at([0]);
type _PickMode = Expect<Equal<ReturnType<typeof picked.attrs.get<"mode">>, "a" | "b">>;
type _PickA = Expect<Equal<ReturnType<typeof picked.attrs.get<"a">>, string | undefined>>;
type _PickB = Expect<Equal<ReturnType<typeof picked.attrs.get<"b">>, number | undefined>>;
type _PickSelected = Expect<Equal<ReturnType<typeof picked.attrs.get<"selected">>, "selected" | string | undefined>>;
type _PickKeys = Expect<Equal<ReturnType<typeof picked.attrs.keys>, readonly ("mode" | "a" | "b" | "selected")[]>>;
picked.attrs.set("mode", "a");
picked.attrs.set("mode", "b");
picked.attrs.set("a", "value");
picked.attrs.set("b", 2);
picked.flags.set("selected");

const broadId = exact.id("anything");
if (broadId !== undefined) {
  const broad: CanonicalPublicAttrValue | undefined = broadId.attrs.get("anything");
  broadId.flags.set("anything");
  void broad;
}

// @ts-expect-error Attr schemas are not attachable root contracts.
elementMap.schema.use(ExactAttrs);
// @ts-expect-error Attr schemas are not tuple children.
hson.liveMap.schema.define((s) => s.tuple(ExactAttrs));
// @ts-expect-error Attr schemas must be the first tag operand.
hson.liveMap.schema.define((s) => s.div(s.string, ExactAttrs));
// @ts-expect-error Attr schemas may appear at most once.
hson.liveMap.schema.define((s) => s.div(ExactAttrs, ExactAttrs));
// @ts-expect-error Structural object schemas are not attr-value schemas.
hson.liveMap.schema.define((s) => s.attrs({ bad: s.object({}) }));
// @ts-expect-error The top-level constrain constructor was hard-removed.
hson.liveMap.schema.define((s) => s.constrain(s.number, () => true));
// @ts-expect-error Attr-schema category values are not constrainable projected values.
ExactAttrs.constrain(() => true);
// @ts-expect-error Document elements are not constrainable projected values.
ExactRoot.constrain(() => true);
hson.liveMap.schema.define((s) => {
  // @ts-expect-error Contextual flags are not projected constraint bases.
  s.flag.constrain(() => true);
  // @ts-expect-error Document layouts are not projected constraint bases.
  s.repeat(s.string).constrain(() => true);
  return s.string;
});

export {};
