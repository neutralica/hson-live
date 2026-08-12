import { hson } from "../src/index.js";
import type { LiveTree } from "../src/api/livetree/livetree.js";
import type { HsonNode, Primitive } from "../src/core/types.js";
import type { ElementLiveMap, FragmentLiveMap, LiveMapDocumentContent } from "../src/types/livemap.types.js";

type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends
  (<T>() => T extends TRight ? 1 : 2) ? true : false;
type Expect<TValue extends true> = TValue;
type Snap<TLocation extends Readonly<{ snap: () => unknown }>> = ReturnType<TLocation["snap"]>;
type Watch<TLocation extends Readonly<{ watch: (listener: never) => unknown }>> = Parameters<Parameters<TLocation["watch"]>[0]>[0];

declare const elementMap: ElementLiveMap;
declare const fragmentMap: FragmentLiveMap;
declare const tree: LiveTree;
declare const node: HsonNode;
declare const index: number;
declare const broadPath: readonly number[];

const NestedSchema = hson.liveMap.schema.define((s) => s.tag(s.tag(s.string, s.tag(s.string))));
const nested = elementMap.schema.use(NestedSchema);
const nestedRoot = nested.at([]);
const nestedInner = nestedRoot.at([0]);
const relativeText = nestedInner.at([0]);
const relativeElement = nestedInner.at([1]);
const relativeDeepText = relativeElement.at([0]);

type _RootRelativeChild = Expect<Equal<Snap<ReturnType<typeof nestedRoot.at<[0]>>>, Snap<ReturnType<typeof nested.at<[0]>>>>>;
type _NestedInner = Expect<Equal<Snap<typeof nestedInner>, HsonNode>>;
type _NestedText = Expect<Equal<Snap<typeof relativeText>, string>>;
type _NestedElement = Expect<Equal<Snap<typeof relativeElement>, HsonNode>>;
type _NestedDeepText = Expect<Equal<Snap<typeof relativeDeepText>, string>>;
// @ts-expect-error Closed nested content has only coordinates 0 and 1.
nestedInner.at([2]);
// @ts-expect-error Text has no logical descendants.
relativeText.at([0]);
// @ts-expect-error Nested leaf element has one text coordinate.
relativeElement.at([1]);

const NestedEmptySchema = hson.liveMap.schema.define((s) => s.tag(s.tag(s.tuple())));
const nestedEmpty = elementMap.schema.use(NestedEmptySchema);
// @ts-expect-error Exact-empty nested content has no child.
nestedEmpty.at([0]).at([0]);

const FragmentSchema = hson.liveMap.schema.define((s) => s.tuple(s.string, s.tag()));
const fragmentRoot = fragmentMap.schema.use(FragmentSchema).at([]);
type _FragmentRootRelative = Expect<Equal<Snap<ReturnType<typeof fragmentRoot.at<[0]>>>, string>>;

const RepeatedElementSchema = hson.liveMap.schema.define((s) => s.repeat(s.tag(s.string)));
const repeatedElement = fragmentMap.schema.use(RepeatedElementSchema);
const repeatedItem = repeatedElement.at([index]);
const repeatedChild = repeatedItem.at([0]);
type _RepeatedItem = Expect<Equal<Snap<typeof repeatedItem>, HsonNode | undefined>>;
type _RepeatedChild = Expect<Equal<Snap<typeof repeatedChild>, string | undefined>>;
type _RepeatedChildWatch = Expect<Equal<Watch<typeof repeatedChild>, string | undefined>>;
repeatedChild.replace("present");
// @ts-expect-error Ancestor absence does not make undefined writable.
repeatedChild.replace(undefined);
// @ts-expect-error Relative text rejects structured replacement.
repeatedChild.replace(node);

const RepeatedTextSchema = hson.liveMap.schema.define((s) => s.repeat(s.string));
const repeatedText = fragmentMap.schema.use(RepeatedTextSchema);
// @ts-expect-error Repeated text items cannot be traversed.
repeatedText.at([index]).at([0]);

const ItemUnionSchema = hson.liveMap.schema.define((s) => s.tuple(s.pick(s.string, s.tag(s.string))));
const itemUnion = fragmentMap.schema.use(ItemUnionSchema);
const unionChild = itemUnion.at([0]).at([0]);
type _UnionChild = Expect<Equal<Snap<typeof unionChild>, string | undefined>>;
unionChild.replace("reachable");
// @ts-expect-error Missing branches add read absence, not writable undefined.
unionChild.replace(undefined);
// @ts-expect-error No branch can continue at coordinate 1.
itemUnion.at([0]).at([1]);

const LayoutUnionSchema = hson.liveMap.schema.define((s) => s.pick(
  s.tuple(s.tag(s.string)),
  s.tuple(s.tag(s.tag())),
));
const layoutUnion = fragmentMap.schema.use(LayoutUnionSchema);
const layoutChild = layoutUnion.at([0]).at([0]);
type _LayoutChild = Expect<Equal<Snap<typeof layoutChild>, string | HsonNode>>;
layoutChild.replace("text"); layoutChild.replace(node);

const LayoutMissingSchema = hson.liveMap.schema.define((s) => s.pick(
  s.tuple(s.tag(s.string)),
  s.tuple(s.tag(s.tuple())),
));
const layoutOptionalChild = fragmentMap.schema.use(LayoutMissingSchema).at([0]).at([0]);
type _LayoutOptionalChild = Expect<Equal<Snap<typeof layoutOptionalChild>, string | undefined>>;

const BroadNestedSchema = hson.liveMap.schema.define((s) => s.tag(s.tag()));
const broadNested = elementMap.schema.use(BroadNestedSchema);
const broadElement = broadNested.at([0]);
const broadChild = broadElement.at([0]);
const broadGrandchild = broadChild.at([0]);
type _BroadElement = Expect<Equal<Snap<typeof broadElement>, HsonNode>>;
type _BroadChild = Expect<Equal<Snap<typeof broadChild>, string | HsonNode | undefined>>;
type _BroadGrandchild = Expect<Equal<Snap<typeof broadGrandchild>, string | HsonNode | undefined>>;

const FixedLocalSchema = hson.liveMap.schema.define((s) => s.tag(s.tag(s.string, s.tag(), s.string)));
const fixedLocal = elementMap.schema.use(FixedLocalSchema).at([0]);
type _DynamicFixedChild = Expect<Equal<Snap<ReturnType<typeof fixedLocal.at<[number]>>>, string | HsonNode | undefined>>;

const RepeatedListSchema = hson.liveMap.schema.define((s) => s.tag(s.tag(s.repeat(s.string))));
const repeatedList = elementMap.schema.use(RepeatedListSchema).at([]).at([0]);
type _DynamicRepeatedChild = Expect<Equal<Snap<ReturnType<typeof repeatedList.at<[number]>>>, string | undefined>>;
type _RelativeInsert = Expect<Equal<Parameters<typeof repeatedList.insert>[1], string>>;
repeatedList.insert(0, "item");
// @ts-expect-error Repeated-text owners reject structured insertion.
repeatedList.insert(0, node);

type _PartialDynamic = Expect<Equal<Snap<ReturnType<typeof nestedRoot.at<[0, number]>>>, string | HsonNode | undefined>>;
type _FullyBroad = Expect<Equal<Snap<ReturnType<typeof nestedInner.at<readonly number[]>>>, string | HsonNode | undefined>>;
nestedInner.at(broadPath);

relativeText.watch((next) => { const exact: string = next; void exact; });
relativeText.replace("updated");
// @ts-expect-error Relative text replacement rejects HsonNode.
relativeText.replace(node);
tree.bind.text(relativeText);
// @ts-expect-error Possibly structured relative endpoints require a formatter.
tree.bind.text(layoutChild);
tree.bind.text(layoutChild, (value) => typeof value === "string" ? value : "structured");

type _RootReplaceUnchanged = Expect<Equal<Parameters<typeof nestedRoot.replace>[0], LiveMapDocumentContent>>;
const legacyRelative = elementMap.at([0]).at([0]);
type _LegacyRelative = Expect<Equal<Snap<typeof legacyRelative>, HsonNode | Primitive | undefined>>;
legacyRelative.replace(1); legacyRelative.insert(0, false);

export {};
