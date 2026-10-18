import { Hson, hsonLiveMap, type HsonSchema } from "hson-live";
declare const schema: HsonSchema<{ slides: readonly { kind: "heading" | "code"; text: string }[]; optional?: { count: number } }, "data">;
const map = hsonLiveMap.create();
const receipt = map.addLibraries({ page: { document: Hson.document`<main/>` }, deck: { data: { slides: [] }, schema } });
receipt.commit.operations;
receipt.libraries.page.render();
receipt.libraries.deck.at(["slides", 0, "kind"]).snap() satisfies "heading" | "code" | undefined;
// @ts-expect-error Admission does not type the original registry.
map.lib("page").render();
// @ts-expect-error No unrelated successful evidence.
receipt.libraries.other;
declare const dynamic: string;
const dynamicReceipt = map.addLibraries({ [dynamic]: { document: "<main/>" } });
// @ts-expect-error Dynamic names cannot certify arbitrary membership.
dynamicReceipt.libraries.anything.render();
const locus = hsonLiveMap.locus.create({ shared: [{ name: "page", definition: { document: "<main/>" } }] });
locus.lib("page").render();
const admitted = await locus.addLibraries({ shared: [{ name: "deck", definition: { data: { slides: [] }, schema } }, { name: "next", definition: { document: "<aside/>" } }] });
admitted.libraries.next.render();
admitted.libraries.deck.at(["optional", "count"]).snap() satisfies number | undefined;
// @ts-expect-error Impossible governed literal path.
admitted.libraries.deck.at(["slides", 0, "wrong"]);
// @ts-expect-error No numeric child below a scalar.
admitted.libraries.deck.at(["optional", "count", 0]);
// @ts-expect-error Original Locus binding does not acquire dynamic types.
locus.lib("deck").snap();
const unknown = await locus.addLibraries({ shared: [{ name: dynamic, definition: { data: 1 } }] });
// @ts-expect-error Dynamic string does not establish arbitrary registry evidence.
unknown.libraries.anything.snap();

const maybeLocal = dynamicReceipt.libraries[dynamic];
if (maybeLocal?.mode === "document") maybeLocal.render();
const maybeAuthority = unknown.libraries[dynamic];
if (maybeAuthority?.mode === "document") maybeAuthority.render();

// A possible name in a union or variable-length list is not certain membership.
declare const choiceName: "first" | "second";
const choiceReceipt = await locus.addLibraries({ shared: [{ name: choiceName, definition: { document: "<main/>" } }] });
// @ts-expect-error Only the runtime choice was admitted.
choiceReceipt.libraries.first.render();
choiceReceipt.libraries.first?.render();
declare const variableEntries: readonly { name: "maybe"; definition: { document: string } }[];
const listReceipt = await locus.addLibraries({ shared: variableEntries, private: [{ name: "certain", definition: { document: "<aside/>" } }] });
// @ts-expect-error The variable-length list may be empty.
listReceipt.libraries.maybe.render();
listReceipt.libraries.maybe?.render();
listReceipt.libraries.certain.render();
declare const optionalGroups: { shared?: readonly [{ name: "optional"; definition: { document: string } }]; private: readonly [{ name: "present"; definition: { document: string } }] };
const optionalReceipt = await locus.addLibraries(optionalGroups);
// @ts-expect-error An absent group supplies no successful evidence.
optionalReceipt.libraries.optional.render();
optionalReceipt.libraries.optional?.render();
optionalReceipt.libraries.present.render();

// Optional definition keys preserve membership and their present-family evidence.
declare const optionalDefinitions: {
  state: { data: number };
  page: { document: string };
  requiredDeck: { data: { slides: [] }; schema: typeof schema };
  optionalPage?: { document: string };
  optionalDeck?: { data: { slides: [] }; schema: typeof schema };
};
const optionalLocal = map.addLibraries(optionalDefinitions);
optionalLocal.commit.operations;
optionalLocal.libraries.state.snap();
optionalLocal.libraries.page.render();
optionalLocal.libraries.requiredDeck.at(["slides", 0, "kind"]).snap() satisfies "heading" | "code" | undefined;
// @ts-expect-error An optional Library may not have been admitted.
optionalLocal.libraries.optionalPage.render();
// @ts-expect-error Optional data membership also requires narrowing.
optionalLocal.libraries.optionalDeck.at(["slides"]);
if (optionalLocal.libraries.optionalPage) optionalLocal.libraries.optionalPage.render();
if (optionalLocal.libraries.optionalDeck) {
  optionalLocal.libraries.optionalDeck.at(["slides", 0, "kind"]).snap() satisfies "heading" | "code" | undefined;
  // @ts-expect-error Narrowed membership retains Schema path precision.
  optionalLocal.libraries.optionalDeck.at(["notInSchema"]);
}
// @ts-expect-error The original alias acquires no new inventory.
map.lib("optionalPage").render();

// The receipt preserves the optional property modifier, not just an undefined value union.
const absentMembership: Pick<typeof optionalLocal.libraries, "optionalPage" | "optionalDeck"> = {};
void absentMembership;
if (optionalLocal.libraries.optionalDeck) optionalLocal.libraries.optionalDeck.schema.get() satisfies typeof schema;
