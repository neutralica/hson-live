import { hson } from "../src/index.js";
import type { HsonNode, Primitive } from "../src/core/types.js";
import type { LiveTree } from "../src/api/livetree/livetree.js";
import type {
  ClassifiedLiveMap,
  DocumentLiveMap,
  ElementLiveMap,
  FragmentLiveMap,
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
declare const index: number;
declare const broadPath: readonly number[];

const legacyElementLocation = elementMap.at([0]);
const legacyFragmentLocation = fragmentMap.at([0]);
type _LegacyElement = Expect<Equal<Snap<typeof legacyElementLocation>, HsonNode | Primitive | undefined>>;
type _LegacyFragment = Expect<Equal<Snap<typeof legacyFragmentLocation>, HsonNode | Primitive | undefined>>;

const fixedElement = elementMap.schema.use(d.element({
  content: d.sequence(d.text, d.element(), d.text),
}));
const fixedFragment = fragmentMap.schema.use(d.fragment(
  d.sequence(d.text, d.element(), d.text),
));

type _ElementRoot = Expect<Equal<Snap<ReturnType<typeof fixedElement.at<[]>>>, HsonNode>>;
type _FragmentRoot = Expect<Equal<Snap<ReturnType<typeof fixedFragment.at<[]>>>, HsonNode>>;
type _FixedText0 = Expect<Equal<Snap<ReturnType<typeof fixedElement.at<[0]>>>, string>>;
type _FixedElement1 = Expect<Equal<Snap<ReturnType<typeof fixedElement.at<[1]>>>, HsonNode>>;
type _FixedText2 = Expect<Equal<Snap<ReturnType<typeof fixedElement.at<[2]>>>, string>>;
type _FragmentText0 = Expect<Equal<Snap<ReturnType<typeof fixedFragment.at<[0]>>>, string>>;
const inferredFixedElement = fixedElement.at([1]).snap();
type _ConstInferredFixedElement = Expect<Equal<typeof inferredFixedElement, HsonNode>>;

fixedElement.at([]);
fixedFragment.at([]);
fixedElement.at([0]);
fixedElement.at([1]);
fixedElement.at([2]);
// @ts-expect-error Fixed sequence index 3 is statically impossible.
fixedElement.at([3]);

const emptyElement = elementMap.schema.use(d.element({ content: d.sequence() }));
const emptyFragment = fragmentMap.schema.use(d.fragment(d.sequence()));
emptyElement.at([]);
emptyFragment.at([]);
// @ts-expect-error Permanently empty element content has no exact child coordinate.
emptyElement.at([0]);
// @ts-expect-error Permanently empty fragment content has no exact child coordinate.
emptyFragment.at([0]);

const repeatedText = fragmentMap.schema.use(d.fragment(d.repeat(d.text)));
type _RepeatedText0 = Expect<Equal<Snap<ReturnType<typeof repeatedText.at<[0]>>>, string | undefined>>;
type _RepeatedText123 = Expect<Equal<Snap<ReturnType<typeof repeatedText.at<[123]>>>, string | undefined>>;
type _RepeatedTextDynamic = Expect<Equal<Snap<ReturnType<typeof repeatedText.at<[number]>>>, string | undefined>>;
repeatedText.at([0]);
repeatedText.at([123]);
repeatedText.at([index]);

const repeatedItemUnion = fragmentMap.schema.use(d.fragment(
  d.repeat(d.pick(d.text, d.element())),
));
type _RepeatedUnion = Expect<Equal<
  Snap<ReturnType<typeof repeatedItemUnion.at<[0]>>>,
  string | HsonNode | undefined
>>;

const layoutUnion = fragmentMap.schema.use(d.fragment(d.pick(
  d.sequence(d.text, d.text),
  d.sequence(d.text, d.element(), d.text),
)));
type _Layout0 = Expect<Equal<Snap<ReturnType<typeof layoutUnion.at<[0]>>>, string>>;
type _Layout1 = Expect<Equal<Snap<ReturnType<typeof layoutUnion.at<[1]>>>, string | HsonNode>>;
type _Layout2 = Expect<Equal<Snap<ReturnType<typeof layoutUnion.at<[2]>>>, string | undefined>>;
const inferredLayoutOptional = layoutUnion.at([2]).snap();
type _ConstInferredLayoutOptional = Expect<Equal<typeof inferredLayoutOptional, string | undefined>>;
// @ts-expect-error No legal layout branch contains coordinate 3.
layoutUnion.at([3]);

const nestedClosed = elementMap.schema.use(d.element({
  content: d.sequence(d.element({
    content: d.sequence(d.text),
  })),
}));
type _NestedElement = Expect<Equal<Snap<ReturnType<typeof nestedClosed.at<[0]>>>, HsonNode>>;
type _NestedText = Expect<Equal<Snap<ReturnType<typeof nestedClosed.at<[0, 0]>>>, string>>;
nestedClosed.at([0, 0]);
// @ts-expect-error The nested closed element has only coordinate 0.
nestedClosed.at([0, 1]);

const nestedBroad = elementMap.schema.use(d.element({
  content: d.sequence(d.element()),
}));
type _BroadElement = Expect<Equal<Snap<ReturnType<typeof nestedBroad.at<[0]>>>, HsonNode>>;
type _BroadDescendant = Expect<Equal<
  Snap<ReturnType<typeof nestedBroad.at<[0, 0]>>>,
  string | HsonNode | undefined
>>;
nestedBroad.at([0, 0]);

type _FixedDynamic = Expect<Equal<
  Snap<ReturnType<typeof fixedElement.at<[number]>>>,
  string | HsonNode | undefined
>>;
type _PartialDynamic = Expect<Equal<
  Snap<ReturnType<typeof nestedClosed.at<[0, number]>>>,
  string | undefined
>>;
const inferredFixedDynamic = fixedElement.at([index]).snap();
const inferredPartialDynamic = nestedClosed.at([0, index]).snap();
type _InferredFixedDynamic = Expect<Equal<typeof inferredFixedDynamic, string | HsonNode | undefined>>;
type _InferredPartialDynamic = Expect<Equal<typeof inferredPartialDynamic, string | undefined>>;

type _FullyBroadElement = Expect<Equal<
  Snap<ReturnType<typeof fixedElement.at<readonly number[]>>>,
  string | HsonNode | undefined
>>;
type _FullyBroadFragment = Expect<Equal<
  Snap<ReturnType<typeof fixedFragment.at<readonly number[]>>>,
  string | HsonNode | undefined
>>;
fixedElement.at(broadPath);
fixedFragment.at(broadPath);

// @ts-expect-error Text has no logical document children.
fixedElement.at([0, 0]);

const textOrClosedElement = fragmentMap.schema.use(d.fragment(
  d.sequence(d.pick(
    d.text,
    d.element({ content: d.sequence(d.text) }),
  )),
));
type _UnionStructuredContinuation = Expect<Equal<
  Snap<ReturnType<typeof textOrClosedElement.at<[0, 0]>>>,
  string | undefined
>>;
textOrClosedElement.at([0, 0]);
// @ts-expect-error Neither the text nor the closed element branch can continue here.
textOrClosedElement.at([0, 1]);

const typedText = fixedElement.at([0]);
type _SnapText = Expect<Equal<Snap<typeof typedText>, string>>;
type _WatchText = Expect<Equal<Watch<typeof typedText>, string>>;
typedText.watch((next) => {
  const exact: string = next;
  void exact;
});

tree.bind.text(typedText);
// @ts-expect-error A possible structured HSON endpoint still requires explicit text conversion.
tree.bind.text(repeatedItemUnion.at([0]));
tree.bind.text(repeatedItemUnion.at([0]), (value) => String(value ?? ""));

// Relative traversal deliberately stays on the historical broad endpoint in Phase 20B.
type _RelativeStillBroad = Expect<Equal<
  Snap<ReturnType<typeof typedText.at<[0]>>>,
  HsonNode | Primitive | undefined
>>;

// Evidence-bearing maps remain ordinary broad document-map inputs.
const broadElementAnnotation: ElementLiveMap = fixedElement;
const broadFragmentAnnotation: FragmentLiveMap = fixedFragment;
const documentUnionElement: DocumentLiveMap = fixedElement;
const documentUnionFragment: DocumentLiveMap = fixedFragment;
const classifiedElement: ClassifiedLiveMap = fixedElement;
const classifiedFragment: ClassifiedLiveMap = fixedFragment;
void broadElementAnnotation;
void broadFragmentAnnotation;
void documentUnionElement;
void documentUnionFragment;
void classifiedElement;
void classifiedFragment;

function acceptsBroadDocument(map: DocumentLiveMap): HsonNode {
  return map.root();
}
acceptsBroadDocument(fixedElement);
acceptsBroadDocument(fixedFragment);

// Representative nesting and branch count guard against accidental resolver explosion.
const representative = elementMap.schema.use(d.element({ content: d.sequence(
  d.element({ content: d.sequence(
    d.element({ content: d.sequence(
      d.pick(
        d.text,
        d.element(),
        d.element({ content: d.sequence(d.text, d.text) }),
      ),
    ) }),
  ) }),
) }));
type _RepresentativeNestedUnion = Expect<Equal<
  Snap<ReturnType<typeof representative.at<[0, 0, 0, 0]>>>,
  string | HsonNode | undefined
>>;

export {};
