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
type Replacement<TLocation extends Readonly<{ replace: (value: never) => unknown }>> = Parameters<TLocation["replace"]>[0];
type ProxyAt<TProxy, TIndex extends number> = TIndex extends keyof TProxy ? TProxy[TIndex] : never;
type ProxyAt2<TProxy, TFirst extends number, TSecond extends number> = ProxyAt<ProxyAt<TProxy, TFirst>, TSecond>;
type ProxyLocation<TProxy> = TProxy extends Readonly<{ $_: infer TLocation extends Readonly<{ snap: () => unknown }> }> ? TLocation : never;
type ProxySnap<TProxy> = Snap<ProxyLocation<TProxy>>;

declare const elementMap: ElementLiveMap;
declare const fragmentMap: FragmentLiveMap;
declare const tree: LiveTree;
declare const node: HsonNode;
declare const index: number;

const FixedSchema = hson.liveMap.schema.define((s) => s.tag(s.string, s.tag(), s.string));
const fixed = elementMap.schema.use(FixedSchema);
const fixedProxy = fixed.proxy();
type _RootProxy = Expect<Equal<Snap<typeof fixedProxy.$_>, HsonNode>>;
type _FixedText0 = Expect<Equal<ProxySnap<ProxyAt<typeof fixedProxy, 0>>, string>>;
type _FixedElement1 = Expect<Equal<ProxySnap<ProxyAt<typeof fixedProxy, 1>>, HsonNode>>;
type _FixedText2 = Expect<Equal<ProxySnap<ProxyAt<typeof fixedProxy, 2>>, string>>;
type _FixedDynamic = Expect<Equal<ProxySnap<ProxyAt<typeof fixedProxy, number>>, string | HsonNode | undefined>>;
fixedProxy[0].$_.replace("Save"); fixedProxy[1].$_.replace(node);
// @ts-expect-error Schema-proven text rejects structured replacement.
fixedProxy[0].$_.replace(node);
// @ts-expect-error Schema-proven element rejects text replacement.
fixedProxy[1].$_.replace("not an element");
type _OutOfRangeProxy = Expect<Equal<ProxySnap<ProxyAt<typeof fixedProxy, 3>>, string | HsonNode | undefined>>;
// @ts-expect-error Rooted direct proxy paths keep exact impossible-path rejection.
fixed.proxy([3]);

const EmptySchema = hson.liveMap.schema.define((s) => s.tuple());
const empty = fragmentMap.schema.use(EmptySchema).proxy();
type _EmptyOutOfRange = Expect<Equal<ProxySnap<ProxyAt<typeof empty, 0>>, undefined>>;
// @ts-expect-error Schema-proven text proxy has no children.
fixedProxy[0][0];

const NestedSchema = hson.liveMap.schema.define((s) => s.tag(s.tag(s.string, s.tag())));
const nested = elementMap.schema.use(NestedSchema);
const nestedProxy = nested.proxy();
type _NestedElement = Expect<Equal<ProxySnap<ProxyAt<typeof nestedProxy, 0>>, HsonNode>>;
type _NestedText = Expect<Equal<ProxySnap<ProxyAt2<typeof nestedProxy, 0, 0>>, string>>;
type _NestedStructured = Expect<Equal<ProxySnap<ProxyAt2<typeof nestedProxy, 0, 1>>, HsonNode>>;
// @ts-expect-error Known text coordinates have no carrier traversal.
nestedProxy[0][0][0];
type _RelativeParity = Expect<Equal<Snap<ReturnType<typeof nested.at<[0, 0]>>>, ProxySnap<ProxyAt2<typeof nestedProxy, 0, 0>>>>;
type _ReplacementParity = Expect<Equal<Replacement<ReturnType<typeof nested.at<[0, 0]>>>, Replacement<ProxyLocation<ProxyAt2<typeof nestedProxy, 0, 0>>>>>;

const RepeatTextSchema = hson.liveMap.schema.define((s) => s.repeat(s.string));
const repeatedText = fragmentMap.schema.use(RepeatTextSchema);
const repeatedTextProxy = repeatedText.proxy();
type _RepeatedText = Expect<Equal<ProxySnap<ProxyAt<typeof repeatedTextProxy, number>>, string | undefined>>;
// @ts-expect-error Repeated text has no structured descendant.
repeatedTextProxy[index][0];

const RepeatElementSchema = hson.liveMap.schema.define((s) => s.repeat(s.tag(s.string)));
const repeatedElement = fragmentMap.schema.use(RepeatElementSchema);
const repeatedElementProxy = repeatedElement.proxy();
type _RepeatedElement = Expect<Equal<ProxySnap<ProxyAt<typeof repeatedElementProxy, number>>, HsonNode | undefined>>;
type _RepeatedChild = Expect<Equal<ProxySnap<ProxyAt2<typeof repeatedElementProxy, number, 0>>, string | undefined>>;
repeatedElementProxy[index][0].$_.replace("present");
// @ts-expect-error Ancestor absence affects reads, not writes.
repeatedElementProxy[index][0].$_.replace(undefined);

const RepeatUnionSchema = hson.liveMap.schema.define((s) => s.repeat(s.pick(s.string, s.tag(s.string))));
const repeatedUnionProxy = fragmentMap.schema.use(RepeatUnionSchema).proxy();
type _RepeatedUnion = Expect<Equal<ProxySnap<ProxyAt<typeof repeatedUnionProxy, number>>, string | HsonNode | undefined>>;
type _RepeatedUnionDescent = Expect<Equal<ProxySnap<ProxyAt2<typeof repeatedUnionProxy, number, 0>>, string | undefined>>;

const LayoutSchema = hson.liveMap.schema.define((s) => s.pick(
  s.tuple(s.string, s.string),
  s.tuple(s.string, s.tag(), s.string),
));
const layoutProxy = fragmentMap.schema.use(LayoutSchema).proxy();
type _Layout0 = Expect<Equal<ProxySnap<ProxyAt<typeof layoutProxy, 0>>, string>>;
type _Layout1 = Expect<Equal<ProxySnap<ProxyAt<typeof layoutProxy, 1>>, string | HsonNode>>;
type _Layout2 = Expect<Equal<ProxySnap<ProxyAt<typeof layoutProxy, 2>>, string | undefined>>;

const BroadChildSchema = hson.liveMap.schema.define((s) => s.tag(s.string, s.tag()));
const broadProxy = elementMap.schema.use(BroadChildSchema).proxy();
type _BroadChild = Expect<Equal<ProxySnap<ProxyAt2<typeof broadProxy, 1, 0>>, string | HsonNode | undefined>>;
type _BroadSiblingText = Expect<Equal<ProxySnap<ProxyAt<typeof broadProxy, 0>>, string>>;

const AnyElementSchema = hson.liveMap.schema.define((s) => s.tag());
const fullyBroadProxy = elementMap.schema.use(AnyElementSchema).proxy();
type _FullyBroad = Expect<Equal<ProxySnap<ProxyAt<typeof fullyBroadProxy, number>>, string | HsonNode | undefined>>;

const rootedProxy = nested.proxy([0]);
type _RootedProxy = Expect<Equal<Snap<typeof rootedProxy.$_>, Snap<ReturnType<typeof nested.at<[0]>>>>>;
type _RootedChild = Expect<Equal<ProxySnap<ProxyAt<typeof rootedProxy, 0>>, Snap<ReturnType<typeof nested.at<[0, 0]>>>>>;

type _ProxyWatch = Expect<Equal<Watch<ProxyLocation<ProxyAt2<typeof nestedProxy, 0, 0>>>, string>>;
nestedProxy[0][0].$_.watch((next) => { const exact: string = next; void exact; });
tree.bind.text(nestedProxy[0][0].$_);
// @ts-expect-error Possibly structured endpoints require a formatter.
tree.bind.text(layoutProxy[1].$_);
tree.bind.text(layoutProxy[1].$_, (value) => typeof value === "string" ? value : "element");

const RepeatTextOwnerSchema = hson.liveMap.schema.define((s) => s.tag(s.repeat(s.string)));
const repeatedTextOwnerProxy = elementMap.schema.use(RepeatTextOwnerSchema).proxy();
type _ProxyInsert = Expect<Equal<Parameters<typeof repeatedTextOwnerProxy.$_.insert>[1], string>>;
repeatedTextOwnerProxy.$_.insert(0, "item");
// @ts-expect-error Repeated text rejects structured insertion.
repeatedTextOwnerProxy.$_.insert(0, node);

type _RootReplacement = Expect<Equal<Replacement<typeof nestedProxy.$_>, LiveMapDocumentContent>>;
const legacyProxy = elementMap.proxy();
type _LegacyProxy = Expect<Equal<ProxySnap<ProxyAt<typeof legacyProxy, number>>, HsonNode | Primitive | undefined>>;
legacyProxy[index].$_.replace(1);

export {};
