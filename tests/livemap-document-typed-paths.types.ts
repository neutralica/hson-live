import { hson } from "../src/index.js";
import type { HsonNode, Primitive } from "../src/core/types.js";
import type { LiveTree } from "../src/api/livetree/livetree.js";
import type { ClassifiedLiveMap, DocumentLiveMap, ElementLiveMap, FragmentLiveMap } from "../src/types/livemap.types.js";

type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends
  (<T>() => T extends TRight ? 1 : 2) ? true : false;
type Expect<TValue extends true> = TValue;
type Snap<TLocation extends Readonly<{ snap: () => unknown }>> = ReturnType<TLocation["snap"]>;
type Watch<TLocation extends Readonly<{ watch: (listener: never) => unknown }>> = Parameters<Parameters<TLocation["watch"]>[0]>[0];

declare const elementMap: ElementLiveMap;
declare const fragmentMap: FragmentLiveMap;
declare const tree: LiveTree;
declare const index: number;
declare const broadPath: readonly number[];

type _LegacyElement = Expect<Equal<Snap<ReturnType<typeof elementMap.at<[0]>>>, HsonNode | Primitive | undefined>>;
type _LegacyFragment = Expect<Equal<Snap<ReturnType<typeof fragmentMap.at<[0]>>>, HsonNode | Primitive | undefined>>;

const FixedElementSchema = hson.liveMap.schema.define((s) => s.tag(s.string, s.tag(), s.string));
const FixedFragmentSchema = hson.liveMap.schema.define((s) => s.tuple(s.string, s.tag(), s.string));
const fixedElement = elementMap.schema.use(FixedElementSchema);
const fixedFragment = fragmentMap.schema.use(FixedFragmentSchema);

type _ElementRoot = Expect<Equal<Snap<ReturnType<typeof fixedElement.at<[]>>>, HsonNode>>;
type _FragmentRoot = Expect<Equal<Snap<ReturnType<typeof fixedFragment.at<[]>>>, HsonNode>>;
type _FixedText0 = Expect<Equal<Snap<ReturnType<typeof fixedElement.at<[0]>>>, string>>;
type _FixedElement1 = Expect<Equal<Snap<ReturnType<typeof fixedElement.at<[1]>>>, HsonNode>>;
type _FixedText2 = Expect<Equal<Snap<ReturnType<typeof fixedElement.at<[2]>>>, string>>;
type _FragmentText0 = Expect<Equal<Snap<ReturnType<typeof fixedFragment.at<[0]>>>, string>>;
const inferredFixedElement = fixedElement.at([1]).snap();
type _ConstInferredFixedElement = Expect<Equal<typeof inferredFixedElement, HsonNode>>;
// @ts-expect-error Fixed tuple index 3 is statically impossible.
fixedElement.at([3]);

const EmptyElementSchema = hson.liveMap.schema.define((s) => s.tag(s.tuple()));
const EmptyFragmentSchema = hson.liveMap.schema.define((s) => s.tuple());
const emptyElement = elementMap.schema.use(EmptyElementSchema);
const emptyFragment = fragmentMap.schema.use(EmptyFragmentSchema);
emptyElement.at([]); emptyFragment.at([]);
// @ts-expect-error Exact-empty element content has no child coordinate.
emptyElement.at([0]);
// @ts-expect-error Exact-empty fragment content has no child coordinate.
emptyFragment.at([0]);

const RepeatTextSchema = hson.liveMap.schema.define((s) => s.repeat(s.string));
const repeatedText = fragmentMap.schema.use(RepeatTextSchema);
type _RepeatedText = Expect<Equal<Snap<ReturnType<typeof repeatedText.at<[123]>>>, string | undefined>>;
type _RepeatedTextDynamic = Expect<Equal<Snap<ReturnType<typeof repeatedText.at<[number]>>>, string | undefined>>;
repeatedText.at([index]);

const CountedTextSchema = hson.liveMap.schema.define((s) => s.repeat(3, s.string));
const countedText = fragmentMap.schema.use(CountedTextSchema);
type _CountedText0 = Expect<Equal<Snap<ReturnType<typeof countedText.at<[0]>>>, string>>;
type _CountedText2 = Expect<Equal<Snap<ReturnType<typeof countedText.at<[2]>>>, string>>;
type _CountedTextDynamic = Expect<Equal<Snap<ReturnType<typeof countedText.at<[number]>>>, string | undefined>>;
// @ts-expect-error Exact counted repeat has no coordinate 3.
countedText.at([3]);

declare const dynamicCount: number;
const DynamicCountedTextSchema = hson.liveMap.schema.define((s) => s.repeat(dynamicCount, s.string));
const dynamicCountedText = fragmentMap.schema.use(DynamicCountedTextSchema);
type _DynamicCountedChild = Expect<Equal<Snap<ReturnType<typeof dynamicCountedText.at<[0]>>>, string | undefined>>;

const LargeCountedTextSchema = hson.liveMap.schema.define((s) => s.repeat(1_000_000, s.string));
const largeCountedText = fragmentMap.schema.use(LargeCountedTextSchema);
type _LargeCountedEarlyCoordinate = Expect<Equal<Snap<ReturnType<typeof largeCountedText.at<[2]>>>, string>>;

const EmptyAtomSchema = hson.liveMap.schema.define((s) => s.empty);
const emptyAtom = fragmentMap.schema.use(EmptyAtomSchema);
// @ts-expect-error The exact-empty atom has no child coordinate.
emptyAtom.at([0]);

const ZeroCountedTextSchema = hson.liveMap.schema.define((s) => s.repeat(0, s.string));
const zeroCountedText = fragmentMap.schema.use(ZeroCountedTextSchema);
// @ts-expect-error Count zero has the same static coordinate closure as empty.
zeroCountedText.at([0]);

const RepeatedUnionSchema = hson.liveMap.schema.define((s) => s.repeat(s.pick(s.string, s.tag())));
const repeatedItemUnion = fragmentMap.schema.use(RepeatedUnionSchema);
type _RepeatedUnion = Expect<Equal<Snap<ReturnType<typeof repeatedItemUnion.at<[0]>>>, string | HsonNode | undefined>>;

const LayoutUnionSchema = hson.liveMap.schema.define((s) => s.pick(
  s.tuple(s.string, s.string),
  s.tuple(s.string, s.tag(), s.string),
));
const layoutUnion = fragmentMap.schema.use(LayoutUnionSchema);
type _Layout0 = Expect<Equal<Snap<ReturnType<typeof layoutUnion.at<[0]>>>, string>>;
type _Layout1 = Expect<Equal<Snap<ReturnType<typeof layoutUnion.at<[1]>>>, string | HsonNode>>;
type _Layout2 = Expect<Equal<Snap<ReturnType<typeof layoutUnion.at<[2]>>>, string | undefined>>;
// @ts-expect-error No layout branch contains coordinate 3.
layoutUnion.at([3]);

const NestedClosedSchema = hson.liveMap.schema.define((s) => s.tag(s.tag(s.string)));
const nestedClosed = elementMap.schema.use(NestedClosedSchema);
type _NestedElement = Expect<Equal<Snap<ReturnType<typeof nestedClosed.at<[0]>>>, HsonNode>>;
type _NestedText = Expect<Equal<Snap<ReturnType<typeof nestedClosed.at<[0, 0]>>>, string>>;
// @ts-expect-error Nested closed element has only coordinate 0.
nestedClosed.at([0, 1]);

const NestedBroadSchema = hson.liveMap.schema.define((s) => s.tag(s.tag()));
const nestedBroad = elementMap.schema.use(NestedBroadSchema);
type _BroadElement = Expect<Equal<Snap<ReturnType<typeof nestedBroad.at<[0]>>>, HsonNode>>;
type _BroadDescendant = Expect<Equal<Snap<ReturnType<typeof nestedBroad.at<[0, 0]>>>, string | HsonNode | undefined>>;

type _FixedDynamic = Expect<Equal<Snap<ReturnType<typeof fixedElement.at<[number]>>>, string | HsonNode | undefined>>;
type _PartialDynamic = Expect<Equal<Snap<ReturnType<typeof nestedClosed.at<[0, number]>>>, string | undefined>>;
type _FullyBroadElement = Expect<Equal<Snap<ReturnType<typeof fixedElement.at<readonly number[]>>>, string | HsonNode | undefined>>;
fixedElement.at(broadPath); fixedFragment.at(broadPath);
// @ts-expect-error Text endpoints have no logical children.
fixedElement.at([0, 0]);

const TextOrElementSchema = hson.liveMap.schema.define((s) => s.tuple(s.pick(s.string, s.tag(s.string))));
const textOrClosedElement = fragmentMap.schema.use(TextOrElementSchema);
type _UnionContinuation = Expect<Equal<Snap<ReturnType<typeof textOrClosedElement.at<[0, 0]>>>, string | undefined>>;
// @ts-expect-error Neither branch can continue at coordinate 1.
textOrClosedElement.at([0, 1]);

const typedText = fixedElement.at([0]);
type _SnapText = Expect<Equal<Snap<typeof typedText>, string>>;
type _WatchText = Expect<Equal<Watch<typeof typedText>, string>>;
typedText.watch((next) => { const exact: string = next; void exact; });
tree.bind.text(typedText);
// @ts-expect-error Possibly structured endpoints require a formatter.
tree.bind.text(repeatedItemUnion.at([0]));
tree.bind.text(repeatedItemUnion.at([0]), (value) => String(value ?? ""));

const broadElementAnnotation: ElementLiveMap = fixedElement;
const broadFragmentAnnotation: FragmentLiveMap = fixedFragment;
const documentUnionElement: DocumentLiveMap = fixedElement;
const classifiedFragment: ClassifiedLiveMap = fixedFragment;
void broadElementAnnotation; void broadFragmentAnnotation; void documentUnionElement; void classifiedFragment;

const representativeSchema = hson.liveMap.schema.define((s) => s.tag(
  s.tag(s.tag(s.pick(s.string, s.tag(), s.tag(s.string, s.string)))),
));
const representative = elementMap.schema.use(representativeSchema);
type _RepresentativeNestedUnion = Expect<Equal<
  Snap<ReturnType<typeof representative.at<[0, 0, 0, 0]>>>,
  string | HsonNode | undefined
>>;

export {};
