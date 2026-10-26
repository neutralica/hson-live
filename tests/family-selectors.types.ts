import type { JsonValue } from "../src/core/types.js";
import { ANY_DATA, ANY_DOCUMENT, hsonLiveMap, type HsonSchema, type LiveMap } from "../src/index.js";
import type { LocusActionContext, Echo } from "../src/types/locus.core.types.js";

declare const Deck: HsonSchema<{ readonly slides: readonly { readonly title: string }[]; readonly optional?: string }, "data">;
declare const maybeSchema: typeof Deck | undefined;
declare const broadSchema: HsonSchema | undefined;
const map = hsonLiveMap.fromLibraries({
  page: { document: '<main/>' }, deck: { data: { slides: [] }, schema: Deck },
  components: { parts: { button: { kind: "document", document: '<button hson:part/>' } } },
  name: { document: '<aside/>' }, must: { document: '<aside/>' }, then: { document: '<aside/>' },
  array: { data: [1] },
  __defineGetter__: { document: "<main/>" }, __defineSetter__: { document: "<main/>" },
  __lookupGetter__: { document: "<main/>" }, __lookupSetter__: { document: "<main/>" },
});
map.doc.page.render();
map.data.deck.at(["slides"]).array.map(slide => slide.title satisfies string);
map.parts.components.at(["button", "document"]).snap() satisfies string | undefined;
map.data.array.at([]).array.toArray() satisfies readonly JsonValue[];
map.doc.must("name").render(); map.doc.must("must").render(); map.doc.must("then").render();
// @ts-expect-error Old family-neutral selection is removed.
map.lib;
// @ts-expect-error Known names appear only on their family.
map.data.page;
// @ts-expect-error A function intrinsic is not a Library handle.
map.doc.name.render();
map.parts.components.button.snap() satisfies import("../src/types/livemap.types.js").LiveMapDocumentPart | undefined;
// @ts-expect-error Known Schema paths remain checked.
map.data.deck.at(["misspelled"]);
// @ts-expect-error Callable lookup is optional even for certain inventory.
map.data("deck").snap();
map.data("deck")?.at(["slides"]).array.map(slide => slide.title);
map.data.must("deck", maybeSchema).at(["slides"]).array.map(slide => slide.title);

const dynamic = hsonLiveMap.create();
dynamic.addLibraries({ incoming: { data: { slides: [] }, schema: Deck } });
// @ts-expect-error Admission does not retroactively add property inventory.
dynamic.data.incoming;
dynamic.doc.must("runtimeDocument").render();
dynamic.data.must("incoming", Deck).at(["slides"]).array.map(slide => slide.title);
dynamic.data("incoming", Deck)?.at(["slides"]).array.map(slide => slide.title);
// @ts-expect-error Absent evidence cannot give unconditional Schema precision.
dynamic.data.must("incoming", maybeSchema).at(["slides"]).array;
// @ts-expect-error Explicit undefined carries no Schema evidence.
dynamic.data.must("incoming", undefined).at(["slides"]).array;
// @ts-expect-error Broad optional Schema carries no precise inventory or value proof.
dynamic.data.must("incoming", broadSchema).snap() satisfies { slides: readonly { title: string }[] };

declare const uncertain: { deck?: { data: { slides: never[] }; schema: typeof Deck } };
const possible = hsonLiveMap.fromLibraries(uncertain);
// @ts-expect-error Possible membership is still optional on properties.
possible.data.deck.snap();
// @ts-expect-error Possible input Schema is not a governing-Schema proof for later admission.
possible.data.must("deck").at(["slides"]).array;
possible.data.must("deck", Deck).at(["slides"]).array.map(slide => slide.title);
declare const name: string;
// @ts-expect-error No string index signature pretends to know mutable inventory.
map.doc[name];

declare const read: LocusActionContext<typeof map>;
read.doc.page.render(); read.data.deck.at(["slides"]).array.map(slide => slide.title);
// @ts-expect-error Read-only contexts cannot mutate.
read.data.deck.at(["slides"]).array.push({ title: "no" });
// @ts-expect-error Read-only contexts cannot attach Schemas.
read.data.deck.schema.use(Deck);
map.batch(writer => {
  writer.data.deck.at(["slides"]).array.push({ title: "yes" });
  writer.data.must("incoming", Deck).at(["slides"]).array.push({ title: "yes" });
  // @ts-expect-error Staged capabilities cannot observe.
  writer.data.deck.snap();
  // @ts-expect-error Staged document handles cannot render.
  writer.doc.page.render();
  // @ts-expect-error Schema evidence preserves command value types.
  writer.data.must("incoming", Deck).at(["slides"]).array.push({ title: 1 });
});
declare const endpoint: Echo;
// @ts-expect-error Endpoint-only Echo has no replicas.
endpoint.doc;
declare const replica: Echo<LiveMap>;
const selected = replica.data.must("incoming", Deck);
selected.at(["slides"]).array.map(slide => slide.title);
if (selected.source === "authority-projected") {
  // @ts-expect-error Schema claims do not grant projected mutation.
  selected.at(["slides"]).array.push({ title: "no" });
} else selected.at(["slides"]).array.push({ title: "yes" });

// Inherited JavaScript functions cannot masquerade as colliding Library facades.
// @ts-expect-error The inherited getter-definition function is not a Library.
map.doc.__defineGetter__.render();
// @ts-expect-error The inherited setter-definition function is not a Library.
map.doc.__defineSetter__.render();
// @ts-expect-error The inherited getter-lookup function is not a Library.
map.doc.__lookupGetter__.render();
// @ts-expect-error The inherited setter-lookup function is not a Library.
map.doc.__lookupSetter__.render();
map.doc.must("__defineGetter__").render();
map.doc.must("__defineSetter__").render();
map.doc.must("__lookupGetter__").render();
map.doc.must("__lookupSetter__").render();

// Parts retain their intrinsic Schema and all source-specific data capabilities.
const parts = replica.parts.must("widgets");
parts.snap(); parts.root(); parts.rev satisfies number;
parts.schema.get() satisfies HsonSchema<unknown, "data">;
parts.at(["button", "document"]).snap() satisfies string | undefined;
parts.at(["button"]).watch(value => value?.document satisfies string | undefined);
if (parts.source === "client-local") {
  parts.source satisfies "client-local";
  // @ts-expect-error Client-local Parts cannot attach supplemental Schemas.
  parts.schema.use(ANY_DATA);
  parts.at(["button"]).set({ kind: "document", document: "<button hson:part/>" });
  parts.at(["button", "document"]).set("<button hson:part/>");
  parts.at(["button"]).replace({ kind: "document", document: "<button hson:part/>" });
  parts.at(["button"]).delete();
} else {
  parts.source satisfies "authority-projected";
  // @ts-expect-error Projected Parts remain read-only.
  parts.at(["button"]).set({ kind: "document", document: "<button hson:part/>" });
  // @ts-expect-error Projected Parts cannot attach Schemas.
  parts.schema.use(ANY_DATA);
}
for (const checked of [replica.parts.must("widgets", ANY_DATA), replica.parts.must("widgets", maybeSchema)]) {
  checked.at(["button", "document"]).snap() satisfies string | undefined;
  checked.schema.get() satisfies HsonSchema<unknown, "data">;
  if (checked.source === "client-local") {
    // @ts-expect-error Checked selection and source narrowing cannot grant Schema attachment.
    checked.schema.use(ANY_DATA);
    checked.at(["button", "document"]).set("<button hson:part/>");
  } else {
    checked.source satisfies "authority-projected";
    // @ts-expect-error Checked projected selection remains read-only.
    checked.at(["button", "document"]).set("<button hson:part/>");
  }
}
const optionalParts = replica.parts("widgets", ANY_DATA);
if (optionalParts?.source === "client-local") {
  // @ts-expect-error Optional checked lookup preserves the Parts restriction.
  optionalParts.schema.use(ANY_DATA);
  optionalParts.at(["button", "document"]).set("<button hson:part/>");
}
declare const knownReplica: Echo<typeof map>;
const knownParts = knownReplica.parts.components;
if (knownParts.source === "client-local") {
  // @ts-expect-error Literal inventory selection preserves the Parts restriction.
  knownParts.schema.use(ANY_DATA);
  knownParts.at(["button", "document"]).set("<button hson:part/>");
}
const localData = replica.data.must("ordinary", ANY_DATA);
if (localData.source === "client-local") localData.schema.use(ANY_DATA);
const localDocument = replica.doc.must("page", ANY_DOCUMENT);
if (localDocument.source === "client-local") localDocument.schema.use(ANY_DOCUMENT);
