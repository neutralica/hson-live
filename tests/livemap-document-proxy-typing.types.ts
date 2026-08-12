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
type Snap<TLocation extends Readonly<{ snap: () => unknown }>> =
  ReturnType<TLocation["snap"]>;
type Watch<TLocation extends Readonly<{ watch: (listener: never) => unknown }>> =
  Parameters<Parameters<TLocation["watch"]>[0]>[0];
type Replacement<TLocation extends Readonly<{ replace: (value: never) => unknown }>> =
  Parameters<TLocation["replace"]>[0];
type ProxyAt<TProxy, TIndex extends number> =
  TIndex extends keyof TProxy ? TProxy[TIndex] : never;
type ProxyAt2<TProxy, TFirst extends number, TSecond extends number> =
  ProxyAt<ProxyAt<TProxy, TFirst>, TSecond>;
type ProxyAt3<
  TProxy,
  TFirst extends number,
  TSecond extends number,
  TThird extends number,
> = ProxyAt<ProxyAt2<TProxy, TFirst, TSecond>, TThird>;
type ProxyLocation<TProxy> =
  TProxy extends Readonly<{
    $_: infer TLocation extends Readonly<{ snap: () => unknown }>;
  }>
    ? TLocation
    : never;
type ProxySnap<TProxy> = Snap<ProxyLocation<TProxy>>;

const d = hson.liveMap.schema.document;

declare const elementMap: ElementLiveMap;
declare const fragmentMap: FragmentLiveMap;
declare const tree: LiveTree;
declare const node: HsonNode;
declare const index: number;

const fixed = elementMap.schema.use(d.element({
  content: d.sequence(d.text, d.element(), d.text),
}));
const fixedProxy = fixed.proxy();

type _RootProxy = Expect<Equal<Snap<typeof fixedProxy.$_>, HsonNode>>;
type _FixedText0 = Expect<Equal<ProxySnap<ProxyAt<typeof fixedProxy, 0>>, string>>;
type _FixedElement1 = Expect<Equal<ProxySnap<ProxyAt<typeof fixedProxy, 1>>, HsonNode>>;
type _FixedText2 = Expect<Equal<ProxySnap<ProxyAt<typeof fixedProxy, 2>>, string>>;
type _FixedDynamic = Expect<Equal<
  ProxySnap<ProxyAt<typeof fixedProxy, number>>,
  string | HsonNode | undefined
>>;

fixedProxy[0].$_.replace("Save");
fixedProxy[1].$_.replace(node);
// @ts-expect-error Schema-proven proxy text rejects structured replacement.
fixedProxy[0].$_.replace(node);
// @ts-expect-error Schema-proven proxy element rejects text replacement.
fixedProxy[1].$_.replace("not an element");
// @ts-expect-error Missing-read undefined is never writable document content.
fixedProxy[index].$_.replace(undefined);

// A truthful dynamic numeric signature means an out-of-range literal has the
// same missing-aware type as a dynamic number. Direct and relative at(...)
// retain exact impossible-path rejection.
type _FixedOutOfRangeProxy = Expect<Equal<
  ProxySnap<ProxyAt<typeof fixedProxy, 3>>,
  string | HsonNode | undefined
>>;
// @ts-expect-error An explicit rooted proxy path keeps direct-path hardening.
fixed.proxy([3]);

const empty = fragmentMap.schema.use(d.fragment(d.sequence())).proxy();
type _EmptyOutOfRangeProxy = Expect<Equal<
  ProxySnap<ProxyAt<typeof empty, 0>>,
  undefined
>>;

// @ts-expect-error A schema-proven text proxy has no logical descendants.
fixedProxy[0][0];

const nested = elementMap.schema.use(d.element({
  content: d.sequence(d.element({
    content: d.sequence(d.text, d.element()),
  })),
}));
const nestedProxy = nested.proxy();
const nestedRelativeText = nested.at([0]).at([0]);
type _NestedElement = Expect<Equal<ProxySnap<ProxyAt<typeof nestedProxy, 0>>, HsonNode>>;
type _NestedText = Expect<Equal<ProxySnap<ProxyAt2<typeof nestedProxy, 0, 0>>, string>>;
type _NestedStructured = Expect<Equal<ProxySnap<ProxyAt2<typeof nestedProxy, 0, 1>>, HsonNode>>;
// @ts-expect-error A known text coordinate has no physical carrier traversal.
nestedProxy[0][0][0];

type _DirectRelativeProxyEndpoint = Expect<Equal<
  Snap<ReturnType<typeof nested.at<[0, 0]>>>,
  Snap<typeof nestedRelativeText>
>>;
type _RelativeProxyEndpoint = Expect<Equal<
  Snap<typeof nestedRelativeText>,
  ProxySnap<ProxyAt2<typeof nestedProxy, 0, 0>>
>>;
type _DirectProxyReplacement = Expect<Equal<
  Replacement<ReturnType<typeof nested.at<[0, 0]>>>,
  Replacement<ProxyLocation<ProxyAt2<typeof nestedProxy, 0, 0>>>
>>;

const repeatedText = fragmentMap.schema.use(d.fragment(d.repeat(d.text)));
const repeatedTextProxy = repeatedText.proxy();
type _RepeatedText = Expect<Equal<
  ProxySnap<ProxyAt<typeof repeatedTextProxy, number>>,
  string | undefined
>>;
// @ts-expect-error Repeated text has no structured descendant branch.
repeatedTextProxy[index][0];

const repeatedElement = fragmentMap.schema.use(d.fragment(d.repeat(d.element({
  content: d.sequence(d.text),
}))));
const repeatedElementProxy = repeatedElement.proxy();
type _RepeatedElement = Expect<Equal<
  ProxySnap<ProxyAt<typeof repeatedElementProxy, number>>,
  HsonNode | undefined
>>;
type _RepeatedMissingAncestor = Expect<Equal<
  ProxySnap<ProxyAt2<typeof repeatedElementProxy, number, 0>>,
  string | undefined
>>;
type _RepeatedDirectRelativeProxy = Expect<Equal<
  Snap<ReturnType<typeof repeatedElement.at<[number, 0]>>>,
  ProxySnap<ProxyAt2<typeof repeatedElementProxy, number, 0>>
>>;
repeatedElementProxy[index][0].$_.replace("present");
// @ts-expect-error Ancestor absence affects reads, not replacement inputs.
repeatedElementProxy[index][0].$_.replace(undefined);

const repeatedUnion = fragmentMap.schema.use(d.fragment(d.repeat(d.pick(
  d.text,
  d.element({ content: d.sequence(d.text) }),
))));
const repeatedUnionProxy = repeatedUnion.proxy();
type _RepeatedUnion = Expect<Equal<
  ProxySnap<ProxyAt<typeof repeatedUnionProxy, number>>,
  string | HsonNode | undefined
>>;
type _RepeatedUnionStructuredDescent = Expect<Equal<
  ProxySnap<ProxyAt2<typeof repeatedUnionProxy, number, 0>>,
  string | undefined
>>;

const layouts = fragmentMap.schema.use(d.fragment(d.pick(
  d.sequence(d.text, d.text),
  d.sequence(d.text, d.element(), d.text),
)));
const layoutProxy = layouts.proxy();
type _Layout0 = Expect<Equal<ProxySnap<ProxyAt<typeof layoutProxy, 0>>, string>>;
type _Layout1 = Expect<Equal<ProxySnap<ProxyAt<typeof layoutProxy, 1>>, string | HsonNode>>;
type _Layout2 = Expect<Equal<ProxySnap<ProxyAt<typeof layoutProxy, 2>>, string | undefined>>;
type _LayoutDynamic = Expect<Equal<
  ProxySnap<ProxyAt<typeof layoutProxy, number>>,
  string | HsonNode | undefined
>>;

const broad = elementMap.schema.use(d.element({
  content: d.sequence(d.text, d.element()),
}));
const broadProxy = broad.proxy();
type _BroadElement = Expect<Equal<ProxySnap<ProxyAt<typeof broadProxy, 1>>, HsonNode>>;
type _BroadChild = Expect<Equal<
  ProxySnap<ProxyAt2<typeof broadProxy, 1, 0>>,
  string | HsonNode | undefined
>>;
type _BroadGrandchild = Expect<Equal<
  ProxySnap<ProxyAt3<typeof broadProxy, 1, 0, 0>>,
  string | HsonNode | undefined
>>;
type _BroadSiblingRemainsText = Expect<Equal<ProxySnap<ProxyAt<typeof broadProxy, 0>>, string>>;

const fullyBroadProxy = elementMap.schema.use(d.element()).proxy();
type _FullyBroadSchemaAwareProxy = Expect<Equal<
  ProxySnap<ProxyAt<typeof fullyBroadProxy, number>>,
  string | HsonNode | undefined
>>;

const rootedProxy = nested.proxy([0]);
type _RootedProxyLocation = Expect<Equal<
  Snap<typeof rootedProxy.$_>,
  Snap<ReturnType<typeof nested.at<[0]>>>
>>;
type _RootedProxyChild = Expect<Equal<
  ProxySnap<ProxyAt<typeof rootedProxy, 0>>,
  Snap<ReturnType<typeof nested.at<[0, 0]>>>
>>;
const relativeFromProxy = nestedProxy[0].$_.at([1]);
type _RelativeFromProxy = Expect<Equal<Snap<typeof relativeFromProxy>, HsonNode>>;

type _ProxyWatch = Expect<Equal<
  Watch<ProxyLocation<ProxyAt2<typeof nestedProxy, 0, 0>>>,
  string
>>;
nestedProxy[0][0].$_.watch((next) => {
  const exact: string = next;
  void exact;
});
tree.bind.text(nestedProxy[0][0].$_);
// @ts-expect-error A possibly structured proxy endpoint requires a formatter.
tree.bind.text(layoutProxy[1].$_);
tree.bind.text(layoutProxy[1].$_, (value) => typeof value === "string" ? value : "element");

const repeatedTextOwner = elementMap.schema.use(d.element({
  content: d.repeat(d.text),
}));
const repeatedTextOwnerProxy = repeatedTextOwner.proxy();
type _ProxyInsert = Expect<Equal<
  Parameters<typeof repeatedTextOwnerProxy.$_.insert>[1],
  string
>>;
repeatedTextOwner.proxy().$_.insert(0, "item");
// @ts-expect-error Repeated-text content ownership rejects structured insertion.
repeatedTextOwner.proxy().$_.insert(0, node);
// @ts-expect-error Missing reachability is never an insertion value.
repeatedTextOwner.proxy().$_.insert(0, undefined);

type _RootReplacementUnchanged = Expect<Equal<
  Replacement<typeof nestedProxy.$_>,
  LiveMapDocumentContent
>>;
nestedProxy[0].$_.attrs.set("title", "broad attrs stay broad");

const discovered = nestedProxy.$_.id("known");
if (discovered !== undefined) {
  type _IdDiscoveryRemainsBroad = Expect<Equal<
    Snap<typeof discovered>,
    HsonNode | Primitive | undefined
  >>;
}

const legacyProxy = elementMap.proxy();
type _LegacyProxy = Expect<Equal<
  ProxySnap<ProxyAt<typeof legacyProxy, number>>,
  HsonNode | Primitive | undefined
>>;
legacyProxy[index].$_.replace(1);

export {};
