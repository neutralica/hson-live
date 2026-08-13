import { hson } from "../src/index.js";
import type { LiveTree } from "../src/api/livetree/livetree.js";
import type { HsonNode } from "../src/core/types.js";
import type {
  InternalDocumentSchemaEvidence,
} from "../src/api/livemap/livemap.document.schema.js";
import type { ElementLiveMap, FragmentLiveMap } from "../src/types/livemap.types.js";

type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends
  (<T>() => T extends TRight ? 1 : 2)
    ? true
    : false;
type Expect<TValue extends true> = TValue;
type Watch<TLocation extends Readonly<{ watch: (listener: never) => unknown }>> =
  Parameters<Parameters<TLocation["watch"]>[0]>[0];

const Text = hson.liveMap.schema.define((s) => s.string);
type _TextEvidence = Expect<Equal<
  InternalDocumentSchemaEvidence<typeof Text>,
  Readonly<{ kind: "text" }>
>>;

const broadElement = hson.liveMap.schema.define((s) => s.tag());
type _BroadElementEvidence = Expect<Equal<
  InternalDocumentSchemaEvidence<typeof broadElement>,
  Readonly<{ kind: "element"; tag: undefined; content: "broad" }>
>>;

const taggedElement = hson.liveMap.schema.define((s) => s.button());
type _TaggedElementEvidence = Expect<Equal<
  InternalDocumentSchemaEvidence<typeof taggedElement>,
  Readonly<{ kind: "element"; tag: "button"; content: "broad" }>
>>;

const oneTextElement = hson.liveMap.schema.define((s) => s.tag(s.string));
type OneTextEvidence = InternalDocumentSchemaEvidence<typeof oneTextElement>;
type _OneTextKind = Expect<Equal<OneTextEvidence["kind"], "element">>;
type _OneTextTag = Expect<Equal<OneTextEvidence["tag"], undefined>>;
type _OneTextContent = Expect<Equal<OneTextEvidence["content"]["kind"], "sequence">>;
type _OneTextChild = Expect<Equal<OneTextEvidence["content"]["items"][0]["kind"], "text">>;

const customDot = hson.liveMap.schema.define((s) => s.tag.foo(s.span(s.string)));
const customBracket = hson.liveMap.schema.define((s) => s.tag["my-widget"](s.span(s.string)));
declare const dynamicTagName: string;
const customDynamic = hson.liveMap.schema.define((s) => s.tag[dynamicTagName](s.span(s.string)));
const knownEquivalent = hson.liveMap.schema.define((s) => s.div(s.span(s.string)));
type CustomDotEvidence = InternalDocumentSchemaEvidence<typeof customDot>;
type CustomBracketEvidence = InternalDocumentSchemaEvidence<typeof customBracket>;
type CustomDynamicEvidence = InternalDocumentSchemaEvidence<typeof customDynamic>;
type KnownEquivalentEvidence = InternalDocumentSchemaEvidence<typeof knownEquivalent>;
type _CustomDotTag = Expect<Equal<CustomDotEvidence["tag"], string>>;
type _CustomBracketTag = Expect<Equal<CustomBracketEvidence["tag"], string>>;
type _CustomDynamicTag = Expect<Equal<CustomDynamicEvidence["tag"], string>>;
type _KnownEquivalentTag = Expect<Equal<KnownEquivalentEvidence["tag"], "div">>;
type _CustomDotContent = Expect<Equal<CustomDotEvidence["content"], KnownEquivalentEvidence["content"]>>;
type _CustomBracketContent = Expect<Equal<CustomBracketEvidence["content"], KnownEquivalentEvidence["content"]>>;
type _CustomDynamicContent = Expect<Equal<CustomDynamicEvidence["content"], KnownEquivalentEvidence["content"]>>;

const customThen = hson.liveMap.schema.define((s) => s.tag.then(s.string));
const customToJson = hson.liveMap.schema.define((s) => s.tag.toJSON(s.string));
type _ThenStaticTag = Expect<Equal<InternalDocumentSchemaEvidence<typeof customThen>["tag"], string>>;
type _ToJsonStaticTag = Expect<Equal<InternalDocumentSchemaEvidence<typeof customToJson>["tag"], string>>;

hson.liveMap.schema.define((s) => {
  const resolvedTag: Promise<typeof s.tag> = Promise.resolve(s.tag);
  const awaitTag = async () => {
    const awaitedTag: typeof s.tag = await s.tag;
    return awaitedTag;
  };
  void resolvedTag;
  void awaitTag;
  return s.string;
});

const reusableCustom = hson.liveMap.schema.define((s) => s.tag.label(s.string));
const nestedReusableCustom = hson.liveMap.schema.define((s) => s.section(reusableCustom));
const pickedCustom = hson.liveMap.schema.define((s) => s.div(s.pick(s.string, reusableCustom)));
const tupledCustom = hson.liveMap.schema.define((s) => s.tuple(reusableCustom, s.string));
const repeatedCustom = hson.liveMap.schema.define((s) => s.repeat(reusableCustom));
void nestedReusableCustom;
void pickedCustom;
void tupledCustom;
void repeatedCustom;

const fixed = hson.liveMap.schema.define((s) => s.tuple(s.string, s.tag(), s.string));
type _FixedEvidence = Expect<Equal<
  InternalDocumentSchemaEvidence<typeof fixed>["kind"],
  "fragment"
>>;

const repeated = hson.liveMap.schema.define((s) => s.repeat(s.string));
type _RepeatEvidence = Expect<Equal<
  InternalDocumentSchemaEvidence<typeof repeated>,
  Readonly<{
    kind: "fragment";
    content: Readonly<{ kind: "repeat"; item: Readonly<{ kind: "text" }> }>;
  }>
>>;

const emptyAtom = hson.liveMap.schema.define((s) => s.empty);
type _EmptyAtomEvidence = Expect<Equal<
  InternalDocumentSchemaEvidence<typeof emptyAtom>,
  Readonly<{
    kind: "fragment";
    content: Readonly<{ kind: "sequence"; items: readonly [] }>;
  }>
>>;

const counted = hson.liveMap.schema.define((s) => s.repeat(3, s.string));
type _CountedEvidence = Expect<Equal<
  InternalDocumentSchemaEvidence<typeof counted>,
  Readonly<{
    kind: "fragment";
    content: Readonly<{ kind: "counted-repeat"; count: 3; item: Readonly<{ kind: "text" }> }>;
  }>
>>;

const zeroCounted = hson.liveMap.schema.define((s) => s.repeat(0, s.string));
type _ZeroCountedEvidence = Expect<Equal<
  InternalDocumentSchemaEvidence<typeof zeroCounted>,
  InternalDocumentSchemaEvidence<typeof emptyAtom>
>>;

const itemPick = hson.liveMap.schema.define((s) => s.pick(s.string, s.tag()));
type _ItemPickEvidence = Expect<Equal<
  InternalDocumentSchemaEvidence<typeof itemPick>["kind"],
  "pick"
>>;

const layoutPick = hson.liveMap.schema.define((s) => s.pick(
  s.tuple(s.string, s.string),
  s.tuple(s.string, s.tag(), s.string),
));
type _LayoutPickEvidence = Expect<Equal<
  InternalDocumentSchemaEvidence<typeof layoutPick>["kind"],
  "fragment"
>>;

declare const elementMap: ElementLiveMap;
declare const fragmentMap: FragmentLiveMap;
declare const tree: LiveTree;
declare const node: HsonNode;

const evidenceElementMap = elementMap.schema.use(oneTextElement);
const evidenceFragmentMap = fragmentMap.schema.use(repeated);
const sameElementRuntimeShape: ElementLiveMap = evidenceElementMap;
const sameFragmentRuntimeShape: FragmentLiveMap = evidenceFragmentMap;
void sameElementRuntimeShape;
void sameFragmentRuntimeShape;

const knownEquivalentMap = elementMap.schema.use(knownEquivalent);
const customEquivalentMap = elementMap.schema.use(customDot);
const knownRoot = knownEquivalentMap.at([]);
const customRoot = customEquivalentMap.at([]);
const knownNode = knownEquivalentMap.at([0]);
const customNode = customEquivalentMap.at([0]);
const knownText = knownEquivalentMap.at([0, 0]);
const customText = customEquivalentMap.at([0, 0]);
const knownRelativeText = knownRoot.at([0]).at([0]);
const customRelativeText = customRoot.at([0]).at([0]);
const knownProxyText = knownEquivalentMap.proxy()[0][0].$_;
const customProxyText = customEquivalentMap.proxy()[0][0].$_;
type _RootPathParity = Expect<Equal<ReturnType<typeof knownRoot.snap>, ReturnType<typeof customRoot.snap>>>;
type _NodePathParity = Expect<Equal<ReturnType<typeof knownNode.snap>, ReturnType<typeof customNode.snap>>>;
type _DirectPathParity = Expect<Equal<ReturnType<typeof knownText.snap>, ReturnType<typeof customText.snap>>>;
type _RelativePathParity = Expect<Equal<ReturnType<typeof knownRelativeText.snap>, ReturnType<typeof customRelativeText.snap>>>;
type _ProxyPathParity = Expect<Equal<ReturnType<typeof knownProxyText.snap>, ReturnType<typeof customProxyText.snap>>>;
type _WatchParity = Expect<Equal<Watch<typeof knownText>, Watch<typeof customText>>>;
type _ReplaceParity = Expect<Equal<Parameters<typeof knownText.replace>[0], Parameters<typeof customText.replace>[0]>>;
type _InsertParity = Expect<Equal<Parameters<typeof knownNode.insert>[1], Parameters<typeof customNode.insert>[1]>>;
const exactCustomText: string = customText.snap();
customText.watch((next) => { const exact: string = next; void exact; });
customText.replace("updated");
customNode.insert(0, "updated");
tree.bind.text(customText);
tree.bind.text(customRelativeText);
tree.bind.text(customProxyText);
// @ts-expect-error Custom-tag child evidence still rejects structured replacement at a text endpoint.
customText.replace(node);
// @ts-expect-error Custom-tag child evidence still rejects structured insertion in a text-only owner.
customNode.insert(0, node);
void exactCustomText;

// @ts-expect-error Layout roots cannot attach to element maps.
elementMap.schema.use(repeated);
// @ts-expect-error Element roots cannot attach to fragment maps.
fragmentMap.schema.use(oneTextElement);
// @ts-expect-error Document items alone are not document roots.
fragmentMap.schema.use(Text);

// @ts-expect-error Layout schemas cannot appear as tuple items.
hson.liveMap.schema.define((s) => {
  // @ts-expect-error Layout schemas cannot appear as tuple items.
  return s.tuple(s.repeat(s.string));
});
hson.liveMap.schema.define((s) => {
  // @ts-expect-error Projected object schemas cannot contain document elements.
  return s.object.exact({ child: s.div() });
});
hson.liveMap.schema.define((s) => {
  // @ts-expect-error Document elements cannot contain projected-only numbers.
  return s.div(s.number);
});
hson.liveMap.schema.define((s) => {
  // @ts-expect-error Projected arrays cannot contain document-only elements.
  return s.array(s.button());
});
hson.liveMap.schema.define((s) => {
  // @ts-expect-error Exact custom tags use property access; strings are document children, not tag-name parameters.
  return s.tag("legacy-widget");
});
hson.liveMap.schema.define((s) => {
  // @ts-expect-error No redundant element operator is exposed.
  return s.element();
});

export {};
