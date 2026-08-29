import { hson } from "../src/index.js";
import type { HsonNode, JsonValue } from "../src/core/types.js";
import type { InferLiveMapSchema } from "../src/api/livemap/livemap.schema.js";
import type { ElementLiveMap, FragmentLiveMap } from "../src/types/livemap.types.js";

type Equal<TLeft, TRight> = (<T>() => T extends TLeft ? 1 : 2) extends (<T>() => T extends TRight ? 1 : 2) ? true : false;
type Expect<TValue extends true> = TValue;
const schema = hson.liveMap.schema;

type _String = Expect<Equal<InferLiveMapSchema<typeof schema.string>, string>>;
type _Number = Expect<Equal<InferLiveMapSchema<typeof schema.number>, number>>;
type _Boolean = Expect<Equal<InferLiveMapSchema<typeof schema.boolean>, boolean>>;
type _Null = Expect<Equal<InferLiveMapSchema<typeof schema.null>, null>>;

const Address = schema.object.exact({ city: schema.string });
const User = schema.object.exact({
  name: schema.string,
  address: Address,
  nick: schema.optional(schema.string),
  score: schema.nullable(schema.number),
  roles: schema.array(schema.literal("admin", "user")),
  pair: schema.tuple(schema.string, schema.number),
  byId: schema.record(Address),
});
type UserValue = InferLiveMapSchema<typeof User>;
type _Object = Expect<Equal<UserValue["address"], { city: string }>>;
type _Optional = Expect<Equal<{} extends Pick<UserValue, "nick"> ? true : false, true>>;
type _Nullable = Expect<Equal<UserValue["score"], number | null>>;
type _Array = Expect<Equal<UserValue["roles"], readonly ("admin" | "user")[]>>;
type _Tuple = Expect<Equal<UserValue["pair"], readonly [string, number]>>;
type _Record = Expect<Equal<UserValue["byId"][string], { city: string }>>;

const Open = schema.object({ known: schema.string });
type _Open = Expect<Equal<string extends keyof InferLiveMapSchema<typeof Open> ? true : false, true>>;
type _Exact = Expect<Equal<string extends keyof UserValue ? true : false, false>>;
const Choice = schema.pick(schema.literal("one"), schema.literal("two"));
type _Choice = Expect<Equal<InferLiveMapSchema<typeof Choice>, "one" | "two">>;
const Tagged = schema.tagged("kind", { a: schema.object.exact({ value: schema.string }), b: schema.object.exact({ count: schema.number }) });
type _Tagged = Expect<Equal<InferLiveMapSchema<typeof Tagged>["kind"], "a" | "b">>;

const Refined = schema.optional(schema.length(schema.pattern(schema.string, { mode: "prefix", pattern: "x" }), { minimum: 2 }));
type _RefinedPresent = Expect<Equal<Exclude<InferLiveMapSchema<typeof Refined>, undefined>, string>>;
const _refinedAbsent: InferLiveMapSchema<typeof Refined> = undefined;
const Partial = schema.partial(User);
type _Partial = Expect<Equal<InferLiveMapSchema<typeof Partial>["name"], string | undefined>>;

type TreeValue = Readonly<{ name: string; children?: readonly TreeValue[] }>;
const { Tree } = schema.declarations({ Tree: schema.object.exact({ name: schema.string, children: schema.optional(schema.array(schema.reference<TreeValue>("Tree"))) }) });
type _Recursive = Expect<Equal<InferLiveMapSchema<typeof Tree>, { name: string; children?: readonly TreeValue[] }>>;
const TreeReference = schema.reference<TreeValue>("Tree");
// @ts-expect-error Symbolic references are inert authoring data, not fluent Schema values.
TreeReference.constrain(() => true);
// @ts-expect-error Symbolic references use the explicit optional constructor.
TreeReference.optional;

const Attrs = schema.attrs.exact({ id: schema.string, hidden: schema.flag.optional, count: schema.optional(schema.number) });
const Page = schema.main(Attrs, schema.div(schema.a(schema.string)));
declare const elementMap: ElementLiveMap;
const pageMap = elementMap.schema.use(Page);
type _DocumentText = Expect<Equal<ReturnType<ReturnType<typeof pageMap.at<[0, 0, 0]>>["snap"]>, string>>;
const Fragment = schema.tuple(schema.header(), schema.section());
const Repeated = schema.repeat(schema.section());
declare const fragmentMap: FragmentLiveMap;
fragmentMap.schema.use(Fragment);
fragmentMap.schema.use(Repeated);

// @ts-expect-error Document-only values cannot enter data objects.
schema.object.exact({ child: schema.div() });
// @ts-expect-error Numbers cannot use string patterns.
schema.pattern(schema.number, { mode: "full", pattern: "1" });
// @ts-expect-error Strings cannot use array uniqueness.
schema.unique(schema.string);
// @ts-expect-error Arbitrary callbacks are not a refinement option.
schema.integer(schema.number, () => true);
// @ts-expect-error Callback recurse is absent from the direct namespace.
schema.recurse(() => schema.string);
// @ts-expect-error Direct values use the explicit optional constructor.
schema.string.optional;
// @ts-expect-error Direct values use the explicit nullable constructor.
schema.string.nullable;
// @ts-expect-error Direct values have no executable constrain modifier.
schema.string.constrain(() => true);

const Broad = schema.array();
type _Broad = Expect<Equal<InferLiveMapSchema<typeof Broad>, readonly JsonValue[]>>;
declare const node: HsonNode;
void node;

export {};
