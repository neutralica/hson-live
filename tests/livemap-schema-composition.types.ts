import { hson } from "../src/index.js";
import type { HsonNode } from "../src/core/types.js";
import type { LiveMapSchema, InferLiveMapSchema } from "../src/api/livemap/livemap.schema.js";
import type { ElementLiveMap, FragmentLiveMap } from "../src/types/livemap.types.js";

type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends
  (<T>() => T extends TRight ? 1 : 2) ? true : false;
type Expect<TValue extends true> = TValue;
type ProjectedSchemaValue =
  | string
  | number
  | boolean
  | null
  | readonly ProjectedSchemaValue[]
  | Readonly<{ [key: string]: ProjectedSchemaValue }>;

const Seat = hson.liveMap.schema.define((s) => s.exact({ connected: s.boolean }));
const State = hson.liveMap.schema.define((s) => s.exact({ left: Seat, right: Seat }));
const InlineState = hson.liveMap.schema.define((s) => s.exact({
  left: s.exact({ connected: s.boolean }),
  right: s.exact({ connected: s.boolean }),
}));
type _ExactAliasEvidence = Expect<Equal<InferLiveMapSchema<typeof State>, InferLiveMapSchema<typeof InlineState>>>;

const Seats = hson.liveMap.schema.define((s) => s.array(Seat));
const Pair = hson.liveMap.schema.define((s) => s.tuple(Seat, Seat));
const Choice = hson.liveMap.schema.define((s) => s.pick(Seat, s.string));
const Dictionary = hson.liveMap.schema.define((s) => s.record(Seat));
type _ArrayItem = Expect<Equal<InferLiveMapSchema<typeof Seats>[number], { connected: boolean }>>;
type _Tuple0 = Expect<Equal<InferLiveMapSchema<typeof Pair>[0], { connected: boolean }>>;
type _Tuple1 = Expect<Equal<InferLiveMapSchema<typeof Pair>[1], { connected: boolean }>>;
type _Pick = Expect<Equal<InferLiveMapSchema<typeof Choice>, { connected: boolean } | string>>;
type _Record = Expect<Equal<InferLiveMapSchema<typeof Dictionary>[string], { connected: boolean }>>;

const OpenUser = hson.liveMap.schema.define((s) => s.object({
  name: s.string,
  settings: s.exact({ enabled: s.boolean }),
}));
const ExactUser = hson.liveMap.schema.define((s) => s.exact({
  name: s.string,
  settings: s.object({ enabled: s.boolean }),
}));
type OpenUserValue = InferLiveMapSchema<typeof OpenUser>;
type ExactUserValue = InferLiveMapSchema<typeof ExactUser>;
type _OpenKnown = Expect<Equal<OpenUserValue["name"], string>>;
type _OpenExtra = Expect<Equal<OpenUserValue["undeclared"], ProjectedSchemaValue | undefined>>;
type _OpenHasStringIndex = Expect<Equal<string extends keyof OpenUserValue ? true : false, true>>;
type _ExactHasNoStringIndex = Expect<Equal<string extends keyof ExactUserValue ? true : false, false>>;
// @ts-expect-error Exact schemas expose no undeclared property.
type _ExactExtra = ExactUserValue["undeclared"];

const MixedObject = hson.liveMap.schema.define((s) => s.exact({ open: OpenUser, exact: ExactUser }));
const MixedArray = hson.liveMap.schema.define((s) => s.array(MixedObject));
const MixedTuple = hson.liveMap.schema.define((s) => s.tuple(OpenUser, ExactUser));
const MixedPick = hson.liveMap.schema.define((s) => s.pick(OpenUser, ExactUser));
type _NestedOpenExtra = Expect<Equal<InferLiveMapSchema<typeof MixedObject>["open"]["extra"], ProjectedSchemaValue | undefined>>;
type _NestedExactClosed = Expect<Equal<string extends keyof InferLiveMapSchema<typeof MixedObject>["exact"] ? true : false, false>>;
type _ArrayOpenExtra = Expect<Equal<InferLiveMapSchema<typeof MixedArray>[number]["open"]["extra"], ProjectedSchemaValue | undefined>>;
type _TupleOpenExtra = Expect<Equal<InferLiveMapSchema<typeof MixedTuple>[0]["extra"], ProjectedSchemaValue | undefined>>;
type _PickRetainsOpenBranch = Expect<Equal<Extract<InferLiveMapSchema<typeof MixedPick>, OpenUserValue>["name"], string>>;

const PartialOpen = hson.liveMap.schema.define((s) => s.partial(OpenUser));
const DeepPartialExact = hson.liveMap.schema.define((s) => s.deepPartial(ExactUser));
type _PartialDefined = Expect<Equal<InferLiveMapSchema<typeof PartialOpen>["name"], string | undefined>>;
type _DeepPartialDefined = Expect<Equal<InferLiveMapSchema<typeof DeepPartialExact>["settings"] extends object | undefined ? true : false, true>>;

const OptionalSeat = hson.liveMap.schema.define((s) => s.exact({ seat: Seat.optional }));
const NullableSeat = hson.liveMap.schema.define(() => Seat.nullable);
type _DefinedOptionalValue = Expect<Equal<InferLiveMapSchema<typeof OptionalSeat>["seat"], { connected: boolean } | undefined>>;
type _DefinedOptionalKey = Expect<Equal<{} extends Pick<InferLiveMapSchema<typeof OptionalSeat>, "seat"> ? true : false, true>>;
type _DefinedNullable = Expect<Equal<InferLiveMapSchema<typeof NullableSeat>, { connected: boolean } | null>>;

const Tagged = hson.liveMap.schema.define((s) => s.tagged("kind", {
  open: s.object({ value: s.string }),
  exact: ExactUser,
}));
type TaggedValue = InferLiveMapSchema<typeof Tagged>;
type _TaggedDiscriminator = Expect<Equal<TaggedValue["kind"], "open" | "exact">>;

const Label = hson.liveMap.schema.define((s) => s.span(s.string));
const Button = hson.liveMap.schema.define((s) => s.button(Label));
const Toolbar = hson.liveMap.schema.define((s) => s.div(Button, Button));
declare const elementMap: ElementLiveMap;
const toolbar = elementMap.schema.use(Toolbar);
type _NestedDocumentString = Expect<Equal<ReturnType<ReturnType<typeof toolbar.at<[1, 0, 0]>>["snap"]>, string>>;
type _NestedDocumentElement = Expect<Equal<ReturnType<ReturnType<typeof toolbar.at<[0]>>["snap"]>, HsonNode>>;

const StringSchema = hson.liveMap.schema.define((s) => s.string);
const SharedPair = hson.liveMap.schema.define((s) => s.tuple(s.string, s.string));
const ProjectedPair = hson.liveMap.schema.define((s) => s.exact({ pair: SharedPair }));
const DocumentPair = hson.liveMap.schema.define((s) => s.div(SharedPair));
type _SharedStringProjected = Expect<Equal<InferLiveMapSchema<typeof StringSchema>, string>>;
type _SharedPairProjected = Expect<Equal<InferLiveMapSchema<typeof ProjectedPair>, { pair: readonly [string, string] }>>;
const documentPairMap = elementMap.schema.use(DocumentPair);
type _SharedPairDocument = Expect<Equal<ReturnType<ReturnType<typeof documentPairMap.at<[1]>>["snap"]>, string>>;

const MultiRoot = hson.liveMap.schema.define((s) => s.tuple(s.div(), s.button()));
declare const fragmentMap: FragmentLiveMap;
fragmentMap.schema.use(MultiRoot);
// @ts-expect-error A document layout cannot attach to an element map.
elementMap.schema.use(MultiRoot);
// @ts-expect-error An element root cannot attach to a fragment map.
fragmentMap.schema.use(Toolbar);

hson.liveMap.schema.define((s) => {
  // @ts-expect-error Document-only elements cannot enter projected objects.
  return s.exact({ child: s.div() });
});
hson.liveMap.schema.define((s) => {
  // @ts-expect-error Projected-only numbers cannot enter document elements.
  return s.div(s.number);
});
hson.liveMap.schema.define((s) => {
  // @ts-expect-error Document-only elements cannot enter projected arrays.
  return s.array(s.button());
});
hson.liveMap.schema.define((s) => {
  // @ts-expect-error Empty is document content, not a projected object property schema.
  return s.object({ child: s.empty });
});
hson.liveMap.schema.define((s) => {
  // @ts-expect-error Empty is document content, not a projected array item schema.
  return s.array(s.empty);
});
hson.liveMap.schema.define((s) => {
  // @ts-expect-error Negative literal repeat counts are rejected statically.
  return s.repeat(-1, s.string);
});
hson.liveMap.schema.define((s) => {
  // @ts-expect-error Fractional literal repeat counts are rejected statically.
  return s.repeat(1.5, s.string);
});
// @ts-expect-error Incompatible pick branches produce no schema expression.
hson.liveMap.schema.define((s) => s.pick(s.number, s.button()));

// @ts-expect-error Raw callback objects are not schema expressions.
hson.liveMap.schema.define((s) => {
  return { value: s.string };
});
hson.liveMap.schema.define((s) => {
  // @ts-expect-error Generic array operands must be explicit schema expressions.
  return s.array({ value: s.string });
});
hson.liveMap.schema.define((s) => {
  // @ts-expect-error Nested object fields must be explicit schema expressions.
  return s.object({ nested: { value: s.string } });
});
// @ts-expect-error Empty projected picks are impossible schemas.
hson.liveMap.schema.define((s) => s.pick());
// @ts-expect-error Empty literal sets are impossible schemas.
hson.liveMap.schema.define((s) => s.literal());
// @ts-expect-error Empty tagged variant tables are impossible schemas.
hson.liveMap.schema.define((s) => s.tagged("kind", {}));
hson.liveMap.schema.define((s) => {
  // @ts-expect-error Tagged variants are explicit object schema expressions.
  return s.tagged("kind", { changed: { value: s.string } });
});
// @ts-expect-error Arrays use only the toolkit combinator.
hson.liveMap.schema.define((s) => s.string.array);
// @ts-expect-error Defined schemas have no postfix array alias.
hson.liveMap.schema.define(() => Seat.array);
// @ts-expect-error Readonly was descriptive metadata, not enforced schema semantics.
hson.liveMap.schema.define((s) => s.string.readonly);
// @ts-expect-error Defined schemas expose no false readonly modifier.
hson.liveMap.schema.define(() => Seat.readonly);
hson.liveMap.schema.define((s) => {
  // @ts-expect-error The former refinement spelling is hard-removed.
  return s.refine(s.number, "positive", (value: number) => value > 0);
});
hson.liveMap.schema.define((s) => {
  // @ts-expect-error The former delayed-reference spelling is hard-removed.
  return s.lazy(() => s.string);
});

function passThrough<TSchema extends LiveMapSchema>(schema: TSchema): TSchema { return schema; }
const passed = passThrough(Seat);
hson.liveMap.fromJson({ connected: true }).schema.use(passed);

// @ts-expect-error The old document namespace is absent.
hson.liveMap.schema.document;
// @ts-expect-error The old raw make alias is absent.
hson.liveMap.schema.make;

export {};
