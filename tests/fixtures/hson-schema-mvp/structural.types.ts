import { Hson, hsonLiveMap, type HsonData, type JsonFromSchema, type LiveTree } from "hson-live";
import type { LiveMapWriteValue } from "hson-live/livemap";
import { SameShapeOneSchema, SameShapeTwoSchema, TreeSchema, UserSchema } from "./producer.js";

export const DeckSchema = Hson.schema`<type "data" defs <
  Block <union [
    <content <kind <exact "paragraph"> text "string">>,
    <content <kind <exact "heading"> text "string">>,
    <content <kind <exact "code"> language <optional <union [<exact "json">, <exact "html">, <exact "hson">]>> source "string">>
  ]>
  Slide <content <id "string" title <optional "string"> column1 <array <ref "Block">>>>
> content <slides <array <ref "Slide">>>>`;
export const MutualSchema = Hson.schema`<type "data" defs <
  A <content <kind <exact "a"> children <array <ref "B">>>>
  B <content <kind <exact "b"> children <array <ref "A">>>>
> content <ref "A">>`;

type Block =
  | { readonly kind: "paragraph"; readonly text: string }
  | { readonly kind: "heading"; readonly text: string }
  | { readonly kind: "code"; readonly language?: "json" | "html" | "hson"; readonly source: string };
type Slide = { readonly id: string; readonly title?: string; readonly column1: readonly Block[] };
type Deck = { readonly slides: readonly Slide[] };
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type Root = Assert<Equal<JsonFromSchema<typeof DeckSchema>, Deck>>;
export const example: JsonFromSchema<typeof DeckSchema> = { slides: [{ id: "one", column1: [{ kind: "code", language: "hson", source: "<p/>" }] }] };
const map = hsonLiveMap.fromLibraries({ slides: { data: { slides: [] }, schema: DeckSchema } });
const lib = map.lib("slides");
export const rootSnapshot = lib.snap();
export const slideSnapshot = lib.at(["slides", 0]).snap();
export const pathSnapshot = lib.snap(["slides", 0]);
export const chainedSnapshot = lib.at(["slides"]).at([0]).snap();
export const titleSnapshot = lib.at(["slides", 0, "title"]).snap();
type ReadRoot = Assert<Equal<typeof rootSnapshot, Deck>>;
type ReadSlide = Assert<Equal<typeof slideSnapshot, Slide | undefined>>;
type ReadPath = Assert<Equal<typeof pathSnapshot, typeof slideSnapshot>>;
type ReadChained = Assert<Equal<typeof chainedSnapshot, typeof slideSnapshot>>;
type ReadTitle = Assert<Equal<typeof titleSnapshot, string | undefined>>;
slideSnapshot?.id;
slideSnapshot?.column1[0]?.kind;
function narrow(block: Block) {
  if (block.kind === "code") {
    const source: string = block.source;
    // @ts-expect-error Discriminator excludes paragraph members.
    block.text;
    return source;
  }
  return block.text;
}
lib.at([]).watch(current => {
  const exact: Assert<Equal<typeof current, Deck>> = true;
  void exact;
});
lib.at(["slides", 0]).watch(current => {
  const exact: Assert<Equal<typeof current, Slide | undefined>> = true;
  void exact;
});
lib.at([]).update(current => {
  const exact: Assert<Equal<typeof current, Deck>> = true;
  void exact;
  return current;
});
lib.at(["slides"]).update(current => current);
lib.at([]).replace(rootSnapshot);
lib.at([]).set({ slides: rootSnapshot.slides });
lib.at(["slides"]).replace(rootSnapshot.slides);
lib.at(["slides", 0]).set({ title: "New" });
// @ts-expect-error Root replacement retains required members.
lib.at([]).replace({});
// @ts-expect-error Readonly collections must not widen the setter to generic JSON.
lib.at(["slides"]).replace([true]);
// @ts-expect-error Update outputs retain item structure.
lib.at(["slides"]).update(() => ["wrong"]);
// @ts-expect-error Update object patches retain member types.
lib.at([]).update(() => ({ slides: [true] }));
// @ts-expect-error Optional proposals accept absence, not explicit undefined.
lib.at(["slides", 0]).replace({ id: "one", column1: [], title: undefined });
// @ts-expect-error Exact literal unions reject outsiders.
lib.at(["slides", 0, "column1", 0, "language"]).set("ts");
// @ts-expect-error Read discipline applies to collections.
rootSnapshot.slides.push({ id: "two", column1: [] });
// @ts-expect-error Required fields remain required.
const missing: JsonFromSchema<typeof DeckSchema> = { slides: [{ column1: [] }] };
// @ts-expect-error JSON is not a Schema-bound Hson certificate.
const certificate: HsonData<typeof DeckSchema> = example;
// @ts-expect-error Strings do not certify themselves.
const stringCertificate: HsonData<typeof DeckSchema> = "<slides []>";

declare const tree: JsonFromSchema<typeof TreeSchema>;
const recursive: JsonFromSchema<typeof TreeSchema> = { value: "root", age: 1, children: [tree] };
const treeMap = hsonLiveMap.fromLibraries({ tree: { data: { value: "root", age: 1, children: [] }, schema: TreeSchema } });
export const recursiveSnapshot = treeMap.lib("tree").snap();
const deepAge: number | undefined = treeMap.lib("tree").at(["children", 0, "children", 0, "age"]).snap();
treeMap.lib("tree").at([]).replace(tree);
treeMap.lib("tree").at([]).update(current => current);
// @ts-expect-error Recursive candidates retain primitive precision.
treeMap.lib("tree").at(["children", 0, "age"]).set("bad");
const mutual: JsonFromSchema<typeof MutualSchema> = { kind: "a", children: [{ kind: "b", children: [] }] };
const mutualMap = hsonLiveMap.fromLibraries({ mutual: { data: { kind: "a", children: [] }, schema: MutualSchema } });
export const mutualSnapshot = mutualMap.lib("mutual").snap();
const mutualKind: "a" | undefined = mutualMap.lib("mutual").at(["children", 0, "children", 0, "kind"]).snap();
mutualMap.lib("mutual").at([]).replace(mutual);

declare const one: JsonFromSchema<typeof SameShapeOneSchema>;
const two: JsonFromSchema<typeof SameShapeTwoSchema> = one;
declare const userInput: HsonData<typeof UserSchema>;
const users = hsonLiveMap.fromLibraries({ user: { data: userInput, schema: UserSchema } });
const user = users.lib("user").snap();
users.lib("user").at(["pair"]).replace(user.pair);
users.lib("user").at(["flags"]).update(current => current);
// @ts-expect-error Readonly tuple forwarding must not broaden position types.
users.lib("user").at(["pair"]).replace([true, "bad"]);

const locus = hsonLiveMap.locus.create({ shared: [{ name: "slides", definition: { data: { slides: [] }, schema: DeckSchema } }], actions: {
  read(context) {
    const snapshot = context.lib("slides").snap();
    const root: Assert<Equal<typeof snapshot, Deck>> = true;
    const selected = context.lib("slides").at(["slides", 0]).snap();
    const exact: Assert<Equal<typeof selected, Slide | undefined>> = true;
    context.lib("slides").at(["slides"]).watch(value => {
      const watched: Assert<Equal<typeof value, readonly Slide[]>> = true;
      void watched;
    });
    void [root, exact];
  },
} });
const locusSlide = locus.lib("slides").at(["slides", 0]).snap();
type LocusRead = Assert<Equal<typeof locusSlide, Slide | undefined>>;
declare const treeView: LiveTree;
treeView.bind.path(lib.at(["slides", 0]), (_target, current, previous) => {
  const exact: Assert<Equal<typeof current, Slide | undefined>> = true;
  const before: Slide | undefined = previous;
  void [exact, before];
});
lib.at([]).getKey("slides");
const helper = lib.at([]).pick(["slides"]);
const helperSlides: readonly Slide[] = helper.slides;
void [narrow, recursive, deepAge, mutualKind, two, helperSlides];

// Authored names must not shadow syntax or built-ins used in generated types.
const ReservedRefsSchema = Hson.schema`<type "data" defs <
  Evidence <content <name "string">>
  ReadonlyArray <array "string">
  'string' "number"
  '$SchemaRef2' "boolean"
  'dash-name' <tuple []>
> content <a <ref "Evidence"> b <ref "ReadonlyArray"> c <ref "string"> d <ref "$SchemaRef2"> e <ref "dash-name">>>`;
const reservedRefs: JsonFromSchema<typeof ReservedRefsSchema> = { a: { name: "Ada" }, b: ["one"], c: 3, d: true, e: [] };
const reservedMap = hsonLiveMap.fromLibraries({ refs: { data: { a: { name: "Ada" }, b: [], c: 3, d: true, e: [] }, schema: ReservedRefsSchema } });
reservedMap.lib("refs").at(["e"]).replace(reservedRefs.e);
const mutableEmpty: [] = [];
const readonlyEmpty: readonly [] = [];
type EmptyProposal = Assert<Equal<LiveMapWriteValue<readonly []>, [] | readonly []>>;
type MutableEmptyProposal = Assert<Equal<LiveMapWriteValue<[]>, []>>;
const emptyProposal: LiveMapWriteValue<readonly []> = mutableEmpty;
const readonlyEmptyProposal: LiveMapWriteValue<readonly []> = readonlyEmpty;
reservedMap.lib("refs").at(["e"]).replace(mutableEmpty);
reservedMap.lib("refs").at(["e"]).replace(readonlyEmpty);
reservedMap.lib("refs").at(["e"]).update(current => current);
const arbitraryLength = new Array<never>(2);
// @ts-expect-error An array variable does not establish exact empty-tuple cardinality.
const badEmptyProposal: LiveMapWriteValue<readonly []> = arbitraryLength;
// @ts-expect-error Mutable empty tuples also retain cardinality.
const badMutableEmptyProposal: LiveMapWriteValue<[]> = arbitraryLength;
// @ts-expect-error Selected governed writes must reject arbitrary array lengths.
reservedMap.lib("refs").at(["e"]).replace(arbitraryLength);
// @ts-expect-error Update outputs must retain empty-tuple cardinality, too.
reservedMap.lib("refs").at(["e"]).update(() => arbitraryLength);
// @ts-expect-error Empty tuple proposals retain cardinality.
reservedMap.lib("refs").at(["e"]).replace([1]);

const nestedReadonly: readonly (readonly string[])[] = [["one"], []];
const nestedProposal: LiveMapWriteValue<typeof nestedReadonly> = nestedReadonly;
// @ts-expect-error Nested readonly forwarding must preserve the element domain.
const badNestedProposal: LiveMapWriteValue<typeof nestedReadonly> = [[true]];
const objectProposal: LiveMapWriteValue<Deck> = rootSnapshot;
const unionSnapshot = example.slides[0]!.column1[0]!;
const unionProposal: LiveMapWriteValue<Block> = unionSnapshot;
// @ts-expect-error Discriminated replacement proposals retain branch correlations.
const badUnionProposal: LiveMapWriteValue<Block> = { kind: "code", text: "wrong" };
const recursiveProposal: LiveMapWriteValue<typeof recursiveSnapshot> = recursiveSnapshot;
const mutualProposal: LiveMapWriteValue<typeof mutualSnapshot> = mutualSnapshot;
// @ts-expect-error Whole recursive proposals retain nested primitive types.
const badRecursiveProposal: LiveMapWriteValue<typeof recursiveSnapshot> = { value: "root", age: 1, children: [{ value: true, age: 0, children: [] }] };
// @ts-expect-error Mutually recursive proposals retain nested discriminators.
const badMutualProposal: LiveMapWriteValue<typeof mutualSnapshot> = { kind: "a", children: [{ kind: "a", children: [] }] };
users.lib("user").at(["pair"]).update(current => current);
void [reservedRefs, emptyProposal, readonlyEmptyProposal, badEmptyProposal, badMutableEmptyProposal,
  nestedProposal, badNestedProposal, objectProposal, unionProposal, badUnionProposal,
  recursiveProposal, mutualProposal, badRecursiveProposal, badMutualProposal];
