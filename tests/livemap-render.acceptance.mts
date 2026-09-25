import assert from "node:assert/strict";
import { Hson, hsonLiveMap, render_document } from "../src/index.ts";

const PageSchema = Hson.schema`<type "document" tag "main" content "empty">`;
const DataSchema = Hson.schema`<type "data" content <value "number">>`;

const page = hsonLiveMap.fromLibraries({
  page: { document: "<main/>", schema: PageSchema },
});

assert.equal(page.render(), "<main></main>");
assert.equal(page.render("page"), "<main></main>");
assert.equal(page.render(), render_document({ map: page, document: "page" }).html);
assert.equal("cut" in page, false);
assert.equal("render" in page.lib("page"), false);

const mixed = hsonLiveMap.fromLibraries({
  state: { data: { value: 1 }, schema: DataSchema },
  page: { document: "<main/>", schema: PageSchema },
});
assert.equal(mixed.render(), "<main></main>");
assert.throws(() => mixed.render("state"), /not a selectable public document/);
assert.throws(() => mixed.render("missing"), /not a selectable public document/);

const multiple = hsonLiveMap.fromLibraries({
  first: { document: "<main/>", schema: PageSchema },
  second: { document: "<main/>", schema: PageSchema },
});
assert.throws(() => multiple.render(), /multiple public document Libraries/);
assert.equal(multiple.render("second"), "<main></main>");

const dataOnly = hsonLiveMap.fromLibraries({
  state: { data: { value: 1 }, schema: DataSchema },
});
assert.throws(() => dataOnly.render(), /no selectable public document Library/);

console.log("LiveMap registry rendering accepts only an unambiguous document.");
