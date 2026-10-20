import { Hson, type HsonSchema, type HsonData, type HsonDocument } from "hson-live/hson";
import { hsonLiveMap } from "hson-live/livemap";
import type { Echo } from "hson-live/echo";
declare const State: HsonSchema<{ count: number }, "data">;
type Text = Readonly<{ $_tag: "_hson_str"; $_content: readonly [string] }>;
type PageGraph = Readonly<{ $_tag: "_hson_root"; $_content: readonly [Readonly<{
  $_tag: "main"; $_content: readonly [Readonly<{ $_tag: "_hson_elem"; $_content: readonly [Readonly<{
    $_tag: "b"; $_content: readonly [Text];
  }>]; }>];
}>] }>;
declare const Page: HsonSchema<PageGraph, "document">;
const definitions = {
  page: { document: '<main <b "text"/>/>', schema: Page },
  state: { data: { count: 1 }, schema: State },
  components: { parts: { submit: { kind: "document" as const, document: "<button/>" } } },
};
const map = hsonLiveMap.fromLibraries(definitions);
map.doc.page.snap() satisfies string;
map.doc.page.hson() satisfies HsonDocument;
map.doc.page.at([0]).snap() satisfies string;
map.doc.page.at([0]).hson() satisfies HsonDocument;
map.doc.page.watch(value => value satisfies string);
map.doc.page.at([0]).watch(value => value satisfies string);
map.data.state.at(["count"]).snap() satisfies number;
map.data.state.at(["count"]).hson() satisfies HsonData;
map.data.state.at(["count"]).must.snap() satisfies number;
map.data.state.must.hson() satisfies HsonData;
map.parts.components.submit.must.snap().document satisfies HsonDocument | string;
map.parts.components.submit.must.hson() satisfies HsonData;
const broad = hsonLiveMap.fromLibraries({ page: { document: "<main/>" }, state: { data: { value: 1 } } });
broad.doc.page.at([0]).snap() satisfies string | undefined;
broad.doc.page.at([0]).must.snap() satisfies string;
broad.doc.page.at([0]).must.hson() satisfies HsonDocument;
// @ts-expect-error Selected locations can disappear.
broad.doc.page.at([0]).snap() satisfies string;
// @ts-expect-error Transient refinement is not permanent governing evidence.
broad.doc.page.at([0]).present()!.snap() satisfies string;
// @ts-expect-error A broad root can change between element and multiple-content forms.
broad.doc.page.at([]).asElement()!.snap() satisfies string;
// @ts-expect-error Root-shape refinement is also transient.
broad.doc.page.at([]).asRoot()!.snap() satisfies string;
// @ts-expect-error Canonical representation was renamed without an alias.
map.data.state.at(["count"]).data();
// @ts-expect-error Fragments cannot render.
map.doc.page.at([0]).render();
// @ts-expect-error Definitions cannot render.
map.parts.components.render();
// @ts-expect-error Required reads do not add mutation authority.
map.data.state.at(["count"]).must.set(2);
map.batch(writer => {
  // @ts-expect-error Deliberately write-only stage.
  writer.doc.page.snap();
  // @ts-expect-error No required read on a write-only stage.
  writer.data.state.at(["count"]).must.snap();
});
const locus = hsonLiveMap.locus.create(definitions, { actions: { inspect(ctx) {
  ctx.doc.page.must.snap() satisfies string;
  ctx.doc.page.at([0]).hson() satisfies HsonDocument;
  ctx.data.state.at(["count"]).must.snap() satisfies number;
  // @ts-expect-error Read-only authority stays read-only.
  ctx.doc.page.at([0]).replace("text");
} } });
locus.doc.page.snap() satisfies string;
locus.doc.page.at([0]).must.hson() satisfies HsonDocument;
locus.parts.components.submit.must.snap().document satisfies string;
declare const echo: Echo<typeof map>;
echo.doc.must("page").snap() satisfies string;
echo.doc.must("page").at([0]).must.snap() satisfies string;
echo.data.must("state").must.hson() satisfies HsonData;
