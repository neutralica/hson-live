import { Hson, hsonLocus } from "hson-live";
import { hsonLiveMap } from "hson-live/livemap";

const Count = Hson.schema`<type "data" content <value "number">>`;
const Page = Hson.schema`<type "document" tag "main" content "empty">`;
const definitions = {
  count: { data: { value: 1 }, schema: Count },
  page: { document: "<main/>", schema: Page },
} as const;
const direct = hsonLiveMap.fromLibraries(definitions);
const locus = hsonLocus.create({ libraries: [
  { name: "count", ownership: "shared", definition: definitions.count },
  { name: "page", ownership: "private", definition: definitions.page },
  { name: "ui", ownership: "local", initializer: { data: { selected: false } } },
] });
const sameMapType: typeof direct = locus.map;
const count = locus.map.lib("count");
const page = locus.map.lib("page");
if (page.mode !== "document") throw new Error("Library family inference failed.");
void [sameMapType, count, page];
void locus.stage.lib("count").at(["value"]).set(2);
void locus.stage((stage) => { stage.lib("count").at(["value"]).set(3); });
