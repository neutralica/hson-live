import { hson } from "../src/index.js";
import type { HsonNode } from "../src/core/types.js";
import type { ElementLiveMap, FragmentLiveMap, LiveMapDocumentContent } from "../src/types/livemap.types.js";

type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends
  (<T>() => T extends TRight ? 1 : 2) ? true : false;
type Expect<TValue extends true> = TValue;

declare const elementMap: ElementLiveMap;
declare const fragmentMap: FragmentLiveMap;
declare const node: HsonNode;

const legacyLocation = elementMap.at([0]);
type _LegacyReplace = Expect<Equal<Parameters<typeof legacyLocation.replace>[0], LiveMapDocumentContent>>;
legacyLocation.replace("text"); legacyLocation.replace(node); legacyLocation.replace(1);

const TextSchema = hson.liveMap.schema.define((s) => s.tag(s.string));
const textMap = elementMap.schema.use(TextSchema);
const textLocation = textMap.at([0]);
type _TextReplace = Expect<Equal<Parameters<typeof textLocation.replace>[0], string>>;
textLocation.replace("Save");
// @ts-expect-error Schema-proven text rejects HSON nodes.
textLocation.replace(node);
// @ts-expect-error Schema-proven text rejects numbers.
textLocation.replace(1);
// @ts-expect-error Read absence never becomes writable undefined.
textLocation.replace(undefined);

const ElementItemSchema = hson.liveMap.schema.define((s) => s.tag(s.button()));
const elementLocation = elementMap.schema.use(ElementItemSchema).at([0]);
type _ElementReplace = Expect<Equal<Parameters<typeof elementLocation.replace>[0], HsonNode>>;
elementLocation.replace(node);
// @ts-expect-error Element positions reject text authoring.
elementLocation.replace("button");

const ItemUnionSchema = hson.liveMap.schema.define((s) => s.repeat(s.pick(s.string, s.tag())));
const itemUnionMap = fragmentMap.schema.use(ItemUnionSchema);
const itemUnionLocation = itemUnionMap.at([0]);
type _ItemUnionReplace = Expect<Equal<Parameters<typeof itemUnionLocation.replace>[0], string | HsonNode>>;
itemUnionLocation.replace("text"); itemUnionLocation.replace(node);
// @ts-expect-error Document item unions reject numbers.
itemUnionLocation.replace(1);

const RepeatTextSchema = hson.liveMap.schema.define((s) => s.repeat(s.string));
const repeatedTextMap = fragmentMap.schema.use(RepeatTextSchema);
const optionalTextLocation = repeatedTextMap.at([123]);
type _RepeatedTextRead = Expect<Equal<ReturnType<typeof optionalTextLocation.snap>, string | undefined>>;
type _RepeatedTextReplace = Expect<Equal<Parameters<typeof optionalTextLocation.replace>[0], string>>;
// @ts-expect-error Optional reads do not admit undefined writes.
optionalTextLocation.replace(undefined);

const LayoutSchema = hson.liveMap.schema.define((s) => s.pick(
  s.tuple(s.string, s.string),
  s.tuple(s.string, s.tag(), s.string),
));
const layoutMap = fragmentMap.schema.use(LayoutSchema);
const layoutUnionLocation = layoutMap.at([1]);
const layoutOptionalText = layoutMap.at([2]);
type _LayoutUnionReplace = Expect<Equal<Parameters<typeof layoutUnionLocation.replace>[0], string | HsonNode>>;
type _LayoutOptionalRead = Expect<Equal<ReturnType<typeof layoutOptionalText.snap>, string | undefined>>;
type _LayoutOptionalReplace = Expect<Equal<Parameters<typeof layoutOptionalText.replace>[0], string>>;
layoutUnionLocation.replace("text"); layoutUnionLocation.replace(node); layoutOptionalText.replace("later");

const BroadDescendantSchema = hson.liveMap.schema.define((s) => s.tag(s.tag()));
const broadDescendant = elementMap.schema.use(BroadDescendantSchema).at([0, 0]);
type _BroadDescendantReplace = Expect<Equal<Parameters<typeof broadDescendant.replace>[0], string | HsonNode>>;
broadDescendant.replace("text"); broadDescendant.replace(node);
// @ts-expect-error Schema-aware broad descendants reject numbers.
broadDescendant.replace(1);

const rootLocation = textMap.at([]);
type _RootReplaceUnchanged = Expect<Equal<Parameters<typeof rootLocation.replace>[0], LiveMapDocumentContent>>;
// @ts-expect-error Impossible exact locations remain rejected.
textMap.at([1]).replace("impossible");

const repeatedTextOwner = repeatedTextMap.at([]);
type _RepeatedTextInsert = Expect<Equal<Parameters<typeof repeatedTextOwner.insert>[1], string>>;
repeatedTextOwner.insert(0, "item");
// @ts-expect-error Repeated text rejects structured insertion.
repeatedTextOwner.insert(0, node);

const RepeatElementSchema = hson.liveMap.schema.define((s) => s.repeat(s.tag()));
const repeatedElementOwner = fragmentMap.schema.use(RepeatElementSchema).at([]);
type _RepeatedElementInsert = Expect<Equal<Parameters<typeof repeatedElementOwner.insert>[1], HsonNode>>;
repeatedElementOwner.insert(0, node);
// @ts-expect-error Repeated element rejects strings.
repeatedElementOwner.insert(0, "text");

const repeatedUnionOwner = itemUnionMap.at([]);
type _RepeatedUnionInsert = Expect<Equal<Parameters<typeof repeatedUnionOwner.insert>[1], string | HsonNode>>;
repeatedUnionOwner.insert(0, "text"); repeatedUnionOwner.insert(0, node);

const AnyElementSchema = hson.liveMap.schema.define((s) => s.tag());
const broadOwner = elementMap.schema.use(AnyElementSchema).at([]);
type _BroadOwnerInsert = Expect<Equal<Parameters<typeof broadOwner.insert>[1], string | HsonNode>>;

const FixedOwnerSchema = hson.liveMap.schema.define((s) => s.tag(s.string, s.tag()));
const fixedOwner = elementMap.schema.use(FixedOwnerSchema).at([]);
type _FixedInsert = Expect<Equal<Parameters<typeof fixedOwner.insert>[1], string | HsonNode>>;
// @ts-expect-error Fixed schema-aware content excludes numbers.
fixedOwner.insert(0, 1);

const EmptySchema = hson.liveMap.schema.define((s) => s.tuple());
const emptyOwner = fragmentMap.schema.use(EmptySchema).at([]);
type _EmptyInsert = Expect<Equal<Parameters<typeof emptyOwner.insert>[1], never>>;
// @ts-expect-error Exact-empty content has no authorable items.
emptyOwner.insert(0, "text");

const relativeLocation = textMap.at([]).at([0]);
type _RelativeReplace = Expect<Equal<Parameters<typeof relativeLocation.replace>[0], string>>;
// @ts-expect-error Relative text rejects numeric replacement.
relativeLocation.replace(1);

const RelativeListSchema = hson.liveMap.schema.define((s) => s.tag(s.tag(s.repeat(s.string))));
const relativeListOwner = elementMap.schema.use(RelativeListSchema).at([]).at([0]);
type _RelativeInsert = Expect<Equal<Parameters<typeof relativeListOwner.insert>[1], string>>;
relativeListOwner.insert(0, "relative");
// @ts-expect-error Relative repeated-text owners reject HSON nodes.
relativeListOwner.insert(0, node);

export {};
