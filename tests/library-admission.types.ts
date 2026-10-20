import { Hson, hsonLiveMap, type HsonSchema } from "hson-live";
declare const schema: HsonSchema<{ slides: readonly { kind: "heading" | "code"; text: string }[]; optional?: { count: number } }, "data">;
const map = hsonLiveMap.create();
const receipt = map.addLibraries({ page: { document: Hson.document`<main/>` }, deck: { data: { slides: [] }, schema } });
receipt.commit.operations;
receipt.libraries.page.render();
receipt.libraries.deck.at(["slides", 0, "kind"]).snap() satisfies "heading" | "code" | undefined;
// @ts-expect-error Admission does not type the original registry.
map.doc.page.render();
// @ts-expect-error No unrelated successful evidence.
receipt.libraries.other;
declare const dynamic: string;
const dynamicReceipt = map.addLibraries({ [dynamic]: { document: "<main/>" } });
// @ts-expect-error Dynamic names cannot certify arbitrary membership.
dynamicReceipt.libraries.anything.render();
const locus = hsonLiveMap.locus.create({ "page": { document: "<main/>", access: "shared" } });
locus.doc.page.render();
const admitted: void = await locus.admit({ deck: { data: { slides: [] }, schema }, next: { document: "<aside/>" } });
locus.doc.must("next").render();
locus.data.must("deck", schema).at(["optional", "count"]).snap() satisfies number | undefined;
// @ts-expect-error Impossible governed literal path.
locus.data.must("deck", schema).at(["slides", 0, "wrong"]);
// @ts-expect-error No numeric child below a scalar.
locus.data.must("deck", schema).at(["optional", "count", 0]);
// @ts-expect-error Original Locus binding does not acquire dynamic inventory.
locus.data.deck.snap();
// @ts-expect-error Admission returns no Library receipt.
admitted.libraries;
await locus.admit({ [dynamic]: { data: 1 } });
locus.data.must(dynamic).snap();
const maybeLocal = dynamicReceipt.libraries[dynamic];
if (maybeLocal?.mode === "document") maybeLocal.render();
declare const choiceName: "first" | "second";
await locus.admit({ [choiceName]: { document: "<main/>" } });
// @ts-expect-error Dynamic admission does not add guaranteed properties.
locus.doc.first.render();
locus.doc("first")?.render();
declare const uncertain: { maybe?: { document: string }; present: { document: string } };
await locus.admit(uncertain);
locus.doc.must("present").render();

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
map.doc.optionalPage.render();

// The receipt preserves the optional property modifier, not just an undefined value union.
const absentMembership: Pick<typeof optionalLocal.libraries, "optionalPage" | "optionalDeck"> = {};
void absentMembership;
if (optionalLocal.libraries.optionalDeck) optionalLocal.libraries.optionalDeck.schema.get() satisfies typeof schema;
