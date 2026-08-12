import { hson } from "../src/index.js";
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

const d = hson.liveMap.schema.document;

type TextEvidence = InternalDocumentSchemaEvidence<typeof d.text>;
type _TextEvidence = Expect<Equal<TextEvidence, Readonly<{ kind: "text" }>>>;

const broadElement = d.element();
type _BroadElementEvidence = Expect<Equal<
  InternalDocumentSchemaEvidence<typeof broadElement>,
  Readonly<{ kind: "element"; tag: undefined; content: "broad" }>
>>;

const taggedElement = d.element({ tag: "button" });
type _TaggedElementEvidence = Expect<Equal<
  InternalDocumentSchemaEvidence<typeof taggedElement>,
  Readonly<{ kind: "element"; tag: "button"; content: "broad" }>
>>;

const oneTextElement = d.element({ content: d.sequence(d.text) });
type _OneTextElementEvidence = Expect<Equal<
  InternalDocumentSchemaEvidence<typeof oneTextElement>,
  Readonly<{
    kind: "element";
    tag: undefined;
    content: Readonly<{
      kind: "sequence";
      items: readonly [Readonly<{ kind: "text" }>];
    }>;
  }>
>>;

const fixed = d.sequence(d.text, d.element(), d.text);
type _FixedEvidence = Expect<Equal<
  InternalDocumentSchemaEvidence<typeof fixed>["kind"],
  "sequence"
>>;

const repeated = d.repeat(d.text);
type _RepeatEvidence = Expect<Equal<
  InternalDocumentSchemaEvidence<typeof repeated>,
  Readonly<{ kind: "repeat"; item: Readonly<{ kind: "text" }> }>
>>;

const itemPick = d.pick(d.text, d.element());
type _ItemPickEvidence = Expect<Equal<
  InternalDocumentSchemaEvidence<typeof itemPick>["kind"],
  "pick"
>>;

const layoutPick = d.pick(
  d.sequence(d.text, d.text),
  d.sequence(d.text, d.element(), d.text),
);
type _LayoutPickEvidence = Expect<Equal<
  InternalDocumentSchemaEvidence<typeof layoutPick>["kind"],
  "pick"
>>;

const fragmentSchema = d.fragment(d.repeat(d.text));
type _FragmentEvidence = Expect<Equal<
  InternalDocumentSchemaEvidence<typeof fragmentSchema>["kind"],
  "fragment"
>>;

declare const elementMap: ElementLiveMap;
declare const fragmentMap: FragmentLiveMap;

const evidenceElementMap = elementMap.schema.use(oneTextElement);
const evidenceFragmentMap = fragmentMap.schema.use(fragmentSchema);
const sameElementRuntimeShape: ElementLiveMap = evidenceElementMap;
const sameFragmentRuntimeShape: FragmentLiveMap = evidenceFragmentMap;
void sameElementRuntimeShape;
void sameFragmentRuntimeShape;

// @ts-expect-error Fragment root schemas cannot attach to element maps.
elementMap.schema.use(fragmentSchema);
// @ts-expect-error Element root schemas cannot attach to fragment maps.
fragmentMap.schema.use(oneTextElement);
// @ts-expect-error Content schemas cannot attach as document roots.
elementMap.schema.use(d.sequence(d.text));
// @ts-expect-error Content schemas cannot appear as sequence items.
d.sequence(d.repeat(d.text));
// @ts-expect-error Item and content picks cannot cross categories.
d.pick(d.text, d.sequence(d.text));
// @ts-expect-error Fragment schemas cannot appear as content items.
d.sequence(fragmentSchema);

export {};
