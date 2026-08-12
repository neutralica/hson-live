import { hson } from "../src/index.js";
import type { HsonNode } from "../src/core/types.js";
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

const d = hson.liveMap.schema.document;

declare const elementMap: ElementLiveMap;
declare const fragmentMap: FragmentLiveMap;
declare const node: HsonNode;

const legacyLocation = elementMap.at([0]);
type _LegacyReplace = Expect<Equal<
  Parameters<typeof legacyLocation.replace>[0],
  LiveMapDocumentContent
>>;
legacyLocation.replace("text");
legacyLocation.replace(node);
legacyLocation.replace(1);
legacyLocation.replace(true);
legacyLocation.replace(null);

const textMap = elementMap.schema.use(d.element({
  content: d.sequence(d.text),
}));
const textLocation = textMap.at([0]);
type _TextReplace = Expect<Equal<Parameters<typeof textLocation.replace>[0], string>>;
textLocation.replace("Save");
// @ts-expect-error Schema-proven text rejects structured HSON authoring.
textLocation.replace(node);
// @ts-expect-error Schema-proven text rejects number authoring.
textLocation.replace(1);
// @ts-expect-error Schema-proven text rejects boolean authoring.
textLocation.replace(true);
// @ts-expect-error Schema-proven text rejects null authoring.
textLocation.replace(null);
// @ts-expect-error Read absence never becomes a writable undefined value.
textLocation.replace(undefined);

const elementItemMap = elementMap.schema.use(d.element({
  content: d.sequence(d.element({ tag: "button" })),
}));
const elementLocation = elementItemMap.at([0]);
type _ElementReplace = Expect<Equal<Parameters<typeof elementLocation.replace>[0], HsonNode>>;
elementLocation.replace(node);
// @ts-expect-error Schema-proven element positions reject text authoring.
elementLocation.replace("button");

const itemUnionMap = fragmentMap.schema.use(d.fragment(
  d.repeat(d.pick(d.text, d.element())),
));
const itemUnionLocation = itemUnionMap.at([0]);
type _ItemUnionReplace = Expect<Equal<
  Parameters<typeof itemUnionLocation.replace>[0],
  string | HsonNode
>>;
itemUnionLocation.replace("text");
itemUnionLocation.replace(node);
// @ts-expect-error Item unions do not admit numeric document content.
itemUnionLocation.replace(1);

const repeatedTextMap = fragmentMap.schema.use(d.fragment(d.repeat(d.text)));
const optionalTextLocation = repeatedTextMap.at([123]);
type _RepeatedTextRead = Expect<Equal<ReturnType<typeof optionalTextLocation.snap>, string | undefined>>;
type _RepeatedTextReplace = Expect<Equal<Parameters<typeof optionalTextLocation.replace>[0], string>>;
optionalTextLocation.replace("present");
// @ts-expect-error Optional reads do not admit undefined writes.
optionalTextLocation.replace(undefined);

const layoutMap = fragmentMap.schema.use(d.fragment(d.pick(
  d.sequence(d.text, d.text),
  d.sequence(d.text, d.element(), d.text),
)));
const layoutUnionLocation = layoutMap.at([1]);
const layoutOptionalText = layoutMap.at([2]);
type _LayoutUnionRead = Expect<Equal<ReturnType<typeof layoutUnionLocation.snap>, string | HsonNode>>;
type _LayoutUnionReplace = Expect<Equal<
  Parameters<typeof layoutUnionLocation.replace>[0],
  string | HsonNode
>>;
type _LayoutOptionalRead = Expect<Equal<ReturnType<typeof layoutOptionalText.snap>, string | undefined>>;
type _LayoutOptionalReplace = Expect<Equal<Parameters<typeof layoutOptionalText.replace>[0], string>>;
layoutUnionLocation.replace("text");
layoutUnionLocation.replace(node);
layoutOptionalText.replace("later");
// @ts-expect-error A missing layout branch does not add undefined to replace.
layoutOptionalText.replace(undefined);

const broadDescendantMap = elementMap.schema.use(d.element({
  content: d.sequence(d.element()),
}));
const broadDescendant = broadDescendantMap.at([0, 0]);
type _BroadDescendantReplace = Expect<Equal<
  Parameters<typeof broadDescendant.replace>[0],
  string | HsonNode
>>;
broadDescendant.replace("text");
broadDescendant.replace(node);
// @ts-expect-error Schema-aware broad descendants exclude legacy numeric content.
broadDescendant.replace(1);

// Root replacement keeps its historical callable value surface; runtime still rejects item replacement at root.
const rootLocation = textMap.at([]);
type _RootReplaceUnchanged = Expect<Equal<
  Parameters<typeof rootLocation.replace>[0],
  LiveMapDocumentContent
>>;
rootLocation.replace("text");
rootLocation.replace(node);
rootLocation.replace(1);

// @ts-expect-error Phase 20B still rejects an impossible exact location before mutation typing.
textMap.at([1]).replace("impossible");

const repeatedTextOwner = repeatedTextMap.at([]);
type _RepeatedTextInsert = Expect<Equal<Parameters<typeof repeatedTextOwner.insert>[1], string>>;
repeatedTextOwner.insert(0, "item");
// @ts-expect-error Repeated text rejects structured insertion.
repeatedTextOwner.insert(0, node);
// @ts-expect-error Repeated text rejects numeric insertion.
repeatedTextOwner.insert(0, 1);
// @ts-expect-error Repeated text rejects boolean insertion.
repeatedTextOwner.insert(0, true);
// @ts-expect-error Repeated text rejects null insertion.
repeatedTextOwner.insert(0, null);
// @ts-expect-error Repeated text rejects undefined insertion.
repeatedTextOwner.insert(0, undefined);

const repeatedElementMap = fragmentMap.schema.use(d.fragment(d.repeat(d.element())));
const repeatedElementOwner = repeatedElementMap.at([]);
type _RepeatedElementInsert = Expect<Equal<Parameters<typeof repeatedElementOwner.insert>[1], HsonNode>>;
repeatedElementOwner.insert(0, node);
// @ts-expect-error Repeated element rejects text insertion.
repeatedElementOwner.insert(0, "text");

const repeatedUnionOwner = itemUnionMap.at([]);
type _RepeatedUnionInsert = Expect<Equal<
  Parameters<typeof repeatedUnionOwner.insert>[1],
  string | HsonNode
>>;
repeatedUnionOwner.insert(0, "text");
repeatedUnionOwner.insert(0, node);
// @ts-expect-error Repeated item unions exclude undefined.
repeatedUnionOwner.insert(0, undefined);

const broadOwnerMap = elementMap.schema.use(d.element());
const broadOwner = broadOwnerMap.at([]);
type _BroadOwnerInsert = Expect<Equal<
  Parameters<typeof broadOwner.insert>[1],
  string | HsonNode
>>;
broadOwner.insert(0, "text");
broadOwner.insert(0, node);
// @ts-expect-error Schema-aware broad content excludes legacy primitive kinds.
broadOwner.insert(0, false);

const layoutOwner = layoutMap.at([]);
type _LayoutOwnerInsert = Expect<Equal<
  Parameters<typeof layoutOwner.insert>[1],
  string | HsonNode
>>;
layoutOwner.insert(0, "text");
layoutOwner.insert(0, node);

const legacyOwner = fragmentMap.at([]);
type _LegacyInsert = Expect<Equal<Parameters<typeof legacyOwner.insert>[1], LiveMapDocumentContent>>;
legacyOwner.insert(0, "text");
legacyOwner.insert(0, node);
legacyOwner.insert(0, 1);
legacyOwner.insert(0, true);
legacyOwner.insert(0, null);

const fixedOwnerMap = elementMap.schema.use(d.element({
  content: d.sequence(d.text, d.element()),
}));
const fixedOwner = fixedOwnerMap.at([]);
type _FixedSequenceInsert = Expect<Equal<
  Parameters<typeof fixedOwner.insert>[1],
  string | HsonNode
>>;
// Value narrowing remains callable; complete fixed-length legality is runtime-authoritative.
fixedOwner.insert(0, "text");
fixedOwner.insert(0, node);
// @ts-expect-error Fixed schema-aware content excludes legacy numeric input.
fixedOwner.insert(0, 1);

const emptyOwnerMap = fragmentMap.schema.use(d.fragment(d.sequence()));
const emptyOwner = emptyOwnerMap.at([]);
type _EmptySequenceInsert = Expect<Equal<Parameters<typeof emptyOwner.insert>[1], never>>;
// @ts-expect-error Permanently empty content has no authorable item kind.
emptyOwner.insert(0, "text");
// @ts-expect-error Permanently empty content has no structured item kind either.
emptyOwner.insert(0, node);

// Relative locations intentionally retain historical mutation inputs until Phase 20D.
const relativeLocation = textMap.at([]).at([0]);
type _RelativeReplaceBroad = Expect<Equal<
  Parameters<typeof relativeLocation.replace>[0],
  LiveMapDocumentContent
>>;
type _RelativeInsertBroad = Expect<Equal<
  Parameters<typeof relativeLocation.insert>[1],
  LiveMapDocumentContent
>>;
relativeLocation.replace(1);
relativeLocation.insert(0, false);

export {};
