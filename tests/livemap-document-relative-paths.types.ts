import { hson } from "../src/index.js";
import type { LiveTree } from "../src/api/livetree/livetree.js";
import type { HsonNode, Primitive } from "../src/core/types.js";
import type {
  ElementLiveMap,
  FragmentLiveMap,
  LiveMapDocumentContent,
} from "../src/types/livemap.types.js";

type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends
  (<T>() => T extends TRight ? 1 : 2)
    ? true
    : false;
type Expect<TValue extends true> = TValue;
type Snap<TLocation extends Readonly<{ snap: () => unknown }>> = ReturnType<TLocation["snap"]>;
type Watch<TLocation extends Readonly<{ watch: (listener: never) => unknown }>> =
  Parameters<Parameters<TLocation["watch"]>[0]>[0];

const d = hson.liveMap.schema.document;

declare const elementMap: ElementLiveMap;
declare const fragmentMap: FragmentLiveMap;
declare const tree: LiveTree;
declare const node: HsonNode;
declare const index: number;
declare const broadPath: readonly number[];

const nested = elementMap.schema.use(d.element({
  content: d.sequence(d.element({
    content: d.sequence(
      d.text,
      d.element({ content: d.sequence(d.text) }),
    ),
  })),
}));

const nestedRoot = nested.at([]);
const nestedInner = nestedRoot.at([0]);
const relativeText = nestedInner.at([0]);
const relativeElement = nestedInner.at([1]);
const relativeDeepText = relativeElement.at([0]);

type _RootRelativeChild = Expect<Equal<
  Snap<ReturnType<typeof nestedRoot.at<[0]>>>,
  Snap<ReturnType<typeof nested.at<[0]>>>
>>;
type _NestedInner = Expect<Equal<Snap<typeof nestedInner>, HsonNode>>;
type _NestedText = Expect<Equal<Snap<typeof relativeText>, string>>;
type _NestedElement = Expect<Equal<Snap<typeof relativeElement>, HsonNode>>;
type _NestedDeepText = Expect<Equal<Snap<typeof relativeDeepText>, string>>;
type _DirectRelativeTwo = Expect<Equal<
  Snap<typeof relativeText>,
  Snap<ReturnType<typeof nested.at<[0, 0]>>>
>>;
type _DirectRelativeThree = Expect<Equal<
  Snap<typeof relativeDeepText>,
  Snap<ReturnType<typeof nested.at<[0, 1, 0]>>>
>>;

// @ts-expect-error The nested closed element has only coordinates 0 and 1.
nestedInner.at([2]);
// @ts-expect-error Schema-proven text has no logical descendants.
relativeText.at([0]);
// @ts-expect-error The nested leaf element has only one text coordinate.
relativeElement.at([1]);

const nestedEmpty = elementMap.schema.use(d.element({
  content: d.sequence(d.element({ content: d.sequence() })),
}));
// @ts-expect-error Permanently empty nested content has no exact child.
nestedEmpty.at([0]).at([0]);

const fragmentRoot = fragmentMap.schema.use(d.fragment(
  d.sequence(d.text, d.element()),
)).at([]);
type _FragmentRootRelative = Expect<Equal<
  Snap<ReturnType<typeof fragmentRoot.at<[0]>>>,
  string
>>;

const repeatedElement = fragmentMap.schema.use(d.fragment(d.repeat(d.element({
  content: d.sequence(d.text),
}))));
const repeatedItem = repeatedElement.at([index]);
const repeatedChild = repeatedItem.at([0]);
type _RepeatedItem = Expect<Equal<Snap<typeof repeatedItem>, HsonNode | undefined>>;
type _RepeatedChild = Expect<Equal<Snap<typeof repeatedChild>, string | undefined>>;
type _RepeatedChildWatch = Expect<Equal<Watch<typeof repeatedChild>, string | undefined>>;
type _RepeatedDirectRelative = Expect<Equal<
  Snap<typeof repeatedChild>,
  Snap<ReturnType<typeof repeatedElement.at<[number, 0]>>>
>>;
repeatedChild.replace("present");
// @ts-expect-error Ancestor absence does not make undefined writable.
repeatedChild.replace(undefined);
// @ts-expect-error A relative text endpoint rejects structured replacement.
repeatedChild.replace(node);

const repeatedText = fragmentMap.schema.use(d.fragment(d.repeat(d.text)));
// @ts-expect-error A repeated text item cannot be traversed when present.
repeatedText.at([index]).at([0]);

const itemUnion = fragmentMap.schema.use(d.fragment(d.sequence(d.pick(
  d.text,
  d.element({ content: d.sequence(d.text) }),
))));
const unionChild = itemUnion.at([0]).at([0]);
type _UnionChild = Expect<Equal<Snap<typeof unionChild>, string | undefined>>;
unionChild.replace("reachable");
// @ts-expect-error Nontraversable union branches add read absence, not writable undefined.
unionChild.replace(undefined);
// @ts-expect-error No legal union branch can continue to coordinate 1.
itemUnion.at([0]).at([1]);

const layoutUnion = fragmentMap.schema.use(d.fragment(d.pick(
  d.sequence(d.element({ content: d.sequence(d.text) })),
  d.sequence(d.element({ content: d.sequence(d.element()) })),
)));
const layoutChild = layoutUnion.at([0]).at([0]);
type _LayoutChild = Expect<Equal<Snap<typeof layoutChild>, string | HsonNode>>;
type _LayoutDirectRelative = Expect<Equal<
  Snap<typeof layoutChild>,
  Snap<ReturnType<typeof layoutUnion.at<[0, 0]>>>
>>;
layoutChild.replace("text");
layoutChild.replace(node);

const layoutMissingChild = fragmentMap.schema.use(d.fragment(d.pick(
  d.sequence(d.element({ content: d.sequence(d.text) })),
  d.sequence(d.element({ content: d.sequence() })),
)));
const layoutOptionalChild = layoutMissingChild.at([0]).at([0]);
type _LayoutOptionalChild = Expect<Equal<Snap<typeof layoutOptionalChild>, string | undefined>>;

const broadNested = elementMap.schema.use(d.element({
  content: d.sequence(d.element()),
}));
const broadElement = broadNested.at([0]);
const broadChild = broadElement.at([0]);
const broadGrandchild = broadChild.at([0]);
type _BroadElement = Expect<Equal<Snap<typeof broadElement>, HsonNode>>;
type _BroadChild = Expect<Equal<Snap<typeof broadChild>, string | HsonNode | undefined>>;
type _BroadGrandchild = Expect<Equal<Snap<typeof broadGrandchild>, string | HsonNode | undefined>>;
type _BroadDirectRelative = Expect<Equal<
  Snap<typeof broadChild>,
  Snap<ReturnType<typeof broadNested.at<[0, 0]>>>
>>;

const fixedLocal = elementMap.schema.use(d.element({
  content: d.sequence(d.element({
    content: d.sequence(d.text, d.element(), d.text),
  })),
})).at([0]);
const dynamicFixedChild = fixedLocal.at([index]);
type _DynamicFixedChild = Expect<Equal<
  Snap<typeof dynamicFixedChild>,
  string | HsonNode | undefined
>>;

const repeatedList = elementMap.schema.use(d.element({
  content: d.sequence(d.element({ content: d.repeat(d.text) })),
})).at([]).at([0]);
const dynamicRepeatedChild = repeatedList.at([index]);
type _DynamicRepeatedChild = Expect<Equal<Snap<typeof dynamicRepeatedChild>, string | undefined>>;
type _RelativeInsert = Expect<Equal<Parameters<typeof repeatedList.insert>[1], string>>;
repeatedList.insert(0, "item");
// @ts-expect-error Relative repeated-text owner rejects structured insertion.
repeatedList.insert(0, node);
// @ts-expect-error Relative repeated-text owner rejects undefined insertion.
repeatedList.insert(0, undefined);

const partialDynamic = nestedRoot.at([0, index]);
type _PartialDynamic = Expect<Equal<
  Snap<typeof partialDynamic>,
  string | HsonNode | undefined
>>;
const fullyBroad = nestedInner.at(broadPath);
type _FullyBroad = Expect<Equal<Snap<typeof fullyBroad>, string | HsonNode | undefined>>;

relativeText.watch((next) => {
  const exact: string = next;
  void exact;
});
relativeText.replace("updated");
// @ts-expect-error Relative text replacement rejects HsonNode.
relativeText.replace(node);
tree.bind.text(relativeText);
// @ts-expect-error A relative endpoint that may be structured requires a formatter.
tree.bind.text(layoutChild);
tree.bind.text(layoutChild, (value) => typeof value === "string" ? value : "structured");

type _RootReplaceUnchanged = Expect<Equal<
  Parameters<typeof nestedRoot.replace>[0],
  LiveMapDocumentContent
>>;

const legacyRelative = elementMap.at([0]).at([0]);
type _LegacyRelative = Expect<Equal<
  Snap<typeof legacyRelative>,
  HsonNode | Primitive | undefined
>>;
legacyRelative.replace(1);
legacyRelative.insert(0, false);

const discovered = nested.at([]).id("known");
if (discovered !== undefined) {
  type _IdRemainsBroad = Expect<Equal<
    Snap<typeof discovered>,
    HsonNode | Primitive | undefined
  >>;
}

export {};
