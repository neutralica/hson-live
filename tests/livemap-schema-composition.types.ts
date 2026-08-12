import { hson } from "../src/index.js";
import type { HsonNode } from "../src/core/types.js";
import type { LiveMapSchema, InferLiveMapSchema } from "../src/api/livemap/livemap.schema.js";
import type { ElementLiveMap, FragmentLiveMap } from "../src/types/livemap.types.js";

type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends
  (<T>() => T extends TRight ? 1 : 2) ? true : false;
type Expect<TValue extends true> = TValue;

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
// @ts-expect-error Incompatible pick branches produce no schema expression.
hson.liveMap.schema.define((s) => s.pick(s.number, s.button()));

function passThrough<TSchema extends LiveMapSchema>(schema: TSchema): TSchema { return schema; }
const passed = passThrough(Seat);
hson.liveMap.fromJson({ connected: true }).schema.use(passed);

// @ts-expect-error The old document namespace is absent.
hson.liveMap.schema.document;
// @ts-expect-error The old raw make alias is absent.
hson.liveMap.schema.make;

export {};
